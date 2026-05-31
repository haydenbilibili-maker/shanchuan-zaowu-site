/**
 * 联系专员 - 前端辅助
 */

const TOPIC_LABELS = {
  order: '订单咨询',
  booking: '预约改期',
  product: '藏品鉴赏',
  custom: '标本定制',
  pet_memorial: '伴宠记忆',
  identify: '鉴定疑问',
  refund: '售后退款',
  other: '其他问题'
};

function getTopicLabel(topic) {
  return TOPIC_LABELS[topic] || TOPIC_LABELS.other;
}

function buildSessionFrom(ctx = {}) {
  const payload = {
    source: 'support_page',
    topic: ctx.topic || 'other',
    topicLabel: getTopicLabel(ctx.topic),
    orderId: ctx.orderId || '',
    orderNo: ctx.orderNo || '',
    productId: ctx.productId || '',
    productName: ctx.productName || '',
    memberNo: ctx.memberNo || '',
    storeId: ctx.storeId || '',
    storeName: ctx.storeName || '',
    ts: Date.now()
  };
  let str = JSON.stringify(payload);
  if (str.length > 1024) {
    str = JSON.stringify({
      source: payload.source,
      topic: payload.topic,
      orderId: payload.orderId,
      orderNo: payload.orderNo,
      productId: ctx.productId || ''
    });
  }
  return str;
}

function buildSendMessage(ctx = {}) {
  const topic = ctx.topic || 'other';
  if (topic === 'order' && ctx.orderId) {
    return {
      title: `订单咨询 ${ctx.orderNo || ''}`.trim(),
      path: `/subpackages/business/order-detail/index?id=${ctx.orderId}`
    };
  }
  if (topic === 'product' && ctx.productId) {
    return {
      title: ctx.productName ? `藏品咨询 · ${ctx.productName}` : '藏品咨询',
      path: `/pages/detail/index?id=${ctx.productId}`
    };
  }
  if (topic === 'custom') {
    return {
      title: '标本定制咨询',
      path: '/pages/custom/hub/index'
    };
  }
  if (topic === 'pet_memorial') {
    return {
      title: '伴宠记忆咨询',
      path: '/pages/custom/pet/index'
    };
  }
  if (topic === 'booking') {
    return {
      title: '预约咨询',
      path: '/subpackages/business/my-bookings/index'
    };
  }
  if (topic === 'identify') {
    return {
      title: '鉴定咨询',
      path: '/pages/identify/index'
    };
  }
  return {
    title: '联系专员 · 山海造物',
    path: '/pages/user/support/index'
  };
}

function buildContextSummary(ctx = {}) {
  const parts = [];
  const topicLabel = getTopicLabel(ctx.topic);
  parts.push(`咨询类型：${topicLabel}`);
  if (ctx.orderNo) parts.push(`订单号：${ctx.orderNo}`);
  if (ctx.productName) parts.push(`藏品：${ctx.productName}`);
  if (ctx.storeName) parts.push(`相关门店：${ctx.storeName}`);
  if (ctx.memberNo) parts.push(`会员号：${ctx.memberNo}`);
  return parts.join('\n');
}

module.exports = {
  TOPIC_LABELS,
  getTopicLabel,
  buildSessionFrom,
  buildSendMessage,
  buildContextSummary
};
