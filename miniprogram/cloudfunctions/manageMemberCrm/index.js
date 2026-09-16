/**
 * 会员 CRM（超管工作台）
 * 对齐 Admin `CRM.vue`：users + orders + user_behaviors → RFM/分群/兴趣标签；可人工调整积分。
 *
 * actions:
 *   list         列表（分群筛选 + 关键词）
 *   getDetail    单会员详情（含等级/成长值/可用积分摘要）
 *   adjustPoints 人工调整积分（bonusPoints + point_records.admin_adjust）
 *   overview     数据概览（总数 / 活跃 / 高价值排名）
 *
 * 权限：仅 super_admin（含 Admin Web ADMIN_OPS_KEY）
 */
const crypto = require('crypto')
const cloud = require('wx-server-sdk')
const { assertStaff, WORKSPACE_SUPER_ADMIN } = require('./staffGuard')
const { loadBalance, ensureUserDoc } = require('./pointsBalance')
const { loadMemberLevels, resolveMemberLevel } = require('./memberLevels')
const {
  buildProfile,
  summarizeSegments,
  toMs,
  buildOverview,
  SEGMENTS,
  SUGGEST_MAP,
  refineSegmentByAbsoluteRecency,
  VALID_ORDER_STATUS
} = require('./segmentation')

/** 订单状态中文 — 与小程序 utils/orderStatus 保持一致 */
const ORDER_STATUS_LABEL = {
  pending_pay: '待支付',
  paid: '待发货',
  shipped: '已发货',
  received: '已完成',
  refunding: '退款中',
  aftersales: '售后中',
  refunded: '已退款',
  void: '已作废',
  cancelled: '已取消'
}

function orderStatusLabel(status) {
  return ORDER_STATUS_LABEL[status] || status || ''
}

/**
 * 用该会员真实订单纠正采样 RFM 可能漏单导致的「未消费 / 积分 0」摘要。
 */
function applyDirectOrderStats(profile, userOrders) {
  if (!profile) return profile
  const now = Date.now()
  const DAY_MS = 24 * 60 * 60 * 1000
  const valid = (userOrders || []).filter((o) => o && VALID_ORDER_STATUS.has(o.status))
  if (!valid.length) return profile

  let monetary = 0
  let frequency = 0
  let lastOrderTs = 0
  valid.forEach((o) => {
    frequency += 1
    const price = parseFloat(String(o.totalPrice != null ? o.totalPrice : 0).replace(/,/g, '')) || 0
    monetary += price
    const ts = toMs(o.createTime || o.payTime)
    if (ts > lastOrderTs) lastOrderTs = ts
  })
  const recencyDays = lastOrderTs > 0 ? Math.floor((now - lastOrderTs) / DAY_MS) : Infinity
  const sampleMissed = !(Number(profile.frequency) > 0)
  const next = Object.assign({}, profile, {
    frequency: Math.max(Number(profile.frequency) || 0, frequency),
    monetary: Math.max(Number(profile.monetary) || 0, Math.round(monetary * 100) / 100),
    recencyDays:
      profile.recencyDays == null || profile.recencyDays === Infinity
        ? recencyDays
        : Math.min(Number(profile.recencyDays), recencyDays)
  })

  if (sampleMissed || next.segment === 'never_purchased') {
    // 采样漏单时相对分位不可靠：用绝对近度给可运营分群
    const R = recencyDays <= 7 ? 5 : recencyDays <= 30 ? 4 : recencyDays <= 90 ? 3 : 2
    const F = Math.min(5, frequency)
    const M = monetary >= 1000 ? 5 : monetary >= 300 ? 4 : monetary >= 100 ? 3 : 2
    const refined = refineSegmentByAbsoluteRecency({
      frequency,
      recencyDays,
      R,
      F,
      M,
      segment: frequency <= 1 && recencyDays <= 30 ? 'new_customers' : 'potential_loyal'
    })
    next.R = refined.R
    next.F = refined.F
    next.M = refined.M
    next.rfm = `${refined.R}${refined.F}${refined.M}`
    next.segment = refined.segment
    next.segmentMeta = SEGMENTS[refined.segment] || SEGMENTS.new_customers
    next.suggestions = SUGGEST_MAP[refined.segment] || []
  } else {
    const refined = refineSegmentByAbsoluteRecency({
      frequency: next.frequency,
      recencyDays: next.recencyDays,
      R: next.R,
      F: next.F,
      M: next.M,
      segment: next.segment
    })
    if (refined.segment !== next.segment) {
      next.segment = refined.segment
      next.segmentMeta = SEGMENTS[refined.segment] || next.segmentMeta
      next.suggestions = SUGGEST_MAP[refined.segment] || next.suggestions
    }
  }
  return next
}

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/** 金额累计统一保留两位小数，消除浮点尾差 */
function round2(value) {
  const n = Number(value) || 0
  return Math.round(n * 100) / 100
}
const _ = db.command

const FETCH_CAP = 1000
const LIST_RETURN_CAP = 200
const POINT_RECORDS = 'point_records'

function ok(data) {
  return Object.assign({ success: true }, data || {})
}

function fail(msg, extra) {
  return Object.assign({ success: false, msg: msg || '操作失败' }, extra || {})
}

function maskPhone(phone) {
  const value = String(phone || '')
  if (value.length < 7) return value ? '****' : ''
  return `${value.slice(0, 3)}****${value.slice(-4)}`
}

function maskOpenid(openid) {
  const v = String(openid || '')
  if (v.length <= 8) return v
  return `${v.slice(0, 4)}…${v.slice(-4)}`
}

async function requireSuperAdmin(event, openid) {
  return assertStaff(db, openid, {
    requireSuperAdmin: true,
    adminOpsKey: event && event.adminOpsKey
  })
}

async function fetchCollectionSorted(name, limit) {
  const PAGE = 100
  const rows = []
  let skip = 0
  while (rows.length < limit) {
    const take = Math.min(PAGE, limit - rows.length)
    let query = db.collection(name).skip(skip).limit(take)
    try {
      if (name === 'users' || name === 'orders') {
        query = query.orderBy('createTime', 'desc')
      } else if (name === 'user_behaviors') {
        query = query.orderBy('createdAt', 'desc')
      }
    } catch (e) {
      /* 无索引时退回无排序 */
    }
    let res
    try {
      res = await query.get()
    } catch (e) {
      // createdAt 索引缺失时退回 createTime / 无排序
      try {
        res = await db.collection(name).skip(skip).limit(take).get()
      } catch (e2) {
        console.warn(`fetch ${name} failed:`, e2.message)
        break
      }
    }
    const batch = res.data || []
    rows.push(...batch)
    if (batch.length < take) break
    skip += batch.length
  }
  return rows
}

async function loadPortraitSourceData() {
  const [users, orders, behaviors] = await Promise.all([
    fetchCollectionSorted('users', FETCH_CAP),
    fetchCollectionSorted('orders', FETCH_CAP),
    fetchCollectionSorted('user_behaviors', FETCH_CAP)
  ])
  const dataCapped =
    users.length >= FETCH_CAP || orders.length >= FETCH_CAP || behaviors.length >= FETCH_CAP
  return { users, orders, behaviors, dataCapped }
}

function serializeProfile(p) {
  const recencyDays = p.recencyDays === Infinity ? null : p.recencyDays
  return {
    _id: p._id,
    openid: p.openid,
    openidMasked: maskOpenid(p.openid),
    nickName: p.nickName,
    avatarUrl: p.avatarUrl,
    phone: String(p.phone || ''),
    phoneMasked: maskPhone(p.phone),
    hasPhone: !!p.phone,
    points: p.points || 0,
    isHonorary: !!p.isHonorary,
    createTime: p.createTime || 0,
    level: p.level != null ? p.level : undefined,
    levelName: p.levelName || '',
    R: p.R || 0,
    F: p.F || 0,
    M: p.M || 0,
    rfm: p.rfm || '000',
    segment: p.segment || 'never_purchased',
    segmentMeta: p.segmentMeta || null,
    monetary: Math.round((p.monetary || 0) * 100) / 100,
    frequency: p.frequency || 0,
    recencyDays,
    tags: mergeCrmTags(p.tags, p.interestTags),
    interestTags: Array.isArray(p.interestTags) ? p.interestTags : [],
    suggestions: Array.isArray(p.suggestions) ? p.suggestions : [],
    // 注销状态：serializeProfile 是**白名单**，漏了这三个字段会导致
    // 列表徽标与详情页的「已注销/恢复」区永远不渲染（曾漏过一次）
    status: p.status || 'active',
    cancelMode: p.cancelMode || '',
    cancelledAt: p.cancelledAt || null
  }
}

function mergeCrmTags(rfmTags, interestTags) {
  const base = Array.isArray(rfmTags) ? rfmTags.slice() : []
  const seen = new Set(base.map((t) => (t && (t.key || t.label)) || ''))
  ;(interestTags || []).forEach((label) => {
    const text = String(label || '').trim()
    if (!text) return
    const key = `interest:${text}`
    if (seen.has(key) || seen.has(text)) return
    seen.add(key)
    base.push({ type: 'interest', key, label: text, color: '#C4A76C' })
  })
  return base
}

function matchKeyword(profile, keyword) {
  const k = String(keyword || '').trim().toLowerCase()
  if (!k) return true
  const nick = String(profile.nickName || '').toLowerCase()
  const oid = String(profile.openid || '').toLowerCase()
  const phone = String(profile.phone || '')
  const id = String(profile._id || '').toLowerCase()
  return nick.includes(k) || oid.includes(k) || id.includes(k) || phone.includes(k.replace(/\D/g, '') || k)
}

async function enrichLevelAndBalance(profile) {
  const openid = profile.openid
  const balance = await loadBalance(db, openid)
  const user = balance.user || {}
  const orderGrowth = balance.growthValue
  const storeGrowth = Math.max(0, Math.floor(Number(user.storeGrowthValue) || 0))
  const growthValue = orderGrowth + storeGrowth
  const isHonorary = user.isHonorary === true || profile.isHonorary === true
  const { levels } = await loadMemberLevels(db)
  const resolved = resolveMemberLevel(levels, growthValue, isHonorary, user.levelOverride || null)

  return {
    ...profile,
    // Admin CRM 展示 users.points；工作台额外给出可用积分口径
    availablePoints: balance.displayAvailable,
    bonusPoints: balance.bonusPoints,
    usedPoints: balance.usedPoints,
    orderGrowthValue: orderGrowth,
    storeGrowthValue: storeGrowth,
    growthValue,
    level: resolved.level,
    levelName: resolved.levelName,
    discountRate: resolved.discountRate,
    nextThreshold: resolved.nextThreshold,
    isHonorary,
    levelOverride: user.levelOverride || null,
    overrideMode: resolved.overrideMode || '',
    storeSpendTotal: round2(user.storeSpendTotal),
    storePointsTotal: Number(user.storePointsTotal) || 0,
    onlineSpendTotal: round2(user.onlineSpendTotal),
    platformSpendTotal: round2(user.platformSpendTotal)
  }
}

async function handleList(event) {
  const { users, orders, behaviors, dataCapped } = await loadPortraitSourceData()
  const rawProfiles = buildProfile({ users, orders, behaviors })
  const topSegments = summarizeSegments(rawProfiles).slice(0, 6)

  const segment = String((event && event.segment) || '').trim()
  const keyword = String((event && event.keyword) || '').trim()

  let filtered = rawProfiles
  if (segment) filtered = filtered.filter((p) => p.segment === segment)
  if (keyword) filtered = filtered.filter((p) => matchKeyword(p, keyword))

  const totalMatched = filtered.length
  const { levels } = await loadMemberLevels(db)
  const list = filtered.slice(0, LIST_RETURN_CAP).map((p) => {
    const growthValue = (p.orderGrowthValue || 0) + (p.storeGrowthValue || 0)
    const resolved = resolveMemberLevel(
      levels,
      growthValue,
      p.isHonorary === true,
      p.levelOverride || null
    )
    return serializeProfile({
      ...p,
      level: resolved.level,
      levelName: resolved.levelName
    })
  })

  return ok({
    list,
    totalMatched,
    totalLoaded: users.length,
    returned: list.length,
    dataCapped,
    topSegments,
    fetchCap: FETCH_CAP,
    listCap: LIST_RETURN_CAP
  })
}

async function handleGetDetail(event) {
  const openid = String((event && event.openid) || '').trim()
  const userId = String((event && event.userId) || '').trim()
  if (!openid && !userId) return fail('缺少 openid 或 userId')

  const { users, orders, behaviors, dataCapped } = await loadPortraitSourceData()
  const profiles = buildProfile({ users, orders, behaviors })
  let found = null
  if (openid) found = profiles.find((p) => p.openid === openid)
  if (!found && userId) found = profiles.find((p) => p._id === userId)

  // 不在采样窗口内：单独拉用户再并入画像
  if (!found) {
    let user = null
    try {
      if (userId) {
        const res = await db.collection('users').doc(userId).get()
        user = res.data || null
      } else {
        const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
        user = (res.data && res.data[0]) || null
      }
    } catch (e) {
      return fail('会员不存在')
    }
    if (!user) return fail('会员不存在')
    const mergedUsers = users.concat([user])
    const rebuilt = buildProfile({ users: mergedUsers, orders, behaviors })
    found = rebuilt.find((p) => p.openid === (user._openid || openid) || p._id === user._id)
  }

  if (!found) return fail('会员不存在')

  // 该会员真实订单（不依赖采样窗口），用于纠正 RFM 漏单 + 近期订单列表
  let userOrders = []
  try {
    const res = await db
      .collection('orders')
      .where({
        _openid: found.openid,
        status: _.in(['paid', 'shipped', 'received'])
      })
      .orderBy('createTime', 'desc')
      .limit(50)
      .get()
    userOrders = res.data || []
  } catch (e) {
    console.warn('userOrders', e.message)
  }

  const corrected = applyDirectOrderStats(found, userOrders)
  const base = serializeProfile(corrected)
  // 详情积分一律以 loadBalance 为准，覆盖列表近似值
  const detail = await enrichLevelAndBalance(base)
  detail.points = detail.availablePoints

  const recentOrders = userOrders.slice(0, 5).map((o) => ({
    _id: o._id,
    orderNo: o.orderNo || o._id,
    status: o.status,
    statusLabel: orderStatusLabel(o.status),
    totalPrice: o.totalPrice,
    createTime: toMs(o.createTime || o.payTime)
  }))

  return ok({
    detail,
    recentOrders,
    dataCapped
  })
}

async function handleOverview(event) {
  const topN = parseInt(event && event.topN, 10)
  const { users, orders, behaviors, dataCapped } = await loadPortraitSourceData()
  const rawProfiles = buildProfile({ users, orders, behaviors })
  const overview = buildOverview(rawProfiles, {
    topN: Number.isFinite(topN) ? topN : 20,
    fetchCap: FETCH_CAP
  })

  return ok({
    ...overview,
    totalLoaded: users.length,
    dataCapped,
    fetchCap: FETCH_CAP
  })
}

async function handleAdjustPoints(event, actor) {
  const openid = String((event && event.openid) || '').trim()
  const userId = String((event && event.userId) || '').trim()
  const amount = parseInt(event && event.amount, 10)
  const desc = String((event && event.desc) || '管理员后台调整').trim().slice(0, 80)

  if (!Number.isFinite(amount) || amount === 0) {
    return fail('请输入非零整数积分变动')
  }
  if (Math.abs(amount) > 100000) {
    return fail('单次调整不得超过 100000')
  }

  let docId = userId
  let targetOpenid = openid
  if (!docId || !targetOpenid) {
    let user = null
    if (docId) {
      try {
        const res = await db.collection('users').doc(docId).get()
        user = res.data || null
      } catch (e) {
        return fail('会员不存在')
      }
    } else if (targetOpenid) {
      const res = await db.collection('users').where({ _openid: targetOpenid }).limit(1).get()
      user = (res.data && res.data[0]) || null
    }
    if (!user) return fail('会员不存在')
    docId = user._id
    targetOpenid = user._openid || targetOpenid
  }

  if (!targetOpenid) return fail('会员 openid 缺失')

  const before = await loadBalance(db, targetOpenid)
  const ensuredId = docId || (await ensureUserDoc(db, targetOpenid))

  // 真实可用积分走 bonusPoints；同步 users.points 以兼容 Admin CRM 直读字段
  try {
    await db.collection('users').doc(ensuredId).update({
      data: {
        bonusPoints: _.inc(amount),
        points: _.inc(amount),
        updateTime: db.serverDate()
      }
    })
  } catch (e) {
    console.error('adjustPoints update', e)
    return fail('积分调整失败：' + (e.message || '未知错误'))
  }

  try {
    await db.collection(POINT_RECORDS).add({
      data: {
        _openid: targetOpenid,
        userId: ensuredId,
        type: 'admin_adjust',
        amount,
        desc: desc || '管理员后台调整',
        operatorOpenid: actor.openid || '',
        operatorName: actor.name || '超管',
        operatorSource: actor.source || '',
        workspaceRole: WORKSPACE_SUPER_ADMIN,
        createTime: Date.now()
      }
    })
  } catch (e) {
    console.warn('point_records admin_adjust write failed:', e.message)
  }

  const after = await loadBalance(db, targetOpenid)
  return ok({
    msg: amount > 0 ? `已增加 ${amount} 积分` : `已扣除 ${Math.abs(amount)} 积分`,
    amount,
    beforeAvailable: before.displayAvailable,
    afterAvailable: after.displayAvailable,
    points: after.displayAvailable
  })
}

/* ============================================================
 * 会员注销（超管）
 *
 * 三种方式，均需**双重验证**：① 输入该会员绑定手机号 ② 手动输入「注销」二字
 *   soft      软注销：标记停用，保留全部数据，**可恢复**
 *   anonymize 注销并匿名化：标记 + 抹除身份信息（保留订单/积分/成长值流水），不可恢复
 *   purge     硬删除：删除 users 文档（留一条操作日志），不可恢复
 *
 * 与客户端的关系：客户端只负责收集与即时校验，**手机号与确认文案都由服务端再校验一次**
 * （客户端校验只是体验，不构成鉴权）。
 * ============================================================ */
const CANCEL_MODES = ['soft', 'anonymize', 'purge']

/** 归一化手机号：去掉非数字，并剥离 +86 / 86 前缀，便于与绑定号码比对 */
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/[^\d]/g, '')
  return digits.replace(/^86(?=1\d{10}$)/, '')
}

/** 匿名化时抹除的身份字段（交易类数据一律保留，便于对账与合规留存） */
const ANON_SCRUB = {
  nickName: '已注销会员',
  avatarUrl: '',
  bio: '',
  phone: '',
  gender: '',
  birthday: '',
  birthdayMonthDay: '',
  zodiac: '',
  mbti: '',
  interests: [],
  interestTags: []
}

async function writeCancelAudit(entry) {
  try {
    await db.collection('admin_operation_logs').add({
      data: Object.assign({}, entry, { at: db.serverDate() })
    })
  } catch (e) {
    // 审计写入失败不回滚主流程，但必须留痕到日志
    console.error('cancel audit log failed', e && e.message)
  }
}

/** 注销即让已发出的会员码立即失效：既置 revoked，也把 expiresAt 拨到当前（复用既有过期校验） */
async function revokeMemberPassTokens(openid) {
  if (!openid) return 0
  let n = 0
  try {
    const res = await db
      .collection('member_pass_tokens')
      .where({ openid })
      .limit(100)
      .get()
    const now = Date.now()
    for (const rec of res.data || []) {
      const exp = rec.expiresAt instanceof Date ? rec.expiresAt.getTime() : Number(rec.expiresAt) || 0
      if (rec.revoked === true || exp <= now) continue
      try {
        await db.collection('member_pass_tokens').doc(rec._id).update({
          data: { revoked: true, revokedAt: db.serverDate(), expiresAt: new Date(now) }
        })
        n += 1
      } catch (e) { /* 单条失败继续 */ }
    }
  } catch (e) {
    console.warn('revoke member pass tokens', e && e.message)
  }
  return n
}

async function handleCancelMember(event, actor) {
  const userId = String((event && event.userId) || '').trim()
  const openid = String((event && event.openid) || '').trim()
  const mode = String((event && event.mode) || '').trim()
  const confirmPhone = normalizePhone(event && event.confirmPhone)
  const confirmText = String((event && event.confirmText) || '').trim()

  // ---- 校验一：方式必须合法 ----
  if (!CANCEL_MODES.includes(mode)) {
    return fail('注销方式无效（soft / anonymize / purge）')
  }
  // ---- 校验二：手工输入「注销」二字 ----
  if (confirmText !== '注销') {
    return fail('请在确认框内手动输入「注销」二字')
  }

  // ---- 定位会员 ----
  let user = null
  if (userId) {
    try {
      const res = await db.collection('users').doc(userId).get()
      user = res.data || null
    } catch (e) {
      return fail('会员不存在')
    }
  } else if (openid) {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    user = (res.data && res.data[0]) || null
  }
  if (!user) return fail('会员不存在')

  // ---- 校验三：手机号必须与该会员绑定号码一致 ----
  const bound = normalizePhone(user.phone)
  if (!bound) {
    return fail('该会员未绑定手机号，无法通过手机号验证，请改用其他方式核实身份')
  }
  if (confirmPhone !== bound) {
    return fail('手机号与该会员绑定号码不一致，已阻止注销')
  }

  const operator = (actor && (actor.name || actor.openid)) || 'Admin Web'
  const operatorOpenid = (actor && actor.openid) || ''
  const targetOpenid = user._openid || openid || ''
  const phoneHash = crypto.createHash('sha256').update(bound, 'utf8').digest('hex').slice(0, 16)

  if (user.status === 'cancelled' && mode !== 'purge') {
    return fail('该会员已处于注销状态，无需重复操作')
  }

  const revoked = await revokeMemberPassTokens(targetOpenid)

  if (mode === 'purge') {
    // 硬删除：文档删除后无处留痕，故先写审计
    await db.collection('users').doc(user._id).remove()
    await writeCancelAudit({
      action: 'member_cancel',
      mode: 'purge',
      targetOpenid,
      targetUserId: user._id,
      targetNick: String(user.nickName || ''),
      phoneHash,
      phoneMasked: maskPhone(bound),
      operator,
      operatorOpenid,
      revokedTokens: revoked,
      note: '硬删除会员文档（不可恢复）'
    })
    return {
      success: true,
      mode: 'purge',
      msg: `已删除该会员记录（注销前手机号 ${maskPhone(bound)}）；已失效会员码 ${revoked} 张`,
      revokedTokens: revoked,
      deleted: true
    }
  }

  const patch = {
    status: 'cancelled',
    cancelMode: mode,
    cancelledAt: db.serverDate(),
    cancelledBy: operator,
    cancelledByOpenid: operatorOpenid,
    phoneHash,
    phoneAtCancelMasked: maskPhone(bound),
    memberPassRevoked: revoked,
    updateTime: db.serverDate()
  }
  if (mode === 'anonymize') {
    Object.assign(patch, ANON_SCRUB, { anonymizedAt: db.serverDate() })
  }

  await db.collection('users').doc(user._id).update({ data: patch })

  await writeCancelAudit({
    action: 'member_cancel',
    mode,
    targetOpenid,
    targetUserId: user._id,
    targetNick: String(user.nickName || ''),
    phoneHash,
    phoneMasked: maskPhone(bound),
    operator,
    operatorOpenid,
    revokedTokens: revoked,
    note: mode === 'anonymize' ? '注销并匿名化（不可恢复）' : '软注销（可恢复）'
  })

  return {
    success: true,
    mode,
    msg:
      mode === 'anonymize'
        ? `已注销并匿名化该会员；已失效会员码 ${revoked} 张`
        : `已软注销该会员（可恢复）；已失效会员码 ${revoked} 张`,
    revokedTokens: revoked,
    status: 'cancelled'
  }
}

/** 恢复：仅对软注销有意义（匿名化已抹除身份信息，无法还原） */
async function handleRestoreMember(event, actor) {
  const userId = String((event && event.userId) || '').trim()
  if (!userId) return fail('缺少 userId')
  let user = null
  try {
    const res = await db.collection('users').doc(userId).get()
    user = res.data || null
  } catch (e) {
    return fail('会员不存在')
  }
  if (!user) return fail('会员不存在')
  if (user.status !== 'cancelled') return fail('该会员当前不是注销状态')
  if (user.cancelMode === 'anonymize') {
    return fail('该会员已匿名化，身份信息不可还原，无法恢复')
  }

  const operator = (actor && (actor.name || actor.openid)) || 'Admin Web'
  await db.collection('users').doc(userId).update({
    data: {
      status: 'active',
      restoredAt: db.serverDate(),
      restoredBy: operator,
      updateTime: db.serverDate()
    }
  })
  await writeCancelAudit({
    action: 'member_restore',
    targetOpenid: user._openid || '',
    targetUserId: userId,
    targetNick: String(user.nickName || ''),
    operator,
    operatorOpenid: (actor && actor.openid) || '',
    note: '恢复软注销会员'
  })
  return { success: true, msg: '已恢复该会员', status: 'active' }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const action = String((event && event.action) || '').trim()

  try {
    const guard = await requireSuperAdmin(event, openid)
    if (!guard.ok) {
      return fail(guard.msg || '仅超管可操作', { code: guard.code || 'FORBIDDEN' })
    }

    if (action === 'list') return await handleList(event)
    if (action === 'getDetail') return await handleGetDetail(event)
    if (action === 'overview') return await handleOverview(event)
    if (action === 'adjustPoints') return await handleAdjustPoints(event, guard.actor)
    if (action === 'cancelMember') return await handleCancelMember(event, guard.actor)
    if (action === 'restoreMember') return await handleRestoreMember(event, guard.actor)

    return fail('未知操作', { code: 'UNKNOWN_ACTION' })
  } catch (e) {
    console.error('manageMemberCrm', e)
    return fail(e.message || '服务异常', { code: 'INTERNAL' })
  }
}
