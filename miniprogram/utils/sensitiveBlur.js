/**
 * 敏感标本模糊展示 — 会话启视、全局偏好（SSOT）与文案
 *
 * 商品字段：products.sensitiveBlur（主）；读取时兼容 contentWarning
 * 录入默认：蛇/两栖等由 utils/sensitiveMorphology 判定后写入该字段；C 端门禁只读字段、不二次猜类。
 *
 * 全局偏好 SSOT（本地 + 云库同语义）：
 * - 本地 key：sensitive_blur_pref_v1
 * - 值：veil（继续模糊）/ clear（不再模糊）
 * - 云库 users.sensitiveBlurPref：同值；未填视为 veil
 */

const COPY = {
  title: '柜门轻掩 · 点按启视',
  sub: '敏感形态 · 可再掩上',
  badge: '已启视',
  prefTitle: '温馨提示',
  prefBody: '后续此类藏品是否继续模糊展示？',
  prefKeep: '继续模糊',
  prefClear: '不再模糊'
}

/** 本地偏好：veil=继续模糊；clear=商品流默认清晰 */
const PREF_STORAGE_KEY = 'sensitive_blur_pref_v1'
const PREF_VEIL = 'veil'
const PREF_CLEAR = 'clear'

/** 云库字段名（与本地值同语义） */
const CLOUD_FIELD = 'sensitiveBlurPref'

const DISPLAY_OPTIONS = [
  {
    key: PREF_CLEAR,
    label: '可以直接展示',
    hint: '封面直接呈现，不再默认轻掩'
  },
  {
    key: PREF_VEIL,
    label: '默认轻掩，由我点按启视',
    hint: '蛇类、两栖等封面先轻掩，点按后再看真容'
  }
]

/** 小程序会话内已启视的商品 id */
const revealedIds = new Set()
/** 偏好为 clear 时，用户手动再掩上的商品 id */
const forcedVeilIds = new Set()

const prefListeners = new Set()

function productIdKey(productOrId) {
  if (productOrId == null || productOrId === '') return ''
  if (typeof productOrId === 'object') {
    const id = productOrId._id != null ? productOrId._id : productOrId.id
    return id != null && id !== '' ? String(id) : ''
  }
  return String(productOrId)
}

function isSensitiveBlurProduct(product) {
  if (!product || typeof product !== 'object') return false
  if (product.sensitiveBlur === true || product.sensitiveBlur === 1) return true
  if (product.contentWarning === true || product.contentWarning === 1) return true
  return false
}

/**
 * 归一化偏好值；兼容旧别名 show→clear、blur→veil
 * @returns {'veil'|'clear'|null}
 */
function normalizeSensitiveBlurPref(raw) {
  const v = String(raw || '').trim().toLowerCase()
  if (v === PREF_VEIL || v === 'blur') return PREF_VEIL
  if (v === PREF_CLEAR || v === 'show') return PREF_CLEAR
  return null
}

function migrateLegacyLocalPref() {
  try {
    const legacy = wx.getStorageSync('sensitive_display_v1')
    const mapped = normalizeSensitiveBlurPref(legacy)
    if (mapped) {
      wx.setStorageSync(PREF_STORAGE_KEY, mapped)
      try { wx.removeStorageSync('sensitive_display_v1') } catch (e2) { /* ignore */ }
      return mapped
    }
  } catch (e) { /* ignore */ }
  return null
}

function readStoredPref() {
  try {
    const raw = wx.getStorageSync(PREF_STORAGE_KEY)
    const normalized = normalizeSensitiveBlurPref(raw)
    if (normalized) return normalized
  } catch (e) { /* ignore */ }
  return migrateLegacyLocalPref()
}

/** @returns {'veil'|'clear'|null} null=尚未询问 */
function getSensitiveBlurPref() {
  return readStoredPref()
}

function hasSensitiveBlurPref() {
  return getSensitiveBlurPref() != null
}

function notifyPrefListeners(pref) {
  prefListeners.forEach((fn) => {
    try { fn(pref) } catch (e) { /* ignore */ }
  })
}

/**
 * 仅写本机并通知 Gate（同步）
 * @param {'veil'|'clear'} pref
 */
function setSensitiveBlurPref(pref) {
  const next = normalizeSensitiveBlurPref(pref)
  if (!next) return getSensitiveBlurPref()
  try {
    wx.setStorageSync(PREF_STORAGE_KEY, next)
  } catch (e) { /* ignore */ }
  if (next === PREF_CLEAR) {
    forcedVeilIds.clear()
  }
  notifyPrefListeners(next)
  return next
}

/**
 * 从用户档同步本机；空值不覆盖已有本机选择
 */
function applySensitiveBlurPrefFromUser(userOrPref) {
  const raw = userOrPref && typeof userOrPref === 'object'
    ? (userOrPref.sensitiveBlurPref != null
      ? userOrPref.sensitiveBlurPref
      : userOrPref.sensitiveDisplay)
    : userOrPref
  const next = normalizeSensitiveBlurPref(raw)
  if (!next) return getSensitiveBlurPref()
  return setSensitiveBlurPref(next)
}

/**
 * 本机立即生效；已登录则写云 users.sensitiveBlurPref
 * @returns {Promise<'veil'|'clear'|null>}
 */
function persistSensitiveBlurPref(pref, options) {
  const next = setSensitiveBlurPref(pref)
  const skipCloud = !!(options && options.skipCloud)
  if (!next || skipCloud || !wx.cloud) return Promise.resolve(next)

  const patch = {}
  patch[CLOUD_FIELD] = next

  return wx.cloud.callFunction({
    name: 'upsertUserProfile',
    data: { patch }
  }).then((res) => {
    const payload = (res && res.result) || {}
    if (payload.success) {
      try {
        const app = getApp()
        if (app && app.globalData) {
          if (payload.user) app.globalData.userInfo = payload.user
          const session = app.globalData.userSession
          if (session && session.user) {
            session.user = Object.assign({}, session.user, patch)
          }
        }
      } catch (e) { /* ignore */ }
    }
    return next
  }).catch(() => next)
}

function subscribeSensitiveBlurPref(fn) {
  if (typeof fn !== 'function') return function noop() {}
  prefListeners.add(fn)
  return function unsubscribe() {
    prefListeners.delete(fn)
  }
}

function isSensitiveRevealed(productOrId) {
  const key = productIdKey(productOrId)
  return !!(key && revealedIds.has(key))
}

function markSensitiveRevealed(productOrId) {
  const key = productIdKey(productOrId)
  if (!key) return
  revealedIds.add(key)
  forcedVeilIds.delete(key)
}

function clearSensitiveRevealed(productOrId) {
  const key = productIdKey(productOrId)
  if (!key) return
  revealedIds.delete(key)
  if (getSensitiveBlurPref() === PREF_CLEAR) {
    forcedVeilIds.add(key)
  }
}

/** 是否应对封面做模糊 */
function shouldVeilSensitive(product) {
  if (!isSensitiveBlurProduct(product)) return false
  const key = productIdKey(product)
  if (!key) return true
  const pref = getSensitiveBlurPref()
  if (pref === PREF_CLEAR) {
    return forcedVeilIds.has(key)
  }
  return !revealedIds.has(key)
}

/** 组件内根据 productId 计算是否罩住 */
function shouldVeilById(productId) {
  const key = productIdKey(productId)
  if (!key) return true
  const pref = getSensitiveBlurPref()
  if (pref === PREF_CLEAR) {
    return forcedVeilIds.has(key)
  }
  return !revealedIds.has(key)
}

module.exports = {
  COPY,
  PREF_STORAGE_KEY,
  PREF_VEIL,
  PREF_CLEAR,
  CLOUD_FIELD,
  DISPLAY_OPTIONS,
  isSensitiveBlurProduct,
  isSensitiveRevealed,
  markSensitiveRevealed,
  clearSensitiveRevealed,
  shouldVeilSensitive,
  shouldVeilById,
  normalizeSensitiveBlurPref,
  getSensitiveBlurPref,
  hasSensitiveBlurPref,
  setSensitiveBlurPref,
  applySensitiveBlurPrefFromUser,
  persistSensitiveBlurPref,
  subscribeSensitiveBlurPref,
  productIdKey
}
