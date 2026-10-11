const {
  fetchContentDisplayFlags,
  toastGiftClosed
} = require('../../../../utils/contentDisplayFlags')
const {
  formatDuration,
  createGiftPlayer,
  ensureInnerAudioOption
} = require('../giftVoice')
const db = wx.cloud.database()

/**
 * 分包内开盒音效（纸封轻撕 + 木盖轻启，已压成短轨）。
 * 素材与许可见 docs/gift-open.LICENSE.txt（Mixkit Sound Effects Free License）。
 * 须在用户手势同步路径内 play；勿拆成 setTimeout 二次播（微信会静默拦截）。
 */
const SFX_OPEN = '/subpackages/feature/gift/assets/gift-open.mp3'
/** 礼笺打字机音效（与编排页/礼成页共用同一静音键与音源） */
const textFx = require('../giftTextEffect')
const { buildGuideUrl, resolveCareCategory } = require('../../utils/careDefaults')
const trackBehavior = require('../../../../utils/trackBehavior')
/** 注册引导卡「先不注册」：按单记住，不再打扰 */
const REG_CARD_OFF_KEY = 'gift_reg_card_off_'
/** 开盒音量：适中，配合静默键 obeyMuteSwitch */
const SFX_VOLUME = 0.58
const MUTE_STORAGE_KEY = 'gift_receive_sfx_muted'

/** 开盒三段时序（ms） */
const PHASE_SEAL_MS = 320
const PHASE_LID_MS = 720
const PHASE_DONE_MS = 420

/** 礼笺打字机：与 compose 落笔同上限，避免长文拖垮 setData */
const LETTER_TYPE_MAX = 200
const DEFAULT_LETTER_BODY =
  '柜中挑了一件安静的藏品，希望它落在你桌上时，也像一句不急着说完的谢谢。'

Page({
  data: {
    ready: false,
    revealed: false,
    expired: false,
    invalid: false,
    errorMsg: '',
    cardBody: '',
    cardSignature: '',
    recipientName: '',
    /** 展笺打字机：纸面已显字（可短于全文上限） */
    letterBodyShown: '',
    letterWriting: false,
    letterSigReady: false,
    letterToShown: false,
    showLetterCursor: false,
    product: null,
    accepted: false,
    addressDone: false,
    addressMaskedLine: '',
    phoneMasked: '',
    token: '',
    orderId: '',
    hasVoice: false,
    voiceDurationLabel: '',
    voicePlaying: false,
    voiceLoading: false,
    /** idle | seal | lid | done */
    ritePhase: 'idle',
    sfxMuted: false,
    deliveryType: 'invite_address',
    isInvite: true,
    isPickup: false,
    claimCode: '',
    claimClaimed: false,
    holderCard: false,
    holderReady: false,
    verifyNeeded: false,
    verifyBusy: false,
    verifyError: '',
    verifySheet: false,
    /** 凭礼笺领取（2026-10-11）：打开不算领取，须主动收下；可选口令；不要求注册 */
    claimLink: false,
    passcodeNeeded: false,
    passcodeInput: '',
    claimNameInput: '',
    claimBusy: false,
    claimError: '',
    regCardShow: false,
    storeName: '',
    pickupHint: '',
    hidePrice: true,
    specimenHint: '',
    priceLabel: '',
    needFriendShare: false,
    /** 当前访客角色：sender=送礼人（等待/回执态）；receiver=收件人开盒 */
    isSender: false,
    viewerRole: 'receiver',
    senderPhase: '',
    senderOverline: '',
    senderTitle: '',
    senderDesc: '',
    senderCanShare: false,
    senderCanNudge: false,
    shareTitle: '请拆开这封山海礼笺',
    sharePath: ''
  },

  onLoad(options) {
    this._token = String((options && options.token) || '').trim()
    this._orderId = String((options && options.orderId) || '').trim()
    this._riteTimers = []
    ensureInnerAudioOption()
    this._giftPlayer = createGiftPlayer({
      onPlay: () => this.setData({ voicePlaying: true, voiceLoading: false }),
      onPause: () => this.setData({ voicePlaying: false }),
      onStop: () => this.setData({ voicePlaying: false }),
      onEnded: () => this.setData({ voicePlaying: false }),
      onError: () => {
        this.setData({ voicePlaying: false, voiceLoading: false })
        wx.showToast({ title: '未能播出，请稍后再试', icon: 'none' })
      }
    })
    let muted = false
    try {
      muted = !!wx.getStorageSync(MUTE_STORAGE_KEY)
    } catch (e) {
      muted = false
    }
    this.setData({ sfxMuted: muted })
    // 预加载开盒音效，降低首次开盒 play 延迟（仍受静音开关约束）
    this._ensureSfx()
    this.bootstrap()
  },

  onUnload() {
    this._clearRiteTimers()
    this._clearLetterWriteTimer()
    this._destroySfx()
    if (this._giftPlayer) {
      this._giftPlayer.destroy()
      this._giftPlayer = null
    }
  },

  _clearLetterWriteTimer() {
    if (this._letterWriteTimer) {
      clearTimeout(this._letterWriteTimer)
      this._letterWriteTimer = null
    }
    // 收笔（或直接看全文/离开）就把敲击床停掉：床是"书写期间连续响"的，不停会一直响下去
    textFx.stopTickSound()
  },

  _letterBodyFull() {
    const raw = String(this.data.cardBody || '').trim()
    return (raw || DEFAULT_LETTER_BODY).slice(0, LETTER_TYPE_MAX)
  },

  /**
   * 可读节奏落笔（对齐 compose，略慢便于受赠人阅读）
   */
  _delayForLetterChar(ch) {
    let delay = 58 + Math.floor(Math.random() * 52)
    if (/[，、；]/.test(ch)) delay += 120 + Math.floor(Math.random() * 90)
    else if (/[。！？]/.test(ch)) delay += 220 + Math.floor(Math.random() * 140)
    else if (/[—…·]/.test(ch)) delay += 100 + Math.floor(Math.random() * 70)
    if (Math.random() < 0.06) delay += 180 + Math.floor(Math.random() * 200)
    return delay
  },

  /** 二次进入 / 「直接查看」：全文 + 署名，无打字 */
  _showLetterInstant() {
    this._clearLetterWriteTimer()
    this._letterWriteTarget = null
    this._letterWriteIndex = 0
    this.setData({
      letterBodyShown: this._letterBodyFull(),
      letterWriting: false,
      letterSigReady: true,
      letterToShown: true,
      showLetterCursor: false
    })
  },

  /** 开盒进入内容态：正文落笔；写给先显；署名收笔后再显 */
  _startLetterWrite() {
    this._clearLetterWriteTimer()
    const full = this._letterBodyFull()
    this._letterWriteTarget = full
    this._letterWriteIndex = 0
    this.setData({
      letterBodyShown: '',
      letterWriting: true,
      letterSigReady: false,
      letterToShown: true,
      showLetterCursor: true
    })
    // 纸面落下后再起笔
    this._letterWriteTimer = setTimeout(() => {
      this._letterWriteTimer = null
      this._tickLetterWrite()
    }, 380)
  },

  _finishLetterWrite() {
    this._clearLetterWriteTimer()
    const target =
      this._letterWriteTarget != null
        ? this._letterWriteTarget
        : this._letterBodyFull()
    this._letterWriteTarget = null
    this._letterWriteIndex = 0
    this.setData({
      letterBodyShown: target,
      letterWriting: false,
      letterSigReady: true,
      letterToShown: true,
      showLetterCursor: false
    })
  },

  _tickLetterWrite() {
    if (!this.data.letterWriting) return
    const target = this._letterWriteTarget || ''
    let i = this._letterWriteIndex || 0
    if (i >= target.length) {
      this._clearLetterWriteTimer()
      this._letterWriteTimer = setTimeout(() => {
        this._letterWriteTimer = null
        this._letterWriteTarget = null
        this._letterWriteIndex = 0
        this.setData({
          letterWriting: false,
          letterSigReady: true,
          showLetterCursor: false
        })
      }, 420)
      return
    }

    const ch = target.charAt(i)
    let step = 1
    if (
      Math.random() < 0.16 &&
      i + 1 < target.length &&
      !/[，。；、！？—…\s]/.test(ch) &&
      !/[，。；、！？—…]/.test(target.charAt(i + 1))
    ) {
      step = 2
    }
    i += step
    this._letterWriteIndex = i
    this.setData({ letterBodyShown: target.slice(0, i) })
    // 打字机音效：标点不响（共享件内部判断）。
    // 注意：本页的**节奏** `_delayForLetterChar` 与编排页的 `_delayForChar` 并不相同 ——
    // 这是本页既有的手感，本次**只接音效、不动节奏**（改节奏属设计变更，需产品负责人明确要求）。
    textFx.playTick(this.data.sfxMuted)
    this._letterWriteTimer = setTimeout(
      () => this._tickLetterWrite(),
      this._delayForLetterChar(ch)
    )
  },

  /** 落笔中点礼笺：立刻全文并显署名 */
  onLetterTap() {
    if (!this.data.letterWriting) return
    this._finishLetterWrite()
  },

  _clearRiteTimers() {
    ;(this._riteTimers || []).forEach((id) => clearTimeout(id))
    this._riteTimers = []
  },

  _schedule(fn, ms) {
    const id = setTimeout(() => {
      this._riteTimers = (this._riteTimers || []).filter((x) => x !== id)
      fn()
    }, ms)
    this._riteTimers = (this._riteTimers || []).concat(id)
    return id
  },

  _ensureSfx() {
    if (this._sfx) return this._sfx
    const audio = wx.createInnerAudioContext()
    audio.obeyMuteSwitch = true
    audio.volume = SFX_VOLUME
    audio.src = SFX_OPEN
    audio.onError(() => {
      /* 音效失败不打断仪式 */
    })
    this._sfx = audio
    return audio
  },

  _destroySfx() {
    if (this._sfx) {
      try {
        this._sfx.stop()
        this._sfx.destroy()
      } catch (e) {
        /* ignore */
      }
      this._sfx = null
    }
  },

  /** 仅在用户手势同步路径内调用 */
  _playSfx(src) {
    if (this.data.sfxMuted || !src) return
    try {
      const a = this._ensureSfx()
      a.volume = SFX_VOLUME
      a.stop()
      // 预加载后仍重赋 src：部分基础库 stop 后再 play 需显式复位
      a.src = src
      a.play()
    } catch (e) {
      /* ignore */
    }
  },

  toggleSfxMute() {
    const next = !this.data.sfxMuted
    this.setData({ sfxMuted: next })
    try {
      wx.setStorageSync(MUTE_STORAGE_KEY, next)
    } catch (e) {
      /* ignore */
    }
    if (next && this._sfx) {
      try {
        this._sfx.stop()
      } catch (e) {
        /* ignore */
      }
    }
  },

  /**
   * 送礼人打开领取卡：进度回执文案（对齐 PRD「待 TA 开启 / 待留下地址」）
   */
  _buildSenderStatus(gift) {
    const deliveryType = gift.deliveryType || 'invite_address'
    const expired = !!gift.expired
    const accepted = gift.acceptStatus === 'accepted'
    const addressDone = gift.addressStatus === 'submitted'
    const claimClaimed = gift.claimStatus === 'claimed'
    const token = String(gift.shareToken || this._token || '').trim()
    const orderId = String(gift.orderId || this._orderId || '').trim()
    const sharePath = orderId
      ? `/subpackages/feature/gift/receive/index?orderId=${orderId}${token ? `&token=${token}` : ''}`
      : ''

    if (expired) {
      return {
        senderPhase: 'expired',
        senderOverline: 'EXPIRED',
        senderTitle: '邀约已过期',
        senderDesc: '对方未在期限内留下去处。款项将按规则退回，可在订单中查看。',
        senderCanShare: false,
        senderCanNudge: false,
        sharePath
      }
    }

    if (deliveryType === 'invite_address') {
      if (!accepted) {
        return {
          senderPhase: 'waiting_open',
          senderOverline: 'AWAITING',
          senderTitle: '等待对方打开中',
          senderDesc: '礼笺已封缄。对方启封并留下去处后，馆员再启程——把卡片再交给 TA 即可。',
          senderCanShare: !!token,
          senderCanNudge: false,
          sharePath
        }
      }
      if (!addressDone) {
        return {
          senderPhase: 'waiting_address',
          senderOverline: 'OPENED',
          senderTitle: '对方已打开礼笺',
          senderDesc: '正等 TA 留下收件去处。不妨再提醒一声，或把礼笺再转发一次。',
          senderCanShare: !!token,
          senderCanNudge: true,
          sharePath
        }
      }
      return {
        senderPhase: 'address_done',
        senderOverline: 'RECEIPT',
        senderTitle: '对方已留下去处',
        senderDesc: '这份山海即将启程。可在订单中查看履约与物流进度。',
        senderCanShare: false,
        senderCanNudge: false,
        sharePath
      }
    }

    if (deliveryType === 'store_pickup') {
      if (claimClaimed) {
        return {
          senderPhase: 'claimed',
          senderOverline: 'CLAIMED',
          senderTitle: '对方已到店领取',
          senderDesc: '这份山海已在门店交妥。',
          senderCanShare: false,
          senderCanNudge: false,
          sharePath
        }
      }
      return {
        senderPhase: 'waiting_pickup',
        senderOverline: 'STORE HOLD',
        senderTitle: '等待对方到店领取',
        senderDesc: gift.storeName
          ? `请邀 TA 到「${gift.storeName}」出示领取码，由店员核销后交予。`
          : '请邀 TA 到指定门店出示领取码，由店员核销后交予。',
        senderCanShare: !!token,
        senderCanNudge: false,
        sharePath
      }
    }

    return {
      senderPhase: 'ship_path',
      senderOverline: 'SENT',
      senderTitle: '礼笺已备妥',
      senderDesc: '藏品正按既定去处履约。此卡主要给对方阅读礼笺，你可在订单中查看进度。',
      senderCanShare: !!token,
      senderCanNudge: false,
      sharePath
    }
  },

  async bootstrap() {
    try {
      const { flags } = await fetchContentDisplayFlags()
      if (!flags.showGift) {
        toastGiftClosed()
        setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }), 400)
        return
      }
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: {
          action: 'getShare',
          token: this._token,
          orderId: this._orderId
        }
      })
      const result = (res && res.result) || {}
      if (result.code === 'GIFT_CLOSED') {
        toastGiftClosed()
        setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }), 400)
        return
      }
      if (!result.success) {
        this.setData({
          invalid: true,
          errorMsg: result.msg || '链接已失效，或这份礼已另有去处'
        })
        return
      }
      const gift = result.gift || {}

      // 受赠人绑定：acceptGift 只对「填址礼赠」放行，自提/直邮礼赠此前永不写
      // receiverOpenid → 受赠人「我收到的」永久为空。这里对所有交付方式补一次幂等绑定。
      try {
        const bindRes = await wx.cloud.callFunction({
          name: 'manageGift',
          data: { action: 'bindReceiver', token: this._token, orderId: this._orderId, source: 'receive_page' }
        })
        const br = (bindRes && bindRes.result) || {}
        this._verifyNeeded = !br.success && br.code === 'VERIFY_REQUIRED' && br.verifyKind !== 'passcode'
        this._passcodeNeeded = !br.success && br.code === 'VERIFY_REQUIRED' && br.verifyKind === 'passcode'
        if (!br.success && br.code === 'ALREADY_BOUND') {
          this.setData({ invalid: true, errorMsg: br.msg || '这份礼赠已由其他人领取' })
          return
        }
      } catch (e) {
        console.warn('bindReceiver failed', e)
      }

      const isSender = !!(
        result.viewerRole === 'sender' ||
        result.isGiver ||
        gift.giverIsSelf ||
        gift.viewerRole === 'sender'
      )

      // 送礼人：等待/回执态，绝不进入收件人开盒仪式
      if (isSender) {
        let product = (gift.products && gift.products[0]) || null
        product = await this._enrichProtectionType(product)
        const sender = this._buildSenderStatus(gift)
        const token = String(gift.shareToken || this._token || '').trim()
        this.setData({
          ready: true,
          isSender: true,
          viewerRole: 'sender',
          expired: false,
          invalid: false,
          revealed: true,
          ritePhase: 'done',
          cardBody: gift.cardBody || '',
          cardSignature: gift.cardSignature || '',
          recipientName: gift.recipientName || gift.salutation || '',
          product,
          accepted: gift.acceptStatus === 'accepted',
          addressDone: gift.addressStatus === 'submitted',
          addressMaskedLine: (gift.addressMasked && gift.addressMasked.line) || '',
          phoneMasked:
            gift.receiverPhoneMasked ||
            (gift.addressMasked && gift.addressMasked.phone) ||
            '',
          token,
          orderId: gift.orderId || this._orderId,
          hasVoice: false,
          deliveryType: gift.deliveryType || 'invite_address',
          isInvite: (gift.deliveryType || 'invite_address') === 'invite_address',
          isPickup: gift.deliveryType === 'store_pickup',
          claimCode: gift.claimCode || '',
          claimClaimed: gift.claimStatus === 'claimed',
          storeName: gift.storeName || '',
          hidePrice: gift.hidePrice !== false,
          needFriendShare: false,
          shareTitle: '请拆开这封山海礼笺',
          ...sender
        })
        this._hydrateProductCover(product)
        return
      }

      if (result.expired) {
        this.setData({ ready: true, expired: true, isSender: false, viewerRole: 'receiver' })
        return
      }
      let product = (gift.products && gift.products[0]) || null
      product = await this._enrichProtectionType(product)
      const voiceDuration = Math.min(60, Math.max(0, parseInt(gift.voiceDuration, 10) || 0))
      const accepted = gift.acceptStatus === 'accepted'
      const deliveryType = gift.deliveryType || 'invite_address'
      const isInvite = deliveryType === 'invite_address'
      const isPickup = deliveryType === 'store_pickup'
      const claimClaimed = gift.claimStatus === 'claimed'
      const hidePrice = gift.hidePrice !== false
      const token = String(gift.shareToken || this._token || '').trim()
      const claimLink = gift.claimMode === 'link'
      const linkClaimed = claimLink && !gift.claimPending
      const needFriendShare = (isInvite || claimLink) && !token && !(isInvite ? accepted : linkClaimed)
      let pickupHint = ''
      if (isPickup) {
        pickupHint = claimClaimed
          ? '这份山海已在门店交妥。'
          : (gift.storeName
            ? `请到「${gift.storeName}」出示领取码，由店员核销后交予你。`
            : '请到指定门店出示领取码，由店员核销后交予你。')
      }
      let priceLabel = ''
      let specimenHint = '成交价已隐去 · 只留下这份心意'
      if (!hidePrice) {
        const rawPrice = product && product.price
        const n = Number(rawPrice)
        if (Number.isFinite(n) && n >= 0) {
          priceLabel = n.toFixed(2)
          specimenHint = '赠予者愿你看见这份诚意'
        } else {
          specimenHint = '藏品已备妥'
        }
      }
      /** 已收下则跳过仪式与打字，直接展笺全文 */
      const alreadyRevealed = isInvite ? accepted : false
      const cardBody = gift.cardBody || ''
      const letterFull = (String(cardBody).trim() || DEFAULT_LETTER_BODY).slice(
        0,
        LETTER_TYPE_MAX
      )
      this.setData({
        ready: true,
        isSender: false,
        viewerRole: 'receiver',
        cardBody,
        cardSignature: gift.cardSignature || '',
        recipientName: gift.recipientName || gift.salutation || '',
        letterBodyShown: alreadyRevealed ? letterFull : '',
        letterWriting: false,
        letterSigReady: alreadyRevealed,
        letterToShown: alreadyRevealed,
        showLetterCursor: false,
        product,
        accepted: isInvite ? accepted : (claimLink ? linkClaimed : true),
        addressDone: isInvite ? gift.addressStatus === 'submitted' : true,
        addressMaskedLine: (gift.addressMasked && gift.addressMasked.line) || '',
        phoneMasked: gift.receiverPhoneMasked || (gift.addressMasked && gift.addressMasked.phone) || '',
        token,
        orderId: gift.orderId || this._orderId,
        revealed: alreadyRevealed,
        ritePhase: alreadyRevealed ? 'done' : 'idle',
        hasVoice: !!gift.hasVoice,
        voiceDurationLabel: voiceDuration > 0 ? formatDuration(voiceDuration) : '',
        deliveryType,
        isInvite,
        isPickup,
        claimCode: gift.claimCode || '',
        claimClaimed,
        storeName: gift.storeName || '',
        pickupHint,
        hidePrice,
        specimenHint,
        priceLabel,
        needFriendShare,
        // 持有期服务：受礼人收下后即为持有人；签收后可看自己的收藏证书与养护指南
        holderCard: isInvite ? accepted : (claimLink ? linkClaimed : true),
        holderReady: gift.status === 'received',
        verifyNeeded: !!(this._verifyNeeded || gift.verifyRequired),
        claimLink,
        passcodeNeeded: claimLink && !linkClaimed && !!(this._passcodeNeeded || gift.passcodeRequired)
      })
      if (!this._openTracked) {
        this._openTracked = true
        trackBehavior('gift_receive_open', 'order', this.data.orderId, { mode: claimLink ? 'link' : (gift.receiverVerify ? 'phone' : 'none') })
      }
      this._maybeShowRegCard()
      if (gift.voiceTempUrl) this._voiceTempUrl = gift.voiceTempUrl
      this._hydrateProductCover(product)
    } catch (e) {
      this.setData({ invalid: true, errorMsg: '柜门片刻未应，请稍后再试' })
    }
  },

  async _enrichProtectionType(product) {
    if (!product) return product
    if (product.protectionType != null && product.protectionType !== '') {
      return product
    }
    const id = product.productId || product.id || ''
    if (!id) return product
    try {
      const res = await db.collection('products').doc(String(id)).field({ protectionType: true }).get()
      const type = (res.data && res.data.protectionType) || 'none'
      return { ...product, protectionType: type }
    } catch (e) {
      return product
    }
  },

  async _hydrateProductCover(product) {
    const raw = product && product.image
    if (!raw || !String(raw).startsWith('cloud://')) return
    try {
      const res = await wx.cloud.getTempFileURL({ fileList: [raw] })
      const item = (res && res.fileList && res.fileList[0]) || {}
      const url = item.tempFileURL || ''
      if (!url || !this.data.product) return
      this.setData({ 'product.image': url })
    } catch (e) {
      /* cloud:// 在已初始化环境可直显，失败则保持原值 */
    }
  },

  onOpenBox() {
    if (this.data.isSender) return
    if (this.data.revealed || this.data.ritePhase !== 'idle') return
    // 手势同步播整段开盒音（封缄→开盖）
    this._playSfx(SFX_OPEN)
    this.setData({ ritePhase: 'seal' })

    this._schedule(() => {
      if (this.data.revealed) return
      this.setData({ ritePhase: 'lid' })
    }, PHASE_SEAL_MS)

    this._schedule(() => {
      if (this.data.revealed) return
      this.setData({ ritePhase: 'done' })
    }, PHASE_SEAL_MS + PHASE_LID_MS)

    this._schedule(() => {
      if (this.data.revealed) return
      this.setData({ revealed: true, ritePhase: 'done' })
      this._startLetterWrite()
    }, PHASE_SEAL_MS + PHASE_LID_MS + PHASE_DONE_MS)
  },

  skipCeremony() {
    if (this.data.isSender) return
    if (this.data.revealed) return
    this._clearRiteTimers()
    if (this._sfx) {
      try {
        this._sfx.stop()
      } catch (e) {
        /* ignore */
      }
    }
    this.setData({ revealed: true, ritePhase: 'done' })
    this._showLetterInstant()
  },

  onShareAppMessage() {
    const path =
      this.data.sharePath ||
      `/subpackages/feature/gift/receive/index?orderId=${this.data.orderId || this._orderId || ''}&token=${this.data.token || this._token || ''}`
    return {
      title: this.data.shareTitle || '请拆开这封山海礼笺',
      path
    }
  },

  async onSenderNudge() {
    if (!this.data.isSender || !this.data.senderCanNudge) return
    const orderId = this.data.orderId || this._orderId
    if (!orderId) return
    wx.showLoading({ title: '提醒中…', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: { action: 'nudge', orderId }
      })
      wx.hideLoading()
      const result = (res && res.result) || {}
      wx.showToast({
        title: result.success ? '已捎去提醒' : result.msg || '稍后再试',
        icon: 'none'
      })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '网络未通，请稍后再试', icon: 'none' })
    }
  },

  goSenderProgress() {
    const orderId = this.data.orderId || this._orderId
    if (!orderId) {
      wx.navigateTo({
        url: '/subpackages/feature/gift/my-gifts/index',
        fail: () => wx.switchTab({ url: '/pages/user/index' })
      })
      return
    }
    wx.navigateTo({
      url: `/subpackages/business/order-detail/index?id=${orderId}`,
      fail: () =>
        wx.navigateTo({
          url: '/subpackages/feature/gift/my-gifts/index',
          fail: () => wx.switchTab({ url: '/pages/user/index' })
        })
    })
  },

  async onListenVoice() {
    if (this.data.isSender) return
    if (!this.data.hasVoice || this.data.voiceLoading) return
    if (this.data.voicePlaying) {
      if (this._giftPlayer) this._giftPlayer.pause()
      return
    }
    try {
      let url = this._voiceTempUrl
      if (!url) {
        this.setData({ voiceLoading: true })
        wx.showLoading({ title: '取声中…', mask: true })
        const res = await wx.cloud.callFunction({
          name: 'manageGift',
          data: {
            action: 'getGiftVoice',
            token: this.data.token,
            orderId: this.data.orderId
          }
        })
        wx.hideLoading()
        const result = (res && res.result) || {}
        if (!result.success || !result.voiceTempUrl) {
          this.setData({ voiceLoading: false })
          wx.showToast({ title: result.msg || '语音暂不可用', icon: 'none' })
          return
        }
        url = result.voiceTempUrl
        this._voiceTempUrl = url
        if (result.voiceDuration) {
          this.setData({
            voiceDurationLabel: formatDuration(result.voiceDuration)
          })
        }
      }
      if (!this._giftPlayer) {
        this.setData({ voiceLoading: false })
        return
      }
      this._giftPlayer.play(url)
    } catch (e) {
      wx.hideLoading()
      this.setData({ voiceLoading: false })
      wx.showToast({ title: '网络未通，请稍后再试', icon: 'none' })
    }
  },

  async accept() {
    if (this.data.isSender) return
    if (!this.data.isInvite) return
    const { requirePhone } = require('../../../../utils/userSession')
    const phoneOk = await requirePhone(getApp(), {
      content: '授权手机号即可收下礼赠；若尚未注册，将同步领取新客礼包。',
      from: 'gift',
      returnMode: 'back',
      direct: true
    }).catch(() => true)
    if (phoneOk === false) return

    wx.showLoading({ title: '收下中…', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: {
          action: 'accept',
          token: this.data.token,
          orderId: this.data.orderId
        }
      })
      wx.hideLoading()
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '此刻未能收下', icon: 'none' })
        if (result.code === 'EXPIRED') this.setData({ expired: true })
        if (result.code === 'VERIFY_REQUIRED') this.setData({ verifyNeeded: true })
        return
      }
      trackBehavior('gift_receive_accept', 'order', this.data.orderId, { mode: 'phone', ok: true })
      this.setData({ accepted: true })
      wx.showToast({ title: '已收下', icon: 'success' })
      setTimeout(() => this.goAddress(), 500)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '网络未通，请稍后再试', icon: 'none' })
    }
  },

  onPasscodeInput(e) {
    this.setData({ passcodeInput: String((e.detail && e.detail.value) || '').replace(/\D/g, '').slice(0, 6), claimError: '' })
  },

  onClaimNameInput(e) {
    this.setData({ claimNameInput: String((e.detail && e.detail.value) || '').slice(0, 12) })
  },

  /** 凭礼笺领取：口令（若有）→ 主动收下；不要求注册 / 手机号 */
  async acceptByLink() {
    if (this.data.isSender || this.data.claimBusy || !this.data.claimLink) return
    const orderId = this.data.orderId || this._orderId
    const token = this.data.token || this._token
    this.setData({ claimBusy: true, claimError: '' })
    const call = (data) => wx.cloud.callFunction({ name: 'manageGift', data: { token, orderId, ...data } })
      .then((r) => (r && r.result) || {})
      .catch(() => ({ success: false, msg: '网络未通，请稍后再试' }))
    if (this.data.passcodeNeeded) {
      const v = await call({ action: 'verifyReceiver', method: 'passcode', passcode: this.data.passcodeInput })
      trackBehavior('gift_receive_passcode', 'order', orderId, { ok: !!v.success })
      if (!v.success) return this.setData({ claimBusy: false, claimError: v.msg || '口令未通过，请稍后再试' })
      this._passcodeNeeded = false
      this.setData({ passcodeNeeded: false })
    }
    const claimName = String(this.data.claimNameInput || '').trim()
    const res = this.data.isInvite
      ? await call({ action: 'accept', claimName })
      : await call({ action: 'bindReceiver', confirm: true, claimName, source: 'claim_link' })
    trackBehavior('gift_receive_accept', 'order', orderId, { mode: 'link', ok: !!res.success })
    if (!res.success) {
      if (res.code === 'VERIFY_REQUIRED' && res.verifyKind === 'passcode') this.setData({ passcodeNeeded: true })
      if (res.code === 'EXPIRED') this.setData({ expired: true })
      return this.setData({ claimBusy: false, claimError: res.msg || '此刻未能收下，请稍后再试' })
    }
    this._claimName = claimName
    this.setData({ claimBusy: false })
    if (this.data.isInvite) {
      this.setData({ accepted: true, holderCard: true })
      this._maybeShowRegCard()
      return
    }
    this.bootstrap()
  },

  async _maybeShowRegCard() {
    if (this.data.isSender || !this.data.holderCard || this.data.regCardShow || this._regChecked) return
    this._regChecked = true
    const id = this.data.orderId || this._orderId
    try {
      if (wx.getStorageSync(REG_CARD_OFF_KEY + id)) return
    } catch (e) { /* ignore */ }
    const { ensureSession } = require('../../../../utils/userSession')
    const session = await ensureSession(getApp()).catch(() => null)
    if (!session) return
    const registered = session.isRegistered !== undefined
      ? !!session.isRegistered
      : !!(session.onboardingDone || (session.user && session.user.phone))
    if (registered) return
    this.setData({ regCardShow: true })
    trackBehavior('gift_reg_guide_expose', 'order', id)
  },

  onRegCardClose() {
    try { wx.setStorageSync(REG_CARD_OFF_KEY + (this.data.orderId || this._orderId), 1) } catch (e) { /* ignore */ }
    this.setData({ regCardShow: false })
  },

  onRegCardDone() {
    try { wx.setStorageSync(REG_CARD_OFF_KEY + (this.data.orderId || this._orderId), 1) } catch (e) { /* ignore */ }
  },

  // 优先比对微信授权手机号（requirePhone 只调用）
  async verifyByAccount() {
    if (this.data.verifyBusy) return
    const { requirePhone } = require('../../../../utils/userSession')
    const phoneOk = await requirePhone(getApp(), {
      content: '授权微信手机号即可核验领取；若尚未注册，将同步领取新客礼包。',
      from: 'gift',
      returnMode: 'back',
      direct: true
    }).catch(() => true)
    if (phoneOk === false) return
    this._runVerify({ method: 'account' })
  },

  openManualVerify() {
    this.setData({ verifySheet: true, verifyError: '' })
  },

  closeVerifySheet() {
    this.setData({ verifySheet: false })
  },

  onManualVerify(e) {
    this._runVerify({ method: 'manual', phone: e.detail.phone })
  },

  async _runVerify(payload) {
    this.setData({ verifyBusy: true, verifyError: '' })
    let result = {}
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: { action: 'verifyReceiver', token: this.data.token || this._token, orderId: this.data.orderId || this._orderId, ...payload }
      })
      result = (res && res.result) || {}
    } catch (e) {
      result = { success: false, msg: '网络未通，请稍后再试' }
    }
    trackBehavior('gift_receive_verify', 'order', this.data.orderId || this._orderId, { ok: !!result.success, method: payload.method })
    if (result.success) {
      this._verifyNeeded = false
      this.setData({ verifyBusy: false, verifySheet: false, verifyNeeded: false })
      this.bootstrap()
      return
    }
    if (result.code === 'NEED_PHONE') {
      this.setData({ verifyBusy: false, verifySheet: true, verifyError: '未取得已授权的微信手机号，请输入手机号核验' })
      return
    }
    this.setData({ verifyBusy: false, verifyError: result.msg || '核验未通过，请稍后再试' })
  },

  copyClaimCode() {
    const code = String(this.data.claimCode || '').trim()
    if (!code) return
    wx.setClipboardData({
      data: code,
      success: () => wx.showToast({ title: '领取码已复制', icon: 'none' })
    })
  },

  goAddress() {
    if (this.data.isSender) return
    if (!this.data.isInvite) return
    const q = `orderId=${this.data.orderId}&token=${this.data.token}`
    wx.navigateTo({
      url: `/subpackages/feature/gift/address/index?${q}`
    })
  },

  goHolderCert() {
    wx.navigateTo({ url: `/subpackages/business/certificate/index?id=${this.data.orderId}` })
  },

  goHolderCare() {
    const product = this.data.product || {}
    wx.navigateTo({
      url: buildGuideUrl({
        category: resolveCareCategory(product),
        orderId: this.data.orderId,
        productId: product.productId || '',
        from: 'order'
      })
    })
  },

  later() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) })
  },

  /** 受赠填址完成后：进入既有礼赠选品入口 */
  goSendGift() {
    wx.navigateTo({
      url: '/subpackages/feature/gift/hub/index?from=receive',
      fail: () =>
        wx.switchTab({
          url: '/pages/atelier/index',
          fail: () => wx.showToast({ title: '暂无法打开送礼', icon: 'none' })
        })
    })
  },

  goHome() {
    wx.switchTab({
      url: '/pages/index/index',
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    })
  }
})
