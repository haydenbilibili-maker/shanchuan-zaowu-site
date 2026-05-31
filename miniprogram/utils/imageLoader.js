/**
 * 图片加载优化工具
 * 支持懒加载、CDN、WebP格式
 */

class ImageLoader {
  constructor() {
    this.imageCache = new Map();
    this.observer = null;
    this.initLazyLoad();
  }

  /**
   * 初始化懒加载
   */
  initLazyLoad() {
    // 使用 Intersection Observer API（如果支持）
    if (typeof wx.createIntersectionObserver !== 'undefined') {
      // 微信小程序支持 Intersection Observer
      this.observer = wx.createIntersectionObserver();
    }
  }

  /**
   * 优化图片URL
   * @param {string} url - 原始图片URL
   * @param {Object} options - 选项
   * @returns {string} 优化后的URL
   */
  optimizeUrl(url, options = {}) {
    if (!url) return '';

    const {
      width,
      height,
      quality = 80,
      format = 'webp' // 优先使用WebP
    } = options;

    // 如果已经是CDN URL，直接返回
    if (url.includes('cloudbase.net') || url.includes('qcloudimg.com')) {
      let optimizedUrl = url;
      
      // 添加图片处理参数（根据CDN服务商调整）
      if (width || height) {
        const params = [];
        if (width) params.push(`w_${width}`);
        if (height) params.push(`h_${height}`);
        if (quality) params.push(`q_${quality}`);
        if (format) params.push(`f_${format}`);
        
        const separator = url.includes('?') ? '&' : '?';
        optimizedUrl = `${url}${separator}${params.join(',')}`;
      }
      
      return optimizedUrl;
    }

    return url;
  }

  /**
   * 预加载图片
   * @param {string} url - 图片URL
   * @returns {Promise}
   */
  preload(url) {
    if (!url) return Promise.resolve();

    // 检查缓存
    if (this.imageCache.has(url)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const img = wx.createImage();
      
      img.onload = () => {
        this.imageCache.set(url, true);
        resolve();
      };
      
      img.onerror = (err) => {
        reject(err);
      };
      
      img.src = url;
    });
  }

  /**
   * 批量预加载图片
   * @param {Array<string>} urls - 图片URL数组
   * @returns {Promise}
   */
  async preloadBatch(urls) {
    const promises = urls.map(url => 
      this.preload(url).catch(err => {
        console.warn(`图片预加载失败: ${url}`, err);
      })
    );
    
    await Promise.all(promises);
  }

  /**
   * 懒加载图片
   * @param {string} selector - 选择器
   * @param {Function} callback - 回调函数
   */
  lazyLoad(selector, callback) {
    if (!this.observer) {
      // 不支持 Intersection Observer，直接加载
      callback && callback();
      return;
    }

    const observer = wx.createIntersectionObserver(this);
    observer.relativeToViewport({
      bottom: 100 // 提前100px开始加载
    }).observe(selector, (res) => {
      if (res.intersectionRatio > 0) {
        callback && callback();
        observer.disconnect();
      }
    });
  }

  /**
   * 获取图片信息
   * @param {string} src - 图片路径
   * @returns {Promise<Object>}
   */
  getImageInfo(src) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: src,
        success: resolve,
        fail: reject
      });
    });
  }

  /**
   * 压缩图片
   * @param {string} src - 图片路径
   * @param {Object} options - 选项
   * @returns {Promise<string>} 压缩后的临时文件路径
   */
  compress(src, options = {}) {
    return new Promise((resolve, reject) => {
      const {
        quality = 80,
        maxWidth = 1920,
        maxHeight = 1920
      } = options;

      wx.compressImage({
        src: src,
        quality: quality,
        compressedWidth: maxWidth,
        compressedHeight: maxHeight,
        success: (res) => {
          resolve(res.tempFilePath);
        },
        fail: reject
      });
    });
  }

  /**
   * 清除图片缓存
   */
  clearCache() {
    this.imageCache.clear();
  }
}

// 创建单例
const imageLoader = new ImageLoader();

module.exports = imageLoader;






