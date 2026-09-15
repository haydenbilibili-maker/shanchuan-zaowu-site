/**
 * 运费规则（须与客户端 config/shipping.js / getShippingRules/defaults 保持一致）
 *
 * 下单权威：优先读云库 shipping_rules，失败回退本文件 defaults。
 *
 * 规则（2026-09 defaults）：
 * 1. 默认承运商：顺丰速运
 * 2. 包邮门槛：饰品满 200 / 标本满 500
 * 3. 未达门槛：运费 ¥18
 * 4. 混合车：任一标本 → 整单用标本门槛（mixCartStrategy=specimen_wins）
 * 5. 限时免邮：freeShippingCampaign.enabled=true 时全场免邮
 */

const COLLECTION = 'shipping_rules'

const SHIPPING_KIND = {
  ACCESSORY: 'accessory',
  SPECIMEN: 'specimen'
}

const MIX_SPECIMEN_WINS = 'specimen_wins'
const MIX_ACCESSORY_WINS = 'accessory_wins'
const MIX_MAX_THRESHOLD = 'max_threshold'

const DEFAULTS = {
  defaultCarrier: '顺丰速运',
  flatFee: 18,
  accessoryFreeThreshold: 200,
  specimenFreeThreshold: 500,
  mixCartStrategy: MIX_SPECIMEN_WINS,
  freeShippingCampaign: {
    enabled: false,
    label: '当前全场免邮',
    startAt: '',
    endAt: ''
  }
}

/** 运行时状态（每次 loadFromDb 重置为 defaults 再合并云端） */
const state = {
  defaultCarrier: DEFAULTS.defaultCarrier,
  flatFee: DEFAULTS.flatFee,
  thresholds: {
    accessory: DEFAULTS.accessoryFreeThreshold,
    specimen: DEFAULTS.specimenFreeThreshold
  },
  mixCartStrategy: DEFAULTS.mixCartStrategy,
  freeShippingCampaign: { ...DEFAULTS.freeShippingCampaign },
  fromDefault: true,
  loadedAt: 0
}

const ACCESSORY_CATEGORY_RE = /衍生|文创|饰品|周边|礼品|陈饰|包装|联名/
const ACCESSORY_TITLE_RE = /饰品|首饰|项链|手链|手环|耳环|耳钉|戒指|胸针|吊坠|徽章|冰箱贴/
const SPECIMEN_TITLE_RE = /标本|相框|玻璃罩|造景|框画/

function toNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function applyConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const thresholds = src.thresholds && typeof src.thresholds === 'object' ? src.thresholds : {}

  state.defaultCarrier = String(
    src.defaultCarrier || src.carrier || DEFAULTS.defaultCarrier
  ).trim() || DEFAULTS.defaultCarrier

  state.flatFee = Math.max(
    0,
    toNumber(src.flatFee != null ? src.flatFee : src.shippingFee, DEFAULTS.flatFee)
  )

  const accessory = toNumber(
    src.accessoryFreeThreshold != null ? src.accessoryFreeThreshold : thresholds.accessory,
    DEFAULTS.accessoryFreeThreshold
  )
  const specimen = toNumber(
    src.specimenFreeThreshold != null
      ? src.specimenFreeThreshold
      : (thresholds.specimen != null ? thresholds.specimen : src.freeShippingThreshold),
    DEFAULTS.specimenFreeThreshold
  )
  state.thresholds.accessory = Math.max(0, accessory)
  state.thresholds.specimen = Math.max(0, specimen)

  const mix = String(src.mixCartStrategy || DEFAULTS.mixCartStrategy).trim()
  state.mixCartStrategy =
    mix === MIX_ACCESSORY_WINS || mix === MIX_MAX_THRESHOLD ? mix : MIX_SPECIMEN_WINS

  const camp = src.freeShippingCampaign && typeof src.freeShippingCampaign === 'object'
    ? src.freeShippingCampaign
    : {}
  state.freeShippingCampaign = {
    enabled: camp.enabled === true,
    label: String(camp.label || DEFAULTS.freeShippingCampaign.label).trim() || DEFAULTS.freeShippingCampaign.label,
    startAt: camp.startAt ? String(camp.startAt) : '',
    endAt: camp.endAt ? String(camp.endAt) : ''
  }
}

function resetToDefaults() {
  applyConfig({})
  state.fromDefault = true
}

/**
 * 从云库加载运费规则；失败则回退 defaults。
 * @returns {{ fromDefault: boolean, config: object }}
 */
async function loadFromDb(db) {
  resetToDefaults()
  if (!db || typeof db.collection !== 'function') {
    return { fromDefault: true, config: snapshotConfig() }
  }
  try {
    const res = await db.collection(COLLECTION)
      .where({ status: 'active' })
      .orderBy('priority', 'desc')
      .limit(1)
      .get()
    if (res.data && res.data.length) {
      applyConfig(res.data[0])
      state.fromDefault = false
      state.loadedAt = Date.now()
      return { fromDefault: false, config: snapshotConfig() }
    }
  } catch (e) {
    console.warn('makeOrder shipping loadFromDb fallback:', e.message)
  }
  state.loadedAt = Date.now()
  return { fromDefault: true, config: snapshotConfig() }
}

function snapshotConfig() {
  return {
    defaultCarrier: state.defaultCarrier,
    flatFee: state.flatFee,
    shippingFee: state.flatFee,
    carrier: state.defaultCarrier,
    accessoryFreeThreshold: state.thresholds.accessory,
    specimenFreeThreshold: state.thresholds.specimen,
    freeShippingThreshold: state.thresholds.specimen,
    thresholds: {
      accessory: state.thresholds.accessory,
      specimen: state.thresholds.specimen
    },
    mixCartStrategy: state.mixCartStrategy,
    freeShippingCampaign: { ...state.freeShippingCampaign },
    fromDefault: state.fromDefault
  }
}

function isWithinCampaignWindow(campaign, now) {
  if (!campaign) return false
  const t = now instanceof Date ? now : new Date(now)
  if (campaign.startAt) {
    const start = new Date(campaign.startAt)
    if (!Number.isNaN(start.getTime()) && t < start) return false
  }
  if (campaign.endAt) {
    const end = new Date(campaign.endAt)
    if (!Number.isNaN(end.getTime()) && t > end) return false
  }
  return true
}

function isFreeShippingCampaignActive(now = new Date()) {
  const c = state.freeShippingCampaign
  if (!c || c.enabled !== true) return false
  return isWithinCampaignWindow(c, now)
}

function normalizeExplicitKind(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim().toLowerCase()
  if (
    s === SHIPPING_KIND.ACCESSORY ||
    s === '饰品' ||
    s === 'merch' ||
    s === 'jewelry' ||
    s === 'accessory'
  ) {
    return SHIPPING_KIND.ACCESSORY
  }
  if (
    s === SHIPPING_KIND.SPECIMEN ||
    s === '标本' ||
    s === 'specimen' ||
    s === 'display'
  ) {
    return SHIPPING_KIND.SPECIMEN
  }
  return ''
}

function resolveShippingKind(product) {
  if (!product || typeof product !== 'object') {
    if (typeof product === 'string') {
      return normalizeExplicitKind(product) || SHIPPING_KIND.SPECIMEN
    }
    return SHIPPING_KIND.SPECIMEN
  }

  const explicit = normalizeExplicitKind(
    product.shippingKind || product.shippingGroup || product.goodsKind || product.kind
  )
  if (explicit) return explicit

  if (product.categoryType === 'merch') return SHIPPING_KIND.ACCESSORY
  if (product.categoryType === 'specimen' || product.categoryType === 'display') {
    return SHIPPING_KIND.SPECIMEN
  }

  const root = String(product.rootCategoryName || product.rootCategory || '')
  const cat = String(
    product.category || product.categoryName || product.subCategoryName || ''
  )
  if (ACCESSORY_CATEGORY_RE.test(root) || ACCESSORY_CATEGORY_RE.test(cat)) {
    return SHIPPING_KIND.ACCESSORY
  }

  const title = String(product.title || '')
  if (ACCESSORY_TITLE_RE.test(title) && !SPECIMEN_TITLE_RE.test(title)) {
    return SHIPPING_KIND.ACCESSORY
  }

  return SHIPPING_KIND.SPECIMEN
}

function resolveThreshold(context) {
  const accessory = state.thresholds.accessory
  const specimen = state.thresholds.specimen

  if (context == null) return specimen

  if (typeof context === 'number' && Number.isFinite(context)) {
    return context
  }

  if (typeof context === 'string') {
    const kind = normalizeExplicitKind(context) || resolveShippingKind(context)
    return kind === SHIPPING_KIND.ACCESSORY ? accessory : specimen
  }

  if (Array.isArray(context)) {
    if (!context.length) return specimen
    const hasSpecimen = context.some((item) => resolveShippingKind(item) === SHIPPING_KIND.SPECIMEN)
    const hasAccessory = context.some((item) => resolveShippingKind(item) === SHIPPING_KIND.ACCESSORY)
    if (state.mixCartStrategy === MIX_MAX_THRESHOLD) {
      return Math.max(accessory, specimen)
    }
    if (state.mixCartStrategy === MIX_ACCESSORY_WINS) {
      return hasSpecimen ? specimen : accessory
    }
    // specimen_wins（默认）
    return hasSpecimen ? specimen : (hasAccessory ? accessory : specimen)
  }

  if (typeof context === 'object') {
    if (Array.isArray(context.items)) return resolveThreshold(context.items)
    if (context.threshold != null && Number.isFinite(Number(context.threshold))) {
      return Number(context.threshold)
    }
    if (context.kind) return resolveThreshold(context.kind)
    return resolveShippingKind(context) === SHIPPING_KIND.ACCESSORY ? accessory : specimen
  }

  return specimen
}

/**
 * @param {number} goodsAmount 优惠前商品合计（勿传折后应付）
 * @param {object|array|string|number} [context] 商品列表或品类上下文，用于选门槛
 */
function calcShipping(goodsAmount, context) {
  if (isFreeShippingCampaignActive()) return 0
  const amount = parseFloat(goodsAmount) || 0
  if (amount <= 0) return 0
  const threshold = resolveThreshold(context)
  if (amount >= threshold) return 0
  return state.flatFee
}

function getDefaultCarrier() {
  return state.defaultCarrier
}

function getThresholds() {
  return {
    accessory: state.thresholds.accessory,
    specimen: state.thresholds.specimen
  }
}

function getFlatFee() {
  return state.flatFee
}

module.exports = {
  COLLECTION,
  SHIPPING_KIND,
  MIX_SPECIMEN_WINS,
  MIX_ACCESSORY_WINS,
  MIX_MAX_THRESHOLD,
  /** @deprecated 请用 getDefaultCarrier()，避免解构时拿到陈旧字符串 */
  get DEFAULT_CARRIER() {
    return state.defaultCarrier
  },
  get FREE_SHIPPING_THRESHOLD() {
    return state.thresholds.specimen
  },
  get DEFAULT_SHIPPING_FEE() {
    return state.flatFee
  },
  get THRESHOLDS() {
    return state.thresholds
  },
  get freeShippingCampaign() {
    return state.freeShippingCampaign
  },
  loadFromDb,
  applyConfig,
  resetToDefaults,
  snapshotConfig,
  isFreeShippingCampaignActive,
  resolveShippingKind,
  resolveThreshold,
  calcShipping,
  getDefaultCarrier,
  getThresholds,
  getFlatFee
}
