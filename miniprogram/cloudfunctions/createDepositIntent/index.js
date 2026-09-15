/**
 * 售罄藏品定金意向 + 定金支付单（C 端）
 *
 * action:
 *   create（默认）— 创建/复用意向与定金订单，返回 orderId 供 payOrder
 *   status         — 查询本人对该商品的定金状态
 *
 * 定金单：orders.source=deposit / orderType=deposit / orderNo=DEP...
 * 尾款：走 makeOrder(depositIntentId) 正式单抵扣
 */
const cloud = require('wx-server-sdk')
const { notifyStaffWishlist } = require('./staffNotify')
const {
  COLLECTION: RULES_COLLECTION,
  RULE_KEY,
  DEFAULT_RULES,
  STATUS,
  ACTIVE_USER_STATUSES,
  normalizeRules,
  calcDepositAmount,
  statusLabel
} = require('./depositDefaults')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PAY_TIMEOUT_MS = 30 * 60 * 1000

async function loadRules() {
  try {
    const byKey = await db.collection(RULES_COLLECTION).where({ key: RULE_KEY }).limit(1).get()
    if (byKey.data && byKey.data[0]) return normalizeRules(byKey.data[0])
  } catch (e) { /* ignore */ }
  try {
    const doc = await db.collection(RULES_COLLECTION).doc(RULE_KEY).get()
    if (doc.data) return normalizeRules(doc.data)
  } catch (e) { /* ignore */ }
  return normalizeRules(DEFAULT_RULES)
}

function isDepositEligible(prod) {
  if (!prod) return false
  if (prod.depositEligible === true) return true
  if (prod.depositEligible === false) return false
  return !!(prod.isOneOfAKind || prod.isUnique)
}

async function dispatchDepositMessage(payload) {
  try {
    const res = await cloud.callFunction({
      name: 'dispatchMessage',
      data: { action: 'dispatch', ...payload }
    })
    const result = res.result || {}
    if (result.success) return result
  } catch (e) {
    console.warn('dispatchMessage deposit failed:', e && e.message)
  }
  return { success: false }
}

async function ensureWishlist(openid, productId, snapshot, skuId, skuLabel) {
  const check = await db
    .collection('collections')
    .where({
      _openid: openid,
      productId,
      skuId: skuId || '',
      type: 'wishlist'
    })
    .limit(1)
    .get()
  if (check.data && check.data.length) return { added: false }
  await db.collection('collections').add({
    data: {
      _openid: openid,
      productId,
      skuId: skuId || '',
      skuLabel: skuLabel || '',
      type: 'wishlist',
      title: (snapshot && snapshot.title) || '',
      image: (snapshot && snapshot.image) || '',
      price: snapshot && snapshot.price,
      latinName: (snapshot && snapshot.latinName) || '',
      count: 1,
      soldOut: true,
      createTime: db.serverDate()
    }
  })
  return { added: true }
}

function buildDepositOrderNo() {
  return 'DEP' + Date.now() + Math.floor(Math.random() * 1000)
}

async function findActiveIntent(openid, productId) {
  const res = await db
    .collection('deposit_intents')
    .where({
      _openid: openid,
      productId,
      status: _.in(ACTIVE_USER_STATUSES)
    })
    .limit(20)
    .get()
  const rows = (res.data || []).slice().sort((a, b) => {
    const ta = a.createTime ? new Date(a.createTime).getTime() : 0
    const tb = b.createTime ? new Date(b.createTime).getTime() : 0
    return tb - ta
  })
  return rows[0] || null
}

async function getStatus(openid, productId) {
  if (!productId) return { success: false, msg: '缺少商品' }
  const row = await findActiveIntent(openid, productId)
  const canPayDeposit = !!(row && (row.status === STATUS.PENDING_PAY || row.status === STATUS.INTENT))
  const canPayBalance = !!(row && row.status === STATUS.AWAITING_BALANCE)
  return {
    success: true,
    hasDepositIntent: !!row,
    depositAmount: row ? row.depositAmount : null,
    balanceAmount: row ? row.balanceAmount : null,
    balanceDueAt: row ? row.balanceDueAt : null,
    status: row ? row.status : null,
    statusLabel: row ? statusLabel(row.status) : '',
    intentId: row ? row._id : null,
    depositOrderId: row ? row.depositOrderId || null : null,
    canPayDeposit,
    canPayBalance,
    payReady: !!(row && (row.status === STATUS.DEPOSIT_PAID || row.status === STATUS.AWAITING_BALANCE || row.status === STATUS.SETTLED))
  }
}

async function loadProduct(productId, skuId, snapshot) {
  let productPrice = Number(snapshot && snapshot.price)
  let productTitle = (snapshot && snapshot.title) || ''
  let productImage = (snapshot && snapshot.image) || ''
  let latinName = (snapshot && snapshot.latinName) || ''
  let stock = 0
  let prod = null

  try {
    const prodRes = await db.collection('products').doc(productId).get()
    prod = prodRes.data
    if (prod) {
      if (!productTitle) productTitle = prod.title || ''
      if (!productImage) {
        productImage =
          (Array.isArray(prod.images) && prod.images[0]) || prod.cover || prod.image || ''
      }
      if (!latinName) latinName = prod.latinName || ''
      if (!(productPrice > 0)) productPrice = Number(prod.price) || 0
      stock = parseInt(prod.stock, 10)
      if (Number.isNaN(stock)) stock = 0
      if (Array.isArray(prod.skus) && prod.skus.length) {
        const sku = skuId
          ? prod.skus.find((s) => String(s.id || s.skuId || '') === skuId)
          : null
        if (sku) {
          if (sku.price != null) productPrice = Number(sku.price) || productPrice
          stock = parseInt(sku.stock, 10)
          if (Number.isNaN(stock)) stock = 0
        } else {
          stock = prod.skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0)
        }
      }
    }
  } catch (e) {
    console.warn('load product for deposit failed:', e && e.message)
  }

  return { prod, productPrice, productTitle, productImage, latinName, stock }
}

async function createOrReuseDepositOrder(openid, intent, meta) {
  const existingOrderId = String(intent.depositOrderId || '').trim()
  if (existingOrderId) {
    try {
      const orderRes = await db.collection('orders').doc(existingOrderId).get()
      const order = orderRes.data
      if (order && order._openid === openid && order.status === 'pending_pay') {
        const expired = order.payExpireTime && new Date(order.payExpireTime).getTime() < Date.now()
        if (!expired) {
          return { orderId: existingOrderId, orderNo: order.orderNo, reused: true }
        }
        await db.collection('orders').doc(existingOrderId).update({
          data: { status: 'void', cancelReason: 'deposit_pay_timeout' }
        }).catch(() => {})
      }
    } catch (e) { /* recreate */ }
  }

  const orderNo = buildDepositOrderNo()
  const payExpireTime = new Date(Date.now() + PAY_TIMEOUT_MS)
  const depositAmount = Math.round(Number(intent.depositAmount) || Number(meta.depositAmount) || 0)
  if (!(depositAmount > 0)) {
    throw new Error('定金金额异常')
  }
  const addRes = await db.collection('orders').add({
    data: {
      _openid: openid,
      orderNo,
      orderType: 'deposit',
      source: 'deposit',
      status: 'pending_pay',
      totalPrice: depositAmount,
      goodsPrice: depositAmount,
      originalPrice: depositAmount,
      totalFeeFen: Math.round(depositAmount * 100),
      shippingFee: 0,
      couponValue: 0,
      count: 1,
      depositIntentId: intent._id,
      depositProductId: meta.productId,
      products: [{
        id: meta.productId,
        skuId: meta.skuId || '',
        skuLabel: meta.skuLabel || '',
        title: meta.productTitle,
        image: meta.productImage,
        price: depositAmount,
        latin: meta.latinName || '',
        count: 1,
        isDeposit: true
      }],
      remark: '售罄孤品定金',
      createTime: db.serverDate(),
      payExpireTime,
      stockHeld: false,
      fulfillStockDone: true
    }
  })

  await db.collection('deposit_intents').doc(intent._id).update({
    data: {
      status: STATUS.PENDING_PAY,
      depositOrderId: addRes._id,
      depositOrderNo: orderNo,
      updateTime: db.serverDate()
    }
  })

  return { orderId: addRes._id, orderNo, reused: false }
}

async function createIntent(openid, event) {
  const productId = String(event.productId || event.targetId || '').trim()
  if (!productId) return { success: false, msg: '缺少商品' }

  const skuId = String(event.skuId || '').trim()
  const skuLabel = String(event.skuLabel || '').trim()
  const snapshot = event.snapshot || {}
  const loaded = await loadProduct(productId, skuId, snapshot)
  const { prod, productPrice, productTitle, productImage, latinName, stock } = loaded

  if (!isDepositEligible(prod)) {
    return { success: false, msg: '该藏品暂不支持定金候补', code: 'NOT_ELIGIBLE' }
  }
  if (stock > 0) {
    return { success: false, msg: '该藏品有货，请直接购买', code: 'IN_STOCK' }
  }

  const rules = await loadRules()
  if (rules.enabled === false) {
    return { success: false, msg: '定金功能暂未开放', code: 'DISABLED' }
  }

  const existing = await findActiveIntent(openid, productId)
  if (existing) {
    if (existing.status === STATUS.DEPOSIT_PAID) {
      return {
        success: true,
        already: true,
        needPay: false,
        intentId: existing._id,
        depositAmount: existing.depositAmount,
        status: existing.status,
        statusLabel: statusLabel(existing.status),
        msg: '定金已支付，等待上架后付尾款'
      }
    }
    if (existing.status === STATUS.AWAITING_BALANCE) {
      return {
        success: true,
        already: true,
        needPay: false,
        canPayBalance: true,
        intentId: existing._id,
        depositAmount: existing.depositAmount,
        balanceAmount: existing.balanceAmount,
        status: existing.status,
        statusLabel: statusLabel(existing.status),
        msg: '藏品已上架，请支付尾款'
      }
    }
    if (existing.status === STATUS.SETTLED) {
      return {
        success: true,
        already: true,
        needPay: false,
        intentId: existing._id,
        status: existing.status,
        statusLabel: statusLabel(existing.status),
        msg: '该定金意向已付清'
      }
    }

    // intent / pending_pay → 创建或复用支付单
    const orderMeta = {
      productId,
      skuId,
      skuLabel,
      productTitle: existing.title || productTitle,
      productImage: existing.image || productImage,
      latinName: existing.latinName || latinName,
      depositAmount: existing.depositAmount
    }
    const orderInfo = await createOrReuseDepositOrder(openid, existing, orderMeta)
    return {
      success: true,
      already: true,
      needPay: true,
      intentId: existing._id,
      orderId: orderInfo.orderId,
      orderNo: orderInfo.orderNo,
      depositAmount: existing.depositAmount,
      balanceAmount: existing.balanceAmount,
      status: STATUS.PENDING_PAY,
      statusLabel: statusLabel(STATUS.PENDING_PAY),
      msg: `请支付定金 ¥${existing.depositAmount}`
    }
  }

  const depositAmount = calcDepositAmount(productPrice, rules)
  const balanceAmount = Math.max(0, Math.round(productPrice - depositAmount))
  const snap = {
    title: productTitle,
    image: productImage,
    price: productPrice,
    latinName
  }

  await ensureWishlist(openid, productId, snap, skuId, skuLabel)

  const addRes = await db.collection('deposit_intents').add({
    data: {
      _openid: openid,
      productId,
      skuId,
      skuLabel,
      title: productTitle,
      image: productImage,
      productPrice,
      depositAmount,
      balanceAmount,
      depositRatio: rules.depositRatio,
      balanceWindowDays: rules.balanceWindowDays,
      currency: 'CNY',
      status: STATUS.PENDING_PAY,
      payReady: false,
      note: '定金待支付；支付后锁优先制作权。上架后须在窗口内付尾款，逾期开放且定金不退。',
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  })

  const intent = {
    _id: addRes._id,
    depositAmount,
    balanceAmount
  }
  const orderInfo = await createOrReuseDepositOrder(openid, intent, {
    productId,
    skuId,
    skuLabel,
    productTitle,
    productImage,
    latinName,
    depositAmount
  })

  const dedupeRelatedId = `${productId}:${openid}:deposit`
  notifyStaffWishlist(db, {
    relatedId: dedupeRelatedId,
    vars: {
      productTitle,
      stockHint: `（定金待付 ¥${depositAmount}）`,
      relatedId: productId
    },
    dispatchInAppMessage: async (_db, opts) =>
      dispatchDepositMessage({
        eventType: opts.eventType,
        openid: opts.openid,
        relatedId: opts.relatedId,
        vars: opts.vars
      })
  }).catch((err) => console.warn('deposit staff notify failed:', err))

  return {
    success: true,
    already: false,
    needPay: true,
    intentId: addRes._id,
    orderId: orderInfo.orderId,
    orderNo: orderInfo.orderNo,
    depositAmount,
    balanceAmount,
    status: STATUS.PENDING_PAY,
    statusLabel: statusLabel(STATUS.PENDING_PAY),
    msg: `请支付定金 ¥${depositAmount}（约 ${Math.round(rules.depositRatio * 100)}%）。上架后 ${rules.balanceWindowDays} 天内付尾款；逾期开放且定金不退。`
  }
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  if (!openid) return { success: false, msg: '请先登录' }

  const action = String(event.action || 'create').trim()
  try {
    if (action === 'status') {
      return await getStatus(openid, String(event.productId || event.targetId || '').trim())
    }
    return await createIntent(openid, event)
  } catch (e) {
    console.error('createDepositIntent failed:', e)
    return { success: false, msg: e.message || '登记失败' }
  }
}
