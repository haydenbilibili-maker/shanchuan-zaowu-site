/**
 * 超管 · 礼赠管理（配置 / 概况 / 订阅）
 * 履约看板请走 gift-ops
 */
const { guardStaffPage, goGiftOps } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'manageGift'
const TIMEOUT_OPTIONS = [3, 7, 14]

function softContentHint(showGift, raw) {
  if (showGift) return '礼赠入口已对顾客展示；关闭后首页与「我的」相关入口会隐藏'
  return '礼赠入口当前隐藏；请到超管工作台「内容开关」开启后再面向顾客'
}

function softSubscribe(sub) {
  const base = sub || {}
  const count = Number(base.configuredCount) || 0
  let summary = base.summary || '未就绪'
  if (count === 3) summary = '已就绪'
  else if (count > 0) summary = `部分就绪（${count}/3）`
  else summary = '未就绪'
  return {
    ...base,
    summary,
    hint: count
      ? '未就绪项会跳过微信提醒，进度仍可通过山海有信送达'
      : '模板审核通过前，进度以山海有信覆盖；就绪后需在云开发配置并重新部署相关云函数'
  }
}

function softStatsNote(note) {
  const t = String(note || '')
  if (!t) return ''
  if (/200/.test(t)) return '概况基于最近约 200 笔礼赠单'
  return t
}

Page({
  data: {
    ready: false,
    loading: false,
    saving: false,
    hasLoaded: false,
    canEdit: false,
    dirty: false,
    fromDefault: true,
    docId: '',
    ruleText: '',
    nudgeRuleSummary: '',
    showGift: false,
    contentFlagsHint: '',
    settings: {
      addressFillTimeoutDays: 7,
      defaultDeliveryType: 'invite_address',
      allowHidePriceToggle: true
    },
    savedSnapshot: '',
    timeoutOptions: TIMEOUT_OPTIONS,
    deliveryOptions: [
      { key: 'invite_address', label: '邀请 TA 填写地址' },
      { key: 'ship_to_receiver', label: '快递给 TA' },
      { key: 'ship_to_self', label: '寄给我' },
      { key: 'store_pickup', label: '门店自提代赠' }
    ],
    deliveryIndex: 0,
    subscribe: {
      summary: '未就绪',
      lamp: 'warn',
      items: [],
      hint: ''
    },
    stats: {
      todayCount: 0,
      last7Count: 0,
      todoTotal: 0,
      todoLamp: 'success',
      done: 0,
      todos: {
        awaiting_address: 0,
        awaiting_ship: 0,
        pickup_verify: 0
      },
      note: ''
    },
    loadError: ''
  },

  async onLoad() {
    const role = await guardStaffPage('manager')
    if (!role) return
    const canManage =
      !!(role.isSuperAdmin || role.superAdmin) ||
      (role.permissions || []).indexOf('manageGift') !== -1
    if (!canManage) {
      wx.showToast({ title: '暂无礼赠管理权限', icon: 'none' })
      setTimeout(() => {
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
      }, 1200)
      return
    }
    this.setData({ ready: true })
    this.loadHub()
  },

  onShow() {
    if (this.data.ready && !this.data.dirty) this.loadHub()
  },

  onPullDownRefresh() {
    this.loadHub({ force: true }).finally(() => wx.stopPullDownRefresh())
  },

  snapshotSettings(settings) {
    const s = settings || this.data.settings
    return [
      s.addressFillTimeoutDays,
      s.defaultDeliveryType,
      s.allowHidePriceToggle ? 1 : 0
    ].join('|')
  },

  markDirty() {
    const dirty = this.snapshotSettings() !== this.data.savedSnapshot
    if (dirty !== this.data.dirty) this.setData({ dirty })
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

  applyHub(result) {
    const settings = result.settings || this.data.settings
    const deliveryOptions = result.deliveryOptions && result.deliveryOptions.length
      ? result.deliveryOptions
      : this.data.deliveryOptions
    let deliveryIndex = 0
    deliveryOptions.forEach((opt, i) => {
      if (opt.key === settings.defaultDeliveryType) deliveryIndex = i
    })
    const nextSettings = {
      addressFillTimeoutDays: settings.addressFillTimeoutDays || 7,
      defaultDeliveryType: settings.defaultDeliveryType || 'invite_address',
      allowHidePriceToggle: settings.allowHidePriceToggle !== false
    }
    const stats = result.stats || this.data.stats
    this.setData({
      loading: false,
      hasLoaded: true,
      loadError: '',
      canEdit: !!result.canEdit,
      fromDefault: !!result.fromDefault,
      docId: result.docId || '',
      ruleText: result.ruleText || '',
      nudgeRuleSummary: result.nudgeRuleSummary || '',
      showGift: !!result.showGift,
      contentFlagsHint: softContentHint(!!result.showGift, result.contentFlagsHint),
      settings: nextSettings,
      savedSnapshot: this.snapshotSettings(nextSettings),
      dirty: false,
      timeoutOptions: result.timeoutOptions || TIMEOUT_OPTIONS,
      deliveryOptions,
      deliveryIndex,
      subscribe: softSubscribe(result.subscribe || this.data.subscribe),
      stats: {
        todayCount: stats.todayCount || 0,
        last7Count: stats.last7Count || 0,
        todoTotal: stats.todoTotal || 0,
        todoLamp: stats.todoLamp || 'success',
        done: stats.done || 0,
        todos: {
          awaiting_address: (stats.todos && stats.todos.awaiting_address) || 0,
          awaiting_ship: (stats.todos && stats.todos.awaiting_ship) || 0,
          pickup_verify: (stats.todos && stats.todos.pickup_verify) || 0
        },
        note: softStatsNote(stats.note)
      }
    })
  },

  async loadHub(opts) {
    if (this.data.loading) return
    if (this.data.dirty && !(opts && opts.force)) return
    this.setData({ loading: true, loadError: '' })
    try {
      const result = await this.callFn({ action: 'getSettings' })
      this.applyHub(result)
    } catch (e) {
      this.setData({
        loading: false,
        loadError: formatCloudFnError(e, '礼赠管理暂不可用')
      })
    }
  },

  onRefreshTap() {
    if (this.data.loading) return
    if (this.data.dirty) {
      wx.showModal({
        title: '有未保存更改',
        content: '刷新将丢弃当前修改，是否继续？',
        confirmText: '刷新',
        cancelText: '留下',
        success: (res) => {
          if (res.confirm) this.loadHub({ force: true })
        }
      })
      return
    }
    this.loadHub({ force: true })
  },

  pickTimeout(e) {
    if (!this.data.canEdit) return
    const days = parseInt(e.currentTarget.dataset.days, 10)
    if (!days) return
    this.setData({ 'settings.addressFillTimeoutDays': days }, () => this.markDirty())
  },

  onDeliveryChange(e) {
    if (!this.data.canEdit) return
    const index = parseInt(e.detail.value, 10) || 0
    const opt = this.data.deliveryOptions[index]
    if (!opt) return
    this.setData(
      {
        deliveryIndex: index,
        'settings.defaultDeliveryType': opt.key
      },
      () => this.markDirty()
    )
  },

  onToggleHidePrice() {
    if (!this.data.canEdit) return
    this.setData(
      {
        'settings.allowHidePriceToggle': !this.data.settings.allowHidePriceToggle
      },
      () => this.markDirty()
    )
  },

  goOpsBoard(e) {
    const bucket = String(
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.bucket) || ''
    ).trim()
    if (bucket) goGiftOps({ bucket })
    else goGiftOps()
  },

  goContentFlags() {
    wx.navigateTo({
      url: '/subpackages/manager/manager/workspace/index?tab=16&title=' + encodeURIComponent('内容开关'),
      fail: () => wx.showToast({ title: '请从超管工作台打开内容开关', icon: 'none' })
    })
  },

  async saveSettings() {
    if (!this.data.canEdit) {
      wx.showToast({ title: '当前账号仅可查看', icon: 'none' })
      return
    }
    if (!this.data.dirty) {
      wx.showToast({ title: '没有需要保存的更改', icon: 'none' })
      return
    }
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      const result = await this.callFn({
        action: 'saveSettings',
        docId: this.data.docId,
        settings: this.data.settings
      })
      const nextSettings = result.settings || this.data.settings
      this.setData({
        docId: result.docId || this.data.docId,
        fromDefault: false,
        ruleText: result.ruleText || '',
        nudgeRuleSummary: result.nudgeRuleSummary || this.data.nudgeRuleSummary,
        settings: nextSettings,
        savedSnapshot: this.snapshotSettings(nextSettings),
        dirty: false
      })
      wx.showToast({ title: '已保存', icon: 'success' })
      await this.loadHub({ force: true })
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
