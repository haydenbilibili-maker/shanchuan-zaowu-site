/**
 * 联系专员 - 前端辅助（与 feature/utils/supportHelper 保持同步）
 * session-from 以可读文案为主（客服工作台可见），并附带 oid/pid 便于检索。
 */

const TOPIC_LABELS = {
  order: '订单咨询',
  booking: '预约改期',
  product: '藏品鉴赏',
  custom: '标本定制',
  pet_memorial: '伴宠记忆',
  specimen_care: '标本养护',
  identify: '鉴定疑问',
  refund: '售后退款',
  invoice: '发票开具',
  feedback: '反馈与建议',
  other: '其他问题',
  framer_recruit: '标本师招募'
};

function getTopicLabel(topic) {
  return TOPIC_LABELS[topic] || TOPIC_LABELS.other;
}

function truncate(str, max) {
  const s = String(str || '').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

function pickProductFromOrder(order = {}) {
  const list = Array.isArray(order.products) ? order.products : [];
  const p0 = list[0] || {};
  const image =
    p0.image ||
    (Array.isArray(p0.images) && p0.images[0]) ||
    p0.cover ||
    '';
  return {
    productId: p0.productId || p0._id || p0.id || '',
    productName: p0.title || p0.name || '',
    productImage: image,
    productCount: list.length
  };
}

function buildSessionFrom(ctx = {}) {
  const parts = [getTopicLabel(ctx.topic)];
  if (ctx.orderNo) parts.push(`单号 ${ctx.orderNo}`);
  else if (ctx.orderId) parts.push(`订单 ${String(ctx.orderId).slice(-8)}`);
  if (ctx.productName) parts.push(truncate(ctx.productName, 24));
  if (ctx.memberNo) parts.push(`会员 ${ctx.memberNo}`);
  if (ctx.storeName) parts.push(truncate(ctx.storeName, 16));

  const meta = [];
  if (ctx.orderId) meta.push(`oid=${ctx.orderId}`);
  if (ctx.productId) meta.push(`pid=${ctx.productId}`);

  let str = parts.filter(Boolean).join(' · ');
  if (meta.length) str = `${str} | ${meta.join('&')}`;
  if (str.length > 1024) str = str.slice(0, 1024);
  return str;
}

function buildSendMessage(ctx = {}) {
  const topic = ctx.topic || 'other';
  const img = ctx.productImageUrl || ctx.productImage || '';

  if ((topic === 'order' || topic === 'refund' || topic === 'invoice') && ctx.orderId) {
    const no = ctx.orderNo ? ` ${ctx.orderNo}` : '';
    const name = ctx.productName ? ` · ${truncate(ctx.productName, 18)}` : '';
    return {
      title: `订单咨询${no}${name}`.trim(),
      path: `/subpackages/business/order-detail/index?id=${ctx.orderId}`,
      img
    };
  }
  if ((topic === 'product' || topic === 'order') && ctx.productId) {
    return {
      title: ctx.productName ? `藏品咨询 · ${truncate(ctx.productName, 28)}` : '藏品咨询',
      path: `/subpackages/feature/detail/index?id=${ctx.productId}`,
      img
    };
  }
  if (topic === 'custom') {
    return {
      title: '标本定制咨询',
      path: '/pages/atelier/index',
      img
    };
  }
  if (topic === 'pet_memorial') {
    return {
      title: '伴宠记忆咨询',
      path: '/subpackages/feature/custom/pet/index',
      img
    };
  }
  if (topic === 'booking') {
    return {
      title: '预约咨询',
      path: '/subpackages/business/booking/index?tab=3',
      img
    };
  }
  if (topic === 'identify') {
    return {
      title: '鉴定咨询',
      path: '/subpackages/feature/identify/index',
      img
    };
  }
  if (topic === 'framer_recruit') {
    return {
      title: '标本师招募',
      path: '/subpackages/business/framer-recruit/index',
      img
    };
  }
  if (ctx.orderId) {
    return {
      title: `订单咨询 ${ctx.orderNo || ''}`.trim(),
      path: `/subpackages/business/order-detail/index?id=${ctx.orderId}`,
      img
    };
  }
  if (ctx.productId) {
    return {
      title: ctx.productName ? `藏品咨询 · ${truncate(ctx.productName, 28)}` : '藏品咨询',
      path: `/subpackages/feature/detail/index?id=${ctx.productId}`,
      img
    };
  }
  return {
    title: '联系专员 · 山海造物',
    path: '/subpackages/extra/user/support/index',
    img: ''
  };
}

function buildContextSummary(ctx = {}) {
  const parts = [];
  parts.push(`咨询类型：${getTopicLabel(ctx.topic)}`);
  if (ctx.orderNo) parts.push(`订单号：${ctx.orderNo}`);
  if (ctx.productName) parts.push(`藏品：${ctx.productName}`);
  if (ctx.storeName) parts.push(`相关门店：${ctx.storeName}`);
  if (ctx.memberNo) parts.push(`会员号：${ctx.memberNo}`);
  return parts.join('\n');
}

function buildContextCard(ctx = {}) {
  const hasOrder = !!(ctx.orderId || ctx.orderNo);
  const hasProduct = !!(ctx.productId || ctx.productName);
  if (!hasOrder && !hasProduct) {
    return {
      visible: false,
      kind: '',
      kindLabel: '',
      title: '',
      subtitle: '',
      tip: '',
      image: '',
      tapPath: '',
      actionLabel: '查看'
    };
  }

  if (hasOrder) {
    const count = Number(ctx.productCount) || 0;
    const namePart = ctx.productName
      ? count > 1
        ? `${ctx.productName} 等 ${count} 件`
        : ctx.productName
      : '订单详情';
    return {
      visible: true,
      kind: 'order',
      kindLabel: '本单咨询',
      title: ctx.orderNo ? `订单 ${ctx.orderNo}` : '订单咨询',
      subtitle: namePart,
      tip: '进入会话后，点右下角发送卡片，专员可对照本单',
      image: ctx.productImageUrl || ctx.productImage || '',
      tapPath: ctx.orderId
        ? `/subpackages/business/order-detail/index?id=${ctx.orderId}`
        : '',
      actionLabel: '看订单'
    };
  }

  return {
    visible: true,
    kind: 'product',
    kindLabel: '本藏品咨询',
    title: ctx.productName || '藏品咨询',
    subtitle: '',
    tip: '进入会话后，点右下角发送卡片，专员可对照本藏品',
    image: ctx.productImageUrl || ctx.productImage || '',
    tapPath: ctx.productId
      ? `/subpackages/feature/detail/index?id=${ctx.productId}`
      : '',
    actionLabel: '看藏品'
  };
}

function buildLeaveMessageDraft(ctx = {}) {
  const bits = [];
  if (ctx.orderNo) bits.push(`订单 ${ctx.orderNo}`);
  else if (ctx.orderId) bits.push('本订单');
  if (ctx.productName) bits.push(`藏品「${truncate(ctx.productName, 20)}」`);
  if (!bits.length) return '';
  return `关于${bits.join(' / ')}：\n`;
}

function buildSupportQuery(params = {}) {
  const qs = [];
  Object.keys(params).forEach((key) => {
    const val = params[key];
    if (val === undefined || val === null || val === '') return;
    qs.push(`${key}=${encodeURIComponent(String(val))}`);
  });
  return qs.length ? `?${qs.join('&')}` : '';
}

module.exports = {
  TOPIC_LABELS,
  getTopicLabel,
  pickProductFromOrder,
  buildSessionFrom,
  buildSendMessage,
  buildContextSummary,
  buildContextCard,
  buildLeaveMessageDraft,
  buildSupportQuery
};
