/**
 * 从 ERP 财务账本提取摘要，供资本架构沙盘内嵌同步
 * 口径：ERP 账本 = 楼上山川造物；星宸标本默认用户 TTM；集团 = 两店合计
 */
import {
  applyDefaultStoreToFinanceRecord,
  CANONICAL_STORE_DEFS,
  ensureDefaultFinanceStoreInLocalBundle,
  loadStoreBundle,
  resolveCanonicalStoreKey,
} from './storeStorage.js'
import { migrateFinanceRecordsFromLegacy, FINANCE_RECORDS_KEY } from './financeLocalStorageKey.js'
import { autoSyncFinanceData } from './financeSync.js'

/** 星宸标本（楼下）用户提供的 TTM，待 ERP 按店拆分后可覆盖 */
export const XINGCHEN_DEFAULT_TTM_WAN = 93.7

const XINGCHEN_SOURCE_NOTE = '用户提供 TTM，待 ERP 按店拆分后可覆盖'

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

/**
 * 同一门店同一天可能存在多条历史记录（早期内部 storeId 与 canonical storeId 并存，
 * 且旧行只记 POS、新行记 POS+现金），ledgerKey 按 storeId 去重无法覆盖，会重复计入营收。
 * 归一到 canonical 门店后按「日期」再去重：优先 canonical storeId → 较新 → 金额较大。
 */
function dedupeRowsByStoreDate(rows, bundle) {
  const canonicalIds = new Set(CANONICAL_STORE_DEFS.map((d) => d.storeId))
  const best = new Map()

  rows.forEach((row) => {
    const key = `${resolveCanonicalStoreKey(row, bundle)}|${String(row.date).slice(0, 10)}`
    const prev = best.get(key)
    if (!prev) {
      best.set(key, row)
      return
    }
    const score = (r) => [
      canonicalIds.has(String(r.storeId || '')) ? 1 : 0,
      Number(r._updateTime || r.syncedAt || 0),
      Number(r.revenue) || 0,
    ]
    const [ac, at, ar] = score(row)
    const [bc, bt, br] = score(prev)
    if (ac !== bc ? ac > bc : at !== bt ? at > bt : ar > br) best.set(key, row)
  })

  return [...best.values()]
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
  const bundle = loadStoreBundle()
  const groupedAll = { shanhaizaowu: [], xingchen: [] }
  const groupedTtm = { shanhaizaowu: [], xingchen: [] }

  allRows.forEach((r) => {
    const key = resolveCanonicalStoreKey(r, bundle)
    groupedAll[key].push(r)
  })
  ttmRows.forEach((r) => {
    const key = resolveCanonicalStoreKey(r, bundle)
    groupedTtm[key].push(r)
  })
  const bundleStores = bundle?.stores || []

  return CANONICAL_STORE_DEFS.map((def) => {
    const ttmAgg = aggregateRows(groupedTtm[def.key] || [])
    const allAgg = aggregateRows(groupedAll[def.key] || [])
    const bundleMatch =
      bundleStores.find((s) => s.storeId === def.storeId) ||
      bundleStores.find((s) => String(s.name || '').trim() === def.name)
    const hasErpData = ttmAgg.recordCount > 0 || allAgg.recordCount > 0

    let ttmRevenueWan = toWan(ttmAgg.totalRevenue)
    let revenueSource = 'erp'
    let status = hasErpData ? 'synced' : 'pending'
    let sourceNote = null
    let hasData = hasErpData

    if (def.key === 'xingchen') {
      if (hasErpData && ttmRevenueWan > 0) {
        revenueSource = 'erp'
        status = 'synced'
      } else {
        ttmRevenueWan = XINGCHEN_DEFAULT_TTM_WAN
        revenueSource = 'user-provided'
        status = 'user-provided'
        sourceNote = XINGCHEN_SOURCE_NOTE
        hasData = true
      }
    } else if (def.key === 'shanhaizaowu') {
      if (!hasErpData) {
        ttmRevenueWan = 0
        status = 'pending'
        hasData = false
      }
    }

    return {
      key: def.key,
      storeId: def.storeId,
      name: def.name,
      floor: def.floor,
      locationLabel: def.locationLabel,
      bundleStoreId: bundleMatch?.id || null,
      ttmRevenueWan,
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
      hasErpData,
      revenueSource,
      sourceNote,
      status,
    }
  })
}

/** 从 localStorage 读取并规范化财务行（兼容 bizDate / netAmount / 缺 storeId） */
export function loadNormalizedFinanceRows() {
  migrateFinanceRecordsFromLegacy()
  ensureDefaultFinanceStoreInLocalBundle()
  const bundle = loadStoreBundle()

  let raw
  try {
    raw = localStorage.getItem(FINANCE_RECORDS_KEY)
  } catch {
    return []
  }
  if (!raw) return []

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  return parsed
    .map((r) => {
      if (!r || typeof r !== 'object') return null
      const withStore = applyDefaultStoreToFinanceRecord(r, bundle)
      const date = String(withStore.date || withStore.bizDate || '').slice(0, 10)
      if (!date) return null
      return {
        ...withStore,
        date,
        revenue: Number(withStore.revenue ?? withStore.netAmount ?? 0) || 0,
        orderCount: Number(withStore.orderCount ?? withStore.orders ?? 0) || 0,
      }
    })
    .filter(Boolean)
}

export function buildFinanceSnapshotFromRows(inputRows) {
  if (!inputRows?.length) return null

  const rows = dedupeRowsByStoreDate(inputRows, loadStoreBundle())
  const ttmRows = filterTtmRows(rows)
  const useTtm = ttmRows.length > 0
  const effectiveTtmRows = useTtm ? ttmRows : rows

  const stores = buildStoreSnapshots(rows, effectiveTtmRows)
  const shanhaizaowuStore = stores.find((s) => s.key === 'shanhaizaowu')
  const xingchenStore = stores.find((s) => s.key === 'xingchen')

  const shanhaizaowuTtmWan = shanhaizaowuStore?.ttmRevenueWan || 0
  const xingchenTtmWan = xingchenStore?.ttmRevenueWan || XINGCHEN_DEFAULT_TTM_WAN
  const groupTtmRevenueWan = shanhaizaowuTtmWan + xingchenTtmWan

  const bundle = loadStoreBundle()
  const shanhaizaowuAgg = aggregateRows(
    effectiveTtmRows.filter((r) => resolveCanonicalStoreKey(r, bundle) === 'shanhaizaowu'),
  )
  const allAgg = aggregateRows(rows)

  const hasErpShanhaizaowu = !!shanhaizaowuStore?.hasErpData
  const hasErpXingchen = xingchenStore?.status === 'synced'

  // 账本启用不足 12 个月时不能叫 TTM，否则会被当成完整年度直接乘 PE
  const erpMonthCount = shanhaizaowuAgg.monthCount || 0
  const isFullTtm = erpMonthCount >= 12
  const periodLabel = !useTtm
    ? '账本累计'
    : isFullTtm
      ? 'TTM 滚动 12 个月'
      : `账本仅覆盖 ${erpMonthCount} 个月（未满 12 个月，非完整 TTM）`
  // 年化 run-rate：按山川造物实际覆盖月份折年 + 星宸全年 TTM，用于估值口径
  const annualizedRunRateWan =
    erpMonthCount > 0 ? (shanhaizaowuTtmWan / erpMonthCount) * 12 + xingchenTtmWan : groupTtmRevenueWan

  return {
    erpMonthCount,
    isFullTtm,
    annualizedRunRateWan,
    groupTtmRevenueWan,
    ttmRevenueWan: groupTtmRevenueWan,
    shanhaizaowuTtmWan,
    xingchenTtmWan,
    xingchenDefaultTtmWan: XINGCHEN_DEFAULT_TTM_WAN,
    monthlyAvgWan: annualizedRunRateWan / 12,
    peakMonthWan: toWan(shanhaizaowuAgg.peakMonth),
    avgTicket: shanhaizaowuAgg.avgTicket,
    orderCount: shanhaizaowuAgg.orderCount,
    dateFrom: shanhaizaowuAgg.dateFrom,
    dateTo: shanhaizaowuAgg.dateTo,
    monthCount: shanhaizaowuAgg.monthCount,
    recordCount: shanhaizaowuAgg.recordCount,
    periodType: useTtm ? (isFullTtm ? 'ttm' : 'partial') : 'cumulative',
    periodLabel,
    cumulativeRevenueWan: toWan(allAgg.totalRevenue),
    hasErpTtm: hasErpShanhaizaowu,
    hasErpShanhaizaowu,
    hasErpXingchen,
    stores,
    syncedAt: Date.now(),
    source: 'erp-finance',
  }
}

/** 同步读本地账本（不拉云端） */
export function readFinanceSnapshot() {
  try {
    const rows = loadNormalizedFinanceRows()
    return buildFinanceSnapshotFromRows(rows)
  } catch {
    return null
  }
}

/**
 * 与 Finance.vue 同源：先 autoSyncFinanceData（CloudBase finance_records → localStorage），再读快照
 *
 * `readOnly: true`：这是**读**入口，只把云端权威拉下来，绝不回写云端。
 * 不传的话，一旦云端读取失败，`syncFinanceRecords` 会因「本机条数 > 云端条数」把本机账本推上去 ——
 * 「读不到云端」不等于「云端为空」，读操作不该有这个副作用。
 */
export async function readFinanceSnapshotAsync(options = {}) {
  const { skipCloudSync = false } = options
  migrateFinanceRecordsFromLegacy()
  ensureDefaultFinanceStoreInLocalBundle()

  if (!skipCloudSync) {
    try {
      await autoSyncFinanceData({ readOnly: true })
    } catch (error) {
      console.warn('[financeSandboxBridge] 云端财务同步失败，回退本地账本:', error)
    }
  }

  return readFinanceSnapshot()
}

export function pushFinanceSnapshotToIframe(iframeEl, snap = null) {
  const payload = snap ?? readFinanceSnapshot()
  if (!payload || !iframeEl?.contentWindow) return false
  try {
    iframeEl.contentWindow.postMessage({ type: 'erp-finance-sync', payload }, '*')
    return !!payload.hasErpShanhaizaowu
  } catch {
    return false
  }
}

export async function pushFinanceSnapshotToIframeAsync(iframeEl, options = {}) {
  const snap = await readFinanceSnapshotAsync(options)
  return pushFinanceSnapshotToIframe(iframeEl, snap)
}
