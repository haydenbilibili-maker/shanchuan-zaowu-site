/**
 * 超管工作台「审核模式」（2026-11-25 产品负责人）
 *
 * 一页搞定提审：**功能开关**（审核一键：AI 与内容入口）+ **藏品上下架**（白名单 / 审核下架 / 审核上架）。
 * 原有的两个完整入口（内容开关 / 藏品库→风险管理）**都保留**，本页只是把它们的内核前置到一页，做加法。
 *
 * 门禁：磁贴仅超管可见（menu.reviewMode 只进 SUPER_ADMIN_MENUS）；页内 guardStaffPage('super_admin')；
 * 两个云函数各自再鉴权（getContentDisplayFlags 需店长级、manageProductReview 需超管）再执法。
 * 口径完全复用既有能力：本页不新造开关、不改快照语义。
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { openAppModal } = require('../../../utils/appModal')

const FLAGS_FN = 'getContentDisplayFlags'
const REVIEW_FN = 'manageProductReview'

/** 审核一键影响的六项（与云函数 / 内容开关面板同一份） */
const REVIEW_FLAGS = ['showAiIdentify', 'museumGuideOpen', 'showMaShangYou', 'showUserCommunity', 'showSpecimenArchive', 'showLive']
const REVIEW_ROWS = [
  { key: 'showAiIdentify', label: 'AI 标本鉴定' },
  { key: 'museumGuideOpen', label: '博物君（AI 馆员）' },
  { key: 'showMaShangYou', label: '马上有 · 心愿签' },
  { key: 'showUserCommunity', label: '我的山海社区' },
  { key: 'showSpecimenArchive', label: '馆藏标本档案' },
  { key: 'showLive', label: '馆内直播入口' }
]


Page({
  data: {
    ready: false,
    loading: false,
    saving: false,
    flags: null,
    reviewRows: REVIEW_ROWS,
    reviewMode: false,
    shelfRunning: '',
    hint: '',
    shelf: { status: 'idle', whitelistCount: 0, on: 0, total: 0, reviewOffCount: 0, halls: [], emptyHalls: [] }
  },

  /** 页内提示（不用原生 toast，弹窗棘轮要求统一组件） */
  hint(text) {
    this.setData({ hint: text })
    clearTimeout(this._hintTimer)
    this._hintTimer = setTimeout(() => this.setData({ hint: '' }), 2400)
  },

  onUnload() {
    clearTimeout(this._hintTimer)
  },

  async onLoad() {
    const staff = await guardStaffPage('super_admin')
    if (!staff) return
    this.setData({ ready: true })
    await Promise.all([this.loadFlags(), this.loadShelf()])
  },

  async onPullDownRefresh() {
    try {
      await Promise.all([this.loadFlags(), this.loadShelf()])
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadFlags() {
    try {
      const res = await wx.cloud.callFunction({ name: FLAGS_FN, data: { action: 'get' } })
      const out = (res && res.result) || {}
      const flags = out.flags || {}
      // 面板口径：museumGuideOpen 用**原值**（museumGuideFlag），避免把"超管开馆"的 AND 结果写回去
      const guideRaw = typeof flags.museumGuideFlag === 'boolean' ? flags.museumGuideFlag : flags.museumGuideOpen !== false
      const payload = Object.assign({}, flags, { museumGuideOpen: guideRaw })
      this.setData({
        flags: payload,
        reviewMode: flags.reviewMode === true,
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false })
      this.hint('功能开关读取失败')
    }
  },

  async loadShelf() {
    try {
      const res = await wx.cloud.callFunction({ name: REVIEW_FN, data: { action: 'status' } })
      const out = (res && res.result) || {}
      if (!out.success) {
        this.hint(out.msg || '审核状态读取失败')
        return
      }
      this.setData({
        shelf: {
          status: out.status || 'idle',
          whitelistCount: out.whitelistCount || 0,
          on: (out.counts && out.counts.on) || 0,
          total: (out.counts && out.counts.total) || 0,
          reviewOffCount: out.reviewOffCount || 0,
          halls: out.halls || [],
          emptyHalls: out.emptyHalls || []
        }
      })
    } catch (e) {
      this.hint('审核状态读取失败')
    }
  },

  /** 审核一键：开 = 快照六项原值后全关；关 = 按快照恢复。保存后立即写云端 */
  async onToggleReviewMode(e) {
    const on = !!(e && e.detail && e.detail.value)
    const flags = Object.assign({}, this.data.flags || {})
    if (on) {
      const snapshot = {}
      REVIEW_FLAGS.forEach((k) => { snapshot[k] = flags[k] !== false })
      REVIEW_FLAGS.forEach((k) => { flags[k] = false })
      flags.reviewMode = true
      flags.reviewSnapshot = snapshot
    } else {
      const snap = flags.reviewSnapshot || {}
      REVIEW_FLAGS.forEach((k) => { if (typeof snap[k] === 'boolean') flags[k] = snap[k] })
      flags.reviewMode = false
      flags.reviewSnapshot = null
    }
    this.setData({ saving: true, flags })
    const ok = await this.saveFlags(flags)
    this.setData({ saving: false })
    if (ok) {
      this.setData({ reviewMode: on })
      this.hint(on ? '已进入审核模式，功能入口已关闭' : '已退出审核模式，按原值恢复')
    } else {
      this.setData({ reviewMode: !on }) // 回滚开关位置
    }
  },

  async saveFlags(flags) {
    try {
      const res = await wx.cloud.callFunction({ name: FLAGS_FN, data: { action: 'save', flags } })
      const out = (res && res.result) || {}
      if (!out.success) {
        this.hint(out.msg || '保存失败')
        return false
      }
      this.setData({ flags: Object.assign({}, flags, out.flags || {}) })
      return true
    } catch (e) {
      this.hint('保存失败')
      return false
    }
  },

  async runShelf(action, title) {
    if (this.data.shelfRunning) return
    this.setData({ shelfRunning: action })
    this.setData({ hint: title })
    try {
      const res = await wx.cloud.callFunction({ name: REVIEW_FN, data: { action } })
      const out = (res && res.result) || {}
      if (!out.success) {
        this.hint(out.msg || '操作失败')
      } else if (out.noop) {
        this.hint(out.msg || '没有需要下架的商品')
      } else if (action === 'buildWhitelist') {
        this.hint(`白名单已更新：${out.whitelistCount} 件`)
      } else if (action === 'offShelfForReview') {
        this.hint(`审核下架：保留 ${out.whitelistCount} 件，下架 ${out.offCount} 件`)
      } else {
        this.hint(`已恢复 ${out.restored} 件`)
      }
      await this.loadShelf()
    } catch (e) {
      this.hint('操作失败')
    } finally {
      this.setData({ shelfRunning: '' })
    }
  },

  onBuildWhitelist() {
    this.runShelf('buildWhitelist', '更新中…')
  },

  onOffShelf() {
    const keep = this.data.shelf.whitelistCount || 0
    if (!keep) return this.hint('先生成审核白名单')
    openAppModal({
      title: '审核下架',
      overline: 'REVIEW',
      content: `审核期只保留白名单 ${keep} 件，其余全部下架；审核通过后点「审核上架」恢复。`,
      confirmText: '审核下架',
      confirmColor: '#C4443A',
      success: (r) => { if (r.confirm) this.runShelf('offShelfForReview', '下架中…') }
    }, this)
  },

  onRestore() {
    openAppModal({
      title: '审核上架',
      overline: 'REVIEW',
      content: `把审核时下架的 ${this.data.shelf.reviewOffCount || 0} 件恢复上架（审核前就已下架的不动）。`,
      confirmText: '审核上架',
      success: (r) => { if (r.confirm) this.runShelf('restoreAfterReview', '恢复中…') }
    }, this)
  },

  goContentFlags() {
    wx.navigateTo({ url: '/subpackages/manager/manager/index?tab=16', fail: () => this.hint('页面暂不可用') })
  },

  goRisk() {
    wx.navigateTo({ url: '/subpackages/manager/manager/index?tab=1&lib=risk', fail: () => this.hint('页面暂不可用') })
  }
})
