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
    suggestions: Array.isArray(p.suggestions) ? p.suggestions : []
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

    return fail('未知操作', { code: 'UNKNOWN_ACTION' })
  } catch (e) {
    console.error('manageMemberCrm', e)
    return fail(e.message || '服务异常', { code: 'INTERNAL' })
  }
}
