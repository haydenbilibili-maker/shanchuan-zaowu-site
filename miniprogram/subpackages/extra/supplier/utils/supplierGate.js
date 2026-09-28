/**
 * B2B 工作台门禁（客户端 UI；写操作仍须云侧校验）
 *
 * - 超管：preview（可看采购 + 供货方演示）
 * - roles 含 supplier：供货方身份
 * - roles 含 buyer / franchisee / channel：采购商身份（正式契约：staffGuard / manageStaff 可写）
 * - 普通店长：不可进
 *
 * ⚠️ 无 deny toast（dialog-ratchet）；失败仅 navigateBack。
 */
const { fetchStaffRole, roleHasStored } = require('../../utils/staffAuth')

const BUYER_ROLES = ['buyer', 'franchisee', 'channel']

function roleList(role) {
  return Array.isArray(role && role.roles) ? role.roles : []
}

function isSupplierActor(role) {
  if (!role) return false
  if (roleHasStored(role, 'supplier')) return true
  return roleList(role).indexOf('supplier') !== -1
}

function isBuyerActor(role) {
  if (!role) return false
  for (let i = 0; i < BUYER_ROLES.length; i++) {
    const r = BUYER_ROLES[i]
    if (roleHasStored(role, r) || roleList(role).indexOf(r) !== -1) return true
  }
  return false
}

function isSuperPreview(role) {
  return !!(role && (roleHasStored(role, 'super_admin') || role.isSuperAdmin || role.superAdmin))
}

/**
 * @returns {Promise<object|null>} role + { supplierMode, deskKind }
 * deskKind: 'preview' | 'buyer' | 'supplier'
 */
async function guardSupplierWorkspace() {
  const role = await fetchStaffRole({ force: true })
  if (isSuperPreview(role)) {
    return { ...role, supplierMode: 'preview', deskKind: 'preview' }
  }
  if (isBuyerActor(role)) {
    return { ...role, supplierMode: 'buyer', deskKind: 'buyer' }
  }
  if (isSupplierActor(role)) {
    return { ...role, supplierMode: 'supplier', deskKind: 'supplier' }
  }
  setTimeout(() => {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  }, 400)
  return null
}

module.exports = {
  guardSupplierWorkspace,
  isSupplierActor,
  isBuyerActor,
  isSuperPreview,
  BUYER_ROLES
}
