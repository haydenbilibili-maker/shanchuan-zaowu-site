/**
 * 商品多维筛选枚举（云端副本，与 config/productTaxonomy.js 对齐）
 * - craftType：装裱方式
 * - craftProcess：制作工艺
 * 另含一级馆别名匹配（与 utils/categorySeed 同源约定）
 */
const CHANNEL_VALUES = {
  import: ['import', '进口'],
  domestic: ['domestic', '国产'],
  wild: ['wild', '野采'],
  other: ['other', '其它', '其他']
}

const CRAFT_VALUES = {
  frame: ['frame', '相框'],
  cloche: ['cloche', '玻璃罩', '方罩', '方形玻璃罩'],
  cloche_round: ['cloche_round', '圆形玻璃罩', '圆罩'],
  cloche_cylinder: ['cloche_cylinder', '圆柱形玻璃罩', '圆柱玻璃罩'],
  diorama: ['diorama', '造景'],
  magnet: ['magnet', '冰箱贴'],
  accessory: ['accessory', 'jewelry', '饰品', '首饰'],
  wing_art: ['wing_art', '蝶翅画'],
  other: ['other', '其它', '其他']
}

/**
 * 制作工艺：canonical → [可匹配的写法…]。
 *
 * ⚠️ 2026-09-20 补齐：这张表**漏了 2026-09-19 追加的 7 个工艺**
 *   （压制/针插/干制骨骼/切片/涂片/透明骨骼/包埋）—— 与 `manageProducts` 那份别名表
 *   是同一个漂移。少了它们的后果不只是"百科筛选匹配不上"：`normalizeCraftProcess` 从这张表派生，
 *   于是这些值会被**静默清空**（写库时 craftProcess 变空串 = 后台标记不保存）。
 *   口径与 `config/productTaxonomy.js` / `manageProducts/productTaxonomy.js` 的选项表逐字一致。
 */
const CRAFT_PROCESS_VALUES = {
  // 干制标本工艺
  pressed: ['pressed', '压制（腊叶）标本', '压制'],
  taxidermy: ['taxidermy', '剥制'],
  pinned: ['pinned', '针插标本', '针插'],
  dry_bone: ['dry_bone', '干制骨骼标本', '干制骨骼'],
  // 浸制标本工艺
  immersion: ['immersion', '浸制', '浸液'],
  // 切片与涂片工艺（显微玻片标本）
  section: ['section', '切片标本', '切片'],
  smear: ['smear', '涂片标本', '涂片'],
  // 现代高新标本工艺
  plastination: ['plastination', '塑化'],
  cleared_stained: ['cleared_stained', '透明骨骼标本', '透明骨骼'],
  resin_embed: ['resin_embed', '包埋标本', '包埋'],
  // 兜底
  other: ['other', '其它', '其他']
}

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
 * 别名表**从本文件已有的 value map 派生**（不手抄、也不另抄一份选项表）。
 *
 * ⚠️ 这里原先是一张**手写**别名表，只覆盖 4 个旧工艺 —— 与 `manageProducts` 那份是同一个漂移：
 *    `normalizeCraftProcess('pinned')` 返回 `''`，写库时把 craftProcess **静默清空**
 *    （产品负责人 2026-09-20 报的「标记后状态没有保存」就是这个）。
 *    改成派生之后，"数值表加了、别名表忘了"在结构上不可能再发生。
 */
function aliasesFromValues(values) {
  const map = {}
  Object.keys(values || {}).forEach((canonical) => {
    map[canonical] = canonical
    map[String(canonical).toLowerCase()] = canonical
    ;(values[canonical] || []).forEach((a) => {
      if (a) map[String(a)] = canonical
    })
  })
  return map
}

const CRAFT_ALIASES = aliasesFromValues(CRAFT_VALUES)
const CRAFT_PROCESS_ALIASES = aliasesFromValues(CRAFT_PROCESS_VALUES)

const SAFE_OPTION_VALUE_RE = /^[a-z][a-z0-9_]{0,31}$/

/** 与 utils/categorySeed LEGACY_ROOT_ALIASES / CANONICAL_ROOT_NAMES 对齐 */
const CANONICAL_ROOT_NAMES = ['昆虫馆', '矿石馆', '植物馆', '海洋馆', '动物馆', '首饰馆', '衍生品']
const CANONICAL_ROOT_SET = new Set(CANONICAL_ROOT_NAMES)

const LEGACY_ROOT_ALIASES = {
  神奇昆虫: '昆虫馆',
  神奇昆虫馆: '昆虫馆',
  蝴蝶昆虫: '昆虫馆',
  蝴蝶昆虫馆: '昆虫馆',
  首饰: '首饰馆',
  饰品馆: '首饰馆',
  群山回响: '矿石馆',
  植物探微: '植物馆',
  植物果实: '植物馆',
  无尽海洋: '海洋馆',
  海洋标本: '海洋馆',
  动物类: '动物馆',
  动物世界: '动物馆',
  昆虫: '昆虫馆',
  植物: '植物馆',
  海洋: '海洋馆',
  矿石: '矿石馆',
  矿物: '矿石馆',
  动物: '动物馆'
}

function normalizeChannel(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  return CHANNEL_ALIASES[s.toLowerCase()] || CHANNEL_ALIASES[s] || ''
}

function normalizeCraftType(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  const hit = CRAFT_ALIASES[s.toLowerCase()] || CRAFT_ALIASES[s]
  if (hit) return hit
  return SAFE_OPTION_VALUE_RE.test(s) ? s : ''
}

function normalizeCraftProcess(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  const hit = CRAFT_PROCESS_ALIASES[s.toLowerCase()] || CRAFT_PROCESS_ALIASES[s]
  if (hit) return hit
  return SAFE_OPTION_VALUE_RE.test(s) ? s : ''
}

function enumMatchValues(field, canonical) {
  if (!canonical) return []
  if (field === 'channel') return CHANNEL_VALUES[canonical] || [canonical]
  if (field === 'craftType') return CRAFT_VALUES[canonical] || [canonical]
  if (field === 'craftProcess') return CRAFT_PROCESS_VALUES[canonical] || [canonical]
  return [canonical]
}

function toCanonicalRootName(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  if (!s) return ''
  if (CANONICAL_ROOT_SET.has(s)) return s
  if (LEGACY_ROOT_ALIASES[s]) return LEGACY_ROOT_ALIASES[s]
  if (!s.endsWith('馆')) {
    const withHall = `${s}馆`
    if (CANONICAL_ROOT_SET.has(withHall)) return withHall
    if (LEGACY_ROOT_ALIASES[withHall]) return LEGACY_ROOT_ALIASES[withHall]
  }
  return ''
}

function collectRootAliases(canonicalOrRaw) {
  const canonical = toCanonicalRootName(canonicalOrRaw)
  if (!canonical) return []
  const names = new Set([canonical])
  if (canonical.endsWith('馆')) names.add(canonical.slice(0, -1))
  Object.entries(LEGACY_ROOT_ALIASES).forEach(([legacy, target]) => {
    if (target !== canonical) return
    names.add(legacy)
    if (legacy.endsWith('馆')) names.add(legacy.slice(0, -1))
  })
  return [...names]
}

module.exports = {
  normalizeChannel,
  normalizeCraftType,
  normalizeCraftProcess,
  enumMatchValues,
  toCanonicalRootName,
  collectRootAliases,
  CHANNEL_VALUES,
  CRAFT_VALUES,
  CRAFT_PROCESS_VALUES
}
