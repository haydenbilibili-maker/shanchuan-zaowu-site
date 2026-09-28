/**
 * 财务数据同步工具
 * Web 管理后台 ↔ 云数据库 ↔ 店长小程序账本（store_ledger）
 */
import { COLLECTIONS } from '../cloud'
import { fetchAllFromCollection, fetchCollectionLimit, cdnRemove, callCdnFunction } from './cloudbaseCdnDb.js'
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
    const rows = await fetchCollectionLimit(COLLECTIONS.FINANCE_SETTINGS, { limit: 20 })
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
          // 幂等删除：并发下 deleted:0 属良性无操作，刻意不断言（否则制造假失败）
          pruneOps.push(cdnRemove(COLLECTIONS.FINANCE_RECORDS, stale._id))
        }
      }
    }
    if (pruneOps.length) await Promise.all(pruneOps)

    // finance_records 与 store_ledger 客户端均不可写：经 syncFinanceData.upload_records 一次写入门店账本并镜像
    const pushed = await pushStoreLedger(deduped)
    saveSyncMetadata({ ...getSyncMetadata(), lastStoreLedgerSyncTime: Date.now() })

    return {
      success: true,
      message: `成功同步 ${deduped.length} 条记录（门店账本新增 ${pushed.added || 0}、更新 ${pushed.updated || 0}）`,
    }
  } catch (error) {
    console.error('保存财务记录到云端失败:', error)
    throw error
  }
}

export async function saveFinanceSettingsToCloud(settings) {
  try {
    if (!settings) {
      return { success: true, message: '无设置需要同步' }
    }

    const { DEFAULT_MALL_THRESHOLD, DEFAULT_MALL_RATE } = await import('./mallCommission.js')
    const normalized = { ...settings }
    if (!Number.isFinite(Number(normalized.mallThreshold)) || Number(normalized.mallThreshold) < 0) {
      normalized.mallThreshold = DEFAULT_MALL_THRESHOLD
    }
    let rate = Number(normalized.mallRate)
    if (!Number.isFinite(rate) || rate < 0) {
      normalized.mallRate = DEFAULT_MALL_RATE
    } else if (rate > 1) {
      normalized.mallRate = rate / 100
    }

    // finance_settings 客户端不可写：经 syncFinanceData.upload_settings（仅超管）
    const res = await callCdnFunction('syncFinanceData', {
      action: 'upload_settings',
      settings: normalized,
      updateTime: Date.now(),
    })
    if (!res || res.success === false) {
      throw new Error(res?.message || res?.msg || '财务设置同步失败')
    }

    return { success: true, message: res.message || '财务设置同步成功' }
  } catch (error) {
    console.error('保存财务设置到云端失败:', error)
    throw error
  }
}

export async function syncFinanceRecords(options = {}) {
  // readOnly：给**读路径**（各页面取数）用 —— 只把云端权威拉进本机缓存，绝不回推云端。
  // 为什么必须显式区分：云端读取失败时 cloudRecords 会是 []，而下面「回推」的条件
  // `mergedRecords.length > cloudRecords.length` 恰好成立 → 一次读失败就会把本机账本
  // 反向覆盖云端。「读不到云端」不等于「云端为空」，读页面也不应产生写副作用。
  const { forceUpload = false, forceDownload = false, readOnly = false } = options

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

    // 上传失败不影响本机合并结果（success 仍为 true），但必须带 uploadError 让页面提示 ——
    // 2026-09-14 起 finance_records 规则禁写，这里曾只打 console.warn，两周内 ERP 账本改动全部未上云
    let uploadError = ''
    if (
      !readOnly &&
      !forceDownload &&
      (forceUpload || localUpdateTime > cloudUpdateTime || mergedRecords.length > cloudRecords.length)
    ) {
      try {
        await saveFinanceRecordsToCloud(mergedRecords)
        metadata.lastCloudUpdateTime = Date.now()
      } catch (error) {
        console.warn('上传到云端失败:', error)
        uploadError = error?.message || String(error)
      }
    }

    saveSyncMetadata(metadata)

    return {
      success: true,
      localCount: localRecords.length,
      cloudCount: cloudRecords.length,
      mergedCount: mergedRecords.length,
      synced: !uploadError,
      ...(uploadError ? { uploadError } : {}),
    }
  } catch (error) {
    console.error('同步财务记录失败:', error)
    return { success: false, error: error.message }
  }
}

export async function syncFinanceSettings(options = {}) {
  const { forceUpload = false, forceDownload = false, readOnly = false } = options

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

    let uploadError = ''
    if (!readOnly && (forceUpload || (localSettings && localUpdateTime > cloudUpdateTime))) {
      try {
        await saveFinanceSettingsToCloud(mergedSettings || localSettings)
        metadata.lastCloudUpdateTime = Date.now()
      } catch (error) {
        console.warn('上传设置到云端失败:', error)
        uploadError = error?.message || String(error)
      }
    }

    saveSyncMetadata(metadata)
    return { success: true, synced: !uploadError, ...(uploadError ? { uploadError } : {}) }
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
