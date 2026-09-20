/**
 * 商城运费规则 — 代码默认值（云端集合 shipping_rules 可覆盖）
 * 与 `config/shipping.js`（C 端展示）、`makeOrder/shipping.js`（服务端权威）保持字段语义一致。
 *
 * 口径：`admin/docs/出货算价与工作室结算_Phase1_技术蓝图.md` §19（v1.7，裁决 40/41/41b/41c）
 *   收费类（chargedCraftTypes：相框 / 方形玻璃罩 / 圆形玻璃罩 / 圆柱形玻璃罩）
 *     → 订单**全场**满 ¥299 免邮，未满收 ¥18/单
 *   其它类型（含 craftType 为空）→ 订单**全场**满 ¥39 免邮，未满收 ¥10/单（裁决 48）
 *   混合车（含任一收费类）→ 按收费类那一档（全场满 ¥299，否则 ¥18）
 *
 * ⚠️ 判定只看 `craftType`，不看标题/类别。
 * ⚠️ 收费清单**不允许为空**：空清单 = 全场免邮，属危险配置，保存侧直接拒绝；
 *    本文件 normalize 时也会把空清单退回默认值（绝不静默变成全场免邮）。
 */

const MIX_SPECIMEN_WINS = 'specimen_wins'
const MIX_ACCESSORY_WINS = 'accessory_wins'
const MIX_MAX_THRESHOLD = 'max_threshold'
const VALID_MIX_STRATEGIES = [MIX_SPECIMEN_WINS, MIX_ACCESSORY_WINS, MIX_MAX_THRESHOLD]

/** 收费类装裱方式默认清单（= 产品负责人裁决 41 的四项） */
const DEFAULT_CHARGED_CRAFT_TYPES = ['frame', 'cloche', 'cloche_round', 'cloche_cylinder']

/**
 * 允许出现在收费清单里的 `craftType` key。
 * 与 `miniprogram/config/productTaxonomy.js` 的 `CRAFT_TYPE_OPTIONS` 同源 ——
 * 由 `npm run check:shipping-rules-sync` 守卫钉住（复制粘贴漂移会红）。
 */
const VALID_CRAFT_TYPES = [
  'frame',
  'cloche',
  'cloche_round',
  'cloche_cylinder',
  'diorama',
  'magnet',
  'accessory',
  'wing_art',
  'other'
]

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

function getDefaultConfig() {
  return {
    ruleId: 'shipping_default_v3',
    name: '商城运费规则',
    status: 'active',
    priority: 100,
    defaultCarrier: '顺丰速运',
    flatFee: 18,
    freeShippingThreshold: 299,
    /** 其它类型的全场包邮门槛（裁决 48） */
    accessoryFreeThreshold: 39,
    /** 其它类型的单次运费（裁决 48：¥10） */
    accessoryFlatFee: 10,
    chargedCraftTypes: DEFAULT_CHARGED_CRAFT_TYPES.slice(),
    // —— 兼容镜像（判定逻辑读上面的字段）——
    specimenFreeThreshold: 299,
    mixCartStrategy: MIX_SPECIMEN_WINS,
    freeShippingCampaign: {
      enabled: false,
      label: '当前全场免邮',
      startAt: '',
      endAt: ''
    }
  }
}

function toNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** 清洗收费清单：非数组 → null（视为缺失）；空数组 → null；未知 key 丢弃 */
function normalizeChargedCraftTypes(raw) {
  if (!Array.isArray(raw)) return null
  const out = []
  raw.forEach((v) => {
    const key = String(v == null ? '' : v).trim().toLowerCase()
    if (!key || out.indexOf(key) !== -1) return
    if (VALID_CRAFT_TYPES.indexOf(key) === -1) return
    out.push(key)
  })
  return out.length ? out : null
}

/** 收费类中文清单（摘要文案用） */
function chargedCraftTypesLabel(chargedCraftTypes) {
  const list = Array.isArray(chargedCraftTypes) && chargedCraftTypes.length
    ? chargedCraftTypes
    : DEFAULT_CHARGED_CRAFT_TYPES
  return list.map((k) => CRAFT_TYPE_LABELS[k] || k).join('/')
}

function normalizeCampaign(raw, base) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: src.enabled === true,
    label: String(src.label || base.label || '当前全场免邮').trim() || '当前全场免邮',
    startAt: src.startAt ? String(src.startAt) : '',
    endAt: src.endAt ? String(src.endAt) : ''
  }
}

/**
 * 兼容旧字段：shippingFee / carrier / thresholds / specimenFreeThreshold / freeShippingThreshold
 */
function normalizeConfig(raw) {
  const base = getDefaultConfig()
  const src = raw && typeof raw === 'object' ? raw : {}
  const thresholds = src.thresholds && typeof src.thresholds === 'object' ? src.thresholds : {}

  // 兼容读取链：freeShippingThreshold（新） → specimenFreeThreshold（旧） → thresholds.specimen
  const rawFree = src.freeShippingThreshold != null
    ? src.freeShippingThreshold
    : (src.specimenFreeThreshold != null ? src.specimenFreeThreshold : thresholds.specimen)
  const free = Math.max(0, toNumber(rawFree, base.freeShippingThreshold))

  const flatFee = toNumber(
    src.flatFee != null ? src.flatFee : src.shippingFee,
    base.flatFee
  )
  // 其它类型门槛/费率（裁决 48）：各自独立，都可被云端覆盖
  const rawFreeOther = src.accessoryFreeThreshold != null
    ? src.accessoryFreeThreshold
    : thresholds.accessory
  const freeOther = Math.max(0, toNumber(rawFreeOther, base.accessoryFreeThreshold))
  const feeOther = Math.max(0, toNumber(
    src.accessoryFlatFee != null
      ? src.accessoryFlatFee
      : (src.accessoryShippingFee != null ? src.accessoryShippingFee : (src.fees && src.fees.accessory)),
    base.accessoryFlatFee
  ))
  const carrier = String(
    src.defaultCarrier || src.carrier || base.defaultCarrier
  ).trim() || base.defaultCarrier

  const charged = normalizeChargedCraftTypes(src.chargedCraftTypes) || base.chargedCraftTypes.slice()

  let mix = String(src.mixCartStrategy || base.mixCartStrategy).trim()
  if (VALID_MIX_STRATEGIES.indexOf(mix) === -1) mix = base.mixCartStrategy

  return {
    ruleId: String(src.ruleId || base.ruleId),
    name: String(src.name || base.name).trim() || base.name,
    status: src.status === 'inactive' ? 'inactive' : 'active',
    priority: Math.max(0, Math.floor(toNumber(src.priority, base.priority))),
    defaultCarrier: carrier,
    flatFee: Math.max(0, flatFee),
    freeShippingThreshold: free,
    accessoryFreeThreshold: freeOther,
    accessoryFlatFee: feeOther,
    chargedCraftTypes: charged,
    // 兼容镜像：保持自洽，避免仍按旧字段读取的调用方拿到旧值
    specimenFreeThreshold: free,
    mixCartStrategy: mix,
    freeShippingCampaign: normalizeCampaign(src.freeShippingCampaign, base.freeShippingCampaign)
  }
}

function formatAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

function describeRule(config) {
  const cfg = normalizeConfig(config)
  if (cfg.freeShippingCampaign && cfg.freeShippingCampaign.enabled) {
    return `${cfg.defaultCarrier} · ${cfg.freeShippingCampaign.label}（全场免邮）`
  }
  const charged = chargedCraftTypesLabel(cfg.chargedCraftTypes)
  // 前缀取装裱方式字段（chargedCraftTypesLabel 动态渲染），不写"全场"
  return `${cfg.defaultCarrier} · ${charged}类商品满 ¥${formatAmount(cfg.freeShippingThreshold)} 免邮`
    + `（否则 ¥${formatAmount(cfg.flatFee)}/单）；其它类型商品满 ¥${formatAmount(cfg.accessoryFreeThreshold)} 免邮`
    + `（否则 ¥${formatAmount(cfg.accessoryFlatFee)}/单）`
}

/** 客户端 / makeOrder 兼容视图 */
function toClientShape(config) {
  const cfg = normalizeConfig(config)
  return {
    ...cfg,
    carrier: cfg.defaultCarrier,
    shippingFee: cfg.flatFee,
    freeShippingThreshold: cfg.freeShippingThreshold,
    // 兼容镜像：其它档门槛也要跟真实值走（写死 0 会让仍读它的老读者以为"其它类型永远免邮"）
    thresholds: {
      accessory: cfg.accessoryFreeThreshold,
      specimen: cfg.freeShippingThreshold
    }
  }
}

module.exports = {
  MIX_SPECIMEN_WINS,
  MIX_ACCESSORY_WINS,
  MIX_MAX_THRESHOLD,
  VALID_MIX_STRATEGIES,
  DEFAULT_CHARGED_CRAFT_TYPES,
  VALID_CRAFT_TYPES,
  CRAFT_TYPE_LABELS,
  getDefaultConfig,
  normalizeChargedCraftTypes,
  chargedCraftTypesLabel,
  normalizeConfig,
  describeRule,
  toClientShape,
  formatAmount
}
