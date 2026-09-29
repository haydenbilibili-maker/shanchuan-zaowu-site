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
    sectionCollapsed: {},
    letterLoading: false,
    loadError: false,
    entered: false,
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
