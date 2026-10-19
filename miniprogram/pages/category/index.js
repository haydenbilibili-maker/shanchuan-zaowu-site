// pages/category/index.js
const app = getApp();
const db = wx.cloud.database();
const { trackBehavior } = require('../../utils/trackBehavior');
const {
  filterCanonicalRoots,
  CANONICAL_ROOT_NAMES,
  resolveCanonicalRootName,
  toRootDisplayName,
  formatCategoryDisplayName
} = require('../../utils/categoryTree');
const { cdnPath } = require('../../config/cloudEnv');
const { navigateToProductDetail } = require('../../utils/productDetailNav');
const {
  CHANNEL_LABELS,
  CRAFT_TYPE_LABELS,
  CRAFT_PROCESS_LABELS,
  channelLabel,
  craftTypeLabel,
  craftProcessLabel,
  buildCraftDisplayTags,
  isChannelEligibleRoot,
  isCraftEligibleRoot
} = require('../../config/productTaxonomy');
const easterEgg = require('../../utils/easterEgg');
const feedCache = require('../../utils/categoryFeedCache');
const { thumbUrl } = require('../../utils/imageUrl');

const EMPTY_FILTERS = {
  categoryValue: '',
  categoryId: '',
  channel: '',
  craftType: '',
  craftProcess: '',
  pricePresetId: '',
  priceMin: null,
  priceMax: null
};

/** 切馆后清掉当前馆不适用的渠道/装裱/工艺，避免「矿石馆仍带进口筛选」等幽灵条件 */
function sanitizeFiltersForRoot(filters, rootName) {
  const f = { ...(filters || EMPTY_FILTERS) };
  const root = rootName || '';
  const showChannel = !root || root === '全部' || isChannelEligibleRoot(root);
  const showCraft = !root || root === '全部' || isCraftEligibleRoot(root);
  if (!showChannel) f.channel = '';
  if (!showCraft) {
    f.craftType = '';
    f.craftProcess = '';
  }
  return f;
}

function itemIdKey(item) {
  if (!item || item._id == null || item._id === '') return '';
  return String(item._id);
}

/** 按 _id 去重；append 时跳过已有 id，避免 loadMore 竞态双卡 */
function mergeUniqueById(existing, incoming) {
  const seen = new Set();
  const out = [];
  ;(existing || []).forEach((item) => {
    const key = itemIdKey(item);
    if (key) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    out.push(item);
  });
  ;(incoming || []).forEach((item) => {
    const key = itemIdKey(item);
    if (key) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    out.push(item);
  });
  return out;
}

/** 馆藏可购卡：售罄 = 明确库存且 ≤0（与 ProductCard / feed getProductStock 对齐） */
function decorateOrphanProducts(list) {
  return (list || []).map((item) => {
    if (!item) return item;
    const stockNum = item.stock == null || item.stock === ''
      ? null
      : Number(item.stock);
    const soldOut = item.soldOut === true
      || (stockNum != null && !Number.isNaN(stockNum) && stockNum <= 0);
    return {
      ...item,
      displayImage: item.displayImage ? thumbUrl(item.displayImage) : '',
      soldOut,
      craftTags: buildCraftDisplayTags(item)
    };
  });
}

Page({
  data: {
    statusBarHeight: 20,
    categories: [],
    currentId: 'all',
    currentName: '全部',
    currentSubtitle: '加载中…',
    currentIndex: 0,
    contentItems: [],
    orphanProducts: [],
    contentTotal: 0,
    orphanTotal: 0,
    listLoading: true,
    /** 分类树/首屏馆藏加载失败时的整页错误态（可重试），区别于「该品类档案筹备中」 */
    pageError: false,
    pageErrorMsg: '',
    loadingMore: false,
    contentSkip: 0,
    productSkip: 0,
    hasMoreContent: true,
    hasMoreProducts: true,
    scrollTop: 0,
    keyword: '',
    headerHeight: 220,
    /** 品类横滑：切换后把选中项滑入视野（hall-<index>） */
    hallIntoView: '',
    /** 标本档案横滑当前序号（替代压在卡片底边上的指示圆点） */
    archiveIndex: 0,
    parentCategory: '',
    showContentSection: true,
    /** 内容运营开关：馆藏「标本档案」；缺配置默认关闭 */
    showSpecimenArchive: false,
    /** 标本定制入口；缺配置默认关闭 */
    showSpecimenCustom: false,
    /** AI 鉴定入口；缺配置默认开启 */
    showAiIdentify: true,
    fallbackImg: cdnPath('stores/store_shanhaizaowu.png'),
    filterPanelVisible: false,
    filterRootName: '全部',
    filterCategoryOptions: [],
    appliedFilters: { ...EMPTY_FILTERS },
    filterActiveCount: 0,
    filterSummary: '',
    scrollIntoView: '',
    /** 当前一级馆下的二级分类（纲/目等） */
    subCategories: [],
    currentSubId: '',
    subRowLabel: ''
  },

  _contentLimit: 3,
  _categoriesBootstrapped: false,
  _productLimit: 12,
  _categorySubMap: {},
  _categoryRoots: [],
  /** 同步副本，避免 setData 异步导致 loadFeed 读到旧筛选 */
  _appliedFilters: { ...EMPTY_FILTERS },
  /** 同步锁 + 世代号：防 loadMore 竞态 / reset 后旧请求写回 */
  _feedLoading: false,
  _feedGen: 0,

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
    // 开关有缓存时（同步水合）不等网络：分类树与首屏馆藏并行发出；
    // 首屏先用本地缓存秒开（SWR），后台刷新回来后无感替换，价格/库存以服务端为准
    const flagsReady = this.loadDisplayFlags();
    if (!this._flagsHydrated) {
      flagsReady.finally(() => this.loadCategories());
      return;
    }
    this.hydrateFromCache();
    if (!app.globalData.targetCategory) this.loadFeed(true, { silent: true });
    this.loadCategories();
  },

  /** 同步读首屏缓存：分类树 + 「全部」第一页；带目标馆跳转时不水合馆藏（马上要切馆） */
  hydrateFromCache() {
    const tree = feedCache.readTree();
    if (tree) {
      this.applyCategoryTreeToPage(tree.data, { preserveSelection: false });
      this._treeHydrated = true;
    }
    if (app.globalData.targetCategory) return;
    const archiveOn = this.data.showSpecimenArchive === true;
    const feed = feedCache.readFeed(archiveOn);
    if (feed) {
      this.applyFeedResult(feed.data, { reset: true, archiveOn, contentSkip: 0, productSkip: 0 });
    }
  },

  async loadDisplayFlags() {
    try {
      const { fetchContentDisplayFlags, getCachedContentDisplayFlags } = require('../../utils/contentDisplayFlags');
      const cached = getCachedContentDisplayFlags();
      if (cached && cached.flags) {
        this._flagsHydrated = true;
        this.setData({
          showSpecimenArchive: cached.flags.showSpecimenArchive === true,
          showSpecimenCustom: cached.flags.showSpecimenCustom === true,
          showAiIdentify: cached.flags.showAiIdentify !== false
        });
      }
      const { flags } = await fetchContentDisplayFlags({
        onUpdate: (payload) => {
          const f = (payload && payload.flags) || {};
          this.setData({
            showSpecimenArchive: f.showSpecimenArchive === true,
            showSpecimenCustom: f.showSpecimenCustom === true,
            showAiIdentify: f.showAiIdentify !== false
          });
        }
      });
      this.setData({
        showSpecimenArchive: flags.showSpecimenArchive === true,
        showSpecimenCustom: flags.showSpecimenCustom === true,
        showAiIdentify: flags.showAiIdentify !== false
      });
    } catch (e) {
      console.warn('loadDisplayFlags', e);
      this.setData({ showSpecimenArchive: false, showSpecimenCustom: false, showAiIdentify: true });
    }
  },

  estimateHeaderHeight(statusBarHeight) {
    // nav + 搜索 + 多行品类 + 筛选入口（px 粗算，measureHeader 会再精确校准）
    return statusBarHeight + 196;
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
      this.getTabBar().setData({ selected: 1, hidden: !!this.data.filterPanelVisible });
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
    if (this._categoriesBootstrapped) {
      const tree = feedCache.readTree();
      if (!tree || !tree.fresh) this.reloadCategoryTree({ preserveSelection: true, reloadFeed: false });
    }
  },

  /** 云函数优先、失败走客户端分页直读（categoryFeedCache.fetchTree），成功即落首屏缓存 */
  fetchCategoryTree() {
    return feedCache.fetchTree(db);
  },

  buildSubCategoryList(rootId) {
    if (!rootId || rootId === 'all') return [];
    return (this._categorySubMap[rootId] || []).map((s) => ({
      ...s,
      displayName: formatCategoryDisplayName(s)
    }));
  },

  resolveSubRowLabel(rootName) {
    const canonical = resolveCanonicalRootName(rootName) || rootName || '';
    if (canonical === '矿石馆') return '藏品类型';
    if (canonical === '衍生品' || canonical === '首饰馆') return '品类';
    return '纲 · 目';
  },

  syncSubCategoryRow(rootId, preferredSubId, rootName) {
    const subCategories = this.buildSubCategoryList(rootId);
    let currentSubId = preferredSubId || '';
    if (currentSubId && !subCategories.some((s) => s._id === currentSubId)) {
      currentSubId = '';
    }
    const nameForLabel = rootName || this.data.currentName || '';
    const subRowLabel = rootId && rootId !== 'all' ? this.resolveSubRowLabel(nameForLabel) : '';
    this.setData({ subCategories, currentSubId, subRowLabel });
    return { subCategories, currentSubId, subRowLabel };
  },

  applyCategoryTreeToPage(tree, options = {}) {
    const preserve = options.preserveSelection !== false;
    const prevRootId = preserve ? this.data.currentId : 'all';
    const prevSubId = preserve ? this.data.currentSubId : '';

    this._categorySubMap = tree.categorySubMap || {};
    this._categoryRoots = tree.categoryRoots || [];

    const rootsFromTree = tree.categoryRoots || [];
    let rawList =
      rootsFromTree.length > 0
        ? rootsFromTree.slice().sort((a, b) => {
          const sa = a.sort != null ? a.sort : (a.sortOrder != null ? a.sortOrder : 999);
          const sb = b.sort != null ? b.sort : (b.sortOrder != null ? b.sortOrder : 999);
          return sa - sb;
        })
        : filterCanonicalRoots(rootsFromTree);
    if (rawList.length === 0) {
      rawList = CANONICAL_ROOT_NAMES.map((name, i) => ({
        _id: `fallback_${i}`,
        name
      }));
    }
    rawList = rawList.filter((c) => c.name && c.name !== '全部');
    const allItem = { _id: 'all', name: '全部', enName: 'ALL' };
    const richList = this.enrichCategoryData([allItem, ...rawList]);

    let currentId = richList[0]._id;
    let currentIndex = 0;
    if (preserve && prevRootId) {
      const hit = richList.findIndex((c) => c._id === prevRootId);
      if (hit >= 0) {
        currentIndex = hit;
        currentId = richList[hit]._id;
      }
    }
    const currentItem = richList[currentIndex] || richList[0];
    const { currentSubId } = this.syncSubCategoryRow(
      currentId,
      preserve ? prevSubId : '',
      currentItem.name
    );

    this.setData({
      categories: richList,
      currentId: currentItem._id,
      currentName: currentItem.name,
      currentSubtitle: currentItem.subtitle,
      currentIndex,
      parentCategory: currentItem.name === '全部'
        ? ''
        : (resolveCanonicalRootName(currentItem.name) || currentItem.name),
      filterRootName: currentItem.shortName || currentItem.name,
      currentSubId
    }, () => this.measureHeader());

    this.refreshFilterCategoryOptions(currentItem);
    return currentItem;
  },

  async reloadCategoryTree(options = {}) {
    try {
      const tree = await this.fetchCategoryTree();
      this.applyCategoryTreeToPage(tree, options);
      if (options.reloadFeed) {
        await this.loadFeed(true);
      }
    } catch (e) {
      console.warn('reloadCategoryTree', e);
    }
  },

  enrichCategoryData(list) {
    return list.map((item) => {
      const name = item.name || '';
      const shortName = name === '全部' ? '全部' : toRootDisplayName(name);
      let sub = (item.enName || '').trim();
      if (name === '全部') sub = '全部品类';
      else if (!sub) {
        if (name.includes('昆虫') || name.includes('动物')) sub = 'Kingdom Animalia';
        else if (name.includes('植物')) sub = 'Kingdom Plantae';
        else if (name.includes('海')) sub = 'Marine Life';
        else if (name.includes('矿')) sub = 'Minerals & Gems';
        else if (name.includes('衍生')) sub = 'Merchandise';
        else if (name.includes('首饰') || name.includes('饰品')) sub = 'Jewelry';
        else sub = '探索自然藏品';
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
      const tree = await this.fetchCategoryTree();
      // 已用缓存树水合过：用户可能已点了别的馆，保留当前选择
      this.applyCategoryTreeToPage(tree, { preserveSelection: this._treeHydrated === true });
      this._categoriesBootstrapped = true;

      if (this._pendingTargetCategory) {
        const pending = this._pendingTargetCategory;
        this._pendingTargetCategory = null;
        this.autoSwitchToName(pending);
        return;
      }

      // 首屏请求已与分类树并行发出（或用户已切馆）时不再重复拉
      if (!this._feedStarted) this.loadFeed(true);
    } catch (err) {
      console.error('loadCategories', err);
      if (this._treeHydrated) {
        this._categoriesBootstrapped = true;
        if (!this._feedStarted) this.loadFeed(true);
        return;
      }
      // 分类树都拿不到 → 页面无可操作内容，给出可重试的错误态而非静默空白
      this.setData({
        listLoading: false,
        pageError: true,
        pageErrorMsg: '分类信息加载失败，请检查网络后重试',
      });
    }
  },

  refreshFilterCategoryOptions(rootItem) {
    const item = rootItem || this.data.categories[this.data.currentIndex];
    let options = [];
    if (!item || item._id === 'all') {
      options = (this._categoryRoots || [])
        .filter((r) => r.name && r.name !== '全部')
        .map((r) => ({
          value: r.name,
          label: toRootDisplayName(r.name),
          categoryId: r._id
        }));
    } else {
      const subs = this._categorySubMap[item._id] || [];
      options = subs.map((s) => ({
        value: s.name,
        label: formatCategoryDisplayName(s),
        categoryId: s._id
      }));
    }
    this.setData({
      filterCategoryOptions: options,
      filterRootName: item ? (item.shortName || item.name) : '全部'
    });
  },

  countActiveFilters(f) {
    if (!f) return 0;
    let n = 0;
    if (f.categoryValue) n += 1;
    if (f.channel) n += 1;
    if (f.craftType) n += 1;
    if (f.craftProcess) n += 1;
    if (f.priceMin != null || f.priceMax != null || f.pricePresetId) n += 1;
    return n;
  },

  buildFilterSummary(f) {
    if (!f) return '';
    const parts = [];
    if (f.categoryValue) {
      const raw = String(f.categoryValue).trim();
      const canonical = resolveCanonicalRootName(raw);
      const isRoot = CANONICAL_ROOT_NAMES.includes(canonical);
      parts.push(isRoot ? toRootDisplayName(raw) : formatCategoryDisplayName(raw));
    }
    if (f.channel) parts.push(channelLabel(f.channel) || CHANNEL_LABELS[f.channel] || f.channel);
    if (f.craftType) parts.push(craftTypeLabel(f.craftType) || CRAFT_TYPE_LABELS[f.craftType] || f.craftType);
    if (f.craftProcess) parts.push(craftProcessLabel(f.craftProcess) || CRAFT_PROCESS_LABELS[f.craftProcess] || f.craftProcess);
    if (f.priceMin != null || f.priceMax != null) {
      const min = f.priceMin != null ? f.priceMin : '';
      const max = f.priceMax != null ? f.priceMax : '';
      if (min !== '' && max !== '') parts.push(`¥${min}-${max}`);
      else if (min !== '') parts.push(`¥${min}起`);
      else if (max !== '') parts.push(`¥${max}内`);
    }
    return parts.length ? parts.join(' · ') : '';
  },

  setTabBarHidden(hidden) {
    try {
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        this.getTabBar().setData({ hidden: !!hidden });
      }
    } catch (e) { /* ignore */ }
  },

  /** 「全部」下在筛选里选一级馆时，同步顶部分类 pill，避免馆与品类条件重复 */
  resolveRootTabForCategoryValue(categoryValue) {
    const cv = String(categoryValue || '').trim();
    if (!cv) return null;

    const canonCv = resolveCanonicalRootName(cv) || cv;
    const fromTabs = (this.data.categories || []).find((c) => {
      if (!c || c._id === 'all') return false;
      const n = c.name || '';
      const canonN = resolveCanonicalRootName(n) || n;
      return (
        n === cv ||
        c.shortName === cv ||
        canonN === canonCv ||
        toRootDisplayName(n) === cv
      );
    });
    if (fromTabs) return fromTabs;

    const fromTree = (this._categoryRoots || []).find((r) => {
      const n = r.name || '';
      const canonN = resolveCanonicalRootName(n) || n;
      return (
        n === cv ||
        toRootDisplayName(n) === cv ||
        canonN === canonCv
      );
    });
    if (!fromTree) return null;
    return (this.data.categories || []).find((c) => c._id === fromTree._id) || {
      _id: fromTree._id,
      name: fromTree.name,
      shortName: toRootDisplayName(fromTree.name),
      subtitle: ''
    };
  },

  applyRootTabFromFilter(rootItem, applied) {
    if (!rootItem || rootItem._id === this.data.currentId) {
      return { applied, tabSwitched: false };
    }
    const idx = this.data.categories.findIndex((c) => c._id === rootItem._id);
    if (idx < 0) return { applied, tabSwitched: false };

    const rootLabel = rootItem.shortName || rootItem.name || '';
    const nextApplied = sanitizeFiltersForRoot(
      { ...applied, categoryValue: '', categoryId: '' },
      rootLabel
    );
    this._appliedFilters = nextApplied;
    this.setData({
      currentId: rootItem._id,
      currentName: rootItem.name,
      currentSubtitle: rootItem.subtitle || this.data.currentSubtitle,
      currentIndex: idx,
      parentCategory: resolveCanonicalRootName(rootItem.name) || rootItem.name,
      appliedFilters: nextApplied,
      filterActiveCount: this.countActiveFilters(nextApplied),
      filterSummary: this.buildFilterSummary(nextApplied),
      filterRootName: rootLabel
    });
    this.refreshFilterCategoryOptions(rootItem);
    return { applied: nextApplied, tabSwitched: true };
  },

  openFilterPanel() {
    this.refreshFilterCategoryOptions();
    this.setTabBarHidden(true);
    this.setData({ filterPanelVisible: true });
  },

  closeFilterPanel() {
    this.setTabBarHidden(false);
    this.setData({ filterPanelVisible: false });
  },

  // 筛选无结果时的出口：等同于在面板里「重置 → 确定」
  onClearFilters() {
    this.onFilterConfirm({ detail: {} });
  },

  onFilterConfirm(e) {
    const detail = (e && e.detail) || {};
    let applied = {
      categoryValue: detail.categoryValue || '',
      categoryId: detail.categoryId || '',
      channel: detail.channel || '',
      craftType: detail.craftType || '',
      craftProcess: detail.craftProcess || '',
      pricePresetId: detail.pricePresetId || '',
      priceMin: detail.priceMin != null && detail.priceMin !== '' ? Number(detail.priceMin) : null,
      priceMax: detail.priceMax != null && detail.priceMax !== '' ? Number(detail.priceMax) : null
    };
    if (applied.priceMin != null && Number.isNaN(applied.priceMin)) applied.priceMin = null;
    if (applied.priceMax != null && Number.isNaN(applied.priceMax)) applied.priceMax = null;

    let tabSwitched = false;
    if (this.data.currentId === 'all' && applied.categoryValue) {
      const rootItem = this.resolveRootTabForCategoryValue(applied.categoryValue);
      if (rootItem) {
        const synced = this.applyRootTabFromFilter(rootItem, applied);
        applied = synced.applied;
        tabSwitched = synced.tabSwitched;
      }
    }

    // 同步写入，保证紧随其后的 loadFeed 立刻读到新条件
    this._appliedFilters = applied;
    const count = this.countActiveFilters(applied);
    const summary = this.buildFilterSummary(applied);

    let currentSubId = this.data.currentSubId || '';
    if (this.data.currentId && this.data.currentId !== 'all') {
      if (applied.categoryId) {
        currentSubId = applied.categoryId;
      } else if (!applied.categoryValue) {
        currentSubId = '';
      }
    } else {
      currentSubId = '';
    }

    this.setTabBarHidden(false);
    this.setData(
      {
        filterPanelVisible: false,
        appliedFilters: applied,
        filterActiveCount: count,
        filterSummary: summary,
        scrollTop: 0,
        scrollIntoView: '',
        currentSubId
      },
      () => {
        if (tabSwitched) this.measureHeader();
      }
    );

    this.loadFeed(true).then(() => {
      if (count > 0) {
        wx.showToast({ title: '已按条件筛选', icon: 'none', duration: 1600 });
        // 滚到「本类可购」
        this.setData({ scrollIntoView: 'productBlock' });
        setTimeout(() => this.setData({ scrollIntoView: '' }), 600);
      } else {
        wx.showToast({ title: '已清空筛选', icon: 'none', duration: 1200 });
      }
    });
  },

  /**
   * @param {boolean} reset
   * @param {{ silent?: boolean }} [opts] silent：已有（缓存）内容时后台刷新，不清空、不出骨架屏，失败保留旧内容
   */
  async loadFeed(reset = false, opts = {}) {
    const silent = reset && opts.silent === true
      && (this.data.orphanProducts.length > 0 || this.data.contentItems.length > 0);
    if (reset) {
      this._feedStarted = true;
      this._feedGen = (this._feedGen || 0) + 1;
      this._feedLoading = false;
      if (!silent) {
        this.setData({
          listLoading: true,
          loadingMore: false,
          archiveIndex: 0,
          contentItems: [],
          orphanProducts: [],
          contentSkip: 0,
          productSkip: 0,
          hasMoreContent: true,
          hasMoreProducts: true
        });
      }
    } else if (this._feedLoading || this.data.loadingMore) {
      return;
    } else {
      this.setData({ loadingMore: true });
    }

    this._feedLoading = true;
    const gen = this._feedGen || 0;

    try {
      const params = this.getFeedParams();
      const contentSkip = reset ? 0 : this.data.contentSkip;
      const productSkip = reset ? 0 : this.data.productSkip;
      const archiveOn = this.data.showSpecimenArchive === true;
      let contentLimit = 0;
      let productLimit = 0;

      if (reset) {
        contentLimit = archiveOn ? this._contentLimit : 0;
        productLimit = this._productLimit;
      } else if (this.data.hasMoreProducts) {
        productLimit = this._productLimit;
      } else {
        this.setData({ loadingMore: false });
        return;
      }

      const requestData = {
        ...params,
        contentSkip,
        contentLimit,
        productSkip,
        productLimit
      };
      const res = await wx.cloud.callFunction({
        name: 'getEncyclopediaFeed',
        data: requestData
      });

      if (gen !== (this._feedGen || 0)) return;

      const result = res.result || {};
      if (!result.success) throw new Error(result.msg || '加载失败');

      if (reset && feedCache.isFirstScreenRequest(requestData)) feedCache.writeFeed(archiveOn, result);
      this.applyFeedResult(result, { reset, archiveOn, contentSkip, productSkip });
      if (reset) this.measureHeader();
    } catch (err) {
      console.error('loadFeed', err);
      if (gen !== (this._feedGen || 0)) return;
      if (silent) {
        this.setData({ loadingMore: false });
        return;
      }
      const firstScreen = !!reset;
      this.setData({
        listLoading: false,
        loadingMore: false,
        // 首屏失败 = 页面基本空白，用整页错误态；翻页失败只需 toast，不该掀掉已有内容
        ...(firstScreen
          ? { pageError: true, pageErrorMsg: '馆藏加载失败，请检查网络后重试' }
          : {}),
      });
      if (!firstScreen) {
        wx.showToast({
          title: err.message && err.message.length < 20 ? err.message : '馆藏加载失败，请检查云环境',
          icon: 'none',
          duration: 3000
        });
      }
    } finally {
      if (gen === (this._feedGen || 0)) this._feedLoading = false;
    }
  },

  /** 把一页馆藏结果写进页面（网络回包与首屏缓存共用；reset=整页替换，否则按 _id 追加） */
  applyFeedResult(result, o) {
    const { reset, archiveOn, contentSkip, productSkip } = o;
    const newContent = archiveOn ? (result.contentItems || []) : [];
    const newProducts = decorateOrphanProducts(result.orphanProducts || []);

    let sub = this.data.categories[this.data.currentIndex]?.subtitle || '';
    if (this.data.currentName === '全部') {
      sub = archiveOn
        ? `档案 ${result.contentTotal || 0} · 可购 ${result.orphanTotal || 0}`
        : `可购 ${result.orphanTotal || 0}`;
    }

    this.setData({
      ...(reset ? { archiveIndex: 0 } : {}),
      contentItems: reset
        ? mergeUniqueById([], newContent)
        : mergeUniqueById(this.data.contentItems, newContent),
      orphanProducts: reset
        ? mergeUniqueById([], newProducts)
        : mergeUniqueById(this.data.orphanProducts, newProducts),
      contentTotal: archiveOn ? (result.contentTotal || 0) : 0,
      orphanTotal: result.orphanTotal || 0,
      contentSkip: contentSkip + newContent.length,
      productSkip: productSkip + newProducts.length,
      hasMoreContent: archiveOn && !!result.hasMoreContent,
      hasMoreProducts: !!result.hasMoreProducts,
      showContentSection: archiveOn && (result.contentTotal || 0) > 0,
      currentSubtitle: sub,
      listLoading: false,
      loadingMore: false
    });
  },

  // 错误态「重试」：重置锁定标记后重新走完整的 bootstrap 流程
  onRetryLoad() {
    if (this.data.listLoading) return;
    this.setData({ pageError: false, pageErrorMsg: '', listLoading: true });
    this._feedLoading = false;
    this._feedStarted = false;
    this._categoriesBootstrapped = false;
    this.loadCategories();
  },

  getFeedParams() {
    const { currentId, currentName, parentCategory, keyword } = this.data;
    const hasRealId = currentId && currentId !== 'all' && !String(currentId).startsWith('fallback_');
    const raw = this._appliedFilters || this.data.appliedFilters || EMPTY_FILTERS;
    const f = sanitizeFiltersForRoot(raw, currentName || this.data.filterRootName || '');

    // 统一传规范一级全名（昆虫馆），短名仅展示；云端 collectRootAliases 兼容旧短名
    let resolvedParent = '';
    if (currentName && currentName !== '全部') {
      resolvedParent = resolveCanonicalRootName(currentName) || currentName;
    } else if (parentCategory) {
      resolvedParent = resolveCanonicalRootName(parentCategory) || parentCategory;
    }

    let subCategoryName = '';
    let subCategoryId = null;
    let rootCategoryId = hasRealId ? currentId : null;

    const subFromPill = this.data.currentSubId || '';
    if (hasRealId && subFromPill && !f.categoryValue) {
      subCategoryId = subFromPill;
      const subs = this._categorySubMap[currentId] || [];
      const hit = subs.find((s) => s._id === subFromPill);
      if (hit) subCategoryName = hit.name || '';
    }

    // 筛选面板品类：在「全部」下可选一级馆；在某馆下可选二级名
    if (f.categoryValue) {
      if (currentId === 'all' || !currentId) {
        const asRoot = (this._categoryRoots || []).find((r) => {
          const v = String(f.categoryValue || '').trim();
          const n = r.name || '';
          return (
            n === v ||
            resolveCanonicalRootName(v) === resolveCanonicalRootName(n) ||
            toRootDisplayName(n) === v ||
            n.replace(/馆$/, '') === v.replace(/馆$/, '')
          );
        }) || CANONICAL_ROOT_NAMES.map((n) => ({ name: n })).find((r) => {
          const v = String(f.categoryValue || '').trim();
          return (
            r.name === v ||
            resolveCanonicalRootName(v) === r.name ||
            toRootDisplayName(r.name) === v
          );
        });
        if (asRoot) {
          resolvedParent = resolveCanonicalRootName(asRoot.name) || asRoot.name;
          rootCategoryId = asRoot._id || f.categoryId || null;
        } else {
          subCategoryName = f.categoryValue;
          subCategoryId = f.categoryId || null;
        }
      } else {
        subCategoryName = f.categoryValue;
      }
    }

    if (subCategoryName && !subCategoryId && this._categorySubMap) {
      const searchRoots = hasRealId ? [currentId] : Object.keys(this._categorySubMap || {});
      for (const rid of searchRoots) {
        const subs = this._categorySubMap[rid] || [];
        const hit = subs.find((s) => s.name === subCategoryName || s._id === f.categoryId);
        if (hit && hit._id) {
          subCategoryId = hit._id;
          if (!rootCategoryId) rootCategoryId = rid;
          break;
        }
      }
    } else if (f.categoryId && subCategoryName) {
      subCategoryId = f.categoryId;
    }

    const priceMin = f.priceMin != null && f.priceMin !== '' ? Number(f.priceMin) : null;
    const priceMax = f.priceMax != null && f.priceMax !== '' ? Number(f.priceMax) : null;

    return {
      categoryId: rootCategoryId && !subCategoryName ? rootCategoryId : null,
      rootCategoryId: rootCategoryId || null,
      subCategoryId: subCategoryId || null,
      parentCategory: resolvedParent,
      subCategoryName: subCategoryName || '',
      keyword: keyword || '',
      channel: f.channel || '',
      craftType: f.craftType || '',
      craftProcess: f.craftProcess || '',
      priceMin: priceMin != null && !Number.isNaN(priceMin) ? priceMin : null,
      priceMax: priceMax != null && !Number.isNaN(priceMax) ? priceMax : null
    };
  },

  onFeedScrollToLower() {
    if (this.data.listLoading || this._feedLoading || this.data.loadingMore) return;
    if (this.data.hasMoreProducts) {
      this.loadMoreProducts();
    }
  },

  onArchiveSwiperChange(e) {
    const idx = e.detail.current;
    if (idx !== this.data.archiveIndex) this.setData({ archiveIndex: idx });
    if (idx >= this.data.contentItems.length - 2 && this.data.hasMoreContent && !this._feedLoading && !this.data.loadingMore) {
      this.loadMoreContent();
    }
  },

  async loadMoreContent() {
    if (!this.data.showSpecimenArchive) return;
    if (!this.data.hasMoreContent || this._feedLoading || this.data.loadingMore) return;
    this._feedLoading = true;
    const gen = this._feedGen || 0;
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
      if (gen !== (this._feedGen || 0)) return;
      const result = res.result || {};
      if (!result.success) throw new Error(result.msg || '加载失败');
      const newContent = result.contentItems || [];
      this.setData({
        contentItems: mergeUniqueById(this.data.contentItems, newContent),
        contentSkip: this.data.contentSkip + newContent.length,
        hasMoreContent: !!result.hasMoreContent,
        loadingMore: false
      });
    } catch (err) {
      console.error('loadMoreContent', err);
      if (gen === (this._feedGen || 0)) this.setData({ loadingMore: false });
    } finally {
      if (gen === (this._feedGen || 0)) this._feedLoading = false;
    }
  },

  async loadMoreProducts() {
    if (!this.data.hasMoreProducts || this._feedLoading || this.data.loadingMore) return;
    this._feedLoading = true;
    const gen = this._feedGen || 0;
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
      if (gen !== (this._feedGen || 0)) return;
      const result = res.result || {};
      if (!result.success) throw new Error(result.msg || '加载失败');
      const newProducts = decorateOrphanProducts(result.orphanProducts || []);
      this.setData({
        orphanProducts: mergeUniqueById(this.data.orphanProducts, newProducts),
        productSkip: this.data.productSkip + newProducts.length,
        hasMoreProducts: !!result.hasMoreProducts,
        loadingMore: false
      });
    } catch (err) {
      console.error('loadMoreProducts', err);
      if (gen === (this._feedGen || 0)) this.setData({ loadingMore: false });
    } finally {
      if (gen === (this._feedGen || 0)) this._feedLoading = false;
    }
  },

  switchCategory(e) {
    const { item } = e.currentTarget.dataset;
    if (item) {
      easterEgg.tryTapCount('qingniao', {
        page: this,
        categoryName: item.shortName || item.name || ''
      });
    }
    if (!item || item._id === this.data.currentId) return;

    wx.vibrateShort({ type: 'light' });
    const idx = this.data.categories.findIndex((c) => c._id === item._id);
    if (idx < 0) return;

    const rootLabel = item.shortName || item.name || '';
    const applied = sanitizeFiltersForRoot(
      { ...this.data.appliedFilters, categoryValue: '' },
      rootLabel
    );
    this._appliedFilters = applied;
    const subRow = this.syncSubCategoryRow(item._id, '', item.name);
    this.setData({
      // 选中项滑入视野，左侧留一个邻居做上下文
      hallIntoView: `hall-${Math.max(0, idx - 1)}`,
      archiveIndex: 0,
      currentId: item._id,
      currentName: item.name,
      currentSubtitle: item.subtitle,
      currentIndex: idx,
      scrollTop: 0,
      parentCategory: item.name === '全部' ? '' : (resolveCanonicalRootName(item.name) || item.name),
      appliedFilters: applied,
      filterActiveCount: this.countActiveFilters(applied),
      filterSummary: this.buildFilterSummary(applied),
      subCategories: subRow.subCategories,
      currentSubId: subRow.currentSubId
    });
    this.refreshFilterCategoryOptions(item);

    this.loadFeed(true);
    this.measureHeader();
  },

  switchSubCategory(e) {
    const { id, name } = e.currentTarget.dataset || {};
    const nextId = id ? String(id) : '';
    if (nextId === (this.data.currentSubId || '')) return;

    wx.vibrateShort({ type: 'light' });
    const applied = { ...this.data.appliedFilters };
    if (nextId && name) {
      applied.categoryValue = name;
      applied.categoryId = nextId;
    } else {
      applied.categoryValue = '';
      applied.categoryId = '';
    }
    this._appliedFilters = applied;
    this.setData({
      currentSubId: nextId,
      appliedFilters: applied,
      filterActiveCount: this.countActiveFilters(applied),
      filterSummary: this.buildFilterSummary(applied),
      scrollTop: 0
    });
    this.loadFeed(true);
  },

  autoSwitchToName(name) {
    if (!name) return;
    const canonical = resolveCanonicalRootName(name) || '';
    const item = this.data.categories.find((c) => {
      if (c.name === name || c.shortName === name) return true;
      if (!canonical) return false;
      return (
        c.name === canonical ||
        resolveCanonicalRootName(c.name) === canonical ||
        resolveCanonicalRootName(c.shortName) === canonical
      );
    });
    if (item) {
      this.switchCategory({ currentTarget: { dataset: { item } } });
    }
  },

  goSearch() {
    const { parentCategory, currentId, currentName } = this.data;
    let url = '/subpackages/feature/search/index';
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
    if (!this.data.showAiIdentify) {
      const { toastAiIdentifyClosed } = require('../../utils/contentDisplayFlags');
      toastAiIdentifyClosed();
      return;
    }
    trackBehavior('identify_entry_click', 'identification', 'gallery_search', { source: 'gallery_search' });
    wx.navigateTo({ url: '/subpackages/feature/identify/index?from=gallery_search' });
  },

  goCustom() {
    wx.switchTab({
      url: '/pages/atelier/index',
      fail: () => wx.showToast({ title: '无法打开标本工坊', icon: 'none' })
    });
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
      url: `/subpackages/feature/detail/wiki-detail/index?id=${id}`,
      fail: () => wx.showToast({ title: '无法打开档案', icon: 'none' })
    });
  },

  goToProductFromFeed(e) {
    const id = e.currentTarget.dataset.id;
    const wikiId = e.currentTarget.dataset.wikiId || '';
    if (!id) {
      wx.showToast({ title: '藏品不存在', icon: 'none' });
      return;
    }
    const zone = wikiId ? 'related' : 'orphan';
    trackBehavior('encyclopedia_product_click', 'product', id, {
      zone,
      wikiId: wikiId || undefined,
      categoryId: this.data.currentId
    });
    const seed = (this.data.orphanProducts || []).find((p) => p && p._id === id)
      || (this.data.contentItems || []).find((c) => c && (c.productId === id || c._id === id));
    const query = wikiId
      ? { from: 'wiki', wikiId: String(wikiId), zone }
      : { zone };
    navigateToProductDetail(id, {
      seed: seed || { _id: id },
      query,
      failToast: '无法打开藏品'
    });
  },

  onFeedImageError(e) {
    const { kind, id } = e.currentTarget.dataset || {};
    if (!id) return;
    const fallback = this.data.fallbackImg;
    if (kind === 'product') {
      const list = this.data.orphanProducts || [];
      const idx = list.findIndex((p) => p._id === id);
      if (idx < 0 || list[idx].displayImage === fallback) return;
      this.setData({ [`orphanProducts[${idx}].displayImage`]: fallback });
    } else if (kind === 'content') {
      const list = this.data.contentItems || [];
      const idx = list.findIndex((c) => c._id === id);
      if (idx < 0 || list[idx].coverImage === fallback) return;
      this.setData({ [`contentItems[${idx}].coverImage`]: fallback });
    }
  }
});
