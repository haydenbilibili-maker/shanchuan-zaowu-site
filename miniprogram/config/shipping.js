/**
 * 商城运费配置
 *
 * 代码 defaults 与云库 shipping_rules / getShippingRules 对齐。
 * C 端通过 utils/shippingRulesSync 拉取云配置后调用 applyRemoteConfig。
 *
 * 规则（2026-09 defaults）：
 * 1. 默认承运商：顺丰速运
 * 2. 包邮门槛按品类：饰品满 200 / 标本满 500
 * 3. 未达门槛：运费统一 ¥18
 * 4. 混合购物车：整单含任一标本 → 用标本门槛 500；纯饰品 → 用饰品门槛 200
 * 5. 限时免邮：freeShippingCampaign.enabled = true 时全场免邮
 */

const SHIPPING_KIND = {
  ACCESSORY: 'accessory',
  SPECIMEN: 'specimen'
}

const MIX_SPECIMEN_WINS = 'specimen_wins'
const MIX_ACCESSORY_WINS = 'accessory_wins'
const MIX_MAX_THRESHOLD = 'max_threshold'

const shipping = {
  defaultCarrier: '顺丰速运',
  carrier: '顺丰速运',
  shippingFee: 18,
  flatFee: 18,
  accessoryFreeThreshold: 0,
  specimenFreeThreshold: 299,
  thresholds: {
    accessory: 200,
    specimen: 500
  },
  mixCartStrategy: MIX_SPECIMEN_WINS,
  freeShippingThreshold: 299,
  freeShippingCampaign: {
    enabled: false,
    label: '当前全场免邮'
  },
  _fromRemote: false
}

const ACCESSORY_CATEGORY_RE = /衍生|文创|饰品|周边|礼品|陈饰|包装|联名/
const ACCESSORY_TITLE_RE = /饰品|首饰|项链|手链|手环|耳环|耳钉|戒指|胸针|吊坠|徽章|冰箱贴/
const SPECIMEN_TITLE_RE = /标本|相框|玻璃罩|造景|框画/

/**
 * 2026-09-19 裁决 40/41：**C 端运费只按「装裱方式」craftType 区分**。
 * 收费类 = 相框 + 三种玻璃罩；其余（含**未标注**、造景/饰品/蝶翅画/冰箱贴/其它）一律免邮。
 */
const CHARGED_CRAFT_TYPES = ['frame', 'cloche', 'cloche_round', 'cloche_cylinder']

function toNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 用云端配置覆盖本地 defaults（失败时保留 defaults）
 */
function applyRemoteConfig(raw) {
  if (!raw || typeof raw !== 'object') return shipping
  const thresholds = raw.thresholds && typeof raw.thresholds === 'object' ? raw.thresholds : {}

  const accessory = toNumber(
    raw.accessoryFreeThreshold != null ? raw.accessoryFreeThreshold : thresholds.accessory,
    shipping.thresholds.accessory
  )
  const specimen = toNumber(
    raw.specimenFreeThreshold != null
      ? raw.specimenFreeThreshold
      : (thresholds.specimen != null ? thresholds.specimen : raw.freeShippingThreshold),
    shipping.thresholds.specimen
  )
  const flatFee = Math.max(
    0,
    toNumber(raw.flatFee != null ? raw.flatFee : raw.shippingFee, shipping.shippingFee)
  )
  const carrier = String(raw.defaultCarrier || raw.carrier || shipping.defaultCarrier).trim()
    || shipping.defaultCarrier

  let mix = String(raw.mixCartStrategy || MIX_SPECIMEN_WINS).trim()
  if (mix !== MIX_ACCESSORY_WINS && mix !== MIX_MAX_THRESHOLD) mix = MIX_SPECIMEN_WINS

  shipping.defaultCarrier = carrier
  shipping.carrier = carrier
  shipping.shippingFee = flatFee
  shipping.flatFee = flatFee
  shipping.accessoryFreeThreshold = Math.max(0, accessory)
  shipping.specimenFreeThreshold = Math.max(0, specimen)
  shipping.thresholds.accessory = Math.max(0, accessory)
  shipping.thresholds.specimen = Math.max(0, specimen)
  shipping.freeShippingThreshold = Math.max(0, specimen)
  shipping.mixCartStrategy = mix

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

  /**
   * ⚠️ **这一段必须放在下面 categoryType 短路口之前** ——
   * `categoryType === 'specimen'` 会直接 return，插在它后面则 craftType 永远轮不到说话
   * （表面改了、行为没变，而且门禁发现不了）。
   *
   * ⚠️ 未命中收费清单的**一律免邮**（含 craftType 为空 = 裁决 41b 的未标注）。
   * 不能写成「有 craftType 才按它判」—— 那样未标注的标本会掉回 categoryType 短路，被判成收费类。
   */
  const craft = String(product.craftType || '').trim()
  if (CHARGED_CRAFT_TYPES.includes(craft)) return SHIPPING_KIND.SPECIMEN
  return SHIPPING_KIND.ACCESSORY

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
  const accessory = shipping.thresholds.accessory
  const specimen = shipping.thresholds.specimen

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
    if (shipping.mixCartStrategy === MIX_MAX_THRESHOLD) {
      return Math.max(accessory, specimen)
    }
    // specimen_wins / accessory_wins：有标本用标本门槛
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

function resolveOrderKind(context) {
  const threshold = resolveThreshold(context)
  return threshold <= shipping.thresholds.accessory
    ? SHIPPING_KIND.ACCESSORY
    : SHIPPING_KIND.SPECIMEN
}

/**
 * @param {number} goodsAmount 优惠前商品合计（勿传折后应付）
 * @param {object|array|string|number} [context] 商品列表或品类上下文，用于选门槛
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
  const a = shipping.thresholds.accessory
  const s = shipping.thresholds.specimen
  const carrier = shipping.defaultCarrier || '顺丰速运'
  if (context != null) {
    const kind = Array.isArray(context)
      ? resolveOrderKind(context)
      : resolveShippingKind(context)
    if (kind === SHIPPING_KIND.ACCESSORY) {
      return `${carrier} · 饰品满 ¥${a} 包邮，否则运费 ¥${fee}`
    }
    if (Array.isArray(context) && context.some((i) => resolveShippingKind(i) === SHIPPING_KIND.ACCESSORY)) {
      return `${carrier} · 含藏品满 ¥${s} 包邮（纯饰品满 ¥${a}），否则运费 ¥${fee}`
    }
    return `${carrier} · 藏品满 ¥${s} 包邮，否则运费 ¥${fee}`
  }
  return `${carrier} · 饰品满 ¥${a} / 藏品满 ¥${s} 包邮，否则运费 ¥${fee}`
}

function getHint(price, context) {
  if (isCampaignActive()) return getCampaignLabel()
  const amount = parseFloat(price) || 0
  const threshold = resolveThreshold(context)
  const kind = resolveOrderKind(context)
  const kindLabel = kind === SHIPPING_KIND.ACCESSORY ? '饰品' : '藏品'
  const carrierShort = (shipping.defaultCarrier || '顺丰').replace(/速运$/, '')
  if (amount >= threshold) {
    return `本单享包邮 · ${carrierShort}（${kindLabel}满 ¥${threshold}）`
  }
  const fee = calcShippingFee(amount, context)
  return `本单运费 ¥${fee} · ${carrierShort}（${kindLabel}满 ¥${threshold} 包邮）`
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
