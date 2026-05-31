// pages/cart/index.js
const app = getApp();
const db = wx.cloud.database();
const _ = db.command;
const { formatPrice } = require('../../utils/util');
const { navigateToConfirmOrder } = require('../../utils/checkout');
const { trackBehavior } = require('../../utils/trackBehavior');
const { ensureOpenId, markCartDirty, updateCartTabBadge } = require('../../utils/cartHelper');
const { measureFixedScroll, estimateTabBarPx } = require('../../utils/scrollArea')
const { enrichCoupon, isCouponExpired } = require('../../utils/couponHelper');

Page({
  data: {
    allSelected: false,
    originalPrice: '0.00',
    finalPrice: '0.00',
    savedAmount: '0.00',
    vipSaved: 0,
    couponSaved: 0,
    discountRate: 1.0,
    levelName: '会员',
    selectedCount: 0,
    cartList: [], 
    loading: true,
    invalidCount: 0,
    coupons: [],
    selectedCoupon: null,
    showCouponModal: false,
    vipTotalNum: 0,
    startX: 0, startY: 0,
    
    // 🟢 成功动画控制
    showSuccessAnim: false,

    // 🟢 收藏分类管理
    currentFolder: 'all', // 当前选中的分类：all, product, activity, course, 或folderId
    currentFolderName: '全部', // 当前分类名称（用于显示）
    folders: [], // 用户创建的收藏夹列表
    showFolderModal: false, // 显示收藏夹管理弹窗
    showMoveModal: false, // 显示移动弹窗
    selectedItems: [], // 选中的物品ID（用于批量操作）
    editMode: false, // 编辑模式（批量操作）
    
    // 🟢 收藏推荐
    collectionRecommendations: [], // 基于收藏的推荐
    loadingRecommendations: false, // 推荐加载状态
    collectionTrend: null // 收藏趋势数据
    ,
    scrollTopPx: 140,
    scrollBottomPx: 200,
    scrollHeightPx: 500
  },

  onReady() {
    this.remeasureScroll()
  },

  async remeasureScroll() {
    const tabPx = estimateTabBarPx()
    let bottomSelector = ''
    if (this.data.cartList.length > 0 && !this.data.loading) {
      bottomSelector = this.data.editMode ? '.edit-bar' : '.checkout-bar'
    }
    const area = await measureFixedScroll(this, {
      topSelector: '.cart-top',
      bottomSelector,
      bottomPx: bottomSelector ? 0 : tabPx,
      fallbackTop: 140,
      fallbackBottom: tabPx
    })
    this.setData(area)
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }

    trackBehavior('cart_view', 'cart', 'main');

    this.setData({ showSuccessAnim: false });

    const now = Date.now();
    let force = !!app.globalData.refreshCart;
    if (force) app.globalData.refreshCart = false;

    const stale = force || !this._lastCartFetch || now - this._lastCartFetch > 8000;
    if (stale) {
      this._lastCartFetch = now;
      this.loadUserDiscount();
      this.loadFolders();
      this.loadCollection();
      this.loadUsableCoupons({ autoPick: true });
    } else if (this.data.cartList.length === 0 && !this.data.loading) {
      this.loadCollection();
    }

    if (force || !this._lastRecFetch || now - this._lastRecFetch > 30000) {
      this._lastRecFetch = now;
      this.loadCollectionRecommendations();
    }
  },

  onPullDownRefresh() {
    this._lastCartFetch = 0;
    this._lastRecFetch = 0;
    Promise.all([
      this.loadUserDiscount(),
      this.loadFolders(),
      this.loadCollection(),
      this.loadUsableCoupons({ autoPick: true }),
      this.loadCollectionRecommendations()
    ]).finally(() => wx.stopPullDownRefresh());
  },

  touchstart: function (e) {
    this.data.cartList.forEach(v => v.isTouchMove = false);
    this.setData({ startX: e.changedTouches[0].clientX, startY: e.changedTouches[0].clientY, cartList: this.data.cartList });
  },
  touchmove: function (e) {
    let idx = e.currentTarget.dataset.index, startX = this.data.startX, touchMoveX = e.changedTouches[0].clientX;
    if (startX - touchMoveX > 30) this.data.cartList[idx].isTouchMove = true;
    if (touchMoveX - startX > 30) this.data.cartList[idx].isTouchMove = false;
    this.setData({ cartList: this.data.cartList });
  },

  calculateTotal() {
    let total = 0; let count = 0; let allSel = true; let hasItem = false;
    this.data.cartList.forEach(item => {
      const unavailable = item.stock <= 0 || item.invalid;
      if (!unavailable) { hasItem = true; if (!item.selected) allSel = false; }
      if (item.selected && !unavailable) { total += parseFloat(item.price) * item.count; count += item.count; }
    });
    if (!hasItem) allSel = false;

    const vipTotal = total * this.data.discountRate;
    const vipSavedAmount = total - vipTotal;
    const vipTotalNum = parseFloat(vipTotal.toFixed(2));

    let currentCoupon = this.data.selectedCoupon;
    if (currentCoupon && vipTotalNum < (currentCoupon.minSpend || 0)) currentCoupon = null;
    
    let final = vipTotal;
    let couponSavedAmount = 0;
    if (currentCoupon) {
      const couponType = currentCoupon.type || 'cash'
      switch (couponType) {
        case 'cash':
          couponSavedAmount = currentCoupon.value || 0
          final = vipTotal - couponSavedAmount
          break
        case 'discount':
          const discount = (currentCoupon.value || 0) / 10
          couponSavedAmount = vipTotal * (1 - discount)
          final = vipTotal * discount
          break
        case 'freeShipping':
          couponSavedAmount = 10
          final = vipTotal
          break
        case 'newUser':
          couponSavedAmount = currentCoupon.value || 0
          final = vipTotal - couponSavedAmount
          break
        default:
          couponSavedAmount = currentCoupon.value || 0
          final = vipTotal - couponSavedAmount
      }
    }
    if (final < 0) final = 0;
    const totalSaved = total - final;

    const coupons = (this.data.coupons || []).map((c) => enrichCoupon(c, vipTotalNum));

    this.setData({
      allSelected: allSel,
      selectedCount: count,
      selectedCoupon: currentCoupon,
      vipTotalNum,
      coupons,
      originalPrice: total > 0 ? formatPrice(total) : '0.00',
      finalPrice: formatPrice(final),
      savedAmount: formatPrice(totalSaved),
      vipSaved: vipSavedAmount > 0 ? parseFloat(vipSavedAmount.toFixed(2)) : 0,
      couponSaved: couponSavedAmount > 0 ? parseFloat(couponSavedAmount.toFixed(2)) : 0
    });
  },

  getVipTotalNum() {
    let total = 0;
    this.data.cartList.forEach((item) => {
      if (item.selected && item.stock > 0 && !item.invalid) {
        total += parseFloat(item.price) * item.count;
      }
    });
    return parseFloat((total * this.data.discountRate).toFixed(2));
  },

  async loadUserDiscount() { wx.cloud.callFunction({ name: 'getUserStats', success: res => { if(res.result) { this.setData({ discountRate: res.result.discountRate || 1.0, levelName: res.result.levelName || '普通会员' }); if(this.data.cartList.length > 0) this.calculateTotal(); } } }); },
  // 🟢 加载收藏夹列表
  async loadFolders() {
    try {
      const res = await db.collection('collection_folders')
        .orderBy('createTime', 'desc')
        .get();
      this.setData({ folders: res.data });
    } catch (err) {
      console.error('加载收藏夹失败:', err);
    }
  },

  async loadCollection() {
    this.setData({ loading: true });
    const folder = this.data.currentFolder;

    try {
      let list = [];
      let invalidCount = 0;
      let loaded = false;

      try {
        const res = await wx.cloud.callFunction({
          name: 'getCartList',
          data: { folder }
        });
        const payload = res.result || {};
        if (payload.success) {
          list = payload.data || [];
          invalidCount = payload.invalidCount || 0;
          loaded = true;
        }
      } catch (cfErr) {
        console.warn('getCartList unavailable, client fallback', cfErr);
      }

      if (!loaded) {
        const result = await this._loadCollectionClient(folder);
        list = result.list;
        invalidCount = result.invalidCount;
      }

      list = (list || []).map((item) => ({
        ...item,
        id: item._id || item.productId || item.id
      }))

      this.setData({ cartList: list, loading: false, invalidCount }, () => {
        this.updateTabBarBadge(list.length)
        this.calculateTotal()
        this.remeasureScroll()
      })
    } catch (err) {
      console.error('loadCollection', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  _filterCartByFolder(list, folder) {
    if (folder === 'all') {
      return list.filter((item) => {
        if (!item || item.type === 'wishlist') return false;
        return !item.type || item.type === 'product' || item.type === 'activity' || item.type === 'course';
      });
    }
    if (folder === 'product') {
      return list.filter((i) => !i.type || i.type === 'product');
    }
    if (folder === 'activity' || folder === 'course') {
      return list.filter((i) => i.type === folder);
    }
    return list.filter((i) => i.folderId === folder);
  },

  async _loadCollectionClient(folder) {
    const openid = await ensureOpenId(app);
    const baseWhere = openid ? { _openid: openid } : {};

    let raw = [];
    try {
      const res = await db.collection('collections').where(baseWhere).orderBy('createTime', 'desc').limit(100).get();
      raw = res.data || [];
    } catch (orderErr) {
      console.warn('cart client orderBy fallback', orderErr);
      const res = await db.collection('collections').where(baseWhere).limit(100).get();
      raw = (res.data || []).sort((a, b) => {
        const ta = a.createTime ? new Date(a.createTime).getTime() : 0;
        const tb = b.createTime ? new Date(b.createTime).getTime() : 0;
        return tb - ta;
      });
    }

    let list = this._filterCartByFolder(raw, folder);

    if (list.length > 0) {
      const productMap = {};
      const ids = [...new Set(list.map((i) => i.productId).filter(Boolean))];
      try {
        for (let i = 0; i < ids.length; i += 20) {
          const chunk = ids.slice(i, i + 20);
          const stockRes = await db.collection('products')
            .where({ _id: _.in(chunk) })
            .field({ _id: true, stock: true, hasSku: true, skus: true, price: true, title: true })
            .get();
          (stockRes.data || []).forEach((p) => { productMap[p._id] = p; });
        }
      } catch (productErr) {
        console.warn('cart products enrich failed', productErr);
      }

      const hasProducts = Object.keys(productMap).length > 0;
      list = list.map((item) => {
        const p = productMap[item.productId];
        item.invalid = false;
        item.invalidReason = '';

        if (!p) {
          if (hasProducts) {
            item.invalid = true;
            item.invalidReason = '商品已下架';
            item.stock = 0;
          } else {
            item.stock = parseInt(item.stock, 10);
            if (Number.isNaN(item.stock) || item.stock <= 0) item.stock = 99;
          }
        } else if (p.hasSku && item.skuId && Array.isArray(p.skus)) {
          const sku = p.skus.find((s) => s.id === item.skuId);
          if (!sku) {
            item.invalid = true;
            item.invalidReason = '规格已失效';
            item.stock = 0;
          } else {
            item.stock = parseInt(sku.stock, 10) || 0;
            if (sku.price != null) item.price = sku.price;
            if (sku.specLabel) item.skuLabel = sku.specLabel;
          }
        } else if (p.hasSku && item.skuId) {
          item.invalid = true;
          item.invalidReason = '规格已失效';
          item.stock = 0;
        } else {
          item.stock = parseInt(p.stock, 10) || 0;
          if (p.price != null) item.price = p.price;
        }

          if (!item.count) item.count = 1;
          item.selected = false;
          item.id = item._id || item.productId;
          item.isTouchMove = false;
        return item;
      });
    }

    return {
      list,
      invalidCount: list.filter((i) => i.invalid).length
    };
  },
  async loadUsableCoupons(options = {}) {
    const { autoPick = false } = options
    try {
      let rows = []
      try {
        const res = await db.collection('user_coupons')
          .where({ status: 'unused' })
          .orderBy('value', 'desc')
          .get()
        rows = res.data || []
      } catch (indexErr) {
        console.warn('user_coupons orderBy 索引缺失，降级为客户端排序', indexErr)
        const res = await db.collection('user_coupons')
          .where({ status: 'unused' })
          .get()
        rows = res.data || []
      }

      const vipTotal = this.getVipTotalNum()
      const validList = rows
        .filter((c) => !isCouponExpired(c))
        .map((c) => enrichCoupon(c, vipTotal))
        .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))

      this.setData({ coupons: validList, vipTotalNum: vipTotal })

      if (autoPick && validList.length > 0 && vipTotal > 0) {
        await this.autoSelectBestCoupon()
      } else {
        this.calculateTotal()
      }
    } catch (e) {
      console.error('加载优惠券失败', e)
      wx.showToast({ title: '礼券加载失败', icon: 'none' })
      this.calculateTotal()
    }
  },
  
  // 🟢 自动匹配最优优惠券
  async autoSelectBestCoupon() {
    if (this.data.selectedCount === 0) {
      this.calculateTotal()
      return
    }

    const vipTotal = this.getVipTotalNum()
    if (vipTotal <= 0) {
      this.calculateTotal()
      return
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'getBestCoupon',
        data: { totalPrice: vipTotal }
      })

      if (res.result && res.result.success && res.result.bestCoupon) {
        this.setData({ selectedCoupon: enrichCoupon(res.result.bestCoupon, vipTotal) })
      }

      this.calculateTotal()
    } catch (err) {
      console.error('自动匹配优惠券失败:', err)
      this.calculateTotal()
    }
  },
  
  toggleSelect(e) {
    wx.vibrateShort({ type: 'medium' });
    const idx = e.currentTarget.dataset.index;
    const item = this.data.cartList[idx];
    if (item.invalid) {
      wx.showToast({ title: item.invalidReason || '商品已失效', icon: 'none' });
      return;
    }
    if (item.stock <= 0) {
      wx.showToast({ title: '已售罄', icon: 'none' });
      return;
    }
    this.setData({ [`cartList[${idx}].selected`]: !item.selected }, () => this.calculateTotal());
  },

  onCartCardTap(e) {
    if (this.data.editMode) this.toggleItemSelect(e);
    else this.toggleSelect(e);
  },
  toggleSelectAll(forceVal) {
    wx.vibrateShort({ type: 'medium' });
    const newStatus = (typeof forceVal === 'boolean') ? forceVal : !this.data.allSelected;
    const newList = this.data.cartList.map(item => {
      if (item.stock > 0 && !item.invalid) item.selected = newStatus;
      else item.selected = false;
      return item;
    });
    this.setData({ cartList: newList, allSelected: newStatus }, () => this.calculateTotal());
  },
  changeCount(e) { wx.vibrateShort({ type: 'light' }); const { index, type } = e.currentTarget.dataset; const item = this.data.cartList[index]; let newCount = item.count; if (type === 'add') { if (newCount >= item.stock) return wx.showToast({title:'库存不足',icon:'none'}); newCount++; } else { if (newCount <= 1) return; newCount--; } this.setData({ [`cartList[${index}].count`]: newCount }, () => this.calculateTotal()); db.collection('collections').doc(item._id).update({ data: { count: newCount } }); },
  deleteItem(e) { wx.vibrateShort({ type: 'medium' }); const idx = e.currentTarget.dataset.index; const item = this.data.cartList[idx]; wx.showModal({ title: '移除商品', content: '确定将此商品移出购物车吗？', confirmColor: '#C4A76C', success: async (res) => { if (res.confirm) { await db.collection('collections').doc(item._id).remove(); this.loadCollection(); } else { this.data.cartList[idx].isTouchMove = false; this.setData({ cartList: this.data.cartList }); } } }); },
  
  async openCouponModal() {
    if (this.data.selectedCount === 0) {
      return wx.showToast({ title: '请先勾选藏品', icon: 'none' })
    }
    await this.loadUsableCoupons({ autoPick: false })
    this.setData({ showCouponModal: true })
  },
  closeCouponModal() { this.setData({ showCouponModal: false }); },
  selectCoupon(e) {
    const idx = parseInt(e.currentTarget.dataset.index, 10)
    if (idx === -1) {
      this.setData({ selectedCoupon: null })
    } else {
      const coupon = this.data.coupons[idx]
      if (!coupon) return
      if (coupon._disabled) {
        return wx.showToast({
          title: `未满 ¥${coupon.minSpend} 不可用`,
          icon: 'none',
        })
      }
      this.setData({ selectedCoupon: coupon })
    }
    this.calculateTotal()
    this.closeCouponModal()
  },
  
  handleCheckout() {
    if (this.data.selectedCount === 0) return wx.showToast({ title: '请先勾选', icon: 'none' });
    wx.vibrateShort({ type: 'heavy' });

    const selectedItems = this.data.cartList.filter(i => i.selected && i.stock > 0 && !i.invalid);
    const items = selectedItems.map(item => ({
      productId: item.productId,
      skuId: item.skuId || '',
      skuLabel: item.skuLabel || '',
      count: item.count,
      collectionId: item._id,
      title: item.title,
      image: item.image,
      price: item.price,
      latinName: item.latinName
    }));

    navigateToConfirmOrder(items, {
      source: 'cart',
      couponId: this.data.selectedCoupon ? this.data.selectedCoupon._id : null
    });
  },

  async removeBoughtItemsFromCloud(collectionIds) {
    if (!collectionIds || !collectionIds.length) return;
    try {
      await Promise.all(
        collectionIds.map(id => db.collection('collections').doc(id).remove())
      );
    } catch (e) {
      console.warn('清理购物车失败', e);
    }
  },

  removeBoughtItems() {
    const leftItems = this.data.cartList.filter(item => !item.selected);
    this.setData({ cartList: leftItems });
    this.calculateTotal();
    this.updateTabBarBadge(leftItems.length);
  },
  goToDetail(e) { wx.navigateTo({ url: `/pages/detail/index?id=${e.currentTarget.dataset.id}` }); },
  goHome() { wx.switchTab({ url: '/pages/index/index' }); },
  goCategory() { wx.switchTab({ url: '/pages/category/index' }); },

  clearInvalidItems() {
    const invalidItems = this.data.cartList.filter(i => i.invalid);
    if (!invalidItems.length) return;
    wx.showModal({
      title: '清理失效商品',
      content: `确定移除 ${invalidItems.length} 件已失效商品吗？`,
      confirmColor: '#C4A76C',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '清理中...' });
        try {
          await Promise.all(invalidItems.map(item => db.collection('collections').doc(item._id).remove()));
          wx.hideLoading();
          wx.showToast({ title: '已清理', icon: 'success' });
          this.loadCollection();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '清理失败', icon: 'none' });
        }
      }
    });
  },

  updateTabBarBadge(count) {
    updateCartTabBadge(count);
  },
  noop() {},

  // 🟢 切换分类
  switchFolder(e) {
    const folder = e.currentTarget.dataset.folder || 'all';
    wx.vibrateShort({ type: 'light' });
    
    // 更新分类名称
    let folderName = '全部';
    if (folder === 'product') {
      folderName = '藏品';
    } else if (folder === 'activity') {
      folderName = '活动';
    } else if (folder === 'course') {
      folderName = '课程';
    } else if (folder !== 'all') {
      // 查找收藏夹名称
      const folderObj = this.data.folders.find(f => f._id === folder);
      folderName = folderObj ? folderObj.name : '收藏夹';
    }
    
    this.setData({ 
      currentFolder: folder, 
      currentFolderName: folderName,
      editMode: false, 
      selectedItems: [] 
    });
    this.loadCollection();
    // 🟢 切换分类时重新加载推荐（仅在全部分类时）
    if (folder === 'all') {
      this.loadCollectionRecommendations();
    }
  },

  // 🟢 返回全部分类
  switchToAll() {
    this.switchFolder({ currentTarget: { dataset: { folder: 'all' } } });
  },

  // 🟢 进入编辑模式
  enterEditMode() {
    wx.vibrateShort({ type: 'light' });
    this.setData({ editMode: true, selectedItems: [] }, () => this.remeasureScroll());
  },

  // 🟢 退出编辑模式
  exitEditMode() {
    this.setData({ editMode: false, selectedItems: [] }, () => this.remeasureScroll());
  },

  // 🟢 切换物品选中状态（编辑模式）
  toggleItemSelect(e) {
    const itemId = e.currentTarget.dataset.id;
    const selectedItems = [...this.data.selectedItems];
    const index = selectedItems.indexOf(itemId);
    
    if (index > -1) {
      selectedItems.splice(index, 1);
    } else {
      selectedItems.push(itemId);
    }
    
    this.setData({ selectedItems });
  },

  // 🟢 全选/取消全选（编辑模式）
  toggleSelectAllEdit() {
    if (this.data.selectedItems.length === this.data.cartList.length) {
      this.setData({ selectedItems: [] });
    } else {
      const allIds = this.data.cartList.map(item => item._id);
      this.setData({ selectedItems: allIds });
    }
  },

  // 🟢 显示收藏夹管理弹窗
  showFolderManager() {
    this.setData({ showFolderModal: true });
    this.loadFolders();
  },

  // 🟢 关闭收藏夹管理弹窗
  closeFolderModal() {
    this.setData({ showFolderModal: false });
  },

  // 🟢 创建收藏夹
  async createFolder() {
    wx.showModal({
      title: '创建收藏夹',
      editable: true,
      placeholderText: '请输入收藏夹名称',
      confirmColor: '#C4A76C',
      success: async (res) => {
        if (res.confirm && res.content) {
          wx.showLoading({ title: '创建中...' });
          try {
            const result = await wx.cloud.callFunction({
              name: 'createCollectionFolder',
              data: { name: res.content }
            });
            wx.hideLoading();
            
            if (result.result.success) {
              wx.showToast({ title: '创建成功', icon: 'success' });
              this.loadFolders();
            } else {
              wx.showToast({ title: result.result.msg || '创建失败', icon: 'none' });
            }
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '网络异常', icon: 'none' });
          }
        }
      }
    });
  },

  // 🟢 显示移动弹窗
  showMoveModal() {
    if (this.data.selectedItems.length === 0) {
      wx.showToast({ title: '请先选择物品', icon: 'none' });
      return;
    }
    this.setData({ showMoveModal: true });
  },

  // 🟢 关闭移动弹窗
  closeMoveModal() {
    this.setData({ showMoveModal: false });
  },

  // 🟢 移动物品到收藏夹
  async moveToFolder(e) {
    const folderId = e.currentTarget.dataset.folder || null;
    
    wx.showLoading({ title: '移动中...' });
    try {
      const result = await wx.cloud.callFunction({
        name: 'moveCollectionItems',
        data: {
          itemIds: this.data.selectedItems,
          folderId: folderId
        }
      });
      
      wx.hideLoading();
      if (result.result.success) {
        wx.showToast({ title: '移动成功', icon: 'success' });
        this.setData({ showMoveModal: false, editMode: false, selectedItems: [] });
        this.loadFolders();
        this.loadCollection();
      } else {
        wx.showToast({ title: result.result.msg || '移动失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  // 🟢 批量删除
  async batchDelete() {
    if (this.data.selectedItems.length === 0) {
      wx.showToast({ title: '请先选择物品', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认删除',
      content: `确定要删除选中的${this.data.selectedItems.length}件物品吗？`,
      confirmColor: '#C4A76C',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          try {
            const tasks = this.data.selectedItems.map(id => 
              db.collection('collections').doc(id).remove()
            );
            await Promise.all(tasks);
            
            wx.hideLoading();
            wx.showToast({ title: '删除成功', icon: 'success' });
            this.setData({ editMode: false, selectedItems: [] });
            this.loadCollection();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  async loadCollectionRecommendations() {
    const openid = app.globalData.openid;
    if (!openid || this.data.currentFolder !== 'all') {
      this.setData({ collectionRecommendations: [], collectionTrend: null });
      return;
    }

    this.setData({ loadingRecommendations: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getCollectionRecommendations',
        data: { userId: openid, limit: 6 }
      });
      const payload = res.result || {};
      if (payload.success) {
        this.setData({
          collectionRecommendations: payload.data || [],
          collectionTrend: payload.trend || null,
          loadingRecommendations: false
        });
      } else {
        this.setData({ collectionRecommendations: [], loadingRecommendations: false });
      }
    } catch (err) {
      console.warn('收藏推荐加载失败', err);
      this.setData({ loadingRecommendations: false });
    }
  },

  renameFolder(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '重命名收藏夹',
      editable: true,
      placeholderText: '请输入新名称',
      content: name || '',
      confirmColor: '#C4A76C',
      success: async (res) => {
        if (!res.confirm || !res.content || !res.content.trim()) return;
        wx.showLoading({ title: '保存中...' });
        try {
          await db.collection('collection_folders').doc(id).update({
            data: { name: res.content.trim(), updateTime: db.serverDate() }
          });
          wx.hideLoading();
          wx.showToast({ title: '已更新', icon: 'success' });
          this.loadFolders();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '更新失败', icon: 'none' });
        }
      }
    });
  },

  deleteFolder(e) {
    const folderId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除收藏夹',
      content: '删除后，该夹内藏品将移回「全部」列表',
      confirmColor: '#D64045',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中...' });
        try {
          await db.collection('collections').where({ folderId }).update({
            data: { folderId: null }
          });
          await db.collection('collection_folders').doc(folderId).remove();
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          if (this.data.currentFolder === folderId) {
            this.setData({ currentFolder: 'all', currentFolderName: '全部' });
          }
          this.loadFolders();
          this.loadCollection();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  }
});