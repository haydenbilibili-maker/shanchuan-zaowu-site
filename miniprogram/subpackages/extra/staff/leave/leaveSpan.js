/**
 * 请假天数即时预览（2026-10-18「少一步」）：选完起止就看到「共 2.5 天」和一条日历条。
 * 纯前端预览，提交入参不变（manageStaffWorkspace.leaveSubmit 仍收起止日期 + 时间）；审批以云端记录为准。
 * 口径：每个日历日按 09:00–18:00 的覆盖时长折算 —— 没覆盖 0、≤4.5 小时半天、更多算一天。
 * 门店周末照常营业，所以周末也计入，只在日历条上标出「六 / 日」，不擅自扣掉；节假日没有数据源，不臆造。
 */
const DOW = ['日', '一', '二', '三', '四', '五', '六']
const WORK_START = 9 * 60
const WORK_END = 18 * 60
const HALF_LIMIT = 270
const MAX_CELLS = 14

function toMinutes(hhmm, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback
}

function parseDay(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

/** 某天 [from, to) 分钟段折成 0 / 0.5 / 1 天 */
function dayPortion(from, to) {
  const covered = Math.max(0, Math.min(to, WORK_END) - Math.max(from, WORK_START))
  if (covered <= 0) return 0
  return covered <= HALF_LIMIT ? 0.5 : 1
}

/** { days, label, rangeText, cells: [{ key, dow, day, fill: 'full'|'half'|'none', weekend }], more } ；起止无效返回 null */
function buildSpan(startDate, startTime, endDate, endTime) {
  const s = parseDay(startDate)
  const e = parseDay(endDate)
  const sm = toMinutes(startTime, 0)
  const em = toMinutes(endTime, 24 * 60)
  if (!s || !e) return null
  const total = Math.round((e - s) / 86400000)
  if (total < 0 || (total === 0 && em <= sm)) return null
  const cells = []
  let days = 0
  for (let i = 0; i <= total; i += 1) {
    const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i)
    const from = i === 0 ? sm : 0
    const to = i === total ? em : 24 * 60
    const portion = dayPortion(from, to)
    days += portion
    if (cells.length < MAX_CELLS) {
      cells.push({
        key: `${d.getMonth() + 1}-${d.getDate()}`,
        dow: DOW[d.getDay()],
        day: d.getDate(),
        fill: portion === 1 ? 'full' : portion === 0.5 ? 'half' : 'none',
        weekend: d.getDay() === 0 || d.getDay() === 6
      })
    }
  }
  const md = (d) => `${d.getMonth() + 1}.${d.getDate()}`
  return {
    days,
    label: days > 0 ? `共 ${days} 天` : '不足半天',
    rangeText: total === 0 ? `${md(s)} 当天` : `${md(s)} – ${md(e)} · 跨 ${total + 1} 个日历日`,
    cells,
    more: Math.max(0, total + 1 - MAX_CELLS)
  }
}

module.exports = { buildSpan, dayPortion }
