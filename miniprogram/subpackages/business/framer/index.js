const { cdnPath } = require('../../../config/cloudEnv');
const { navigateToProductDetail } = require('../../../utils/productDetailNav');
const { seedProductPreview } = require('../../../utils/productDetailCache');

const FALLBACK_AVATAR = '/assets/icons/user.png';
const FALLBACK_COVER = cdnPath('stores/store_shanhaizaowu.png');

Page({
  data: {
    statusBarHeight: 20,
    bgImage: cdnPath('banners/__-drz-__-CK7rdTauhDE-unsplash.jpg'),
    fallbackAvatar: FALLBACK_AVATAR,
    fallbackCover: FALLBACK_COVER,
    framerId: '',
    framer: {},
    works: [],
    loading: true,
    loadError: false,
    loadErrorTitle: '标本师档案加载失败',
    loadErrorDesc: '请检查网络后重试'
  },

  onLoad(options) {
    const { statusBarHeight } = wx.getSystemInfoSync();
    this.setData({ statusBarHeight });

    const id = String((options && options.id) || '').trim();
    if (id) {
      this.setData({ framerId: id });
      this.loadData(id);
    } else {
      this.setData({ loading: false, loadError: true });
      wx.showToast({ title: '标本师不存在', icon: 'none' });
    }
  },

  onShow() {
    const id = this.data.framerId;
    if (!id || !this._readyForShowReload || this._loadingData) return;
    this.loadData(id, { silent: true });
  },

  onShareAppMessage() {
    const framer = this.data.framer || {};
    const id = framer._id || this.data.framerId || '';
    return {
      title: framer.name ? `标本师 ${framer.name} 的个人主页` : '山海造物 · 标本师',
      path: id ? `/subpackages/business/framer/index?id=${id}` : '/subpackages/business/about/index',
      imageUrl: framer.cover || framer.avatar || this.data.bgImage
    };
  },

  async loadData(id, options = {}) {
    const silent = !!(options && options.silent);
    this._loadingData = true;
    this.setData({ loading: !silent, loadError: false, framerId: id });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaff',
        data: { action: 'getPublicFramer', framerId: id }
      });
      const result = (res && res.result) || {};
      if (!result.success || !result.framer) {
        const hidden = result.code === 'HIDDEN';
        this.setData({
          loading: false,
          loadError: true,
          framer: {},
          works: [],
          loadErrorTitle: hidden ? '标本师已下架' : (result.msg || '标本师档案不存在'),
          loadErrorDesc: hidden ? '该标本师暂不对外展示' : '该档案可能已移除'
        });
        wx.showToast({ title: result.msg || '标本师档案不存在', icon: 'none' });
        return;
      }

      const framer = result.framer;
      const rows = Array.isArray(result.works) ? result.works : [];
      const works = rows.map((item) => ({
        ...item,
        coverImage: item.coverImage || FALLBACK_COVER,
        title: item.title || '未命名作品'
      }));

      works.forEach((w) => {
        try {
          seedProductPreview({
            ...w,
            images: w.coverImage ? [w.coverImage] : (w.images || [])
          });
        } catch (e) { /* ignore */ }
      });

      const type = framer.type === 'partner' || framer.type === 'guest' ? 'partner' : 'store'
      const canonicalId = String(framer._id || id)
      this.setData({
        framerId: canonicalId,
        framer: {
          ...framer,
          _id: canonicalId,
          name: framer.name || '标本师',
          alias: framer.alias || '',
          title: framer.title || '',
          avatar: framer.avatar || FALLBACK_AVATAR,
          cover: framer.cover || '',
          gallery: Array.isArray(framer.gallery) ? framer.gallery : [],
          tags: Array.isArray(framer.tags) ? framer.tags : [],
          signatureStyle: framer.signatureStyle || '',
          city: framer.city || '',
          yearsExperience: framer.yearsExperience != null ? Number(framer.yearsExperience) || 0 : 0,
          type,
          typeLabel: framer.title || (type === 'store' ? '门店标本师' : '特邀合作'),
          bio: framer.bio || '',
          craftIntro: framer.craftIntro || ''
        },
        works,
        loadError: false,
        loadErrorTitle: '标本师档案加载失败',
        loadErrorDesc: '请检查网络后重试'
      });
    } catch (err) {
      console.error(err);
      this.setData({ loadError: true, works: [] });
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this._loadingData = false;
      this._readyForShowReload = true;
      this.setData({ loading: false });
    }
  },

  onAvatarError() {
    this.setData({ 'framer.avatar': FALLBACK_AVATAR });
  },

  onCoverError() {
    this.setData({ 'framer.cover': '' });
  },

  previewGallery(e) {
    const urls = this.data.framer && this.data.framer.gallery
    if (!Array.isArray(urls) || !urls.length) return
    const idx = parseInt(e.currentTarget.dataset && e.currentTarget.dataset.index, 10) || 0
    wx.previewImage({ current: urls[idx] || urls[0], urls })
  },

  onWorkCoverError(e) {
    const idx = e.currentTarget.dataset.index;
    if (idx == null) return;
    this.setData({ [`works[${idx}].coverImage`]: FALLBACK_COVER });
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '作品不存在', icon: 'none' });
      return;
    }
    const seed = (this.data.works || []).find((w) => w && w._id === id);
    navigateToProductDetail(id, {
      seed: seed
        ? { ...seed, images: seed.coverImage ? [seed.coverImage] : (seed.images || []) }
        : { _id: id },
      failToast: '无法打开作品'
    });
  },

  retryLoad() {
    const id = this.data.framerId;
    if (!id) {
      this.goBack();
      return;
    }
    this.loadData(id);
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/index/index' })
    });
  }
});
