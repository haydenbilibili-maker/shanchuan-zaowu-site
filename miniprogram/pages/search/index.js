// pages/search/index.js
const app = getApp();
const db = wx.cloud.database();
const _ = db.command;
const { trackBehavior } = require('../../utils/trackBehavior');

Page({
  data: {
    statusBarHeight: 20,
    keyword: '',
    
    hotKeys: ['Morpho', '水晶', '独角仙', 'Gold', '镇店'], // 默认热门关键词
    loadingHotKeys: false, // 加载热门关键词状态
    historyList: [], // 搜索历史（带时间戳的对象数组）
    suggestions: [], // 搜索建议
    showSuggestions: false, // 是否显示建议

    resultList: [],
    isSearching: false,
    loading: false,
    isScanning: false,
    resultMode: 'all',
    scopeCategory: '',
    scopeCategoryId: '',
    scopeCategoryName: ''
  },

  onLoad(options = {}) {
    const { statusBarHeight } = wx.getSystemInfoSync();
    const patch = { statusBarHeight };

    if (options.category || options.categoryId) {
      patch.scopeCategory = decodeURIComponent(options.category || '');
      patch.scopeCategoryId = decodeURIComponent(options.categoryId || '');
      patch.scopeCategoryName = options.categoryName
        ? decodeURIComponent(options.categoryName)
        : patch.scopeCategory;
    }

    this.setData(patch);
    this.loadSearchHistory();
    this.loadHotSearchKeywords();
  },

  onInput(e) {
    const keyword = e.detail.value.trim();
    this.setData({ keyword });
    
    // 搜索联想：输入时实时提示
    if (keyword.length > 0) {
      this.getSuggestions(keyword);
    } else {
      this.setData({ suggestions: [], showSuggestions: false });
    }
  },

  onInputFocus() {
    // 输入框获得焦点时，如果有历史记录，显示建议（仅关键词字符串）
    if (this.data.keyword.length === 0 && this.data.historyList.length > 0) {
      const suggestions = this.data.historyList
        .slice(0, 5)
        .map((h) => (typeof h === 'string' ? h : h.keyword || ''))
        .filter(Boolean);
      this.setData({ suggestions, showSuggestions: suggestions.length > 0 });
    }
  },

  clearInput() {
    wx.vibrateShort({ type: 'light' });
    this.setData({ 
      keyword: '', 
      isSearching: false, 
      resultList: [], 
      isScanning: false,
      suggestions: [],
      showSuggestions: false
    });
  },

  async doSearch() {
    const keyword = this.data.keyword.trim();
    if (!keyword) return;

    wx.vibrateShort({ type: 'medium' });
    this.setData({ 
      loading: true, 
      isSearching: true, 
      resultList: [], 
      isScanning: true,
      showSuggestions: false // 搜索时隐藏建议
    });
    
    // 保存搜索历史
    this.saveHistory(keyword);
    
    // 记录搜索行为（异步，不阻塞搜索）
    this.trackSearchBehavior(keyword);

    const dbReg = db.RegExp({ regexp: keyword, options: 'i' });
    const { scopeCategory, scopeCategoryId } = this.data;

    const productKeywordCond = _.or([
      { title: dbReg }, { latinName: dbReg }, { category: dbReg }
    ]);
    const productCond = scopeCategory
      ? _.and([
          productKeywordCond,
          { category: db.RegExp({ regexp: scopeCategory, options: 'i' }) }
        ])
      : productKeywordCond;

    const wikiKeywordCond = _.or([
      { title: dbReg }, { latinName: dbReg }, { brief: dbReg }
    ]);
    let wikiCond = wikiKeywordCond;
    if (scopeCategoryId && scopeCategoryId !== 'all') {
      wikiCond = _.and([wikiKeywordCond, { categoryId: scopeCategoryId }]);
    } else if (scopeCategory) {
      wikiCond = _.and([
        wikiKeywordCond,
        { category: db.RegExp({ regexp: scopeCategory, options: 'i' }) }
      ]);
    }

    try {
      const [prodRes, actRes, framerRes, wikiRes] = await Promise.all([
        db.collection('products')
          .where(productCond)
          .where({ isOffShelf: _.neq(true) })
          .get(),

        scopeCategory
          ? Promise.resolve({ data: [] })
          : db.collection('activities').where({ title: dbReg }).get(),

        scopeCategory
          ? Promise.resolve({ data: [] })
          : db.collection('framers').where({ name: dbReg }).get(),

        db.collection('cms_wikis')
          .where(_.and([wikiCond, { status: _.neq('draft') }]))
          .get()
          .catch(() => ({ data: [] }))
      ]);

      // 内容优先，商品次之（与馆藏 PRD 一致）
      const results = [
        ...this.formatResults(wikiRes.data, 'wiki'),
        ...this.formatResults(prodRes.data, 'product'),
        ...this.formatResults(actRes.data, 'activity'),
        ...this.formatResults(framerRes.data, 'framer')
      ];

      setTimeout(() => {
        this.setData({ 
          resultList: results, 
          loading: false,
          isScanning: results.length > 0 
        });
        setTimeout(() => this.setData({ isScanning: false }), 2000);
      }, 600);

    } catch (err) {
      console.error(err);
      this.setData({ loading: false, isScanning: false });
    }
  },

  // 统一数据格式
  formatResults(list, type) {
    return list.map(item => {
      let label = 'ARCHIVE';
      let sub = item.latinName || item.englishName || '';
      let img = item.images ? item.images[0] : (item.image || item.avatar || item.coverImage || '');
      
      if (type === 'product') { label = 'SPECIMEN'; }
      else if (type === 'activity') { label = 'EVENT'; sub = item.date + ' ' + item.time; }
      else if (type === 'framer') { label = 'ARTIST'; sub = item.type === 'store' ? 'In-House' : 'Partner'; }
      else if (type === 'wiki') { label = '档案'; }

      return {
        _id: item._id,
        type,
        title: item.title || item.name,
        subTitle: sub,
        image: img,
        price: item.price, // 仅商品/活动有
        tag: label
      };
    });
  },

  // 格式化相对时间
  formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 7) {
      const date = new Date(timestamp);
      return `${date.getMonth() + 1}-${date.getDate()}`;
    } else if (days > 0) {
      return `${days}天前`;
    } else if (hours > 0) {
      return `${hours}小时前`;
    } else if (minutes > 0) {
      return `${minutes}分钟前`;
    } else {
      return '刚刚';
    }
  },

  // 加载搜索历史（带时间戳）
  loadSearchHistory() {
    try {
      const historyData = wx.getStorageSync('search_history') || [];
      // 兼容旧格式（纯字符串数组）和新格式（对象数组）
      const historyList = historyData.map(item => {
        if (typeof item === 'string') {
          return { 
            keyword: item, 
            timestamp: Date.now(),
            timeText: '刚刚'
          };
        }
        return {
          ...item,
          timeText: this.formatRelativeTime(item.timestamp)
        };
      }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // 按时间倒序
      
      this.setData({ historyList });
    } catch (e) {
      console.error('加载搜索历史失败:', e);
      this.setData({ historyList: [] });
    }
  },

  // 保存搜索历史（带时间戳）
  saveHistory(keyword) {
    try {
      let history = [...this.data.historyList];
      
      // 移除相同的关键词（如果存在）
      history = history.filter(item => {
        const itemKeyword = typeof item === 'string' ? item : item.keyword;
        return itemKeyword !== keyword;
      });
      
      // 添加到最前面
      history.unshift({ keyword, timestamp: Date.now() });
      
      // 限制最多保存10条
      if (history.length > 10) {
        history = history.slice(0, 10);
      }
      
      this.setData({ historyList: history });
      wx.setStorageSync('search_history', history);
    } catch (e) {
      console.error('保存搜索历史失败:', e);
    }
  },

  trackSearchBehavior(keyword) {
    trackBehavior('search', 'keyword', keyword, { keyword });
  },

  // 加载热门搜索关键词
  async loadHotSearchKeywords() {
    try {
      this.setData({ loadingHotKeys: true });
      
      const res = await wx.cloud.callFunction({
        name: 'getHotSearchKeywords',
        data: {
          limit: 10,
          timeRange: 7 // 最近7天
        }
      });
      
      if (res.result && res.result.success && res.result.data) {
        this.setData({ 
          hotKeys: res.result.data,
          loadingHotKeys: false 
        });
      } else {
        this.setData({ loadingHotKeys: false });
      }
    } catch (e) {
      console.error('加载热门搜索失败:', e);
      this.setData({ loadingHotKeys: false });
      // 失败时保持默认关键词
    }
  },

  tapHistory(e) {
    wx.vibrateShort({ type: 'light' });
    const text = e.currentTarget.dataset.text;
    // 兼容对象格式和字符串格式
    const keyword = typeof text === 'string' ? text : text.keyword || text;
    this.setData({ keyword }, () => { this.doSearch(); });
  },

  tapHotKey(e) {
    wx.vibrateShort({ type: 'light' });
    const text = e.currentTarget.dataset.text;
    this.setData({ keyword: text }, () => { this.doSearch(); });
  },

  clearHistory() {
    wx.vibrateShort({ type: 'medium' });
    wx.showModal({
      title: '清空记录', content: '确定销毁检索日志吗？', confirmColor: '#C4A76C',
      success: (res) => {
        if (res.confirm) {
          this.setData({ historyList: [] });
          wx.removeStorageSync('search_history');
        }
      }
    });
  },

  switchResultMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === this.data.resultMode) return
    this.setData({ resultMode: mode })
  },

  goToProduct(e) {
    const info = e.detail
    if (info && info._id) {
      wx.navigateTo({ url: `/pages/detail/index?id=${info._id}` })
    }
  },

  // 🟢 智能跳转
  goToTarget(e) {
    const { id, type } = e.currentTarget.dataset;
    
    if (type === 'product') {
      wx.navigateTo({ url: `/pages/detail/index?id=${id}&type=product` });
    } else if (type === 'wiki') {
      wx.navigateTo({ url: `/pages/detail/wiki-detail?id=${id}` });
    } else if (type === 'activity') {
      // 活动通常跳预约页，或者专门的活动详情页，这里跳预约Tab并带参数
      app.globalData.targetActivityId = id; // 可选：传参给预约页
      wx.switchTab({ url: '/pages/store/index' });
    } else if (type === 'framer') {
      wx.navigateTo({ url: `/subpackages/business/framer/index?id=${id}` });
    }
  },

  // 获取搜索建议（联想）
  async getSuggestions(keyword) {
    if (keyword.length < 1) {
      this.setData({ suggestions: [], showSuggestions: false });
      return;
    }

    try {
      // 从历史记录中匹配（兼容对象格式和字符串格式）
      const historyMatches = this.data.historyList
        .filter(h => {
          const hKeyword = typeof h === 'string' ? h : h.keyword || '';
          return hKeyword.toLowerCase().includes(keyword.toLowerCase());
        })
        .map(h => typeof h === 'string' ? h : h.keyword)
        .slice(0, 3);

      // 从热门搜索中匹配
      const hotMatches = this.data.hotKeys
        .filter(h => h.toLowerCase().includes(keyword.toLowerCase()))
        .slice(0, 2);

      // 从数据库中搜索（简化版：只搜索商品标题）
      let dbMatches = [];
      try {
        const dbReg = db.RegExp({ regexp: keyword, options: 'i' });
        const res = await db.collection('products')
          .where({ title: dbReg, isOffShelf: false })
          .limit(5)
          .get();
        dbMatches = res.data.map(item => item.title).slice(0, 3);
      } catch (e) {
        console.warn('搜索建议查询失败:', e);
      }

      // 合并去重
      const allSuggestions = [...new Set([...historyMatches, ...hotMatches, ...dbMatches])];
      
      this.setData({ 
        suggestions: allSuggestions.slice(0, 5),
        showSuggestions: allSuggestions.length > 0
      });
    } catch (e) {
      console.error('获取搜索建议失败:', e);
    }
  },

  // 选择建议
  selectSuggestion(e) {
    const text = e.currentTarget.dataset.text;
    this.setData({ 
      keyword: text,
      showSuggestions: false,
      suggestions: []
    });
    this.doSearch();
  },

  // 获取"你可能想搜"建议
  getRecommendations() {
    // 基于用户历史记录和热门搜索生成建议
    const history = this.data.historyList;
    const hotKeys = this.data.hotKeys;
    
    // 简单的推荐逻辑：结合历史和热门
    const recommendations = [];
    
    // 如果历史记录中有相关搜索，推荐相关商品
    if (history.length > 0) {
      const lastSearch = history[0];
      // 可以基于最后搜索的关键词推荐相关商品
    }
    
    // 推荐热门搜索
    recommendations.push(...hotKeys.slice(0, 3));
    
    return recommendations;
  },

  clearCategoryScope() {
    wx.vibrateShort({ type: 'light' });
    this.setData({
      scopeCategory: '',
      scopeCategoryId: '',
      scopeCategoryName: ''
    });
    if (this.data.isSearching && this.data.keyword) {
      this.doSearch();
    }
  },

  goBack() { wx.navigateBack(); }
});