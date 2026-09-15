/**
 * 礼赠页 query 中文参数：上游 encodeURIComponent 后，onLoad options 可能仍为 %XX 串。
 * 最多 decode 两轮（兼容 hub→compose 误二次 encode）；已是明文则原样返回。
 */
function decodeQueryText(value) {
  if (value == null || value === '') return ''
  let raw = String(value)
  for (let i = 0; i < 2; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(raw)) break
    try {
      const next = decodeURIComponent(raw)
      if (next === raw) break
      raw = next
    } catch (e) {
      break
    }
  }
  return raw
}

module.exports = {
  decodeQueryText
}
