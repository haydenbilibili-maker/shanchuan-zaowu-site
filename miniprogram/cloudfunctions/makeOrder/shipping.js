/**
 * 运费规则（**服务端权威** —— C 端真实下单按它算钱）
 *
 * 须与 `miniprogram/config/shipping.js`（C 端展示）与
 * `miniprogram/cloudfunctions/getShippingRules/defaults.js`（规则模型）保持一致。
 * 一致性由 `npm run check:shipping-rules-sync` 守卫（含「云端文档 vs 代码默认值」）。
 *
 * 下单权威：优先读云库 shipping_rules，失败回退本文件 defaults。
 *
 * 规则（2026-09-19 产品负责人定案，蓝图 §19 裁决 40/41/41b/41c）：
 * 1. 默认承运商：顺丰速运
 * 2. **收费类**（`craftType` ∈ chargedCraftTypes：相框 / 方形玻璃罩 / 圆形玻璃罩 / 圆柱形玻璃罩）：
 *    订单**全场**满 ¥299 免邮，未满收 **¥18 / 单**（一单一次，不是每件）
 * 3. **其余一律免邮**（造景 / 饰品 / 蝶翅画 / 冰箱贴 / 其它 / 未标注 craftType）
 * 4. 限时免邮：freeShippingCampaign.enabled=true 时全场免邮
 *
 * ⚠️ 判定**只看 craftType**，不看标题、不看类别、不做文本猜测。
 * ⚠️ 门面自取（storePickup）在 pricing.js 里强制 0，不经本文件。
 */

const COLLECTION = 'shipping_rules'

const SHIPPING_KIND = {
  ACCESSORY: 'accessory',
  SPECIMEN: 'specimen'
}

/** 旧模型遗留常量（保留以免解构报错；新模型不再有混合车策略） */
const MIX_SPECIMEN_WINS = 'specimen_wins'
const MIX_ACCESSORY_WINS = 'accessory_wins'
const MIX_MAX_THRESHOLD = 'max_threshold'

/**
 * 收费类装裱方式（与 config/productTaxonomy.js 的 CRAFT_TYPE_OPTIONS 同源）。
 * ⚠️「玻璃罩」是**三个不同的 key**（方形 / 圆形 / 圆柱形）—— 只勾一个会漏收运费。
 */
const DEFAULT_CHARGED_CRAFT_TYPES = ['frame', 'cloche', 'cloche_round', 'cloche_cylinder']

const CRAFT_TYPE_LABELS = {
  frame: '相框',
  cloche: '方形玻璃罩',
  cloche_round: '圆形玻璃罩',
  cloche_cylinder: '圆柱形玻璃罩',
  diorama: '造景',
  magnet: '冰箱贴',
  accessory: '饰品',
  wing_art: '蝶翅画',
  other: '其它'
}

const DEFAULTS = {
  defaultCarrier: '顺丰速运',
  flatFee: 18,
  freeShippingThreshold: 299,
  chargedCraftTypes: DEFAULT_CHARGED_CRAFT_TYPES.slice(),
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
  freeShippingThreshold: DEFAULTS.freeShippingThreshold,
  chargedCraftTypes: DEFAULTS.chargedCraftTypes.slice(),
  freeShippingCampaign: { ...DEFAULTS.freeShippingCampaign },
  fromDefault: true,
  loadedAt: 0
}

function toNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 规范化收费类清单：非数组 → null（保留代码默认）；
 * 空数组同样按「缺失」处理 —— 不允许静默变成「全场免邮」（保存侧会拒绝空清单）。
 */
function normalizeChargedCraftTypes(raw) {
  if (!Array.isArray(raw)) return null
  const out = []
  raw.forEach((v) => {
    const key = String(v == null ? '' : v).trim().toLowerCase()
    if (key && out.indexOf(key) === -1) out.push(key)
  })
  return out
}

function getChargedCraftTypes() {
  return state.chargedCraftTypes && state.chargedCraftTypes.length
    ? state.chargedCraftTypes
    : DEFAULT_CHARGED_CRAFT_TYPES.slice()
}

function isChargedCraftType(craft) {
  const key = String(craft == null ? '' : craft).trim().toLowerCase()
  if (!key) return false
  return getChargedCraftTypes().indexOf(key) !== -1
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

  // 兼容读取链：freeShippingThreshold（新） → specimenFreeThreshold（旧） → thresholds.specimen
  const rawFree = src.freeShippingThreshold != null
    ? src.freeShippingThreshold
    : (src.specimenFreeThreshold != null
      ? src.specimenFreeThreshold
      : thresholds.specimen)
  state.freeShippingThreshold = Math.max(0, toNumber(rawFree, DEFAULTS.freeShippingThreshold))

  const charged = normalizeChargedCraftTypes(src.chargedCraftTypes)
  state.chargedCraftTypes = charged && charged.length
    ? charged
    : DEFAULTS.chargedCraftTypes.slice()

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
    freeShippingThreshold: state.freeShippingThreshold,
    chargedCraftTypes: state.chargedCraftTypes.slice(),
    // 旧字段镜像（保持自洽，避免仍读它们的调用方拿到旧值）
    accessoryFreeThreshold: 0,
    specimenFreeThreshold: state.freeShippingThreshold,
    thresholds: {
      accessory: 0,
      specimen: state.freeShippingThreshold
    },
    mixCartStrategy: MIX_SPECIMEN_WINS,
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

/**
 * 本件属于「收费类」还是「免邮类」（服务端权威判定）。
 *
 * 判定顺序（**不可换位**）：
 *   1) 显式 `shippingKind` 覆盖（人工标注优先）
 *   2) **装裱方式 `craftType`** —— 唯一分类轴（裁决 40）
 *   3) 未标注 `craftType`（空）→ **免邮**（裁决 41b）
 *
 * ⚠️ 必须在任何 `categoryType` 短路口**之前**：`pricing.js` 传进来的商品绝大多数
 *    `categoryType === 'specimen'`，若先按 categoryType 短路，craftType 这一层一行都不生效。
 * ⚠️ 未标注不能写成「有 craftType 才按它判，否则走原逻辑」—— 那样未标注标本会掉回
 *    categoryType 短路被判收费，与裁决 41b 相反（会多收钱）。
 */
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

  return isChargedCraftType(product.craftType) ? SHIPPING_KIND.SPECIMEN : SHIPPING_KIND.ACCESSORY
}

/**
 * 本单适用的包邮门槛：含收费类 → 全场门槛；纯免邮类 → 0。
 * 口径是「**全场订单**满 ¥299」，不是「收费类小计」。
 */
function resolveThreshold(context) {
  const free = state.freeShippingThreshold

  if (context == null) return free

  if (typeof context === 'number' && Number.isFinite(context)) {
    return context
  }

  if (typeof context === 'string') {
    const kind = normalizeExplicitKind(context) || resolveShippingKind(context)
    return kind === SHIPPING_KIND.SPECIMEN ? free : 0
  }

  if (Array.isArray(context)) {
    if (!context.length) return free
    return context.some((item) => resolveShippingKind(item) === SHIPPING_KIND.SPECIMEN) ? free : 0
  }

  if (typeof context === 'object') {
    if (Array.isArray(context.items)) return resolveThreshold(context.items)
    if (context.threshold != null && Number.isFinite(Number(context.threshold))) {
      return Number(context.threshold)
    }
    if (context.kind) return resolveThreshold(context.kind)
    return resolveShippingKind(context) === SHIPPING_KIND.SPECIMEN ? free : 0
  }

  return free
}

function resolveOrderKind(context) {
  return resolveThreshold(context) > 0 ? SHIPPING_KIND.SPECIMEN : SHIPPING_KIND.ACCESSORY
}

/**
 * @param {number} goodsAmount 优惠前**整单**商品合计（勿传折后应付、勿只传收费类小计）
 * @param {object|array|string|number} [context] 商品列表或品类上下文
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

function getFreeShippingThreshold() {
  return state.freeShippingThreshold
}

function getThresholds() {
  return {
    accessory: 0,
    specimen: state.freeShippingThreshold
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
  DEFAULT_CHARGED_CRAFT_TYPES,
  CRAFT_TYPE_LABELS,
  /** @deprecated 请用 getDefaultCarrier()，避免解构时拿到陈旧字符串 */
  get DEFAULT_CARRIER() {
    return state.defaultCarrier
  },
  get FREE_SHIPPING_THRESHOLD() {
    return state.freeShippingThreshold
  },
  get DEFAULT_SHIPPING_FEE() {
    return state.flatFee
  },
  get THRESHOLDS() {
    return getThresholds()
  },
  get CHARGED_CRAFT_TYPES() {
    return getChargedCraftTypes()
  },
  get freeShippingCampaign() {
    return state.freeShippingCampaign
  },
  loadFromDb,
  applyConfig,
  resetToDefaults,
  snapshotConfig,
  isFreeShippingCampaignActive,
  normalizeChargedCraftTypes,
  getChargedCraftTypes,
  isChargedCraftType,
  resolveShippingKind,
  resolveThreshold,
  resolveOrderKind,
  calcShipping,
  getDefaultCarrier,
  getFreeShippingThreshold,
  getThresholds,
  getFlatFee
}
