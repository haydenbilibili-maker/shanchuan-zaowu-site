const { couponChannelLabel } = require('../../../../utils/couponHelper')
const {
  LAMP,
  printPhaseLamp,
  couponChannelLamp,
  couponExpireLamp
} = require('../../utils/couponPrintLamp')

Component({
  // 与 UserVipCard 等一致：允许 app.wxss 的 .signal-light / lamp-* 渗入
  options: {
    addGlobalClass: true,
    styleIsolation: 'apply-shared'
  },

  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '礼券' },
    value: { type: Number, value: 0 },
    minSpend: { type: Number, value: 0 },
    expireDate: { type: String, value: '' },
    channel: { type: String, value: 'all' },
    /** 领券/兑换失败时置 true，主灯落 error */
    failed: { type: Boolean, value: false }
  },

  data: {
    printing: false,
    finished: false,
    failedShow: false,
    animating: false,
    valueLabel: '0',
    minSpendLabel: '',
    channelLabel: '',
    printLightClass: LAMP.muted,
    channelLightClass: LAMP.muted,
    expireLightClass: LAMP.muted
  },

  observers: {
    visible(v) {
      if (v) this.startPrint()
      else this.reset()
    },
    failed(v) {
      if (v && this.properties.visible) this.markFailed()
    }
  },

  methods: {
    clearTimers() {
      if (this._printTimer) clearTimeout(this._printTimer)
      if (this._feedTimer1) clearTimeout(this._feedTimer1)
      if (this._feedTimer2) clearTimeout(this._feedTimer2)
      if (this._finishTimer) clearTimeout(this._finishTimer)
      this._printTimer = null
      this._feedTimer1 = null
      this._feedTimer2 = null
      this._finishTimer = null
    },

    reset() {
      this.clearTimers()
      this._failed = false
      this.setData({
        printing: false,
        finished: false,
        failedShow: false,
        animating: false,
        printLightClass: LAMP.muted,
        channelLightClass: LAMP.muted,
        expireLightClass: LAMP.muted
      })
    },

    softVibrate(type) {
      try {
        if (type === 'long') wx.vibrateLong()
        else wx.vibrateShort({ type: type || 'light' })
      } catch (e) { /* ignore */ }
    },

    markFailed() {
      this._failed = true
      this.clearTimers()
      this.setData({
        printing: false,
        finished: true,
        failedShow: true,
        printLightClass: printPhaseLamp('failure')
      })
      this.softVibrate('medium')
    },

    startPrint() {
      this.clearTimers()
      this._failed = !!this.properties.failed
      const value = Number(this.properties.value) || 0
      const minSpend = Number(this.properties.minSpend) || 0
      const channel = this.properties.channel
      const expireDate = this.properties.expireDate || ''
      const channelLabel = couponChannelLabel(channel)
      const channelLightClass = couponChannelLamp(channel)
      const expireLightClass = couponExpireLamp(expireDate)

      // 待命：灰静；渠道/有效期副灯先行点亮
      this.setData({
        animating: true,
        printing: false,
        finished: false,
        failedShow: false,
        valueLabel: String(value),
        minSpendLabel: minSpend > 0 ? `满 ¥${minSpend} 可用` : '无门槛',
        channelLabel,
        printLightClass: printPhaseLamp('standby'),
        channelLightClass,
        expireLightClass
      })

      if (this._failed) {
        this._printTimer = setTimeout(() => this.markFailed(), 320)
        return
      }

      // 出纸开始：黄灯脉冲 + 长振（进纸感）
      this._printTimer = setTimeout(() => {
        if (this._failed) return
        this.setData({
          printing: true,
          printLightClass: printPhaseLamp('printing')
        })
        this.softVibrate('long')
      }, 120)

      // 进纸中途轻振两下（声感替代，克制）
      this._feedTimer1 = setTimeout(() => {
        if (!this._failed) this.softVibrate('medium')
      }, 900)
      this._feedTimer2 = setTimeout(() => {
        if (!this._failed) this.softVibrate('light')
      }, 1700)

      // 完成：forest 已入账
      this._finishTimer = setTimeout(() => {
        if (this._failed) {
          this.markFailed()
          return
        }
        this.setData({
          finished: true,
          failedShow: false,
          printLightClass: printPhaseLamp('success')
        })
        this.softVibrate('light')
      }, 2900)
    },

    onGoWallet() {
      this.triggerEvent('gowallet')
      this.onClose()
    },

    onClose() {
      this.triggerEvent('close')
      this.reset()
    }
  },

  detached() {
    this.reset()
  }
})
