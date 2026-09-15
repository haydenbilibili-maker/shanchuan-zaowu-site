/**
 * 原材料库存 — 集合与字段约定
 *
 * 命名对照：
 *   - 本集合 studio_raw_inventory = 原材料库存（多平台进货）
 *   - 飞书多维表「库存管理」tblekBh0CRPMa7ie 为本集合飞书 SSOT
 *   - 小程序「成品库存」studio_inventory 对应飞书「成品库存」，勿混入本集合
 *
 * 字段 SSOT：
 *   库存编号 / 物品名称 / 规格型号 / 分类(工具|标本) / 当前库存 /
 *   最低库存预警 / 单价 / 库存价值 / 累计入库 / 累计出库 / 存放位置 / 备注
 */

const COLLECTION = 'studio_raw_inventory'
const CATEGORY_OPTIONS = ['工具', '标本']

const ROLE_LABEL = '原材料库存'
const ROLE_HINT = '多平台进货的原材料台账；对应飞书「库存管理」，非成品'
const FEISHU_TABLE_NAME = '库存管理'
const FEISHU_TABLE_ID = 'tblekBh0CRPMa7ie'

function roundMoney(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 100) / 100
}

function normalizeCategory(raw) {
  const s = String(raw || '').trim()
  if (CATEGORY_OPTIONS.indexOf(s) !== -1) return s
  if (/工具|耗材|硬件/.test(s)) return '工具'
  if (/标本|原料/.test(s)) return '标本'
  return ''
}

function buildRow(input, existing) {
  const src = input && typeof input === 'object' ? input : {}
  const prev = existing && typeof existing === 'object' ? existing : {}
  const itemName = String(src.itemName != null ? src.itemName : prev.itemName || '').trim()
  if (!itemName) return { ok: false, msg: '请填写物品名称' }
  const qty = Number(src.qty != null ? src.qty : src.currentQty != null ? src.currentQty : prev.qty)
  if (!Number.isFinite(qty) || qty < 0) return { ok: false, msg: '当前库存须为非负数字' }
  const unitPrice = roundMoney(src.unitPrice != null ? src.unitPrice : prev.unitPrice)
  const category = normalizeCategory(src.category != null ? src.category : prev.category)
  const row = {
    inventoryNo: String(src.inventoryNo != null ? src.inventoryNo : prev.inventoryNo || '').trim(),
    itemName,
    spec: String(src.spec != null ? src.spec : prev.spec || '').trim(),
    category,
    qty,
    currentQty: qty,
    minQty: Math.max(0, parseInt(src.minQty != null ? src.minQty : prev.minQty, 10) || 0),
    unitPrice,
    stockValue: roundMoney(qty * unitPrice),
    inboundTotal: Math.max(
      0,
      parseInt(src.inboundTotal != null ? src.inboundTotal : prev.inboundTotal, 10) || 0
    ),
    outboundTotal: Math.max(
      0,
      parseInt(src.outboundTotal != null ? src.outboundTotal : prev.outboundTotal, 10) || 0
    ),
    locationText: String(src.locationText != null ? src.locationText : prev.locationText || '').trim(),
    note: String(src.note != null ? src.note : prev.note || '').trim(),
    inventoryRole: 'raw',
    feishuRecordId: String(
      src.feishuRecordId != null ? src.feishuRecordId : prev.feishuRecordId || ''
    ).trim(),
    deleted: false
  }
  return { ok: true, row }
}

function mapRow(doc) {
  if (!doc) return null
  const qty = Number(doc.qty != null ? doc.qty : doc.currentQty) || 0
  const unitPrice = roundMoney(doc.unitPrice)
  return {
    _id: doc._id,
    inventoryNo: doc.inventoryNo || '',
    itemName: doc.itemName || '',
    spec: doc.spec || '',
    category: normalizeCategory(doc.category) || '',
    qty,
    currentQty: qty,
    minQty: Number(doc.minQty) || 0,
    unitPrice,
    stockValue: roundMoney(doc.stockValue != null ? doc.stockValue : qty * unitPrice),
    inboundTotal: Number(doc.inboundTotal) || 0,
    outboundTotal: Number(doc.outboundTotal) || 0,
    locationText: doc.locationText || '',
    note: doc.note || '',
    inventoryRole: 'raw',
    feishuRecordId: doc.feishuRecordId || '',
    lowStock: qty > 0 && Number(doc.minQty) > 0 && qty <= Number(doc.minQty),
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null
  }
}

function feishuItemToPayload(item) {
  const src = item && typeof item === 'object' ? item : {}
  const qty = Number(
    src.qty != null
      ? src.qty
      : src.currentQty != null
        ? src.currentQty
        : src.当前库存 != null
          ? src.当前库存
          : 0
  )
  return {
    inventoryNo: String(src.inventoryNo || src.skuId || src.库存编号 || '').trim(),
    itemName: String(src.itemName || src.skuName || src.物品名称 || src.品名 || '').trim(),
    spec: String(src.spec || src.规格型号 || '').trim(),
    category: normalizeCategory(src.category || src.分类),
    qty: Number.isFinite(qty) && qty >= 0 ? qty : 0,
    minQty: Math.max(0, parseInt(src.minQty != null ? src.minQty : src.最低库存预警, 10) || 0),
    unitPrice: roundMoney(src.unitPrice != null ? src.unitPrice : src.单价),
    inboundTotal: Math.max(0, parseInt(src.inboundTotal != null ? src.inboundTotal : src.累计入库, 10) || 0),
    outboundTotal: Math.max(
      0,
      parseInt(src.outboundTotal != null ? src.outboundTotal : src.累计出库, 10) || 0
    ),
    locationText: String(src.locationText || src.存放位置 || '').trim(),
    note: String(src.note || src.备注 || '').trim(),
    feishuRecordId: String(src.feishuRecordId || src.recordId || '').trim()
  }
}

function buildSummary(list) {
  const rows = Array.isArray(list) ? list : []
  let totalQty = 0
  let stockValue = 0
  let lowStockCount = 0
  const byCategory = {}
  rows.forEach((r) => {
    if (!r || r.deleted) return
    totalQty += Number(r.qty) || 0
    stockValue += Number(r.stockValue) || 0
    if (r.lowStock) lowStockCount += 1
    const cat = r.category || '未分类'
    if (!byCategory[cat]) byCategory[cat] = { category: cat, count: 0, qty: 0, stockValue: 0 }
    byCategory[cat].count += 1
    byCategory[cat].qty += Number(r.qty) || 0
    byCategory[cat].stockValue = roundMoney(byCategory[cat].stockValue + (Number(r.stockValue) || 0))
  })
  return {
    count: rows.length,
    totalQty,
    stockValue: roundMoney(stockValue),
    lowStockCount,
    byCategory: Object.keys(byCategory).map((k) => byCategory[k])
  }
}

module.exports = {
  COLLECTION,
  CATEGORY_OPTIONS,
  ROLE_LABEL,
  ROLE_HINT,
  FEISHU_TABLE_NAME,
  FEISHU_TABLE_ID,
  buildRow,
  mapRow,
  feishuItemToPayload,
  buildSummary,
  normalizeCategory,
  roundMoney
}
