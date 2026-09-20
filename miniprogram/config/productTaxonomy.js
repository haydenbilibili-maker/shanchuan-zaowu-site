/**
 * 商品多维分类枚举（与 Admin / 云函数约定一致）
 * - channel：渠道
 * - craftType：装裱方式（历史字段名保留；相框/玻璃罩等）
 * - craftProcess：制作工艺（浸制/塑化/剥制等）
 * 存英文 key；缺字段视为未标注。
 */

const CHANNEL_OPTIONS = [
  { value: 'import', label: '进口' },
  { value: 'domestic', label: '国产' },
  { value: 'other', label: '其它' }
]

/** 装裱方式（DB 字段仍为 craftType） */
const CRAFT_TYPE_OPTIONS = [
  { value: 'frame', label: '相框' },
  { value: 'cloche', label: '方形玻璃罩' },
  { value: 'cloche_round', label: '圆形玻璃罩' },
  { value: 'cloche_cylinder', label: '圆柱形玻璃罩' },
  { value: 'diorama', label: '造景' },
  { value: 'magnet', label: '冰箱贴' },
  { value: 'accessory', label: '饰品' },
  { value: 'wing_art', label: '蝶翅画' },
  { value: 'other', label: '其它' }
]

/** 制作工艺（DB 字段 craftProcess） */
/**
 * 制作工艺（标本学理分类，2026-09-19 按产品负责人给的分类补全）。
 *
 * ⚠️ **原有 3 个 key（immersion / plastination / taxidermy）的 value 一个都没动** ——
 * 存量商品存的就是这些 key，改 value 等于把已有数据的工艺全部标错。
 * 本次只**追加**新的工艺；中文名保持原样（`浸制`/`塑化`/`剥制`）以免影响既有界面与筛选文案。
 *
 * 分组（与产品负责人口径一致）：
 *   · 干制标本工艺：压制（腊叶）/ 剥制 / 针插 / 干制骨骼
 *   · 浸制标本工艺：浸制
 *   · 切片与涂片工艺（显微玻片标本）：切片 / 涂片
 *   · 现代高新标本工艺：生物塑化 / 透明骨骼 / 包埋
 */
const CRAFT_PROCESS_OPTIONS = [
  // ── 干制标本工艺 ──
  { value: 'pressed', label: '压制（腊叶）标本' },
  { value: 'taxidermy', label: '剥制' },
  { value: 'pinned', label: '针插标本' },
  { value: 'dry_bone', label: '干制骨骼标本' },
  // ── 浸制标本工艺 ──
  { value: 'immersion', label: '浸制' },
  // ── 切片与涂片工艺（显微玻片标本）──
  { value: 'section', label: '切片标本' },
  { value: 'smear', label: '涂片标本' },
  // ── 现代高新标本工艺 ──
  { value: 'plastination', label: '塑化' },
  { value: 'cleared_stained', label: '透明骨骼标本' },
  { value: 'resin_embed', label: '包埋标本' },
  // ── 兜底 ──
  { value: 'other', label: '其它' }
]

const CHANNEL_LABELS = {
  ...Object.fromEntries(CHANNEL_OPTIONS.map((o) => [o.value, o.label])),
  // 历史库存可能仍为 wild，仅展示用，筛选项已下线
  wild: '野采'
}
/* ══════════════════════════════════════════════════════════════════
 * 运行时可覆写（2026-09-20）：超管可在「藏品库 → 分类管理 → 字段维护专区」里
 * **新增 / 改中文名 / 删减** 装裱方式与制作工艺，不必发版。
 *
 * 口径与运费规则同一套（本仓「双真源」教训的正面用法）：
 *   **代码常量 = 默认值，云端文档 = 覆写**；云端读不到 / 没配 / 云函数没部署 → 一律退回默认。
 * 所以"没部署"这件事的表现是"和以前完全一样"，而不是"页面空了"。
 *
 * ⚠️ 覆盖是**整份替换**（不是追加）：删掉一个选项要能真的从界面消失。
 * ⚠️ `value` 一旦被商品引用就是历史数据（改 value = 把存量数据的工艺标错），
 *    所以后台只允许改 `label`、新增新 value、删除没人用的 value —— 这条在云端强校验。
 * ══════════════════════════════════════════════════════════════════ */
let CRAFT_OVERLAY = { types: null, processes: null }

/** 归一化一份云端字典；空/非法一律返回 null（= 用代码默认，绝不把界面弄空） */
function normalizeOverlayList (raw, fallback) {
  if (!Array.isArray(raw)) return null
  const seen = new Set()
  const out = []
  for (const item of raw) {
    const value = String((item && item.value) || '').trim()
    const label = String((item && item.label) || '').trim()
    if (!value || !label || seen.has(value)) continue
    seen.add(value)
    out.push({ value, label })
  }
  return out.length ? out : (fallback || null)
}

/** 应用云端字典（`null` / 空 = 退回代码默认）。由 utils/productTaxonomySync 调用。 */
function setCraftOverlay (doc) {
  const d = doc || {}
  CRAFT_OVERLAY = {
    types: normalizeOverlayList(d.craftTypes),
    processes: normalizeOverlayList(d.craftProcesses)
  }
}

/** 当前生效的装裱方式选项（云端优先，否则代码默认） */
function craftTypeOptions () { return CRAFT_OVERLAY.types || CRAFT_TYPE_OPTIONS }

/** 当前生效的制作工艺选项 */
function craftProcessOptions () { return CRAFT_OVERLAY.processes || CRAFT_PROCESS_OPTIONS }

/** 当前是否在用云端字典（后台据此显示"已连接云端 / 用的内置选项"） */
function hasCraftOverlay () { return !!(CRAFT_OVERLAY.types || CRAFT_OVERLAY.processes) }

const CRAFT_TYPE_LABELS = Object.fromEntries(CRAFT_TYPE_OPTIONS.map((o) => [o.value, o.label]))
const CRAFT_PROCESS_LABELS = Object.fromEntries(CRAFT_PROCESS_OPTIONS.map((o) => [o.value, o.label]))

const CHANNEL_ALIASES = {
  import: 'import',
  domestic: 'domestic',
  wild: 'wild',
  other: 'other',
  进口: 'import',
  国产: 'domestic',
  野采: 'wild',
  其它: 'other',
  其他: 'other'
}

/**
 * 从选项表派生别名表（`value → value` 且 `中文名 → value`）。
 *
 * ⚠️ 为什么必须派生而不是手写（2026-09-20 真缺陷）：2026-09-19 给 `craftProcess` 追加了
 * 7 个新工艺（pressed/pinned/dry_bone/section/smear/cleared_stained/resin_embed），
 * **选项表加了、手写的别名表没加**。而 `normalizeCraftProcess` 只查别名表 →
 * 这些值被判成非法并**写成空字符串**：超管在「分类管理 → 字段维护」里标记工艺后
 * 看到「已保存 N 件」，重载却回到「未标注」——用户报的"标记后状态没有保存"就是它，
 * 而且是**静默清空**（比不保存更糟：会抹掉原有工艺）。
 * 派生之后，「加选项忘了加别名」这一类错误在结构上不可能再发生。
 */
function aliasesFromOptions(options) {
  const map = {}
  ;(options || []).forEach((o) => {
    if (!o || !o.value) return
    const v = String(o.value)
    map[v] = v
    map[v.toLowerCase()] = v
    if (o.label) map[String(o.label)] = v
  })
  return map
}

/** 历史别名：不在选项表里，但存量数据/旧文案里出现过，必须继续认 */
const CRAFT_TYPE_ALIAS_EXTRAS = {
  jewelry: 'accessory',
  玻璃罩: 'cloche',
  方罩: 'cloche',
  圆罩: 'cloche_round',
  圆柱玻璃罩: 'cloche_cylinder',
  首饰: 'accessory',
  // ⚠️ 别删：「其它」是选项表的 label（派生得到），而简体「其他」只在旧别名表里。
  //    2026-09-20 改成派生时漏搬了这一条 → normalizeCraftType('其他') 变成 ''，
  //    而 craftType 是运费档判据（丢值=静默落错档）。由非退化比对抓出。
  其他: 'other'
}

const CRAFT_PROCESS_ALIAS_EXTRAS = {
  浸液: 'immersion',
  其他: 'other'
}

/** 选项值的**合法形态**（选项维护里新增的 `custom_xxx` 就是这一类）。
 *  与云端 `getProductTaxonomy` 的 `VALUE_RE`、两份云函数 `SAFE_OPTION_VALUE_RE` 逐字同源 ——
 *  「校验端放行的值，写库端也必须放行」，否则就是静默清空。 */
const SAFE_OPTION_VALUE_RE = /^[a-z][a-z0-9_]{0,31}$/

const CRAFT_ALIASES = Object.assign(aliasesFromOptions(CRAFT_TYPE_OPTIONS), CRAFT_TYPE_ALIAS_EXTRAS)

const CRAFT_PROCESS_ALIASES = Object.assign(
  aliasesFromOptions(CRAFT_PROCESS_OPTIONS),
  CRAFT_PROCESS_ALIAS_EXTRAS
)

/** 支持渠道 / 装裱方式 / 制作工艺筛选与标注的一级馆（短名/全名均可） */
const TAXONOMY_ELIGIBLE_ROOTS = [
  '昆虫', '植物', '海洋', '动物',
  '昆虫馆', '植物馆', '海洋馆', '动物馆'
]

/** @deprecated 使用 TAXONOMY_ELIGIBLE_ROOTS；保留别名以免旧引用断裂 */
const CRAFT_ELIGIBLE_ROOTS = TAXONOMY_ELIGIBLE_ROOTS

/** 价格预设（元） */
const PRICE_PRESETS = [
  { id: 'lt100', label: '100元以下', min: null, max: 100 },
  { id: '100_300', label: '100-300', min: 100, max: 300 },
  { id: '300_800', label: '300-800', min: 300, max: 800 },
  { id: 'gte800', label: '800元以上', min: 800, max: null }
]

function normalizeChannel(raw) {
  if (raw == null || raw === '') return ''
  const key = String(raw).trim().toLowerCase()
  return CHANNEL_ALIASES[key] || CHANNEL_ALIASES[String(raw).trim()] || ''
}

function normalizeCraftType(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  const lower = s.toLowerCase()
  const hit = CRAFT_ALIASES[lower] || CRAFT_ALIASES[s]
  if (hit) return hit
  // 云端字典新增的选项（选项维护里加的 custom_N）：值本身合法，不能当脏值丢掉
  // （否则「标记后没保存」会在自定义选项上重演 —— 与 2026-09-20 那个缺陷同类）
  const opt = craftTypeOptions().find((o) => o && String(o.value) === s)
  if (opt) return opt.value
  // ⚠️ 兜底的兜底：**字典还没铺上**时（冷启动那一刻 `hydrateFromStorage()` 之前）上面这一句查不到，
  //    自定义值会被抹成空串 —— 读回来就是"未标注"。所以再按**取值规则**放行一次：
  //    与云端 `getProductTaxonomy` 的 `VALUE_RE`、两份云函数 `SAFE_OPTION_VALUE_RE` **同一条规则**。
  return SAFE_OPTION_VALUE_RE.test(s) ? s : ''
}

function normalizeCraftProcess(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  const lower = s.toLowerCase()
  const hit = CRAFT_PROCESS_ALIASES[lower] || CRAFT_PROCESS_ALIASES[s]
  if (hit) return hit
  // 同 normalizeCraftType：云端字典里的值必须放行，字典没铺上时按取值规则放行
  const opt = craftProcessOptions().find((o) => o && String(o.value) === s)
  if (opt) return opt.value
  return SAFE_OPTION_VALUE_RE.test(s) ? s : ''
}

/** 分类文案是否属于可标注渠道/装裱/工艺的标本品类 */
function isTaxonomyEligibleContext(name) {
  const s = String(name || '')
  return /昆虫|植物|海洋|动物|蝴蝶|鳞翅|蝶/.test(s)
}

/** @deprecated 渠道已不再限蝴蝶；保留函数名供旧引用，语义改为 taxonomy 可用 */
function isButterflyContext(name) {
  return isTaxonomyEligibleContext(name)
}

function isCraftEligibleRoot(name) {
  return isTaxonomyEligibleContext(name)
}

function isChannelEligibleRoot(name) {
  return isTaxonomyEligibleContext(name)
}

function channelLabel(value) {
  const key = normalizeChannel(value)
  return CHANNEL_LABELS[key] || ''
}

function craftTypeLabel(value) {
  // ⚠️ 别名表（normalizeCraftType）只认**内置**的 value；云端新增的选项不在别名表里，
  // 直接用它会把新选项的标签查成空串。所以：别名优先，别名不认时**退回原值**再查一次。
  const key = normalizeCraftType(value) || String(value == null ? '' : value).trim()
  if (!key) return ''
  const hit = craftTypeOptions().find((o) => o.value === key)
  return hit ? hit.label : ''
}

function craftProcessLabel(value) {
  const key = normalizeCraftProcess(value) || String(value == null ? '' : value).trim()
  if (!key) return ''
  const hit = craftProcessOptions().find((o) => o.value === key)
  return hit ? hit.label : ''
}

/**
 * C 端商品卡标签：装裱方式 → 制作工艺；无数据不占位。
 * @returns {{ key: string, label: string }[]}
 */
function buildCraftDisplayTags(product) {
  const tags = []
  const framing = craftTypeLabel(product && product.craftType)
  const process = craftProcessLabel(product && product.craftProcess)
  if (framing) tags.push({ key: 'craftType', label: framing })
  if (process) tags.push({ key: 'craftProcess', label: process })
  return tags
}

module.exports = {
  CHANNEL_OPTIONS,
  CRAFT_TYPE_OPTIONS,
  CRAFT_PROCESS_OPTIONS,
  CHANNEL_LABELS,
  CRAFT_TYPE_LABELS,
  CRAFT_PROCESS_LABELS,
  PRICE_PRESETS,
  TAXONOMY_ELIGIBLE_ROOTS,
  CRAFT_ELIGIBLE_ROOTS,
  normalizeChannel,
  normalizeCraftType,
  normalizeCraftProcess,
  isTaxonomyEligibleContext,
  isButterflyContext,
  isCraftEligibleRoot,
  isChannelEligibleRoot,
  channelLabel,
  setCraftOverlay,
  craftTypeOptions,
  craftProcessOptions,
  hasCraftOverlay,
  craftTypeLabel,
  craftProcessLabel,
  buildCraftDisplayTags
}
