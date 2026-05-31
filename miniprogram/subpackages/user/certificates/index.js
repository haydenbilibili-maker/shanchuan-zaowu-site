// pages/user/certificates/index.js
const app = getApp();
const db = wx.cloud.database();
const _ = db.command; // 引入 command 用于高级查询

Page({
  data: {
    statusBarHeight: 20,
    certificates: [],
    loading: true,
    fallbackImg: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=400&auto=format&fit=crop'
  },

  onLoad() {
    const { statusBarHeight } = wx.getSystemInfoSync();
    this.setData({ statusBarHeight });
    this.loadCertificates();
  },

  async loadCertificates() {
    wx.showLoading({ title: '检索档案...' });
    try {
      const res = await db.collection('orders')
        .where({ 
           _openid: app.globalData.openid,
           status: 'received'
           // 如果数据库支持，最好在这里加 product_type != coupon 的过滤
        })
        .orderBy('createTime', 'desc')
        .get();
      
      // 🟢 前端过滤：排除代金券
      const validList = res.data.filter(item => {
          if (!item.products || item.products.length === 0) return false;
          const firstProd = item.products[0];
          // 检查类型，排除 COUPON (不区分大小写)
          const type = (firstProd.latin || firstProd.type || '').toUpperCase();
          return type !== 'COUPON';
      });

      const list = validList.map(item => {
        let img = '';
        if (item.products && item.products.length > 0) {
            img = item.products[0].image || '';
        }
        if (!img || img.length < 5) img = this.data.fallbackImg;

        return {
          ...item,
          displayImage: img,
          dateStr: new Date(item.createTime).toLocaleDateString()
        };
      });

      this.setData({ certificates: list });
    } catch(e) { console.error(e); }
    finally { 
      wx.hideLoading(); 
      this.setData({ loading: false });
    }
  },

  viewCert(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/subpackages/business/certificate/index?id=${id}` });
  },

  goBack() { wx.navigateBack(); },
  goShop() { wx.switchTab({ url: '/pages/index/index' }); }
});