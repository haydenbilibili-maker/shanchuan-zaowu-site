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

const DEFAULTS = {
  defaultCarrier: '顺丰速运',
  flatFee: 18,
  freeShippingThreshold: 299,
  accessoryFreeThreshold: 39,
  accessoryFlatFee: 10,
  chargedCraftTypes: DEFAULT_CHARGED_CRAFT_TYPES.slice(),
  craftTypeRules: DEFAULT_CRAFT_TYPE_RULES.map((r) => ({ ...r })),
  freeShippingCampaign: {
    enabled: false,
    label: '当前全场免邮',
    startAt: '',
    endAt: ''
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

/** 运行时状态（每次 loadFromDb 重置为 defaults 再合并云端） */
const state = {
  defaultCarrier: DEFAULTS.defaultCarrier,
  flatFee: DEFAULTS.flatFee,
  freeShippingThreshold: DEFAULTS.freeShippingThreshold,
  accessoryFreeThreshold: DEFAULTS.accessoryFreeThreshold,
  accessoryFlatFee: DEFAULTS.accessoryFlatFee,
  chargedCraftTypes: DEFAULTS.chargedCraftTypes.slice(),
  /** 逐装裱方式的规则表（见 DEFAULT_CRAFT_TYPE_RULES）；判定以它为准，旧字段只是镜像 */
  craftTypeRules: DEFAULTS.craftTypeRules.map((r) => ({ ...r })),
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

  // 其它类型门槛/费率（裁决 48）：与收费类各自独立
  state.accessoryFreeThreshold = Math.max(0, toNumber(
    src.accessoryFreeThreshold != null ? src.accessoryFreeThreshold : thresholds.accessory,
    DEFAULTS.accessoryFreeThreshold
  ))
  state.accessoryFlatFee = Math.max(0, toNumber(
    src.accessoryFlatFee != null
      ? src.accessoryFlatFee
      : (src.accessoryShippingFee != null ? src.accessoryShippingFee : (src.fees && src.fees.accessory)),
    DEFAULTS.accessoryFlatFee
  ))

  const charged = normalizeChargedCraftTypes(src.chargedCraftTypes)
  state.chargedCraftTypes = charged && charged.length
    ? charged
    : DEFAULTS.chargedCraftTypes.slice()

  /* 规则表：新文档带 `craftTypeRules` 就用它；老文档没有 → 用**刚读进来的旧字段**合成
   * （`rulesFromLegacyConfig(state)`），行为与改造前逐字一致。
   * 然后反过来把旧字段按规则表镜像一遍 —— 保证"判定读规则表、旧读者读旧字段"两个口径一致。 */
  const rules = normalizeCraftTypeRules(src.craftTypeRules) || rulesFromLegacyConfig(state)
  state.craftTypeRules = rules
  const mirror = legacyMirrorFromRules(rules)
  if (mirror.chargedCraftTypes.length) state.chargedCraftTypes = mirror.chargedCraftTypes
  state.freeShippingThreshold = mirror.freeShippingThreshold
  state.flatFee = mirror.flatFee
  state.accessoryFreeThreshold = mirror.accessoryFreeThreshold
  state.accessoryFlatFee = mirror.accessoryFlatFee

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
    craftTypeRules: state.craftTypeRules.map((r) => ({ ...r })),
    // 旧字段镜像（保持自洽，避免仍读它们的调用方拿到旧值）
    accessoryFreeThreshold: state.accessoryFreeThreshold,
    accessoryFlatFee: state.accessoryFlatFee,
    specimenFreeThreshold: state.freeShippingThreshold,
    thresholds: {
      accessory: state.accessoryFreeThreshold,
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
  const freeOther = state.accessoryFreeThreshold

  if (context == null) return free

  /* 逐装裱方式的规则表优先（2026-09-21）。混合车取门槛最高的那一档 —— 见 pickRuleForContext。
   * 判不出来（空车/奇怪上下文）才落到下面的旧两档逻辑。 */
  const rule = pickRuleForContext(context, state.craftTypeRules)
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
 * 本单适用的单次运费（裁决 48：收费类 ¥18 / 其它类型 ¥10）。
 * 与 resolveThreshold 必须同一分派结果，否则会"按 ¥39 判免邮、却按 ¥18 收"。
 */
function resolveFee(context) {
  if (context == null) return state.flatFee
  /* 与 resolveThreshold 必须落在**同一条规则**上，否则会"按 ¥39 判免邮、却按 ¥18 收" */
  const rule = pickRuleForContext(context, state.craftTypeRules)
  if (rule) return Number(rule.flatFee) || 0
  if (typeof context === 'number' && Number.isFinite(context)) return state.flatFee
  if (typeof context === 'string') {
    const kind = normalizeExplicitKind(context) || resolveShippingKind(context)
    return kind === SHIPPING_KIND.SPECIMEN ? state.flatFee : state.accessoryFlatFee
  }
  if (Array.isArray(context)) {
    if (!context.length) return state.flatFee
    return context.some((item) => resolveShippingKind(item) === SHIPPING_KIND.SPECIMEN)
      ? state.flatFee
      : state.accessoryFlatFee
  }
  if (typeof context === 'object') {
    if (Array.isArray(context.items)) return resolveFee(context.items)
    if (context.kind) return resolveFee(context.kind)
    return resolveShippingKind(context) === SHIPPING_KIND.SPECIMEN
      ? state.flatFee
      : state.accessoryFlatFee
  }
  return state.flatFee
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
 * @param {number} goodsAmount 优惠前**整单**商品合计（勿传折后应付、勿只传收费类小计）
 * @param {object|array|string|number} [context] 商品列表或品类上下文
 */
function calcShipping(goodsAmount, context) {
  if (isFreeShippingCampaignActive()) return 0
  const amount = parseFloat(goodsAmount) || 0
  if (amount <= 0) return 0
  const threshold = resolveThreshold(context)
  if (amount >= threshold) return 0
  return resolveFee(context)
}

function getDefaultCarrier() {
  return state.defaultCarrier
}

function getFreeShippingThreshold() {
  return state.freeShippingThreshold
}

function getThresholds() {
  return {
    accessory: state.accessoryFreeThreshold,
    specimen: state.freeShippingThreshold
  }
}

function getAccessoryFlatFee() {
  return state.accessoryFlatFee
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
  resolveFee,
  getFlatFee,
  getAccessoryFlatFee
}
