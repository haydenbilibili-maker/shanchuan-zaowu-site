/**
 * 员工通讯录 —— **零依赖纯逻辑**（供 `staffDirectory.js` 与 Node 单测共用）
 *
 * 为什么要单独一层（2026-09-17 全面审计 D6）：
 *   `admin/scripts/test-staff-directory.mjs` 原先在测试文件里**内联了一份同构实现**，
 *   从不读生产代码 —— 生产实现改坏测试照样绿（守卫空转，比没有守卫更糟：它给的是假信心）。
 *   而 `staffDirectory.js` 顶部 `import { callCloudFunction } from '../cloud.js'` 会初始化
 *   CloudBase，Node 下无法直接 import 测试。
 *   故把纯逻辑下沉到本文件（零 import、无副作用）：生产实现与单测**读同一份代码**。
 *   同一范式见 `admin/src/utils/costRate.js`（财务成本率，为 Node 单测而下沉）。
 */

/** `manageStaff.listStaff` 的服务端硬上限：`.limit(100)`，没有分页参数 */
export const STAFF_LIST_LIMIT = 100

/** 统一的失败形态：**读不到** ≠ **真的没有员工**（前者 active 不可信，展示层给「—」） */
export function staffDirectoryFailure(error) {
  return {
    ok: false,
    list: [],
    active: 0,
    disabled: 0,
    total: 0,
    truncated: false,
    error: error || '员工列表返回失败',
  }
}

/**
 * 把 `manageStaff.listStaff` 的返回归一化。
 * 刻意不吞错：调用方必须能区分「确实 0 名员工」与「没读到」。
 */
export function summarizeStaffList(res, limit = STAFF_LIST_LIMIT) {
  if (!res || res.success === false) {
    return staffDirectoryFailure(res && res.msg ? res.msg : '员工列表返回失败')
  }
  const list = Array.isArray(res.list) ? res.list : []
  const active = list.filter((r) => (r && r.status ? r.status : 'active') !== 'disabled').length
  return {
    ok: true,
    list,
    active,
    disabled: list.length - active,
    total: list.length,
    // 服务端 limit(100) 且无分页：正好取满时必须如实标出「可能被截断」，不能当作精确值
    // 单测会临时破坏这一行来证明「守卫真的读生产实现」—— 改动时请同步 selftest。
    truncated: list.length >= limit,
  }
}

/** KPI 展示值：读不到时给「—」而不是 0 —— 0 会被误读成「没有员工」 */
export function staffCountDisplay(staff) {
  if (!staff || !staff.ok) return '—'
  return staff.truncated ? `${staff.active}+` : String(staff.active)
}
