/**
 * 钱包账单流水的**纯展示派生**（无 wx API、无副作用，便于单测）
 *
 * 为什么单独成模块：流水的时间轴分组 + 合计是「算错了看不出来」的那类逻辑 ——
 * 分页边界上的那一天**还没加载完**，若照样给它算「当日净额」就是谎报。
 * 这里把口径集中成纯函数，由 `npm run test:wallet-ledger` 钉住。
 *
 * 数据来源：云函数 `manageStoredValue:listLedgers`（`createTime` 倒序、limit/offset 分页）
 */

const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const DAY_MS = 86400000

/**
 * 时间解析：兼容本文档在真机上出现过的全部形态。
 *
 * ⚠️ 历史缺陷：旧实现直接 `new Date(raw)`，而云函数回包的日期可能是
 *    `{ $date: <ms|ISO> }`（本仓已有 4 处按此兼容，见 couponHelper / storeLedger /
 *    member-crm / live studio）。该形态下 `new Date(obj)` = Invalid Date，
 *    于是**每一行的时间会静默变成空字符串**，而页面照常渲染 —— 无人报错。
 */
function ledgerTimeMs(raw) {
  if (raw == null || raw === '') return 0
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  if (raw instanceof Date) {
    const t = raw.getTime()
    return Number.isNaN(t) ? 0 : t
  }
  if (typeof raw === 'object') {
    if (raw.$date != null) return ledgerTimeMs(raw.$date)
    if (typeof raw.getTime === 'function') {
      const t = raw.getTime()
      return Number.isNaN(t) ? 0 : t
    }
    return 0
  }
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? 0 : t
}

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`
}

function startOfDay(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** YYYY-MM-DD（本地时区）；无效时间返回 '' */
function dayKeyOf(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** YYYY-MM（本地时区）；无效时间返回 '' */
function monthKeyOf(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

/** 完整时间：YYYY-MM-DD HH:mm（下拉刷新后用于无障碍标签，不占行内版面） */
function formatDateTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  return `${dayKeyOf(ms)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 行内只留时分：日期已由「日头」承担，逐行重复日期纯属噪音 */
function formatClock(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 日头主标：今天 / 昨天 / 09.14 */
function dayLabel(ms, nowMs) {
  if (!ms) return '时间未知'
  const today = startOfDay(nowMs || Date.now())
  const target = startOfDay(ms)
  if (target === today) return '今天'
  if (target === today - DAY_MS) return '昨天'
  const d = new Date(ms)
  return `${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`
}

/** 日头副标：周三 */
function weekdayLabel(ms) {
  if (!ms) return ''
  return WEEK_CN[new Date(ms).getDay()] || ''
}

/** 月带：2026 年 9 月 */
function monthLabel(ms) {
  if (!ms) return '时间未知'
  const d = new Date(ms)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
}

function fenToYuanText(fen) {
  const n = Number(fen) || 0
  return (Math.abs(n) / 100).toFixed(2)
}

function signedYuanText(fen) {
  const n = Number(fen) || 0
  if (n > 0) return `+¥${(n / 100).toFixed(2)}`
  if (n < 0) return `-¥${(Math.abs(n) / 100).toFixed(2)}`
  return '¥0.00'
}

/** 单行派生：与旧实现字段名保持一致（WXML 不需要改）,新增 clockText / tappable */
function mapLedgerRow(row, nowMs) {
  const ms = ledgerTimeMs(row && row.createTime)
  const amountFen = Number((row && row.amountFen) || 0)
  const isCredit = row && row.isCredit != null ? !!row.isCredit : amountFen >= 0
  let toneClass = isCredit ? 'is-credit' : 'is-debit'
  if (row && (row.type === 'refund_credit' || row.type === 'order_unfreeze')) {
    toneClass = 'is-refund'
  }
  const orderId = row ? String(row.refId || '').trim() : ''
  const tappable = !!(row && row.refType === 'order' && orderId)
  return {
    ...row,
    timeMs: ms,
    timeText: formatDateTime(ms),
    clockText: formatClock(ms),
    amountSign: isCredit ? '+' : '-',
    amountYuan: row && row.amountYuan != null
      ? String(row.amountYuan).replace(/^-/, '')
      : fenToYuanText(amountFen),
    isCredit,
    subtitle: (row && (row.subtitle || row.remark)) || '',
    toneClass,
    balanceAfterYuan: (row && row.balanceAfterYuan) || '',
    tappable,
    orderId: tappable ? orderId : '',
    _nowMs: nowMs
  }
}

/**
 * 时间轴派生
 *
 * @param {object[]} rows 已加载的流水（按 createTime 倒序）
 * @param {{ hasMore?: boolean, now?: number }} options
 *        hasMore=true 表示「还有更早的没加载」→ 时间最早的那一天**可能还没加载完**，
 *        该天不产出 netText（不谎报当日净额），其余天正常给。
 * @returns {{ timeline: object[], count: number, creditFen: number, debitFen: number, tappableCount: number }}
 */
function buildLedgerTimeline(rows, options = {}) {
  const nowMs = Number(options.now) || Date.now()
  const hasMore = !!options.hasMore
  const list = (rows || []).filter(Boolean).map((row) => mapLedgerRow(row, nowMs))

  const buckets = []
  const byKey = new Map()
  let creditFen = 0
  let debitFen = 0
  let tappableCount = 0

  list.forEach((row) => {
    if (row.amountFen > 0) creditFen += row.amountFen
    else if (row.amountFen < 0) debitFen += Math.abs(row.amountFen)
    if (row.tappable) tappableCount += 1

    const key = dayKeyOf(row.timeMs) || '__unknown__'
    let bucket = byKey.get(key)
    if (!bucket) {
      bucket = {
        key,
        ms: row.timeMs,
        label: dayLabel(row.timeMs, nowMs),
        week: weekdayLabel(row.timeMs),
        monthKey: monthKeyOf(row.timeMs),
        rows: [],
        creditFen: 0,
        debitFen: 0
      }
      byKey.set(key, bucket)
      buckets.push(bucket)
    }
    bucket.rows.push(row)
    if (row.amountFen > 0) bucket.creditFen += row.amountFen
    else if (row.amountFen < 0) bucket.debitFen += Math.abs(row.amountFen)
  })

  // 最早的一天 = 列表末尾（倒序输入），分页未完时不给它算净额
  const openKey = hasMore && buckets.length ? buckets[buckets.length - 1].key : ''

  const timeline = []
  let lastMonth = ''
  buckets.forEach((bucket) => {
    if (bucket.monthKey && bucket.monthKey !== lastMonth) {
      lastMonth = bucket.monthKey
      timeline.push({
        kind: 'month',
        key: `m-${bucket.monthKey}`,
        label: monthLabel(bucket.ms)
      })
    }
    const net = bucket.creditFen - bucket.debitFen
    const complete = bucket.key !== openKey && bucket.key !== '__unknown__'
    const rowsOut = bucket.rows.map((row, idx) => ({
      ...row,
      isLast: idx === bucket.rows.length - 1 && complete
    }))
    timeline.push({
      kind: 'day',
      key: `d-${bucket.key}`,
      label: bucket.label,
      week: bucket.key === '__unknown__' ? '' : bucket.week,
      count: bucket.rows.length,
      complete,
      netText: complete ? signedYuanText(net) : '',
      netTone: net > 0 ? 'is-plus' : net < 0 ? 'is-minus' : 'is-flat',
      rows: rowsOut
    })
  })

  // 列表最末一行永远封口：轨道线不能悬在半空（悬空看起来像画坏了），
  // 「还有更早的没加载」由「加载更多」按钮与「未完」标记表达，不靠断掉的线。
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    if (timeline[i].kind === 'day' && timeline[i].rows.length) {
      timeline[i].rows[timeline[i].rows.length - 1].isLast = true
      break
    }
  }

  return {
    timeline,
    count: list.length,
    creditFen,
    debitFen,
    tappableCount
  }
}
/** 卡片右上角口径文案：还有更早的就说「已加载」，否则说「共」—— 两者都不是估算 */
function ledgerCapText(count, hasMore) {
  const n = Number(count) || 0
  if (!n) return ''
  return hasMore ? `已加载 ${n} 笔` : `共 ${n} 笔`
}

module.exports = {
  DAY_MS,
  ledgerTimeMs,
  formatDateTime,
  formatClock,
  dayKeyOf,
  monthKeyOf,
  dayLabel,
  weekdayLabel,
  monthLabel,
  fenToYuanText,
  signedYuanText,
  mapLedgerRow,
  buildLedgerTimeline,
  ledgerCapText
}
