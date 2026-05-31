// pages/custom/inquiry/index.js
const { buildInquirySummary, buildDraftTitle } = require('../../../utils/customHelper')
const { trackBehavior } = require('../../../utils/trackBehavior')

Page({
  data: {
    statusBarHeight: 0,
    headerHeight: 88,
    loading: true,
    draftId: '',
    customMeta: null,
    previewLines: [],
    planTitle: '',
    quantity: 10,
    companyName: '',
    contactName: '',
    contactPhone: '',
    message: '',
    submitting: false
  },

  onLoad(options) {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({
      statusBarHeight: systemInfo.statusBarHeight || 0,
      headerHeight: systemInfo.statusBarHeight + 88,
      draftId: options.draftId || ''
    })
    trackBehavior('custom_inquiry_enter', 'type', 'enterprise')
    this.loadDraft(options.draftId)
  },

  async loadDraft(draftId) {
    if (!draftId) {
      this.setData({ loading: false })
      wx.showToast({ title: '请先完成定制方案', icon: 'none' })
      return
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'customDraft',
        data: { action: 'get', draftId }
      })
      const draft = res.result && res.result.draft
      if (!draft || !draft.customMeta) {
        this.setData({ loading: false })
        return
      }
      this.setData({
        loading: false,
        customMeta: draft.customMeta,
        planTitle: draft.title || buildDraftTitle(draft.customMeta),
        previewLines: buildInquirySummary(draft.customMeta, 10)
      })
    } catch (e) {
      console.error(e)
      this.setData({ loading: false })
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  onQuantityChange(e) {
    const val = parseInt(e.detail.value, 10) || 10
    const qty = Math.max(10, val)
    this.setData({
      quantity: qty,
      previewLines: buildInquirySummary(this.data.customMeta, qty)
    })
  },

  async submitInquiry() {
    const { quantity, companyName, contactName, contactPhone, message, draftId, customMeta } = this.data
    if (!customMeta) {
      wx.showToast({ title: '定制方案无效', icon: 'none' })
      return
    }
    if (!contactName.trim()) {
      wx.showToast({ title: '请填写联系人', icon: 'none' })
      return
    }
    if (!contactPhone || contactPhone.length < 11) {
      wx.showToast({ title: '请填写正确手机号', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'submitCustomInquiry',
        data: {
          type: 'enterprise',
          quantity: parseInt(quantity, 10) || 10,
          companyName: companyName.trim(),
          contactName: contactName.trim(),
          contactPhone: contactPhone.trim(),
          message: message.trim(),
          draftId,
          customMeta
        }
      })
      const result = res.result || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '提交失败', icon: 'none' })
        return
      }
      trackBehavior('custom_inquiry_submit', 'type', 'enterprise')
      wx.showModal({
        title: '意向已提交',
        content: '专员将在 1-2 个工作日内与您联系报价，请留意山海有信通知。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    } catch (e) {
      wx.showToast({ title: '提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  goBack() {
    wx.navigateBack()
  }
})
