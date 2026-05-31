/**
 * 财务数据同步工具（小程序端）
 * 店长账本以 store_ledger 为主；与 Web ERP 通过云函数镜像 finance_records
 */
const {
  FINANCE_RECORDS_KEY,
  migrateFinanceRecordsFromLegacy,
} = require('./financeLocalStorageKey')
const { ledgerKey, getManagerStoreId } = require('./storeLedger')

const FINANCE_SETTINGS_KEY = 'sc_finance_v12'
const SYNC_METADATA_KEY = 'finance_sync_metadata'

migrateFinanceRecordsFromLegacy()

function getSyncMetadata() {
  try {
    const meta = wx.getStorageSync(SYNC_METADATA_KEY)
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
    wx.setStorageSync(
      SYNC_METADATA_KEY,
      JSON.stringify({ ...metadata, lastSyncTime: Date.now() }),
    )
  } catch (error) {
    console.error('保存同步元数据失败:', error)
  }
}

async function fetchFinanceRecordsFromCloud() {
  try {
    const res = await wx.cloud.callFunction({
      name: 'syncFinanceData',
      data: {
        action: 'download_store_ledger',
        storeId: getManagerStoreId(),
      },
      timeout: 8000,
    })

    if (res.result?.success) {
      return res.result.data || []
    }
    throw new Error(res.result?.message || '获取失败')
  } catch (error) {
    console.error('从云端获取账本失败:', error)
    return []
  }
}

async function fetchFinanceSettingsFromCloud() {
  try {
    const res = await wx.cloud.callFunction({
      name: 'syncFinanceData',
      data: { action: 'download_settings' },
      timeout: 8000,
    })

    if (res.result?.success) {
      return res.result.data
    }
    throw new Error(res.result?.message || '获取失败')
  } catch (error) {
    console.error('从云端获取财务设置失败:', error)
    return null
  }
}

async function saveFinanceRecordsToCloud(records) {
  try {
    if (!records?.length) {
      return { success: true, message: '无数据需要同步' }
    }

    const storeId = getManagerStoreId()
    const payload = records.map((r) => ({
      ...r,
      storeId: r.storeId || storeId,
      source: r.source || 'store_manager',
    }))

    const res = await wx.cloud.callFunction({
      name: 'syncFinanceData',
      data: { action: 'upload_records', records: payload },
    })

    if (res.result?.success) {
      saveSyncMetadata({ ...getSyncMetadata(), lastStoreLedgerSyncTime: Date.now() })
      return res.result
    }
    throw new Error(res.result?.message || '上传失败')
  } catch (error) {
    console.error('上传账本失败:', error)
    throw error
  }
}

async function saveFinanceSettingsToCloud(settings) {
  try {
    if (!settings) {
      return { success: true, message: '无设置需要同步' }
    }

    const res = await wx.cloud.callFunction({
      name: 'syncFinanceData',
      data: {
        action: 'upload_settings',
        settings,
        updateTime: Date.now(),
      },
    })

    if (res.result?.success) return res.result
    throw new Error(res.result?.message || '上传失败')
  } catch (error) {
    console.error('上传财务设置失败:', error)
    throw error
  }
}

function mergeRecords(localRecords, cloudRecords) {
  const map = new Map()

  cloudRecords.forEach((record) => {
    const key = ledgerKey(record.storeId || getManagerStoreId(), record.date)
    map.set(key, {
      ...record,
      updateTime: record._updateTime || record.syncedAt || 0,
    })
  })

  localRecords.forEach((record) => {
    const key = ledgerKey(record.storeId || getManagerStoreId(), record.date)
    const existing = map.get(key)
    const localTs = record._updateTime || 0
    if (!existing || localTs > (existing.updateTime || 0)) {
      map.set(key, { ...record, updateTime: localTs })
    }
  })

  return [...map.values()]
    .map(({ updateTime, ...record }) => ({
      date: record.date,
      storeId: record.storeId || getManagerStoreId(),
      revenue: record.revenue || record.total || 0,
      orderCount: record.orderCount || 0,
      pos: record.pos || 0,
      online: record.online || 0,
      cash: record.cash || 0,
      refund: record.refund || 0,
      ...record,
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
}

async function syncFinanceRecords(options = {}) {
  const { forceUpload = false, forceDownload = false } = options

  try {
    const metadata = getSyncMetadata()
    let localRecords = []
    const localUpdateTime = metadata.lastLocalUpdateTime || 0

    try {
      const localRaw = wx.getStorageSync(FINANCE_RECORDS_KEY)
      localRecords = localRaw ? JSON.parse(localRaw) : []
    } catch (error) {
      console.warn('读取本地财务记录失败:', error)
    }

    let cloudRecords = []
    let cloudUpdateTime = 0
    try {
      cloudRecords = await fetchFinanceRecordsFromCloud()
      if (cloudRecords.length) {
        cloudUpdateTime = Math.max(...cloudRecords.map((r) => r._updateTime || r.syncedAt || 0))
      }
    } catch (error) {
      console.warn('从云端获取数据失败，仅使用本地数据:', error)
      if (forceDownload) throw error
      cloudRecords = []
    }

    let mergedRecords = localRecords
    if (forceDownload) {
      mergedRecords = cloudRecords.map((r) => ({
        date: r.date,
        storeId: r.storeId || getManagerStoreId(),
        revenue: r.revenue || 0,
        orderCount: r.orderCount || 0,
        pos: r.pos || 0,
        online: r.online || 0,
        cash: r.cash || 0,
        refund: r.refund || 0,
        ...r,
      }))
    } else if (!forceUpload && cloudRecords.length) {
      mergedRecords = mergeRecords(localRecords, cloudRecords)
    }

    wx.setStorageSync(FINANCE_RECORDS_KEY, JSON.stringify(mergedRecords))
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

async function syncFinanceSettings(options = {}) {
  const { forceUpload = false, forceDownload = false } = options

  try {
    const metadata = getSyncMetadata()
    let localSettings = null
    let localUpdateTime = metadata.lastLocalUpdateTime || 0

    try {
      const localRaw = wx.getStorageSync(FINANCE_SETTINGS_KEY)
      if (localRaw) {
        const parsed = JSON.parse(localRaw)
        localSettings = parsed.settings || parsed
        localUpdateTime = parsed._updateTime || 0
      }
    } catch (error) {
      console.warn('读取本地财务设置失败:', error)
    }

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
      if (forceDownload) mergedSettings = cloudSettings
      else if (localUpdateTime > cloudUpdateTime) mergedSettings = localSettings
      else mergedSettings = cloudSettings
    }

    if (mergedSettings) {
      wx.setStorageSync(
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

async function autoSyncFinanceData(options = {}) {
  try {
    const [recordsResult, settingsResult] = await Promise.allSettled([
      syncFinanceRecords(options),
      syncFinanceSettings(options),
    ])

    return {
      records:
        recordsResult.status === 'fulfilled'
          ? recordsResult.value
          : { success: false, error: recordsResult.reason?.message || '未知错误' },
      settings:
        settingsResult.status === 'fulfilled'
          ? settingsResult.value
          : { success: false, error: settingsResult.reason?.message || '未知错误' },
    }
  } catch (error) {
    console.error('自动同步失败:', error)
    return {
      records: { success: false, error: error.message },
      settings: { success: false, error: error.message },
    }
  }
}

async function manualSyncFinanceData(options = {}) {
  const { uploadOnly = false, downloadOnly = false } = options

  if (uploadOnly) {
    let localRecords = []
    let localSettings = null

    try {
      const localRaw = wx.getStorageSync(FINANCE_RECORDS_KEY)
      localRecords = localRaw ? JSON.parse(localRaw) : []
    } catch (error) {
      console.warn('读取本地记录失败:', error)
    }

    try {
      const localSettingsRaw = wx.getStorageSync(FINANCE_SETTINGS_KEY)
      if (localSettingsRaw) {
        const parsed = JSON.parse(localSettingsRaw)
        localSettings = parsed.settings || parsed
      }
    } catch (error) {
      console.warn('读取本地设置失败:', error)
    }

    const [recordsResult, settingsResult] = await Promise.allSettled([
      saveFinanceRecordsToCloud(localRecords),
      localSettings ? saveFinanceSettingsToCloud(localSettings) : Promise.resolve({ success: true }),
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
  }

  if (downloadOnly) {
    return autoSyncFinanceData({ forceDownload: true })
  }

  return autoSyncFinanceData()
}

/** 历史 daily_revenues → store_ledger 迁移（云函数执行） */
async function syncDailyRevenuesToStoreLedger() {
  try {
    const res = await wx.cloud.callFunction({
      name: 'syncFinanceData',
      data: {
        action: 'sync_daily_revenues',
        storeId: getManagerStoreId(),
        limit: 100,
      },
      timeout: 10000,
    })

    if (res.result?.success) return res.result
    throw new Error(res.result?.message || '同步失败')
  } catch (error) {
    console.error('daily_revenues 迁移失败:', error)
    return { success: false, message: error.message }
  }
}

module.exports = {
  fetchFinanceRecordsFromCloud,
  fetchFinanceSettingsFromCloud,
  saveFinanceRecordsToCloud,
  saveFinanceSettingsToCloud,
  syncFinanceRecords,
  syncFinanceSettings,
  autoSyncFinanceData,
  manualSyncFinanceData,
  syncDailyRevenuesToStoreLedger,
  /** @deprecated 使用 syncDailyRevenuesToStoreLedger */
  syncDailyRevenuesToFinanceRecords: syncDailyRevenuesToStoreLedger,
}
