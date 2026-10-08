const cloud = require('wx-server-sdk')
const { fulfillOrder } = require('./fulfillOrder')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const SUB_MCH_ID = process.env.WX_PAY_SUB_MCH_ID || ''
/** 仅开发/体验显式开启；生产默认关闭，禁止无支付凭证时直接履约 */
const ALLOW_MOCK_PAY = process.env.ALLOW_MOCK_PAY === '1'

/**
 * Admin Web 经 /api/cloud-fn 代理调用时会带上 ADMIN_OPS_KEY（服务端注入，前端不持有）。
 * 与 staffGuard 内的同名分支等价，用于「补履约」这类仅超管可做的动作。
 */
function isAdminOpsCall(event) {
  const expected = String(process.env.ADMIN_OPS_KEY || '').trim()
  const got = String((event && event.adminOpsKey) || '').trim()
  return !!expected && !!got && expected === got
}

/**
 * 超管补履约：用户微信已实扣、但支付回调缺失（如 2026-09-15 回调误判事故）时，
 * 由 Admin Web 核对微信商户平台流水后补写支付证据并履约。
 * 幂等：fulfillOrder 内部有 pending_pay → fulfilling 原子抢占。
 */
async function adminFulfillAction(event) {
  const orderId = String((event && event.orderId) || '').trim()
  if (!orderId) return { success: false, msg: '缺少订单 ID' }

  let order = null
  try {
    const res = await db.collection('orders').doc(orderId).get()
    order = res && res.data
  } catch (e) {
    order = null
  }
  if (!order) return { success: false, msg: '订单不存在' }

  if (['paid', 'paid_awaiting_address', 'ready_pickup', 'shipped', 'received'].includes(String(order.status))) {
    return { success: true, alreadyPaid: true, orderId, status: order.status }
  }
  if (order.status !== 'pending_pay' && order.status !== 'fulfilling') {
    return { success: false, msg: `订单状态不可补履约：${order.status}` }
  }

  const transactionId = String(
    (event && (event.transactionId || event.transaction_id)) || order.wxTransactionId || ''
  ).trim()

  await db.collection('orders').doc(orderId).update({
    data: {
      wxPayMode: 'wechat',
      wxTransactionId: transactionId,
      reconciledBy: 'admin_web',
      reconciledAt: db.serverDate(),
      reconcileNote: String((event && event.note) || '').slice(0, 120)
    }
  }).catch((e) => console.warn('adminFulfill mark paid failed', e && e.message))

  let result
  try {
    result = await fulfillOrder(db, _, orderId, order._openid, {
      source: 'confirmPayment',
      honorPaidEvidenceOnTimeout: false
    })
  } catch (e) {
    const msg = String((e && e.message) || e || '')
    if (/超时/.test(msg)) {
      return { success: false, code: 'ORDER_EXPIRED_VOID', orderId, msg: '订单已过期作废，请走退款' }
    }
    return { success: false, code: 'ADMIN_FULFILL_FAILED', orderId, msg: `补履约失败：${msg || '未知错误'}` }
  }
  if (result && result.manualRefundRequired) {
    return { success: false, code: 'ORDER_EXPIRED_VOID', orderId, msg: '订单已过期作废，请走退款' }
  }
  return {
    success: true,
    orderId,
    transactionId,
    msg: '补履约已执行',
    fulfill: result
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { orderId } = event

  // 超管补履约（仅 Admin Web 代理可触发，见 isAdminOpsCall）
  if (String((event && event.action) || '').trim() === 'adminFulfill') {
    if (!isAdminOpsCall(event)) {
      return { success: false, code: 'FORBIDDEN', msg: '仅超管（Admin Web）可补履约' }
    }
    return await adminFulfillAction(event)
  }

  if (!orderId) {
    return { success: false, msg: '缺少订单 ID' }
  }

  try {
    const orderRes = await db.collection('orders').doc(orderId).get()
    const order = orderRes.data

    if (!order || order._openid !== openid) {
      return { success: false, msg: '订单不存在' }
    }

    if (order.status === 'paid' || order.status === 'paid_awaiting_address' || order.status === 'ready_pickup' || order.status === 'shipped' || order.status === 'received') {
      return { success: true, alreadyPaid: true, orderId }
    }

    // fulfilling：支付回调与客户端确认可能并行，交由 fulfillOrder 幂等收束
    if (order.status !== 'pending_pay' && order.status !== 'fulfilling') {
      return { success: false, msg: '订单状态不可确认支付', status: order.status }
    }

    const hasWxPayEvidence = !!(order.wxTransactionId || order.wxPayMode === 'wechat')
    const hasWalletFullPay = order.wxPayMode === 'wallet' || (
      Number(order.walletPaidFen) > 0 &&
      order.paymentBreakdown &&
      Number(order.paymentBreakdown.wxpayFen) === 0
    )

    // 无支付凭证时：
    // - 全额钱包已扣：可履约
    // - ALLOW_MOCK_PAY=1：仅开发/体验可 mock 履约
    // - 已配商户：禁止白嫖，等 payCallback 写入交易号后再履约（或已有证据）
    // - 未配商户且未开 mock：拒绝
    if (!hasWxPayEvidence && !hasWalletFullPay) {
      if (ALLOW_MOCK_PAY) {
        await db.collection('orders').doc(orderId).update({
          data: { wxPayMode: 'mock' }
        }).catch(() => {})
      } else if (SUB_MCH_ID) {
        return {
          success: false,
          pendingConfirm: true,
          code: 'AWAITING_CALLBACK',
          msg: '支付结果确认中，请稍后刷新订单'
        }
      } else {
        return {
          success: false,
          msg: '支付未开通，订单仍为待支付',
          code: 'PAY_NOT_ENABLED'
        }
      }
    }

    const result = await fulfillOrder(db, _, orderId, openid, { source: 'confirmPayment' })
    if (result && result.manualRefundRequired) {
      return {
        success: false,
        code: 'PAID_ORDER_VOID',
        orderId,
        msg: '订单已超时作废，已付款项将由客服人工退回'
      }
    }
    if (result && result.success && order.walletDebitStatus === 'held') {
      await db.collection('orders').doc(orderId).update({
        data: { walletDebitStatus: 'consumed', updateTime: db.serverDate() }
      }).catch(() => {})
    }
    return result
  } catch (err) {
    console.error('confirmPayment error:', err)
    return { success: false, msg: err.message || '支付确认失败' }
  }
}
