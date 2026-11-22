const cloud = require('wx-server-sdk')
const { normalizeCouponChannel } = require('./couponChannel')
const {
  validateCashCoupon,
  validateDiscountCoupon,
  defaultMinSpendForValue,
  enforceCashMinSpend
} = require('./couponDiscountRules')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const DAY_MS = 24 * 60 * 60 * 1000
// 每人限领计数：locked（挂在待支付单上）也算已领，否则下单后可再领一张
const HELD_STATUSES = ['unused', 'available', 'locked', 'used']

/** 模板时刻字段 → Date；Date / ISO（须带时区）/ 毫秒 / {$date} 均可，无法解析返回 null */
function toInstant(raw) {
  if (raw == null || raw === '') return null
  const v = raw && typeof raw === 'object' && !(raw instanceof Date) && raw.$date != null ? raw.$date : raw
  const d = v instanceof Date ? new Date(v.getTime()) : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * 用户券到期时刻。
 * 模板有 fixedExpireTime（活动统一截止）→ 取它；同时有 expireDays → 取二者较早者。
 * 没有 fixedExpireTime 的旧模板：expireDays → 领取后 N 天，否则模板 expireTime，否则 30 天（与原逻辑逐字同义）。
 */
function resolveUserCouponExpire(coupon, nowMs) {
  const fixed = toInstant(coupon.fixedExpireTime)
  if (fixed) {
    if (coupon.expireDays) {
      const byDays = new Date(nowMs + coupon.expireDays * DAY_MS)
      return byDays.getTime() < fixed.getTime() ? byDays : fixed
    }
    return fixed
  }
  return coupon.expireDays
    ? new Date(nowMs + coupon.expireDays * DAY_MS)
    : (coupon.expireTime || new Date(nowMs + 30 * DAY_MS))
}

/** limitPerUser=1 的活动券用确定性 _id：并发双击只能写进一条 */
function campaignUserCouponId(couponId, openid) {
  const id = `cw_${couponId}_${openid}`
  return /^[\w-]{1,64}$/.test(id) ? id : ''
}

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
    if (coupon.fixedExpireTime != null && coupon.fixedExpireTime !== '') {
      const fixed = toInstant(coupon.fixedExpireTime)
      if (!fixed) return { success: false, msg: '优惠券配置异常，请稍后再试' }
      if (fixed.getTime() <= now.getTime()) return { success: false, msg: '优惠券已过期' }
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
          status: _.in(HELD_STATUSES)
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
      const orderRes = await db.collection('orders')
        .where({
          _openid: openid,
          status: _.in(['paid', 'shipped', 'received'])
        })
        .limit(100)
        .get()

      const hasPaidOrder = (orderRes.data || []).some((order) => {
        if (order.source === 'exchange') return false
        const price = parseFloat(String(order.totalPrice || 0).replace(/,/g, ''))
        return !isNaN(price) && price > 0
      })

      if (hasPaidOrder) {
        return {
          success: false,
          msg: '新人券仅限新用户领取'
        }
      }
    }

    // 6. 创建用户优惠券记录
    const expireTime = resolveUserCouponExpire(coupon, Date.now())

    const parseMinSpend = (coupon) => {
      if (coupon.minSpend != null && coupon.minSpend !== '') {
        const n = parseFloat(coupon.minSpend)
        if (!isNaN(n)) return n
      }
      if (coupon.condition) {
        const n = parseFloat(String(coupon.condition).replace(/[^0-9.]/g, ''))
        if (!isNaN(n)) return n
      }
      return 0
    }

    const couponType = coupon.type || 'cash'
    const couponValue = Number(coupon.value) || 0
    let minSpend = parseMinSpend(coupon)

    if (couponType === 'discount') {
      const rateCheck = validateDiscountCoupon(couponValue)
      if (!rateCheck.ok) {
        return { success: false, msg: rateCheck.msg || '折扣券不得低于7.5折' }
      }
    } else if (couponType !== 'freeShipping') {
      if (!(couponValue > 0)) {
        return { success: false, msg: '代金券面额无效' }
      }
      if (!(minSpend > 0)) {
        minSpend = defaultMinSpendForValue(couponValue)
      }
      const spendCheck = validateCashCoupon(couponValue, minSpend)
      if (!spendCheck.ok) {
        // 模板门槛过低时抬至地板后再发，避免运营误配阻断领取
        minSpend = enforceCashMinSpend(couponValue, minSpend)
        const again = validateCashCoupon(couponValue, minSpend)
        if (!again.ok) {
          return { success: false, msg: again.msg || '优惠券门槛配置违规' }
        }
      }
    }

    const userCouponData = {
      _openid: openid,
      couponId: couponId,
      title: coupon.name || coupon.title,
      type: couponType,
      value: coupon.value,
      minSpend,
      status: 'unused',
      createTime: db.serverDate(),
      expireTime: expireTime,
      receiveType: receiveType,
      shareUserId: shareUserId || null,
      image: coupon.image || null,
      // 从 coupons 模板热读；缺省 all
      channel: normalizeCouponChannel(coupon.channel),
      stackable: coupon.stackable === true
    }

    const fixedId = toInstant(coupon.fixedExpireTime) && Number(coupon.limitPerUser) === 1
      ? campaignUserCouponId(couponId, openid)
      : ''
    let addRes
    try {
      addRes = await db.collection('user_coupons').add({
        data: fixedId ? { ...userCouponData, _id: fixedId } : userCouponData
      })
    } catch (addErr) {
      if (fixedId) {
        const dup = await db.collection('user_coupons').where({ _id: fixedId }).count().catch(() => null)
        if (dup && dup.total > 0) return { success: false, msg: `每人限领${coupon.limitPerUser}张` }
      }
      throw addErr
    }

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





