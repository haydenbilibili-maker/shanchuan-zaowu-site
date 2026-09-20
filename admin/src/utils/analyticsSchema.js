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
  ATLAS: 'atlas',
  CUSTOM: 'custom',
  GIFT: 'gift',
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
  [MODULE.ATLAS]: { name: '山海图鉴', icon: '🗺️', color: '#009688' },
  [MODULE.CUSTOM]: { name: '定制/伴宠', icon: '🎨', color: '#d4af37' },
  [MODULE.GIFT]: { name: '礼赠', icon: '🎁', color: '#C4A76C' },
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
  // 2026-09-17 注册门禁：百科详情页未登录态整页模糊 + 原地一键注册（step: show/success）
  wiki_register_gate: { module: MODULE.ENCYCLOPEDIA, desc: '百科注册门禁漏斗（step: show/success）', targetType: 'wiki' },
  // 电商（含 legacy）
  view: { module: MODULE.COMMERCE, desc: '商品浏览(legacy)', targetType: 'product' },
  collect: { module: MODULE.COMMERCE, desc: '收藏(legacy)', targetType: 'product' },
  share: { module: MODULE.COMMERCE, desc: '分享(legacy)', targetType: 'product' },
  search: { module: MODULE.COMMERCE, desc: '搜索(legacy)', targetType: 'keyword' },
  product_view: { module: MODULE.COMMERCE, desc: '商详浏览', targetType: 'product' },
  product_add_cart: { module: MODULE.COMMERCE, desc: '加入购物车', targetType: 'product' },
  cart_view: { module: MODULE.COMMERCE, desc: '购物车浏览', targetType: 'cart' },
  checkout_extra_add: { module: MODULE.COMMERCE, desc: '结账台加购（顺手件/凑单）', targetType: 'product' },
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
  identify_reused: { module: MODULE.IDENTIFY, desc: '同图复用既有记录（未重复调用模型）', targetType: 'identification' },
  identify_fail: { module: MODULE.IDENTIFY, desc: '识别失败', targetType: 'identification' },
  identify_result_view: { module: MODULE.IDENTIFY, desc: '结果页浏览', targetType: 'identification' },
  identify_save_atlas: { module: MODULE.IDENTIFY, desc: '保存图鉴', targetType: 'identification' },
  identify_save_atlas_gate: { module: MODULE.IDENTIFY, desc: '保存图鉴注册引导漏斗（step: show/go_register/dismiss/resume_success）', targetType: 'identification' },
  identify_result_gate: { module: MODULE.IDENTIFY, desc: '看结果注册引导漏斗（step: show/go_register/dismiss/resume_success）', targetType: 'identification' },
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
  user_center_view: { module: MODULE.USER, desc: '我的页浏览', targetType: 'user' },
  // —— 补登记（2026-09-16 与小程序 eventSchema 对齐）· IDENTIFY ——
  identify_share_link: { module: MODULE.IDENTIFY, desc: '转发/朋友圈分享（channel: wechat/timeline）', targetType: 'identification' },
  // —— 补登记（2026-09-16 与小程序 eventSchema 对齐）· ATLAS ——
  atlas_view: { module: MODULE.ATLAS, desc: '打开图鉴', targetType: 'atlas' },
  atlas_card_open: { module: MODULE.ATLAS, desc: '打开图鉴卡片', targetType: 'species' },
  atlas_collect: { module: MODULE.ATLAS, desc: '采集解锁', targetType: 'species' },
  atlas_scan: { module: MODULE.ATLAS, desc: '扫描馆内印记', targetType: 'spot' },
  atlas_log_view: { module: MODULE.ATLAS, desc: '查看采集日志', targetType: 'journal' },
  atlas_to_product: { module: MODULE.ATLAS, desc: '图鉴跳商详', targetType: 'product' },
  atlas_to_gallery: { module: MODULE.ATLAS, desc: '图鉴跳馆藏', targetType: 'category' },
  // —— 补登记（2026-09-16 与小程序 eventSchema 对齐）· CUSTOM ——
  framer_recruit_enter: { module: MODULE.CUSTOM, desc: '标本师招募进入', targetType: 'from' },
  framer_recruit_cta: { module: MODULE.CUSTOM, desc: '标本师招募 CTA', targetType: 'channel' },
  framer_recruit_submit: { module: MODULE.CUSTOM, desc: '标本师合作申请提交', targetType: 'channel' },
  // —— 补登记（2026-09-16 与小程序 eventSchema 对齐）· CARE ——
  care_tip_message_open: { module: MODULE.CARE, desc: '养护提醒消息打开', targetType: 'order' },
  care_my_specimen_tap: { module: MODULE.CARE, desc: '我的标本养护点击', targetType: 'specimen' },
  // —— 补登记（2026-09-16 与小程序 eventSchema 对齐）· GIFT ——
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
  // —— 补登记（2026-09-16 与小程序 eventSchema 对齐）· COMMUNITY ——
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
  wish_wall_egg: { module: MODULE.COMMUNITY, desc: '祈福墙彩蛋触发', targetType: 'egg' },
  wish_wall_lamp: { module: MODULE.COMMUNITY, desc: '祈福墙点灯仪式', targetType: 'day' },
  wish_wall_sound: { module: MODULE.COMMUNITY, desc: '祈福墙仪式音效开关', targetType: 'on' },
  wish_wall_play: { module: MODULE.COMMUNITY, desc: '祈福墙玩法（targetType=玩法 id：qian/cookie/zodiac/mbti）', targetType: 'play' },
  wish_wall_reco: { module: MODULE.COMMUNITY, desc: '祈福墙祈运弱推（targetType=祈运标签 key）', targetType: 'reco' },
  wish_wall_register_gate: { module: MODULE.COMMUNITY, desc: '祈福墙注册引导漏斗（step: show/go_register/dismiss/fail_*/resume_success；注册成功后另有 to_coupons/to_shop 两个「下一步」点击，属转化**之后**的行为、不计入漏斗）', targetType: 'wish_wall' },
  wish_ritual_gate: { module: MODULE.COMMUNITY, desc: '祈福墙连续记录云存注册漏斗（step: show/go_register/dismiss/fail_*/resume_success）', targetType: 'wish_wall' },
  muyu_cert_gate: { module: MODULE.COMMUNITY, desc: '祈福墙功德证领取漏斗（step: show/go_register/dismiss/fail_*/resume_success）', targetType: 'wish_wall' },

  // —— 印刷物料码（二维码）转化（2026-09-20 产品负责人指派）——
  // 一次扫码记一条（step=open）；页面解析不到且无法重映射时再补一条（step=fallback_home = 码已失效）。
  // 注意：**漏斗归因不靠本事件**，而是会话内所有事件都带 `entrySource=qr:<key>`
  // （小程序 app.js#maybeTrackQrMaterial → session.setEntrySource → index.js#buildPayload）；
  // 本事件只负责算漏斗第一环「扫码进入」。物料登记表见下方 QR_MATERIALS
  // （小程序镜像 utils/analytics/qrMaterial.js），两端漂移由 check:analytics-schema 拦。
  qr_material_enter: { module: MODULE.SYSTEM, desc: '物料码扫码进入（targetId=物料 key；step: open/fallback_home）', targetType: 'qr_material' },

  // —— 补登记（2026-09-16 与小程序 eventSchema 对齐）· USER ——
  member_card_flip: { module: MODULE.USER, desc: '会员卡翻面', targetType: 'member_card' },
  member_code_show: { module: MODULE.USER, desc: '展示会员码', targetType: 'member_card' },
  level_up: { module: MODULE.USER, desc: '会员等级提升', targetType: 'level' },
  birthday_gift_claimed: { module: MODULE.USER, desc: '领取生日礼', targetType: 'gift' },
  onboarding_start: { module: MODULE.USER, desc: '新手引导开始', targetType: 'onboarding' },
  onboarding_complete: { module: MODULE.USER, desc: '新手引导完成', targetType: 'onboarding' },
  phone_bind_success: { module: MODULE.USER, desc: '手机号绑定成功', targetType: 'user' },
  feedback_submit: { module: MODULE.USER, desc: '提交反馈', targetType: 'feedback' },
  invoice_request_submit: { module: MODULE.USER, desc: '提交开票申请', targetType: 'invoice' },
  // —— 补登记（2026-09-16 与小程序 eventSchema 对齐）· COMMERCE ——
  product_favorite: { module: MODULE.COMMERCE, desc: '收藏藏品', targetType: 'product' },
  product_wishlist: { module: MODULE.COMMERCE, desc: '想要（候补）', targetType: 'product' },
  product_deposit_paid: { module: MODULE.COMMERCE, desc: '定金支付成功', targetType: 'product' },
  // —— 补登记（2026-09-16 与小程序 eventSchema 对齐）· STORE ——
  product_experience_store_click: { module: MODULE.STORE, desc: '藏品体验门店点击', targetType: 'store' },
  store_walking_guide_view: { module: MODULE.STORE, desc: '门店步行引导浏览', targetType: 'store' },
  // —— 补登记（2026-09-16 与小程序 eventSchema 对齐）· EXPLORE ——
  framer_recruit_entry: { module: MODULE.EXPLORE, desc: '标本师招募入口', targetType: 'recruit' },
  // —— 补登记（2026-09-16 与小程序 eventSchema 对齐）· MESSAGE ——
  message_queue: { module: MODULE.MESSAGE, desc: '消息队列切换', targetType: 'queue' }
}

/**
 * 印刷物料码（二维码）登记表 —— **与小程序 `utils/analytics/qrMaterial.js` 的 QR_MATERIALS 同值**。
 *
 * · `key` = 归因值：app 级入口识别到码后把 `entrySource = 'qr:<key>'` 写进会话，
 *   此后该会话内所有事件都带它，故报表必须按 `entrySource === 'qr:<key>'` 过滤明细；
 * · `scene` 是生成码时写进 `scene` 的原始串（`generate-store-qr.js --scene`）；
 * · `targetPage` 是这张码指向的页面，对应漏斗第二步 `page_view` 的 `page` 判据；
 * · `convertAction` 是该物料的关键转化事件，对应漏斗终点。
 *
 * ⚠️ `analytics_daily`（动作级日汇总）**没有来源维度**，所以本表只能在 `user_behaviors`
 *    明细上过滤使用 —— 见 `admin/src/components/BehaviorAnalytics.vue` 的物料码监测卡片。
 * ⚠️ `key` 一旦发布不可改（已印出的码与已入库的 `entrySource` 都按它聚合）。
 */
export const QR_MATERIALS = [
  {
    key: 'identify_store',
    label: '门店 AI 识别码',
    scene: 'from=store_qr',
    targetPage: 'subpackages/feature/identify/index',
    convertAction: 'identify_success',
    desc: '门店立牌/桌牌，扫码进 AI 识别主页'
  },
  {
    key: 'register_counter',
    label: '收银台注册码',
    scene: 'from=counter_qr',
    targetPage: 'subpackages/extra/user/onboarding/index',
    convertAction: 'onboarding_complete',
    desc: '收银台「新用户注册」立牌，扫码进注册页领新客礼'
  },
  {
    key: 'wish_wall_store',
    label: '祈福墙立牌码',
    scene: 'from=store_qr&k=mashangyou',
    targetPage: 'subpackages/feature/wish-wall/index',
    convertAction: 'wish_wall_post',
    desc: '祈福墙立牌，扫码进「马上有」祈福墙'
  }
]

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
    key: 'identify_gate',
    name: 'AI 识别 · 注册钩子',
    module: MODULE.IDENTIFY,
    icon: '🎁',
    color: '#C4A76C',
    steps: [
      { action: 'identify_save_atlas_gate:show', label: '引导曝光' },
      { action: 'identify_save_atlas_gate:go_register', label: '去注册' },
      { action: 'identify_save_atlas_gate:resume_success', label: '注册完成并写入图鉴', endpoint: true }
    ]
  },
  {
    key: 'identify_result_gate',
    name: 'AI 识别 · 看结果注册钩子',
    module: MODULE.IDENTIFY,
    icon: '🔐',
    color: '#8D6E63',
    steps: [
      { action: 'identify_result_gate:show', label: '看结果引导曝光' },
      { action: 'identify_result_gate:go_register', label: '去注册' },
      { action: 'identify_result_gate:resume_success', label: '注册完成并解锁结果', endpoint: true }
    ]
  },
  {
    key: 'wish_wall_register_gate',
    name: '祈福墙 · 落愿注册钩子',
    module: MODULE.COMMUNITY,
    icon: '🕯️',
    color: '#C4A76C',
    steps: [
      { action: 'wish_wall_register_gate:show', label: '落愿时注册引导曝光' },
      { action: 'wish_wall_register_gate:go_register', label: '点「去注册」' },
      { action: 'wish_wall_register_gate:dismiss', label: '先不挂' },
      { action: 'wish_wall_register_gate:resume_success', label: '注册完成并自动续发心愿', endpoint: true }
    ]
  },
  {
    key: 'wish_ritual_gate',
    name: '祈福墙 · 连灯记录云存钩子',
    module: MODULE.COMMUNITY,
    icon: '🏮',
    color: '#8D6E63',
    steps: [
      { action: 'wish_ritual_gate:show', label: '有可丢进展时曝光' },
      { action: 'wish_ritual_gate:go_register', label: '点「同意并一键注册」' },
      { action: 'wish_ritual_gate:dismiss', label: '先存着' },
      { action: 'wish_ritual_gate:resume_success', label: '注册完成并同步上云', endpoint: true }
    ]
  },
  {
    key: 'muyu_cert_gate',
    name: '祈福墙 · 功德证领取钩子',
    module: MODULE.COMMUNITY,
    icon: '📜',
    color: '#C4A76C',
    steps: [
      { action: 'muyu_cert_gate:show', label: '里程点入口曝光' },
      { action: 'muyu_cert_gate:go_register', label: '点「同意并一键注册」' },
      { action: 'muyu_cert_gate:dismiss', label: '先不领' },
      { action: 'muyu_cert_gate:resume_success', label: '证书已发且功德同步上云', endpoint: true }
    ]
  },
  // —— 印刷物料码 ——
  // ⚠️ 这里**刻意不放**物料漏斗：通用 `funnelData` 只按 `action` 全局聚合（既不看 `material`
  //    也不看步骤上的 `page`），放进来会渲染出 3 条「扫码进入=三张码之和 / 到达目标页=全站
  //    page_view 总量」的虚高且互相重复的漏斗 —— 数字错比没有更糟。
  //    按物料拆分的正确口径在 `BehaviorAnalytics.vue` 的「📱 物料码转化监测」卡片
  //    （按 `entrySource === 'qr:<key>'` 过滤 `user_behaviors` 明细，四环 + 失效档）。
  //    若要把物料漏斗搬进通用区，先让 `funnelData` 支持 `material` / `page` 过滤。
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
