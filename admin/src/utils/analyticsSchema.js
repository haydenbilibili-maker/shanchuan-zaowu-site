/**
 * 埋点目录（与小程序 utils/analytics/eventSchema.js 同构）
 * - 13 个业务模块
 * - 80+ 事件
 * - 看板/PRD 的单一事实来源
 *
 * 同步策略：以小程序仓库为主。修改时请保持 EVENTS 顺序一致。
 */

export const MODULE = {
  SYSTEM: 'system',
  EXPLORE: 'explore',
  ENCYCLOPEDIA: 'encyclopedia',
  COMMERCE: 'commerce',
  STORE: 'store',
  BOOKING: 'booking',
  IDENTIFY: 'identify',
  CUSTOM: 'custom',
  CARE: 'care',
  MESSAGE: 'message',
  SUPPORT: 'support',
  COMMUNITY: 'community',
  USER: 'user'
}

export const MODULE_META = {
  [MODULE.SYSTEM]: { name: '系统/页面', icon: '⚙️', color: '#909399' },
  [MODULE.EXPLORE]: { name: '探索首页', icon: '🧭', color: '#409EFF' },
  [MODULE.ENCYCLOPEDIA]: { name: '馆藏/百科', icon: '📚', color: '#67C23A' },
  [MODULE.COMMERCE]: { name: '电商交易', icon: '🛒', color: '#E6A23C' },
  [MODULE.STORE]: { name: '门店', icon: '🏪', color: '#F56C6C' },
  [MODULE.BOOKING]: { name: '预约', icon: '📅', color: '#9C27B0' },
  [MODULE.IDENTIFY]: { name: 'AI 鉴定', icon: '🔍', color: '#00BCD4' },
  [MODULE.CUSTOM]: { name: '定制/伴宠', icon: '🎨', color: '#d4af37' },
  [MODULE.CARE]: { name: '养护', icon: '🌿', color: '#52B788' },
  [MODULE.MESSAGE]: { name: '消息', icon: '✉️', color: '#3F51B5' },
  [MODULE.SUPPORT]: { name: '客服', icon: '💬', color: '#FF5722' },
  [MODULE.COMMUNITY]: { name: '社区', icon: '👥', color: '#795548' },
  [MODULE.USER]: { name: '会员', icon: '👤', color: '#607D8B' }
}

/** action -> { module, desc, targetType } */
export const EVENTS = {
  // 系统
  page_view: { module: MODULE.SYSTEM, desc: '页面曝光', targetType: 'page' },
  page_leave: { module: MODULE.SYSTEM, desc: '页面离开', targetType: 'page' },
  tab_switch: { module: MODULE.SYSTEM, desc: '底部 Tab 切换', targetType: 'tab' },
  app_launch: { module: MODULE.SYSTEM, desc: '小程序启动', targetType: 'app' },
  // 探索
  explore_store_card_click: { module: MODULE.EXPLORE, desc: '探索页门店卡片点击', targetType: 'store' },
  // 馆藏
  encyclopedia_content_click: { module: MODULE.ENCYCLOPEDIA, desc: '百科内容点击', targetType: 'wiki' },
  encyclopedia_product_click: { module: MODULE.ENCYCLOPEDIA, desc: '百科关联商品点击', targetType: 'product' },
  wiki_to_product: { module: MODULE.ENCYCLOPEDIA, desc: '百科跳商详', targetType: 'product' },
  // 电商（含 legacy）
  view: { module: MODULE.COMMERCE, desc: '商品浏览(legacy)', targetType: 'product' },
  collect: { module: MODULE.COMMERCE, desc: '收藏(legacy)', targetType: 'product' },
  share: { module: MODULE.COMMERCE, desc: '分享(legacy)', targetType: 'product' },
  search: { module: MODULE.COMMERCE, desc: '搜索(legacy)', targetType: 'keyword' },
  product_view: { module: MODULE.COMMERCE, desc: '商详浏览', targetType: 'product' },
  product_add_cart: { module: MODULE.COMMERCE, desc: '加入购物车', targetType: 'product' },
  cart_view: { module: MODULE.COMMERCE, desc: '购物车浏览', targetType: 'cart' },
  order_submit: { module: MODULE.COMMERCE, desc: '提交订单', targetType: 'order' },
  // 门店
  store_tab_enter: { module: MODULE.STORE, desc: '进入这有店 Tab', targetType: 'store_tab' },
  store_switch: { module: MODULE.STORE, desc: '切换门店', targetType: 'store' },
  store_lbs_switch: { module: MODULE.STORE, desc: 'LBS 建议切店', targetType: 'store' },
  store_zone_view: { module: MODULE.STORE, desc: '展陈卡片曝光', targetType: 'zone' },
  store_zone_detail: { module: MODULE.STORE, desc: '展陈详情浏览', targetType: 'zone' },
  store_zone_to_product: { module: MODULE.STORE, desc: '展陈跳商详', targetType: 'product' },
  store_zone_to_wiki: { module: MODULE.STORE, desc: '展陈跳百科', targetType: 'wiki' },
  store_navigate_map: { module: MODULE.STORE, desc: '门店导航', targetType: 'store' },
  store_call: { module: MODULE.STORE, desc: '门店拨号', targetType: 'store' },
  store_booking_click: { module: MODULE.STORE, desc: '门店发起预约', targetType: 'store' },
  store_checkin: { module: MODULE.STORE, desc: '到店签到', targetType: 'store' },
  // 预约
  booking_page_enter: { module: MODULE.BOOKING, desc: '进入预约页', targetType: 'booking' },
  booking_submit: { module: MODULE.BOOKING, desc: '提交预约', targetType: 'booking' },
  booking_store_switch: { module: MODULE.BOOKING, desc: '预约页切换门店', targetType: 'store' },
  // AI 鉴定
  identify_entry_click: { module: MODULE.IDENTIFY, desc: '鉴定入口点击', targetType: 'identification' },
  identify_start: { module: MODULE.IDENTIFY, desc: '开始识别', targetType: 'identification' },
  identify_success: { module: MODULE.IDENTIFY, desc: '识别成功', targetType: 'identification' },
  identify_fail: { module: MODULE.IDENTIFY, desc: '识别失败', targetType: 'identification' },
  identify_result_view: { module: MODULE.IDENTIFY, desc: '结果页浏览', targetType: 'identification' },
  identify_save_atlas: { module: MODULE.IDENTIFY, desc: '保存图鉴', targetType: 'identification' },
  identify_feedback_submit: { module: MODULE.IDENTIFY, desc: '提交纠错', targetType: 'identification' },
  identify_share_poster: { module: MODULE.IDENTIFY, desc: '分享海报', targetType: 'identification' },
  identify_retake_click: { module: MODULE.IDENTIFY, desc: '低置信重拍', targetType: 'identification' },
  identify_expert_cta: { module: MODULE.IDENTIFY, desc: '联系专员', targetType: 'identification' },
  identify_to_product: { module: MODULE.IDENTIFY, desc: '鉴定跳商详', targetType: 'product' },
  identify_to_wiki: { module: MODULE.IDENTIFY, desc: '鉴定跳百科', targetType: 'wiki' },
  identify_to_gallery: { module: MODULE.IDENTIFY, desc: '鉴定跳图鉴', targetType: 'category' },
  // 定制 / 伴宠
  custom_enter: { module: MODULE.CUSTOM, desc: '进入标本定制', targetType: 'source' },
  custom_hub_enter: { module: MODULE.CUSTOM, desc: '定制中心', targetType: 'from' },
  custom_hub_select: { module: MODULE.CUSTOM, desc: '选择定制类型', targetType: 'type' },
  custom_step_view: { module: MODULE.CUSTOM, desc: '定制步骤', targetType: 'step' },
  custom_ar_preview: { module: MODULE.CUSTOM, desc: 'AR 预览', targetType: 'mode' },
  custom_book_store: { module: MODULE.CUSTOM, desc: '定制预约到店', targetType: 'draft' },
  custom_order_submit: { module: MODULE.CUSTOM, desc: '定制下单', targetType: 'product' },
  custom_inquiry_enter: { module: MODULE.CUSTOM, desc: '企业询价进入', targetType: 'type' },
  custom_inquiry_submit: { module: MODULE.CUSTOM, desc: '企业询价提交', targetType: 'type' },
  custom_orders_enter: { module: MODULE.CUSTOM, desc: '定制订单列表', targetType: 'from' },
  pet_memorial_enter: { module: MODULE.CUSTOM, desc: '伴宠进入', targetType: 'from' },
  pet_memorial_step_view: { module: MODULE.CUSTOM, desc: '伴宠步骤', targetType: 'step' },
  pet_memorial_submit: { module: MODULE.CUSTOM, desc: '伴宠提交', targetType: 'order' },
  pet_memorial_list_enter: { module: MODULE.CUSTOM, desc: '伴宠列表', targetType: 'from' },
  pet_memorial_quote_confirm: { module: MODULE.CUSTOM, desc: '伴宠报价确认', targetType: 'order' },
  pet_intake_book: { module: MODULE.CUSTOM, desc: '伴宠预约交接', targetType: 'order' },
  // 养护
  care_hub_enter: { module: MODULE.CARE, desc: '养护中心', targetType: 'from' },
  care_guide_view: { module: MODULE.CARE, desc: '养护指南', targetType: 'category' },
  care_escalation_support: { module: MODULE.CARE, desc: '养护升级专员', targetType: 'category' },
  // 消息
  message_filter: { module: MODULE.MESSAGE, desc: '消息分类筛选', targetType: 'category' },
  message_read: { module: MODULE.MESSAGE, desc: '消息已读', targetType: 'message' },
  message_action: { module: MODULE.MESSAGE, desc: '消息行动按钮', targetType: 'message' },
  message_mark_all_read: { module: MODULE.MESSAGE, desc: '全部已读', targetType: 'category' },
  message_delete: { module: MODULE.MESSAGE, desc: '删除消息', targetType: 'message' },
  // 客服
  support_topic_select: { module: MODULE.SUPPORT, desc: '选择咨询主题', targetType: 'topic' },
  support_call: { module: MODULE.SUPPORT, desc: '专员拨号', targetType: 'phone' },
  support_wechat_contact: { module: MODULE.SUPPORT, desc: '微信联系专员', targetType: 'topic' },
  support_ticket_submit: { module: MODULE.SUPPORT, desc: '提交工单', targetType: 'topic' },
  // 会员
  user_center_view: { module: MODULE.USER, desc: '我的页浏览', targetType: 'user' }
}

/** 已注册的漏斗（C 端核心转化路径） */
export const FUNNELS = [
  {
    key: 'identify',
    name: 'AI 鉴定漏斗',
    module: MODULE.IDENTIFY,
    icon: '🔍',
    color: '#00BCD4',
    steps: [
      { action: 'identify_entry_click', label: '入口点击' },
      { action: 'identify_start', label: '开始识别' },
      { action: 'identify_success', label: '识别成功' },
      { action: 'identify_result_view', label: '查看结果' },
      { action: 'identify_save_atlas', label: '保存图鉴', endpoint: true },
      { action: 'identify_to_product', label: '跳到商详', endpoint: true }
    ]
  },
  {
    key: 'custom',
    name: '标本定制漏斗',
    module: MODULE.CUSTOM,
    icon: '🎨',
    color: '#d4af37',
    steps: [
      { action: 'custom_hub_enter', label: '定制中心' },
      { action: 'custom_hub_select', label: '选择类型' },
      { action: 'custom_step_view', label: '配置步骤' },
      { action: 'custom_book_store', label: '预约到店' },
      { action: 'custom_order_submit', label: '提交下单', endpoint: true }
    ]
  },
  {
    key: 'pet',
    name: '伴宠纪念漏斗',
    module: MODULE.CUSTOM,
    icon: '🐾',
    color: '#FF8A65',
    steps: [
      { action: 'pet_memorial_enter', label: '进入伴宠' },
      { action: 'pet_memorial_step_view', label: '配置步骤' },
      { action: 'pet_memorial_submit', label: '提交意向' },
      { action: 'pet_memorial_quote_confirm', label: '报价确认' },
      { action: 'pet_intake_book', label: '预约交接', endpoint: true }
    ]
  },
  {
    key: 'commerce',
    name: '电商成交漏斗',
    module: MODULE.COMMERCE,
    icon: '🛒',
    color: '#E6A23C',
    steps: [
      { action: 'product_view', label: '商详浏览' },
      { action: 'product_add_cart', label: '加入购物车' },
      { action: 'cart_view', label: '购物车页' },
      { action: 'order_submit', label: '提交订单', endpoint: true }
    ]
  },
  {
    key: 'store',
    name: '到店转化漏斗',
    module: MODULE.STORE,
    icon: '🏪',
    color: '#F56C6C',
    steps: [
      { action: 'store_tab_enter', label: '进入这有店' },
      { action: 'store_zone_view', label: '查看展陈' },
      { action: 'store_zone_detail', label: '展陈详情' },
      { action: 'store_booking_click', label: '发起预约' },
      { action: 'store_checkin', label: '到店签到', endpoint: true }
    ]
  },
  {
    key: 'support',
    name: '客服求助漏斗',
    module: MODULE.SUPPORT,
    icon: '💬',
    color: '#FF5722',
    steps: [
      { action: 'support_topic_select', label: '选话题' },
      { action: 'support_ticket_submit', label: '提交工单', endpoint: true },
      { action: 'support_call', label: '直接拨号', endpoint: true },
      { action: 'support_wechat_contact', label: '微信联系', endpoint: true }
    ]
  }
]

export function getEventMeta(action) {
  return EVENTS[action] || null
}

/** 给定 action 集合，按 module 聚合 */
export function groupByModule(rows) {
  const map = {}
  Object.values(MODULE).forEach(m => { map[m] = { count: 0, uv: new Set(), actions: {} } })
  rows.forEach(r => {
    const meta = getEventMeta(r.action)
    const mod = meta?.module || r.module || MODULE.SYSTEM
    if (!map[mod]) map[mod] = { count: 0, uv: new Set(), actions: {} }
    map[mod].count += (r.count || 1)
    if (r.userId) map[mod].uv.add(r.userId)
    if (Array.isArray(r.uv)) r.uv.forEach(u => map[mod].uv.add(u))
    map[mod].actions[r.action] = (map[mod].actions[r.action] || 0) + (r.count || 1)
  })
  return map
}

export const ACTION_NAMES = Object.keys(EVENTS)
