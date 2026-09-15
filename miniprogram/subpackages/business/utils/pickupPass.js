/**
 * 门店自取凭证（PICKUP PASS）展示模型 —— 订单详情与独立凭证页共用
 *
 * 只做「订单 → 展示态」的纯计算，不碰数据库、不碰 UI，
 * 便于两处复用同一套口径（状态章 / 进度 / 分组码 / 提示文案）。
 */

/** 自取码分组展示：034757D363 → 0347 57D3 63（四位一组，便于口头报码） */
function groupPickupCode(code) {
  const text = String(code || '').replace(/\s+/g, '').toUpperCase();
  if (!text) return '';
  return (text.match(/.{1,4}/g) || [text]).join(' ');
}

/** 核销时间展示：2026.9.15 17:29 */
function formatPickupTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 是否为门店自取单（含礼赠自提，用于状态判断；展示入口仍按业务线分开） */
function isStorePickupOrder(order) {
  const o = order || {};
  return !!(o.storePickup || o.fulfillmentType === 'store_pickup' ||
    (o.giftMeta && o.giftMeta.deliveryType === 'store_pickup'));
}

/**
 * 自取凭证展示模型
 * @param {object} order 订单
 * @returns {{statusLabel: string, statusTone: 'wait'|'ready'|'done', code: string, codeText: string, steps: Array<{label: string, state: 'done'|'current'|'todo'}>, hint: string, headline: string}}
 */
function buildPickupPass(order) {
  const o = order || {};
  const delivered = o.status === 'received' || o.status === 'signed';
  const claimed = delivered || o.pickupStatus === 'claimed';
  // 订单进入这些状态后自取凭证失效（此前一律落到「备妥中」，二维码照旧可扫）
  const CLOSED_PICKUP_STATUSES = new Set(['refunding', 'refunded', 'refund_approved', 'refund_rejected', 'void', 'cancelled', 'aftersales', 'expired_refunding', 'refund_reject'])
  const CLOSED_LABELS = {
    refunding: '退款处理中',
    refunded: '已退款',
    refund_approved: '退款处理中',
    refund_rejected: '退款未通过',
    void: '订单已取消',
    cancelled: '订单已取消',
    aftersales: '售后处理中',
    expired_refunding: '退款处理中'
  }
  const ready = claimed || o.status === 'ready_pickup';
  const paid = ready || o.status === 'paid';
  const code = String(o.pickupCode || '');

  let statusLabel = '备妥中';
  let statusTone = 'wait';
  let headline = '馆长正在备妥';
  let hint = '备好后此凭证会转为可领取，届时到店出示即可。';
  if (claimed) {
    statusLabel = '已交付';
    statusTone = 'done';
    headline = '本次自取已完成';
    hint = '该凭证已核销，无需再次出示。';
  } else if (o.status === 'ready_pickup') {
    statusLabel = '可领取';
    statusTone = 'ready';
    headline = '已备妥，请到店领取';
    hint = '到店出示此凭证，由馆长扫码核销后交付。';
  } else if (CLOSED_PICKUP_STATUSES.has(o.status)) {
    // 终态/退款中：订单已不可交付，继续出示二维码只会让顾客白跑一趟
    statusLabel = CLOSED_LABELS[o.status] || '已关闭';
    statusTone = 'closed';
    headline = '该凭证已不可使用';
    hint = '订单已取消或进入退款流程，如需自取请重新下单，或联系专员协助。';
  }

  return {
    statusLabel,
    statusTone,
    headline,
    hint,
    code,
    codeText: groupPickupCode(code),
    steps: [
      { label: '支付完成', state: paid ? 'done' : 'todo' },
      { label: '备妥待取', state: ready ? 'done' : 'current' },
      { label: '到店领取', state: claimed ? 'done' : (o.status === 'ready_pickup' ? 'current' : 'todo') }
    ]
  };
}

module.exports = {
  groupPickupCode,
  formatPickupTime,
  isStorePickupOrder,
  buildPickupPass
};
