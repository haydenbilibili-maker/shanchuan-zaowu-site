/**
 * 门店角色鉴权 — 复制到每个管理类云函数目录，保持同名同内容
 * （云函数之间不共享目录，沿用 refundPolicy.js 的复制约定）
 *
 * 三级工作台（workspaceRole）：
 *   super_admin   超管 — 硬编码 openid 白名单，承接全部后台能力
 *   store_manager 店长 — 经营必要能力（账本/订单侧配套、积分、发票等）
 *   store_staff       店员 — 仅核销、赠分、签到等高频现场操作
 *   specimen_artisan  标本师 — 藏品/内容侧（见 SPECIMEN_ARTISAN_PERMISSIONS）
 *   live_host         直播主播 — 直播场次（manageLiveSession / manageLive）
 *   investor          投资人 — 只读观测台（财务汇总 + 小程序数据大盘，无写操作）
 *   shareholder       股东 — 只读股东观测台（权益/分红/占股口径，无写操作）
 *
 * staff_members：roles[] 为 canonical 多角色；role 为最高权限角色（兼容旧读法）
 * UI 与能力裁剪看 workspaceRole（最高）+ permissions（多角色并集 + 自定义）
 * 小程序 Hub「经营 / 工作室 / 会员 / 组织 / 门店现场」分组见主包 utils/workspaceRoles.js → HUB_MENU_SECTIONS
 * （分组只影响入口展示，不改变本文件权限判定）
 *
 * 解析优先级（强校验，不 fail-open）：
 *   1. 超管 openid 白名单 → super_admin
 *   2. Admin Web ADMIN_OPS_KEY → super_admin
 *   3. 集合 staff_members（status='active'）
 *   4. users.isAdmin === true → store_manager
 *   5. 环境变量 MESSAGE_ADMIN_OPENIDS → store_manager（兼容旧配置，非超管）
 */
const ROLE_MANAGER = 'manager'
const ROLE_STAFF = 'staff'
const ROLE_INVESTOR = 'investor'
const ROLE_SHAREHOLDER = 'shareholder'
const ROLE_RANK = { [ROLE_STAFF]: 1, [ROLE_MANAGER]: 2 }

const WORKSPACE_SUPER_ADMIN = 'super_admin'
const WORKSPACE_STORE_MANAGER = 'store_manager'
const WORKSPACE_STORE_STAFF = 'store_staff'
const WORKSPACE_SPECIMEN_ARTISAN = 'specimen_artisan'
const WORKSPACE_LIVE_HOST = 'live_host'
const WORKSPACE_INVESTOR = 'investor'
const WORKSPACE_SHAREHOLDER = 'shareholder'

const STORED_ROLE_SUPER = 'super_admin'
const STORED_ROLE_SPECIMEN_ARTISAN = 'specimen_artisan'
const STORED_ROLE_LIVE_HOST = 'live_host'
const STORED_ROLE_INVESTOR = 'investor'
const STORED_ROLE_SHAREHOLDER = 'shareholder'

/** 库内 stored role 优先级（高 → 低），用于 role / workspaceRole 兼容字段 */
const STORED_ROLE_PRIORITY = {
  [STORED_ROLE_SUPER]: 100,
  [ROLE_MANAGER]: 80,
  [STORED_ROLE_INVESTOR]: 70,
  [STORED_ROLE_SHAREHOLDER]: 68,
  [STORED_ROLE_SPECIMEN_ARTISAN]: 60,
  [STORED_ROLE_LIVE_HOST]: 50,
  [ROLE_STAFF]: 10
}

const SUPER_ADMIN_OPENIDS = [
  'oa22s5ZcMY7xkQDlNW8X8jaYy46M',
  'oa22s5RuZSXOCRQtXzdrVEiT1JuY'
]

/** 云库可配超管 openid：workspace_acl / super_admins.openids；与硬编码合并，硬编码始终兜底 */
const ACL_COLLECTION = 'workspace_acl'
const ACL_SUPER_DOC = 'super_admins'
const SUPER_OID_CACHE_TTL_MS = 60 * 1000
let _superOidCache = { at: 0, list: null }

async function loadConfiguredSuperAdminOpenids(db) {
  if (!db) return []
  try {
    const res = await db.collection(ACL_COLLECTION).doc(ACL_SUPER_DOC).get()
    const row = res.data || {}
    const list = Array.isArray(row.openids) ? row.openids : []
    return list.map((id) => String(id || '').trim()).filter(Boolean)
  } catch (e) {
    return []
  }
}

async function resolveSuperAdminOpenids(db) {
  const now = Date.now()
  if (_superOidCache.list && now - _superOidCache.at < SUPER_OID_CACHE_TTL_MS) {
    return _superOidCache.list
  }
  const hardcoded = SUPER_ADMIN_OPENIDS.slice()
  const fromDb = await loadConfiguredSuperAdminOpenids(db)
  const merged = []
  const seen = {}
  hardcoded.concat(fromDb).forEach((id) => {
    if (!seen[id]) {
      seen[id] = true
      merged.push(id)
    }
  })
  _superOidCache = { at: now, list: merged }
  return merged
}

function clearSuperAdminOpenidCache() {
  _superOidCache = { at: 0, list: null }
}

function getSuperAdminOpenids() {
  return SUPER_ADMIN_OPENIDS.slice()
}

/** 同步：仅硬编码（无 db 时的兜底） */
function isSuperAdminOpenid(openid) {
  if (!openid) return false
  return SUPER_ADMIN_OPENIDS.indexOf(String(openid)) !== -1
}

async function isSuperAdminOpenidAsync(db, openid) {
  if (!openid) return false
  const list = await resolveSuperAdminOpenids(db)
  return list.indexOf(String(openid)) !== -1
}

const STAFF_PERMISSIONS = [
  'verifyMemberPass',
  'verifyBooking',
  'verifyStoreCoupon',
  'verifyGiftPickup',
  'verifyOrderPickup',
  'grantStorePoints',
  'viewOwnRecords',
  'viewStoreVisits',
  'staffAttendance',
  'storeTodo',
  'viewPayslip',
  'submitReimbursement'
]

/** 请假审批：店长审店员/标本师/主播；店长本人请假由超管审（见 leaveReview 逻辑） */
const LEAVE_REVIEW_PERMISSION = 'leaveReview'

/** 仅超管：装修、内容开关、运费、积分规则、人员、数据、推送、财务等 */
const SUPER_ADMIN_ONLY_PERMISSIONS = [
  'manageStaff',
  'manageStoreConfig',
  'manageContentDisplayFlags',
  'manageShippingRules',
  'manageStorePointRules',
  'viewAnalytics',
  'pushMessage',
  'syncFinanceData',
  'manageHonoraryCurators',
  'manageMemberLevelAdjust',
  'moderateContent',
  'manageWelcomeGift',
  'manageBookingRules',
  'manageStoredValueConfig',
  'manageSupportConfig',
  'manageMemberLevels',
  'manageGift',
  'manageArtisanCommission',
  'manageStudioSettlement'
]

/** 店长：现场 + 发分撤销/发票等经营必要能力（不含超管专属；规则配置仅超管） */
const STORE_MANAGER_PERMISSIONS = STAFF_PERMISSIONS.concat([
  'revokeStorePoints',
  'viewStoreRecords',
  'manageInvoiceRequests',
  'manageProducts',
  'manageLive',
  'reimburseReview',
  LEAVE_REVIEW_PERMISSION,
  'giftOps'
])

/**
 * 标本师默认权限：藏品录入、个人主页、个人作品（不含经营与超管配置）
 * staffAttendance：与店员共用考勤/请假页
 */
const SPECIMEN_ARTISAN_PERMISSIONS = [
  'manageProducts',
  'manageArtisanProfile',
  'manageArtisanWorks',
  'viewOwnRecords',
  'viewPayslip',
  'staffAttendance'
]

/** 直播主播：直播场次 + 考勤/请假 + 基础只读 */
const LIVE_HOST_PERMISSIONS = [
  'manageLive',
  'viewOwnRecords',
  'viewPayslip',
  'staffAttendance'
]

/**
 * 投资人：只读观测权限（财务账本级汇总 + 小程序数据大盘）
 * 不含记一笔/删账/对账、CRM、改价、发货、核销、内容开关等写操作
 */
const INVESTOR_PERMISSIONS = [
  'viewInvestorFinance',
  'viewInvestorAnalytics'
]

const INVESTOR_READ_PERMISSIONS = INVESTOR_PERMISSIONS.slice()

/**
 * 股东：只读股东观测台（对齐财务核算「股东权益与回报 / 分红 / 汇报摘要」）
 * 不含经营写操作；数据按绑定门店与占股/分成比例裁剪
 */
const SHAREHOLDER_PERMISSIONS = [
  'viewShareholderObservatory'
]

const SHAREHOLDER_READ_PERMISSIONS = SHAREHOLDER_PERMISSIONS.slice()

/** 超管 / 历史全量 manager 权限名（含超管专属） */
const MANAGER_PERMISSIONS = STORE_MANAGER_PERMISSIONS.concat(SUPER_ADMIN_ONLY_PERMISSIONS)

const MSG_NOT_LOGGED_IN = '请先登录'
const MSG_NO_PERMISSION = '无操作权限'
const MSG_NO_STORE_PERMISSION = '无该门店的操作权限'
const MSG_SUPER_ADMIN_ONLY = '该操作仅超管可用'
const MSG_ADMIN_UNCONFIGURED =
  '管理员尚未配置：请在云开发控制台为本云函数配置环境变量 MESSAGE_ADMIN_OPENIDS（填入店长 openid，多个用英文逗号分隔），或在 staff_members 集合中登记账号'

function getAdminOpenids() {
  const env = process.env.MESSAGE_ADMIN_OPENIDS || ''
  return env.split(',').map((s) => s.trim()).filter(Boolean)
}

function isSpecimenArtisanRole(value) {
  const v = String(value || '').trim()
  return v === STORED_ROLE_SPECIMEN_ARTISAN || v === WORKSPACE_SPECIMEN_ARTISAN
}

function isLiveHostRole(value) {
  const v = String(value || '').trim()
  return v === STORED_ROLE_LIVE_HOST || v === WORKSPACE_LIVE_HOST
}

function isInvestorRole(value) {
  const v = String(value || '').trim()
  return v === STORED_ROLE_INVESTOR || v === WORKSPACE_INVESTOR || v === ROLE_INVESTOR
}

function isShareholderRole(value) {
  const v = String(value || '').trim()
  return v === STORED_ROLE_SHAREHOLDER || v === WORKSPACE_SHAREHOLDER || v === ROLE_SHAREHOLDER
}

function normalizeStoredRoleKey(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  if (value === STORED_ROLE_SUPER || value === WORKSPACE_SUPER_ADMIN || value === 'superAdmin') {
    return STORED_ROLE_SUPER
  }
  if (value === ROLE_MANAGER || value === 'owner' || value === 'admin' || value === WORKSPACE_STORE_MANAGER) {
    return ROLE_MANAGER
  }
  if (value === ROLE_STAFF || value === 'clerk' || value === WORKSPACE_STORE_STAFF) return ROLE_STAFF
  if (isSpecimenArtisanRole(value)) return STORED_ROLE_SPECIMEN_ARTISAN
  if (isLiveHostRole(value)) return STORED_ROLE_LIVE_HOST
  if (isInvestorRole(value)) return STORED_ROLE_INVESTOR
  if (isShareholderRole(value)) return STORED_ROLE_SHAREHOLDER
  return ''
}

/** 从 staff_members 文档归一化 roles[]（合并 legacy role） */
function normalizeStoredRoles(record) {
  const set = {}
  const push = (raw) => {
    const key = normalizeStoredRoleKey(raw)
    if (key) set[key] = true
  }
  if (record && Array.isArray(record.roles)) {
    record.roles.forEach(push)
  }
  if (record && record.role) push(record.role)
  return Object.keys(set)
}

function pickHighestStoredRole(roles) {
  let best = ''
  let score = -1
  ;(roles || []).forEach((r) => {
    const s = STORED_ROLE_PRIORITY[r] || 0
    if (s > score) {
      score = s
      best = r
    }
  })
  return best
}

function workspaceRoleFromStoredRoles(roles) {
  const highest = pickHighestStoredRole(roles)
  if (highest === STORED_ROLE_SUPER) return WORKSPACE_SUPER_ADMIN
  if (highest === ROLE_MANAGER) return WORKSPACE_STORE_MANAGER
  if (highest === STORED_ROLE_INVESTOR) return WORKSPACE_INVESTOR
  if (highest === STORED_ROLE_SHAREHOLDER) return WORKSPACE_SHAREHOLDER
  if (highest === STORED_ROLE_SPECIMEN_ARTISAN) return WORKSPACE_SPECIMEN_ARTISAN
  if (highest === STORED_ROLE_LIVE_HOST) return WORKSPACE_LIVE_HOST
  if (highest === ROLE_STAFF) return WORKSPACE_STORE_STAFF
  return ''
}

function syncRankRoleFromStoredRoles(roles) {
  const highest = pickHighestStoredRole(roles)
  if (highest === STORED_ROLE_SUPER || highest === ROLE_MANAGER) return ROLE_MANAGER
  return ROLE_STAFF
}

/**
 * 是否拥有某 stored / workspace 角色。
 * @param {string[]|object} rolesOrActor  roles 数组，或 resolveActor 返回的 actor
 * @param {string} target 如 super_admin | manager | staff | specimen_artisan | live_host | investor | workspace 常量
 */
function hasRole(rolesOrActor, target) {
  const roles = Array.isArray(rolesOrActor)
    ? rolesOrActor
    : (rolesOrActor && Array.isArray(rolesOrActor.roles) ? rolesOrActor.roles : [])
  const actor = Array.isArray(rolesOrActor) ? null : rolesOrActor
  if (actor && actor.superAdmin) return true

  const t = String(target || '').trim()
  const list = roles || []

  const has = (key) => list.indexOf(key) !== -1

  if (t === STORED_ROLE_SUPER || t === WORKSPACE_SUPER_ADMIN) {
    return has(STORED_ROLE_SUPER)
  }
  if (t === ROLE_MANAGER || t === WORKSPACE_STORE_MANAGER) {
    return has(ROLE_MANAGER) || has(STORED_ROLE_SUPER)
  }
  if (t === ROLE_STAFF || t === WORKSPACE_STORE_STAFF) {
    return has(ROLE_STAFF) || has(ROLE_MANAGER) || has(STORED_ROLE_SUPER)
  }
  if (isSpecimenArtisanRole(t)) {
    return has(STORED_ROLE_SPECIMEN_ARTISAN) || has(STORED_ROLE_SUPER)
  }
  if (isLiveHostRole(t)) {
    return has(STORED_ROLE_LIVE_HOST) || has(STORED_ROLE_SUPER)
  }
  if (isInvestorRole(t)) {
    return has(STORED_ROLE_INVESTOR) || has(STORED_ROLE_SUPER)
  }
  if (isShareholderRole(t)) {
    return has(STORED_ROLE_SHAREHOLDER) || has(STORED_ROLE_SUPER)
  }
  return has(t)
}

function defaultPermissionsForStoredRole(storedRole) {
  if (storedRole === STORED_ROLE_SUPER) return MANAGER_PERMISSIONS.slice()
  if (storedRole === STORED_ROLE_SPECIMEN_ARTISAN) return SPECIMEN_ARTISAN_PERMISSIONS.slice()
  if (storedRole === STORED_ROLE_LIVE_HOST) return LIVE_HOST_PERMISSIONS.slice()
  if (storedRole === STORED_ROLE_INVESTOR) return INVESTOR_PERMISSIONS.slice()
  if (storedRole === STORED_ROLE_SHAREHOLDER) return SHAREHOLDER_PERMISSIONS.slice()
  if (storedRole === ROLE_MANAGER) return STORE_MANAGER_PERMISSIONS.slice()
  if (storedRole === ROLE_STAFF) return STAFF_PERMISSIONS.slice()
  return []
}

function unionPermissionsForStoredRoles(roles, customPermissions) {
  const set = {}
  const addList = (arr) => {
    ;(arr || []).forEach((p) => {
      if (p) set[p] = true
    })
  }
  ;(roles || []).forEach((r) => addList(defaultPermissionsForStoredRole(r)))
  addList(Array.isArray(customPermissions) ? customPermissions : [])
  return Object.keys(set)
}

function normalizeRole(role) {
  const value = String(role || '').trim()
  if (
    value === ROLE_MANAGER ||
    value === 'owner' ||
    value === 'admin' ||
    value === WORKSPACE_SUPER_ADMIN ||
    value === WORKSPACE_STORE_MANAGER
  ) {
    return ROLE_MANAGER
  }
  if (value === ROLE_STAFF || value === 'clerk' || value === WORKSPACE_STORE_STAFF) return ROLE_STAFF
  if (
    isSpecimenArtisanRole(value) ||
    isLiveHostRole(value) ||
    isInvestorRole(value) ||
    isShareholderRole(value)
  ) {
    return ROLE_STAFF
  }
  return ''
}

function defaultPermissions(role, workspaceRole) {
  if (workspaceRole === WORKSPACE_SUPER_ADMIN || (role === ROLE_MANAGER && workspaceRole === WORKSPACE_SUPER_ADMIN)) {
    return MANAGER_PERMISSIONS.slice()
  }
  if (workspaceRole === WORKSPACE_SPECIMEN_ARTISAN) {
    return SPECIMEN_ARTISAN_PERMISSIONS.slice()
  }
  if (workspaceRole === WORKSPACE_LIVE_HOST) {
    return LIVE_HOST_PERMISSIONS.slice()
  }
  if (workspaceRole === WORKSPACE_INVESTOR) {
    return INVESTOR_PERMISSIONS.slice()
  }
  if (workspaceRole === WORKSPACE_SHAREHOLDER) {
    return SHAREHOLDER_PERMISSIONS.slice()
  }
  if (role === ROLE_MANAGER || workspaceRole === WORKSPACE_STORE_MANAGER) {
    return STORE_MANAGER_PERMISSIONS.slice()
  }
  return STAFF_PERMISSIONS.slice()
}

/** 非超管一律剥离超管专属权限点（自定义 permissions 也不得越权） */
function sanitizePermissions(permissions, workspaceRole) {
  const list = Array.isArray(permissions) ? permissions.filter(Boolean) : []
  if (workspaceRole === WORKSPACE_SUPER_ADMIN) {
    const set = {}
    MANAGER_PERMISSIONS.forEach((p) => { set[p] = true })
    list.forEach((p) => { if (p) set[p] = true })
    return Object.keys(set)
  }
  return list.filter((p) => SUPER_ADMIN_ONLY_PERMISSIONS.indexOf(p) === -1)
}

function normalizeStoreIds(value) {
  if (!Array.isArray(value)) return []
  return value.map((id) => String(id || '').trim()).filter(Boolean)
}

/**
 * 新权限点兼容：历史 permissionsExplicit 记录在拆分/增补前不含新 key。
 * - 曾挂在 verifyBooking 上的券核销 / 礼赠自提 → 自动补齐
 * - 超管 / 店长 / 店员：默认具备门店代金券核销（现场高频，不因旧勾选名单漏掉）
 * - 店长经营能力集 → 自动补齐 giftOps（履约看板）
 * - 标本师：显式勾选常只保留店长能力集，漏掉档案/薪酬/作品 → 补齐工作室默认能力
 */
function applyPermissionBridges(permissions, roles) {
  const set = {}
  ;(permissions || []).forEach((p) => {
    if (p) set[p] = true
  })
  if (set.verifyBooking) {
    set.verifyStoreCoupon = true
    set.verifyGiftPickup = true
  }

  const roleList = roles || []
  const isFieldVerifier =
    roleList.indexOf(ROLE_STAFF) !== -1 ||
    roleList.indexOf(ROLE_MANAGER) !== -1 ||
    roleList.indexOf(STORED_ROLE_SUPER) !== -1
  if (isFieldVerifier) {
    set.verifyStoreCoupon = true
  }

  const isMgr =
    roleList.indexOf(ROLE_MANAGER) !== -1 ||
    roleList.indexOf(STORED_ROLE_SUPER) !== -1
  if (
    isMgr &&
    (set.manageProducts ||
      set.revokeStorePoints ||
      set.manageInvoiceRequests ||
      set.reimburseReview ||
      set.leaveReview ||
      set.giftOps)
  ) {
    set.giftOps = true
  }

  // 合法标本师：工作室「档案 / 薪酬 / 作品 / 考勤」为角色基线，不因多角色显式勾选遗漏而隐藏
  if (roleList.indexOf(STORED_ROLE_SPECIMEN_ARTISAN) !== -1) {
    SPECIMEN_ARTISAN_PERMISSIONS.forEach((p) => {
      if (p) set[p] = true
    })
  }
  return Object.keys(set)
}

function resolvePermissionsForStaffRecord(staffRecord) {
  const roles = normalizeStoredRoles(staffRecord || {})
  const workspaceRole = workspaceRoleFromStoredRoles(roles)
  const custom = Array.isArray(staffRecord.permissions) ? staffRecord.permissions.filter(Boolean) : []
  let resolved
  if (staffRecord.permissionsExplicit && custom.length) {
    resolved = sanitizePermissions(custom, workspaceRole)
  } else if (custom.length) {
    resolved = sanitizePermissions(unionPermissionsForStoredRoles(roles, custom), workspaceRole)
  } else {
    resolved = sanitizePermissions(unionPermissionsForStoredRoles(roles, []), workspaceRole)
  }
  return applyPermissionBridges(resolved, roles)
}

function buildActor(base) {
  const roles = Array.isArray(base.roles) ? base.roles.filter(Boolean) : []
  const role = base.role || syncRankRoleFromStoredRoles(roles) || ROLE_STAFF
  const superAdmin = !!base.superAdmin || hasRole({ roles, superAdmin: base.superAdmin }, STORED_ROLE_SUPER)
  const workspaceRole =
    base.workspaceRole ||
    workspaceRoleFromStoredRoles(roles) ||
    (superAdmin
      ? WORKSPACE_SUPER_ADMIN
      : role === ROLE_MANAGER
        ? WORKSPACE_STORE_MANAGER
        : WORKSPACE_STORE_STAFF)

  let permissions = Array.isArray(base.permissions) ? base.permissions.filter(Boolean) : []
  if (base.permissionsResolved) {
    permissions = sanitizePermissions(permissions, workspaceRole)
  } else if (!permissions.length && roles.length) {
    permissions = unionPermissionsForStoredRoles(roles, [])
  } else if (!permissions.length) {
    permissions = defaultPermissions(role, workspaceRole)
  } else if (roles.length) {
    permissions = unionPermissionsForStoredRoles(roles, permissions)
  }
  permissions = applyPermissionBridges(
    sanitizePermissions(permissions, workspaceRole),
    roles
  )

  return {
    ok: true,
    openid: base.openid || '',
    role,
    roles,
    workspaceRole,
    staffId: base.staffId || '',
    name: base.name || '',
    staffNo: base.staffNo || '',
    storeIds: normalizeStoreIds(base.storeIds),
    permissions,
    dailyGrantCap: Number(base.dailyGrantCap) > 0 ? Number(base.dailyGrantCap) : 0,
    superAdmin,
    source: base.source || '',
    adminConfigured: !!base.adminConfigured
  }
}

function buildActorFromStaffRecord(staffRecord, adminConfigured) {
  const roles = normalizeStoredRoles(staffRecord)
  const isSuper = hasRole(roles, STORED_ROLE_SUPER)
  const workspaceRole = workspaceRoleFromStoredRoles(roles)
  const permissions = resolvePermissionsForStaffRecord(staffRecord)

  return buildActor({
    openid: staffRecord.openid,
    role: syncRankRoleFromStoredRoles(roles),
    roles,
    workspaceRole,
    staffId: staffRecord._id,
    name: staffRecord.name || '',
    staffNo: staffRecord.staffNo || '',
    storeIds: isSuper ? [] : normalizeStoreIds(staffRecord.storeIds),
    permissions,
    permissionsResolved: true,
    dailyGrantCap: Number(staffRecord.dailyGrantCap) > 0 ? Number(staffRecord.dailyGrantCap) : 0,
    superAdmin: isSuper,
    source: 'staff_members',
    adminConfigured
  })
}

async function resolveActor(db, openid, options = {}) {
  const envAdmins = getAdminOpenids()
  const adminConfigured = envAdmins.length > 0 || SUPER_ADMIN_OPENIDS.length > 0

  const opsKey = process.env.ADMIN_OPS_KEY || ''
  if (opsKey && options.adminOpsKey && String(options.adminOpsKey) === opsKey) {
    return buildActor({
      openid: openid || 'admin_web',
      role: ROLE_MANAGER,
      roles: [STORED_ROLE_SUPER],
      workspaceRole: WORKSPACE_SUPER_ADMIN,
      name: 'Admin Web',
      storeIds: [],
      permissions: MANAGER_PERMISSIONS.slice(),
      superAdmin: true,
      source: 'admin_ops_key',
      adminConfigured: true
    })
  }

  // Admin 代理传入了 adminOpsKey 但未命中：勿误报「请先登录」（口令会话 ≠ 微信 openid）
  if (options.adminOpsKey) {
    if (!opsKey) {
      return {
        ok: false,
        code: 'ADMIN_OPS_KEY_MISSING',
        msg: '云函数未配置 ADMIN_OPS_KEY，Admin 运维鉴权无法完成',
        adminConfigured
      }
    }
    return {
      ok: false,
      code: 'ADMIN_OPS_KEY_INVALID',
      msg: 'Admin 运维密钥不匹配（请对齐 Cloudflare Pages 与云函数 ADMIN_OPS_KEY）',
      adminConfigured
    }
  }

  if (!openid) {
    return { ok: false, code: 'NOT_LOGGED_IN', msg: MSG_NOT_LOGGED_IN, adminConfigured }
  }

  const inSuperAcl = await isSuperAdminOpenidAsync(db, openid)

  let staffRecord = null
  try {
    const res = await db.collection('staff_members').where({ openid, status: 'active' }).limit(1).get()
    staffRecord = (res.data && res.data[0]) || null
  } catch (e) {
    console.warn('staffGuard staff_members lookup failed:', e.message)
  }

  if (staffRecord) {
    let roles = normalizeStoredRoles(staffRecord)
    if (inSuperAcl && roles.indexOf(STORED_ROLE_SUPER) === -1) {
      roles = roles.concat([STORED_ROLE_SUPER])
    }
    const isSuper = inSuperAcl || hasRole(roles, STORED_ROLE_SUPER)
    const workspaceRole = workspaceRoleFromStoredRoles(roles)
    const permissions = resolvePermissionsForStaffRecord(staffRecord)

    return buildActor({
      openid: staffRecord.openid,
      role: syncRankRoleFromStoredRoles(roles),
      roles,
      workspaceRole,
      staffId: staffRecord._id,
      name: staffRecord.name || '',
      staffNo: staffRecord.staffNo || '',
      storeIds: isSuper ? [] : normalizeStoreIds(staffRecord.storeIds),
      permissions,
      permissionsResolved: true,
      dailyGrantCap: Number(staffRecord.dailyGrantCap) > 0 ? Number(staffRecord.dailyGrantCap) : 0,
      superAdmin: isSuper,
      source: inSuperAcl && staffRecord ? 'staff_members+super_acl' : 'staff_members',
      adminConfigured
    })
  }

  if (inSuperAcl) {
    return buildActor({
      openid,
      role: ROLE_MANAGER,
      roles: [STORED_ROLE_SUPER],
      workspaceRole: WORKSPACE_SUPER_ADMIN,
      storeIds: [],
      permissions: MANAGER_PERMISSIONS.slice(),
      superAdmin: true,
      source: 'super_admin_whitelist',
      adminConfigured
    })
  }

  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const user = (res.data && res.data[0]) || null
    if (user && user.isAdmin === true) {
      return buildActor({
        openid,
        role: ROLE_MANAGER,
        roles: [ROLE_MANAGER],
        workspaceRole: WORKSPACE_STORE_MANAGER,
        name: user.nickName || '',
        storeIds: [],
        permissions: STORE_MANAGER_PERMISSIONS.slice(),
        superAdmin: false,
        source: 'users.isAdmin',
        adminConfigured
      })
    }
  } catch (e) {
    console.warn('staffGuard users lookup failed:', e.message)
  }

  if (adminConfigured && envAdmins.indexOf(openid) !== -1) {
    return buildActor({
      openid,
      role: ROLE_MANAGER,
      roles: [ROLE_MANAGER],
      workspaceRole: WORKSPACE_STORE_MANAGER,
      storeIds: [],
      permissions: STORE_MANAGER_PERMISSIONS.slice(),
      superAdmin: false,
      source: 'env',
      adminConfigured
    })
  }

  return {
    ok: false,
    code: adminConfigured ? 'FORBIDDEN' : 'ADMIN_UNCONFIGURED',
    msg: adminConfigured ? MSG_NO_PERMISSION : MSG_ADMIN_UNCONFIGURED,
    adminConfigured
  }
}

function canOperateStore(actor, storeId) {
  if (!storeId) return true
  // 超管：全部门店（含 Admin 历史 storeId 别名）
  if (actor.superAdmin || hasRole(actor, STORED_ROLE_SUPER)) return true
  if (!actor.storeIds || !actor.storeIds.length) return true
  const sid = String(storeId)
  if (actor.storeIds.indexOf(sid) !== -1) return true
  // 主店别名互通：库内配了主店任一 ID 即可操作主店实体
  const MAIN_IDS = ['store_shanhaizaowu', 'store_1780146782017_6w0okpr']
  if (MAIN_IDS.indexOf(sid) !== -1) {
    return actor.storeIds.some((id) => MAIN_IDS.indexOf(String(id)) !== -1)
  }
  return false
}

function actorHasAnyStaffMembership(actor) {
  return !!(actor && Array.isArray(actor.roles) && actor.roles.length)
}

/** 现场/经营类角色（不含纯投资人） */
function actorHasOperationalMembership(actor) {
  if (!actor) return false
  return (
    hasRole(actor, ROLE_STAFF) ||
    hasRole(actor, ROLE_MANAGER) ||
    hasRole(actor, STORED_ROLE_SUPER) ||
    hasRole(actor, STORED_ROLE_SPECIMEN_ARTISAN) ||
    hasRole(actor, STORED_ROLE_LIVE_HOST)
  )
}

function isInvestorReadPermission(permission) {
  return INVESTOR_READ_PERMISSIONS.indexOf(String(permission || '').trim()) !== -1
}

function isShareholderReadPermission(permission) {
  return SHAREHOLDER_READ_PERMISSIONS.indexOf(String(permission || '').trim()) !== -1
}

function isObservatoryReadPermission(permission) {
  return isInvestorReadPermission(permission) || isShareholderReadPermission(permission)
}

/** 仅持有投资人、无任何经营角色 */
function isInvestorOnlyActor(actor) {
  return !!(actor && hasRole(actor, STORED_ROLE_INVESTOR) && !actorHasOperationalMembership(actor))
}

/** 仅持有股东（可兼投资人）、无任何经营角色 */
function isShareholderOnlyActor(actor) {
  return !!(actor && hasRole(actor, STORED_ROLE_SHAREHOLDER) && !actorHasOperationalMembership(actor))
}

/** 纯观测台角色：投资人 / 股东，无经营写权限 */
function isObservatoryOnlyActor(actor) {
  if (!actor || actorHasOperationalMembership(actor)) return false
  return hasRole(actor, STORED_ROLE_INVESTOR) || hasRole(actor, STORED_ROLE_SHAREHOLDER)
}

/**
 * @param {object} options.role             最低角色 'staff' | 'manager'
 * @param {string} options.permission       权限点
 * @param {string} options.storeId          门店
 * @param {boolean} options.requireSuperAdmin 仅超管
 */
async function assertStaff(db, openid, options = {}) {
  const actor = await resolveActor(db, openid, options)
  if (!actor.ok) return actor

  if (options.requireSuperAdmin && !hasRole(actor, STORED_ROLE_SUPER)) {
    return { ok: false, code: 'FORBIDDEN', msg: MSG_SUPER_ADMIN_ONLY }
  }

  // 纯观测台角色：一律拒绝写操作 / 经营接口；仅允许观测台只读权限点
  if (isObservatoryOnlyActor(actor)) {
    if (!options.permission || !isObservatoryReadPermission(options.permission)) {
      const msg = isShareholderOnlyActor(actor) && !hasRole(actor, STORED_ROLE_INVESTOR)
        ? '股东仅可查看股东观测台数据'
        : '投资人/股东仅可查看观测台数据'
      return { ok: false, code: 'FORBIDDEN', msg }
    }
    if (actor.permissions.indexOf(options.permission) === -1) {
      return { ok: false, code: 'FORBIDDEN', msg: MSG_NO_PERMISSION }
    }
    if (!canOperateStore(actor, options.storeId)) {
      return { ok: false, code: 'FORBIDDEN', msg: MSG_NO_STORE_PERMISSION }
    }
    return { ok: true, actor }
  }

  // 观测台只读权限：不要求店长角色（可与其它角色并存）
  if (options.permission && isObservatoryReadPermission(options.permission)) {
    if (!hasRole(actor, STORED_ROLE_SUPER) && actor.permissions.indexOf(options.permission) === -1) {
      return { ok: false, code: 'FORBIDDEN', msg: MSG_NO_PERMISSION }
    }
    if (!canOperateStore(actor, options.storeId)) {
      return { ok: false, code: 'FORBIDDEN', msg: MSG_NO_STORE_PERMISSION }
    }
    return { ok: true, actor }
  }

  const minRole = normalizeRole(options.role) || ROLE_STAFF
  if (minRole === ROLE_MANAGER) {
    if (!hasRole(actor, ROLE_MANAGER)) {
      return { ok: false, code: 'FORBIDDEN', msg: '该操作仅店长可用' }
    }
  } else if (minRole === ROLE_STAFF) {
    const okStaff =
      hasRole(actor, ROLE_STAFF) ||
      hasRole(actor, STORED_ROLE_SPECIMEN_ARTISAN) ||
      hasRole(actor, STORED_ROLE_LIVE_HOST) ||
      actorHasOperationalMembership(actor)
    if (!okStaff && (ROLE_RANK[actor.role] || 0) < (ROLE_RANK[minRole] || 0)) {
      return { ok: false, code: 'FORBIDDEN', msg: MSG_NO_PERMISSION }
    }
  }

  if (options.permission) {
    if (SUPER_ADMIN_ONLY_PERMISSIONS.indexOf(options.permission) !== -1 && !hasRole(actor, STORED_ROLE_SUPER)) {
      return { ok: false, code: 'FORBIDDEN', msg: MSG_SUPER_ADMIN_ONLY }
    }
    if (!hasRole(actor, STORED_ROLE_SUPER) && actor.permissions.indexOf(options.permission) === -1) {
      return { ok: false, code: 'FORBIDDEN', msg: MSG_NO_PERMISSION }
    }
  }

  if (!canOperateStore(actor, options.storeId)) {
    return { ok: false, code: 'FORBIDDEN', msg: MSG_NO_STORE_PERMISSION }
  }

  return { ok: true, actor }
}

module.exports = {
  ROLE_MANAGER,
  ROLE_STAFF,
  ROLE_INVESTOR,
  ROLE_SHAREHOLDER,
  WORKSPACE_SUPER_ADMIN,
  WORKSPACE_STORE_MANAGER,
  WORKSPACE_STORE_STAFF,
  WORKSPACE_SPECIMEN_ARTISAN,
  WORKSPACE_LIVE_HOST,
  WORKSPACE_INVESTOR,
  WORKSPACE_SHAREHOLDER,
  STORED_ROLE_SUPER,
  STORED_ROLE_SPECIMEN_ARTISAN,
  STORED_ROLE_LIVE_HOST,
  STORED_ROLE_INVESTOR,
  STORED_ROLE_SHAREHOLDER,
  SUPER_ADMIN_OPENIDS,
  SUPER_ADMIN_ONLY_PERMISSIONS,
  STAFF_PERMISSIONS,
  STORE_MANAGER_PERMISSIONS,
  SPECIMEN_ARTISAN_PERMISSIONS,
  LIVE_HOST_PERMISSIONS,
  INVESTOR_PERMISSIONS,
  INVESTOR_READ_PERMISSIONS,
  SHAREHOLDER_PERMISSIONS,
  SHAREHOLDER_READ_PERMISSIONS,
  MANAGER_PERMISSIONS,
  isSpecimenArtisanRole,
  isLiveHostRole,
  isInvestorRole,
  isShareholderRole,
  isInvestorReadPermission,
  isShareholderReadPermission,
  isObservatoryReadPermission,
  isInvestorOnlyActor,
  isShareholderOnlyActor,
  isObservatoryOnlyActor,
  ACL_COLLECTION,
  ACL_SUPER_DOC,
  MSG_ADMIN_UNCONFIGURED,
  MSG_SUPER_ADMIN_ONLY,
  getSuperAdminOpenids,
  isSuperAdminOpenid,
  isSuperAdminOpenidAsync,
  resolveSuperAdminOpenids,
  clearSuperAdminOpenidCache,
  getAdminOpenids,
  normalizeRole,
  normalizeStoredRoleKey,
  normalizeStoredRoles,
  pickHighestStoredRole,
  workspaceRoleFromStoredRoles,
  hasRole,
  unionPermissionsForStoredRoles,
  defaultPermissions,
  sanitizePermissions,
  resolvePermissionsForStaffRecord,
  resolveActor,
  canOperateStore,
  assertStaff
}
