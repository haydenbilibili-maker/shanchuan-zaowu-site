// subpackages/feature/user/onboarding/index.js
// 单页无感注册：协议 → 手机号一键建档发券；支持 checkout 回流；敏感偏好后置
const app = getApp()
const { trackBehavior } = require('../../../../utils/trackBehavior')
const { REGISTER_GIFT } = require('../../../../utils/profileConstants')
const {
  ensureSession,
  refreshSessionAfterAuth,
  leaveOnboardingToReturn,
  saveOnboardingReturn,
  peekOnboardingReturn
} = require('../../../../utils/userSession')
const { sanitizeNickName, resolvePrefillNickName } = require('../../../../utils/profileHelper')
const { pickAvatarImage, avatarExtFromPath, toastAvatarPickError } = require('../../../../utils/pickAvatar')
const { getPageNavInsets } = require('../../utils/pageNav')

const HEADER_EXTRA_RPX = 56
const FALLBACK_NICK = '藏家'

const GIFT_COUPONS = REGISTER_GIFT.coupons || []

function mapGiftCouponCards(coupons) {
  const list = Array.isArray(coupons) ? coupons : []
  return list.map((c, index) => {
    if (!c || typeof c !== 'object') {
      return { key: `fallback_${index}`, value: String(c), minSpend: 0, label: String(c) }
    }
    const value = Number(c.value) || 0
    const minSpend = Number(c.minSpend) || 0
    const key = String(c.id || `${value}_${minSpend}_${index}`)
    return {
      key,
      value,
      minSpend,
      label: c.label || (minSpend > 0 ? `满${minSpend}可用` : '无门槛')
    }
  })
}

function giftViewFromCoupons(points, coupons) {
  const cards = mapGiftCouponCards(coupons)
  return {
    rewardPoints: Number(points) >= 0 ? Number(points) : (REGISTER_GIFT.points || 0),
    rewardCouponCount: cards.length,
    rewardCouponLines: cards.map((c) => (c.minSpend ? `满 ${c.minSpend} 减 ${c.value}` : c.label)),
    rewardCouponCards: cards
  }
}

const FALLBACK_GIFT_VIEW = giftViewFromCoupons(REGISTER_GIFT.points, GIFT_COUPONS)

const COPY_BY_FROM = {
  checkout: {
    navTitle: '授权后继续',
    navSub: 'CABINET · CONTINUE',
    overline: 'CHECKOUT',
    title: '留下手机号，继续启程',
    desc: '勾选协议并授权即可。未注册将同步建档，新客礼放入账户；已注册仅需确认手机号。',
    ctaPhone: '授权手机号 · 继续下单',
    ctaFinish: '完成并继续下单',
    loading: '正在写入档案'
  },
  phone: {
    navTitle: '绑定手机号',
    navSub: 'VERIFY',
    overline: 'VERIFY',
    title: '确认联系手机',
    desc: '用于订单与门店通知。绑定后即可返回继续。',
    ctaPhone: '授权手机号',
    ctaFinish: '完成绑定',
    loading: '正在绑定'
  },
  booking: {
    navTitle: '授权后继续',
    navSub: 'VISIT',
    overline: 'BOOKING',
    title: '授权后继续预约',
    desc: '勾选协议并授权手机号即可预约；新客礼若未领取将同步放入账户。',
    ctaPhone: '授权手机号 · 继续预约',
    ctaFinish: '完成并继续预约',
    loading: '正在写入档案'
  },
  gift: {
    navTitle: '授权后继续',
    navSub: 'GIFT',
    overline: 'GIFT',
    title: '授权后收下这份山海',
    desc: '勾选协议并授权即可继续；新客礼若未领取将同步放入账户。',
    ctaPhone: '授权手机号 · 继续',
    ctaFinish: '完成并继续',
    loading: '正在写入档案'
  },
  counter_qr: {
    navTitle: '注册领新客礼',
    navSub: 'COUNTER · WELCOME',
    overline: 'COUNTER',
    title: '注册即领新客礼',
    desc: '勾选协议并授权手机号，即可完成注册。新客礼券即时放入账户，结账可直接使用。',
    ctaPhone: '授权手机号 · 领取新客礼',
    ctaFinish: '完成注册 · 领取新客礼',
    loading: '正在放入礼包'
  },
  atlas: {
    navTitle: '收进山海图鉴',
    navSub: 'ATLAS · WELCOME',
    overline: 'ATLAS',
    title: '授权后写入图鉴',
    desc: '勾选协议并授权手机号，即可完成注册并把本次鉴定写入山海图鉴；新客礼同步放入账户。',
    ctaPhone: '授权手机号 · 写入图鉴',
    ctaFinish: '完成并写入图鉴',
    loading: '正在写入档案'
  },
  default: {
    navTitle: '加入山海造物',
    navSub: 'WELCOME · ONE STEP',
    overline: 'CABINET',
    title: '打开你的奇珍柜',
    desc: '勾选协议并授权手机号，即可完成注册。新客礼即时放入账户；昵称与头像选填。',
    ctaPhone: '授权手机号 · 领取新客礼',
    ctaFinish: '完成注册 · 领取新客礼',
    loading: '正在放入礼包'
  }
}

Page({
  data: {
    statusBarHeight: 20,
    navPaddingRight: 16,
    headerBlockPx: 120,
    footerPadPx: 160,
    from: '',
    returnUrl: '',
    returnMode: '',
    phoneOnly: false,
    hasReturn: false,
    showGiftPack: true,
    showProfileExtras: true,
    navTitle: COPY_BY_FROM.default.navTitle,
    navSub: COPY_BY_FROM.default.navSub,
    heroOverline: COPY_BY_FROM.default.overline,
    heroTitle: COPY_BY_FROM.default.title,
    heroDesc: COPY_BY_FROM.default.desc,
    ctaPhoneText: COPY_BY_FROM.default.ctaPhone,
    ctaFinishText: COPY_BY_FROM.default.ctaFinish,
    loadingText: COPY_BY_FROM.default.loading,
    agreed: false,
    avatarUrl: '',
    nickName: '',
    phoneBound: false,
    phoneMasked: '',
    saving: false,
    rewardPoints: FALLBACK_GIFT_VIEW.rewardPoints,
    rewardCouponCount: FALLBACK_GIFT_VIEW.rewardCouponCount,
    rewardCouponLines: FALLBACK_GIFT_VIEW.rewardCouponLines,
    rewardCouponCards: FALLBACK_GIFT_VIEW.rewardCouponCards
  },

  onLoad(options) {
    let from = (options && options.from) || ''
    // 门店/物料小程序码走 scene（wxacode.getUnlimited），内容形如 from=counter_qr
    if (!from && options && options.scene) {
      try {
        const sceneText = decodeURIComponent(String(options.scene))
        const m = /(?:^|[&?])from=([^&]+)/.exec(sceneText)
        if (m && m[1]) from = decodeURIComponent(m[1])
      } catch (e) { /* ignore */ }
    }
    let returnUrl = ''
    try {
      returnUrl = options.returnUrl ? decodeURIComponent(options.returnUrl) : ''
    } catch (e) {
      returnUrl = options.returnUrl || ''
    }
    const returnMode = (options && options.returnMode) || ''
    const phoneOnly = options.phoneOnly === '1' || options.phoneOnly === 'true'
    const stored = peekOnboardingReturn() || {}
    // counter_qr 是独立注册入口：不继承历史回流意图，注册完成后留本页承接而非带回旧场景
    const isStandalone = from === 'counter_qr'
    const resolvedReturnUrl = isStandalone ? returnUrl : (returnUrl || stored.returnUrl || '')
    const resolvedReturnMode = isStandalone ? returnMode : (returnMode || stored.returnMode || (resolvedReturnUrl ? 'redirect' : ''))
    const resolvedFrom = from || stored.from || ''

    if (resolvedReturnUrl || resolvedReturnMode === 'back') {
      saveOnboardingReturn({
        returnUrl: resolvedReturnUrl,
        returnMode: resolvedReturnMode || 'back',
        from: resolvedFrom,
        resumeSubmit: !!stored.resumeSubmit
      })
    }

    const copy = COPY_BY_FROM[resolvedFrom] || COPY_BY_FROM.default
    const isCheckoutLike = ['checkout', 'phone', 'booking', 'gift', 'counter_qr'].indexOf(resolvedFrom) >= 0

    this.setData({
      from: resolvedFrom,
      returnUrl: resolvedReturnUrl,
      returnMode: resolvedReturnMode,
      phoneOnly,
      hasReturn: !!(resolvedReturnUrl || resolvedReturnMode === 'back'),
      showGiftPack: !phoneOnly,
      showProfileExtras: !phoneOnly && !isCheckoutLike,
      navTitle: phoneOnly ? '绑定手机号' : copy.navTitle,
      navSub: phoneOnly ? 'VERIFY' : copy.navSub,
      heroOverline: phoneOnly ? 'VERIFY' : copy.overline,
      heroTitle: phoneOnly ? '确认联系手机' : copy.title,
      heroDesc: phoneOnly
        ? '绑定后即可返回继续。若尚未领取新客礼，将在绑定后自动补发。'
        : copy.desc,
      ctaPhoneText: phoneOnly ? '授权手机号' : copy.ctaPhone,
      ctaFinishText: phoneOnly ? '完成绑定' : copy.ctaFinish,
      loadingText: copy.loading
    })
    trackBehavior('onboarding_start', 'from', resolvedFrom || 'direct')
    this.initLayout()
    this.loadWelcomeGiftPreview()
    this.loadSession()
  },

  onReady() {
    this.remeasureChrome()
  },

  onShow() {
    this.remeasureChrome()
  },

  initLayout() {
    const nav = getPageNavInsets({ headerExtraRpx: HEADER_EXTRA_RPX, nativeNav: true })
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navPaddingRight: nav.navPaddingRight,
      headerBlockPx: nav.headerBlockPx,
      footerPadPx: this.estimateFooterPadPx()
    })
  },

  estimateFooterPadPx() {
    try {
      const sys = wx.getSystemInfoSync()
      const safe = (sys.safeAreaInsets && sys.safeAreaInsets.bottom) || 0
      const rpx = (sys.windowWidth || 375) / 750
      return Math.ceil(200 * rpx * 2) + safe + 24
    } catch (e) {
      return 180
    }
  },

  remeasureChrome() {
    const fallback = getPageNavInsets({ headerExtraRpx: HEADER_EXTRA_RPX, nativeNav: true }).headerBlockPx
    const footerPadPx = this.estimateFooterPadPx()
    wx.createSelectorQuery()
      .in(this)
      .select('.account-nav')
      .boundingClientRect()
      .select('.account-footer')
      .boundingClientRect()
      .exec((res) => {
        const navRect = res && res[0]
        const footRect = res && res[1]
        const headerBlockPx = navRect && navRect.height
          ? Math.ceil(navRect.height)
          : fallback
        const measuredFooter = footRect && footRect.height
          ? Math.ceil(footRect.height) + 16
          : footerPadPx
        this.setData({ headerBlockPx, footerPadPx: measuredFooter })
      })
  },

  async loadWelcomeGiftPreview() {
    if (this.data.phoneOnly || this.data.showGiftPack === false) return
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageWelcomeGift',
        data: { action: 'preview' }
      })
      const result = (res && res.result) || {}
      const data = result.data || {}
      if (!result.success) return
      if (data.enabled === false) {
        this.setData({
          showGiftPack: false,
          ...giftViewFromCoupons(0, [])
        })
        return
      }
      // 会话可能已判定已领取；勿把礼包板块重新打开
      if (this.data.showGiftPack === false) return
      this.setData(giftViewFromCoupons(data.points, data.coupons))
    } catch (e) {
      // 网络失败沿用 REGISTER_GIFT 兜底，不打断注册
      console.warn('loadWelcomeGiftPreview', e)
    }
  },

  async loadSession() {
    const session = await ensureSession(app)
    if (!session.success || !session.user) {
      const prefilled = resolvePrefillNickName(app)
      if (prefilled) this.setData({ nickName: prefilled })
      return
    }
    const u = session.user
    const nickName = sanitizeNickName(u.nickName) || resolvePrefillNickName(app)
    const phoneBound = !!u.phone
    const onboardingDone = !!session.onboardingDone
    const giftClaimed = !!u.registerGiftClaimed && !u.registerGiftIncomplete
    const phoneOnly = this.data.phoneOnly || (onboardingDone && !phoneBound)

    this.setData({
      avatarUrl: u.avatarUrl || '',
      nickName,
      phoneBound,
      phoneMasked: u.phoneMasked || '',
      agreed: !!(u.agreedTermsAt || u.phone || onboardingDone),
      phoneOnly,
      showGiftPack: !phoneOnly && !giftClaimed,
      showProfileExtras: !phoneOnly && !this.data.hasReturn
    })

    if (onboardingDone && phoneBound) {
      if (this.data.hasReturn) {
        this.returnAfterSuccess({ silent: true })
        return
      }
      if (this.data.from !== 'gate' && this.data.from !== 'checkout' && this.data.from !== 'phone') {
        const target = this.data.from === 'counter_qr'
          ? '/subpackages/business/coupons/index'
          : '/subpackages/feature/user/profile/index'
        wx.redirectTo({ url: target })
      }
    }
  },

  async onChangeAvatar() {
    try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* ignore */ }
    try {
      const path = await pickAvatarImage()
      this.setData({ avatarUrl: path })
    } catch (err) {
      toastAvatarPickError(err)
    }
  },

  onNickInput(e) {
    this.setData({ nickName: e.detail.value || '' })
  },

  onNickBlur(e) {
    const raw = (e && e.detail && e.detail.value != null)
      ? e.detail.value
      : this.data.nickName
    const nick = sanitizeNickName(raw)
    if (String(raw || '').trim() && !nick) {
      this.setData({ nickName: '' })
      wx.showToast({ title: '请使用真实昵称', icon: 'none' })
      return
    }
    if (nick !== this.data.nickName) this.setData({ nickName: nick })
  },

  onNicknameReview(e) {
    if (e && e.detail && e.detail.pass === false) {
      this.setData({ nickName: '' })
      wx.showToast({ title: '昵称未通过审核，请换一个', icon: 'none' })
    }
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed })
  },

  openTerms() {
    wx.navigateTo({
      url: '/subpackages/feature/user/legal/index?type=terms',
      fail: () => wx.showToast({ title: '无法打开协议', icon: 'none' })
    })
  },

  openPrivacy() {
    wx.navigateTo({
      url: '/subpackages/feature/user/legal/index?type=privacy',
      fail: () => wx.showToast({ title: '无法打开协议', icon: 'none' })
    })
  },

  onPhoneCtaTap() {
    if (this.data.saving) return
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意协议', icon: 'none' })
    }
  },

  resolveNickName() {
    return sanitizeNickName(this.data.nickName)
      || resolvePrefillNickName(app)
      || FALLBACK_NICK
  },

  async uploadAvatarIfNeeded() {
    const { avatarUrl } = this.data
    if (!avatarUrl || avatarUrl.startsWith('cloud://')) return avatarUrl
    const openid = app.globalData.openid || 'user'
    const ext = avatarExtFromPath(avatarUrl)
    const res = await wx.cloud.uploadFile({
      cloudPath: `avatars/${openid}/${Date.now()}.${ext}`,
      filePath: avatarUrl
    })
    if (!res || !res.fileID) throw new Error('AVATAR_UPLOAD')
    return res.fileID
  },

  buildProfilePatch(avatarUrl) {
    const patch = {
      nickName: this.resolveNickName(),
      agreedTermsAt: new Date().toISOString(),
      onboardingStep: 1
    }
    if (avatarUrl || this.data.avatarUrl) {
      patch.avatarUrl = avatarUrl || this.data.avatarUrl
    }
    return patch
  },

  returnAfterSuccess(opts) {
    const silent = !!(opts && opts.silent)
    if (!silent && !this.data.hasReturn) {
      // 无回流时由完成页承接；此处不叠 toast
    }
    const handled = leaveOnboardingToReturn(() => {
      wx.switchTab({ url: '/pages/index/index' })
    })
    if (!handled) {
      wx.switchTab({ url: '/pages/index/index' })
    }
  },

  goDoneFromPayload(payload) {
    const gift = (payload && payload.registerGift) || {}
    const reward = (payload && payload.reward) || {}
    const giftOk = !!(gift.claimed || gift.alreadyGranted) && !gift.error
    const giftPartial = !!gift.partial
    const giftFailed = !!(gift.error || gift.empty || (!giftOk && !gift.disabled))

    if (this.data.hasReturn && !giftFailed && !giftPartial) {
      this.returnAfterSuccess({ gift, silent: true })
      return
    }

    const rewardFlag = reward.claimed && Number(reward.points) > 0 ? 1 : 0
    const giftFlag = giftOk ? 1 : 0
    const points = Number(gift.points) || 0
    const couponCount = Number(gift.couponCount) || 0
    // 欢迎页已改为「不自动跳转、由用户选择」，故不再下发 autoBrowse / autoReturn

    const q = [
      `reward=${rewardFlag}`,
      `gift=${giftFlag}`,
      `giftPartial=${giftPartial ? 1 : 0}`,
      `giftFail=${giftFailed ? 1 : 0}`,
      `points=${points}`,
      `coupons=${couponCount}`,
      `msg=${encodeURIComponent(gift.msg || '')}`,
      `from=${encodeURIComponent(this.data.from || '')}`
    ].join('&')

    wx.redirectTo({
      url: `/subpackages/feature/user/onboarding/done?${q}`,
      fail: () => {
        if (this.data.hasReturn) this.returnAfterSuccess({ gift, silent: true })
        else wx.switchTab({ url: '/pages/index/index' })
      }
    })
  },

  async finishRegistration(extra) {
    const avatarUrl = this.data.showProfileExtras
      ? await this.uploadAvatarIfNeeded()
      : (this.data.avatarUrl && this.data.avatarUrl.startsWith('cloud://') ? this.data.avatarUrl : '')
    if (avatarUrl) this.setData({ avatarUrl })
    const patch = this.buildProfilePatch(avatarUrl)

    if (extra && extra.phoneCode) {
      const res = await wx.cloud.callFunction({
        name: 'authPhone',
        data: {
          code: extra.phoneCode,
          finishRegistration: true,
          patch
        }
      })
      const payload = res.result || {}
      if (!payload.success) {
        return { ok: false, msg: payload.msg || '绑定失败' }
      }
      this.setData({
        phoneBound: true,
        phoneMasked: payload.phoneMasked || '已绑定',
        nickName: patch.nickName
      })
      trackBehavior('phone_bind_success', 'from', this.data.from || 'onboarding')

      if (!payload.finished) {
        const upsert = await wx.cloud.callFunction({
          name: 'upsertUserProfile',
          data: { patch, completeOnboarding: true }
        })
        const up = upsert.result || {}
        if (!up.success) return { ok: false, msg: up.msg || '注册失败' }
        try {
          const { invalidateAfterProfile } = require('../../utils/cacheInvalidate')
          invalidateAfterProfile()
        } catch (e) { /* ignore */ }
        await refreshSessionAfterAuth(app)
        return { ok: true, payload: up }
      }

      try {
        const { invalidateAfterProfile } = require('../../utils/cacheInvalidate')
        invalidateAfterProfile()
      } catch (e) { /* ignore */ }
      await refreshSessionAfterAuth(app)
      return {
        ok: true,
        payload: {
          success: true,
          registerGift: payload.registerGift || {},
          reward: payload.reward || {},
          user: payload.user
        }
      }
    }

    const upsert = await wx.cloud.callFunction({
      name: 'upsertUserProfile',
      data: { patch, completeOnboarding: true }
    })
    const up = upsert.result || {}
    if (!up.success) return { ok: false, msg: up.msg || '注册失败' }
    try {
      const { invalidateAfterProfile } = require('../../utils/cacheInvalidate')
      invalidateAfterProfile()
    } catch (e) { /* ignore */ }
    await refreshSessionAfterAuth(app)
    return { ok: true, payload: up }
  },

  async onGetPhoneNumber(e) {
    if (this.data.saving) return
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意协议', icon: 'none' })
      return
    }
    if (e.detail.errMsg !== 'getPhoneNumber:ok' || !e.detail.code) {
      wx.showToast({ title: '需要授权手机号以继续', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    wx.showLoading({ title: this.data.loadingText || '请稍候', mask: true })
    try {
      const result = await this.finishRegistration({ phoneCode: e.detail.code })
      wx.hideLoading()
      if (!result.ok) {
        wx.showToast({ title: result.msg || '未能完成', icon: 'none' })
        return
      }
      trackBehavior('onboarding_complete', 'from', this.data.from || 'direct')
      this.goDoneFromPayload(result.payload)
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  async finishWithGift() {
    if (this.data.saving) return
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意协议', icon: 'none' })
      return
    }
    if (!this.data.phoneBound) {
      wx.showToast({ title: '请先授权手机号', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    wx.showLoading({ title: this.data.loadingText || '请稍候', mask: true })
    try {
      const result = await this.finishRegistration({})
      wx.hideLoading()
      if (!result.ok) {
        wx.showToast({ title: result.msg || '未能完成', icon: 'none' })
        return
      }
      trackBehavior('onboarding_complete', 'from', this.data.from || 'direct')
      this.goDoneFromPayload(result.payload)
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/user/index' })
    })
  }
})
