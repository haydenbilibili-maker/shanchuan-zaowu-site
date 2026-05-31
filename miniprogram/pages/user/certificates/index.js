// pages/user/certificates/index.js
const app = getApp();
const db = wx.cloud.database();
const { ensureOpenId } = require('../../../utils/orderScope');

function isCouponOrder(order) {
  if (order.source === 'exchange') return true;
  if (!order.products || !order.products.length) return false;
  const firstProd = order.products[0];
  const type = String(firstProd.latin || firstProd.type || firstProd.category || '').toUpperCase();
  const title = String(firstProd.title || '');
  return type === 'COUPON' || /代金券|优惠券|礼券/.test(title);
}

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
      const openid = await ensureOpenId(app);
      if (!openid) {
        this.setData({ certificates: [], loading: false });
        return;
      }

      let rows = [];
      try {
        const res = await db.collection('orders')
          .where({ _openid: openid, status: 'received' })
          .orderBy('createTime', 'desc')
          .limit(100)
          .get();
        rows = res.data || [];
      } catch (indexErr) {
        console.warn('certificates orderBy fallback', indexErr);
        const res = await db.collection('orders')
          .where({ _openid: openid, status: 'received' })
          .limit(100)
          .get();
        rows = (res.data || []).sort(
          (a, b) => new Date(b.createTime || 0) - new Date(a.createTime || 0),
        );
      }

      const validList = rows.filter((item) => !isCouponOrder(item));

      const list = validList.map((item) => {
        let img = '';
        if (item.products && item.products.length > 0) {
          img = item.products[0].image || '';
        }
        if (!img || img.length < 5) img = this.data.fallbackImg;

        return {
          ...item,
          displayImage: img,
          dateStr: new Date(item.createTime).toLocaleDateString(),
        };
      });

      this.setData({ certificates: list });
    } catch (e) {
      console.error('loadCertificates', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
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