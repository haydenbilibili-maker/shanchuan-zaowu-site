const db = wx.cloud.database()
const { formatPrice } = require('../../../utils/util')
const { calculateClientPricing } = require('../utils/orderPricing')
const { couponTitle, couponFaceLabel, parseMinSpend, couponChannelAllows } = require('../../../utils/couponHelper')
const { fetchMyCoupons } = require('../../../utils/couponService')
const { formatDiscount } = require('../../../utils/profileHelper')
// 直接读 config（新文件）+ 分包独立模块名 mallShipping，避开主包 utils/shipping 旧缓存
const shippingConfig = require('../../../config/shipping')
const { calcShipping, getShippingFeeLabel, getShippingHint } = require('../utils/mallShipping')
const { ensureShippingRules } = require('../../../utils/shippingRulesSync')
const { consumeCheckoutPayload, saveCheckoutPayload } = require('../../../utils/checkout')
const { payForOrder } = require('../utils/payment')
const { buildPreviewSummary } = require('../utils/customHelper')
const { getDisplayNotice } = require('../utils/refundPolicy')
const { fetchContentDisplayFlags, getCachedContentDisplayFlags, toastStorePickupClosed } = require('../../../utils/contentDisplayFlags')
const {
  GIFT_PACKAGING_LABEL,
  GIFT_PACKAGING_NOTE
} = require('../utils/giftPackaging')
const {
  ANIMAL_ETHICS_LABEL,
  ANIMAL_ETHICS_SUMMARY,
  ANIMAL_ETHICS_NOTE,
  orderHasAnimalSpecimen
} = require('../utils/animalEthicsNotice')
const {
  ONE_PERCENT_PLEDGE_LABEL,
  ONE_PERCENT_PLEDGE_SLOGAN,
  ONE_PERCENT_PLEDGE_SUMMARY,
  ONE_PERCENT_PLEDGE_NOTE,
  calcPledgeAmount
} = require('../utils/onePercentPledge')
const { resolveCareCategory } = require('../utils/careDefaults')
const {
  resolveFromLadder,
  resolveProjectedUpgrade,
  estimateGoodsGrowthBase,
  buildProvisionalTip
} = require('../utils/memberPricing')
const { resolveCheckoutCareNotice } = require('../utils/checkoutCareNotice')

/**
 * 普通标本温馨提示：保留手工温度与「仅此一件」表述；
 * 按意群可控分行，避免尴尬短尾巴。
 */
const SPECIMEN_NOTICE_DEFAULT = {
  bodyLines: [
    {
      segs: [{ t: '藏品均由标本师手工装裱与自然采集，' }]
    },
    {
      segs: [
        { t: '每一件的形态、色泽与细节均为' },
        { t: '仅此一件', brass: true },
        { t: '。' }
      ]
    },
    {
      segs: [{ t: '图片展示的是风格与大致规格，' }]
    },
    {
      segs: [{ t: '实物可能存在合理的个体差异——' }]
    },
    {
      segs: [
        { t: '这正是手工藏品的温度所在', brass: true },
        { t: '。' }
      ]
    }
  ],
  noteSegments: [
    { t: '下单即表示您已理解并接受这一特性，' },
    { t: '请以收到的实物为准', brass: true },
    { t: '。' }
  ]
}

/** 孤品：所见即所得，语气同样有温度 */
const SPECIMEN_NOTICE_GUPIN = {
  bodyLines: [
    {
      segs: [
        { t: '本单所含孤品均为' },
        { t: '所见即所得', brass: true },
        { t: '——' }
      ]
    },
    {
      segs: [{ t: '页面展示即为您将收到的那一件。' }]
    },
    {
      segs: [{ t: '物流与光线仍可能带来细微差异，敬请理解。' }]
    }
  ],
  noteSegments: [
    { t: '下单即表示您已理解并接受这一特性，' },
    { t: '请以收到的实物为准', brass: true },
    { t: '。' }
  ]
}

/**
 * 是否含「孤品」（不含镇店之宝）。
 * 混单：只要有一件孤品即用孤品文案。
 */
function orderHasGuPin(items) {
  if (!Array.isArray(items) || !items.length) return false
  return items.some((item) => {
    if (!item || item.isTreasure === true) return false
    if (item.isUnique === true || item.isOneOfAKind === true) return true
    const text = [item.title, item.name, item.tags]
      .flat()
      .filter(Boolean)
      .join(' ')
    if (/镇店之宝|镇馆之宝/.test(text)) return false
    return /孤品/.test(text)
  })
}

function resolveSpecimenNotice(items) {
  return orderHasGuPin(items) ? SPECIMEN_NOTICE_GUPIN : SPECIMEN_NOTICE_DEFAULT
}

/** 结账页固定短说明，不用钱包配置里的充值/L1–L6 长规则（避免先长后短撑高卡片） */
const CHECKOUT_WALLET_BENEFIT = '用钱包支付时，按本单可达的会员等级享受专属支付折扣。'
const WALLET_CACHE_KEY = 'stored_value_wallet_snapshot_v1'

function currentOpenid() {
  try {
    const app = getApp()
    return (app && app.globalData && app.globalData.openid) || ''
  } catch (e) {
    return ''
  }
}

function yuanToFen(yuan) {
  const n = Number(yuan)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.round(n * 100))
}

function hasYuanValue(v) {
  return v != null && String(v).trim() !== ''
}

function readWalletSnapshot() {
  try {
    const raw = wx.getStorageSync(WALLET_CACHE_KEY)
    if (!raw || typeof raw !== 'object') return null
    const openid = currentOpenid()
    if (openid && raw.openid && raw.openid !== openid) return null
    const availableYuan = hasYuanValue(raw.availableYuan) ? String(raw.availableYuan) : ''
    const memberNo = raw.memberNo ? String(raw.memberNo) : ''
    if (!availableYuan && !memberNo) return null
    return {
      availableYuan: availableYuan || '0.00',
      availableFen: yuanToFen(availableYuan || 0)
    }
  } catch (e) {
    return null
  }
}

function writeWalletSnapshot(account) {
  if (!account) return
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

/**
 * 首屏钱包卡：有开关缓存则按缓存；未知时默认占位展示，避免异步插入「弹出」。
 * 仅在明确关闭钱包能力时隐藏。
 */
function buildBootWalletSlot() {
  const cached = getCachedContentDisplayFlags()
  const flags = cached && cached.flags
  const flagsKnown = !!flags
  const knownClosed = flagsKnown && flags.showStoredValue !== true
  if (knownClosed) {
    return {
      walletEnabled: false,
      walletBalancePending: false,
      walletAvailableFen: 0,
      walletAvailableYuan: '0.00',
      walletBenefitText: CHECKOUT_WALLET_BENEFIT
    }
  }
  const snap = readWalletSnapshot()
  if (snap) {
    return {
      walletEnabled: true,
      walletBalancePending: false,
      walletAvailableFen: snap.availableFen,
      walletAvailableYuan: snap.availableYuan,
      walletBenefitText: CHECKOUT_WALLET_BENEFIT
    }
  }
  return {
    walletEnabled: true,
    walletBalancePending: true,
    walletAvailableFen: 0,
    walletAvailableYuan: '--',
    walletBenefitText: CHECKOUT_WALLET_BENEFIT
  }
}

const _bootWallet = buildBootWalletSlot()

function campaignActive() {
  if (typeof shippingConfig.isCampaignActive === 'function') {
    return shippingConfig.isCampaignActive()
  }
  return !!(shippingConfig.freeShippingCampaign && shippingConfig.freeShippingCampaign.enabled === true)
}

function campaignLabel() {
  if (typeof shippingConfig.getCampaignLabel === 'function') {
    return shippingConfig.getCampaignLabel()
  }
  return (shippingConfig.freeShippingCampaign && shippingConfig.freeShippingCampaign.label) || '当前全场免邮'
}

function ruleText(context) {
  if (typeof shippingConfig.getRuleText === 'function') {
    return shippingConfig.getRuleText(context)
  }
  if (campaignActive()) return campaignLabel()
  const accessory = (shippingConfig.thresholds && shippingConfig.thresholds.accessory) || 200
  const specimen = (shippingConfig.thresholds && shippingConfig.thresholds.specimen) || 500
  const fee = shippingConfig.shippingFee != null ? shippingConfig.shippingFee : 18
  return `顺丰速运 · 饰品满 ¥${accessory} / 藏品满 ¥${specimen} 包邮，否则运费 ¥${fee}`
}

/** 目录运费（划线用），与实际计费无关 */
function listShippingFee() {
  const raw = shippingConfig.flatFee != null ? shippingConfig.flatFee : shippingConfig.shippingFee
  const fee = parseFloat(raw)
  return Number.isFinite(fee) && fee > 0 ? fee : 18
}

function carrierShortLabel() {
  const full = (typeof shippingConfig.getCarrierLabel === 'function')
    ? shippingConfig.getCarrierLabel()
    : (shippingConfig.defaultCarrier || '顺丰速运')
  return String(full || '顺丰').replace(/速运$/, '')
}

function shippingCarrierLabel() {
  return (typeof shippingConfig.getCarrierLabel === 'function')
    ? shippingConfig.getCarrierLabel()
    : (shippingConfig.defaultCarrier || '顺丰速运')
}

function shippingLineLabelText(carrier) {
  const name = carrier || shippingCarrierLabel()
  return name ? `运费 · ${name}` : '运费'
}

/**
 * 底部运费说明：免邮时不得再写「本单运费 ¥x」
 */
function buildShippingRuleText({ campaignOn, shippingFee, amount, items, selectedCoupon }) {
  if (campaignOn) return campaignLabel()
  if (shippingFee <= 0) {
    if (selectedCoupon && selectedCoupon.type === 'freeShipping') {
      return `本单免邮 · ${carrierShortLabel()}（免邮券）`
    }
    const hint = getShippingHint(amount, items)
    if (hint && !/本单运费/.test(hint)) return hint
    return `本单免邮 · ${carrierShortLabel()}`
  }
  return getShippingHint(amount, items)
}

/** 账单「优惠券」行：触顶文案与是否可点选 */
function resolveCouponRowState({ goodsFloorHit, coupons, shipFeeWithoutCoupon, campaignOn }) {
  const list = Array.isArray(coupons) ? coupons : []
  const usable = list.filter((c) => c && !c._disabled)
  const freeShipUsable = usable.some((c) => (c.type || 'cash') === 'freeShipping')
  // 本单运费已为 0 时免邮券也无实际收益
  const freeShipCanHelp = !campaignOn && shipFeeWithoutCoupon > 0 && freeShipUsable

  if (goodsFloorHit && !freeShipCanHelp) {
    return {
      couponRowText: '您已达到最大优惠额度，礼券暂不可用',
      couponRowBlocked: true
    }
  }
  if (goodsFloorHit && freeShipCanHelp) {
    return {
      couponRowText: '现金礼券已达上限，免邮券可选',
      couponRowBlocked: false
    }
  }
  if (usable.length > 0) {
    return {
      couponRowText: `可选 ${usable.length} 张`,
      couponRowBlocked: false
    }
  }
  return {
    couponRowText: '暂无可用',
    couponRowBlocked: false
  }
}

Page({
  data: {
    items: [],
    source: 'cart',
    address: null,
    coupons: [],
    selectedCoupon: null,
    couponHint: '',
    couponRowText: '暂无可用',
    couponRowBlocked: false,
    showCouponModal: false,
    authResumeHint: '',
    showAuthResumeHint: false,
    originalPrice: '0.00',
    finalPrice: '0.00',
    savedAmount: '0.00',
    vipSaved: 0,
    couponSaved: 0,
    depositCredit: 0,
    depositCreditDisplay: '',
    shippingFee: 0,
    shippingFeeDisplay: '0.00',
    shippingFeeLabel: campaignActive() ? '免邮' : getShippingFeeLabel(0),
    isShippingFree: true,
    showShippingStrike: listShippingFee() > 0,
    originalShippingFee: listShippingFee(),
    originalShippingFeeDisplay: formatPrice(listShippingFee()),
    shippingRuleText: ruleText(),
    shippingCarrier: shippingCarrierLabel(),
    shippingLineLabel: shippingLineLabelText(),
    campaignLabel: campaignLabel(),
    freeShippingCampaign: campaignActive(),
    remark: '',
    remarkOpen: false,
    remarkFocus: false,
    remarkFocused: false,
    discountRate: 1.0,
    discountText: '',
    discountLabel: '会员折扣',
    levelName: '会员',
    provisionalTip: '',
    submitting: false,
    /** 服务端价格校验失败：阻断提交，避免按本地估算价确认后被按云端价扣款 */
    serverPreviewFailed: false,
    customMeta: null,
    customExtraPrice: 0,
    customPreviewLines: [],
    isCustomOrder: false,
    showCareNotice: false,
    careNoticeTitle: '启程前须知',
    careNoticeIntro: '',
    careHasButterfly: false,
    careUnboxLabel: '',
    careUnboxLines: [],
    careAntennaLines: [],
    careCareLabel: '',
    careCareLines: [],
    showSpecimenNotice: false,
    specimenNoticeBodyLines: SPECIMEN_NOTICE_DEFAULT.bodyLines,
    specimenNoticeNoteSegments: SPECIMEN_NOTICE_DEFAULT.noteSegments,
    specimenPledgeLine: '',
    specimenPledgeHasAmount: false,
    specimenPledgeLineBefore: '',
    specimenPledgeLineAmount: '',
    specimenPledgeLineAfter: '',
    refundPolicyLabel: '',
    refundPolicyParagraphs: [],
    refundPolicyRichParagraphs: [],
    walletEnabled: _bootWallet.walletEnabled,
    useWalletPay: false,
    walletToggling: false,
    walletBalancePending: _bootWallet.walletBalancePending,
    walletAvailableFen: _bootWallet.walletAvailableFen,
    walletAvailableYuan: _bootWallet.walletAvailableYuan,
    walletBenefitText: CHECKOUT_WALLET_BENEFIT,
    walletPayYuan: '0.00',
    wxpayYuan: '0.00',
    /** 底栏/应付：开钱包后为微信尾款（或 0）；未开则为订单应付 */
    payNowYuan: '0.00',
    payNowLabel: '应付',
    footerPayLabel: '合计',
    serverPreviewReady: false,
    isGiftOrder: false,
    isGiftInvite: false,
    isGiftStorePickup: false,
    giftNeedsAddress: false,
    giftDeliveryLabel: '',
    giftDeliveryHint: '',
    giftPackagingLabel: GIFT_PACKAGING_LABEL,
    giftPackagingNote: GIFT_PACKAGING_NOTE,
    storePickup: false,
    /** 门店自取开关（超管后台）：false 时隐藏交付方式并回落快递 */
    storePickupEnabled: true,
    pickupStoreId: '',
    pickupStoreName: '',
    pickupStoreAddress: '',
    showAnimalEthics: false,
    ethicsExpanded: false,
    pledgeExpanded: false,
    animalEthicsLabel: ANIMAL_ETHICS_LABEL,
    animalEthicsSummary: ANIMAL_ETHICS_SUMMARY,
    animalEthicsNote: ANIMAL_ETHICS_NOTE,
    onePercentPledgeLabel: ONE_PERCENT_PLEDGE_LABEL,
    onePercentPledgeSlogan: ONE_PERCENT_PLEDGE_SLOGAN,
    onePercentPledgeSummary: ONE_PERCENT_PLEDGE_SUMMARY,
    onePercentPledgeNote: ONE_PERCENT_PLEDGE_NOTE,
    giftCardBody: '',
    giftCardSignature: '',
    giftHasVoice: false
  },

  onLoad() {
    this.hydrateWalletSlotFromCache()
    ensureShippingRules().then(() => {
      this.recalculate(undefined, { silentDrop: true })
    }).catch(() => {})
    this.initPayload()
    this.loadDefaultAddress()
    this.applyStorePickupFlag()
    const walletReady = this.loadWalletOption()
    // 优化：券包的网络请求与会员折扣并行（券可用性计算依赖折扣，故取回后再计算）
    const couponPack = fetchMyCoupons({ usableOnly: true }).catch((e) => {
      console.warn('confirm-order prefetchCoupons', e)
      return { list: [] }
    })
    Promise.all([this.loadUserDiscount(), couponPack])
      .then(([, packed]) => this.loadCoupons(packed))
      .catch((e) => console.warn('confirm-order bootstrap', e))
      .then(() => walletReady)
      .then(() => this.syncServerPricingPreview())
  },

  onShow() {
    this.resumeAfterAuthIfNeeded()
  },

  /** 离开去注册/绑号前，把当前结算快照写回，避免页被销毁后无法恢复 */
  persistCheckoutForAuth() {
    const items = this.data.items || []
    if (!items.length) return
    try {
      saveCheckoutPayload({
        source: this.data.source || 'cart',
        items,
        couponId: (this.data.selectedCoupon && this.data.selectedCoupon._id) || this._prefCouponId || null,
        customMeta: this._customMeta || this.data.customMeta || null,
        customExtraPrice: this._customExtraPrice || this.data.customExtraPrice || 0,
        giftMeta: this._giftMeta || null,
        depositIntentId: this._depositIntentId || null,
        storePickup: !!this.data.storePickup,
        pickupStoreId: this.data.pickupStoreId || '',
        pickupStoreName: this.data.pickupStoreName || '',
        pickupStoreAddress: this.data.pickupStoreAddress || ''
      })
    } catch (e) {
      console.warn('persistCheckoutForAuth', e)
    }
  },

  async resumeAfterAuthIfNeeded() {
    if (this._resumingAuth) return
    const {
      peekOnboardingReturn,
      hasPhone,
      ensureSession,
      consumeOnboardingReturn,
      refreshSessionAfterAuth
    } = require('../../../utils/userSession')
    const intent = peekOnboardingReturn()
    if (!intent || !intent.pendingResume) return
    if (intent.from && intent.from !== 'checkout' && intent.from !== 'phone') return

    this._resumingAuth = true
    this._authNavigating = false
    try {
      // 退出态注册成功后必须清本机退出锁，否则永远读到 guest、反复引导注册
      let session = await refreshSessionAfterAuth(getApp())
      if (!hasPhone(session)) {
        session = await ensureSession(getApp(), { force: true })
      }
      if (!hasPhone(session)) {
        // 仍无手机号：清掉挂起意图，避免死循环；提示可再试
        consumeOnboardingReturn()
        this.setData({
          authResumeHint: '授权未完成，请再次点击提交订单完成绑定',
          showAuthResumeHint: true
        })
        return
      }
      consumeOnboardingReturn()
      const beforeIds = new Set((this.data.coupons || []).map((c) => c && c._id).filter(Boolean))
      try {
        // 券包预取与折扣并行
        const [packed] = await Promise.all([
          fetchMyCoupons({ usableOnly: true }).catch(() => ({ list: [] })),
          this.loadUserDiscount()
        ])
        await this.loadCoupons(packed)
        this.syncServerPricingPreview()
      } catch (e) { /* ignore */ }
      const after = this.data.coupons || []
      const gained = after.some((c) => c && c._id && !beforeIds.has(c._id) && !c._disabled)
      const selected = this.data.selectedCoupon
      let hint = '已完成授权，可继续提交订单'
      const selectedIsNewGift = !!(
        selected &&
        (String(selected.couponSource || '') === 'register_gift' ||
          /新客|注册|欢迎|新会员|welcome/i.test(String(selected.title || selected.sourceLabel || '')))
      )
      if (selectedIsNewGift) {
        const saveYuan = Number(selected.value) > 0 ? `¥${Number(selected.value)}` : ''
        hint = `新客礼已自动选用「${selected.title || '礼券'}」${saveYuan ? `，本单省 ${saveYuan}` : ''}`
      } else if (gained || selected) {
        hint = '新客礼已放入本单，可在礼券中选用'
      }
      this.setData({
        authResumeHint: hint,
        showAuthResumeHint: true
      })
    } catch (e) {
      console.warn('resumeAfterAuthIfNeeded', e)
    } finally {
      this._resumingAuth = false
    }
  },

  dismissAuthResumeHint() {
    this.setData({ showAuthResumeHint: false })
  },

  hydrateWalletSlotFromCache() {
    this.setData(buildBootWalletSlot())
  },

  initPayload() {
    const payload = consumeCheckoutPayload()
    if (!payload || !payload.items || !payload.items.length) {
      wx.showToast({ title: '结算信息无效', icon: 'none' })
      setTimeout(() => {
        wx.navigateBack({
          fail: () => wx.switchTab({ url: '/pages/cart/index' })
        })
      }, 1500)
      return
    }

    this._prefCouponId = payload.couponId || null
    this._customMeta = payload.customMeta || null
    this._customExtraPrice = payload.customExtraPrice || 0
    // 礼赠半接通：透传至 makeOrder；invite_address 免强制地址
    this._giftMeta = payload.giftMeta || null
    this._depositIntentId = payload.depositIntentId || null
    const isCustomOrder = payload.source === 'custom' || !!(payload.customMeta && payload.customMeta.isCustom)
    const isGiftOrder = payload.source === 'gift' || !!payload.giftMeta
    const deliveryType = (this._giftMeta && this._giftMeta.deliveryType) || ''
    const isGiftInvite = deliveryType === 'invite_address'
    const isGiftStorePickup = deliveryType === 'store_pickup'
    const giftNeedsAddress = isGiftOrder && !isGiftInvite && !isGiftStorePickup
    const storePickup = !isGiftOrder && !!payload.storePickup
    const giftDeliveryLabels = {
      invite_address: '邀请 TA 留下去处',
      ship_to_receiver: '快递妥投给 TA',
      ship_to_self: '先寄给我，再当面转交',
      store_pickup: '门店自提代赠'
    }
    const giftDeliveryHints = {
      invite_address: '礼笺已备妥。支付后交给 TA——对方启封并写下收件去处后，馆长再启程。默认隐价。',
      ship_to_receiver: '请填写 TA 的收货地址。支付后馆长即按址妥投；仍可分享礼笺让对方先读到你的话。',
      ship_to_self: '请填写你的收货地址。藏品先到你处，再当面转交这份山海。',
      store_pickup: `门店「${(this._giftMeta && this._giftMeta.storeName) || '已选门店'}」将备妥。支付后出示妥投码，由馆长核销交予 TA。`
    }
    const giftDeliveryLabel = giftDeliveryLabels[deliveryType] || deliveryType || ''
    const giftDeliveryHint = giftDeliveryHints[deliveryType] || ''
    const giftCardBody = String((this._giftMeta && this._giftMeta.cardBody) || '').trim()
    const giftCardSignature = String((this._giftMeta && this._giftMeta.cardSignature) || '').trim()
    const giftHasVoice = !!(
      this._giftMeta &&
      this._giftMeta.voiceFileID &&
      Number(this._giftMeta.voiceDuration) > 0
    )
    const policyInput = {
      source: payload.source,
      customMeta: payload.customMeta,
      products: payload.items || [],
      pet: payload.pet,
      petMemorial: payload.petMemorial
    }
    const notice = getDisplayNotice(policyInput)
    this.setData({
      items: payload.items,
      source: payload.source || 'cart',
      customMeta: payload.customMeta || null,
      customExtraPrice: payload.customExtraPrice || 0,
      customPreviewLines: payload.customMeta ? buildPreviewSummary(payload.customMeta) : [],
      isCustomOrder,
      isGiftOrder,
      isGiftInvite,
      isGiftStorePickup,
      giftNeedsAddress,
      storePickup,
      giftDeliveryLabel,
      giftDeliveryHint,
      giftCardBody,
      giftCardSignature,
      giftHasVoice,
      showAnimalEthics: orderHasAnimalSpecimen(payload.items, resolveCareCategory),
      refundPolicyLabel: notice.label,
      refundPolicyParagraphs: notice.paragraphs,
      refundPolicyRichParagraphs: notice.richParagraphs || []
    })
    this.recalculate(undefined, { silentDrop: true })
  },

  /** 加载默认自取门店（主店）供结算页展示 */
  async loadPickupStore() {
    if (this.data.isGiftOrder) return
    try {
      const res = await wx.cloud.callFunction({ name: 'getStoreConfig' })
      const stores = ((res && res.result) || {}).stores || []
      const main =
        stores.find((s) => s && (s.isDefault || s.role === 'main')) ||
        stores[0]
      if (!main) return
      this.setData({
        pickupStoreId: main.storeId || main._id || '',
        pickupStoreName: main.name || '山川造物',
        pickupStoreAddress: main.address || main.locationLabel || ''
      })
    } catch (e) {
      console.warn('loadPickupStore', e)
    }
  },

  setStorePickup(e) {
    if (this.data.isGiftOrder) return
    const on = !!(e && e.currentTarget && e.currentTarget.dataset && (
      e.currentTarget.dataset.on === true ||
      e.currentTarget.dataset.on === 'true'
    ))
    if (on && this.data.storePickupEnabled === false) {
      toastStorePickupClosed()
      return
    }
    if (!!this.data.storePickup === on) return
    this.setData({ storePickup: on })
    this.recalculate(undefined, { silentDrop: true })
    this.syncServerPricingPreview()
  },

  /**
   * @param {object|null|undefined} couponOverride 传入则用该券计价（避免 setData 竞态）
   * @param {{ silentDrop?: boolean }} opts silentDrop=true 时门槛/地板不满足只清券不 toast
   */
  recalculate(couponOverride, opts = {}) {
    const silentDrop = !!opts.silentDrop
    let selectedCoupon = couponOverride !== undefined
      ? couponOverride
      : this.data.selectedCoupon

    let pricing = calculateClientPricing(
      this.data.items,
      this.data.discountRate,
      selectedCoupon,
      this.data.customExtraPrice
    )

    // 门槛不满足：calculateClientPricing 已丢券
    if (pricing.couponDroppedForMinSpend && selectedCoupon) {
      if (!silentDrop) {
        const need = parseMinSpend(selectedCoupon)
        wx.showToast({
          title: need > 0 ? `满 ¥${need} 可用（按会员折后计）` : '未达到用礼券门槛',
          icon: 'none'
        })
      }
      selectedCoupon = null
    }

    // 现金/折扣券在会员折已达 75% 地板时无法再抵扣
    if (pricing.selectedCoupon && pricing.couponNoGoodsSave) {
      if (!silentDrop) {
        wx.showToast({ title: '会员折扣已达优惠上限，本单无法再叠加此礼券', icon: 'none' })
      }
      selectedCoupon = null
      pricing = calculateClientPricing(
        this.data.items,
        this.data.discountRate,
        null,
        this.data.customExtraPrice
      )
    } else {
      selectedCoupon = pricing.selectedCoupon
    }

    const campaignOn = campaignActive()
    const items = this.data.items || []
    const shippingBase = pricing.originalPrice
    const storePickup = !!this.data.storePickup && !this.data.isGiftOrder
    const shipFeeWithoutCoupon = (campaignOn || storePickup) ? 0 : calcShipping(shippingBase, items)
    let shippingFee = shipFeeWithoutCoupon
    if (storePickup || (selectedCoupon && selectedCoupon.type === 'freeShipping')) {
      shippingFee = 0
    }

    // 同步券可用性：触顶现金券 / 已免邮时的免邮券
    const prevCoupons = this.data.coupons || []
    const coupons = prevCoupons.map((c) => {
      if (!c) return c
      const type = c.type || 'cash'
      const minSpend = c.minSpend != null ? c.minSpend : parseMinSpend(c)
      const belowMin = pricing.vipTotal < minSpend
      if (type === 'freeShipping') {
        const freeShipUseless = shipFeeWithoutCoupon <= 0
        const disabled = belowMin || freeShipUseless
        if (!!c._disabled === disabled && !!c._freeShipUseless === freeShipUseless) return c
        return { ...c, _disabled: disabled, _freeShipUseless: freeShipUseless, _noStack: false }
      }
      const noStack = !!pricing.goodsFloorHit
      const disabled = belowMin || noStack
      if (!!c._disabled === disabled && !!c._noStack === noStack) return c
      return { ...c, _disabled: disabled, _noStack: noStack, _freeShipUseless: false }
    })

    const couponSaved = selectedCoupon ? pricing.couponSaved : 0
    const payable = Math.round((pricing.finalPrice + shippingFee) * 100) / 100
    const isShippingFree = shippingFee <= 0
    const originalFee = listShippingFee()
    const showShippingStrike = isShippingFree && originalFee > 0
    let couponHint = ''
    if (selectedCoupon) {
      if (selectedCoupon.type === 'freeShipping') {
        couponHint = '免邮'
      } else if (couponSaved > 0) {
        couponHint = `-¥${formatPrice(couponSaved)}`
      }
    }

    const rowState = resolveCouponRowState({
      goodsFloorHit: !!pricing.goodsFloorHit,
      coupons,
      shipFeeWithoutCoupon,
      campaignOn
    })

    // 本地估算钱包拆分（有服务端预览时由 syncServerPricingPreview 覆盖）
    let walletPayYuan = this.data.walletPayYuan || '0.00'
    let wxpayYuan = this.data.wxpayYuan || '0.00'
    if (!this.data.serverPreviewReady) {
      const totalFen = Math.round(payable * 100)
      const availableFen = Math.max(0, Number(this.data.walletAvailableFen) || 0)
      const walletFen = this.data.useWalletPay ? Math.min(availableFen, totalFen) : 0
      walletPayYuan = formatPrice(walletFen / 100)
      wxpayYuan = formatPrice(Math.max(0, totalFen - walletFen) / 100)
    }

    const useWallet = !!this.data.useWalletPay
    const payNowYuan = useWallet ? wxpayYuan : formatPrice(payable)
    const payNowLabel = useWallet
      ? (wxpayYuan === '0.00' ? '还需支付' : '还需支付')
      : '应付'
    let footerPayLabel = useWallet
      ? (wxpayYuan === '0.00' ? '钱包支付' : '还需支付')
      : '合计'
    if (this.data.isGiftOrder && !useWallet) footerPayLabel = '备妥应付'

    this.setData({
      coupons,
      selectedCoupon,
      couponHint,
      couponRowText: rowState.couponRowText,
      couponRowBlocked: rowState.couponRowBlocked,
      originalPrice: formatPrice(pricing.originalPrice),
      finalPrice: formatPrice(payable),
      payNowYuan,
      payNowLabel,
      footerPayLabel,
      savedAmount: formatPrice(pricing.totalSaved),
      vipSaved: pricing.vipSaved,
      couponSaved,
      shippingFee,
      shippingFeeDisplay: formatPrice(shippingFee),
      shippingFeeLabel: isShippingFree ? '免邮' : getShippingFeeLabel(shippingFee),
      isShippingFree,
      showShippingStrike,
      originalShippingFee: originalFee,
      originalShippingFeeDisplay: formatPrice(originalFee),
      shippingRuleText: buildShippingRuleText({
        campaignOn,
        shippingFee,
        amount: shippingBase,
        items,
        selectedCoupon
      }),
      shippingLineLabel: shippingLineLabelText(this.data.shippingCarrier),
      campaignLabel: campaignLabel(),
      freeShippingCampaign: campaignOn,
      walletPayYuan,
      wxpayYuan,
      discountLabel: this.data.discountLabel || `${this.data.levelName || '会员'}折扣`
    })
  },

  /**
   * 门店自取开关（超管后台 content_display_flags.showStorePickup）：
   * 关闭时结算页不展示「门店自取」交付方式，并强制回落快递；取开关失败按开启兜底。
   */
  async applyStorePickupFlag() {
    let enabled = true
    try {
      const { flags } = await fetchContentDisplayFlags()
      enabled = flags.showStorePickup !== false
    } catch (e) {
      console.warn('applyStorePickupFlag', e && e.message)
    }
    this.setData({ storePickupEnabled: enabled })
    if (!enabled) {
      if (this.data.storePickup) {
        this.setData({ storePickup: false })
        this.recalculate(undefined, { silentDrop: true })
      }
      return
    }
    this.loadPickupStore()
  },

  async loadWalletOption() {
    try {
      const { flags } = await fetchContentDisplayFlags()
      if (!flags.showStoredValue) {
        this.setData({
          walletEnabled: false,
          useWalletPay: false,
          walletBalancePending: false,
          walletAvailableFen: 0,
          walletAvailableYuan: '0.00',
          walletBenefitText: CHECKOUT_WALLET_BENEFIT
        })
        return
      }
      const res = await wx.cloud.callFunction({
        name: 'manageStoredValue',
        data: { action: 'getAccount' }
      })
      const r = (res && res.result) || {}
      if (!r.success || r.enabled === false) {
        this.setData({
          walletEnabled: false,
          useWalletPay: false,
          walletBalancePending: false
        })
        return
      }
      const account = r.account || {}
      const availableFen = Math.max(0, Number(account.availableFen) || 0)
      const availableYuan = account.availableYuan || formatPrice(availableFen / 100)
      writeWalletSnapshot(account)
      this.setData({
        walletEnabled: true,
        walletBalancePending: false,
        walletAvailableFen: availableFen,
        walletAvailableYuan: availableYuan,
        walletBenefitText: CHECKOUT_WALLET_BENEFIT,
        useWalletPay: availableFen > 0 ? this.data.useWalletPay : false
      })
      this.recalculate(undefined, { silentDrop: true })
    } catch (e) {
      console.warn('loadWalletOption', e)
      if (this.data.walletEnabled) {
        this.setData({ walletBalancePending: false })
        return
      }
      this.setData({ walletEnabled: false, useWalletPay: false, walletBalancePending: false })
    }
  },

  onWalletPayToggle(e) {
    const on = !!(e.detail && e.detail.value)
    if (on && this.data.walletAvailableFen <= 0) {
      wx.showToast({ title: '钱包暂无余额', icon: 'none' })
      this.setData({ useWalletPay: false })
      return
    }
    if (on) {
      wx.vibrateShort({ type: 'light' })
    }
    this.setData({
      useWalletPay: on,
      serverPreviewReady: false,
      walletToggling: true,
      discountLabel: on ? `${this.data.levelName || '会员'}折扣` : `${this.data.levelName || '会员'}折扣`
    })
    this.recalculate()
    this.syncServerPricingPreview().finally(() => {
      this.setData({ walletToggling: false })
    })
  },

  toggleBrandNote(e) {
    const field = e.currentTarget.dataset.field
    if (field !== 'ethicsExpanded' && field !== 'pledgeExpanded') return
    this.setData({ [field]: !this.data[field] })
  },

  openRemark() {
    this.setData({ remarkOpen: true, remarkFocus: false })
    // 下一帧再 focus，避免折叠切换时 focus 失效
    setTimeout(() => {
      this.setData({ remarkFocus: true })
    }, 50)
  },

  closeRemarkIfEmpty() {
    if (String(this.data.remark || '').trim()) return
    this.setData({ remarkOpen: false, remarkFocus: false, remarkFocused: false })
  },

  onRemarkInput(e) {
    this.setData({ remark: (e.detail.value || '').slice(0, 200) })
  },

  onRemarkFocus() {
    this.setData({ remarkFocused: true })
  },

  onRemarkBlur() {
    const remark = String(this.data.remark || '').trim()
    this.setData({
      remarkFocused: false,
      remarkFocus: false,
      remarkOpen: false,
      remark
    })
  },

  /**
   * 本地预估定级（与 makeOrder 规则同构）：
   * 货值(+运费)估成长 → 预计等级 → 用该档折扣展示；服务端预览成功后再覆盖。
   */
  applyProvisionalFromStats() {
    const stats = this._memberStats
    if (!stats) return

    const isHonorary = !!(stats.userInfo && stats.userInfo.isHonorary) || Number(stats.level) === 99
    const ladder = stats.levelLadder || []
    const growthValue = Math.max(0, Math.floor(Number(stats.growthValue) || 0))
    const current = {
      level: stats.level || 1,
      levelName: stats.levelName || '原木·见习者',
      discountRate: stats.discountRate != null ? stats.discountRate : 1
    }

    const items = this.data.items || []
    const campaignOn = campaignActive()
    const goodsBase = estimateGoodsGrowthBase(items, this.data.customExtraPrice)
    const storePickup = !!this.data.storePickup && !this.data.isGiftOrder
    const shippingFee = (campaignOn || storePickup) ? 0 : calcShipping(goodsBase, items)
    // 与云端 computeGrowthBasePayable 一致：会员折前应付（此处无券时 ≈ 货值+运费）
    let orderGrowthEstimate = Math.floor(goodsBase + shippingFee)
    const coupon = this.data.selectedCoupon
    if (coupon && coupon.type === 'freeShipping') {
      orderGrowthEstimate = Math.floor(goodsBase)
    } else if (coupon && coupon.type !== 'freeShipping' && coupon.type !== 'discount') {
      const cash = Math.max(0, parseFloat(coupon.value) || 0)
      orderGrowthEstimate = Math.max(0, Math.floor(goodsBase + shippingFee - cash))
    }

    let discountRate = current.discountRate
    let levelName = current.levelName
    let provisionalTip = ''

    if (!isHonorary && ladder.length) {
      const resolvedCurrent = resolveFromLadder(ladder, growthValue, false)
      const projected = resolveProjectedUpgrade(
        ladder,
        growthValue,
        orderGrowthEstimate,
        resolvedCurrent,
        false
      )
      if (projected) {
        discountRate = projected.discountRate
        levelName = projected.levelName
        provisionalTip = buildProvisionalTip(projected)
      } else {
        discountRate = resolvedCurrent.discountRate
        levelName = resolvedCurrent.levelName
      }
    } else if (isHonorary) {
      const honorary = resolveFromLadder(ladder, growthValue, true)
      discountRate = honorary.discountRate
      levelName = honorary.levelName
    }

    this.setData({
      discountRate,
      levelName,
      discountText: formatDiscount(discountRate),
      provisionalTip
    })
  },

  loadUserDiscount() {
    return new Promise((resolve) => {
      wx.cloud.callFunction({
        name: 'getUserStats',
        success: (res) => {
          if (res.result) {
            this._memberStats = res.result
            this.applyProvisionalFromStats()
            this.recalculate(undefined, { silentDrop: true })
          }
          resolve()
        },
        fail: () => resolve()
      })
    })
  },

  /** 与 makeOrder 同源预览：含钱包折扣与支付拆分 */
  async syncServerPricingPreview() {
    const items = this.data.items || []
    if (!items.length) return
    const seq = (this._previewSeq = (this._previewSeq || 0) + 1)
    const couponSnapshot = this.data.selectedCoupon
    const couponId = couponSnapshot ? couponSnapshot._id : null
    try {
      const res = await wx.cloud.callFunction({
        name: 'makeOrder',
        data: {
          previewOnly: true,
          useWalletPay: !!this.data.useWalletPay,
          depositIntentId: this._depositIntentId || null,
          // 礼赠自提在云端同样免运费（makeOrder 对 giftMeta.deliveryType==='store_pickup' 强制 shippingFee=0），
          // 预览必须同口径，否则用户看到「应付 ¥X+运费」而实际扣 ¥X
          storePickup: !!(this.data.storePickup || this.data.isGiftStorePickup) ,
          fulfillmentType: (this.data.storePickup || this.data.isGiftStorePickup) ? 'store_pickup' : undefined,
          items: items.map((item) => ({
            productId: item.productId || item.id || item._id,
            skuId: item.skuId || '',
            count: item.count || 1,
            collectionId: item.collectionId || null
          })),
          couponId,
          customMeta: this._customMeta,
          customExtraPrice: this._customExtraPrice
        }
      })
      if (seq !== this._previewSeq) return
      const r = res.result || {}
      if (!r.success) {
        console.warn('syncServerPricingPreview failed', r.msg || r)
        const msg = String(r.msg || '')
        const couponRejected = !!(couponId && /优惠券|门槛|过期|门店使用/.test(msg))
        if (couponRejected) {
          wx.showToast({ title: msg.slice(0, 20) || '礼券不可用', icon: 'none' })
          this.setData({ selectedCoupon: null, couponHint: '', serverPreviewReady: false })
          this.applyProvisionalFromStats()
          this.recalculate(null, { silentDrop: true })
          return
        }
        // 服务端价格校验失败：此前静默回落到本地估算，用户可能按「所见价」确认却被按云端价扣款。
        // 现在标记为未就绪并阻断提交，给出明确重试入口。
        this.setData({ serverPreviewReady: false, serverPreviewFailed: true })
        this.applyProvisionalFromStats()
        this.recalculate(undefined, { silentDrop: true })
        wx.showToast({ title: '价格校验失败，请点击重试', icon: 'none' })
        return
      }
      // 过期预览：用户已改选其它券
      const liveId = this.data.selectedCoupon ? this.data.selectedCoupon._id : null
      if ((couponId || null) !== (liveId || null)) return

      this.setData({ serverPreviewFailed: false })
      const memberRate = r.memberDiscountRate != null ? r.memberDiscountRate : r.discountRate
      const discountRate = r.discountRate != null ? r.discountRate : 1
      const breakdown = r.paymentBreakdown || {}
      const totalPrice = Number(r.totalPrice)
      const vipTotal = Number(r.vipTotal)
      const originalPrice = Number(r.originalPrice)
      const shippingFee = Number(r.shippingFee) || 0
      const couponValue = Number(r.couponValue) || 0
      const vipSaved = Number.isFinite(originalPrice) && Number.isFinite(vipTotal)
        ? Math.round(Math.max(0, originalPrice - (this.data.customExtraPrice || 0) - vipTotal) * 100) / 100
        : this.data.vipSaved
      const levelName = r.levelName || this.data.levelName || '会员'
      const orderTotalYuan = Number.isFinite(totalPrice) ? formatPrice(totalPrice) : this.data.finalPrice
      const wxYuan = formatPrice((Number(breakdown.wxpayFen) != null
        ? Number(breakdown.wxpayFen)
        : Math.round((Number.isFinite(totalPrice) ? totalPrice : 0) * 100)) / 100)
      const walletYuan = formatPrice((Number(breakdown.walletPayFen) || 0) / 100)
      const useWallet = !!this.data.useWalletPay
      const depositCredit = Math.max(0, Number(r.depositCredit) || 0)

      // 服务端确认现金券抵扣为 0（会员折已顶满地板）：清掉无效选中，避免锁券无收益
      let nextCoupon = this.data.selectedCoupon
      let couponHint = this.data.couponHint || ''
      if (
        nextCoupon &&
        (nextCoupon.type || 'cash') !== 'freeShipping' &&
        !(couponValue > 0)
      ) {
        wx.showToast({ title: '会员折扣已达优惠上限，本单无法再叠加此礼券', icon: 'none' })
        nextCoupon = null
        couponHint = ''
      } else if (nextCoupon) {
        couponHint = nextCoupon.type === 'freeShipping'
          ? '免邮'
          : (couponValue > 0 ? `-¥${formatPrice(couponValue)}` : '')
      } else {
        couponHint = ''
      }

      this.setData({
        selectedCoupon: nextCoupon,
        couponHint,
        discountRate,
        levelName,
        discountText: formatDiscount(memberRate != null ? memberRate : discountRate),
        discountLabel: `${levelName}折扣`,
        provisionalTip: r.provisionalTip || '',
        finalPrice: orderTotalYuan,
        payNowYuan: useWallet ? wxYuan : orderTotalYuan,
        payNowLabel: useWallet ? '还需支付' : '应付',
        footerPayLabel: useWallet
          ? (wxYuan === '0.00' ? '钱包支付' : '还需支付')
          : (this.data.isGiftOrder ? '备妥应付' : '合计'),
        originalPrice: Number.isFinite(originalPrice) ? formatPrice(originalPrice) : this.data.originalPrice,
        vipSaved: vipSaved || 0,
        couponSaved: nextCoupon ? (couponValue || 0) : 0,
        depositCredit,
        depositCreditDisplay: depositCredit > 0 ? formatPrice(depositCredit) : '',
        savedAmount: formatPrice((vipSaved || 0) + (nextCoupon ? (couponValue || 0) : 0) + depositCredit),
        shippingFee,
        shippingFeeDisplay: formatPrice(shippingFee),
        shippingFeeLabel: shippingFee <= 0 ? '免邮' : getShippingFeeLabel(shippingFee),
        isShippingFree: shippingFee <= 0,
        shippingLineLabel: shippingLineLabelText(this.data.shippingCarrier),
        walletPayYuan: walletYuan,
        wxpayYuan: wxYuan,
        serverPreviewReady: true
      })

      // 服务端清券后按无券重算运费/应付（避免仍显示抬高后的价）
      if (couponSnapshot && !nextCoupon) {
        this.recalculate(null, { silentDrop: true })
        this.syncServerPricingPreview()
      }
    } catch (e) {
      if (seq !== this._previewSeq) return
      console.warn('syncServerPricingPreview', e)
      this.setData({ serverPreviewReady: false })
      this.applyProvisionalFromStats()
      this.recalculate(undefined, { silentDrop: true })
    }
  },

  async loadDefaultAddress() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageAddress',
        data: { action: 'list' }
      })
      const result = res.result || {}
      if (!result.success) return

      const list = result.data || []
      const record = list.find((a) => a.isDefault) || list[0]
      if (record) {
        this.setData({ address: this.formatAddress(record) })
      }
    } catch (e) {
      console.error('loadDefaultAddress', e)
      try {
        const local = wx.getStorageSync('user_addresses_local') || []
        const record = local.find((a) => a.isDefault) || local[0]
        if (record) {
          this.setData({ address: this.formatAddress(record) })
        }
      } catch (err) {
        console.warn('loadDefaultAddress local', err)
      }
    }
  },

  formatAddress(record) {
    const region = record.region || []
    return {
      _id: record._id,
      name: record.name,
      phone: record.phone,
      region,
      regionText: Array.isArray(region) ? region.filter(Boolean).join(' ') : '',
      detail: record.detail || ''
    }
  },

  /** @param prefetched 可选：已取回的券包（onLoad 与注册回流会并行预取，避免串行等待） */
  async loadCoupons(prefetched) {
    try {
      const packed = prefetched || (await fetchMyCoupons({ usableOnly: true }))
      const pricingPreview = calculateClientPricing(
        this.data.items,
        this.data.discountRate,
        null,
        this.data.customExtraPrice
      )
      const vipTotal = pricingPreview.vipTotal
      const items = this.data.items
      const rate = this.data.discountRate
      const extra = this.data.customExtraPrice
      const campaignOn = campaignActive()
      const shipFeeWithoutCoupon = campaignOn
        ? 0
        : calcShipping(pricingPreview.originalPrice, items)
      const goodsFloorHit = !!pricingPreview.goodsFloorHit

      const list = (packed.list || [])
        .filter((c) => couponChannelAllows(c, 'online'))
        .map((c) => {
          const minSpend = c.minSpend != null ? c.minSpend : parseMinSpend(c)
          const type = c.type || 'cash'
          const probe = calculateClientPricing(items, rate, c, extra)
          const belowMin = !probe.selectedCoupon
          if (type === 'freeShipping') {
            const freeShipUseless = shipFeeWithoutCoupon <= 0 || !(probe.couponSaved > 0)
            return {
              ...c,
              title: c.title || couponTitle(c),
              faceLabel: c.faceLabel || couponFaceLabel(c),
              minSpend,
              // 本单实际节省额（用于本地选优，与 _disabled 同源计算）
              _save: Number(probe.couponSaved) || 0,
              _disabled: belowMin || freeShipUseless,
              _reason: belowMin
                ? `满 ¥${minSpend} 可用，本单未达门槛`
                : (freeShipUseless ? '本单已免邮，免邮券无额外优惠' : ''),
              _noStack: false,
              _freeShipUseless: freeShipUseless
            }
          }
          const noStack = !!(probe.selectedCoupon && probe.couponNoGoodsSave) || goodsFloorHit
          return {
            ...c,
            title: c.title || couponTitle(c),
            faceLabel: c.faceLabel || couponFaceLabel(c),
            minSpend,
            _save: Number(probe.couponSaved) || 0,
            _disabled: belowMin || noStack,
            _reason: belowMin
              ? `满 ¥${minSpend} 可用，本单未达门槛`
              : (noStack ? '会员价已达最低折扣，本单该券无额外优惠' : ''),
            _noStack: noStack,
            _freeShipUseless: false
          }
        })

      this.setData({ coupons: list })

      if (this._prefCouponId) {
        const found = list.find((c) => c._id === this._prefCouponId && !c._disabled)
        if (found) this.setData({ selectedCoupon: found })
      } else if (list.length > 0 && vipTotal > 0) {
        // 优化：本单最优券改为本地判定（每个候选的 _save 由 calculateClientPricing 得出，
        // 与服务端 makeOrder 的校验同源），省去一次独立的 getBestCoupon 往返；
        // 服务端仍在定价预览与正式下单时做权威校验，不可用时由失败分支清券并重算。
        const best = list
          .filter((c) => c && !c._disabled && Number(c._save) > 0)
          .sort(
            (a, b) =>
              (Number(b._save) || 0) - (Number(a._save) || 0) ||
              (Number(b.value) || 0) - (Number(a.value) || 0)
          )[0]
        if (best) this.setData({ selectedCoupon: best })
      }

      this.recalculate(undefined, { silentDrop: true })
    } catch (e) {
      console.error('loadCoupons', e)
      this.recalculate(undefined, { silentDrop: true })
    }
  },

  async autoSelectBestCoupon(vipTotal, shippingBaseAmount) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getBestCoupon',
        data: {
          totalPrice: vipTotal,
          // 免邮券节省额按优惠前合计估算
          shippingBaseAmount: shippingBaseAmount != null ? shippingBaseAmount : vipTotal,
          // 75% 地板按目录原价（未加运费）估算
          originalPrice: shippingBaseAmount != null ? shippingBaseAmount : vipTotal
        }
      })
      if (res.result && res.result.success && res.result.bestCoupon) {
        this.setData({ selectedCoupon: res.result.bestCoupon })
      }
    } catch (e) {
      console.error('autoSelectBestCoupon', e)
    }
  },

  chooseAddress() {
    wx.navigateTo({
      url: '/subpackages/business/address/index?mode=select',
      events: {
        addressSelected: (addr) => {
          if (addr) this.setData({ address: this.formatAddress(addr) })
        }
      },
      fail: () => wx.showToast({ title: '无法打开地址', icon: 'none' })
    })
  },

  openCouponModal() {
    if (this.data.couponRowBlocked) {
      wx.showToast({
        title: this.data.couponRowText || '您已达到最大优惠额度，礼券暂不可用',
        icon: 'none'
      })
      return
    }
    this.setData({ showCouponModal: true })
  },

  closeCouponModal() {
    this.setData({ showCouponModal: false })
  },

  selectCoupon(e) {
    const idx = parseInt(e.currentTarget.dataset.index, 10)
    let coupon = null
    if (idx === -1) {
      coupon = null
    } else {
      coupon = this.data.coupons[idx] || null
      if (coupon && coupon._disabled) {
        wx.showToast({
          title: coupon._noStack
            ? '会员折扣已达优惠上限'
            : (coupon.minSpend > 0 ? `满 ¥${coupon.minSpend} 可用` : '暂不可用'),
          icon: 'none'
        })
        return
      }
    }
    // 显式传入券，避免 setData 与重算竞态把选中冲掉
    this.setData({ selectedCoupon: coupon, serverPreviewReady: false })
    this.recalculate(coupon)
    this.applyProvisionalFromStats()
    this.recalculate(this.data.selectedCoupon)
    this.syncServerPricingPreview()
    this.closeCouponModal()
  },

  async submitOrder() {
    if (this.data.submitting || this._authNavigating) return

    // 服务端价格未校验成功时不允许提交：否则用户按看到的本地估算价确认，
    // 实际会被云端按另一套价格扣款（差异来自会员折/券门槛/运费判定）
    if (this.data.serverPreviewFailed) {
      wx.showModal({
        title: '价格校验未完成',
        content: '当前价格未通过服务端校验，为避免与实付不一致，请重试校验后再提交。',
        confirmText: '重新校验',
        cancelText: '取消',
        confirmColor: '#C4A76C',
        success: (r) => {
          if (r.confirm) {
            this.setData({ serverPreviewFailed: false })
            if (typeof this.syncServerPricingPreview === 'function') this.syncServerPricingPreview()
            else if (typeof this.recalculate === 'function') this.recalculate()
          }
        }
      })
      return
    }

    const { requirePhone, CONFIRM_ORDER_PATH, hasPhone, ensureSession } = require('../../../utils/userSession')
    const session = await ensureSession(getApp())
    if (!hasPhone(session)) {
      this._authNavigating = true
      this.persistCheckoutForAuth()
      await requirePhone(getApp(), {
        content: '授权手机号即可下单；若尚未注册，将同步领取新客礼。',
        from: 'checkout',
        returnUrl: CONFIRM_ORDER_PATH,
        returnMode: 'back',
        direct: true,
        resumeSubmit: true
      })
      // 跳转离开后解锁，避免返回后无法再提交
      setTimeout(() => {
        this._authNavigating = false
      }, 1600)
      return
    }
    // 进入正式提交：授权回流提示已完成使命，收起避免干扰
    if (this.data.showAuthResumeHint) {
      this.setData({ showAuthResumeHint: false })
    }

    const address = this.data.address
    if (this.data.giftNeedsAddress && (!address || !address.name || !address.phone)) {
      wx.showToast({ title: '请选择收货地址', icon: 'none' })
      return
    }
    if (!this.data.isGiftOrder && !this.data.storePickup && (!address || !address.name || !address.phone)) {
      wx.showToast({ title: '请选择收货地址', icon: 'none' })
      return
    }
    // 门店自取已关闭时兜底：快照/回流可能带回 storePickup=true
    if (this.data.storePickupEnabled === false && this.data.storePickup) {
      this.setData({ storePickup: false })
    }
    if (!this.data.isGiftOrder && this.data.storePickup && !this.data.pickupStoreId) {
      wx.showToast({ title: '自取门店加载中，请稍后', icon: 'none' })
      this.loadPickupStore()
      return
    }

    // 每次提交前弹一次：启程前须知 → 标本特性提示 → 下单（同样式居中弹层）
    if (!this._careNoticeConfirmed) {
      const care = resolveCheckoutCareNotice(this.data.items)
      this.setData({
        showCareNotice: true,
        careNoticeTitle: care.title,
        careNoticeIntro: care.intro,
        careHasButterfly: care.hasButterfly,
        careUnboxLabel: care.unboxLabel,
        careUnboxLines: care.unboxLines,
        careAntennaLines: care.antennaLines,
        careCareLabel: care.careLabel,
        careCareLines: care.careLines
      })
      return
    }

    if (!this._specimenNoticeConfirmed) {
      const notice = resolveSpecimenNotice(this.data.items)
      // 与确认页「应付」一致：finalPrice（折后货值+运费，含钱包支付部分）
      const pledge = calcPledgeAmount(this.data.finalPrice)
      this.setData({
        showSpecimenNotice: true,
        specimenNoticeBodyLines: notice.bodyLines,
        specimenNoticeNoteSegments: notice.noteSegments,
        specimenPledgeLine: pledge.line,
        specimenPledgeHasAmount: pledge.hasAmount,
        specimenPledgeLineBefore: pledge.lineBefore,
        specimenPledgeLineAmount: pledge.lineAmount,
        specimenPledgeLineAfter: pledge.lineAfter
      })
      return
    }
    this._careNoticeConfirmed = false
    this._specimenNoticeConfirmed = false

    await this.doSubmitOrder()
  },

  closeCareNotice() {
    this.setData({ showCareNotice: false })
  },

  confirmCareNotice() {
    this.setData({ showCareNotice: false })
    this._careNoticeConfirmed = true
    this.submitOrder()
  },

  closeSpecimenNotice() {
    this.setData({ showSpecimenNotice: false })
    // 未完成下单：下次点提交重新走启程前须知
    this._careNoticeConfirmed = false
  },

  confirmSpecimenNotice() {
    this.setData({ showSpecimenNotice: false })
    this._specimenNoticeConfirmed = true
    this.submitOrder()
  },

  async doSubmitOrder() {
    if (this.data.submitting) return

    const address = this.data.address
    wx.vibrateShort({ type: 'heavy' })
    // 下单幂等键：本次提交周期内固定，重试复用同一 key；
    // 云端按 (openid, clientRequestId) 去重，避免「已下单但响应丢失 → 重按 → 重复订单」
    if (!this._orderRequestId) {
      this._orderRequestId = `ord_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    }
    this.setData({ submitting: true })

    const orderItems = this.data.items.map((item) => ({
      productId: item.productId || item.id || item._id,
      skuId: item.skuId || '',
      count: item.count || 1,
      collectionId: item.collectionId || null
    }))
    const collectionIds = this.data.items
      .map((item) => item.collectionId)
      .filter(Boolean)

    const addressPayload = (this.data.isGiftInvite || this.data.isGiftStorePickup || this.data.storePickup)
      ? (this.data.storePickup && address && (address.name || address.phone)
        ? { name: address.name || '', phone: address.phone || '' }
        : null)
      : {
          name: address.name,
          phone: address.phone,
          region: address.region,
          detail: address.detail
        }

    try {
      const res = await wx.cloud.callFunction({
        name: 'makeOrder',
        data: {
          items: orderItems,
          collectionIds,
          couponId: this.data.selectedCoupon ? this.data.selectedCoupon._id : null,
          remark: this.data.remark,
          invoice: null,
          address: addressPayload,
          customMeta: this._customMeta,
          customExtraPrice: this._customExtraPrice,
          giftMeta: this._giftMeta || null,
          source: this.data.isGiftOrder ? 'gift' : undefined,
          useWalletPay: !!this.data.useWalletPay,
          depositIntentId: this._depositIntentId || null,
          storePickup: !!this.data.storePickup && !this.data.isGiftOrder,
          fulfillmentType: (this.data.storePickup && !this.data.isGiftOrder) ? 'store_pickup' : undefined,
          storeId: this.data.storePickup ? (this.data.pickupStoreId || '') : undefined,
          storeName: this.data.storePickup ? (this.data.pickupStoreName || '') : undefined,
          clientRequestId: this._orderRequestId
        }
      })

      const result = res.result
      if (!result || !result.success) {
        wx.showModal({
          title: '下单失败',
          content: (result && result.msg) || '请稍后重试',
          showCancel: false,
          confirmColor: '#C4A76C'
        })
        this.setData({ submitting: false })
        return
      }

      wx.showLoading({ title: '支付中…', mask: true })
      try {
        // 订单已创建：作废本次幂等键，下次下单生成新键
        this._orderRequestId = ''
        const payResult = await payForOrder(result.orderId)
        wx.hideLoading()

        if (collectionIds.length > 0) {
          this.removeBoughtCollections(collectionIds)
        }

        const pending = !!(payResult && payResult.pendingConfirm)
        wx.showToast({
          title: pending ? '支付确认中' : '支付成功',
          icon: pending ? 'none' : 'success'
        })
        try {
          const { invalidateAfterOrder } = require('../utils/cacheInvalidate')
          invalidateAfterOrder()
        } catch (e) { /* ignore */ }
        setTimeout(() => {
          if (pending) {
            wx.redirectTo({
              url: `/subpackages/business/order-detail/index?id=${result.orderId}`,
              fail: () => wx.redirectTo({ url: '/subpackages/business/orders/index?type=pay' })
            })
            return
          }
          if (this.data.isGiftOrder) {
            wx.redirectTo({
              url: `/subpackages/feature/gift/success/index?orderId=${result.orderId}`,
              fail: () => wx.redirectTo({ url: '/subpackages/business/orders/index?type=paid' })
            })
          } else if (this.data.storePickup) {
            wx.redirectTo({
              url: `/subpackages/business/pickup-pass/index?id=${encodeURIComponent(result.orderId)}`,
              fail: () => wx.redirectTo({ url: '/subpackages/business/orders/index?type=paid' })
            })
          } else {
            wx.redirectTo({
              url: '/subpackages/business/orders/index?type=paid'
            })
          }
        }, 1200)
      } catch (payErr) {
        wx.hideLoading()
        const msg = payErr.message || '支付失败'
        if (payErr.cancelled || msg.indexOf('已取消支付') === 0) {
          wx.showModal({
            title: '待付款',
            content: (payErr.walletRefunded || /钱包余额已退回/.test(msg))
              ? '已取消支付，钱包余额已退回。订单仍保留在「待付款」，可继续支付。'
              : (msg.indexOf('钱包') >= 0
                ? msg
                : '订单已创建，可在「我的订单-待付款」中继续支付'),
            confirmText: '立即支付',
            confirmColor: '#C4A76C',
            success: (m) => {
              if (m.confirm) {
                wx.redirectTo({
                  url: `/subpackages/business/order-detail/index?id=${result.orderId}`
                })
              } else {
                wx.navigateBack({
                  fail: () => wx.redirectTo({
                    url: `/subpackages/business/order-detail/index?id=${result.orderId}`
                  })
                })
              }
            }
          })
        } else if (/支付未开通|暂不可用|支付服务不可用|钱包余额已退回/.test(msg)) {
          wx.showModal({
            title: '暂无法支付',
            content: msg + '\n订单已保留在「待付款」。',
            showCancel: false,
            confirmColor: '#C4A76C',
            success: () => {
              wx.redirectTo({
                url: `/subpackages/business/order-detail/index?id=${result.orderId}`
              })
            }
          })
        } else {
          wx.showToast({ title: msg, icon: 'none' })
        }
      }
    } catch (err) {
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  removeBoughtCollections(ids) {
    ids.forEach((id) => {
      wx.cloud.callFunction({ name: 'toggleCollection', data: { engage: 'cartItem', action: 'removeCart', id } }).catch(() => {})
    })
  },

  goToSupport() {
    const { buildSupportQuery } = require('../utils/supportHelper')
    const items = this.data.items || []
    const p0 = items[0] || {}
    const productId = p0.productId || p0.id || p0._id || ''
    const productName = p0.title || p0.name || ''
    const url =
      '/subpackages/feature/user/support/index' +
      buildSupportQuery({
        topic: productId ? 'product' : 'order',
        productId,
        productName,
        productCount: items.length
      })
    wx.navigateTo({
      url,
      fail: () => wx.showToast({ title: '无法打开联系专员', icon: 'none' })
    })
  }
})
