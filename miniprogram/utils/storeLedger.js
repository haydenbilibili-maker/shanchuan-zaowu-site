/**
 * 店长小程序 · store_ledger 集合读写
 * 与 Web admin/src/utils/storeLedgerSync.js 字段对齐
 */
const db = wx.cloud.database()
const _ = db.command

const STORE_LEDGER = 'store_ledger'

const { getPreferredStoreId } = require('./storeHelper')

function ledgerKey(storeId, date) {
  return `${String(storeId || 'default').trim()}|${String(date || '').trim()}`
}

function rowNetAmount(doc) {
  const pos = Number(doc.pos) || 0
  const online = Number(doc.online) || 0
  const cash = Number(doc.cash) || 0
  const refund = Number(doc.refundAmount ?? doc.refund) || 0
  const netField = Number(doc.netAmount ?? doc.revenue ?? doc.total) || 0
  if (pos || online || cash) {
    return Math.max(0, pos + online + cash - refund)
  }
  return netField
}

function ledgerToDisplayRow(doc) {
  const date = doc.date || doc.bizDate || ''
  const pos = Number(doc.pos) || 0
  const online = Number(doc.online) || 0
  const cash = Number(doc.cash) || 0
  const refund = Number(doc.refundAmount ?? doc.refund) || 0
  const total = rowNetAmount(doc)
  return {
    _id: doc._id,
    date,
    day: date.length >= 10 ? date.slice(8, 10) : '',
    pos,
    online,
    cash,
    refund,
    total,
    totalFmt: total.toLocaleString(),
    storeId: doc.storeId || '',
  }
}

function buildLedgerDoc(storeId, form) {
  const pos = parseFloat(form.pos || 0) || 0
  const online = parseFloat(form.online || 0) || 0
  const cash = parseFloat(form.cash || 0) || 0
  const refund = parseFloat(form.refund || 0) || 0
  const gross = pos + online + cash
  const net = gross - refund
  const date = form.date

  return {
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
    cash,
    refund,
    channel: form.channel || 'offline_pos',
    raw: form.rawText || form.raw || '',
    remark: form.rawText || form.raw || form.remark || '',
    source: 'store_manager',
    _updateTime: Date.now(),
    syncedAt: Date.now(),
  }
}

function toFinanceRecord(doc) {
  const row = ledgerToDisplayRow(doc)
  return {
    date: row.date,
    storeId: doc.storeId || '',
    storeCode: doc.storeCode || '',
    revenue: row.total,
    orderCount: doc.orderCount || 0,
    pos: row.pos,
    online: row.online,
    cash: row.cash,
    refund: row.refund,
    raw: doc.raw || doc.remark || '',
    _updateTime: doc._updateTime || doc.syncedAt || Date.now(),
    source: doc.source || 'store_manager',
  }
}

function normalizeStoreId(storeId) {
  const sid = String(storeId || getPreferredStoreId() || '').trim()
  if (!sid || sid === 'default') return 'store_shanhaizaowu'
  return sid
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

function mergeRecordsClient(sid, startDate, endDate, financeRows, dailyRows, ledgerRows) {
  const mergedMap = new Map()
  const normSid = normalizeStoreId(sid)

  const put = (record) => {
    const date = normalizeDateStr(record.date || record.bizDate)
    if (!date || date < startDate || date > endDate) return
    const docStore = normalizeStoreId(record.storeId || sid)
    if (docStore !== normSid) return
    const key = ledgerKey(docStore, date)
    const ts = record._updateTime || record.syncedAt || 0
    const prev = mergedMap.get(key)
    if (!prev || ts >= (prev._updateTime || prev.syncedAt || 0)) {
      mergedMap.set(key, { ...record, storeId: docStore, date, bizDate: date, _updateTime: ts })
    }
  }

  dailyRows.forEach((r) => {
    put({
      storeId: sid,
      date: r.date,
      pos: r.pos || 0,
      online: r.online || 0,
      cash: r.cash || 0,
      refund: r.refund || 0,
      revenue: r.total || 0,
      netAmount: r.total || 0,
      source: 'daily_revenues',
      _updateTime: r.updateTime ? new Date(r.updateTime).getTime() : Date.now(),
    })
  })
  financeRows.forEach((r) => put({ ...r, storeId: r.storeId || sid }))
  ledgerRows.forEach((r) => put({ ...r, storeId: sid, date: r.date || r.bizDate }))

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

/** 从云端合并 finance_records / daily_revenues → store_ledger 后返回列表 */
async function refreshFromCloud(storeId, limit = 31) {
  let sid = storeId
  let listLimit = limit
  if (typeof storeId === 'number') {
    listLimit = storeId
    sid = undefined
  }
  sid = normalizeStoreId(sid)
  const startDate = getMonthStartDateStr()
  const endDate = getTodayDateStr()

  try {
    const res = await wx.cloud.callFunction({
      name: 'syncFinanceData',
      data: {
        action: 'refresh_store_ledger',
        storeId: sid,
        listLimit,
        startDate,
        endDate,
      },
      timeout: 60000,
    })
    if (!res.result?.success) {
      throw new Error(res.result?.message || '云端账本合并失败')
    }
    const rows = (res.result.data || []).map(ledgerToDisplayRow)
    const meta = res.result.dateRange || {}
    if (meta.max && meta.endDate && meta.max < meta.endDate) {
      console.warn(
        `账本最新日期 ${meta.max}，早于今日 ${meta.endDate}。` +
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

async function sumMonthOffline(storeId) {
  const sid = normalizeStoreId(storeId)
  const startDate = getMonthStartDateStr()
  const endDate = getTodayDateStr()

  try {
    const res = await wx.cloud.callFunction({
      name: 'syncFinanceData',
      data: { action: 'sum_month_store_ledger', storeId: sid, startDate, endDate },
      timeout: 60000,
    })
    if (res.result?.success) {
      return { total: Number(res.result.total) || 0, rows: [], dayCount: res.result.dayCount }
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
  let rows = []

  try {
    const res = await db
      .collection(STORE_LEDGER)
      .where({ storeId: sid })
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
        const docStore = r.storeId || ''
        return !docStore || docStore === sid || docStore === 'default'
      })
    } catch (err) {
      console.warn('store_ledger 宽松查询失败', err)
    }
  }

  return rows.map(ledgerToDisplayRow)
}

async function upsert(storeId, form) {
  const sid = storeId || getPreferredStoreId()
  const data = buildLedgerDoc(sid, form)
  const check = await db
    .collection(STORE_LEDGER)
    .where({ storeId: sid, date: data.date })
    .limit(1)
    .get()

  if (check.data?.length) {
    await db.collection(STORE_LEDGER).doc(check.data[0]._id).update({ data })
    return check.data[0]._id
  }

  const add = await db.collection(STORE_LEDGER).add({
    data: { ...data, _createTime: Date.now() },
  })
  return add._id
}

async function removeById(id) {
  await db.collection(STORE_LEDGER).doc(id).remove()
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

module.exports = {
  STORE_LEDGER,
  ledgerKey,
  ledgerToDisplayRow,
  buildLedgerDoc,
  toFinanceRecord,
  getManagerStoreId: getPreferredStoreId,
  normalizeStoreId,
  mergeCloudLedger,
  getMonthStartDateStr,
  sumMonthOffline,
  refreshFromCloud,
  rowNetAmount,
  getTodayDateStr,
  listRecent,
  upsert,
  removeById,
  sumFromDate,
  listFromDate,
}
