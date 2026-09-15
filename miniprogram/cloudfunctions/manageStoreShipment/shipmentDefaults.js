/**
 * 工作室/门店出货单常量、解析与归一化
 * SSOT：ops_shipments
 *
 * 字段 SSOT 对齐飞书「出货表」tbl2lCz8GX2MVDnO：
 *   出货编号 / 出货日期 / 物品名称 / 规格型号 / 分类(工具|标本) /
 *   客户名称 / 数量 / 单价 / 总价 / 状态(待发货|已发货|已签收|已完成) /
 *   快递公司 / 运单号 / 备注 / 关联库存
 *
 * 小程序扩展（单条录入）：
 *   buyerName（购买人）/ productId / skuId（商品或 SKU 关联）
 *
 * 粘贴录入仍按「出货日 + 客户块 + 品名-数量」解析，写入时映射到上表字段。
 * 飞书扁平行同步：一行飞书记录 = 一张单明细出货单。
 */

const COLLECTION = 'ops_shipments'
const SYNC_META_COLLECTION = 'configs'
const SYNC_META_ID = 'ops_shipment_sync'
const SYNC_LOG_COLLECTION = 'feishu_sync_logs'

const STORES = [
  { id: 'store_shanhaizaowu', name: '山川造物', aliases: ['山川造物', '山海造物', '山川'] },
  { id: 'store_xingchen', name: '星宸标本', aliases: ['星宸标本', '星宸'] }
]

const SOURCE = {
  FEISHU: 'feishu',
  ERP: 'erp',
  MANUAL: 'manual'
}

const SOURCE_LABEL = {
  feishu: '飞书',
  erp: 'ERP',
  manual: '手工录入'
}

/** 与飞书出货表「状态」对齐；draft/confirmed 为粘贴录入过渡态 */
const STATUS = {
  DRAFT: 'draft',
  CONFIRMED: 'confirmed',
  PENDING: 'pending',
  SHIPPED: 'shipped',
  RECEIVED: 'received',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
}

const STATUS_LABEL = {
  draft: '草稿',
  confirmed: '已确认',
  pending: '待发货',
  shipped: '已发货',
  received: '已签收',
  completed: '已完成',
  cancelled: '已取消'
}

const STATUS_FLOW = {
  draft: ['confirmed', 'pending', 'shipped', 'cancelled'],
  confirmed: ['pending', 'shipped', 'cancelled'],
  pending: ['shipped', 'cancelled'],
  shipped: ['received', 'completed'],
  received: ['completed'],
  completed: [],
  cancelled: []
}

const CATEGORY = {
  TOOL: '工具',
  SPECIMEN: '标本'
}

const CATEGORY_OPTIONS = [CATEGORY.TOOL, CATEGORY.SPECIMEN]

function storeById(id) {
  const key = String(id || '').trim()
  return STORES.find((s) => s.id === key) || null
}

function guessStoreId(raw, fallback) {
  const s = String(raw || '').trim()
  if (!s) return fallback || ''
  const byId = storeById(s)
  if (byId) return byId.id
  for (let i = 0; i < STORES.length; i += 1) {
    const st = STORES[i]
    if (st.name === s) return st.id
    if (st.aliases.some((a) => a === s || s.indexOf(a) !== -1)) return st.id
  }
  if (/星宸/.test(s)) return 'store_xingchen'
  if (/山川|造物|山海/.test(s)) return 'store_shanhaizaowu'
  return fallback || ''
}

function isStoreLine(line) {
  return !!guessStoreId(line)
}

function normalizeStatus(raw) {
  const s = String(raw || '').trim()
  if (STATUS_LABEL[s]) return s
  if (/草稿|拟/.test(s)) return STATUS.DRAFT
  if (/确认/.test(s)) return STATUS.CONFIRMED
  if (/待发/.test(s)) return STATUS.PENDING
  if (/已签收|签收/.test(s)) return STATUS.RECEIVED
  if (/已完成|完成/.test(s)) return STATUS.COMPLETED
  if (/已发货|已出货|发货|出货/.test(s)) return STATUS.SHIPPED
  if (/取消|作废/.test(s)) return STATUS.CANCELLED
  return STATUS.DRAFT
}

function normalizeCategory(raw) {
  const s = String(raw || '').trim()
  if (CATEGORY_OPTIONS.indexOf(s) !== -1) return s
  if (/工具|耗材|硬件/.test(s)) return CATEGORY.TOOL
  if (/标本|成品|原料/.test(s)) return CATEGORY.SPECIMEN
  return ''
}

function roundMoney(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 100) / 100
}

function normalizeSource(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (SOURCE_LABEL[s]) return s
  if (s === 'admin' || s === 'web') return SOURCE.ERP
  if (s === 'paste' || s === 'text') return SOURCE.MANUAL
  return SOURCE.MANUAL
}

function sourceLabel(s) {
  return SOURCE_LABEL[normalizeSource(s)] || '手工录入'
}

function statusLabel(s) {
  return STATUS_LABEL[normalizeStatus(s)] || s || ''
}

function canTransit(from, to) {
  const f = normalizeStatus(from)
  const t = normalizeStatus(to)
  if (f === t) return true
  return (STATUS_FLOW[f] || []).indexOf(t) !== -1
}

function storeIdsForActor(storeIds) {
  const ids = Array.isArray(storeIds)
    ? storeIds.map((x) => String(x || '').trim()).filter(Boolean)
    : []
  if (!ids.length) return STORES.map((s) => s.id)
  const MAIN = ['store_shanhaizaowu', 'store_1780146782017_6w0okpr']
  const out = {}
  ids.forEach((sid) => {
    if (storeById(sid)) out[sid] = true
    if (MAIN.indexOf(sid) !== -1) out.store_shanhaizaowu = true
    if (/星宸/.test(sid) || sid === 'store_xingchen') out.store_xingchen = true
  })
  const keys = Object.keys(out)
  return keys.length ? keys : ['store_shanhaizaowu']
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function genShipmentNo(dateStr) {
  const d = String(dateStr || '').replace(/-/g, '').slice(0, 8)
  const base = d || (() => {
    const now = new Date()
    return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
  })()
  const rand = String(Math.floor(Math.random() * 9000) + 1000)
  return `SH${base}${rand}`
}

/**
 * 解析日期行：2026，9.14出货 / 2026,9.14出货 / 2026-09-14出货 / 2026.9.14 出货
 * @returns {string|null} YYYY-MM-DD
 */
function parseShipmentDateLine(line) {
  const s = String(line || '').trim()
  if (!s || !/出货/.test(s)) return null

  // YYYY ，/ , / - / .  M . D
  let m = s.match(
    /(\d{4})\s*[，,.\-\/]\s*(\d{1,2})\s*[.．\-／\/]\s*(\d{1,2})/
  )
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2])
    const d = Number(m[3])
    if (y >= 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${pad2(mo)}-${pad2(d)}`
    }
  }

  // YYYY-MM-DD / YYYY/MM/DD
  m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2])
    const d = Number(m[3])
    if (y >= 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${pad2(mo)}-${pad2(d)}`
    }
  }

  // 仅月日：9.14出货（缺少年份时用当前年）
  m = s.match(/(\d{1,2})\s*[.．]\s*(\d{1,2})\s*出货/)
  if (m) {
    const now = new Date()
    const mo = Number(m[1])
    const d = Number(m[2])
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${now.getFullYear()}-${pad2(mo)}-${pad2(d)}`
    }
  }

  return null
}

/**
 * 明细行：品名-数量（最后一个 -数字 为数量）
 */
function parseItemLine(line) {
  const s = String(line || '').trim()
  if (!s) return null
  const m = s.match(/^(.+)-(\d+)\s*$/)
  if (!m) return null
  const itemName = String(m[1] || '').trim()
  const qty = Number(m[2])
  if (!itemName || !Number.isFinite(qty) || qty <= 0) return null
  return { itemName, qty }
}

/**
 * 解析整段粘贴文本 → 预览结构
 */
function pushIssue(list, lineNo, text, msg, severity) {
  list.push({
    line: lineNo,
    text: String(text || ''),
    msg: String(msg || ''),
    severity: severity === 'error' ? 'error' : 'warn'
  })
}

function parseShipmentText(rawText) {
  const text = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = text.split('\n').map((l) => l.trim())
  const errors = []
  const warnings = []
  const failedLines = []
  let shipmentDate = ''
  let dateLineIndex = -1

  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i]) continue
    const d = parseShipmentDateLine(lines[i])
    if (d) {
      shipmentDate = d
      dateLineIndex = i
      break
    }
  }

  if (!shipmentDate) {
    const msg = '未识别出货日期行（需含「出货」，如 2026，9.14出货）'
    errors.push({ line: 1, msg })
    pushIssue(failedLines, 1, lines[0] || '', msg, 'error')
  }

  const shipments = []
  let current = null
  let sawStore = false

  for (let i = 0; i < lines.length; i += 1) {
    if (i === dateLineIndex) continue
    const line = lines[i]
    if (!line) {
      // 空行：结束当前门店块（不强制，下一门店名也会切换）
      continue
    }

    if (isStoreLine(line)) {
      sawStore = true
      const storeId = guessStoreId(line)
      const store = storeById(storeId)
      current = {
        storeId,
        storeName: (store && store.name) || line,
        items: [],
        lineStart: i + 1
      }
      shipments.push(current)
      continue
    }

    if (parseShipmentDateLine(line)) {
      const msg = `忽略额外日期行：${line}`
      warnings.push({ line: i + 1, msg })
      pushIssue(failedLines, i + 1, line, msg, 'warn')
      continue
    }

    const item = parseItemLine(line)
    if (item) {
      if (!current) {
        const msg = `明细「${line}」前缺少门店名`
        errors.push({ line: i + 1, msg })
        pushIssue(failedLines, i + 1, line, msg, 'error')
        continue
      }
      current.items.push(Object.assign({}, item, { lineNo: i + 1 }))
      continue
    }

    if (!sawStore && !shipmentDate) {
      const msg = `无法识别：${line}`
      errors.push({ line: i + 1, msg })
      pushIssue(failedLines, i + 1, line, msg, 'error')
    } else {
      const msg = `未识别为门店或「品名-数量」：${line}`
      warnings.push({ line: i + 1, msg })
      pushIssue(failedLines, i + 1, line, msg, 'warn')
    }
  }

  const blocks = shipments.filter((s) => s.items.length > 0)
  shipments.forEach((s) => {
    if (!s.items.length) {
      const msg = `门店「${s.storeName}」无有效明细`
      warnings.push({ line: s.lineStart, msg })
      pushIssue(failedLines, s.lineStart, s.storeName, msg, 'warn')
    }
  })

  if (!blocks.length && !errors.length) {
    const msg = '未解析到任何门店出货明细'
    errors.push({ line: 0, msg })
    pushIssue(failedLines, 0, '', msg, 'error')
  }

  const summary = {
    shipmentDate: shipmentDate || '',
    storeCount: blocks.length,
    itemCount: blocks.reduce((n, b) => n + b.items.length, 0),
    totalQty: blocks.reduce(
      (n, b) => n + b.items.reduce((m, it) => m + (Number(it.qty) || 0), 0),
      0
    )
  }

  return {
    ok: errors.length === 0 && blocks.length > 0,
    canWrite: blocks.length > 0 && !!shipmentDate,
    shipmentDate: shipmentDate || '',
    shipments: blocks.map((b) => ({
      storeId: b.storeId,
      storeName: b.storeName,
      items: b.items.map((it) => ({
        itemName: it.itemName,
        qty: it.qty,
        lineNo: it.lineNo || 0
      })),
      itemCount: b.items.length,
      totalQty: b.items.reduce((n, it) => n + (Number(it.qty) || 0), 0),
      collapsed: false
    })),
    summary,
    errors,
    warnings,
    failedLines,
    rawText: text
  }
}

function normalizeItems(rawItems) {
  const list = Array.isArray(rawItems) ? rawItems : []
  const items = []
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i] || {}
    const itemName = String(row.itemName || row.name || row.物品名称 || '').trim()
    const qty = Number(row.qty != null ? row.qty : row.quantity != null ? row.quantity : row.数量)
    if (!itemName) continue
    if (!Number.isFinite(qty) || qty <= 0) continue
    const unitPrice = roundMoney(
      row.unitPrice != null ? row.unitPrice : row.单价 != null ? row.单价 : 0
    )
    const totalPrice = roundMoney(
      row.totalPrice != null
        ? row.totalPrice
        : row.总价 != null
          ? row.总价
          : unitPrice * qty
    )
    items.push({
      itemName,
      spec: String(row.spec || row.规格型号 || '').trim(),
      category: normalizeCategory(row.category || row.分类),
      qty,
      unitPrice,
      totalPrice,
      productId: String(row.productId || '').trim(),
      skuId: String(row.skuId || row.sku || '').trim(),
      inventoryRecordId: String(
        row.inventoryRecordId || row.inventoryId || ''
      ).trim(),
      feishuRecordId: String(row.feishuRecordId || '').trim()
    })
  }
  return items
}

function normalizePayload(input, existing) {
  const src = input && typeof input === 'object' ? input : {}
  const prev = existing && typeof existing === 'object' ? existing : {}

  const storeId = guessStoreId(
    src.storeId || src.storeName || prev.storeId || prev.storeName,
    prev.storeId || ''
  )
  const store = storeById(storeId)
  if (!store) return { ok: false, msg: '请选择门店（山川造物 / 星宸标本）' }

  const shipmentDate = String(
    src.shipmentDate != null ? src.shipmentDate : prev.shipmentDate || ''
  )
    .trim()
    .slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shipmentDate)) {
    return { ok: false, msg: '出货日期须为 YYYY-MM-DD' }
  }

  const items = normalizeItems(src.items != null ? src.items : prev.items)
  if (!items.length) return { ok: false, msg: '请至少填写一条出货明细' }

  const status = normalizeStatus(src.status != null ? src.status : prev.status)
  const source = normalizeSource(
    src.source != null ? src.source : prev.source != null ? prev.source : SOURCE.MANUAL
  )
  const existingNo = String(src.shipmentNo || prev.shipmentNo || '').trim()
  const totalAmount = roundMoney(
    items.reduce((n, it) => n + (Number(it.totalPrice) || 0), 0)
  )
  const category =
    normalizeCategory(src.category || prev.category) ||
    (items.find((it) => it.category) || {}).category ||
    ''

  // 客户名称：飞书出货表字段；门店粘贴时与 storeName 同源
  const customerName = String(
    src.customerName != null
      ? src.customerName
      : src.客户名称 != null
        ? src.客户名称
        : prev.customerName || store.name || ''
  ).trim()

  const buyerName = String(
    src.buyerName != null
      ? src.buyerName
      : src.购买人 != null
        ? src.购买人
        : prev.buyerName || ''
  ).trim()

  const productId = String(
    src.productId != null
      ? src.productId
      : prev.productId || (items[0] && items[0].productId) || ''
  ).trim()
  const skuId = String(
    src.skuId != null ? src.skuId : prev.skuId || (items[0] && items[0].skuId) || ''
  ).trim()

  const inventoryRecordId = String(
    src.inventoryRecordId != null
      ? src.inventoryRecordId
      : prev.inventoryRecordId ||
          (items[0] && items[0].inventoryRecordId) ||
          ''
  ).trim()

  const row = {
    shipmentNo: existingNo || genShipmentNo(shipmentDate),
    shipmentDate,
    storeId: store.id,
    storeName: store.name,
    customerName: customerName || store.name,
    buyerName,
    category,
    items,
    itemCount: items.length,
    totalQty: items.reduce((n, it) => n + (Number(it.qty) || 0), 0),
    totalAmount,
    unitPrice: items.length === 1 ? items[0].unitPrice : 0,
    trackingNo: String(
      src.trackingNo != null ? src.trackingNo : src.运单号 != null ? src.运单号 : prev.trackingNo || ''
    ).trim(),
    expressCompany: String(
      src.expressCompany != null
        ? src.expressCompany
        : src.快递公司 != null
          ? src.快递公司
          : prev.expressCompany || ''
    ).trim(),
    status,
    statusLabel: statusLabel(status),
    note: String(src.note != null ? src.note : prev.note || '').trim(),
    rawText: String(src.rawText != null ? src.rawText : prev.rawText || '').trim(),
    batchId: String(src.batchId != null ? src.batchId : prev.batchId || '').trim(),
    source,
    sourceLabel: sourceLabel(source),
    productId,
    skuId,
    inventoryRecordId,
    feishuRecordId: String(
      src.feishuRecordId != null ? src.feishuRecordId : prev.feishuRecordId || ''
    ).trim(),
    syncedAt:
      src.syncedAt != null
        ? Number(src.syncedAt) || null
        : prev.syncedAt != null
          ? Number(prev.syncedAt) || null
          : null,
    deleted: false
  }

  return { ok: true, row }
}

function mapRow(doc) {
  if (!doc) return null
  const status = normalizeStatus(doc.status)
  const source = normalizeSource(doc.source || (doc.feishuRecordId ? SOURCE.FEISHU : SOURCE.MANUAL))
  const items = normalizeItems(doc.items)
  const totalAmount =
    roundMoney(doc.totalAmount) ||
    roundMoney(items.reduce((n, it) => n + (Number(it.totalPrice) || 0), 0))
  return {
    _id: doc._id,
    shipmentNo: doc.shipmentNo || '',
    shipmentDate: doc.shipmentDate || '',
    storeId: doc.storeId || '',
    storeName: doc.storeName || '',
    customerName: doc.customerName || doc.storeName || '',
    buyerName: doc.buyerName || '',
    category: normalizeCategory(doc.category) || '',
    items,
    itemCount: items.length || Number(doc.itemCount) || 0,
    totalQty:
      items.reduce((n, it) => n + (Number(it.qty) || 0), 0) || Number(doc.totalQty) || 0,
    totalAmount,
    unitPrice: roundMoney(doc.unitPrice),
    trackingNo: doc.trackingNo || '',
    expressCompany: doc.expressCompany || '',
    productId: doc.productId || (items[0] && items[0].productId) || '',
    skuId: doc.skuId || (items[0] && items[0].skuId) || '',
    inventoryRecordId: doc.inventoryRecordId || (items[0] && items[0].inventoryRecordId) || '',
    status,
    statusLabel: statusLabel(status),
    note: doc.note || '',
    rawText: doc.rawText || '',
    batchId: doc.batchId || '',
    source,
    sourceLabel: sourceLabel(source),
    feishuRecordId: doc.feishuRecordId || '',
    syncedAt: doc.syncedAt || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    createdBy: doc.createdBy || '',
    updatedBy: doc.updatedBy || ''
  }
}

function buildSummary(list) {
  const rows = Array.isArray(list) ? list : []
  const byStore = {}
  const byCustomer = {}
  const byCategory = {}
  const byStatus = {}
  let totalQty = 0
  let totalAmount = 0
  let count = 0
  let cancelledCount = 0
  let itemCount = 0

  rows.forEach((row) => {
    if (!row) return
    if (row.status === STATUS.CANCELLED) {
      cancelledCount += 1
      return
    }
    count += 1
    totalQty += Number(row.totalQty) || 0
    totalAmount += Number(row.totalAmount) || 0
    itemCount += Number(row.itemCount) || 0
    const key = row.storeId || '_unknown'
    if (!byStore[key]) {
      byStore[key] = {
        storeId: row.storeId || '',
        storeName: row.storeName || '未标注门店',
        count: 0,
        totalQty: 0,
        totalAmount: 0
      }
    }
    byStore[key].count += 1
    byStore[key].totalQty += Number(row.totalQty) || 0
    byStore[key].totalAmount += Number(row.totalAmount) || 0

    const cust = row.customerName || row.storeName || '未标注客户'
    if (!byCustomer[cust]) byCustomer[cust] = { customerName: cust, count: 0, totalAmount: 0, totalQty: 0 }
    byCustomer[cust].count += 1
    byCustomer[cust].totalAmount += Number(row.totalAmount) || 0
    byCustomer[cust].totalQty += Number(row.totalQty) || 0

    const cat = row.category || '未分类'
    if (!byCategory[cat]) byCategory[cat] = { category: cat, count: 0, totalAmount: 0 }
    byCategory[cat].count += 1
    byCategory[cat].totalAmount += Number(row.totalAmount) || 0

    const st = row.statusLabel || statusLabel(row.status) || '未知'
    if (!byStatus[st]) byStatus[st] = { status: row.status || '', statusLabel: st, count: 0 }
    byStatus[st].count += 1
  })

  return {
    count,
    cancelledCount,
    totalQty,
    totalAmount: roundMoney(totalAmount),
    itemCount,
    byStore: Object.keys(byStore).map((k) => byStore[k]),
    byCustomer: Object.keys(byCustomer).map((k) => byCustomer[k]),
    byCategory: Object.keys(byCategory).map((k) => byCategory[k]),
    byStatus: Object.keys(byStatus).map((k) => byStatus[k])
  }
}

/** 飞书 DateTime（毫秒/秒时间戳或 YYYY-MM-DD）→ YYYY-MM-DD（上海时区） */
function coerceFeishuDate(raw) {
  if (raw == null || raw === '') return ''
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d)
  }
  const s = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s)
    const ms = n > 1e12 ? n : n * 1000
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d)
  }
  const parsed = parseShipmentDateLine(/出货/.test(s) ? s : `${s}出货`)
  return parsed || ''
}

/** 飞书出货表扁平行 → 出货单（单明细） */
function feishuItemToPayload(item, defaultStoreId) {
  const src = item && typeof item === 'object' ? item : {}
  const storeHint =
    src.customerName ||
    src.storeName ||
    src.storeId ||
    src.客户名称 ||
    src.门店 ||
    src.entityName ||
    ''
  const storeId = guessStoreId(storeHint, defaultStoreId || 'store_shanhaizaowu')
  const qty = Number(src.qty != null ? src.qty : src.quantity != null ? src.quantity : src.数量)
  const itemName = String(
    src.itemName || src.skuName || src.品名 || src.物品名称 || src.物料 || ''
  ).trim()
  const dateRaw =
    src.shipmentDate != null
      ? src.shipmentDate
      : src.date != null
        ? src.date
        : src.出货日期 != null
          ? src.出货日期
          : src.日期
  let shipmentDate = coerceFeishuDate(dateRaw)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shipmentDate)) {
    shipmentDate = new Date().toISOString().slice(0, 10)
  }
  const unitPrice = roundMoney(src.unitPrice != null ? src.unitPrice : src.单价)
  const totalPrice = roundMoney(
    src.totalPrice != null ? src.totalPrice : src.总价 != null ? src.总价 : unitPrice * (qty || 0)
  )
  return {
    shipmentNo: String(src.shipmentNo || src.orderNo || src.出货编号 || '').trim(),
    storeId,
    customerName: String(storeHint || '').trim(),
    shipmentDate,
    category: normalizeCategory(src.category || src.分类),
    trackingNo: String(src.trackingNo || src.运单号 || '').trim(),
    expressCompany: String(src.expressCompany || src.快递公司 || '').trim(),
    items: itemName
      ? [
          {
            itemName,
            spec: String(src.spec || src.规格型号 || '').trim(),
            category: normalizeCategory(src.category || src.分类),
            qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
            unitPrice,
            totalPrice,
            feishuRecordId: String(src.feishuRecordId || src.recordId || '').trim()
          }
        ]
      : [],
    status: src.status || STATUS.SHIPPED,
    note: String(src.note || src.备注 || '').trim(),
    source: SOURCE.FEISHU,
    feishuRecordId: String(src.feishuRecordId || src.recordId || '').trim(),
    syncedAt: Date.now()
  }
}

function genBatchId() {
  return `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

module.exports = {
  COLLECTION,
  SYNC_META_COLLECTION,
  SYNC_META_ID,
  SYNC_LOG_COLLECTION,
  STORES,
  SOURCE,
  SOURCE_LABEL,
  STATUS,
  STATUS_LABEL,
  STATUS_FLOW,
  CATEGORY,
  CATEGORY_OPTIONS,
  storeById,
  guessStoreId,
  storeIdsForActor,
  normalizeStatus,
  normalizeCategory,
  statusLabel,
  normalizeSource,
  sourceLabel,
  canTransit,
  parseShipmentText,
  parseShipmentDateLine,
  parseItemLine,
  normalizePayload,
  mapRow,
  buildSummary,
  feishuItemToPayload,
  genShipmentNo,
  genBatchId,
  roundMoney
}
