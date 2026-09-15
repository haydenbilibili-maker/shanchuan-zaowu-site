/**
 * 预约规则（仅超管）— manageBookingRules · store_booking_rules
 * 字段对齐 createBooking / getBookingAvailability
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'manageBookingRules'

Page({
  data: {
    ready: false,
    loading: false,
    saving: false,
    stores: [],
    storeId: 'store_shanhaizaowu',
    docId: '',
    fromDefault: true,
    ruleText: '',
    newClosedDate: '',
    rules: {
      visitSlots: [],
      closedDates: [],
      maxPerDay: 40,
      advanceDays: 7,
      minAdvanceHours: 2
    }
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin')
    if (!role) return
    this.setData({ ready: true })
    await this.loadStores()
    await this.loadRules()
  },

  onPullDownRefresh() {
    Promise.all([this.loadStores(), this.loadRules()]).finally(() => wx.stopPullDownRefresh())
  },

  async callFn(data) {
    const res = await wx.cloud.callFunction({ name: FN, data: data || {} })
    const result = (res && res.result) || {}
    if (!result.success) {
      const err = new Error(result.msg || '操作失败')
      err.code = result.code
      throw err
    }
    return result
  },

  async loadStores() {
    try {
      const result = await this.callFn({ action: 'listStores' })
      const stores = result.stores || []
      this.setData({
        stores,
        storeId: this.data.storeId || (stores[0] && stores[0].storeId) || 'store_shanhaizaowu'
      })
    } catch (e) {
      this.setData({
        stores: [
          { storeId: 'store_shanhaizaowu', name: '主店' },
          { storeId: 'store_xingchen', name: '工坊' }
        ]
      })
    }
  },

  async loadRules() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const result = await this.callFn({ action: 'get', storeId: this.data.storeId })
      const rules = result.rules || {}
      this.setData({
        loading: false,
        docId: result.docId || '',
        fromDefault: !!result.fromDefault,
        ruleText: result.ruleText || '',
        rules: {
          visitSlots: (rules.visitSlots || []).map((s) => ({
            start: s.start,
            capacity: Number(s.capacity) || 8,
            enabled: s.enabled !== false
          })),
          closedDates: (rules.closedDates || []).slice(),
          maxPerDay: Number(rules.maxPerDay) || 0,
          advanceDays: Number(rules.advanceDays) || 7,
          minAdvanceHours: Number(rules.minAdvanceHours) || 0
        }
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: formatCloudFnError(e, '加载失败'), icon: 'none' })
    }
  },

  switchStore(e) {
    const storeId = e.currentTarget.dataset.id
    if (!storeId || storeId === this.data.storeId) return
    this.setData({ storeId, docId: '' })
    this.loadRules()
  },

  onNumber(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`rules.${field}`]: Number(e.detail.value) || 0 })
  },

  onSlotField(e) {
    const { index, field } = e.currentTarget.dataset
    let value = e.detail.value
    if (field === 'capacity') value = Number(value) || 1
    this.setData({ [`rules.visitSlots[${index}].${field}`]: value })
  },

  toggleSlot(e) {
    const index = Number(e.currentTarget.dataset.index)
    const row = this.data.rules.visitSlots[index]
    if (!row) return
    this.setData({ [`rules.visitSlots[${index}].enabled`]: !row.enabled })
  },

  addSlot() {
    const visitSlots = this.data.rules.visitSlots.concat([
      { start: '10:00', capacity: 8, enabled: true }
    ])
    this.setData({ 'rules.visitSlots': visitSlots })
  },

  removeSlot(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (this.data.rules.visitSlots.length <= 1) {
      wx.showToast({ title: '至少保留一个时段', icon: 'none' })
      return
    }
    const visitSlots = this.data.rules.visitSlots.slice()
    visitSlots.splice(index, 1)
    this.setData({ 'rules.visitSlots': visitSlots })
  },

  onClosedDateInput(e) {
    this.setData({ newClosedDate: String((e.detail && e.detail.value) || '') })
  },

  addClosedDate() {
    const date = String(this.data.newClosedDate || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      wx.showToast({ title: '日期格式 YYYY-MM-DD', icon: 'none' })
      return
    }
    if (this.data.rules.closedDates.indexOf(date) !== -1) {
      wx.showToast({ title: '该日期已存在', icon: 'none' })
      return
    }
    this.setData({
      'rules.closedDates': this.data.rules.closedDates.concat([date]),
      newClosedDate: ''
    })
  },

  removeClosedDate(e) {
    const index = Number(e.currentTarget.dataset.index)
    const closedDates = this.data.rules.closedDates.slice()
    closedDates.splice(index, 1)
    this.setData({ 'rules.closedDates': closedDates })
  },

  async saveConfig() {
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      const result = await this.callFn({
        action: 'save',
        storeId: this.data.storeId,
        docId: this.data.docId,
        rules: this.data.rules
      })
      this.setData({
        docId: result.docId || this.data.docId,
        ruleText: result.ruleText || '',
        fromDefault: false
      })
      wx.showToast({ title: '已保存', icon: 'success' })
      await this.loadRules()
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
