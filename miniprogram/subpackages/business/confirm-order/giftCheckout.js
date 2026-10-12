/**
 * 确认订单 · 礼赠模式（蓝图 礼赠凭礼笺领取 §15，2026-10-12 第六轮）
 * 送礼页只剩 01 选礼 / 02 写笺；「03 交付与支付」在这里：交付方式四选一 + 地址 / 门店 / 领取核验的录入与校验只在本页。
 * 方法以 mixin 并入确认页 Page（普通订单不调用任何一个）；makeOrder 入参与改前同形。
 */
const { toastStorePickupClosed } = require('../../../utils/contentDisplayFlags')

const GIFT_DELIVERY_OPTIONS = [
  { id: 'invite_address', name: '邀请 TA 填地址', short: 'TA 留下地址再寄', tag: '推荐' },
  { id: 'ship_to_receiver', name: '快递给 TA', short: '按 TA 的地址寄出', tag: '' },
  { id: 'ship_to_self', name: '寄给我', short: '先寄我，当面转交', tag: '' },
  { id: 'store_pickup', name: '门店自提', short: '凭自提码到店领', tag: '' }
]

/** 可不填号、凭礼笺领取的交付方式（与云函数 giftReceiverPhone.CLAIM_LINK_DELIVERY 同值，check:gift-claim-link 钉住） */
const CLAIM_LINK_DELIVERY = ['invite_address', 'store_pickup', 'ship_to_self']

/** 要收货地址的交付方式（犒劳自己 = 寄给我） */
const SHIP_DELIVERY = ['ship_to_receiver', 'ship_to_self']

const GIFT_DELIVERY_HINTS = {
  invite_address: '支付后把礼笺交给 TA——对方启封并写下收件去处后，专员再启程。',
  ship_to_receiver: '按 TA 的收货地址妥投；TA 领取礼笺时核对这个收货手机号，不用另填。',
  ship_to_self: '藏品先寄到你的地址，再当面转交；TA 点礼笺「收下」后礼记在 TA 名下。',
  store_pickup: '门店备妥后生成自提码，可转交 TA，到店出示由专员核销。'
}
const GIFT_SELF_TREAT_HINT = '和普通下单一样，藏品直接寄到你的地址。'

const PHONE_RE = /^1\d{10}$/

function digits(v) {
  return String(v || '').replace(/\D/g, '')
}

function giftDeliveryOptions(pickupEnabled) {
  return pickupEnabled === false
    ? GIFT_DELIVERY_OPTIONS.filter((o) => o.id !== 'store_pickup')
    : GIFT_DELIVERY_OPTIONS
}

/** 交付方式 → 页面上的派生开关（地址卡 / 运费预览 / 核验块都读它们） */
function giftDeliveryFlags(type, selfTreat) {
  return {
    giftDeliveryType: type,
    isGiftInvite: type === 'invite_address',
    isGiftStorePickup: type === 'store_pickup',
    giftNeedsAddress: SHIP_DELIVERY.indexOf(type) !== -1,
    giftDeliveryHint: selfTreat ? GIFT_SELF_TREAT_HINT : (GIFT_DELIVERY_HINTS[type] || '')
  }
}

function giftAddressKey(type, selfTreat) {
  if (selfTreat) return 'ship_to_self'
  return SHIP_DELIVERY.indexOf(type) !== -1 ? type : ''
}

/** 栈里上一页是送礼页（礼赠编排）才可点回 01 / 02 */
function prevComposePage() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  const prev = pages[pages.length - 2]
  return prev && /gift\/compose\/index$/.test(prev.route || '') ? prev : null
}

const giftCheckoutMethods = {
  /** initPayload 调用：按 giftMeta + giftDraft（送礼页带来 / 登录回流快照）还原礼赠模式，返回 setData 补丁 */
  _initGiftCheckout(payload) {
    const draft = (payload && payload.giftDraft) || {}
    const meta = this._giftMeta || {}
    const selfTreat = !!draft.selfTreat
    const pickupEnabled = this.data.storePickupEnabled !== false
    let type = selfTreat ? 'ship_to_self' : (draft.deliveryType || meta.deliveryType || 'invite_address')
    if (!GIFT_DELIVERY_OPTIONS.some((o) => o.id === type)) type = 'invite_address'
    if (type === 'store_pickup' && !pickupEnabled) type = 'invite_address'
    const fmt = (a) => (a && a.name && a.phone ? this.formatAddress(a) : null)
    this._giftAddrs = {
      ship_to_receiver: fmt(draft.receiverAddress),
      ship_to_self: fmt(draft.selfAddress)
    }
    const first = (payload.items && payload.items[0]) || {}
    this._giftProductId = draft.productId || first.productId || first.id || first._id || ''
    const key = giftAddressKey(type, selfTreat)
    if (type === 'store_pickup') this.loadGiftStores()
    return {
      giftSelfTreat: selfTreat,
      giftDeliveryOptions: giftDeliveryOptions(pickupEnabled),
      giftStoreId: draft.storeId || meta.storeId || '',
      giftStoreName: draft.storeName || meta.storeName || '',
      giftReceiverPhone: digits(draft.receiverPhone).slice(0, 11),
      giftClaimLink: !!draft.claimLink,
      giftClaimPasscode: !!draft.claimPasscode,
      giftRecipientName: String(meta.recipientName || '').trim(),
      giftHidePrice: meta.hidePrice !== false,
      giftCanEditSteps: !!prevComposePage(),
      giftPhoneError: '',
      giftAddressError: '',
      giftStoreError: '',
      ...giftDeliveryFlags(type, selfTreat),
      address: key ? this._giftAddrs[key] : null
    }
  },

  /** 地址簿默认地址 = 「我的收货地址」（寄给我 / 犒劳自己）；快递给 TA 不套用（那是送礼人自己的） */
  _onGiftDefaultAddress(record) {
    if (!this._giftAddrs || this._giftAddrs.ship_to_self) return
    this._giftAddrs.ship_to_self = this.formatAddress(record)
    if (giftAddressKey(this.data.giftDeliveryType, this.data.giftSelfTreat) === 'ship_to_self') {
      this.setData({ address: this._giftAddrs.ship_to_self })
    }
  },

  /** 地址页选回来的地址只写当前交付方式那一份 */
  _onGiftAddressPicked(addr) {
    const key = giftAddressKey(this.data.giftDeliveryType, this.data.giftSelfTreat)
    if (!key || !this._giftAddrs) return
    this._giftAddrs[key] = this.formatAddress(addr)
    this.setData({ giftAddressError: '' })
  },

  /** 门店自取开关晚于 initPayload 回来：关了就去掉自提，已选自提回落邀请填址 */
  _syncGiftPickupFlag() {
    const enabled = this.data.storePickupEnabled !== false
    this.setData({ giftDeliveryOptions: giftDeliveryOptions(enabled) })
    if (!enabled && this.data.giftDeliveryType === 'store_pickup') this._setGiftDelivery('invite_address')
  },

  _setGiftDelivery(type) {
    const selfTreat = !!this.data.giftSelfTreat
    const key = giftAddressKey(type, selfTreat)
    const wasPickup = !!this.data.isGiftStorePickup
    this.setData({
      ...giftDeliveryFlags(type, selfTreat),
      address: key ? (this._giftAddrs && this._giftAddrs[key]) || null : null,
      giftPhoneError: '',
      giftAddressError: '',
      giftStoreError: ''
    })
    if (type === 'store_pickup') this.loadGiftStores()
    if (wasPickup !== (type === 'store_pickup')) {
      this.setData({ serverPreviewReady: false })
      this.recalculate(undefined, { silentDrop: true })
      this.syncServerPricingPreview()
    }
  },

  onGiftSelectDelivery(e) {
    const type = e.currentTarget.dataset.type
    if (!type || this.data.giftSelfTreat || type === this.data.giftDeliveryType) return
    if (type === 'store_pickup' && this.data.storePickupEnabled === false) {
      toastStorePickupClosed()
      return
    }
    this._setGiftDelivery(type)
  },

  async loadGiftStores() {
    if (this._giftStoresLoading || (this.data.giftStores && this.data.giftStores.length)) return
    this._giftStoresLoading = true
    try {
      const res = await wx.cloud.callFunction({ name: 'getStoreConfig' })
      const stores = ((res && res.result && res.result.stores) || [])
        .filter((s) => s && s.status !== 'inactive')
        .map((s) => ({ storeId: s.storeId || s._id || '', name: s.name || '门店' }))
        .filter((s) => s.storeId)
      const keep = stores.find((s) => s.storeId === this.data.giftStoreId)
      const pick = keep || stores[0]
      this.setData({
        giftStores: stores,
        giftStoreId: pick ? pick.storeId : '',
        giftStoreName: pick ? pick.name : ''
      })
    } catch (e) {
      console.warn('loadGiftStores', e)
    } finally {
      this._giftStoresLoading = false
    }
  },

  onGiftSelectStore(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    this.setData({ giftStoreId: id, giftStoreName: e.currentTarget.dataset.name || '', giftStoreError: '' })
  },

  onGiftPhoneInput(e) {
    this.setData({ giftReceiverPhone: digits(e.detail && e.detail.value).slice(0, 11), giftPhoneError: '' })
  },

  /** 领取核验单选卡：手机号核验 / 凭礼笺领取 */
  onGiftPickVerify(e) {
    const wantLink = e.currentTarget.dataset.mode === 'link'
    if (wantLink === !!this.data.giftClaimLink) return
    this.setData({ giftClaimLink: wantLink, giftPhoneError: '' })
  },

  toggleGiftClaimPasscode() {
    this.setData({ giftClaimPasscode: !this.data.giftClaimPasscode })
  },

  toggleGiftVerifyWhy() {
    this.setData({ giftVerifyWhyOpen: !this.data.giftVerifyWhyOpen })
  },

  /** 就地描红并滚到交付卡（不弹 toast / modal，不跳页） */
  _flagGiftField(field, msg) {
    this.setData({ [field]: msg })
    if (typeof wx.pageScrollTo === 'function') {
      wx.pageScrollTo({ selector: '#giftDeliveryCard', duration: 200 })
    }
  },

  /**
   * 下单前按交付方式校验并算出核验参数：不通过就地描红、返回 null。
   *   邀请填址：手机号核验（11 位）或凭礼笺领取（可加口令）；快递给 TA / 犒劳自己：号码 = 收货地址手机号；
   *   寄给我（送给别人）：自动凭礼笺领取；门店自提：选门店，不核验（gift_delivery_v2）
   */
  _giftSubmitCheck() {
    const type = this.data.giftDeliveryType
    const selfTreat = !!this.data.giftSelfTreat
    if (type === 'store_pickup') {
      if (this.data.storePickupEnabled === false) {
        toastStorePickupClosed()
        return null
      }
      if (!this.data.giftStoreId) {
        this._flagGiftField('giftStoreError', '请选择自提门店')
        return null
      }
      return { receiverPhone: '', claimLink: null }
    }
    if (SHIP_DELIVERY.indexOf(type) !== -1) {
      const address = this.data.address
      const forReceiver = type === 'ship_to_receiver' && !selfTreat
      if (!address || !address.name || !address.phone) {
        this._flagGiftField('giftAddressError', forReceiver ? '请选择或新增 TA 的收货地址' : '请选择或新增你的收货地址')
        return null
      }
      if (forReceiver || selfTreat) {
        const phone = digits(address.phone)
        if (!PHONE_RE.test(phone)) {
          this._flagGiftField('giftAddressError', '收货手机号需为 11 位手机号（领取礼笺时核对它），点地址修改')
          return null
        }
        return { receiverPhone: phone, claimLink: null }
      }
      return { receiverPhone: '', claimLink: { passcode: false } }
    }
    if (this.data.giftClaimLink && CLAIM_LINK_DELIVERY.indexOf(type) !== -1) {
      return { receiverPhone: '', claimLink: { passcode: !!this.data.giftClaimPasscode } }
    }
    const phone = digits(this.data.giftReceiverPhone)
    if (!PHONE_RE.test(phone)) {
      this._flagGiftField('giftPhoneError', phone ? '受礼人手机号需为 11 位' : '请填写受礼人手机号，或选「凭礼笺领取」')
      return null
    }
    return { receiverPhone: phone, claimLink: null }
  },

  /** 交 makeOrder 的 giftMeta：送礼页带来的字段原样，交付方式 / 门店取本页当前选择 */
  _giftMetaForSubmit() {
    const type = this.data.giftDeliveryType
    return {
      ...(this._giftMeta || {}),
      deliveryType: type,
      storeId: type === 'store_pickup' ? this.data.giftStoreId : '',
      storeName: type === 'store_pickup' ? this.data.giftStoreName : ''
    }
  },

  /** 本页已填的交付草稿：返回送礼页时交回、登录回流时进快照，再进入原样带回 */
  giftDeliveryDraft() {
    const addrs = this._giftAddrs || {}
    return {
      productId: this._giftProductId || '',
      selfTreat: !!this.data.giftSelfTreat,
      deliveryType: this.data.giftDeliveryType,
      storeId: this.data.giftStoreId || '',
      storeName: this.data.giftStoreName || '',
      receiverPhone: this.data.giftReceiverPhone || '',
      claimLink: !!this.data.giftClaimLink,
      claimPasscode: !!this.data.giftClaimPasscode,
      receiverAddress: addrs.ship_to_receiver || null,
      selfAddress: addrs.ship_to_self || null
    }
  },

  _handGiftDraftBack() {
    const prev = prevComposePage()
    if (prev && typeof prev.saveGiftDeliveryDraft === 'function') prev.saveGiftDeliveryDraft(this.giftDeliveryDraft())
  },

  /** 步骤轨 01 / 02、「改礼笺」：回送礼页对应步（草稿在 onUnload 交回） */
  onGiftRailTap(e) {
    const step = Number(e.currentTarget.dataset.step) || 0
    const prev = prevComposePage()
    if (!step || step > 2 || !prev) return
    if (typeof prev._goStep === 'function') prev._goStep(step, 'confirm_rail')
    wx.navigateBack()
  }
}

module.exports = {
  GIFT_DELIVERY_OPTIONS,
  CLAIM_LINK_DELIVERY,
  SHIP_DELIVERY,
  giftDeliveryFlags,
  giftCheckoutMethods
}
