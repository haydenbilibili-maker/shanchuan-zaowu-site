// app.js
require('./utils/analytics/pageHook');

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
        // ⚠️ 务必确认这里填的是你的环境ID
        env: 'cloud1-8gnkty5bfff9f0bf', 
        traceUser: true,
      });
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

    // 3. 加载自定义字体 (DIN / Bebas)
    // 用于价格和编号显示，提升高级感
    wx.loadFontFace({
      family: 'DIN', 
      source: 'url("https://fonts.gstatic.com/s/bebasneue/v9/JTUSjIg69CK48gW7PXoo9WlhyyTh89Y.woff2")',
      success: () => console.log('字体加载成功'),
      fail: (e) => console.log('字体加载失败，将回退系统字体', e)
    });

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
    // 页面不存在
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

    // 跳转到首页
    wx.redirectTo({
      url: '/pages/index/index'
    });
  },

  // 获取 OpenID
  getOpenId() {
    if (!wx.cloud) {
      console.warn('云开发未初始化，无法获取 OpenID');
      return;
    }
    
    wx.cloud.callFunction({
      name: 'login',
      data: {},
      success: res => {
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
    navBarHeight: 0
  }
});