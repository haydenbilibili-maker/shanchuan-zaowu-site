import { safeWarn } from '../utils/safeStorage.js'
/** 财务报表 localStorage 主键；仍兼容读取旧键并一次性拷贝至新键 */
export const FINANCE_RECORDS_KEY = 'shanhai_v12'

const FINANCE_RECORDS_KEY_LEGACY = 'sh' + 'an' + 'chuan' + '_v12'

export function migrateFinanceRecordsFromLegacy() {
  try {
    if (!localStorage.getItem(FINANCE_RECORDS_KEY)) {
      const legacy = localStorage.getItem(FINANCE_RECORDS_KEY_LEGACY)
      if (legacy != null) localStorage.setItem(FINANCE_RECORDS_KEY, legacy)
    }
  } catch (_) { safeWarn('financeLocalStorageKey 非关键操作失败（已忽略）', _) }
}
