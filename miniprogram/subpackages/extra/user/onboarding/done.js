// subpackages/extra/user/onboarding/done.js
const app = getApp()
const { getPageNavInsets, rpxToPx } = require('../../utils/pageNav')
const { getWindowInfo } = require('../../../../utils/systemInfo')
const {
  refreshSessionAfterAuth,
  leaveOnboardingToReturn,
  peekOnboardingReturn
} = require('../../../../utils/userSession')
const { REGISTER_GIFT } = require('../../../../utils/profileConstants')

/**
 * 注册完成 / 欢迎页
 *
 * 交互原则（2026-09-15 改版）：
 * - **不做任何自动跳转**。旧版会在 1.2s / 0.8s 后自动带走用户，
 *   既看不到礼包明细，也没机会选择去礼券夹核销。现在一律由用户点选。
 * - 两个明确去处：逛馆 / 去礼券夹核销；若来自结算等路径，主按钮变为「继续…」。
 */
Page({
  data: {
    nickName: '',
    hasReward: false,
    hasRegisterGift: false,
    giftPartial: false,
    giftFail: false,
    giftPoints: REGISTER_GIFT.points || 0,
    giftCoupons: (REGISTER_GIFT.coupons || []).length,
    giftMsg: '',
    /** 本次是「新号注册」还是「老号确认手机号」——文案据此分支，老号不该被承诺新客礼 */
    isNewUser: true,
    welcomeBack: false,
    repairing: false,
    hasReturn: false,
    primaryCta: '开始逛馆',
    showCouponsEntry: false,
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
    // 新号 / 老号：由注册页透传（缺省按新号处理，兼容旧链接）
    const isNewUser = options.isNew !== '0'
    const stored = peekOnboardingReturn() || {}
    // 注意：不再读取 autoBrowse / autoReturn —— 旧链接仍可能带这两个参数，忽略即可
    const hasReturn = !!(stored.returnUrl || stored.returnMode === 'back')
    const from = options.from || stored.from || ''
    let primaryCta = '开始逛馆'
    if (hasReturn) {
      if (from === 'checkout') primaryCta = '继续下单'
      else if (from === 'booking') primaryCta = '继续预约'
      else if (from === 'gift') primaryCta = '继续收下'
      else primaryCta = '返回继续'
    }

    const giftCoupons = Number.isFinite(coupons) && coupons >= 0
      ? coupons
      : (REGISTER_GIFT.coupons || []).length
    const giftOk = options.gift === '1' && options.giftFail !== '1' && options.giftPartial !== '1'

    let nick = ''
    try {
      nick = (app.globalData && app.globalData.userInfo && app.globalData.userInfo.nickName) || ''
    } catch (e) { /* ignore */ }

    this.setData({
      nickName: String(nick || '').trim() || '藏家',
      isNewUser,
      welcomeBack: !isNewUser && !hasReturn,
      hasReward: options.reward === '1',
      hasRegisterGift: options.gift === '1',
      giftPartial: options.giftPartial === '1',
      giftFail: options.giftFail === '1',
      giftPoints: Number.isFinite(points) && points >= 0 ? points : (REGISTER_GIFT.points || 0),
      giftCoupons,
      giftMsg,
      hasReturn,
      primaryCta,
      // 有券才给「去礼券夹核销」入口；异常态下用「补领」按钮替代
      // 老号只有真的补到券才给入口（否则不该出现「0 张礼券」）
      showCouponsEntry: (giftOk && giftCoupons > 0) || (isNewUser && options.gift === '1' && options.giftFail !== '1'),
      pagePadTop: nav.headerBlockPx + rpxToPx(48, win.windowWidth),
      pagePadBottom: nav.safeBottom + rpxToPx(32, win.windowWidth),
      pagePadX: rpxToPx(32, win.windowWidth)
    })
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
      const coupons = Number(gift.couponCount) >= 0 ? Number(gift.couponCount) : this.data.giftCoupons
      await refreshSessionAfterAuth(app)
      this.setData({
        hasRegisterGift: ok || partial || !!(gift.claimed || gift.alreadyGranted),
        giftPartial: partial,
        giftFail: !!(gift.error || gift.empty || (!ok && !partial && !gift.disabled && !gift.alreadyGranted && !gift.claimed)),
        giftPoints: Number(gift.points) >= 0 ? Number(gift.points) : this.data.giftPoints,
        giftCoupons: coupons,
        giftMsg: gift.msg || '',
        // 补领成功后同样不自动跳转，只把「去礼券夹核销」入口放出来
        showCouponsEntry: (ok || partial) && coupons > 0
      })
      if (ok) wx.showToast({ title: gift.msg || '新客礼已到账', icon: 'none', duration: 2000 })
      else if (partial) wx.showToast({ title: gift.msg || '礼券仍未齐，请稍后再试', icon: 'none' })
      else if (gift.disabled) wx.showToast({ title: gift.msg || '礼包暂未开放', icon: 'none' })
      else wx.showToast({ title: gift.msg || '补领未完成，请稍后再试', icon: 'none' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ repairing: false })
    }
  },

  /** 主按钮：来自结算/预约等路径则回到原路径，否则去逛馆 */
  goPrimary() {
    if (this.data.hasReturn) {
      const handled = leaveOnboardingToReturn(() => this.goBrowse())
      if (!handled) this.goBrowse()
      return
    }
    this.goBrowse()
  },

  goBrowse() {
    wx.switchTab({
      url: '/pages/index/index',
      fail: () => wx.switchTab({ url: '/pages/user/index' })
    })
  },

  goCoupons() {
    wx.navigateTo({
      url: '/subpackages/business/coupons/index',
      fail: () => wx.showToast({ title: '礼券夹打开失败，请稍后再试', icon: 'none' })
    })
  }
})
