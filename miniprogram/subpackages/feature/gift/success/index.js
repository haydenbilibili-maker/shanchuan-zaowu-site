const {
  fetchContentDisplayFlags,
  toastGiftClosed
} = require('../../../../utils/contentDisplayFlags')
const { drawMemberQr } = require('../../utils/qrCanvas')
const { requestGiftSubscribe, giftSubscribeSkipHint } = require('../../utils/giftSubscribe')
const { formatDuration, createGiftPlayer, ensureInnerAudioOption } = require('../giftVoice')
const { renderGiftShareImage } = require('../giftShareCard')
const textFx = require('../giftTextEffect')

Page({
  data: {
    ready: false,
    errorMsg: '',
    orderId: '',
    token: '',
    cardBody: '',
    /** 完整礼笺文字；cardBody 只放「已打出的部分」，逐字显示不动 wxml */
    cardBodyFull: '',
    sfxMuted: false, // onLoad 里按共享静音键刷新
    typing: false,
    cardSignature: '',
    hasVoice: false,
    voiceDurationLabel: '',
    /* 自己录的祝福语**必须能在这里回放**（2026-09-21 产品负责人：
       「音频是无法播放的，这样意味着只要音频发出去之后，录制者是没有地方和环节可以再次听到自己录制的祝福语」）。
       云函数 getGiverShare 一直在返回 voiceTempUrl（enrichVoiceAccess），是**页面没有播放入口**。 */
    voiceUrl: '',
    voicePlaying: false,
    voiceLoading: false,
    voiceError: '',
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

  /** 逐字显示礼笺；点任意处可立即显示全文并停音（产品负责人确认的手感） */
  _startType(full) {
    this._stopType()
    const text = String(full || '')
    if (!text) return
    this._typeFull = text
    this._typeIndex = 0
    this.setData({ typing: true, cardBody: '' })
    this._tickType()
  },

  _stopType() {
    if (this._typeTimer) {
      clearTimeout(this._typeTimer)
      this._typeTimer = null
    }
    this._typeFull = ''
    this._typeIndex = 0
    // 收笔（或跳过/离开）就把敲击床停掉：床是"书写期间连续响"的，不停会一直响下去
    textFx.stopTickSound()
    if (this.data.typing) this.setData({ typing: false })
  },

  _tickType() {
    const full = this._typeFull || ''
    let i = this._typeIndex || 0
    if (i >= full.length) {
      this._stopType()
      return
    }
    const ch = full.charAt(i)
    let step = 1
    // 偶发连写两字，更像运笔而非机械机打（判断收敛在共享件里，三页同一手感）
    if (textFx.shouldDoubleWrite(ch, full.charAt(i + 1)) && i + 1 < full.length) step = 2
    i += step
    this._typeIndex = i
    this.setData({ cardBody: full.slice(0, i) })
    textFx.playTick(this.data.sfxMuted)
    this._typeTimer = setTimeout(() => this._tickType(), textFx.delayForChar(ch))
  },

  /** 点礼笺任意处：立即显示全文并停音 */
  finishTyping() {
    if (!this.data.typing) return
    this.setData({ cardBody: this._typeFull || '' })
    this._stopType()
  },

  toggleSfxMute() {
    const next = !this.data.sfxMuted
    textFx.setMuted(next)
    this.setData({ sfxMuted: next })
    // 试听必须"放一小段就停"：敲击床是循环的，直接 playTick 会在没写字时一直响
    if (!next) textFx.previewTickSound(900)
    else textFx.stopTickSound()
  },

  /** 「听一听我录的话」——复用与收礼页同一个播放器（同一条语音、同一套错误口径） */
  _ensureVoicePlayer() {
    if (this._voicePlayer) return this._voicePlayer
    this._voicePlayer = createGiftPlayer({
      onPlay: () => this.setData({ voicePlaying: true, voiceLoading: false }),
      onPause: () => this.setData({ voicePlaying: false, voiceLoading: false }),
      onStop: () => this.setData({ voicePlaying: false, voiceLoading: false }),
      onEnded: () => this.setData({ voicePlaying: false, voiceLoading: false }),
      onError: () => this.setData({ voicePlaying: false, voiceLoading: false, voiceError: '这条语音暂时放不出来' })
    })
    return this._voicePlayer
  },

  /** 点一下播放、再点一下停下（自己的语音，不需要"听完"这种仪式） */
  toggleVoice() {
    const url = String(this.data.voiceUrl || '').trim()
    if (!url) {
      this.setData({ voiceError: '这条语音还在路上，稍后再试' })
      return
    }
    const player = this._ensureVoicePlayer()
    if (this.data.voicePlaying) {
      player.pause()
      return
    }
    this.setData({ voiceError: '', voiceLoading: true })
    ensureInnerAudioOption()
    player.play(url)
  },

  onHide() {
    // 离开页面必须停：否则语音会在订单页/后台继续响（收礼页同一口径）
    if (this._voicePlayer) this._voicePlayer.pause()
    this._stopType()
  },

  onUnload() {
    this._stopType()
    if (this._voicePlayer) this._voicePlayer.destroy()
    this._voicePlayer = null
    textFx.destroySfx()
  },

  onLoad(options) {
    this.setData({ sfxMuted: textFx.isMuted() })
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
        /* ⚠️ 2026-09-21 产品负责人：「当对方已经留下地址之后这个页面的状态并没有随着更改，
         *    文案仍然是等待启封留下去处的文案」。
         *    根因：这一段**只按 deliveryType 分支**，从不看 `addressStatus` / `status` ——
         *    于是无论对方留没留址、发没发货，送礼人看到的都是同一句"正等 TA 启封并留下去处"。
         *    口径（与订单详情页的礼赠档案一致）：
         *      已送达 > 已寄出 > 已留址 > 已启封 > 待启封。
         *    `expireHint`（填址倒计时）只在**还没留址**时才有意义，留址后必须撤掉。 */
        const addrSubmitted = gift.addressStatus === 'submitted'
        const received = gift.status === 'received'
        const shipped = gift.status === 'shipped'
        const accepted = gift.acceptStatus === 'accepted' || gift.acceptStatus === 'opened'
        if (received) {
          heroOverline = 'GIFT ARRIVED'
          heroTitle = '这份山海已送达'
          heroDesc = 'TA 已经收到。这封信与那段语音都留在这里，随时可以回看。'
          shareCta = '把这段也留着'
        } else if (shipped) {
          heroOverline = 'ON THE WAY'
          heroTitle = '礼物已启程'
          heroDesc = '已按 TA 留下的去处寄出。可在「礼赠进度」里看物流。'
          shareCta = '把礼笺也告诉 TA'
        } else if (addrSubmitted) {
          heroOverline = 'ADDRESS RECEIVED'
          heroTitle = 'TA 已留下去处'
          heroDesc = '收件信息已经收到，专员正在备妥启程。每一步都可以在「礼赠进度」里回看。'
          shareCta = '把礼笺也告诉 TA'
        } else if (accepted) {
          heroTitle = 'TA 已启封，正等留下去处'
          heroDesc = '对方已经打开这封信了。等 TA 写下收件信息，专员就能启程。'
          shareCta = '再轻轻提醒一声'
        } else {
          heroTitle = '礼已备好，等你送出'
          heroDesc = '正等 TA 启封并留下去处。把礼笺交出去——对方写下收件信息后，专员再启程。'
          shareCta = '把这份心意交给 TA'
        }
        // 填址倒计时只在**还没留址**时给出；已经留址还挂着"须于 X 日前"就是假紧迫
        if (!addrSubmitted && !shipped && !received) {
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
        cardBodyFull: cardBody,
        cardBody: '',
        cardSignature,
        hasVoice,
        voiceDurationLabel: hasVoice ? formatDuration(voiceDuration) : '',
        // 送礼人自己那条语音的可播地址（云函数早已返回，之前页面没用）
        voiceUrl: hasVoice ? String(gift.voiceTempUrl || '') : '',
        voiceError: '',
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

      // 礼笺逐字显示（产品负责人：文字跳出时给打字机音效）。
      // 在 setData 之后启动，避免「先整段闪一下再从头打」。
      this._startType(cardBody)

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
