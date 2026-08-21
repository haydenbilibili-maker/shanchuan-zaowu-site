/**
 * 官网报价单字段工具（与 src/data/priceList.ts 对齐）
 */

/** 官网静态资源绝对前缀（Admin 在 /admin/ 下预览相对路径会错位，同步时写成绝对 URL） */
export const PRICE_LIST_SITE_ORIGIN = 'https://shanhaizaowu.com'

export const PREP_METHODS = ['干制', '浸液', '塑化', '其他']

export const PACKAGING_FILTERS = [
  '玻璃罩',
  '相框',
  '冰箱贴',
  '精灵球',
  '蝶翅画',
  '压制标本',
  '创意摆件',
  '首饰',
  '收藏级标本',
  '其它标本',
]

export const BIO_FILTERS = [
  '植物果实',
  '海洋',
  '蝴蝶',
  '昆虫',
  '哺乳动物',
  '两栖动物',
  '爬行动物',
]

export function isPriceRange(value) {
  return typeof value === 'object' && value !== null && 'min' in value && 'max' in value
}

export function formatPriceAmount(value) {
  if (value === null || value === undefined) return '—'
  if (isPriceRange(value)) return `¥${value.min}–¥${value.max}`
  return `¥${value}`
}

export function priceLowerBound(value) {
  if (value === null || value === undefined) return null
  if (isPriceRange(value)) return value.min
  return Number.isFinite(value) ? value : null
}

export function priceUpperBound(value) {
  if (value === null || value === undefined) return null
  if (isPriceRange(value)) return value.max
  return Number.isFinite(value) ? value : null
}

/** Admin 表单 ↔ 云端 price / guidePrice */
export function formPriceToValue(mode, single, min, max) {
  if (mode === 'empty') return null
  if (mode === 'range') {
    const a = Number(min)
    const b = Number(max)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null
    return { min: a, max: b }
  }
  const n = Number(single)
  return Number.isFinite(n) ? n : null
}

export function valueToFormPrice(value) {
  if (value === null || value === undefined) {
    return { mode: 'empty', single: null, min: null, max: null }
  }
  if (isPriceRange(value)) {
    return { mode: 'range', single: null, min: value.min, max: value.max }
  }
  return { mode: 'single', single: value, min: null, max: null }
}

/** 订货履约 / 店长 listCatalog 精简结构 */
export function toB2bCatalogItem(row) {
  const price = priceLowerBound(row.price)
  const priceMax = isPriceRange(row.price) ? row.price.max : null
  return {
    skuId: row.skuId,
    name: row.name,
    price,
    priceMax,
    priceIsRange: isPriceRange(row.price),
    priceLabel: formatPriceAmount(row.price),
  }
}

/** 是否云存储 fileID（手动上传） */
export function isCloudFileId(url) {
  return typeof url === 'string' && url.startsWith('cloud://')
}

/**
 * 将官网相对路径规范为可跨域访问的绝对 URL；已是 http(s)/cloud:// 则原样返回
 * @param {string} url
 * @param {string} [origin]
 */
export function toAbsoluteSiteUrl(url, origin = PRICE_LIST_SITE_ORIGIN) {
  const u = String(url || '').trim()
  if (!u) return ''
  if (/^https?:\/\//i.test(u) || u.startsWith('cloud://') || u.startsWith('blob:') || u.startsWith('data:')) {
    return u
  }
  if (u.startsWith('//')) return `https:${u}`
  const base = String(origin || PRICE_LIST_SITE_ORIGIN).replace(/\/$/, '')
  if (u.startsWith('/')) return `${base}${u}`
  return `${base}/${u}`
}

/** 规范化图集：去空、相对→绝对；主图缺省取首张 */
export function normalizeImageFields(image, images, { absolute = true } = {}) {
  const mapOne = (u) => (absolute ? toAbsoluteSiteUrl(u) : String(u || '').trim())
  const list = (Array.isArray(images) ? images : [])
    .map(mapOne)
    .filter(Boolean)
  const primary = mapOne(image) || list[0] || ''
  const merged = list.length ? list : primary ? [primary] : []
  // 保证主图在首位且唯一序
  const uniq = []
  for (const u of [primary, ...merged].filter(Boolean)) {
    if (!uniq.includes(u)) uniq.push(u)
  }
  return { image: uniq[0] || '', images: uniq }
}

/** 同步种子时：是否应用种子图片 */
export function shouldApplySeedImages(existing, { forceOverwrite = false } = {}) {
  if (forceOverwrite) return true
  const hasImage = !!(existing?.image && String(existing.image).trim())
  const hasImages = Array.isArray(existing?.images) && existing.images.some((u) => String(u || '').trim())
  return !hasImage && !hasImages
}
