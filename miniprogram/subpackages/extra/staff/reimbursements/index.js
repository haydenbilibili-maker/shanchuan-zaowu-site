const { formatCloudFnError } = require('../../utils/storePoints')
const { initStaffStores, applyStoreChange, formatTime, statusTextReimburse, resolveStoreFromQuery } = require('../utils/pageSetup')
const { monthSummary, applyStamps, money } = require('./reimburseLedger')

Page({
  data: {
    ready: false,
    storeOptions: [],
    storeNames: [],
    storeIndex: 0,
    storeId: '',
    storeName: '',
    categories: [],
    categoryIndex: 0,
    form: { amount: '', remark: '' },
    images: [],
    list: [],
    /** 本月合计（reimburseLedger.monthSummary）；无本月记录时 count 为 0 → 整条不出现 */
    summary: null,
    submitting: false
  },

  async onLoad(options) {
    try {
      const setup = await initStaffStores('staff')
      if (!setup) return
      const store = resolveStoreFromQuery(options, setup)
      this.setData({
        ready: true,
        storeOptions: setup.storeOptions,
        storeNames: setup.storeNames,
        storeIndex: store.storeIndex,
        storeId: store.storeId,
        storeName: store.storeName
      })
      await this.loadMeta()
      this.loadList()
    } catch (e) {
      console.warn('reimbursements onLoad', e)
      wx.showToast({ title: '报销页加载失败', icon: 'none' })
    }
  },

  async loadMeta() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaffWorkspace',
        data: { action: 'getMeta' }
      })
      const result = (res && res.result) || {}
      const categories = result.reimburseCategories || ['其他']
      this.setData({ categories, categoryIndex: 0 })
    } catch (e) {
      this.setData({ categories: ['其他'] })
    }
  },

  onPullDownRefresh() {
    this.loadList().then(() => wx.stopPullDownRefresh())
  },

  onStoreChange(e) {
    applyStoreChange(this, parseInt(e.detail.value, 10) || 0)
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  onCategoryChange(e) {
    this.setData({ categoryIndex: parseInt(e.detail.value, 10) || 0 })
  },

  chooseImage() {
    const remain = 5 - (this.data.images || []).length
    if (remain <= 0) {
      wx.showToast({ title: '最多 5 张凭证', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      success: (res) => {
        const files = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean)
        if (!files.length) return
        wx.showLoading({ title: '上传中…', mask: true })
        Promise.all(files.map((path) => {
          const ext = path.split('.').pop() || 'jpg'
          return wx.cloud.uploadFile({
            cloudPath: `staff-reimburse/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
            filePath: path
          })
        })).then((ups) => {
          wx.hideLoading()
          const ids = ups.map((u) => u.fileID).filter(Boolean)
          this.setData({ images: (this.data.images || []).concat(ids).slice(0, 5) })
        }).catch((err) => {
          wx.hideLoading()
          wx.showToast({ title: formatCloudFnError(err, '上传失败'), icon: 'none' })
        })
      }
    })
  },

  removeImage(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10)
    const images = (this.data.images || []).slice()
    if (idx >= 0) images.splice(idx, 1)
    this.setData({ images })
  },

  async loadList() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaffWorkspace',
        data: { action: 'reimburseList' }
      })
      const result = (res && res.result) || {}
      const rows = (result.list || []).map((row) => ({
        ...row,
        amountText: money(row.amount),
        timeText: formatTime(row.createTime),
        statusLabel: statusTextReimburse(row.status)
      }))
      const owner = (rows[0] && rows[0].staffOpenid) || ''
      this.setData({ list: applyStamps(rows, wx, owner), summary: monthSummary(rows) })
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '列表加载失败'), icon: 'none' })
    }
  },

  submit() {
    if (this.data.submitting) return
    const amount = Number(this.data.form.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      wx.showToast({ title: '请填写报销金额', icon: 'none' })
      return
    }
    const category = this.data.categories[this.data.categoryIndex] || '其他'
    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中…', mask: true })
    wx.cloud.callFunction({
      name: 'manageStaffWorkspace',
      data: {
        action: 'reimburseSubmit',
        amount,
        category,
        remark: this.data.form.remark,
        images: this.data.images,
        storeId: this.data.storeId
      }
    }).then((res) => {
      wx.hideLoading()
      const result = (res && res.result) || {}
      if (!result.success) {
        this.setData({ submitting: false })
        wx.showToast({ title: formatCloudFnError(result, result.msg || '提交失败'), icon: 'none' })
        return
      }
      this.setData({ submitting: false, form: { amount: '', remark: '' }, images: [] })
      wx.showToast({ title: '已提交，待店长审批', icon: 'none' })
      this.loadList()
    }).catch((err) => {
      wx.hideLoading()
      this.setData({ submitting: false })
      wx.showToast({ title: formatCloudFnError(err, '提交失败'), icon: 'none' })
    })
  }
})
