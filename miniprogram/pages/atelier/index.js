// pages/atelier/index.js — 主包 Tab 壳：标本工坊（定制入口）
const { trackBehavior } = require('../../utils/trackBehavior')
const { xingchenCover } = require('../../config/storeMediaCdn')
const {
  fetchContentDisplayFlags,
  toastSpecimenCustomClosed,
  toastPetMemorialClosed,
  toastGiftClosed
} = require('../../utils/contentDisplayFlags')

Page({
  data: {
    heroImage: xingchenCover,
    showSpecimenCustom: false,
    showPetMemorial: true,
    showGift: false
  },

  onLoad(options) {
    trackBehavior('custom_hub_enter', 'from', (options && options.from) || 'tab')
    try {
      const { getCachedContentDisplayFlags } = require('../../utils/contentDisplayFlags')
      const cached = getCachedContentDisplayFlags()
      if (cached && cached.flags) {
        this.setData({
          showSpecimenCustom: cached.flags.showSpecimenCustom === true,
          showPetMemorial: cached.flags.showPetMemorial !== false,
          showGift: cached.flags.showGift === true
        })
      }
    } catch (e) { /* ignore */ }
    this.loadDisplayFlags()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    this.loadDisplayFlags()
  },

  async loadDisplayFlags() {
    if (this._displayFlagsLoading) return
    this._displayFlagsLoading = true
    try {
      const { flags } = await fetchContentDisplayFlags({
        onUpdate: (payload) => {
          if (!payload || !payload.flags) return
          this.setData({
            showSpecimenCustom: payload.flags.showSpecimenCustom === true,
            showPetMemorial: payload.flags.showPetMemorial !== false,
            showGift: payload.flags.showGift === true
          })
        }
      })
      this.setData({
        showSpecimenCustom: flags.showSpecimenCustom === true,
        showPetMemorial: flags.showPetMemorial !== false,
        showGift: flags.showGift === true
      })
    } catch (e) {
      this.setData({ showSpecimenCustom: false, showPetMemorial: true, showGift: false })
    } finally {
      this._displayFlagsLoading = false
    }
  },

  goStandard() {
    if (!this.data.showSpecimenCustom) {
      toastSpecimenCustomClosed()
      return
    }
    trackBehavior('custom_hub_select', 'type', 'standard')
    wx.navigateTo({
      url: '/subpackages/feature/custom/index?from=hub',
      fail: () => wx.showToast({ title: '无法打开定制', icon: 'none' })
    })
  },

  goPet() {
    if (!this.data.showPetMemorial) {
      toastPetMemorialClosed()
      return
    }
    trackBehavior('custom_hub_select', 'type', 'pet')
    wx.navigateTo({
      url: '/subpackages/feature/custom/pet/index?from=hub',
      fail: () => wx.showToast({ title: '无法打开伴宠记忆', icon: 'none' })
    })
  },

  goGift() {
    if (!this.data.showGift) {
      toastGiftClosed()
      return
    }
    trackBehavior('gift_entry_click', 'from', 'atelier')
    wx.navigateTo({
      url: '/subpackages/feature/gift/hub/index?from=atelier',
      fail: () => wx.showToast({ title: '无法打开礼赠', icon: 'none' })
    })
  },

  goPetOrders() {
    if (!this.data.showPetMemorial) {
      toastPetMemorialClosed()
      return
    }
    wx.navigateTo({
      url: '/subpackages/feature/custom/pet/list/index?from=hub',
      fail: () => wx.showToast({ title: '无法打开工单', icon: 'none' })
    })
  },

  goCustomOrders() {
    if (!this.data.showSpecimenCustom) {
      toastSpecimenCustomClosed()
      return
    }
    wx.navigateTo({
      url: '/subpackages/feature/custom/orders/index?from=hub',
      fail: () => wx.showToast({ title: '无法打开订单', icon: 'none' })
    })
  }
})
