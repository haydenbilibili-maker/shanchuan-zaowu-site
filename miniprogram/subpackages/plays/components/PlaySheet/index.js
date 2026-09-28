/**
 * 祈福墙「今天的玩法」弹层（不离开墙页：入口 → 进行态 → 结果 → 写成心愿 / 分享 / 再看）。
 *
 * 只做弹层外壳：遮罩、把手、收起、进出场。玩法本体是 `PlayBody/<id>`（与独立页同一份皮与行为）。
 * 墙页用法（分包异步化，本组件在 plays 分包；墙页 json 以 componentPlaceholder 占位）：
 *   <play-sheet wx:if="{{playSheetId}}" play-id="{{playSheetId}}" ctx="{{playSheetCtx}}"
 *     bind:close bind:wish bind:post bind:share />
 * 事件：
 *   · close —— 出场动画之后才抛（用户收起 / wish / post 之后都会有这一声），墙页据此卸载；
 *   · wish  —— 本体「写成心愿」已写好一次性交接（utils/wishHandoff），**出场开始时**就抛，墙页当场取走；
 *   · post  —— 挂签条「挂上墙」，detail = { text }，出场开始时就抛，墙页交给 submitWish 落愿；
 *   · share —— 本体「分享这份结果」被点，detail = { id, title }，由墙页 onShareAppMessage 应答。
 */
const { findPlay } = require('../../config/ritualPlays')

const LEAVE_MS = 220
const GRIP_CLOSE_PX = 88

Component({
  properties: {
    playId: { type: String, value: '' },
    ctx: { type: Object, value: {} }
  },

  data: {
    name: '',
    closing: false,
    dragY: 0
  },

  observers: {
    playId(id) {
      const play = findPlay(id)
      this.setData({ name: (play && play.name) || '' })
    }
  },

  lifetimes: {
    detached() {
      if (this._leaveTimer) clearTimeout(this._leaveTimer)
      this._leaveTimer = null
    }
  },

  methods: {
    /** 收起：先播出场，再通知墙页卸载（`after` 决定抛哪个事件） */
    leave(after, detail) {
      if (this.data.closing) return
      this.setData({ closing: true, dragY: 0 })
      if (this._leaveTimer) clearTimeout(this._leaveTimer)
      this._leaveTimer = setTimeout(() => {
        this._leaveTimer = null
        this.triggerEvent(after || 'close', detail || {})
      }, LEAVE_MS)
    },

    onClose() {
      this.leave('close')
    },

    /**
     * 「写成心愿」/ 挂签条「挂上墙」：**先**把事件交给墙页，再播出场 ——
     * 墙页的滚动、预填、落愿与面板下沉同时发生（一段连贯动作），而不是等 220ms 出场完才开始第二段。
     * 出场结束照常抛 close 让墙页卸载本组件。
     */
    handOff(name, detail) {
      if (this.data.closing) return
      this.triggerEvent(name, detail || {})
      this.leave('close')
    },

    onBodyWish() {
      this.handOff('wish')
    },

    onBodyPost(e) {
      const text = String((e && e.detail && e.detail.text) || '')
      if (!text) return
      this.handOff('post', { text })
    },

    onBodyShare(e) {
      this.triggerEvent('share', (e && e.detail) || {})
    },

    onGripStart(e) {
      const t = (e && e.touches && e.touches[0]) || null
      this._gripY = t ? t.clientY : 0
    },

    onGripMove(e) {
      if (!this._gripY) return
      const t = (e && e.touches && e.touches[0]) || null
      if (!t) return
      this.setData({ dragY: Math.max(0, t.clientY - this._gripY) })
    },

    onGripEnd() {
      const dy = Number(this.data.dragY) || 0
      this._gripY = 0
      if (dy >= GRIP_CLOSE_PX) {
        this.leave('close')
        return
      }
      this.setData({ dragY: 0 })
    },

    noop() {}
  }
})
