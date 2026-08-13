/**
 * 门店 / 渠道正式订货单
 * P0：草稿、提交、确认、取消、意向转单、目录与列表
 * P1：出货扣库、收货（action 已预留）
 */
const cloud = require('wx-server-sdk')
const CATALOG_SEED = require('./b2bCatalogSeed')
const { deductStock, sumSkuStock } = require('./stockUtils')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COL = 'purchase_orders'
const INTENT_COL = 'purchase_intents'
const SHIP_COL = 'fulfillment_shipments'
const MOVE_COL = 'stock_movements'
const CONFIG_DOC = 'b2b_catalog'

function getAdminOpenids() {
  const env = process.env.MESSAGE_ADMIN_OPENIDS || ''
  return env.split(',').map((s) => s.trim()).filter(Boolean)
}

function isAdmin(openid) {
  const admins = getAdminOpenids()
  if (!admins.length) return true
  return admins.includes(openid)
}

function ok(data = {}) {
  return { success: true, ...data }
}

function fail(msg) {
  return { success: false, msg: msg || '失败' }
}

function pad(n, w = 3) {
  return String(n).padStart(w, '0')
}

async function nextOrderNo() {
  const d = new Date()
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1, 2)
  const day = pad(d.getDate(), 2)
  const prefix = `PO${y}${m}${day}`
  try {
    const res = await db
      .collection(COL)
      .where({ orderNo: db.RegExp({ regexp: `^${prefix}` }) })
      .orderBy('orderNo', 'desc')
      .limit(1)
      .get()
    const last = res.data && res.data[0] && res.data[0].orderNo
    let seq = 1
    if (last && last.length >= prefix.length + 3) {
      seq = parseInt(last.slice(prefix.length), 10) + 1 || 1
    }
    return `${prefix}${pad(seq)}`
  } catch (e) {
    return `${prefix}${pad(Math.floor(Math.random() * 900) + 100)}`
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length) return null
  const out = []
  for (const raw of items) {
    if (!raw || !raw.name) continue
    const quantity = Math.max(1, parseInt(raw.quantity, 10) || 1)
    const unitPrice =
      raw.unitPrice != null
        ? Number(raw.unitPrice)
        : raw.price != null
          ? Number(raw.price)
          : null
    out.push({
      skuId: String(raw.skuId || raw.id || ''),
      productId: raw.productId ? String(raw.productId) : null,
      name: String(raw.name).trim(),
      quantity,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
      priceLabel: raw.priceLabel || null,
      priceMax: raw.priceMax != null ? Number(raw.priceMax) : null,
      priceIsRange: !!raw.priceIsRange,
    })
  }
  return out.length ? out : null
}

function calcTotal(items) {
  let sum = 0
  let any = false
  for (const it of items || []) {
    if (it.unitPrice != null && Number.isFinite(it.unitPrice)) {
      sum += it.unitPrice * it.quantity
      any = true
    }
  }
  return any ? Math.round(sum * 100) / 100 : null
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const { action } = event

  // 公开只读目录（仍要求登录小程序）
  if (action === 'listCatalog') {
    return listCatalog()
  }

  if (!isAdmin(openid)) {
    return fail('无管理权限')
  }

  switch (action) {
    case 'listStores':
      return listStores()
    case 'createDraft':
      return createDraft(event, openid)
    case 'updateDraft':
      return updateDraft(event, openid)
    case 'submit':
      return submitOrder(event, openid)
    case 'list':
      return listOrders(event)
    case 'get':
      return getOrder(event)
    case 'confirm':
      return confirmOrder(event, openid)
    case 'cancel':
      return cancelOrder(event, openid)
    case 'convertFromIntent':
      return convertFromIntent(event, openid)
    case 'receive':
      return receiveOrder(event, openid)
    case 'listShipments':
      return listShipments(event)
    case 'ship':
      return shipOrder(event, openid)
    default:
      return fail('未知 action')
  }
}

async function listCatalog() {
  try {
    const doc = await db.collection('configs').doc(CONFIG_DOC).get()
    const items = doc.data && (doc.data.items || doc.data.catalog)
    if (Array.isArray(items) && items.length) {
      return ok({ items, source: 'configs' })
    }
  } catch (e) {
    /* fallback seed */
  }
  return ok({ items: CATALOG_SEED, source: 'seed' })
}

async function listStores() {
  try {
    const res = await db.collection('stores').orderBy('sort', 'asc').get()
    const stores = (res.data || []).filter((s) => s.status !== 'inactive')
    return ok({ stores })
  } catch (e) {
    return ok({
      stores: [
        { storeId: 'store_shanhaizaowu', name: '山海造物主店' },
        { storeId: 'store_xingchen', name: '星辰店' },
      ],
      fallback: true,
    })
  }
}

async function createDraft(event, openid) {
  const items = normalizeItems(event.items)
  if (!items) return fail('请至少添加一件商品')

  const now = Date.now()
  const orderNo = await nextOrderNo()
  const buyerType = event.buyerType === 'channel' ? 'channel' : 'own_store'
  const doc = {
    orderNo,
    source: event.source || 'store_manager',
    intentId: event.intentId || null,
    storeId: event.storeId || null,
    storeName: event.storeName || '',
    buyerType,
    contactName: event.contactName || '',
    contactPhone: event.contactPhone || '',
    company: event.company || '',
    shipToAddress: event.shipToAddress || '',
    note: event.note || '',
    items,
    totalAmount: calcTotal(items),
    status: 'draft',
    shipmentIds: [],
    createdAt: now,
    updatedAt: now,
    createdBy: openid || 'admin',
  }

  try {
    const addRes = await db.collection(COL).add({ data: doc })
    return ok({ _id: addRes._id, order: { ...doc, _id: addRes._id } })
  } catch (e) {
    console.error('createDraft', e)
    return fail(e.message || '创建失败')
  }
}

async function updateDraft(event) {
  const { orderId, patch = {} } = event
  if (!orderId) return fail('缺少 orderId')
  try {
    const got = await db.collection(COL).doc(orderId).get()
    const row = got.data
    if (!row) return fail('订货单不存在')
    if (row.status !== 'draft') return fail('仅草稿可编辑')

    const data = { updatedAt: Date.now() }
    ;['storeId', 'storeName', 'contactName', 'contactPhone', 'company', 'shipToAddress', 'note', 'buyerType'].forEach(
      (k) => {
        if (patch[k] !== undefined) data[k] = patch[k]
      }
    )
    if (patch.items) {
      const items = normalizeItems(patch.items)
      if (!items) return fail('明细无效')
      data.items = items
      data.totalAmount = calcTotal(items)
    }

    await db.collection(COL).doc(orderId).update({ data })
    return ok()
  } catch (e) {
    console.error('updateDraft', e)
    return fail(e.message || '更新失败')
  }
}

async function submitOrder(event) {
  const { orderId } = event
  if (!orderId) return fail('缺少 orderId')
  try {
    const got = await db.collection(COL).doc(orderId).get()
    const row = got.data
    if (!row) return fail('订货单不存在')
    if (row.status !== 'draft') return fail('仅草稿可提交')
    if (!row.items || !row.items.length) return fail('明细为空')

    const now = Date.now()
    await db.collection(COL).doc(orderId).update({
      data: { status: 'submitted', submittedAt: now, updatedAt: now },
    })
    return ok({ status: 'submitted' })
  } catch (e) {
    console.error('submit', e)
    return fail(e.message || '提交失败')
  }
}

async function listOrders(event) {
  const { status, storeId, limit = 50 } = event
  try {
    const res = await db.collection(COL).limit(200).get()
    let list = res.data || []
    if (status && status !== 'all') {
      list = list.filter((r) => r.status === status)
    }
    if (storeId) {
      list = list.filter((r) => r.storeId === storeId)
    }
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return ok({ list: list.slice(0, Math.min(200, limit)) })
  } catch (e) {
    console.error('list', e)
    return fail(e.message || '列表失败')
  }
}

async function getOrder(event) {
  const { orderId } = event
  if (!orderId) return fail('缺少 orderId')
  try {
    const got = await db.collection(COL).doc(orderId).get()
    if (!got.data) return fail('不存在')
    return ok({ order: { ...got.data, _id: orderId } })
  } catch (e) {
    return fail(e.message || '读取失败')
  }
}

async function confirmOrder(event) {
  const { orderId } = event
  if (!orderId) return fail('缺少 orderId')
  try {
    const got = await db.collection(COL).doc(orderId).get()
    const row = got.data
    if (!row) return fail('订货单不存在')
    if (row.status !== 'submitted') return fail('仅「已提交」可确认')

    const now = Date.now()
    await db.collection(COL).doc(orderId).update({
      data: { status: 'confirmed', confirmedAt: now, updatedAt: now },
    })
    return ok({ status: 'confirmed' })
  } catch (e) {
    return fail(e.message || '确认失败')
  }
}

async function cancelOrder(event) {
  const { orderId } = event
  if (!orderId) return fail('缺少 orderId')
  try {
    const got = await db.collection(COL).doc(orderId).get()
    const row = got.data
    if (!row) return fail('订货单不存在')
    if (!['draft', 'submitted'].includes(row.status)) {
      return fail('当前状态不可取消')
    }
    const now = Date.now()
    await db.collection(COL).doc(orderId).update({
      data: { status: 'cancelled', updatedAt: now },
    })
    return ok({ status: 'cancelled' })
  } catch (e) {
    return fail(e.message || '取消失败')
  }
}

async function convertFromIntent(event, openid) {
  const { intentId } = event
  if (!intentId) return fail('缺少 intentId')
  try {
    const got = await db.collection(INTENT_COL).doc(intentId).get()
    const intent = got.data
    if (!intent) return fail('意向不存在')
    if (intent.convertedOrderId) {
      return ok({
        already: true,
        orderId: intent.convertedOrderId,
        msg: '该意向已转过正式单',
      })
    }

    const items = normalizeItems(
      (intent.items || []).map((it) => ({
        skuId: it.skuId,
        name: it.name,
        quantity: it.quantity,
        unitPrice: it.price,
        priceMax: it.priceMax,
        priceIsRange: it.priceIsRange,
        priceLabel: it.priceLabel,
      }))
    )
    if (!items) return fail('意向明细为空')

    const created = await createDraft(
      {
        items,
        source: 'price_list_convert',
        intentId,
        buyerType: 'channel',
        storeId: null,
        storeName: intent.company || '',
        contactName: intent.contactName || '',
        contactPhone: intent.contactPhone || '',
        company: intent.company || '',
        note: intent.note || '',
      },
      openid
    )
    if (!created.success) return created

    const orderId = created._id
    const now = Date.now()
    await db.collection(COL).doc(orderId).update({
      data: {
        status: 'submitted',
        submittedAt: now,
        updatedAt: now,
      },
    })

    await db.collection(INTENT_COL).doc(intentId).update({
      data: {
        status: 'closed',
        convertedOrderId: orderId,
        convertedAt: now,
        updatedAt: now,
      },
    })

    return ok({
      orderId,
      orderNo: created.order && created.order.orderNo,
      status: 'submitted',
    })
  } catch (e) {
    console.error('convertFromIntent', e)
    return fail(e.message || '转单失败')
  }
}

/** P1 收货：已发货订货单确认收货并关闭 */
async function receiveOrder(event, openid) {
  const { orderId } = event
  if (!orderId) return fail('缺少 orderId')
  try {
    const got = await db.collection(COL).doc(orderId).get()
    const row = got.data
    if (!row) return fail('订货单不存在')
    if (!['shipped', 'shipping'].includes(row.status)) {
      return fail('仅已发货订货单可确认收货')
    }
    const now = Date.now()
    await db.collection(COL).doc(orderId).update({
      data: {
        status: 'closed',
        receivedAt: now,
        updatedAt: now,
      },
    })

    try {
      const ships = await db.collection(SHIP_COL).where({ purchaseOrderId: orderId }).limit(20).get()
      for (const s of ships.data || []) {
        if (s.status === 'shipped') {
          await db.collection(SHIP_COL).doc(s._id).update({
            data: { status: 'delivered', updatedAt: now },
          })
        }
      }
    } catch (e) {
      console.warn('mark shipments delivered', e)
    }

    return ok({ status: 'closed', operator: openid || '' })
  } catch (e) {
    return fail(e.message || '收货失败')
  }
}

async function nextShipmentNo() {
  const d = new Date()
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1, 2)
  const day = pad(d.getDate(), 2)
  const prefix = `SH${y}${m}${day}`
  return `${prefix}${pad(Math.floor(Math.random() * 900) + 100)}`
}

async function listShipments(event) {
  const { status, limit = 50 } = event
  try {
    const res = await db.collection(SHIP_COL).limit(200).get()
    let list = res.data || []
    if (status && status !== 'all') list = list.filter((r) => r.status === status)
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return ok({ list: list.slice(0, Math.min(200, limit)) })
  } catch (e) {
    return fail(e.message || '出货单列表失败（请确认已创建集合）')
  }
}

/**
 * 整单发货：创建出货单 → 扣 HQ 库存 → 写流水 → PO=shipped
 * event.items 可覆盖 productId 绑定
 */
async function shipOrder(event, openid) {
  const { orderId, carrier = '顺丰速运', trackingNumber = '', items: itemOverrides } = event
  if (!orderId) return fail('缺少 orderId')
  const track = String(trackingNumber || '').trim()
  if (track.length < 6) return fail('请填写有效物流单号（至少 6 位）')

  try {
    const got = await db.collection(COL).doc(orderId).get()
    const order = got.data
    if (!order) return fail('订货单不存在')
    if (!['confirmed', 'shipping'].includes(order.status)) {
      return fail('仅「已确认 / 出货中」可发货')
    }

    const baseItems = Array.isArray(itemOverrides) && itemOverrides.length ? itemOverrides : order.items || []
    const shipItems = []
    for (const raw of baseItems) {
      if (!raw || !raw.name) continue
      const productId = raw.productId ? String(raw.productId) : null
      if (!productId) {
        return fail(`SKU「${raw.name}」未绑定商品档案 productId，无法扣库`)
      }
      shipItems.push({
        skuId: String(raw.skuId || ''),
        productId,
        name: String(raw.name).trim(),
        quantity: Math.max(1, parseInt(raw.quantity, 10) || 1),
      })
    }
    if (!shipItems.length) return fail('出货明细为空')

    const now = Date.now()
    const shipmentNo = await nextShipmentNo()
    const addRes = await db.collection(SHIP_COL).add({
      data: {
        shipmentNo,
        purchaseOrderId: orderId,
        orderNo: order.orderNo || '',
        storeId: order.storeId || null,
        storeName: order.storeName || '',
        items: shipItems,
        status: 'pending',
        logistics: { carrier, trackingNumber: track, shipTime: null },
        stockDeducted: false,
        createdAt: now,
        updatedAt: now,
        createdBy: openid || 'admin',
      },
    })
    const shipmentId = addRes._id

    for (const it of shipItems) {
      await deductStock(db, _, it.productId, it.skuId || null, it.quantity)
      const productRes = await db.collection('products').doc(it.productId).get()
      const product = productRes.data || {}
      const balanceAfter = sumSkuStock(product)
      await db.collection(MOVE_COL).add({
        data: {
          warehouseId: 'hq',
          productId: it.productId,
          skuId: it.skuId || null,
          skuName: product.title || it.name,
          delta: -it.quantity,
          balanceAfter,
          type: 'outbound_ship',
          refType: 'fulfillment_shipment',
          refId: shipmentId,
          note: `出货 ${shipmentNo} / 订货单 ${order.orderNo || orderId}`,
          operator: openid || 'admin',
          createdAt: Date.now(),
        },
      })
    }

    await db.collection(SHIP_COL).doc(shipmentId).update({
      data: {
        status: 'shipped',
        stockDeducted: true,
        logistics: { carrier, trackingNumber: track, shipTime: now },
        updatedAt: now,
      },
    })

    const shipmentIds = Array.isArray(order.shipmentIds) ? order.shipmentIds.slice() : []
    if (!shipmentIds.includes(shipmentId)) shipmentIds.push(shipmentId)

    const mergedItems = (order.items || []).map((oi) => {
      const hit =
        shipItems.find((s) => s.skuId && s.skuId === oi.skuId) ||
        shipItems.find((s) => s.name === oi.name)
      if (!hit) return oi
      return { ...oi, productId: hit.productId || oi.productId }
    })

    await db.collection(COL).doc(orderId).update({
      data: {
        status: 'shipped',
        shippedAt: now,
        updatedAt: now,
        shipmentIds,
        items: mergedItems,
      },
    })

    return ok({ shipmentId, shipmentNo, status: 'shipped' })
  } catch (e) {
    console.error('shipOrder', e)
    return fail(e.message || '发货失败')
  }
}
