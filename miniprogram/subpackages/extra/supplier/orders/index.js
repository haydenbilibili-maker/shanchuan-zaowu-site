/**
 * 采购需求（供应商视角）
 * 真数据：party=supplier_fulfillment + supplierId（见 supplierOrders.js）
 * 演示：仅超管 preview + 本地 demo 开关
 */
const { guardManagerPage } = require('../../../../utils/managerAuth')
const { guardSupplierWorkspace } = require('../utils/supplierGate')
const {
  readDemoOn,
  demoOrdersByStatus,
  demoConfirmOrder
} = require('../utils/demoStore')
const { listSupplierOrders, resolveSupplierId } = require('../utils/supplierOrders')

const TABS = [
  { key: 'pending_confirm', label: '待确认' },
  { key: 'pending_ship', label: '待发货' },
  { key: 'shipped', label: '已发货' }
]

const EMPTY_COPY = {
  pending_confirm: {
    title: '暂无待确认需求',
    body: '山海造物向您发出采购需求后，会出现在这里。您可确认是否接单与交期。'
  },
  pending_ship: {
    title: '暂无待发货单',
    body: '已确认接单、等待您发货的需求会出现在这里。可到「发货回传」填写运单。'
  },
  shipped: {
    title: '暂无已发货记录',
    body: '您回传运单后的需求会出现在这里。'
  }
}

Page({
  data: {
    ready: false,
    isPreview: false,
    demoOn: false,
    supplierId: '',
    tab: 'pending_confirm',
    tabs: TABS,
    list: [],
    emptyTitle: '',
    emptyBody: '',
    flash: '',
    loading: false
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
        demoOn: isPreview ? readDemoOn() : false,
        supplierId: resolveSupplierId(role)
      })
      this.refreshList()
    } catch (e) {
      console.warn('supplier orders bootstrap', e)
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
    }
  },

  setTab(e) {
    const key = String((e.currentTarget.dataset || {}).key || '').trim()
    if (!key) return
    this.setData({ tab: key, flash: '' })
    this.refreshList()
  },

  async refreshList() {
    const tab = this.data.tab
    const empty = EMPTY_COPY[tab] || EMPTY_COPY.pending_confirm
    const demoOn = this.data.isPreview && readDemoOn()
    if (demoOn) {
      const raw = demoOrdersByStatus(tab)
      const list = raw.map((r) => ({
        ...r,
        canConfirm: r.status === 'pending_confirm',
        demoTag: true
      }))
      this.setData({
        demoOn: true,
        loading: false,
        list,
        emptyTitle: empty.title,
        emptyBody:
          tab === 'pending_confirm'
            ? '当前无待确认演示单。可回 Hub「重置演示流」。'
            : '当前状态下没有演示条目。可切换上方状态，或去「发货回传」继续。'
      })
      return
    }

    this.setData({ loading: true, demoOn: false })
    const res = await listSupplierOrders({
      supplierId: this.data.supplierId,
      tab
    })
    const list = (res.list || []).map((r) => ({
      ...r,
      canConfirm: false,
      demoTag: false
    }))
    this.setData({
      loading: false,
      list,
      emptyTitle: empty.title,
      emptyBody: res.ok
        ? `${empty.body}\n\n正式列表只显示 party=supplier_fulfillment 且绑定您 supplierId 的单据；买方采购单不会出现在此。`
        : res.msg || '读取失败，请下拉重试。'
    })
  },

  onConfirm(e) {
    if (!(this.data.isPreview && readDemoOn())) {
      this.setData({ flash: '真数据确认接单待下一版接线（本批仅只读契约）' })
      return
    }
    const key = String((e.currentTarget.dataset || {}).key || '').trim()
    const res = demoConfirmOrder(key)
    if (!res.ok) {
      this.setData({ flash: res.msg || '无法确认' })
      return
    }
    this.setData({ flash: '已确认接单（演示）→ 请到「发货回传」或切到「待发货」' })
    this.refreshList()
  },

  goShip() {
    wx.navigateTo({ url: '/subpackages/extra/supplier/ship/index' })
  }
})
