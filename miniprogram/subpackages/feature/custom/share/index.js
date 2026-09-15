// subpackages/feature/custom/share/index.js
const { buildPreviewSummary } = require('../../utils/customHelper')
const {
  fetchContentDisplayFlags,
  toastSpecimenCustomClosed
} = require('../../../../utils/contentDisplayFlags')

Page({
  data: {
    loading: true,
    loadError: false,
    title: '',
    specimenImage: '',
    previewLines: [],
    shareToken: '',
    draftId: '',
    showSpecimenCustom: false
  },

  onLoad(options) {
    this._shareToken = options.token || options.shareToken || ''
    this._draftId = options.draftId || ''
    this.loadDisplayFlags()
    if (!this._shareToken && !this._draftId) {
      this.setData({ loading: false, loadError: true })
      return
    }
    this.loadPreview()
  },

  async loadDisplayFlags() {
    try {
      const { flags } = await fetchContentDisplayFlags()
      this.setData({ showSpecimenCustom: flags.showSpecimenCustom === true })
    } catch (e) {
      this.setData({ showSpecimenCustom: false })
    }
  },

  async loadPreview() {
    this.setData({ loading: true, loadError: false })
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
        this.setData({ loading: false, loadError: true })
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
        return
      }
      const draft = result.draft
      const meta = draft.customMeta || {}
      this.setData({
        loading: false,
        loadError: false,
        title: draft.title || '定制方案',
        specimenImage: (meta.specimen && meta.specimen.image) || '',
        previewLines: buildPreviewSummary(meta, { hidePrice: true }),
        shareToken: draft.shareToken || this._shareToken,
        draftId: draft._id || this._draftId
      })
    } catch (e) {
      console.error(e)
      this.setData({ loading: false, loadError: true })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  retryLoad() {
    if (!this._shareToken && !this._draftId) {
      this.goCustom()
      return
    }
    this.loadPreview()
  },

  goCustom() {
    if (!this.data.showSpecimenCustom) {
      toastSpecimenCustomClosed()
      wx.switchTab({ url: '/pages/atelier/index' })
      return
    }
    const q = []
    if (this.data.draftId) q.push(`draftId=${this.data.draftId}`)
    const query = q.length ? `${q.join('&')}&from=share` : 'from=share'
    wx.navigateTo({
      url: `/subpackages/feature/custom/index?${query}`,
      fail: () => wx.redirectTo({ url: '/subpackages/feature/custom/index' })
    })
  },

  onShareAppMessage() {
    const token = this.data.shareToken
    const title = this.data.title || '山海造物 · 定制方案'
    return {
      title,
      path: token
        ? `/subpackages/feature/custom/share/index?token=${token}`
        : '/subpackages/feature/custom/index'
    }
  }
})
