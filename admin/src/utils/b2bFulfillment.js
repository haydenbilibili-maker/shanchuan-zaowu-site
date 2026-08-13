/**
 * Admin 端 B2B 履约工具：出货扣库、流水、门店/商品加载、导出
 */
import { cdnAdd, cdnUpdate, cdnDocGet, fetchCollectionSorted } from '../cloud'
import { B2B_CATALOG } from './b2bCatalog'

export const PO_COL = 'purchase_orders'
export const SHIP_COL = 'fulfillment_shipments'
export const MOVE_COL = 'stock_movements'
const PRODUCTS = 'products'

export const CARRIERS = ['顺丰速运', '京东物流', '中通快递', '圆通速递', '申通快递', '韵达快递', 'EMS', '自送/上门']

export const PO_STATUS = {
  draft: { text: '草稿', type: 'info' },
  submitted: { text: '已提交', type: 'warning' },
  confirmed: { text: '已确认', type: '' },
  shipping: { text: '出货中', type: '' },
  shipped: { text: '已发货', type: 'success' },
  received: { text: '已收货', type: 'success' },
  closed: { text: '已关闭', type: 'info' },
  cancelled: { text: '已取消', type: 'danger' },
}

export const SHIP_STATUS = {
  pending: { text: '待发', type: 'warning' },
  shipped: { text: '已发货', type: 'success' },
  delivered: { text: '已送达', type: '' },
  cancelled: { text: '已取消', type: 'info' },
}

export const statusLabel = (map, s) => map[s]?.text || s || '—'
export const statusType = (map, s) => map[s]?.type || 'info'
export const buyerLabel = (t) => (t === 'channel' ? '渠道' : '自营店')
export const sourceLabel = (s) =>
  ({ store_manager: '店长', price_list_convert: '意向转单', admin: 'Admin' })[s] || s || '—'

export function fmtTime(ts) {
  if (!ts) return ''
  const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN')
}

export function calcItemsTotal(items) {
  let sum = 0
  let any = false
  for (const it of items || []) {
    const p = it.unitPrice != null ? Number(it.unitPrice) : Number(it.price)
    const q = Math.max(1, parseInt(it.quantity, 10) || 1)
    if (Number.isFinite(p)) {
      sum += p * q
      any = true
    }
  }
  return any ? Math.round(sum * 100) / 100 : null
}

export function genOrderNo() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const seq = String(Math.floor(Math.random() * 900) + 100)
  return `PO${y}${m}${day}${seq}`
}

export function downloadCsv(filename, header, rows) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [header.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))]
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function copyText(text) {
  await navigator.clipboard.writeText(text)
}

export async function loadStores() {
  try {
    const rows = await fetchCollectionSorted('stores', {
      limit: 80,
      throwOnError: false,
      sortFn: (a, b) => (a.sort ?? 0) - (b.sort ?? 0),
    })
    return (rows || []).filter((s) => s.status !== 'inactive')
  } catch {
    return []
  }
}

export async function loadHqProducts() {
  try {
    return await fetchCollectionSorted(PRODUCTS, {
      limit: 400,
      throwOnError: false,
      sortFn: (a, b) => String(a.title || a.name || '').localeCompare(String(b.title || b.name || ''), 'zh'),
    })
  } catch {
    return []
  }
}

export function productStock(p) {
  if (!p) return 0
  return parseInt(p.stock, 10) || 0
}

export function guessProduct(item, products) {
  if (item?.productId) {
    const hit = products.find((p) => p._id === item.productId)
    if (hit) return hit
  }
  const name = String(item?.name || '').replace(/\s/g, '')
  if (!name) return null
  return (
    products.find((p) => String(p.title || '').replace(/\s/g, '') === name) ||
    products.find((p) => String(p.title || '').includes(item.name) || name.includes(String(p.title || '').replace(/\s/g, ''))) ||
    null
  )
}

export { B2B_CATALOG }

function genShipmentNo() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const seq = String(Math.floor(Math.random() * 900) + 100)
  return `SH${y}${m}${day}${seq}`
}

function hasSkus(product) {
  return !!(product && product.hasSku && Array.isArray(product.skus) && product.skus.length > 0)
}

function findSkuIndex(product, skuId) {
  if (!hasSkus(product) || !skuId) return -1
  return product.skus.findIndex((s) => s && (s.id === skuId || s.skuId === skuId))
}

/**
 * @param {object} opts
 * @param {object} opts.order - purchase_orders 文档（含 _id）
 * @param {Array<{skuId,productId,name,quantity}>} opts.items - 已绑定 productId 的明细
 * @param {string} opts.carrier
 * @param {string} opts.trackingNumber
 */
export async function shipPurchaseOrder({ order, items, carrier = '顺丰速运', trackingNumber = '' }) {
  if (!order?._id) throw new Error('缺少订货单')
  if (!['confirmed', 'shipping'].includes(order.status)) {
    throw new Error('仅「已确认 / 出货中」可发货')
  }
  const track = String(trackingNumber || '').trim()
  if (track.length < 6) throw new Error('请填写有效物流单号（至少 6 位）')

  const shipItems = (items || []).map((it) => ({
    skuId: String(it.skuId || ''),
    productId: it.productId ? String(it.productId) : null,
    name: String(it.name || '').trim(),
    quantity: Math.max(1, parseInt(it.quantity, 10) || 1),
  }))
  if (!shipItems.length) throw new Error('出货明细为空')

  const missing = shipItems.filter((it) => !it.productId)
  if (missing.length) {
    throw new Error(`以下 SKU 未绑定商品档案，无法扣库：${missing.map((m) => m.name || m.skuId).join('、')}`)
  }

  // 预检库存
  for (const it of shipItems) {
    const product = await cdnDocGet(PRODUCTS, it.productId)
    if (!product) throw new Error(`商品不存在：${it.name}`)
    let stock = parseInt(product.stock, 10) || 0
    if (hasSkus(product)) {
      const idx = findSkuIndex(product, it.skuId)
      if (idx >= 0) stock = parseInt(product.skus[idx].stock, 10) || 0
    }
    if (stock < it.quantity) {
      throw new Error(`库存不足：${product.title || it.name}（现有 ${stock}，需要 ${it.quantity}）`)
    }
  }

  const now = Date.now()
  const shipmentNo = genShipmentNo()
  const addRes = await cdnAdd(SHIP_COL, {
    shipmentNo,
    purchaseOrderId: order._id,
    orderNo: order.orderNo || '',
    storeId: order.storeId || null,
    storeName: order.storeName || '',
    items: shipItems,
    status: 'pending',
    logistics: { carrier, trackingNumber: track, shipTime: null },
    stockDeducted: false,
    createdAt: now,
    updatedAt: now,
    createdBy: 'admin',
  })
  const shipmentId = addRes?.id || addRes?._id
  if (!shipmentId) throw new Error('出货单创建失败')

  // 扣库 + 流水
  for (const it of shipItems) {
    const product = await cdnDocGet(PRODUCTS, it.productId)
    const title = product.title || it.name
    let balanceAfter = 0

    if (hasSkus(product) && it.skuId) {
      const idx = findSkuIndex(product, it.skuId)
      if (idx < 0) throw new Error(`规格不存在：${title}`)
      const skuStock = parseInt(product.skus[idx].stock, 10) || 0
      if (skuStock < it.quantity) throw new Error(`库存不足：${title}`)
      const skus = product.skus.map((s, i) =>
        i === idx ? { ...s, stock: skuStock - it.quantity } : s
      )
      balanceAfter = skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0)
      await cdnUpdate(PRODUCTS, it.productId, {
        skus,
        stock: balanceAfter,
        soldCount: (parseInt(product.soldCount, 10) || 0) + it.quantity,
      })
    } else {
      const stock = parseInt(product.stock, 10) || 0
      if (stock < it.quantity) throw new Error(`库存不足：${title}`)
      balanceAfter = stock - it.quantity
      await cdnUpdate(PRODUCTS, it.productId, {
        stock: balanceAfter,
        soldCount: (parseInt(product.soldCount, 10) || 0) + it.quantity,
      })
    }

    await cdnAdd(MOVE_COL, {
      warehouseId: 'hq',
      productId: it.productId,
      skuId: it.skuId || null,
      skuName: title,
      delta: -it.quantity,
      balanceAfter,
      type: 'outbound_ship',
      refType: 'fulfillment_shipment',
      refId: shipmentId,
      note: `出货 ${shipmentNo} / 订货单 ${order.orderNo || order._id}`,
      operator: 'admin',
      createdAt: Date.now(),
    })
  }

  await cdnUpdate(SHIP_COL, shipmentId, {
    status: 'shipped',
    stockDeducted: true,
    logistics: { carrier, trackingNumber: track, shipTime: now },
    updatedAt: now,
  })

  const shipmentIds = Array.isArray(order.shipmentIds) ? [...order.shipmentIds] : []
  if (!shipmentIds.includes(shipmentId)) shipmentIds.push(shipmentId)

  // 同步回写 PO 行上的 productId（便于下次）
  const mergedItems = (order.items || []).map((oi) => {
    const hit = shipItems.find((s) => s.skuId && s.skuId === oi.skuId) ||
      shipItems.find((s) => s.name === oi.name)
    if (!hit) return oi
    return { ...oi, productId: hit.productId || oi.productId }
  })

  await cdnUpdate(PO_COL, order._id, {
    status: 'shipped',
    shippedAt: now,
    updatedAt: now,
    shipmentIds,
    items: mergedItems,
  })

  return { shipmentId, shipmentNo }
}

export async function listShipments({ status = 'all', limit = 100 } = {}) {
  const where = status === 'all' ? null : { status }
  return fetchCollectionSorted(SHIP_COL, {
    limit,
    where,
    throwOnError: true,
    sortFn: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
  })
}

export async function markOrderReceived(orderId) {
  const now = Date.now()
  await cdnUpdate(PO_COL, orderId, {
    status: 'closed',
    receivedAt: now,
    updatedAt: now,
  })
  try {
    const ships = await fetchCollectionSorted(SHIP_COL, {
      limit: 50,
      where: { purchaseOrderId: orderId },
      throwOnError: false,
    })
    for (const s of ships || []) {
      if (s.status === 'shipped') {
        await cdnUpdate(SHIP_COL, s._id, { status: 'delivered', updatedAt: now })
      }
    }
  } catch {
    /* 出货回写失败不阻断收货 */
  }
}

export async function listStockMovements({ limit = 150 } = {}) {
  return fetchCollectionSorted(MOVE_COL, {
    limit,
    throwOnError: true,
    sortFn: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
  })
}

export function summarizeOrders(orders = []) {
  const n = (st) => orders.filter((o) => o.status === st).length
  const toShip = n('confirmed') + n('shipping')
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const ms = monthStart.getTime()
  const monthAmount = orders
    .filter((o) => !['cancelled', 'draft'].includes(o.status) && (o.createdAt || 0) >= ms)
    .reduce((s, o) => s + (Number(o.totalAmount) || 0), 0)
  return {
    total: orders.length,
    submitted: n('submitted'),
    toShip,
    shipped: n('shipped'),
    closed: n('closed'),
    cancelled: n('cancelled'),
    monthAmount: Math.round(monthAmount * 100) / 100,
  }
}

export function buildOrderCopyText(row) {
  const lines = [
    `【订货单 ${row.orderNo || ''}】${statusLabel(PO_STATUS, row.status)}`,
    `买方：${row.storeName || row.company || '—'}（${buyerLabel(row.buyerType)}）`,
    `联系人：${row.contactName || '—'} ${row.contactPhone || ''}`,
    `地址：${row.shipToAddress || '—'}`,
    `备注：${row.note || '—'}`,
    '',
    '明细：',
    ...(Array.isArray(row.items)
      ? row.items.map(
          (it, i) =>
            `${i + 1}. ${it.name} × ${it.quantity}${it.unitPrice != null ? ` · ¥${it.unitPrice}` : ''}`
        )
      : ['（无）']),
  ]
  if (row.totalAmount != null) lines.push('', `合计：¥${row.totalAmount}`)
  return lines.join('\n')
}
