/**
 * 财务账本重复日账检测与清理
 * 规则：canonical 门店 + 日期 唯一；保留 canonical storeId → 较新 _updateTime → 金额较大
 */
import { COLLECTIONS } from '../cloud.js'
import { getCdnDatabase, fetchAllFromCollection } from './cloudbaseCdnDb.js'
import { FINANCE_RECORDS_KEY } from './financeLocalStorageKey.js'
import { touchLocalFinanceUpdateTime, saveFinanceRecordsToCloud } from './financeSync.js'
import { ledgerKey } from './storeLedgerSync.js'
import {
  CANONICAL_STORE_DEFS,
  applyDefaultStoreToFinanceRecord,
  loadStoreBundle,
  resolveCanonicalStoreKey,
} from './storeStorage.js'

const canonicalIds = new Set(CANONICAL_STORE_DEFS.map((d) => d.storeId))

/** 与 financeSandboxBridge.dedupeRowsByStoreDate 同序评分 */
export function recordKeepScore(record) {
  return [
    canonicalIds.has(String(record.storeId || '')) ? 1 : 0,
    Number(record._updateTime || record.syncedAt || 0),
    Number(record.revenue ?? record.netAmount ?? 0) || 0,
  ]
}

export function compareRecordsForKeep(a, b) {
  const [ac, at, ar] = recordKeepScore(a)
  const [bc, bt, br] = recordKeepScore(b)
  if (ac !== bc) return ac > bc ? 1 : -1
  if (at !== bt) return at > bt ? 1 : -1
  if (ar !== br) return ar > br ? 1 : -1
  return 0
}

export function canonicalStoreDateKey(record, bundle) {
  const canonical = resolveCanonicalStoreKey(record, bundle)
  const date = String(record.date || record.bizDate || '').slice(0, 10)
  return `${canonical}|${date}`
}

function normalizeRow(row, bundle) {
  const withStore = applyDefaultStoreToFinanceRecord(row, bundle)
  const date = String(withStore.date || withStore.bizDate || '').slice(0, 10)
  if (!date) return null
  return {
    ...withStore,
    date,
    revenue: Number(withStore.revenue ?? withStore.netAmount ?? 0) || 0,
    _ledgerKey: ledgerKey({ ...withStore, date }, date),
  }
}

const STORE_KEY_LABELS = {
  shanhaizaowu: '楼上 · 山川造物',
  xingchen: '楼下 · 星宸标本',
}

/**
 * @returns {Array<{ key, storeKey, date, keep, remove, inflatedRevenue }>}
 */
export function findDuplicateGroups(rows, bundle = loadStoreBundle()) {
  const indexed = []
  rows.forEach((row, index) => {
    const rec = normalizeRow(row, bundle)
    if (!rec) return
    indexed.push({ ...rec, _index: index })
  })

  const groups = new Map()
  indexed.forEach((rec) => {
    const key = canonicalStoreDateKey(rec, bundle)
    const list = groups.get(key) || []
    list.push(rec)
    groups.set(key, list)
  })

  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => compareRecordsForKeep(b, a))
      const keep = sorted[0]
      const remove = sorted.slice(1)
      const inflatedRevenue = remove.reduce((s, r) => s + (Number(r.revenue) || 0), 0)
      const [storeKey, date] = key.split('|')
      return {
        key,
        storeKey,
        storeLabel: STORE_KEY_LABELS[storeKey] || storeKey,
        date,
        keep,
        remove,
        inflatedRevenue,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** 预览：哪些行将被删除、虚增多少 */
export function previewDuplicateCleanup(rows) {
  const groups = findDuplicateGroups(rows)
  const removeIndices = new Set()
  groups.forEach((g) => g.remove.forEach((r) => removeIndices.add(r._index)))

  return {
    duplicateDayCount: groups.length,
    removeCount: removeIndices.size,
    totalInflatedRevenue: groups.reduce((s, g) => s + g.inflatedRevenue, 0),
    groups: groups.map((g) => ({
      key: g.key,
      date: g.date,
      storeKey: g.storeKey,
      storeLabel: g.storeLabel,
      keep: {
        storeId: g.keep.storeId,
        storeCode: g.keep.storeCode,
        revenue: g.keep.revenue,
        orderCount: g.keep.orderCount,
        _updateTime: g.keep._updateTime,
        _id: g.keep._id,
        _ledgerKey: g.keep._ledgerKey,
      },
      remove: g.remove.map((r) => ({
        storeId: r.storeId,
        storeCode: r.storeCode,
        revenue: r.revenue,
        orderCount: r.orderCount,
        _updateTime: r._updateTime,
        _id: r._id,
        _ledgerKey: r._ledgerKey,
        _index: r._index,
      })),
      inflatedRevenue: g.inflatedRevenue,
    })),
  }
}

/** 本地数组去重（不访问云端） */
export function applyDuplicateCleanup(rows) {
  const preview = previewDuplicateCleanup(rows)
  if (!preview.removeCount) {
    return { records: rows, preview, removed: [] }
  }

  const removeIndices = new Set()
  preview.groups.forEach((g) => g.remove.forEach((r) => removeIndices.add(r._index)))

  const removed = []
  const kept = []
  rows.forEach((row, i) => {
    if (removeIndices.has(i)) removed.push(row)
    else kept.push(row)
  })
  return { records: kept, preview, removed }
}

/**
 * 一键清理：localStorage shanhai_v12 + CloudBase finance_records
 * @param {{ dryRun?: boolean, syncCloud?: boolean }} options
 */
export async function cleanupDuplicateFinanceRecords(options = {}) {
  const { dryRun = false, syncCloud = true } = options

  let localRecords = []
  try {
    const raw = localStorage.getItem(FINANCE_RECORDS_KEY)
    localRecords = raw ? JSON.parse(raw) : []
    if (!Array.isArray(localRecords)) localRecords = []
  } catch {
    localRecords = []
  }

  const preview = previewDuplicateCleanup(localRecords)
  if (dryRun || !preview.removeCount) {
    return {
      success: true,
      dryRun: !!dryRun,
      preview,
      localCount: localRecords.length,
      mergedCount: localRecords.length,
      removedCount: 0,
      cloudRemoved: 0,
    }
  }

  const { records: cleaned, removed } = applyDuplicateCleanup(localRecords)
  localStorage.setItem(FINANCE_RECORDS_KEY, JSON.stringify(cleaned))
  touchLocalFinanceUpdateTime()

  let cloudRemoved = 0
  let cloudError = null

  if (syncCloud) {
    try {
      const cloudRecords = await fetchAllFromCollection(COLLECTIONS.FINANCE_RECORDS, {
        orderField: 'date',
        direction: 'desc',
      })
      const cloudPreview = previewDuplicateCleanup(cloudRecords)
      const db = await getCdnDatabase()

      for (const group of cloudPreview.groups) {
        for (const rec of group.remove) {
          if (rec._id) {
            await db.collection(COLLECTIONS.FINANCE_RECORDS).doc(rec._id).remove()
            cloudRemoved++
          }
        }
      }

      await saveFinanceRecordsToCloud(cleaned)
    } catch (err) {
      cloudError = err?.message || String(err)
    }
  }

  return {
    success: true,
    preview,
    localCount: localRecords.length,
    mergedCount: cleaned.length,
    removedCount: removed.length,
    cloudRemoved,
    cloudError,
  }
}
