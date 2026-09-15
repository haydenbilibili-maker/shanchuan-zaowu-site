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

const CRAFT_PROCESS_VALUES = {
  immersion: ['immersion', '浸制', '浸液'],
  plastination: ['plastination', '塑化'],
  taxidermy: ['taxidermy', '剥制'],
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
  return CRAFT_ALIASES[s.toLowerCase()] || CRAFT_ALIASES[s] || ''
}

function normalizeCraftProcess(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  return CRAFT_PROCESS_ALIASES[s.toLowerCase()] || CRAFT_PROCESS_ALIASES[s] || ''
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
