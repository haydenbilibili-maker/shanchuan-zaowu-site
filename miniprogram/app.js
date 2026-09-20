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
      // 手写体（网络字体）：必须在 cloud.init **之后**加载（downloadFile 依赖 cloud 初始化）
      // iOS 的 WeChat WebView 不暴露中文手写族 → 只能走 loadFontFace（见 utils/handFont.js）
      this.ensureHandFontWithRetry()
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
      // 装裱方式 / 制作工艺的**选项字典**：同一套「缓存先覆盖 → 异步拉云端 → 失败退回代码默认」。
      // 云端没有这份文档**不是异常**（没改过字典的项目本来就该用内置选项），
      // 只有"云函数没部署/读不到"才把 taxonomyCloudReady 置 false（字段维护专区据此禁用保存）。
      try {
        const { hydrateFromStorage: hydrateTaxonomy, ensureProductTaxonomy } = require('./utils/productTaxonomySync');
        hydrateTaxonomy();
        ensureProductTaxonomy().catch(() => {});
      } catch (e) {
        console.warn('productTaxonomySync init failed:', e);
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
      /** 加载手写体（幂等；失败重试一次 —— cloud 初始化可能略滞后） */
      ensureHandFontWithRetry() {
        const { ensureHandFont } = require('./utils/handFont')
        ensureHandFont().then((ok) => {
          if (ok) { console.log('[handFont] loaded'); return }
          setTimeout(() => ensureHandFont().then((again) => console.log('[handFont] retry', again)), 1500)
        }).catch(() => {})
      },

  onShow(options) {
    try {
      const { isSinglePageMode } = require('./utils/singlePageMode');
      this.globalData.isSinglePage = isSinglePageMode(options);
    } catch (e) { /* ignore */ }
    // 物料码打点/归因必须**最先**做：要赶在入口页自己发 page_view 之前把 entrySource 写好，
    // 否则"到达目标页"这一环会掉进"无来源"，漏斗首两环对不上。
    this.maybeTrackQrMaterial(options);
    this.maybeOpenAtlasSpot(options);
    this.maybeOpenIdentifyEntry(options);
    this.maybeOpenRegisterEntry(options);
  },

  /**
   * 印刷物料码（门店 AI 识别码 / 收银台注册码 / 祈福墙立牌码）的**入口打点 + 转化归因**。
   *
   * 为什么需要（2026-09-20 产品负责人指派「给这三个二维码写数据埋点」）：
   *   三张码此前在埋点里**无法区分** —— 数字场景值（1011/1047…）对"扫码进入"完全相同，
   *   报表只能看到三张码合起来的数。这里把码里的 `scene` 串解析成物料 key：
   *     ① 写入 analytics session 的 `entrySource`（`qr:<key>`）→ **此后会话内所有事件**都带它，
   *        于是"扫码 → 到达目标页 → 关键转化"整条漏斗都能按物料切开；
   *     ② 补一条入口事件 `qr_material_enter`（step=open），用于算漏斗第一环。
   *
   * 判据与 `analytics/qrMaterial.js` 共用同一份登记表，避免"跳过去了却没归因"这类口径漂移。
   */
  maybeTrackQrMaterial(options) {
    try {
      const { parseQrMaterial, entrySourceOf } = require('./utils/analytics/qrMaterial');
      const { setEntrySource, getEnterSceneText } = require('./utils/analytics/session');
      const { trackBehavior } = require('./utils/analytics/index');
      const opts = options || {};
      const q = (opts && opts.query) || {};
      const raw = q.scene != null ? q.scene : (opts && opts.scene);
      // onShow 的 options 在部分安卓热启动下是旧的 → 缺失时问 wx.getEnterOptionsSync()
      let sceneText = (raw == null || raw === '') ? getEnterSceneText() : String(raw);
      if (!sceneText) return;
      let scene = sceneText;
      try {
        scene = decodeURIComponent(sceneText);
      } catch (e) { /* 保持原串 */ }
      const key = parseQrMaterial(scene);
      if (!key) return;
      const now = Date.now();
      if (this._qrMaterialKey === key && now - (this._qrMaterialAt || 0) < 4000) return;
      this._qrMaterialKey = key;
      this._qrMaterialAt = now;
      setEntrySource(entrySourceOf(key));
      trackBehavior('qr_material_enter', 'qr_material', key, {
        step: 'open',
        from: 'qr',
        properties: { step: 'open', scene }
      });
    } catch (e) {
      console.warn('[qrMaterial] 入口打点失败', e && e.message);
    }
  },

  /**
   * AI 识别码（门店物料码 / 分享海报码）的**兜底入口路由**。
   *
   * 为什么必须有（2026-09-20 真机反馈：**iOS 扫码正常进 AI 页，安卓扫码落到首页**）：
   *   · 冷启动：目标页 onLoad 会自己收到 `scene` 并处理 ✓（这条一直没问题）
   *   · **热启动**：小程序在后台时扫码，部分安卓机只把小程序**切到前台**、不重走码里指定的页面，
   *     用户就停在上一次那页（常见是首页）→ 观感即"扫码跳到了主页"；
   *   · 另外任何路径解析不到都会走 `onPageNotFound` → 那里原先**一律 goHome（落首页）**。
   * 这里按 scene 在 app 级**再兜一次**，与「图鉴 spot 码」同一套去重窗口，避免冷启动双重跳转。
   */
  maybeOpenIdentifyEntry(options) {
    try {
      // 取"本次进入"的入口参数：onShow 的 options 在部分安卓热启动下会是**旧的**（没有新 scene），
      // 故缺失时用微信官方 `wx.getEnterOptionsSync()`（基础库 2.20.1+，每次进入都会更新）兜一次。
      let opts = options || {};
      const sceneOf = (o) => {
        const q = (o && o.query) || {};
        return q && q.scene != null ? q.scene : (o && o.scene);
      };
      if (sceneOf(opts) == null && typeof wx.getEnterOptionsSync === 'function') {
        try {
          const enter = wx.getEnterOptionsSync();
          if (enter && sceneOf(enter) != null) opts = enter;
        } catch (e) { /* 拿不到就按原 options 走 */ }
      }
      const q = (opts && opts.query) || {};
      const raw = q && q.scene != null ? q.scene : (opts && opts.scene);
      if (raw == null || raw === '') return;
      let scene = '';
      try {
        scene = decodeURIComponent(String(raw));
      } catch (e) {
        scene = String(raw);
      }
      // ⚠️ 祈福墙立牌（2026-09-18 生成、**已印**）用的是**同一个** `from=store_qr` 令牌，
      //    靠自己的钥匙 `k=mashangyou` 区分，而它指向的祈福墙页是**活的**。
      //    2026-09-20 实测：没有下面这段时，扫立牌会被本路由抢到识别页 —— 连冷启动
      //    （入口页已经是祈福墙）也会在 600ms 后被 reLaunch 走。物料码改不了，只能让路：
      //      · `k=mashangyou` → 祈福墙（热启动时按同一 scene 契约转发过去）
      //      · 其它 `k=…`     → 不认识就不抢（留给对应物料页自己处理）
      const wallKey = /(?:^|[&?])k=([^&]+)/.exec(scene);
      if (wallKey) {
        if (wallKey[1] !== 'mashangyou') return;
        const wallTarget = 'subpackages/feature/wish-wall/index';
        const wallEntryPath = String((opts && opts.path) || '').replace(/^\//, '');
        // 冷启动入口页就是祈福墙 → 页面自己解 scene，不要再跳
        if (wallEntryPath && wallEntryPath === wallTarget) return;
        const wallUrl = `/${wallTarget}?scene=${encodeURIComponent(scene)}`;
        const wallNow = Date.now();
        if (this._wishWallEntryKey === scene && wallNow - (this._wishWallEntryAt || 0) < 4000) return;
        this._wishWallEntryKey = scene;
        this._wishWallEntryAt = wallNow;
        setTimeout(() => {
          const pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || [];
          const cur = pages.length ? String(pages[pages.length - 1].route || '') : '';
          if (cur === wallTarget) return;
          wx.reLaunch({
            url: wallUrl,
            fail: () => console.warn('[materialEntry] 祈福墙物料码兜底跳转失败', wallTarget)
          });
        }, 600);
        return;
      }
      // ① 门店物料码：scene 形如 `from=store_qr`（识别主页）
      // ② 分享海报码：scene 就是鉴定记录 _id（24 位 hex → 结果页）
      const isStore = /(?:^|[&?])from=store_qr(?:&|$)/.test(scene);
      const rid = /^[0-9a-f]{16,32}$/i.test(scene.trim()) ? scene.trim() : '';
      if (!isStore && !rid) return;
      const url = rid
        ? '/subpackages/feature/identify/result/index?record_id=' + encodeURIComponent(rid)
        : '/subpackages/feature/identify/index?from=store_qr';
      const target = url.split('?')[0].replace(/^\//, '');
      // 冷启动时入口页就是目标页 → 页面自己会处理，不要再跳（否则重复加载 + 重复埋点）
      const entryPath = String((opts && opts.path) || '').replace(/^\//, '');
      if (entryPath && entryPath === target) return;
      const key = (rid ? 'r:' : 's:') + (rid || scene);
      const now = Date.now();
      if (this._identifyEntryKey === key && now - (this._identifyEntryAt || 0) < 4000) return;
      this._identifyEntryKey = key;
      this._identifyEntryAt = now;
      setTimeout(() => {
        const pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || [];
        const cur = pages.length ? String(pages[pages.length - 1].route || '') : '';
        if (cur === target) return;
        wx.reLaunch({
          url,
          fail: () => console.warn('[identifyEntry] 兜底跳转失败（页面可能未随版本发布）', target)
        });
      }, 600);
    } catch (e) {
      console.warn('[identifyEntry] scene 兜底失败', e && e.message);
    }
  },

  /**
   * 「新用户注册」物料码（收银台立牌）的**兜底入口路由**。
   *
   * 与识别码是**同一类**问题（印出去的码改不了），但断点不同（2026-09-20 核查结论）：
   *   · 印出去的注册码指向 2026-09-15 生成时的 `subpackages/feature/user/onboarding/index`
   *     （注册页当天 `b424752` 首次新增，就在这个路径）；
   *   · 2026-09-17 `b312a0f`「拆出 extra 分包」把该页搬去 `extra/user/onboarding`，
   *     码里写死的 page 就解析不到了 → 落到首页；
   *   · 页面的 scene 是 `from=counter_qr`（注册页 onLoad 认它，且视作**独立注册入口**：
   *     不继承历史回流意图，注册完成留本页承接）→ 兜底时**必须原样带上 scene**，
   *     否则注册页会退化成普通入口、把旧的回流意图套回来。
   *
   * 三层兜底（缺一不可）：
   *   ① 页面在 → 注册页 onLoad 自己处理 ✓
   *   ② 页面 404 → `onPageNotFound` 经 `utils/messageHelper.js` 的「分包内搬迁别名」改写到 extra ✓
   *   ③ 热启动某些安卓机不重走码里页面（扫了只切前台）→ 这里按 scene 再兜一次
   */
  maybeOpenRegisterEntry(options) {
    try {
      // 与识别码同款：onShow 的 options 在部分安卓热启动下是**旧的**（没有新 scene），
      // 缺失时用 `wx.getEnterOptionsSync()`（基础库 2.20.1+，每次进入都会更新）兜一次。
      let opts = options || {};
      const sceneOf = (o) => {
        const q = (o && o.query) || {};
        return q && q.scene != null ? q.scene : (o && o.scene);
      };
      if (sceneOf(opts) == null && typeof wx.getEnterOptionsSync === 'function') {
        try {
          const enter = wx.getEnterOptionsSync();
          if (enter && sceneOf(enter) != null) opts = enter;
        } catch (e) { /* 拿不到就按原 options 走 */ }
      }
      const q = (opts && opts.query) || {};
      const raw = q && q.scene != null ? q.scene : (opts && opts.scene);
      if (raw == null || raw === '') return;
      let scene = '';
      try {
        scene = decodeURIComponent(String(raw));
      } catch (e) {
        scene = String(raw);
      }
      // 判据与注册页 onLoad 完全一致：scene 里带 from=counter_qr
      if (!/(?:^|[&?])from=counter_qr(?:&|$)/.test(scene)) return;
      const url = '/subpackages/extra/user/onboarding/index?scene='
        + encodeURIComponent('from=counter_qr');
      const target = url.split('?')[0].replace(/^\//, '');
      // 冷启动/新码：入口页就是注册页 → 页面自己会处理，不要再跳（避免双重加载 + 双重埋点）
      const entryPath = String((opts && opts.path) || '').replace(/^\//, '');
      if (entryPath && entryPath === target) return;
      const now = Date.now();
      if (this._registerEntryKey === scene && now - (this._registerEntryAt || 0) < 4000) return;
      this._registerEntryKey = scene;
      this._registerEntryAt = now;
      setTimeout(() => {
        const pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || [];
        const cur = pages.length ? String(pages[pages.length - 1].route || '') : '';
        // 404 兜底可能已经把用户送到注册页了 → 不要再跳一次
        if (cur === target) return;
        wx.reLaunch({
          url,
          fail: () => console.warn('[registerEntry] 兜底跳转失败（注册页可能未随版本发布）', target)
        });
      }, 600);
    } catch (e) {
      console.warn('[registerEntry] scene 兜底失败', e && e.message);
    }
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

    const rawPath = String((res && (res.path || res.route)) || '').replace(/^\//, '');
    // 识别码相关路径 404（旧 path / 分包未随版本发布）→ **回识别页**，不要落首页。
    // 印刷物料上的码改不了，用户扫了必须能到 AI 识别，而不是被丢回首页（2026-09-20 安卓真机反馈）。
    if (/identify/i.test(rawPath)) {
      const goneQuery = (res && res.query) || {};
      const rid = String(goneQuery.record_id || goneQuery.scene || '').trim();
      const url = /^[0-9a-f]{16,32}$/i.test(rid)
        ? '/subpackages/feature/identify/result/index?record_id=' + encodeURIComponent(rid)
        : '/subpackages/feature/identify/index?from=' + encodeURIComponent('qr_remap');
      if (rawPath !== url.split('?')[0].replace(/^\//, '')) {
        wx.reLaunch({ url, fail: goHome });
        return;
      }
    }

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

    // 印刷物料码「落空」也要记一笔：扫码进来但页面解析不到、且没能重映射 → 落首页。
    // 报表里这一档 = "印出去的码已经失效"，是物料运维最该被看见的信号（2026-09-20 收银台注册码就是这种）。
    try {
      const { parseQrMaterial } = require('./utils/analytics/qrMaterial');
      const goneQuery = (res && res.query) || {};
      const key = parseQrMaterial(goneQuery.scene != null ? goneQuery.scene : '');
      if (key) {
        require('./utils/analytics/index').trackBehavior('qr_material_enter', 'qr_material', key, {
          step: 'fallback_home',
          from: 'qr',
          properties: { step: 'fallback_home', path: rawPath }
        });
      }
    } catch (e) { /* 打点失败不能影响兜底跳转 */ }

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
