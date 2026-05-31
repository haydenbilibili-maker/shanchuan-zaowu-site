/**
 * 提交专员留言（离线工单 + 站内信回执）
 */
const cloud = require('wx-server-sdk');
const { dispatchInAppMessage } = require('./inAppMessage');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

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
