/**
 * 我的结算（供应商应付/已付摘要）
 * 演示模式与发货状态联动；真数据待接通。
 */
const { guardManagerPage } = require('../../../../utils/managerAuth')
const { guardSupplierWorkspace } = require('../utils/supplierGate')
const { readDemoOn, demoSettlements } = require('../utils/demoStore')

Page({
  data: {
    ready: false,
    isPreview: false,
    demoOn: false,
    list: [],
    emptyTitle: '暂无结算记录',
    emptyBody: ''
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
      console.warn('supplier settlement bootstrap', e)
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
    }
  },

  refreshList() {
    const demoOn = this.data.isPreview && readDemoOn()
    const list = demoOn ? demoSettlements() : []
    this.setData({
      demoOn,
      list,
      emptyBody: demoOn
        ? '演示结算为空。请先完成需求确认与发货回传，或回 Hub 重置演示流。'
        : '结算摘要待下一版接真数据。本批契约：仅 supplier_fulfillment 单据；禁止工作室账单页。演示仅超管可开。'
    })
  },

  goShip() {
    wx.navigateTo({ url: '/subpackages/extra/supplier/ship/index' })
  }
})
