/**
 * 保护类商品角标判定
 * 商品字段：protectionType
 *   none | sanyou | protected_plant | protected_animal
 * 凡非 none 即视为保护类，C 端统一展示「合法带证」
 */

const PROTECTED_TYPES = new Set(['sanyou', 'protected_plant', 'protected_animal'])
const BADGE_TEXT = '合法带证'

function normalizeProtectionType(value) {
  if (value == null) return 'none'
  if (typeof value === 'object') {
    return normalizeProtectionType(value.protectionType || value.protection_type || '')
  }
  const t = String(value).trim()
  if (!t || t === 'none' || t === 'false' || t === '0') return 'none'
  return t
}

/** 商品对象 / protectionType 字符串 → 是否保护类 */
function isProtectedProduct(productOrType) {
  const type = normalizeProtectionType(productOrType)
  return PROTECTED_TYPES.has(type)
}

module.exports = {
  PROTECTED_TYPES,
  BADGE_TEXT,
  normalizeProtectionType,
  isProtectedProduct
}
