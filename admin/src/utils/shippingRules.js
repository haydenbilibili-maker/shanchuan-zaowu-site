/**
 * 与小程序 cloudfunctions/getShippingRules/defaults.js 对齐。
 * 线上运费 SSOT：集合 shipping_rules。
 */

export const MIX_SPECIMEN_WINS = 'specimen_wins'
export const MIX_ACCESSORY_WINS = 'accessory_wins'
export const MIX_MAX_THRESHOLD = 'max_threshold'
export const VALID_MIX_STRATEGIES = [MIX_SPECIMEN_WINS, MIX_ACCESSORY_WINS, MIX_MAX_THRESHOLD]

export const MIX_LABELS = {
  [MIX_SPECIMEN_WINS]: '含标本用标本门槛（推荐）',
  [MIX_ACCESSORY_WINS]: '含标本仍用标本门槛（同推荐）',
  [MIX_MAX_THRESHOLD]: '取更高门槛'
}

function toNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function getDefaultShippingConfig() {
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
      label: '限时免费邮寄',
      startAt: '',
      endAt: ''
    }
  }
}

export function normalizeShippingConfig(raw) {
  const base = getDefaultShippingConfig()
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
  const carrier = String(src.defaultCarrier || src.carrier || base.defaultCarrier).trim() || base.defaultCarrier
  let mix = String(src.mixCartStrategy || base.mixCartStrategy).trim()
  if (!VALID_MIX_STRATEGIES.includes(mix)) mix = base.mixCartStrategy

  const camp = src.freeShippingCampaign && typeof src.freeShippingCampaign === 'object'
    ? src.freeShippingCampaign
    : {}

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
    freeShippingCampaign: {
      enabled: camp.enabled === true,
      label: String(camp.label || base.freeShippingCampaign.label).trim() || base.freeShippingCampaign.label,
      startAt: camp.startAt ? String(camp.startAt) : '',
      endAt: camp.endAt ? String(camp.endAt) : ''
    }
  }
}

function formatAmount(value) {
  const n = Number(value) || 0
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

export function describeShippingRule(config) {
  const cfg = normalizeShippingConfig(config)
  if (cfg.freeShippingCampaign.enabled) {
    return `${cfg.defaultCarrier} · ${cfg.freeShippingCampaign.label}（全场免邮）`
  }
  return `${cfg.defaultCarrier} · 饰品满 ¥${formatAmount(cfg.accessoryFreeThreshold)} / 标本满 ¥${formatAmount(cfg.specimenFreeThreshold)} 包邮，否则运费 ¥${formatAmount(cfg.flatFee)}`
}
