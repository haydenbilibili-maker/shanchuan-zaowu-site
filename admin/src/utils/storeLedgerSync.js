/**
 * 店长小程序账本 ↔ Web 财务桥接（store_ledger 集合）
 */
import { fetchAllFromCollection, callCdnFunction } from './cloudbaseCdnDb.js'
import { FINANCE_RECORDS_KEY } from './financeLocalStorageKey.js'

export const STORE_LEDGER = 'store_ledger'
const STORE_BUNDLE_KEY = 'sc_store_bundle_v1'

/**
 * 合并键：归属后门店 | 营业日（与 syncFinanceData.ledgerKey、日报按店拆分同一规则）。
 * 旧版用 `storeCode || storeId`：主店行 storeCode 为空、旧主店 id 行带 CCYS001 → 同日两条都计入合计
 * （2025-11 / 2026-05 共 8 天虚增 ¥45,902.04），且云端删掉一条后本机缓存会把它再推回去。
 */
export function ledgerKey(record, dateOverride) {
  const date = String(dateOverride ?? record?.date ?? record?.bizDate ?? '').trim()
  return `${canonicalLedgerStoreId(record)}|${date}`
}

/** 按 ledgerKey 去重，保留 _updateTime 较新的一条 */
export function dedupeFinanceRecords(records) {
  return mergeRecords([], records || [])
}

import { rowNetFromChannels } from './financeDailyParse.js'
import { canonicalLedgerStoreId, compareForKeep } from './financeDuplicateCheck.js'

export function toFinanceRecord(doc) {
  const date = doc.date || doc.bizDate || ''
  const pos = Number(doc.pos) || 0
  const online = Number(doc.online) || 0
  const refund = Number(doc.refundAmount ?? doc.refund) || 0
  const cashBalance =
    doc.cashBalance != null && doc.cashBalance !== '' ? Number(doc.cashBalance) : null
  const hasBalance = cashBalance != null && Number.isFinite(cashBalance)
  const cashIncome = hasBalance
    ? Number(doc.cashIncome) || 0
    : Number(doc.cashIncome ?? doc.cash) || 0
  const revenue =
    pos || online || cashIncome || refund
      ? rowNetFromChannels(doc)
      : Number(doc.netAmount ?? doc.revenue ?? 0) || 0
  return {
    date,
    storeId: doc.storeId || '',
    storeCode: doc.storeCode || '',
    storeName: doc.storeName || '',
    revenue,
    orderCount: Number(doc.orderCount) || 0,
    avgOrderPrice: doc.avgOrderPrice ?? null,
    customerPrice: doc.customerPrice ?? null,
    pos: pos || null,
    online: online || null,
    refund: refund || null,
    cash: cashIncome || null,
    cashIncome: cashIncome || null,
    cashBalance: hasBalance ? cashBalance : null,
    raw: doc.raw || doc.remark || '',
    _updateTime: doc._updateTime || doc.syncedAt || Date.now(),
    source: doc.source || 'store_ledger',
  }
}

export function toStoreLedgerDoc(record) {
  const pos = Number(record.pos) || 0
  const online = Number(record.online) || 0
  const refund = Number(record.refundAmount ?? record.refund) || 0
  const cashBalance =
    record.cashBalance != null && record.cashBalance !== ''
      ? Number(record.cashBalance)
      : null
  const hasBalance = cashBalance != null && Number.isFinite(cashBalance)
  const cashIncome = hasBalance
    ? Number(record.cashIncome) || 0
    : Number(record.cashIncome ?? record.cash) || 0
  const revenueFromChannels =
    pos || online || cashIncome || refund
      ? Math.max(0, pos + online + cashIncome - refund)
      : null
  const revenue =
    revenueFromChannels != null
      ? revenueFromChannels
      : Number(record.revenue) || 0
  const doc = {
    storeId: record.storeId || '',
    storeCode: record.storeCode || '',
    storeName: record.storeName || '',
    date: record.date,
    bizDate: record.date,
    revenue,
    grossAmount: record.grossAmount ?? pos + online + cashIncome,
    refundAmount: refund,
    netAmount: record.netAmount ?? revenue,
    orderCount: Number(record.orderCount) || 0,
    avgOrderPrice: record.avgOrderPrice ?? null,
    customerPrice: record.customerPrice ?? null,
    pos,
    online,
    cash: cashIncome,
    cashIncome,
    refund,
    channel: record.channel || 'offline_pos',
    raw: record.raw || '',
    remark: record.raw || '',
    source: record.source || 'web_admin',
    _updateTime: Date.now(),
    syncedAt: Date.now(),
  }
  if (hasBalance) doc.cashBalance = cashBalance
  return doc
}

/** 按 storeId|date 合并，_updateTime 较新者胜出 */
export function mergeRecords(localRecords, cloudRecords) {
  const map = new Map()
  // 同键同时间戳（历史批量同步常见）：按主店 canonical id → 有渠道明细 → 金额较大 定去留，不随读取顺序漂移
  const wins = (rec, ts, existing) =>
    ts > existing.updateTime || (ts === existing.updateTime && compareForKeep(rec, existing) > 0)

  localRecords.forEach((row) => {
    const rec = toFinanceRecord(row)
    const key = ledgerKey(rec, rec.date)
    const ts = rec._updateTime || 0
    const existing = map.get(key)
    if (!existing || wins(rec, ts, existing)) {
      map.set(key, { ...rec, updateTime: ts })
    }
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
    if (!existing || wins(rec, ts, existing)) {
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

const LEDGER_UPLOAD_CHUNK = 100

/**
 * 推送到门店账本：store_ledger / finance_records 客户端不可写，经 syncFinanceData.upload_records（仅超管）。
 * 服务端按记录自带的 _updateTime 与云端比新旧、字段级合并后写 store_ledger，再镜像 finance_records。
 * 传原始记录而非 toStoreLedgerDoc 的结果：后者把 _updateTime 设为当前时间，会让旧数据冒充最新。
 */
export async function pushStoreLedger(records) {
  if (!records?.length) return { success: true, pushed: 0 }

  const deduped = dedupeFinanceRecords(records)
    .filter((r) => r.date || r.bizDate)
    .sort((a, b) => String(a.date || a.bizDate).localeCompare(String(b.date || b.bizDate)))
  let added = 0
  let updated = 0
  let mirrored = 0
  for (let i = 0; i < deduped.length; i += LEDGER_UPLOAD_CHUNK) {
    const res = await callCdnFunction('syncFinanceData', {
      action: 'upload_records',
      records: deduped.slice(i, i + LEDGER_UPLOAD_CHUNK),
    })
    if (!res || res.success === false) {
      throw new Error(res?.message || res?.msg || '门店账本推送失败')
    }
    added += res.added || 0
    updated += res.updated || 0
    mirrored += res.mirrored || 0
  }
  return { success: true, pushed: deduped.length, added, updated, mirrored }
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
