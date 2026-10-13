// 凭礼笺领取 · 送礼人管理面板：口令 / 作废并换新链接 / 改用手机号核验 / 领取人（2026-10-11）
Component({
  // 弹层零件 ui-pop-*（app.wxss）需要全局类；本组件类名与 app.wxss 无重名（2026-10-13 核对）
  options: { addGlobalClass: true },
  properties: {
    show: { type: Boolean, value: false },
    state: { type: Object, value: {} },
    busy: { type: Boolean, value: false },
    error: { type: String, value: '' },
    notice: { type: String, value: '' }
  },

  data: { confirmReset: false },

  observers: {
    show(v) {
      if (!v) this.setData({ confirmReset: false })
    }
  },

  methods: {
    onAddCode() { if (!this.data.busy) this.triggerEvent('passcode', { enable: true }) },
    onRemoveCode() { if (!this.data.busy) this.triggerEvent('passcode', { enable: false }) },
    onReset() {
      if (this.data.busy) return
      if (!this.data.confirmReset) {
        this.setData({ confirmReset: true })
        return
      }
      this.setData({ confirmReset: false })
      this.triggerEvent('reset')
    },
    onCopyCode() {
      const code = String((this.data.state && this.data.state.passcode) || '')
      if (code) wx.setClipboardData({ data: code })
    },
    onUsePhone() { if (!this.data.busy) this.triggerEvent('usephone') },
    onClose() { if (!this.data.busy) this.triggerEvent('close') },
    noop() {}
  }
})
