/**
 * 领礼后的注册引导卡（2026-10-11，礼赠凭礼笺领取）
 *
 * 只在「已收下、未注册」时由领取页展示；可关，不注册也能照常填址 / 自提 / 看物流。
 * 合规：同意勾选默认不勾、只由用户点击翻转；未勾选不渲染授权按钮（check:privacy-consent 钉住）。
 * 注册走唯一链路 registerWithPhone；收下时留的称呼预填为昵称（可清空）。
 */
const { registerWithPhone } = require('../../utils/registerPhone')
const { trackBehavior } = require('../../../../utils/trackBehavior')

Component({
  properties: {
    show: { type: Boolean, value: false },
    orderId: { type: String, value: '' },
    claimName: { type: String, value: '' }
  },

  data: { agreed: false, saving: false, agreeShake: false, agreeHint: false, useName: true, errText: '', done: false, gotGift: false },

  observers: {
    show(v) {
      if (v && !this._panelShown) { this._panelShown = true; this._funnel('show') }
    }
  },

  methods: {
    /** 统一注册漏斗（register_panel，与注册弹层 / 注册页同一事件；gift_reg_guide_* 照旧） */
    _funnel(step, extra) {
      trackBehavior('register_panel', 'register', 'gift_claim', Object.assign({ step, surface: 'gift_card' }, extra || {}))
    },

    onToggleAgree() {
      if (this.data.saving) return
      this.setData({ agreed: !this.data.agreed, agreeHint: false })
    },

    onCtaBlocked() {
      if (this.data.saving) return
      this.setData({ agreeShake: true, agreeHint: true })
      clearTimeout(this._shakeTimer)
      this._shakeTimer = setTimeout(() => this.setData({ agreeShake: false }), 420)
    },

    onToggleName() {
      this.setData({ useName: !this.data.useName })
    },

    onCtaTap() {
      if (this.data.saving || !this.data.agreed) return
      trackBehavior('gift_reg_guide_click', 'order', this.data.orderId)
      this._funnel('auth')
    },

    async onGetPhoneNumber(e) {
      if (this.data.saving || !this.data.agreed) return
      const detail = (e && e.detail) || {}
      if (detail.errMsg !== 'getPhoneNumber:ok' || !detail.code) {
        this.setData({ errText: '未授权手机号，可稍后再注册' })
        return
      }
      const nickName = this.data.useName ? String(this.data.claimName || '').trim() : ''
      this.setData({ saving: true, errText: '' })
      let app = null
      try { app = getApp() } catch (err) { /* ignore */ }
      // 协议同意时间与注册页同口径留痕（agreedTermsAt）
      const agreedTermsAt = new Date().toISOString()
      let res = await registerWithPhone({ app, phoneCode: detail.code, patch: nickName ? { nickName, agreedTermsAt } : { agreedTermsAt } })
      // 称呼未过内容审核时号已绑上：不带昵称补完建档（同一注册接口，不改契约）
      if (!res.ok && nickName) res = await this._finishWithoutName(app, agreedTermsAt)
      if (!res.ok) {
        this.setData({ saving: false, errText: res.msg || '注册未完成，可稍后再试' })
        return
      }
      const isNewUser = !!(res.payload && res.payload.isNewUser)
      this.setData({ saving: false, done: true, gotGift: isNewUser })
      trackBehavior('gift_reg_guide_done', 'order', this.data.orderId, { isNewUser })
      this._funnel('success', { isNewUser })
      this.triggerEvent('done', res.payload || {})
    },

    async _finishWithoutName(app, agreedTermsAt) {
      try {
        const up = await wx.cloud.callFunction({ name: 'upsertUserProfile', data: { patch: { agreedTermsAt }, completeOnboarding: true } })
        const r = (up && up.result) || {}
        if (!r.success) return { ok: false, msg: r.msg }
        const { refreshSessionAfterAuth } = require('../../../../utils/userSession')
        await refreshSessionAfterAuth(app)
        return { ok: true, payload: r }
      } catch (err) {
        return { ok: false, msg: '网络异常，请重试' }
      }
    },

    onClose() {
      if (this.data.saving) return
      if (!this.data.done) this._funnel('dismiss')
      this.triggerEvent('close')
    },

    goCare() {
      this.triggerEvent('care')
    },

    onAgreementTap(e) {
      const kind = (e.currentTarget.dataset && e.currentTarget.dataset.kind) === 'privacy' ? 'privacy' : 'terms'
      wx.navigateTo({
        url: `/subpackages/content/user/legal/index?type=${kind}`,
        fail: () => this.setData({ errText: '暂时打不开协议，请稍后再试' })
      })
    }
  }
})
