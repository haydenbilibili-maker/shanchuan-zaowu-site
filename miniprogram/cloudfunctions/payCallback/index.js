const cloud = require('wx-server-sdk')
const { fulfillOrder } = require('./fulfillOrder')
const { creditRechargeOrder, RECHARGE_ORDERS } = require('./storedValueCredit')
const { withCollectionRetry } = require('./storedValueCollections')
const { isClientSource } = require('./sourceOrigin')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command


/**
 * 拒绝小程序直调伪造回调。
 *
 * ✅ 判定依据：`wxContext.SOURCE`（由平台上下文决定，客户端无法伪造）。
 *    - 小程序端调用 → `wx_client`；开发者工具 → `wx_devtools`。
 *    - 微信支付平台回调是云端发起，SOURCE 不是上述两者。
 *
 * ⛔ 不要用「有没有 OPENID」来判定伪造！
 *    `cloud.cloudPay.unifiedOrder` 是带付款人 openid 下单的，平台回调同样会带该 OPENID；
 *    2026-09-14 曾据此把**所有真实回调**判为伪造并返回 SUCCESS（微信不再重试），
 *    导致「支付成功但订单仍待支付」「钱包充值不到账」（2026-09-15 事故根因，已回退该条件）。
 */
function rejectClientForgery(event) {
  try {
    const wxContext = cloud.getWXContext()
    const source = String(wxContext.SOURCE || '')
    // 每次回调都记录上下文，便于下次排障（客户端伪造时这里能看到 source=wx_client）
    console.log('payCallback context:', {
      source,
      hasOpenid: !!wxContext.OPENID,
      outTradeNo: (event && (event.outTradeNo || event.out_trade_no)) || ''
    })
    if (isClientSource()) {
      console.warn('payCallback: rejected client/forged call', {
        source,
        hasOpenid: !!wxContext.OPENID
      })
      return { errcode: 0, errmsg: 'IGNORED' }
    }
  } catch (e) {
    console.warn('payCallback: getWXContext failed', e && e.message)
  }
  return null
}

/** 与 payOrder.resolvePayFen 对齐：订单应付微信金额（分） */
function resolveExpectedPayFen(order) {
  if (!order) return 0
  const breakdown = order.paymentBreakdown || {}
  const fenCandidates = [breakdown.wxpayFen, breakdown.totalFen, order.totalFeeFen, order.payFen]
  for (const raw of fenCandidates) {
    if (raw == null || raw === '') continue
    const fen = Math.round(Number(raw))
    if (Number.isFinite(fen) && fen > 0) return fen
  }
  const yuanCandidates = [order.totalPrice, order.goodsPrice, order.originalPrice]
  for (const raw of yuanCandidates) {
    if (raw == null || raw === '') continue
    const yuan = parseFloat(String(raw).replace(/,/g, '').replace(/[¥￥\s]/g, ''))
    if (!Number.isFinite(yuan) || yuan <= 0) continue
    const fen = Math.round(yuan * 100)
    if (fen > 0) return fen
  }
  return 0
}

function resolveCallbackPayFen(event) {
  const raw =
    event.totalFee != null
      ? event.totalFee
      : event.total_fee != null
        ? event.total_fee
        : event.cashFee != null
          ? event.cashFee
          : event.cash_fee
  if (raw == null || raw === '') return null
  const fen = Math.round(Number(raw))
  return Number.isFinite(fen) && fen > 0 ? fen : null
}

function isStoredValueOutTradeNo(outTradeNo) {
  return /^SV/i.test(String(outTradeNo || ''))
}

async function fulfillStoredValueRecharge(outTradeNo, transactionId) {
  const order = await withCollectionRetry(db, RECHARGE_ORDERS, async () => {
    const res = await db.collection(RECHARGE_ORDERS).where({ outTradeNo }).limit(1).get()
    return (res.data && res.data[0]) || null
  })

  if (!order) {
    console.error('payCallback: stored value recharge not found', outTradeNo)
    return { errcode: 0, errmsg: 'SUCCESS' }
  }

  if (transactionId) {
    await db.collection(RECHARGE_ORDERS).doc(order._id).update({
      data: {
        transactionId,
        wxPayMode: 'wechat',
        status: order.status === 'credited' ? 'credited' : 'paid',
        updateTime: db.serverDate()
      }
    }).catch((e) => console.warn('payCallback sv update tx', e && e.message))
  } else if (order.status === 'pending') {
    await db.collection(RECHARGE_ORDERS).doc(order._id).update({
      data: {
        status: 'paid',
        wxPayMode: 'wechat',
        updateTime: db.serverDate()
      }
    }).catch(() => {})
  }

  const latestRes = await db.collection(RECHARGE_ORDERS).doc(order._id).get()
  const latest = latestRes.data ? { ...latestRes.data, _id: order._id } : order

  const result = await creditRechargeOrder(db, _, latest, {
    transactionId: transactionId || latest.transactionId || '',
    wxPayMode: 'wechat'
  })

  if (!result.success) {
    console.error('payCallback: stored value credit failed', outTradeNo, result)
    return { errcode: -1, errmsg: result.msg || 'credit failed' }
  }

  return { errcode: 0, errmsg: 'SUCCESS' }
}

/**
 * 微信支付结果回调（cloudPay unifiedOrder 的 functionName）
 * - 普通商品单：orders.orderNo
 * - 储值充值单：outTradeNo 以 SV 开头 → stored_value_recharge_orders
 * 仅接受平台/云端回调；拒绝小程序客户端伪造。
 */
exports.main = async (event) => {
  console.log('payCallback event:', JSON.stringify(event))

  const rejected = rejectClientForgery(event)
  if (rejected) return rejected

  const returnCode = event.returnCode || event.return_code
  const resultCode = event.resultCode || event.result_code
  const outTradeNo = event.outTradeNo || event.out_trade_no

  if (returnCode !== 'SUCCESS' || resultCode !== 'SUCCESS') {
    return { errcode: 0, errmsg: 'FAIL' }
  }

  if (!outTradeNo) {
    return { errcode: -1, errmsg: 'missing outTradeNo' }
  }

  try {
    if (isStoredValueOutTradeNo(outTradeNo)) {
      const order = await withCollectionRetry(db, RECHARGE_ORDERS, async () => {
        const res = await db.collection(RECHARGE_ORDERS).where({ outTradeNo }).limit(1).get()
        return (res.data && res.data[0]) || null
      })
      if (order) {
        const callbackFen = resolveCallbackPayFen(event)
        const expectedFen =
          Math.round(Number(order.payFen) || Number(order.principalFen) || 0) || 0
        if (callbackFen != null && expectedFen > 0 && callbackFen !== expectedFen) {
          console.error('payCallback: sv amount mismatch', {
            outTradeNo,
            callbackFen,
            expectedFen
          })
          return { errcode: -1, errmsg: 'amount mismatch' }
        }
      }
      const transactionId = event.transactionId || event.transaction_id || ''
      return await fulfillStoredValueRecharge(outTradeNo, transactionId)
    }

    const orderRes = await db
      .collection('orders')
      .where(
        _.or([
          { orderNo: outTradeNo },
          { outTradeNo: outTradeNo }
        ])
      )
      .limit(1)
      .get()
    if (!orderRes.data.length) {
      console.error('payCallback: order not found', outTradeNo)
      return { errcode: 0, errmsg: 'SUCCESS' }
    }

    const order = orderRes.data[0]
    const callbackFen = resolveCallbackPayFen(event)
    const expectedFen = resolveExpectedPayFen(order)
    // 回调未带金额时，此前 `callbackFen != null &&` 会**整段跳过核对**（静默放行）。
    // 这里不再静默：落库标记 + 告警，便于对账时发现异常回调。
    if (callbackFen == null && expectedFen > 0) {
      console.error('payCallback: 回调缺少金额，无法核对', { outTradeNo, expectedFen, orderId: order._id })
      await db.collection('orders').doc(order._id).update({
        data: { amountUnverified: true, amountUnverifiedAt: db.serverDate() }
      }).catch(() => {})
    }
    if (callbackFen != null && expectedFen > 0 && callbackFen !== expectedFen) {
      console.error('payCallback: amount mismatch', {
        outTradeNo,
        callbackFen,
        expectedFen,
        orderId: order._id
      })
      return { errcode: -1, errmsg: 'amount mismatch' }
    }

    const transactionId = event.transactionId || event.transaction_id || ''

    if (transactionId) {
      await db.collection('orders').doc(order._id).update({
        data: {
          wxTransactionId: transactionId,
          wxPayMode: 'wechat'
        }
      })
    }

    await fulfillOrder(db, _, order._id, order._openid)
    return { errcode: 0, errmsg: 'SUCCESS' }
  } catch (err) {
    console.error('payCallback fulfill error:', err)
    return { errcode: -1, errmsg: err.message }
  }
}
