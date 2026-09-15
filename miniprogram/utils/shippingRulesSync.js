/**
 * 拉取云端运费规则并覆盖 config/shipping.js defaults
 * 失败静默回退本地 defaults，不阻塞页面。
 */
const CACHE_TTL_MS = 5 * 60 * 1000

function getAppSafe() {
  try {
    return getApp()
  } catch (e) {
    return null
  }
}

function applyToConfig(config) {
  if (!config) return
  try {
    const shippingConfig = require('../config/shipping')
    if (typeof shippingConfig.applyRemoteConfig === 'function') {
      shippingConfig.applyRemoteConfig(config)
    }
  } catch (e) {
    console.warn('[shippingRulesSync] apply failed', e)
  }
}

/**
 * @param {{ force?: boolean }} options
 * @returns {Promise<object|null>} 合并后的 config，失败返回 null
 */
function ensureShippingRules(options) {
  const force = !!(options && options.force)
  const app = getAppSafe()
  const now = Date.now()

  if (
    !force &&
    app &&
    app.globalData &&
    app.globalData.shippingRules &&
    app.globalData.shippingRulesLoadedAt &&
    now - app.globalData.shippingRulesLoadedAt < CACHE_TTL_MS
  ) {
    applyToConfig(app.globalData.shippingRules)
    return Promise.resolve(app.globalData.shippingRules)
  }

  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.resolve(null)
  }

  return wx.cloud
    .callFunction({
      name: 'getShippingRules',
      data: { action: 'get' }
    })
    .then((res) => {
      const result = (res && res.result) || {}
      const config = result.config || null
      if (!config) return null
      applyToConfig(config)
      if (app && app.globalData) {
        app.globalData.shippingRules = config
        app.globalData.shippingRulesLoadedAt = Date.now()
        app.globalData.shippingRuleText = result.ruleText || ''
      }
      try {
        wx.setStorageSync('shipping_rules_cache', {
          config,
          ruleText: result.ruleText || '',
          at: Date.now()
        })
      } catch (e) { /* ignore */ }
      return config
    })
    .catch((err) => {
      console.warn('[shippingRulesSync] fetch failed', err)
      try {
        const cached = wx.getStorageSync('shipping_rules_cache')
        if (cached && cached.config) {
          applyToConfig(cached.config)
          if (app && app.globalData) {
            app.globalData.shippingRules = cached.config
            app.globalData.shippingRulesLoadedAt = cached.at || Date.now()
            app.globalData.shippingRuleText = cached.ruleText || ''
          }
          return cached.config
        }
      } catch (e) { /* ignore */ }
      return null
    })
}

/** 启动时用本地缓存先覆盖一次，减少首屏文案闪烁 */
function hydrateFromStorage() {
  try {
    const cached = wx.getStorageSync('shipping_rules_cache')
    if (cached && cached.config) {
      applyToConfig(cached.config)
      const app = getAppSafe()
      if (app && app.globalData) {
        app.globalData.shippingRules = cached.config
        app.globalData.shippingRulesLoadedAt = cached.at || 0
        app.globalData.shippingRuleText = cached.ruleText || ''
      }
    }
  } catch (e) { /* ignore */ }
}

module.exports = {
  ensureShippingRules,
  hydrateFromStorage,
  CACHE_TTL_MS
}
