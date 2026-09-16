/**
 * 会员卡组件（六档等级卡 + 未注册/退出态信封卡）
 *
 * 信封卡（需求 20）沿用**礼赠启封**的仪式语言：
 *   封缄（seal）→ 启封（lid，盒盖/信封盖同为 rotateX(-118deg)）→ 展信（done）
 * 节拍与 `subpackages/feature/gift/receive/index.js` 的 PHASE_* 保持一致，
 * 守卫会跨模块对账（改一处忘改另一处 → 失败），保证两处的手感是同一套。
 */

/** 启封节拍：与礼赠启封同源（320 / 720 / 420ms） */
const RITE_SEAL_MS = 320;
const RITE_LID_MS = 720;
const RITE_DONE_MS = 420;
/** 手指按住信封时蝴蝶加速振翅的时长 */
const BUTTERFLY_ALERT_MS = 620;

Component({
  options: {
    addGlobalClass: true,
    styleIsolation: 'apply-shared'
  },
  properties: {
    cardFlipped: { type: Boolean, value: false },
    cardSkinClass: { type: String, value: 'level-skin-1' },
    specimenEmoji: { type: String, value: '' },
    hasCheckedIn: { type: Boolean, value: false },
    userInfo: { type: Object, value: {} },
    levelName: { type: String, value: '' },
    discountRate: { type: Number, value: 1 },
    discountText: { type: String, value: '' },
    profileScore: { type: Number, value: 0 },
    growthIsMax: { type: Boolean, value: false },
    growthValueDisplay: { type: String, value: '0' },
    nextThreshold: { type: Number, value: 0 },
    nextThresholdDisplay: { type: String, value: '' },
    growthGapLine: { type: String, value: '' },
    growthPerkDelta: { type: String, value: '' },
    progressWidth: { type: String, value: '0%' },
    memberNo: { type: String, value: '' },
    cardBirthday: { type: Object, value: {} },
    cardConsumptionDisplay: { type: String, value: '' },
    statistics: { type: Object, value: {} },
    cardPointsDisplay: { type: String, value: '0' },
    cardInterestTags: { type: Array, value: [] },
    cardPersona: { type: String, value: '' },
    specimenName: { type: String, value: '' },
    specimenLatin: { type: String, value: '' },
    /** 无快照等待会话：金铜结构骨架，不渲染「未登录」文案 */
    cardPending: { type: Boolean, value: false },
    /**
     * 未注册 / 本机退出登录：不渲染等级卡（避免与 Lv1「原木·见习者」混淆），
     * 改为信封卡 + 停驻蝴蝶（沿用礼赠启封的样式与交互），CTA 由页面分流注册 / 重新登录。
     */
    cardGuest: { type: Boolean, value: false },
    /** 未注册（未绑手机）与「本机已退出」文案不同 */
    guestLoggedOut: { type: Boolean, value: false }
  },
  data: {
    /** 微信头像 URL 过期/404 时降级为本地占位图，避免会员卡出现空头像 */
    avatarBroken: false,
    /** 信封启封仪式：idle（封缄）→ seal（裂蜡）→ lid（掀盖）→ done（展信） */
    ritePhase: 'idle',
    /** 手指按住信封：蝴蝶加速振翅 */
    butterflyAlert: false
  },
  lifetimes: {
    detached() {
      this._cleared = true;
      this.clearGuestRite();
    }
  },
  observers: {
    /** 头像换新后重新给一次加载机会，否则一次失败会永久锁在占位图 */
    'userInfo.avatarUrl': function (url) {
      if (url && this.data.avatarBroken) this.setData({ avatarBroken: false })
    },
    /** 信封态结束（注册完成 / 重新进入成功）→ 仪式归零，避免下次进来停在「已开启」 */
    cardGuest: function (isGuest) {
      if (!isGuest) this.resetGuestRite();
    }
  },
  methods: {
    emit(name) {
      this.triggerEvent(name);
    },
    onAvatarError() {
      if (!this.data.avatarBroken) this.setData({ avatarBroken: true });
    },
    onToggleFlip() {
      this.emit('toggleflip');
    },
    onEasterEggLongPress(e) {
      this.triggerEvent('easteregg', { eggId: e.currentTarget.dataset.eggId });
    },
    onCheckIn() {
      this.emit('checkin');
    },
    onShowMemberCode() {
      this.emit('showmembercode');
    },
    onChangeAvatar() {
      this.emit('changeavatar');
    },
    onGoProfile() {
      this.emit('goprofile');
    },
    onShowLevelBenefits() {
      this.emit('showlevelbenefits');
    },
    onGoProfileFromCardBack() {
      this.emit('goprofilefromback');
    },

    // ---------------------------------------------------------- 信封启封（需求 20）

    scheduleGuestRite(fn, ms) {
      const timer = setTimeout(() => {
        if (this._cleared) return;
        fn();
      }, ms);
      this._riteTimers = this._riteTimers || [];
      this._riteTimers.push(timer);
    },

    clearGuestRite() {
      (this._riteTimers || []).forEach((timer) => clearTimeout(timer));
      this._riteTimers = [];
      if (this._butterflyTimer) {
        clearTimeout(this._butterflyTimer);
        this._butterflyTimer = null;
      }
    },

    resetGuestRite() {
      this.clearGuestRite();
      this._guestCtaFired = false;
      if (this.data.ritePhase !== 'idle' || this.data.butterflyAlert) {
        this.setData({ ritePhase: 'idle', butterflyAlert: false });
      }
    },

    /**
     * 轻触信封 = 一次完整的启封：裂蜡 → 掀盖 → 展信 → 进入（注册 / 重新进入）。
     * 与礼赠「轻触开盒」同一手势约定；重复触碰在仪式进行中被忽略。
     */
    onGuestRite() {
      if (this.data.ritePhase !== 'idle') return;
      this._guestCtaFired = false;
      this.setData({ ritePhase: 'seal', butterflyAlert: false });
      this.scheduleGuestRite(() => this.setData({ ritePhase: 'lid' }), RITE_SEAL_MS);
      this.scheduleGuestRite(() => this.setData({ ritePhase: 'done' }), RITE_SEAL_MS + RITE_LID_MS);
      this.scheduleGuestRite(
        () => this.fireGuestCta(),
        RITE_SEAL_MS + RITE_LID_MS + RITE_DONE_MS
      );
    },

    /** 长按跳过仪式：直接进入（对齐礼赠「长按可跳过」——仪式进行中也能跳） */
    onGuestSkip() {
      if (this.data.ritePhase === 'done') return;
      this.clearGuestRite();
      this.setData({ ritePhase: 'done', butterflyAlert: false });
      this.fireGuestCta();
    },

    /** 手指按住信封：蝴蝶当场加速振翅（松手后回到常态，不需要额外手势） */
    onGuestTouchStart() {
      if (this.data.ritePhase !== 'idle' || this.data.butterflyAlert) return;
      this.setData({ butterflyAlert: true });
      this._butterflyTimer = setTimeout(() => {
        this._butterflyTimer = null;
        if (!this._cleared) this.setData({ butterflyAlert: false });
      }, BUTTERFLY_ALERT_MS);
    },

    /** 只发一次：重复触发（连点 / 长按与轻触叠加）不得二次跳转 */
    fireGuestCta() {
      if (this._guestCtaFired) return;
      this._guestCtaFired = true;
      this.emit('guestcta');
    },

    /** 信封卡主 CTA：未注册 → 注册引导；本机已退出 → 重新进入 */
    onGuestCta() {
      this.emit('guestcta');
    }
  }
});
