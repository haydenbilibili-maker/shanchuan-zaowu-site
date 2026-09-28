/**
 * 活动是否已过期（北京时间）。首页 / 预约页 / 门店页 / 搜索 与 createBooking 同一口径；
 * cloudfunctions/createBooking/activityExpiry.js 须与本文件逐字一致（check:activity-seats）。
 * 当天的截止点 = 结束时间，没写结束取开始时间，都没写则到 24:00；没填日期不算过期。
 */
const TZ = 8 * 3600 * 1000
const pad = (n) => String(n).padStart(2, '0')

function bjNow(now) {
  const d = new Date(Number(now == null ? Date.now() : now) + TZ)
  return { day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, hm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }
}

function isActivityExpired(item, now) {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(String((item && item.date) || '').trim())
  if (!m) return false
  const date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  const t = bjNow(now)
  if (date !== t.day) return date < t.day
  const hm = String((item && item.time) || '').match(/\d{1,2}:\d{2}/g) || []
  const cut = hm[1] || hm[0]
  return !!cut && cut.padStart(5, '0') <= t.hm
}

module.exports = { todayKey: (now) => bjNow(now).day, isActivityExpired }
