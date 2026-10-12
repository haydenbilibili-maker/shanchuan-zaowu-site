const {
  fetchContentDisplayFlags,
  getCachedContentDisplayFlags,
  toastStoredValueClosed
} = require('../../../../utils/contentDisplayFlags')
const { isLocalLoggedOut, resumeLocalSession, ensureSession } = require('../../../../utils/userSession')
const walletCopy = require('./walletCopy')
const { openAppModal } = require('../../../../utils/appModal')
const {
  buildLedgerTimeline,
  ledgerCapText
} = require('./wallet-ledger')

/**
 * 当前设备是否允许充值。
 *
 * **结论（2026-09-16 业务复核）：无平台限制，不对任何端做限制。**
 *
 * 历史：2026-09-15 提审前自审曾以「iOS 端不得用微信支付购买虚拟货币」为由加硬编码拦截，
 * 但该自审报告自述抓不到微信官方文档、依据未核实。业务复核确认**不存在该限制**，
 * 故不再按平台判定，一律允许。
 *
 * 保留本函数（而非删除调用点）是为了语义集中：日后若确有平台规则，只需改这一处。
 * 原先的 `allowIosStoredValue` 开关随之**失去作用**（不再参与判定），
 * 保留其配置字段仅为兼容既有配置文档，避免误以为它仍在生效。
 */
function isRechargeAllowed() {
  return true
}

const LEDGER_PAGE_SIZE = 20
const WALLET_CACHE_KEY = 'stored_value_wallet_snapshot_v1'

function currentOpenid() {
  try {
    if (isLocalLoggedOut()) return ''
    const app = getApp()
    return (app && app.globalData && app.globalData.openid) || ''
  } catch (e) {
    return ''
  }
}

function hasYuanValue(v) {
  return v != null && String(v).trim() !== ''
}

function emptyAccount() {
  return {
    availableYuan: '',
    principalYuan: '',
    bonusYuan: '',
    memberNo: ''
  }
}

function readWalletCache() {
  try {
    if (isLocalLoggedOut()) return null
    const raw = wx.getStorageSync(WALLET_CACHE_KEY)
    if (!raw || typeof raw !== 'object') return null
    const openid = currentOpenid()
    if (openid && raw.openid && raw.openid !== openid) return null
    const availableYuan = hasYuanValue(raw.availableYuan) ? String(raw.availableYuan) : ''
    const memberNo = raw.memberNo ? String(raw.memberNo) : ''
    if (!availableYuan && !memberNo) return null
    return {
      availableYuan,
      principalYuan: hasYuanValue(raw.principalYuan) ? String(raw.principalYuan) : '',
      bonusYuan: hasYuanValue(raw.bonusYuan) ? String(raw.bonusYuan) : '',
      memberNo
    }
  } catch (e) {
    return null
  }
}

function writeWalletCache(account) {
  if (!account || isLocalLoggedOut()) return
  try {
    wx.setStorageSync(WALLET_CACHE_KEY, {
      v: 1,
      openid: currentOpenid() || account.openid || '',
      availableYuan: hasYuanValue(account.availableYuan) ? String(account.availableYuan) : '',
      principalYuan: hasYuanValue(account.principalYuan) ? String(account.principalYuan) : '',
      bonusYuan: hasYuanValue(account.bonusYuan) ? String(account.bonusYuan) : '',
      memberNo: account.memberNo ? String(account.memberNo) : '',
      ts: Date.now()
    })
  } catch (e) {
    /* ignore */
  }
}

function clearWalletCache() {
  try {
    wx.removeStorageSync(WALLET_CACHE_KEY)
  } catch (e) { /* ignore */ }
}

function defaultRecharge() {
  return {
    allowCustom: true,
    minCustomFen: 100,
    maxCustomFen: 10000000,
    customStepFen: 100,
    minCustomYuan: '1.00',
    maxCustomYuan: '100000.00',
    customStepYuan: '1.00'
  }
}

function stripYuanTrailing(yuanStr) {
  const s = String(yuanStr || '')
  if (s.indexOf('.') === -1) return s
  return s.replace(/\.?0+$/, '') || '0'
}

function formatDiscountShort(rate) {
  const n = Number(rate)
  if (!Number.isFinite(n) || n <= 0 || n >= 0.999) return ''
  const zhe = Math.round(n * 1000) / 100
  if (Math.abs(zhe - Math.round(zhe)) < 0.001) return `${Math.round(zhe)}折`
  return `${zhe}折`
}

/** 按充值成长值匹配可达会员档（与云函数 levelTiers.matchLevelForPayFen 一致） */
function matchLevelForYuan(levelTiers, yuan) {
  const points = Math.floor(Number(yuan) || 0)
  if (points <= 0) return null
  const list = (levelTiers || []).filter((l) => l && Number(l.threshold) > 0)
  if (!list.length) return null
  const exact = list.find((l) => Number(l.threshold) === points)
  if (exact) return { ...exact, exact: true }
  let best = null
  list.forEach((l) => {
    const th = Number(l.threshold) || 0
    if (th > 0 && th <= points) {
      if (!best || th > Number(best.threshold)) best = l
    }
  })
  return best ? { ...best, exact: false } : null
}

function buildLevelReachHint(matched) {
  if (!matched || !matched.level) return ''
  const discountShort = formatDiscountShort(
    matched.discountRate != null ? matched.discountRate : matched.discount
  )
  if (!discountShort) {
    return matched.exact
      ? `对齐 Lv${matched.level} ${matched.name || ''} 门槛`.trim()
      : `累计成长达 Lv${matched.level}`
  }
  if (matched.exact) {
    return `对齐 Lv${matched.level} ${matched.name || ''} 门槛；到达后指定藏品 ${discountShort}`.replace(
      /\s+/g,
      ' '
    ).trim()
  }
  return `累计成长达 Lv${matched.level} 后，指定藏品 ${discountShort}`
}

const _pageCfg = {
  data: {
    scrollIntoView: '',
    allowed: false,
    checking: true,
    loading: false,
    accountReady: false,
    paying: false,
    flashSuccess: '',
    account: emptyAccount(),
    packages: [],
    levelTiers: [],
    selectedPackageId: '',
    rechargeMode: 'package',
    customAmount: '',
    customHint: '',
    allowCustom: true,
    recharge: defaultRecharge(),
    canPay: false,
    paySummaryLabel: '',
    payBtnLabel: '充值',
    selectedBenefitHint: '',
    ledgers: [],
    /** 时间轴块：{kind:'month'|'day'} 扁平数组，WXML 单层 wx:for 即可 */
    ledgerTimeline: [],
    ledgerCount: 0,
    ledgerCap: '',
    ledgerEmpty: false,
    ledgerHasMore: false,
    ledgerLoadingMore: false,
    /** 首屏流水加载中 → 出骨架；旧实现直接进空态，会先闪「暂无流水」 */
    ledgerLoading: true,
    ledgerOffset: 0,
    benefitText: '',
    pointsRuleText: walletCopy.POINTS_RULE,
    walletPlateFooter: walletCopy.PLATE_FOOTER,
    walletRechargeHint: walletCopy.RECHARGE_HINT,
    walletSecurityNote: walletCopy.SECURITY_NOTE,
    walletRechargeLead: walletCopy.RECHARGE_LEAD,
    usableCouponCount: 0,
    needLogin: false,
    /**
     * 充值受限态：**恒为 false**（2026-09-16 业务复核确认无平台限制）。
     * 保留字段名以免改动 wxml 的 wx:if；受限提示卡片因此永不渲染。
     */
    iosBlocked: false,
    /** 需求 8：余额卡翻面（正面余额 / 背面支付权益） */
    cardFlipped: false
  },

  applyGuestWalletState() {
    clearWalletCache()
    this.setData({
      needLogin: true,
      checking: false,
      loading: false,
      allowed: true,
      account: emptyAccount(),
      accountReady: false,
      packages: [],
      levelTiers: [],
      ledgers: [],
      ledgerTimeline: [],
      ledgerCount: 0,
      ledgerCap: '',
      ledgerEmpty: true,
      ledgerHasMore: false,
      ledgerLoadingMore: false,
      ledgerLoading: false,
      ledgerOffset: 0,
      usableCouponCount: 0,
      benefitText: '',
      selectedPackageId: '',
      canPay: false,
      paySummaryLabel: '',
      payBtnLabel: '充值',
      selectedBenefitHint: ''
    })
  },

  onLoad() {
    // 充值是否受限：优先用缓存开关（同步，避免首屏闪烁），bootstrap 后再以云值为准
    // （2026-09-17 并入枢纽：原来这里还要量导航头给固定头部/scroll-view 定位，现已改普通内容流）
    const cachedFlags = getCachedContentDisplayFlags()
    const patch = {
      iosBlocked: !isRechargeAllowed(cachedFlags)
    }
    if (isLocalLoggedOut()) {
      this.setData(Object.assign(patch, {
        needLogin: true,
        checking: false,
        allowed: true,
        account: emptyAccount(),
        accountReady: false
      }))
      return
    }
    const cached = readWalletCache()
    if (cached) {
      patch.account = Object.assign({}, this.data.account, cached)
      patch.accountReady = hasYuanValue(cached.availableYuan)
      // 有快照则先画出完整页，开关仍在 bootstrap 里校验
      patch.allowed = true
    }
    this.setData(patch)
    this.bootstrap()
  },

  onShow() {
    if (isLocalLoggedOut()) {
      this.applyGuestWalletState()
      return
    }
    if (this.data.needLogin) {
      this.setData({ needLogin: false })
      this.bootstrap()
      return
    }
    this.loadUsableCouponCount()
    if (this.data.allowed && !this.data.checking) {
      this.releaseHeldQuiet()
      this.refreshAccount()
    }
  },

  onPullDownRefresh() {
    if (isLocalLoggedOut()) {
      this.applyGuestWalletState()
      wx.stopPullDownRefresh()
      return
    }
    this.refreshAccount({ resetLedgers: true })
      .finally(() => wx.stopPullDownRefresh())
  },

  async bootstrap() {
    if (isLocalLoggedOut()) {
      this.applyGuestWalletState()
      return
    }
    try {
      const { flags } = await fetchContentDisplayFlags()
      if (isLocalLoggedOut()) {
        this.applyGuestWalletState()
        return
      }
      if (!flags.showStoredValue) {
        toastStoredValueClosed()
        this.setData({ allowed: false, checking: false })
        setTimeout(() => {
          wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
        }, 400)
        return
      }
      this.setData({
        allowed: true,
        checking: false,
        needLogin: false,
        // 以云端开关为准刷新充值受限态（onLoad 用的是缓存值）
        iosBlocked: !isRechargeAllowed(flags)
      })
      await this.releaseHeldQuiet()
      await this.refreshAccount({ resetLedgers: true })
      this.loadUsableCouponCount()
    } catch (e) {
      toastStoredValueClosed()
      this.setData({ allowed: false, checking: false })
      setTimeout(() => {
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
      }, 400)
    }
  },

  async loadUsableCouponCount() {
    if (isLocalLoggedOut()) {
      this.setData({ usableCouponCount: 0 })
      return
    }
    try {
      const { fetchMyCoupons } = require('../../../../utils/couponService')
      const pack = await fetchMyCoupons({ usableOnly: true })
      if (isLocalLoggedOut()) {
        this.setData({ usableCouponCount: 0 })
        return
      }
      const n = pack && pack.ok ? (pack.list || []).length : 0
      this.setData({ usableCouponCount: n })
    } catch (e) { /* 角标非关键路径 */ }
  },

  /** 静默释放本人超时/已取消订单上的 held 扣款 */
  async releaseHeldQuiet() {
    if (isLocalLoggedOut()) return
    try {
      await wx.cloud.callFunction({
        name: 'manageStoredValue',
        data: { action: 'releaseHeldWalletDebits', limit: 10 }
      })
    } catch (e) {
      console.warn('releaseHeldQuiet', e)
    }
  },

  computePayState(patch) {
    const mode = patch.rechargeMode != null ? patch.rechargeMode : this.data.rechargeMode
    const packages = patch.packages != null ? patch.packages : this.data.packages
    const levelTiers = patch.levelTiers != null ? patch.levelTiers : this.data.levelTiers
    const selectedPackageId =
      patch.selectedPackageId != null ? patch.selectedPackageId : this.data.selectedPackageId
    const customAmount = patch.customAmount != null ? patch.customAmount : this.data.customAmount
    const recharge = patch.recharge != null ? patch.recharge : this.data.recharge

    let canPay = false
    let paySummaryLabel = ''
    let payBtnLabel = '充值'
    let customHint = ''
    let selectedBenefitHint = ''

    if (mode === 'package') {
      const pkg = (packages || []).find((p) => p.id === selectedPackageId)
      if (pkg) {
        canPay = true
        const display = stripYuanTrailing(pkg.payYuan)
        paySummaryLabel = `¥${pkg.payYuan}`
        payBtnLabel = `充值 ¥${display}`
        const bits = []
        if (pkg.levelHint) bits.push(pkg.levelHint)
        if (pkg.pointsHint) bits.push(pkg.pointsHint)
        selectedBenefitHint = bits.join(' · ')
      } else {
        payBtnLabel = '请选择档位'
      }
    } else {
      const parsed = this.validateCustomAmount(customAmount, recharge)
      customHint = parsed.hint || ''
      if (parsed.ok) {
        canPay = true
        paySummaryLabel = `¥${parsed.yuanFixed}`
        payBtnLabel = `充值 ¥${stripYuanTrailing(parsed.yuanFixed)}`
        const pts = parsed.payFen ? Math.floor(parsed.payFen / 100) : 0
        const matched = matchLevelForYuan(levelTiers, pts)
        const bits = []
        const levelHint = buildLevelReachHint(matched)
        if (levelHint) bits.push(levelHint)
        else if (pts > 0) bits.push('充值计入成长值；到达对应等级后享会员折扣')
        if (pts > 0) bits.push(`到账后得 ${pts} 积分`)
        selectedBenefitHint = bits.join(' · ')
      } else {
        payBtnLabel = parsed.btnLabel || '输入金额'
      }
    }

    return { canPay, paySummaryLabel, payBtnLabel, customHint, selectedBenefitHint }
  },

  validateCustomAmount(raw, recharge) {
    const opts = recharge || this.data.recharge || defaultRecharge()
    const text = String(raw == null ? '' : raw).trim()
    if (!text) {
      return { ok: false, hint: '', btnLabel: '输入金额' }
    }
    if (!/^\d+(\.\d{0,2})?$/.test(text)) {
      return { ok: false, hint: '请输入有效金额（最多两位小数）', btnLabel: '金额无效' }
    }
    const yuan = Number(text)
    if (!Number.isFinite(yuan)) {
      return { ok: false, hint: '请输入有效金额', btnLabel: '金额无效' }
    }
    const payFen = Math.round(yuan * 100)
    const minFen = Number(opts.minCustomFen) || 100
    const maxFen = Number(opts.maxCustomFen) || 10000000
    const stepFen = Number(opts.customStepFen) || 100
    if (payFen < minFen) {
      return {
        ok: false,
        hint: `最低充值 ¥${opts.minCustomYuan || (minFen / 100).toFixed(2)}`,
        btnLabel: '金额过低'
      }
    }
    if (payFen > maxFen) {
      return {
        ok: false,
        hint: `最高充值 ¥${opts.maxCustomYuan || (maxFen / 100).toFixed(2)}`,
        btnLabel: '金额过高'
      }
    }
    if (stepFen > 1 && payFen % stepFen !== 0) {
      return {
        ok: false,
        hint: `请按 ¥${opts.customStepYuan || (stepFen / 100).toFixed(2)} 的倍数输入`,
        btnLabel: '调整金额'
      }
    }
    return {
      ok: true,
      payFen,
      yuanFixed: (payFen / 100).toFixed(2),
      hint: ''
    }
  },

  applyPayState(extra) {
    const pay = this.computePayState(extra || {})
    this.setData(Object.assign({}, extra || {}, pay))
  },

  async fetchLedgers(offset) {
    if (isLocalLoggedOut()) {
      return { rows: [], hasMore: false }
    }
    const res = await wx.cloud.callFunction({
      name: 'manageStoredValue',
      data: { action: 'listLedgers', limit: LEDGER_PAGE_SIZE, offset }
    })
    const result = (res && res.result) || {}
    const rows = result.list || []
    return {
      rows,
      hasMore: rows.length >= LEDGER_PAGE_SIZE
    }
  },

  /**
   * 流水视图的唯一派生点（刷新与加载更多共用，避免两处 setData 形状漂移）。
   * `cursor` 是**服务端游标**（按服务端返回条数推进），与去重后的可见条数无关：
   * 期间若有新流水插入表头，按可见条数推进会重复拉同一页、卡住加载更多。
   */
  ledgerPatch(rows, hasMore, cursor) {
    const built = buildLedgerTimeline(rows, { hasMore })
    return {
      ledgers: rows,
      ledgerTimeline: built.timeline,
      ledgerCount: built.count,
      ledgerCap: ledgerCapText(built.count, hasMore),
      ledgerEmpty: built.count === 0,
      ledgerOffset: Number(cursor) || 0,
      ledgerHasMore: hasMore,
      ledgerLoading: false
    }
  },

  applyLedgers(rows, hasMore, cursor) {
    const patch = this.ledgerPatch(rows, hasMore, cursor)
    this.setData({ ...patch, ledgerLoadingMore: false })
    return patch
  },

  async refreshAccount(options = {}) {
    if (isLocalLoggedOut()) {
      this.applyGuestWalletState()
      return
    }
    if (this.data.loading) return
    this.setData({ loading: true })
    const resetLedgers = options.resetLedgers !== false
    try {
      const accountRes = await wx.cloud.callFunction({
        name: 'manageStoredValue',
        data: { action: 'getAccount' }
      })

      if (isLocalLoggedOut()) {
        this.applyGuestWalletState()
        return
      }

      const accountResult = (accountRes && accountRes.result) || {}
      if (accountResult.code === 'STORED_VALUE_DISABLED' || accountResult.enabled === false) {
        toastStoredValueClosed()
        this.setData({ allowed: false, loading: false })
        setTimeout(() => {
          wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
        }, 400)
        return
      }

      const account = accountResult.account || this.data.account
      if (accountResult.account) writeWalletCache(accountResult.account)
      const packages = (accountResult.packages || []).map((p) => ({
        ...p,
        displayPayYuan: stripYuanTrailing(p.payYuan),
        levelBadge: p.level ? `Lv${p.level}` : '',
        discountLine: p.discountShort
          ? (p.exactLevelMatch ? `到达后 ${p.discountShort}` : `可达 ${p.discountShort}`)
          : '',
        pointsLine: p.points > 0 ? `+${p.points} 积分` : ''
      }))
      const levelTiers = Array.isArray(accountResult.levelTiers) ? accountResult.levelTiers : []
      const recharge = Object.assign({}, defaultRecharge(), accountResult.recharge || {})
      const allowCustom = recharge.allowCustom !== false

      let selectedPackageId = this.data.selectedPackageId
      let rechargeMode = this.data.rechargeMode
      if (!selectedPackageId && packages.length) {
        selectedPackageId = packages[0].id
        rechargeMode = 'package'
      }
      if (!allowCustom && rechargeMode === 'custom') {
        rechargeMode = 'package'
      }

      let ledgerRows = this.data.ledgers
      let ledgerCursor = this.data.ledgerOffset
      let ledgerHasMore = this.data.ledgerHasMore
      if (resetLedgers) {
        // 首次进页面：给骨架而不是「暂无流水」空态（旧实现会先闪一下空态再出流水）
        if (!this.data.ledgers.length) this.setData({ ledgerLoading: true })
        const page = await this.fetchLedgers(0)
        ledgerRows = page.rows
        ledgerCursor = page.rows.length
        ledgerHasMore = page.hasMore
      }
      const ledger = this.ledgerPatch(ledgerRows, ledgerHasMore, ledgerCursor)

      const base = {
        loading: false,
        needLogin: false,
        accountReady: hasYuanValue(account && account.availableYuan) || this.data.accountReady,
        account,
        packages,
        levelTiers,
        selectedPackageId,
        rechargeMode,
        allowCustom,
        recharge,
        ...ledger,
        benefitText: accountResult.benefitText || '',
        pointsRuleText: accountResult.pointsRuleText || walletCopy.POINTS_RULE
      }
      const pay = this.computePayState(base)
      this.setData(Object.assign({}, base, pay))
    } catch (e) {
      console.warn('refreshAccount', e)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败，请下拉重试', icon: 'none' })
    }
  },

  async onLoadMoreLedgers() {
    if (isLocalLoggedOut()) {
      this.applyGuestWalletState()
      return
    }
    if (this.data.ledgerLoading || this.data.ledgerLoadingMore || !this.data.ledgerHasMore) return
    this.setData({ ledgerLoadingMore: true })
    try {
      const page = await this.fetchLedgers(this.data.ledgerOffset)
      // 去重：游标分页期间若有新流水插到表头，同一条会被拉回来两次
      const seen = new Set(this.data.ledgers.map((r) => r && r.id).filter(Boolean))
      const fresh = page.rows.filter((r) => r && !seen.has(r.id))
      const rows = this.data.ledgers.concat(fresh)
      const cursor = this.data.ledgerOffset + page.rows.length
      this.applyLedgers(rows, page.hasMore, cursor)
    } catch (e) {
      this.setData({ ledgerLoadingMore: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  /** 点流水行 → 打开关联订单（只有 refType='order' 的行可点，其余不给假箭头） */
  onLedgerTap(e) {
    if (isLocalLoggedOut()) {
      this.goResumeLogin()
      return
    }
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const orderId = String(ds.orderId || '').trim()
    if (!orderId) return
    try {
      wx.vibrateShort({ type: 'light' })
    } catch (err) { /* 部分机型不支持 */ }
    wx.navigateTo({
      url: `/subpackages/business/order-detail/index?id=${encodeURIComponent(orderId)}`,
      fail: () => wx.showToast({ title: '订单详情打开失败', icon: 'none' })
    })
  },

  onSelectPackage(e) {
    if (this.data.needLogin || isLocalLoggedOut()) {
      this.goResumeLogin()
      return
    }
    const id = e.currentTarget.dataset.id
    if (!id) return
    this.applyPayState({
      selectedPackageId: id,
      rechargeMode: 'package',
      customHint: ''
    })
  },

  onSelectCustom() {
    if (this.data.needLogin || isLocalLoggedOut()) {
      this.goResumeLogin()
      return
    }
    if (!this.data.allowCustom) return
    this.applyPayState({
      rechargeMode: 'custom',
      selectedPackageId: ''
    })
  },

  onCustomAmountInput(e) {
    const value = (e.detail && e.detail.value) || ''
    this.applyPayState({
      customAmount: value,
      rechargeMode: 'custom',
      selectedPackageId: ''
    })
  },

  showSuccessFlash(text) {
    this.setData({
      flashSuccess: text || '充值成功，余额已更新',
      scrollIntoView: 'sv-top'
    })
    setTimeout(() => {
      this.setData({ flashSuccess: '', scrollIntoView: '' })
    }, 3200)
  },

  /** 需求 8：余额卡翻面（与积分卡/预约卡同一交互：轻触翻面 + 轻震动） */
  toggleWalletCard() {
    try {
      wx.vibrateShort({ type: 'light' })
    } catch (e) { /* 部分机型不支持 */ }
    this.setData({ cardFlipped: !this.data.cardFlipped })
  },

  async onRechargeTap() {
    // 无平台限制（业务复核结论）：iosBlocked 恒为 false，本分支实际不会命中，
    // 保留作为「日后若确有平台规则」的统一出口。
    // 原实现由 utils/platform.js 硬编码拦截，依据条款未经核实，2026-09-16 恢复充值能力。
    if (this.data.iosBlocked) {
      openAppModal({
        title: '当前设备暂不支持充值',
        content: '该端暂未开放购买储值余额。你仍可在本页查看余额与账单，或前往门店充值。',
        showCancel: false,
        confirmText: '知道了'
      }, this)
      return
    }
    if (this.data.needLogin || isLocalLoggedOut()) {
      this.goResumeLogin()
      return
    }
    if (this.data.paying || !this.data.canPay) return
    if (!this.data.allowed) {
      toastStoredValueClosed()
      return
    }

    const mode = this.data.rechargeMode
    let createPayload = null
    let payLabel = ''
    let creditLabel = ''

    if (mode === 'custom') {
      const parsed = this.validateCustomAmount(this.data.customAmount, this.data.recharge)
      if (!parsed.ok) {
        wx.showToast({ title: parsed.hint || '请输入有效金额', icon: 'none' })
        return
      }
      createPayload = {
        action: 'createRecharge',
        mode: 'custom',
        packageId: 'CUSTOM',
        customPayFen: parsed.payFen,
        customAmountYuan: Number(parsed.yuanFixed)
      }
      payLabel = `¥${parsed.yuanFixed}`
      creditLabel = payLabel
    } else {
      const packageId = this.data.selectedPackageId
      if (!packageId) {
        wx.showToast({ title: '请选择充值档位', icon: 'none' })
        return
      }
      const pkg = (this.data.packages || []).find((p) => p.id === packageId)
      createPayload = { action: 'createRecharge', packageId }
      payLabel = pkg ? `¥${pkg.payYuan}` : ''
      creditLabel = pkg ? `¥${pkg.creditYuan}` : payLabel
    }

    const confirmed = await new Promise((resolve) => {
      openAppModal({
        title: '确认充值',
        content: `充值 ${payLabel}，到账 ${creditLabel}（全额本金）。${walletCopy.rechargeModalSuffix}`,
        confirmText: '立即支付',
        confirmColor: '#C4A76C',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      }, this)
    })
    if (!confirmed) return

    this.setData({ paying: true })
    wx.showLoading({ title: '创建订单…', mask: true })

    try {
      const createRes = await wx.cloud.callFunction({
        name: 'manageStoredValue',
        data: createPayload
      })
      const created = (createRes && createRes.result) || {}
      wx.hideLoading()

      if (!created.success) {
        this.setData({ paying: false })
        wx.showToast({ title: created.msg || '无法发起充值', icon: 'none' })
        return
      }

      if (created.payment) {
        await new Promise((resolve, reject) => {
          wx.requestPayment({
            ...created.payment,
            success: resolve,
            fail: (err) => {
              if (err.errMsg && err.errMsg.includes('cancel')) {
                reject(new Error('已取消支付'))
              } else {
                reject(new Error(err.errMsg || '支付失败'))
              }
            }
          })
        })

        wx.showLoading({ title: '确认入账…', mask: true })
        // 充值入账由支付回调完成，回调可能有延迟：短轮询重试，避免「已付款但余额未到账」
        let confirmedResult = {}
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const confirmRes = await wx.cloud.callFunction({
            name: 'manageStoredValue',
            data: { action: 'confirmRecharge', orderId: created.orderId }
          })
          confirmedResult = (confirmRes && confirmRes.result) || {}
          if (confirmedResult.success) break
          const pending =
            confirmedResult.pendingConfirm === true ||
            confirmedResult.code === 'AWAITING_CALLBACK'
          if (!pending || attempt === 2) break
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
        wx.hideLoading()

        this.setData({ paying: false })
        await this.refreshAccount({ resetLedgers: true })

        if (confirmedResult.success) {
          const pts = Number(confirmedResult.pointsGranted) || 0
          const flash = pts > 0
            ? `充值成功，到账 ${creditLabel}，+${pts} 积分`
            : `充值成功，到账 ${creditLabel}`
          this.showSuccessFlash(flash)
          wx.showToast({ title: '充值成功', icon: 'success' })
        } else if (confirmedResult.pendingConfirm || confirmedResult.code === 'AWAITING_CALLBACK') {
          this.showSuccessFlash('支付成功，余额稍后更新，可下拉刷新')
          wx.showToast({ title: '支付成功，余额稍后更新', icon: 'none' })
        } else {
          wx.showToast({ title: confirmedResult.msg || '入账确认中', icon: 'none' })
        }
        return
      }

      if (created.mockPay === true) {
        wx.showLoading({ title: '模拟入账…', mask: true })
        const confirmRes = await wx.cloud.callFunction({
          name: 'manageStoredValue',
          data: { action: 'confirmRecharge', orderId: created.orderId }
        })
        wx.hideLoading()
        const confirmedResult = (confirmRes && confirmRes.result) || {}
        if (!confirmedResult.success) {
          throw new Error(confirmedResult.msg || '模拟入账失败')
        }
        this.setData({ paying: false })
        await this.refreshAccount({ resetLedgers: true })
        this.showSuccessFlash(`充值成功（开发），到账 ${creditLabel}`)
        wx.showToast({ title: '充值成功（开发）', icon: 'success' })
        return
      }

      this.setData({ paying: false })
      wx.showToast({ title: created.msg || '支付未开通', icon: 'none' })
    } catch (e) {
      wx.hideLoading()
      this.setData({ paying: false })
      const msg = (e && e.message) || '充值失败'
      if (msg !== '已取消支付') {
        wx.showToast({ title: msg, icon: 'none' })
      }
    }
  },

  async goResumeLogin() {
    if (this._resumingLogin) return
    this._resumingLogin = true
    wx.showLoading({ title: '进入中', mask: true })
    try {
      resumeLocalSession()
      await ensureSession(getApp(), { force: true })
      wx.hideLoading()
      this.setData({ needLogin: false })
      await this.bootstrap()
      // 主视觉铭牌提示（原生 toast 与界面脱节）；失败分支仍是原样 toast
      this.showWelcomeBack('余额与账单已恢复')
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '进入失败，请重试', icon: 'none' })
    } finally {
      this._resumingLogin = false
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  },

  goSupport() {
    wx.navigateTo({ url: '/subpackages/extra/user/support/index' })
  }
}

const _methods = {}
Object.keys(_pageCfg).forEach((k) => { if (k !== 'data') _methods[k] = _pageCfg[k] })

/**
 * 钱包面板（原 subpackages/extra/user/stored-value 页，2026-09-17 并入钱包枢纽）
 *
 * 搬迁原则：**页面交互一字不改**（上面的 _pageCfg 就是原 Page 配置原文）。
 * 与积分/礼券夹两批不同的是：本页原来是「整页 = 固定头部 + 内部 scroll-view」，进枢纽后
 * 页头与 tab 由宿主页负责、滚动交给页面本身，故**删掉了那套固定头/滚动数学**：
 *   · onLoad 里量导航头的 statusBarHeight / navPaddingRight / headerBlockPx
 *   · onReady + remeasureScroll()（量 .account-nav 底边与 scrollHeight）
 *   · 随之不再需要 `extra/utils/pageNav`（**跨分包**）与根 `utils/scrollArea`
 * 样式侧对应地把 .account-page/.account-scroll 覆盖回普通流（见 index.wxss 末尾）。
 *
 * 其余包装：
 *   · 首次进入由 lifetimes.ready 依次跑原 onLoad → 原 onShow（等价于原页面首访）
 *   · 之后每次「页面重新显示」由宿主页 onShow 转发，宿主跳过首屏那一次
 *   · 触底分页：原来是 scroll-view 的 bindscrolltolower，改由宿主页 onReachBottom 转发
 *   · usableCouponCount 变化回传 couponcount（顶栏角标在钱包 tab 上也要有值）
 *   · scrollIntoView（原 scroll-view 的充值成功回顶）改由 wx.pageScrollTo 承接
 */
Component({
  options: { addGlobalClass: true },
  data: Object.assign({}, _pageCfg.data, {
    toastShow: false,
    toastOverline: 'WELCOME BACK',
    toastTitle: '',
    toastDesc: ''
  }),
  methods: Object.assign({
    showWelcomeBack(desc) {
      this.setData({
        toastShow: true,
        toastOverline: 'WELCOME BACK',
        toastTitle: '欢迎回来',
        toastDesc: desc || '账号已恢复'
      })
    },
    onToastClose() {
      this.setData({ toastShow: false })
    },
    onReachBottom() {
      // 用实例方法派发（而非闭包里的 _methods）：语义上就是组件自己处理触底，
      // 也让它可被替换/观测（守卫就靠这一点验证「宿主转发确实到了分页」）
      if (typeof this.onLoadMoreLedgers === 'function') this.onLoadMoreLedgers()
    }
  }, _methods),
  lifetimes: {
    ready() {
      if (typeof _methods.onLoad === 'function') _methods.onLoad.call(this)
      if (typeof _methods.onShow === 'function') _methods.onShow.call(this)
    },
    attached() {
      // 只观察这次 setData，不改 _pageCfg 里任何业务代码
      const raw = this.setData.bind(this)
      this.setData = (patch, cb) => {
        raw(patch, cb)
        if (!patch || typeof patch !== 'object') return
        if ('usableCouponCount' in patch) {
          this.triggerEvent('couponcount', { count: patch.usableCouponCount })
        }
        if (patch.scrollIntoView) {
          try { wx.pageScrollTo({ scrollTop: 0, duration: 300 }) } catch (e) { /* ignore */ }
        }
      }
    }
  }
})
