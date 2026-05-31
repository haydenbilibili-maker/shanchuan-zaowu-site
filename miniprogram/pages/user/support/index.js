// pages/user/support/index.js
const app = getApp();
const {
  buildSessionFrom,
  buildSendMessage,
  buildContextSummary
} = require('../../../utils/supportHelper');
const { trackBehavior } = require('../../../utils/trackBehavior');

Page({
  data: {
    statusBarHeight: 0,
    headerHeight: 88,
    loading: true,
    config: {},
    topics: [],
    faqs: [],
    expandedFaq: -1,

    activeTopic: 'other',
    contextSummary: '',

    sessionFrom: '',
    sendMessageTitle: '联系专员 · 山海造物',
    sendMessagePath: '/pages/user/support/index',
    showMessageCard: true,

    orderId: '',
    orderNo: '',
    productId: '',
    productName: '',
    storeId: '',
    storeName: '',
    memberNo: '',

    messageText: '',
    contactPhone: '',
    submitting: false,
    showCommunity: false
  },

  onLoad(options) {
    try {
      const systemInfo = wx.getSystemInfoSync();
      const statusBarHeight = systemInfo.statusBarHeight || 0;
      this.setData({
        statusBarHeight,
        headerHeight: statusBarHeight + 72,
        activeTopic: options.topic || 'other',
        orderId: options.orderId || '',
        orderNo: options.orderNo || '',
        productId: options.productId || options.id || '',
        productName: options.productName ? decodeURIComponent(options.productName) : '',
        storeId: options.storeId || '',
        storeName: options.storeName ? decodeURIComponent(options.storeName) : ''
      });
    } catch (e) {
      this.setData({ statusBarHeight: 0, headerHeight: 72 });
    }

    this.loadConfig();
  },

  async loadConfig() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({ name: 'getSupportConfig' });
      const config = (res.result && res.result.config) || {};
      const memberNo = (app.globalData && app.globalData.memberNo) || this.data.memberNo;

      this.setData({
        config,
        topics: config.topics || [],
        faqs: config.faqs || [],
        memberNo,
        loading: false
      });

      if (this.data.storeId && !this.data.storeName) {
        try {
          const { findStore } = require('../../../utils/storeHelper')
          const store = findStore(this.data.storeId)
          this.setData({ storeName: store.name })
        } catch (e) {}
      }

      this.refreshContactContext();
    } catch (e) {
      console.error('loadConfig failed:', e);
      this.setData({ loading: false });
      wx.showToast({ title: '配置加载失败', icon: 'none' });
    }
  },

  refreshContactContext() {
    const ctx = {
      topic: this.data.activeTopic,
      orderId: this.data.orderId,
      orderNo: this.data.orderNo,
      productId: this.data.productId,
      productName: this.data.productName,
      memberNo: this.data.memberNo,
      storeId: this.data.storeId,
      storeName: this.data.storeName
    };

    const sendMsg = buildSendMessage(ctx);
    this.setData({
      contextSummary: buildContextSummary(ctx),
      sessionFrom: buildSessionFrom(ctx),
      sendMessageTitle: sendMsg.title,
      sendMessagePath: sendMsg.path
    });
  },

  selectTopic(e) {
    const topic = e.currentTarget.dataset.id;
    if (topic === this.data.activeTopic) return;
    this.setData({ activeTopic: topic });
    this.refreshContactContext();
    trackBehavior('support_topic_select', 'topic', topic);
  },

  toggleFaq(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({
      expandedFaq: this.data.expandedFaq === index ? -1 : index
    });
  },

  onMessageInput(e) {
    this.setData({ messageText: e.detail.value });
  },

  onPhoneInput(e) {
    this.setData({ contactPhone: e.detail.value });
  },

  callPhone() {
    const phone = this.data.config.phone;
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: phone });
    trackBehavior('support_call', 'phone', phone);
  },

  goMessages() {
    wx.navigateTo({ url: '/pages/user/messages/index?category=system' });
  },

  openCommunity() {
    this.setData({ showCommunity: true });
  },

  closeCommunity() {
    this.setData({ showCommunity: false });
  },

  openMap() {
    const { latitude, longitude, address } = this.data.config;
    if (!latitude || !longitude) return;
    wx.openLocation({
      latitude: Number(latitude),
      longitude: Number(longitude),
      name: '山海造物',
      address: address || '',
      scale: 18
    });
  },

  onContactTap() {
    trackBehavior('support_wechat_contact', 'topic', this.data.activeTopic, {
      orderId: this.data.orderId,
      productId: this.data.productId
    });
  },

  async submitTicket() {
    if (this.data.submitting) return;

    const message = (this.data.messageText || '').trim();
    if (message.length < 5) {
      wx.showToast({ title: '请至少输入 5 个字', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      wx.showLoading({ title: '提交中...' });
      const res = await wx.cloud.callFunction({
        name: 'submitSupportTicket',
        data: {
          topic: this.data.activeTopic,
          message,
          orderId: this.data.orderId,
          orderNo: this.data.orderNo,
          productId: this.data.productId,
          productName: this.data.productName,
          contactPhone: this.data.contactPhone
        }
      });

      if (res.result && res.result.success) {
        this.setData({ messageText: '' });
        wx.showToast({ title: '留言已提交', icon: 'success' });
        trackBehavior('support_ticket_submit', 'topic', this.data.activeTopic);
      } else {
        wx.showToast({
          title: (res.result && res.result.msg) || '提交失败',
          icon: 'none'
        });
      }
    } catch (e) {
      wx.showToast({ title: '提交失败，请稍后重试', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },

  goBack() {
    wx.navigateBack();
  }
});
