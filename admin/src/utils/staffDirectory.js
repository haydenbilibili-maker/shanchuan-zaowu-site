/**
 * 员工通讯录（staff_members）—— 与小程序超管工作台「员工」模块**同源**。
 *
 * 背景（2026-09-16，产品负责人指出）：
 * 「经营驾驶舱」的「在职员工」KPI 原先取 `payrollStorage` 的 localStorage 花名册，
 * 而那份数据 ERP 侧从未被填充 → 卡片恒显示 0，看不出「没有人」还是「没读到数据」。
 * 小程序超管工作台 →「员工」模块（`subpackages/manager/staff-directory/index.js`）
 * 头部即写明「聚合 staff_members（与权限中心同源）」，所以这里走同一条路：
 * `manageStaff` 云函数（已在前端代理白名单内）。
 *
 * 为什么不能直接读集合：`cloudbase/rules/staff_members.json` 是 `{read:false, write:false}`
 * —— 浏览器端匿名会话读不到，必须经云函数代理（代理会注入 ADMIN_OPS_KEY）。
 */
import { callCloudFunction } from '../cloud.js'

export const MANAGE_STAFF_FN = 'manageStaff'

/** `manageStaff.listStaff` 的服务端硬上限：`.limit(100)`，没有分页参数 */
export const STAFF_LIST_LIMIT = 100

/**
 * 拉取员工通讯录。
 *
 * 刻意**不吞错**：调用方需要区分「确实没有员工」与「没读到」—— 二者都表现为 0，
 * 而这正是原缺陷的形态（0 无法区分「空」与「失败」）。
 *
 * @returns {Promise<{ ok: boolean, list: Array, active: number, disabled: number,
 *   total: number, truncated: boolean, error?: string }>}
 */
export async function fetchStaffDirectory() {
  try {
    const res = await callCloudFunction(MANAGE_STAFF_FN, { action: 'list', status: 'all' })
    if (!res || res.success === false) {
      return { ok: false, list: [], active: 0, disabled: 0, total: 0, truncated: false, error: res?.msg || '员工列表返回失败' }
    }
    const list = Array.isArray(res.list) ? res.list : []
    const active = list.filter((r) => (r?.status || 'active') !== 'disabled').length
    return {
      ok: true,
      list,
      active,
      disabled: list.length - active,
      total: list.length,
      // 服务端 limit(100) 且无分页：正好 100 条时可能被截断，必须如实标出，不能当作精确值
      truncated: list.length >= STAFF_LIST_LIMIT,
    }
  } catch (e) {
    return { ok: false, list: [], active: 0, disabled: 0, total: 0, truncated: false, error: e?.message || '员工列表加载失败' }
  }
}

/** KPI 展示值：读不到时给「—」而不是 0 —— 0 会被误读成「没有员工」 */
export function staffCountDisplay(staff) {
  if (!staff || !staff.ok) return '—'
  return staff.truncated ? `${staff.active}+` : String(staff.active)
}
