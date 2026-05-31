// cloudfunctions/addToWaitlist/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 加入候补列表
 * @param {Object} event - 事件参数
 * @param {string} event.date - 日期
 * @param {string} event.time - 时间段
 * @param {string} event.name - 姓名
 * @param {string} event.phone - 手机号
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { date, time, name, phone } = event;

  if (!date || !time || !name || !phone) {
    return { success: false, msg: '信息不完整' };
  }

  try {
    // 1. 检查是否已经在候补列表中
    const existingRes = await db.collection('waitlist').where({
      _openid: openid,
      date: date,
      time: time,
      status: 'waiting'
    }).get();

    if (existingRes.data.length > 0) {
      return { success: false, msg: '您已在该时间段的候补列表中' };
    }

    // 2. 检查是否已有确认的预约
    const bookingRes = await db.collection('bookings').where({
      _openid: openid,
      date: date,
      time: time,
      status: 'confirmed'
    }).get();

    if (bookingRes.data.length > 0) {
      return { success: false, msg: '您已有该时间段的预约' };
    }

    // 3. 获取候补队列位置
    const waitlistCount = await db.collection('waitlist').where({
      date: date,
      time: time,
      status: 'waiting'
    }).count();

    const position = waitlistCount.total + 1;

    // 4. 加入候补列表
    const res = await db.collection('waitlist').add({
      data: {
        _openid: openid,
        date: date,
        time: time,
        name: name,
        phone: phone,
        position: position,
        status: 'waiting',
        createTime: db.serverDate()
      }
    });

    return {
      success: true,
      msg: `已加入候补列表，当前排位：第${position}位`,
      waitlistId: res._id,
      position: position
    };
  } catch (err) {
    console.error('加入候补失败:', err);
    return { success: false, msg: '加入候补失败', error: err.message };
  }
};








