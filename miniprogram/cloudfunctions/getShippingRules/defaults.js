/**
 * 商城运费规则 — 代码默认值（云端集合 shipping_rules 可覆盖）
 * 与 config/shipping.js、makeOrder/shipping.js 保持字段语义一致。
 *
 * mixCartStrategy:
 *   specimen_wins — 混合车含任一标本 → 用标本门槛（默认）
 *   accessory_wins — 含任一饰品且无标本才用饰品门槛（与 specimen_wins 在「有标本」时等价）
 *   max_threshold — 取更高门槛
 */

const MIX_SPECIMEN_WINS = 'specimen_wins'
const MIX_ACCESSORY_WINS = 'accessory_wins'
const MIX_MAX_THRESHOLD = 'max_threshold'
const VALID_MIX_STRATEGIES = [MIX_SPECIMEN_WINS, MIX_ACCESSORY_WINS, MIX_MAX_THRESHOLD]

function getDefaultConfig() {
  return {
    ruleId: 'shipping_default_v1',
    name: '商城运费规则',
    status: 'active',
    priority: 100,
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
}

function toNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
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
 * 兼容旧字段：shippingFee / carrier / thresholds / freeShippingThreshold
 */
function normalizeConfig(raw) {
  const base = getDefaultConfig()
  const src = raw && typeof raw === 'object' ? raw : {}
  const thresholds = src.thresholds && typeof src.thresholds === 'object' ? src.thresholds : {}

  const accessory = toNumber(
    src.accessoryFreeThreshold != null ? src.accessoryFreeThreshold : thresholds.accessory,
    base.accessoryFreeThreshold
  )
  const specimen = toNumber(
    src.specimenFreeThreshold != null
      ? src.specimenFreeThreshold
      : (thresholds.specimen != null ? thresholds.specimen : src.freeShippingThreshold),
    base.specimenFreeThreshold
  )
  const flatFee = toNumber(
    src.flatFee != null ? src.flatFee : src.shippingFee,
    base.flatFee
  )
  const carrier = String(
    src.defaultCarrier || src.carrier || base.defaultCarrier
  ).trim() || base.defaultCarrier

  let mix = String(src.mixCartStrategy || base.mixCartStrategy).trim()
  if (VALID_MIX_STRATEGIES.indexOf(mix) === -1) mix = base.mixCartStrategy

  return {
    ruleId: String(src.ruleId || base.ruleId),
    name: String(src.name || base.name).trim() || base.name,
    status: src.status === 'inactive' ? 'inactive' : 'active',
    priority: Math.max(0, Math.floor(toNumber(src.priority, base.priority))),
    defaultCarrier: carrier,
    flatFee: Math.max(0, flatFee),
    accessoryFreeThreshold: Math.max(0, accessory),
    specimenFreeThreshold: Math.max(0, specimen),
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
  return `${cfg.defaultCarrier} · 饰品满 ¥${formatAmount(cfg.accessoryFreeThreshold)} / 标本满 ¥${formatAmount(cfg.specimenFreeThreshold)} 包邮，否则运费 ¥${formatAmount(cfg.flatFee)}`
}

/** 客户端 / makeOrder 兼容视图 */
function toClientShape(config) {
  const cfg = normalizeConfig(config)
  return {
    ...cfg,
    carrier: cfg.defaultCarrier,
    shippingFee: cfg.flatFee,
    freeShippingThreshold: cfg.specimenFreeThreshold,
    thresholds: {
      accessory: cfg.accessoryFreeThreshold,
      specimen: cfg.specimenFreeThreshold
    }
  }
}

module.exports = {
  MIX_SPECIMEN_WINS,
  MIX_ACCESSORY_WINS,
  MIX_MAX_THRESHOLD,
  VALID_MIX_STRATEGIES,
  getDefaultConfig,
  normalizeConfig,
  describeRule,
  toClientShape,
  formatAmount
}
