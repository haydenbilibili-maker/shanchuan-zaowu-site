const app = getApp();
const db = wx.cloud.database();
const _ = db.command;
const { getFirstImage } = require('../../../utils/util');

Page({
  data: {
    statusBarHeight: 20,
    wiki: {},
    relatedProducts: [],
    fallbackImg: 'https://via.placeholder.com/500x500/111/333?text=Wiki',
    tagStyle: {
      p: 'margin-bottom: 20px; line-height: 1.8; color: #ccc; text-align: justify;',
      h2: 'font-size: 18px; font-weight: bold; color: #C4A76C; margin: 30px 0 15px; border-bottom: 1px solid #333; padding-bottom: 8px;',
      img: 'border-radius: 8px; margin: 20px 0; width: 100% !important; height: auto !important;',
      blockquote: 'background: rgba(255,255,255,0.05); border-left: 6px solid #C4A76C; padding: 16px; margin: 20px 0; color: #999; font-family: "Times New Roman"; font-style: italic;',
      strong: 'color: #fff; font-weight: bold;'
    }
  },

  onLoad(options) {
    const { statusBarHeight } = wx.getSystemInfoSync();
    this.setData({ statusBarHeight });

    if (options.id) {
      this.loadDetail(options.id);
    }
  },

  async loadDetail(id) {
    wx.showLoading({ title: '读取中...' });
    
    try {
      // 1. 获取 Wiki 详情 (这里模拟从 wikis 集合取，如果没有则从 products 兼容)
      // 实际应调用云函数 getWikiData action='get_detail'
      // 这里为了演示直接查库
      const res = await db.collection('products').doc(id).get(); // 暂用 products 模拟 wiki
      const data = res.data;
      
      const wikiData = {
        coverImage: getFirstImage(data.images),
        latinName: data.latinName || 'N/A',
        commonName: data.title || 'Unknown',
        description: data.description || data.brief,
        gallery: data.images || [],
        taxonomy: { kingdom: 'Animalia', class: 'Insecta' }, // 模拟数据
        tags: [data.category] // 用于关联推荐
      };

      // 2. 获取关联商品 (根据 tags 推荐同类)
      const pRes = await db.collection('products')
        .where({ 
          category: data.category,
          _id: _.neq(id) // 排除自己
        })
        .limit(2)
        .get();

      this.setData({
        wiki: wikiData,
        relatedProducts: pRes.data
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
    // 跳转回原来的商品详情页，进行购买
    wx.navigateTo({ url: `/pages/detail/index?id=${id}` });
  },

  goBack() { wx.navigateBack(); },

  previewImage(e) {
    const current = e.currentTarget.dataset.curr;
    wx.previewImage({ urls: this.data.wiki.gallery, current });
  }
});