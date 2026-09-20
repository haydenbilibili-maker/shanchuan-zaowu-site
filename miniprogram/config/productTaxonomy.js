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

const CRAFT_ALIASES = {
  frame: 'frame',
  cloche: 'cloche',
  cloche_round: 'cloche_round',
  cloche_cylinder: 'cloche_cylinder',
  diorama: 'diorama',
  magnet: 'magnet',
  accessory: 'accessory',
  jewelry: 'accessory',
  wing_art: 'wing_art',
  other: 'other',
  相框: 'frame',
  玻璃罩: 'cloche',
  方罩: 'cloche',
  方形玻璃罩: 'cloche',
  圆形玻璃罩: 'cloche_round',
  圆罩: 'cloche_round',
  圆柱形玻璃罩: 'cloche_cylinder',
  圆柱玻璃罩: 'cloche_cylinder',
  造景: 'diorama',
  冰箱贴: 'magnet',
  饰品: 'accessory',
  首饰: 'accessory',
  蝶翅画: 'wing_art',
  其它: 'other',
  其他: 'other'
}

const CRAFT_PROCESS_ALIASES = {
  immersion: 'immersion',
  plastination: 'plastination',
  taxidermy: 'taxidermy',
  other: 'other',
  浸制: 'immersion',
  浸液: 'immersion',
  塑化: 'plastination',
  剥制: 'taxidermy',
  其它: 'other',
  其他: 'other'
}

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
  return CRAFT_ALIASES[lower] || CRAFT_ALIASES[s] || ''
}

function normalizeCraftProcess(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  const lower = s.toLowerCase()
  return CRAFT_PROCESS_ALIASES[lower] || CRAFT_PROCESS_ALIASES[s] || ''
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
