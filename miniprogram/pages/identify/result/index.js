// 鉴定结果页：云库记录展示；支持小程序码 scene 扫码进入与纠错反馈
const app = getApp()
const { inferCollectionCategory } = require('../../../utils/speciesCategory')
const { trackBehavior } = require('../../../utils/trackBehavior')
const db = wx.cloud.database()

Page({
  data: {
    loading: true,
    recordId: '',
    displayImage: '',
    speciesInfo: {},
    aiContent: {},
    confidenceLevel: 'high',
    alternatives: [],
    rootCategoryTag: '',
    relatedProducts: [],
    relatedWiki: [],
    galleryCategory: '',
    showFallback: false,
    bookmarked: false,
    saving: false,
    showFeedback: false,
    feedbackZh: '',
    feedbackNote: '',
    feedbackSubmitting: false
  },

  onLoad(options) {
    if (options.from_cache === '1') {
      setTimeout(() => {
        wx.showToast({ title: '与上次同图，已跳过重复识别', icon: 'none', duration: 2500 })
      }, 200)
    }

    let rid = options.record_id
    if (!rid && options.scene) {
      try {
        rid = decodeURIComponent(options.scene)
      } catch (e) {
        rid = options.scene
      }
    }

    if (options.mock === '1') {
      wx.showToast({ title: '请拍照或选图进行鉴定', icon: 'none' })
      setTimeout(() => wx.redirectTo({ url: '/pages/identify/index' }), 800)
      return
    }

    if (rid) {
      this.setData({ recordId: rid })
      this.loadRecord(rid)
      return
    }

    // 小程序码扫码：scene 可能在 enterOptions 中，稍后补全
    const trySceneFromEnter = () => {
      const opt = typeof wx.getEnterOptionsSync === 'function' ? wx.getEnterOptionsSync() : null
      const q = opt && opt.query
      if (q && q.scene) {
        let s = q.scene
        try {
          s = decodeURIComponent(s)
        } catch (e) {}
        if (s) {
          this.setData({ recordId: s })
          this.loadRecord(s)
          return true
        }
      }
      return false
    }

    if (!trySceneFromEnter()) {
      setTimeout(() => {
        if (!trySceneFromEnter()) {
          this.setData({ loading: false })
          wx.showToast({ title: '缺少记录', icon: 'none' })
        }
      }, 200)
    }
  },

  async loadRecord(id) {
    this.setData({ loading: true })
    try {
      const res = await db.collection('identification_records').doc(id).get()
      const doc = res.data
      if (!doc) throw new Error('记录不存在')

      let url = ''
      if (doc.image_url) {
        if (String(doc.image_url).indexOf('cloud://') === 0) {
          const t = await wx.cloud.getTempFileURL({ fileList: [doc.image_url] })
          const f = t.fileList && t.fileList[0]
          url = (f && f.tempFileURL) || ''
        } else {
          url = doc.image_url
        }
      }

      const conf = doc.species_info && doc.species_info.confidence
      let confidenceLevel = 'high'
      if (doc.species_info && doc.species_info.is_specimen === false) confidenceLevel = 'low'
      else if (typeof conf === 'number' && conf < 0.6) confidenceLevel = 'low'
      else if (typeof conf === 'number' && conf < 0.85) confidenceLevel = 'medium'

      const galleryCategory = inferCollectionCategory(doc.species_info && doc.species_info.taxonomy, doc.species_info && doc.species_info.species_name_zh)
      const rootCategoryTag =
        galleryCategory && galleryCategory !== '其他'
          ? galleryCategory === '衍生品'
            ? '衍生品'
            : `${galleryCategory}馆`
          : ''
      const alternatives = (doc.species_info && doc.species_info.alternatives) || []
      const relatedProducts = doc.related_products_snapshot || []
      const relatedWiki = doc.related_wiki_snapshot || []

      this.setData({
        speciesInfo: doc.species_info || {},
        aiContent: doc.ai_content || {},
        displayImage: url,
        bookmarked: !!doc.is_bookmarked,
        confidenceLevel,
        alternatives,
        rootCategoryTag,
        relatedProducts,
        relatedWiki,
        galleryCategory,
        showFallback: relatedProducts.length === 0 && relatedWiki.length === 0 && doc.species_info && doc.species_info.is_specimen !== false
      })

      if (this.data.recordId) {
        trackBehavior('identify_result_view', 'identification', this.data.recordId, {
          species: (doc.species_info && doc.species_info.species_name_zh) || '',
          confidence: confidenceLevel
        })
      }
    } catch (e) {
      console.error(e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async onSaveAtlas() {
    if (!this.data.recordId) {
      wx.showToast({ title: '暂无鉴定记录', icon: 'none' })
      return
    }
    if (this.data.bookmarked) {
      wx.showToast({ title: '已在图鉴中', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    try {
      const cat = inferCollectionCategory(this.data.speciesInfo.taxonomy, this.data.speciesInfo.species_name_zh)

      await db.collection('user_collection').add({
        data: {
          record_id: this.data.recordId,
          category: cat,
          created_at: Date.now()
        }
      })

      await db.collection('identification_records').doc(this.data.recordId).update({
        data: {
          is_bookmarked: true,
          updated_at: Date.now()
        }
      })

      this.setData({ bookmarked: true, saving: false })
      trackBehavior('identify_save_atlas', 'identification', this.data.recordId, {
        category: cat
      })
      wx.showToast({ title: '已保存到图鉴', icon: 'success' })
    } catch (e) {
      console.error(e)
      this.setData({ saving: false })
      wx.showToast({ title: '保存失败，请检查权限', icon: 'none' })
    }
  },

  openFeedback() {
    this.setData({ showFeedback: true, feedbackZh: '', feedbackNote: '' })
  },

  closeFeedback() {
    this.setData({ showFeedback: false })
  },

  noop() {},

  onFeedbackZh(e) {
    this.setData({ feedbackZh: e.detail.value })
  },

  onFeedbackNote(e) {
    this.setData({ feedbackNote: e.detail.value })
  },

  async submitFeedback() {
    const zh = (this.data.feedbackZh || '').trim()
    if (!zh) {
      wx.showToast({ title: '请填写您认为正确的中文名', icon: 'none' })
      return
    }
    if (!this.data.recordId) {
      wx.showToast({ title: '暂无鉴定记录', icon: 'none' })
      return
    }
    this.setData({ feedbackSubmitting: true })
    try {
      await db.collection('identification_feedback').add({
        data: {
          record_id: this.data.recordId,
          corrected_name_zh: zh,
          note: (this.data.feedbackNote || '').trim(),
          original_name_zh: (this.data.speciesInfo && this.data.speciesInfo.species_name_zh) || '',
          created_at: Date.now()
        }
      })
      trackBehavior('identify_feedback_submit', 'identification', this.data.recordId, {
        corrected: zh
      })
      this.setData({ showFeedback: false, feedbackSubmitting: false })
      wx.showToast({ title: '感谢反馈', icon: 'success' })
    } catch (e) {
      console.error(e)
      this.setData({ feedbackSubmitting: false })
      wx.showToast({ title: '提交失败', icon: 'none' })
    }
  },

  onGoShare() {
    if (!this.data.recordId) {
      wx.showToast({ title: '暂无鉴定记录', icon: 'none' })
      return
    }
    trackBehavior('identify_share_poster', 'identification', this.data.recordId, {
      species: (this.data.speciesInfo && this.data.speciesInfo.species_name_zh) || ''
    })
    wx.navigateTo({
      url: `/pages/identify/share/index?record_id=${this.data.recordId}`
    })
  },

  onRetake() {
    trackBehavior('identify_retake_click', 'identification', this.data.recordId || 'retake', {
      confidence: this.data.confidenceLevel
    })
    wx.redirectTo({ url: '/pages/identify/index?from=retake' })
  },

  onExpertHelp() {
    trackBehavior('identify_expert_cta', 'identification', this.data.recordId || '', { type: 'support' })
    wx.navigateTo({ url: '/pages/user/support/index?topic=identify' })
  },

  onViewProducts() {
    const first = this.data.relatedProducts[0]
    if (first && first._id) {
      this.goProductDetail(first._id)
    }
  },

  goProductDetail(id) {
    if (!id) return
    trackBehavior('identify_to_product', 'product', id, {
      recordId: this.data.recordId || '',
      species: (this.data.speciesInfo && this.data.speciesInfo.species_name_zh) || ''
    })
    const qs = this.data.recordId ? `&from=identify&recordId=${this.data.recordId}` : '&from=identify'
    wx.navigateTo({ url: `/pages/detail/index?id=${id}${qs}` })
  },

  onProductTap(e) {
    const id = e.currentTarget.dataset.id
    this.goProductDetail(id)
  },

  onWikiTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    trackBehavior('identify_to_wiki', 'wiki', id, {
      recordId: this.data.recordId || ''
    })
    wx.navigateTo({ url: `/pages/detail/wiki-detail?id=${id}&from=identify` })
  },

  onGoGallery() {
    let cat = this.data.galleryCategory
    if (cat && cat !== '其他') {
      app.globalData.targetCategory = cat
    }
    trackBehavior('identify_to_gallery', 'category', cat || 'all', {
      recordId: this.data.recordId || ''
    })
    wx.switchTab({ url: '/pages/category/index' })
  },

  onGoAtlas() {
    wx.navigateTo({ url: '/pages/collection/index' })
  },

  onAgain() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({ url: '/pages/identify/index' })
      }
    })
  },

  onShareAppMessage() {
    const si = this.data.speciesInfo || {}
    const zh = si.species_name_zh || '自然标本'
    return {
      title: `我在山海造物鉴定了「${zh}」`,
      path: this.data.recordId
        ? `/pages/identify/result/index?record_id=${this.data.recordId}`
        : '/pages/identify/index'
    }
  }
})
