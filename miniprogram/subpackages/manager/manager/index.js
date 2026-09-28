// 店长/超管看板 hub（custom 导航 + page-edge-back）；功能模块见 workspace/index
const managerPageConfig = require('./managerPageConfig')
const { goManagerModule, TAB_TITLES } = require('./moduleRoutes')
const { goStaffConsole, canAccessManagerTab } = require('../utils/staffAuth')
const { leaveWorkbench: leaveWorkspace, fallbackLeaveWorkbench } = require('../utils/workspaceBack')

const baseOnLoad = managerPageConfig.onLoad

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
    await baseOnLoad.call(this, options)
    redirectEmbeddedModule(this, options)
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
