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
const HUB_TODO_EMPTY = { total: 0, totalText: '0', items: [], any: false }
const HUB_FAV_EDIT_CLOSED = { open: false, ids: [], selected: [], groups: [], full: false, count: 0, max: hubNav.FAV_MAX }
const HUB_CAT_EMPTY = { total: 0, anchors: [] }

/** 本机常用：{ [workspaceRole]: [入口 id] }，与 2026-09-30 首版同一个 key、同一形状（旧数据原样可读） */
function readFavStore() {
  try {
    const v = wx.getStorageSync(hubNav.FAV_STORAGE_KEY)
    return v && typeof v === 'object' ? v : {}
  } catch (e) {
    return {}
  }
}

/** 已保存（含保存为空）用保存值，否则按角色默认 */
function loadFavIds(role, menu) {
  const saved = readFavStore()[role]
  if (Array.isArray(saved)) return hubNav.normalizeFavs(saved, menu)
  return hubNav.defaultFavs(role, menu)
}

/** 编辑面板保存与长按加入共用：先归一化（映射 / 权限 / 上限）再按角色写回，其它角色的保存值原样保留 */
function persistFavs(page, ids) {
  const clean = hubNav.normalizeFavs(ids, page.data.menu)
  const store = readFavStore()
  store[page.data.workspaceRole || 'unknown'] = clean
  try {
    wx.setStorageSync(hubNav.FAV_STORAGE_KEY, store)
  } catch (err) {
    return null
  }
  return clean
}

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
    this.setData({
      hubSec: {},
      hubSheet: HUB_SHEET_CLOSED,
      hubTodo: HUB_TODO_EMPTY,
      hubFav: [],
      hubFavEdit: HUB_FAV_EDIT_CLOSED,
      hubSpan: {},
      hubCat: HUB_CAT_EMPTY,
      hubPinned: {},
      hubPinTip: ''
    })
    await baseOnLoad.call(this, options)
    redirectEmbeddedModule(this, options)
  },

  applyWorkspaceRole(role) {
    baseApplyWorkspaceRole.call(this, role)
    this._favIds = loadFavIds(this.data.workspaceRole, this.data.menu)
    this.setData(hubNav.buildHubView(this._favIds, this.data))
  },

  onUnload() {
    if (this._pinTipTimer) clearTimeout(this._pinTipTimer)
    if (typeof managerPageConfig.onUnload === 'function') managerPageConfig.onUnload.call(this)
  },

  /** 角标计数每次变化后都会走这里，顺带汇总顶部待办条 */
  refreshOpsSignals() {
    baseRefreshOpsSignals.call(this)
    this.setData({ hubTodo: hubNav.buildTodos(this.data), hubFav: hubNav.buildFavView(this._favIds || [], this.data) })
  },

  /* ── 我的常用 ── */
  onHubFav(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const entry = hubNav.findEntry(id)
    if (!entry || !entry.keys.some((k) => this.data.menu && this.data.menu[k])) {
      if (typeof this.showHubTip === 'function') this.showHubTip('无此功能权限', 'warn')
      return
    }
    hubNav.invokeItem(this, entry)
  },

  openFavEditor() {
    wx.vibrateShort({ type: 'light' })
    this.setData({ hubFavEdit: hubNav.buildFavEditor(this._favIds || [], this.data.menu) })
  },

  onFavToggle(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const cur = this.data.hubFavEdit.ids || []
    if (cur.indexOf(id) === -1 && cur.length >= hubNav.FAV_MAX) {
      if (typeof this.showHubTip === 'function') this.showHubTip(`常用最多 ${hubNav.FAV_MAX} 个，先移除一个`, 'warn')
      return
    }
    this.setData({ hubFavEdit: hubNav.buildFavEditor(hubNav.toggleFav(cur, id), this.data.menu) })
  },

  onFavMove(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const ids = hubNav.moveFav(this.data.hubFavEdit.ids || [], String(ds.id || ''), ds.dir === 'up' ? 'up' : 'down')
    this.setData({ hubFavEdit: hubNav.buildFavEditor(ids, this.data.menu) })
  },

  onFavReset() {
    this.setData({ hubFavEdit: hubNav.buildFavEditor(hubNav.defaultFavs(this.data.workspaceRole, this.data.menu), this.data.menu) })
  },

  onFavSave() {
    const ids = persistFavs(this, this.data.hubFavEdit.ids || [])
    if (!ids) {
      if (typeof this.showHubTip === 'function') this.showHubTip('常用保存失败，请重试', 'warn')
      return
    }
    this._favIds = ids
    this.setData({ hubFavEdit: HUB_FAV_EDIT_CLOSED, ...hubNav.buildHubView(ids, this.data) })
  },

  /** 长按「全部功能」里的入口：加入 / 移出常用（就地提示，不弹窗；页顶提示条在长页底部看不见） */
  onHubPin(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.fid) || '')
    const entry = hubNav.findEntry(id)
    if (!entry) return
    const r = hubNav.pinToggle(this._favIds || [], id, this.data.menu)
    let tip = ''
    if (r.full) tip = `常用已满 ${hubNav.FAV_MAX} 个，先在上方「编辑」里移除一个`
    else if (r.changed) {
      const ids = persistFavs(this, r.ids)
      if (!ids) tip = '常用保存失败，请重试'
      else {
        this._favIds = ids
        tip = r.added ? `已加入常用：${entry.label}` : `已移出常用：${entry.label}`
        this.setData(hubNav.buildHubView(ids, this.data))
      }
    }
    if (!tip) return
    wx.vibrateShort({ type: 'light' })
    if (this._pinTipTimer) clearTimeout(this._pinTipTimer)
    this.setData({ hubPinTip: tip })
    this._pinTipTimer = setTimeout(() => {
      this._pinTipTimer = null
      this.setData({ hubPinTip: '' })
    }, 1800)
  },

  /** 分组锚点：滚到对应分区（扣掉自绘导航高度） */
  onHubAnchor(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    if (!id) return
    wx.pageScrollTo({
      selector: `#hub-sec-${id}`,
      offsetTop: -((Number(this.data.navSpacerHeight) || 0) + 8),
      duration: 240
    })
  },

  closeFavEditor() {
    if (this.data.hubFavEdit && this.data.hubFavEdit.open) this.setData({ hubFavEdit: HUB_FAV_EDIT_CLOSED })
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
    if (this.data.hubFavEdit && this.data.hubFavEdit.open) {
      this.closeFavEditor()
      return true
    }
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
