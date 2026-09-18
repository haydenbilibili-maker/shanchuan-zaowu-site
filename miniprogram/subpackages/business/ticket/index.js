// pages/ticket/index.js
const db = wx.cloud.database();
const { drawMemberQr } = require('../utils/qrCanvas');
const { withAppModal } = require('../../../utils/appModal');
Page(withAppModal({
  data: { 
    statusBarHeight: 20,
    booking: {},
    bookingShortId: '',
    loadError: false,
    showRescheduleModal: false,
    showCancelModal: false,
    newDate: '',
    newTime: '',
    weekDays: [],
    timeSlots: [],
    selectedDateIndex: 0,
    selectedTimeIndex: -1
  },
  onLoad(options) {
    const { statusBarHeight } = wx.getSystemInfoSync();
    this.setData({ statusBarHeight });
    const id = (options && options.id) || '';
    if (!id) {
      this.setData({ loadError: true });
      wx.showToast({ title: '票据信息缺失', icon: 'none' });
      return;
    }
    this.loadBooking(id);
    this.initDate();
    this.initTimeSlots();
  },
  async loadBooking(id) {
    if (!id) {
      this.setData({ loadError: true });
      return;
    }
    wx.showLoading({ title: '获取票据…' });
    try {
      const res = await db.collection('bookings').doc(id).get();
      const booking = res.data || {};
      if (!booking._id) {
        this.setData({ loadError: true, booking: {} });
        wx.showToast({ title: '票据不存在', icon: 'none' });
        return;
      }
      const ticketCode = String(booking.ticketCode || '').trim();
      const displayNo = ticketCode
        || String(booking._id).slice(-12).toUpperCase();
      const qrPayload = booking.qrData
        || (ticketCode ? `BOOKING:${ticketCode}` : String(booking._id));
      this.setData({ booking, bookingShortId: displayNo, loadError: false }, () => {
        drawMemberQr('#ticketQrCanvas', qrPayload, this, 150).catch(() => {});
      });
    } catch (err) {
      this.setData({ loadError: true, booking: {} });
      wx.showToast({ title: '票据不存在', icon: 'none' });
    } finally { wx.hideLoading(); }
  },
  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/subpackages/business/booking/index?tab=3&from=ticket' })
    });
  },

  // 🟢 显示改期弹窗
  showReschedule() {
    if (this.data.booking.status !== 'confirmed') {
      wx.showToast({ title: '该预约无法改期', icon: 'none' });
      return;
    }
    this.setData({ showRescheduleModal: true });
  },

  // 🟢 关闭改期弹窗
  closeRescheduleModal() {
    this.setData({ showRescheduleModal: false });
  },

  // 🟢 确认改期
  async confirmReschedule() {
    if (this.data.selectedTimeIndex === -1) {
      wx.showToast({ title: '请选择新时间', icon: 'none' });
      return;
    }

    const dateObj = this.data.weekDays[this.data.selectedDateIndex];
    const timeObj = this.data.timeSlots[this.data.selectedTimeIndex];
    
    wx.showLoading({ title: '改期中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'updateBooking',
        data: {
          bookingId: this.data.booking._id,
          newDate: dateObj.fullDate,
          newTime: timeObj.time
        }
      });

      wx.hideLoading();
      const result = (res && res.result) || {};
      if (result.success) {
        wx.showToast({ title: '改期成功', icon: 'success' });
        this.setData({ showRescheduleModal: false });
        this.loadBooking(this.data.booking._id); // 重新加载
      } else {
        wx.showToast({ title: result.msg || '改期失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  // 🟢 显示取消弹窗
  showCancel() {
    if (this.data.booking.status !== 'confirmed') {
      wx.showToast({ title: '该预约无法取消', icon: 'none' });
      return;
    }

    // 计算是否可以免费取消
    const bookingDateTime = new Date(`${this.data.booking.date} ${this.data.booking.time}`);
    const now = new Date();
    const hoursDiff = (bookingDateTime - now) / (1000 * 60 * 60);
    const canFreeCancel = hoursDiff >= 24;

    this.modal({
      title: '确认取消',
      overline: 'CANCEL BOOKING',
      content: canFreeCancel
        ? '提前 24 小时取消，不收取任何费用'
        : '距预约时间不足 24 小时，如需取消请联系专员协助',
      confirmText: '确认取消',
      danger: true
    }).then((res) => {
      if (res.confirm) {
        this.doCancel();
      }
    });
  },

  // 🟢 执行取消
  async doCancel() {
    wx.showLoading({ title: '取消中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'cancelBooking',
        data: {
          bookingId: this.data.booking._id,
          reason: '用户主动取消'
        }
      });

      wx.hideLoading();
      const result = (res && res.result) || {};
      if (result.success) {
        wx.showToast({ title: result.msg || '已取消', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      } else {
        wx.showToast({ title: result.msg || '取消失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  // 初始化日期
  initDate() {
    const days = [];
    const weekMap = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const now = new Date();
    for (let i = 0; i < 14; i++) { // 未来14天
      const date = new Date(now);
      date.setDate(now.getDate() + i);
      const y = date.getFullYear();
      const m = (date.getMonth() + 1).toString().padStart(2, '0');
      const d = date.getDate().toString().padStart(2, '0');
      const monthEn = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][date.getMonth()];
      days.push({ 
        week: i === 0 ? 'TODAY' : weekMap[date.getDay()], 
        day: d, 
        month: monthEn, 
        fullDate: `${y}-${m}-${d}` 
      });
    }
    this.setData({ weekDays: days });
  },

  // 初始化时间段
  initTimeSlots() {
    this.setData({
      timeSlots: [
        { time: '10:00', status: 'available' },
        { time: '11:00', status: 'available' },
        { time: '13:00', status: 'available' },
        { time: '14:00', status: 'available' },
        { time: '15:00', status: 'available' },
        { time: '16:00', status: 'available' }
      ]
    });
  },

  // 选择日期
  selectDate(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ selectedDateIndex: index });
  },

  // 选择时间
  selectTime(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ selectedTimeIndex: index });
  },

  // 阻止事件冒泡
  stopPropagation() {
    // 空函数，用于阻止事件冒泡
  }
}));