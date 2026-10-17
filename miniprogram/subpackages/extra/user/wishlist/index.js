const app = getApp();
const { ensureOpenId } = require('../../../../utils/cartHelper');
const { cdnPath } = require('../../../../config/cloudEnv');
const { navigateToProductDetail } = require('../../../../utils/productDetailNav');

/** 记下的日子：「10.12 记下」（读不到不写，不编造） */
function formatSavedDay(raw) {
  if (!raw) return '';
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')} 记下`;
}

Page({
  data: {
    tab: 'favorite',
    list: [],
    favoriteCount: 0,
    wishlistCount: 0,
    loading: true,
    fallbackImg: cdnPath('stores/store_shanhaizaowu.png')
  },

  onLoad(query) {
    // 2026-10-17 重构：内容改回页面滚动（原 scroll-view + 量出来的顶距），原生导航栏已写标题
    const tab = query && query.tab === 'wishlist' ? 'wishlist' : 'favorite';
    this.setData({ tab });
  },

  onShow() {
    this.loadLists();
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab || tab === this.data.tab) return;
    this.setData({ tab });
    this.applyTabList();
  },

  async loadLists() {
    this.setData({ loading: true });
    try {
      const openid = await ensureOpenId(app);
      if (!openid) {
        this.setData({ loading: false, list: [], favoriteCount: 0, wishlistCount: 0 });
        wx.showToast({ title: '请先登录', icon: 'none' });
        return;
      }
      const db = wx.cloud.database();
      const [favRes, wishRes, depositRes] = await Promise.all([
        db.collection('collections').where({ _openid: openid, type: 'favorite' }).orderBy('createTime', 'desc').limit(100).get(),
        db.collection('collections').where({ _openid: openid, type: 'wishlist' }).orderBy('createTime', 'desc').limit(100).get(),
        db.collection('deposit_intents').where({
          _openid: openid,
          status: db.command.in(['intent', 'pending_pay', 'paid'])
        }).limit(100).get().catch(() => ({ data: [] }))
      ]);

      const depositSet = {};
      ((depositRes && depositRes.data) || []).forEach((d) => {
        if (d && d.productId) depositSet[d.productId] = true;
      });

      const mapRow = (row) => ({
        _id: row._id,
        productId: row.productId,
        title: row.title || '',
        image: row.image || this.data.fallbackImg,
        price: row.price,
        latinName: row.latinName || '',
        soldOut: !!row.soldOut,
        hasDeposit: !!depositSet[row.productId],
        savedText: formatSavedDay(row.createTime)
      });

      this._favorites = ((favRes && favRes.data) || []).map(mapRow);
      this._wishlists = ((wishRes && wishRes.data) || []).map(mapRow);
      this.setData({
        favoriteCount: this._favorites.length,
        wishlistCount: this._wishlists.length,
        loading: false
      });
      this.applyTabList();
    } catch (e) {
      console.error('load wishlist page failed', e);
      this.setData({ loading: false, list: [] });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  applyTabList() {
    const list = this.data.tab === 'wishlist' ? (this._wishlists || []) : (this._favorites || []);
    this.setData({ list });
  },

  onThumbError(e) {
    const idx = e.currentTarget.dataset.index;
    if (idx == null) return;
    this.setData({ [`list[${idx}].image`]: this.data.fallbackImg });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const seed = (this.data.list || []).find((x) => x && (x._id === id || x.productId === id || x.targetId === id));
    navigateToProductDetail(id, {
      seed: seed || { _id: id },
      failToast: '无法打开藏品'
    });
  },

  goExplore() {
    wx.switchTab({
      url: '/pages/index/index',
      fail: () => wx.navigateBack({ fail: () => {} })
    });
  },

  async removeItem(e) {
    const id = e.currentTarget.dataset.id;
    const productId = e.currentTarget.dataset.pid;
    if (!id || !productId) return;
    const type = this.data.tab === 'wishlist' ? 'wishlist' : 'favorite';
    try {
      wx.showLoading({ title: '移除中', mask: true });
      const res = await wx.cloud.callFunction({
        name: 'toggleCollection',
        data: {
          targetId: productId,
          type,
          action: 'remove'
        }
      });
      wx.hideLoading();
      const result = (res && res.result) || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || '移除失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: type === 'wishlist' ? '已取消候补' : '已取消收藏', icon: 'none' });
      this.loadLists();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  }
});
