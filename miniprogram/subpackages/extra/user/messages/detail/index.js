const { enrichMessage, openMiniProgramUrl } = require('../../../../../utils/messageHelper');
const { trackBehavior } = require('../../../../../utils/trackBehavior');
const { buildDigestView } = require('../../../utils/digestView');

const LIST_URL = '/subpackages/extra/user/messages/index';
const WORKFLOW_DIGEST_LIST_URL = '/subpackages/extra/user/messages/index?queue=workflow&category=digest';

function isInboxListRoute(route) {
  const r = String(route || '');
  return /user\/messages\/index$/.test(r) && r.indexOf('messages/detail') === -1;
}

function hasInboxListInStack() {
  const pages = getCurrentPages();
  if (pages.length < 2) return false;
  const prev = pages[pages.length - 2];
  return !!(prev && isInboxListRoute(prev.route));
}

/** 栈里的信箱列表页（没有时为 null） */
function inboxListPage() {
  const pages = getCurrentPages();
  for (let i = pages.length - 2; i >= 0; i--) {
    if (pages[i] && isInboxListRoute(pages[i].route)) return pages[i];
  }
  return null;
}

/**
 * 下一封未读（2026-11-23）：只在顾客信箱里、只看纸信（日报 / 工作信息不参与）。
 * 从当前这封之后往下找，找不到再从头找；返回 { id, title, remain }，没有时 null。
 * 只读列表页已拿到的数据，不另打云端。
 */
function nextUnreadOf(listData, currentId) {
  if (!listData || listData.workflowMode || listData.activeQueue !== 'customer') return null;
  const list = (listData.messages || []).filter((m) => m && m._id && !m.isDigest && m.kind !== 'workflow');
  const unread = list.filter((m) => m.isUnread && m._id !== currentId && m._altId !== currentId);
  if (!unread.length) return null;
  const at = list.findIndex((m) => m._id === currentId || m._altId === currentId);
  const after = unread.find((m) => list.indexOf(m) > at);
  const next = after || unread[0];
  return { id: next._id, title: next.title || next.typeName || '一封来信', remain: unread.length };
}

function goInboxListReplace(isDigest) {
  const url = isDigest ? WORKFLOW_DIGEST_LIST_URL : LIST_URL;
  wx.redirectTo({
    url,
    fail: () => wx.reLaunch({ url })
  });
}

function getWindowHeight() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const info = wx.getWindowInfo();
      if (info && info.windowHeight) return info.windowHeight;
    }
  } catch (e) {
    // 旧基础库走 sync
  }
  try {
    const info = wx.getSystemInfoSync();
    return (info && info.windowHeight) || 0;
  } catch (e) {
    return 0;
  }
}

function getSafeBottom () {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const info = wx.getWindowInfo();
      if (info && info.safeArea && info.screenHeight) {
        return Math.max(0, info.screenHeight - info.safeArea.bottom);
      }
    }
  } catch (e) { /* ignore */ }
  try {
    const info = wx.getSystemInfoSync();
    if (info && info.safeArea && info.screenHeight) {
      return Math.max(0, info.screenHeight - info.safeArea.bottom);
    }
  } catch (e) { /* ignore */ }
  return 0;
}

Page({
  data: {
    selectedMessage: {},
    // 每日日报的结构化视图模型（非日报消息恒为 null → WXML 整块不出现）
    digestView: null,
    digestPayloadMissing: false,
    nextUnread: null,
    sectionCollapsed: {},
    letterLoading: false,
    loadError: false,
    entered: false,
    // 拆信仪式（2026-10-18）：'' 不播 → sealed 封着 → open 掀封口 → out 信纸抽出 → done 信封退场
    unsealing: '',
    scrollHeightPx: 0,
    scrollStyle: '',
    actionPadStyle: ''
  },

  onReady() {
    this.syncScrollPane();
  },

  onShow() {
    this.syncScrollPane();
  },

  guessScrollPane() {
    const winH = getWindowHeight();
    const safeBottom = getSafeBottom();
    const dockGuess = 168 + safeBottom;
    const next = Math.max(240, (winH || 600) - dockGuess);
    this.setData({
      scrollHeightPx: next,
      scrollStyle: 'height: ' + next + 'px;',
      actionPadStyle: 'padding-bottom: ' + (24 + safeBottom) + 'px;'
    });
  },

  syncScrollPane() {
    const winH = getWindowHeight();
    const safeBottom = getSafeBottom();
    const apply = (pageH, dockH) => {
      const next = Math.max(240, Math.floor((pageH || winH || 600) - (dockH || (168 + safeBottom))));
      if (!next || next === this.data.scrollHeightPx) return;
      this.setData({
        scrollHeightPx: next,
        scrollStyle: 'height: ' + next + 'px;',
        actionPadStyle: 'padding-bottom: ' + (24 + safeBottom) + 'px;'
      });
    };
    wx.nextTick(() => {
      this.createSelectorQuery()
        .select('.page-msg')
        .boundingClientRect()
        .select('.letter-actions')
        .boundingClientRect()
        .exec((res) => {
          const pageH = (res && res[0] && res[0].height) || winH;
          const dockH = (res && res[1] && res[1].height) || (168 + safeBottom);
          apply(pageH, dockH);
        });
    });
  },

  onLoad(options) {
    this.guessScrollPane();
    const id = String(options.messageId || options.id || options.msgId || '').trim();
    this._letterId = id;
    this._fromNext = options.from === 'next';

    const stack = getCurrentPages();
    if (stack.length <= 1 && id) {
      wx.redirectTo({
        url: `${LIST_URL}?id=${encodeURIComponent(id)}`,
        fail: () => this.bootLetter(id)
      });
      return;
    }

    this.bootLetter(id);
  },

  bootLetter(id) {
    let gotChannel = false;
    try {
      const channel = this.getOpenerEventChannel && this.getOpenerEventChannel();
      if (channel && typeof channel.on === 'function') {
        channel.on('letter', (message) => {
          if (!message) return;
          gotChannel = true;
          this.displayLetter(message);
        });
      }
    } catch (e) {
      // 深链直达时没有 opener
    }

    // 从「下一封未读」翻过来（redirectTo 没有 eventChannel）：先用信箱里已有的这封立刻展开，云端那份随后覆盖
    if (id && this._fromNext) {
      const list = inboxListPage();
      const cached = list && (list.data.messages || []).find((m) => m && (m._id === id || m._altId === id));
      if (cached && cached.title) this.displayLetter(cached);
    }

    if (id) {
      this.fetchLetter(id);
    } else if (!gotChannel) {
      this.setData({ loadError: true });
    }
  },

  onBackPress() {
    if (!hasInboxListInStack()) {
      goInboxListReplace(!!(this.data.digestView || (this.data.selectedMessage && this.data.selectedMessage.isDigest)));
      return true;
    }
    return false;
  },

  displayLetter(message) {
    const wasUnread = message.read !== true;
    const enriched = enrichMessage({ ...message, read: true });
    const digestView = buildDigestView(message);
    const isDigest = !!(enriched.isDigest || String(message.type || '') === 'daily_digest');
    // 只在第一次展示时决定：未读的纸信才拆封；eventChannel 与 fetch 两次回调不重播，日报不拆
    if (!this._unsealDecided) {
      this._unsealDecided = true;
      if (wasUnread && !isDigest) this.playUnseal();
    }
    const sectionCollapsed = {};
    if (digestView && Array.isArray(digestView.sections)) {
      digestView.sections.forEach((sec) => {
        if (sec && sec.key) sectionCollapsed[sec.key] = !!sec.startCollapsed;
      });
    }
    this.setData({
      selectedMessage: { ...enriched, isUnread: false, read: true },
      // 从 payload 生成渲染模型：门店营收逐项按店拆分，且「未取到」与「0」分开显示
      digestView,
      digestPayloadMissing: isDigest && !digestView,
      sectionCollapsed,
      letterLoading: false,
      loadError: false,
      entered: false
    });
    wx.nextTick(() => {
      this.syncScrollPane();
      setTimeout(() => {
        this.setData({ entered: true });
        this.syncScrollPane();
      }, 40);
    });

    const id = enriched._id || this._letterId;
    this.notifyListRead(id);
    // 读完这封，信纸下方给「下一封未读」（列表已先把这封标成已读）
    if (!isDigest) {
      const list = inboxListPage();
      this.setData({ nextUnread: list ? nextUnreadOf(list.data, id) : null }, () => this.syncScrollPane());
    }

    if (wasUnread && id) {
      wx.cloud.callFunction({
        name: 'getUserMessages',
        data: { action: 'markRead', messageId: id }
      }).catch((err) => {
        console.error('标记已读失败:', err);
      });
      trackBehavior('message_read', 'message', id, { category: enriched.category });
    }
  },

  /** 拆信：封着 → 掀封口 → 信纸抽出 → 信封退场；纯展示，已读照常在 displayLetter 里标 */
  playUnseal() {
    this._unsealTimers = [];
    this.setData({ unsealing: 'sealed' });
    const at = (ms, phase) => this._unsealTimers.push(setTimeout(() => this.setData({ unsealing: phase }), ms));
    at(420, 'open');
    at(860, 'out');
    at(1500, 'done');
  },

  /** 点信封直接拆开（不想等的人） */
  skipUnseal() {
    (this._unsealTimers || []).forEach(clearTimeout);
    this._unsealTimers = [];
    this.setData({ unsealing: 'done' });
  },

  onUnload() {
    (this._unsealTimers || []).forEach(clearTimeout);
  },

  async fetchLetter(messageId) {
    if (!this.data.selectedMessage._id) {
      this.setData({ letterLoading: true, loadError: false });
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserMessages',
        data: { action: 'getMessage', messageId }
      });
      if (res && res.result && res.result.success && res.result.message) {
        this.displayLetter(res.result.message);
        return;
      }
      if (!this.data.selectedMessage._id) {
        this.setData({ loadError: true, letterLoading: false });
      } else {
        this.setData({ letterLoading: false });
      }
    } catch (e) {
      console.warn('打开来信失败:', e);
      if (!this.data.selectedMessage._id) {
        this.setData({ loadError: true, letterLoading: false });
      } else {
        this.setData({ letterLoading: false });
      }
    }
  },

  toggleDigestSection(e) {
    const key = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '');
    if (!key) return;
    const sectionCollapsed = { ...(this.data.sectionCollapsed || {}) };
    sectionCollapsed[key] = !sectionCollapsed[key];
    this.setData({ sectionCollapsed });
    wx.nextTick(() => this.syncScrollPane());
  },

  expandAllDigestSections() {
    const sectionCollapsed = {};
    const sections = (this.data.digestView && this.data.digestView.sections) || [];
    sections.forEach((sec) => {
      if (sec && sec.key) sectionCollapsed[sec.key] = false;
    });
    this.setData({ sectionCollapsed });
    wx.nextTick(() => this.syncScrollPane());
  },

  collapseOkDigestSections() {
    const sectionCollapsed = {};
    const sections = (this.data.digestView && this.data.digestView.sections) || [];
    sections.forEach((sec) => {
      if (sec && sec.key) sectionCollapsed[sec.key] = sec.healthTone === 'ok';
    });
    this.setData({ sectionCollapsed });
    wx.nextTick(() => this.syncScrollPane());
  },

  copyDigestSummary() {
    this._clipboardWrite(
      (this.data.digestView && this.data.digestView.copyText)
        || (this.data.selectedMessage && this.data.selectedMessage.title)
        || '',
      'digest_copy'
    );
  },

  shareDigestSheet() {
    const view = this.data.digestView;
    if (!view) {
      wx.showToast({ title: '暂无结构化摘要', icon: 'none' });
      return;
    }
    const items = ['复制完整摘要'];
    if (view.hasFailedRows) items.push('仅复制失败项');
    items.push('复制关键三数');
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const idx = res.tapIndex;
        if (idx === 0) {
          this._clipboardWrite(view.copyText, 'digest_copy_full');
          return;
        }
        if (view.hasFailedRows && idx === 1) {
          this._clipboardWrite(view.copyFailedText, 'digest_copy_failed');
          return;
        }
        const hiLines = (view.highlights || []).map((h) => `${h.label} ${h.valueText}`);
        const brief = [`${view.dayKey || '日报'}${view.roleLabel ? ` · ${view.roleLabel}` : ''}`, view.healthSummary || view.countNote]
          .concat(hiLines)
          .filter(Boolean)
          .join('\n');
        this._clipboardWrite(brief, 'digest_copy_brief');
      }
    });
  },

  _clipboardWrite(text, trackName) {
    if (!text) {
      wx.showToast({ title: '暂无可复制摘要', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'none' });
        trackBehavior(trackName || 'digest_copy', 'message', this.data.selectedMessage._id || '');
      },
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    });
  },

  notifyListRead(messageId) {
    const pages = getCurrentPages();
    for (let i = pages.length - 2; i >= 0; i--) {
      const page = pages[i];
      if (page && typeof page.applyLocalRead === 'function') {
        page.applyLocalRead(messageId);
      }
      if (page && typeof page.loadUnreadMessageCount === 'function') {
        page.loadUnreadMessageCount();
      }
    }
  },

  /** 翻到下一封未读：替换当前信页（不叠栈），返回仍回信箱 */
  goNextUnread() {
    const next = this.data.nextUnread;
    if (!next || !next.id || this._leaving) return;
    this._leaving = true;
    wx.redirectTo({
      url: `/subpackages/extra/user/messages/detail/index?id=${encodeURIComponent(next.id)}&from=next`,
      fail: () => { this._leaving = false; }
    });
  },

  leaveLetter() {
    if (this._leaving) return;
    this._leaving = true;
    const isDigest = !!(this.data.digestView || (this.data.selectedMessage && this.data.selectedMessage.isDigest));
    if (hasInboxListInStack()) {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          this._leaving = false;
          goInboxListReplace(isDigest);
        }
      });
      return;
    }
    goInboxListReplace(isDigest);
  },

  handleAction() {
    const msg = this.data.selectedMessage;
    if (!msg || !msg.actionUrl) return;

    trackBehavior('message_action', 'message', msg._id, {
      category: msg.category,
      actionUrl: msg.actionUrl
    });

    openMiniProgramUrl(msg.actionUrl);
  },

  /**
   * 发货包装图片（可选附件）点击放大。
   *
   * 为什么必须有：信内是 aspectFill 的小方格，包装实拍的价值在细节（封条、衬垫、玻璃罩），
   * 不能放大等于没给。`urls` 传整组、`current` 传点到的那张 —— 顾客可以左右滑动看完整组。
   */
  previewPackagePhoto(e) {
    const src = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.src) || '');
    const urls = (this.data.selectedMessage && this.data.selectedMessage.packagePhotos) || [];
    if (!src || !urls.length) return;
    wx.previewImage({
      current: src,
      urls
    });
  },

  async deleteMessage() {
    const message = this.data.selectedMessage;
    if (!message || !message._id) return;

    try {
      wx.showLoading({ title: '删除中' });
      const res = await wx.cloud.callFunction({
        name: 'getUserMessages',
        data: { action: 'deleteMessage', messageId: message._id }
      });

      if (res && res.result && res.result.success) {
        const pages = getCurrentPages();
        for (let i = pages.length - 2; i >= 0; i--) {
          const page = pages[i];
          if (page && typeof page.applyLocalDelete === 'function') {
            page.applyLocalDelete(message._id);
          }
          if (page && typeof page.loadUnreadMessageCount === 'function') {
            page.loadUnreadMessageCount();
          }
        }
        wx.showToast({ title: '已删除', icon: 'none' });
        trackBehavior('message_delete', 'message', message._id);
        this.leaveLetter();
      } else {
        wx.showToast({ title: '删除失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
