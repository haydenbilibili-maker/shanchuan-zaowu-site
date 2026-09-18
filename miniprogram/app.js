// app.js
require('./utils/analytics/pageHook');
const { CLOUD_ENV } = require('./config/cloudEnv');
const { checkCloudHealth, notifyCloudHealthFailure } = require('./utils/cloudHealth');

// 延迟加载工具，避免初始化时出现问题
let errorMonitor = null;
let analytics = null;
let performanceMonitor = null;

App({
  onLaunch: function () {
    // 延迟初始化监控工具
    try {
      errorMonitor = require('./utils/errorMonitor');
      performanceMonitor = require('./utils/performance');
      analytics = require('./utils/analytics');
      // 性能监控：应用启动时间
      if (performanceMonitor) {
        performanceMonitor.start('app_launch');
      }
    } catch (e) {
      console.warn('监控工具初始化失败:', e);
    }
    // 1. 初始化云开发环境
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        // 环境 ID 见 config/cloudEnv.js（续费/换环境后只需改一处）
        env: CLOUD_ENV,
        traceUser: true,
      });
      // 启动自检：云函数 / 数据库不可达时给出可见提示（避免静默空白）
      checkCloudHealth().then(notifyCloudHealthFailure).catch(() => {});
      // 运费规则：先用水合缓存，再异步拉云端 shipping_rules
      try {
        const { hydrateFromStorage, ensureShippingRules } = require('./utils/shippingRulesSync');
        hydrateFromStorage();
        ensureShippingRules().catch(() => {});
      } catch (e) {
        console.warn('shippingRulesSync init failed:', e);
      }
      // 冷启动并行预取：内容开关 / 门店 / 会话
      try {
        const { prefetchColdStart } = require('./utils/appPrefetch');
        setTimeout(() => {
          prefetchColdStart(this).catch(() => {});
        }, 0);
      } catch (e) {
        console.warn('appPrefetch init failed:', e);
      }
    }

    // 2. 获取系统信息 (适配刘海屏)
    try {
      const { getWindowInfo } = require('./utils/systemInfo');
      const windowInfo = getWindowInfo();
      this.globalData.statusBarHeight = windowInfo.statusBarHeight || 0;
      
      try {
        const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
        if (menuButtonInfo && menuButtonInfo.top) {
          this.globalData.navBarHeight = (menuButtonInfo.top - windowInfo.statusBarHeight) * 2 + menuButtonInfo.height + windowInfo.statusBarHeight;
        } else {
          this.globalData.navBarHeight = windowInfo.statusBarHeight + 44;
        }
      } catch (e) {
        console.warn('获取菜单按钮信息失败:', e);
        this.globalData.navBarHeight = windowInfo.statusBarHeight + 44;
      }
    } catch (e) {
      console.warn('获取系统信息失败:', e);
      this.globalData.statusBarHeight = 0;
      this.globalData.navBarHeight = 44;
    }

    // 3. 字体：不拉取 Google Fonts（提审/弱网外链风险），价格数字回退系统等宽/无衬线体

    // 3.5 窗口底色：尽早刷成博物黑，减轻首屏/切 Tab 白闪
    try {
      require('./utils/museumPageChrome').applyMuseumPageChrome();
    } catch (e) { /* ignore */ }

    // 4. 获取用户 OpenID
    this.getOpenId();

    // 5. 应用启动完成
    setTimeout(() => {
      if (performanceMonitor) {
        const duration = performanceMonitor.end('app_launch');
        console.log(`应用启动耗时: ${duration}ms`);
      }
    }, 100);

    if (analytics) {
      analytics.track('app_launch', 'app', 'launch', { module: 'system' });
    }
  },

  onShow(options) {
    try {
      const { isSinglePageMode } = require('./utils/singlePageMode');
      this.globalData.isSinglePage = isSinglePageMode(options);
    } catch (e) { /* ignore */ }
    this.maybeOpenAtlasSpot(options);
  },

  maybeOpenAtlasSpot(options) {
    const q = (options && options.query) || {};
    let spot = q.spot || q.atlas || '';
    if (!spot && q.scene) {
      try {
        spot = decodeURIComponent(q.scene);
      } catch (e) {
        spot = q.scene;
      }
    }
    if (!spot && options && options.scene) {
      try {
        spot = decodeURIComponent(options.scene);
      } catch (e) {
        spot = options.scene;
      }
    }
    if (spot) {
      try {
        const { parseSpotCode } = require('./config/atlasSpot');
        spot = parseSpotCode(spot) || (/^s[1-9]\d*$/i.test(String(spot)) ? String(spot).toLowerCase() : '');
      } catch (e) {
        spot = '';
      }
    }
    if (!spot) return;
    const key = String(spot).toLowerCase();
    const now = Date.now();
    if (this._atlasSpotKey === key && now - (this._atlasSpotAt || 0) < 4000) return;
    this._atlasSpotKey = key;
    this._atlasSpotAt = now;
    this.globalData.pendingAtlasSpot = key;
    setTimeout(() => {
      wx.navigateTo({
        url: `/subpackages/feature/collection/index?spot=${encodeURIComponent(key)}`
      });
    }, 400);
  },

  onHide() {
    if (analytics) {
      analytics.flush();
    }
  },

  onError(err) {
    // 全局错误捕获
    try {
      if (errorMonitor) {
        errorMonitor.captureError({
          type: 'appError',
          level: 'critical',
          message: err,
          stack: err.stack || err,
          timestamp: Date.now()
        });
      }
    } catch (e) {
      console.error('错误监控失败:', e);
    }
  },

  onPageNotFound(res) {
    // 页面不存在（含主包瘦身后旧 path，如 pages/store → 分包）
    try {
      if (errorMonitor) {
        errorMonitor.captureError({
          type: 'pageNotFound',
          level: 'warning',
          message: `页面不存在: ${res.path}`,
          path: res.path,
          query: res.query,
          timestamp: Date.now()
        });
      }
    } catch (e) {
      console.error('错误监控失败:', e);
    }

    const goHome = () => {
      wx.switchTab({
        url: '/pages/index/index',
        fail: () => wx.reLaunch({ url: '/pages/index/index' })
      });
    };

    try {
      const { normalizeMiniProgramUrl } = require('./utils/messageHelper');
      const path = String((res && res.path) || '').replace(/^\//, '');
      const query = (res && res.query) || {};
      const qs = Object.keys(query)
        .filter((k) => query[k] != null && query[k] !== '')
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(query[k]))}`)
        .join('&');
      const raw = qs ? `${path}?${qs}` : path;
      const mapped = normalizeMiniProgramUrl(raw);
      const bareRaw = `/${path}`.replace(/\/index$/, '');
      const bareMapped = String(mapped || '').split('?')[0].replace(/\/index$/, '');
      // 确为旧 path 重写到新分包时再跳转，避免未知 404 死循环
      if (mapped && bareMapped && bareMapped !== bareRaw && bareMapped.indexOf('/subpackages/') === 0) {
        wx.reLaunch({ url: mapped, fail: goHome });
        return;
      }
    } catch (e) {
      console.warn('onPageNotFound remap failed', e);
    }

    goHome();
  },

  // 获取 OpenID
  getOpenId() {
    try {
      const { isLocalLoggedOut } = require('./utils/userSession');
      if (isLocalLoggedOut()) return;
    } catch (e) { /* ignore */ }

    if (!wx.cloud) {
      console.warn('云开发未初始化，无法获取 OpenID');
      return;
    }
    
    wx.cloud.callFunction({
      name: 'login',
      data: {},
      success: res => {
        try {
          const { isLocalLoggedOut } = require('./utils/userSession');
          if (isLocalLoggedOut()) return;
        } catch (e) { /* ignore */ }
        if (res.result && res.result.openid) {
          console.log('[云函数] [login] user openid: ', res.result.openid);
          this.globalData.openid = res.result.openid;
          try {
            const { refreshCartTabBadge } = require('./utils/cartHelper');
            refreshCartTabBadge(this);
          } catch (e) { /* ignore */ }
        } else {
          console.warn('[云函数] [login] 返回数据异常:', res);
        }
      },
      fail: err => {
        console.error('[云函数] [login] 调用失败', err);
        // 不阻塞应用启动，后续可以重试
      }
    });
  },

  // 全局数据
  globalData: {
    userInfo: null,
    openid: '',
    refreshCart: false,
    cartBadgeCount: 0,
    statusBarHeight: 0,
    navBarHeight: 0,
    pendingAtlasSpot: '',
    /** 首页分类球「查看全部」→ 馆藏页目标一级馆名（如 动物馆） */
    targetCategory: null,
    /** 朋友圈单页模式（scene=1154） */
    isSinglePage: false,
    shippingRules: null,
    shippingRulesLoadedAt: 0,
    shippingRuleText: '',
    userSession: null,
    userSessionLoadedAt: 0,
    forceUserRefresh: false,
    /** 工作台跑马灯/蓝点：读信或审批后强制 revalidate */
    forceWorkbenchBadgeRefresh: false
  }
});

// 手写体（网络字体）：iOS 的 WeChat WebView 不暴露中文手写族 → 必须 loadFontFace 注册自定义族名
// （见 utils/handFont.js；失败不抛错，页面按系统兜底字体渲染）
try {
  require('./utils/handFont').ensureHandFont()
} catch (e) {
  console.warn('[handFont] bootstrap failed', e)
}
