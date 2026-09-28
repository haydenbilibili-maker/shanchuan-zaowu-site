/**
 * 工作通知声音组件（需求 #29）
 *
 * 这是一个**带界面开关的零干扰组件**：本身只画一枚小铃铛 chip，真正的播报逻辑在
 * `utils/workNoticeVoice.js`（模块级单例，页面直接调用它做「新增检测」）。
 *
 * 用法（页面 wxml 任意位置放一枚即可，建议放头部右侧）：
 *   <work-notice-voice id="workNoticeVoice" />
 *   —— 纯图标：🔔 有声 / 🔕 静音；点=开关，长按=试听。不放文字，
 *      否则头部右侧会把两个字挤成竖排、把日期徽标顶下去（2026-09-16 实测）。
 *
 * 页面 js 里：
 *   const workNotice = require('../../utils/workNoticeVoice')
 *   const catalog = require('../../utils/workNoticeCatalog')
 *   // 待办计数刷新完成后：
 *   workNotice.announce(catalog.buildSnapshot(this.data, this.data.workspaceRole), this.data.workspaceRole)
 *
 * 组件职责：
 *  - 开关（点击 chip 切换；状态持久化在本地，默认开）
 *  - 试听（长按 chip）
 *  - 生命周期：页面隐藏 / 组件卸载时停声（避免离开工作台后还在响）
 *  - 对外暴露 announce / preview / setEnabled，便于别的页面用 selectComponent 直接驱动
 */
const voice = require('../../utils/workNoticeVoice')
const catalog = require('../../utils/workNoticeCatalog')

Component({
  options: {
    styleIsolation: 'isolated',
    multipleSlots: false
  },

  data: {
    enabled: true,
    supported: true
  },

  lifetimes: {
    attached() {
      this.setData({
        enabled: voice.isEnabled(),
        supported: voice.isSupported()
      })
    },
    detached() {
      // 卸载即销毁音频上下文，避免页面栈里残留实例
      voice.destroy()
    }
  },

  pageLifetimes: {
    hide() {
      voice.stop()
    },
    show() {
      this.setData({ enabled: voice.isEnabled() })
    }
  },

  methods: {
    /** 点击：开关 */
    onToggle() {
      const on = voice.toggleEnabled()
      this.setData({ enabled: on })
      try {
        wx.vibrateShort({ type: 'light' })
      } catch (e) {
        /* ignore */
      }
      wx.showToast({
        title: on ? '工作通知声音已开启' : '工作通知声音已关闭',
        icon: 'none'
      })
      this.triggerEvent('change', { enabled: on })
    },

    /** 长按：试听 */
    onPreview() {
      voice.preview()
      wx.showToast({ title: '试听中…', icon: 'none', duration: 1200 })
    },

    /** 给页面用：传入快照即完成「判断 + 播报」 */
    announce(snapshot, role) {
      return voice.announce(snapshot, role)
    },

    preview(type) {
      return voice.preview(type)
    },

    setEnabled(on) {
      const next = voice.setEnabled(on)
      this.setData({ enabled: next })
      return next
    },

    /** 角色切换后重置基线：换角色不应把上个角色的待办当成新增 */
    resetBaseline(role) {
      voice.resetBaseline(role)
    }
  }
})
