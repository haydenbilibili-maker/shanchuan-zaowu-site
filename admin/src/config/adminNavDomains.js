/**
 * 一级业务域 → 全页导航大屏（AdminNavHub）数据源
 * 与现有 Ops Hub（门店/权益/会员等 Tab 聚合）互补：
 * - NavHub：分类级入口墙
 * - OpsHub：同域功能内的分区 Tab
 */
import { MODULES_BY_ID } from '../utils/modulesRegistry'

/** @typedef {{ id: string, title: string, desc: string, icon?: string }} NavEntry */
/** @typedef {{ key: string, title: string, overline?: string, entries: NavEntry[] }} NavSection */
/** @typedef {{ id: string, title: string, overline: string, subtitle: string, sections: NavSection[] }} NavDomain */

/** @type {Record<string, NavDomain>} */
export const NAV_DOMAINS = {
  'nav-overview': {
    id: 'nav-overview',
    title: '总览决策',
    overline: 'OVERVIEW',
    subtitle: '驾驶舱、监控与运营决策入口',
    sections: [
      {
        key: 'cockpit',
        title: '经营总览',
        overline: 'COCKPIT',
        entries: [
          { id: '0', title: '经营驾驶舱', desc: '今日营收、待办与快捷动作', icon: 'Odometer' },
          { id: '26', title: '监控大屏', desc: '实时告警与经营数据看板', icon: 'Monitor' },
          { id: '25', title: '运营决策中心', desc: '运营策略与决策辅助', icon: 'Trophy' },
        ],
      },
    ],
  },
  'nav-business': {
    id: 'nav-business',
    title: '业务运营',
    overline: 'OPERATIONS',
    subtitle: '货品、交易履约、门店场域与定制工坊',
    sections: [
      {
        key: 'goods',
        title: '商品资产',
        overline: 'CATALOG',
        entries: [
          { id: '1', title: '藏品档案库', desc: 'SKU 录入、上下架与标签', icon: 'Box' },
          { id: '43', title: '分类管理', desc: '馆藏分类树与筛选同源', icon: 'Menu' },
        ],
      },
      {
        key: 'fulfill',
        title: '交易履约',
        overline: 'FULFILLMENT',
        entries: [
          { id: '3', title: '全渠道订单', desc: '订单查询、发货与状态', icon: 'List' },
          { id: '52', title: '订货履约', desc: '采购意向、出货与库存', icon: 'ShoppingCart' },
          { id: '57', title: '报价单配置', desc: '供货价与报价清单', icon: 'Ticket' },
          { id: '42', title: '退款审核', desc: '退款申请处理', icon: 'Refresh' },
          { id: '60', title: '订单绑定审核', desc: '平台订单绑定与积分', icon: 'Connection' },
          { id: '65', title: '小票兑积分审核', desc: '门店小票核销积分', icon: 'Tickets' },
          { id: '67', title: '待我审批', desc: '上架与店长审批队列', icon: 'Checked' },
          { id: '61', title: '运费与包邮规则', desc: '运费模板与包邮门槛', icon: 'Van' },
          { id: '72', title: '定金管理', desc: '售罄孤品定金规则与意向', icon: 'Money' },
        ],
      },
      {
        key: 'experience',
        title: '体验营销',
        overline: 'EXPERIENCE',
        entries: [
          { id: '37', title: '预约中心', desc: '预约核销与规则配置', icon: 'Stamp' },
          { id: '5', title: '活动与排期', desc: '活动日历与报名', icon: 'Calendar' },
          { id: '6', title: '权益与营销', desc: '券、礼赠、礼包、积分与成就', icon: 'Ticket' },
          { id: '73', title: '直播管理', desc: '场次、挂载商品与互动数据', icon: 'VideoCamera' },
        ],
      },
      {
        key: 'store',
        title: '门店场域',
        overline: 'STORES',
        entries: [
          { id: '30', title: '门店中心', desc: 'ERP 档案、C 端展区与店员权限', icon: 'Shop' },
          { id: '35', title: '加盟商管理', desc: '加盟线索与合作档案', icon: 'Promotion' },
          { id: '48', title: '物业合作测算', desc: '房租分润与物业测算', icon: 'House' },
        ],
      },
      {
        key: 'atelier',
        title: '定制工坊',
        overline: 'ATELIER',
        entries: [
          { id: '39', title: '伴宠记忆订单', desc: '宠物纪念订单履约', icon: 'Avatar' },
        ],
      },
    ],
  },
  'nav-studio': {
    id: 'nav-studio',
    title: '工作室',
    overline: 'STUDIO',
    subtitle: '采购库存、物业、标本师与定制工单（与小程序工作室模块对齐）',
    sections: [
      {
        key: 'studio-ops',
        title: '工作室运营',
        overline: 'OPS',
        entries: [
          { id: '77', title: '物业', desc: '水电房租登记与票据', icon: 'House' },
          { id: '76', title: '采购', desc: '门店与工作室采购清单', icon: 'ShoppingCart' },
          { id: '79', title: '出货单', desc: '出货账本核对（SSOT ops_shipments）', icon: 'Van' },
          { id: '78', title: '库存同步', desc: '飞书成品/原材料库存与采购出货同步', icon: 'Connection' },
          { id: '7', title: '标本师管理', desc: '标本师档案与作品', icon: 'Brush' },
          { id: '38', title: '工单', desc: '标本定制生产进度', icon: 'Brush' },
        ],
      },
    ],
  },
  'nav-customer': {
    id: 'nav-customer',
    title: '客户经营',
    overline: 'CUSTOMERS',
    subtitle: '会员、互动服务与内容营销',
    sections: [
      {
        key: 'member',
        title: '会员洞察',
        overline: 'MEMBERS',
        entries: [
          { id: '4', title: '会员经营', desc: 'CRM、画像、人群与等级', icon: 'UserFilled' },
          { id: '75', title: '生日礼配置', desc: '生日礼包、积分与礼券', icon: 'Present' },
        ],
      },
      {
        key: 'engage',
        title: '互动服务',
        overline: 'ENGAGE',
        entries: [
          { id: '44', title: '行为洞察', desc: 'C 端事件看板与埋点配置', icon: 'DataAnalysis' },
          { id: '40', title: '山海有信', desc: '客服工单台', icon: 'Message' },
          { id: '41', title: '评论审核', desc: '社区评论 moderation', icon: 'ChatDotRound' },
          { id: '59', title: '开票申请台', desc: '发票申请处理', icon: 'Document' },
        ],
      },
      {
        key: 'content',
        title: '内容营销',
        overline: 'CONTENT',
        entries: [
          { id: '51', title: '内容工厂', desc: '选题、话术与内容生产', icon: 'VideoCamera' },
        ],
      },
    ],
  },
  'nav-miniapp': {
    id: 'nav-miniapp',
    title: '小程序配置',
    overline: 'MINIAPP',
    subtitle: '首页、内容展示与系统算法',
    sections: [
      {
        key: 'home',
        title: '内容与首页',
        overline: 'HOME',
        entries: [
          { id: '13', title: '首页运营', desc: '轮播、模块布局与展示开关', icon: 'Setting' },
          { id: '9', title: '内容管理', desc: '文章与 CMS 内容', icon: 'Collection' },
          { id: '54', title: '养护指南', desc: '标本养护说明', icon: 'Notebook' },
          { id: '56', title: '客服入口配置', desc: '联系专员与 FAQ', icon: 'Phone' },
        ],
      },
      {
        key: 'system',
        title: '系统与算法',
        overline: 'SYSTEM',
        entries: [
          { id: '19', title: '推荐算法配置', desc: '首页与馆藏推荐权重', icon: 'MagicStick' },
          { id: '18', title: '搜索关键词管理', desc: '热搜与同义词', icon: 'Search' },
          { id: '24', title: '通知消息配置', desc: '订阅消息与推送文案', icon: 'ChatDotRound' },
          { id: '21', title: '数据报表增强', desc: '自定义报表构建', icon: 'DataAnalysis' },
          { id: '17', title: '权限管理系统', desc: '后台 RBAC 角色', icon: 'Lock' },
        ],
      },
    ],
  },
  'nav-governance': {
    id: 'nav-governance',
    title: '组织治理',
    overline: 'GOVERNANCE',
    subtitle: '财务资本、人才组织与合规品牌',
    sections: [
      {
        key: 'finance',
        title: '财务资本',
        overline: 'FINANCE',
        entries: [
          { id: '2', title: '财务核算系统', desc: '收支记账与对账', icon: 'Money' },
          { id: '36', title: '资本架构沙盘', desc: '股权与资本结构推演', icon: 'DataBoard' },
          { id: '50', title: '工作室启动成本', desc: '启动现金流与爬坡模型', icon: 'TrendCharts' },
          { id: '27', title: '合伙人命理中心', desc: '合伙人匹配辅助', icon: 'DocumentCopy' },
        ],
      },
      {
        key: 'people',
        title: '人才组织',
        overline: 'PEOPLE',
        entries: [
          { id: '32', title: '员工花名册', desc: '总部 HR 花名册', icon: 'User' },
          { id: '31', title: '员工薪酬管理', desc: '薪酬与薪资单', icon: 'Wallet' },
          { id: '74', title: '装裱师佣金', desc: '按单佣金规则与台账', icon: 'Wallet' },
        ],
      },
      {
        key: 'compliance',
        title: '治理合规',
        overline: 'COMPLIANCE',
        entries: [
          { id: '33', title: '公司治理', desc: '董事会与治理事项', icon: 'OfficeBuilding' },
          { id: '28', title: '合规专栏', desc: '法规与合规资料', icon: 'Lock' },
        ],
      },
      {
        key: 'brand',
        title: '品牌视觉',
        overline: 'BRAND',
        entries: [
          { id: '53', title: '品牌 VIS', desc: '视觉识别规范与资产', icon: 'Brush' },
        ],
      },
    ],
  },
  'nav-intelligence': {
    id: 'nav-intelligence',
    title: '战略与知识',
    overline: 'INTELLIGENCE',
    subtitle: 'AI 智能、战略调研与经营手册',
    sections: [
      {
        key: 'ai',
        title: '智能与战略',
        overline: 'STRATEGY',
        entries: [
          { id: '12', title: '智能中心', desc: 'AI 助手与业务智能工具', icon: 'MagicStick' },
          { id: '10', title: '战略调研看板', desc: '竞品与市场调研', icon: 'DataAnalysis' },
          { id: '58', title: '爆品概念生成器', desc: '新品概念金字塔', icon: 'MagicStick' },
          { id: '29', title: '经营手册', desc: 'SOP 与经营知识库', icon: 'Notebook' },
        ],
      },
    ],
  },
}

/** 功能模块 id → 所属导航域 id */
export const MODULE_TO_NAV_DOMAIN = (() => {
  /** @type {Record<string, string>} */
  const map = {}
  Object.values(NAV_DOMAINS).forEach((domain) => {
    domain.sections.forEach((section) => {
      section.entries.forEach((entry) => {
        map[entry.id] = domain.id
      })
    })
  })
  return map
})()

export const NAV_DOMAIN_IDS = Object.keys(NAV_DOMAINS)

export function getNavDomain(domainId) {
  return NAV_DOMAINS[String(domainId || '')] || null
}

/** 过滤不可见/未注册模块；visibleIds 为 null 时仅校验 MODULES_BY_ID */
export function filterDomainSections(domain, visibleIds = null) {
  if (!domain) return []
  const allow = visibleIds == null ? null : new Set(visibleIds.map(String))
  return domain.sections
    .map((section) => ({
      ...section,
      entries: section.entries.filter((entry) => {
        if (!MODULES_BY_ID[entry.id]) return false
        if (allow && !allow.has(String(entry.id))) return false
        return true
      }),
    }))
    .filter((section) => section.entries.length > 0)
}

export function searchDomainEntries(domain, query, visibleIds = null) {
  const raw = String(query || '').trim().toLowerCase()
  const sections = filterDomainSections(domain, visibleIds)
  if (!raw) return sections
  const tokens = raw.split(/\s+/).filter(Boolean)
  return sections
    .map((section) => ({
      ...section,
      entries: section.entries.filter((entry) => {
        const mod = MODULES_BY_ID[entry.id]
        const hay = `${entry.title} ${entry.desc} ${mod?.name || ''} ${mod?.keywords || ''} ${section.title}`.toLowerCase()
        return tokens.every((t) => hay.includes(t))
      }),
    }))
    .filter((section) => section.entries.length > 0)
}
