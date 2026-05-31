// cloudfunctions/cancelBooking/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 取消预约
 * @param {Object} event - 事件参数
 * @param {string} event.bookingId - 预约ID
 * @param {string} event.reason - 取消原因（可选）
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { bookingId, reason } = event;

  if (!bookingId) {
    return { success: false, msg: '预约ID不能为空' };
  }

  try {
    // 1. 查询预约信息
    const bookingRes = await db.collection('bookings').doc(bookingId).get();
    const booking = bookingRes.data;

    if (!booking) {
      return { success: false, msg: '预约不存在' };
    }

    // 2. 验证权限
    if (booking._openid !== openid) {
      return { success: false, msg: '无权限取消' };
    }

    // 3. 验证状态
    if (booking.status !== 'confirmed') {
      return { success: false, msg: '该预约无法取消' };
    }

    // 4. 检查取消规则（提前X小时可免费取消）
    const bookingDateTime = new Date(`${booking.date} ${booking.time}`);
    const now = new Date();
    const hoursDiff = (bookingDateTime - now) / (1000 * 60 * 60);
    
    const FREE_CANCEL_HOURS = 24; // 提前24小时可免费取消
    const canFreeCancel = hoursDiff >= FREE_CANCEL_HOURS;
    
    let refundAmount = 0;
    let cancelFee = 0;
    
    if (canFreeCancel) {
      // 免费取消，全额退款
      refundAmount = booking.price || 0;
    } else {
      // 收取取消手续费（20%）
      cancelFee = (booking.price || 0) * 0.2;
      refundAmount = (booking.price || 0) - cancelFee;
    }

    // 5. 更新预约状态
    await db.collection('bookings').doc(bookingId).update({
      data: {
        status: 'cancelled',
        cancelTime: db.serverDate(),
        cancelReason: reason || '用户主动取消',
        refundAmount: refundAmount,
        cancelFee: cancelFee
      }
    });

    // 6. 如果涉及退款，记录退款信息（需要对接支付系统）
    if (refundAmount > 0 && booking.price > 0) {
      // 这里可以调用支付退款接口
      // await refundPayment(booking.orderId, refundAmount);
      
      // 记录退款记录
      await db.collection('refunds').add({
        data: {
          bookingId: bookingId,
          amount: refundAmount,
          fee: cancelFee,
          status: 'pending',
          createTime: db.serverDate()
        }
      });
    }

    // 7. 发送取消提醒
    try {
      await wx.cloud.callFunction({
        name: 'sendBookingReminder',
        data: {
          type: 'cancelled',
          bookingId: bookingId,
          bookingData: booking
        }
      });
    } catch (err) {
      console.error('发送取消提醒失败:', err);
    }

    return {
      success: true,
      msg: canFreeCancel ? '取消成功，全额退款' : `取消成功，退款${refundAmount.toFixed(2)}元（扣除手续费${cancelFee.toFixed(2)}元）`,
      refundAmount: refundAmount,
      cancelFee: cancelFee
    };
  } catch (err) {
    console.error('取消预约失败:', err);
    return { success: false, msg: '取消失败', error: err.message };
  }
};








