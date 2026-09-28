// subpackages/extra/user/profile/index.js
const app = getApp()
const {
  INTEREST_OPTIONS,
  GENDER_OPTIONS,
  MBTI_OPTIONS,
  ZODIAC_OPTIONS
} = require('../../../../utils/profileConstants')
const { zodiacFromBirthday, calcProfileScore, buildInterestChips, sanitizeNickName } = require('../../../../utils/profileHelper')
const { ensureSession, fetchUserSession, clearLocalSession } = require('../../../../utils/userSession')
const { pickAvatarImage, avatarExtFromPath, toastAvatarPickError } = require('../../../../utils/pickAvatar')
const { getPageNavInsets } = require('../../utils/pageNav')
const {
  DISPLAY_OPTIONS,
  PREF_VEIL,
  PREF_CLEAR,
  getSensitiveBlurPref,
  setSensitiveBlurPref
} = require('../../../../utils/sensitiveBlur')

const LEAVE_MESSAGE = '资料尚未保存，确定离开？'

/**
 * 需求 21：档案「下一步」清单 —— 与 calcProfileScore 的加分项**逐项对应**（gain 即分值），
 * 顺序即推荐顺序（高收益在前）。anchor 指向 WXML 上的字段 id，点条目滚过去并给一句怎么做。
 */
const NEXT_STEP_DEFS = [
  { key: 'phone', gain: 25, label: '绑定手机号', desc: '下单、预约与门店通知的前提', anchor: '#field-phone', hint: '点下方按钮完成手机号绑定' },
  { key: 'avatar', gain: 15, label: '上传头像', desc: '让专员在门店认得出你', anchor: '#field-avatar', hint: '点头像即可更换' },
  { key: 'birthday', gain: 15, label: '填写生日', desc: '生日当天自动发礼券与祝福', anchor: '#field-birthday', hint: '选择出生日期' },
  { key: 'interests', gain: 15, label: '选择兴趣偏好', desc: '馆藏与活动推荐更贴合', anchor: '#field-interests', hint: '最多选 5 项' },
  { key: 'nickName', gain: 10, label: '设定藏家代号', desc: '礼券与订单上的称呼', anchor: '#field-nick', hint: '填写你的藏家代号' },
  { key: 'mbti', gain: 8, label: '填写 MBTI', desc: '可选，默认仅自己可见', anchor: '#field-mbti', hint: '点选你的 MBTI' },
  { key: 'zodiac', gain: 7, label: '选择星座', desc: '可选，默认仅自己可见', anchor: '#field-zodiac', hint: '点选你的星座' },
  { key: 'gender', gain: 5, label: '选择性别', desc: '可选，便于更贴切的称呼', anchor: '#field-gender', hint: '点选性别' }
]

/** 缺哪些（口径与 calcProfileScore 一致，含占位昵称不算已填） */
function buildNextSteps(d) {
  const present = {
    phone: !!d.phoneBound,
    avatar: !!String(d.avatarUrl || ''),
    birthday: !!String(d.birthday || ''),
    interests: Array.isArray(d.interests) && d.interests.length > 0,
    nickName: !!sanitizeNickName(d.nickName),
    mbti: !!String(d.mbti || ''),
    zodiac: !!String(d.zodiac || ''),
    gender: !!String(d.gender || '')
  }
  return NEXT_STEP_DEFS.filter((step) => !present[step.key])
}

function todayDateStr() {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

function buildRewardHint(user) {
  if (!user) return '填写昵称与手机号即可完成注册并领取新客礼包；头像、生日等可稍后补充。'
  if (!user.birthday) {
    return '填写生日后，生日当天可领取生日礼券与祝福。兴趣偏好可帮助馆藏推荐。'
  }
  if (user.profileRewardClaimed || user.onboardingDone) {
    return '基础注册已完成。新客礼券可在我的礼券夹查看；礼包不含积分。'
  }
  return '完成昵称与手机号绑定后发放新客礼包；头像、生日、兴趣可随时补充。'
}

Page({
  data: {
    statusBarHeight: 20,
    navPaddingRight: 16,
    headerBlockPx: 88,
    footerPadPx: 120,
    loading: true,
    loadError: false,
    saving: false,
    isDirty: false,
    profileScore: 0,
    avatarRingStyle: '',
    avatarPickError: false,
    avatarLoadError: false,
    avatarSaving: false,
    memberNo: '',
    nickName: '',
    avatarUrl: '',
    phoneMasked: '',
    phoneBound: false,
    gender: '',
    birthday: '',
    birthdayMax: todayDateStr(),
    interests: [],
    interestChips: [],
    mbti: '',
    zodiac: '',
    bio: '',
    bioLength: 0,
    privacy: { showMbti: false, showZodiac: false, showBirthday: false },
    genderOptions: GENDER_OPTIONS,
    interestOptions: INTEREST_OPTIONS,
    mbtiOptions: MBTI_OPTIONS,
    zodiacOptions: ZODIAC_OPTIONS,
    sensitiveBlurPref: '',
    sensitiveOptions: DISPLAY_OPTIONS,
    rewardHint: '',
    footerPrimaryText: '保存资料',
    /** 需求 21：「下一步」清单（空缺项 / 折叠计数 / 是否已完整） */
    nextSteps: [],
    nextStepsMore: 0,
    nextStepsTotal: 0,
    nextStepsDone: false
  },

  onLoad(options) {
    this._savedSnapshot = ''
    this._focusField = String((options && options.focus) || '').trim()
    this.initLayout()
    this.loadProfile()
  },

  onReady() {
    this.remeasureChrome()
  },

  onShow() {
    this.syncLeaveGuard()
    this.remeasureChrome()
  },

  onHide() {
    this.disableLeaveGuard()
  },

  onUnload() {
    this.disableLeaveGuard()
  },

  initLayout() {
    const nav = getPageNavInsets({ nativeNav: true })
    const footerPadPx = this.estimateFooterPadPx()
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navPaddingRight: nav.navPaddingRight,
      headerBlockPx: nav.headerBlockPx,
      footerPadPx
    })
  },

  estimateFooterPadPx() {
    try {
      const sys = wx.getSystemInfoSync()
      const safe = (sys.safeAreaInsets && sys.safeAreaInsets.bottom) || 0
      // 底栏约 88rpx 按钮 + padding ≈ 120~140px 量级，按屏宽换算
      const rpx = (sys.windowWidth || 375) / 750
      return Math.ceil(140 * rpx * 2) + safe + 24
    } catch (e) {
      return 140
    }
  },

  remeasureChrome() {
    const fallback = getPageNavInsets({ nativeNav: true }).headerBlockPx
    const footerPadPx = this.estimateFooterPadPx()
    wx.createSelectorQuery()
      .in(this)
      .select('.account-nav')
      .boundingClientRect()
      .select('.account-footer')
      .boundingClientRect()
      .exec((res) => {
        const navRect = res && res[0]
        const footRect = res && res[1]
        const headerBlockPx = navRect && navRect.height
          ? Math.ceil(navRect.height)
          : fallback
        const measuredFooter = footRect && footRect.height
          ? Math.ceil(footRect.height) + 16
          : footerPadPx
        this.setData({ headerBlockPx, footerPadPx: measuredFooter })
      })
  },
  buildAvatarRingStyle(score) {
    const s = Math.max(0, Math.min(100, parseInt(score, 10) || 0))
    return `background: conic-gradient(from -90deg, #C4A76C ${s}%, rgba(196,167,108,0.12) 0);`
  },

  syncProfileHeader(score) {
    const profileScore = score != null ? score : this.data.profileScore
    this.setData({
      profileScore,
      avatarRingStyle: this.buildAvatarRingStyle(profileScore)
    })
    // 需求 21：完成度与「下一步」清单必须同源同刷 —— 只在 loadProfile 里刷会与实时分数脱节
    this.refreshNextSteps()
  },

  refreshLiveScore() {
    const score = calcProfileScore({
      avatarUrl: this.data.avatarUrl,
      nickName: this.data.nickName,
      phone: this.data.phoneBound,
      birthday: this.data.birthday,
      interests: this.data.interests,
      gender: this.data.gender,
      mbti: this.data.mbti,
      zodiac: this.data.zodiac
    })
    this.syncProfileHeader(score)
  },

  getDraftState() {
    const d = this.data
    return JSON.stringify({
      nickName: String(d.nickName || '').trim(),
      avatarUrl: d.avatarUrl || '',
      gender: d.gender || '',
      birthday: d.birthday || '',
      interests: d.interests || [],
      mbti: d.mbti || '',
      zodiac: d.zodiac || '',
      bio: String(d.bio || ''),
      sensitiveBlurPref: d.sensitiveBlurPref || '',
      privacy: d.privacy || {}
    })
  },

  captureSnapshot() {
    this._savedSnapshot = this.getDraftState()
    this.setData({
      isDirty: false,
      footerPrimaryText: '已保存'
    })
    this.disableLeaveGuard()
  },

  syncDirty() {
    const dirty = this.getDraftState() !== this._savedSnapshot
    if (dirty === this.data.isDirty) {
      if (!dirty && this.data.footerPrimaryText !== '已保存') {
        this.setData({ footerPrimaryText: '已保存' })
      }
      return
    }
    this.setData({
      isDirty: dirty,
      footerPrimaryText: dirty ? '保存资料' : '已保存'
    })
    if (dirty) this.syncLeaveGuard()
    else this.disableLeaveGuard()
  },

  syncLeaveGuard() {
    if (this.data.isDirty && wx.enableAlertBeforeUnload) {
      wx.enableAlertBeforeUnload({ message: LEAVE_MESSAGE })
    }
  },

  disableLeaveGuard() {
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
  },

  applyPatch(patch) {
    this.setData(patch, () => {
      this.syncDirty()
      this.refreshLiveScore()
    })
  },

  retryLoad() {
    this.loadProfile()
  },

  async loadProfile() {
    this.setData({ loading: true, loadError: false })
    try {
      let session = await fetchUserSession(app)
      if (!session || !session.success) {
        session = await ensureSession(app)
      }
      if (!session || !session.success) {
        this.setData({ loading: false, loadError: true }, () => this.remeasureChrome())
        return
      }
      const u = session.user || {}
      const interests = u.interests || []
      const profileScore = session.profileScore || u.profileScore || 0
      const bio = u.bio || ''
      this.setData({
        loading: false,
        loadError: false,
        memberNo: session.memberNo || u.memberNo || '',
        nickName: u.nickName || '',
        avatarUrl: u.avatarUrl || '',
        avatarPickError: false,
        avatarLoadError: false,
        phoneMasked: u.phoneMasked || '',
        phoneBound: !!u.phone,
        gender: u.gender || '',
        birthday: u.birthday || '',
        birthdayMax: todayDateStr(),
        interests,
        interestChips: buildInterestChips(interests, INTEREST_OPTIONS),
        mbti: u.mbti || '',
        zodiac: u.zodiac || '',
        bio,
        bioLength: String(bio).length,
        privacy: u.privacy || { showMbti: false, showZodiac: false, showBirthday: false },
        sensitiveBlurPref: u.sensitiveBlurPref || getSensitiveBlurPref() || '',
        rewardHint: buildRewardHint(u)
      }, () => {
        this.syncProfileHeader(profileScore)
        this.captureSnapshot()
        this.remeasureChrome()
        this.maybeFocusField()
      })
    } catch (err) {
      this.setData({ loading: false, loadError: true }, () => this.remeasureChrome())
    }
  },

  maybeFocusField() {
    const focus = this._focusField
    if (!focus) return
    this._focusField = ''
    const selector = focus === 'birthday' ? '#field-birthday' : ''
    if (!selector) return
    this.scrollToField(selector)
    if (!this.data.birthday) {
      setTimeout(() => wx.showToast({ title: '填写生日可领生日礼券', icon: 'none' }), 160)
    }
  },

  /** 把某个字段滚到导航栏下方（focus 参数与「下一步」清单共用同一套定位） */
  scrollToField(selector) {
    if (!selector) return
    setTimeout(() => {
      wx.createSelectorQuery()
        .in(this)
        .select(selector)
        .boundingClientRect()
        .selectViewport()
        .scrollOffset()
        .exec((res) => {
          const rect = res && res[0]
          const viewport = res && res[1]
          if (!rect || !viewport) return
          const top = Math.max(0, (viewport.scrollTop || 0) + rect.top - (this.data.headerBlockPx || 88) - 12)
          wx.pageScrollTo({ scrollTop: top, duration: 280 })
        })
    }, 120)
  },

  /**
   * 需求 21：档案页自己回答「下一步补什么」。
   * 分值口径与顶部完成度同源（calcProfileScore），不另立一套。
   */
  refreshNextSteps() {
    const all = buildNextSteps(this.data)
    this.setData({
      nextSteps: all.slice(0, 4),
      nextStepsMore: Math.max(0, all.length - 4),
      nextStepsTotal: all.length,
      nextStepsDone: all.length === 0
    })
  },

  /** 清单项 → 滚到对应字段 + 一句怎么做（不替用户做不可逆动作，如直接弹授权） */
  goNextStep(e) {
    const key = e.currentTarget.dataset.key
    const def = NEXT_STEP_DEFS.find((step) => step.key === key)
    if (!def) return
    try { wx.vibrateShort({ type: 'light' }) } catch (err) { /* ignore */ }
    this.scrollToField(def.anchor)
    if (def.hint) setTimeout(() => wx.showToast({ title: def.hint, icon: 'none', duration: 2000 }), 160)
  },

  /** 整块热区：相册/拍照选图 → 上传写库（真机 chooseAvatar 不可靠） */
  async onChangeAvatar() {
    if (this._avatarSaving) {
      wx.showToast({ title: '头像保存中…', icon: 'none' })
      return
    }
    try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* ignore */ }
    try {
      const path = await pickAvatarImage()
      this.setData({
        avatarUrl: path,
        avatarPickError: false,
        avatarLoadError: false
      })
      await this.persistAvatarNow(path)
    } catch (err) {
      if (err && err.code === 'CANCEL') return
      this.setData({ avatarPickError: true })
      toastAvatarPickError(err)
    }
  },

  async persistAvatarNow(tempUrl) {
    if (this._avatarSaving) return
    this._avatarSaving = true
    this.setData({ avatarSaving: true })
    if (this._avatarSaveTimer) clearTimeout(this._avatarSaveTimer)
    this._avatarSaveTimer = setTimeout(() => {
      if (!this._avatarSaving) return
      this._avatarSaving = false
      this.setData({ avatarSaving: false, avatarPickError: true })
      try { wx.hideLoading() } catch (e) { /* ignore */ }
      wx.showToast({ title: '头像上传超时，请重试', icon: 'none' })
    }, 20000)
    wx.showLoading({ title: '更新头像', mask: true })
    try {
      const openid = app.globalData.openid || 'user'
      const src = tempUrl || this.data.avatarUrl
      if (!src) throw new Error('AVATAR_UPLOAD')
      let fileID = src
      if (!String(src).startsWith('cloud://')) {
        const ext = avatarExtFromPath(src)
        const up = await wx.cloud.uploadFile({
          cloudPath: `avatars/${openid}/${Date.now()}.${ext}`,
          filePath: src
        })
        fileID = up.fileID
        if (!fileID) throw new Error('AVATAR_UPLOAD')
      }
      const res = await wx.cloud.callFunction({
        name: 'upsertUserProfile',
        data: { patch: { avatarUrl: fileID } }
      })
      const payload = res.result || {}
      if (!payload.success) {
        throw new Error(payload.msg || '保存失败')
      }
      const score = payload.profileScore != null
        ? payload.profileScore
        : calcProfileScore({
          avatarUrl: fileID,
          nickName: this.data.nickName,
          phone: this.data.phoneBound,
          birthday: this.data.birthday,
          interests: this.data.interests,
          gender: this.data.gender,
          mbti: this.data.mbti,
          zodiac: this.data.zodiac
        })
      this.setData({
        avatarUrl: fileID,
        avatarPickError: false,
        avatarLoadError: false
      }, () => {
        this.syncProfileHeader(score)
        // 头像已单独落库：写入快照中的 avatarUrl，其它未保存字段仍保持 dirty
        if (this._savedSnapshot) {
          try {
            const snap = JSON.parse(this._savedSnapshot)
            snap.avatarUrl = fileID
            this._savedSnapshot = JSON.stringify(snap)
          } catch (e) { /* ignore */ }
        }
        this.syncDirty()
      })
      if (payload.user) app.globalData.userInfo = payload.user
      try { await fetchUserSession(app) } catch (e) { /* ignore */ }
      wx.hideLoading()
      wx.vibrateShort({ type: 'light' })
      wx.showToast({ title: '头像已更新', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      this.setData({ avatarPickError: true })
      wx.showToast({ title: '头像上传失败，请重试', icon: 'none' })
    } finally {
      if (this._avatarSaveTimer) {
        clearTimeout(this._avatarSaveTimer)
        this._avatarSaveTimer = null
      }
      this._avatarSaving = false
      this.setData({ avatarSaving: false })
    }
  },

  onAvatarError() {
    if (this.data.avatarLoadError) return
    this.setData({ avatarLoadError: true })
  },

  copyMemberNo() {
    const code = String(this.data.memberNo || '').trim()
    if (!code || code === '—') {
      wx.showToast({ title: '暂无会员编号', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: code,
      success: () => {
        try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* ignore */ }
        wx.showToast({ title: '会员编号已复制', icon: 'none' })
      },
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' })
    })
  },

  onNickInput(e) {
    this.applyPatch({ nickName: e.detail.value })
  },

  onBioInput(e) {
    const bio = e.detail.value || ''
    this.applyPatch({ bio, bioLength: String(bio).length })
  },

  togglePrivacy(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.applyPatch({ [`privacy.${key}`]: !this.data.privacy[key] })
  },

  selectGender(e) {
    this.applyPatch({ gender: e.currentTarget.dataset.key })
  },

  onBirthdayChange(e) {
    const birthday = e.detail.value
    const zodiac = zodiacFromBirthday(birthday)
    this.applyPatch({ birthday, zodiac: zodiac || this.data.zodiac })
  },

  toggleInterest(e) {
    const key = e.currentTarget.dataset.key
    let interests = Array.isArray(this.data.interests) ? this.data.interests.slice() : []
    const idx = interests.indexOf(key)
    if (idx > -1) interests.splice(idx, 1)
    else {
      if (interests.length >= 5) {
        wx.showToast({ title: '最多选择 5 项', icon: 'none' })
        return
      }
      interests.push(key)
    }
    this.applyPatch({
      interests,
      interestChips: buildInterestChips(interests, INTEREST_OPTIONS)
    })
  },

  selectMbti(e) {
    this.applyPatch({ mbti: e.currentTarget.dataset.key })
  },

  selectZodiac(e) {
    this.applyPatch({ zodiac: e.currentTarget.dataset.key })
  },

  selectSensitivePref(e) {
    const key = e.currentTarget.dataset.key
    if (key !== PREF_VEIL && key !== PREF_CLEAR) return
    this.applyPatch({ sensitiveBlurPref: key })
  },

  async uploadAvatarIfNeeded() {
    const { avatarUrl } = this.data
    if (!avatarUrl || avatarUrl.startsWith('cloud://')) return avatarUrl
    const openid = app.globalData.openid || 'user'
    const ext = avatarExtFromPath(avatarUrl)
    try {
      const res = await wx.cloud.uploadFile({
        cloudPath: `avatars/${openid}/${Date.now()}.${ext}`,
        filePath: avatarUrl
      })
      if (!res || !res.fileID) throw new Error('AVATAR_UPLOAD')
      return res.fileID
    } catch (err) {
      const uploadErr = new Error('AVATAR_UPLOAD')
      uploadErr.cause = err
      throw uploadErr
    }
  },

  async onGetPhoneNumber(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok' || !e.detail.code) {
      const cancelled = String(e.detail.errMsg || '').indexOf('fail user deny') > -1
        || String(e.detail.errMsg || '').indexOf('cancel') > -1
      wx.showToast({
        title: cancelled ? '已取消绑定' : '需要授权手机号才能绑定',
        icon: 'none'
      })
      return
    }
    wx.showLoading({ title: '绑定中', mask: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'authPhone', data: { code: e.detail.code } })
      wx.hideLoading()
      const payload = res.result || {}
      if (payload.success) {
        this.setData({
          phoneBound: true,
          phoneMasked: payload.phoneMasked || this.data.phoneMasked
        }, () => this.refreshLiveScore())
        wx.vibrateShort({ type: 'light' })
        wx.showToast({ title: '绑定成功', icon: 'success' })
      } else {
        wx.showToast({ title: payload.msg || '绑定失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '绑定失败，请稍后重试', icon: 'none' })
    }
  },

  async saveProfile() {
    if (this.data.saving || this.data.loading) return
    if (!this.data.isDirty) return
    if (!String(this.data.nickName || '').trim()) {
      wx.showToast({ title: '请填写藏家代号', icon: 'none' })
      return
    }
    this.setData({ saving: true, footerPrimaryText: '保存中…' })
    wx.showLoading({ title: '保存中', mask: true })
    try {
      const avatarUrl = await this.uploadAvatarIfNeeded()
      const patch = {
        nickName: String(this.data.nickName || '').trim(),
        avatarUrl: avatarUrl || this.data.avatarUrl,
        gender: this.data.gender,
        birthday: this.data.birthday,
        interests: this.data.interests,
        mbti: this.data.mbti,
        zodiac: this.data.zodiac,
        bio: this.data.bio,
        privacy: this.data.privacy
      }
      if (this.data.sensitiveBlurPref === PREF_VEIL || this.data.sensitiveBlurPref === PREF_CLEAR) {
        patch.sensitiveBlurPref = this.data.sensitiveBlurPref
      }
      const res = await wx.cloud.callFunction({
        name: 'upsertUserProfile',
        data: { patch }
      })
      wx.hideLoading()
      const payload = res.result || {}
      if (!payload.success) {
        wx.showToast({ title: payload.msg || '保存失败', icon: 'none' })
        return
      }
      if (patch.sensitiveBlurPref) {
        setSensitiveBlurPref(patch.sensitiveBlurPref)
      }
      const score = payload.profileScore || calcProfileScore({ ...patch, phone: this.data.phoneBound })
      this.setData({
        avatarUrl: avatarUrl || this.data.avatarUrl,
        nickName: patch.nickName,
        avatarPickError: false
      })
      this.syncProfileHeader(score)
      this.captureSnapshot()
      if (payload.user) app.globalData.userInfo = payload.user
      try { await fetchUserSession(app) } catch (e) { /* ignore */ }
      // 若刚填成今天生日，立即尝试发放（「我的」页也会再补发，幂等）
      try {
        await wx.cloud.callFunction({ name: 'claimBirthdayGift', data: { action: 'claim' } })
      } catch (e) { /* ignore */ }
      wx.vibrateShort({ type: 'light' })
      wx.showToast({ title: '已保存', icon: 'success', duration: 800 })
      // 保存成功后回到「我的」Tab（tabBar 须用 switchTab）
      setTimeout(() => {
        wx.switchTab({
          url: '/pages/user/index',
          fail: () => wx.reLaunch({ url: '/pages/user/index' })
        })
      }, 400)
    } catch (e) {
      wx.hideLoading()
      const isAvatar = e && e.message === 'AVATAR_UPLOAD'
      wx.showToast({
        title: isAvatar ? '头像上传失败，请重试' : '保存失败，请稍后重试',
        icon: 'none'
      })
    } finally {
      this.setData({
        saving: false,
        footerPrimaryText: this.data.isDirty ? '保存资料' : '已保存'
      })
    }
  },

  goBack() {
    if (!this.data.isDirty) {
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
      return
    }
    wx.showModal({
      title: '尚未保存',
      content: LEAVE_MESSAGE,
      confirmText: '离开',
      cancelText: '继续编辑',
      success: (res) => {
        if (!res.confirm) return
        this.disableLeaveGuard()
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
      }
    })
  },

  goFeedback() {
    wx.navigateTo({
      url: '/subpackages/extra/user/feedback/index',
      fail: () => wx.showToast({ title: '无法打开反馈', icon: 'none' })
    })
  },

  goSupport() {
    wx.navigateTo({
      url: '/subpackages/extra/user/support/index',
      fail: () => wx.showToast({ title: '无法打开专员页', icon: 'none' })
    })
  },

  openLegal(e) {
    const type = e.currentTarget.dataset.type === 'privacy' ? 'privacy' : 'terms'
    wx.navigateTo({
      url: `/subpackages/content/user/legal/index?type=${type}`,
      fail: () => wx.showToast({ title: '无法打开协议', icon: 'none' })
    })
  },

  onLogoutTap() {
    if (this._loggingOut) return
    const content = this.data.isDirty
      ? '未保存的修改将丢失。将清除本机登录状态，返回「我的」访客视图。云端档案仍保留。'
      : '将清除本机登录状态，返回「我的」访客视图。云端档案仍保留，再次进入时可重新载入。'
    wx.showModal({
      title: '退出登录',
      content,
      confirmText: '退出',
      confirmColor: '#D64045',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        this.performLogout()
      }
    })
  },

  performLogout() {
    if (this._loggingOut) return
    this._loggingOut = true
    this.disableLeaveGuard()
    try {
      clearLocalSession(app)
    } catch (e) {
      console.warn('clearLocalSession', e)
    }
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) { /* ignore */ }
    wx.showToast({ title: '已退出', icon: 'none', duration: 1200 })
    setTimeout(() => {
      wx.switchTab({
        url: '/pages/user/index',
        fail: () => wx.reLaunch({ url: '/pages/user/index' }),
        complete: () => { this._loggingOut = false }
      })
    }, 280)
  }
})
