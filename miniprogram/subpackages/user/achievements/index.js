// pages/user/achievements/index.js
const app = getApp();

Page({
  data: {
    statusBarHeight: 0,
    loading: true,
    refreshing: false,
    achievements: [],
    achievementTypes: [],
    achievementStats: null,
    showModal: false,
    selectedAchievement: null,
    lastLoadTime: 0,
    showUnlockAnimation: false,
    unlockedAchievement: null,
    previousUnlockedCount: 0,
    shareAchievement: null,
    shareStats: null
  },

  onLoad() {
    try {
      const systemInfo = wx.getSystemInfoSync();
      this.setData({
        statusBarHeight: systemInfo.statusBarHeight || 0
      });
    } catch (e) {
      console.warn('获取系统信息失败:', e);
      this.setData({
        statusBarHeight: 0
      });
    }
    
    this.loadAchievements();
  },

  onShow() {
    // 如果距离上次加载超过30秒，则刷新数据
    const now = Date.now();
    if (now - this.data.lastLoadTime > 30000 || this.data.achievements.length === 0) {
      this.loadAchievements();
    }
  },

  async loadAchievements(forceRefresh = false) {
    try {
      // 如果不是强制刷新，且距离上次加载不足5秒，则使用缓存
      const now = Date.now();
      if (!forceRefresh && now - this.data.lastLoadTime < 5000 && this.data.achievements.length > 0) {
        console.log('使用缓存数据');
        return;
      }

      this.setData({ loading: true });
      
      const userId = app.globalData.openid;
      if (!userId) {
        console.error('用户未登录');
        this.setData({ loading: false });
        wx.showToast({
          title: '请先登录',
          icon: 'none'
        });
        return;
      }
      
      const res = await wx.cloud.callFunction({
        name: 'getUserAchievements',
        data: { userId }
      });

      console.log('云函数返回:', res);

      if (res.result && res.result.success && res.result.data) {
        const { achievements = [], achievementsByType = {}, stats = null } = res.result.data;
        
        // 按类型组织数据，确保每个类型都有默认值
        // 修复：添加安全检查，防止空值错误
        const safeGetAchievements = (type) => {
          if (!achievementsByType || typeof achievementsByType !== 'object') {
            return [];
          }
          return Array.isArray(achievementsByType[type]) ? achievementsByType[type] : [];
        };

        const achievementTypes = [
          {
            type: 'explore',
            name: '探索类',
            enName: 'EXPLORATION',
            icon: '🔍',
            achievements: safeGetAchievements('explore'),
            unlockedCount: safeGetAchievements('explore').filter(a => a && a.unlocked).length,
            totalCount: safeGetAchievements('explore').length
          },
          {
            type: 'collect',
            name: '收藏类',
            enName: 'COLLECTION',
            icon: '❤️',
            achievements: safeGetAchievements('collect'),
            unlockedCount: safeGetAchievements('collect').filter(a => a && a.unlocked).length,
            totalCount: safeGetAchievements('collect').length
          },
          {
            type: 'social',
            name: '社交类',
            enName: 'SOCIAL',
            icon: '🌟',
            achievements: safeGetAchievements('social'),
            unlockedCount: safeGetAchievements('social').filter(a => a && a.unlocked).length,
            totalCount: safeGetAchievements('social').length
          },
          {
            type: 'consumption',
            name: '消费类',
            enName: 'CONSUMPTION',
            icon: '💰',
            achievements: safeGetAchievements('consumption'),
            unlockedCount: safeGetAchievements('consumption').filter(a => a && a.unlocked).length,
            totalCount: safeGetAchievements('consumption').length
          },
          {
            type: 'learning',
            name: '学习类',
            enName: 'LEARNING',
            icon: '📚',
            achievements: safeGetAchievements('learning'),
            unlockedCount: safeGetAchievements('learning').filter(a => a && a.unlocked).length,
            totalCount: safeGetAchievements('learning').length
          }
        ];

        // 确保 stats 有默认值
        const defaultStats = {
          total: 0,
          unlocked: 0,
          locked: 0,
          progress: 0,
          totalRewards: 0
        };

        const currentStats = stats || defaultStats;
        const currentUnlockedCount = currentStats.unlocked || 0;
        
        // 检查是否有新解锁的成就
        // 修复：首次加载时 previousUnlockedCount 为 0，如果用户有已解锁成就，不触发动画
        // 只在有旧数据且新解锁数量增加时才触发
        if (this.data.achievements.length > 0 && 
            this.data.previousUnlockedCount >= 0 && 
            currentUnlockedCount > this.data.previousUnlockedCount &&
            Array.isArray(achievements)) {
          // 找到最新解锁的成就
          const newlyUnlocked = achievements.find(a => 
            a && a.unlocked && a.id &&
            !this.data.achievements.find(oldA => oldA && oldA.id === a.id && oldA.unlocked)
          );
          
          if (newlyUnlocked) {
            // 延迟显示解锁动画，确保数据已更新
            setTimeout(() => {
              if (this.showUnlockAnimation) {
                this.showUnlockAnimation(newlyUnlocked);
              }
            }, 500);
          }
        }

        this.setData({
          achievements: achievements || [],
          achievementTypes,
          achievementStats: currentStats,
          loading: false,
          refreshing: false,
          lastLoadTime: Date.now(),
          previousUnlockedCount: currentUnlockedCount
        }, () => {
          // 数据加载完成后，触发进度条动画
          this.animateProgress();
        });
      } else {
        console.error('云函数返回失败:', res.result);
        this.setData({ 
          loading: false,
          refreshing: false
        });
        wx.showToast({
          title: res.result?.msg || '加载失败',
          icon: 'none',
          duration: 2000
        });
      }
    } catch (e) {
      console.error('加载成就失败:', e);
      this.setData({ 
        loading: false,
        refreshing: false
      });
      wx.showToast({
        title: '网络错误，请重试',
        icon: 'none',
        duration: 2000
      });
    }
  },

  // 下拉刷新
  onRefresh() {
    this.setData({ refreshing: true });
    this.loadAchievements(true); // 强制刷新
  },

  viewAchievement(e) {
    const achievement = e.currentTarget.dataset.achievement;
    if (!achievement) return;

    wx.vibrateShort({ type: 'light' });
    
    // 使用自定义弹窗
    this.setData({
      selectedAchievement: achievement,
      showModal: true
    });
  },

  // 关闭弹窗
  closeModal() {
    this.setData({
      showModal: false,
      selectedAchievement: null
    });
  },

  // 阻止事件冒泡
  stopPropagation() {
    // 空函数，用于阻止事件冒泡
  },

  // 重试加载
  onRetry() {
    this.loadAchievements(true);
  },

  // 动画进度条
  animateProgress() {
    // 使用 setTimeout 确保 DOM 更新后再执行动画
    setTimeout(() => {
      const query = wx.createSelectorQuery();
      query.selectAll('.progress-fill').boundingClientRect();
      query.exec((res) => {
        // 进度条动画已通过 CSS transition 实现
      });
    }, 100);
  },

  // 显示解锁动画
  showUnlockAnimation(achievement) {
    this.setData({
      unlockedAchievement: achievement,
      showUnlockAnimation: true
    });
    
    // 播放音效（如果支持）
    wx.vibrateShort({ type: 'heavy' });
  },

  // 关闭解锁动画
  closeUnlockAnimation() {
    this.setData({
      showUnlockAnimation: false,
      unlockedAchievement: null
    });
  },

  // 分享单个成就
  shareSingleAchievement() {
    if (!this.data.selectedAchievement || !this.data.selectedAchievement.unlocked) {
      return;
    }
    this.shareUnlockedAchievement();
  },

  // 分享解锁的成就
  shareUnlockedAchievement() {
    const achievement = this.data.unlockedAchievement || this.data.selectedAchievement;
    if (!achievement || !achievement.unlocked) {
      wx.showToast({
        title: '该成就未解锁',
        icon: 'none'
      });
      return;
    }

    // 设置分享数据，供 onShareAppMessage 使用
    this.setData({
      shareAchievement: achievement
    });

    // 提示用户使用分享功能
    wx.showToast({
      title: '请点击右上角分享',
      icon: 'none',
      duration: 2000
    });
  },

  // 分享成就总览
  shareAchievements() {
    const stats = this.data.achievementStats;
    if (!stats || stats.unlocked === 0) {
      wx.showToast({
        title: '还没有解锁成就哦',
        icon: 'none'
      });
      return;
    }

    // 设置分享数据，供 onShareAppMessage 使用
    this.setData({
      shareAchievement: null, // 设置为 null 表示分享总览
      shareStats: stats
    });

    // 提示用户使用分享功能
    wx.showToast({
      title: '请点击右上角分享',
      icon: 'none',
      duration: 2000
    });
  },

  // 分享配置
  onShareAppMessage(res) {
    // 优先使用设置的分享数据
    const achievement = this.data.shareAchievement || this.data.unlockedAchievement || this.data.selectedAchievement;
    const stats = this.data.shareStats || this.data.achievementStats;
    
    if (achievement && achievement.unlocked) {
      return {
        title: `我在山海造物解锁了成就：${achievement.name}！`,
        path: `/pages/user/achievements/index`,
        imageUrl: '' // 可以生成分享图片
      };
    }
    
    if (stats && stats.unlocked > 0) {
      return {
        title: `我在山海造物解锁了 ${stats.unlocked}/${stats.total} 个成就！`,
        path: `/pages/user/achievements/index`,
        imageUrl: '' // 可以生成分享图片
      };
    }
    
    // 默认分享内容
    return {
      title: '我的成就 - 山海造物',
      path: `/pages/user/achievements/index`,
      imageUrl: ''
    };
  },

  onShareTimeline() {
    // 朋友圈分享
    const achievement = this.data.shareAchievement || this.data.unlockedAchievement || this.data.selectedAchievement;
    const stats = this.data.shareStats || this.data.achievementStats;
    
    if (achievement && achievement.unlocked) {
      return {
        title: `我在山海造物解锁了成就：${achievement.name}！`,
        imageUrl: ''
      };
    }
    
    if (stats && stats.unlocked > 0) {
      return {
        title: `我在山海造物解锁了 ${stats.unlocked}/${stats.total} 个成就！完成度 ${stats.progress}%`,
        imageUrl: ''
      };
    }
    
    return {
      title: '我的成就 - 山海造物',
      imageUrl: ''
    };
  },

  goBack() {
    wx.navigateBack();
  }
});

