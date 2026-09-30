/**
 * 超管 / 店长工作台 Hub 入口导航（2026-09-30 全局改版）
 *
 * - HUB_SECTIONS：七个分区（订单履约 → 系统监测，按日常频率排序）；keys = 该分区内全部磁贴 wx:if 用到的菜单键之并，
 *   分区在任一键可见时显示（index.wxml 的 `hubSec.<id>`）。
 * - HUB_GROUPS：合并磁贴点开后的二级面板。磁贴在任一子项有权限时显示；只有一个子项可见时直接进入，
 *   多个时底部面板列出可见子项。子项仍调用原有的 go* / switchTab 入口（旧页面路径、门禁不变）。
 * - HUB_ENTRIES：全部磁贴的统一清单（稳定 id）；「我的常用」按它渲染、存 id（本地 storage，按角色分键）。
 * - 与 index.wxml 的一致性（清单 ↔ 磁贴逐枚、每个分区 keys、合并磁贴条件 = 子项 keys 之并、原功能入口不丢）由
 *   `npm run check:hub-entries` 校验。
 */

const HUB_SECTIONS = [
  { id: 'orders', title: '订单履约', keys: ['orders', 'workOrders', 'giftOps', 'giftManage', 'invoice', 'approvals', 'depositOps'] },
  { id: 'biz', title: '经营数据', keys: ['ledger', 'analytics', 'stores'] },
  { id: 'goods', title: '商品内容', keys: ['products', 'content', 'contentFlags', 'decor', 'activities', 'live'] },
  { id: 'members', title: '会员触达', keys: ['memberCrm', 'vip', 'support', 'memberLevelAdjust', 'honoraryCurators', 'points', 'welcomeGift', 'walletConfig'] },
  {
    id: 'studio',
    title: '工作室',
    keys: [
      'studioDashboard', 'supplierWorkbench', 'purchaseOps', 'shipmentOps', 'inventoryOps', 'rawInventoryOps',
      'studioBills', 'propertyCost', 'feishuSync', 'framers', 'framerRecruit', 'artisanCommission'
    ]
  },
  { id: 'org', title: '门店组织', keys: ['verify', 'staffConsole', 'staffDirectory', 'staffPermissions', 'shareholderConfig', 'payslipAdmin', 'myPayslip'] },
  { id: 'system', title: '系统监测', keys: ['shipping', 'bookingRules', 'supportConfig', 'orders', 'aiIdentifyMonitor'] }
]

const HUB_GROUPS = {
  gift: {
    title: '礼赠',
    items: [
      { id: 'giftOps', label: '礼赠履约', desc: '待填址 · 待发货 · 自提核销', keys: ['giftOps'], tap: 'goGiftOps', badge: 'giftTodoCount' },
      { id: 'giftManage', label: '礼赠管理', desc: '待办概况 · 运营规则 · 进度提醒', keys: ['giftManage'], tap: 'goGiftManage' }
    ]
  },
  perks: {
    title: '礼包与钱包',
    items: [
      { id: 'welcomeGift', label: '新会员礼包', desc: '注册即送 · 积分与礼券', keys: ['welcomeGift'], tap: 'goWelcomeGift' },
      { id: 'birthdayGift', label: '生日礼包', desc: '生日当天 · 积分与礼券', keys: ['welcomeGift'], tap: 'goBirthdayGift' },
      { id: 'walletConfig', label: '钱包配置', desc: '充值档位 · 文案', keys: ['walletConfig'], tap: 'goWalletConfig' }
    ]
  },
  artisan: {
    title: '标本师',
    items: [
      { id: 'framers', label: '标本师管理', desc: '名册 · 作品 · 状态', keys: ['framers'], tap: 'switchTab', idx: 5, tabTitle: '标本师管理' },
      { id: 'framerRecruit', label: '合作申请', desc: '入驻申请审核', keys: ['framerRecruit'], tap: 'switchTab', idx: 14, tabTitle: '标本师合作', badge: 'framerRecruitApps' },
      { id: 'artisanCommission', label: '标本师提成', desc: '比例 · 类目 · 账目', keys: ['artisanCommission'], tap: 'goArtisanCommission' }
    ]
  },
  org: {
    title: '组织',
    items: [
      { id: 'staffDirectory', label: '员工', desc: '店员 · 店长 · 标本师 · 投资人 · 股东 · 超管', keys: ['staffDirectory'], tap: 'goStaffDirectory' },
      { id: 'staffPermissions', label: '权限配置', desc: '手机号 · 角色分配', keys: ['staffPermissions'], tap: 'goStoreStaffPermissions' },
      { id: 'shareholderConfig', label: '股东配置', desc: '门店 · 占股 · 回本前后分成', keys: ['shareholderConfig'], tap: 'goShareholderConfig' }
    ]
  },
  payslip: {
    title: '工资',
    items: [
      { id: 'myPayslip', label: '工资条明细', desc: '应发实发 · 经营额度销售分成', keys: ['myPayslip'], tap: 'goMyPayslipGuarded' },
      { id: 'payslipAdmin', label: '工资维护', desc: '录入 · 修正 · 删除', keys: ['payslipAdmin'], tap: 'goPayslipAdminGuarded' }
    ]
  },
  rules: {
    title: '规则配置',
    items: [
      { id: 'shipping', label: '运费规则', desc: '按装裱方式 · 包邮门槛', keys: ['shipping'], tap: 'switchTab', idx: 15, tabTitle: '运费规则' },
      { id: 'bookingRules', label: '预约规则', desc: '时段 · 闭店日', keys: ['bookingRules'], tap: 'goBookingRules' },
      { id: 'supportConfig', label: '客服入口', desc: '电话 · 常见问题', keys: ['supportConfig'], tap: 'goSupportConfig' }
    ]
  }
}

const ICON = '/assets/icons/'
const MGR_ICON = '/subpackages/manager/assets/icons/'

/**
 * 工作台入口统一清单（稳定 id，不用显示名）。分区磁贴（index.wxml 静态标记）与「我的常用」都以它为准；
 * 两者逐枚一致（入口 / 名称 / 图标 / 权限 / 分区）由 check:hub-entries 校验。
 */
const HUB_ENTRIES = [
  { id: 'orders', label: '订单', icon: ICON + 'box.png', sec: 'orders', keys: ['orders'], tap: 'onOrdersMenuTap', idx: 2, tabTitle: '订单管理', badge: 'orders' },
  { id: 'workOrders', label: '工单', icon: ICON + 'list.png', sec: 'orders', keys: ['workOrders'], tap: 'switchTab', idx: 10, tabTitle: '工单', badge: 'customOrders' },
  { id: 'gift', label: '礼赠', icon: ICON + 'gift.png', sec: 'orders', keys: ['giftOps', 'giftManage'], tap: 'openHubGroup', group: 'gift', badge: 'giftTodoCount' },
  { id: 'invoice', label: '发票', icon: ICON + 'refund.png', sec: 'orders', keys: ['invoice'], tap: 'goInvoiceRequests', badge: 'invoicePendingCount' },
  { id: 'approvals', label: '审批', icon: ICON + 'done.png', sec: 'orders', keys: ['approvals'], tap: 'goApprovals', badge: 'approvalPendingCount' },
  { id: 'deposit', label: '孤品定金', icon: ICON + 'discount.png', sec: 'orders', keys: ['depositOps'], tap: 'goDepositOps' },
  { id: 'ledger', label: '账本', icon: ICON + 'coin_gold.png', sec: 'biz', keys: ['ledger'], tap: 'switchTab', idx: 8, tabTitle: '营收账本' },
  { id: 'analytics', label: '报表', icon: ICON + 'trend.png', sec: 'biz', keys: ['analytics'], tap: 'switchTab', idx: 13, tabTitle: '数据报表' },
  { id: 'stores', label: '门店', icon: ICON + 'store.png', sec: 'biz', keys: ['stores'], tap: 'switchTab', idx: 12, tabTitle: '门店管理' },
  { id: 'products', label: '藏品', icon: ICON + 'tab-collection.png', sec: 'goods', keys: ['products'], tap: 'switchTab', idx: 1, tabTitle: '藏品库' },
  { id: 'content', label: '内容', icon: ICON + 'article-tab.png', sec: 'goods', keys: ['content'], tap: 'switchTab', idx: 9, tabTitle: '内容管理' },
  { id: 'contentFlags', label: '开关', icon: ICON + 'eye.png', sec: 'goods', keys: ['contentFlags'], tap: 'switchTab', idx: 16, tabTitle: '内容开关' },
  { id: 'decor', label: '装修', icon: MGR_ICON + 'edit.png', sec: 'goods', keys: ['decor'], tap: 'switchTab', idx: 4, tabTitle: '店铺装修' },
  { id: 'activities', label: '活动', icon: ICON + 'booking.png', sec: 'goods', keys: ['activities'], tap: 'switchTab', idx: 7, tabTitle: '活动课程' },
  { id: 'live', label: '主播', icon: ICON + 'video-tab.png', sec: 'goods', keys: ['live'], tap: 'goLiveStudio' },
  { id: 'memberCrm', label: '会员 CRM', icon: ICON + 'user_gold.png', sec: 'members', keys: ['memberCrm'], tap: 'goMemberCrm' },
  { id: 'vip', label: '权益', icon: ICON + 'coupon.png', sec: 'members', keys: ['vip'], tap: 'switchTab', idx: 6, tabTitle: '权益会员' },
  { id: 'support', label: '有信', icon: ICON + 'message.png', sec: 'members', keys: ['support'], tap: 'switchTab', idx: 11, tabTitle: '山海有信', badge: 'supportTickets' },
  { id: 'memberLevel', label: '会员调级', icon: ICON + 'medal_gold.png', sec: 'members', keys: ['memberLevelAdjust'], tap: 'goMemberLevelAdjust' },
  { id: 'curators', label: '荣誉馆长', icon: ICON + 'atlas.png', sec: 'members', keys: ['honoraryCurators'], tap: 'goHonoraryCurators' },
  { id: 'points', label: '积分', icon: ICON + 'star.png', sec: 'members', keys: ['points'], tap: 'goStorePoints' },
  { id: 'perks', label: '礼包钱包', icon: ICON + 'wallet_gold.png', sec: 'members', keys: ['welcomeGift', 'walletConfig'], tap: 'openHubGroup', group: 'perks' },
  { id: 'studioDashboard', label: '仪表盘', icon: ICON + 'studio-dashboard.png', sec: 'studio', keys: ['studioDashboard'], tap: 'goStudioDashboard' },
  { id: 'supplier', label: '供应商', icon: ICON + 'group.png', sec: 'studio', keys: ['supplierWorkbench'], tap: 'goSupplierWorkbench' },
  { id: 'purchase', label: '采购', icon: ICON + 'cart.png', sec: 'studio', keys: ['purchaseOps'], tap: 'goPurchaseOps' },
  { id: 'shipment', label: '出货中心', icon: ICON + 'ship.png', sec: 'studio', keys: ['shipmentOps'], tap: 'goShipmentOps' },
  { id: 'inventory', label: '库存', icon: ICON + 'knowledge.png', sec: 'studio', keys: ['inventoryOps', 'rawInventoryOps'], tap: 'goInventoryOps' },
  { id: 'studioBills', label: '工作室账单', icon: ICON + 'pay.png', sec: 'studio', keys: ['studioBills'], tap: 'goStudioBillsGuarded' },
  { id: 'property', label: '物业', icon: MGR_ICON + 'location.png', sec: 'studio', keys: ['propertyCost'], tap: 'goPropertyCost' },
  { id: 'feishu', label: '飞书同步', icon: ICON + 'deliver.png', sec: 'studio', keys: ['feishuSync'], tap: 'goFeishuSyncGuarded' },
  { id: 'artisan', label: '标本师', icon: ICON + 'user.png', sec: 'studio', keys: ['framers', 'framerRecruit', 'artisanCommission'], tap: 'openHubGroup', group: 'artisan', badge: 'framerRecruitApps', badgeKey: 'framerRecruit' },
  { id: 'verify', label: '核销验票', icon: ICON + 'qrcode.png', sec: 'org', keys: ['verify'], tap: 'goStaffTab', tab: 'verify' },
  { id: 'staffConsole', label: '店员工作台', icon: ICON + 'checkin.png', sec: 'org', keys: ['staffConsole'], tap: 'goStaffHome' },
  { id: 'org', label: '组织', icon: ICON + 'lock.png', sec: 'org', keys: ['staffDirectory', 'staffPermissions', 'shareholderConfig'], tap: 'openHubGroup', group: 'org' },
  { id: 'payslip', label: '工资', icon: ICON + 'calendar_gold.png', sec: 'org', keys: ['payslipAdmin', 'myPayslip'], tap: 'openHubGroup', group: 'payslip' },
  { id: 'rules', label: '规则配置', icon: MGR_ICON + 'clock.png', sec: 'system', keys: ['shipping', 'bookingRules', 'supportConfig'], tap: 'openHubGroup', group: 'rules' },
  { id: 'wxNotify', label: '微信通知', icon: ICON + 'service.png', sec: 'system', keys: ['orders'], tap: 'enableStaffOrderWxNotify' },
  { id: 'aiIdentify', label: 'AI 鉴定', icon: ICON + 'camera.png', sec: 'system', keys: ['aiIdentifyMonitor'], tap: 'goIdentifyMonitorGuarded' }
]

/* ── 我的常用 ── */
const FAV_MAX = 8
const FAV_STORAGE_KEY = 'manager_hub_favs_v1'
/** 旧入口 / 被合并入口 → 现行稳定 id（已保存的常用在改版、合并后自动映射） */
const FAV_ID_ALIASES = {
  giftOps: 'gift', giftManage: 'gift',
  memberCurator: 'memberLevel', memberLevelAdjust: 'memberLevel', honoraryCurators: 'curators',
  welcomeGift: 'perks', birthdayGift: 'perks', walletConfig: 'perks',
  framers: 'artisan', framerRecruit: 'artisan', artisanCommission: 'artisan',
  staffDirectory: 'org', staffPermissions: 'org', shareholderConfig: 'org',
  payslipAdmin: 'payslip', myPayslip: 'payslip',
  shipping: 'rules', bookingRules: 'rules', supportConfig: 'rules',
  shipmentOps: 'shipment', shipmentSku: 'shipment',
  inventoryOps: 'inventory', rawInventoryOps: 'inventory',
  supplierWorkbench: 'supplier', purchaseOps: 'purchase', propertyCost: 'property',
  feishuSync: 'feishu', depositOps: 'deposit', aiIdentifyMonitor: 'aiIdentify'
}
/** 未配置时的角色默认（再按权限过滤） */
const FAV_DEFAULTS = {
  super_admin: ['orders', 'ledger', 'analytics', 'approvals', 'support', 'products', 'verify', 'memberCrm'],
  store_manager: ['orders', 'ledger', 'verify', 'approvals', 'workOrders', 'gift', 'products', 'points'],
  store_staff: ['verify', 'approvals', 'staffConsole'],
  specimen_artisan: ['products']
}

function findEntry(id) {
  return HUB_ENTRIES.find((e) => e.id === id) || null
}

function entryVisible(entry, menu) {
  const m = menu || {}
  return !!entry && entry.keys.some((k) => m[k] === true)
}

/** 映射旧 id → 去重 → 丢未知 / 无权限 → 截断到上限 */
function normalizeFavs(ids, menu) {
  const out = []
  ;(Array.isArray(ids) ? ids : []).forEach((raw) => {
    const id = FAV_ID_ALIASES[raw] || raw
    if (out.indexOf(id) !== -1) return
    if (!entryVisible(findEntry(id), menu)) return
    out.push(id)
  })
  return out.slice(0, FAV_MAX)
}

function defaultFavs(role, menu) {
  return normalizeFavs(FAV_DEFAULTS[role] || [], menu)
}

function entryBadge(entry, data) {
  if (!entry || !entry.badge) return ''
  const d = data || {}
  if (entry.badgeKey && !(d.menu && d.menu[entry.badgeKey])) return ''
  let n = badgeValue(entry.badge, d)
  if (entry.id === 'orders' && Number(d.newOrderUnreadCount) > 0) n = Number(d.newOrderUnreadCount)
  if (n <= 0) return ''
  return n > 99 ? '99+' : String(n)
}

function buildFavView(ids, data) {
  const d = data || {}
  return normalizeFavs(ids, d.menu).map((id) => {
    const e = findEntry(id)
    return { id, label: e.label, icon: e.icon, badge: entryBadge(e, d) }
  })
}

/** 编辑面板：已选（可上移 / 下移 / 移除）+ 按分区列出的可加入入口 */
function buildFavEditor(ids, menu) {
  const selected = normalizeFavs(ids, menu)
  const sel = selected.map((id, i) => {
    const e = findEntry(id)
    return { id, label: e.label, icon: e.icon, first: i === 0, last: i === selected.length - 1 }
  })
  const groups = []
  HUB_SECTIONS.forEach((s) => {
    const items = HUB_ENTRIES.filter((e) => e.sec === s.id && entryVisible(e, menu)).map((e) => ({
      id: e.id, label: e.label, icon: e.icon, added: selected.indexOf(e.id) !== -1
    }))
    if (items.length) groups.push({ id: s.id, title: s.title, items })
  })
  return { open: true, ids: selected, selected: sel, groups, full: selected.length >= FAV_MAX, count: selected.length, max: FAV_MAX }
}

function moveFav(ids, id, dir) {
  const list = (ids || []).slice()
  const i = list.indexOf(id)
  const j = i + (dir === 'up' ? -1 : 1)
  if (i < 0 || j < 0 || j >= list.length) return list
  const t = list[i]
  list[i] = list[j]
  list[j] = t
  return list
}

function toggleFav(ids, id) {
  const list = (ids || []).slice()
  const i = list.indexOf(id)
  if (i !== -1) list.splice(i, 1)
  else if (list.length < FAV_MAX) list.push(id)
  return list
}

/** 顶部待办条：只列有权限且计数 > 0 的项；点按走原入口 */
const HUB_TODOS = [
  { id: 'orders', label: '待发订单', keys: ['orders'], badge: 'orders', tap: 'onOrdersMenuTap', idx: 2, tabTitle: '订单管理' },
  { id: 'support', label: '有信待回', keys: ['support'], badge: 'supportTickets', tap: 'switchTab', idx: 11, tabTitle: '山海有信' },
  { id: 'workOrders', label: '工单', keys: ['workOrders'], badge: 'customOrders', tap: 'switchTab', idx: 10, tabTitle: '工单' },
  { id: 'approvals', label: '审批', keys: ['approvals'], badge: 'approvalPendingCount', tap: 'goApprovals' },
  { id: 'invoice', label: '发票', keys: ['invoice'], badge: 'invoicePendingCount', tap: 'goInvoiceRequests' },
  { id: 'gift', label: '礼赠', keys: ['giftOps', 'giftManage'], badge: 'giftTodoCount', tap: 'openHubGroup', dataset: { group: 'gift' } },
  { id: 'recruit', label: '合作申请', keys: ['framerRecruit'], badge: 'framerRecruitApps', tap: 'switchTab', idx: 14, tabTitle: '标本师合作' }
]

function buildTodos(data) {
  const d = data || {}
  const m = d.menu || {}
  let total = 0
  const items = []
  HUB_TODOS.forEach((t) => {
    if (!t.keys.some((k) => m[k] === true)) return
    const n = badgeValue(t.badge, d)
    if (n <= 0) return
    total += n
    items.push({ id: t.id, label: t.label, count: n > 99 ? '99+' : String(n) })
  })
  return { total, totalText: total > 999 ? '999+' : String(total), items }
}

function findTodo(id) {
  return HUB_TODOS.find((t) => t.id === id) || null
}

function sectionFlags(menu) {
  const m = menu || {}
  const out = {}
  HUB_SECTIONS.forEach((s) => {
    out[s.id] = s.keys.some((k) => m[k] === true)
  })
  return out
}

function badgeValue(src, data) {
  if (!src) return 0
  const v = (data || {})[src]
  if (Array.isArray(v)) return v.length
  return Number(v) || 0
}

function visibleItems(groupId, menu) {
  const g = HUB_GROUPS[groupId]
  if (!g) return []
  const m = menu || {}
  return g.items.filter((it) => it.keys.some((k) => m[k] === true))
}

function buildSheet(groupId, data) {
  const g = HUB_GROUPS[groupId]
  const d = data || {}
  const items = visibleItems(groupId, d.menu).map((it) => {
    const n = badgeValue(it.badge, d)
    return { id: it.id, label: it.label, desc: it.desc, badge: n, badgeText: n > 99 ? '99+' : String(n) }
  })
  return { open: true, id: groupId, title: g ? g.title : '', items }
}

function findItem(groupId, itemId) {
  const g = HUB_GROUPS[groupId]
  if (!g) return null
  return g.items.find((it) => it.id === itemId) || null
}

/** 子项 → 调原入口（switchTab 需要 dataset.idx / title） */
function invokeItem(page, item) {
  if (!page || !item || typeof page[item.tap] !== 'function') return false
  let dataset = item.dataset || {}
  if (!item.dataset) {
    if (item.group) dataset = { group: item.group }
    else if (item.tab) dataset = { tab: item.tab }
    else if (item.idx) dataset = { idx: String(item.idx), title: item.tabTitle || item.label }
  }
  const evt = { currentTarget: { dataset } }
  page[item.tap](evt)
  return true
}

module.exports = {
  HUB_SECTIONS,
  HUB_GROUPS,
  HUB_ENTRIES,
  FAV_MAX,
  FAV_STORAGE_KEY,
  FAV_ID_ALIASES,
  FAV_DEFAULTS,
  findEntry,
  normalizeFavs,
  defaultFavs,
  buildFavView,
  buildFavEditor,
  moveFav,
  toggleFav,
  HUB_TODOS,
  buildTodos,
  findTodo,
  sectionFlags,
  visibleItems,
  buildSheet,
  findItem,
  invokeItem
}
