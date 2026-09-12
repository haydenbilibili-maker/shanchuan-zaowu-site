/**
 * 商品标签：与小程序 utils/productTags.js、manageProducts 同一套规则。
 * 写库只落 products.tags；读时兼容旧 keywords / labels。
 */
export const MAX_TAGS = 10
export const MAX_TAG_LEN = 12

export function sanitizeProductTags(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || '').split(/[,，、;；\s]+/)
  const seen = new Set()
  const out = []
  for (const item of raw) {
    let tag = String(item || '').trim().replace(/\s+/g, '')
    if (!tag) continue
    tag = tag.replace(/[\u0000-\u001F\u007F]/g, '')
    if (!tag || tag.length > MAX_TAG_LEN) continue
    if (/[\uD800-\uDFFF]/.test(tag)) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

export function readProductTags(row) {
  const primary = sanitizeProductTags(row && row.tags)
  if (primary.length) return primary
  return sanitizeProductTags([
    ...(Array.isArray(row?.keywords) ? row.keywords : String(row?.keywords || '').split(/[,，、;；]/)),
    ...(Array.isArray(row?.labels) ? row.labels : String(row?.labels || '').split(/[,，、;；]/))
  ])
}
