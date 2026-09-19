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
  bookMeta
}
