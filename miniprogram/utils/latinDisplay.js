/**
 * 拉丁学名 / 副标题展示清洗：空值与 N/A 类占位不渲染。
 */

const PLACEHOLDER_SET = {
  'n/a': true,
  na: true,
  'n.a.': true,
  'n.a': true,
  null: true,
  undefined: true,
  none: true,
  nil: true,
  unknown: true,
  '-': true,
  '—': true,
  '–': true,
  'not applicable': true,
  'not available': true,
  'n/a.': true,
  'tbd': true,
  '/': true,
  '不适用': true,
  '无学名': true,
  '待定': true,
  暂无: true,
  无: true,
  未知: true
}

function sanitizeLatinName(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return ''
  const key = s.toLowerCase()
  if (PLACEHOLDER_SET[key]) return ''
  return s
}

module.exports = {
  sanitizeLatinName
}
