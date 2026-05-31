// pages/user/onboarding/index.js
const app = getApp()
const { trackBehavior } = require('../../../utils/trackBehavior')
const {
  INTEREST_OPTIONS,
  GENDER_OPTIONS,
  MBTI_OPTIONS,
  ZODIAC_OPTIONS,
  PROFILE_REWARD
} = require('../../../utils/profileConstants')
const { zodiacFromBirthday } = require('../../../utils/profileHelper')
const { ensureSession } = require('../../../utils/userSession')
const { getPageNavInsets } = require('../../../utils/pageNav')
const { measureFixedScroll } = require('../../../utils/scrollArea')

const HEADER_EXTRA_RPX = 56

Page({
  data: {
    statusBarHeight: 20,
    navPaddingRight: 16,
    headerBlockPx: 120,
    scrollHeightPx: 500,
    step: 1,
    totalSteps: 4,
    from: '',
    agreed: false,
    avatarUrl: '',
    nickName: '',
    phoneBound: false,
    phoneMasked: '',
    gender: '',
    birthday: '',
    interests: [],
    mbti: '',
    zodiac: '',
    genderOptions: GENDER_OPTIONS,
    interestOptions: INTEREST_OPTIONS,
    mbtiOptions: MBTI_OPTIONS,
    zodiacOptions: ZODIAC_OPTIONS,
    saving: false,
    rewardText: `+${PROFILE_REWARD.points} 积分 · +${PROFILE_REWARD.growthBonus} 成长值`,
    footerPrimaryText: '',
    footerGhostText: '',
    footerPrimaryDisabled: false,
    footerPrimaryAction: '',
    footerGhostAction: ''
  },

  onLoad(options) {
    const step = parseInt(options.step, 10) || 1
    this.setData({
      step: Math.min(Math.max(step, 1), 4),
      from: options.from || ''
    })
    trackBehavior('onboarding_start', 'from', options.from || 'direct')
    this.initLayout()
    this.loadSession()
  },

  onReady() {
    this.remeasureScroll()
    this.updateFooterForStep(this.data.step)
  },

  initLayout() {
    const nav = getPageNavInsets({ headerExtraRpx: HEADER_EXTRA_RPX })
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navPaddingRight: nav.navPaddingRight,
      headerBlockPx: nav.headerBlockPx
    })
  },

  async remeasureScroll() {
    const fallback = getPageNavInsets({ headerExtraRpx: HEADER_EXTRA_RPX }).headerBlockPx
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

  updateFooterForStep(step) {
    const { saving, phoneBound } = this.data
    let footer = {}

    switch (step) {
      case 1:
        footer = {
          footerPrimaryText: saving ? '保存中…' : '下一步',
          footerPrimaryDisabled: saving,
          footerPrimaryAction: 'nextFromStep1',
          footerGhostText: '',
          footerGhostAction: ''
        }
        break
      case 2:
        if (phoneBound) {
          footer = {
            footerPrimaryText: '继续',
            footerPrimaryDisabled: false,
            footerPrimaryAction: 'nextFromStep2',
            footerGhostText: '',
            footerGhostAction: ''
          }
        } else {
          footer = {
            footerPrimaryText: '',
            footerPrimaryDisabled: false,
            footerPrimaryAction: '',
            footerGhostText: '暂时跳过',
            footerGhostAction: 'skipPhone'
          }
        }
        break
      case 3:
        footer = {
          footerPrimaryText: saving ? '保存中…' : '下一步',
          footerPrimaryDisabled: saving,
          footerPrimaryAction: 'nextFromStep3',
          footerGhostText: '跳过',
          footerGhostAction: 'skipBasic'
        }
        break
      case 4:
        footer = {
          footerPrimaryText: saving ? '提交中…' : '完成注册',
          footerPrimaryDisabled: saving,
          footerPrimaryAction: 'finishOnboarding',
          footerGhostText: '跳过',
          footerGhostAction: 'skipPersona'
        }
        break
      default:
        footer = {
          footerPrimaryText: '',
          footerGhostText: '',
          footerPrimaryDisabled: false,
          footerPrimaryAction: '',
          footerGhostAction: ''
        }
    }

    this.setData(footer, () => this.remeasureScroll())
  },

  afterStepChange(step) {
    this.updateFooterForStep(step)
    trackBehavior('onboarding_step', 'step', String(step))
  },

  async loadSession() {
    const session = await ensureSession(app)
    if (!session.success || !session.user) return
    const u = session.user
    this.setData({
      avatarUrl: u.avatarUrl || '',
      nickName: u.nickName || '',
      phoneBound: !!u.phone,
      phoneMasked: u.phoneMasked || '',
      gender: u.gender || '',
      birthday: u.birthday || '',
      interests: u.interests || [],
      mbti: u.mbti || '',
      zodiac: u.zodiac || ''
    }, () => this.updateFooterForStep(this.data.step))
    if (session.onboardingDone && this.data.from !== 'gate') {
      wx.redirectTo({ url: '/pages/user/profile/index' })
    }
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    if (avatarUrl) this.setData({ avatarUrl })
  },

  onNickInput(e) {
    this.setData({ nickName: e.detail.value })
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed })
  },

  openTerms() {
    wx.navigateTo({ url: '/pages/user/legal/index?type=terms' })
  },

  openPrivacy() {
    wx.navigateTo({ url: '/pages/user/legal/index?type=privacy' })
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

  async savePatch(patch, completeOnboarding) {
    this.setData({ saving: true })
    this.updateFooterForStep(this.data.step)
    try {
      const res = await wx.cloud.callFunction({
        name: 'upsertUserProfile',
        data: { patch, completeOnboarding: !!completeOnboarding }
      })
      const payload = res.result || {}
      if (!payload.success) {
        wx.showToast({ title: payload.msg || '保存失败', icon: 'none' })
        return null
      }
      await ensureSession(app)
      return payload
    } catch (e) {
      wx.showToast({ title: '网络异常', icon: 'none' })
      return null
    } finally {
      this.setData({ saving: false })
      this.updateFooterForStep(this.data.step)
    }
  },

  async nextFromStep1() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先同意用户协议', icon: 'none' })
      return
    }
    if (!this.data.nickName.trim()) {
      wx.showToast({ title: '请设定昵称', icon: 'none' })
      return
    }
    wx.showLoading({ title: '保存中', mask: true })
    try {
      const avatarUrl = await this.uploadAvatarIfNeeded()
      const payload = await this.savePatch({
        nickName: this.data.nickName.trim(),
        avatarUrl: avatarUrl || this.data.avatarUrl,
        agreedTermsAt: new Date().toISOString(),
        onboardingStep: 2
      })
      wx.hideLoading()
      if (payload) {
        this.setData({ step: 2, avatarUrl: avatarUrl || this.data.avatarUrl }, () => {
          this.afterStepChange(2)
        })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '头像上传失败', icon: 'none' })
    }
  },

  async onGetPhoneNumber(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok' || !e.detail.code) {
      wx.showToast({ title: '需要授权手机号', icon: 'none' })
      return
    }
    wx.showLoading({ title: '绑定中', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'authPhone',
        data: { code: e.detail.code }
      })
      wx.hideLoading()
      const payload = res.result || {}
      if (!payload.success) {
        wx.showToast({ title: payload.msg || '绑定失败', icon: 'none' })
        return
      }
      this.setData({
        phoneBound: true,
        phoneMasked: payload.phoneMasked || '已绑定'
      }, () => this.updateFooterForStep(2))
      await this.savePatch({ onboardingStep: 3 })
      trackBehavior('phone_bind_success', 'from', 'onboarding')
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '绑定失败', icon: 'none' })
    }
  },

  skipPhone() {
    this.setData({ step: 3 }, () => {
      this.afterStepChange(3)
      trackBehavior('onboarding_skip', 'step', 'phone')
    })
    this.savePatch({ onboardingStep: 3 })
  },

  nextFromStep2() {
    if (!this.data.phoneBound) {
      wx.showToast({ title: '请绑定手机号或点击跳过', icon: 'none' })
      return
    }
    this.setData({ step: 3 }, () => this.afterStepChange(3))
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
        wx.showToast({ title: '最多选 5 项', icon: 'none' })
        return
      }
      interests.push(key)
    }
    this.setData({ interests })
  },

  async nextFromStep3() {
    const payload = await this.savePatch({
      gender: this.data.gender,
      birthday: this.data.birthday,
      interests: this.data.interests,
      onboardingStep: 4
    })
    if (payload) {
      this.setData({ step: 4 }, () => this.afterStepChange(4))
    }
  },

  skipBasic() {
    this.setData({ step: 4 }, () => this.afterStepChange(4))
    this.savePatch({ onboardingStep: 4 })
  },

  selectMbti(e) {
    this.setData({ mbti: e.currentTarget.dataset.key })
  },

  selectZodiac(e) {
    this.setData({ zodiac: e.currentTarget.dataset.key })
  },

  async finishOnboarding() {
    const payload = await this.savePatch({
      mbti: this.data.mbti,
      zodiac: this.data.zodiac,
      onboardingStep: 4
    }, true)

    if (!payload) return

    trackBehavior('onboarding_complete', 'from', this.data.from || 'direct')
    const name = encodeURIComponent(this.data.nickName.trim() || '')
    wx.redirectTo({
      url: `/pages/user/onboarding/done?reward=${payload.reward && payload.reward.claimed ? 1 : 0}&name=${name}`
    })
  },

  skipPersona() {
    this.finishOnboarding()
  },

  goBack() {
    const step = this.data.step
    if (step > 1) {
      this.setData({ step: step - 1 }, () => this.updateFooterForStep(step - 1))
      return
    }
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/user/index' })
    })
  }
})
