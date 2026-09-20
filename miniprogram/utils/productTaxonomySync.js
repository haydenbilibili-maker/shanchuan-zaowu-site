/**
 * 拉取云端「装裱方式 / 制作工艺」选项字典并覆盖 `config/productTaxonomy.js` 的代码默认值
 *
 * 与 `shippingRulesSync.js` **同一套形状**（本仓"双真源"教训的正面用法）：
 *   本地缓存先覆盖一次（减少首屏标签闪烁）→ 再异步拉云端 → 失败静默退回代码默认。
 * 与运费规则的区别只有一处、但很重要：**云端没有这份文档时不是"降级"，而是"正常"** ——
 * 没见过超管改过字典的项目，本来就该用代码默认值，页面上不该出现任何异常提示。
 *
 * ⚠️ 云函数 `getProductTaxonomy` **未部署**时，这里会走 catch → 保持代码默认 + 把
 * `app.globalData.taxonomyCloudReady` 置 false；字段维护专区据此显示"用的内置选项、
 * 选项维护不可用"，**不允许**保存（否则会出现"保存成功了但谁也没变"的假象）。
 */
const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_KEY = 'product_taxonomy_cache'
const FN = 'getProductTaxonomy'

function getAppSafe () {
  try {
    return getApp()
  } catch (e) {
    return null
  }
}

function taxonomy () {
  try {
    return require('../config/productTaxonomy')
  } catch (e) {
    return null
  }
}

/** 把一份字典应用到 config（`null` 也是合法输入 = 退回默认） */
function applyToConfig (doc) {
  const t = taxonomy()
  if (t && typeof t.setCraftOverlay === 'function') t.setCraftOverlay(doc || null)
}

function markReady (ready) {
  const app = getAppSafe()
  if (app && app.globalData) app.globalData.taxonomyCloudReady = !!ready
}

/**
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{craftTypes:Array, craftProcesses:Array}|null>} 云端字典；云端无文档/失败返回 null
 */
function ensureProductTaxonomy (options) {
  const force = !!(options && options.force)
  const app = getAppSafe()
  const now = Date.now()
  if (
    !force &&
    app && app.globalData &&
    app.globalData.productTaxonomyLoadedAt &&
    now - app.globalData.productTaxonomyLoadedAt < CACHE_TTL_MS
  ) {
    applyToConfig(app.globalData.productTaxonomy)
    return Promise.resolve(app.globalData.productTaxonomy || null)
  }
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    markReady(false)
    return Promise.resolve(null)
  }
  return wx.cloud
    .callFunction({ name: FN, data: { action: 'get' } })
    .then((res) => {
      const result = (res && res.result) || {}
      // 云函数存在且回应了（哪怕返回 doc:null）= 通路是通的
      markReady(result.success !== false)
      const doc = result.doc || null
      applyToConfig(doc)
      if (app && app.globalData) {
        app.globalData.productTaxonomy = doc
        app.globalData.productTaxonomyLoadedAt = Date.now()
      }
      try {
        wx.setStorageSync(CACHE_KEY, { doc, at: Date.now() })
      } catch (e) { /* ignore */ }
      return doc
    })
    .catch((err) => {
      // 未部署 / 网络失败：退回代码默认，并明确标记"云端不通"
      console.warn('[productTaxonomySync] fetch failed', err)
      markReady(false)
      try {
        const cached = wx.getStorageSync(CACHE_KEY)
        if (cached && cached.doc) {
          applyToConfig(cached.doc)
          if (app && app.globalData) {
            app.globalData.productTaxonomy = cached.doc
            app.globalData.productTaxonomyLoadedAt = cached.at || 0
          }
          return cached.doc
        }
      } catch (e) { /* ignore */ }
      return null
    })
}

/** 启动时先用本地缓存覆盖一次，减少首屏标签闪烁 */
function hydrateFromStorage () {
  try {
    const cached = wx.getStorageSync(CACHE_KEY)
    if (cached && cached.doc) {
      applyToConfig(cached.doc)
      const app = getAppSafe()
      if (app && app.globalData) {
        app.globalData.productTaxonomy = cached.doc
        app.globalData.productTaxonomyLoadedAt = cached.at || 0
      }
    }
  } catch (e) { /* ignore */ }
}

/**
 * 保存字典（**仅超管**；服务端还会再校验一次，包括"被删的选项还有没有商品在用"）。
 * 成功后立刻应用到本地并刷新缓存，避免"保存了但界面还是旧的"。
 * @returns {Promise<{ok:boolean, msg?:string, doc?:object}>}
 */
function saveProductTaxonomy (payload) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.resolve({ ok: false, msg: '云能力不可用' })
  }
  return wx.cloud
    .callFunction({
      name: FN,
      data: Object.assign({ action: 'save' }, payload || {})
    })
    .then((res) => {
      const result = (res && res.result) || {}
      if (!result.success) return { ok: false, msg: result.msg || '保存失败' }
      applyToConfig(result.doc)
      const app = getAppSafe()
      if (app && app.globalData) {
        app.globalData.productTaxonomy = result.doc
        app.globalData.productTaxonomyLoadedAt = Date.now()
        app.globalData.taxonomyCloudReady = true
      }
      try { wx.setStorageSync(CACHE_KEY, { doc: result.doc, at: Date.now() }) } catch (e) { /* ignore */ }
      return { ok: true, doc: result.doc }
    })
    .catch((err) => {
      const msg = String((err && err.errMsg) || (err && err.message) || err)
      const missing = /FUNCTION_NOT_FOUND|not found|does not exist/i.test(msg)
      return { ok: false, msg: missing ? '云端还没部署 getProductTaxonomy，选项维护暂不可用' : ('保存失败：' + msg) }
    })
}

module.exports = {
  ensureProductTaxonomy,
  hydrateFromStorage,
  saveProductTaxonomy,
  applyToConfig,
  CACHE_TTL_MS,
  CACHE_KEY,
  FN
}
