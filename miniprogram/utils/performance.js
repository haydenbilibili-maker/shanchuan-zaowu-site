/**
 * 性能监控工具
 * 用于监控页面加载时间和接口响应时间
 */

const errorMonitor = require('./errorMonitor');

class PerformanceMonitor {
  constructor() {
    this.metrics = {};
  }

  /**
   * 开始计时
   * @param {string} name - 指标名称
   */
  start(name) {
    this.metrics[name] = {
      startTime: Date.now(),
      endTime: null,
      duration: null
    };
  }

  /**
   * 结束计时
   * @param {string} name - 指标名称
   * @returns {number} 耗时（毫秒）
   */
  end(name) {
    if (!this.metrics[name]) {
      console.warn(`性能指标 ${name} 未开始`);
      return 0;
    }

    const metric = this.metrics[name];
    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;

    // 上报性能数据
    errorMonitor.capturePerformance({
      name: name,
      duration: metric.duration,
      startTime: metric.startTime,
      endTime: metric.endTime
    });

    return metric.duration;
  }

  /**
   * 监控页面加载时间
   * @param {string} pageName - 页面名称
   */
  monitorPageLoad(pageName) {
    const metricName = `page_load_${pageName}`;
    this.start(metricName);

    // 页面加载完成
    wx.nextTick(() => {
      setTimeout(() => {
        const duration = this.end(metricName);
        console.log(`页面 ${pageName} 加载耗时: ${duration}ms`);
      }, 100);
    });
  }

  /**
   * 监控API请求时间
   * @param {string} apiName - API名称
   * @param {Function} apiCall - API调用函数
   */
  async monitorApi(apiName, apiCall) {
    const metricName = `api_${apiName}`;
    this.start(metricName);

    try {
      const result = await apiCall();
      const duration = this.end(metricName);
      
      // 如果API耗时过长，记录警告
      if (duration > 3000) {
        console.warn(`API ${apiName} 耗时过长: ${duration}ms`);
      }

      return result;
    } catch (error) {
      this.end(metricName);
      throw error;
    }
  }

  /**
   * 获取性能指标
   * @param {string} name - 指标名称
   * @returns {Object|null}
   */
  getMetric(name) {
    return this.metrics[name] || null;
  }

  /**
   * 清除所有指标
   */
  clear() {
    this.metrics = {};
  }
}

// 创建单例
const performanceMonitor = new PerformanceMonitor();

module.exports = performanceMonitor;






