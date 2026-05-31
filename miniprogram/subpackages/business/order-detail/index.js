// pages/order-detail/index.js
const app = getApp();
const db = wx.cloud.database();
const { payForOrder } = require('../utils/payment');
const { buildPreviewSummary } = require('../../../utils/customHelper');
const { PRODUCTION_STATUS_LABELS } = require('../../../utils/customDefaults');
const { resolveCareContext, confirmReceiptOnOrder } = require('../utils/careHelper');
const { buildGuideUrl } = require('../../../utils/careDefaults');
const { ensureOpenId, isOrderOwnedBy, denyOrderAccess } = require('../../../utils/orderScope');

Page({
  data: {
    // 页面数据容器
    order: {},
    loading: true,
    
    // UI 状态控制
    stampClass: '',       // 印章样式类 (warn/active/success/void)
    stampText: '',        // 印章文字 (PENDING/ARCHIVED...)
    isDecrypted: false,   // 控制档案袋解密动画
    
    // 模拟物流节点 (仅作展示用)
    logistics: [],

    showCare: false,
    careContext: {}
  },

  onLoad(options) {
    // 页面加载时获取 ID
    if (options.id) {
      this.loadOrderDetail(options.id);
    }
  },

  // 🟢 核心：加载订单详情
  async loadOrderDetail(id) {
    wx.showNavigationBarLoading();
    
    try {
      const openid = await ensureOpenId(app);
      if (!openid) {
        denyOrderAccess();
        return;
      }

      const res = await db.collection('orders').doc(id).get();
      const data = res.data;

      if (!isOrderOwnedBy(data, openid)) {
        this.setData({ loading: false });
        denyOrderAccess();
        return;
      }
      
      // 2. 格式化时间与编号
      const dateObj = data.createTime ? new Date(data.createTime) : new Date();
      // 格式化为 2025.11.22
      const dateStr = dateObj.toLocaleDateString().replace(/\//g, '.');
      // 伪造一个更有“档案感”的序列号
      const serialNo = `ARC-${data.orderNo.substr(-6)}-${dateObj.getFullYear()}`;

      // 3. 金额数据清洗 (防止 undefined 计算报错)
      // 数据库存的 totalPrice 可能是字符串 "1,200.00" 也可能是数字
      const total = parseFloat(data.totalPrice.toString().replace(/,/g, ''));
      const original = data.originalPrice 
        ? parseFloat(data.originalPrice.toString().replace(/,/g, '')) 
        : total;
      const coupon = parseFloat(data.couponValue || 0);
      
      // 计算实际优惠金额 (用于展示省了多少钱)
      let discountAmt = (original - total - coupon).toFixed(2);
      if (discountAmt < 0) discountAmt = 0;

      // 4. 状态机映射 (核心 UI 控制)
      let sClass = 'normal';
      let sText = '处理中';
      let isExpired = false;

      if (data.status === 'pending_pay' && data.payExpireTime) {
        isExpired = new Date(data.payExpireTime).getTime() < Date.now();
        if (isExpired) {
          await this.voidExpiredOrder(id);
          data.status = 'void';
        }
      }
      
      switch(data.status) {
        case 'pending_pay': // 待付款
          sClass = 'void'; 
          sText = '待支付'; 
          break;
        case 'void':
          sClass = 'void';
          sText = '已取消';
          break;
        case 'paid':        // 待发货
          sClass = 'warn'; 
          sText = '待发货'; 
          break;    
        case 'shipped':     // 运输中
          sClass = 'active'; 
          sText = '运输中'; 
          break; 
        case 'received':    // 已归档
          sClass = 'success'; 
          sText = '已签收'; 
          break; 
        case 'refunding':   // 售后中
          sClass = 'error'; 
          sText = '退款中'; 
          break; 
        case 'refunded':    // 已退款
          sClass = 'void'; 
          sText = '已退款'; 
          break;        
      }

      // 🟢 判断是否为代金券订单（代金券无法评价）
      // 判断条件：source === 'exchange' 或商品中包含代金券标识
      const isVoucherOrder = data.source === 'exchange' || 
        (data.products && data.products.some(p => {
          // 检查价格是否为字符串且包含 PTS（积分商品）
          const priceStr = p.price ? String(p.price) : '';
          const isPTSPrice = priceStr.includes('PTS') || priceStr.includes('积分');
          // 检查商品类型标识
          const latinUpper = p.latin ? String(p.latin).toUpperCase() : '';
          const isVoucherType = latinUpper === 'COUPON' || latinUpper === 'VOUCHER' || latinUpper.includes('COUPON');
          return isPTSPrice || isVoucherType;
        }));

      // 5. 更新数据到页面
      const orderPayload = {
          ...data,
          _id: data._id,
          archiveDate: dateStr,
          serialNo: serialNo,
          
          // 确保金额显示为两位小数
          totalPrice: total.toLocaleString('en-US', { minimumFractionDigits: 2 }),
          originalPrice: original.toLocaleString('en-US', { minimumFractionDigits: 2 }),
          discountAmount: discountAmt,
          couponValue: coupon,
          discountRate: data.discountRate || 1.0,

          // 🟢 关键：确保物流对象存在，防止 WXML 报错
          logistics: data.logistics || { 
            carrier: '等待揽收', 
            trackingNumber: '---' 
          }
        };

      const careContext = await resolveCareContext(orderPayload);

      this.setData({ 
        order: orderPayload,
        isVoucherOrder: isVoucherOrder, // 标识是否为代金券订单
        customPreviewLines: data.customMeta ? buildPreviewSummary(data.customMeta) : [],
        isCustomOrder: !!(data.customMeta && data.customMeta.isCustom),
        productionStatusLabel: data.productionStatus
          ? (PRODUCTION_STATUS_LABELS[data.productionStatus] || '')
          : '',
        stampClass: sClass,
        stampText: sText,
        isExpired: isExpired,
        loading: false,
        showCare: careContext.showCare,
        careContext
      });
      
      wx.hideNavigationBarLoading();

      // 6. 启动解密动画 (延迟 300ms 让页面先渲染，提升体验)
      setTimeout(() => {
          this.setData({ isDecrypted: true });
      }, 300);

    } catch (err) {
      console.error('订单加载失败', err);
      wx.showToast({ title: '档案读取失败', icon: 'none' });
      wx.hideNavigationBarLoading();
    }
  },

  // 待付款 — 唤起支付
  async handlePay() {
    const orderId = this.data.order._id;
    if (!orderId) return;

    if (this.data.order.payExpireTime && new Date(this.data.order.payExpireTime).getTime() < Date.now()) {
      wx.showToast({ title: '订单已过期', icon: 'none' });
      this.loadOrderDetail(orderId);
      return;
    }

    wx.vibrateShort({ type: 'medium' });
    try {
      await payForOrder(orderId);
      wx.showToast({ title: '支付成功', icon: 'success' });
      this.loadOrderDetail(orderId);
    } catch (err) {
      if (err.message !== '已取消支付') {
        wx.showToast({ title: err.message || '支付失败', icon: 'none' });
      }
    }
  },

  async voidExpiredOrder(orderId) {
    try {
      await wx.cloud.callFunction({
        name: 'cancelOrder',
        data: { orderId, reason: 'expired' }
      });
    } catch (e) {
      console.warn('voidExpiredOrder', e);
    }
  },

  handleCancelOrder() {
    const orderId = this.data.order._id;
    if (!orderId) return;

    wx.showModal({
      title: '取消订单',
      content: '确定取消该待付款订单？',
      confirmColor: '#D64045',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '取消中...' });
        try {
          const result = await wx.cloud.callFunction({
            name: 'cancelOrder',
            data: { orderId, reason: 'user' }
          });
          wx.hideLoading();
          if (result.result && result.result.success) {
            wx.showToast({ title: '已取消', icon: 'success' });
            this.loadOrderDetail(orderId);
          } else {
            wx.showToast({ title: (result.result && result.result.msg) || '取消失败', icon: 'none' });
          }
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      }
    });
  },

  // 🟢 交互：复制物流单号
  copyTracking() {
    const no = this.data.order.logistics.trackingNumber;
    // 如果没有单号或单号无效，不执行
    if (!no || no === '---') return;
    
    wx.vibrateShort({ type: 'light' });
    wx.setClipboardData({
      data: no,
      success: () => wx.showToast({ title: '单号已复制', icon: 'none' })
    });
  },

  // 🟢 交互：复制档案编号
  copyOrderNo() {
    wx.vibrateShort({ type: 'light' });
    wx.setClipboardData({
      data: this.data.order.orderNo,
      success: () => wx.showToast({ title: '编号已复制', icon: 'none' })
    });
  },

  // 🟢 核心业务：确认收货 (闭环最后一步)
  confirmReceipt() {
    wx.vibrateShort({ type: 'heavy' }); // 重震动提醒重要性
    
    wx.showModal({
      title: '确认签收',
      content: '确认已收到藏品？\n签收后将生成收藏证书，并为您提供养护指南。',
      confirmText: '确认签收',
      confirmColor: '#C4A76C',
      cancelColor: '#999999',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '确认签收...', mask: true });
          
          try {
            const orderSnapshot = { ...this.data.order };
            await confirmReceiptOnOrder(this.data.order._id, orderSnapshot);
            await this.loadOrderDetail(this.data.order._id);
          } catch (err) {
            console.error(err);
            wx.showToast({ title: '操作失败，请重试', icon: 'none' });
          } finally {
            wx.hideLoading();
          }
        }
      }
    });
  },

  // 申请退款 (仅限已付款状态)
  requestRefund() {
    wx.vibrateShort({ type: 'medium' });
    wx.showModal({
      title: '申请撤回',
      content: '确定要将该藏品退回博物馆吗？\n此操作不可逆，且需审核。',
      confirmText: '确认退回',
      confirmColor: '#C4A76C',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '提交申请...' });
          try {
            await db.collection('orders').doc(this.data.order._id).update({
              data: { status: 'refunding' } 
            });
            wx.hideLoading();
            wx.showToast({ title: '申请已提交', icon: 'success' });
            // 刷新页面
            this.loadOrderDetail(this.data.order._id);
          } catch (err) { 
            wx.hideLoading();
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 查看证书 (跳转证书页)
  viewCertificate() {
    wx.vibrateShort({ type: 'heavy' });
    const orderId = this.data.order._id;
    
    if (!orderId) return;
    
    wx.navigateTo({ 
      url: `/subpackages/business/certificate/index?id=${orderId}`,
      fail: () => wx.showToast({ title: '证书系统维护中', icon: 'none' })
    });
  },

  goToCare() {
    const ctx = this.data.careContext || {};
    if (!ctx.showCare) {
      wx.navigateTo({ url: '/pages/care/index?from=order' });
      return;
    }
    wx.navigateTo({
      url: ctx.guideUrl || buildGuideUrl({
        category: ctx.category,
        orderId: this.data.order._id,
        productId: ctx.productId,
        from: 'order'
      })
    });
  },

  // 点击商品卡片跳转详情
  goToProduct(e) {
    const id = e.currentTarget.dataset.id;
    if (id) {
      wx.navigateTo({ url: `/pages/detail/index?id=${id}` });
    }
  },

  // 🟢 统一评价入口：跳转到第一个商品的评价页面
  goToComment() {
    if (!this.data.order || !this.data.order.products || this.data.order.products.length === 0) {
      wx.showToast({
        title: '暂无商品可评价',
        icon: 'none'
      });
      return;
    }
    
    const firstProduct = this.data.order.products[0];
    const productId = firstProduct.id || firstProduct._id || firstProduct.productId;
    
    if (!productId) {
      wx.showToast({
        title: '商品信息异常',
        icon: 'none'
      });
      return;
    }
    
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({
      url: `/pages/comment/index?targetType=product&targetId=${productId}`,
      success: () => {
        console.log('✅ 跳转到评价页面:', productId);
      },
      fail: (err) => {
        console.error('❌ 跳转失败:', err);
        wx.showToast({
          title: '跳转失败',
          icon: 'none'
        });
      }
    });
  },


  // 联系专员（带订单上下文）
  goToSupport() {
    const order = this.data.order || {};
    if (!order._id) {
      wx.navigateTo({ url: '/pages/user/support/index?topic=order' });
      return;
    }
    wx.navigateTo({
      url: `/pages/user/support/index?topic=order&orderId=${order._id}&orderNo=${order.orderNo || ''}`
    });
  },

  // 返回大厅
  goHome() { 
    wx.switchTab({ url: '/pages/index/index' }); 
  }
});