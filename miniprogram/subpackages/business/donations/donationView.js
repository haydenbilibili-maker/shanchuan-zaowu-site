/**
 * 我的捐赠 · 视图组装（纯函数，无 require；守卫在内存里求值）
 * 输入为云函数 getMyDonations 的 data（金额一律「分」），输出页面直接渲染的字段。
 */
const STATE_TEXT = {
  counted: '',
  partial: '部分退款 · 已扣回',
  refunded: '已退款 · 不计入',
  pending: '退款处理中 · 暂不计入'
}
const PAGE_ROWS = 20

/** 分 → 「1,234.56」；负数 / 非法按 0 */
function fmtFen(fen) {
  const v = Math.max(0, Math.round(Number(fen) || 0))
  const yuan = String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${yuan}.${String(v % 100).padStart(2, '0')}`
}

function buildRow(r) {
  const state = STATE_TEXT[r.state] != null ? r.state : 'counted'
  return {
    id: r.id,
    year: r.year,
    date: r.date || '',
    title: r.title || '藏品订单',
    countText: r.count > 1 ? `共 ${r.count} 件` : '',
    paid: fmtFen(r.paidFen),
    pledge: fmtFen(r.pledgeFen),
    stateText: state === 'partial' ? `${STATE_TEXT.partial} ¥${fmtFen(r.refundFen)}` : STATE_TEXT[state],
    muted: state === 'refunded' || state === 'pending'
  }
}

function buildYear(y, fundName) {
  return {
    year: y.year,
    amount: fmtFen(y.pledgeFen),
    paid: fmtFen(y.netFen),
    orderCount: y.orderCount,
    phase: y.phase === 'closed' ? 'closed' : 'open',
    phaseText: y.phase === 'closed'
      ? '年度已截止 · 捐赠报告将经「山海有信」转呈'
      : `进行中 · 年末由${fundName}统一拨付`
  }
}

/**
 * @param {object} data getMyDonations 出参 data
 * @param {string} fundName 基金名（文案源 donationCopy.FUND_NAME）
 */
function buildView(data, fundName) {
  const d = data || {}
  const pledgeFen = Math.max(0, Math.round(Number(d.pledgeFen) || 0))
  const rows = (Array.isArray(d.rows) ? d.rows : []).map(buildRow)
  const years = (Array.isArray(d.years) ? d.years : []).map((y) => buildYear(y, fundName))
  const notes = []
  if (d.pendingCount > 0) notes.push(`另有 ${d.pendingCount} 笔订单退款处理中，暂不计入；退款结束后自动归位。`)
  if (d.truncated || d.capped) notes.push('明细只展示最近的订单；累计金额已包含全部订单。')
  return {
    pledgeFen,
    hero: {
      amount: fmtFen(pledgeFen),
      paid: fmtFen(d.netFen),
      orderCount: Number(d.orderCount) || 0,
      since: d.firstDate ? `自 ${d.firstDate} 起` : '',
      days: Number(d.days) > 0 ? `同行第 ${d.days} 天` : '',
      empty: pledgeFen <= 0
    },
    years,
    yearTabs: years.length > 1 ? [{ key: 'all', label: '全部' }].concat(years.map((y) => ({ key: String(y.year), label: `${y.year}` }))) : [],
    rows,
    notes
  }
}

/** 年份筛选 + 分页：返回当前要画的行与是否还有更多 */
function pickRows(rows, yearKey, limit) {
  const list = (rows || []).filter((r) => !yearKey || yearKey === 'all' || String(r.year) === String(yearKey))
  const n = Math.max(PAGE_ROWS, Number(limit) || PAGE_ROWS)
  return { shown: list.slice(0, n), more: list.length > n, total: list.length }
}

module.exports = { fmtFen, buildRow, buildYear, buildView, pickRows, PAGE_ROWS, STATE_TEXT }
