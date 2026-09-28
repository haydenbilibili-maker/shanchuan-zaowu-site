const managerPageConfig = require('../managerPageConfig')
const { TAB_TITLES } = require('../moduleRoutes')
const { guardManagerPage } = require('../../../../utils/managerAuth')
const { canAccessManagerTab } = require('../../utils/staffAuth')

const baseOnLoad = managerPageConfig.onLoad

function parseOrderSubTab(raw) {
  const n = parseInt(raw, 10)
  // 0 待发 / 1 已发 / 2 已完成 / 3 售后 / 4 待支付（补履约入口）
  if (!Number.isFinite(n) || n < 0 || n > 4) return 0
  return n
}

Page({
  ...managerPageConfig,

  async onLoad(options) {
    if (!guardManagerPage()) return
    const tab = parseInt(options && options.tab, 10)
    if (!Number.isFinite(tab) || tab <= 0) {
      wx.showToast({ title: '无效模块', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }

    await baseOnLoad.call(this, options)

    if (!canAccessManagerTab(this.data.workspaceRole, tab)) {
      wx.showToast({ title: '无此功能权限', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }

    let title = options.title ? decodeURIComponent(options.title) : (TAB_TITLES[tab] || '管理')
    if (String(options.from || '') === 'artisan' && tab === 1) {
      title = '本人藏品'
    }

    const productRaw = String((options && options.productTab) || '').trim().toLowerCase()
    const productLibTab =
      productRaw === 'stats' || productRaw === 'category' ? productRaw : 'list'
    const patch = { curTab: tab, pageTitle: title }
    if (tab === 1) patch.productLibTab = productLibTab
    if (tab === 2) patch.subTab = parseOrderSubTab(options && options.subTab)
    // 订单待发货「私信」深链 → 山海有信指定用户
    if (tab === 11) {
      const scope = String((options && options.scope) || '').trim()
      const targetOpenid = String((options && options.targetOpenid) || '').trim()
      let targetNick = ''
      try {
        targetNick = options && options.targetNick
          ? decodeURIComponent(String(options.targetNick))
          : ''
      } catch (e) {
        targetNick = String((options && options.targetNick) || '')
      }
      patch.subTabMessage = 0
      if (scope === 'single' && targetOpenid) {
        patch.pushForm = Object.assign({}, this.data.pushForm || {}, {
          scope: 'single',
          targetOpenid,
          segment: ''
        })
        if (targetNick) {
          patch.omYouxinBuyerHint = targetNick
        }
      }
    }
    this.setData(patch)
    wx.setNavigationBarTitle({ title })

    await this.refreshSubData(tab)
    if (tab === 1 && productLibTab === 'category') this.loadCategoriesManage()
    if (tab === 1 && productLibTab === 'stats') this.loadProductStats()
    // 列表就绪后再开新建/编辑，保证概念预填只应用一次
    this.applyArtisanProductDeepLink(options)
    if (tab === 11 && String((options && options.scope) || '').trim() === 'single') {
      const nick = this.data.omYouxinBuyerHint || ''
      wx.showToast({
        title: nick ? `已选中 ${nick}` : '已填入指定会员',
        icon: 'none'
      })
    }
  },

  // Hub 的 page-tip 只画在 manager/index.wxml，子页没有宿主：这里把全部 showHubTip 转到本页已挂的 <app-toast>
  showHubTip(msg, tone) {
    const text = String(msg || '').trim()
    if (!text) return
    const m = text.length > 12 ? /^(.{2,14}?)[，。；：,;:！!？?]\s*(.+)$/.exec(text) : null
    const title = text.length <= 12 ? text : m ? m[1] : tone === 'warn' ? '请留意' : '已完成'
    const desc = text.length <= 12 ? '' : m ? m[2] : text
    this.showAppToast({
      overline: tone === 'warn' ? 'NOTICE' : 'DONE',
      title,
      desc,
      duration: Math.min(5000, 2200 + desc.length * 60)
    })
  },

  clearHubTip() {},

  onPullDownRefresh() {
    const tab = this.data.curTab
    if (tab) {
      this.refreshSubData(tab).finally(() => wx.stopPullDownRefresh())
      return
    }
    wx.stopPullDownRefresh()
  }
})
