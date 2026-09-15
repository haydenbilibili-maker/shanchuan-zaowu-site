// subpackages/feature/custom/orders/index.js
const app = getApp()
const db = wx.cloud.database()
const _ = db.command
const { trackBehavior } = require('../../../../utils/trackBehavior')
const { ensureOpenId } = require('../../../../utils/orderScope')
const {
  fetchContentDisplayFlags,
  toastSpecimenCustomClosed
} = require('../../../../utils/contentDisplayFlags')

const STATUS_MAP = {
  pending_pay: '待付款',
  paid: '待发货',
  shipped: '待收货',
  received: '已签收',
  aftersales: '售后中',
  refunding: '退款中',
  refunded: '已退款',
  void: '已取消'
}

Page({
  data: {
    statusBarHeight: 0,
    loading: true,
    drafts: [],
    orders: [],
    showSpecimenCustom: false
  },

  onLoad(options) {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: systemInfo.statusBarHeight || 0 })
    trackBehavior('custom_orders_enter', 'from', options.from || 'direct')
    this.loadDisplayFlags()
  },

  async loadDisplayFlags() {
    try {
      const { flags } = await fetchContentDisplayFlags()
      this.setData({ showSpecimenCustom: flags.showSpecimenCustom === true })
    } catch (e) {
      this.setData({ showSpecimenCustom: false })
    }
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
          orderNo: item.orderNo || (item._id ? String(item._id).slice(-8) : ''),
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
      wx.showToast({ title: '订单加载失败', icon: 'none' })
    }
  },

  openDraft(e) {
    if (!this.data.showSpecimenCustom) {
      toastSpecimenCustomClosed()
      return
    }
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '方案信息缺失', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/subpackages/feature/custom/index?draftId=${id}&from=orders`,
      fail: () => wx.showToast({ title: '无法打开方案', icon: 'none' })
    })
  },

  openOrder(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '订单信息缺失', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/subpackages/business/order-detail/index?id=${id}`,
      fail: () => wx.showToast({ title: '无法打开订单', icon: 'none' })
    })
  },

  goCustom() {
    if (!this.data.showSpecimenCustom) {
      toastSpecimenCustomClosed()
      return
    }
    wx.navigateTo({
      url: '/subpackages/feature/custom/index?from=orders',
      fail: () => wx.showToast({ title: '无法打开定制', icon: 'none' })
    })
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/atelier/index' })
    })
  }
})
