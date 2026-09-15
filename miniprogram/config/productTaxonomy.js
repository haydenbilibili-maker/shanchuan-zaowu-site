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
const CRAFT_PROCESS_OPTIONS = [
  { value: 'immersion', label: '浸制' },
  { value: 'plastination', label: '塑化' },
  { value: 'taxidermy', label: '剥制' },
  { value: 'other', label: '其它' }
]

const CHANNEL_LABELS = {
  ...Object.fromEntries(CHANNEL_OPTIONS.map((o) => [o.value, o.label])),
  // 历史库存可能仍为 wild，仅展示用，筛选项已下线
  wild: '野采'
}
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
  const key = normalizeCraftType(value)
  return CRAFT_TYPE_LABELS[key] || ''
}

function craftProcessLabel(value) {
  const key = normalizeCraftProcess(value)
  return CRAFT_PROCESS_LABELS[key] || ''
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
  craftTypeLabel,
  craftProcessLabel,
  buildCraftDisplayTags
}
