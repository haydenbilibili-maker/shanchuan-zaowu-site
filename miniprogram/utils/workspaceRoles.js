/**
 * 店长工作台三级角色与菜单裁剪（第 1 轮：入口 + 可见性）
 * 真正写操作仍由云函数 staffGuard 校验。
 */

const WORKSPACE_SUPER_ADMIN = 'super_admin'
const WORKSPACE_STORE_MANAGER = 'store_manager'
const WORKSPACE_STORE_STAFF = 'store_staff'
const WORKSPACE_SPECIMEN_ARTISAN = 'specimen_artisan'
const WORKSPACE_LIVE_HOST = 'live_host'
const WORKSPACE_INVESTOR = 'investor'
const WORKSPACE_SHAREHOLDER = 'shareholder'

/** 与云函数 staffGuard 同源硬编码白名单 */
const SUPER_ADMIN_OPENIDS = [
  'oa22s5ZcMY7xkQDlNW8X8jaYy46M',
  'oa22s5RuZSXOCRQtXzdrVEiT1JuY'
]

/**
 * 超管：现有全部菜单/能力
 * 店长：账本、订单、藏品、现场核销、工单、发票、积分流水/撤销（规则配置仅超管）
 * 店员：不进 manager 页，仅 staff 工作台
 */
const MENU_KEYS = {
  LEDGER: 'ledger',
  ORDERS: 'orders',
  PRODUCTS: 'products',
  VERIFY: 'verify',
  WORK_ORDERS: 'workOrders',
  INVOICE: 'invoice',
  GIFT_OPS: 'giftOps',
  GIFT_MANAGE: 'giftManage',
  POINTS: 'points',
  APPROVALS: 'approvals',
  ACTIVITIES: 'activities',
  VIP: 'vip',
  FRAMERS: 'framers',
  FRAMER_RECRUIT: 'framerRecruit',
  DECOR: 'decor',
  CONTENT: 'content',
  SUPPORT: 'support',
  STORES: 'stores',
  ANALYTICS: 'analytics',
  SHIPPING: 'shipping',
  CONTENT_FLAGS: 'contentFlags',
  /** 字段维护：装裱方式(craftType) / 制作工艺(craftProcess)—— 仅超管（见 menusForWorkspace） */
  PRODUCT_FIELDS: 'productFields',
  LIVE: 'live',
  HONORARY_CURATORS: 'honoraryCurators',
  MEMBER_CRM: 'memberCrm',
  MEMBER_LEVEL_ADJUST: 'memberLevelAdjust',
  WALLET_CONFIG: 'walletConfig',
  WELCOME_GIFT: 'welcomeGift',
  DEPOSIT_OPS: 'depositOps',
  PURCHASE_OPS: 'purchaseOps',
  SHIPMENT_OPS: 'shipmentOps',
  INVENTORY_OPS: 'inventoryOps',
  RAW_INVENTORY_OPS: 'rawInventoryOps',
  STUDIO_DASHBOARD: 'studioDashboard',
  STUDIO_BILLS: 'studioBills',
  SHIPMENT_SKU: 'shipmentSku',
  FEISHU_SYNC: 'feishuSync',
  PROPERTY_COST: 'propertyCost',
  ARTISAN_COMMISSION: 'artisanCommission',
  BOOKING_RULES: 'bookingRules',
  SUPPORT_CONFIG: 'supportConfig',
  STAFF_DIRECTORY: 'staffDirectory',
  STAFF_PERMISSIONS: 'staffPermissions',
  SHAREHOLDER_CONFIG: 'shareholderConfig',
  STAFF_CONSOLE: 'staffConsole',
  GRANT_POINTS: 'grantPoints',
  DASHBOARD_KPI: 'dashboardKpi',
  MY_PAYSLIP: 'myPayslip',
  PAYSLIP_ADMIN: 'payslipAdmin'
}

/** curTab idx → menu key（仅 manager 页内 switchTab） */
const TAB_MENU_KEY = {
  1: MENU_KEYS.PRODUCTS,
  2: MENU_KEYS.ORDERS,
  4: MENU_KEYS.DECOR,
  5: MENU_KEYS.FRAMERS,
  6: MENU_KEYS.VIP,
  7: MENU_KEYS.ACTIVITIES,
  8: MENU_KEYS.LEDGER,
  9: MENU_KEYS.CONTENT,
  10: MENU_KEYS.WORK_ORDERS,
  11: MENU_KEYS.SUPPORT,
  12: MENU_KEYS.STORES,
  13: MENU_KEYS.ANALYTICS,
  14: MENU_KEYS.FRAMER_RECRUIT,
  15: MENU_KEYS.SHIPPING,
  16: MENU_KEYS.CONTENT_FLAGS,
  17: MENU_KEYS.PRODUCT_FIELDS
}

const SUPER_ADMIN_MENUS = Object.keys(MENU_KEYS).map((k) => MENU_KEYS[k])

const STORE_MANAGER_MENUS = [
  MENU_KEYS.LEDGER,
  MENU_KEYS.ORDERS,
  MENU_KEYS.PRODUCTS,
  MENU_KEYS.VERIFY,
  MENU_KEYS.WORK_ORDERS,
  MENU_KEYS.INVOICE,
  MENU_KEYS.GIFT_OPS,
  MENU_KEYS.GIFT_MANAGE,
  MENU_KEYS.POINTS,
  MENU_KEYS.APPROVALS,
  MENU_KEYS.GRANT_POINTS,
  MENU_KEYS.STAFF_CONSOLE,
  MENU_KEYS.DASHBOARD_KPI,
  MENU_KEYS.MY_PAYSLIP,
  MENU_KEYS.PURCHASE_OPS,
  MENU_KEYS.SHIPMENT_OPS,
  MENU_KEYS.INVENTORY_OPS,
  MENU_KEYS.STUDIO_BILLS
]

const STORE_STAFF_MENUS = [
  MENU_KEYS.VERIFY,
  MENU_KEYS.GRANT_POINTS,
  MENU_KEYS.STAFF_CONSOLE,
  MENU_KEYS.APPROVALS
]

/** 标本师在店长页仅保留藏品库深链（主入口为标本师工作台） */
const SPECIMEN_ARTISAN_MENUS = [
  MENU_KEYS.PRODUCTS
]

/** 直播主播：主入口为「主播工作台」，不在店长页展示直播菜单 */
const LIVE_HOST_MENUS = []

/** 投资人：独立观测台，不进店长经营菜单 */
const INVESTOR_MENUS = []

/** 股东：独立股东观测台，不进店长经营菜单 */
const SHAREHOLDER_MENUS = []

function isSuperAdminOpenid(openid) {
  return !!openid && SUPER_ADMIN_OPENIDS.indexOf(String(openid)) !== -1
}

function menusForWorkspace(workspaceRole) {
  if (workspaceRole === WORKSPACE_SUPER_ADMIN) return SUPER_ADMIN_MENUS.slice()
  if (workspaceRole === WORKSPACE_STORE_MANAGER) return STORE_MANAGER_MENUS.slice()
  if (workspaceRole === WORKSPACE_STORE_STAFF) return STORE_STAFF_MENUS.slice()
  if (workspaceRole === WORKSPACE_SPECIMEN_ARTISAN) return SPECIMEN_ARTISAN_MENUS.slice()
  if (workspaceRole === WORKSPACE_LIVE_HOST) return LIVE_HOST_MENUS.slice()
  if (workspaceRole === WORKSPACE_INVESTOR) return INVESTOR_MENUS.slice()
  if (workspaceRole === WORKSPACE_SHAREHOLDER) return SHAREHOLDER_MENUS.slice()
  return []
}

function canSeeMenu(workspaceRole, menuKey) {
  return menusForWorkspace(workspaceRole).indexOf(menuKey) !== -1
}

function canAccessManagerTab(workspaceRole, tabIdx) {
  if (workspaceRole === WORKSPACE_SUPER_ADMIN) return true
  const key = TAB_MENU_KEY[tabIdx]
  if (!key) return tabIdx === 0
  return canSeeMenu(workspaceRole, key)
}

/**
 * 店长/超管 Hub 菜单分组（与 index.wxml panel 对齐）
 * 工作室模块入口顺序：
 * 仪表盘 → 物业 → 采购 → 出货单 → 库存管理 → 标本师管理 → 工单 → 合作申请
 * 组织：员工 → 权限配置 → 股东配置
 */
const HUB_MENU_SECTIONS = {
  OPS: [
    MENU_KEYS.LEDGER,
    MENU_KEYS.ORDERS,
    MENU_KEYS.ANALYTICS,
    MENU_KEYS.SHIPPING,
    MENU_KEYS.PRODUCTS,
    MENU_KEYS.ACTIVITIES,
    MENU_KEYS.DECOR,
    MENU_KEYS.CONTENT,
    MENU_KEYS.LIVE,
    MENU_KEYS.STORES,
    MENU_KEYS.CONTENT_FLAGS,
    MENU_KEYS.PRODUCT_FIELDS
  ],
  STUDIO: [
    MENU_KEYS.STUDIO_DASHBOARD,
    MENU_KEYS.SHIPMENT_SKU,
    MENU_KEYS.FEISHU_SYNC,
    MENU_KEYS.STUDIO_BILLS,
    MENU_KEYS.PROPERTY_COST,
    MENU_KEYS.PURCHASE_OPS,
    MENU_KEYS.SHIPMENT_OPS,
    MENU_KEYS.INVENTORY_OPS,
    MENU_KEYS.RAW_INVENTORY_OPS,
    MENU_KEYS.FRAMERS,
    MENU_KEYS.WORK_ORDERS,
    MENU_KEYS.FRAMER_RECRUIT
  ],
  MEMBERS: [
    MENU_KEYS.MEMBER_CRM,
    MENU_KEYS.VIP,
    MENU_KEYS.SUPPORT,
    MENU_KEYS.MEMBER_LEVEL_ADJUST,
    MENU_KEYS.HONORARY_CURATORS
  ],
  /** 组织：员工花名册（聚合 staff_members）+ 权限中心 + 股东配置 */
  ORG: [
    MENU_KEYS.STAFF_DIRECTORY,
    MENU_KEYS.STAFF_PERMISSIONS,
    MENU_KEYS.SHAREHOLDER_CONFIG
  ],
  ON_SITE: [
    MENU_KEYS.VERIFY,
    MENU_KEYS.POINTS,
    MENU_KEYS.APPROVALS,
    MENU_KEYS.INVOICE,
    MENU_KEYS.GIFT_OPS,
    MENU_KEYS.GIFT_MANAGE,
    MENU_KEYS.WALLET_CONFIG,
    MENU_KEYS.WELCOME_GIFT,
    MENU_KEYS.DEPOSIT_OPS,
    MENU_KEYS.ARTISAN_COMMISSION,
    MENU_KEYS.BOOKING_RULES,
    MENU_KEYS.SUPPORT_CONFIG,
    MENU_KEYS.STAFF_CONSOLE,
    MENU_KEYS.MY_PAYSLIP,
    MENU_KEYS.PAYSLIP_ADMIN
  ]
}

/** 「我的」工作台瓷砖顺序：经营岗在前，投资/股东观测台始终排在可见列表末尾 */
const WORKBENCH_ORDER = [
  'super_admin',
  'manager',
  'staff',
  'specimen_artisan',
  'live_host',
  'investor',
  'shareholder'
]

const WORKBENCH_META = {
  super_admin: {
    key: 'super_admin',
    kind: 'super_admin',
    title: '超管工作台',
    en: 'SUPER',
    workspace: WORKSPACE_SUPER_ADMIN
  },
  manager: {
    key: 'manager',
    kind: 'manager',
    title: '店长工作台',
    en: 'MANAGER',
    workspace: WORKSPACE_STORE_MANAGER
  },
  staff: {
    key: 'staff',
    kind: 'staff',
    title: '店员工作台',
    en: 'STAFF',
    workspace: WORKSPACE_STORE_STAFF
  },
  specimen_artisan: {
    key: 'specimen_artisan',
    kind: 'artisan',
    title: '标本师工作台',
    en: 'ARTISAN',
    workspace: WORKSPACE_SPECIMEN_ARTISAN
  },
  live_host: {
    key: 'live_host',
    kind: 'live_host',
    title: '主播工作台',
    en: 'LIVE HOST',
    workspace: WORKSPACE_LIVE_HOST
  },
  investor: {
    key: 'investor',
    kind: 'investor',
    title: '投资观测台',
    en: 'OBSERVATORY',
    workspace: WORKSPACE_INVESTOR
  },
  shareholder: {
    key: 'shareholder',
    kind: 'shareholder',
    title: '股东观测台',
    en: 'SHAREHOLDER OBSERVATORY',
    workspace: WORKSPACE_SHAREHOLDER
  }
}

function normalizeRolesList(payload) {
  if (!payload) return []
  if (Array.isArray(payload.roles) && payload.roles.length) {
    const set = {}
    payload.roles.forEach((r) => {
      const v = String(r || '').trim()
      if (v) set[v] = true
    })
    return Object.keys(set)
  }
  const resolved = resolveWorkspaceRole(payload)
  if (resolved === WORKSPACE_SUPER_ADMIN) return ['super_admin']
  if (resolved === WORKSPACE_STORE_MANAGER) return ['manager']
  if (resolved === WORKSPACE_STORE_STAFF) return ['staff']
  if (resolved === WORKSPACE_SPECIMEN_ARTISAN) return ['specimen_artisan']
  if (resolved === WORKSPACE_LIVE_HOST) return ['live_host']
  if (resolved === WORKSPACE_INVESTOR) return ['investor']
  if (resolved === WORKSPACE_SHAREHOLDER) return ['shareholder']
  return []
}

function hasStoredRoleInList(roles, key) {
  const list = roles || []
  if (key === 'super_admin') return list.indexOf('super_admin') !== -1
  if (key === 'manager') return list.indexOf('manager') !== -1
  if (key === 'staff') return list.indexOf('staff') !== -1
  return list.indexOf(key) !== -1
}

/** 「我的」页：按已授予角色生成多条工作台入口 */
function workbenchEntries(payload) {
  const roles = normalizeRolesList(payload)
  // 兼容：仅勾了观测权限点、roles 未带 investor 时仍展示入口
  const perms = Array.isArray(payload && payload.permissions) ? payload.permissions : []
  if (
    roles.indexOf('investor') === -1 &&
    (perms.indexOf('viewInvestorFinance') !== -1 ||
      perms.indexOf('viewInvestorAnalytics') !== -1 ||
      !!(payload && payload.isInvestor))
  ) {
    roles.push('investor')
  }
  if (
    roles.indexOf('shareholder') === -1 &&
    (perms.indexOf('viewShareholderObservatory') !== -1 ||
      !!(payload && payload.isShareholder))
  ) {
    roles.push('shareholder')
  }
  const entries = []
  WORKBENCH_ORDER.forEach((storedKey) => {
    if (!hasStoredRoleInList(roles, storedKey)) return
    const meta = WORKBENCH_META[storedKey]
    if (meta) entries.push({ ...meta })
  })
  return entries
}

/** @deprecated 单角色入口文案；多角色请用 workbenchEntries */
function entryLabels(workspaceRole) {
  if (workspaceRole === WORKSPACE_SUPER_ADMIN) {
    return {
      managerTitle: '超管工作台',
      managerEn: 'SUPER',
      showManager: true,
      staffTitle: '店员工作台',
      staffEn: 'STAFF',
      showStaff: true
    }
  }
  if (workspaceRole === WORKSPACE_STORE_MANAGER) {
    return {
      managerTitle: '店长工作台',
      managerEn: 'MANAGER',
      showManager: true,
      staffTitle: '店员工作台',
      staffEn: 'STAFF',
      showStaff: true
    }
  }
  if (workspaceRole === WORKSPACE_STORE_STAFF) {
    return {
      managerTitle: '',
      managerEn: '',
      showManager: false,
      staffTitle: '店员工作台',
      staffEn: 'STAFF',
      showStaff: true
    }
  }
  if (workspaceRole === WORKSPACE_SPECIMEN_ARTISAN) {
    return {
      managerTitle: '标本师工作台',
      managerEn: 'ARTISAN',
      showManager: true,
      staffTitle: '',
      staffEn: '',
      showStaff: false
    }
  }
  if (workspaceRole === WORKSPACE_LIVE_HOST) {
    return {
      managerTitle: '',
      managerEn: '',
      showManager: false,
      staffTitle: '',
      staffEn: '',
      showStaff: false,
      liveHostTitle: '主播工作台',
      liveHostEn: 'LIVE HOST',
      showLiveHost: true
    }
  }
  if (workspaceRole === WORKSPACE_INVESTOR) {
    return {
      managerTitle: '投资观测台',
      managerEn: 'OBSERVATORY',
      showManager: true,
      staffTitle: '',
      staffEn: '',
      showStaff: false
    }
  }
  if (workspaceRole === WORKSPACE_SHAREHOLDER) {
    return {
      managerTitle: '股东观测台',
      managerEn: 'SHAREHOLDER OBSERVATORY',
      showManager: true,
      staffTitle: '',
      staffEn: '',
      showStaff: false
    }
  }
  return {
    managerTitle: '',
    managerEn: '',
    showManager: false,
    staffTitle: '',
    staffEn: '',
    showStaff: false,
    liveHostTitle: '',
    liveHostEn: '',
    showLiveHost: false
  }
}

/** 库内 role / roles[] → workspaceRole */
const STORED_ROLE_TO_WORKSPACE = {
  super_admin: WORKSPACE_SUPER_ADMIN,
  manager: WORKSPACE_STORE_MANAGER,
  staff: WORKSPACE_STORE_STAFF,
  specimen_artisan: WORKSPACE_SPECIMEN_ARTISAN,
  live_host: WORKSPACE_LIVE_HOST,
  investor: WORKSPACE_INVESTOR,
  shareholder: WORKSPACE_SHAREHOLDER
}

const WORKSPACE_ENTRY_ORDER = [
  WORKSPACE_SUPER_ADMIN,
  WORKSPACE_STORE_MANAGER,
  WORKSPACE_INVESTOR,
  WORKSPACE_SHAREHOLDER,
  WORKSPACE_SPECIMEN_ARTISAN,
  WORKSPACE_LIVE_HOST,
  WORKSPACE_STORE_STAFF
]

const WORKSPACE_ENTRY_META = {
  [WORKSPACE_SUPER_ADMIN]: {
    id: 'super_admin',
    kind: 'manager',
    title: '超管工作台',
    en: 'SUPER'
  },
  [WORKSPACE_STORE_MANAGER]: {
    id: 'store_manager',
    kind: 'manager',
    title: '店长工作台',
    en: 'MANAGER'
  },
  [WORKSPACE_STORE_STAFF]: {
    id: 'store_staff',
    kind: 'staff',
    title: '店员工作台',
    en: 'STAFF'
  },
  [WORKSPACE_SPECIMEN_ARTISAN]: {
    id: 'specimen_artisan',
    kind: 'artisan',
    title: '标本师工作台',
    en: 'ARTISAN'
  },
  [WORKSPACE_LIVE_HOST]: {
    id: 'live_host',
    kind: 'live_host',
    title: '主播工作台',
    en: 'LIVE HOST'
  },
  [WORKSPACE_INVESTOR]: {
    id: 'investor',
    kind: 'investor',
    title: '投资观测台',
    en: 'OBSERVATORY'
  },
  [WORKSPACE_SHAREHOLDER]: {
    id: 'shareholder',
    kind: 'shareholder',
    title: '股东观测台',
    en: 'SHAREHOLDER OBSERVATORY'
  }
}

function storedRoleToWorkspace(stored) {
  const key = String(stored || '').trim()
  if (key === 'superAdmin') return WORKSPACE_SUPER_ADMIN
  return STORED_ROLE_TO_WORKSPACE[key] || ''
}

/**
 * 从 session / whoami 归一化工作台角色列表（支持 roles[] 多选）
 */
function collectWorkspaceRoles(rolePayload) {
  const seen = {}
  const list = []
  const add = (wr) => {
    if (!wr || seen[wr]) return
    seen[wr] = true
    list.push(wr)
  }
  if (rolePayload && Array.isArray(rolePayload.roles)) {
    rolePayload.roles.forEach((r) => add(storedRoleToWorkspace(r)))
  }
  add(resolveWorkspaceRole(rolePayload || {}))
  if (rolePayload && (rolePayload.isSuperAdmin || rolePayload.superAdmin)) {
    add(WORKSPACE_SUPER_ADMIN)
  }
  list.sort(
    (a, b) => WORKSPACE_ENTRY_ORDER.indexOf(a) - WORKSPACE_ENTRY_ORDER.indexOf(b)
  )
  return list
}

/**
 * 「我的」页工作台入口列表（多角色时多项；与 entryLabels 文案一致）
 */
function listWorkspaceEntries(rolePayload, options = {}) {
  let roles = collectWorkspaceRoles(rolePayload)
  if (!roles.length && options.isSuperAdminOpenid) {
    roles = [WORKSPACE_SUPER_ADMIN]
  }
  return roles
    .map((wr) => {
      const meta = WORKSPACE_ENTRY_META[wr]
      if (!meta) return null
      return { ...meta, workspaceRole: wr }
    })
    .filter(Boolean)
}

/**
 * 从 whoami / getUserSession 归一化 workspaceRole（与云端强一致）
 * 优先级：显式 workspaceRole > isSuperAdmin/superAdmin > 库内 role/staffRole
 * 本地硬编码超管仅作入口兜底，不覆盖云端已返回的 workspaceRole
 */
function resolveWorkspaceRole(rolePayload) {
  if (!rolePayload) return ''
  const explicit = String(rolePayload.workspaceRole || '').trim()
  if (
    explicit === WORKSPACE_SUPER_ADMIN ||
    explicit === WORKSPACE_STORE_MANAGER ||
    explicit === WORKSPACE_STORE_STAFF ||
    explicit === WORKSPACE_SPECIMEN_ARTISAN ||
    explicit === WORKSPACE_LIVE_HOST ||
    explicit === WORKSPACE_INVESTOR ||
    explicit === WORKSPACE_SHAREHOLDER
  ) {
    return explicit
  }
  if (Array.isArray(rolePayload.roles) && rolePayload.roles.length) {
    const roles = rolePayload.roles
    if (roles.indexOf('super_admin') !== -1) return WORKSPACE_SUPER_ADMIN
    if (roles.indexOf('manager') !== -1) return WORKSPACE_STORE_MANAGER
    if (roles.indexOf('investor') !== -1) return WORKSPACE_INVESTOR
    if (roles.indexOf('shareholder') !== -1) return WORKSPACE_SHAREHOLDER
    if (roles.indexOf('specimen_artisan') !== -1) return WORKSPACE_SPECIMEN_ARTISAN
    if (roles.indexOf('live_host') !== -1) return WORKSPACE_LIVE_HOST
    if (roles.indexOf('staff') !== -1) return WORKSPACE_STORE_STAFF
  }
  if (rolePayload.superAdmin || rolePayload.isSuperAdmin) return WORKSPACE_SUPER_ADMIN
  if (rolePayload.isManager || rolePayload.role === 'manager' || rolePayload.staffRole === 'manager') {
    return WORKSPACE_STORE_MANAGER
  }
  if (rolePayload.isInvestor || rolePayload.role === 'investor' || rolePayload.staffRole === 'investor') {
    return WORKSPACE_INVESTOR
  }
  if (rolePayload.isShareholder || rolePayload.role === 'shareholder' || rolePayload.staffRole === 'shareholder') {
    return WORKSPACE_SHAREHOLDER
  }
  if (rolePayload.isStaff || rolePayload.role === 'staff' || rolePayload.staffRole === 'staff') {
    return WORKSPACE_STORE_STAFF
  }
  if (rolePayload.role === WORKSPACE_SPECIMEN_ARTISAN || rolePayload.staffRole === WORKSPACE_SPECIMEN_ARTISAN) {
    return WORKSPACE_SPECIMEN_ARTISAN
  }
  if (rolePayload.role === WORKSPACE_LIVE_HOST || rolePayload.staffRole === WORKSPACE_LIVE_HOST) {
    return WORKSPACE_LIVE_HOST
  }
  return ''
}

module.exports = {
  WORKSPACE_SUPER_ADMIN,
  WORKSPACE_STORE_MANAGER,
  WORKSPACE_STORE_STAFF,
  WORKSPACE_SPECIMEN_ARTISAN,
  WORKSPACE_LIVE_HOST,
  WORKSPACE_INVESTOR,
  WORKSPACE_SHAREHOLDER,
  SUPER_ADMIN_OPENIDS,
  MENU_KEYS,
  TAB_MENU_KEY,
  HUB_MENU_SECTIONS,
  WORKBENCH_ORDER,
  isSuperAdminOpenid,
  menusForWorkspace,
  canSeeMenu,
  canAccessManagerTab,
  entryLabels,
  workbenchEntries,
  normalizeRolesList,
  resolveWorkspaceRole,
  listWorkspaceEntries,
  collectWorkspaceRoles
}
