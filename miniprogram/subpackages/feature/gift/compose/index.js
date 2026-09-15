// 礼赠编排页 · 先付后填址主路径骨架（支付半接通现有结算）
const db = wx.cloud.database()
const { getFirstImage } = require('../../../../utils/util')
const { navigateToConfirmOrder } = require('../../../../utils/checkout')
const {
  hasSkus,
  getDisplayPrice,
  getFirstAvailableSku
} = require('../../utils/sku')
const {
  fetchContentDisplayFlags,
  toastGiftClosed,
  toastStorePickupClosed
} = require('../../../../utils/contentDisplayFlags')
const { trackBehavior } = require('../../../../utils/trackBehavior')
const {
  GIFT_NOTE_PRESETS,
  getPresetById
} = require('../giftNotePresets')
const {
  GIFT_PACKAGING_LABEL,
  GIFT_PACKAGING_NOTE
} = require('../giftPackaging')
const { decodeQueryText } = require('../decodeQueryText')
const { getSceneByKey } = require('../../utils/giftScenes')
const {
  MAX_DURATION_SEC,
  MIN_HOLD_MS,
  MIN_VOICE_MS,
  MIN_VOICE_BYTES,
  formatDuration,
  uploadGiftVoice,
  deleteCloudVoice,
  persistVoiceLocally,
  getFileSize,
  ensureInnerAudioOption,
  mapRecordError,
  createGiftRecorder,
  createGiftPlayer
} = require('../giftVoice')

/** 上滑取消阈值（px） */
const VOICE_CANCEL_SLIDE_PX = 56

/** iPhone：scroll-view 需明确 px 高度，避免 flex:1+height:0 塌成黑屏 */
function getWindowHeight() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const info = wx.getWindowInfo()
      if (info && info.windowHeight) return info.windowHeight
    }
  } catch (e) {
    /* 旧基础库 */
  }
  try {
    const info = wx.getSystemInfoSync()
    return (info && info.windowHeight) || 0
  } catch (e) {
    return 0
  }
}

const OTHER_DELIVERIES = [
  {
    id: 'ship_to_receiver',
    name: '快递给 TA',
    desc: '你已知地址时，下单时填写收货信息'
  },
  {
    id: 'ship_to_self',
    name: '寄给我',
    desc: '先寄到你处，再当面转交'
  },
  {
    id: 'store_pickup',
    name: '门店自提代赠',
    desc: '选这有店备货，分享领取码到店核销'
  }
]

Page({
  data: {
    checking: true,
    allowed: false,
    loading: false,
    loadError: '',
    product: null,
    cover: '',
    displayPrice: '0.00',
    skuLabel: '',
    selectedSku: null,
    count: 1,
    deliveryType: 'invite_address',
    showOtherDelivery: false,
    otherDeliveries: OTHER_DELIVERIES,
    /** 门店自取开关（超管后台）：false 时移除「门店自提代赠」 */
    storePickupEnabled: true,
    stores: [],
    selectedStoreId: '',
    selectedStoreName: '',
    packagingLabel: GIFT_PACKAGING_LABEL,
    packagingNote: GIFT_PACKAGING_NOTE,
    cardBody: '',
    cardSignature: '',
    recipientName: '',
    recipientEditing: false,
    notePresets: GIFT_NOTE_PRESETS,
    activeNotePresetId: '',
    /** 来自 hub 的场景（仅影响导语/场景语向，不改交付与录音） */
    activeScene: '',
    sceneLabel: '',
    sceneGuide: '',
    sceneNoteHint: '',
    scenePresetId: '',
    /** 礼笺落笔动画中 */
    noteWriting: false,
    showWriteCursor: false,
    /** 署名：聚焦态 / 微信昵称快捷填入 */
    sigFocused: false,
    sigJustSigned: false,
    wxNickName: '',
    /** 礼笺语音（与文字并存，独立于落笔动画） */
    voiceFileID: '',
    voiceDuration: 0,
    voiceDurationLabel: '',
    voiceRecording: false,
    voiceRecordSec: 0,
    voiceUploading: false,
    voicePlaying: false,
    voiceWillCancel: false,
    voiceMaxSec: MAX_DURATION_SEC,
    hidePrice: true,
    /** 超管是否允许顾客切换「隐藏价格」；false 时强制隐价 */
    allowHidePriceToggle: true,
    paying: false,
    /** 步骤轨：1 选礼 / 2 写笺 / 3 交付 */
    activeStep: 1,
    /** 主滚动区高度（iOS 显式 px） */
    scrollHeightPx: 0,
    scrollStyle: ''
  },

  onReady() {
    this.syncScrollPane()
  },

  onShow() {
    this.syncScrollPane()
  },

  guessScrollPane() {
    const winH = getWindowHeight()
    const next = Math.max(240, (winH || 600) - 56)
    this.setData({
      scrollHeightPx: next,
      scrollStyle: 'height: ' + next + 'px;'
    })
  },

  syncScrollPane() {
    const winH = getWindowHeight()
    const apply = (pageH, railH) => {
      const next = Math.max(240, Math.floor((pageH || winH || 600) - (railH || 56)))
      if (!next || next === this.data.scrollHeightPx) return
      this.setData({
        scrollHeightPx: next,
        scrollStyle: 'height: ' + next + 'px;'
      })
    }
    const runQuery = () => {
      wx.createSelectorQuery()
        .in(this)
        .select('.page')
        .boundingClientRect()
        .select('.step-rail')
        .boundingClientRect()
        .exec((res) => {
          const pageH = (res && res[0] && res[0].height) || winH
          const railH = (res && res[1] && res[1].height) || 56
          apply(pageH, railH)
        })
    }
    if (typeof wx.nextTick === 'function') wx.nextTick(runQuery)
    else setTimeout(runQuery, 16)
  },

  onLoad(options) {
    this.guessScrollPane()
    this._from = (options && options.from) || 'direct'
    this._productId = decodeQueryText((options && options.productId) || '').trim()
    this._skuId = decodeQueryText((options && options.skuId) || '').trim()
    this._contactId = decodeQueryText((options && options.contactId) || '').trim()
    const count = parseInt((options && options.count) || '1', 10)
    this.setData({ count: count > 0 ? count : 1 })

    let sceneKey = decodeQueryText((options && options.scene) || '').trim()
    // 对象入口经 hub 二次跳转时，未 decode 会留下 %E4%B8%XX 或双重编码残片
    let toName = decodeQueryText(
      (options && (options.toName || options.recipientName)) || ''
    )
      .trim()
      .slice(0, 40)
    if (!sceneKey || !toName || !this._contactId) {
      try {
        const pref = wx.getStorageSync('gift_compose_prefills') || null
        if (pref && typeof pref === 'object') {
          if (!sceneKey && pref.scene) sceneKey = String(pref.scene).trim()
          if (!toName && pref.toName) toName = String(pref.toName).trim().slice(0, 40)
          if (!this._contactId && pref.contactId) this._contactId = String(pref.contactId).trim()
          wx.removeStorageSync('gift_compose_prefills')
        }
      } catch (e) { /* ignore */ }
    } else {
      try {
        wx.removeStorageSync('gift_compose_prefills')
      } catch (e) { /* ignore */ }
    }

    const sceneMeta = getSceneByKey(sceneKey)
    const patch = {}
    if (sceneMeta) {
      patch.activeScene = sceneMeta.key
      patch.sceneLabel = sceneMeta.label
      patch.sceneGuide = sceneMeta.guide || ''
      patch.sceneNoteHint = sceneMeta.noteHint || ''
      patch.scenePresetId = `scene_${sceneMeta.key}`
    }
    if (toName) {
      patch.recipientName = toName
      patch.recipientEditing = false
    }
    if (Object.keys(patch).length) this.setData(patch)

    this._hydrateSenderSignature()
    this._initGiftVoice()
    this.bootstrap()
  },

  /**
   * 解析账号昵称：globalData → session → 会员卡快照；过滤空/占位昵称
   */
  _resolveAccountNickName() {
    const INVALID = { 微信用户: 1, 未登录用户: 1, 藏家: 1 }
    const pick = (raw) => {
      const nick = String(raw || '').trim()
      if (!nick || INVALID[nick]) return ''
      return nick.slice(0, 20)
    }
    try {
      const app = getApp()
      const gd = (app && app.globalData) || {}
      const u = gd.userInfo || null
      const fromUser = pick(u && (u.nickName || u.nickname))
      if (fromUser) return fromUser
      const su = (gd.userSession && gd.userSession.user) || null
      const fromSession = pick(su && (su.nickName || su.nickname))
      if (fromSession) return fromSession
      try {
        const snap = wx.getStorageSync('member_vip_card_snapshot_v1')
        const fromSnap = pick(snap && snap.nickName)
        if (fromSnap) return fromSnap
      } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
    return ''
  },

  /** 署名默认带出账号昵称；可改。无有效昵称则留空 + placeholder */
  _hydrateSenderSignature() {
    const nick = this._resolveAccountNickName()
    const patch = {}
    if (nick) {
      patch.wxNickName = nick
      if (!String(this.data.cardSignature || '').trim()) {
        patch.cardSignature = nick
      }
    }
    if (Object.keys(patch).length) this.setData(patch)
  },

  onComposeScroll() {
    if (this._stepRailLock) return
    this._stepRailLock = true
    this._updateActiveStep()
    setTimeout(() => {
      this._stepRailLock = false
    }, 80)
  },

  _updateActiveStep() {
    wx.createSelectorQuery()
      .in(this)
      .select('.scroll')
      .boundingClientRect()
      .select('.sec-specimen')
      .boundingClientRect()
      .select('.sec-letter')
      .boundingClientRect()
      .select('.sec-delivery')
      .boundingClientRect()
      .exec((rects) => {
        if (!rects || !rects[0]) return
        const viewportTop = rects[0].top
        const mark = viewportTop + Math.min(160, (rects[0].height || 400) * 0.28)
        let step = 1
        const letter = rects[2]
        const delivery = rects[3]
        if (delivery && delivery.top <= mark) step = 3
        else if (letter && letter.top <= mark) step = 2
        else step = 1
        if (step !== this.data.activeStep) this.setData({ activeStep: step })
      })
  },

  onHide() {
    if (this.data.noteWriting) this.finishNoteWrite()
    else this.clearNoteWriteTimer()
    this._abortVoiceHold(true)
    this._stopVoicePreview()
  },

  onUnload() {
    this.clearNoteWriteTimer()
    if (this._hintResetTimer) {
      clearTimeout(this._hintResetTimer)
      this._hintResetTimer = null
    }
    if (this._sigSettleTimer) {
      clearTimeout(this._sigSettleTimer)
      this._sigSettleTimer = null
    }
    this._teardownGiftVoice()
  },

  _initGiftVoice() {
    ensureInnerAudioOption()
    this._giftRecorder = createGiftRecorder({
      onStart: () => {
        if (!this._voiceHolding) {
          // 权限弹窗 / 异步 start 期间已松手：立刻收束，绝不继续录
          if (this._giftRecorder) this._giftRecorder.cancel()
          return
        }
        this.setData({
          voiceRecording: true,
          voiceRecordSec: 0,
          voiceWillCancel: false
        })
      },
      onTick: (sec) => {
        this.setData({ voiceRecordSec: sec })
      },
      onStop: (payload) => {
        this._voiceHolding = false
        this.setData({
          voiceRecording: false,
          voiceRecordSec: 0,
          voiceWillCancel: false
        })
        this._onVoiceRecorded(payload)
      },
      onError: (err) => {
        this._voiceHolding = false
        this.setData({
          voiceRecording: false,
          voiceRecordSec: 0,
          voiceWillCancel: false
        })
        const mapped = mapRecordError(err)
        if (mapped.authDenied) {
          // ensureRecordAuth 已弹「去设置」
          return
        }
        wx.showToast({ title: mapped.toast || '录音未能开始', icon: 'none' })
      }
    })
    this._giftPlayer = createGiftPlayer({
      onPlay: () => this.setData({ voicePlaying: true }),
      onPause: () => this.setData({ voicePlaying: false }),
      onStop: () => this.setData({ voicePlaying: false }),
      onEnded: () => this.setData({ voicePlaying: false }),
      onError: () => {
        this.setData({ voicePlaying: false })
        wx.showToast({ title: '播放失败，请重录或稍后再试', icon: 'none' })
      }
    })
  },

  _teardownGiftVoice() {
    this._voiceHolding = false
    this._stopVoicePreview()
    if (this._giftRecorder) {
      this._giftRecorder.destroy()
      this._giftRecorder = null
    }
    if (this._giftPlayer) {
      this._giftPlayer.destroy()
      this._giftPlayer = null
    }
  },

  _stopVoicePreview() {
    if (this._giftPlayer) this._giftPlayer.stop()
    if (this.data.voicePlaying) this.setData({ voicePlaying: false })
  },

  _abortVoiceHold(discard) {
    this._voiceHolding = false
    if (this.data.voiceWillCancel || this.data.voiceRecording) {
      this.setData({
        voiceRecording: false,
        voiceRecordSec: 0,
        voiceWillCancel: false
      })
    }
    if (!this._giftRecorder) return
    if (discard) this._giftRecorder.cancel()
    else this._giftRecorder.stop()
  },

  onVoiceHoldStart(e) {
    if (this.data.voiceUploading || this.data.paying) return
    // 已在按住会话中：忽略（防 touch 冒泡 / 重入导致二次 start）
    if (this._voiceHolding) return
    if (this._giftRecorder && this._giftRecorder.isBusy()) return

    this._voiceHolding = true
    this._voiceTouchAt = Date.now()
    const touch = (e && e.touches && e.touches[0]) || null
    this._voiceStartY = touch ? touch.clientY : 0
    this._stopVoicePreview()
    if (!this._giftRecorder) this._initGiftVoice()

    // 不 await：松手由 touchend 驱动 pendingStop，避免 async 间隙丢 stop
    this._giftRecorder.start().then((started) => {
      if (!started) {
        this._voiceHolding = false
        this.setData({ voiceRecording: false, voiceWillCancel: false })
      } else if (!this._voiceHolding && this._giftRecorder) {
        this._giftRecorder.cancel()
      }
    })
  },

  onVoiceHoldMove(e) {
    if (!this._voiceHolding) return
    const touch = (e && e.touches && e.touches[0]) || null
    if (!touch || !this._voiceStartY) return
    const dy = this._voiceStartY - touch.clientY
    const willCancel = dy >= VOICE_CANCEL_SLIDE_PX
    if (willCancel !== this.data.voiceWillCancel) {
      this.setData({ voiceWillCancel: willCancel })
    }
  },

  onVoiceHoldEnd() {
    if (!this._voiceHolding && !(this._giftRecorder && this._giftRecorder.isBusy())) {
      return
    }
    const heldMs = Date.now() - (this._voiceTouchAt || 0)
    const willCancel = !!this.data.voiceWillCancel
    this._voiceHolding = false

    if (!this._giftRecorder) {
      this.setData({ voiceRecording: false, voiceWillCancel: false })
      return
    }

    // 极短触摸 / 上滑：取消且不进入试听
    if (willCancel || heldMs < MIN_HOLD_MS) {
      this.setData({ voiceWillCancel: false })
      this._giftRecorder.cancel()
      if (!willCancel && heldMs < MIN_HOLD_MS) {
        wx.showToast({ title: '按住说话', icon: 'none' })
      } else if (willCancel) {
        wx.showToast({ title: '已取消', icon: 'none' })
      }
      return
    }

    this.setData({ voiceWillCancel: false })
    this._giftRecorder.stop()
  },

  onVoiceHoldCancel() {
    this._abortVoiceHold(true)
  },

  async _onVoiceRecorded(payload) {
    if (payload && payload.discarded) return
    const tempPath = payload && payload.tempFilePath
    const durationMs = Math.max(0, (payload && payload.durationMs) || 0)
    let durationSec = Math.min(
      MAX_DURATION_SEC,
      Math.max(0, (payload && payload.durationSec) || 0)
    )
    if (durationSec < 1 && durationMs >= MIN_VOICE_MS) durationSec = 1
    if (!tempPath || durationMs < MIN_VOICE_MS || durationSec < 1) {
      wx.showToast({ title: '录音太短，请按住多说一会', icon: 'none' })
      return
    }
    const size = await getFileSize(tempPath)
    if (size > 0 && size < MIN_VOICE_BYTES) {
      wx.showToast({
        title: '未录到声音，请对着手机说话后重试',
        icon: 'none'
      })
      return
    }
    this.setData({ voiceUploading: true })
    wx.showLoading({ title: '收录中…', mask: true })
    try {
      const localPath = (await persistVoiceLocally(tempPath)) || tempPath
      const prevId = this.data.voiceFileID
      const fileID = await uploadGiftVoice(localPath)
      if (prevId && prevId !== fileID) deleteCloudVoice(prevId)
      this._voiceLocalPath = localPath
      this.setData({
        voiceFileID: fileID,
        voiceDuration: durationSec,
        voiceDurationLabel: formatDuration(durationSec),
        voiceUploading: false
      })
      wx.hideLoading()
      wx.showToast({ title: '已收录', icon: 'success' })
      trackBehavior('gift_voice_record', 'gift', fileID, { durationSec })
    } catch (e) {
      console.warn('gift voice upload', e)
      this.setData({ voiceUploading: false })
      wx.hideLoading()
      wx.showToast({ title: '上传失败，请重试', icon: 'none' })
    }
  },

  onVoicePlayTap() {
    if (!this.data.voiceFileID && !this._voiceLocalPath) return
    if (!this._giftPlayer) this._initGiftVoice()
    const src = this._voiceLocalPath || this.data.voiceFileID
    this._giftPlayer.play(src)
  },

  onVoiceDeleteTap() {
    if (!this.data.voiceFileID && !this.data.voiceDuration) return
    wx.showModal({
      title: '删除语音？',
      content: '礼笺将只保留文字（若有）。',
      confirmText: '删除',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        const prev = this.data.voiceFileID
        this._stopVoicePreview()
        this._voiceLocalPath = ''
        this.setData({
          voiceFileID: '',
          voiceDuration: 0,
          voiceDurationLabel: '',
          voicePlaying: false
        })
        if (prev) deleteCloudVoice(prev)
      }
    })
  },

  async bootstrap() {
    try {
      const { flags } = await fetchContentDisplayFlags()
      if (!flags.showGift) {
        toastGiftClosed()
        this.setData({ checking: false, allowed: false })
        setTimeout(() => {
          wx.navigateBack({
            fail: () => wx.switchTab({ url: '/pages/category/index' })
          })
        }, 400)
        return
      }
      // 门店自取开关：关闭时移除「门店自提代赠」选项，并回落「邀请 TA 填写地址」
      const pickupEnabled = flags.showStorePickup !== false
      const deliveryPatch = {
        storePickupEnabled: pickupEnabled,
        otherDeliveries: pickupEnabled
          ? OTHER_DELIVERIES
          : OTHER_DELIVERIES.filter((d) => d.id !== 'store_pickup')
      }
      if (!pickupEnabled && this.data.deliveryType === 'store_pickup') {
        deliveryPatch.deliveryType = 'invite_address'
        deliveryPatch.showOtherDelivery = false
      }
      this.setData(deliveryPatch)
      this.setData({ checking: false, allowed: true, loading: true })
      if (!this._productId) {
        this.setData({
          loading: false,
          loadError: '请从馆藏详情点「赠予」进入，再备妥这份礼'
        })
        return
      }
      await this.loadProduct(this._productId)
      await this.loadStores()
      await this.loadGiftDefaults()
      trackBehavior('gift_compose_enter', 'product', this._productId, {
        from: this._from,
        deliveryType: this.data.deliveryType || 'invite_address'
      })
      setTimeout(() => {
        this.syncScrollPane()
        this._updateActiveStep()
      }, 120)
    } catch (e) {
      toastGiftClosed()
      this.setData({ checking: false, allowed: false, loading: false })
      setTimeout(() => {
        wx.navigateBack({
          fail: () => wx.switchTab({ url: '/pages/category/index' })
        })
      }, 400)
    }
  },

  async loadProduct(id) {
    try {
      const res = await db.collection('products').doc(id).get()
      const product = res.data
      if (!product) {
        this.setData({ loading: false, loadError: '这件藏品已不在柜中' })
        return
      }
      if (product.giftEligible === false) {
        this.setData({ loading: false, loadError: '这件暂不适合礼赠，请另选一件' })
        return
      }

      let selectedSku = null
      if (hasSkus(product)) {
        if (this._skuId) {
          const list = product.skus || []
          selectedSku = list.find((s) => String(s.id) === this._skuId) || null
        }
        if (!selectedSku) selectedSku = getFirstAvailableSku(product)
      }

      const unitPrice = selectedSku
        ? (parseFloat(selectedSku.price) || 0)
        : getDisplayPrice(product)
      const total = (unitPrice * (this.data.count || 1)).toFixed(2)
      const cover = getFirstImage(
        selectedSku && selectedSku.image ? [selectedSku.image] : (product.images || [])
      )

      this.setData({
        loading: false,
        product,
        selectedSku,
        skuLabel: selectedSku ? (selectedSku.specLabel || '') : '',
        displayPrice: total,
        cover: cover || ''
      })
      // 主内容挂载后再量一次高度（allowed&&product 分支刚出现）
      setTimeout(() => this.syncScrollPane(), 40)
      // 场景选中后默认礼笺语向（正文为空时自动落笔；不碰录音）
      this._maybeApplySceneNote()
    } catch (e) {
      console.warn('gift compose loadProduct', e)
      this.setData({ loading: false, loadError: '柜中片刻未应，请稍后再试' })
    }
  },

  _maybeApplySceneNote() {
    const hint = String(this.data.sceneNoteHint || '').trim()
    const key = this.data.activeScene
    if (!hint || !key) return
    if (String(this.data.cardBody || '').trim()) return
    if (this.data.noteWriting) return
    this.applyNotePreset({
      id: `scene_${key}`,
      label: 'TA',
      body: hint
    })
  },

  async loadStores() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getStoreConfig' })
      const stores = ((res && res.result && res.result.stores) || [])
        .filter((s) => s && s.status !== 'inactive')
        .map((s) => ({
          storeId: s.storeId || s._id || '',
          name: s.name || '门店'
        }))
        .filter((s) => s.storeId)
      const first = stores[0]
      this.setData({
        stores,
        selectedStoreId: first ? first.storeId : '',
        selectedStoreName: first ? first.name : ''
      })
    } catch (e) {
      this.setData({ stores: [] })
    }
  },

  async loadGiftDefaults() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: { action: 'getPublicDefaults' }
      })
      const result = (res && res.result) || {}
      if (!result.success) return
      // 门店自取关闭时，后台默认值若为自提也回落邀请填址
      let deliveryType = result.defaultDeliveryType || 'invite_address'
      if (deliveryType === 'store_pickup' && this.data.storePickupEnabled === false) {
        deliveryType = 'invite_address'
      }
      const patch = { deliveryType }
      if (deliveryType !== 'invite_address') patch.showOtherDelivery = true
      // 超管运营开关：关闭后强制隐价，前端同时隐藏切换入口
      const allowToggle = result.allowHidePriceToggle !== false
      patch.allowHidePriceToggle = allowToggle
      if (!allowToggle) patch.hidePrice = true
      this.setData(patch)
    } catch (e) {
      /* 回落页面默认 invite_address */
    }
  },

  onSelectDelivery(e) {
    const type = e.currentTarget.dataset.type
    if (!type) return
    if (type === 'store_pickup' && this.data.storePickupEnabled === false) {
      toastStorePickupClosed()
      return
    }
    const patch = { deliveryType: type }
    if (type !== 'invite_address') patch.showOtherDelivery = true
    this.setData(patch)
  },

  onSelectStore(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || ''
    if (!id) return
    this.setData({ selectedStoreId: id, selectedStoreName: name })
  },

  toggleOtherDelivery() {
    this.setData({ showOtherDelivery: !this.data.showOtherDelivery })
  },

  onCardInput(e) {
    if (this.data.noteWriting) this.finishNoteWrite()
    const cardBody = (e.detail && e.detail.value) || ''
    const patch = { cardBody }
    const activeId = this.data.activeNotePresetId
    if (activeId) {
      const preset = getPresetById(activeId)
      if (!preset || cardBody !== preset.body) patch.activeNotePresetId = ''
    }
    this.setData(patch)
  },

  onCardFocus() {
    if (this.data.noteWriting) this.finishNoteWrite()
  },

  /** 落笔动画中点正文区：立刻全文并停动画，便于手改 */
  onCardAreaTap() {
    if (!this.data.noteWriting) return
    this.finishNoteWrite()
  },

  onSigInput(e) {
    const cardSignature = (e.detail && e.detail.value) || ''
    const wasEmpty = !String(this.data.cardSignature || '').trim()
    const nowFilled = !!String(cardSignature || '').trim()
    const patch = { cardSignature }
    if (wasEmpty && nowFilled) {
      this._pulseSigSettle(patch)
    }
    this.setData(patch)
  },

  onSigFocus() {
    this.setData({ sigFocused: true })
  },

  onSigBlur() {
    this.setData({ sigFocused: false })
  },

  _pulseSigSettle(patch) {
    patch.sigJustSigned = true
    if (this._sigSettleTimer) clearTimeout(this._sigSettleTimer)
    this._sigSettleTimer = setTimeout(() => {
      this._sigSettleTimer = null
      this.setData({ sigJustSigned: false })
    }, 700)
  },

  onUseNickName() {
    const nick = String(this.data.wxNickName || '').trim()
    if (!nick) return
    const patch = { cardSignature: nick.slice(0, 20) }
    this._pulseSigSettle(patch)
    this.setData(patch)
  },

  onRecipientTap() {
    if (!this.data.recipientEditing) {
      this.setData({ recipientEditing: true })
    }
  },

  onRecipientFocus() {
    this.setData({ recipientEditing: true })
  },

  onRecipientBlur() {
    this.setData({ recipientEditing: false })
  },

  onRecipientInput(e) {
    this.setData({
      recipientName: String((e.detail && e.detail.value) || '').slice(0, 20)
    })
  },

  clearNoteWriteTimer() {
    if (this._noteWriteTimer) {
      clearTimeout(this._noteWriteTimer)
      this._noteWriteTimer = null
    }
  },

  /**
   * 结束落笔：立刻写出全文；清理 timer
   * 不覆盖已填受赠人名（关系标签与姓名并存）
   */
  finishNoteWrite() {
    this.clearNoteWriteTimer()
    const target = this._noteWriteTarget != null
      ? this._noteWriteTarget
      : String(this.data.cardBody || '')
    this._noteWriteTarget = null
    this._noteWriteIndex = 0
    if (this._hintResetTimer) {
      clearTimeout(this._hintResetTimer)
      this._hintResetTimer = null
    }
    this.setData({
      cardBody: target,
      noteWriting: false,
      showWriteCursor: false
    })
  },

  /**
   * 推荐信笺落笔节奏：略慢于聊天打字，标点处呼吸停顿
   */
  _delayForChar(ch) {
    let delay = 52 + Math.floor(Math.random() * 48)
    if (/[，、；]/.test(ch)) delay += 110 + Math.floor(Math.random() * 90)
    else if (/[。！？]/.test(ch)) delay += 200 + Math.floor(Math.random() * 140)
    else if (/[—…·]/.test(ch)) delay += 90 + Math.floor(Math.random() * 70)
    if (Math.random() < 0.07) delay += 160 + Math.floor(Math.random() * 220)
    return delay
  },

  _tickNoteWrite() {
    if (!this.data.noteWriting) return
    const target = this._noteWriteTarget || ''
    let i = this._noteWriteIndex || 0
    if (i >= target.length) {
      this.clearNoteWriteTimer()
      // 收笔：光标再停一瞬
      this._noteWriteTimer = setTimeout(() => {
        this._noteWriteTimer = null
        this._noteWriteTarget = null
        this._noteWriteIndex = 0
        this.setData({
          noteWriting: false,
          showWriteCursor: false
        })
      }, 480)
      return
    }

    const ch = target.charAt(i)
    let step = 1
    // 偶发连写两字，更像运笔而非机械机打
    if (
      step === 1 &&
      Math.random() < 0.18 &&
      i + 1 < target.length &&
      !/[，。；、！？—…\s]/.test(ch) &&
      !/[，。；、！？—…]/.test(target.charAt(i + 1))
    ) {
      step = 2
    }
    i += step
    this._noteWriteIndex = i
    this.setData({ cardBody: target.slice(0, i) })

    const delay = this._delayForChar(ch)
    this._noteWriteTimer = setTimeout(() => this._tickNoteWrite(), delay)
  },

  /**
   * 以写信方式写入推荐正文（仅服务选用候选；手改不走此路径）
   * 关系标签不覆盖已填受赠人名
   */
  startNoteWrite(preset) {
    if (!preset || !preset.body) return
    this.clearNoteWriteTimer()
    if (this._hintResetTimer) {
      clearTimeout(this._hintResetTimer)
      this._hintResetTimer = null
    }

    const body = String(preset.body)
    this._noteWriteTarget = body
    this._noteWriteIndex = 0

    this.setData({
      cardBody: '',
      activeNotePresetId: preset.id,
      noteWriting: true,
      showWriteCursor: true
    })

    // 落笔前短停：铺纸、想好第一句
    this._noteWriteTimer = setTimeout(() => {
      this._noteWriteTimer = null
      this._tickNoteWrite()
    }, 320)
  },

  /**
   * 点关系标签：空正文或已是该候选则直接填入；否则 confirm 是否替换
   */
  onNotePresetTap(e) {
    const id = e.currentTarget.dataset.id
    const preset = getPresetById(id)
    if (!preset || !preset.body) return

    // 动画中点其它关系：以已写出的全文为「当前内容」再确认
    const current = this.data.noteWriting && this._noteWriteTarget != null
      ? String(this._noteWriteTarget)
      : String(this.data.cardBody || '')
    const trimmed = current.trim()
    if (!trimmed || current === preset.body) {
      this.applyNotePreset(preset)
      return
    }

    wx.showModal({
      title: '替换礼笺？',
      content: '用推荐文案替换当前内容？',
      confirmText: '替换',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) this.applyNotePreset(preset)
      }
    })
  },

  applyNotePreset(preset) {
    if (!preset || !preset.body) return
    this.startNoteWrite(preset)
    trackBehavior('gift_note_preset', 'gift', preset.id, {
      label: preset.label
    })
  },

  /** 场景语向：与关系预设并存，复用同一落笔路径，不改录音逻辑 */
  onSceneNoteTap() {
    const hint = String(this.data.sceneNoteHint || '').trim()
    const key = this.data.activeScene
    if (!hint || !key) return
    const preset = {
      id: `scene_${key}`,
      label: 'TA',
      body: hint
    }
    const current = this.data.noteWriting && this._noteWriteTarget != null
      ? String(this._noteWriteTarget)
      : String(this.data.cardBody || '')
    const trimmed = current.trim()
    if (!trimmed || current === preset.body) {
      this.applyNotePreset(preset)
      return
    }
    wx.showModal({
      title: '替换礼笺？',
      content: '用场景语向替换当前内容？',
      confirmText: '替换',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) this.applyNotePreset(preset)
      }
    })
  },

  toggleHidePrice() {
    // 超管关闭该能力时不允许顾客自行改成「显示价格」
    if (this.data.allowHidePriceToggle === false) {
      wx.showToast({ title: '当前不可关闭隐价', icon: 'none' });
      return;
    }
    this.setData({ hidePrice: !this.data.hidePrice })
  },

  /**
   * 进入确认订单：按交付方式携带 giftMeta（含门店）
   */
  goPay() {
    if (this.data.paying || this.data.voiceUploading) return
    if (this.data.noteWriting) this.finishNoteWrite()
    if (this._giftRecorder && this._giftRecorder.isRecording()) {
      wx.showToast({ title: '请先结束录音', icon: 'none' })
      return
    }
    const p = this.data.product
    if (!p || !p._id) {
      wx.showToast({ title: '藏品信息异常', icon: 'none' })
      return
    }
    const deliveryType = this.data.deliveryType || 'invite_address'
    const hasText = !!String(this.data.cardBody || '').trim()
    const hasVoice = !!(this.data.voiceFileID && this.data.voiceDuration > 0)
    if (!hasText && !hasVoice) {
      wx.showToast({ title: '先写礼笺，或留下一段声音', icon: 'none' })
      return
    }
    if (deliveryType === 'store_pickup' && this.data.storePickupEnabled === false) {
      toastStorePickupClosed()
      return
    }
    if (deliveryType === 'store_pickup' && !this.data.selectedStoreId) {
      wx.showToast({ title: '请先选定自提门店', icon: 'none' })
      return
    }

    const sku = this.data.selectedSku
    const count = this.data.count || 1
    this.setData({ paying: true })
    trackBehavior('gift_pay_click', 'product', p._id, {
      deliveryType,
      hidePrice: this.data.hidePrice,
      hasVoice
    })

    navigateToConfirmOrder([{
      productId: p._id,
      skuId: sku ? sku.id : '',
      skuLabel: sku ? sku.specLabel : '',
      count,
      title: p.title,
      image: getFirstImage(sku && sku.image ? [sku.image] : p.images),
      price: sku ? sku.price : p.price,
      latinName: p.latinName,
      isTreasure: !!p.isTreasure,
      isUnique: !!(p.isUnique || p.isOneOfAKind),
      memberDiscountEnabled: p.memberDiscountEnabled !== false,
      categoryType: p.categoryType || '',
      rootCategoryName: p.rootCategoryName || '',
      category: p.category || p.categoryName || '',
      shippingKind: p.shippingKind || '',
      protectionType: p.protectionType || 'none',
      isProtected: !!(p.protectionType && p.protectionType !== 'none')
    }], {
      source: 'gift',
      giftMeta: {
        deliveryType,
        hidePrice: this.data.hidePrice !== false,
        cardBody: String(this.data.cardBody || '').trim(),
        cardSignature: String(this.data.cardSignature || '').trim(),
        recipientName: String(this.data.recipientName || '').trim(),
        voiceFileID: hasVoice ? this.data.voiceFileID : '',
        voiceDuration: hasVoice ? this.data.voiceDuration : 0,
        storeId: deliveryType === 'store_pickup' ? this.data.selectedStoreId : '',
        storeName: deliveryType === 'store_pickup' ? this.data.selectedStoreName : '',
        phase: 'mvp'
      }
    })

    setTimeout(() => this.setData({ paying: false }), 600)
  },

  leaveCompose() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/atelier/index' })
    })
  },

  goBrowseFromError() {
    wx.switchTab({
      url: '/pages/category/index',
      fail: () =>
        wx.navigateTo({
          url: '/subpackages/feature/search/index',
          fail: () => wx.showToast({ title: '无法打开馆藏', icon: 'none' })
        })
    })
  }
})
