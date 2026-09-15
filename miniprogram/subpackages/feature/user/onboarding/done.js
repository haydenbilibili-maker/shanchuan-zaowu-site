// subpackages/feature/user/onboarding/done.js
const app = getApp()
const { getPageNavInsets, rpxToPx } = require('../../utils/pageNav')
const { getWindowInfo } = require('../../../../utils/systemInfo')
const {
  refreshSessionAfterAuth,
  leaveOnboardingToReturn,
  peekOnboardingReturn
} = require('../../../../utils/userSession')
const { REGISTER_GIFT } = require('../../../../utils/profileConstants')

const AUTO_BROWSE_MS = 1200
const AUTO_RETURN_MS = 800

Page({
  data: {
    hasReward: false,
    hasRegisterGift: false,
    giftPartial: false,
    giftFail: false,
    giftPoints: REGISTER_GIFT.points || 0,
    giftCoupons: (REGISTER_GIFT.coupons || []).length,
    giftMsg: '',
    repairing: false,
    autoBrowse: false,
    autoReturn: false,
    hasReturn: false,
    primaryCta: '开始逛馆',
    pagePadTop: 80,
    pagePadBottom: 32,
    pagePadX: 32
  },

  onLoad(options) {
    const nav = getPageNavInsets({ nativeNav: true })
    const win = getWindowInfo()
    const points = parseInt(options.points, 10)
    const coupons = parseInt(options.coupons, 10)
    let giftMsg = ''
    try {
      giftMsg = options.msg ? decodeURIComponent(options.msg) : ''
    } catch (e) {
      giftMsg = options.msg || ''
    }
    const autoBrowse = options.autoBrowse === '1'
    const autoReturn = options.autoReturn === '1'
    const stored = peekOnboardingReturn() || {}
    const hasReturn = autoReturn || !!(stored.returnUrl || stored.returnMode === 'back')
    const from = options.from || stored.from || ''
    let primaryCta = '开始逛馆'
    if (hasReturn) {
      if (from === 'checkout') primaryCta = '继续下单'
      else if (from === 'booking') primaryCta = '继续预约'
      else if (from === 'gift') primaryCta = '继续收下'
      else primaryCta = '返回继续'
    }

    this.setData({
      hasReward: options.reward === '1',
      hasRegisterGift: options.gift === '1',
      giftPartial: options.giftPartial === '1',
      giftFail: options.giftFail === '1',
      giftPoints: Number.isFinite(points) && points >= 0 ? points : (REGISTER_GIFT.points || 0),
      giftCoupons: Number.isFinite(coupons) && coupons >= 0
        ? coupons
        : (REGISTER_GIFT.coupons || []).length,
      giftMsg,
      autoBrowse: autoBrowse && !hasReturn,
      autoReturn: hasReturn && options.giftFail !== '1' && options.giftPartial !== '1',
      hasReturn,
      primaryCta,
      pagePadTop: nav.headerBlockPx + rpxToPx(48, win.windowWidth),
      pagePadBottom: nav.safeBottom + rpxToPx(32, win.windowWidth),
      pagePadX: rpxToPx(32, win.windowWidth)
    })

    if (hasReturn && options.giftFail !== '1' && options.giftPartial !== '1') {
      this._autoTimer = setTimeout(() => this.goPrimary(), AUTO_RETURN_MS)
    } else if (autoBrowse && !hasReturn) {
      this._autoTimer = setTimeout(() => this.goBrowse(), AUTO_BROWSE_MS)
    }
  },

  onUnload() {
    if (this._autoTimer) {
      clearTimeout(this._autoTimer)
      this._autoTimer = null
    }
  },

  async retryGift() {
    if (this.data.repairing) return
    this.setData({ repairing: true })
    wx.showLoading({ title: '正在补领', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'upsertUserProfile',
        data: { patch: {}, repairRegisterGift: true }
      })
      const payload = res.result || {}
      wx.hideLoading()
      if (!payload.success) {
        wx.showToast({ title: payload.msg || '补领未完成', icon: 'none' })
        return
      }
      const gift = payload.registerGift || {}
      const ok = !!(gift.claimed || gift.alreadyGranted) && !gift.error && !gift.partial
      const partial = !!gift.partial
      await refreshSessionAfterAuth(app)
      this.setData({
        hasRegisterGift: ok || partial || !!(gift.claimed || gift.alreadyGranted),
        giftPartial: partial,
        giftFail: !!(gift.error || gift.empty || (!ok && !partial && !gift.disabled && !gift.alreadyGranted && !gift.claimed)),
        giftPoints: Number(gift.points) >= 0 ? Number(gift.points) : this.data.giftPoints,
        giftCoupons: Number(gift.couponCount) >= 0 ? Number(gift.couponCount) : this.data.giftCoupons,
        giftMsg: gift.msg || ''
      })
      if (ok) {
        this._autoTimer = setTimeout(
          () => this.goPrimary(),
          this.data.hasReturn ? AUTO_RETURN_MS : AUTO_BROWSE_MS
        )
      } else if (partial) {
        wx.showToast({ title: gift.msg || '礼券仍未齐，请稍后再试', icon: 'none' })
      } else if (gift.disabled) {
        wx.showToast({ title: gift.msg || '礼包暂未开放', icon: 'none' })
      } else {
        wx.showToast({ title: gift.msg || '补领未完成，请稍后再试', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ repairing: false })
    }
  },

  goPrimary() {
    if (this._autoTimer) {
      clearTimeout(this._autoTimer)
      this._autoTimer = null
    }
    if (this.data.hasReturn) {
      const handled = leaveOnboardingToReturn(() => this.goBrowse())
      if (!handled) this.goBrowse()
      return
    }
    this.goBrowse()
  },

  goBrowse() {
    if (this._autoTimer) {
      clearTimeout(this._autoTimer)
      this._autoTimer = null
    }
    wx.switchTab({
      url: '/pages/index/index',
      fail: () => wx.switchTab({ url: '/pages/user/index' })
    })
  },

  goCoupons() {
    if (this._autoTimer) {
      clearTimeout(this._autoTimer)
      this._autoTimer = null
    }
    wx.navigateTo({
      url: '/subpackages/business/coupons/index',
      fail: () => this.goPrimary()
    })
  }
})
