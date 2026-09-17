const { fetchMyCoupons } = require('../../../../utils/couponService')
const { couponTimeMs } = require('../../../../utils/couponHelper')
const { ensureOpenId } = require('../../../../utils/orderScope')
const {
  isLocalLoggedOut,
  resumeLocalSession,
  ensureSession,
  needsOnboarding,
  navigateToOnboarding
} = require('../../../../utils/userSession')
const {
  REDEEM_POLL_MS,
  REDEEM_ANIM_MS,
  softVibrate,
  pollMemberPassRedeem,
  shouldAcceptRedeem,
  formatRedeemValueText
} = require('../../../../utils/passRedeemFeedback')

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

/**
 * 需求 7：券夹三分组口径 —— 可用 / 占用中 / 已失效。
 *
 * ⚠️ 为什么单独拆「占用中」：`locked`（下单占用）**是进行时，不是终态**。
 *    上一版把 `!canUse` 一律折叠成「已失效礼券」，等于对顾客谎报一张还会回来的券。
 *    「已失效」只收真正结束的券：`used`（已核销）/ `expired`（已过期）。
 */
const DEAD_STATUS = { used: 1, expired: 1 }
const VOID_LABELS = { used: '已核销', expired: '已过期' }
/** 到期提醒窗口：≤ 该天数在券面加临期标 */
const EXPIRING_SOON_DAYS = 7
const DAY_MS = 86400000

function splitCouponGroups(list) {
  const usable = []
  const locked = []
  const dead = []
  ;(list || []).forEach((item) => {
    if (!item) return
    if (item.canUse === true) {
      usable.push(item)
      return
    }
    if (DEAD_STATUS[item.status]) {
      dead.push(item)
      return
    }
    // locked / occupied 及任何未知状态：既不谎报可用，也不谎报失效
    locked.push(item)
  })
  return { usable, locked, dead }
}

/** 临期提示：只在可用券且 ≤ EXPIRING_SOON_DAYS 天时给文案，其余返回空串（不占位） */
function couponExpiryHint(item, now) {
  if (!item || !item.canUse) return ''
  const at = couponTimeMs(item.expireTime)
  if (!at) return ''
  const base = now instanceof Date ? now.getTime() : Number(now) || Date.now()
  const diff = at - base
  if (diff <= 0) return '今日到期'
  const days = Math.ceil(diff / DAY_MS)
  if (days <= 1) return '明日到期'
  if (days <= EXPIRING_SOON_DAYS) return `${days} 天后过期`
  return ''
}

/** 券面派生字段：临期提示 / 打眼章文案 / 失效类型（决定章的颜色） */
function decorateCoupon(item, now) {
  const status = String((item && item.status) || '')
  const isDead = !!DEAD_STATUS[status]
  const hint = couponExpiryHint(item, now)
  return {
    ...item,
    expiryHint: hint,
    expiringSoon: !!hint,
    voidLabel: isDead ? VOID_LABELS[status] : '',
    voidKind: isDead && status === 'used' ? 'is-used' : 'is-expired'
  }
}

const _pageCfg = {
  data: {
    coupons: [],
    usableCouponCount: 0,
    loading: true,
    loadError: false,
    emptyCtaText: '去积分中心兑换',
    needOnboarding: false,
    needLogin: false,

    // 需求 7：三分组 —— 可用平铺 / 占用中单列 / 已失效收入券包折叠
    // （沿用 closedCoupons / closedCount / closedExpanded 命名，文档与礼赠页同口径）
    lockedCoupons: [],
    lockedCount: 0,
    closedCoupons: [],
    closedCount: 0,
    closedExpanded: false,
    expiringCount: 0,
    expiringDays: EXPIRING_SOON_DAYS,

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
      lockedCoupons: [],
      lockedCount: 0,
      closedCoupons: [],
      closedCount: 0,
      closedExpanded: false,
      expiringCount: 0,
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
      const now = new Date()
      const decorated = list.map((item) => decorateCoupon(item, now))
      const groups = splitCouponGroups(decorated)

      this.setData({
        coupons: decorated,
        usableCouponCount: groups.usable.length,
        // 需求 7：占用中单独成组（进行时，不折叠、不标失效）
        lockedCoupons: groups.locked,
        lockedCount: groups.locked.length,
        // 需求 7：已核销 / 已过期收入券包，默认收起
        closedCoupons: groups.dead,
        closedCount: groups.dead.length,
        expiringCount: groups.usable.filter((c) => c.expiringSoon).length,
        loading: false,
        loadError: !result.ok,
        needLogin: false
      })
    } catch (err) {
      console.error('加载优惠券失败', err)
      this.setData({
        coupons: [],
        usableCouponCount: 0,
        lockedCoupons: [],
        lockedCount: 0,
        closedCoupons: [],
        closedCount: 0,
        expiringCount: 0,
        loading: false,
        loadError: true
      })
    } finally {
      this._loadingCoupons = false
    }
  },

  /** 需求 7：展开/收起失效券券包 */
  toggleClosedCoupons() {
    softVibrate('light')
    this.setData({ closedExpanded: !this.data.closedExpanded })
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
}

const _methods = {}
Object.keys(_pageCfg).forEach((k) => { if (k !== 'data') _methods[k] = _pageCfg[k] })

/**
 * 礼券夹面板（原 subpackages/business/coupons 页，2026-09-17 并入钱包枢纽）
 *
 * 搬迁原则：**页面交互一字不改**。上面 _pageCfg 就是原来的 Page 配置原文，
 * 只做了一层「Page → Component」的机械包装：
 *   · 非 data 的键（含 onShow / onHide / onUnload 与全部业务方法）原样搬进 methods
 *   · 首次进入由 lifetimes.ready 触发（等价于原页面首次 onShow）
 *   · 之后每次「页面重新显示 / 切后台」由宿主页转发 onShow / onHide（宿主跳过首屏那次）
 *   · 组件销毁（切走 tab、页面卸载）由 lifetimes.detached 触发原 onUnload 的清理
 *     —— 亮码弹层有核销轮询与倒计时，销毁时不清理就会留下定时器
 *   · usableCouponCount 变化时派发 couponcount 给宿主（宿主用同一个 hub 条，三 tab 共用角标口径）
 */
Component({
  options: { addGlobalClass: true },
  data: _pageCfg.data,
  methods: _methods,
  lifetimes: {
    ready() {
      if (typeof _methods.onShow === 'function') _methods.onShow.call(this)
    },
    detached() {
      if (typeof _methods.onUnload === 'function') _methods.onUnload.call(this)
    },
    attached() {
      // 只观察这次 setData，不改 _pageCfg 里任何业务代码
      const raw = this.setData.bind(this)
      this.setData = (patch, cb) => {
        raw(patch, cb)
        if (patch && typeof patch === 'object' && 'usableCouponCount' in patch) {
          this.triggerEvent('couponcount', { count: patch.usableCouponCount })
        }
      }
    }
  }
})
