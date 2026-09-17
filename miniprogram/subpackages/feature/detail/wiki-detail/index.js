const app = getApp();
const { getFirstImage } = require('../../../../utils/util');
const { navigateToConfirmOrder } = require('../../../../utils/checkout');
const { trackBehavior } = require('../../../../utils/trackBehavior');
const { cdnPath } = require('../../../../config/cloudEnv');
const { navigateToProductDetail } = require('../../../../utils/productDetailNav');
const { seedProductPreview } = require('../../../../utils/productDetailCache');
const { buildCraftDisplayTags } = require('../../../../config/productTaxonomy');

function getProductStock(p) {
  if (!p) return 0;
  if (p.hasSku && p.skus && p.skus.length) {
    return p.skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0);
  }
  return parseInt(p.stock, 10) || 0;
}

Page({
  data: {
    statusBarHeight: 20,
    wikiId: '',
    loading: true,
    loadError: false,
    wiki: {},
    articleContent: '',
    relatedProducts: [],
    alternativeProducts: [],
    displayProducts: [],
    usingAlternative: false,
    relatedArticles: [],
    primaryProduct: null,
    protectionTags: [],
    archiveRows: [],
    fallbackImg: cdnPath('stores/store_shanhaizaowu.png'),
    // 注册门禁（2026-09-17）：未登录/未注册态整页灰色模糊 + 原地授权弹窗（无「再看看」）
    registerGated: false,
    tagStyle: {
      p: 'margin-bottom: 20px; line-height: 1.8; color: #D5D1C8; text-align: justify;',
      h2: 'font-size: 18px; font-weight: bold; color: #C4A76C; margin: 30px 0 15px; border-bottom: 1px solid #262320; padding-bottom: 8px;',
      img: 'border-radius: 8px; margin: 20px 0; width: 100% !important; height: auto !important;',
      blockquote: 'background: rgba(196,167,108,0.08); border-left: 6px solid #C4A76C; padding: 16px; margin: 20px 0; color: #A09A90; font-style: italic;',
      strong: 'color: #FFFFFF; font-weight: bold;'
    }
  },

  onLoad(options) {
    const { statusBarHeight } = wx.getSystemInfoSync();
    this.setData({ statusBarHeight, wikiId: options.id || '' });
    this.evaluateRegisterGate();
    if (options.id) {
      this.loadDetail(options.id);
    } else {
      this.setData({ loading: false, loadError: true });
    }
  },

  /**
   * 注册门禁判定：只有「本人 + 未注册」才拦。
   *
   * 为什么不拦别人：从分享链接进来的访客没有注册义务，拦他们只会把内容变成
   * 「看不到」，与需求 3 的原决策（不制造看不到的差评）冲突。
   * 为什么整页模糊而不是弹个可关的框：见 index.wxml 注释 —— 只是提示就不是门禁。
   */
  async evaluateRegisterGate() {
    try {
      const { ensureSession } = require('../../../../utils/userSession');
      const { resolveAuthState } = require('../../../../utils/profileHelper');
      const session = await ensureSession(app);
      const state = session.authState || resolveAuthState(session.user);
      if (state === 'guest') {
        this.setData({ registerGated: true });
        trackBehavior('wiki_register_gate', 'wiki', this.data.wikiId, { step: 'show' });
      }
    } catch (e) {
      // 判定失败**不拦**：宁可少拦一次，也不要因为一次网络抖动把档案锁死
      console.warn('evaluateRegisterGate', e);
    }
  },

  /** 原地注册成功：解模糊 + 刷新会话相关数据（不跳注册页、不 navigateBack） */
  async onRegisterSuccess() {
    this.setData({ registerGated: false });
    trackBehavior('wiki_register_gate', 'wiki', this.data.wikiId, { step: 'success' });
    try {
      const { invalidateAfterProfile } = require('../../utils/cacheInvalidate');
      invalidateAfterProfile();
    } catch (e) { /* 分包各有副本，取不到也不影响主流程 */ }
    wx.showToast({ title: '注册成功', icon: 'success' });
    if (this.data.wikiId) this.loadDetail(this.data.wikiId);
  },

  async loadDetail(id) {
    this.setData({ loading: true, loadError: false, wikiId: id });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getWikiData',
        data: { action: 'get_detail', wikiId: id }
      });
      const result = res.result || {};
      if (!result.success || !result.data) {
        throw new Error(result.msg || '内容不存在');
      }

      const wiki = result.data;
      const relatedProducts = result.relatedProducts || [];
      const alternativeProducts = result.alternativeProducts || [];
      const usingAlternative = !!result.usingAlternative;
      const relatedArticles = result.relatedArticles || [];
      // 需求 11：补 sensitiveEnabled（关联藏品此前封面直出）
      const { sensitiveEnabledOf } = require('../../../../utils/sensitiveBlurCard');
      const displayProducts = (usingAlternative ? alternativeProducts : relatedProducts).map((p) => ({
        ...p,
        craftTags: buildCraftDisplayTags(p),
        sensitiveEnabled: sensitiveEnabledOf(p),
        _relatedKey: p._relatedKey || `${p._id}::${p.relatedSkuId || ''}`
      }));

      const protectionTags = [];
      if (wiki.iucn) protectionTags.push({ system: 'IUCN', label: wiki.iucn });
      if (wiki.protectionLevel) protectionTags.push({ system: '国家重点保护', label: wiki.protectionLevel });
      if (wiki.cites) protectionTags.push({ system: 'CITES', label: wiki.cites });
      const archiveRows = [
        wiki.distribution ? { title: '地理分布', text: wiki.distribution } : null,
        wiki.habitat ? { title: '栖息地', text: wiki.habitat } : null,
        wiki.morphology ? { title: '形态特征', text: wiki.morphology } : null,
        wiki.habits ? { title: '生活习性', text: wiki.habits } : null
      ].filter(Boolean);

      let primaryProduct = null;
      const candidates = displayProducts.filter((p) => {
        if (p.relatedSkuId && p.skus && p.skus.length) {
          const sku = p.skus.find((s) => s && String(s.id) === String(p.relatedSkuId));
          if (sku) return (parseInt(sku.stock, 10) || 0) > 0;
        }
        return getProductStock(p) > 0;
      });
      if (candidates.length) {
        primaryProduct = candidates.sort((a, b) => (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0))[0];
      }

      this.setData({
        wiki,
        articleContent: wiki.content || `<p>${wiki.brief || ''}</p>`,
        relatedProducts,
        alternativeProducts,
        displayProducts,
        usingAlternative,
        relatedArticles,
        primaryProduct,
        protectionTags,
        archiveRows,
        loadError: false
      });

      displayProducts.forEach((p) => {
        try { seedProductPreview(p); } catch (e) { /* ignore */ }
      });

      trackBehavior('encyclopedia_content_click', 'wiki', id, {
        hasRelatedProduct: relatedProducts.length > 0,
        view: 'detail'
      });
    } catch (err) {
      console.error(err);
      this.setData({ loadError: true, wiki: {}, articleContent: '', displayProducts: [], relatedArticles: [], protectionTags: [], archiveRows: [] });
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  retryLoad() {
    const id = this.data.wikiId;
    if (!id) {
      this.goBack();
      return;
    }
    this.loadDetail(id);
  },

  productDetailUrl(id, skuId) {
    const skuQs = skuId ? `&skuId=${encodeURIComponent(skuId)}` : '';
    return `/subpackages/feature/detail/index?id=${id}${skuQs}&from=wiki&wikiId=${this.data.wikiId}&zone=related`;
  },

  goToProduct(e) {
    const id = e.currentTarget.dataset.id;
    const skuId = e.currentTarget.dataset.skuid || '';
    if (!id) {
      wx.showToast({ title: '藏品不存在', icon: 'none' });
      return;
    }
    trackBehavior('wiki_to_product', 'product', id, {
      wikiId: this.data.wikiId,
      zone: 'related',
      source: 'wiki_detail',
      skuId
    });
    const seed = (this.data.displayProducts || []).find((p) => p && p._id === id);
    navigateToProductDetail(id, {
      seed: seed || { _id: id },
      query: {
        from: 'wiki',
        wikiId: this.data.wikiId,
        zone: 'related',
        ...(skuId ? { skuId } : {})
      },
      failToast: '无法打开藏品'
    });
  },

  goToRelatedArticle(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/subpackages/feature/articles/detail/index?id=${id}`,
      fail: () => wx.showToast({ title: '无法打开笔记', icon: 'none' })
    });
  },

  handleBuyNow() {
    const p = this.data.primaryProduct;
    if (!p || !p._id) {
      wx.showToast({ title: '暂无可购藏品', icon: 'none' });
      return;
    }
    const skuId = p.relatedSkuId || '';
    const hasSku = !!(p.hasSku || (p.skus && p.skus.length));
    if (hasSku) {
      navigateToProductDetail(p._id, {
        seed: p,
        query: {
          from: 'wiki',
          wikiId: this.data.wikiId,
          zone: 'related',
          ...(skuId ? { skuId } : {})
        },
        failToast: '无法打开藏品'
      });
      return;
    }
    navigateToConfirmOrder([{
      productId: p._id,
      skuId: '',
      skuLabel: '',
      count: 1,
      title: p.title,
      image: getFirstImage(p.images),
      price: p.price,
      latinName: p.latinName,
      memberDiscountEnabled: p.memberDiscountEnabled !== false
    }], { source: 'wiki' });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/category/index' }) });
  },

  previewImage(e) {
    const current = e.currentTarget.dataset.src;
    const urls = this.data.wiki.gallery || [];
    if (urls.length) wx.previewImage({ urls, current });
  }
});
