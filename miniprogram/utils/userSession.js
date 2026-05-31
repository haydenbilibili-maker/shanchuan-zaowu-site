/**
 * 用户会话 — 客户端封装
 */

const { resolveAuthState } = require('./profileHelper')

function getAppSafe() {
  try {
    return getApp()
  } catch (e) {
    return null
  }
}

function ensureOpenId(app) {
  const target = app || getAppSafe()
  return new Promise((resolve) => {
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
  try {
    const res = await wx.cloud.callFunction({ name: 'getUserSession', data: {} })
    const payload = res.result || {}
    if (!payload.success) return payload

    const target = app || getAppSafe()
    if (target && target.globalData) {
      target.globalData.openid = payload.openid || target.globalData.openid
      target.globalData.userInfo = payload.user || null
      target.globalData.userSession = payload
    }
    return payload
  } catch (e) {
    console.warn('fetchUserSession', e)
    return { success: false, msg: e.message || '会话加载失败' }
  }
}

async function ensureSession(app) {
  const target = app || getAppSafe()
  if (target && target.globalData && target.globalData.userSession && target.globalData.userSession.success) {
    return target.globalData.userSession
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

/** 收货地址 / 预约联系人手机号（不要求已写入用户档案） */
function isValidContactPhone(phone) {
  if (phone == null || phone === '') return false
  const normalized = String(phone).replace(/[\s-]/g, '')
  return /^1\d{10}$/.test(normalized)
}

function promptPhoneBind(options = {}) {
  const { title = '绑定手机号', content = '下单与预约需要绑定手机号，以便接收订单与门店通知。' } = options
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText: '去绑定',
      cancelText: '稍后',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({
            url: '/pages/user/onboarding/index?step=2&from=gate',
            fail: () => wx.switchTab({ url: '/pages/user/index' })
          })
          resolve(false)
        } else {
          resolve(false)
        }
      }
    })
  })
}

async function requirePhone(app, options = {}) {
  if (isValidContactPhone(options.contactPhone)) return true

  const session = await ensureSession(app)
  if (hasPhone(session)) return true
  await promptPhoneBind(options)
  return false
}

async function requireRegistered(app) {
  const session = await ensureSession(app)
  const state = session.authState || resolveAuthState(session.user)
  if (state !== 'guest' && session.user && session.user.nickName) return true
  wx.showModal({
    title: '完善藏家身份',
    content: '请先完成基础注册，以便使用此功能。',
    confirmText: '去完善',
    success: (res) => {
      if (res.confirm) {
        wx.navigateTo({ url: '/pages/user/onboarding/index?from=gate' })
      }
    }
  })
  return false
}

module.exports = {
  ensureOpenId,
  fetchUserSession,
  ensureSession,
  needsOnboarding,
  hasPhone,
  isValidContactPhone,
  requirePhone,
  requireRegistered,
  promptPhoneBind
}
