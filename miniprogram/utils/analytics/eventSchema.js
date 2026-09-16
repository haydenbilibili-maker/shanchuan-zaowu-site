/**
 * 事件注册表 — 新增埋点须在此登记 action / module / 说明
 * 看板与 PRD 以本文件为单一事实来源
 */
const { MODULE } = require('./constants')

/** @type {Record<string, { module: string, desc: string, targetType?: string }>} */
const EVENTS = {
  // —— 系统 / 页面 ——
  page_view: { module: MODULE.SYSTEM, desc: '页面曝光', targetType: 'page' },
  page_leave: { module: MODULE.SYSTEM, desc: '页面离开', targetType: 'page' },
  tab_switch: { module: MODULE.SYSTEM, desc: '底部 Tab 切换', targetType: 'tab' },
  app_launch: { module: MODULE.SYSTEM, desc: '小程序启动', targetType: 'app' },

  // —— 探索 ——
  explore_store_card_click: { module: MODULE.EXPLORE, desc: '探索页门店卡片点击', targetType: 'store' },

  // —— 馆藏 / 百科 ——
  encyclopedia_content_click: { module: MODULE.ENCYCLOPEDIA, desc: '百科内容点击', targetType: 'wiki' },
  encyclopedia_product_click: { module: MODULE.ENCYCLOPEDIA, desc: '百科关联藏品点击', targetType: 'product' },
  wiki_to_product: { module: MODULE.ENCYCLOPEDIA, desc: '百科跳商详', targetType: 'product' },

  // —— 电商 ——
  view: { module: MODULE.COMMERCE, desc: '藏品浏览（legacy）', targetType: 'product' },
  collect: { module: MODULE.COMMERCE, desc: '收藏（legacy）', targetType: 'product' },
  share: { module: MODULE.COMMERCE, desc: '分享（legacy）', targetType: 'product' },
  search: { module: MODULE.COMMERCE, desc: '搜索（legacy）', targetType: 'keyword' },
  product_view: { module: MODULE.COMMERCE, desc: '商详浏览', targetType: 'product' },
  product_add_cart: { module: MODULE.COMMERCE, desc: '加入购物车', targetType: 'product' },
  cart_view: { module: MODULE.COMMERCE, desc: '购物车页浏览', targetType: 'cart' },
  order_submit: { module: MODULE.COMMERCE, desc: '提交订单', targetType: 'order' },

  // —— 门店 ——
  store_tab_enter: { module: MODULE.STORE, desc: '进入这有店门店页', targetType: 'store_tab' },
  store_switch: { module: MODULE.STORE, desc: '切换门店', targetType: 'store' },
  store_lbs_switch: { module: MODULE.STORE, desc: 'LBS 建议切店', targetType: 'store' },
  store_zone_view: { module: MODULE.STORE, desc: '展陈卡片曝光', targetType: 'zone' },
  store_zone_detail: { module: MODULE.STORE, desc: '展陈详情浏览', targetType: 'zone' },
  store_zone_to_product: { module: MODULE.STORE, desc: '展陈跳商详', targetType: 'product' },
  store_zone_to_wiki: { module: MODULE.STORE, desc: '展陈跳百科', targetType: 'wiki' },
  store_navigate_map: { module: MODULE.STORE, desc: '门店导航', targetType: 'store' },
  store_call: { module: MODULE.STORE, desc: '门店拨号', targetType: 'store' },
  store_booking_click: { module: MODULE.STORE, desc: '门店页发起预约', targetType: 'store' },
  store_checkin: { module: MODULE.STORE, desc: '到店签到', targetType: 'store' },

  // —— 预约 ——
  booking_page_enter: { module: MODULE.BOOKING, desc: '进入预约页', targetType: 'booking' },
  booking_submit: { module: MODULE.BOOKING, desc: '提交预约', targetType: 'booking' },
  booking_store_switch: { module: MODULE.BOOKING, desc: '预约页切换门店', targetType: 'store' },

  // —— AI 鉴定 ——
  identify_entry_click: { module: MODULE.IDENTIFY, desc: '鉴定入口点击', targetType: 'identification' },
  identify_start: { module: MODULE.IDENTIFY, desc: '开始识别', targetType: 'identification' },
  identify_success: { module: MODULE.IDENTIFY, desc: '识别成功', targetType: 'identification' },
  identify_reused: { module: MODULE.IDENTIFY, desc: '同图复用既有记录（未重复调用模型）', targetType: 'identification' },
  identify_fail: { module: MODULE.IDENTIFY, desc: '识别失败', targetType: 'identification' },
  identify_result_view: { module: MODULE.IDENTIFY, desc: '结果页浏览', targetType: 'identification' },
  identify_save_atlas: { module: MODULE.IDENTIFY, desc: '保存图鉴', targetType: 'identification' },
  identify_save_atlas_gate: { module: MODULE.IDENTIFY, desc: '保存图鉴注册引导漏斗（step: show/go_register/dismiss/resume_success）', targetType: 'identification' },
  identify_result_gate: { module: MODULE.IDENTIFY, desc: '看结果注册引导漏斗（step: show/go_register/dismiss/resume_success）', targetType: 'identification' },
  identify_feedback_submit: { module: MODULE.IDENTIFY, desc: '提交纠错', targetType: 'identification' },
  identify_share_poster: { module: MODULE.IDENTIFY, desc: '分享海报', targetType: 'identification' },
  identify_share_link: { module: MODULE.IDENTIFY, desc: '转发/朋友圈分享（channel: wechat/timeline）', targetType: 'identification' },
  identify_retake_click: { module: MODULE.IDENTIFY, desc: '低置信重拍', targetType: 'identification' },
  identify_expert_cta: { module: MODULE.IDENTIFY, desc: '联系专员', targetType: 'identification' },
  identify_to_product: { module: MODULE.IDENTIFY, desc: '鉴定跳商详', targetType: 'product' },
  identify_to_wiki: { module: MODULE.IDENTIFY, desc: '鉴定跳百科', targetType: 'wiki' },
  identify_to_gallery: { module: MODULE.IDENTIFY, desc: '鉴定跳图鉴', targetType: 'category' },

  // —— 山海图鉴 / 采集 ——
  atlas_view: { module: MODULE.ATLAS, desc: '打开图鉴', targetType: 'atlas' },
  atlas_card_open: { module: MODULE.ATLAS, desc: '打开图鉴卡片', targetType: 'species' },
  atlas_collect: { module: MODULE.ATLAS, desc: '采集解锁', targetType: 'species' },
  atlas_scan: { module: MODULE.ATLAS, desc: '扫描馆内印记', targetType: 'spot' },
  atlas_log_view: { module: MODULE.ATLAS, desc: '查看采集日志', targetType: 'journal' },
  atlas_to_product: { module: MODULE.ATLAS, desc: '图鉴跳商详', targetType: 'product' },
  atlas_to_gallery: { module: MODULE.ATLAS, desc: '图鉴跳馆藏', targetType: 'category' },

  // —— 定制 / 伴宠 ——
  custom_enter: { module: MODULE.CUSTOM, desc: '进入标制定制', targetType: 'source' },
  custom_hub_enter: { module: MODULE.CUSTOM, desc: '定制中心', targetType: 'from' },
  custom_hub_select: { module: MODULE.CUSTOM, desc: '选择定制类型', targetType: 'type' },
  custom_step_view: { module: MODULE.CUSTOM, desc: '定制步骤', targetType: 'step' },
  custom_ar_preview: { module: MODULE.CUSTOM, desc: 'AR 预览', targetType: 'mode' },
  custom_book_store: { module: MODULE.CUSTOM, desc: '定制预约到店', targetType: 'draft' },
  custom_order_submit: { module: MODULE.CUSTOM, desc: '定制下单', targetType: 'product' },
  custom_inquiry_enter: { module: MODULE.CUSTOM, desc: '企业询价进入', targetType: 'type' },
  custom_inquiry_submit: { module: MODULE.CUSTOM, desc: '企业询价提交', targetType: 'type' },
  framer_recruit_enter: { module: MODULE.CUSTOM, desc: '标本师招募进入', targetType: 'from' },
  framer_recruit_cta: { module: MODULE.CUSTOM, desc: '标本师招募 CTA', targetType: 'channel' },
  framer_recruit_submit: { module: MODULE.CUSTOM, desc: '标本师合作申请提交', targetType: 'channel' },
  custom_orders_enter: { module: MODULE.CUSTOM, desc: '定制订单列表', targetType: 'from' },
  pet_memorial_enter: { module: MODULE.CUSTOM, desc: '伴宠进入', targetType: 'from' },
  pet_memorial_step_view: { module: MODULE.CUSTOM, desc: '伴宠步骤', targetType: 'step' },
  pet_memorial_submit: { module: MODULE.CUSTOM, desc: '伴宠提交', targetType: 'order' },
  pet_memorial_list_enter: { module: MODULE.CUSTOM, desc: '伴宠列表', targetType: 'from' },
  pet_memorial_quote_confirm: { module: MODULE.CUSTOM, desc: '伴宠报价确认', targetType: 'order' },
  pet_intake_book: { module: MODULE.CUSTOM, desc: '伴宠预约交接', targetType: 'order' },

  // —— 养护 ——
  care_hub_enter: { module: MODULE.CARE, desc: '养护中心', targetType: 'from' },
  care_guide_view: { module: MODULE.CARE, desc: '养护指南', targetType: 'category' },
  care_escalation_support: { module: MODULE.CARE, desc: '养护升级专员', targetType: 'category' },
  care_tip_message_open: { module: MODULE.CARE, desc: '养护提醒消息打开', targetType: 'order' },

  // —— 消息 ——
  message_filter: { module: MODULE.MESSAGE, desc: '消息分类筛选', targetType: 'category' },
  message_read: { module: MODULE.MESSAGE, desc: '消息已读', targetType: 'message' },
  message_action: { module: MODULE.MESSAGE, desc: '消息行动按钮', targetType: 'message' },
  message_mark_all_read: { module: MODULE.MESSAGE, desc: '全部已读', targetType: 'category' },
  message_delete: { module: MODULE.MESSAGE, desc: '删除消息', targetType: 'message' },

  // —— 专员 ——
  support_topic_select: { module: MODULE.SUPPORT, desc: '选择咨询主题', targetType: 'topic' },
  support_call: { module: MODULE.SUPPORT, desc: '专员拨号', targetType: 'phone' },
  support_wechat_contact: { module: MODULE.SUPPORT, desc: '微信联系专员', targetType: 'topic' },
  support_ticket_submit: { module: MODULE.SUPPORT, desc: '提交工单', targetType: 'topic' },

  // —— 礼赠 ——
  // 这 15 个事件此前已在页面调用但从未登记，且 constants.js 缺 gift_ 前缀映射，
  // 导致全部被 inferModule 兜底成 system（污染模块分布）。2026-09-16 补登记。
  gift_entry_click: { module: MODULE.GIFT, desc: '礼赠入口点击', targetType: 'product' },
  gift_hub_enter: { module: MODULE.GIFT, desc: '进入礼赠场景页', targetType: 'hub' },
  gift_scene_select: { module: MODULE.GIFT, desc: '选择礼赠场景', targetType: 'scene' },
  gift_scene_product_tap: { module: MODULE.GIFT, desc: '礼赠场景商品点击', targetType: 'product' },
  gift_compose_enter: { module: MODULE.GIFT, desc: '进入礼笺撰写', targetType: 'gift' },
  gift_note_preset: { module: MODULE.GIFT, desc: '礼笺使用预设文案', targetType: 'note' },
  gift_voice_record: { module: MODULE.GIFT, desc: '录制礼赠语音', targetType: 'voice' },
  gift_pay_click: { module: MODULE.GIFT, desc: '礼赠下单支付点击', targetType: 'order' },
  gift_mine_enter: { module: MODULE.GIFT, desc: '进入我的礼赠', targetType: 'gift' },
  gift_mine_hub: { module: MODULE.GIFT, desc: '我的礼赠分栏切换', targetType: 'tab' },
  gift_mine_select: { module: MODULE.GIFT, desc: '我的礼赠筛选', targetType: 'segment' },
  gift_mine_open: { module: MODULE.GIFT, desc: '我的礼赠打开详情', targetType: 'gift' },
  gift_mine_action: { module: MODULE.GIFT, desc: '我的礼赠主操作', targetType: 'gift' },
  gift_mine_contact_flow: { module: MODULE.GIFT, desc: '我的礼赠联系收礼人', targetType: 'gift' },

  // —— 山海社区 ——
  community_entry_click: { module: MODULE.COMMUNITY, desc: '社区入口点击', targetType: 'community' },
  community_view: { module: MODULE.COMMUNITY, desc: '社区页浏览', targetType: 'community' },
  community_tab_switch: { module: MODULE.COMMUNITY, desc: '社区分栏切换', targetType: 'tab' },
  community_publish_entry_click: { module: MODULE.COMMUNITY, desc: '社区发布入口点击', targetType: 'community' },
  community_publish_enter: { module: MODULE.COMMUNITY, desc: '进入发布页', targetType: 'community' },
  community_publish_type_pick: { module: MODULE.COMMUNITY, desc: '选择发布类型', targetType: 'type' },
  community_publish_success: { module: MODULE.COMMUNITY, desc: '发布成功', targetType: 'community' },
  // —— 需求 28：马上有祈福弹幕（UGC 互动，治理在超管工作台-内容模块）——
  wish_wall_enter: { module: MODULE.COMMUNITY, desc: '祈福墙进入', targetType: 'from' },
  wish_wall_post: { module: MODULE.COMMUNITY, desc: '祈福弹幕发布', targetType: 'ok' },
  // 仪式与彩蛋：彩蛋 id / 日期键写在 targetId 上，用来判断"哪类彩蛋真的会被偶遇"
  wish_wall_egg: { module: MODULE.COMMUNITY, desc: '祈福墙彩蛋触发', targetType: 'egg' },
  wish_wall_lamp: { module: MODULE.COMMUNITY, desc: '祈福墙点灯仪式', targetType: 'day' },

  // —— 用户 / 会员 ——
  member_card_flip: { module: MODULE.USER, desc: '会员卡翻面', targetType: 'member_card' },
  member_code_show: { module: MODULE.USER, desc: '展示会员码', targetType: 'member_card' },
  level_up: { module: MODULE.USER, desc: '会员等级提升', targetType: 'level' },
  birthday_gift_claimed: { module: MODULE.USER, desc: '领取生日礼', targetType: 'gift' },
  onboarding_start: { module: MODULE.USER, desc: '新手引导开始', targetType: 'onboarding' },
  onboarding_complete: { module: MODULE.USER, desc: '新手引导完成', targetType: 'onboarding' },
  phone_bind_success: { module: MODULE.USER, desc: '手机号绑定成功', targetType: 'user' },
  feedback_submit: { module: MODULE.USER, desc: '提交反馈', targetType: 'feedback' },
  invoice_request_submit: { module: MODULE.USER, desc: '提交开票申请', targetType: 'invoice' },

  // —— 商品 / 门店（此前未登记的补充事件）——
  product_favorite: { module: MODULE.COMMERCE, desc: '收藏藏品', targetType: 'product' },
  product_wishlist: { module: MODULE.COMMERCE, desc: '想要（候补）', targetType: 'product' },
  product_deposit_paid: { module: MODULE.COMMERCE, desc: '定金支付成功', targetType: 'product' },
  product_experience_store_click: { module: MODULE.STORE, desc: '藏品体验门店点击', targetType: 'store' },
  store_walking_guide_view: { module: MODULE.STORE, desc: '门店步行引导浏览', targetType: 'store' },
  care_my_specimen_tap: { module: MODULE.CARE, desc: '我的标本养护点击', targetType: 'specimen' },
  framer_recruit_entry: { module: MODULE.EXPLORE, desc: '标本师招募入口', targetType: 'recruit' },
  message_queue: { module: MODULE.MESSAGE, desc: '消息队列切换', targetType: 'queue' },

  // —— 用户 ——
  user_center_view: { module: MODULE.USER, desc: '我的页浏览', targetType: 'user' }
}

function getEventMeta(action) {
  return EVENTS[action] || null
}

function resolveModule(action, extraModule) {
  if (extraModule) return extraModule
  const meta = getEventMeta(action)
  if (meta) return meta.module
  const { inferModule } = require('./constants')
  return inferModule(action)
}

module.exports = { EVENTS, getEventMeta, resolveModule }
