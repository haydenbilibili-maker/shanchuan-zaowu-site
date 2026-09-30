// 店长/超管看板 hub（custom 导航 + page-edge-back）；功能模块见 workspace/index
const managerPageConfig = require('./managerPageConfig')
const { goManagerModule, TAB_TITLES } = require('./moduleRoutes')
const { goStaffConsole, canAccessManagerTab } = require('../utils/staffAuth')
const { leaveWorkbench: leaveWorkspace, fallbackLeaveWorkbench } = require('../utils/workspaceBack')
const hubNav = require('./hubNav')

const baseOnLoad = managerPageConfig.onLoad
const baseApplyWorkspaceRole = managerPageConfig.applyWorkspaceRole
const baseRefreshOpsSignals = managerPageConfig.refreshOpsSignals
const HUB_SHEET_CLOSED = { open: false, id: '', title: '', items: [] }
const HUB_TODO_EMPTY = { total: 0, totalText: '0', items: [] }

function queryExtras(options) {
  const o = options || {}
  const parts = []
  Object.keys(o).forEach((k) => {
    if (k === 'tab' || k === 'title' || k === 'curTab') return
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(o[k])}`)
  })
  return parts.join('&')
}

function redirectEmbeddedModule(page, options) {
  const tab = page.data.curTab
  if (!tab || tab === 0) return false
  const title = page.data.pageTitle || TAB_TITLES[tab] || '管理'
  const extra = queryExtras(options)
  page.setData({ curTab: 0, pageTitle: '' })
  goManagerModule(tab, title, extra)
  return true
}

Page({
  ...managerPageConfig,

  async onLoad(options) {
    this.setData({ hubSec: {}, hubSheet: HUB_SHEET_CLOSED, hubTodo: HUB_TODO_EMPTY })
    await baseOnLoad.call(this, options)
    redirectEmbeddedModule(this, options)
  },

  applyWorkspaceRole(role) {
    baseApplyWorkspaceRole.call(this, role)
    this.setData({ hubSec: hubNav.sectionFlags(this.data.menu), hubTodo: hubNav.buildTodos(this.data) })
  },

  /** 角标计数每次变化后都会走这里，顺带汇总顶部待办条 */
  refreshOpsSignals() {
    baseRefreshOpsSignals.call(this)
    this.setData({ hubTodo: hubNav.buildTodos(this.data) })
  },

  onHubTodo(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    hubNav.invokeItem(this, hubNav.findTodo(id))
  },

  /** 合并磁贴：一个可见子项直接进入，多个时打开底部面板 */
  openHubGroup(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.group) || '')
    const items = hubNav.visibleItems(id, this.data.menu)
    if (!items.length) {
      if (typeof this.showHubTip === 'function') this.showHubTip('无此功能权限', 'warn')
      return
    }
    if (items.length === 1) {
      hubNav.invokeItem(this, items[0])
      return
    }
    wx.vibrateShort({ type: 'light' })
    this.setData({ hubSheet: hubNav.buildSheet(id, this.data) })
  },

  closeHubGroup() {
    if (this.data.hubSheet && this.data.hubSheet.open) this.setData({ hubSheet: HUB_SHEET_CLOSED })
  },

  onHubGroupItem(e) {
    const itemId = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const groupId = (this.data.hubSheet && this.data.hubSheet.id) || ''
    const item = hubNav.findItem(groupId, itemId)
    this.setData({ hubSheet: HUB_SHEET_CLOSED })
    if (item) hubNav.invokeItem(this, item)
  },

  switchTab(e) {
    wx.vibrateShort({ type: 'light' })
    const idx = parseInt(e.currentTarget.dataset.idx, 10)
    const title = e.currentTarget.dataset.title || TAB_TITLES[idx] || ''
    if (idx === 3) {
      goStaffConsole()
      return
    }
    if (!canAccessManagerTab(this.data.workspaceRole, idx)) {
      if (typeof this.showHubTip === 'function') this.showHubTip('无此功能权限', 'warn')
      else wx.showToast({ title: '无此功能权限', icon: 'none' })
      return
    }
    goManagerModule(idx, title)
  },

  backToDashboard() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/user/index' })
    })
  },

  onWorkspaceBack() {
    if (this.data.showCommentReplyModal) return true
    if (this.data.hubSheet && this.data.hubSheet.open) {
      this.closeHubGroup()
      return true
    }
    this.leaveWorkbench()
    return true
  },

  leaveWorkbench() {
    if (this.data.showCommentReplyModal) return
    leaveWorkspace({ fallbackUrl: '/pages/index/index' })
  },

  fallbackLeaveWorkbench() {
    fallbackLeaveWorkbench('/pages/index/index')
  },

  onBackPress() {
    if (this.data.showCommentReplyModal) return false
    return false
  }
})
