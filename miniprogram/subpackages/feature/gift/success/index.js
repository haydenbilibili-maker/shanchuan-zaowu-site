const {
  fetchContentDisplayFlags,
  toastGiftClosed
} = require('../../../../utils/contentDisplayFlags')
const { drawMemberQr } = require('../../utils/qrCanvas')
const { requestGiftSubscribe, giftSubscribeSkipHint } = require('../../utils/giftSubscribe')
const { formatDuration } = require('../giftVoice')
const { renderGiftShareImage } = require('../giftShareCard')

Page({
  data: {
    ready: false,
    errorMsg: '',
    orderId: '',
    token: '',
    cardBody: '',
    cardSignature: '',
    hasVoice: false,
    voiceDurationLabel: '',
    expireHint: '',
    heroOverline: 'GIFT SEALED',
    heroTitle: '礼已备好',
    heroDesc: '',
    shareCta: '把这份心意交给 TA',
    canShare: true,
    canNudge: false,
    shareTitle: '请拆开这封山海礼笺',
    sharePath: '',
    shareImageUrl: '',
    showPickupClaim: false,
    claimCode: '',
    claimStatus: '',
    claimQrPayload: '',
    storeName: '',
    claimHint: '',
    subscribeHint: ''
  },

  onLoad(options) {
    // 朋友圈入口会打开本页；若带 giftOrderId（+token）则导到领取页，避免 TA 看到送礼人封缄页
    const timelineOrderId = String((options && options.giftOrderId) || '').trim()
    const timelineToken = String((options && options.token) || '').trim()
    if (timelineOrderId) {
      const q = [`orderId=${encodeURIComponent(timelineOrderId)}`]
      if (timelineToken) q.push(`token=${encodeURIComponent(timelineToken)}`)
      wx.redirectTo({
        url: `/subpackages/feature/gift/receive/index?${q.join('&')}`,
        fail: () => {
          this._orderId = timelineOrderId
          this.bootstrap()
        }
      })
      return
    }
    this._orderId = String((options && options.orderId) || '').trim()
    this.bootstrap()
  },

  async bootstrap() {
    try {
      const { flags } = await fetchContentDisplayFlags()
      if (!flags.showGift) {
        toastGiftClosed()
        setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) }), 400)
        return
      }
      if (!this._orderId) {
        this.setData({ errorMsg: '未找到这份礼赠，请从订单再进入' })
        return
      }
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: { action: 'getGiverShare', orderId: this._orderId }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        this.setData({ errorMsg: result.msg || '礼笺暂未就绪，请稍后再看' })
        return
      }
      const gift = result.gift || {}
      const deliveryType = gift.deliveryType || 'invite_address'
      const awaiting = !!gift.awaitingAddress && deliveryType === 'invite_address'
      let heroOverline = 'GIFT SEALED'
      let heroTitle = '礼已备好'
      let heroDesc = '这份山海已封缄。'
      let shareCta = '把这份心意交给 TA'
      let expireHint = ''
      let canShare = true
      if (deliveryType === 'invite_address') {
        heroTitle = '礼已备好，等你送出'
        heroDesc = '正等 TA 启封并留下去处。把礼笺交出去——对方写下收件信息后，专员再启程。'
        shareCta = '把这份心意交给 TA'
        if (gift.expireAt) {
          try {
            const d = new Date(gift.expireAt)
            expireHint = `须于 ${d.getMonth() + 1}月${d.getDate()}日前请 TA 留下地址`
          } catch (e) {
            expireHint = `填址有效期 ${gift.addressTimeoutDays || 7} 日`
          }
        } else {
          expireHint = `填址有效期 ${gift.addressTimeoutDays || 7} 日`
        }
      } else if (deliveryType === 'ship_to_receiver') {
        heroDesc = '将按你填写的地址妥投给 TA。仍可分享礼笺，让对方先读到你的话。'
        shareCta = '把礼笺也告诉 TA'
      } else if (deliveryType === 'ship_to_self') {
        heroDesc = '藏品将先寄到你处。收到后，再当面转交这份山海。'
        shareCta = '可选：先把礼笺给 TA'
      } else if (deliveryType === 'store_pickup') {
        heroOverline = 'STORE HOLD'
        heroTitle = '门店正在备妥'
        heroDesc = '到店出示下方妥投码，由专员核销后交予 TA。'
        shareCta = '把领取邀请交给 TA'
      }

      const showPickupClaim = deliveryType === 'store_pickup' && !!gift.claimCode
      const claimed = gift.claimStatus === 'claimed'
      const hasVoice = !!gift.hasVoice
      const voiceDuration = Math.max(0, parseInt(gift.voiceDuration, 10) || 0)
      const cardBody = gift.cardBody || ''
      const cardSignature = gift.cardSignature || ''
      const product0 = (gift.products && gift.products[0]) || null
      const specimenFileID = (product0 && (product0.image || (product0.images && product0.images[0]))) || ''
      this.setData({
        ready: true,
        orderId: this._orderId,
        token: gift.shareToken || '',
        cardBody,
        cardSignature,
        hasVoice,
        voiceDurationLabel: hasVoice ? formatDuration(voiceDuration) : '',
        expireHint,
        heroOverline,
        heroTitle,
        heroDesc,
        shareCta,
        canShare,
        canNudge: awaiting && !gift.expired,
        shareTitle: result.shareTitle || '请拆开这封山海礼笺',
        sharePath: result.sharePath || `/subpackages/feature/gift/receive/index?orderId=${this._orderId}&token=${gift.shareToken || ''}`,
        showPickupClaim,
        claimCode: gift.claimCode || '',
        claimStatus: gift.claimStatus || '',
        claimQrPayload: gift.claimQrPayload || (gift.claimCode ? `GIFT:${gift.claimCode}` : ''),
        storeName: gift.storeName || '',
        claimHint: claimed
          ? '已到店领取'
          : (gift.storeName ? `请到「${gift.storeName}」出示此码，妥投一件珍物` : '到店出示此码，由专员扫码妥投')
      }, () => {
        if (showPickupClaim && !claimed && this.data.claimQrPayload) {
          drawMemberQr('#giftClaimQr', this.data.claimQrPayload, this, 160).catch(() => {})
        }
        this._prepareShareImage({
          cardBody,
          cardSignature,
          hasVoice,
          specimenFileID
        })
      })

      requestGiftSubscribe(deliveryType === 'invite_address' ? 'nudge' : 'fulfill')
        .then((sub) => {
          const hint = (sub && sub.skipped)
            ? giftSubscribeSkipHint(deliveryType === 'invite_address' ? 'nudge' : 'fulfill')
            : ''
          if (hint) this.setData({ subscribeHint: hint })
        })
        .catch(() => {})
    } catch (e) {
      this.setData({ errorMsg: '柜门片刻未应，请稍后再试' })
    }
  },

  async _prepareShareImage(opts) {
    try {
      const path = await renderGiftShareImage('#giftShareCanvas', this, opts)
      if (path) this.setData({ shareImageUrl: path })
    } catch (e) {
      console.warn('gift share image', e)
    }
  },

  onShareAppMessage() {
    const payload = {
      title: this.data.shareTitle,
      path: this.data.sharePath || `/subpackages/feature/gift/receive/index?orderId=${this._orderId}`
    }
    if (this.data.shareImageUrl) payload.imageUrl = this.data.shareImageUrl
    return payload
  },

  onShareTimeline() {
    // 朋友圈：打开本页 + query；onLoad 将 giftOrderId 导到领取页
    const token = String(this.data.token || '').trim()
    const parts = []
    if (this._orderId) parts.push(`giftOrderId=${encodeURIComponent(this._orderId)}`)
    if (token) parts.push(`token=${encodeURIComponent(token)}`)
    const payload = {
      title: this.data.shareTitle || '请拆开这封山海礼笺',
      query: parts.join('&')
    }
    if (this.data.shareImageUrl) payload.imageUrl = this.data.shareImageUrl
    return payload
  },

  goOrder() {
    wx.navigateTo({
      url: `/subpackages/business/order-detail/index?id=${this._orderId}`,
      fail: () => wx.switchTab({ url: '/pages/user/index' })
    })
  },

  async nudge() {
    if (!this._orderId) return
    wx.showLoading({ title: '轻声提醒中…' })
    try {
      await requestGiftSubscribe('nudge')
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: { action: 'nudge', orderId: this._orderId }
      })
      wx.hideLoading()
      const result = (res && res.result) || {}
      wx.showToast({
        title: result.msg || (result.success ? '已轻轻提醒' : '此刻未能提醒'),
        icon: 'none'
      })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '网络未通，请稍后再试', icon: 'none' })
    }
  }
})
