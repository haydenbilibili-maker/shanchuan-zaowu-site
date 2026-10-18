/**
 * 文章阅读仪式（2026-10-18 产品负责人「继续看还有哪些模块…可做微创新」）：纯函数，便于守卫直接执行。
 * - 预计阅读时长：去标签后中文按 400 字 / 分、其余按 5 字符一词 220 词 / 分估算，至少 1 分钟；无正文返回 0
 * - 阅读进度：已滚距离 / 可滚距离，夹在 0..1；页面不足一屏视为读完
 */

function plainTextOf(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, '')
}

function estimateReadMinutes(html) {
  const text = plainTextOf(html)
  if (!text) return 0
  const cjk = (text.match(/[一-龥]/g) || []).length
  const other = text.length - cjk
  return Math.max(1, Math.round(cjk / 400 + other / 5 / 220))
}

function progressOf(scrollTop, scrollHeight, viewHeight) {
  const max = Number(scrollHeight) - Number(viewHeight)
  if (!(max > 0)) return 1
  return Math.max(0, Math.min(1, Number(scrollTop) / max))
}

module.exports = { plainTextOf, estimateReadMinutes, progressOf }
