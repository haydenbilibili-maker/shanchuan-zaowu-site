/**
 * 山海有信 — 默认消息模板（DB 无记录时使用）
 */
const DEFAULT_TEMPLATES = {
  order_created: {
    category: 'order',
    priority: 'P0',
    titleTemplate: '订单待支付',
    contentTemplate: '您有一笔订单待支付\n{{productNames}}\n实付 ¥{{totalPrice}}\n请在 30 分钟内完成支付',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  order_paid: {
    category: 'order',
    priority: 'P0',
    titleTemplate: '支付成功',
    contentTemplate: '订单 {{orderNo}} 已支付成功\n实付 ¥{{totalPrice}}\n我们将尽快为您准备发货',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  order_shipped: {
    category: 'order',
    priority: 'P0',
    titleTemplate: '藏品已发出',
    contentTemplate: '订单 {{orderNo}} 已通过 {{carrier}} 发出\n运单号：{{trackingNo}}',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  order_received: {
    category: 'order',
    priority: 'P0',
    titleTemplate: '感谢您的收藏',
    contentTemplate: '订单 {{orderNo}} 已确认签收\n收藏证书已生成；{{careNote}}',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  order_cancelled: {
    category: 'order',
    priority: 'P0',
    titleTemplate: '订单已取消',
    contentTemplate: '订单 {{orderNo}} 已取消\n{{reason}}',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  order_refunded: {
    category: 'order',
    priority: 'P0',
    titleTemplate: '退款已到账',
    contentTemplate: '订单 {{orderNo}} 退款 ¥{{refundAmount}} 已处理\n预计 1-3 个工作日到账',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  booking_success: {
    category: 'booking',
    priority: 'P0',
    titleTemplate: '预约已确认',
    contentTemplate: '「{{title}}」\n{{date}} {{time}}\n票号：{{ticketCode}}\n{{storeLine}}',
    actionUrlTemplate: 'subpackages/business/ticket/index?id={{relatedId}}'
  },
  booking_reminder: {
    category: 'booking',
    priority: 'P0',
    titleTemplate: '{{reminderTitle}}',
    contentTemplate: '{{reminderContent}}',
    actionUrlTemplate: 'subpackages/business/my-bookings/index'
  },
  booking_changed: {
    category: 'booking',
    priority: 'P0',
    titleTemplate: '预约时间已变更',
    contentTemplate: '「{{title}}」已改期至 {{date}} {{time}}\n票号：{{ticketCode}}',
    actionUrlTemplate: 'subpackages/business/ticket/index?id={{relatedId}}'
  },
  booking_cancelled: {
    category: 'booking',
    priority: 'P0',
    titleTemplate: '预约已取消',
    contentTemplate: '「{{title}}」预约已取消\n如需改约请重新提交预约',
    actionUrlTemplate: 'subpackages/business/my-bookings/index'
  },
  custom_inquiry_received: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '定制意向已收到',
    contentTemplate: '您的标本定制意向已提交，专员将在 1-2 个工作日内与您联系',
    actionUrlTemplate: 'pages/custom/inquiry/index'
  },
  custom_inquiry_contacted: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '专员已联系',
    contentTemplate: '您的定制意向已有专员跟进，请留意电话与山海有信通知',
    actionUrlTemplate: 'pages/custom/inquiry/index'
  },
  custom_production_framing: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '开始装裱',
    contentTemplate: '订单 {{orderNo}} 的定制藏品已开始装裱\n标本师正在为您精心制作',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  custom_production_packing: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '装裱完成',
    contentTemplate: '订单 {{orderNo}} 装裱已完成，正在包装\n即将为您发出',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  custom_production_shipped: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '定制藏品已发出',
    contentTemplate: '订单 {{orderNo}} 定制藏品已发出\n感谢您的耐心等待',
    actionUrlTemplate: 'subpackages/business/order-detail/index?id={{relatedId}}'
  },
  pet_memorial_received: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '伴宠记忆意向已收到',
    contentTemplate: '「{{petName}}」的纪念工单已提交（{{orderNo}}）\n标本师将评估是否承接，请留意后续通知',
    actionUrlTemplate: 'pages/custom/pet/status/index?id={{relatedId}}'
  },
  pet_memorial_need_info: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '需补充资料',
    contentTemplate: '「{{petName}}」的工单需要您补充信息\n专员将主动与您联系',
    actionUrlTemplate: 'pages/custom/pet/status/index?id={{relatedId}}'
  },
  pet_memorial_quoted: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '伴宠记忆报价已出',
    contentTemplate: '「{{petName}}」的制作报价：{{quoteAmount}}\n请在工单页确认后安排交接',
    actionUrlTemplate: 'pages/custom/pet/status/index?id={{relatedId}}'
  },
  pet_memorial_accepted: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '已确认承接',
    contentTemplate: '「{{petName}}」的纪念制作已确认承接\n下一步请按指引安排到店交接',
    actionUrlTemplate: 'pages/custom/pet/status/index?id={{relatedId}}'
  },
  pet_memorial_awaiting_intake: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '待到店交接',
    contentTemplate: '「{{petName}}」工单待交接\n请按预约时间到店，或联系专员安排收运',
    actionUrlTemplate: 'pages/custom/pet/status/index?id={{relatedId}}'
  },
  pet_intake_booked: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '伴宠交接预约已确认',
    contentTemplate: '「{{petName}}」的到店交接已预约：{{date}} {{time}}\n票号：{{ticketCode}}',
    actionUrlTemplate: 'pages/custom/pet/status/index?id={{relatedId}}'
  },
  pet_memorial_in_production: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '制作中',
    contentTemplate: '「{{petName}}」的纪念标本正在制作中\n我们会温柔对待每一次告别',
    actionUrlTemplate: 'pages/custom/pet/status/index?id={{relatedId}}'
  },
  pet_memorial_completed: {
    category: 'custom',
    priority: 'P1',
    titleTemplate: '制作已完成',
    contentTemplate: '「{{petName}}」的纪念制作已完成\n请联系专员安排取件或寄送',
    actionUrlTemplate: 'pages/custom/pet/status/index?id={{relatedId}}'
  },
  support_ticket_received: {
    category: 'system',
    priority: 'P1',
    titleTemplate: '留言已收到',
    contentTemplate: '您的「{{topicLabel}}」留言已提交，专员将尽快回复',
    actionUrlTemplate: 'pages/user/messages/index'
  },
  support_ticket_replied: {
    category: 'system',
    priority: 'P1',
    titleTemplate: '专员已回复',
    contentTemplate: '{{replyContent}}',
    actionUrlTemplate: 'pages/user/support/index'
  },
  identify_result: {
    category: 'activity',
    priority: 'P1',
    titleTemplate: '鉴定结果已出',
    contentTemplate: '{{resultSummary}}',
    actionUrlTemplate: 'pages/identify/result/index?record_id={{relatedId}}'
  },
  care_tip: {
    category: 'activity',
    priority: 'P2',
    titleTemplate: '您的藏品还适应新家吗？',
    contentTemplate: '「{{productTitle}}」签收已 {{daysAfter}} 天\n{{careSummary}}\n点击查看养护要点，让藏品长久陪伴您',
    actionUrlTemplate: 'pages/care/guide/index?category={{category}}&orderId={{relatedId}}&productId={{productId}}&from=message'
  },
  store_visit_thanks: {
    category: 'activity',
    priority: 'P2',
    titleTemplate: '感谢到访',
    contentTemplate: '欢迎走进{{storeName}}，愿今日遇见一件触动你的标本。',
    actionUrlTemplate: 'pages/store/index'
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

module.exports = { DEFAULT_TEMPLATES }
