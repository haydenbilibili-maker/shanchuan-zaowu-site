const { fetchContentDisplayFlags, toastLiveClosed } = require('../../../../utils/contentDisplayFlags')
const { getWindowInfo } = require('../../../../utils/systemInfo')
const { batchTempFileURLs, getFirstImage } = require('../../../../utils/util')
const { ensureOpenId, markCartDirty, fetchCartCount, updateCartTabBadge } = require('../../../../utils/cartHelper')
const { navigateToConfirmOrder } = require('../../../../utils/checkout')

const app = getApp()
const POLL_MS = 8000
const HEARTBEAT_MS = 20000
const MSG_POLL_MS = 5000
const MSG_MAX = 40

async function hydrateShelfItems(items) {
  const list = Array.isArray(items) ? items.slice() : []
  const urlMap = await batchTempFileURLs(list.map((i) => i && i.cover))
  return list.map((i) => {
    if (!i) return i
    const https = i.cover && urlMap[i.cover]
    const next = https ? { ...i, cover: https } : i
    const missingCover = !!(next.missingCover || !next.cover)
    const missingPrice = next.missingPrice != null
      ? !!next.missingPrice
      : !(Number.isFinite(Number(next.price)) && Number(next.price) > 0)
    return {
      ...next,
      missingCover,
      missingPrice,
      priceLabel: next.priceLabel || (missingPrice ? '价格待核' : `¥${next.price}${next.hasSku ? ' 起' : ''}`)
    }
  })
}

async function hydrateEndedReplay(stub) {
  if (!stub || !stub.coverUrl) return stub || null
  try {
    const urlMap = await batchTempFileURLs([stub.coverUrl])
    const https = urlMap[stub.coverUrl]
    return https ? { ...stub, coverUrl: https } : stub
  } catch (e) {
    return stub
  }
}

function emptyCopy(emptyCode, fallbackMsg, upcoming) {
  if (emptyCode === 'NOT_CONFIGURED') {
    return {
      title: '直播筹备中',
      msg: '推拉流服务尚未配置完成，暂时无法观看。请稍后再来。'
    }
  }
  if (emptyCode === 'FLAG_OFF') {
    return {
      title: '直播暂未开放',
      msg: '内容开关已关闭直播入口。'
    }
  }
  if (emptyCode === 'SCHEDULED' || (upcoming && upcoming.scheduledLabel)) {
    const when = (upcoming && upcoming.scheduledLabel) || ''
    return {
      title: (upcoming && upcoming.title) || '预约开播',
      msg: when
        ? `预约开播时间 ${when}${upcoming && upcoming.hostName ? ` · 主播 ${upcoming.hostName}` : ''}。开播后可从首页或分享卡片进入。`
        : (fallbackMsg || '本场尚未开播，请稍后再来。')
    }
  }
  if (emptyCode === 'ENDED') {
    return {
      title: '本场已结束',
      msg: '感谢收看。馆员再次开播后，首页会出现直播入口。'
    }
  }
  return {
    title: '此刻没有直播',
    msg: fallbackMsg || '馆员开播后，首页会出现直播入口，这里会显示实时画面。'
  }
}

function mapPlayerCode(code) {
  const map = {
    2001: { hint: '已连接服务器', level: '', signal: '连接中', on: false },
    2002: { hint: '开始拉流', level: '', signal: '连接中', on: false },
    2003: { hint: '', level: '', signal: '直播中', on: true },
    2004: { hint: '', level: '', signal: '直播中', on: true },
    2007: { hint: '缓冲中…', level: 'warn', signal: '缓冲', on: false },
    2103: { hint: '网络不稳，自动重连中…', level: 'warn', signal: '弱网', on: false },
    2104: { hint: '下行带宽不足，画面可能卡顿', level: 'warn', signal: '弱网', on: false },
    2105: { hint: '播放卡顿，正在追帧…', level: 'warn', signal: '卡顿', on: false },
    3001: { hint: '拉流 DNS 失败，请检查播放域名', level: 'err', signal: '异常', on: false },
    3002: { hint: '无法连接拉流服务器', level: 'err', signal: '异常', on: false },
    3005: { hint: '拉流读写失败，可点重新连接', level: 'err', signal: '异常', on: false },
    '-2301': { hint: '网络断连，请重新连接；若主播已下播将自动提示', level: 'err', signal: '断流', on: false },
    '-2302': { hint: '获取拉流地址失败', level: 'err', signal: '异常', on: false }
  }
  return map[String(code)] || null
}

Page({
  data: {
    statusBarHeight: 44,
    navBarHeight: 44,
    loading: true,
    blocked: false,
    blockedMsg: '',
    closedMidway: false,
    emptyMsg: '',
    emptyTitle: '此刻没有直播',
    emptyCode: '',
    upcoming: null,
    session: null,
    muted: false,
    playerHint: '',
    hintLevel: '',
    viewState: '',
    signalOn: false,
    signalLabel: 'LIVE',
    playerKey: 0,
    likeCount: 0,
    likeBusy: false,
    liked: false,
    viewerCount: 0,
    messages: [],
    draft: '',
    msgBusy: false,
    msgHint: '',
    shelfItems: [],
    shelfCount: 0,
    shelfPurchasable: false,
    spotlightItem: null,
    showShelf: false,
    shelfBusyId: '',
    reminded: false,
    remindBusy: false,
    remindSubscribe: null,
    orientTip: '',
    endedReplay: null,
    showSkuSheet: false,
    skuAction: '',
    skuProduct: null,
    skuOptions: [],
    selectedSkuId: '',
    selectedSku: null,
    msgScrollInto: ''
  },

  onLoad(options) {
    const win = getWindowInfo()
    const menu = wx.getMenuButtonBoundingClientRect()
    const sessionId = String((options && (options.sessionId || options.id)) || '').trim()
    this._entrySessionId = sessionId
    this.setData({
      statusBarHeight: win.statusBarHeight || 44,
      navBarHeight: (menu.height || 32) + ((menu.top || 0) - (win.statusBarHeight || 0)) * 2
    })
    this._hadSession = false
    this._noticeAt = 0
    this._leaving = false
    this._flagToastShown = false
    this.reload()
    this.checkOrientation()
  },

  onShow() {
    if (!this.data.loading && !this.data.blocked && !this.data.closedMidway) {
      this.reload({ soft: true })
    }
    this.startPoll()
    this.startHeartbeat()
    this.startMsgPoll()
  },

  onHide() {
    this.stopPoll()
    this.stopHeartbeat()
    this.stopMsgPoll()
  },

  onUnload() {
    this.stopPoll()
    this.stopHeartbeat()
    this.stopMsgPoll()
  },

  onShareAppMessage() {
    const session = this.data.session
    const upcoming = this.data.upcoming
    const id = (session && session._id) || (upcoming && upcoming._id) || this._entrySessionId || ''
    const title = (session && session.title) || (upcoming && upcoming.title) || '山海造物 · 馆内直播'
    const imageUrl = (session && session.coverUrl) || (upcoming && upcoming.coverUrl) || ''
    const path = id
      ? `/subpackages/feature/live/watch/index?sessionId=${encodeURIComponent(id)}`
      : '/subpackages/feature/live/watch/index'
    const share = { title, path }
    if (imageUrl && /^https:\/\//i.test(imageUrl)) share.imageUrl = imageUrl
    return share
  },

  startPoll() {
    this.stopPoll()
    this._pollTimer = setInterval(() => {
      if (this.data.blocked || this.data.closedMidway || this.data.loading) return
      this.reload({ soft: true, fromPoll: true })
    }, POLL_MS)
  },

  stopPoll() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  },

  startHeartbeat() {
    this.stopHeartbeat()
    const tick = () => {
      if (!this.data.session || !this.data.session.pullUrl) return
      if (this.data.blocked || this.data.closedMidway || this.data.viewState === 'ended') return
      this.sendHeartbeat()
    }
    tick()
    this._hbTimer = setInterval(tick, HEARTBEAT_MS)
  },

  stopHeartbeat() {
    if (this._hbTimer) {
      clearInterval(this._hbTimer)
      this._hbTimer = null
    }
  },

  startMsgPoll() {
    this.stopMsgPoll()
    const tick = () => {
      if (!this.data.session || !this.data.session.pullUrl) return
      if (this.data.blocked || this.data.closedMidway) return
      this.loadMessages({ soft: true })
    }
    tick()
    this._msgTimer = setInterval(tick, MSG_POLL_MS)
  },

  stopMsgPoll() {
    if (this._msgTimer) {
      clearInterval(this._msgTimer)
      this._msgTimer = null
    }
  },

  async sendHeartbeat() {
    const session = this.data.session
    if (!session || !session._id) return
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'heartbeat', sessionId: session._id }
      })
      const result = (res && res.result) || {}
      if (result.code === 'FLAG_OFF') {
        this.applyFlagClosed({ soft: true })
        return
      }
      if (result.success) {
        this.setData({
          viewerCount: Math.max(0, Number(result.viewerCount) || 0),
          likeCount: Math.max(this.data.likeCount, Number(result.likeCount) || 0)
        })
      }
    } catch (e) {
      /* ignore heartbeat errors */
    }
  },

  async loadMessages(opts) {
    const session = this.data.session
    if (!session || !session._id) return
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'listMessages', sessionId: session._id }
      })
      const result = (res && res.result) || {}
      if (result.enabled === false) {
        this.applyFlagClosed({ soft: !!(opts && opts.soft) })
        return
      }
      const list = Array.isArray(result.list) ? result.list : []
      const sliced = list.slice(-MSG_MAX)
      this.setData({
        messages: sliced,
        msgScrollInto: sliced.length ? `msg-${sliced.length - 1}` : ''
      })
    } catch (e) {
      /* ignore */
    }
  },

  applyFlagClosed(opts) {
    const soft = !!(opts && opts.soft)
    const wasWatching = !!(this._hadSession || (this.data.session && this.data.session.pullUrl))
    this._hadSession = false
    this.stopHeartbeat()
    this.stopMsgPoll()
    if (wasWatching && soft) {
      this.setData({
        loading: false,
        blocked: false,
        closedMidway: true,
        session: null,
        viewState: '',
        signalOn: false,
        messages: [],
        shelfPurchasable: false,
        showShelf: false,
        emptyCode: 'FLAG_OFF'
      })
      return
    }
    this.setData({
      loading: false,
      blocked: true,
      closedMidway: false,
      blockedMsg: '内容开关已关闭直播入口',
      session: null,
      viewState: '',
      signalOn: false,
      messages: [],
      shelfPurchasable: false,
      showShelf: false,
      emptyCode: 'FLAG_OFF'
    })
    if (!soft && !this._flagToastShown) {
      this._flagToastShown = true
      toastLiveClosed()
    }
  },

  noop() {},

  checkOrientation() {
    try {
      const win = getWindowInfo()
      const w = win.windowWidth || 0
      const h = win.windowHeight || 0
      if (w > h + 40) {
        this.setData({ orientTip: '建议竖屏观看，横屏下挂车与留言区域较挤' })
      } else {
        this.setData({ orientTip: '' })
      }
    } catch (e) {
      this.setData({ orientTip: '' })
    }
  },

  dismissOrientTip() {
    this.setData({ orientTip: '' })
  },

  async onRemindMe() {
    if (this.data.remindBusy) return
    const upcoming = this.data.upcoming
    if (!upcoming || !upcoming._id) {
      wx.showToast({ title: '暂无可预约场次', icon: 'none' })
      return
    }
    this.setData({ remindBusy: true })
    try {
      const sub = this.data.remindSubscribe || {}
      let subscribeAccepted = false
      if (!this.data.reminded && sub.configured && sub.templateId) {
        try {
          const auth = await wx.requestSubscribeMessage({ tmplIds: [sub.templateId] })
          const st = auth && auth[sub.templateId]
          subscribeAccepted = st === 'accept'
        } catch (e) {
          /* 用户拒绝仍可登记 */
        }
      } else if (!this.data.reminded && !(sub && sub.configured)) {
        wx.showToast({
          title: '模板待审：先登记，配置后可微信通知',
          icon: 'none',
          duration: 2200
        })
      }
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: {
          action: this.data.reminded ? 'cancelReminder' : 'registerReminder',
          sessionId: upcoming._id,
          subscribeAccepted
        }
      })
      const result = (res && res.result) || {}
      if (!result.success && !result.already) {
        wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
        return
      }
      const next = result.reminded != null ? !!result.reminded : !this.data.reminded
      this.setData({ reminded: next })
      wx.showToast({
        title: next
          ? (subscribeAccepted ? '已授权并登记开播提醒' : '已登记提醒')
          : '已取消提醒',
        icon: 'none'
      })
    } catch (e) {
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ remindBusy: false })
    }
  },

  async applyShelfFromSession(session) {
    const shelf = (session && session.shelf) || {}
    const items = await hydrateShelfItems(shelf.items || [])
    const spotlightId = shelf.spotlightProductId || ''
    const spotlightItem = items.find((i) => i && (i.spotlight || i._id === spotlightId)) || null
    this.setData({
      shelfItems: items,
      shelfCount: items.length,
      shelfPurchasable: !!shelf.purchasable,
      spotlightItem
    })
  },

  openShelf() {
    if (!this.data.shelfCount) {
      wx.showToast({ title: '本场暂无挂车藏品', icon: 'none' })
      return
    }
    this.setData({ showShelf: true })
  },

  closeShelf() {
    this.setData({ showShelf: false })
  },

  assertShelfPurchasable() {
    if (this.data.closedMidway || this.data.blocked || this.data.viewState === 'ended') {
      wx.showToast({ title: '直播已结束，无法购买', icon: 'none' })
      return false
    }
    if (!this.data.shelfPurchasable) {
      wx.showToast({ title: '挂车暂不可购（直播已结束或入口关闭）', icon: 'none' })
      return false
    }
    return true
  },

  onShelfDetail(e) {
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/subpackages/feature/detail/index?id=${id}&from=live`,
      fail: () => wx.showToast({ title: '无法打开详情', icon: 'none' })
    })
  },

  async onShelfAddCart(e) {
    if (!this.assertShelfPurchasable()) return
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
    const item = (this.data.shelfItems || []).find((p) => p && p._id === id)
    if (!item) return
    if (!item.buyable) {
      wx.showToast({ title: item.soldOut ? '已售罄' : '已下架', icon: 'none' })
      return
    }
    if (item.hasSku) {
      this.openSkuSheet(item, 'cart')
      return
    }
    await this.commitShelfCart(item, null)
  },

  onShelfBuyNow(e) {
    if (!this.assertShelfPurchasable()) return
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
    const item = (this.data.shelfItems || []).find((p) => p && p._id === id)
    if (!item) return
    if (!item.buyable) {
      wx.showToast({ title: item.soldOut ? '已售罄' : '已下架', icon: 'none' })
      return
    }
    if (item.hasSku) {
      this.openSkuSheet(item, 'buy')
      return
    }
    this.commitShelfBuy(item, null)
  },

  openSkuSheet(item, action) {
    const skus = (item.skus || []).filter((s) => s && s.id)
    if (!skus.length) {
      wx.showToast({ title: '暂无可用规格', icon: 'none' })
      return
    }
    const firstAvail = skus.find((s) => (s.stock || 0) > 0) || skus[0]
    this.setData({
      showSkuSheet: true,
      skuAction: action === 'buy' ? 'buy' : 'cart',
      skuProduct: item,
      skuOptions: skus,
      selectedSkuId: firstAvail.id,
      selectedSku: firstAvail
    })
  },

  closeSkuSheet() {
    this.setData({
      showSkuSheet: false,
      skuAction: '',
      skuProduct: null,
      skuOptions: [],
      selectedSkuId: '',
      selectedSku: null
    })
  },

  onSelectSku(e) {
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
    const sku = (this.data.skuOptions || []).find((s) => s && s.id === id)
    if (!sku) return
    if ((sku.stock || 0) <= 0) {
      wx.showToast({ title: '该规格已售罄', icon: 'none' })
      return
    }
    this.setData({ selectedSkuId: sku.id, selectedSku: sku })
  },

  async confirmSkuSheet() {
    if (!this.assertShelfPurchasable()) return
    const item = this.data.skuProduct
    const sku = this.data.selectedSku
    if (!item || !sku) {
      wx.showToast({ title: '请选择规格', icon: 'none' })
      return
    }
    if ((sku.stock || 0) <= 0) {
      wx.showToast({ title: '该规格已售罄', icon: 'none' })
      return
    }
    const action = this.data.skuAction
    this.closeSkuSheet()
    if (action === 'buy') this.commitShelfBuy(item, sku)
    else await this.commitShelfCart(item, sku)
  },

  async commitShelfCart(item, sku) {
    if (this.data.shelfBusyId) return
    this.setData({ shelfBusyId: item._id })
    try {
      const openid = await ensureOpenId(app)
      if (!openid) {
        wx.showToast({ title: '登录中，请稍后重试', icon: 'none' })
        return
      }
      const res = await wx.cloud.callFunction({
        name: 'toggleCollection',
        data: {
          targetId: item._id,
          type: 'product',
          action: 'add',
          skuId: sku ? sku.id : '',
          skuLabel: sku ? sku.specLabel : '',
          snapshot: {
            title: item.title,
            image: (sku && sku.image) || item.cover || getFirstImage([]),
            price: sku ? sku.price : item.price,
            latinName: item.latinName || '',
            skuLabel: sku ? sku.specLabel : '',
            count: 1,
            isTreasure: !!item.isTreasure,
            isUnique: !!item.isUnique
          }
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '加入失败', icon: 'none' })
        return
      }
      markCartDirty(app)
      const cartCount = await fetchCartCount(app)
      updateCartTabBadge(cartCount)
      wx.showToast({ title: '已加入购物车', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ shelfBusyId: '' })
    }
  },

  commitShelfBuy(item, sku) {
    navigateToConfirmOrder(
      [{
        productId: item._id,
        skuId: sku ? sku.id : '',
        skuLabel: sku ? sku.specLabel : '',
        count: 1,
        title: item.title,
        image: (sku && sku.image) || item.cover,
        price: sku ? sku.price : item.price,
        latinName: item.latinName || '',
        isTreasure: !!item.isTreasure,
        isUnique: !!item.isUnique,
        memberDiscountEnabled: item.memberDiscountEnabled !== false,
        categoryType: item.categoryType || ''
      }],
      { source: 'live' }
    )
  },

  async onNavBack() {
    if (this._leaving) return
    if (this.data.session && this.data.session.pullUrl && this.data.viewState !== 'ended') {
      const ok = await new Promise((resolve) => {
        wx.showModal({
          title: '离开直播间？',
          content: '当前正在观看馆内直播，确定返回吗？',
          success: (r) => resolve(!!r.confirm),
          fail: () => resolve(false)
        })
      })
      if (!ok) return
    }
    this._leaving = true
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/index/index' })
    })
  },

  async reload(opts) {
    const soft = !!(opts && opts.soft)
    if (!soft) {
      this.setData({
        loading: true,
        blocked: false,
        closedMidway: false,
        playerHint: '',
        hintLevel: '',
        viewState: ''
      })
    }
    try {
      const { flags } = await fetchContentDisplayFlags()
      if (!flags.showLive) {
        this.applyFlagClosed({ soft })
        return
      }

      const sessionId = this._entrySessionId || (this.data.session && this.data.session._id) || ''
      const action = sessionId ? 'getSession' : 'getActive'
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action, sessionId }
      })
      const result = (res && res.result) || {}

      if (result.session && result.session.pushUrl) {
        delete result.session.pushUrl
      }

      if (result.enabled === false) {
        this.applyFlagClosed({ soft })
        return
      }

      const session = result.session || null
      const upcoming = result.upcoming || null

      if (session && session.pullUrl) {
        const noticeAt = Number(session.noticeUpdatedAt) || 0
        const noticeChanged = noticeAt && noticeAt !== this._noticeAt
        this._noticeAt = noticeAt
        this._hadSession = true
        if (session._id) this._entrySessionId = session._id
        const patch = {
          loading: false,
          blocked: false,
          closedMidway: false,
          session,
          upcoming: null,
          viewState: '',
          emptyCode: '',
          endedReplay: null,
          remindSubscribe: result.remindSubscribe || this.data.remindSubscribe,
          likeCount: Math.max(0, Number(session.likeCount) || 0),
          viewerCount: Math.max(0, Number(session.viewerCount) || this.data.viewerCount || 0),
          signalOn: this.data.signalOn,
          signalLabel: this.data.signalOn ? '直播中' : '连接中'
        }
        if (noticeChanged && soft && session.notice) {
          patch.playerHint = '公告已更新'
          patch.hintLevel = ''
        }
        this.setData(patch)
        this.applyShelfFromSession(session)
        if (!soft) {
          this.startHeartbeat()
          this.startMsgPoll()
        }
        return
      }

      if (result.ended || result.emptyCode === 'ENDED' || this._hadSession || (opts && opts.fromPoll && this.data.session)) {
        const rawEnded = result.endedReplay || this.data.endedReplay || (this.data.session
          ? {
            _id: this.data.session._id,
            title: this.data.session.title,
            coverUrl: this.data.session.coverUrl,
            hostName: this.data.session.hostName,
            replayReady: false,
            replayHint: '回放筹备中，本场封面可供回顾'
          }
          : null)
        const endedReplay = await hydrateEndedReplay(rawEnded)
        this._hadSession = false
        this.setData({
          loading: false,
          blocked: false,
          closedMidway: false,
          session: null,
          upcoming: null,
          viewState: 'ended',
          endedReplay,
          remindSubscribe: result.remindSubscribe || this.data.remindSubscribe,
          signalOn: false,
          playerHint: '',
          liked: false,
          messages: [],
          shelfItems: [],
          shelfCount: 0,
          shelfPurchasable: false,
          spotlightItem: null,
          showShelf: false,
          showSkuSheet: false
        })
        this.stopHeartbeat()
        this.stopMsgPoll()
        return
      }

      const copy = emptyCopy(result.emptyCode, result.msg, upcoming)
      const endedReplay = await hydrateEndedReplay(result.endedReplay || null)
      this.setData({
        loading: false,
        blocked: false,
        closedMidway: false,
        session: null,
        upcoming,
        endedReplay,
        reminded: !!result.reminded,
        remindSubscribe: result.remindSubscribe || null,
        viewState: '',
        emptyCode: result.emptyCode || '',
        emptyTitle: copy.title,
        emptyMsg: copy.msg,
        signalOn: false,
        messages: []
      })
    } catch (e) {
      console.warn('live watch reload', e)
      this.setData({
        loading: false,
        session: null,
        emptyTitle: '加载失败',
        emptyMsg: '请检查网络后重试',
        emptyCode: 'ERROR'
      })
    }
  },

  toggleMute() {
    this.setData({ muted: !this.data.muted })
  },

  onDraftInput(e) {
    this.setData({ draft: ((e.detail && e.detail.value) || '').slice(0, MSG_MAX) })
  },

  async sendMessage() {
    if (this.data.msgBusy) return
    const text = String(this.data.draft || '').trim()
    if (!text) {
      wx.showToast({ title: '请输入留言', icon: 'none' })
      return
    }
    if (!this.data.session || !this.data.session._id) return
    this.setData({ msgBusy: true, msgHint: '' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: {
          action: 'postMessage',
          sessionId: this.data.session._id,
          text
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        if (result.code === 'FLAG_OFF') {
          this.applyFlagClosed({ soft: true })
          return
        }
        this.setData({ msgHint: result.msg || '发送失败' })
        wx.showToast({ title: result.msg || '发送失败', icon: 'none' })
        return
      }
      const msg = result.message
      const messages = (this.data.messages || []).concat(msg ? [msg] : []).slice(-MSG_MAX)
      this.setData({
        draft: '',
        messages,
        msgHint: '',
        msgScrollInto: messages.length ? `msg-${messages.length - 1}` : ''
      })
    } catch (e) {
      wx.showToast({ title: '发送失败', icon: 'none' })
    } finally {
      this.setData({ msgBusy: false })
    }
  },

  async onLike() {
    if (this.data.likeBusy || this.data.liked) return
    if (!this.data.session || !this.data.session.pullUrl) return
    this.setData({ likeBusy: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'like' }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        if (result.code === 'FLAG_OFF') {
          this.applyFlagClosed({ soft: true })
          return
        }
        if (result.code === 'LIKED') {
          this.setData({
            liked: true,
            likeCount: Math.max(this.data.likeCount, Number(result.likeCount) || 0)
          })
          wx.showToast({ title: '本场已点过赞', icon: 'none' })
          return
        }
        wx.showToast({ title: result.msg || '点赞失败', icon: 'none' })
        return
      }
      this.setData({
        liked: true,
        likeCount: Math.max(this.data.likeCount, Number(result.likeCount) || 0),
        viewerCount: Math.max(this.data.viewerCount, Number(result.viewerCount) || 0)
      })
    } catch (e) {
      wx.showToast({ title: '点赞失败', icon: 'none' })
    } finally {
      this.setData({ likeBusy: false })
    }
  },

  reconnect() {
    const session = this.data.session
    if (!session || !session.pullUrl) {
      this.reload()
      return
    }
    this.setData({
      playerHint: '正在重新连接…',
      hintLevel: 'warn',
      signalOn: false,
      signalLabel: '重连中',
      session: { ...session, pullUrl: '' }
    })
    setTimeout(() => {
      this.setData({
        session,
        playerKey: (this.data.playerKey || 0) + 1
      })
      this.reload({ soft: true })
    }, 220)
  },

  onPlayerState(e) {
    const code = e && e.detail && e.detail.code
    const mapped = mapPlayerCode(code)
    if (!mapped) return
    this.setData({
      signalOn: !!mapped.on,
      signalLabel: mapped.signal,
      playerHint: mapped.hint,
      hintLevel: mapped.level || ''
    })
    if (code === -2301) {
      this.reload({ soft: true, fromPoll: true })
    }
  },

  onPlayerError(e) {
    console.warn('live-player error', e)
    this.setData({
      signalOn: false,
      signalLabel: '异常',
      playerHint: '播放异常：请确认播放域名 HTTPS / 小程序合法域名，或点击重新连接',
      hintLevel: 'err'
    })
  }
})
