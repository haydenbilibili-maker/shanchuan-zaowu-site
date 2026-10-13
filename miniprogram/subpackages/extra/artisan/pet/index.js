/**
 * 标本师本人 — 伴宠工单（需求 14）
 *
 * 数据来源：云函数 `petMemorialOrder` action `listArtisan`。
 *   ⚠️ framerId 一律由服务端按调用者 openid 反查，客户端不传也不信任何 framerId，
 *      所以这一页天然只能看到「指派给我」的工单。
 *
 * 本页只开放一个写动作：`acceptAssignment`（确认接单）。
 * 报价与状态流转仍归店长 / 超管工作台 —— 标本师侧不开超出职责的写入口。
 */
const { guardArtisanWorkspace, hasPermission, roleHasStored } = require('../../utils/staffAuth')
const { formatCloudFnError } = require('../../utils/memberScan')
const { STATUS_LABELS } = require('../../utils/petMemorialDefaults')
const { openAppModal } = require('../../../../utils/appModal')

const FN = 'petMemorialOrder'

function decorate(row) {
  const item = row || {}
  return {
    ...item,
    statusLabel: STATUS_LABELS[item.status] || item.status || '',
    accepted: !!item.acceptedAt,
    quoteText: item.quoteAmount != null ? `¥${item.quoteAmount}` : '',
    petTitle: [item.petName, item.petSpecies].filter(Boolean).join(' · '),
    contactText: [item.contactName, item.contactPhone].filter(Boolean).join(' '),
    intakeText: [item.intakeMethodLabel, item.preferredDate].filter(Boolean).join(' · ')
  }
}

Page({
  data: {
    ready: false,
    loading: false,
    list: [],
    pendingCount: 0
  },

  async onLoad() {
    const role = await guardArtisanWorkspace()
    if (!role) return
    if (
      !roleHasStored(role, 'specimen_artisan') &&
      !roleHasStored(role, 'super_admin') &&
      !hasPermission(role, 'manageArtisanWorks') &&
      !hasPermission(role, 'manageProducts')
    ) {
      wx.showToast({ title: '暂无伴宠工单权限', icon: 'none' })
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 800)
      return
    }
    this.setData({ ready: true })
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
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

  async refresh() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const result = await this.callFn({ action: 'listArtisan' })
      const list = (Array.isArray(result.list) ? result.list : []).map(decorate)
      this.setData({
        list,
        pendingCount: list.filter((item) => !item.accepted).length
      })
      if (!result.framerId) {
        // 账号没有绑定的标本师档案：不是错误，但必须让本人知道「不会收到工单」
        this.setData({ list: [], pendingCount: 0 })
      }
    } catch (e) {
      console.warn('listArtisan pet orders', e)
      wx.showToast({ title: formatCloudFnError(e, '加载失败'), icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async acceptAssignment(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    if (!id) return
    openAppModal({
      title: '确认接单',
      content: '确认后请尽快与客户联系，沟通工艺与交接安排。',
      confirmText: '确认接单',
      success: (res) => {
        if (!res.confirm) return
        this.doAccept(id)
      }
    }, this)
  },

  async doAccept(id) {
    wx.showLoading({ title: '提交中…', mask: true })
    try {
      const result = await this.callFn({ action: 'acceptAssignment', orderId: id })
      wx.hideLoading()
      wx.showToast({ title: result.msg || '已确认接单', icon: 'none' })
      try { wx.vibrateShort({ type: 'light' }) } catch (err) { /* ignore */ }
      this.refresh()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: formatCloudFnError(e, '操作失败'), icon: 'none' })
    }
  },

  callCustomer(e) {
    const phone = String((e.currentTarget.dataset && e.currentTarget.dataset.phone) || '').trim()
    if (!phone) {
      wx.showToast({ title: '客户未留电话', icon: 'none' })
      return
    }
    wx.makePhoneCall({ phoneNumber: phone, fail: () => {} })
  },

  copyOrder(e) {
    const orderNo = String((e.currentTarget.dataset && e.currentTarget.dataset.no) || '')
    if (!orderNo) return
    wx.setClipboardData({
      data: orderNo,
      success: () => wx.showToast({ title: '已复制工单号', icon: 'none' })
    })
  }
})
