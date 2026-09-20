/**
 * 商品多维分类枚举（manageProducts 云端副本，与 config/productTaxonomy.js 对齐）
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
 * 选项值 → 自身（同时收下小写形态与中文名）—— **从选项表派生**，不再手抄。
 *
 * ⚠️ 这里曾是两份**手写**别名表，而 `CRAFT_PROCESS_OPTIONS` 2026-09-19 追加了 7 个新工艺
 *    （压制/针插/干制骨骼/切片/涂片/透明骨骼/包埋），别名表**只加了 4 个旧工艺**。
 *    后果：`normalizeCraftProcess('pinned')` 返回 `''` → `batchPatch` 把 craftProcess
 *    **静默写成空串** → 后台「分类管理 → 字段维护」里标记完再读回来仍是「未标注」，
 *    也就是产品负责人 2026-09-20 报的「标记后状态没有保存」。
 *    客户端 `config/productTaxonomy.js` 早就改成派生了（那里的注释写着"静默清空比不保存更糟"），
 *    **两份云函数副本没跟上** —— 现在一起改成派生：加选项忘了加别名这类错误在结构上不可能再发生。
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
  // 简体「其他」：选项表的 label 是「其它」（派生得到），这条只在旧别名表里 —— 漏了就会
  // 让『其他』被判非法并**写成空**，而 craftType 是运费档判据（2026-09-20 由非退化比对抓出）
  其他: 'other'
}

const CRAFT_PROCESS_ALIAS_EXTRAS = {
  浸液: 'immersion',
  其他: 'other'
}

const CRAFT_ALIASES = Object.assign(aliasesFromOptions(CRAFT_TYPE_OPTIONS), CRAFT_TYPE_ALIAS_EXTRAS)

const CRAFT_PROCESS_ALIASES = Object.assign(
  aliasesFromOptions(CRAFT_PROCESS_OPTIONS),
  CRAFT_PROCESS_ALIAS_EXTRAS
)

/**
 * 「选项维护」里**新增**的选项（value 形如 `custom_xxx`）不在本文件的选项表里 ——
 * 但它是**合法值**，normalize 必须放行；不然写库时又会变成空串（同一个缺陷换个入口复发）。
 * 口径与 `getProductTaxonomy` 的 `VALUE_RE` 一致（校验端与写库端必须同一条规则）。
 */
const SAFE_OPTION_VALUE_RE = /^[a-z][a-z0-9_]{0,31}$/

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
  const hit = CRAFT_ALIASES[s.toLowerCase()] || CRAFT_ALIASES[s]
  if (hit) return hit
  // 云端字典新增的选项（选项维护）：值本身合法，不能当脏值抹掉
  return SAFE_OPTION_VALUE_RE.test(s) ? s : ''
}

function normalizeCraftProcess(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  const hit = CRAFT_PROCESS_ALIASES[s.toLowerCase()] || CRAFT_PROCESS_ALIASES[s]
  if (hit) return hit
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
  const key = normalizeCraftType(value)
  return CRAFT_TYPE_LABELS[key] || ''
}

function craftProcessLabel(value) {
  const key = normalizeCraftProcess(value)
  return CRAFT_PROCESS_LABELS[key] || ''
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
  craftProcessLabel
}
