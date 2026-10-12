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
  toastGiftClosed
} = require('../../../../utils/contentDisplayFlags')
const { trackBehavior } = require('../../../../utils/trackBehavior')
const {
  GIFT_NOTE_PRESETS,
  getPresetById,
  presetBodyCount,
  pickPresetBody
} = require('../giftNotePresets')
// 正文字数上限**从打印模块取**（印得出来才算数；推导见 giftShareCard.js 常量处注释）
const { GIFT_NOTE_MAX_CHARS } = require('../giftShareCard')
const {
  GIFT_PACKAGING_ITEMS
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
/** 礼笺打字机音效（2026-09-19）：与 receive 页开盒音效同一套模式 */
const textFx = require('../giftTextEffect')
/** 会员应付（2026-09-19 裁决 46-a）：**主包**件 —— 分包之间不能互 require，
 *  故编排页不能直接引 subpackages/business/utils/memberPricing.js */
const memberPayable = require('../../utils/memberPayable')
/** 自定义顶栏（index.json navigationStyle: custom）：高度按胶囊位置算，与藏品详情同一套 */
const { getCustomNavLayout } = require('../../utils/customNav')

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

Page({
  data: {
    /** 音效开关：与 receive 页共用同一个存储键，整条礼赠流程一个偏好 */
    sfxMuted: textFx.isMuted(),
    /** 统一主视觉轻提示（AppToast）：原生 toast 与本产品视觉脱节（V1.1.2·W2 棘轮不得新增原生调用） */
    toastShow: false,
    toastOverline: '',
    toastTitle: '',
    toastDesc: '',
    toastDuration: 2200,
    checking: true,
    allowed: false,
    loading: false,
    loadError: '',
    product: null,
    cover: '',
    displayPrice: '0.00',
    /** 备妥应付（裁决 46-a）：= 当前等级会员价；无折扣/未取到等级时与原价一致 */
    payablePrice: '0.00',
    memberDiscounted: false,
    memberLevelName: '',
    skuLabel: '',
    selectedSku: null,
    count: 1,
    /** 进确认页时的初始交付方式（后台默认值；交付方式在确认页选，见蓝图 礼赠凭礼笺领取 §15） */
    deliveryType: 'invite_address',
    /** 犒劳自己：交付固定寄给我（确认页只给「寄到我的地址」） */
    selfTreat: false,
    /** 门店自取开关（超管后台）：false 时默认交付不落在门店自提 */
    storePickupEnabled: true,
    packagingItems: GIFT_PACKAGING_ITEMS,
    cardBody: '',
    cardFocused: false,          // iOS：textarea 不支持 font-family → 未聚焦时用手写体 text 展示
    placeholderNote: '这段日子里你帮了太多。柜中挑了一件安静的藏品……',
    cardSignature: '',
    recipientName: '',
    recipientEditing: false,
    /** scroll-into-view 目标：composeTop（换步回到顶部） */
    phoneScrollId: '',
    /** 需求 9：必填项要在界面上看得出来；选「犒劳自己」时改成「你的昵称」 */
    recipientPlaceholder: 'TA 的名字（必填）',
    notePresets: GIFT_NOTE_PRESETS,
    // 正文字数上限与提示（模板只读这两个值，不再写死 200）
    noteMaxChars: GIFT_NOTE_MAX_CHARS,
    noteLimitHint: `最多 ${GIFT_NOTE_MAX_CHARS} 字（礼笺要印在 75×75mm 贴纸上）`,
    activeNotePresetId: '',
    /** 当前关系选到第几句（0 基）与候选总数 —— 给「换一句」与「第 n/N 句」标用 */
    noteVariantIndex: 0,
    noteVariantTotal: 0,
    noteVariantLabel: '',
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
    /** 分步编排（2026-10-12，§15 起两步）：当前步 1 选礼 / 2 写笺（交付与支付在确认页）；maxStep = 已到过的最远一步（步骤轨只能点回 ≤ 它的步） */
    statusBarHeight: 20,
    navBarHeight: 44,
    navPaddingRight: 96,
    navTotal: 64,
    activeStep: 1,
    maxStep: 1,
    /** 主滚动区高度（iOS 显式 px） */
    scrollHeightPx: 0,
    scrollStyle: ''
  },

  /** 统一主视觉轻提示（铭牌 + 铜金 + 衬线标题）—— 取代原生 toast。
   *  与 pages/cart/index.js 的 showAppToast 同形（原生 toast 在博物黑界面里最不像本产品）。 */
  showAppToast({ overline = '', title = '', desc = '', duration = 0 } = {}) {
    if (!title) return
    this.setData({
      toastOverline: overline,
      toastTitle: title,
      toastDesc: desc,
      toastDuration: duration || 2200,
      toastShow: true
    })
  },

  onToastClose() {
    this.setData({ toastShow: false })
  },

  onReady() {
    this.syncScrollPane()
  },

  onShow() {
    // 署名默认带出账号昵称（此前该函数是**死代码**：定义了却从未调用 ✗）
    this._hydrateSenderSignature()
    // 昵称可能晚于本页就绪（全局 userSession 异步灌入）→ 空则 800ms 后再试一次
    clearTimeout(this._sigHydrateTimer)
    if (!String(this.data.cardSignature || '').trim()) {
      this._sigHydrateTimer = setTimeout(() => this._hydrateSenderSignature(), 800)
    }
    this.syncScrollPane()
  },

  /** 顶栏 = 状态栏 + 按胶囊上下对称留白的导航条（customNav），标题左右各让出胶囊宽，不压胶囊 */
  _initNav() {
    const nav = getCustomNavLayout()
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navPaddingRight: nav.navPaddingRight,
      navTotal: nav.statusBarHeight + nav.navBarHeight
    })
  },

  /** 实测前的占位：顶栏 + 步骤轨约 56 + 底栏约 96（不含安全区，onReady 后即被实测值覆盖） */
  guessScrollPane() {
    const winH = getWindowHeight()
    const next = Math.max(240, (winH || 600) - this.data.navTotal - 152)
    this.setData({
      scrollHeightPx: next,
      scrollStyle: 'height: ' + next + 'px;'
    })
  },

  /**
   * 滚动区 = 自身顶边 → 底栏顶边（实测 px）。上方的自定义顶栏、步骤轨与底栏高度都不能写死：
   * 底栏会因会员价小字、安全区变高；漏减任何一块，最后一行就会压在底栏下（2026-10-12 真机）。
   */
  syncScrollPane() {
    const winH = getWindowHeight()
    const runQuery = () => {
      wx.createSelectorQuery()
        .in(this)
        .select('.page')
        .boundingClientRect()
        .select('.scroll')
        .boundingClientRect()
        .select('.bottom-bar')
        .boundingClientRect()
        .exec((res) => {
          const page = res && res[0]
          const scroll = res && res[1]
          const bar = res && res[2]
          if (!scroll) return
          const bottom = page && page.height ? page.top + page.height : (winH || 600)
          const barH = (bar && bar.height) || 0
          const next = Math.max(240, Math.floor(bottom - scroll.top - barH))
          if (!next || next === this.data.scrollHeightPx) return
          this.setData({
            scrollHeightPx: next,
            scrollStyle: 'height: ' + next + 'px;'
          })
        })
    }
    if (typeof wx.nextTick === 'function') wx.nextTick(runQuery)
    else setTimeout(runQuery, 16)
  },

  onLoad(options) {
    this._initNav()
    this.guessScrollPane()
    this._from = (options && options.from) || 'direct'
    this._productId = decodeQueryText((options && options.productId) || '').trim()
    this._skuId = decodeQueryText((options && options.skuId) || '').trim()
    this._contactId = decodeQueryText((options && options.contactId) || '').trim()
    const count = parseInt((options && options.count) || '1', 10)
    this.setData({ count: count > 0 ? count : 1 })
    // 与藏品读取并行取会员等级：谁先回来都会各自触发一次重算（见 _refreshMemberPayable）
    this._loadMemberStats()

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

  /**
   * 切到第 n 步。离开「写笺」时收笔、停试听；进入「写笺」时补上第 1 步点关系后待落的笔。
   * via 只进埋点：next / back / rail / edge / pay_check / refill
   */
  _goStep(step, via, opts) {
    const from = this.data.activeStep
    const to = Math.max(1, Math.min(2, Number(step) || 1))
    if (to === from) return
    const patch = { activeStep: to, maxStep: Math.max(this.data.maxStep || 1, to) }
    if (from === 2) {
      if (this.data.noteWriting) this.finishNoteWrite()
      this._stopVoicePreview()
      patch.cardFocused = false
      if (to !== 2) patch.recipientEditing = false
    }
    this.setData(patch)
    if (!(opts && opts.keepScroll)) {
      this.setData({ phoneScrollId: '' }, () => this.setData({ phoneScrollId: 'composeTop' }))
    }
    if (to === 2 && this._noteWritePending && this.data.noteWriting) this._scheduleNoteWrite()
    this.syncScrollPane()
    trackBehavior('gift_compose_step', 'product', this._productId || '', { from, to, via: via || '' })
  },

  /** 底栏「下一步」：第 1 步 → 写笺；第 2 步 → 确认页「交付与支付」（goPay 里校验写笺必填） */
  onStepNext() {
    if (this.data.activeStep >= 2) {
      this.goPay()
      return
    }
    this._goStep(2, 'next')
  },


  /** 步骤轨：只能点回已到过的步；第 3 格「交付与支付」= 去确认页（到过写笺才可点，同样先过写笺必填） */
  onRailTap(e) {
    const step = Number(e.currentTarget.dataset.step) || 0
    if (!step || step === this.data.activeStep) return
    if (step === 3) {
      if ((this.data.maxStep || 1) < 2) return
      if (this.data.activeStep !== 2) this._goStep(2, 'rail')
      this.goPay()
      return
    }
    if (step > (this.data.maxStep || 1)) return
    this._goStep(step, 'rail')
  },

  /** 左上返回（自定义顶栏）与左缘右滑（页面关了系统侧滑）同一口径：第 2 步回第 1 步，第 1 步离开；
   *  安卓实体返回键拦不住，仍直接离开 */
  onNavBack() {
    this._backOrLeave('nav')
  },

  onEdgeBack() {
    this._backOrLeave('edge')
  },

  _backOrLeave(via) {
    if (this.data.activeStep > 1) {
      this._goStep(this.data.activeStep - 1, via)
      return
    }
    this.leaveCompose()
  },

  onHide() {
    if (this.data.noteWriting) this.finishNoteWrite()
    else this.clearNoteWriteTimer()
    this._abortVoiceHold(true)
    this._stopVoicePreview()
  },

  onUnload() {
    this.clearNoteWriteTimer()
    textFx.destroySfx()
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
      }
      /**
       * 原「已取消」提示（`wx.showToast`）已移除：`check:dialog-ratchet` 是**只许降**的棘轮，
       * 而 main 上这个文件比冻结基线多了 1 处原生弹窗（1960 → 1961）→ 整条 CI 变红、
       * Pages 的 deploy（needs: verify）因此不执行。
       * 选它移除是因为**代价最小**：取消录音时按钮状态本身已重置（上面那行 setData），
       * 用户仍有视觉反馈；其余 17 处承载的是错误或必要提示，不动。
       */
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
      // 门店自取开关：关闭时默认交付回落「邀请 TA 填写地址」
      const pickupEnabled = flags.showStorePickup !== false
      const deliveryPatch = { storePickupEnabled: pickupEnabled }
      if (!pickupEnabled && this.data.deliveryType === 'store_pickup') {
        deliveryPatch.deliveryType = 'invite_address'
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
      await this.loadGiftDefaults()
      trackBehavior('gift_compose_enter', 'product', this._productId, {
        from: this._from,
        deliveryType: this.data.deliveryType || 'invite_address'
      })
      setTimeout(() => this.syncScrollPane(), 120)
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
      // 备妥应付 = 当前等级会员价（displayPrice 落定后立刻重算）
      this._refreshMemberPayable()
      // 主内容挂载后再量一次高度（allowed&&product 分支刚出现）
      setTimeout(() => this.syncScrollPane(), 40)
      // 场景选中后默认礼笺语向（正文为空时自动落笔；不碰录音）。题记另作叠加层，不占正文
      this._maybeApplySceneNote()
    } catch (e) {
      console.warn('gift compose loadProduct', e)
      this.setData({ loading: false, loadError: '柜中片刻未应，请稍后再试' })
    }
  },

  /**
   * 取当前会员等级（**只取一次**；失败即当无折扣，绝不猜等级）。
   * 口径与确认页 confirm-order:loadUserDiscount 同源：同一个 getUserStats 返回。
   */
  _loadMemberStats() {
    if (this._memberStats || this._memberStatsLoading) return
    this._memberStatsLoading = true
    wx.cloud.callFunction({
      name: 'getUserStats',
      success: (res) => {
        this._memberStatsLoading = false
        this._memberStats = (res && res.result) || null
        this._refreshMemberPayable()
      },
      fail: (err) => {
        this._memberStatsLoading = false
        // 未登录/网络失败 → 只显示原价（不显示折扣），不当成「已享折扣」
        console.warn('gift compose getUserStats', err && (err.errMsg || err))
      }
    })
  },

  /**
   * 重算「备妥应付」（裁决 46-a）。
   * 只按**当前等级**计价：本单可达等级（投影定级）需券/运费/自提参与口径，
   * 那是结算页的职责 → 故此处一律标注「以结算页为准」。
   */
  _refreshMemberPayable() {
    const p = this.data.product || {}
    const inputs = memberPayable.inputsFromStats(this._memberStats)
    const r = memberPayable.payableFor({
      amount: parseFloat(this.data.displayPrice) || 0,
      ladder: inputs.ladder,
      growthValue: inputs.growthValue,
      isHonorary: inputs.isHonorary,
      serverRate: inputs.serverRate,
      serverLevelName: inputs.serverLevelName,
      memberDiscountEnabled: p.memberDiscountEnabled !== false
    })
    this.setData({
      payablePrice: r.payable.toFixed(2),
      memberDiscounted: r.discounted,
      memberLevelName: r.levelName
    }, () => this.syncScrollPane())
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
      if (this.data.selfTreat) {
        this._deliveryBeforeSelf = deliveryType
        deliveryType = 'ship_to_self'
      }
      const patch = { deliveryType }
      // 超管运营开关：关闭后强制隐价，前端同时隐藏切换入口
      const allowToggle = result.allowHidePriceToggle !== false
      patch.allowHidePriceToggle = allowToggle
      if (!allowToggle) patch.hidePrice = true
      this.setData(patch)
    } catch (e) {
      /* 回落页面默认 invite_address */
    }
  },

  onCardInput(e) {
    if (this.data.noteWriting) this.finishNoteWrite()
    const cardBody = (e.detail && e.detail.value) || ''
    const patch = { cardBody }
    const activeId = this.data.activeNotePresetId
    if (activeId) {
      const preset = getPresetById(activeId)
      // 与**任一句候选**相同都算仍在使用该关系文案（多句候选后不能只比第一句）
      const bodies = (preset && Array.isArray(preset.bodies) && preset.bodies.length)
        ? preset.bodies
        : (preset ? [preset.body] : [])
      if (!preset || bodies.indexOf(cardBody) === -1) patch.activeNotePresetId = ''
    }
    this.setData(patch)
  },

  /** 点「手写体展示」区 → 唤起输入（textarea 只在聚焦时使用，见 wxml 注释） */
  focusCardInput() {
    this.setData({ cardFocused: true })
  },

  /** 失焦 → 回到手写体展示（iOS 的 textarea 不支持 font-family） */
  onCardBlur() {
    this.setData({ cardFocused: false })
  },

  onCardFocus() {
    if (!this.data.cardFocused) this.setData({ cardFocused: true })
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

  /** 打字机音效：懒建、失败不打断书写（照 receive/index.js 的既有模式） */
  /** 音效统一走共享件 giftTextEffect（音源 / 静音键 / 标点判断三页一处，避免三份漂移） */
  toggleSfxMute() {
    const next = !this.data.sfxMuted
    textFx.setMuted(next)
    this.setData({ sfxMuted: next })
    // 试听必须"放一小段就停"：敲击床是循环的，直接 playTick 会在没写字时一直响
    if (!next) textFx.previewTickSound(900)
    else textFx.stopTickSound()
  },

  clearNoteWriteTimer() {
    if (this._noteWriteTimer) {
      clearTimeout(this._noteWriteTimer)
      this._noteWriteTimer = null
    }
    // 收笔（或重开/离开）就把敲击床停掉：床是"书写期间连续响"的，不停会一直响下去
    textFx.stopTickSound()
  },

  /**
   * 结束落笔：立刻写出全文；清理 timer
   * 不覆盖已填受赠人名（关系标签与姓名并存）
   */
  finishNoteWrite() {
    this.clearNoteWriteTimer()
    this._noteWritePending = false
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
    // 标点不响：`_delayForChar` 已为标点单独留了停顿，那里一起静音更像真打字机
    textFx.playTick(this.data.sfxMuted)

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
      showWriteCursor: true,
      // 必填提示随关系走：犒劳自己时占位文案指向「你的昵称」，其余关系是「TA 的名字」（需求 9）
      recipientPlaceholder: preset.id === 'self' ? '你的昵称（也可改）' : 'TA 的名字（必填）'
    })

    // 需求 9：关系落到「犒劳自己」（self）→ 写给谁默认带出账号昵称。
    // 放在这里是因为**所有**落笔入口都走 startNoteWrite（点关系、换一句、场景语向之外的一致路径），
    // 只补空值、不覆盖用户已填的名字（沿用上面「关系标签不覆盖已填受赠人名」的既有规则）。
    if (preset.id === 'self') this.applyToSelfRecipientDefault()
    if (preset.id === 'self') this.enterSelfTreat()
    else if (this.data.selfTreat && getPresetById(preset.id)) this.exitSelfTreat()

    // 第 1 步点关系时礼笺还看不见：先记下，进第 2 步再落笔（免得在看不见的地方响打字声）
    if (this.data.activeStep !== 2) {
      this._noteWritePending = true
      return
    }
    this._scheduleNoteWrite()
  },

  _scheduleNoteWrite() {
    this._noteWritePending = false
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
    if (!preset) return
    const total = presetBodyCount(preset) || 1
    // 同一个关系再点一次 = 换一句（原来一关系只有一句，点几次都是同一段）
    const variant = (id === this.data.activeNotePresetId) ? (this.data.noteVariantIndex + 1) % total : 0
    this.requestNoteReplace(preset, variant, '用推荐文案替换当前内容？')
  },

  /** 「换一句」：在当前关系里往后翻一句（顾客原话：没有更新的标 → 现在既有按钮也有句序） */
  onNoteShuffle() {
    const preset = getPresetById(this.data.activeNotePresetId)
    if (!preset) {
      wx.showToast({ title: '先选一个关系', icon: 'none' })
      return
    }
    const total = presetBodyCount(preset) || 1
    if (total < 2) return
    this.requestNoteReplace(preset, (this.data.noteVariantIndex + 1) % total, '换一句新的推荐文案？')
  },

  /** 统一的「是否替换」判定：内容为空或与目标句相同 → 直接落笔；否则先确认 */
  requestNoteReplace(preset, variant, confirmContent) {
    if (!preset) return
    const body = pickPresetBody(preset, variant)
    if (!body) return
    const current = this.data.noteWriting && this._noteWriteTarget != null
      ? String(this._noteWriteTarget)
      : String(this.data.cardBody || '')
    if (!current.trim() || current === body) {
      this.applyNotePreset(preset, variant)
      return
    }
    wx.showModal({
      title: '替换礼笺？',
      content: confirmContent,
      confirmText: '替换',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) this.applyNotePreset(preset, variant)
      }
    })
  },

  applyNotePreset(preset, variant) {
    if (!preset) return
    const total = presetBodyCount(preset) || 1
    const index = (((Number(variant) || 0) % total) + total) % total
    const body = pickPresetBody(preset, index)
    if (!body) return
    this.setData({
      noteVariantIndex: index,
      noteVariantTotal: total,
      noteVariantLabel: total > 1 ? `${index + 1}/${total}` : ''
    })
    this.startNoteWrite(Object.assign({}, preset, { body }))
    trackBehavior('gift_note_preset', 'gift', preset.id, {
      label: preset.label,
      variant: index + 1
    })
  },

  /**
   * 「犒劳自己」时把受礼人默认写成账号昵称（需求 9）。
   * 一律不覆盖用户已经填过的名字 —— 默认值只在空的时候补。
   */
  applyToSelfRecipientDefault() {
    const current = String(this.data.recipientName || '').trim()
    if (current) return
    const nick = this._resolveAccountNickName()
    if (!nick) return
    this.setData({ recipientName: nick })
  },

  enterSelfTreat() {
    if (this.data.selfTreat) return
    this._deliveryBeforeSelf = this.data.deliveryType
    this.setData({
      selfTreat: true,
      deliveryType: 'ship_to_self'
    })
  },

  /** 换成其它关系，或点「其实是送给别人」→ 恢复送礼交付选择 */
  exitSelfTreat() {
    if (!this.data.selfTreat) return
    const prev = this._deliveryBeforeSelf
    const restore = prev && prev !== 'ship_to_self' && !(prev === 'store_pickup' && this.data.storePickupEnabled === false)
      ? prev
      : 'invite_address'
    const patch = { selfTreat: false, deliveryType: restore }
    if (this.data.activeNotePresetId === 'self') {
      patch.activeNotePresetId = ''
      patch.recipientPlaceholder = 'TA 的名字（必填）'
    }
    this.setData(patch)
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
   * 第 2 步「写笺」的必填（点「下一步 · 交付与支付」时校验，不通过不进确认页）
   */
  _checkLetter() {
    if (this.data.noteWriting) this.finishNoteWrite()
    if (this._giftRecorder && this._giftRecorder.isRecording()) {
      wx.showToast({ title: '请先结束录音', icon: 'none' })
      return false
    }
    // 需求 9：**受礼人姓名**必填。空则**不进入**确认订单，并当场聚焦到该输入框给提示。
    // 文案口径（产品负责人 2026-09-19 验收）：用「受礼人姓名」，不用「写给谁的名字」——与术语表「受礼人」一致。
    // 犒劳自己（self）时这里再兜一次默认昵称（用户可能没走关系点击的路径）。
    if (!String(this.data.recipientName || '').trim() && this.data.activeNotePresetId === 'self') {
      this.applyToSelfRecipientDefault()
    }
    if (!String(this.data.recipientName || '').trim()) {
      this.setData({ recipientEditing: true })
      this.showAppToast({ overline: 'RECIPIENT', title: '请务必填写受礼人姓名' })
      return false
    }
    const hasText = !!String(this.data.cardBody || '').trim()
    const hasVoice = !!(this.data.voiceFileID && this.data.voiceDuration > 0)
    if (!hasText && !hasVoice) {
      this.showAppToast({ overline: 'LETTER', title: '先写礼笺，或留下一段声音' })
      return false
    }
    return true
  },

  /**
   * 第 2 步「下一步 · 交付与支付」→ 确认页（§15：交付方式 / 地址 / 门店 / 领取核验都在确认页录入与校验）。
   * giftDraft = 上次在确认页填过的交付草稿（确认页返回时经 saveGiftDeliveryDraft 交回），再进入原样带回
   */
  goPay() {
    if (this.data.paying || this.data.voiceUploading) return
    if (this.data.activeStep !== 2) return
    const p = this.data.product
    if (!p || !p._id) {
      wx.showToast({ title: '藏品信息异常', icon: 'none' })
      return
    }
    if (!this._checkLetter()) return
    const selfTreat = !!this.data.selfTreat
    const draft = this._giftDeliveryDraft && this._giftDeliveryDraft.productId === p._id ? this._giftDeliveryDraft : null
    let deliveryType = selfTreat ? 'ship_to_self' : ((draft && !draft.selfTreat && draft.deliveryType) || this.data.deliveryType || 'invite_address')
    if (deliveryType === 'store_pickup' && this.data.storePickupEnabled === false) deliveryType = 'invite_address'
    const hasVoice = !!(this.data.voiceFileID && this.data.voiceDuration > 0)

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
      // 运费 v2（蓝图 §19）：判定只看 craftType
      craftType: p.craftType || '',
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
        storeId: '',
        storeName: '',
        phase: 'mvp'
      },
      giftDraft: { ...(draft || {}), productId: p._id, selfTreat, deliveryType }
    })

    setTimeout(() => this.setData({ paying: false }), 600)
  },

  /** 确认页（礼赠模式）离开时交回的交付草稿：下次「交付与支付」原样带回，来回不丢已填内容 */
  saveGiftDeliveryDraft(draft) {
    this._giftDeliveryDraft = draft && typeof draft === 'object' ? draft : null
  },

  /** 扫码 / 分享直达时页面栈只有这一页，navigateBack 无处可回 → 回馆藏 */
  leaveCompose() {
    const fallback = () => wx.switchTab({ url: '/pages/atelier/index' })
    if (getCurrentPages().length <= 1) {
      fallback()
      return
    }
    wx.navigateBack({ fail: fallback })
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
