/**
 * 积分余额口径 — 复制到 grantStorePoints / exchangeCoupon / getPointRecords，保持同名同内容
 *
 * 可用积分 = orderGrowthValue + bonusPoints − usedPoints
 * 与 getUserStats / getUserSession / makeOrder-pricing.js 完全一致，杜绝口径漂移。
 *
 * 本文件的 growthValue 仅指「线上已付订单」累加（计入可用积分）。
 * 门店消费积分走 bonusPoints；门店成长值走 users.storeGrowthValue（等级用，不在此并入可用积分）。
 */

/**
 * 线上已付订单累计金额取整（可用积分中的线上成长部分）。
 * 按 createTime 分页累加，不再受单次 100 条上限影响（2026-09-15 修正）。
 */
const GROWTH_PAGE_SIZE = 100
/** 分页安全上限：远超任何真实用户的订单量，避免异常数据导致死循环 */
const GROWTH_MAX_PAGES = 60

/**
 * 线上已付订单累计（可用积分中的线上成长部分）。
 *
 * 修正（2026-09-15）：原实现只取 `.limit(100)`，订单破百的用户积分/等级会**静默变小**
 * 且随调用路径不同而不同（getUserStats 是分页的、这里是 100 条上限）。
 * 现改为按 createTime 分页累加，与 getUserStats 口径一致。
 */
async function sumPaidGrowth(db, openid) {
  const _ = db.command
  const acc = (order) => {
    if (!order || order.source === 'exchange') return 0
    // 首单预估定级订单写 growthAmount（会员折前应付）；否则用实付 totalPrice
    const raw = order.growthAmount != null && order.growthAmount !== ''
      ? order.growthAmount
      : order.totalPrice
    if (raw == null || raw === '') return 0
    const price = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''))
    return Number.isFinite(price) ? price : 0
  }
  try {
    let total = 0
    let skip = 0
    for (let page = 0; page < GROWTH_MAX_PAGES; page += 1) {
      const res = await db.collection('orders')
        .where({ _openid: openid, status: _.in(['paid', 'shipped', 'received']) })
        .orderBy('createTime', 'asc')
        .skip(skip)
        .limit(GROWTH_PAGE_SIZE)
        .get()
      const rows = res.data || []
      rows.forEach((order) => { total += acc(order) })
      if (rows.length < GROWTH_PAGE_SIZE) break
      skip += rows.length
    }
    return Math.floor(total)
  } catch (e) {
    console.warn('pointsBalance sumPaidGrowth failed:', e.message)
    return 0
  }
}

async function loadUserDoc(db, openid) {
  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    console.warn('pointsBalance loadUserDoc failed:', e.message)
    return null
  }
}

/**
 * @returns {{ userDocId, growthValue, bonusPoints, usedPoints, pointsDebt, available, displayAvailable }}
 */
async function loadBalance(db, openid, preloadedUser) {
  const user = preloadedUser !== undefined ? preloadedUser : await loadUserDoc(db, openid)
  const growthValue = await sumPaidGrowth(db, openid)
  const bonusPoints = Number((user && user.bonusPoints) || 0) || 0
  const usedPoints = Number((user && user.usedPoints) || 0) || 0
  const pointsDebt = Number((user && user.pointsDebt) || 0) || 0
  const available = growthValue + bonusPoints - usedPoints

  return {
    userDocId: (user && user._id) || '',
    user,
    growthValue,
    bonusPoints,
    usedPoints,
    pointsDebt,
    available,
    displayAvailable: Math.max(0, available)
  }
}

/**
 * users 文档可能不存在（极端情况），确保拿到一个可更新的文档 id。
 */
async function ensureUserDoc(db, openid) {
  const existing = await loadUserDoc(db, openid)
  if (existing) return existing._id
  const added = await db.collection('users').add({
    data: {
      _openid: openid,
      bonusPoints: 0,
      usedPoints: 0,
      createTime: db.serverDate()
    }
  })
  return added._id
}

module.exports = {
  sumPaidGrowth,
  loadUserDoc,
  loadBalance,
  ensureUserDoc
}
