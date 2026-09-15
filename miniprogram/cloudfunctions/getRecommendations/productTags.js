/**
 * 商品标签：短词、中文为主。与小程序 utils/productTags.js 保持一致。
 */
const MAX_TAGS = 10
const MAX_TAG_LEN = 12

function sanitizeProductTags(input) {
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

function topInterestTagNames(map, limit) {
  const cap = Math.max(1, limit || 8)
  if (Array.isArray(map)) {
    return sanitizeProductTags(map).slice(0, cap)
  }
  if (!map || typeof map !== 'object') return []
  return Object.entries(map)
    .filter(([key, weight]) => key && Number(weight) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, cap)
    .map(([key]) => key)
}

function overlapTagScore(itemTags, wanted) {
  const have = new Set(sanitizeProductTags(itemTags).map((t) => t.toLowerCase()))
  if (!have.size) return 0
  return sanitizeProductTags(wanted).reduce((sum, tag) => (
    have.has(String(tag).toLowerCase()) ? sum + 1 : sum
  ), 0)
}

module.exports = {
  MAX_TAGS,
  MAX_TAG_LEN,
  sanitizeProductTags,
  topInterestTagNames,
  overlapTagScore
}
