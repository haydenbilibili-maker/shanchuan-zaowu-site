// subpackages/feature/detail/index.js
const app = getApp();
const db = wx.cloud.database();
const { getFirstImage, batchTempFileURLs } = require('../../../utils/util');
const {
  peekProductDetail,
  setProductDetail,
  isPartialPayload,
  needsCriticalRefresh,
  invalidateProductDetail,
  DETAIL_TTL
} = require('../../../utils/productDetailCache');
const { sanitizeLatinName } = require('../../../utils/latinDisplay');
const { withAppModal } = require('../../../utils/appModal');
const {
  isSensitiveBlurProduct,
  shouldVeilSensitive,
  clearSensitiveRevealed,
  COPY,
  getSensitiveBlurPref,
  PREF_CLEAR
} = require('../../../utils/sensitiveBlur');
const { navigateToConfirmOrder } = require('../../../utils/checkout');
const shippingConfig = require('../../../config/shipping');
const { getShippingRuleText } = require('../utils/shipping');
const { ensureShippingRules } = require('../../../utils/shippingRulesSync');
const {
  hasSkus,
  getTotalStock,
  getDisplayPrice,
  getFirstAvailableSku,
  getSkuDimensions,
  getDimensionValues,
  resolveSkuFromSpecs,
  initSelectedSpecs,
  isDimensionValueAvailable
} = require('../utils/sku');
const {
  resolveDisplaySize,
  filterMultiSkuSizeDumpText,
  isEmptySizeValue
} = require('../utils/skuSize');
const { craftTypeLabel, craftProcessLabel, buildCraftDisplayTags } = require('../../../config/productTaxonomy');
const { trackBehavior } = require('../../../utils/trackBehavior');
const { ensureOpenId, markCartDirty, fetchCartCount, updateCartTabBadge } = require('../../../utils/cartHelper');
const { getCustomNavLayout } = require('../utils/customNav');
const { getWindowInfo } = require('../../../utils/systemInfo');
const { buildHeroSlides } = require('../utils/heroMedia');
const {
  ANIMAL_ETHICS_LABEL,
  ANIMAL_ETHICS_SUMMARY,
  ANIMAL_ETHICS_NOTE,
  isAnimalSpecimenProduct
} = require('../utils/animalEthicsNotice');
const {
  ONE_PERCENT_PLEDGE_LABEL,
  ONE_PERCENT_PLEDGE_SUMMARY,
  ONE_PERCENT_PLEDGE_NOTE
} = require('../utils/onePercentPledge');
const {
  resolveCareCategory,
  getCategoryMeta,
  buildGuideUrl,
  isSpecimenCareProduct
} = require('../utils/careDefaults');
const { fetchCareGuide } = require('../utils/careApi');
const { getPolicy, getNoticeDisplay } = require('../utils/refundPolicy');
const { isProtectedProduct } = require('../../../utils/protectionBadge');
const { toChineseTaxonomy } = require('../utils/taxonomyZh');
const { isOneOfAKindProduct } = require('../../../utils/productStats');
const { isSinglePageMode, blockIfSinglePage } = require('../../../utils/singlePageMode');
const {
  DETAIL_TAG_STYLE,
  DETAIL_HTML_CONTAINER_STYLE,
  buildDescriptionDisplay,
  hasDetailHtml,
  prepareDetailHtml
} = require('../utils/detailContent');
const { pickCaptionSource, drawKnowledgeCard, CARD_W, CARD_H } = require('../utils/knowledgeCard');

const PROTECTION_LABELS = {
  sanyou: '三有保护动物',
  protected_plant: '保护植物',
  protected_animal: '保护动物'
};

/** 规格大图高宽比夹取区间：区间内按原图比例完整铺宽；超出（超长竖图 / 超宽横图）定在边界并 aspectFit 留底色 */
const SPEC_RATIO_MIN = 0.5;
const SPEC_RATIO_MAX = 1.25;

/** 横图、方图：头图区域是边长等于屏宽的正方形，图片居中裁切铺满，不留上下空边。
 *  竖图：仍是半屏窗口（42%–50% 屏高的中部），居中，只裁上下边缘。
 *  多图切换只改这一截高度，由样式过渡，不猛跳。 */
const HERO_VIEW_MIN = 0.42;
const HERO_VIEW_MAX = 0.50;

/** 售罄底栏 CTA 态本地缓存：避免异步拉到 deposit/wishlist 前先闪「未付」默认态 */
const DETAIL_CTA_CACHE_PREFIX = 'detail_cta_v1_';
const DETAIL_CTA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function resolveOpenidSync() {
  try {
    return (app && app.globalData && app.globalData.openid) || '';
  } catch (e) {
    return '';
  }
}

function detailCtaCacheKey(productId, openid) {
  const pid = String(productId || '').trim();
  if (!pid) return '';
  const oid = String(openid || resolveOpenidSync() || '').trim() || 'guest';
  return DETAIL_CTA_CACHE_PREFIX + pid + '_' + oid;
}

function readDetailCtaCache(productId, openid) {
  const key = detailCtaCacheKey(productId, openid);
  if (!key) return null;
  try {
    const raw = wx.getStorageSync(key);
    if (!raw || typeof raw !== 'object') return null;
    const savedAt = Number(raw.savedAt) || 0;
    if (!savedAt || (Date.now() - savedAt) > DETAIL_CTA_CACHE_TTL_MS) return null;
    return raw;
  } catch (e) {
    return null;
  }
}

function writeDetailCtaCache(productId, patch, openid) {
  const key = detailCtaCacheKey(productId, openid);
  if (!key || !patch || typeof patch !== 'object') return;
  try {
    wx.setStorageSync(key, {
      savedAt: Date.now(),
      inWishlist: !!patch.inWishlist,
      inFavorite: !!patch.inFavorite,
      hasDepositIntent: !!patch.hasDepositIntent,
      depositAmountHint: patch.depositAmountHint != null ? String(patch.depositAmountHint) : '',
      depositBalanceHint: patch.depositBalanceHint != null ? String(patch.depositBalanceHint) : '',
      depositStatus: patch.depositStatus || '',
      depositStatusLabel: patch.depositStatusLabel || '',
      canPayDeposit: !!patch.canPayDeposit,
      canPayBalance: !!patch.canPayBalance,
      depositIntentId: patch.depositIntentId || ''
    });
  } catch (e) { /* quota / private mode */ }
}

function engagementPatchFromCache(cached) {
  if (!cached) return null;
  return {
    inWishlist: !!cached.inWishlist,
    inFavorite: !!cached.inFavorite,
    hasDepositIntent: !!cached.hasDepositIntent,
    depositAmountHint: cached.depositAmountHint != null ? String(cached.depositAmountHint) : '',
    depositBalanceHint: cached.depositBalanceHint != null ? String(cached.depositBalanceHint) : '',
    depositStatus: cached.depositStatus || '',
    depositStatusLabel: cached.depositStatusLabel || '',
    canPayDeposit: !!cached.canPayDeposit,
    canPayBalance: !!cached.canPayBalance,
    depositIntentId: cached.depositIntentId || '',
    engagementReady: true
  };
}

/** 标本档案缺省占位（与 PARAMETERS 区一致，中性不误导） */
const ARCHIVE_EMPTY_PLACEHOLDER = '—';

/**
 * 解析商品 ID：直链 options.id，或扫码 options.scene。
 * scene 兼容：纯 productId（generateShareCard）、id=xxx、productId=xxx。
 */
function resolveProductIdFromOptions(options) {
  const opts = options || {};
  if (opts.id) return String(opts.id).trim();

  let scene = opts.scene ? String(opts.scene) : '';
  if (!scene && typeof wx.getEnterOptionsSync === 'function') {
    try {
      const enter = wx.getEnterOptionsSync();
      const q = (enter && enter.query) || {};
      if (q.scene) scene = String(q.scene);
    } catch (e) {}
  }
  if (!scene) return '';

  try {
    scene = decodeURIComponent(scene);
  } catch (e) {}
  scene = String(scene || '').trim();
  if (!scene) return '';

  if (scene.indexOf('=') >= 0) {
    const params = {};
    scene.split('&').forEach((pair) => {
      const i = pair.indexOf('=');
      if (i < 0) return;
      let k = pair.slice(0, i);
      let v = pair.slice(i + 1);
      try {
        k = decodeURIComponent(k);
        v = decodeURIComponent(v);
      } catch (e) {}
      if (k) params[k] = v;
    });
    const fromKv = String(params.id || params.productId || '').trim();
    if (fromKv) return fromKv;
  }

  // generateShareCard：scene 即为 productId
  return scene;
}

function isBlankArchiveText(value) {
  return !String(value == null ? '' : value).trim();
}

/** 无标本师，或后台默认写入的 NATURE（且无 framerId） */
function isEmptyArchiveFramer(product) {
  const name = String((product && product.framerName) || '').trim();
  const id = product && product.framerId;
  if (!name) return true;
  if (!id && /^NATURE$/i.test(name)) return true;
  return false;
}

function buildArchiveDisplay(product, sizeOverride) {
  const p = product || {};
  const originEmpty = isBlankArchiveText(p.origin);
  const dateRaw = p.collectDate || p.date;
  const dateEmpty = isBlankArchiveText(dateRaw);
  const override = sizeOverride != null ? String(sizeOverride).trim() : '';
  const sizeRaw = override || p.size;
  const sizeEmpty = override
    ? !override
    : isEmptySizeValue(p.size);
  const framerEmpty = isEmptyArchiveFramer(p);
  const framingLabel = craftTypeLabel(p.craftType) || '';
  const processLabel = craftProcessLabel(p.craftProcess) || '';
  return {
    origin: originEmpty ? ARCHIVE_EMPTY_PLACEHOLDER : String(p.origin).trim(),
    originEmpty,
    date: dateEmpty ? ARCHIVE_EMPTY_PLACEHOLDER : String(dateRaw).trim(),
    dateEmpty,
    size: sizeEmpty ? ARCHIVE_EMPTY_PLACEHOLDER : String(sizeRaw).trim(),
    sizeEmpty,
    framerName: framerEmpty ? ARCHIVE_EMPTY_PLACEHOLDER : String(p.framerName).trim(),
    framerEmpty,
    framerId: framerEmpty ? '' : (p.framerId || ''),
    framingMethod: framingLabel,
    framingEmpty: !framingLabel,
    craftProcess: processLabel,
    craftProcessEmpty: !processLabel
  };
}

function uniqUrls(list) {
  const seen = new Set();
  const out = [];
  (list || []).forEach((url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  });
  return out;
}

function skuImageList(sku) {
  if (!sku) return [];
  if (Array.isArray(sku.images) && sku.images.length) {
    return uniqUrls(sku.images.filter(Boolean));
  }
  return sku.image ? [sku.image] : [];
}

/**
 * 多规格：按 SKU images 分组展示；单规格保持扁平 detailImages。
 * preferredSkuId：优先选中该规格分组。
 */
function buildDetailGalleryState(product, preferredSkuId) {
  const p = product || {};
  const productDetail = uniqUrls(p.detailImages || []);
  const skus = (p.skus || []).filter((s) => s && s.id);
  const groups = [];

  if (hasSkus(p) && skus.length >= 2) {
    skus.forEach((sku) => {
      const images = skuImageList(sku);
      if (!images.length) return;
      groups.push({
        id: String(sku.id),
        label: String(sku.specLabel || '规格').trim() || '规格',
        images
      });
    });
  }

  if (groups.length >= 2) {
    const skuImgSet = new Set();
    groups.forEach((g) => g.images.forEach((u) => skuImgSet.add(u)));
    const sharedSource = productDetail.length
      ? productDetail
      : uniqUrls(p.images || []);
    const sharedImages = sharedSource.filter((u) => !skuImgSet.has(u));
    let activeId = preferredSkuId ? String(preferredSkuId) : '';
    if (!groups.some((g) => g.id === activeId)) {
      activeId = groups[0].id;
    }
    const active = groups.find((g) => g.id === activeId) || groups[0];
    return {
      detailGalleryMode: 'sku',
      detailImageGroups: groups,
      sharedDetailImages: sharedImages,
      activeDetailGroupId: active.id,
      activeDetailGroupLabel: active.label,
      activeDetailImages: active.images,
      activeDetailSlide: 0,
      detailImages: active.images
    };
  }

  const flat = productDetail.length
    ? productDetail
    : uniqUrls((p.images || []).slice(1));
  return {
    detailGalleryMode: 'flat',
    detailImageGroups: [],
    sharedDetailImages: [],
    activeDetailGroupId: '',
    activeDetailGroupLabel: '',
    activeDetailImages: flat,
    activeDetailSlide: 0,
    detailImages: flat
  };
}

Page(withAppModal({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navPaddingRight: 96,
    productId: '',
    loadError: false,
    loadErrorMsg: '',
    /** 无可用缓存时展示骨架，避免 ¥0/已售罄半成品态 */
    detailSkeleton: true,
    /** 价格/库存已就绪（缓存完整或服务端返回） */
    commerceReady: false,
    /** 朋友圈单页模式（scene=1154） */
    isSinglePage: false,
    product: {},
    sensitiveBlurEnabled: false,
    sensitiveVeiled: false,
    sensitiveBadgeLabel: '已启视',
    archiveDisplay: {
      origin: '—',
      originEmpty: true,
      date: '—',
      dateEmpty: true,
      size: '—',
      sizeEmpty: true,
      framerName: '—',
      framerEmpty: true,
      framerId: '',
      framingMethod: '',
      framingEmpty: true,
      craftProcess: '',
      craftProcessEmpty: true
    },
    isOneOfAKind: false,
    uniqueBadgeLabel: '',
    uniquePlateTitle: '',
    uniquePlateDesc: '',
    uniqueStockLabel: '',
    refundServiceLabel: '发货前可申请退款',
    refundNoticeRichParagraphs: [],
    showRefundSheet: false,
    discountRate: 1.0,
    memberDiscountRate: 1.0,
    
    // UI 交互相关
    showPosterModal: false,
    posterImage: '',
    isPlaying: false,
    show360Modal: false,
    rotateX: 0, rotateY: 0, transition: 'transform 0.1s linear',
    showPointTip: false,
    pointTipText: '',
    recommends: [],
    craftTags: [],
    // 需求 17：详情页分级图 —— 按显示宽度取图，原图只留给全屏查看器
    imgView: {},
    imgThumbView: {},

    hasSku: false,
    /** null = 未知，勿用 0 冒充售罄 */
    displayStock: null,
    displayPrice: null,
    priceFrom: false,
    selectedSku: null,
    selectedSkuId: '',
    selectedSkuSizeText: '',
    showSkuSheet: false,
    skuAction: '',
    skuConfirmText: '确定',
    pendingSkuId: '',
    skuDimensions: [],
    dimensionOptions: [],
    selectedSpecs: {},

    imageIndex: 0,
    imageTotal: 0,
    heroSlides: [],
    heroPlaying: '',
    buyCount: 1,
    cartCount: 0,
    inWishlist: false,
    inFavorite: false,
    hasDepositIntent: false,
    depositAmountHint: '',
    depositBalanceHint: '',
    depositStatus: '',
    depositStatusLabel: '',
    canPayDeposit: false,
    canPayBalance: false,
    depositIntentId: '',
    showDepositCta: false,
    /** 售罄 CTA 是否已有缓存或云端态；无则同高度 skeleton，避免先闪默认「到货通知/付定金」 */
    engagementReady: false,
    wishlistBusy: false,
    favoriteBusy: false,
    depositBusy: false,
    specSummary: '默认规格',
    shippingRuleShort: '',
    shippingDetailOpen: false,
    shippingRuleText: (typeof shippingConfig.getRuleText === 'function')
      ? shippingConfig.getRuleText()
      : getShippingRuleText(),
    shippingHint: '',
    isShippingFree: false,
    showShippingStrike: false,
    originalShippingFeeDisplay: '',
    activeTab: 'detail',
    showStickyTabs: false,
    navOpacity: 0,
    commentTotal: 0,
    detailImages: [],
    detailGalleryMode: 'flat',
    detailImageGroups: [],
    sharedDetailImages: [],
    activeDetailGroupId: '',
    activeDetailGroupLabel: '',
    activeDetailImages: [],
    activeDetailSlide: 0,
    specSwiperH: 0,
    heroSwiperH: 0,
    heroFit: 'aspectFill',
    descriptionParagraphs: [],
    detailTagStyle: DETAIL_TAG_STYLE,
    detailHtmlContainerStyle: DETAIL_HTML_CONTAINER_STYLE,
    hasDetailHtml: false,
    detailHtmlContent: '',

    claimableCoupons: [],
    bestCoupon: null,
    couponSavedAmount: 0,
    couponSavedLabel: '',
    usableCouponCount: 0,
    couponHint: '',
    couponStripTags: [],
    showCouponStrip: false,
    showCouponSheet: false,
    showCouponPrint: false,
    printCoupon: {
      title: '',
      value: 0,
      minSpend: 0,
      expireDate: '',
      channel: 'all'
    },

    protectionLabel: '',
    isProtected: false,
    certificateUrl: '',
    showProtectionCert: false,

    showCareStrip: false,
    careSummary: '',
    careCategoryLabel: '',
    careCategoryColor: '#C4A76C',
    careGuideUrl: '',
    showAnimalEthics: false,
    ethicsExpanded: false,
    pledgeExpanded: false,
    animalEthicsLabel: ANIMAL_ETHICS_LABEL,
    animalEthicsSummary: ANIMAL_ETHICS_SUMMARY,
    animalEthicsNote: ANIMAL_ETHICS_NOTE,
    onePercentPledgeLabel: ONE_PERCENT_PLEDGE_LABEL,
    onePercentPledgeSummary: ONE_PERCENT_PLEDGE_SUMMARY,
    onePercentPledgeNote: ONE_PERCENT_PLEDGE_NOTE,
    showSpecimenCustom: false,
    showGift: false,
    // 需求 28：祈福墙开关（是否显示由 <wish-wall-entry> 组件按开关 + 藏品命中判定）
    wishWallEnabled: false
  },

  sectionTops: { detail: 0, archive: 0, review: 0 },

  onLoad(options) {
    const singlePage = isSinglePageMode(options);
    const nav = getCustomNavLayout();
    this.setData({
      isSinglePage: singlePage,
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navPaddingRight: nav.navPaddingRight,
      sensitiveBadgeLabel: getSensitiveBlurPref() === PREF_CLEAR ? '掩上' : COPY.badge
    });
    try {
      if (app && app.globalData) app.globalData.isSinglePage = singlePage;
    } catch (e) { /* ignore */ }

    this._trackMeta = {
      from: options.from || '',
      wikiId: options.wikiId || '',
      recordId: options.recordId || '',
      zone: options.zone || (options.from === 'wiki' ? 'related' : '')
    };

    this.setData({ pendingSkuId: options.skuId || '' });
    this._pendingLiveAction = String(options.action || '').trim(); // cart | buy（直播挂车跳转）
    this.loadDisplayFlags();

    const productId = resolveProductIdFromOptions(options);
    if (productId) {
      this.setData({ productId });
      this.applyCachedEngagementState(productId);
      this.bootstrapProductDetail(productId);
    } else {
      this.setData({
        loadError: true,
        loadErrorMsg: '缺少藏品信息',
        detailSkeleton: false,
        commerceReady: false
      });
    }
  },

  /**
   * 把「内容展示开关」应用到本页（单一入口，缓存值与新鲜值都走这里）。
   * 用签名挡掉重复应用：SWR 会把陈旧值先给一次、新鲜值再给一次，
   * 两次结果相同时不该白跑一遍 setData 与建图。
   */
  applyDisplayFlags(flags) {
    const f = flags || {};
    const sig = [f.showSpecimenCustom === true, f.showGift === true, f.showMaShangYou === true].join('|');
    if (sig === this._displayFlagsSig) return;
    this._displayFlagsSig = sig;
    this.setData({
      showSpecimenCustom: f.showSpecimenCustom === true,
      showGift: f.showGift === true,
      // 需求 28：祈福墙开关（缺配置默认关）。命中判定与跳转收在 <wish-wall-entry> 组件里，
      // 本页只负责把开关与藏品喂给它 —— 全站拓展时别的页面照抄这一行即可。
      wishWallEnabled: f.showMaShangYou === true
    });
    // 需求 17：开关可能刚把缩略图能力打开/关闭，重建分级图
    this.buildImageView();
    // 需求 28：祈福墙入口就在主图正下方 —— 开关一翻转，三个页签锚点整体位移一个入口的高度，
    // 必须重测（否则「藏品/档案/评价」会跳到错位处）。
    setTimeout(() => this.computeSectionTops(), 120);
  },

  /**
   * 读内容展示开关。
   *
   * ⚠️ 必须接住 SWR 的**后台刷新**：`fetchContentDisplayFlags` 缓存命中时**立刻返回缓存值**，
   * 新鲜值只在后台回填（缓存 TTL 10 分钟，陈旧窗口 24 小时）。
   * 只读一次返回值的话，超管刚把「马上有祈福」打开，本页最长 ~24 小时看不到入口 ——
   * 实测反馈「开关开了但详情页没有入口」就是这个。传 onUpdate 后：缓存值先上屏，
   * 新鲜值一到自动重放，既不额外发请求，也不会把新值丢掉。
   */
  async loadDisplayFlags() {
    try {
      const { fetchContentDisplayFlags } = require('../../../utils/contentDisplayFlags');
      const { flags } = await fetchContentDisplayFlags({
        onUpdate: (payload) => {
          try {
            this.applyDisplayFlags(payload && payload.flags);
          } catch (e) {
            console.warn('apply refreshed display flags', e);
          }
        }
      });
      this.applyDisplayFlags(flags);
    } catch (e) {
      // 开关读不到 → 保守关闭（UGC 新能力，读不到就当没开）
      this.applyDisplayFlags({});
    }
  },

  /**
   * 需求 28：祈福墙入口的「是否显示」与「点进去」都已收进 <wish-wall-entry> 组件
   * （见 `components/WishWallEntry`）。此处曾有一份 refreshWishWallEntry / goWishWall 副本，
   * 已删除：入口判定只留一处的意义就是不让每个宿主页面各判一次、各漂一次。
   */

  onShow() {
    this.loadCartCount();
    ensureShippingRules().then(() => {
      const p = this.data.product;
      if (p && this.data.displayPrice != null) {
        this.setData({
          ...this.buildShippingDisplay(this.data.displayPrice, p),
          shippingRuleText: this.buildShippingRuleText(p),
          shippingRuleShort: this.buildShippingRuleShortText(p),
        });
      } else {
        this.setData({
          shippingRuleText: (typeof shippingConfig.getRuleText === 'function')
            ? shippingConfig.getRuleText()
            : this.data.shippingRuleText
        });
      }
    }).catch(() => {});
    if (app.globalData.refreshCoupons && this.data.displayPrice > 0) {
      app.globalData.refreshCoupons = false;
      this.loadProductCoupons(this.data.displayPrice);
    }
    // 回页时后台刷新 CTA 态；首屏已用缓存渲染，避免再闪默认态
    if (this._productReady && this.data.productId) {
      this.loadEngagementState(this.data.productId);
    }
  },

  applyCachedEngagementState(productId) {
    const cached = readDetailCtaCache(productId);
    const patch = engagementPatchFromCache(cached);
    if (!patch) return false;
    this.setData(patch);
    return true;
  },

  persistEngagementCache(extra) {
    const id = (this.data.product && this.data.product._id) || this.data.productId;
    if (!id) return;
    writeDetailCtaCache(id, {
      inWishlist: this.data.inWishlist,
      inFavorite: this.data.inFavorite,
      hasDepositIntent: this.data.hasDepositIntent,
      depositAmountHint: this.data.depositAmountHint,
      depositBalanceHint: this.data.depositBalanceHint,
      depositStatus: this.data.depositStatus,
      depositStatusLabel: this.data.depositStatusLabel,
      canPayDeposit: this.data.canPayDeposit,
      canPayBalance: this.data.canPayBalance,
      depositIntentId: this.data.depositIntentId,
      ...(extra || {})
    });
  },

  onReady() {
    setTimeout(() => this.computeSectionTops(), 600);
  },

  onPageScroll(e) {
    const scrollTop = e.scrollTop || 0;
    const opacity = Math.min(scrollTop / 200, 1);
    const showStickyTabs = scrollTop > 420;
    let activeTab = 'detail';
    const tops = this.sectionTops || {};
    if (scrollTop >= (tops.review || 99999) - 120) activeTab = 'review';
    else if (scrollTop >= (tops.archive || 99999) - 120) activeTab = 'archive';
    else activeTab = 'detail';

    if (
      opacity !== this.data.navOpacity ||
      showStickyTabs !== this.data.showStickyTabs ||
      activeTab !== this.data.activeTab
    ) {
      this.setData({ navOpacity: opacity, showStickyTabs, activeTab });
    }
  },

  /**
   * 首屏：缓存/预填先渲染 → 静默拉全量；无缓存则骨架屏（无阻塞弹层）。
   */
  bootstrapProductDetail(id) {
    if (!id) {
      this.setData({
        loadError: true,
        loadErrorMsg: '藏品ID不存在',
        detailSkeleton: false,
        commerceReady: false
      });
      return;
    }

    this._loadSeq = (this._loadSeq || 0) + 1;
    const seq = this._loadSeq;
    this.setData({ productId: id, loadError: false, loadErrorMsg: '' });

    const peeked = peekProductDetail(id);
    const cached = peeked && peeked.data;
    if (cached) {
      Promise.resolve(this.applyProductPayload(cached, {
        fromCache: true,
        partial: isPartialPayload(cached),
        seq
      })).catch((e) => console.warn('apply cached product', e));
    } else {
      this.setData({
        detailSkeleton: true,
        commerceReady: false,
        displayPrice: null,
        displayStock: null
      });
    }

    this.loadProductDetail(id, {
      force: false,
      seq,
      // 有缓存则后台刷新；无缓存则等待网络
      background: !!cached
    });
  },

  async loadProductDetail(id, options) {
    const opts = options || {};
    if (!id) {
      this.setData({
        loadError: true,
        loadErrorMsg: '藏品ID不存在',
        detailSkeleton: false
      });
      return;
    }

    const seq = opts.seq != null ? opts.seq : (++this._loadSeq || (this._loadSeq = 1));
    this.setData({ productId: id, loadError: false, loadErrorMsg: '' });

    try {
      const data = await this.fetchProductDoc(id);
      if (seq !== this._loadSeq) return;

      setProductDetail(id, data);
      await this.applyProductPayload(data, {
        fromCache: false,
        partial: false,
        seq,
        runSideEffects: true
      });
    } catch (err) {
      if (seq !== this._loadSeq) return;
      console.error('加载商品详情失败:', err);

      // 已有可展示缓存时静默失败，不打断浏览
      if (this.data.commerceReady || (this.data.product && this.data.product._id)) {
        console.warn('详情静默刷新失败，保留已渲染内容');
        return;
      }

      let errorMsg = '档案调取失败';
      if (err.errCode === -1) {
        errorMsg = '藏品不存在或已下架';
      } else if (err.errMsg && err.errMsg.includes('permission')) {
        errorMsg = '权限不足，请检查数据库权限';
      } else if (err.message) {
        errorMsg = err.message;
      }

      this.setData({
        loadError: true,
        loadErrorMsg: errorMsg,
        detailSkeleton: false,
        commerceReady: false
      });
      wx.showToast({ title: errorMsg, icon: 'none', duration: 2000 });
    }
  },

  async fetchProductDoc(id) {
    const res = await db.collection('products').doc(id).get();
    if (!res.data) {
      throw new Error('藏品不存在');
    }

    let data = res.data;
    if (data.framerId) {
      try {
        const pub = await wx.cloud.callFunction({
          name: 'manageStaff',
          data: { action: 'getPublicFramer', framerId: String(data.framerId) }
        });
        const framer = pub && pub.result && pub.result.framer;
        if (framer && framer._id) {
          data = {
            ...data,
            framerId: framer._id,
            framerName: framer.name || data.framerName || ''
          };
        } else {
          const frRes = await db.collection('framers').doc(String(data.framerId)).get();
          const fr = frRes.data;
          if (fr && fr.active !== false && fr.name) {
            data = { ...data, framerName: fr.name };
          }
        }
      } catch (frErr) {
        console.warn('loadProductDetail framer', frErr);
      }
    }

    if (data.taxonomy) {
      data.taxonomy = toChineseTaxonomy(data.taxonomy);
    }

    data = await this.hydrateProductMedia(data);
    if (data._cacheMeta) {
      delete data._cacheMeta;
    }
    return data;
  },

  async hydrateProductMedia(data) {
    if (!data) return data;
    const cloudIds = [];
    const collect = (url) => {
      if (url && String(url).startsWith('cloud://')) cloudIds.push(url);
    };
    (data.images || []).forEach(collect);
    (data.detailImages || []).forEach(collect);
    collect(data.collectionCertificate);
    ;(data.skus || []).forEach((sku) => {
      if (!sku) return;
      collect(sku.image);
      (sku.images || []).forEach(collect);
    });

    const map = await batchTempFileURLs(cloudIds);
    if (!Object.keys(map).length) return data;

    const mapUrl = (u) => (u && map[u]) || u;
    return {
      ...data,
      images: (data.images || []).map(mapUrl),
      detailImages: (data.detailImages || []).map(mapUrl),
      collectionCertificate: mapUrl(data.collectionCertificate) || data.collectionCertificate,
      skus: (data.skus || []).map((sku) => {
        if (!sku) return sku;
        return {
          ...sku,
          image: mapUrl(sku.image) || sku.image,
          images: Array.isArray(sku.images) ? sku.images.map(mapUrl) : sku.images
        };
      })
    };
  },

  /**
   * 将商品文档（完整或预填）渲染到页面。
   * partial：列表预填，缺价/库存时不冒充 ¥0/已售罄。
   */
  async applyProductPayload(raw, meta) {
    const info = meta || {};
    if (info.seq != null && info.seq !== this._loadSeq) return;
    if (!raw || !raw._id) return;

    const partial = !!info.partial || isPartialPayload(raw);
    let data = { ...raw };
    if (data._cacheMeta) {
      data = { ...data };
      delete data._cacheMeta;
    }

    const oneOfAKind = isOneOfAKindProduct(data);
    data.isOneOfAKind = !!(data.isOneOfAKind || data.isUnique);
    data.isUnique = !!(data.isUnique || data.isOneOfAKind);
    const depositEligible = data.depositEligible === true
      || (data.depositEligible !== false && oneOfAKind);
    data.depositEligible = depositEligible;

    const uniqueBadgeLabel = data.isTreasure ? '镇店之宝' : (oneOfAKind ? '孤品' : '');
    const uniquePlateTitle = uniqueBadgeLabel;
    const uniquePlateDesc = data.isTreasure
      ? '馆藏级稀有藏品，页面展示即为您将收到的那一件。'
      : '所见即所得——页面展示即为您将收到的那一件。';
    const uniqueStockLabel = data.isTreasure ? '镇店之宝 · 仅此一件' : '孤品 · 仅此一件';

    const productHasSku = hasSkus(data);
    let displayPrice = null;
    let displayStock = null;
    let firstSku = null;
    let selectedSpecs = {};
    let commerceReady = !partial;

    if (productHasSku) {
      const totalStock = getTotalStock(data);
      data.stock = totalStock;
      firstSku = getFirstAvailableSku(data);
      selectedSpecs = initSelectedSpecs(data, firstSku);
      displayPrice = firstSku ? (parseFloat(firstSku.price) || 0) : getDisplayPrice(data);
      displayStock = firstSku ? (parseInt(firstSku.stock, 10) || 0) : totalStock;
      commerceReady = true;
    } else if (!partial) {
      const totalStock = getTotalStock(data);
      data.stock = totalStock;
      displayPrice = getDisplayPrice(data);
      displayStock = totalStock;
      commerceReady = true;
    } else {
      // 预填：仅在列表明确给出价/库存时展示商业态
      if (data.price != null && data.price !== '') {
        displayPrice = parseFloat(data.price);
        if (Number.isNaN(displayPrice)) displayPrice = null;
      }
      if (data.stock != null && data.stock !== '') {
        const n = Number(data.stock);
        displayStock = Number.isNaN(n) ? null : n;
      } else if (data.soldOut === true) {
        displayStock = 0;
      }
      commerceReady = displayPrice != null || displayStock != null;
      if (displayStock != null) data.stock = displayStock;
    }

    const pendingSkuId = this.data.pendingSkuId || '';
    const preferredSkuId = pendingSkuId || (firstSku && firstSku.id) || '';
    const galleryState = buildDetailGalleryState(data, preferredSkuId);

    const protectionType = data.protectionType || 'none';
    const protectionLabel = PROTECTION_LABELS[protectionType] || '';
    const isProtected = isProtectedProduct(protectionType);
    let certificateUrl = this.data.certificateUrl || '';
    if (!partial && isProtected && data.collectionCertificate) {
      certificateUrl = await this.resolveCloudImage(data.collectionCertificate);
      if (info.seq != null && info.seq !== this._loadSeq) return;
    }

    const selectedSkuSizeText = resolveDisplaySize(data, firstSku);
    const skuLabels = (data.skus || []).map((s) => s && s.specLabel).filter(Boolean);
    const descriptionForDisplay = productHasSku
      ? filterMultiSkuSizeDumpText(data.description, skuLabels)
      : data.description;

    data.latinName = sanitizeLatinName(data.latinName || data.latin || data.scientificName);

    const images = Array.isArray(data.images) ? data.images.filter(Boolean) : [];
    const heroSlides = buildHeroSlides(images, data.media);
    const stockForCta = displayStock != null ? displayStock : 0;

    const patch = {
      product: data,
      craftTags: buildCraftDisplayTags(data),
      sensitiveBlurEnabled: isSensitiveBlurProduct(data),
      sensitiveVeiled: shouldVeilSensitive(data),
      archiveDisplay: buildArchiveDisplay(data, selectedSkuSizeText),
      isOneOfAKind: oneOfAKind,
      showDepositCta: !!(depositEligible && commerceReady && (
        (firstSku ? (parseInt(firstSku.stock, 10) || 0) : stockForCta) <= 0
      )),
      uniqueBadgeLabel,
      uniquePlateTitle,
      uniquePlateDesc,
      uniqueStockLabel,
      hasSku: productHasSku,
      displayStock,
      displayPrice,
      priceFrom: productHasSku && (data.skus || []).length > 1,
      selectedSku: firstSku,
      selectedSkuId: firstSku ? firstSku.id : '',
      selectedSkuSizeText,
      selectedSpecs,
      imageTotal: heroSlides.length || images.length,
      imageIndex: 0,
      heroSlides,
      buyCount: 1,
      commerceReady,
      // 预填无图时继续骨架；完整档案到位后关闭（避免黑主图）
      detailSkeleton: partial ? !images.length : false,
      ...galleryState,
      ...(() => {
        if (partial && !data.description && !data.detailHtml) {
          return {};
        }
        const descDisplay = buildDescriptionDisplay(descriptionForDisplay);
        const htmlPrepared = prepareDetailHtml(data.detailHtml);
        return { ...descDisplay, detailHtmlContent: htmlPrepared };
      })(),
      hasDetailHtml: hasDetailHtml(data.detailHtml),
      ...(commerceReady && displayPrice != null
        ? this.buildShippingDisplay(displayPrice, data)
        : {}),
      shippingRuleText: this.buildShippingRuleText(data),
      shippingRuleShort: this.buildShippingRuleShortText(data),
      protectionLabel,
      isProtected,
      certificateUrl,
      showProtectionCert: !!(protectionLabel && certificateUrl),
      refundServiceLabel: getPolicy(data).shortLabel || getPolicy(data).serviceLabel,
      refundNoticeRichParagraphs: getNoticeDisplay(data).richParagraphs || [],
      loadError: false,
      loadErrorMsg: '',
      showAnimalEthics: isAnimalSpecimenProduct(data, resolveCareCategory)
    };

    this.setData(patch);
    this._productReady = !partial || commerceReady;
    this._commerceFetchedAt = info.fromCache ? (this._commerceFetchedAt || 0) : Date.now();
    this._commerceFromNetwork = !info.fromCache && !partial;

    if (!partial) {
      this.refreshDimensionOptions();
      this.updateSpecSummary();
    }

    if (info.runSideEffects && !partial) {
      if (this._pendingLiveAction === 'cart' || this._pendingLiveAction === 'buy') {
        const act = this._pendingLiveAction;
        this._pendingLiveAction = '';
        setTimeout(() => {
          if (act === 'cart' && typeof this.handleBuy === 'function') this.handleBuy();
          else if (act === 'buy' && typeof this.handleBuyNow === 'function') this.handleBuyNow();
        }, 200);
      }

      this.loadUserDiscount();
      this.loadRecommends(data);
      this.loadCommentStats(data._id);
      this.saveHistory(data);
      this.loadEngagementState(data._id);
      // 需求 28：商品落定后无需手动重算入口 —— <wish-wall-entry product="{{product}}"> 的
      // observers 会在 product 变化时自行判定（开关于商品先后到达也能正确收敛）
      // 需求 17：商品图/详情图就位后建立「显示宽度 → 取图 URL」映射
      this.buildImageView();
      if (displayPrice != null) this.loadProductCoupons(displayPrice);
      this.loadCarePreview(data);

      if (pendingSkuId) {
        this.selectSku({ currentTarget: { dataset: { id: pendingSkuId } } });
      }

      if (!this._trackedViewId || this._trackedViewId !== data._id) {
        this._trackedViewId = data._id;
        trackBehavior('product_view', 'product', data._id, {
          category: data.category || '',
          tags: Array.isArray(data.tags) ? data.tags : [],
          source: (this._trackMeta && this._trackMeta.from) || 'direct'
        });

        if (this._trackMeta && this._trackMeta.from === 'wiki' && this._trackMeta.wikiId) {
          trackBehavior('wiki_to_product', 'product', data._id, {
            wikiId: this._trackMeta.wikiId,
            zone: this._trackMeta.zone || 'related',
            source: 'product_detail'
          });
        } else if (this._trackMeta && this._trackMeta.from === 'identify') {
          trackBehavior('identify_to_product', 'product', data._id, {
            recordId: this._trackMeta.recordId || '',
            source: 'product_detail'
          });
        }
      }

      setTimeout(() => this.computeSectionTops(), 400);
    }
  },

  /** 下单/加购前：缓存过期或预填时强制刷新库存价 */
  async ensureFreshCommerce() {
    const id = this.data.productId || (this.data.product && this.data.product._id);
    if (!id) return false;
    if (this._commerceFromNetwork
      && this._commerceFetchedAt
      && (Date.now() - this._commerceFetchedAt) < DETAIL_TTL
      && this.data.commerceReady
      && !needsCriticalRefresh(id)) {
      return true;
    }
    try {
      const seq = ++this._loadSeq;
      const data = await this.fetchProductDoc(id);
      if (seq !== this._loadSeq) return this.data.commerceReady;
      setProductDetail(id, data);
      await this.applyProductPayload(data, {
        fromCache: false,
        partial: false,
        seq,
        runSideEffects: false
      });
      return !!this.data.commerceReady;
    } catch (e) {
      console.warn('ensureFreshCommerce', e);
      return !!this.data.commerceReady;
    }
  },

  retryLoadProduct() {
    const id = this.data.productId;
    if (!id) {
      this.goBack();
      return;
    }
    invalidateProductDetail(id);
    this.setData({
      detailSkeleton: true,
      commerceReady: false,
      displayPrice: null,
      displayStock: null,
      loadError: false
    });
    this.bootstrapProductDetail(id);
  },

  /** 运费行展示：免邮时划线目录运费 +「免邮」，与确认页口径一致 */
  buildShippingDisplay(price, product) {
    const ctx = product || this.data.product
    const amount = parseFloat(price) || 0
    let catalogRaw = shippingConfig.flatFee != null
      ? shippingConfig.flatFee
      : shippingConfig.shippingFee
    // 划线用的「目录运费」必须跟随本单档位：其它档是 ¥10，写死 flatFee(18) 会把划线价标错
    // （2026-09-20 真机截图：其它档商品运费显示 ¥10，说明文案却是 ¥299/¥18）
    if (typeof shippingConfig.resolveFee === 'function') {
      const tierFee = parseFloat(shippingConfig.resolveFee(ctx))
      if (Number.isFinite(tierFee) && tierFee >= 0) catalogRaw = tierFee
    }
    const catalogFee = Math.max(0, parseFloat(catalogRaw) || 0)
    let fee = 0
    if (typeof shippingConfig.calcShippingFee === 'function') {
      fee = shippingConfig.calcShippingFee(amount, ctx)
    } else if (!(
      (typeof shippingConfig.isCampaignActive === 'function' && shippingConfig.isCampaignActive()) ||
      (shippingConfig.freeShippingCampaign && shippingConfig.freeShippingCampaign.enabled === true)
    )) {
      fee = amount > 0 ? (catalogFee || 18) : 0
    }
    const isShippingFree = fee <= 0
    return {
      shippingHint: isShippingFree ? '免邮' : `¥${Number(fee).toFixed(2)}`,
      isShippingFree,
      showShippingStrike: isShippingFree && catalogFee > 0,
      originalShippingFeeDisplay: catalogFee > 0 ? Number(catalogFee).toFixed(2) : ''
    }
  },

  /** 收起态短句（那行 nowrap 单行，长文案会溢出；点一下展开看完整规则） */
  buildShippingRuleShortText(product) {
    const p = product || this.data.product || {};
    // ⚠️ 把**装裱方式的中文名**一并带进上下文：shipping 配置模块不允许 require 别的文件，
    //    而「其它档」要点名到具体装裱方式（产品负责人 2026-09-20：「选了塑封还显示其它」）。
    //    这里用 `craftTypeLabel()`（走**云端字典**），新增的「塑封/玻璃瓶」也能点名。
    const ctx = Object.assign({}, p, {
      craftTypeLabel: craftTypeLabel(p.craftType) || p.craftTypeLabel || ''
    });
    if (typeof shippingConfig.getRuleTextShort === 'function') {
      return shippingConfig.getRuleTextShort(ctx);
    }
    return this.buildShippingRuleText(product);
  },

  /** 「说明」行：收起 ⇄ 展开（展开显示完整规则，含承运商与"否则运费 ¥X"） */
  toggleShippingRuleDetail() {
    this.setData({ shippingDetailOpen: !this.data.shippingDetailOpen });
  },

  buildShippingRuleText(product) {
    const ctx = product || this.data.product
    if (typeof shippingConfig.getRuleText === 'function') {
      return shippingConfig.getRuleText(ctx);
    }
    return getShippingRuleText(ctx);
  },

  resolveCouponCheckPrice(productPrice) {
    const base = parseFloat(productPrice != null ? productPrice : this.data.displayPrice) || 0
    const rate = parseFloat(this.data.discountRate) || 1
    if (rate > 0 && rate < 1) {
      return Math.round(base * rate * 100) / 100
    }
    return base
  },

  formatSavedLabel(amount) {
    const n = Number(amount) || 0
    if (!n) return '0'
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
  },

  buildCouponStrip(claimableCoupons, bestCoupon, savedAmount, usableCount) {
    const tags = []
    const seen = {}
    ;(claimableCoupons || []).forEach((c) => {
      if (!c || c.claimed || !c.label) return
      if (seen[c.label]) return
      seen[c.label] = 1
      tags.push({ id: `c_${c._id}`, label: c.label })
    })
    if (bestCoupon && bestCoupon.label && !seen[bestCoupon.label]) {
      tags.push({ id: `b_${bestCoupon._id}`, label: bestCoupon.label })
    }

    const hasClaimable = (claimableCoupons || []).some((c) => c && !c.claimed)
    const hasUsable = !!bestCoupon || usableCount > 0
    const hasContent = tags.length > 0 || hasClaimable || hasUsable

    const savedLabel = this.formatSavedLabel(savedAmount)
    let couponHint = '查看'
    if (bestCoupon && savedAmount > 0) {
      couponHint = tags.length ? '去使用' : `下单可省 ¥${savedLabel}`
    } else if (hasClaimable) {
      couponHint = '去领取'
    } else if (usableCount > 0) {
      couponHint = `${usableCount} 张可用`
    }

    return {
      couponStripTags: tags.slice(0, 6),
      couponHint: hasContent ? couponHint : '',
      couponSavedLabel: savedLabel,
      showCouponStrip: hasContent
    }
  },

  async loadProductCoupons(productPrice) {
    const listPrice = parseFloat(productPrice != null ? productPrice : this.data.displayPrice) || 0;
    const price = this.resolveCouponCheckPrice(productPrice);
    if (price <= 0 && listPrice <= 0) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getProductCoupons',
        data: {
          productPrice: price > 0 ? price : listPrice,
          // 目录原价用于 75% 地板展示；免邮按标价估算
          originalPrice: listPrice,
          shippingBaseAmount: listPrice,
          // 免邮券省额按「本单适用门槛」分档（裁决 48）：含相框/玻璃罩→299 档（券最多省 ¥18）；
          // 其它类型→39 档（券最多省 ¥10）。详情页只有这一件商品的上下文 → 就按它算门槛。
          shippingThreshold: typeof shippingConfig.resolveThreshold === 'function'
            ? shippingConfig.resolveThreshold(this.data.product)
            : 0
        }
      });
      const result = res.result || {};
      if (!result.success) return;

      const claimableCoupons = result.claimableCoupons || [];
      const bestCoupon = result.bestCoupon || null;
      const couponSavedAmount = result.savedAmount || 0;
      const usableCouponCount = result.usableCount || 0;
      const strip = this.buildCouponStrip(
        claimableCoupons,
        bestCoupon,
        couponSavedAmount,
        usableCouponCount
      );

      this.setData({
        claimableCoupons,
        bestCoupon,
        couponSavedAmount,
        usableCouponCount,
        ...strip
      });
    } catch (e) {
      console.warn('优惠券加载失败', e);
    }
  },

  openCouponSheet() {
    this.setData({ showCouponSheet: true });
  },

  closeCouponSheet() {
    this.setData({ showCouponSheet: false });
  },

  async claimCoupon(e) {
    const couponId = e.currentTarget.dataset.id;
    const claimed = e.currentTarget.dataset.claimed;
    if (!couponId || claimed) return;
    wx.showLoading({ title: '领取中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'receiveCoupon',
        data: { couponId, receiveType: 'manual' }
      });
      wx.hideLoading();
      if (res.result && res.result.success) {
        try {
          const { invalidateAfterCoupon } = require('../utils/cacheInvalidate')
          invalidateAfterCoupon()
        } catch (err) { /* ignore */ }
        const coupon = res.result.coupon || {};
        const claimed = (this.data.claimableCoupons || []).find((c) => c._id === couponId) || {};
        let expireDate = '';
        if (coupon.expireTime) {
          const d = new Date(coupon.expireTime);
          if (!Number.isNaN(d.getTime())) {
            expireDate = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
          }
        }
        this.setData({
          showCouponSheet: false,
          showCouponPrint: true,
          printCoupon: {
            title: coupon.title || claimed.title || '礼券',
            value: Number(coupon.value != null ? coupon.value : claimed.value) || 0,
            minSpend: Number(coupon.minSpend) || 0,
            expireDate,
            channel: coupon.channel || 'all'
          }
        });
        this.loadProductCoupons(this.data.displayPrice);
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '领取失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '领取失败', icon: 'none' });
    }
  },

  goToCoupons() {
    wx.navigateTo({ url: '/subpackages/business/coupons/index' });
  },

  closeCouponPrint() {
    this.setData({ showCouponPrint: false });
  },

  goWalletFromPrint() {
    this.setData({ showCouponPrint: false });
    this.goToCoupons();
  },

  buyNowWithCoupon() {
    this.setData({ showCouponSheet: false });
    this.handleBuyNow();
  },

  updateSpecSummary() {
    const { hasSku, selectedSku, selectedSpecs, skuDimensions, product } = this.data;
    let specSummary = '默认规格';
    if (hasSku) {
      if (selectedSku && selectedSku.specLabel) {
        specSummary = selectedSku.specLabel;
      } else if (skuDimensions.length) {
        const parts = skuDimensions.map((d) => selectedSpecs[d]).filter(Boolean);
        specSummary = parts.length ? parts.join(' / ') : '请选择规格';
      } else {
        specSummary = '请选择规格';
      }
    }
    this.setData({ specSummary });
  },

  async loadCartCount() {
    const count = await fetchCartCount(app);
    this.setData({ cartCount: count });
    updateCartTabBadge(count);
  },

  async loadCommentStats(id) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getComments',
        data: { targetType: 'product', targetId: id, limit: 1, skip: 0 }
      });
      if (res.result && res.result.success && res.result.stats) {
        this.setData({ commentTotal: res.result.stats.total || 0 });
      }
    } catch (e) {
      console.warn('评价统计加载失败', e);
    }
  },

  async loadCarePreview(product) {
    if (!isSpecimenCareProduct(product)) {
      this.setData({ showCareStrip: false });
      return;
    }
    try {
      const category = resolveCareCategory(product);
      const { guide } = await fetchCareGuide(category);
      const meta = getCategoryMeta(category);
      this.setData({
        showCareStrip: true,
        careSummary: guide.summary || '签收后请按品类指南妥善安放。',
        careCategoryLabel: meta.label,
        careCategoryColor: meta.color,
        careGuideUrl: buildGuideUrl({ category, from: 'product' })
      });
    } catch (e) {
      console.warn('loadCarePreview', e);
      this.setData({ showCareStrip: false });
    }
  },

  goToCareGuide() {
    const url = this.data.careGuideUrl;
    if (!url) return;
    const category = resolveCareCategory(this.data.product);
    trackBehavior('care_guide_view', 'category', category);
    wx.navigateTo({ url });
  },

  toggleBrandNote(e) {
    const field = e.currentTarget.dataset.field;
    if (field !== 'ethicsExpanded' && field !== 'pledgeExpanded') return;
    this.setData({ [field]: !this.data[field] });
  },

  computeSectionTops() {
    const q = wx.createSelectorQuery().in(this);
    q.select('#section-detail').boundingClientRect();
    q.select('#section-archive').boundingClientRect();
    q.select('#section-review').boundingClientRect();
    q.selectViewport().scrollOffset();
    q.exec((res) => {
      if (!res || !res[3]) return;
      const scrollTop = res[3].scrollTop || 0;
      const offset = 100;
      this.sectionTops = {
        detail: Math.max(0, (res[0]?.top || 0) + scrollTop - offset),
        archive: Math.max(0, (res[1]?.top || 0) + scrollTop - offset),
        review: Math.max(0, (res[2]?.top || 0) + scrollTop - offset)
      };
    });
  },

  onSwiperChange(e) {
    this.setData({ imageIndex: e.detail.current || 0 }, () => this.syncHeroHeight());
  },

  onHeroMediaChange(e) {
    this.pauseHeroVideos();
    this.setData({ imageIndex: e.detail.current || 0 }, () => this.syncHeroHeight());
  },

  pauseHeroVideos() {
    (this.data.heroSlides || []).forEach((s) => {
      if (s.vid) wx.createVideoContext(s.vid, this).pause();
    });
  },

  onHeroLiveTap(e) {
    const { vid, kind } = e.currentTarget.dataset;
    if (kind !== 'live' || !vid) return;
    const ctx = wx.createVideoContext(vid, this);
    if (this.data.heroPlaying === vid) ctx.pause();
    else ctx.play();
  },

  onHeroVideoPlay(e) {
    this.setData({ heroPlaying: e.currentTarget.id || '' });
  },

  onHeroVideoPause() {
    if (this.data.heroPlaying) this.setData({ heroPlaying: '' });
  },

  onHide() {
    if ((this.data.heroSlides || []).length) this.pauseHeroVideos();
  },

  skuConfirmLabel(action) {
    if (action === 'cart') return '加入购物车';
    if (action === 'buyNow') return '立即购买';
    return '确定';
  },

  openSkuSheet() {
    if (blockIfSinglePage()) return;
    if (!this.data.commerceReady || this.data.displayStock == null || this.data.displayStock <= 0) {
      wx.showToast({ title: '暂不可购', icon: 'none' });
      return;
    }
    this.setData({
      showSkuSheet: true,
      skuAction: 'select',
      skuConfirmText: this.skuConfirmLabel('select')
    });
  },

  scrollToSection(e) {
    const tab = e.currentTarget.dataset.tab;
    const top = (this.sectionTops && this.sectionTops[tab]) || 0;
    wx.pageScrollTo({ scrollTop: top, duration: 300 });
    this.setData({ activeTab: tab });
  },

  changeBuyCount(e) {
    const delta = parseInt(e.currentTarget.dataset.delta, 10) || 0;
    const max = Math.max(1, this.data.displayStock || 1);
    let next = (this.data.buyCount || 1) + delta;
    if (next < 1) next = 1;
    if (next > max) {
      wx.showToast({ title: `最多 ${max} 件`, icon: 'none' });
      next = max;
    }
    this.setData({ buyCount: next });
  },

  goToCart() {
    if (blockIfSinglePage()) return;
    markCartDirty(app);
    wx.switchTab({ url: '/pages/cart/index' });
  },

  goToSupport() {
    try {
      const { buildSupportQuery } = require('../utils/supportHelper');
      const p = this.data.product || {};
      const id = p._id || p.id || '';
      const url =
        '/subpackages/extra/user/support/index' +
        buildSupportQuery({
          topic: 'product',
          productId: id,
          productName: p.title || p.name || ''
        });
      wx.navigateTo({
        url,
        fail: () => wx.showToast({ title: '无法打开客服', icon: 'none' })
      });
    } catch (e) {
      console.error('goToSupport failed:', e);
      wx.showToast({ title: '无法打开客服', icon: 'none' });
    }
  },

  goToCustom() {
    if (!this.data.showSpecimenCustom) {
      const { toastSpecimenCustomClosed } = require('../../../utils/contentDisplayFlags');
      toastSpecimenCustomClosed();
      return;
    }
    const p = this.data.product || {};
    const id = p._id || p.id || '';
    if (id && p.supportsCustom === false) {
      this.modal({
        title: '暂不支持定制',
        overline: 'CUSTOM UNAVAILABLE',
        content: '该件为成品藏品，暂不提供工坊定制服务。如需咨询，请联系门店专员。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    if (!id) {
      wx.navigateTo({ url: '/subpackages/feature/custom/index?from=detail' });
      return;
    }
    wx.navigateTo({
      url: `/subpackages/feature/custom/index?from=detail&productId=${id}&step=2`
    });
  },

  goToGift() {
    if (!this.data.showGift) {
      const { toastGiftClosed } = require('../../../utils/contentDisplayFlags');
      toastGiftClosed();
      return;
    }
    if (!this.data.commerceReady || this.data.displayStock == null || this.data.displayStock <= 0) {
      wx.showToast({ title: '暂时无货', icon: 'none' });
      return;
    }
    const p = this.data.product || {};
    const id = p._id || p.id || '';
    if (!id) {
      wx.showToast({ title: '藏品信息异常', icon: 'none' });
      return;
    }
    if (p.giftEligible === false) {
      wx.showToast({ title: '这件暂不适合礼赠', icon: 'none' });
      return;
    }
    const sku = this.data.selectedSku;
    const skuQ = sku && sku.id ? `&skuId=${encodeURIComponent(sku.id)}` : '';
    const count = this.data.buyCount || 1;
    trackBehavior('gift_entry_click', 'from', 'detail');
    wx.navigateTo({
      url: `/subpackages/feature/gift/compose/index?productId=${id}&count=${count}${skuQ}&from=detail`,
      fail: () => wx.showToast({ title: '礼赠暂未能打开', icon: 'none' })
    });
  },

  previewDetailImage(e) {
    const current = e.currentTarget.dataset.current;
    const urls = (this.data.activeDetailImages && this.data.activeDetailImages.length)
      ? this.data.activeDetailImages
      : (this.data.detailImages || []);
    if (urls.length) wx.previewImage({ current, urls });
  },

  previewSharedDetailImage(e) {
    const current = e.currentTarget.dataset.current;
    const urls = this.data.sharedDetailImages || [];
    if (urls.length) wx.previewImage({ current, urls });
  },

  async resolveCloudImage(src) {
    if (!src) return '';
    if (String(src).startsWith('cloud://')) {
      try {
        const map = await batchTempFileURLs([src]);
        return map[src] || src;
      } catch (e) {
        console.warn('resolveCloudImage', e);
      }
    }
    return src;
  },

  previewCertificate() {
    const url = this.data.certificateUrl;
    if (url) wx.previewImage({ current: url, urls: [url] });
  },

  // 加入购物车：留在详情，弱提示 + 更新角标
  async handleBuy() {
    if (blockIfSinglePage()) return;
    if (!this.data.commerceReady) {
      wx.showToast({ title: '档案同步中', icon: 'none' });
      return;
    }
    await this.ensureFreshCommerce();
    if ((this.data.displayStock == null) || this.data.displayStock <= 0) {
      this.modal({
        title: '遗憾通知',
        overline: 'SOLD OUT',
        content: '该藏品已被其他收藏家珍藏。',
        showCancel: false
      });
      return;
    }
    if (!this.data.hasSku) {
      this.setData({ skuAction: 'cart', buyCount: 1 });
      this.addToCartDirect();
      return;
    }
    this.setData({
      showSkuSheet: true,
      skuAction: 'cart',
      skuConfirmText: this.skuConfirmLabel('cart'),
      buyCount: 1
    });
  },

  // 立即购买
  async handleBuyNow() {
    if (blockIfSinglePage()) return;
    wx.vibrateShort({ type: 'heavy' });
    if (!this.data.commerceReady) {
      wx.showToast({ title: '档案同步中', icon: 'none' });
      return;
    }
    await this.ensureFreshCommerce();
    if ((this.data.displayStock == null) || this.data.displayStock <= 0) {
      this.modal({
        title: '遗憾通知',
        overline: 'UNAVAILABLE',
        content: '该藏品暂不可购。',
        showCancel: false
      });
      return;
    }
    this.setData({
      showSkuSheet: true,
      skuAction: 'buyNow',
      skuConfirmText: this.skuConfirmLabel('buyNow'),
      buyCount: 1
    });
  },

  refreshDimensionOptions() {
    const product = this.data.product;
    const selectedSpecs = this.data.selectedSpecs || {};
    const dims = getSkuDimensions(product);
    const dimensionOptions = dims.map((name) => ({
      name,
      values: getDimensionValues(product, name, selectedSpecs).map((value) => ({
        value,
        disabled: !isDimensionValueAvailable(product, name, value, selectedSpecs)
      }))
    }));
    this.setData({ skuDimensions: dims, dimensionOptions });
  },

  applySkuSelection(selectedSpecs, sku) {
    const product = this.data.product;
    const displayPrice = sku ? (parseFloat(sku.price) || 0) : getDisplayPrice(product);
    const displayStock = sku ? (parseInt(sku.stock, 10) || 0) : 0;
    let buyCount = this.data.buyCount || 1;
    if (buyCount > displayStock) buyCount = Math.max(1, displayStock);
    const galleryPatch = this.data.detailGalleryMode === 'sku'
      ? this.resolveDetailGroupPatch(sku && sku.id)
      : {};
    const selectedSkuSizeText = resolveDisplaySize(product, sku);
    this.setData({
      selectedSpecs,
      selectedSku: sku || null,
      selectedSkuId: sku ? sku.id : '',
      selectedSkuSizeText,
      archiveDisplay: buildArchiveDisplay(product, selectedSkuSizeText),
      displayPrice,
      displayStock,
      showDepositCta: !!(product && product.depositEligible) && (displayStock <= 0 || this.data.canPayBalance),
      buyCount,
      ...galleryPatch,
      ...this.buildShippingDisplay(displayPrice, product),
      shippingRuleText: this.buildShippingRuleText(product),
      shippingRuleShort: this.buildShippingRuleShortText(product),
    });
    if (galleryPatch.activeDetailImages) this.syncSpecSwiperHeight();
    this.refreshDimensionOptions();
    this.updateSpecSummary();
    this.loadProductCoupons(displayPrice);
  },

  resolveDetailGroupPatch(skuId) {
    const groups = this.data.detailImageGroups || [];
    if (!groups.length) return {};
    const id = skuId ? String(skuId) : '';
    const active = groups.find((g) => g.id === id) || groups[0];
    if (!active) return {};
    if (
      active.id === this.data.activeDetailGroupId &&
      this.data.activeDetailSlide === 0
    ) {
      return {
        activeDetailGroupId: active.id,
        activeDetailGroupLabel: active.label,
        activeDetailImages: active.images,
        detailImages: active.images
      };
    }
    return {
      activeDetailGroupId: active.id,
      activeDetailGroupLabel: active.label,
      activeDetailImages: active.images,
      activeDetailSlide: 0,
      detailImages: active.images
    };
  },

  selectDetailGroup(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.activeDetailGroupId) return;
    const groups = this.data.detailImageGroups || [];
    const group = groups.find((g) => g.id === String(id));
    if (!group) return;

    const sku = (this.data.product.skus || []).find((s) => s && String(s.id) === String(id));
    if (sku) {
      const selectedSpecs = initSelectedSpecs(this.data.product, sku);
      this.applySkuSelection(selectedSpecs, sku);
      return;
    }

    this.setData({
      activeDetailGroupId: group.id,
      activeDetailGroupLabel: group.label,
      activeDetailImages: group.images,
      activeDetailSlide: 0,
      detailImages: group.images
    }, () => this.syncSpecSwiperHeight());
  },

  onDetailSwiperChange(e) {
    const idx = (e.detail && e.detail.current) || 0;
    this.setData({ activeDetailSlide: idx }, () => this.syncSpecSwiperHeight());
  },

  /** 规格大图加载：记原图高宽比；是当前这张就按比例给 swiper 定高 */
  onSpecImageLoad(e) {
    const { width, height } = e.detail || {};
    const src = e.currentTarget.dataset.src;
    if (!width || !height || !src) return;
    (this._specRatio || (this._specRatio = {}))[src] = height / width;
    if (src === (this.data.activeDetailImages || [])[this.data.activeDetailSlide || 0]) this.syncSpecSwiperHeight();
  },

  syncSpecSwiperHeight() {
    const src = (this.data.activeDetailImages || [])[this.data.activeDetailSlide || 0];
    const ratio = src && this._specRatio && this._specRatio[src];
    if (!ratio) return;
    const apply = (w) => {
      const h = Math.round(w * Math.min(SPEC_RATIO_MAX, Math.max(SPEC_RATIO_MIN, ratio)));
      if (h !== this.data.specSwiperH) this.setData({ specSwiperH: h });
    };
    if (this._specW) return apply(this._specW);
    this.createSelectorQuery().select('.detail-spec-swiper').boundingClientRect((rect) => {
      if (!rect || !rect.width) return;
      this._specW = rect.width;
      apply(rect.width);
    }).exec();
  },

  /** 当前头图（或视频海报）的原始地址，用来对上 bindload 记下的高宽比 */
  heroSlideSrc(index) {
    const slides = this.data.heroSlides || [];
    const idx = index == null ? (this.data.imageIndex || 0) : index;
    if (slides.length) {
      const s = slides[idx];
      if (!s) return '';
      return s.kind === 'image' ? (s.src || '') : (s.poster || '');
    }
    const images = (this.data.product && this.data.product.images) || [];
    return images[idx] || '';
  },

  onHeroImageLoad(e) {
    const { width, height } = e.detail || {};
    const src = e.currentTarget.dataset.src;
    if (!width || !height || !src) return;
    (this._heroRatio || (this._heroRatio = {}))[src] = height / width;
    if (src === this.heroSlideSrc()) this.syncHeroHeight();
  },

  /** 横图、方图铺成正方形；竖图保持半屏。高度跟当前这张走，样式负责过渡。 */
  syncHeroHeight() {
    const src = this.heroSlideSrc();
    const ratio = src && this._heroRatio && this._heroRatio[src];
    if (!ratio) return;
    const win = getWindowInfo();
    const w = win.windowWidth || 375;
    const screenH = win.windowHeight || 667;
    const half = Math.round(screenH * (HERO_VIEW_MIN + HERO_VIEW_MAX) / 2);
    const box = ratio > 1 ? half : Math.round(w);
    const heroFit = 'aspectFill';
    if (box !== this.data.heroSwiperH || heroFit !== this.data.heroFit) {
      this.setData({ heroSwiperH: box, heroFit });
    }
  },

  selectDimension(e) {
    const { dim, value } = e.currentTarget.dataset;
    if (!dim || !value) return;

    const selectedSpecs = { ...(this.data.selectedSpecs || {}), [dim]: value };
    const sku = resolveSkuFromSpecs(this.data.product, selectedSpecs);
    this.applySkuSelection(selectedSpecs, sku);
  },

  selectSku(e) {
    const skuId = e.currentTarget.dataset.id;
    const sku = (this.data.product.skus || []).find((s) => s.id === skuId);
    if (!sku) return;
    const selectedSpecs = initSelectedSpecs(this.data.product, sku);
    this.applySkuSelection(selectedSpecs, sku);
  },

  closeSkuSheet() {
    this.setData({ showSkuSheet: false, skuAction: '', skuConfirmText: '确定' });
  },

  confirmSkuAction() {
    const dims = this.data.skuDimensions || [];
    const selectedSpecs = this.data.selectedSpecs || {};

    if (this.data.hasSku) {
      const allSelected = dims.every((d) => selectedSpecs[d]);
      if (!allSelected) {
        wx.showToast({ title: '请选择完整规格', icon: 'none' });
        return;
      }
      if (!this.data.selectedSkuId) {
        wx.showToast({ title: '所选规格不可用', icon: 'none' });
        return;
      }
    }
    if (this.data.displayStock == null || this.data.displayStock <= 0) {
      wx.showToast({ title: '该规格已售罄', icon: 'none' });
      return;
    }
    const action = this.data.skuAction;
    this.setData({ showSkuSheet: false });
    if (action === 'cart') {
      this.addToCartDirect();
    } else if (action === 'buyNow') {
      this.buyNowDirect();
    }
  },

  async addToCartDirect() {
    if (this._addingCart) return;
    this._addingCart = true;
    wx.vibrateShort({ type: 'medium' });
    const p = this.data.product;
    if (!p || !p._id) {
      this._addingCart = false;
      wx.showToast({ title: '藏品信息异常', icon: 'none' });
      return;
    }

    const openid = await ensureOpenId(app);
    if (!openid) {
      this._addingCart = false;
      wx.showToast({ title: '登录中，请稍后重试', icon: 'none' });
      return;
    }

    const sku = this.data.selectedSku;
    const skuId = sku ? sku.id : '';
    const price = sku ? sku.price : p.price;
    const count = this.data.buyCount || 1;

    wx.showLoading({ title: '加入中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'toggleCollection',
        data: {
          targetId: p._id,
          type: 'product',
          action: 'add',
          skuId,
          skuLabel: sku ? sku.specLabel : '',
          snapshot: {
            title: p.title,
            image: getFirstImage(p.images),
            price,
            latinName: p.latinName,
            skuLabel: sku ? sku.specLabel : '',
            count,
            isTreasure: !!p.isTreasure,
            isUnique: !!(p.isUnique || p.isOneOfAKind)
          }
        }
      });
      wx.hideLoading();
      if (res.result && res.result.success) {
        markCartDirty(app);
        trackBehavior('product_add_cart', 'product', p._id, {
          skuId,
          count,
          action: res.result.action || 'add',
          tags: Array.isArray(p.tags) ? p.tags : []
        });

        const prev = this.data.cartCount || 0;
        const nextCount = res.result.action === 'merged' ? prev : prev + 1;
        this.setData({ cartCount: nextCount });
        updateCartTabBadge(nextCount);

        wx.showToast({ title: '已加入购物车', icon: 'success' });

        const cartCount = await fetchCartCount(app);
        this.setData({ cartCount });
        updateCartTabBadge(cartCount);
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '加入失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '网络异常', icon: 'none' });
    } finally {
      this._addingCart = false;
    }
  },

  async loadEngagementState(productId) {
    const id = productId || (this.data.product && this.data.product._id);
    if (!id) return;
    try {
      const openid = await ensureOpenId(app);
      if (!openid) {
        if (!this.data.engagementReady) this.setData({ engagementReady: true });
        return;
      }
      // openid 就绪后若 onLoad 用 guest 未命中，再补读一次真实 key
      if (!this.data.engagementReady) {
        const cachedPatch = engagementPatchFromCache(readDetailCtaCache(id, openid));
        if (cachedPatch) this.setData(cachedPatch);
      }
      const cloudDb = wx.cloud.database();
      const [wishRes, favRes, depositCf] = await Promise.all([
        cloudDb.collection('collections').where({
          _openid: openid,
          productId: id,
          type: 'wishlist'
        }).limit(1).get(),
        cloudDb.collection('collections').where({
          _openid: openid,
          productId: id,
          type: 'favorite'
        }).limit(1).get(),
        wx.cloud.callFunction({
          name: 'createDepositIntent',
          data: { action: 'status', productId: id }
        }).catch(() => ({ result: null }))
      ]);
      const deposit = (depositCf && depositCf.result) || {};
      const status = deposit.status || '';
      const patch = {
        inWishlist: !!(wishRes.data && wishRes.data.length),
        inFavorite: !!(favRes.data && favRes.data.length),
        hasDepositIntent: !!deposit.hasDepositIntent,
        depositAmountHint: deposit.depositAmount != null ? String(deposit.depositAmount) : '',
        depositBalanceHint: deposit.balanceAmount != null ? String(deposit.balanceAmount) : '',
        depositStatus: status,
        depositStatusLabel: deposit.statusLabel || '',
        canPayDeposit: !!deposit.canPayDeposit,
        canPayBalance: !!deposit.canPayBalance,
        depositIntentId: deposit.intentId || '',
        showDepositCta: !!(this.data.product && this.data.product.depositEligible) && (
          (this.data.displayStock || 0) <= 0 || !!deposit.canPayBalance
        ),
        engagementReady: true
      };
      this.setData(patch);
      writeDetailCtaCache(id, patch, openid);
    } catch (e) {
      // 无记录时仍结束 skeleton，避免底栏一直占位
      if (!this.data.engagementReady) {
        this.setData({ engagementReady: true });
      }
    }
  },

  async toggleFavorite() {
    if (this.data.favoriteBusy || this._favoriteBusy) return;
    if ((this.data.displayStock || 0) <= 0) {
      wx.showToast({ title: '售罄请用「想要」候补', icon: 'none' });
      return;
    }
    this._favoriteBusy = true;
    this.setData({ favoriteBusy: true });
    wx.vibrateShort({ type: 'light' });

    const p = this.data.product;
    if (!p || !p._id) {
      this._favoriteBusy = false;
      this.setData({ favoriteBusy: false });
      wx.showToast({ title: '藏品信息异常', icon: 'none' });
      return;
    }

    const openid = await ensureOpenId(app);
    if (!openid) {
      this._favoriteBusy = false;
      this.setData({ favoriteBusy: false });
      wx.showToast({ title: '登录中，请稍后重试', icon: 'none' });
      return;
    }

    const wasIn = !!this.data.inFavorite;
    try {
      const res = await wx.cloud.callFunction({
        name: 'toggleCollection',
        data: {
          targetId: p._id,
          type: 'favorite',
          action: wasIn ? 'remove' : 'add',
          snapshot: {
            title: p.title,
            image: getFirstImage(p.images),
            price: this.data.displayPrice || p.price,
            latinName: p.latinName,
            soldOut: false
          }
        }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || '操作失败', icon: 'none' });
        return;
      }
      if (result.action === 'removed') {
        this.setData({ inFavorite: false });
        wx.showToast({ title: '已取消收藏', icon: 'none' });
      } else {
        this.setData({ inFavorite: true });
        wx.showToast({
          title: result.already ? '已在收藏中' : '已收藏',
          icon: 'success'
        });
      }
      trackBehavior('product_favorite', 'product', p._id, {
        action: result.action || (wasIn ? 'remove' : 'add')
      });
    } catch (e) {
      wx.showToast({ title: '网络异常', icon: 'none' });
    } finally {
      this._favoriteBusy = false;
      this.setData({ favoriteBusy: false });
    }
  },

  async toggleWishlist() {
    if (this.data.wishlistBusy || this._wishlistBusy) return;
    const soldOut = (this.data.displayStock || 0) <= 0;
    if (!soldOut && !this.data.inWishlist) {
      wx.showToast({ title: '有货时请用「收藏」', icon: 'none' });
      return;
    }
    this._wishlistBusy = true;
    this.setData({ wishlistBusy: true });
    wx.vibrateShort({ type: 'light' });

    const p = this.data.product;
    if (!p || !p._id) {
      this._wishlistBusy = false;
      this.setData({ wishlistBusy: false });
      wx.showToast({ title: '藏品信息异常', icon: 'none' });
      return;
    }

    const openid = await ensureOpenId(app);
    if (!openid) {
      this._wishlistBusy = false;
      this.setData({ wishlistBusy: false });
      wx.showToast({ title: '登录中，请稍后重试', icon: 'none' });
      return;
    }

    const wasIn = !!this.data.inWishlist;
    try {
      const res = await wx.cloud.callFunction({
        name: 'toggleCollection',
        data: {
          targetId: p._id,
          type: 'wishlist',
          action: wasIn ? 'remove' : 'add',
          snapshot: {
            title: p.title,
            image: getFirstImage(p.images),
            price: this.data.displayPrice || p.price,
            latinName: p.latinName,
            soldOut
          }
        }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || '操作失败', icon: 'none' });
        return;
      }
      if (result.action === 'removed') {
        this.setData({ inWishlist: false });
        this.persistEngagementCache({ inWishlist: false });
        wx.showToast({ title: '已取消想要候补', icon: 'none' });
      } else {
        this.setData({ inWishlist: true });
        this.persistEngagementCache({ inWishlist: true });
        wx.showToast({
          title: result.already ? '已登记想要' : '已登记想要，到货优先通知',
          icon: 'success'
        });
      }
      trackBehavior('product_wishlist', 'product', p._id, {
        action: result.action || (wasIn ? 'remove' : 'add'),
        soldOut
      });
    } catch (e) {
      wx.showToast({ title: '网络异常', icon: 'none' });
    } finally {
      this._wishlistBusy = false;
      this.setData({ wishlistBusy: false });
    }
  },

  async handleDeposit() {
    if (this.data.depositBusy || this._depositBusy) return;
    if ((this.data.displayStock || 0) > 0 && !this.data.canPayBalance) {
      wx.showToast({ title: '有货时可直接购买', icon: 'none' });
      return;
    }
    if (!this.data.showDepositCta && !this.data.canPayBalance) {
      wx.showToast({ title: '该藏品暂不支持定金', icon: 'none' });
      return;
    }

    // 待尾款：走结算页正式单（定金抵扣）
    if (this.data.canPayBalance || this.data.depositStatus === 'awaiting_balance') {
      return this.handlePayBalance();
    }

    // 已付定金等待上架
    if (this.data.depositStatus === 'deposit_paid') {
      this.modal({
        title: '定金已支付',
        overline: 'DEPOSIT PAID',
        content: this.data.depositAmountHint
          ? `已支付定金 ¥${this.data.depositAmountHint}。上架后请在时限内付尾款；逾期开放且定金不退。`
          : '定金已支付。上架后请在时限内付尾款；逾期开放且定金不退。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    if (this.data.depositStatus === 'settled') {
      wx.showToast({ title: '该定金已付清', icon: 'none' });
      return;
    }

    const p = this.data.product;
    if (!p || !p._id) {
      wx.showToast({ title: '藏品信息异常', icon: 'none' });
      return;
    }

    this._depositBusy = true;
    this.setData({ depositBusy: true });
    wx.vibrateShort({ type: 'light' });

    const openid = await ensureOpenId(app);
    if (!openid) {
      this._depositBusy = false;
      this.setData({ depositBusy: false });
      wx.showToast({ title: '登录中，请稍后重试', icon: 'none' });
      return;
    }

    const price = Number(this.data.displayPrice || p.price) || 0;
    const suggest = Math.max(50, Math.min(500, Math.round(price * 0.1) || 50));

    try {
      const confirm = await this.modal({
        title: '支付定金',
        overline: 'DEPOSIT',
        content: `参考定金约 ¥${suggest}（售价约 10%，以实际为准）。\n\n支付后获得优先制作权；上架后请在时限内付尾款。逾期未付则开放给他人，定金不退。`,
        confirmText: '立即支付',
        cancelText: '再看看'
      }).then((r) => !!r.confirm);
      if (!confirm) return;

      wx.showLoading({ title: '创建定金单…', mask: true });
      let res;
      try {
        res = await wx.cloud.callFunction({
          name: 'createDepositIntent',
          data: {
            productId: p._id,
            skuId: (this.data.selectedSku && this.data.selectedSku.id) || '',
            skuLabel: (this.data.selectedSku && this.data.selectedSku.specLabel) || '',
            snapshot: {
              title: p.title,
              image: getFirstImage(p.images),
              price,
              latinName: p.latinName
            }
          }
        });
      } catch (cfErr) {
        wx.hideLoading();
        const tip =
          (cfErr && (cfErr.errMsg || cfErr.message)) ||
          '定金服务暂不可用';
        wx.showToast({
          title: /not found|FUNCTION_NOT_FOUND/i.test(String(tip))
            ? '定金服务未就绪'
            : (String(tip).slice(0, 36) || '定金服务暂不可用'),
          icon: 'none'
        });
        return;
      }
      wx.hideLoading();
      const result = (res && res.result) || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || '创建失败', icon: 'none' });
        return;
      }

      this.setData({
        hasDepositIntent: true,
        inWishlist: true,
        depositAmountHint: result.depositAmount != null ? String(result.depositAmount) : String(suggest),
        depositBalanceHint: result.balanceAmount != null ? String(result.balanceAmount) : '',
        depositStatus: result.status || 'pending_pay',
        depositIntentId: result.intentId || '',
        canPayDeposit: !!result.needPay,
        canPayBalance: !!result.canPayBalance,
        engagementReady: true
      });
      this.persistEngagementCache({
        hasDepositIntent: true,
        inWishlist: true,
        depositAmountHint: result.depositAmount != null ? String(result.depositAmount) : String(suggest),
        depositBalanceHint: result.balanceAmount != null ? String(result.balanceAmount) : '',
        depositStatus: result.status || 'pending_pay',
        depositIntentId: result.intentId || '',
        canPayDeposit: !!result.needPay,
        canPayBalance: !!result.canPayBalance
      });

      if (result.canPayBalance) {
        return this.handlePayBalance();
      }

      if (!result.needPay || !result.orderId) {
        this.modal({
          title: result.already ? '定金状态' : '已登记',
          overline: 'DEPOSIT STATUS',
          content: result.msg || '请查看定金状态',
          showCancel: false,
          /* 2026-09-21 分子级审计：纯告知型弹窗的确认键全站统一为「知道了」（其余 9 处均如此，
             此处原为「好的」）—— 仅改措辞，不改 confirmText 的语义与行为。 */
          confirmText: '知道了'
        });
        return;
      }

      // 须用主包 utils：feature 不可跨分包 require business
      const { payForOrder } = require('../utils/payment');
      try {
        const payResult = await payForOrder(result.orderId);
        const pending = !!(payResult && payResult.pendingConfirm);
        this.setData({
          depositStatus: pending ? 'pending_pay' : 'deposit_paid',
          canPayDeposit: !!pending,
          depositStatusLabel: pending ? '待付定金' : '已付定金'
        });
        this.persistEngagementCache({
          depositStatus: pending ? 'pending_pay' : 'deposit_paid',
          canPayDeposit: !!pending,
          depositStatusLabel: pending ? '待付定金' : '已付定金'
        });
        wx.showToast({
          title: pending ? '支付确认中' : '定金已支付',
          icon: pending ? 'none' : 'success'
        });
        trackBehavior('product_deposit_paid', 'product', p._id, {
          depositAmount: result.depositAmount,
          orderId: result.orderId,
          pending
        });
        this.loadEngagementState(p._id);
      } catch (payErr) {
        const msg = (payErr && payErr.message) || '支付未完成';
        if (msg !== '已取消支付' && !(payErr && payErr.cancelled)) {
          wx.showToast({ title: msg.slice(0, 40), icon: 'none' });
        }
      }
    } catch (e) {
      wx.hideLoading();
      console.error('handleDeposit', e);
      const msg = (e && (e.message || e.errMsg)) || '';
      wx.showToast({
        title: msg ? String(msg).slice(0, 40) : '操作失败，请重试',
        icon: 'none'
      });
    } finally {
      this._depositBusy = false;
      this.setData({ depositBusy: false });
    }
  },

  async handlePayBalance() {
    const p = this.data.product;
    if (!p || !p._id) {
      wx.showToast({ title: '藏品信息异常', icon: 'none' });
      return;
    }
    const intentId = this.data.depositIntentId;
    if (!intentId) {
      wx.showToast({ title: '未找到定金意向', icon: 'none' });
      return;
    }
    const balance = this.data.depositBalanceHint || '';
    const ok = await this.modal({
      title: '支付尾款',
      overline: 'BALANCE DUE',
      content: balance
        ? `已付定金将自动抵扣，约应付 ¥${balance}（结算页为准）。请确认收货信息后支付。`
        : '已付定金将自动抵扣，请在结算页确认应付金额后支付。',
      confirmText: '去结算',
      cancelText: '取消'
    }).then((r) => !!r.confirm);
    if (!ok) return;

    const sku = this.data.selectedSku;
    navigateToConfirmOrder([{
      productId: p._id,
      skuId: sku ? sku.id : '',
      skuLabel: sku ? sku.specLabel : '',
      count: 1,
      title: p.title,
      image: getFirstImage(sku && sku.image ? [sku.image] : p.images),
      price: sku ? sku.price : p.price,
      latinName: p.latinName,
      isTreasure: !!p.isTreasure,
      isUnique: !!(p.isUnique || p.isOneOfAKind),
      // 运费 v2（蓝图 §19）：尾款结算同样要带 craftType，否则展示与实收不一致
      craftType: p.craftType || '',
      shippingKind: p.shippingKind || ''
    }], {
      source: 'deposit_balance',
      depositIntentId: intentId
    });
  },

  buyNowDirect() {
    const p = this.data.product;
    if (!p || !p._id) {
      wx.showToast({ title: '藏品信息异常', icon: 'none' });
      return;
    }
    const sku = this.data.selectedSku;
    const count = this.data.buyCount || 1;
    navigateToConfirmOrder([{
      productId: p._id,
      skuId: sku ? sku.id : '',
      skuLabel: sku ? sku.specLabel : '',
      count,
      title: p.title,
      image: getFirstImage(sku && sku.image ? [sku.image] : p.images),
      price: sku ? sku.price : p.price,
      latinName: p.latinName,
      isTreasure: !!p.isTreasure,
      isUnique: !!(p.isUnique || p.isOneOfAKind),
      memberDiscountEnabled: p.memberDiscountEnabled !== false,
      categoryType: p.categoryType || '',
      rootCategoryName: p.rootCategoryName || '',
      category: p.category || p.categoryName || '',
      shippingKind: p.shippingKind || '',
      // 运费 v2（蓝图 §19）：判定只看 craftType
      craftType: p.craftType || '',
      protectionType: p.protectionType || 'none',
      isProtected: !!this.data.isProtected
    }], {
      source: 'buyNow',
      couponId: this.data.bestCoupon ? this.data.bestCoupon._id : null
    });
  },

  loadUserDiscount() {
    wx.cloud.callFunction({
      name: 'getUserStats',
      success: (res) => {
        if (res.result && res.result.discountRate) {
          const product = this.data.product || {};
          const rawRate = res.result.discountRate;
          const discountRate = product.memberDiscountEnabled === false ? 1 : rawRate;
          this.setData({ discountRate, memberDiscountRate: rawRate });
          if (this.data.displayPrice > 0) {
            this.loadProductCoupons(this.data.displayPrice);
          }
        }
      }
    });
  },

  async loadRecommends(product) {
    if (!product || !product._id) return;
    const currentId = String(product._id);
    const dedupeRecommendList = (list) => {
      const byId = {};
      const bySku = {};
      const out = [];
      ;(list || []).forEach((item) => {
        if (!item || !item._id) return;
        const id = String(item._id);
        if (id === currentId || byId[id]) return;
        const title = String(item.title || item.name || '').trim().toLowerCase();
        const price = Number(item.price);
        const skuKey = title
          ? `${title}::${Number.isFinite(price) ? price.toFixed(2) : ''}`
          : id;
        if (bySku[skuKey]) return;
        byId[id] = 1;
        bySku[skuKey] = 1;
        out.push(item);
      });
      return out.slice(0, 4);
    };
    const hydrateRecommendSensitive = (list) =>
      (list || []).map((item) => ({
        ...item,
        sensitiveBlur: isSensitiveBlurProduct(item),
        craftTags: buildCraftDisplayTags(item)
      }));

    try {
      const res = await wx.cloud.callFunction({
        name: 'getRecommendations',
        data: {
          userId: app.globalData.openid,
          productId: product._id,
          category: product.category,
          limit: 8
        }
      });
      const list = (res.result && res.result.data)
        || (res.result && res.result.recommendations)
        || [];
      this.setData({ recommends: hydrateRecommendSensitive(dedupeRecommendList(list)) });
      this.buildImageView();
    } catch (e) {
      try {
        const _ = db.command;
        const fb = await db.collection('products')
          .where({ category: product.category, isOffShelf: _.neq(true), _id: _.neq(product._id) })
          .limit(12)
          .get();
        this.setData({ recommends: hydrateRecommendSensitive(dedupeRecommendList(fb.data || [])) });
        this.buildImageView();
      } catch (err) {
        console.warn('相关推荐加载失败', err);
      }
    }
  },

  onSensitiveBlurChange(e) {
    const detail = (e && e.detail) || {};
    const patch = {};
    if (typeof detail.veiled === 'boolean') {
      patch.sensitiveVeiled = detail.veiled;
    }
    if (detail.badge) {
      patch.sensitiveBadgeLabel = detail.badge;
    } else {
      patch.sensitiveBadgeLabel = getSensitiveBlurPref() === PREF_CLEAR ? '掩上' : COPY.badge;
    }
    if (Object.keys(patch).length) this.setData(patch);
  },

  onNavSensitiveVeil() {
    const gate = this.selectComponent('#sensitiveBlurGate');
    if (gate && typeof gate.onVeil === 'function') {
      gate.onVeil();
      return;
    }
    clearSensitiveRevealed(this.data.productId);
    this.setData({
      sensitiveVeiled: true,
      sensitiveBadgeLabel: getSensitiveBlurPref() === PREF_CLEAR ? '掩上' : COPY.badge
    });
  },

  /**
   * 需求 17：详情页分级取图。
   *
   * 为什么是「一个 URL→URL 的映射」而不是给每个列表各存一份视图数组：
   * 页面上要显示图的槽位有 5 处（主图 swiper / 规格细节 swiper / 更多细节 / 长图文 / 相关推荐），
   * 其中前 4 处的数据都是 `product.images`、`product.detailImages`、`sku.images` 的**派生子集**
   * （见 buildDetailLayout / buildDetailSelectionPatch / selectDetailGroup）。
   * 只要把**源列表**映射好，所有派生子集自动命中；漏掉某个派生槽位也只会回落原图，不会破图。
   *
   * 尺寸口径：
   *   - 大槽位（主图/细节/长图文）→ detailUrl()：宽度 = windowWidth × pixelRatio（夹在 750–1600）。
   *     ⚠️ 原口径写死 750（按"2 倍屏"），3 倍屏上是 1170 → 等于放大 1.5 倍显示，是"图不清晰"的直接来源
   *   - 小槽位（更多细节缩略 200rpx / 相关推荐 200rpx）→ railUrl(360)：3 倍屏只需 300
   *   - **全屏查看器（wx.previewImage）刻意仍用原图** —— 用户会双指放大，750px 会糊
   */
  buildImageView() {
    const { detailUrl, railUrl, isThumbUsable } = require('../../../utils/imageUrl');
    if (!isThumbUsable()) {
      // 能力未确认 / 已降级：清空映射 = 全部回落原图（与改动前行为完全一致）
      if (Object.keys(this.data.imgView || {}).length || Object.keys(this.data.imgThumbView || {}).length) {
        this.setData({ imgView: {}, imgThumbView: {} });
      }
      return;
    }
    const product = this.data.product || {};
    const big = [];
    const small = [];
    (product.images || []).forEach((u) => big.push(u));
    (product.detailImages || []).forEach((u) => big.push(u));
    (product.skus || []).forEach((sku) => {
      skuImageList(sku).forEach((u) => big.push(u));
      (sku && sku.detailImages || []).forEach((u) => big.push(u));
    });
    (this.data.detailImages || []).forEach((u) => big.push(u));
    (this.data.activeDetailImages || []).forEach((u) => big.push(u));
    (this.data.sharedDetailImages || []).forEach((u) => small.push(u));
    (this.data.recommends || []).forEach((r) => {
      const u = r && ((r.images && r.images[0]) || r.image || r.httpImage);
      if (u) small.push(u);
    });

    // 合并而非替换：商品与推荐是两次异步加载，先到的映射不能被后到的清掉
    const imgView = { ...(this.data.imgView || {}) };
    const imgThumbView = { ...(this.data.imgThumbView || {}) };
    let added = 0;
    big.forEach((u) => {
      if (!u || imgView[u]) return;
      const v = detailUrl(u);
      if (v && v !== u) { imgView[u] = v; added += 1; }
    });
    small.forEach((u) => {
      if (!u || imgThumbView[u]) return;
      const v = railUrl(u);
      if (v && v !== u) { imgThumbView[u] = v; added += 1; }
    });
    if (added || this.data.imgView || this.data.imgThumbView) {
      this.setData({ imgView, imgThumbView });
    }
  },

  /**
   * 需求 17：任一分级图加载失败 → 让能力自我降级，并立刻把映射清空回原图。
   * 这样「能力其实不可用」的最坏情况只表现为一次多余的失败请求，不会整页破图。
   */
  onImageDegrade() {
    try {
      require('../../../utils/imageUrl').onImageError();
    } catch (e) { /* 工具缺失不影响降级 */ }
    if (Object.keys(this.data.imgView || {}).length || Object.keys(this.data.imgThumbView || {}).length) {
      this.setData({ imgView: {}, imgThumbView: {} });
    }
  },

  previewImage(e) {
    if (shouldVeilSensitive(this.data.product) || this.data.sensitiveVeiled) {
      return;
    }
    const current = e.currentTarget.dataset.current;
    const urls = (this.data.product.images || []).length
      ? this.data.product.images
      : [current];
    wx.previewImage({ current, urls });
  },

  /** 规格弹层缩略图：当前规格图优先，urls 对齐主图列表并并入规格图 */
  previewSkuImage() {
    const product = this.data.product || {};
    const selectedSku = this.data.selectedSku;
    const productImages = (product.images || []).filter(Boolean);
    const skuImages = skuImageList(selectedSku);
    const current =
      skuImages[0] ||
      (selectedSku && selectedSku.image) ||
      productImages[0] ||
      '';
    if (!current) return;

    const seen = new Set();
    const urls = [];
    const push = (url) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    };
    productImages.forEach(push);
    skuImages.forEach(push);
    push(current);
    (product.skus || []).forEach((sku) => {
      skuImageList(sku).forEach(push);
    });

    wx.previewImage({ current, urls: urls.length ? urls : [current] });
  },

  handleTitleClick() {
    wx.vibrateShort({ type: 'light' });
  },

  showAR() {
    const id = this.data.product._id;
    if (!id) return;
    wx.navigateTo({ url: `/subpackages/business/ar/index?productId=${id}` });
  },

  /** 礼赠面板：点场景 chip → 礼赠 hub 并直接进入该场景（复用 hub 的 selectScene 深链） */
  goGiftScene(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '').trim()
    if (!key) return
    wx.navigateTo({
      url: `/subpackages/feature/gift/hub/index?enterScene=${encodeURIComponent(key)}&from=detail_scene`,
      fail: () => wx.showToast({ title: '礼赠暂不可用', icon: 'none' })
    })
  },

  /** 礼赠面板：一键送礼 → 直接进这件藏品的礼笺页 */
  goGiftCompose() {
    const id = String((this.data.product && this.data.product._id) || '').trim()
    if (!id) return
    wx.navigateTo({
      url: `/subpackages/feature/gift/compose/index?productId=${encodeURIComponent(id)}&from=detail_gift`,
      fail: () => wx.showToast({ title: '礼赠暂不可用', icon: 'none' })
    })
  },

  goToFramer(e) {
    if (this.data.archiveDisplay && this.data.archiveDisplay.framerEmpty) return;
    const id = e.currentTarget.dataset.id || (this.data.product && this.data.product.framerId);
    if (!id) {
      wx.showToast({ title: '标本师信息缺失', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/subpackages/business/framer/index?id=${encodeURIComponent(String(id))}`,
      fail: () => wx.showToast({ title: '无法打开标本师档案', icon: 'none' })
    });
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '藏品不存在', icon: 'none' });
      return;
    }
    const url = `/subpackages/feature/detail/index?id=${encodeURIComponent(String(id))}`;
    // 推荐位就在详情页内，navigateTo 会不断叠加同一路由（微信最多 10 层，叠满后点击失效）
    // 这里按当前栈顶路由决定：同路由用 redirectTo，其它情况先看层级再决定
    const pages = getCurrentPages();
    const current = pages[pages.length - 1];
    const isSameRoute = current && current.route === 'subpackages/feature/detail/index';
    if (isSameRoute || pages.length >= 9) {
      wx.redirectTo({
        url,
        fail: (err) => {
          console.error('打开藏品详情失败', err);
          wx.showToast({ title: '无法打开藏品', icon: 'none' });
        }
      });
      return;
    }
    wx.navigateTo({
      url,
      fail: (err) => {
        console.error('打开商品详情失败', err);
        wx.showToast({ title: '无法打开藏品', icon: 'none' });
      }
    });
  },

  handleAudio() {
    wx.showToast({ title: '音频导览筹备中', icon: 'none' });
  },

  async createPoster() {
    const p = this.data.product;
    if (!p || !p._id) {
      wx.showToast({ title: '藏品信息未就绪', icon: 'none' });
      return;
    }
    if (this._posterBusy) return;
    this._posterBusy = true;
    wx.showLoading({ title: '生成知识卡…', mask: true });

    try {
      const assets = await this.loadKnowledgeCardAssets(p);
      const posterPath = await this.renderKnowledgeCard(assets);
      wx.hideLoading();
      if (!posterPath) {
        wx.showToast({ title: '知识卡生成失败', icon: 'none' });
        return;
      }
      this.setData({ showPosterModal: true, posterImage: posterPath });
    } catch (e) {
      console.error('createPoster', e);
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '知识卡生成失败', icon: 'none' });
    } finally {
      this._posterBusy = false;
    }
  },

  async loadKnowledgeCardAssets(product) {
    let remote = null;
    try {
      const res = await wx.cloud.callFunction({
        name: 'generateShareCard',
        data: { productId: product._id, type: 'product' }
      });
      const result = (res && res.result) || {};
      if (result.success && result.data) remote = result.data;
      else if (result.msg) console.warn('generateShareCard:', result.msg);
    } catch (e) {
      console.warn('generateShareCard call failed, fallback local', e);
    }

    const localImage = getFirstImage(product.images) || product.cover || product.image || '';
    const imageSrc = (remote && remote.imageTempUrl) || (await this.resolveCloudImage(localImage)) || localImage;
    const imagePath = await this.downloadToLocal(imageSrc);
    const qrPath = await this.downloadToLocal(remote && remote.qrTempUrl);

    return {
      productId: product._id,
      title: (remote && remote.title) || product.title || '藏品',
      latinName: sanitizeLatinName((remote && remote.latinName) || product.latinName || product.latin || product.scientificName || ''),
      category: (remote && remote.category) || product.category || '',
      taxonomy: product.taxonomy || null,
      origin: product.origin || '',
      caption: pickCaptionSource(product, remote),
      brand: (remote && remote.brand) || '山海造物',
      brandEn: (remote && remote.brandEn) || "NATURE'S CREATIONS",
      tagline: (remote && remote.tagline) || '把山海带回家',
      imagePath,
      qrPath
    };
  },

  downloadToLocal(url) {
    if (!url) return Promise.resolve('');
    if (!/^https?:\/\//i.test(url) && !String(url).startsWith('cloud://')) {
      return Promise.resolve(url);
    }
    return new Promise((resolve) => {
      const run = (src) => {
        wx.downloadFile({
          url: src,
          success: (r) => resolve(r.tempFilePath || ''),
          fail: () => resolve('')
        });
      };
      if (String(url).startsWith('cloud://')) {
        this.resolveCloudImage(url).then((http) => run(http || '')).catch(() => resolve(''));
      } else {
        run(url);
      }
    });
  },

  loadCanvasImage(canvas, src) {
    return new Promise((resolve) => {
      if (!src || !canvas) {
        resolve(null);
        return;
      }
      const img = canvas.createImage();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  },

  initPosterCanvas() {
    const W = CARD_W;
    const H = CARD_H;
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select('#posterCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const node = res && res[0] && res[0].node;
          if (!node) {
            reject(new Error('画布初始化失败'));
            return;
          }
          const ctx = node.getContext('2d');
          const dpr = (wx.getSystemInfoSync() && wx.getSystemInfoSync().pixelRatio) || 2;
          node.width = W * dpr;
          node.height = H * dpr;
          ctx.scale(dpr, dpr);
          resolve({ canvas: node, ctx, dpr, W, H });
        });
    });
  },

  async renderKnowledgeCard(assets) {
    const { canvas, ctx, dpr, W, H } = await this.initPosterCanvas();
    const a = assets || {};
    const [image, qr] = await Promise.all([
      this.loadCanvasImage(canvas, a.imagePath),
      this.loadCanvasImage(canvas, a.qrPath)
    ]);
    drawKnowledgeCard(ctx, a, { image, qr });

    return await new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        width: W,
        height: H,
        destWidth: W * dpr,
        destHeight: H * dpr,
        fileType: 'png',
        quality: 1,
        success: (r) => resolve(r.tempFilePath || ''),
        fail: (err) => reject(err || new Error('导出失败'))
      }, this);
    });
  },

  closePosterModal() {
    this.setData({ showPosterModal: false });
  },

  openRefundSheet() {
    this.setData({ showRefundSheet: true });
  },

  closeRefundSheet() {
    this.setData({ showRefundSheet: false });
  },

  savePoster() {
    if (!this.data.posterImage) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.posterImage,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (/auth|authorize|permission/i.test(msg)) {
          this.modal({
            title: '需要相册权限',
            overline: 'ALBUM ACCESS',
            content: '请在设置中允许保存到相册，以便收藏知识卡。',
            confirmText: '去设置'
          }).then((r) => { if (r.confirm) wx.openSetting({}); });
          return;
        }
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    });
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/category/index' })
    });
  },
  show360() { this.setData({ show360Modal: true }); },
  close360() { this.setData({ show360Modal: false }); },
  
  // 3D 触摸逻辑
  on360TouchStart(e) { this.lastX = e.touches[0].clientX; this.lastY = e.touches[0].clientY; this.setData({ transition: 'none' }); },
  on360TouchMove(e) {
    const cx = e.touches[0].clientX, cy = e.touches[0].clientY;
    const dx = cx - this.lastX, dy = cy - this.lastY;
    this.setData({ rotateY: this.data.rotateY + dx * 0.5, rotateX: this.data.rotateX - dy * 0.5 });
    this.lastX = cx; this.lastY = cy;
  },
  on360TouchEnd() { this.setData({ transition: 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }); },
  
  saveHistory(product) { 
      let h = wx.getStorageSync('visit_history') || []; 
      const idx = h.findIndex(i => i._id === product._id);
      if(idx > -1) h.splice(idx, 1);
      h.unshift({
        _id: product._id, 
        title: product.title, 
        image: getFirstImage(product.images)
      });
      if(h.length > 20) h.pop();
      wx.setStorageSync('visit_history', h);
  },

  // 🟢 分享功能
  onShareAppMessage(options) {
    const product = this.data.product || {};
    const id = product._id || this.data.productId || '';
    const userId = app.globalData.openid;

    if (userId && id) {
      this.recordShare(userId, 'product', id, 'wechat');
    }

    return {
      title: `${product.title || '精美藏品'} | 山海造物`,
      path: id ? `/subpackages/feature/detail/index?id=${id}` : '/pages/category/index',
      imageUrl: getFirstImage(product.images) || ''
    };
  },

  // 分享到朋友圈（不可自定义 path，须用 query 带回商品 id）
  onShareTimeline() {
    const product = this.data.product || {};
    const id = product._id || this.data.productId || '';
    const userId = app.globalData.openid;

    if (userId && id) {
      this.recordShare(userId, 'product', id, 'timeline');
    }

    return {
      title: `${product.title || '精美藏品'} | 山海造物`,
      query: id ? `id=${encodeURIComponent(id)}` : '',
      imageUrl: getFirstImage(product.images) || ''
    };
  },

  // 触发分享（显示分享菜单）
  triggerShare() {
    wx.vibrateShort({ type: 'light' });
    // 小程序会自动显示分享菜单，这里可以添加一些提示
    wx.showToast({ 
      title: '点击右上角分享', 
      icon: 'none',
      duration: 2000
    });
  },

  // 记录分享行为
  async recordShare(userId, targetType, targetId, shareType) {
    try {
      wx.cloud.callFunction({
        name: 'trackUserBehavior',
        data: {
          userId,
          action: 'share',
          targetType,
          targetId,
          shareType, // 'wechat' | 'timeline' | 'image'
          timestamp: Date.now()
        }
      }).catch(err => {
        console.warn('记录分享失败:', err);
      });

      // ⚠️ 合规：不再发放「分享奖励积分」。
      // 微信《小程序平台运营规范》禁止以利益诱导用户分享（含转发与朋友圈），
      // 因此仅保留 trackUserBehavior 行为埋点，不做任何积分/权益发放。
    } catch (e) {
      console.warn('记录分享失败:', e);
    }
  },

  // 商品评价需绑定已签收订单；详情页仅展示，引导至订单
  goToComment() {
    this.modal({
      title: '写下感受',
      overline: 'WRITE A NOTE',
      content: '确认签收后，可在「我的订单」详情页评价这件藏品。',
      confirmText: '查看订单',
      cancelText: '知道了'
    }).then((res) => {
      if (res.confirm) {
        wx.navigateTo({
          url: '/subpackages/business/orders/index',
          fail: () => wx.showToast({ title: '请从「我的」进入订单', icon: 'none' })
        })
      }
    })
  }
}));
