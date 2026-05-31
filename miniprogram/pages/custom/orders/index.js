// pages/custom/orders/index.js
const app = getApp()
const db = wx.cloud.database()
const _ = db.command
const { trackBehavior } = require('../../../utils/trackBehavior')
const { ensureOpenId } = require('../../../utils/orderScope')

const STATUS_MAP = {
  pending_pay: '待付款',
  paid: '待发货',
  shipped: '运输中',
  received: '已签收',
  aftersales: '售后中',
  refunded: '已退款',
  void: '已取消'
}

Page({
  data: {
    statusBarHeight: 0,
    loading: true,
    drafts: [],
    orders: []
  },

  onLoad(options) {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: systemInfo.statusBarHeight || 0 })
    trackBehavior('custom_orders_enter', 'from', options.from || 'direct')
  },

  onShow() {
    this.loadAll()
  },

  formatTime(ts) {
    if (!ts) return ''
    const d = ts instanceof Date ? ts : new Date(ts)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  },

  async loadAll() {
    this.setData({ loading: true })
    try {
      const openid = await ensureOpenId(app)
      const orderQuery = openid
        ? db.collection('orders')
          .where({
            _openid: openid,
            customMeta: _.exists(true),
            status: _.neq('void')
          })
          .orderBy('createTime', 'desc')
          .limit(30)
          .get()
        : Promise.resolve({ data: [] })

      const [draftRes, orderRes] = await Promise.all([
        wx.cloud.callFunction({ name: 'customDraft', data: { action: 'list' } }),
        orderQuery
      ])

      const draftList = (draftRes.result && draftRes.result.list) || []
      const orders = (orderRes.data || []).map((item) => {
        const meta = item.customMeta || {}
        const specimen = meta.specimen || {}
        return {
          _id: item._id,
          orderNo: item.orderNo || item._id.slice(-8),
          title: specimen.title || (item.products && item.products[0] && item.products[0].title) || '标本定制',
          statusLabel: STATUS_MAP[item.status] || '处理中',
          formatTime: this.formatTime(item.createTime)
        }
      })

      this.setData({
        loading: false,
        drafts: draftList.map((d) => ({
          _id: d._id,
          title: d.title || '定制方案',
          specimenTitle: d.customMeta && d.customMeta.specimen ? d.customMeta.specimen.title : ''
        })),
        orders
      })
    } catch (e) {
      console.error('loadAll', e)
      this.setData({ loading: false, drafts: [], orders: [] })
    }
  },

  openDraft(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/custom/index?draftId=${id}&from=orders` })
  },

  openOrder(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/subpackages/business/order-detail/index?id=${id}` })
  },

  goCustom() {
    wx.navigateTo({ url: '/pages/custom/index?from=orders' })
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.navigateTo({ url: '/pages/custom/hub/index' })
    })
  }
})
