const { getPageNavInsets } = require('../utils/pageNav')
const { getDefaultStore } = require('../../../utils/storeHelper')
const { trackBehavior } = require('../../../utils/trackBehavior')
const { buildSessionFrom } = require('../utils/supportHelper')
const { ensureSession } = require('../../../utils/userSession')
const { FRAMER_RECRUIT_BANNER_FILE_ID } = require('../../../config/cdn')

const SUPPORT_TOPIC = 'framer_recruit'
const RECRUIT_PATH = '/subpackages/business/framer-recruit/index'
const HERO_IMAGE = FRAMER_RECRUIT_BANNER_FILE_ID
const DEFAULT_SUPPORT_PHONE = '19917242871'
const PHONE_RE = /^1[3-9]\d{9}$/

const BENEFITS = [
  {
    id: 'stores',
    index: '01',
    overline: 'STORE CHANNEL',
    title: '全国加盟门店直达',
    desc: '通过审核的作品与成品，可进入山海造物全国加盟门店的销售渠道。柜面是藏品遇见藏家的地方；我们把这扇柜门打开。'
  },
  {
    id: 'miniprogram',
    index: '02',
    overline: 'MINI PROGRAM',
    title: '小程序内售卖',
    desc: '合作标本师的作品，可在山海造物小程序上架售卖。线上馆藏与门店柜面共用同一套品牌叙事，不必另起一套店铺。'
  },
  {
    id: 'share',
    index: '03',
    overline: 'REVENUE SHARE',
    title: '平台与标本师共享分成',
    desc: '合作采用分成模式：平台提供渠道、履约与品牌，标本师提供作品与工艺。具体分成比例、结算周期与费用项以双方签署的合作协议为准。'
  },
  {
    id: 'orders',
    index: '04',
    overline: 'SHARED ORDERS',
    title: '订单共享',
    desc: '可参与标本定制、伴宠记忆等订单共享。伴宠类工单仍由专员与标本师评估后承接，当面确认方案，并非自动派单。'
  },
  {
    id: 'logistics',
    index: '05',
    overline: 'LOGISTICS',
    title: '专属物流快递服务',
    desc: '合作期间可使用平台对接的专属物流与保价寄送，减少自行询价、试错包装的成本，让成品更稳妥地到达藏家手里。'
  },
  {
    id: 'supply',
    index: '06',
    overline: 'PACKAGING & COMPLIANCE',
    title: '专业化包装与合规供应链',
    desc: '共用平台的专业包装方案，以及合规货物与耗材供应链——盒型、衬垫与必要说明不必从零搭建。来源与工艺须符合现行法规。'
  }
]

const STEPS = [
  { index: '01', title: '留下意向', desc: '填写下方合作表单，说明擅长品类、所在城市与希望对接的渠道。' },
  { index: '02', title: '沟通样品', desc: '工坊评估作品、交期与可合作范围，必要时看样或视频确认。' },
  { index: '03', title: '签署协议', desc: '书面明确分成、结算、物流、上架与订单共享规则。' },
  { index: '04', title: '上架与接单', desc: '进入门店渠道与小程序售卖，并按约定参与定制与伴宠订单。' }
]

const CATEGORY_OPTIONS = [
  { id: 'insect', label: '昆虫' },
  { id: 'mineral', label: '矿物' },
  { id: 'plant', label: '植物' },
  { id: 'marine', label: '海洋' },
  { id: 'pet', label: '伴宠' },
  { id: 'other', label: '其他' }
]

const INTENT_OPTIONS = [
  { id: 'stores', label: '门店渠道' },
  { id: 'miniprogram', label: '小程序上架' },
  { id: 'share', label: '分成合作' },
  { id: 'orders', label: '伴宠/定制订单' },
  { id: 'logistics', label: '物流保价' },
  { id: 'supply', label: '包装与合规供应链' }
]

function withSelected(options, selectedIds) {
  const set = {}
  ;(selectedIds || []).forEach((id) => { set[id] = true })
  return (options || []).map((item) => ({
    ...item,
    selected: !!set[item.id]
  }))
}

function toggleId(list, id) {
  const next = Array.isArray(list) ? list.slice() : []
  const idx = next.indexOf(id)
  if (idx >= 0) next.splice(idx, 1)
  else next.push(id)
  return next
}

function mapRecruitSubmitError(raw) {
  const msg = String(raw || '')
  if (/COLLECTION_MISSING|502005|DATABASE_COLLECTION_NOT_EXIST|collection not exist|collection\.add:fail/i.test(msg)) {
    return '服务暂未开通，请稍后重试'
  }
  if (/FUNCTION_NOT_FOUND|FunctionName parameter could not be found|FUNCTION_NOT_EXIST/i.test(msg)) {
    return '云函数未部署：submitFramerRecruit'
  }
  const clean = msg.replace(/^Error:\s*/i, '').trim()
  if (clean && clean.length <= 20 && !/fail\s*-?\d|errCode|requestid|collection\./i.test(clean)) {
    return clean
  }
  return '提交失败，请稍后重试'
}

Page({
  data: {
    headerBlockPx: 0,
    safeBottom: 0,
    ctaPadBottom: 16,
    scrollHeightPx: 500,
    scrollIntoView: '',
    heroImage: HERO_IMAGE,
    benefits: BENEFITS,
    steps: STEPS,
    phone: '',
    sessionFrom: '',
    sendMessageTitle: '标本师合作意向 · 山海造物',
    sendMessagePath: RECRUIT_PATH,
    categoryOptions: withSelected(CATEGORY_OPTIONS, []),
    intentOptions: withSelected(INTENT_OPTIONS, []),
    form: {
      contactName: '',
      phone: '',
      wechat: '',
      city: '',
      categories: [],
      experience: '',
      intents: [],
      note: ''
    },
    submitting: false,
    submitted: false
  },

  onLoad(options) {
    const store = getDefaultStore() || {}
    const nav = getPageNavInsets({ footerRpx: 248, nativeNav: true })
    this.setData({
      headerBlockPx: nav.headerBlockPx,
      safeBottom: nav.safeBottom,
      ctaPadBottom: nav.safeBottom + 16,
      scrollHeightPx: nav.scrollHeightPx,
      // 客服热线优先 support_configs；缺省回退默认号（门店电话仅作次级兜底）
      phone: DEFAULT_SUPPORT_PHONE || store.phone || '',
      sessionFrom: buildSessionFrom({ topic: SUPPORT_TOPIC })
    })
    trackBehavior('framer_recruit_enter', 'from', options.from || 'direct')
    ensureSession().catch(() => {})
    this.hydrateHeroImage()
    this.hydrateSupportPhone()
  },

  async hydrateSupportPhone() {
    try {
      if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') return
      const res = await wx.cloud.callFunction({ name: 'getSupportConfig' })
      const phone = String((((res || {}).result || {}).config || {}).phone || '').trim()
      if (phone) this.setData({ phone })
    } catch (e) {
      console.warn('framer-recruit getSupportConfig failed:', e)
    }
  },

  async hydrateHeroImage() {
    if (!HERO_IMAGE || HERO_IMAGE.indexOf('cloud://') !== 0) return
    try {
      const res = await wx.cloud.getTempFileURL({ fileList: [HERO_IMAGE] })
      const url = res.fileList && res.fileList[0] && res.fileList[0].tempFileURL
      if (url) this.setData({ heroImage: url })
    } catch (e) {
      console.warn('hydrate recruit hero', e)
    }
  },

  onShareAppMessage() {
    return {
      title: '标本师招募 · 山海造物',
      path: RECRUIT_PATH,
      imageUrl: this.data.heroImage
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/index/index' })
    })
  },

  goSupport() {
    trackBehavior('framer_recruit_cta', 'channel', 'support')
    wx.navigateTo({
      url: `/subpackages/feature/user/support/index?topic=${SUPPORT_TOPIC}&from=framer_recruit`,
      fail: () => wx.showToast({ title: '无法打开联系专员', icon: 'none' })
    })
  },

  goPetHub() {
    try {
      const { fetchContentDisplayFlags, toastPetMemorialClosed } = require('../../../utils/contentDisplayFlags')
      fetchContentDisplayFlags().then(({ flags }) => {
        if (!flags.showPetMemorial) {
          toastPetMemorialClosed()
          return
        }
        wx.navigateTo({
          url: '/subpackages/feature/custom/pet/index?from=framer_recruit',
          fail: () => wx.showToast({ title: '无法打开伴宠记忆', icon: 'none' })
        })
      }).catch(() => {
        wx.navigateTo({
          url: '/subpackages/feature/custom/pet/index?from=framer_recruit',
          fail: () => wx.showToast({ title: '无法打开伴宠记忆', icon: 'none' })
        })
      })
    } catch (e) {
      wx.navigateTo({
        url: '/subpackages/feature/custom/pet/index?from=framer_recruit',
        fail: () => wx.showToast({ title: '无法打开伴宠记忆', icon: 'none' })
      })
    }
  },

  callPhone() {
    const phone = this.data.phone
    if (!phone) {
      wx.showToast({ title: '暂未配置服务电话', icon: 'none' })
      return
    }
    trackBehavior('framer_recruit_cta', 'channel', 'phone')
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => wx.showToast({ title: '无法拨打电话', icon: 'none' })
    })
  },

  onContactTap() {
    trackBehavior('framer_recruit_cta', 'channel', 'wechat')
  },

  scrollToForm() {
    this.setData({ scrollIntoView: 'recruit-form' })
    setTimeout(() => this.setData({ scrollIntoView: '' }), 400)
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  toggleCategory(e) {
    const id = e.currentTarget.dataset.id
    if (!id || this.data.submitted) return
    const categories = toggleId(this.data.form.categories, id)
    this.setData({
      'form.categories': categories,
      categoryOptions: withSelected(CATEGORY_OPTIONS, categories)
    })
  },

  toggleIntent(e) {
    const id = e.currentTarget.dataset.id
    if (!id || this.data.submitted) return
    const intents = toggleId(this.data.form.intents, id)
    this.setData({
      'form.intents': intents,
      intentOptions: withSelected(INTENT_OPTIONS, intents)
    })
  },

  validateForm() {
    const { contactName, phone, categories, intents } = this.data.form
    if (!String(contactName || '').trim()) {
      return '请填写姓名或称呼'
    }
    if (!PHONE_RE.test(String(phone || '').trim())) {
      return '请填写正确的手机号'
    }
    if (!categories || !categories.length) {
      return '请至少选择一项擅长品类'
    }
    if (!intents || !intents.length) {
      return '请至少选择一项合作意向'
    }
    return ''
  },

  async submitApplication() {
    if (this.data.submitting || this.data.submitted) return

    const errMsg = this.validateForm()
    if (errMsg) {
      this.scrollToForm()
      wx.showToast({ title: errMsg, icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中', mask: true })
    try {
      await ensureSession().catch(() => {})
      const form = this.data.form
      const res = await wx.cloud.callFunction({
        name: 'submitFramerRecruit',
        data: {
          contactName: String(form.contactName || '').trim(),
          phone: String(form.phone || '').trim(),
          wechat: String(form.wechat || '').trim(),
          city: String(form.city || '').trim(),
          categories: form.categories || [],
          experience: String(form.experience || '').trim(),
          intents: form.intents || [],
          note: String(form.note || '').trim(),
          source: 'framer_recruit'
        }
      })
      const result = res.result || {}
      wx.hideLoading()
      if (!result.success) {
        const raw = [result.code, result.msg].filter(Boolean).join(' ')
        wx.showToast({ title: mapRecruitSubmitError(raw), icon: 'none' })
        return
      }
      trackBehavior('framer_recruit_submit', 'channel', 'form')
      this.setData({ submitted: true })
      wx.showToast({ title: '意向已提交', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      console.error('submitFramerRecruit', e)
      const msg = (e && (e.errMsg || e.message)) || ''
      wx.showToast({ title: mapRecruitSubmitError(msg), icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
