/**
 * 我的钱包配置（仅超管）
 * manageStoredValue getConfig / saveConfig；无独立钱包折扣
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'manageStoredValue'
const DEFAULT_DESCRIPTION =
  '充值全额入账，并按实付计入成长值与积分（每满 ¥1 → 1）。档位金额对齐会员升级门槛；到达对应等级后，指定藏品享受该档折扣。用钱包支付时，折扣随本单可达的会员等级变化。'
const DEFAULT_PACKAGES = [
  { id: 'T500', name: '充值 500', payYuan: 500, sort: 10, enabled: true },
  { id: 'T3000', name: '充值 3000', payYuan: 3000, sort: 20, enabled: true },
  { id: 'T10000', name: '充值 10000', payYuan: 10000, sort: 30, enabled: true },
  { id: 'T30000', name: '充值 30000', payYuan: 30000, sort: 40, enabled: true },
  { id: 'T50000', name: '充值 50000', payYuan: 50000, sort: 50, enabled: true }
]

function fenToYuan(fen) {
  return Math.round((Number(fen) || 0) / 100)
}

function yuanToFen(yuan) {
  return Math.round((Number(yuan) || 0) * 100)
}

Page({
  data: {
    ready: false,
    loading: false,
    saving: false,
    enabled: false,
    fromDefault: true,
    reconciling: false,
    reconcileForm: { orderId: '', outTradeNo: '', transactionId: '', note: '' },
    benefitRule:
      '余额仅限小程序内支付。充值计入成长值与积分（¥1=1）；支付折扣 = 会员等级折扣；无独立钱包折扣率。',
    description: DEFAULT_DESCRIPTION,
    packages: DEFAULT_PACKAGES.map((p) => ({ ...p }))
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

  async loadConfig() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const result = await this.callFn({ action: 'getConfig' })
      const cfg = result.config || {}
      const pkgs = Array.isArray(cfg.packages) && cfg.packages.length
        ? cfg.packages
        : DEFAULT_PACKAGES.map((p) => ({
          id: p.id,
          name: p.name,
          payFen: yuanToFen(p.payYuan),
          sort: p.sort,
          enabled: true
        }))
      const desc = (cfg.benefit && cfg.benefit.description) || result.benefitText || ''
      this.setData({
        loading: false,
        enabled: result.enabled === true,
        fromDefault: !!result.fromDefault,
        description: desc && !/选用钱包支付时可享|更优一档/.test(desc) ? desc : DEFAULT_DESCRIPTION,
        packages: pkgs.map((p, i) => ({
          id: p.id || `T${i + 1}`,
          name: p.name || `充值 ${fenToYuan(p.payFen)}`,
          payYuan: fenToYuan(p.payFen != null ? p.payFen : p.payYuan),
          sort: p.sort != null ? Number(p.sort) : (i + 1) * 10,
          enabled: p.enabled !== false
        }))
      })
    } catch (e) {
      this.setData({
        loading: false,
        packages: DEFAULT_PACKAGES.map((p) => ({ ...p })),
        description: DEFAULT_DESCRIPTION
      })
      wx.showToast({ title: formatCloudFnError(e, '加载失败'), icon: 'none' })
    }
  },

  onDescInput(e) {
    this.setData({ description: String((e.detail && e.detail.value) || '').slice(0, 200) })
  },

  onPkgField(e) {
    const { index, field } = e.currentTarget.dataset
    let value = e.detail.value
    if (field === 'payYuan' || field === 'sort') {
      value = Number(value) || 0
    }
    this.setData({ [`packages[${index}].${field}`]: value })
  },

  /** 补单入账表单输入（data-field: orderId / outTradeNo / transactionId / note） */
  onReconcileInput(e) {
    const field = String((e.currentTarget.dataset && e.currentTarget.dataset.field) || '')
    if (!field) return
    this.setData({ [`reconcileForm.${field}`]: String((e.detail && e.detail.value) || '') })
  },

  /**
   * 补单入账（仅超管）：支付回调缺失（如 2026-09-15 回调误判事故）时，
   * 核对微信商户平台流水后人工把该笔充值补入余额。服务端 manageStoredValue.reconcileRecharge 幂等。
   */
  reconcileRecharge() {
    const form = this.data.reconcileForm || {}
    const orderId = String(form.orderId || '').trim()
    const outTradeNo = String(form.outTradeNo || '').trim()
    if (!orderId && !outTradeNo) {
      wx.showToast({ title: '请填写充值单 ID 或商户单号', icon: 'none' })
      return
    }
    wx.showModal({
      title: '补单入账',
      content: `仅在微信商户平台确认${outTradeNo ? `「${outTradeNo}」` : '该充值单'}已收款后使用。入账幂等，重复执行不会重复加钱。`,
      confirmText: '确认入账',
      confirmColor: '#C4A76C',
      success: (res) => {
        if (!res.confirm) return
        this.submitReconcile()
      }
    })
  },

  async submitReconcile() {
    if (this.data.reconciling) return
    this.setData({ reconciling: true })
    wx.showLoading({ title: '补单入账中…', mask: true })
    try {
      const form = this.data.reconcileForm || {}
      const result = await this.callFn({
        action: 'reconcileRecharge',
        orderId: String(form.orderId || '').trim(),
        outTradeNo: String(form.outTradeNo || '').trim(),
        transactionId: String(form.transactionId || '').trim(),
        note: String(form.note || '').trim()
      })
      wx.hideLoading()
      this.setData({
        reconciling: false,
        reconcileForm: { orderId: '', outTradeNo: '', transactionId: '', note: '' }
      })
      wx.showToast({
        title: result.alreadyCredited ? '该充值单此前已入账' : '补单入账完成',
        icon: result.alreadyCredited ? 'none' : 'success'
      })
    } catch (err) {
      wx.hideLoading()
      this.setData({ reconciling: false })
      wx.showToast({ title: formatCloudFnError(err, '补单失败'), icon: 'none' })
    }
  },

  togglePkg(e) {
    const index = Number(e.currentTarget.dataset.index)
    const row = this.data.packages[index]
    if (!row) return
    this.setData({ [`packages[${index}].enabled`]: !row.enabled })
  },

  addPackage() {
    const n = this.data.packages.length + 1
    const packages = this.data.packages.concat([{
      id: `T${n * 100}`,
      name: `充值 ${n * 100}`,
      payYuan: n * 100,
      sort: n * 10,
      enabled: true
    }])
    this.setData({ packages })
  },

  removePackage(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (this.data.packages.length <= 1) {
      wx.showToast({ title: '至少保留一个档位', icon: 'none' })
      return
    }
    const packages = this.data.packages.slice()
    packages.splice(index, 1)
    this.setData({ packages })
  },

  resetDefaults() {
    if (this.data.saving || this.data.loading) return
    this.setData({
      packages: DEFAULT_PACKAGES.map((p) => ({ ...p })),
      description: DEFAULT_DESCRIPTION
    })
    wx.showToast({ title: '已恢复默认，请保存', icon: 'none' })
  },

  async saveConfig() {
    if (this.data.saving) return
    const packages = (this.data.packages || []).map((p, i) => ({
      id: String(p.id || `T${i + 1}`).trim(),
      name: String(p.name || '').trim(),
      payFen: yuanToFen(p.payYuan),
      principalFen: yuanToFen(p.payYuan),
      bonusFen: 0,
      sort: Number(p.sort) || (i + 1) * 10,
      enabled: p.enabled !== false
    }))
    if (!packages.some((p) => p.enabled && p.payFen > 0)) {
      wx.showToast({ title: '请至少启用一个有效档位', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      await this.callFn({
        action: 'saveConfig',
        config: {
          packages,
          benefit: {
            enabled: false,
            discountRate: 1,
            stackMode: 'none',
            description: String(this.data.description || DEFAULT_DESCRIPTION).slice(0, 200)
          }
        }
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
