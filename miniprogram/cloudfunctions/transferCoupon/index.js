const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 优惠券转赠功能
 * 用户可以将自己的优惠券转赠给好友
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  const { 
    userCouponId,  // 用户优惠券ID
    targetOpenid   // 接收者openid
  } = event

  if (!userCouponId || !targetOpenid) {
    return {
      success: false,
      msg: '参数错误'
    }
  }

  if (openid === targetOpenid) {
    return {
      success: false,
      msg: '不能转赠给自己'
    }
  }

  try {
    // 1. 查询用户优惠券
    const userCouponRes = await db.collection('user_coupons').doc(userCouponId).get()
    if (!userCouponRes.data) {
      return {
        success: false,
        msg: '优惠券不存在'
      }
    }

    const userCoupon = userCouponRes.data

    // 2. 验证权限（只能转赠自己的券）
    if (userCoupon._openid !== openid) {
      return {
        success: false,
        msg: '无权限操作'
      }
    }

    // 3. 检查优惠券状态
    const status = String(userCoupon.status || '').toLowerCase()
    if (status !== 'unused' && status !== 'available') {
      return {
        success: false,
        msg: '只能转赠未使用的优惠券'
      }
    }

    // 4. 检查是否过期
    const now = new Date()
    const expireAt = userCoupon.expireTime || userCoupon.expire_time
    if (expireAt && new Date(expireAt) < now) {
      return {
        success: false,
        msg: '优惠券已过期，无法转赠'
      }
    }

    // 5. 检查接收者是否存在
    const targetUserRes = await db.collection('users')
      .where({ _openid: targetOpenid })
      .get()

    if (targetUserRes.data.length === 0) {
      return {
        success: false,
        msg: '接收者不存在'
      }
    }

    // 6. 更新优惠券所有者
    await db.collection('user_coupons').doc(userCouponId).update({
      data: {
        _openid: targetOpenid,
        transferTime: db.serverDate(),
        transferFrom: openid
      }
    })

    // 7. 记录转赠行为
    await db.collection('user_behaviors').add({
      data: {
        _openid: openid,
        action: 'transfer_coupon',
        targetType: 'coupon',
        targetId: userCouponId,
        targetOpenid: targetOpenid,
        timestamp: Date.now()
      }
    })

    return {
      success: true,
      msg: '转赠成功'
    }

  } catch (err) {
    console.error('转赠优惠券失败:', err)
    return {
      success: false,
      msg: '转赠失败，请稍后重试'
    }
  }
}





