/**
 * 全站样式化轻提示（AppToast）
 *
 * 为什么需要（2026-09-17 真机反馈）：
 *   原生 `wx.showToast` 是**系统样式** —— 在博物黑 + 铜金的界面里就是一个裸的深色圆角框，
 *   与主视觉完全脱节（截图里那个「已重新进入」就是它）。而这类反馈（重新进入成功、
 *   补领成功、签到成功…）恰恰是顾客注意力最集中的一刻，不该是最不像本产品的一块。
 *
 * 视觉：与 `AppModal` / `RegisterAuthDialog` 同一套铭牌语言
 *   —— 铜金描边 + 四角 + 渐变黑底 + 衬线标题，令牌全部取自 app.wxss。
 * 交互：**非阻塞**（`pointer-events: none`，不 catchtouchmove）—— 提示归提示，别拦住用户；
 *   到时自动淡出并 `triggerEvent('close')`，由宿主把 `show` 置回 false。
 *
 * 用法：
 *   <app-toast show="{{toastShow}}" overline="WELCOME BACK" title="欢迎回来，X"
 *              desc="礼券、积分与成长值都还在" bind:close="onToastClose" />
 */
Component({
  options: { addGlobalClass: true },

  properties: {
    show: { type: Boolean, value: false },
    overline: { type: String, value: '' },
    title: { type: String, value: '' },
    desc: { type: String, value: '' },
    /** 停留时长（ms）；进出场各 240ms，与 AppModal 的过渡时长一致 */
    duration: { type: Number, value: 2200 }
  },

  data: { visible: false, leaving: false },

  observers: {
    show(next) {
      if (next) this.open()
      else this.hideNow()
    }
  },

  lifetimes: {
    detached() {
      this.clearTimers()
    }
  },

  methods: {
    noop() {},

    clearTimers() {
      if (this._stayTimer) {
        clearTimeout(this._stayTimer)
        this._stayTimer = null
      }
      if (this._fadeTimer) {
        clearTimeout(this._fadeTimer)
        this._fadeTimer = null
      }
    },

    open() {
      this.clearTimers()
      this.setData({ visible: true, leaving: false })
      const stay = Number(this.properties.duration) > 0 ? Number(this.properties.duration) : 2200
      this._stayTimer = setTimeout(() => this.dismiss(), stay)
    },

    dismiss() {
      if (!this.data.visible || this.data.leaving) return
      this.setData({ leaving: true })
      this._fadeTimer = setTimeout(() => {
        this.setData({ visible: false, leaving: false })
        this.triggerEvent('close')
      }, 240)
    },

    /** 宿主把 show 置回 false（或组件被复用）时立即收起 */
    hideNow() {
      this.clearTimers()
      if (this.data.visible || this.data.leaving) this.setData({ visible: false, leaving: false })
    }
  }
})
