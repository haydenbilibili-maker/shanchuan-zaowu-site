/**
 * 博物君 · 山海造物标本馆的 AI 馆员（2026-11-23）
 * 蓝图：miniprogram/docs/博物君_AI馆员_蓝图_2026-11-23.md
 * 纯函数在 guideChat.js（守卫 test:museum-guide）；云函数 askMuseumGuide。
 */
const G = require('./guideChat')
const N = require('./naturalist')
const { openAppModal } = require('../../../utils/appModal')
const { thumbUrl } = require('../../../utils/imageUrl')

const app = getApp()

Page({
  data: {
    messages: [],
    starters: G.startersFor(),
    /** 开场问题卡（两列，科普置顶）与输入框里的示例（2026-11-23 页面优化） */
    starterCards: G.starterCards(),
    placeholderQ: G.starterCards()[0].q,
    /** 往上翻远了才出「回到最新」 */
    showJump: false,
    hasAsked: false,
    draft: '',
    sending: false,
    quota: null,
    quotaText: '',
    /** 超管工作台闭馆（2026-11-23）：开场问题与输入条收起，只留一句说明 */
    closed: false,
    closedText: '',
    scrollTo: '',
    questionMax: G.QUESTION_MAX
  },

  onLoad(options) {
    this._openid = (app && app.globalData && app.globalData.openid) || ''
    let stored = []
    try { stored = G.fromStored(wx.getStorageSync(G.storeKey(this._openid))) } catch (e) { stored = [] }
    const welcome = G.makeMessage('guide', G.WELCOME, { isWelcome: true })
    this.setData({ messages: [welcome].concat(stored), hasAsked: stored.some((m) => m.role === 'user') }, () => this.scrollToEnd())
    this._from = ['user', 'atlas', 'identify', 'share', 'daily', 'quiz', 'notes', 'workshop', 'home'].indexOf(options && options.from) >= 0 ? options.from : 'direct'
    this.loadStatus()
    // 带着问题进来（AI 鉴定结果 / 图鉴页「问问博物君」）：auto=1 直接发问，否则只预填
    const q = G.entryQuestion(options)
    if (q && options.auto === '1') this.ask(q)
    else if (q) this.setData({ draft: q })
    // 埋点（打开 / 提问 / 去处）待产品负责人点名后登记进埋点双端 schema 再接（稳定期共享件，见蓝图 §5）
  },

  /** 进页取一次状态：开没开、今天还剩几问（不计次） */
  async loadStatus() {
    let v
    try {
      const res = await wx.cloud.callFunction({ name: 'askMuseumGuide', data: { action: 'status' } })
      v = G.statusView(res && res.result)
    } catch (e) {
      v = G.statusView(null)
    }
    const patch = { closed: v.closed, closedText: v.closedText }
    if (v.quota && !this.data.quota) Object.assign(patch, { quota: v.quota, quotaText: G.quotaText(v.quota) })
    this.setData(patch)
  },

  onShareAppMessage() {
    return { title: '博物君 · 山海造物标本馆的馆员', path: '/subpackages/feature/museum-guide/index?from=share' }
  },

  /* ------------------------------ 输入 ------------------------------ */

  onDraftInput(e) {
    this.setData({ draft: e.detail.value })
  },

  onSend() {
    this.ask(this.data.draft)
  },

  onTapStarter(e) {
    this.ask(e.currentTarget.dataset.q)
  },

  onTapFollowUp(e) {
    this.ask(e.currentTarget.dataset.q)
  },

  /* ------------------------------ 提问 ------------------------------ */

  async ask(raw) {
    if (this.data.sending || this.data.closed) return
    // 上一条还在逐字写：先写完再问
    if (this._revealTimer && this._revealIndex >= 0) this.finishReveal(this._revealIndex)
    const c = G.cleanQuestion(raw)
    if (c.error) return
    const history = G.historyForRequest(this.data.messages)
    const userMsg = G.makeMessage('user', c.question)
    const pending = G.makeMessage('guide', '', { pending: true })
    // 上一条回答的追问 / 去处在新问题发出后收起（只在最新一条上出现）
    const prev = this.data.messages.map((m) => (m.followUps && m.followUps.length) || (m.actions && m.actions.length) ? Object.assign({}, m, { followUps: [], actions: [] }) : m)
    this.setData({ messages: prev.concat(userMsg, pending), draft: '', sending: true, hasAsked: true }, () => this.scrollToEnd())

    let reply
    try {
      const res = await wx.cloud.callFunction({ name: 'askMuseumGuide', data: { question: c.question, history, from: this._from || 'direct' } })
      reply = G.replyToMessage(res && res.result)
    } catch (err) {
      const type = G.isNotDeployed(err) ? 'not_deployed' : 'network'
      reply = { message: G.makeMessage('guide', G.ERROR_COPY[type], { isError: true, errorType: type }), quota: null }
    }
    const messages = this.data.messages.filter((m) => !m.pending).concat(reply.message)
    const quota = reply.quota || this.data.quota
    // 提问时才发现已闭馆（进页后超管刚关）：收起输入条
    if (reply.message.errorType === 'off') this.setData({ closed: true, closedText: reply.message.text })
    this.persist(messages)
    // 新回答逐字出来（错误提示直接出）；写完前追问 / 去处 / 图鉴链接先不出
    if (!reply.message.isError) {
      const last = messages.length - 1
      messages[last] = Object.assign({}, reply.message, { shown: '', revealing: true })
      this.setData({ messages, sending: false, quota, quotaText: G.quotaText(quota) }, () => this.startReveal(last))
    } else {
      this.setData({ messages, sending: false, quota, quotaText: G.quotaText(quota) }, () => this.scrollToEnd())
    }
  },

  /* ------------------------------ 逐字显示 ------------------------------ */

  startReveal(index) {
    this.stopReveal()
    const msg = this.data.messages[index]
    if (!msg) return
    const steps = G.revealSteps(msg.text.length)
    let i = 0
    const tick = () => {
      const cur = this.data.messages[index]
      if (!cur || cur.id !== msg.id) return this.stopReveal()
      i += 1
      if (i >= steps.length) return this.finishReveal(index)
      this.setData({ [`messages[${index}].shown`]: msg.text.slice(0, steps[i - 1]) })
      if (i % 8 === 0) this.scrollToEnd()
    }
    this._revealTimer = setInterval(tick, G.REVEAL_TICK_MS)
    this._revealIndex = index
  },

  /** 写完（或点气泡跳过）：整段显示，追问 / 去处 / 图鉴链接出现 */
  finishReveal(index) {
    this.stopReveal()
    const cur = this.data.messages[index]
    if (!cur || !cur.revealing) return
    this.setData({ [`messages[${index}].shown`]: cur.text, [`messages[${index}].revealing`]: false }, () => this.scrollToEnd())
    this.loadGoods(index)
  },

  /**
   * 「馆里有这件」：回答写完后，按点到的第一种图鉴物种查馆藏（只读 getEncyclopediaFeed）；
   * 查不到 / 查失败都不出这一栏。只挂在当场这条回答上，不进本机存储。
   */
  async loadGoods(index) {
    const msg = this.data.messages[index]
    const q = msg && !msg.isError && G.goodsQuery(msg.species)
    if (!q) return
    let rows = []
    try {
      const res = await wx.cloud.callFunction({ name: 'getEncyclopediaFeed', data: q })
      rows = (res && res.result && res.result.orphanProducts) || []
    } catch (e) { return }
    const goods = G.goodsCards(rows, (u) => (u ? thumbUrl(u) : ''))
    const cur = this.data.messages[index]
    if (!goods.length || !cur || cur.id !== msg.id) return
    this.setData({ [`messages[${index}].goods`]: goods })
  },

  onTapGoods(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/subpackages/feature/detail/index?id=${encodeURIComponent(id)}` })
  },

  stopReveal() {
    if (this._revealTimer) clearInterval(this._revealTimer)
    this._revealTimer = null
  },

  /* ------------------------------ 反馈 / 复制 ------------------------------ */

  /** 有帮助 / 没帮助：只投一次；先在本机标上（不等云端），云端失败也不打扰 */
  async onVote(e) {
    const index = Number(e.currentTarget.dataset.index)
    const vote = e.currentTarget.dataset.vote === 'down' ? 'down' : 'up'
    const msg = this.data.messages[index]
    if (!msg || !msg.logId || msg.vote) return
    this.setData({ [`messages[${index}].vote`]: vote })
    this.persist(this.data.messages)
    try {
      await wx.cloud.callFunction({ name: 'askMuseumGuide', data: { action: 'feedback', logId: msg.logId, vote } })
    } catch (err) { /* 反馈没送到只影响报表，不打扰提问的人 */ }
  },

  /** 对话之外的三件工具（今日一物 / 博物小测 / 博物笔记） */
  onTool(e) {
    const url = e.currentTarget.dataset.url
    if (url) wx.navigateTo({ url })
  },

  /** 收藏这条回答进「博物笔记」（连同它回答的那个问题；同一段不重复收） */
  onSave(e) {
    const index = Number(e.currentTarget.dataset.index)
    const msg = this.data.messages[index]
    if (!msg || !msg.text || msg.saved) return
    const prev = this.data.messages[index - 1]
    const key = this._openid ? `museum_guide_notes_v1_${this._openid}` : 'museum_guide_notes_v1'
    let notes = []
    try { notes = wx.getStorageSync(key) || [] } catch (err) { notes = [] }
    notes = N.addNote(notes, { q: prev && prev.role === 'user' ? prev.text : '', a: msg.text }, Date.now())
    try { wx.setStorageSync(key, notes) } catch (err) { /* 存不下就算了 */ }
    this.setData({ [`messages[${index}].saved`]: true })
    this.persist(this.data.messages)
  },

  onCopy(e) {
    const msg = this.data.messages[Number(e.currentTarget.dataset.index)]
    if (!msg || !msg.text) return
    wx.setClipboardData({ data: msg.text })
  },

  /** 点正在写的气泡：直接写完 */
  onTapBubble(e) {
    const index = Number(e.currentTarget.dataset.index)
    const cur = this.data.messages[index]
    if (cur && cur.revealing) this.finishReveal(index)
  },

  onUnload() {
    this.stopReveal()
  },

  persist(messages) {
    try { wx.setStorageSync(G.storeKey(this._openid), G.toStored(messages)) } catch (e) { /* 存不下只影响下次回看 */ }
  },

  scrollToEnd() {
    this.setData({ scrollTo: '' }, () => this.setData({ scrollTo: 'mg-end' }))
  },

  /** 滚动：离底部超过约一屏才亮「回到最新」；状态不变不 setData（滚动事件很密） */
  onScroll(e) {
    const d = (e && e.detail) || {}
    if (!this._winH) {
      try { this._winH = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowHeight || 667 } catch (err) { this._winH = 667 }
    }
    const far = (d.scrollHeight || 0) - (d.scrollTop || 0) - this._winH > this._winH
    if (far !== this.data.showJump) this.setData({ showJump: far })
  },

  onJump() {
    this.setData({ showJump: false })
    this.scrollToEnd()
  },

  /* ------------------------------ 去处 / 清空 ------------------------------ */

  /** 回答里提到的图鉴物种 → 图鉴那一页（未翻开的页由详情页自己显示空页，不额外泄露） */
  onTapSpecies(e) {
    const no = e.currentTarget.dataset.no
    if (!no) return
    wx.navigateTo({ url: `/subpackages/feature/collection/detail/index?id=${encodeURIComponent(no)}` })
  },

  onTapAction(e) {
    const ds = e.currentTarget.dataset || {}
    if (!ds.url) return
    if (ds.tab) wx.switchTab({ url: ds.url })
    else wx.navigateTo({ url: ds.url })
  },

  onClear() {
    if (this.data.sending) return
    openAppModal({
      title: '清空对话',
      content: '只清空这台手机上的对话记录，博物君那边本来就不留存。',
      confirmText: '清空',
      confirmColor: '#C4A76C',
      success: (r) => {
        if (!r.confirm) return
        const welcome = G.makeMessage('guide', G.WELCOME, { isWelcome: true })
        this.setData({ messages: [welcome], hasAsked: false })
        try { wx.removeStorageSync(G.storeKey(this._openid)) } catch (e) { /* ignore */ }
      }
    }, this)
  },

  noop() {}
})
