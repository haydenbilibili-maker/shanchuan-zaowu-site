/**
 * 经营驾驶舱 · 只读指标口径（对齐小程序 getAnalyticsDashboard）
 *
 * - 优先：经 /api/cloud-fn 调 getAnalyticsDashboard（action=report），全量订单口径
 * - 回退：CDN 采样 ORDER_SCAN_MAX 单，由本文件 aggregateOrders 本地聚合
 * - 营业日：Asia/Shanghai
 * - 小程序毛 GMV：paid|paid_awaiting_address|shipped|received|ready_pickup
 *   按 paidTime（无则 createTime）归入营业日；金额 = totalPrice；排除 source=exchange
 * - 定金单 / 尾款单分桶（不重复计货值语义由订单金额本身保证）
 * - 周期退款：refunded|refunding|expired_refunding|aftersales，按 refundTime
 * - 线上净额 = 毛 GMV − 周期退款
 * - 营收账本：localStorage shanhai_v12（含 store_ledger 桥接）；与线上分列
 * - 综合营收 = 线上净额 + 账本净额（ERP 账本优先 localStorage，不用云函数 offlineLedger 覆盖）
 * - 应捐 1%：品牌承诺「门店营收的 1%」→ 以账本净额为基准；另展示综合口径供对照
 */

import { isExchangeOrder } from './orderFilters.js'
import { FINANCE_RECORDS_KEY } from './financeLocalStorageKey.js'
import {
  loadStoreBundle,
  recordMatchesFinanceStoreFilter,
} from './storeStorage.js'

export const PAID_STATUS = ['paid', 'paid_awaiting_address', 'shipped', 'received', 'ready_pickup']
export const REFUND_STATUS = ['refunded', 'refunding', 'expired_refunding', 'aftersales']
export const ORDER_SCAN_MAX = 500
export const DONATION_RATE = 0.01

const TZ_SHANGHAI = 8 * 60 * 60 * 1000
const MS_DAY = 24 * 60 * 60 * 1000

export function pad2(n) {
  return String(n).padStart(2, '0')
}

export function toBizDate(value) {
  if (value == null || value === '') return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const shifted = new Date(d.getTime() + TZ_SHANGHAI)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

export function todayBizDate() {
  return toBizDate(Date.now())
}

export function addBizDays(dateKey, delta) {
  const [y, m, d] = String(dateKey).split('-').map((x) => parseInt(x, 10))
  if (!y || !m || !d) return ''
  const ms = Date.UTC(y, m - 1, d, 12, 0, 0, 0) + delta * MS_DAY
  const shifted = new Date(ms)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

export function dateKeysBetween(startDate, endDate) {
  const keys = []
  let cur = startDate
  let guard = 0
  while (cur && endDate && cur <= endDate && guard < 120) {
    keys.push(cur)
    cur = addBizDays(cur, 1)
    guard += 1
  }
  return keys
}

export function resolveRangePreset(preset) {
  const end = todayBizDate()
  if (preset === 'today') return { startDate: end, endDate: end, label: '今日' }
  if (preset === 'mtd') {
    return { startDate: `${end.slice(0, 7)}-01`, endDate: end, label: '本月' }
  }
  if (preset === '30') {
    return { startDate: addBizDays(end, -29), endDate: end, label: '近30日' }
  }
  // default 7
  return { startDate: addBizDays(end, -6), endDate: end, label: '近7日' }
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function fmtYuan(n, { empty = '0' } = {}) {
  const v = Number(n)
  if (!Number.isFinite(v)) return empty
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function toMs(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  const n = Number(v)
  if (Number.isFinite(n) && n > 1e11) return n
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 0 : d.getTime()
}

export function parseOrderAmount(order) {
  const n = Number(order?.totalPrice ?? order?.payAmount ?? order?.amount)
  return Number.isFinite(n) ? n : 0
}

export function parseRefundAmount(order) {
  const n = Number(order?.refundAmount)
  if (Number.isFinite(n) && n > 0) return n
  return parseOrderAmount(order)
}

export function isDepositOrder(order) {
  return order?.orderType === 'deposit' || order?.source === 'deposit'
}

export function isDepositBalanceOrder(order) {
  return (
    order?.orderType === 'deposit_balance' ||
    order?.source === 'deposit_balance' ||
    (!!order?.depositIntentId && Number(order?.depositCredit) > 0 && !isDepositOrder(order))
  )
}

export function isGiftOrder(order) {
  return (
    order?.orderType === 'gift' ||
    order?.source === 'gift' ||
    !!order?.giftMeta ||
    order?.fulfillmentType === 'gift'
  )
}

export function orderSourceBucket(order) {
  if (isGiftOrder(order)) return 'gift'
  if (isDepositOrder(order)) return 'deposit'
  if (isDepositBalanceOrder(order)) return 'deposit_balance'
  if (order?.orderType === 'custom' || order?.source === 'custom') return 'custom'
  return 'commerce'
}

export function orderMatchesStore(order, storeFilter) {
  if (!storeFilter || storeFilter === 'all') return true
  const sid = String(order?.storeId || order?.pickupStoreId || '').trim()
  if (!sid) return storeFilter === 'main' // 无门店字段的快递单归主店视图
  return sid === storeFilter || String(order?.storeCode || '') === storeFilter
}

/** 读取本地营收账本（含门店桥接后的记录） */
export function loadLedgerRecords() {
  try {
    const raw = localStorage.getItem(FINANCE_RECORDS_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function filterLedgerByRange(records, { startDate, endDate, storeId = 'all' } = {}) {
  const bundle = loadStoreBundle()
  return (records || []).filter((r) => {
    const dk = String(r?.date || r?.bizDate || '').slice(0, 10)
    if (!dk || dk < startDate || dk > endDate) return false
    return recordMatchesFinanceStoreFilter(r, storeId === 'main' ? bundle?.defaultStoreId || 'all' : storeId, bundle)
  })
}

export function summarizeLedger(records) {
  const byDate = {}
  let revenue = 0
  let orderCount = 0
  ;(records || []).forEach((r) => {
    const dk = String(r?.date || r?.bizDate || '').slice(0, 10)
    const rev = Number(r?.revenue) || 0
    const oc = Number(r?.orderCount) || 0
    revenue += rev
    orderCount += oc
    if (!byDate[dk]) byDate[dk] = { dateKey: dk, revenue: 0, orderCount: 0 }
    byDate[dk].revenue += rev
    byDate[dk].orderCount += oc
  })
  return { revenue: round2(revenue), orderCount, byDate }
}

/**
 * 从订单样本聚合周期内线上指标（不重复计兑换单）
 */
export function aggregateOrders(orders, { startDate, endDate, storeId = 'all' } = {}) {
  const dateKeys = dateKeysBetween(startDate, endDate)
  const dayAgg = {}
  dateKeys.forEach((dk) => {
    dayAgg[dk] = {
      dateKey: dk,
      paid: 0,
      gmvPaid: 0,
      refundAmount: 0,
      giftGmv: 0,
      depositGmv: 0,
      exchangeCount: 0,
    }
  })

  let gmvPaid = 0
  let refundAmount = 0
  let paid = 0
  let giftGmv = 0
  let depositGmv = 0
  let depositBalanceGmv = 0
  let commerceGmv = 0
  let customGmv = 0
  let exchangeCount = 0
  const categoryMap = {}

  ;(orders || []).forEach((o) => {
    if (!orderMatchesStore(o, storeId)) return

    if (isExchangeOrder(o)) {
      const dk = toBizDate(o.createTime || o.paidTime)
      if (dayAgg[dk]) {
        dayAgg[dk].exchangeCount += 1
        exchangeCount += 1
      }
      return
    }

    const st = String(o.status || '')
    const paidDk = toBizDate(o.paidTime || o.createTime)
    const refundDk = toBizDate(o.refundTime || o.updateTime || o.createTime)
    const amt = parseOrderAmount(o)
    const bucket = orderSourceBucket(o)

    if (PAID_STATUS.includes(st) && dayAgg[paidDk]) {
      dayAgg[paidDk].paid += 1
      dayAgg[paidDk].gmvPaid += amt
      paid += 1
      gmvPaid += amt
      if (bucket === 'gift') {
        dayAgg[paidDk].giftGmv += amt
        giftGmv += amt
      } else if (bucket === 'deposit') {
        dayAgg[paidDk].depositGmv += amt
        depositGmv += amt
      } else if (bucket === 'deposit_balance') {
        depositBalanceGmv += amt
      } else if (bucket === 'custom') {
        customGmv += amt
      } else {
        commerceGmv += amt
      }

      const products = Array.isArray(o.products) ? o.products : []
      if (products.length) {
        const lineSum = products.reduce((s, p) => {
          const lineAmt = Number(p.price != null ? p.price : p.unitPrice) || 0
          const qty = Math.max(1, Math.floor(Number(p.count || p.quantity) || 1))
          return s + lineAmt * qty
        }, 0)
        products.forEach((p) => {
          const cat = String(p.categoryType || p.rootCategoryName || 'OTHER').toUpperCase() || 'OTHER'
          const lineAmt = Number(p.price != null ? p.price : p.unitPrice) || 0
          const qty = Math.max(1, Math.floor(Number(p.count || p.quantity) || 1))
          const rawLine = lineAmt * qty
          const share = lineSum > 0 ? (rawLine / lineSum) * amt : amt / products.length
          if (!categoryMap[cat]) categoryMap[cat] = 0
          categoryMap[cat] += share
        })
      }
    }

    if (REFUND_STATUS.includes(st) && dayAgg[refundDk]) {
      const rAmt = parseRefundAmount(o)
      dayAgg[refundDk].refundAmount += rAmt
      refundAmount += rAmt
    }
  })

  const netOnline = round2(gmvPaid - refundAmount)
  const aov = paid > 0 ? round2(gmvPaid / paid) : 0
  const daily = dateKeys.map((dk) => {
    const row = dayAgg[dk]
    return {
      ...row,
      gmvPaid: round2(row.gmvPaid),
      refundAmount: round2(row.refundAmount),
      giftGmv: round2(row.giftGmv),
      depositGmv: round2(row.depositGmv),
      netOnline: round2(row.gmvPaid - row.refundAmount),
    }
  })

  const categoryShare = Object.entries(categoryMap)
    .map(([key, value]) => ({ key, value: round2(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)

  return {
    daily,
    totals: {
      paid,
      gmvPaid: round2(gmvPaid),
      refundAmount: round2(refundAmount),
      netOnline,
      aov,
      exchangeCount,
      mix: {
        commerce: round2(commerceGmv),
        gift: round2(giftGmv),
        deposit: round2(depositGmv),
        depositBalance: round2(depositBalanceGmv),
        custom: round2(customGmv),
      },
    },
    categoryShare,
    scanned: (orders || []).length,
    truncated: (orders || []).length >= ORDER_SCAN_MAX,
  }
}

export function donationFrom(baseAmount) {
  return round2((Number(baseAmount) || 0) * DONATION_RATE)
}

/** 定金意向状态漏斗（全量/采样列表计数，不按日期再滤时注明） */
export function summarizeDepositIntents(list) {
  const counts = {
    intent: 0,
    pending_pay: 0,
    deposit_paid: 0,
    awaiting_balance: 0,
    settled: 0,
    forfeited_open: 0,
    cancelled: 0,
    overdue: 0,
    other: 0,
  }
  let paidDepositFen = 0
  const now = Date.now()
  ;(list || []).forEach((row) => {
    const st = String(row?.status || 'other')
    if (counts[st] != null) counts[st] += 1
    else counts.other += 1
    const due = Number(row?.balanceDueAt)
    if (st === 'awaiting_balance' && Number.isFinite(due) && due > 0 && due < now) {
      counts.overdue += 1
    }
    if (st === 'deposit_paid' || st === 'awaiting_balance' || st === 'settled') {
      paidDepositFen += Number(row?.depositAmount) || 0
    }
  })
  return {
    counts,
    paidDepositYuan: round2(paidDepositFen / 100),
    openPipeline:
      counts.intent +
      counts.pending_pay +
      counts.deposit_paid +
      counts.awaiting_balance,
  }
}

export const CATEGORY_LABELS = {
  INSECTA: '昆虫',
  MINERALS: '矿石',
  PLANTAE: '植物',
  MARINE: '海洋',
  ANIMALIA: '动物',
  GENERAL: '综合',
  FRAMING: '装裱',
  OTHER: '其他',
}

export function categoryLabel(key) {
  return CATEGORY_LABELS[key] || key || '其他'
}

/**
 * 将 getAnalyticsDashboard report/orders 结果映射为驾驶舱与 aggregateOrders 同构的结构。
 * 综合营收仍由调用方用 localStorage 账本 + 线上净额合成。
 */
export function mapAnalyticsOrdersToAgg(ordersPayload = {}) {
  const totalsIn = ordersPayload.totals || {}
  const mixIn = totalsIn.mix || {}
  const daily = (ordersPayload.daily || []).map((d) => ({
    dateKey: d.dateKey,
    paid: Number(d.paid) || 0,
    gmvPaid: round2(d.gmvPaid),
    refundAmount: round2(d.refundAmount),
    giftGmv: round2(d.giftGmv),
    depositGmv: round2(d.depositGmv),
    exchangeCount: Number(d.exchangeCount) || 0,
    netOnline: round2(
      d.netOnline != null ? d.netOnline : (Number(d.gmvPaid) || 0) - (Number(d.refundAmount) || 0),
    ),
  }))

  const categoryShare = (ordersPayload.category?.byType || ordersPayload.categoryShare || []).map(
    (c) => ({
      key: c.key || c.label || 'OTHER',
      value: round2(c.value),
      label: c.label || categoryLabel(c.key),
    }),
  )

  return {
    daily,
    totals: {
      paid: Number(totalsIn.paid) || 0,
      gmvPaid: round2(totalsIn.gmvPaid),
      refundAmount: round2(totalsIn.refundAmount),
      netOnline: round2(totalsIn.netOnline),
      aov: round2(totalsIn.aov),
      exchangeCount: Number(totalsIn.exchangeCount) || 0,
      mix: {
        commerce: round2(mixIn.commerce),
        gift: round2(mixIn.gift),
        deposit: round2(mixIn.deposit),
        depositBalance: round2(mixIn.depositBalance),
        custom: round2(mixIn.custom),
      },
    },
    categoryShare,
    scanned: Number(totalsIn.paid) || daily.length,
    truncated: !!ordersPayload.truncated,
    source: 'getAnalyticsDashboard',
    notes: Array.isArray(ordersPayload.notes) ? ordersPayload.notes.slice() : [],
  }
}
