// subpackages/extra/user/achievements/index.js
const app = getApp();
const { getPageNavInsets } = require('../../utils/pageNav');
const easterEgg = require('../../../../utils/easterEgg');
const { markAchievementsSeen } = require('../../../../utils/badgeDisplay');

const TYPE_DEFS = [
  { type: 'explore', name: '探索类', enName: 'EXPLORATION', icon: '/assets/icons/knowledge.png' },
  { type: 'collect', name: '收藏类', enName: 'COLLECTION', icon: '/assets/icons/heart.png' },
  { type: 'social', name: '社交类', enName: 'SOCIAL', icon: '/assets/icons/share.png' },
  { type: 'consumption', name: '消费类', enName: 'CONSUMPTION', icon: '/assets/icons/coin_gold.png' },
  { type: 'learning', name: '学习类', enName: 'LEARNING', icon: '/assets/icons/knowledge.png' }
];

const TYPE_LABEL = {
  explore: '探索',
  collect: '收藏',
  social: '社交',
  consumption: '消费',
  learning: '学习'
};

function normalizeAchievement(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const threshold = Number(raw.threshold) || 1;
  let progress = Number(raw.progress);
  if (Number.isNaN(progress)) progress = 0;
  progress = Math.min(Math.max(progress, 0), threshold);
  let progressPercent = Number(raw.progressPercent);
  if (Number.isNaN(progressPercent)) {
    progressPercent = Math.round((progress / threshold) * 100);
  }
  progressPercent = Math.min(100, Math.max(0, Math.round(progressPercent)));
  const unlocked = !!raw.unlocked;
  const unit = raw.unit || '';
  const type = raw.type || '';
  const typeDef = TYPE_DEFS.find((d) => d.type === type);
  const progressText = raw.progressText || (
    String(raw.id || '').indexOf('spend_') === 0
      ? `¥${progress} / ¥${threshold}`
      : `${progress} / ${threshold}${unit}`
  );

  return {
    ...raw,
    threshold,
    progress,
    progressPercent,
    progressText,
    unit,
    typeLabel: raw.typeLabel || TYPE_LABEL[type] || '',
    typeEn: raw.typeEn || (typeDef && typeDef.enName) || 'BADGE',
    condition: raw.condition || raw.desc || '',
    statusLabel: unlocked ? '已点亮' : '未点亮',
    rewardPoints: (raw.reward && raw.reward.points) || 0,
    remainText: buildRemainText(raw.id, progress, threshold, unit),
    unlocked
  };
}

function buildRemainText(id, progress, threshold, unit) {
  const remain = Math.max(0, Number(threshold) - Number(progress));
  if (String(id || '').indexOf('spend_') === 0) {
    return remain > 0 ? `还差 ¥${Math.ceil(remain)} 即可点亮` : '即将点亮';
  }
  const u = unit ? ` ${unit}` : '';
  return remain > 0 ? `还差 ${remain}${u} 即可点亮` : '即将点亮';
}

function buildFilterTabs(stats) {
  const s = stats || {};
  return [
    { key: 'all', label: '全部', count: s.total != null ? s.total : null },
    { key: 'unlocked', label: '已点亮', count: s.unlocked != null ? s.unlocked : null },
    { key: 'locked', label: '未点亮', count: s.locked != null ? s.locked : null }
  ];
}

function buildSections(achievementsByType, viewFilter) {
  return TYPE_DEFS.map((def) => {
    const all = (Array.isArray(achievementsByType[def.type]) ? achievementsByType[def.type] : [])
      .map(normalizeAchievement)
      .filter(Boolean);

    const unlockedList = all.filter((a) => a.unlocked);
    const lockedList = all.filter((a) => !a.unlocked);

    let visible = all;
    if (viewFilter === 'unlocked') visible = unlockedList;
    if (viewFilter === 'locked') visible = lockedList;

    const usePartition = viewFilter === 'all';

    return {
      ...def,
      achievements: all,
      unlockedList,
      lockedList,
      visible,
      unlockedCount: unlockedList.length,
      lockedCount: lockedList.length,
      totalCount: all.length,
      usePartition,
      showUnlockedBlock: usePartition && unlockedList.length > 0,
      showLockedBlock: usePartition && lockedList.length > 0,
      isEmpty: visible.length === 0
    };
  }).filter((section) => section.totalCount > 0 && (viewFilter === 'all' || !section.isEmpty));
}

Page({
  data: {
    statusBarHeight: 20,
    navPaddingRight: 16,
    headerBlockPx: 88,
    loading: true,
    refreshing: false,
    loadError: false,
    achievements: [],
    achievementTypes: [],
    achievementStats: null,
    viewFilter: 'all',
    filterTabs: buildFilterTabs(null),
    showModal: false,
    selectedAchievement: null,
    lastLoadTime: 0,
    showUnlockAnimation: false,
    unlockedAchievement: null,
    previousUnlockedCount: 0,
    shareAchievement: null,
    shareStats: null,
    showShareTip: false,
    relicsCatalog: [],
    relicsFound: 0,
    relicsTotal: 0,
    relicsPercent: 0,
    relicsUnlocked: false,
    relicsName: '山海拾遗',
    emptyFilterHint: ''
  },

  onLoad(options) {
    try {
      const nav = getPageNavInsets({ headerExtraRpx: 112, nativeNav: true });
      this.setData({
        statusBarHeight: nav.statusBarHeight,
        navPaddingRight: nav.navPaddingRight,
        headerBlockPx: nav.headerBlockPx
      });
    } catch (e) {
      console.warn('获取系统信息失败:', e);
    }

    // 需求 28：从祈福墙的「博物笔记」入口进来时直接落到遗物区。
    // 遗物卡片只在「全部」筛选下渲染，所以先确保筛选是 all，再滚动。
    if (String((options && options.focus) || '').trim() === 'relics') {
      this._focusRelics = true;
      if (this.data.viewFilter !== 'all') this.setData({ viewFilter: 'all' });
    }

    this.loadAchievements();
    this.loadRelics();
  },

  onUnload() {
    this._clearShareTipTimer();
  },

  onHide() {
    this._clearShareTipTimer();
  },

  onShow() {
    this.loadRelics();
    const now = Date.now();
    if (now - this.data.lastLoadTime > 30000 || this.data.achievements.length === 0) {
      this.loadAchievements();
    } else {
      this._markAchievementsSeenLocal();
    }
  },

  _markAchievementsSeenLocal() {
    try {
      const openid = (app.globalData && app.globalData.openid) || '';
      const fromStats = this.data.achievementStats && this.data.achievementStats.unlocked;
      const fromList = (this.data.achievements || []).filter((a) => a && a.unlocked).length;
      const unlocked = fromStats != null ? Number(fromStats) || 0 : fromList;
      // 尚未拉到数据时不写 0，避免把「已看水位」误清零
      if (!this.data.achievementStats && !(this.data.achievements || []).length) return;
      markAchievementsSeen(unlocked, openid);
      const pages = getCurrentPages();
      const prev = pages[pages.length - 2];
      if (prev && typeof prev._clearAchievementBadge === 'function') {
        prev._clearAchievementBadge(unlocked);
      }
    } catch (e) { /* ignore */ }
  },

  _clearShareTipTimer() {
    if (this._shareTipTimer) {
      clearTimeout(this._shareTipTimer);
      this._shareTipTimer = null;
    }
  },

  _showShareTip() {
    this._clearShareTipTimer();
    this.setData({ showShareTip: true });
    this._shareTipTimer = setTimeout(() => {
      this.setData({ showShareTip: false });
      this._shareTipTimer = null;
    }, 4500);
  },

  dismissShareTip() {
    this._clearShareTipTimer();
    this.setData({ showShareTip: false });
  },

  _applyAchievementData(payload, options = {}) {
    const { achievements = [], achievementsByType = {}, stats = null } = payload || {};
    const normalized = (Array.isArray(achievements) ? achievements : [])
      .map(normalizeAchievement)
      .filter(Boolean);

    const byType = {};
    TYPE_DEFS.forEach((def) => {
      const list = Array.isArray(achievementsByType[def.type])
        ? achievementsByType[def.type]
        : normalized.filter((a) => a.type === def.type);
      byType[def.type] = list.map(normalizeAchievement).filter(Boolean);
    });

    const defaultStats = {
      total: normalized.length,
      unlocked: normalized.filter((a) => a.unlocked).length,
      locked: normalized.filter((a) => !a.unlocked).length,
      progress: 0,
      totalRewards: 0
    };
    const currentStats = Object.assign({}, defaultStats, stats || {});
    if (!currentStats.progress && currentStats.total) {
      currentStats.progress = Math.round((currentStats.unlocked / currentStats.total) * 100);
    }

    const viewFilter = options.viewFilter || this.data.viewFilter || 'all';
    const achievementTypes = buildSections(byType, viewFilter);
    const emptyFilterHint = this._emptyFilterHint(viewFilter, currentStats);
    const filterTabs = buildFilterTabs(currentStats);

    const currentUnlockedCount = currentStats.unlocked || 0;
    if (
      options.checkNewUnlock &&
      this.data.achievements.length > 0 &&
      currentUnlockedCount > this.data.previousUnlockedCount
    ) {
      const newlyUnlocked = normalized.find((a) =>
        a.unlocked && a.id &&
        !this.data.achievements.find((oldA) => oldA && oldA.id === a.id && oldA.unlocked)
      );
      if (newlyUnlocked) {
        setTimeout(() => {
          if (this.showUnlockAnimation) this.showUnlockAnimation(newlyUnlocked);
        }, 500);
      }
    }

    this._rawByType = byType;

    this.setData({
      achievements: normalized,
      achievementTypes,
      achievementStats: currentStats,
      viewFilter,
      filterTabs,
      emptyFilterHint,
      loading: false,
      refreshing: false,
      loadError: false,
      lastLoadTime: Date.now(),
      previousUnlockedCount: currentUnlockedCount
    }, () => {
      this.animateProgress();
      this._markAchievementsSeenLocal();
    });
  },

  _emptyFilterHint(viewFilter, stats) {
    if (viewFilter === 'unlocked' && (!stats || !stats.unlocked)) {
      return '还没有点亮的徽章。去馆里逛逛，慢慢收集吧。';
    }
    if (viewFilter === 'locked' && stats && stats.locked === 0) {
      return '所有徽章都已点亮，铜牌柜满格。';
    }
    return '';
  },

  _rebuildSections(viewFilter) {
    const byType = this._rawByType || {};
    const achievementTypes = buildSections(byType, viewFilter);
    const emptyFilterHint = this._emptyFilterHint(viewFilter, this.data.achievementStats);
    this.setData({
      viewFilter,
      achievementTypes,
      emptyFilterHint
    });
  },

  async loadAchievements(forceRefresh = false) {
    try {
      const now = Date.now();
      if (!forceRefresh && now - this.data.lastLoadTime < 5000 && this.data.achievements.length > 0) {
        return;
      }

      this.setData({ loading: true, loadError: false });

      const userId = app.globalData.openid;
      if (!userId) {
        this.setData({ loading: false, loadError: true });
        wx.showToast({ title: '请先登录', icon: 'none' });
        return;
      }

      const res = await wx.cloud.callFunction({
        name: 'getUserAchievements',
        data: { userId }
      });

      if (res.result && res.result.success && res.result.data) {
        this._applyAchievementData(res.result.data, { checkNewUnlock: true });
      } else {
        this.setData({
          loading: false,
          refreshing: false,
          loadError: true
        });
        wx.showToast({
          title: (res.result && res.result.msg) || '加载失败',
          icon: 'none',
          duration: 2000
        });
      }
    } catch (e) {
      console.error('加载成就失败:', e);
      this.setData({
        loading: false,
        refreshing: false,
        loadError: true
      });
      wx.showToast({
        title: '网络错误，请重试',
        icon: 'none',
        duration: 2000
      });
    }
  },

  onFilterChange(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.viewFilter) return;
    wx.vibrateShort({ type: 'light' });
    this._rebuildSections(key);
  },

  onRefresh() {
    this.setData({ refreshing: true });
    this.loadAchievements(true);
  },

  viewAchievement(e) {
    const achievement = e.currentTarget.dataset.achievement;
    if (!achievement) return;
    wx.vibrateShort({ type: 'light' });
    this.setData({
      selectedAchievement: normalizeAchievement(achievement),
      showModal: true
    });
  },

  closeModal() {
    this.setData({
      showModal: false,
      selectedAchievement: null
    });
  },

  stopPropagation() {},

  onRetry() {
    this.loadAchievements(true);
  },

  animateProgress() {
    setTimeout(() => {
      const query = wx.createSelectorQuery();
      query.selectAll('.progress-fill').boundingClientRect();
      query.exec(() => {});
    }, 100);
  },

  showUnlockAnimation(achievement) {
    this.setData({
      unlockedAchievement: normalizeAchievement(achievement),
      showUnlockAnimation: true
    });
    wx.vibrateShort({ type: 'heavy' });
  },

  closeUnlockAnimation() {
    this.setData({
      showUnlockAnimation: false,
      unlockedAchievement: null
    });
  },

  shareSingleAchievement() {
    if (!this.data.selectedAchievement || !this.data.selectedAchievement.unlocked) return;
    this.shareUnlockedAchievement();
  },

  shareUnlockedAchievement() {
    const achievement = this.data.unlockedAchievement || this.data.selectedAchievement;
    if (!achievement || !achievement.unlocked) {
      wx.showToast({ title: '该成就未解锁', icon: 'none' });
      return;
    }
    this.setData({ shareAchievement: achievement, shareStats: null });
    this._showShareTip();
  },

  shareAchievements() {
    const stats = this.data.achievementStats;
    if (!stats || stats.unlocked === 0) {
      wx.showToast({ title: '尚未解锁成就', icon: 'none' });
      return;
    }
    this.setData({
      shareAchievement: null,
      shareStats: stats
    });
    this._showShareTip();
  },

  onShareAppMessage() {
    this.dismissShareTip();
    const achievement = this.data.shareAchievement || this.data.unlockedAchievement || this.data.selectedAchievement;
    const stats = this.data.shareStats || this.data.achievementStats;

    if (achievement && achievement.unlocked) {
      return {
        title: `我在山海造物点亮了徽章：${achievement.name}`,
        path: '/subpackages/extra/user/achievements/index',
        imageUrl: ''
      };
    }
    if (stats && stats.unlocked > 0) {
      return {
        title: `我在山海造物点亮了 ${stats.unlocked}/${stats.total} 枚徽章`,
        path: '/subpackages/extra/user/achievements/index',
        imageUrl: ''
      };
    }
    return {
      title: '我的成就 · 山海造物',
      path: '/subpackages/extra/user/achievements/index',
      imageUrl: ''
    };
  },

  onShareTimeline() {
    this.dismissShareTip();
    const achievement = this.data.shareAchievement || this.data.unlockedAchievement || this.data.selectedAchievement;
    const stats = this.data.shareStats || this.data.achievementStats;

    if (achievement && achievement.unlocked) {
      return { title: `我在山海造物点亮了徽章：${achievement.name}`, imageUrl: '' };
    }
    if (stats && stats.unlocked > 0) {
      return {
        title: `我在山海造物点亮了 ${stats.unlocked}/${stats.total} 枚徽章 · 完成度 ${stats.progress}%`,
        imageUrl: ''
      };
    }
    return { title: '我的成就 · 山海造物', imageUrl: '' };
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/user/index' })
    });
  },

  loadRelics() {
    const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
    const shortSource = (source) => {
      const s = String(source || '');
      const m = s.match(/·([^》]+)/);
      if (m && m[1]) return m[1].trim();
      return s.replace(/[《》]/g, '').slice(0, 12);
    };
    const catalog = easterEgg.listCatalog().map((item, index) => ({
      ...item,
      roman: ROMAN[index] || String(index + 1),
      plateTitle: item.discovered ? item.title : '· · ·',
      plateHint: item.discovered ? (shortSource(item.source) || '已著录') : '待偶遇'
    }));
    const progress = easterEgg.getProgress();
    const percent = progress.total
      ? Math.min(100, Math.round((progress.found / progress.total) * 100))
      : 0;
    this.setData({
      relicsCatalog: catalog,
      relicsFound: progress.found,
      relicsTotal: progress.total,
      relicsPercent: percent,
      relicsUnlocked: progress.achievementUnlocked,
      relicsName: progress.achievementName
    });

    // 带 focus=relics 进来：数据铺完后定位到遗物卡片（只做一次）。
    // setData 之后元素才存在，故放在这里而不是 onLoad。
    if (this._focusRelics) {
      this._focusRelics = false;
      setTimeout(() => {
        wx.pageScrollTo({
          selector: '.relics-card',
          duration: 300,
          fail: () => { /* 定位失败不影响页面本身 */ }
        });
      }, 120);
    }
  },

  openRelic(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    if (!easterEgg.isDiscovered(id)) {
      wx.showToast({ title: '尚未偶遇这一页', icon: 'none' });
      return;
    }
    easterEgg.tryTrigger(id, { page: this, source: 'relics' });
  }
});
