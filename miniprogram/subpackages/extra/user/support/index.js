// subpackages/extra/user/support/index.js
const app = getApp();
const {
  buildSessionFrom,
  buildSendMessage,
  buildContextSummary,
  buildContextCard,
  buildLeaveMessageDraft,
  pickProductFromOrder
} = require('../../utils/supportHelper');
const { trackBehavior } = require('../../../../utils/trackBehavior');
const { getPageNavInsets } = require('../../utils/pageNav');
const { getFirstImage, batchTempFileURLs } = require('../../../../utils/util');

/** 含主行 + 发送卡片提示行；与 .context-strip 实际高度对齐 */
const CONTEXT_STRIP_RPX = 220;

const FALLBACK_CONFIG = {
  phone: '19917242871',
    hours: '上午10点至下午5点',
    responseHint: '专员通常在服务时间内 30 分钟内回复',
  address: '吉林省长春市朝阳区红旗街959号这有山商场山坡X-06-1',
  latitude: 43.86661,
  longitude: 125.29306,
  // 微信助手个人名片码；与 assets/qrcode/wechat-assistant-qr.png 保持同步
  communityQr: '/assets/qrcode/wechat-assistant-qr.png',
  topics: [
    { id: 'order', label: '订单咨询', desc: '支付、物流、售后', icon: '/assets/icons/cart.png' },
    { id: 'booking', label: '预约改期', desc: '到店预约与变更', icon: '/assets/icons/calendar_gold.png' },
    { id: 'product', label: '藏品鉴赏', desc: '选品与规格咨询', icon: '/assets/icons/knowledge.png' },
    { id: 'custom', label: '标本定制', desc: '标本工坊与伴宠记忆', icon: '/assets/icons/gift.png' },
    { id: 'specimen_care', label: '标本养护', desc: '安放、清洁与异常咨询', icon: '/assets/icons/care.png' },
    { id: 'pet_memorial', label: '伴宠记忆', desc: '宠物藏品制作意向', icon: '/assets/icons/knowledge.png' },
    { id: 'identify', label: '鉴定疑问', desc: 'AI 鉴定结果咨询', icon: '/assets/icons/camera.png' },
    { id: 'refund', label: '售后退款', desc: '退款进度与凭证', icon: '/assets/icons/discount.png' },
    { id: 'invoice', label: '发票开具', desc: '电子发票与抬头', icon: '/assets/icons/coupon.png' },
    { id: 'other', label: '其他问题', desc: '品牌与合作等', icon: '/assets/icons/message.png' },
    { id: 'framer_recruit', label: '标本师招募', desc: '合作意向与分成咨询', icon: '/subpackages/feature/assets/icons/edit.png' }
  ],
  faqs: [
    {
      q: '如何开具发票？',
      a: '下单支付后如需电子发票，请进入「联系专员」选择「发票开具」，在开票申请页选择对应订单并填写抬头信息。专员处理后将电子发票发送至邮箱/微信。'
    },
    {
      q: '退款规则是怎样的？',
      a: '定制藏品不接受退款。孤品与镇店之宝因藏品特性与珍藏价值，物流运送难免产生不可逆损耗；如需退款，扣除货款 30% 作为运输损耗。伴宠订单一经发出，不接受非物流原因退款，并以顺丰保价寄出。现货藏品发货前可申请退款。'
    }
  ]
};

function safeDecode(value) {
  if (!value) return '';
  const raw = String(value);
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
}

/** 云函数优先；失败时直读 support_configs；再失败用本地默认（不抛错） */
async function fetchSupportConfig() {
  if (wx.cloud && typeof wx.cloud.callFunction === 'function') {
    try {
      const res = await wx.cloud.callFunction({ name: 'getSupportConfig' });
      const result = (res && res.result) || {};
      if (result.config && typeof result.config === 'object') {
        return result.config;
      }
    } catch (e) {
      console.warn('getSupportConfig callFunction failed:', e);
    }
  }

  if (wx.cloud && typeof wx.cloud.database === 'function') {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('support_configs').where({ status: 'active' }).limit(20).get();
      const rows = (res.data || []).slice().sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
      if (rows[0] && rows[0].config && typeof rows[0].config === 'object') {
        return { ...FALLBACK_CONFIG, ...rows[0].config };
      }
    } catch (e) {
      console.warn('support_configs db fallback failed:', e);
    }
  }

  return { ...FALLBACK_CONFIG };
}

Page({
  data: {
    statusBarHeight: 0,
    navPaddingRight: 96,
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
    sendMessagePath: '/subpackages/extra/user/support/index',
    sendMessageImg: '',
    showMessageCard: true,
    hasConsultContext: false,
    contextCard: {
      visible: false,
      kind: '',
      kindLabel: '',
      title: '',
      subtitle: '',
      tip: '',
      image: '',
      tapPath: '',
      actionLabel: '查看'
    },
    scrollTop: 88,
    contextStripHeight: 0,

    orderId: '',
    orderNo: '',
    productId: '',
    productName: '',
    productImage: '',
    productImageUrl: '',
    productCount: 0,
    storeId: '',
    storeName: '',
    memberNo: '',

    messageText: '',
    contactPhone: '',
    submitting: false,
    showCommunity: false,
    _draftApplied: false
  },

  onLoad(options) {
    const topic = options.topic || 'other';
    const orderId = options.orderId || '';
    const orderNo = options.orderNo || '';

    // topic=invoice：跳转独立开票页（保留 URL 预填）
    if (topic === 'invoice') {
      const qs = [];
      if (orderId) qs.push(`orderId=${encodeURIComponent(orderId)}`);
      if (orderNo) qs.push(`orderNo=${encodeURIComponent(orderNo)}`);
      const url =
        '/subpackages/extra/user/invoice-request/index' +
        (qs.length ? `?${qs.join('&')}` : '');
      wx.redirectTo({
        url,
        fail: () =>
          wx.navigateTo({
            url,
            fail: () => wx.showToast({ title: '无法打开开票页', icon: 'none' })
          })
      });
      return;
    }

    // topic=framer_recruit：跳转标本师招募页
    if (topic === 'framer_recruit') {
      const url = '/subpackages/business/framer-recruit/index?from=support';
      wx.redirectTo({
        url,
        fail: () =>
          wx.navigateTo({
            url,
            fail: () => wx.showToast({ title: '无法打开招募页', icon: 'none' })
          })
      });
      return;
    }

    const productName = safeDecode(options.productName);
    const storeName = safeDecode(options.storeName);
    const productImage = safeDecode(options.productImage || options.image || '');
    const base = {
      activeTopic: topic,
      orderId,
      orderNo,
      productId: options.productId || options.id || '',
      productName,
      productImage,
      productCount: Number(options.productCount) || 0,
      storeId: options.storeId || '',
      storeName
    };

    try {
      const nav = getPageNavInsets({ headerExtraRpx: 24, nativeNav: true });
      const headerHeight = nav.statusBarHeight + 72;
      this.setData({
        statusBarHeight: nav.statusBarHeight,
        navPaddingRight: nav.navPaddingRight,
        headerHeight,
        scrollTop: headerHeight,
        ...base
      });
    } catch (e) {
      this.setData({
        statusBarHeight: 0,
        navPaddingRight: 96,
        headerHeight: 72,
        scrollTop: 72,
        ...base
      });
    }

    this.refreshContactContext();
    this.loadConfig();
    this.enrichConsultContext();
  },

  async loadConfig() {
    this.setData({ loading: true });
    try {
      const config = await fetchSupportConfig();
      const memberNo = (app.globalData && app.globalData.memberNo) || this.data.memberNo;
      let topics = Array.isArray(config.topics) && config.topics.length
        ? config.topics.slice()
        : FALLBACK_CONFIG.topics.slice();
      const ensureTopic = (id) => {
        if (topics.some((t) => t && t.id === id)) return;
        const extra = FALLBACK_CONFIG.topics.find((t) => t.id === id);
        if (extra) topics.push(extra);
      };
      ensureTopic('invoice');
      ensureTopic('framer_recruit');
      const active = this.data.activeTopic;
      if (active) ensureTopic(active);

      // 本地文案覆盖：标本师招募入口统一跳转招募页
      topics = topics.map((t) => {
        if (t && t.id === 'framer_recruit') {
          const local = FALLBACK_CONFIG.topics.find((x) => x.id === 'framer_recruit');
          return local ? { ...t, label: local.label, desc: local.desc, icon: local.icon } : t;
        }
        return t;
      });

      const remoteFaqs = Array.isArray(config.faqs) ? config.faqs : [];
      const faqs = remoteFaqs.length
        ? (() => {
            const fallbackInvoice = FALLBACK_CONFIG.faqs.find((f) => /发票/.test(f.q));
            let hasInvoiceFaq = false;
            const list = remoteFaqs.map((f) => {
              if (/发票/.test((f && f.q) || '')) {
                hasInvoiceFaq = true;
                return fallbackInvoice || f;
              }
              return f;
            });
            if (!hasInvoiceFaq && fallbackInvoice) list.unshift(fallbackInvoice);
            return list;
          })()
        : FALLBACK_CONFIG.faqs;

      this.setData({
        config: {
          ...FALLBACK_CONFIG,
          ...config,
          // 群二维码有时效，以本地 assets 为准，避免云配置旧图覆盖
          communityQr: FALLBACK_CONFIG.communityQr,
          // 服务时间以云端 support_configs.hours 为准（超管可在后台修改）
          hours: config.hours || FALLBACK_CONFIG.hours
        },
        topics,
        faqs,
        memberNo,
        loading: false
      });

      if (this.data.storeId && !this.data.storeName) {
        try {
          const { fetchStoreCatalog, findCatalogStore } = require('../../../../utils/storeCatalog');
          const { displayStoreName } = require('../../../../utils/storeName');
          const stores = await fetchStoreCatalog();
          const store = findCatalogStore(this.data.storeId, stores);
          if (store) this.setData({ storeName: displayStoreName(store) });
        } catch (e) {}
      }

      this.refreshContactContext();
    } catch (e) {
      console.warn('loadConfig fallback to local defaults:', e);
      this.setData({
        loading: false,
        config: FALLBACK_CONFIG,
        topics: FALLBACK_CONFIG.topics,
        faqs: FALLBACK_CONFIG.faqs
      });
      this.refreshContactContext();
      // 本地默认配置已覆盖主路径，不弹错误 toast，避免商详进客服误报
    }
  },

  refreshContactContext() {
    const ctx = {
      topic: this.data.activeTopic,
      orderId: this.data.orderId,
      orderNo: this.data.orderNo,
      productId: this.data.productId,
      productName: this.data.productName,
      productImage: this.data.productImage,
      productImageUrl: this.data.productImageUrl,
      productCount: this.data.productCount,
      memberNo: this.data.memberNo,
      storeId: this.data.storeId,
      storeName: this.data.storeName
    };

    const sendMsg = buildSendMessage(ctx);
    const contextCard = buildContextCard(ctx);
    const hasConsultContext = !!(ctx.orderId || ctx.orderNo || ctx.productId || ctx.productName);
    const draft = buildLeaveMessageDraft(ctx);
    const patch = {
      contextSummary: buildContextSummary(ctx),
      sessionFrom: buildSessionFrom(ctx),
      sendMessageTitle: sendMsg.title,
      sendMessagePath: sendMsg.path,
      sendMessageImg: sendMsg.img || '',
      showMessageCard: true,
      hasConsultContext,
      contextCard
    };

    if (draft && !this.data._draftApplied && !(this.data.messageText || '').trim()) {
      patch.messageText = draft;
      patch._draftApplied = true;
      patch._draftPrefix = draft.trim();
    }

    this.setData(patch);
    this.updateScrollOffset(contextCard.visible);
  },

  updateScrollOffset(hasStrip) {
    const headerHeight = this.data.headerHeight || 72;
    let stripPx = 0;
    if (hasStrip) {
      try {
        const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const w = Number(win.windowWidth) || 375;
        stripPx = Math.round((CONTEXT_STRIP_RPX * w) / 750);
      } catch (e) {
        stripPx = 60;
      }
    }
    this.setData({
      contextStripHeight: stripPx,
      scrollTop: headerHeight + stripPx
    });
  },

  async resolveImageUrl(src) {
    if (!src) return '';
    const raw = String(src).trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('cloud://') && wx.cloud) {
      try {
        const map = await batchTempFileURLs([raw]);
        if (map[raw]) return map[raw];
        const res = await wx.cloud.getTempFileURL({ fileList: [raw] });
        const row = res && res.fileList && res.fileList[0];
        return (row && row.tempFileURL) || '';
      } catch (e) {
        console.warn('support resolveImageUrl failed:', e);
        return '';
      }
    }
    return raw;
  },

  async enrichConsultContext() {
    const needOrder = !!this.data.orderId;
    const needProductLookup = !!(this.data.productId || needOrder);

    if (!needOrder && !this.data.productId && this.data.productImage && !this.data.productImageUrl) {
      const url = await this.resolveImageUrl(this.data.productImage);
      if (url) {
        this.setData({ productImageUrl: url });
        this.refreshContactContext();
      }
      return;
    }

    if (!needProductLookup && !this.data.productImage) {
      this.refreshContactContext();
      return;
    }

    if (!wx.cloud || typeof wx.cloud.database !== 'function') {
      if (this.data.productImage) {
        const url = await this.resolveImageUrl(this.data.productImage);
        if (url) {
          this.setData({ productImageUrl: url });
          this.refreshContactContext();
        }
      }
      return;
    }

    const db = wx.cloud.database();
    const patch = {};

    if (needOrder) {
      try {
        const res = await db.collection('orders').doc(this.data.orderId).get();
        const order = res && res.data;
        if (order) {
          if (!this.data.orderNo && order.orderNo) patch.orderNo = order.orderNo;
          const picked = pickProductFromOrder(order);
          if (!this.data.productId && picked.productId) patch.productId = picked.productId;
          if (!this.data.productName && picked.productName) patch.productName = picked.productName;
          if (!this.data.productImage && picked.productImage) patch.productImage = picked.productImage;
          if (!this.data.productCount && picked.productCount) patch.productCount = picked.productCount;
        }
      } catch (e) {
        console.warn('support enrich order failed:', e);
      }
    }

    const productId = patch.productId || this.data.productId;
    const hasName = !!(patch.productName || this.data.productName);
    const hasImage = !!(patch.productImage || this.data.productImage);
    if (productId && (!hasName || !hasImage)) {
      try {
        const res = await db.collection('products').doc(productId).get();
        const product = res && res.data;
        if (product) {
          if (!hasName && (product.title || product.name)) {
            patch.productName = product.title || product.name;
          }
          const img =
            getFirstImage(product.images) || product.cover || product.image || '';
          if (!hasImage && img) patch.productImage = img;
        }
      } catch (e) {
        console.warn('support enrich product failed:', e);
      }
    }

    const imageSrc = patch.productImage || this.data.productImage;
    if (imageSrc) {
      const url = await this.resolveImageUrl(imageSrc);
      if (url) patch.productImageUrl = url;
    }

    if (Object.keys(patch).length) {
      this.setData(patch);
      this.refreshContactContext();
    } else {
      this.refreshContactContext();
    }
  },

  openContextTarget() {
    const path = this.data.contextCard && this.data.contextCard.tapPath;
    if (!path) return;
    try {
      wx.vibrateShort({ type: 'light' });
    } catch (e) { /* ignore */ }
    wx.navigateTo({
      url: path,
      fail: () => wx.showToast({ title: '暂时无法打开', icon: 'none' })
    });
  },

  selectTopic(e) {
    const topic = e.currentTarget.dataset.id;
    if (topic === 'invoice') {
      this.goInvoiceRequest();
      return;
    }
    if (topic === 'framer_recruit') {
      this.goFramerRecruit();
      return;
    }
    if (topic === this.data.activeTopic) return;
    this.setData({ activeTopic: topic });
    this.refreshContactContext();
    trackBehavior('support_topic_select', 'topic', topic);
  },

  goInvoiceRequest() {
    const qs = [];
    if (this.data.orderId) qs.push(`orderId=${encodeURIComponent(this.data.orderId)}`);
    if (this.data.orderNo) qs.push(`orderNo=${encodeURIComponent(this.data.orderNo)}`);
    const url =
      '/subpackages/extra/user/invoice-request/index' +
      (qs.length ? `?${qs.join('&')}` : '');
    trackBehavior('support_topic_select', 'topic', 'invoice');
    wx.navigateTo({
      url,
      fail: () => wx.showToast({ title: '无法打开开票页', icon: 'none' })
    });
  },

  goFramerRecruit() {
    const url = '/subpackages/business/framer-recruit/index?from=support';
    trackBehavior('support_topic_select', 'topic', 'framer_recruit');
    wx.navigateTo({
      url,
      fail: () => wx.showToast({ title: '无法打开招募页', icon: 'none' })
    });
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
    if (!phone) {
      wx.showToast({ title: '暂未配置服务电话', icon: 'none' });
      return;
    }
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => wx.showToast({ title: '无法拨打电话', icon: 'none' })
    });
    trackBehavior('support_call', 'phone', phone);
  },

  goMessages() {
    wx.navigateTo({
      url: '/subpackages/extra/user/messages/index?category=system',
      fail: () => wx.showToast({ title: '无法打开消息', icon: 'none' })
    });
  },

  openCommunity() {
    const qr = this.data.config.communityQr || FALLBACK_CONFIG.communityQr;
    if (!qr) {
      wx.showToast({ title: '社群二维码暂未配置', icon: 'none' });
      return;
    }
    if (!this.data.config.communityQr) {
      this.setData({ 'config.communityQr': qr });
    }
    this.setData({ showCommunity: true });
  },

  closeCommunity() {
    this.setData({ showCommunity: false });
  },

  openMap() {
    const { latitude, longitude, address } = this.data.config || {};
    if (!latitude || !longitude) {
      wx.showToast({ title: '暂未配置门店位置', icon: 'none' });
      return;
    }
    wx.openLocation({
      latitude: Number(latitude),
      longitude: Number(longitude),
      name: this.data.storeName || this.data.config.storeName || '门店',
      address: address || '',
      scale: 18,
      fail: () => wx.showToast({ title: '无法打开地图', icon: 'none' })
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
    // 预填的「关于藏品「…」：」本身就超过 5 字，只提交前缀会让专员看不到问题（2026-10-01 真机 P0）
    const prefix = this.data._draftPrefix || '';
    const body = prefix && message.indexOf(prefix) === 0 ? message.slice(prefix.length).trim() : message;
    if (message.length < 5 || body.length < 2) {
      wx.showToast({ title: message.length < 5 ? '请至少输入 5 个字' : '请在「：」后面写下想咨询的内容', icon: 'none' });
      return;
    }
    const phone = (this.data.contactPhone || '').trim();
    if (phone && !/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请填写 11 位手机号', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中…', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'submitSupportTicket',
        data: {
          topic: this.data.activeTopic,
          message,
          orderId: this.data.orderId,
          orderNo: this.data.orderNo,
          productId: this.data.productId,
          productName: this.data.productName,
          contactPhone: phone
        }
      });
      wx.hideLoading();

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
      wx.hideLoading();
      wx.showToast({ title: '提交失败，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/user/index' })
    });
  },

  noop() {}
});
