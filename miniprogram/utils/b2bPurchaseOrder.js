/**
 * 店长订货：直连 CloudBase 集合（与 Admin CDN 读写同一套字段）
 * 不依赖微信云函数。价目优先 configs/b2b_catalog，否则本地 seed。
 */
const CATALOG_SEED = require('./b2bCatalogSeed')

function getOpenid() {
  try {
    const app = getApp()
    return (app && app.globalData && app.globalData.openid) || ''
  } catch (e) {
    return ''
  }
}

const COL = 'purchase_orders'
const SHIP_COL = 'fulfillment_shipments'
const CONFIG_DOC = 'b2b_catalog'

function db() {
  return wx.cloud.database()
}

function calcTotal(items) {
  let sum = 0
  let any = false
  for (const it of items || []) {
    if (it.unitPrice != null && Number.isFinite(Number(it.unitPrice))) {
      sum += Number(it.unitPrice) * it.quantity
      any = true
    }
  }
  return any ? Math.round(sum * 100) / 100 : null
}

function genOrderNo() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const seq = String(Math.floor(Math.random() * 900) + 100)
  return `PO${y}${m}${day}${seq}`
}

async function listCatalog() {
  try {
    const res = await db().collection('configs').doc(CONFIG_DOC).get()
    const items = res.data && (res.data.items || res.data.catalog)
    if (Array.isArray(items) && items.length) return { items, source: 'configs' }
  } catch (e) {
    /* fallback seed */
  }
  return { items: CATALOG_SEED, source: 'seed' }
}

async function listStores() {
  try {
    const res = await db().collection('stores').limit(80).get()
    const stores = (res.data || []).filter((s) => s.status !== 'inactive')
    stores.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    if (stores.length) return { stores }
  } catch (e) {
    /* fallback */
  }
  return {
    stores: [
      { storeId: 'store_shanhaizaowu', name: '山海造物主店' },
      { storeId: 'store_xingchen', name: '星辰店' },
    ],
    fallback: true,
  }
}

async function listOrders({ status = 'all', limit = 80 } = {}) {
  const res = await db().collection(COL).limit(100).get()
  let list = res.data || []
  if (status && status !== 'all') list = list.filter((r) => r.status === status)
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  return { list: list.slice(0, Math.min(100, limit)) }
}

async function createDraft(payload) {
  const items = payload.items || []
  if (!items.length) throw new Error('请至少添加一件商品')
  const now = Date.now()
  const doc = {
    orderNo: genOrderNo(),
    source: payload.source || 'store_manager',
    intentId: payload.intentId || null,
    storeId: payload.storeId || null,
    storeName: payload.storeName || '',
    buyerType: payload.buyerType === 'channel' ? 'channel' : 'own_store',
    contactName: payload.contactName || '',
    contactPhone: payload.contactPhone || '',
    company: payload.company || '',
    shipToAddress: payload.shipToAddress || '',
    note: payload.note || '',
    items,
    totalAmount: calcTotal(items),
    status: 'draft',
    shipmentIds: [],
    createdAt: now,
    updatedAt: now,
    createdBy: getOpenid() || 'store_manager',
  }
  const addRes = await db().collection(COL).add({ data: doc })
  return { _id: addRes._id, order: { ...doc, _id: addRes._id } }
}

async function getOrder(orderId) {
  const got = await db().collection(COL).doc(orderId).get()
  if (!got.data) throw new Error('订货单不存在')
  return { ...got.data, _id: orderId }
}

async function submitOrder(orderId) {
  const row = await getOrder(orderId)
  if (row.status !== 'draft') throw new Error('仅草稿可提交')
  if (!row.items || !row.items.length) throw new Error('明细为空')
  const now = Date.now()
  await db().collection(COL).doc(orderId).update({
    data: { status: 'submitted', submittedAt: now, updatedAt: now },
  })
}

async function cancelOrder(orderId) {
  const row = await getOrder(orderId)
  if (!['draft', 'submitted'].includes(row.status)) throw new Error('当前状态不可取消')
  await db().collection(COL).doc(orderId).update({
    data: { status: 'cancelled', updatedAt: Date.now() },
  })
}

async function receiveOrder(orderId) {
  const row = await getOrder(orderId)
  if (!['shipped', 'shipping'].includes(row.status)) {
    throw new Error('仅已发货订货单可确认收货')
  }
  const now = Date.now()
  await db().collection(COL).doc(orderId).update({
    data: { status: 'closed', receivedAt: now, updatedAt: now },
  })
  try {
    const ships = await db().collection(SHIP_COL).where({ purchaseOrderId: orderId }).limit(20).get()
    for (const s of ships.data || []) {
      if (s.status === 'shipped') {
        await db().collection(SHIP_COL).doc(s._id).update({
          data: { status: 'delivered', updatedAt: now },
        })
      }
    }
  } catch (e) {
    /* 出货集合未建时不阻断收货 */
  }
}

module.exports = {
  listCatalog,
  listStores,
  listOrders,
  createDraft,
  submitOrder,
  cancelOrder,
  receiveOrder,
}
