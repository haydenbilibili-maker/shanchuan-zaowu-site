// 礼笺领取核验 · 手机号弹层：只做输入与格式校验，不缓存、不回显完整号码
Component({
  properties: {
    show: { type: Boolean, value: false },
    overline: { type: String, value: 'VERIFY' },
    title: { type: String, value: '' },
    desc: { type: String, value: '' },
    placeholder: { type: String, value: '输入 11 位手机号' },
    confirmText: { type: String, value: '确定' },
    quickText: { type: String, value: '' },
    clearText: { type: String, value: '' },
    busy: { type: Boolean, value: false },
    error: { type: String, value: '' }
  },

  data: { value: '', localError: '' },

  observers: {
    show(v) {
      if (v) this.setData({ value: '', localError: '' })
    }
  },

  methods: {
    onInput(e) {
      this.setData({ value: String((e.detail && e.detail.value) || '').replace(/\D/g, '').slice(0, 11), localError: '' })
    },
    onConfirm() {
      if (this.data.busy) return
      const phone = this.data.value
      if (!/^1\d{10}$/.test(phone)) {
        this.setData({ localError: '请输入 11 位手机号' })
        return
      }
      this.triggerEvent('confirm', { phone })
    },
    onQuick() {
      if (!this.data.busy) this.triggerEvent('quick')
    },
    onClear() {
      if (!this.data.busy) this.triggerEvent('clear')
    },
    onClose() {
      if (!this.data.busy) this.triggerEvent('close')
    },
    noop() {}
  }
})
