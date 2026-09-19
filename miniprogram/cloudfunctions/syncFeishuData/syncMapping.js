/**
 * 飞书同步的**映射与行转换**（纯函数，不联网、不写库）—— 所以它是可测的。
 *
 * 为什么要抽成纯函数：这套映射原先**只存在于 ERP 前端**（`admin/src/utils/feishuSync.js`），
 * 服务端同步要复用它。若服务端再手写一份映射，两边迟早给出不同的行 —— 那是静默不一致。
 * 因此这里的默认表定义与字段映射**逐字对齐** ERP 的 `defaultFeishuConfig()`，
 * 并由守卫 `test:feishu-sync` 钉住关键字段（改了必须两边一起改，或有意识地只改一侧）。
 *
 * 映射方向：`fields` = `{ 我们的字段名: 飞书列名 }`（与 ERP 同向）。
 */

/** 与 ERP `defaultFeishuConfig().tables` 一致（飞书表 id 见 admin/docs/飞书多维表对接_技术蓝图.md） */
const DEFAULT_TABLES = {
  purchase: {
    tableId: 'tblMHhGXhpmGTiI5',
    fields: {
      orderNo: '采购编号',
      skuName: '物品名称',
      qty: '数量',
      unitPrice: '单价',
      supplier: '供应商',
      status: '状态',
      date: '采购日期',
      entityName: '归属',
      spec: '规格型号',
      category: '分类',
      budgetType: '预算类型',
      platform: '采购平台',
      platformOrderNo: '平台订单号',
      expectedArrival: '预计到货',
      expressCompany: '快递公司',
      trackingNo: '运单号',
      invoiceNo: '发票号',
      note: '备注'
    }
  },
  inventory: {
    tableId: 'tblh9wqtrQmZgRO5',
    fields: {
      skuName: '物品名称',
      itemName: '物品名称',
      framingSpec: '规格型号',
      qty: '当前库存',
      date: '日期',
      note: '备注'
    }
  },
  rawInventory: {
    tableId: 'tblekBh0CRPMa7ie',
    fields: {
      inventoryNo: '库存编号',
      skuName: '物品名称',
      itemName: '物品名称',
      spec: '规格型号',
      category: '分类',
      qty: '当前库存',
      minQty: '最低库存预警',
      unitPrice: '单价',
      inboundTotal: '累计入库',
      outboundTotal: '累计出库',
      locationText: '存放位置',
      note: '备注'
    }
  }
}

/** 这些字段按数字解析（其余按文本/日期）——与 ERP `mapRecord` 同一张名单 */
const NUMBER_KEYS = ['qty', 'unitPrice', 'minQty', 'inboundTotal', 'outboundTotal']
const DATE_KEYS = ['date', 'expectedArrival', 'inventoryDate', 'shipmentDate']

/** 飞书单元格 → 文本。多维表的值可能是字符串/数组/对象（人员、关联、公式） */
function cellText (v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x === null || x === undefined) return ''
        if (typeof x === 'string') return x
        // 富文本 / 人员 / 关联：常见形状是 { text } 或 { name } 或 { text_arr }
        if (typeof x === 'object') return x.text || x.name || (Array.isArray(x.text_arr) ? x.text_arr.join('') : '')
        return String(x)
      })
      .filter(Boolean)
      .join('')
      .trim()
  }
  if (typeof v === 'object') {
    return String(v.text || v.name || v.value || '').trim()
  }
  return String(v).trim()
}

/** 飞书单元格 → 数字（非法/空一律 0；不返回 null，否则下游会把 undefined 写进库） */
function cellNumber (v) {
  const t = cellText(v).replace(/[¥￥,\s]/g, '')
  if (!t) return 0
  const n = Number(t)
  return Number.isFinite(n) ? n : 0
}

/** 飞书日期单元格（毫秒时间戳或 `YYYY-MM-DD` 文本）→ `YYYY-MM-DD` */
function cellDate (v) {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number' || /^\d{10,}$/.test(String(v))) {
    const ms = Number(v)
    if (!Number.isFinite(ms) || ms <= 0) return ''
    const d = new Date(ms < 1e12 ? ms * 1000 : ms)
    if (Number.isNaN(d.getTime())) return ''
    return d.toISOString().slice(0, 10)
  }
  const t = cellText(v)
  const m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  return t
}

/**
 * 按列名取字段值。飞书列名可能有前后空格，故先精确再宽松匹配
 * （宽松匹配只在**唯一命中**时采用，避免"单价"被"单价（元）"这类列抢走）。
 */
function pickField (fields, colName) {
  const f = fields || {}
  const want = String(colName || '').trim()
  if (!want) return undefined
  if (Object.prototype.hasOwnProperty.call(f, want)) return f[want]
  const keys = Object.keys(f)
  const loose = keys.filter((k) => k.trim() === want)
  if (loose.length === 1) return f[loose[0]]
  return undefined
}

/** 飞书记录 → `{ 我们的字段: 值 }`（键名与 ERP `mapRecord` 一致） */
function mapRecord (rec, fieldMap) {
  const f = (rec && rec.fields) || {}
  const out = {}
  for (const key of Object.keys(fieldMap || {})) {
    const v = pickField(f, fieldMap[key])
    out[key] = NUMBER_KEYS.includes(key) ? cellNumber(v) : DATE_KEYS.includes(key) ? cellDate(v) : cellText(v)
  }
  return out
}

/** 合并「配置里的字段映射」与内置默认：配置优先，缺的用默认补（ERP 行为一致） */
function resolveFieldMap (role, configFields) {
  const base = (DEFAULT_TABLES[role] && DEFAULT_TABLES[role].fields) || {}
  const cfg = configFields || {}
  return Object.assign({}, base, cfg)
}

function resolveTableId (role, configTableId) {
  const t = String(configTableId || '').trim()
  if (t) return t
  return (DEFAULT_TABLES[role] && DEFAULT_TABLES[role].tableId) || ''
}

/** 飞书记录 → `manageStudioRawInventory.upsertFromFeishu` 的 items（与 ERP 载荷逐字对齐） */
function toRawInventoryItems (records, fieldMap) {
  return (records || []).map((rec) => {
    const m = mapRecord(rec, fieldMap)
    return {
      feishuRecordId: rec.record_id || rec.recordId || '',
      inventoryNo: m.inventoryNo || m.skuId || '',
      itemName: m.itemName || m.skuName || '',
      skuName: m.skuName || m.itemName || '',
      spec: m.spec || '',
      category: m.category || '',
      qty: m.qty,
      minQty: m.minQty,
      unitPrice: m.unitPrice,
      inboundTotal: m.inboundTotal,
      outboundTotal: m.outboundTotal,
      locationText: m.locationText || '',
      note: m.note || ''
    }
  })
}

/** 飞书记录 → `manageStudioInventory.upsertFromFeishu` 的 items */
function toInventoryItems (records, fieldMap) {
  return (records || []).map((rec) => {
    const m = mapRecord(rec, fieldMap)
    return {
      feishuRecordId: rec.record_id || rec.recordId || '',
      itemName: m.itemName || m.skuName || '',
      skuName: m.skuName || m.itemName || '',
      framingSpec: m.framingSpec || '',
      qty: m.qty,
      date: m.date || '',
      note: m.note || ''
    }
  })
}

/** 飞书记录 → `managePurchaseOrder.upsertFromFeishu` 的 items（与 ERP `toOpsPurchaseItem` 对齐） */
function toPurchaseItems (records, fieldMap) {
  return (records || []).map((rec) => {
    const m = mapRecord(rec, fieldMap)
    const rid = rec.record_id || rec.recordId || ''
    return {
      feishuRecordId: rid,
      recordId: rid,
      orderNo: m.orderNo || '',
      itemName: m.skuName || m.itemName || '',
      skuName: m.skuName || '',
      qty: m.qty,
      unit: m.unit || '件',
      unitPrice: m.unitPrice || 0,
      supplier: m.supplier || '',
      status: m.status || '',
      date: m.date || '',
      purchaseDate: m.date || '',
      entityName: m.entityName || m.storeName || '',
      spec: m.spec || '',
      category: m.category || '',
      budgetType: m.budgetType || '',
      platform: m.platform || '',
      platformOrderNo: m.platformOrderNo || '',
      expectedArrival: m.expectedArrival || '',
      expressCompany: m.expressCompany || '',
      trackingNo: m.trackingNo || '',
      invoiceNo: m.invoiceNo || '',
      note: m.note || ''
    }
  })
}

/** 同步目标 → 写入口（云函数名 + items 构造器）。**加目标只改这一张表。** */
const TARGETS = {
  rawInventory: { label: '原材料库存', fn: 'manageStudioRawInventory', build: toRawInventoryItems, note: '飞书「库存管理」' },
  inventory: { label: '成品库存', fn: 'manageStudioInventory', build: toInventoryItems, note: '飞书「成品库存」' },
  purchase: { label: '采购记录', fn: 'managePurchaseOrder', build: toPurchaseItems, note: '飞书「采购记录」', extra: { defaultEntityId: 'studio_specimen' } }
}

module.exports = {
  DEFAULT_TABLES,
  NUMBER_KEYS,
  DATE_KEYS,
  TARGETS,
  cellText,
  cellNumber,
  cellDate,
  pickField,
  mapRecord,
  resolveFieldMap,
  resolveTableId,
  toRawInventoryItems,
  toInventoryItems,
  toPurchaseItems
}
