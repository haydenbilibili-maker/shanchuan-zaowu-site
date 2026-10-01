// pages/orders/index.js
const app = getApp();
const db = wx.cloud.database();
const _ = db.command;
const { payForOrder } = require('../utils/payment');
const { confirmReceiptOnOrder } = require('../utils/careHelper');
const { withAppModal } = require('../../../utils/appModal');
const {
  ensureOpenId,
  isOrderOwnedBy,
  isGiftReceiverOf
} = require('../../../utils/orderScope');
const { resolveDepositDisplay } = require('../utils/depositOrderDisplay');

// 1. 定义严格的状态机枚举 (State Enum)
const ORDER_STATUS = {
  PENDING_PAY: 'pending_pay',   // 待付款
  PENDING_SHIP: 'paid', // 待发货 (已付款)
  SHIPPED: 'shipped',           // 待收货 (已发货)
  SIGNED: 'received',             // 已签收 (已归档)
  AFTERSALES: 'aftersales',     // 售后中
  VOID: 'void'                  // 已作废/取消
};

/**
 * 订单卡评价入口：reviewState 来自 submitComment.orderReviewMap。
 * 还没回来（undefined）两样都不显示，免得先闪「写下感受」；查询失败记为 unknown，仍给入口（评价页自己会判资格）。
 * hidden 在服务端算 done（不允许重评），所以不会出现「写下感受」。
 */
function reviewFlags(reviewState) {
  return {
    reviewCanWrite: reviewState === 'none' || reviewState === 'partial' || reviewState === 'unknown',
    reviewChip: reviewState === 'pending' ? '审核中' : reviewState === 'done' ? '✓ 已评价' : ''
  };
}

const REVIEW_MAP_BATCH = 100;

/** 合并「我是买家」与「我是礼赠受礼人」两路查询，按 createTime 去重降序 */
function mergeOrderRows(ownedRows, receivedRows, openid) {
  const map = {};
  (ownedRows || []).forEach((row) => {
    if (row && row._id) map[row._id] = row;
  });
  (receivedRows || []).forEach((row) => {
    if (!row || !row._id) return;
    // 仅纳入已绑定受礼人、且非本人送出的礼赠单
    if (!isGiftReceiverOf(row, openid)) return;
    if (isOrderOwnedBy(row, openid)) return;
    if (!map[row._id]) map[row._id] = row;
  });
  return Object.keys(map)
    .map((id) => map[id])
    .sort((a, b) => {
      const ta = a.createTime ? new Date(a.createTime).getTime() : 0;
      const tb = b.createTime ? new Date(b.createTime).getTime() : 0;
      return tb - ta;
    });
}

Page(withAppModal({
  data: {
    // Tab 配置 (注意顺序：0-全部, 1-待付款, 2-待发货, 3-待收货, 4-已签收, 5-售后)
    tabs: [
      { name: '全部', key: 'all', emptyTitle: '还没有订单', emptyDesc: '入藏的每一件都会在这里留档' },
      { name: '待付款', key: 'pay', emptyTitle: '没有待付款的订单', emptyDesc: '下单后未完成支付的会停在这里' },
      { name: '待发货', key: 'paid', emptyTitle: '没有待发货的订单', emptyDesc: '支付完成后，专员备妥即会发出' },
      { name: '待收货', key: 'shipped', emptyTitle: '没有在路上的藏品', emptyDesc: '发货后可在这里查看物流与签收' },
      { name: '已签收', key: 'received', emptyTitle: '还没有签收的藏品', emptyDesc: '签收后可写下感受、查看收藏证书' },
      { name: '售后/退款', key: 'refund', emptyTitle: '没有售后记录', emptyDesc: '如需售后，可在订单详情里发起' }
    ],
    curTab: 0, 
    payingId: '',
    orders: [],
    loading: true,
    loadError: false,
    STATUS: ORDER_STATUS
  },

  onLoad(options) {
    // 支持从外部链接带参数跳转
    if (options.type) {
      const typeMap = { all: 0, pay: 1, pending_pay: 1, paid: 2, shipped: 3, received: 4, refund: 5 };
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

  /** 触底加载更多（每次 +20 条，直到服务端返回不足一页） */
  async onReachBottom() {
    if (this.data.loadingMore || this.data.curTab !== 0 || !this.data.ownedHasMore) return;
    this.setData({ loadingMore: true });
    try {
      await this.loadMoreOwned();
    } finally {
      this.setData({ loadingMore: false });
    }
  },

  /** 加载更多：扩大买家侧取数上限后重载（保持既有合并/排序逻辑不变） */
  loadMoreOwned() {
    if (this.data.loadingMore || !this.data.ownedHasMore) return Promise.resolve();
    this.setData({ ownedPageSize: (Number(this.data.ownedPageSize) || 20) + 20 });
    return this.loadOrders();
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

  // 2. 列表：买家 openid ∪ 礼赠受礼人 giftMeta.receiverOpenid
  async loadOrders() {
    try {
      const openid = await ensureOpenId(app);
      if (!openid) {
        this.setData({ orders: [], loading: false, loadError: false });
        return;
      }

      const statusFilter = {};
      switch (this.data.curTab) {
        case 0:
          statusFilter.status = _.neq(ORDER_STATUS.VOID);
          break;
        case 1:
          statusFilter.status = _.in([ORDER_STATUS.PENDING_PAY, 'fulfilling']);
          break;
        case 2:
          // 含门店自取 ready_pickup（列表文案为「待自取」，勿进待收货）
          statusFilter.status = _.in([ORDER_STATUS.PENDING_SHIP, 'paid_awaiting_address', 'ready_pickup']);
          break;
        case 3:
          statusFilter.status = ORDER_STATUS.SHIPPED;
          break;
        case 4:
          statusFilter.status = ORDER_STATUS.SIGNED;
          break;
        case 5:
          statusFilter.status = _.in([
            ORDER_STATUS.AFTERSALES,
            'refunding',
            'refunded',
            'expired_refunding',
            'refund_approved',
            'refund_rejected'
          ]);
          break;
      }

      // 买家：客户端按 _openid；受礼人：云函数按 giftMeta.receiverOpenid（权限 + 免客户端嵌套索引）
      // 兑换单（source=exchange，代金券/积分兑换）不属于藏品订单，只在积分中心「我的兑换」展示
      const ownedWhere = { _openid: openid, source: _.neq('exchange'), ...statusFilter };
      // 显式分页：客户端默认单次只回 20 条，原先无 limit 会让第 21 笔起的历史订单消失。
      const ownedLimit = Math.max(20, Number(this.data.ownedPageSize) || 20);
      const [ownedRes, receivedPack] = await Promise.all([
        db.collection('orders')
          .where(ownedWhere)
          .orderBy('createTime', 'desc')
          .limit(ownedLimit)
          .get(),
        wx.cloud.callFunction({
          name: 'manageGift',
          data: { action: 'listReceivedOrders' }
        }).catch((err) => {
          console.warn('orders listReceivedOrders', err);
          return { result: { success: false, list: [] } };
        })
      ]);

      const ownedRowsRaw = ownedRes.data || [];
      const ownedHasMore = ownedRowsRaw.length >= ownedLimit;
      this.setData({ ownedHasMore });
      let receivedRows = ((receivedPack && receivedPack.result) || {}).list || [];
      if (receivedRows.length && this.data.curTab !== 0) {
        receivedRows = receivedRows.filter((item) => this.matchesTabStatus(item.status));
      } else if (receivedRows.length && this.data.curTab === 0) {
        receivedRows = receivedRows.filter(
          (item) => item && item.status !== ORDER_STATUS.VOID
        );
      }

      // 兜底：历史数据里若有 source 缺失/异常写法，客户端再过滤一次
      const ownedRows = (ownedRes.data || []).filter(
        (row) => !row || String(row.source || '') !== 'exchange'
      );
      const merged = mergeOrderRows(ownedRows, receivedRows, openid);

      const now = Date.now();
      const activeList = [];
      merged.forEach((item) => {
        if (item.status === ORDER_STATUS.PENDING_PAY && item.payExpireTime) {
          const expired = new Date(item.payExpireTime).getTime() < now;
          if (expired) {
            // 仅买家可取消自己的待付单
            if (isOrderOwnedBy(item, openid)) {
              wx.cloud.callFunction({
                name: 'cancelOrder',
                data: { orderId: item._id, reason: 'expired' }
              }).catch(() => {});
            }
            return;
          }
        }
        activeList.push(item);
      });

      const list = activeList.map((item) => this.formatOrderRow({
        ...item,
        createTimeStr: item.createTime ? new Date(item.createTime).toLocaleDateString() : ''
      }, openid));

      this.setData({
        orders: list,
        loading: false,
    /** 买家侧分页：单次条数与是否还有更多 */
    ownedPageSize: 20,
    ownedHasMore: false,
    loadingMore: false,
        loadError: false
      });
      this.loadReviewStates(list);

    } catch (err) {
      console.error(err);
      this.setData({ loading: false, loadError: true, orders: [] });
      wx.showToast({ title: '订单加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
  
  /** 已签收卡片的评价状态：整页一次批量查（每 100 单一次调用），不逐单查 */
  async loadReviewStates(list) {
    const ids = (list || [])
      .filter((o) => o && o.status === ORDER_STATUS.SIGNED && !o.isVoucherOrder)
      .map((o) => o._id);
    if (!ids.length) return;
    const seq = (this._reviewSeq = (this._reviewSeq || 0) + 1);
    const map = {};
    for (let i = 0; i < ids.length; i += REVIEW_MAP_BATCH) {
      const orderIds = ids.slice(i, i + REVIEW_MAP_BATCH);
      try {
        const res = await wx.cloud.callFunction({ name: 'submitComment', data: { action: 'orderReviewMap', orderIds } });
        const result = (res && res.result) || {};
        orderIds.forEach((id) => {
          const hit = result.success && result.map && result.map[id];
          map[id] = hit ? hit.reviewState : 'unknown';
        });
      } catch (e) {
        console.warn('orders loadReviewStates', e);
        orderIds.forEach((id) => { map[id] = 'unknown'; });
      }
    }
    if (seq !== this._reviewSeq) return;
    const patch = {};
    (this.data.orders || []).forEach((o, idx) => {
      if (!o || !(o._id in map)) return;
      const flags = reviewFlags(map[o._id]);
      patch[`orders[${idx}].reviewCanWrite`] = flags.reviewCanWrite;
      patch[`orders[${idx}].reviewChip`] = flags.reviewChip;
    });
    if (Object.keys(patch).length) this.setData(patch);
  },

  getStatusStr(status, { asReceiver, storePickup } = {}) {
    if (storePickup && (status === ORDER_STATUS.PENDING_SHIP || status === 'ready_pickup')) {
      return '待自取'
    }
    const map = {
      [ORDER_STATUS.PENDING_PAY]: '待付款',
      fulfilling: '支付确认中',
      [ORDER_STATUS.PENDING_SHIP]: '待发货',
      ready_pickup: '待自取',
      paid_awaiting_address: asReceiver ? '待你填址' : '待 TA 填址',
      expired_refunding: '过期退款中',
      [ORDER_STATUS.SHIPPED]: '待收货',
      [ORDER_STATUS.SIGNED]: '已签收',
      [ORDER_STATUS.AFTERSALES]: '售后中',
      'refunding': '退款中',
      'refunded': '已退款',
      // ERP 侧写入的两个退款终态；此前落到「处理中」，用户看不出结果
      'refund_approved': '退款审核通过 · 处理中',
      'refund_rejected': '退款未通过 · 可重新申请',
      cancelled: '已取消'
    };
    return map[status] || '处理中';
  },

  formatOrderRow(item, openid) {
    const isGiver = isOrderOwnedBy(item, openid);
    const isReceiver = isGiftReceiverOf(item, openid) && !isGiver;
    const giftMeta = item.giftMeta || {};
    const hidePrice = isReceiver && giftMeta.hidePrice !== false;
    const isVoucherOrder =
      item.source === 'exchange' ||
      (Array.isArray(item.products) &&
        item.products.some((p) => {
          const priceStr = p && p.price != null ? String(p.price) : '';
          if (priceStr.includes('PTS') || priceStr.includes('积分')) return true;
          const latinUpper = p && p.latin ? String(p.latin).toUpperCase() : '';
          return latinUpper === 'COUPON' || latinUpper === 'VOUCHER' || latinUpper.includes('COUPON');
        }));
    const isStorePickup = !!(
      item.storePickup ||
      item.fulfillmentType === 'store_pickup' ||
      (giftMeta.deliveryType === 'store_pickup')
    );
    const base = {
      ...item,
      isGiftReceiver: isReceiver,
      isGiftGiver: isGiver && !!(item.source === 'gift' || item.giftMeta),
      isStorePickup,
      showOrderPrice: !hidePrice,
      isVoucherOrder,
      statusStr: this.getStatusStr(item.status, { asReceiver: isReceiver, storePickup: isStorePickup }),
      statusEn: this.getStatusEn(item.status, { storePickup: isStorePickup }),
      // 受礼人隐价：列表不展示金额
      totalPriceDisplay: hidePrice ? '' : item.totalPrice
    };
    const depositDisp = resolveDepositDisplay(item);
    if (depositDisp) {
      base.isDepositOrder = item.orderType === 'deposit' || item.source === 'deposit';
      base.isDepositBalanceOrder = !!item.depositIntentId && !base.isDepositOrder;
      base.depositTag = depositDisp.tag || '';
      if (depositDisp.label) {
        base.statusStr = depositDisp.label;
        base.statusEn = depositDisp.en || base.statusEn;
      }
      if (base.isDepositOrder && item.status === 'pending_pay') {
        base.payBtnLabel = '付定金';
      } else if (base.isDepositBalanceOrder && item.status === 'pending_pay') {
        base.payBtnLabel = '付尾款';
      }
    }
    if (item.source === 'gift' || item.giftMeta) {
      const dt = giftMeta.deliveryType || '';
      if (isReceiver) {
        base.giftTag = '收到的礼赠';
      } else {
        const labels = {
          invite_address: '礼赠·先付后填址',
          ship_to_receiver: '礼赠·快递给 TA',
          ship_to_self: '礼赠·寄给我',
          store_pickup: '礼赠·门店自提'
        };
        base.giftTag = labels[dt] || '礼赠';
      }
      const addrSubmitted = giftMeta.addressStatus === 'submitted';
      const awaitingAddr =
        dt === 'invite_address' &&
        !addrSubmitted &&
        (item.status === 'paid_awaiting_address' || item.status === 'paid');
      base.giftNeedsAddress = awaitingAddr;
      if (item.status === 'paid_awaiting_address' && !addrSubmitted) {
        base.statusStr = isReceiver ? '待你填址' : '待 TA 填址';
      } else if (item.status === 'paid_awaiting_address' && addrSubmitted) {
        // 脏数据兜底：地址已交但 status 未翻转
        base.statusStr = '待发货';
      } else if (awaitingAddr && item.status === 'paid') {
        base.statusStr = isReceiver ? '待你填址' : '待 TA 填址';
      }
    }
    return base;
  },

  getStatusEn(status, { storePickup } = {}) {
    if (storePickup && (status === ORDER_STATUS.PENDING_SHIP || status === 'ready_pickup')) {
      return 'PICKUP';
    }
    const map = {
      [ORDER_STATUS.PENDING_PAY]: 'TO PAY',
      [ORDER_STATUS.PENDING_SHIP]: 'TO SHIP',
      ready_pickup: 'PICKUP',
      paid_awaiting_address: 'AWAIT ADDR',
      expired_refunding: 'EXPIRED',
      [ORDER_STATUS.SHIPPED]: 'IN TRANSIT',
      [ORDER_STATUS.SIGNED]: 'SIGNED',
      [ORDER_STATUS.AFTERSALES]: 'AFTERSALES',
      'refunding': 'REFUNDING',
      'refunded': 'REFUNDED'
    };
    return map[status] || 'OPEN';
  },

  /** 与 loadOrders Tab 口径一致，用于受礼人云函数列表本地过滤 */
  matchesTabStatus(status) {
    switch (this.data.curTab) {
      case 0:
        return status !== ORDER_STATUS.VOID;
      case 1:
        return status === ORDER_STATUS.PENDING_PAY || status === 'fulfilling';
      case 2:
        return status === ORDER_STATUS.PENDING_SHIP || status === 'paid_awaiting_address' || status === 'ready_pickup';
      case 3:
        return status === ORDER_STATUS.SHIPPED;
      case 4:
        return status === ORDER_STATUS.SIGNED;
      case 5:
        return (
          status === ORDER_STATUS.AFTERSALES ||
          status === 'refunding' ||
          status === 'refunded' ||
          status === 'expired_refunding'
        );
      default:
        return true;
    }
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
        wx.showToast({ title: '暂时打不开订单详情，请稍后再试', icon: 'none' });
      }
    });
  },
  
  // 复用 goToDetail 方便 WXML 调用
  goToDetail(e) {
     const id = e.currentTarget.dataset.id;
     if (!id) {
       wx.showToast({ title: '订单信息异常', icon: 'none' });
       return;
     }
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

  // 待付款订单 — 唤起支付（仅买家）
  async handlePay(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '订单信息异常', icon: 'none' });
      return;
    }
    const order = (this.data.orders || []).find((o) => o._id === id);
    if (order && order.isGiftReceiver) {
      wx.showToast({ title: '礼赠由赠予者支付', icon: 'none' });
      return;
    }

    if (this.data.payingId) return;
    wx.vibrateShort({ type: 'medium' });
    this.setData({ payingId: id });
    try {
      await payForOrder(id);
      wx.showToast({ title: '支付成功', icon: 'success' });
      this.loadOrders();
    } catch (err) {
      if (err.message === '已取消支付') return;
      const msg = err.message || '支付失败';
      if (/支付未开通|暂不可用|支付服务不可用/.test(msg)) {
        this.modal({
          title: '暂无法支付',
          overline: 'PAYMENT UNAVAILABLE',
          content: msg,
          showCancel: false
        });
      } else {
        wx.showToast({ title: msg, icon: 'none' });
      }
    } finally {
      this.setData({ payingId: '' });
    }
  },

  /** 受礼人：去填写收件地址 */
  goFillGiftAddress(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '订单信息异常', icon: 'none' });
      return;
    }
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({
      url: `/subpackages/feature/gift/address/index?orderId=${encodeURIComponent(id)}`,
      fail: () => {
        wx.navigateTo({
          url: `/subpackages/business/order-detail/index?id=${id}`
        });
      }
    });
  },

  // 确认签收
  confirmReceipt(e) {
    const id = e.currentTarget.dataset.id;
    const order = (this.data.orders || []).find((o) => o._id === id);
    this.modal({
      title: '确认签收',
      overline: 'CONFIRM RECEIPT',
      content: '确认已收到藏品？\n签收后可写下感受，并查看养护指南与收藏证书。',
      confirmText: '确认签收'
    }).then(async (res) => {
      if (!res.confirm) return;
      wx.showLoading({ title: '确认签收…', mask: true });
      try {
        await confirmReceiptOnOrder(id, order);
        await this.loadOrders();
      } catch (err) {
        console.error(err);
        wx.showToast({ title: '操作失败，请重试', icon: 'none' });
      } finally {
        wx.hideLoading();
      }
    });
  },

  goToReview(e) {
    const id = e.currentTarget.dataset.id;
    const item = e.currentTarget.dataset.item || (this.data.orders || []).find((o) => o._id === id);
    if (!id) {
      wx.showToast({ title: '订单信息异常', icon: 'none' });
      return;
    }
    const products = (item && item.products) || [];
    const first = products.find((p) => p && (p.id || p._id || p.productId)) || products[0];
    const productId = first ? (first.id || first._id || first.productId || '') : '';
    let url = `/subpackages/content/comment/index?targetType=product&orderId=${encodeURIComponent(id)}`;
    if (productId) url += `&targetId=${encodeURIComponent(productId)}`;
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({
      url,
      fail: () =>
        wx.navigateTo({
          url: `/subpackages/business/order-detail/index?id=${id}`
        })
    });
  }
}));
