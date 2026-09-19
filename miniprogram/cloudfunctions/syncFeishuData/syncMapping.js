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
      note: '备注',
      // ⚠️ 必须映射「总价」→ amount：退款冲正行的总价为负，
      //    只靠 数量×单价 表达不了（数量/单价有硬校验），本地会算成 0 → 仪表盘与飞书差 30
      amount: '总价'
    }
  },
  inventory: {
    // ⚠️ 2026-09-19 实地核对飞书表后修正列名：成品库存表的真实列是
    //    `物品名称 / 规格装裱 / 数量 / 盘点日期 / 备注`（原默认写的 `规格型号 / 当前库存 / 日期` 是**错的**，
    //    按错的列名同步会整列取空 —— 不报错，只是同步出一堆空字段）
    tableId: 'tblh9wqtrQmZgRO5',
    fields: {
      skuName: '物品名称',
      itemName: '物品名称',
      framingSpec: '规格装裱',
      qty: '数量',
      date: '盘点日期',
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
    const out = {
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
    /**
     * `amount` 只在**飞书确实配了「总价」列**时才带出去。
     * 理由：`0` 与「这一列没有值」含义不同 —— 若列没配，带 0 会把
     * 「数量×单价」的正确金额覆盖成 0（把好数据改坏）。
     */
    if ((fieldMap || {}).amount) out.amount = m.amount
    return out
  })
}

/**
 * 把字段映射**裁到表里真实存在的列**，并报告被丢弃的映射项。
 *
 * 为什么必须裁：映射里写了一个**表里不存在的列**时，飞书读取会取到空值，
 * 然后这个空值会被 upsert 写进库 —— **把原有的好数据覆盖成空**。
 * 这不是"同步得少一点"，是**破坏数据**。（实测：采购映射里的 `归属`/`单位` 两列在采购表里不存在，
 * 若不裁就同步，370 条采购的「归属」会被清空。）
 *
 * ⚠️ 但"裁"必须在**表本身选对**的前提下才有意义 —— 见 `assessMapping`：
 * 表选错时会有大片列不存在，那时的正确动作是**拒绝同步**而不是裁完再写。
 */
function filterMappingToColumns (fieldMap, tableColumns) {
  const cols = new Set((tableColumns || []).map((c) => String(c || '').trim()))
  const kept = {}
  const dropped = []
  for (const key of Object.keys(fieldMap || {})) {
    const col = String(fieldMap[key] || '').trim()
    if (col && cols.has(col)) kept[key] = fieldMap[key]
    else dropped.push({ key, column: col })
  }
  return { kept, dropped }
}

/**
 * 判断「映射与表」是否匹配到可以安全同步。
 * 表选错（指向了另一张表）时会有大片列不存在 —— 此时若只裁不拒，
 * 同步会把**另一张表的行**写进这张台账（实测：成品库存的映射指向了「库存管理」，
 * 照它同步就会把 205 条**原材料**写进成品库存）。
 * 规则：不存在的列 ≥ 2 且占比 ≥ 一半 → 判为"映射与表不匹配"，**拒绝同步**。
 */
function assessMapping (fieldMap, tableColumns, signature) {
  const { kept, dropped } = filterMappingToColumns(fieldMap, tableColumns)
  const total = Object.keys(fieldMap || {}).length
  const missRatio = total ? dropped.length / total : 0
  /**
   * 判据两条，任一命中即"表选错了"：
   *   ① **签名列**没全在（最硬的一条 —— 列名是这张表的身份）；
   *   ② 缺列比例过高（≥ 一半且 ≥2）—— 兜住没有签名列的目标。
   * 只留 ② 会漏：50% 的边界实测刚好漏过一次（见 TARGETS 注释）。
   */
  const cols = new Set((tableColumns || []).map((c) => String(c || '').trim()))
  const missingSignature = (signature || []).filter((c) => !cols.has(String(c).trim()))
  const mismatch = missingSignature.length > 0 || (dropped.length >= 2 && missRatio >= 0.5)
  return { kept, dropped, mismatch, missRatio, total, missingSignature }
}

/**
 * 同步目标 → 写入口（云函数名 + items 构造器 + **签名列**）。**加目标只改这一张表。**
 *
 * `signature` = 「这些列存在，才证明这张表就是我要的那张」。比"缺列比例"可靠得多：
 *   2026-09-19 真实事故 —— 成品库存映射指向了「库存管理」表，6 列里缺 3 列（50%），
 *   当时的比例阈值（≥50% 且 ≥2）**刚好没拦住**，于是把 205 条**原材料**灌进了成品库存。
 *   换成"签名列必须全在"就不会有这种边界问题。
 *
 * ⚠️ **`inventory` 已从同步目标里移除** —— 产品负责人 2026-09-19 明确：
 *    「成品库的库存以小程序-超管工作台-工作室-库存管理的数据为准」，
 *    即成品库存的真源是**小程序里人工盘点的数据**，**不由飞书同步**。
 *    代码与映射保留（`DEFAULT_TABLES.inventory` 等）只是为了万一将来要恢复时不必重写，
 *    但 `TARGETS` 里没有它 ⇒ `pull` 不会碰成品库存。
 */
/**
 * 采购金额口径 —— **必须与仪表盘逐字一致**：
 *   仪表盘 `getStudioDashboard/index.js` 的 `purchaseAmount(row)`：
 *     `row.amount != null ? row.amount : qty × unitPrice`
 * 若这里换一种算法（比如一律 qty×单价），对账就会报出"假差异"，
 * 把人引去查一个根本不存在的问题。所以两边共用同一口径，且守卫钉住它。
 */
function purchaseAmountOf (row) {
  const r = row || {}
  if (r.amount !== null && r.amount !== undefined && r.amount !== '') {
    return Math.round(Number(r.amount) * 100) / 100
  }
  return Math.round(((Number(r.qty) || 0) * (Number(r.unitPrice) || 0)) * 100) / 100
}

/** 与仪表盘 `isActivePurchase` 同口径：未删且非 cancelled */
function isActivePurchaseOf (row) {
  if (!row || row.deleted === true) return false
  return String(row.status || '') !== 'cancelled'
}

/**
 * **预算池配置**（飞书表 `tbl37YaUl1XQSYjM`）→ `configs/studio_budget_pools`。
 *
 * 为什么单独一条路（不进 `TARGETS`）：`TARGETS` 都是「写集合」的 upsertFromFeishu，
 * 而预算池是一个**配置文档**。
 *
 * 为什么要同步它：产品负责人 2026-09-19 定「**剩余总预算以飞书为准**」——
 * 小程序原先**自己重算** `剩余 = 年度 − 已使用`，与飞书口径不同
 * （飞书还扣了已一次性缴纳的房租 54,200 与宽带已付 948），于是永远差 ¥55,148。
 * 现在把飞书**算好的** `已使用金额`/`剩余金额` 一并取回，仪表盘直接采用 ⇒ 同源同数。
 */
const BUDGET_POOL_TABLE = 'tbl37YaUl1XQSYjM'

const BUDGET_POOL_FIELDS = {
  name: '池名称',
  category: '池分类',
  annualAmount: '年度预算金额',
  monthlyAmount: '月度预算金额',
  usedAmount: '已使用金额',
  remainingAmount: '剩余金额',
  usagePct: '使用率',
  warnThreshold: '预警阈值',
  purchaseTotal: '采购汇总',
  revenueTotal: '营收汇总',
  note: '备注'
}

/** 金额/阈值一律转成数字（`mapRecord` 只对固定的数量/单价键做数字转换，配置类字段会留成文本） */
function numOf (v) {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(String(v).replace(/[¥￥,\s%]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function toBudgetPools (records) {
  return (records || [])
    .map((rec) => {
      const m = mapRecord(rec, BUDGET_POOL_FIELDS)
      if (!m.category && !m.name) return null
      return {
        name: m.name || m.category,
        category: m.category || m.name,
        annualAmount: numOf(m.annualAmount),
        monthlyAmount: numOf(m.monthlyAmount),
        // 飞书**自己算好的**数（仪表盘以它为准）
        feishuUsedAmount: numOf(m.usedAmount),
        feishuRemainingAmount: numOf(m.remainingAmount),
        feishuUsagePct: numOf(m.usagePct),
        warnThreshold: numOf(m.warnThreshold),
        note: m.note || ''
      }
    })
    .filter(Boolean)
}

const TARGETS = {
  rawInventory: {
    label: '原材料库存',
    fn: 'manageStudioRawInventory',
    build: toRawInventoryItems,
    note: '飞书「库存管理」',
    signature: ['物品名称', '当前库存']
  },
  purchase: {
    label: '采购记录',
    fn: 'managePurchaseOrder',
    build: toPurchaseItems,
    note: '飞书「采购记录」',
    signature: ['物品名称', '采购编号'],
    extra: { defaultEntityId: 'studio_specimen' }
  }
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
  filterMappingToColumns,
  assessMapping,
  resolveFieldMap,
  resolveTableId,
  BUDGET_POOL_TABLE,
  BUDGET_POOL_FIELDS,
  toBudgetPools,
  purchaseAmountOf,
  isActivePurchaseOf,
  toRawInventoryItems,
  toInventoryItems,
  toPurchaseItems
}
