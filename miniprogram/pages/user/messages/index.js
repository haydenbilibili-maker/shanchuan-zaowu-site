// pages/user/messages/index.js
const { enrichMessage } = require('../../../utils/messageHelper');
const { trackBehavior } = require('../../../utils/trackBehavior');

const FILTER_TABS = [
  { id: 'all', label: '全部' },
  { id: 'booking', label: '预约' },
  { id: 'order', label: '订单' },
  { id: 'custom', label: '定制' },
  { id: 'activity', label: '活动' },
  { id: 'system', label: '系统' }
];

Page({
  data: {
    statusBarHeight: 0,
    headerHeight: 88,
    loading: true,
    loadingMore: false,
    refreshing: false,
    messages: [],
    unreadCount: 0,
    showDetail: false,
    selectedMessage: {},
    filterTabs: FILTER_TABS,
    activeCategory: 'all',
    hasMore: true,
    page: 0
  },

  onLoad(options) {
    try {
      const systemInfo = wx.getSystemInfoSync();
      const statusBarHeight = systemInfo.statusBarHeight || 0;
      this.setData({
        statusBarHeight,
        headerHeight: this.estimateHeaderHeight(statusBarHeight)
      });
    } catch (e) {
      this.setData({ statusBarHeight: 0, headerHeight: this.estimateHeaderHeight(0) });
    }

    if (options.category && FILTER_TABS.some((t) => t.id === options.category)) {
      this.setData({ activeCategory: options.category });
    }

    this.loadMessages(true);
  },

  onReady() {
    this.measureHeader();
  },

  estimateHeaderHeight(statusBarHeight) {
    return statusBarHeight + 168;
  },

  measureHeader() {
    wx.nextTick(() => {
      wx.createSelectorQuery()
        .in(this)
        .select('.sticky-header')
        .boundingClientRect((rect) => {
          if (rect && rect.height) {
            // 额外留白，避免 Tab 与首条消息视觉重叠
            this.setData({ headerHeight: Math.ceil(rect.height) + 12 });
          }
        })
        .exec();
    });
  },

  onShow() {
    if (this._hasLoaded) {
      this.loadMessages(true, { silent: true });
    }
  },

  onPullDownRefresh() {
    this.loadMessages(true).then(() => wx.stopPullDownRefresh());
  },

  onRefresh() {
    this.setData({ refreshing: true });
    this.loadMessages(true).then(() => this.setData({ refreshing: false }));
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadMessages(false);
    }
  },

  switchCategory(e) {
    const category = e.currentTarget.dataset.id;
    if (category === this.data.activeCategory) return;
    this.setData({ activeCategory: category, page: 0, hasMore: true });
    this.loadMessages(true);
    this.measureHeader();
    trackBehavior('message_filter', 'category', category);
  },

  async loadMessages(reset = false, options = {}) {
    const { silent = false } = options;
    if (this._fetching) return;
    if (!reset && !this.data.hasMore) return;

    this._fetching = true;
    const page = reset ? 0 : this.data.page + 1;

    if (reset && !silent) {
      this.setData({ loading: true });
    } else if (!reset) {
      this.setData({ loadingMore: true });
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserMessages',
        data: {
          action: 'getMessages',
          category: this.data.activeCategory,
          page,
          pageSize: 20
        }
      });

      if (res && res.result && res.result.success) {
        const raw = Array.isArray(res.result.messages) ? res.result.messages : [];
        const batch = raw.map(enrichMessage);
        const messages = reset ? batch : [...this.data.messages, ...batch];

        this.setData({
          messages,
          unreadCount: res.result.unreadCount ?? messages.filter((m) => m.isUnread).length,
          hasMore: !!res.result.hasMore,
          page,
          loading: false,
          loadingMore: false
        });
        this._hasLoaded = true;
        this.measureHeader();
      } else {
        const errMsg = (res && res.result && res.result.msg) || '加载失败';
        if (reset) {
          this.setData({ messages: [], unreadCount: 0, hasMore: false, loading: false, loadingMore: false });
        } else {
          this.setData({ loadingMore: false });
        }
        if (!silent && errMsg.includes('登录')) {
          wx.showToast({ title: '请先登录后再查看', icon: 'none' });
        }
      }
    } catch (e) {
      console.error('加载消息列表异常:', e);
      if (!silent) {
        wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
      }
      this.setData({ loading: false, loadingMore: false });
    } finally {
      this._fetching = false;
    }
  },

  async viewMessage(e) {
    const id = e.currentTarget.dataset.id;
    const index = e.currentTarget.dataset.index;
    const message = this.data.messages[index];
    if (!message) return;

    const enriched = enrichMessage(message);

    if (message.isUnread) {
      try {
        await wx.cloud.callFunction({
          name: 'getUserMessages',
          data: { action: 'markRead', messageId: id }
        });

        const messages = [...this.data.messages];
        messages[index] = { ...messages[index], read: true, isUnread: false };
        const unreadCount = Math.max(0, this.data.unreadCount - 1);

        this.setData({
          messages,
          unreadCount,
          selectedMessage: { ...enriched, read: true, isUnread: false },
          showDetail: true
        });
        this.syncParentUnreadCount();
        trackBehavior('message_read', 'message', id, { category: message.category });
      } catch (err) {
        console.error('标记已读失败:', err);
        this.setData({ selectedMessage: enriched, showDetail: true });
      }
    } else {
      this.setData({ selectedMessage: enriched, showDetail: true });
    }
  },

  closeDetail() {
    this.setData({ showDetail: false });
  },

  handleAction() {
    const msg = this.data.selectedMessage;
    if (!msg || !msg.actionUrl) {
      this.closeDetail();
      return;
    }

    trackBehavior('message_action', 'message', msg._id, {
      category: msg.category,
      actionUrl: msg.actionUrl
    });

    this.closeDetail();
    wx.navigateTo({
      url: `/${msg.actionUrl}`,
      fail: () => {
        wx.showToast({ title: '页面暂不可用', icon: 'none' });
      }
    });
  },

  async markAllRead() {
    if (this.data.unreadCount === 0) {
      wx.showToast({ title: '没有未读消息', icon: 'none' });
      return;
    }

    try {
      wx.showLoading({ title: '处理中...' });
      const res = await wx.cloud.callFunction({
        name: 'getUserMessages',
        data: {
          action: 'markAllRead',
          category: this.data.activeCategory
        }
      });

      if (res && res.result && res.result.success) {
        const messages = this.data.messages.map((msg) => ({
          ...msg,
          read: true,
          isUnread: false
        }));
        const unreadCount = this.data.activeCategory === 'all'
          ? 0
          : messages.filter((m) => m.isUnread).length;

        this.setData({ messages, unreadCount });
        this.syncParentUnreadCount();
        wx.showToast({ title: '已全部标记为已读', icon: 'success' });
        trackBehavior('message_mark_all_read', 'category', this.data.activeCategory);
      } else {
        wx.showToast({ title: (res && res.result && res.result.msg) || '操作失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '操作失败，请稍后重试', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onLongPressDelete(e) {
    const index = e.currentTarget.dataset.index;
    const message = this.data.messages[index];
    if (!message || !message._id) return;

    wx.showModal({
      title: '删除消息',
      content: '确定删除这条消息吗？',
      confirmColor: '#C4A76C',
      success: (res) => {
        if (res.confirm) this.deleteMessageById(message._id, index);
      }
    });
  },

  async deleteMessage() {
    const message = this.data.selectedMessage;
    if (!message || !message._id) return;
    const index = this.data.messages.findIndex((m) => m._id === message._id);
    await this.deleteMessageById(message._id, index >= 0 ? index : null);
  },

  async deleteMessageById(messageId, index) {
    try {
      wx.showLoading({ title: '删除中...' });
      const res = await wx.cloud.callFunction({
        name: 'getUserMessages',
        data: { action: 'deleteMessage', messageId }
      });

      if (res && res.result && res.result.success) {
        let messages = this.data.messages.filter((m) => m._id !== messageId);
        const removed = this.data.messages.find((m) => m._id === messageId);
        const unreadCount = removed && removed.isUnread
          ? Math.max(0, this.data.unreadCount - 1)
          : this.data.unreadCount;

        this.setData({ messages, unreadCount, showDetail: false });
        this.syncParentUnreadCount();
        wx.showToast({ title: '已删除', icon: 'success' });
        trackBehavior('message_delete', 'message', messageId);
      } else {
        wx.showToast({ title: '删除失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  syncParentUnreadCount() {
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];
    if (prevPage && typeof prevPage.loadUnreadMessageCount === 'function') {
      prevPage.loadUnreadMessageCount();
    }
  },

  goBack() {
    wx.navigateBack();
  }
});
