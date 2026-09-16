/**
 * 一级业务域 → 全页导航大屏（AdminNavHub）数据源
 * 与现有 Ops Hub（门店/权益/会员等 Tab 聚合）互补：
 * - NavHub：分类级入口墙
 * - OpsHub：同域功能内的分区 Tab
 *
 * ── 事实来源（2026-09-16 审计 P1「导航 3–4 份事实来源」整合后）────────────────
 * 本文件**不再自行定义域与模块的身份字段**，只负责「策展」：
 *
 *   | 字段                         | 来源                                  |
 *   | ---------------------------- | ------------------------------------- |
 *   | 域 id / 名称 / 图标 / overline | `modulesRegistry.GROUPS`（唯一来源）    |
 *   | 域副标题、分区结构、分区标题     | 本文件的 `NAV_CURATION`（GROUPS 没有）  |
 *   | 条目名称 / 图标                | `modulesRegistry.MODULES_BY_ID`        |
 *   | 条目一句话说明                 | 本文件的 `NAV_CURATION.desc`            |
 *   | 每个模块落在哪个分区            | 本文件的 `NAV_CURATION.sections[].ids`  |
 *
 * 整合前域名称与条目名称在这里被手抄一遍，已实际漂移出 6 处同屏两名：
 * `77 物业 / 物业成本`、`76 采购 / 采购管理`、`78 库存同步 / 飞书同步中心`、
 * `38 工单 / 标本定制工单`、`40 山海有信 / 山海有信工单`、`12 智能中心 / AI 智能中心`
 * —— 导航大屏叫一个名，侧栏/命令面板/标签页/面包屑叫另一个名。现在统一取注册表名。
 *
 * 守卫：`admin/scripts/check-nav-sources.mjs`（含 --selftest）。新增模块若忘记策展到此文件，
 * 守卫会失败，避免出现「注册了但导航大屏进不去」的隐形功能。
 */
import { GROUPS, MODULES_BY_ID } from '../utils/modulesRegistry.js'

/**
 * 策展数据：GROUPS / MODULES 里没有、必须人工决定的部分。
 * 条目只写 `id` + `desc`；`title`/`icon` 由注册表派生，禁止在此重抄。
 *
 * @typedef {{ id: string, desc: string }} CurationEntry
 * @typedef {{ key: string, title: string, overline?: string, entries: CurationEntry[] }} CurationSection
 * @typedef {{ subtitle: string, sections: CurationSection[] }} CurationDomain
 * @type {Record<string, CurationDomain>}
 */
const NAV_CURATION = {
  'nav-overview': {
    subtitle: '驾驶舱、监控与运营决策入口',
    sections: [
      {
        key: 'cockpit',
        title: '经营总览',
        overline: 'COCKPIT',
        entries: [
          { id: '0', desc: '今日营收、待办与快捷动作' },
          { id: '26', desc: '实时告警与经营数据看板' },
          { id: '25', desc: '运营策略与决策辅助' },
        ],
      },
    ],
  },
  'nav-business': {
    subtitle: '货品、交易履约、门店场域与定制工坊',
    sections: [
      {
        key: 'goods',
        title: '商品资产',
        overline: 'CATALOG',
        entries: [
          { id: '1', desc: 'SKU 录入、上下架与标签' },
          { id: '43', desc: '馆藏分类树与筛选同源' },
        ],
      },
      {
        key: 'fulfill',
        title: '交易履约',
        overline: 'FULFILLMENT',
        entries: [
          { id: '3', desc: '订单查询、发货与状态' },
          { id: '52', desc: '采购意向、出货与库存' },
          { id: '57', desc: '供货价与报价清单' },
          { id: '42', desc: '退款申请处理' },
          { id: '60', desc: '平台订单绑定与积分' },
          { id: '65', desc: '门店小票核销积分' },
          { id: '67', desc: '上架与店长审批队列' },
          { id: '61', desc: '运费模板与包邮门槛' },
          { id: '72', desc: '售罄孤品定金规则与意向' },
        ],
      },
      {
        key: 'experience',
        title: '体验营销',
        overline: 'EXPERIENCE',
        entries: [
          { id: '37', desc: '预约核销与规则配置' },
          { id: '5', desc: '活动日历与报名' },
          { id: '6', desc: '券、礼赠、礼包、积分与成就' },
          { id: '73', desc: '场次、挂载商品与互动数据' },
        ],
      },
      {
        key: 'store',
        title: '门店场域',
        overline: 'STORES',
        entries: [
          { id: '30', desc: 'ERP 档案、C 端展区与店员权限' },
          { id: '35', desc: '加盟线索与合作档案' },
          { id: '48', desc: '房租分润与物业测算' },
        ],
      },
      {
        key: 'atelier',
        title: '定制工坊',
        overline: 'ATELIER',
        entries: [
          { id: '39', desc: '宠物纪念订单履约' },
        ],
      },
    ],
  },
  'nav-studio': {
    subtitle: '采购库存、物业、标本师与定制工单（与小程序工作室模块对齐）',
    sections: [
      {
        key: 'studio-ops',
        title: '工作室运营',
        overline: 'OPS',
        entries: [
          { id: '77', desc: '水电房租登记与票据' },
          { id: '76', desc: '门店与工作室采购清单' },
          { id: '79', desc: '出货账本核对（SSOT ops_shipments）' },
          { id: '78', desc: '飞书成品/原材料库存与采购出货同步' },
          { id: '7', desc: '标本师档案与作品' },
          { id: '38', desc: '标本定制生产进度' },
        ],
      },
    ],
  },
  'nav-customer': {
    subtitle: '会员、互动服务与内容营销',
    sections: [
      {
        key: 'member',
        title: '会员洞察',
        overline: 'MEMBERS',
        entries: [
          { id: '4', desc: 'CRM、画像、人群与等级' },
          { id: '75', desc: '生日礼包、积分与礼券' },
        ],
      },
      {
        key: 'engage',
        title: '互动服务',
        overline: 'ENGAGE',
        entries: [
          { id: '44', desc: 'C 端事件看板与埋点配置' },
          { id: '40', desc: '客服工单台' },
          { id: '41', desc: '社区评论 moderation' },
          { id: '59', desc: '发票申请处理' },
        ],
      },
      {
        key: 'content',
        title: '内容营销',
        overline: 'CONTENT',
        entries: [
          { id: '51', desc: '选题、话术与内容生产' },
        ],
      },
    ],
  },
  'nav-miniapp': {
    subtitle: '首页、内容展示与系统算法',
    sections: [
      {
        key: 'home',
        title: '内容与首页',
        overline: 'HOME',
        entries: [
          { id: '13', desc: '轮播、模块布局与展示开关' },
          { id: '9', desc: '文章与 CMS 内容' },
          { id: '54', desc: '标本养护说明' },
          { id: '56', desc: '联系专员与 FAQ' },
        ],
      },
      {
        key: 'system',
        title: '系统与算法',
        overline: 'SYSTEM',
        entries: [
          { id: '19', desc: '首页与馆藏推荐权重' },
          { id: '18', desc: '热搜与同义词' },
          { id: '24', desc: '订阅消息与推送文案' },
          { id: '21', desc: '自定义报表构建' },
          { id: '17', desc: '后台 RBAC 角色' },
        ],
      },
    ],
  },
  'nav-governance': {
    subtitle: '财务资本、人才组织与合规品牌',
    sections: [
      {
        key: 'finance',
        title: '财务资本',
        overline: 'FINANCE',
        entries: [
          { id: '2', desc: '收支记账与对账' },
          { id: '36', desc: '股权与资本结构推演' },
          { id: '50', desc: '启动现金流与爬坡模型' },
          { id: '27', desc: '合伙人匹配辅助' },
        ],
      },
      {
        key: 'people',
        title: '人才组织',
        overline: 'PEOPLE',
        entries: [
          { id: '32', desc: '总部 HR 花名册' },
          { id: '31', desc: '薪酬与薪资单' },
          { id: '74', desc: '按单佣金规则与台账' },
        ],
      },
      {
        key: 'compliance',
        title: '治理合规',
        overline: 'COMPLIANCE',
        entries: [
          { id: '33', desc: '董事会与治理事项' },
          { id: '28', desc: '法规与合规资料' },
        ],
      },
      {
        key: 'brand',
        title: '品牌视觉',
        overline: 'BRAND',
        entries: [
          { id: '53', desc: '视觉识别规范与资产' },
        ],
      },
    ],
  },
  'nav-intelligence': {
    subtitle: 'AI 智能、战略调研与经营手册',
    sections: [
      {
        key: 'ai',
        title: '智能与战略',
        overline: 'STRATEGY',
        entries: [
          { id: '12', desc: 'AI 助手与业务智能工具' },
          { id: '10', desc: '竞品与市场调研' },
          { id: '58', desc: '新品概念金字塔' },
          { id: '29', desc: 'SOP 与经营知识库' },
        ],
      },
    ],
  },
}

/** 把 GROUPS（域身份）+ MODULES_BY_ID（条目身份）+ NAV_CURATION（策展）拼成一个域 */
function buildDomain(group, curation) {
  const sections = (curation.sections || []).map((section) => ({
    key: section.key,
    title: section.title,
    overline: section.overline,
    entries: section.entries.map((entry) => {
      const mod = MODULES_BY_ID[entry.id]
      return {
        id: String(entry.id),
        // 名称/图标唯一取自注册表：导航大屏与侧栏、命令面板、标签页因此不可能再各说各话
        title: mod ? mod.name : String(entry.id),
        desc: entry.desc,
        icon: mod ? mod.icon : undefined,
      }
    }),
  }))
  return {
    id: group.navId,
    title: group.name,
    overline: group.overline,
    icon: group.navIcon,
    subtitle: curation.subtitle || '',
    sections,
  }
}

/** @type {Record<string, {id:string,title:string,overline:string,icon:string,subtitle:string,sections:Array<{key:string,title:string,overline?:string,entries:Array<{id:string,title:string,desc:string,icon?:string}>}>}>} */
export const NAV_DOMAINS = Object.fromEntries(
  Object.values(GROUPS).map((group) => [
    group.navId,
    buildDomain(group, NAV_CURATION[group.navId] || { subtitle: '', sections: [] }),
  ])
)

/** 侧栏一级导航项（顺序 = GROUPS 顺序）。App.vue 直接 v-for，**不要再手写 el-menu-item** */
export const NAV_SIDEBAR_ITEMS = Object.values(NAV_DOMAINS).map((domain) => ({
  id: domain.id,
  title: domain.title,
  icon: domain.icon,
}))

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

/** 供守卫/文档使用：本文件人工策展覆盖到的模块 id（不含别名） */
export const NAV_CURATED_IDS = Object.values(NAV_CURATION).flatMap((curation) =>
  (curation.sections || []).flatMap((section) => section.entries.map((entry) => String(entry.id)))
)
