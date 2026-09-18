// pages/cart/index.js
const app = getApp();
const db = wx.cloud.database();
const _ = db.command;
const { formatPrice, getFirstImage } = require('../../utils/util');
const { navigateToProductDetail } = require('../../utils/productDetailNav');
const { navigateToConfirmOrder } = require('../../utils/checkout');
const { trackBehavior } = require('../../utils/trackBehavior');
const { ensureOpenId, markCartDirty, updateCartTabBadge } = require('../../utils/cartHelper');
const { measureFixedScroll, estimateTabBarPx, rpxToPx } = require('../../utils/scrollArea')
const { couponDiscountMultiplier, clampCouponAgainstOriginal, MIN_PAY_RATIO } = require('../../utils/couponHelper')
const { fetchMyCoupons } = require('../../utils/couponService')
const shippingConfig = require('../../config/shipping')
const { ensureShippingRules } = require('../../utils/shippingRulesSync')
const { withAppModal } = require('../../utils/appModal')
// 需求 1：结账台「顺手带走一件」（¥10 以下优先 → ¥50 以下）——纯逻辑见 utils/checkoutAddon.js
const checkoutAddon = require('../../utils/checkoutAddon')

/**
 * 单张券在本单的实际节省额（与 orderPricing/makeOrder 口径一致）。
 * 抽成函数是为了让「计价」与「礼券列表展示」共用同一份逻辑——
 * 此前列表只显示券面额，用户看到的数字与本单实减不一致。
 * @returns {{saved:number, final:number, reason:string}}
 */
function couponSaveFor(coupon, vipTotal, originalTotal, selectedItems) {
  if (!coupon) return { saved: 0, final: vipTotal, reason: '' }
  const minSpend = Number(coupon.minSpend) || 0
  if (vipTotal < minSpend) {
    return { saved: 0, final: vipTotal, reason: `满 ¥${minSpend} 可用，本单未达门槛` }
  }
  const type = coupon.type || 'cash'
  let saved = 0
  let final = vipTotal
  if (type === 'freeShipping') {
    saved = typeof shippingConfig.calcShippingFee === 'function'
      ? (shippingConfig.calcShippingFee(originalTotal, selectedItems) || 0)
      : 0
    final = vipTotal
    if (!(saved > 0)) return { saved: 0, final, reason: '本单已免邮，免邮券无额外优惠' }
  } else if (type === 'discount') {
    const rate = Math.max(MIN_PAY_RATIO, couponDiscountMultiplier(coupon.value))
    saved = vipTotal * (1 - rate)
    final = vipTotal * rate
  } else {
    saved = coupon.value || 0
    final = vipTotal - saved
  }
  if (final < 0) final = 0
  if (type !== 'freeShipping') {
    const clamped = clampCouponAgainstOriginal(vipTotal, saved, originalTotal)
    final = clamped.final
    saved = clamped.couponValue
    if (!(saved > 0)) {
      return { saved: 0, final, reason: '会员价已达最低折扣，本单该券无额外优惠' }
    }
  }
  return { saved: Math.round(saved * 100) / 100, final, reason: '' }
}

Page(withAppModal({
  data: {
    allSelected: false,
    originalPrice: '0.00',
    finalPrice: '0.00',
    savedAmount: '0.00',
    vipSaved: 0,
    couponSaved: 0,
    couponBaseAmount: 0,
    shippingHint: shippingConfig.getRuleText(),
    discountRate: 1.0,
    levelName: '会员',
    selectedCount: 0,
    cartList: [], 
    loading: true,
    loadError: false,
    invalidCount: 0,
    coupons: [],
    selectedCoupon: null,
    showCouponModal: false,
    startX: 0, startY: 0,
    
    // 🟢 成功动画控制
    showSuccessAnim: false,

    // 🟢 收藏分类管理
    currentFolder: 'all', // 当前选中的分类：all, product, activity, course, 或folderId
    currentFolderName: '全部', // 当前分类名称（用于显示）
    folders: [], // 用户创建的收藏夹列表
    
    // 🟢 收藏推荐
    collectionRecommendations: [], // 基于收藏的推荐
    loadingRecommendations: false, // 推荐加载状态
    collectionTrend: null // 收藏趋势数据
    ,
    /** 需求 1：结账台顺手件（pick = 选中商品，text = 文案，dismissed = 本次会话内用户关掉了） */
    addonPick: null,
    addonText: null,
    addonTierLabel: '',
    addonDismissed: false,
    /** 需求 2/3：免邮凑单（缺口 / 进度 / 可凑的那一件），null = 运费配置不可用 */
    freeShip: null,
    /** 统一主视觉轻提示（AppToast）：原生 wx.showToast 与本产品视觉脱节 */
    toastShow: false,
    toastOverline: '',
    toastTitle: '',
    toastDesc: '',
    toastDuration: 2200,
    scrollTopPx: 140,
    scrollBottomPx: 200,
    scrollHeightPx: 500,
    statusBarHeight: 20
  },

  onLoad() {
    try {
      const { getWindowInfo } = require('../../utils/systemInfo');
      const win = getWindowInfo();
      let top = win.statusBarHeight || 20;
      try {
        const menu = wx.getMenuButtonBoundingClientRect();
        if (menu && menu.bottom) top = Math.ceil(menu.bottom + 6);
      } catch (e2) { /* ignore */ }
      this.setData({ statusBarHeight: top });
    } catch (e) {
      const appInst = getApp();
      this.setData({
        statusBarHeight: (appInst.globalData && appInst.globalData.statusBarHeight) || 20
      });
    }
  },

  onReady() {
    this.remeasureScroll()
  },

  async remeasureScroll() {
    const tabPx = estimateTabBarPx()
    const hasCheckout = this.data.cartList.length > 0 && !this.data.loading
    // 礼券 chip absolute top:-44rpx，测量底栏 top 时需额外避让
    const bottomOverhangPx = hasCheckout ? rpxToPx(52) : 0
    const statusPad = this.data.statusBarHeight || 20
    const area = await measureFixedScroll(this, {
      topSelector: '.cart-top',
      bottomSelector: hasCheckout ? '.checkout-bar' : '',
      bottomPx: hasCheckout ? 0 : tabPx,
      bottomOverhangPx,
      fallbackTop: statusPad + 140,
      fallbackBottom: tabPx
    })
    this.setData(area)
  },

  onShow() {
    try {
      require('../../utils/museumPageChrome').applyMuseumPageChrome();
    } catch (e) { /* ignore */ }
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }

    trackBehavior('cart_view', 'cart', 'main');

    this.setData({ showSuccessAnim: false });
    // 自定义导航 + 底栏布局稳定后再量一次，避免顶/底错位
    wx.nextTick(() => this.remeasureScroll())

    ensureShippingRules().then(() => {
      if (this.data.cartList && this.data.cartList.length) {
        this.calculateTotal();
      } else {
        this.setData({ shippingHint: shippingConfig.getRuleText() });
      }
    }).catch(() => {});

    const now = Date.now();
    let force = !!app.globalData.refreshCart;
    if (force) app.globalData.refreshCart = false;

    const stale = force || !this._lastCartFetch || now - this._lastCartFetch > 8000;
    if (stale) {
      this._lastCartFetch = now;
      this.loadUserDiscount();
      this.loadFolders();
      this.loadCollection();
      this.loadUsableCoupons();
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
      this.loadUsableCoupons(),
      this.loadCollectionRecommendations()
    ]).finally(() => wx.stopPullDownRefresh());
  },

  touchstart: function (e) {
    this._swipeAxis = '';
    this.data.cartList.forEach(v => { v.isTouchMove = false; });
    this.setData({
      startX: e.changedTouches[0].clientX,
      startY: e.changedTouches[0].clientY,
      cartList: this.data.cartList
    });
  },
  touchmove: function (e) {
    const idx = e.currentTarget.dataset.index;
    const startX = this.data.startX;
    const startY = this.data.startY;
    const touchMoveX = e.changedTouches[0].clientX;
    const touchMoveY = e.changedTouches[0].clientY;
    const dx = startX - touchMoveX;
    const dy = touchMoveY - startY;
    if (!this._swipeAxis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      this._swipeAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (this._swipeAxis !== 'x') return;
    const item = this.data.cartList[idx];
    if (!item) return;
    if (dx > 30) item.isTouchMove = true;
    if (dx < -30) item.isTouchMove = false;
    this.setData({ cartList: this.data.cartList });
  },

  calculateTotal() {
    let total = 0; let count = 0; let allSel = true; let hasItem = false;
    let discountedSubtotal = 0;
    const selectedItems = [];
    this.data.cartList.forEach(item => {
      const unavailable = item.stock <= 0 || item.invalid;
      if (!unavailable) { hasItem = true; if (!item.selected) allSel = false; }
      if (item.selected && !unavailable) {
        const line = parseFloat(item.price) * item.count;
        total += line;
        count += item.count;
        if (item.memberDiscountEnabled !== false) discountedSubtotal += line;
        selectedItems.push(item);
      }
    });
    if (!hasItem) allSel = false;

    const nonDiscounted = total - discountedSubtotal;
    const vipTotal = Math.round((discountedSubtotal * this.data.discountRate + nonDiscounted) * 100) / 100;
    const vipSavedAmount = total - vipTotal;

    let currentCoupon = this.data.selectedCoupon;
    const vipTotalNum = vipTotal;
    if (currentCoupon && vipTotalNum < (currentCoupon.minSpend || 0)) currentCoupon = null;
    
    let final = vipTotal;
    let couponSavedAmount = 0;
    if (currentCoupon) {
      const r = couponSaveFor(currentCoupon, vipTotal, total, selectedItems)
      couponSavedAmount = r.saved
      final = r.final
    }
    if (final < 0) final = 0;
    const totalSaved = total - final;

    // 需求 2/3：免邮凑单（门槛按优惠前合计，与确认页 / makeOrder 同口径）
    const freeShipBase = checkoutAddon.computeFreeShipping({
      goodsAmount: total,
      selectedItems,
      shipping: shippingConfig,
      // 已选免邮券时不再劝「再买 ¥x 免运费」（券的节省额就是运费，两个提示会打架）
      shippingCoveredByCoupon: !!(currentCoupon && currentCoupon.type === 'freeShipping')
    })
    const freeShip = checkoutAddon.attachGapFiller(freeShipBase, this._addonCandidates || [])

    this.setData({
      allSelected: allSel,
      selectedCount: count,
      selectedCoupon: currentCoupon,
      originalPrice: total > 0 ? formatPrice(total) : '0.00',
      finalPrice: formatPrice(final),
      savedAmount: formatPrice(totalSaved),
      vipSaved: vipSavedAmount > 0 ? parseFloat(vipSavedAmount.toFixed(2)) : 0,
      couponSaved: couponSavedAmount > 0 ? parseFloat(couponSavedAmount.toFixed(2)) : 0,
      couponBaseAmount: Math.round(vipTotalNum * 100) / 100,
      freeShip,
      // 包邮门槛按优惠前合计（与确认页 / makeOrder 一致），勿传折后应付
      shippingHint: count > 0 && typeof shippingConfig.getHint === 'function'
        ? shippingConfig.getHint(total, selectedItems)
        : shippingConfig.getRuleText()
    });
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

      this.setData({ cartList: list, loading: false, loadError: false, invalidCount }, () => {
        this.updateTabBarBadge(list.length)
        this.calculateTotal()
        // 结算栏/运费文案渲染后再测，保证推荐区不被挡住
        this.remeasureScroll().then(() => {
          setTimeout(() => this.remeasureScroll(), 80)
        })
        // 需求 1：清单就绪后再挑「顺手带走一件」（依赖 cartList 做排除）
        this.loadCheckoutAddon()
      })
    } catch (err) {
      console.error('loadCollection', err);
      this.setData({ loading: false, loadError: true, cartList: [] }, () => {
        this.remeasureScroll()
      });
      wx.showToast({ title: '购物车加载失败', icon: 'none' });
    }
  },

  /**
   * 需求 1：结账台「顺手带走一件」
   *
   * 像超市吧台的口香糖：**一次点按就能带走**。候选池只拉低价品（≤ 最后一档上界），
   * 具体优先级（¥10 以下 → ¥50 以下、同档取最便宜）在 utils/checkoutAddon.js 里，
   * 由 test-checkout-addon.mjs 逐条钉住，页面这里只负责取数与渲染。
   *
   * 失败静默降级：推荐位不该影响结算主链路，拉不到就整块不显示。
   */
  async loadCheckoutAddon() {
    const items = this.data.cartList || []
    if (!items.length || this.data.addonDismissed) {
      if (this.data.addonPick) this.setData({ addonPick: null, addonText: null, addonTierLabel: '' })
      return
    }
    if (this._addonLoading) return
    this._addonLoading = true
    try {
      const excludeIds = items.map((i) => i.productId).filter(Boolean)
      const res = await db.collection('products')
        .where(_.and([
          // 与既有 C 端列表同口径：下架不出现
          { isOffShelf: _.neq(true) },
          // 多规格必须选规格 → 不是「一次点按」的顺手件，且加车不带 skuId 会留下无效项
          { hasSku: _.neq(true) },
          // 价格带下推到 DB（不拉全量目录）。实测价格在写入侧就是数字：
          // manageProducts:182 `price: Math.max(0, finiteNumber(s.price, 0))`、后台 `Number(p.price)`，
          // 故数值区间查询成立；历史脏数据若是字符串，只会「不被推荐」，不会误推。
          { price: _.lte(checkoutAddon.ADDON_MAX_PRICE) }
        ]))
        .field({
          _id: true, title: true, price: true, images: true, stock: true,
          latinName: true, rootCategoryName: true, category: true
        })
        .limit(20)
        .get()
      const candidates = checkoutAddon.listCandidates(res.data || [], { excludeIds })
      const pick = checkoutAddon.pickAddon(candidates)
      this._addonCandidates = candidates
      this.setData({
        addonPick: pick ? pick.item : null,
        addonTierLabel: pick && pick.tier ? pick.tier.label : '',
        addonText: checkoutAddon.buildAddonText(pick)
      }, () => {
        // 候选就绪后重算一次：免邮凑单的「那一件」要从候选池里挑
        this.calculateTotal()
        this.remeasureScroll()
      })
    } catch (e) {
      console.warn('[cart] 顺手带走候选加载失败', e)
      if (this.data.addonPick) this.setData({ addonPick: null, addonText: null, addonTierLabel: '' })
    } finally {
      this._addonLoading = false
    }
  },

  /**
   * 统一主视觉轻提示（铭牌 + 铜金 + 衬线标题）—— 取代原生 toast。
   * 与 pages/user/index.js 的 showAppToast 同形（原生 toast 在博物黑界面里最不像本产品）。
   */
  showAppToast({ overline = '', title = '', desc = '', duration = 0 } = {}) {
    if (!title) return
    this.setData({
      toastOverline: overline,
      toastTitle: title,
      toastDesc: desc,
      toastDuration: duration || 2200,
      toastShow: true
    })
  },

  onToastClose() {
    this.setData({ toastShow: false })
  },

  /** 关掉本次结账的顺手件（不落库：下次进购物车还会按优先级重新挑） */
  dismissCheckoutAddon() {
    this.setData(
      { addonDismissed: true, addonPick: null, addonText: null, addonTierLabel: '' },
      () => this.remeasureScroll()
    )
  },

  /** 需求 1：顺手件（结账台吧台位） */
  async takeCheckoutAddon() {
    await this._addCheapItem(this.data.addonPick, 'addon')
  },

  /** 需求 2/3：凑单件（为免邮加的那一件） */
  async takeGapFiller() {
    const filler = this.data.freeShip && this.data.freeShip.filler
    await this._addCheapItem(filler, 'gap')
  },

  /**
   * 低价品一次点按加车 —— 顺手件与凑单件共用同一条写路径。
   * 复用既有 toggleCollection（不新开直写）；成功后重载购物车，顺手件会顺位换成下一件。
   */
  async _addCheapItem(item, source) {
    if (!item || this._addonTaking) return
    this._addonTaking = true
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) { /* 旧基础库 */ }
    try {
      const openid = await ensureOpenId(app)
      if (!openid) {
        this.showAppToast({ overline: 'SIGN IN', title: '登录中，请稍后重试' })
        return
      }
      wx.showLoading({ title: '加入中…', mask: true })
      const res = await wx.cloud.callFunction({
        name: 'toggleCollection',
        data: {
          targetId: item.id,
          type: 'product',
          action: 'add',
          skuId: '',
          snapshot: {
            title: item.title,
            image: item.image,
            price: item.price,
            latinName: item.latinName,
            count: 1
          }
        }
      })
      wx.hideLoading()
      const payload = res.result || {}
      if (!payload.success) {
        this.showAppToast({ overline: 'FAILED', title: payload.msg || '加入失败' })
        return
      }
      markCartDirty(app)
      trackBehavior('checkout_extra_add', 'product', item.id, {
        price: item.price,
        source: source || 'addon',
        tier: this.data.addonTierLabel
      })
      this.showAppToast({
        overline: source === 'gap' ? 'FREE SHIPPING' : 'ADD ONE',
        title: '已加入购物车',
        desc: item.title
      })
      await this.loadCollection()
    } catch (e) {
      wx.hideLoading()
      console.warn('[cart] 结账台加购失败', e)
      this.showAppToast({ overline: 'FAILED', title: '加入失败，请重试' })
    } finally {
      this._addonTaking = false
    }
  },

  _filterCartByFolder(list, folder) {
    if (folder === 'all') {
      return list.filter((item) => {
        if (!item || item.type === 'wishlist' || item.type === 'favorite') return false;
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
            .field({ _id: true, stock: true, hasSku: true, skus: true, price: true, title: true, isTreasure: true, isUnique: true, memberDiscountEnabled: true, protectionType: true })
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
            item.invalidReason = '藏品已下架';
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

          if (p) {
            item.isTreasure = !!p.isTreasure;
            item.isUnique = !!p.isUnique;
            item.memberDiscountEnabled = p.memberDiscountEnabled !== false;
            item.protectionType = p.protectionType || 'none';
            item.isProtected = !!(p.protectionType && p.protectionType !== 'none');
          } else if (item.memberDiscountEnabled == null) {
            item.memberDiscountEnabled = true;
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
  async loadUsableCoupons() { 
    try { 
      const packed = await fetchMyCoupons({ usableOnly: true })
      const validList = packed.list || []
      
      this.setData({ coupons: validList })
      
      // 自动匹配最优券
      if (validList.length > 0 && parseFloat(String(this.data.originalPrice).replace(/,/g, '')) > 0) {
        this.autoSelectBestCoupon()
      } else {
        this.calculateTotal()
      }
    } catch (e) { 
      console.error(e)
      this.calculateTotal()
    } 
  },
  
  // 🟢 自动匹配最优优惠券
  async autoSelectBestCoupon() {
    if (this.data.selectedCount === 0) {
      this.calculateTotal()
      return
    }
    
      try {
      // totalPrice = 会员折后应付（门槛）；originalPrice = 目录原价（75% 地板）
      const vipTotal = Number(this.data.couponBaseAmount) || parseFloat(String(this.data.finalPrice).replace(/,/g, '')) || 0
      const originalPrice = parseFloat(String(this.data.originalPrice).replace(/,/g, '')) || vipTotal
      const res = await wx.cloud.callFunction({
        name: 'getBestCoupon',
        data: {
          totalPrice: vipTotal > 0 ? vipTotal : originalPrice,
          shippingBaseAmount: originalPrice,
          originalPrice
        }
      })
      
      if (res.result && res.result.success && res.result.bestCoupon) {
        this.setData({ selectedCoupon: res.result.bestCoupon })
        wx.showToast({
          title: `已自动选择最优券`,
          icon: 'none',
          duration: 1500
        })
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
      wx.showToast({ title: item.invalidReason || '藏品已失效', icon: 'none' });
      return;
    }
    if (item.stock <= 0) {
      wx.showToast({ title: '已售罄', icon: 'none' });
      return;
    }
    this.setData({ [`cartList[${idx}].selected`]: !item.selected }, () => this.calculateTotal());
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
  changeCount(e) { wx.vibrateShort({ type: 'light' }); const { index, type } = e.currentTarget.dataset; const item = this.data.cartList[index]; let newCount = item.count; if (type === 'add') { if (newCount >= item.stock) return wx.showToast({title:'库存不足',icon:'none'}); newCount++; } else { if (newCount <= 1) return; newCount--; } this.setData({ [`cartList[${index}].count`]: newCount }, () => this.calculateTotal());
    wx.cloud.callFunction({
      name: 'toggleCollection',
      data: { engage: 'cartItem', action: 'updateCart', id: item._id, count: newCount }
    }).catch((e) => console.warn('cart count sync', e)); },
  deleteItem(e) {
    wx.vibrateShort({ type: 'medium' });
    const idx = e.currentTarget.dataset.index;
    const item = this.data.cartList[idx];
    this.modal({
      title: '移除藏品',
      overline: 'REMOVE FROM CART',
      content: '确定将此藏品移出购物车吗？',
      confirmText: '移除',
      danger: true
    }).then(async (res) => {
      if (res.confirm) {
        await wx.cloud.callFunction({
          name: 'toggleCollection',
          data: { engage: 'cartItem', action: 'removeCart', id: item._id }
        });
        this.loadCollection();
      } else {
        this.data.cartList[idx].isTouchMove = false;
        this.setData({ cartList: this.data.cartList });
      }
    });
  },
  
  openCouponModal() {
    if (this.data.selectedCount === 0) return wx.showToast({ title: '请先勾选藏品', icon: 'none' });
    this.refreshCouponSaves();
    this.setData({ showCouponModal: true });
  },

  /**
   * 为券包里每张券标注**本单实际可省**与不可用原因。
   * 面额是券的属性，与本单实减常常不等（门槛未达 / 会员价已触底），
   * 只显示面额会让用户以为金额不对。
   */
  refreshCouponSaves() {
    const vipTotal = Number(this.data.couponBaseAmount) || 0;
    const originalTotal = parseFloat(String(this.data.originalPrice).replace(/,/g, '')) || 0;
    const items = (this.data.cartList || []).filter((i) => i.selected !== false);
    const list = (this.data.coupons || []).map((c) => {
      const r = couponSaveFor(c, vipTotal, originalTotal, items);
      return { ...c, _save: r.saved, _disabled: !(r.saved > 0), _reason: r.reason };
    });
    this.setData({ coupons: list });
  },
  closeCouponModal() { this.setData({ showCouponModal: false }); },
  selectCoupon(e) {
    const idx = parseInt(e.currentTarget.dataset.index, 10);
    if (idx === -1) {
      this.setData({ selectedCoupon: null });
    } else {
      const coupon = this.data.coupons[idx];
      if (!coupon) return;
      const base = this.data.couponBaseAmount || 0;
      if (coupon.minSpend && base < coupon.minSpend) {
        wx.showToast({ title: `满 ${coupon.minSpend} 可用`, icon: 'none' });
        return;
      }
      this.setData({ selectedCoupon: coupon });
    }
    this.calculateTotal();
    this.closeCouponModal();
  },
  
  handleCheckout() {
    if (this.data.selectedCount === 0) return wx.showToast({ title: '请先勾选', icon: 'none' });
    wx.vibrateShort({ type: 'heavy' });

    const selectedItems = this.data.cartList.filter(i => i.selected && i.stock > 0 && !i.invalid && i.productId);
    if (!selectedItems.length) {
      wx.showToast({ title: '所选藏品无法结算', icon: 'none' });
      return;
    }
    const items = selectedItems.map(item => ({
      productId: item.productId,
      skuId: item.skuId || '',
      skuLabel: item.skuLabel || '',
      count: item.count,
      collectionId: item._id,
      title: item.title,
      image: item.image,
      price: item.price,
      latinName: item.latinName,
      isTreasure: !!item.isTreasure,
      isUnique: !!item.isUnique,
      memberDiscountEnabled: item.memberDiscountEnabled !== false,
      categoryType: item.categoryType || '',
      rootCategoryName: item.rootCategoryName || '',
      category: item.category || '',
      shippingKind: item.shippingKind || '',
      protectionType: item.protectionType || 'none',
      isProtected: !!item.isProtected
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
        collectionIds.map(id => wx.cloud.callFunction({
          name: 'toggleCollection',
          data: { engage: 'cartItem', action: 'removeCart', id }
        }).catch(() => null))
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
  goToDetail(e) {
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '藏品不存在', icon: 'none' });
      return;
    }
    const seed = (this.data.cartList || []).find((i) => i && (i.productId === id || i._id === id || i.targetId === id));
    navigateToProductDetail(id, {
      seed: seed
        ? {
            _id: id,
            title: seed.title,
            images: seed.image ? [seed.image] : [],
            price: seed.price,
            stock: seed.stock,
            latinName: seed.latinName
          }
        : { _id: id },
      failToast: '页面暂不可用'
    });
  },
  goHome() { wx.switchTab({ url: '/pages/index/index' }); },
  goCategory() { wx.switchTab({ url: '/pages/category/index' }); },

  clearInvalidItems() {
    const invalidItems = this.data.cartList.filter(i => i.invalid);
    if (!invalidItems.length) return;
    this.modal({
      title: '清理失效藏品',
      overline: 'CLEAR INVALID',
      content: `确定移除 ${invalidItems.length} 件已失效藏品吗？`,
      confirmText: '清理',
      danger: true
    }).then(async (res) => {
      if (!res.confirm) return;
      wx.showLoading({ title: '清理中…' });
      try {
        await Promise.all(invalidItems.map(item => wx.cloud.callFunction({
          name: 'toggleCollection',
          data: { engage: 'cartItem', action: 'removeCart', id: item._id }
        }).catch(() => null)));
        wx.hideLoading();
        wx.showToast({ title: '已清理', icon: 'success' });
        this.loadCollection();
      } catch (err) {
        wx.hideLoading();
        wx.showToast({ title: '清理失败', icon: 'none' });
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
      currentFolderName: folderName
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

  _pickRecommendImage(item) {
    if (!item) return '';
    const fromArr = getFirstImage(item.images);
    if (fromArr && String(fromArr).trim()) return String(fromArr).trim();
    if (typeof item.images === 'string' && item.images.trim()) return item.images.trim();
    const candidates = [
      item.image,
      item.httpImage,
      item.cover,
      item.coverImage,
      item.mainImage,
      item.thumb
    ];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (typeof c === 'string' && c.trim()) return c.trim();
      if (Array.isArray(c) && c[0]) return c[0];
    }
    return '';
  },

  async _hydrateRecommendImages(list) {
    const items = (list || []).map((item) => {
      const raw = this._pickRecommendImage(item);
      return { ...item, image: raw, httpImage: raw };
    });
    const cloudIds = [...new Set(items.map((i) => i.image).filter((u) => u && String(u).startsWith('cloud://')))];
    if (!cloudIds.length) return items;

    const urlMap = {};
    try {
      for (let i = 0; i < cloudIds.length; i += 50) {
        const chunk = cloudIds.slice(i, i + 50);
        const res = await wx.cloud.getTempFileURL({ fileList: chunk });
        (res.fileList || []).forEach((f) => {
          if (f.fileID && f.tempFileURL) urlMap[f.fileID] = f.tempFileURL;
        });
      }
    } catch (e) {
      console.warn('recommend image hydrate failed', e);
    }

    return items.map((item) => {
      const next = urlMap[item.image] || item.image;
      return { ...item, image: next, httpImage: next };
    });
  },

  async loadCollectionRecommendations() {
    if (this.data.currentFolder !== 'all') {
      this.setData({ collectionRecommendations: [], collectionTrend: null });
      return;
    }

    this.setData({ loadingRecommendations: true });
    try {
      let list = [];
      let trend = null;
      const openid = app.globalData.openid;
      if (openid) {
        try {
          const res = await wx.cloud.callFunction({
            name: 'getCollectionRecommendations',
            data: { userId: openid, limit: 6 }
          });
          const payload = res.result || {};
          if (payload.success) {
            list = payload.data || [];
            trend = payload.trend || null;
          }
        } catch (cfErr) {
          console.warn('收藏推荐云函数失败', cfErr);
        }
      }

      const hydrated = await this._hydrateRecommendImages(list);
      // 需求 11：补 sensitiveEnabled（推荐位此前封面直出）
      require('../../utils/sensitiveBlurCard').attachSensitiveFlags(hydrated);
      this.setData({
        collectionRecommendations: hydrated,
        collectionTrend: trend,
        loadingRecommendations: false
      });
    } catch (err) {
      console.warn('收藏推荐加载失败', err);
      this.setData({ loadingRecommendations: false });
    }
  },

  onRecommendImageError(e) {
    const idx = e.currentTarget.dataset.index;
    if (idx == null || idx === '') return;
    this.setData({
      [`collectionRecommendations[${idx}].image`]: '',
      [`collectionRecommendations[${idx}].httpImage`]: ''
    });
  },

  onCartThumbError(e) {
    const idx = e.currentTarget.dataset.index;
    if (idx == null || idx === '') return;
    this.setData({ [`cartList[${idx}].image`]: '' });
  }
}));