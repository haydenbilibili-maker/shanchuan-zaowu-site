/**
 * 员工薪酬模块 — 本地聚合（与 PRD v1.1 对齐，可后续迁云）
 */

const STORAGE_KEY = 'sc_payroll_bundle_v1'
const DATA_VERSION = 1

export const EMPLOYEE_TYPES = {
  store_clerk: '门店店员',
  specimen: '标本师',
  function: '其它职能',
}

export function defaultPayrollSettings() {
  return {
    payDayOfMonth: 10,
    clerkCommissionRate: 0.01,
    clerkCommissionMode: 'pool',
    defaultExpectedWorkDays: 22,
    /** 可选：按门店覆盖提点比例，如 { "store_xxx": 0.012 } */
    storeCommissionRates: {},
    /** 工号公司段：0=甲 … 9=癸，再循环 */
    companyTianGanIndex: 0,
  }
}

function emptyBundle() {
  return {
    _v: DATA_VERSION,
    settings: defaultPayrollSettings(),
    employees: [],
    attendanceMonths: [],
    slips: [],
    /** 当月门店计提成营收覆盖：key = `${storeId}::${yearMonth}` → 金额；仅当自动汇总为 0 时算薪采用，否则以登记营收为准 */
    revenueOverrides: {},
    auditLogs: [],
  }
}

export function loadPayrollBundle() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyBundle()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return emptyBundle()
    const b = emptyBundle()
    b.settings = { ...defaultPayrollSettings(), ...(parsed.settings || {}) }
    if (!b.settings.storeCommissionRates || typeof b.settings.storeCommissionRates !== 'object') {
      b.settings.storeCommissionRates = {}
    }
    b.employees = Array.isArray(parsed.employees) ? parsed.employees : []
    b.attendanceMonths = Array.isArray(parsed.attendanceMonths) ? parsed.attendanceMonths : []
    b.slips = Array.isArray(parsed.slips) ? parsed.slips : []
    b.revenueOverrides =
      parsed.revenueOverrides && typeof parsed.revenueOverrides === 'object' ? { ...parsed.revenueOverrides } : {}
    b.auditLogs = Array.isArray(parsed.auditLogs) ? parsed.auditLogs.slice(-500) : []
    return b
  } catch {
    return emptyBundle()
  }
}

export function savePayrollBundle(bundle) {
  const next = { ...bundle, _v: DATA_VERSION, _updatedAt: Date.now() }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function genPayrollId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export function appendAuditLog(bundle, action, detail) {
  const log = {
    id: genPayrollId('log'),
    at: Date.now(),
    action,
    detail: detail || '',
  }
  const logs = [...(bundle.auditLogs || []), log].slice(-500)
  return { ...bundle, auditLogs: logs }
}
