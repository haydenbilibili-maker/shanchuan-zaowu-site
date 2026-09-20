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
/** 允许出现在规则表里的 craftType（与 config/productTaxonomy.js 的 CRAFT_TYPE_OPTIONS 同源；
 *  由 `npm run check:shipping-rules` / `check:shipping-rules-sync` 守卫钉住） */
const VALID_CRAFT_TYPES = [
  'frame', 'cloche', 'cloche_round', 'cloche_cylinder',
  'diorama', 'magnet', 'accessory', 'wing_art', 'other'
]

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

/**
 * 面向顾客的**短标签**：详情页/确认页的「说明」行只有一行宽度，
 * 枚举四个装裱方式（相框/方形玻璃罩/圆形玻璃罩/圆柱形玻璃罩）必然溢出（2026-09-20 真机截图）。
 * 故顾客侧统一用这个短名；**后台/云端的 ruleText 仍用完整枚举**（管理端要看清到底哪几类收费）。
 * ⚠️ 若以后收费清单增删了**语义不同的**类型，改这一个常量即可。
 */
const CHARGED_GROUP_LABEL = '玻璃罩/标本框'

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
  /** 收费类（相框/玻璃罩）的全场包邮门槛 */
  freeShippingThreshold: 299,
  /** 其它类型（含未标注装裱方式）的全场包邮门槛（裁决 48） */
  accessoryFreeThreshold: 39,
  /** 其它类型的单次运费（裁决 48：¥10，与收费类的 ¥18 不同） */
  accessoryFlatFee: 10,
  /** 收费类装裱方式清单（可被云端覆盖）——**旧字段镜像**，判定已改读 craftTypeRules */
  chargedCraftTypes: DEFAULT_CHARGED_CRAFT_TYPES.slice(),
  /** 逐装裱方式的规则表（唯一判定依据；见 DEFAULT_CRAFT_TYPE_RULES） */
  craftTypeRules: DEFAULT_CRAFT_TYPE_RULES.map((r) => ({ ...r })),
  /**
   * 兼容镜像（判定逻辑读上面的 `accessoryFreeThreshold`）：
   * `specimenFreeThreshold` 是收费类门槛的旧名，保持同值以免仍读它的调用方拿到旧值。
   */
  specimenFreeThreshold: 299,
  thresholds: {
    accessory: 39,
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

  // 其它类型门槛/费率（裁决 48）：与收费类各自独立，都跟云端走
  const freeOther = Math.max(0, toNumber(
    raw.accessoryFreeThreshold != null ? raw.accessoryFreeThreshold : thresholds.accessory,
    shipping.accessoryFreeThreshold
  ))
  const feeOther = Math.max(0, toNumber(
    raw.accessoryFlatFee != null
      ? raw.accessoryFlatFee
      : (raw.accessoryShippingFee != null ? raw.accessoryShippingFee : (raw.fees && raw.fees.accessory)),
    shipping.accessoryFlatFee
  ))

  const charged = normalizeChargedCraftTypes(raw.chargedCraftTypes)

  shipping.defaultCarrier = carrier
  shipping.carrier = carrier
  shipping.shippingFee = flatFee
  shipping.flatFee = flatFee
  shipping.freeShippingThreshold = free
  shipping.accessoryFreeThreshold = freeOther
  shipping.accessoryFlatFee = feeOther
  /* 规则表：云端带 `craftTypeRules` 就用它；没有 → 用**刚读进来的旧字段**合成（行为逐字不变）。
   * 再反过来把旧字段按规则表镜像一遍，保证"判定读规则表、旧读者读旧字段"两个口径一致。 */
  const rules = normalizeCraftTypeRules(raw.craftTypeRules) || rulesFromLegacyConfig({
    chargedCraftTypes: charged && charged.length ? charged : shipping.chargedCraftTypes,
    freeShippingThreshold: free,
    flatFee,
    accessoryFreeThreshold: freeOther,
    accessoryFlatFee: feeOther
  })
  shipping.craftTypeRules = rules
  const mirror = legacyMirrorFromRules(rules)
  if (mirror.chargedCraftTypes.length) shipping.chargedCraftTypes = mirror.chargedCraftTypes
  const freeMirror = mirror.freeShippingThreshold
  const feeMirror = mirror.flatFee
  shipping.freeShippingThreshold = freeMirror
  shipping.shippingFee = feeMirror
  shipping.flatFee = feeMirror
  shipping.accessoryFreeThreshold = mirror.accessoryFreeThreshold
  shipping.accessoryFlatFee = mirror.accessoryFlatFee
  // 旧字段镜像：保持自洽，避免仍读它们的代码（导出常量 / 历史页面）拿到旧值
  shipping.specimenFreeThreshold = freeMirror
  shipping.thresholds.accessory = mirror.accessoryFreeThreshold
  shipping.thresholds.specimen = freeMirror

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
  const freeOther = shipping.accessoryFreeThreshold

  if (context == null) return free

  // 逐装裱方式的规则表优先（与 makeOrder/shipping.js 同一口径，混合车取门槛最高档）
  const rule = pickRuleForContext(context, shipping.craftTypeRules)
  if (rule) return Number(rule.freeShippingThreshold) || 0

  if (typeof context === 'number' && Number.isFinite(context)) {
    return context
  }

  if (typeof context === 'string') {
    const kind = normalizeExplicitKind(context) || resolveShippingKind(context)
    return kind === SHIPPING_KIND.SPECIMEN ? free : freeOther
  }

  if (Array.isArray(context)) {
    if (!context.length) return free
    return context.some((item) => resolveShippingKind(item) === SHIPPING_KIND.SPECIMEN) ? free : freeOther
  }

  if (typeof context === 'object') {
    if (Array.isArray(context.items)) return resolveThreshold(context.items)
    if (context.threshold != null && Number.isFinite(Number(context.threshold))) {
      return Number(context.threshold)
    }
    if (context.kind) return resolveThreshold(context.kind)
    return resolveShippingKind(context) === SHIPPING_KIND.SPECIMEN ? free : freeOther
  }

  return free
}

/**
 * 本单适用的**单次运费**（裁决 48：收费类 ¥18 / 其它类型 ¥10）。
 * 与 `resolveThreshold` 同源：门槛与费率必须按同一个分派结果取，否则会出现
 * "按 ¥39 判免邮、却按 ¥18 收"这种自相矛盾。
 */
function resolveFee(context) {
  if (context == null) return shipping.flatFee
  // 与 resolveThreshold 必须落在同一条规则上
  const rule = pickRuleForContext(context, shipping.craftTypeRules)
  if (rule) return Number(rule.flatFee) || 0
  if (typeof context === 'number' && Number.isFinite(context)) return shipping.flatFee
  if (typeof context === 'string') {
    const kind = normalizeExplicitKind(context) || resolveShippingKind(context)
    return kind === SHIPPING_KIND.SPECIMEN ? shipping.flatFee : shipping.accessoryFlatFee
  }
  if (Array.isArray(context)) {
    if (!context.length) return shipping.flatFee
    return context.some((item) => resolveShippingKind(item) === SHIPPING_KIND.SPECIMEN)
      ? shipping.flatFee
      : shipping.accessoryFlatFee
  }
  if (typeof context === 'object') {
    if (Array.isArray(context.items)) return resolveFee(context.items)
    if (context.kind) return resolveFee(context.kind)
    return resolveShippingKind(context) === SHIPPING_KIND.SPECIMEN
      ? shipping.flatFee
      : shipping.accessoryFlatFee
  }
  return shipping.flatFee
}

/**
 * 本单在**运费口径上**属于哪一档（收费类 / 其它）。
 *
 * ⚠️ 判据必须是 `resolveShippingKind`，**不能**写成 `resolveThreshold(context) > 0`：
 *    裁决 48 起两档都有非零门槛（收费类 ¥299、其它 ¥39），"门槛 > 0" 再也区分不了档位 ——
 *    那样会把「其它档」误判成收费档，文案写成「满 ¥299 免邮，否则 ¥18」而实际收 ¥10
 *    （2026-09-20 真机截图抓到的回归）。
 */
function resolveOrderKind(context) {
  if (context == null) return SHIPPING_KIND.SPECIMEN
  if (typeof context === 'number' && Number.isFinite(context)) return SHIPPING_KIND.SPECIMEN
  if (typeof context === 'string') {
    return normalizeExplicitKind(context) || resolveShippingKind(context)
  }
  if (Array.isArray(context)) {
    if (!context.length) return SHIPPING_KIND.SPECIMEN
    return context.some((item) => resolveShippingKind(item) === SHIPPING_KIND.SPECIMEN)
      ? SHIPPING_KIND.SPECIMEN
      : SHIPPING_KIND.ACCESSORY
  }
  if (typeof context === 'object') {
    if (Array.isArray(context.items)) return resolveOrderKind(context.items)
    if (context.kind) return resolveOrderKind(context.kind)
    return resolveShippingKind(context)
  }
  return SHIPPING_KIND.SPECIMEN
}

/**
 * 本单**是否确定含收费类装裱方式**（⇒ 才可能被收运费）。
 *
 * 用途：给「免邮券能省多少」提供唯一判定（`getProductCoupons` / `getBestCoupon` 的入参）。
 *
 * ⚠️ 与 `resolveThreshold` 的方向**正好相反**，不要互相替代：
 *   · 收费路径（`resolveThreshold`）：**未知**（null / 数字）按「含收费类」= 门槛 299 → 宁可多收不漏收（钱不能少收）。
 *   · 券省额路径（本函数）：**未知**一律 `false` → 不声称能省 → 宁可少报不虚高（**展示不能夸大**）。
 *   两者都把「确定的空清单」判为 false（没有商品就没有运费）。
 */

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
  return resolveFee(context)
}

/**
 * 「其它档」的说明里**点名这件商品实际的装裱方式**。
 *
 * 产品负责人 2026-09-20：「商品详情页-快递说明部分，『其它标本』这个字段没有配置通配符，
 * 如当选择**塑封**字段时仍然显示『其它』，需要优化」。
 * 原来其它档的文案写死成「其它类型满 ¥39 免邮」——**只要不是收费类，顾客看到的都是「其它」**，
 * 包括「造景/饰品/蝶翅画/冰箱贴」以及后台通过「选项维护」新增的（塑封、玻璃瓶…）。
 * 现在：能把 craftType 解析出中文名就**点名到具体装裱方式**（塑封 → 「塑封满 ¥39 免邮」），
 * 解析不出来（未标注 / 字典里没有 / 名字过长会撑破那行 nowrap）才退回「其它类型」。
 *
 * ⚠️ 长度上限 `OTHER_LABEL_MAX_CHARS`：那行是 `white-space: nowrap` 的单行，
 *    实测可用约 520rpx；点名一个很长的自定义名会把它撑爆（守卫按宽度钉住）。
 */
const OTHER_LABEL_MAX_CHARS = 6

function craftTypeOfContext(context) {
  if (context == null) return ''
  if (typeof context === 'string') {
    return isChargedCraftType(context) ? '' : String(context).trim()
  }
  if (Array.isArray(context)) {
    for (const item of context) {
      const v = craftTypeOfContext(item)
      if (v) return v
    }
    return ''
  }
  if (typeof context === 'object') {
    if (Array.isArray(context.items)) return craftTypeOfContext(context.items)
    if (context.craftType) return String(context.craftType).trim()
    if (context.kind) return craftTypeOfContext(context.kind)
  }
  return ''
}

/**
 * 取「其它档」要点名的中文名。
 * ⚠️ 本文件**不允许 require 别的文件**（守卫 `check-shipping-rules` 的装载器把 require 打桩成抛错，
 *    理由："被守卫加载的模块不应 require 其他文件"）——所以中文名由**调用方带进来**：
 *    · 优先用上下文里的 `craftTypeLabel`（详情页/确认页本来就有 `craftTypeLabel(p.craftType)`，
 *      它走的是**云端字典**，新增的「塑封/玻璃瓶」也能解析）；
 *    · 退一步用本文件的 `CRAFT_TYPE_LABELS`（内置 9 项，供不带上文的调用方）；
 *    · 都没有就不用（退回「其它类型」），并受长度上限保护（那行 nowrap 放不下长名）。
 */
function craftTypeLabelOf(context) {
  const label = labelOfContext(context) || CRAFT_TYPE_LABELS[craftTypeOfContext(context)] || ''
  const text = String(label).trim()
  if (!text) return ''
  return [...text].length <= OTHER_LABEL_MAX_CHARS ? text : ''
}

function labelOfContext(context) {
  if (context == null) return ''
  if (Array.isArray(context)) {
    for (const item of context) {
      const v = labelOfContext(item)
      if (v) return v
    }
    return ''
  }
  if (typeof context === 'object') {
    if (Array.isArray(context.items)) return labelOfContext(context.items)
    if (context.craftTypeLabel) return String(context.craftTypeLabel).trim()
    if (context.kind && typeof context.kind === 'object') return labelOfContext(context.kind)
  }
  return ''
}

function getRuleText(context) {
  if (isCampaignActive()) return getCampaignLabel()
  // ⚠️ 有上下文就取**这条上下文匹配到的规则**的数字：逐装裱方式配置之后，
  //    各类型的门槛与运费都不一样，再用全局的 `shipping.freeShippingThreshold` 就会写错（实测过）。
  const fee = context != null ? resolveFee(context) : shipping.shippingFee
  const free = context != null ? resolveThreshold(context) : shipping.freeShippingThreshold
  const carrier = shipping.defaultCarrier || '顺丰速运'
  // 顾客侧用短标签（见 CHARGED_GROUP_LABEL 的说明）；完整枚举只出现在后台/云端 ruleText
  const charged = CHARGED_GROUP_LABEL
  const freeOther = shipping.accessoryFreeThreshold
  const feeOther = shipping.accessoryFlatFee
  // ⚠️ 前缀必须**取装裱方式字段**（`chargedCraftTypesLabel()` 动态渲染），不要写死"全场满 XX 免邮"：
  //    "全场"会让顾客以为门槛是对整单任意商品、且不知道**哪类商品**触发这条规则
  //    （2026-09-20 产品负责人：截图里的"全场满 ¥299 / ¥39 免邮"会引发误会）。
  //    收费档→列出收费装裱方式；其它档→"其它类型"（纯其它单的整单就是其它类型商品）。
  if (context != null && resolveOrderKind(context) === SHIPPING_KIND.ACCESSORY) {
    const named = craftTypeLabelOf(context)
    return `${carrier} · ${named || '其它类型'}商品满 ¥${free} 免邮，否则运费 ¥${fee}`
  }
  if (context == null) {
    return `${carrier} · ${charged}类商品满 ¥${free} 免邮（否则 ¥${fee}）；其它类型商品满 ¥${freeOther} 免邮（否则 ¥${feeOther}）`
  }
  // 收费档同样**点名这件商品自己的装裱方式**：相框商品的「说明」行就该写「相框」，
  // 而不是把它们打包成一个组标签（产品负责人 2026-09-21 截图：「相框类产品只展示相框」）。
  // 解析不出中文名（自定义名过长 / 字典没铺上）才退回组标签。
  return `${carrier} · ${craftTypeLabelOf(context) || charged}类商品满 ¥${free} 免邮，否则运费 ¥${fee}`
}

/**
 * 「说明」行**收起态**用的短句。
 *
 * 为什么单独有这一档：详情页那行是 `white-space: nowrap` 的单行，
 * 可用宽度约 **640rpx**（22rpx 字号）——枚举装裱方式 ≈800rpx 会溢出（2026-09-20 真机截图两次）。
 * 收起态只答「**哪类** + 满多少免邮」；承运商与"否则运费 ¥X"放在**展开态**（`getRuleText`）。
 * 守卫按"估算宽度 ≤ 640rpx"钉住，改长了会红。
 */
function getRuleTextShort(context) {
  if (isCampaignActive()) return getCampaignLabel()
  const free = shipping.freeShippingThreshold
  const freeOther = shipping.accessoryFreeThreshold
  // 有上下文 → 用**本档**的门槛（逐装裱方式配置后各档不同）
  const thr = context != null ? resolveThreshold(context) : free
  if (context != null && resolveOrderKind(context) === SHIPPING_KIND.ACCESSORY) {
    // 点名到具体装裱方式（塑封/造景/饰品…），解析不出来才用「其它类型」
    return `${craftTypeLabelOf(context) || '其它类型'}满 ¥${thr} 免邮`
  }
  if (context == null) return `满 ¥${free} / ¥${freeOther} 免邮`
  // 同上：点名这件商品的装裱方式（相框 → 「相框满 ¥299 免邮」），解析不出才退回组标签
  return `${craftTypeLabelOf(context) || CHARGED_GROUP_LABEL}满 ¥${thr} 免邮`
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
  CHARGED_GROUP_LABEL,
  craftTypeLabelOf,
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
  resolveFee,
  resolveOrderKind,
  calcShippingFee,
  calcShipping: calcShippingFee,
  getRuleText,
  getShippingRuleText: getRuleText,
  getRuleTextShort,
  getHint,
  getShippingHint: getHint,
  getFeeLabel,
  getShippingFeeLabel: getFeeLabel,
  getCarrierLabel,
  estimateFreeShippingCouponSave: calcShippingFee
})
