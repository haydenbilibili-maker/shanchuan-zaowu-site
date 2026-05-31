const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function formatCouponLabel(coupon) {
  const type = coupon.type || 'cash'
  const minSpend = coupon.minSpend
    || (coupon.condition ? parseFloat(String(coupon.condition).replace(/[^0-9.]/g, '')) : 0)
    || 0
  const value = coupon.value || 0

  if (type === 'discount') return `${value / 10}折`
  if (type === 'freeShipping') return minSpend > 0 ? `满${minSpend}免邮` : '免邮券'
  if (type === 'newUser') return minSpend > 0 ? `新人满${minSpend}减${value}` : `新人减${value}`
  if (minSpend > 0) return `满${minSpend}减${value}`
  return `${value}元券`
}

function calcSaved(coupon, totalPrice) {
  const type = coupon.type || 'cash'
  const value = coupon.value || 0
  switch (type) {
    case 'discount':
      return totalPrice * (1 - value / 10)
    case 'freeShipping':
      return 15
    default:
      return value
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const productPrice = parseFloat(event.productPrice) || 0
  const now = new Date()

  try {
    let claimable = []
    try {
      const res = await db.collection('coupons').where({ active: true }).limit(30).get()
      claimable = (res.data || []).filter((c) => {
        if (c.totalStock !== undefined && c.totalStock <= 0) return false
        if (c.startTime && new Date(c.startTime) > now) return false
        if (c.endTime && new Date(c.endTime) < now) return false
        return true
      })
    } catch (e) {
      console.warn('coupons 集合读取失败', e)
    }

    const claimableCoupons = []
    for (const coupon of claimable) {
      let claimed = false
      if (openid && coupon.limitPerUser) {
        const countRes = await db.collection('user_coupons').where({
          _openid: openid,
          couponId: coupon._id,
          status: _.in(['unused', 'used'])
        }).count()
        claimed = countRes.total >= coupon.limitPerUser
      }
      claimableCoupons.push({
        _id: coupon._id,
        title: coupon.name || coupon.title || '优惠券',
        type: coupon.type || 'cash',
        value: coupon.value || 0,
        minSpend: coupon.minSpend
          || (coupon.condition ? parseFloat(String(coupon.condition).replace(/[^0-9.]/g, '')) : 0)
          || 0,
        label: formatCouponLabel(coupon),
        claimed
      })
    }

    let bestCoupon = null
    let savedAmount = 0
    let usableCount = 0

    if (openid && productPrice > 0) {
      const userRes = await db.collection('user_coupons').where({
        _openid: openid,
        status: 'unused',
        expireTime: _.gt(now)
      }).get()

      const usable = (userRes.data || []).filter((c) => productPrice >= (c.minSpend || 0))
      usableCount = usable.length

      usable.forEach((coupon) => {
        const saved = calcSaved(coupon, productPrice)
        if (saved > savedAmount) {
          savedAmount = saved
          bestCoupon = {
            _id: coupon._id,
            title: coupon.title || '优惠券',
            type: coupon.type || 'cash',
            value: coupon.value || 0,
            minSpend: coupon.minSpend || 0,
            label: formatCouponLabel(coupon),
            savedAmount: saved
          }
        }
      })
    }

    return {
      success: true,
      claimableCoupons,
      bestCoupon,
      savedAmount: Math.round(savedAmount * 100) / 100,
      usableCount
    }
  } catch (err) {
    console.error('getProductCoupons failed', err)
    return { success: false, msg: '加载优惠券失败' }
  }
}
