/**
 * 工作室结算 —— 常量、归一化与行映射
 * SSOT：admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md §4（v1.2）
 *
 * 本文件只管「数据形状」，不含 db 调用（照抄 manageStudioRawInventory/rawDefaults.js 的分层）。
 *
 * 两个价目本（book）用 kind 区分，字段差异只有「等级 vs 尺寸」一组：
 *   材料：{ name, grade, isDefaultGrade }   包装：{ name, size, isDefaultSize }
 * 归一化与完整性校验**复用共享内核** `pricingCore.js`（与算价方逐字节同源），
 * 避免「写入方把两个名字当同一个、算价方当成两个」这类静默错价。
 */
const {
  normalizeName,
  normalizeQtyPerUnit,
  validatePriceBook,
  DEFAULT_GRADE,
  DEFAULT_SIZE,
  normGrade,
  normSize,
  toCents,
  toYuan
} = require('./pricingCore')

const MATERIAL_COLLECTION = 'studio_material_prices'
const PACKAGING_COLLECTION = 'studio_packaging_prices'

/** 手工费率等全局单值放既有 configs 集合（蓝图 §4.3） */
const CONFIG_COLLECTION = 'configs'
const CONFIG_ID = 'studio_settlement'

const KIND = {
  MATERIAL: 'material',
  PACKAGING: 'packaging'
}

const KIND_OPTIONS = [KIND.MATERIAL, KIND.PACKAGING]

/** 两个价目本的差异全部收敛在这里 —— 加第三个本只需再加一条 */
const BOOKS = {
  material: {
    kind: 'material',
    collection: MATERIAL_COLLECTION,
    label: '原材料',
    optionField: 'grade',
    optionLabel: '等级',
    defaultFlagKey: 'isDefaultGrade',
    defaultOption: DEFAULT_GRADE,
    keywordHint: '材料名 / 别名（如 大蓝闪 → 大蓝闪蝶）'
  },
  packaging: {
    kind: 'packaging',
    collection: PACKAGING_COLLECTION,
    label: '包装方式',
    optionField: 'size',
    optionLabel: '尺寸',
    defaultFlagKey: 'isDefaultSize',
    defaultOption: DEFAULT_SIZE,
    keywordHint: '包装名 / 别名（如 相框 → 框）'
  }
}

const STATUS = { ACTIVE: 'active', INACTIVE: 'inactive' }
const CATEGORY_OPTIONS = ['工具', '标本']

/**
 * 全局结算配置默认值。
 *
 * ⚠️ `enabled` **默认关**：与 `showXxx` 一系列同先例（缺字段默认关，由超管显式开启）。
 * 理由：算价会影响门店要付多少钱，不能在数据未维护好时自己开始算钱。
 */
const DEFAULT_CONFIG = {
  enabled: false,
  laborRatePct: 30,
  requirePackaging: true,
  rounding: 'cent'
}

const LABOR_RATE_MIN = 0
const LABOR_RATE_MAX = 500

function bookOf(kind) {
  const key = String(kind || '').trim()
  return BOOKS[key] || null
}

function collectionOf(kind) {
  const book = bookOf(kind)
  if (!book) throw new Error(`未知价目本：${kind}`)
  return book.collection
}

/** 别名：去空、去重（按归一化值）、最多 20 个，避免一行塞进几百个别名 */
function normalizeAliases(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[，,、\s]+/)
  const out = []
  const seen = {}
  for (const item of list) {
    const text = String(item == null ? '' : item).trim()
    if (!text) continue
    const nk = normalizeName(text)
    if (!nk || seen[nk]) continue
    seen[nk] = true
    out.push(text)
    if (out.length >= 20) break
  }
  return out
}

function normalizePrice(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  // 以「分」为最小单位落库，避免 19.999 这类值在后续乘算里累积误差
  return toYuan(toCents(n))
}

function normalizeSort(raw) {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function normalizeStatus(raw) {
  const s = String(raw || '').trim()
  return s === STATUS.INACTIVE ? STATUS.INACTIVE : STATUS.ACTIVE
}

/**
 * 把入参归一成可写库的一行。
 * @returns {{ok:boolean, row?:Object, msg?:string}}
 */
function buildRow(input, kind) {
  const book = bookOf(kind)
  if (!book) return { ok: false, msg: `未知价目本：${kind}` }
  const src = input || {}

  const name = String(src.name || '').trim()
  if (!name) return { ok: false, msg: '名称必填' }

  const optionRaw = book.optionField === 'size' ? src.size : src.grade
  const option = String(optionRaw == null ? '' : optionRaw).trim() || book.defaultOption

  const unitPrice = normalizePrice(src.unitPrice)
  if (unitPrice === null) return { ok: false, msg: `「${name}」单价必须是 ≥ 0 的数字` }

  const row = {
    name,
    normName: normalizeName(name),
    displayName: String(src.displayName || '').trim(),
    aliases: normalizeAliases(src.aliases),
    unitPrice,
    qtyPerUnit: normalizeQtyPerUnit(src.qtyPerUnit),
    unit: String(src.unit || '').trim(),
    status: normalizeStatus(src.status),
    note: String(src.note == null ? '' : src.note).trim(),
    sort: normalizeSort(src.sort),
    deleted: false
  }
  row[book.optionField] = option
  row[book.defaultFlagKey] = src[book.defaultFlagKey] === true

  if (book.kind === KIND.MATERIAL) {
    const category = String(src.category || '').trim()
    row.category = CATEGORY_OPTIONS.includes(category) ? category : ''
  }
  return { ok: true, row }
}

// ─────────────────────── 出货 SKU（可复用目录） ───────────────────────

const SKU_COLLECTION = 'studio_shipment_skus'

/**
 * SKU 的**唯一键**：材料(规范化名) + 等级 + 包装(规范化名) + 尺寸。
 *
 * ⚠️ **手工费率不进唯一键** —— 它是 SKU 的**默认属性**（出货时还能覆盖），
 * 不是身份。否则「同一个组合、只想改默认费率」会变成新建一个重复 SKU，
 * 开单时列表里出现两个看起来一样的东西。
 * `skuName` 同理**不编码费率**：费率改了名字不该跟着变。
 */
function skuKeyOf(input) {
  const src = input || {}
  return [
    normalizeName(src.materialName || src.materialId || ''),
    normalizeName(normGrade(src.materialGrade)),
    normalizeName(src.packagingName || src.packagingId || ''),
    normalizeName(normSize(src.packagingSize))
  ].join('|')
}

/** 自动生成可读名（材料[ 等级] · 包装[ 尺寸]）。**不含费率**，理由见 skuKeyOf */
function autoSkuName(input) {
  const src = input || {}
  const mat = String(src.materialName || '').trim()
  const grade = String(src.materialGrade || '').trim()
  const pkg = String(src.packagingName || '').trim()
  const size = String(src.packagingSize || '').trim()
  const left = mat + (grade && grade !== DEFAULT_GRADE ? ' ' + grade : '')
  const right = pkg + (size && size !== DEFAULT_SIZE ? ' ' + size : '')
  return [left, right].filter(Boolean).join(' · ')
}

/**
 * SKU 归一化 + 校验（纯函数，不落库）。
 * 只校验**结构与一致性**，不校验"这个材料在不在价目表里"（那要查库，见云函数的 handleSkuCreate）。
 */
function buildSkuRow(input) {
  const src = input || {}
  const materialId = String(src.materialId || '').trim()
  const materialName = String(src.materialName || '').trim()
  if (!materialId && !materialName) return { ok: false, msg: '必须选原材料' }
  const packagingId = String(src.packagingId || '').trim()
  const packagingName = String(src.packagingName || '').trim()
  if (!packagingId && !packagingName) return { ok: false, msg: '必须选包装方式' }

  const materialGrade = String(src.materialGrade || '').trim() || DEFAULT_GRADE
  const packagingSize = String(src.packagingSize || '').trim() || DEFAULT_SIZE
  // 费率：留空 = 用全局配置（不是 0）。0 是合法值（这一单不收手工费）
  const hasRate = src.laborRatePct !== undefined && src.laborRatePct !== null && src.laborRatePct !== ''
  const laborRatePct = hasRate ? normalizeRatePct(src.laborRatePct, null) : null

  const row = {
    materialId,
    materialName,
    materialGrade,
    packagingId,
    packagingName,
    packagingSize,
    laborRatePct,
    status: String(src.status || '') === STATUS.INACTIVE ? STATUS.INACTIVE : STATUS.ACTIVE,
    sort: normalizeSort(src.sort),
    note: String(src.note == null ? '' : src.note).trim(),
    deleted: false
  }
  row.skuKey = skuKeyOf(row)
  row.skuName = String(src.skuName || '').trim() || autoSkuName(row)
  if (!row.skuKey.replace(/\|/g, '')) return { ok: false, msg: 'SKU 组合为空' }
  return { ok: true, row }
}

/** 落库 → 客户端形状 */
function mapSku(doc) {
  const d = doc || {}
  return {
    _id: d._id || '',
    skuName: d.skuName || autoSkuName(d),
    materialId: d.materialId || '',
    materialName: d.materialName || '',
    materialGrade: d.materialGrade || DEFAULT_GRADE,
    packagingId: d.packagingId || '',
    packagingName: d.packagingName || '',
    packagingSize: d.packagingSize || DEFAULT_SIZE,
    laborRatePct: d.laborRatePct === null || d.laborRatePct === undefined ? null : Number(d.laborRatePct),
    /** 费率是否落全局默认（前端显示"用全局 N%"而不是空白） */
    useGlobalRate: d.laborRatePct === null || d.laborRatePct === undefined,
    status: d.status === STATUS.INACTIVE ? STATUS.INACTIVE : STATUS.ACTIVE,
    sort: normalizeSort(d.sort),
    note: d.note || '',
    updatedAt: Number(d.updatedAt) || 0
  }
}

/** 批量导入的列定义（顺序即位置；只有前 4 列有意义，后 3 列可选） */
const BULK_COLUMNS = ['名称', '别名', '等级或尺寸', '单价', '单位', '用量', '默认']

/**
 * 按制表符 / 竖线（markdown 表格）/ 逗号切列。
 * 三种都支持是因为人可能从 Excel 贴（制表符）、从我给的表格贴（竖线）、或手打（逗号）。
 */
function splitBulkLine(line) {
  const t = String(line || '')
  if (t.indexOf('\t') !== -1) return t.split('\t')
  if (t.indexOf('|') !== -1) return t.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|')
  return t.split(',')
}

function truthyCell(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase()
  return s === '是' || s === '✓' || s === 'y' || s === 'yes' || s === 'true' || s === '1' || s === '默认'
}

/**
 * 解析「批量粘贴导入」的文本（**纯函数**，不落库）。
 *
 * 为什么解析放服务端而不是 ERP 页面里：
 *   ① 守卫能用同一套机器测它（页面里的解析逻辑测不到）；
 *   ② 导入前的预览与真正入库**必须用同一份解析结果** —— 两处各解析一次必然漂移。
 *
 * 容错（都实测过，不是为了"看起来健壮"）：
 *   · 跳过空行、markdown 分隔行（`|---|`）、表头行；
 *   · 第一列若是**纯数字序号**（我的填写清单表格就是这样）→ 右移一位；
 *   · 列数不足 4 列 → 报错并带上行号与原文，**不静默丢行**；
 *   · `等级或尺寸` 留空、写「默认」、或 `默认` 列打了勾 → 都算默认行。
 *
 * @returns {{rows:Array, errors:Array<{line:number,text:string,msg:string}>, skipped:number}}
 */
function parseBulkText(text, kind) {
  const book = bookOf(kind)
  if (!book) return { rows: [], errors: [{ line: 0, text: '', msg: `未知价目本：${kind}` }], skipped: 0 }
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')
  const rows = []
  const errors = []
  let skipped = 0

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1
    const raw = lines[i]
    const t = String(raw == null ? '' : raw).trim()
    if (!t) continue
    // markdown 分隔行（|---|:--|）与整行横线
    if (/^[\s|:\-–—]+$/.test(t)) continue

    let cells = splitBulkLine(t).map((c) => String(c == null ? '' : c).trim())
    /**
     * 首列是序号列 → 右移。
     * 除纯数字外，**还认 `#`** —— 我给的填写清单表格表头就是 `| # | 材料名 | …`，
     * 只认数字会让表头那行被当成数据行并报一个假错（守卫 E2c 实测抓到）。
     */
    if (cells.length > 1 && (/^\d+$/.test(cells[0]) || cells[0] === '#')) cells = cells.slice(1)

    const name = cells[0] || ''
    if (!name) continue
    // 表头行
    if (/^(名称|材料名|包装名|物品名称|name)$/i.test(name)) continue

    // 前 4 列必须有内容位（别名允许空，但位置要在）
    if (cells.length < 4) {
      errors.push({
        line: lineNo,
        text: t,
        msg: `列数不足：至少需要「名称	别名	${book.optionLabel}	单价」4 列（当前 ${cells.length} 列）`
      })
      continue
    }

    const aliasText = cells[1] || ''
    const optionRaw = cells[2] || ''
    const priceRaw = cells[3] || ''
    const unit = cells[4] || ''
    const qtyRaw = cells[5] || ''
    const defaultRaw = cells[6] || ''

    const price = normalizePrice(priceRaw)
    if (price === null) {
      errors.push({ line: lineNo, text: t, msg: `「${name}」单价不是 ≥ 0 的数字：${priceRaw || '(空)'}` })
      continue
    }

    const isDefault = truthyCell(defaultRaw) || !optionRaw || optionRaw === book.defaultOption
    const item = {
      name,
      aliases: aliasText,
      unitPrice: price,
      unit,
      qtyPerUnit: qtyRaw ? Number(qtyRaw) : 1,
      status: STATUS.ACTIVE,
      sort: rows.length,
      isDefault
    }
    if (book.kind === KIND.MATERIAL) {
      item.grade = optionRaw && optionRaw !== book.defaultOption ? optionRaw : ''
      item.isDefaultGrade = isDefault
    } else {
      item.size = optionRaw && optionRaw !== book.defaultOption ? optionRaw : ''
      item.isDefaultSize = isDefault
    }

    const built = buildRow(item, book.kind)
    if (!built.ok) {
      errors.push({ line: lineNo, text: t, msg: built.msg })
      continue
    }
    // 同一批里重复（同名称 + 同等级/尺寸）→ 报错而不是让后一条静默覆盖前一条
    const key = built.row.normName + '|' + (built.row[book.optionField] || book.defaultOption)
    if (rows.some((r) => r.__key === key)) {
      errors.push({ line: lineNo, text: t, msg: `同一批里重复：${name} · ${optionRaw || book.defaultOption}` })
      continue
    }
    rows.push(Object.assign({ __key: key, __line: lineNo }, built.row))
  }

  return { rows, errors, skipped }
}

/** 写库形状 → 客户端形状（补上派生字段，前端不必自己算） */
function mapRow(doc) {
  const raw = doc || {}
  const kind = raw.kind || (raw.size !== undefined && raw.grade === undefined ? KIND.PACKAGING : KIND.MATERIAL)
  const book = bookOf(kind) || BOOKS.material
  const option = raw[book.optionField] || book.defaultOption
  return {
    _id: raw._id || '',
    kind,
    name: raw.name || '',
    displayName: raw.displayName || raw.name || '',
    aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
    option,
    optionLabel: book.optionLabel,
    isDefaultOption: raw[book.defaultFlagKey] === true,
    unitPrice: Number(raw.unitPrice) || 0,
    qtyPerUnit: normalizeQtyPerUnit(raw.qtyPerUnit),
    unit: raw.unit || '',
    category: raw.category || '',
    status: raw.status === STATUS.INACTIVE ? STATUS.INACTIVE : STATUS.ACTIVE,
    note: raw.note || '',
    sort: normalizeSort(raw.sort),
    updatedAt: Number(raw.updatedAt) || 0
  }
}

/** 客户端形状 → 写回形状（update 时用，避免把派生字段写进库） */
function toPatch(input, kind) {
  return buildRow(input, kind)
}

function normalizeRatePct(raw, fallback) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  if (n < LABOR_RATE_MIN) return LABOR_RATE_MIN
  if (n > LABOR_RATE_MAX) return LABOR_RATE_MAX
  return n
}

/** 结算配置归一：字段缺失一律取默认（`enabled` 缺失 = 关） */
function normalizeConfig(doc) {
  const src = doc || {}
  const rate = normalizeRatePct(src.laborRatePct, DEFAULT_CONFIG.laborRatePct)
  return {
    enabled: src.enabled === true,
    laborRatePct: rate,
    requirePackaging: src.requirePackaging !== false,
    rounding: String(src.rounding || DEFAULT_CONFIG.rounding),
    updatedAt: Number(src.updatedAt) || 0,
    updatedBy: src.updatedBy || ''
  }
}

/** 把两个价目本的行合并后跑完整性校验（写入前拦截脏数据） */
function validateBooks(materials, packagings) {
  return validatePriceBook({
    materials: Array.isArray(materials) ? materials : [],
    packagings: Array.isArray(packagings) ? packagings : []
  })
}

function bookMeta() {
  return KIND_OPTIONS.map((kind) => {
    const book = BOOKS[kind]
    return {
      kind,
      collection: book.collection,
      label: book.label,
      optionField: book.optionField,
      optionLabel: book.optionLabel,
      defaultFlagKey: book.defaultFlagKey,
      defaultOption: book.defaultOption,
      keywordHint: book.keywordHint
    }
  })
}

module.exports = {
  MATERIAL_COLLECTION,
  PACKAGING_COLLECTION,
  CONFIG_COLLECTION,
  CONFIG_ID,
  KIND,
  KIND_OPTIONS,
  BOOKS,
  STATUS,
  CATEGORY_OPTIONS,
  DEFAULT_CONFIG,
  LABOR_RATE_MIN,
  LABOR_RATE_MAX,
  bookOf,
  collectionOf,
  normalizeAliases,
  normalizePrice,
  normalizeSort,
  normalizeStatus,
  normalizeRatePct,
  buildRow,
  mapRow,
  toPatch,
  normalizeConfig,
  validateBooks,
  bookMeta,
  BULK_COLUMNS,
  parseBulkText,
  SKU_COLLECTION,
  skuKeyOf,
  autoSkuName,
  buildSkuRow,
  mapSku
}
