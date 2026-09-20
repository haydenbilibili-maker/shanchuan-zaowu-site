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

/**
 * **按装裱方式逐条配置的运费规则**（2026-09-21 产品负责人：
 * 「运费规则配置页面，根据最新的装裱方式进行重构 —— 支持对每一个装裱方式灵活配置对应的邮费规则；
 *   运费的前端展示不用写死字段，都用装裱方式的通配符」）。
 *
 * 结构：`{ craftType: <装裱方式 value 或 '*'> , freeShippingThreshold, flatFee }`
 *   · `craftType` = 具体值 → 该装裱方式**单独**一档；
 *   · `craftType` = `'*'`  → **通配符**：所有没在上面单独列出的装裱方式都走这一档
 *     （含 `craftType` 为空 / 未标注，以及后台通过「选项维护」新增的「塑封 / 玻璃瓶」等）。
 *
 * ⚠️ **必须有一条 `'*'`**：没有它，后台新加的装裱方式就没有规则可落 —— 这正是
 *    2026-09-20「选了塑封，说明里仍显示『其它』」那类问题的根。
 * ⚠️ **混合车**（一单里有多种装裱方式）：取适用规则里**门槛最高**的那一档，
 *    门槛相同取运费高者 —— 这是裁决 48-A（含相框/玻璃罩 → 按 ¥299/¥18 那一档）的推广。
 * ⚠️ 下面这份默认值**与裁决 48 完全等价**：相框/三种玻璃罩 → ¥299/¥18；其余（含未标注）→ ¥39/¥10。
 */
const DEFAULT_CRAFT_TYPE_RULES = [
  { craftType: 'frame', freeShippingThreshold: 299, flatFee: 18 },
  { craftType: 'cloche', freeShippingThreshold: 299, flatFee: 18 },
  { craftType: 'cloche_round', freeShippingThreshold: 299, flatFee: 18 },
  { craftType: 'cloche_cylinder', freeShippingThreshold: 299, flatFee: 18 },
  { craftType: '*', freeShippingThreshold: 39, flatFee: 10 }
]

/** 通配符 key（未单独列出的装裱方式都归它） */
const WILDCARD_CRAFT_TYPE = '*'

/**
 * 老文档（没有 `craftTypeRules`）→ 合成规则表，保证**行为逐字不变**：
 * 收费清单里的每一项 → ¥299/¥18；其余 → 通配符档 ¥39/¥10。
 */
function rulesFromLegacyConfig(cfg) {
  const src = cfg || {}
  const charged = Array.isArray(src.chargedCraftTypes) ? src.chargedCraftTypes : DEFAULT_CHARGED_CRAFT_TYPES
  const free = Number(src.freeShippingThreshold != null ? src.freeShippingThreshold : src.specimenFreeThreshold)
  const fee = Number(src.flatFee != null ? src.flatFee : src.shippingFee)
  const freeOther = Number(src.accessoryFreeThreshold)
  const feeOther = Number(src.accessoryFlatFee)
  return charged
    .map((ct) => ({ craftType: String(ct), freeShippingThreshold: free, flatFee: fee }))
    .concat([{ craftType: WILDCARD_CRAFT_TYPE, freeShippingThreshold: freeOther, flatFee: feeOther }])
}

/** 规则表 → 旧字段镜像（`chargedCraftTypes` 等仍被既有读者使用，保持自洽） */
function legacyMirrorFromRules(rules) {
  const list = Array.isArray(rules) && rules.length ? rules : DEFAULT_CRAFT_TYPE_RULES
  const explicit = list.filter((r) => r.craftType !== WILDCARD_CRAFT_TYPE)
  const wildcard = list.find((r) => r.craftType === WILDCARD_CRAFT_TYPE) || DEFAULT_CRAFT_TYPE_RULES[DEFAULT_CRAFT_TYPE_RULES.length - 1]
  // 旧模型只能表达"一个收费档"，取**门槛最高**的显式规则（= 混合车口径，也 = 默认时的 ¥299/¥18）
  const top = explicit.slice().sort((a, b) => (b.freeShippingThreshold - a.freeShippingThreshold) || (b.flatFee - a.flatFee))[0] || wildcard
  return {
    chargedCraftTypes: explicit.map((r) => r.craftType),
    freeShippingThreshold: Number(top.freeShippingThreshold) || 0,
    flatFee: Number(top.flatFee) || 0,
    accessoryFreeThreshold: Number(wildcard.freeShippingThreshold) || 0,
    accessoryFlatFee: Number(wildcard.flatFee) || 0
  }
}

/** 通配符规则（兜底档：未单独列出的装裱方式 / 未标注 / 显式 accessory 都走它） */
function wildcardRuleOf (rules) {
  const list = Array.isArray(rules) && rules.length ? rules : DEFAULT_CRAFT_TYPE_RULES
  return list.find((r) => r.craftType === WILDCARD_CRAFT_TYPE) || list[list.length - 1]
}

/** 显式规则里门槛最高的那条（= 旧模型里"收费类那一档"，也是显式 specimen 的落点） */
function topExplicitRuleOf (rules) {
  const list = (Array.isArray(rules) && rules.length ? rules : DEFAULT_CRAFT_TYPE_RULES)
    .filter((r) => r.craftType !== WILDCARD_CRAFT_TYPE)
  return list.slice().sort((a, b) => (b.freeShippingThreshold - a.freeShippingThreshold) || (b.flatFee - a.flatFee))[0] || wildcardRuleOf(rules)
}

/**
 * 单件商品落到哪条规则。
 * 判定顺序与 `resolveShippingKind` **完全一致**（不可换位）：
 *   ① 显式 `shippingKind` 覆盖 → accessory 走通配符档 / specimen 走门槛最高的显式档；
 *   ② `craftType` **精确匹配**某条规则 → 用它；
 *   ③ 都没命中 → **通配符档**（含未标注、以及后台新增的装裱方式）。
 */
function ruleForItem (item, rules) {
  const list = Array.isArray(rules) && rules.length ? rules : DEFAULT_CRAFT_TYPE_RULES
  if (!item || typeof item !== 'object') return wildcardRuleOf(list)
  const explicit = normalizeExplicitKind(item.shippingKind || item.shippingGroup || item.goodsKind || item.kind)
  if (explicit === SHIPPING_KIND.ACCESSORY) return wildcardRuleOf(list)
  if (explicit === SHIPPING_KIND.SPECIMEN) return topExplicitRuleOf(list)
  const key = String(item.craftType == null ? '' : item.craftType).trim().toLowerCase()
  const hit = key ? list.find((r) => r.craftType === key) : null
  return hit || wildcardRuleOf(list)
}

/**
 * 本单适用的规则（**混合车**：取适用规则里门槛最高的一档，门槛相同取运费高者）。
 * 这是裁决 48-A（含相框/玻璃罩 → 按 ¥299/¥18 那一档）在"逐装裱方式配置"下的推广。
 * 返回 null 表示"上下文为空/无法判定" → 调用方走旧的单档逻辑。
 */
function pickRuleForContext (context, rules) {
  const list = Array.isArray(rules) && rules.length ? rules : DEFAULT_CRAFT_TYPE_RULES
  const items = (() => {
    if (context == null) return null
    if (Array.isArray(context)) return context
    if (typeof context === 'object' && Array.isArray(context.items)) return context.items
    if (typeof context === 'object') return [context]
    return null
  })()
  if (!items || !items.length) return null
  const picked = items.map((it) => ruleForItem(it, list))
  return picked.slice().sort((a, b) => (b.freeShippingThreshold - a.freeShippingThreshold) || (b.flatFee - a.flatFee))[0]
}

/** 归一化规则表（保存侧与读取侧同一口径）：丢掉非法项、去重、**必须留一条通配符** */
function normalizeCraftTypeRules (raw) {
  if (!Array.isArray(raw)) return null
  const out = []
  const seen = {}
  raw.forEach((r) => {
    if (!r || typeof r !== 'object') return
    let key = String(r.craftType == null ? '' : r.craftType).trim().toLowerCase()
    if (!key) return
    if (key !== WILDCARD_CRAFT_TYPE && VALID_CRAFT_TYPES.indexOf(key) === -1) return
    if (seen[key]) return
    seen[key] = true
    out.push({
      craftType: key,
      freeShippingThreshold: Math.max(0, toNumber(r.freeShippingThreshold, 0)),
      flatFee: Math.max(0, toNumber(r.flatFee, 0))
    })
  })
  if (!seen[WILDCARD_CRAFT_TYPE]) return null   // 没有通配符 = 新装裱方式没有规则可落，视为无效配置
  return out
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
    /** 逐装裱方式的规则表（唯一判定依据；旧字段只是镜像，见 DEFAULT_CRAFT_TYPE_RULES） */
    craftTypeRules: DEFAULT_CRAFT_TYPE_RULES.map((r) => ({ ...r })),
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
    // 规则表：云端带就用它，没有就按刚读进来的旧字段合成（行为逐字不变），再镜像回旧字段
    craftTypeRules: normalizeCraftTypeRules(src.craftTypeRules) || rulesFromLegacyConfig({
      chargedCraftTypes: charged,
      freeShippingThreshold: free,
      flatFee,
      accessoryFreeThreshold: freeOther,
      accessoryFlatFee: feeOther
    }),
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
  DEFAULT_CRAFT_TYPE_RULES,
  normalizeCraftTypeRules,
  pickRuleForContext,
  describeRule,
  toClientShape,
  formatAmount
}
