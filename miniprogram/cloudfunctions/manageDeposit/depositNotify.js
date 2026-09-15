/**
 * 定金 / 候补 — 顾客有信 + 员工工作信息
 * 幂等：relatedId + eventType（dispatchMessage dedupeKey）
 */
const cloud = require('wx-server-sdk')
const { notifyStaffByRoles, ROLE_SUPER, ROLE_MANAGER, ROLE_STORE_MANAGER } =
  require('./staffNotify')

function uniq(list) {
  const seen = {}
  const out = []
  ;(list || []).forEach((id) => {
    const v = String(id || '').trim()
    if (!v || seen[v]) return
    seen[v] = true
    out.push(v)
  })
  return out
}

async function dispatchOne(payload) {
  try {
    const res = await cloud.callFunction({
      name: 'dispatchMessage',
      data: { action: 'dispatch', ...payload }
    })
    return res.result || { success: false }
  } catch (e) {
    console.warn('depositNotify dispatch', e && e.message)
    return { success: false, msg: e && e.message }
  }
}

async function resolveArtisanOpenids(db, productId, productHint) {
  const openids = []
  let product = productHint || null
  if (!product && productId) {
    try {
      const res = await db.collection('products').doc(productId).get()
      product = res.data
    } catch (e) {
      product = null
    }
  }
  if (!product) return []

  ;[product.staffOpenid, product.artisanOpenid, product.creatorOpenid].forEach((id) => {
    if (id) openids.push(String(id).trim())
  })

  const framerId = String(product.framerId || product.framer_id || '').trim()
  if (framerId) {
    try {
      const fr = await db.collection('framers').doc(framerId).get()
      const row = fr.data
      if (row) {
        const oid = String(row.staffOpenid || row.openid || '').trim()
        if (oid) openids.push(oid)
      }
    } catch (e) { /* ignore */ }
    try {
      const sm = await db
        .collection('staff_members')
        .where({ framerId, status: 'active' })
        .limit(3)
        .get()
      ;(sm.data || []).forEach((row) => {
        if (row && row.openid) openids.push(String(row.openid).trim())
      })
    } catch (e) { /* ignore */ }
  }
  return uniq(openids)
}

async function notifyWorkflowRecipients(db, { eventType, relatedId, vars, productId, product }) {
  const artisanOpenids = await resolveArtisanOpenids(db, productId, product)
  const staffRes = await notifyStaffByRoles(db, {
    roles: [ROLE_SUPER, ROLE_STORE_MANAGER, ROLE_MANAGER],
    eventType,
    relatedId,
    vars
  })

  const results = (staffRes && staffRes.results) || []
  for (const openid of artisanOpenids) {
    try {
      const r = await dispatchOne({
        eventType,
        openid,
        relatedId,
        vars: vars || {}
      })
      results.push({ openid, artisan: true, ...(r || {}) })
    } catch (e) {
      results.push({ openid, artisan: true, success: false, msg: e && e.message })
    }
  }
  return {
    success: true,
    artisanCount: artisanOpenids.length,
    staffCount: (staffRes && staffRes.count) || 0,
    results
  }
}

/**
 * 上架后通知「想要」候补用户（排除定金尾款得主，避免与付尾款信重复）
 */
async function notifyWishlistAvailable(db, payload = {}) {
  const productId = String(payload.productId || '').trim()
  if (!productId) return { success: false, msg: '缺少商品' }
  const title = payload.productTitle || payload.title || '藏品'
  const exclude = {}
  ;(payload.excludeOpenids || []).forEach((id) => {
    const v = String(id || '').trim()
    if (v) exclude[v] = true
  })

  let rows = []
  try {
    const res = await db
      .collection('collections')
      .where({ productId, type: 'wishlist' })
      .limit(100)
      .get()
    rows = res.data || []
  } catch (e) {
    console.warn('notifyWishlistAvailable query', e && e.message)
    return { success: false, msg: e && e.message }
  }

  const results = []
  const seen = {}
  for (const row of rows) {
    const openid = String((row && (row._openid || row.openid)) || '').trim()
    if (!openid || exclude[openid] || seen[openid]) continue
    seen[openid] = true
    try {
      const r = await dispatchOne({
        eventType: 'wishlist_available',
        openid,
        relatedId: `wishlist_available:${productId}:${openid}`,
        vars: {
          productTitle: (row && row.title) || title,
          relatedId: productId
        }
      })
      results.push({ openid, ...(r || {}) })
    } catch (e) {
      results.push({ openid, success: false, msg: e && e.message })
    }
  }
  return { success: true, count: results.length, results }
}

/** 定金已付 → 顾客有信 + 标本师/店长工作信息 */
async function notifyDepositPaid(db, payload = {}) {
  const intentId = String(payload.intentId || '').trim()
  const productId = String(payload.productId || '').trim()
  const userOpenid = String(payload.openid || payload._openid || '').trim()
  const title = payload.productTitle || payload.title || '孤品'
  const depositAmount = payload.depositAmount != null ? String(payload.depositAmount) : ''
  const orderId = String(payload.orderId || '').trim()
  const relatedId = intentId || productId
  if (!relatedId) return { success: false, msg: '缺少相关 ID' }

  const vars = {
    productTitle: title,
    depositAmount,
    orderNo: payload.orderNo || '',
    orderId,
    relatedId: productId || relatedId,
    stockHint: depositAmount ? `（定金 ¥${depositAmount}）` : ''
  }
  const userActionUrl = orderId
    ? `subpackages/business/order-detail/index?id=${orderId}`
    : productId
      ? `subpackages/feature/detail/index?id=${productId}`
      : ''

  const results = { user: null, staff: null }

  if (userOpenid) {
    results.user = await dispatchOne({
      eventType: 'deposit_paid_confirm',
      openid: userOpenid,
      relatedId: `deposit_paid_user:${relatedId}`,
      vars,
      actionUrl: userActionUrl || undefined
    })
  }

  results.staff = await notifyWorkflowRecipients(db, {
    eventType: 'staff_deposit_paid',
    relatedId: `deposit_paid:${relatedId}`,
    vars,
    productId,
    product: payload.product
  })

  return { success: true, results }
}

/** 上架进入尾款：通知用户 + 标本师/店长 */
async function notifyBalanceWindow(db, payload = {}) {
  const intentId = String(payload.intentId || '').trim()
  const productId = String(payload.productId || '').trim()
  const userOpenid = String(payload.openid || '').trim()
  const title = payload.productTitle || payload.title || '藏品'
  const days = payload.balanceWindowDays != null ? String(payload.balanceWindowDays) : '7'
  const balanceAmount = payload.balanceAmount != null ? String(payload.balanceAmount) : ''
  const dueLabel = payload.balanceDueLabel || ''

  const results = { user: null, staff: null }

  if (userOpenid) {
    results.user = await dispatchOne({
      eventType: 'deposit_balance_due',
      openid: userOpenid,
      relatedId: `deposit_balance:${intentId || productId}`,
      vars: {
        productTitle: title,
        balanceAmount,
        balanceWindowDays: days,
        balanceDueLabel: dueLabel,
        relatedId: productId
      }
    })
  }

  results.staff = await notifyWorkflowRecipients(db, {
    eventType: 'staff_deposit_balance_window',
    relatedId: `deposit_balance_staff:${intentId || productId}`,
    vars: {
      productTitle: title,
      balanceWindowDays: days,
      relatedId: productId
    },
    productId
  })

  return { success: true, results }
}

/** 逾期开放：通知用户 + 馆员 */
async function notifyDepositForfeited(db, payload = {}) {
  const intentId = String(payload.intentId || '').trim()
  const productId = String(payload.productId || '').trim()
  const userOpenid = String(payload.openid || payload._openid || '').trim()
  const title = payload.productTitle || payload.title || '藏品'
  const depositAmount = payload.depositAmount != null ? String(payload.depositAmount) : ''

  const results = { user: null, staff: null }

  if (userOpenid) {
    results.user = await dispatchOne({
      eventType: 'deposit_forfeited',
      openid: userOpenid,
      relatedId: `deposit_forfeit:${intentId || productId}`,
      vars: {
        productTitle: title,
        depositAmount,
        relatedId: productId
      }
    })
  }

  results.staff = await notifyWorkflowRecipients(db, {
    eventType: 'staff_deposit_forfeited',
    relatedId: `deposit_forfeit_staff:${intentId || productId}`,
    vars: {
      productTitle: title,
      relatedId: productId
    },
    productId
  })

  return { success: true, results }
}

/** 尾款付清 → 顾客有信 + 馆员工作信息 */
async function notifyDepositSettled(db, payload = {}) {
  const intentId = String(payload.intentId || '').trim()
  const productId = String(payload.productId || '').trim()
  const userOpenid = String(payload.openid || payload._openid || '').trim()
  const title = payload.productTitle || payload.title || '藏品'
  const orderId = String(payload.orderId || '').trim()
  const relatedId = intentId || productId
  if (!relatedId) return { success: false, msg: '缺少相关 ID' }

  const vars = {
    productTitle: title,
    orderNo: payload.orderNo || '',
    orderId,
    relatedId: productId || relatedId
  }
  const userActionUrl = orderId
    ? `subpackages/business/order-detail/index?id=${orderId}`
    : productId
      ? `subpackages/feature/detail/index?id=${productId}`
      : ''

  const results = { user: null, staff: null }

  if (userOpenid) {
    results.user = await dispatchOne({
      eventType: 'deposit_settled_confirm',
      openid: userOpenid,
      relatedId: `deposit_settled_user:${relatedId}`,
      vars,
      actionUrl: userActionUrl || undefined
    })
  }

  results.staff = await notifyWorkflowRecipients(db, {
    eventType: 'staff_deposit_settled',
    relatedId: `deposit_settled:${relatedId}`,
    vars,
    productId
  })

  return { success: true, results }
}

module.exports = {
  resolveArtisanOpenids,
  notifyWishlistAvailable,
  notifyDepositPaid,
  notifyBalanceWindow,
  notifyDepositForfeited,
  notifyDepositSettled
}
