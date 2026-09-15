/**
 * 敏感形态识别（蛇类 / 两栖 / 明确敏感爬行类）
 *
 * 用途：藏品录入默认开启 products.sensitiveBlur。
 * C 端模糊门仍只读商品字段 sensitiveBlur（及兼容 contentWarning），不在展示时二次猜类。
 *
 * 维护约定：
 * - CATEGORY_MARKERS：分类名 / taxonomy 纲目等
 * - TITLE_KEYWORDS：品名、标签、描述关键词（含排除项避免矿物/昆虫假阳性）
 * - LATIN_MARKERS：学名与拉丁纲目线索
 */

/** 分类 / taxonomy 命中（中英） */
const CATEGORY_MARKERS = [
  '爬行纲',
  '爬行类',
  '两栖纲',
  '两栖类',
  'reptilia',
  'amphibia',
  'serpentes',
  'squamata',
  'anura',
  'caudata',
  'urodela',
  'gymnophiona'
]

/**
 * 品名/标签关键词。顺序无关；匹配前会去掉 EXCLUDE_PHRASES。
 * 含明确蛇类、两栖，以及常见「观感较强」的爬行类；龟鳖壳饰等不默认命中（可手动开）。
 */
const TITLE_KEYWORDS = [
  '蛇',
  '蟒',
  '蝰',
  '蝮',
  '眼镜蛇',
  '水蛇',
  '海蛇',
  '锦蛇',
  '青蛇',
  '赤练',
  '蜥蜴',
  '壁虎',
  '变色龙',
  '鳄鱼',
  '蝾螈',
  '娃娃鱼',
  '大鲵',
  '青蛙',
  '树蛙',
  '蟾蜍',
  '雨蛙',
  '两栖',
  '爬宠',
  'snake',
  'python',
  'viper',
  'cobra',
  'lizard',
  'gecko',
  'chameleon',
  'crocodile',
  'alligator',
  'frog',
  'toad',
  'salamander',
  'newt',
  'amphibian',
  'reptile'
]

/** 假阳性短语（矿物 / 昆虫等）：匹配前从文本中剔除 */
const EXCLUDE_PHRASES = [
  '蛇蛉',
  '蛇绿',
  '蛇纹',
  '蛇纹石',
  '蛇纹岩',
  '蛇绿岩',
  '蛇葡萄',
  '蛇床',
  '蛇莓',
  '蛇菰',
  'raphidioptera'
]

const LATIN_MARKERS = [
  'serpentes',
  'colubridae',
  'viperidae',
  'elapidae',
  'pythonidae',
  'boidae',
  'crotalinae',
  'amphibia',
  'anura',
  'caudata',
  'urodela',
  'gymnophiona',
  'reptilia',
  'squamata',
  'sauria',
  'lacertilia',
  'gekkonidae',
  'agamidae',
  'chamaeleonidae',
  'crocodylia',
  'crocodylidae',
  'bufonidae',
  'ranidae',
  'hylidae',
  'salamandridae',
  'cryptobranchidae'
]

function asText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function collectTaxonomyBlob(taxonomy) {
  if (!taxonomy || typeof taxonomy !== 'object') return ''
  const keys = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species',
    '界', '门', '纲', '目', '科', '属', '种']
  return keys.map((k) => asText(taxonomy[k])).filter(Boolean).join(' ')
}

function collectProductBlob(product) {
  if (!product || typeof product !== 'object') return { categoryBlob: '', titleBlob: '', latinBlob: '' }
  const tags = Array.isArray(product.tags)
    ? product.tags.map((t) => (t && typeof t === 'object' ? (t.label || t.name || t.key || '') : t)).join(' ')
    : asText(product.tags)
  const categoryBlob = [
    product.rootCategoryName,
    product.category,
    product.categoryType,
    product.categoryName,
    collectTaxonomyBlob(product.taxonomy)
  ].map(asText).join(' ')

  const titleBlob = [
    product.title,
    product.name,
    product.description,
    tags
  ].map(asText).join(' ')

  const latinBlob = [
    product.latinName,
    product.latin,
    product.scientificName,
    collectTaxonomyBlob(product.taxonomy)
  ].map(asText).join(' ')

  return { categoryBlob, titleBlob, latinBlob }
}

function stripExcluded(text) {
  let out = String(text || '')
  EXCLUDE_PHRASES.forEach((phrase) => {
    if (!phrase) return
    out = out.split(phrase).join(' ')
  })
  return out
}

function includesAny(haystack, markers) {
  const h = String(haystack || '').toLowerCase()
  if (!h) return false
  return markers.some((m) => h.includes(String(m).toLowerCase()))
}

/**
 * 是否像敏感形态商品（应默认开启敏感模糊）
 * @param {object} product 录入表单 / 商品文档片段
 * @returns {boolean}
 */
function looksLikeSensitiveMorphology(product) {
  const { categoryBlob, titleBlob, latinBlob } = collectProductBlob(product)
  if (includesAny(categoryBlob, CATEGORY_MARKERS)) return true
  if (includesAny(latinBlob, LATIN_MARKERS)) return true
  const titleClean = stripExcluded(titleBlob)
  if (includesAny(titleClean, TITLE_KEYWORDS)) return true
  return false
}

/**
 * 计算录入时应写入的 sensitiveBlur / sensitiveBlurSetByUser
 *
 * 规则：
 * - 店员已手动设过（sensitiveBlurSetByUser）→ 完全尊重传入值
 * - 新建且命中敏感形态 → 默认 true
 * - 编辑且库内未设过 sensitiveBlur（null/undefined）且命中 → 默认 true
 * - 编辑已有明确 true/false → 不覆盖（除非本次带 setByUser）
 *
 * @param {object} incoming 本次拟写入字段
 * @param {{ isCreate?: boolean, existing?: object|null }} options
 * @returns {{ sensitiveBlur: boolean, sensitiveBlurSetByUser: boolean }}
 */
function resolveSensitiveBlurForSave(incoming, options) {
  const opts = options || {}
  const existing = opts.existing || null
  const isCreate = !!opts.isCreate
  const raw = incoming && typeof incoming === 'object' ? incoming : {}

  const setByUser = raw.sensitiveBlurSetByUser === true
    || (existing && existing.sensitiveBlurSetByUser === true)

  const hasIncomingBlur = Object.prototype.hasOwnProperty.call(raw, 'sensitiveBlur')
    || Object.prototype.hasOwnProperty.call(raw, 'contentWarning')
  let blur = false
  if (Object.prototype.hasOwnProperty.call(raw, 'sensitiveBlur')) {
    blur = !!raw.sensitiveBlur
  } else if (Object.prototype.hasOwnProperty.call(raw, 'contentWarning')) {
    blur = !!raw.contentWarning
  } else if (existing && (existing.sensitiveBlur != null || existing.contentWarning != null)) {
    blur = !!(existing.sensitiveBlur || existing.contentWarning)
  }

  const probe = Object.assign({}, existing || {}, raw)
  const detected = looksLikeSensitiveMorphology(probe)

  if (setByUser) {
    return {
      sensitiveBlur: hasIncomingBlur ? blur : !!(existing && (existing.sensitiveBlur || existing.contentWarning)),
      sensitiveBlurSetByUser: true
    }
  }

  if (detected) {
    if (isCreate) {
      return { sensitiveBlur: true, sensitiveBlurSetByUser: false }
    }
    const existingUnset = !existing
      || (existing.sensitiveBlur == null && existing.contentWarning == null)
    if (existingUnset) {
      return { sensitiveBlur: true, sensitiveBlurSetByUser: false }
    }
  }

  return {
    sensitiveBlur: blur,
    sensitiveBlurSetByUser: false
  }
}

/**
 * 表单侧：在未手动设过时，命中敏感形态则建议开启
 * @returns {boolean|null} true=应开启；null=不要改动开关
 */
function suggestSensitiveBlurOnForm(product, setByUser) {
  if (setByUser) return null
  if (looksLikeSensitiveMorphology(product)) return true
  return null
}

module.exports = {
  CATEGORY_MARKERS,
  TITLE_KEYWORDS,
  EXCLUDE_PHRASES,
  LATIN_MARKERS,
  looksLikeSensitiveMorphology,
  resolveSensitiveBlurForSave,
  suggestSensitiveBlurOnForm
}
