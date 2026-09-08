// pages/manager/index.js
const db = wx.cloud.database();
const _ = db.command;
const { PRODUCTION_STATUS_LABELS } = require('../../../utils/customDefaults');
const { buildWorkOrderText, buildInquiryText } = require('../../../utils/customHelper');
const { buildStaffCopyText, getStatusLabel, formatQuoteAmount } = require('../../../utils/petMemorialHelper');
const { STATUS_LABELS: PET_STATUS_LABELS } = require('../../../utils/petMemorialDefaults');
const { buildCategoryDoc } = require('../utils/categoryDefaults');
const { loadCategoryPickerTree, buildCategoryManageTree, resolveCanonicalRootName } = require('../../../utils/categoryTree');
const { parseTrackingFromScan, normalizeTrackingInput } = require('../utils/shipHelper');
const { guardManagerPage } = require('../../../utils/managerAuth');
const storeLedger = require('../../../utils/storeLedger');

function isMerchandiseProduct(p) {
  if (!p) return false;
  if (p.categoryType === 'merch') return true;
  const text = `${p.rootCategoryName || ''}${p.category || ''}`;
  return /衍生|文创|书籍|画册|工具|耗材|周边|礼品|包装|礼盒|卡片|陈饰|联名/.test(text);
}

function syncProductLatinRequired(page) {
  page.setData({ productLatinRequired: !isMerchandiseProduct(page.data.tempProduct) });
}

function formatCloudFnError(e, fallback) {
  const msg = (e && (e.errMsg || e.message)) || ''
  if (/501000|FUNCTION_NOT_FOUND|FunctionName parameter could not be found|FUNCTION_NOT_EXIST/i.test(msg)) {
    return '云函数未部署：请在开发者工具上传并部署 seedCategories（及 assistExhibitionCopy）'
  }
  if (/504003|timeout|TIMEOUT/i.test(msg)) {
    return '请求超时，请稍后重试'
  }
  return msg.slice(0, 48) || fallback || '操作失败'
}

async function callCommunitySeedAction(action) {
  const map = { seed: 'communitySeed', clear: 'communityClear', status: 'communityStatus' }
  const primaryAction = map[action] || action
  const timeout = action === 'seed' ? 120000 : 60000

  const invoke = async (name, data) => {
    const res = await wx.cloud.callFunction({
      name,
      config: { timeout },
      data
    })
    return res.result || {}
  }

  try {
    const result = await invoke('seedCategories', { action: primaryAction })
    if (result.success || result.stats) return result
    if (result.msg && !/未知 action/i.test(result.msg)) return result
  } catch (e) {
    console.warn('seedCategories community action', e)
  }

  if (action === 'seed' || action === 'clear' || action === 'status') {
    return invoke('seedCommunityContent', { action })
  }
  throw new Error('社区种子操作失败')
}

const PET_MSG_TYPES = {
  need_info: 'pet_memorial_need_info',
  accepted: 'pet_memorial_accepted',
  awaiting_intake: 'pet_memorial_awaiting_intake',
  in_production: 'pet_memorial_in_production',
  completed: 'pet_memorial_completed'
};

const CUSTOM_PRODUCTION_MSG = {
  framing: 'custom_production_framing',
  packing: 'custom_production_packing',
  shipped: 'custom_production_shipped'
};

function dispatchUserMessage(eventType, openid, relatedId, vars = {}) {
  if (!openid) return Promise.resolve();
  return wx.cloud.callFunction({
    name: 'dispatchMessage',
    data: { action: 'dispatch', eventType, openid, relatedId, vars }
  }).catch((err) => console.warn('dispatchMessage', eventType, err));
}

Page({
  data: {
    navTop: 20, 
    curTab: 0, 
    pageTitle: '',
    timer: null,
    loading: true,

    // 数据源 (确保全量字段初始化)
    orders: [], bookings: [], products: [], framers: [], banners: [], 
    refunds: [], rewards: [], vipLevels: [], activities: [], courses: [],
    revenues: [], categories: [], framerNames: [], framerList: [],
    categoryRoots: [],
    categorySubMap: {},
    categorySubs: [],
    rootNames: [],
    subNames: [],
    customOrders: [], customConfigs: [], customInquiries: [], petMemorialOrders: [],
    subTab: 0, subTabReward: 0, subTabCustom: 0,
    showPetQuoteModal: false,
    tempPetQuote: { orderId: '', amount: '', note: '', validUntil: '' },
    
    // 统计数据
    stats: { 
      totalSales: 0, displaySales: '0',
      offlineSales: 0, displayOffline: '0',
      orderCount: 0, stockCount: 0, totalCost: '0', totalProfit: '0', totalStockNum: 0, visitCount: 0,
      onlineTotal: '0', onlineRatio: 0, offlineTotal: '0', offlineRatio: 0, displayGrand: '0',
      donutStyle: 'background: conic-gradient(#52B788 0%, #C4A76C 0);' 
    },
    trendData: [], 
    todayDate: '',
    greeting: 'Good Day',

    // 🟢 [新增] 发货弹窗相关数据
    showShipModal: false,
    tempShip: {
      orderId: '',
      orderNo: '',
      carrier: '顺丰速运', // 默认快递，减少输入
      trackingNumber: ''
    },
    
    // 弹窗与表单
    bookingHero: '',
    searchVal: '',
    
    showProductModal: false, showFramerModal: false, showCatModal: false, 
    showBannerModal: false, showRewardModal: false, showVipModal: false, 
    showActivityModal: false, showRevenueModal: false, 
    showContentModal: false, showVerifySuccess: false,
    showCustomConfigModal: false,
    showStoreEditModal: false,
    adminStores: [],
    storeVisitStats: { total: 0, byStore: {} },
    tempStoreEdit: { storeId: '', name: '', phone: '', intro: '', hoursOpen: '10:00', hoursClose: '22:00', visitTipsText: '' },

    analyticsDays: 7,
    analyticsLoading: false,
    analytics: {
      summary: { totalEvents: 0, uniqueUsers: 0, pageViews: 0 },
      byModule: [],
      byAction: [],
      funnel: { identify: {}, store: {}, commerce: {} },
      dailyTrend: [],
      sampled: false,
      note: ''
    },
    
    // 内容管理相关
    contentType: 'exhibition', // 'exhibition' | 'article' | 'comment' | 'care'
    contentFilter: 'all', // 'all' | 'published' | 'draft'
    articles: [], exhibitions: [], filteredArticles: [],
    careGuides: [],
    careCategoryOptions: ['INSECTA', 'PLANTAE', 'MARINE', 'MINERALS', 'GENERAL', 'FRAMING'],
    showCareGuideModal: false,
    tempCareGuide: {},
    commentFilter: 'pending',
    commentList: [],
    showCommentReplyModal: false,
    tempCommentReply: { commentId: '', content: '' },
    aiAssisting: false,
    protectionTypeOptions: ['否', '三有保护动物', '保护植物', '保护动物'],
    protectionTypeValues: ['none', 'sanyou', 'protected_plant', 'protected_animal'],
    protectionTypeIndex: 0,

    isEditing: false, editId: '',
    
    tempProduct: {}, tempFramer: {}, tempBanner: {}, tempReward: {}, tempVip: {}, 
    tempActivity: {}, newCatName: '', newCatEn: '',
    newCatLevel: 1,
    newCatParentIndex: 0,
    categoryManageTree: [],
    catManageRootNames: [],
    tempRevenue: { date: '', pos: 0, online: 0, refund: 0, cash: 0, rawText: '' },
    tempContent: {}, tempCustomConfig: {},

    subTabMessage: 0,
    pushForm: {
      title: '',
      content: '',
      category: 'activity',
      actionUrl: '',
      scope: 'single',
      targetOpenid: ''
    },
    pushEstimate: 0,
    pushCampaigns: [],
    autoMessageLogs: [],
    supportTickets: [],
    showTicketReplyModal: false,
    tempTicketReply: { ticketId: '', content: '', topicLabel: '' },
    showPushConfirm: false,
    pushSending: false,

    showProductPicker: false,
    productPickerList: [],
    productPickerKeyword: '',
    relatedProductPreview: []
  },

  onLoad() {
    if (!guardManagerPage()) return;
    const { getWindowInfo } = require('../../../utils/systemInfo');
    const system = getWindowInfo();
    this.setData({ navTop: system.statusBarHeight });

  },

  onShow() { 
    this.startClock(); // 🟢 启动时钟
    this.refreshData(); 
  },

  onHide() {
    this.stopClock();
  },
  
  onUnload() {
    this.stopClock();
    clearTimeout(this.timer);
    clearTimeout(this._pickerTimer);
  },

  startClock() {
    this.stopClock();
    this.updateTime();
    this.data.timer = setInterval(() => {
      this.updateTime();
    }, 1000);
  },

  stopClock() {
    if (this.data.timer) clearInterval(this.data.timer);
  },

  updateTime() {
    const d = new Date();
    // 格式：2023.11.25 14:30:05
    const str = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    
    const hour = d.getHours();
    let greet = 'Good Morning';
    if(hour >= 12 && hour < 18) greet = 'Good Afternoon';
    else if(hour >= 18) greet = 'Good Evening';

    this.setData({ todayDate: str, greeting: greet });
  },

  onPullDownRefresh() { 
    this.refreshData().then(() => wx.stopPullDownRefresh()); 
  },
  
  setToday() {
    const d = new Date();
    const dateStr = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
    const dbDateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const hour = d.getHours();
    let greet = 'Good Morning';
    if(hour >= 12 && hour < 18) greet = 'Good Afternoon';
    else if(hour >= 18) greet = 'Good Evening';
    this.setData({ todayDate: dateStr, greeting: greet, 'tempRevenue.date': dbDateStr });
    this.loadTrendData();
  },

  switchTab(e) { 
    wx.vibrateShort({ type: 'light' });
    const idx = parseInt(e.currentTarget.dataset.idx);
    const title = e.currentTarget.dataset.title || '';
    const patch = { curTab: idx, pageTitle: title };
    if (idx === 2) patch.subTab = 0;
    this.setData(patch);
    if (idx !== 0) this.refreshSubData(idx);
  },

  goPurchaseOrders() {
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({
      url: '/subpackages/business/manager/purchase-orders/index',
    });
  },
  
  switchSubTab(e) { this.setData({ subTab: parseInt(e.currentTarget.dataset.idx) }); },
  switchSubTabReward(e) { this.setData({ subTabReward: parseInt(e.currentTarget.dataset.idx) }); },
  switchSubTabCustom(e) { this.setData({ subTabCustom: parseInt(e.currentTarget.dataset.idx) }); },
  switchSubTabMessage(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    this.setData({ subTabMessage: idx });
    if (idx === 1) {
      this.loadPushCampaigns();
      this.loadAutoMessageLogs();
    }
  },
  backToDashboard() {
    if (this.data.showCommentReplyModal) return;
    wx.vibrateShort({ type: 'light' });
    this.setData({ curTab: 0, pageTitle: '' });
    this.loadDashboardStats();
  },

  noop() {},

  // 🟢 全量刷新
  async refreshData() {
    wx.showNavigationBarLoading();
    try {
      await Promise.all([
          this.loadCategoriesTree(), 
          this.loadFramers(),
          this.loadBookingConfig(),
          this.loadBanners(),
          this.loadTrendData(),
      ]);
      await this.loadDashboardStats();
      
      await Promise.all([
          this.loadOrders(),
          this.loadRefunds(),
          this.loadBookings(),
          this.loadSupportTickets()
      ]);

    } catch (err) { console.error(err); } 
    finally { wx.hideNavigationBarLoading(); }
  },

  /** 经营概况 GMV / 在线 / 门店（本月，读 store_ledger + 订单） */
  async loadDashboardStats() {
    try {
      const offlineTotal = await this.loadOfflineStats();
      await this.loadStats(offlineTotal);
    } catch (e) {
      console.error('loadDashboardStats', e);
    }
  },

  async refreshSubData(idx) {
      if(idx === 1) { await this.loadProducts(); await this.loadCategoriesTree(); }
      if(idx === 2) { await this.loadOrders(); await this.loadRefunds(); }
      if(idx === 3) await this.loadBookings();
      if(idx === 4) await this.loadBanners();
      if(idx === 5) await this.loadFramers();
      if(idx === 6) { await this.loadRewards(); await this.loadVipLevels(); }
      if(idx === 7) await this.loadActivities();
      if(idx === 8) await this.loadRevenues();
      if(idx === 9) {
        await this.loadArticles();
        await this.loadExhibitions();
        if (this.data.contentType === 'comment') await this.loadComments();
      }
      if(idx === 10) { await this.loadCustomOrders(); await this.loadCustomConfigs(); await this.loadCustomInquiries(); await this.loadPetMemorialOrders(); }
      if(idx === 11) { await this.loadPushCampaigns(); await this.loadAutoMessageLogs(); await this.loadSupportTickets(); await this.estimatePushRecipients(); }
      if(idx === 12) { await this.loadAdminStores(); await this.loadStoreVisitStats(); }
      if(idx === 13) { await this.loadAnalyticsDashboard(); }
  },

  // 🟢 核心：加载线下营收（本月 store_ledger，先合并云端）
  async loadOfflineStats() {
    try {
        const { total: offlineTotal } = await storeLedger.sumMonthOffline();
        
        this.setData({ 
            'stats.offlineSales': offlineTotal,
            'stats.displayOffline': offlineTotal.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }),
        });
        
        return offlineTotal;

    } catch(e) { 
        console.error(e);
        return 0; 
    }
  },

  parseOrderAmount(order) {
    if (!order) return 0;
    const raw = order.totalPrice ?? order.payAmount ?? order.amount ?? 0;
    if (typeof raw === 'number') return raw;
    const n = parseFloat(String(raw).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  },

  // 🟢 核心：加载全站统计（本月 GMV = 在线订单 + 门店账本）
  async loadStats(offlineTotal = 0) {
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const orderRes = await db.collection('orders').where({
        status: _.in(['paid', 'shipped', 'received']),
        createTime: _.gte(startOfMonth),
      }).limit(1000).get();

      let onlineSales = 0;
      (orderRes.data || []).forEach((o) => {
        onlineSales += this.parseOrderAmount(o);
      });
      
      const prodRes = await db.collection('products').limit(100).get();
      let totalCost = 0, totalStockNum = 0;
      prodRes.data.forEach(p => {
        const stock = parseInt(p.stock) || 0;
        const cost = parseFloat(p.costPrice) || 0;
        totalStockNum += stock; totalCost += (cost * stock);
      });

      const visitRes = await db.collection('bookings').where({ type: 'museum_visit', status: 'used' }).count();
      
      const grandTotal = onlineSales + offlineTotal;
      const onlineRatio = grandTotal > 0 ? ((onlineSales / grandTotal) * 100) : 0;
      const offlineRatio = grandTotal > 0 ? ((offlineTotal / grandTotal) * 100) : 0;
      
      const fmtMoney = (n) => n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      this.setData({
        'stats.displayGrand': Math.floor(grandTotal).toLocaleString(),
        'stats.onlineTotal': fmtMoney(onlineSales),
        'stats.offlineTotal': fmtMoney(offlineTotal),
        'stats.onlineRatio': onlineRatio.toFixed(0),
        'stats.offlineRatio': offlineRatio.toFixed(0),
        'stats.donutStyle': `background: conic-gradient(#52B788 ${offlineRatio.toFixed(1)}%, #C4A76C 0);`,
        
        'stats.totalCost': totalCost.toLocaleString(),
        'stats.totalStockNum': totalStockNum,
        'stats.visitCount': visitRes.total
      });
    } catch(e){ console.error(e); }
  },

  // === 营收录入相关（deleteRevenue 保留；load/submit 等见下方「其他通用」段，避免重复定义被覆盖）===
  deleteRevenue(e) {
      const id = e.currentTarget.dataset.id;
      wx.showModal({ 
          title: '删除', 
          success: async (res) => { 
              if(res.confirm) { 
                  await storeLedger.removeById(id); 
                  this.loadRevenues();
                  await this.loadDashboardStats();
              } 
          } 
      });
  },

  // ... (其他代码)

  // 🟢 新增：加载趋势图数据
  async loadTrendData() {
    try {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const startStr = sevenDaysAgo.toISOString().split('T')[0];

      const res = await storeLedger.listFromDate(null, startStr);
      
      const recordMap = {};
      res.forEach(r => {
        const row = storeLedger.ledgerToDisplayRow(r);
        recordMap[row.date] = row;
      });

      const chart = [];
      const weekMap = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      
      // 生成最近 7 天的柱状图
      for(let i=6; i>=0; i--) {
          const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const record = recordMap[dateKey] || { total: 0, online: 0 };
          
          const max = 5000; 
          const onlineH = Math.min((record.online || 0) / max * 100, 100);
          const offlineH = Math.min(((record.total || 0) - (record.online || 0)) / max * 100, 100);

          chart.push({
              day: weekMap[d.getDay()],
              styleOnline: `height: ${onlineH}%`,
              styleOffline: `height: ${offlineH}%`
          });
      }

      this.setData({ trendData: chart });

    } catch(e) { console.error(e); }
  },

  // === 装修 (Banner) ===
  async loadBanners() { const res = await db.collection('banners').orderBy('sort', 'desc').get(); this.setData({ banners: res.data }); },
  openBannerModal(e) {
    const item = e.currentTarget.dataset.item;
    this.setData({ showBannerModal: true, isEditing: !!item, editId: item ? item._id : '', tempBanner: item ? { ...item } : { image: '', title: '', subtitle: '', btnText: '立即查看', type: 'product', target: '', targetName: '', sort: 100 } });
  },
  chooseBannerImage() { wx.chooseImage({ count:1, success: res => this.setData({ 'tempBanner.image': res.tempFilePaths[0] }) }); },
  bindBInput(e) { this.setData({ [`tempBanner.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  bindBTypeChange(e) { this.setData({ 'tempBanner.type': e.detail.value }); },
  async submitBanner() {
    const b = this.data.tempBanner;
    if (!b.image || !b.title) return wx.showToast({ title: '补全信息', icon: 'none' });
    wx.showLoading({ title: '发布中...' });
    let img = b.image;
    if (!img.startsWith('cloud') && !img.startsWith('http')) {
       const up = await wx.cloud.uploadFile({ cloudPath: `banners/${Date.now()}.png`, filePath: img });
       img = up.fileID;
    }
    const data = { ...b, image: img, sort: parseInt(b.sort) };
    if (this.data.isEditing) await db.collection('banners').doc(this.data.editId).update({ data });
    else await db.collection('banners').add({ data });
    wx.hideLoading();
    this.setData({ showBannerModal: false });
    this.loadBanners();
  },
  deleteBanner(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '删除', success: async (res) => { if(res.confirm) { await db.collection('banners').doc(id).remove(); this.loadBanners(); } } });
  },

  // === 核销 ===
  async loadBookings() { const res = await db.collection('bookings').where({ status: 'confirmed' }).orderBy('createTime', 'desc').limit(50).get(); this.setData({ bookings: res.data }); },
  verifyBooking(e) {
    const id = e.currentTarget.dataset.id;
    wx.vibrateShort({ type: 'heavy' });
    wx.showModal({
      title: '确认核销', content: '确认该访客已入场？', confirmColor: '#52B788',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '核销中...' });
          await db.collection('bookings').doc(id).update({ data: { status: 'used' } });
          wx.hideLoading();
          this.setData({ showVerifySuccess: true }); 
          this.loadBookings();
        }
      }
    });
  },
  closeVerifyModal() { this.setData({ showVerifySuccess: false }); },
  handleScan() { wx.scanCode({ success: res => { this.verifyBooking({currentTarget:{dataset:{id: res.result}}}); } }); },

  // === 藏品 ===
  async loadProducts() {
    wx.showLoading({ title: '加载藏品...' });
    let query = db.collection('products').orderBy('createTime', 'desc').limit(100);
    if (this.data.searchVal) query = query.where({ title: db.RegExp({ regexp: this.data.searchVal, options: 'i' }) });
    const res = await query.get();
    const list = res.data.map(p => {
        let rate = '0.0';
        if(p.price && p.price != 0 && p.costPrice) {
            const pr = parseFloat(p.price); const cp = parseFloat(p.costPrice);
            if(!isNaN(pr) && !isNaN(cp) && pr !== 0) rate = ((pr - cp) / pr * 100).toFixed(1);
        }
        return { ...p, profitRate: rate };
    });
    this.setData({ products: list });
    wx.hideLoading();
  },
  onSearchInput(e) { this.setData({ searchVal: e.detail.value }); clearTimeout(this.timer); this.timer = setTimeout(() => { this.loadProducts(); }, 500); },
  toggleShelf(e) { const id=e.currentTarget.dataset.id; db.collection('products').doc(id).update({ data: { isOffShelf: !e.detail.value } }); },
  updateStock(e) { /* 省略具体逻辑，参考原代码 */ },
  async openProductModal(e) { 
      await this.loadCategoriesTree();
      if (!(this.data.rootNames || []).length) {
        wx.showToast({ title: '暂无分类，请先在分类管理同步', icon: 'none' });
      }
      const item = e.currentTarget.dataset.item;
      let sizeL='',sizeW='',sizeH=''; 
      if(item && item.size){ const cleanSize = item.size.replace(/cm/gi, '').trim(); const p = cleanSize.split(/[xX]/); if(p.length >= 3){ sizeL=p[0].trim(); sizeW=p[1].trim(); sizeH=p[2].trim(); } } 
      const protectionType = (item && item.protectionType) || 'none';
      const protectionTypeIndex = Math.max(0, this.data.protectionTypeValues.indexOf(protectionType));
      
      this.setData({ 
        showProductModal: true, 
        isEditing: !!item, 
        editId: item?item._id:'', 
        tempProduct: item ? { 
          ...item, 
          tempImg: item.images && item.images[0] ? item.images[0] : '', 
          detailImages: item.detailImages || [],
          detailHtml: item.detailHtml || '',
          sizeL, sizeW, sizeH,
          hasSku: !!(item.hasSku && item.skus && item.skus.length),
          skus: item.skus && item.skus.length ? item.skus : [],
          skuDimensionsStr: (item.skuDimensions || []).join(','),
          supportsCustom: item.supportsCustom !== false,
          protectionType,
          collectionCertificate: item.collectionCertificate || '',
          tempCertificate: '',
          taxonomy: item.taxonomy || { kingdom: '', phylum: '', class: '', order: '', family: '', genus: '' }
        } : { 
          tempImg: '', title: '', price: '', costPrice: '', stock: 1, category: '', categoryId: '', rootCategoryName: '', rootCategoryId: '', categoryType: '', framerName: '', framerId: '', description: '', origin: '', latinName: '', sizeL:'', sizeW:'', sizeH:'', collectDate: '', isTreasure: false, supportsCustom: false, hasSku: false, skus: [], skuDimensionsStr: '', detailImages: [], detailHtml: '',
          protectionType: 'none',
          collectionCertificate: '',
          tempCertificate: '',
          taxonomy: { kingdom: '', phylum: '', class: '', order: '', family: '', genus: '' }
        },
        protectionTypeIndex,
        categorySubs: [],
        subNames: []
      });
      if (item) {
        this.syncProductCategoryPicker(this.data.tempProduct);
      }
      syncProductLatinRequired(this);
  },
  chooseProductImage() { wx.chooseImage({ count:1, success: res => this.setData({ 'tempProduct.tempImg': res.tempFilePaths[0] }) }); },
  chooseDetailImages() {
    const current = this.data.tempProduct.detailImages || []
    const remain = 9 - current.length
    if (remain <= 0) return wx.showToast({ title: '最多 9 张详情图', icon: 'none' })
    wx.chooseImage({
      count: remain,
      success: (res) => {
        this.setData({ 'tempProduct.detailImages': current.concat(res.tempFilePaths) })
      }
    })
  },
  removeDetailImage(e) {
    const idx = e.currentTarget.dataset.index
    const imgs = [...(this.data.tempProduct.detailImages || [])]
    imgs.splice(idx, 1)
    this.setData({ 'tempProduct.detailImages': imgs })
  },
  bindPInput(e) { this.setData({ [`tempProduct.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  bindPFramerChange(e) { const f = this.data.framerList[e.detail.value]; this.setData({ 'tempProduct.framerName': f.name, 'tempProduct.framerId': f._id }); },
  bindPDateChange(e) { this.setData({ 'tempProduct.collectDate': e.detail.value }); },
  bindPTreasure(e) { this.setData({ 'tempProduct.isTreasure': e.detail.value }); },
  bindPSupportsCustom(e) { this.setData({ 'tempProduct.supportsCustom': e.detail.value }); },
  bindProtectionTypeChange(e) {
    const idx = parseInt(e.detail.value, 10) || 0;
    const type = this.data.protectionTypeValues[idx] || 'none';
    const patch = {
      protectionTypeIndex: idx,
      'tempProduct.protectionType': type
    };
    if (type === 'none') {
      patch['tempProduct.collectionCertificate'] = '';
      patch['tempProduct.tempCertificate'] = '';
    }
    this.setData(patch);
  },
  chooseCertificateImage() {
    wx.chooseImage({
      count: 1,
      success: (res) => {
        if (res.tempFilePaths && res.tempFilePaths[0]) {
          this.setData({ 'tempProduct.tempCertificate': res.tempFilePaths[0] });
        }
      }
    });
  },
  removeCertificateImage() {
    this.setData({
      'tempProduct.tempCertificate': '',
      'tempProduct.collectionCertificate': ''
    });
  },
  bindTaxonomyInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`tempProduct.taxonomy.${field}`]: e.detail.value });
  },
  async assistProductWithAi() {
    const p = this.data.tempProduct || {};
    if (!p.title) return wx.showToast({ title: '请先填写名称', icon: 'none' });
    if (!isMerchandiseProduct(p) && !p.category && !p.rootCategoryName) {
      return wx.showToast({ title: '请先选择所属馆/分类', icon: 'none' });
    }
    if (this.data.aiAssisting) return;
    this.setData({ aiAssisting: true });
    wx.showLoading({ title: 'AI 补全中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'assistProductCopy',
        config: { timeout: 60000 },
        data: {
          title: p.title,
          category: p.category || '',
          rootCategory: p.rootCategoryName || '',
          origin: p.origin || ''
        }
      });
      const result = res.result || {};
      if (!result.success) throw new Error(result.msg || '补全失败');
      const d = result.data || {};
      const tax = d.taxonomy || {};
      const latinName = String(d.latinName || '').trim();
      if (!isMerchandiseProduct(p) && !latinName) {
        throw new Error('未能补全拉丁学名，请补充名称或分类后重试');
      }
      this.setData({
        'tempProduct.latinName': latinName || p.latinName || '',
        'tempProduct.description': d.description || p.description || '',
        'tempProduct.taxonomy.kingdom': tax.kingdom || p.taxonomy?.kingdom || '',
        'tempProduct.taxonomy.phylum': tax.phylum || p.taxonomy?.phylum || '',
        'tempProduct.taxonomy.class': tax.class || p.taxonomy?.class || '',
        'tempProduct.taxonomy.order': tax.order || p.taxonomy?.order || '',
        'tempProduct.taxonomy.family': tax.family || p.taxonomy?.family || '',
        'tempProduct.taxonomy.genus': tax.genus || p.taxonomy?.genus || ''
      });
      wx.showToast({ title: latinName ? '补全成功' : '描述已补全', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: e.message || 'AI 补全失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ aiAssisting: false });
    }
  },
  async assistExhibitionWithAi() {
    const c = this.data.tempContent || {};
    if (!c.title || !String(c.title).trim()) {
      return wx.showToast({ title: '请先填写专题标题', icon: 'none' });
    }
    if (this.data.aiAssisting) return;
    this.setData({ aiAssisting: true });
    wx.showLoading({ title: 'AI 创作中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'assistExhibitionCopy',
        config: { timeout: 60000 },
        data: {
          title: String(c.title).trim(),
          themeHint: String(c.themeHint || '').trim()
        }
      });
      const result = res.result || {};
      if (!result.success) throw new Error(result.msg || '创作失败');
      const d = result.data || {};
      this.setData({
        'tempContent.latinName': d.latinName || c.latinName || '',
        'tempContent.brief': d.brief || c.brief || '',
        'tempContent.tagsStr': d.tagsStr || c.tagsStr || '专题',
        'tempContent.content': d.content || c.content || ''
      });
      wx.showToast({ title: '专题文案已生成', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: e.message || 'AI 创作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ aiAssisting: false });
    }
  },
  bindPHasSku(e) {
    const hasSku = e.detail.value
    const skus = hasSku && (!this.data.tempProduct.skus || !this.data.tempProduct.skus.length)
      ? [{ id: `sku_${Date.now()}`, specLabel: '', price: this.data.tempProduct.price || '', stock: 1 }]
      : (this.data.tempProduct.skus || [])
    this.setData({ 'tempProduct.hasSku': hasSku, 'tempProduct.skus': skus })
  },
  addSkuRow() {
    const skus = [...(this.data.tempProduct.skus || [])]
    skus.push({ id: `sku_${Date.now()}_${skus.length}`, specLabel: '', price: this.data.tempProduct.price || '', stock: 1 })
    this.setData({ 'tempProduct.skus': skus })
  },
  removeSkuRow(e) {
    const idx = e.currentTarget.dataset.index
    const skus = [...(this.data.tempProduct.skus || [])]
    skus.splice(idx, 1)
    this.setData({ 'tempProduct.skus': skus, 'tempProduct.hasSku': skus.length > 0 })
  },
  bindSkuInput(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ [`tempProduct.skus[${index}].${field}`]: e.detail.value })
  },
  async submitProduct() { 
      const p = this.data.tempProduct; if (!p.title) return wx.showToast({title:'信息不全',icon:'none'});
      if (!isMerchandiseProduct(p) && !String(p.latinName || '').trim()) {
        return wx.showToast({ title: '标本类藏品须填写拉丁学名', icon: 'none' });
      }
      const needsCert = p.protectionType && p.protectionType !== 'none';
      const hasCert = !!(p.tempCertificate || p.collectionCertificate);
      if (needsCert && !hasCert) {
        return wx.showToast({ title: '请上传收藏证书', icon: 'none' });
      }
      wx.showLoading({title:'保存...'});
      let fileID = p.images && p.images[0] ? p.images[0] : ''; 
      if (p.tempImg && !p.tempImg.startsWith('cloud') && !p.tempImg.startsWith('http')) { const up = await wx.cloud.uploadFile({ cloudPath: `products/${Date.now()}.png`, filePath: p.tempImg }); fileID = up.fileID; }
      const sizeStr = `${p.sizeL || 0}x${p.sizeW || 0}x${p.sizeH || 0} cm`; 

      let hasSku = false
      let skus = []
      let skuDimensions = []
      if (p.hasSku && p.skus && p.skus.length) {
        skuDimensions = String(p.skuDimensionsStr || '')
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean)

        skus = p.skus
          .filter((s) => s && s.specLabel)
          .map((s, i) => {
            const specLabel = String(s.specLabel).trim()
            let specs = s.specs || null
            if (skuDimensions.length && specLabel.includes('/')) {
              const parts = specLabel.split('/').map((x) => x.trim())
              specs = {}
              skuDimensions.forEach((dim, idx) => {
                specs[dim] = parts[idx] || parts[parts.length - 1] || ''
              })
            } else if (skuDimensions.length === 1) {
              specs = { [skuDimensions[0]]: specLabel }
            }
            return {
              id: s.id || `sku_${Date.now()}_${i}`,
              specLabel,
              specs: specs || {},
              price: parseFloat(s.price || p.price || 0),
              stock: parseInt(s.stock, 10) || 0,
              image: s.image || ''
            }
          })
        hasSku = skus.length > 0
      }

      let salePrice = parseFloat(p.price)
      let totalStock = parseInt(p.stock, 10) || 0
      if (hasSku) {
        salePrice = Math.min(...skus.map((s) => s.price))
        totalStock = skus.reduce((sum, s) => sum + s.stock, 0)
      }

      const detailImages = []
      for (let i = 0; i < (p.detailImages || []).length; i++) {
        const img = p.detailImages[i]
        if (!img) continue
        if (img.startsWith('cloud') || img.startsWith('http')) {
          detailImages.push(img)
        } else {
          const up = await wx.cloud.uploadFile({
            cloudPath: `products/detail_${Date.now()}_${i}.png`,
            filePath: img
          })
          detailImages.push(up.fileID)
        }
      }
      
      let collectionCertificate = p.collectionCertificate || '';
      if (p.tempCertificate && !p.tempCertificate.startsWith('cloud') && !p.tempCertificate.startsWith('http')) {
        const certUp = await wx.cloud.uploadFile({
          cloudPath: `products/cert_${Date.now()}.png`,
          filePath: p.tempCertificate
        });
        collectionCertificate = certUp.fileID;
      } else if (p.tempCertificate) {
        collectionCertificate = p.tempCertificate;
      }
      if (!needsCert) collectionCertificate = '';

      const data = {
        title: p.title,
        latinName: p.latinName || '',
        price: salePrice,
        costPrice: parseFloat(p.costPrice || 0),
        stock: totalStock,
        hasSku,
        skus: hasSku ? skus : [],
        skuDimensions: hasSku ? skuDimensions : [],
        category: p.category,
        categoryId: p.categoryId || '',
        categoryType: p.categoryType || '',
        rootCategoryName: p.rootCategoryName || '',
        rootCategoryId: p.rootCategoryId || '',
        framerName: p.framerName || 'NATURE',
        framerId: p.framerId,
        origin: p.origin || '',
        description: p.description || '',
        detailHtml: p.detailHtml || '',
        detailImages,
        collectDate: p.collectDate || '',
        size: sizeStr,
        isTreasure: p.isTreasure || false,
        supportsCustom: p.supportsCustom !== false,
        protectionType: p.protectionType || 'none',
        collectionCertificate,
        taxonomy: p.taxonomy || {},
        images: [fileID],
        isOffShelf: p.isOffShelf || false,
        seckill: null,
        groupBuying: null
      }; 
      if (this.data.isEditing) await db.collection('products').doc(this.data.editId).update({ data }); else { data.createTime = db.serverDate(); await db.collection('products').add({ data }); } 
      wx.hideLoading(); this.setData({ showProductModal: false }); this.loadProducts(); 
  },

  // === 订单 ===
  async loadOrders() { const res = await db.collection('orders').where({ status: 'paid' }).orderBy('createTime', 'desc').limit(50).get(); this.setData({ orders: res.data.map(i => ({...i, formatTime: new Date(i.createTime).toLocaleString()})) }); },
  async loadCustomOrders() {
    try {
      const res = await db.collection('orders')
        .where({ source: 'custom', status: _.in(['paid', 'shipped']) })
        .orderBy('createTime', 'desc')
        .limit(50)
        .get();
      const list = (res.data || []).map((item) => ({
        ...item,
        formatTime: new Date(item.createTime).toLocaleString(),
        productionLabel: PRODUCTION_STATUS_LABELS[item.productionStatus] || '待制作',
        specimenTitle: item.customMeta && item.customMeta.specimen ? item.customMeta.specimen.title : (item.products && item.products[0] ? item.products[0].title : '')
      }));
      this.setData({ customOrders: list });
    } catch (e) {
      console.error('loadCustomOrders', e);
      this.setData({ customOrders: [] });
    }
  },
  async loadCustomConfigs() {
    try {
      const res = await db.collection('custom_configs').orderBy('sort', 'asc').limit(100).get();
      this.setData({ customConfigs: res.data || [] });
    } catch (e) {
      console.error('loadCustomConfigs', e);
      this.setData({ customConfigs: [] });
    }
  },
  async loadCustomInquiries() {
    try {
      const res = await db.collection('custom_inquiries').orderBy('createTime', 'desc').limit(50).get();
      const statusLabels = { pending: '待跟进', contacted: '已联系', closed: '已关闭' };
      this.setData({
        customInquiries: (res.data || []).map((item) => ({
          ...item,
          statusLabel: statusLabels[item.status] || item.status,
          formatTime: item.createTime ? new Date(item.createTime).toLocaleString() : ''
        }))
      });
    } catch (e) {
      console.error('loadCustomInquiries', e);
      this.setData({ customInquiries: [] });
    }
  },
  async updateInquiryStatus(e) {
    const id = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    if (!id || !status) return;
    const inquiry = this.data.customInquiries.find((i) => i._id === id);
    try {
      await db.collection('custom_inquiries').doc(id).update({
        data: { status, updateTime: db.serverDate() }
      });
      if (status === 'contacted' && inquiry && inquiry._openid) {
        dispatchUserMessage('custom_inquiry_contacted', inquiry._openid, id);
      }
      wx.showToast({ title: '已更新' });
      this.loadCustomInquiries();
    } catch (err) {
      wx.showToast({ title: '更新失败', icon: 'none' });
    }
  },
  copyInquiryText(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    wx.setClipboardData({
      data: buildInquiryText(item),
      success: () => wx.showToast({ title: '已复制' })
    });
  },
  async loadPetMemorialOrders() {
    try {
      const res = await db.collection('pet_memorial_orders').orderBy('createTime', 'desc').limit(50).get();
      this.setData({
        petMemorialOrders: (res.data || []).map((item) => ({
          ...item,
          statusLabel: getStatusLabel(item.status),
          formatTime: item.createTime ? new Date(item.createTime).toLocaleString() : '',
          petTitle: item.pet ? `${item.pet.name} · ${item.pet.speciesLabel || item.pet.species}` : '',
          quoteText: item.quote && item.quote.amount != null ? formatQuoteAmount(item.quote.amount) : ''
        }))
      });
    } catch (e) {
      console.error('loadPetMemorialOrders', e);
      this.setData({ petMemorialOrders: [] });
    }
  },
  async updatePetMemorialStatus(e) {
    const id = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    if (!id || !status) return;
    const order = this.data.petMemorialOrders.find((o) => o._id === id);
    try {
      const note = PET_STATUS_LABELS[status] || status;
      await db.collection('pet_memorial_orders').doc(id).update({
        data: {
          status,
          updateTime: db.serverDate(),
          productionLog: _.push([{ status, time: new Date().toISOString(), note }])
        }
      });
      const eventType = PET_MSG_TYPES[status];
      if (eventType && order && order._openid) {
        dispatchUserMessage(eventType, order._openid, id, {
          petName: order.pet ? order.pet.name : '伴宠'
        });
      }
      wx.showToast({ title: '已更新' });
      this.loadPetMemorialOrders();
    } catch (err) {
      wx.showToast({ title: '更新失败', icon: 'none' });
    }
  },
  copyPetMemorialText(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    wx.setClipboardData({
      data: buildStaffCopyText(item),
      success: () => wx.showToast({ title: '已复制' })
    });
  },
  openPetQuoteModal(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({
      showPetQuoteModal: true,
      tempPetQuote: { orderId: id, amount: '', note: '', validUntil: '' }
    });
  },
  closePetQuoteModal() {
    this.setData({ showPetQuoteModal: false });
  },
  bindPetQuoteInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`tempPetQuote.${field}`]: e.detail.value });
  },
  onPetQuoteDateChange(e) {
    this.setData({ 'tempPetQuote.validUntil': e.detail.value });
  },
  async submitPetQuote() {
    const { orderId, amount, note, validUntil } = this.data.tempPetQuote;
    if (!orderId || !amount) {
      wx.showToast({ title: '请填写报价金额', icon: 'none' });
      return;
    }
    const num = parseFloat(amount);
    if (Number.isNaN(num) || num <= 0) {
      wx.showToast({ title: '金额无效', icon: 'none' });
      return;
    }
    try {
      const logEntry = {
        status: 'quoted',
        time: new Date().toISOString(),
        note: `报价 ${formatQuoteAmount(num)}${note ? ' · ' + note : ''}`
      };
      await db.collection('pet_memorial_orders').doc(orderId).update({
        data: {
          status: 'quoted',
          quote: {
            amount: num,
            note: (note || '').trim(),
            quotedAt: new Date().toISOString(),
            validUntil: validUntil || ''
          },
          updateTime: db.serverDate(),
          productionLog: _.push([logEntry])
        }
      });
      const order = this.data.petMemorialOrders.find((o) => o._id === orderId);
      const petName = order && order.pet ? order.pet.name : '伴宠';
      if (order && order._openid) {
        dispatchUserMessage('pet_memorial_quoted', order._openid, orderId, {
          petName,
          quoteAmount: formatQuoteAmount(num)
        });
      }
      wx.showToast({ title: '报价已发送' });
      this.setData({ showPetQuoteModal: false });
      this.loadPetMemorialOrders();
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
  async advanceProduction(e) {
    const id = e.currentTarget.dataset.id;
    const next = e.currentTarget.dataset.next;
    if (!id || !next) return;
    const order = this.data.customOrders.find((o) => o._id === id);
    wx.showLoading({ title: '更新中...' });
    try {
      const updateData = { productionStatus: next };
      if (next === 'shipped') updateData.status = 'shipped';
      await db.collection('orders').doc(id).update({ data: updateData });
      const eventType = CUSTOM_PRODUCTION_MSG[next];
      if (eventType && order && order._openid) {
        dispatchUserMessage(eventType, order._openid, id, {
          orderNo: order.orderNo || ''
        });
      }
      wx.showToast({ title: '已更新' });
      this.loadCustomOrders();
    } catch (err) {
      wx.showToast({ title: '更新失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
  copyWorkOrder(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    const text = buildWorkOrderText(item);
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '工单已复制' })
    });
  },
  openCustomConfigModal(e) {
    const item = e.currentTarget.dataset.item;
    this.setData({
      showCustomConfigModal: true,
      isEditing: !!item,
      editId: item ? item._id : '',
      tempCustomConfig: item ? { ...item } : {
        configId: '',
        type: 'frame',
        name: '',
        desc: '',
        priceDelta: 0,
        sort: 10,
        status: 'active'
      }
    });
  },
  bindCCInput(e) {
    this.setData({ [`tempCustomConfig.${e.currentTarget.dataset.field}`]: e.detail.value });
  },
  bindCCTypeChange(e) {
    this.setData({ 'tempCustomConfig.type': e.detail.value });
  },
  async submitCustomConfig() {
    const c = this.data.tempCustomConfig;
    if (!c.name || !c.type) {
      wx.showToast({ title: '请填写名称与类型', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存...' });
    try {
      const data = {
        configId: c.configId || c._id || `cfg_${Date.now()}`,
        type: c.type,
        name: c.name,
        desc: c.desc || '',
        priceDelta: parseFloat(c.priceDelta) || 0,
        sort: parseInt(c.sort, 10) || 10,
        status: c.status || 'active'
      };
      if (this.data.isEditing) {
        await db.collection('custom_configs').doc(this.data.editId).update({ data });
      } else {
        await db.collection('custom_configs').add({ data });
      }
      wx.hideLoading();
      this.setData({ showCustomConfigModal: false });
      this.loadCustomConfigs();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
  deleteCustomConfig(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showModal({
      title: '删除配置',
      success: async (res) => {
        if (!res.confirm) return;
        await db.collection('custom_configs').doc(id).remove();
        this.loadCustomConfigs();
      }
    });
  },
  async loadRefunds() { const res = await db.collection('orders').where({ status: 'refunding' }).orderBy('createTime', 'desc').limit(50).get(); this.setData({ refunds: res.data.map(i => ({...i, formatTime: new Date(i.createTime).toLocaleString()})) }); },
  shipOrder(e) { const id = e.currentTarget.dataset.id; wx.showModal({ title: '确认发货', success: res => { if (res.confirm) { db.collection('orders').doc(id).update({ data: { status: 'shipped' } }).then(() => this.loadOrders()); } } }); },
  handleRefund(e) { const id = e.currentTarget.dataset.id; wx.showModal({ title: '确认退款', content: '确认通过微信退款并恢复库存？', success: res => { if (res.confirm) { wx.cloud.callFunction({ name: 'refundOrder', data: { orderId: id }, success: res => { if (res.result.success) { wx.showToast({ title: res.result.msg || '已退款' }); this.loadRefunds(); } else { wx.showToast({ title: res.result.msg || '失败', icon: 'none' }); } } }); } } }); },

  // === 其他通用 ===
  async loadRevenues() {
    try {
      const revenues = await storeLedger.refreshFromCloud(undefined, 31);
      this.setData({ revenues });
      if (revenues.length) {
        const latest = revenues[0].date;
        const today = storeLedger.getTodayDateStr();
        if (latest && latest < today) {
          wx.showToast({
            title: `账本至${latest.slice(5)}，Web端请同步云端`,
            icon: 'none',
            duration: 3500,
          });
        }
      }
    } catch (e) {
      console.warn('云端账本合并失败，使用本地 store_ledger', e);
      const revenues = await storeLedger.listRecent(undefined, 31);
      this.setData({ revenues });
    }
  },
  openRevenueModal() { this.setData({ showRevenueModal: true, 'tempRevenue.date': this.data.todayDate.replace(/\./g, '-'), 'tempRevenue.pos': '', 'tempRevenue.online': '', 'tempRevenue.refund': '', 'tempRevenue.cash': '', 'tempRevenue.rawText': '' }); },
  bindRevInput(e) { this.setData({ [`tempRevenue.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  
// 🟢 智能解析 (增强版正则)
parseRevenueText(e) {
  const text = e.detail.value;
  this.setData({ 'tempRevenue.rawText': text });
  
  // 辅助函数：提取金额 (支持 "12,345.00", "1000", "1000元" 等格式)
  // 逻辑：匹配关键词后，寻找最近的数字
  const extractAmount = (keywords) => {
      // 构造正则：关键词 + 任意非数字字符(非贪婪) + (数字及小数点及逗号)
      // 关键词可以是数组，用 | 连接
      const keyPattern = keywords.join('|');
      const reg = new RegExp(`(${keyPattern})[^0-9\\-]*([0-9,]+(\\.\\d+)?)`, 'i');
      const match = text.match(reg);
      if (match && match[2]) {
          // 去掉逗号，转浮点数
          return parseFloat(match[2].replace(/,/g, ''));
      }
      return 0; // 没匹配到返回 0，不覆盖已有值则需在调用处判断
  };

      // 🟢 优化日期正则：允许年月日之间有空格，如 "2025年 11 月 22日"
      let date = this.data.tempRevenue.date; // 默认保留原值
      const dateRegFull = /(\d{4})\s*[年\.\-/]\s*(\d{1,2})\s*[月\.\-/]\s*(\d{1,2})/;
      const matchFull = text.match(dateRegFull);
      
      if (matchFull) {
          date = `${matchFull[1]}-${matchFull[2].padStart(2,'0')}-${matchFull[3].padStart(2,'0')}`;
      } else {
          // 尝试匹配无年份 "11月22日"
          const dateRegShort = /(\d{1,2})\s*[月\.\-/]\s*(\d{1,2})/;
          const matchShort = text.match(dateRegShort);
          if (matchShort) {
              const year = new Date().getFullYear();
              date = `${year}-${matchShort[1].padStart(2,'0')}-${matchShort[2].padStart(2,'0')}`;
          }
      }

  // 提取各项金额
  // 关键词覆盖常见写法
  const posVal = extractAmount(['POS', '银联', '刷卡', '银行卡']);
  const onlineVal = extractAmount(['线上', '微信', '支付宝', '扫码', '小程序', '网银']);
  const cashVal = extractAmount(['现金', 'CASH']);
  const refundVal = extractAmount(['退款', '退货', '支出', 'REFUND']);

  // 更新数据 (如果提取结果为0，且原值不为0/空，则保留原值？这里策略是覆盖，方便纠错)
  // 但为了体验，如果输入框本来有值，解析为0可能不应该覆盖。
  // 这里采用：解析出 > 0 才覆盖，或者完全覆盖。
  // 为了智能，我们完全覆盖，假设用户贴的是全量数据。
  
  this.setData({
      'tempRevenue.date': date,
      'tempRevenue.pos': posVal || '', // 显示为空字符串以便用户修改，而不是0
      'tempRevenue.online': onlineVal || '',
      'tempRevenue.cash': cashVal || '',
      'tempRevenue.refund': refundVal || ''
  });
  
  wx.showToast({ title: '已智能识别', icon: 'none' });
},

  // 🟢 修复提交按钮失效问题
  async submitRevenue() {
    const r = this.data.tempRevenue;
    
    // 弱校验：只要日期不为空即可
    if(!r.date) {
        return wx.showToast({ title: '日期必填', icon: 'none' });
    }
    
    wx.showLoading({ title: '入账中...' });
    
    const pos = parseFloat(r.pos || 0);
    const online = parseFloat(r.online || 0);
    const cash = parseFloat(r.cash || 0);
    const refund = parseFloat(r.refund || 0);
    const total = pos + online + cash - refund;

    const data = {
        date: r.date,
        pos, online, cash, refund,
        total,
        totalFmt: total.toLocaleString(),
        updateTime: db.serverDate()
    };
    
    try {
        await storeLedger.upsert(null, { ...r, rawText: r.rawText });
        
        wx.hideLoading();
        this.setData({ showRevenueModal: false });
        this.loadRevenues();
        await this.loadDashboardStats();
        wx.showToast({ title: '入账成功', icon: 'success' });
    } catch(e) {
        console.error(e);
        wx.hideLoading();
        wx.showToast({ title: '保存失败', icon: 'none' });
    }
},

  async loadFramers() { const res = await db.collection('framers').get(); this.setData({ framers: res.data, framerList: res.data, framerNames: res.data.map(f => f.name) }); },
  openFramerModal(e) { const item=e.currentTarget.dataset.item; this.setData({ showFramerModal:true, isEditing:!!item, editId:item?item._id:'', tempFramer:item?item:{name:'',avatar:'',type:'store',bio:'',priceDelta:0,extraDays:0} }); },
  chooseFramerImage() { wx.chooseImage({ count:1, success: res => this.setData({ 'tempFramer.avatar': res.tempFilePaths[0] }) }); },
  bindFInput(e) { this.setData({ [`tempFramer.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  bindFTypeChange(e) { this.setData({ 'tempFramer.type': e.detail.value }); },
  async submitFramer() { const f=this.data.tempFramer; if(!f.name) return; wx.showLoading(); let a=f.avatar; if(f.avatar&&!f.avatar.startsWith('cloud')){const up=await wx.cloud.uploadFile({cloudPath:`framers/${Date.now()}.png`,filePath:f.avatar});a=up.fileID;} const data={name:f.name,type:f.type,bio:f.bio,avatar:a,priceDelta:parseFloat(f.priceDelta)||0,extraDays:parseInt(f.extraDays,10)||0}; if(this.data.isEditing) await db.collection('framers').doc(this.data.editId).update({data}); else await db.collection('framers').add({data}); wx.hideLoading(); this.setData({showFramerModal:false}); this.loadFramers(); },

  async loadRewards() { const res = await db.collection('rewards').orderBy('cost', 'asc').get(); this.setData({ rewards: res.data }); },
  async loadVipLevels() { const res = await db.collection('vip_levels').orderBy('level', 'asc').get(); this.setData({ vipLevels: res.data }); },
  openRewardModal(e) { const item=e.currentTarget.dataset.item; this.setData({ showRewardModal:true, isEditing:!!item, editId:item?item._id:'', tempReward:item?item:{image:'',title:'',cost:'',stock:99,type:'virtual',description:''} }); },
  openVipModal(e) { const item=e.currentTarget.dataset.item; this.setData({ showVipModal:true, isEditing:!!item, editId:item?item._id:'', tempVip:item?{...item,privilegesStr:item.privileges.join('，')}:{level:'',name:'',discount:'',privilegesStr:''} }); },
  chooseRewardImage() { wx.chooseImage({ count:1, success: res => this.setData({ 'tempReward.image': res.tempFilePaths[0] }) }); },
  bindRInput(e) { this.setData({ [`tempReward.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  bindRTypeChange(e) { this.setData({ 'tempReward.type': e.detail.value }); },
  bindVInput(e) { this.setData({ [`tempVip.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  async submitReward() { const r=this.data.tempReward; if(!r.title) return; wx.showLoading(); let img=r.image; if(!img.startsWith('cloud')){const up=await wx.cloud.uploadFile({cloudPath:`rewards/${Date.now()}.png`,filePath:img});img=up.fileID;} const data={title:r.title,cost:parseInt(r.cost),stock:parseInt(r.stock),type:r.type,description:r.description,image:img, value: r.value, minSpend: r.minSpend, isOffShelf:false}; if(this.data.isEditing) await db.collection('rewards').doc(this.data.editId).update({data}); else await db.collection('rewards').add({data}); wx.hideLoading(); this.setData({showRewardModal:false}); this.loadRewards(); },
  async submitVipLevel() { const v=this.data.tempVip; if(!v.level) return; wx.showLoading(); const pArr=v.privilegesStr.split(/[,，]/).map(s=>s.trim()).filter(s=>s); const data={level:parseInt(v.level),name:v.name,discount:parseFloat(v.discount),privileges:pArr}; if(this.data.isEditing) await db.collection('vip_levels').doc(this.data.editId).update({data}); else await db.collection('vip_levels').add({data}); wx.hideLoading(); this.setData({showVipModal:false}); this.loadVipLevels(); },
  deleteReward(e) { const id=e.currentTarget.dataset.id; wx.showModal({title:'删除',success:async(res)=>{if(res.confirm){await db.collection('rewards').doc(id).remove();this.loadRewards();}}}); },

  async loadActivities() { const res = await db.collection('activities').get(); this.setData({ activities: res.data }); },
  openActivityModal(e) { const item=e.currentTarget.dataset.item; this.setData({ showActivityModal:true, isEditing:!!item, editId:item?item._id:'', tempActivity:item?item:{title:'',type:'course',date:'',time:'',price:'',maxPeople:'',location:'本店',image:''} }); },
  chooseActivityImage() { wx.chooseImage({ count:1, success: res => this.setData({ 'tempActivity.image': res.tempFilePaths[0] }) }); },
  bindAInput(e) { this.setData({ [`tempActivity.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  bindADateChange(e) { this.setData({ 'tempActivity.date': e.detail.value }); },
  bindATypeChange(e) { this.setData({ 'tempActivity.type': e.detail.value }); },
  async submitActivity() { const a=this.data.tempActivity; if(!a.title||!a.date) return; wx.showLoading({title:'发布...'}); let img=a.image; if(img&&!img.startsWith('cloud')){const up=await wx.cloud.uploadFile({cloudPath:`activities/${Date.now()}.png`,filePath:img});img=up.fileID;} const data={title:a.title,type:a.type,date:a.date,time:a.time,price:parseFloat(a.price||0),maxPeople:parseInt(a.maxPeople||0),location:a.location,image:img,status:'open',remain:parseInt(a.maxPeople||0)}; if(this.data.isEditing) await db.collection('activities').doc(this.data.editId).update({data}); else await db.collection('activities').add({data}); wx.hideLoading(); this.setData({showActivityModal:false}); this.loadActivities(); },
  deleteActivity(e) { const id=e.currentTarget.dataset.id; wx.showModal({title:'删除',success:async(res)=>{if(res.confirm){await db.collection('activities').doc(id).remove();this.loadActivities();}}}); },

 // 加载分类树（categories 集合 · 分页全量 · 仅读库）
 async loadCategoriesTree() {
  try {
    const tree = await loadCategoryPickerTree(db);
    this.setData({
      categoryRoots: tree.categoryRoots,
      categorySubMap: tree.categorySubMap,
      rootNames: tree.rootNames
    });
    return tree;
  } catch (e) {
    console.error('loadCategoriesTree', e);
    wx.showToast({ title: '分类加载失败', icon: 'none' });
    return { categoryRoots: [], categorySubMap: {}, rootNames: [] };
  }
},

/** 编辑藏品时，根据已存分类回填一二级 Picker */
syncProductCategoryPicker(product) {
  const p = product || {};
  const roots = this.data.categoryRoots || [];
  const subMap = this.data.categorySubMap || {};

  let rootIdx = -1;
  if (p.rootCategoryId) {
    rootIdx = roots.findIndex((r) => r._id === p.rootCategoryId);
  }
  if (rootIdx < 0 && p.rootCategoryName) {
    const canonical = resolveCanonicalRootName(p.rootCategoryName);
    rootIdx = roots.findIndex((r) => r.name === canonical);
  }

  if (rootIdx < 0 && (p.categoryId || p.category)) {
    for (let i = 0; i < roots.length; i++) {
      const subs = subMap[roots[i]._id] || [];
      const subIdx = p.categoryId
        ? subs.findIndex((s) => s._id === p.categoryId)
        : subs.findIndex((s) => s.name === p.category);
      if (subIdx >= 0) {
        rootIdx = i;
        break;
      }
    }
  }

  if (rootIdx < 0) {
    this.setData({ categorySubs: [], subNames: [] });
    return;
  }

  const rootCat = roots[rootIdx];
  const subs = subMap[rootCat._id] || [];
  const subNames = subs.map((c) => c.name);
  let subIdx = -1;
  if (p.categoryId) subIdx = subs.findIndex((s) => s._id === p.categoryId);
  else if (p.category) subIdx = subs.findIndex((s) => s.name === p.category);

  const patch = {
    categorySubs: subs,
    subNames,
    'tempProduct.rootCategoryIndex': rootIdx,
    'tempProduct.rootCategoryId': rootCat._id,
    'tempProduct.rootCategoryName': rootCat.name,
    'tempProduct.subCategoryIndex': subIdx
  };
  if (subIdx >= 0) {
    const subCat = subs[subIdx];
    patch['tempProduct.category'] = subCat.name;
    patch['tempProduct.categoryId'] = subCat._id;
    patch['tempProduct.categoryType'] = subCat.categoryType || '';
  }
  this.setData(patch);
},

async ensureDefaultCategories() {
  try {
    await wx.cloud.callFunction({ name: 'seedCategories', data: { action: 'sync' } });
  } catch (e) {
    console.warn('seedCategories cloud fn', e);
  }
},

async loadCategoriesManage() {
  try {
    await this.ensureDefaultCategories();
    const tree = await loadCategoryPickerTree(db);
    const manage = buildCategoryManageTree(tree.categoryRoots, tree.allSubs || []);
    this.setData({
      categoryManageTree: manage.categoryManageTree,
      catManageRootNames: manage.catManageRootNames,
      categories: manage.categories,
      categoryRoots: tree.categoryRoots,
      categorySubMap: tree.categorySubMap,
      rootNames: tree.rootNames
    });
  } catch (e) {
    console.error('loadCategoriesManage', e);
    wx.showToast({ title: '加载分类失败', icon: 'none' });
  }
},

// 🟢 一级分类改变
bindRootCatChange(e) {
  const idx = parseInt(e.detail.value, 10);
  const rootCat = this.data.categoryRoots[idx];
  if (!rootCat) return;
  
  const subs = this.data.categorySubMap[rootCat._id] || [];
  const subNames = subs.map(c => c.name);

  this.setData({
    'tempProduct.rootCategoryIndex': idx,
    'tempProduct.rootCategoryId': rootCat._id,
    'tempProduct.rootCategoryName': rootCat.name,
    categorySubs: subs,
    subNames,
    'tempProduct.subCategoryIndex': -1,
    'tempProduct.category': '',
    'tempProduct.categoryId': '',
    'tempProduct.categoryType': ''
  });
  syncProductLatinRequired(this);
},

// 🟢 二级分类改变 (最终选择)
bindSubCatChange(e) {
  const idx = parseInt(e.detail.value, 10);
  const subCat = this.data.categorySubs[idx];
  if (!subCat) return;

  const patch = {
    'tempProduct.subCategoryIndex': idx,
    'tempProduct.category': subCat.name,
    'tempProduct.categoryId': subCat._id,
    'tempProduct.categoryType': subCat.categoryType || ''
  };
  const tax = subCat.taxonomy || {};
  if (tax.kingdom || tax.phylum || tax.class) {
    patch['tempProduct.taxonomy.kingdom'] = tax.kingdom || '';
    patch['tempProduct.taxonomy.phylum'] = tax.phylum || '';
    patch['tempProduct.taxonomy.class'] = tax.class || '';
    patch['tempProduct.taxonomy.order'] = tax.order || '';
    patch['tempProduct.taxonomy.family'] = tax.family || '';
    patch['tempProduct.taxonomy.genus'] = tax.genus || '';
  }
  this.setData(patch);
  syncProductLatinRequired(this);
},

// === 🟢 新增/修改：订单发货逻辑 ===

  // 1. 打开弹窗
  openShipModal(e) {
    const ds = e.currentTarget.dataset;
    const item = ds.item || {};
    const orderId = ds.id || item._id;
    const orderNo = ds.orderno || item.orderNo || '';
    if (!orderId) {
      wx.showToast({ title: '订单信息异常', icon: 'none' });
      return;
    }
    this.setData({
      showShipModal: true,
      tempShip: {
        orderId,
        orderNo,
        carrier: '顺丰速运',
        trackingNumber: ''
      }
    });
  },

  bindShipInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({
      [`tempShip.${field}`]: e.detail.value
    });
  },

  scanTrackingNumber() {
    wx.scanCode({
      scanType: ['barCode', 'qrCode'],
      onlyFromCamera: false,
      success: (res) => {
        const parsed = parseTrackingFromScan(res.result);
        if (!parsed || parsed.length < 6) {
          wx.showToast({ title: '未识别到有效单号', icon: 'none' });
          return;
        }
        wx.vibrateShort({ type: 'light' });
        this.setData({ 'tempShip.trackingNumber': parsed });
        wx.showToast({ title: `已填入 ${parsed}`, icon: 'none' });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') === -1) {
          wx.showToast({ title: '扫码失败，请手动输入', icon: 'none' });
        }
      }
    });
  },

  async submitShip() {
    const { orderId, carrier } = this.data.tempShip;
    const trackingNumber = normalizeTrackingInput(this.data.tempShip.trackingNumber);

    if (!trackingNumber || trackingNumber.length < 6) {
      return wx.showToast({ title: '请填写有效快递单号', icon: 'none' });
    }
    if (!orderId) {
      return wx.showToast({ title: '订单信息丢失，请重新打开发货', icon: 'none' });
    }

    wx.showLoading({ title: '发货中...' });

    try {
      const res = await wx.cloud.callFunction({
        name: 'managerShipOrder',
        data: {
          orderId,
          carrier: (carrier || '快递').trim(),
          trackingNumber
        }
      });
      const result = res.result || {};

      wx.hideLoading();

      if (!result.success) {
        wx.showToast({ title: result.msg || '发货失败', icon: 'none' });
        return;
      }

      if (!result.messageSent) {
        wx.showToast({ title: '已发货，通知可能延迟', icon: 'none' });
      } else {
        wx.showToast({ title: '发货成功', icon: 'success' });
      }

      this.setData({
        showShipModal: false,
        tempShip: { orderId: '', orderNo: '', carrier: '顺丰速运', trackingNumber: '' }
      });
      this.loadOrders();
    } catch (err) {
      console.error(err);
      wx.hideLoading();
      wx.showToast({ title: '发货失败，请部署 managerShipOrder', icon: 'none' });
    }
  },

  closeModal() {
    this.setData({
      showProductModal: false,
      showFramerModal: false,
      showCatModal: false,
      showBannerModal: false,
      showRewardModal: false,
      showVipModal: false,
      showActivityModal: false,
      showRevenueModal: false,
      showShipModal: false,
      showContentModal: false,
      showProductPicker: false,
      showCustomConfigModal: false,
      showCommentReplyModal: false,
      showTicketReplyModal: false,
      showPushConfirm: false
    });
  },

  openCatModal() {
    this.loadCategoriesManage();
    this.setData({
      showCatModal: true,
      newCatName: '',
      newCatEn: '',
      newCatLevel: 1,
      newCatParentIndex: 0
    });
  },
  bindCatInput(e) {
    if (e.currentTarget.dataset.field === 'name') {
      this.setData({ newCatName: e.detail.value });
    } else {
      this.setData({ newCatEn: e.detail.value });
    }
  },
  bindCatLevelChange(e) {
    this.setData({ newCatLevel: parseInt(e.detail.value, 10) === 2 ? 2 : 1 });
  },
  bindCatParentChange(e) {
    this.setData({ newCatParentIndex: parseInt(e.detail.value, 10) || 0 });
  },
  async syncCategoriesFromSeed() {
    wx.showLoading({ title: '同步分类…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'seedCategories',
        data: { action: 'sync' }
      });
      wx.hideLoading();
      const result = res.result || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || '同步失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '分类已同步并合并', icon: 'success' });
      await this.loadCategoriesManage();
      await this.loadCategoriesTree();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '同步失败', icon: 'none' });
    }
  },
  async submitCategory() {
    const name = (this.data.newCatName || '').trim();
    if (!name) return wx.showToast({ title: '请填写分类名称', icon: 'none' });

    const enName = (this.data.newCatEn || 'CATEGORY').trim().toUpperCase();
    const level = this.data.newCatLevel;
    const tree = this.data.categoryManageTree || [];

    wx.showLoading({ title: '添加中...' });
    try {
      if (level === 2) {
        const parent = tree[this.data.newCatParentIndex];
        if (!parent) {
          wx.hideLoading();
          return wx.showToast({ title: '请选择所属一级分类', icon: 'none' });
        }
        const siblings = parent.children || [];
        const dup = siblings.some((c) => c.name === name);
        if (dup) {
          wx.hideLoading();
          return wx.showToast({ title: '该二级分类已存在', icon: 'none' });
        }
        const sortOrder = siblings.reduce((max, c) => Math.max(max, c.sortOrder || 0), 0) + 1;
        const isMerch = parent.categoryType === 'merch' || parent.name === '衍生品';
        await db.collection('categories').add({
          data: buildCategoryDoc({
            name,
            enName,
            sortOrder,
            categoryType: isMerch ? 'merch' : 'specimen',
            taxonomy: { kingdom: '', phylum: '', class: '', order: '', family: '', genus: '' }
          }, 2, parent._id)
        });
      } else {
        const dup = tree.some((c) => c.name === name);
        if (dup) {
          wx.hideLoading();
          return wx.showToast({ title: '该一级分类已存在', icon: 'none' });
        }
        const sortOrder = tree.reduce((max, c) => Math.max(max, c.sortOrder || 0), 0) + 1;
        await db.collection('categories').add({
          data: buildCategoryDoc({
            name,
            enName,
            sortOrder,
            categoryType: name === '衍生品' ? 'merch' : 'specimen',
            taxonomy: { kingdom: '', phylum: '', class: '', order: '', family: '', genus: '' }
          }, 1)
        });
      }
      wx.hideLoading();
      wx.showToast({ title: '已添加', icon: 'success' });
      this.setData({ newCatName: '', newCatEn: '' });
      await this.loadCategoriesManage();
      await this.loadCategoriesTree();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '添加失败', icon: 'none' });
    }
  },
  async deleteCategory(e) {
    const id = e.currentTarget.dataset.id;
    const level = parseInt(e.currentTarget.dataset.level, 10) || 1;
    if (!id) return;

    const title = level === 1 ? '删除一级分类' : '删除二级分类';
    const content = level === 1
      ? '将同时删除其下所有二级分类，确认继续？'
      : '确认删除该二级分类？';

    wx.showModal({
      title,
      content,
      confirmColor: '#C4A76C',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中...' });
        try {
          if (level === 1) {
            const subs = await db.collection('categories').where({ level: 2, parentId: id }).get();
            await Promise.all((subs.data || []).map((s) => db.collection('categories').doc(s._id).remove()));
          }
          await db.collection('categories').doc(id).remove();
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          await this.loadCategoriesManage();
          await this.loadCategoriesTree();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  },
  
  // === 内容管理 ===
  async loadArticles() { 
    try { 
      const res = await db.collection('articles')
        .orderBy('_createTime', 'desc')
        .limit(100)
        .get(); 
      this.setData({ articles: res.data }); 
      this.applyContentFilter();
    } catch(e) { 
      const msg = (e && (e.errMsg || e.message)) || ''
      if (/502005|not exist/i.test(msg)) {
        this.setData({ articles: [], filteredArticles: [] })
        return
      }
      console.error('加载文章失败:', e); 
      wx.showToast({ title: '加载失败', icon: 'none' });
    } 
  },
  async loadExhibitions() { 
    try { 
      const res = await db.collection('cms_wikis')
        .where({ type: 'exhibition' })
        .orderBy('_createTime', 'desc')
        .limit(100)
        .get(); 
      this.setData({ exhibitions: res.data }); 
    } catch(e) { 
      const msg = (e && (e.errMsg || e.message)) || ''
      if (/502005|not exist/i.test(msg)) {
        this.setData({ exhibitions: [] })
        return
      }
      console.error('加载专题失败:', e); 
      wx.showToast({ title: '加载失败', icon: 'none' });
    } 
  },
  async seedCommunityTestData() {
    wx.showLoading({ title: '导入中…' })
    try {
      const result = await callCommunitySeedAction('seed')
      wx.hideLoading()
      if (!result.success) {
        wx.showToast({ title: result.msg || '导入失败', icon: 'none', duration: 3000 })
        return
      }
      wx.showToast({ title: '内容已导入', icon: 'success' })
      this.loadContent()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({
        title: formatCloudFnError(e, '导入失败，请部署 seedCategories'),
        icon: 'none',
        duration: 3000
      })
      console.error('seedCommunityTestData', e)
    }
  },
  clearCommunityTestData() {
    wx.showModal({
      title: '清除种子内容',
      content: '将删除所有由种子脚本导入的社区笔记与专题，是否继续？',
      confirmColor: '#D64045',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '清除中…' })
        try {
          const result = await callCommunitySeedAction('clear')
          wx.hideLoading()
          if (!result.success) {
            wx.showToast({ title: result.msg || '清除失败', icon: 'none' })
            return
          }
          wx.showToast({ title: '已清除', icon: 'success' })
          this.loadContent()
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: formatCloudFnError(e, '清除失败'), icon: 'none' })
        }
      }
    })
  },
  switchContentType(e) { 
    const type = e.currentTarget.dataset.type;
    this.setData({ contentType: type });
    this.loadContent();
  },
  async loadCareGuides() {
    try {
      const res = await db.collection('care_guides').orderBy('category', 'asc').get();
      this.setData({ careGuides: res.data || [] });
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || '';
      if (/502005|not exist/i.test(msg)) {
        this.setData({ careGuides: [] });
        return;
      }
      console.error('loadCareGuides', e);
      wx.showToast({ title: '加载养护指南失败', icon: 'none' });
    }
  },
  async seedCareGuidesFromDefaults() {
    const { GUIDES, CATEGORY_META } = require('../../../utils/careDefaults');
    wx.showLoading({ title: '同步中…' });
    try {
      let synced = 0;
      for (const g of Object.values(GUIDES)) {
        const meta = CATEGORY_META[g.category] || {};
        const payload = {
          guideId: g.guideId,
          category: g.category,
          title: g.title,
          overline: g.overline || meta.overline || g.category,
          summary: g.summary || '',
          disclaimer: g.disclaimer || '',
          sections: g.sections || [],
          framingAddons: g.framingAddons || [],
          status: 'active',
          updateTime: Date.now()
        };
        const existing = await db.collection('care_guides').where({ guideId: g.guideId }).limit(1).get();
        if (existing.data && existing.data.length) {
          const doc = existing.data[0];
          await db.collection('care_guides').doc(doc._id).update({
            data: {
              ...payload,
              version: (doc.version || 1) + 1
            }
          });
        } else {
          await db.collection('care_guides').add({
            data: {
              ...payload,
              version: 1,
              createTime: Date.now()
            }
          });
        }
        synced += 1;
      }
      wx.hideLoading();
      wx.showToast({ title: `已同步 ${synced} 篇`, icon: 'success' });
      this.loadCareGuides();
    } catch (e) {
      wx.hideLoading();
      console.error('seedCareGuidesFromDefaults', e);
      wx.showToast({ title: '同步失败', icon: 'none' });
    }
  },
  openCareGuideModal(e) {
    wx.vibrateShort({ type: 'light' });
    const item = e && e.currentTarget && e.currentTarget.dataset.item;
    const { CATEGORY_META } = require('../../../utils/careDefaults');
    if (item) {
      this.setData({
        showCareGuideModal: true,
        isEditing: true,
        editId: item._id,
        tempCareGuide: {
          guideId: item.guideId || '',
          category: item.category || 'GENERAL',
          title: item.title || '',
          overline: item.overline || '',
          summary: item.summary || '',
          disclaimer: item.disclaimer || '',
          sectionsJson: JSON.stringify(item.sections || [], null, 2),
          status: item.status || 'active',
          version: item.version || 1
        }
      });
      return;
    }
    this.setData({
      showCareGuideModal: true,
      isEditing: false,
      editId: '',
      tempCareGuide: {
        guideId: '',
        category: 'GENERAL',
        title: '',
        overline: CATEGORY_META.GENERAL.overline,
        summary: '',
        disclaimer: '',
        sectionsJson: '[]',
        status: 'active',
        version: 1
      }
    });
  },
  closeCareGuideModal() {
    this.setData({ showCareGuideModal: false });
  },
  bindCareGuideInput(e) {
    this.setData({ [`tempCareGuide.${e.currentTarget.dataset.field}`]: e.detail.value });
  },
  bindCareGuideCategoryChange(e) {
    const idx = Number(e.detail.value) || 0;
    const category = this.data.careCategoryOptions[idx] || 'GENERAL';
    const { CATEGORY_META } = require('../../../utils/careDefaults');
    const meta = CATEGORY_META[category] || {};
    this.setData({
      'tempCareGuide.category': category,
      'tempCareGuide.overline': meta.overline || category
    });
  },
  bindCareGuideStatusChange(e) {
    this.setData({ 'tempCareGuide.status': e.detail.value });
  },
  async submitCareGuide() {
    const g = this.data.tempCareGuide || {};
    if (!g.title || !g.summary) {
      return wx.showToast({ title: '标题与摘要必填', icon: 'none' });
    }
    let sections = [];
    try {
      sections = JSON.parse(g.sectionsJson || '[]');
      if (!Array.isArray(sections)) throw new Error('sections must be array');
    } catch (e) {
      return wx.showToast({ title: '板块 JSON 格式有误', icon: 'none' });
    }
    const guideId = g.guideId || `care_${String(g.category || 'general').toLowerCase()}_v${Date.now()}`;
    const data = {
      guideId,
      category: g.category || 'GENERAL',
      title: g.title.trim(),
      overline: g.overline || g.category,
      summary: g.summary.trim(),
      disclaimer: g.disclaimer || '',
      sections,
      status: g.status || 'active',
      updateTime: Date.now()
    };
    wx.showLoading({ title: '保存…' });
    try {
      if (this.data.isEditing && this.data.editId) {
        await db.collection('care_guides').doc(this.data.editId).update({
          data: { ...data, version: (g.version || 1) + 1 }
        });
      } else {
        await db.collection('care_guides').add({
          data: { ...data, version: 1, createTime: Date.now() }
        });
      }
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showCareGuideModal: false });
      this.loadCareGuides();
    } catch (e) {
      wx.hideLoading();
      console.error('submitCareGuide', e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
  deleteCareGuide(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除养护指南',
      content: '确定删除该指南？小程序将回退到默认内容。',
      confirmColor: '#D64045',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中…' });
        try {
          await db.collection('care_guides').doc(id).remove();
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadCareGuides();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  },
  previewCareGuide(e) {
    const category = e.currentTarget.dataset.category || 'GENERAL';
    wx.navigateTo({
      url: `/pages/care/guide/index?category=${category}&from=manager_preview`
    });
  },
  async processCareRemindersNow() {
    wx.showLoading({ title: '处理中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'sendCareReminder',
        data: { action: 'process' }
      });
      wx.hideLoading();
      const result = res.result || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || '处理失败', icon: 'none' });
        return;
      }
      wx.showToast({
        title: `已处理 ${result.sent || 0} 条`,
        icon: 'none'
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '云函数未部署', icon: 'none' });
    }
  },
  switchCommentFilter(e) {
    const filter = e.currentTarget.dataset.filter;
    this.setData({ commentFilter: filter }, () => this.loadComments());
  },
  async loadComments() {
    try {
      wx.showNavigationBarLoading();
      const res = await wx.cloud.callFunction({
        name: 'moderateComment',
        data: { action: 'list', listFilter: this.data.commentFilter, limit: 50 }
      });
      const list = (res.result && res.result.data) || [];
      this.setData({
        commentList: list.map((c) => ({
          ...c,
          timeText: c.createdAt ? new Date(c.createdAt).toLocaleString() : '',
          statusLabel: c.status === 'approved' ? '已通过' : c.status === 'hidden' ? '已隐藏' : c.status === 'rejected' ? '已拒绝' : '待审核'
        }))
      });
    } catch (e) {
      console.error('loadComments', e);
      wx.showToast({ title: '加载评价失败', icon: 'none' });
    } finally {
      wx.hideNavigationBarLoading();
    }
  },
  async moderateComment(e) {
    const { id, action } = e.currentTarget.dataset;
    if (!id || !action) return;
    if (action === 'reply') {
      this.setData({
        showCommentReplyModal: true,
        tempCommentReply: { commentId: id, content: '' }
      });
      return;
    }
    if (action === 'delete') {
      const confirm = await new Promise((resolve) => {
        wx.showModal({ title: '删除评价', content: '确定删除该评价？', confirmColor: '#D64045', success: (r) => resolve(!!r.confirm) });
      });
      if (!confirm) return;
    }
    wx.showLoading({ title: '处理中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'moderateComment',
        data: { action, commentId: id }
      });
      if (!res.result || !res.result.success) throw new Error((res.result && res.result.msg) || '操作失败');
      wx.showToast({ title: res.result.msg || '完成', icon: 'none' });
      this.loadComments();
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
  bindCommentReplyInput(e) {
    this.setData({ 'tempCommentReply.content': e.detail.value });
  },
  closeCommentReplyModal() {
    this.setData({
      showCommentReplyModal: false,
      tempCommentReply: { commentId: '', content: '' }
    });
  },
  async submitCommentReply() {
    const { commentId, content } = this.data.tempCommentReply || {};
    if (!content || !String(content).trim()) return wx.showToast({ title: '请输入回复', icon: 'none' });
    wx.showLoading({ title: '提交中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'moderateComment',
        data: { action: 'reply', commentId, reply: content }
      });
      if (!res.result || !res.result.success) throw new Error((res.result && res.result.msg) || '回复失败');
      this.closeCommentReplyModal();
      wx.showToast({ title: '回复成功', icon: 'none' });
      this.loadComments();
    } catch (e) {
      wx.showToast({ title: e.message || '回复失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
  // 统一的内容加载方法（与Web端一致）
  async loadContent() {
    if (this.data.contentType === 'exhibition') {
      await this.loadExhibitions();
    } else if (this.data.contentType === 'comment') {
      await this.loadComments();
    } else if (this.data.contentType === 'care') {
      await this.loadCareGuides();
    } else {
      await this.loadArticles();
    }
  },
  // 内容筛选（与Web端保持一致）
  filterContent(e) {
    const filter = e.currentTarget.dataset.filter;
    this.setData({ contentFilter: filter });
    this.applyContentFilter();
  },
  // 应用内容筛选
  applyContentFilter() {
    if (this.data.contentType !== 'article') return;
    
    let filtered = this.data.articles;
    if (this.data.contentFilter === 'published') {
      filtered = filtered.filter(item => item.status === 'published');
    } else if (this.data.contentFilter === 'draft') {
      filtered = filtered.filter(item => item.status === 'draft');
    }
    
    this.setData({ filteredArticles: filtered });
  },
  openContentModal(e) { 
    wx.vibrateShort({ type: 'light' });
    const item = e.currentTarget.dataset.item;
    const type = e.currentTarget.dataset.type || this.data.contentType || 'exhibition';
    const isEditing = !!item;
    
    // 编辑模式：使用现有数据
    if (isEditing && item) {
      const tagsStr = (item.tags && Array.isArray(item.tags)) ? item.tags.join(',') : (item.tagsStr || '');
      const relatedProductIds = item.relatedProductIds || [];
      this.setData({
        showContentModal: true,
        contentType: type,
        isEditing: true,
        editId: item._id,
        tempContent: {
          title: item.title || '',
          latinName: item.latinName || '',
          themeHint: item.themeHint || '',
          coverImage: item.coverImage || item.cover || '',
          brief: item.brief || '',
          content: item.content || '<p>在此处撰写精彩内容...</p>',
          tagsStr: tagsStr,
          category: item.category || 'knowledge',
          author: item.author || '山海造物',
          status: item.status || 'published',
          videoUrl: item.videoUrl || '',
          relatedProductIds,
          type: item.type || type
        }
      });
      this.loadRelatedProductPreview(relatedProductIds);
    } else {
      const defaultContent = {
        title: '',
        latinName: '',
        themeHint: '',
        coverImage: '',
        brief: '',
        content: '<p>在此处撰写精彩内容...</p>',
        tagsStr: type === 'exhibition' ? '专题' : '',
        category: 'knowledge',
        author: '山海造物',
        status: 'published',
        videoUrl: '',
        relatedProductIds: [],
        type: type
      };
      this.setData({
        showContentModal: true,
        contentType: type,
        isEditing: false,
        editId: '',
        tempContent: defaultContent,
        relatedProductPreview: []
      });
    }
  },
  bindContentInput(e) { this.setData({ [`tempContent.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  bindContentCategoryChange(e) { const categories = ['knowledge','art','craft','story']; this.setData({ 'tempContent.category': categories[e.detail.value] }); },
  bindContentStatusChange(e) { this.setData({ 'tempContent.status': e.detail.value }); },
  chooseContentImage() { wx.chooseImage({ count:1, success: res => this.setData({ 'tempContent.coverImage': res.tempFilePaths[0] }) }); },

  async loadRelatedProductPreview(ids) {
    if (!ids || !ids.length) {
      this.setData({ relatedProductPreview: [] });
      return;
    }
    try {
      const res = await db.collection('products').where({ _id: _.in(ids) }).get();
      const map = {};
      (res.data || []).forEach((p) => { map[p._id] = p; });
      const preview = ids.map((id) => {
        const p = map[id];
        if (!p) {
          return { _id: id, title: `未找到(${id.slice(-6)})`, price: '-', image: '', missing: true };
        }
        return {
          _id: p._id,
          title: p.title,
          price: p.price,
          image: (p.images && p.images[0]) || '',
          missing: false
        };
      });
      this.setData({ relatedProductPreview: preview });
    } catch (e) {
      console.error('loadRelatedProductPreview', e);
    }
  },

  async openProductPicker() {
    wx.vibrateShort({ type: 'light' });
    this.setData({ showProductPicker: true, productPickerKeyword: '' });
    await this.loadProductPickerList();
  },

  closeProductPicker() {
    this.setData({ showProductPicker: false });
  },

  onProductPickerSearch(e) {
    this.setData({ productPickerKeyword: e.detail.value });
    clearTimeout(this._pickerTimer);
    this._pickerTimer = setTimeout(() => this.loadProductPickerList(), 400);
  },

  async loadProductPickerList() {
    const kw = (this.data.productPickerKeyword || '').trim();
    const selected = this.data.tempContent.relatedProductIds || [];
    try {
      let res;
      if (kw) {
        res = await db.collection('products').where(_.and([
          { isOffShelf: _.neq(true) },
          { title: db.RegExp({ regexp: kw, options: 'i' }) }
        ])).orderBy('createTime', 'desc').limit(50).get();
      } else {
        res = await db.collection('products')
          .where({ isOffShelf: _.neq(true) })
          .orderBy('createTime', 'desc')
          .limit(50)
          .get();
      }
      const list = (res.data || []).map((p) => ({
        _id: p._id,
        title: p.title,
        price: p.price,
        category: p.category || '',
        image: (p.images && p.images[0]) || '',
        selected: selected.includes(p._id)
      }));
      this.setData({ productPickerList: list });
    } catch (e) {
      console.error('loadProductPickerList', e);
    }
  },

  togglePickerProduct(e) {
    const id = e.currentTarget.dataset.id;
    let ids = [...(this.data.tempContent.relatedProductIds || [])];
    const idx = ids.indexOf(id);
    if (idx >= 0) ids.splice(idx, 1);
    else ids.push(id);
    const list = this.data.productPickerList.map((item) => ({
      ...item,
      selected: ids.includes(item._id)
    }));
    this.setData({
      'tempContent.relatedProductIds': ids,
      productPickerList: list
    });
  },

  confirmProductPicker() {
    const ids = this.data.tempContent.relatedProductIds || [];
    this.loadRelatedProductPreview(ids);
    this.setData({ showProductPicker: false });
  },

  removeRelatedProduct(e) {
    const id = e.currentTarget.dataset.id;
    const ids = (this.data.tempContent.relatedProductIds || []).filter((x) => x !== id);
    this.setData({ 'tempContent.relatedProductIds': ids });
    this.loadRelatedProductPreview(ids);
  },

  async submitContent() {
    const c = this.data.tempContent;
    if(!c.title) return wx.showToast({title:'标题必填',icon:'none'});
    wx.showLoading({title:'保存...'});
    let img = c.coverImage;
    if(img && !img.startsWith('cloud') && !img.startsWith('http')) {
      const up = await wx.cloud.uploadFile({cloudPath:`content/${Date.now()}.png`,filePath:img});
      img = up.fileID;
    }
    const tags = c.tagsStr ? c.tagsStr.split(/[,，]/).map(s => s.trim()).filter(s => s) : [];
    const relatedProductIds = Array.isArray(c.relatedProductIds)
      ? c.relatedProductIds.filter(Boolean)
      : [];
    const collection = c.type === 'exhibition' ? 'cms_wikis' : 'articles';
    const data = c.type === 'exhibition' ? {
      title: c.title, latinName: c.latinName||'', coverImage: img, cover: img, brief: c.brief||'', 
      content: c.content||'', tags: tags, type: c.type || 'exhibition', status: c.status || 'published',
      relatedProductIds,
      _updateTime: Date.now()
    } : {
      title: c.title, brief: c.brief||'', coverImage: img, content: c.content||'', 
      category: c.category||'knowledge', author: c.author||'山海造物', 
      status: c.status||'published', videoUrl: c.videoUrl||'', tags: tags,
      stats: c.stats || { views: 0, likes: 0, comments: 0 },
      updateTime: Date.now()
    };
    try {
      if(this.data.isEditing) {
        await db.collection(collection).doc(this.data.editId).update({data});
      } else {
        data.createTime = db.serverDate();
        data._createTime = Date.now();
        await db.collection(collection).add({data});
      }
      wx.hideLoading();
      wx.showToast({ title: this.data.isEditing ? '更新成功' : '创建成功', icon: 'success' });
      this.setData({showContentModal: false});
      // 重新加载内容
      this.loadContent();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
      console.error('保存内容失败:', e);
    }
  },
  deleteContent(e) { 
    const id = e.currentTarget.dataset.id;
    const type = e.currentTarget.dataset.type;
    const typeText = type === 'exhibition' ? '专题' : '文章';
    wx.showModal({
      title: '删除确认', 
      content: `确定删除该${typeText}吗？此操作不可撤销。`,
      confirmColor: '#ff4d4f',
      success: async (res) => { 
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          try {
            const collection = type === 'exhibition' ? 'cms_wikis' : 'articles';
            await db.collection(collection).doc(id).remove();
            wx.hideLoading();
            wx.showToast({ title: '已删除', icon: 'success' });
            // 重新加载内容
            this.loadContent();
          } catch (e) {
            wx.hideLoading();
            wx.showToast({ title: '删除失败', icon: 'none' });
            console.error('删除失败:', e);
          }
        }
      }
    });
  },
  async loadBookingConfig() { try { const res = await db.collection('configs').doc('booking_config').get(); if (res.data && res.data.image) this.setData({ bookingHero: res.data.image }); } catch (e) {} },

  async loadPushCampaigns() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'messageAdmin',
        data: { action: 'getCampaigns', limit: 30 }
      });
      const list = (res.result && res.result.list) || [];
      this.setData({
        pushCampaigns: list.map((item) => ({
          ...item,
          formatTime: item.createTime ? new Date(item.createTime).toLocaleString() : '',
          scopeLabel: item.scope === 'all' ? '全局' : '指定用户',
          statsText: item.stats ? `送达 ${item.stats.sent}/${item.stats.target}` : ''
        }))
      });
    } catch (e) {
      this.setData({ pushCampaigns: [] });
    }
  },

  async loadAutoMessageLogs() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'messageAdmin',
        data: { action: 'getRecentLogs', limit: 30 }
      });
      const TYPE_LABELS = {
        order_shipped: '发货',
        booking_success: '预约',
        order_paid: '支付',
        order_created: '待付',
        activity_notice: '活动'
      };
      const list = (res.result && res.result.list) || [];
      this.setData({
        autoMessageLogs: list.map((item) => ({
          ...item,
          formatTime: item.sentAt ? new Date(item.sentAt).toLocaleString() : '',
          typeLabel: TYPE_LABELS[item.templateCode] || item.templateCode || '系统',
          recipientMask: item.recipient ? `${String(item.recipient).slice(0, 6)}…` : ''
        }))
      });
    } catch (e) {
      this.setData({ autoMessageLogs: [] });
    }
  },

  async loadSupportTickets() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'messageAdmin',
        data: { action: 'listSupportTickets', status: 'pending' }
      });
      const list = (res.result && res.result.list) || [];
      this.setData({
        supportTickets: list.map((item) => ({
          ...item,
          formatTime: item.createTime ? new Date(item.createTime).toLocaleString() : '',
          openidMask: item._openid ? `${item._openid.slice(0, 6)}…` : ''
        }))
      });
    } catch (e) {
      this.setData({ supportTickets: [] });
    }
  },

  async estimatePushRecipients() {
    const { scope, targetOpenid } = this.data.pushForm;
    try {
      const res = await wx.cloud.callFunction({
        name: 'pushMessage',
        data: { action: 'estimate', scope, targetOpenid }
      });
      this.setData({ pushEstimate: (res.result && res.result.count) || 0 });
    } catch (e) {
      this.setData({ pushEstimate: 0 });
    }
  },

  bindPushInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`pushForm.${field}`]: e.detail.value });
  },

  onPushScopeChange(e) {
    this.setData({ 'pushForm.scope': e.detail.value });
    this.estimatePushRecipients();
  },

  onPushCategoryChange(e) {
    const idx = parseInt(e.detail.value, 10);
    this.setData({ 'pushForm.category': idx === 0 ? 'activity' : 'system' });
  },

  async seedMessageTemplates() {
    wx.showLoading({ title: '初始化...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'dispatchMessage',
        data: { action: 'seedTemplates' }
      });
      wx.hideLoading();
      const r = res.result || {};
      wx.showToast({ title: `已导入 ${r.inserted || 0} 条`, icon: 'none' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '初始化失败', icon: 'none' });
    }
  },

  openPushConfirm() {
    const { title, content, scope, targetOpenid } = this.data.pushForm;
    if (!title.trim() || !content.trim()) {
      return wx.showToast({ title: '请填写标题和正文', icon: 'none' });
    }
    if (scope === 'single' && !targetOpenid.trim()) {
      return wx.showToast({ title: '请填写用户 openid', icon: 'none' });
    }
    this.estimatePushRecipients().then(() => {
      this.setData({ showPushConfirm: true });
    });
  },

  closePushConfirm() {
    this.setData({ showPushConfirm: false });
  },

  async submitPush() {
    const form = this.data.pushForm;
    this.setData({ pushSending: true, showPushConfirm: false });
    wx.showLoading({ title: '发送中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'pushMessage',
        data: {
          action: 'send',
          title: form.title.trim(),
          content: form.content.trim(),
          category: form.category,
          actionUrl: (form.actionUrl || '').trim(),
          scope: form.scope,
          targetOpenid: (form.targetOpenid || '').trim()
        }
      });
      wx.hideLoading();
      const result = res.result || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || '发送失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '发送完成', icon: 'success' });
      this.setData({
        pushSending: false,
        pushForm: { ...form, title: '', content: '', targetOpenid: '' }
      });
      this.loadPushCampaigns();
      this.loadAutoMessageLogs();
    } catch (e) {
      wx.hideLoading();
      this.setData({ pushSending: false });
      wx.showToast({ title: '发送失败', icon: 'none' });
    }
  },

  openTicketReplyModal(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    this.setData({
      showTicketReplyModal: true,
      tempTicketReply: {
        ticketId: item._id,
        content: '',
        topicLabel: item.topicLabel || '咨询'
      }
    });
  },

  closeTicketReplyModal() {
    this.setData({ showTicketReplyModal: false });
  },

  bindTicketReplyInput(e) {
    this.setData({ 'tempTicketReply.content': e.detail.value });
  },

  async submitTicketReply() {
    const { ticketId, content } = this.data.tempTicketReply;
    if (!content.trim()) {
      return wx.showToast({ title: '请填写回复', icon: 'none' });
    }
    wx.showLoading({ title: '发送中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'messageAdmin',
        data: { action: 'replySupportTicket', ticketId, replyContent: content.trim() }
      });
      wx.hideLoading();
      if (!(res.result && res.result.success)) {
        wx.showToast({ title: (res.result && res.result.msg) || '失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '已回复', icon: 'success' });
      this.setData({ showTicketReplyModal: false });
      this.loadSupportTickets();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '发送失败', icon: 'none' });
    }
  },

  async loadAdminStores() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStoreConfig',
        data: { action: 'listStores' }
      })
      const stores = (res.result && res.result.stores) || []
      this.setData({ adminStores: stores })
    } catch (e) {
      console.error('loadAdminStores', e)
      wx.showToast({ title: '加载门店失败', icon: 'none' })
    }
  },

  async loadStoreVisitStats() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'storeCheckIn',
        data: { action: 'getTodayStats' }
      })
      if (res.result && res.result.success) {
        this.setData({ storeVisitStats: res.result.data || { total: 0, byStore: {} } })
      }
    } catch (e) {
      console.warn('loadStoreVisitStats', e)
    }
  },

  openStoreEditModal(e) {
    const item = e.currentTarget.dataset.item
    if (!item) return
    const hours = item.hours || {}
    this.setData({
      showStoreEditModal: true,
      tempStoreEdit: {
        storeId: item.storeId,
        name: item.name || '',
        phone: item.phone || '',
        intro: item.intro || '',
        hoursOpen: hours.open || '10:00',
        hoursClose: hours.close || '22:00',
        visitTipsText: (item.visitTips || []).join('\n')
      }
    })
  },

  closeStoreEditModal() {
    this.setData({ showStoreEditModal: false })
  },

  bindStoreEditInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`tempStoreEdit.${field}`]: e.detail.value })
  },

  async saveStoreEdit() {
    const s = this.data.tempStoreEdit
    if (!s.storeId) return
    wx.showLoading({ title: '保存中…' })
    try {
      const visitTips = (s.visitTipsText || '')
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean)
      const res = await wx.cloud.callFunction({
        name: 'manageStoreConfig',
        data: {
          action: 'updateStore',
          storeId: s.storeId,
          data: {
            name: s.name,
            phone: s.phone,
            intro: s.intro,
            hours: { open: s.hoursOpen, close: s.hoursClose, note: '' },
            visitTips
          }
        }
      })
      wx.hideLoading()
      if (!(res.result && res.result.success)) {
        wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' })
        return
      }
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ showStoreEditModal: false })
      this.loadAdminStores()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  async loadAnalyticsDashboard() {
    this.setData({ analyticsLoading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAnalyticsDashboard',
        data: { action: 'overview', days: this.data.analyticsDays }
      })
      if (res.result && res.result.success && res.result.data) {
        const d = res.result.data
        this.setData({
          analytics: {
            summary: d.summary || {},
            byModule: (d.summary && d.summary.byModule) || [],
            byAction: (d.summary && d.summary.byAction) || [],
            funnel: d.funnel || {},
            dailyTrend: d.dailyTrend || [],
            sampled: !!d.sampled,
            note: d.note || ''
          },
          analyticsLoading: false
        })
      } else {
        this.setData({ analyticsLoading: false })
        wx.showToast({ title: (res.result && res.result.msg) || '加载失败', icon: 'none' })
      }
    } catch (e) {
      console.error('loadAnalyticsDashboard', e)
      this.setData({ analyticsLoading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  setAnalyticsDays(e) {
    const days = parseInt(e.currentTarget.dataset.days, 10) || 7
    this.setData({ analyticsDays: days })
    this.loadAnalyticsDashboard()
  }
});