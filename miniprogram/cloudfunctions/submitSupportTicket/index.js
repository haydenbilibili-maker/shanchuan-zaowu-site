/**
 * 提交专员留言（离线工单 + 站内信回执）
 */
const cloud = require('wx-server-sdk');
const { dispatchInAppMessage } = require('./inAppMessage');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const MAX_TICKET_IMAGES = 3;
const TICKET_IMAGE_RE = /^cloud:\/\/[^/\s]+\/support-tickets\/[\w./-]{1,200}$/;

/** images 可选：必须是数组、≤ 3 张、每项为本功能上传目录下的 cloud:// fileID */
function validateTicketImages(raw) {
  if (!Array.isArray(raw)) return { ok: false, msg: '图片参数格式不对' };
  if (raw.length > MAX_TICKET_IMAGES) return { ok: false, msg: `每条留言最多 ${MAX_TICKET_IMAGES} 张图片` };
  const list = [];
  for (const item of raw) {
    const id = typeof item === 'string' ? item.trim() : '';
    if (!id || id.indexOf('cloud://') !== 0 || id.indexOf('..') !== -1 || !TICKET_IMAGE_RE.test(id)) {
      return { ok: false, msg: '图片没有上传成功，请重新上传' };
    }
    list.push(id);
  }
  return { ok: true, list };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const {
    topic = 'other',
    message = '',
    orderId = '',
    orderNo = '',
    productId = '',
    productName = '',
    contactPhone = ''
  } = event;

  const content = String(message || '').trim();
  if (!content || content.length < 5) {
    return { success: false, msg: '请至少输入 5 个字的留言' };
  }
  if (content.length > 500) {
    return { success: false, msg: '留言不超过 500 字' };
  }

  const hasImages = Object.prototype.hasOwnProperty.call(event, 'images') && event.images !== undefined;
  let images = null;
  if (hasImages) {
    const checked = validateTicketImages(event.images);
    if (!checked.ok) return { success: false, msg: checked.msg };
    images = checked.list;
  }

  const topicLabels = {
    order: '订单咨询',
    booking: '预约改期',
    product: '藏品鉴赏',
    custom: '标本定制',
    specimen_care: '标本养护',
    pet_memorial: '伴宠记忆',
    identify: '鉴定疑问',
    refund: '售后退款',
    feedback: '反馈与建议',
    framer_recruit: '标本师合作',
    other: '其他问题'
  };

  try {
    const ticketRes = await db.collection('support_tickets').add({
      data: {
        _openid: openid,
        topic,
        topicLabel: topicLabels[topic] || '其他问题',
        message: content,
        orderId,
        orderNo,
        productId,
        productName,
        contactPhone,
        ...(hasImages ? { images } : {}),
        status: 'pending',
        createTime: db.serverDate(),
        _createTime: db.serverDate()
      }
    });

    await dispatchInAppMessage(db, {
      eventType: 'support_ticket_received',
      openid,
      relatedId: ticketRes._id,
      vars: { topicLabel: topicLabels[topic] || '其他问题' }
    }).catch((err) => console.warn('support receipt message failed:', err))

    return {
      success: true,
      ticketId: ticketRes._id,
      msg: '留言已提交'
    };
  } catch (err) {
    console.error('submitSupportTicket error:', err);
    return { success: false, msg: err.message || '提交失败' };
  }
};
