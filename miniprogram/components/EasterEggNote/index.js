Component({
  data: {
    visible: false,
    closing: false,
    firstTime: false,
    egg: null
  },

  methods: {
    show(egg, extras = {}) {
      if (!egg) return
      this.setData({
        visible: true,
        closing: false,
        firstTime: !!extras.firstTime,
        egg
      })
      try {
        wx.vibrateShort({ type: 'light' })
      } catch (e) {
        // ignore
      }
    },

    hide() {
      if (!this.data.visible || this.data.closing) return
      this.setData({ closing: true })
      setTimeout(() => {
        this.setData({ visible: false, closing: false })
      }, 220)
    },

    onMaskTap() {
      this.hide()
    },

    onClose() {
      this.hide()
    },

    stopPropagation() {}
  }
})
