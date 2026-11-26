/**
 * AI 页面（智能运营中心 / 董事辩论）的员工门禁（2026-11-26 上线巡查）。
 *
 * 为什么放在主包：`subpackages/ai` 不能引用 `subpackages/manager`（微信禁止分包互相引用），
 * 但门禁只依赖 `manageStaff whoami` 这一个云函数，放主包两边都能用。
 *
 * 语义：超管 / 店长 / 店员放行；其余角色（含游客）提示后返回。
 */
const STAFF_ROLES = ['super_admin', 'manager', 'store_manager', 'staff']

function rolesOf(result) {
  const r = (result && result.result) || {}
  const list = Array.isArray(r.roles) ? r.roles.slice() : []
  if (r.isSuperAdmin || r.superAdmin) list.push('super_admin')
  if (r.isManager || r.role === 'manager' || r.staffRole === 'manager') list.push('manager')
  if (r.isStaff || r.role === 'staff' || r.staffRole === 'staff') list.push('staff')
  if (r.staffRole) list.push(String(r.staffRole))
  return list
}

async function guardAiStaffPage() {
  try {
    const res = await wx.cloud.callFunction({ name: 'manageStaff', data: { action: 'whoami' } })
    const roles = rolesOf(res)
    if (roles.some((x) => STAFF_ROLES.indexOf(x) !== -1)) return roles
  } catch (e) {
    // 取不到角色按无权限处理（fail-closed：审核期宁可少给看）
  }
  // 不弹原生 toast（弹窗棘轮只减不增）：直接退回上一页
  setTimeout(() => {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  }, 400)
  return null
}

module.exports = { guardAiStaffPage, STAFF_ROLES }
