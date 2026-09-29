/**
 * 全站样式化弹窗（博物黑 + 铜金铭牌），支持「确认」与「仅提示」两种形态。
 * 视觉与 RegisterAuthDialog / sensitive-blur-gate 同一套语言：铭牌四角 + 铜金 CTA。
 *
 * 由 `utils/appModal.js` 的 `withAppModal()` 通过 `selectComponent('#appModal')` 驱动，
 * 页面侧只需 `<app-modal id="appModal" />` 一行。
 */
Component({
  options: { addGlobalClass: true },

  data: {
    visible: false,
    title: '',
    content: '',
    overline: '',
    confirmText: '确定',
    cancelText: '取消',
    showCancel: true,
    danger: false,
    actions: [],
    _resolve: null
  },

  methods: {
    noop() {},

    /**
     * 打开弹窗，返回与 `wx.showModal` success 同形的 Promise
     * @param {{title?:string, content?:string, overline?:string, confirmText?:string,
     *          cancelText?:string, showCancel?:boolean, danger?:boolean,
     *          actions?:Array<{key:string, text:string, type?:'primary'|'ghost'|'danger'}>}} options
     *   actions：多于两个选项时用（如「覆盖已有 / 仍要新增 / 取消」）；传了就替代确定/取消两个按钮，
     *   结算值多带 `action: key`（key 为 'confirm' / 'cancel' 时 confirm / cancel 同义）
     * @returns {Promise<{confirm:boolean, cancel:boolean, action?:string}>}
     */
    open(options) {
      const o = options || {}
      // 上一个还没结算就再开一个：先把上一个按「取消」结算，避免 Promise 悬挂
      if (this.data._resolve) {
        try { this.data._resolve({ confirm: false, cancel: true }) } catch (e) { /* ignore */ }
      }
      return new Promise((resolve) => {
        this.setData({
          visible: true,
          title: o.title || '提示',
          content: o.content || '',
          overline: o.overline || '',
          confirmText: o.confirmText || '确定',
          cancelText: o.cancelText || '取消',
          showCancel: o.showCancel !== false,
          danger: !!o.danger,
          actions: Array.isArray(o.actions) ? o.actions.filter((a) => a && a.key) : [],
          _resolve: resolve
        })
      })
    },

    settle(confirm) {
      const resolve = this.data._resolve
      this.setData({ visible: false, _resolve: null })
      if (resolve) resolve({ confirm: !!confirm, cancel: !confirm })
    },

    onConfirm() { this.settle(true) },
    onCancel() { this.settle(false) },

    onAction(e) {
      const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || 'cancel'
      const resolve = this.data._resolve
      this.setData({ visible: false, _resolve: null })
      if (resolve) resolve({ confirm: key === 'confirm', cancel: key === 'cancel', action: key })
    }
  }
})
