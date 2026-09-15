/**
 * 超时待支付订单清扫
 *
 * 职责：
 * 1. 将 payExpireTime 已过的 pending_pay 置 void
 * 2. 释放钱包 held、库存预占、锁定优惠券
 * 3. 发送 order_cancelled 站内信
 *
 * 触发：
 * - 云函数定时触发器（config.json triggers，每 5 分钟）
 * - 手动：callFunction({ name:'sweepExpiredOrders', data:{ action:'sweep', internalKey } })
 *   （须携带 SWEEP_EXPIRED_INTERNAL_KEY / PAY_CALLBACK_INTERNAL_KEY；禁止客户端空调用）
 *
 * 部署后请在云开发控制台确认 Timer 已启用；若控制台未自动创建触发器，
 * 可按 config.json 中 cron「每 5 分钟」手工添加（形如 0 星/5 * * * * *）。
 *
 * 索引建议（orders）：status + payExpireTime（复合）
 * 不处理礼赠填址超时/退款（属逆向链路 manageGift / refund）。
 */
const cloud = require('wx-server-sdk')
const { dispatchInAppMessage } = require('./inAppMessage')
const { releaseOrderStockHold } = require('./stockUtils')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const WALLET_INTERNAL_KEY =
  process.env.STORED_VALUE_CALLBACK_KEY || process.env.PAY_CALLBACK_INTERNAL_KEY || ''
const SWEEP_INTERNAL_KEY =
  process.env.SWEEP_EXPIRED_INTERNAL_KEY || process.env.PAY_CALLBACK_INTERNAL_KEY || WALLET_INTERNAL_KEY || ''

const BATCH_LIMIT = 40

/**
 * 是否「非客户端来源」。实测定时触发时 wxContext.SOURCE 为空字符串，
 * 小程序客户端必带 wx_client / wx_devtools —— 该判定 C 端无法伪造。
 * event.Type / TriggerName / _internal / _fromApproval / _callerOpenid 等字段
 * 均由调用方控制，**不得单独作为授权依据**。
 */
function isNonClientSource() {
  try {
    const src = String((cloud.getWXContext() || {}).SOURCE || '')
    return !/wx_client|wx_devtools/i.test(src)
  } catch (e) {
    return false
  }
}

function isTimerEvent(event) {
  const triggerType = (event && (event.Type || eventTriggerType(event))) || ''
  return /timer/i.test(String(triggerType)) || !!(event && event.TriggerName)
}

function eventTriggerType(event) {
  return (event && (event.triggerType || event.triggerSource)) || ''
}

function allowManualSweep(event) {
  if (!SWEEP_INTERNAL_KEY) return false
  const key = String((event && (event.internalKey || event.callbackKey)) || '').trim()
  return !!(key && key === SWEEP_INTERNAL_KEY)
}

async function releaseHeldWallet(orderId, openid, remark) {
  try {
    const payload = {
      action: 'refundWalletForOrder',
      orderId,
      openid,
      remark: remark || '支付超时·钱包回账'
    }
    if (WALLET_INTERNAL_KEY) payload.internalKey = WALLET_INTERNAL_KEY
    const res = await cloud.callFunction({
      name: 'manageStoredValue',
      data: payload
    })
    return (res && res.result) || { success: false }
  } catch (e) {
    console.warn('sweepExpiredOrders wallet release', orderId, e && e.message)
    return { success: false, msg: e.message || '回账失败' }
  }
}

async function unlockCoupon(order, orderId) {
  if (!order.couponId) return { unlocked: false }
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
      return { unlocked: true }
    }
  } catch (e) {
    console.warn('sweepExpiredOrders coupon unlock', orderId, e && e.message)
  }
  return { unlocked: false }
}

/**
 * 原子抢占：仅 pending_pay → void，避免与用户支付/取消竞态
 */
async function claimExpiredOrder(orderId) {
  const res = await db.collection('orders').where({
    _id: orderId,
    status: 'pending_pay'
  }).update({
    data: {
      status: 'void',
      cancelTime: db.serverDate(),
      cancelReason: 'expired_sweep'
    }
  })
  const n = res && res.stats
    ? Number(res.stats.updated != null ? res.stats.updated : res.stats.updatedCount) || 0
    : 0
  return n > 0
}

async function expireOneOrder(order) {
  const orderId = order._id
  const openid = order._openid

  // 先原子 void，再释放资源，避免「已释库存却被支付履约」竞态
  const claimed = await claimExpiredOrder(orderId)
  if (!claimed) {
    return { orderId, skipped: true, reason: 'claim_failed_or_paid' }
  }

  if (order.walletDebitStatus === 'held' || (Number(order.walletPaidFen) || 0) > 0) {
    await releaseHeldWallet(orderId, openid, '支付超时·定时清扫回账')
  }

  let stockRelease = null
  try {
    stockRelease = await releaseOrderStockHold(db, _, { ...order, _id: orderId })
  } catch (e) {
    console.warn('sweep stock release', orderId, e && e.message)
  }

  const coupon = await unlockCoupon(order, orderId)

  await dispatchInAppMessage(db, {
    eventType: 'order_cancelled',
    openid,
    relatedId: orderId,
    vars: {
      orderNo: order.orderNo || '',
      reason: '支付超时自动取消'
    }
  }).catch((err) => console.warn('sweep message', err))

  return {
    orderId,
    expired: true,
    stockReleased: !!(stockRelease && stockRelease.released),
    couponUnlocked: !!(coupon && coupon.unlocked)
  }
}

/** 补偿：已 void 但库存预占未释放的订单 */
async function repairUnreleasedHolds(limit) {
  let rows = []
  try {
    const res = await db.collection('orders')
      .where({
        status: 'void',
        stockHeld: true,
        stockHoldReleased: false
      })
      .limit(limit)
      .get()
    rows = res.data || []
  } catch (e) {
    console.warn('repairUnreleasedHolds query fallback', e && e.message)
    return { repaired: 0, skipped: true, reason: e.message }
  }

  let repaired = 0
  for (const order of rows) {
    if (order.stockHoldConsumed || order.fulfillStockDone) continue
    try {
      const r = await releaseOrderStockHold(db, _, { ...order, _id: order._id })
      if (r && r.released) {
        repaired += 1
      }
    } catch (err) {
      console.warn('repair hold', order._id, err && err.message)
    }
  }
  return { repaired, scanned: rows.length }
}

async function sweepExpiredPending(limit) {
  const now = new Date()
  let rows = []
  try {
    const res = await db.collection('orders')
      .where({
        status: 'pending_pay',
        payExpireTime: _.lt(now)
      })
      .limit(limit)
      .get()
    rows = res.data || []
  } catch (e) {
    // 无复合索引时回落：只按 status 拉一批再本地过滤
    console.warn('sweepExpiredOrders indexed query fallback:', e && e.message)
    const res = await db.collection('orders')
      .where({ status: 'pending_pay' })
      .orderBy('createTime', 'asc')
      .limit(Math.min(100, limit * 2))
      .get()
    rows = (res.data || []).filter((o) => {
      if (!o.payExpireTime) return false
      return new Date(o.payExpireTime).getTime() < now.getTime()
    }).slice(0, limit)
  }

  const results = []
  for (const order of rows) {
    try {
      results.push(await expireOneOrder(order))
    } catch (err) {
      console.error('sweepExpiredOrders one failed', order._id, err)
      results.push({ orderId: order._id, success: false, msg: err.message })
    }
  }

  const repair = await repairUnreleasedHolds(Math.min(20, limit)).catch((e) => ({
    repaired: 0,
    error: e.message
  }))

  return {
    success: true,
    scanned: rows.length,
    expired: results.filter((r) => r.expired).length,
    skipped: results.filter((r) => r.skipped).length,
    repair,
    results
  }
}

/**
 * 快递单自动收货
 *
 * 问题：`status:'received'` 此前只有 4 个被动写入点（用户点签收 / 店长确认自取 /
 * 扫码核销 / 礼赠领取），**没有任何定时终结** → 用户忘记点签收的订单会永久停在
 * 「待收货」，连带赠分、收藏证书、养护提醒全部不触发。
 *
 * 策略：发货（logistics.shipTime）满 AUTO_RECEIVE_DAYS 天自动确认收货，
 * 复用 grantStorePoints.grantOnlineOrder 赠分（按订单幂等，重复执行不会重复入账）。
 * 如需关闭，把 AUTO_RECEIVE_DAYS 设为 0。
 */
function toMs(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'object' && v.$date) return new Date(v.$date).getTime()
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}

const AUTO_RECEIVE_DAYS = 15
const AUTO_RECEIVE_BATCH = 20

async function autoReceiveShipped(limit = AUTO_RECEIVE_BATCH) {
  if (!(AUTO_RECEIVE_DAYS > 0)) return { enabled: false, scanned: 0, received: 0 }
  const deadline = Date.now() - AUTO_RECEIVE_DAYS * 24 * 60 * 60 * 1000

  let rows = []
  try {
    const res = await db.collection('orders')
      .where({ status: 'shipped' })
      .orderBy('createTime', 'asc')
      .limit(Math.min(100, limit * 3))
      .get()
    rows = res.data || []
  } catch (e) {
    console.warn('autoReceiveShipped query failed:', e && e.message)
    return { enabled: true, scanned: 0, received: 0, error: e && e.message }
  }

  const due = rows.filter((o) => {
    const t = toMs((o.logistics && o.logistics.shipTime) || o.shipTime || o.updateTime || o.paidTime)
    return t && t < deadline
  }).slice(0, limit)

  const results = []
  for (const order of due) {
    try {
      // 条件更新：只有仍是 shipped 才推进，避免与用户手动签收竞争
      const upd = await db.collection('orders')
        .where({ _id: order._id, status: 'shipped' })
        .update({
          data: {
            status: 'received',
            receiveTime: db.serverDate(),
            autoReceived: true,
            autoReceivedAt: db.serverDate(),
            pointsGrantRequestedAt: db.serverDate()
          }
        })
      const updated = (upd && upd.stats && upd.stats.updated) || (upd && upd.updated) || 0
      if (!updated) {
        results.push({ orderId: order._id, skipped: true })
        continue
      }
      // 赠分：按订单幂等（内部互调，SOURCE=scf）
      let granted = 0
      try {
        const g = await cloud.callFunction({
          name: 'grantStorePoints',
          data: { action: 'grantOnlineOrder', orderId: order._id, __fromReceipt: true }
        })
        granted = Number((g && g.result && g.result.pointsGranted) || 0)
      } catch (e) {
        console.warn('autoReceive grant failed', order._id, e && e.message)
      }
      results.push({ orderId: order._id, received: true, pointsGranted: granted })
    } catch (e) {
      console.error('autoReceive one failed', order._id, e)
      results.push({ orderId: order._id, success: false, msg: e && e.message })
    }
  }

  return {
    enabled: true,
    days: AUTO_RECEIVE_DAYS,
    scanned: rows.length,
    due: due.length,
    received: results.filter((r) => r.received).length,
    results
  }
}

exports.main = async (event = {}) => {
  const action = (event && event.action) || ''
  // 定时判定必须叠加「非客户端来源」：否则 C 端伪造 Type/TriggerName 即可手动触发清扫
  const timer = isTimerEvent(event) && isNonClientSource()

  // 仅定时触发，或带 INTERNAL_KEY 的手动 sweep；禁止客户端空调用 / !action 隐式触发
  const manualOk =
    (action === 'sweep' || action === 'sweepExpired') && allowManualSweep(event)
  if (!timer && !manualOk) {
    return { success: false, code: 'FORBIDDEN', msg: '仅允许定时触发或内部调用', action: action || '(empty)' }
  }

  const limit = Math.min(
    BATCH_LIMIT,
    Math.max(1, parseInt(event && event.limit, 10) || BATCH_LIMIT)
  )
  console.log('sweepExpiredOrders start', { timer, action, limit, manualOk })
  const expired = await sweepExpiredPending(limit)
  // 同一 5 分钟定时器顺带执行快递单自动收货（发货满 AUTO_RECEIVE_DAYS 天）
  const autoReceive = await autoReceiveShipped(Math.min(AUTO_RECEIVE_BATCH, limit)).catch((e) => ({
    enabled: true,
    error: e && e.message
  }))
  return { ...expired, autoReceive }
}
