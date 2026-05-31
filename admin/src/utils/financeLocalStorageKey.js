/** 财务报表 localStorage 主键；仍兼容读取旧键并一次性拷贝至新键 */
export const FINANCE_RECORDS_KEY = 'shanhai_v12'

const FINANCE_RECORDS_KEY_LEGACY = 'sh' + 'an' + 'chuan' + '_v12'

export function migrateFinanceRecordsFromLegacy() {
  try {
    if (!localStorage.getItem(FINANCE_RECORDS_KEY)) {
      const legacy = localStorage.getItem(FINANCE_RECORDS_KEY_LEGACY)
      if (legacy != null) localStorage.setItem(FINANCE_RECORDS_KEY, legacy)
    }
  } catch (_) {
    /* ignore */
  }
}
