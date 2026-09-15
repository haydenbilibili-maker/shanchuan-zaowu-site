const { fetchMyCoupons } = require('../../../utils/couponService')
const { ensureOpenId } = require('../../../utils/orderScope')
const {
  isLocalLoggedOut,
  resumeLocalSession,
  ensureSession,
  needsOnboarding,
  navigateToOnboarding
} = require('../../../utils/userSession')
const {
  REDEEM_POLL_MS,
  REDEEM_ANIM_MS,
  softVibrate,
  pollMemberPassRedeem,
  shouldAcceptRedeem,
  formatRedeemValueText
} = require('../../../utils/passRedeemFeedback')

const SOURCE_LABELS = {
  points_exchange: '积分兑换',
  transfer: '好友转赠',
  system: '官方发放',
  register_gift: '新客礼',
  birthday_gift: '生日礼券'
}

function useLabelForChannel(item) {
  if (!item || !item.canUse) return ''
  if (item.canUseOnline && item.canUseStore) return '去使用'
  if (item.canUseStore) return '到店亮码'
  return '线上使用'
}

Page({
  data: {
    coupons: [],
    usableCouponCount: 0,
    loading: true,
    loadError: false,
    emptyCtaText: '去积分中心兑换',
    needOnboarding: false,
    needLogin: false,

    // 双渠道选择底栏
    showUseSheet: false,
    sheetCoupon: null,

    // 到店亮码
    showPassModal: false,
    passState: 'loading', // loading | ready | error | redeemed
    passErrorMsg: '',
    passCountdown: 60,
    memberNo: '',
    passCouponTip: '',
    passCouponTitle: '',
    redeemTitle: '',
    redeemValue: 0,
    redeemValueText: '',
    redeemAnimating: false
  },

  onShow() {
    this.loadCoupons()
    this.refreshEmptyCta()
    // 息屏/切后台后回来：保持弹层，恢复倒计时与核销轮询
    if (this.data.showPassModal && this.data.passState !== 'redeemed') {
      this.boostPassBrightness()
      if (this.data.passState === 'ready' || this.data.passState === 'loading') {
        this.startPassTimer()
        this.startRedeemPoll()
      }
    }
  },

  applyGuestCouponsState() {
    this.stopPassTimer()
    this.stopRedeemPoll()
    this.restorePassBrightness()
    this._acceptRedeem = false
    this._passWatchArmed = false
    this.setData({
      needLogin: true,
      needOnboarding: false,
      emptyCtaText: '重新进入',
      coupons: [],
      usableCouponCount: 0,
      loading: false,
      loadError: false,
      memberNo: '',
      showPassModal: false,
      showUseSheet: false,
      sheetCoupon: null,
      passCouponTip: '',
      passCouponTitle: '',
      redeemTitle: '',
      redeemValue: 0,
      redeemValueText: '',
      redeemAnimating: false
    })
  },

  async refreshEmptyCta() {
    if (isLocalLoggedOut()) {
      this.setData({
        needLogin: true,
        needOnboarding: false,
        emptyCtaText: '重新进入'
      })
      return
    }
    try {
      const session = await ensureSession(getApp())
      if (isLocalLoggedOut()) {
        this.applyGuestCouponsState()
        return
      }
      const need = needsOnboarding(session)
      this.setData({
        needLogin: false,
        needOnboarding: need,
        emptyCtaText: need ? '领取新客礼' : '去积分中心兑换'
      })
    } catch (e) {
      this.setData({ needOnboarding: false, emptyCtaText: '去积分中心兑换' })
    }
  },

  onHide() {
    // 关键：切后台/息屏会触发 onHide。若此处 closePassModal，店员核销成功后顾客永远看不到成功态。
    // 只停定时器；弹层状态与亮度保持，onShow 再恢复轮询。
    this.stopRedeemPoll()
    this.stopPassTimer()
  },

  onUnload() {
    this.closePassModal()
  },

  async loadCoupons() {
    if (this._loadingCoupons) return
    if (isLocalLoggedOut()) {
      this.applyGuestCouponsState()
      return
    }
    this._loadingCoupons = true
    this.setData({ loading: true, loadError: false, needLogin: false })

    try {
      const result = await fetchMyCoupons()
      if (isLocalLoggedOut()) {
        this.applyGuestCouponsState()
        return
      }
      const list = (result.list || []).map((item) => ({
        ...item,
        sourceLabel: SOURCE_LABELS[item.source] || '',
        costPoints: item.costPoints || item.cost || 0,
        useLabel: useLabelForChannel(item)
      }))

      this.setData({
        coupons: list,
        usableCouponCount: list.filter((c) => c && c.canUse).length,
        loading: false,
        loadError: !result.ok,
        needLogin: false
      })
    } catch (err) {
      console.error('加载优惠券失败', err)
      this.setData({ coupons: [], usableCouponCount: 0, loading: false, loadError: true })
    } finally {
      this._loadingCoupons = false
    }
  },

  useCoupon(e) {
    if (isLocalLoggedOut()) {
      this.goResumeLogin()
      return
    }
    softVibrate('light')
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const canOnline = ds.canOnline === true || ds.canOnline === 'true'
    const canStore = ds.canStore === true || ds.canStore === 'true'
    const coupon = {
      id: ds.id || '',
      title: ds.title || '礼券',
      value: Number(ds.value) || 0,
      minSpend: Number(ds.min) || 0,
      canOnline,
      canStore
    }

    if (!canOnline && canStore) {
      this.openPassForCoupon(coupon)
      return
    }

    if (canOnline && canStore) {
      this.setData({ showUseSheet: true, sheetCoupon: coupon })
      return
    }

    this.goOnlineUse()
  },

  closeUseSheet() {
    this.setData({ showUseSheet: false, sheetCoupon: null })
  },

  onSheetOnline() {
    this.closeUseSheet()
    this.goOnlineUse()
  },

  onSheetStore() {
    const coupon = this.data.sheetCoupon
    this.closeUseSheet()
    this.openPassForCoupon(coupon || {})
  },

  goOnlineUse() {
    softVibrate('light')
    wx.switchTab({
      url: '/pages/cart/index',
      success: () => {
        wx.showToast({ title: '请先选择藏品下单抵扣', icon: 'none', duration: 2000 })
      },
      fail: () => {
        wx.switchTab({
          url: '/pages/index/index',
          success: () => wx.showToast({ title: '请选购后下单使用', icon: 'none' })
        })
      }
    })
  },

  buildPassTip(coupon) {
    const title = (coupon && coupon.title) || '礼券'
    const value = Number(coupon && coupon.value) || 0
    const minSpend = Number(coupon && coupon.minSpend) || 0
    const face = value > 0 ? `¥${value}` : title
    const gate = minSpend > 0 ? `满 ¥${minSpend}` : '无门槛'
    return {
      passCouponTitle: title,
      passCouponTip: `请店员核销 · ${face} · ${gate}`
    }
  },

  /** 新开亮码会话：清掉上次 redeemed / 旧 token，避免再开立刻命中历史核销 */
  beginPassSession(coupon) {
    this.stopPassTimer()
    this.stopRedeemPoll()
    this._passSession = (this._passSession || 0) + 1
    this._acceptRedeem = false
    this._passWatchArmed = false
    this._passPreferredCouponId = String((coupon && coupon.id) || '').trim()
    this._passToken = ''
    this._passValue = Number(coupon && coupon.value) || 0
    this._passRefreshing = false
    return this._passSession
  },

  async openPassForCoupon(coupon) {
    softVibrate('medium')
    if (isLocalLoggedOut()) {
      this.goResumeLogin()
      return
    }
    const tip = this.buildPassTip(coupon)
    const openid = await ensureOpenId(getApp())
    if (!openid) {
      wx.showToast({ title: '请先登录后再亮码', icon: 'none' })
      return
    }

    this.beginPassSession(coupon || {})

    this.setData({
      showPassModal: true,
      passState: 'loading',
      passErrorMsg: '',
      passCountdown: 60,
      memberNo: '',
      redeemTitle: '',
      redeemValue: 0,
      redeemValueText: '',
      redeemAnimating: false,
      ...tip
    })
    this.boostPassBrightness()
    this.refreshPassQr()
    this.startPassTimer()
    // 等本会话发码成功后再启轮询，禁止用上次核销结果立刻打成功态
  },

  boostPassBrightness() {
    if (this._prevBrightness != null) {
      try {
        wx.setScreenBrightness({ value: 0.92, fail: () => {} })
      } catch (e) { /* ignore */ }
      return
    }
    try {
      wx.getScreenBrightness({
        success: (res) => {
          this._prevBrightness = res.value
          wx.setScreenBrightness({ value: 0.92, fail: () => {} })
        }
      })
    } catch (e) { /* ignore */ }
  },

  restorePassBrightness() {
    if (this._prevBrightness == null) return
    try {
      wx.setScreenBrightness({ value: this._prevBrightness, fail: () => {} })
    } catch (e) { /* ignore */ }
    this._prevBrightness = null
  },

  startPassTimer() {
    this.stopPassTimer()
    this._passTimer = setInterval(() => {
      if (!this.data.showPassModal || this.data.passState === 'redeemed') {
        this.stopPassTimer()
        return
      }
      if (this._passRefreshing) return
      const next = (this.data.passCountdown || 0) - 1
      if (next <= 0) {
        this.setData({ passCountdown: 0 })
        this.refreshPassQr()
      } else {
        this.setData({ passCountdown: next })
      }
    }, 1000)
  },

  stopPassTimer() {
    if (this._passTimer) {
      clearInterval(this._passTimer)
      this._passTimer = null
    }
    this._passRefreshing = false
  },

  startRedeemPoll() {
    this.stopRedeemPoll()
    if (!this._acceptRedeem) return
    // 必须以券 ID 为主；token 仅作辅。无券 ID 且尚无 token 时等发码后再启。
    if (!this._passPreferredCouponId && !this._passToken) return
    this._redeemPollTimer = setInterval(() => {
      this.pollRedeemStatus()
    }, REDEEM_POLL_MS)
    // 立刻查一次，缩短店员核销后的感知延迟
    this.pollRedeemStatus()
  },

  stopRedeemPoll() {
    if (this._redeemPollTimer) {
      clearInterval(this._redeemPollTimer)
      this._redeemPollTimer = null
    }
    this._redeemPolling = false
  },

  /**
   * 发码成功后启用核销监听（每会话仅一次基线）。
   * 若打开时券已是历史核销，不弹成功态，只展示新码。
   */
  async armRedeemWatch(session) {
    if (session !== this._passSession) return
    if (this._passWatchArmed) {
      this._acceptRedeem = true
      if (!this._redeemPollTimer) this.startRedeemPoll()
      return
    }
    this._passWatchArmed = true
    if (!this.data.showPassModal || this.data.passState === 'redeemed') return
    const preferredCouponId = String(this._passPreferredCouponId || '').trim()
    const token = String(this._passToken || '').trim()
    if (preferredCouponId || token) {
      try {
        const baseline = await pollMemberPassRedeem({ preferredCouponId, token })
        if (session !== this._passSession) return
        if (shouldAcceptRedeem(baseline, { preferredCouponId })) {
          this._passPreferredCouponId = ''
        }
      } catch (e) { /* ignore */ }
    }
    if (session !== this._passSession) return
    if (!this.data.showPassModal || this.data.passState === 'redeemed') return
    this._acceptRedeem = true
    if (!this._redeemPollTimer) this.startRedeemPoll()
  },

  async pollRedeemStatus() {
    if (this._redeemPolling) return
    if (!this._acceptRedeem) return
    if (!this.data.showPassModal || this.data.passState === 'redeemed') return
    const session = this._passSession
    const preferredCouponId = String(this._passPreferredCouponId || '').trim()
    const token = String(this._passToken || '').trim()
    if (!preferredCouponId && !token) return

    this._redeemPolling = true
    try {
      const payload = await pollMemberPassRedeem({ preferredCouponId, token })
      if (session !== this._passSession || !this._acceptRedeem) return
      if (!this.data.showPassModal || this.data.passState === 'redeemed') return
      if (shouldAcceptRedeem(payload, { preferredCouponId })) {
        this.onPassRedeemed(payload)
      }
    } catch (e) {
      // 轮询失败静默，下轮再试
    } finally {
      this._redeemPolling = false
    }
  },

  onPassRedeemed(payload) {
    if (this.data.passState === 'redeemed') return
    this._acceptRedeem = false
    this.stopRedeemPoll()
    this.stopPassTimer()

    const title = (payload && payload.title) || this.data.passCouponTitle || '礼券'
    const value = Number((payload && payload.value) != null ? payload.value : this._passValue) || 0
    const redeemValueText = formatRedeemValueText(value)

    softVibrate('medium')
    this.setData({
      passState: 'redeemed',
      passCountdown: 0,
      passCouponTip: '',
      redeemTitle: title,
      redeemValue: value,
      redeemValueText,
      redeemAnimating: true
    })
    try {
      wx.showToast({ title: '核销成功', icon: 'success', duration: 1800 })
    } catch (e) { /* ignore */ }

    // 动画结束后保持结果卡；顺带刷新券列表状态
    setTimeout(() => {
      if (!this.data.showPassModal) return
      this.setData({ redeemAnimating: false })
    }, REDEEM_ANIM_MS)
    this.loadCoupons()
  },

  async refreshPassQr() {
    if (this._passRefreshing) return
    if (this.data.passState === 'redeemed') return
    if (isLocalLoggedOut()) {
      this.closePassModal()
      this.applyGuestCouponsState()
      return
    }
    const session = this._passSession
    this._passRefreshing = true
    try {
      const preferredCouponId = String(this._passPreferredCouponId || '').trim()
      const res = await wx.cloud.callFunction({
        name: 'getMemberPass',
        data: {
          action: 'issue',
          ...(preferredCouponId ? { preferredCouponId } : {})
        }
      })
      const payload = (res && res.result) || {}
      if (session !== this._passSession) return
      if (!this.data.showPassModal || this.data.passState === 'redeemed') return
      if (!payload.success || !payload.token) {
        this.setData({
          passState: 'error',
          passErrorMsg: payload.msg || '会员码生成失败',
          passCountdown: 0
        })
        return
      }
      this._passToken = payload.token
      const qrPayload = payload.qrPayload || payload.token
      this.setData({
        passState: 'ready',
        passErrorMsg: '',
        passCountdown: 60,
        memberNo: payload.memberNo || ''
      })
      this.drawPassQr(qrPayload)
      this.armRedeemWatch(session)
    } catch (e) {
      if (session !== this._passSession) return
      if (!this.data.showPassModal || this.data.passState === 'redeemed') return
      this.setData({
        passState: 'error',
        passErrorMsg: '会员码暂时无法刷新',
        passCountdown: 0
      })
    } finally {
      this._passRefreshing = false
    }
  },

  drawPassQr(payload, attempt = 0) {
    if (!payload || !this.data.showPassModal || this.data.passState === 'redeemed') return
    const runDraw = (drawMemberQr) => {
      drawMemberQr('#couponPassQrCanvas', payload, this, 300, {
        bg: '#F2EDE4',
        fg: '#1A1814',
        margin: 14
      }).then((ok) => {
        if (ok || !this.data.showPassModal || this.data.passState === 'redeemed') return
        if (attempt < 4) {
          setTimeout(() => this.drawPassQr(payload, attempt + 1), 180)
          return
        }
        this.setData({
          passState: 'error',
          passErrorMsg: '二维码绘制失败，可出示下方编号'
        })
      })
    }
    if (this._drawMemberQr) {
      runDraw(this._drawMemberQr)
      return
    }
    require
      .async('../utils/qrCanvas.js')
      .then((mod) => {
        this._drawMemberQr = mod.drawMemberQr
        runDraw(this._drawMemberQr)
      })
      .catch(() => {
        if (attempt < 4) setTimeout(() => this.drawPassQr(payload, attempt + 1), 180)
      })
  },

  closePassModal() {
    const wasRedeemed = this.data.passState === 'redeemed'
    this.stopPassTimer()
    this.stopRedeemPoll()
    this._passPreferredCouponId = ''
    this._passToken = ''
    this._passValue = 0
    this._acceptRedeem = false
    this._passWatchArmed = false
    this._passSession = (this._passSession || 0) + 1
    this.setData({
      showPassModal: false,
      passState: 'loading',
      passCouponTip: '',
      passCouponTitle: '',
      redeemTitle: '',
      redeemValue: 0,
      redeemValueText: '',
      redeemAnimating: false,
      memberNo: ''
    })
    this.restorePassBrightness()
    if (wasRedeemed) this.loadCoupons()
  },

  preventClose() {},

  async goResumeLogin() {
    if (this._resumingLogin) return
    this._resumingLogin = true
    wx.showLoading({ title: '进入中', mask: true })
    try {
      resumeLocalSession()
      await ensureSession(getApp(), { force: true })
      wx.hideLoading()
      this.setData({ needLogin: false })
      await this.loadCoupons()
      this.refreshEmptyCta()
      wx.showToast({ title: '已重新进入', icon: 'none' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '进入失败，请重试', icon: 'none' })
    } finally {
      this._resumingLogin = false
    }
  },

  goWelcomeOrPoints() {
    if (this.data.needLogin || isLocalLoggedOut()) {
      this.goResumeLogin()
      return
    }
    if (this.data.needOnboarding) {
      navigateToOnboarding({ from: 'hub' })
      return
    }
    this.goPoints()
  },

  goPoints() {
    wx.navigateTo({
      url: '/subpackages/business/points/index',
      fail: () => wx.showToast({ title: '积分中心暂不可用', icon: 'none' })
    })
  }
})
