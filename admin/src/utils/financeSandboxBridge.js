/**
 * 从 ERP 财务本地账本提取摘要，供资本架构沙盘内嵌同步
 * 按 canonical 双店（楼上山海造物 / 楼下星宸标本）分组，优先 TTM 口径
 */
import {
  CANONICAL_STORE_DEFS,
  loadStoreBundle,
  resolveCanonicalStoreKey,
} from './storeStorage.js'

const FINANCE_LS_KEY = 'shanhai_v12'
const DEFAULT_TTM_WAN = 93.7

function parseRowDate(raw) {
  const d = new Date(String(raw).slice(0, 10) + 'T12:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

function aggregateRows(rows) {
  if (!rows.length) {
    return {
      totalRevenue: 0,
      monthlyAvg: 0,
      peakMonth: 0,
      orderCount: 0,
      avgTicket: null,
      dateFrom: null,
      dateTo: null,
      monthCount: 0,
      recordCount: 0,
    }
  }

  const totalRevenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0)
  const dates = [...new Set(rows.map((r) => String(r.date).slice(0, 10)))].sort()
  const dateFrom = dates[0] || null
  const dateTo = dates[dates.length - 1] || null

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

  const orderCount = rows.reduce(
    (s, r) => s + (Number(r.orders) || Number(r.orderCount) || 0),
    0,
  )
  const avgTicket = orderCount > 0 ? totalRevenue / orderCount : null

  return {
    totalRevenue,
    monthlyAvg,
    peakMonth,
    orderCount: orderCount || null,
    avgTicket,
    dateFrom,
    dateTo,
    monthCount: monthTotals.length,
    recordCount: rows.length,
  }
}

function filterTtmRows(rows) {
  if (!rows.length) return []
  const dated = rows
    .map((r) => ({ row: r, date: parseRowDate(r.date) }))
    .filter((x) => x.date)
  if (!dated.length) return rows

  const maxTime = Math.max(...dated.map((x) => x.date.getTime()))
  const maxDate = new Date(maxTime)
  const cutoff = new Date(maxDate)
  cutoff.setMonth(cutoff.getMonth() - 11)
  cutoff.setDate(1)
  cutoff.setHours(0, 0, 0, 0)

  return dated.filter((x) => x.date >= cutoff && x.date <= maxDate).map((x) => x.row)
}

function toWan(yuan) {
  return yuan / 10000
}

function buildStoreSnapshots(allRows, ttmRows) {
  const groupedAll = { shanhaizaowu: [], xingchen: [], unknown: [] }
  const groupedTtm = { shanhaizaowu: [], xingchen: [], unknown: [] }

  allRows.forEach((r) => {
    const key = resolveCanonicalStoreKey(r)
    const bucket = groupedAll[key] ? key : 'unknown'
    groupedAll[bucket].push(r)
  })
  ttmRows.forEach((r) => {
    const key = resolveCanonicalStoreKey(r)
    const bucket = groupedTtm[key] ? key : 'unknown'
    groupedTtm[bucket].push(r)
  })

  const bundle = loadStoreBundle()
  const bundleStores = bundle?.stores || []

  return CANONICAL_STORE_DEFS.map((def) => {
    const ttmAgg = aggregateRows(groupedTtm[def.key] || [])
    const allAgg = aggregateRows(groupedAll[def.key] || [])
    const bundleMatch =
      bundleStores.find((s) => s.storeId === def.storeId) ||
      bundleStores.find((s) => String(s.name || '').trim() === def.name)
    const hasData = ttmAgg.recordCount > 0 || allAgg.recordCount > 0

    return {
      key: def.key,
      storeId: def.storeId,
      name: def.name,
      floor: def.floor,
      locationLabel: def.locationLabel,
      bundleStoreId: bundleMatch?.id || null,
      ttmRevenueWan: toWan(ttmAgg.totalRevenue),
      totalRevenueWan: toWan(allAgg.totalRevenue),
      monthlyAvgWan: toWan(ttmAgg.monthlyAvg || allAgg.monthlyAvg),
      peakMonthWan: toWan(ttmAgg.peakMonth || allAgg.peakMonth),
      orderCount: ttmAgg.orderCount || allAgg.orderCount,
      avgTicket: ttmAgg.avgTicket ?? allAgg.avgTicket,
      dateFrom: ttmAgg.dateFrom || allAgg.dateFrom,
      dateTo: ttmAgg.dateTo || allAgg.dateTo,
      monthCount: ttmAgg.monthCount || allAgg.monthCount,
      recordCount: ttmAgg.recordCount || allAgg.recordCount,
      hasData,
      status: hasData ? 'synced' : 'pending',
    }
  })
}

export function readFinanceSnapshot() {
  try {
    const raw = localStorage.getItem(FINANCE_LS_KEY)
    if (!raw) return null
    const rows = JSON.parse(raw).filter((r) => r && r.date)
    if (!rows.length) return null

    const ttmRows = filterTtmRows(rows)
    const ttmAgg = aggregateRows(ttmRows.length ? ttmRows : rows)
    const allAgg = aggregateRows(rows)
    const stores = buildStoreSnapshots(rows, ttmRows.length ? ttmRows : rows)

    const useTtm = ttmRows.length > 0
    const primaryAgg = useTtm ? ttmAgg : allAgg
    const ttmRevenueWan = toWan(primaryAgg.totalRevenue)
    const hasErpTtm = useTtm && ttmRevenueWan > 0

    return {
      totalRevenueWan: ttmRevenueWan,
      ttmRevenueWan,
      monthlyAvgWan: toWan(primaryAgg.monthlyAvg),
      peakMonthWan: toWan(primaryAgg.peakMonth),
      avgTicket: primaryAgg.avgTicket,
      orderCount: primaryAgg.orderCount,
      dateFrom: primaryAgg.dateFrom,
      dateTo: primaryAgg.dateTo,
      monthCount: primaryAgg.monthCount,
      recordCount: primaryAgg.recordCount,
      periodType: useTtm ? 'ttm' : 'cumulative',
      periodLabel: useTtm ? 'TTM 滚动 12 个月' : '账本累计',
      cumulativeRevenueWan: toWan(allAgg.totalRevenue),
      defaultTtmWan: DEFAULT_TTM_WAN,
      hasErpTtm,
      stores,
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
