/**
 * 店长小程序 · store_ledger 集合读写
 * 与 Web admin/src/utils/storeLedgerSync.js 字段对齐
 */
const db = wx.cloud.database()
const _ = db.command

const STORE_LEDGER = 'store_ledger'

/** Admin ERP 主店历史 storeId，与 store_shanhaizaowu 同实体 */
const MAIN_STORE_ALIAS_IDS = ['store_1780146782017_6w0okpr', 'store_1780160394767_szo1k77', 'store_1780841157244_p48w0bx']

const { getPreferredStoreId } = require('../../../utils/storeHelper')
const { ensureOpenId } = require('../../../utils/orderScope')
const { rowNetFromChannels } = require('./financeDailyParse')
const { calcPledgeDueFromMp } = require('./pledgeDue')
const { computeMonthlyMallFee } = require('./mallCommission')

const DEFAULT_STORE_ID = 'store_shanhaizaowu'
/** 财务账本默认主店（与 Admin ERP 日结一致）；多店时由页面传入 storeId */
const FINANCE_STORE_ID = DEFAULT_STORE_ID

function ledgerKey(storeId, date) {
  return `${String(storeId || 'default').trim()}|${String(date || '').trim()}`
}

function rowNetAmount(doc) {
  return rowNetFromChannels(doc)
}

/** 展示用金额：统一两位小数（小程序 toLocaleString 位数选项不可靠） */
function formatMoney(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0.00'
  return v.toFixed(2)
}

function resolveCashBalance(doc) {
  if (doc == null) return null
  if (doc.cashBalance != null && doc.cashBalance !== '') {
    const n = Number(doc.cashBalance)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function resolveCashIncome(doc) {
  const hasBalance = resolveCashBalance(doc) != null
  if (hasBalance) return Number(doc.cashIncome) || 0
  return Number(doc.cashIncome ?? doc.cash) || 0
}

function ledgerToDisplayRow(doc) {
  const date = doc.date || doc.bizDate || ''
  const pos = Number(doc.pos) || 0
  const online = Number(doc.online) || 0
  const cashIncome = resolveCashIncome(doc)
  const cashBalance = resolveCashBalance(doc)
  const refund = Number(doc.refundAmount ?? doc.refund) || 0
  const total = rowNetAmount(doc)
  const mpOnline = Number(doc.mpOnline) || 0
  const mpRefund = Number(doc.mpRefund) || 0
  const pledge = calcPledgeDueFromMp(mpOnline, mpRefund)
  const mpNet =
    doc.mpNet != null && doc.mpNet !== '' && Number.isFinite(Number(doc.mpNet))
      ? Number(doc.mpNet)
      : pledge.mpNet
  const pledgeDue =
    doc.pledgeDue != null && doc.pledgeDue !== '' && Number.isFinite(Number(doc.pledgeDue))
      ? Math.max(0, Number(doc.pledgeDue))
      : pledge.amount
  return {
    _id: doc._id,
    date,
    day: date.length >= 10 ? date.slice(8, 10) : '',
    pos,
    online,
    cash: cashIncome,
    cashIncome,
    cashBalance: cashBalance != null ? cashBalance : 0,
    cashBalanceFmt: formatMoney(cashBalance != null ? cashBalance : 0),
    refund,
    total,
    totalFmt: formatMoney(total),
    posFmt: formatMoney(pos),
    onlineFmt: formatMoney(online),
    cashFmt: formatMoney(cashIncome),
    refundFmt: formatMoney(refund),
    orderCount: Number(doc.orderCount) || 0,
    storeId: doc.storeId || '',
    mpOnline,
    mpRefund,
    mpOnlineFmt: formatMoney(mpOnline),
    mpRefundFmt: formatMoney(mpRefund),
    mpOrderCount: Number(doc.mpOrderCount) || 0,
    mpNet,
    mpNetFmt: formatMoney(mpNet),
    pledgeDue,
    pledgeDueFmt: formatMoney(pledgeDue),
  }
}

function buildLedgerDoc(storeId, form) {
  const pos = parseFloat(form.pos || 0) || 0
  const online = parseFloat(form.online || 0) || 0
  const refund = parseFloat(form.refund || 0) || 0
  const hasBalanceField =
    form.cashBalance != null && String(form.cashBalance).trim() !== ''
  const cashBalance = hasBalanceField ? parseFloat(form.cashBalance) || 0 : null
  const cashIncome = hasBalanceField
    ? parseFloat(form.cashIncome || 0) || 0
    : parseFloat(form.cashIncome ?? form.cash ?? 0) || 0
  const gross = pos + online + cashIncome
  const net = Math.max(0, gross - refund)
  const date = form.date

  const doc = {
    storeId,
    storeCode: form.storeCode || '',
    date,
    bizDate: date,
    revenue: net,
    grossAmount: gross,
    refundAmount: refund,
    netAmount: net,
    orderCount: Number(form.orderCount) || 0,
    pos,
    online,
    cash: cashIncome,
    cashIncome,
    refund,
    channel: form.channel || 'offline_pos',
    raw: form.rawText || form.raw || '',
    remark: form.rawText || form.raw || form.remark || '',
    source: 'store_manager',
    _updateTime: Date.now(),
    syncedAt: Date.now(),
  }
  if (cashBalance != null) doc.cashBalance = cashBalance
  return doc
}

function toFinanceRecord(doc) {
  const row = ledgerToDisplayRow(doc)
  const payload = {
    date: row.date,
    storeId: doc.storeId || '',
    storeCode: doc.storeCode || '',
    revenue: row.total,
    orderCount: doc.orderCount || 0,
    pos: row.pos,
    online: row.online,
    cash: row.cashIncome,
    cashIncome: row.cashIncome,
    refund: row.refund,
    raw: doc.raw || doc.remark || '',
    _updateTime: doc._updateTime || doc.syncedAt || Date.now(),
    source: doc.source || 'store_manager',
  }
  if (resolveCashBalance(doc) != null) payload.cashBalance = resolveCashBalance(doc)
  return payload
}

/**
 * 账本门店归一：默认主店；Admin 历史别名 → 主店。
 * 多店账本：显式传入 store_xingchen 等不再强制改写到主店。
 * 注意：看板 GMV 等仍应显式传 FINANCE_STORE_ID，勿用 C 端 preferred 工坊。
 */
function normalizeStoreId(storeId) {
  let sid = String(storeId || '').trim()
  if (!sid || sid === 'default') sid = DEFAULT_STORE_ID
  if (MAIN_STORE_ALIAS_IDS.indexOf(sid) !== -1) sid = DEFAULT_STORE_ID
  return sid
}

function expandStoreIds(storeId) {
  const sid = normalizeStoreId(storeId)
  if (sid === DEFAULT_STORE_ID) {
    return [DEFAULT_STORE_ID].concat(MAIN_STORE_ALIAS_IDS)
  }
  return [sid]
}

/**
 * 行归属门店：空 storeId 仅视为历史主店，不得串到其它店。
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

/** 解析云函数返回（兼容 result 为 JSON 字符串） */
function unwrapCloudResult(res) {
  let result = res && res.result
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result)
    } catch (e) {
      return null
    }
  }
  return result && typeof result === 'object' ? result : null
}

/** 云函数调用前确保登录态（真机超管信任快进时 openid 可能尚未写入） */
async function ensureCloudUser() {
  try {
    await ensureOpenId(getApp())
  } catch (e) {
    console.warn('ensureCloudUser', e)
  }
}

function getTodayDateStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function normalizeDateStr(date) {
  if (!date) return ''
  const m = String(date).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!m) return String(date).trim()
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

async function fetchClientRange(collection, startDate, endDate) {
  try {
    const res = await db
      .collection(collection)
      .where({ date: _.and(_.gte(startDate), _.lte(endDate)) })
      .orderBy('date', 'desc')
      .limit(120)
      .get()
    return res.data || []
  } catch (err) {
    try {
      const res = await db
        .collection(collection)
        .where({ date: _.and(_.gte(startDate), _.lte(endDate)) })
        .limit(120)
        .get()
      return res.data || []
    } catch (err2) {
      console.warn(`读取 ${collection} 失败`, err2)
      return []
    }
  }
}

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

function hasChannelAmounts(record) {
  if (!record) return false
  const pos = Number(record.pos) || 0
  const online = Number(record.online) || 0
  const refund = Number(record.refundAmount ?? record.refund) || 0
  const cashIncome = resolveCashIncome(record)
  return !!(pos || online || cashIncome || refund)
}

function hasChannelBreakdown(record) {
  if (!record) return false
  return hasChannelAmounts(record) || resolveCashBalance(record) != null
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

/** 同日多源字段级合并（与云函数 syncFinanceData 对齐） */
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
    resolveCashBalance(newer) != null
      ? newer
      : resolveCashBalance(older) != null
        ? older
        : null
  const channelSrc = amountSrc || balanceSrc || newer
  const mpSrc = hasMpFields(newer) ? newer : hasMpFields(older) ? older : null
  const pos = amountSrc ? Number(amountSrc.pos) || 0 : Number(channelSrc.pos) || 0
  const online = amountSrc ? Number(amountSrc.online) || 0 : Number(channelSrc.online) || 0
  const cashIncome = amountSrc
    ? resolveCashIncome(amountSrc)
    : resolveCashIncome(channelSrc)
  const cashBalance = balanceSrc
    ? resolveCashBalance(balanceSrc)
    : resolveCashBalance(channelSrc)
  const refund = amountSrc
    ? Number(amountSrc.refundAmount ?? amountSrc.refund) || 0
    : Number(channelSrc.refundAmount ?? channelSrc.refund) || 0
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
    total: net,
    _updateTime: Math.max(prevTs, nextTs),
  }
  if (cashBalance != null) {
    merged.cashBalance = cashBalance
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

function mergeRecordsClient(sid, startDate, endDate, financeRows, dailyRows, ledgerRows) {
  const mergedMap = new Map()
  const normSid = normalizeStoreId(sid)

  const put = (record) => {
    if (record.deleted === true) return
    const date = normalizeDateStr(record.date || record.bizDate)
    if (!date || date < startDate || date > endDate) return
    if (!docBelongsToStore(record, normSid)) return
    const key = ledgerKey(normSid, date)
    const ts = parseRecordTs(record)
    const normalized = {
      ...record,
      storeId: normSid,
      date,
      bizDate: date,
      _updateTime: ts,
    }
    const prev = mergedMap.get(key)
    if (!prev) {
      mergedMap.set(key, normalized)
      return
    }
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
  ledgerRows.forEach((r) => put({ ...r, date: r.date || r.bizDate }))

  return [...mergedMap.values()].sort((a, b) =>
    normalizeDateStr(b.date).localeCompare(normalizeDateStr(a.date)),
  )
}

/** 云函数超时时的降级：客户端直接合并 finance_records + store_ledger */
async function mergeLedgerClient(storeId, startDate, endDate, listLimit = 31) {
  const sid = normalizeStoreId(storeId)
  const [financeRows, dailyRows, ledgerRows] = await Promise.all([
    fetchClientRange('finance_records', startDate, endDate),
    fetchClientRange('daily_revenues', startDate, endDate),
    fetchClientRange(STORE_LEDGER, startDate, endDate),
  ])
  const merged = mergeRecordsClient(sid, startDate, endDate, financeRows, dailyRows, ledgerRows)
  return merged.slice(0, listLimit).map(ledgerToDisplayRow)
}

async function sumMergedClient(storeId, startDate, endDate) {
  const sid = normalizeStoreId(storeId)
  const [financeRows, dailyRows, ledgerRows] = await Promise.all([
    fetchClientRange('finance_records', startDate, endDate),
    fetchClientRange('daily_revenues', startDate, endDate),
    fetchClientRange(STORE_LEDGER, startDate, endDate),
  ])
  const merged = mergeRecordsClient(sid, startDate, endDate, financeRows, dailyRows, ledgerRows)
  let total = 0
  merged.forEach((r) => { total += rowNetAmount(r) })
  return { total, rows: merged, dayCount: merged.length }
}

/**
 * 从云端合并 finance_records / daily_revenues → store_ledger 后返回列表
 * @param {string|number} [storeId]
 * @param {number|{ listLimit?: number, yearMonth?: string, startDate?: string, endDate?: string }} [limitOrOpts]
 */
async function refreshFromCloud(storeId, limitOrOpts = 40) {
  let sid = storeId
  let listLimit = 40
  let yearMonth
  let rangeOverride = null

  if (typeof storeId === 'number') {
    listLimit = storeId
    sid = undefined
  } else if (typeof limitOrOpts === 'number') {
    listLimit = limitOrOpts
  } else if (limitOrOpts && typeof limitOrOpts === 'object') {
    if (limitOrOpts.listLimit != null) listLimit = Number(limitOrOpts.listLimit) || 40
    yearMonth = limitOrOpts.yearMonth
    if (limitOrOpts.startDate && limitOrOpts.endDate) {
      rangeOverride = {
        startDate: normalizeDateStr(limitOrOpts.startDate),
        endDate: normalizeDateStr(limitOrOpts.endDate),
      }
    }
  }

  sid = normalizeStoreId(sid)
  const range = rangeOverride || getMonthDateRange(yearMonth)
  const { startDate, endDate } = range

  await ensureCloudUser()

  try {
    const res = await wx.cloud.callFunction({
      name: 'syncFinanceData',
      data: {
        action: 'refresh_store_ledger',
        storeId: sid || FINANCE_STORE_ID,
        listLimit,
        startDate,
        endDate,
      },
      timeout: 60000,
    })
    const result = unwrapCloudResult(res)
    if (!result || !result.success) {
      const msg = (result && (result.message || result.msg)) || '云端账本合并失败'
      const err = new Error(msg)
      err.code = result && result.code
      throw err
    }
    const rows = (result.data || []).map(ledgerToDisplayRow)
    const meta = result.dateRange || {}
    if (meta.max && meta.endDate && meta.max < meta.endDate) {
      console.warn(
        `账本最新日期 ${meta.max}，早于所选区间截止 ${meta.endDate}。` +
          '若 Web ERP 有更新，请在 /admin/ 财务页执行「同步到云端」。',
      )
    }
    return rows
  } catch (err) {
    console.warn('云函数合并失败，降级客户端合并 finance_records', err)
    return mergeLedgerClient(sid, startDate, endDate, listLimit)
  }
}

async function mergeCloudLedger() {
  const sid = normalizeStoreId()
  const startDate = getMonthStartDateStr()
  const endDate = getTodayDateStr()
  try {
    const res = await wx.cloud.callFunction({
      name: 'syncFinanceData',
      data: {
        action: 'refresh_store_ledger',
        storeId: sid,
        listLimit: 1,
        startDate,
        endDate,
      },
      timeout: 60000,
    })
    return !!res.result?.success
  } catch (err) {
    console.warn('mergeCloudLedger 失败，已跳过', err)
    return false
  }
}

/** 本月 1 号 YYYY-MM-DD */
function getMonthStartDateStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

/** 当前月 YYYY-MM */
function getCurrentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 指定月份的起止日期（含首尾）
 * @param {string} [yearMonth] YYYY-MM；缺省为本月
 * @returns {{ startDate: string, endDate: string, yearMonth: string }}
 */
function getMonthDateRange(yearMonth) {
  const fallback = getCurrentYearMonth()
  const m = String(yearMonth || fallback).trim().match(/^(\d{4})-(\d{1,2})/)
  const y = m ? m[1] : fallback.slice(0, 4)
  const month = m ? String(m[2]).padStart(2, '0') : fallback.slice(5, 7)
  const ym = `${y}-${month}`
  const startDate = `${ym}-01`
  const lastDay = new Date(Number(y), Number(month), 0).getDate()
  let endDate = `${ym}-${String(lastDay).padStart(2, '0')}`
  const today = getTodayDateStr()
  if (ym === today.slice(0, 7) && endDate > today) endDate = today
  return { startDate, endDate, yearMonth: ym }
}

function formatMonthLabel(yearMonth) {
  const { yearMonth: ym } = getMonthDateRange(yearMonth)
  const parts = ym.split('-')
  return `${parts[0]}年${Number(parts[1])}月`
}

async function sumMonthOffline(storeId, yearMonth) {
  const sid = normalizeStoreId(storeId || FINANCE_STORE_ID)
  const { startDate, endDate } = getMonthDateRange(yearMonth)

  await ensureCloudUser()

  try {
    const res = await wx.cloud.callFunction({
      name: 'syncFinanceData',
      data: { action: 'sum_month_store_ledger', storeId: sid, startDate, endDate },
      timeout: 60000,
    })
    const result = unwrapCloudResult(res)
    if (result && result.success) {
      return { total: Number(result.total) || 0, rows: [], dayCount: result.dayCount }
    }
    if (result && result.message) {
      console.warn('sum_month_store_ledger', result.code || '', result.message)
    }
  } catch (err) {
    console.warn('sum_month_store_ledger 云函数失败，降级客户端合并', err)
  }

  const { total, dayCount } = await sumMergedClient(sid, startDate, endDate)
  return { total, rows: [], dayCount }
}

/** 本地降级：分页 + 按日去重 + 与卡片相同 NET 公式 */
async function sumFromDateLocal(storeId, startDate, endDate) {
  const sid = normalizeStoreId(storeId)
  const end = endDate || getTodayDateStr()
  const byDate = new Map()
  let skip = 0
  const pageSize = 100

  while (true) {
    const res = await db
      .collection(STORE_LEDGER)
      .where({
        date: _.and(_.gte(startDate), _.lte(end)),
      })
      .skip(skip)
      .limit(pageSize)
      .get()

    const batch = res.data || []
    for (const r of batch) {
      const docStore = normalizeStoreId(r.storeId)
      if (docStore !== sid) continue
      const date = r.date || r.bizDate
      if (!date) continue
      const amt = rowNetAmount(r)
      const ts = r._updateTime || r.syncedAt || 0
      const prev = byDate.get(date)
      if (!prev || ts >= prev.ts) byDate.set(date, { amt, ts })
    }

    if (batch.length < pageSize) break
    skip += pageSize
  }

  let total = 0
  byDate.forEach((v) => { total += v.amt })
  return { total, rows: [], dayCount: byDate.size }
}

async function listRecent(storeId, limit = 31) {
  const sid = normalizeStoreId(storeId)
  const ids = expandStoreIds(sid)
  let rows = []

  try {
    const res = await db
      .collection(STORE_LEDGER)
      .where({ storeId: ids.length > 1 ? _.in(ids) : ids[0] })
      .orderBy('date', 'desc')
      .limit(limit)
      .get()
    rows = res.data || []
  } catch (err) {
    console.warn('store_ledger 按 storeId 查询失败，尝试宽松查询', err)
  }

  if (!rows.length) {
    try {
      const loose = await db
        .collection(STORE_LEDGER)
        .orderBy('date', 'desc')
        .limit(limit)
        .get()
      rows = (loose.data || []).filter((r) => {
        if (r.deleted === true) return false
        return docBelongsToStore(r, sid)
      })
    } catch (err) {
      console.warn('store_ledger 宽松查询失败', err)
    }
  }

  return rows.map(ledgerToDisplayRow)
}

/** 按月拉取 store_ledger（含别名；云合并为空时的本地回退） */
async function listByMonth(storeId, yearMonth) {
  const sid = normalizeStoreId(storeId)
  const { startDate, endDate } = getMonthDateRange(yearMonth)
  const ids = expandStoreIds(sid)
  let rows = []

  // 优先：仅按日期查（避免复合条件/索引在真机失败），再客户端按别名归一过滤
  try {
    const loose = await db
      .collection(STORE_LEDGER)
      .where({ date: _.and(_.gte(startDate), _.lte(endDate)) })
      .orderBy('date', 'desc')
      .limit(40)
      .get()
    rows = (loose.data || []).filter((r) => {
      if (r.deleted === true) return false
      return docBelongsToStore(r, sid)
    })
  } catch (err) {
    console.warn('store_ledger 按月宽松查询失败，尝试 storeId+date', err)
  }

  if (!rows.length) {
    try {
      const res = await db
        .collection(STORE_LEDGER)
        .where({
          storeId: ids.length > 1 ? _.in(ids) : ids[0],
          date: _.and(_.gte(startDate), _.lte(endDate)),
        })
        .orderBy('date', 'desc')
        .limit(40)
        .get()
      rows = res.data || []
    } catch (err) {
      console.warn('store_ledger 按月 storeId 查询失败', err)
    }
  }

  return rows
    .map(ledgerToDisplayRow)
    .filter((r) => r.date >= startDate && r.date <= endDate)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
}

async function mirrorToFinanceCloud(doc) {
  try {
    await wx.cloud.callFunction({
      name: 'syncFinanceData',
      data: {
        action: 'upload_records',
        records: [toFinanceRecord(doc)],
        storeId: doc.storeId,
      },
      timeout: 30000,
    })
  } catch (err) {
    console.warn('镜像 finance_records 失败（店长本地已写入 store_ledger）', err)
  }
}

// opts.checkDuplicate：同日已有日账则不写，抛 DUPLICATE_ENTRY（err.duplicate）
async function upsert(storeId, form, o = {}) {
  const sid = normalizeStoreId(storeId)
  const data = buildLedgerDoc(sid, form)
  await ensureCloudUser()
  let res
  try {
    res = await wx.cloud.callFunction({
      name: 'syncFinanceData',
      data: {
        action: 'upsert_store_ledger_day',
        storeId: sid,
        record: data,
        checkDuplicate: o.checkDuplicate === true,
        confirmDuplicate: o.confirmDuplicate === true,
      },
      timeout: 30000,
    })
  } catch (cfErr) {
    const raw = (cfErr && (cfErr.errMsg || cfErr.message)) || ''
    if (/502005|collection\.get:fail/i.test(raw)) {
      throw new Error('账本服务暂不可用，请稍后重试')
    }
    if (/FUNCTION_NOT_FOUND|501000/i.test(raw)) {
      throw new Error('请部署云函数 syncFinanceData 后再记一笔')
    }
    throw cfErr
  }
  const result = unwrapCloudResult(res)
  if (!result || !result.success) {
    let msg = (result && (result.message || result.msg)) || '保存失败'
    if (/无该门店|FORBIDDEN|无操作权限/i.test(String(msg))) {
      msg = '无该门店账本权限（请确认星宸/山川门店隔离）'
    }
    const err = new Error(msg)
    err.code = result && result.code
    if (result && result.duplicate) err.duplicate = result.duplicate
    throw err
  }
  return result.id || (result.date ? `${sid}|${result.date}` : '')
}

/**
 * 删除某日门店流水（须走云函数：客户端 remove 常 -502003；且列表为三源合并）
 * @param {string} [id] 合并视图 _id（可能非 store_ledger）
 * @param {{ date?: string, storeId?: string }} [opts] 营业日必填
 */
async function removeById(id, opts = {}) {
  const date = normalizeDateStr(opts.date)
  if (!date) {
    throw new Error('缺少营业日')
  }
  await ensureCloudUser()
  let res
  try {
    res = await wx.cloud.callFunction({
      name: 'syncFinanceData',
      data: {
        action: 'delete_store_ledger_day',
        storeId: normalizeStoreId(opts.storeId || FINANCE_STORE_ID),
        date,
        ledgerId: id || '',
      },
      timeout: 30000,
    })
  } catch (cfErr) {
    const raw = (cfErr && (cfErr.errMsg || cfErr.message)) || ''
    if (/502005|collection\.get:fail/i.test(raw)) {
      throw new Error('账本服务暂不可用，请稍后重试')
    }
    throw cfErr
  }
  const result = unwrapCloudResult(res)
  if (!result || !result.success) {
    let msg = (result && (result.message || result.msg)) || '删除失败'
    if (/502005|collection\.get:fail/i.test(String(msg))) {
      msg = '账本服务暂不可用，请稍后重试'
    }
    const err = new Error(msg)
    err.code = result && result.code
    throw err
  }
  return result
}

async function sumFromDate(storeId, startDate, endDate) {
  return sumFromDateLocal(storeId, startDate, endDate || getTodayDateStr())
}

async function listFromDate(storeId, startDate) {
  const sid = normalizeStoreId(storeId)
  const endDate = getTodayDateStr()
  try {
    const res = await wx.cloud.callFunction({
      name: 'syncFinanceData',
      data: {
        action: 'refresh_store_ledger',
        storeId: sid,
        listLimit: 31,
        startDate,
        endDate,
      },
      timeout: 60000,
    })
    if (res.result?.success) {
      return res.result.data || []
    }
  } catch (err) {
    console.warn('趋势图云端合并失败，降级客户端', err)
  }

  const [financeRows, dailyRows, ledgerRows] = await Promise.all([
    fetchClientRange('finance_records', startDate, endDate),
    fetchClientRange('daily_revenues', startDate, endDate),
    fetchClientRange(STORE_LEDGER, startDate, endDate),
  ])
  return mergeRecordsClient(sid, startDate, endDate, financeRows, dailyRows, ledgerRows)
}

/**
 * 由日流水行聚合月度总览（对齐 Admin 月报：Σ revenue/NET，渠道拆分，订单 KPI）
 * NET = POS + 遗留现金收入 + 历史 ledger.online − 退款（在手现金 cashBalance 不计入）
 * 「线上」展示条 = 小程序 mpOnline（已付 GMV），不再用账本 online 字段
 * 旧数据 ledger.online：仍计入门店净额，月报单独标为「遗留线上｜账本」
 */
function buildMonthOverview(rows, mallSettings) {
  const list = Array.isArray(rows) ? rows : []
  let pos = 0
  let cashIncome = 0
  let online = 0
  let mpOnline = 0
  let mpRefund = 0
  let refund = 0
  let net = 0
  let maxNet = 0
  let totalOrderCount = 0
  let cashBalance = null

  const sorted = list
    .slice()
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))

  const daily = []
  for (const r of sorted) {
    const p = Number(r.pos) || 0
    const o = Number(r.online) || 0
    const mpO = Number(r.mpOnline) || 0
    const mpR = Number(r.mpRefund) || 0
    const ci = resolveCashIncome(r)
    const bal = resolveCashBalance(r)
    if (bal != null) cashBalance = bal
    const rf = Number(r.refundAmount ?? r.refund) || 0
    const oc = Number(r.orderCount) || 0
    const n =
      r.total != null && r.total !== ''
        ? Number(r.total) || 0
        : rowNetAmount(r)
    pos += p
    cashIncome += ci
    online += o
    mpOnline += mpO
    mpRefund += mpR
    refund += rf
    net += n
    if (oc > 0) totalOrderCount += oc
    if (n > maxNet) maxNet = n
    const date = r.date || r.bizDate || ''
    daily.push({
      date,
      day: r.day || (date.length >= 10 ? date.slice(8, 10) : ''),
      net: n,
      pos: p,
      cash: ci,
      cashIncome: ci,
      cashBalance: bal != null ? bal : 0,
      online: o,
      mpOnline: mpO,
      mpRefund: mpR,
      refund: rf,
      orderCount: oc,
      revenue: n,
      netAmount: n,
    })
  }

  const dayCount = daily.length
  const daysWithData = dayCount
  const gross = pos + cashIncome + online
  const dailyAvg = daysWithData > 0 ? net / daysWithData : 0
  const dailyRev = dailyAvg
  const avgOrderPrice = totalOrderCount > 0 ? net / totalOrderCount : null
  const dailyOrders = daysWithData > 0 ? totalOrderCount / daysWithData : 0
  const hasOrderData = totalOrderCount > 0
  const trendMax = maxNet > 0 ? maxNet : 1
  const mpOnlineRounded = Math.round(mpOnline * 100) / 100
  const mpRefundRounded = Math.round(mpRefund * 100) / 100
  const pledgeRange = calcPledgeDueFromMp(mpOnlineRounded, mpRefundRounded)
  const mall = computeMonthlyMallFee(net, mallSettings)

  const pctOf = (v, base) => (base > 0 ? Math.round((v / base) * 1000) / 10 : 0)
  const mixBase = gross + mpOnlineRounded

  const channels = [
    {
      key: 'pos',
      label: '刷卡｜POS',
      value: pos,
      valueFmt: formatMoney(pos),
      pct: pctOf(pos, mixBase),
      color: 'brass',
      barStyle: `width:${pctOf(pos, mixBase)}%`,
    },
    {
      key: 'mp',
      label: '小程序｜GMV',
      value: mpOnlineRounded,
      valueFmt: formatMoney(mpOnlineRounded),
      pct: pctOf(mpOnlineRounded, mixBase),
      color: 'forest',
      barStyle: `width:${pctOf(mpOnlineRounded, mixBase)}%`,
    },
  ]
  if (cashIncome > 0) {
    channels.splice(1, 0, {
      key: 'cash',
      label: '现金收入｜遗留',
      value: cashIncome,
      valueFmt: formatMoney(cashIncome),
      pct: pctOf(cashIncome, mixBase),
      color: 'wood',
      barStyle: `width:${pctOf(cashIncome, mixBase)}%`,
    })
  }
  if (online > 0) {
    channels.push({
      key: 'legacy_online',
      label: '遗留线上｜账本',
      value: online,
      valueFmt: formatMoney(online),
      pct: pctOf(online, mixBase),
      color: 'muted',
      barStyle: `width:${pctOf(online, mixBase)}%`,
      hint: '旧录入 online，已计入门店净额；不计入「线上」条',
    })
  }

  let donutStyle = 'background:#262320'
  if (mixBase > 0) {
    const parts = []
    let acc = 0
    const pushSeg = (v, color) => {
      if (v <= 0) return
      const next = acc + (v / mixBase) * 100
      parts.push(`${color} ${acc}% ${next}%`)
      acc = next
    }
    pushSeg(pos, '#C4A76C')
    if (cashIncome > 0) pushSeg(cashIncome, '#8B6F47')
    pushSeg(mpOnlineRounded, '#2D5A3F')
    if (online > 0) pushSeg(online, '#6B6560')
    donutStyle = `background:conic-gradient(${parts.join(',')})`
  }

  const trend = daily.map((d, i) => {
    const h = Math.max(d.net > 0 ? 6 : 2, Math.round((d.net / trendMax) * 100))
    const showLabel = dayCount <= 16 || i === 0 || i === dayCount - 1 || Number(d.day) % 5 === 0
    return {
      ...d,
      barStyle: `height:${h}%`,
      label: showLabel ? d.day : '',
    }
  })

  const dailyOrdersFmt = daysWithData > 0 ? (Math.round(dailyOrders * 10) / 10).toFixed(1) : '—'
  const avgOrderPriceFmt = avgOrderPrice != null ? formatMoney(avgOrderPrice) : '—'
  const totalOrderCountFmt = hasOrderData ? String(totalOrderCount) : '0'
  const balShow = cashBalance != null ? cashBalance : 0

  return {
    empty: dayCount === 0,
    dayCount,
    daysWithData,
    pos,
    cash: cashIncome,
    cashIncome,
    cashBalance: balShow,
    cashBalanceFmt: formatMoney(balShow),
    online,
    onlineLegacy: online,
    mpOnline: mpOnlineRounded,
    mpRefund: mpRefundRounded,
    mpNet: pledgeRange.mpNet,
    mpNetFmt: formatMoney(pledgeRange.mpNet),
    /** 所选月份累计应捐：小程序净 GMV × 1%（扣退款；不含 POS/现金/遗留线上） */
    pledgeDue: pledgeRange.amount,
    pledgeDueFmt: formatMoney(pledgeRange.amount),
    /** 商场月累计超额抽成（与 ERP / finance_settings SSOT 对齐；页面可再以云端设置覆盖） */
    mallThreshold: mall.mallThreshold,
    mallThresholdFmt: mall.mallThresholdFmt,
    mallRatePct: mall.mallRatePct,
    mallExcess: mall.mallExcess,
    mallExcessFmt: mall.mallExcessFmt,
    mallFee: mall.mallFee,
    mallFeeFmt: mall.mallFeeFmt,
    baseAfterMall: mall.baseAfterMall,
    baseAfterMallFmt: mall.baseAfterMallFmt,
    mallHint: mall.formulaHint,
    mall: {
      threshold: mall.mallThreshold,
      thresholdFmt: mall.mallThresholdFmt,
      reached: mall.revenue,
      reachedFmt: formatMoney(mall.revenue),
      excess: mall.mallExcess,
      excessFmt: mall.mallExcessFmt,
      fee: mall.mallFee,
      feeFmt: mall.mallFeeFmt,
      ratePct: mall.mallRatePct,
      baseAfterMall: mall.baseAfterMall,
      baseAfterMallFmt: mall.baseAfterMallFmt,
      formulaNote: mall.formulaHint || mall.formulaNote
    },
    refund,
    gross,
    grossAmount: gross,
    net,
    netAmount: net,
    revenue: net,
    refundAmount: refund,
    netFmt: formatMoney(net),
    posFmt: formatMoney(pos),
    cashFmt: formatMoney(cashIncome),
    onlineFmt: formatMoney(online),
    mpOnlineFmt: formatMoney(mpOnlineRounded),
    mpRefundFmt: formatMoney(mpRefundRounded),
    refundFmt: formatMoney(refund),
    dailyAvg,
    dailyAvgFmt: formatMoney(dailyAvg),
    totalOrderCount,
    totalOrderCountFmt,
    hasOrderData,
    avgOrderPrice,
    avgOrderPriceFmt,
    customerPrice: avgOrderPrice,
    customerPriceFmt: avgOrderPriceFmt,
    dailyOrders,
    dailyOrdersFmt,
    dailyRev,
    dailyRevFmt: daysWithData > 0 ? formatMoney(dailyRev) : '—',
    orderHint: hasOrderData
      ? `按有营业日 ${daysWithData} 天均摊 · 账本 orderCount`
      : '账本暂无订单数，客单价待补录',
    legacyOnlineHint:
      online > 0
        ? `含历史账本 online ¥${formatMoney(online)}（计入门店净额，不计入线上条）`
        : '',
    channels,
    donutStyle,
    trend,
    daily,
  }
}


module.exports = {
  STORE_LEDGER,
  DEFAULT_STORE_ID,
  FINANCE_STORE_ID,
  ledgerKey,
  ledgerToDisplayRow,
  buildLedgerDoc,
  toFinanceRecord,
  getManagerStoreId: getPreferredStoreId,
  normalizeStoreId,
  mergeCloudLedger,
  getMonthStartDateStr,
  getCurrentYearMonth,
  getMonthDateRange,
  formatMonthLabel,
  formatMoney,
  buildMonthOverview,
  sumMonthOffline,
  refreshFromCloud,
  rowNetAmount,
  getTodayDateStr,
  listRecent,
  listByMonth,
  upsert,
  removeById,
  sumFromDate,
  listFromDate,
  calcPledgeDueFromMp,
}
