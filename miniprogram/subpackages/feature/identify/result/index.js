// 鉴定结果页：云库记录展示；支持小程序码 scene 扫码进入与纠错反馈
const app = getApp()
const { inferCollectionCategory } = require('../../utils/speciesCategory')
const { trackBehavior } = require('../../../../utils/trackBehavior')
const { normalizeProfile, needsProfileEnrich } = require('../../utils/speciesProfile')
const { callAtlas, emptyUnlockSheet } = require('../../utils/atlas')
const db = wx.cloud.database()

/**
 * 由物种档案区块派生「鉴定百科」导航项。
 * 只做浅映射（id + title），不克隆 profile 对象——避免把 blocks/mapState 等大字段重复塞进 setData。
 * `source`（著录来源）区块在 wxml 中被 hidden，故不生成导航项。
 */
function buildArchiveNav(profile) {
  const blocks = (profile && profile.blocks) || []
  return blocks
    .filter((b) => b && b.id && b.visible !== false && b.type !== 'source' && b.title)
    .map((b) => ({ id: String(b.id), title: String(b.title) }))
}

function isDeniedText(msg) {
  return /permission denied|PERMISSION_DENIED|-502003/i.test(String(msg || ''))
}

/** 加载失败文案：数据库原始报错（errCode / errMsg / 文档链接）不上屏 */
function friendlyLoadErrorText(msg) {
  const t = String(msg || '')
  if (isDeniedText(t)) return '这份鉴定记录暂时无法查看：可能还没有公开分享，或不属于当前微信账号。'
  if (/errCode|errMsg|https?:\/\//i.test(t)) return ''
  return t
}

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
    // 鉴定百科导航：由 speciesProfile.blocks 派生（此前 wxml 引用了但 js 从未定义 → 死 UI）
    archiveNav: [],
    activeArchiveId: '',
    showFallback: false,
    bookmarked: false,
    saving: false,
    /** 是否为本人记录（他人经分享海报查看时为 false） */
    isOwner: true,
    showFeedback: false,
    // 注册引导（2026-09-17）：原地授权弹窗 + **整页正文灰色模糊**，不再跳注册页
    showRegisterDialog: false,
    registerGated: false,
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
      // 备选只带 0–1 的 confidence；页面显示用的百分比在这里算（原先 confidencePct 从未赋值，备选置信度一直空白）
      const alternatives = ((doc.species_info && doc.species_info.alternatives) || []).map((a) => {
        const c = a && typeof a.confidence === 'number' ? Math.max(0, Math.min(1, a.confidence)) : null
        return c === null ? a : { ...a, confidencePct: `${Math.round(c * 100)}%` }
      })
      const relatedProducts = doc.related_products_snapshot || []
      const relatedWiki = doc.related_wiki_snapshot || []
      const speciesInfo = doc.species_info || {}
      const showSpeciesArchive = speciesInfo.is_specimen !== false
      const speciesProfile = showSpeciesArchive ? normalizeProfile(doc.species_profile) : normalizeProfile(null)
      const archiveNav = buildArchiveNav(speciesProfile)

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
        archiveNav,
        activeArchiveId: archiveNav.length ? archiveNav[0].id : '',
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

      // 需求 3（业务决策 2026-09-16：**先识别后解锁**）：
      // 结果已经渲染出来（识别成本已花），再以「一键注册」弹窗把查看结果转成注册。
      this.maybeGateResultForRegistration()

      this.autoCollectPhoto(speciesInfo, this.data.recordId)
    } catch (e) {
      console.error(e)
      const msg = (e && e.message) || ''
      const kind = /还没有公开分享|未公开分享/.test(msg)
        ? 'unshared'
        : /记录不存在|缺少/.test(msg) || isDeniedText(msg)
          ? 'missing'
          : 'network'
      if (kind !== 'unshared' && (await this.redirectIfProductId(id))) return
      this.setData({
        loadError: true,
        loadErrorKind: kind,
        loadErrorMsg: friendlyLoadErrorText(msg)
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 商品 _id 与鉴定记录 _id 同为 hex，入口路由一旦误判（2026-10-10 商品知识卡码）就会把商品 id 送到本页。
   * 读不到鉴定记录时查一次商品：确是商品就换到商品详情（本页常是 reLaunch 来的唯一一页，用 redirectTo 不留回退死页）。
   */
  async redirectIfProductId(id) {
    const pid = String(id || '').trim()
    if (!pid || pid.length > 64) return false
    try {
      const res = await db.collection('products').doc(pid).get()
      if (!res || !res.data) return false
    } catch (e) {
      return false
    }
    const url = `/subpackages/feature/detail/index?id=${encodeURIComponent(pid)}`
    wx.redirectTo({ url, fail: () => wx.reLaunch({ url }) })
    return true
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
      // 补全后区块可能变多：同步刷新百科导航
      this.syncArchiveNav()
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

  /** 百科导航：点按滚到对应区块（区块已有 id="archive-<id>" 锚点） */
  onArchiveNavTap(e) {
    const id = (e.currentTarget.dataset && e.currentTarget.dataset.id) || ''
    if (!id) return
    this.setData({ activeArchiveId: id })
    // 收起态下目标行数可能不足，先确保该区块展开，滚动位置更稳定
    if (this.data.sectionExpanded[id] === false) {
      this.setData({ [`sectionExpanded.${id}`]: true })
    }
    wx.pageScrollTo({
      selector: `#archive-${id}`,
      duration: 260,
      fail: () => {
        // 极少数机型不支持 selector，回退为按 query 取位置
        wx.createSelectorQuery()
          .select(`#archive-${id}`)
          .boundingClientRect()
          .selectViewport()
          .scrollOffset()
          .exec((res) => {
            const rect = res && res[0]
            const scroll = res && res[1]
            if (!rect || !scroll) return
            wx.pageScrollTo({
              scrollTop: scroll.scrollTop + rect.top - 12,
              duration: 260
            })
          })
      }
    })
  },

  /** 补全/换记录后重建导航项，并保持当前高亮有效 */
  syncArchiveNav() {
    const archiveNav = buildArchiveNav(this.data.speciesProfile)
    const stillValid = archiveNav.some((n) => n.id === this.data.activeArchiveId)
    this.setData({
      archiveNav,
      activeArchiveId: stillValid ? this.data.activeArchiveId : (archiveNav[0] ? archiveNav[0].id : '')
    })
  },

  /** 滚动时同步导航高亮（节流 150ms，且仅在区块集合非空时工作） */
  onPageScroll() {
    if (!this.data.archiveNav.length || this._navSpyBusy) return
    if (this._navSpyTimer) return
    this._navSpyTimer = setTimeout(() => {
      this._navSpyTimer = null
      this.updateActiveArchiveByScroll()
    }, 150)
  },

  updateActiveArchiveByScroll() {
    if (this._navSpyBusy || !this.data.archiveNav.length) return
    this._navSpyBusy = true
    const ids = this.data.archiveNav.map((n) => n.id)
    const query = wx.createSelectorQuery()
    ids.forEach((id) => query.select(`#archive-${id}`).boundingClientRect())
    query.selectViewport().scrollOffset()
    query.exec((res) => {
      this._navSpyBusy = false
      if (!res || !res.length) return
      const threshold = 140 // 视口顶部往下 140px 内视为「当前区块」
      let current = ids[0]
      for (let i = 0; i < ids.length; i++) {
        const rect = res[i]
        if (!rect) continue
        if (rect.top - threshold <= 0) current = ids[i]
        else break
      }
      if (current && current !== this.data.activeArchiveId) {
        this.setData({ activeArchiveId: current })
      }
    })
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
    this.resumeResultGateAfterRegister()
  },

  /**
   * 需求 3（决策：先识别后解锁）：结果渲染完成后，用「一键注册」把查看结果转成注册。
   *
   * 设计要点：
   *   - **结果已经渲染**（识别成本已花）→ 弹窗只是转化钩子，不是内容门禁；
   *     关闭弹窗后用户仍能查看结果（不阻断体验，也不制造「看不到」的差评）
   *   - **仅本人**触发（`isOwner`）：别人通过分享进来不该被要求注册
   *   - **每个页面实例只弹一次**（`_resultGateShown`）：onShow 回流不重复打扰
   *   - 已注册用户直接跳过（不浪费一次弹窗）
   */
  async maybeGateResultForRegistration() {
    if (this._resultGateShown) return
    if (!this.data.recordId || !this.data.isOwner) return
    this._resultGateShown = true
    try {
      const { ensureSession } = require('../../../../utils/userSession')
      const { resolveAuthState } = require('../../../../utils/profileHelper')
      const session = await ensureSession(app)
      const state = session.authState || resolveAuthState(session.user)
      if (state !== 'guest') return

      trackBehavior('identify_result_gate', 'identification', this.data.recordId, { step: 'show' })
      // 2026-09-17（已按产品口径收紧）：不再 navigateTo 注册页 —— 原地弹授权弹窗并默认注册成功；
      // 同时**整页正文灰色模糊**且**不提供「先看看」**。
      // 说明：这与需求 3 早期「弹窗只是转化钩子、可关闭」的决策不同，是本次明确改为内容门禁；
      // 由 test:register-gate 守住（closable=false + .rg-gate.is-gated 必须在）。
      this.setData({ showRegisterDialog: true, registerGated: true })
    } catch (e) {
      console.warn('maybeGateResultForRegistration', e)
    }
  },

  /** 原地注册成功：刷新会话态 + 收口漏斗（不再依赖 onboarding 回流 intent） */
  async onRegisterSuccess() {
    this.setData({ showRegisterDialog: false, registerGated: false })
    trackBehavior('identify_result_gate', 'identification', this.data.recordId, { step: 'resume_success' })
    try {
      const { refreshSessionAfterAuth } = require('../../../../utils/userSession')
      await refreshSessionAfterAuth(app)
    } catch (e) { /* 会话刷新失败不影响「已注册成功」这个事实 */ }
    try {
      const { invalidateAfterProfile } = require('../../utils/cacheInvalidate')
      invalidateAfterProfile()
    } catch (e) { /* ignore */ }
    wx.showToast({ title: '注册成功', icon: 'success' })
  },

  /** 点「一键注册」即上报去注册（与祈福墙 / 保存图鉴钩子同一 step） */
  onRegisterCta() {
    if (!this.data.recordId) return
    trackBehavior('identify_result_gate', 'identification', this.data.recordId, { step: 'go_register' })
  },

  /** 「先不注册」：离开本页（扫码直进只有一页时回首页）；不解模糊，门禁内容不因拒绝而露出 */
  onRegisterDialogClose() {
    trackBehavior('identify_result_gate', 'identification', this.data.recordId, { step: 'dismiss' })
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ fail: () => this.goHomeTab() })
    } else {
      this.goHomeTab()
    }
  },

  /** 注册回流（from=identify_result）：标记漏斗闭环，并刷新会话态 */
  async resumeResultGateAfterRegister() {
    if (this._resumingResultGate) return
    const {
      peekOnboardingReturn,
      consumeOnboardingReturn,
      refreshSessionAfterAuth,
      hasPhone
    } = require('../../../../utils/userSession')
    const intent = peekOnboardingReturn()
    if (!intent || intent.from !== 'identify_result') return
    this._resumingResultGate = true
    try {
      const session = await refreshSessionAfterAuth(getApp())
      consumeOnboardingReturn()
      if (!hasPhone(session)) {
        wx.showToast({ title: '授权未完成，请再试一次', icon: 'none' })
        return
      }
      if (this.data.recordId) {
        trackBehavior('identify_result_gate', 'identification', this.data.recordId, { step: 'resume_success' })
      }
    } catch (e) {
      console.warn('resumeResultGateAfterRegister', e)
    } finally {
      this._resumingResultGate = false
    }
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
    wx.navigateTo({ url: '/subpackages/extra/user/support/index?topic=identify' })
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
