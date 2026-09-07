/**
 * 模块注册的单一事实来源（含内容工厂 id:51）
 * 用于：命令面板搜索 / 面包屑 / 收藏夹 / 顶级快捷键 / 文档
 *
 * 字段约定：
 * - id        : currentTab 索引（string）
 * - name      : 显示名
 * - group     : 一级分类（六大类之一）
 * - subgroup  : 二级分类
 * - icon      : Element Plus 图标名
 * - keywords  : 用于搜索的别名/英文/拼音首字母
 */

export const GROUPS = {
  OVERVIEW: { key: 'OVERVIEW', name: '总览决策', icon: '🎯', submenuKey: null },
  BUSINESS: { key: 'BUSINESS', name: '业务运营', icon: '🏪', submenuKey: 'grp-business' },
  CUSTOMER: { key: 'CUSTOMER', name: '客户经营', icon: '👥', submenuKey: 'grp-customer' },
  MINIAPP:  { key: 'MINIAPP',  name: '小程序配置', icon: '📱', submenuKey: 'grp-miniapp' },
  GOVERNANCE: { key: 'GOVERNANCE', name: '组织治理', icon: '🏛️', submenuKey: 'grp-governance' },
  INTELLIGENCE: { key: 'INTELLIGENCE', name: '战略与知识', icon: '🧠', submenuKey: null }
}

export const MODULES = [
  // 总览决策
  { id: '0',  name: '经营驾驶舱', group: 'OVERVIEW', subgroup: null, icon: 'Odometer', keywords: 'dashboard cockpit jyjsc ovw 首页' },
  { id: '26', name: '实时监控大屏 · 告警', group: 'OVERVIEW', subgroup: null, icon: 'Monitor', keywords: 'monitor realtime sslg dashboard 告警刷新' },
  { id: '49', name: '经营数据大屏 · 看板', group: 'OVERVIEW', subgroup: null, icon: 'DataBoard', keywords: 'bigscreen jydp dataviz cockpit screen 大屏 看板' },
  { id: '25', name: '运营决策中心', group: 'OVERVIEW', subgroup: null, icon: 'Trophy', keywords: 'decision center yyjzzx ops' },

  // 业务运营 — 货
  { id: '1',  name: '藏品档案库', group: 'BUSINESS', subgroup: '货', icon: 'Box', keywords: 'product collection archive cpdak sku 商品' },
  { id: '43', name: '分类管理', group: 'BUSINESS', subgroup: '货', icon: 'Menu', keywords: 'category flgl tag' },
  { id: '3',  name: '全渠道订单', group: 'BUSINESS', subgroup: '货', icon: 'List', keywords: 'order qqdd 订单' },
  { id: '52', name: '订货履约', group: 'BUSINESS', subgroup: '货', icon: 'ShoppingCart', keywords: 'purchase order fulfillment dhly 订货 采购 意向 出货 price-list 飞书 bitable 库存' },
  { id: '57', name: '报价单配置', group: 'BUSINESS', subgroup: '货', icon: 'Ticket', keywords: 'price list quote bjd 报价单 price_list_items 供货价' },
  { id: '42', name: '退款审核', group: 'BUSINESS', subgroup: '货', icon: 'Refresh', keywords: 'refund tksh 退款' },
  { id: '60', name: '订单绑定审核', group: 'BUSINESS', subgroup: '货', icon: 'Connection', keywords: 'platform order bind bindPlatformOrder ddbd 订单绑定 积分' },
  { id: '61', name: '运费与包邮规则', group: 'BUSINESS', subgroup: '货', icon: 'Van', keywords: 'shipping rules yfgz 运费 包邮 shipping_rules makeOrder' },
  // 业务运营 — 场
  { id: '37', name: '预约与核销', group: 'BUSINESS', subgroup: '场', icon: 'Stamp', keywords: 'booking checkin yyhx 核销 预约' },
  { id: '5',  name: '活动与排期', group: 'BUSINESS', subgroup: '场', icon: 'Calendar', keywords: 'activity event hdpc 活动' },
  { id: '6',  name: '权益与营销', group: 'BUSINESS', subgroup: '场', icon: 'Ticket', keywords: 'marketing benefit qyyx coupon 营销' },
  { id: '30', name: '店铺管理', group: 'BUSINESS', subgroup: '场', icon: 'Shop', keywords: 'store dpgl shop' },
  { id: '55', name: 'C端门店展区', group: 'BUSINESS', subgroup: '场', icon: 'Shop', keywords: 'store front zones cdmxq 这有店 store_zones' },
  { id: '34', name: '门店设计中心', group: 'BUSINESS', subgroup: '场', icon: 'Brush', keywords: 'store design mdsjzx 装修' },
  { id: '35', name: '加盟商管理', group: 'BUSINESS', subgroup: '场', icon: 'Promotion', keywords: 'franchise jmsgl 加盟' },
  { id: '48', name: '物业合作测算', group: 'BUSINESS', subgroup: '场', icon: 'House', keywords: 'property eval rent revenue wyhz 物业 测算 房租 分润' },
  // 业务运营 — 定制工坊
  { id: '38', name: '标本定制工单', group: 'BUSINESS', subgroup: '定制工坊', icon: 'Brush', keywords: 'custom workshop bbdzgd 定制' },
  { id: '39', name: '伴宠记忆订单', group: 'BUSINESS', subgroup: '定制工坊', icon: 'Avatar', keywords: 'pet memorial bcjy 宠物' },

  // 客户经营 — 会员资产
  { id: '4',  name: '会员 CRM', group: 'CUSTOMER', subgroup: '会员资产', icon: 'UserFilled', keywords: 'crm member hycrm 会员' },
  { id: '45', name: '用户画像', group: 'CUSTOMER', subgroup: '会员资产', icon: 'MagicStick', keywords: 'profile rfm yhhx 画像' },
  { id: '46', name: '人群包', group: 'CUSTOMER', subgroup: '会员资产', icon: 'Promotion', keywords: 'audience rqb cohort' },
  { id: '47', name: '人群对比', group: 'CUSTOMER', subgroup: '会员资产', icon: 'DataBoard', keywords: 'cohort compare rqdb' },
  // 客户经营 — 行为与互动
  { id: '44', name: 'C 端行为看板', group: 'CUSTOMER', subgroup: '行为与互动', icon: 'DataAnalysis', keywords: 'behavior analytics cdxwkb event' },
  { id: '40', name: '山海有信工单', group: 'CUSTOMER', subgroup: '行为与互动', icon: 'Message', keywords: 'support ticket shyxgd 客服 工单' },
  { id: '41', name: '评论审核', group: 'CUSTOMER', subgroup: '行为与互动', icon: 'ChatDotRound', keywords: 'comment plsh moderation 评论' },
  { id: '59', name: '开票申请台', group: 'CUSTOMER', subgroup: '行为与互动', icon: 'Document', keywords: 'invoice manageInvoiceRequests kpsq 开票 发票' },
  // 客户经营 — 内容营销
  { id: '51', name: '内容工厂', group: 'CUSTOMER', subgroup: '内容营销', icon: 'VideoCamera', keywords: 'content factory nrgc 内容 营销 选题 话术' },

  // 小程序配置 — 内容运营
  { id: '8',  name: '首页轮播', group: 'MINIAPP', subgroup: '内容运营', icon: 'Picture', keywords: 'banner sylb carousel' },
  { id: '13', name: '首页配置', group: 'MINIAPP', subgroup: '内容运营', icon: 'Setting', keywords: 'home config sypz layout' },
  { id: '9',  name: '内容管理', group: 'MINIAPP', subgroup: '内容运营', icon: 'Collection', keywords: 'content cms nrgl article' },
  { id: '54', name: '养护指南', group: 'MINIAPP', subgroup: '内容运营', icon: 'Notebook', keywords: 'care guides yhzh specimen care' },
  { id: '56', name: '客服入口配置', group: 'MINIAPP', subgroup: '内容运营', icon: 'Phone', keywords: 'support config kf rk 联系专员 FAQ getSupportConfig' },
  // 小程序配置 — 会员/营销规则
  { id: '14', name: '会员等级体系', group: 'MINIAPP', subgroup: '会员/营销规则', icon: 'UserFilled', keywords: 'member level hydjtx vip' },
  { id: '15', name: '门店积分规则', group: 'MINIAPP', subgroup: '会员/营销规则', icon: 'Ticket', keywords: 'point rule jfgz store_point_rules' },
  { id: '22', name: '成就系统配置', group: 'MINIAPP', subgroup: '会员/营销规则', icon: 'Trophy', keywords: 'achievement cjxt badge' },
  { id: '20', name: '活动营销规则', group: 'MINIAPP', subgroup: '会员/营销规则', icon: 'Ticket', keywords: 'marketing rule hdyx coupon' },
  // 小程序配置 — 系统/算法/通知
  { id: '16', name: '预约规则配置', group: 'MINIAPP', subgroup: '系统/算法/通知', icon: 'Calendar', keywords: 'booking rule yygz slot' },
  { id: '19', name: '推荐算法配置', group: 'MINIAPP', subgroup: '系统/算法/通知', icon: 'MagicStick', keywords: 'recommend algorithm tjsf rec' },
  { id: '18', name: '搜索关键词管理', group: 'MINIAPP', subgroup: '系统/算法/通知', icon: 'Search', keywords: 'search keyword sshjc' },
  { id: '24', name: '通知消息配置', group: 'MINIAPP', subgroup: '系统/算法/通知', icon: 'ChatDotRound', keywords: 'notification message tzxx push' },
  { id: '23', name: '用户行为追踪', group: 'MINIAPP', subgroup: '系统/算法/通知', icon: 'DataAnalysis', keywords: 'behavior track yhxw event' },
  { id: '21', name: '数据报表增强', group: 'MINIAPP', subgroup: '系统/算法/通知', icon: 'DataAnalysis', keywords: 'report sjbb' },
  { id: '17', name: '权限管理系统', group: 'MINIAPP', subgroup: '系统/算法/通知', icon: 'Lock', keywords: 'permission rbac qxgl' },

  // 组织治理 — 人才
  { id: '7',  name: '标本师管理', group: 'GOVERNANCE', subgroup: '人才组织', icon: 'Brush', keywords: 'framer staff bbsgl artisan' },
  { id: '32', name: '员工花名册', group: 'GOVERNANCE', subgroup: '人才组织', icon: 'User', keywords: 'employee roster yghmc hr' },
  { id: '31', name: '员工薪酬管理', group: 'GOVERNANCE', subgroup: '人才组织', icon: 'Wallet', keywords: 'payroll salary ygxc' },
  // 组织治理 — 财务资本
  { id: '2',  name: '财务核算系统', group: 'GOVERNANCE', subgroup: '财务资本', icon: 'Money', keywords: 'finance accounting cwhs ledger' },
  { id: '36', name: '资本架构沙盘', group: 'GOVERNANCE', subgroup: '财务资本', icon: 'DataBoard', keywords: 'capital sandbox zbjg' },
  { id: '50', name: '工作室启动成本', group: 'GOVERNANCE', subgroup: '财务资本', icon: 'TrendCharts', keywords: 'startup cost studio qdcb 启动成本 北极星 现金流 爬坡 加盟 直营 阶段2' },
  { id: '27', name: '合伙人命理中心', group: 'GOVERNANCE', subgroup: '财务资本', icon: 'DocumentCopy', keywords: 'partner destiny hhrm' },
  // 组织治理 — 治理与合规
  { id: '33', name: '公司治理', group: 'GOVERNANCE', subgroup: '治理与合规', icon: 'OfficeBuilding', keywords: 'governance gszl board' },
  { id: '28', name: '合规专栏', group: 'GOVERNANCE', subgroup: '治理与合规', icon: 'Lock', keywords: 'compliance hgzl regulation' },
  // 组织治理 — 品牌视觉
  { id: '53', name: '品牌 VIS', group: 'GOVERNANCE', subgroup: '品牌视觉', icon: 'Brush', keywords: 'brand vis logo ppvis 品牌 视觉识别 规范 色彩 字体 包装 VI' },

  // 战略与知识
  { id: '12', name: 'AI 智能中心', group: 'INTELLIGENCE', subgroup: null, icon: 'MagicStick', keywords: 'ai aiznzx assistant llm' },
  { id: '10', name: '战略调研看板', group: 'INTELLIGENCE', subgroup: null, icon: 'DataAnalysis', keywords: 'strategy research zldykb' },
  { id: '58', name: '爆品概念生成器', group: 'INTELLIGENCE', subgroup: null, icon: 'MagicStick', keywords: 'product concept generator bpgnq sku 爆品 概念 金字塔' },
  { id: '29', name: '经营手册', group: 'INTELLIGENCE', subgroup: null, icon: 'Notebook', keywords: 'manual ops jysc sop' }
]

/** id -> module 快查 */
export const MODULES_BY_ID = MODULES.reduce((m, x) => (m[x.id] = x, m), {})

/** 按 group key 聚合 */
export function modulesByGroup() {
  const map = {}
  Object.keys(GROUPS).forEach(k => { map[k] = [] })
  MODULES.forEach(m => map[m.group]?.push(m))
  return map
}

/** 模糊搜索（不依赖 fuse.js，简单字符匹配 + 关键词加分） */
export function searchModules(query, limit = 15) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return MODULES.slice(0, limit)
  const results = []
  MODULES.forEach(m => {
    const hay = `${m.name} ${m.keywords || ''} ${GROUPS[m.group]?.name || ''} ${m.subgroup || ''}`.toLowerCase()
    let score = 0
    // 名称完全匹配 +100
    if (m.name.toLowerCase() === q) score += 100
    // 名称包含 +60
    if (m.name.toLowerCase().includes(q)) score += 60
    // 关键词命中 +30
    if (hay.includes(q)) score += 30
    // 单字符命中 +10
    if (q.length === 1 && hay.includes(q)) score += 10
    // 拼音首字母连续匹配 +40
    const pinyin = (m.keywords || '').split(/\s+/).find(k => k === q)
    if (pinyin) score += 40
    if (score > 0) results.push({ ...m, _score: score })
  })
  return results.sort((a, b) => b._score - a._score).slice(0, limit)
}

/** id -> 父级 sub-menu key（用于自动展开） */
export function getSubmenuKey(moduleId) {
  const mod = MODULES_BY_ID[moduleId]
  if (!mod) return null
  return GROUPS[mod.group]?.submenuKey || null
}

// ============ ACTIONS — 命令面板里的动词 ============
// 与 MODULES（名词）相对：这些是可执行命令
// 每个 action 通过 window.dispatchEvent 触发，App.vue 内统一监听派发
export const ACTIONS = [
  {
    id: 'act-quick-order', label: '记一笔账', hint: '跳到财务，立即新增收入/支出',
    icon: '💰', shortcut: '', keywords: 'finance ledger jyb 记账',
    event: { type: 'switch-tab', detail: '2' }
  },
  {
    id: 'act-new-product', label: '录入新藏品', hint: '跳到藏品库，立即新增 SKU',
    icon: '📦', shortcut: '', keywords: 'product new sku xcb 录入',
    event: { type: 'switch-tab', detail: '1' }
  },
  {
    id: 'act-new-coupon', label: '发新优惠券', hint: '跳到权益与营销',
    icon: '🎟', shortcut: '', keywords: 'coupon new fyhq 发券',
    event: { type: 'switch-tab', detail: '6' }
  },
  {
    id: 'act-search-member', label: '搜会员', hint: '跳到 CRM 会员搜索',
    icon: '🔎', shortcut: '', keywords: 'member search shy 搜会员',
    event: { type: 'switch-tab', detail: '4' }
  },
  {
    id: 'act-find-ticket', label: '查工单', hint: '跳到山海有信工单台',
    icon: '🎫', shortcut: '', keywords: 'support ticket cgd 查工单',
    event: { type: 'switch-tab', detail: '40' }
  },
  {
    id: 'act-new-audience', label: '创建人群包', hint: '跳到人群包管理',
    icon: '👥', shortcut: '', keywords: 'audience cohort cjrq 人群',
    event: { type: 'switch-tab', detail: '46' }
  },
  {
    id: 'act-refresh-dashboard', label: '刷新驾驶舱', hint: '回到经营驾驶舱并刷新',
    icon: '🔄', shortcut: '', keywords: 'refresh dashboard sxjsc 刷新',
    // 两步：先切到驾驶舱，再强制重建当前组件
    event: [{ type: 'switch-tab', detail: '0' }, { type: 'reload-current' }]
  },
  {
    id: 'act-close-others', label: '关闭其它标签', hint: '只保留当前 tab 和固定 tab',
    icon: '✂️', shortcut: '', keywords: 'close other tabs gbqt 关闭其它',
    event: { type: 'tabs-close-others' }
  },
  {
    id: 'act-close-all', label: '关闭所有标签', hint: '清空多标签栏（保留固定）',
    icon: '🗑', shortcut: '', keywords: 'close all tabs gbsy 关闭所有',
    event: { type: 'tabs-close-all' }
  },
  {
    id: 'act-toggle-sidebar', label: '折叠/展开侧栏', hint: '切换侧栏窄屏/宽屏',
    icon: '↔️', shortcut: '⌘B', keywords: 'sidebar collapse toggle zdcl 侧栏',
    event: { type: 'toggle-sidebar' }
  },
  {
    id: 'act-export-data', label: '导出当前数据 CSV', hint: '若当前模块支持',
    icon: '⬇️', shortcut: '', keywords: 'export csv dcsj 导出',
    event: { type: 'export-current' }
  },
  {
    id: 'act-logout', label: '退出系统', hint: '清除登录态并返回登录页',
    icon: '🚪', shortcut: '', keywords: 'logout signout tcxt 退出',
    event: { type: 'logout' }
  }
]

/** 动作搜索（与 module 同一搜索框） */
export function searchActions(query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  return ACTIONS.filter(a => {
    const hay = `${a.label} ${a.hint || ''} ${a.keywords || ''}`.toLowerCase()
    return hay.includes(q)
  })
}

/** 统一派发：CommandPalette 调用，App.vue 监听各 event.type */
export function runAction(action) {
  if (!action || !action.event) return
  const events = Array.isArray(action.event) ? action.event : [action.event]
  events.forEach(e => window.dispatchEvent(new CustomEvent(e.type, { detail: e.detail })))
}
