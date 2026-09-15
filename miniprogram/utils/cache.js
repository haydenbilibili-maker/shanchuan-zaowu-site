/**
 * 分层缓存 + SWR（stale-while-revalidate）
 * 内存优先，落盘兜底；过期可返回 stale，后台刷新。
 */

const CACHE_PREFIX = 'sc_cache_';

/** 分层 TTL（毫秒） */
const TTL = {
  SESSION: 2 * 60 * 1000,
  FLAGS: 10 * 60 * 1000,
  STORE: 15 * 60 * 1000,
  HOME: 24 * 60 * 60 * 1000,
  LIST: 5 * 60 * 1000,
  DETAIL: 60 * 1000,
  TEMP_URL: 50 * 60 * 1000
};

/** 过期后仍可作为 stale 展示的窗口 */
const STALE_WINDOW = {
  SESSION: 30 * 60 * 1000,
  FLAGS: 24 * 60 * 60 * 1000,
  STORE: 7 * 24 * 60 * 60 * 1000,
  HOME: 7 * 24 * 60 * 60 * 1000,
  LIST: 60 * 60 * 1000,
  DETAIL: 10 * 60 * 1000,
  TEMP_URL: 2 * 60 * 60 * 1000
};

/** 兼容旧调用方的业务键过期 */
const CACHE_EXPIRY = {
  BANNERS: TTL.HOME,
  CATEGORIES: TTL.HOME,
  COLLECTIONS: 12 * 60 * 60 * 1000,
  FRAMERS: 12 * 60 * 60 * 1000,
  ACTIVITIES: 6 * 60 * 60 * 1000,
  NEW_ARRIVALS: 2 * 60 * 60 * 1000,
  RECOMMENDATIONS: TTL.LIST,
  HOME_CONFIG: TTL.HOME,
  CONTENT_FLAGS: TTL.FLAGS,
  STORE_CATALOG: TTL.STORE
};

const memory = Object.create(null);
const inflight = Object.create(null);

function storageKey(key) {
  return CACHE_PREFIX + key;
}

function resolveExpiry(key, expiry) {
  if (expiry && expiry > 0) return expiry;
  return CACHE_EXPIRY[key] || TTL.LIST;
}

function resolveStaleWindow(key, staleMs) {
  if (staleMs != null && staleMs >= 0) return staleMs;
  if (key === 'CONTENT_FLAGS' || key.indexOf('FLAGS') >= 0) return STALE_WINDOW.FLAGS;
  if (key === 'STORE_CATALOG' || key.indexOf('STORE') >= 0) return STALE_WINDOW.STORE;
  if (key === 'HOME_CONFIG' || key === 'BANNERS' || key === 'COLLECTIONS') return STALE_WINDOW.HOME;
  if (key.indexOf('DETAIL') >= 0 || key.indexOf('PRODUCT') >= 0) return STALE_WINDOW.DETAIL;
  return STALE_WINDOW.LIST;
}

/**
 * @returns {{ data: *, timestamp: number, expiry: number }|null}
 */
function readEntry(key) {
  if (memory[key]) return memory[key];
  try {
    const raw = wx.getStorageSync(storageKey(key));
    if (!raw || raw.timestamp == null) return null;
    memory[key] = raw;
    return raw;
  } catch (e) {
    return null;
  }
}

/**
 * @returns {{ data: *, fresh: boolean, stale: boolean, age: number }|null}
 */
function peekCache(key, options) {
  const entry = readEntry(key);
  if (!entry) return null;
  const now = Date.now();
  const age = now - entry.timestamp;
  const ttl = entry.expiry || resolveExpiry(key, 0);
  const staleWindow = resolveStaleWindow(key, options && options.staleMs);
  if (age <= ttl) {
    return { data: entry.data, fresh: true, stale: false, age };
  }
  if (age <= ttl + staleWindow) {
    return { data: entry.data, fresh: false, stale: true, age };
  }
  return null;
}

function setCache(key, data, expiry) {
  try {
    const cacheData = {
      data,
      timestamp: Date.now(),
      expiry: resolveExpiry(key, expiry)
    };
    memory[key] = cacheData;
    wx.setStorageSync(storageKey(key), cacheData);
    return true;
  } catch (e) {
    console.warn('设置缓存失败:', key, e);
    // 存储满时仍保留内存层
    memory[key] = {
      data,
      timestamp: Date.now(),
      expiry: resolveExpiry(key, expiry)
    };
    return false;
  }
}

/**
 * @param {string} key
 * @param {{ allowStale?: boolean, staleMs?: number }} [options]
 */
function getCache(key, options) {
  const allowStale = !!(options && options.allowStale);
  const peeked = peekCache(key, options);
  if (!peeked) {
    // 彻底过期：清掉，避免占配额
    try {
      delete memory[key];
      wx.removeStorageSync(storageKey(key));
    } catch (e) { /* ignore */ }
    return null;
  }
  if (peeked.fresh) return peeked.data;
  if (allowStale && peeked.stale) return peeked.data;
  return null;
}

function hasCache(key) {
  return peekCache(key) != null;
}

function clearCache(key) {
  try {
    if (key) {
      delete memory[key];
      delete inflight[key];
      wx.removeStorageSync(storageKey(key));
    } else {
      Object.keys(memory).forEach((k) => { delete memory[k]; });
      Object.keys(inflight).forEach((k) => { delete inflight[k]; });
      const storage = wx.getStorageInfoSync();
      (storage.keys || []).forEach((k) => {
        if (k.startsWith(CACHE_PREFIX)) wx.removeStorageSync(k);
      });
    }
    return true;
  } catch (e) {
    console.warn('清除缓存失败:', e);
    return false;
  }
}

/**
 * 精准失效：完整键或前缀（如 'HOME' 匹配 HOME_CONFIG）
 * @param {string|string[]} keysOrPrefixes
 */
function invalidate(keysOrPrefixes) {
  const list = Array.isArray(keysOrPrefixes) ? keysOrPrefixes : [keysOrPrefixes];
  const exact = new Set();
  const prefixes = [];
  list.forEach((item) => {
    if (!item) return;
    if (item.endsWith('*')) prefixes.push(item.slice(0, -1));
    else exact.add(item);
  });

  const drop = (key) => {
    delete memory[key];
    delete inflight[key];
    try { wx.removeStorageSync(storageKey(key)); } catch (e) { /* ignore */ }
  };

  exact.forEach(drop);

  if (!prefixes.length) return;

  Object.keys(memory).forEach((k) => {
    if (prefixes.some((p) => k === p || k.indexOf(p) === 0)) drop(k);
  });
  try {
    const storage = wx.getStorageInfoSync();
    (storage.keys || []).forEach((sk) => {
      if (!sk.startsWith(CACHE_PREFIX)) return;
      const k = sk.slice(CACHE_PREFIX.length);
      if (prefixes.some((p) => k === p || k.indexOf(p) === 0)) {
        try { wx.removeStorageSync(sk); } catch (e) { /* ignore */ }
        delete memory[k];
        delete inflight[k];
      }
    });
  } catch (e) { /* ignore */ }
}

function setBatchCache(cacheData) {
  let successCount = 0;
  for (const [key, data] of Object.entries(cacheData || {})) {
    if (setCache(key, data)) successCount++;
  }
  return successCount;
}

function getCacheSize() {
  try {
    const storage = wx.getStorageInfoSync();
    let totalSize = 0;
    (storage.keys || []).forEach((k) => {
      if (!k.startsWith(CACHE_PREFIX)) return;
      try {
        totalSize += JSON.stringify(wx.getStorageSync(k)).length;
      } catch (e) { /* ignore */ }
    });
    return Math.round(totalSize / 1024);
  } catch (e) {
    return 0;
  }
}

function cleanExpiredCache() {
  let cleanedCount = 0;
  try {
    const storage = wx.getStorageInfoSync();
    (storage.keys || []).forEach((k) => {
      if (!k.startsWith(CACHE_PREFIX)) return;
      const key = k.slice(CACHE_PREFIX.length);
      if (peekCache(key, { staleMs: STALE_WINDOW.HOME }) == null) {
        try {
          wx.removeStorageSync(k);
          delete memory[key];
          cleanedCount++;
        } catch (e) { /* ignore */ }
      }
    });
  } catch (e) {
    console.warn('清理过期缓存失败:', e);
  }
  return cleanedCount;
}

/**
 * SWR：fresh 直接返回；stale 先返回并后台刷新；miss 等待网络
 * 同 key inflight 去重。revalidate:true 时 fresh 也会后台刷新。
 * @param {string} key
 * @param {() => Promise<*>} fetchFn
 * @param {{
 *   expiry?: number,
 *   staleMs?: number,
 *   force?: boolean,
 *   revalidate?: boolean,
 *   onUpdate?: (data: *, meta: { fromCache: boolean, fresh: boolean }) => void
 * }} [options]
 */
async function swr(key, fetchFn, options) {
  const opts = options || {};
  const force = !!opts.force;
  const peeked = force ? null : peekCache(key, { staleMs: opts.staleMs });

  const runFetch = () => {
    if (inflight[key]) return inflight[key];
    inflight[key] = Promise.resolve()
      .then(() => fetchFn())
      .then((data) => {
        if (data !== undefined && data !== null) {
          setCache(key, data, opts.expiry);
        }
        return data;
      })
      .finally(() => {
        delete inflight[key];
      });
    return inflight[key];
  };

  const softRevalidate = (promise) => {
    promise
      .then((data) => {
        if (data === undefined || data === null) return;
        if (typeof opts.onUpdate === 'function') {
          try { opts.onUpdate(data, { fromCache: false, fresh: true }); } catch (e) { /* ignore */ }
        }
      })
      .catch((err) => {
        console.warn(`SWR 后台刷新失败 ${key}:`, err);
      });
  };

  if (peeked) {
    if (typeof opts.onUpdate === 'function') {
      try { opts.onUpdate(peeked.data, { fromCache: true, fresh: peeked.fresh }); } catch (e) { /* ignore */ }
    }
    if (peeked.stale || opts.revalidate) {
      softRevalidate(runFetch());
    }
    return peeked.data;
  }

  try {
    const data = await runFetch();
    if (typeof opts.onUpdate === 'function' && data != null) {
      try { opts.onUpdate(data, { fromCache: false, fresh: true }); } catch (e) { /* ignore */ }
    }
    return data;
  } catch (err) {
    const entry = readEntry(key);
    if (entry) {
      console.warn(`SWR 降级旧缓存 ${key}`);
      return entry.data;
    }
    throw err;
  }
}

/** @deprecated 使用 swr；保留兼容 */
async function smartCache(key, fetchFn, expiry) {
  return swr(key, fetchFn, { expiry });
}

/**
 * 短时间节流：同一 scope 在 windowMs 内只允许一次 action
 */
function shouldRefresh(scope, windowMs) {
  const key = `_throttle_${scope}`;
  const now = Date.now();
  const last = memory[key] && memory[key].timestamp;
  if (last && now - last < (windowMs || 5000)) return false;
  memory[key] = { data: 1, timestamp: now, expiry: windowMs || 5000 };
  return true;
}

function markRefreshed(scope) {
  memory[`_throttle_${scope}`] = { data: 1, timestamp: Date.now(), expiry: 60000 };
}

module.exports = {
  setCache,
  getCache,
  peekCache,
  clearCache,
  invalidate,
  hasCache,
  setBatchCache,
  getCacheSize,
  cleanExpiredCache,
  smartCache,
  swr,
  shouldRefresh,
  markRefreshed,
  CACHE_EXPIRY,
  TTL,
  STALE_WINDOW
};
