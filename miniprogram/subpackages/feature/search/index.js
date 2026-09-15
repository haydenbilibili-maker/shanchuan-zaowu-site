// subpackages/feature/search/index.js
const app = getApp();
const db = wx.cloud.database();
const _ = db.command;
const { trackBehavior } = require('../../../utils/trackBehavior');
const { getFirstImage, batchTempFileURLs } = require('../../../utils/util');
const { navigateToProductDetail } = require('../../../utils/productDetailNav');
const { sanitizeLatinName } = require('../../../utils/latinDisplay');
let easterEgg = { tryKeyword() {}, shouldIgnoreTap() { return false; } };
try { easterEgg = require('../../../utils/easterEgg'); } catch (e) { /* optional */ }
const { collectRootAliases } = require('../../../utils/categorySeed');
const {
  tokenizeKeyword,
  suggestRelatedTerms,
  buildKeywordCondition,
  rankByKeyword,
  PRODUCT_FIELDS,
  WIKI_FIELDS,
  ACTIVITY_FIELDS,
  FRAMER_FIELDS
} = require('../../../utils/fuzzySearch');
const { sanitizeProductTags } = require('../utils/productTags');
const { isSensitiveBlurProduct } = require('../../../utils/sensitiveBlur');
const { buildCraftDisplayTags } = require('../../../config/productTaxonomy');

const FILTER_TABS = [
  { id: 'all', label: '全部' },
  { id: 'wiki', label: '档案' },
  { id: 'product', label: '藏品' },
  { id: 'activity', label: '活动' },
  { id: 'framer', label: '装裱' }
];

const DEFAULT_HOT_KEYS = ['首饰', 'Morpho', '水晶', '独角仙', '装裱', '镇店'];

const TYPE_TAG = {
  product: '藏品',
  wiki: '档案',
  activity: '活动',
  framer: '装裱'
};

function buildFilterTabs(list, showSpecimenArchive) {
  const archiveOn = showSpecimenArchive === true;
  const counts = { all: 0, wiki: 0, product: 0, activity: 0, framer: 0 };
  (list || []).forEach((item) => {
    if (!item || !item.type) return;
    if (!archiveOn && item.type === 'wiki') return;
    counts.all += 1;
    if (counts[item.type] !== undefined) {
      counts[item.type] += 1;
    }
  });
  const tabs = FILTER_TABS.map((tab) => ({
    id: tab.id,
    label: tab.label,
    count: counts[tab.id] || 0
  }));
  return archiveOn ? tabs : tabs.filter((tab) => tab.id !== 'wiki');
}

function emptyFilterTabs(showSpecimenArchive) {
  return buildFilterTabs([], showSpecimenArchive);
}

function stripWikiResults(list, showSpecimenArchive) {
  if (showSpecimenArchive === true) return list || [];
  return (list || []).filter((item) => item && item.type !== 'wiki');
}

function mergeHotKeys(serverList) {
  const out = [];
  const seen = new Set();
  const push = (k) => {
    const t = String(k || '').trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  (serverList || []).forEach(push);
  DEFAULT_HOT_KEYS.forEach(push);
  return out.slice(0, 12);
}

function getDisplayPrice(item, type) {
  if (type !== 'product' && type !== 'activity') return 0;
  if (item.hasSku && Array.isArray(item.skus) && item.skus.length) {
    const prices = item.skus.map((s) => parseFloat(s.price) || 0).filter((p) => p > 0);
    if (prices.length) return Math.min(...prices);
  }
  const n = parseFloat(item.price);
  return n > 0 ? n : 0;
}

function formatPriceText(n) {
  if (!n) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

Page({
  data: {
    headerHeight: 64,
    autoFocus: true,
    inputFocused: false,
    keyword: '',

    hotKeys: ['首饰', 'Morpho', '水晶', '独角仙', '装裱', '镇店'],
    loadingHotKeys: false,
    historyList: [],
    suggestions: [],
    showSuggestions: false,

    resultList: [],
    displayList: [],
    isSearching: false,
    loading: false,
    loadError: false,
    resultMode: 'all',
    filterTabs: emptyFilterTabs(false),
    resultTotal: 0,
    scopeCategory: '',
    scopeCategoryId: '',
    scopeCategoryName: '',

    relatedTerms: [],
    relatedList: [],
    relatedLoading: false,
    /** AI 鉴定入口；缺配置默认开启 */
    showAiIdentify: true,
    showStore: true,
    /** 馆藏标本档案；缺配置默认关闭 */
    showSpecimenArchive: false
  },

  onLoad(options = {}) {
    const patch = {};
    if (options.category || options.categoryId) {
      patch.scopeCategory = decodeURIComponent(options.category || '');
      patch.scopeCategoryId = decodeURIComponent(options.categoryId || '');
      patch.scopeCategoryName = options.categoryName
        ? decodeURIComponent(options.categoryName)
        : patch.scopeCategory;
    }
    this.applyNavInsets(!!patch.scopeCategoryName);
    if (Object.keys(patch).length) this.setData(patch);

    this._flagsReady = this.loadDisplayFlags();
    this.loadSearchHistory();
    this.loadHotSearchKeywords();
    this.measureHeader();
  },

  async loadDisplayFlags() {
    let showSpecimenArchive = false;
    let showAiIdentify = true;
    let showStore = true;
    try {
      const { fetchContentDisplayFlags } = require('../../../utils/contentDisplayFlags');
      const { flags } = await fetchContentDisplayFlags();
      showSpecimenArchive = flags.showSpecimenArchive === true;
      showAiIdentify = flags.showAiIdentify !== false;
      showStore = flags.showStore !== false;
    } catch (e) {
      showSpecimenArchive = false;
      showAiIdentify = true;
      showStore = true;
    }

    const patch = { showSpecimenArchive, showAiIdentify, showStore };
    if (!showSpecimenArchive) {
      if (this.data.resultMode === 'wiki') {
        patch.resultMode = 'all';
      }
      if (this.data.resultList && this.data.resultList.length) {
        const resultList = stripWikiResults(this.data.resultList, false);
        const mode = patch.resultMode || this.data.resultMode;
        patch.resultList = resultList;
        patch.displayList = this.filterResults(resultList, mode);
        patch.resultTotal = resultList.length;
        patch.filterTabs = buildFilterTabs(resultList, false);
      }
    }
    this.setData(patch);
    this.measureHeader();
  },

  onReady() {
    this.measureHeader();
  },

  onUnload() {
    if (this._suggestTimer) clearTimeout(this._suggestTimer);
  },

  /** 检索已完成且关键词与上次提交一致时不展示联想层，避免遮挡结果区 */
  shouldShowSuggestPanel(keyword) {
    const trimmed = String(keyword || '').trim();
    if (!trimmed) return false;
    if (!this.data.isSearching) return true;
    if (this.data.loading) return false;
    const last = this._lastSearchKeyword || '';
    if (last && trimmed === last) return false;
    return true;
  },

  clearSuggestTimer() {
    if (this._suggestTimer) {
      clearTimeout(this._suggestTimer);
      this._suggestTimer = null;
    }
  },

  applyNavInsets(hasScope) {
    const scoped = hasScope === undefined ? !!this.data.scopeCategoryName : !!hasScope;
    this.setData({
      headerHeight: this.estimateHeaderHeight(scoped)
    });
  },

  estimateHeaderHeight(hasScope) {
    let windowWidth = 375;
    try {
      const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      windowWidth = sys.windowWidth || 375;
    } catch (e) { /* ignore */ }
    const px = windowWidth / 750;
    const extra = (hasScope ? 72 : 12) + (this.data.isSearching ? 96 : 0);
    return Math.ceil(100 * px + extra * px);
  },

  measureHeader() {
    setTimeout(() => {
      wx.createSelectorQuery()
        .in(this)
        .select('.sticky-header')
        .boundingClientRect((rect) => {
          if (rect && rect.height) {
            this.setData({ headerHeight: Math.ceil(rect.height) });
          }
        })
        .exec();
    }, 50);
  },

  onInput(e) {
    const keyword = String((e.detail && e.detail.value) || '');
    this.setData({ keyword });

    this.clearSuggestTimer();
    const trimmed = keyword.trim();
    if (trimmed.length > 0) {
      if (!this.shouldShowSuggestPanel(trimmed)) {
        this.setData({ suggestions: [], showSuggestions: false });
        return;
      }
      this._suggestTimer = setTimeout(() => this.getSuggestions(trimmed), 280);
    } else {
      this.setData({ suggestions: [], showSuggestions: false });
    }
  },

  onInputFocus() {
    this.setData({ inputFocused: true });
    const keyword = this.data.keyword.trim();
    if (!keyword) return;
    if (!this.shouldShowSuggestPanel(keyword)) {
      this.setData({ showSuggestions: false });
      return;
    }
    this.getSuggestions(keyword);
  },

  onInputBlur() {
    this.setData({ inputFocused: false });
    setTimeout(() => {
      this.setData({ showSuggestions: false });
    }, 180);
  },

  hideSuggestions() {
    if (this.data.showSuggestions) {
      this.setData({ showSuggestions: false });
    }
  },

  onBodyScroll() {
    this.hideSuggestions();
  },

  onScrollToLower() {
    // 统一结果列表已一次取满；保留钩子避免触底报错
  },

  clearInput() {
    wx.vibrateShort({ type: 'light' });
    this._lastSearchKeyword = '';
    this.clearSuggestTimer();
    this.setData({
      keyword: '',
      isSearching: false,
      resultList: [],
      displayList: [],
      resultTotal: 0,
      filterTabs: emptyFilterTabs(this.data.showSpecimenArchive),
      loadError: false,
      loading: false,
      suggestions: [],
      showSuggestions: false,
      relatedTerms: [],
      relatedList: [],
      relatedLoading: false
    });
    this.measureHeader();
  },

  buildScopedProductCond(keywordCond) {
    const { scopeCategory, scopeCategoryId } = this.data;
    if (!keywordCond) return null;
    const rootAliases = scopeCategory ? collectRootAliases(scopeCategory) : [];
    const productScopeOr = [];
    if (scopeCategoryId && scopeCategoryId !== 'all') {
      productScopeOr.push({ rootCategoryId: scopeCategoryId });
    }
    if (rootAliases.length) {
      productScopeOr.push({ rootCategoryName: _.in(rootAliases) });
      productScopeOr.push({ category: _.in(rootAliases) });
    }
    if (productScopeOr.length) {
      return _.and([keywordCond, _.or(productScopeOr)]);
    }
    if (scopeCategory) {
      return _.and([
        keywordCond,
        { category: db.RegExp({ regexp: scopeCategory, options: 'i' }) }
      ]);
    }
    return keywordCond;
  },

  buildScopedWikiCond(keywordCond) {
    const { scopeCategory, scopeCategoryId } = this.data;
    if (!keywordCond) return null;
    if (scopeCategoryId && scopeCategoryId !== 'all') {
      return _.and([keywordCond, { categoryId: scopeCategoryId }]);
    }
    if (scopeCategory) {
      return _.and([
        keywordCond,
        { category: db.RegExp({ regexp: scopeCategory, options: 'i' }) }
      ]);
    }
    return keywordCond;
  },

  async doSearch() {
    const keyword = this.data.keyword.trim();
    if (!keyword) return;

    this.clearSuggestTimer();
    this._lastSearchKeyword = keyword;

    if (this._flagsReady) {
      try {
        await this._flagsReady;
      } catch (e) { /* defaults applied in loadDisplayFlags */ }
    }

    const showSpecimenArchive = this.data.showSpecimenArchive === true;

    this._searchSeq = (this._searchSeq || 0) + 1;
    const seq = this._searchSeq;

    wx.vibrateShort({ type: 'medium' });
    this.setData({
      keyword,
      loading: true,
      isSearching: true,
      resultList: [],
      displayList: [],
      resultTotal: 0,
      filterTabs: emptyFilterTabs(showSpecimenArchive),
      loadError: false,
      showSuggestions: false,
      relatedTerms: suggestRelatedTerms(keyword),
      relatedList: [],
      relatedLoading: false
    });
    this.measureHeader();

    this.saveHistory(keyword);
    easterEgg.tryKeyword(keyword, { page: this });

    const { scopeCategory } = this.data;
    // 主查询字段克制：藏品/档案用完整字段；活动/装裱字段更少
    const productKeywordCond = buildKeywordCondition(db, _, keyword, PRODUCT_FIELDS);
    const wikiKeywordCond = buildKeywordCondition(db, _, keyword, WIKI_FIELDS);
    const activityKeywordCond = scopeCategory
      ? null
      : buildKeywordCondition(db, _, keyword, ACTIVITY_FIELDS);
    const framerKeywordCond = scopeCategory
      ? null
      : buildKeywordCondition(db, _, keyword, FRAMER_FIELDS);

    const productCond = this.buildScopedProductCond(productKeywordCond);
    const wikiCond = showSpecimenArchive
      ? this.buildScopedWikiCond(wikiKeywordCond)
      : null;

    if (!productCond && !wikiCond && !activityKeywordCond && !framerKeywordCond) {
      const emptyTabs = buildFilterTabs([], showSpecimenArchive);
      this.setData({
        loading: false,
        loadError: false,
        resultList: [],
        displayList: [],
        resultTotal: 0,
        filterTabs: emptyTabs
      });
      this.loadRelatedFallback(keyword, seq);
      return;
    }

    try {
      const tasks = [];
      tasks.push(
        productCond
          ? db.collection('products')
              .where(_.and([productCond, { isOffShelf: _.neq(true) }]))
              .limit(20)
              .get()
          : Promise.resolve({ data: [] })
      );
      tasks.push(
        wikiCond
          ? db.collection('cms_wikis')
              .where(_.and([wikiCond, { status: _.neq('draft') }]))
              .limit(16)
              .get()
              .catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] })
      );
      tasks.push(
        activityKeywordCond
          ? db.collection('activities').where(activityKeywordCond).limit(8).get()
          : Promise.resolve({ data: [] })
      );
      tasks.push(
        framerKeywordCond
          ? db.collection('framers').where(_.and([
              framerKeywordCond,
              { active: _.neq(false) }
            ])).limit(8).get()
          : Promise.resolve({ data: [] })
      );

      const [prodRes, wikiRes, actRes, framerRes] = await Promise.all(tasks);

      if (seq !== this._searchSeq) return;

      const merged = [
        ...(wikiRes.data || []).map((item) => ({ ...item, _searchType: 'wiki' })),
        ...(prodRes.data || []).map((item) => ({ ...item, _searchType: 'product' })),
        ...(actRes.data || []).map((item) => ({ ...item, _searchType: 'activity' })),
        ...((framerRes.data || []).filter((f) => f && f.active !== false)
          .map((item) => ({ ...item, _searchType: 'framer' })))
      ];

      const ranked = rankByKeyword(merged, keyword);
      const results = ranked.map((item) => this.formatResultItem(item, item._searchType));
      const visibleResults = stripWikiResults(results, showSpecimenArchive);

      const hydrated = await this.hydrateResultImages(visibleResults);
      if (seq !== this._searchSeq) return;

      let resultMode = this.data.resultMode;
      if (!showSpecimenArchive && resultMode === 'wiki') {
        resultMode = 'all';
      }
      const tabs = buildFilterTabs(hydrated, showSpecimenArchive);
      const displayList = this.filterResults(hydrated, resultMode);

      this.setData({
        resultList: hydrated,
        displayList,
        resultMode,
        resultTotal: hydrated.length,
        filterTabs: tabs,
        loading: false,
        loadError: false,
        showSuggestions: false,
        suggestions: []
      });

      const hitTags = this.collectTagsFromItems(hydrated);
      this.trackSearchBehavior(keyword, hitTags);
      this.loadRelatedFallback(keyword, seq, hydrated);
    } catch (err) {
      console.error(err);
      if (seq !== this._searchSeq) return;
      this.trackSearchBehavior(keyword, []);
      this.setData({
        loading: false,
        loadError: true,
        resultList: [],
        displayList: [],
        resultTotal: 0,
        filterTabs: emptyFilterTabs(this.data.showSpecimenArchive)
      });
    }
  },

  collectTagsFromItems(list) {
    const tags = [];
    (list || []).forEach((item) => {
      if (!item) return;
      if (item.type && item.type !== 'product') return;
      if (item._searchType && item._searchType !== 'product') return;
      (item.tags || []).forEach((tag) => tags.push(tag));
    });
    return sanitizeProductTags(tags);
  },

  async queryProductsByTags(tagList, excludeIds) {
    const tags = sanitizeProductTags(tagList).slice(0, 8);
    if (!tags.length) return [];
    const exclude = new Set((excludeIds || []).map((id) => String(id)));
    try {
      const res = await db.collection('products')
        .where({
          tags: _.in(tags),
          isOffShelf: _.neq(true)
        })
        .limit(12)
        .get();
      return (res.data || []).filter((item) => item && item._id && !exclude.has(String(item._id)));
    } catch (e) {
      return [];
    }
  },

  async loadRelatedFallback(keyword, seq, hitItems) {
    this.setData({ relatedLoading: true });
    try {
      const terms = suggestRelatedTerms(keyword);
      const stem = terms[0] || tokenizeKeyword(keyword)[1] || '';
      const related = [];
      const excludeIds = (hitItems || []).map((item) => item && item._id).filter(Boolean);
      const hitTags = this.collectTagsFromItems(hitItems);
      const tokenTags = sanitizeProductTags(tokenizeKeyword(keyword).filter((t) => String(t).length >= 2));
      const tagRows = await this.queryProductsByTags([...hitTags, ...tokenTags], excludeIds);
      related.push(...tagRows);

      if (related.length < 3 && !(hitItems && hitItems.length)) {
        const stemPromise = (stem && stem !== keyword)
          ? (() => {
              const stemCond = buildKeywordCondition(db, _, stem, ['title', 'category', 'tags']);
              if (!stemCond) return Promise.resolve([]);
              return db.collection('products')
                .where(_.and([stemCond, { isOffShelf: _.neq(true) }]))
                .limit(6)
                .get()
                .then((res) => res.data || [])
                .catch(() => []);
            })()
          : Promise.resolve([]);

        const [stemRows] = await Promise.all([stemPromise]);
        related.push(...stemRows);
      }

      if (related.length < 3 && !(hitItems && hitItems.length)) {
        try {
          const rec = await wx.cloud.callFunction({
            name: 'getRecommendations',
            data: { limit: 6 }
          });
          const rows = (rec.result && (rec.result.data || rec.result.list)) || [];
          related.push(...rows);
        } catch (e) {
          /* optional */
        }
      }

      if (seq !== this._searchSeq) return;

      const uniq = [];
      const seen = new Set(excludeIds.map((id) => String(id)));
      related.forEach((item) => {
        if (!item || !item._id || seen.has(String(item._id))) return;
        seen.add(String(item._id));
        uniq.push(item);
      });

      const formatted = uniq.slice(0, 6).map((item) => this.formatResultItem(item, 'product'));
      const hydrated = await this.hydrateResultImages(formatted);
      if (seq !== this._searchSeq) return;

      this.setData({
        relatedList: hydrated,
        relatedTerms: terms,
        relatedLoading: false
      });
    } catch (e) {
      if (seq !== this._searchSeq) return;
      this.setData({ relatedLoading: false, relatedList: [] });
    }
  },

  retrySearch() {
    this.doSearch();
  },

  formatResultItem(item, type) {
    let sub = sanitizeLatinName(item.latinName || item.englishName || '');
    if (type === 'activity') {
      sub = [item.date, item.time].filter(Boolean).join(' ');
    } else if (type === 'framer') {
      sub = item.type === 'store' ? '店内装裱' : '合作装裱';
    }

    const rawImg = getFirstImage(
      item.images,
      item.coverImage || item.image || item.avatar || ''
    );
    const price = getDisplayPrice(item, type);
    const score = Number(item._matchScore) || 0;
    const tags = sanitizeProductTags(item.tags);
    const craftTags = type === 'product' ? buildCraftDisplayTags(item) : [];

    return {
      _id: item._id,
      resultKey: `${type}_${item._id}`,
      type,
      title: item.title || item.name || '',
      subTitle: sub,
      image: rawImg,
      imgBroken: false,
      price,
      priceText: formatPriceText(price),
      tag: TYPE_TAG[type] || '档案',
      tags,
      displayTags: tags.slice(0, 3),
      craftTags,
      matchScore: score,
      matchStrong: score >= 100,
      sensitiveBlur: type === 'product' && isSensitiveBlurProduct(item)
    };
  },

  formatResults(list, type) {
    return (list || []).map((item) => this.formatResultItem(item, type));
  },

  async hydrateResultImages(list) {
    const ids = list.map((item) => item.image);
    const urlMap = await batchTempFileURLs(ids);
    return list.map((item) => ({
      ...item,
      image: (item.image && urlMap[item.image]) || item.image
    }));
  },

  filterResults(list, mode) {
    if (!mode || mode === 'all') return list || [];
    return (list || []).filter((item) => item.type === mode);
  },

  formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 7) {
      const date = new Date(timestamp);
      return `${date.getMonth() + 1}-${date.getDate()}`;
    }
    if (days > 0) return `${days}天前`;
    if (hours > 0) return `${hours}小时前`;
    if (minutes > 0) return `${minutes}分钟前`;
    return '刚刚';
  },

  loadSearchHistory() {
    try {
      const historyData = wx.getStorageSync('search_history') || [];
      const historyList = historyData.map((item) => {
        if (typeof item === 'string') {
          return { keyword: item, timestamp: Date.now(), timeText: '刚刚' };
        }
        return {
          ...item,
          timeText: this.formatRelativeTime(item.timestamp)
        };
      }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      this.setData({ historyList });
    } catch (e) {
      console.error('加载搜索历史失败:', e);
      this.setData({ historyList: [] });
    }
  },

  saveHistory(keyword) {
    try {
      let history = [...this.data.historyList].filter((item) => {
        const itemKeyword = typeof item === 'string' ? item : item.keyword;
        return itemKeyword !== keyword;
      });

      history.unshift({ keyword, timestamp: Date.now(), timeText: '刚刚' });
      if (history.length > 10) history = history.slice(0, 10);

      this.setData({ historyList: history });
      wx.setStorageSync('search_history', history);
    } catch (e) {
      console.error('保存搜索历史失败:', e);
    }
  },

  trackSearchBehavior(keyword, tags) {
    trackBehavior('search', 'keyword', keyword, {
      keyword,
      tags: sanitizeProductTags(tags)
    });
  },

  async loadHotSearchKeywords() {
    try {
      this.setData({ loadingHotKeys: true });
      const res = await wx.cloud.callFunction({
        name: 'getHotSearchKeywords',
        data: { limit: 10, timeRange: 7 }
      });

      const server = (res.result && res.result.success && Array.isArray(res.result.data))
        ? res.result.data
        : [];
      this.setData({
        hotKeys: mergeHotKeys(server),
        loadingHotKeys: false
      });
    } catch (e) {
      console.error('加载热门搜索失败:', e);
      this.setData({
        hotKeys: mergeHotKeys([]),
        loadingHotKeys: false
      });
    }
  },

  tapHistory(e) {
    wx.vibrateShort({ type: 'light' });
    const text = e.currentTarget.dataset.text;
    const keyword = typeof text === 'string' ? text : (text && text.keyword) || '';
    if (!keyword) return;
    this.setData({ keyword, showSuggestions: false }, () => { this.doSearch(); });
  },

  tapHotKey(e) {
    wx.vibrateShort({ type: 'light' });
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    this.setData({ keyword: text, showSuggestions: false }, () => { this.doSearch(); });
  },

  clearHistory() {
    wx.vibrateShort({ type: 'medium' });
    wx.showModal({
      title: '清空最近搜索',
      content: '确定清除本机保存的检索记录吗？',
      confirmColor: '#C4A76C',
      success: (res) => {
        if (res.confirm) {
          this.setData({ historyList: [] });
          wx.removeStorageSync('search_history');
        }
      }
    });
  },

  removeHistory(e) {
    wx.vibrateShort({ type: 'light' });
    const text = e.currentTarget.dataset.text;
    const keyword = typeof text === 'string' ? text : '';
    if (!keyword) return;
    try {
      const historyList = this.data.historyList.filter((item) => {
        const itemKeyword = typeof item === 'string' ? item : item.keyword;
        return itemKeyword !== keyword;
      });
      this.setData({ historyList });
      wx.setStorageSync('search_history', historyList);
    } catch (err) {
      console.error('删除搜索历史失败:', err);
    }
  },

  switchResultMode(e) {
    const mode = e.currentTarget.dataset.id;
    if (!mode || mode === this.data.resultMode) return;
    if (mode === 'wiki' && this.data.showSpecimenArchive !== true) return;
    wx.vibrateShort({ type: 'light' });
    this.setData({
      resultMode: mode,
      displayList: this.filterResults(this.data.resultList, mode)
    });
  },

  onResultImgError(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(index) || index < 0) return;
    this.setData({ [`displayList[${index}].imgBroken`]: true });
  },

  goToProduct(e) {
    const info = (e && e.detail) || {};
    const id = info.id || info._id;
    if (!id) {
      wx.showToast({ title: '藏品不存在', icon: 'none' });
      return;
    }
    const seed = (this.data.displayList || []).find((x) => x && (x._id === id || x.id === id))
      || info;
    navigateToProductDetail(id, { seed, failToast: '无法打开藏品' });
  },

  goToTarget(e) {
    const dataset = (e.currentTarget && e.currentTarget.dataset) || {};
    const id = dataset.id;
    const type = dataset.type;
    const failToast = (title) => (err) => {
      console.error('打开内容失败', type, id, err);
      wx.showToast({ title, icon: 'none' });
    };

    if (type === 'activity') {
      if (!this.data.showStore) {
        const { toastStoreClosed } = require('../../../utils/contentDisplayFlags');
        toastStoreClosed();
        return;
      }
      if (id) app.globalData.targetActivityId = id;
      wx.navigateTo({
        url: '/subpackages/business/store/index',
        fail: failToast('页面暂不可用')
      });
      return;
    }

    if (!id) {
      wx.showToast({ title: '内容不存在', icon: 'none' });
      return;
    }

    const enc = encodeURIComponent(String(id));
    if (type === 'product') {
      const seed = (this.data.displayList || []).find((x) => x && (x._id === id || x.id === id));
      navigateToProductDetail(id, { seed: seed || { _id: id }, failToast: '无法打开藏品' });
    } else if (type === 'wiki') {
      if (this.data.showSpecimenArchive !== true) {
        wx.showToast({ title: '档案暂未开放', icon: 'none' });
        return;
      }
      wx.navigateTo({
        url: `/subpackages/feature/detail/wiki-detail/index?id=${enc}`,
        fail: failToast('无法打开档案')
      });
    } else if (type === 'framer') {
      wx.navigateTo({
        url: `/subpackages/business/framer/index?id=${enc}`,
        fail: failToast('页面暂不可用')
      });
    } else {
      wx.showToast({ title: '暂无法打开', icon: 'none' });
    }
  },

  async getSuggestions(keyword) {
    if (!keyword || keyword.length < 1) {
      this.setData({ suggestions: [], showSuggestions: false });
      return;
    }

    try {
      const historyMatches = this.data.historyList
        .filter((h) => {
          const hKeyword = typeof h === 'string' ? h : h.keyword || '';
          return hKeyword.toLowerCase().includes(keyword.toLowerCase());
        })
        .map((h) => (typeof h === 'string' ? h : h.keyword))
        .slice(0, 3);

      const hotMatches = this.data.hotKeys
        .filter((h) => String(h).toLowerCase().includes(keyword.toLowerCase()))
        .slice(0, 2);

      const relatedMatches = suggestRelatedTerms(keyword).slice(0, 2);

      let dbMatches = [];
      try {
        const kwCond = buildKeywordCondition(db, _, keyword, ['title', 'category', 'tags']);
        if (kwCond) {
          const res = await db.collection('products')
            .where(_.and([kwCond, { isOffShelf: _.neq(true) }]))
            .limit(5)
            .get();
          dbMatches = rankByKeyword(res.data || [], keyword)
            .map((item) => item.title)
            .filter(Boolean)
            .slice(0, 3);
        }
      } catch (e) {
        console.warn('搜索建议查询失败:', e);
      }

      const allSuggestions = [...new Set([
        ...historyMatches,
        ...relatedMatches,
        ...hotMatches,
        ...dbMatches
      ])];
      const sliced = allSuggestions.slice(0, 5);
      if (String(this.data.keyword || '').trim() !== keyword) return;
      const showSuggestions = sliced.length > 0 && this.shouldShowSuggestPanel(keyword);
      this.setData({
        suggestions: sliced,
        showSuggestions
      });
    } catch (e) {
      console.error('获取搜索建议失败:', e);
    }
  },

  selectSuggestion(e) {
    const text = e.currentTarget.dataset.text;
    this.setData({
      keyword: text,
      showSuggestions: false,
      suggestions: []
    });
    this.doSearch();
  },

  clearCategoryScope() {
    wx.vibrateShort({ type: 'light' });
    this.setData({
      scopeCategory: '',
      scopeCategoryId: '',
      scopeCategoryName: ''
    });
    this.measureHeader();
    if (this.data.isSearching && this.data.keyword) {
      this.doSearch();
    }
  },

  goToIdentify(e) {
    if (!this.data.showAiIdentify) {
      const { toastAiIdentifyClosed } = require('../../../utils/contentDisplayFlags');
      toastAiIdentifyClosed();
      return;
    }
    const source = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.source) || 'search';
    wx.vibrateShort({ type: 'light' });
    trackBehavior('identify_entry_click', 'identification', source, { source });
    wx.navigateTo({
      url: `/subpackages/feature/identify/index?from=${encodeURIComponent(source)}`,
      fail: () => wx.showToast({ title: '无法打开鉴定', icon: 'none' })
    });
  },

  onResultAreaTap() {
    this.hideSuggestions();
  },

  goBack() {
    this.hideSuggestions();
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/index/index' })
    });
  }
});
