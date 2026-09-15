/**
 * 生日礼包（仅超管）— manageBirthdayGift · member_birthday_gift
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'manageBirthdayGift'

Page({
  data: {
    ready: false,
    loading: false,
    saving: false,
    fromDefault: true,
    docId: '',
    ruleText: '',
    form: {
      enabled: true,
      name: '生日礼包',
      title: '生日礼包',
      messageTitle: '生日快乐，礼券已到账',
      pointsEnabled: true,
      points: 200,
      pointsTitle: '生日礼券 · 专属积分',
      excludeGrowth: true,
      couponsEnabled: true,
      expireMode: 'end_of_month',
      expireDays: 30,
      stackable: false,
      coupons: []
    }
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin')
    if (!role) return
    this.setData({ ready: true })
    this.loadConfig()
  },

  onPullDownRefresh() {
    this.loadConfig().finally(() => wx.stopPullDownRefresh())
  },

  async callFn(data) {
    const res = await wx.cloud.callFunction({ name: FN, data: data || {} })
    const result = (res && res.result) || {}
    if (!result.success) {
      const err = new Error(result.msg || '操作失败')
      err.code = result.code
      throw err
    }
    return result
  },

  applyForm(config, extra) {
    const cfg = config || {}
    this.setData({
      form: {
        enabled: cfg.enabled !== false,
        name: cfg.name || '生日礼包',
        title: cfg.title || '生日礼包',
        messageTitle: cfg.messageTitle || '生日快乐，礼券已到账',
        pointsEnabled: cfg.pointsEnabled !== false,
        points: Number(cfg.points) || 0,
        pointsTitle: cfg.pointsTitle || '生日礼券 · 专属积分',
        excludeGrowth: cfg.excludeGrowth !== false,
        couponsEnabled: cfg.couponsEnabled !== false,
        expireMode: cfg.expireMode === 'days' ? 'days' : 'end_of_month',
        expireDays: Number(cfg.expireDays) || 30,
        stackable: cfg.stackable === true,
        coupons: (cfg.coupons || []).map((c) => ({
          id: c.id,
          enabled: c.enabled !== false,
          value: Number(c.value) || 0,
          minSpend: Number(c.minSpend) || 0,
          expireDays: Number(c.expireDays) || 30,
          count: Number(c.count) || 1,
          title: c.title || ''
        }))
      },
      ...(extra || {})
    })
  },

  async loadConfig() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const result = await this.callFn({ action: 'get' })
      this.applyForm(result.config, {
        loading: false,
        docId: result.docId || '',
        fromDefault: !!result.fromDefault,
        ruleText: result.ruleText || ''
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: formatCloudFnError(e, '加载失败'), icon: 'none' })
    }
  },

  onSwitch(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: !!(e.detail && e.detail.value) })
  },

  onText(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: String((e.detail && e.detail.value) || '') })
  },

  onNumber(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: Number(e.detail.value) || 0 })
  },

  setExpireMode(e) {
    const mode = e.currentTarget.dataset.mode
    this.setData({ 'form.expireMode': mode === 'days' ? 'days' : 'end_of_month' })
  },

  onCouponField(e) {
    const { index, field } = e.currentTarget.dataset
    let value = e.detail.value
    if (['value', 'minSpend', 'expireDays', 'count'].indexOf(field) !== -1) {
      value = Number(value) || 0
    }
    this.setData({ [`form.coupons[${index}].${field}`]: value })
  },

  toggleCoupon(e) {
    const index = Number(e.currentTarget.dataset.index)
    const row = this.data.form.coupons[index]
    if (!row) return
    this.setData({ [`form.coupons[${index}].enabled`]: !row.enabled })
  },

  addCoupon() {
    const coupons = this.data.form.coupons.concat([{
      id: `bday_${Date.now() % 10000}`,
      enabled: true,
      value: 20,
      minSpend: 100,
      expireDays: this.data.form.expireDays || 30,
      count: 1,
      title: '生日礼券'
    }])
    this.setData({ 'form.coupons': coupons })
  },

  removeCoupon(e) {
    const index = Number(e.currentTarget.dataset.index)
    const coupons = this.data.form.coupons.slice()
    coupons.splice(index, 1)
    this.setData({ 'form.coupons': coupons })
  },

  async resetDefaults() {
    if (this.data.saving || this.data.loading) return
    try {
      const result = await this.callFn({ action: 'resetDefaults' })
      this.applyForm(result.config, {
        ruleText: result.ruleText || '',
        fromDefault: true
      })
      wx.showToast({ title: '已恢复默认，请保存', icon: 'none' })
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '恢复失败'), icon: 'none' })
    }
  },

  async saveConfig() {
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      const result = await this.callFn({
        action: 'save',
        docId: this.data.docId,
        config: this.data.form
      })
      this.setData({
        docId: result.docId || this.data.docId,
        ruleText: result.ruleText || '',
        fromDefault: false
      })
      wx.showToast({ title: '已保存', icon: 'success' })
      await this.loadConfig()
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
