/**
 * 员工主数据以薪酬模块 payroll.employees 为唯一来源；
 * 门店 bundle.staff 中由薪酬同步的行带 payrollEmployeeId / 固定 id 前缀 stf_pe_
 */

export const PAYROLL_STAFF_ID_PREFIX = 'stf_pe_'

export function payrollLinkedStaffId(employeeId) {
  return `${PAYROLL_STAFF_ID_PREFIX}${employeeId}`
}

/**
 * 根据薪酬花名册重建「门店店员」在店铺管理中的 staff 行（保留非薪酬来源的 legacy 行）
 * @param {import('./storeStorage.js').loadStoreBundle extends object} bundle
 * @param {import('./payrollStorage.js').loadPayrollBundle extends object} payroll
 */
export function rebuildStoreStaffFromPayrollEmployees(bundle, payroll) {
  if (!bundle || !payroll) return bundle
  const staff = bundle.staff || []
  const legacy = staff.filter(
    (s) => !s.payrollEmployeeId && !String(s.id || '').startsWith(PAYROLL_STAFF_ID_PREFIX),
  )
  const linked = []
  for (const e of payroll.employees || []) {
    if (e.employeeType !== 'store_clerk' || !e.storeId) continue
    linked.push({
      id: payrollLinkedStaffId(e.id),
      storeId: e.storeId,
      payrollEmployeeId: e.id,
      name: e.name || '',
      phone: e.phone || '',
      position: e.position || '店员',
      gender: e.gender || '',
      hireDate: e.hireDate || '',
      leaveDate: e.leaveDate || '',
      status: e.status === 'left' ? 'left' : 'active',
      syncedAt: Date.now(),
    })
  }
  bundle.staff = [...legacy, ...linked]
  return bundle
}

/** 与店铺/薪酬模块监听的事件名一致 */
export const UNIFIED_EMPLOYEES_CHANGED = 'sc-unified-employees-changed'
