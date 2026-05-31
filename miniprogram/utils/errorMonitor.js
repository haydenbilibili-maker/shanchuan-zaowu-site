/**
 * 错误监控工具
 * 用于收集和上报错误信息
 */

class ErrorMonitor {
  constructor() {
    this.errorQueue = [];
    this.maxQueueSize = 50;
    this.reportInterval = 5000; // 5秒上报一次
    this.timer = null;
    this.initialized = false;
    // 延迟初始化，避免在模块加载时出现问题
    setTimeout(() => {
      this.init();
    }, 100);
  }

  init() {
    if (this.initialized) return;
    
    try {
      // 监听全局错误
      if (typeof wx !== 'undefined' && wx.onError) {
        wx.onError((error) => {
          this.captureError({
            type: 'jsError',
            message: error,
            stack: error,
            timestamp: Date.now()
          });
        });
      }

      // 监听未处理的Promise拒绝
      if (typeof wx !== 'undefined' && wx.onUnhandledRejection) {
        wx.onUnhandledRejection((res) => {
          this.captureError({
            type: 'unhandledRejection',
            message: res.reason || res,
            stack: res.reason?.stack || '',
            timestamp: Date.now()
          });
        });
      }

      // 启动定时上报
      this.startReportTimer();
      this.initialized = true;
    } catch (e) {
      console.warn('错误监控初始化失败:', e);
    }
  }

  /**
   * 捕获错误
   * @param {Object} errorInfo - 错误信息
   */
  captureError(errorInfo) {
    try {
      let app = null;
      try {
        app = getApp();
      } catch (e) {
        // app 未初始化，忽略
      }

      const error = {
        ...errorInfo,
        userId: (app && app.globalData && app.globalData.openid) || 'unknown',
        page: this.getCurrentPage(),
        systemInfo: this.getSystemInfo(),
        timestamp: errorInfo.timestamp || Date.now()
      };

      // 添加到队列
      this.errorQueue.push(error);
      
      // 限制队列大小
      if (this.errorQueue.length > this.maxQueueSize) {
        this.errorQueue.shift();
      }

      // 立即上报严重错误
      if (errorInfo.level === 'critical') {
        this.reportError(error);
      }

      // 控制台输出（开发环境）
      if (errorInfo.level !== 'warning') {
        console.error('错误监控:', error);
      }
    } catch (e) {
      // 错误监控本身出错，避免无限循环
      console.warn('错误监控捕获失败:', e);
    }
  }

  /**
   * 捕获API错误
   * @param {Object} apiInfo - API信息
   */
  captureApiError(apiInfo) {
    this.captureError({
      type: 'apiError',
      level: 'error',
      url: apiInfo.url,
      method: apiInfo.method || 'GET',
      status: apiInfo.status,
      message: apiInfo.message || apiInfo.errMsg,
      requestData: apiInfo.requestData,
      responseData: apiInfo.responseData,
      timestamp: Date.now()
    });
  }

  /**
   * 捕获性能数据
   * @param {Object} performanceInfo - 性能信息
   */
  capturePerformance(performanceInfo) {
    this.captureError({
      type: 'performance',
      level: 'info',
      ...performanceInfo,
      timestamp: Date.now()
    });
  }

  /**
   * 获取当前页面路径
   */
  getCurrentPage() {
    try {
      const pages = getCurrentPages();
      if (pages.length > 0) {
        return pages[pages.length - 1].route;
      }
    } catch (e) {
      // 忽略错误
    }
    return 'unknown';
  }

  /**
   * 获取系统信息
   */
  getSystemInfo() {
    try {
      const { getSystemSnapshot } = require('./systemInfo');
      return getSystemSnapshot();
    } catch (e) {
      return {};
    }
  }

  /**
   * 上报错误到服务器
   */
  async reportError(error) {
    try {
      // 如果云函数存在，上报到云函数
      if (wx.cloud) {
        await wx.cloud.callFunction({
          name: 'logError',
          data: {
            error: error
          },
          fail: (err) => {
            console.warn('错误上报失败:', err);
          }
        });
      }
    } catch (e) {
      console.warn('错误上报异常:', e);
    }
  }

  /**
   * 批量上报错误
   */
  async reportErrors() {
    if (this.errorQueue.length === 0) return;

    const errors = [...this.errorQueue];
    this.errorQueue = [];

    try {
      if (wx.cloud) {
        await wx.cloud.callFunction({
          name: 'logError',
          data: {
            errors: errors,
            batch: true
          },
          fail: (err) => {
            // 上报失败，重新加入队列
            this.errorQueue.unshift(...errors);
            console.warn('批量错误上报失败:', err);
          }
        });
      }
    } catch (e) {
      // 上报失败，重新加入队列
      this.errorQueue.unshift(...errors);
      console.warn('批量错误上报异常:', e);
    }
  }

  /**
   * 启动定时上报
   */
  startReportTimer() {
    if (this.timer) return;
    
    try {
      this.timer = setInterval(() => {
        try {
          this.reportErrors();
        } catch (e) {
          console.warn('定时上报错误失败:', e);
        }
      }, this.reportInterval);
    } catch (e) {
      console.warn('启动定时上报失败:', e);
    }
  }

  /**
   * 停止定时上报
   */
  stopReportTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 手动上报所有错误
   */
  flush() {
    this.reportErrors();
  }
}

// 创建单例
const errorMonitor = new ErrorMonitor();

module.exports = errorMonitor;

