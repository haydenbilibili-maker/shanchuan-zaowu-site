/**
 * 客服工作台（2026-11-26 产品负责人：把「山海有信-留言回复」升级成独立工作台，入口在「我的-工作台」）
 *
 * 能力：待处理 / 全部两档；展开一条留言看正文、附图、历史回复；直接回复 →
 *      messageAdmin.replySupportTicket（写 replies 历史 + 给顾客发「山海有信」详情）。
 * 门禁：员工（超管 / 店长 / 店员）；先 guardStaffPage，云函数侧再按 openid 执法。
 */
const { guardStaffPage } = require('../utils/staffAuth')

Page({
  data: {
    ready: false,
    tab: 'pending',
    query: '',
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
    rows: [],
    openId: '',
    detail: null,
    replyText: '',
    sending: false,
    hint: ''
  },

  async onLoad(options) {
    const role = await guardStaffPage()
    if (!role) return
    this.setData({ ready: true })
    this.load()
    if (options && options.ticketId) setTimeout(() => this.openDetailById(String(options.ticketId)), 300)
  },

  onShow() {
    if (this.data.ready) this.load({ silent: true })
  },

  async load(opts = {}) {
    if (this.data.loading) return
    this.setData({ loading: true, hint: '' })
    try {
      const res = await wx.cloud.callFunction({ name: 'messageAdmin', data: { action: 'listSupportTickets', status: this.data.tab } })
      const out = (res && res.result) || {}
      const rows = (out.list || []).map((t) => ({
        id: t._id,
        topicLabel: t.topicLabel || '留言',
        message: String(t.message || '').replace(/\s+/g, ' ').slice(0, 80),
        who: t.memberNickName || t.memberNo || '',
        orderNo: t.orderNo || '',
        status: t.status || 'pending',
        statusText: t.status === 'replied' ? '已回复' : (t.status === 'resolved' ? '已解决' : (t.status === 'archived' ? '已归档' : '待回复')),
        whoKey: t._openid || '',
        customer: t.memberNickName || t.memberNo || '',
        replyCount: Array.isArray(t.replies) ? t.replies.length : (t.replyContent ? 1 : 0),
        time: t.createTime ? String(t.createTime).slice(5, 16).replace('T', ' ') : ''
      }))
      // 同一顾客的历史留言数（按 openid 聚合，帮客服看「这位之前问过什么」）
      const counts = {}
      rows.forEach((r) => { if (r.whoKey) counts[r.whoKey] = (counts[r.whoKey] || 0) + 1 })
      rows.forEach((r) => { r.customerCount = r.whoKey ? counts[r.whoKey] : 0 })
      this._allRows = rows
      this.setData({ loading: false, rows: this.filterRows(rows) })
    } catch (e) {
      this.setData({ loading: false, hint: '留言读取失败，稍后再试' })
    }
  },

  filterRows(rows) {
    const q = String(this.data.query || '').trim().toLowerCase()
    if (!q) return rows || []
    return (rows || []).filter((r) => `${r.topicLabel} ${r.message} ${r.orderNo} ${r.customer}`.toLowerCase().indexOf(q) !== -1)
  },

  onSearch(e) {
    const query = String((e.detail && e.detail.value) || '')
    this.setData({ query, rows: this.filterRows(this._allRows || this.data.rows) })
  },

  /** 快捷回复插入（保留已写内容，接在后面） */
  pickPhrase(e) {
    const text = String((e.currentTarget.dataset || {}).text || '')
    if (!text) return
    const cur = String(this.data.replyText || '').trim()
    this.setData({ replyText: (cur ? `${cur}\n${text}` : text).slice(0, 500) })
  },

  /** 标记已解决（云函数 setSupportTicketStatus） */
  async markResolved() {
    const id = this.data.openId
    if (!id) return
    try {
      const res = await wx.cloud.callFunction({ name: 'messageAdmin', data: { action: 'setSupportTicketStatus', ticketId: id, status: 'resolved' } })
      const out = (res && res.result) || {}
      this.setData({ hint: out.success ? '已标记为已解决' : (out.msg || '操作失败') })
      if (out.success) { this.setData({ openId: '', detail: null }); this.load({ silent: true }) }
    } catch (e) {
      this.setData({ hint: '操作失败，稍后再试' })
    }
  },

  switchTab(e) {
    const tab = String((e.currentTarget.dataset || {}).tab || 'pending')
    if (tab === this.data.tab) return
    this.setData({ tab, detail: null, openId: '', replyText: '' })
    this.load()
  },

  openDetailById(id) {
    if (!id) return
    this.fetchDetail(id)
  },

  onRowTap(e) {
    const id = String((e.currentTarget.dataset || {}).id || '')
    if (!id) return
    if (this.data.openId === id) { this.setData({ openId: '', detail: null }); return }
    this.fetchDetail(id)
  },

  async fetchDetail(id) {
    this.setData({ openId: id, detail: null, replyText: '', hint: '' })
    try {
      const res = await wx.cloud.callFunction({ name: 'messageAdmin', data: { action: 'getSupportTicket', ticketId: id } })
      const t = ((res && res.result) || {}).ticket
      if (!t) { this.setData({ hint: '这条留言不存在或已删除' }); return }
      this.setData({
        detail: {
          id,
          topicLabel: t.topicLabel || '留言',
          message: t.message || '',
          images: t.images || [],
          orderNo: t.orderNo || '',
          productName: t.productName || '',
          contactPhone: t.contactPhone || '',
          time: t.createTime ? String(t.createTime).slice(0, 16).replace('T', ' ') : '',
          history: (t.replies || []).map((r) => ({
            content: r.content || '',
            time: r.at ? new Date(Number(r.at)).toISOString().slice(5, 16).replace('T', ' ') : ''
          }))
        }
      })
    } catch (e) {
      this.setData({ hint: '这条留言读取失败' })
    }
  },

  onReplyInput(e) { this.setData({ replyText: e.detail.value }) },

  async sendReply() {
    const id = this.data.openId
    const content = String(this.data.replyText || '').trim()
    if (!id) return
    if (content.length < 2) { this.setData({ hint: '回复至少 2 个字' }); return }
    if (this.data.sending) return
    this.setData({ sending: true, hint: '' })
    try {
      const res = await wx.cloud.callFunction({ name: 'messageAdmin', data: { action: 'replySupportTicket', ticketId: id, replyContent: content } })
      const out = (res && res.result) || {}
      if (!out.success) { this.setData({ sending: false, hint: out.msg || '发送失败' }); return }
      this.setData({ sending: false, replyText: '', hint: out.delivered === false ? '已回复，但通知未送达（已记录，可稍后重发）' : '已回复，顾客会在「山海有信」收到详情' })
      this.fetchDetail(id)
      this.load({ silent: true })
    } catch (e) {
      this.setData({ sending: false, hint: '发送失败，稍后再试' })
    }
  },

  /** 图片加载失败：静默（列表页不因一张图破相） */
  onImageError() {},

  previewImage(e) {
    const url = (e.currentTarget.dataset || {}).url
    if (url) wx.previewImage({ current: url, urls: this.data.detail ? this.data.detail.images : [url] })
  }
})
