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
    cardPending: { type: Boolean, value: false }
  },
  data: {
    /** 微信头像 URL 过期/404 时降级为本地占位图，避免会员卡出现空头像 */
    avatarBroken: false
  },
  observers: {
    /** 头像换新后重新给一次加载机会，否则一次失败会永久锁在占位图 */
    'userInfo.avatarUrl': function (url) {
      if (url && this.data.avatarBroken) this.setData({ avatarBroken: false })
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
    }
  }
});
