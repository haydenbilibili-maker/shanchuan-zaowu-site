/**
 * 订单状态口径（店长工作台 / 会员 CRM 共用）
 * 与 subpackages/feature/utils/orderStatus.js 保持同步。
 */
const ORDER_STATUS = {
  pending_pay: 'pending_pay',
  paid: 'paid',
  ready_pickup: 'ready_pickup',
  shipped: 'shipped',
  received: 'received',
  refunding: 'refunding',
  aftersales: 'aftersales',
  refunded: 'refunded',
  void: 'void',
  cancelled: 'cancelled'
}

const ORDER_STATUS_LABEL = {
  pending_pay: '待支付',
  paid: '待发货',
  ready_pickup: '待自取',
  shipped: '已发货',
  received: '已完成',
  refunding: '退款中',
  aftersales: '售后中',
  refunded: '已退款',
  void: '已作废',
  cancelled: '已取消'
}

/** 计入财务 GMV 的状态（未退款完成；含礼赠待填址 / 门店自取） */
const GMV_STATUSES = ['paid', 'paid_awaiting_address', 'ready_pickup', 'shipped', 'received']

function orderStatusLabel(status) {
  return ORDER_STATUS_LABEL[status] || status || ''
}

function isGmvStatus(status) {
  return GMV_STATUSES.indexOf(status) !== -1
}

module.exports = {
  ORDER_STATUS,
  ORDER_STATUS_LABEL,
  GMV_STATUSES,
  orderStatusLabel,
  isGmvStatus
}
