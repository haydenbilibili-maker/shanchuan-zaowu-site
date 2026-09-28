// cloudfunctions/sendBookingReminder/index.js
const cloud = require('wx-server-sdk');
// 来源判定统一真源（负向子串判定对互调合并串会判反，详见 sourceOrigin.js 顶部说明）
const { isNonClientSource } = require('./sourceOrigin');
const { buildSubscribe } = require('./subscribeTemplates');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 发送预约提醒
 * @param {Object} event - 事件参数
 * @param {string} event.type - 提醒类型：success, day_before, hour_before, changed, cancelled
 * @param {string} event.bookingId - 预约ID
 * @param {Object} event.bookingData - 预约数据
 */
exports.main = async (event, context) => {
  const { type, bookingId, bookingData } = event;

  try {
    // 获取预约详情
    let booking;
    if (bookingId) {
      const res = await db.collection('bookings').doc(bookingId).get();
      booking = res.data;
    } else if (bookingData) {
      booking = bookingData;
    } else {
      return { success: false, msg: '缺少预约信息' };
    }

    if (!booking) {
      return { success: false, msg: '预约不存在' };
    }

    // 获取用户openid
    const wxContext = cloud.getWXContext();
    const callerOpenid = String(wxContext.OPENID || '');
    const bookingOwner = String(booking._openid || '');
    // 安全：C 端只能给自己发；收件人绝不能取自客户端传入的 bookingData
    // （原实现 `booking._openid || OPENID` 让任意用户向任意 openid 发订阅消息/站内信）
    if (!isNonClientSource()) {
      if (!callerOpenid) return { success: false, msg: '请先登录' };
      if (bookingOwner && bookingOwner !== callerOpenid) {
        return { success: false, msg: '无权为该预约发送提醒' };
      }
      if (!bookingOwner && !bookingId) {
        return { success: false, msg: '缺少预约信息' };
      }
    }
    const openid = isNonClientSource() ? (bookingOwner || callerOpenid) : callerOpenid;
    if (!openid) return { success: false, msg: '缺少接收人' };

    // 根据提醒类型发送不同的消息
    let message = {};
    switch (type) {
      case 'success':
        message = {
          title: '预约成功',
          content: `您的预约已确认\n日期：${booking.date}\n时间：${booking.time}\n票号：${booking.ticketCode}`,
          templateId: 'booking_success' // 需要在小程序后台配置
        };
        break;
      
      case 'day_before':
        message = {
          title: '预约提醒',
          content: `提醒：您明天有预约\n日期：${booking.date}\n时间：${booking.time}\n请准时到达`,
          templateId: 'booking_reminder_day'
        };
        break;
      
      case 'hour_before':
        message = {
          title: '预约提醒',
          content: `提醒：您2小时后有预约\n时间：${booking.time}\n请准时到达`,
          templateId: 'booking_reminder_hour'
        };
        break;
      
      case 'changed':
        message = {
          title: '预约变更',
          content: `您的预约已变更\n新日期：${booking.date}\n新时间：${booking.time}`,
          templateId: 'booking_changed'
        };
        break;
      
      case 'cancelled':
        message = {
          title: '预约取消',
          content: `您的预约已取消\n日期：${booking.date}\n时间：${booking.time}`,
          templateId: 'booking_cancelled'
        };
        break;
      
      default:
        return { success: false, msg: '未知的提醒类型' };
    }

    // 发送订阅消息（需要用户已授权）：只发 subscribeTemplates 里登记了真实模板的类型，其余只走站内信
    let subscribeSent = false;
    const sub = buildSubscribe(type, booking);
    if (sub.templateId) {
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: openid,
          templateId: sub.templateId,
          page: `subpackages/business/ticket/index?id=${booking._id || bookingId}`,
          data: sub.data,
          miniprogramState: 'formal'
        });
        subscribeSent = true;
      } catch (err) {
        // 43101 = 用户未订阅 / 次数已用完：正常情况，站内信照发
        console.error('发送订阅消息失败:', type, booking._id || bookingId, err && (err.errCode || err.errMsg || err.message));
      }
    } else if (sub.skip === 'bad_fields') {
      console.error('订阅消息字段不全，跳过:', type, booking._id || bookingId);
    }

    // 站内信始终发送，与订阅消息互补
    await sendInAppMessage(openid, message, booking, type);

    await db.collection('booking_reminders').add({
      data: {
        bookingId: booking._id || bookingId,
        type: type,
        openid: openid,
        sentAt: db.serverDate(),
        status: subscribeSent ? 'sent_both' : 'sent_inapp'
      }
    }).catch((err) => console.warn('booking_reminders log failed:', err));

    return {
      success: true,
      msg: subscribeSent ? '订阅消息与站内信已发送' : '已发送站内消息'
    };
  } catch (err) {
    console.error('发送提醒失败:', err);
    return { success: false, msg: '发送提醒失败', error: err.message };
  }
};

/**
 * 发送站内消息
 * 与web后台的通知消息配置打通
 */
async function sendInAppMessage(openid, message, booking, reminderType) {
  const typeMap = {
    success: 'booking_success',
    day_before: 'booking_reminder',
    hour_before: 'booking_reminder',
    changed: 'booking_changed',
    cancelled: 'booking_cancelled'
  };

  const actionMap = {
    success: (id) => `subpackages/business/ticket/index?id=${id}`,
    day_before: () => 'subpackages/business/booking/index?tab=3',
    hour_before: () => 'subpackages/business/booking/index?tab=3',
    changed: (id) => `subpackages/business/ticket/index?id=${id}`,
    cancelled: () => 'subpackages/business/booking/index?tab=3'
  };

  const msgType = typeMap[reminderType] || 'booking_reminder';
  const relatedId = booking._id || '';
  const actionUrl = actionMap[reminderType] ? actionMap[reminderType](relatedId) : '';

  try {
    await cloud.callFunction({
      name: 'dispatchMessage',
      data: {
        action: 'dispatch',
        eventType: msgType,
        openid,
        relatedId,
        title: message.title,
        content: message.content,
        actionUrl,
        category: 'booking',
        skipDedupe: reminderType === 'day_before' || reminderType === 'hour_before'
      }
    });
  } catch (err) {
    console.error('发送站内消息失败:', err);
  }
}

