/**
 * 店长小程序账本 ↔ Web 财务桥接（store_ledger 集合）
 */
import { getCdnDatabase, fetchAllFromCollection } from './cloudbaseCdnDb.js'
import { FINANCE_RECORDS_KEY } from './financeLocalStorageKey.js'

export const STORE_LEDGER = 'store_ledger'
const STORE_BUNDLE_KEY = 'sc_store_bundle_v1'

/** 合并键：优先 storeCode（跨 finance_records / store_ledger 一致），否则 storeId，最后 default */
export function ledgerKey(record, dateOverride) {
  const date = String(dateOverride ?? record?.date ?? record?.bizDate ?? '').trim()
  const code = String(record?.storeCode || '').trim()
  const id = String(record?.storeId || '').trim()
  const store = code || id || 'default'
  return `${store}|${date}`
}

/** 按 ledgerKey 去重，保留 _updateTime 较新的一条 */
export function dedupeFinanceRecords(records) {
  return mergeRecords([], records || [])
}

export function toFinanceRecord(doc) {
  const date = doc.date || doc.bizDate || ''
  return {
    date,
    storeId: doc.storeId || '',
    storeCode: doc.storeCode || '',
    revenue: Number(doc.netAmount ?? doc.revenue ?? 0) || 0,
    orderCount: Number(doc.orderCount) || 0,
    avgOrderPrice: doc.avgOrderPrice ?? null,
    customerPrice: doc.customerPrice ?? null,
    raw: doc.raw || doc.remark || '',
    _updateTime: doc._updateTime || doc.syncedAt || Date.now(),
    source: doc.source || 'store_ledger',
  }
}

export function toStoreLedgerDoc(record) {
  const revenue = Number(record.revenue) || 0
  return {
    storeId: record.storeId || '',
    storeCode: record.storeCode || '',
    date: record.date,
    bizDate: record.date,
    revenue,
    grossAmount: record.grossAmount ?? revenue,
    refundAmount: Number(record.refundAmount) || 0,
    netAmount: record.netAmount ?? revenue,
    orderCount: Number(record.orderCount) || 0,
    avgOrderPrice: record.avgOrderPrice ?? null,
    customerPrice: record.customerPrice ?? null,
    channel: record.channel || 'offline_pos',
    raw: record.raw || '',
    remark: record.raw || '',
    source: record.source || 'web_admin',
    _updateTime: Date.now(),
    syncedAt: Date.now(),
  }
}

/** 按 storeId|date 合并，_updateTime 较新者胜出 */
export function mergeRecords(localRecords, cloudRecords) {
  const map = new Map()

  localRecords.forEach((row) => {
    const rec = toFinanceRecord(row)
    map.set(ledgerKey(rec, rec.date), {
      ...rec,
      updateTime: rec._updateTime || 0,
    })
  })

  cloudRecords.forEach((row) => {
    const rec = toFinanceRecord(row)
    const key = ledgerKey(rec, rec.date)
    const existing = map.get(key)
    const ts = rec._updateTime || 0
    const existingTs = existing?.updateTime || 0
    const existingRev = Number(existing?.revenue) || 0
    const cloudRev = Number(rec.revenue) || 0
    // 云端空营收不应覆盖本地有效数据（常见于本地未打时间戳时被旧云数据覆盖）
    if (
      existing &&
      ts > existingTs &&
      cloudRev === 0 &&
      existingRev > 0
    ) {
      return
    }
    if (!existing || ts > existingTs) {
      map.set(key, { ...rec, updateTime: ts })
    }
  })

  return [...map.values()]
    .map(({ updateTime, ...rec }) => rec)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
}

function readStoreBundle() {
  try {
    const raw = localStorage.getItem(STORE_BUNDLE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeStoreBundle(bundle) {
  localStorage.setItem(
    STORE_BUNDLE_KEY,
    JSON.stringify({ ...bundle, _v: 1, _updatedAt: Date.now() }),
  )
}

/** 将财务行同步进门店 bundle revenueEntries（店长后台展示用） */
export function upsertRevenueEntries(records) {
  const bundle = readStoreBundle()
  if (!bundle || !Array.isArray(bundle.revenueEntries)) {
    return { updated: false, count: 0 }
  }

  let count = 0
  for (const row of records) {
    if (!row.date) continue
    const storeId = row.storeId || ''
    const amount = Number(row.revenue) || 0
    const id = `rev_${storeId}_${row.date}`
    const idx = bundle.revenueEntries.findIndex(
      (e) => e.id === id || (e.storeId === storeId && e.bizDate === row.date),
    )
    const entry = {
      id,
      storeId,
      bizDate: row.date,
      channel: 'offline_pos',
      grossAmount: amount,
      refundAmount: 0,
      netAmount: amount,
      taxIncluded: true,
      remark: row.raw || '来自财务账本同步',
      files: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    if (idx >= 0) {
      bundle.revenueEntries[idx] = { ...bundle.revenueEntries[idx], ...entry }
    } else {
      bundle.revenueEntries.push(entry)
    }
    count++
  }

  if (count > 0) writeStoreBundle(bundle)
  return { updated: count > 0, count }
}

export async function fetchStoreLedger() {
  const rows = await fetchAllFromCollection(STORE_LEDGER, {
    orderField: 'date',
    direction: 'desc',
  })
  return dedupeFinanceRecords(rows.map(toFinanceRecord))
}

export async function pushStoreLedger(records) {
  if (!records?.length) return { success: true, pushed: 0 }

  const db = await getCdnDatabase()
  const deduped = dedupeFinanceRecords(records)
  const existingRows = await fetchAllFromCollection(STORE_LEDGER, {
    orderField: 'date',
    direction: 'desc',
  })

  const groups = new Map()
  for (const doc of existingRows) {
    const key = ledgerKey(doc, doc.date || doc.bizDate)
    const list = groups.get(key) || []
    list.push(doc)
    groups.set(key, list)
  }
  const pruneOps = []
  for (const [, docs] of groups) {
    if (docs.length <= 1) continue
    docs.sort((a, b) => (b._updateTime || b.syncedAt || 0) - (a._updateTime || a.syncedAt || 0))
    for (const stale of docs.slice(1)) {
      if (stale._id) pruneOps.push(db.collection(STORE_LEDGER).doc(stale._id).remove())
    }
  }
  if (pruneOps.length) await Promise.all(pruneOps)

  const freshRows = pruneOps.length
    ? await fetchAllFromCollection(STORE_LEDGER, { orderField: 'date', direction: 'desc' })
    : existingRows
  const byKey = new Map(
    freshRows.map((doc) => [ledgerKey(doc, doc.date || doc.bizDate), doc]),
  )

  const ops = []
  for (const row of deduped) {
    const doc = toStoreLedgerDoc(row)
    const key = ledgerKey(doc, doc.date)
    const prev = byKey.get(key)
    if (prev?._id) {
      ops.push(
        db.collection(STORE_LEDGER).doc(prev._id).update({
          ...doc,
          _updateTime: Date.now(),
        }),
      )
    } else {
      ops.push(
        db.collection(STORE_LEDGER).add({
          ...doc,
          _createTime: Date.now(),
        }),
      )
    }
  }

  await Promise.all(ops)
  return { success: true, pushed: deduped.length }
}

/** 拉取 store_ledger 合并进 shanhai_v12 与门店 bundle */
export async function pullStoreLedgerIntoFinance(localRecords) {
  try {
    const ledgerRows = await fetchStoreLedger()
    if (!ledgerRows.length) {
      return { success: true, merged: 0, records: localRecords }
    }

    const merged = mergeRecords(localRecords, ledgerRows)
    localStorage.setItem(FINANCE_RECORDS_KEY, JSON.stringify(merged))
    upsertRevenueEntries(merged)

    return {
      success: true,
      merged: merged.length,
      records: merged,
      storeCount: ledgerRows.length,
    }
  } catch (error) {
    console.error('店长账本拉取失败', error)
    return { success: false, error: error.message, records: localRecords }
  }
}

export async function syncStoreLedgerBidirectional(localRecords) {
  try {
    const pulled = await pullStoreLedgerIntoFinance(localRecords)
    if (!pulled.success) return pulled
    const pushed = await pushStoreLedger(pulled.records)
    return { ...pulled, ...pushed, success: true }
  } catch (error) {
    console.error('店长账本双向同步失败', error)
    return { success: false, error: error.message }
  }
}
