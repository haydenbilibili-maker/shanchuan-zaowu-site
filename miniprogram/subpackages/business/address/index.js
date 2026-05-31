const STORAGE_KEY = 'user_addresses_local'

Page({
  data: {
    addresses: [],
    mode: 'manage',
    loading: true
  },

  onLoad(options) {
    this.setData({ mode: options.mode || 'manage' })
  },

  onShow() {
    this.loadAddresses()
  },

  getLocalAddresses() {
    try {
      return wx.getStorageSync(STORAGE_KEY) || []
    } catch (e) {
      return []
    }
  },

  saveLocalAddresses(list) {
    try {
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
    this.setData({ loading: true })
    try {
      const result = await this.callManageAddress({ action: 'list' })
      if (result.success) {
        this.setData({ addresses: result.data || [], loading: false })
        this.saveLocalAddresses(result.data || [])
        return
      }
      throw new Error(result.msg || '加载失败')
    } catch (e) {
      console.error('loadAddresses', e)
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
    if (!addr) return

    const eventChannel = this.getOpenerEventChannel()
    if (eventChannel && eventChannel.emit) {
      eventChannel.emit('addressSelected', this.formatForCheckout(addr))
    }
    wx.navigateBack()
  },

  openChooseAddress(setAsDefault) {
    wx.chooseAddress({
      success: (res) => this.saveAddressFromWechat(res, setAsDefault),
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        if (msg.includes('cancel')) return
        if (msg.includes('auth deny') || msg.includes('authorize')) {
          wx.showModal({
            title: '需要地址权限',
            content: '请在弹窗中允许获取收货地址，或在小程序设置中开启「通讯地址」权限。',
            showCancel: false,
            confirmColor: '#C4A76C'
          })
          return
        }
        wx.showToast({ title: '获取地址失败', icon: 'none' })
        console.error('chooseAddress fail', err)
      }
    })
  },

  importFromWechat() {
    this.openChooseAddress(this.data.addresses.length === 0)
  },

  addAddress() {
    this.openChooseAddress(this.data.addresses.length === 0)
  },

  async saveAddressFromWechat(res, asDefault) {
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      const result = await this.callManageAddress({
        action: 'add',
        setAsDefault: asDefault,
        address: {
          userName: res.userName,
          telNumber: res.telNumber,
          provinceName: res.provinceName,
          cityName: res.cityName,
          countyName: res.countyName,
          detailInfo: res.detailInfo
        }
      })

      wx.hideLoading()

      if (result.success) {
        wx.showToast({ title: '已保存', icon: 'success' })
        this.loadAddresses()
        return
      }

      throw new Error(result.msg || '保存失败')
    } catch (e) {
      wx.hideLoading()
      console.error('saveAddressFromWechat', e)

      const entry = {
        _id: `local_${Date.now()}`,
        name: (res.userName || '').trim(),
        phone: (res.telNumber || '').trim(),
        region: [res.provinceName, res.cityName, res.countyName].filter(Boolean),
        detail: (res.detailInfo || '').trim(),
        isDefault: asDefault || this.data.addresses.length === 0
      }

      if (entry.name && entry.phone) {
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
        title: '保存失败，请部署 manageAddress 云函数',
        icon: 'none',
        duration: 2500
      })
    }
  },

  async setDefault(e) {
    const id = e.currentTarget.dataset.id
    wx.showLoading({ title: '设置中...' })
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
    wx.showModal({
      title: '删除地址',
      content: '确定删除该收货地址？',
      confirmColor: '#D64045',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const result = await this.callManageAddress({ action: 'delete', addressId: id })
          if (result.success) {
            wx.showToast({ title: '已删除', icon: 'success' })
            this.loadAddresses()
          } else {
            wx.showToast({ title: result.msg || '删除失败', icon: 'none' })
          }
        } catch (e) {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })
  }
})
