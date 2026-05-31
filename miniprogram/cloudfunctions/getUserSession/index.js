const cloud = require('wx-server-sdk')
const { calcProfileScore, resolveAuthState, buildMemberNo, sanitizeUser } = require('./profileUtil')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function computeStats(openid, userInfo) {
  let isHonorary = false
  let bonusPoints = 0
  let usedPoints = 0

  if (userInfo) {
    isHonorary = userInfo.isHonorary === true
    bonusPoints = userInfo.bonusPoints || 0
    usedPoints = userInfo.usedPoints || 0
  }

  const res = await db.collection('orders')
    .where({
      _openid: openid,
      status: _.in(['paid', 'shipped', 'received'])
    })
    .get()

  let totalAmount = 0
  const orderCount = (res.data || []).length
  ;(res.data || []).forEach((order) => {
    if (order.totalPrice) {
      const price = parseFloat(String(order.totalPrice).replace(/,/g, ''))
      if (!isNaN(price)) totalAmount += price
    }
  })

  const growthValue = Math.floor(totalAmount)
  const availablePoints = (growthValue + bonusPoints) - usedPoints

  let level = 1
  let levelName = '原木·见习者'
  let discountRate = 1.0
  let nextThreshold = 500

  if (isHonorary) {
    level = 99
    levelName = '荣誉馆长'
    discountRate = 0.85
    nextThreshold = 0
  } else if (growthValue >= 30000) {
    level = 5; levelName = '星陨·守护者'; discountRate = 0.85; nextThreshold = 0
  } else if (growthValue >= 10000) {
    level = 4; levelName = '曜石·策展人'; discountRate = 0.9; nextThreshold = 30000
  } else if (growthValue >= 3000) {
    level = 3; levelName = '流金·研究员'; discountRate = 0.95; nextThreshold = 10000
  } else if (growthValue >= 500) {
    level = 2; levelName = '秘银·采集家'; discountRate = 0.98; nextThreshold = 3000
  }

  return {
    totalAmount,
    orderCount,
    points: availablePoints,
    level,
    levelName,
    discountRate,
    growthValue,
    nextThreshold,
    isAdmin: !!(userInfo && userInfo.isAdmin),
    isHonorary
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  if (!openid) {
    return { success: false, msg: '未登录', authState: 'guest' }
  }

  try {
    const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const rawUser = userRes.data && userRes.data[0] ? userRes.data[0] : null
    const stats = await computeStats(openid, rawUser)
    const user = sanitizeUser(rawUser, openid)
    const profileScore = user ? user.profileScore : 0
    const authState = resolveAuthState(rawUser || {})
    const onboardingDone = !!(rawUser && rawUser.onboardingDone)

    return {
      success: true,
      openid,
      authState,
      onboardingDone,
      profileScore,
      memberNo: buildMemberNo(openid),
      user,
      stats
    }
  } catch (e) {
    console.error('getUserSession', e)
    return { success: false, msg: e.message || '加载失败', authState: 'guest' }
  }
}
