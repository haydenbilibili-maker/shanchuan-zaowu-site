// pages/category/index.js
const app = getApp();
const db = wx.cloud.database();
const { trackBehavior } = require('../../utils/trackBehavior');
const {
  fetchCategoriesByLevel,
  filterCanonicalRoots,
  CANONICAL_ROOT_NAMES,
  resolveCanonicalRootName
} = require('../../utils/categoryTree');

Page({
  data: {
    statusBarHeight: 20,
    categories: [],
    currentId: 'all',
    currentName: '全部',
    currentSubtitle: '加载中...',
    currentIndex: 0,
    contentItems: [],
    orphanProducts: [],
    contentTotal: 0,
    orphanTotal: 0,
    listLoading: true,
    loadingMore: false,
    contentSkip: 0,
    productSkip: 0,
    hasMoreContent: true,
    hasMoreProducts: true,
    scrollTop: 0,
    keyword: '',
    headerHeight: 220,
    parentCategory: '',
    showContentSection: true,
    fallbackImg: 'https://picsum.photos/seed/specimen/600/600'
  },

  _contentLimit: 3,
  _productLimit: 12,

  onLoad() {
    try {
      const sys = wx.getWindowInfo();
      const statusBarHeight = sys.statusBarHeight || 20;
      this.setData({
        statusBarHeight,
        headerHeight: this.estimateHeaderHeight(statusBarHeight)
      });
    } catch (e) {
      this.setData({ statusBarHeight: 44, headerHeight: this.estimateHeaderHeight(44) });
    }
    this.loadCategories();
  },

  estimateHeaderHeight(statusBarHeight) {
    // nav + 搜索 + 品类条（px 粗算，measureHeader 会再精确校准）
    return statusBarHeight + 152;
  },

  onReady() {
    this.measureHeader();
  },

  measureHeader() {
    wx.nextTick(() => {
      wx.createSelectorQuery()
        .in(this)
        .select('.sticky-header')
        .boundingClientRect((rect) => {
          if (rect && rect.height) {
            this.setData({ headerHeight: Math.ceil(rect.height) + 4 });
          }
        })
        .exec();
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    if (app.globalData.targetCategory) {
      const t = app.globalData.targetCategory;
      app.globalData.targetCategory = null;
      if (this.data.categories.length) {
        this.autoSwitchToName(t);
      } else {
        this._pendingTargetCategory = t;
      }
    }
  },

  enrichCategoryData(list) {
    return list.map((item) => {
      const name = item.name || '';
      const shortName = name === '全部' ? '全部' : name.replace(/馆$/, '');
      let sub = (item.enName || '').trim();
      if (name === '全部') sub = '全部品类';
      else if (!sub) {
        if (name.includes('昆虫') || name.includes('动物')) sub = 'Kingdom Animalia';
        else if (name.includes('植物')) sub = 'Kingdom Plantae';
        else if (name.includes('海')) sub = 'Marine Life';
        else if (name.includes('矿')) sub = 'Minerals & Gems';
        else if (name.includes('衍生')) sub = 'Merchandise';
        else sub = '探索自然标本';
      }

      return {
        ...item,
        shortName,
        subtitle: sub
      };
    });
  },

  async loadCategories() {
    try {
      let rawList = [];
      try {
        const roots = await fetchCategoriesByLevel(db, 1);
        rawList = filterCanonicalRoots(roots);
      } catch (e) {
        console.error('loadCategories', e);
      }

      if (rawList.length === 0) {
        rawList = CANONICAL_ROOT_NAMES.map((name, i) => ({
          _id: `fallback_${i}`,
          name
        }));
      }

      rawList = rawList.filter((c) => c.name && c.name !== '全部');
      const allItem = { _id: 'all', name: '全部', enName: 'ALL' };
      const richList = this.enrichCategoryData([allItem, ...rawList]);

      this.setData({
        categories: richList,
        currentId: richList[0]._id,
        currentName: richList[0].name,
        currentSubtitle: richList[0].subtitle,
        currentIndex: 0,
        parentCategory: this.computeShopCategory(richList[0].name)
      });

      if (this._pendingTargetCategory) {
        const pending = this._pendingTargetCategory;
        this._pendingTargetCategory = null;
        this.autoSwitchToName(pending);
        return;
      }

      this.loadFeed(true);
    } catch (err) {
      this.setData({ listLoading: false });
    }
  },

  async loadFeed(reset = false) {
    if (reset) {
      this.setData({
        listLoading: true,
        contentItems: [],
        orphanProducts: [],
        contentSkip: 0,
        productSkip: 0,
        hasMoreContent: true,
        hasMoreProducts: true
      });
    } else if (this.data.loadingMore) {
      return;
    }

    this.setData({ loadingMore: !reset });

    try {
      const params = this.getFeedParams();
      const contentSkip = reset ? 0 : this.data.contentSkip;
      const productSkip = reset ? 0 : this.data.productSkip;
      let contentLimit = 0;
      let productLimit = 0;

      if (reset) {
        contentLimit = this._contentLimit;
        productLimit = this._productLimit;
      } else if (this.data.hasMoreProducts) {
        productLimit = this._productLimit;
      } else {
        this.setData({ loadingMore: false });
        return;
      }

      const res = await wx.cloud.callFunction({
        name: 'getEncyclopediaFeed',
        data: {
          ...params,
          contentSkip,
          contentLimit,
          productSkip,
          productLimit
        }
      });

      const result = res.result || {};
      if (!result.success) throw new Error(result.msg || '加载失败');

      const newContent = result.contentItems || [];
      const newProducts = result.orphanProducts || [];

      let sub = this.data.categories[this.data.currentIndex]?.subtitle || '';
      if (this.data.currentName === '全部') {
        sub = `档案 ${result.contentTotal || 0} · 可购 ${result.orphanTotal || 0}`;
      }

      this.setData({
        contentItems: reset ? newContent : this.data.contentItems.concat(newContent),
        orphanProducts: reset ? newProducts : this.data.orphanProducts.concat(newProducts),
        contentTotal: result.contentTotal || 0,
        orphanTotal: result.orphanTotal || 0,
        contentSkip: contentSkip + newContent.length,
        productSkip: productSkip + newProducts.length,
        hasMoreContent: !!result.hasMoreContent,
        hasMoreProducts: !!result.hasMoreProducts,
        showContentSection: (result.contentTotal || 0) > 0,
        currentSubtitle: sub,
        listLoading: false,
        loadingMore: false
      });
      this.measureHeader();
    } catch (err) {
      console.error('loadFeed', err);
      this.setData({ listLoading: false, loadingMore: false });
    }
  },

  getFeedParams() {
    const { currentId, currentName, parentCategory, keyword } = this.data;
    const hasRealId = currentId && currentId !== 'all' && !String(currentId).startsWith('fallback_');
    return {
      categoryId: hasRealId ? currentId : null,
      parentCategory: parentCategory || this.computeShopCategory(currentName),
      subCategoryName: '',
      keyword: keyword || ''
    };
  },

  onFeedScrollToLower() {
    if (this.data.listLoading || this.data.loadingMore) return;
    if (this.data.hasMoreProducts) {
      this.loadMoreProducts();
    }
  },

  onArchiveSwiperChange(e) {
    const idx = e.detail.current;
    if (idx >= this.data.contentItems.length - 2 && this.data.hasMoreContent && !this.data.loadingMore) {
      this.loadMoreContent();
    }
  },

  async loadMoreContent() {
    if (!this.data.hasMoreContent || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    try {
      const params = this.getFeedParams();
      const res = await wx.cloud.callFunction({
        name: 'getEncyclopediaFeed',
        data: {
          ...params,
          contentSkip: this.data.contentSkip,
          contentLimit: this._contentLimit,
          productSkip: 0,
          productLimit: 0
        }
      });
      const result = res.result || {};
      if (!result.success) throw new Error(result.msg || '加载失败');
      const newContent = result.contentItems || [];
      this.setData({
        contentItems: this.data.contentItems.concat(newContent),
        contentSkip: this.data.contentSkip + newContent.length,
        hasMoreContent: !!result.hasMoreContent,
        loadingMore: false
      });
    } catch (err) {
      console.error('loadMoreContent', err);
      this.setData({ loadingMore: false });
    }
  },

  async loadMoreProducts() {
    if (!this.data.hasMoreProducts || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    try {
      const params = this.getFeedParams();
      const res = await wx.cloud.callFunction({
        name: 'getEncyclopediaFeed',
        data: {
          ...params,
          contentSkip: 0,
          contentLimit: 0,
          productSkip: this.data.productSkip,
          productLimit: this._productLimit
        }
      });
      const result = res.result || {};
      if (!result.success) throw new Error(result.msg || '加载失败');
      const newProducts = result.orphanProducts || [];
      this.setData({
        orphanProducts: this.data.orphanProducts.concat(newProducts),
        productSkip: this.data.productSkip + newProducts.length,
        hasMoreProducts: !!result.hasMoreProducts,
        loadingMore: false
      });
    } catch (err) {
      console.error('loadMoreProducts', err);
      this.setData({ loadingMore: false });
    }
  },

  computeShopCategory(name) {
    if (!name || name === '全部') return '';
    return String(name).replace(/馆$/, '');
  },

  switchCategory(e) {
    const { item } = e.currentTarget.dataset;
    if (!item || item._id === this.data.currentId) return;

    wx.vibrateShort({ type: 'light' });
    const idx = this.data.categories.findIndex((c) => c._id === item._id);

    this.setData({
      currentId: item._id,
      currentName: item.name,
      currentSubtitle: item.subtitle,
      currentIndex: idx,
      scrollTop: 0,
      parentCategory: this.computeShopCategory(item.name)
    });

    this.loadFeed(true);
    this.measureHeader();
  },

  autoSwitchToName(name) {
    if (!name) return;
    const canonical = resolveCanonicalRootName(name);
    const short = String(name).replace(/馆$/, '');
    const canonicalShort = canonical.replace(/馆$/, '');
    const item = this.data.categories.find(
      (c) =>
        c.name === name ||
        c.shortName === name ||
        c.name === canonical ||
        c.shortName === short ||
        c.shortName === canonicalShort
    );
    if (item) {
      this.switchCategory({ currentTarget: { dataset: { item } } });
    }
  },

  goSearch() {
    const { parentCategory, currentId, currentName } = this.data;
    let url = '/pages/search/index';
    if (currentId && currentId !== 'all' && parentCategory) {
      const q = [
        `category=${encodeURIComponent(parentCategory)}`,
        `categoryId=${encodeURIComponent(currentId)}`,
        `categoryName=${encodeURIComponent(currentName)}`
      ].join('&');
      url += `?${q}`;
    }
    wx.navigateTo({ url });
  },

  goIdentify() {
    trackBehavior('identify_entry_click', 'identification', 'gallery_search', { source: 'gallery_search' });
    wx.navigateTo({ url: '/pages/identify/index?from=gallery_search' });
  },

  goCustom() {
    wx.navigateTo({ url: '/pages/custom/hub/index?from=category' });
  },

  goToWikiDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '档案加载中', icon: 'none' });
      return;
    }
    const item = this.data.contentItems.find((c) => c._id === id);
    trackBehavior('encyclopedia_content_click', 'wiki', id, {
      categoryId: this.data.currentId,
      hasRelatedProduct: !!(item && item.productId)
    });
    wx.navigateTo({
      url: `/pages/detail/wiki-detail/index?id=${id}`,
      fail: () => wx.showToast({ title: '无法打开档案', icon: 'none' })
    });
  },

  goToProductFromFeed(e) {
    const id = e.currentTarget.dataset.id;
    const wikiId = e.currentTarget.dataset.wikiId || '';
    if (!id) return;
    const zone = wikiId ? 'related' : 'orphan';
    trackBehavior('encyclopedia_product_click', 'product', id, {
      zone,
      wikiId: wikiId || undefined,
      categoryId: this.data.currentId
    });
    const qs = wikiId ? `&from=wiki&wikiId=${wikiId}&zone=${zone}` : `&zone=${zone}`;
    wx.navigateTo({ url: `/pages/detail/index?id=${id}${qs}` });
  }
});
