/**
 * 采购管理常量与归一化
 * 集合 ops_purchases（SSOT；与订货履约 purchase_orders 分离）
 *
 * 字段 SSOT 对齐飞书「采购记录」tblMHhGXhpmGTiI5：
 *   采购编号 / 采购日期 / 物品名称 / 规格型号 / 分类 / 预算类型 /
 *   数量 / 单价 / 总价 / 供应商 / 采购平台 / 平台订单号 / 状态 /
 *   预计到货 / 快递公司 / 运单号 / 发票号 / 备注
 */

const COLLECTION = 'ops_purchases'
const SYNC_META_COLLECTION = 'configs'
const SYNC_META_ID = 'ops_purchase_sync'
const SYNC_LOG_COLLECTION = 'feishu_sync_logs'

const ENTITIES = [
  { id: 'store_shanhaizaowu', name: '山川造物', scope: 'store' },
  { id: 'store_xingchen', name: '星宸标本', scope: 'store' },
  { id: 'studio_specimen', name: '标本工作室', scope: 'studio' }
]

const SOURCE = {
  FEISHU: 'feishu',
  ERP: 'erp',
  MANUAL: 'manual'
}

const SOURCE_LABEL = {
  feishu: '飞书',
  erp: 'ERP',
  manual: '手工'
}

const STATUS = {
  DRAFT: 'draft',
  PENDING_PAY: 'pending_pay',
  PAID: 'paid',
  ORDERED: 'ordered',
  PENDING_SHIP: 'pending_ship',
  SHIPPED: 'shipped',
  RECEIVED: 'received',
  ARRIVED: 'arrived',
  STOCKED: 'stocked',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
}

const STATUS_LABEL = {
  draft: '草稿',
  pending_pay: '待付款',
  paid: '已付款',
  ordered: '已下单',
  pending_ship: '待发货',
  shipped: '已发货',
  received: '已签收',
  arrived: '已到货',
  stocked: '已入库',
  completed: '已完成',
  cancelled: '已取消'
}

const STATUS_FLOW = {
  draft: ['pending_pay', 'ordered', 'cancelled'],
  pending_pay: ['paid', 'ordered', 'cancelled'],
  paid: ['ordered', 'pending_ship', 'cancelled'],
  ordered: ['pending_ship', 'shipped', 'arrived', 'stocked', 'cancelled'],
  pending_ship: ['shipped', 'cancelled'],
  shipped: ['received', 'arrived', 'stocked', 'cancelled'],
  received: ['arrived', 'stocked', 'completed'],
  arrived: ['stocked', 'completed'],
  stocked: ['completed'],
  completed: [],
  cancelled: []
}

const CATEGORY_OPTIONS = ['工具', '标本']
const BUDGET_TYPE_OPTIONS = [
  '工具采购',
  '标本采购',
  '员工薪酬',
  '基础硬件',
  '标本原材料与耗材',
  '房租',
  '水电杂费',
  '宽带',
  '安全资金',
  '其他'
]
const PLATFORM_OPTIONS = ['1688', '淘宝', '京东', '拼多多']

function entityById(id) {
  const key = String(id || '').trim()
  return ENTITIES.find((e) => e.id === key) || null
}

function entitiesByScope(scope) {
  const s = String(scope || '').trim()
  if (s === 'store' || s === 'studio') {
    return ENTITIES.filter((e) => e.scope === s)
  }
  return ENTITIES.slice()
}

function normalizeStatus(raw) {
  const s = String(raw || '').trim()
  if (STATUS_LABEL[s]) return s
  if (/草稿|拟/.test(s)) return STATUS.DRAFT
  if (/待付款|未付/.test(s)) return STATUS.PENDING_PAY
  if (/已付款|已付/.test(s)) return STATUS.PAID
  if (/待发货/.test(s)) return STATUS.PENDING_SHIP
  if (/已发货|在途|发货|运输/.test(s)) return STATUS.SHIPPED
  if (/已签收|签收/.test(s)) return STATUS.RECEIVED
  if (/已到货|到货/.test(s)) return STATUS.ARRIVED
  if (/已入库|入库|收货/.test(s)) return STATUS.STOCKED
  if (/已完成|完成/.test(s)) return STATUS.COMPLETED
  if (/下单|已订|采购中/.test(s)) return STATUS.ORDERED
  if (/取消|作废/.test(s)) return STATUS.CANCELLED
  return STATUS.DRAFT
}

function normalizeCategory(raw) {
  const s = String(raw || '').trim()
  if (CATEGORY_OPTIONS.indexOf(s) !== -1) return s
  if (/工具|耗材|硬件/.test(s)) return '工具'
  if (/标本|成品|原料/.test(s)) return '标本'
  return ''
}

function normalizeBudgetType(raw) {
  const s = String(raw || '').trim()
  if (BUDGET_TYPE_OPTIONS.indexOf(s) !== -1) return s
  return s
}

function normalizePlatform(raw) {
  const s = String(raw || '').trim()
  if (PLATFORM_OPTIONS.indexOf(s) !== -1) return s
  return s
}

function normalizeSource(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (SOURCE_LABEL[s]) return s
  if (s === 'admin' || s === 'web') return SOURCE.ERP
  return SOURCE.MANUAL
}

function sourceLabel(s) {
  return SOURCE_LABEL[normalizeSource(s)] || '手工'
}

/** 按门店/主体文案猜测 entityId（飞书列「归属/门店」） */
function guessEntityId(raw, fallback) {
  const s = String(raw || '').trim()
  if (!s) return fallback || 'studio_specimen'
  const byId = entityById(s)
  if (byId) return byId.id
  if (/星宸/.test(s)) return 'store_xingchen'
  if (/山川|造物/.test(s)) return 'store_shanhaizaowu'
  if (/工作室|标本室|原料/.test(s)) return 'studio_specimen'
  return fallback || 'studio_specimen'
}

/** 店长 storeIds → 可看的 entityId 列表（含主店别名） */
function entityIdsForStoreIds(storeIds) {
  const ids = Array.isArray(storeIds) ? storeIds.map((x) => String(x || '').trim()).filter(Boolean) : []
  // 未绑定门店：店长默认可看全部门店采购（不含工作室）
  if (!ids.length) {
    return ENTITIES.filter((e) => e.scope === 'store').map((e) => e.id)
  }
  const MAIN = ['store_shanhaizaowu', 'store_1780146782017_6w0okpr']
  const out = {}
  ids.forEach((sid) => {
    if (entityById(sid)) out[sid] = true
    if (MAIN.indexOf(sid) !== -1) out.store_shanhaizaowu = true
    if (/星宸/.test(sid) || sid === 'store_xingchen') out.store_xingchen = true
    if (sid === 'studio_specimen' || /工作室/.test(sid)) out.studio_specimen = true
  })
  const keys = Object.keys(out)
  return keys.length ? keys : ['store_shanhaizaowu']
}

function statusLabel(s) {
  return STATUS_LABEL[normalizeStatus(s)] || s || ''
}

function canTransit(from, to) {
  const f = normalizeStatus(from)
  const t = normalizeStatus(to)
  if (f === t) return true
  const next = STATUS_FLOW[f] || []
  return next.indexOf(t) !== -1
}

function roundMoney(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 100) / 100
}

function genOrderNo(prefix) {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const rand = String(Math.floor(Math.random() * 9000) + 1000)
  return `${prefix || 'PO'}${y}${m}${day}${rand}`
}

function normalizePayload(input, existing) {
  const src = input && typeof input === 'object' ? input : {}
  const prev = existing && typeof existing === 'object' ? existing : {}
  const entity = entityById(src.entityId || prev.entityId) || entityById(prev.entityId)
  if (!entity) {
    return { ok: false, msg: '请选择归属主体（门店或工作室）' }
  }

  const itemName = String(src.itemName != null ? src.itemName : prev.itemName || '').trim()
  if (!itemName) return { ok: false, msg: '请填写品名/物料' }

  const qty = Number(src.qty != null ? src.qty : prev.qty)
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, msg: '数量须大于 0' }

  const unitPrice = roundMoney(src.unitPrice != null ? src.unitPrice : prev.unitPrice)
  if (unitPrice < 0) return { ok: false, msg: '单价不能为负' }

  const status = normalizeStatus(src.status != null ? src.status : prev.status)
  const purchaseDate = String(
    src.purchaseDate != null ? src.purchaseDate : prev.purchaseDate || ''
  ).trim()

  const existingNo = String(src.orderNo || prev.orderNo || '').trim()
  const source = normalizeSource(
    src.source != null ? src.source : prev.source != null ? prev.source : SOURCE.MANUAL
  )
  const row = {
    orderNo: existingNo || genOrderNo(entity.scope === 'studio' ? 'WS' : 'ST'),
    scope: entity.scope,
    entityId: entity.id,
    entityName: entity.name,
    itemName,
    spec: String(src.spec != null ? src.spec : prev.spec || '').trim(),
    category: normalizeCategory(
      src.category != null ? src.category : prev.category || ''
    ),
    budgetType: normalizeBudgetType(
      src.budgetType != null ? src.budgetType : prev.budgetType || ''
    ),
    platform: normalizePlatform(
      src.platform != null ? src.platform : prev.platform || ''
    ),
    platformOrderNo: String(
      src.platformOrderNo != null ? src.platformOrderNo : prev.platformOrderNo || ''
    ).trim(),
    qty,
    unit: String(src.unit != null ? src.unit : prev.unit || '件').trim() || '件',
    unitPrice,
    /**
     * 金额：**显式传入的 `amount` 优先**，否则按 数量×单价 算。
     *
     * 为什么需要显式（2026-09-19）：飞书采购表里有**退款冲正**行（`总价` 为负，如 −30），
     * 而本模型对 `qty>0` / `unitPrice>=0` 有硬校验 —— 冲正行没有任何合法方式表达，
     * 于是同步进来变成 0，**仪表盘的「已使用预算」正好高 30**（与飞书对不上）。
     * 现在冲正行以 `amount`（可为负）表达，数量/单价仍需合法；仪表盘 `purchaseAmount`
     * 本来就优先取 `amount`，因此数字能对上。
     */
    amount: src.amount !== null && src.amount !== undefined && src.amount !== ''
      ? roundMoney(src.amount)
      : roundMoney(qty * unitPrice),
    supplier: String(src.supplier != null ? src.supplier : prev.supplier || '').trim(),
    purchaseDate: purchaseDate || new Date().toISOString().slice(0, 10),
    expectedArrival: String(
      src.expectedArrival != null ? src.expectedArrival : prev.expectedArrival || ''
    )
      .trim()
      .slice(0, 10),
    expressCompany: String(
      src.expressCompany != null ? src.expressCompany : prev.expressCompany || ''
    ).trim(),
    trackingNo: String(
      src.trackingNo != null ? src.trackingNo : prev.trackingNo || ''
    ).trim(),
    invoiceNo: String(
      src.invoiceNo != null ? src.invoiceNo : prev.invoiceNo || ''
    ).trim(),
    status,
    statusLabel: statusLabel(status),
    note: String(src.note != null ? src.note : prev.note || '').trim(),
    source,
    sourceLabel: sourceLabel(source),
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
  return {
    _id: doc._id,
    orderNo: doc.orderNo || '',
    scope: doc.scope || '',
    entityId: doc.entityId || '',
    entityName: doc.entityName || '',
    itemName: doc.itemName || '',
    spec: doc.spec || '',
    category: doc.category || '',
    budgetType: doc.budgetType || '',
    platform: doc.platform || '',
    platformOrderNo: doc.platformOrderNo || '',
    qty: Number(doc.qty) || 0,
    unit: doc.unit || '件',
    unitPrice: roundMoney(doc.unitPrice),
    amount: roundMoney(doc.amount != null ? doc.amount : (Number(doc.qty) || 0) * (Number(doc.unitPrice) || 0)),
    supplier: doc.supplier || '',
    purchaseDate: doc.purchaseDate || '',
    expectedArrival: doc.expectedArrival || '',
    expressCompany: doc.expressCompany || '',
    trackingNo: doc.trackingNo || '',
    invoiceNo: doc.invoiceNo || '',
    status,
    statusLabel: statusLabel(status),
    note: doc.note || '',
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

/** 列表汇总：本周期采购额 + 按主体/预算类型/分类小计（不含已取消） */
function buildSummary(list) {
  const rows = Array.isArray(list) ? list : []
  const byEntityMap = {}
  const byBudgetType = {}
  const byCategory = {}
  const byStatus = {}
  let totalAmount = 0
  let count = 0
  let cancelledCount = 0

  rows.forEach((row) => {
    if (!row) return
    if (row.status === STATUS.CANCELLED) {
      cancelledCount += 1
      return
    }
    const amount = roundMoney(row.amount)
    totalAmount = roundMoney(totalAmount + amount)
    count += 1
    const key = row.entityId || '_unknown'
    if (!byEntityMap[key]) {
      byEntityMap[key] = {
        entityId: row.entityId || '',
        entityName: row.entityName || '未标注主体',
        amount: 0,
        count: 0
      }
    }
    byEntityMap[key].amount = roundMoney(byEntityMap[key].amount + amount)
    byEntityMap[key].count += 1

    const bt = row.budgetType || '未标注'
    if (!byBudgetType[bt]) byBudgetType[bt] = { budgetType: bt, amount: 0, count: 0 }
    byBudgetType[bt].amount = roundMoney(byBudgetType[bt].amount + amount)
    byBudgetType[bt].count += 1

    const cat = row.category || '未分类'
    if (!byCategory[cat]) byCategory[cat] = { category: cat, amount: 0, count: 0 }
    byCategory[cat].amount = roundMoney(byCategory[cat].amount + amount)
    byCategory[cat].count += 1

    const st = row.statusLabel || statusLabel(row.status) || '未知'
    if (!byStatus[st]) byStatus[st] = { status: row.status || '', statusLabel: st, count: 0 }
    byStatus[st].count += 1
  })

  return {
    totalAmount,
    count,
    cancelledCount,
    byEntity: Object.keys(byEntityMap).map((k) => byEntityMap[k]),
    byBudgetType: Object.keys(byBudgetType).map((k) => byBudgetType[k]),
    byCategory: Object.keys(byCategory).map((k) => byCategory[k]),
    byStatus: Object.keys(byStatus).map((k) => byStatus[k])
  }
}

/** 飞书拉取行 → normalizePayload 输入 */
function feishuItemToPayload(item, defaultEntityId) {
  const src = item && typeof item === 'object' ? item : {}
  const entityHint = src.entityName || src.entityId || src.storeName || src.归属 || ''
  const entityId = guessEntityId(entityHint, defaultEntityId || 'studio_specimen')
  const unitPrice = Number(src.unitPrice != null ? src.unitPrice : src.单价 != null ? src.单价 : src.price)
  const qty = Number(src.qty != null ? src.qty : src.quantity != null ? src.quantity : src.数量)
  return {
    orderNo: String(src.orderNo || src.采购编号 || '').trim(),
    entityId,
    itemName: String(src.itemName || src.skuName || src.物品名称 || src.物料 || '').trim(),
    spec: String(src.spec || src.规格型号 || '').trim(),
    category: normalizeCategory(src.category || src.分类),
    budgetType: normalizeBudgetType(src.budgetType || src.预算类型),
    platform: normalizePlatform(src.platform || src.采购平台),
    platformOrderNo: String(src.platformOrderNo || src.平台订单号 || '').trim(),
    qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
    unit: String(src.unit || '件').trim() || '件',
    unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0,
    supplier: String(src.supplier || src.供应商 || '').trim(),
    purchaseDate: String(src.purchaseDate || src.date || src.采购日期 || '').trim().slice(0, 10),
    expectedArrival: String(src.expectedArrival || src.预计到货 || '').trim().slice(0, 10),
    expressCompany: String(src.expressCompany || src.快递公司 || '').trim(),
    trackingNo: String(src.trackingNo || src.运单号 || '').trim(),
    invoiceNo: String(src.invoiceNo || src.发票号 || '').trim(),
    status: src.status || src.状态 || STATUS.ORDERED,
    // 飞书「总价」→ 我们的 amount：冲正行为负，必须带过来（见 normalizePayload 的说明）
    amount: (() => {
      const raw = src.amount != null ? src.amount : src.总价 != null ? src.总价 : null
      if (raw === null || raw === '') return undefined
      const n = Number(raw)
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined
    })(),
    note: String(src.note || src.备注 || '').trim(),
    source: SOURCE.FEISHU,
    feishuRecordId: String(src.feishuRecordId || src.recordId || '').trim(),
    syncedAt: Date.now()
  }
}

module.exports = {
  COLLECTION,
  SYNC_META_COLLECTION,
  SYNC_META_ID,
  SYNC_LOG_COLLECTION,
  ENTITIES,
  SOURCE,
  SOURCE_LABEL,
  STATUS,
  STATUS_LABEL,
  STATUS_FLOW,
  entityById,
  entitiesByScope,
  entityIdsForStoreIds,
  guessEntityId,
  normalizeStatus,
  statusLabel,
  normalizeSource,
  sourceLabel,
  canTransit,
  normalizePayload,
  mapRow,
  buildSummary,
  feishuItemToPayload,
  genOrderNo,
  roundMoney
}
