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

function fallbackTags({ title, latinName, rootCategory, category, merch }) {
  const raw = []
  const root = String(rootCategory || '').replace(/馆$/, '').trim()
  if (root) raw.push(root)
  const child = String(category || '').split(/[·・]/)[0].trim()
  if (child) raw.push(child)
  const name = String(title || '').trim()
  if (name && name.length <= 8) raw.push(name)
  const genus = String(latinName || '').trim().split(/\s+/)[0]
  if (genus && /[A-Za-z]/.test(genus)) raw.push(genus)
  if (merch) raw.push('文创')
  return sanitizeProductTags(raw)
}

function hasNonEmptyTags(row) {
  return sanitizeProductTags(row && row.tags).length > 0
}

function looksLikeMerch(row) {
  const text = `${(row && row.rootCategoryName) || ''}${(row && row.category) || ''}${(row && row.categoryType) || ''}`
  if ((row && row.categoryType) === 'merch') return true
  return /衍生|文创|书籍|画册|工具|耗材|周边|礼品|包装|礼盒/.test(text)
}

/** 读时兼容旧 keywords / labels，写库只应落 tags */
function readProductTags(row) {
  const primary = sanitizeProductTags(row && row.tags)
  if (primary.length) return primary
  return sanitizeProductTags([
    ...(Array.isArray(row && row.keywords) ? row.keywords : String((row && row.keywords) || '').split(/[,，、;；]/)),
    ...(Array.isArray(row && row.labels) ? row.labels : String((row && row.labels) || '').split(/[,，、;；]/))
  ])
}

module.exports = {
  MAX_TAGS,
  MAX_TAG_LEN,
  sanitizeProductTags,
  fallbackTags,
  hasNonEmptyTags,
  looksLikeMerch,
  readProductTags
}
