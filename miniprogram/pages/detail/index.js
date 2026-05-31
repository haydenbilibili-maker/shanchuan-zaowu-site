// pages/detail/index.js
const app = getApp();
const db = wx.cloud.database();
const { getFirstImage } = require('../../utils/util');
const { navigateToConfirmOrder } = require('../../utils/checkout');
const { calcShipping, getShippingRuleText, FREE_SHIPPING_THRESHOLD } = require('../../utils/shipping');
const {
  hasSkus,
  getTotalStock,
  getDisplayPrice,
  getFirstAvailableSku,
  getSkuDimensions,
  getDimensionValues,
  resolveSkuFromSpecs,
  initSelectedSpecs,
  isDimensionValueAvailable
} = require('../../utils/sku');
const { trackBehavior } = require('../../utils/trackBehavior');
const { ensureOpenId, markCartDirty, fetchCartCount, updateCartTabBadge } = require('../../utils/cartHelper');
const { getCustomNavLayout } = require('../../utils/customNav');
const {
  normalizeCategory,
  getCategoryMeta,
  buildGuideUrl,
  isSpecimenCareProduct
} = require('../../utils/careDefaults');
const { fetchCareGuide } = require('../../utils/careApi');

const PROTECTION_LABELS = {
  sanyou: '三有保护动物',
  protected_plant: '保护植物',
  protected_animal: '保护动物'
};

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navPaddingRight: 96,
    product: {},
    isCollected: false, // 收藏状态
    discountRate: 1.0,
    
    // UI 交互相关
    showPosterModal: false,
    posterImage: '',
    isPlaying: false,
    show360Modal: false,
    rotateX: 0, rotateY: 0, transition: 'transform 0.1s linear',
    showPointTip: false,
    pointTipText: '',
    recommends: [],

    hasSku: false,
    displayStock: 0,
    displayPrice: 0,
    priceFrom: false,
    selectedSku: null,
    selectedSkuId: '',
    showSkuSheet: false,
    skuAction: '',
    skuDimensions: [],
    dimensionOptions: [],
    selectedSpecs: {},

    imageIndex: 0,
    imageTotal: 0,
    buyCount: 1,
    cartCount: 0,
    specSummary: '默认规格',
    shippingRuleText: getShippingRuleText(),
    shippingHint: '',
    activeTab: 'detail',
    showStickyTabs: false,
    navOpacity: 0,
    commentTotal: 0,
    detailImages: [],

    claimableCoupons: [],
    bestCoupon: null,
    couponSavedAmount: 0,
    usableCouponCount: 0,
    couponHint: '',
    showCouponSheet: false,

    protectionLabel: '',
    certificateUrl: '',
    showProtectionCert: false,

    showCareStrip: false,
    careSummary: '',
    careCategoryLabel: '',
    careCategoryColor: '#C4A76C',
    careGuideUrl: ''
  },

  sectionTops: { detail: 0, archive: 0, review: 0 },

  onLoad(options) {
    const nav = getCustomNavLayout();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navPaddingRight: nav.navPaddingRight
    });

    this._trackMeta = {
      from: options.from || '',
      wikiId: options.wikiId || '',
      recordId: options.recordId || '',
      zone: options.zone || (options.from === 'wiki' ? 'related' : '')
    };

    if (options.id) {
      this.loadProductDetail(options.id);
    }
  },

  onShow() {
    this.loadCartCount();
    if (app.globalData.refreshCoupons && this.data.displayPrice > 0) {
      app.globalData.refreshCoupons = false;
      this.loadProductCoupons(this.data.displayPrice);
    }
  },

  onReady() {
    setTimeout(() => this.computeSectionTops(), 600);
  },

  onPageScroll(e) {
    const scrollTop = e.scrollTop || 0;
    const opacity = Math.min(scrollTop / 200, 1);
    const showStickyTabs = scrollTop > 420;
    let activeTab = 'detail';
    const tops = this.sectionTops || {};
    if (scrollTop >= (tops.review || 99999) - 120) activeTab = 'review';
    else if (scrollTop >= (tops.archive || 99999) - 120) activeTab = 'archive';
    else activeTab = 'detail';

    if (
      opacity !== this.data.navOpacity ||
      showStickyTabs !== this.data.showStickyTabs ||
      activeTab !== this.data.activeTab
    ) {
      this.setData({ navOpacity: opacity, showStickyTabs, activeTab });
    }
  },

  async loadProductDetail(id) {
    if (!id) {
      wx.showToast({ title: '商品ID不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    wx.showLoading({ title: '调取档案...' });
    try {
      // 1. 获取商品详情
      const res = await db.collection('products').doc(id).get();
      
      if (!res.data) {
        throw new Error('商品不存在');
      }
      
      const data = res.data;
      const productHasSku = hasSkus(data);
      const totalStock = getTotalStock(data);
      data.stock = totalStock;
      const firstSku = productHasSku ? getFirstAvailableSku(data) : null;
      const selectedSpecs = initSelectedSpecs(data, firstSku);

      const displayPrice = firstSku ? (parseFloat(firstSku.price) || 0) : getDisplayPrice(data);
      const detailImages = (data.detailImages && data.detailImages.length)
        ? data.detailImages
        : (data.images || []).slice(1);

      const protectionType = data.protectionType || 'none';
      const protectionLabel = PROTECTION_LABELS[protectionType] || '';
      let certificateUrl = '';
      if (protectionType !== 'none' && data.collectionCertificate) {
        certificateUrl = await this.resolveCloudImage(data.collectionCertificate);
      }

      this.setData({
        product: data,
        hasSku: productHasSku,
        displayStock: firstSku ? (parseInt(firstSku.stock, 10) || 0) : totalStock,
        displayPrice,
        priceFrom: productHasSku && (data.skus || []).length > 1,
        selectedSku: firstSku,
        selectedSkuId: firstSku ? firstSku.id : '',
        selectedSpecs,
        imageTotal: (data.images || []).length,
        imageIndex: 0,
        buyCount: 1,
        detailImages,
        shippingHint: this.buildShippingHint(displayPrice),
        protectionLabel,
        certificateUrl,
        showProtectionCert: !!(protectionLabel && certificateUrl)
      });
      this.refreshDimensionOptions();
      this.updateSpecSummary();
      
      this.checkCollectionStatus(id);
      this.loadUserDiscount();
      this.loadRecommends(data);
      this.loadCommentStats(id);
      this.saveHistory(data);
      this.loadProductCoupons(displayPrice);
      this.loadCarePreview(data);

      trackBehavior('product_view', 'product', id, {
        category: data.category || '',
        source: (this._trackMeta && this._trackMeta.from) || 'direct'
      });

      if (this._trackMeta && this._trackMeta.from === 'wiki' && this._trackMeta.wikiId) {
        trackBehavior('wiki_to_product', 'product', id, {
          wikiId: this._trackMeta.wikiId,
          zone: this._trackMeta.zone || 'related',
          source: 'product_detail'
        });
      } else if (this._trackMeta && this._trackMeta.from === 'identify') {
        trackBehavior('identify_to_product', 'product', id, {
          recordId: this._trackMeta.recordId || '',
          source: 'product_detail'
        });
      }

      setTimeout(() => this.computeSectionTops(), 400);

    } catch (err) {
      console.error('加载商品详情失败:', err);
      
      // 更详细的错误提示
      let errorMsg = '档案调取失败';
      if (err.errCode === -1) {
        errorMsg = '商品不存在或已下架';
      } else if (err.errMsg && err.errMsg.includes('permission')) {
        errorMsg = '权限不足，请检查数据库权限';
      } else if (err.message) {
        errorMsg = err.message;
      }
      
      wx.showToast({ 
        title: errorMsg, 
        icon: 'none',
        duration: 2000
      });
      
      // 2秒后返回上一页
      setTimeout(() => {
        wx.navigateBack();
      }, 2000);
    } finally {
      wx.hideLoading();
    }
  },

  buildShippingHint(price) {
    const amount = parseFloat(price) || 0;
    if (amount >= FREE_SHIPPING_THRESHOLD) return '本单享包邮';
    const fee = calcShipping(amount);
    return `满 ¥${FREE_SHIPPING_THRESHOLD} 包邮，本单运费 ¥${fee}`;
  },

  async loadProductCoupons(productPrice) {
    const price = parseFloat(productPrice) || 0;
    if (price <= 0) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getProductCoupons',
        data: { productPrice: price }
      });
      const result = res.result || {};
      if (!result.success) return;

      const claimableCoupons = result.claimableCoupons || [];
      const bestCoupon = result.bestCoupon || null;
      const couponSavedAmount = result.savedAmount || 0;
      const usableCouponCount = result.usableCount || 0;

      let couponHint = '';
      if (bestCoupon && couponSavedAmount > 0) {
        couponHint = `下单可省 ¥${couponSavedAmount}`;
      } else if (claimableCoupons.some((c) => !c.claimed)) {
        couponHint = '有可领取的优惠券';
      } else if (usableCouponCount > 0) {
        couponHint = `${usableCouponCount} 张券可用`;
      }

      this.setData({
        claimableCoupons,
        bestCoupon,
        couponSavedAmount,
        usableCouponCount,
        couponHint
      });
    } catch (e) {
      console.warn('优惠券加载失败', e);
    }
  },

  openCouponSheet() {
    this.setData({ showCouponSheet: true });
  },

  closeCouponSheet() {
    this.setData({ showCouponSheet: false });
  },

  async claimCoupon(e) {
    const couponId = e.currentTarget.dataset.id;
    const claimed = e.currentTarget.dataset.claimed;
    if (!couponId || claimed) return;
    wx.showLoading({ title: '领取中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'receiveCoupon',
        data: { couponId, receiveType: 'manual' }
      });
      wx.hideLoading();
      if (res.result && res.result.success) {
        wx.showToast({ title: '领取成功', icon: 'success' });
        this.loadProductCoupons(this.data.displayPrice);
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '领取失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '领取失败', icon: 'none' });
    }
  },

  goToCoupons() {
    wx.navigateTo({ url: '/subpackages/business/coupons/index' });
  },

  buyNowWithCoupon() {
    this.setData({ showCouponSheet: false });
    this.handleBuyNow();
  },

  updateSpecSummary() {
    const { hasSku, selectedSku, selectedSpecs, skuDimensions, product } = this.data;
    let specSummary = '默认规格';
    if (hasSku) {
      if (selectedSku && selectedSku.specLabel) {
        specSummary = selectedSku.specLabel;
      } else if (skuDimensions.length) {
        const parts = skuDimensions.map((d) => selectedSpecs[d]).filter(Boolean);
        specSummary = parts.length ? parts.join(' / ') : '请选择规格';
      } else {
        specSummary = '请选择规格';
      }
    }
    this.setData({ specSummary });
  },

  async loadCartCount() {
    const count = await fetchCartCount(app);
    this.setData({ cartCount: count });
    updateCartTabBadge(count);
  },

  async loadCommentStats(id) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getComments',
        data: { targetType: 'product', targetId: id, limit: 1, skip: 0 }
      });
      if (res.result && res.result.success && res.result.stats) {
        this.setData({ commentTotal: res.result.stats.total || 0 });
      }
    } catch (e) {
      console.warn('评价统计加载失败', e);
    }
  },

  async loadCarePreview(product) {
    if (!isSpecimenCareProduct(product)) {
      this.setData({ showCareStrip: false });
      return;
    }
    try {
      const category = normalizeCategory(product.category);
      const { guide } = await fetchCareGuide(category);
      const meta = getCategoryMeta(category);
      this.setData({
        showCareStrip: true,
        careSummary: guide.summary || '签收后请按品类指南妥善安放。',
        careCategoryLabel: meta.label,
        careCategoryColor: meta.color,
        careGuideUrl: buildGuideUrl({ category, from: 'product' })
      });
    } catch (e) {
      console.warn('loadCarePreview', e);
      this.setData({ showCareStrip: false });
    }
  },

  goToCareGuide() {
    const url = this.data.careGuideUrl;
    if (!url) return;
    const category = normalizeCategory(this.data.product && this.data.product.category);
    trackBehavior('care_guide_view', 'category', category);
    wx.navigateTo({ url });
  },

  computeSectionTops() {
    const q = wx.createSelectorQuery().in(this);
    q.select('#section-detail').boundingClientRect();
    q.select('#section-archive').boundingClientRect();
    q.select('#section-review').boundingClientRect();
    q.selectViewport().scrollOffset();
    q.exec((res) => {
      if (!res || !res[3]) return;
      const scrollTop = res[3].scrollTop || 0;
      const offset = 100;
      this.sectionTops = {
        detail: Math.max(0, (res[0]?.top || 0) + scrollTop - offset),
        archive: Math.max(0, (res[1]?.top || 0) + scrollTop - offset),
        review: Math.max(0, (res[2]?.top || 0) + scrollTop - offset)
      };
    });
  },

  onSwiperChange(e) {
    this.setData({ imageIndex: e.detail.current || 0 });
  },

  openSkuSheet() {
    if (this.data.displayStock <= 0) {
      wx.showToast({ title: '暂不可购', icon: 'none' });
      return;
    }
    this.setData({ showSkuSheet: true, skuAction: 'buyNow', buyCount: 1 });
  },

  scrollToSection(e) {
    const tab = e.currentTarget.dataset.tab;
    const top = (this.sectionTops && this.sectionTops[tab]) || 0;
    wx.pageScrollTo({ scrollTop: top, duration: 300 });
    this.setData({ activeTab: tab });
  },

  changeBuyCount(e) {
    const delta = parseInt(e.currentTarget.dataset.delta, 10) || 0;
    const max = Math.max(1, this.data.displayStock || 1);
    let next = (this.data.buyCount || 1) + delta;
    if (next < 1) next = 1;
    if (next > max) {
      wx.showToast({ title: `最多 ${max} 件`, icon: 'none' });
      next = max;
    }
    this.setData({ buyCount: next });
  },

  goToCart() {
    markCartDirty(app);
    wx.switchTab({ url: '/pages/cart/index' });
  },

  goToSupport() {
    const p = this.data.product || {};
    const id = p._id || p.id || '';
    const name = encodeURIComponent(p.title || p.name || '');
    wx.navigateTo({
      url: `/pages/user/support/index?topic=product&productId=${id}&productName=${name}`
    });
  },

  goToCustom() {
    const p = this.data.product || {};
    const id = p._id || p.id || '';
    if (id && p.supportsCustom === false) {
      wx.showModal({
        title: '暂不支持定制',
        content: '该藏品为成品标本，暂不提供工坊定制服务。如需咨询，请联系门店专员。',
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#C4A76C'
      });
      return;
    }
    if (!id) {
      wx.navigateTo({ url: '/pages/custom/index?from=detail' });
      return;
    }
    wx.navigateTo({
      url: `/pages/custom/index?from=detail&productId=${id}&step=2`
    });
  },

  previewDetailImage(e) {
    const current = e.currentTarget.dataset.current;
    const urls = this.data.detailImages || [];
    if (urls.length) wx.previewImage({ current, urls });
  },

  async resolveCloudImage(src) {
    if (!src) return '';
    if (src.startsWith('cloud://')) {
      try {
        const res = await wx.cloud.getTempFileURL({ fileList: [src] });
        if (res.fileList && res.fileList[0] && res.fileList[0].tempFileURL) {
          return res.fileList[0].tempFileURL;
        }
      } catch (e) {
        console.warn('resolveCloudImage', e);
      }
    }
    return src;
  },

  previewCertificate() {
    const url = this.data.certificateUrl;
    if (url) wx.previewImage({ current: url, urls: [url] });
  },

  // 检查是否已收藏
  async checkCollectionStatus(id) {
    if (!app.globalData.openid) return;
    try {
      // 修改集合名为 'collections'，字段为 'productId'
      const res = await db.collection('collections').where({
        _openid: app.globalData.openid,
        productId: id,
        type: 'wishlist'
      }).count();
      this.setData({ isCollected: res.total > 0 });
    } catch (e) { console.error(e); }
  },

  // 🟢 核心：点击收藏/取消收藏
  async toggleCollect() {
    wx.vibrateShort({ type: 'light' });
    const p = this.data.product;
    
    // 乐观更新 UI，提升响应速度
    const oldStatus = this.data.isCollected;
    this.setData({ isCollected: !oldStatus });

    try {
      const res = await wx.cloud.callFunction({
        name: 'toggleCollection',
        data: {
          targetId: p._id,
          type: 'wishlist',
          // 传入快照，方便收藏列表展示
          snapshot: {
            title: p.title,
            image: getFirstImage(p.images),
            price: p.price,
            latinName: p.latinName
          }
        }
      });

      if (res.result.success) {
        wx.showToast({ title: res.result.msg, icon: 'none' });
      } else {
        // 失败回滚
        this.setData({ isCollected: oldStatus });
      }
    } catch (err) {
      console.error(err);
      this.setData({ isCollected: oldStatus });
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  // 加入购物车
  handleBuy() {
    if (this.data.displayStock <= 0) {
      wx.showModal({
        title: '遗憾通知',
        content: '该藏品已被其他收藏家珍藏。',
        showCancel: false,
        confirmColor: '#C4A76C'
      });
      return;
    }
    if (!this.data.hasSku) {
      this.setData({ skuAction: 'cart', buyCount: 1 });
      this.addToCartDirect();
      return;
    }
    this.setData({ showSkuSheet: true, skuAction: 'cart', buyCount: 1 });
  },

  // 立即购买
  handleBuyNow() {
    wx.vibrateShort({ type: 'heavy' });
    if (this.data.displayStock <= 0) {
      wx.showModal({
        title: '遗憾通知',
        content: '该藏品暂不可购。',
        showCancel: false,
        confirmColor: '#C4A76C'
      });
      return;
    }
    this.setData({ showSkuSheet: true, skuAction: 'buyNow', buyCount: 1 });
  },

  refreshDimensionOptions() {
    const product = this.data.product;
    const selectedSpecs = this.data.selectedSpecs || {};
    const dims = getSkuDimensions(product);
    const dimensionOptions = dims.map((name) => ({
      name,
      values: getDimensionValues(product, name, selectedSpecs).map((value) => ({
        value,
        disabled: !isDimensionValueAvailable(product, name, value, selectedSpecs)
      }))
    }));
    this.setData({ skuDimensions: dims, dimensionOptions });
  },

  applySkuSelection(selectedSpecs, sku) {
    const displayPrice = sku ? (parseFloat(sku.price) || 0) : getDisplayPrice(this.data.product);
    const displayStock = sku ? (parseInt(sku.stock, 10) || 0) : 0;
    let buyCount = this.data.buyCount || 1;
    if (buyCount > displayStock) buyCount = Math.max(1, displayStock);
    this.setData({
      selectedSpecs,
      selectedSku: sku || null,
      selectedSkuId: sku ? sku.id : '',
      displayPrice,
      displayStock,
      buyCount,
      shippingHint: this.buildShippingHint(displayPrice)
    });
    this.refreshDimensionOptions();
    this.updateSpecSummary();
    this.loadProductCoupons(displayPrice);
  },

  selectDimension(e) {
    const { dim, value } = e.currentTarget.dataset;
    if (!dim || !value) return;

    const selectedSpecs = { ...(this.data.selectedSpecs || {}), [dim]: value };
    const sku = resolveSkuFromSpecs(this.data.product, selectedSpecs);
    this.applySkuSelection(selectedSpecs, sku);
  },

  selectSku(e) {
    const skuId = e.currentTarget.dataset.id;
    const sku = (this.data.product.skus || []).find((s) => s.id === skuId);
    if (!sku) return;
    const selectedSpecs = initSelectedSpecs(this.data.product, sku);
    this.applySkuSelection(selectedSpecs, sku);
  },

  closeSkuSheet() {
    this.setData({ showSkuSheet: false, skuAction: '' });
  },

  confirmSkuAction() {
    const dims = this.data.skuDimensions || [];
    const selectedSpecs = this.data.selectedSpecs || {};

    if (this.data.hasSku) {
      const allSelected = dims.every((d) => selectedSpecs[d]);
      if (!allSelected) {
        wx.showToast({ title: '请选择完整规格', icon: 'none' });
        return;
      }
      if (!this.data.selectedSkuId) {
        wx.showToast({ title: '所选规格不可用', icon: 'none' });
        return;
      }
    }
    if (this.data.displayStock <= 0) {
      wx.showToast({ title: '该规格已售罄', icon: 'none' });
      return;
    }
    this.setData({ showSkuSheet: false });
    if (this.data.skuAction === 'cart') {
      this.addToCartDirect();
    } else {
      this.buyNowDirect();
    }
  },

  async addToCartDirect() {
    wx.vibrateShort({ type: 'medium' });
    const p = this.data.product;
    if (!p || !p._id) {
      wx.showToast({ title: '商品信息异常', icon: 'none' });
      return;
    }

    const openid = await ensureOpenId(app);
    if (!openid) {
      wx.showToast({ title: '登录中，请稍后重试', icon: 'none' });
      return;
    }

    const sku = this.data.selectedSku;
    const skuId = sku ? sku.id : '';
    const price = sku ? sku.price : p.price;
    const count = this.data.buyCount || 1;

    wx.showLoading({ title: '加入中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'toggleCollection',
        data: {
          targetId: p._id,
          type: 'product',
          action: 'add',
          skuId,
          skuLabel: sku ? sku.specLabel : '',
          snapshot: {
            title: p.title,
            image: getFirstImage(p.images),
            price,
            latinName: p.latinName,
            skuLabel: sku ? sku.specLabel : '',
            count
          }
        }
      });
      wx.hideLoading();
      if (res.result && res.result.success) {
        markCartDirty(app);
        trackBehavior('product_add_cart', 'product', p._id, {
          skuId,
          count,
          action: res.result.action || 'add'
        });
        const cartCount = await fetchCartCount(app);
        this.setData({ cartCount });
        updateCartTabBadge(cartCount);

        if (res.result.action === 'merged') {
          wx.showToast({ title: res.result.msg || '数量已更新', icon: 'success' });
        } else if (res.result.action === 'exists') {
          wx.showModal({
            title: '已在购物车',
            content: '该规格已在购物车中，是否前往调整数量？',
            confirmColor: '#C4A76C',
            success: (r) => { if (r.confirm) this.goToCart(); }
          });
        } else {
          wx.switchTab({ url: '/pages/cart/index' });
        }
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '加入失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  buyNowDirect() {
    const p = this.data.product;
    const sku = this.data.selectedSku;
    const count = this.data.buyCount || 1;
    navigateToConfirmOrder([{
      productId: p._id,
      skuId: sku ? sku.id : '',
      skuLabel: sku ? sku.specLabel : '',
      count,
      title: p.title,
      image: getFirstImage(sku && sku.image ? [sku.image] : p.images),
      price: sku ? sku.price : p.price,
      latinName: p.latinName
    }], {
      source: 'buyNow',
      couponId: this.data.bestCoupon ? this.data.bestCoupon._id : null
    });
  },

  loadUserDiscount() {
    wx.cloud.callFunction({
      name: 'getUserStats',
      success: (res) => {
        if (res.result && res.result.discountRate) {
          this.setData({ discountRate: res.result.discountRate });
        }
      }
    });
  },

  async loadRecommends(product) {
    if (!product || !product._id) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getRecommendations',
        data: {
          userId: app.globalData.openid,
          productId: product._id,
          category: product.category,
          limit: 6
        }
      });
      const list = (res.result && res.result.data) || (res.result && res.result.recommendations) || [];
      const filtered = list.filter(item => item._id !== product._id).slice(0, 4);
      this.setData({ recommends: filtered });
    } catch (e) {
      try {
        const _ = db.command;
        const fb = await db.collection('products')
          .where({ category: product.category, isOffShelf: false, _id: _.neq(product._id) })
          .limit(4)
          .get();
        this.setData({ recommends: fb.data || [] });
      } catch (err) {
        console.warn('相关推荐加载失败', err);
      }
    }
  },

  previewImage(e) {
    const current = e.currentTarget.dataset.current;
    const urls = (this.data.product.images || []).length
      ? this.data.product.images
      : [current];
    wx.previewImage({ current, urls });
  },

  handleTitleClick() {
    wx.vibrateShort({ type: 'light' });
  },

  showAR() {
    const id = this.data.product._id;
    if (!id) return;
    wx.navigateTo({ url: `/subpackages/business/ar/index?productId=${id}` });
  },

  goToFramer(e) {
    const id = e.currentTarget.dataset.id || this.data.product.framerId;
    if (!id) {
      wx.showToast({ title: '暂无标本师信息', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/subpackages/business/framer/index?id=${id}` });
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/detail/index?id=${id}` });
  },

  handleAudio() {
    wx.showToast({ title: '音频导览筹备中', icon: 'none' });
  },

  async createPoster() {
    const p = this.data.product;
    if (!p._id) return;
    wx.showLoading({ title: '生成海报...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'generateShareCard',
        data: { productId: p._id, type: 'product' }
      });
      wx.hideLoading();
      const url = res.result && (res.result.tempFilePath || res.result.filePath || res.result.url);
      if (url) {
        this.setData({ showPosterModal: true, posterImage: url });
      } else {
        wx.showToast({ title: '海报生成失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '海报生成失败', icon: 'none' });
    }
  },

  closePosterModal() {
    this.setData({ showPosterModal: false });
  },

  savePoster() {
    if (!this.data.posterImage) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.posterImage,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
    });
  },

  goBack() { wx.navigateBack(); },
  show360() { this.setData({ show360Modal: true }); },
  close360() { this.setData({ show360Modal: false }); },
  
  // 3D 触摸逻辑
  on360TouchStart(e) { this.lastX = e.touches[0].clientX; this.lastY = e.touches[0].clientY; this.setData({ transition: 'none' }); },
  on360TouchMove(e) {
    const cx = e.touches[0].clientX, cy = e.touches[0].clientY;
    const dx = cx - this.lastX, dy = cy - this.lastY;
    this.setData({ rotateY: this.data.rotateY + dx * 0.5, rotateX: this.data.rotateX - dy * 0.5 });
    this.lastX = cx; this.lastY = cy;
  },
  on360TouchEnd() { this.setData({ transition: 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }); },
  
  saveHistory(product) { 
      let h = wx.getStorageSync('visit_history') || []; 
      const idx = h.findIndex(i => i._id === product._id);
      if(idx > -1) h.splice(idx, 1);
      h.unshift({
        _id: product._id, 
        title: product.title, 
        image: getFirstImage(product.images)
      });
      if(h.length > 20) h.pop();
      wx.setStorageSync('visit_history', h);
  },

  // 🟢 分享功能
  onShareAppMessage(options) {
    const product = this.data.product;
    const userId = app.globalData.openid;

    // 记录分享行为
    if (userId && product._id) {
      this.recordShare(userId, 'product', product._id, 'wechat');
    }

    return {
      title: `${product.title || '精美标本'} | 山海造物`,
      path: `/pages/detail/index?id=${product._id}`,
      imageUrl: getFirstImage(product.images) || ''
    };
  },

  // 分享到朋友圈
  onShareTimeline() {
    const product = this.data.product;
    const userId = app.globalData.openid;

    // 记录分享行为
    if (userId && product._id) {
      this.recordShare(userId, 'product', product._id, 'timeline');
    }

    return {
      title: `${product.title || '精美标本'} | 山海造物`,
      imageUrl: getFirstImage(product.images) || ''
    };
  },

  // 触发分享（显示分享菜单）
  triggerShare() {
    wx.vibrateShort({ type: 'light' });
    // 小程序会自动显示分享菜单，这里可以添加一些提示
    wx.showToast({ 
      title: '点击右上角分享', 
      icon: 'none',
      duration: 2000
    });
  },

  // 记录分享行为
  async recordShare(userId, targetType, targetId, shareType) {
    try {
      wx.cloud.callFunction({
        name: 'trackUserBehavior',
        data: {
          userId,
          action: 'share',
          targetType,
          targetId,
          shareType, // 'wechat' | 'timeline' | 'image'
          timestamp: Date.now()
        }
      }).catch(err => {
        console.warn('记录分享失败:', err);
      });

      // 分享奖励（积分）
      if (userId) {
        wx.cloud.callFunction({
          name: 'earnPoints',
          data: {
            userId,
            points: 5, // 分享获得5积分
            reason: '分享藏品',
            source: 'share'
          }
        }).catch(err => {
          console.warn('分享奖励失败:', err);
        });
      }
    } catch (e) {
      console.warn('记录分享失败:', e);
    }
  },

  // 跳转到评价页面
  goToComment() {
    if (!this.data.product._id) {
      wx.showToast({
        title: '商品信息加载中，请稍后再试',
        icon: 'none'
      })
      return
    }
    wx.navigateTo({
      url: `/pages/comment/index?targetType=product&targetId=${this.data.product._id}`
    })
  }
});