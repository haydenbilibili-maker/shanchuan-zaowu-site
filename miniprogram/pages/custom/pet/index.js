// pages/custom/pet/index.js
const {
  STEPS,
  CONSENT_VERSION,
  SPECIES_OPTIONS,
  WEIGHT_RANGES,
  STORAGE_OPTIONS,
  POSE_OPTIONS,
  INTAKE_METHODS,
  RELATION_OPTIONS,
  SERVICE_NOTICE,
  DEFAULT_CRAFTS
} = require('../../../utils/petMemorialDefaults')
const { buildOrderPayload, buildSummaryLines } = require('../../../utils/petMemorialHelper')
const { trackBehavior } = require('../../../utils/trackBehavior')
const { getCustomNavLayout } = require('../../../utils/customNav')

Page({
  data: {
    statusBarHeight: 0,
    navPaddingRight: 32,
    headerHeight: 88,
    steps: STEPS,
    currentStep: 1,
    currentStepMeta: STEPS[0],
    loading: true,
    submitting: false,
    serviceNotice: SERVICE_NOTICE,
    crafts: [],
    speciesOptions: SPECIES_OPTIONS,
    weightRanges: WEIGHT_RANGES,
    storageOptions: STORAGE_OPTIONS,
    poseOptions: POSE_OPTIONS,
    intakeMethods: INTAKE_METHODS,
    relationOptions: RELATION_OPTIONS,
    consentChecked: false,
    petName: '',
    species: 'cat',
    breed: '',
    coatColor: '',
    weightRange: '3-5',
    passedAt: '',
    storage: 'frozen',
    photos: [],
    craftId: '',
    craftName: '',
    pose: 'sleeping',
    poseNote: '',
    plaqueText: '',
    intakeMethod: 'store',
    preferredDate: '',
    addressNote: '',
    contactName: '',
    contactPhone: '',
    relation: 'owner',
    contactNote: '',
    previewLines: [],
    today: ''
  },

  onLoad(options) {
    const nav = getCustomNavLayout()
    const today = this.formatDate(new Date())
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navPaddingRight: nav.navPaddingRight,
      headerHeight: nav.headerHeight,
      today
    })
    trackBehavior('pet_memorial_enter', 'from', options.from || 'direct')
    this.updateStepUi(1)
    if (options.from === 'devtest') {
      this.applyDevTestData(today)
    }
    this.loadConfig()
  },

  applyDevTestData(today) {
    this.setData({
      consentChecked: true,
      petName: '测试喵',
      breed: '英短蓝猫',
      coatColor: '蓝白',
      passedAt: today,
      contactName: '测试用户',
      contactPhone: '13800138000',
      contactNote: '开发者工具提交流程测试'
    })
  },

  formatDate(d) {
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  },

  async loadConfig() {
    const applyCrafts = (crafts) => {
      const list = crafts && crafts.length ? crafts : DEFAULT_CRAFTS
      this.setData({
        crafts: list,
        craftId: list[0] ? list[0].craftId : '',
        craftName: list[0] ? list[0].name : '',
        loading: false
      })
    }
    try {
      const res = await wx.cloud.callFunction({ name: 'getPetMemorialConfig' })
      const crafts = (res.result && res.result.config && res.result.config.crafts) || []
      applyCrafts(crafts)
    } catch (e) {
      console.warn('getPetMemorialConfig failed, use defaults:', e)
      applyCrafts(DEFAULT_CRAFTS)
    }
  },

  updateStepUi(step) {
    const s = step || this.data.currentStep
    const meta = STEPS.find((x) => x.id === s) || STEPS[0]
    this.setData({ currentStepMeta: meta })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
    if (this.data.currentStep === 5) this.refreshPreview()
  },

  onDateChange(e) {
    this.setData({ passedAt: e.detail.value })
  },

  onPreferredDateChange(e) {
    this.setData({ preferredDate: e.detail.value })
  },

  selectOption(e) {
    const field = e.currentTarget.dataset.field
    const value = e.currentTarget.dataset.value
    this.setData({ [field]: value })
    if (field === 'craftId') {
      const craft = this.data.crafts.find((c) => c.craftId === value)
      this.setData({ craftName: craft ? craft.name : '' })
    }
    if (this.data.currentStep === 5) this.refreshPreview()
  },

  onConsentCheckChange(e) {
    const values = e.detail.value || []
    this.setData({ consentChecked: values.indexOf('agreed') >= 0 })
  },

  choosePhotos() {
    const remain = 3 - this.data.photos.length
    if (remain <= 0) {
      wx.showToast({ title: '最多 3 张', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        wx.showLoading({ title: '上传中...' })
        const files = res.tempFiles || []
        const uploaded = []
        try {
          for (let i = 0; i < files.length; i++) {
            const up = await wx.cloud.uploadFile({
              cloudPath: `pet-memorial/${Date.now()}_${i}.jpg`,
              filePath: files[i].tempFilePath
            })
            uploaded.push(up.fileID)
          }
          this.setData({ photos: [...this.data.photos, ...uploaded] })
        } catch (err) {
          wx.showToast({ title: '上传失败', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  removePhoto(e) {
    const idx = e.currentTarget.dataset.idx
    const photos = [...this.data.photos]
    photos.splice(idx, 1)
    this.setData({ photos })
  },

  refreshPreview() {
    const payload = buildOrderPayload(this.buildForm())
    this.setData({ previewLines: buildSummaryLines(payload) })
  },

  buildForm() {
    return {
      ...this.data,
      consentVersion: CONSENT_VERSION,
      consentAgreedAt: new Date().toISOString()
    }
  },

  validateStep(step) {
    if (step === 1 && !this.data.consentChecked) {
      wx.showToast({ title: '请阅读并确认知情说明', icon: 'none' })
      return false
    }
    if (step === 2) {
      if (!this.data.petName.trim()) {
        wx.showToast({ title: '请填写它的名字', icon: 'none' })
        return false
      }
      if (!this.data.passedAt) {
        wx.showToast({ title: '请选择离世日期', icon: 'none' })
        return false
      }
    }
    if (step === 3 && !this.data.craftId) {
      wx.showToast({ title: '请选择工艺', icon: 'none' })
      return false
    }
    if (step === 4 && !this.data.intakeMethod) {
      wx.showToast({ title: '请选择交接方式', icon: 'none' })
      return false
    }
    if (step === 5) {
      if (!this.data.contactName.trim()) {
        wx.showToast({ title: '请填写联系人', icon: 'none' })
        return false
      }
      if (!this.data.contactPhone || this.data.contactPhone.length < 11) {
        wx.showToast({ title: '请填写正确手机号', icon: 'none' })
        return false
      }
    }
    return true
  },

  goNext() {
    if (!this.validateStep(this.data.currentStep)) return
    const next = Math.min(this.data.currentStep + 1, 5)
    this.setData({ currentStep: next })
    this.updateStepUi(next)
    if (next === 5) this.refreshPreview()
    trackBehavior('pet_memorial_step_view', 'step', String(next))
  },

  goPrev() {
    const prev = Math.max(this.data.currentStep - 1, 1)
    this.setData({ currentStep: prev })
    this.updateStepUi(prev)
  },

  async submitOrder() {
    if (!this.validateStep(5)) return
    this.setData({ submitting: true })
    try {
      const payload = buildOrderPayload(this.buildForm())
      const res = await wx.cloud.callFunction({
        name: 'petMemorialOrder',
        data: { action: 'submit', payload }
      })
      const result = res.result || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '提交失败', icon: 'none', duration: 3000 })
        console.error('petMemorialOrder submit failed:', result)
        return
      }
      trackBehavior('pet_memorial_submit', 'order', result.orderNo)
      wx.redirectTo({
        url: `/pages/custom/pet/status/index?id=${result.orderId}`
      })
    } catch (e) {
      console.error('submitOrder error:', e)
      wx.showToast({ title: (e && e.errMsg) || '提交失败', icon: 'none', duration: 3000 })
    } finally {
      this.setData({ submitting: false })
    }
  },

  goToSupport() {
    wx.navigateTo({ url: '/pages/user/support/index?topic=pet_memorial' })
  },

  goBack() {
    if (this.data.currentStep > 1) {
      this.goPrev()
      return
    }
    wx.navigateBack()
  }
})
