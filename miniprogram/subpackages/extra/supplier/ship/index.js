/**
 * 发货回传（供应商填运单）
 * 演示模式可本地回传并推进到已发货；真数据待接通。
 */
const { guardManagerPage } = require('../../../../utils/managerAuth')
const { guardSupplierWorkspace } = require('../utils/supplierGate')
const { readDemoOn, demoShipJobs, demoShipOrder } = require('../utils/demoStore')

Page({
  data: {
    ready: false,
    isPreview: false,
    demoOn: false,
    list: [],
    emptyTitle: '暂无可回传单据',
    emptyBody: '',
    flash: '',
    draftCarrier: '顺丰速运',
    draftTracking: ''
  },

  onLoad() {
    this.bootstrap()
  },

  onShow() {
    if (!this.data.ready) return
    this.refreshList()
  },

  async bootstrap() {
    try {
      if (!guardManagerPage()) return
      const role = await guardSupplierWorkspace()
      if (!role) return
      const isPreview = role.supplierMode === 'preview'
      this.setData({
        ready: true,
        isPreview,
        demoOn: isPreview ? readDemoOn() : false
      })
      this.refreshList()
    } catch (e) {
      console.warn('supplier ship bootstrap', e)
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
    }
  },

  refreshList() {
    const demoOn = this.data.isPreview && readDemoOn()
    const list = demoOn ? demoShipJobs() : []
    this.setData({
      demoOn,
      list,
      emptyBody: demoOn
        ? '没有待发货演示单。请先在「采购需求」确认接单，或回 Hub 重置演示流。'
        : '确认接单后的需求会出现在这里。正式列表同源 party=supplier_fulfillment；发货写回待下一版。演示仅超管可开。'
    })
  },

  onCarrier(e) {
    this.setData({ draftCarrier: e.detail.value })
  },

  onTracking(e) {
    this.setData({ draftTracking: e.detail.value })
  },

  onShip(e) {
    if (!(this.data.isPreview && readDemoOn())) return
    const key = String((e.currentTarget.dataset || {}).key || '').trim()
    const res = demoShipOrder(key, this.data.draftCarrier, this.data.draftTracking)
    if (!res.ok) {
      this.setData({ flash: res.msg || '无法发货' })
      return
    }
    this.setData({
      flash: '运单已回传（演示）→ 可到「我的结算」查看联动摘要',
      draftTracking: ''
    })
    this.refreshList()
  },

  goOrders() {
    wx.navigateTo({ url: '/subpackages/extra/supplier/orders/index' })
  },

  goSettlement() {
    wx.navigateTo({ url: '/subpackages/extra/supplier/settlement/index' })
  }
})
