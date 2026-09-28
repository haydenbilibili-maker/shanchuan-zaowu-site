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

/**
 * 证书归属（礼赠 2026-09-28，与 business/utils/giftHolder.resolveCertRole 同口径的已签收子集）：
 * 非礼赠 → 收藏证书；礼赠且我是已绑定受礼人 → 受赠的收藏证书；我送出的礼赠 → 赠予凭证
 */
function certKindOf(order, openid) {
  if (!(order.source === 'gift' || order.giftMeta)) return 'holder'
  const receiver = (order.giftMeta && order.giftMeta.receiverOpenid) || ''
  return receiver === openid ? 'gift_holder' : 'gift_voucher'
}

const KIND_LABEL = { holder: '', gift_holder: '受赠', gift_voucher: '赠予凭证' }

Page({
  data: {
    headerBlockPx: 16,
    certificates: [],
    holderCount: 0,
    givenCount: 0,
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
      const [res, giftedRes] = await Promise.all([
        db.collection('orders')
          .where({
            _openid: openid,
            status: 'received'
          })
          .orderBy('createTime', 'desc')
          .get(),
        db.collection('orders')
          .where({ 'giftMeta.receiverOpenid': openid, status: 'received' })
          .orderBy('createTime', 'desc')
          .get()
          .catch(() => ({ data: [] }))
      ]);

      const seen = {};
      const rows = ((res && res.data) || []).concat((giftedRes && giftedRes.data) || [])
        .filter((o) => o && !seen[o._id] && (seen[o._id] = true))
        .sort((a, b) => new Date(b.createTime || 0).getTime() - new Date(a.createTime || 0).getTime());
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
        const kind = certKindOf(item, openid);
        return {
          _id: item._id,
          orderNo: item.orderNo || '',
          displayImage: img,
          displayTitle: first.title || '珍藏藏品',
          dateStr: formatCertDate(kind === 'holder' ? item.createTime : (item.receiveTime || item.createTime)),
          kind,
          kindLabel: KIND_LABEL[kind]
        };
      });

      const givenCount = list.filter((c) => c.kind === 'gift_voucher').length;
      this.setData({ certificates: list, holderCount: list.length - givenCount, givenCount, loadError: false });
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
