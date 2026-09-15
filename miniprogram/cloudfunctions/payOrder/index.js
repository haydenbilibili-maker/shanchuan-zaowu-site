const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/** 云环境 ID，与 app.js 中 wx.cloud.init env 一致；接入真实支付时在云开发控制台配置商户号 */
const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'cloud1-8gnkty5bfff9f0bf'
const SUB_MCH_ID = process.env.WX_PAY_SUB_MCH_ID || ''
/** 仅开发/灰度显式开启：ALLOW_MOCK_PAY=1；生产默认关闭，禁止 mock 履约 */
const ALLOW_MOCK_PAY = process.env.ALLOW_MOCK_PAY === '1'
const WALLET_INTERNAL_KEY = process.env.STORED_VALUE_CALLBACK_KEY || process.env.PAY_CALLBACK_INTERNAL_KEY || ''

function walletCallPayload(action, orderId, openid, extra = {}) {
  const payload = { action, orderId, openid, ...extra }
  if (WALLET_INTERNAL_KEY) payload.internalKey = WALLET_INTERNAL_KEY
  return payload
}

async function debitWalletIfNeeded(orderId, openid) {
  const res = await cloud.callFunction({
    name: 'manageStoredValue',
    data: walletCallPayload('debitForOrder', orderId, openid)
  })
  const result = (res && res.result) || {}
  if (!result.success) {
    return {
      ok: false,
      code: result.code || 'WALLET_DEBIT_FAILED',
      msg: result.msg || '钱包扣款失败',
      result
    }
  }
  return { ok: true, result }
}

/** 微信拉起失败等：自动回账，避免静默丢余额 */
async function refundWalletQuiet(orderId, openid, remark) {
  try {
    const res = await cloud.callFunction({
      name: 'manageStoredValue',
      data: walletCallPayload('refundWalletForOrder', orderId, openid, { remark })
    })
    return (res && res.result) || { success: false }
  } catch (e) {
    console.error('payOrder refundWalletQuiet failed', e)
    return { success: false, msg: e.message || '回账失败' }
  }
}

function isDepositOrder(order) {
  return order && (order.orderType === 'deposit' || order.source === 'deposit')
}

/**
 * 解析应付金额（分）。兼容元字符串 / 数字，以及 paymentBreakdown 里的分字段。
 * 微信统一下单要求 totalFee 为整数「分」。
 */
function resolvePayFen(order) {
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

/** package 必须为 prepay_id=xxx；空 prepay_id 会让客户端误报「缺少 total_fee」 */
function isValidPayment(payment) {
  if (!payment || typeof payment !== 'object') return false
  const pkg = String(payment.package || '')
  if (!pkg.startsWith('prepay_id=')) return false
  if (pkg.length <= 'prepay_id='.length + 2) return false
  return !!(payment.timeStamp && payment.nonceStr && payment.paySign)
}

function pickUnifiedError(res, payErr) {
  if (payErr) {
    return (
      (payErr.errMsg || payErr.message || payErr.returnMsg || '').toString() ||
      '微信支付下单失败'
    )
  }
  if (!res) return '微信支付无返回'
  const bits = [
    res.returnMsg,
    res.errCodeDes,
    res.err_code_des,
    res.errorCode,
    res.errMsg
  ]
    .filter(Boolean)
    .map((s) => String(s))
  if (res.returnCode && res.returnCode !== 'SUCCESS') {
    return bits[0] || `统一下单失败(${res.returnCode})`
  }
  if (res.resultCode && res.resultCode !== 'SUCCESS') {
    return bits[0] || `统一下单业务失败(${res.resultCode})`
  }
  if (!isValidPayment(res.payment)) {
    return bits[0] || '预支付单无效，请重试'
  }
  return bits[0] || '微信支付下单失败'
}

function buildFreshOrderNo(order) {
  const stamp = Date.now().toString(36).toUpperCase()
  const rand = Math.floor(Math.random() * 1000)
  const kind = isDepositOrder(order) ? 'DEP' : 'ORD'
  return `${kind}${stamp}${rand}`.slice(0, 32)
}

/**
 * 每次发起支付前刷新商户订单号，避免二次支付 OUT_TRADE_NO_USED
 * 导致空 package，客户端再误报缺 total_fee。
 * payCallback 按 orders.orderNo === outTradeNo 查找，必须同步更新 orderNo。
 */
async function rotateOrderNoForPay(orderId, order) {
  const attempt = (Number(order.payAttempt) || 0) + 1
  const previousOrderNo = order.orderNo || ''
  const orderNo = buildFreshOrderNo(order)
  await db.collection('orders').doc(orderId).update({
    data: {
      orderNo,
      payAttempt: attempt,
      previousOrderNo,
      outTradeNo: orderNo,
      updateTime: db.serverDate()
    }
  })
  return { orderNo, payAttempt: attempt }
}

async function unifiedOrderOnce({ order, openid, outTradeNo, wxpayFen }) {
  const res = await cloud.cloudPay.unifiedOrder({
    body: isDepositOrder(order) ? '山海造物·孤品定金' : '山海造物·标本藏品',
    outTradeNo,
    spbillCreateIp: '127.0.0.1',
    subMchId: SUB_MCH_ID,
    totalFee: wxpayFen,
    envId: ENV_ID,
    functionName: 'payCallback',
    tradeType: 'JSAPI',
    openid
  })
  return res
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  // 部分环境下嵌套链路仍保留用户身份于 FROM_OPENID
  const openid = wxContext.OPENID || wxContext.FROM_OPENID || ''
  const { orderId } = event

  if (!orderId) {
    return { success: false, msg: '缺少订单 ID' }
  }
  if (!openid) {
    return { success: false, msg: '请先登录', code: 'UNAUTHORIZED' }
  }

  try {
    const orderRes = await db.collection('orders').doc(orderId).get()
    const order = orderRes.data

    if (!order || order._openid !== openid) {
      return { success: false, msg: '订单不存在' }
    }
    if (order.status !== 'pending_pay') {
      return { success: false, msg: '订单不可支付', status: order.status }
    }

    if (order.payExpireTime && new Date(order.payExpireTime).getTime() < Date.now()) {
      return { success: false, msg: '订单已过期，请重新下单' }
    }

    const totalFee = resolvePayFen(order)
    if (!totalFee || totalFee <= 0) {
      return {
        success: false,
        msg: '订单金额异常',
        code: 'INVALID_AMOUNT',
        debug: {
          totalPrice: order.totalPrice,
          goodsPrice: order.goodsPrice,
          orderType: order.orderType || order.source || ''
        }
      }
    }

    let wxpayFen = totalFee
    let walletPayFen = 0
    let walletHeld = false

    // 选用钱包支付：先扣余额，剩余走微信；全额钱包则交由 confirmPayment 履约
    if (order.useWalletPay) {
      if (!WALLET_INTERNAL_KEY) {
        console.warn('payOrder: STORED_VALUE_CALLBACK_KEY empty; wallet inter-call may fail')
      }
      const debit = await debitWalletIfNeeded(orderId, openid)
      if (!debit.ok) {
        return {
          success: false,
          msg: debit.msg,
          code: debit.code
        }
      }
      walletPayFen = Number(debit.result.debitedFen) || 0
      walletHeld = walletPayFen > 0
      wxpayFen = Number(debit.result.wxpayFen)
      if (!Number.isFinite(wxpayFen)) wxpayFen = Math.max(0, totalFee - walletPayFen)
      wxpayFen = Math.round(wxpayFen)

      if (wxpayFen <= 0) {
        return {
          success: true,
          orderId,
          paidByWallet: true,
          walletPayFen,
          wxpayFen: 0,
          msg: '已用钱包余额支付，请确认订单'
        }
      }
    }

    if (SUB_MCH_ID) {
      // 每次拉起支付换新商户单号，避免重复下单空 package → 客户端「缺 total_fee」
      let lastErrMsg = ''
      for (let i = 0; i < 2; i++) {
        let outTradeNo = ''
        try {
          const latestRes = await db.collection('orders').doc(orderId).get()
          const latest = latestRes.data || order
          const rotated = await rotateOrderNoForPay(orderId, latest)
          outTradeNo = rotated.orderNo
          order.orderNo = outTradeNo
          order.payAttempt = rotated.payAttempt
        } catch (rotErr) {
          console.error('payOrder rotateOrderNo failed', rotErr)
          outTradeNo = String(order.orderNo || buildFreshOrderNo(order)).slice(0, 32)
        }
        if (!outTradeNo) {
          return { success: false, msg: '订单号异常', code: 'INVALID_ORDER_NO' }
        }

        try {
          const res = await unifiedOrderOnce({
            order,
            openid,
            outTradeNo,
            wxpayFen
          })

          const returnOk = !res.returnCode || res.returnCode === 'SUCCESS'
          const resultOk = !res.resultCode || res.resultCode === 'SUCCESS'
          if (returnOk && resultOk && isValidPayment(res.payment)) {
            return {
              success: true,
              orderId,
              orderNo: outTradeNo,
              payment: res.payment,
              walletPayFen,
              wxpayFen,
              walletHeld,
              totalFeeFen: totalFee
            }
          }

          lastErrMsg = pickUnifiedError(res, null)
          console.error('payOrder unifiedOrder soft-fail', {
            outTradeNo,
            wxpayFen,
            returnCode: res && res.returnCode,
            resultCode: res && res.resultCode,
            package: res && res.payment && res.payment.package,
            msg: lastErrMsg
          })
        } catch (payErr) {
          lastErrMsg = pickUnifiedError(null, payErr)
          console.error('cloudPay.unifiedOrder failed:', payErr)
        }
      }

      if (walletHeld) {
        const refund = await refundWalletQuiet(orderId, openid, '微信支付拉起失败·自动回账')
        return {
          success: false,
          msg: lastErrMsg
            ? `微信支付暂不可用（${lastErrMsg}），钱包余额已退回`
            : '微信支付暂不可用，钱包余额已退回',
          code: 'PAY_UNAVAILABLE',
          walletPayFen,
          walletRefunded: !!(refund && refund.success),
          walletRefund: refund
        }
      }
      if (!ALLOW_MOCK_PAY) {
        return {
          success: false,
          msg: lastErrMsg
            ? `微信支付暂不可用：${lastErrMsg}`
            : '微信支付暂不可用，请稍后重试',
          code: 'PAY_UNAVAILABLE',
          walletPayFen: 0
        }
      }
    }

    if (ALLOW_MOCK_PAY) {
      return {
        success: true,
        orderId,
        mockPay: true,
        walletPayFen,
        wxpayFen,
        walletHeld,
        msg: '开发模式：模拟支付（ALLOW_MOCK_PAY=1）'
      }
    }

    if (walletHeld) {
      const refund = await refundWalletQuiet(orderId, openid, '支付未开通·自动回账')
      return {
        success: false,
        orderId,
        msg: '支付未开通，钱包余额已退回',
        code: 'PAY_NOT_ENABLED',
        walletPayFen,
        walletRefunded: !!(refund && refund.success)
      }
    }

    return {
      success: false,
      orderId,
      msg: '支付未开通，请稍后再试或联系门店',
      code: 'PAY_NOT_ENABLED',
      walletPayFen: 0
    }
  } catch (err) {
    console.error('payOrder error:', err)
    return { success: false, msg: err.message || '发起支付失败' }
  }
}
