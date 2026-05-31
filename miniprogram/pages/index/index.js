// pages/index/index.js
const app = getApp();
const db = wx.cloud.database();
const _ = db.command;
const { getFirstImage } = require('../../utils/util');
const { setCache, getCache, clearCache } = require('../../utils/cache');
const { xingchenCover } = require('../../config/storeMediaCdn');
const { enrichStore, setPreferredStoreId } = require('../../utils/storeHelper');
const { DEFAULT_STORES, DEFAULT_STORE_ID } = require('../../utils/storeDefaults');
const { haversineKm, formatDistance } = require('../../utils/storeGeo');
const { hydrateStoreMedia } = require('../../utils/storeMedia');
const { trackBehavior } = require('../../utils/trackBehavior');

/** 博物标本室 · 服务入口灵动球（第二行） */
const SERVICE_ORBS = [
  { _id: 'svc_identify', displayName: 'AI识别', enName: 'AI SCAN', icon: '📷', action: 'identify', animDelay: 1.6 },
  { _id: 'svc_atelier', displayName: '标本工坊', enName: 'ATELIER', icon: '🎁', action: 'atelier', animDelay: 2 },
  { _id: 'svc_care', displayName: '标本养护', enName: 'CARE', icon: '🌡', action: 'care', animDelay: 2.4 },
  { _id: 'svc_community', displayName: '山海社区', enName: 'COMMUNITY', icon: '✦', action: 'community', animDelay: 2.8 }
];

Page({
  data: {
    navTop: 40,
    isScrolled: false,
    
    // 首页配置
    homeConfig: null,
    moduleOrder: [], // 模块顺序
    
    // 加载状态
    loading: true,
    loadingBanners: true,
    loadingCategories: true,
    loadingFramers: true,
    loadingActivities: true,
    loadingCollections: true,
    loadingNewArrivals: true,
    loadingRecommendations: true,
    loadingConfig: true,
    
    // 灵动球交互
    currentOrbId: '', // 当前选中的球ID
    orbExpanded: false, // 底部面板是否展开
    orbProducts: [], // 展开的商品数据
    orbLoading: false,
    
    banners: [],
    categories: [],
    serviceOrbs: SERVICE_ORBS,
    framers: [],
    activities: [],
    collections: [],
    newArrivals: [],
    recommendations: [], // 推荐内容
    currentBannerIndex: 0,
    
    // 模块显示控制
    showBanners: true,
    showCategories: true,
    showCollections: true,
    showFramers: true,
    showActivities: true,
    showRecommendations: true,
    showNewArrivals: true,

    exploreStore: null,
    showExploreStore: true,
    loadingExploreStore: true,
    showQuickGrid: false,
    quickEntries: [
      { id: 'identify', label: 'AI 鉴定', icon: '/assets/icons/camera.png', badge: '限时免费', action: 'identify' },
      { id: 'gallery', label: '馆藏', icon: '/assets/icons/exhibition-tab-active.png', action: 'gallery' },
      { id: 'atelier', label: '标本工坊', icon: '/assets/icons/edit.png', action: 'atelier' },
      { id: 'atlas', label: '我的图鉴', icon: '/assets/icons/medal_gold.png', action: 'atlas' }
    ],

    atelierHeroImage: xingchenCover
  },

  onLoad() {
    const { getWindowInfo } = require('../../utils/systemInfo');
    const win = getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    this.setData({ navTop: menu.top || win.statusBarHeight || 40 });

    this.initData();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    this.refreshNewArrivalsList();
  },

  refreshNewArrivalsList() {
    const list = this.selectComponent('#newArrivalsList');
    if (list && typeof list.reload === 'function') {
      list.reload();
    }
  },

  onPageScroll(e) {
    const scrollTop = e.scrollTop;
    if (scrollTop > 80 && !this.data.isScrolled) {
      this.setData({ isScrolled: true });
    } else if (scrollTop <= 80 && this.data.isScrolled) {
      this.setData({ isScrolled: false });
    }
  },

  async initData() {
    // 🔧 重写：添加初始化锁，防止重复调用
    if (this._initializing) {
      return;
    }
    this._initializing = true;
    
    try {
      // 1. 加载首页配置（同步执行，简化逻辑）
      await this.loadHomeConfig();
      
      // 2. 根据配置加载模块数据
      const enabledModules = this.getEnabledModules();
      
      // 优先加载关键内容（轮播图和分类）
      const criticalModules = enabledModules.filter(m => ['banners', 'categories', 'recommendations', 'newArrivals'].includes(m.id));
      if (criticalModules.length > 0) {
        try {
          await Promise.all(
            criticalModules.map(m => this.loadModuleData(m.id))
          );
        } catch (e) {
          console.error('加载关键模块失败:', e);
        }
      }
      
      // 首屏渲染完成，隐藏loading
      this.setData({ loading: false, loadingConfig: false });
      
      // 3. 延迟加载其他内容（非阻塞）
      setTimeout(() => {
        const otherModules = enabledModules.filter(m => !['banners', 'categories', 'recommendations', 'newArrivals'].includes(m.id));
        if (otherModules.length > 0) {
          Promise.all(
            otherModules.map(m => this.loadModuleData(m.id))
          ).catch(err => {
            console.error('加载数据失败:', err);
          });
        }
        this.loadExploreStore();
      }, 300);
    } catch (e) {
      console.error('初始化数据失败:', e);
      this.setData({ loading: false, loadingConfig: false });
    } finally {
      this._initializing = false;
    }
  },

  // 加载首页配置（重写：简化逻辑，避免无限刷新）
  async loadHomeConfig() {
    // 🔧 重写：使用已加载标记，避免重复加载
    if (this._configLoaded) {
      return;
    }
    
    try {
      // 先尝试从缓存获取
      const cached = getCache('HOME_CONFIG');
      if (cached) {
        const moduleOrder = this.getModuleOrder(cached);
        const visibility = this.computeModuleVisibility(cached);
        
        // 一次性设置所有状态，避免多次setData
        this.setData({ 
          homeConfig: cached,
          moduleOrder: moduleOrder,
          ...visibility,
          loadingConfig: false
        });
        
        this._configLoaded = true;
        
        // 后台静默更新配置（不阻塞，不影响UI）
        this.updateHomeConfigCache().catch(() => {});
        return;
      }

      // 从云端加载配置
      const res = await wx.cloud.callFunction({
        name: 'getHomeConfig'
      });

      if (res.result && res.result.success && res.result.data) {
        const config = res.result.data;
        const moduleOrder = this.getModuleOrder(config);
        const visibility = this.computeModuleVisibility(config);
        
        // 更新缓存（24小时）
        setCache('HOME_CONFIG', config, 24 * 60 * 60 * 1000);
        
        // 一次性设置所有状态
        this.setData({ 
          homeConfig: config,
          moduleOrder: moduleOrder,
          ...visibility,
          loadingConfig: false
        });
      } else {
        // 使用默认配置
        const defaultOrder = this.getDefaultModuleOrder();
        const defaultVisibility = {
          showBanners: true,
          showCategories: true,
          showCollections: true,
          showFramers: true,
          showActivities: true,
          showRecommendations: true,
          showNewArrivals: true,
          showQuickGrid: false,
          showExploreStore: true
        };
        
        this.setData({ 
          homeConfig: [],
          moduleOrder: defaultOrder,
          ...defaultVisibility,
          loadingConfig: false
        });
      }
      
      this._configLoaded = true;
    } catch (e) {
      console.error('加载首页配置失败:', e);
      // 使用默认配置
      const defaultOrder = this.getDefaultModuleOrder();
      const defaultVisibility = {
        showBanners: true,
        showCategories: true,
        showCollections: true,
        showFramers: true,
        showActivities: true,
        showRecommendations: true,
        showNewArrivals: true,
        showQuickGrid: false,
        showExploreStore: true
      };
      
      this.setData({ 
        homeConfig: [],
        moduleOrder: defaultOrder,
        ...defaultVisibility,
        loadingConfig: false
      });
      
      this._configLoaded = true;
    }
  },

  // 后台更新配置缓存
  async updateHomeConfigCache() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getHomeConfig'
      });
      if (res.result && res.result.success) {
        setCache('HOME_CONFIG', res.result.data, 24 * 60 * 60 * 1000);
      }
    } catch (e) {
      console.warn('更新配置缓存失败:', e);
    }
  },

  // 获取启用的模块
  getEnabledModules() {
    if (!this.data.homeConfig || this.data.homeConfig.length === 0) {
      return this.getDefaultModules();
    }
    return this.data.homeConfig
      .filter(m => m.enabled !== false)
      .sort((a, b) => (a.order || 999) - (b.order || 999));
  },

  // 计算模块显示状态（重写：返回对象，不直接setData）
  computeModuleVisibility(config) {
    if (!config || config.length === 0) {
      return {
        showBanners: true,
        showCategories: true,
        showCollections: true,
        showFramers: true,
        showActivities: true,
        showRecommendations: true,
        showNewArrivals: true,
        showQuickGrid: false,
        showExploreStore: true
      };
    }

    const configMap = {};
    config.forEach(m => {
      configMap[m.id] = m.enabled !== false;
    });

    return {
      showBanners: configMap.banners !== false,
      showCategories: configMap.categories !== false,
      showCollections: configMap.collections !== false,
      showFramers: configMap.framers !== false,
      showActivities: configMap.activities !== false,
      showRecommendations: configMap.recommendations !== false,
      showNewArrivals: configMap.newArrivals !== false,
      showQuickGrid: configMap.quickGrid === true,
      showExploreStore: configMap.exploreStore !== false
    };
  },

  // 获取模块顺序
  getModuleOrder(config) {
    if (!config || config.length === 0) {
      return this.getDefaultModuleOrder();
    }
    return config
      .filter(m => m.enabled !== false)
      .sort((a, b) => (a.order || 999) - (b.order || 999))
      .map(m => m.id);
  },

  // 获取默认模块顺序
  getDefaultModuleOrder() {
    return [
      'banners',
      'categories',
      'recommendations',
      'newArrivals',
      'atelier',
      'exploreStore',
      'collections',
      'framers',
      'activities'
    ];
  },

  // 获取默认模块配置
  getDefaultModules() {
    return [
      { id: 'banners', enabled: true, order: 1 },
      { id: 'categories', enabled: true, order: 2 },
      { id: 'recommendations', enabled: true, order: 3 },
      { id: 'newArrivals', enabled: true, order: 4 },
      { id: 'atelier', enabled: true, order: 5 },
      { id: 'exploreStore', enabled: true, order: 6 },
      { id: 'collections', enabled: true, order: 7 },
      { id: 'framers', enabled: true, order: 8 },
      { id: 'activities', enabled: true, order: 9 },
      { id: 'quickGrid', enabled: false, order: 99 }
    ];
  },

  // 根据模块ID加载数据
  async loadModuleData(moduleId) {
    const module = this.data.homeConfig?.find(m => m.id === moduleId) || {};
    const config = module.config || {};

    switch (moduleId) {
      case 'banners':
        return this.loadBanners(config);
      case 'categories':
        return this.loadCategories(config);
      case 'collections':
        return this.loadCollections(config);
      case 'framers':
        return this.loadFramers(config);
      case 'activities':
        return this.loadActivities(config);
      case 'recommendations':
        return this.loadRecommendations(config);
      case 'newArrivals':
        return this.loadNewArrivals(config);
      default:
        console.warn('未知模块:', moduleId);
    }
  },
  
  // 下拉刷新（重写：重置所有标记，强制重新加载）
  onPullDownRefresh() {
    // 🔧 重写：清除所有加载标记
    this._initializing = false;
    this._configLoaded = false;
    
    // 清除数据缓存（但保留配置缓存，配置变化不频繁）
    clearCache('BANNERS');
    clearCache('COLLECTIONS');
    clearCache('NEW_ARRIVALS');
    
    // 重新初始化
    this.setData({ loading: true, loadingConfig: true });
    this.initData().finally(() => {
      this.refreshNewArrivalsList();
      wx.stopPullDownRefresh();
    });
  },

  // 🟢 核心交互：点击灵动球 -> 展开下方轨道 / 服务入口跳转
  onOrbClick(e) {
    const id = e.currentTarget.dataset.id;
    const orbType = e.currentTarget.dataset.type || 'category';

    if (orbType === 'service') {
      wx.vibrateShort({ type: 'light' });
      if (this.data.orbExpanded) {
        this.setData({ orbExpanded: false, currentOrbId: '' });
      }
      this.handleServiceOrb(e.currentTarget.dataset.action);
      return;
    }

    // 如果点击当前已展开的球 -> 收起
    if (id === this.data.currentOrbId && this.data.orbExpanded) {
        this.setData({ orbExpanded: false, currentOrbId: '' });
        return;
    }

    wx.vibrateShort({ type: 'light' });
    this.setData({ 
      currentOrbId: id,
      orbExpanded: true, 
      orbProducts: [], 
      orbLoading: true
    });

    setTimeout(() => { this.loadOrbData(id); }, 200);
  },

  async loadOrbData(categoryId) {
    const map = { 'insect': '昆虫', 'plant': '植物', 'mineral': '矿', 'marine': '海' };
    const keyword = map[categoryId] || '';
    
    try {
      const res = await db.collection('products')
        .where(_.or([
           { category: db.RegExp({ regexp: keyword, options: 'i' }) },
           { title: db.RegExp({ regexp: keyword, options: 'i' }) }
        ]))
        .where({ isOffShelf: false })
        .limit(6)
        .get();
        
      let list = [];
      if (res.data.length > 0) {
          list = res.data.map(item => ({
              ...item,
              image: getFirstImage(item.images)
          }));
      } else {
          // 兜底数据
          const mockImg = {
              'insect': 'https://images.unsplash.com/photo-1583212292454-1fe6229603b7?q=80&w=300',
              'plant': 'https://images.unsplash.com/photo-1463936575829-25148e1db1b8?q=80&w=300',
              'mineral': 'https://images.unsplash.com/photo-1611263995786-d1f5370c0840?q=80&w=300',
              'marine': 'https://images.unsplash.com/photo-1546500840-ae38253aba9b?q=80&w=300'
          };
          list = [
              { _id: 'm1', title: keyword + '精选标本 A', price: 299, image: mockImg[categoryId], latinName: 'Specimen A' },
              { _id: 'm2', title: keyword + '精选标本 B', price: 499, image: mockImg[categoryId], latinName: 'Specimen B' },
              { _id: 'm3', title: keyword + '精选标本 C', price: 699, image: mockImg[categoryId], latinName: 'Specimen C' }
          ];
      }
      this.setData({ orbProducts: list, orbLoading: false });
    } catch(e) {
      console.error(e);
      this.setData({ orbLoading: false });
    }
  },

  handleServiceOrb(action) {
    switch (action) {
      case 'identify':
        trackBehavior('identify_entry_click', 'identification', 'home_orb', { source: 'home_orb' });
        wx.navigateTo({ url: '/pages/identify/index?from=home_orb' });
        break;
      case 'atelier':
        trackBehavior('atelier_entry_click', 'custom', 'home_orb', { source: 'home_orb' });
        this.goToCustom();
        break;
      case 'care':
        trackBehavior('care_entry_click', 'care', 'home_orb', { source: 'home_orb' });
        this.goToCare();
        break;
      case 'community':
        trackBehavior('community_entry_click', 'community', 'home_orb', { source: 'home_orb' });
        this.goToCommunity();
        break;
      default:
        break;
    }
  },

  goToCategory(e) {
      wx.switchTab({ url: '/pages/category/index' });
  },

  goToIdentify() {
    trackBehavior('identify_entry_click', 'identification', 'explore_quick', { source: 'explore_quick' });
    wx.navigateTo({ url: '/pages/identify/index?from=explore_quick' });
  },

  goToAtlas() {
    wx.navigateTo({ url: '/pages/collection/index' });
  },

  onQuickEntry(e) {
    const action = e.currentTarget.dataset.action;
    if (action === 'identify') this.goToIdentify();
    else if (action === 'gallery') this.goToCategory();
    else if (action === 'atelier') this.goToCustom();
    else if (action === 'atlas') this.goToAtlas();
  },

  goToCustom() {
    wx.navigateTo({ url: '/pages/custom/hub/index?from=home' });
  },

  goToCare() {
    wx.navigateTo({ url: '/pages/care/index?from=home_orb' });
  },

  goToCommunity() {
    wx.navigateTo({ url: '/pages/community/index?from=home_orb' });
  },

  // --- 基础数据 ---
  async loadBanners(config = {}) {
    try {
      // 先尝试从缓存获取
      const cached = getCache('BANNERS');
      if (cached) {
        this.setData({ banners: cached, loadingBanners: false });
        // 后台更新缓存
        this.updateBannersCache();
        return;
      }

      const res = await db.collection('banners').orderBy('sort', 'desc').get();
      const banners = res.data.length > 0 
        ? res.data 
        : [{ id: 1, image: 'cloud://cloud1-8gnkty5bfff9f0bf.636c-cloud1-8gnkty5bfff9f0bf-1387508856/banners/chris-nguyen-tXmc2mVDxJc-unsplash.jpg', title: '蓝色闪蝶特展', subtitle: 'BLUE MORPHO' }];
      
      // 更新缓存
      setCache('BANNERS', banners);
      this.setData({ banners, loadingBanners: false });
    } catch(e) {
      console.error('加载轮播图失败', e);
      this.setData({ loadingBanners: false });
    }
  },

  // 后台更新轮播图缓存
  async updateBannersCache() {
    try {
      const res = await db.collection('banners').orderBy('sort', 'desc').get();
      const banners = res.data.length > 0 ? res.data : [];
      setCache('BANNERS', banners);
    } catch(e) {
      console.warn('更新轮播图缓存失败', e);
    }
  },

  async loadCategories(config = {}) {
    try {
      const limit = config.limit || 4;
      const cats = [
        { _id: 'insect', displayName: '神奇昆虫', enName: 'INSECTA', icon: '🦋' },
        { _id: 'mineral', displayName: '群山回响', enName: 'MINERALS', icon: '💎' },
        { _id: 'plant', displayName: '植物探微', enName: 'PLANTAE', icon: '🌿' },
        { _id: 'marine', displayName: '无尽海洋', enName: 'MARINE', icon: '🐚' }
      ].slice(0, limit);
      this.setData({ categories: cats, loadingCategories: false });
    } catch(e) {
      console.error('加载分类失败', e);
      this.setData({ loadingCategories: false });
    }
  },

  async loadFramers(config = {}) {
    try {
      const limit = config.limit || 6;
      const res = await db.collection('framers').limit(limit).get();
      const framers = res.data.length > 0 
        ? res.data 
        : [{ _id: 'f1', name: '林深', title: '首席标本师', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=200', type: 'store' }];
      this.setData({ framers, loadingFramers: false });
    } catch(e) {
      console.error('加载名师手作失败', e);
      this.setData({ loadingFramers: false });
    }
  },

  async loadActivities(config = {}) {
    try {
      const limit = config.limit || 5;
      const status = config.status || 'open';
      const res = await db.collection('activities').where({ status }).limit(limit).get();
      const formatData = (list) => list.map(item => {
           const d = new Date(item.date);
           const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
           return { 
               ...item, 
               dateStr: item.date.slice(5), 
               cover: item.image,
               day: d.getDate(),
               month: months[d.getMonth()]
           };
      });

      const activities = res.data.length > 0
        ? formatData(res.data)
        : formatData([
            { _id: 'mock1', title: '甲虫标本制作·初级课', date: '2025-12-20', location: '长春·这有山', image: 'https://images.unsplash.com/photo-1583212292454-1fe6229603b7?q=80&w=400', status:'open', price: 198 }
          ]);
      this.setData({ activities, loadingActivities: false });
    } catch(e) {
      console.error('加载活动失败', e);
      this.setData({ loadingActivities: false });
    }
  },

  async loadCollections() {
    try {
      // 先尝试从缓存获取
      const cached = getCache('COLLECTIONS');
      if (cached) {
        this.setData({ collections: cached, loadingCollections: false });
        // 后台更新缓存
        this.updateCollectionsCache();
        return;
      }

      console.log('开始加载专题展览数据');
      const res = await wx.cloud.callFunction({ 
        name: 'getWikiData', 
        data: { action: 'get_exhibitions' } 
      });
      
      console.log('云函数返回结果:', res.result);
      
      if (res.result && res.result.success) {
        const data = res.result.data || [];
        console.log('获取到数据量:', data.length);
        
        if (data.length > 0) {
          // 处理数据：确保字段映射正确，优先使用 cover 字段
          const collections = data.map(item => {
            // 处理图片：优先使用 cover，其次 coverImage
            let cover = item.cover || item.coverImage || '';
            
            const formatted = {
              _id: item._id,
              title: item.title || '专题展览',
              cover: cover,
              brief: item.brief || item.description || '点击查看详情'
            };
            
            return formatted;
          });
          
          // 更新缓存
          setCache('COLLECTIONS', collections);
          this.setData({ collections, loadingCollections: false });
        } else {
          console.warn('数据为空数组');
          this.setData({ collections: [], loadingCollections: false });
        }
      } else {
        console.warn('云函数返回失败:', res.result);
        this.setData({ collections: [], loadingCollections: false });
      }
    } catch(e) {
      console.error('加载专题展览失败', e);
      this.setData({ collections: [], loadingCollections: false });
    }
  },

  // 后台更新专题展览缓存
  async updateCollectionsCache() {
    try {
      const res = await wx.cloud.callFunction({ 
        name: 'getWikiData', 
        data: { action: 'get_exhibitions' } 
      });
      
      if (res.result && res.result.success && res.result.data) {
        const collections = res.result.data.map(item => ({
          _id: item._id,
          title: item.title || '专题展览',
          cover: item.cover || item.coverImage || '',
          brief: item.brief || item.description || '点击查看详情'
        }));
        setCache('COLLECTIONS', collections);
      }
    } catch(e) {
      console.warn('更新专题展览缓存失败', e);
    }
  },

  async loadNewArrivals(config = {}) {
    try {
      const limit = config.limit || 10;
      // 先尝试从缓存获取
      const cached = getCache('NEW_ARRIVALS');
      if (cached) {
        this.setData({ newArrivals: cached.slice(0, limit), loadingNewArrivals: false });
        // 后台更新缓存
        this.updateNewArrivalsCache(config);
        return;
      }

      const res = await db.collection('products').where({ isOffShelf: false }).orderBy('createTime', 'desc').limit(limit).get();
      if(res.data.length > 0) {
        const list = await Promise.all(res.data.map(async item => {
             let img = getFirstImage(item.images);
             if(img && img.startsWith('cloud')) {
                const urlRes = await wx.cloud.getTempFileURL({ fileList: [img] });
                img = urlRes.fileList[0].tempFileURL;
             }
             return { ...item, httpImage: img, isNew: true };
        }));
        
        // 更新缓存
        setCache('NEW_ARRIVALS', list);
        this.setData({ newArrivals: list, loadingNewArrivals: false });
      } else {
        this.setData({ loadingNewArrivals: false });
      }
    } catch(e) {
      console.error('加载新品失败', e);
      this.setData({ loadingNewArrivals: false });
    }
  },

  // 后台更新新品缓存
  async updateNewArrivalsCache() {
    try {
      const res = await db.collection('products').where({ isOffShelf: false }).orderBy('createTime', 'desc').limit(10).get();
      if(res.data.length > 0) {
        const list = await Promise.all(res.data.map(async item => {
             let img = getFirstImage(item.images);
             if(img && img.startsWith('cloud')) {
                const urlRes = await wx.cloud.getTempFileURL({ fileList: [img] });
                img = urlRes.fileList[0].tempFileURL;
             }
             return { ...item, httpImage: img, isNew: true };
        }));
        setCache('NEW_ARRIVALS', list);
      }
    } catch(e) {
      console.warn('更新新品缓存失败', e);
    }
  },

  // 加载推荐内容
  async loadRecommendations(config = {}) {
    try {
      this.setData({ loadingRecommendations: true });

      const userId = app.globalData.openid || '';
      const limit = config.limit || 8;
      const algorithm = config.algorithm || 'mixed';
      
      // 使用重试机制
      const res = await this.loadWithRetry(async () => {
        return await wx.cloud.callFunction({
          name: 'getRecommendations',
          data: {
            userId,
            type: algorithm,
            limit
          }
        });
      });

      if (res.result && res.result.success) {
        const recommendations = (res.result.data || []).map(item => ({
          ...item,
          image: getFirstImage(item.images) || item.httpImage || '',
          reason: item.reason || '为你推荐'
        }));
        
        this.setData({ 
          recommendations, 
          loadingRecommendations: false 
        });
      } else {
        this.setData({ loadingRecommendations: false });
      }
    } catch(e) {
      console.error('加载推荐失败', e);
      // 失败时隐藏推荐模块
      this.setData({ 
        recommendations: [], 
        loadingRecommendations: false 
      });
    }
  },

  handleSearch() { wx.navigateTo({ url: '/pages/search/index' }); },

  async loadExploreStore() {
    this.setData({ loadingExploreStore: true });
    const seed = DEFAULT_STORES.find((s) => s.storeId === DEFAULT_STORE_ID) || DEFAULT_STORES[0];
    let store = enrichStore({ ...seed });
    try {
      const res = await wx.cloud.callFunction({ name: 'getStoreConfig' });
      if (res.result && res.result.stores && res.result.stores.length) {
        const raw = res.result.stores.find((s) => s.storeId === DEFAULT_STORE_ID) || res.result.stores[0];
        if (raw) store = enrichStore({ ...store, ...raw });
      }
    } catch (e) {
      console.warn('loadExploreStore config', e);
    }
    try {
      store = await hydrateStoreMedia(store);
    } catch (e) {
      console.warn('loadExploreStore media', e);
    }
    const finish = (distanceText) => {
      this.setData({
        exploreStore: { ...store, distanceText },
        loadingExploreStore: false
      });
    };
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        const km = haversineKm(res.latitude, res.longitude, store.latitude, store.longitude);
        finish(formatDistance(km));
      },
      fail: () => finish('')
    });
  },

  goToExploreStore() {
    const s = this.data.exploreStore;
    if (!s) return;
    setPreferredStoreId(s.storeId);
    trackBehavior('explore_store_card_click', 'store', s.storeId);
    wx.switchTab({ url: '/pages/store/index' });
  },

  switchTab(e) { wx.switchTab({ url: e.currentTarget.dataset.url }); },
  goToBooking() { wx.switchTab({ url: '/pages/store/index' }); },
  goToCollection(e) { wx.navigateTo({ url: `/pages/detail/wiki-detail?id=${e.currentTarget.dataset.id}` }); },
  goToCollectionDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '数据异常', icon: 'none' });
      return;
    }
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({ 
      url: `/pages/collection-detail/index?id=${id}`,
      fail: (err) => {
        console.error('跳转失败', err);
        // 降级：尝试跳转到wiki-detail
        wx.navigateTo({ url: `/pages/detail/wiki-detail?id=${id}` });
      }
    });
  },
  goToFramer(e) { 
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ 
      url: `/subpackages/business/framer/index?id=${id}`,
      fail: (err) => {
        console.error('跳转标本师页面失败:', err);
        wx.showToast({
          title: '页面加载失败',
          icon: 'none',
          duration: 2000
        });
      }
    }); 
  },
  goToDetail(e) { 
    // ProductCard组件通过事件传递整个info对象，需要从e.detail获取
    // 其他情况（如推荐卡片）通过data-id传递，从dataset获取
    let id = null;
    let productInfo = null;
    
    if (e.detail && e.detail._id) {
      // ProductCard组件传递的对象
      productInfo = e.detail;
      id = e.detail._id;
    } else if (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) {
      // 通过data-id传递的情况
      id = e.currentTarget.dataset.id;
    }
    
    if (!id) {
      console.error('无法获取商品ID', e);
      wx.showToast({ title: '参数错误', icon: 'none' });
      return;
    }
    
    // 记录用户行为（浏览）
    trackBehavior('product_view', 'product', id, {
      category: productInfo?.category,
      tags: productInfo?.tags,
      source: 'explore_list'
    });
    
    wx.navigateTo({ url: `/pages/detail/index?id=${id}` }); 
  },
  onBannerTap(e) {},
  onSwiperChange(e) { this.setData({ currentBannerIndex: e.detail.current }); },

  // 带重试的数据加载
  async loadWithRetry(loadFn, maxRetries = 2) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await loadFn();
      } catch (e) {
        if (i === maxRetries - 1) {
          throw e;
        }
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
});