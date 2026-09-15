/**
 * 山海有信 — 默认消息模板（DB 无记录时使用）
 *
 * ## 语气指南（Tone）
 * 气质：维多利亚博物学家的奇珍柜——博物、自然、收藏、品鉴、权威、人性化。
 * 结构：事实 → 感受 → 连接。权威但不冷冰；人性化但不甜腻。
 *
 * 称谓
 *   - 顾客侧：默认「你」（朋友式）；避免客服腔「您」堆砌。
 *   - 工作流：中性陈述 + 克制祈使（「请到…安排」），不卖萌。
 *
 * 时态
 *   - 已发生：完成态（已入账 / 已启程 / 已入柜）。
 *   - 待办：温和祈使或留白（请在时限内… / 可前往…）。
 *
 * 推荐词
 *   标本、藏品、柜中、入册、启程、到柜、轻取轻放、馆员、候补、礼笺、山海有信
 *
 * 禁止词 / 禁止句式
 *   恭喜、火速、赶紧下单、亲、老板、请注意查收、已为您处理完毕、
 *   emoji 开头、直播电商话术、浮夸推销、科技感系统通知腔。
 *
 * 变量与业务语义不得改动；只改表达。订阅消息模板字段 ID 不在此改。
 *
 * queue:
 *   customer — 顾客信息（默认）
 *   workflow — 员工工作流（仅员工可见）
 *
 * 注意：投递通道仍用 notification_logs.channel = inapp | inapp_campaign，
 * 与本处 queue 无关。
 */
const QUEUE_CUSTOMER = 'customer'
const QUEUE_WORKFLOW = 'workflow'

/** 明确归入工作流的 eventType（兼容旧数据无 queue 字段时推断） */
const WORKFLOW_EVENT_TYPES = {
  staff_order_paid: true,
  staff_artisan_sku_sold: true,
  wishlist_restock_request: true,
  staff_deposit_paid: true,
  staff_deposit_balance_window: true,
  staff_deposit_forfeited: true,
  staff_deposit_settled: true,
  invoice_request_staff: true,
  approval_submitted: true,
  approval_approved: true,
  approval_rejected: true
}

function isWorkflowEventType(eventType) {
  const t = String(eventType || '').trim()
  if (!t) return false
  if (WORKFLOW_EVENT_TYPES[t]) return true
  if (t.indexOf('staff_') === 0) return true
  if (/_staff$/.test(t)) return true
  if (t.indexOf('approval_') === 0) return true
  return false
}

function resolveMessageQueue({ queue, audience, category, eventType, type } = {}) {
  const q = String(queue || '').trim()
  if (q === QUEUE_WORKFLOW || q === QUEUE_CUSTOMER) return q
  const aud = String(audience || '').trim()
  if (aud === 'staff' || aud === 'workflow') return QUEUE_WORKFLOW
  if (aud === 'user' || aud === 'customer') return QUEUE_CUSTOMER
  if (String(category || '') === 'ops') return QUEUE_WORKFLOW
  if (isWorkflowEventType(eventType || type)) return QUEUE_WORKFLOW
  return QUEUE_CUSTOMER
}

const DEFAULT_TEMPLATES = {
  order_created: {
    category: 'order',
    queue: QUEUE_CUSTOMER,
    priority: 'P0',
    titleTemplate: '订单待落定',
    contentTemplate:
      '柜中这几件标本已为你预留。\n{{productNames}}\n应付 ¥{{totalPrice}}\n请在 30 分钟内完成支付，逾期将自动释出。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  order_paid: {
    category: 'order',
    queue: QUEUE_CUSTOMER,
    priority: 'P0',
    titleTemplate: '藏品已入账',
    contentTemplate:
      '订单 {{orderNo}} 已收妥款项\n{{productLine}}\n实付 ¥{{totalPrice}}\n馆员将尽快备妥，启程时再信告你。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  staff_order_paid: {
    category: 'ops',
    queue: QUEUE_WORKFLOW,
    priority: 'P0',
    titleTemplate: '新单待发',
    contentTemplate:
      '【待处理】订单 {{orderNo}}\n实付 ¥{{totalPrice}}\n{{productNames}}\n请到订单管理安排启程。',
    actionUrlTemplate: 'subpackages/manager/manager/index?tab=2&title=订单管理'
  },
  staff_artisan_sku_sold: {
    category: 'ops',
    queue: QUEUE_WORKFLOW,
    priority: 'P1',
    titleTemplate: '藏品已售出',
    contentTemplate:
      '订单 {{orderNo}}\n「{{productNames}}」已售出。\n可在标本师工作台查看工单与提成。',
    actionUrlTemplate: 'subpackages/manager/artisan/works/index?mode=jobs'
  },
  wishlist_restock_request: {
    category: 'ops',
    queue: QUEUE_WORKFLOW,
    priority: 'P1',
    titleTemplate: '藏家想要补货',
    contentTemplate: '「{{productTitle}}」有藏家想要{{stockHint}}\n请安排新制作或补货。',
    actionUrlTemplate: 'subpackages/manager/manager/index?tab=1&title=藏品库&editId={{relatedId}}'
  },
  wishlist_registered: {
    category: 'activity',
    queue: QUEUE_CUSTOMER,
    priority: 'P1',
    titleTemplate: '候补已记下',
    contentTemplate:
      '「{{productTitle}}」已记入你的候补。\n到货或重新上架时，山海有信会再来一封。',
    actionUrlTemplate: 'subpackages/feature/detail/index?id={{relatedId}}'
  },
  wishlist_available: {
    category: 'activity',
    queue: QUEUE_CUSTOMER,
    priority: 'P0',
    titleTemplate: '候补藏品已回柜',
    contentTemplate:
      '「{{productTitle}}」已回到柜中，可前往选购。\n（候补是到货提醒，不锁定库存。）',
    actionUrlTemplate: 'subpackages/feature/detail/index?id={{relatedId}}'
  },
  staff_deposit_paid: {
    category: 'ops',
    queue: QUEUE_WORKFLOW,
    priority: 'P0',
    titleTemplate: '孤品定金已付',
    contentTemplate:
      '「{{productTitle}}」有人已付定金{{stockHint}}\n请优先制作并上架；上架后对方将进入尾款窗口。',
    actionUrlTemplate: 'subpackages/manager/artisan/index'
  },
  deposit_paid_confirm: {
    category: 'order',
    queue: QUEUE_CUSTOMER,
    priority: 'P0',
    titleTemplate: '定金已收妥',
    contentTemplate:
      '「{{productTitle}}」定金 ¥{{depositAmount}} 已入账。\n标本师将优先制作；上架后请在时限内付清尾款。逾期开放，定金按规则不予退还。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{orderId}}'
  },
  deposit_balance_due: {
    category: 'order',
    queue: QUEUE_CUSTOMER,
    priority: 'P0',
    titleTemplate: '尾款窗口已开启',
    contentTemplate:
      '「{{productTitle}}」已上架。请在 {{balanceWindowDays}} 日内付清尾款（约 ¥{{balanceAmount}}）。\n截止日 {{balanceDueLabel}}；逾期将对所有人开放，已付定金不予退还。',
    actionUrlTemplate: 'subpackages/feature/detail/index?id={{relatedId}}'
  },
  staff_deposit_balance_window: {
    category: 'ops',
    queue: QUEUE_WORKFLOW,
    priority: 'P1',
    titleTemplate: '定金进入尾款期',
    contentTemplate:
      '「{{productTitle}}」已上架，定金用户进入 {{balanceWindowDays}} 日尾款窗口。',
    actionUrlTemplate: 'subpackages/manager/deposit-ops/index'
  },
  deposit_forfeited: {
    category: 'order',
    queue: QUEUE_CUSTOMER,
    priority: 'P0',
    titleTemplate: '尾款已逾期',
    contentTemplate:
      '「{{productTitle}}」尾款已逾期，藏品已对所有人开放。\n按规则，已付定金不予退还。',
    actionUrlTemplate: 'subpackages/feature/detail/index?id={{relatedId}}'
  },
  staff_deposit_forfeited: {
    category: 'ops',
    queue: QUEUE_WORKFLOW,
    priority: 'P1',
    titleTemplate: '定金逾期已开放',
    contentTemplate:
      '「{{productTitle}}」定金尾款逾期，藏品已对线上开放（定金不退）。',
    actionUrlTemplate: 'subpackages/manager/deposit-ops/index'
  },
  staff_deposit_settled: {
    category: 'ops',
    queue: QUEUE_WORKFLOW,
    priority: 'P1',
    titleTemplate: '定金尾款已结清',
    contentTemplate:
      '「{{productTitle}}」尾款已付清，定金意向已结清。\n订单 {{orderNo}}',
    actionUrlTemplate: 'subpackages/manager/manager/index?tab=2&title=订单管理'
  },
  deposit_settled_confirm: {
    category: 'order',
    queue: QUEUE_CUSTOMER,
    priority: 'P0',
    titleTemplate: '尾款已结清',
    contentTemplate:
      '「{{productTitle}}」尾款已付清，定金已抵扣。\n订单 {{orderNo}}，馆员将尽快备妥启程。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{orderId}}'
  },
  order_shipped: {
    category: 'order',
    priority: 'P0',
    titleTemplate: '标本已启程',
    contentTemplate:
      '这件标本已启程。经 {{carrier}} 运送。\n订单 {{orderNo}}\n{{productLine}}\n运单号：{{trackingNo}}\n到柜时请轻取轻放。\n\n开箱与售后\n到柜时请全程录制开箱影像——无开箱影像将难以受理售后。蝶类触须不在包损之列；其余部位若有损毁，可按售后约定处理。\n\n入柜保养\n入柜后请避直射阳光，注意防潮；玻璃罩与镜框请尽量保持闭合。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  order_received: {
    category: 'order',
    priority: 'P0',
    titleTemplate: '藏品已入柜',
    contentTemplate: '订单 {{orderNo}} 已确认签收。\n收藏证书已生成；{{careNote}}',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  order_cancelled: {
    category: 'order',
    priority: 'P0',
    titleTemplate: '订单已释出',
    contentTemplate: '订单 {{orderNo}} 已取消\n{{productLine}}\n{{reason}}',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  order_refunded: {
    category: 'order',
    priority: 'P0',
    titleTemplate: '款项已退回',
    contentTemplate:
      '订单 {{orderNo}} 退款 ¥{{refundAmount}} 已办理\n{{productLine}}\n预计 1–3 个工作日回到原支付账户。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  gift_paid: {
    category: 'order',
    queue: QUEUE_CUSTOMER,
    priority: 'P0',
    titleTemplate: '心意已备妥',
    contentTemplate:
      '礼赠订单 {{orderNo}} 已收妥款项\n{{productLine}}\n实付 ¥{{totalPrice}}\n{{tip}}',
    actionUrlTemplate: 'subpackages/feature/gift/success/index?orderId={{relatedId}}'
  },
  gift_awaiting_address: {
    category: 'order',
    queue: QUEUE_CUSTOMER,
    priority: 'P0',
    titleTemplate: '正等 TA 留下地址',
    contentTemplate:
      '「{{productNames}}」已备妥。\n正等 TA 开启礼笺，留下收件去处。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  gift_accepted: {
    category: 'order',
    queue: QUEUE_CUSTOMER,
    priority: 'P0',
    titleTemplate: 'TA 已开启礼笺',
    contentTemplate:
      '礼赠订单 {{orderNo}}：TA 已收下这份山海，正待留下地址。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  gift_address_submitted: {
    category: 'order',
    priority: 'P0',
    titleTemplate: 'TA 已留下去处',
    contentTemplate: '礼赠订单 {{orderNo}}：去处已确认，馆员即将备妥启程。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  gift_nudge: {
    category: 'order',
    queue: QUEUE_CUSTOMER,
    priority: 'P1',
    titleTemplate: '不妨再提醒一声',
    contentTemplate:
      '礼赠订单 {{orderNo}} 仍在等待 TA 留下地址。\n可再次分享礼笺卡片。',
    actionUrlTemplate: 'subpackages/feature/gift/success/index?orderId={{relatedId}}'
  },
  gift_nudge_receiver: {
    category: 'order',
    queue: QUEUE_CUSTOMER,
    priority: 'P1',
    titleTemplate: '还有一份山海等你',
    contentTemplate: '有一份标本礼赠，正等你留下收件去处。',
    actionUrlTemplate: 'subpackages/feature/gift/receive/index?orderId={{relatedId}}&token={{token}}'
  },
  gift_delivered: {
    category: 'order',
    queue: QUEUE_CUSTOMER,
    priority: 'P0',
    titleTemplate: '礼物已到柜',
    contentTemplate: '礼赠订单 {{orderNo}}：「{{productTitle}}」已妥投到柜。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  gift_received: {
    category: 'order',
    queue: QUEUE_CUSTOMER,
    priority: 'P0',
    titleTemplate: '礼赠已到店领取',
    contentTemplate: '礼赠订单 {{orderNo}} 已在「{{storeName}}」核销领取。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  gift_shipped: {
    category: 'order',
    queue: QUEUE_CUSTOMER,
    priority: 'P0',
    titleTemplate: '标本已启程',
    contentTemplate:
      '这份礼赠已启程。经 {{carrier}} 运送。\n订单 {{orderNo}}\n{{productLine}}\n运单号：{{trackingNo}}\n到柜时请轻取轻放。\n\n开箱与售后\n到柜时请全程录制开箱影像——无开箱影像将难以受理售后。蝶类触须不在包损之列；其余部位若有损毁，可按售后约定处理。\n\n入柜保养\n入柜后请避直射阳光，注意防潮；玻璃罩与镜框请尽量保持闭合。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  gift_address_submitted_receiver: {
    category: 'order',
    priority: 'P0',
    titleTemplate: '去处已记下',
    contentTemplate: '礼赠 {{orderNo}} 收件去处已确认，请等候标本启程。',
    actionUrlTemplate: 'subpackages/feature/gift/my-gifts/index'
  },
  gift_expired_refund: {
    category: 'order',
    priority: 'P0',
    titleTemplate: '邀约已过期',
    contentTemplate: '礼赠订单 {{orderNo}} 填址期限已至，款项将退回赠予者。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  gift_expired_refund_receiver: {
    category: 'order',
    priority: 'P0',
    titleTemplate: '礼笺已收回',
    contentTemplate: '礼赠 {{orderNo}} 填址期限已至，这份礼笺已收回。',
    actionUrlTemplate: 'subpackages/feature/gift/my-gifts/index'
  },
  gift_refunded_receiver: {
    category: 'order',
    priority: 'P0',
    titleTemplate: '心意已收回',
    contentTemplate: '礼赠 {{orderNo}} 这份心意已收回；馆中仍有山海可寻。',
    actionUrlTemplate: 'subpackages/feature/gift/my-gifts/index'
  },
  booking_success: {
    category: 'booking',
    priority: 'P0',
    titleTemplate: '预约已记下',
    contentTemplate: '「{{title}}」\n{{date}} {{time}}\n票号：{{ticketCode}}\n{{storeLine}}',
    actionUrlTemplate: 'subpackages/business/ticket/index?id={{relatedId}}'
  },
  booking_reminder: {
    category: 'booking',
    priority: 'P0',
    titleTemplate: '{{reminderTitle}}',
    contentTemplate: '{{reminderContent}}',
    actionUrlTemplate: 'subpackages/business/booking/index?tab=3'
  },
  booking_changed: {
    category: 'booking',
    priority: 'P0',
    titleTemplate: '预约时间已改',
    contentTemplate: '「{{title}}」已改期至 {{date}} {{time}}\n票号：{{ticketCode}}',
    actionUrlTemplate: 'subpackages/business/ticket/index?id={{relatedId}}'
  },
  booking_cancelled: {
    category: 'booking',
    priority: 'P0',
    titleTemplate: '预约已取消',
    contentTemplate: '「{{title}}」预约已取消。\n如需再约，请重新提交。',
    actionUrlTemplate: 'subpackages/business/booking/index?tab=3'
  },
  custom_inquiry_received: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '定制意向已入册',
    contentTemplate: '你的标本定制意向已入册，专员将在 1–2 个工作日内与你联系。',
    actionUrlTemplate: 'subpackages/feature/custom/orders/index'
  },
  custom_inquiry_contacted: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '专员已跟进',
    contentTemplate: '你的定制意向已有专员跟进，请留意电话与山海有信。',
    actionUrlTemplate: 'subpackages/feature/custom/orders/index'
  },
  custom_production_framing: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '开始装裱',
    contentTemplate: '订单 {{orderNo}} 的定制藏品已进入装裱。\n标本师正细细为你处理。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  custom_production_packing: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '装裱完成',
    contentTemplate: '订单 {{orderNo}} 装裱已完成，正在包装。\n即将启程。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  custom_production_shipped: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '定制藏品已启程',
    contentTemplate:
      '订单 {{orderNo}} 定制藏品已启程。\n感谢你的耐心等候。\n\n开箱与售后\n到柜时请全程录制开箱影像——无开箱影像将难以受理售后。蝶类触须不在包损之列；其余部位若有损毁，可按售后约定处理。\n\n入柜保养\n入柜后请避直射阳光，注意防潮；玻璃罩与镜框请尽量保持闭合。',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  pet_memorial_received: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '伴宠记忆意向已入册',
    contentTemplate:
      '「{{petName}}」的纪念工单已提交（{{orderNo}}）。\n标本师将评估是否承接，请留意后续来信。',
    actionUrlTemplate: 'subpackages/feature/custom/pet/status/index?id={{relatedId}}'
  },
  pet_memorial_need_info: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '需补充资料',
    contentTemplate: '「{{petName}}」的工单需要你补充信息。\n专员将主动与你联系。',
    actionUrlTemplate: 'subpackages/feature/custom/pet/status/index?id={{relatedId}}'
  },
  pet_memorial_quoted: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '伴宠记忆报价已出',
    contentTemplate: '「{{petName}}」的制作报价：{{quoteAmount}}\n请在工单页确认后安排交接。',
    actionUrlTemplate: 'subpackages/feature/custom/pet/status/index?id={{relatedId}}'
  },
  pet_memorial_accepted: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '已确认承接',
    contentTemplate: '「{{petName}}」的纪念制作已确认承接。\n下一步请按指引安排到店交接。',
    actionUrlTemplate: 'subpackages/feature/custom/pet/status/index?id={{relatedId}}'
  },
  pet_memorial_awaiting_intake: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '待到店交接',
    contentTemplate: '「{{petName}}」工单待交接。\n请按预约时间到店，或联系专员安排收运。',
    actionUrlTemplate: 'subpackages/feature/custom/pet/status/index?id={{relatedId}}'
  },
  pet_intake_booked: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '伴宠交接已预约',
    contentTemplate: '「{{petName}}」的到店交接已预约：{{date}} {{time}}\n票号：{{ticketCode}}',
    actionUrlTemplate: 'subpackages/feature/custom/pet/status/index?id={{relatedId}}'
  },
  pet_memorial_in_production: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '制作中',
    contentTemplate: '「{{petName}}」的纪念标本正在制作中。\n我们会温柔对待每一次告别。',
    actionUrlTemplate: 'subpackages/feature/custom/pet/status/index?id={{relatedId}}'
  },
  pet_memorial_completed: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '制作已完成',
    contentTemplate: '「{{petName}}」的纪念制作已完成。\n请联系专员安排取件或寄送。',
    actionUrlTemplate: 'subpackages/feature/custom/pet/status/index?id={{relatedId}}'
  },
  support_ticket_received: {
    category: 'system',
    priority: 'P1',
    titleTemplate: '留言已入册',
    contentTemplate: '你的「{{topicLabel}}」留言已提交，专员将尽快回复。',
    actionUrlTemplate: 'subpackages/feature/user/messages/index'
  },
  support_ticket_replied: {
    category: 'system',
    priority: 'P1',
    titleTemplate: '专员已回复',
    contentTemplate: '{{replyContent}}',
    actionUrlTemplate: 'subpackages/feature/user/support/index'
  },
  invoice_request_received: {
    category: 'system',
    priority: 'P1',
    titleTemplate: '开票申请已入册',
    contentTemplate:
      '订单 {{orderNo}} 的开票申请已提交。\n抬头：{{title}}\n专员核对后将开具电子发票并发送。',
    actionUrlTemplate: 'subpackages/feature/user/messages/index'
  },
  invoice_request_staff: {
    category: 'ops',
    queue: QUEUE_WORKFLOW,
    priority: 'P1',
    titleTemplate: '新开票申请待办',
    contentTemplate: '订单 {{orderNo}} · {{invoiceTypeLabel}}\n抬头：{{title}}',
    actionUrlTemplate: 'subpackages/manager/invoice-requests/index'
  },
  approval_submitted: {
    category: 'ops',
    queue: QUEUE_WORKFLOW,
    priority: 'P1',
    titleTemplate: '审批已提交',
    contentTemplate: '{{title}}已提交，等待{{approverLabel}}审核。',
    actionUrlTemplate: 'subpackages/manager/approvals/index'
  },
  approval_approved: {
    category: 'ops',
    queue: QUEUE_WORKFLOW,
    priority: 'P1',
    titleTemplate: '审批已通过',
    contentTemplate: '{{title}}已通过{{deciderHint}}。',
    actionUrlTemplate: 'subpackages/manager/approvals/index'
  },
  approval_rejected: {
    category: 'ops',
    queue: QUEUE_WORKFLOW,
    priority: 'P1',
    titleTemplate: '审批未通过',
    contentTemplate: '{{title}}未通过。原因：{{reason}}',
    actionUrlTemplate: 'subpackages/manager/approvals/index'
  },
  invoice_request_issued: {
    category: 'system',
    priority: 'P1',
    titleTemplate: '电子发票已开具',
    contentTemplate: '订单 {{orderNo}} 的发票已开具。\n抬头：{{title}}',
    actionUrlTemplate: 'subpackages/feature/user/messages/index'
  },
  invoice_request_rejected: {
    category: 'system',
    priority: 'P1',
    titleTemplate: '开票申请未通过',
    contentTemplate: '订单 {{orderNo}} 的开票申请未通过。\n抬头：{{title}}\n原因：{{rejectReason}}',
    actionUrlTemplate: 'subpackages/feature/user/messages/index'
  },
  identify_result: {
    category: 'activity',
    priority: 'P1',
    titleTemplate: '鉴定结果已出',
    contentTemplate: '{{resultSummary}}',
    actionUrlTemplate: 'subpackages/feature/identify/result/index?record_id={{relatedId}}'
  },
  care_tip: {
    category: 'activity',
    priority: 'P2',
    titleTemplate: '新家里还安好吗？',
    contentTemplate:
      '「{{productTitle}}」签收已 {{daysAfter}} 天。\n{{careSummary}}\n可查看养护要点，让藏品长久陪在身边。',
    actionUrlTemplate:
      'subpackages/feature/care/guide/index?category={{category}}&orderId={{relatedId}}&productId={{productId}}&from=message'
  },
  store_visit_thanks: {
    category: 'activity',
    priority: 'P2',
    titleTemplate: '感谢到访',
    contentTemplate: '欢迎走进{{storeName}}。愿今日遇见一件触动你的标本。',
    actionUrlTemplate: 'subpackages/business/store/index'
  },
  store_points_granted: {
    category: 'activity',
    priority: 'P1',
    titleTemplate: '门店消费已入账',
    contentTemplate:
      '在{{storeName}}消费 ¥{{amount}}，已记入 {{points}} 积分。\n当前可用 {{balance}} 分',
    actionUrlTemplate: 'subpackages/business/points/index'
  },
  store_points_revoked: {
    category: 'activity',
    priority: 'P1',
    titleTemplate: '积分已调整',
    contentTemplate: '因{{reason}}，已扣回 {{points}} 积分。\n当前可用 {{balance}} 分',
    actionUrlTemplate: 'subpackages/business/points/index'
  },
  store_receipt_submitted: {
    category: 'activity',
    priority: 'P2',
    titleTemplate: '小票认领已入册',
    contentTemplate:
      '已收到你的门店小票（¥{{amount}}）。店长通常在 {{slaWorkDays}} 个工作日内核对；通过后按「每满 ¥1 → 1 积分 + 1 成长值」入账。',
    actionUrlTemplate: 'subpackages/business/order-claim/index?mode=receipt'
  },
  store_receipt_approved: {
    category: 'activity',
    priority: 'P1',
    titleTemplate: '小票认领已入账',
    contentTemplate:
      '{{storeName}}小票 ¥{{amount}} 已核对通过，记入 {{points}} 积分与 {{points}} 成长值。\n当前可用 {{balance}} 分',
    actionUrlTemplate: 'subpackages/business/order-claim/index?mode=receipt'
  },
  store_receipt_rejected: {
    category: 'activity',
    priority: 'P1',
    titleTemplate: '小票认领未通过',
    contentTemplate:
      '门店小票（¥{{amount}}）未通过核对。原因：{{reason}}\n可到「订单认领」查看或重新提交。',
    actionUrlTemplate: 'subpackages/business/order-claim/index?mode=receipt'
  },
  platform_order_submitted: {
    category: 'activity',
    priority: 'P2',
    titleTemplate: '外部订单已入册',
    contentTemplate:
      '已收到 {{platformName}} 订单 {{orderNo}}{{amountText}}。店长核对后将按门店消费规则入账。',
    actionUrlTemplate: 'subpackages/business/order-claim/index?mode=order'
  },
  platform_order_approved: {
    category: 'activity',
    priority: 'P1',
    titleTemplate: '外部订单已入账',
    contentTemplate:
      '{{platformName}} 订单 {{orderNo}}（¥{{amount}}）已通过，记入 {{points}} 积分与 {{points}} 成长值。\n当前可用 {{balance}} 分',
    actionUrlTemplate: 'subpackages/business/order-claim/index?mode=order'
  },
  platform_order_rejected: {
    category: 'activity',
    priority: 'P1',
    titleTemplate: '外部订单未通过',
    contentTemplate:
      '{{platformName}} 订单 {{orderNo}} 未通过核对。原因：{{reason}}\n可到「订单认领」查看。',
    actionUrlTemplate: 'subpackages/business/order-claim/index?mode=order'
  },
  coupon_exchanged: {
    category: 'activity',
    priority: 'P1',
    titleTemplate: '礼券已入夹',
    contentTemplate:
      '「{{couponTitle}}」已放入你的券夹，有效期至 {{expireDate}}。\n本次消耗 {{costPoints}} 积分。',
    actionUrlTemplate: 'subpackages/business/coupons/index'
  },
  birthday_gift: {
    category: 'activity',
    priority: 'P1',
    titleTemplate: '生日快乐',
    contentTemplate:
      '柜中为你留了一份生日心意：{{points}} 积分（不计成长值），以及 {{couponCount}} 张满 {{minSpend}} 减 {{couponValue}} 的券。\n有效期至 {{expireDate}}，慢慢挑一件喜欢的藏品即可。',
    actionUrlTemplate: 'subpackages/business/coupons/index'
  },
  honorary_curator_granted: {
    category: 'activity',
    priority: 'P1',
    titleTemplate: '荣誉馆长已生效',
    contentTemplate:
      '你已获任山海造物「荣誉馆长」。\n此身份涵盖各档会员权益；可到「我的」查看会员卡与通行码。',
    actionUrlTemplate: 'pages/user/index'
  },
  activity_notice: {
    category: 'activity',
    priority: 'P2',
    titleTemplate: '{{title}}',
    contentTemplate: '{{content}}',
    actionUrlTemplate: '{{actionUrl}}'
  },
  system_notice: {
    category: 'system',
    priority: 'P2',
    titleTemplate: '{{title}}',
    contentTemplate: '{{content}}',
    actionUrlTemplate: '{{actionUrl}}'
  }
}

module.exports = {
  DEFAULT_TEMPLATES,
  QUEUE_CUSTOMER,
  QUEUE_WORKFLOW,
  WORKFLOW_EVENT_TYPES,
  isWorkflowEventType,
  resolveMessageQueue
}
