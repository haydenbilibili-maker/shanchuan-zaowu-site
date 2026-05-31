const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 优惠券领取功能
 * 支持：自动发放、手动领取、分享领取
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  const { 
    couponId,      // 优惠券ID（从coupons集合）
    receiveType,  // 领取类型：auto(自动发放), manual(手动领取), share(分享领取)
    shareUserId   // 分享者ID（分享领取时使用）
  } = event

  if (!couponId || !receiveType) {
    return {
      success: false,
      msg: '参数错误'
    }
  }

  try {
    // 1. 查询优惠券信息
    const couponRes = await db.collection('coupons').doc(couponId).get()
    if (!couponRes.data) {
      return {
        success: false,
        msg: '优惠券不存在'
      }
    }

    const coupon = couponRes.data

    // 2. 检查优惠券是否可用
    if (!coupon.active) {
      return {
        success: false,
        msg: '优惠券已下架'
      }
    }

    const now = new Date()
    if (coupon.startTime && new Date(coupon.startTime) > now) {
      return {
        success: false,
        msg: '优惠券尚未开始'
      }
    }
    if (coupon.endTime && new Date(coupon.endTime) < now) {
      return {
        success: false,
        msg: '优惠券已过期'
      }
    }

    // 3. 检查库存
    if (coupon.totalStock !== undefined && coupon.totalStock <= 0) {
      return {
        success: false,
        msg: '优惠券已领完'
      }
    }

    // 4. 检查用户是否已领取（根据领取限制）
    if (coupon.limitPerUser && coupon.limitPerUser > 0) {
      const userCouponsRes = await db.collection('user_coupons')
        .where({
          _openid: openid,
          couponId: couponId,
          status: _.in(['unused', 'used']) // 已使用和未使用的都算已领取
        })
        .count()

      if (userCouponsRes.total >= coupon.limitPerUser) {
        return {
          success: false,
          msg: `每人限领${coupon.limitPerUser}张`
        }
      }
    }

    // 5. 特殊类型检查
    if (coupon.type === 'newUser') {
      // 新人券：检查用户是否为新用户（首次下单）
      const orderRes = await db.collection('orders')
        .where({
          _openid: openid,
          status: _.in(['paid', 'shipped', 'received'])
        })
        .count()

      if (orderRes.total > 0) {
        return {
          success: false,
          msg: '新人券仅限新用户领取'
        }
      }
    }

    // 6. 创建用户优惠券记录
    const expireTime = coupon.expireDays 
      ? new Date(Date.now() + coupon.expireDays * 24 * 60 * 60 * 1000)
      : (coupon.expireTime || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))

    const userCouponData = {
      _openid: openid,
      couponId: couponId,
      title: coupon.name || coupon.title,
      type: coupon.type || 'cash',
      value: coupon.value,
      minSpend: coupon.condition ? parseFloat(coupon.condition.replace(/[^0-9.]/g, '')) || 0 : 0,
      status: 'unused',
      createTime: db.serverDate(),
      expireTime: expireTime,
      receiveType: receiveType,
      shareUserId: shareUserId || null,
      image: coupon.image || null
    }

    const addRes = await db.collection('user_coupons').add({
      data: userCouponData
    })

    // 7. 扣减优惠券库存
    if (coupon.totalStock !== undefined) {
      await db.collection('coupons').doc(couponId).update({
        data: {
          totalStock: _.inc(-1),
          receivedCount: _.inc(1)
        }
      })
    }

    // 8. 记录领取行为（用于数据分析）
    await db.collection('user_behaviors').add({
      data: {
        _openid: openid,
        action: 'receive_coupon',
        targetType: 'coupon',
        targetId: couponId,
        receiveType: receiveType,
        timestamp: Date.now()
      }
    })

    return {
      success: true,
      userCouponId: addRes._id,
      coupon: userCouponData
    }

  } catch (err) {
    console.error('领取优惠券失败:', err)
    return {
      success: false,
      msg: '领取失败，请稍后重试'
    }
  }
}





