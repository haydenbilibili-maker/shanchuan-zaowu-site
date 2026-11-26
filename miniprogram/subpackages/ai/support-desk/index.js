/**
 * 客服工作台（2026-11-26 产品负责人：把「山海有信-留言回复」升级成独立工作台，入口在「我的-工作台」）
 *
 * 能力：待回复 / 已回复 / 全部三档 + 搜索；点一条看对话（顾客原留言 + 历次回复）、附图、顾客 360、内部备注；直接回复 →
 *      messageAdmin.replySupportTicket（写 replies 历史 + 给顾客发「山海有信」详情）；标记已解决 / 重新打开。
 * 门禁：员工（超管 / 店长 / 店员）；先 guardStaffPage（= ai 分包 guardAiStaffPage），云函数侧再按 openid 执法。
 * 位置：2026-11-27 起在 subpackages/ai/support-desk；旧路径 subpackages/manager/support-desk 留一个跳转壳（已发出的消息深链不失效）。
 *
 * 2026-11-27 交互视觉对齐与升级：时间按北京时间（原显示早 8 小时）、待回复按等得最久排 + 超 12 小时标「已等」、
 * 下拉刷新 / 加载更多、回复草稿按条保留、没回复过就直接「已解决」要二次确认、已解决可重新打开、复制单号 / 拨打电话、
 * 提示条自动消失；展示口径见 deskView.js。
 */
// 2026-11-27 迁到 ai 分包（manager 分包余量不足 50 KiB，体积守卫要求迁页）：门禁用本分包的 guardAiStaffPage，
// 语义与原 guardStaffPage('staff') 相同 —— 超管 / 店长 / 店员放行，其余退回；云函数侧仍按 openid 执法
const { guardAiStaffPage: guardStaffPage } = require('../utils/staffGate')
const view = require('./deskView')

const HINT_MS = 2600
const RESOLVE_ARM_MS = 4000

Page({
  data: {
    ready: false,
    tab: 'pending',
    query: '',
    pendingCount: 0,
    /** 快捷回复（2026-11-26 客服工作台升级）：点一下插入，可再改 */
    phrases: [
      '已经收到，我先帮您核对，稍后在这里回复。',
      '这件是手工制作，颜色与纹理会有细微差异，属于正常。',
      '已为您登记，处理好会在「山海有信」通知您。',
      '麻烦补一张照片，看得更清楚些，我们好判断。',
      '养护上避开阳光直射、保持干燥通风即可。',
      '给您添麻烦了，这件我们按售后流程处理。'
    ],
    loading: false,
    loadingMore: false,
    hasMore: false,
    rows: [],
    openId: '',
    detail: null,
    detailLoading: false,
    replyText: '',
    sending: false,
    hint: '',
    hintTone: 'info',
    notes: [],
    noteText: '',
    customer: null,
    /** 没回复过就点「标记已解决」：先变成确认态，4 秒内再点一次才执行 */
    resolveArmed: false
  },

  async onLoad(options) {
    const role = await guardStaffPage()
    if (!role) return
    this._drafts = {}
    this.setData({ ready: true })
    this.load()
    if (options && options.ticketId) setTimeout(() => this.openDetailById(String(options.ticketId)), 300)
  },

  onShow() {
    if (this.data.ready) {
      this.load({ silent: true })
      this.remindOnce()
    }
  },

  onUnload() {
    clearTimeout(this._hintTimer)
    clearTimeout(this._armTimer)
  },

  async onPullDownRefresh() {
    await this.load({ silent: true })
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    this.loadMore()
  },

  /** 超时未回复提醒：每次进入工作台最多触发一次（云端按 12h + remindedAt 去重） */
  remindOnce() {
    if (this._reminded) return
    this._reminded = true
    try { wx.cloud.callFunction({ name: 'messageAdmin', data: { action: 'remindOverdue', hours: view.OVERDUE_HOURS } }) } catch (e) { /* 忽略 */ }
  },

  showHint(text, tone) {
    clearTimeout(this._hintTimer)
    this.setData({ hint: text || '', hintTone: tone || 'info' })
    if (text) this._hintTimer = setTimeout(() => this.setData({ hint: '' }), HINT_MS)
  },

  async loadPendingCount() {
    try {
      const res = await wx.cloud.callFunction({ name: 'messageAdmin', data: { action: 'countSupportPending' } })
      const out = (res && res.result) || {}
      if (out.success !== false) this.setData({ pendingCount: Number(out.count || out.total || 0) || 0 })
    } catch (e) { /* 角标读不到不影响列表 */ }
  },

  async fetchPage(skip) {
    const res = await wx.cloud.callFunction({ name: 'messageAdmin', data: { action: 'listSupportTickets', status: this.data.tab, skip } })
    const out = (res && res.result) || {}
    const now = Date.now()
    return { list: (out.list || []).map((t) => view.decorateTicket(t, now)), hasMore: !!out.hasMore }
  },

  async load(opts = {}) {
    if (this.data.loading) return
    const tab = this.data.tab
    this.setData({ loading: true })
    this.loadPendingCount()
    try {
      const page = await this.fetchPage(0)
      if (tab !== this.data.tab) { this.setData({ loading: false }); return } // 期间切了档
      this._allRows = view.markRepeat(view.sortRows(page.list, tab))
      this.setData({ loading: false, hasMore: page.hasMore, rows: view.filterRows(this._allRows, this.data.query) })
    } catch (e) {
      this.setData({ loading: false })
      if (!opts.silent) this.showHint('留言读取失败，稍后再试', 'warn')
    }
  },

  async loadMore() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return
    const tab = this.data.tab
    this.setData({ loadingMore: true })
    try {
      const page = await this.fetchPage((this._allRows || []).length)
      if (tab !== this.data.tab) { this.setData({ loadingMore: false }); return }
      const seen = new Set((this._allRows || []).map((r) => r.id))
      this._allRows = view.markRepeat(view.sortRows((this._allRows || []).concat(page.list.filter((r) => !seen.has(r.id))), tab))
      this.setData({ loadingMore: false, hasMore: page.hasMore, rows: view.filterRows(this._allRows, this.data.query) })
    } catch (e) {
      this.setData({ loadingMore: false })
      this.showHint('没能加载更多，稍后再试', 'warn')
    }
  },

  onSearch(e) {
    const query = String((e.detail && e.detail.value) || '')
    this.setData({ query, rows: view.filterRows(this._allRows || this.data.rows, query) })
  },

  clearSearch() {
    this.setData({ query: '', rows: this._allRows || this.data.rows })
  },

  switchTab(e) {
    const tab = String((e.currentTarget.dataset || {}).tab || 'pending')
    if (tab === this.data.tab) return
    this.stashDraft()
    this._allRows = []
    this.setData({ tab, detail: null, openId: '', replyText: '', rows: [], hasMore: false })
    this.load()
  },

  /** 快捷回复插入（保留已写内容，接在后面） */
  pickPhrase(e) {
    const text = String((e.currentTarget.dataset || {}).text || '')
    if (!text) return
    const cur = String(this.data.replyText || '').trim()
    this.setData({ replyText: (cur ? `${cur}\n${text}` : text).slice(0, 500) })
  },

  /** 回复草稿按条保留：关弹层 / 切档 / 切到别的留言都不丢 */
  stashDraft() {
    if (!this._drafts) this._drafts = {}
    if (this.data.openId) this._drafts[this.data.openId] = this.data.replyText || ''
  },

  disarmResolve() {
    clearTimeout(this._armTimer)
    if (this.data.resolveArmed) this.setData({ resolveArmed: false })
  },

  /** 标记已解决（云函数 setSupportTicketStatus）；一次都没回复过时先二次确认 */
  async markResolved() {
    const id = this.data.openId
    if (!id || !this.data.detail) return
    if (!this.data.detail.replied && !this.data.resolveArmed) {
      this.setData({ resolveArmed: true })
      clearTimeout(this._armTimer)
      this._armTimer = setTimeout(() => this.setData({ resolveArmed: false }), RESOLVE_ARM_MS)
      return
    }
    this.disarmResolve()
    await this.setStatus(id, 'resolved', '已标记为已解决')
  },

  /** 已解决的重新打开 → 回到待回复 */
  async reopenTicket() {
    const id = this.data.openId
    if (id) await this.setStatus(id, 'pending', '已重新打开，回到待回复')
  },

  async setStatus(id, status, okText) {
    try {
      const res = await wx.cloud.callFunction({ name: 'messageAdmin', data: { action: 'setSupportTicketStatus', ticketId: id, status } })
      const out = (res && res.result) || {}
      if (!out.success) { this.showHint(out.msg || '操作失败', 'warn'); return }
      this.showHint(okText, 'ok')
      if (this._drafts) delete this._drafts[id]
      this.setData({ openId: '', detail: null, replyText: '' })
      this.load({ silent: true })
    } catch (e) {
      this.showHint('操作失败，稍后再试', 'warn')
    }
  },

  openDetailById(id) {
    if (!id) return
    this.fetchDetail(id)
  },

  /** 关掉底部详情弹层（草稿留着） */
  closeDetail() {
    this.stashDraft()
    this.disarmResolve()
    this.setData({ openId: '', detail: null })
  },

  noop() {},

  onRowTap(e) {
    const id = String((e.currentTarget.dataset || {}).id || '')
    if (!id) return
    this.fetchDetail(id)
  },

  async fetchDetail(id) {
    this.stashDraft()
    this.disarmResolve()
    const draft = (this._drafts && this._drafts[id]) || ''
    this.setData({ openId: id, detail: null, detailLoading: true, replyText: draft, notes: [], customer: null, noteText: '' })
    try {
      const res = await wx.cloud.callFunction({ name: 'messageAdmin', data: { action: 'getSupportTicket', ticketId: id } })
      const t = ((res && res.result) || {}).ticket
      if (this.data.openId !== id) return
      if (!t) { this.setData({ openId: '', detailLoading: false }); this.showHint('这条留言不存在或已删除', 'warn'); return }
      const row = view.decorateTicket(t, Date.now())
      const thread = view.buildThread(t)
      this.setData({
        detailLoading: false,
        notes: view.notesView(t.notes),
        detail: {
          id,
          topicLabel: row.topicLabel,
          customer: row.customer || '顾客',
          status: row.status,
          statusText: row.statusText,
          tone: row.tone,
          waitedText: row.waitedText,
          time: row.time,
          ago: row.ago,
          images: t.images || [],
          orderNo: t.orderNo || '',
          orderId: t.orderId || '',
          productName: t.productName || '',
          contactPhone: t.contactPhone || '',
          thread,
          // 原「历史回复」保留同名字段（守卫与旧逻辑认它），内容 = 对话里专员那几条
          history: thread.filter((m) => m.side === 'staff'),
          replied: thread.some((m) => m.side === 'staff')
        }
      })
      this.loadCustomer(t._openid)
    } catch (e) {
      this.setData({ detailLoading: false, openId: '' })
      this.showHint('这条留言读取失败', 'warn')
    }
  },

  /** 顾客 360：订单数 / 最近订单 / 评价数 / 留言数 */
  async loadCustomer(openid) {
    if (!openid) return
    const id = this.data.openId
    try {
      const res = await wx.cloud.callFunction({ name: 'messageAdmin', data: { action: 'getCustomerContext', openid } })
      const out = (res && res.result) || {}
      if (out.success && this.data.openId === id) this.setData({ customer: { orderCount: out.orderCount || 0, orders: out.orders || [], commentCount: out.commentCount || 0, ticketCount: out.ticketCount || 0 } })
    } catch (e) { /* 顾客档案读不到不影响回复 */ }
  },

  onNoteInput(e) { this.setData({ noteText: e.detail.value }) },

  async addNote() {
    const id = this.data.openId
    const note = String(this.data.noteText || '').trim()
    if (!id || !note) return
    try {
      const res = await wx.cloud.callFunction({ name: 'messageAdmin', data: { action: 'addSupportNote', ticketId: id, note } })
      const out = (res && res.result) || {}
      if (!out.success) { this.showHint(out.msg || '备注失败', 'warn'); return }
      this.setData({ noteText: '', notes: view.notesView(out.notes) })
      this.showHint('备注已保存（仅员工可见）', 'ok')
    } catch (e) { this.showHint('备注失败，稍后再试', 'warn') }
  },

  openOrderDetail(e) {
    const id = String((e.currentTarget.dataset || {}).id || '')
    if (id) wx.navigateTo({ url: `/subpackages/business/order-detail/index?id=${encodeURIComponent(id)}` })
  },

  copyOrderNo() {
    const no = this.data.detail && this.data.detail.orderNo
    if (!no) return
    wx.setClipboardData({ data: no, success: () => this.showHint('单号已复制', 'ok') })
  },

  callCustomer() {
    const phone = this.data.detail && this.data.detail.contactPhone
    if (phone) wx.makePhoneCall({ phoneNumber: String(phone), fail: () => {} })
  },

  onReplyInput(e) { this.setData({ replyText: e.detail.value }) },

  async sendReply() {
    const id = this.data.openId
    const content = String(this.data.replyText || '').trim()
    if (!id) return
    if (content.length < 2) { this.showHint('回复至少 2 个字', 'warn'); return }
    if (this.data.sending) return
    this.setData({ sending: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'messageAdmin', data: { action: 'replySupportTicket', ticketId: id, replyContent: content } })
      const out = (res && res.result) || {}
      if (!out.success) { this.setData({ sending: false }); this.showHint(out.msg || '发送失败', 'warn'); return }
      if (this._drafts) delete this._drafts[id]
      this.setData({ sending: false, replyText: '' })
      this.showHint(out.delivered === false ? '已回复，但通知未送达（已记录，可稍后重发）' : '已回复，顾客会在「山海有信」收到详情', out.delivered === false ? 'warn' : 'ok')
      this.fetchDetail(id)
      this.load({ silent: true })
    } catch (e) {
      this.setData({ sending: false })
      this.showHint('发送失败，稍后再试', 'warn')
    }
  },

  /** 图片加载失败：静默（列表页不因一张图破相） */
  onImageError() {},

  previewImage(e) {
    const url = (e.currentTarget.dataset || {}).url
    if (url) wx.previewImage({ current: url, urls: this.data.detail ? this.data.detail.images : [url] })
  }
})
