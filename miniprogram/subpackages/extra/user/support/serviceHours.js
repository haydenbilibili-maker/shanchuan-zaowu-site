/**
 * 服务时间 → 「现在在不在服务时间」（2026-11-26 联系专员细节：首屏告诉顾客现在能不能马上有人回）
 * 纯函数，不依赖 wx。服务时间是后台填的自由文本，只认两种能确定的写法，认不出就返回 null（不显示状态，不猜）：
 *   「10:00 – 22:00」「10:00-22:00」「10：00至22：00」
 *   「上午10点至下午5点」「上午10点半到晚上9点」（下午 / 晚上 / 傍晚 的 1–11 点按 +12 算）
 * 时间按北京时间判断（顾客手机时区不一定是东八区）。
 */
const PM = /下午|晚上|傍晚|夜间|晚/

function toMinutes(prefix, h, m) {
  let hour = Number(h)
  const min = m === '半' ? 30 : Number(m || 0)
  if (!Number.isFinite(hour) || !Number.isFinite(min) || min > 59) return null
  if (PM.test(prefix || '') && hour >= 1 && hour < 12) hour += 12
  if (/中午/.test(prefix || '') && hour >= 1 && hour < 6) hour += 12
  if (hour > 24) return null
  return hour * 60 + min
}

/** → { start, end }（分钟）或 null */
function parseHours(text) {
  const s = String(text || '').replace(/\s+/g, '')
  const re = /(上午|早上|中午|下午|晚上|傍晚|夜间)?(\d{1,2})(?:[:：](\d{2})|点(半|\d{1,2})?分?)/g
  const hits = []
  let m
  while ((m = re.exec(s)) && hits.length < 3) hits.push(m)
  if (hits.length !== 2) return null
  const [a, b] = hits
  const start = toMinutes(a[1], a[2], a[3] != null ? a[3] : a[4])
  let end = toMinutes(b[1] || (a[1] && PM.test(a[1]) ? a[1] : ''), b[2], b[3] != null ? b[3] : b[4])
  if (start == null || end == null) return null
  // 「上午10点至5点」这种后半段没写上午下午、又比开始早：按下午算
  if (end <= start && !b[1] && end + 720 > start && end < 720) end += 720
  if (end <= start) return null
  return { start, end }
}

/** 北京时间当天的分钟数 */
function beijingMinutes(nowMs) {
  const d = new Date((Number(nowMs) || Date.now()) + 8 * 3600 * 1000)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

/** → { open: boolean, label } 或 null（认不出服务时间） */
function serviceStatus(hoursText, nowMs) {
  const r = parseHours(hoursText)
  if (!r) return null
  const t = beijingMinutes(nowMs)
  const open = t >= r.start && t < r.end
  return { open, label: open ? '服务中' : '非服务时间' }
}

module.exports = { parseHours, serviceStatus }
