/**
 * 店长「记一笔」提交前核对：表单 POS 必须与所附日报原文表头的「银联POS收款」一致。
 * 表单是可改的，原文里的明细件数（如「戒指 39」）一旦被手改 / 残留进 POS 就会多计营收
 * （2026-09-26 山川造物：原文 9773.60，入库 9812.6）。只有此处用到，不放进双份镜像的工具。
 */
const { parseDailyFinanceText } = require('./financeDailyParse')

/**
 * @param {string} rawText 日报原文
 * @param {string|number} formPos 表单里的 POS
 * @returns {{ rawPos: number, formPos: number } | null} 不一致时返回两边数值；一致 / 无原文 / 原文识别不了 → null
 */
function rawPosMismatch(rawText, formPos) {
  const text = String(rawText || '').trim()
  if (!text) return null
  const parsed = parseDailyFinanceText(text)
  if (!parsed || !parsed.ok || parsed.pos == null) return null
  const form = parseFloat(formPos)
  const fp = Number.isFinite(form) ? form : 0
  if (Math.abs(fp - parsed.pos) < 0.005) return null
  return { rawPos: parsed.pos, formPos: fp }
}

module.exports = { rawPosMismatch }
