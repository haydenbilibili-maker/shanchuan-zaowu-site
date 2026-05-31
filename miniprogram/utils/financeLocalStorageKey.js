/** 财务报表 storage 主键；兼容旧键 shanchuan_v12 */
const FINANCE_RECORDS_KEY = 'shanhai_v12'
const FINANCE_RECORDS_KEY_LEGACY = 'shanchuan_v12'

function migrateFinanceRecordsFromLegacy() {
  try {
    if (!wx.getStorageSync(FINANCE_RECORDS_KEY)) {
      const legacy = wx.getStorageSync(FINANCE_RECORDS_KEY_LEGACY)
      if (legacy != null) wx.setStorageSync(FINANCE_RECORDS_KEY, legacy)
    }
  } catch (_) {
    /* ignore */
  }
}

module.exports = {
  FINANCE_RECORDS_KEY,
  FINANCE_RECORDS_KEY_LEGACY,
  migrateFinanceRecordsFromLegacy,
}
