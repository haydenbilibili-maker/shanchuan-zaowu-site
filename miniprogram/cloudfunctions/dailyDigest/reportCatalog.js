/**
 * 每日日报 · 口径目录（**唯一事实源**）
 *
 * 为什么单独成文件：
 *   日报里的每一个数字都必须能回答「你从哪个集合、按哪个时间字段、什么条件数出来的」。
 *   把口径写在取数代码里，下一次有人换字段就没人知道数字变了 —— 所以口径在这里集中登记：
 *     `reportCatalog()` 返回的每一行都带 `sources[]`（集合 + 时间字段 + 过滤条件 + 时区语义），
 *   取数实现（dailyDigestCore.js）与本地守卫（admin/scripts/check-daily-digest.mjs）都读它。
 *   守卫会核对「目录里声明的每个来源，实现代码里都真的查了」与「实现里查的每个集合，目录里都登记了」。
 *
 * ⚠️ 本文件里的时区语义是**实测结论**，不是从源码注释抄的（2026-09-21 用 tcb db nosql 实测）：
 *   · `analytics_daily.dateKey` 是 **UTC 日**（trackUserBehavior/index.js:22-28 的 getDateKey 用
 *     `getFullYear/getMonth/getDate`，云函数运行在 UTC；无 dateKey 时兜底 `toISOString().slice(0,10)`）。
 *     实测：某北京日 00:00–08:00 的事件确实落进前一个 dateKey。日报必须显式声明这一点。
 *   · `orders.createTime / paidTime / refundTime / logistics.shipTime` 都是 Date，
 *     归日可用 Mogo `$dateToString{timezone:'Asia/Shanghai'}`，**东八日**。
 *   · `store_ledger.date` / `store_ledger.bizDate` / `daily_revenues.date` 是人工/系统录入的
 *     `'YYYY-MM-DD'` 字符串，本身已按**门店营业日**，不再做时区换算。
 *   · `ops_shipments.shipmentDate` 写入时强校验 `^\d{4}-\d{2}-\d{2}$`（manageStoreShipment/index.js:528-531）。
 */

/** 角色切片：同一份日报按角色渲染不同切片。第一批只开放超管。 */
const ROLES = {
  SUPER_ADMIN: 'super_admin',
  STORE_MANAGER: 'store_manager',
  STORE_STAFF: 'store_staff',
  SPECIMEN_ARTISAN: 'specimen_artisan',
  LIVE_HOST: 'live_host',
  SHAREHOLDER: 'shareholder',
  INVESTOR: 'investor'
}

/** 分组：与产品负责人原话对应（小程序 / 订单 / 门店营收） */
const SECTIONS = {
  MINIAPP: 'miniapp',
  ORDERS: 'orders',
  STORE: 'store'
}

/**
 * 取数实现里真的会执行这 4 个查询动作。守卫按 `kind` 核对实现覆盖面。
 *   analytics — 读 `analytics_daily` 的按日聚合行（count / uv[]）
 *   orderDay  — 对 `orders` 按某个 Date 字段做东八归日聚合（数量 + 分）
 *   dateKeyed — 读按 `'YYYY-MM-DD'` 字符串归日的集合行
 *   simpleDay — 直接 `where({ <field>: day })` 计数
 */
const QUERY_KINDS = ['analytics', 'orderDay', 'dateKeyed', 'simpleDay']

/**
 * 指标目录。
 *
 * 字段含义：
 *   id        指标 id（写进日报 payload，前端按 id 渲染）
 *   section   所属分组
 *   label     中文名（超管日报正文用）
 *   unit      count | fen | yuan | order | store
 *   kind      取数动作（见 QUERY_KINDS）
 *   source    人类可读的一句话口径（会原样出现在日报的「数据口径」页）
 *   sources[] 结构化来源：每条 = { collection, timeField, filter, tz }
 *   caveat    已知局限（必须随数字一起展示，不许省略）
 *   phase     1 = 超管日报本次落地；2 = 扩展位（本次只登记口径，不出数）
 */
const METRICS = [
  // ── 一、小程序数据 ─────────────────────────────────────────────
  {
    id: 'mini_page_view',
    section: SECTIONS.MINIAPP,
    label: '页面浏览',
    unit: 'count',
    kind: 'analytics',
    action: 'page_view',
    isPrimary: true,
    source: 'analytics_daily 当日 page_view 的 count',
    sources: [
      {
        collection: 'analytics_daily',
        timeField: 'dateKey',
        filter: "action === 'page_view' && dateKey === <UTC 日>",
        tz: 'UTC 日（见本文件顶部实测说明）'
      }
    ],
    caveat: 'dateKey 是 UTC 日：北京时间 00:00–08:00 的行为会算进前一个 dateKey。',
    phase: 1
  },
  {
    id: 'mini_visitors',
    section: SECTIONS.MINIAPP,
    label: '访问人数',
    unit: 'count',
    kind: 'analytics',
    action: 'page_view',
    isPrimary: true,
    source: 'analytics_daily 当日 page_view 的 uv[] 去重人数',
    sources: [
      {
        collection: 'analytics_daily',
        timeField: 'dateKey',
        filter: "action === 'page_view' && dateKey === <UTC 日>，取 uv[] 长度",
        tz: 'UTC 日'
      }
    ],
    caveat: 'uv[] 是**按单个 action** 去重的 openid 列表，不是全天跨 action 去重 DAU；跨 action 汇总会偏高（getAnalyticsDashboard 自述，:981）。',
    phase: 1
  },
  {
    id: 'mini_app_launch',
    section: SECTIONS.MINIAPP,
    label: '启动次数',
    unit: 'count',
    kind: 'analytics',
    action: 'app_launch',
    source: 'analytics_daily 当日 app_launch 的 count',
    sources: [
      {
        collection: 'analytics_daily',
        timeField: 'dateKey',
        filter: "action === 'app_launch' && dateKey === <UTC 日>",
        tz: 'UTC 日'
      }
    ],
    caveat: '同 module 下的 app_launch 计数；不含非小程序入口的落地页。',
    phase: 1
  },
  {
    id: 'mini_product_view',
    section: SECTIONS.MINIAPP,
    label: '藏品浏览',
    unit: 'count',
    kind: 'analytics',
    action: 'product_view',
    isPrimary: true,
    source: 'analytics_daily 当日 product_view 的 count',
    sources: [
      {
        collection: 'analytics_daily',
        timeField: 'dateKey',
        filter: "action === 'product_view' && dateKey === <UTC 日>",
        tz: 'UTC 日'
      }
    ],
    caveat: '',
    phase: 1
  },
  {
    id: 'mini_add_cart',
    section: SECTIONS.MINIAPP,
    label: '加购',
    unit: 'count',
    kind: 'analytics',
    action: 'added',
    source: 'analytics_daily 当日 added 的 count（commerce 模块）',
    sources: [
      {
        collection: 'analytics_daily',
        timeField: 'dateKey',
        filter: "action === 'added' && dateKey === <UTC 日>",
        tz: 'UTC 日'
      }
    ],
    caveat: '当日无加购时该行不存在 —— 缺行即 0，不要当成「取数失败」。',
    phase: 1
  },
  {
    id: 'mini_register',
    section: SECTIONS.MINIAPP,
    label: '新注册',
    unit: 'count',
    kind: 'analytics',
    action: 'auth_register_success',
    source: 'analytics_daily 当日 auth_register_success 的 uv[] 去重人数',
    sources: [
      {
        collection: 'analytics_daily',
        timeField: 'dateKey',
        filter: "action === 'auth_register_success' && dateKey === <UTC 日>",
        tz: 'UTC 日'
      }
    ],
    caveat: '以埋点为准；与 users 集合按 createTime 数出来的新用户可能不同（未登录即浏览的访客不会在这里）。',
    phase: 1
  },

  // ── 二、订单数据 ───────────────────────────────────────────────
  {
    id: 'order_created',
    section: SECTIONS.ORDERS,
    label: '新下单',
    unit: 'order',
    kind: 'orderDay',
    orderField: 'createTime',
    isPrimary: true,
    source: 'orders.createTime 落在当日（东八日）的单数',
    sources: [
      {
        collection: 'orders',
        timeField: 'createTime',
        filter: '$dateToString(timezone=Asia/Shanghai) === <日>',
        tz: '东八日'
      }
    ],
    caveat: '含随后被取消/超时释出的单（= 下单量，不是成交量）。',
    phase: 1
  },
  {
    id: 'order_paid',
    section: SECTIONS.ORDERS,
    label: '支付单数',
    unit: 'order',
    kind: 'orderDay',
    orderField: 'paidTime',
    isPrimary: true,
    source: 'orders.paidTime 落在当日的单数',
    sources: [
      {
        collection: 'orders',
        timeField: 'paidTime',
        filter: '$dateToString(timezone=Asia/Shanghai) === <日>',
        tz: '东八日'
      }
    ],
    caveat: 'paidTime 是 2026-09 起新增字段（payCallback/confirmPayment 写入）；更早的历史单没有它，用 createTime 兜底（本函数不兜底，老单不会计入）。',
    phase: 1
  },
  {
    id: 'order_paid_fen',
    section: SECTIONS.ORDERS,
    label: '支付金额',
    unit: 'fen',
    kind: 'orderDay',
    orderField: 'paidTime',
    sumField: 'paymentBreakdown.totalFen',
    isPrimary: true,
    source: 'orders.paymentBreakdown.totalFen 按 paidTime 东八归日求和（**分**）',
    sources: [
      {
        collection: 'orders',
        timeField: 'paidTime',
        filter: '$dateToString(timezone=Asia/Shanghai) === <日>，$sum paymentBreakdown.totalFen',
        tz: '东八日'
      }
    ],
    caveat: '字段单位是**分**（`totalFen`），与 `totalPrice`（元/浮点）同名不同单位，禁止混用（错题本 E18/E21）。展示层统一 ÷100。',
    phase: 1
  },
  {
    id: 'order_shipped',
    section: SECTIONS.ORDERS,
    label: '发货单数',
    unit: 'order',
    kind: 'orderDay',
    orderField: 'logistics.shipTime',
    isPrimary: true,
    source: 'orders.logistics.shipTime 落在当日的单数',
    sources: [
      {
        collection: 'orders',
        timeField: 'logistics.shipTime',
        filter: '$dateToString(timezone=Asia/Shanghai) === <日>',
        tz: '东八日'
      }
    ],
    caveat: '发货时间是**嵌套字段** `logistics.shipTime`；顶层的 `orders.shipTime` 是现代码不再写的历史遗留字段，不要用它。',
    phase: 1
  },
  {
    id: 'order_refunded',
    section: SECTIONS.ORDERS,
    label: '退款单数',
    unit: 'order',
    kind: 'orderDay',
    orderField: 'refundTime',
    isPrimary: true,
    source: 'orders.refundTime 落在当日的单数',
    sources: [
      {
        collection: 'orders',
        timeField: 'refundTime',
        filter: '$dateToString(timezone=Asia/Shanghai) === <日>',
        tz: '东八日'
      }
    ],
    caveat: 'refunds 集合当前为空（实测 0 行），退款以 orders 上的 refundTime 为准。',
    phase: 1
  },
  {
    id: 'order_refunded_yuan',
    section: SECTIONS.ORDERS,
    label: '退款金额',
    unit: 'yuan',
    kind: 'orderDay',
    orderField: 'refundTime',
    sumField: 'refundAmount',
    source: 'orders.refundAmount 按 refundTime 东八归日求和（元）',
    sources: [
      {
        collection: 'orders',
        timeField: 'refundTime',
        filter: '$dateToString(timezone=Asia/Shanghai) === <日>，$sum refundAmount',
        tz: '东八日'
      }
    ],
    caveat: 'refundAmount 在实测样本里缺失（字段不存在时按 0 计）。这是**已知的弱口径**：金额以门店账本 refund 为准，本行只作笔数参考。',
    phase: 1
  },
  {
    id: 'order_paid_online_fen',
    section: SECTIONS.ORDERS,
    label: '线上支付金额',
    unit: 'fen',
    kind: 'orderDay',
    orderField: 'paidTime',
    sumField: 'paymentBreakdown.wxpayFen',
    source: 'orders.paymentBreakdown.wxpayFen 按 paidTime 东八归日求和（分，不含钱包余额抵扣）',
    sources: [
      {
        collection: 'orders',
        timeField: 'paidTime',
        filter: '$dateToString(timezone=Asia/Shanghai) === <日>，$sum paymentBreakdown.wxpayFen',
        tz: '东八日'
      }
    ],
    caveat: '钱包支付部分在 `walletPayFen`，本行不含；线上实收 = wxpayFen（+ 钱包抵扣若需口径另计）。',
    phase: 1
  },

  // ── 三、门店营收 ───────────────────────────────────────────────
  {
    id: 'store_revenue_yuan',
    section: SECTIONS.STORE,
    label: '门店营收',
    unit: 'yuan',
    kind: 'dateKeyed',
    sumField: 'total',
    isPrimary: true,
    source: 'daily_revenues.date === 当日 的 total 求和（按门店分行见 storeBreakdown）',
    sources: [
      {
        collection: 'daily_revenues',
        timeField: 'date',
        filter: "date === '<YYYY-MM-DD>'，$sum total",
        tz: '门店营业日（字符串，不换算）'
      }
    ],
    caveat: '**人工录入**（Admin 智能日报粘贴解析 / 店长「记一笔」）。当日未录入即无行 —— 日报会显式显示「未录入」，不会拿 0 冒充。',
    phase: 1
  },
  {
    id: 'store_ledger_pos_yuan',
    section: SECTIONS.STORE,
    label: '门店POS收款',
    unit: 'yuan',
    kind: 'dateKeyed',
    sumField: 'pos',
    isPrimary: true,
    source: 'store_ledger.date === 当日 的 pos 求和（银联 POS）',
    sources: [
      {
        collection: 'store_ledger',
        timeField: 'date',
        filter: "date === '<YYYY-MM-DD>'，$sum pos",
        tz: '门店营业日（字符串，不换算）'
      }
    ],
    caveat: '与 daily_revenues 是**同一次录入的两个落点**，两者可能不同步；并列展示而不是互相覆盖。',
    phase: 1
  },
  {
    id: 'store_ledger_offline_orders',
    section: SECTIONS.STORE,
    label: '门店POS单数',
    unit: 'order',
    kind: 'dateKeyed',
    sumField: 'orderCount',
    source: 'store_ledger.date === 当日 的 orderCount 求和',
    sources: [
      {
        collection: 'store_ledger',
        timeField: 'date',
        filter: "date === '<YYYY-MM-DD>'，$sum orderCount",
        tz: '门店营业日'
      }
    ],
    caveat: '门店自己记的 POS 单数，与小程序订单不是一回事，禁止相加。',
    phase: 1
  },
  {
    id: 'store_refund_yuan',
    section: SECTIONS.STORE,
    label: '门店退款',
    unit: 'yuan',
    kind: 'dateKeyed',
    sumField: 'refundAmount',
    source: 'store_ledger.date === 当日 的 refundAmount 求和',
    sources: [
      {
        collection: 'store_ledger',
        timeField: 'date',
        filter: "date === '<YYYY-MM-DD>'，$sum refundAmount",
        tz: '门店营业日'
      }
    ],
    caveat: '',
    phase: 1
  },
  {
    id: 'store_online_income_yuan',
    section: SECTIONS.STORE,
    label: '账本线上收入',
    unit: 'yuan',
    kind: 'dateKeyed',
    sumField: 'online',
    source: 'daily_revenues.date === 当日 的 online 求和',
    sources: [
      {
        collection: 'daily_revenues',
        timeField: 'date',
        filter: "date === '<YYYY-MM-DD>'，$sum online",
        tz: '门店营业日'
      }
    ],
    caveat: '录入口径的「线上」，与小程序的 order_paid_fen 是两套口径（后者是实时订单），禁止互相校验。',
    phase: 1
  },
  {
    id: 'studio_shipments',
    section: SECTIONS.STORE,
    label: '门店出货单',
    unit: 'order',
    kind: 'simpleDay',
    collection: 'ops_shipments',
    dayField: 'shipmentDate',
    source: 'ops_shipments.shipmentDate === 当日的行数（工作室出货）',
    sources: [
      {
        collection: 'ops_shipments',
        timeField: 'shipmentDate',
        filter: "shipmentDate === '<YYYY-MM-DD>'",
        tz: '门店营业日（写入时强校验格式）'
      }
    ],
    caveat: '出货日期由人工在工作室「出货单」填写，可回填/补录 —— 数字会随补录变化。',
    phase: 1
  },

  // ── 四、扩展位（本次只登记口径，不出数）────────────────────────
  {
    id: 'x_store_scoped_revenue',
    section: SECTIONS.STORE,
    label: '本店营收（店长切片）',
    unit: 'yuan',
    kind: 'dateKeyed',
    sumField: 'total',
    source: 'daily_revenues.date === 当日 且 storeId ∈ 该店员可操作门店',
    sources: [
      {
        collection: 'daily_revenues',
        timeField: 'date',
        filter: "date === '<YYYY-MM-DD>' && storeId in <actor.storeIds>",
        tz: '门店营业日'
      }
    ],
    caveat: '扩展位：店长日报按 staff_members.storeIds 裁剪（canOperateStore）。',
    phase: 2
  },
  {
    id: 'x_artisan_output',
    section: SECTIONS.STORE,
    label: '本人作品产出（标本师切片）',
    unit: 'order',
    kind: 'simpleDay',
    collection: 'ops_shipments',
    dayField: 'shipmentDate',
    source: 'ops_shipments.shipmentDate === 当日 且关联标本师 = 本人',
    sources: [
      {
        collection: 'ops_shipments',
        timeField: 'shipmentDate',
        filter: "shipmentDate === '<YYYY-MM-DD>' && artisanId === <本人>",
        tz: '门店营业日'
      }
    ],
    caveat: '扩展位：字段名待与工作室出货单核对后再实现，**本次不发车**。',
    phase: 2
  },
  {
    id: 'x_shareholder_slice',
    section: SECTIONS.STORE,
    label: '股东切片',
    unit: 'yuan',
    kind: 'dateKeyed',
    source: '复用 getShareholderObservatory 的周期口径（净额 → revenue → amount → total），不是 store_ledger.pos',
    sources: [
      {
        collection: 'store_ledger',
        timeField: 'date',
        filter: 'date ∈ [期初, 期末] && storeId in <占股门店>',
        tz: '门店营业日'
      }
    ],
    caveat: '扩展位：股东观测台口径与门店营收口径**不同**（审计：getShareholderObservatory ledgerRevenue），实现时必须独立成段，禁止与 store 段混算。',
    phase: 2
  }
]

/**
 * 「门店营收」按店分行的门店目录（2026-09-29 产品负责人：日报门店营收需要区分门店）。
 * 与 syncFinanceData/index.js 的 REPORT_STORES 同一份：MAIN_STORE_ALIAS_IDS 是 ERP 本地门店写入账本的
 * 山川造物历史 id（与 admin financeDayAggregate.LEGACY_MAIN_STORE_IDS 逐字一致）。第一项是主店：行没有 storeId 时一律归它（2026-09-29 产品负责人拍板，沿用 syncFinanceData 惯例）。
 */
const MAIN_STORE_ALIAS_IDS = [
  'store_1780146782017_6w0okpr',
  'store_1780160394767_szo1k77',
  'store_1780841157244_p48w0bx'
]
const REPORT_STORES = [
  { storeId: 'store_shanhaizaowu', name: '山川造物', aliases: MAIN_STORE_ALIAS_IDS },
  { storeId: 'store_xingchen', name: '星宸标本', aliases: [] }
]

/** 每个角色能看哪些 section + 哪些指标（扩展位的开关点）；storeBreakdown = 能看全部门店的按店分行 */
const ROLE_SLICES = {
  [ROLES.SUPER_ADMIN]: {
    label: '超管日报',
    sections: [SECTIONS.MINIAPP, SECTIONS.ORDERS, SECTIONS.STORE],
    metrics: METRICS.filter((m) => m.phase === 1).map((m) => m.id),
    storeBreakdown: true
  },
  [ROLES.STORE_MANAGER]: {
    label: '店长日报',
    sections: [SECTIONS.ORDERS, SECTIONS.STORE],
    metrics: ['order_created', 'order_paid', 'order_shipped', 'order_refunded', 'store_ledger_pos_yuan', 'store_ledger_offline_orders', 'x_store_scoped_revenue'],
    enabled: false
  },
  [ROLES.STORE_STAFF]: {
    label: '店员日报',
    sections: [SECTIONS.STORE],
    metrics: ['store_ledger_offline_orders'],
    enabled: false
  },
  [ROLES.SPECIMEN_ARTISAN]: {
    label: '标本师日报',
    sections: [SECTIONS.STORE],
    metrics: ['x_artisan_output'],
    enabled: false
  },
  [ROLES.LIVE_HOST]: {
    label: '主播日报',
    sections: [SECTIONS.MINIAPP],
    metrics: ['mini_page_view', 'mini_visitors'],
    enabled: false
  },
  [ROLES.SHAREHOLDER]: {
    label: '股东日报',
    sections: [SECTIONS.STORE],
    metrics: ['x_shareholder_slice'],
    enabled: false
  },
  [ROLES.INVESTOR]: {
    label: '投资人日报',
    sections: [SECTIONS.STORE, SECTIONS.ORDERS],
    metrics: ['store_revenue_yuan', 'store_ledger_pos_yuan', 'order_paid_fen'],
    enabled: false
  }
}

/** 本次真正出数的角色。加角色 = 把 `enabled` 改 true 并补实现，不改架构。 */
const ENABLED_ROLES = Object.keys(ROLE_SLICES).filter((r) => ROLE_SLICES[r].enabled !== false)

/** 保留天数：日报要可回看。定时任务按此在写完后清理更早的日报消息。 */
const RETENTION_DAYS = 90

const MESSAGE_TYPE = 'daily_digest'
const MESSAGE_CATEGORY = 'digest'
const MESSAGE_QUEUE = 'workflow'

module.exports = {
  ROLES,
  SECTIONS,
  QUERY_KINDS,
  METRICS,
  ROLE_SLICES,
  REPORT_STORES,
  ENABLED_ROLES,
  RETENTION_DAYS,
  MESSAGE_TYPE,
  MESSAGE_CATEGORY,
  MESSAGE_QUEUE,
  reportCatalog
}

function reportCatalog () {
  return {
    sections: Object.values(SECTIONS),
    kinds: QUERY_KINDS.slice(),
    metrics: METRICS.map((m) => ({
      id: m.id,
      section: m.section,
      label: m.label,
      unit: m.unit,
      kind: m.kind,
      phase: m.phase,
      source: m.source,
      sources: (m.sources || []).map((s) => ({ ...s })),
      caveat: m.caveat || ''
    })),
    roles: Object.keys(ROLE_SLICES).map((r) => ({
      role: r,
      label: ROLE_SLICES[r].label,
      sections: (ROLE_SLICES[r].sections || []).slice(),
      metrics: (ROLE_SLICES[r].metrics || []).slice(),
      enabled: ROLE_SLICES[r].enabled !== false
    })),
    enabledRoles: ENABLED_ROLES.slice(),
    retentionDays: RETENTION_DAYS,
    message: { type: MESSAGE_TYPE, category: MESSAGE_CATEGORY, queue: MESSAGE_QUEUE }
  }
}
