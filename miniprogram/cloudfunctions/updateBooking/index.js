// cloudfunctions/updateBooking/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 更新预约（改期）
 * @param {Object} event - 事件参数
 * @param {string} event.bookingId - 预约ID
 * @param {string} event.newDate - 新日期
 * @param {string} event.newTime - 新时间
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { bookingId, newDate, newTime } = event;

  if (!bookingId || !newDate || !newTime) {
    return { success: false, msg: '参数不完整' };
  }

  try {
    // 1. 查询预约信息
    const bookingRes = await db.collection('bookings').doc(bookingId).get();
    const booking = bookingRes.data;

    if (!booking) {
      return { success: false, msg: '预约不存在' };
    }

    // 2. 验证权限（只能修改自己的预约）
    if (booking._openid !== openid) {
      return { success: false, msg: '无权限修改' };
    }

    // 3. 验证状态（只能修改已确认的预约）
    if (booking.status !== 'confirmed') {
      return { success: false, msg: '该预约无法修改' };
    }

    // 4. 验证时间（不能改到过去的时间）
    const newDateTime = new Date(`${newDate} ${newTime}`);
    const now = new Date();
    if (newDateTime <= now) {
      return { success: false, msg: '不能改到过去的时间' };
    }

    // 5. 检查新时间段的可用性（可选，根据业务需求）
    // 这里可以添加库存检查逻辑

    // 6. 更新预约
    await db.collection('bookings').doc(bookingId).update({
      data: {
        date: newDate,
        time: newTime,
        updateTime: db.serverDate(),
        // 记录改期历史
        changeHistory: db.command.push({
          oldDate: booking.date,
          oldTime: booking.time,
          newDate: newDate,
          newTime: newTime,
          changeTime: db.serverDate()
        })
      }
    });

    // 7. 发送改期提醒
    try {
      await wx.cloud.callFunction({
        name: 'sendBookingReminder',
        data: {
          type: 'changed',
          bookingId: bookingId,
          bookingData: {
            ...booking,
            date: newDate,
            time: newTime
          }
        }
      });
    } catch (err) {
      console.error('发送改期提醒失败:', err);
    }

    return {
      success: true,
      msg: '改期成功'
    };
  } catch (err) {
    console.error('更新预约失败:', err);
    return { success: false, msg: '改期失败', error: err.message };
  }
};








