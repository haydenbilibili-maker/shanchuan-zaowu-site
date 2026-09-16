const { enrichMessage, openMiniProgramUrl } = require('../../../../../utils/messageHelper');
const { trackBehavior } = require('../../../../../utils/trackBehavior');

const LIST_URL = '/subpackages/extra/user/messages/index';

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

function goInboxListReplace() {
  wx.redirectTo({
    url: LIST_URL,
    fail: () => wx.reLaunch({ url: LIST_URL })
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

Page({
  data: {
    selectedMessage: {},
    loadError: false,
    entered: false,
    scrollHeightPx: 0,
    scrollStyle: ''
  },

  onReady() {
    this.syncScrollPane();
  },

  onShow() {
    this.syncScrollPane();
  },

  guessScrollPane() {
    const winH = getWindowHeight();
    const next = Math.max(240, (winH || 600) - 180);
    this.setData({
      scrollHeightPx: next,
      scrollStyle: 'height: ' + next + 'px;'
    });
  },

  syncScrollPane() {
    const winH = getWindowHeight();
    const apply = (pageH, dockH) => {
      const next = Math.max(240, Math.floor((pageH || winH || 600) - (dockH || 180)));
      if (!next || next === this.data.scrollHeightPx) return;
      this.setData({
        scrollHeightPx: next,
        scrollStyle: 'height: ' + next + 'px;'
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
          const dockH = (res && res[1] && res[1].height) || 180;
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
      goInboxListReplace();
      return true;
    }
    return false;
  },

  displayLetter(message) {
    const wasUnread = message.read !== true;
    const enriched = enrichMessage({ ...message, read: true });
    this.setData({
      selectedMessage: { ...enriched, isUnread: false, read: true },
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
        this.setData({ loadError: true });
      }
    } catch (e) {
      console.warn('打开来信失败:', e);
      if (!this.data.selectedMessage._id) {
        this.setData({ loadError: true });
      }
    }
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
    if (hasInboxListInStack()) {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          this._leaving = false;
          goInboxListReplace();
        }
      });
      return;
    }
    goInboxListReplace();
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
