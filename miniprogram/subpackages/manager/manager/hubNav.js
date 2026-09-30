/**
 * 超管 / 店长工作台 Hub 入口导航（2026-09-30 全局改版）
 *
 * - HUB_SECTIONS：七个分区（订单履约 → 系统监测，按日常频率排序）；keys = 该分区内全部磁贴 wx:if 用到的菜单键之并，
 *   分区在任一键可见时显示（index.wxml 的 `hubSec.<id>`）。
 * - HUB_GROUPS：合并磁贴点开后的二级面板。磁贴在任一子项有权限时显示；只有一个子项可见时直接进入，
 *   多个时底部面板列出可见子项。子项仍调用原有的 go* / switchTab 入口（旧页面路径、门禁不变）。
 * - 与 index.wxml 的一致性（每个分区 keys、合并磁贴条件 = 子项 keys 之并、原功能入口不丢）由
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
  const dataset = item.dataset || (item.idx ? { idx: String(item.idx), title: item.tabTitle || item.label } : {})
  const evt = { currentTarget: { dataset } }
  page[item.tap](evt)
  return true
}

module.exports = {
  HUB_SECTIONS,
  HUB_GROUPS,
  HUB_TODOS,
  buildTodos,
  findTodo,
  sectionFlags,
  visibleItems,
  buildSheet,
  findItem,
  invokeItem
}
