/**
 * 用户会话 — 客户端封装
 *
 * 微信小程序无法真正退出 OpenID；「退出登录」= 清除本机会话缓存 + guest UI，
 * 直至用户主动「重新进入」才恢复静默登录。
 */

const { resolveAuthState } = require('./profileHelper')

const LOCAL_LOGGED_OUT_KEY = 'sc_local_logged_out'
const ONBOARDING_RETURN_KEY = 'sc_onboarding_return_v1'
const CONFIRM_ORDER_PATH = '/subpackages/business/confirm-order/index'

function getAppSafe() {
  try {
    return getApp()
  } catch (e) {
    return null
  }
}

function isLocalLoggedOut() {
  try {
    return !!wx.getStorageSync(LOCAL_LOGGED_OUT_KEY)
  } catch (e) {
    return false
  }
}

function markLocalLoggedOut(flag) {
  try {
    if (flag) wx.setStorageSync(LOCAL_LOGGED_OUT_KEY, 1)
    else wx.removeStorageSync(LOCAL_LOGGED_OUT_KEY)
  } catch (e) { /* ignore */ }
}

function guestSessionPayload(msg) {
  return { success: false, msg: msg || '未登录', authState: 'guest' }
}

/**
 * 本机退出：清 globalData 会话、相关本地键，并锁定静默登录直至 resume。
 */
function clearLocalSession(app) {
  const target = app || getAppSafe()
  if (target && target.globalData) {
    target.globalData.userInfo = null
    target.globalData.userSession = null
    target.globalData.userSessionLoadedAt = 0
    target.globalData.openid = ''
    target.globalData.cartBadgeCount = 0
  }

  markLocalLoggedOut(true)

  try {
    wx.removeStorageSync('checkoutPayload')
  } catch (e) { /* ignore */ }
  try {
    wx.removeStorageSync('analytics_session_v1')
  } catch (e) { /* ignore */ }
  try {
    const { clearManagerTrust } = require('./managerAuth')
    clearManagerTrust()
  } catch (e) { /* ignore */ }
  try {
    wx.removeStorageSync('staff_role_cache_v1')
  } catch (e) { /* ignore */ }
  try {
    wx.removeStorageSync('stored_value_wallet_snapshot_v1')
  } catch (e) { /* ignore */ }
  try {
    wx.removeStorageSync('member_vip_card_snapshot_v1')
  } catch (e) { /* ignore */ }
  try {
    wx.removeStorageSync('user_addresses_local')
  } catch (e) { /* ignore */ }
  try {
    wx.removeStorageSync(ONBOARDING_RETURN_KEY)
  } catch (e) { /* ignore */ }

  try {
    const { refreshCartTabBadge } = require('./cartHelper')
    if (target) refreshCartTabBadge(target)
  } catch (e) { /* ignore */ }

  return true
}

/** 解除本机退出锁定，允许再次静默登录 */
function resumeLocalSession() {
  markLocalLoggedOut(false)
}

/**
 * 授权/注册成功后恢复会话：清本机退出锁并强制拉取 getUserSession。
 * 退出态用户走完注册若不调用此函数，ensureSession 会一直返回 guest，导致
 * 「我的」仍未登录、结算页反复引导注册。
 */
async function refreshSessionAfterAuth(app) {
  resumeLocalSession()
  const target = app || getAppSafe()
  if (target && target.globalData) {
    target.globalData.userSession = null
    target.globalData.userSessionLoadedAt = 0
  }
  return ensureSession(target, { force: true })
}

function ensureOpenId(app) {
  const target = app || getAppSafe()
  return new Promise((resolve) => {
    if (isLocalLoggedOut()) {
      resolve('')
      return
    }
    if (target && target.globalData && target.globalData.openid) {
      resolve(target.globalData.openid)
      return
    }
    if (!wx.cloud) {
      resolve('')
      return
    }
    wx.cloud.callFunction({
      name: 'login',
      success: (res) => {
        if (isLocalLoggedOut()) {
          resolve('')
          return
        }
        const openid = (res.result && res.result.openid) || ''
        if (openid && target && target.globalData) {
          target.globalData.openid = openid
        }
        resolve(openid)
      },
      fail: () => resolve('')
    })
  })
}

async function fetchUserSession(app) {
  if (isLocalLoggedOut()) {
    return guestSessionPayload('未登录')
  }
  try {
    const res = await wx.cloud.callFunction({ name: 'getUserSession', data: {} })
    const payload = res.result || {}
    if (!payload.success) return payload

    if (isLocalLoggedOut()) {
      return guestSessionPayload('未登录')
    }

    const target = app || getAppSafe()
    if (target && target.globalData) {
      target.globalData.openid = payload.openid || target.globalData.openid
      target.globalData.userInfo = payload.user || null
      target.globalData.userSession = payload
      target.globalData.userSessionLoadedAt = Date.now()
    }
    try {
      const { applySensitiveBlurPrefFromUser } = require('./sensitiveBlur')
      applySensitiveBlurPrefFromUser(payload.user)
    } catch (e) { /* ignore */ }
    return payload
  } catch (e) {
    console.warn('fetchUserSession', e)
    const target = app || getAppSafe()
    const stale = target && target.globalData && target.globalData.userSession
    if (stale && stale.success) return stale
    return { success: false, msg: e.message || '会话加载失败' }
  }
}

const SESSION_FRESH_MS = 2 * 60 * 1000

async function ensureSession(app, options) {
  if (isLocalLoggedOut()) {
    return guestSessionPayload('未登录')
  }
  const force = !!(options && options.force)
  const target = app || getAppSafe()
  const cached = target && target.globalData && target.globalData.userSession
  const loadedAt = (target && target.globalData && target.globalData.userSessionLoadedAt) || 0
  if (!force && cached && cached.success) {
    if (!loadedAt) {
      if (target && target.globalData) target.globalData.userSessionLoadedAt = Date.now()
      return cached
    }
    if (Date.now() - loadedAt < SESSION_FRESH_MS) {
      return cached
    }
    fetchUserSession(target).catch(() => {})
    return cached
  }
  await ensureOpenId(target)
  return fetchUserSession(target)
}

function needsOnboarding(session) {
  if (!session || !session.success) return false
  return !session.onboardingDone
}

function hasPhone(session) {
  return !!(session && session.user && session.user.phone)
}

function saveOnboardingReturn(intent) {
  try {
    if (!intent || (!intent.returnUrl && intent.returnMode !== 'back')) {
      wx.removeStorageSync(ONBOARDING_RETURN_KEY)
      return
    }
    wx.setStorageSync(ONBOARDING_RETURN_KEY, {
      returnUrl: intent.returnUrl || '',
      returnMode: intent.returnMode || '',
      from: intent.from || '',
      resumeSubmit: !!intent.resumeSubmit,
      ts: Date.now()
    })
  } catch (e) { /* ignore */ }
}

function peekOnboardingReturn() {
  try {
    return wx.getStorageSync(ONBOARDING_RETURN_KEY) || null
  } catch (e) {
    return null
  }
}

function consumeOnboardingReturn() {
  try {
    const intent = wx.getStorageSync(ONBOARDING_RETURN_KEY) || null
    wx.removeStorageSync(ONBOARDING_RETURN_KEY)
    return intent
  } catch (e) {
    return null
  }
}

function buildOnboardingUrl(options = {}) {
  const from = options.from || 'gate'
  const parts = [`from=${encodeURIComponent(from)}`]
  if (options.returnUrl) {
    parts.push(`returnUrl=${encodeURIComponent(options.returnUrl)}`)
  }
  if (options.returnMode) {
    parts.push(`returnMode=${encodeURIComponent(options.returnMode)}`)
  }
  if (options.phoneOnly) {
    parts.push('phoneOnly=1')
  }
  return `/subpackages/extra/user/onboarding/index?${parts.join('&')}`
}

function navigateToOnboarding(options = {}) {
  // 防连点：短窗内只跳一次
  if (navigateToOnboarding._lock) return
  navigateToOnboarding._lock = true
  setTimeout(() => {
    navigateToOnboarding._lock = false
  }, 1400)

  const from = options.from || 'gate'
  const returnUrl = options.returnUrl || ''
  const returnMode = options.returnMode || (returnUrl ? 'redirect' : '')
  saveOnboardingReturn({
    returnUrl,
    returnMode,
    from,
    resumeSubmit: !!options.resumeSubmit
  })
  const url = buildOnboardingUrl({
    from,
    returnUrl,
    returnMode,
    phoneOnly: !!options.phoneOnly
  })
  wx.navigateTo({
    url,
    fail: () => {
      wx.redirectTo({
        url,
        fail: () => {
          navigateToOnboarding._lock = false
          wx.switchTab({ url: '/pages/user/index' })
        }
      })
    }
  })
}

/**
 * 注册/绑号完成后的回流：优先 returnMode=back，其次 returnUrl，再次探索。
 * back 模式保留 intent，供目标页 onShow 刷新会话/券；目标页负责 consume。
 */
function leaveOnboardingToReturn(fallbackBrowse) {
  const intent = peekOnboardingReturn() || {}
  const mode = intent.returnMode || ''
  const returnUrl = intent.returnUrl || ''

  if (mode === 'back') {
    try {
      wx.setStorageSync(ONBOARDING_RETURN_KEY, {
        ...intent,
        pendingResume: true,
        ts: Date.now()
      })
    } catch (e) { /* ignore */ }
    wx.navigateBack({
      fail: () => {
        consumeOnboardingReturn()
        if (returnUrl) {
          wx.redirectTo({
            url: returnUrl,
            fail: () => {
              if (fallbackBrowse) fallbackBrowse()
              else wx.switchTab({ url: '/pages/index/index' })
            }
          })
        } else if (fallbackBrowse) {
          fallbackBrowse()
        } else {
          wx.switchTab({ url: '/pages/index/index' })
        }
      }
    })
    return true
  }

  consumeOnboardingReturn()

  if (returnUrl) {
    const isTab = /^\/pages\/(index|category|atelier|cart|user)\/index/.test(returnUrl)
    if (isTab) {
      wx.switchTab({
        url: returnUrl,
        fail: () => (fallbackBrowse ? fallbackBrowse() : null)
      })
    } else {
      wx.redirectTo({
        url: returnUrl,
        fail: () => {
          wx.navigateTo({
            url: returnUrl,
            fail: () => (fallbackBrowse ? fallbackBrowse() : wx.switchTab({ url: '/pages/index/index' }))
          })
        }
      })
    }
    return true
  }

  return false
}

function promptPhoneBind(options = {}) {
  const {
    title = '授权手机号',
    content = '下单与预约需要绑定手机号，以便接收订单与门店通知。',
    confirmText = '去授权',
    cancelText = '稍后',
    from = 'gate',
    returnUrl = '',
    returnMode = '',
    direct = false,
    phoneOnly = false,
    resumeSubmit = false
  } = options

  const go = () => {
    navigateToOnboarding({
      from,
      returnUrl,
      returnMode: returnMode || (returnUrl ? 'redirect' : 'back'),
      phoneOnly,
      resumeSubmit
    })
  }

  if (direct) {
    go()
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText,
      cancelText,
      success: (res) => {
        if (res.confirm) go()
        resolve(false)
      },
      fail: () => resolve(false)
    })
  })
}

async function requirePhone(app, options = {}) {
  const session = await ensureSession(app)
  if (hasPhone(session)) return true

  const needOnboard = needsOnboarding(session)
  const from = options.from || (needOnboard ? 'checkout' : 'phone')
  const phoneOnly = options.phoneOnly != null ? !!options.phoneOnly : (!needOnboard && !!session.onboardingDone)

  await promptPhoneBind({
    title: options.title || (needOnboard ? '授权后即可继续' : '绑定手机号'),
    content: options.content || (needOnboard
      ? '授权手机号即可完成注册并继续，新客礼包将自动到账。'
      : '绑定手机号后即可继续，以便接收订单与门店通知。'),
    confirmText: options.confirmText || (needOnboard ? '去授权' : '去绑定'),
    cancelText: options.cancelText || '稍后',
    from,
    returnUrl: options.returnUrl || '',
    returnMode: options.returnMode || '',
    direct: options.direct === true,
    phoneOnly,
    resumeSubmit: !!options.resumeSubmit
  })
  return false
}

async function requireRegistered(app, options = {}) {
  const session = await ensureSession(app)
  // 判据用「是否已注册」，**不要**用 authState —— 那是资料完善度：
  // 已注册但没填昵称的人 authState 会是 guest，于是被反复要求「注册领新客礼包」。
  // isRegistered 由 getUserSession 下发；老服务端未下发时回退到 onboardingDone / 已绑手机号。
  const registered = session.isRegistered !== undefined
    ? !!session.isRegistered
    : !!(session.onboardingDone || (session.user && session.user.phone))
  if (registered) return true

  await promptPhoneBind({
    title: options.title || '领取新客礼包',
    content: options.content || '授权手机号即可完成注册并领取礼包，只需一步。',
    confirmText: options.confirmText || '去领取',
    from: options.from || 'gate',
    returnUrl: options.returnUrl || '',
    returnMode: options.returnMode || '',
    direct: options.direct === true,
    resumeSubmit: !!options.resumeSubmit
  })
  return false
}

module.exports = {
  LOCAL_LOGGED_OUT_KEY,
  ONBOARDING_RETURN_KEY,
  CONFIRM_ORDER_PATH,
  isLocalLoggedOut,
  clearLocalSession,
  resumeLocalSession,
  refreshSessionAfterAuth,
  ensureOpenId,
  fetchUserSession,
  ensureSession,
  needsOnboarding,
  hasPhone,
  buildOnboardingUrl,
  navigateToOnboarding,
  saveOnboardingReturn,
  peekOnboardingReturn,
  consumeOnboardingReturn,
  leaveOnboardingToReturn,
  requirePhone,
  requireRegistered,
  promptPhoneBind
}
