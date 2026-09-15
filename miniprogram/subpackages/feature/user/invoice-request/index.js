// subpackages/feature/user/invoice-request/index.js
const app = getApp();
const db = wx.cloud.database();
const _ = db.command;
const { trackBehavior } = require('../../../../utils/trackBehavior');
const { getPageNavInsets } = require('../../utils/pageNav');
const { ensureOpenId } = require('../../../../utils/orderScope');
const { GMV_STATUSES, orderStatusLabel } = require('../../utils/orderStatus');

function formatOrderTime(value) {
  if (!value) return '';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch (e) {
    return '';
  }
}

function buildProductSummary(products) {
  const list = Array.isArray(products) ? products : [];
  if (!list.length) return '藏品订单';
  const first = list[0];
  const title = (first && (first.title || first.name)) || '藏品';
  if (list.length === 1) {
    const count = Number(first.count) || 1;
    return count > 1 ? `${title} ×${count}` : title;
  }
  return `${title} 等 ${list.length} 件`;
}

Page({
  data: {
    statusBarHeight: 0,
    navPaddingRight: 96,
    headerHeight: 88,

    ordersLoading: true,
    orders: [],
    showOrderSheet: false,

    orderId: '',
    orderNo: '',
    orderSummary: '',
    orderAmount: '',
    orderTimeStr: '',
    orderStatusStr: '',

    invoiceType: 'personal',
    invoiceTitle: '',
    invoiceTaxNo: '',
    invoiceEmail: '',
    invoicePhone: '',
    invoiceRemark: '',
    submitting: false
  },

  onLoad(options) {
    try {
      const nav = getPageNavInsets({ headerExtraRpx: 24, nativeNav: true });
      this.setData({
        statusBarHeight: nav.statusBarHeight,
        navPaddingRight: nav.navPaddingRight,
        headerHeight: nav.statusBarHeight + 72,
        orderId: options.orderId || '',
        orderNo: options.orderNo || ''
      });
    } catch (e) {
      this.setData({
        statusBarHeight: 0,
        navPaddingRight: 96,
        headerHeight: 72,
        orderId: options.orderId || '',
        orderNo: options.orderNo || ''
      });
    }
    this.loadInvoicableOrders();
  },

  async loadInvoicableOrders() {
    this.setData({ ordersLoading: true });
    try {
      const openid = await ensureOpenId(app);
      if (!openid) {
        this.setData({ orders: [], ordersLoading: false });
        this.applyPrefillFromOptions();
        return;
      }

      const res = await db
        .collection('orders')
        .where({
          _openid: openid,
          status: _.in(GMV_STATUSES)
        })
        .orderBy('createTime', 'desc')
        .limit(50)
        .get();

      const orders = (res.data || []).map((item) => ({
        ...item,
        productSummary: buildProductSummary(item.products),
        createTimeStr: formatOrderTime(item.createTime || item.paidTime),
        statusStr: orderStatusLabel(item.status),
        amountStr: item.totalPrice != null ? String(item.totalPrice) : ''
      }));

      this.setData({ orders, ordersLoading: false });
      this.applyPrefill(orders);
    } catch (e) {
      console.error('loadInvoicableOrders failed:', e);
      this.setData({ orders: [], ordersLoading: false });
      this.applyPrefillFromOptions();
      wx.showToast({ title: '订单加载失败', icon: 'none' });
    }
  },

  applyPrefillFromOptions() {
    const { orderNo, orderId } = this.data;
    if (!orderNo && !orderId) return;
    this.setData({
      orderSummary: orderNo ? `订单 ${orderNo}` : '已指定订单',
      orderAmount: '',
      orderTimeStr: '',
      orderStatusStr: ''
    });
  },

  applyPrefill(orders) {
    const list = orders || this.data.orders || [];
    const { orderNo, orderId } = this.data;
    if (!orderNo && !orderId) return;

    let matched = null;
    if (orderId) {
      matched = list.find((o) => o._id === orderId) || null;
    }
    if (!matched && orderNo) {
      matched = list.find((o) => o.orderNo === orderNo) || null;
    }

    if (matched) {
      this.selectOrderItem(matched);
    } else {
      this.applyPrefillFromOptions();
    }
  },

  openOrderSheet() {
    if (this.data.ordersLoading) {
      wx.showToast({ title: '订单加载中…', icon: 'none' });
      return;
    }
    this.setData({ showOrderSheet: true });
  },

  closeOrderSheet() {
    this.setData({ showOrderSheet: false });
  },

  selectOrderFromSheet(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.orders[index];
    if (!item) return;
    this.selectOrderItem(item);
    this.setData({ showOrderSheet: false });
  },

  selectOrderItem(item) {
    if (!item) return;
    this.setData({
      orderId: item._id || '',
      orderNo: item.orderNo || '',
      orderSummary: item.productSummary || buildProductSummary(item.products),
      orderAmount: item.amountStr != null ? item.amountStr : (item.totalPrice != null ? String(item.totalPrice) : ''),
      orderTimeStr: item.createTimeStr || formatOrderTime(item.createTime || item.paidTime),
      orderStatusStr: item.statusStr || orderStatusLabel(item.status)
    });
  },

  goOrders() {
    wx.navigateTo({
      url: '/subpackages/business/orders/index',
      fail: () => wx.showToast({ title: '无法打开订单', icon: 'none' })
    });
  },

  onFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [field]: e.detail.value });
  },

  selectInvoiceType(e) {
    const type = e.currentTarget.dataset.type;
    if (!type || type === this.data.invoiceType) return;
    this.setData({ invoiceType: type });
  },

  async submitInvoiceRequest() {
    if (this.data.submitting) return;

    const orderNo = (this.data.orderNo || '').trim();
    const orderId = (this.data.orderId || '').trim();
    const invoiceType = this.data.invoiceType || 'personal';
    const title = (this.data.invoiceTitle || '').trim();
    const taxNo = (this.data.invoiceTaxNo || '').trim();
    const email = (this.data.invoiceEmail || '').trim();
    const phone = (this.data.invoicePhone || '').trim();
    const remark = (this.data.invoiceRemark || '').trim();

    if (!orderNo) {
      wx.showToast({ title: '请选择订单', icon: 'none' });
      return;
    }
    if (!title) {
      wx.showToast({ title: '请填写发票抬头', icon: 'none' });
      return;
    }
    if (invoiceType === 'company' && !taxNo) {
      wx.showToast({ title: '企业抬头请填写税号', icon: 'none' });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      wx.showToast({ title: '邮箱格式有误', icon: 'none' });
      return;
    }
    if (phone && !/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请填写 11 位手机号', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中…', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'submitInvoiceRequest',
        data: {
          orderNo,
          orderId,
          invoiceType,
          title,
          taxNo: invoiceType === 'company' ? taxNo : '',
          email,
          phone,
          remark,
          source: 'invoice_request_page'
        }
      });
      wx.hideLoading();

      if (res.result && res.result.success) {
        this.setData({
          invoiceTitle: '',
          invoiceTaxNo: '',
          invoiceEmail: '',
          invoiceRemark: ''
        });
        wx.showToast({ title: '申请已提交', icon: 'success' });
        trackBehavior('invoice_request_submit', 'orderNo', orderNo, { orderId });
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
      fail: () =>
        wx.redirectTo({
          url: '/subpackages/feature/user/support/index',
          fail: () => wx.switchTab({ url: '/pages/user/index' })
        })
    });
  },

  noop() {}
});
