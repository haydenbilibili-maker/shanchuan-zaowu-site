/**
 * 从 ERP 财务本地账本提取摘要，供资本架构沙盘内嵌同步
 */
const FINANCE_LS_KEY = 'shanhai_v12'

export function readFinanceSnapshot() {
  try {
    const raw = localStorage.getItem(FINANCE_LS_KEY)
    if (!raw) return null
    const rows = JSON.parse(raw).filter((r) => r && r.date)
    if (!rows.length) return null

    const totalRevenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0)
    const dates = [...new Set(rows.map((r) => r.date))].sort()
    const dateFrom = dates[0]
    const dateTo = dates[dates.length - 1]

    const monthMap = {}
    rows.forEach((r) => {
      const m = String(r.date).slice(0, 7)
      monthMap[m] = (monthMap[m] || 0) + (Number(r.revenue) || 0)
    })
    const monthTotals = Object.values(monthMap)
    const monthlyAvg = monthTotals.length
      ? monthTotals.reduce((a, b) => a + b, 0) / monthTotals.length
      : 0
    const peakMonth = monthTotals.length ? Math.max(...monthTotals) : 0

    const orderCount = rows.reduce((s, r) => s + (Number(r.orders) || Number(r.orderCount) || 0), 0)
    const avgTicket = orderCount > 0 ? totalRevenue / orderCount : null

    return {
      totalRevenueWan: totalRevenue / 10000,
      monthlyAvgWan: monthlyAvg / 10000,
      peakMonthWan: peakMonth / 10000,
      avgTicket,
      orderCount: orderCount || null,
      dateFrom,
      dateTo,
      monthCount: monthTotals.length,
      recordCount: rows.length,
      syncedAt: Date.now(),
      source: 'erp-finance',
    }
  } catch {
    return null
  }
}

export function pushFinanceSnapshotToIframe(iframeEl) {
  const snap = readFinanceSnapshot()
  if (!snap || !iframeEl?.contentWindow) return false
  try {
    iframeEl.contentWindow.postMessage({ type: 'erp-finance-sync', payload: snap }, '*')
    return true
  } catch {
    return false
  }
}
