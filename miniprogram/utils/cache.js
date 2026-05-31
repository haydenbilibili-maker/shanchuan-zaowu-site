/**
 * 数据缓存工具
 * 用于优化首页数据加载性能
 */

const CACHE_PREFIX = 'sc_cache_';
const CACHE_EXPIRY = {
  BANNERS: 24 * 60 * 60 * 1000, // 24小时
  CATEGORIES: 24 * 60 * 60 * 1000, // 24小时
  COLLECTIONS: 12 * 60 * 60 * 1000, // 12小时
  FRAMERS: 12 * 60 * 60 * 1000, // 12小时
  ACTIVITIES: 6 * 60 * 60 * 1000, // 6小时
  NEW_ARRIVALS: 2 * 60 * 60 * 1000, // 2小时
  RECOMMENDATIONS: 1 * 60 * 60 * 1000, // 1小时
};

/**
 * 设置缓存
 * @param {string} key - 缓存键
 * @param {*} data - 缓存数据
 * @param {number} expiry - 过期时间（毫秒）
 */
function setCache(key, data, expiry = 0) {
  try {
    const cacheData = {
      data,
      timestamp: Date.now(),
      expiry: expiry || CACHE_EXPIRY[key] || 60 * 60 * 1000 // 默认1小时
    };
    wx.setStorageSync(CACHE_PREFIX + key, cacheData);
    return true;
  } catch (e) {
    console.warn('设置缓存失败:', key, e);
    return false;
  }
}

/**
 * 获取缓存
 * @param {string} key - 缓存键
 * @returns {*|null} 缓存数据或null
 */
function getCache(key) {
  try {
    const cacheData = wx.getStorageSync(CACHE_PREFIX + key);
    if (!cacheData) return null;

    const { data, timestamp, expiry } = cacheData;
    const now = Date.now();

    // 检查是否过期
    if (now - timestamp > expiry) {
      // 缓存已过期，删除
      wx.removeStorageSync(CACHE_PREFIX + key);
      return null;
    }

    return data;
  } catch (e) {
    console.warn('获取缓存失败:', key, e);
    return null;
  }
}

/**
 * 清除缓存
 * @param {string} key - 缓存键，不传则清除所有缓存
 */
function clearCache(key) {
  try {
    if (key) {
      wx.removeStorageSync(CACHE_PREFIX + key);
    } else {
      // 清除所有缓存
      const storage = wx.getStorageInfoSync();
      storage.keys.forEach(k => {
        if (k.startsWith(CACHE_PREFIX)) {
          wx.removeStorageSync(k);
        }
      });
    }
    return true;
  } catch (e) {
    console.warn('清除缓存失败:', e);
    return false;
  }
}

/**
 * 检查缓存是否存在且有效
 * @param {string} key - 缓存键
 * @returns {boolean}
 */
function hasCache(key) {
  return getCache(key) !== null;
}

/**
 * 批量设置缓存
 * @param {Object} cacheData - 缓存数据对象
 */
function setBatchCache(cacheData) {
  let successCount = 0;
  for (const [key, data] of Object.entries(cacheData)) {
    if (setCache(key, data)) {
      successCount++;
    }
  }
  return successCount;
}

/**
 * 获取缓存大小（估算）
 * @returns {number} 缓存大小（KB）
 */
function getCacheSize() {
  try {
    const storage = wx.getStorageInfoSync();
    let totalSize = 0;
    storage.keys.forEach(k => {
      if (k.startsWith(CACHE_PREFIX)) {
        try {
          const data = wx.getStorageSync(k);
          const size = JSON.stringify(data).length;
          totalSize += size;
        } catch (e) {
          // 忽略单个键的错误
        }
      }
    });
    return Math.round(totalSize / 1024); // 返回KB
  } catch (e) {
    console.warn('获取缓存大小失败:', e);
    return 0;
  }
}

/**
 * 清理过期缓存
 */
function cleanExpiredCache() {
  try {
    const storage = wx.getStorageInfoSync();
    let cleanedCount = 0;
    
    storage.keys.forEach(k => {
      if (k.startsWith(CACHE_PREFIX)) {
        try {
          const cacheData = wx.getStorageSync(k);
          if (cacheData && cacheData.timestamp && cacheData.expiry) {
            const now = Date.now();
            if (now - cacheData.timestamp > cacheData.expiry) {
              wx.removeStorageSync(k);
              cleanedCount++;
            }
          }
        } catch (e) {
          // 如果读取失败，可能是数据损坏，删除
          wx.removeStorageSync(k);
          cleanedCount++;
        }
      }
    });
    
    return cleanedCount;
  } catch (e) {
    console.warn('清理过期缓存失败:', e);
    return 0;
  }
}

/**
 * 智能缓存：根据网络状态调整缓存策略
 * @param {string} key - 缓存键
 * @param {Function} fetchFn - 获取数据的函数
 * @param {number} expiry - 过期时间
 * @returns {Promise}
 */
async function smartCache(key, fetchFn, expiry) {
  // 先尝试从缓存获取
  const cached = getCache(key);
  if (cached) {
    // 后台更新缓存
    fetchFn().then(data => {
      if (data) {
        setCache(key, data, expiry);
      }
    }).catch(err => {
      console.warn(`后台更新缓存失败 ${key}:`, err);
    });
    return cached;
  }
  
  // 缓存不存在，获取新数据
  try {
    const data = await fetchFn();
    if (data) {
      setCache(key, data, expiry);
    }
    return data;
  } catch (err) {
    console.error(`获取数据失败 ${key}:`, err);
    throw err;
  }
}

module.exports = {
  setCache,
  getCache,
  clearCache,
  hasCache,
  setBatchCache,
  getCacheSize,
  cleanExpiredCache,
  smartCache,
  CACHE_EXPIRY
};



