// pages/index/index.js
const app = getApp();
const db = wx.cloud.database();
const _ = db.command;
const { getFirstImage, batchTempFileURLs } = require('../../utils/util');
const { setCache, getCache, clearCache } = require('../../utils/cache');
const { xingchenCover } = require('../../config/storeMediaCdn');
const { enrichStore, setPreferredStoreId } = require('../../utils/storeHelper');
const { DEFAULT_STORES, DEFAULT_STORE_ID } = require('../../utils/storeDefaults');
const { haversineKm, formatDistance } = require('../../utils/storeGeo');
const { hydrateStoreMedia } = require('../../utils/storeMedia');
const { trackBehavior } = require('../../utils/trackBehavior');
const { cdnPath } = require('../../config/cloudEnv');
const easterEggHost = require('../../utils/easterEggHost');
const easterEgg = require('../../utils/easterEgg');
const { getAuthorizedLocation } = require('../../utils/locationAuth');
const { HOME_ORB_ROOT, collectRootAliases } = require('../../utils/categorySeed');
const { resolveBannerNav, openBannerItem } = require('../../utils/bannerNav');
const { isSinglePageMode, blockIfSinglePage } = require('../../utils/singlePageMode');
const { navigateToProductDetail } = require('../../utils/productDetailNav');
const { todayKey, isActivityExpired } = require('../../utils/activityExpiry');
const FRAMER_RECRUIT_PATH = '/subpackages/business/framer-recruit/index';
/** 库为空时的视觉占位（无跳转），不写死业务 banner */
const EMPTY_BANNER_FALLBACK = {
  id: 'fallback-hero',
  image: cdnPath('banners/chris-nguyen-tXmc2mVDxJc-unsplash.jpg'),
  title: '蓝色闪蝶特展',
  subtitle: 'BLUE MORPHO',
  badge: '精选'
};

/** 直播抢插帧 id（仅前端合并，不入库） */
const LIVE_BANNER_ID = 'live-on-air-hero';
const LIVE_BANNER_COVER = EMPTY_BANNER_FALLBACK.image;

function buildLiveBannerSlide(session) {
  const s = session || {};
  const cover = s.coverUrl || s.cover || s.image || LIVE_BANNER_COVER;
  const hostLine = s.hostName ? `主播 · ${s.hostName}` : '';
  const sub = s.notice || hostLine || '点击进入直播间';
  return {
    id: LIVE_BANNER_ID,
    isLive: true,
    image: cover,
    title: s.title || '馆内直播进行中',
    subtitle: sub,
    badge: '直播中',
    link: (s._id
      ? `/subpackages/content/live/watch/index?sessionId=${encodeURIComponent(s._id)}`
      : '/subpackages/content/live/watch/index'),
    sort: 999999
  };
}

/** 有可拉流场次时插到最前；不影响库内 banner 顺序 */
function mergeBannersWithLive(baseList, liveSession, showLive) {
  const base = (Array.isArray(baseList) ? baseList : []).filter(
    (b) => b && b.id !== LIVE_BANNER_ID && !b.isLive
  );
  if (showLive && liveSession && liveSession.pullUrl) {
    return [buildLiveBannerSlide(liveSession), ...base];
  }
  return base;
}

function stampBannerKey(item, index) {
  if (!item) return item;
  const key = item.id || item._id || `banner-${index}`;
  return { ...item, id: key, _id: item._id || key };
}

function pickBannerImage(item) {
  if (!item) return '';
  return item.image || item.fileID || item.cloudPath || '';
}

/**
 * 仅消费云库/装修配置：过滤关闭项、去重、按 sort 降序、可选 limit。
 * 不在客户端强制插入任何业务 banner。
 */
function normalizeBanners(list, options) {
  const opts = options || {};
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 0;
  const seenIds = new Set();
  const seenPaths = new Set();

  let rows = (Array.isArray(list) ? list : [])
    .filter((item) => item && item.enabled !== false)
    .map((item, index) => {
      const stamped = stampBannerKey(item, index);
      const image = pickBannerImage(stamped);
      const { href } = resolveBannerNav(stamped);
      return {
        ...stamped,
        image,
        link: href || stamped.link || '',
        sort: Number(stamped.sort) || 0
      };
    })
    .filter((item) => {
      if (!item.image) return false;
      const idKey = String(item._id || item.id || '');
      if (idKey && seenIds.has(idKey)) return false;
      const pathKey = String(item.link || item.target || '').split('?')[0];
      if (pathKey && seenPaths.has(pathKey)) return false;
      if (idKey) seenIds.add(idKey);
      if (pathKey) seenPaths.add(pathKey);
      return true;
    })
    .sort((a, b) => (b.sort || 0) - (a.sort || 0));

  if (limit > 0) rows = rows.slice(0, limit);
  return rows;
}

async function hydrateBannerImages(list) {
  const banners = Array.isArray(list) ? list : [];
  const urlMap = await batchTempFileURLs(banners.map((item) => item && item.image));
  return banners.map((item) => {
    const https = item && urlMap[item.image];
    return https ? { ...item, image: https } : item;
  });
}

Page({
  behaviors: [easterEggHost],
  data: {
    navTop: 40,
    isScrolled: false,
    
    // 首页配置
    homeConfig: null,
    moduleOrder: [], // 模块顺序
    
    // 加载状态
    loading: true,
    /** 关键内容全部加载失败时的整页错误态（可重试），区别于"内容为空" */
    pageError: false,
    pageErrorMsg: '',
    loadingBanners: true,
    loadingCategories: true,
    loadingFramers: true,
    loadingActivities: true,
    loadingCollections: true,
    loadingNewArrivals: true,
    loadingConfig: true,
    
    // 灵动球交互
    currentOrbId: '', // 当前选中的球ID
    orbExpanded: false, // 底部面板是否展开
    orbProducts: [], // 展开的商品数据
    orbLoading: false,
    orbLoadingMore: false,
    orbHasMore: false,
    
    banners: [],
    categories: [],
    framers: [],
    activities: [],
    collections: [],
    newArrivals: [],
    currentBannerIndex: 0,
    heroAutoplay: true,
    
    // 模块显示控制（专题展览/近期活动：仅 enabled === true 才展示，缺省关闭）
    showBanners: true,
    showCategories: true,
    showCollections: false,
    showFramers: true,
    showActivities: false,
    showRecommendations: true,
    showNewArrivals: true,

    exploreStore: null,
    showExploreStore: false,
    loadingExploreStore: false,

    atelierHeroImage: xingchenCover,
    workshopStoreName: '工坊',
    showSpecimenCustom: false,
    showPetMemorial: true,
    showLive: false,
    showStore: true,
    /** 祈福墙开关（`showMaShangYou`，缺字段默认关）：首页入口与跑马灯都由它决定 */
    showMaShangYou: false,
    /** 跑马灯文案（**真实**心愿，取自默认墙）；空数组 = 整行不渲染，绝不编造 */
    wishWallWishes: [],
    liveSession: null,
    /** 朋友圈单页模式（scene=1154）：平台预览，不可路由跳转 */
    isSinglePage: false
  },

  onLoad(options) {
    const singlePage = isSinglePageMode(options);
    const { getWindowInfo } = require('../../utils/systemInfo');
    const win = getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    // 单页模式顶部已有微信固定导航，收起自定义胶囊区避免双顶栏
    this.setData({
      isSinglePage: singlePage,
      navTop: singlePage ? 8 : (menu.top || win.statusBarHeight || 40)
    });
    try {
      const app = getApp();
      if (app && app.globalData) app.globalData.isSinglePage = singlePage;
    } catch (e) { /* ignore */ }

    // 先用水合缓存开关，减少首屏闪动；再异步 SWR
    try {
      const { getCachedContentDisplayFlags } = require('../../utils/contentDisplayFlags');
      const cached = getCachedContentDisplayFlags();
      if (cached && cached.flags) {
        const showStore = cached.flags.showStore !== false;
        this.setData({
          showSpecimenCustom: cached.flags.showSpecimenCustom === true,
          showPetMemorial: cached.flags.showPetMemorial !== false,
          showLive: cached.flags.showLive === true,
          showStore,
          showMaShangYou: cached.flags.showMaShangYou === true,
          showExploreStore: showStore && this.data.showExploreStore
        });
        if (cached.flags.showMaShangYou === true) this.loadWishWallMarquee();
      }
    } catch (e) { /* ignore */ }

    // 有首页缓存时跳过整页 loading 盖住旧内容
    try {
      const { getCache } = require('../../utils/cache');
      if (getCache('HOME_CONFIG', { allowStale: true }) || getCache('BANNERS', { allowStale: true })) {
        this.setData({ loading: false, loadingConfig: false });
      }
    } catch (e) { /* ignore */ }

    this.initData();
    this.loadDisplayFlags();
    // 首页首屏请求发完后再预取馆藏首屏（1 次云函数 + 分类树，缓存新鲜则跳过），点「馆藏」秒开
    if (!singlePage) {
      this._categoryPrefetchTimer = setTimeout(() => {
        this._categoryPrefetchTimer = null;
        require('../../utils/categoryFeedCache').prefetchFirstScreen().catch(() => {});
      }, 2500);
    }
  },

  /**
   * 首页祈福墙跑马灯（2026-09-20）：取**默认墙**最近的真实心愿文案。
   *
   * 四条约束：
   *   1. **只取真实心愿**（`manageWishWall` 的 list）。失败/空 → `wishWallWishes: []`，
   *      跑马灯整行不渲染 —— **绝不摆假文案充场面**（本仓硬口径：不许编造社会证明）；
   *   2. **一个页面会话只拉一次**：开关的水合缓存与 SWR 两条路径都会走到这里；
   *   3. **不传 productKey** = 默认墙（`manageWishWall` 用 `normalizeProductKey` 兜底到
   *      DEFAULT_PRODUCT_KEY），所以首页不需要任何商品上下文；
   *   4. 文案/emoji 都走**共享规则**（`utils/wishWall` 的 `normalizeWishText` / `danmakuEmoji`），
   *      首页**不另造一套**。为什么正文也必须归一化：换行与零宽字符在 `.trim()` 之后仍然"非空"，
   *      一条纯零宽的心愿会被当成有效条目凑满条数，跑马灯里就多出一个"看不见字"的假空位。
   */
  async loadWishWallMarquee() {
    if (this._wishWallMarqueeLoaded) return;
    this._wishWallMarqueeLoaded = true;
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageWishWall',
        data: { action: 'list', limit: 12 }
      });
      const list = ((res && res.result) || {}).list;
      const { danmakuEmoji, normalizeWishText } = require('../../utils/wishWall');
      const wishes = (Array.isArray(list) ? list : [])
        .map((r) => ({
          text: normalizeWishText(r && r.text),
          emoji: danmakuEmoji((r && r._id) || '')
        }))
        .filter((w) => w.text);
      this.setData({ wishWallWishes: wishes });
    } catch (e) {
      // 取不到就只是"没有跑马灯"：入口照常可点，降级不影响转化主路径。
      // ⚠️ 但失败**必须可重试**：不清标记的话，一次网络抖动会让本次会话永远没有跑马灯
      //    （开关的水合缓存与 SWR 两条路径都已走过这里，不会再有第三次）。
      this._wishWallMarqueeLoaded = false;
      this.setData({ wishWallWishes: [] });
    }
  },

  /**
   * 让跑马灯在下一次开关判定时**重新拉一次**（下拉刷新 / 错误重试共用）。
   * 没有它，一次成功之后就永远停在旧心愿上 —— 而首页是 tab 页，会话可以很长。
   */
  resetWishWallMarquee() {
    this._wishWallMarqueeLoaded = false;
  },

  async loadDisplayFlags() {
    try {
      const { fetchContentDisplayFlags } = require('../../utils/contentDisplayFlags');
      const apply = (flags) => {
        const showStore = flags.showStore !== false;
        this.setData({
          showSpecimenCustom: flags.showSpecimenCustom === true,
          showPetMemorial: flags.showPetMemorial !== false,
          showLive: flags.showLive === true,
          showStore,
          showMaShangYou: flags.showMaShangYou === true,
          showExploreStore: showStore && this.data.showExploreStore
        });
        if (flags.showMaShangYou === true) this.loadWishWallMarquee();
        return flags.showLive === true;
      };
      const { flags } = await fetchContentDisplayFlags({
        onUpdate: (payload) => {
          if (payload && payload.flags) {
            const live = apply(payload.flags);
            if (live) this.loadActiveLive().catch(() => {});
            else {
              this.setData({ liveSession: null });
              this.applyDisplayBanners();
            }
          }
        }
      });
      if (apply(flags)) {
        await this.loadActiveLive();
      } else {
        this.setData({ liveSession: null });
        this.applyDisplayBanners();
      }
    } catch (e) {
      this.setData({ showSpecimenCustom: false, showPetMemorial: true, showLive: false, showStore: true, liveSession: null });
      this.applyDisplayBanners();
    }
  },

  /** 将 baseBanners 与直播抢插帧合并为展示用 banners（不写库） */
  async applyDisplayBanners() {
    const base = this.data.baseBanners && this.data.baseBanners.length
      ? this.data.baseBanners
      : [];
    let live = this.data.liveSession;
    if (live && live.coverUrl && /^cloud:\/\//i.test(String(live.coverUrl))) {
      try {
        const urlMap = await batchTempFileURLs([live.coverUrl]);
        const https = urlMap[live.coverUrl];
        if (https) live = { ...live, coverUrl: https };
      } catch (e) { /* keep cloud id / fallback */ }
    }
    const merged = mergeBannersWithLive(base, live, this.data.showLive);
    const patch = { banners: merged };
    if (live && live !== this.data.liveSession) {
      patch.liveSession = live;
    }
    // 直播抢插出现时回到第一帧，保证用户立刻看到
    if (merged[0] && merged[0].isLive) {
      patch.currentBannerIndex = 0;
    }
    this.setData(patch);
  },

  async setBaseBanners(list) {
    const rows = Array.isArray(list) ? list : [];
    this.setData({ baseBanners: rows, loadingBanners: false });
    this.applyDisplayBanners();
  },

  async loadActiveLive() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'getActive' }
      });
      const result = (res && res.result) || {};
      if (result.enabled === false) {
        this.setData({ liveSession: null, showLive: false });
        this.applyDisplayBanners();
        return;
      }
      const session = result.session || null;
      if (session && session.pushUrl) delete session.pushUrl;
      const usable = session && session.pullUrl && session.status === 'live' ? session : null;
      this.setData({
        showLive: true,
        liveSession: usable
      });
      this.applyDisplayBanners();
    } catch (e) {
      this.setData({ liveSession: null });
      this.applyDisplayBanners();
    }
  },

  goToLiveWatch() {
    if (blockIfSinglePage()) return;
    if (!this.data.showLive) {
      const { toastLiveClosed } = require('../../utils/contentDisplayFlags');
      toastLiveClosed();
      return;
    }
    if (!this.data.liveSession || !this.data.liveSession.pullUrl) {
      wx.showToast({ title: '此刻没有直播', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/subpackages/content/live/watch/index',
      fail: () => wx.showToast({ title: '直播页暂不可用', icon: 'none' })
    });
  },

  onShow() {
    if (this.data.isSinglePage) {
      // 单页模式不渲染 tabBar；避免误触 getTabBar
    } else if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    if (!this.data.heroAutoplay) this.setData({ heroAutoplay: true });
    if (this.data.showLive) this.loadActiveLive();
    wx.nextTick(() => this._setupFeedScrollGuard());
  },

  onHide() {
    if (this.data.heroAutoplay) this.setData({ heroAutoplay: false });
    this._teardownFeedScrollGuard();
  },

  onUnload() {
    this._teardownFeedScrollGuard();
    if (this._categoryPrefetchTimer) clearTimeout(this._categoryPrefetchTimer);
  },

  refreshNewArrivalsList() {
    const list = this.selectComponent('#newArrivalsList');
    if (list && typeof list.reload === 'function') {
      list.reload();
    }
  },

  _getNewArrivalsList() {
    return this.selectComponent('#newArrivalsList');
  },

  _setNewArrivalsPaused(paused) {
    const list = this._getNewArrivalsList();
    if (list && typeof list.setFeedPaused === 'function') {
      list.setFeedPaused(!!paused);
    }
  },

  /** 下方模块进入视口中部 → 暂停商品流；回到流内可恢复 */
  _setupFeedScrollGuard() {
    if (!this.data.showNewArrivals) {
      this._setNewArrivalsPaused(false);
      return;
    }
    this._teardownFeedScrollGuard();
    try {
      const { getWindowInfo } = require('../../utils/systemInfo');
      const win = getWindowInfo();
      this._feedGuardViewportH = win.windowHeight || 667;

      this._belowFeedObserver = this.createIntersectionObserver({
        thresholds: [0, 0.01, 0.1, 0.25, 0.5],
        observeAll: false
      });
      this._belowFeedObserver
        .relativeToViewport({ top: 0, bottom: 0 })
        .observe('.home-below-feed-anchor', (res) => {
          if (!res) return;
          const vh = this._feedGuardViewportH || 667;
          const top = res.boundingClientRect ? res.boundingClientRect.top : vh;
          // 锚点已进入视口上半区：用户意图在下方模块，停止继续分页
          const shouldPause = res.intersectionRatio > 0 && top < vh * 0.55;
          this._belowFeedActive = shouldPause;
          this._setNewArrivalsPaused(shouldPause || !!this._fastScrollPaused);
        });
    } catch (e) {
      console.warn('home feed scroll guard', e);
    }
  },

  _teardownFeedScrollGuard() {
    if (this._belowFeedObserver) {
      try { this._belowFeedObserver.disconnect(); } catch (e) { /* ignore */ }
      this._belowFeedObserver = null;
    }
    if (this._fastScrollTimer) {
      clearTimeout(this._fastScrollTimer);
      this._fastScrollTimer = null;
    }
    if (this._feedRectThrottle) {
      clearTimeout(this._feedRectThrottle);
      this._feedRectThrottle = null;
    }
    this._fastScrollPaused = false;
  },

  /** scroll-view 内 IO 偶发不准时，用锚点位置兜底同步暂停态 */
  _syncFeedPauseByAnchorRect() {
    if (this._feedRectQuerying || !this.data.showNewArrivals) return;
    this._feedRectQuerying = true;
    try {
      this.createSelectorQuery()
        .select('.home-below-feed-anchor')
        .boundingClientRect()
        .exec((rects) => {
          this._feedRectQuerying = false;
          const rect = rects && rects[0];
          if (!rect) return;
          const vh = this._feedGuardViewportH || 667;
          // 已越过流底进入下方：锚点顶部进入视口中部以上，或已滚过锚点
          const shouldPause = rect.top < vh * 0.55;
          this._belowFeedActive = shouldPause;
          this._setNewArrivalsPaused(shouldPause || !!this._fastScrollPaused);
        });
    } catch (e) {
      this._feedRectQuerying = false;
    }
  },

  onReachBottom() {
    const list = this._getNewArrivalsList();
    if (!list || typeof list.loadMore !== 'function') return;
    if (typeof list.isFeedPaused === 'function' && list.isFeedPaused()) return;
    list.loadMore({ reason: 'reachbottom' });
  },

  onPageScroll(e) {
    const scrollTop = (e && e.detail && e.detail.scrollTop != null)
      ? e.detail.scrollTop
      : ((e && e.scrollTop) || 0);
    const scrolled = scrollTop > 80;
    if (scrolled !== this._scrolled) {
      this._scrolled = scrolled;
      this.setData({ isScrolled: scrolled });
    }

    // 快速下滑时临时暂停，避免哨兵掠过视口连环请求
    const now = Date.now();
    const prevTop = this._lastScrollTop != null ? this._lastScrollTop : scrollTop;
    const prevTs = this._lastScrollTs || now;
    const dt = Math.max(16, now - prevTs);
    const dy = scrollTop - prevTop;
    this._lastScrollTop = scrollTop;
    this._lastScrollTs = now;
    const speed = dy / dt;
    if (speed > 1.2) {
      this._fastScrollPaused = true;
      this._setNewArrivalsPaused(true);
      if (this._fastScrollTimer) clearTimeout(this._fastScrollTimer);
      this._fastScrollTimer = setTimeout(() => {
        this._fastScrollPaused = false;
        this._fastScrollTimer = null;
        // 快滑结束后按下方锚点状态恢复（仍在下方则保持暂停）
        this._setNewArrivalsPaused(!!this._belowFeedActive);
      }, 320);
    }

    // 节流：用锚点位置同步暂停（兼容 scroll-view）
    if (!this._feedRectThrottle) {
      this._feedRectThrottle = setTimeout(() => {
        this._feedRectThrottle = null;
        this._syncFeedPauseByAnchorRect();
      }, 80);
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
      const criticalModules = enabledModules.filter(m => ['banners', 'categories', 'recommendations'].includes(m.id));
      if (criticalModules.length > 0) {
        // 逐模块捕获：单个模块失败不应拖垮整页，但**全部失败**说明是网络/服务问题，
        // 必须给出可重试的错误态，而不是留一个空白首页（原实现只 console.error）。
        const results = await Promise.all(
          criticalModules.map(m =>
            Promise.resolve()
              .then(() => this.loadModuleData(m.id))
              .then(() => true)
              .catch(err => {
                console.error(`加载关键模块失败(${m.id}):`, err);
                return false
              })
          )
        );
        if (!results.some(Boolean)) {
          this.setData({
            pageError: true,
            pageErrorMsg: '首页内容加载失败，请检查网络后重试',
          });
        } else {
          this.setData({ pageError: false, pageErrorMsg: '' });
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
      // 首页配置都拿不到时，页面基本是空的：给出错误态与重试
      this.setData({
        loading: false,
        loadingConfig: false,
        pageError: true,
        pageErrorMsg: '首页加载失败，请检查网络后重试',
      });
    } finally {
      this._initializing = false;
      wx.nextTick(() => this._setupFeedScrollGuard());
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
      const cached = getCache('HOME_CONFIG', { allowStale: true });
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
        const defaultVisibility = this.computeModuleVisibility([]);
        const defaultOrder = this.getModuleOrder([]);
        
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
      const defaultVisibility = this.computeModuleVisibility([]);
      const defaultOrder = this.getModuleOrder([]);
      
      this.setData({ 
        homeConfig: [],
        moduleOrder: defaultOrder,
        ...defaultVisibility,
        loadingConfig: false
      });
      
      this._configLoaded = true;
    }
  },

  // 后台更新配置缓存，并同步刷新可见性（避免 Admin 关闭后仍被旧缓存展示）
  async updateHomeConfigCache() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getHomeConfig'
      });
      if (res.result && res.result.success && res.result.data) {
        const config = res.result.data;
        setCache('HOME_CONFIG', config, 24 * 60 * 60 * 1000);

        const prevShowCollections = this.data.showCollections;
        const prevShowActivities = this.data.showActivities;
        const moduleOrder = this.getModuleOrder(config);
        const visibility = this.computeModuleVisibility(config);

        this.setData({
          homeConfig: config,
          moduleOrder,
          ...visibility
        });

        // 开关由关→开时补拉数据；关→关/开→关仅依赖 wx:if 隐藏
        if (visibility.showCollections && !prevShowCollections) {
          this.loadModuleData('collections').catch(() => {});
        }
        if (visibility.showActivities && !prevShowActivities) {
          this.loadModuleData('activities').catch(() => {});
        }
        if (!visibility.showCollections && this.data.collections && this.data.collections.length) {
          this.setData({ collections: [] });
        }
        if (!visibility.showActivities && this.data.activities && this.data.activities.length) {
          this.setData({ activities: [] });
        }
      }
    } catch (e) {
      console.warn('更新配置缓存失败:', e);
    }
  },

  // 需显式开启的模块（与标本档案/山海社区同严格度：仅 === true）
  isOptInModule(id) {
    return id === 'collections' || id === 'activities' || id === 'exploreStore';
  },

  isModuleEnabled(m) {
    if (!m) return false;
    if (this.isOptInModule(m.id)) return m.enabled === true;
    return m.enabled !== false;
  },

  // 获取启用的模块
  getEnabledModules() {
    const modules = (!this.data.homeConfig || this.data.homeConfig.length === 0)
      ? this.getDefaultModules()
      : this.data.homeConfig;
    return modules
      .filter(m => this.isModuleEnabled(m))
      .sort((a, b) => (a.order || 999) - (b.order || 999));
  },

  // 计算模块显示状态（重写：返回对象，不直接setData）
  computeModuleVisibility(config) {
    if (!config || config.length === 0) {
      return {
        showBanners: true,
        showCategories: true,
        showCollections: false,
        showFramers: true,
        showActivities: false,
        showRecommendations: true,
        showNewArrivals: true,
        showExploreStore: false
      };
    }

    const configMap = {};
    config.forEach(m => {
      configMap[m.id] = m.enabled;
    });

    return {
      showBanners: configMap.banners !== false,
      showCategories: configMap.categories !== false,
      // 专题展览 / 近期活动：仅 enabled === true 才展示（缺省关闭）
      showCollections: configMap.collections === true,
      showFramers: configMap.framers !== false,
      showActivities: configMap.activities === true,
      showRecommendations: configMap.recommendations !== false,
      showNewArrivals: configMap.newArrivals !== false,
      // 首页「走进这有店」模块还须内容开关 showStore
      showExploreStore: configMap.exploreStore === true && this.data.showStore !== false
    };
  },

  // 获取模块顺序
  getModuleOrder(config) {
    if (!config || config.length === 0) {
      return this.getDefaultModuleOrder().filter(id => {
        if (this.isOptInModule(id)) return false;
        return true;
      });
    }
    return config
      .filter(m => this.isModuleEnabled(m))
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

  // 获取默认模块配置（专题展览/近期活动缺省关闭，需 Admin 显式开启）
  getDefaultModules() {
    return [
      { id: 'banners', enabled: true, order: 1 },
      { id: 'categories', enabled: true, order: 2 },
      { id: 'recommendations', enabled: true, order: 3 },
      { id: 'newArrivals', enabled: true, order: 4 },
      { id: 'atelier', enabled: true, order: 5 },
      { id: 'exploreStore', enabled: false, order: 6 },
      { id: 'collections', enabled: false, order: 7 },
      { id: 'framers', enabled: true, order: 8 },
      { id: 'activities', enabled: false, order: 9 }
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
    this.resetWishWallMarquee();
    
    // 清除数据与首页配置缓存，确保 Admin 开关变更可立即生效
    clearCache('HOME_CONFIG');
    clearCache('BANNERS');
    clearCache('COLLECTIONS');
    clearCache('NEW_ARRIVALS');
    try {
      const { invalidateContentDisplayFlags } = require('../../utils/contentDisplayFlags');
      invalidateContentDisplayFlags();
    } catch (e) { /* ignore */ }
    
    // 重新初始化
    this.setData({ loading: true, loadingConfig: true });
    this.initData().finally(() => {
      this.refreshNewArrivalsList();
      this.loadDisplayFlags();
      wx.stopPullDownRefresh();
    });
  },

  // 错误态「重试」：复用下拉刷新的重置逻辑（清缓存 + 解锁 + 重新初始化）
  onRetryLoad() {
    if (this.data.loading) return;
    this.setData({ pageError: false, pageErrorMsg: '', loading: true, loadingConfig: true });
    // 与 onPullDownRefresh 保持一致的重置集合，避免命中旧的失败缓存
    this._initializing = false;
    this._configLoaded = false;
    this.resetWishWallMarquee();
    clearCache('HOME_CONFIG');
    clearCache('BANNERS');
    clearCache('COLLECTIONS');
    clearCache('NEW_ARRIVALS');
    try {
      const { invalidateContentDisplayFlags } = require('../../utils/contentDisplayFlags');
      invalidateContentDisplayFlags();
    } catch (e) { /* ignore */ }
    this.initData().finally(() => {
      this.refreshNewArrivalsList();
      this.loadDisplayFlags();
    });
  },

  // 点击品类灵动球 -> 展开下方轨道
  onOrbClick(e) {
    const id = e.currentTarget.dataset.id;

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
    this.loadOrbData(id);
  },

  async loadOrbData(categoryId, reset = true) {
    // 按一级馆 rootCategoryId / rootCategoryName 精确匹配（Admin 写入的 category 多为二级名，不能用「动物/海」短词正则）
    const rootName = HOME_ORB_ROOT[categoryId] || '';
    const aliases = rootName ? collectRootAliases(rootName) : [];

    if (!aliases.length) {
      this._orbHasMore = false;
      this._orbLoading = false;
      this.setData({ orbProducts: [], orbLoading: false });
      return;
    }

    if (reset) {
      this._orbSkip = 0;
      this._orbHasMore = true;
      this._orbCategoryId = categoryId;
      this._orbGen = (this._orbGen || 0) + 1;
      this._orbLoading = false;
    }

    if (!this._orbHasMore && !reset) return;
    if (this._orbLoading) return;

    this._orbLoading = true;
    const gen = this._orbGen || 0;
    const skip = this._orbSkip || 0;
    const pageSize = 6;
    const isAppend = !reset && skip > 0;

    try {
      if (isAppend) {
        this.setData({ orbLoadingMore: true });
      }

      // 解析规范一级馆 _id（缓存），与名称别名并用
      if (!this._orbRootIdCache) this._orbRootIdCache = {};
      let rootDocId = this._orbRootIdCache[rootName];
      if (rootDocId === undefined) {
        try {
          const rootRes = await db.collection('categories')
            .where({ level: 1, name: rootName })
            .limit(1)
            .get();
          rootDocId = (rootRes.data && rootRes.data[0] && rootRes.data[0]._id) || '';
        } catch (e) {
          rootDocId = '';
        }
        this._orbRootIdCache[rootName] = rootDocId;
      }

      const orConds = [
        { rootCategoryName: _.in(aliases) },
        { category: _.in(aliases) }
      ];
      if (rootDocId) orConds.unshift({ rootCategoryId: rootDocId });

      const res = await db.collection('products')
        .where(_.and([
          { isOffShelf: _.neq(true) },
          _.or(orConds)
        ]))
        .skip(skip)
        .limit(pageSize)
        .get();

      if (gen !== (this._orbGen || 0)) return;

      let batch = [];
      if (res.data && res.data.length > 0) {
          const imgs = res.data.map((item) => getFirstImage(item.images));
          const urlMap = await batchTempFileURLs(imgs);
          if (gen !== (this._orbGen || 0)) return;
          batch = res.data.map((item, i) => {
            const img = imgs[i];
            const origin = (img && urlMap[img]) || img || '';
            return {
              ...item,
              uniqueId: item._id,
              // 需求 17：首页横滑卡用缩略图（能力未确认时返回原图）。
              // 2026-09-18 分档：横滑卡实测 220rpx=110pt → 3 倍屏只需 330px，用 rail 档（原 480 属过采样）
              image: origin ? require('../../utils/imageUrl').railUrl(origin) : origin,
              // 「珍稀」角标只认人工打标字段，不随排序/分类变化
              productRarity: (item.productRarity === 'rare' || item.productRarity === 'legendary')
                ? item.productRarity
                : 'common',
              // 需求 11：首页横滑卡此前封面直出
              sensitiveEnabled: require('../../utils/sensitiveBlurCard').sensitiveEnabledOf(item)
            };
          });
      }

      this._orbSkip = skip + batch.length;
      this._orbHasMore = batch.length >= pageSize;
      const prev = isAppend ? (this.data.orbProducts || []) : [];
      const seen = new Set(prev.map((p) => (p && p._id != null ? String(p._id) : '')).filter(Boolean));
      const merged = prev.slice();
      batch.forEach((item) => {
        const key = item && item._id != null ? String(item._id) : '';
        if (key) {
          if (seen.has(key)) return;
          seen.add(key);
        }
        merged.push(item);
      });
      this.setData({
        orbProducts: merged,
        orbLoading: false,
        orbLoadingMore: false,
        orbHasMore: this._orbHasMore
      });
    } catch(e) {
      console.error(e);
      if (gen !== (this._orbGen || 0)) return;
      this.setData({ orbLoading: false, orbLoadingMore: false, orbProducts: isAppend ? this.data.orbProducts : [] });
      if (!isAppend) wx.showToast({ title: '藏品加载失败', icon: 'none' });
    } finally {
      if (gen === (this._orbGen || 0)) this._orbLoading = false;
    }
  },

  loadMoreOrbData() {
    if (this._orbLoading || this.data.orbLoading || this.data.orbLoadingMore || !this._orbHasMore) return;
    const id = this._orbCategoryId || this.data.currentOrbId;
    if (!id) return;
    this.loadOrbData(id, false);
  },

  goToCategory(e) {
      if (blockIfSinglePage()) return;
      const orbId = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id)
        || this.data.currentOrbId
        || '';
      // 与一级馆名对齐，供馆藏页 autoSwitchToName 使用
      const target = HOME_ORB_ROOT[orbId];
      if (target) {
        getApp().globalData.targetCategory = target;
      }
      wx.switchTab({ url: '/pages/category/index' });
  },

  goToCustom() {
    if (blockIfSinglePage()) return;
    wx.switchTab({
      url: '/pages/atelier/index',
      fail: () => wx.showToast({ title: '无法打开定制', icon: 'none' })
    });
  },

  goToFramerRecruit() {
    if (blockIfSinglePage()) return;
    trackBehavior('framer_recruit_entry', 'from', 'home_rail');
    wx.navigateTo({
      url: `${FRAMER_RECRUIT_PATH}?from=home`,
      fail: (err) => {
        console.error('goToFramerRecruit failed', err);
        wx.showToast({ title: '无法打开招募说明', icon: 'none' });
      }
    });
  },

  // --- 基础数据 ---
  async loadBanners(config = {}) {
    const limit = config.limit;
    try {
      const cached = getCache('BANNERS', { allowStale: true });
      if (cached) {
        const normalized = normalizeBanners(cached, { limit });
        const hydrated = await hydrateBannerImages(
          normalized.length ? normalized : normalizeBanners([EMPTY_BANNER_FALLBACK])
        );
        await this.setBaseBanners(hydrated);
        this.updateBannersCache(config);
        return;
      }

      const res = await db.collection('banners').orderBy('sort', 'desc').get();
      const raw = (res.data && res.data.length > 0) ? res.data : [];
      setCache('BANNERS', raw);
      const normalized = normalizeBanners(raw, { limit });
      const hydrated = await hydrateBannerImages(
        normalized.length ? normalized : normalizeBanners([EMPTY_BANNER_FALLBACK])
      );
      await this.setBaseBanners(hydrated);
    } catch (e) {
      console.error('加载轮播图失败', e);
      const hydrated = await hydrateBannerImages(normalizeBanners([EMPTY_BANNER_FALLBACK]));
      await this.setBaseBanners(hydrated);
    }
  },

  // 后台更新轮播图缓存
  async updateBannersCache(config = {}) {
    try {
      const res = await db.collection('banners').orderBy('sort', 'desc').get();
      const raw = (res.data && res.data.length > 0) ? res.data : [];
      setCache('BANNERS', raw);
      const normalized = normalizeBanners(raw, { limit: config.limit });
      const hydrated = await hydrateBannerImages(
        normalized.length ? normalized : normalizeBanners([EMPTY_BANNER_FALLBACK])
      );
      await this.setBaseBanners(hydrated);
    } catch (e) {
      console.warn('更新轮播图缓存失败', e);
    }
  },

  async loadCategories(config = {}) {
    try {
      const limit = config.limit || 4;
      const cats = [
        { _id: 'insect', displayName: '蝴蝶昆虫', enName: 'INSECTA', icon: '🦋' },
        { _id: 'animal', displayName: '动物世界', enName: 'ANIMALIA', icon: '🐥' },
        { _id: 'plant', displayName: '植物果实', enName: 'PLANTAE', icon: '🍀' },
        { _id: 'marine', displayName: '海洋标本', enName: 'MARINE', icon: '🦀' }
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
      // Admin 隐藏字段 active:false；与定制云函数一致，公开展示仅 active !== false
      const res = await db.collection('framers')
        .where({ active: _.neq(false) })
        .limit(Math.max(limit * 3, 40))
        .get();
      const visible = (res.data || []).filter((f) => f && f.active !== false);
      // 同一标本师可能多条档案：按 staffOpenid / 姓名去重，保持对外唯一
      const picked = [];
      const seenStaff = Object.create(null);
      const seenName = Object.create(null);
      const sorted = visible.slice().sort((a, b) => {
        const ta = a.createTime ? new Date(a.createTime).getTime() : 0;
        const tb = b.createTime ? new Date(b.createTime).getTime() : 0;
        if (ta && tb && ta !== tb) return ta - tb;
        return String(a._id || '').localeCompare(String(b._id || ''));
      });
      sorted.forEach((f) => {
        const so = String(f.staffOpenid || '').trim();
        const nameKey = String(f.name || '').trim().toLowerCase();
        if (so) {
          if (seenStaff[so]) return;
          seenStaff[so] = true;
          if (nameKey) seenName[nameKey] = true;
          picked.push(f);
          return;
        }
        if (nameKey && seenName[nameKey]) return;
        if (nameKey) seenName[nameKey] = true;
        picked.push(f);
      });
      const framers = picked.length > 0
        ? picked.slice(0, limit)
        : [{ _id: 'f1', name: '林深', title: '首席标本师', avatar: cdnPath('stores/store_shanhaizaowu.png'), type: 'store' }];
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
      const res = await db.collection('activities').where({ status, date: _.gte(todayKey()) }).orderBy('date', 'asc').limit(limit).get();
      res.data = (res.data || []).filter((a) => !isActivityExpired(a));
      const formatData = (list) => list.map(item => {
           const dateStr = item.date ? String(item.date) : '';
           const d = dateStr ? new Date(dateStr) : null;
           const valid = d && !isNaN(d.getTime());
           const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
           return { 
               ...item, 
               dateStr: dateStr.length >= 10 ? dateStr.slice(5) : dateStr, 
               cover: item.image,
               day: valid ? d.getDate() : '--',
               month: valid ? months[d.getMonth()] : ''
           };
      });

      // 空库时展示真实空态（不再用 mock 课程兜底，避免过期假数据被报名）
      const activities = formatData((res.data || []));
      this.setData({ activities, loadingActivities: false });
    } catch(e) {
      console.error('加载活动失败', e);
      this.setData({ loadingActivities: false });
    }
  },

  async loadCollections() {
    try {
      // 先尝试从缓存获取
      const cached = getCache('COLLECTIONS', { allowStale: true });
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

  async loadNewArrivals() {
    // 列表由 product-list 分页加载，避免首页再拉一遍 + N 次换链
    this.setData({ loadingNewArrivals: false });
  },

  updateNewArrivalsCache() {},

  // 为你推荐：<home-reco> 自己取数与处理三态（失败不向上抛 —— 与改前一样不参与整页错误态判定）。
  // 这里只把后台「显示数量」交给它，并在下拉刷新 / 重试时让它重取。
  loadRecommendations(config = {}) {
    const reco = this.selectComponent('#homeReco');
    if (reco) reco.load({ limit: config.limit });
  },

  onRecoMore() {
    if (blockIfSinglePage()) return;
    wx.switchTab({ url: '/pages/category/index' });
  },

  handleSearch() {
    if (easterEgg.shouldIgnoreTap(this)) return;
    if (blockIfSinglePage()) return;
    wx.navigateTo({
      url: '/subpackages/feature/search/index',
      fail: () => wx.showToast({ title: '无法打开搜索', icon: 'none' })
    });
  },

  async loadExploreStore() {
    this.setData({ loadingExploreStore: true });
    const { fetchStoreCatalog, findCatalogStore, findWorkshopStore } = require('../../utils/storeCatalog');
    const { displayStoreName } = require('../../utils/storeName');
    const seed = DEFAULT_STORES.find((s) => s.storeId === DEFAULT_STORE_ID) || DEFAULT_STORES[0];
    let store = enrichStore({ ...seed });
    try {
      const stores = await fetchStoreCatalog();
      const raw = findCatalogStore(DEFAULT_STORE_ID, stores) || stores[0];
      if (raw) store = enrichStore({ ...store, ...raw });
      const workshop = findWorkshopStore(stores);
      if (workshop) this.setData({ workshopStoreName: displayStoreName(workshop) });
    } catch (e) {
      console.warn('loadExploreStore config', e);
    }
    try {
      store = await hydrateStoreMedia(store);
    } catch (e) {
      console.warn('loadExploreStore media', e);
    }
    const finish = (distanceText) => {
      const openStatus = store.openStatus || { statusClass: '', label: '' };
      this.setData({
        exploreStore: { ...store, distanceText, openStatus },
        loadingExploreStore: false
      });
    };
    const loc = await getAuthorizedLocation({ type: 'gcj02' });
    if (!loc) {
      finish('');
      return;
    }
    const km = haversineKm(loc.latitude, loc.longitude, store.latitude, store.longitude);
    finish(formatDistance(km));
  },

  switchTab(e) {
    if (blockIfSinglePage()) return;
    wx.switchTab({ url: e.currentTarget.dataset.url });
  },
  goToBooking() {
    if (blockIfSinglePage()) return;
    if (!this.data.showStore) {
      const { toastStoreClosed } = require('../../utils/contentDisplayFlags');
      toastStoreClosed();
      return;
    }
    wx.navigateTo({ url: '/subpackages/business/store/index' });
  },
  goToCollectionDetail(e) {
    if (blockIfSinglePage()) return;
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '数据异常', icon: 'none' });
      return;
    }
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({ 
      url: `/subpackages/content/collection-detail/index?id=${id}`,
      fail: (err) => {
        console.error('跳转失败', err);
        // 降级：尝试跳转到wiki-detail
        wx.navigateTo({ url: `/subpackages/feature/detail/wiki-detail/index?id=${id}` });
      }
    });
  },
  goToFramer(e) { 
    if (blockIfSinglePage()) return;
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '标本师信息缺失', icon: 'none' });
      return;
    }
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
    if (blockIfSinglePage()) return;
    // ProductList itemtap：e.detail.id / e.detail._id
    // 推荐卡等：data-id
    let id = null;
    let productInfo = null;
    const detail = e && e.detail;
    
    if (detail && (detail._id || detail.id)) {
      productInfo = detail;
      id = detail._id || detail.id;
    } else if (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) {
      id = e.currentTarget.dataset.id;
    }
    
    if (!id) {
      console.error('无法获取商品ID', e);
      wx.showToast({ title: '参数错误', icon: 'none' });
      return;
    }
    id = String(id);
    
    trackBehavior('product_view', 'product', id, {
      category: (productInfo && productInfo.category) || '',
      tags: (productInfo && productInfo.tags) || [],
      source: 'explore_list'
    });
    
    navigateToProductDetail(id, {
      seed: productInfo || { _id: id },
      failToast: '无法打开藏品'
    });
  },
  onBannerTap(e) {
    const dataset = (e.currentTarget && e.currentTarget.dataset) || {};
    const item = dataset.item || {};
    if (item.isLive || item.id === LIVE_BANNER_ID) {
      this.goToLiveWatch();
      return;
    }
    openBannerItem(
      {
        ...item,
        id: dataset.id || item.id || item._id,
        link: dataset.link || item.link || item.url || item.path || ''
      },
      {
        onFramerRecruit: () => trackBehavior('framer_recruit_entry', 'from', 'home_banner')
      }
    );
  },
  onSwiperChange(e) {
    const current = e.detail && e.detail.current;
    if (typeof current !== 'number' || current === this.data.currentBannerIndex) return;
    this.setData({ currentBannerIndex: current });
  },

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
  },

  onShareAppMessage() {
    return {
      title: '山海造物 · 把山海带回家',
      path: '/pages/index/index'
    }
  },

  onShareTimeline() {
    return {
      title: '山海造物 · 把山海带回家'
    }
  }
});