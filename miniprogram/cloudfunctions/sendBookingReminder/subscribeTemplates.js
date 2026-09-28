/**
 * 预约订阅消息模板（只登记公众平台已申请、字段已取证的模板；没有真实 ID 的类型不发订阅，只走站内信）。
 * 客户端请求订阅的同一 ID 在 subpackages/business/utils/bookingSubscribe.js（check:activity-seats 比对一致）。
 *
 * 预约取消通知 · 编号 47766（2026-09-28 产品负责人截图取证）
 *   thing1 活动名称 / time2 预约时段 / thing3 温馨提示
 *   thing ≤ 20 字；time 用官方示例格式「2019年10月1日 15:01」，区间只取开始时间
 */
const BOOKING_CANCEL_TMPL_ID = 'C_vs4N7_ahe1KAVmBSclyR02FsGf0MzJU5Xfou3tQbk'

const thing = (s, fallback) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim() || fallback
  return t.length > 20 ? `${t.slice(0, 19)}…` : t
}

/** 「2026-09-28」+「14:00 - 16:00」→「2026年9月28日 14:00」；缺日期或缺时间返回 ''（time 类型不能只给日期） */
function timeValue(date, time) {
  const d = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(String(date || '').trim())
  const t = /(\d{1,2}):(\d{2})/.exec(String(time || ''))
  if (!d || !t) return ''
  return `${d[1]}年${Number(d[2])}月${Number(d[3])}日 ${t[1].padStart(2, '0')}:${t[2]}`
}

const TEMPLATES = {
  cancelled: {
    templateId: BOOKING_CANCEL_TMPL_ID,
    build(booking) {
      const time2 = timeValue(booking.date, booking.time)
      if (!time2) return null
      return {
        thing1: { value: thing(booking.title, '预约') },
        time2: { value: time2 },
        thing3: { value: '名额已释放，欢迎再次预约' }
      }
    }
  }
}

/** → { templateId, data } | { skip: 原因 } */
function buildSubscribe(type, booking) {
  const tpl = TEMPLATES[type]
  if (!tpl) return { skip: 'no_template' }
  const data = tpl.build(booking || {})
  if (!data) return { skip: 'bad_fields' }
  return { templateId: tpl.templateId, data }
}

module.exports = { BOOKING_CANCEL_TMPL_ID, TEMPLATES, timeValue, buildSubscribe }
