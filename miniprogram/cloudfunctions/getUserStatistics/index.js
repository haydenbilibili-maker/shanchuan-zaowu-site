const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const SUPER_ADMIN_OPENIDS = [
  'oa22s5ZcMY7xkQDlNW8X8jaYy46M',
  'oa22s5RuZSXOCRQtXzdrVEiT1JuY'
]

async function isActiveStaff(openid) {
  if (!openid) return false
  let superList = SUPER_ADMIN_OPENIDS.slice()
  try {
    const acl = await db.collection('workspace_acl').doc('super_admins').get()
    const fromDb = Array.isArray((acl.data || {}).openids) ? acl.data.openids : []
    fromDb.forEach((id) => {
      const v = String(id || '').trim()
      if (v && superList.indexOf(v) === -1) superList.push(v)
    })
  } catch (e) { /* ignore */ }
  if (superList.indexOf(openid) !== -1) return true
  try {
    const res = await db.collection('staff_members').where({ openid, status: 'active' }).limit(1).get()
    if (res.data && res.data[0]) return true
  } catch (e) { /* ignore */ }
  try {
    const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const user = userRes.data && userRes.data[0]
    if (user && (user.isAdmin === true || user.staffRole === 'manager' || user.staffRole === 'staff')) {
      return true
    }
  } catch (e) { /* ignore */ }
  const admins = (process.env.MESSAGE_ADMIN_OPENIDS || '').split(',').map((s) => s.trim()).filter(Boolean)
  return admins.includes(openid)
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const callerOpenId = wxContext.OPENID || ''
  const targetOpenId = event.targetOpenId || callerOpenId

  if (!callerOpenId) {
    return { success: false, msg: '未登录', data: null }
  }

  if (targetOpenId !== callerOpenId) {
    const staff = await isActiveStaff(callerOpenId)
    if (!staff) {
      return { success: false, code: 'FORBIDDEN', msg: '仅可查看本人或店员查会员', data: null }
    }
  }

  try {
    // 1. 我的数据（浏览数、收藏数、分享数）
    const viewCount = await db.collection('user_behaviors')
      .where({
        userId: targetOpenId,
        action: 'view'
      })
      .count()

    const collectCount = await db.collection('user_behaviors')
      .where({
        userId: targetOpenId,
        action: 'collect'
      })
      .count()

    const shareCount = await db.collection('user_behaviors')
      .where({
        userId: targetOpenId,
        action: 'share'
      })
      .count()

    const searchCount = await db.collection('user_behaviors')
      .where({
        userId: targetOpenId,
        action: 'search'
      })
      .count()

    // 2. 消费统计（总消费、订单数、平均客单价）
    const ordersRes = await db.collection('orders')
      .where({
        _openid: targetOpenId,
        status: _.in(['paid', 'shipped', 'received'])
      })
      .get()

    let totalConsumption = 0
    const orderCount = ordersRes.data.length
    ordersRes.data.forEach(order => {
      if (order.totalPrice) {
        let price = parseFloat(order.totalPrice.toString().replace(/,/g, ''))
        if (!isNaN(price)) totalConsumption += price
      }
    })

    const avgOrderValue = orderCount > 0 ? (totalConsumption / orderCount).toFixed(2) : 0

    // 3. 学习记录（完成的课程、获得的证书）
    // 课程完成数（通过 bookings 中 type 为 'course' 且 status 为 'completed' 统计）
    const courseRes = await db.collection('bookings')
      .where({
        _openid: targetOpenId,
        type: 'course',
        status: _.in(['completed', 'confirmed'])
      })
      .count()

    // 证书数（通过 orders 中 status 为 'received' 且 type 不为 'coupon' 统计）
    const certificateRes = await db.collection('orders')
      .where({
        _openid: targetOpenId,
        status: 'received',
        type: _.neq('coupon')
      })
      .count()

    // 4. 收藏分类统计
    const collectionsRes = await db.collection('collections')
      .where({
        _openid: targetOpenId
      })
      .get()

    const collectionByType = {
      product: 0,
      activity: 0,
      course: 0
    }
    collectionsRes.data.forEach(item => {
      if (item.type && collectionByType.hasOwnProperty(item.type)) {
        collectionByType[item.type]++
      }
    })

    // 5. 最近活跃时间（最后一次行为时间）
    const lastBehaviorRes = await db.collection('user_behaviors')
      .where({
        userId: targetOpenId
      })
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get()

    const lastActiveTime = lastBehaviorRes.data.length > 0 
      ? lastBehaviorRes.data[0].timestamp 
      : null

    return {
      success: true,
      data: {
        // 我的数据
        viewCount: viewCount.total,
        collectCount: collectCount.total,
        shareCount: shareCount.total,
        searchCount: searchCount.total,
        
        // 消费统计
        totalConsumption: totalConsumption.toFixed(2),
        orderCount: orderCount,
        avgOrderValue: avgOrderValue,
        
        // 学习记录
        courseCount: courseRes.total,
        certificateCount: certificateRes.total,
        
        // 收藏分类
        collectionByType: collectionByType,
        
        // 活跃度
        lastActiveTime: lastActiveTime
      }
    }
  } catch (err) {
    console.error('获取用户统计失败:', err)
    return {
      success: false,
      msg: err.message,
      data: {
        viewCount: 0,
        collectCount: 0,
        shareCount: 0,
        searchCount: 0,
        totalConsumption: '0.00',
        orderCount: 0,
        avgOrderValue: '0.00',
        courseCount: 0,
        certificateCount: 0,
        collectionByType: { product: 0, activity: 0, course: 0 },
        lastActiveTime: null
      }
    }
  }
}








