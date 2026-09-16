/**
 * 模块注册的单一事实来源（含内容工厂 id:51）
 * 用于：命令面板搜索 / 面包屑 / 收藏夹 / 顶级快捷键 / 文档
 *
 * 字段约定：
 * - id        : currentTab 索引（string）
 * - name      : 显示名
 * - group     : 一级分类（七大类之一）
 * - subgroup  : 二级分类
 * - icon      : Element Plus 图标名
 * - keywords  : 用于搜索的别名/英文/拼音首字母
 */

import { MODULE_ALIASES } from './moduleAliases.js'

/**
 * 七个一级业务域 = 导航大屏（AdminNavHub）的域。
 *
 * 这是**域身份的单一事实来源**：域 id(`navId`) / 名称 / 图标 / 英文 overline 都在这里，
 * 侧栏、导航大屏、面包屑、`adminNavDomains.js` 一律从这里派生，不再各自重抄一份。
 *
 * 两个图标字段是**有意的区分**，不要合并：
 * - `icon`    ：分组列表里的图标（`CommandPalette` 分组标题用）
 * - `navIcon` ：导航大屏 / 侧栏一级入口的图标
 *   两者仅在 OVERVIEW 不同（Odometer vs Monitor），属既有视觉，本次整合保持原样。
 */
export const GROUPS = {
  OVERVIEW: { key: 'OVERVIEW', name: '总览决策', icon: 'Odometer', navIcon: 'Monitor', overline: 'OVERVIEW', submenuKey: null, navId: 'nav-overview' },
  BUSINESS: { key: 'BUSINESS', name: '业务运营', icon: 'Shop', navIcon: 'Shop', overline: 'OPERATIONS', submenuKey: null, navId: 'nav-business' },
  STUDIO: { key: 'STUDIO', name: '工作室', icon: 'Box', navIcon: 'Box', overline: 'STUDIO', submenuKey: null, navId: 'nav-studio' },
  CUSTOMER: { key: 'CUSTOMER', name: '客户经营', icon: 'UserFilled', navIcon: 'UserFilled', overline: 'CUSTOMERS', submenuKey: null, navId: 'nav-customer' },
  MINIAPP:  { key: 'MINIAPP',  name: '小程序配置', icon: 'Iphone', navIcon: 'Iphone', overline: 'MINIAPP', submenuKey: null, navId: 'nav-miniapp' },
  GOVERNANCE: { key: 'GOVERNANCE', name: '组织治理', icon: 'OfficeBuilding', navIcon: 'OfficeBuilding', overline: 'GOVERNANCE', submenuKey: null, navId: 'nav-governance' },
  INTELLIGENCE: { key: 'INTELLIGENCE', name: '战略与知识', icon: 'MagicStick', navIcon: 'MagicStick', overline: 'INTELLIGENCE', submenuKey: null, navId: 'nav-intelligence' }
}

/**
 * 七个导航域本身也是可打开的 Tab（主区渲染 `AdminNavHub`），所以要注册成模块；
 * 但字段全部由 `GROUPS` 派生 —— 早前这里是 7 行手抄，与 `GROUPS` 重复。
 */
const NAV_MODULES = Object.values(GROUPS).map((g) => ({
  id: g.navId,
  name: g.name,
  group: g.key,
  subgroup: null,
  icon: g.navIcon,
  keywords: `nav ${g.key.toLowerCase()} ${g.name} 导航大屏`
}))

export const MODULES = [
  // ── 工作室（与小程序店长/超管「工作室」模块对齐：物业 / 采购 / 出货 / 库存同步）──
  { id: '77', name: '物业成本', group: 'STUDIO', subgroup: '工作室', icon: 'House', keywords: 'property cost property_costs managePropertyCost 水电 房租 票据 物业成本 物业' },
  { id: '76', name: '采购管理', group: 'STUDIO', subgroup: '工作室', icon: 'ShoppingCart', keywords: 'purchase ops_purchases managePurchaseOrder caigou 门店采购 工作室采购 供应商 采购' },
  { id: '79', name: '出货单', group: 'STUDIO', subgroup: '工作室', icon: 'Van', keywords: 'shipment ops_shipments manageStoreShipment chuhuo 出货单 门店出货' },
  { id: '78', name: '飞书同步中心', group: 'STUDIO', subgroup: '工作室', icon: 'Connection', keywords: 'feishu bitable sync 飞书 多维表 同步 采购映射 ops_purchases ops_shipments feishu_bitable 库存管理 studio_inventory' },
  { id: '7',  name: '标本师管理', group: 'STUDIO', subgroup: '工作室', icon: 'Brush', keywords: 'framer staff bbsgl artisan 标本师管理' },
  { id: '38', name: '标本定制工单', group: 'STUDIO', subgroup: '工作室', icon: 'Brush', keywords: 'custom workshop bbdzgd 定制 工单' },
  // ── 2026-09-14 与小程序对齐补的四模块 ──
  { id: '72', name: '定金管理', group: 'BUSINESS', subgroup: '货', icon: 'Money', keywords: 'deposit dingjin 定金 尾款 售罄孤品 意向' },
  { id: '73', name: '直播管理', group: 'BUSINESS', subgroup: '场', icon: 'VideoCamera', keywords: 'live zhibo 直播 场次 主播 开播' },
  { id: '74', name: '装裱师佣金', group: 'GOVERNANCE', subgroup: '人才组织', icon: 'Wallet', keywords: 'commission yongjin 佣金 装裱师 提成 台账' },
  { id: '75', name: '生日礼配置', group: 'CUSTOMER', subgroup: '会员资产', icon: 'Present', keywords: 'birthday shengri 生日礼 礼包 礼券' },
  // 导航大屏（侧栏一级）—— 由 GROUPS 派生，勿手抄
  ...NAV_MODULES,

  // 总览决策
  { id: '0',  name: '经营驾驶舱', group: 'OVERVIEW', subgroup: null, icon: 'Odometer', keywords: 'dashboard cockpit jyjsc ovw 首页' },
  { id: '26', name: '监控大屏', group: 'OVERVIEW', subgroup: null, icon: 'Monitor', keywords: 'monitor realtime sslg dashboard 告警刷新 经营数据大屏 看板' },
  { id: '49', name: '经营数据大屏 · 看板', group: 'OVERVIEW', subgroup: null, icon: 'DataBoard', keywords: 'bigscreen jydp dataviz cockpit screen 大屏 看板 已并入监控大屏' },
  { id: '25', name: '运营决策中心', group: 'OVERVIEW', subgroup: null, icon: 'Trophy', keywords: 'decision center yyjzzx ops' },
  // AI 工作台（云端 Agent）：**外链条目**（`external`）—— 不在 ERP 内部渲染，
  // 而是新标签打开独立部署的 DeepSeek Harness（agent.shanhaizaowu.com）。
  // 见 App.vue 的 EXTERNAL_TAB_IDS / externalUrlOf：这类条目不占内部 tab，
  // 深链也不会开出没有组件的白屏 tab（走「打开外链 + 回退驾驶舱」）。
  { id: '80', name: 'AI 工作台', group: 'OVERVIEW', subgroup: null, icon: 'Cpu', keywords: 'agent dsh deepseek harness 云端 agent.shanhaizaowu.com AI 工作台 智能体', external: 'https://agent.shanhaizaowu.com/' },

  // 业务运营 — 货
  { id: '1',  name: '藏品档案库', group: 'BUSINESS', subgroup: '货', icon: 'Box', keywords: 'product collection archive cpdak sku 商品' },
  { id: '43', name: '分类管理', group: 'BUSINESS', subgroup: '货', icon: 'Menu', keywords: 'category flgl tag' },
  { id: '3',  name: '全渠道订单', group: 'BUSINESS', subgroup: '货', icon: 'List', keywords: 'order qqdd 订单' },
  { id: '52', name: '订货履约', group: 'BUSINESS', subgroup: '货', icon: 'ShoppingCart', keywords: 'purchase order fulfillment dhly 订货 采购 意向 出货 price-list 库存' },
  { id: '57', name: '报价单配置', group: 'BUSINESS', subgroup: '货', icon: 'Ticket', keywords: 'price list quote bjd 报价单 price_list_items 供货价' },
  { id: '42', name: '退款审核', group: 'BUSINESS', subgroup: '货', icon: 'Refresh', keywords: 'refund tksh 退款' },
  { id: '60', name: '订单绑定审核', group: 'BUSINESS', subgroup: '货', icon: 'Connection', keywords: 'platform order bind bindPlatformOrder ddbd 订单绑定 积分' },
  { id: '65', name: '小票兑积分审核', group: 'BUSINESS', subgroup: '货', icon: 'Tickets', keywords: 'store receipt claim claimStoreReceipt 小票 门店积分 审核' },
  { id: '67', name: '待我审批', group: 'BUSINESS', subgroup: '货', icon: 'Checked', keywords: 'approval queue manageApprovals staff_approvals 审批 上架 店长 超管' },
  { id: '61', name: '运费与包邮规则', group: 'BUSINESS', subgroup: '货', icon: 'Van', keywords: 'shipping rules yfgz 运费 包邮 shipping_rules makeOrder' },
  // 业务运营 — 场
  { id: '37', name: '预约中心', group: 'BUSINESS', subgroup: '场', icon: 'Stamp', keywords: 'booking checkin yyhx 核销 预约 预约规则' },
  { id: '5',  name: '活动与排期', group: 'BUSINESS', subgroup: '场', icon: 'Calendar', keywords: 'activity event hdpc 活动' },
  { id: '6',  name: '权益与营销', group: 'BUSINESS', subgroup: '场', icon: 'Ticket', keywords: 'marketing benefit qyyx coupon 营销 礼包 积分 成就 钱包 活动规则 礼赠履约 gift-board gift_settings manageGift listBoard' },
  { id: '70', name: '礼赠运营配置', group: 'BUSINESS', subgroup: '场', icon: 'Present', keywords: 'gift ops gift_settings manageGift 礼赠 运营配置 填址超时 已并入权益营销' },
  { id: '71', name: '礼赠履约看板', group: 'BUSINESS', subgroup: '场', icon: 'Box', keywords: 'gift board listBoard giftOps 履约 待填址 待发货 自提 已并入权益营销' },
  { id: '30', name: '门店中心', group: 'BUSINESS', subgroup: '场', icon: 'Shop', keywords: 'store dpgl shop 展区 设计 店员权限 这有店' },
  { id: '64', name: '店员工作台权限', group: 'BUSINESS', subgroup: '场', icon: 'Lock', keywords: 'store manager staff_members manageStaff 店长 店员 权限 staffGuard 工作台 手机号 openid giftOps verifyStoreCoupon verifyGiftPickup 已并入门店中心' },
  { id: '55', name: 'C端门店展区', group: 'BUSINESS', subgroup: '场', icon: 'Shop', keywords: 'store front zones cdmxq 这有店 store_zones 已并入门店中心' },
  { id: '34', name: '门店设计中心', group: 'BUSINESS', subgroup: '场', icon: 'Brush', keywords: 'store design mdsjzx 装修 已并入门店中心' },
  { id: '35', name: '加盟商管理', group: 'BUSINESS', subgroup: '场', icon: 'Promotion', keywords: 'franchise jmsgl 加盟' },
  { id: '48', name: '物业合作测算', group: 'BUSINESS', subgroup: '场', icon: 'House', keywords: 'property eval rent revenue wyhz 物业 测算 房租 分润' },
  // 业务运营 — 定制工坊
  { id: '39', name: '伴宠记忆订单', group: 'BUSINESS', subgroup: '定制工坊', icon: 'Avatar', keywords: 'pet memorial bcjy 宠物' },

  // 客户经营 — 会员资产
  { id: '4',  name: '会员经营', group: 'CUSTOMER', subgroup: '会员资产', icon: 'UserFilled', keywords: 'crm member hycrm 会员 画像 人群 等级 荣誉馆长' },
  { id: '45', name: '用户画像', group: 'CUSTOMER', subgroup: '会员资产', icon: 'MagicStick', keywords: 'profile rfm yhhx 画像 已并入会员经营' },
  { id: '46', name: '人群包', group: 'CUSTOMER', subgroup: '会员资产', icon: 'Promotion', keywords: 'audience rqb cohort 已并入会员经营' },
  { id: '47', name: '人群对比', group: 'CUSTOMER', subgroup: '会员资产', icon: 'DataBoard', keywords: 'cohort compare rqdb 已并入会员经营' },
  // 客户经营 — 行为与互动
  { id: '44', name: '行为洞察', group: 'CUSTOMER', subgroup: '行为与互动', icon: 'DataAnalysis', keywords: 'behavior analytics cdxwkb event 追踪配置' },
  { id: '40', name: '山海有信工单', group: 'CUSTOMER', subgroup: '行为与互动', icon: 'Message', keywords: 'support ticket shyxgd 客服 工单' },
  { id: '41', name: '评论审核', group: 'CUSTOMER', subgroup: '行为与互动', icon: 'ChatDotRound', keywords: 'comment plsh moderation 评论' },
  { id: '59', name: '开票申请台', group: 'CUSTOMER', subgroup: '行为与互动', icon: 'Document', keywords: 'invoice manageInvoiceRequests kpsq 开票 发票' },
  // 客户经营 — 内容营销
  { id: '51', name: '内容工厂', group: 'CUSTOMER', subgroup: '内容营销', icon: 'VideoCamera', keywords: 'content factory nrgc 内容 营销 选题 话术' },

  // 小程序配置 — 内容运营
  { id: '8',  name: '首页轮播', group: 'MINIAPP', subgroup: '内容运营', icon: 'Picture', keywords: 'banner sylb carousel 已并入首页运营' },
  { id: '13', name: '首页运营', group: 'MINIAPP', subgroup: '内容运营', icon: 'Setting', keywords: 'home config sypz layout 轮播 展示开关' },
  { id: '9',  name: '内容管理', group: 'MINIAPP', subgroup: '内容运营', icon: 'Collection', keywords: 'content cms nrgl article' },
  { id: '54', name: '养护指南', group: 'MINIAPP', subgroup: '内容运营', icon: 'Notebook', keywords: 'care guides yhzh specimen care' },
  { id: '56', name: '客服入口配置', group: 'MINIAPP', subgroup: '内容运营', icon: 'Phone', keywords: 'support config kf rk 联系专员 FAQ getSupportConfig' },
  { id: '62', name: '内容展示开关', group: 'MINIAPP', subgroup: '内容运营', icon: 'View', keywords: 'content display flags 展示开关 标本档案 山海社区 标本定制 AI鉴定 showAiIdentify getContentDisplayFlags 已并入首页运营' },
  // 小程序配置 — 会员/营销规则（已并入会员经营 / 权益营销，保留搜索别名）
  { id: '14', name: '会员等级体系', group: 'MINIAPP', subgroup: '会员/营销规则', icon: 'UserFilled', keywords: 'member level hydjtx vip 已并入会员经营' },
  { id: '69', name: '会员等级调整', group: 'MINIAPP', subgroup: '会员/营销规则', icon: 'Sort', keywords: 'member level adjust 等级调整 levelOverride manageMemberLevelAdjust 调级 已并入会员经营' },
  { id: '63', name: '荣誉馆长名单', group: 'MINIAPP', subgroup: '会员/营销规则', icon: 'Trophy', keywords: 'honorary curator 荣誉馆长 lv99 isHonorary manageHonoraryCurators 已并入会员经营' },
  { id: '15', name: '门店积分规则', group: 'MINIAPP', subgroup: '会员/营销规则', icon: 'Ticket', keywords: 'point rule jfgz store_point_rules 已并入权益营销' },
  { id: '66', name: '新会员礼包', group: 'MINIAPP', subgroup: '会员/营销规则', icon: 'Present', keywords: 'welcome gift register 新会员礼包 注册礼 积分 礼券 member_welcome_gift 已并入权益营销' },
  { id: '68', name: '我的钱包', group: 'MINIAPP', subgroup: '会员/营销规则', icon: 'Wallet', keywords: 'wallet stored value 钱包 充值 支付折扣 manageStoredValue showStoredValue 已并入权益营销' },
  { id: '22', name: '成就系统配置', group: 'MINIAPP', subgroup: '会员/营销规则', icon: 'Trophy', keywords: 'achievement cjxt badge 已并入权益营销' },
  { id: '20', name: '活动营销规则', group: 'MINIAPP', subgroup: '会员/营销规则', icon: 'Ticket', keywords: 'marketing rule hdyx coupon 已并入权益营销' },
  // 小程序配置 — 系统/算法/通知
  { id: '16', name: '预约规则配置', group: 'MINIAPP', subgroup: '系统/算法/通知', icon: 'Calendar', keywords: 'booking rule yygz slot 已并入预约中心' },
  { id: '19', name: '推荐算法配置', group: 'MINIAPP', subgroup: '系统/算法/通知', icon: 'MagicStick', keywords: 'recommend algorithm tjsf rec' },
  { id: '18', name: '搜索关键词管理', group: 'MINIAPP', subgroup: '系统/算法/通知', icon: 'Search', keywords: 'search keyword sshjc' },
  { id: '24', name: '通知消息配置', group: 'MINIAPP', subgroup: '系统/算法/通知', icon: 'ChatDotRound', keywords: 'notification message tzxx push' },
  { id: '23', name: '用户行为追踪', group: 'MINIAPP', subgroup: '系统/算法/通知', icon: 'DataAnalysis', keywords: 'behavior track yhxw event 已并入行为洞察' },
  { id: '21', name: '数据报表增强', group: 'MINIAPP', subgroup: '系统/算法/通知', icon: 'DataAnalysis', keywords: 'report sjbb' },
  { id: '17', name: '权限管理系统', group: 'MINIAPP', subgroup: '系统/算法/通知', icon: 'Lock', keywords: 'permission rbac qxgl' },

  // 组织治理 — 人才
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

/** 按 group key 聚合。
 *  浏览用列表**只列规范模块**（排除「已并入」的别名），否则同一屏会出现两次：
 *  例如「经营数据大屏 · 看板」与「监控大屏」并列。别名仍可通过搜索命中（带落点提示）。 */
export function modulesByGroup() {
  const map = {}
  Object.keys(GROUPS).forEach(k => { map[k] = [] })
  MODULES.filter(m => !MODULE_ALIASES[String(m.id)]).forEach(m => map[m.group]?.push(m))
  return map
}

/** 规范模块（排除别名）——用于「共 N 个」这类计数，避免把别名算成独立功能 */
export const MODULES_CANONICAL = MODULES.filter(m => !MODULE_ALIASES[String(m.id)])

/**
 * 模块的最终落点：别名 id → 合并后的 Hub id。
 * 单一事实来源是 `moduleAliases.js`（那里同时给出 Hub 内的分区），此处只做查询用解析。
 */
export function resolveModuleTarget(id) {
  const key = String(id || '')
  const hit = MODULE_ALIASES[key]
  return hit && hit.hub ? String(hit.hub) : key
}

/**
 * 同一落点只保留一条结果。
 *
 * 背景（2026-09-16 审计 P2）：32 个「已并入 X」的旧模块仍在 MODULES 里（保留搜索别名），
 * 于是命令面板对**同一屏给出两行** —— 例如搜「积分」会同时列出
 * `15 门店积分规则`（别名 → 6）与 `6 权益与营销`，看着像两个不同功能。
 *
 * 保留**得分更高**的那条（而不是一律保留 Hub）：用户按旧名搜索时，
 * 看到旧名更好认；同时把落点写进 `_aliasTargetName`，由面板提示「并入 X」。
 */
function dedupeByTarget(results) {
  const best = new Map()
  results.forEach((r) => {
    const target = resolveModuleTarget(r.id)
    const prev = best.get(target)
    if (!prev || r._score > prev._score) best.set(target, r)
  })
  return [...best.values()].map((r) => {
    const target = resolveModuleTarget(r.id)
    if (target === String(r.id)) return r
    const hub = MODULES_BY_ID[target]
    return { ...r, _aliasTarget: target, _aliasTargetName: hub ? hub.name : target }
  })
}

/** 模糊搜索（不依赖 fuse.js，简单字符匹配 + 关键词加分） */
export function searchModules(query, limit = 15) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) {
    // 空查询也要去重，否则「经营数据大屏·看板」与「监控大屏」会并列出现
    return dedupeByTarget(MODULES.map((m) => ({ ...m, _score: 0 }))).slice(0, limit)
  }
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
  return dedupeByTarget(results)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
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
    id: 'act-feishu-sync', label: '打开飞书同步中心', hint: '连接状态 / 映射 / 一键同步采购表',
    icon: '🔗', shortcut: '', keywords: 'feishu sync bitable 飞书 同步 采购',
    event: { type: 'switch-tab', detail: '78' }
  },
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
    id: 'act-toggle-sidebar', label: '一键缩放侧栏', hint: '展开 ↔ 仅图标窄栏（⌘B）',
    icon: '↔️', shortcut: '⌘B', keywords: 'sidebar collapse toggle zoom 缩放 zdcl 侧栏',
    event: { type: 'toggle-sidebar' }
  },
  {
    id: 'act-sidebar-groups-collapse', label: '收起最近常用', hint: '隐藏侧栏「最近常用」列表',
    icon: '⬆️', shortcut: '', keywords: 'sidebar recent collapse fold sqzj 收起最近',
    event: { type: 'sidebar-groups-collapse' }
  },
  {
    id: 'act-sidebar-groups-expand', label: '展开最近常用', hint: '显示侧栏「最近常用」列表',
    icon: '⬇️', shortcut: '', keywords: 'sidebar recent expand unfold zkzj 展开最近',
    event: { type: 'sidebar-groups-expand' }
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
