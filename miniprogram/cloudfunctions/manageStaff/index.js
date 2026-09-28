/**
 * 店员账号管理（集合 staff_members）
 *
 * action:
 *   whoami         任意登录用户 —— 返回自己的角色，供前端控制「店长后台 / 店员后台」入口可见性
 *   verifyUiGate   已登记员工 —— 校验工作台 UI 门帘口令（环境变量，勿写进小程序包）
 *   list           店长 —— 列表（可选 status / role 筛选；附 phoneMasked）
 *   upsert         店长 —— 新增或改角色；同时把 users.staffRole 冗余一份，让「我的」页零额外查询即可判断入口
 *   remove         店长 —— 停用
 *   lookupByPhone  店长 —— 按完整手机号查 users，返回脱敏候选人（开通用）
 *   getWorkspaceAcl 超管 —— 读取超管 openid 配置（硬编码 ∪ 云库）
 *   saveWorkspaceAcl 超管 —— 保存云库可配超管 openid 列表（硬编码不可删）
 *   listAuditLogs   超管 —— 只读审计日志（action / 时间筛选）
 *   getArtisanProfile / saveArtisanProfile —— 标本师个人主页（framers.staffOpenid）
 *   getPublicFramer —— 对外主页只读（按 id，不要求店员权限）
 *   listArtisanAdmin / pinArtisanCanonical / bindArtisanStaff / setArtisanActive
 *     —— 超管/店长「标本师管理」运维（列表增强、钉权威档案、绑定员工、上下架）
 *
 * upsert 角色：staff | manager | super_admin | specimen_artisan | live_host | investor | shareholder
 *            | buyer | franchisee | channel | supplier
 *   super_admin → staff_members.role=super_admin + 并入 workspace_acl.openids
 *   改回店长/店员或停用 → 从 ACL 移除（硬编码 openid 不删）
 *   buyer/franchisee/channel/supplier → B2B 旁路（无门店经营权限；可进采购商工作台）
 *
 * UI 门帘口令：MANAGER_UI_PASSWORD / MANAGER_UI_PASSWORD_HASH（本函数环境变量）。
 * 真正的写操作闸门仍是 staffGuard.js，服务端一律自行校验。
 */
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const {
  assertStaff,
  resolveActor,
  normalizeRole,
  normalizeStoredRoleKey,
  normalizeStoredRoles,
  pickHighestStoredRole,
  workspaceRoleFromStoredRoles,
  hasRole,
  unionPermissionsForStoredRoles,
  defaultPermissions,
  ROLE_MANAGER,
  ROLE_STAFF,
  WORKSPACE_SUPER_ADMIN,
  WORKSPACE_STORE_MANAGER,
  WORKSPACE_STORE_STAFF,
  WORKSPACE_SPECIMEN_ARTISAN,
  WORKSPACE_LIVE_HOST,
  STORED_ROLE_SUPER,
  STORED_ROLE_SPECIMEN_ARTISAN,
  STORED_ROLE_LIVE_HOST,
  STORED_ROLE_INVESTOR,
  STORED_ROLE_SHAREHOLDER,
  STORED_ROLE_BUYER,
  STORED_ROLE_FRANCHISEE,
  STORED_ROLE_CHANNEL,
  STORED_ROLE_SUPPLIER,
  isSpecimenArtisanRole,
  isLiveHostRole,
  isInvestorRole,
  isShareholderRole,
  isBuyerRole,
  isSupplierRole,
  SUPER_ADMIN_OPENIDS,
  ACL_COLLECTION,
  ACL_SUPER_DOC,
  resolveSuperAdminOpenids,
  clearSuperAdminOpenidCache,
  sanitizePermissions,
  resolvePermissionsForStaffRecord
} = require('./staffGuard')
const { getWorkbenchFeatureCatalog, featureKeysForRoles } = require('./workspaceFeatures')
const { writeAuditLog, auditFromActor } = require('./auditLog')

/** 工作台 UI 门帘：失败次数（进程内，冷启动重置；防暴力猜） */
const UI_GATE_FAIL_WINDOW_MS = 15 * 60 * 1000
const UI_GATE_FAIL_MAX = 5
const uiGateFailMap = new Map()

/** 门店范围与积分发放上限仅适用于显式拥有店员/店长角色的账号 */
function rolesWithFieldStoreScope(roles) {
  const list = Array.isArray(roles) ? roles.filter(Boolean) : []
  return list.indexOf(ROLE_STAFF) !== -1 || list.indexOf(ROLE_MANAGER) !== -1
}

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COLLECTION = 'staff_members'
const FRAMERS_COLLECTION = 'framers'
const PHONE_RE = /^1\d{10}$/

const ARTISAN_READ_PERMISSIONS = ['manageArtisanProfile', 'manageArtisanWorks', 'manageProducts']

function fail(msg, extra) {
  return { success: false, msg, ...(extra || {}) }
}

function normalizeStoreIds(value) {
  if (typeof value === 'string') {
    return value.split(',').map((s) => s.trim()).filter(Boolean)
  }
  if (!Array.isArray(value)) return []
  return value.map((id) => String(id || '').trim()).filter(Boolean)
}

function maskPhone(phone) {
  const value = String(phone || '')
  if (value.length < 7) return ''
  return value.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '')
}

const ROLE_LABELS = {
  [ROLE_STAFF]: '店员',
  [ROLE_MANAGER]: '店长',
  [STORED_ROLE_SPECIMEN_ARTISAN]: '标本师',
  [STORED_ROLE_LIVE_HOST]: '直播主播',
  [STORED_ROLE_INVESTOR]: '投资人',
  [STORED_ROLE_SHAREHOLDER]: '股东',
  [STORED_ROLE_BUYER]: '采购商',
  [STORED_ROLE_FRANCHISEE]: '加盟商',
  [STORED_ROLE_CHANNEL]: '渠道商',
  [STORED_ROLE_SUPPLIER]: '供货方',
  [STORED_ROLE_SUPER]: '超管'
}

function parseRequestedRole(raw) {
  const value = String(raw || '').trim()
  if (value === 'super_admin' || value === WORKSPACE_SUPER_ADMIN) {
    return { storedRole: STORED_ROLE_SUPER, isSuper: true, syncRole: ROLE_MANAGER }
  }
  if (isSpecimenArtisanRole(value)) {
    return { storedRole: STORED_ROLE_SPECIMEN_ARTISAN, isSuper: false, syncRole: STORED_ROLE_SPECIMEN_ARTISAN }
  }
  if (isLiveHostRole(value)) {
    return { storedRole: STORED_ROLE_LIVE_HOST, isSuper: false, syncRole: STORED_ROLE_LIVE_HOST }
  }
  if (isInvestorRole(value)) {
    return { storedRole: STORED_ROLE_INVESTOR, isSuper: false, syncRole: STORED_ROLE_INVESTOR }
  }
  if (isShareholderRole(value)) {
    return { storedRole: STORED_ROLE_SHAREHOLDER, isSuper: false, syncRole: STORED_ROLE_SHAREHOLDER }
  }
  if (value === STORED_ROLE_BUYER || value === 'buyer') {
    return { storedRole: STORED_ROLE_BUYER, isSuper: false, syncRole: STORED_ROLE_BUYER }
  }
  if (value === STORED_ROLE_FRANCHISEE || value === 'franchisee') {
    return { storedRole: STORED_ROLE_FRANCHISEE, isSuper: false, syncRole: STORED_ROLE_FRANCHISEE }
  }
  if (value === STORED_ROLE_CHANNEL || value === 'channel') {
    return { storedRole: STORED_ROLE_CHANNEL, isSuper: false, syncRole: STORED_ROLE_CHANNEL }
  }
  if (isSupplierRole(value)) {
    return { storedRole: STORED_ROLE_SUPPLIER, isSuper: false, syncRole: STORED_ROLE_SUPPLIER }
  }
  const role = normalizeRole(value) || ROLE_STAFF
  return { storedRole: role, isSuper: false, syncRole: role }
}

function parseRequestedRoles(event) {
  const rawList = event && event.roles
  if (Array.isArray(rawList)) {
    const set = {}
    rawList.forEach((item) => {
      const key = normalizeStoredRoleKey(item)
      if (key) set[key] = true
    })
    const roles = Object.keys(set)
    if (roles.length) return roles
  }
  const single = parseRequestedRole(event && event.role)
  return single.storedRole ? [single.storedRole] : []
}

function roleLabelForStored(storedRole) {
  return ROLE_LABELS[storedRole] || storedRole || '店员'
}

function rolesDisplayText(roles, inAcl) {
  const list = (roles || []).slice()
  if (inAcl && list.indexOf(STORED_ROLE_SUPER) === -1) list.unshift(STORED_ROLE_SUPER)
  const order = [
    STORED_ROLE_SUPER,
    ROLE_MANAGER,
    STORED_ROLE_INVESTOR,
    STORED_ROLE_SHAREHOLDER,
    ROLE_STAFF,
    STORED_ROLE_SPECIMEN_ARTISAN,
    STORED_ROLE_LIVE_HOST,
    STORED_ROLE_BUYER,
    STORED_ROLE_FRANCHISEE,
    STORED_ROLE_CHANNEL,
    STORED_ROLE_SUPPLIER
  ]
  const sorted = order.filter((k) => list.indexOf(k) !== -1)
  return sorted.map(roleLabelForStored).join(' / ') || '店员'
}

function roleDisplayFromRow(row, inAcl) {
  const roles = normalizeStoredRoles(row || {})
  const primary = pickHighestStoredRole(roles) || ROLE_STAFF
  const workspaceRole = workspaceRoleFromStoredRoles(roles) || WORKSPACE_STORE_STAFF
  return {
    roles,
    role: primary,
    roleText: rolesDisplayText(roles, inAcl),
    workspaceRole,
    isSuperAdmin: hasRole(roles, STORED_ROLE_SUPER) || inAcl
  }
}

function syncRoleForUsers(roles) {
  const highest = pickHighestStoredRole(roles)
  if (highest === STORED_ROLE_SUPER || highest === ROLE_MANAGER) return ROLE_MANAGER
  if (highest === STORED_ROLE_SPECIMEN_ARTISAN) return STORED_ROLE_SPECIMEN_ARTISAN
  if (highest === STORED_ROLE_LIVE_HOST) return STORED_ROLE_LIVE_HOST
  if (highest === STORED_ROLE_INVESTOR) return STORED_ROLE_INVESTOR
  if (highest === STORED_ROLE_SHAREHOLDER) return STORED_ROLE_SHAREHOLDER
  if (highest === STORED_ROLE_BUYER) return STORED_ROLE_BUYER
  if (highest === STORED_ROLE_FRANCHISEE) return STORED_ROLE_FRANCHISEE
  if (highest === STORED_ROLE_CHANNEL) return STORED_ROLE_CHANNEL
  if (highest === STORED_ROLE_SUPPLIER) return STORED_ROLE_SUPPLIER
  return ROLE_STAFF
}

const SHAREHOLDER_STORE_LABELS = {
  store_shanhaizaowu: '山川造物',
  store_xingchen: '星宸标本'
}

function clampRatioPct(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  if (n > 100) return 100
  return Math.round(n * 1000) / 1000
}

function normalizeEffectiveDate(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return ''
}

/**
 * 股东配置：绑定门店 + 占股/双阶段分成/出资/生效日
 * 对齐财务核算双阶段：回本前/后个人占投资人分红池比重可不同。
 * 旧字段 dividendRatio = 回本前分成（迁移兼容；写入时同步镜像）。
 */
function hasRatioInput(bag, key) {
  return !!(bag && bag[key] != null && bag[key] !== '')
}

function parseShareholderProfile(event, existingRow) {
  const src = (event && event.shareholderProfile) || event || {}
  const prev = (existingRow && existingRow.shareholderProfile) || {}
  const storeId = String(src.storeId || src.shareholderStoreId || prev.storeId || '').trim()
  const ownershipRatio = clampRatioPct(
    src.ownershipRatio != null ? src.ownershipRatio : (src.equityRatio != null ? src.equityRatio : prev.ownershipRatio)
  )

  let dividendRatioBeforePayback = 0
  if (hasRatioInput(src, 'dividendRatioBeforePayback')) {
    dividendRatioBeforePayback = clampRatioPct(src.dividendRatioBeforePayback)
  } else if (hasRatioInput(src, 'earlyDividendRatio')) {
    dividendRatioBeforePayback = clampRatioPct(src.earlyDividendRatio)
  } else if (hasRatioInput(src, 'dividendRatio')) {
    dividendRatioBeforePayback = clampRatioPct(src.dividendRatio)
  } else if (hasRatioInput(src, 'profitShareRatio')) {
    dividendRatioBeforePayback = clampRatioPct(src.profitShareRatio)
  } else if (hasRatioInput(prev, 'dividendRatioBeforePayback')) {
    dividendRatioBeforePayback = clampRatioPct(prev.dividendRatioBeforePayback)
  } else if (hasRatioInput(prev, 'dividendRatio')) {
    dividendRatioBeforePayback = clampRatioPct(prev.dividendRatio)
  }

  let dividendRatioAfterPayback = dividendRatioBeforePayback
  if (hasRatioInput(src, 'dividendRatioAfterPayback')) {
    dividendRatioAfterPayback = clampRatioPct(src.dividendRatioAfterPayback)
  } else if (hasRatioInput(src, 'lateDividendRatio')) {
    dividendRatioAfterPayback = clampRatioPct(src.lateDividendRatio)
  } else if (hasRatioInput(prev, 'dividendRatioAfterPayback')) {
    dividendRatioAfterPayback = clampRatioPct(prev.dividendRatioAfterPayback)
  } else if (hasRatioInput(prev, 'lateDividendRatio')) {
    dividendRatioAfterPayback = clampRatioPct(prev.lateDividendRatio)
  }

  const dividendRatio = dividendRatioBeforePayback
  const capitalRaw = src.capitalContribution != null
    ? src.capitalContribution
    : (src.investAmount != null ? src.investAmount : prev.capitalContribution)
  const capitalContribution = Math.max(0, Math.round((Number(capitalRaw) || 0) * 100) / 100)
  const effectiveDate = normalizeEffectiveDate(
    src.effectiveDate != null ? src.effectiveDate : prev.effectiveDate
  )
  const storeName = SHAREHOLDER_STORE_LABELS[storeId] || String(src.storeName || prev.storeName || '').trim()
  return {
    storeId,
    storeName,
    ownershipRatio,
    dividendRatio,
    dividendRatioBeforePayback,
    dividendRatioAfterPayback,
    capitalContribution,
    effectiveDate
  }
}

async function readConfiguredSuperOpenids() {
  try {
    const res = await db.collection(ACL_COLLECTION).doc(ACL_SUPER_DOC).get()
    const list = Array.isArray((res.data || {}).openids) ? res.data.openids : []
    return list.map((id) => String(id || '').trim()).filter(Boolean)
  } catch (e) {
    return []
  }
}

async function writeConfiguredSuperOpenids(configured, actorOpenid) {
  const payload = {
    openids: configured,
    updateTime: db.serverDate(),
    updatedBy: actorOpenid || 'admin_web'
  }
  try {
    await db.collection(ACL_COLLECTION).doc(ACL_SUPER_DOC).update({ data: payload })
  } catch (e) {
    await db.collection(ACL_COLLECTION).doc(ACL_SUPER_DOC).set({
      data: { ...payload, createTime: db.serverDate() }
    })
  }
  clearSuperAdminOpenidCache()
}

/**
 * 把目标 openid 并入 / 移出云库超管名单（硬编码永不写入/删除）
 */
async function syncTargetInSuperAcl(targetOpenid, shouldBeSuper, actorOpenid) {
  if (!targetOpenid) return { changed: false }
  if (SUPER_ADMIN_OPENIDS.indexOf(targetOpenid) !== -1) {
    return { changed: false, hardcoded: true }
  }
  const current = await readConfiguredSuperOpenids()
  const set = {}
  current.forEach((id) => { set[id] = true })
  const before = !!set[targetOpenid]
  if (shouldBeSuper) set[targetOpenid] = true
  else delete set[targetOpenid]
  const after = !!set[targetOpenid]
  if (before === after) return { changed: false, configured: current }

  const next = Object.keys(set)
  await writeConfiguredSuperOpenids(next, actorOpenid)
  return { changed: true, configured: next }
}

function readUiGateFail(openid) {
  const row = uiGateFailMap.get(openid)
  if (!row) return { count: 0, resetAt: 0 }
  if (Date.now() > row.resetAt) {
    uiGateFailMap.delete(openid)
    return { count: 0, resetAt: 0 }
  }
  return row
}

function bumpUiGateFail(openid) {
  const now = Date.now()
  const prev = readUiGateFail(openid)
  const next = {
    count: (prev.count || 0) + 1,
    resetAt: prev.resetAt && prev.resetAt > now ? prev.resetAt : now + UI_GATE_FAIL_WINDOW_MS
  }
  uiGateFailMap.set(openid, next)
  return next
}

function clearUiGateFail(openid) {
  uiGateFailMap.delete(openid)
}

/**
 * 工作台 UI 门帘口令（云函数环境变量，勿写入前端）：
 * - MANAGER_UI_PASSWORD：明文（timingSafeEqual）
 * - 或 MANAGER_UI_PASSWORD_HASH：SHA-256 hex（可带 sha256: 前缀）
 */
function verifyManagerUiPassword(input) {
  const plain = String(process.env.MANAGER_UI_PASSWORD || '')
  const hashEnv = String(process.env.MANAGER_UI_PASSWORD_HASH || '')
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, '')

  if (!plain && !hashEnv) {
    return {
      ok: false,
      code: 'PASSWORD_UNCONFIGURED',
      msg: '未配置工作台口令：请在云函数 manageStaff 环境变量设置 MANAGER_UI_PASSWORD 或 MANAGER_UI_PASSWORD_HASH'
    }
  }

  const submitted = String(input || '')
  if (!submitted) {
    return { ok: false, code: 'PASSWORD_REQUIRED', msg: '请输入访问口令' }
  }

  try {
    if (hashEnv) {
      if (!/^[0-9a-f]{64}$/.test(hashEnv)) {
        return { ok: false, code: 'PASSWORD_MISCONFIGURED', msg: 'MANAGER_UI_PASSWORD_HASH 格式无效（需 64 位 hex）' }
      }
      const submittedHash = crypto.createHash('sha256').update(submitted, 'utf8').digest('hex')
      const a = Buffer.from(submittedHash, 'hex')
      const b = Buffer.from(hashEnv, 'hex')
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { ok: false, code: 'PASSWORD_INVALID', msg: '口令错误' }
      }
      return { ok: true }
    }

    const a = Buffer.from(submitted, 'utf8')
    const b = Buffer.from(plain, 'utf8')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, code: 'PASSWORD_INVALID', msg: '口令错误' }
    }
    return { ok: true }
  } catch (e) {
    console.error('verifyManagerUiPassword', e)
    return { ok: false, code: 'PASSWORD_ERROR', msg: '口令校验失败' }
  }
}

/**
 * UI 门帘：已登记员工 + 服务端口令。不构成写权限凭证。
 */
async function verifyUiGate(event, openid) {
  if (!openid) return fail('请先登录', { code: 'NOT_LOGGED_IN' })

  const failState = readUiGateFail(openid)
  if (failState.count >= UI_GATE_FAIL_MAX) {
    const mins = Math.max(1, Math.ceil((failState.resetAt - Date.now()) / 60000))
    return fail(`尝试过多，请 ${mins} 分钟后再试`, { code: 'PASSWORD_LOCKED' })
  }

  const actor = await resolveActor(db, openid, {})
  if (!actor.ok || !Array.isArray(actor.roles) || !actor.roles.length) {
    return fail('暂无工作台权限', { code: actor.code === 'ADMIN_UNCONFIGURED' ? actor.code : 'FORBIDDEN' })
  }

  const pw = verifyManagerUiPassword(event && event.password)
  if (!pw.ok) {
    if (pw.code === 'PASSWORD_INVALID' || pw.code === 'PASSWORD_REQUIRED') {
      bumpUiGateFail(openid)
    }
    return fail(pw.msg, { code: pw.code })
  }

  clearUiGateFail(openid)
  return {
    success: true,
    ok: true,
    msg: '口令正确',
    workspaceRole: actor.workspaceRole || '',
    roles: actor.roles
  }
}

async function whoami(openid, adminOpsKey) {
  const actor = await resolveActor(db, openid, { adminOpsKey })
  if (!actor.ok) {
    return {
      success: true,
      role: '',
      roles: [],
      workspaceRole: '',
      isManager: false,
      isStaff: false,
      isSuperAdmin: false,
      isArtisan: false,
      isLiveHost: false,
      isInvestor: false,
      isShareholder: false,
      isBuyer: false,
      isSupplier: false,
      code: actor.code,
      hint: actor.code === 'ADMIN_UNCONFIGURED' ? actor.msg : ''
    }
  }
  const roles = Array.isArray(actor.roles) ? actor.roles : []
  const workspaceRole = actor.workspaceRole || workspaceRoleFromStoredRoles(roles)
  const hasStored = (k) => roles.indexOf(k) !== -1
  const staffRow = await findStaffMemberByOpenid(openid)
  return {
    success: true,
    role: actor.role,
    roles,
    workspaceRole,
    isManager: hasStored('manager'),
    isStaff: hasStored('staff'),
    isSuperAdmin: hasStored('super_admin') || !!actor.superAdmin,
    isArtisan: hasStored('specimen_artisan'),
    isLiveHost: hasStored('live_host'),
    isInvestor: hasStored('investor'),
    isShareholder: hasStored('shareholder'),
    isBuyer:
      hasStored('buyer') || hasStored('franchisee') || hasStored('channel'),
    isSupplier: hasStored('supplier'),
    name: actor.name || '',
    artisanFramerId: (staffRow && staffRow.artisanFramerId) || '',
    staffNo: actor.staffNo || '',
    storeIds: actor.storeIds,
    permissions: actor.permissions,
    shareholderProfile: (staffRow && staffRow.shareholderProfile) || null,
    superAdmin: !!actor.superAdmin,
    source: actor.source
  }
}

/**
 * users.staffRole 只为「我的」页入口可见性服务，不作为鉴权依据。
 */
async function syncUserStaffRole(targetOpenid, role, storeIds) {
  try {
    const res = await db.collection('users').where({ _openid: targetOpenid }).limit(1).get()
    const user = res.data && res.data[0]
    if (!user) return
    await db.collection('users').doc(user._id).update({
      data: { staffRole: role || '', staffStoreIds: storeIds || [] }
    })
  } catch (e) {
    console.warn('manageStaff syncUserStaffRole failed:', e.message)
  }
}

/**
 * 店长按完整手机号查找 users，用于开通店员权限。
 * 字段：users.phone（authPhone / upsertUserProfile 写入）
 */
async function lookupByPhone(event, openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, permission: 'manageStaff', adminOpsKey })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const phone = normalizePhone(event && event.phone)
  if (!PHONE_RE.test(phone)) return fail('请输入 11 位手机号')

  try {
    const res = await db.collection('users').where({ phone }).limit(10).get()
    const rows = res.data || []
    const candidates = rows.map((user) => ({
      openid: user._openid || '',
      openidTail: String(user._openid || '').slice(-8),
      nickName: user.nickName || '藏家',
      phoneMasked: maskPhone(user.phone),
      name: user.name || user.nickName || ''
    })).filter((c) => c.openid)

    if (!candidates.length) {
      return {
        success: true,
        count: 0,
        candidates: [],
        msg: '未找到该手机号用户，请让对方先登录小程序并授权手机号'
      }
    }

    return { success: true, count: candidates.length, candidates }
  } catch (e) {
    console.error('manageStaff lookupByPhone', e)
    return fail(e.message || '查找失败')
  }
}

/**
 * 批量从 users 取脱敏手机号（员工花名册展示用；失败时静默为空）
 */
async function loadPhoneMaskedByOpenids(openids) {
  const ids = Array.from(new Set((openids || []).map((id) => String(id || '').trim()).filter(Boolean)))
  const map = {}
  if (!ids.length) return map
  const chunkSize = 20
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    try {
      const res = await db.collection('users').where({ _openid: _.in(chunk) }).limit(chunk.length).get()
      ;(res.data || []).forEach((user) => {
        const oid = user && user._openid
        if (!oid) return
        map[oid] = maskPhone(user.phone)
      })
    } catch (e) {
      console.warn('manageStaff loadPhoneMaskedByOpenids', e.message)
    }
  }
  return map
}

async function listStaff(event, openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, permission: 'manageStaff', adminOpsKey })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const statusFilter = String((event && event.status) || 'all').trim() || 'all'
  const roleFilter = String((event && event.role) || 'all').trim() || 'all'
  const configured = await readConfiguredSuperOpenids()
  const aclSet = {}
  SUPER_ADMIN_OPENIDS.concat(configured).forEach((id) => { aclSet[id] = true })

  try {
    const res = await db.collection(COLLECTION).orderBy('createTime', 'desc').limit(100).get()
    const phoneMap = await loadPhoneMaskedByOpenids((res.data || []).map((row) => row.openid))
    let list = (res.data || []).map((row) => {
      const inAcl = !!(row.openid && aclSet[row.openid])
      const display = roleDisplayFromRow(row, inAcl)
      return {
        _id: row._id,
        openid: row.openid,
        openidTail: String(row.openid || '').slice(-8),
        name: row.name || '',
        staffNo: row.staffNo || '',
        phoneMasked: phoneMap[row.openid] || '',
        role: display.role,
        roles: display.roles,
        roleText: display.roleText,
        workspaceRole: display.workspaceRole,
        isSuperAdmin: display.isSuperAdmin,
        storeIds: Array.isArray(row.storeIds) ? row.storeIds : [],
        permissions: resolvePermissionsForStaffRecord(row),
        permissionsExplicit: !!row.permissionsExplicit,
        dailyGrantCap: Number(row.dailyGrantCap) || 0,
        shareholderProfile: row.shareholderProfile || null,
        status: row.status || 'active',
        createTime: row.createTime,
        updateTime: row.updateTime
      }
    })
    if (statusFilter === 'active' || statusFilter === 'disabled') {
      list = list.filter((row) => row.status === statusFilter)
    }
    if (roleFilter && roleFilter !== 'all') {
      const want = normalizeStoredRoleKey(roleFilter) || roleFilter
      list = list.filter((row) => {
        const roles = Array.isArray(row.roles) && row.roles.length ? row.roles : [row.role]
        return roles.indexOf(want) !== -1 || (want === STORED_ROLE_SUPER && row.isSuperAdmin)
      })
    }
    return { success: true, list, superAdminOpenids: Object.keys(aclSet) }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return fail(`请先在云开发控制台创建集合 ${COLLECTION}`)
    }
    return fail('店员列表加载失败')
  }
}

async function upsertStaff(event, openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, permission: 'manageStaff', adminOpsKey })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const targetOpenid = String((event && event.openid) || '').trim()
  if (!targetOpenid) return fail('请填写店员 openid')
  if (targetOpenid.length < 20) return fail('openid 格式不正确')

  const roles = parseRequestedRoles(event)
  if (!roles.length) return fail('请至少选择一个角色')
  // 仅超管可开通/维持「超管」角色（Admin 走 ADMIN_OPS_KEY 亦视为超管）
  if (hasRole(roles, STORED_ROLE_SUPER) && (!guard.actor || !hasRole(guard.actor, STORED_ROLE_SUPER))) {
    return { success: false, code: 'FORBIDDEN', msg: '仅超管可开通超管权限' }
  }
  let storeIds = normalizeStoreIds(event && event.storeIds)
  let dailyGrantCap = Math.max(0, parseInt((event && event.dailyGrantCap) || 0, 10) || 0)
  if (!rolesWithFieldStoreScope(roles)) {
    storeIds = []
    dailyGrantCap = 0
  }
  const status = (event && event.status) === 'disabled' ? 'disabled' : 'active'
  const primaryRole = pickHighestStoredRole(roles)
  const workspaceRole = workspaceRoleFromStoredRoles(roles)

  let existingRow = null
  try {
    const existingLookup = await db.collection(COLLECTION).where({ openid: targetOpenid }).limit(1).get()
    existingRow = (existingLookup.data && existingLookup.data[0]) || null
  } catch (e) {
    existingRow = null
  }

  let shareholderProfile = null
  if (hasRole(roles, STORED_ROLE_SHAREHOLDER)) {
    shareholderProfile = parseShareholderProfile(event, existingRow)
    if (!shareholderProfile.storeId) {
      return fail('请为股东绑定门店（山川造物 / 星宸标本）')
    }
  } else if (existingRow && existingRow.shareholderProfile) {
    // 取消股东角色时清空配置
    shareholderProfile = null
  }

  // Admin 精简表单若不传 permissions / permissionsExplicit，不得冲掉小程序侧已勾选的细粒度能力
  const eventHasPermPayload = !!(
    event &&
    (Object.prototype.hasOwnProperty.call(event, 'permissions') ||
      Object.prototype.hasOwnProperty.call(event, 'permissionsExplicit'))
  )
  let permissionsExplicit = !!(event && event.permissionsExplicit)
  let permissions = unionPermissionsForStoredRoles(roles, [])
  if (eventHasPermPayload) {
    if (permissionsExplicit && Array.isArray(event.permissions)) {
      const allowed = {}
      featureKeysForRoles(roles).forEach((k) => { allowed[k] = true })
      if (hasRole(roles, STORED_ROLE_SUPER)) {
        permissions = unionPermissionsForStoredRoles(roles, [])
      } else {
        const picked = event.permissions
          .map((k) => String(k || '').trim())
          .filter((k) => k && allowed[k])
        permissions = sanitizePermissions(picked, workspaceRole)
      }
    }
  } else if (existingRow && existingRow.permissionsExplicit) {
    permissionsExplicit = true
    const allowed = {}
    featureKeysForRoles(roles).forEach((k) => { allowed[k] = true })
    const prev = Array.isArray(existingRow.permissions) ? existingRow.permissions : []
    const picked = prev.map((k) => String(k || '').trim()).filter((k) => k && allowed[k])
    permissions = sanitizePermissions(
      picked.length ? picked : featureKeysForRoles(roles),
      workspaceRole
    )
  }

  const data = {
    openid: targetOpenid,
    name: String((event && event.name) || '').trim().slice(0, 20),
    staffNo: String((event && event.staffNo) || '').trim().slice(0, 20),
    role: primaryRole,
    roles,
    storeIds,
    permissions,
    permissionsExplicit: permissionsExplicit || undefined,
    dailyGrantCap,
    shareholderProfile: shareholderProfile || null,
    status,
    updateTime: db.serverDate(),
    updatedBy: openid || 'admin_web'
  }

  try {
    const row = existingRow
    let staffId = ''
    if (row) {
      await db.collection(COLLECTION).doc(row._id).update({ data })
      staffId = row._id
      await syncUserStaffRole(targetOpenid, status === 'active' ? syncRoleForUsers(roles) : '', storeIds)
    } else {
      const added = await db.collection(COLLECTION).add({
        data: { ...data, createTime: db.serverDate(), createdBy: openid }
      })
      staffId = added._id
      await syncUserStaffRole(targetOpenid, status === 'active' ? syncRoleForUsers(roles) : '', storeIds)
    }

    // 超管：active 时并入 ACL；改回店长/店员或停用时移出
    const shouldBeSuper = status === 'active' && hasRole(roles, STORED_ROLE_SUPER)
    const aclSync = await syncTargetInSuperAcl(targetOpenid, shouldBeSuper, openid)

    await writeAuditLog(db, auditFromActor(guard.actor, {
      action: 'staff_upsert',
      relatedId: staffId,
      relatedType: 'staff_members',
      detail: {
        targetOpenid,
        roles,
        role: primaryRole,
        status,
        aclChanged: !!aclSync.changed,
        isSuper: shouldBeSuper
      },
      source: 'manageStaff'
    }))

    const label = rolesDisplayText(roles, false)
    return {
      success: true,
      staffId,
      role: primaryRole,
      roles,
      workspaceRole,
      msg: row ? `已更新为 ${label}` : `已开通 ${label}`
    }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return fail(`请先在云开发控制台创建集合 ${COLLECTION}`)
    }
    console.error('manageStaff upsert', e)
    return fail(e.message || '保存失败')
  }
}

async function removeStaff(event, openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, permission: 'manageStaff', adminOpsKey })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const staffId = String((event && event.staffId) || '').trim()
  if (!staffId) return fail('缺少店员 id')

  try {
    const doc = await db.collection(COLLECTION).doc(staffId).get()
    const row = doc.data
    if (!row) return fail('店员不存在')
    if (openid && row.openid === openid) return fail('不能停用自己的权限')

    await db.collection(COLLECTION).doc(staffId).update({
      data: { status: 'disabled', updateTime: db.serverDate(), updatedBy: openid || 'admin_web' }
    })
    await syncUserStaffRole(row.openid, '', [])
    await syncTargetInSuperAcl(row.openid, false, openid)
    await writeAuditLog(db, auditFromActor(guard.actor, {
      action: 'staff_remove',
      relatedId: staffId,
      relatedType: 'staff_members',
      detail: { targetOpenid: row.openid || '' },
      source: 'manageStaff'
    }))
    return { success: true, msg: '已停用' }
  } catch (e) {
    console.error('manageStaff remove', e)
    return fail(e.message || '停用失败')
  }
}

async function getWorkspaceAcl(openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'manageStaff',
    requireSuperAdmin: true,
    adminOpsKey
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const merged = await resolveSuperAdminOpenids(db)
  let configured = []
  try {
    const res = await db.collection(ACL_COLLECTION).doc(ACL_SUPER_DOC).get()
    configured = Array.isArray((res.data || {}).openids) ? res.data.openids : []
  } catch (e) {
    configured = []
  }
  return {
    success: true,
    hardcoded: SUPER_ADMIN_OPENIDS.slice(),
    configured: configured.map((id) => String(id || '').trim()).filter(Boolean),
    openids: merged,
    note: '硬编码兜底始终生效，不可在此删除；云配置仅追加或移除额外 openid'
  }
}

async function saveWorkspaceAcl(event, openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'manageStaff',
    requireSuperAdmin: true,
    adminOpsKey
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const raw = Array.isArray(event && event.openids) ? event.openids : []
  const configured = []
  const seen = {}
  raw.forEach((id) => {
    const value = String(id || '').trim()
    if (!value || seen[value]) return
    // 硬编码不写入云库（始终兜底）
    if (SUPER_ADMIN_OPENIDS.indexOf(value) !== -1) return
    seen[value] = true
    configured.push(value)
  })

  try {
    const payload = {
      openids: configured,
      updateTime: db.serverDate(),
      updatedBy: openid || 'admin_web'
    }
    try {
      await db.collection(ACL_COLLECTION).doc(ACL_SUPER_DOC).update({ data: payload })
    } catch (e) {
      await db.collection(ACL_COLLECTION).doc(ACL_SUPER_DOC).set({
        data: { ...payload, createTime: db.serverDate() }
      })
    }
    clearSuperAdminOpenidCache()
    const merged = await resolveSuperAdminOpenids(db)
    await writeAuditLog(db, auditFromActor(guard.actor, {
      action: 'workspace_acl_save',
      relatedId: ACL_SUPER_DOC,
      relatedType: ACL_COLLECTION,
      detail: { configuredCount: configured.length, mergedCount: merged.length },
      source: 'manageStaff'
    }))
    return {
      success: true,
      msg: '超管名单已保存',
      hardcoded: SUPER_ADMIN_OPENIDS.slice(),
      configured,
      openids: merged
    }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return fail(`请先在云开发控制台创建集合 ${ACL_COLLECTION}`)
    }
    console.error('manageStaff saveWorkspaceAcl', e)
    return fail(e.message || '保存失败')
  }
}

function actorCanReadArtisanProfile(actor) {
  if (!actor) return false
  if (hasRole(actor, STORED_ROLE_SUPER)) return true
  if (hasRole(actor, ROLE_MANAGER)) return true
  if (hasRole(actor, STORED_ROLE_SPECIMEN_ARTISAN)) return true
  const perms = Array.isArray(actor.permissions) ? actor.permissions : []
  return ARTISAN_READ_PERMISSIONS.some((p) => perms.indexOf(p) !== -1)
}

function framerCreateMs(row) {
  const raw = row && (row.createTime || row._createTime)
  if (!raw) return 0
  if (typeof raw === 'number') return raw
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : 0
}

function pickCanonicalFramer(rows) {
  const list = (rows || []).filter((row) => row && row._id)
  if (!list.length) return null
  return list.slice().sort((a, b) => {
    const ta = framerCreateMs(a)
    const tb = framerCreateMs(b)
    if (ta && tb && ta !== tb) return ta - tb
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

async function findStaffMemberByOpenid(openid) {
  if (!openid) return null
  try {
    const res = await db.collection(COLLECTION).where({ openid }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    console.warn('findStaffMemberByOpenid', e && e.message)
    return null
  }
}

async function pinArtisanFramerId(staffRow, framerId) {
  const id = String(framerId || '').trim()
  if (!staffRow || !staffRow._id || !id) return
  if (String(staffRow.artisanFramerId || '') === id) return
  try {
    await db.collection(COLLECTION).doc(staffRow._id).update({
      data: { artisanFramerId: id, updateTime: db.serverDate() }
    })
  } catch (e) {
    console.warn('pinArtisanFramerId', e && e.message)
  }
}

async function listFramersByStaffOpenid(staffOpenid) {
  if (!staffOpenid) return []
  try {
    const res = await db.collection(FRAMERS_COLLECTION).where({ staffOpenid }).limit(20).get()
    return res.data || []
  } catch (e) {
    console.warn('listFramersByStaffOpenid', e && e.message)
    return []
  }
}

async function findFramerByStaffOpenid(staffOpenid) {
  const rows = await listFramersByStaffOpenid(staffOpenid)
  return pickCanonicalFramer(rows)
}

async function loadFramerById(framerId) {
  const id = String(framerId || '').trim()
  if (!id) return null
  try {
    const doc = await db.collection(FRAMERS_COLLECTION).doc(id).get()
    const row = doc.data
    if (!row) return null
    return { ...row, _id: row._id || id }
  } catch (e) {
    return null
  }
}

async function listFramersByDisplayName(displayName) {
  const name = String(displayName || '').trim()
  if (!name) return []
  try {
    const res = await db.collection(FRAMERS_COLLECTION).where({ name }).limit(20).get()
    return (res.data || []).map((row) => (row && row._id ? { ...row, _id: row._id } : null)).filter(Boolean)
  } catch (e) {
    console.warn('listFramersByDisplayName', e && e.message)
    return []
  }
}

/**
 * 对外主页唯一档案：同一标本师可能有多条 framers（商品挂旧 id、首页展示新 id）。
 * 优先级：staff.artisanFramerId 钉死 > staffOpenid 下最早档案 > 同名且已绑定员工的权威档 > 原 id
 */
async function resolveCanonicalPublicFramer(framerId) {
  const seed = await loadFramerById(framerId)
  if (!seed) return null

  const tryPinned = async (staffOpenid) => {
    const so = String(staffOpenid || '').trim()
    if (!so) return null
    const staff = await findStaffMemberByOpenid(so)
    const pinnedId = staff && String(staff.artisanFramerId || '').trim()
    if (!pinnedId) return null
    return loadFramerById(pinnedId)
  }

  const so = String(seed.staffOpenid || '').trim()
  if (so) {
    const pinned = await tryPinned(so)
    if (pinned) return pinned
    const bound = await findFramerByStaffOpenid(so)
    if (bound) return bound
  }

  const name = String(seed.name || '').trim()
  if (name) {
    const sameName = await listFramersByDisplayName(name)
    const staffBound = sameName.filter((row) => String(row.staffOpenid || '').trim())
    for (let i = 0; i < staffBound.length; i++) {
      const pinned = await tryPinned(staffBound[i].staffOpenid)
      if (pinned) return pinned
    }
    if (staffBound.length) {
      const canon = pickCanonicalFramer(staffBound)
      if (canon) return canon
    }
    const active = sameName.filter((row) => row.active !== false)
    if (active.length === 1) return active[0]
    if (active.length > 1) {
      const canon = pickCanonicalFramer(active)
      if (canon) return canon
    }
  }

  return seed
}

function canClaimFramer(row, openid) {
  if (!row || !openid) return false
  const so = String(row.staffOpenid || '').trim()
  return !so || so === String(openid)
}

/** 无 staffOpenid 绑定时：姓名完全一致且仅一条未绑定档案时自动关联（避免误绑） */
async function findUnboundFramerByDisplayName(displayName) {
  const name = String(displayName || '').trim()
  if (!name || name.length < 2) return null
  try {
    const res = await db.collection(FRAMERS_COLLECTION).where({ name }).limit(8).get()
    const candidates = (res.data || []).filter((row) => {
      if (!row || !row._id) return false
      return !String(row.staffOpenid || '').trim()
    })
    if (candidates.length !== 1) return null
    return candidates[0]
  } catch (e) {
    console.warn('findUnboundFramerByDisplayName', e && e.message)
    return null
  }
}

async function tryAutoBindFramerByDisplayName(openid, displayName) {
  const bound = await findFramerByStaffOpenid(openid)
  if (bound) return bound
  const row = await findUnboundFramerByDisplayName(displayName)
  if (!row) return null
  try {
    await db.collection(FRAMERS_COLLECTION).doc(row._id).update({
      data: { staffOpenid: openid, updateTime: db.serverDate() }
    })
    return { ...row, staffOpenid: openid }
  } catch (e) {
    console.warn('tryAutoBindFramerByDisplayName', e && e.message)
    return null
  }
}

async function detachExtraFramerBindings(openid, keepId) {
  const mine = await listFramersByStaffOpenid(openid)
  const extras = mine.filter((row) => row && row._id && String(row._id) !== String(keepId))
  await Promise.all(extras.map((row) =>
    db.collection(FRAMERS_COLLECTION).doc(row._id).update({
      data: { staffOpenid: '', updateTime: db.serverDate() }
    }).catch(() => {})
  ))
}

/**
 * 读写钉死同一条：staff_members.artisanFramerId > 客户端正在编的 id > 已绑定 > 姓名唯一认领。
 * 不再「见老档案就改写」，避免保存 A、回读 B。
 */
async function resolveFramerForSave(openid, actorName, savedName, clientFramerId, pinnedId) {
  const clientRow = await loadFramerById(clientFramerId)
  if (clientRow && canClaimFramer(clientRow, openid)) return clientRow

  const pinnedRow = await loadFramerById(pinnedId)
  if (pinnedRow && canClaimFramer(pinnedRow, openid)) return pinnedRow

  const bound = await findFramerByStaffOpenid(openid)
  if (bound) return bound

  const bySaved = await findUnboundFramerByDisplayName(savedName)
  if (bySaved && canClaimFramer(bySaved, openid)) return bySaved
  if (actorName && actorName !== savedName) {
    const byActor = await findUnboundFramerByDisplayName(actorName)
    if (byActor && canClaimFramer(byActor, openid)) return byActor
  }
  return null
}

function normalizeFramerType(value) {
  const v = String(value || '').trim()
  if (v === 'partner' || v === 'guest') return 'partner'
  return 'store'
}

function sanitizeStringList(raw, maxItems, maxLen) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  const seen = {}
  list.forEach((item) => {
    const s = String(item || '').trim().slice(0, maxLen || 32)
    if (!s || seen[s]) return
    seen[s] = true
    out.push(s)
  })
  return out.slice(0, maxItems || 20)
}

function formatArtisanProfile(row, fallbackName) {
  if (!row) {
    return {
      framerId: '',
      name: fallbackName || '',
      alias: '',
      title: '',
      bio: '',
      desc: '',
      craftIntro: '',
      avatar: '',
      avatarDisplay: '',
      cover: '',
      coverDisplay: '',
      gallery: [],
      galleryDisplay: [],
      tags: [],
      signatureStyle: '',
      type: 'store',
      city: '',
      yearsExperience: 0,
      joinedAt: '',
      priceDelta: 0,
      extraDays: 0,
      active: true
    }
  }
  const name = Object.prototype.hasOwnProperty.call(row, 'name')
    ? String(row.name || '')
    : (fallbackName || '')
  const gallery = sanitizeStringList(row.gallery, 9, 1024)
  return {
    framerId: row._id || row.framerId || '',
    name,
    alias: row.alias || '',
    title: row.title || '',
    bio: row.bio || row.desc || '',
    desc: row.desc || row.bio || '',
    craftIntro: row.craftIntro || '',
    avatar: row.avatar || '',
    avatarDisplay: row.avatarDisplay || '',
    cover: row.cover || '',
    coverDisplay: row.coverDisplay || '',
    gallery,
    galleryDisplay: Array.isArray(row.galleryDisplay) ? row.galleryDisplay : [],
    tags: sanitizeStringList(row.tags, 12, 16),
    signatureStyle: row.signatureStyle || '',
    active: row.active !== false,
    type: normalizeFramerType(row.type),
    city: row.city || '',
    yearsExperience: row.yearsExperience != null ? parseInt(row.yearsExperience, 10) || 0 : 0,
    joinedAt: row.joinedAt || '',
    priceDelta: row.priceDelta != null ? Number(row.priceDelta) : 0,
    extraDays: row.extraDays != null ? parseInt(row.extraDays, 10) || 0 : 0,
    // 需求 14：是否有资质接受伴宠工单
    petOrderQualified: row.petOrderQualified === true
  }
}

async function toTempUrlMap(fileIds) {
  const ids = sanitizeStringList(fileIds, 50, 1024).filter((id) => id.indexOf('cloud://') === 0)
  if (!ids.length) return {}
  try {
    const res = await cloud.getTempFileURL({ fileList: ids })
    const map = {}
    ;(res.fileList || []).forEach((f) => {
      if (f && f.fileID) map[f.fileID] = f.tempFileURL || f.fileID
    })
    return map
  } catch (e) {
    return {}
  }
}

async function hydrateProfileMedia(profile) {
  const next = { ...(profile || {}) }
  const gallery = sanitizeStringList(next.gallery, 9, 1024)
  const map = await toTempUrlMap([next.avatar, next.cover].concat(gallery))
  next.avatarDisplay = map[next.avatar] || (await toTempUrl(next.avatar || ''))
  next.coverDisplay = map[next.cover] || (await toTempUrl(next.cover || ''))
  next.gallery = gallery
  next.galleryDisplay = gallery.map((fileID) => ({
    fileID,
    url: map[fileID] || fileID
  }))
  return next
}

async function toTempUrl(fileId) {
  const raw = String(fileId || '').trim()
  if (!raw || raw.indexOf('cloud://') !== 0) return raw
  try {
    const res = await cloud.getTempFileURL({ fileList: [raw] })
    const item = res && res.fileList && res.fileList[0]
    return (item && item.tempFileURL) || raw
  } catch (e) {
    return raw
  }
}

async function getArtisanProfile(openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, { role: ROLE_STAFF, adminOpsKey })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }
  if (!actorCanReadArtisanProfile(guard.actor)) {
    return fail('无操作权限', { code: 'FORBIDDEN' })
  }
  const staffRow = await findStaffMemberByOpenid(openid)
  let row = null
  const pinnedId = staffRow && staffRow.artisanFramerId
  if (pinnedId) {
    const pinned = await loadFramerById(pinnedId)
    if (pinned && canClaimFramer(pinned, openid)) row = pinned
  }
  if (!row) row = await findFramerByStaffOpenid(openid)
  if (!row) {
    row = await tryAutoBindFramerByDisplayName(openid, guard.actor.name || '')
  }
  if (row && row._id) {
    await pinArtisanFramerId(staffRow, row._id)
  }
  const profile = await hydrateProfileMedia(formatArtisanProfile(row, guard.actor.name || ''))
  return {
    success: true,
    profile,
    artisanFramerId: (row && row._id) || ''
  }
}

async function saveArtisanProfile(event, openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_STAFF,
    permission: 'manageArtisanProfile',
    adminOpsKey
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const name = String((event && event.name) || '').trim().slice(0, 32)
  if (!name) return fail('请填写展示姓名')
  const alias = String((event && event.alias) || '').trim().slice(0, 32)
  const title = String((event && event.title) || '').trim().slice(0, 40)
  const bio = String((event && event.bio) || '').trim().slice(0, 500)
  const craftIntro = String((event && event.craftIntro) || '').trim().slice(0, 1200)
  const avatar = String((event && event.avatar) || '').trim().slice(0, 1024)
  const cover = String((event && event.cover) || '').trim().slice(0, 1024)
  const gallery = sanitizeStringList(event && event.gallery, 9, 1024)
  const tags = sanitizeStringList(event && event.tags, 12, 16)
  const signatureStyle = String((event && event.signatureStyle) || '').trim().slice(0, 80)
  const city = String((event && event.city) || '').trim().slice(0, 32)
  const yearsExperience = Math.max(0, Math.min(60, parseInt((event && event.yearsExperience) || 0, 10) || 0))
  const joinedAt = String((event && event.joinedAt) || '').trim().slice(0, 16)
  const active = (event && event.active) === false ? false : true
  const type = normalizeFramerType(event && event.type)
  const priceDelta = Math.round((parseFloat(event && event.priceDelta) || 0) * 100) / 100
  const extraDays = Math.max(0, parseInt((event && event.extraDays) || 0, 10) || 0)
  // 需求 14：是否有资质接受伴宠工单（由标本师本人在小程序工作台自行声明）。
  // ⚠️ 刻意用「字段是否出现」判定，而不是 `=== true` 兜底成 false：
  // 旧版小程序客户端不会带这个字段，若一律写 false，会把已声明的资质**静默清掉**。
  const hasPetOrderQualified = !!(event && Object.prototype.hasOwnProperty.call(event, 'petOrderQualified'))
  const petOrderQualified = (event && event.petOrderQualified) === true

  const data = {
    name,
    alias,
    title,
    bio,
    desc: bio,
    craftIntro,
    avatar,
    cover,
    gallery,
    tags,
    signatureStyle,
    city,
    yearsExperience,
    joinedAt,
    active,
    type,
    priceDelta,
    extraDays,
    staffOpenid: openid,
    updateTime: db.serverDate(),
    updatedAt: Date.now()
  }
  // 只在客户端显式携带该字段时才写入，避免旧客户端把已声明的资质清成 false
  if (hasPetOrderQualified) data.petOrderQualified = petOrderQualified

  try {
    const staffRow = await findStaffMemberByOpenid(openid)
    const existing = await resolveFramerForSave(
      openid,
      guard.actor.name || '',
      name,
      event && event.framerId,
      staffRow && staffRow.artisanFramerId
    )
    let framerId = ''
    if (existing && existing._id) {
      await db.collection(FRAMERS_COLLECTION).doc(existing._id).update({ data })
      framerId = existing._id
    } else {
      const added = await db.collection(FRAMERS_COLLECTION).add({
        data: { ...data, createTime: db.serverDate() }
      })
      framerId = added._id
    }
    await detachExtraFramerBindings(openid, framerId)
    await pinArtisanFramerId(staffRow, framerId)
    await writeAuditLog(db, auditFromActor(guard.actor, {
      action: 'artisan_profile_save',
      relatedId: framerId,
      relatedType: FRAMERS_COLLECTION,
      detail: { name, active, claimed: !!(existing && existing._id) },
      source: 'manageStaff'
    })).catch(() => {})

    const fresh = await loadFramerById(framerId)
    const profile = await hydrateProfileMedia(formatArtisanProfile(fresh || {
      _id: framerId,
      ...data
    }, name))
    console.log('saveArtisanProfile readback', {
      openid,
      framerId,
      name: profile.name,
      hasCraftIntro: !!profile.craftIntro,
      active: profile.active
    })
    return {
      success: true,
      framerId,
      profile,
      artisanFramerId: framerId,
      savedAt: Date.now(),
      msg: '已保存'
    }
  } catch (e) {
    console.error('saveArtisanProfile', e)
    return fail(e.message || '保存失败')
  }
}

/**
 * 超管/店长：标本师档案运维列表（含绑定、作品数、同名重复、是否权威）
 */
async function listArtisanAdmin(event, openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, adminOpsKey })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  try {
    let framers = []
    try {
      const res = await db.collection(FRAMERS_COLLECTION).limit(200).get()
      framers = res.data || []
    } catch (e) {
      const res = await db.collection(FRAMERS_COLLECTION).get()
      framers = res.data || []
    }

    let staffRows = []
    try {
      const sRes = await db.collection(COLLECTION).limit(200).get()
      staffRows = sRes.data || []
    } catch (e) {
      console.warn('listArtisanAdmin staff', e && e.message)
    }

    const staffByOpenid = {}
    const staffByPinned = {}
    staffRows.forEach((row) => {
      if (!row || !row.openid) return
      staffByOpenid[row.openid] = row
      const pinned = String(row.artisanFramerId || '').trim()
      if (pinned) staffByPinned[pinned] = row
    })

    const worksByFramer = {}
    try {
      const pRes = await db.collection('products')
        .where({ isOffShelf: _.neq(true) })
        .field({ framerId: true })
        .limit(1000)
        .get()
      ;(pRes.data || []).forEach((p) => {
        const fid = String((p && p.framerId) || '').trim()
        if (!fid) return
        worksByFramer[fid] = (worksByFramer[fid] || 0) + 1
      })
    } catch (e) {
      console.warn('listArtisanAdmin works', e && e.message)
    }

    const nameCount = {}
    framers.forEach((row) => {
      const name = String((row && row.name) || '').trim()
      if (!name) return
      nameCount[name] = (nameCount[name] || 0) + 1
    })

    const list = framers.map((row) => {
      const id = String((row && row._id) || '')
      const name = String((row && row.name) || '').trim() || '未命名标本师'
      const type = normalizeFramerType(row && row.type)
      const staffOpenid = String((row && row.staffOpenid) || '').trim()
      const staffRow = (staffOpenid && staffByOpenid[staffOpenid]) || staffByPinned[id] || null
      const pinnedId = staffRow ? String(staffRow.artisanFramerId || '').trim() : ''
      const isCanonical = !!(pinnedId && pinnedId === id)
      const duplicateCount = nameCount[name] || 1
      const galleryCount = Array.isArray(row.gallery) ? row.gallery.filter(Boolean).length : 0
      const active = row.active !== false
      return {
        _id: id,
        name,
        alias: String((row && row.alias) || '').trim(),
        title: String((row && row.title) || '').trim(),
        type,
        typeLabel: type === 'partner' ? '特邀' : '门店',
        active,
        statusLabel: active ? '上架' : '下架',
        avatar: (row && row.avatar) || '',
        bio: String((row && row.bio) || (row && row.desc) || '').trim(),
        priceDelta: Number(row.priceDelta) || 0,
        extraDays: parseInt(row.extraDays, 10) || 0,
        staffOpenid,
        staffBound: !!(staffOpenid || staffRow),
        staffName: (staffRow && staffRow.name) || '',
        staffOpenidTail: staffOpenid ? staffOpenid.slice(-6) : '',
        staffStatus: (staffRow && staffRow.status) || '',
        artisanFramerId: pinnedId,
        isCanonical,
        isDuplicate: duplicateCount > 1,
        duplicateCount,
        worksCount: worksByFramer[id] || 0,
        galleryCount,
        createTime: row.createTime || null
      }
    })

    list.sort((a, b) => {
      if (a.isDuplicate !== b.isDuplicate) return a.isDuplicate ? -1 : 1
      if (a.active !== b.active) return a.active ? -1 : 1
      return String(a.name).localeCompare(String(b.name), 'zh')
    })

    const staffCandidates = staffRows
      .filter((row) => {
        if (!row || !row.openid || row.status === 'disabled') return false
        const roles = normalizeStoredRoles(row)
        return (
          hasRole(roles, STORED_ROLE_SPECIMEN_ARTISAN) ||
          hasRole(roles, ROLE_MANAGER) ||
          hasRole(roles, STORED_ROLE_SUPER) ||
          String(row.artisanFramerId || '').trim()
        )
      })
      .map((row) => ({
        openid: row.openid,
        name: row.name || '未命名员工',
        openidTail: String(row.openid || '').slice(-6),
        artisanFramerId: String(row.artisanFramerId || '').trim(),
        roleText: rolesDisplayText(normalizeStoredRoles(row), false)
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))

    const duplicateNames = Object.keys(nameCount).filter((n) => nameCount[n] > 1).length
    return {
      success: true,
      list,
      staffCandidates,
      stats: {
        total: list.length,
        active: list.filter((x) => x.active).length,
        bound: list.filter((x) => x.staffBound).length,
        duplicateNames,
        duplicateRows: list.filter((x) => x.isDuplicate).length
      }
    }
  } catch (e) {
    console.error('listArtisanAdmin', e)
    return fail(e.message || '标本师列表加载失败')
  }
}

/**
 * 钉死权威档案：staff_members.artisanFramerId = framerId
 * 可选：停用同名/同人其它档案（最小合并）
 */
async function pinArtisanCanonical(event, openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, adminOpsKey })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const framerId = String((event && (event.framerId || event.id)) || '').trim()
  if (!framerId) return fail('缺少档案 id')
  const framer = await loadFramerById(framerId)
  if (!framer) return fail('标本师档案不存在', { code: 'NOT_FOUND' })

  let staffOpenid = String((event && event.staffOpenid) || framer.staffOpenid || '').trim()
  if (!staffOpenid) return fail('该档案尚未绑定员工，请先绑定后再设为权威档案')

  const staffRow = await findStaffMemberByOpenid(staffOpenid)
  if (!staffRow) return fail('未找到对应员工账号，请先在权限配置中开通')

  // 确保权威档绑定该员工
  if (String(framer.staffOpenid || '') !== staffOpenid) {
    await db.collection(FRAMERS_COLLECTION).doc(framerId).update({
      data: { staffOpenid, updateTime: db.serverDate(), updatedAt: Date.now() }
    })
  }

  await pinArtisanFramerId(staffRow, framerId)
  await detachExtraFramerBindings(staffOpenid, framerId)

  const deactivateOthers = !!(event && event.deactivateOthers)
  let deactivated = []
  if (deactivateOthers) {
    const name = String(framer.name || '').trim()
    const pool = []
    ;(await listFramersByStaffOpenid(staffOpenid)).forEach((f) => pool.push(f))
    if (name) {
      ;(await listFramersByDisplayName(name)).forEach((f) => pool.push(f))
    }
    const seen = {}
    for (let i = 0; i < pool.length; i++) {
      const row = pool[i]
      if (!row || !row._id || seen[row._id]) continue
      seen[row._id] = true
      if (String(row._id) === framerId) continue
      if (row.active === false) continue
      try {
        await db.collection(FRAMERS_COLLECTION).doc(row._id).update({
          data: {
            active: false,
            staffOpenid: '',
            updateTime: db.serverDate(),
            updatedAt: Date.now()
          }
        })
        deactivated.push(row._id)
      } catch (e) {
        console.warn('deactivate duplicate', row._id, e && e.message)
      }
    }
  }

  await writeAuditLog(db, auditFromActor(guard.actor, {
    action: 'artisan_pin_canonical',
    relatedId: framerId,
    relatedType: FRAMERS_COLLECTION,
    detail: { staffOpenid, deactivateOthers, deactivated },
    source: 'manageStaff'
  })).catch(() => {})

  return {
    success: true,
    framerId,
    artisanFramerId: framerId,
    deactivated,
    msg: deactivateOthers
      ? `已设为权威档案${deactivated.length ? `，并停用 ${deactivated.length} 条重复` : ''}`
      : '已设为权威档案'
  }
}

/** 绑定 / 解绑员工到标本师档案 */
async function bindArtisanStaff(event, openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, adminOpsKey })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const framerId = String((event && (event.framerId || event.id)) || '').trim()
  if (!framerId) return fail('缺少档案 id')
  const framer = await loadFramerById(framerId)
  if (!framer) return fail('标本师档案不存在', { code: 'NOT_FOUND' })

  const staffOpenid = String((event && event.staffOpenid) || '').trim()
  const unbind = !staffOpenid || !!(event && event.unbind)

  if (unbind) {
    await db.collection(FRAMERS_COLLECTION).doc(framerId).update({
      data: { staffOpenid: '', updateTime: db.serverDate(), updatedAt: Date.now() }
    })
    const prev = String(framer.staffOpenid || '').trim()
    if (prev) {
      const staffRow = await findStaffMemberByOpenid(prev)
      if (staffRow && String(staffRow.artisanFramerId || '') === framerId) {
        try {
          await db.collection(COLLECTION).doc(staffRow._id).update({
            data: { artisanFramerId: '', updateTime: db.serverDate() }
          })
        } catch (e) {
          console.warn('clear artisanFramerId', e && e.message)
        }
      }
    }
    await writeAuditLog(db, auditFromActor(guard.actor, {
      action: 'artisan_unbind_staff',
      relatedId: framerId,
      relatedType: FRAMERS_COLLECTION,
      detail: { prevStaffOpenid: prev },
      source: 'manageStaff'
    })).catch(() => {})
    return { success: true, framerId, staffOpenid: '', msg: '已解除员工绑定' }
  }

  if (staffOpenid.length < 20) return fail('员工标识不正确')
  const staffRow = await findStaffMemberByOpenid(staffOpenid)
  if (!staffRow) return fail('未找到该员工，请先在权限配置中开通')

  await db.collection(FRAMERS_COLLECTION).doc(framerId).update({
    data: { staffOpenid, updateTime: db.serverDate(), updatedAt: Date.now() }
  })
  await detachExtraFramerBindings(staffOpenid, framerId)
  const pin = (event && event.pin) !== false
  if (pin) await pinArtisanFramerId(staffRow, framerId)

  await writeAuditLog(db, auditFromActor(guard.actor, {
    action: 'artisan_bind_staff',
    relatedId: framerId,
    relatedType: FRAMERS_COLLECTION,
    detail: { staffOpenid, pin },
    source: 'manageStaff'
  })).catch(() => {})

  return {
    success: true,
    framerId,
    staffOpenid,
    artisanFramerId: pin ? framerId : (staffRow.artisanFramerId || ''),
    msg: pin ? '已绑定员工并设为权威档案' : '已绑定员工'
  }
}

/** 上下架标本师档案（对外主页 / 定制可选） */
async function setArtisanActive(event, openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, adminOpsKey })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const framerId = String((event && (event.framerId || event.id)) || '').trim()
  if (!framerId) return fail('缺少档案 id')
  const framer = await loadFramerById(framerId)
  if (!framer) return fail('标本师档案不存在', { code: 'NOT_FOUND' })

  const active = (event && event.active) === false ? false : true
  await db.collection(FRAMERS_COLLECTION).doc(framerId).update({
    data: { active, updateTime: db.serverDate(), updatedAt: Date.now() }
  })

  await writeAuditLog(db, auditFromActor(guard.actor, {
    action: 'artisan_set_active',
    relatedId: framerId,
    relatedType: FRAMERS_COLLECTION,
    detail: { active },
    source: 'manageStaff'
  })).catch(() => {})

  return {
    success: true,
    framerId,
    active,
    msg: active ? '已上架' : '已下架'
  }
}

async function getPublicFramer(event, openid) {
  const id = String((event && (event.framerId || event.id)) || '').trim()
  if (!id) return fail('缺少标本师 id')
  const row = await resolveCanonicalPublicFramer(id)
  if (!row) return fail('标本师档案不存在', { code: 'NOT_FOUND' })

  const canonicalId = String(row._id || id)
  const owned = !!(openid && String(row.staffOpenid || '') === String(openid))
  if (row.active === false && !owned) {
    return fail('标本师已下架', { code: 'HIDDEN' })
  }

  const gallery = sanitizeStringList(row.gallery, 9, 1024)
  const mediaMap = await toTempUrlMap([row.avatar, row.cover].concat(gallery))
  const avatar = mediaMap[row.avatar] || (await toTempUrl(row.avatar || ''))
  const cover = mediaMap[row.cover] || (await toTempUrl(row.cover || ''))
  const galleryDisplay = gallery.map((fileID) => mediaMap[fileID] || fileID)
  let works = []
  try {
    // 作品：权威 id + 历史挂在同名/同人旧 id 上的商品一并收录（去重）
    const aliasIds = new Set([canonicalId, id].filter(Boolean))
    const so = String(row.staffOpenid || '').trim()
    if (so) {
      ;(await listFramersByStaffOpenid(so)).forEach((f) => {
        if (f && f._id) aliasIds.add(String(f._id))
      })
    }
    const name = String(row.name || '').trim()
    if (name) {
      ;(await listFramersByDisplayName(name)).forEach((f) => {
        if (f && f._id) aliasIds.add(String(f._id))
      })
    }
    const idList = Array.from(aliasIds).slice(0, 20)
    const pRes = await db.collection('products')
      .where({
        framerId: _.in(idList),
        isOffShelf: _.neq(true)
      })
      .orderBy('createTime', 'desc')
      .limit(40)
      .get()
    const rows = pRes.data || []
    const fileIds = []
    rows.forEach((item) => {
      const cover = (Array.isArray(item.images) && item.images[0]) || item.coverImage || item.image || ''
      if (cover && String(cover).indexOf('cloud://') === 0) fileIds.push(cover)
    })
    let urlMap = {}
    if (fileIds.length) {
      try {
        const tmp = await cloud.getTempFileURL({ fileList: fileIds.slice(0, 50) })
        ;(tmp.fileList || []).forEach((f) => {
          if (f && f.fileID) urlMap[f.fileID] = f.tempFileURL || f.fileID
        })
      } catch (e) {
        urlMap = {}
      }
    }
    works = rows.map((item) => {
      const raw = (Array.isArray(item.images) && item.images[0]) || item.coverImage || item.image || ''
      return {
        _id: item._id,
        title: item.title || '未命名作品',
        // coverImage 是**临时链**（会过期）；同时给出原始云文件 ID，让客户端优先用它
        coverImage: urlMap[raw] || raw,
        coverFileId: raw,
        images: Array.isArray(item.images) ? item.images.slice(0, 3) : [],
        stock: item.stock,
        collectDate: item.collectDate || ''
      }
    })
    const seenWork = {}
    works = works.filter((item) => {
      const wid = String((item && item._id) || '')
      if (!wid || seenWork[wid]) return false
      seenWork[wid] = true
      return true
    })
  } catch (e) {
    console.warn('getPublicFramer works', e && e.message)
  }

  return {
    success: true,
    framer: {
      _id: canonicalId,
      name: row.name || '标本师',
      alias: row.alias || '',
      title: row.title || '',
      bio: row.bio || row.desc || '',
      craftIntro: row.craftIntro || '',
      avatar,
      cover,
      gallery: galleryDisplay,
      tags: sanitizeStringList(row.tags, 12, 16),
      signatureStyle: row.signatureStyle || '',
      city: row.city || '',
      yearsExperience: row.yearsExperience != null ? parseInt(row.yearsExperience, 10) || 0 : 0,
      joinedAt: row.joinedAt || '',
      type: normalizeFramerType(row.type),
      active: row.active !== false,
      priceDelta: row.priceDelta != null ? Number(row.priceDelta) : 0,
      extraDays: row.extraDays != null ? parseInt(row.extraDays, 10) || 0 : 0,
      resolvedFromId: id !== canonicalId ? id : ''
    },
    works
  }
}

async function getWorkbenchFeatures(openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'manageStaff',
    requireSuperAdmin: true,
    adminOpsKey
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }
  return { success: true, ...getWorkbenchFeatureCatalog() }
}

async function listAuditLogs(event, openid, adminOpsKey) {
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'manageStaff',
    requireSuperAdmin: true,
    adminOpsKey
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const action = String((event && event.actionFilter) || (event && event.logAction) || '').trim()
  const limit = Math.min(100, Math.max(1, parseInt((event && event.limit) || 50, 10) || 50))
  const sinceMs = Number(event && event.sinceMs) > 0 ? Number(event.sinceMs) : 0

  try {
    let query = db.collection('staff_audit_logs')
    const where = {}
    if (action) where.action = action
    if (sinceMs) where.createdAtMs = _.gte(sinceMs)
    if (Object.keys(where).length) query = query.where(where)
    const res = await query.orderBy('createdAtMs', 'desc').limit(limit).get()
    const list = (res.data || []).map((row) => ({
      _id: row._id,
      openid: row.openid || '',
      openidTail: String(row.openid || '').slice(-8),
      workspaceRole: row.workspaceRole || '',
      role: row.role || '',
      action: row.action || '',
      relatedId: row.relatedId || '',
      relatedType: row.relatedType || '',
      detail: row.detail || {},
      source: row.source || '',
      createdAtMs: row.createdAtMs || 0,
      createdAt: row.createdAt || null
    }))
    return { success: true, list }
  } catch (e) {
    if (/collection|集合|index|索引/i.test(e.message || '')) {
      return fail('审计日志不可用：请确认已创建集合 staff_audit_logs 及索引')
    }
    console.error('manageStaff listAuditLogs', e)
    return fail(e.message || '加载审计失败')
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''
  const adminOpsKey = event && event.adminOpsKey

  if (!openid && !adminOpsKey) return fail('请先登录')

  const action = (event && event.action) || 'whoami'
  try {
    switch (action) {
      case 'whoami':
        return await whoami(openid, adminOpsKey)
      case 'verifyUiGate':
        return await verifyUiGate(event, openid)
      case 'list':
        return await listStaff(event, openid, adminOpsKey)
      case 'upsert':
        return await upsertStaff(event, openid, adminOpsKey)
      case 'remove':
        return await removeStaff(event, openid, adminOpsKey)
      case 'lookupByPhone':
        return await lookupByPhone(event, openid, adminOpsKey)
      case 'getWorkspaceAcl':
        return await getWorkspaceAcl(openid, adminOpsKey)
      case 'saveWorkspaceAcl':
        return await saveWorkspaceAcl(event, openid, adminOpsKey)
      case 'listAuditLogs':
        return await listAuditLogs(event, openid, adminOpsKey)
      case 'getArtisanProfile':
        return await getArtisanProfile(openid, adminOpsKey)
      case 'saveArtisanProfile':
        return await saveArtisanProfile(event, openid, adminOpsKey)
      case 'getPublicFramer':
        return await getPublicFramer(event, openid)
      case 'listArtisanAdmin':
        return await listArtisanAdmin(event, openid, adminOpsKey)
      case 'pinArtisanCanonical':
        return await pinArtisanCanonical(event, openid, adminOpsKey)
      case 'bindArtisanStaff':
        return await bindArtisanStaff(event, openid, adminOpsKey)
      case 'setArtisanActive':
        return await setArtisanActive(event, openid, adminOpsKey)
      case 'getWorkbenchFeatures':
        return await getWorkbenchFeatures(openid, adminOpsKey)
      default:
        return fail(`未知 action: ${action}`)
    }
  } catch (e) {
    console.error('manageStaff', action, e)
    return fail(e.message || '操作失败')
  }
}
