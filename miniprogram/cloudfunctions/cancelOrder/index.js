const cloud = require('wx-server-sdk')
const { dispatchInAppMessage } = require('./inAppMessage')
const { releaseOrderStockHold } = require('./stockUtils')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const WALLET_INTERNAL_KEY = process.env.STORED_VALUE_CALLBACK_KEY || process.env.PAY_CALLBACK_INTERNAL_KEY || ''

async function releaseHeldWallet(orderId, openid, remark) {
  try {
    const payload = {
      action: 'refundWalletForOrder',
      orderId,
      openid,
      remark: remark || '取消订单·钱包回账'
    }
    if (WALLET_INTERNAL_KEY) payload.internalKey = WALLET_INTERNAL_KEY
    const res = await cloud.callFunction({
      name: 'manageStoredValue',
      data: payload
    })
    return (res && res.result) || { success: false }
  } catch (e) {
    console.error('cancelOrder releaseHeldWallet failed', e)
    return { success: false, msg: e.message || '钱包回账失败' }
  }
}

async function unlockCoupon(order, orderId) {
  if (!order.couponId) return
  try {
    const couponRes = await db.collection('user_coupons').doc(order.couponId).get()
    const coupon = couponRes.data
    if (
      coupon &&
      coupon.status === 'locked' &&
      (!coupon.lockedOrderId || coupon.lockedOrderId === orderId)
    ) {
      await db.collection('user_coupons').doc(order.couponId).update({
        data: {
          status: 'unused',
          lockedOrderId: _.remove(),
          lockedTime: _.remove()
        }
      })
    }
  } catch (couponErr) {
    console.warn('cancelOrder coupon unlock failed:', couponErr && couponErr.message)
  }
}

/**
 * 取消待付款订单（用户主动 / 过期）。
 * 释放顺序：钱包 held → 库存预占 → 置 void → 解锁券 → 站内信
 *
 * 定时批量关单见云函数 sweepExpiredOrders（TimerTrigger）。
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { orderId, reason } = event

  if (!orderId) {
    return { success: false, msg: '订单 ID 无效' }
  }

  try {
    const orderRes = await db.collection('orders').doc(orderId).get()
    const order = orderRes.data

    if (!order || order._openid !== openid) {
      return { success: false, msg: '订单不存在' }
    }

    if (order.status === 'fulfilling') {
      return { success: false, msg: '支付确认中，请稍后刷新后再试' }
    }

    if (order.status !== 'pending_pay') {
      return { success: false, msg: '当前状态不可取消' }
    }

    if (reason !== 'expired' && order.payExpireTime) {
      const expireAt = new Date(order.payExpireTime).getTime()
      if (Date.now() > expireAt) {
        return { success: false, msg: '订单已过期，请刷新列表' }
      }
    }

    // 先原子 void，再释放钱包/库存/券，避免与支付履约竞态
    const voidClaim = await db.collection('orders').where({
      _id: orderId,
      status: 'pending_pay'
    }).update({
      data: {
        status: 'void',
        cancelTime: db.serverDate(),
        cancelReason: reason || 'user'
      }
    })
    const voided = voidClaim && voidClaim.stats
      ? Number(voidClaim.stats.updated != null ? voidClaim.stats.updated : voidClaim.stats.updatedCount) || 0
      : 0
    if (voided <= 0) {
      return { success: false, msg: '订单状态已变化，请刷新' }
    }

    let walletRefund = null
    if (order.walletDebitStatus === 'held' || (Number(order.walletPaidFen) || 0) > 0) {
      walletRefund = await releaseHeldWallet(
        orderId,
        openid,
        reason === 'expired' ? '支付超时·钱包回账' : '取消订单·钱包回账'
      )
      if (walletRefund && walletRefund.success === false && !walletRefund.nothingToRefund) {
        console.warn('cancelOrder wallet refund incomplete', walletRefund)
      }
    }

    let stockRelease = null
    try {
      stockRelease = await releaseOrderStockHold(db, _, { ...order, _id: orderId })
    } catch (stockErr) {
      console.warn('cancelOrder stock release failed', stockErr && stockErr.message)
    }

    await unlockCoupon(order, orderId)

    await dispatchInAppMessage(db, {
      eventType: 'order_cancelled',
      openid,
      relatedId: orderId,
      vars: {
        orderNo: order.orderNo || '',
        reason: reason === 'expired' ? '支付超时自动取消' : '您已取消订单'
      }
    }).catch((err) => console.warn('order_cancelled message failed:', err))

    return {
      success: true,
      walletRefundedFen: (walletRefund && walletRefund.creditedFen) || 0,
      walletRefund,
      stockRelease
    }
  } catch (err) {
    console.error('cancelOrder error:', err)
    return { success: false, msg: err.message || '取消失败' }
  }
}
