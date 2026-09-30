/**
 * 采购商订货单旁路：purchase_orders（与 Admin 订货履约同源）
 * 集合对客户端不可写（规则 write:false）：建单 / 列表 / 支付全部经云函数 payB2bPurchase，
 * 单价与金额由服务端按 price_list_items 计算，客户端只提交 skuId + 数量。
 * 不调用 makeOrder/payOrder/payCallback。
 */
const COL = 'purchase_orders'
const FN = 'payB2bPurchase'

async function callB2b(data) {
  const call = await wx.cloud.callFunction({ name: FN, data })
  return (call && call.result) || { success: false, msg: '服务无返回' }
}

function toError(result, fallback) {
  const err = new Error((result && result.msg) || fallback)
  err.code = (result && result.code) || ''
  err.result = result
  return err
}

function genOrderNo() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const seq = String(Math.floor(Math.random() * 900) + 100)
  return `PO${y}${m}${day}${seq}`
}

function calcItemsTotal(items) {
  let sum = 0
  let any = false
  for (const it of items || []) {
    const p = it.unitPrice != null ? Number(it.unitPrice) : NaN
    const q = Math.max(1, parseInt(it.quantity, 10) || 1)
    if (Number.isFinite(p)) {
      sum += p * q
      any = true
    }
  }
  return any ? Math.round(sum * 100) / 100 : null
}

function normalizeItems(rawItems) {
  return (rawItems || [])
    .map((it) => ({
      skuId: String((it && it.skuId) || '').trim(),
      productId: (it && it.productId) || null,
      name: String((it && it.name) || '').trim(),
      quantity: Math.max(1, Math.min(999, parseInt(it && it.quantity, 10) || 1)),
      unitPrice:
        it && it.unitPrice != null && Number.isFinite(Number(it.unitPrice))
          ? Number(it.unitPrice)
          : null,
      priceLabel: (it && it.priceLabel) || null,
      packText: String((it && it.packText) || '').trim() || null,
      thumbUrl: String((it && it.thumbUrl) || '').trim() || null
    }))
    .filter((it) => it.name)
}

/**
 * 创建并提交采购单（status=submitted · paymentStatus=unpaid）
 * 只提交 skuId + 数量；单价 / 合计以云函数返回为准（区间价 → pricingMode=quote_required，不可在线支付）。
 * @returns {Promise<{_id:string, orderNo:string, totalAmount:number|null, pricingMode:string}>}
 */
async function createBuyerPurchaseOrder(payload) {
  const items = normalizeItems(payload && payload.items)
  if (!items.length) {
    const err = new Error('请先选择商品')
    err.code = 'EMPTY_ITEMS'
    throw err
  }
  const result = await callB2b({
    action: 'create',
    items: items.map((it) => ({ skuId: it.skuId, quantity: it.quantity, thumbUrl: it.thumbUrl })),
    storeId: (payload && payload.storeId) || '',
    storeName: String((payload && payload.storeName) || '').trim(),
    contactName: String((payload && payload.contactName) || '').trim(),
    contactPhone: String((payload && payload.contactPhone) || '').trim(),
    company: String((payload && (payload.company || payload.storeName)) || '').trim(),
    shipToAddress: String((payload && payload.shipToAddress) || '').trim(),
    note: String((payload && payload.note) || '').trim()
  })
  if (!result.success || !result._id) throw toError(result, '创建采购单失败')
  return {
    _id: result._id,
    orderNo: result.orderNo,
    totalAmount: result.totalAmount != null ? result.totalAmount : null,
    pricingMode: result.pricingMode || 'fixed',
    paymentStatus: 'unpaid'
  }
}

/**
 * 列出当前用户创建的采购商订货单（按 createdAt 降序；服务端按 _openid 过滤）
 */
async function listMyBuyerOrders(limit) {
  const result = await callB2b({ action: 'list', limit: Math.min(50, Math.max(1, parseInt(limit, 10) || 30)) })
  if (!result.success) throw toError(result, '读取采购单失败')
  return Array.isArray(result.list) ? result.list : []
}

/**
 * 发起 B2B 支付（旁路云函数）
 * @param {string} purchaseOrderId
 * @param {{ action?: 'pay'|'markPaidPreview'|'markOfflinePending' }} [opts]
 */
async function requestB2bPay(purchaseOrderId, opts) {
  const id = String(purchaseOrderId || '').trim()
  if (!id) {
    const err = new Error('缺少采购单 ID')
    err.code = 'MISSING_ID'
    throw err
  }
  const action = (opts && opts.action) || 'pay'
  try {
    const call = await wx.cloud.callFunction({
      name: 'payB2bPurchase',
      data: { purchaseOrderId: id, action }
    })
    const result = (call && call.result) || { success: false, msg: '支付服务无返回' }
    if (!result.success) {
      const friendly = friendlyPayError(result)
      return { ...result, code: result.code || friendly.code, msg: friendly.msg }
    }
    return result
  } catch (e) {
    const friendly = friendlyPayError(e)
    return {
      success: false,
      code: friendly.code,
      msg: friendly.msg,
      paymentStatus: 'unpaid'
    }
  }
}

/**
 * 拉起微信 JSAPI；无 payment 时原样返回云函数结果（含明确支付态）
 */
async function payBuyerOrder(purchaseOrderId, opts) {
  const result = await requestB2bPay(purchaseOrderId, opts)
  if (!result || !result.success) return result

  if (result.payment) {
    const payment = result.payment
    const pkg = String(payment.package || '')
    if (!pkg.startsWith('prepay_id=') || pkg.length <= 'prepay_id='.length + 2) {
      return {
        success: false,
        code: 'INVALID_PREPAY',
        msg: '支付参数无效，请稍后重试',
        paymentStatus: result.paymentStatus || 'unpaid'
      }
    }
    try {
      await new Promise((resolve, reject) => {
        wx.requestPayment({
          timeStamp: String(payment.timeStamp || ''),
          nonceStr: payment.nonceStr,
          package: payment.package,
          signType: payment.signType || 'MD5',
          paySign: payment.paySign,
          success: resolve,
          fail: (err) => {
            const raw = (err && err.errMsg) || ''
            if (raw.includes('cancel')) reject(Object.assign(new Error('已取消支付'), { code: 'CANCELLED' }))
            else {
              console.warn('[buyerPurchaseOrder] requestPayment fail', raw)
              reject(Object.assign(new Error('微信支付没有完成，请稍后再试；着急可点「待对公」登记转账。'), { code: 'PAY_FAIL' }))
            }
          }
        })
      })
      return {
        success: true,
        paid: true,
        via: 'wechat',
        paymentStatus: 'paid',
        msg: '支付已提交，到账以回调为准'
      }
    } catch (e) {
      return {
        success: false,
        code: e.code || 'PAY_FAIL',
        msg: e.message || '支付失败',
        paymentStatus: 'unpaid'
      }
    }
  }

  // 已标记已付 / 全额旁路
  return result
}

const PAY_STATUS_LABEL = {
  unpaid: '待支付',
  pending: '支付中',
  paid: '已支付',
  offline_pending: '待对公确认',
  marked_paid: '已标记已付（验收）',
  awaiting_config: '支付通道未开通',
  pay_review: '金额待总部核对',
  refunded: '已退款'
}

const FULFILL_STATUS_LABEL = {
  draft: '草稿',
  submitted: '已提交·待总部确认',
  confirmed: '总部已确认',
  shipping: '出货中',
  shipped: '已发货',
  received: '已收货',
  closed: '已关闭',
  cancelled: '已取消'
}

function paymentLabel(status) {
  return PAY_STATUS_LABEL[String(status || '')] || String(status || '—')
}

function fulfillLabel(status) {
  return FULFILL_STATUS_LABEL[String(status || '')] || String(status || '—')
}

/** 支付结果回跳文案（buyer-cart → buyer-orders?result=） */
function resultBannerFromQuery(result) {
  const r = String(result || '').trim()
  if (r === 'paid') {
    return { kind: 'ok', text: '支付已提交。到账以微信回调为准；下方状态稍后刷新。' }
  }
  if (r === 'marked') {
    return { kind: 'ok', text: '已标记已付（验收旁路，非真实收款）。' }
  }
  if (r === 'offline') {
    return { kind: 'ok', text: '已登记待对公。总部确认到账后会更新支付态。' }
  }
  if (r === 'created') {
    return { kind: 'ok', text: '采购单已创建。可点「微信支付」或「待对公」继续。' }
  }
  if (r === 'pay_pending') {
    return {
      kind: 'warn',
      text: '采购单已创建，支付未完成。可重试微信支付、登记对公，或（超管）验收标记。'
    }
  }
  if (r === 'cancelled') {
    return { kind: 'warn', text: '已取消支付。采购单仍在，可随时重试。' }
  }
  if (r === 'price_changed') {
    return { kind: 'warn', text: '供货价已更新，采购单金额已按最新价目重算。请核对金额后再点「微信支付」。' }
  }
  if (r === 'quote') {
    return {
      kind: 'warn',
      text: '采购单已创建。单内含区间价/议价商品，需总部确认单价，暂不支持在线支付；可点「待对公」或联系对接人。'
    }
  }
  return null
}

function isPayableStatus(pay) {
  const p = String(pay || '')
  return p === 'unpaid' || p === 'pending' || p === 'awaiting_config'
}

/** 支付态 → 采购商下一步说明 */
function nextStepForPayment(pay) {
  const p = String(pay || 'unpaid')
  if (p === 'paid' || p === 'marked_paid') {
    return '已付款。请等待总部确认订货并出货；进度见「履约」字段。'
  }
  if (p === 'offline_pending') {
    return '已登记待对公。请按对接人指引转账；到账后由总部更新状态。'
  }
  if (p === 'pending') {
    return '支付处理中。可下拉刷新；若久未到账请联系对接人。'
  }
  if (p === 'awaiting_config') {
    return '微信商户未开通。可点「待对公」，或请总部部署支付云函数并配置商户号。'
  }
  if (p === 'pay_review') {
    return '微信到账金额与应付不一致，总部核对中，请勿重复付款。'
  }
  if (p === 'refunded') {
    return '该单已原路退款，到账以微信通知为准。'
  }
  return '待支付：可点「微信支付」，或「待对公」登记转账意向。'
}

/** 将云函数/网络异常转为可行动文案 */
function friendlyPayError(errOrResult) {
  const code = String(
    (errOrResult && (errOrResult.code || errOrResult.errCode)) || ''
  )
  const raw = String(
    (errOrResult && (errOrResult.msg || errOrResult.message || errOrResult.errMsg)) ||
      ''
  )
  const blob = `${code} ${raw}`.toLowerCase()
  if (
    blob.indexOf('function not found') !== -1 ||
    blob.indexOf('cloud function not found') !== -1 ||
    blob.indexOf('找不到对应的云函数') !== -1 ||
    (blob.indexOf('payb2bpurchase') !== -1 && blob.indexOf('not found') !== -1)
  ) {
    return {
      code: 'FN_NOT_DEPLOYED',
      msg:
        '支付云函数未部署。请总部在微信开发者工具上传 payB2bPurchase 与 b2bPayCallback；期间可用「待对公」。'
    }
  }
  if (blob.indexOf('timeout') !== -1 || blob.indexOf('timed out') !== -1) {
    return { code: 'TIMEOUT', msg: '网络超时，请稍后重试支付或下拉刷新订单。' }
  }
  if (code === 'B2B_PAY_NOT_CONFIGURED') {
    return { code, msg: '微信支付还没开通。可先点「待对公」登记转账，或联系总部开通。' }
  }
  if (code === 'B2B_PAY_CONFIG_INVALID') {
    return { code, msg: '支付配置有误，请联系总部。期间可点「待对公」登记转账。' }
  }
  if (code === 'PAY_UNAVAILABLE' || looksLikeWxInternal(raw)) {
    return {
      code: code || 'PAY_UNAVAILABLE',
      msg: '微信支付暂时拉不起来，请稍后再试；着急可点「待对公」登记转账。'
    }
  }
  return {
    code: code || 'PAY_FAIL',
    msg: raw || '支付暂不可用，请稍后重试或登记待对公。'
  }
}

/** 微信/云调用内部报错原文（门店看不懂，也不该看到配置细节） */
function looksLikeWxInternal(raw) {
  return /\/body\/xml|sub_mch_id|submchid|WX_PAY_|errCode|cloudPay|规则校验失败/i.test(String(raw || ''))
}

function createErrorFriendly(err) {
  const msg = String((err && err.message) || '')
  const code = String((err && err.code) || '')
  if (code === 'EMPTY_ITEMS') return msg || '请先选择商品'
  if (['ITEM_UNAVAILABLE', 'NOT_BUYER', 'MISSING_CONTACT', 'UNAUTHORIZED'].indexOf(code) !== -1) {
    return msg || '创建采购单失败，请重试'
  }
  if (/function not found|找不到对应的云函数/i.test(msg)) {
    return '下单云函数未部署。请联系总部上传 payB2bPurchase。'
  }
  if (/permission|权限|fail.*auth|write/i.test(msg)) {
    return '无权限写入订货单。请确认已登录，或联系总部开通采购商权限。'
  }
  if (/timeout|network|fail/i.test(msg)) {
    return '网络异常，采购单未创建成功，请检查网络后重试。'
  }
  return msg || '创建采购单失败，请重试'
}

module.exports = {
  COL,
  genOrderNo,
  calcItemsTotal,
  normalizeItems,
  createBuyerPurchaseOrder,
  listMyBuyerOrders,
  requestB2bPay,
  payBuyerOrder,
  paymentLabel,
  fulfillLabel,
  resultBannerFromQuery,
  isPayableStatus,
  nextStepForPayment,
  friendlyPayError,
  createErrorFriendly,
  PAY_STATUS_LABEL,
  FULFILL_STATUS_LABEL
}
