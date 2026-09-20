const cloud = require('wx-server-sdk')
const { loadMemberLevels, resolveMemberLevel, toLevelLadder } = require('./memberLevels')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/** 金额累计统一保留两位小数，消除浮点尾差 */
function round2(value) {
  const n = Number(value) || 0
  return Math.round(n * 100) / 100
}
const _ = db.command

async function sumPaidGrowth(openid) {
  const PAGE = 100
  const MAX_SKIP = 1000
  let skip = 0
  let totalAmount = 0
  let orderCount = 0
  while (skip <= MAX_SKIP) {
    const res = await db.collection('orders')
      .where({
        _openid: openid,
        status: _.in(['paid', 'shipped', 'received'])
      })
      .skip(skip)
      .limit(PAGE)
      .get()
    const rows = res.data || []
    rows.forEach((order) => {
      if (order.source === 'exchange') return
      orderCount += 1
      // 首单预估定级订单写 growthAmount（会员折前应付）；否则用实付 totalPrice
      const raw = order.growthAmount != null && order.growthAmount !== ''
        ? order.growthAmount
        : order.totalPrice
      if (raw == null || raw === '') return
      const price = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''))
      if (!isNaN(price)) totalAmount += price
    })
    if (rows.length < PAGE) break
    skip += PAGE
  }
  return { totalAmount, orderCount }
}

/** 与 staffGuard / getUserSession 同源 */
const SUPER_ADMIN_OPENIDS = [
  'oa22s5ZcMY7xkQDlNW8X8jaYy46M',
  'oa22s5RuZSXOCRQtXzdrVEiT1JuY'
]

/**
 * 后台入口可见性。真正鉴权在各云函数 staffGuard。
 * 优先级：超管白名单 > staff_members > users.isAdmin > MESSAGE_ADMIN_OPENIDS > users.staffRole
 */
async function resolveStaffRole(db, openid, userInfo) {
  if (openid) {
    let superList = SUPER_ADMIN_OPENIDS.slice()
    try {
      const acl = await db.collection('workspace_acl').doc('super_admins').get()
      const fromDb = Array.isArray((acl.data || {}).openids) ? acl.data.openids : []
      fromDb.forEach((id) => {
        const v = String(id || '').trim()
        if (v && superList.indexOf(v) === -1) superList.push(v)
      })
    } catch (e) { /* ignore */ }
    if (superList.indexOf(openid) !== -1) return 'manager'
  }
  try {
    const res = await db.collection('staff_members').where({ openid, status: 'active' }).limit(1).get()
    const row = res.data && res.data[0]
    if (row) {
      const role = String(row.role || '').trim()
      if (role === 'manager' || role === 'owner' || role === 'admin') return 'manager'
      return 'staff'
    }
  } catch (e) {
    console.warn('getUserStats staff_members lookup failed:', e.message)
  }
  if (userInfo && userInfo.isAdmin === true) return 'manager'
  const admins = (process.env.MESSAGE_ADMIN_OPENIDS || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (admins.includes(openid)) return 'manager'
  const role = (userInfo && userInfo.staffRole) || ''
  return role === 'manager' || role === 'staff' ? role : ''
}


/**
 * 「藏品订单」数字角标的分桶 —— **口径必须与小程序订单页签逐字一致**
 * （见 `subpackages/business/orders/index.js` 的 `switch (this.data.curTab)`）：
 * 角标数字要等于点进去看到的条数，否则就是「角标 0、列表有 1 条」那类事故。
 *
 * 两条来源都要算，与订单页一致：
 *   · 我是买家：`_openid == 我`，且**排除券/积分兑换单**（source=exchange 不属于藏品订单）
 *   · 我是受礼人：`giftMeta.receiverOpenid == 我`（客户端读不到别人的单，只能在这里算）
 */
const ORDER_BADGE_BUCKETS = {
  pay: ['pending_pay', 'fulfilling'],
  paid: ['paid', 'paid_awaiting_address', 'ready_pickup'],
  shipped: ['shipped'],
  signed: ['received'],
  // ⚠️ 不要照抄订单页签里的 `refund_approved` / `refund_rejected`：两者在
  // `scripts/lib/orderStatusAllowed.json` 里属 **ghosts（零写入方）**（契约 C3 §4.2），
  // 写回代码会被 `check:order-status-enum` 拦下；且因为零写入方，去掉它们**不改变任何计数**。
  refund: ['aftersales', 'refunding', 'refunded', 'expired_refunding']
}

/**
 * 10 个 count() 并行（只回计数、不传文档），失败一律回 null —— 角标宁可不显示，也不谎报数字。
 * @returns {Promise<{pay:number,paid:number,shipped:number,signed:number,refund:number}|null>}
 */
async function countOrderBadges(db, _, openid) {
  if (!openid) return null
  try {
    const entries = await Promise.all(Object.keys(ORDER_BADGE_BUCKETS).map((key) => {
      const statuses = ORDER_BADGE_BUCKETS[key]
      return Promise.all([
        db.collection('orders').where({ _openid: openid, source: _.neq('exchange'), status: _.in(statuses) }).count(),
        db.collection('orders').where({ 'giftMeta.receiverOpenid': openid, status: _.in(statuses) }).count()
      ]).then(([own, recv]) => [
        key,
        (own && own.total ? own.total : 0) + (recv && recv.total ? recv.total : 0)
      ])
    }))
    const out = {}
    entries.forEach(([key, n]) => { out[key] = n })
    return out
  } catch (e) {
    console.warn('getUserStats countOrderBadges', e)
    return null
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const callerOpenId = wxContext.OPENID || ''
  const targetOpenId = event.targetOpenId || callerOpenId

  if (!callerOpenId) {
    return { totalAmount: 0, points: 0, level: 1, levelName: '原木·见习者', discountRate: 1.00, error: true, msg: '未登录' }
  }

  // 轻量通道：只要「藏品订单」角标计数（「我的」页 onShow 刷新用）
  // —— 不跑花销/等级聚合，避免每次切到该 Tab 都做一遍重活
  if (event && event.action === 'orderCounts') {
    return {
      success: true,
      orderStatusCounts: await countOrderBadges(db, _, callerOpenId)
    }
  }

  if (targetOpenId !== callerOpenId) {
    // 店员查会员是正当场景；普通用户不可越权读他人统计 / staffRole
    let callerInfo = {}
    try {
      const callerRes = await db.collection('users').where({ _openid: callerOpenId }).limit(1).get()
      callerInfo = (callerRes.data && callerRes.data[0]) || {}
    } catch (e) { /* ignore */ }
    const staffRole = await resolveStaffRole(db, callerOpenId, callerInfo)
    if (!staffRole) {
      return {
        totalAmount: 0,
        points: 0,
        level: 1,
        levelName: '原木·见习者',
        discountRate: 1.00,
        error: true,
        code: 'FORBIDDEN',
        msg: '仅可查看本人或店员查会员'
      }
    }
  }

  try {
    let isHonorary = false
    let userInfo = {}
    let bonusPoints = 0
    let usedPoints = 0

    const userRes = await db.collection('users').where({ _openid: targetOpenId }).get()
    if (userRes.data && userRes.data.length > 0) {
      userInfo = userRes.data[0]
      if (userInfo.isHonorary === true) isHonorary = true
      usedPoints = userInfo.usedPoints || 0
      bonusPoints = userInfo.bonusPoints || 0
    }

    const { totalAmount, orderCount } = await sumPaidGrowth(targetOpenId)
    const orderGrowth = Math.floor(totalAmount)
    const storeGrowth = Math.max(0, Math.floor(Number(userInfo.storeGrowthValue) || 0))
    // 等级成长 = 线上订单 + 门店 storeGrowthValue；可用积分仍只用线上成长 + bonusPoints（门店分已在 bonusPoints）
    const growthValue = orderGrowth + storeGrowth
    const availablePoints = (orderGrowth + bonusPoints) - usedPoints

    const { levels, source } = await loadMemberLevels(db)
    const resolved = resolveMemberLevel(levels, growthValue, isHonorary, userInfo && userInfo.levelOverride)

    // 角标按需计算：只有「我的」页会传 withOrderCounts，结算页等调用方不受影响
    const orderStatusCounts = (event && event.withOrderCounts === true)
      ? await countOrderBadges(db, _, targetOpenId)
      : undefined

    return {
      totalAmount,
      orderStatusCounts,
      points: Math.max(0, availablePoints),
      orderCount,
      level: resolved.level,
      levelName: resolved.levelName,
      discountRate: resolved.discountRate,
      growthValue,
      storeGrowthValue: storeGrowth,
      nextThreshold: resolved.nextThreshold,
      levelLadder: toLevelLadder(levels),
      levelSource: source,
      isAdmin: userInfo.isAdmin || false,
      staffRole: await resolveStaffRole(db, targetOpenId, userInfo),
      storeSpendTotal: round2(userInfo.storeSpendTotal),
      storePointsTotal: userInfo.storePointsTotal || 0,
      onlineSpendTotal: round2(userInfo.onlineSpendTotal),
      platformSpendTotal: round2(userInfo.platformSpendTotal),
      levelOverride: userInfo.levelOverride || null,
      overrideMode: resolved.overrideMode || '',
      userInfo
    }
  } catch (err) {
    console.error(err)
    return { totalAmount: 0, points: 0, level: 1, levelName: '原木·见习者', discountRate: 1.00, error: true }
  }
}
