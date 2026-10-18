const app = getApp();
const db = wx.cloud.database();
const { cdnPath } = require('../../../../config/cloudEnv');
const { applySeals, markUnsealed } = require('./certSeal');

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

/** 全部 / 收藏（含受赠）/ 赠出 */
function filterCerts(list, filter) {
  const all = list || []
  if (filter === 'holder') return all.filter((c) => c.kind !== 'gift_voucher')
  if (filter === 'given') return all.filter((c) => c.kind === 'gift_voucher')
  return all
}

// 小程序端单次 get() 最多 20 条：按 skip 分批取完，上限 50 批（1000 单）防异常死循环
const PAGE_SIZE = 20
const MAX_PAGES = 50

async function fetchAllPages(buildQuery) {
  const all = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await buildQuery().skip(page * PAGE_SIZE).limit(PAGE_SIZE).get()
    const batch = (res && res.data) || []
    all.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return { data: all }
}

Page({
  data: {
    certificates: [],
    /** 2026-10-17 重构：全部 / 收藏 / 赠出（只有赠出过才出现筛选） */
    filter: 'all',
    visible: [],
    holderCount: 0,
    givenCount: 0,
    loading: true,
    loadError: false,
    fallbackImg: cdnPath('stores/store_shanhaizaowu.png')
  },

  onLoad() {
    // 原生导航栏已显示标题；内容改回页面滚动（原 scroll-view + 量出来的顶距）
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
        fetchAllPages(() => db.collection('orders')
          .where({
            _openid: openid,
            status: 'received'
          })
          .orderBy('createTime', 'desc')),
        fetchAllPages(() => db.collection('orders')
          .where({ 'giftMeta.receiverOpenid': openid, status: 'received' })
          .orderBy('createTime', 'desc'))
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

      const sealedList = applySeals(list, wx);
      const givenCount = sealedList.filter((c) => c.kind === 'gift_voucher').length;
      const filter = givenCount ? this.data.filter : 'all';
      this.setData({ certificates: sealedList, holderCount: list.length - givenCount, givenCount, loadError: false, filter, visible: filterCerts(sealedList, filter) });
    } catch (e) {
      console.error(e);
      this.setData({ certificates: [], visible: [], loadError: true });
      wx.showToast({ title: '证书档案读取失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },

  onThumbError(e) {
    const id = e.currentTarget.dataset.id;
    const all = this.data.certificates || [];
    const i = all.findIndex((c) => c && c._id === id);
    if (i < 0) return;
    all[i].displayImage = this.data.fallbackImg;
    this.setData({ certificates: all, visible: filterCerts(all, this.data.filter) });
  },

  onFilter(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.filter) return;
    this.setData({ filter: key, visible: filterCerts(this.data.certificates, key) });
  },

  viewCert(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '证书不存在', icon: 'none' });
      return;
    }
    const all = this.data.certificates || [];
    const i = all.findIndex((c) => c && c._id === id);
    if (i >= 0 && all[i].sealed) {
      // 掰开火漆：两半错开落下 0.5s，再进证书；返回时这张已是普通卡
      if (this._breaking) return;
      this._breaking = true;
      markUnsealed(id, wx);
      all[i] = { ...all[i], breaking: true };
      this.setData({ certificates: all, visible: filterCerts(all, this.data.filter) });
      this._breakTimer = setTimeout(() => {
        this._breaking = false;
        all[i] = { ...all[i], sealed: false, breaking: false };
        this.setData({ certificates: all, visible: filterCerts(all, this.data.filter) });
        this.openCert(id);
      }, 560);
      return;
    }
    this.openCert(id);
  },

  onUnload() {
    clearTimeout(this._breakTimer);
  },

  openCert(id) {
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
