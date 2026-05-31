// pages/orders/index.js
const app = getApp();
const db = wx.cloud.database();
const _ = db.command;
const { payForOrder } = require('../utils/payment');
const { confirmReceiptOnOrder } = require('../utils/careHelper');
const { ensureOpenId } = require('../../../utils/orderScope');

// 1. 定义严格的状态机枚举 (State Enum)
const ORDER_STATUS = {
  PENDING_PAY: 'pending_pay',   // 待付款
  PENDING_SHIP: 'paid', // 待发货 (已付款)
  SHIPPED: 'shipped',           // 待收货 (已发货)
  SIGNED: 'received',             // 已签收 (已归档)
  AFTERSALES: 'aftersales',     // 售后中
  VOID: 'void'                  // 已作废/取消
};

Page({
  data: {
    // Tab 配置 (注意顺序：0-全部, 1-待付款, 2-待发货, 3-待收货, 4-已签收, 5-售后)
    tabs: [
      { name: '全部', key: 'all' },
      { name: '待付款', key: 'pay' },
      { name: '待发货', key: 'paid' },
      { name: '待收货', key: 'shipped' }, 
      { name: '已签收', key: 'received' }, // 🟢 补全 Tab
      { name: '售后/退款', key: 'refund' }
    ],
    curTab: 0, 
    orders: [],
    loading: true,
    STATUS: ORDER_STATUS
  },

  onLoad(options) {
    // 支持从外部链接带参数跳转
    if (options.type) {
      const typeMap = { all: 0, pay: 1, paid: 2, shipped: 3, received: 4, refund: 5 };
      const targetIndex = typeMap[options.type];
      if (targetIndex !== undefined) {
        this.setData({ curTab: targetIndex });
      }
    }
    this.loadOrders();
  },
  
  onPullDownRefresh() {
    this.loadOrders().then(() => wx.stopPullDownRefresh());
  },

  switchTab(e) {
    const index = e.currentTarget.dataset.index;
    if (index === this.data.curTab) return;
    
    wx.vibrateShort({ type: 'light' });
    
    this.setData({ curTab: index, orders: [], loading: true });
    
    setTimeout(() => {
      this.loadOrders();
    }, 300);
  },

  // 2. 重写列表查询逻辑
  async loadOrders() {
    try {
      const openid = await ensureOpenId(app);
      if (!openid) {
        this.setData({ orders: [], loading: false });
        return;
      }

      let where = { _openid: openid };

      switch (this.data.curTab) {
        case 0:
          where.status = _.neq(ORDER_STATUS.VOID);
          break;
        case 1:
          where.status = ORDER_STATUS.PENDING_PAY;
          break;
        case 2:
          where.status = ORDER_STATUS.PENDING_SHIP;
          break;
        case 3:
          where.status = ORDER_STATUS.SHIPPED;
          break;
        case 4:
          where.status = ORDER_STATUS.SIGNED;
          break;
        case 5:
          where.status = _.in([ORDER_STATUS.AFTERSALES, 'refunded']);
          break;
      }

      const res = await db.collection('orders')
        .where(where)
        .orderBy('createTime', 'desc')
        .get();
      
      const now = Date.now();
      const activeList = [];
      res.data.forEach((item) => {
        if (item.status === ORDER_STATUS.PENDING_PAY && item.payExpireTime) {
          const expired = new Date(item.payExpireTime).getTime() < now;
          if (expired) {
            wx.cloud.callFunction({
              name: 'cancelOrder',
              data: { orderId: item._id, reason: 'expired' }
            }).catch(() => {});
            return;
          }
        }
        activeList.push(item);
      });

      const list = activeList.map(item => ({
        ...item,
        createTimeStr: item.createTime ? new Date(item.createTime).toLocaleDateString() : '',
        statusStr: this.getStatusStr(item.status)
      }));

      this.setData({
        orders: list,
        loading: false
      });

    } catch (err) {
      console.error(err);
      this.setData({ loading: false });
    } finally {
      wx.hideLoading();
    }
  },
  
  getStatusStr(status) {
    const map = {
      [ORDER_STATUS.PENDING_PAY]: '待付款',
      [ORDER_STATUS.PENDING_SHIP]: '待发货',
      [ORDER_STATUS.SHIPPED]: '运输中',
      [ORDER_STATUS.SIGNED]: '已归档',
      [ORDER_STATUS.AFTERSALES]: '售后处理',
      'refunded': '已退款'
    };
    return map[status] || '处理中';
  },

  // 🟢 3. 跳转路由逻辑 (修复)
  handleOrderClick(e) {
    // 优先使用 data-id，如果没有再使用 data-item
    let id = e.currentTarget.dataset.id;
    const item = e.currentTarget.dataset.item;
    
    if (!id && item && item._id) {
      id = item._id;
    }
    
    if (!id) {
      console.error('订单ID异常:', e.currentTarget.dataset);
      wx.showToast({
        title: '订单信息异常',
        icon: 'none'
      });
      return;
    }
    
    wx.vibrateShort({ type: 'light' });

    // 🟢 修复：统一跳转到订单详情页，使用正确的 subpackages 路径
    wx.navigateTo({ 
      url: `/subpackages/business/order-detail/index?id=${id}`,
      success: () => {
        console.log('✅ 跳转到订单详情:', id);
      },
      fail: (err) => {
        console.error('❌ 跳转失败:', err);
        wx.showToast({
          title: '跳转失败: ' + (err.errMsg || '未知错误'),
          icon: 'none',
          duration: 3000
        });
      }
    });
  },
  
  // 复用 goToDetail 方便 WXML 调用
  goToDetail(e) {
     // 包装成 handleOrderClick 需要的格式，或者直接调逻辑
     // 这里为了简单，直接取 ID 跳详情
     const id = e.currentTarget.dataset.id;
     // 🟢 修复：使用正确的 subpackages 路径
     wx.navigateTo({ 
       url: `/subpackages/business/order-detail/index?id=${id}`,
       fail: (err) => {
         console.error('❌ 跳转失败:', err);
         wx.showToast({
           title: '跳转失败',
           icon: 'none'
         });
       }
     });
  },

  // 待付款订单 — 唤起支付
  async handlePay(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;

    wx.vibrateShort({ type: 'medium' });
    try {
      await payForOrder(id);
      wx.showToast({ title: '支付成功', icon: 'success' });
      this.loadOrders();
    } catch (err) {
      if (err.message !== '已取消支付') {
        wx.showToast({ title: err.message || '支付失败', icon: 'none' });
      }
    }
  },

  // 确认签收
  confirmReceipt(e) {
    const id = e.currentTarget.dataset.id;
    const order = (this.data.orders || []).find((o) => o._id === id);
    wx.showModal({
      title: '确认签收',
      content: '确认已收到藏品？\n签收后可查看养护指南与收藏证书。',
      confirmText: '确认签收',
      confirmColor: '#C4A76C',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '确认签收...', mask: true });
        try {
          await confirmReceiptOnOrder(id, order);
          await this.loadOrders();
        } catch (err) {
          console.error(err);
          wx.showToast({ title: '操作失败，请重试', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  }
});