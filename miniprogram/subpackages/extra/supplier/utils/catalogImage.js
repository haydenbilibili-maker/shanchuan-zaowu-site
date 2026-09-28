/**
 * 供应商价目图解析（分包旁路；不改 utils/imageUrl 行为）
 * 对齐官网报价单：绝对 URL / 相对路径 / cloud://
 */
const { cloudIdToHttps, thumbUrl, midUrl } = require('../../../../utils/imageUrl')

const SITE_ORIGIN = 'https://shanhaizaowu.com'

/** 相对路径 → 官网绝对；cloud:// → https；http(s) 原样 */
function resolveDisplayUrl(raw) {
  const u = String(raw == null ? '' : raw).trim()
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  if (u.indexOf('cloud://') === 0) return cloudIdToHttps(u)
  if (u.indexOf('//') === 0) return `https:${u}`
  if (u.charAt(0) === '/') return `${SITE_ORIGIN}${u}`
  if (u.indexOf('images/') === 0 || u.indexOf('price-list/') === 0) {
    return `${SITE_ORIGIN}/${u.replace(/^\//, '')}`
  }
  return `${SITE_ORIGIN}/${u}`
}

function collectRawImages(row) {
  const out = []
  const push = (v) => {
    const s = String(v == null ? '' : v).trim()
    if (s && out.indexOf(s) === -1) out.push(s)
  }
  push(row && row.image)
  if (Array.isArray(row && row.images)) {
    row.images.forEach(push)
  }
  return out
}

/**
 * @returns {{ thumbUrl: string, previewUrls: string[], hasImage: boolean }}
 */
function resolveCatalogImages(row) {
  const raws = collectRawImages(row)
  const absolute = raws.map(resolveDisplayUrl).filter(Boolean)
  const previewUrls = absolute.map((u) => (u.indexOf('cloud://') === 0 ? cloudIdToHttps(u) : u))
  const primary = previewUrls[0] || ''
  return {
    thumbUrl: primary ? thumbUrl(primary) || midUrl(primary) || primary : '',
    previewUrls,
    hasImage: !!primary
  }
}

module.exports = {
  SITE_ORIGIN,
  resolveDisplayUrl,
  resolveCatalogImages
}
