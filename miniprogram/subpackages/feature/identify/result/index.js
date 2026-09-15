// 鉴定结果页：云库记录展示；支持小程序码 scene 扫码进入与纠错反馈
const app = getApp()
const { inferCollectionCategory } = require('../../utils/speciesCategory')
const { trackBehavior } = require('../../../../utils/trackBehavior')
const { normalizeProfile, needsProfileEnrich } = require('../../utils/speciesProfile')
const { callAtlas, emptyUnlockSheet } = require('../../utils/atlas')
const db = wx.cloud.database()

Page({
  data: {
    loading: true,
    loadError: false,
    loadErrorKind: '',
    loadErrorMsg: '',
    shareMarked: false,
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
    speciesProfile: normalizeProfile(null),
    showSpeciesArchive: false,
    profileEnriching: false,
    profileEnrichError: false,
    sectionExpanded: {},
    showFallback: false,
    bookmarked: false,
    saving: false,
    /** 是否为本人记录（他人经分享海报查看时为 false） */
    isOwner: true,
    showFeedback: false,
    feedbackZh: '',
    feedbackNote: '',
    feedbackSubmitting: false,
    unlockSheet: emptyUnlockSheet()
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
      setTimeout(() => wx.redirectTo({ url: '/subpackages/feature/identify/index' }), 800)
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
          this.setData({ loading: false, loadError: true })
          wx.showToast({ title: '缺少记录', icon: 'none' })
        }
      }, 200)
    }
  },

  async loadRecord(id) {
    this.setData({ loading: true })
    try {
      const { doc, isOwner } = await this.fetchRecordDoc(id)
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
      const speciesInfo = doc.species_info || {}
      const showSpeciesArchive = speciesInfo.is_specimen !== false
      const speciesProfile = showSpeciesArchive ? normalizeProfile(doc.species_profile) : normalizeProfile(null)

      this.setData({
        speciesInfo,
        aiContent: doc.ai_content || {},
        displayImage: url,
        bookmarked: !!doc.is_bookmarked,
        isOwner: isOwner !== false,
        loadErrorMsg: '',
        confidenceLevel,
        alternatives,
        rootCategoryTag,
        relatedProducts,
        relatedWiki,
        galleryCategory,
        speciesProfile,
        showSpeciesArchive,
        loadError: false,
        showFallback: relatedProducts.length === 0 && relatedWiki.length === 0 && speciesInfo.is_specimen !== false
      })

      if (showSpeciesArchive && needsProfileEnrich(doc.species_profile)) {
        this.enrichSpeciesProfile(speciesInfo, doc.ai_content || {}, relatedProducts)
      }

      if (this.data.recordId) {
        trackBehavior('identify_result_view', 'identification', this.data.recordId, {
          species: (doc.species_info && doc.species_info.species_name_zh) || '',
          confidence: confidenceLevel
        })
      }

      this.autoCollectPhoto(speciesInfo, this.data.recordId)
    } catch (e) {
      console.error(e)
      const msg = (e && e.message) || ''
      const kind = /还没有公开分享|未公开分享/.test(msg)
        ? 'unshared'
        : /记录不存在|缺少/.test(msg)
          ? 'missing'
          : 'network'
      this.setData({
        loadError: true,
        loadErrorKind: kind,
        loadErrorMsg: msg
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 读鉴定记录：优先云函数 get_record（服务端读，覆盖「本人」与「他人已分享」两种场景），
   * 云函数尚未部署该 action 或临时异常时，回退客户端直读（本人记录仍可读）。
   */
  async fetchRecordDoc(id) {
    const cf = await wx.cloud
      .callFunction({ name: 'identifySpecimen', data: { action: 'get_record', record_id: id } })
      .catch(() => null)
    const r = (cf && cf.result) || {}
    if (r.success && r.data && r.data.doc) {
      return { doc: r.data.doc, isOwner: r.data.is_owner !== false }
    }
    // 云函数这条路失败（未部署该 action / 超时 / 服务端异常）时一律回退客户端直读：
    // 本人记录由安全规则 `doc._openid == auth.openid` 放行，能读就不该让用户卡在报错页。
    // 只有直读也被拒时，才把「无权 / 未分享」的结论抛给用户。
    const denied =
      r.code === 'FORBIDDEN' || /无权|未公开分享|记录不存在/.test(String(r.msg || ''))
    // 未公开分享是最常见的一种：给出可执行的下一步，而不是让用户对着报错页发呆
    const denyText = /未公开分享/.test(String(r.msg || ''))
      ? '这条鉴定还没有公开分享，可请分享者重新分享一次'
      : r.msg || '记录读取失败'
    try {
      const res = await db.collection('identification_records').doc(id).get()
      if (res && res.data) return { doc: res.data, isOwner: true }
    } catch (e) {
      if (denied) throw new Error(denyText)
      throw e
    }
    if (denied) throw new Error(denyText)
    throw new Error('记录不存在')
  },

  async enrichSpeciesProfile(speciesInfo, aiContent, relatedProducts, force) {
    if (!this.data.recordId) return
    this.setData({ profileEnriching: true, profileEnrichError: false })
    try {
      const res = await wx.cloud.callFunction({
        name: 'identifySpecimen',
        data: {
          action: 'get_species_profile',
          record_id: this.data.recordId,
          species_info: speciesInfo,
          ai_content: aiContent,
          related_products: relatedProducts || [],
          force_refresh: !!force
        }
      })
      const profile = res && res.result && res.result.data && res.result.data.species_profile
      if (!profile) {
        throw new Error((res && res.result && res.result.msg) || '补全失败')
      }
      this.setData({
        speciesProfile: normalizeProfile(profile),
        profileEnriching: false,
        profileEnrichError: false
      })
    } catch (e) {
      console.warn('物种档案补全跳过', e)
      this.setData({ profileEnriching: false, profileEnrichError: true })
    }
  },

  retryEnrichProfile() {
    const { speciesInfo, aiContent, relatedProducts } = this.data
    this.enrichSpeciesProfile(speciesInfo, aiContent, relatedProducts, true)
  },

  toggleSection(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const key = `sectionExpanded.${id}`
    this.setData({ [key]: !this.data.sectionExpanded[id] })
  },

  retryLoad() {
    if (!this.data.recordId) {
      wx.redirectTo({ url: '/subpackages/feature/identify/index' })
      return
    }
    this.setData({ loadError: false, loading: true })
    this.loadRecord(this.data.recordId)
  },

  goIdentifyHome() {
    wx.redirectTo({
      url: '/subpackages/feature/identify/index',
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    })
  },

  goHomeTab() {
    wx.switchTab({
      url: '/pages/index/index',
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    })
  },

  async autoCollectPhoto(speciesInfo, recordId) {
    if (!speciesInfo || speciesInfo.is_specimen === false || !recordId) return
    try {
      const res = await callAtlas('collect', {
        method: 'photo',
        names: [speciesInfo.species_name_zh, speciesInfo.species_name_latin],
        recordId,
        place: '镜头'
      })
      if (res && res.success && (res.first || res.first) && res.species && res.species.id) {
        this.setData({
          unlockSheet: {
            show: true,
            nameZh: res.species.nameZh || '',
            nameLatin: res.species.nameLatin || '',
            id: res.species.id,
            msg: res.msg || '这一页被翻开了'
          }
        })
      } else if (res && res.success && (res.first || res.first) && res.msg) {
        wx.showToast({ title: res.msg, icon: 'none', duration: 2400 })
      }
    } catch (e) {
      console.warn('autoCollectPhoto', e)
    }
  },

  async onSaveAtlas() {
    if (!this.data.recordId) {
      wx.showToast({ title: '暂无鉴定记录', icon: 'none' })
      return
    }
    // 已加入：走状态条 onGoAtlas，此处仅作防护
    if (this.data.bookmarked) {
      this.onGoAtlas()
      return
    }
    if (this.data.saving) return

    // 他人分享的鉴定：不允许写入自己的图鉴（服务端同样拒绝），引导去拍自己的标本
    if (!this.data.isOwner) {
      wx.showToast({ title: '这是他人分享的鉴定，去拍一件自己的吧', icon: 'none' })
      return
    }

    // 注册钩子：未注册用户写入图鉴前引导注册（授权手机号 + 新客礼包），注册完成后自动续写
    const { ensureSession, promptPhoneBind, peekOnboardingReturn } = require('../../../../utils/userSession')
    const { resolveAuthState } = require('../../../../utils/profileHelper')
    const session = await ensureSession(app)
    const state = session.authState || resolveAuthState(session.user)
    if (state !== 'guest' && session.user && session.user.nickName) {
      await this.performSaveAtlas()
      return
    }

    // 埋点：注册引导漏斗 —— show（弹窗）/ go_register（去注册）/ dismiss（暂不保存）
    trackBehavior('identify_save_atlas_gate', 'identification', this.data.recordId, { step: 'show' })
    await promptPhoneBind({
      title: '收进山海图鉴',
      content: '授权手机号即可完成注册，把这次鉴定写入你的山海图鉴，新客礼包将自动到账。',
      confirmText: '去注册',
      cancelText: '暂不保存',
      from: 'atlas',
      returnMode: 'back',
      resumeSubmit: true
    })
    const intent = peekOnboardingReturn()
    trackBehavior('identify_save_atlas_gate', 'identification', this.data.recordId, {
      step: intent && intent.from === 'atlas' ? 'go_register' : 'dismiss'
    })
  },

  onShow() {
    this.resumeSaveAfterRegister()
  },

  /** 注册完成后回流：自动续写图鉴（onboarding 'back' 模式标记 pendingResume） */
  async resumeSaveAfterRegister() {
    if (this._resumingSave) return
    const {
      peekOnboardingReturn,
      consumeOnboardingReturn,
      refreshSessionAfterAuth,
      hasPhone
    } = require('../../../../utils/userSession')
    const intent = peekOnboardingReturn()
    if (!intent || intent.from !== 'atlas') return
    if (!intent.pendingResume) {
      // 进入注册页但未完成即返回：清理本次意图，不自动写入
      consumeOnboardingReturn()
      return
    }
    this._resumingSave = true
    try {
      const session = await refreshSessionAfterAuth(getApp())
      consumeOnboardingReturn()
      if (!hasPhone(session)) {
        wx.showToast({ title: '授权未完成，请再试一次', icon: 'none' })
        return
      }
      if (!this.data.recordId || this.data.bookmarked || this.data.saving) return
      await this.performSaveAtlas()
      trackBehavior('identify_save_atlas_gate', 'identification', this.data.recordId, { step: 'resume_success' })
    } catch (e) {
      console.warn('resumeSaveAfterRegister', e)
    } finally {
      this._resumingSave = false
    }
  },

  async performSaveAtlas() {
    this.setData({ saving: true })
    try {
      const cat = inferCollectionCategory(this.data.speciesInfo.taxonomy, this.data.speciesInfo.species_name_zh)
      const cf = await wx.cloud.callFunction({
        name: 'identifySpecimen',
        data: {
          action: 'save_atlas',
          record_id: this.data.recordId,
          category: cat
        }
      })
      const res = (cf && cf.result) || {}
      if (!res.success) throw new Error(res.msg || '保存失败')

      this.autoCollectPhoto(this.data.speciesInfo, this.data.recordId)

      this.setData({ bookmarked: true, saving: false })
      trackBehavior('identify_save_atlas', 'identification', this.data.recordId, {
        category: cat
      })
      wx.showToast({ title: '已写入山海图鉴', icon: 'none' })
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
      const cf = await wx.cloud.callFunction({
        name: 'identifySpecimen',
        data: {
          action: 'submit_feedback',
          record_id: this.data.recordId,
          corrected_name_zh: zh,
          note: (this.data.feedbackNote || '').trim(),
          original_name_zh: (this.data.speciesInfo && this.data.speciesInfo.species_name_zh) || ''
        }
      })
      const res = (cf && cf.result) || {}
      if (!res.success) throw new Error(res.msg || '提交失败')
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
    const go = () => {
      wx.navigateTo({
        url: `/subpackages/feature/identify/share/index?record_id=${this.data.recordId}`
      })
    }
    this.markRecordShared('poster_entry')
      .then(go)
      .catch(go)
  },

  /**
   * 分享即公开：返回 Promise，供 onShareAppMessage 等待，避免先发出去后标记的竞态。
   */
  markRecordShared(channel) {
    if (!this.data.isOwner || !this.data.recordId) {
      return Promise.resolve(false)
    }
    trackBehavior('identify_share_link', 'identification', this.data.recordId, {
      channel: channel || 'wechat',
      species: (this.data.speciesInfo && this.data.speciesInfo.species_name_zh) || ''
    })
    const call = () =>
      wx.cloud.callFunction({
        name: 'identifySpecimen',
        data: { action: 'mark_shared', record_id: this.data.recordId, shared: true }
      })
    return call()
      .then((res) => {
        const ok = !!(res && res.result && res.result.success)
        if (!ok) throw new Error((res && res.result && res.result.msg) || '标记失败')
        this.setData({ shareMarked: true })
        return true
      })
      .catch(() =>
        call()
          .then((res) => {
            const ok = !!(res && res.result && res.result.success)
            if (ok) this.setData({ shareMarked: true })
            return ok
          })
          .catch(() => false)
      )
  },

  onRetake() {
    trackBehavior('identify_retake_click', 'identification', this.data.recordId || 'retake', {
      confidence: this.data.confidenceLevel
    })
    wx.redirectTo({ url: '/subpackages/feature/identify/index?from=retake' })
  },

  onExpertHelp() {
    trackBehavior('identify_expert_cta', 'identification', this.data.recordId || '', { type: 'support' })
    wx.navigateTo({ url: '/subpackages/feature/user/support/index?topic=identify' })
  },

  onViewProducts() {
    const first = this.data.relatedProducts[0]
    if (first && first._id) {
      this.goProductDetail(first._id)
      return
    }
    wx.showToast({ title: '暂无相关藏品', icon: 'none' })
  },

  goProductDetail(id) {
    if (!id) {
      wx.showToast({ title: '藏品不存在', icon: 'none' })
      return
    }
    trackBehavior('identify_to_product', 'product', id, {
      recordId: this.data.recordId || '',
      species: (this.data.speciesInfo && this.data.speciesInfo.species_name_zh) || ''
    })
    const qs = this.data.recordId ? `&from=identify&recordId=${this.data.recordId}` : '&from=identify'
    wx.navigateTo({
      url: `/subpackages/feature/detail/index?id=${id}${qs}`,
      fail: () => wx.showToast({ title: '无法打开藏品', icon: 'none' })
    })
  },

  onProductTap(e) {
    const id = e.currentTarget.dataset.id
    this.goProductDetail(id)
  },

  onWikiTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '档案不存在', icon: 'none' })
      return
    }
    trackBehavior('identify_to_wiki', 'wiki', id, {
      recordId: this.data.recordId || ''
    })
    wx.navigateTo({
      url: `/subpackages/feature/detail/wiki-detail/index?id=${id}&from=identify`,
      fail: () => wx.showToast({ title: '无法打开档案', icon: 'none' })
    })
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
    wx.navigateTo({ url: '/subpackages/feature/collection/index' })
  },

  onUnlockOpen() {
    const id = this.data.unlockSheet.id
    this.setData({ unlockSheet: emptyUnlockSheet() })
    if (!id) {
      this.onGoAtlas()
      return
    }
    wx.navigateTo({
      url: `/subpackages/feature/collection/detail/index?id=${id}&first=1`
    })
  },

  onUnlockStay() {
    this.setData({ unlockSheet: emptyUnlockSheet() })
  },

  onAgain() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({ url: '/subpackages/feature/identify/index' })
      }
    })
  },

  buildSharePayload() {
    const si = this.data.speciesInfo || {}
    const zh = si.species_name_zh || '自然标本'
    const path = this.data.recordId
      ? `/subpackages/feature/identify/result/index?record_id=${this.data.recordId}`
      : '/subpackages/feature/identify/index'
    return {
      title: `我在山海造物鉴定了「${zh}」`,
      path,
      imageUrl: this.data.displayImage || ''
    }
  },

  onShareAppMessage() {
    const payload = this.buildSharePayload()
    return this.markRecordShared('wechat').then(() => payload).catch(() => payload)
  },

  onShareTimeline() {
    const si = this.data.speciesInfo || {}
    const query = this.data.recordId ? `record_id=${this.data.recordId}` : ''
    const payload = {
      title: `我在山海造物鉴定了「${si.species_name_zh || '自然标本'}」`,
      query,
      imageUrl: this.data.displayImage || ''
    }
    return this.markRecordShared('timeline').then(() => payload).catch(() => payload)
  }
})
