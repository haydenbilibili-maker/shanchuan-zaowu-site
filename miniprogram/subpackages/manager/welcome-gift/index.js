/**
 * 新会员礼包（仅超管）— manageWelcomeGift · member_welcome_gift
 */
const { guardStaffPage } = require('../utils/staffAuth')
const {
  ensureCouponKeys,
  stripCouponKeys,
  sortCouponsByThreshold,
  insertCouponByThreshold,
  moveCoupon,
  findFloorViolations
} = require('./couponOrder')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'manageWelcomeGift'

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
      name: '新会员礼包',
      title: '新会员礼包',
      messageTitle: '新会员礼包已到账',
      // 2026-09-17 口径：新客不再发积分
      pointsEnabled: false,
      points: 0,
      excludeGrowth: true,
      couponsEnabled: true,
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
        name: cfg.name || '新会员礼包',
        title: cfg.title || '新会员礼包',
        messageTitle: cfg.messageTitle || '新会员礼包已到账',
        pointsEnabled: cfg.pointsEnabled !== false,
        points: Number(cfg.points) || 0,
        excludeGrowth: cfg.excludeGrowth !== false,
        couponsEnabled: cfg.couponsEnabled !== false,
        expireDays: Number(cfg.expireDays) || 30,
        stackable: cfg.stackable === true,
        // _key 供 wx:key 用（id 可编辑，不能当 key —— 否则改一个字符整行重建、输入框失焦）
        coupons: ensureCouponKeys((cfg.coupons || []).map((c) => ({
          id: c.id,
          enabled: c.enabled !== false,
          value: Number(c.value) || 0,
          minSpend: Number(c.minSpend) || 0,
          expireDays: Number(c.expireDays) || 30,
          count: Number(c.count) || 1,
          title: c.title || ''
        })))
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

  onToggle(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: !this.data.form[field] })
  },

  onText(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: String((e.detail && e.detail.value) || '') })
  },

  onNumber(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: Number(e.detail.value) || 0 })
  },

  onCouponField(e) {
    const { index, field } = e.currentTarget.dataset
    let value = e.detail.value
    if (['value', 'minSpend', 'expireDays', 'count'].indexOf(field) !== -1) {
      value = Number(value) || 0
    }
    this.setData({ [`form.coupons[${index}].${field}`]: value })
  },

  /** 券行启用开关（原来的「启用中 · 点此停用」按钮文案太长会溢出按钮 → 改开关） */
  onCouponEnable(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ [`form.coupons[${index}].enabled`]: !!(e.detail && e.detail.value) })
  },

  addCoupon() {
    const row = ensureCouponKeys([{
      id: `c${Date.now() % 10000}`,
      enabled: true,
      value: 20,
      minSpend: 100,
      expireDays: this.data.form.expireDays || 30,
      count: 1,
      title: '新会员礼券'
    }])[0]
    // 按门槛插入合适位置（不是一律追加）——新券才符合「面额/门槛递增」的读法
    this.setData({ 'form.coupons': insertCouponByThreshold(this.data.form.coupons, row) })
  },

  /** 上移 / 下移：顺序即顾客在各处看到的顺序 */
  moveCouponUp(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ 'form.coupons': moveCoupon(this.data.form.coupons, index, index - 1) })
  },

  moveCouponDown(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ 'form.coupons': moveCoupon(this.data.form.coupons, index, index + 1) })
  },

  /** 一键按门槛升序（满49/99/299/499/999 这类「符合逻辑」的顺序） */
  sortCoupons() {
    const before = this.data.form.coupons || []
    const after = sortCouponsByThreshold(before)
    const changed = after.some((row, i) => row !== before[i])
    this.setData({ 'form.coupons': after })
    wx.showToast({
      title: changed ? '已按门槛升序整理，记得保存' : '顺序已符合门槛升序',
      icon: 'none'
    })
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
    // 前置拦截：「礼券总开关开着，却没有任何启用中的券行」= 新用户静默收不到券。
    // 云函数 manageWelcomeGift 也会拦一次；这里先拦是为了把原因说清楚（不是「保存失败」）。
    if (this.data.form.couponsEnabled) {
      const active = (this.data.form.coupons || []).filter(
        (c) => c && c.enabled !== false && Number(c.value) > 0 && Number(c.count) > 0
      )
      if ((this.data.form.coupons || []).length > 0 && !active.length) {
        wx.showToast({
          title: '礼券总开关开着，但四条券行都停用了：新用户将收不到券。请启用至少一条，或关掉礼券总开关',
          icon: 'none',
          duration: 3500
        })
        return
      }
    }
    // 折扣地板（与云函数 couponDiscountRules 同口径：门槛 ≥ ceil(面额 / 0.25)）：
    // 云函数也会拒，但这里先拦能把「哪一行」说清楚（运营最常问的就是这个）
    const floorBad = findFloorViolations(this.data.form.coupons, 0.25)
    if (floorBad.length) {
      const first = floorBad[0]
      wx.showToast({
        title: `第 ${first.index + 1} 行门槛过低（满${first.row.minSpend}减${first.row.value}）：折扣不得低于 7.5 折，门槛需 ≥ ${first.need}`,
        icon: 'none',
        duration: 3600
      })
      return
    }
    // 券 id 重复会让「已发券条款对齐」按 slotKey 匹配错行 → 保存前先拦
    const dupIds = (() => {
      const seen = new Set()
      for (const row of this.data.form.coupons || []) {
        const id = String((row && row.id) || '').trim()
        if (!id) continue
        if (seen.has(id)) return id
        seen.add(id)
      }
      return ''
    })()
    if (dupIds) {
      wx.showToast({ title: `券 id「${dupIds}」重复：请改成唯一值（已发券靠它对齐条款）`, icon: 'none', duration: 3200 })
      return
    }
    this.setData({ saving: true })
    try {
      const result = await this.callFn({
        action: 'save',
        docId: this.data.docId,
        // 行内稳定 key（_key）不上行
        config: Object.assign({}, this.data.form, {
          coupons: stripCouponKeys(this.data.form.coupons)
        })
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
