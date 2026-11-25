/**
 * 超管 / 店长工作台 Hub 入口导航（2026-09-30 全局改版）
 *
 * - HUB_SECTIONS：六个分区（订单与履约 → 系统，按日常频率排序；2026-11-26 归并 S5 由七区收为六区）；keys = 该分区内全部磁贴 wx:if 用到的菜单键之并，
 *   分区在任一键可见时显示（index.wxml 的 `hubSec.<id>`）。
 * - HUB_ENTRIES：全部磁贴的统一清单（稳定 id）；「我的常用」按它渲染、存 id（本地 storage，按角色分键）。
 *   每个磁贴点一下直达一个功能（2026-10-10 起没有「点开再选」的折叠磁贴，见末条）。
 * - 与 index.wxml 的一致性（清单 ↔ 磁贴逐枚、每个分区 keys、原功能入口不丢）由
 *   `npm run check:hub-entries` 校验。
 * - 2026-10-01 展示改版（产品负责人点名，选定方案 A）：首屏 = 待处理横条 + 我的常用；「全部功能」= 按分区的列表行
 *   （图标 + 名称 + 一句大白话说明 + 角标 + ›），分区可折叠；入口 > 20 的角色（超管）默认折叠、组头列前几个入口名，并出搜索框。
 * - 2026-10-10 产品负责人点名撤回 10-02 的整块手风琴，同日追加：「全部功能」回到 09-30 首版的按大分类扁平宫格（4 列磁贴，
 *   圆形图标 + 名称 + 可选一行短说明 sub，有下级的右上角 ›，红色数字角标在图标右上角）；分类标题行可点按收起 / 展开，
 *   默认全部展开，收起记录存本机 COLLAPSE_STORAGE_KEY（不分角色），收起时标题行显示入口数与红点合计。只改展示：权限过滤、跳转入口、角标来源与上面三份清单一致，不变。
 * - 2026-10-10 产品负责人再追加「类似功能折叠的全部展开单独展示」：礼赠 / 礼包钱包 / 标本师 / 组织 / 工资 / 规则配置
 *   六枚「点开再选」的折叠磁贴拆成 16 枚独立磁贴，留在原分类、各按原子入口的权限键与角标；二级选择面板随之删除。
 *   已存进常用的旧折叠 id 经 FAV_ID_ALIASES 映射到当前角色第一个有权限的子入口。
 */

const HUB_SECTIONS = [
  { id: 'orders', title: '订单与履约', short: '订单', keys: ['orders', 'workOrders', 'giftOps', 'giftManage', 'invoice', 'approvals', 'depositOps'] },
  { id: 'biz', title: '经营与数据', short: '经营', keys: ['ledger', 'analytics'] },
  { id: 'goods', title: '商品与上线', short: '商品', keys: ['products', 'content', 'reviews', 'contentFlags', 'reviewMode', 'decor', 'activities', 'live'] },
  {
    // 2026-11-26 归并 S5：原「工作室」+「门店组织」合成一区，门店资料（原经营数据）也落在这里
    id: 'studio',
    title: '工作室与门店',
    short: '工作室',
    keys: [
      'studioDashboard', 'supplierWorkbench', 'purchaseOps', 'shipmentOps', 'shipmentSku', 'inventoryOps', 'rawInventoryOps',
      'studioBills', 'propertyCost', 'framers', 'framerRecruit', 'artisanCommission',
      'stores', 'verify', 'staffConsole', 'staffDirectory', 'staffPermissions', 'shareholderConfig', 'payslipAdmin', 'myPayslip'
    ]
  },
    { id: 'members', title: '会员与触达', short: '会员', keys: ['memberCrm', 'vip', 'support', 'memberLevelAdjust', 'honoraryCurators', 'points', 'welcomeGift', 'walletConfig'] },
  { id: 'system', title: '系统与设置', short: '系统', keys: ['shipping', 'bookingRules', 'supportConfig', 'orders', 'feishuSync', 'aiIdentifyMonitor', 'museumGuideMonitor'] }
]

const ICON = '/assets/icons/'
const MGR_ICON = '/subpackages/manager/assets/icons/'

/**
 * 组合入口（2026-11-25 产品负责人「超管功能超过 52 个，合并同类项、大幅优化分类与数量」，
 * 方案 miniprogram/docs/超管工作台_功能归并_2026-11-25.md）：同类功能共用一枚磁贴 → 组合页 subpackages/manager/group/index?kit=<id>
 * 逐条平铺子功能（不是弹层 / 二级面板）。子功能保留原 id、原入口 handler、原权限键与角标；组合页按权限过滤后调工作台页上的
 * 原 handler（hubNav.invokeItem），原门禁、订阅授权都不变。组合入口的权限键 = 子功能之并，搜索别名 = 子功能名称与别名之并。
 * 一致性由 check:hub-entries 的 K 规则校验。
 */
const HUB_KITS = [
  {
    id: 'gift', label: '礼赠', sub: '履约·规则', desc: '礼赠履约和礼赠规则，一页切换', icon: ICON + 'gift.png', sec: 'orders',
    children: [
      { id: 'giftOps', label: '礼赠履约', desc: '待填址、待发货和自提核销', alias: ['礼赠', '礼物', '送礼', '自提', '核销'], icon: ICON + 'gift.png', keys: ['giftOps'], tap: 'goGiftOps', badge: 'giftTodoCount' },
      { id: 'giftManage', label: '礼赠管理', desc: '礼赠待办概况、规则和提醒', alias: ['礼赠', '礼物', '礼赠规则'], icon: ICON + 'care.png', keys: ['giftManage'], tap: 'goGiftManage' }
    ]
  },
  {
    id: 'approvalsKit', label: '审批与发票', sub: '审批·发票', desc: '等你点头的申请和顾客发票', icon: ICON + 'done.png', sec: 'orders',
    children: [
      { id: 'approvals', label: '审批', desc: '等你点头的申请', alias: ['审核', '申请', '批准'], icon: ICON + 'done.png', keys: ['approvals'], tap: 'goApprovals', badge: 'approvalPendingCount' },
      { id: 'invoice', label: '发票', desc: '顾客申请的发票，开好再回复', alias: ['开票', '报销'], icon: ICON + 'refund.png', keys: ['invoice'], tap: 'goInvoiceRequests', badge: 'invoicePendingCount' }
    ]
  },
  {
    id: 'opsKit', label: '馆内运营', sub: '活动·直播', desc: '活动课程和直播间', icon: ICON + 'booking.png', sec: 'goods',
    children: [
      { id: 'activities', label: '活动', desc: '活动和课程怎么排', alias: ['课程', '报名', '活动课程'], icon: ICON + 'booking.png', keys: ['activities'], tap: 'switchTab', idx: 7, tabTitle: '活动课程' },
      { id: 'live', label: '主播', desc: '直播间和主播', alias: ['直播', '开播', '主播工作台'], icon: ICON + 'video-tab.png', keys: ['live'], tap: 'goLiveStudio' }
    ]
  },
  {
    id: 'memberLevelKit', label: '会员等级', sub: '权益·调级', desc: '会员权益和升降级', icon: ICON + 'medal_gold.png', sec: 'members',
    children: [
      { id: 'vip', label: '权益', desc: '会员能享受的好处', alias: ['权益', '会员卡', '礼券'], icon: ICON + 'coupon.png', keys: ['vip'], tap: 'switchTab', idx: 6, tabTitle: '权益会员' },
      { id: 'memberLevel', label: '会员调级', desc: '给会员升级或降级', alias: ['等级', '升级', '降级', '调级'], icon: ICON + 'medal_gold.png', keys: ['memberLevelAdjust'], tap: 'goMemberLevelAdjust' }
    ]
  },
  {
    id: 'aiMonitorKit', label: 'AI 监测', sub: '鉴定·博物君', desc: '拍照鉴定和博物君用得怎么样', icon: ICON + 'camera.png', sec: 'system',
    children: [
      { id: 'aiIdentify', label: 'AI 鉴定', sub: '鉴定监测', desc: '拍照识别用得怎么样', alias: ['识别', '鉴定', '拍照'], icon: ICON + 'camera.png', keys: ['aiIdentifyMonitor'], tap: 'goIdentifyMonitorGuarded' },
      { id: 'museumGuide', label: '博物君', sub: '开关·监测', desc: '博物君开不开、问得怎么样', alias: ['博物君', 'AI 馆员', '问答'], icon: ICON + 'knowledge.png', keys: ['museumGuideMonitor'], tap: 'goMuseumGuideMonitorGuarded' }
    ]
  },
  {
    id: 'giftPackKit', label: '礼包与钱包', sub: '新人·生日·充值', desc: '新人、生日礼包和充值档位', icon: ICON + 'cart.png', sec: 'members',
    children: [
      { id: 'welcomeGift', label: '新人礼包', desc: '新会员注册就送的积分和礼券', alias: ['礼包', '新会员礼包', '新人', '注册礼'], icon: ICON + 'cart.png', keys: ['welcomeGift'], tap: 'goWelcomeGift' },
      { id: 'birthdayGift', label: '生日礼包', desc: '会员生日当天送的积分和礼券', alias: ['礼包', '生日', '生日礼'], icon: ICON + 'booking.png', keys: ['welcomeGift'], tap: 'goBirthdayGift' },
      { id: 'walletConfig', label: '钱包配置', desc: '充值档位和充值页文案', alias: ['钱包', '充值', '储值'], icon: ICON + 'wallet_gold.png', keys: ['walletConfig'], tap: 'goWalletConfig' }
    ]
  },
  {
    id: 'goodsKit', label: '货品', sub: '进货·库存·出货', desc: '进货、库存、出货与定价', icon: ICON + 'knowledge.png', sec: 'studio',
    children: [
      { id: 'supplier', label: '供应商', desc: '进货的合作商家', alias: ['供货', '供应商', '厂家'], icon: ICON + 'group.png', keys: ['supplierWorkbench'], tap: 'goSupplierWorkbench' },
      { id: 'purchase', label: '采购', desc: '给工作室下单进货', alias: ['进货', '采购单'], icon: ICON + 'cart.png', keys: ['purchaseOps'], tap: 'goPurchaseOps' },
      { id: 'inventory', label: '库存', desc: '成品和原料还剩多少', alias: ['库存', '原料', '成品', '盘点'], icon: ICON + 'knowledge.png', keys: ['inventoryOps', 'rawInventoryOps'], tap: 'goInventoryOps' },
      { id: 'skuMaintain', label: 'SKU 维护', desc: '出货商品的组合、价格和停用', alias: ['SKU', '商品', '价目', '出货 SKU', '定价'], icon: ICON + 'list.png', keys: ['shipmentSku'], tap: 'goSkuMaintain' },
      { id: 'shipment', label: '出货中心', desc: '工作室打包发货', alias: ['发货', '出库', '出货单'], icon: ICON + 'ship.png', keys: ['shipmentOps'], tap: 'goShipmentOps' }
    ]
  },
  {
    id: 'costKit', label: '成本与账单', sub: '账单·物业', desc: '工作室收支、房租水电', icon: ICON + 'pay.png', sec: 'studio',
    children: [
      { id: 'studioBills', label: '工作室账单', desc: '工作室的收入和支出', alias: ['账单', '收支', '支出'], icon: ICON + 'pay.png', keys: ['studioBills'], tap: 'goStudioBillsGuarded' },
      { id: 'property', label: '物业', desc: '房租、水电和物业费', alias: ['房租', '水电', '物业费'], icon: MGR_ICON + 'location.png', keys: ['propertyCost'], tap: 'goPropertyCost' }
    ]
  },
  {
    id: 'framerKit', label: '标本师', sub: '名单·申请·提成', desc: '标本师名单、入驻和提成', icon: ICON + 'user.png', sec: 'studio',
    children: [
      { id: 'framers', label: '标本师', desc: '标本师名单、作品和状态', alias: ['标本师管理', '名册', '作品'], icon: ICON + 'user.png', keys: ['framers'], tap: 'switchTab', idx: 5, tabTitle: '标本师管理' },
      { id: 'framerRecruit', label: '合作申请', desc: '想入驻的标本师，审核申请', alias: ['入驻', '申请', '标本师', '标本师合作'], icon: ICON + 'refund.png', keys: ['framerRecruit'], tap: 'switchTab', idx: 14, tabTitle: '标本师合作', badge: 'framerRecruitApps' },
      { id: 'artisanCommission', label: '标本师提成', desc: '标本师提成比例和账目', alias: ['提成', '分成', '标本师'], icon: ICON + 'discount.png', keys: ['artisanCommission'], tap: 'goArtisanCommission' }
    ]
  },
  {
    id: 'staffKit', label: '员工与权限', sub: '名单·权限', desc: '员工名单和角色分配', icon: ICON + 'group.png', sec: 'studio',
    children: [
      { id: 'staffDirectory', label: '员工', desc: '店员、店长、标本师和股东名单', alias: ['员工名单', '店员', '组织', '通讯录'], icon: ICON + 'group.png', keys: ['staffDirectory'], tap: 'goStaffDirectory' },
      { id: 'staffPermissions', label: '权限', desc: '按手机号给员工分配角色', alias: ['权限配置', '角色', '组织'], icon: ICON + 'lock.png', keys: ['staffPermissions'], tap: 'goStoreStaffPermissions' }
    ]
  },
  {
    id: 'payKit', label: '工资', sub: '维护·工资条', desc: '录工资、看自己的工资条', icon: ICON + 'calendar_gold.png', sec: 'studio',
    children: [
      { id: 'payslipAdmin', label: '工资维护', desc: '录入、修正和删除工资', alias: ['工资', '录工资', '薪资'], icon: MGR_ICON + 'edit.png', keys: ['payslipAdmin'], tap: 'goPayslipAdminGuarded' },
      { id: 'myPayslip', label: '工资条', desc: '看每月应发、实发和分成', alias: ['工资', '工资条明细', '薪资'], icon: ICON + 'calendar_gold.png', keys: ['myPayslip'], tap: 'goMyPayslipGuarded' }
    ]
  },
  {
    id: 'launchKit', label: '上线准备', sub: '装修·开关·审核', desc: '上线前的布置、栏目和提审', icon: ICON + 'eye.png', sec: 'goods',
    children: [
      { id: 'decor', label: '装修', desc: '首页和店铺的布置', alias: ['装修', '首页', '横幅'], icon: MGR_ICON + 'edit.png', keys: ['decor'], tap: 'switchTab', idx: 4, tabTitle: '店铺装修' },
      { id: 'contentFlags', label: '开关', desc: '页面上哪些栏目显示', alias: ['开关', '栏目', '显示', '内容开关'], icon: ICON + 'eye.png', keys: ['contentFlags'], tap: 'switchTab', idx: 16, tabTitle: '内容开关' },
      { id: 'reviewMode', label: '审核', sub: '提审关闸', desc: '提审前关掉功能与商品', alias: ['审核', '提审', '上线', '审核模式'], icon: ICON + 'done.png', keys: ['reviewMode'], tap: 'goReviewModeGuarded' }
    ]
  },
  {
    id: 'settingsKit', label: '设置', sub: '运费·预约·通知', desc: '运费、预约、客服、通知和飞书', icon: ICON + 'service.png', sec: 'system',
    children: [
      { id: 'shipping', label: '运费规则', desc: '按装裱方式算运费、包邮门槛', alias: ['运费', '包邮', '快递费', '规则配置'], icon: ICON + 'deliver.png', keys: ['shipping'], tap: 'switchTab', idx: 15, tabTitle: '运费规则' },
      { id: 'bookingRules', label: '预约规则', desc: '可预约时段和闭店日', alias: ['预约', '时段', '闭店', '规则配置'], icon: MGR_ICON + 'clock.png', keys: ['bookingRules'], tap: 'goBookingRules' },
      { id: 'supportConfig', label: '客服入口', desc: '客服电话和常见问题', alias: ['客服', '电话', '常见问题', '规则配置'], icon: ICON + 'phone.png', keys: ['supportConfig'], tap: 'goSupportConfig' },
      { id: 'wxNotify', label: '微信通知', sub: '订单·工单提醒', desc: '来新订单时微信提醒我', alias: ['通知', '提醒', '微信'], icon: ICON + 'service.png', keys: ['orders'], tap: 'enableStaffOrderWxNotify' },
      { id: 'feishu', label: '飞书同步', desc: '把数据自动抄到飞书表格', alias: ['飞书', '表格', '同步'], icon: ICON + 'deliver.png', keys: ['feishuSync'], tap: 'goFeishuSyncGuarded' }
    ]
  }
]

function findKit(id) {
  return HUB_KITS.find((k) => k.id === id) || null
}

/** 组合在清单里的那一条：权限键 / 别名由子功能汇总（不手写，免得漂移） */
function kitEntry(id) {
  const k = findKit(id)
  const keys = []
  const alias = []
  k.children.forEach((c) => {
    c.keys.forEach((x) => { if (keys.indexOf(x) === -1) keys.push(x) })
    ;[c.label].concat(c.alias || []).forEach((w) => { if (alias.indexOf(w) === -1) alias.push(w) })
  })
  return { id: k.id, label: k.label, sub: k.sub, desc: k.desc, alias, icon: k.icon, sec: k.sec, keys, tap: 'openHubKitPage', kit: k.id }
}

/**
 * 工作台入口统一清单（稳定 id，不用显示名）。分区磁贴（index.wxml 静态标记）与「我的常用」都以它为准；
 * 两者逐枚一致（入口 / 名称 / 图标 / 权限 / 分区）由 check:hub-entries 校验。
 */
const HUB_ENTRIES = [
  { id: 'orders', label: '订单', desc: '看新订单、安排发货和售后', alias: ['发货', '售后', '退款', '物流', '快递'], icon: ICON + 'box.png', sec: 'orders', keys: ['orders'], tap: 'onOrdersMenuTap', idx: 2, tabTitle: '订单管理', badge: 'orders' },
  { id: 'workOrders', label: '工单', desc: '定制和装裱的活儿，进度一目了然', alias: ['定制', '装裱', '伴宠'], icon: ICON + 'list.png', sec: 'orders', keys: ['workOrders'], tap: 'switchTab', idx: 10, tabTitle: '工单', badge: 'customOrders' },
  kitEntry('gift'),
  kitEntry('approvalsKit'),
  { id: 'deposit', label: '孤品定金', desc: '卖完的孤品，顾客交的订金', alias: ['订金', '定金', '孤品'], icon: ICON + 'discount.png', sec: 'orders', keys: ['depositOps'], tap: 'goDepositOps' },
  { id: 'ledger', label: '账本', desc: '每天收了多少钱，一笔笔对得上', alias: ['营收', '流水', '对账', '收入'], icon: ICON + 'coin_gold.png', sec: 'biz', keys: ['ledger'], tap: 'switchTab', idx: 8, tabTitle: '营收账本' },
  { id: 'analytics', label: '报表', desc: '卖得怎么样、谁来过', alias: ['数据', '统计', '销量', '报表'], icon: ICON + 'trend.png', sec: 'biz', keys: ['analytics'], tap: 'switchTab', idx: 13, tabTitle: '数据报表' },
  { id: 'stores', label: '门店', desc: '门店资料和营业时间', alias: ['门店', '店铺', '营业'], icon: ICON + 'store.png', sec: 'studio', keys: ['stores'], tap: 'switchTab', idx: 12, tabTitle: '门店管理' },
  { id: 'products', label: '藏品', desc: '藏品上架、下架和改价', alias: ['商品', '上架', '下架', '价格', '藏品库'], icon: ICON + 'tab-collection.png', sec: 'goods', keys: ['products'], tap: 'switchTab', idx: 1, tabTitle: '藏品库' },
  { id: 'content', label: '内容', desc: '文章和视频', alias: ['文章', '视频', '图文'], icon: ICON + 'article-tab.png', sec: 'goods', keys: ['content'], tap: 'switchTab', idx: 9, tabTitle: '内容管理' },
  // 2026-11-25：用户评价从「内容管理」子 Tab 提为一级磁贴（原入口已无，不算重复入口）
  { id: 'reviews', label: '评价', sub: '审核·回复', desc: '顾客评价审核、置顶与回复', alias: ['评价', '评论', '晒单', '回复'], icon: ICON + 'star.png', sec: 'goods', keys: ['reviews'], tap: 'switchTab', idx: 17, tabTitle: '用户评价' },
  // 2026-11-25：审核模式 = 功能开关 + 藏品上下架聚合页（仅超管）；原「开关」「藏品」两个入口都保留
  kitEntry('launchKit'),
  kitEntry('opsKit'),
  { id: 'memberCrm', label: '会员 CRM', desc: '会员是谁、多久没来、谁该回访', alias: ['会员', '顾客', '客户', '回访'], icon: ICON + 'user_gold.png', sec: 'members', keys: ['memberCrm'], tap: 'goMemberCrm' },
  kitEntry('memberLevelKit'),
  { id: 'support', label: '有信', desc: '回复顾客的留言', alias: ['留言', '客服', '回复', '山海有信'], icon: ICON + 'message.png', sec: 'members', keys: ['support'], tap: 'switchTab', idx: 11, tabTitle: '山海有信', badge: 'supportTickets' },
  { id: 'curators', label: '荣誉馆长', desc: '荣誉馆长名单', alias: ['馆长', '荣誉'], icon: ICON + 'tab-collection.png', sec: 'members', keys: ['honoraryCurators'], tap: 'goHonoraryCurators' },
  { id: 'points', label: '积分', desc: '发积分、换礼品', alias: ['积分', '兑换'], icon: ICON + 'star.png', sec: 'members', keys: ['points'], tap: 'goStorePoints' },
  kitEntry('giftPackKit'),
  { id: 'studioDashboard', label: '仪表盘', desc: '工作室整体情况', alias: ['工作室', '总览'], icon: ICON + 'studio-dashboard.png', sec: 'studio', keys: ['studioDashboard'], tap: 'goStudioDashboard' },
  kitEntry('goodsKit'),
  kitEntry('costKit'),
  kitEntry('framerKit'),
  { id: 'verify', label: '核销验票', desc: '扫码核销会员券、门票和礼券', alias: ['核销', '扫码', '验票', '门票'], icon: ICON + 'qrcode.png', sec: 'studio', keys: ['verify'], tap: 'goStaffTab', tab: 'verify' },
  { id: 'staffConsole', label: '店员工作台', desc: '打卡和店员每天要做的事', alias: ['店员', '打卡', '排班'], icon: ICON + 'tab-user.png', sec: 'studio', keys: ['staffConsole'], tap: 'goStaffHome' },
  kitEntry('staffKit'),
  { id: 'shareholderConfig', label: '股东', desc: '门店占股和回本前后分成', alias: ['股东配置', '占股', '分成', '组织'], icon: ICON + 'coin_gold.png', sec: 'studio', keys: ['shareholderConfig'], tap: 'goShareholderConfig' },
  kitEntry('payKit'),
  kitEntry('settingsKit'),
  kitEntry('aiMonitorKit'),
]

/* ── 我的常用 ── */
const FAV_MAX = 8
const FAV_STORAGE_KEY = 'manager_hub_favs_v1'
/**
 * 旧入口 / 被合并入口 → 现行稳定 id（已保存的常用在改版、合并后自动映射）。
 * 值为数组 = 2026-10-10 拆开的旧折叠磁贴：映射到当前角色**第一个有权限**的子入口（都没权限就丢掉，不留空位）。
 */
const FAV_ID_ALIASES = {
  // 2026-11-26 归并 S2：被并进组合的子功能 → 组合入口（旧「礼赠」折叠 id 也落到礼赠组合）
  gift: 'gift', giftOps: 'gift', giftManage: 'gift',
  approvals: 'approvalsKit', invoice: 'approvalsKit',
  activities: 'opsKit', live: 'opsKit',
  vip: 'memberLevelKit', memberLevel: 'memberLevelKit',
  aiIdentify: 'aiMonitorKit', museumGuide: 'aiMonitorKit', museumGuideMonitor: 'aiMonitorKit',
  // S3：会员礼包 / 货品 / 成本与账单 / 标本师 / 员工与权限 / 工资
  welcomeGift: 'giftPackKit', birthdayGift: 'giftPackKit',
  supplier: 'goodsKit', purchase: 'goodsKit', inventory: 'goodsKit', skuMaintain: 'goodsKit',
  studioBills: 'costKit', property: 'costKit',
  framers: 'framerKit', framerRecruit: 'framerKit', artisanCommission: 'framerKit',
  staffDirectory: 'staffKit', staffPermissions: 'staffKit',
  payslipAdmin: 'payKit', myPayslip: 'payKit',
  walletConfig: 'giftPackKit', shipment: 'goodsKit', feishu: 'settingsKit',
  perks: 'giftPackKit',
  artisan: 'framerKit',
  org: ['staffKit', 'shareholderConfig'],
  payslip: 'payKit',
  // S4：上线准备 / 设置
  decor: 'launchKit', contentFlags: 'launchKit', reviewMode: 'launchKit',
  shipping: 'settingsKit', bookingRules: 'settingsKit', supportConfig: 'settingsKit', wxNotify: 'settingsKit',
  rules: 'settingsKit',
  memberCurator: 'memberLevelKit', memberLevelAdjust: 'memberLevelKit', honoraryCurators: 'curators',
  shipmentOps: 'goodsKit', shipmentSku: 'goodsKit',
  inventoryOps: 'goodsKit', rawInventoryOps: 'goodsKit',
  supplierWorkbench: 'goodsKit', purchaseOps: 'goodsKit', propertyCost: 'costKit',
  feishuSync: 'settingsKit', depositOps: 'deposit', aiIdentifyMonitor: 'aiMonitorKit'
}
/** 未配置时的角色默认（再按权限过滤） */
const FAV_DEFAULTS = {
  super_admin: ['orders', 'ledger', 'analytics', 'approvalsKit', 'support', 'products', 'verify', 'memberCrm'],
  store_manager: ['orders', 'ledger', 'verify', 'approvalsKit', 'workOrders', 'gift', 'products', 'points'],
  store_staff: ['verify', 'approvalsKit', 'staffConsole'],
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
    const to = FAV_ID_ALIASES[raw] || raw
    const id = Array.isArray(to) ? to.find((x) => entryVisible(findEntry(x), menu)) : to
    if (!id || out.indexOf(id) !== -1) return
    if (!entryVisible(findEntry(id), menu)) return
    // 旧 id 是被并进组合的某个子功能（按 id 或权限键认）：要当前角色**看得到这个子功能**才落到组合，
    // 否则店长存过的「飞书同步」会变成一枚「设置」—— 组合看得到，可里面并没有它
    const kit = findKit(id)
    if (kit && raw !== id) {
      const m = menu || {}
      const child = kit.children.find((c) => c.id === raw || c.keys.indexOf(raw) !== -1)
      if (child && !child.keys.some((k) => m[k] === true)) return
    }
    out.push(id)
  })
  return out.slice(0, FAV_MAX)
}

function defaultFavs(role, menu) {
  return normalizeFavs(FAV_DEFAULTS[role] || [], menu)
}

/** 入口角标数字（订单有新单未读时显示未读数，与磁贴角标同口径） */
/** 组合角标 = 当前角色有权限的子功能角标之和（看不到的子功能不计数） */
function kitBadgeNum(kit, data) {
  const d = data || {}
  const m = d.menu || {}
  return (kit ? kit.children : []).filter((c) => c.badge && c.keys.some((k) => m[k] === true))
    .reduce((sum, c) => sum + badgeValue(c.badge, d), 0)
}

function badgeText(n) {
  if (n <= 0) return ''
  return n > 99 ? '99+' : String(n)
}

/** 全部功能里组合磁贴的角标文字：{ [组合 id]: '3' | '' } */
function buildKitBadges(data) {
  const out = {}
  HUB_KITS.forEach((k) => { out[k.id] = badgeText(kitBadgeNum(k, data)) })
  return out
}

/** 组合页每一行的角标（与工作台同一数据源） */
function childBadge(child, data) {
  return badgeText(child && child.badge ? badgeValue(child.badge, data) : 0)
}

function entryBadgeNum(entry, data) {
  if (entry && entry.kit) return kitBadgeNum(findKit(entry.kit), data)
  if (!entry || !entry.badge) return 0
  const d = data || {}
  let n = badgeValue(entry.badge, d)
  if (entry.id === 'orders' && Number(d.newOrderUnreadCount) > 0) n = Number(d.newOrderUnreadCount)
  return n > 0 ? n : 0
}

function entryBadge(entry, data) {
  const n = entryBadgeNum(entry, data)
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

/**
 * 顶部待办卡：只列有权限且计数 > 0 的项；点按走原入口。
 * 分区磁贴上每一种计数角标都要在这里有对应项（badge 或 extra 同一数据源），由 check:hub-entries 校验。
 */
const HUB_TODOS = [
  // 新单未读与待发合并成一个数（产品负责人 2026-10-01：维持现状，不单独成项）
  { id: 'orders', label: '待发订单', keys: ['orders'], badge: 'orders', merged: 'newOrderUnreadCount', tap: 'onOrdersMenuTap', idx: 2, tabTitle: '订单管理' },
  { id: 'support', label: '有信待回', keys: ['support'], badge: 'supportTickets', tap: 'switchTab', idx: 11, tabTitle: '山海有信' },
  { id: 'workOrders', label: '工单', keys: ['workOrders'], badge: 'customOrders', tap: 'switchTab', idx: 10, tabTitle: '工单' },
  { id: 'approvals', label: '审批', keys: ['approvals'], badge: 'approvalPendingCount', tap: 'goApprovals' },
  { id: 'invoice', label: '发票', keys: ['invoice'], badge: 'invoicePendingCount', tap: 'goInvoiceRequests' },
  { id: 'gift', label: '礼赠', keys: ['giftOps'], badge: 'giftTodoCount', tap: 'goGiftOps' },
  { id: 'recruit', label: '合作申请', keys: ['framerRecruit'], badge: 'framerRecruitApps', tap: 'switchTab', idx: 14, tabTitle: '标本师合作' },
  // 2026-11-25：收到用户商品评价的「工作信息」提醒（超管 / 店长都收；点直达用户评价）
  { id: 'comments', label: '评价待回', keys: ['reviews'], badge: 'commentNoticeUnread', tap: 'switchTab', idx: 17, tabTitle: '用户评价' }
]

function buildTodos(data) {
  const d = data || {}
  const m = d.menu || {}
  let total = 0
  let any = false
  const items = []
  HUB_TODOS.forEach((t) => {
    if (!t.keys.some((k) => m[k] === true)) return
    any = true
    const n = Math.max(badgeValue(t.badge, d), t.merged ? badgeValue(t.merged, d) : 0)
    if (n <= 0) return
    total += n
    items.push({ id: t.id, label: t.label, count: n > 99 ? '99+' : String(n) })
  })
  return { total, totalText: total > 999 ? '999+' : String(total), items, any }
}

/* ── 全部功能：按大分类的扁平宫格（分类可收起，默认全部展开）+ 搜索 ── */
/** 可见入口超过这个数的角色（超管约 38 个）出搜索框；店长约 16 个不出 */
const MANY_ENTRIES = 20
/** 本机记住哪些分类被收起：{ [分区 id]: true }，不分角色；没有记录 = 全部展开 */
const COLLAPSE_STORAGE_KEY = 'manager_hub_collapsed_v1'

function visibleEntries(menu) {
  return HUB_ENTRIES.filter((e) => entryVisible(e, menu))
}

/** 全部功能计数 / 是否出搜索 */
function buildCatalog(menu) {
  const vis = visibleEntries(menu)
  return { hubCat: { total: vis.length, search: vis.length > MANY_ENTRIES } }
}

/**
 * 宫格自适应（2026-11-26 产品负责人「根据功能的数量不同来优化交互展示方案」）：按**当前角色在该分类看得到的入口数 n** 选列数，
 * 末行永远铺满 —— 不再出现「一行四格只占一格」的孤儿行。
 *   n ≤ 2：横向宽卡（图标在左、名称与小字在右），一行 1–2 张；
 *   n ≥ 3：在 3 列 / 4 列里选「末行最满」的（并列取 4 列）—— 3 / 6 / 9 → 3 列，4 / 8 → 4 列，5 → 3+2，7 → 4+3，10 → 4+4+2；
 *   末行不满时剩下的几格拉宽铺满（rem-1 整行、rem-2 各半行；宽到半行以上的格子切成横向宽卡）。
 * 落到样式上是 12 栅格 + span（hubNav.wxss），不用「百分比 + 间距」，避开真机取整换行（错题本 E26）。
 */
function gridOf(n) {
  if (n <= 2) return { cols: 2, rem: n === 1 ? 1 : 0 }
  const fill = (c) => { const r = n % c; return r === 0 ? 1 : r / c }
  const cols = fill(3) > fill(4) ? 3 : 4
  return { cols, rem: n % cols }
}

function gridClass(n) {
  const g = gridOf(n)
  return `cols-${g.cols}${g.rem ? ` rem-${g.rem}` : ''}`
}

/** 收起时标题行要显示的：该分类可见入口数 + 红点合计；展开时宫格的列数 / 末行铺法（grid） */
function buildSecMeta(data) {
  const d = data || {}
  const vis = visibleEntries(d.menu)
  const out = {}
  HUB_SECTIONS.forEach((s) => {
    const entries = vis.filter((e) => e.sec === s.id)
    if (!entries.length) return
    const n = entries.reduce((sum, e) => sum + entryBadgeNum(e, d), 0)
    out[s.id] = { n: entries.length, badge: n > 0 ? (n > 99 ? '99+' : String(n)) : '', grid: gridClass(entries.length) }
  })
  return out
}

/** 读回的收起记录 → 只留已知分区、值为 true 的项（其余一律展开） */
function normalizeCollapsed(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  HUB_SECTIONS.forEach((s) => { if (src[s.id] === true) out[s.id] = true })
  return out
}

/** 当前角色能看到的分区是否全部收起（决定「全部展开 / 全部收起」开关的文字） */
function allCollapsed(collapsed, secFlags) {
  const ids = HUB_SECTIONS.filter((s) => secFlags && secFlags[s.id]).map((s) => s.id)
  return ids.length > 0 && ids.every((id) => collapsed && collapsed[id] === true)
}

/** 一键：已全部收起 → 全部展开；否则把当前可见分区全部收起（看不到的分区保留原记录） */
function toggleAllCollapsed(collapsed, secFlags) {
  const out = normalizeCollapsed(collapsed)
  const fold = !allCollapsed(out, secFlags)
  HUB_SECTIONS.forEach((s) => {
    if (!secFlags || !secFlags[s.id]) return
    if (fold) out[s.id] = true
    else delete out[s.id]
  })
  return out
}

/** 工作台入口区一次算齐：分区开关 + 待办 + 常用 + 全部功能（计数 / 搜索开关 / 各分类入口数与红点） */
function buildHubView(favIds, data) {
  const d = data || {}
  return {
    hubSec: sectionFlags(d.menu),
    hubTodo: buildTodos(d),
    hubFav: buildFavView(favIds, d),
    hubSecMeta: buildSecMeta(d),
    hubKitBadge: buildKitBadges(d),
    ...buildCatalog(d.menu)
  }
}

const normText = (s) => String(s || '').toLowerCase().replace(/\s+/g, '')

/**
 * 一个入口能被哪些词搜到：名称、别名、所在分区名（全称 / 简称）。
 * 组合入口的别名只取**当前角色看得到**的子功能（店长搜「SKU」不该搜到只有超管才有「SKU 维护」的货品组合）。
 */
function searchWords(e, menu) {
  const sec = HUB_SECTIONS.find((s) => s.id === e.sec) || {}
  let alias = e.alias || []
  if (e.kit && menu) {
    const m = menu || {}
    const kit = findKit(e.kit)
    alias = []
    ;(kit ? kit.children : []).filter((c) => c.keys.some((k) => m[k] === true)).forEach((c) => { alias.push(c.label, ...(c.alias || [])) })
  }
  return [e.label, ...alias, sec.title, sec.short].map(normText).filter(Boolean)
}

/** 搜索只在有权限的入口里找；名称命中排前，其次别名，最后分区名 */
function searchEntries(query, data) {
  const q = normText(query)
  const d = data || {}
  if (!q) return []
  const scored = []
  visibleEntries(d.menu).forEach((e, i) => {
    const sec = HUB_SECTIONS.find((s) => s.id === e.sec) || {}
    let rank = -1
    if (normText(e.label).indexOf(q) !== -1) rank = 0
    else if (searchWords(e, d.menu).slice(1).some((w) => w.indexOf(q) !== -1 && w !== normText(sec.title) && w !== normText(sec.short))) rank = 1
    else if (searchWords(e, d.menu).some((w) => w.indexOf(q) !== -1)) rank = 2
    if (rank >= 0) scored.push({ rank, i, e })
  })
  scored.sort((x, y) => x.rank - y.rank || x.i - y.i)
  return scored.map(({ e }) => ({ id: e.id, label: e.label, desc: e.desc, icon: e.icon, badge: entryBadge(e, d) }))
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

/** 常用 / 搜索结果 / 待办 → 调原入口（switchTab 需要 dataset.idx / title） */
function invokeItem(page, item) {
  if (!page || !item || typeof page[item.tap] !== 'function') return false
  let dataset = item.dataset || {}
  if (!item.dataset) {
    if (item.kit) dataset = { kit: item.kit }
    else if (item.tab) dataset = { tab: item.tab }
    else if (item.idx) dataset = { idx: String(item.idx), title: item.tabTitle || item.label }
  }
  const evt = { currentTarget: { dataset } }
  page[item.tap](evt)
  return true
}

module.exports = {
  HUB_KITS,
  findKit,
  buildKitBadges,
  childBadge,
  HUB_SECTIONS,
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
  MANY_ENTRIES,
  COLLAPSE_STORAGE_KEY,
  buildCatalog,
  buildSecMeta,
  gridOf,
  gridClass,
  normalizeCollapsed,
  allCollapsed,
  toggleAllCollapsed,
  buildHubView,
  searchEntries,
  sectionFlags,
  invokeItem
}
