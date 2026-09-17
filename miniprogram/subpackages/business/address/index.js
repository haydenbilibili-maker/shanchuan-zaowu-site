const STORAGE_KEY = 'user_addresses_local'

const EMPTY_FORM = {
  name: '',
  phone: '',
  region: [],
  detail: '',
  setAsDefault: false
}

const { withAppModal } = require('../../../utils/appModal')

Page(withAppModal({
  data: {
    addresses: [],
    mode: 'manage',
    loading: true,
    needLogin: false,
    showManualForm: false,
    form: { ...EMPTY_FORM },
    saving: false
  },

  onLoad(options) {
    this.setData({ mode: options.mode || 'manage' })
  },

  onShow() {
    this.loadAddresses()
  },

  applyGuestAddressState() {
    try {
      wx.removeStorageSync(STORAGE_KEY)
    } catch (e) { /* ignore */ }
    this.setData({
      addresses: [],
      loading: false,
      needLogin: true,
      showManualForm: false
    })
  },

  getLocalAddresses() {
    try {
      const { isLocalLoggedOut } = require('../../../utils/userSession')
      if (isLocalLoggedOut()) return []
      return wx.getStorageSync(STORAGE_KEY) || []
    } catch (e) {
      return []
    }
  },

  saveLocalAddresses(list) {
    try {
      const { isLocalLoggedOut } = require('../../../utils/userSession')
      if (isLocalLoggedOut()) {
        wx.removeStorageSync(STORAGE_KEY)
        return
      }
      wx.setStorageSync(STORAGE_KEY, list)
    } catch (e) {
      console.warn('saveLocalAddresses', e)
    }
  },

  async callManageAddress(payload) {
    const res = await wx.cloud.callFunction({
      name: 'manageAddress',
      data: payload
    })
    return res.result || {}
  },

  async loadAddresses() {
    const { isLocalLoggedOut } = require('../../../utils/userSession')
    if (isLocalLoggedOut()) {
      this.applyGuestAddressState()
      return
    }
    this.setData({ loading: true, needLogin: false })
    try {
      const result = await this.callManageAddress({ action: 'list' })
      if (isLocalLoggedOut()) {
        this.applyGuestAddressState()
        return
      }
      if (result.success) {
        this.setData({ addresses: result.data || [], loading: false, needLogin: false })
        this.saveLocalAddresses(result.data || [])
        return
      }
      throw new Error(result.msg || '加载失败')
    } catch (e) {
      console.error('loadAddresses', e)
      if (isLocalLoggedOut()) {
        this.applyGuestAddressState()
        return
      }
      const local = this.getLocalAddresses()
      this.setData({
        addresses: local,
        loading: false
      })
      if (!local.length) {
        wx.showToast({ title: '地址加载失败', icon: 'none' })
      }
    }
  },

  async goResumeLogin() {
    if (this._resumingLogin) return
    this._resumingLogin = true
    wx.showLoading({ title: '进入中', mask: true })
    try {
      const { resumeLocalSession, ensureSession } = require('../../../utils/userSession')
      resumeLocalSession()
      await ensureSession(getApp(), { force: true })
      wx.hideLoading()
      this.setData({ needLogin: false })
      await this.loadAddresses()
      wx.showToast({ title: '已重新进入', icon: 'none' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '进入失败，请重试', icon: 'none' })
    } finally {
      this._resumingLogin = false
    }
  },

  formatForCheckout(record) {
    return {
      _id: record._id,
      name: record.name,
      phone: record.phone,
      region: record.region || [],
      detail: record.detail || ''
    }
  },

  onSelectAddress(e) {
    if (this.data.mode !== 'select') return
    const idx = e.currentTarget.dataset.index
    const addr = this.data.addresses[idx]
    if (!addr) {
      wx.showToast({ title: '地址信息缺失', icon: 'none' })
      return
    }

    try {
      const eventChannel = typeof this.getOpenerEventChannel === 'function'
        ? this.getOpenerEventChannel()
        : null
      if (eventChannel && typeof eventChannel.emit === 'function') {
        eventChannel.emit('addressSelected', this.formatForCheckout(addr))
      }
    } catch (e) {
      console.warn('addressSelected emit', e)
    }
    wx.navigateBack({
      fail: () => wx.showToast({ title: '请返回结算页继续', icon: 'none' })
    })
  },

  importFromWechat() {
    try {
      const { isLocalLoggedOut } = require('../../../utils/userSession')
      if (isLocalLoggedOut()) {
        this.goResumeLogin()
        return
      }
    } catch (e) { /* ignore */ }
    const setAsDefault = this.data.addresses.length === 0
    wx.chooseAddress({
      success: (res) => this.saveAddressPayload({
        userName: res.userName,
        telNumber: res.telNumber,
        provinceName: res.provinceName,
        cityName: res.cityName,
        countyName: res.countyName,
        detailInfo: res.detailInfo
      }, setAsDefault),
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        if (msg.includes('cancel')) return
        if (msg.includes('auth deny') || msg.includes('authorize')) {
          // 2026-09-17 起改用全站样式化弹窗（行为等价；见 utils/appModal.js）
          this.modal({
            title: '需要地址权限',
            overline: 'WECHAT ADDRESS',
            content: '请允许获取微信收货地址，或改用「手动新增」填写。',
            confirmText: '手动新增',
            cancelText: '取消'
          }).then((r) => { if (r.confirm) this.openManualForm() })
          return
        }
        wx.showToast({ title: '获取地址失败', icon: 'none' })
        console.error('chooseAddress fail', err)
      }
    })
  },

  openManualForm() {
    try {
      const { isLocalLoggedOut } = require('../../../utils/userSession')
      if (isLocalLoggedOut()) {
        this.goResumeLogin()
        return
      }
    } catch (e) { /* ignore */ }
    this.setData({
      showManualForm: true,
      form: {
        ...EMPTY_FORM,
        setAsDefault: this.data.addresses.length === 0
      }
    })
  },

  closeManualForm() {
    if (this.data.saving) return
    this.setData({ showManualForm: false })
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ [`form.${field}`]: e.detail.value || '' })
  },

  onRegionChange(e) {
    const region = e.detail.value || []
    this.setData({ 'form.region': region })
  },

  toggleFormDefault() {
    this.setData({ 'form.setAsDefault': !this.data.form.setAsDefault })
  },

  validateManualForm(form) {
    const name = (form.name || '').trim()
    const phone = (form.phone || '').trim()
    const detail = (form.detail || '').trim()
    const region = form.region || []

    if (!name) return '请填写收件人'
    if (!/^1\d{10}$/.test(phone)) return '请填写正确的手机号'
    if (!region.length || region.length < 3) return '请选择省市区'
    if (!detail || detail.length < 4) return '请填写详细地址'
    return ''
  },

  async submitManualAddress() {
    if (this.data.saving) return
    const form = this.data.form || {}
    const err = this.validateManualForm(form)
    if (err) {
      wx.showToast({ title: err, icon: 'none' })
      return
    }

    await this.saveAddressPayload({
      name: form.name.trim(),
      phone: form.phone.trim(),
      region: form.region,
      detail: form.detail.trim()
    }, !!form.setAsDefault)

    this.setData({ showManualForm: false })
  },

  async saveAddressPayload(raw, asDefault) {
    this.setData({ saving: true })
    wx.showLoading({ title: '保存中…', mask: true })
    try {
      const result = await this.callManageAddress({
        action: 'add',
        setAsDefault: asDefault,
        address: raw
      })

      wx.hideLoading()
      this.setData({ saving: false })

      if (result.success) {
        wx.showToast({ title: '已保存', icon: 'success' })
        this.loadAddresses()
        return
      }

      throw new Error(result.msg || '保存失败')
    } catch (e) {
      wx.hideLoading()
      this.setData({ saving: false })
      console.error('saveAddressPayload', e)

      const entry = {
        _id: `local_${Date.now()}`,
        name: (raw.name || raw.userName || '').trim(),
        phone: (raw.phone || raw.telNumber || '').trim(),
        region: Array.isArray(raw.region)
          ? raw.region.filter(Boolean)
          : [raw.provinceName, raw.cityName, raw.countyName].filter(Boolean),
        detail: (raw.detail || raw.detailInfo || '').trim(),
        isDefault: asDefault || this.data.addresses.length === 0
      }

      if (entry.name && entry.phone && entry.detail) {
        let list = [...this.data.addresses]
        if (entry.isDefault) {
          list = list.map((a) => ({ ...a, isDefault: false }))
        }
        list.unshift(entry)
        this.saveLocalAddresses(list)
        this.setData({ addresses: list })
        wx.showToast({ title: '已保存（本地）', icon: 'success' })
        return
      }

      wx.showToast({
        title: '保存失败，请稍后重试',
        icon: 'none',
        duration: 2500
      })
    }
  },

  async setDefault(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '地址信息缺失', icon: 'none' })
      return
    }
    wx.showLoading({ title: '设置中…' })
    try {
      const result = await this.callManageAddress({ action: 'setDefault', addressId: id })
      wx.hideLoading()
      if (result.success) {
        wx.showToast({ title: '已设为默认', icon: 'success' })
        this.loadAddresses()
      } else {
        wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  deleteAddress(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '地址信息缺失', icon: 'none' })
      return
    }
    this.modal({
      title: '删除地址',
      overline: 'REMOVE ADDRESS',
      content: '确定删除该收货地址？删除后不可恢复。',
      confirmText: '删除',
      danger: true
    }).then(async (res) => {
      if (!res.confirm) return
      try {
        const result = await this.callManageAddress({ action: 'delete', addressId: id })
        if (result.success) {
          wx.showToast({ title: '已删除', icon: 'success' })
          this.loadAddresses()
        } else {
          wx.showToast({ title: result.msg || '删除失败', icon: 'none' })
        }
      } catch (err) {
        wx.showToast({ title: '删除失败', icon: 'none' })
      }
    })
  }
}))
