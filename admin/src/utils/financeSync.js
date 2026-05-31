/**
 * 财务数据同步工具
 * Web 管理后台 ↔ 云数据库 ↔ 店长小程序账本（store_ledger）
 */
import { COLLECTIONS } from '../cloud'
import { getCdnDatabase, fetchAllFromCollection } from './cloudbaseCdnDb.js'
import { FINANCE_RECORDS_KEY } from './financeLocalStorageKey.js'
import {
  ledgerKey,
  mergeRecords,
  dedupeFinanceRecords,
  pullStoreLedgerIntoFinance,
  pushStoreLedger,
  syncStoreLedgerBidirectional,
} from './storeLedgerSync.js'

const FINANCE_SETTINGS_KEY = 'sc_finance_v12'
const SYNC_METADATA_KEY = 'finance_sync_metadata'

function getSyncMetadata() {
  try {
    const meta = localStorage.getItem(SYNC_METADATA_KEY)
    return meta
      ? JSON.parse(meta)
      : {
          lastSyncTime: null,
          lastLocalUpdateTime: null,
          lastCloudUpdateTime: null,
          lastStoreLedgerSyncTime: null,
          syncVersion: 2,
        }
  } catch (error) {
    console.error('读取同步元数据失败:', error)
    return {
      lastSyncTime: null,
      lastLocalUpdateTime: null,
      lastCloudUpdateTime: null,
      lastStoreLedgerSyncTime: null,
      syncVersion: 2,
    }
  }
}

function saveSyncMetadata(metadata) {
  try {
    localStorage.setItem(
      SYNC_METADATA_KEY,
      JSON.stringify({ ...metadata, lastSyncTime: Date.now() }),
    )
  } catch (error) {
    console.error('保存同步元数据失败:', error)
  }
}

/** 本地账本刚写入时立即标记，避免异步同步误判云端较新而覆盖 */
export function touchLocalFinanceUpdateTime() {
  const metadata = getSyncMetadata()
  metadata.lastLocalUpdateTime = Date.now()
  saveSyncMetadata(metadata)
}

export async function fetchFinanceRecordsFromCloud() {
  try {
    const rows = await fetchAllFromCollection(COLLECTIONS.FINANCE_RECORDS, {
      orderField: 'date',
      direction: 'desc',
    })
    return dedupeFinanceRecords(rows)
  } catch (error) {
    console.error('从云端获取财务记录失败:', error)
    throw error
  }
}

export async function fetchFinanceSettingsFromCloud() {
  try {
    const db = await getCdnDatabase()
    const res = await db.collection(COLLECTIONS.FINANCE_SETTINGS).limit(20).get()
    const rows = res.data || []
    if (!rows.length) return null
    rows.sort(
      (a, b) => (b._updateTime || b.syncedAt || 0) - (a._updateTime || a.syncedAt || 0),
    )
    return rows[0]
  } catch (error) {
    console.error('从云端获取财务设置失败:', error)
    throw error
  }
}

export async function saveFinanceRecordsToCloud(records) {
  try {
    const db = await getCdnDatabase()

    const deduped = dedupeFinanceRecords(records)
    if (!deduped.length) {
      return { success: true, message: '无数据需要同步' }
    }

    const existingRows = await fetchAllFromCollection(COLLECTIONS.FINANCE_RECORDS, {
      orderField: 'date',
      direction: 'desc',
    })

    // 云端同键多条时只保留最新一条，其余删除
    const groups = new Map()
    for (const doc of existingRows) {
      const key = ledgerKey(doc, doc.date)
      const list = groups.get(key) || []
      list.push(doc)
      groups.set(key, list)
    }
    const pruneOps = []
    for (const [, docs] of groups) {
      if (docs.length <= 1) continue
      docs.sort((a, b) => (b._updateTime || b.syncedAt || 0) - (a._updateTime || a.syncedAt || 0))
      for (const stale of docs.slice(1)) {
        if (stale._id) {
          pruneOps.push(db.collection(COLLECTIONS.FINANCE_RECORDS).doc(stale._id).remove())
        }
      }
    }
    if (pruneOps.length) await Promise.all(pruneOps)

    const freshRows = pruneOps.length
      ? await fetchAllFromCollection(COLLECTIONS.FINANCE_RECORDS, { orderField: 'date', direction: 'desc' })
      : existingRows
    const byKey = new Map(freshRows.map((doc) => [ledgerKey(doc, doc.date), doc]))

    const ops = []
    for (const record of deduped) {
      const { _id, ...payload } = record
      const key = ledgerKey(record, record.date)
      const prev = byKey.get(key)
      if (prev?._id) {
        ops.push(
          db.collection(COLLECTIONS.FINANCE_RECORDS).doc(prev._id).update({
            ...payload,
            _updateTime: Date.now(),
            syncedAt: Date.now(),
          }),
        )
      } else {
        ops.push(
          db.collection(COLLECTIONS.FINANCE_RECORDS).add({
            ...payload,
            _createTime: Date.now(),
            _updateTime: Date.now(),
            syncedAt: Date.now(),
          }),
        )
      }
    }

    await Promise.all(ops)

    try {
      await pushStoreLedger(deduped)
      saveSyncMetadata({ ...getSyncMetadata(), lastStoreLedgerSyncTime: Date.now() })
    } catch (error) {
      console.warn('店长账本 store_ledger 推送失败', error)
    }

    return { success: true, message: `成功同步 ${deduped.length} 条记录` }
  } catch (error) {
    console.error('保存财务记录到云端失败:', error)
    throw error
  }
}

export async function saveFinanceSettingsToCloud(settings) {
  try {
    const db = await getCdnDatabase()

    if (!settings) {
      return { success: true, message: '无设置需要同步' }
    }

    const res = await db.collection(COLLECTIONS.FINANCE_SETTINGS).limit(20).get()
    const rows = (res.data || []).sort(
      (a, b) => (b._updateTime || 0) - (a._updateTime || 0),
    )

    const payload = {
      settings,
      _updateTime: Date.now(),
      syncedAt: Date.now(),
    }

    if (rows.length > 0) {
      await db.collection(COLLECTIONS.FINANCE_SETTINGS).doc(rows[0]._id).update(payload)
    } else {
      await db.collection(COLLECTIONS.FINANCE_SETTINGS).add({
        ...payload,
        _createTime: Date.now(),
      })
    }

    return { success: true, message: '财务设置同步成功' }
  } catch (error) {
    console.error('保存财务设置到云端失败:', error)
    throw error
  }
}

export async function syncFinanceRecords(options = {}) {
  const { forceUpload = false, forceDownload = false } = options

  try {
    const metadata = getSyncMetadata()
    const localRaw = localStorage.getItem(FINANCE_RECORDS_KEY)
    const localRecords = localRaw ? JSON.parse(localRaw) : []
    const localUpdateTime = metadata.lastLocalUpdateTime || 0

    let cloudRecords = []
    let cloudUpdateTime = 0
    try {
      cloudRecords = await fetchFinanceRecordsFromCloud()
      if (cloudRecords.length > 0) {
        cloudUpdateTime = Math.max(
          ...cloudRecords.map((r) => r._updateTime || r.syncedAt || 0),
        )
      }
    } catch (error) {
      console.warn('从云端获取数据失败，仅使用本地数据:', error)
      if (forceDownload) throw error
    }

    let mergedRecords = localRecords
    if (forceDownload) {
      mergedRecords = cloudRecords.map((r) => ({
        date: r.date,
        revenue: r.revenue || 0,
        orderCount: r.orderCount || 0,
        ...r,
      }))
    } else if (!forceUpload && cloudRecords.length > 0) {
      mergedRecords = mergeRecords(localRecords, cloudRecords)
    }

    if (!forceUpload) {
      try {
        const ledgerResult = await pullStoreLedgerIntoFinance(mergedRecords)
        if (ledgerResult.success && ledgerResult.records) {
          mergedRecords = ledgerResult.records
        }
      } catch (error) {
        console.warn('店长账本合并失败，继续使用财务云数据', error)
      }
    }

    mergedRecords = dedupeFinanceRecords(mergedRecords)

    // 安全兜底：本地有数据时禁止被合并结果清空
    if (localRecords.length > 0 && mergedRecords.length === 0) {
      console.warn('[financeSync] 合并结果为空，保留本地账本')
      mergedRecords = dedupeFinanceRecords(localRecords)
    }

    localStorage.setItem(FINANCE_RECORDS_KEY, JSON.stringify(mergedRecords))
    metadata.lastLocalUpdateTime = Date.now()

    if (
      !forceDownload &&
      (forceUpload || localUpdateTime > cloudUpdateTime || mergedRecords.length > cloudRecords.length)
    ) {
      try {
        await saveFinanceRecordsToCloud(mergedRecords)
        metadata.lastCloudUpdateTime = Date.now()
      } catch (error) {
        console.warn('上传到云端失败:', error)
      }
    }

    saveSyncMetadata(metadata)

    return {
      success: true,
      localCount: localRecords.length,
      cloudCount: cloudRecords.length,
      mergedCount: mergedRecords.length,
      synced: true,
    }
  } catch (error) {
    console.error('同步财务记录失败:', error)
    return { success: false, error: error.message }
  }
}

export async function syncFinanceSettings(options = {}) {
  const { forceUpload = false, forceDownload = false } = options

  try {
    const metadata = getSyncMetadata()
    const localRaw = localStorage.getItem(FINANCE_SETTINGS_KEY)
    const localSettings = localRaw ? JSON.parse(localRaw).settings : null
    const localUpdateTime = metadata.lastLocalUpdateTime || 0

    let cloudSettings = null
    let cloudUpdateTime = 0
    try {
      const cloudData = await fetchFinanceSettingsFromCloud()
      if (cloudData) {
        cloudSettings = cloudData.settings
        cloudUpdateTime = cloudData._updateTime || cloudData.syncedAt || 0
      }
    } catch (error) {
      console.warn('从云端获取设置失败，仅使用本地设置:', error)
      if (forceDownload) throw error
    }

    let mergedSettings = localSettings
    if (!forceUpload && cloudSettings) {
      if (forceDownload) {
        mergedSettings = cloudSettings
      } else if (localUpdateTime > cloudUpdateTime) {
        mergedSettings = localSettings
      } else {
        mergedSettings = cloudSettings
      }
    }

    if (mergedSettings) {
      localStorage.setItem(
        FINANCE_SETTINGS_KEY,
        JSON.stringify({ settings: mergedSettings, _updateTime: Date.now() }),
      )
      metadata.lastLocalUpdateTime = Date.now()
    }

    if (forceUpload || (localSettings && localUpdateTime > cloudUpdateTime)) {
      try {
        await saveFinanceSettingsToCloud(mergedSettings || localSettings)
        metadata.lastCloudUpdateTime = Date.now()
      } catch (error) {
        console.warn('上传设置到云端失败:', error)
      }
    }

    saveSyncMetadata(metadata)
    return { success: true, synced: true }
  } catch (error) {
    console.error('同步财务设置失败:', error)
    return { success: false, error: error.message }
  }
}

export async function autoSyncFinanceData(options = {}) {
  try {
    const [recordsResult, settingsResult] = await Promise.allSettled([
      syncFinanceRecords(options),
      syncFinanceSettings(options),
    ])

    return {
      records:
        recordsResult.status === 'fulfilled'
          ? recordsResult.value
          : { success: false, error: recordsResult.reason?.message },
      settings:
        settingsResult.status === 'fulfilled'
          ? settingsResult.value
          : { success: false, error: settingsResult.reason?.message },
    }
  } catch (error) {
    console.error('自动同步失败:', error)
    return {
      records: { success: false, error: error.message },
      settings: { success: false, error: error.message },
    }
  }
}

export async function manualSyncFinanceData(options = {}) {
  const { uploadOnly = false, downloadOnly = false } = options

  if (uploadOnly) {
    const localRaw = localStorage.getItem(FINANCE_RECORDS_KEY)
    const localRecords = localRaw ? JSON.parse(localRaw) : []
    const localSettingsRaw = localStorage.getItem(FINANCE_SETTINGS_KEY)
    const localSettings = localSettingsRaw ? JSON.parse(localSettingsRaw).settings : null

    const [recordsResult, settingsResult] = await Promise.allSettled([
      saveFinanceRecordsToCloud(localRecords),
      localSettings ? saveFinanceSettingsToCloud(localSettings) : Promise.resolve({ success: true }),
    ])

    const result = {
      records:
        recordsResult.status === 'fulfilled'
          ? recordsResult.value
          : { success: false, error: recordsResult.reason?.message },
      settings:
        settingsResult.status === 'fulfilled'
          ? settingsResult.value
          : { success: false, error: settingsResult.reason?.message },
    }

    try {
      await syncStoreLedgerBidirectional(localRecords)
    } catch (error) {
      console.warn('店长账本双向同步失败', error)
    }

    return result
  }

  if (downloadOnly) {
    const result = await autoSyncFinanceData({ forceDownload: true })
    try {
      const raw = localStorage.getItem(FINANCE_RECORDS_KEY)
      const records = raw ? JSON.parse(raw) : []
      await pullStoreLedgerIntoFinance(records)
    } catch (error) {
      console.warn('店长账本下载合并失败', error)
    }
    return result
  }

  return autoSyncFinanceData()
}
