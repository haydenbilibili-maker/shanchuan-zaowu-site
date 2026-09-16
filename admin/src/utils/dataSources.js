/**
 * 数据源单一事实来源（SSOT）声明
 *
 * 目的（2026-09-16 产品负责人指令：「全面核查数据口径、数据获取，保证 ERP 各页面的
 * 数据源唯一有效，展示合理」）：把「每个业务概念的权威数据源是谁」写死成一份可核对、
 * 可守卫的声明，而不是散落在各页面里靠人记。
 *
 * 这份表**不是文档，是被守卫的契约** —— `npm run report:data-sources --strict` 会断言：
 *   ① 代码里出现的每一个数据源（集合 / 云函数 / localStorage 键 / 本地存储模块）
 *      都必须在这里被**分类**过（D1）。分类是「有意识的决定」，未分类即失败 ——
 *      因为未分类的数据源正是「同一个概念冒出第二个来源」的温床。
 *   ② 权威源唯一：一个概念只能有一个 `authority`（D2）。
 *   ③ 权威源在本地的概念会被单独列出（D3），因为它们**不跨设备/不跨人**，
 *      而云端往往已经有同一概念的另一份数据。
 *
 * 三条发现来自本轮实测（浏览器里逐页量出来的），记录在这里以免被重新踩：
 *
 * 1. **营收/订单口径分歧**：经营驾驶舱（module 0）用 `getAnalyticsDashboard` **全量**口径，
 *    运营决策中心（module 25）用 `storeData` 的 `orders(limit:500)` 采样 + 本地财务账本。
 *    实测同一环境：驾驶舱读全量云口径，决策中心显示「本月营收 ¥0（财务账本）」「0 家门店」。
 * 2. **门店双权威**：`stores`/`store_zones` 集合（小程序 `manageStoreConfig` 写）与
 *    本地 `sc_store_bundle_v1`（7 个页面读）并存 → 决策中心显示 0 家门店，而云端有店。
 * 3. **财务账本本地化**：`shanhai_v12` 是本机 localStorage，而 `finance_records`/
 *    `store_ledger` 由小程序 `syncFinanceData` 写入云端 → 两边都可能各有一份。
 *
 * 角色（role）定义：
 *   authority  该概念的权威**数据持有者**（一个概念可以有多个：如门店 = stores + store_zones）
 *   channel    写入通道（云函数）。**不是**权威源 —— 它与集合是「同一份事实的读写两面」，
 *              把它也算作 authority 会造成「一个概念两个权威」的假冲突（初版就踩了这个坑）
 *   derived    由权威源派生/聚合（可重算，丢了不影响事实）
 *   mirror     权威源的本地副本（只读回显用；**不得**被当作事实读回业务逻辑）
 *   ui-state   纯界面/会话状态，不承载业务事实
 *   local-only 仅存于本机、云端尚无对应物的业务数据（**风险**：不跨设备、换浏览器即丢）
 *   legacy     已废弃但仍被兼容读取的旧源
 */

/** @typedef {'authority'|'derived'|'mirror'|'ui-state'|'local-only'|'legacy'} SourceRole */

/**
 * 业务概念 → 权威源。
 * `divergent` 列出**已知的、非权威的**同义源，供展示层如实标注来源。
 */
export const CONCEPTS = [
  {
    key: 'products',
    label: '藏品 / SKU',
    authority: { kind: 'collection', name: 'products' },
    writeVia: 'manageProducts',
    divergent: [],
    note: '小程序与 ERP 共用 manageProducts；批量/库存/归档旁路直写属历史债（审计 P0-5）。',
  },
  {
    key: 'categories',
    label: '分类',
    authority: { kind: 'collection', name: 'categories' },
    writeVia: 'manageStoreContent',
    divergent: [],
    note: 'categories 为 write:false，写必须经 manageStoreContent；小程序只新增/删除。',
  },
  {
    key: 'orders',
    label: '订单',
    authority: { kind: 'collection', name: 'orders' },
    writeVia: 'managerShipOrder / refundOrder / confirmPayment',
    divergent: [],
    note: 'ERP 直写 orders 会被规则拒绝（审计 P0-5）；状态变更一律走云函数。',
  },
  {
    key: 'order_metrics',
    label: '营收 / 订单口径指标',
    authority: { kind: 'function', name: 'getAnalyticsDashboard' },
    divergent: [],
    note: '**全量**口径。`storeData` 的 orders(limit:500) 是采样，只可用于列表展示，不可用于指标。',
  },
  {
    key: 'refunds',
    label: '退款',
    authority: { kind: 'collection', name: 'refunds' },
    writeVia: 'refundOrder',
    divergent: [],
    note: 'ERP 无直写路径（审计 P0-6/P0-8）；批准/拒绝须走 refundOrder 的 staff* action。',
  },
  {
    key: 'members',
    label: '会员 / 用户',
    authority: { kind: 'collection', name: 'users' },
    writeVia: 'manageMemberCrm / upsertUserProfile',
    divergent: [],
    note: 'users 为 write:false，ERP 写必须经云函数。',
  },
  {
    key: 'points',
    label: '积分',
    // 积分的**持有者**就是 users 集合，权威字段是 bonusPoints（不是 users.points）；
    // 与 members 共用同一持有者，故显式声明，避免被「一个集合只能属于一个概念」误判。
    authority: { kind: 'collection', name: 'users' },
    sharedAuthorityWith: 'members',
    authoritativeField: 'bonusPoints',
    writeVia: 'manageMemberCrm(adjustPoints) / earnPoints',
    divergent: [],
    note: '权威余额是 bonusPoints（见 functions/_lib/cloudbaseCallFn.mjs 的注释）；台账为 point_records。'
      + '⚠ ERP 内同时存在 users.points 字段，与 bonusPoints 是两个口径，展示时必须写明是哪一个。',
  },
  {
    key: 'store_point_rules',
    label: '门店积分规则',
    authority: { kind: 'collection', name: 'store_point_rules' },
    writeVia: 'getStorePointRules',
    divergent: [],
    note: '与小程序超管工作台共用同一 SSOT 与写入逻辑（含审批队列）。',
  },
  {
    key: 'stores',
    label: '门店 / 展区',
    authority: { kind: 'collection', name: 'stores' },
    writeVia: 'manageStoreConfig',
    divergent: ['localStorage:sc_store_bundle_v1'],
    coAuthorities: [{ kind: 'collection', name: 'store_zones' }],
    note: '⚠ 双权威：本地 bundle 被 7 个页面读取且不跨设备，而云端 stores 才是 C 端与小程序的事实源。'
      + '决策中心实测因此显示「0 家门店」，而云端有店。',
  },
  {
    key: 'staff',
    label: '员工 / 权限',
    authority: { kind: 'collection', name: 'staff_members' },
    writeVia: 'manageStaff',
    divergent: [],
    note: '小程序超管工作台「员工」模块同源（staff-directory 头部即写明「聚合 staff_members」）。'
      + 'staff_members 规则为 {read:false,write:false}，浏览器必须经云函数代理。',
  },
  {
    key: 'payroll_roster',
    label: '薪酬花名册（HR 档案）',
    authority: { kind: 'storage', name: 'payrollStorage' },
    writeVia: 'payrollStorage',
    divergent: [],
    note: '⚠ 本地权威：与「员工/权限」(staff_members) **是不同概念**（HR 档案 vs 小程序账号），'
      + '但只存本机、不跨设备。展示时必须标注「本地 HR 花名册」，不得与员工数混为一谈。',
  },
  {
    key: 'store_bundle',
    label: '门店本地包（ERP 档案副本）',
    authority: { kind: 'storage', name: 'storeStorage' },
    writeVia: 'storeStorage',
    divergent: [],
    note: '⚠ 本地权威且与 stores 集合概念重叠，见 stores 条目。',
  },
  {
    key: 'finance_records',
    label: '财务账本',
    authority: { kind: 'collection', name: 'finance_records' },
    writeVia: 'syncFinanceData（小程序）',
    divergent: ['localStorage:shanhai_v12'],
    note: '⚠ 双权威：ERP 的 Finance 页读本机 shanhai_v12，而云端由小程序 syncFinanceData 写入。'
      + 'ERP 直写 finance_records 会被规则拒绝（审计 P0-5）。',
  },
  {
    key: 'finance_settings',
    label: '财务参数（成本率 / 月薪等）',
    authority: { kind: 'local', name: 'sc_finance_v12' },
    writeVia: 'Finance.vue',
    divergent: ['localStorage:sc_finance_settings_v1'],
    note: '⚠ 两个键：sc_finance_v12.settings 被 financialData/staffOptimizeAI 当事实读；'
      + 'sc_finance_settings_v1 是 Finance.vue 写并**回填表单**的镜像 —— 镜像过期会把旧值填回界面。',
  },
  {
    key: 'content',
    label: '内容（文章 / 百科）',
    authority: { kind: 'collection', name: 'articles' },
    writeVia: 'manageStoreContent',
    divergent: [],
    coAuthorities: [{ kind: 'collection', name: 'care_guides' }],
    note: 'articles/cms_wikis 为 write:false；双端同写同一 SSOT。',
  },
  {
    key: 'content_factory',
    label: '内容工厂',
    authority: { kind: 'collection', name: 'content_pieces' },
    writeVia: 'cdnUpsert*（contentDb）',
    divergent: [],
    note: 'content_topics/assets/pieces/reviews/analytics 一组；ERP 为唯一写入方。',
  },
  {
    key: 'bookings',
    label: '预约',
    authority: { kind: 'collection', name: 'store_booking_rules' },
    writeVia: '小程序',
    divergent: ['collection:bookings'],
    note: '⚠ `bookings` 是线上 write:false 的死 schema（写入必失败，审计 P0-5），'
      + '权威规则在 store_booking_rules。',
  },
  {
    key: 'support',
    label: '工单 / 客服',
    authority: { kind: 'collection', name: 'support_tickets' },
    writeVia: '（线上 write:false → 待接代理）',
    divergent: [],
    coAuthorities: [{ kind: 'collection', name: 'support_configs' }],
    note: 'support_tickets 线上 write:false，ERP 直写必失败（审计 P0-5），需部署后接代理。',
  },
  {
    key: 'gift',
    label: '礼赠',
    authority: { kind: 'collection', name: 'gift_settings' },
    writeVia: 'manageGift',
    divergent: [],
    note: '小程序与 ERP 同源；礼赠履约看板读 gift_contacts/gift_dates。',
  },
  {
    key: 'fulfillment',
    label: '订货履约',
    authority: { kind: 'collection', name: 'ops_purchases' },
    writeVia: 'managePurchaseOrder / manageStoreShipment',
    divergent: ['collection:feishu_purchases', 'collection:feishu_shipments'],
    coAuthorities: [{ kind: 'collection', name: 'ops_shipments' }],
    note: 'feishu_* 是飞书镜像（derived）；ops_* 才是账本 SSOT。',
  },
  {
    key: 'analytics',
    label: '行为 / 经营分析',
    authority: { kind: 'collection', name: 'analytics_daily' },
    writeVia: '小程序',
    divergent: ['collection:user_behaviors'],
    note: 'analytics_daily 是聚合（derived）；user_behaviors 是明细。',
  },
  {
    key: 'generic_config',
    label: '通用配置（键值文档）',
    authority: { kind: 'collection', name: 'configs' },
    writeVia: 'cdnUpsertSingleton / manageStoreContent',
    divergent: [],
    note: '键值型集合，各页面按 docId 读写自己的配置文档；与 home_configs（首页专表）不是同一概念。',
  },
  {
    key: 'product_concept_draft',
    label: '爆品概念草稿',
    authority: { kind: 'storage', name: 'productConcept(STORAGE_KEY)' },
    writeVia: 'productConceptStorage',
    divergent: [],
    note: '⚠ 本地权威：新品概念金字塔的草稿只存本机；另有跨模块桥接键 local:sc_product_concept_for_strategy。',
  },
  {
    key: 'home_config',
    label: '首页配置',
    authority: { kind: 'collection', name: 'home_configs' },
    writeVia: 'manageStoreContent',
    divergent: [],
    note: '线上 home_configs 曾是 auth!=null 可写（审计 P0-11 相邻项），仓库规则 write:false。',
  },
]

/** 概念快查 */
export const CONCEPT_BY_KEY = CONCEPTS.reduce((m, c) => ((m[c.key] = c), m), {})

/** 权威源标识串，便于比对：`collection:products` / `function:manageStaff` / `local:shanhai_v12` */
export function sourceId(src) {
  return src ? `${src.kind}:${src.name}` : ''
}

/**
 * 数据源登记表：**代码里出现的每一个源都必须在这里出现**（D1 守卫的依据）。
 * 键为 `collection:<name>` / `function:<name>` / `local:<key>` / `storage:<module>`。
 * @type {Record<string, { concept: string, role: SourceRole, confidence?: 'high'|'medium', note?: string }>}
 */
export const SOURCE_REGISTRY = {
  // ── 集合 ──────────────────────────────────────────────────────────────
  'collection:products': { concept: 'products', role: 'authority', confidence: 'high' },
  'collection:categories': { concept: 'categories', role: 'authority', confidence: 'high' },
  'collection:orders': { concept: 'orders', role: 'authority', confidence: 'high' },
  'collection:refunds': { concept: 'refunds', role: 'authority', confidence: 'high' },
  'collection:users': { concept: 'members', role: 'authority', confidence: 'high' },
  'collection:point_records': { concept: 'points', role: 'derived', confidence: 'high', note: '积分台账（明细），余额权威在 users.bonusPoints' },
  'collection:staff_members': { concept: 'staff', role: 'authority', confidence: 'high', note: '规则 {read:false,write:false}，浏览器必须经 manageStaff 代理' },
  'collection:store_point_rules': { concept: 'store_point_rules', role: 'authority', confidence: 'high' },
  'collection:stores': { concept: 'stores', role: 'authority', confidence: 'high' },
  'collection:store_zones': { concept: 'stores', role: 'authority', confidence: 'high' },
  'collection:finance_records': { concept: 'finance_records', role: 'authority', confidence: 'medium' },
  'collection:articles': { concept: 'content', role: 'authority', confidence: 'high' },
  'collection:care_guides': { concept: 'content', role: 'authority', confidence: 'medium' },
  'collection:custom_drafts': { concept: 'content_factory', role: 'derived', confidence: 'low', note: '待确认归属：内容工厂草稿 or 定制草稿' },
  'collection:content_pieces': { concept: 'content_factory', role: 'authority', confidence: 'high' },
  'collection:configs': { concept: 'generic_config', role: 'authority', confidence: 'medium', note: '通用配置文档集合（键值型），各页面按 docId 读取' },
  'collection:store_booking_rules': { concept: 'bookings', role: 'authority', confidence: 'medium' },
  'collection:bookings': { concept: 'bookings', role: 'legacy', confidence: 'high', note: '线上 write:false，写入必失败（审计 P0-5）' },
  'collection:support_tickets': { concept: 'support', role: 'authority', confidence: 'high' },
  'collection:support_configs': { concept: 'support', role: 'authority', confidence: 'medium' },
  'collection:gift_settings': { concept: 'gift', role: 'authority', confidence: 'medium' },
  'collection:ops_purchases': { concept: 'fulfillment', role: 'authority', confidence: 'high' },
  'collection:ops_shipments': { concept: 'fulfillment', role: 'authority', confidence: 'high' },
  'collection:feishu_purchases': { concept: 'fulfillment', role: 'derived', confidence: 'high', note: '飞书镜像' },
  'collection:feishu_shipments': { concept: 'fulfillment', role: 'derived', confidence: 'high', note: '飞书镜像；线上集合不存在（审计已记）' },
  'collection:analytics_daily': { concept: 'analytics', role: 'authority', confidence: 'high' },
  'collection:user_behaviors': { concept: 'analytics', role: 'derived', confidence: 'medium', note: '明细埋点' },
  'collection:home_configs': { concept: 'home_config', role: 'authority', confidence: 'high' },
  'collection:activities': { concept: 'home_config', role: 'derived', confidence: 'low', note: '营销活动，与首页配置同组待细分' },
  'collection:rewards': { concept: 'home_config', role: 'derived', confidence: 'low', note: '积分兑换品，待细分概念' },
  'collection:framers': { concept: 'home_config', role: 'derived', confidence: 'low', note: '标本师，待细分概念' },
  'collection:marketing_rules_config': { concept: 'home_config', role: 'derived', confidence: 'low', note: '营销规则配置，待细分概念' },
  'collection:recommend_algorithm_config': { concept: 'home_config', role: 'derived', confidence: 'low', note: '算法配置，待细分概念' },
  'collection:achievement_configs': { concept: 'home_config', role: 'derived', confidence: 'low', note: '成就配置，待细分概念' },
  'collection:search_hot_keywords': { concept: 'home_config', role: 'derived', confidence: 'low' },
  'collection:search_blacklist': { concept: 'home_config', role: 'derived', confidence: 'low' },
  'collection:notification_logs': { concept: 'support', role: 'derived', confidence: 'low', note: '通知日志，待细分概念' },
  'collection:admin_roles': { concept: 'staff', role: 'local-only', confidence: 'medium', note: '⚠ 全仓无消费方（审计 P0-4），属死数据' },
  'collection:admin_users': { concept: 'staff', role: 'local-only', confidence: 'medium', note: '⚠ 全仓无消费方（审计 P0-4）' },
  'collection:admin_operation_logs': { concept: 'staff', role: 'derived', confidence: 'low' },
  'collection:admin_login_logs': { concept: 'staff', role: 'derived', confidence: 'low' },
  'collection:audience_campaigns': { concept: 'members', role: 'local-only', confidence: 'medium', note: '线上存在且 auth!=null 可读写但无仓库规则（审计 P0-11）' },
  'collection:user_audiences': { concept: 'members', role: 'local-only', confidence: 'medium', note: '同上' },
  'collection:property_proposals': { concept: 'stores', role: 'local-only', confidence: 'medium', note: '同上（物业测算提案）' },
  'collection:waitlist': { concept: 'members', role: 'derived', confidence: 'low', note: '候补名单' },
  'collection:pet_memorial_orders': { concept: 'orders', role: 'derived', confidence: 'medium', note: '伴宠记忆订单（独立业务线）' },
  'collection:pet_craft_configs': { concept: 'products', role: 'derived', confidence: 'low', note: '伴宠工艺配置' },
  'collection:custom_inquiries': { concept: 'content_factory', role: 'derived', confidence: 'low', note: '定制询单，待细分概念' },
  'collection:report_templates': { concept: 'analytics', role: 'local-only', confidence: 'medium', note: '报表模板；线上 auth!=null 且无仓库规则（审计 P0-11）' },

  // ── 云函数（写入通道即权威通道）──────────────────────────────────────
  'function:manageProducts': { concept: 'products', role: 'channel', confidence: 'high' },
  'function:manageStoreContent': { concept: 'content', role: 'channel', confidence: 'high' },
  'function:manageStoreConfig': { concept: 'stores', role: 'channel', confidence: 'high' },
  'function:manageStaff': { concept: 'staff', role: 'channel', confidence: 'high' },
  'function:getStorePointRules': { concept: 'store_point_rules', role: 'channel', confidence: 'high' },
  'function:manageMemberCrm': { concept: 'members', role: 'channel', confidence: 'high' },
  'function:getAnalyticsDashboard': { concept: 'order_metrics', role: 'authority', confidence: 'high', note: '指标是算出来的，权威就是这个计算口径本身' },
  'function:managerShipOrder': { concept: 'orders', role: 'channel', confidence: 'high' },
  'function:refundOrder': { concept: 'refunds', role: 'channel', confidence: 'high' },
  'function:confirmPayment': { concept: 'orders', role: 'channel', confidence: 'medium', note: '支付补履约' },
  'function:getShippingRules': { concept: 'orders', role: 'derived', confidence: 'medium' },
  'function:manageGift': { concept: 'gift', role: 'channel', confidence: 'high' },
  'function:manageDeposit': { concept: 'orders', role: 'derived', confidence: 'medium', note: '定金' },
  'function:manageApprovals': { concept: 'staff', role: 'derived', confidence: 'medium' },
  'function:manageArtisanCommission': { concept: 'payroll_roster', role: 'derived', confidence: 'medium' },
  'function:manageBirthdayGift': { concept: 'gift', role: 'derived', confidence: 'medium' },
  'function:manageStoredValue': { concept: 'members', role: 'derived', confidence: 'medium', note: '储值钱包' },
  'function:assistProductCopy': { concept: 'products', role: 'derived', confidence: 'medium', note: 'AI 文案，不写业务事实' },
  'function:seedCategories': { concept: 'categories', role: 'derived', confidence: 'medium' },

  // ── localStorage ─────────────────────────────────────────────────────
  'local:shanhai_v12': { concept: 'finance_records', role: 'mirror', confidence: 'high', note: '⚠ 被当作事实读（Finance 页）' },
  'local:sc_finance_v12': { concept: 'finance_settings', role: 'authority', confidence: 'high' },
  'local:sc_finance_settings_v1': { concept: 'finance_settings', role: 'mirror', confidence: 'high', note: 'Finance.vue 回填表单用，过期即回填旧值' },
  'local:sc_admin_token': { concept: 'staff', role: 'ui-state', confidence: 'high', note: '口令门禁 token（审计 P0-2：前端假登录）' },
  'local:ai_api_configs': { concept: 'analytics', role: 'ui-state', confidence: 'medium', note: 'AI Key 配置，非业务事实' },
  'local:ai_current_api_config_id': { concept: 'analytics', role: 'ui-state', confidence: 'medium' },
  'local:ai_today_usage': { concept: 'analytics', role: 'ui-state', confidence: 'medium' },
  'local:ai_center_pending_feature': { concept: 'analytics', role: 'ui-state', confidence: 'medium' },
  'local:sc_product_concept_for_strategy': { concept: 'product_concept_draft', role: 'ui-state', confidence: 'medium', note: '与策略调研的跨模块桥接' },
  'local:realtimeMonitorSettings': { concept: 'analytics', role: 'ui-state', confidence: 'medium' },
  'local:robot_conversation_history': { concept: 'support', role: 'ui-state', confidence: 'medium' },
  'local:robot_user_preferences': { concept: 'support', role: 'ui-state', confidence: 'medium' },
  'local:robot_reminders': { concept: 'support', role: 'ui-state', confidence: 'medium' },
  'local:robot_achievements': { concept: 'support', role: 'ui-state', confidence: 'medium' },

  // ── 本地存储模块（封装后的 local: 键）──────────────────────────────────
  'storage:storeStorage': { concept: 'store_bundle', role: 'authority', confidence: 'high' },
  'storage:payrollStorage': { concept: 'payroll_roster', role: 'authority', confidence: 'high' },
  'storage:productConcept(STORAGE_KEY)': { concept: 'product_concept_draft', role: 'authority', confidence: 'medium' },
  'storage:safeStorage': { concept: 'analytics', role: 'ui-state', confidence: 'high', note: '通用安全读写封装，本身不定义数据源' },
}

/**
 * 已知的**口径分歧**（同一概念被不同页面从不同源读 → 数字对不上）。
 * 由人工确认后登记；工具会核对「声称的源」确实出现在对应页面代码里。
 */
export const METRIC_DIVERGENCES = [
  {
    concept: 'order_metrics',
    label: '营收 / 订单数',
    pages: [
      { module: '0', page: 'Dashboard.vue', source: 'function:getAnalyticsDashboard', scope: '全量' },
      { module: '25', page: 'OperationsDecisionCenter.vue', source: 'collection:orders', scope: '采样 500' },
    ],
    status: 'open',
    note: '实测同一环境：驾驶舱读全量云口径；决策中心走 storeData 的 500 单采样 + 本地账本，显示 ¥0/0 单。',
  },
  {
    concept: 'stores',
    label: '门店数',
    pages: [
      { module: '25', page: 'OperationsDecisionCenter.vue', source: 'local:sc_store_bundle_v1', scope: '本机' },
      { module: '30', page: 'StoreManagement.vue', source: 'collection:stores', scope: '云端' },
    ],
    status: 'open',
    note: '实测决策中心显示「0 家门店」，而云端有店（驾驶舱注记「山川造物 + 星宸标本双店」）。',
  },
]

/**
 * 概念的完整权威持有者集合（含 coAuthorities）。
 * 用集合而非单值：门店 = stores + store_zones，内容 = articles + care_guides，
 * 履约 = ops_purchases + ops_shipments —— 它们本就是「一个概念的几张表」，不是两个事实源。
 */
export function authoritySetOf(concept) {
  const list = [concept.authority, ...(concept.coAuthorities || [])]
  return list.map((a) => `${a.kind}:${a.name}`)
}

/** 权威源在本地（不跨设备）的概念 —— 展示层必须如实标注，否则会被误当云端事实 */
export function localAuthorityConcepts() {
  // `storage:x` 模块与 `local:<key>` 是同一件事的两种写法（模块只是键的访问器），
  // 都是「只存本机」，都必须被 D3 列出。
  return CONCEPTS.filter((c) => c.authority.kind === 'local' || c.authority.kind === 'storage')
}

/** 声明了分歧源的概念 */
export function conceptsWithDivergence() {
  return CONCEPTS.filter((c) => (c.divergent || []).length > 0)
}
