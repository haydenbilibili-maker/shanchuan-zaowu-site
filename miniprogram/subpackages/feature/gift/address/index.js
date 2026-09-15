const {
  fetchContentDisplayFlags,
  toastGiftClosed
} = require('../../../../utils/contentDisplayFlags')

Page({
  data: {
    ready: false,
    errorMsg: '',
    name: '',
    phone: '',
    region: [],
    regionText: '',
    detail: '',
    submitting: false,
    orderId: '',
    token: ''
  },

  onLoad(options) {
    const orderId = String((options && options.orderId) || '').trim()
    const token = String((options && options.token) || '').trim()
    this.setData({ orderId, token })
    if (!orderId && !token) {
      this.setData({
        ready: false,
        errorMsg: '礼笺链接不完整，请从分享卡重新打开'
      })
      return
    }
    this.bootstrap()
  },

  async bootstrap() {
    try {
      const { flags } = await fetchContentDisplayFlags()
      if (!flags.showGift) {
        toastGiftClosed()
        setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }), 400)
        return
      }
      this.setData({ ready: true })
    } catch (e) {
      this.setData({ ready: true })
    }
  },

  onName(e) { this.setData({ name: (e.detail && e.detail.value) || '' }) },
  onPhone(e) { this.setData({ phone: (e.detail && e.detail.value) || '' }) },
  onDetail(e) { this.setData({ detail: (e.detail && e.detail.value) || '' }) },

  onRegionChange(e) {
    const region = (e.detail && e.detail.value) || []
    const parts = Array.isArray(region) ? region.map((x) => String(x || '').trim()).filter(Boolean) : []
    this.setData({
      region: parts,
      regionText: parts.join(' ')
    })
  },

  importWxAddress() {
    wx.chooseAddress({
      success: (addr) => {
        const region = [addr.provinceName, addr.cityName, addr.countyName].filter(Boolean)
        this.setData({
          name: addr.userName || this.data.name,
          phone: addr.telNumber || this.data.phone,
          region,
          regionText: region.join(' '),
          detail: addr.detailInfo || this.data.detail
        })
      },
      fail: (err) => {
        const msg = String((err && (err.errMsg || err.message)) || '')
        if (/cancel|取消/i.test(msg)) return
        wx.showToast({ title: '未能导入，请手动选择地区', icon: 'none' })
      }
    })
  },

  async submit() {
    if (this.data.submitting) return
    const { name, phone, region, detail } = this.data
    if (!name || !phone || !detail || region.length < 2) {
      wx.showToast({ title: '请把去处写完整', icon: 'none' })
      return
    }
    const phoneNorm = String(phone || '').replace(/\s+/g, '')
    if (!/^1\d{10}$/.test(phoneNorm)) {
      wx.showToast({ title: '请填写有效手机号', icon: 'none' })
      return
    }
    if (!this.data.orderId && !this.data.token) {
      wx.showToast({ title: '礼笺链接不完整，请从分享卡重新打开', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '记下中…', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: {
          action: 'submitAddress',
          orderId: this.data.orderId,
          token: this.data.token,
          address: { name, phone: phoneNorm, region, detail }
        }
      })
      wx.hideLoading()
      const result = (res && res.result) || {}
      if (!result.success) {
        this.setData({ submitting: false })
        const msg = friendlySubmitMsg(result.msg, result.code)
        wx.showToast({ title: msg, icon: 'none' })
        return
      }
      wx.showModal({
        title: '去处已记下',
        content: result.phoneMasked
          ? `馆员将为你备妥启程。\n联系 ${result.phoneMasked}`
          : (result.msg || '馆员将为你备妥启程，妥投一件珍物。'),
        showCancel: false,
        confirmColor: '#C4A76C',
        success: () => {
          wx.redirectTo({
            url: `/subpackages/feature/gift/receive/index?orderId=${this.data.orderId}&token=${this.data.token}`
          })
        }
      })
    } catch (e) {
      wx.hideLoading()
      this.setData({ submitting: false })
      wx.showToast({ title: '网络未通，请稍后再试', icon: 'none' })
    }
  },

  goHome() {
    wx.switchTab({
      url: '/pages/index/index',
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    })
  }
})

function friendlySubmitMsg(raw, code) {
  const msg = String(raw || '')
  if (code === 'EXPIRED') return '这份邀约已过期'
  if (code === 'CLAIMED') return '这份山海已有去处'
  if (code === 'BAD_TOKEN') return '请从分享礼笺进入后再填写'
  if (code === 'GIFT_CLOSED') return '礼赠暂未开放'
  if (code === 'DB_UPDATE' || /502001|database request|document\.update/i.test(msg)) {
    return '此刻未能记下，请稍后再试'
  }
  if (!msg || /fail|error|exception/i.test(msg)) {
    return '未能记下，请稍后再试'
  }
  return msg.slice(0, 36)
}
