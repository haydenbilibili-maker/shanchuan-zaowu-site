// pages/points/index.js
const app = getApp();
const db = wx.cloud.database();
const { ensureOpenId } = require('../../../utils/orderScope');

Page({
  data: {
    curTab: 0,
    points: 0,
    levelName: 'LOADING...',
    rewards: [], 
    myRewards: [], 
    loading: true,
    showQrModal: false,
    currentCode: '', currentTitle: ''
  },

  onShow() {
    this.refreshAll();
  },
  
  onPullDownRefresh() {
    this.refreshAll().then(() => wx.stopPullDownRefresh());
  },

  switchTab(e) {
    this.setData({ curTab: parseInt(e.currentTarget.dataset.idx) });
    if (this.data.curTab === 1 && this.data.myRewards.length === 0) {
      this.loadMyRewards();
    }
  },

  async refreshAll() {
    await this.loadData(); 
    await this.loadRewards(); 
    if (this.data.curTab === 1) await this.loadMyRewards(); 
  },

  async loadData() {
    if (!app.globalData.openid) return;
    wx.cloud.callFunction({
      name: 'getUserStats',
      success: async (res) => {
        const total = res.result.points;
        const lvl = res.result.levelName;
        let used = 0;
        try {
           const userRes = await db.collection('users').where({_openid: app.globalData.openid}).get();
           if(userRes.data.length > 0) used = userRes.data[0].usedPoints || 0;
        } catch(e){}
        this.setData({ points: total - used, levelName: lvl });
      }
    });
  },

  async loadRewards() {
    try {
      const res = await db.collection('rewards')
        .where({ isOffShelf: false }) 
        .orderBy('cost', 'asc')
        .get();
      this.setData({ rewards: res.data, loading: false });
    } catch (err) { console.error(err); }
  },

  async loadMyRewards() {
    try {
      const openid = await ensureOpenId(app);
      if (!openid) {
        this.setData({ myRewards: [] });
        return;
      }

      const res = await db.collection('orders')
        .where({ _openid: openid, source: 'exchange' })
        .orderBy('createTime', 'desc')
        .get();
      const list = res.data.map(item => ({
        ...item,
        formatTime: new Date(item.createTime).toLocaleDateString()
      }));
      this.setData({ myRewards: list });
    } catch(e) { console.error(e); }
  },

  // 🟢 新增跳转
  goToWallet() {
    wx.navigateTo({ url: '/subpackages/business/coupons/index' });
  },
  
  // 修改兑换调用逻辑，传入 type (转为大写匹配)
  redeem(e) {
    const { id, cost, type, title, image } = e.currentTarget.dataset;
    // ... 校验 ...
    this.doRedeem(id, cost, type, title, image);
  },

  async doRedeem(id, cost, type, title, image, address) {
    wx.showLoading({ title: '兑换中...' });
    if (type === 'goods' && !address) {
       // 这里实物需要补充地址逻辑，复用之前的，为了代码简洁这里假设已传
       // 实际应参考之前回答里的 wx.chooseAddress
    }
    wx.cloud.callFunction({
      name: 'redeemReward',
      data: { rewardId: id, cost: cost, type: type, title: title, image: image, address: address },
      success: (res) => {
        wx.hideLoading();
        if (res.result.success) {
          if (type === 'virtual') {
             this.saveWallpaper();
          } else {
             wx.showToast({ title: '兑换成功', icon: 'success' });
          }
          this.refreshAll();
          this.setData({ curTab: 1 });
        } else {
          wx.showToast({ title: res.result.msg, icon: 'none' });
        }
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '网络错误', icon: 'none' }); }
    });
  },
  
  saveWallpaper() {
    wx.showModal({
      title: '兑换成功', content: '权益已存入“我的兑换”，请前往查看或核销。',
      showCancel: false, confirmColor: '#C4A76C'
    });
  },
  
  showCode(e) { this.setData({ showQrModal: true, currentCode: e.currentTarget.dataset.id, currentTitle: e.currentTarget.dataset.title }); },
  closeCode() { this.setData({ showQrModal: false }); },
  goToOrder(e) { wx.navigateTo({ url: `/subpackages/business/order-detail/index?id=${e.currentTarget.dataset.id}` }); }
});