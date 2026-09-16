/**
 * 需求 28：马上有 · 祈福墙管理（超管工作台 → 内容模块）
 *
 * 业务口径：弹幕**不接 UGC 审核**，治理由本页承载 —— 全部弹幕可见（含已隐藏），
 * 可隐藏 / 恢复 / 置顶 / 删除。这是「无审核」决定的**唯一兜底**，所以本页必须能看到
 * 未公开的内容，否则被隐藏的弹幕将无人可见、无从复核。
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'manageWishWall'
const PRODUCT_KEY = 'mashangyou'

const STATUS_TABS = [
  { id: '', label: '全部' },
  { id: 'visible', label: '展示中' },
  { id: 'hidden', label: '已隐藏' }
]

function decorate(row) {
  const item = row || {}
  const t = item.createTime ? new Date(item.createTime) : null
  return {
    ...item,
    statusLabel: item.status === 'hidden' ? '已隐藏' : '展示中',
    timeText: t && !Number.isNaN(t.getTime())
      ? `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
      : ''
  }
}

Page({
  data: {
    ready: false,
    loading: false,
    busyId: '',
    statusTabs: STATUS_TABS,
    activeStatus: '',
    keyword: '',
    list: [],
    counts: { visible: 0, hidden: 0 },
    // 需求 28：AI 基础内容
    seeding: false,
    seedResult: null
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin')
    if (!role) return
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
      const payload = { action: 'staffList', productKey: PRODUCT_KEY, status: this.data.activeStatus }
      const keyword = String(this.data.keyword || '').trim()
      if (keyword) payload.keyword = keyword
      const [listRes, statsRes] = await Promise.all([
        this.callFn(payload),
        this.callFn({ action: 'staffStats', productKey: PRODUCT_KEY }).catch(() => ({ counts: {} }))
      ])
      this.setData({
        list: (listRes.list || []).map(decorate),
        counts: (statsRes && statsRes.counts) || { visible: 0, hidden: 0 }
      })
    } catch (e) {
      console.warn('wish wall staffList', e)
      wx.showToast({ title: formatCloudFnError(e, '加载失败'), icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  switchStatus(e) {
    const status = String((e.currentTarget.dataset && e.currentTarget.dataset.status) || '')
    if (status === this.data.activeStatus) return
    this.setData({ activeStatus: status })
    this.refresh()
  },

  onKeywordInput(e) {
    this.setData({ keyword: String((e.detail && e.detail.value) || '') })
  },

  onKeywordConfirm() {
    this.refresh()
  },

  async toggleStatus(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const next = String((e.currentTarget.dataset && e.currentTarget.dataset.next) || '')
    if (!id || !next || this.data.busyId) return
    this.setData({ busyId: id })
    try {
      const result = await this.callFn({ action: 'staffSetStatus', id, status: next })
      wx.showToast({ title: result.msg || '已更新', icon: 'none' })
      await this.refresh()
    } catch (err) {
      wx.showToast({ title: formatCloudFnError(err, '更新失败'), icon: 'none' })
    } finally {
      this.setData({ busyId: '' })
    }
  },

  async togglePinned(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const pinned = e.currentTarget.dataset.pinned === true || e.currentTarget.dataset.pinned === 'true'
    if (!id || this.data.busyId) return
    this.setData({ busyId: id })
    try {
      const result = await this.callFn({ action: 'staffSetStatus', id, status: 'visible', pinned: !pinned })
      wx.showToast({ title: !pinned ? '已置顶' : '已取消置顶', icon: 'none' })
      await this.refresh()
    } catch (err) {
      wx.showToast({ title: formatCloudFnError(err, '操作失败'), icon: 'none' })
    } finally {
      this.setData({ busyId: '' })
    }
  },

  removeWish(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    if (!id) return
    wx.showModal({
      title: '删除心愿',
      content: '删除后不可恢复。若只是不希望公开，建议先「隐藏」。',
      confirmText: '删除',
      confirmColor: '#D64045',
      success: (res) => {
        if (!res.confirm) return
        this.doRemove(id)
      }
    })
  },

  async doRemove(id) {
    this.setData({ busyId: id })
    try {
      const result = await this.callFn({ action: 'staffRemove', id })
      wx.showToast({ title: result.msg || '已删除', icon: 'none' })
      await this.refresh()
    } catch (err) {
      wx.showToast({ title: formatCloudFnError(err, '删除失败'), icon: 'none' })
    } finally {
      this.setData({ busyId: '' })
    }
  },

  /* ------------------- 需求 28：第一批基础内容（AI 创作） ------------------- */

  /**
   * 先确认再生成：一次性往公开墙面写入多条内容，属于**不可逆的对外动作**
   * （用户已经能看到），所以不能点一下就执行。
   *
   * ⚠️ `confirmText` / `cancelText` 微信限制**最多 4 个字符**。超了 `showModal` 会直接失败，
   * 且不传 `fail` 回调时**既没有弹窗也没有任何报错**（实测反馈「点 AI 生成没反应」就是这条：
   * 原本文案是 5 个字「生成并上墙」）。因此这里两件事都要做：
   *   ① 文案压到 4 字以内；② 补 `fail`，让任何弹窗失败都可见 —— 静默失败比功能缺失更难查。
   * 守卫 `test-wish-wall` 有对应断言 + 注入。
   */
  seedAi() {
    if (this.data.seeding) return
    wx.showModal({
      title: 'AI 生成基础内容',
      content: '将用 AI 创作最多 12 条「马上有XX」心愿并直接上墙，C 端用户即刻可见。生成后可在本页隐藏或删除。',
      confirmText: '生成',
      success: (res) => {
        if (res.confirm) this.doSeedAi()
      },
      fail: (err) => {
        console.warn('wish wall seedAi showModal fail', err)
        wx.showToast({ title: '弹窗打开失败，请重试', icon: 'none' })
      }
    })
  },

  async doSeedAi() {
    this.setData({ seeding: true })
    try {
      const result = await this.callFn({ action: 'staffSeedAi', productKey: PRODUCT_KEY, count: 8 })
      this.setData({ seedResult: result })
      wx.showToast({ title: result.msg || '已上墙', icon: 'none' })
      await this.refresh()
    } catch (err) {
      wx.showToast({ title: formatCloudFnError(err, '生成失败'), icon: 'none', duration: 2500 })
    } finally {
      this.setData({ seeding: false })
    }
  },

  copyText(e) {
    const text = String((e.currentTarget.dataset && e.currentTarget.dataset.text) || '')
    if (!text) return
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '已复制', icon: 'none' }) })
  }
})
