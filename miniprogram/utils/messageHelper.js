const CATEGORY_META = {
  all: { label: '全部', icon: '/assets/icons/message.png' },
  booking: { label: '预约', icon: '/assets/icons/booking.png' },
  order: { label: '订单', icon: '/assets/icons/cart.png' },
  custom: { label: '定制', icon: '/assets/icons/gift.png' },
  activity: { label: '活动', icon: '/assets/icons/gift.png' },
  system: { label: '系统', icon: '/assets/icons/message.png' },
  other: { label: '其他', icon: '/assets/icons/message.png' }
};

const TYPE_META = {
  booking_success: { label: '预约成功', category: 'booking' },
  booking_reminder: { label: '预约提醒', category: 'booking' },
  booking_changed: { label: '预约变更', category: 'booking' },
  booking_cancelled: { label: '预约取消', category: 'booking' },
  order_created: { label: '待付款', category: 'order' },
  order_paid: { label: '支付成功', category: 'order' },
  order_shipped: { label: '已发货', category: 'order' },
  order_received: { label: '已签收', category: 'order' },
  care_tip: { label: '养护提醒', category: 'activity' },
  order_cancelled: { label: '订单取消', category: 'order' },
  order_refunded: { label: '退款完成', category: 'order' },
  custom_inquiry_received: { label: '定制意向', category: 'custom' },
  custom_inquiry_contacted: { label: '专员联系', category: 'custom' },
  custom_production_framing: { label: '开始装裱', category: 'custom' },
  custom_production_packing: { label: '进入包装', category: 'custom' },
  custom_production_shipped: { label: '定制发出', category: 'custom' },
  pet_memorial_received: { label: '伴宠意向', category: 'custom' },
  pet_memorial_need_info: { label: '需补充', category: 'custom' },
  pet_memorial_quoted: { label: '伴宠报价', category: 'custom' },
  pet_memorial_accepted: { label: '已承接', category: 'custom' },
  pet_memorial_awaiting_intake: { label: '待交接', category: 'custom' },
  pet_intake_booked: { label: '交接预约', category: 'custom' },
  pet_memorial_in_production: { label: '制作中', category: 'custom' },
  pet_memorial_completed: { label: '已完成', category: 'custom' },
  support_ticket_received: { label: '留言回执', category: 'system' },
  support_ticket_replied: { label: '专员回复', category: 'system' },
  identify_result: { label: '鉴定结果', category: 'activity' },
  activity_notice: { label: '活动通知', category: 'activity' },
  system_notice: { label: '系统通知', category: 'system' }
};

const ACTION_LABELS = {
  booking: '查看预约',
  order: '查看订单',
  custom: '查看详情',
  activity: '查看详情',
  system: '我知道了',
  other: '查看详情'
};

function getCategoryMeta(category) {
  return CATEGORY_META[category] || CATEGORY_META.other;
}

function getTypeMeta(type) {
  return TYPE_META[type] || null;
}

function formatMessageTime(dateInput) {
  let date = dateInput;
  if (!(date instanceof Date)) {
    try {
      date = dateInput ? new Date(dateInput) : new Date();
    } catch (e) {
      date = new Date();
    }
  }
  if (isNaN(date.getTime())) return '时间未知';

  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 0) return '刚刚';

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`;

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${d} ${h}:${m}`;
}

function resolveActionLabel(message) {
  if (!message || !message.actionUrl) return '';
  return ACTION_LABELS[message.category] || ACTION_LABELS.other;
}

function enrichMessage(msg) {
  const category = msg.category || 'other';
  const categoryMeta = getCategoryMeta(category);
  const typeMeta = getTypeMeta(msg.type);
  let date;
  try {
    date = msg.createTime ? new Date(msg.createTime) : new Date(msg._createTime || Date.now());
  } catch (e) {
    date = new Date();
  }

  return {
    ...msg,
    categoryName: categoryMeta.label,
    categoryIcon: msg.icon || categoryMeta.icon,
    typeName: typeMeta ? typeMeta.label : categoryMeta.label,
    formattedTime: formatMessageTime(date),
    actionLabel: resolveActionLabel(msg),
    isUnread: msg.read === false || msg.read === undefined || !msg.read
  };
}

module.exports = {
  CATEGORY_META,
  TYPE_META,
  getCategoryMeta,
  getTypeMeta,
  formatMessageTime,
  resolveActionLabel,
  enrichMessage
};
