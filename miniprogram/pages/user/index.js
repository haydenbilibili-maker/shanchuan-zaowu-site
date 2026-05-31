// pages/user/index.js
const app = getApp();
const db = wx.cloud.database();
const { trackBehavior } = require('../../utils/trackBehavior');
const { requestManagerAccess } = require('../../utils/managerAuth');
const { fetchUserSession, needsOnboarding } = require('../../utils/userSession');
const { INTEREST_OPTIONS, LEVEL_BENEFITS, ZODIAC_OPTIONS } = require('../../utils/profileConstants');
const {
  getInterestLabels,
  getInterestTags,
  birthdayCountdown,
  zodiacLabelFromKey,
  formatCompactMoney,
  formatCompactCount,
  formatGrowthDisplay,
  buildLevelBenefitsUI,
  getNextLevelBenefit
} = require('../../utils/profileHelper');
const { drawMemberQr } = require('../../utils/qrCanvas');
const { countUsableCoupons } = require('../../utils/couponHelper');

Page({
  data: {
    userInfo: { avatarUrl: '', nickName: '未登录用户' },
    
    // 统计数据
    collectionCount: 0,
    bookingCount: 0,
    certificateCount: 0,
    couponCount: 0, // 可用代金券（未使用且未过期）
    points: 0, 
    
    // 会员等级
    level: 1, 
    levelName: '原木·见习者', 
    memberNo: 'MT-0000-0000', 
    discountRate: 1.0, 
    growthValue: 0,
    growthValueDisplay: '0',
    growthGap: 0,
    growthGapDisplay: '',
    nextThreshold: 500,
    nextThresholdDisplay: '',
    progressWidth: '0%',
    progressPercent: 0, // 进度百分比（整数） 

    // 状态
    hasCheckedIn: false,
    checkingIn: false, // 🔧 签到加载状态锁，防止重复点击
    isAdmin: false,
    
    // 弹窗
    showQrModal: false,
    showGroupModal: false, // 官方社群二维码弹窗
    showStatisticsModal: false, // 数据统计弹窗
    showLevelModal: false, // 等级权益弹窗
    
    // 光效
    shineStyle: '',
    
    // 🟢 数据统计
    statistics: {
      viewCount: 0,
      collectCount: 0,
      shareCount: 0,
      searchCount: 0,
      totalConsumption: '0.00',
      orderCount: 0,
      avgOrderValue: '0.00',
      courseCount: 0,
      certificateCount: 0,
      collectionByType: { product: 0, activity: 0, course: 0 },
      lastActiveTime: null
    },
    loadingStatistics: false,
    formattedLastActive: '暂无', // 格式化后的最后活跃时间
    
    // 🟢 等级权益
    levelBenefits: [], // 等级权益列表
    currentLevelIcon: '/assets/icons/knowledge.png', // 当前等级图标（默认）
    
    // 🟢 成就系统
    achievementStats: null, // 成就统计数据
    
    // 🟢 站内信
    unreadMessageCount: 0, // 未读消息数量

    profileScore: 0,
    onboardingDone: true,
    interestLabels: [],
    memberPassToken: '',
    passCountdown: 60,
    qrPayload: '',

    showOnboardingBanner: false,
    onboardingResumeStep: 1,
    showLevelUp: false,
    levelUpName: '',
    levelUpLevel: 0,
    currentLevelPerks: [],
    nextLevelPreview: null,

    cardFlipped: false,
    cardBirthday: { hasBirthday: false, headline: '填写生日', subline: '解锁生日礼遇与专属祝福' },
    cardInterestTags: [],
    cardPersona: '',
    cardConsumptionDisplay: '¥0',
    cardPointsDisplay: '0'
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 });
    }

    const now = Date.now();
    const shouldRefresh = this._forceRefresh || !this._lastInit || now - this._lastInit > 30000;
    if (shouldRefresh) {
      this._lastInit = now;
      this._forceRefresh = false;
      this.initUserData();
    }
    this.loadUnreadMessageCount();
    this.startMotion();
    trackBehavior('user_center_view', 'user', app.globalData.openid || 'guest');
    this.refreshOnboardingBanner();
  },

  async refreshOnboardingBanner() {
    if (this._onboardingChecking) return;
    this._onboardingChecking = true;
    try {
      const session = await fetchUserSession(app);
      this.setData({
        showOnboardingBanner: needsOnboarding(session),
        onboardingResumeStep: (session.user && session.user.onboardingStep) || 1,
        onboardingDone: session.onboardingDone !== false
      });
    } catch (e) {
      console.warn('refreshOnboardingBanner', e);
    } finally {
      this._onboardingChecking = false;
    }
  },

  dismissOnboardingBanner() {
    this.setData({ showOnboardingBanner: false });
  },

  startOnboarding() {
    wx.vibrateShort({ type: 'light' });
    const step = this.data.onboardingResumeStep || 1;
    wx.navigateTo({ url: `/pages/user/onboarding/index?from=hub&step=${step}` });
  },

  onHide() { this.stopMotion(); this.stopPassTimer(); },
  onUnload() { this.stopMotion(); this.stopPassTimer(); },
  
  onPullDownRefresh() {
    this._forceRefresh = true;
    this.initUserData().then(() => wx.stopPullDownRefresh());
  },

  // 陀螺仪光效
  startMotion() {
    if (!wx.onDeviceMotionChange || this._motionStarted) return;
    this._motionStarted = true;
    this._motionHandler = (res) => {
      const { beta, gamma } = res;
      let x = gamma;
      let y = beta;
      if (x > 40) x = 40;
      if (x < -40) x = -40;
      if (y > 60) y = 60;
      if (y < 20) y = 20;
      const percentX = 50 + (x / 40) * 60;
      const percentY = 50 + ((y - 40) / 40) * 60;
      this.setData({ shineStyle: `background-position: ${percentX}% ${percentY}%` });
    };
    wx.startDeviceMotionListening({ interval: 'ui' });
    wx.onDeviceMotionChange(this._motionHandler);
  },
  stopMotion() {
    if (this._motionHandler && wx.offDeviceMotionChange) {
      wx.offDeviceMotionChange(this._motionHandler);
    }
    if (wx.stopDeviceMotionListening) wx.stopDeviceMotionListening();
    this._motionStarted = false;
    this._motionHandler = null;
  },

  async initUserData() {
    // 🔧 优化：添加重试次数限制，防止无限递归
    if (!this.initRetryCount) {
      this.initRetryCount = 0;
    }
    const MAX_RETRY = 10; // 最多重试10次，共5秒
    
    if (!app.globalData.openid) {
      if (this.initRetryCount >= MAX_RETRY) {
        console.error('获取openid失败，已达到最大重试次数');
        wx.showToast({
          title: '初始化失败，请重新进入',
          icon: 'none',
          duration: 2000
        });
        return;
      }
      this.initRetryCount++;
      setTimeout(() => { 
        if (app.globalData.openid) {
          this.initRetryCount = 0; // 重置计数器
          this.initUserData();
        } else {
          this.initUserData();
        }
      }, 500); 
      return; 
    }
    
    // 重置计数器
    this.initRetryCount = 0;
    
    const openid = app.globalData.openid;
    if (!openid || typeof openid !== 'string' || openid.length < 8) {
      console.error('openid格式无效:', openid);
      wx.showToast({
        title: '用户信息异常',
        icon: 'none'
      });
      return;
    }
    
    const shortId = openid.substr(openid.length - 8).toUpperCase();
    this.setData({ memberNo: `MT-${shortId.substr(0,4)}-${shortId.substr(4,4)}` });

    // 1. 会话与用户档案
    try {
      const session = await fetchUserSession(app);
      if (session.success) {
        if (session.memberNo) this.setData({ memberNo: session.memberNo });
        if (session.user) {
          this.setData({
            userInfo: session.user,
            profileScore: session.profileScore || 0,
            onboardingDone: session.onboardingDone !== false,
            interestLabels: getInterestLabels(session.user.interests, INTEREST_OPTIONS)
          });
          this.syncCardBackPanel(session.user);
          app.globalData.userInfo = session.user;
        }
        if (session.stats) {
          const data = session.stats;
          const levelIcon = this.getLevelIcon(data.level || 1);
          this.setData({
            points: data.points || 0,
            level: data.level || 1,
            levelName: data.levelName || '普通会员',
            discountRate: data.discountRate || 1.0,
            isAdmin: data.isAdmin || false,
            currentLevelIcon: levelIcon,
            ...this.buildGrowthFields(data)
          });
          this.syncLevelPerks(data.level || 1);
          this.checkLevelUpgrade(data.level || 1);
          this.syncCardBackStats();
        }
      }
    } catch (e) {
      console.error('fetchUserSession', e);
    }

    if (!this.data.level) {
      wx.cloud.callFunction({
        name: 'getUserStats',
        success: (res) => {
          if (!res || !res.result) return;
          const data = res.result;
          this.setData({
            points: data.points || 0,
            level: data.level || 1,
            levelName: data.levelName || '普通会员',
            discountRate: data.discountRate || 1.0,
            isAdmin: data.isAdmin || false,
            currentLevelIcon: this.getLevelIcon(data.level || 1),
            ...this.buildGrowthFields(data)
          });
          this.syncLevelPerks(data.level || 1);
          this.checkLevelUpgrade(data.level || 1);
          this.syncCardBackStats();
        }
      });
    }

    // 3. 获取基础统计
    this.queryBasicStats();
    
    // 4. 检查今日签到
    this.checkTodaySignStatus();
    
    // 5. 🟢 加载数据统计
    this.loadUserStatistics();
    
    // 6. 🟢 初始化等级权益列表（单一数据源）
    const levelBenefits = buildLevelBenefitsUI(LEVEL_BENEFITS);
    this.setData({ levelBenefits });
    this.syncLevelPerks(this.data.level);
    this.checkLevelUpgrade(this.data.level);
    
    // 7. 🟢 加载成就数据
    this.loadAchievements();
  },

  async queryBasicStats() {
    try {
      const openid = app.globalData.openid;
      if (!openid) return;

      const [bookRes, certRes, couponRes, colRes] = await Promise.all([
        db.collection('bookings').where({ _openid: openid, status: 'confirmed' }).count(),
        db.collection('orders').where({ _openid: openid, status: 'received' }).count(),
        db.collection('user_coupons')
          .where({ _openid: openid, status: 'unused' })
          .field({ status: true, expireTime: true })
          .limit(200)
          .get(),
        db.collection('collections').where({ _openid: openid }).count()
      ]);

      this.setData({
        bookingCount: bookRes.total || 0,
        certificateCount: certRes.total || 0,
        couponCount: countUsableCoupons(couponRes.data || []),
        collectionCount: colRes.total || 0
      });
    } catch (err) {
      console.error('queryBasicStats失败:', err);
    }
  },

  async checkTodaySignStatus() {
    // 🔧 优化：添加openid校验
    const openid = app.globalData.openid;
    if (!openid) {
      return;
    }
    
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    try {
      const res = await db.collection('point_records').where({
        _openid: openid, 
        action: 'check_in', 
        dateStr: todayStr
      }).count();
      
      // 🔧 优化：添加数据验证
      const hasCheckedIn = (res && res.total > 0) ? true : false;
      this.setData({ hasCheckedIn });
    } catch (e) {
      console.error('checkTodaySignStatus失败:', e);
      // 🔧 优化：出错时默认未签到
      this.setData({ hasCheckedIn: false });
    }
  },

  buildGrowthFields(data) {
    const nextThreshold = data.nextThreshold || 0;
    const growthValue = data.growthValue || 0;
    let widthStr = '0%';
    let progressPercent = 0;
    if (nextThreshold > 0) {
      const percent = Math.min((growthValue / nextThreshold) * 100, 100);
      widthStr = `${Math.max(0, percent).toFixed(1)}%`;
      progressPercent = Math.floor(Math.max(0, percent));
    }
    return {
      growthValue,
      nextThreshold,
      progressWidth: widthStr,
      progressPercent,
      growthValueDisplay: formatGrowthDisplay(growthValue),
      nextThresholdDisplay: nextThreshold > 0 ? formatGrowthDisplay(nextThreshold) : '',
      growthGap: nextThreshold > 0 ? Math.max(0, nextThreshold - growthValue) : 0,
      growthGapDisplay: nextThreshold > 0
        ? formatGrowthDisplay(Math.max(0, nextThreshold - growthValue))
        : ''
    };
  },

  syncCardBackPanel(user) {
    if (!user) return;
    const personaParts = [];
    if (user.mbti) personaParts.push(user.mbti);
    const zodiacLabel = zodiacLabelFromKey(user.zodiac, ZODIAC_OPTIONS);
    if (zodiacLabel) personaParts.push(zodiacLabel);
    this.setData({
      cardBirthday: birthdayCountdown(user.birthday),
      cardInterestTags: getInterestTags(user.interests, INTEREST_OPTIONS),
      cardPersona: personaParts.join(' · '),
      cardConsumptionDisplay: formatCompactMoney(this.data.statistics.totalConsumption),
      cardPointsDisplay: formatCompactCount(this.data.points)
    });
  },

  syncCardBackStats() {
    this.setData({
      cardConsumptionDisplay: formatCompactMoney(this.data.statistics.totalConsumption),
      cardPointsDisplay: formatCompactCount(this.data.points)
    });
  },

  toggleCardFlip() {
    const next = !this.data.cardFlipped;
    wx.vibrateShort({ type: 'light' });
    this.setData({ cardFlipped: next });
    trackBehavior('member_card_flip', 'side', next ? 'back' : 'front');
  },

  goToProfileFromCardBack() {
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({ url: '/pages/user/profile/index' });
  },

  syncLevelPerks(level) {
    const list = this.data.levelBenefits.length
      ? this.data.levelBenefits
      : buildLevelBenefitsUI(LEVEL_BENEFITS);
    const current = list.find((b) => b.level === level);
    this.setData({
      currentLevelPerks: current ? current.benefits : [],
      nextLevelPreview: getNextLevelBenefit(list, level)
    });
  },

  checkLevelUpgrade(newLevel) {
    const openid = app.globalData.openid;
    if (!openid || !newLevel) return;
    const key = `member_last_level_${openid.slice(-8)}`;
    const lastLevel = wx.getStorageSync(key);
    if (lastLevel && newLevel > lastLevel) {
      const benefit = (this.data.levelBenefits || []).find((b) => b.level === newLevel);
      this.setData({
        showLevelUp: true,
        levelUpName: benefit ? benefit.name : `Lv${newLevel}`,
        levelUpLevel: newLevel
      });
      wx.vibrateShort({ type: 'heavy' });
      trackBehavior('level_up', 'level', String(newLevel));
    }
    wx.setStorageSync(key, newLevel);
  },

  closeLevelUp() {
    this.setData({ showLevelUp: false });
  },

  // 🟢 签到逻辑
  async doCheckIn() {
    if (!this.data.onboardingDone) {
      wx.showModal({
        title: '先建立藏家身份',
        content: '完成基础注册后即可每日签到领取积分。',
        confirmText: '去完善',
        cancelText: '稍后',
        success: (res) => {
          if (res.confirm) this.startOnboarding();
        }
      });
      return;
    }
    // 🔧 优化：添加防重复点击
    if (this.data.hasCheckedIn || this.data.checkingIn) {
      return;
    }
    
    wx.vibrateShort({ type: 'medium' });
    this.setData({ checkingIn: true }); // 设置加载状态锁
    wx.showLoading({ title: '签到中...', mask: true });

    wx.cloud.callFunction({
      name: 'earnPoints', 
      data: { action: 'check_in' },
      success: res => {
        wx.hideLoading();
        this.setData({ checkingIn: false }); // 释放锁
        
        // 🔧 优化：添加数据验证
        if (res && res.result && res.result.success) {
          const points = res.result.points || 0;
          this.setData({ hasCheckedIn: true });
          this.initUserData(); // 刷新积分
          wx.showToast({ 
            title: `+${points} 积分`, 
            icon: 'success',
            duration: 2000
          });
        } else {
          const msg = (res && res.result && res.result.msg) ? res.result.msg : '签到失败';
          this.setData({ hasCheckedIn: true }); // 可能已签过
          wx.showToast({ 
            title: msg, 
            icon: 'none',
            duration: 2000
          });
        }
      },
      fail: (err) => { 
        wx.hideLoading(); 
        this.setData({ checkingIn: false }); // 释放锁
        console.error('签到云函数调用失败:', err);
        wx.showToast({ 
          title: '网络异常，请稍后重试', 
          icon: 'none',
          duration: 2000
        }); 
      }
    });
  },

  // 菜单跳转逻辑
  handleMenuClick(e) {
    const path = e.currentTarget.dataset.path;
    wx.vibrateShort({ type: 'light' });
    
    switch (path) {
      case 'points': 
        wx.navigateTo({ url: '/subpackages/business/points/index' }); 
        break;
      case 'booking':
        wx.navigateTo({ url: '/subpackages/business/my-bookings/index' });
        break;
      case 'visitBooking': {
        const { getPreferredStoreId } = require('../../utils/storeHelper');
        const storeId = getPreferredStoreId();
        wx.navigateTo({ url: `/subpackages/business/booking/index?storeId=${storeId}&tab=0&from=user` });
        break;
      }
      case 'courseBooking': {
        const { getWorkshopStore } = require('../../utils/storeHelper');
        const storeId = getWorkshopStore().storeId;
        wx.navigateTo({ url: `/subpackages/business/booking/index?storeId=${storeId}&tab=1&from=user` });
        break;
      }
      // 🟢 修复：证书跳转 (假设列表页有证书入口，或者直接跳到已归档订单)
      case 'certificate':
        wx.navigateTo({ url: '/pages/user/certificates/index' });
        break;
      case 'orders': 
        wx.navigateTo({ url: '/subpackages/business/orders/index' }); 
        break;
      case 'address':
        wx.navigateTo({ url: '/subpackages/business/address/index' });
        break;
      case 'admin': 
        requestManagerAccess(); 
        break;
      case 'about': 
        wx.navigateTo({ url: '/subpackages/business/about/index' }); 
        break;
      case 'feedback':
        wx.navigateTo({ url: '/pages/user/feedback/index' });
        break;
      // 🟢 修复：优惠券跳转
      case 'coupons': 
        wx.navigateTo({ url: '/subpackages/business/coupons/index' }); 
        break;
      case 'group': 
        wx.vibrateShort({ type: 'medium' });
        this.setData({ showGroupModal: true });
        break;
      case 'statistics':
        this.showStatistics();
        break;
      case 'identify':
        wx.navigateTo({ url: '/pages/identify/index' });
        break;
      case 'collection':
        wx.navigateTo({ url: '/pages/collection/index' });
        break;
      // 联系客服
      case 'contact': /* wxml中已通过 button open-type 实现 */ break;
    }
  },

  // 列表跳转
  goToOrderList(e) { 
    const type = e.currentTarget.dataset.type;
    wx.navigateTo({ url: `/subpackages/business/orders/index?type=${type}` }); 
  },

  showMemberCode() {
    wx.vibrateShort({ type: 'medium' });
    trackBehavior('member_code_show', 'user', app.globalData.openid || 'guest');
    this.setData({ showQrModal: true, passCountdown: 60 });
    try {
      wx.setScreenBrightness({ value: 1 });
    } catch (e) { /* ignore */ }
    this.refreshMemberPass();
    this.startPassTimer();
  },

  startPassTimer() {
    this.stopPassTimer();
    this._passTimer = setInterval(() => {
      const next = (this.data.passCountdown || 0) - 1;
      if (next <= 0) {
        this.refreshMemberPass();
        this.setData({ passCountdown: 60 });
      } else {
        this.setData({ passCountdown: next });
      }
    }, 1000);
  },

  stopPassTimer() {
    if (this._passTimer) {
      clearInterval(this._passTimer);
      this._passTimer = null;
    }
  },

  async refreshMemberPass() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getMemberPass', data: {} });
      const payload = res.result || {};
      if (!payload.success) return;
      this.setData({
        memberPassToken: payload.token,
        qrPayload: payload.qrPayload,
        memberNo: payload.memberNo || this.data.memberNo
      });
      setTimeout(() => {
        drawMemberQr('#memberQrCanvas', payload.qrPayload, this, 200);
      }, 120);
    } catch (e) {
      console.warn('refreshMemberPass', e);
    }
  },

  closeMemberCode() {
    this.stopPassTimer();
    this.setData({ showQrModal: false });
    try {
      wx.setScreenBrightness({ value: -1 });
    } catch (e) { /* ignore */ }
  },

  openLevelFromPass() {
    this.closeMemberCode();
    setTimeout(() => this.showLevelBenefits(), 280);
  },
  closeGroupModal() { 
    wx.vibrateShort({ type: 'light' });
    this.setData({ showGroupModal: false }); 
  },
  
  // 二维码加载错误处理
  onQrError(e) {
    console.error('二维码加载失败', e);
  },

  // 头像昵称更新
  async onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    if (!avatarUrl) return;
    this.setData({ 'userInfo.avatarUrl': avatarUrl });
    try {
      const openid = app.globalData.openid || 'user';
      const ext = avatarUrl.indexOf('.') > -1 ? avatarUrl.split('.').pop() : 'jpg';
      const up = await wx.cloud.uploadFile({
        cloudPath: `avatars/${openid}/${Date.now()}.${ext}`,
        filePath: avatarUrl
      });
      this.setData({ 'userInfo.avatarUrl': up.fileID });
      await this.updateUserProfile({ avatarUrl: up.fileID });
    } catch (err) {
      console.warn('avatar upload', err);
    }
  },

  onUpdateNickName(e) {
    const nickName = e.detail.value;
    if (!nickName) return;
    this.setData({ 'userInfo.nickName': nickName });
    this.updateUserProfile({ nickName });
  },

  goToProfile() {
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({ url: '/pages/user/profile/index' });
  },

  goToOnboarding() {
    wx.navigateTo({ url: '/pages/user/onboarding/index?from=profile_bar' });
  },

  goToFeedback() {
    wx.navigateTo({ url: '/pages/user/feedback/index' });
  },

  async updateUserProfile(data) {
    try {
      await wx.cloud.callFunction({
        name: 'upsertUserProfile',
        data: { patch: data }
      });
      await fetchUserSession(app);
    } catch (e) {
      console.warn('updateUserProfile', e);
    }
  },

  // 管理员验证（已迁移至 utils/managerAuth.js，保留别名便于兼容）
  checkAdminPassword() {
    requestManagerAccess();
  },

  // 🟢 加载用户统计数据
  async loadUserStatistics() {
    if (this.data.loadingStatistics) return;
    
    this.setData({ loadingStatistics: true });
    
    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserStatistics'
      });

      if (res.result && res.result.success) {
        const stats = res.result.data;
        // 格式化最后活跃时间
        const formattedTime = this.formatTime(stats.lastActiveTime);
        this.setData({
          statistics: stats,
          formattedLastActive: formattedTime,
          loadingStatistics: false
        });
        this.syncCardBackStats();
      } else {
        console.error('获取统计数据失败:', res.result?.msg);
        this.setData({ loadingStatistics: false });
      }
    } catch (err) {
      console.error('加载统计数据失败:', err);
      this.setData({ loadingStatistics: false });
    }
  },

  // 🟢 显示数据统计面板
  showStatistics() {
    wx.vibrateShort({ type: 'medium' });
    this.setData({ showStatisticsModal: true });
    // 如果统计数据为空，重新加载
    if (this.data.statistics.viewCount === 0 && !this.data.loadingStatistics) {
      this.loadUserStatistics();
    }
  },

  // 🟢 关闭数据统计面板
  closeStatistics() {
    wx.vibrateShort({ type: 'light' });
    this.setData({ showStatisticsModal: false });
  },

  // 🟢 格式化时间
  formatTime(timestamp) {
    if (!timestamp) return '暂无';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    if (days < 30) return `${Math.floor(days / 7)}周前`;
    if (days < 365) return `${Math.floor(days / 30)}个月前`;
    return `${Math.floor(days / 365)}年前`;
  },

  // 🟢 显示等级权益页面
  showLevelBenefits() {
    wx.vibrateShort({ type: 'medium' });
    this.syncLevelPerks(this.data.level);
    this.setData({ showLevelModal: true });
  },

  closeLevelModal() {
    wx.vibrateShort({ type: 'light' });
    this.setData({ showLevelModal: false });
  },

  // 🟢 获取等级图标
  getLevelIcon(level) {
    const icons = {
      1: '/assets/icons/knowledge.png',
      2: '/assets/icons/star.png',
      3: '/assets/icons/star-active.png',
      4: '/assets/icons/medal_gold.png',
      5: '/assets/icons/medal_gold.png',
      99: '/assets/icons/medal_gold.png'
    };
    return icons[level] || '/assets/icons/knowledge.png';
  },

  // 🟢 加载成就数据
  async loadAchievements() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserAchievements',
        data: { userId: app.globalData.openid }
      });
      
      if (res.result && res.result.success) {
        this.setData({ 
          achievementStats: res.result.data.stats 
        });
      }
    } catch (e) {
      console.error('加载成就数据失败:', e);
    }
  },

  // 🟢 跳转到成就页面
  goToAchievements() {
    try {
      wx.vibrateShort({ type: 'medium' });
      wx.navigateTo({
        url: '/pages/user/achievements/index',
        success: () => {
          console.log('跳转成就页面成功');
        },
        fail: (err) => {
          console.error('跳转成就页面失败:', err);
          let errorMsg = '页面加载失败';
          if (err.errMsg) {
            if (err.errMsg.includes('not found')) {
              errorMsg = '页面不存在，请检查配置';
            } else if (err.errMsg.includes('fail')) {
              errorMsg = '跳转失败，请重试';
            }
          }
          wx.showToast({
            title: errorMsg,
            icon: 'none',
            duration: 2000
          });
        }
      });
    } catch (e) {
      console.error('跳转成就页面异常:', e);
      wx.showToast({
        title: '跳转异常，请重试',
        icon: 'none',
        duration: 2000
      });
    }
  },

  // 🟢 加载未读消息数量
  async loadUnreadMessageCount() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserMessages',
        data: {
          action: 'getUnreadCount'
        }
      });

      if (res.result && res.result.success) {
        this.setData({
          unreadMessageCount: res.result.count || 0
        });
      }
    } catch (e) {
      console.error('加载未读消息数量失败:', e);
    }
  },

  // 🟢 标本定制工坊
  goToCustom() {
    wx.vibrateShort({ type: 'medium' })
    wx.navigateTo({ url: '/pages/custom/hub/index?from=user' })
  },

  goToCare() {
    wx.vibrateShort({ type: 'medium' })
    wx.navigateTo({ url: '/pages/care/index?from=user' })
  },

  goToCommunity() {
    wx.vibrateShort({ type: 'medium' })
    trackBehavior('community_entry_click', 'user', app.globalData.openid || 'guest', { source: 'user_services' })
    wx.navigateTo({ url: '/pages/community/index?from=user' })
  },

  goToPetOrders() {
    wx.vibrateShort({ type: 'medium' })
    wx.navigateTo({ url: '/pages/custom/pet/list/index?from=user' })
  },

  // 🟢 跳转到联系专员
  goToSupport() {
    try {
      wx.vibrateShort({ type: 'medium' });
      wx.navigateTo({
        url: '/pages/user/support/index',
        fail: (err) => {
          console.error('跳转联系专员失败:', err);
          wx.showToast({ title: '页面加载失败', icon: 'none' });
        }
      });
    } catch (e) {
      wx.showToast({ title: '跳转异常，请重试', icon: 'none' });
    }
  },

  // 🟢 跳转到站内信页面
  goToMessages() {
    try {
      wx.vibrateShort({ type: 'medium' });
      wx.navigateTo({
        url: '/pages/user/messages/index',
        success: () => {
          console.log('跳转站内信页面成功');
          // 跳转后刷新未读数量
          setTimeout(() => {
            this.loadUnreadMessageCount();
          }, 500);
        },
        fail: (err) => {
          console.error('跳转站内信页面失败:', err);
          wx.showToast({
            title: '页面加载失败',
            icon: 'none',
            duration: 2000
          });
        }
      });
    } catch (e) {
      console.error('跳转站内信页面异常:', e);
      wx.showToast({
        title: '跳转异常，请重试',
        icon: 'none',
        duration: 2000
      });
    }
  }
});