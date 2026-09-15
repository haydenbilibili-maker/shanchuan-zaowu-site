/**
 * 后台角色（三级工作台：super_admin / store_manager / store_staff）
 *
 * 这里只决定「界面显示什么」。任何写操作的权限都由云函数的 staffGuard.js 自行校验，
 * 客户端拿到的 role 只是 UI 提示，改不了服务端结论。
 */
const {
  resolveWorkspaceRole,
  canSeeMenu,
  canAccessManagerTab,
  entryLabels,
  workbenchEntries,
  normalizeRolesList,
  MENU_KEYS,
  HUB_MENU_SECTIONS,
  WORKSPACE_SUPER_ADMIN,
  WORKSPACE_STORE_MANAGER,
  WORKSPACE_STORE_STAFF,
  WORKSPACE_SPECIMEN_ARTISAN,
  WORKSPACE_LIVE_HOST,
  WORKSPACE_INVESTOR,
  WORKSPACE_SHAREHOLDER
} = require('./workspaceRoles')

const CACHE_KEY = 'staff_role_cache_v1'
const CACHE_TTL_MS = 10 * 60 * 1000

const MANAGER_PATH = '/subpackages/manager/manager/index'
const MANAGER_WORKSPACE_PATH = '/subpackages/manager/manager/workspace/index'
const ARTISAN_PATH = '/subpackages/manager/artisan/index'
const LIVE_STUDIO_PATH = '/subpackages/manager/live/studio/index'
const LIVE_BROADCAST_PATH = '/subpackages/manager/live/broadcast/index'
const INVESTOR_PATH = '/subpackages/manager/investor/index'
const SHAREHOLDER_PATH = '/subpackages/manager/shareholder/index'
const STAFF_PATH = '/subpackages/manager/staff/index'
const STAFF_FIELD_PATH = '/subpackages/manager/staff/field/index'
const STORE_POINTS_PATH = '/subpackages/manager/store-points/index'
const STAFF_DIRECTORY_PATH = '/subpackages/manager/staff-directory/index'
const STAFF_PERMISSIONS_PATH = '/subpackages/manager/staff-permissions/index'
const SHAREHOLDER_CONFIG_PATH = '/subpackages/manager/shareholder-config/index'
const INVOICE_REQUESTS_PATH = '/subpackages/manager/invoice-requests/index'
const GIFT_OPS_PATH = '/subpackages/manager/gift-ops/index'
const GIFT_MANAGE_PATH = '/subpackages/manager/gift-manage/index'
const APPROVALS_PATH = '/subpackages/manager/approvals/index'
const HONORARY_CURATORS_PATH = '/subpackages/manager/honorary-curators/index'
const MEMBER_CRM_PATH = '/subpackages/manager/member-crm/index'
const MEMBER_LEVEL_ADJUST_PATH = '/subpackages/manager/member-level-adjust/index'
const WALLET_CONFIG_PATH = '/subpackages/manager/wallet-config/index'
const WELCOME_GIFT_PATH = '/subpackages/manager/welcome-gift/index'
const BIRTHDAY_GIFT_PATH = '/subpackages/manager/birthday-gift/index'
const DEPOSIT_OPS_PATH = '/subpackages/manager/deposit-ops/index'
const PURCHASE_OPS_PATH = '/subpackages/manager/purchase-ops/index'
const SHIPMENT_OPS_PATH = '/subpackages/manager/shipment-ops/index'
const INVENTORY_OPS_PATH = '/subpackages/manager/inventory-ops/index'
const RAW_INVENTORY_OPS_PATH = '/subpackages/manager/raw-inventory-ops/index'
const STUDIO_DASHBOARD_PATH = '/subpackages/manager/studio-dashboard/index'
const PROPERTY_COST_PATH = '/subpackages/manager/property-cost/index'
const ARTISAN_COMMISSION_PATH = '/subpackages/manager/artisan-commission/index'
const ARTISAN_COMMISSION_MINE_PATH = '/subpackages/manager/artisan/commission/index'
const BOOKING_RULES_PATH = '/subpackages/manager/booking-rules/index'
const SUPPORT_CONFIG_PATH = '/subpackages/manager/support-config/index'
const PAYSLIP_PATH = '/subpackages/manager/payslip/index'
const PAYSLIP_ADMIN_PATH = '/subpackages/manager/payslip/admin/index'

const EMPTY_ROLE = {
  role: '',
  roles: [],
  workspaceRole: '',
  isManager: false,
  isStaff: false,
  isSuperAdmin: false,
  isArtisan: false,
  isLiveHost: false,
  isInvestor: false,
  isShareholder: false,
  name: '',
  storeIds: [],
  permissions: [],
  shareholderProfile: null,
  superAdmin: false,
  hint: ''
}

function readCache() {
  try {
    const cache = wx.getStorageSync(CACHE_KEY)
    if (!cache || !cache.savedAt) return null
    if (Date.now() - cache.savedAt > CACHE_TTL_MS) return null
    return cache.data || null
  } catch (e) {
    return null
  }
}

function writeCache(data) {
  try {
    wx.setStorageSync(CACHE_KEY, { savedAt: Date.now(), data })
  } catch (e) { /* ignore */ }
}

function clearStaffRoleCache() {
  try {
    wx.removeStorageSync(CACHE_KEY)
  } catch (e) { /* ignore */ }
}

function normalize(result) {
  if (!result || !result.success) return { ...EMPTY_ROLE }
  const roles = Array.isArray(result.roles) ? result.roles.filter(Boolean) : normalizeRolesList(result)
  const workspaceRole = resolveWorkspaceRole({ ...result, roles })
  return {
    role: result.role || '',
    roles,
    workspaceRole,
    isManager: !!result.isManager || roles.indexOf('manager') !== -1 || roles.indexOf('super_admin') !== -1,
    isSpecimenArtisan: !!result.isArtisan || roles.indexOf('specimen_artisan') !== -1,
    isLiveHost: !!result.isLiveHost || roles.indexOf('live_host') !== -1,
    isInvestor: !!result.isInvestor || roles.indexOf('investor') !== -1,
    isShareholder: !!result.isShareholder || roles.indexOf('shareholder') !== -1,
    isStaff:
      !!result.isStaff ||
      roles.indexOf('staff') !== -1 ||
      roles.indexOf('manager') !== -1 ||
      roles.indexOf('super_admin') !== -1 ||
      roles.indexOf('specimen_artisan') !== -1 ||
      roles.indexOf('live_host') !== -1 ||
      roles.indexOf('investor') !== -1 ||
      roles.indexOf('shareholder') !== -1,
    isSuperAdmin: !!result.isSuperAdmin || roles.indexOf('super_admin') !== -1,
    name: result.name || '',
    staffNo: result.staffNo || '',
    storeIds: Array.isArray(result.storeIds) ? result.storeIds : [],
    permissions: Array.isArray(result.permissions) ? result.permissions : [],
    shareholderProfile: result.shareholderProfile || null,
    superAdmin: !!result.superAdmin || roles.indexOf('super_admin') !== -1,
    hint: result.hint || ''
  }
}

function roleHasStored(role, key) {
  const roles = role && Array.isArray(role.roles) ? role.roles : []
  if (key === 'super_admin') return roles.indexOf('super_admin') !== -1 || !!role.isSuperAdmin
  if (key === 'manager') return roles.indexOf('manager') !== -1 || roleHasStored(role, 'super_admin')
  if (key === 'staff') return roles.indexOf('staff') !== -1 || roleHasStored(role, 'manager')
  if (key === 'specimen_artisan') return roles.indexOf('specimen_artisan') !== -1 || roleHasStored(role, 'super_admin')
  if (key === 'live_host') return roles.indexOf('live_host') !== -1
  if (key === 'investor') return roles.indexOf('investor') !== -1
  if (key === 'shareholder') return roles.indexOf('shareholder') !== -1
  return roles.indexOf(key) !== -1
}

/**
 * 读取当前用户的后台角色。默认走 10 分钟缓存，force 时强制回源。
 */
async function fetchStaffRole(options = {}) {
  if (!options.force) {
    const cached = readCache()
    if (cached) return cached
  }
  try {
    const res = await wx.cloud.callFunction({ name: 'manageStaff', data: { action: 'whoami' } })
    const role = normalize(res && res.result)
    writeCache(role)
    return role
  } catch (e) {
    console.warn('fetchStaffRole', e)
    return { ...EMPTY_ROLE }
  }
}

function hasPermission(role, permission) {
  if (!role || !permission) return false
  if (role.isSuperAdmin || role.superAdmin || roleHasStored(role, 'super_admin')) return true
  return (role.permissions || []).indexOf(permission) !== -1
}

function goStaffConsole(tab) {
  const isEvent = !!(tab && (tab.currentTarget || tab.type === 'tap'))
  const key = isEvent ? '' : tab
  const parts = []
  if (key === 0 || key) parts.push(`tab=${encodeURIComponent(key)}`)
  // 可选第二参：{ autoScan: true } —— 工作台深链自动扫码
  const opts = arguments.length > 1 ? arguments[1] : null
  if (opts && opts.autoScan) parts.push('autoScan=1')
  const q = parts.length ? `?${parts.join('&')}` : ''
  wx.navigateTo({
    url: `${STAFF_FIELD_PATH}${q}`,
    fail: () => wx.showToast({ title: '店员工作台暂不可用', icon: 'none' })
  })
}

function goStaffHome() {
  wx.navigateTo({
    url: STAFF_PATH,
    fail: () => wx.showToast({ title: '店员工作台暂不可用', icon: 'none' })
  })
}

function goStorePoints(options) {
  // wxml bindtap 会传入 event；仅接受显式 { tab } 配置
  const isEvent = !!(options && (options.currentTarget || options.type === 'tap'))
  const tab = !isEvent && options && options.tab != null && options.tab !== ''
    ? String(options.tab)
    : ''
  const url = tab
    ? `${STORE_POINTS_PATH}?tab=${encodeURIComponent(tab)}`
    : STORE_POINTS_PATH
  wx.navigateTo({
    url,
    fail: () => wx.showToast({ title: '门店积分暂不可用', icon: 'none' })
  })
}

/** 仅超管：员工名册（聚合 staff_members，与权限中心同源） */
function goStaffDirectory() {
  wx.navigateTo({
    url: STAFF_DIRECTORY_PATH,
    fail: () => wx.showToast({ title: '员工模块暂不可用', icon: 'none' })
  })
}

/** 仅超管：门店后台角色与权限配置 */
function goStoreStaffPermissions() {
  wx.navigateTo({
    url: STAFF_PERMISSIONS_PATH,
    fail: () => wx.showToast({ title: '权限配置暂不可用', icon: 'none' })
  })
}

/** 仅超管：门店股东配置（占股 / 回本前·后分成） */
function goShareholderConfig() {
  wx.navigateTo({
    url: SHAREHOLDER_CONFIG_PATH,
    fail: () => wx.showToast({ title: '股东配置暂不可用', icon: 'none' })
  })
}

function goMyPayslip() {
  wx.navigateTo({
    url: `${PAYSLIP_PATH}?workspace=manager`,
    fail: () => wx.showToast({ title: '工资条暂不可用', icon: 'none' })
  })
}

function goPayslipAdmin() {
  wx.navigateTo({
    url: PAYSLIP_ADMIN_PATH,
    fail: () => wx.showToast({ title: '工资维护暂不可用', icon: 'none' })
  })
}

function goInvoiceRequests() {
  wx.navigateTo({
    url: INVOICE_REQUESTS_PATH,
    fail: () => wx.showToast({ title: '发票管理暂不可用', icon: 'none' })
  })
}

function goGiftOps(options) {
  const isEvent = !!(options && (options.currentTarget || options.type === 'tap'))
  const bucket = !isEvent && options && options.bucket
    ? String(options.bucket).trim()
    : ''
  const url = bucket
    ? `${GIFT_OPS_PATH}?bucket=${encodeURIComponent(bucket)}`
    : GIFT_OPS_PATH
  wx.navigateTo({
    url,
    fail: () => wx.showToast({ title: '礼赠履约暂不可用', icon: 'none' })
  })
}

function goGiftManage() {
  wx.navigateTo({
    url: GIFT_MANAGE_PATH,
    fail: () => wx.showToast({ title: '礼赠管理暂不可用', icon: 'none' })
  })
}

function goApprovals(options = {}) {
  const isEvent = !!(options && (options.currentTarget || options.type === 'tap'))
  const opts = isEvent ? {} : (options || {})
  const parts = []
  if (opts.mine === true || opts.mine === '1' || opts.mine === 1) parts.push('mine=1')
  if (opts.done === true || opts.done === '1' || opts.done === 1) parts.push('done=1')
  const hub = String(opts.hub || '').trim()
  if (hub) parts.push(`hub=${encodeURIComponent(hub)}`)
  const type = String(opts.type || opts.actionType || '').trim()
  if (type) parts.push(`type=${encodeURIComponent(type)}`)
  const url = parts.length ? `${APPROVALS_PATH}?${parts.join('&')}` : APPROVALS_PATH
  wx.navigateTo({
    url,
    fail: () => wx.showToast({ title: '审批队列暂不可用', icon: 'none' })
  })
}

/** 仅超管：荣誉馆长名单（与 Admin / manageHonoraryCurators 同源） */
function goHonoraryCurators() {
  wx.navigateTo({
    url: HONORARY_CURATORS_PATH,
    fail: () => wx.showToast({ title: '荣誉馆长名单暂不可用', icon: 'none' })
  })
}

/** 仅超管：会员 CRM（与 Admin CRM.vue / manageMemberCrm 同源） */
function goMemberCrm() {
  wx.navigateTo({
    url: MEMBER_CRM_PATH,
    fail: () => wx.showToast({ title: '会员 CRM 暂不可用', icon: 'none' })
  })
}

/** 仅超管：会员等级调整（与 Admin MemberLevelAdjust / manageMemberLevelAdjust 同源） */
function goMemberLevelAdjust() {
  wx.navigateTo({
    url: MEMBER_LEVEL_ADJUST_PATH,
    fail: () => wx.showToast({ title: '会员等级调整暂不可用', icon: 'none' })
  })
}

/** 仅超管：我的钱包档位/文案（manageStoredValue） */
function goWalletConfig() {
  wx.navigateTo({
    url: WALLET_CONFIG_PATH,
    fail: () => wx.showToast({ title: '钱包配置暂不可用', icon: 'none' })
  })
}

/** 仅超管：新会员礼包（member_welcome_gift） */
function goWelcomeGift() {
  wx.navigateTo({
    url: WELCOME_GIFT_PATH,
    fail: () => wx.showToast({ title: '新会员礼包暂不可用', icon: 'none' })
  })
}

/** 仅超管：生日礼包（member_birthday_gift） */
function goBirthdayGift() {
  wx.navigateTo({
    url: BIRTHDAY_GIFT_PATH,
    fail: () => wx.showToast({ title: '生日礼包暂不可用', icon: 'none' })
  })
}

/** 仅超管：售罄孤品定金规则与意向 */
function goDepositOps() {
  wx.navigateTo({
    url: DEPOSIT_OPS_PATH,
    fail: () => wx.showToast({ title: '定金管理暂不可用', icon: 'none' })
  })
}

/** 超管可写；店长只读本店采购账目 */
function goPurchaseOps() {
  wx.navigateTo({
    url: PURCHASE_OPS_PATH,
    fail: () => wx.showToast({ title: '采购管理暂不可用', icon: 'none' })
  })
}

/** 超管/店长：门店出货单主录入（ops_shipments SSOT） */
function goShipmentOps() {
  wx.navigateTo({
    url: SHIPMENT_OPS_PATH,
    fail: () => wx.showToast({ title: '出货单暂不可用', icon: 'none' })
  })
}

/** 超管 / 店长：库存管理（成品 Tab + 原材料 Tab） */
function goInventoryOps(opts) {
  const tab = opts && opts.tab ? String(opts.tab).trim() : ''
  const q = tab ? `?tab=${encodeURIComponent(tab)}` : ''
  wx.navigateTo({
    url: `${INVENTORY_OPS_PATH}${q}`,
    fail: () => wx.showToast({ title: '库存管理暂不可用', icon: 'none' })
  })
}

/** @deprecated 已合并进库存管理 Tab；保留兼容旧跳转 */
function goRawInventoryOps() {
  goInventoryOps({ tab: 'raw' })
}

/** 仅超管：工作室仪表盘（采购预算指标） */
function goStudioDashboard() {
  wx.navigateTo({
    url: STUDIO_DASHBOARD_PATH,
    fail: () => wx.showToast({ title: '工作室仪表盘暂不可用', icon: 'none' })
  })
}

/** 仅超管：物业成本（水电 / 房租） */
function goPropertyCost() {
  wx.navigateTo({
    url: PROPERTY_COST_PATH,
    fail: () => wx.showToast({ title: '物业成本暂不可用', icon: 'none' })
  })
}

/** 仅超管：标本师销售提成规则与账目 */
function goArtisanCommission() {
  wx.navigateTo({
    url: ARTISAN_COMMISSION_PATH,
    fail: () => wx.showToast({ title: '提成配置暂不可用', icon: 'none' })
  })
}

/** 标本师：本人提成明细 */
function goArtisanCommissionMine() {
  wx.navigateTo({
    url: ARTISAN_COMMISSION_MINE_PATH,
    fail: () => wx.showToast({ title: '提成明细暂不可用', icon: 'none' })
  })
}

/** 仅超管：预约规则（store_booking_rules） */
function goBookingRules() {
  wx.navigateTo({
    url: BOOKING_RULES_PATH,
    fail: () => wx.showToast({ title: '预约规则暂不可用', icon: 'none' })
  })
}

/** 仅超管：客服入口（support_configs） */
function goSupportConfig() {
  wx.navigateTo({
    url: SUPPORT_CONFIG_PATH,
    fail: () => wx.showToast({ title: '客服配置暂不可用', icon: 'none' })
  })
}

/**
 * 后台页 onLoad 守卫：服务端已经会拒绝越权调用，这里只是避免顾客误入空页面。
 * @param {'staff'|'manager'|'super_admin'} minRole
 */
async function guardStaffPage(minRole = 'staff') {
  const role = await fetchStaffRole({ force: true })
  let ok = false
  if (minRole === 'super_admin') {
    ok = roleHasStored(role, 'super_admin')
  } else if (minRole === 'manager') {
    ok = roleHasStored(role, 'manager')
  } else {
    ok = roleHasStored(role, 'staff')
  }
  if (ok) return role

  const denyTitle =
    role.hint ||
    (minRole === 'super_admin'
      ? '仅超管可进入'
      : minRole === 'manager'
        ? '仅店长可进入'
        : '暂无门店后台权限')
  wx.showToast({
    title: denyTitle,
    icon: 'none'
  })
  setTimeout(() => {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  }, 1200)
  return null
}

/**
 * 店长/直播/标本师后台页守卫（标本师主入口为 artisan 工作台，藏品录入仍深链至 manager）
 */
async function guardManagerWorkspace() {
  const role = await fetchStaffRole({ force: true })
  if (roleHasStored(role, 'manager') || roleHasStored(role, 'super_admin')) {
    return role
  }
  wx.showToast({ title: role.hint || '暂无工作台权限', icon: 'none' })
  setTimeout(() => {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  }, 1200)
  return null
}

/**
 * 标本师工作台：标本师 / 超管 / 具 manageProducts 的店长
 */
async function guardArtisanWorkspace() {
  const role = await fetchStaffRole({ force: true })
  if (roleHasStored(role, 'super_admin')) return role
  if (roleHasStored(role, 'specimen_artisan')) return role
  if (roleHasStored(role, 'manager') && hasPermission(role, 'manageProducts')) return role
  wx.showToast({ title: role.hint || '暂无标本师工作台权限', icon: 'none' })
  setTimeout(() => {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  }, 1200)
  return null
}

function goArtisanProductEntry() {
  wx.navigateTo({
    url: `${MANAGER_WORKSPACE_PATH}?tab=1&productTab=list&from=artisan&mine=1`,
    fail: () => wx.showToast({ title: '藏品录入暂不可用', icon: 'none' })
  })
}

function goArtisanProductCreate() {
  const url = `${MANAGER_WORKSPACE_PATH}?tab=1&productTab=create&from=artisan&mine=1`
  wx.navigateTo({
    url,
    fail: () => {
      // 页栈满时 navigateTo 失败，降级 redirectTo 仍可进入新建
      wx.redirectTo({
        url,
        fail: () => wx.showToast({ title: '上传藏品暂不可用', icon: 'none' })
      })
    }
  })
}

function goArtisanConcept() {
  wx.navigateTo({
    url: '/subpackages/manager/artisan/concept/index',
    fail: () => wx.showToast({ title: '概念生成暂不可用', icon: 'none' })
  })
}

function goArtisanManageProducts() {
  wx.navigateTo({
    url: '/subpackages/manager/artisan/works/index',
    fail: () => wx.showToast({ title: '作品库暂不可用', icon: 'none' })
  })
}

function goArtisanJobs(filter) {
  const f = String(filter || '').trim()
  const q = f ? `?mode=jobs&filter=${encodeURIComponent(f)}` : '?mode=jobs'
  wx.navigateTo({
    url: `/subpackages/manager/artisan/works/index${q}`,
    fail: () => wx.showToast({ title: '工单暂不可用', icon: 'none' })
  })
}

/**
 * 主播工作台 / 开播控制台：主播、超管，或具 manageLive 权限
 */
async function guardLiveHostWorkspace() {
  const role = await fetchStaffRole({ force: true })
  if (roleHasStored(role, 'live_host')) return role
  if (roleHasStored(role, 'super_admin')) return role
  if (hasPermission(role, 'manageLive')) return role
  wx.showToast({ title: role.hint || '暂无直播权限', icon: 'none' })
  setTimeout(() => {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  }, 1200)
  return null
}

/** 投资观测台：投资人角色 / 超管 / 持有观测只读权限点 */
async function guardInvestorWorkspace() {
  const role = await fetchStaffRole({ force: true })
  if (roleHasStored(role, 'investor')) return role
  if (roleHasStored(role, 'super_admin')) return role
  if (hasPermission(role, 'viewInvestorFinance') || hasPermission(role, 'viewInvestorAnalytics')) {
    return role
  }
  wx.showToast({ title: role.hint || '暂无投资观测台权限', icon: 'none' })
  setTimeout(() => {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  }, 1200)
  return null
}

function goInvestorObservatory() {
  wx.navigateTo({
    url: INVESTOR_PATH,
    fail: () => wx.showToast({ title: '投资观测台暂不可用', icon: 'none' })
  })
}

/** 股东观测台：股东角色 / 超管 / 持有股东只读权限点 */
async function guardShareholderWorkspace() {
  const role = await fetchStaffRole({ force: true })
  if (roleHasStored(role, 'shareholder')) return role
  if (roleHasStored(role, 'super_admin')) return role
  if (hasPermission(role, 'viewShareholderObservatory')) return role
  wx.showToast({ title: role.hint || '暂无股东观测台权限', icon: 'none' })
  setTimeout(() => {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  }, 1200)
  return null
}

function goShareholderObservatory() {
  wx.navigateTo({
    url: SHAREHOLDER_PATH,
    fail: () => wx.showToast({ title: '股东观测台暂不可用', icon: 'none' })
  })
}

function goLiveBroadcast(options) {
  const isEvent = !!(options && (options.currentTarget || options.type === 'tap'))
  const focus = !isEvent && options && options.focus ? String(options.focus) : ''
  const url = focus
    ? `${LIVE_BROADCAST_PATH}?focus=${encodeURIComponent(focus)}`
    : LIVE_BROADCAST_PATH
  wx.navigateTo({
    url,
    fail: () => wx.showToast({ title: '开播控制台暂不可用', icon: 'none' })
  })
}

function goLiveStudio() {
  wx.navigateTo({
    url: LIVE_STUDIO_PATH,
    fail: () => wx.showToast({ title: '主播工作台暂不可用', icon: 'none' })
  })
}

module.exports = {
  MANAGER_PATH,
  ARTISAN_PATH,
  LIVE_STUDIO_PATH,
  LIVE_BROADCAST_PATH,
  INVESTOR_PATH,
  SHAREHOLDER_PATH,
  STAFF_PATH,
  STAFF_FIELD_PATH,
  STORE_POINTS_PATH,
  STAFF_DIRECTORY_PATH,
  STAFF_PERMISSIONS_PATH,
  SHAREHOLDER_CONFIG_PATH,
  INVOICE_REQUESTS_PATH,
  APPROVALS_PATH,
  HONORARY_CURATORS_PATH,
  MEMBER_CRM_PATH,
  MEMBER_LEVEL_ADJUST_PATH,
  WALLET_CONFIG_PATH,
  WELCOME_GIFT_PATH,
  ARTISAN_COMMISSION_PATH,
  ARTISAN_COMMISSION_MINE_PATH,
  BOOKING_RULES_PATH,
  SUPPORT_CONFIG_PATH,
  PAYSLIP_PATH,
  PAYSLIP_ADMIN_PATH,
  PURCHASE_OPS_PATH,
  SHIPMENT_OPS_PATH,
  INVENTORY_OPS_PATH,
  RAW_INVENTORY_OPS_PATH,
  STUDIO_DASHBOARD_PATH,
  PROPERTY_COST_PATH,
  MENU_KEYS,
  HUB_MENU_SECTIONS,
  WORKSPACE_SUPER_ADMIN,
  WORKSPACE_STORE_MANAGER,
  WORKSPACE_STORE_STAFF,
  WORKSPACE_SPECIMEN_ARTISAN,
  WORKSPACE_LIVE_HOST,
  WORKSPACE_INVESTOR,
  WORKSPACE_SHAREHOLDER,
  fetchStaffRole,
  clearStaffRoleCache,
  hasPermission,
  canSeeMenu,
  canAccessManagerTab,
  entryLabels,
  workbenchEntries,
  resolveWorkspaceRole,
  goStaffConsole,
  goStaffHome,
  goStorePoints,
  goStaffDirectory,
  goStoreStaffPermissions,
  goShareholderConfig,
  goMyPayslip,
  goPayslipAdmin,
  goInvoiceRequests,
  goGiftOps,
  goGiftManage,
  goApprovals,
  goHonoraryCurators,
  goMemberCrm,
  goMemberLevelAdjust,
  goWalletConfig,
  goWelcomeGift,
  goBirthdayGift,
  goDepositOps,
  goPurchaseOps,
  goShipmentOps,
  goInventoryOps,
  goRawInventoryOps,
  goStudioDashboard,
  goPropertyCost,
  goArtisanCommission,
  goArtisanCommissionMine,
  goBookingRules,
  goSupportConfig,
  guardStaffPage,
  guardManagerWorkspace,
  guardArtisanWorkspace,
  guardLiveHostWorkspace,
  guardInvestorWorkspace,
  goInvestorObservatory,
  guardShareholderWorkspace,
  goShareholderObservatory,
  goArtisanProductEntry,
  goArtisanProductCreate,
  goArtisanConcept,
  goArtisanManageProducts,
  goArtisanJobs,
  goLiveBroadcast,
  goLiveStudio,
  roleHasStored
}
