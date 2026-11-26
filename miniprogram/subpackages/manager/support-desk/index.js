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
        statusText: t.status === 'replied' ? '已回复' : '待回复',
        replyCount: Array.isArray(t.replies) ? t.replies.length : (t.replyContent ? 1 : 0),
        time: t.createTime ? String(t.createTime).slice(5, 16).replace('T', ' ') : ''
      }))
      this.setData({ loading: false, rows })
    } catch (e) {
      this.setData({ loading: false, hint: '留言读取失败，稍后再试' })
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
      this.setData({ sending: false, replyText: '', hint: '已回复，顾客会在「山海有信」收到详情' })
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
