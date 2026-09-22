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
    // storage 模块与 local:<key> 是**同一份事实的两种写法**（模块只是键的访问器），
    // 不是两个权威 —— 显式列成 coAuthorities，D2 才不会被这两种写法判成冲突。
    coAuthorities: [{ kind: 'local', name: 'sc_payroll_bundle_v1' }],
    writeVia: 'payrollStorage',
    divergent: [],
    note: '⚠ 本地权威：与「员工/权限」(staff_members) **是不同概念**（HR 档案 vs 小程序账号），'
      + '但只存本机、不跨设备。展示时必须标注「本地 HR 花名册」，不得与员工数混为一谈。',
  },
  {
    key: 'store_bundle',
    label: '门店本地包（ERP 档案副本）',
    authority: { kind: 'storage', name: 'storeStorage' },
    coAuthorities: [{ kind: 'local', name: 'sc_store_bundle_v1' }],
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
    note: '已修（2026-09-16）：原先 Finance.vue 表单只写 sc_finance_settings_v1，'
      + '而**没有任何业务逻辑读它** —— 计算读 sc_finance_v12.settings（仅由 financeSync 云端合并写入），'
      + '于是「用户在界面上改的成本率从未生效」，计算一直用 normalizeCostRate(undefined) 的 25% 兜底，'
      + '界面却写着「按财务设置成本率」。现在表单同时写权威键（含 _raw 供回填），'
      + 'restoreSettings 优先读权威键、旧键仅作一次性迁移。',
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
    label: '预约记录',
    // 记录与规则是**两个概念**，初版把它们混成一个（把 bookings 当 legacy、把规则当记录权威），
    // 那是建模错误：bookings 就是预约记录的事实源，只是**写通道**不在 ERP 手里。
    authority: { kind: 'collection', name: 'bookings' },
    writeVia: 'updateBooking / verifyBooking / cancelBooking（小程序云函数；未接入 ERP 代理）',
    divergent: [],
    note: '⚠ `bookings` 规则为 {read:"auth != null", write:false} → ERP **可读不可写**；'
      + '权威写通道是云函数，且不在前端代理白名单内。因此 ERP 预约页的确认/取消/核销'
      + '目前**没有任何可用通道**，已改为「明确报错 + 前置横幅告知」（见 C.3 待部署接通道）。',
  },
  {
    key: 'booking_rules',
    label: '预约规则（时段/人数等配置）',
    authority: { kind: 'collection', name: 'store_booking_rules' },
    writeVia: '小程序',
    divergent: [],
    note: '规则为 {read:false, write:false} → ERP 读不到也用不到；由小程序维护。'
      + 'ERP 若将来要展示规则，需先接服务端读取通道。',
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
    key: 'studio_pricing',
    label: '工作室结算价目',
    authority: { kind: 'collection', name: 'studio_material_prices' },
    writeVia: 'manageStudioSettlement',
    coAuthorities: [{ kind: 'collection', name: 'studio_packaging_prices' }],
    divergent: [],
    note: '出货算价的两个价目本（材料价 + 包装价），同一写入口、写权限仅超管。与 custom_configs 的 C 端定制加价语义相反，勿混用。',
  },
  {
    key: 'studio_settlement',
    label: '工作室结算台账',
    authority: { kind: 'collection', name: 'ops_settlement_bills' },
    writeVia: 'manageStudioSettlement',
    divergent: [],
    note: '门店→工作室货款账单。**结算唯一权威**：出货单的 settleStatus 是派生字段，只有账单流程能写。',
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
    key: 'product_taxonomy',
    label: '装裱方式 / 制作工艺字典',
    authority: { kind: 'collection', name: 'product_taxonomy' },
    writeVia: 'getProductTaxonomy（action:save，仅超管）',
    divergent: [],
    note:
      '单文档字典（装裱方式 craftTypes / 制作工艺 craftProcesses）。**代码里的默认清单是兜底、不是权威**：' +
      '`miniprogram/config/productTaxonomy.js` 与 `admin/src/App.vue` 各持一份与对方逐字一致的默认表（守卫 ' +
      '`check:product-fields-entry` ⑤-h 钉住），云端有文档时**由云端覆写**（`集合 → 覆写层 → 代码默认`）。' +
      '两端都必须经 `function:getProductTaxonomy` 取，不许各自维护第三份清单。',
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
  // ── 以下 4 个概念是**本轮补的**：此前把它们各自的权威集合错挂到了别的概念上
  //    （如 report_templates 挂给 analytics），于是 D5 把「读自己的权威」误报成「读非权威源」。
  //    核对依据：这三个集合在 ERP 里都是**完整 CRUD**（增/改/删/查），即它们就是自己那件事的
  //    权威持有者，不是任何别的概念的副本。
  {
    key: 'report_templates',
    label: '报表模板',
    authority: { kind: 'collection', name: 'report_templates' },
    divergent: [],
    note: 'CustomReportBuilder.vue 增删改查。**模板**是自有实体，与 `analytics`（分析结果）不是一回事。'
      + '线上 auth!=null 可读写且无仓库规则（审计 P0-11，待收紧）。',
  },
  {
    key: 'property_proposals',
    label: '物业测算提案',
    authority: { kind: 'collection', name: 'property_proposals' },
    divergent: ['localStorage:sc_property_proposals_v3'],
    note: 'PropertyEval.vue 增改查（另有本机草稿键 sc_property_proposals_v3）。'
      + '**提案**是自有实体，不是 `stores`（门店主数据）的副本。线上 auth!=null 可读写且无仓库规则。',
  },
  {
    key: 'user_audiences',
    label: '人群圈选（受众包）',
    authority: { kind: 'collection', name: 'user_audiences' },
    divergent: [],
    note: 'AudienceManager.vue 增删改查。**圈选规则**是自有实体；它引用 `users` 但不等同于 `users`。'
      + '线上 auth!=null 可读写且无仓库规则（审计 P0-11）。',
  },
  {
    key: 'admin_permission_records',
    label: '后台角色 / 账号分配记录（不参与鉴权）',
    authority: { kind: 'collection', name: 'admin_roles' },
    coAuthorities: [{ kind: 'collection', name: 'admin_users' }],
    divergent: [],
    note: '⚠ **本概念不决定任何权限**：服务端 staffGuard 判的是 `staff_members` / `workspace_acl`，'
      + '写这两个集合不会改变任何人的权限。PermissionManager.vue 只读展示它们。'
      + '之所以单列成概念，是因为 D5 原先把它当成「读 staff 的非权威副本」——'
      + '而它其实是一张**独立的、装饰性的**记录表，权威就是它自己。'
      + '审计 P0-4 原称「全仓无任何消费方」，说法不准确（页面在只读展示），结论不变（不参与鉴权）。',
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
  // 本集合此前**未被登记**（D1 之所以是 0，是因为它在代码里写作 COLLECTIONS.FINANCE_SETTINGS，
  // 正则匹配不到字面量集合名 —— 这是 D1 覆盖面的一个盲区，不是「它不存在」）。
  'collection:finance_settings': { concept: 'finance_settings', role: 'channel', confidence: 'medium', note: '云端「财务设置（多端同步）」通道；**实测为空（0 行）** → 成本率实际只存在本机 sc_finance_v12，换设备即回落默认值。读路径已改为只读拉取它（见 financialData.ensureLedgerFresh），但云端没值可拉，属部署依赖项（审计 C.3）' },
  'collection:articles': { concept: 'content', role: 'authority', confidence: 'high' },
  'collection:care_guides': { concept: 'content', role: 'authority', confidence: 'medium' },
  'collection:custom_drafts': { concept: 'content_factory', role: 'derived', confidence: 'low', note: '待确认归属：内容工厂草稿 or 定制草稿' },
  'collection:content_pieces': { concept: 'content_factory', role: 'authority', confidence: 'high' },
  'collection:configs': { concept: 'generic_config', role: 'authority', confidence: 'medium', note: '通用配置文档集合（键值型），各页面按 docId 读取' },
  'collection:product_taxonomy': { concept: 'product_taxonomy', role: 'authority', confidence: 'high', note: '装裱方式/制作工艺字典（单文档）。云端有文档即覆写两端的代码默认表' },
  'function:getProductTaxonomy': { concept: 'product_taxonomy', role: 'channel', confidence: 'high', note: '字典的唯一读写通道：读公开、写在服务端校验（仅超管，且拒绝删除仍被商品引用的选项）' },
  'collection:store_booking_rules': { concept: 'booking_rules', role: 'authority', confidence: 'medium' },
  'collection:bookings': { concept: 'bookings', role: 'authority', confidence: 'high', note: '规则 write:false → ERP 只读；写通道未接入' },
  'collection:support_tickets': { concept: 'support', role: 'authority', confidence: 'high' },
  'collection:support_configs': { concept: 'support', role: 'authority', confidence: 'medium' },
  'collection:gift_settings': { concept: 'gift', role: 'authority', confidence: 'medium' },
  'collection:ops_purchases': { concept: 'fulfillment', role: 'authority', confidence: 'high' },
  'collection:ops_shipments': { concept: 'fulfillment', role: 'authority', confidence: 'high' },
  'collection:studio_material_prices': { concept: 'studio_pricing', role: 'authority', confidence: 'high', note: '原材料价目表：出货算价的材料费来源（manageStudioSettlement；写权限仅超管）' },
  'collection:studio_packaging_prices': { concept: 'studio_pricing', role: 'authority', confidence: 'high', note: '包装价目表：出货算价的包装费来源（manageStudioSettlement）' },
  'collection:ops_settlement_bills': { concept: 'studio_settlement', role: 'authority', confidence: 'high', note: '工作室账单：**结算唯一权威**；出货单的 settleStatus 由它派生（manageStudioSettlement）' },
  'collection:studio_shipment_skus': { concept: 'studio_pricing', role: 'derived', confidence: 'high', note: '出货 SKU 目录：**不持有价格**，只是引用价目表的可复用组合（材料×等级×包装×费率）；价格在出货时按当时价目表算并快照进单据' },
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
  // 2026-09-22 审计实测（确定性）：NotificationConfig.vue 读写本集合，而**运行期一条都不读** ——
  // 发消息的 cloudfunctions/dispatchMessage 与 messageAdmin 读的是 `message_templates`，
  // 且字段口径不同（本集合 code/name/title/content vs 运行期 templateCode/titleTemplate/contentTemplate/enabled）。
  // 即：本页保存会弹「成功」，但**配置从不生效**。标 erpWriteOnly 后，D6b 会强制该页显式披露，
  // 直到产品负责人决定「接线到 message_templates」或「下线本页」。
  'collection:notification_templates': { concept: 'message_config', role: 'legacy', confidence: 'high', erpWriteOnly: true, note: '⚠ ERP 只写不读；运行期读 message_templates（字段口径也不同）—— 见 NotificationConfig.vue 顶部披露' },
  'collection:admin_roles': { concept: 'admin_permission_records', role: 'authority', confidence: 'medium', note: '⚠ 不参与鉴权（staffGuard 读的是 staff_members/workspace_acl）；PermissionManager 只读展示 —— 审计 P0-4 的「无任何消费方」说法不准确，已更正' },
  'collection:admin_users': { concept: 'admin_permission_records', role: 'authority', confidence: 'medium', note: '⚠ 不参与鉴权；与 admin_roles 同属「后台角色/账号分配记录」这一概念（coAuthorities）' },
  'collection:admin_operation_logs': { concept: 'staff', role: 'derived', confidence: 'low' },
  'collection:admin_login_logs': { concept: 'staff', role: 'derived', confidence: 'low' },
  'collection:audience_campaigns': { concept: 'members', role: 'local-only', confidence: 'medium', note: '线上存在且 auth!=null 可读写但无仓库规则（审计 P0-11）' },
  // 以下 4 条本轮改判：原先错挂到 members / stores / analytics，导致 D5 把「读自己的权威」误报为
  // 「读非权威源」。依据见 CONCEPTS 里各自 note（三个集合在 ERP 侧都是完整 CRUD）。
  'collection:user_audiences': { concept: 'user_audiences', role: 'authority', confidence: 'medium', note: 'AudienceManager 增删改查；圈选规则自有实体（线上 auth!=null 且无仓库规则）' },
  'collection:property_proposals': { concept: 'property_proposals', role: 'authority', confidence: 'medium', note: 'PropertyEval 增改查；提案自有实体（线上 auth!=null 且无仓库规则）' },
  'collection:waitlist': { concept: 'members', role: 'derived', confidence: 'low', note: '候补名单' },
  'collection:pet_memorial_orders': { concept: 'orders', role: 'derived', confidence: 'medium', note: '伴宠记忆订单（独立业务线）' },
  'collection:pet_craft_configs': { concept: 'products', role: 'derived', confidence: 'low', note: '伴宠工艺配置' },
  'collection:custom_inquiries': { concept: 'content_factory', role: 'derived', confidence: 'low', note: '定制询单，待细分概念' },
  'collection:report_templates': { concept: 'report_templates', role: 'authority', confidence: 'medium', note: 'CustomReportBuilder 增删改查；模板自有实体（线上 auth!=null 且无仓库规则，审计 P0-11）' },

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
  'function:updateBooking': { concept: 'bookings', role: 'channel', confidence: 'high', note: '小程序侧写通道；**不在**前端代理白名单，ERP 暂不可用' },
  'function:verifyBooking': { concept: 'bookings', role: 'channel', confidence: 'high', note: '同上（核销）' },
  'function:cancelBooking': { concept: 'bookings', role: 'channel', confidence: 'high', note: '同上（取消）' },
  'function:manageGift': { concept: 'gift', role: 'channel', confidence: 'high' },
  'function:manageDeposit': { concept: 'orders', role: 'derived', confidence: 'medium', note: '定金' },
  'function:manageApprovals': { concept: 'staff', role: 'derived', confidence: 'medium' },
  'function:manageArtisanCommission': { concept: 'payroll_roster', role: 'derived', confidence: 'medium' },
  'function:manageBirthdayGift': { concept: 'gift', role: 'derived', confidence: 'medium' },
  'function:manageStoredValue': { concept: 'members', role: 'derived', confidence: 'medium', note: '储值钱包' },
  'function:assistProductCopy': { concept: 'products', role: 'derived', confidence: 'medium', note: 'AI 文案，不写业务事实' },
  'function:seedCategories': { concept: 'categories', role: 'derived', confidence: 'medium' },

  // ── localStorage ─────────────────────────────────────────────────────
  'local:shanhai_v12': {
    concept: 'finance_records',
    role: 'mirror',
    confidence: 'high',
    note: '云端 finance_records 的本机缓存（financeSync 写入）。'
      + '实测：清空 localStorage 后本机为空而云端有 308 行 → 取数页曾显示「财务账本暂无记录」。'
      + '已改为经 financialData.ensureLedgerFresh() 先只读拉取云端再读本键。',
    // 允许在「保证先取新」的前提下直接读本镜像 —— 显式白名单，而不是把 role 改掉来消音。
    readOkIn: [
      { file: 'src/utils/financialData.js', reason: '全仓唯一的账本读取口，读前 await ensureLedgerFresh() 只读拉取云端 finance_records' },
      { file: 'src/utils/financeLocalStorageKey.js', reason: '键名定义处 + 旧键一次性迁移（本文件不承载业务读取）' },
      { file: 'src/utils/dashboardMetrics.js', reason: '共享账本读取函数；其调用方（Dashboard.refreshAll、StaffOptimizeAI.getFinancialData）读前都已 await ensureLedgerFresh() 只读拉取云端' },
    ],
  },
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

  // ── 以下 2026-09-16 本轮补登记 ──────────────────────────────────────────
  // 起因：`report-data-sources` 原先只认「localStorage 读取里**直接写引号键名**」这一种写法，
  // **完全扫不到** `localStorage.getItem(SOME_KEY_CONST)` 这类写法。实测修正后
  // D1 从「0（假绿）」变成「29 条未登记」—— 这份清单本来就是 SSOT 该覆盖的。
  //
  // 与既有 authority 同源的写法（storage 模块只是键的访问器）：
  'local:sc_payroll_bundle_v1': { concept: 'payroll_roster', role: 'authority', confidence: 'high', note: 'payrollStorage 的原生键名（同一份事实的另一种写法，见 coAuthorities）' },
  'local:sc_store_bundle_v1': { concept: 'store_bundle', role: 'authority', confidence: 'high', note: 'storeStorage 的原生键名（同一份事实的另一种写法，见 coAuthorities）' },

  // 纯界面/会话状态（不承载业务事实，丢了不影响）：
  'local:sc_admin_sidebar_collapsed': { concept: 'generic_config', role: 'ui-state', confidence: 'high' },
  'local:sc_admin_sidebar_openeds': { concept: 'generic_config', role: 'ui-state', confidence: 'high' },
  'local:sc_admin_nav_origin': { concept: 'generic_config', role: 'ui-state', confidence: 'high', note: '导航大屏的来源标记' },
  'local:sc_admin_open_tabs': { concept: 'generic_config', role: 'ui-state', confidence: 'high' },
  'local:sc_admin_tab_active': { concept: 'generic_config', role: 'ui-state', confidence: 'high' },
  'local:sc_admin_pinned_modules': { concept: 'generic_config', role: 'ui-state', confidence: 'high' },
  'local:sc_admin_recent_modules': { concept: 'generic_config', role: 'ui-state', confidence: 'high' },
  'local:sc_admin_recent_collapsed': { concept: 'generic_config', role: 'ui-state', confidence: 'high' },
  'local:ai_center_persona_panel': { concept: 'analytics', role: 'ui-state', confidence: 'medium' },
  'local:ai_center_recent_features': { concept: 'analytics', role: 'ui-state', confidence: 'medium' },
  'local:ai_center_recent_tasks': { concept: 'analytics', role: 'ui-state', confidence: 'medium' },
  'local:sc_finance_unlocked_until': { concept: 'generic_config', role: 'ui-state', confidence: 'high', note: '财务页解锁时限（本地门禁，审计 P0-2 同类）' },
  'local:sc_partner_destiny_unlocked': { concept: 'generic_config', role: 'ui-state', confidence: 'high', note: '本地门禁标记' },
  'local:finance_sync_metadata': { concept: 'finance_records', role: 'derived', confidence: 'high', note: '同步水位（lastLocalUpdateTime 等），由账本派生' },

  // 只存本机、云端尚无对应物的**业务数据**（不跨设备，展示层须如实标注）：
  'local:shanhai_purchase_intents_v1': { concept: 'fulfillment', role: 'local-only', confidence: 'medium', note: '采购意向的本机副本；云端为 purchase_intents' },
  'local:sc_property_proposals_v3': { concept: 'property_proposals', role: 'local-only', confidence: 'medium', note: '物业测算提案的本机草稿' },
  'local:sc_franchise_bundle_v1': { concept: 'stores', role: 'local-only', confidence: 'medium', note: '加盟商档案（本机）' },
  'local:sc_compliance_kb_v1': { concept: 'generic_config', role: 'local-only', confidence: 'medium', note: '合规知识库（本机）' },
  'local:sc_finance_monthly_brief_v1': { concept: 'finance_records', role: 'local-only', confidence: 'medium', note: '财务月报摘要（本机生成物）' },
  'local:sc_strategy_benchmark_zones_v1': { concept: 'generic_config', role: 'local-only', confidence: 'medium', note: '策略对标区（本机）' },
  'local:sc_strategy_compliance_items_v1': { concept: 'generic_config', role: 'local-only', confidence: 'medium', note: '策略合规项（本机）' },
  'local:sc_strategy_compliance_species_lists_v1': { concept: 'generic_config', role: 'local-only', confidence: 'medium', note: '策略合规物种清单（本机）' },
  'local:openclaw_virtual_staff_v1': { concept: 'staff', role: 'local-only', confidence: 'medium', note: '虚拟员工（本机），与 staff_members 不是一回事' },
  'local:sc_feishu_bitable_config_v1': { concept: 'generic_config', role: 'local-only', confidence: 'medium', note: '飞书多维表配置（本机，含凭据字段 → 敏感）' },
  'local:sc_feishu_roster_mapping_v1': { concept: 'generic_config', role: 'local-only', confidence: 'medium', note: '飞书花名册字段映射（本机）' },

  // ⚠ 安全项：AI 会话与运行时 Key 存在本机
  'local:ai_center_chat_sessions_v1': { concept: 'analytics', role: 'local-only', confidence: 'medium', note: 'AI 会话记录（本机）' },
  'local:ai_center_runtime_deepseek_key': { concept: 'analytics', role: 'local-only', confidence: 'high', note: '⚠ **API Key 存在 localStorage** —— 任何本机脚本/扩展都能读到，且换设备即失效。属安全待决项（审计 C.3）' },

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
    status: 'fixed',
    note: '已修（2026-09-16）：决策中心改走 getAnalyticsDashboard 全量口径。实测两页一致 —— '
      + '决策中心「本月营收 ¥2,050.18」== 驾驶舱「线上净额 ¥2,050.18」。',
  },
  {
    concept: 'order_metrics',
    label: '营收 / 订单数（自定义报表增强）',
    pages: [
      { module: '0', page: 'Dashboard.vue', source: 'function:getAnalyticsDashboard', scope: '全量（服务端聚合）' },
      { module: '21', page: 'CustomReportBuilder.vue', source: 'collection:orders', scope: '逐单读取，上限 1000 笔' },
    ],
    // 状态为 fixed 的含义：**已处置**（不是「分歧已消除」——它是设计约束）。
    // 处置方式 = 上限收敛到单一真源 + 逐单读取触顶时显式告警（不再静默给出偏低的营收）。
    status: 'fixed',
    note: '设计约束（永久）：模块 21 需要**逐单 costPrice** 才能算自定义分组的利润/成本，'
      + '故无法改用聚合接口（getAnalyticsDashboard 只给不区分分组的聚合口径）。'
      + '它全量分页读取 orders，上限 REPORT_ORDER_LIMIT=1000；**超出即截断**，'
      + '此时其营收会低于权威值。已加「触顶告警」（describeTruncation + ElMessage.warning）避免静默。'
      + '⚠️ 真实订单量未在本次验证（无 TCB 凭证），故不臆测当前是否已触顶；'
      + '如需彻底消除该上限，应把自定义分组聚合下沉到云函数。',
  },
  {
    concept: 'stores',
    label: '门店数',
    pages: [
      { module: '25', page: 'OperationsDecisionCenter.vue', source: 'local:sc_store_bundle_v1', scope: '本机' },
      { module: '30', page: 'StoreManagement.vue', source: 'collection:stores', scope: '云端' },
    ],
    status: 'fixed',
    note: '已修（2026-09-16）：决策中心改读云端 stores 集合。实测「0 家 → 2 家（2 家生效）」，'
      + '并把「门店本地档案包」单列为非 C 端事实源。',
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

/**
 * 已知的**静默兜底**（失败/缺数据时悄悄用默认值，与「真有这个值」不可区分）。
 * 由人工确认后登记；每条都必须能指向具体代码位置。
 */
export const SILENT_FALLBACKS = [
  {
    id: 'finance-settings-dropped',
    fixed: true,
    where: 'utils/financialData.js fetchFinancialData 的「空账本」与 catch 分支',
    note: '原先只在「有本地账本记录」的分支里返回 settings，空账本时 settings=undefined → '
      + '下游 normalizeCostRate(undefined) 静默回落 25% 默认值。已修：与记录数无关地读取参数。',
  },
  {
    id: 'ledger-empty-hides-cost',
    fixed: false,
    where: 'utils/dashboardMetrics.js loadLedgerRecords + financialData 的 shanhai_v12',
    note: '财务账本仍以**本机 localStorage** 为事实来源（权威应为云端 finance_records）。'
      + '本机为空时营收账本口径整体为 0 —— 现已由全量云口径覆盖营收 KPI，'
      + '但「营收账本净额」等仍需账本本机有数据。属部署依赖项（见 C.3）。',
  },
]

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
