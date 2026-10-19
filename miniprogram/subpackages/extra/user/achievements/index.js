// subpackages/extra/user/achievements/index.js
const app = getApp();
const easterEgg = require('../../../../utils/easterEgg');
const { markAchievementsSeen } = require('../../../../utils/badgeDisplay');
const { takeFreshLit } = require('./litSeen');

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

/*
 * 2026-10-17 重设计「馆志 · 成长线」：
 * 同一件事的分档徽章（浏览 10 → 50 → 100）原来是三张各带进度条的卡片 —— 24 张卡、三层筛选。
 * 现在按「成长线」收成一行：一串铭牌节点（点亮 = 纸面铭牌、未点亮 = 发丝空环），
 * 通往下一枚的那段线按进度部分填色，行尾一句「下一枚『探索家』· 还差 32 次」。
 * 分组只在前端（云函数 getUserAchievements 出入参不变）；云端新增未登记的徽章自动按 id 前缀成线，不会丢。
 */
const TRACK_DEFS = [
  { key: 'explore', type: 'explore', name: '浏览', ids: ['explore_10', 'explore_50', 'explore_100'], labels: ['10', '50', '100'] },
  { key: 'search', type: 'explore', name: '检索', ids: ['search_5', 'search_20'], labels: ['5', '20'] },
  { key: 'collect', type: 'collect', name: '收藏', ids: ['collect_5', 'collect_10', 'collect_50'], labels: ['5', '10', '50'] },
  { key: 'folder', type: 'collect', name: '收藏夹', ids: ['folder_3'], labels: ['3'] },
  { key: 'atlas', type: 'collect', name: '山海图鉴', ids: ['atlas_first', 'atlas_frost', 'atlas_overwinter', 'atlas_mountain', 'atlas_volume'], labels: ['第一页', '霜降', '越冬', '守山', '卷一'] },
  { key: 'share', type: 'social', name: '分享', ids: ['share_1', 'share_5', 'share_20'], labels: ['1', '5', '20'] },
  { key: 'spend', type: 'consumption', name: '馆藏', ids: ['first_purchase', 'spend_500', 'spend_2000', 'spend_10000'], labels: ['首单', '¥500', '¥2000', '¥1万'] },
  { key: 'course', type: 'learning', name: '课程', ids: ['course_1', 'course_5'], labels: ['1', '5'] },
  { key: 'certificate', type: 'learning', name: '证书', ids: ['certificate_1', 'certificate_5'], labels: ['1', '5'] }
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/** 一条成长线的视图：节点 + 每段连线的填充比例 + 下一枚 */
function trackView(def, list) {
  const nodes = list.map((a, i) => ({
    id: a.id,
    roman: ROMAN[i] || String(i + 1),
    label: (def.labels && def.labels[def.ids.indexOf(a.id)]) || a.name,
    unlocked: a.unlocked,
    achievement: a
  }));
  const next = list.find((a) => !a.unlocked) || null;
  const nextIndex = next ? list.indexOf(next) : -1;
  // 第 i 段连线连着节点 i 与 i+1：两端都亮 = 满；通往「下一枚」的那段按它的进度填
  const links = nodes.slice(1).map((n, i) => {
    if (n.unlocked) return 100;
    if (i + 1 === nextIndex && nodes[i].unlocked) return next.progressPercent;
    return 0;
  });
  nodes.forEach((n, i) => { n.linkFill = i < links.length ? links[i] : -1; });
  const got = list.filter((a) => a.unlocked).length;
  return {
    key: def.key,
    name: def.name,
    got,
    total: list.length,
    done: !next,
    nodes,
    nextName: next ? next.name : '',
    // 行内已有「下一枚」，去掉 remainText 尾巴上的「即可点亮」
    nextRemain: next ? String(next.remainText || '').replace(/\s*即可点亮$/, '') : '',
    nextPercent: next ? next.progressPercent : 100,
    nextAchievement: next
  };
}

/** 五章（按类型）× 成长线 */
function buildChapters(all) {
  const byId = {};
  all.forEach((a) => { if (a && a.id) byId[a.id] = a; });
  const used = {};
  const tracksByType = {};
  TRACK_DEFS.forEach((def) => {
    const list = def.ids.map((id) => byId[id]).filter(Boolean);
    if (!list.length) return;
    list.forEach((a) => { used[a.id] = true; });
    (tracksByType[def.type] = tracksByType[def.type] || []).push(trackView(def, list));
  });
  // 云端新加、前端未登记的徽章：按 id 前缀（去掉末段）成线，门槛从小到大
  const rest = {};
  all.filter((a) => a && a.id && !used[a.id]).forEach((a) => {
    const key = `${a.type || 'other'}:${String(a.id).replace(/_[^_]*$/, '')}`;
    (rest[key] = rest[key] || []).push(a);
  });
  Object.keys(rest).forEach((key) => {
    const list = rest[key].sort((x, y) => x.threshold - y.threshold);
    const type = key.split(':')[0];
    const def = { key, type, name: list[0].name, ids: list.map((a) => a.id) };
    (tracksByType[type] = tracksByType[type] || []).push(trackView(def, list));
  });
  return TYPE_DEFS.map((def, i) => {
    const tracks = tracksByType[def.type] || [];
    return {
      type: def.type,
      no: ROMAN[i],
      name: def.name.replace(/类$/, ''),
      enName: def.enName,
      tracks,
      got: tracks.reduce((n, t) => n + t.got, 0),
      total: tracks.reduce((n, t) => n + t.total, 0)
    };
  }).filter((c) => c.tracks.length);
}

/** 下一枚：离点亮最近的三枚（进度高者优先；全是 0 时按门槛小者优先 —— 最容易的先给） */
function buildNextUp(all) {
  return all
    .filter((a) => a && !a.unlocked)
    .sort((a, b) => (b.progressPercent - a.progressPercent) || (a.threshold - b.threshold))
    .slice(0, 3);
}

Page({
  data: {
    loading: true,
    refreshing: false,
    loadError: false,
    achievements: [],
    achievementTypes: [],
    achievementStats: null,
    chapters: [],
    nextUp: [],
    ticks: [],
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
    relicsName: '山海拾遗'
  },

  onLoad(options) {
    // 需求 28：从「博物笔记」入口进来时直接落到遗物区（山海拾遗常驻页底，无筛选）
    if (String((options && options.focus) || '').trim() === 'relics') {
      this._focusRelics = true;
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

    const allByType = [];
    TYPE_DEFS.forEach((def) => { allByType.push(...byType[def.type]); });
    // 类型不在五章里的（云端新类型）也收进来，按 buildChapters 的兜底成线
    normalized.forEach((a) => { if (!allByType.find((x) => x.id === a.id)) allByType.push(a); });
    const builtChapters = buildChapters(allByType);
    // 新点亮射灯：本机第一次见到的已点亮成就，节点扫一次光（只播一次）
    let freshLit = [];
    try {
      const openid = (app && app.globalData && app.globalData.openid) || '';
      // 每个页面实例只取一次：onLoad 与 onShow 首次会并发拉两次，第二次若再取会拿到 [] 把射灯抹掉（2026-10-19 核查）
      if (!this._freshLit) {
        this._freshLit = typeof wx !== 'undefined' && wx.getStorageSync
          ? takeFreshLit(normalized.filter((a) => a.unlocked).map((a) => a.id), wx, openid)
          : [];
      }
      freshLit = this._freshLit;
    } catch (e) {
      freshLit = [];
    }
    const chapters = freshLit.length
      ? builtChapters.map((c) => ({
        ...c,
        tracks: c.tracks.map((t) => ({ ...t, nodes: t.nodes.map((n) => (freshLit.indexOf(n.id) >= 0 ? { ...n, fresh: true } : n)) }))
      }))
      : builtChapters;
    const nextUp = buildNextUp(allByType);
    const ticks = chapters.reduce((acc, c) => acc.concat(...c.tracks.map((t) => t.nodes.map((n) => ({ id: n.id, lit: n.unlocked })))), []);

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
      achievementTypes: chapters,
      chapters,
      nextUp,
      ticks,
      achievementStats: currentStats,
      loading: false,
      refreshing: false,
      loadError: false,
      lastLoadTime: Date.now(),
      previousUnlockedCount: currentUnlockedCount
    }, () => {
      this._markAchievementsSeenLocal();
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

  onRefresh() {
    this.setData({ refreshing: true });
    this.loadAchievements(true);
  },

  // 2026-10-17：内容改回页面滚动（原 scroll-view 里 wx.pageScrollTo 滚不动，focus=relics 从未真正落到山海拾遗）
  onPullDownRefresh() {
    Promise.resolve(this.loadAchievements(true)).finally(() => wx.stopPullDownRefresh());
  },

  /** 点成长线上的节点 / 下一枚的行：按 id 取（dataset 里不再塞整个对象） */
  viewAchievement(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const achievement = ds.achievement || (this.data.achievements || []).find((a) => a && a.id === ds.id);
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
