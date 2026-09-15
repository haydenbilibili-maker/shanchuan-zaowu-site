const app = getApp();
const db = wx.cloud.database();
const { cdnPath } = require('../../../../config/cloudEnv');
const { getPageNavInsets } = require('../../utils/pageNav');

function formatCertDate(raw) {
  if (!raw) return '';
  try {
    let d;
    if (raw instanceof Date) d = raw;
    else if (typeof raw === 'object' && raw.seconds) d = new Date(raw.seconds * 1000);
    else d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}.${m}.${day}`;
  } catch (e) {
    return '';
  }
}

Page({
  data: {
    headerBlockPx: 16,
    certificates: [],
    loading: true,
    loadError: false,
    fallbackImg: cdnPath('stores/store_shanhaizaowu.png')
  },

  onLoad() {
    // 原生导航栏已显示标题；headerExtra 仅留内容顶距，避免自定义 fixed 顶栏再盖住大标题
    const nav = getPageNavInsets({ nativeNav: true, headerExtraRpx: 16 });
    this.setData({ headerBlockPx: nav.headerBlockPx });
    this.loadCertificates();
  },

  async loadCertificates() {
    const openid = (app.globalData && app.globalData.openid) || '';
    if (!openid) {
      this.setData({ loading: false, loadError: true, certificates: [] });
      wx.showToast({ title: '请先登录后再查看证书', icon: 'none' });
      return;
    }

    this.setData({ loading: true, loadError: false });
    wx.showLoading({ title: '检索档案…', mask: true });
    try {
      const res = await db.collection('orders')
        .where({
          _openid: openid,
          status: 'received'
        })
        .orderBy('createTime', 'desc')
        .get();

      const rows = (res && res.data) || [];
      const validList = rows.filter((item) => {
        const products = Array.isArray(item.products) ? item.products : [];
        if (!products.length) return false;
        const firstProd = products[0] || {};
        const type = String(firstProd.latin || firstProd.type || '').toUpperCase();
        return type !== 'COUPON';
      });

      const fallbackImg = this.data.fallbackImg;
      const list = validList.map((item) => {
        const products = Array.isArray(item.products) ? item.products : [];
        const first = products[0] || {};
        let img = first.image || '';
        if (!img || String(img).length < 5) img = fallbackImg;
        return {
          _id: item._id,
          orderNo: item.orderNo || '',
          displayImage: img,
          displayTitle: first.title || '珍藏藏品',
          dateStr: formatCertDate(item.createTime)
        };
      });

      this.setData({ certificates: list, loadError: false });
    } catch (e) {
      console.error(e);
      this.setData({ certificates: [], loadError: true });
      wx.showToast({ title: '证书档案读取失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },

  onThumbError(e) {
    const idx = e.currentTarget.dataset.index;
    if (idx == null) return;
    this.setData({ [`certificates[${idx}].displayImage`]: this.data.fallbackImg });
  },

  viewCert(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '证书不存在', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/subpackages/business/certificate/index?id=${id}`,
      fail: () => wx.showToast({ title: '无法打开证书', icon: 'none' })
    });
  },

  onEmptyAction() {
    if (this.data.loadError) this.loadCertificates();
    else this.goShop();
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) });
  },

  goShop() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
