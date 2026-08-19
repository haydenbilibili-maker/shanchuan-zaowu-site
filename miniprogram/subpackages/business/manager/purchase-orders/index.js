const { guardManagerPage } = require('../../../../utils/managerAuth')
const purchase = require('../../../../utils/b2bPurchaseOrder')

const STATUS_TEXT = {
  draft: '草稿',
  submitted: '已提交',
  confirmed: '已确认',
  shipping: '出货中',
  shipped: '已发货',
  received: '已收货',
  closed: '已关闭',
  cancelled: '已取消',
}

Page({
  data: {
    view: 'list',
    loading: false,
    saving: false,
    orders: [],
    statusFilter: 'all',
    statusFilters: [
      { value: 'all', label: '全部' },
      { value: 'draft', label: '草稿' },
      { value: 'submitted', label: '已提交' },
      { value: 'confirmed', label: '已确认' },
      { value: 'shipped', label: '已发货' },
      { value: 'closed', label: '已关闭' },
      { value: 'cancelled', label: '已取消' },
    ],
    stores: [],
    storeNames: [],
    storeIndex: 0,
    catalog: [],
    cartMap: {},
    cartCount: 0,
    contactName: '',
    contactPhone: '',
    note: '',
    detail: null,
  },

  onLoad() {
    if (!guardManagerPage(this)) return
    this.bootstrap()
  },

  onShow() {
    if (this.data.view === 'list') this.loadOrders()
  },

  noop() {},

  async bootstrap() {
    this.setData({ loading: true })
    try {
      const [storesRes, catalogRes] = await Promise.all([
        purchase.listStores(),
        purchase.listCatalog(),
      ])
      const stores = storesRes.stores || []
      this.setData({
        stores,
        storeNames: stores.map((s) => s.name || s.storeId),
        catalog: catalogRes.items || [],
      })
      await this.loadOrders()
    } catch (e) {
      console.error(e)
      wx.showToast({
        title: e.message || '订货数据加载失败',
        icon: 'none',
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  switchView(e) {
    const view = e.currentTarget.dataset.v
    this.setData({ view })
    if (view === 'list') this.loadOrders()
  },

  setStatusFilter(e) {
    this.setData({ statusFilter: e.currentTarget.dataset.v })
    this.loadOrders()
  },

  async loadOrders() {
    this.setData({ loading: true })
    try {
      const { statusFilter } = this.data
      const res = await purchase.listOrders({
        status: statusFilter,
        limit: 80,
      })
      const orders = (res.list || []).map((o) => ({
        ...o,
        statusText: STATUS_TEXT[o.status] || o.status,
        itemCount: Array.isArray(o.items) ? o.items.length : 0,
      }))
      this.setData({ orders })
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onStorePick(e) {
    this.setData({ storeIndex: Number(e.detail.value) || 0 })
  },
  onContactName(e) {
    this.setData({ contactName: e.detail.value })
  },
  onContactPhone(e) {
    this.setData({ contactPhone: e.detail.value })
  },
  onNote(e) {
    this.setData({ note: e.detail.value })
  },

  bumpQty(e) {
    const sku = e.currentTarget.dataset.sku
    const d = Number(e.currentTarget.dataset.d) || 0
    const cartMap = { ...this.data.cartMap }
    const next = Math.max(0, (cartMap[sku] || 0) + d)
    if (next === 0) delete cartMap[sku]
    else cartMap[sku] = next
    const cartCount = Object.values(cartMap).reduce((a, b) => a + b, 0)
    this.setData({ cartMap, cartCount })
  },

  buildItems() {
    const { catalog, cartMap } = this.data
    const items = []
    for (const c of catalog) {
      const quantity = cartMap[c.skuId]
      if (!quantity) continue
      items.push({
        skuId: c.skuId,
        name: c.name,
        quantity,
        unitPrice: c.price,
        priceMax: c.priceMax,
        priceIsRange: c.priceIsRange,
        priceLabel: c.priceLabel,
      })
    }
    return items
  },

  async saveDraft() {
    await this.persist(false)
  },

  async saveAndSubmit() {
    await this.persist(true)
  },

  async persist(submit) {
    const items = this.buildItems()
    if (!items.length) {
      wx.showToast({ title: '请先选品', icon: 'none' })
      return
    }
    const store = this.data.stores[this.data.storeIndex] || {}
    this.setData({ saving: true })
    try {
      const created = await purchase.createDraft({
        items,
        storeId: store.storeId || null,
        storeName: store.name || '',
        buyerType: 'own_store',
        contactName: this.data.contactName,
        contactPhone: this.data.contactPhone,
        note: this.data.note,
        source: 'store_manager',
      })
      if (submit && created._id) {
        await purchase.submitOrder(created._id)
      }
      wx.showToast({ title: submit ? '已提交' : '草稿已保存', icon: 'success' })
      this.setData({
        view: 'list',
        cartMap: {},
        cartCount: 0,
        note: '',
        statusFilter: submit ? 'submitted' : 'draft',
      })
      await this.loadOrders()
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  async submitOrder(e) {
    const orderId = e.currentTarget.dataset.id
    try {
      await purchase.submitOrder(orderId)
      wx.showToast({ title: '已提交', icon: 'success' })
      this.loadOrders()
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' })
    }
  },

  async cancelOrder(e) {
    const orderId = e.currentTarget.dataset.id
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '取消订货单',
        content: '确定取消？',
        success: (r) => resolve(!!r.confirm),
      })
    })
    if (!ok) return
    try {
      await purchase.cancelOrder(orderId)
      wx.showToast({ title: '已取消', icon: 'success' })
      this.loadOrders()
    } catch (err) {
      wx.showToast({ title: err.message || '取消失败', icon: 'none' })
    }
  },

  async receiveOrder(e) {
    const orderId = e.currentTarget.dataset.id
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '确认收货',
        content: '确认货物已到店？',
        success: (r) => resolve(!!r.confirm),
      })
    })
    if (!ok) return
    try {
      await purchase.receiveOrder(orderId)
      wx.showToast({ title: '已收货', icon: 'success' })
      this.setData({ statusFilter: 'closed', detail: null })
      this.loadOrders()
    } catch (err) {
      wx.showToast({ title: err.message || '收货失败', icon: 'none' })
    }
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    const row = this.data.orders.find((o) => o._id === id)
    if (row) this.setData({ detail: row })
  },

  closeDetail() {
    this.setData({ detail: null })
  },
})
