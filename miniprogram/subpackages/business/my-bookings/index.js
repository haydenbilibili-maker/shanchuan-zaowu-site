// pages/my-bookings/index.js
const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    curTab: 0, // 0:待参加, 1:历史
    upcomingList: [],
    historyList: [],
    loading: true
  },

  onShow() {
    this.loadData();
  },

  switchTab(e) {
    this.setData({ curTab: parseInt(e.currentTarget.dataset.idx) });
  },

  async loadData() {
    wx.showLoading({ title: '同步记录...' });
    try {
      // 查询当前用户的所有预约
      const res = await db.collection('bookings')
        .orderBy('date', 'desc') // 按日期倒序
        .orderBy('time', 'asc')
        .get();
      
      const all = res.data;
      const upcoming = [];
      const history = [];

      all.forEach(item => {
        // 格式化日期: 2023-12-24 -> Dec 24
        const dateObj = new Date(item.date);
        const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        item.month = months[dateObj.getMonth()];
        item.day = dateObj.getDate();
        item._id_short = item._id.substring(item._id.length - 6).toUpperCase(); // 短ID

        // 分类逻辑: 状态是 confirmed 且日期未过(这里简化为只看状态)
        if (item.status === 'confirmed') {
          upcoming.push(item);
        } else {
          history.push(item);
        }
      });

      this.setData({
        upcomingList: upcoming,
        historyList: history,
        loading: false
      });

    } catch (err) {
      console.error(err);
    } finally {
      wx.hideLoading();
    }
  },

  goToTicket(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/subpackages/business/ticket/index?id=${id}` });
  },

  // 返回
  goBack() {
    wx.navigateBack();
  }
});