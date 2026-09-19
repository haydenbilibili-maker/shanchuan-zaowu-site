/**
 * 商城运费配置（v2 —— **按「装裱方式」 craftType 区分**）
 *
 * 口径来源：`admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md` §19（v1.7，裁决 40/41/41b/41c）。
 *
 * 规则（2026-09-19 产品负责人定案）：
 * 1. 默认承运商：顺丰速运
 * 2. **收费类**（`craftType` ∈ chargedCraftTypes：相框 / 方形玻璃罩 / 圆形玻璃罩 / 圆柱形玻璃罩）：
 *    订单**全场**满 ¥299 免邮，未满收 **¥18 / 单**（一单只收一次，不是每件）
 * 3. **其余一律免邮**：造景 / 饰品 / 蝶翅画 / 冰箱贴 / 其它 / **以及 craftType 为空（未标注）**
 *    —— 裁决 41b：未标注不倒扣、不要求补标
 * 4. 限时免邮：freeShippingCampaign.enabled = true 时全场免邮
 *
 * ⚠️ 判定**只看 craftType**，不看标题、不看类别、不做任何文本猜测（裁决 40）。
 * ⚠️ craftType 是**唯一分类轴**；历史那套「标题正则 + categoryType 短路」已删除，
 *    原因见 makeOrder/shipping.js 的 resolveShippingKind 注释
 *    （插在 categoryType 短路之后 = 一行都不会生效）。
 *
 * 代码 defaults 与云库 shipping_rules / getShippingRules 对齐（云端可覆盖，异常降级到本文件）。
 * 云端覆盖由 utils/shippingRulesSync 拉取后调用 applyRemoteConfig。
 */

const SHIPPING_KIND = {
  ACCESSORY: 'accessory',
  SPECIMEN: 'specimen'
}

/**
 * ⚠️ 以下三个常量是**旧模型（饰品/藏品双门槛 + 混合车策略）**的遗留名字。
 * 新模型只有一个「全场包邮门槛」，不再有混合车策略。
 * 保留它们只为不打断既有 `require` 解构。
 */
const MIX_SPECIMEN_WINS = 'specimen_wins'
const MIX_ACCESSORY_WINS = 'accessory_wins'
const MIX_MAX_THRESHOLD = 'max_threshold'

/**
 * 收费类装裱方式（存英文 key，与 config/productTaxonomy.js 的 CRAFT_TYPE_OPTIONS 同源）。
 * ⚠️「玻璃罩」是**三个不同的 key**（方形 / 圆形 / 圆柱形）—— 只勾一个会让另外两种漏成免邮、直接少收钱。
 */
const DEFAULT_CHARGED_CRAFT_TYPES = ['frame', 'cloche', 'cloche_round', 'cloche_cylinder']

/** 装裱方式中文名（展示用；未知 key 回退为 key 本身） */
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

const shipping = {
  defaultCarrier: '顺丰速运',
  carrier: '顺丰速运',
  shippingFee: 18,
  flatFee: 18,
  /** 全场包邮门槛（仅当订单含收费类时有意义） */
  freeShippingThreshold: 299,
  /** 收费类装裱方式清单（可被云端覆盖） */
  chargedCraftTypes: DEFAULT_CHARGED_CRAFT_TYPES.slice(),
  /**
   * 以下字段是旧模型的兼容镜像，**判定逻辑不再读取它们**：
   * 只用于 `THRESHOLDS` / `FREE_SHIPPING_THRESHOLD` 等既有导出不被解构出 undefined。
   */
  accessoryFreeThreshold: 0,
  specimenFreeThreshold: 299,
  thresholds: {
    accessory: 0,
    specimen: 299
  },
  mixCartStrategy: MIX_SPECIMEN_WINS,
  freeShippingCampaign: {
    enabled: false,
    label: '当前全场免邮'
  },
  _fromRemote: false
}

function toNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 规范化收费类清单：
 * - 非数组（含缺字段）→ null，表示「云端没给，保留代码默认」
 * - 数组 → 清洗后的数组；**空数组按「缺失」处理**（不允许静默变成「全场免邮」，
 *   保存侧 getShippingRules 也会直接拒绝空清单）
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

/** 当前生效的收费类清单 */
function getChargedCraftTypes() {
  const list = shipping.chargedCraftTypes
  return Array.isArray(list) && list.length ? list : DEFAULT_CHARGED_CRAFT_TYPES.slice()
}

function isChargedCraftType(craft) {
  const key = String(craft == null ? '' : craft).trim().toLowerCase()
  if (!key) return false
  return getChargedCraftTypes().indexOf(key) !== -1
}

/** 收费类中文清单（摘要文案用） */
function chargedCraftTypesLabel() {
  return getChargedCraftTypes()
    .map((k) => CRAFT_TYPE_LABELS[k] || k)
    .join('/')
}

/**
 * 用云端配置覆盖本地 defaults（失败时保留 defaults）
 */
function applyRemoteConfig(raw) {
  if (!raw || typeof raw !== 'object') return shipping
  const thresholds = raw.thresholds && typeof raw.thresholds === 'object' ? raw.thresholds : {}

  const flatFee = Math.max(
    0,
    toNumber(raw.flatFee != null ? raw.flatFee : raw.shippingFee, shipping.flatFee)
  )
  const carrier = String(raw.defaultCarrier || raw.carrier || shipping.defaultCarrier).trim()
    || shipping.defaultCarrier

  // 兼容读取链：freeShippingThreshold（新） → specimenFreeThreshold（旧） → thresholds.specimen
  const free = Math.max(0, toNumber(
    raw.freeShippingThreshold != null
      ? raw.freeShippingThreshold
      : (raw.specimenFreeThreshold != null ? raw.specimenFreeThreshold : thresholds.specimen),
    shipping.freeShippingThreshold
  ))

  const charged = normalizeChargedCraftTypes(raw.chargedCraftTypes)

  shipping.defaultCarrier = carrier
  shipping.carrier = carrier
  shipping.shippingFee = flatFee
  shipping.flatFee = flatFee
  shipping.freeShippingThreshold = free
  // 旧字段镜像：保持自洽，避免仍读它们的代码（导出常量 / 历史页面）拿到旧值
  shipping.accessoryFreeThreshold = 0
  shipping.specimenFreeThreshold = free
  shipping.thresholds.accessory = 0
  shipping.thresholds.specimen = free
  if (charged && charged.length) shipping.chargedCraftTypes = charged

  const camp = raw.freeShippingCampaign && typeof raw.freeShippingCampaign === 'object'
    ? raw.freeShippingCampaign
    : {}
  shipping.freeShippingCampaign = {
    enabled: camp.enabled === true,
    label: String(camp.label || '当前全场免邮').trim() || '当前全场免邮',
    startAt: camp.startAt || '',
    endAt: camp.endAt || ''
  }
  shipping._fromRemote = true
  return shipping
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

function isCampaignActive(now) {
  const c = shipping.freeShippingCampaign
  if (!c || c.enabled !== true) return false
  return isWithinCampaignWindow(c, now || new Date())
}

function getCampaignLabel() {
  const c = shipping.freeShippingCampaign
  return (c && c.label) || '当前全场免邮'
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
 * 本件属于「收费类」还是「免邮类」。
 *
 * 判定顺序（**不可换位**）：
 *   1) 显式 `shippingKind` 覆盖（人工标注优先）
 *   2) **装裱方式 `craftType`** —— 唯一分类轴（裁决 40）
 *   3) 未标注 `craftType`（空）→ **免邮**（裁决 41b）
 *
 * ⚠️ 判定必须在任何 `categoryType` 短路口**之前**：绝大多数商品 `categoryType === 'specimen'`，
 *    若先按 categoryType 短路，craftType 这一层就一行都不会生效（2026-09-19 实测踩过）。
 * ⚠️ 未标注不能写成「有 craftType 才按它判，否则走原逻辑」—— 那样未标注的标本会掉回
 *    categoryType 短路被判成收费类，与裁决 41b 相反。
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
 * 本单适用的包邮门槛：
 * - 含收费类商品 → 全场门槛（¥299）
 * - 纯免邮类（或空） → 0（规则本身就不收运费）
 *
 * 口径是「**全场订单**满 ¥299」，不是「收费类小计」—— amount 一律传整单优惠前商品合计。
 */
function resolveThreshold(context) {
  const free = shipping.freeShippingThreshold

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
 * @param {object|array|string|number} [context] 商品列表或品类上下文，用于判「本单是否含收费类」
 */
function calcShippingFee(goodsAmount, context) {
  if (isCampaignActive()) return 0
  const amount = parseFloat(goodsAmount) || 0
  if (amount <= 0) return 0
  const threshold = resolveThreshold(context)
  if (amount >= threshold) return 0
  return shipping.shippingFee
}

function getRuleText(context) {
  if (isCampaignActive()) return getCampaignLabel()
  const fee = shipping.shippingFee
  const free = shipping.freeShippingThreshold
  const carrier = shipping.defaultCarrier || '顺丰速运'
  const charged = chargedCraftTypesLabel()
  if (context != null && resolveOrderKind(context) === SHIPPING_KIND.ACCESSORY) {
    return `${carrier} · 本单免邮（非${charged}类免邮）`
  }
  if (context == null) {
    return `${carrier} · ${charged}类满 ¥${free} 免邮，其余免邮`
  }
  return `${carrier} · 全场满 ¥${free} 免邮，否则运费 ¥${fee}`
}

function getHint(price, context) {
  if (isCampaignActive()) return getCampaignLabel()
  const amount = parseFloat(price) || 0
  const threshold = resolveThreshold(context)
  const carrierShort = (shipping.defaultCarrier || '顺丰').replace(/速运$/, '')
  if (threshold <= 0) {
    return `本单免邮 · ${carrierShort}`
  }
  if (amount >= threshold) {
    return `本单享包邮 · ${carrierShort}（全场满 ¥${threshold}）`
  }
  const fee = calcShippingFee(amount, context)
  return `本单运费 ¥${fee} · ${carrierShort}（全场满 ¥${threshold} 免邮）`
}

function getFeeLabel(shippingFee) {
  const fee = parseFloat(shippingFee) || 0
  if (fee > 0) return `¥${fee.toFixed(2)}`
  if (isCampaignActive()) return '¥0.00'
  return '包邮'
}

function getCarrierLabel() {
  return shipping.defaultCarrier || shipping.carrier || '顺丰速运'
}

module.exports = Object.assign(shipping, {
  SHIPPING_KIND,
  MIX_SPECIMEN_WINS,
  MIX_ACCESSORY_WINS,
  MIX_MAX_THRESHOLD,
  DEFAULT_CHARGED_CRAFT_TYPES,
  CRAFT_TYPE_LABELS,
  normalizeChargedCraftTypes,
  getChargedCraftTypes,
  isChargedCraftType,
  chargedCraftTypesLabel,
  applyRemoteConfig,
  isCampaignActive,
  isFreeShippingCampaignActive: isCampaignActive,
  getCampaignLabel,
  resolveShippingKind,
  resolveThreshold,
  resolveOrderKind,
  calcShippingFee,
  calcShipping: calcShippingFee,
  getRuleText,
  getShippingRuleText: getRuleText,
  getHint,
  getShippingHint: getHint,
  getFeeLabel,
  getShippingFeeLabel: getFeeLabel,
  getCarrierLabel,
  estimateFreeShippingCouponSave: calcShippingFee
})
