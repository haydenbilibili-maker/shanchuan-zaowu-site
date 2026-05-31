// pages/user/profile/index.js
const app = getApp()
const {
  INTEREST_OPTIONS,
  GENDER_OPTIONS,
  MBTI_OPTIONS,
  ZODIAC_OPTIONS
} = require('../../../utils/profileConstants')
const { zodiacFromBirthday, calcProfileScore, buildInterestChips } = require('../../../utils/profileHelper')
const { ensureSession } = require('../../../utils/userSession')
const { getPageNavInsets } = require('../../../utils/pageNav')
const { measureFixedScroll } = require('../../../utils/scrollArea')

Page({
  data: {
    statusBarHeight: 20,
    navPaddingRight: 16,
    headerBlockPx: 88,
    scrollHeightPx: 500,
    saving: false,
    profileScore: 0,
    avatarRingStyle: '',
    memberNo: '',
    nickName: '',
    avatarUrl: '',
    phoneMasked: '',
    phoneBound: false,
    gender: '',
    birthday: '',
    interests: [],
    interestChips: [],
    mbti: '',
    zodiac: '',
    bio: '',
    privacy: { showMbti: false, showZodiac: false, showBirthday: false },
    genderOptions: GENDER_OPTIONS,
    interestOptions: INTEREST_OPTIONS,
    mbtiOptions: MBTI_OPTIONS,
    zodiacOptions: ZODIAC_OPTIONS
  },

  onLoad() {
    this.initLayout()
    this.loadProfile()
  },

  onReady() {
    this.remeasureScroll()
  },

  initLayout() {
    const nav = getPageNavInsets()
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navPaddingRight: nav.navPaddingRight,
      headerBlockPx: nav.headerBlockPx
    })
  },

  async remeasureScroll() {
    const fallback = getPageNavInsets().headerBlockPx
    const area = await measureFixedScroll(this, {
      topSelector: '.account-nav',
      bottomSelector: '.account-footer',
      fallbackTop: fallback
    })
    this.setData({
      headerBlockPx: area.scrollTopPx,
      scrollHeightPx: area.scrollHeightPx
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
  },

  async loadProfile() {
    const session = await ensureSession(app)
    if (!session.success || !session.user) return
    const u = session.user
    const interests = u.interests || []
    const profileScore = session.profileScore || u.profileScore || 0
    this.setData({
      memberNo: session.memberNo || u.memberNo,
      nickName: u.nickName || '',
      avatarUrl: u.avatarUrl || '',
      phoneMasked: u.phoneMasked || '',
      phoneBound: !!u.phone,
      gender: u.gender || '',
      birthday: u.birthday || '',
      interests,
      interestChips: buildInterestChips(interests, INTEREST_OPTIONS),
      mbti: u.mbti || '',
      zodiac: u.zodiac || '',
      bio: u.bio || '',
      privacy: u.privacy || { showMbti: false, showZodiac: false, showBirthday: false }
    })
    this.syncProfileHeader(profileScore)
    this.remeasureScroll()
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    if (avatarUrl) this.setData({ avatarUrl })
  },

  onNickInput(e) {
    this.setData({ nickName: e.detail.value })
  },

  onBioInput(e) {
    this.setData({ bio: e.detail.value })
  },

  togglePrivacy(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ [`privacy.${key}`]: !this.data.privacy[key] })
  },

  selectGender(e) {
    this.setData({ gender: e.currentTarget.dataset.key })
  },

  onBirthdayChange(e) {
    const birthday = e.detail.value
    const zodiac = zodiacFromBirthday(birthday)
    this.setData({ birthday, zodiac: zodiac || this.data.zodiac })
  },

  toggleInterest(e) {
    const key = e.currentTarget.dataset.key
    let interests = this.data.interests.slice()
    const idx = interests.indexOf(key)
    if (idx > -1) interests.splice(idx, 1)
    else {
      if (interests.length >= 5) {
        wx.showToast({ title: '最多 5 项', icon: 'none' })
        return
      }
      interests.push(key)
    }
    this.setData({
      interests,
      interestChips: buildInterestChips(interests, INTEREST_OPTIONS)
    })
  },

  selectMbti(e) {
    this.setData({ mbti: e.currentTarget.dataset.key })
  },

  selectZodiac(e) {
    this.setData({ zodiac: e.currentTarget.dataset.key })
  },

  async uploadAvatarIfNeeded() {
    const { avatarUrl } = this.data
    if (!avatarUrl || avatarUrl.startsWith('cloud://')) return avatarUrl
    const openid = app.globalData.openid || 'user'
    const ext = avatarUrl.indexOf('.') > -1 ? avatarUrl.split('.').pop() : 'jpg'
    const res = await wx.cloud.uploadFile({
      cloudPath: `avatars/${openid}/${Date.now()}.${ext}`,
      filePath: avatarUrl
    })
    return res.fileID
  },

  async onGetPhoneNumber(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok' || !e.detail.code) return
    wx.showLoading({ title: '绑定中', mask: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'authPhone', data: { code: e.detail.code } })
      wx.hideLoading()
      const payload = res.result || {}
      if (payload.success) {
        this.setData({ phoneBound: true, phoneMasked: payload.phoneMasked })
        wx.showToast({ title: '绑定成功', icon: 'success' })
      } else {
        wx.showToast({ title: payload.msg || '失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '绑定失败', icon: 'none' })
    }
  },

  async saveProfile() {
    if (this.data.saving) return
    if (!this.data.nickName.trim()) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '保存中', mask: true })
    try {
      const avatarUrl = await this.uploadAvatarIfNeeded()
      const patch = {
        nickName: this.data.nickName.trim(),
        avatarUrl: avatarUrl || this.data.avatarUrl,
        gender: this.data.gender,
        birthday: this.data.birthday,
        interests: this.data.interests,
        mbti: this.data.mbti,
        zodiac: this.data.zodiac,
        bio: this.data.bio,
        privacy: this.data.privacy
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
      const score = payload.profileScore || calcProfileScore({ ...patch, phone: this.data.phoneBound })
      this.syncProfileHeader(score)
      this.setData({ avatarUrl: avatarUrl || this.data.avatarUrl })
      app.globalData.userInfo = payload.user
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/user/feedback/index' })
  },

  goSupport() {
    wx.navigateTo({ url: '/pages/user/support/index' })
  }
})
