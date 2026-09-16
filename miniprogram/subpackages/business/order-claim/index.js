const {
  ORDER_BIND_STATUS_TEXT,
  RECEIPT_CLAIM_STATUS_TEXT
} = require('../utils/storePoints');
const { fetchStoreCatalog, mapStoreOptions } = require('../../../utils/storeCatalog');
const { ensureOpenId } = require('../../../utils/orderScope');
const app = getApp();

const STATUS_SHORT = {
  pending: '待审',
  approved: '通过',
  rejected: '驳回'
};

function formatRecordTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function mapClaimRow(row, statusMap) {
  const status = row.status || '';
  return {
    ...row,
    statusText: STATUS_SHORT[status] || statusMap[status] || status,
    statusClass: status || 'pending',
    timeText: formatRecordTime(row.createTime)
  };
}

Page({
  data: {
    mode: 'receipt',

    receiptClaimEnabled: false,
    receiptClaimRuleText: '',
    receiptClaimNotice: '',
    receiptForm: { amount: '', remark: '' },
    receiptLocalPaths: [],
    receiptSubmitting: false,
    receiptClaimList: [],
    storeNames: [],
    storeOptions: [],
    receiptStoreIndex: 0,

    orderBindEnabled: false,
    /** 外部订单开关**加载失败**（区别于「后台确实关闭」） */
    orderBindLoadError: false,
    orderBindPlatforms: [],
    orderBindPlatformNames: [],
    orderBindPlatformIndex: 0,
    orderBindForm: { orderNo: '', amount: '', remark: '' },
    orderBindRuleText: '',
    orderBindNotice: '',
    orderBindSubmitting: false,
    orderBindList: [],

    optionsReady: false
  },

  onLoad(query) {
    const mode = String((query && query.mode) || '').trim();
    if (mode === 'order' || mode === 'receipt') {
      this.setData({ mode });
    }
  },

  onShow() {
    this.refreshAll();
  },

  onPullDownRefresh() {
    this.refreshAll().finally(() => wx.stopPullDownRefresh());
  },

  async refreshAll() {
    await this.loadStoreOptions();
    await Promise.all([
      this.loadReceiptClaimOptions(),
      this.loadOrderBindOptions()
    ]);
    let mode = this.data.mode;
    if (mode === 'receipt' && !this.data.receiptClaimEnabled && this.data.orderBindEnabled) {
      mode = 'order';
    } else if (mode === 'order' && !this.data.orderBindEnabled && this.data.receiptClaimEnabled) {
      mode = 'receipt';
    }
    this.setData({ optionsReady: true, mode });
    this.loadActiveHistory();
  },

  async loadStoreOptions() {
    try {
      const catalog = await fetchStoreCatalog();
      const storeOptions = mapStoreOptions(catalog);
      this.setData({
        storeOptions,
        storeNames: storeOptions.map((s) => s.name)
      });
    } catch (e) {
      console.warn('loadStoreOptions', e);
    }
  },

  loadActiveHistory() {
    if (this.data.mode === 'receipt') this.loadReceiptClaimMine();
    else this.loadOrderBindMine();
  },

  switchMode(e) {
    const mode = String((e.currentTarget.dataset && e.currentTarget.dataset.mode) || '');
    if (!mode || mode === this.data.mode) return;
    if (mode === 'receipt' && !this.data.receiptClaimEnabled) {
      wx.showToast({ title: '小票认领暂未开放', icon: 'none' });
      return;
    }
    if (mode === 'order' && !this.data.orderBindEnabled) {
      if (this.data.orderBindLoadError) {
        wx.showModal({
          title: '外部订单认领加载失败',
          content: '网络或服务暂时不可用，请稍后重试。',
          confirmText: '重试',
          cancelText: '取消',
          confirmColor: '#C4A76C',
          success: (r) => { if (r.confirm) this.loadOrderBindOptions(); }
        });
        return;
      }
      wx.showToast({ title: '外部订单认领暂未开放', icon: 'none' });
      return;
    }
    this.setData({ mode });
    if (mode === 'receipt') this.loadReceiptClaimMine();
    else this.loadOrderBindMine();
  },

  // ------------------------------------------------------------ 门店小票

  async loadReceiptClaimOptions() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'claimStoreReceipt',
        data: { action: 'getOptions' }
      });
      const result = (res && res.result) || {};
      this.setData({
        receiptClaimEnabled: !!result.enabled,
        receiptClaimRuleText: result.ruleText || '',
        receiptClaimNotice: result.notice || ''
      });
    } catch (e) {
      console.warn('loadReceiptClaimOptions', e);
    }
  },

  async loadReceiptClaimMine() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'claimStoreReceipt',
        data: { action: 'listMine', page: 1, pageSize: 20 }
      });
      const result = (res && res.result) || {};
      this.setData({
        receiptClaimList: (result.list || []).map((row) =>
          mapClaimRow(row, RECEIPT_CLAIM_STATUS_TEXT)
        )
      });
    } catch (e) {
      console.warn('loadReceiptClaimMine', e);
    }
  },

  onReceiptStoreChange(e) {
    this.setData({ receiptStoreIndex: parseInt(e.detail.value, 10) || 0 });
  },

  onReceiptInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`receiptForm.${field}`]: e.detail.value });
  },

  chooseReceiptImages() {
    const remain = 3 - (this.data.receiptLocalPaths || []).length;
    if (remain <= 0) return;
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean);
        this.setData({
          receiptLocalPaths: (this.data.receiptLocalPaths || []).concat(paths).slice(0, 3)
        });
      }
    });
  },

  removeReceiptImage(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    if (!Number.isFinite(idx)) return;
    const list = (this.data.receiptLocalPaths || []).slice();
    list.splice(idx, 1);
    this.setData({ receiptLocalPaths: list });
  },

  previewReceiptImage(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10) || 0;
    const urls = this.data.receiptLocalPaths || [];
    if (!urls.length) return;
    wx.previewImage({ current: urls[idx], urls });
  },

  async uploadReceiptImages() {
    const locals = this.data.receiptLocalPaths || [];
    if (!locals.length) return [];
    const openid = await ensureOpenId(app);
    const oid = String(openid || 'guest').slice(-6);
    const fileIds = [];
    for (let i = 0; i < locals.length; i += 1) {
      const cloudPath = `receipt-claims/${oid}/${Date.now()}_${i}.jpg`;
      const up = await wx.cloud.uploadFile({
        cloudPath,
        filePath: locals[i]
      });
      if (!up || !up.fileID) throw new Error('图片上传失败');
      fileIds.push(up.fileID);
    }
    return fileIds;
  },

  async submitReceiptClaim() {
    if (this.data.receiptSubmitting || !this.data.receiptClaimEnabled) return;
    const form = this.data.receiptForm || {};
    const amount = String(form.amount || '').trim();
    if (!amount) {
      wx.showToast({ title: '请填写实付金额', icon: 'none' });
      return;
    }
    if (!(this.data.receiptLocalPaths || []).length) {
      wx.showToast({ title: '请上传小票照片', icon: 'none' });
      return;
    }
    const store = (this.data.storeOptions || [])[this.data.receiptStoreIndex] || {};
    this.setData({ receiptSubmitting: true });
    wx.showLoading({ title: '上传中…' });
    try {
      const images = await this.uploadReceiptImages();
      wx.showLoading({ title: '提交中…' });
      const res = await wx.cloud.callFunction({
        name: 'claimStoreReceipt',
        data: {
          action: 'submit',
          images,
          amount,
          remark: form.remark,
          storeId: store.storeId || '',
          storeName: store.name || ''
        }
      });
      wx.hideLoading();
      this.setData({ receiptSubmitting: false });
      const result = (res && res.result) || {};
      if (!result.success) {
        wx.showModal({
          title: '提交失败',
          content: result.msg || '请稍后重试',
          showCancel: false,
          confirmColor: '#C4A76C'
        });
        return;
      }
      wx.showModal({
        title: '已提交',
        content: result.msg || '等待专员审核，通常 3 个工作日内完成。',
        showCancel: false,
        confirmColor: '#C4A76C'
      });
      this.setData({
        receiptForm: { amount: '', remark: '' },
        receiptLocalPaths: []
      });
      this.loadReceiptClaimMine();
    } catch (e) {
      wx.hideLoading();
      this.setData({ receiptSubmitting: false });
      wx.showToast({ title: (e && e.message) || '网络错误', icon: 'none' });
    }
  },

  // ------------------------------------------------------------ 外部订单

  async loadOrderBindOptions() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'bindPlatformOrder',
        data: { action: 'getOptions' }
      });
      const result = (res && res.result) || {};
      const platforms = result.platforms || [];
      this.setData({
        orderBindEnabled: !!result.enabled,
        orderBindLoadError: false,
        orderBindPlatforms: platforms,
        orderBindPlatformNames: platforms.map((p) => p.name),
        orderBindPlatformIndex: 0,
        orderBindRuleText: result.ruleText || '',
        orderBindNotice: result.notice || ''
      });
    } catch (e) {
      // 网络/云函数失败 ≠ 功能未开放：此前一律落到「暂未开放」，用户与客服都会误判
      console.warn('loadOrderBindOptions', e);
      this.setData({ orderBindLoadError: true });
    }
  },

  async loadOrderBindMine() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'bindPlatformOrder',
        data: { action: 'listMine', page: 1, pageSize: 20 }
      });
      const result = (res && res.result) || {};
      this.setData({
        orderBindList: (result.list || []).map((row) =>
          mapClaimRow(row, ORDER_BIND_STATUS_TEXT)
        )
      });
    } catch (e) {
      console.warn('loadOrderBindMine', e);
    }
  },

  onOrderBindPlatformChange(e) {
    this.setData({ orderBindPlatformIndex: parseInt(e.detail.value, 10) || 0 });
  },

  onOrderBindInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`orderBindForm.${field}`]: e.detail.value });
  },

  async submitOrderBind() {
    if (this.data.orderBindSubmitting || !this.data.orderBindEnabled) return;
    const platforms = this.data.orderBindPlatforms || [];
    const platform = platforms[this.data.orderBindPlatformIndex];
    if (!platform) {
      wx.showToast({ title: '请选择平台', icon: 'none' });
      return;
    }
    const form = this.data.orderBindForm || {};
    const orderNo = String(form.orderNo || '').trim();
    if (!orderNo) {
      wx.showToast({ title: '请填写订单号', icon: 'none' });
      return;
    }
    if (!String(form.amount || '').trim()) {
      wx.showToast({ title: '请填写实付金额', icon: 'none' });
      return;
    }
    this.setData({ orderBindSubmitting: true });
    wx.showLoading({ title: '提交中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'bindPlatformOrder',
        data: {
          action: 'submit',
          platformId: platform.id,
          orderNo,
          amount: form.amount,
          remark: form.remark
        }
      });
      wx.hideLoading();
      this.setData({ orderBindSubmitting: false });
      const result = (res && res.result) || {};
      if (!result.success) {
        wx.showModal({
          title: '提交失败',
          content: result.msg || '请稍后重试',
          showCancel: false,
          confirmColor: '#C4A76C'
        });
        return;
      }
      const preview = result.previewPoints != null ? `\n预估 +${result.previewPoints} 分` : '';
      wx.showModal({
        title: '已提交',
        content: (result.msg || '等待专员审核') + preview + '\n通常 3 个工作日内完成核对。',
        showCancel: false,
        confirmColor: '#C4A76C'
      });
      this.setData({ orderBindForm: { orderNo: '', amount: '', remark: '' } });
      this.loadOrderBindMine();
    } catch (e) {
      wx.hideLoading();
      this.setData({ orderBindSubmitting: false });
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  }
});
