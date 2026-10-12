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

/** 唯一的系统弹窗出口（两种入口的「宿主没挂」兜底共用；dialog-ratchet 按文件计数，只留这一处） */
function nativeModal(o) {
  return wx.showModal({ ...o })
}

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
        nativeModal({
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

/** 危险操作的历史写法：confirmColor 用红（#D64045 / #ff4d4f / #C0392B …）→ AppModal danger */
const DANGER_COLOR = /^#(d64045|ff4d4f|c0392b|e74c3c|d13c41|b4432f|e5484d)$/i

/**
 * 与 `wx.showModal` **同入参同回调**的样式化弹窗（2026-10-13 弹层规范，docs/弹层视觉规范_2026-10-13.md）
 *
 * 为什么另开一个：`withAppModal()` 只能包 Page 配置，而 C 端还有一批用 Component() 构造的页面 / 组件 /
 * 纯模块（如 gift/giftVoice.js）在调系统弹窗。逐处改成 Promise 风格风险高 —— 这里做成**入参兼容**：
 * 原生调用只把函数名换成 `openAppModal`、末尾补 `this`，success / fail / complete 原样回调（res 同形），业务逻辑一字不改。
 *
 * 宿主查找：先 ctx（组件实例传 this，宿主挂在组件自己的 wxml 里）→ 再当前页面；都没有就退回系统弹窗（绝不静默不弹）。
 * 映射：confirmColor 为红 → danger；其余颜色忽略（AppModal 主按钮统一品牌金）。
 */
function openAppModal(options, ctx) {
  const o = options || {}
  let host = null
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    for (const c of [ctx, pages[pages.length - 1]]) {
      const h = c && typeof c.selectComponent === 'function' ? c.selectComponent(`#${HOST_ID}`) : null
      if (h && typeof h.open === 'function') { host = h; break }
    }
  } catch (e) { host = null }
  if (!host) return nativeModal(o)
  host.open({
    title: o.title,
    content: o.content,
    overline: o.overline,
    confirmText: o.confirmText,
    cancelText: o.cancelText,
    showCancel: o.showCancel,
    danger: !!o.danger || DANGER_COLOR.test(String(o.confirmColor || ''))
  }).then((res) => {
    try {
      if (typeof o.success === 'function') o.success({ confirm: !!res.confirm, cancel: !!res.cancel, errMsg: 'showModal:ok' })
    } finally {
      if (typeof o.complete === 'function') o.complete()
    }
  })
  return undefined
}

module.exports = { withAppModal, openAppModal, APP_MODAL_HOST_ID: HOST_ID }
