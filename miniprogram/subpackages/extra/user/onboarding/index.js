// subpackages/extra/user/onboarding/index.js
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
const { getPageNavInsets, rpxToPx } = require('../../utils/pageNav')
const { getWindowInfo } = require('../../../../utils/systemInfo')

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
    // 2026-09-17 起新客礼包不再含积分 → 归零就别渲染那一格（否则出现「+0 积分」）
    showPoints: Number(points) > 0,
    rewardCouponCount: cards.length,
    rewardCouponLines: cards.map((c) => (c.minSpend ? `满 ${c.minSpend} 减 ${c.value}` : c.label)),
    rewardCouponCards: cards
  }
}

const FALLBACK_GIFT_VIEW = giftViewFromCoupons(REGISTER_GIFT.points, GIFT_COUPONS)

/**
 * 登录态兜底文案（2026-09-17）
 *
 * 背景：本页此前只有一套「注册」文案，而实际有两种人进来 —— 新号（要注册、能领新客礼）
 * 与老号（只需确认手机号）。老号看到「注册即领新客礼」是**承诺了给不出的东西**。
 * 口径：授权前先问会话（`getUserSession.isRegistered`），老号一律走登录态文案，且不出现
 * 「注册」「新客礼」字样；礼包卡另由 `showGiftPack`（已领则 false）控制。
 */
const LOGIN_DEFAULT = {
  navTitle: '欢迎回来',
  navSub: 'WELCOME BACK',
  overline: 'ONE STEP',
  title: '欢迎回来',
  desc: '该微信已完成注册，授权手机号即可确认身份继续。',
  ctaPhone: '授权手机号 · 继续',
  ctaFinish: '完成确认',
  loading: '正在确认身份'
}

/** 首屏中性态：会话未返回前**不承诺**注册与新客礼（消除「先显示注册、再翻成绑定」的竞态） */
const NEUTRAL_COPY = {
  navTitle: '确认手机号',
  navSub: 'VERIFY',
  overline: 'ONE STEP',
  title: '授权手机号即可继续',
  desc: '正在确认账号…',
  ctaPhone: '授权手机号 · 继续',
  ctaFinish: '完成',
  loading: '正在确认'
}

/** 按「是否已注册」选文案：入口自带 login 覆盖则优先，否则用 LOGIN_DEFAULT */
function resolveCopy(from, isRegistered) {
  const base = COPY_BY_FROM[from] || COPY_BY_FROM.default
  if (!isRegistered) return base
  return Object.assign({}, base, LOGIN_DEFAULT, base.login || {})
}

const COPY_BY_FROM = {
  checkout: {
    navTitle: '授权后继续',
    navSub: 'CABINET · CONTINUE',
    overline: 'CHECKOUT',
    title: '留下手机号，继续启程',
    desc: '勾选协议并授权即可。未注册将同步建档，新客礼放入账户；已注册仅需确认手机号。',
    ctaPhone: '授权手机号 · 继续下单',
    ctaFinish: '完成并继续下单',
    loading: '正在写入档案',
    login: {
      title: '欢迎回来，继续下单',
      desc: '该微信已完成注册，授权手机号即可确认身份并继续下单。'
    }
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
    loading: '正在写入档案',
    login: {
      title: '欢迎回来，继续预约',
      desc: '该微信已完成注册，授权手机号即可继续预约。'
    }
  },
  gift: {
    navTitle: '授权后继续',
    navSub: 'GIFT',
    overline: 'GIFT',
    title: '授权后收下这份山海',
    desc: '勾选协议并授权即可继续；新客礼若未领取将同步放入账户。',
    ctaPhone: '授权手机号 · 继续',
    ctaFinish: '完成并继续',
    loading: '正在写入档案',
    login: {
      title: '欢迎回来',
      desc: '该微信已完成注册，授权手机号即可继续。'
    }
  },
  counter_qr: {
    navTitle: '注册领新客礼',
    navSub: 'COUNTER · WELCOME',
    overline: 'COUNTER',
    title: '注册即领新客礼',
    desc: '勾选协议并授权手机号，即可完成注册。新客礼券即时放入账户，结账可直接使用。',
    ctaPhone: '授权手机号 · 领取新客礼',
    ctaFinish: '完成注册 · 领取新客礼',
    loading: '正在放入礼包',
    login: {
      navTitle: '确认手机号',
      title: '欢迎回来',
      desc: '该微信已完成注册，授权手机号即可确认身份。',
      loading: '正在确认身份'
    }
  },
  atlas: {
    navTitle: '收进山海图鉴',
    navSub: 'ATLAS · WELCOME',
    overline: 'ATLAS',
    title: '授权后写入图鉴',
    desc: '勾选协议并授权手机号，即可完成注册并把本次鉴定写入山海图鉴；新客礼同步放入账户。',
    ctaPhone: '授权手机号 · 写入图鉴',
    ctaFinish: '完成并写入图鉴',
    loading: '正在写入档案',
    login: {
      navTitle: '确认手机号',
      title: '欢迎回来，写入图鉴',
      desc: '该微信已完成注册，授权后可把本次鉴定写入山海图鉴。'
    }
  },
  default: {
    navTitle: '加入山海造物',
    navSub: 'WELCOME · ONE STEP',
    overline: 'CABINET',
    title: '打开你的奇珍柜',
    desc: '勾选协议并授权手机号，即可完成注册。新客礼即时放入账户；昵称与头像可稍后在「我的」里补。',
    ctaPhone: '授权手机号 · 领取新客礼',
    ctaFinish: '完成注册 · 领取新客礼',
    loading: '正在放入礼包',
    login: {
      title: '欢迎回来',
      desc: '该微信已完成注册，授权手机号即可继续。',
      loading: '正在确认身份'
    }
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
    /** 会话是否已返回：未返回前用中性文案，且不渲染新客礼卡（详见 NEUTRAL_COPY） */
    accountReady: false,
    /** 该微信是否已注册（老号走登录态文案，不承诺新客礼） */
    isRegistered: false,
    navTitle: NEUTRAL_COPY.navTitle,
    navSub: NEUTRAL_COPY.navSub,
    heroOverline: NEUTRAL_COPY.overline,
    heroTitle: NEUTRAL_COPY.title,
    heroDesc: NEUTRAL_COPY.desc,
    ctaPhoneText: NEUTRAL_COPY.ctaPhone,
    ctaFinishText: NEUTRAL_COPY.ctaFinish,
    loadingText: NEUTRAL_COPY.loading,
    agreed: false,
    agreeShake: false,
    nickName: '',
    phoneBound: false,
    phoneMasked: '',
    saving: false,
    rewardPoints: FALLBACK_GIFT_VIEW.rewardPoints,
    rewardCouponCount: FALLBACK_GIFT_VIEW.rewardCouponCount,
    rewardCouponLines: FALLBACK_GIFT_VIEW.rewardCouponLines,
    rewardCouponCards: FALLBACK_GIFT_VIEW.rewardCouponCards,
    /** 成功态（原完成页 done 并入）：注册成功后原页切换，不再 redirect 新页 */
    doneView: false,
    hasReward: false,
    hasRegisterGift: false,
    giftPartial: false,
    giftFail: false,
    giftPoints: REGISTER_GIFT.points || 0,
    giftCoupons: GIFT_COUPONS.length,
    giftMsg: '',
    /** 本次是「新号注册」还是「老号确认手机号」——文案据此分支，老号不该被承诺新客礼 */
    isNewUser: true,
    welcomeBack: false,
    repairing: false,
    primaryCta: '开始逛馆',
    showCouponsEntry: false,
    pagePadTop: 80,
    pagePadBottom: 32,
    pagePadX: 32
  },

  onLoad(options) {
    // 旧完成页路径（运营位 / 旧链接）带参重定向到这里：直接进成功态
    if (options && options.done === '1') {
      this._funnelEnded = true
      this.showDone(options)
      return
    }
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

    // 2026-09-17：这里此前**同步**套用入口的「注册」文案，而会话是异步的 →
    // 老用户会先看到「注册即领新客礼」再翻成「绑定手机号」。现在首屏只给中性文案，
    // 由 loadSession() 按 isRegistered 落定（见 NEUTRAL_COPY / resolveCopy）。
    this.setData({
      from: resolvedFrom,
      returnUrl: resolvedReturnUrl,
      returnMode: resolvedReturnMode,
      hasReturn: !!(resolvedReturnUrl || resolvedReturnMode === 'back'),
      showGiftPack: !phoneOnly && this.data.showGiftPack
    })
    trackBehavior('onboarding_start', 'from', resolvedFrom || 'direct')
    this._funnel('show')
    this.initLayout()
    this.loadWelcomeGiftPreview()
    this.loadSession()
  },

  onReady() {
    this.remeasureChrome()
  },

  onUnload() {
    if (!this._funnelEnded) this._funnel('dismiss')
  },

  /** 统一注册漏斗（register_panel，与注册弹层 / 礼赠引导卡同一事件；onboarding_* / auth_* 照旧） */
  _funnel(step, extra) {
    trackBehavior('register_panel', 'register', this.data.from || 'direct', Object.assign({ step, surface: 'page' }, extra || {}))
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
    // 已注册判据优先用服务端下发的 isRegistered；老服务端未下发时回退到「已完成 onboarding / 已绑手机号」
    const isRegistered = session.isRegistered !== undefined
      ? !!session.isRegistered
      : !!(onboardingDone || phoneBound)
    const copy = phoneOnly
      ? null
      : resolveCopy(this.data.from, isRegistered)

    this.setData(Object.assign({
      nickName,
      phoneBound,
      phoneMasked: u.phoneMasked || '',
      phoneOnly,
      accountReady: true,
      isRegistered,
      showGiftPack: !phoneOnly && !giftClaimed
    }, copy ? {
      navTitle: copy.navTitle,
      navSub: copy.navSub,
      heroOverline: copy.overline,
      heroTitle: copy.title,
      heroDesc: copy.desc,
      ctaPhoneText: copy.ctaPhone,
      ctaFinishText: copy.ctaFinish,
      loadingText: copy.loading
    } : (phoneOnly ? {
      navTitle: '绑定手机号',
      navSub: 'VERIFY',
      heroOverline: 'VERIFY',
      heroTitle: '确认联系手机',
      heroDesc: '绑定后即可返回继续。若尚未领取新客礼，将在绑定后自动补发。',
      ctaPhoneText: '授权手机号',
      ctaFinishText: '完成绑定'
    } : {})))

    if (onboardingDone && phoneBound) {
      this._funnelEnded = true
      if (this.data.hasReturn) {
        this.returnAfterSuccess({ silent: true })
        return
      }
      if (this.data.from !== 'gate' && this.data.from !== 'checkout' && this.data.from !== 'phone') {
        const target = this.data.from === 'counter_qr'
          ? '/subpackages/business/coupons/index'
          : '/subpackages/extra/user/profile/index'
        wx.redirectTo({ url: target })
      }
    }
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed })
  },

  openTerms() {
    wx.navigateTo({
      url: '/subpackages/content/user/legal/index?type=terms',
      fail: () => wx.showToast({ title: '无法打开协议', icon: 'none' })
    })
  },

  openPrivacy() {
    wx.navigateTo({
      url: '/subpackages/content/user/legal/index?type=privacy',
      fail: () => wx.showToast({ title: '无法打开协议', icon: 'none' })
    })
  },

  onPhoneCtaTap() {
    if (this.data.saving) return
    if (!this.data.agreed) this.nudgeAgree()
    else this._funnel('auth')
  },

  /** 未勾选协议：轻抖勾选行 + 轻提示，不代用户勾选 */
  nudgeAgree() {
    wx.showToast({ title: '请先阅读并勾选同意', icon: 'none' })
    this.setData({ agreeShake: true })
    clearTimeout(this._agreeShakeTimer)
    this._agreeShakeTimer = setTimeout(() => this.setData({ agreeShake: false }), 420)
  },

  resolveNickName() {
    return sanitizeNickName(this.data.nickName)
      || resolvePrefillNickName(app)
      || FALLBACK_NICK
  },

  /** 注册只问手机号：昵称沿用已有 / 预填，否则默认「藏家」；头像不在注册时收集（「我的」资料页后补） */
  buildProfilePatch() {
    return {
      nickName: this.resolveNickName(),
      agreedTermsAt: new Date().toISOString(),
      onboardingStep: 1
    }
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

    // 新号 / 老号：完成页据此选「注册完成」还是「欢迎回来」，且老号不该被承诺新客礼
    const isNewUser = payload && payload.isNewUser !== undefined
      ? !!payload.isNewUser
      : !this.data.isRegistered
    this.showDone({
      reward: String(rewardFlag),
      isNew: isNewUser ? '1' : '0',
      gift: String(giftFlag),
      giftPartial: giftPartial ? '1' : '0',
      giftFail: giftFailed ? '1' : '0',
      points: String(points),
      coupons: String(couponCount),
      msg: encodeURIComponent(gift.msg || ''),
      from: this.data.from || ''
    })
  },

  /**
   * 成功态（2026-10-11 由完成页 done 并入；参数口径与旧 done 页 query 一致，旧链接经 done.js 重定向后同样走这里）
   *
   * 交互原则（2026-09-15 改版沿用）：
   * - **不做任何自动跳转**：看得到礼包明细，也能选择去礼券夹核销。
   * - 两个明确去处：逛馆 / 去礼券夹核销；若来自结算等路径，主按钮变为「继续…」。
   */
  showDone(options) {
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
    // 新号 / 老号：缺省按新号处理，兼容旧链接
    const isNewUser = options.isNew !== '0'
    const stored = peekOnboardingReturn() || {}
    // 注意：不读取 autoBrowse / autoReturn —— 旧链接仍可能带这两个参数，忽略即可
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
      : GIFT_COUPONS.length
    const giftOk = options.gift === '1' && options.giftFail !== '1' && options.giftPartial !== '1'

    let nick = this.data.nickName || ''
    try {
      if (!nick) nick = (app.globalData && app.globalData.userInfo && app.globalData.userInfo.nickName) || ''
    } catch (e) { /* ignore */ }

    try { wx.setNavigationBarTitle({ title: '山海造物' }) } catch (e) { /* ignore */ }
    this.setData({
      doneView: true,
      nickName: String(nick || '').trim() || FALLBACK_NICK,
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

  /** 补领新客礼：结果写在礼包卡 / 异常卡里（不弹原生提示） */
  async retryGift() {
    if (this.data.repairing) return
    this.setData({ repairing: true, giftMsg: '' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'upsertUserProfile',
        data: { patch: {}, repairRegisterGift: true }
      })
      const payload = res.result || {}
      if (!payload.success) {
        this.setData({ giftMsg: payload.msg || '补领未完成，请稍后再试' })
        return
      }
      const gift = payload.registerGift || {}
      const ok = !!(gift.claimed || gift.alreadyGranted) && !gift.error && !gift.partial
      const partial = !!gift.partial
      const coupons = Number(gift.couponCount) >= 0 ? Number(gift.couponCount) : this.data.giftCoupons
      await refreshSessionAfterAuth(app)
      let msg = gift.msg || ''
      if (!ok && !msg) msg = partial ? '礼券仍未齐，请稍后再试' : (gift.disabled ? '礼包暂未开放' : '补领未完成，请稍后再试')
      this.setData({
        hasRegisterGift: ok || partial || !!(gift.claimed || gift.alreadyGranted),
        giftPartial: partial,
        giftFail: !!(gift.error || gift.empty || (!ok && !partial && !gift.disabled && !gift.alreadyGranted && !gift.claimed)),
        giftPoints: Number(gift.points) >= 0 ? Number(gift.points) : this.data.giftPoints,
        giftCoupons: coupons,
        giftMsg: msg,
        // 补领成功后同样不自动跳转，只把「去礼券夹核销」入口放出来
        showCouponsEntry: (ok || partial) && coupons > 0
      })
    } catch (e) {
      this.setData({ giftMsg: '网络异常，请稍后再试' })
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
  },

  async finishRegistration(extra) {
    const patch = this.buildProfilePatch()

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
      // 2026-09-17：新老分开埋点 —— 此前只有 onboarding_* 一条线，注册与登录不可度量
      trackBehavior(
        payload.isNewUser === false ? 'auth_login_success' : 'auth_register_success',
        'from',
        this.data.from || 'onboarding'
      )

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
      this.nudgeAgree()
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
      this._funnelEnded = true
      this._funnel('success', { isNewUser: result.payload && result.payload.isNewUser !== undefined ? !!result.payload.isNewUser : !this.data.isRegistered })
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
      this.nudgeAgree()
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
      this._funnelEnded = true
      this._funnel('success', { isNewUser: result.payload && result.payload.isNewUser !== undefined ? !!result.payload.isNewUser : !this.data.isRegistered })
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
