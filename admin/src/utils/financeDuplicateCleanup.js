/**
 * 财务账本重复日账检测与清理
 * 判据见 financeDuplicateCheck.js：归属后同门店 + 同营业日；
 * 只删「完全重复」的多余副本，「同日同店金额不同」只列出、由人逐条定（2026-09-29 产品负责人）。
 */
import { COLLECTIONS } from '../cloud.js'
import { fetchAllFromCollection, cdnRemove } from './cloudbaseCdnDb.js'
import { FINANCE_RECORDS_KEY } from './financeLocalStorageKey.js'
import { touchLocalFinanceUpdateTime, saveFinanceRecordsToCloud } from './financeSync.js'
import { dedupeFinanceRecords } from './storeLedgerSync.js'
import { classifyDuplicateGroups, ledgerAmounts } from './financeDuplicateCheck.js'
import { resolveFinanceStore } from './financeDayAggregate.js'

const brief = (row, index) => ({
  _id: row._id,
  storeId: row.storeId,
  storeCode: row.storeCode,
  ...ledgerAmounts(row),
  _updateTime: row._updateTime,
  _index: index,
})

/**
 * @returns {Array<{ key, storeKey, storeLabel, date, identical, keep, remove, others, diffs, inflatedRevenue }>}
 */
export function findDuplicateGroups(rows) {
  return classifyDuplicateGroups(rows).map((g) => ({
    key: g.key,
    storeKey: g.storeId,
    storeLabel: resolveFinanceStore({ storeId: g.storeId }).name,
    date: g.date,
    identical: g.identical,
    keep: brief(g.keep.row, g.keep.index),
    remove: g.remove.map((x) => brief(x.row, x.index)),
    others: g.others.map((x) => brief(x.row, x.index)),
    diffs: g.diffs,
    inflatedRevenue: g.others.reduce((s, x) => s + ledgerAmounts(x.row).revenue, 0),
  }))
}

/** 预览：完全重复（将删）与金额不同（待定）分开统计 */
export function previewDuplicateCleanup(rows) {
  const groups = findDuplicateGroups(rows)
  const identical = groups.filter((g) => g.identical)
  const pending = groups.filter((g) => !g.identical)
  return {
    duplicateDayCount: groups.length,
    removeCount: identical.reduce((s, g) => s + g.remove.length, 0),
    totalInflatedRevenue: identical.reduce((s, g) => s + g.inflatedRevenue, 0),
    pendingCount: pending.length,
    pendingInflatedRevenue: pending.reduce((s, g) => s + g.inflatedRevenue, 0),
    groups,
  }
}

/** 本地数组去重（不访问云端）：只去掉完全重复的多余副本 */
export function applyDuplicateCleanup(rows) {
  const preview = previewDuplicateCleanup(rows)
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

/** 云端 finance_records 原始行（本机缓存已按归属键合并，看不到同日多条，预览必须读云端） */
export async function fetchCloudFinanceRows() {
  return fetchAllFromCollection(COLLECTIONS.FINANCE_RECORDS, { orderField: 'date', direction: 'desc' })
}

/**
 * 一键清理：CloudBase finance_records 完全重复副本 + 本机缓存按归属键合并
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

  const cloudRows = syncCloud ? await fetchCloudFinanceRows() : []
  const preview = previewDuplicateCleanup(syncCloud ? cloudRows : localRecords)
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

  const cleaned = dedupeFinanceRecords(applyDuplicateCleanup(localRecords).records)
  localStorage.setItem(FINANCE_RECORDS_KEY, JSON.stringify(cleaned))
  touchLocalFinanceUpdateTime()

  let cloudRemoved = 0
  let cloudError = null
  if (syncCloud) {
    try {
      for (const group of preview.groups) {
        for (const rec of group.remove) {
          if (rec._id) {
            // 幂等删除：并发下 deleted:0 属良性无操作，刻意不断言（否则制造假失败）
            await cdnRemove(COLLECTIONS.FINANCE_RECORDS, rec._id)
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
    removedCount: preview.removeCount,
    cloudRemoved,
    cloudError,
  }
}
