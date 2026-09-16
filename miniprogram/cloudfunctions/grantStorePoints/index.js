/**
 * 门店消费赠积分与成长值
 *
 * action: identifyMember | preview | grant | approve | reject | revoke | listRecords | dailySummary
 *
 * 门店消费入账：
 *   - users.bonusPoints / storePointsTotal：可用积分（+calcPoints）
 *   - users.storeGrowthValue：会员成长值（与积分同额，影响等级；不并入可用积分公式以免双计）
 * 店员 grant → pending_approval，店长 approve 后才入账；店长/超管可直接入账。
 * 原子性策略：store_purchases.dedupeKey 唯一索引挡重复 + point_records pending 状态机 + 人工补偿，
 * 不引入云开发事务。
 */
const cloud = require('wx-server-sdk')
const { assertStaff: _assertStaff, ROLE_MANAGER, ROLE_STAFF } = require('./staffGuard')
const { writeAuditLog, auditFromActor } = require('./auditLog')
const { ACTION, APPROVER_MANAGER, APPROVER_SUPER, actorWorkspaceRole } = require('./approvalRules')
const { enqueueApproval, markApprovalDecided } = require('./approvalBridge')
const { checkImageBuffer, checkText } = require('./contentSecurity')
// 来源判定统一真源（含本函数「店员券核销报请先登录」事故说明）
const {
  isNonClientSource,
  isInternalSource,
  sourceSegments
} = require('./sourceOrigin')

function assertStaff(db, openid, options = {}) {
  const opts = { ...(options || {}) }
  // Admin Web 经 callFunction 注入 adminOpsKey；入口会挂到 globalThis.__adminOpsKey
  if (opts.adminOpsKey == null && globalThis.__grantStoreAdminOpsKey) {
    opts.adminOpsKey = globalThis.__grantStoreAdminOpsKey
  }
  return _assertStaff(db, openid, opts)
}

const { normalizeConfig, calcPoints, describeRule, isModuleEnabled } = require('./defaults')
const { loadBalance, loadUserDoc, ensureUserDoc } = require('./pointsBalance')
const { dispatchInAppMessage } = require('./inAppMessage')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PURCHASES = 'store_purchases'
const POINT_RECORDS = 'point_records'
const RULES = 'store_point_rules'
const TOKENS = 'member_pass_tokens'

const STATUS_GRANTED = 'granted'
const STATUS_REVOKED = 'revoked'
const STATUS_PARTIAL = 'partial_revoked'
const STATUS_PENDING = 'pending_approval'
const STATUS_REJECTED = 'rejected'
const ACTIVE_STATUSES = [STATUS_GRANTED, STATUS_PARTIAL]
const QUOTA_STATUSES = [STATUS_GRANTED, STATUS_PARTIAL, STATUS_PENDING]

const REVOKE_REASONS = ['refund', 'wrong_amount', 'wrong_user', 'abuse', 'other']
const REVOKE_REASON_TEXT = {
  refund: '门店退货',
  wrong_amount: '金额录错',
  wrong_user: '顾客录错',
  abuse: '异常发放',
  other: '其他调整'
}

function fail(msg, extra) {
  return { success: false, msg, ...(extra || {}) }
}

function maskPhone(phone) {
  const value = String(phone || '')
  if (value.length < 7) return ''
  return value.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

function buildMemberNo(openid) {
  if (!openid || openid.length < 8) return 'MT-0000-0000'
  const shortId = openid.substr(openid.length - 8).toUpperCase()
  return `MT-${shortId.substr(0, 4)}-${shortId.substr(4, 4)}`
}

function startOfLocalDayMs() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function toMs(value) {
  if (!value) return 0
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value.getTime === 'function') return value.getTime()
  const n = Date.parse(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * 金额规整到两位小数，非法返回 null。
 */
function parseAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  const rounded = Math.round(n * 100) / 100
  return rounded > 0 ? rounded : null
}

function parseToken(event) {
  const direct = String((event && event.memberToken) || (event && event.token) || '').trim()
  if (direct) return direct
  const raw = String((event && (event.qrPayload || event.scanResult)) || '').trim()
  if (!raw) return ''
  if (raw[0] === '{') {
    try {
      const obj = JSON.parse(raw)
      return String((obj && obj.token) || '').trim()
    } catch (e) {
      return ''
    }
  }
  const uri = raw.match(/[?&]token=([A-Za-z0-9_-]+)/)
  return uri ? uri[1] : ''
}

// ---------------------------------------------------------------- 规则

async function loadRuleConfig(storeId) {
  try {
    const res = await db.collection(RULES)
      .where({ status: 'active' })
      .orderBy('priority', 'desc')
      .limit(20)
      .get()
    const rows = res.data || []
    const scoped = storeId
      ? rows.find((row) => Array.isArray(row.storeIds) && row.storeIds.indexOf(storeId) !== -1)
      : null
    const global = rows.find((row) => !Array.isArray(row.storeIds) || !row.storeIds.length)
    return normalizeConfig(scoped || global || {})
  } catch (e) {
    console.warn('grantStorePoints loadRuleConfig fallback:', e.message)
    return normalizeConfig({})
  }
}

// ---------------------------------------------------------------- 顾客识别

/**
 * 直接读 member_pass_tokens 拿顾客 openid。
 * getMemberPass.verify 不返回 openid，且店长后台 Tab3 依赖其现有返回结构，故不改动它。
 */
async function resolveMemberByToken(token) {
  if (!token) return { ok: false, msg: '未识别到会员码' }
  let rec = null
  try {
    const res = await db.collection(TOKENS).where({ token }).limit(1).get()
    rec = (res.data && res.data[0]) || null
  } catch (e) {
    return { ok: false, msg: '会员码服务未就绪' }
  }
  if (!rec) return { ok: false, msg: '会员码无效，请让顾客刷新' }
  if (Date.now() > toMs(rec.expiresAt)) {
    return { ok: false, expired: true, msg: '会员码已过期（60 秒有效），请让顾客刷新' }
  }
  return { ok: true, openid: rec.openid, memberNo: rec.memberNo || buildMemberNo(rec.openid) }
}

async function buildMemberCard(memberOpenid) {
  const user = await loadUserDoc(db, memberOpenid)
  const balance = await loadBalance(db, memberOpenid, user)
  const amount2 = (v) => {
    const n = Number(v) || 0
    return Math.round(n * 100) / 100
  }
  return {
    memberNo: buildMemberNo(memberOpenid),
    nickName: (user && user.nickName) || '藏家',
    phoneMasked: maskPhone(user && user.phone),
    points: balance.displayAvailable,
    storeSpendTotal: amount2(user && user.storeSpendTotal),
    onlineSpendTotal: amount2(user && user.onlineSpendTotal),
    platformSpendTotal: amount2(user && user.platformSpendTotal),
    storePointsTotal: Number((user && user.storePointsTotal) || 0) || 0,
    pointsDebt: Number((user && user.pointsDebt) || 0) || 0
  }
}

async function identifyMember(event) {
  const phoneTail = String((event && event.phoneTail) || '').trim()
  const token = parseToken(event)

  if (token) {
    const resolved = await resolveMemberByToken(token)
    if (!resolved.ok) return { success: false, expired: !!resolved.expired, msg: resolved.msg }
    const card = await buildMemberCard(resolved.openid)
    return {
      success: true,
      member: { openid: resolved.openid, identifyMethod: 'scan_member_code', ...card }
    }
  }

  if (phoneTail) {
    if (!/^\d{4}$/.test(phoneTail)) return fail('请输入手机号后 4 位')
    let rows = []
    try {
      const res = await db.collection('users')
        .where({ phone: db.RegExp({ regexp: `${phoneTail}$`, options: '' }) })
        .limit(5)
        .get()
      rows = res.data || []
    } catch (e) {
      return fail('顾客查询失败，请改用扫会员码')
    }
    if (!rows.length) return fail('未找到匹配顾客，请让顾客出示会员码')
    const candidates = rows.map((user) => ({
      openid: user._openid,
      identifyMethod: 'phone_search',
      memberNo: buildMemberNo(user._openid),
      nickName: user.nickName || '藏家',
      phoneMasked: maskPhone(user.phone),
      // 可用积分需汇总线上订单，此处不逐个查库；选定顾客后由 preview 返回准确余额
      storeSpendTotal: Number(user.storeSpendTotal || 0) || 0
    }))
    return { success: true, candidates }
  }

  // 手机号候选已选定：按 openid 拉完整会员卡（含可用积分）
  const targetOpenid = String((event && event.targetOpenid) || '').trim()
  if (targetOpenid) {
    const user = await loadUserDoc(db, targetOpenid)
    if (!user) return fail('顾客不存在或尚未登录过小程序')
    const card = await buildMemberCard(targetOpenid)
    return {
      success: true,
      member: {
        openid: targetOpenid,
        identifyMethod: String((event && event.identifyMethod) || 'phone_search'),
        ...card
      }
    }
  }

  return fail('请扫会员码或输入手机号后 4 位')
}

// ---------------------------------------------------------------- 配额

async function sumTodayPurchases(where, statuses) {
  const statusList = statuses || ACTIVE_STATUSES
  try {
    const res = await db.collection(PURCHASES)
      .where({ ...where, status: _.in(statusList), createTime: _.gte(new Date(startOfLocalDayMs())) })
      .limit(1000)
      .get()
    const rows = res.data || []
    let points = 0
    let amount = 0
    rows.forEach((row) => {
      points += Number(row.pointsGranted || 0) - Number(row.revokedPoints || 0)
      amount += Number(row.amount || 0) - Number(row.revokedAmount || 0)
    })
    return { count: rows.length, points, amount }
  } catch (e) {
    console.warn('grantStorePoints sumTodayPurchases failed:', e.message)
    return { count: 0, points: 0, amount: 0, unavailable: true }
  }
}

/**
 * 三层闸门：单笔金额上限、用户单日上限、门店单日上限；店员另有个人上限。
 * @param {object} [opts]
 * @param {boolean} [opts.approvalPath] 券核销/强制待审：日笔数与积分上限只计已入账，
 *   不把 pending 算进「店员录入」硬限，以便仍能提交店长审核。
 */
async function checkQuota(config, actor, memberOpenid, storeId, points, opts) {
  const approvalPath = !!(opts && opts.approvalPath)
  // 手动赠分：配额计入待审，避免店员连提撑破日限
  // 核销待审旁路：只计已入账/部分撤销，pending 不挡提交审核
  const quotaStatuses = approvalPath ? ACTIVE_STATUSES : QUOTA_STATUSES
  const userToday = await sumTodayPurchases({ memberOpenid }, quotaStatuses)
  const storeToday = storeId ? await sumTodayPurchases({ storeId }, quotaStatuses) : { count: 0, points: 0 }

  if (config.dailyRecordCapPerUser > 0 && userToday.count >= config.dailyRecordCapPerUser) {
    return { ok: false, msg: `该顾客今日已录入 ${userToday.count} 笔，超出单日 ${config.dailyRecordCapPerUser} 笔上限` }
  }
  if (config.dailyPointsCapPerUser > 0 && userToday.points + points > config.dailyPointsCapPerUser) {
    return { ok: false, msg: `该顾客今日赠分将超出上限 ${config.dailyPointsCapPerUser} 分（已发 ${userToday.points} 分）` }
  }
  if (config.dailyPointsCapPerStore > 0 && storeToday.points + points > config.dailyPointsCapPerStore) {
    return { ok: false, msg: `本店今日额度已用尽（上限 ${config.dailyPointsCapPerStore} 分，已发 ${storeToday.points} 分）` }
  }
  if (actor.dailyGrantCap > 0) {
    const staffToday = await sumTodayPurchases({ operatorOpenid: actor.openid }, quotaStatuses)
    if (staffToday.points + points > actor.dailyGrantCap) {
      return { ok: false, msg: `您今日发放额度已用尽（上限 ${actor.dailyGrantCap} 分）` }
    }
  }

  const storeRemaining = config.dailyPointsCapPerStore > 0
    ? Math.max(0, config.dailyPointsCapPerStore - storeToday.points)
    : 0

  return { ok: true, userToday, storeToday, storeRemaining }
}

/** 小票附图 fileID，最多 3 张（对齐小票认领） */
function normalizeReceiptImages(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = {}
  raw.forEach((item) => {
    const id = String(item || '').trim()
    if (!id || seen[id]) return
    if (!/^cloud:\/\//.test(id) && !/^https?:\/\//i.test(id)) return
    seen[id] = true
    out.push(id)
  })
  return out.slice(0, 3)
}

// ---------------------------------------------------------------- preview

async function resolveTarget(event) {
  const token = parseToken(event)
  if (token) {
    const resolved = await resolveMemberByToken(token)
    if (!resolved.ok) return { ok: false, msg: resolved.msg, expired: !!resolved.expired }
    return { ok: true, openid: resolved.openid, identifyMethod: 'scan_member_code' }
  }
  const targetOpenid = String((event && event.targetOpenid) || '').trim()
  if (!targetOpenid) return { ok: false, msg: '未指定顾客' }
  const user = await loadUserDoc(db, targetOpenid)
  if (!user) return { ok: false, msg: '顾客不存在或尚未登录过小程序' }
  return { ok: true, openid: targetOpenid, identifyMethod: String((event && event.identifyMethod) || 'phone_search') }
}

async function previewGrant(event, openid) {
  const storeId = String((event && event.storeId) || '').trim()
  const guard = await assertStaff(db, openid, { role: ROLE_STAFF, permission: 'grantStorePoints', storeId })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const config = await loadRuleConfig(storeId)
  if (!isModuleEnabled(config, 'storePurchase')) {
    return fail('门店消费赠分模块已关闭')
  }
  const amount = parseAmount(event && event.amount)
  if (amount === null) return fail('请输入正确的消费金额')
  if (amount > config.maxAmountPerRecord) {
    return fail(`单笔金额不得超过 ¥${config.maxAmountPerRecord}`)
  }

  const target = await resolveTarget(event)
  if (!target.ok) return { success: false, expired: !!target.expired, msg: target.msg }
  if (target.openid === openid) return fail('不能给自己发放门店积分')

  const calc = calcPoints(config, amount)
  const quota = await checkQuota(config, guard.actor, target.openid, storeId, calc.points)

  return {
    success: true,
    amount,
    points: calc.points,
    growthValue: calc.points,
    times: calc.times,
    ruleText: describeRule(config),
    ruleSnapshot: calc.ruleSnapshot,
    quotaOk: quota.ok,
    quotaMsg: quota.ok ? '' : quota.msg,
    storeRemaining: quota.storeRemaining || 0,
    member: await buildMemberCard(target.openid),
    memberOpenid: target.openid,
    requiresApproval: guard.actor.role !== ROLE_MANAGER && !guard.actor.superAdmin
  }
}

// ---------------------------------------------------------------- grant

function buildDedupeKey(storeId, receiptNo, clientRequestId) {
  if (receiptNo) return `${storeId}:${receiptNo}`
  return `${storeId}:auto:${clientRequestId}`
}

function isDuplicateKeyError(e) {
  const msg = (e && (e.message || e.errMsg)) || ''
  return /duplicate|E11000|已存在|unique/i.test(msg)
}

function purchaseToBrief(row) {
  const images = normalizeReceiptImages(row.receiptImages || row.imageFileIds || [])
  return {
    purchaseId: row._id,
    amount: row.amount,
    pointsGranted: row.pointsGranted,
    status: row.status,
    receiptNo: row.receiptNo || '',
    imageFileIds: images,
    receiptImages: images,
    createTime: row.createTime
  }
}

async function creditPurchasePoints(purchaseId, row, config) {
  const points = Number(row.pointsGranted) || 0
  const amount = Number(row.amount) || 0
  const memberOpenid = row.memberOpenid

  // 门店消费累计与积分解耦：按消费单只记一次。
  // 未达赠分门槛（如不足 ¥1、取整为 0 分）的到店消费同样计入，否则累计会漏账。
  let spendCounted = false
  if (amount > 0 && !Number(row.spendCountedAt)) {
    try {
      const spendUser = await loadUserDoc(db, memberOpenid)
      const spendDocId = spendUser ? spendUser._id : await ensureUserDoc(db, memberOpenid)
      await db.collection('users').doc(spendDocId).update({
        data: { storeSpendTotal: _.inc(amount) }
      })
      await db.collection(PURCHASES).doc(purchaseId).update({
        data: { spendCountedAt: Date.now() }
      })
      spendCounted = true
    } catch (e) {
      console.warn('creditPurchasePoints storeSpendTotal failed:', e && e.message)
    }
  }

  if (points <= 0) {
    return {
      success: true,
      purchaseId,
      pointsGranted: 0,
      spendCounted,
      msg: `已记录消费，${describeRule(config)}，本笔未达赠分门槛`,
      ruleText: describeRule(config)
    }
  }

  let recordId = ''
  try {
    const added = await db.collection(POINT_RECORDS).add({
      data: {
        _openid: row.operatorOpenid || '',
        userOpenid: memberOpenid,
        type: 'earn',
        source: 'store_purchase',
        action: 'store_purchase',
        points,
        title: `门店消费 ¥${amount}`,
        refCollection: PURCHASES,
        refId: purchaseId,
        dedupeKey: `grant:${purchaseId}`,
        status: 'pending',
        storeId: row.storeId,
        operatorOpenid: row.operatorOpenid || '',
        dateStr: new Date().toISOString().slice(0, 10),
        expireTime: null,
        createTime: db.serverDate()
      }
    })
    recordId = added._id
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      // 已入账过，视为成功
      const balance = await loadBalance(db, memberOpenid)
      return {
        success: true,
        purchaseId,
        pointsGranted: points,
        balanceAfter: balance.displayAvailable,
        duplicated: true,
        msg: '该笔已入账'
      }
    }
    console.error('grantStorePoints add point_record', e)
    return fail('积分流水写入失败，请联系店长补发')
  }

  try {
    const memberUser = await loadUserDoc(db, memberOpenid)
    const userDocId = memberUser ? memberUser._id : await ensureUserDoc(db, memberOpenid)
    await db.collection('users').doc(userDocId).update({
      data: {
        bonusPoints: _.inc(points),
        storePointsTotal: _.inc(points),
        storeGrowthValue: _.inc(points)
        // 门店消费累计已在上方按消费单记一次，此处不再重复累加
      }
    })
  } catch (e) {
    console.error('grantStorePoints inc bonusPoints', e)
    return fail('积分入账失败，请稍后重试')
  }

  const balance = await loadBalance(db, memberOpenid)
  try {
    await db.collection(POINT_RECORDS).doc(recordId).update({
      data: { status: 'done', balanceAfter: balance.displayAvailable }
    })
  } catch (e) {
    console.warn('grantStorePoints finalize record failed:', e.message)
  }

  if (config.notifyUser) {
    try {
      await dispatchInAppMessage(db, {
        eventType: 'store_points_granted',
        openid: memberOpenid,
        relatedId: purchaseId,
        vars: {
          storeName: row.storeName || '门店',
          amount: String(amount),
          points: String(points),
          balance: String(balance.displayAvailable)
        }
      })
    } catch (e) {
      console.warn('store_points_granted message skipped:', e.message)
    }
  }

  return {
    success: true,
    purchaseId,
    pointsGranted: points,
    growthGranted: points,
    balanceAfter: balance.displayAvailable,
    ruleText: describeRule(config),
    msg: `已赠送 ${points} 积分与 ${points} 成长值`
  }
}

async function grantPoints(event, openid) {
  const storeId = String((event && event.storeId) || '').trim()
  if (!storeId) return fail('缺少门店')

  // 门店券核销联动赠分：已在 verifyStoreCoupon 鉴权，此处认 verifyStoreCoupon 权限
  const fromCouponRedeem = !!(event && event._fromCouponRedeem)
  // 核销来源强制待审（即使店长/超管操作也不直通入账）；手动赠分仍按角色直通
  const forcePending = fromCouponRedeem
    || !!(event && (event.forcePending || event.requireApproval))
  const permission = fromCouponRedeem ? 'verifyStoreCoupon' : 'grantStorePoints'
  const guard = await assertStaff(db, openid, { role: ROLE_STAFF, permission, storeId })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }
  const actor = guard.actor
  const canDirectGrant = !forcePending && (actor.role === ROLE_MANAGER || actor.superAdmin)

  const clientRequestId = String((event && event.clientRequestId) || '').trim()
  const receiptNo = String((event && event.receiptNo) || '').trim().slice(0, 40)
  if (!receiptNo && !clientRequestId) return fail('缺少小票号，且未生成请求标识')

  const config = await loadRuleConfig(storeId)
  if (!isModuleEnabled(config, 'storePurchase')) {
    return fail('门店消费赠分模块已关闭')
  }
  const amount = parseAmount(event && event.amount)
  if (amount === null) return fail('请输入正确的消费金额')
  if (amount > config.maxAmountPerRecord) return fail(`单笔金额不得超过 ¥${config.maxAmountPerRecord}`)

  const target = await resolveTarget(event)
  if (!target.ok) return { success: false, expired: !!target.expired, msg: target.msg }
  const memberOpenid = target.openid
  if (memberOpenid === openid) return fail('不能给自己发放门店积分')

  const dedupeKey = buildDedupeKey(storeId, receiptNo, clientRequestId)
  const userCouponId = fromCouponRedeem
    ? String((event && event.userCouponId) || '').trim().slice(0, 64)
    : ''

  try {
    const dup = await db.collection(PURCHASES).where({ dedupeKey }).limit(1).get()
    if (dup.data && dup.data.length) {
      const row = dup.data[0]
      return {
        success: true,
        duplicated: true,
        granted: 0,
        pendingApproval: row.status === STATUS_PENDING,
        previewPoints: Number(row.pointsGranted) || 0,
        msg: row.status === STATUS_PENDING
          ? '该笔已提交待审，请等待店长审核'
          : '该笔消费已录入，未重复赠分',
        ...purchaseToBrief(row)
      }
    }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return fail(`请先在云开发控制台创建集合 ${PURCHASES}`)
    }
    return fail('幂等校验失败，请稍后重试')
  }

  const receiptImages = normalizeReceiptImages(
    (event && (event.receiptImages || event.imageFileIds || event.images)) || []
  )
  // 券核销带金额：必须附图，写入采购单与审批 payload 供审核台审阅
  if (fromCouponRedeem && amount > 0 && !receiptImages.length) {
    return fail('请上传小票照片后再提交积分')
  }

  const calc = calcPoints(config, amount)
  // 券核销/强制待审：日上限只计已入账，避免店员录入笔数挡住核销提交审核
  const quota = await checkQuota(config, actor, memberOpenid, storeId, calc.points, {
    approvalPath: forcePending || fromCouponRedeem
  })
  if (!quota.ok) return fail(quota.msg)

  const memberUser = await loadUserDoc(db, memberOpenid)
  const status = canDirectGrant ? STATUS_GRANTED : STATUS_PENDING
  const purchaseData = {
    memberOpenid,
    memberNo: buildMemberNo(memberOpenid),
    memberPhone: maskPhone(memberUser && memberUser.phone),
    memberName: (memberUser && memberUser.nickName) || '',
    storeId,
    storeName: String((event && event.storeName) || '').trim(),
    amount,
    receiptNo,
    dedupeKey,
    pointsGranted: calc.points,
    ruleSnapshot: calc.ruleSnapshot,
    identifyMethod: fromCouponRedeem ? 'coupon_redeem' : target.identifyMethod,
    source: fromCouponRedeem ? 'coupon_redeem' : 'manual',
    userCouponId: userCouponId || '',
    receiptImages,
    imageFileIds: receiptImages,
    operatorOpenid: openid,
    operatorName: actor.name || '',
    operatorRole: actor.role,
    status,
    revokedAmount: 0,
    revokedPoints: 0,
    revokeSeq: 0,
    remark: String((event && event.remark) || '').trim().slice(0, 200),
    clientRequestId,
    createTime: db.serverDate()
  }

  let purchaseId = ''
  try {
    const added = await db.collection(PURCHASES).add({ data: purchaseData })
    purchaseId = added._id
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      const again = await db.collection(PURCHASES).where({ dedupeKey }).limit(1).get()
      const row = (again.data && again.data[0]) || null
      return {
        success: true,
        duplicated: true,
        granted: 0,
        msg: '该笔消费已录入，未重复赠分',
        ...(row ? purchaseToBrief(row) : {})
      }
    }
    console.error('grantStorePoints add purchase', e)
    return fail(e.message || '消费记录写入失败')
  }

  if (!canDirectGrant) {
    try {
      // 店长/超管作为申请人时，pointsFamily 默认 resolveApproverRole→null（不写审批单）。
      // 核销强制待审须显式指定 approverRole，否则会只落 pending 采购单、无审批队列。
      const enqueueOpts = {
        actionType: ACTION.POINTS_STORE_GRANT,
        applicantOpenid: openid,
        applicantName: actor.name || '',
        applicantRole: actor.role || '',
        applicantWorkspaceRole: actor.workspaceRole || 'store_staff',
        relatedId: purchaseId,
        storeId,
        title: fromCouponRedeem ? `券核销赠分 ¥${amount}` : `门店赠分 ¥${amount}`,
        summary: fromCouponRedeem
          ? `券核销联动 · 预计 +${calc.points} 分 · ${purchaseData.memberName || purchaseData.memberNo || ''}`
          : `预计 +${calc.points} 分 · ${purchaseData.memberName || purchaseData.memberNo || ''}`,
        payload: {
          purchaseId,
          amount,
          points: calc.points,
          memberOpenid,
          receiptNo,
          userCouponId: userCouponId || '',
          imageFileIds: receiptImages,
          receiptImages,
          fromCouponRedeem: !!fromCouponRedeem,
          forcePending: !!forcePending
        },
        source: fromCouponRedeem ? 'verifyStoreCoupon' : 'grantStorePoints'
      }
      if (forcePending) {
        enqueueOpts.approverRole = APPROVER_MANAGER
      }
      await enqueueApproval(db, enqueueOpts)
    } catch (e) {
      console.warn('enqueueApproval grant skipped', e && e.message)
    }
    return {
      success: true,
      purchaseId,
      pointsGranted: 0,
      pendingApproval: true,
      previewPoints: calc.points,
      ruleText: describeRule(config),
      msg: calc.points > 0
        ? `已提交店长审核，预计赠送 ${calc.points} 积分与 ${calc.points} 成长值`
        : `已提交审核（本笔按规则未达赠分门槛）`,
      ...purchaseToBrief({ _id: purchaseId, ...purchaseData })
    }
  }

  return creditPurchasePoints(purchaseId, { ...purchaseData, _id: purchaseId }, config)
}

async function approveGrant(event, openid) {
  const purchaseId = String((event && event.purchaseId) || '').trim()
  if (!purchaseId) return fail('缺少记录 id')

  let row = null
  try {
    const res = await db.collection(PURCHASES).doc(purchaseId).get()
    row = res.data
  } catch (e) {
    return fail('消费记录不存在')
  }
  if (!row) return fail('消费记录不存在')
  if (row.status !== STATUS_PENDING) return fail('该笔不是待审状态')

  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    storeId: row.storeId
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const config = await loadRuleConfig(row.storeId)
  if (!isModuleEnabled(config, 'storePurchase')) {
    return fail('门店消费赠分模块已关闭')
  }

  // 先入账再改状态，避免「已通过但未到账」且无法重审
  const credited = await creditPurchasePoints(purchaseId, { ...row, status: STATUS_GRANTED }, config)
  if (!credited.success) return credited

  try {
    await db.collection(PURCHASES).doc(purchaseId).update({
      data: {
        status: STATUS_GRANTED,
        approvedBy: openid,
        approvedByName: guard.actor.name || '',
        approveTime: db.serverDate()
      }
    })
  } catch (e) {
    // 入账已成功；状态更新失败时仍返回成功，并提示店长刷新核对
    console.error('approveGrant status update failed after credit:', e)
    return {
      ...credited,
      statusSyncFailed: true,
      msg: (credited.msg || `已赠送 ${credited.pointsGranted || 0} 积分与成长值`) + '（审核状态同步异常，请刷新核对）'
    }
  }

  await writeAuditLog(db, auditFromActor(guard.actor, {
    action: 'points_approve',
    relatedId: purchaseId,
    relatedType: 'store_purchases',
    detail: { points: credited.pointsGranted || 0, storeId: row.storeId || '' },
    source: 'grantStorePoints'
  }))

  await markApprovalDecided(db, {
    relatedId: purchaseId,
    actionType: ACTION.POINTS_STORE_GRANT,
    status: 'approved',
    decidedBy: openid,
    decidedByName: guard.actor.name || '',
    source: 'grantStorePoints.approve'
  })

  return {
    ...credited,
    msg: credited.msg || `已通过审核并赠送 ${credited.pointsGranted || 0} 积分与成长值`
  }
}

async function rejectGrant(event, openid) {
  const purchaseId = String((event && event.purchaseId) || '').trim()
  if (!purchaseId) return fail('缺少记录 id')
  const reason = String((event && event.rejectReason) || '').trim().slice(0, 200) || '店长驳回'

  let row = null
  try {
    const res = await db.collection(PURCHASES).doc(purchaseId).get()
    row = res.data
  } catch (e) {
    return fail('消费记录不存在')
  }
  if (!row) return fail('消费记录不存在')
  if (row.status !== STATUS_PENDING) return fail('该笔不是待审状态')

  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    storeId: row.storeId
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  try {
    await db.collection(PURCHASES).doc(purchaseId).update({
      data: {
        status: STATUS_REJECTED,
        rejectReason: reason,
        rejectedBy: openid,
        rejectedByName: guard.actor.name || '',
        rejectTime: db.serverDate()
      }
    })
  } catch (e) {
    return fail('驳回失败')
  }

  await writeAuditLog(db, auditFromActor(guard.actor, {
    action: 'points_reject',
    relatedId: purchaseId,
    relatedType: 'store_purchases',
    detail: { reason, storeId: row.storeId || '' },
    source: 'grantStorePoints'
  }))

  await markApprovalDecided(db, {
    relatedId: purchaseId,
    actionType: ACTION.POINTS_STORE_GRANT,
    status: 'rejected',
    rejectReason: reason,
    decidedBy: openid,
    decidedByName: guard.actor.name || '',
    source: 'grantStorePoints.reject'
  })

  return { success: true, purchaseId, msg: '已驳回该笔赠分申请' }
}

// ---------------------------------------------------------------- revoke

async function revokeGrant(event, openid) {
  const purchaseId = String((event && event.purchaseId) || '').trim()
  if (!purchaseId) return fail('缺少记录 id')

  let row = null
  try {
    const res = await db.collection(PURCHASES).doc(purchaseId).get()
    row = res.data
  } catch (e) {
    return fail('消费记录不存在')
  }
  if (!row) return fail('消费记录不存在')

  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'revokeStorePoints',
    storeId: row.storeId
  })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  if (row.status === STATUS_REVOKED) return fail('该笔已全额撤销')
  // 只有已入账的记录才能撤销：待审/已驳回从未入账，撤销会凭空扣分
  if (ACTIVE_STATUSES.indexOf(row.status) === -1) {
    return fail(row.status === STATUS_PENDING ? '该笔尚在审核中，请先驳回' : '该笔未入账，无需撤销')
  }

  const config = await loadRuleConfig(row.storeId)
  const createdMs = toMs(row.createTime)
  const overdue = !!(config.revokeWindowDays > 0 && createdMs &&
    (Date.now() - createdMs > config.revokeWindowDays * 24 * 60 * 60 * 1000))
  const fromApproval = !!(event && event._fromApproval)

  // 逾期：非超管改为提交超管审批（不再硬拒）；窗口内店长直通（积分族特例）
  if (overdue && !guard.actor.superAdmin && !fromApproval) {
    const reasonEarly = REVOKE_REASONS.indexOf(event && event.revokeReason) !== -1
      ? event.revokeReason
      : 'other'
    const enqueued = await enqueueApproval(db, {
      actionType: ACTION.POINTS_STORE_REVOKE,
      applicantOpenid: openid,
      applicantName: guard.actor.name || '',
      applicantRole: guard.actor.role || '',
      applicantWorkspaceRole: actorWorkspaceRole(guard.actor),
      relatedId: purchaseId,
      storeId: row.storeId || '',
      title: `逾期撤销 ¥${row.amount || 0}`,
      summary: `超 ${config.revokeWindowDays} 天窗口 · 需超管终审`,
      payload: {
        purchaseId,
        revokeAmount: event && event.revokeAmount,
        revokeReason: reasonEarly
      },
      source: 'grantStorePoints.revoke',
      approverRole: APPROVER_SUPER
    })
    if (!enqueued.ok) return fail(enqueued.msg || '提交撤销审批失败')
    return {
      success: true,
      pendingApproval: true,
      approvalId: enqueued.approvalId,
      msg: `已超过 ${config.revokeWindowDays} 天撤销窗口，已提交超管审批`
    }
  }

  const reason = REVOKE_REASONS.indexOf(event && event.revokeReason) !== -1 ? event.revokeReason : 'other'
  const totalAmount = Number(row.amount) || 0
  const alreadyAmount = Number(row.revokedAmount) || 0
  const alreadyPoints = Number(row.revokedPoints) || 0
  const remainAmount = Math.round((totalAmount - alreadyAmount) * 100) / 100
  if (remainAmount <= 0) return fail('该笔已无可撤销金额')

  const requested = event && event.revokeAmount !== undefined && event.revokeAmount !== null && event.revokeAmount !== ''
    ? parseAmount(event.revokeAmount)
    : remainAmount
  if (requested === null) return fail('请输入正确的撤销金额')
  const revokeAmount = Math.min(requested, remainAmount)

  const grantedPoints = Number(row.pointsGranted) || 0
  const revokePoints = totalAmount > 0
    ? Math.min(grantedPoints - alreadyPoints, Math.ceil((grantedPoints * revokeAmount) / totalAmount))
    : 0
  // 该笔是否已计入「门店消费累计」：新记录看 spendCountedAt，历史记录按「有赠分即有累计」推断
  const spendWasCounted = !!Number(row.spendCountedAt) || grantedPoints > 0
  const revokeSpend = spendWasCounted ? revokeAmount : 0

  const fullyRevoked = Math.round((alreadyAmount + revokeAmount) * 100) / 100 >= totalAmount
  const seq = (Number(row.revokeSeq) || 0) + 1

  let revokeRecordId = ''
  if (revokePoints > 0) {
    try {
      const addedRevoke = await db.collection(POINT_RECORDS).add({
        data: {
          _openid: openid,
          userOpenid: row.memberOpenid,
          type: 'revoke',
          source: 'store_purchase_revoke',
          action: 'store_purchase_revoke',
          points: -revokePoints,
          title: `${REVOKE_REASON_TEXT[reason]}扣回（¥${revokeAmount}）`,
          refCollection: PURCHASES,
          refId: purchaseId,
          dedupeKey: `revoke:${purchaseId}:${seq}`,
          status: 'pending',
          storeId: row.storeId,
          operatorOpenid: openid,
          revokeReason: reason,
          dateStr: new Date().toISOString().slice(0, 10),
          createTime: db.serverDate()
        }
      })
      revokeRecordId = (addedRevoke && addedRevoke._id) || ''
    } catch (e) {
      if (isDuplicateKeyError(e)) return fail('该撤销已处理，请刷新列表')
      console.error('revokeGrant add point_record', e)
      return fail('撤销流水写入失败')
    }
  }

  // 累计与积分分开回冲：未达门槛的消费单没有积分流水，但累计必须回退
  if (revokePoints > 0 || revokeSpend > 0) {
    try {
      const userDocId = await ensureUserDoc(db, row.memberOpenid)
      await db.collection('users').doc(userDocId).update({
        data: {
          bonusPoints: _.inc(-revokePoints),
          storePointsTotal: _.inc(-revokePoints),
          storeGrowthValue: _.inc(-revokePoints),
          storeSpendTotal: _.inc(-revokeSpend)
        }
      })
    } catch (e) {
      console.error('revokeGrant dec bonusPoints', e)
      return fail('积分扣回失败，请稍后重试')
    }
  }

  try {
    await db.collection(PURCHASES).doc(purchaseId).update({
      data: {
        status: fullyRevoked ? STATUS_REVOKED : STATUS_PARTIAL,
        revokedAmount: Math.round((alreadyAmount + revokeAmount) * 100) / 100,
        revokedPoints: alreadyPoints + revokePoints,
        revokeSeq: seq,
        revokeReason: reason,
        revokeOperatorOpenid: openid,
        revokeTime: db.serverDate()
      }
    })
  } catch (e) {
    console.error('revokeGrant update purchase', e)
    return fail('记录状态更新失败，请刷新确认')
  }

  const balance = await loadBalance(db, row.memberOpenid)

  // 撤销流水收尾：扣回已实际生效，置为 done 并回填余额，避免明细里长期显示「处理中」
  if (revokeRecordId) {
    try {
      await db.collection(POINT_RECORDS).doc(revokeRecordId).update({
        data: { status: 'done', balanceAfter: balance.displayAvailable }
      })
    } catch (e) {
      console.warn('revokeGrant finalize record failed:', e && e.message)
    }
  }

  if (balance.available < 0) {
    try {
      const userDocId = await ensureUserDoc(db, row.memberOpenid)
      await db.collection('users').doc(userDocId).update({
        data: { pointsDebt: Math.abs(balance.available) }
      })
    } catch (e) {
      console.warn('revokeGrant pointsDebt update failed:', e.message)
    }
  }

  if (revokePoints > 0) {
    try {
      await dispatchInAppMessage(db, {
        eventType: 'store_points_revoked',
        openid: row.memberOpenid,
        relatedId: `${purchaseId}:${seq}`,
        vars: {
          reason: REVOKE_REASON_TEXT[reason],
          points: String(revokePoints),
          balance: String(balance.displayAvailable)
        }
      })
    } catch (e) {
      console.warn('store_points_revoked message skipped:', e.message)
    }
  }

  await writeAuditLog(db, auditFromActor(guard.actor, {
    action: 'points_revoke',
    relatedId: purchaseId,
    relatedType: 'store_purchases',
    detail: { revokeAmount, revokePoints, reason, storeId: row.storeId || '', overdue: !!overdue },
    source: 'grantStorePoints'
  }))

  await markApprovalDecided(db, {
    relatedId: purchaseId,
    actionType: ACTION.POINTS_STORE_REVOKE,
    status: 'approved',
    decidedBy: openid,
    decidedByName: guard.actor.name || '',
    source: 'grantStorePoints.revoke'
  })

  return {
    success: true,
    purchaseId,
    revokeAmount,
    revokePoints,
    revokeSpend,
    status: fullyRevoked ? STATUS_REVOKED : STATUS_PARTIAL,
    balanceAfter: balance.displayAvailable,
    msg: revokePoints > 0
      ? `已扣回 ${revokePoints} 积分`
      : (revokeSpend > 0
        ? `已撤销该笔消费（¥${revokeSpend}），本笔无积分可扣`
        : '已登记撤销，该笔无赠分可扣')
  }
}

// ---------------------------------------------------------------- 流水

async function listRecords(event, openid) {
  const storeId = String((event && event.storeId) || '').trim()
  const guard = await assertStaff(db, openid, { role: ROLE_STAFF, storeId })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }
  const actor = guard.actor

  const page = Math.max(1, parseInt((event && event.page) || 1, 10) || 1)
  const pageSize = Math.min(50, Math.max(5, parseInt((event && event.pageSize) || 20, 10) || 20))

  const where = {}
  if (storeId) where.storeId = storeId
  else if (actor.storeIds.length) where.storeId = _.in(actor.storeIds)

  // 店员只能看自己录入的；店长看本店全部（需对应权限点）
  const canViewStore = actor.permissions.indexOf('viewStoreRecords') !== -1
  const canViewOwn = actor.permissions.indexOf('viewOwnRecords') !== -1
  if (!canViewStore && !canViewOwn && !actor.superAdmin) {
    return { success: false, code: 'FORBIDDEN', msg: '无操作权限' }
  }
  if (!canViewStore || (event && event.mine)) where.operatorOpenid = openid
  if (event && event.memberOpenid) where.memberOpenid = String(event.memberOpenid)
  if (event && event.status) where.status = String(event.status)

  const from = event && event.dateFrom ? new Date(`${event.dateFrom}T00:00:00`) : null
  const to = event && event.dateTo ? new Date(`${event.dateTo}T23:59:59`) : null
  if (from && to) where.createTime = _.gte(from).and(_.lte(to))
  else if (from) where.createTime = _.gte(from)
  else if (to) where.createTime = _.lte(to)

  try {
    const query = db.collection(PURCHASES).where(where)
    const totalRes = await query.count()
    const res = await db.collection(PURCHASES)
      .where(where)
      .orderBy('createTime', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    const rawList = res.data || []
    const allImageIds = []
    rawList.forEach((row) => {
      normalizeReceiptImages(row.receiptImages || row.imageFileIds || []).forEach((id) => {
        allImageIds.push(id)
      })
    })
    const urlMap = {}
    const cloudIds = [...new Set(allImageIds.filter((id) => String(id).indexOf('cloud://') === 0))]
    if (cloudIds.length) {
      try {
        for (let i = 0; i < cloudIds.length; i += 50) {
          const chunk = cloudIds.slice(i, i + 50)
          const urlRes = await cloud.getTempFileURL({ fileList: chunk })
          ;(urlRes.fileList || []).forEach((f) => {
            if (f && f.fileID) urlMap[f.fileID] = f.tempFileURL || f.fileID
          })
        }
      } catch (e) {
        console.warn('grantStorePoints listRecords getTempFileURL', e && e.message)
      }
    }

    const list = rawList.map((row) => {
      const imageFileIds = normalizeReceiptImages(row.receiptImages || row.imageFileIds || [])
      const attachmentImages = imageFileIds.map((fid) => urlMap[fid] || fid).filter(Boolean)
      return {
        _id: row._id,
        memberNo: row.memberNo || '',
        memberName: row.memberName || '',
        memberPhone: row.memberPhone || '',
        storeId: row.storeId,
        storeName: row.storeName || '',
        amount: Number(row.amount) || 0,
        receiptNo: row.receiptNo || '',
        pointsGranted: Number(row.pointsGranted) || 0,
        revokedAmount: Number(row.revokedAmount) || 0,
        revokedPoints: Number(row.revokedPoints) || 0,
        status: row.status,
        revokeReason: row.revokeReason || '',
        revokeReasonText: REVOKE_REASON_TEXT[row.revokeReason] || '',
        rejectReason: row.rejectReason || '',
        identifyMethod: row.identifyMethod || '',
        source: row.source || '',
        operatorName: row.operatorName || '',
        operatorOpenid: row.operatorOpenid || '',
        isMine: row.operatorOpenid === openid,
        remark: row.remark || '',
        ruleText: (row.ruleSnapshot && row.ruleSnapshot.ruleText) || '',
        imageFileIds,
        receiptImages: imageFileIds,
        attachmentImages,
        createTime: row.createTime
      }
    })

    const canApprove = actor.role === ROLE_MANAGER || !!actor.superAdmin

    return {
      success: true,
      list,
      total: totalRes.total || 0,
      page,
      pageSize,
      hasMore: page * pageSize < (totalRes.total || 0),
      role: actor.role,
      canRevoke: actor.permissions.indexOf('revokeStorePoints') !== -1,
      canApprove
    }
  } catch (e) {
    if (/collection|集合/.test(e.message || '')) {
      return fail(`请先在云开发控制台创建集合 ${PURCHASES}`)
    }
    console.error('grantStorePoints listRecords', e)
    return fail('流水加载失败')
  }
}

async function dailySummary(event, openid) {
  const storeId = String((event && event.storeId) || '').trim()
  const guard = await assertStaff(db, openid, { role: ROLE_STAFF, storeId })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  const config = await loadRuleConfig(storeId)
  const store = storeId ? await sumTodayPurchases({ storeId }) : await sumTodayPurchases({})
  const mine = await sumTodayPurchases({ operatorOpenid: openid })
  const avgTicket = store.count > 0 ? Math.round((store.amount / store.count) * 100) / 100 : 0

  return {
    success: true,
    today: {
      count: store.count,
      amount: Math.round(store.amount * 100) / 100,
      points: store.points,
      avgTicket,
      remaining: config.dailyPointsCapPerStore > 0
        ? Math.max(0, config.dailyPointsCapPerStore - store.points)
        : 0,
      cap: config.dailyPointsCapPerStore
    },
    mine: { count: mine.count, points: mine.points, amount: Math.round(mine.amount * 100) / 100 },
    ruleText: describeRule(config),
    role: guard.actor.role
  }
}

// ------------------------------------------------- 线上订单确认收货赠分（内部调用）

function onlineOrderDedupeKey(orderId) {
  return `online_order:${orderId}`
}

/**
 * 线上订单确认收货后赠分 — 与门店消费**同一规则**（store_point_rules + calcPoints）
 * - 仅内部调用（confirmOrderReceipt 云函数互调）或 Admin 运维调用
 * - 按订单幂等（point_records.dedupeKey = online_order:<orderId>）
 * - 不计入「门店消费累计」；另计 onlineSpendTotal
 * - **不写 bonusPoints / storeGrowthValue**：线上订单积分已由可用积分公式中的
 *   orderGrowthValue 实时提供（详见函数内注释），此处再累加即为双计
 */
async function grantOnlineOrderPoints(event) {
  const orderId = String((event && event.orderId) || '').trim()
  if (!orderId) return fail('缺少订单 ID')

  let order = null
  try {
    const res = await db.collection('orders').doc(orderId).get()
    order = res.data
  } catch (e) {
    return fail('订单读取失败')
  }
  if (!order) return fail('订单不存在')

  const status = String(order.status || '')
  if (status !== 'received' && status !== 'signed') {
    return { success: true, skipped: true, pointsGranted: 0, msg: '订单未签收，暂不赠分' }
  }
  // 兑换单（0 元兑换）不赠分，与门店口径一致
  if (String(order.source || '') === 'exchange') {
    return { success: true, skipped: true, pointsGranted: 0, msg: '兑换单不赠分' }
  }

  const memberOpenid = String(order._openid || order.openid || '').trim()
  if (!memberOpenid) {
    return { success: true, skipped: true, pointsGranted: 0, msg: '订单缺少归属用户' }
  }

  const amount = parseAmount(order.totalPrice != null ? order.totalPrice : order.payAmount)
  if (amount === null || amount <= 0) {
    return { success: true, skipped: true, pointsGranted: 0, msg: '订单金额为 0，本单不赠分' }
  }

  const storeId = String(order.storeId || '').trim()
  const config = await loadRuleConfig(storeId)
  if (!isModuleEnabled(config, 'storePurchase')) {
    return { success: true, skipped: true, pointsGranted: 0, msg: '赠分模块已关闭' }
  }

  // 线上消费累计：与积分解耦，按订单只记一次（未达赠分门槛的订单同样计入）
  let spendCounted = false
  if (!Number(order.onlineSpendCountedAt)) {
    try {
      const spendUser = await loadUserDoc(db, memberOpenid)
      const spendDocId = spendUser ? spendUser._id : await ensureUserDoc(db, memberOpenid)
      await db.collection('users').doc(spendDocId).update({
        data: { onlineSpendTotal: _.inc(amount) }
      })
      await db.collection('orders').doc(orderId).update({
        data: { onlineSpendCountedAt: Date.now() }
      })
      spendCounted = true
    } catch (e) {
      console.warn('grantOnlineOrderPoints onlineSpendTotal failed:', e && e.message)
    }
  }

  const calc = calcPoints(config, amount)
  const ruleText = describeRule(config)
  if (calc.points <= 0) {
    return {
      success: true,
      skipped: true,
      pointsGranted: 0,
      spendCounted,
      ruleText,
      msg: `本单未达赠分门槛（${ruleText}）`
    }
  }

  const dedupeKey = onlineOrderDedupeKey(orderId)
  // 幂等预检（唯一键兜底见下方 add 的 duplicate 分支）
  try {
    const exist = await db.collection(POINT_RECORDS).where({ dedupeKey }).limit(1).get()
    if (exist.data && exist.data.length) {
      const balance = await loadBalance(db, memberOpenid)
      return {
        success: true,
        duplicated: true,
        pointsGranted: Number(exist.data[0].points) || calc.points,
        balanceAfter: balance.displayAvailable,
        ruleText,
        msg: '本单积分已入账'
      }
    }
  } catch (e) { /* 预检失败继续走唯一键兜底 */ }

  let recordId = ''
  try {
    const added = await db.collection(POINT_RECORDS).add({
      data: {
        _openid: '',
        userOpenid: memberOpenid,
        type: 'earn',
        source: 'online_order',
        action: 'online_order',
        points: calc.points,
        title: `线上下单 ¥${amount}`,
        refCollection: 'orders',
        refId: orderId,
        dedupeKey,
        status: 'pending',
        storeId,
        operatorOpenid: '',
        orderNo: order.orderNo || '',
        dateStr: new Date().toISOString().slice(0, 10),
        expireTime: null,
        createTime: db.serverDate()
      }
    })
    recordId = added._id
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      const balance = await loadBalance(db, memberOpenid)
      return {
        success: true,
        duplicated: true,
        pointsGranted: calc.points,
        balanceAfter: balance.displayAvailable,
        ruleText,
        msg: '本单积分已入账'
      }
    }
    console.error('grantOnlineOrderPoints add record', e)
    return fail('积分流水写入失败')
  }

  // ⚠️ 线上订单**不再**累加 bonusPoints / storePointsTotal / storeGrowthValue。
  // 可用积分公式为「orderGrowthValue + bonusPoints − usedPoints」（见 pointsBalance.js /
  // getUserStats / makeOrder-pricing.js），其中 orderGrowthValue 由 orders 实时汇总
  // （paid/shipped/received 的 totalPrice 取整）——线上订单的积分**已经**由该公式给出。
  // 早期版本在这里再 _.inc 一次，会造成同一笔线上订单积分与成长值双计。
  // 本函数只负责：线上消费累计（onlineSpendTotal）+ 明细/站内信告知 + 幂等流水。
  const balance = await loadBalance(db, memberOpenid)
  try {
    await db.collection(POINT_RECORDS).doc(recordId).update({
      data: { status: 'done', balanceAfter: balance.displayAvailable }
    })
  } catch (e) {
    console.warn('grantOnlineOrderPoints finalize record failed:', e.message)
  }

  if (config.notifyUser) {
    try {
      await dispatchInAppMessage(db, {
        eventType: 'store_points_granted',
        openid: memberOpenid,
        relatedId: orderId,
        vars: {
          storeName: '线上下单',
          amount: String(amount),
          points: String(calc.points),
          balance: String(balance.displayAvailable)
        }
      })
    } catch (e) {
      console.warn('online order points message skipped:', e.message)
    }
  }

  return {
    success: true,
    pointsGranted: calc.points,
    growthValue: calc.points,
    balanceAfter: balance.displayAvailable,
    ruleText,
    ruleSnapshot: calc.ruleSnapshot,
    msg: `本单获赠 ${calc.points} 积分`
  }
}

// ---------------------------------------------------------------- 入口

exports.main = async (event) => {
  // 云函数互调无用户 OPENID 时，允许审批 / 券核销联动转发操作人身份
  let openid = cloud.getWXContext().OPENID || ''
  const forwarded = !!(event && event._callerOpenid &&
    (event._fromApproval || event._fromCouponRedeem))
  if (!openid && isNonClientSource() && forwarded) {
    openid = String(event._callerOpenid).trim()
  }
  const action = (event && event.action) || 'preview'
  const adminOpsKey = event && event.adminOpsKey
  const opsKey = process.env.ADMIN_OPS_KEY || ''
  const isAdminOps = !!(opsKey && adminOpsKey && String(adminOpsKey) === opsKey)

  // 线上订单赠分：服务端互调（confirmOrderReceipt 携带 __fromReceipt）也允许进入，其余仍要求登录
  const isOnlineGrantAction = action === 'grantOnlineOrder'
  const internalCall = isOnlineGrantAction &&
    !!(event && event.__fromReceipt === true) &&
    isInternalSource()
  if (!openid && !isAdminOps && !internalCall) {
    // 诊断：区分「确实未登录」与「互调转发被拒」。前者 SOURCE 含客户端标记，
    // 后者 SOURCE 为非客户端但未带 _callerOpenid/来源标记（历史事故即为转发被拒）。
    console.warn('grantStorePoints reject no-identity', JSON.stringify({
      action,
      source: sourceSegments().join('|') || '(empty)',
      hasCallerOpenid: !!(event && event._callerOpenid),
      fromCouponRedeem: !!(event && event._fromCouponRedeem),
      fromApproval: !!(event && event._fromApproval),
      fromReceipt: !!(event && event.__fromReceipt)
    }))
    return fail('请先登录', 'NO_IDENTITY')
  }
  globalThis.__grantStoreAdminOpsKey = isAdminOps ? adminOpsKey : ''

  // ---- 内容安全 openapi 自检（仅 adminOpsKey，供上线/改配置后验证权限是否生效）----
  if (action === 'contentSecurityProbe') {
    if (!isAdminOps) return fail('仅内部运维可用')
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64'
    )
    const image = await checkImageBuffer(png)
    const text = await checkText('probe_openid_placeholder', '内容安全自检')
    return {
      success: true,
      image: { ok: image.ok, reason: image.reason || '', openapiUnavailable: !!image.openapiUnavailable, error: image.error || '' },
      text: { ok: text.ok, reason: text.reason || '', openapiUnavailable: !!text.openapiUnavailable, error: text.error || '' },
      hint: 'openapiUnavailable=true 表示该函数 config.json 的 permissions.openapi 未生效，需在云开发控制台为函数勾选权限后重新部署。'
    }
  }

  try {
    switch (action) {
      case 'grantOnlineOrder': {
        // 线上订单确认收货赠分：仅服务端互调或 Admin 运维，禁止 C 端自助赠分
        if (internalCall || isAdminOps) return await grantOnlineOrderPoints(event)
        return fail('无权操作')
      }
      case 'identifyMember': {
        const guard = await assertStaff(db, openid, { permission: 'grantStorePoints' })
        if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }
        return await identifyMember(event)
      }
      case 'preview':
        return await previewGrant(event, openid)
      case 'grant':
        return await grantPoints(event, openid)
      case 'approve':
        return await approveGrant(event, openid)
      case 'reject':
        return await rejectGrant(event, openid)
      case 'revoke':
        return await revokeGrant(event, openid)
      case 'listRecords':
        return await listRecords(event, openid)
      case 'dailySummary':
        return await dailySummary(event, openid)
      default:
        return fail(`未知 action: ${action}`)
    }
  } catch (e) {
    console.error('grantStorePoints', action, e)
      return fail(e.message || '操作失败')
  }
}
