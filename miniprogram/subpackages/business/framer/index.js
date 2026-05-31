// pages/framer/index.js
const app = getApp();
const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    statusBarHeight: 20, // 默认值
    framer: {},
    works: [],
    loading: true
  },

  onLoad(options) {
    // 🟢 1. 获取状态栏高度，适配刘海屏
    const { statusBarHeight } = wx.getSystemInfoSync();
    this.setData({ statusBarHeight });

    if (options.id) {
      this.loadData(options.id);
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' });
    }
  },
  
  onShareAppMessage() {
    return {
      title: `标本师 ${this.data.framer.name} 的个人主页`,
      path: `/subpackages/business/framer/index?id=${this.data.framer._id}`,
      imageUrl: this.data.framer.avatar
    }
  },

  async loadData(id) {
    wx.showLoading({ title: '读取档案...' });
    try {
      // 1. 获取标本师信息
      const fRes = await db.collection('framers').doc(id).get();
      
      // 2. 获取其作品 (关联 framerId)
      const pRes = await db.collection('products')
        .where({
          framerId: id,
          isOffShelf: _.neq(true)
        })
        .orderBy('createTime', 'desc')
        .get();

      this.setData({
        framer: fRes.data,
        works: pRes.data
      });

    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/index?id=${id}` });
  },

  // 🟢 返回上一页
  goBack() {
    wx.navigateBack();
  }
});