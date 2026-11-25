/**
 * 工作台组合页（2026-11-26 超管工作台功能归并，方案 miniprogram/docs/超管工作台_功能归并_2026-11-25.md）
 *
 * 一枚组合磁贴（如「审批与发票」）→ 本页逐条平铺它的子功能。本页**不自判权限、不另写跳转**：
 *   - 行 = 组合子功能按工作台页的 menu 过滤（看不到的子功能不出现，不放宽权限）；
 *   - 点一行 = 调工作台页（页栈里本页下面那一页）上的原 handler（hubNav.invokeItem），
 *     原磁贴的门禁、订阅授权、Tab 跳转逻辑一字不变；
 *   - 角标与工作台同一数据源（工作台页 data）。
 * 一致性由 check:hub-entries 的 K 规则校验。
 */
const hubNav = require('../manager/hubNav')

const HOST_ROUTE = 'subpackages/manager/manager/index'

function hostPage() {
  const pages = getCurrentPages()
  for (let i = pages.length - 2; i >= 0; i -= 1) {
    if (pages[i] && pages[i].route === HOST_ROUTE) return pages[i]
  }
  return null
}

Page({
  data: {
    ready: false,
    kitId: '',
    title: '',
    sub: '',
    desc: '',
    rows: [],
    lost: false
  },

  onLoad(query) {
    this._kit = hubNav.findKit(String((query && query.kit) || ''))
    if (this._kit) wx.setNavigationBarTitle({ title: this._kit.label })
    this.render()
  },

  /** 从子功能页返回时角标可能变了，重新按工作台数据算一遍 */
  onShow() {
    if (this.data.ready) this.render()
  },

  render() {
    const kit = this._kit
    const host = hostPage()
    const d = (host && host.data) || {}
    const menu = d.menu || {}
    const rows = kit
      ? kit.children.filter((c) => c.keys.some((k) => menu[k] === true)).map((c) => ({
        id: c.id, label: c.label, desc: c.desc, icon: c.icon, badge: hubNav.childBadge(c, d)
      }))
      : []
    this.setData({
      ready: true,
      kitId: kit ? kit.id : '',
      title: kit ? kit.label : '',
      sub: kit ? kit.sub : '',
      desc: kit ? kit.desc : '',
      rows,
      lost: !kit || !host
    })
  },

  onRow(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const host = hostPage()
    const child = this._kit && this._kit.children.find((c) => c.id === id)
    if (!host || !child) {
      this.setData({ lost: true })
      return
    }
    // 再判一次权限（工作台 menu 可能在本页打开期间刷新过）
    if (!child.keys.some((k) => host.data.menu && host.data.menu[k] === true)) {
      this.render()
      return
    }
    hubNav.invokeItem(host, child)
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/' + HOST_ROUTE }) })
  }
})
