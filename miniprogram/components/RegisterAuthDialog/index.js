/**
 * 注册引导 / 一键注册弹窗
 *
 * 需求（2026-09-17）：
 *   ① 「鉴定百科」未登录态要在**原地**完成注册，不再跳 `extra/user/onboarding`；
 *   ② 弹窗样式要与全站交互视觉对齐（博物黑 + 铜金 + 博物柜铭牌，见 app.wxss 令牌）；
 *   ③ 门禁场景**不提供关闭/再看看**（`closable="{{false}}"`），转化场景可保留关闭。
 *
 * 为什么必须是自定义组件而不是 `wx.showModal`：
 *   微信的 `getPhoneNumber` **只能由 `<button open-type="getPhoneNumber">` 的用户点击触发**，
 *   无法程序化弹出。系统弹窗里放不了这个按钮，所以「原地授权」只能是自带按钮的自定义弹窗。
 *
 * 合规：把「同意」写在 CTA 上（`同意并一键注册`），并在下方给《用户协议》《隐私政策》入口 ——
 *   与注册页的口径一致（注册页是显式勾选，这里用按钮文案承载同意）。
 *
 * 事件：`bind:success`（已注册成功，event.detail = payload）/ `bind:fail` / `bind:close`
 */
const { registerWithPhone } = require('../../utils/registerPhone')
const { ensureSession } = require('../../utils/userSession')

Component({
  options: { addGlobalClass: true },

  properties: {
    show: { type: Boolean, value: false },
    /** 标题（第一行小字，英文/品类标签位） */
    overline: { type: String, value: 'ONE-TAP REGISTER' },
    title: { type: String, value: '注册后收藏这份鉴定' },
    desc: { type: String, value: '一键注册即可把这次鉴定收进山海图鉴，新客礼包将自动到账。' },
    cta: { type: String, value: '同意并一键注册' },
    /** 是否允许关闭（门禁场景传 false：不给「再看看」） */
    closable: { type: Boolean, value: false },
    /** 关闭按钮文案（closable 为 true 时才显示） */
    closeText: { type: String, value: '先看看' },
    /** 埋点用来源 */
    from: { type: String, value: 'register_dialog' },
    /** 老号（已注册）时替换的文案：不再承诺「新客礼包自动到账」 */
    loginOverline: { type: String, value: 'ONE STEP' },
    loginTitle: { type: String, value: '确认手机号继续' },
    loginDesc: { type: String, value: '该微信已完成注册，授权手机号即可确认身份继续。' },
    loginCta: { type: String, value: '授权手机号 · 继续' }
  },

  data: { saving: false, isRegistered: false },

  lifetimes: {
    /**
     * 2026-09-17：弹窗自己问一次会话，据此决定是否展示「新客礼包自动到账」。
     * 此前无论新老都承诺新客礼 —— 老用户（尤其已注册但资料空、被门禁拦下的人）会以为还能再领。
     */
    attached() {
      ensureSession(null).then((session) => {
        if (!session || !session.success) return
        const registered = session.isRegistered !== undefined
          ? !!session.isRegistered
          : !!(session.onboardingDone || (session.user && session.user.phone))
        if (registered) this.setData({ isRegistered: true })
      }).catch(() => { /* 会话不可用时保持注册态文案（首访是多数） */ })
    }
  },

  methods: {
    noop() {},

    onClose() {
      if (!this.data.closable && !this.properties.closable) return
      if (this.data.saving) return
      this.triggerEvent('close')
    },

    /** `getPhoneNumber` 回调：拿 code → 走唯一注册链路 */
    async onGetPhoneNumber(e) {
      if (this.data.saving) return
      const detail = e && e.detail ? e.detail : {}
      if (detail.errMsg !== 'getPhoneNumber:ok' || !detail.code) {
        // 用户点了「拒绝」也会走这里 —— 门禁场景要明确告诉他还需要授权
        wx.showToast({ title: '需要授权手机号才能继续', icon: 'none' })
        this.triggerEvent('fail', { reason: 'denied' })
        return
      }

      this.setData({ saving: true })
      wx.showLoading({ title: this.data.isRegistered ? '正在确认…' : '正在注册…', mask: true })
      try {
        let app = null
        try { app = getApp() } catch (err) { /* ignore */ }
        const res = await registerWithPhone({ app, phoneCode: detail.code })
        wx.hideLoading()
        if (!res.ok) {
          wx.showToast({ title: res.msg || '注册未完成', icon: 'none' })
          this.triggerEvent('fail', { reason: 'server', msg: res.msg })
          return
        }
        this.triggerEvent('success', res.payload || {})
      } catch (err) {
        wx.hideLoading()
        wx.showToast({ title: '网络异常，请重试', icon: 'none' })
        this.triggerEvent('fail', { reason: 'error' })
      } finally {
        this.setData({ saving: false })
      }
    },

    /** 协议入口：与全站同一条路径（`legal/index?type=terms|privacy`） */
    onAgreementTap(e) {
      const kind = (e.currentTarget.dataset && e.currentTarget.dataset.kind) === 'privacy' ? 'privacy' : 'terms'
      wx.navigateTo({
        url: `/subpackages/extra/user/legal/index?type=${kind}`,
        fail: () => wx.showToast({ title: '无法打开协议', icon: 'none' })
      })
    }
  }
})
