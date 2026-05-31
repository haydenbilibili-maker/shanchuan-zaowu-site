// pages/custom/share/index.js
const { buildPreviewSummary } = require('../../../utils/customHelper')

Page({
  data: {
    loading: true,
    title: '',
    specimenImage: '',
    previewLines: [],
    shareToken: '',
    draftId: ''
  },

  onLoad(options) {
    this._shareToken = options.token || options.shareToken || ''
    this._draftId = options.draftId || ''
    this.loadPreview()
  },

  async loadPreview() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'customDraft',
        data: {
          action: 'getShare',
          shareToken: this._shareToken,
          draftId: this._draftId
        }
      })
      const result = res.result || {}
      if (!result.success || !result.draft) {
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
        this.setData({ loading: false })
        return
      }
      const draft = result.draft
      const meta = draft.customMeta || {}
      this.setData({
        loading: false,
        title: draft.title || '定制方案',
        specimenImage: (meta.specimen && meta.specimen.image) || '',
        previewLines: buildPreviewSummary(meta, { hidePrice: true }),
        shareToken: draft.shareToken || this._shareToken,
        draftId: draft._id || this._draftId
      })
    } catch (e) {
      console.error(e)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  goCustom() {
    const q = []
    if (this.data.draftId) q.push(`draftId=${this.data.draftId}`)
    wx.navigateTo({ url: `/pages/custom/index?${q.join('&')}&from=share` })
  },

  onShareAppMessage() {
    const token = this.data.shareToken
    const title = this.data.title || '山海造物 · 定制方案'
    return {
      title,
      path: token
        ? `/pages/custom/share/index?token=${token}`
        : '/pages/custom/index'
    }
  }
})
