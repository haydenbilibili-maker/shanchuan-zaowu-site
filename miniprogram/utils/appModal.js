/**
 * 全站弹窗宿主（AppModal）—— 替代 `wx.showModal` 的**样式化**版本
 *
 * 为什么要做（2026-09-17）：
 *   全仓还有 **166 处 `wx.showModal`**（110 处确认 + 44 处仅提示，横跨约 40 个页面）。
 *   系统弹窗是**白底 Material 风**，与本站「博物黑 + 铜金铭牌」的视觉完全两张皮；
 *   而且它不可定制（不能加权益说明、不能做危险色分级、不能带小程序内的图标语言）。
 *
 * 为什么不是一个 `showModal()` 直接调用：
 *   小程序里自定义弹窗必须**挂进页面节点树**（不能像 Web 那样 appendChild 到 body）。
 *   所以每个用到弹窗的页面需要：
 *     ① wxml 末尾加一行 `<app-modal id="appModal" />`
 *     ② js 用 `withAppModal({...})` 包一层 Page 配置
 *   然后页面内即可：`const r = await this.modal({ title, content, confirmText })`
 *   —— 返回值与 `wx.showModal` 的 success 回调同形：`{ confirm, cancel }`，便于逐处迁移。
 *
 * 迁移原则（重要）：
 *   **一次一页、行为等价**。`wx.showModal` 的 `success(res)` → `await this.modal(...)` 后
 *   判 `res.confirm`，语义完全一致；不要在同一批里顺手改业务逻辑。
 *
 * 用法：
 *   const { withAppModal } = require('../../../utils/appModal')
 *   Page(withAppModal({ data: {...}, methods/handlers... }))
 *   // 页面内
 *   const res = await this.modal({ title: '删除地址', content: '删除后不可恢复', danger: true, confirmText: '删除' })
 *   if (!res.confirm) return
 */
const HOST_ID = 'appModal'

/** 把页面配置包一层，注入 `this.modal(options)` */
function withAppModal(config) {
  const originalOnLoad = config.onLoad
  return Object.assign({}, config, {
    onLoad(...args) {
      this._appModalReady = true
      if (typeof originalOnLoad === 'function') return originalOnLoad.apply(this, args)
    },

    /** 兜底：宿主组件没挂（页面漏了 wxml 那一行）时退回系统弹窗，绝不静默不弹 */
    modal(options) {
      const host = this.selectComponent && this.selectComponent(`#${HOST_ID}`)
      if (host && typeof host.open === 'function') return host.open(options || {})
      const o = options || {}
      console.warn('[appModal] 页面未挂载 <app-modal id="appModal" />，已退回系统弹窗')
      return new Promise((resolve) => {
        wx.showModal({
          title: o.title || '提示',
          content: o.content || '',
          showCancel: o.showCancel !== false,
          confirmText: o.confirmText || '确定',
          cancelText: o.cancelText || '取消',
          confirmColor: o.danger ? '#C0392B' : '#C4A76C',
          success: (res) => resolve({ confirm: !!res.confirm, cancel: !!res.cancel }),
          fail: () => resolve({ confirm: false, cancel: false })
        })
      })
    }
  })
}

module.exports = { withAppModal, APP_MODAL_HOST_ID: HOST_ID }
