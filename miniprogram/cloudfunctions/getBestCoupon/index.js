const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 自动匹配最优优惠券
 * 根据订单金额，自动选择最优惠的可用券
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  const { totalPrice } = event
  
  if (!totalPrice || totalPrice <= 0) {
    return {
      success: false,
      msg: '订单金额无效'
    }
  }

  try {
    const now = new Date()
    
    // 1. 查询用户所有未使用的有效优惠券
    const res = await db.collection('user_coupons')
      .where({
        _openid: openid,
        status: 'unused',
        expireTime: _.gt(now)
      })
      .get()

    if (!res.data || res.data.length === 0) {
      return {
        success: true,
        bestCoupon: null,
        savedAmount: 0
      }
    }

    // 2. 筛选可用券（满足使用门槛）
    const usableCoupons = res.data.filter(coupon => {
      const minSpend = coupon.minSpend || 0
      return totalPrice >= minSpend
    })

    if (usableCoupons.length === 0) {
      return {
        success: true,
        bestCoupon: null,
        savedAmount: 0,
        msg: '暂无可用优惠券'
      }
    }

    // 3. 计算每张券的优惠金额，选择最优券
    let bestCoupon = null
    let maxSaved = 0

    usableCoupons.forEach(coupon => {
      let saved = 0
      const type = coupon.type || 'cash' // cash: 满减, discount: 折扣, freeShipping: 免邮, newUser: 新人券
      
      switch (type) {
        case 'cash':
          // 满减券：直接减固定金额
          saved = coupon.value || 0
          break
        case 'discount':
          // 折扣券：按折扣率计算
          const discount = (coupon.value || 0) / 10 // value存储的是折扣值，如85表示8.5折
          saved = totalPrice * (1 - discount)
          break
        case 'freeShipping':
          // 免邮券：假设邮费为固定值（可根据实际情况调整）
          saved = 10 // 默认邮费10元
          break
        case 'newUser':
          // 新人券：通常也是满减
          saved = coupon.value || 0
          break
        default:
          saved = coupon.value || 0
      }

      if (saved > maxSaved) {
        maxSaved = saved
        bestCoupon = {
          ...coupon,
          savedAmount: saved
        }
      }
    })

    return {
      success: true,
      bestCoupon: bestCoupon,
      savedAmount: maxSaved,
      allCoupons: usableCoupons.map(c => ({
        _id: c._id,
        title: c.title,
        type: c.type || 'cash',
        value: c.value,
        minSpend: c.minSpend
      }))
    }

  } catch (err) {
    console.error('获取最优优惠券失败:', err)
    return {
      success: false,
      msg: '系统繁忙，请稍后重试'
    }
  }
}





