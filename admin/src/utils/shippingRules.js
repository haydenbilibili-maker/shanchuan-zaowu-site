/**
 * 与小程序 cloudfunctions/getShippingRules/defaults.js 对齐。
 * 线上运费 SSOT：集合 shipping_rules。
 *
 * 口径 v2（2026-09-19，蓝图 §19 裁决 40/41/41b/41c）：**按「装裱方式」craftType 区分**
 *   收费类（chargedCraftTypes：相框 / 方形玻璃罩 / 圆形玻璃罩 / 圆柱形玻璃罩）
 *     → 订单**全场**满 ¥299 免邮，未满收 ¥18/单
 *   其余（含 craftType 为空）→ 一律免邮
 *
 * ⚠️ 本文件是 ERP 侧的手工平行副本：只改小程序不改这里，ERP「运费与包邮规则」页
 *    会用旧口径覆盖云端文档（`specimenFreeThreshold: 500`）→ 线上门槛被悄悄改回 500。
 *    一致性由 `npm run check:shipping-rules-sync` 守卫。
 */

/** 旧模型遗留常量（保留以免既有 import 断裂；v2 不再有混合车策略） */
export const MIX_SPECIMEN_WINS = 'specimen_wins'
export const MIX_ACCESSORY_WINS = 'accessory_wins'
export const MIX_MAX_THRESHOLD = 'max_threshold'
export const VALID_MIX_STRATEGIES = [MIX_SPECIMEN_WINS, MIX_ACCESSORY_WINS, MIX_MAX_THRESHOLD]

export const MIX_LABELS = {
  [MIX_SPECIMEN_WINS]: '含标本用标本门槛（旧口径，已废）',
  [MIX_ACCESSORY_WINS]: '含标本仍用标本门槛（旧口径，已废）',
  [MIX_MAX_THRESHOLD]: '取更高门槛（旧口径，已废）'
}

/** 收费类装裱方式默认清单（裁决 41 的四项） */
export const DEFAULT_CHARGED_CRAFT_TYPES = ['frame', 'cloche', 'cloche_round', 'cloche_cylinder']

/**
 * 允许出现在收费清单里的 craftType key（与 config/productTaxonomy.js 的 CRAFT_TYPE_OPTIONS 同源）。
 * 由 `npm run check:shipping-rules-sync` 守卫钉住。
 */
export const VALID_CRAFT_TYPES = [
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

/**
 * **逐装裱方式的运费规则**（2026-09-21 产品负责人：运费规则配置页按最新装裱方式重构）。
 * `craftType: '*'` = 通配符档：所有未单独列出的装裱方式（含未标注、含后台新增的塑封/玻璃瓶）都走它。
 * ⚠️ 与小程序三份副本（config/shipping.js、makeOrder/shipping.js、getShippingRules/defaults.js）
 *    的 `DEFAULT_CRAFT_TYPE_RULES` **逐字一致**，由 `npm run check:shipping-rules` 守卫钉住。
 */
export const WILDCARD_CRAFT_TYPE = '*'

export const DEFAULT_CRAFT_TYPE_RULES = [
  { craftType: 'frame', freeShippingThreshold: 299, flatFee: 18 },
  { craftType: 'cloche', freeShippingThreshold: 299, flatFee: 18 },
  { craftType: 'cloche_round', freeShippingThreshold: 299, flatFee: 18 },
  { craftType: 'cloche_cylinder', freeShippingThreshold: 299, flatFee: 18 },
  { craftType: '*', freeShippingThreshold: 39, flatFee: 10 }
]

export const CRAFT_TYPE_LABELS = {
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

/** 老文档 → 合成规则表（与小程序 rulesFromLegacyConfig 同口径） */
export function legacyRules(cfg) {
  const src = cfg || {}
  const charged = Array.isArray(src.chargedCraftTypes) && src.chargedCraftTypes.length
    ? src.chargedCraftTypes
    : DEFAULT_CHARGED_CRAFT_TYPES
  return charged
    .map((ct) => ({
      craftType: String(ct),
      freeShippingThreshold: Number(src.freeShippingThreshold) || 0,
      flatFee: Number(src.flatFee) || 0
    }))
    .concat([{
      craftType: WILDCARD_CRAFT_TYPE,
      freeShippingThreshold: Number(src.accessoryFreeThreshold) || 0,
      flatFee: Number(src.accessoryFlatFee) || 0
    }])
}

/** 归一化规则表：丢非法项、去重、**必须留一条通配符**（否则返回 null = 视为缺失） */
export function normalizeCraftTypeRules(raw) {
  if (!Array.isArray(raw)) return null
  const out = []
  const seen = {}
  raw.forEach((r) => {
    if (!r || typeof r !== 'object') return
    const key = String(r.craftType == null ? '' : r.craftType).trim().toLowerCase()
    if (!key || seen[key]) return
    if (key !== WILDCARD_CRAFT_TYPE && !VALID_CRAFT_TYPES.includes(key)) return
    seen[key] = true
    out.push({
      craftType: key,
      freeShippingThreshold: Math.max(0, toNumber(r.freeShippingThreshold, 0)),
      flatFee: Math.max(0, toNumber(r.flatFee, 0))
    })
  })
  if (!seen[WILDCARD_CRAFT_TYPE]) return null
  return out
}

/** 规则表 → 旧字段镜像（与小程序 legacyMirrorFromRules 同口径） */
export function legacyMirrorFromRules(rules) {
  const list = Array.isArray(rules) && rules.length ? rules : DEFAULT_CRAFT_TYPE_RULES
  const explicit = list.filter((r) => r.craftType !== WILDCARD_CRAFT_TYPE)
  const wildcard = list.find((r) => r.craftType === WILDCARD_CRAFT_TYPE) || DEFAULT_CRAFT_TYPE_RULES[DEFAULT_CRAFT_TYPE_RULES.length - 1]
  const top = explicit.slice().sort((a, b) => (b.freeShippingThreshold - a.freeShippingThreshold) || (b.flatFee - a.flatFee))[0] || wildcard
  return {
    chargedCraftTypes: explicit.map((r) => r.craftType),
    freeShippingThreshold: Number(top.freeShippingThreshold) || 0,
    flatFee: Number(top.flatFee) || 0,
    accessoryFreeThreshold: Number(wildcard.freeShippingThreshold) || 0,
    accessoryFlatFee: Number(wildcard.flatFee) || 0
  }
}

function toNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** 清洗收费清单：非数组 → null（视为缺失）；空数组 → null；未知 key 丢弃 */
export function normalizeChargedCraftTypes(raw) {
  if (!Array.isArray(raw)) return null
  const out = []
  raw.forEach((v) => {
    const key = String(v == null ? '' : v).trim().toLowerCase()
    if (!key || out.includes(key)) return
    if (!VALID_CRAFT_TYPES.includes(key)) return
    out.push(key)
  })
  return out.length ? out : null
}

export function chargedCraftTypesLabel(chargedCraftTypes) {
  const list = Array.isArray(chargedCraftTypes) && chargedCraftTypes.length
    ? chargedCraftTypes
    : DEFAULT_CHARGED_CRAFT_TYPES
  return list.map((k) => CRAFT_TYPE_LABELS[k] || k).join('/')
}

export function getDefaultShippingConfig() {
  return {
    ruleId: 'shipping_default_v2',
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
    /** 逐装裱方式规则表（唯一判定依据；旧字段只是镜像） */
    craftTypeRules: DEFAULT_CRAFT_TYPE_RULES.map((r) => ({ ...r })),
    // —— 旧模型字段（仅作兼容镜像；判定逻辑不读，见蓝图 §19）——
    specimenFreeThreshold: 299,
    mixCartStrategy: MIX_SPECIMEN_WINS,
    freeShippingCampaign: {
      enabled: false,
      // 与云函数 getShippingRules/defaults.js、makeOrder/shipping.js 及
      // 小程序 config/shipping.js 的默认文案保持一致（2026-09-17 审计 E-运费文案三方不一致）
      label: '当前全场免邮',
      startAt: '',
      endAt: ''
    }
  }
}

export function normalizeShippingConfig(raw) {
  const base = getDefaultShippingConfig()
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
  // 其它类型门槛/费率（裁决 48）
  const freeOther = Math.max(0, toNumber(
    src.accessoryFreeThreshold != null ? src.accessoryFreeThreshold : thresholds.accessory,
    base.accessoryFreeThreshold
  ))
  const feeOther = Math.max(0, toNumber(
    src.accessoryFlatFee != null
      ? src.accessoryFlatFee
      : (src.accessoryShippingFee != null ? src.accessoryShippingFee : (src.fees && src.fees.accessory)),
    base.accessoryFlatFee
  ))
  const carrier = String(src.defaultCarrier || src.carrier || base.defaultCarrier).trim() || base.defaultCarrier
  let mix = String(src.mixCartStrategy || base.mixCartStrategy).trim()
  if (!VALID_MIX_STRATEGIES.includes(mix)) mix = base.mixCartStrategy

  const charged = normalizeChargedCraftTypes(src.chargedCraftTypes) || base.chargedCraftTypes.slice()

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
    freeShippingThreshold: free,
    accessoryFreeThreshold: freeOther,
    accessoryFlatFee: feeOther,
    chargedCraftTypes: charged,
    // 规则表：带就用它；没有就按刚读进来的旧字段合成（行为逐字不变），再镜像回旧字段
    craftTypeRules: normalizeCraftTypeRules(src.craftTypeRules) || legacyRules({
      chargedCraftTypes: charged,
      freeShippingThreshold: free,
      flatFee,
      accessoryFreeThreshold: freeOther,
      accessoryFlatFee: feeOther
    }),
    // 兼容镜像：保持自洽，避免 ERP 其他读者拿到旧值
    specimenFreeThreshold: free,
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
  const charged = chargedCraftTypesLabel(cfg.chargedCraftTypes)
  // 前缀取装裱方式字段（chargedCraftTypesLabel 动态渲染），不写"全场"
  return `${cfg.defaultCarrier} · ${charged}类商品满 ¥${formatAmount(cfg.freeShippingThreshold)} 免邮`
    + `（否则 ¥${formatAmount(cfg.flatFee)}/单）；其它类型商品满 ¥${formatAmount(cfg.accessoryFreeThreshold)} 免邮`
    + `（否则 ¥${formatAmount(cfg.accessoryFlatFee)}/单）`
}
