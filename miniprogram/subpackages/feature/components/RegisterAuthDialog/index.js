/**
 * 注册引导 / 一键注册弹窗
 *
 * 需求（2026-09-17）：
 *   ① 「鉴定百科」未登录态要在**原地**完成注册，不再跳 `extra/user/onboarding`；
 *   ② 弹窗样式要与全站交互视觉对齐（博物黑 + 铜金 + 博物柜铭牌，见 app.wxss 令牌）；
 *   ③ ~~门禁场景不提供关闭~~ → 2026-10-11 产品负责人拍板：门禁页（图鉴详情 / 鉴定结果）也给「先不注册」，
 *      关掉后由页面返回上一页（扫码直进回首页），避免审核以「强制注册」退回；门禁页传 `mask-closable="{{false}}"`，点遮罩不误关。
 *
 * 为什么必须是自定义组件而不是 `wx.showModal`：
 *   微信的 `getPhoneNumber` **只能由 `<button open-type="getPhoneNumber">` 的用户点击触发**，
 *   无法程序化弹出。系统弹窗里放不了这个按钮，所以「原地授权」只能是自带按钮的自定义弹窗。
 *
 * 合规（2026-10-11 微信审核驳回整改）：协议必须由用户**主动勾选**，不得用按钮文案代替同意。
 *   勾选框每次打开都从「未勾」开始，不读缓存；没勾时 CTA 不带 open-type，绝不弹微信手机号授权，
 *   只轻抖勾选行 + 轻提示。点协议名只打开协议页，不等于勾选。
 *
 * 事件：`bind:success`（已注册成功，event.detail = payload）/ `bind:fail` / `bind:close`
 */
const { registerWithPhone } = require('../../utils/registerPhone')
const { ensureSession } = require('../../../../utils/userSession')

Component({
  options: { addGlobalClass: true },

  properties: {
    show: { type: Boolean, value: false },
    /** 标题（第一行小字，英文/品类标签位） */
    overline: { type: String, value: 'ONE-TAP REGISTER' },
    title: { type: String, value: '注册后收藏这份鉴定' },
    desc: { type: String, value: '一键注册即可把这次鉴定收进山海图鉴，新客礼包将自动到账。' },
    cta: { type: String, value: '一键注册' },
    /** 是否允许关闭（门禁场景传 false：不给「再看看」） */
    closable: { type: Boolean, value: false },
    /** 关闭按钮文案（closable 为 true 时才显示） */
    closeText: { type: String, value: '先看看' },
    /** closable 为 true 时点遮罩是否也关闭（默认 true 保持祈福墙现状；门禁页传 false，只认按钮） */
    maskClosable: { type: Boolean, value: true },
    /** 埋点用来源 */
    from: { type: String, value: 'register_dialog' },
    /** 老号（已注册）时替换的文案：不再承诺「新客礼包自动到账」 */
    loginOverline: { type: String, value: 'ONE STEP' },
    loginTitle: { type: String, value: '确认手机号继续' },
    loginDesc: { type: String, value: '该微信已完成注册，授权手机号即可确认身份继续。' },
    loginCta: { type: String, value: '授权手机号 · 继续' }
  },

  data: { saving: false, isRegistered: false, agreed: false, agreeShake: false, agreeHint: false },

  observers: {
    show(v) {
      if (!v && (this.data.agreed || this.data.agreeHint)) this.setData({ agreed: false, agreeHint: false })
    }
  },

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
    },
    detached() {
      clearTimeout(this._shakeTimer)
    }
  },

  methods: {
    noop() {},

    onClose() {
      if (!this.data.closable && !this.properties.closable) return
      if (this.data.saving) return
      this.triggerEvent('close')
    },

    /**
     * 授权按钮**被点**（还没拿到手机号）时上报一次 `cta`。
     *
     * 为什么要单独一个事件：`getPhoneNumber` 的成败只能告诉你"授权成功/被拒"，
     * 而漏斗真正要区分的是三段：**曝光 → 去注册（点了按钮）→ 完成**。
     * 少了中间这段，就无法判断"曝光多但没人点"（文案/位置问题）与
     * "点了但授权失败"（流程问题）—— 两者该做的是完全不同的事。
     * 加法事件：既有 success / fail / close 语义不变。
     */
    onCtaTap() {
      if (this.data.saving || !this.data.agreed) return
      this.triggerEvent('cta')
    },

    onToggleAgree() {
      if (this.data.saving) return
      this.setData({ agreed: !this.data.agreed, agreeHint: false })
    },

    /** 未勾选时点 CTA：不进注册、不弹授权，只抖勾选行并在其下轻提示 */
    onCtaBlocked() {
      if (this.data.saving) return
      this.setData({ agreeShake: true, agreeHint: true })
      clearTimeout(this._shakeTimer)
      this._shakeTimer = setTimeout(() => this.setData({ agreeShake: false }), 420)
    },

    /** `getPhoneNumber` 回调：拿 code → 走唯一注册链路 */
    async onGetPhoneNumber(e) {
      if (this.data.saving || !this.data.agreed) return
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
        const res = await registerWithPhone({ app, phoneCode: detail.code, patch: { agreedTermsAt: new Date().toISOString() } })
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
        url: `/subpackages/content/user/legal/index?type=${kind}`,
        fail: () => wx.showToast({ title: '无法打开协议', icon: 'none' })
      })
    }
  }
})
