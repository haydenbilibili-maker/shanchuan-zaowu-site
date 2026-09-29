// subpackages/extra/user/messages/index.js
const { enrichMessage, dedupeInboxMessages } = require('../../../../utils/messageHelper');
const { buildDigestListCard } = require('../../utils/digestView');
const { getPageNavInsets } = require('../../utils/pageNav');
const { trackBehavior } = require('../../../../utils/trackBehavior');
const {
  workbenchEntries,
  resolveWorkspaceRole,
  isSuperAdminOpenid
} = require('../../../../utils/workspaceRoles');
const { fetchUserSession } = require('../../../../utils/userSession');

const CUSTOMER_FILTER_TABS = [
  { id: 'all', label: '全部' },
  { id: 'booking', label: '约访' },
  { id: 'order', label: '藏品' },
  { id: 'custom', label: '定制' },
  { id: 'activity', label: '馆讯' },
  { id: 'system', label: '馆务' }
];

/**
 * 工作信息分档：与「待办」「审批」并列的第三档 = 日报。
 * id 直接就是云端消息的 `category`（getUserMessages 按 category 精确匹配过滤），
 * 所以这里加一行就等于给日报开了一档，并以同一列表分页回看历史日报。
 */
const WORKFLOW_FILTER_TABS = [
  { id: 'all', label: '全部' },
  { id: 'digest', label: '日报' },
  { id: 'ops', label: '待办' },
  { id: 'system', label: '审批' }
];

const EMPTY_COPY = {
  customer: {
    all: { title: '信箱还是空的', desc: '藏品启程、约访回执与馆讯，都会落在这里' },
    booking: { title: '暂无约访来信', desc: '预约确认、行前提醒与核销回执会放在这一类' },
    order: { title: '暂无藏品来信', desc: '入账、启程与入柜的进度会放在这一类' },
    custom: { title: '暂无定制来信', desc: '工单进度与专员跟进会放在这一类' },
    activity: { title: '暂无馆讯', desc: '活动、礼包、养护与开播提醒会放在这一类' },
    system: { title: '暂无馆务来信', desc: '留言回执与开票进度会放在这一类' }
  },
  workflow: {
    all: { title: '工作台暂无来信', desc: '日报、待办与审批会按分类出现在上方分档；有未读时角标会亮起' },
    digest: {
      title: '暂无日报',
      desc: '每天自动生成经营日报，归档在这里，可回看约 90 天。'
    },
    ops: { title: '暂无运营待办', desc: '新单启程与藏家候补会放在这一类' },
    system: { title: '暂无审批来信', desc: '审批提交与结果会放在这里' }
  }
};

const WORKFLOW_CONTEXT = {
  all: '工作信息 · 仅员工可见',
  digest: '日报 · 定时快照 · 可回看历史',
  ops: '待办 · 需跟进的运营事项',
  system: '审批 · 提交与结果通知'
};

const DETAIL_URL = '/subpackages/extra/user/messages/detail/index';

function withDigestCard(message) {
  const enriched = enrichMessage(message);
  if (!enriched || !enriched.isDigest) return enriched;
  const digestCard = buildDigestListCard(enriched);
  // getUserMessages 未放行 payload / 线上旧函数 → 只有纯文本：必须诚实标出，不能装成「没生意」
  if (!digestCard) {
    return {
      ...enriched,
      digestCard: null,
      digestPayloadMissing: true,
      preview: enriched.preview || '本期只有文字摘要'
    };
  }
  return {
    ...enriched,
    digestCard,
    digestPayloadMissing: false,
    // 有结构化卡时，列表预览让位给关键数，避免纯文本与数字抢视线
    preview: digestCard.hasHighlights ? '' : (enriched.preview || digestCard.statusHint)
  };
}

/** 日报档顶栏提示：基于列表首条（通常最新）的健康态，不另打云端 */
function buildDigestRailTip(messages, unreadCount) {
  const list = Array.isArray(messages) ? messages : [];
  const digests = list.filter((m) => m && m.isDigest);
  if (!digests.length) {
    return {
      show: true,
      tone: 'muted',
      text: '日报每天自动生成，归档在这里，可回看历史。'
    };
  }
  const top = digests[0];
  const unread = Math.max(0, Number(unreadCount) || 0);
  if (top.digestPayloadMissing) {
    return {
      show: true,
      tone: 'warn',
      text: '最新一期只有文字摘要。'
    };
  }
  const card = top.digestCard || {};
  const dayBit = card.dayLabel || card.dayKey || '最新一期';
  if (card.healthTone === 'failed') {
    return {
      show: true,
      tone: 'warn',
      text: `${dayBit} · ${card.statusHint || '取数异常'}。点开可对账失败项。`
    };
  }
  const unreadBit = unread > 0 ? `${unread} 封未读 · ` : '';
  return {
    show: true,
    tone: card.healthTone === 'partial' ? 'partial' : 'ok',
    text: `${unreadBit}${dayBit} · ${card.statusHint || '快照可回看'}`
  };
}

function tabsWithBadges(baseTabs, badgeMap) {
  const map = badgeMap || {};
  return (baseTabs || []).map((t) => {
    const n = t.id === 'all' ? 0 : Math.max(0, Number(map[t.id]) || 0);
    return {
      ...t,
      badge: n,
      badgeText: n > 99 ? '99+' : String(n),
      hasBadge: n > 0
    };
  });
}

Page({
  data: {
    navPaddingRight: 16,
    headerHeight: 88,
    loading: true,
    loadError: false,
    loadingMore: false,
    refreshing: false,
    messages: [],
    unreadCount: 0,
    customerUnread: 0,
    workflowUnread: 0,
    categoryBadges: { digest: 0, ops: 0, system: 0 },
    isStaff: false,
    showQueueTabs: false,
    workflowMode: false,
    activeQueue: 'customer',
    filterTabs: CUSTOMER_FILTER_TABS,
    activeCategory: 'all',
    emptyCopy: EMPTY_COPY.customer.all,
    workflowContextText: WORKFLOW_CONTEXT.all,
    digestRailTip: { show: false, tone: 'muted', text: '' },
    hasMore: true,
    page: 0
  },

  onLoad(options) {
    const queueOpt = String(options.queue || '').trim();
    const fromOpt = String(options.from || '').trim();
    const workflowMode = queueOpt === 'workflow';

    try {
      const nav = getPageNavInsets({ nativeNav: true, headerExtraRpx: workflowMode ? 200 : 168 });
      this.setData({
        navPaddingRight: Math.min(nav.navPaddingRight || 16, 24),
        headerHeight: nav.headerBlockPx || this.estimateHeaderHeight()
      });
    } catch (e) {
      this.setData({ headerHeight: this.estimateHeaderHeight() });
    }

    const categoryOpt = String(options.category || '').trim();
    if (workflowMode) {
      wx.setNavigationBarTitle({ title: '工作信息' });
      this.setData({
        activeQueue: 'workflow',
        workflowMode: true,
        showQueueTabs: false,
        filterTabs: tabsWithBadges(WORKFLOW_FILTER_TABS, {}),
        emptyCopy: EMPTY_COPY.workflow.all,
        workflowContextText: WORKFLOW_CONTEXT.all
      });
    } else {
      wx.setNavigationBarTitle({ title: '山海有信' });
      this.setData({
        activeQueue: 'customer',
        workflowMode: false,
        showQueueTabs: false,
        filterTabs: CUSTOMER_FILTER_TABS,
        emptyCopy: EMPTY_COPY.customer.all
      });
    }
    if (categoryOpt) {
      const tabs = workflowMode ? WORKFLOW_FILTER_TABS : CUSTOMER_FILTER_TABS;
      if (tabs.some((t) => t.id === categoryOpt)) {
        this.setData({
          activeCategory: categoryOpt,
          emptyCopy: this.resolveEmptyCopy(
            workflowMode ? 'workflow' : 'customer',
            categoryOpt
          ),
          workflowContextText: workflowMode
            ? (WORKFLOW_CONTEXT[categoryOpt] || WORKFLOW_CONTEXT.all)
            : WORKFLOW_CONTEXT.all
        });
      }
    }

    this._fromWorkbench = fromOpt === 'workbench';

    const letterId = String(options.messageId || options.id || options.msgId || '').trim();
    this.resolveStaffRole().then(() => {
      if (workflowMode) {
        this.loadCategoryBadges();
        this.loadMessages(true);
      } else {
        this.loadUnreadBreakdown();
        this.loadMessages(true);
      }
    });
    this.measureHeader();

    if (letterId) {
      this.openLetterPage({ _id: letterId });
    }
  },

  onReady() {
    this.measureHeader();
  },

  resolveEmptyCopy(queue, category) {
    const bag = EMPTY_COPY[queue] || EMPTY_COPY.customer;
    return bag[category] || bag.all;
  },

  estimateHeaderHeight() {
    let windowWidth = 375;
    try {
      const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      windowWidth = sys.windowWidth || 375;
    } catch (e) {}
    const px = windowWidth / 750;
    return Math.ceil((this.data.isStaff ? 240 : 168) * px);
  },

  measureHeader() {
    const apply = () => {
      wx.createSelectorQuery()
        .in(this)
        .select('.sticky-header')
        .boundingClientRect((rect) => {
          if (rect && rect.height) {
            this.setData({ headerHeight: Math.ceil(rect.height) });
          }
        })
        .exec();
    };
    wx.nextTick(apply);
    setTimeout(apply, 80);
  },

  async resolveStaffRole() {
    try {
      const app = getApp();
      const openid = (app && app.globalData && app.globalData.openid) || '';
      let payload = {};
      try {
        const session = await fetchUserSession(app);
        payload = (session && session.stats) || session || {};
        if (session && session.isSuperAdmin) payload.isSuperAdmin = true;
        if (session && Array.isArray(session.roles)) payload.roles = session.roles;
        if (session && session.workspaceRole) payload.workspaceRole = session.workspaceRole;
        if (session && session.staffRole) payload.staffRole = session.staffRole;
      } catch (e) {
        payload = {};
      }
      if (isSuperAdminOpenid(openid)) {
        payload.isSuperAdmin = true;
      }
      const entries = workbenchEntries(payload);
      const resolved = resolveWorkspaceRole(payload);
      const isStaff = entries.length > 0 || !!resolved;
      const patch = { isStaff, showQueueTabs: false };
      if (this.data.workflowMode && !isStaff) {
        patch.workflowMode = false;
        patch.activeQueue = 'customer';
        patch.filterTabs = CUSTOMER_FILTER_TABS;
        patch.emptyCopy = EMPTY_COPY.customer.all;
        patch.workflowContextText = WORKFLOW_CONTEXT.all;
        wx.setNavigationBarTitle({ title: '山海有信' });
        wx.showToast({ title: '工作信息仅员工可见', icon: 'none' });
      }
      this.setData(patch);
      return isStaff;
    } catch (e) {
      this.setData({ isStaff: false });
      return false;
    }
  },

  onShow() {
    if (this._hasLoaded) {
      this.loadUnreadBreakdown();
      if (this.data.workflowMode) this.loadCategoryBadges();
      this.loadMessages(true, { silent: true });
    }
  },

  onPullDownRefresh() {
    const tasks = [this.loadUnreadBreakdown(), this.loadMessages(true)];
    if (this.data.workflowMode) tasks.push(this.loadCategoryBadges());
    Promise.all(tasks).then(() => wx.stopPullDownRefresh());
  },

  onRefresh() {
    this.setData({ refreshing: true });
    const tasks = [this.loadUnreadBreakdown(), this.loadMessages(true)];
    if (this.data.workflowMode) tasks.push(this.loadCategoryBadges());
    Promise.all(tasks).then(() => this.setData({ refreshing: false }));
  },

  retryLoad() {
    this.setData({ loadError: false });
    this.loadMessages(true);
    if (this.data.workflowMode) this.loadCategoryBadges();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadMessages(false);
    }
  },

  switchQueue(e) {
    const queue = e.currentTarget.dataset.queue;
    if (!queue || queue === this.data.activeQueue) return;
    if (queue === 'workflow' && !this.data.isStaff) {
      wx.showToast({ title: '工作流仅员工可见', icon: 'none' });
      return;
    }
    const filterTabs = queue === 'workflow'
      ? tabsWithBadges(WORKFLOW_FILTER_TABS, this.data.categoryBadges)
      : CUSTOMER_FILTER_TABS;
    this.setData({
      activeQueue: queue,
      filterTabs,
      activeCategory: 'all',
      page: 0,
      hasMore: true,
      emptyCopy: this.resolveEmptyCopy(queue, 'all'),
      workflowContextText: WORKFLOW_CONTEXT.all
    });
    this.loadMessages(true);
    if (queue === 'workflow') this.loadCategoryBadges();
    this.measureHeader();
    trackBehavior('message_queue', 'queue', queue);
  },

  switchCategory(e) {
    const category = e.currentTarget.dataset.id;
    if (category === this.data.activeCategory) return;
    this.setData({
      activeCategory: category,
      page: 0,
      hasMore: true,
      emptyCopy: this.resolveEmptyCopy(this.data.activeQueue, category),
      workflowContextText: this.data.workflowMode
        ? (WORKFLOW_CONTEXT[category] || WORKFLOW_CONTEXT.all)
        : WORKFLOW_CONTEXT.all,
      digestRailTip: category === 'digest'
        ? { show: true, tone: 'muted', text: '正在取日报…' }
        : { show: false, tone: 'muted', text: '' }
    });
    this.loadMessages(true);
    this.measureHeader();
    trackBehavior('message_filter', 'category', category);
  },

  async loadUnreadBreakdown() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserMessages',
        data: { action: 'getUnreadBreakdown' }
      });
      const result = (res && res.result) || {};
      if (!result.success) return;
      const isStaff = !!result.isStaff || this.data.isStaff;
      this.setData({
        isStaff,
        customerUnread: Number(result.customer) || 0,
        workflowUnread: isStaff ? (Number(result.workflow) || 0) : 0
      });
    } catch (e) {
      // ignore
    }
  },

  /**
   * 工作信息三分档未读角标（复用既有 getUnreadCount + category，不改云函数契约）。
   */
  async loadCategoryBadges() {
    if (!this.data.workflowMode && this.data.activeQueue !== 'workflow') return;
    const cats = ['digest', 'ops', 'system'];
    try {
      const results = await Promise.all(
        cats.map((category) =>
          wx.cloud
            .callFunction({
              name: 'getUserMessages',
              data: { action: 'getUnreadCount', queue: 'workflow', category }
            })
            .catch(() => null)
        )
      );
      const categoryBadges = { digest: 0, ops: 0, system: 0 };
      cats.forEach((category, i) => {
        const result = results[i] && results[i].result;
        if (result && result.success) {
          categoryBadges[category] = Math.max(
            0,
            Number(result.count != null ? result.count : result.unreadCount) || 0
          );
        }
      });
      this.setData({
        categoryBadges,
        filterTabs: tabsWithBadges(WORKFLOW_FILTER_TABS, categoryBadges)
      });
      this.measureHeader();
    } catch (e) {
      // ignore
    }
  },

  async loadMessages(reset = false, options = {}) {
    const { silent = false } = options;
    if (this._fetching) return;
    if (!reset && !this.data.hasMore) return;

    this._fetching = true;
    const page = reset ? 0 : this.data.page + 1;

    if (reset && !silent) {
      this.setData({ loading: true, loadError: false });
    } else if (!reset) {
      this.setData({ loadingMore: true });
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserMessages',
        data: {
          action: 'getMessages',
          category: this.data.activeCategory,
          queue: this.data.activeQueue,
          page,
          pageSize: 20
        }
      });

      if (res && res.result && res.result.success) {
        const raw = Array.isArray(res.result.messages) ? res.result.messages : [];
        const batch = dedupeInboxMessages(raw).map(withDigestCard);
        const merged = reset ? batch : [...this.data.messages, ...batch];
        const messages = dedupeInboxMessages(merged);
        const isStaff = res.result.isStaff === true || this.data.isStaff;

        const patch = {
          messages,
          unreadCount: res.result.unreadCount ?? messages.filter((m) => m.isUnread).length,
          hasMore: !!res.result.hasMore,
          page,
          loading: false,
          loadingMore: false,
          loadError: false,
          isStaff
        };
        if (this.data.activeQueue === 'customer') {
          patch.customerUnread = patch.unreadCount;
        } else if (this.data.activeQueue === 'workflow') {
          patch.workflowUnread = patch.unreadCount;
        }
        if (this.data.activeCategory === 'digest' || this.data.workflowMode) {
          patch.digestRailTip = this.data.activeCategory === 'digest'
            ? buildDigestRailTip(messages, patch.unreadCount)
            : { show: false, tone: 'muted', text: '' };
        }
        this.setData(patch);
        this._hasLoaded = true;
        this.measureHeader();
      } else {
        const errMsg = (res && res.result && res.result.msg) || '加载失败';
        if (reset) {
          this.setData({
            messages: [],
            unreadCount: 0,
            hasMore: false,
            loading: false,
            loadingMore: false,
            loadError: true,
            digestRailTip: this.data.activeCategory === 'digest'
              ? { show: true, tone: 'warn', text: '日报列表加载失败，请下拉或点「再试一次」。' }
              : { show: false, tone: 'muted', text: '' }
          });
        } else {
          this.setData({ loadingMore: false });
        }
        if (!silent) {
          wx.showToast({
            title: errMsg.includes('登录') ? '请先登录后再查看' : '加载失败，请稍后重试',
            icon: 'none'
          });
        }
      }
    } catch (e) {
      console.error('加载消息列表异常:', e);
      if (!silent) {
        wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
      }
      this.setData({ loading: false, loadingMore: false, loadError: reset ? true : this.data.loadError });
    } finally {
      this._fetching = false;
    }
  },

  viewMessage(e) {
    const index = e.currentTarget.dataset.index;
    const message = this.data.messages[index];
    if (!message) return;
    this.openLetterPage(message);
  },

  openLetterPage(message) {
    const id = message && (message._id || message.id);
    if (!id) return;
    if (this._openingLetter) return;
    this._openingLetter = true;

    wx.navigateTo({
      url: `${DETAIL_URL}?id=${encodeURIComponent(id)}`,
      success: (res) => {
        this._openingLetter = false;
        if (res.eventChannel && message.title) {
          res.eventChannel.emit('letter', message);
        }
      },
      fail: () => {
        this._openingLetter = false;
        wx.showToast({ title: '无法打开来信', icon: 'none' });
      }
    });
  },

  applyLocalRead(messageId) {
    if (!messageId) return;
    const index = this.data.messages.findIndex((m) => m._id === messageId || m._altId === messageId);
    if (index < 0) return;
    const current = this.data.messages[index];
    if (!current.isUnread) return;
    const messages = [...this.data.messages];
    messages[index] = withDigestCard({ ...current, read: true });
    const unreadCount = Math.max(0, this.data.unreadCount - 1);
    const patch = {
      messages,
      unreadCount
    };
    if (this.data.activeQueue === 'customer') {
      patch.customerUnread = Math.max(0, this.data.customerUnread - 1);
    } else {
      patch.workflowUnread = Math.max(0, this.data.workflowUnread - 1);
      const cat = current.category;
      if (cat && this.data.categoryBadges[cat] != null) {
        const categoryBadges = {
          ...this.data.categoryBadges,
          [cat]: Math.max(0, (Number(this.data.categoryBadges[cat]) || 0) - 1)
        };
        patch.categoryBadges = categoryBadges;
        patch.filterTabs = tabsWithBadges(WORKFLOW_FILTER_TABS, categoryBadges);
      }
    }
    this.setData(patch);
    if (this.data.activeCategory === 'digest') {
      this.setData({
        digestRailTip: buildDigestRailTip(patch.messages || this.data.messages, patch.unreadCount)
      });
    }
    this.syncParentUnreadCount();
  },

  applyLocalDelete(messageId) {
    if (!messageId) return;
    const removed = this.data.messages.find((m) => m._id === messageId || m._altId === messageId);
    const messages = this.data.messages.filter((m) => m._id !== messageId && m._altId !== messageId);
    const unreadCount = removed && removed.isUnread
      ? Math.max(0, this.data.unreadCount - 1)
      : this.data.unreadCount;
    const patch = { messages, unreadCount };
    if (removed && removed.isUnread) {
      if (this.data.activeQueue === 'customer') {
        patch.customerUnread = Math.max(0, this.data.customerUnread - 1);
      } else {
        patch.workflowUnread = Math.max(0, this.data.workflowUnread - 1);
        const cat = removed.category;
        if (cat && this.data.categoryBadges[cat] != null) {
          const categoryBadges = {
            ...this.data.categoryBadges,
            [cat]: Math.max(0, (Number(this.data.categoryBadges[cat]) || 0) - 1)
          };
          patch.categoryBadges = categoryBadges;
          patch.filterTabs = tabsWithBadges(WORKFLOW_FILTER_TABS, categoryBadges);
        }
      }
    }
    this.setData(patch);
    if (this.data.activeCategory === 'digest') {
      this.setData({
        digestRailTip: buildDigestRailTip(messages, unreadCount)
      });
    }
    this.syncParentUnreadCount();
  },

  onLongPressDelete(e) {
    const index = e.currentTarget.dataset.index;
    const message = this.data.messages[index];
    if (!message || !message._id) return;

    if (message.isDigest) {
      const itemList = ['复制关键摘要', '删除本期日报'];
      wx.showActionSheet({
        itemList,
        success: (res) => {
          if (res.tapIndex === 0) {
            this.copyDigestSummary(message);
            return;
          }
          if (res.tapIndex === 1) {
            wx.showModal({
              title: '删除日报',
              content: '确定从工作信息里拿掉这一期日报吗？历史快照删除后不可从本机恢复。',
              confirmColor: '#C4A76C',
              success: (modalRes) => {
                if (modalRes.confirm) this.deleteMessageById(message._id);
              }
            });
          }
        }
      });
      return;
    }

    wx.showModal({
      title: '删除来信',
      content: '确定从信箱里拿掉这一封吗？',
      confirmColor: '#C4A76C',
      success: (res) => {
        if (res.confirm) this.deleteMessageById(message._id);
      }
    });
  },

  copyDigestSummary(message) {
    const text = (message && message.digestCard && message.digestCard.copyText)
      || [message && message.title, message && message.preview].filter(Boolean).join('\n');
    if (!text) {
      wx.showToast({ title: '暂无可复制摘要', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制摘要', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    });
  },

  async deleteMessageById(messageId) {
    try {
      wx.showLoading({ title: '删除中' });
      const res = await wx.cloud.callFunction({
        name: 'getUserMessages',
        data: { action: 'deleteMessage', messageId }
      });

      if (res && res.result && res.result.success) {
        this.applyLocalDelete(messageId);
        wx.showToast({ title: '已删除', icon: 'none' });
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

  async markAllRead() {
    if (this.data.unreadCount === 0) {
      wx.showToast({
        title: this.data.activeCategory === 'digest' ? '没有未读日报' : '没有未读来信',
        icon: 'none'
      });
      return;
    }

    try {
      wx.showLoading({ title: '处理中' });
      const res = await wx.cloud.callFunction({
        name: 'getUserMessages',
        data: {
          action: 'markAllRead',
          category: this.data.activeCategory,
          queue: this.data.activeQueue
        }
      });

      if (res && res.result && res.result.success) {
        const messages = this.data.messages.map((msg) => withDigestCard({
          ...msg,
          read: true
        }));

        const patch = { messages, unreadCount: 0 };
        if (this.data.activeQueue === 'customer') {
          patch.customerUnread = 0;
        } else {
          patch.workflowUnread = 0;
          const cat = this.data.activeCategory;
          const categoryBadges = { ...this.data.categoryBadges };
          if (cat === 'all') {
            categoryBadges.digest = 0;
            categoryBadges.ops = 0;
            categoryBadges.system = 0;
          } else if (categoryBadges[cat] != null) {
            categoryBadges[cat] = 0;
          }
          patch.categoryBadges = categoryBadges;
          patch.filterTabs = tabsWithBadges(WORKFLOW_FILTER_TABS, categoryBadges);
        }
        this.setData(patch);
        this.syncParentUnreadCount();
        wx.showToast({ title: '已全部读过', icon: 'none' });
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

  syncParentUnreadCount() {
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];
    if (prevPage && typeof prevPage.loadUnreadMessageCount === 'function') {
      prevPage.loadUnreadMessageCount();
    }
    if (prevPage && typeof prevPage.loadWorkbenchBadges === 'function') {
      prevPage.loadWorkbenchBadges({ force: true });
    }
    try {
      const app = getApp();
      if (app && app.globalData) app.globalData.forceWorkbenchBadgeRefresh = true;
    } catch (e) { /* ignore */ }
  }
});
