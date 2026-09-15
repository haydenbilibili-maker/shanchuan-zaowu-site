/**
 * 定金/尾款订单履约辅助（payCallback / confirmPayment 各一份）
 */
const { STATUS, isDepositOrder } = require('./depositDefaults')

function updatedCount(res) {
  if (!res || !res.stats) return 0
  return Number(res.stats.updated != null ? res.stats.updated : res.stats.updatedCount) || 0
}

/**
 * 定金单支付成功：intent → deposit_paid
 */
async function fulfillDepositPayment(db, _, order, orderId) {
  const intentId = String(order.depositIntentId || '').trim()
  const productId = String(order.depositProductId || (order.products && order.products[0] && order.products[0].id) || '').trim()
  const openid = order._openid

  if (intentId) {
    await db.collection('deposit_intents').doc(intentId).update({
      data: {
        status: STATUS.DEPOSIT_PAID,
        depositPaidAt: db.serverDate(),
        depositOrderId: orderId,
        depositOrderNo: order.orderNo || '',
        wxTransactionId: order.wxTransactionId || '',
        payReady: true,
        updateTime: db.serverDate(),
        note: '定金已支付；标本师上架后进入尾款窗口。逾期未付尾款则开放给所有人且定金不退。'
      }
    }).catch((e) => console.warn('fulfillDepositPayment intent', e && e.message))
  }

  const finalize = await db.collection('orders').where({
    _id: orderId,
    status: _.in(['fulfilling', 'pending_pay'])
  }).update({
    data: {
      status: 'paid',
      paidTime: db.serverDate(),
      wxPayMode: order.wxPayMode || (order.wxTransactionId ? 'wechat' : 'mock'),
      fulfillStockDone: true,
      depositFulfillKind: 'deposit'
    }
  })

  if (updatedCount(finalize) === 0) {
    const latest = await db.collection('orders').doc(orderId).get()
    if (latest.data && latest.data.status === 'paid') {
      return {
        success: true,
        alreadyPaid: true,
        orderId,
        status: 'paid',
        deposit: true,
        intentId,
        productId
      }
    }
  }

  return {
    success: true,
    orderId,
    status: 'paid',
    deposit: true,
    intentId,
    productId,
    openid,
    msg: '定金已支付'
  }
}

/**
 * 正式单带定金抵扣：支付成功后 settled + 清锁
 */
async function settleDepositIntentAfterOrder(db, _, order, orderId) {
  const intentId = String(order.depositIntentId || '').trim()
  if (!intentId) return { settled: false }

  const productId = String(order.depositProductId || '').trim()
  try {
    await db.collection('deposit_intents').doc(intentId).update({
      data: {
        status: STATUS.SETTLED,
        settledAt: db.serverDate(),
        balanceOrderId: orderId,
        balanceOrderNo: order.orderNo || '',
        updateTime: db.serverDate(),
        note: '尾款已付清（定金已抵扣）'
      }
    })
  } catch (e) {
    console.warn('settleDepositIntentAfterOrder', e && e.message)
    return { settled: false, msg: e.message }
  }

  if (productId) {
    try {
      const prod = await db.collection('products').doc(productId).get()
      const p = prod.data || {}
      if (!p.depositLockIntentId || p.depositLockIntentId === intentId) {
        try {
          await db.collection('products').doc(productId).update({
            data: {
              depositLockOpenid: _.remove(),
              depositLockUntil: _.remove(),
              depositLockIntentId: _.remove(),
              depositSettledAt: db.serverDate()
            }
          })
        } catch (e2) {
          await db.collection('products').doc(productId).update({
            data: {
              depositLockOpenid: '',
              depositLockUntil: null,
              depositLockIntentId: '',
              depositSettledAt: db.serverDate()
            }
          }).catch(() => {})
        }
      }
    } catch (e) {
      console.warn('clear lock after settle', e && e.message)
    }
  }

  return { settled: true, intentId, productId }
}

module.exports = {
  fulfillDepositPayment,
  settleDepositIntentAfterOrder,
  isDepositOrder
}
