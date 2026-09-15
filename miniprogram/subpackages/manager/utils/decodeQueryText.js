/**
 * 小程序页面 query 中的中文等参数经 encodeURIComponent 传递，onLoad options 可能仍为编码串。
 * 仅在有 %XX 序列时 decode 一次，避免对已是明文或含裸 % 的字符串误处理。
 */
function decodeQueryText(value) {
  if (value == null || value === '') return ''
  const raw = String(value)
  if (!/%[0-9A-Fa-f]{2}/.test(raw)) return raw
  try {
    return decodeURIComponent(raw)
  } catch (e) {
    return raw
  }
}

module.exports = {
  decodeQueryText
}
