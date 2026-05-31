const app = getApp();
const { getFirstImage } = require('../../../utils/util');
const { navigateToConfirmOrder } = require('../../../utils/checkout');
const { trackBehavior } = require('../../../utils/trackBehavior');

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
    wiki: {},
    articleContent: '',
    relatedProducts: [],
    alternativeProducts: [],
    displayProducts: [],
    usingAlternative: false,
    primaryProduct: null,
    fallbackImg: 'https://picsum.photos/seed/wiki/600/600',
    tagStyle: {
      p: 'margin-bottom: 20px; line-height: 1.8; color: #ccc; text-align: justify;',
      h2: 'font-size: 18px; font-weight: bold; color: #C4A76C; margin: 30px 0 15px; border-bottom: 1px solid #333; padding-bottom: 8px;',
      img: 'border-radius: 8px; margin: 20px 0; width: 100% !important; height: auto !important;',
      blockquote: 'background: rgba(255,255,255,0.05); border-left: 6px solid #C4A76C; padding: 16px; margin: 20px 0; color: #999; font-style: italic;',
      strong: 'color: #fff; font-weight: bold;'
    }
  },

  onLoad(options) {
    const { statusBarHeight } = wx.getSystemInfoSync();
    this.setData({ statusBarHeight, wikiId: options.id || '' });
    if (options.id) this.loadDetail(options.id);
  },

  async loadDetail(id) {
    wx.showLoading({ title: '读取中...' });
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
      const displayProducts = usingAlternative ? alternativeProducts : relatedProducts;

      let primaryProduct = null;
      const candidates = displayProducts.filter((p) => getProductStock(p) > 0);
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
        primaryProduct
      });

      trackBehavior('encyclopedia_content_click', 'wiki', id, {
        hasRelatedProduct: relatedProducts.length > 0,
        view: 'detail'
      });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goToProduct(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    trackBehavior('wiki_to_product', 'product', id, {
      wikiId: this.data.wikiId,
      zone: 'related',
      source: 'wiki_detail'
    });
    wx.navigateTo({
      url: `/pages/detail/index?id=${id}&from=wiki&wikiId=${this.data.wikiId}&zone=related`
    });
  },

  handleBuyNow() {
    const p = this.data.primaryProduct;
    if (!p) {
      wx.showToast({ title: '暂无可购藏品', icon: 'none' });
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
      latinName: p.latinName
    }], { source: 'wiki' });
  },

  goBack() { wx.navigateBack(); },

  previewImage(e) {
    const current = e.currentTarget.dataset.src;
    const urls = this.data.wiki.gallery || [];
    if (urls.length) wx.previewImage({ urls, current });
  }
});
