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

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const callerOpenId = wxContext.OPENID || ''
  const targetOpenId = event.targetOpenId || callerOpenId

  if (!callerOpenId) {
    return { totalAmount: 0, points: 0, level: 1, levelName: '原木·见习者', discountRate: 1.00, error: true, msg: '未登录' }
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

    return {
      totalAmount,
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
