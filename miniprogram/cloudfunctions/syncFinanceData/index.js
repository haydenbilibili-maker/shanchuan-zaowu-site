/**
 * 财务 / 店长账本同步云函数
 * SSOT：store_ledger（门店日结）→ 镜像 finance_records（Admin ERP）
 * 兼容：daily_revenues（历史店长录入）三源合并
 * 小程序商城订单：reconcile_online_orders 写入 mp* 字段，不与门店 POS 混算
 *
 * 展示口径（与超管 Hub / 投资观测台一致）：
 * - 「线上」= 小程序已付 GMV（订单或 mpOnline），不是 ledger.online
 * - 「门店」= 账本净额（pos+现金收入+历史 online−退款），不含 mp*
 * - 历史 ledger.online 仍计入门店净额，UI 标为「遗留线上｜账本」
 * - 应捐 pledgeDue = max(0, mpOnline − mpRefund) × 1%（仅小程序净 GMV）
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')
const {
  DEFAULT_MALL_THRESHOLD,
  DEFAULT_MALL_RATE,
  computeMallCommission,
  formatMallForUi
} = require('./mallCommission')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const STORE_LEDGER = 'store_ledger'
const FINANCE_RECORDS = 'finance_records'
const FINANCE_SETTINGS = 'finance_settings'
/** 日结删除 tombstone：合并列表时排除，避免 finance_records / daily_revenues 再次带回 */
const LEDGER_DELETIONS = 'store_ledger_deletions'
const DEFAULT_STORE_ID = 'store_shanhaizaowu'
/**
 * Admin ERP 历史生成的主店 storeId，与 store_shanhaizaowu 为同一门店实体。
 * 查询/合并时必须扩展开，否则本月流水会被滤空。
 */
const MAIN_STORE_ALIAS_IDS = ['store_1780146782017_6w0okpr']
/** 投资人 / 超管账本总账：山川造物 + 星宸标本 */
const REPORT_STORES = [
  { storeId: 'store_shanhaizaowu', name: '山川造物', aliases: MAIN_STORE_ALIAS_IDS },
  { storeId: 'store_xingchen', name: '星宸标本', aliases: [] }
]
const _ = db.command

/** 小程序净 GMV × 1% 应捐（元）；与 C 端 onePercentPledge 分位口径一致 */
function calcPledgeDueFromMp(mpOnline, mpRefund) {
  const online = Number(mpOnline)
  const refund = Number(mpRefund)
  const mpO = Number.isFinite(online) ? online : 0
  const mpR = Number.isFinite(refund) ? refund : 0
  const mpNet = Math.round((mpO - mpR) * 100) / 100
  const base = Math.max(0, mpNet)
  const fen = Math.round(base * 100)
  const amount = Math.round(fen * 0.01) / 100
  return { mpNet, amount }
}

function normalizeStoreId(storeId) {
  const sid = String(storeId || '').trim()
  if (!sid || sid === 'default') return DEFAULT_STORE_ID
  if (MAIN_STORE_ALIAS_IDS.indexOf(sid) !== -1) return DEFAULT_STORE_ID
  // 多店账本：显式 store_xingchen 等保留，不再强制改写到主店
  return sid
}

/** 同一门店在库中可能出现的全部 storeId（用于 where.in 查询） */
function expandStoreIds(storeId) {
  const sid = normalizeStoreId(storeId)
  if (sid === DEFAULT_STORE_ID) {
    return [DEFAULT_STORE_ID].concat(MAIN_STORE_ALIAS_IDS)
  }
  return [sid]
}

/**
 * 行归属门店：空 storeId 仅视为历史主店（山川/山海），不得串到星宸等其它店。
 */
function resolveDocStoreId(rawStoreId) {
  const raw = String(rawStoreId || '').trim()
  if (!raw || raw === 'default') return DEFAULT_STORE_ID
  return normalizeStoreId(raw)
}

/** 文档是否属于目标门店（含主店别名；空 storeId 仅归属主店） */
function docBelongsToStore(doc, targetStoreId) {
  const target = normalizeStoreId(targetStoreId)
  const ids = expandStoreIds(target)
  const raw = String((doc && doc.storeId) || '').trim()
  if (!raw) return target === DEFAULT_STORE_ID
  const normalized = normalizeStoreId(raw)
  return normalized === target || ids.indexOf(raw) !== -1 || ids.indexOf(normalized) !== -1
}

function ledgerKey(record) {
  const store = resolveDocStoreId(record.storeId || record.storeCode)
  const date = String(record.date || record.bizDate || '').trim()
  return `${store}|${date}`
}

/** 记录时间戳：缺省为 0，禁止用 Date.now() 冒充「最新」以免冲掉渠道明细 */
function parseRecordTs(record) {
  if (!record) return 0
  const candidates = [
    record._updateTime,
    record.syncedAt,
    record.updateTime,
    record._createTime,
    record.createTime,
  ]
  for (const c of candidates) {
    if (c == null || c === '') continue
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c
    if (c instanceof Date) {
      const t = c.getTime()
      if (Number.isFinite(t) && t > 0) return t
    }
    if (typeof c === 'object' && c.$date != null) {
      const t = new Date(c.$date).getTime()
      if (Number.isFinite(t) && t > 0) return t
    }
    const t = new Date(c).getTime()
    if (Number.isFinite(t) && t > 0) return t
  }
  return 0
}

function resolveCashIncomeFields(record) {
  const hasBalance =
    record &&
    record.cashBalance != null &&
    record.cashBalance !== '' &&
    Number.isFinite(Number(record.cashBalance))
  const cashIncome = hasBalance
    ? Number(record.cashIncome) || 0
    : Number(record && (record.cashIncome ?? record.cash)) || 0
  return {
    hasBalance: !!hasBalance,
    cashIncome,
    cashBalance: hasBalance ? Number(record.cashBalance) || 0 : null,
  }
}

/** 是否含门店渠道金额（POS / 遗留线上 / 现金收入 / 退款）；在手现金单独处理 */
function hasChannelAmounts(record) {
  if (!record) return false
  const pos = Number(record.pos) || 0
  const online = Number(record.online) || 0
  const refund = Number(record.refundAmount ?? record.refund) || 0
  const { cashIncome } = resolveCashIncomeFields(record)
  return !!(pos || online || cashIncome || refund)
}

/** 是否含门店渠道明细（含在手现金余额） */
function hasChannelBreakdown(record) {
  if (!record) return false
  const { hasBalance } = resolveCashIncomeFields(record)
  return hasChannelAmounts(record) || hasBalance
}

function hasMpFields(record) {
  if (!record) return false
  return (
    record.mpOnline != null ||
    record.mpRefund != null ||
    record.mpOrderCount != null ||
    record.mpNet != null ||
    record.mpReconciledAt != null
  )
}

/**
 * 同日多源字段级合并：禁止「仅有净额」的新行整行覆盖「有渠道明细」的旧行；
 * mp* 与门店渠道各自取最完整来源。
 */
function mergeLedgerDayRecords(prev, incoming) {
  if (!prev) return { ...incoming }
  if (!incoming) return { ...prev }

  const prevTs = parseRecordTs(prev)
  const nextTs = parseRecordTs(incoming)
  const newer = nextTs >= prevTs ? incoming : prev
  const older = nextTs >= prevTs ? prev : incoming

  const amountSrc = hasChannelAmounts(newer)
    ? newer
    : hasChannelAmounts(older)
      ? older
      : null
  const balanceSrc =
    resolveCashIncomeFields(newer).hasBalance
      ? newer
      : resolveCashIncomeFields(older).hasBalance
        ? older
        : null
  const channelSrc = amountSrc || balanceSrc || newer
  const mpSrc = hasMpFields(newer) ? newer : hasMpFields(older) ? older : null
  const cashFields = resolveCashIncomeFields(channelSrc)
  const pos = amountSrc ? Number(amountSrc.pos) || 0 : Number(channelSrc.pos) || 0
  const online = amountSrc ? Number(amountSrc.online) || 0 : Number(channelSrc.online) || 0
  const refund = amountSrc
    ? Number(amountSrc.refundAmount ?? amountSrc.refund) || 0
    : Number(channelSrc.refundAmount ?? channelSrc.refund) || 0
  const cashIncome = amountSrc
    ? resolveCashIncomeFields(amountSrc).cashIncome
    : cashFields.cashIncome
  // 仅有在手现金、无渠道金额时，净额仍取 netAmount/revenue，避免被算成 0
  const net = amountSrc
    ? Math.max(0, pos + online + cashIncome - refund)
    : Number(newer.netAmount ?? newer.revenue ?? newer.total) ||
      Number(older.netAmount ?? older.revenue ?? older.total) ||
      0

  const merged = {
    ...older,
    ...newer,
    pos,
    online,
    cash: cashIncome,
    cashIncome,
    refund,
    refundAmount: refund,
    netAmount: net,
    revenue: net,
    grossAmount: pos + online + cashIncome,
    _updateTime: Math.max(prevTs, nextTs),
  }
  if (balanceSrc) {
    const bal = resolveCashIncomeFields(balanceSrc)
    if (bal.hasBalance) merged.cashBalance = bal.cashBalance
  } else if (cashFields.hasBalance) {
    merged.cashBalance = cashFields.cashBalance
  }

  if (mpSrc) {
    if (mpSrc.mpOnline != null) merged.mpOnline = Number(mpSrc.mpOnline) || 0
    if (mpSrc.mpRefund != null) merged.mpRefund = Number(mpSrc.mpRefund) || 0
    if (mpSrc.mpOrderCount != null) merged.mpOrderCount = Number(mpSrc.mpOrderCount) || 0
    if (mpSrc.mpNet != null) {
      merged.mpNet = Number(mpSrc.mpNet) || 0
    } else if (merged.mpOnline != null || merged.mpRefund != null) {
      merged.mpNet =
        Math.round(((Number(merged.mpOnline) || 0) - (Number(merged.mpRefund) || 0)) * 100) / 100
    }
    if (merged.mpOnline != null || merged.mpRefund != null || merged.mpNet != null) {
      const pledge = calcPledgeDueFromMp(merged.mpOnline, merged.mpRefund)
      if (merged.mpNet == null) merged.mpNet = pledge.mpNet
      merged.pledgeDue =
        mpSrc.pledgeDue != null && Number.isFinite(Number(mpSrc.pledgeDue))
          ? Math.max(0, Number(mpSrc.pledgeDue))
          : pledge.amount
    }
    if (mpSrc.mpReconciledAt != null) merged.mpReconciledAt = mpSrc.mpReconciledAt
  }

  return merged
}

/** 与店长账本卡片 NET 一致：POS+线上+遗留现金收入−退款；cashBalance（在手现金）不计入 */
function rowNetAmount(record) {
  const pos = Number(record.pos) || 0
  const online = Number(record.online) || 0
  const refund = Number(record.refundAmount ?? record.refund) || 0
  const { cashIncome } = resolveCashIncomeFields(record)
  const netField = Number(record.netAmount ?? record.revenue ?? record.total) || 0
  if (pos || online || cashIncome || refund) {
    return Math.max(0, pos + online + cashIncome - refund)
  }
  return netField
}

function monthDateRange() {
  const endKey = toBizDate(Date.now())
  const startKey = `${endKey.slice(0, 7)}-01`
  return {
    startDate: startKey,
    endDate: endKey,
  }
}

function normalizeDateStr(date) {
  if (!date) return ''
  const m = String(date).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!m) return String(date).trim()
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

function dbErrorText(err) {
  if (!err) return ''
  return [err.message, err.errMsg, err.msg, String(err.code || ''), String(err.errCode || '')]
    .filter(Boolean)
    .join(' ')
}

/** 集合尚未创建时 query.get 会报 -502005，视为空集 */
function isDbCollectionMissing(err) {
  return /502005|-502005|DATABASE_COLLECTION_NOT_EXIST|collection not exist|Db or Table not exist/i.test(
    dbErrorText(err),
  )
}

/** Asia/Shanghai 营业日（云函数默认 UTC，统一按东八区切日） */
function toBizDate(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const shifted = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseOrderYuan(order) {
  if (!order) return 0
  const raw = order.totalPrice ?? order.payAmount ?? order.amount ?? 0
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  const n = parseFloat(String(raw).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** 按日期范围分页拉取（读路径用，避免全表扫描超时） */
async function fetchInDateRange(collectionName, startDate, endDate, options = {}) {
  const { maxRows = 400, storeId } = options
  const all = []
  let skip = 0
  const pageSize = 100

  while (all.length < maxRows) {
    const where = { date: _.gte(startDate).and(_.lte(endDate)) }
    if (storeId && collectionName === STORE_LEDGER) {
      const ids = expandStoreIds(storeId)
      where.storeId = ids.length > 1 ? _.in(ids) : ids[0]
    }

    let batch = []
    try {
      const res = await db
        .collection(collectionName)
        .where(where)
        .orderBy('date', 'desc')
        .skip(skip)
        .limit(pageSize)
        .get()
      batch = res.data || []
    } catch (err) {
      const res = await db
        .collection(collectionName)
        .where(where)
        .skip(skip)
        .limit(pageSize)
        .get()
      batch = res.data || []
    }

    if (!batch.length) break
    all.push(...batch)
    if (batch.length < pageSize) break
    skip += pageSize
  }

  return all
}

/** 分页拉全量（仅 upload / 迁移等写路径使用） */
async function fetchAllOrdered(collectionName, orderField, direction = 'desc', maxRows = 5000) {
  const all = []
  let skip = 0
  const pageSize = 100

  while (all.length < maxRows) {
    let query = db.collection(collectionName)
    if (orderField) {
      query = query.orderBy(orderField, direction)
    }
    const res = await query.skip(skip).limit(pageSize).get()
    const batch = res.data || []
    if (!batch.length) break
    all.push(...batch)
    if (batch.length < pageSize) break
    skip += pageSize
  }

  return all
}

async function fetchExistingByKeyInRange(collectionName, keyFn, startDate, endDate) {
  const rows = await fetchInDateRange(collectionName, startDate, endDate)
  return new Map(rows.map((d) => [keyFn(d), d]))
}

async function fetchExistingByKey(collectionName, keyFn, maxRows = 5000) {
  const rows = await fetchAllOrdered(collectionName, 'date', 'desc', maxRows)
  return new Map(rows.map((d) => [keyFn(d), d]))
}

function sumRecordsInRange(records, startDate, endDate) {
  let total = 0
  let dayCount = 0
  let pos = 0
  let cash = 0
  let online = 0
  let refund = 0
  let totalOrderCount = 0
  let mpOnline = 0
  let mpRefund = 0
  let mpOrderCount = 0
  const daily = []

  for (const record of records) {
    const date = normalizeDateStr(record.date || record.bizDate)
    if (!date || date < startDate || date > endDate) continue
    const p = Number(record.pos) || 0
    const hasBalance =
      record.cashBalance != null &&
      record.cashBalance !== '' &&
      Number.isFinite(Number(record.cashBalance))
    const c = hasBalance
      ? Number(record.cashIncome) || 0
      : Number(record.cashIncome ?? record.cash) || 0
    const o = Number(record.online) || 0
    const rf = Number(record.refundAmount ?? record.refund) || 0
    const oc = Number(record.orderCount) || 0
    const mpO = Number(record.mpOnline) || 0
    const mpR = Number(record.mpRefund) || 0
    const mpOc = Number(record.mpOrderCount) || 0
    const dayPledge = calcPledgeDueFromMp(mpO, mpR)
    const net = rowNetAmount(record)
    pos += p
    cash += c
    online += o
    refund += rf
    total += net
    mpOnline += mpO
    mpRefund += mpR
    mpOrderCount += mpOc
    dayCount++
    if (oc > 0) totalOrderCount += oc
    daily.push({
      date,
      pos: p,
      cash: c,
      online: o,
      refund: rf,
      refundAmount: rf,
      orderCount: oc,
      netAmount: net,
      revenue: net,
      grossAmount: p + c + o,
      mpOnline: mpO,
      mpRefund: mpR,
      mpOrderCount: mpOc,
      mpNet: dayPledge.mpNet,
      pledgeDue: dayPledge.amount,
    })
  }

  daily.sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const grossAmount = pos + cash + online
  const daysWithData = dayCount
  const avgOrderPrice = totalOrderCount > 0 ? total / totalOrderCount : null
  const dailyOrders = daysWithData > 0 ? totalOrderCount / daysWithData : 0
  const dailyRev = daysWithData > 0 ? total / daysWithData : 0
  const rangePledge = calcPledgeDueFromMp(mpOnline, mpRefund)

  return {
    total,
    dayCount,
    daysWithData,
    pos,
    cash,
    online,
    refund,
    refundAmount: refund,
    grossAmount,
    netAmount: total,
    revenue: total,
    totalOrderCount,
    avgOrderPrice,
    customerPrice: avgOrderPrice,
    dailyOrders,
    dailyRev,
    mpOnline: Math.round(mpOnline * 100) / 100,
    mpRefund: Math.round(mpRefund * 100) / 100,
    mpOrderCount,
    mpNet: rangePledge.mpNet,
    pledgeDue: rangePledge.amount,
    daily,
  }
}

function mergeDailyRows(dailyLists) {
  const byDate = new Map()
  ;(dailyLists || []).forEach((list) => {
    ;(list || []).forEach((row) => {
      const date = normalizeDateStr(row.date || row.bizDate)
      if (!date) return
      const prev = byDate.get(date) || {
        date,
        pos: 0,
        cash: 0,
        online: 0,
        refund: 0,
        refundAmount: 0,
        orderCount: 0,
        netAmount: 0,
        revenue: 0,
        grossAmount: 0,
        mpOnline: 0,
        mpRefund: 0,
        mpOrderCount: 0,
        mpNet: 0,
        pledgeDue: 0,
      }
      prev.pos += Number(row.pos) || 0
      prev.cash += Number(row.cash) || 0
      prev.online += Number(row.online) || 0
      prev.refund += Number(row.refund) || 0
      prev.refundAmount += Number(row.refundAmount != null ? row.refundAmount : row.refund) || 0
      prev.orderCount += Number(row.orderCount) || 0
      prev.netAmount += Number(row.netAmount != null ? row.netAmount : row.revenue) || 0
      prev.revenue = prev.netAmount
      prev.grossAmount += Number(row.grossAmount) || 0
      prev.mpOnline += Number(row.mpOnline) || 0
      prev.mpRefund += Number(row.mpRefund) || 0
      prev.mpOrderCount += Number(row.mpOrderCount) || 0
      byDate.set(date, prev)
    })
  })
  return Array.from(byDate.values())
    .map((row) => {
      const pledge = calcPledgeDueFromMp(row.mpOnline, row.mpRefund)
      return {
        ...row,
        pos: Math.round(row.pos * 100) / 100,
        cash: Math.round(row.cash * 100) / 100,
        online: Math.round(row.online * 100) / 100,
        refund: Math.round(row.refund * 100) / 100,
        refundAmount: Math.round(row.refundAmount * 100) / 100,
        netAmount: Math.round(row.netAmount * 100) / 100,
        revenue: Math.round(row.netAmount * 100) / 100,
        grossAmount: Math.round(row.grossAmount * 100) / 100,
        mpOnline: Math.round(row.mpOnline * 100) / 100,
        mpRefund: Math.round(row.mpRefund * 100) / 100,
        mpNet: pledge.mpNet,
        pledgeDue: pledge.amount,
      }
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

async function sumDualStoreLedger(startDate, endDate, { persist = false } = {}) {
  const storeSummaries = []
  for (let i = 0; i < REPORT_STORES.length; i++) {
    const store = REPORT_STORES[i]
    const mergedList = await buildMergedLedgerList(store.storeId, startDate, endDate)
    if (persist) await upsertStoreLedgerRecords(mergedList)
    const summary = sumRecordsInRange(mergedList, startDate, endDate)
    storeSummaries.push({ store, summary, merged: mergedList.length })
  }

  const daily = mergeDailyRows(storeSummaries.map((s) => s.summary.daily))
  const pos = storeSummaries.reduce((s, x) => s + (Number(x.summary.pos) || 0), 0)
  const cash = storeSummaries.reduce((s, x) => s + (Number(x.summary.cash) || 0), 0)
  const online = storeSummaries.reduce((s, x) => s + (Number(x.summary.online) || 0), 0)
  const refund = storeSummaries.reduce((s, x) => s + (Number(x.summary.refundAmount) || 0), 0)
  const total = storeSummaries.reduce((s, x) => s + (Number(x.summary.total) || 0), 0)
  const totalOrderCount = storeSummaries.reduce(
    (s, x) => s + (Number(x.summary.totalOrderCount) || 0),
    0
  )
  const mpOnline = storeSummaries.reduce((s, x) => s + (Number(x.summary.mpOnline) || 0), 0)
  const mpRefund = storeSummaries.reduce((s, x) => s + (Number(x.summary.mpRefund) || 0), 0)
  const mpOrderCount = storeSummaries.reduce(
    (s, x) => s + (Number(x.summary.mpOrderCount) || 0),
    0
  )
  const daysWithData = daily.filter((d) => (Number(d.netAmount) || 0) > 0 || (Number(d.orderCount) || 0) > 0).length
  const dayCount = daily.length
  const avgOrderPrice = totalOrderCount > 0 ? total / totalOrderCount : null
  const dailyOrders = daysWithData > 0 ? totalOrderCount / daysWithData : 0
  const dailyRev = daysWithData > 0 ? total / daysWithData : 0
  const rangePledge = calcPledgeDueFromMp(mpOnline, mpRefund)
  const byStore = storeSummaries.map(({ store, summary }) => {
    const value = Math.round((Number(summary.total) || 0) * 100) / 100
    const pct = total > 0 ? Math.round((value / total) * 1000) / 10 : 0
    return {
      storeId: store.storeId,
      name: store.name,
      value,
      valueFmt: value.toFixed(2),
      pct,
      barStyle: `width:${Math.max(pct > 0 ? 4 : 0, Math.min(100, pct))}%`,
      orderCount: Number(summary.totalOrderCount) || 0,
      daysWithData: Number(summary.daysWithData) || 0,
    }
  })
  const dates = daily.map((d) => d.date).filter(Boolean).sort()

  return {
    success: true,
    mode: 'dual',
    storeId: 'all',
    total: Math.round(total * 100) / 100,
    dayCount,
    daysWithData,
    pos: Math.round(pos * 100) / 100,
    cash: Math.round(cash * 100) / 100,
    online: Math.round(online * 100) / 100,
    refund: Math.round(refund * 100) / 100,
    refundAmount: Math.round(refund * 100) / 100,
    grossAmount: Math.round((pos + cash + online) * 100) / 100,
    netAmount: Math.round(total * 100) / 100,
    revenue: Math.round(total * 100) / 100,
    totalOrderCount,
    avgOrderPrice,
    customerPrice: avgOrderPrice,
    dailyOrders,
    dailyRev,
    mpOnline: Math.round(mpOnline * 100) / 100,
    mpRefund: Math.round(mpRefund * 100) / 100,
    mpOrderCount,
    mpNet: rangePledge.mpNet,
    pledgeDue: rangePledge.amount,
    daily,
    byStore,
    startDate,
    endDate,
    merged: storeSummaries.reduce((s, x) => s + x.merged, 0),
    dateRange: {
      startDate,
      endDate,
      min: dates[0] || null,
      max: dates[dates.length - 1] || null,
    },
    message: `${startDate} ~ ${endDate} 双店合计 ¥${(Math.round(total * 100) / 100).toFixed(2)}（山川造物 + 星宸标本）`,
  }
}

async function fetchLedgerDeletionKeys(sid, startDate, endDate) {
  const storeId = normalizeStoreId(sid)
  const ids = expandStoreIds(storeId)
  const keys = new Set()
  try {
    const res = await db
      .collection(LEDGER_DELETIONS)
      .where({
        storeId: ids.length > 1 ? _.in(ids) : ids[0],
        date: _.gte(startDate).and(_.lte(endDate)),
      })
      .limit(200)
      .get()
    ;(res.data || []).forEach((row) => {
      const d = normalizeDateStr(row.date)
      if (!d) return
      keys.add(row.key || ledgerKey({ storeId: row.storeId || storeId, date: d }))
    })
  } catch (err) {
    if (!isDbCollectionMissing(err)) {
      console.warn('fetchLedgerDeletionKeys', dbErrorText(err))
    }
  }
  return keys
}

async function upsertLedgerDeletion(sid, date, openid) {
  const storeId = normalizeStoreId(sid)
  const d = normalizeDateStr(date)
  if (!d) return
  const key = ledgerKey({ storeId, date: d })
  const payload = {
    key,
    storeId,
    date: d,
    deletedAt: Date.now(),
    deletedBy: openid || '',
  }
  let existing = { data: [] }
  try {
    existing = await db.collection(LEDGER_DELETIONS).where({ key }).limit(1).get()
  } catch (err) {
    if (!isDbCollectionMissing(err)) {
      console.warn('upsertLedgerDeletion lookup', dbErrorText(err))
    }
  }
  try {
    if (existing.data?.length) {
      await db.collection(LEDGER_DELETIONS).doc(existing.data[0]._id).update({ data: payload })
    } else {
      await db.collection(LEDGER_DELETIONS).add({
        data: { ...payload, _createTime: Date.now() },
      })
    }
  } catch (err) {
    console.error('upsertLedgerDeletion write', dbErrorText(err))
    throw err
  }
}

async function removeLedgerDocsInCollection(collectionName, sid, date) {
  const normDate = normalizeDateStr(date)
  if (!normDate) return 0
  const storeId = normalizeStoreId(sid)

  let rows = []
  try {
    const res = await db.collection(collectionName).where({ date: normDate }).limit(100).get()
    rows = res.data || []
  } catch (err) {
    console.warn(`removeLedgerDocsInCollection ${collectionName}`, err.message)
    return 0
  }

  // 三集合均按门店过滤：禁止「删星宸某日 → 误删山川同日」
  const toRemove = rows.filter((r) => {
    if (r.deleted === true) return true
    return docBelongsToStore(r, storeId)
  })
  await Promise.all(toRemove.map((r) => db.collection(collectionName).doc(r._id).remove()))
  return toRemove.length
}

async function deleteStoreLedgerDay(sid, date, ledgerId, openid) {
  const normDate = normalizeDateStr(date)
  if (!normDate) {
    return { success: false, message: '缺少有效营业日 date' }
  }

  let removedLedger = 0
  if (ledgerId) {
    try {
      await db.collection(STORE_LEDGER).doc(String(ledgerId)).remove()
      removedLedger += 1
    } catch (e) {
      /* _id 可能来自合并视图中的 finance_records，忽略单 doc 失败 */
    }
  }

  const [nLedger, nFinance, nDaily] = await Promise.all([
    removeLedgerDocsInCollection(STORE_LEDGER, sid, normDate),
    removeLedgerDocsInCollection(FINANCE_RECORDS, sid, normDate),
    removeLedgerDocsInCollection('daily_revenues', sid, normDate),
  ])

  try {
    await upsertLedgerDeletion(sid, normDate, openid)
  } catch (err) {
    console.error('deleteStoreLedgerDay tombstone', dbErrorText(err))
    return {
      success: false,
      message: '日流水已清理，但删除标记写入失败，请重试',
    }
  }

  return {
    success: true,
    message: '已删除',
    date: normDate,
    removed: {
      store_ledger: removedLedger + nLedger,
      finance_records: nFinance,
      daily_revenues: nDaily,
    },
  }
}

async function buildMergedLedgerList(sid, startDate, endDate) {
  const rangeStart = startDate || monthDateRange().startDate
  const rangeEnd = endDate || monthDateRange().endDate

  const [financeRows, dailyRows, ledgerRows, deletedKeys] = await Promise.all([
    fetchInDateRange(FINANCE_RECORDS, rangeStart, rangeEnd),
    fetchInDateRange('daily_revenues', rangeStart, rangeEnd, { maxRows: 120 }),
    fetchInDateRange(STORE_LEDGER, rangeStart, rangeEnd, { storeId: sid }),
    fetchLedgerDeletionKeys(sid, rangeStart, rangeEnd),
  ])

  const mergedMap = new Map()
  const normSid = normalizeStoreId(sid)

  const put = (record) => {
    const date = normalizeDateStr(record.date || record.bizDate)
    if (!date || date < rangeStart || date > rangeEnd) return
    if (record.deleted === true) return
    if (!docBelongsToStore(record, sid)) return
    const ts = parseRecordTs(record)
    const normalized = {
      ...record,
      storeId: normSid,
      date,
      bizDate: date,
      _updateTime: ts,
    }
    const key = ledgerKey(normalized)
    if (deletedKeys.has(key)) return
    const prev = mergedMap.get(key)
    if (!prev) {
      mergedMap.set(key, normalized)
      return
    }
    // 字段级合并：避免「仅净额」源整行覆盖渠道明细 / mp*
    mergedMap.set(key, mergeLedgerDayRecords(prev, normalized))
  }

  dailyRows.forEach((r) => {
    put({
      storeId: r.storeId,
      date: r.date,
      pos: r.pos || 0,
      online: r.online || 0,
      cash: r.cash || 0,
      cashBalance: r.cashBalance,
      refund: r.refund || 0,
      revenue: r.total || 0,
      netAmount: r.total || 0,
      source: 'daily_revenues',
      updateTime: r.updateTime,
      _updateTime: r.updateTime,
    })
  })

  financeRows.forEach((r) => put({ ...r }))

  ledgerRows.forEach((r) => {
    put({ ...r, date: r.date || r.bizDate })
  })

  return [...mergedMap.values()]
}

function toStoreLedgerDoc(record) {
  const pos = Number(record.pos) || 0
  const online = Number(record.online) || 0
  const refund = Number(record.refundAmount ?? record.refund) || 0
  const hasBalance =
    record.cashBalance != null &&
    record.cashBalance !== '' &&
    Number.isFinite(Number(record.cashBalance))
  const cashIncome = hasBalance
    ? Number(record.cashIncome) || 0
    : Number(record.cashIncome ?? record.cash) || 0
  const channelNet = Math.max(0, pos + online + cashIncome - refund)
  const hasChannels = pos || online || cashIncome || refund
  const gross = Number(record.grossAmount) || pos + online + cashIncome
  const net = hasChannels
    ? channelNet
    : Number(record.netAmount ?? record.revenue ?? record.total) || channelNet
  const date = normalizeDateStr(record.date || record.bizDate)

  const doc = {
    storeId: normalizeStoreId(record.storeId || DEFAULT_STORE_ID),
    storeCode: record.storeCode || '',
    storeName: record.storeName || '',
    date,
    bizDate: date,
    revenue: net,
    grossAmount: gross,
    refundAmount: refund,
    netAmount: net,
    orderCount: Number(record.orderCount) || 0,
    pos,
    online,
    cash: cashIncome,
    cashIncome,
    refund,
    channel: record.channel || 'offline_pos',
    raw: record.raw || record.remark || '',
    remark: record.raw || record.remark || '',
    source: record.source || 'store_manager',
    _updateTime: Date.now(),
    syncedAt: Date.now(),
  }
  if (hasBalance) doc.cashBalance = Number(record.cashBalance) || 0

  // 小程序商城对账字段（不计入门店 netAmount）
  if (record.mpOnline != null) doc.mpOnline = Number(record.mpOnline) || 0
  if (record.mpRefund != null) doc.mpRefund = Number(record.mpRefund) || 0
  if (record.mpOrderCount != null) doc.mpOrderCount = Number(record.mpOrderCount) || 0
  if (record.mpNet != null) doc.mpNet = Number(record.mpNet) || 0
  if (record.mpReconciledAt != null) doc.mpReconciledAt = record.mpReconciledAt
  if (doc.mpOnline != null || doc.mpRefund != null) {
    const pledge = calcPledgeDueFromMp(doc.mpOnline, doc.mpRefund)
    if (doc.mpNet == null) doc.mpNet = pledge.mpNet
    doc.pledgeDue =
      record.pledgeDue != null && Number.isFinite(Number(record.pledgeDue))
        ? Math.max(0, Number(record.pledgeDue))
        : pledge.amount
  }

  return doc
}

function toFinanceRecord(doc) {
  const ledger = toStoreLedgerDoc(doc)
  const payload = {
    date: ledger.date,
    storeId: ledger.storeId,
    storeCode: ledger.storeCode,
    storeName: ledger.storeName || '',
    revenue: ledger.netAmount,
    orderCount: ledger.orderCount,
    pos: ledger.pos,
    online: ledger.online,
    cash: ledger.cash,
    cashIncome: ledger.cashIncome,
    refund: ledger.refund,
    raw: ledger.raw,
    _updateTime: doc._updateTime || Date.now(),
    syncedAt: Date.now(),
  }
  if (ledger.cashBalance != null) payload.cashBalance = ledger.cashBalance
  if (ledger.mpOnline != null) payload.mpOnline = ledger.mpOnline
  if (ledger.mpRefund != null) payload.mpRefund = ledger.mpRefund
  if (ledger.mpOrderCount != null) payload.mpOrderCount = ledger.mpOrderCount
  if (ledger.mpNet != null) payload.mpNet = ledger.mpNet
  if (ledger.pledgeDue != null) payload.pledgeDue = ledger.pledgeDue
  if (ledger.mpReconciledAt != null) payload.mpReconciledAt = ledger.mpReconciledAt
  return payload
}

async function mirrorFinanceRecords(records) {
  if (!records?.length) return { mirrored: 0 }

  const byKey = await fetchExistingByKey(FINANCE_RECORDS, ledgerKey)
  const ops = []

  for (const record of records) {
    const payload = toFinanceRecord(record)
    if (!payload.date) continue
    const key = ledgerKey(payload)
    const prev = byKey.get(key)
    if (prev?._id) {
      ops.push(
        db.collection(FINANCE_RECORDS).doc(prev._id).update({
          data: { ...payload, _updateTime: Date.now(), syncedAt: Date.now() },
        }),
      )
    } else {
      ops.push(
        db.collection(FINANCE_RECORDS).add({
          data: {
            ...payload,
            _createTime: Date.now(),
            _updateTime: Date.now(),
            syncedAt: Date.now(),
          },
        }),
      )
    }
  }

  if (ops.length) await Promise.all(ops)
  return { mirrored: ops.length }
}

async function upsertStoreLedgerRecords(records) {
  if (!records?.length) return { added: 0, updated: 0, total: 0 }

  const dates = records
    .map((r) => normalizeDateStr(r.date || r.bizDate))
    .filter(Boolean)
    .sort()
  const rangeStart = dates[0]
  const rangeEnd = dates[dates.length - 1]
  const byKey = await fetchExistingByKeyInRange(STORE_LEDGER, ledgerKey, rangeStart, rangeEnd)

  let added = 0
  let updated = 0
  const ops = []

  for (const record of records) {
    const doc = toStoreLedgerDoc(record)
    if (!doc.date) continue
    const key = ledgerKey(doc)
    const prev = byKey.get(key)
    const newTs = record._updateTime || Date.now()

    if (prev?._id) {
      const prevTs = parseRecordTs(prev)
      if (newTs >= prevTs) {
        // 字段级合并：保留渠道明细与 mp*，避免净额-only / 对账行冲掉门店拆分
        const combined = mergeLedgerDayRecords(prev, {
          ...doc,
          _updateTime: newTs,
        })
        const clean = toStoreLedgerDoc(combined)
        ops.push(
          db.collection(STORE_LEDGER).doc(prev._id).update({
            data: {
              ...clean,
              _updateTime: Math.max(newTs, prevTs),
              syncedAt: Date.now(),
            },
          }),
        )
        updated++
      }
    } else {
      ops.push(
        db.collection(STORE_LEDGER).add({
          data: { ...doc, _createTime: Date.now(), _updateTime: newTs },
        }),
      )
      added++
    }
  }

  if (ops.length) await Promise.all(ops)
  return { added, updated, total: ops.length }
}

async function fetchOrdersPage(where, orderField, maxRows = 2000) {
  const all = []
  let skip = 0
  const pageSize = 100
  while (all.length < maxRows) {
    let batch = []
    try {
      const res = await db
        .collection('orders')
        .where(where)
        .orderBy(orderField, 'desc')
        .skip(skip)
        .limit(pageSize)
        .get()
      batch = res.data || []
    } catch (err) {
      const res = await db.collection('orders').where(where).skip(skip).limit(pageSize).get()
      batch = res.data || []
    }
    if (!batch.length) break
    all.push(...batch)
    if (batch.length < pageSize) break
    skip += pageSize
  }
  return all
}

/**
 * 按营业日汇总小程序商城支付/退款，写入 mp* 字段（不改门店 netAmount）
 * 口径：GMV = totalPrice（含运费、扣券后实付）；退款取 refundFee；时区 Asia/Shanghai
 */
async function reconcileOnlineOrders(sid, startDate, endDate, persist = true) {
  const paidOrders = await fetchOrdersPage(
    // 含礼赠待填址 / 填址超时退款中：已收款计入 GMV；退款日另计 mpRefund
    { status: _.in([
      'paid',
      'paid_awaiting_address',
      'shipped',
      'received',
      'refunding',
      'aftersales',
      'expired_refunding',
      'refunded'
    ]) },
    'paidTime',
    3000,
  )
  const byDate = new Map()

  const ensure = (date) => {
    if (!byDate.has(date)) {
      byDate.set(date, { mpOnline: 0, mpRefund: 0, mpOrderCount: 0 })
    }
    return byDate.get(date)
  }

  for (const order of paidOrders) {
    const paidDate = toBizDate(order.paidTime || order.createTime)
    if (!paidDate || paidDate < startDate || paidDate > endDate) continue
    const bucket = ensure(paidDate)
    // 已退款订单：支付日仍计 GMV，退款日另计 mpRefund（对账可见）
    bucket.mpOnline += parseOrderYuan(order)
    bucket.mpOrderCount += 1
  }

  const refunded = paidOrders.filter((o) => o.status === 'refunded' || o.refundFee != null)
  for (const order of refunded) {
    const refundDate = toBizDate(order.refundTime || order.paidTime)
    if (!refundDate || refundDate < startDate || refundDate > endDate) continue
    const fee =
      typeof order.refundFee === 'number'
        ? order.refundFee
        : parseFloat(String(order.refundFee || 0)) || 0
    if (!fee) continue
    ensure(refundDate).mpRefund += fee
  }

  const records = []
  for (const [date, agg] of byDate.entries()) {
    const pledge = calcPledgeDueFromMp(agg.mpOnline, agg.mpRefund)
    records.push({
      storeId: sid,
      date,
      // 不改门店渠道；仅附加 mp*
      pos: 0,
      online: 0,
      cash: 0,
      refund: 0,
      revenue: 0,
      netAmount: 0,
      grossAmount: 0,
      orderCount: 0,
      mpOnline: Math.round(agg.mpOnline * 100) / 100,
      mpRefund: Math.round(agg.mpRefund * 100) / 100,
      mpOrderCount: agg.mpOrderCount,
      mpNet: pledge.mpNet,
      pledgeDue: pledge.amount,
      mpReconciledAt: Date.now(),
      source: 'mp_reconcile',
      channel: 'miniprogram',
      raw: `小程序对账 ${date} GMV¥${agg.mpOnline} 退款¥${agg.mpRefund}`,
      _updateTime: Date.now(),
    })
  }

  // 合并进已有门店行：只更新 mp*，保留 POS 等
  let written = 0
  if (persist && records.length) {
    const byKey = await fetchExistingByKeyInRange(STORE_LEDGER, ledgerKey, startDate, endDate)
    const ops = []

    for (const rec of records) {
      const key = ledgerKey(rec)
      const prev = byKey.get(key)
      const mpPatch = {
        mpOnline: rec.mpOnline,
        mpRefund: rec.mpRefund,
        mpOrderCount: rec.mpOrderCount,
        mpNet: rec.mpNet,
        pledgeDue: rec.pledgeDue,
        mpReconciledAt: rec.mpReconciledAt,
        syncedAt: Date.now(),
      }

      if (prev?._id) {
        ops.push(db.collection(STORE_LEDGER).doc(prev._id).update({ data: mpPatch }))
      } else {
        ops.push(
          db.collection(STORE_LEDGER).add({
            data: {
              storeId: sid,
              storeCode: '',
              date: rec.date,
              bizDate: rec.date,
              revenue: 0,
              grossAmount: 0,
              refundAmount: 0,
              netAmount: 0,
              orderCount: 0,
              pos: 0,
              online: 0,
              cash: 0,
              refund: 0,
              channel: 'miniprogram',
              source: 'mp_reconcile',
              raw: rec.raw,
              remark: rec.raw,
              ...mpPatch,
              _createTime: Date.now(),
              _updateTime: Date.now(),
            },
          }),
        )
      }

      ops.push(
        (async () => {
          let match = null
          try {
            const fin = await db
              .collection(FINANCE_RECORDS)
              .where({ date: rec.date })
              .limit(20)
              .get()
            match =
              (fin.data || []).find((r) => normalizeStoreId(r.storeId || sid) === sid) ||
              (fin.data || [])[0] ||
              null
          } catch (e) {
            match = null
          }
          if (match?._id) {
            await db.collection(FINANCE_RECORDS).doc(match._id).update({ data: mpPatch })
          } else {
            await db.collection(FINANCE_RECORDS).add({
              data: {
                date: rec.date,
                storeId: sid,
                revenue: 0,
                orderCount: 0,
                ...mpPatch,
                _createTime: Date.now(),
                _updateTime: Date.now(),
                source: 'mp_reconcile',
              },
            })
          }
        })(),
      )
      written++
    }

    if (ops.length) await Promise.all(ops)
  }

  const days = [...byDate.entries()]
    .map(([date, agg]) => {
      const pledge = calcPledgeDueFromMp(agg.mpOnline, agg.mpRefund)
      return {
        date,
        mpOnline: Math.round(agg.mpOnline * 100) / 100,
        mpRefund: Math.round(agg.mpRefund * 100) / 100,
        mpOrderCount: agg.mpOrderCount,
        mpNet: pledge.mpNet,
        pledgeDue: pledge.amount,
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  const sumOnline = days.reduce((s, d) => s + d.mpOnline, 0)
  const sumRefund = days.reduce((s, d) => s + d.mpRefund, 0)
  const totalsPledge = calcPledgeDueFromMp(sumOnline, sumRefund)

  return {
    success: true,
    storeId: sid,
    startDate,
    endDate,
    days,
    totals: {
      mpOnline: Math.round(sumOnline * 100) / 100,
      mpRefund: Math.round(sumRefund * 100) / 100,
      mpNet: totalsPledge.mpNet,
      pledgeDue: totalsPledge.amount,
      dayCount: days.length,
    },
    written,
    message: `对账 ${days.length} 天：GMV ¥${sumOnline.toFixed(2)}，退款 ¥${sumRefund.toFixed(2)}`,
  }
}

/** 写同步 / 对账落库：仅超管（批量 ERP / 设置） */
async function assertFinanceWrite(openid, storeId) {
  return assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'syncFinanceData',
    requireSuperAdmin: true,
    storeId,
  })
}

/** 店长日结录入 / 删日：店长+超管，强制门店隔离（星宸/山川不串店） */
async function assertFinanceManagerWrite(openid, storeId) {
  return assertStaff(db, openid, {
    role: ROLE_MANAGER,
    storeId,
  })
}

/** 读合并 / 汇总：店长与超管均可（店长账本展示依赖此路径） */
async function assertFinanceRead(openid, storeId) {
  return assertStaff(db, openid, {
    role: ROLE_MANAGER,
    storeId,
  })
}

/** 投资人只读：账本下载与月汇总（禁止 persist / refresh 落库） */
async function assertFinanceInvestorRead(openid, storeId) {
  return assertStaff(db, openid, {
    permission: 'viewInvestorFinance',
    storeId,
  })
}

/**
 * 兼容旧集合 daily_revenues：按门店+日期 upsert，禁止同日跨店覆盖
 */
async function upsertDailyRevenueCompat(ledgerDoc) {
  const sid = normalizeStoreId(ledgerDoc.storeId)
  const date = normalizeDateStr(ledgerDoc.date)
  if (!date) return { ok: false, reason: 'bad_date' }

  const legacy = {
    date,
    pos: Number(ledgerDoc.pos) || 0,
    online: Number(ledgerDoc.online) || 0,
    cash: Number(ledgerDoc.cashIncome != null ? ledgerDoc.cashIncome : ledgerDoc.cash) || 0,
    cashBalance: ledgerDoc.cashBalance != null ? Number(ledgerDoc.cashBalance) || 0 : null,
    refund: Number(ledgerDoc.refund != null ? ledgerDoc.refund : ledgerDoc.refundAmount) || 0,
    total: Number(ledgerDoc.netAmount != null ? ledgerDoc.netAmount : ledgerDoc.revenue) || 0,
    storeId: sid,
    updateTime: Date.now(),
  }

  let match = null
  try {
    const old = await db.collection('daily_revenues').where({ date }).limit(50).get()
    match = (old.data || []).find((r) => docBelongsToStore(r, sid)) || null
  } catch (err) {
    if (isDbCollectionMissing(err)) return { ok: false, reason: 'missing_collection' }
    console.warn('upsertDailyRevenueCompat lookup', dbErrorText(err))
  }

  try {
    if (match && match._id) {
      await db.collection('daily_revenues').doc(match._id).update({ data: legacy })
      return { ok: true, op: 'update', id: match._id }
    }
    const add = await db.collection('daily_revenues').add({
      data: { ...legacy, _createTime: Date.now() },
    })
    return { ok: true, op: 'add', id: add._id }
  } catch (err) {
    console.warn('upsertDailyRevenueCompat write', dbErrorText(err))
    return { ok: false, reason: dbErrorText(err) }
  }
}

/**
 * 店长单日录入：store_ledger + daily_revenues 兼容 + finance_records 镜像
 */
async function upsertStoreLedgerDay(sid, record) {
  const storeId = normalizeStoreId(sid)
  const payload = {
    ...(record || {}),
    storeId,
  }
  const doc = toStoreLedgerDoc(payload)
  if (!doc.date) {
    return { success: false, message: '请提供营业日 date（YYYY-MM-DD）' }
  }
  // 强制以鉴权门店为准，忽略客户端串改 storeId
  doc.storeId = storeId

  const ledgerResult = await upsertStoreLedgerRecords([doc])
  const daily = await upsertDailyRevenueCompat(doc)
  const mirrorResult = await mirrorFinanceRecords([doc])

  return {
    success: true,
    storeId,
    date: doc.date,
    ...ledgerResult,
    dailyRevenue: daily,
    mirrored: mirrorResult.mirrored,
    message: `已保存 ${doc.date}（门店 ${storeId}）`,
  }
}

async function loadFinanceSettingsRaw() {
  try {
    const res = await db.collection(FINANCE_SETTINGS).orderBy('_updateTime', 'desc').limit(1).get()
    const row = res.data && res.data[0]
    if (!row) return null
    return (row.settings && typeof row.settings === 'object' ? row.settings : row) || null
  } catch (e) {
    return null
  }
}

function ensureMallDefaultsInSettings(raw) {
  const s = raw && typeof raw === 'object' ? { ...raw } : {}
  if (!Number.isFinite(Number(s.mallThreshold)) || Number(s.mallThreshold) < 0) {
    s.mallThreshold = DEFAULT_MALL_THRESHOLD
  }
  let rate = Number(s.mallRate)
  if (!Number.isFinite(rate) || rate < 0) {
    s.mallRate = DEFAULT_MALL_RATE
  } else if (rate > 1) {
    s.mallRate = rate / 100
  } else {
    s.mallRate = rate
  }
  return s
}

async function attachMallCommission(payload, monthRevenue) {
  const settings = ensureMallDefaultsInSettings(await loadFinanceSettingsRaw())
  const mall = formatMallForUi(computeMallCommission(monthRevenue, settings))
  return {
    ...payload,
    mall,
    mallCommission: mall,
    settings: {
      mallThreshold: settings.mallThreshold,
      mallRate: settings.mallRate,
      mallRatePct: Math.round(settings.mallRate * 1000) / 10
    }
  }
}

const FINANCE_READ_ACTIONS = {
  download_records: true,
  download_store_ledger: true,
  download_settings: true,
  refresh_store_ledger: true,
  sum_month_store_ledger: true,
}

/** 投资人允许的纯只读动作（不含 refresh 写回） */
const FINANCE_INVESTOR_READ_ACTIONS = {
  download_records: true,
  download_store_ledger: true,
  download_settings: true,
  sum_month_store_ledger: true,
}

/** 店长可写：单日录入 / 删日（门店隔离） */
const FINANCE_MANAGER_WRITE_ACTIONS = {
  upsert_store_ledger_day: true,
  delete_store_ledger_day: true,
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, records, settings, storeId } = event || {}

  try {
    const isRead = !!(action && FINANCE_READ_ACTIONS[action])
    const isManagerWrite = !!(action && FINANCE_MANAGER_WRITE_ACTIONS[action])
    let guard
    let investorMode = false
    if (isRead) {
      guard = await assertFinanceRead(openid, storeId)
      if (!guard.ok && FINANCE_INVESTOR_READ_ACTIONS[action]) {
        guard = await assertFinanceInvestorRead(openid, storeId)
        investorMode = !!(guard && guard.ok)
      }
    } else if (isManagerWrite) {
      guard = await assertFinanceManagerWrite(openid, storeId)
    } else {
      guard = await assertFinanceWrite(openid, storeId)
    }
    if (!guard.ok) {
      return { success: false, code: guard.code, message: guard.msg }
    }

    // 店长单日录入
    if (action === 'upsert_store_ledger_day') {
      const sid = normalizeStoreId(storeId || DEFAULT_STORE_ID)
      return await upsertStoreLedgerDay(sid, event.record || event.data || {})
    }

    // 上传账本 → store_ledger + 镜像 finance_records
    if (action === 'upload_records') {
      if (!records || !Array.isArray(records) || records.length === 0) {
        return { success: false, message: '记录数据为空' }
      }

      const ledgerResult = await upsertStoreLedgerRecords(records)
      const mirrorResult = await mirrorFinanceRecords(records)

      return {
        success: true,
        message: `store_ledger 同步 ${ledgerResult.total} 条（新增 ${ledgerResult.added}，更新 ${ledgerResult.updated}）；镜像 finance_records ${mirrorResult.mirrored} 条`,
        ...ledgerResult,
        mirrored: mirrorResult.mirrored,
      }
    }

    // 下载账本（默认 store_ledger，兼容旧客户端仍传 download_records）
    if (action === 'download_records' || action === 'download_store_ledger') {
      const limit = event.limit || 1000
      const sid = normalizeStoreId(storeId || DEFAULT_STORE_ID)
      const ids = expandStoreIds(sid)
      let query = db.collection(STORE_LEDGER)

      if (ids.length > 1) {
        query = query.where({ storeId: _.in(ids) })
      } else if (ids.length === 1) {
        query = query.where({ storeId: ids[0] })
      }

      const res = await query.orderBy('date', 'desc').limit(limit).get()
      const data = (res.data || []).map(toFinanceRecord)

      return {
        success: true,
        data,
        count: data.length,
      }
    }

    if (action === 'upload_settings') {
      if (!settings) {
        return { success: false, message: '设置数据为空' }
      }

      const normalized = ensureMallDefaultsInSettings(settings)
      const existing = await db.collection(FINANCE_SETTINGS).limit(1).get()
      const settingsData = {
        settings: normalized,
        _updateTime: Date.now(),
        syncedAt: Date.now(),
      }

      if (existing.data?.length) {
        const prev = existing.data[0]
        const prevTs = prev._updateTime || prev.syncedAt || 0
        const newTs = event.updateTime || Date.now()
        if (newTs > prevTs) {
          await db.collection(FINANCE_SETTINGS).doc(prev._id).update({ data: settingsData })
          return { success: true, message: '设置更新成功', settings: normalized }
        }
        return { success: true, message: '云端设置已是最新，无需更新', settings: normalized }
      }

      settingsData._createTime = Date.now()
      await db.collection(FINANCE_SETTINGS).add({ data: settingsData })
      return { success: true, message: '设置创建成功', settings: normalized }
    }

    if (action === 'download_settings') {
      const res = await db
        .collection(FINANCE_SETTINGS)
        .orderBy('_updateTime', 'desc')
        .limit(1)
        .get()

      const row = res.data?.length ? res.data[0] : null
      if (!row) {
        const defaults = ensureMallDefaultsInSettings(null)
        return {
          success: true,
          data: {
            settings: defaults,
            _updateTime: 0,
            isDefault: true
          }
        }
      }
      const normalized = ensureMallDefaultsInSettings(row.settings || row)
      return {
        success: true,
        data: {
          ...row,
          settings: normalized
        }
      }
    }

    /**
     * 合并 finance_records + daily_revenues + store_ledger → store_ledger
     * 解决 Web 已更新但店长页仍读旧 daily_revenues / 空 storeId 的问题
     */
    if (action === 'refresh_store_ledger') {
      const sid = normalizeStoreId(storeId || DEFAULT_STORE_ID)
      const listLimit = event.listLimit != null ? Number(event.listLimit) || 40 : 40
      const range = monthDateRange()
      const startDate = event.startDate || range.startDate
      const endDate = event.endDate || range.endDate
      // 默认落库回填渠道/mp*，避免列表只读合并后 SSOT 仍缺明细；投资人禁止写
      const persist = investorMode ? false : event.persist !== false

      const mergedList = await buildMergedLedgerList(sid, startDate, endDate)
      let ledgerResult = { added: 0, updated: 0, total: 0 }
      if (persist) {
        ledgerResult = await upsertStoreLedgerRecords(mergedList)
      }

      const monthRows = mergedList
        .filter((r) => {
          const d = normalizeDateStr(r.date || r.bizDate)
          return d && d >= startDate && d <= endDate
        })
        .sort((a, b) => normalizeDateStr(b.date).localeCompare(normalizeDateStr(a.date)))

      const dates = monthRows.map((r) => normalizeDateStr(r.date)).filter(Boolean).sort()

      return {
        success: true,
        message: `已合并 ${mergedList.length} 条 → store_ledger（写入 ${ledgerResult.total}）`,
        merged: mergedList.length,
        ...ledgerResult,
        data: monthRows.slice(0, listLimit),
        count: Math.min(monthRows.length, listLimit),
        monthTotal: monthRows.length,
        dateRange: { startDate, endDate, min: dates[0] || null, max: dates[dates.length - 1] || null },
      }
    }

    /**
     * 本月门店营收汇总（与账本卡片 NET 求和一致）
     */
    if (action === 'delete_store_ledger_day') {
      const sid = normalizeStoreId(storeId || DEFAULT_STORE_ID)
      const normDate = normalizeDateStr(event.date)
      if (!normDate) {
        return { success: false, message: '请提供营业日 date（YYYY-MM-DD）' }
      }
      return await deleteStoreLedgerDay(sid, normDate, event.ledgerId || event.id, openid)
    }

    if (action === 'sum_month_store_ledger') {
      const rawSid = String(storeId || DEFAULT_STORE_ID).trim()
      const range = monthDateRange()
      const startDate = event.startDate || range.startDate
      const endDate = event.endDate || range.endDate
      // 投资人只读：禁止 persist 写回 store_ledger
      const persist = investorMode ? false : event.persist === true

      // 双店总账：山川造物 + 星宸标本
      if (
        rawSid === 'all' ||
        rawSid === 'dual' ||
        rawSid === 'both' ||
        event.dualStore === true ||
        event.mode === 'dual'
      ) {
        const dual = await sumDualStoreLedger(startDate, endDate, { persist })
        return attachMallCommission(dual, dual.total || dual.netAmount || 0)
      }

      const sid = normalizeStoreId(rawSid)
      const mergedList = await buildMergedLedgerList(sid, startDate, endDate)
      if (persist) {
        await upsertStoreLedgerRecords(mergedList)
      }
      const summary = sumRecordsInRange(mergedList, startDate, endDate)
      const dates = summary.daily.map((d) => d.date).filter(Boolean).sort()
      const storeMeta = REPORT_STORES.find((s) => s.storeId === sid)
      const byStore = [
        {
          storeId: sid,
          name: (storeMeta && storeMeta.name) || sid,
          value: Math.round((Number(summary.total) || 0) * 100) / 100,
          valueFmt: (Math.round((Number(summary.total) || 0) * 100) / 100).toFixed(2),
          pct: 100,
          barStyle: 'width:100%',
          orderCount: Number(summary.totalOrderCount) || 0,
          daysWithData: Number(summary.daysWithData) || 0,
        },
      ]

      return attachMallCommission(
        {
          success: true,
          mode: 'single',
          storeId: sid,
          total: summary.total,
          dayCount: summary.dayCount,
          daysWithData: summary.daysWithData,
          pos: summary.pos,
          cash: summary.cash,
          online: summary.online,
          refund: summary.refund,
          refundAmount: summary.refundAmount,
          grossAmount: summary.grossAmount,
          netAmount: summary.netAmount,
          revenue: summary.revenue,
          totalOrderCount: summary.totalOrderCount,
          avgOrderPrice: summary.avgOrderPrice,
          customerPrice: summary.customerPrice,
          dailyOrders: summary.dailyOrders,
          dailyRev: summary.dailyRev,
          mpOnline: summary.mpOnline,
          mpRefund: summary.mpRefund,
          mpOrderCount: summary.mpOrderCount,
          mpNet: summary.mpNet,
          pledgeDue: summary.pledgeDue,
          daily: summary.daily,
          byStore,
          startDate,
          endDate,
          merged: mergedList.length,
          dateRange: {
            startDate,
            endDate,
            min: dates[0] || null,
            max: dates[dates.length - 1] || null,
          },
          message: `${startDate} ~ ${endDate} 共 ${summary.dayCount} 天，门店营收 ¥${summary.total}`,
        },
        summary.total || summary.netAmount || 0
      )
    }

    // 历史 daily_revenues → store_ledger（一次性迁移）
    if (action === 'sync_daily_revenues') {
      const limit = event.limit || 100
      const sid = storeId || DEFAULT_STORE_ID
      const dailyRes = await db
        .collection('daily_revenues')
        .orderBy('date', 'desc')
        .limit(limit)
        .get()

      const toMigrate = (dailyRes.data || []).map((r) => ({
        storeId: sid,
        date: r.date,
        pos: r.pos || 0,
        online: r.online || 0,
        cash: r.cash || 0,
        refund: r.refund || 0,
        revenue: r.total || 0,
        netAmount: r.total || 0,
        source: 'daily_revenues_migration',
        updateTime: r.updateTime,
        _updateTime: parseRecordTs({ updateTime: r.updateTime }),
      }))

      const ledgerResult = await upsertStoreLedgerRecords(toMigrate)
      await mirrorFinanceRecords(toMigrate)

      return {
        success: true,
        message: `迁移 ${ledgerResult.total} 条 daily_revenues → store_ledger`,
        synced: ledgerResult.total,
      }
    }

    // 小程序商城订单对账 → mp* 字段
    if (action === 'reconcile_online_orders') {
      const sid = normalizeStoreId(storeId || DEFAULT_STORE_ID)
      const range = monthDateRange()
      const startDate = event.startDate || range.startDate
      const endDate = event.endDate || range.endDate
      const persist = event.persist !== false
      return await reconcileOnlineOrders(sid, startDate, endDate, persist)
    }

    return { success: false, message: '未知操作类型' }
  } catch (error) {
    console.error('财务数据同步失败:', error)
    return {
      success: false,
      message: error.message || '同步失败',
      error: error.toString(),
    }
  }
}
