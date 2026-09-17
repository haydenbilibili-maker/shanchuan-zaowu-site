// pages/manager/index.js
const imageUrl = require('../../../utils/imageUrl')
const db = wx.cloud.database();
const _ = db.command;
const { PRODUCTION_STATUS_LABELS } = require('../utils/customDefaults');
const { buildWorkOrderText, buildInquiryText } = require('../utils/customHelper');
const { buildStaffCopyText, getStatusLabel, formatQuoteAmount } = require('../utils/petMemorialHelper');
const { STATUS_LABELS: PET_STATUS_LABELS } = require('../utils/petMemorialDefaults');
const { buildCategoryDoc } = require('../utils/categoryDefaults');
const { loadCategoryPickerTree, buildCategoryManageTree, resolveCanonicalRootName, fetchProductCountsByCategoryId } = require('../../../utils/categoryTree');
const { parseTrackingFromScan, normalizeTrackingInput } = require('../utils/shipHelper');
const { guardManagerPage } = require('../../../utils/managerAuth');
// 需求 28：祈福墙的商品级开关。载入时用 isWishWallProduct 回填"当前实际是否挂墙"
// （把「标题含马上有」的过渡兜底也算进去），否则运营一打开就保存会把在墙上的藏品摘下来。
const { isWishWallProduct, normalizeProductKey } = require('../../../utils/wishWall');
// 工作通知声音（#29）：语料清单 + 播放引擎；只播「相比上次新增」的待办
const workNoticeCatalog = require('../../../utils/workNoticeCatalog');
const workNoticeVoice = require('../../../utils/workNoticeVoice');

/**
 * 工作台抬头问候语（中文，按小时）。
 *
 * 为什么改中文：原来是 `Good Morning/Afternoon/Evening` + 员工姓名，
 * 24rpx + 2rpx letter-spacing 的英文大写串很长（「GOOD MORNING，令狐冲大哥」），
 * 窄屏上会**折成两行**，把「哥」孤字挤到第二行。同样一句问候，中文宽度只有一半。
 *
 * 为什么抽成函数：这段判断原先在 `updateTime` 与 `setToday` 里**各写了一份**，
 * 改文案必须改两处、必然漂移。这里收敛成唯一出处（纯函数，便于断言）。
 *
 * 顺带修掉一个不准确：原来 <12 点一律 Good Morning，凌晨 1 点问候「早上好」很怪；
 * 现在 0–4 点说「夜深了」。文案要调只改这一处。
 *
 * 用词取舍（2026-09-17 二次调整）：
 *   - 「早安 / 午安」比「早上好 / 中午好」更口语、也更贴本仓「山海」的古雅调性；
 *   - 傍晚一档**刻意不用「晚安」**——20 点还在工作台上，说「晚安」像赶人下班，
 *     与「晚上好」相比也不准确；
 *   - 「夜深了」对 23 点后还在岗的店员/超管是实话，比硬编一个时段问候更得体。
 * 这句会拼成 `{{greeting}}，{{姓名}}`，所以每档都必须是能直接接逗号的短语。
 */
function greetByHour(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return '你好';
  if (h >= 5 && h < 9) return '早安';
  if (h >= 9 && h < 12) return '上午好';
  if (h >= 12 && h < 14) return '午安';
  if (h >= 14 && h < 18) return '下午好';
  if (h >= 18 && h < 23) return '晚上好';
  return '夜深了'; // 23:00–04:59
}

const { leaveWorkbench: leaveWorkspace, fallbackLeaveWorkbench } = require('../utils/workspaceBack');
const { resolveDepositDisplay, isDepositOrder } = require('../utils/depositOrderDisplay');
const {
  countLamp,
  fulfillmentLamp,
  receivedLamp,
  refundStockLamp,
  momLamp,
  stockReadyLamp,
  ledgerSyncLamp,
  LAMP
} = require('../utils/signalLamp');
const {
  parseDailyFinanceText,
  matchStoreIdFromHint,
} = require('../utils/financeDailyParse');
const {
  goStaffConsole,
  goStaffHome,
  goStorePoints,
  goStaffDirectory,
  goStoreStaffPermissions,
  goShareholderConfig,
  goInvoiceRequests,
  goGiftOps,
  goGiftManage,
  goApprovals,
  goHonoraryCurators,
  goMemberCrm,
  goMemberLevelAdjust,
  goWalletConfig,
  goWelcomeGift,
  goBirthdayGift,
  goDepositOps,
  goPurchaseOps,
  goShipmentOps,
  goInventoryOps,
  goRawInventoryOps,
  goStudioDashboard,
  goPropertyCost,
  goArtisanCommission,
  goBookingRules,
  goSupportConfig,
  goMyPayslip,
  goPayslipAdmin,
  guardManagerWorkspace,
  guardArtisanWorkspace,
  canSeeMenu,
  canAccessManagerTab,
  MENU_KEYS,
  HUB_MENU_SECTIONS,
  WORKSPACE_SUPER_ADMIN,
  WORKSPACE_STORE_MANAGER,
  WORKSPACE_SPECIMEN_ARTISAN
} = require('../utils/staffAuth');
const { openWorkspaceMemberScan } = require('../utils/memberScan');
const { cdnPath } = require('../../../config/cloudEnv');
const { buildAdminConfirm, calcRefundSplit, getPolicy, formatYuan } = require('../utils/refundPolicy');
const { batchTempFileURLs } = require('../../../utils/util');
const { LEVEL_BENEFITS } = require('../../../utils/profileConstants');
const { collectCurrentPerkItems, formatDiscount } = require('../../../utils/profileHelper');
const { skuKey, parseSkuKey, relatedIdsFromSkus, normalizeRelatedSkus } = require('../utils/relatedSku');
const storeLedger = require('../utils/storeLedger');
const {
  computeMallCommission,
  formatMallForUi,
  DEFAULT_MALL_THRESHOLD,
  DEFAULT_MALL_RATE
} = require('../utils/mallCommission');
const { goManagerModule } = require('./moduleRoutes');
const {
  CHANNEL_OPTIONS,
  CRAFT_TYPE_OPTIONS,
  CRAFT_PROCESS_OPTIONS,
  normalizeChannel,
  normalizeCraftType,
  normalizeCraftProcess,
  craftTypeLabel,
  craftProcessLabel,
  isTaxonomyEligibleContext
} = require('../../../config/productTaxonomy');
const { toChineseTaxonomy } = require('../utils/taxonomyZh');
const { sanitizeProductTags } = require('../utils/productTags');
const { PREFILL_KEY } = require('../utils/productConcept');
const { suggestSensitiveBlurOnForm } = require('../utils/sensitiveMorphology');
const {
  GIFT_SCENES,
  sanitizeGiftScenes,
  readGiftScenes
} = require('../utils/giftScenes');
const { SCHEME_PRESETS, buildBannerLinkForSave, validateSchemePath } = require('../../../utils/bannerNav');
const { requestStaffOrderSubscribe, requestStaffAllSubscribe } = require('../../../utils/staffOrderSubscribe');
const {
  getSkuSizeFields,
  normalizeSkuSizeForSave,
  resolveSizeFormMode,
  getSizeFormMeta,
  applySizeFormConstraints
} = require('../utils/skuSize');

/** Hub 经营信号展开态本地记忆 */
const OPS_SIGNAL_EXPAND_KEY = 'manager_ops_signal_expanded';
const NEW_ORDER_ALERT_SHOWN_KEY = 'manager_new_order_alert_shown_ids';
const STAFF_ORDER_MSG_TYPE = 'staff_order_paid';
const WISHLIST_MSG_TYPE = 'wishlist_restock_request';

/**
 * 物流查询插件仅声明在 business 分包；manager 同 provider 不可再声明。
 * 店长/超管「查询物流」走 logistics-track（凭 token，不经 C 端订单详情所有权校验）。
 */
/** 店长查件降级文案：按真实原因区分，避免一律归咎 WX_APP_SECRET */
function buildManagerTrackFallbackContent({ token, carrier, ensureResult, navFailed }) {
  const brand = String(carrier || '快递').trim() || '快递';
  const skip = String(
    (ensureResult && (ensureResult.wxExpressSkipReason || ensureResult.skipReason)) || ''
  );
  const err = String(
    (ensureResult &&
      (ensureResult.wxExpressError || ensureResult.msg || ensureResult.error || '')) ||
      ''
  );
  const combined = `${skip} ${err}`;

  if (navFailed) {
    return `无法打开物流轨迹页。单号已复制，可到「${brand}」服务粘贴查询。`;
  }
  if (/access_token|WX_APP_SECRET|AppSecret/i.test(combined)) {
    return `轨迹同步凭证未就绪（access_token）。请确认云函数 managerShipOrder 已配置 WX_APP_SECRET 并重新部署后重试；也可到「${brand}」服务粘贴单号查询。`;
  }
  if (/未开通|48001|查询组件|物流消息|plugin|requirePlugin|openWaybillTracking/i.test(combined)) {
    return `微信物流查询组件暂不可用。请确认小程序已添加物流查询插件并开通查询组件；也可到「${brand}」服务粘贴单号查询。`;
  }
  if (skip === 'placeholder_waybill' || /占位|测试单号/.test(err)) {
    return '当前运单号疑似占位/测试单号，无法打开官方轨迹。请核对真实运单号。';
  }
  if (skip === 'missing_trans_id' || /wxTransactionId|交易单号/.test(err)) {
    return '该订单缺少微信支付交易号，暂无法开通官方物流轨迹。可先到快递服务粘贴单号查询。';
  }
  if (ensureResult && ensureResult.success === false && err) {
    return `${err}。单号已复制，可到「${brand}」服务粘贴查询。`;
  }
  if (!token) {
    return `暂未取得官方轨迹凭证。单号已复制，请到「${brand}」服务粘贴查询。`;
  }
  return `微信轨迹暂不可用。单号已复制，请到「${brand}」服务粘贴查询。`;
}

function openOrderDetailTrack(orderId, opts = {}) {
  const id = String(orderId || '').trim();
  const token = String((opts && opts.token) || '').trim();
  const trackingNumber = String((opts && opts.trackingNumber) || '').trim();
  const carrier = String((opts && opts.carrier) || '').trim();
  if (!id && !token) return Promise.reject(new Error('missing orderId'));
  const q = [];
  if (token) q.push(`token=${encodeURIComponent(token)}`);
  if (id) q.push(`orderId=${encodeURIComponent(id)}`);
  if (trackingNumber) q.push(`no=${encodeURIComponent(trackingNumber)}`);
  if (carrier) q.push(`carrier=${encodeURIComponent(carrier)}`);
  const url = `/subpackages/business/logistics-track/index?${q.join('&')}`;
  return new Promise((resolve, reject) => {
    wx.navigateTo({
      url,
      success: () => resolve(true),
      fail: (err) => reject(err || new Error('navigateTo logistics-track failed'))
    });
  });
}

function matchSchemePresetIndex(path) {
  const p = String(path || '').trim().split('?')[0];
  const withSlash = p && p.charAt(0) !== '/' ? `/${p}` : p;
  const idx = SCHEME_PRESETS.findIndex((x) => x.path && x.path === withSlash);
  return idx >= 0 ? idx : SCHEME_PRESETS.length - 1; // custom
}

/** 订单管理：SKU 预览条数（超出可展开） */
const ORDER_SKU_PREVIEW = 3;
const ORDER_THUMB_FALLBACK = '/assets/icons/box.png';

function formatManagerAddress(addr) {
  if (!addr) return '';
  const region = Array.isArray(addr.region)
    ? addr.region.filter(Boolean).join(' ')
    : String(addr.region || '').trim();
  return [region, addr.detail].filter(Boolean).join(' ');
}

/** 发货打单常用：姓名 手机\\n省市区+详细地址 */
function buildManagerAddressCopyText(addr) {
  if (!addr) return '';
  const namePhone = [addr.name, addr.phone].map((v) => String(v || '').trim()).filter(Boolean).join(' ');
  const line = formatManagerAddress(addr);
  return [namePhone, line].filter(Boolean).join('\n');
}

/** 打单/粘贴用面单文案：地址 + 品名件数 + 运单 */
function buildManagerShipLabelText(order) {
  if (!order) return '';
  const lines = [];
  const addr = buildManagerAddressCopyText(order.address) || order.addressCopyText || '';
  if (addr) lines.push(addr);
  const skus = Array.isArray(order.skuList)
    ? order.skuList
    : normalizeManagerSkuList(order.products);
  if (skus.length) {
    lines.push('---');
    skus.forEach((p) => {
      const spec = p.skuLabel ? `（${p.skuLabel}）` : '';
      lines.push(`${p.title || '藏品'}${spec} ×${p.count || 1}`);
    });
  }
  const carrier = order.carrier || (order.logistics && order.logistics.carrier) || '';
  const tracking =
    order.trackingNumber ||
    (order.logistics && order.logistics.trackingNumber) ||
    '';
  if (carrier || tracking) {
    lines.push('---');
    lines.push(`运单：${[carrier, tracking].filter(Boolean).join(' ')}`);
  }
  if (order.orderNo) lines.push(`订单：${order.orderNo}`);
  return lines.filter(Boolean).join('\n');
}

const OM_TAB_BY_SUB = ['pending', 'shipped', 'completed', 'refund', 'pendingPay'];
/** 店长订单备注长度上限（与云函数 normalizeOrderNote 一致） */
const ORDER_NOTE_MAX = 100;
const OM_TAB_META = {
  pending: {
    dataKey: 'orders',
    viewKey: 'ordersView',
    loadingKey: 'ordersLoading',
    moreKey: 'ordersHasMore'
  },
  shipped: {
    dataKey: 'shippedOrders',
    viewKey: 'shippedOrdersView',
    loadingKey: 'shippedOrdersLoading',
    moreKey: 'shippedOrdersHasMore'
  },
  completed: {
    dataKey: 'completedOrders',
    viewKey: 'completedOrdersView',
    loadingKey: 'completedOrdersLoading',
    moreKey: 'completedOrdersHasMore'
  },
  refund: {
    dataKey: 'refunds',
    viewKey: 'refundsView',
    loadingKey: 'refundsLoading',
    moreKey: 'refundsHasMore'
  },
  /** 待支付 / 履约中：支付回调异常时的补履约入口（仅超管可操作） */
  pendingPay: {
    dataKey: 'pendingPayOrders',
    viewKey: 'pendingPayOrdersView',
    loadingKey: 'pendingPayOrdersLoading',
    moreKey: 'pendingPayOrdersHasMore'
  }
};

function mapOmOrderRaw(i, tab) {
  const gift = i.source === 'gift' || !!i.giftMeta;
  const deposit = isDepositOrder(i);
  const depositDisp = resolveDepositDisplay(i);
  const storePickup = !!(
    i.storePickup ||
    i.fulfillmentType === 'store_pickup' ||
    (i.giftMeta && i.giftMeta.deliveryType === 'store_pickup')
  );
  let mapped;
  if (tab === 'pending') {
    const deliveryType = (i.giftMeta && i.giftMeta.deliveryType) || '';
    const awaiting =
      gift &&
      deliveryType === 'invite_address' &&
      i.giftMeta &&
      i.giftMeta.addressStatus !== 'submitted' &&
      (i.status === 'paid_awaiting_address' || i.status === 'paid');
    const deliveryLabels = {
      invite_address: '先付后填址',
      ship_to_receiver: '快递给 TA',
      ship_to_self: '寄给我',
      store_pickup: '门店自提'
    };
    let statusLabel = awaiting ? '礼赠·待填址' : gift ? '礼赠·待发货' : '已支付';
    if (gift && deliveryType === 'store_pickup' && !awaiting) statusLabel = '礼赠·待自提';
    if (!gift && storePickup) statusLabel = '待自取';
    if (i.status === 'ready_pickup') statusLabel = gift ? '礼赠·待自提' : '待自取';
    if (deposit && depositDisp && depositDisp.label) {
      statusLabel = depositDisp.label;
    } else if (depositDisp && depositDisp.tag && i.depositIntentId) {
      statusLabel = statusLabel === '已支付' ? '待发货·定金尾款' : statusLabel;
    }
    const canCompletePickup = !gift && storePickup && !deposit &&
      (i.status === 'ready_pickup' || i.status === 'paid');
    mapped = enrichManagerOrderCard(i, {
      isGiftOrder: gift,
      isStorePickup: storePickup,
      isDepositOrder: deposit,
      isDepositBalanceOrder: !!(i.depositIntentId && !deposit),
      depositTag: depositDisp ? depositDisp.tag : '',
      depositCredit: i.depositCredit != null ? i.depositCredit : 0,
      giftAwaitingAddress: awaiting,
      giftDeliveryLabel: deliveryLabels[deliveryType] || (storePickup && !gift ? '门店自取' : ''),
      statusLabel,
      canShip: !deposit && !awaiting && !storePickup && i.status === 'paid',
      canCompletePickup
    });
  } else if (tab === 'shipped') {
    mapped = enrichManagerOrderCard(i, {
      isGiftOrder: gift,
      statusLabel: gift ? '礼赠·运输中' : '运输中',
      canShip: false
    });
  } else if (tab === 'completed') {
    mapped = enrichManagerOrderCard(i, {
      isGiftOrder: gift,
      statusLabel: gift ? '礼赠·已完成' : '已完成',
      canShip: false
    });
  } else if (tab === 'pendingPay') {
    // 待支付 / 履约中：支付回调异常时由超管人工补履约
    mapped = enrichManagerOrderCard(i, {
      isGiftOrder: gift,
      statusLabel: i.status === 'fulfilling' ? '履约中（待确认）' : '待支付 / 待确认',
      canShip: false,
      canFulfill: true
    });
  } else {
    const policy = getPolicy(i);
    const split = calcRefundSplit(i.totalPrice, policy.deductRate);
    let refundLabel = '申请退款';
    if (i.status === 'aftersales') {
      refundLabel = i.returnMode === 'store_return' && i.pickupReturnStatus !== 'returned'
        ? '售后中·待收回藏品'
        : '售后中';
    }
    else if (i.status === 'expired_refunding') refundLabel = gift ? '礼赠·填址过期退款中' : '过期退款中';
    else if (i.status === 'refunding') refundLabel = '退款中';
    else if (i.status === 'refunded' && i.walletRefundPendingReconcile) refundLabel = '已退·钱包待核对';
    const unboxVideoFileId = String(i.unboxVideoFileId || '').trim();
    const evidenceImageFileIds = Array.isArray(i.evidenceImageFileIds)
      ? i.evidenceImageFileIds.filter(Boolean).slice(0, 9)
      : [];
    const before = String(i.statusBeforeRefund || '');
    const expectUnbox =
      i.status === 'aftersales' || before === 'shipped' || before === 'received';
    const missingUnboxVideo = expectUnbox && !unboxVideoFileId;
    mapped = enrichManagerOrderCard(i, {
      isGiftOrder: gift,
      statusLabel: refundLabel,
      walletRefundPendingReconcile: !!i.walletRefundPendingReconcile,
      refundPolicyLabel: policy.shortLabel,
      refundAmountHint:
        i.walletRefundPendingReconcile
          ? '微信侧已退，钱包入账待核对（勿重复退微信）'
          : policy.deductRate > 0
          ? `退回 ¥${formatYuan(split.refund)}（扣 30% 损耗 ¥${formatYuan(split.deduct)}）`
          : `退回 ¥${formatYuan(split.refund)}`,
      canShip: false,
      unboxVideoFileId,
      evidenceImageFileIds,
      unboxVideoUrl: '',
      evidenceImageUrls: [],
      missingUnboxVideo,
      hasEvidenceMedia: !!(unboxVideoFileId || evidenceImageFileIds.length),
      /** 门店自取逆向：需先确认收回顾客送回门店的藏品，才可退款 */
      isStoreReturn: i.returnMode === 'store_return',
      storeReturnPending: i.returnMode === 'store_return' && i.pickupReturnStatus !== 'returned',
      pickupReturnStatus: i.pickupReturnStatus || '',
      pickupReturnStoreName: i.pickupReturnStoreName || ''
    });
  }
  mapped.shipLabelText = buildManagerShipLabelText(mapped);
  return mapped;
}

function normalizeManagerSkuList(products) {
  return (Array.isArray(products) ? products : []).map((p, idx) => {
    const count = Math.max(1, parseInt(p && p.count, 10) || 1);
    const rawPrice = p && (p.price != null ? p.price : p.unitPrice);
    const unit = typeof rawPrice === 'number'
      ? rawPrice
      : parseFloat(String(rawPrice == null ? '' : rawPrice).replace(/,/g, ''));
    const hasPrice = rawPrice != null && rawPrice !== '' && Number.isFinite(unit) && unit >= 0;
    const title = (p && (p.title || p.name)) || '藏品';
    const skuLabel = String(
      (p && (p.skuLabel || p.specLabel || p.spec || p.skuName)) || ''
    ).trim();
    const image =
      (p && (p.image || p.cover || (Array.isArray(p.images) && p.images[0]))) ||
      ORDER_THUMB_FALLBACK;
    const lineTotal = hasPrice ? Math.round(unit * count * 100) / 100 : null;
    return {
      key: String((p && (p.skuId || p.id || p.productId)) || `sku-${idx}`),
      title,
      skuLabel,
      image,
      count,
      priceText: hasPrice ? `¥${formatYuan(unit)}` : '',
      lineText: lineTotal != null ? `¥${formatYuan(lineTotal)}` : '',
      latin: (p && (p.latin || p.latinName)) || ''
    };
  });
}

function enrichManagerOrderCard(order, extra) {
  const skuList = normalizeManagerSkuList(order && order.products);
  const skuOverflow = skuList.length > ORDER_SKU_PREVIEW;
  const skuHiddenCount = Math.max(0, skuList.length - ORDER_SKU_PREVIEW);
  const totalCount =
    (order && order.count) ||
    skuList.reduce((sum, row) => sum + (row.count || 0), 0) ||
    skuList.length;
  const rawAmount =
    (order && (order.totalPrice != null ? order.totalPrice : order.payAmount != null ? order.payAmount : order.amount)) ||
    0;
  const amountNum =
    typeof rawAmount === 'number'
      ? rawAmount
      : parseFloat(String(rawAmount).replace(/,/g, ''));
  const amount = Number.isFinite(amountNum) ? amountNum : 0;
  const logistics = (order && order.logistics) || {};
  const trackingNumber = String(logistics.trackingNumber || '').trim();
  const carrier = String(logistics.carrier || '').trim();
  const hasTracking =
    !!trackingNumber && trackingNumber.length >= 6 && trackingNumber !== '---';
  const waybillToken = String(
    logistics.waybillToken || logistics.followWaybillToken || ''
  ).trim();
  const shipAt = order && (order.shipTime || logistics.shipTime || null);
  const refundNote = String(
    (order && (order.refundRequestNote || order.refundRejectReason || order.remark)) || ''
  ).trim();
  // 店长订单备注（随发货私信发出）：managerNote 为输入框当前值，savedNote 为云端已保存值
  const managerNote = String((order && order.managerNote) || '').trim().slice(0, ORDER_NOTE_MAX);
  const mapped = Object.assign({}, order, {
    managerNote,
    savedNote: managerNote,
    noteSaving: false,
    formatTime: order && order.createTime ? new Date(order.createTime).toLocaleString() : '',
    shipTimeText: shipAt ? new Date(shipAt).toLocaleString() : '',
    addressLine: formatManagerAddress(order && order.address),
    addressCopyText: buildManagerAddressCopyText(order && order.address),
    skuList,
    skuOverflow,
    skuHiddenCount,
    skuExpanded: false,
    totalCount,
    amountText: `¥${formatYuan(amount)}`,
    carrier,
    trackingNumber: hasTracking ? trackingNumber : '',
    hasTracking,
    waybillToken,
    // 插件在 business 分包；有运单即可跳转订单详情打开官方轨迹
    canOpenWxTrack: !!(hasTracking && waybillToken),
    trackingText: hasTracking
      ? `${carrier ? `${carrier} · ` : ''}${trackingNumber}`
      : '',
    refundNote
  }, extra || {});
  const buyerRaw = (order && order.buyer) || null
  const buyerOpenid = String(
    (buyerRaw && buyerRaw.openid) || (order && (order._openid || order.openid)) || ''
  ).trim()
  if (buyerRaw && buyerRaw.openid) {
    mapped.buyer = buyerRaw
  } else if (buyerOpenid) {
    mapped.buyer = {
      openid: buyerOpenid,
      nickName: '会员',
      avatarUrl: '',
      phone: '',
      phoneMasked: '',
      hasPhone: false,
      hasAvatar: false,
      avatarInitial: '藏'
    }
  } else {
    mapped.buyer = null
  }
  return mapped
}

function filterManagerOrders(list, query) {
  const q = String(query || '').trim().toLowerCase();
  const rows = Array.isArray(list) ? list : [];
  if (!q) return rows.slice();
  return rows.filter((o) => {
    if (!o) return false;
    const hay = [
      o.orderNo,
      o.statusLabel,
      o.trackingNumber,
      o.carrier,
      o.addressLine,
      o.address && o.address.name,
      o.address && o.address.phone,
      o.refundNote,
      o.refundAmountHint,
      o.buyer && o.buyer.nickName,
      o.buyer && o.buyer.phone,
      o.buyer && o.buyer.phoneMasked
    ]
      .map((v) => String(v || '').toLowerCase())
      .join(' ');
    return hay.indexOf(q) !== -1;
  });
}

function resolveOmListScope(scopeRaw) {
  if (scopeRaw === 'refunds') return 'refunds';
  if (scopeRaw === 'shippedOrders') return 'shippedOrders';
  if (scopeRaw === 'completedOrders') return 'completedOrders';
  if (scopeRaw === 'pendingPayOrders') return 'pendingPayOrders';
  return 'orders';
}

function isMerchandiseProduct(p) {
  if (!p) return false;
  if (p.categoryType === 'merch') return true;
  const text = `${p.rootCategoryName || ''}${p.category || ''}`;
  return /衍生|文创|书籍|画册|工具|耗材|周边|礼品|包装|礼盒|卡片|陈饰|联名/.test(text);
}

function productCategoryBlob(p) {
  return `${(p && p.rootCategoryName) || ''}${(p && p.category) || ''}`;
}

function isTaxonomyEligibleProduct(p) {
  return isTaxonomyEligibleContext(productCategoryBlob(p));
}

function syncProductLatinRequired(page) {
  page.setData({ productLatinRequired: !isMerchandiseProduct(page.data.tempProduct) });
}

function applySizeFormToRow(row, craftType, title) {
  const skuMode = resolveSizeFormMode(
    craftType,
    `${title || ''} ${(row && row.specLabel) || ''} ${(row && row.sizeText) || ''}`
  );
  const constrained = applySizeFormConstraints(
    row.sizeL,
    row.sizeW,
    row.sizeH,
    skuMode
  );
  return {
    ...row,
    sizeFormMode: skuMode,
    sizeL: constrained.sizeL,
    sizeW: constrained.sizeW,
    sizeH: constrained.sizeH
  };
}

function buildProductSizeFormPatch(tempProduct) {
  const p = tempProduct || {};
  const craftType = p.craftType || '';
  const title = p.title || '';
  const mode = resolveSizeFormMode(craftType, `${title} ${p.sizeText || ''}`);
  const meta = getSizeFormMeta(mode);
  const constrained = applySizeFormConstraints(p.sizeL, p.sizeW, p.sizeH, mode);
  const patch = {
    sizeFormMode: mode,
    sizeFormHint: meta.hint,
    sizeFormLabel: meta.label,
    'tempProduct.sizeL': constrained.sizeL,
    'tempProduct.sizeW': constrained.sizeW,
    'tempProduct.sizeH': constrained.sizeH
  };
  if (p.hasSku && Array.isArray(p.skus) && p.skus.length) {
    patch['tempProduct.skus'] = p.skus.map((s) => applySizeFormToRow(s, craftType, title));
  }
  return patch;
}

function syncProductSizeForm(page) {
  page.setData(buildProductSizeFormPatch(page.data.tempProduct));
}

function syncProductTaxonomyFlags(page) {
  const p = page.data.tempProduct || {};
  const taxonomyOk = isTaxonomyEligibleProduct(p);
  const channel = taxonomyOk ? normalizeChannel(p.channel) : '';
  const craftType = taxonomyOk ? normalizeCraftType(p.craftType) : '';
  const craftProcess = taxonomyOk ? normalizeCraftProcess(p.craftProcess) : '';
  const channelLabels = ['未标注'].concat(CHANNEL_OPTIONS.map((o) => o.label));
  const channelValues = [''].concat(CHANNEL_OPTIONS.map((o) => o.value));
  const craftLabels = ['未标注'].concat(CRAFT_TYPE_OPTIONS.map((o) => o.label));
  const craftValues = [''].concat(CRAFT_TYPE_OPTIONS.map((o) => o.value));
  const craftProcessLabels = ['未标注'].concat(CRAFT_PROCESS_OPTIONS.map((o) => o.label));
  const craftProcessValues = [''].concat(CRAFT_PROCESS_OPTIONS.map((o) => o.value));
  const channelIndex = Math.max(0, channelValues.indexOf(channel));
  const craftTypeIndex = Math.max(0, craftValues.indexOf(craftType));
  const craftProcessIndex = Math.max(0, craftProcessValues.indexOf(craftProcess));
  page.setData({
    productChannelEligible: taxonomyOk,
    productCraftEligible: taxonomyOk,
    channelLabels,
    channelValues,
    craftLabels,
    craftValues,
    craftProcessLabels,
    craftProcessValues,
    channelIndex,
    craftTypeIndex,
    craftProcessIndex,
    'tempProduct.channel': channel,
    'tempProduct.craftType': craftType,
    'tempProduct.craftProcess': craftProcess,
    ...buildProductSizeFormPatch({ ...p, channel, craftType })
  });
}

function toLocalDateTimeInput(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 与 Admin 保存同源：剥离 script / 内联事件，避免脏 HTML 进详情 */
function sanitizeDetailHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
}

function isRemoteMediaUrl(url) {
  const s = String(url || '');
  return s.startsWith('cloud') || s.startsWith('http');
}

async function uploadProductMedia(filePath, prefix) {
  const up = await wx.cloud.uploadFile({
    cloudPath: `products/${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`,
    filePath
  });
  return up.fileID;
}

function isSeckillExpiredProduct(p) {
  if (!p || !p.seckill || !p.seckill.enabled) return false;
  const end = p.seckill.endTime ? Number(p.seckill.endTime) : null;
  return Number.isFinite(end) && end > 0 && end < Date.now();
}

/** 藏品卡封面水印：上架审核态 → 文案/样式类 */
function resolveProductShelfWatermark(p) {
  if (!p) return { status: '', text: '', className: '' };
  const raw = String(p.shelfApprovalStatus || '').trim();
  let status = '';
  if (p.isOffShelf === false) status = 'approved';
  else if (raw === 'pending') status = 'pending';
  else if (raw === 'rejected') status = 'rejected';

  if (status === 'pending') return { status, text: '审核中', className: 'pending' };
  if (status === 'rejected') return { status, text: '已驳回', className: 'rejected' };
  if (status === 'approved') return { status, text: '已上架', className: 'approved' };
  return { status: '', text: '', className: '' };
}

function normalizeSkuForEdit(s, i) {
  const images = Array.isArray(s.images) && s.images.length
    ? s.images.filter(Boolean)
    : (s.image ? [s.image] : []);
  const sizeFields = getSkuSizeFields(s || {});
  return {
    id: s.id || `sku_${Date.now()}_${i}`,
    specLabel: s.specLabel || '',
    sku: s.sku || s.skuCode || '',
    price: s.price != null ? s.price : '',
    stock: s.stock != null ? s.stock : 1,
    image: images[0] || '',
    images,
    specs: s.specs || null,
    sizeL: sizeFields.sizeL,
    sizeW: sizeFields.sizeW,
    sizeH: sizeFields.sizeH,
    sizeText: sizeFields.sizeText,
    size: sizeFields.size
  };
}

function emptySkuRow(overrides) {
  return {
    id: `sku_${Date.now()}`,
    specLabel: '',
    sku: '',
    price: '',
    stock: 1,
    images: [],
    image: '',
    sizeL: '',
    sizeW: '',
    sizeH: '',
    sizeText: '',
    size: '',
    ...(overrides || {})
  };
}

const DASH_TREND_BAR_COUNT = 7;

function dashWindowWidth() {
  try {
    if (wx.getWindowInfo) return wx.getWindowInfo().windowWidth || 375;
    return wx.getSystemInfoSync().windowWidth || 375;
  } catch (e) {
    return 375;
  }
}

function pxToRpx(px, windowWidth) {
  const w = windowWidth || dashWindowWidth();
  return (px / w) * 750;
}

function clampDash(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function pickTrendLabelIndices(days, layout) {
  const peakIdx = days.reduce(
    (bi, d, i) => ((Number(d.total) || 0) > (Number(days[bi].total) || 0) ? i : bi),
    0
  );
  const peak = Number(days[peakIdx] && days[peakIdx].total) || 0;
  const indices = new Set();
  if (peak <= 0) return indices;
  indices.add(peakIdx);
  if (layout.narrow) return indices;
  if (layout.wide) {
    days.forEach((d, i) => {
      if ((Number(d.total) || 0) >= peak * 0.45) indices.add(i);
    });
    const sorted = [...indices].sort((a, b) => a - b);
    for (let j = 1; j < sorted.length; j++) {
      const a = sorted[j - 1];
      const b = sorted[j];
      if (b - a === 1) {
        const drop = (Number(days[a].total) || 0) >= (Number(days[b].total) || 0) ? b : a;
        indices.delete(drop);
      }
    }
    return indices;
  }
  for (let i = 0; i < days.length; i += 2) {
    if ((Number(days[i].total) || 0) > 0) indices.add(i);
  }
  indices.add(peakIdx);
  return indices;
}

function buildTrendChartEntries(days, shortMoneyFn, layout) {
  const peak = Math.max(0, ...days.map((d) => Number(d.total) || 0));
  const scale = peak > 0 ? peak : 1;
  const labelIdx = pickTrendLabelIndices(days, layout || {});
  return days.map((d, i) => {
    const online = Math.max(0, Number(d.online) || 0);
    const total = Math.max(0, Number(d.total) || 0);
    const offline =
      d.offline != null ? Math.max(0, Number(d.offline) || 0) : Math.max(0, total - online);
    let onlineH = total > 0 ? Math.max(4, Math.round((online / scale) * 100)) : 0;
    let offlineH =
      total > 0
        ? Math.max(offline > 0 ? 4 : 0, Math.round((offline / scale) * 100))
        : peak > 0
          ? 0
          : 2;
    if (onlineH + offlineH > 100) {
      const t = onlineH + offlineH;
      onlineH = Math.round((onlineH / t) * 100);
      offlineH = 100 - onlineH;
    }
    const compactVal = !!(layout && layout.narrow) || total >= 1000;
    return {
      dateKey: d.dateKey,
      day: d.day,
      styleOnline: `height: ${onlineH}%`,
      styleOffline: `height: ${offlineH}%`,
      showVal: labelIdx.has(i) && total > 0,
      valShort: shortMoneyFn(total, compactVal),
    };
  });
}

/** 数据报表：长周期压缩为周桶，避免 30/90 日柱图过密 */
function downsampleReportSeries(series, maxPoints = 14) {
  const list = Array.isArray(series) ? series.slice() : [];
  if (list.length <= maxPoints) return list;
  const bucketSize = Math.ceil(list.length / maxPoints);
  const out = [];
  for (let i = 0; i < list.length; i += bucketSize) {
    const slice = list.slice(i, i + bucketSize);
    const first = slice[0] || {};
    const last = slice[slice.length - 1] || first;
    const sumKeys = [
      'count',
      'dau',
      'orders',
      'paid',
      'gmvPaid',
      'netOnline',
      'offlineLedger',
      'refundAmount',
      'giftGmv',
      'depositGmv',
      'grandDay'
    ];
    const merged = { ...first, dateKey: last.dateKey || first.dateKey };
    sumKeys.forEach((k) => {
      merged[k] = slice.reduce((s, row) => s + (Number(row[k]) || 0), 0);
    });
    const startLbl = (first.label || (first.dateKey || '').slice(5) || '').slice(0, 5);
    const endLbl = (last.label || (last.dateKey || '').slice(5) || '').slice(0, 5);
    merged.label = startLbl && endLbl && startLbl !== endLbl ? `${startLbl}~${endLbl}` : endLbl || startLbl;
    out.push(merged);
  }
  return out;
}

/** 数据报表：单序列柱状图（复用 trend 布局，避免小屏溢出） */
function buildCountChartEntries(series, layout, valueKey = 'count') {
  const days = (series || []).map((d) => {
    const v = Math.max(0, Number(d[valueKey]) || 0);
    const label = d.label || (d.dateKey || '').slice(5);
    return {
      dateKey: d.dateKey || label,
      day: label,
      online: v,
      offline: 0,
      total: v,
    };
  });
  const fmt = (n) => {
    const v = Number(n) || 0;
    if (v >= 10000) return `${Math.round(v / 1000)}k`;
    if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(Math.round(v));
  };
  return buildTrendChartEntries(days, fmt, layout);
}

function buildReportShareMix(items, tones) {
  const list = (items || []).filter((x) => Number(x.value) > 0);
  const total = list.reduce((s, x) => s + (Number(x.value) || 0), 0);
  return list.map((x, i) => {
    const value = Number(x.value) || 0;
    const pct = total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
    return {
      key: x.key || x.label || String(i),
      label: x.label || x.key || '',
      value,
      valueFmt: x.valueFmt || (Math.round(value * 100) / 100).toFixed(2),
      count: x.count || 0,
      pct,
      tone: (tones && tones[i % tones.length]) || 'brass',
      barStyle: `width:${Math.max(pct > 0 ? 4 : 0, Math.min(100, pct))}%`
    };
  });
}

/**
 * 经营概况图表/网格断点（逻辑像素 windowWidth）
 * - stackCols: < 300 才单列；常见手机/全面屏/开发者工具宽度保持 2-1-2
 * - narrow: < 340 仅紧凑字号，不改网格
 * - ratioStacked: 半卡内容过窄才环图上下叠；阈值低于旧版 152，避免半卡误叠
 * - 柱宽按容器列宽比例，避免固定 max 导致大屏空、小屏挤
 */
function computeDashChartLayout(trendWidthPx, ratioWidthPx, windowWidth) {
  const win = windowWidth || dashWindowWidth();
  const rpx = win / 750;
  const pagePad = 60 * rpx;
  const cardPad = 60 * rpx;
  const gridGap = 24 * rpx;
  const contentW = Math.max(160, win - pagePad);
  const stackCols = win < 300;
  const halfInner = stackCols
    ? Math.max(80, contentW - cardPad)
    : Math.max(80, (contentW - gridGap) / 2 - cardPad);

  const trendMeasured = trendWidthPx > 8;
  const ratioMeasured = ratioWidthPx > 8;
  const trendW = trendMeasured ? trendWidthPx : Math.max(140, contentW - cardPad);
  const ratioW = ratioMeasured ? ratioWidthPx : halfInner;

  const narrow = stackCols || win < 340;
  const wide = !stackCols && win >= 414 && trendW >= 340;
  const medium = !narrow && !wide;
  // 双列半卡常见 ~120–160；旧阈值 152 会在正常双列下误触发环图堆叠
  const ratioStacked = stackCols ? ratioW < 168 : ratioW < 112;

  const trendScale = clampDash(win / 375, 0.9, 1.2);
  const trendH = clampDash(Math.round((narrow ? 156 : 180) * trendScale), 132, 228);
  const trendPadTop = narrow ? 6 : 10;
  const colW = trendW / DASH_TREND_BAR_COUNT;
  const barTrackPx = clampDash(
    Math.round(colW * (narrow ? 0.42 : 0.5)),
    narrow ? 9 : 12,
    wide ? 44 : 36
  );
  const valPx = narrow ? 9 : wide ? 11 : 10;
  const lblPx = narrow ? 9 : 10;
  const donutPx = ratioStacked
    ? clampDash(Math.round(ratioW * 0.34), 48, 88)
    : clampDash(Math.round(ratioW * 0.4), 52, 76);
  const donutRpx = Math.round(pxToRpx(donutPx, win));
  return {
    measured: trendMeasured || ratioMeasured,
    stackCols,
    narrow,
    medium,
    wide,
    ratioStacked,
    trendBarsStyle: `height: ${trendH}px; padding-top: ${trendPadTop}px;`,
    barTrackStyle: `width: ${barTrackPx}px;`,
    valFontStyle: `font-size: ${valPx}px;`,
    lblFontStyle: `font-size: ${lblPx}px;`,
    donutSizeRpx: donutRpx,
    ratioBoxStyle: `--donut-size: ${donutRpx}rpx;`,
  };
}

function parseMemberPassScan(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (text[0] === '{') {
    try {
      const obj = JSON.parse(text);
      if (obj && obj.token && (obj.v === 1 || obj.memberNo)) {
        return { token: String(obj.token), memberNo: obj.memberNo || '' };
      }
    } catch (e) {
      return null;
    }
  }
  if (/REDEEM:/i.test(text)) return null;
  const uri = text.match(/(?:shanchuan|shanhai):\/\/member\?(?:[^#]*&)?token=([A-Za-z0-9_-]+)/i);
  if (uri) return { token: uri[1] };
  return null;
}

function formatCloudFnError(e, fallback) {
  if (e && typeof e === 'object' && !e.errMsg && (e.msg || e.message || e.code)) {
    const code = String(e.code || '')
    if (code === 'FORBIDDEN') return e.msg || '无操作权限'
    if (code === 'ADMIN_UNCONFIGURED') return e.msg || '管理员尚未配置'
    if (code === 'NOT_LOGGED_IN') return '请先登录'
    if (e.msg) return String(e.msg).slice(0, 64)
  }
  let msg = (e && (e.errMsg || e.message || e.msg)) || ''
  if (!msg && e && typeof e === 'object' && e.errCode) {
    msg = `errCode: ${e.errCode}`
  }
  if (/501000|FUNCTION_NOT_FOUND|FunctionName parameter could not be found|FUNCTION_NOT_EXIST/i.test(msg)) {
    return '云函数未部署：请在开发者工具上传并部署对应云函数'
  }
  if (/502003|database permission|permission den/i.test(msg)) {
    return '无数据库写权限：请确认已部署 manageStoreContent / manageProducts 等云函数'
  }
  if (/502005|collection\.get:fail/i.test(msg)) {
    return fallback || '账本服务暂不可用，请稍后重试'
  }
  const fnResult = e && e.result
  if (fnResult && fnResult.success === false && fnResult.msg) {
    return String(fnResult.msg).slice(0, 64)
  }
  if (/504003|timeout|TIMEOUT/i.test(msg)) {
    return '请求超时，请稍后重试'
  }
  return msg.slice(0, 48) || fallback || '操作失败'
}

/**
 * 运营内容写库统一走 manageStoreContent（staffGuard）。
 * 禁止客户端直写 banners/categories/rewards 等敏感集合。
 */
async function callStoreContent(payload) {
  const res = await wx.cloud.callFunction({
    name: 'manageStoreContent',
    data: payload || {}
  })
  const result = (res && res.result) || {}
  if (!result.success) {
    const err = new Error(result.msg || '操作失败')
    err.code = result.code || ''
    err.msg = result.msg || ''
    err.result = result
    throw err
  }
  return result
}

/** 优先用 data-id 从本地列表取文档，避免 data-item 丢 _id 导致 update 空 doc */
function resolveListItem(list, e) {
  const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
  const id = ds.id || (ds.item && ds.item._id) || '';
  if (id && Array.isArray(list)) {
    const found = list.find((row) => row && row._id === id);
    if (found) return found;
  }
  return ds.item || null;
}

/** 通知社区页「内容已变，需要重新拉取」（跨分包，直接挂 app.globalData） */
function markCommunityContentStale() {
  try {
    const app = getApp()
    if (app && app.globalData) app.globalData.communityNeedsRefresh = true
  } catch (e) { /* ignore */ }
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

function dispatchUserMessage(eventType, openid, relatedId, vars = {}) {
  if (!openid) return Promise.resolve();
  return wx.cloud.callFunction({
    name: 'dispatchMessage',
    data: { action: 'dispatch', eventType, openid, relatedId, vars }
  }).catch((err) => console.warn('dispatchMessage', eventType, err));
}

const managerPageConfig = {
  data: {
    navTop: 20,
    navBarHeight: 44,
    navSpacerHeight: 64,
    curTab: 0, 
    pageTitle: '',
    timer: null,
    loading: true,
    workspaceReady: false,
    workspaceRole: '',
    artisanEmbed: false,
    /** 标本师关联 framer 文档 _id（mineOnly 列表 / 保存归属） */
    artisanFramerId: '',
    isSuperAdmin: false,
    /** 工作台展示名（问候语） */
    staffName: '',
    /** 礼赠履约待办角标（待填址+待发货+自提） */
    giftTodoCount: 0,
    giftTodos: {
      awaiting_address: 0,
      awaiting_ship: 0,
      pickup_verify: 0
    },
    /** 审批中心待我审角标 */
    approvalPendingCount: 0,
    /** 发票待开具角标 */
    invoicePendingCount: 0,
    /** 新订单未读角标（staff_order_paid） */
    newOrderUnreadCount: 0,
    /** 新订单未读消息 id（工作通知声音用它做「读了1条又来1条」的精确判断） */
    newOrderUnreadIds: [],
    /** 心愿补货未读（wishlist_restock_request，信息流用） */
    wishlistUnreadCount: 0,
    /** 菜单可见性（按三级角色裁剪，不删代码） */
    menu: {},
    menuSectionOps: false,
    menuSectionStudio: false,
    menuSectionMembers: false,
    menuSectionOrg: false,
    menuSectionOnSite: false,

    // 馆内直播状态（供信息流 / 主播菜单角标；入口已并入菜单「主播」→ studio）
    liveDashLoading: false,
    liveDash: {
      statusLabel: '暂无直播',
      statusTone: '',
      title: '',
      hostName: ''
    },

    /** 经营信号灯（对齐 docs/signal-lamp.md） */
    opsLegendOpen: false,
    /** 经营信号整块展开（默认收起；本地记忆） */
    opsSignalExpanded: false,
    /** 收起态摘要：最严重 1～3 chip + 待关注计数 */
    opsSignalSummary: {
      chips: [],
      attentionCount: 0,
      label: '全部健康',
      worstLamp: 'on'
    },
    /** 订单履约/风险计数（与待发一致：当前 status 快照，无日期窗） */
    opsOrderCounts: {
      shipped: 0,
      received: 0,
      aftersale: 0,
      refunded: 0
    },
    opsSignals: {
      orders: LAMP.muted,
      shipped: LAMP.muted,
      received: LAMP.muted,
      aftersale: LAMP.muted,
      refunded: LAMP.muted,
      support: LAMP.muted,
      workOrders: LAMP.muted,
      recruit: LAMP.muted,
      gift: LAMP.muted,
      mom: LAMP.muted,
      stock: LAMP.muted
    },
    /**
     * Hub 信息流跑马灯：仅聚合工作台已有待办/异常（无假数据）。
     * 空数组时整条隐藏。
     * opsInfoFeedSets：双段副本供 -50% translate 无缝滚动（与 index.wxml 对齐）。
     */
    opsInfoFeed: [],
    opsInfoFeedSets: [],
    opsInfoFeedLoop: [],
    opsInfoFeedAnimSec: 18,
    opsInfoFeedAnimStyle: '',

    // 数据源 (确保全量字段初始化)
    orders: [], ordersView: [], ordersLoading: false, ordersHasMore: false,
    shippedOrders: [], shippedOrdersView: [], shippedOrdersLoading: false, shippedOrdersHasMore: false,
    completedOrders: [], completedOrdersView: [], completedOrdersLoading: false, completedOrdersHasMore: false,
    bookings: [], products: [], framers: [], framersView: [], banners: [],
    framerAdminStats: { total: 0, active: 0, bound: 0, duplicateNames: 0, duplicateRows: 0 },
    framerStaffCandidates: [],
    framerQuery: '',
    framerTypeFilter: 'all',
    framerStatusFilter: 'all',
    framerDupOnly: false,
    framerLoading: false,
    showFramerBindSheet: false,
    framerBindTargetId: '',
    framerBindKeyword: '',
    framerBindCandidatesView: [],
    schemePresets: SCHEME_PRESETS,
    schemePresetIndex: 0, 
    refunds: [], refundsView: [], refundsLoading: false, refundsHasMore: false,
    pendingPayOrders: [], pendingPayOrdersView: [], pendingPayOrdersLoading: false, pendingPayOrdersHasMore: false,
    omQuery: '',
    omDays: 0,
    omSearchHint: '',
    omPendingCopyCount: 0,
    omLoadingMore: false,
    shipCarrierOptions: ['顺丰速运', '京东快递', '中通快递', '圆通速递', '韵达快递', '邮政快递包裹'],
    rewards: [], vipLevels: [], vipLevelsLoading: false, vipLevelsSource: '', activities: [], courses: [],
    revenues: [], categories: [], framerNames: [], framerList: [],
    /** 营收账本月份筛选 YYYY-MM */
    ledgerMonth: '',
    ledgerMonthLabel: '',
    /** 当月财务总览（对齐 Admin 月报口径） */
    ledgerOverview: {
      empty: true,
      dayCount: 0,
      daysWithData: 0,
      netFmt: '0',
      posFmt: '0',
      cashFmt: '0',
      cashBalanceFmt: '0',
      onlineFmt: '0',
      mpOnlineFmt: '0',
      mpRefundFmt: '0',
      pledgeDueFmt: '0',
      refundFmt: '0',
      dailyAvgFmt: '0',
      dailyRevFmt: '0',
      totalOrderCountFmt: '0',
      avgOrderPriceFmt: '—',
      dailyOrdersFmt: '—',
      hasOrderData: false,
      orderHint: '',
      channels: [],
      trend: [],
      donutStyle: 'background:#262320',
    },
    ledgerOverviewReady: false,
    /** 财务月报门店（与 Admin/云 storeId 对齐） */
    ledgerStoreId: storeLedger.FINANCE_STORE_ID,
    ledgerStoreName: '山海造物',
    ledgerStoreOptions: [],
    /** MONTHLY NET 旁账本同步信号灯 */
    ledgerSyncLampClass: 'lamp-muted',
    ledgerSyncTip: '',
    ledgerLatestDate: '',
    categoryRoots: [],
    categorySubMap: {},
    categorySubs: [],
    rootNames: [],
    subNames: [],
    customOrders: [], customConfigs: [], customInquiries: [], petMemorialOrders: [],
    framerRecruitApps: [],
    framerRecruitFilter: 'pending',
    subTab: 0, subTabReward: 0, subTabCustom: 0,
    showPetQuoteModal: false,
    tempPetQuote: { orderId: '', amount: '', note: '', validUntil: '' },
    showMemberPassResult: false,
    memberPassResult: {
      valid: false,
      expired: false,
      msg: '',
      memberNo: '',
      nickName: '',
      levelName: '',
      discountText: '',
      perks: []
    },
    
    // 统计数据
    stats: { 
      totalSales: 0, displaySales: '0',
      offlineSales: 0, displayOffline: '0',
      orderCount: 0, orderCountFmt: '0', stockCount: 0, totalProfit: '0',
      visitCount: 0, visitCountFmt: '0',
      onlineTotal: '0', onlineRatio: 0, offlineTotal: '0', offlineRatio: 0, displayGrand: '0',
      avgOrderFmt: '—', dailyAvgFmt: '—', momLabel: '—', momClass: 'flat',
      ratioEmpty: true, ordersEmpty: true,
      donutStyle: 'background: #262320;' 
    },
    trendData: [],
    trendMeta: {
      empty: true,
      error: false,
      weekTotalFmt: '0',
      weekOnlineFmt: '0',
      weekOfflineFmt: '0',
      weekOnlineBar: 'width:0%',
      weekOfflineBar: 'width:0%',
      momClass: 'flat',
    },
    chartLayout: computeDashChartLayout(0, 0, 375),
    dashStock: {
      ready: false,
      loading: false,
      empty: true,
      error: false,
      onShelf: 0,
      offShelf: 0,
      stockTotal: 0,
      topCats: [],
    },
    todayDate: '',
    greeting: '你好',

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
    defaultBookingHero: cdnPath('banners/chris-nguyen-tXmc2mVDxJc-unsplash.jpg'),
    searchVal: '',
    productArchiveFilter: 'all', // all | archive | oneOfAKind
    productPromoFilter: 'all', // all | seckill | seckill_expired | group
    /** 与 C 端 ProductList 对齐：new | sales | price_asc | price_desc */
    productSort: 'new',
    productPriceSortLabel: '价格',
    productSortOptions: [
      { key: 'new', label: '最新' },
      { key: 'sales', label: '销量' },
      { key: 'price', label: '价格', isPrice: true }
    ],
    oneOfAKindManualOff: false,
    expiredSeckillCount: 0,
    /** 藏品明细分页（对齐 manageProducts list / Admin） */
    productPage: 1,
    productPageSize: 50,
    productTotal: 0,
    productHasMore: false,
    productListLoading: false,
    productLoadingMore: false,
    productStats: null,
    productStatsLoading: false,
    productStatsTrendDays: 7,
    /** 藏品库子栏：list 明细 | stats 库存概览 | category 分类管理 */
    productLibTab: 'list',
    productFormTab: 'basic',
    productFormTabs: ['basic', 'sku', 'flags', 'archive', 'detail', 'promo'],
    skuBulkPrice: '',
    skuBulkStock: '',
    skuDimBuilder: [{ name: '', valuesStr: '' }],
    
    showProductModal: false, showFramerModal: false, showCatModal: false,
    showCatLinkModal: false,
    catLinkTarget: null,
    catLinkMode: 'auto',
    catLinkPreview: [],
    catLinkMatchCount: 0,
    catLinkAlreadyCount: 0,
    catLinkLastResult: null,
    catLinkLoading: false,
    catLinkEmptyHint: '',
    showBannerModal: false, showRewardModal: false, showVipModal: false, 
    showActivityModal: false, showRevenueModal: false, 
    showContentModal: false, showVerifySuccess: false,
    showCustomConfigModal: false,
    showStoreEditModal: false,
    adminStores: [],
    storeTabLoading: false,
    selectedStoreId: 'store_shanhaizaowu',
    activeStore: null,
    atlasSpotsAll: [],
    atlasSpots: [],
    storeVisitStats: { total: 0, byStore: {} },
    tempStoreEdit: {
      storeId: '',
      name: '',
      phone: '',
      address: '',
      floor: '',
      heroTagline: '',
      intro: '',
      hoursOpen: '10:00',
      hoursClose: '22:00',
      visitTipsText: '',
      status: 'active'
    },

    // 运费规则（curTab 15）
    shippingLoading: false,
    shippingSaving: false,
    shippingRuleDocId: '',
    shippingRuleText: '',
    shippingFromDefault: true,
    shippingMixLabels: ['含藏品用藏品门槛', '仅饰品用饰品门槛', '取更高门槛'],
    shippingMixValues: ['specimen_wins', 'accessory_wins', 'max_threshold'],
    shippingMixIndex: 0,
    shippingForm: {
      name: '商城运费规则',
      defaultCarrier: '顺丰速运',
      flatFee: '18.00',
      accessoryFreeThreshold: '200.00',
      specimenFreeThreshold: '500.00',
      mixCartStrategy: 'specimen_wins',
      campaignEnabled: false,
      campaignLabel: '当前全场免邮'
    },

    // 内容展示开关（curTab 16）
    contentFlagsLoading: false,
    contentFlagsSaving: false,
    // 有未保存的改动：开关是「先改本地、点保存才写云端」的，
    // 没有这个提示时，超管拨完开关就会以为已经生效（实测踩过：C 端一直没变化）
    contentFlagsDirty: false,
    contentFlagsDocId: '',
    contentFlagsFromDefault: true,
    contentFlags: {
      showSpecimenArchive: false,
      showUserCommunity: false,
      showBookingEntry: true,
      showSpecimenCustom: false,
      showPetMemorial: true,
      showLive: false,
      showStoredValue: false,
      showAiIdentify: true,
      showStore: true,
      showStorePickup: true,
      showGift: false,
      // 需求 28：马上有祈福弹幕（缺配置默认关）
      showMaShangYou: false,
      // 以下四项本面板**没有渲染开关**（编辑入口在 ERP 内容开关页），但必须随状态一起携带：
      // 云函数 saveFlags 是按固定字段表整体写入的，本端不带上它们 = 保存时把它们重置为默认值，
      // 于是「ERP 关掉的图鉴/成就/缩略图/iOS 储值」会被这里一次保存静默打开（跨端互抹）。
      // 带上是"原值回传"，面板不改它们，保存后仍等于原值。守卫有「字段必须齐」的结构断言。
      allowIosStoredValue: true,
      imageThumbEnabled: true,
      showAtlas: true,
      showAchievements: true
    },

    analyticsDays: 7,
    analyticsRangeType: 'days',
    analyticsMonth: '',
    analyticsMonthLabel: '',
    analyticsMonthCurrent: '',
    analyticsMonthPrev: '',
    analyticsMonthMax: '',
    analyticsLoading: false,
    analyticsError: '',
    analyticsNotesOpen: false,
    analytics: {
      summary: { totalEvents: 0, uniqueUsers: 0, pageViews: 0 },
      byModule: [],
      byAction: [],
      funnel: { identify: {}, store: {}, commerce: {} },
      dailyTrend: [],
      sampled: false,
      note: ''
    },
    analyticsReport: {
      notes: [],
      rangeLabel: '',
      chartHint: '',
      empty: true,
      signals: {
        items: [],
        summary: { ok: 0, warn: 0, danger: 0, muted: 0 },
        rulesNote: ''
      },
      headline: {
        grandTotalFmt: '0.00',
        netOnlineFmt: '0.00',
        offlineLedgerFmt: '0.00',
        refundAmountFmt: '0.00',
        gmvPaidFmt: '0.00',
        paidOrders: 0,
        aovFmt: '—',
        avgDau: 0,
        newUsers: 0
      },
      channelMix: [],
      sourceMix: [],
      ledgerByStore: [],
      users: {
        totalNewUsers: 0,
        newUsersByDay: [],
        dauByDay: [],
        dauSource: '',
        retention: {},
        behaviorSummary: {},
        topEvents: []
      },
      members: { payingUsers: 0, levelShare: [] },
      category: { byType: [] },
      deposit: {
        available: false,
        counts: {},
        paidDepositAmountFmt: '0.00',
        forfeitedAmountFmt: '0.00',
        settledCount: 0
      },
      commission: {
        available: false,
        earnTotalFmt: '0.00',
        reverseTotalFmt: '0.00',
        netTotalFmt: '0.00',
        earnCount: 0,
        topArtisans: []
      },
      orders: {
        daily: [],
        totals: {
          orders: 0,
          paid: 0,
          unpaid: 0,
          refunded: 0,
          gmvPaid: 0,
          netOnline: 0,
          aov: 0,
          offlineLedger: 0,
          gmvPaidFmt: '0.00',
          netOnlineFmt: '0.00',
          aovFmt: '—',
          offlineLedgerFmt: '0.00',
          mix: {
            commerceFmt: '0.00',
            giftFmt: '0.00',
            depositFmt: '0.00',
            depositBalanceFmt: '0.00',
            customFmt: '0.00'
          }
        },
        truncated: false
      },
      catalog: {
        counts: { onShelf: 0, offShelf: 0, stockTotal: 0, lowStockSkus: 0, total: 0 },
        byCategory: [],
        truncated: false,
        lowStockThreshold: 3
      },
      behavior: { funnel: { identify: {}, store: {}, commerce: {} }, topEvents: [] },
      charts: { newUsers: [], dau: [], orderCount: [], gmv: [], revenue: [] }
    },
    
    // 内容管理相关
    contentType: 'exhibition', // 'exhibition' | 'article' | 'comment' | 'care'
    contentFilter: 'all', // 'all' | 'published' | 'draft'
    articles: [], exhibitions: [], filteredArticles: [],
    careGuides: [],
    careCategoryOptions: ['INSECTA', 'ANIMALIA', 'PLANTAE', 'MARINE', 'MINERALS', 'GENERAL', 'FRAMING'],
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
    productChannelEligible: false,
    productCraftEligible: false,
    channelLabels: ['未标注', '进口', '国产', '其它'],
    channelValues: ['', 'import', 'domestic', 'other'],
    channelIndex: 0,
    craftLabels: ['未标注'].concat(CRAFT_TYPE_OPTIONS.map((o) => o.label)),
    craftValues: [''].concat(CRAFT_TYPE_OPTIONS.map((o) => o.value)),
    craftTypeIndex: 0,
    craftProcessLabels: ['未标注'].concat(CRAFT_PROCESS_OPTIONS.map((o) => o.label)),
    craftProcessValues: [''].concat(CRAFT_PROCESS_OPTIONS.map((o) => o.value)),
    craftProcessIndex: 0,
    sizeFormMode: 'box',
    sizeFormHint: '方形玻璃罩：长 / 宽 / 高（cm）',
    sizeFormLabel: '长 × 宽 × 高',
    giftSceneOptions: GIFT_SCENES.map((s) => ({ key: s.key, label: s.label, on: false })),

    isEditing: false, editId: '',
    
    tempProduct: {}, tempFramer: {}, tempBanner: {}, tempReward: {}, tempVip: {}, 
    tempActivity: {}, newCatName: '', newCatEn: '',
    newCatLevel: 1,
    newCatParentIndex: 0,
    categoryManageTree: [],
    catManageRootNames: [],
    tempRevenue: { date: '', pos: 0, online: 0, refund: 0, cash: 0, cashBalance: '', orderCount: '', rawText: '' },
    tempContent: {}, tempCustomConfig: {},

    subTabMessage: 0,
    omYouxinBuyerHint: '',
    pushForm: {
      title: '',
      content: '',
      category: 'activity',
      actionUrl: '',
      scope: 'segment',
      targetOpenid: '',
      campaignType: 'recall',
      segment: '',
      offerHint: '',
      honoraryOnly: false,
      activeOnly: false,
      highValueOnly: false
    },
    youxinCampaignTypes: [
      { key: 'recall', label: '召回唤醒' },
      { key: 'conversion', label: '转化关怀' },
      { key: 'general', label: '通用公告' }
    ],
    youxinSegments: [],
    youxinSegmentsVisible: [],
    pushEstimate: 0,
    pushPreviewNote: '',
    pushAiLoading: false,
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

  async onLoad(options) {
    if (!guardManagerPage()) return;
    this._bootOptions = options || {};
    const { getPageNavInsets } = require('../utils/pageNav');
    const nav = getPageNavInsets();
    const ledgerMonth = storeLedger.getCurrentYearMonth();
    const analyticsMonthPrev = (() => {
      const parts = String(ledgerMonth).split('-').map((x) => parseInt(x, 10));
      const y = parts[0] || new Date().getFullYear();
      const m = parts[1] || new Date().getMonth() + 1;
      const d = new Date(y, m - 2, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
    this.setData({
      navTop: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navSpacerHeight: nav.headerBlockPx,
      ledgerMonth,
      ledgerMonthLabel: storeLedger.formatMonthLabel(ledgerMonth),
      analyticsMonth: ledgerMonth,
      analyticsMonthLabel: storeLedger.formatMonthLabel(ledgerMonth),
      analyticsMonthCurrent: ledgerMonth,
      analyticsMonthPrev,
      analyticsMonthMax: ledgerMonth,
      opsSignalExpanded: (() => {
        try {
          return wx.getStorageSync(OPS_SIGNAL_EXPAND_KEY) === true;
        } catch (e) {
          return false;
        }
      })()
    });

    const boot = this._bootOptions || {};
    const fromArtisanEntry =
      String(boot.from || '').trim() === 'artisan' ||
      String(boot.mine || '').trim() === '1';
    const role = fromArtisanEntry
      ? await guardArtisanWorkspace()
      : await guardManagerWorkspace();
    if (!role) return;
    const viewWorkspace = String(boot.workspace || '').trim();
    const roleForMenu = { ...role };
    if (fromArtisanEntry) {
      roleForMenu.workspaceRole = WORKSPACE_SPECIMEN_ARTISAN;
      this.setData({
        artisanEmbed: true,
        pageTitle: '本人藏品',
        productFormTabs: ['basic', 'sku', 'flags', 'archive', 'detail']
      });
      this.loadArtisanFramerId().catch(() => {});
    } else if (
      viewWorkspace === WORKSPACE_STORE_MANAGER &&
      (role.roles || []).indexOf('manager') !== -1
    ) {
      roleForMenu.workspaceRole = WORKSPACE_STORE_MANAGER;
    } else if (viewWorkspace === WORKSPACE_SUPER_ADMIN) {
      // 安全：此前不校验角色，店长/店员只要带 ?workspace=super_admin 即可把界面抬升为超管视图
      const isRealSuperAdmin = !!(role && (role.isSuperAdmin || (role.roles || []).indexOf('super_admin') !== -1));
      if (isRealSuperAdmin) {
        roleForMenu.workspaceRole = WORKSPACE_SUPER_ADMIN;
      } else {
        console.warn('忽略越权的 workspace=super_admin 请求');
      }
    }
    this.applyWorkspaceRole(roleForMenu);
    this.applyProductLibDeepLink(this._bootOptions);
    // 标本师 create/productId 深链改由 workspace/index 在 refreshSubData 后触发，
    // 避免与 baseOnLoad 双重 openProductModal 清空概念预填
    if (
      fromArtisanEntry &&
      this.data.curTab === 0 &&
      canAccessManagerTab(this.data.workspaceRole, 1)
    ) {
      this.setData({
        curTab: 1,
        pageTitle: fromArtisanEntry ? '本人藏品' : '藏品库',
        productLibTab: 'list'
      });
      this.refreshSubData(1);
    }

    this.loadAtlasSpotsMeta().catch((e) => console.warn('atlasSpots', e));
  },

  /** 印记码列表：与 C 端图鉴同源（manageAtlas · spotsList） */
  async loadAtlasSpotsMeta() {
    const res = await wx.cloud.callFunction({
      name: 'manageAtlas',
      data: { action: 'spotsList' }
    });
    const payload = res.result || {};
    if (!payload.success) return;
    const spots = (payload.data && payload.data.spots) || [];
    const atlasSpotsAll = spots.map((s) => ({
      id: s.id,
      storeId: s.storeId || 'store_shanhaizaowu',
      code: s.code || `ATLAS:${s.id}`,
      hint: s.hint || '',
      speciesId: s.speciesId,
      label:
        s.speciesNo && s.speciesName
          ? `${s.speciesNo} · ${s.speciesName}`
          : s.speciesId
    }));
    this.setData({ atlasSpotsAll });
    this.applyStoreSelection(this.data.selectedStoreId || 'store_shanhaizaowu');
  },

  applyWorkspaceRole(role) {
    const workspaceRole = role.workspaceRole || '';
    const menu = {};
    Object.keys(MENU_KEYS).forEach((k) => {
      const key = MENU_KEYS[k];
      menu[key] = canSeeMenu(workspaceRole, key);
    });
    // 礼赠：giftOps → 仅履约看板；manageGift / 超管 → 运营配置
    const isSuper = !!(role && (role.isSuperAdmin || role.superAdmin));
    const perms = Array.isArray(role && role.permissions) ? role.permissions : [];
    const canGiftOps =
      isSuper ||
      perms.indexOf('giftOps') !== -1 ||
      perms.indexOf('manageGift') !== -1;
    const canGiftManage = isSuper || perms.indexOf('manageGift') !== -1;
    if (menu[MENU_KEYS.GIFT_OPS]) menu[MENU_KEYS.GIFT_OPS] = canGiftOps;
    else if (canGiftOps) menu[MENU_KEYS.GIFT_OPS] = true;
    if (menu[MENU_KEYS.GIFT_MANAGE]) menu[MENU_KEYS.GIFT_MANAGE] = canGiftManage;
    else menu[MENU_KEYS.GIFT_MANAGE] = false;
    const menuSectionVisible = (keys) => keys.some((key) => menu[key]);
    const menuSectionOps = menuSectionVisible(HUB_MENU_SECTIONS.OPS);
    const menuSectionStudio = menuSectionVisible(HUB_MENU_SECTIONS.STUDIO);
    const menuSectionMembers = menuSectionVisible(HUB_MENU_SECTIONS.MEMBERS);
    const menuSectionOrg = menuSectionVisible(HUB_MENU_SECTIONS.ORG);
    const menuSectionOnSite = menuSectionVisible(HUB_MENU_SECTIONS.ON_SITE);
    this.setData({
      workspaceReady: true,
      workspaceRole,
      isSuperAdmin: workspaceRole === WORKSPACE_SUPER_ADMIN,
      staffName: String((role && role.name) || '').trim(),
      menu,
      menuSectionOps,
      menuSectionStudio,
      menuSectionMembers,
      menuSectionOrg,
      menuSectionOnSite
    });
    this.startClock();
    // 角色就绪后立刻并行拉角标，不等待统计/分类等重链路
    this.prefetchHubTodoBadges({ force: true, menu });
    this.refreshData();
    if (menu.live) this.loadLiveDash();
  },

  copyAtlasCode(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    wx.setClipboardData({
      data: code,
      success: () => wx.showToast({ title: '已复制印记码', icon: 'none' })
    });
  },

  onShow() {
    if (!this.data.workspaceReady) return;
    this.startClock();
    // Hub：进子页返回时强制刷新角标；与 onLoad 短窗去重
    if (this.data.curTab === 0) {
      this.prefetchHubTodoBadges({ force: true });
    }
    this.refreshData();
    if (this.data.menu && this.data.menu.live) {
      this.loadLiveDash();
    }
  },

  onHide() {
    this.stopClock();
  },

  onReady() {
    this.scheduleChartLayout();
    if (wx.onWindowResize) {
      this._onWindowResizeChart = () => this.scheduleChartLayout();
      wx.onWindowResize(this._onWindowResizeChart);
    }
  },
  
  onUnload() {
    this.stopClock();
    clearTimeout(this.timer);
    clearTimeout(this._pickerTimer);
    clearTimeout(this._chartLayoutTimer);
    clearTimeout(this._chartLayoutRetry);
    if (this._onWindowResizeChart && wx.offWindowResize) {
      wx.offWindowResize(this._onWindowResizeChart);
    }
  },

  scheduleChartLayout() {
    clearTimeout(this._chartLayoutTimer);
    clearTimeout(this._chartLayoutRetry);
    this._chartMeasureRetried = false;
    this._chartLayoutTimer = setTimeout(() => this.measureDashboardCharts(), 64);
  },

  measureDashboardCharts() {
    if (this.data.curTab !== 0 || !this.data.menu || !this.data.menu.dashboardKpi) {
      return;
    }
    const applyLayout = (trendW, ratioW) => {
      const layout = computeDashChartLayout(trendW, ratioW, dashWindowWidth());
      this._dashChartLayout = layout;
      const patch = { chartLayout: layout };
      if (this._lastTrendDays && this._lastTrendDays.length) {
        patch.trendData = buildTrendChartEntries(
          this._lastTrendDays,
          (n, c) => this._shortMoney(n, c),
          layout
        );
      }
      this.setData(patch);
    };

    const q = wx.createSelectorQuery().in(this);
    q.select('#dash-ratio-box').boundingClientRect();
    q.select('#dash-trend-bars').boundingClientRect();
    q.select('.dashboard-grid').boundingClientRect();
    q.exec((res) => {
      const ratioRect = (res && res[0]) || {};
      const trendRect = (res && res[1]) || {};
      const gridRect = (res && res[2]) || {};
      let trendW = Number(trendRect.width) || 0;
      let ratioW = Number(ratioRect.width) || 0;
      const gridW = Number(gridRect.width) || 0;

      // 节点尚未铺开时用网格宽推算，避免 0 宽触发错误窄屏兜底
      if (gridW > 0) {
        const rpx = dashWindowWidth() / 750;
        const gap = 24 * rpx;
        const cardPad = 60 * rpx;
        if (trendW < 8) trendW = Math.max(0, gridW - cardPad);
        if (ratioW < 8) {
          const stack = dashWindowWidth() < 300;
          ratioW = stack
            ? Math.max(0, gridW - cardPad)
            : Math.max(0, (gridW - gap) / 2 - cardPad);
        }
      }

      applyLayout(trendW, ratioW);

      const needRetry =
        (!trendRect.width || !ratioRect.width) && !this._chartMeasureRetried;
      if (needRetry) {
        this._chartMeasureRetried = true;
        clearTimeout(this._chartLayoutRetry);
        this._chartLayoutRetry = setTimeout(() => this.measureDashboardCharts(), 140);
      }
    });
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
    const greet = greetByHour(hour);

    this.setData({ todayDate: str, greeting: greet });
  },

  onPullDownRefresh() {
    if (this.data.curTab === 1 && this.data.productLibTab === 'list') {
      this.loadProducts({ reset: true }).finally(() => wx.stopPullDownRefresh());
      return;
    }
    if (this.data.curTab === 13) {
      this.loadAnalyticsDashboard().finally(() => wx.stopPullDownRefresh());
      return;
    }
    this.refreshData().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.curTab === 1 && this.data.productLibTab === 'list') {
      this.loadMoreProducts();
    }
  },
  
  setToday() {
    const d = new Date();
    const dateStr = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
    const dbDateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const hour = d.getHours();
    const greet = greetByHour(hour);
    
    const week = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const now = new Date();
    const emptyDays = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      emptyDays.push({
        dateKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        day: week[d.getDay()],
        online: 0,
        offline: 0,
        total: 0,
      });
    }
    this._lastTrendDays = emptyDays;
    const layout = this._dashChartLayout || this.data.chartLayout || computeDashChartLayout(0, 0, dashWindowWidth());
    const chart = buildTrendChartEntries(emptyDays, (n, c) => this._shortMoney(n, c), layout);
    const ledgerMonth = this.data.ledgerMonth || storeLedger.getCurrentYearMonth();
    this.setData({
      todayDate: dateStr,
      greeting: greet,
      trendData: chart,
      trendMeta: {
        empty: true,
        error: false,
        weekTotalFmt: '0',
        weekOnlineFmt: '0',
        weekOfflineFmt: '0',
        weekOnlineBar: 'width:0%',
        weekOfflineBar: 'width:0%',
        momClass: 'flat',
      },
      'tempRevenue.date': dbDateStr,
      ledgerMonth,
      ledgerMonthLabel: storeLedger.formatMonthLabel(ledgerMonth),
    });
  },

  switchTab(e) { 
    wx.vibrateShort({ type: 'light' });
    const idx = parseInt(e.currentTarget.dataset.idx);
    const title = e.currentTarget.dataset.title || '';
    // 核销/现场高频 → 店员工作台（避免店长页堆叠店员操作）
    if (idx === 3) {
      goStaffConsole();
      return;
    }
    if (!canAccessManagerTab(this.data.workspaceRole, idx)) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    // 二级开启自绘左缘回看板；根视图左缘才 leave（见 onWorkspaceBack）
    const patch = { curTab: idx, pageTitle: title };
    if (idx === 2) patch.subTab = 0;
    // 从菜单进入藏品库时默认「藏品明细」
    if (idx === 1) patch.productLibTab = 'list';
    this.setData(patch);
    if (idx !== 0) this.refreshSubData(idx);
  },

  /** 藏品库顶栏三 Tab */
  switchProductLibTab(e) {
    const tab = String((e && e.currentTarget && e.currentTarget.dataset.tab) || 'list');
    this.setProductLibTab(tab);
  },

  setProductLibTab(tab) {
    if (this.data.artisanEmbed) {
      this.setData({ productLibTab: 'list' });
      return;
    }
    const next = tab === 'stats' || tab === 'category' ? tab : 'list';
    if (this.data.productLibTab === next) {
      if (next === 'stats' && !this.data.productStats && !this.data.productStatsLoading) {
        this.loadProductStats();
      }
      if (next === 'category') this.loadCategoriesManage();
      return;
    }
    this.setData({ productLibTab: next });
    if (next === 'stats') this.loadProductStats();
    if (next === 'category') this.loadCategoriesManage();
  },

  /** 标本师工作台：?productTab=create | productId=xxx */
  async loadArtisanFramerId() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaff',
        data: { action: 'getArtisanProfile' }
      });
      const profile = (res.result && res.result.profile) || {};
      const framerId = String(profile.framerId || '').trim();
      if (framerId) this.setData({ artisanFramerId: framerId });
    } catch (e) {
      console.warn('loadArtisanFramerId', e);
    }
  },

  applyArtisanProductDeepLink(options) {
    const opts = options || {};
    const fromArtisan = String(opts.from || '').trim() === 'artisan';
    if (!fromArtisan) return;
    // workspace onLoad 与 baseOnLoad 都可能触发；只执行一次，避免二次 open 清空概念预填
    if (this._artisanProductDeepLinkDone) return;
    const productRaw = String(opts.productTab || '').trim().toLowerCase();
    const productId = String(opts.productId || '').trim();
    if (productRaw !== 'create' && !productId) return;
    this._artisanProductDeepLinkDone = true;
    if (productRaw === 'create') {
      setTimeout(() => this.openProductModal({ currentTarget: { dataset: {} } }), 400);
      return;
    }
    setTimeout(async () => {
      let item = (this.data.products || []).find((p) => p._id === productId);
      if (!item) {
        await this.loadProducts();
        item = (this.data.products || []).find((p) => p._id === productId);
      }
      if (item) {
        this.openProductModal({ currentTarget: { dataset: { item } } });
      } else {
        wx.showToast({ title: '藏品未加载，请稍后在列表中打开', icon: 'none' });
      }
    }, 400);
  },

  /** 外链：?tab=1&productTab=category|stats|list */
  applyProductLibDeepLink(options) {
    const opts = options || {};
    const tabRaw = String(opts.tab || opts.curTab || '').trim().toLowerCase();
    const productRaw = String(opts.productTab || opts.productLib || opts.sub || '').trim().toLowerCase();
    if (!tabRaw && !productRaw) return;
    const wantProducts = tabRaw === '1' || tabRaw === 'products' || !!productRaw;
    if (!wantProducts) return;
    if (!canAccessManagerTab(this.data.workspaceRole, 1)) return;
    const map = {
      list: 'list', detail: 'list', products: 'list', create: 'list',
      stats: 'stats', overview: 'stats', inventory: 'stats',
      category: 'category', cat: 'category', categories: 'category'
    };
    const embed = !!this.data.artisanEmbed;
    const lib = embed ? 'list' : (map[productRaw] || 'list');
    this.setData({
      curTab: 1,
      pageTitle: embed ? '本人藏品' : '藏品库',
      productLibTab: lib
    });
    this.refreshSubData(1);
  },

  /** 带权限校验的外链入口 */
  goStorePointsGuarded(e) {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.POINTS)) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    goStorePoints(e);
  },

  goStaffDirectoryGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.STAFF_DIRECTORY)) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    goStaffDirectory();
  },

  goStoreStaffPermissionsGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.STAFF_PERMISSIONS)) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    goStoreStaffPermissions();
  },

  goShareholderConfigGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.SHAREHOLDER_CONFIG)) {
      wx.showToast({ title: '仅超管可配置股东', icon: 'none' });
      return;
    }
    goShareholderConfig();
  },

  goInvoiceRequestsGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.INVOICE)) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    goInvoiceRequests();
  },

  goGiftOpsGuarded() {
    if (!this.data.menu || !this.data.menu.giftOps) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    goGiftOps();
  },

  goGiftManageGuarded() {
    if (!this.data.menu || !this.data.menu.giftManage) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    goGiftManage();
  },

  goApprovalsGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.APPROVALS)) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    goApprovals();
  },

  goHonoraryCuratorsGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.HONORARY_CURATORS)) {
      wx.showToast({ title: '仅超管可维护荣誉馆长', icon: 'none' });
      return;
    }
    goHonoraryCurators();
  },

  goMemberCrmGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.MEMBER_CRM)) {
      wx.showToast({ title: '仅超管可进入会员 CRM', icon: 'none' });
      return;
    }
    goMemberCrm();
  },

  goMemberLevelAdjustGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.MEMBER_LEVEL_ADJUST)) {
      wx.showToast({ title: '仅超管可调整会员等级', icon: 'none' });
      return;
    }
    goMemberLevelAdjust();
  },

  goWalletConfigGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.WALLET_CONFIG)) {
      wx.showToast({ title: '仅超管可配置钱包', icon: 'none' });
      return;
    }
    goWalletConfig();
  },

  goWelcomeGiftGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.WELCOME_GIFT)) {
      wx.showToast({ title: '仅超管可配置新会员礼包', icon: 'none' });
      return;
    }
    goWelcomeGift();
  },

  goBirthdayGiftGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.WELCOME_GIFT)) {
      wx.showToast({ title: '仅超管可配置生日礼包', icon: 'none' });
      return;
    }
    goBirthdayGift();
  },
  goDepositOpsGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.DEPOSIT_OPS)) {
      wx.showToast({ title: '仅超管可管理定金', icon: 'none' });
      return;
    }
    goDepositOps();
  },

  goPurchaseOpsGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.PURCHASE_OPS)) {
      wx.showToast({ title: '仅超管可管理采购', icon: 'none' });
      return;
    }
    goPurchaseOps();
  },

  goShipmentOpsGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.SHIPMENT_OPS)) {
      wx.showToast({ title: '暂无出货单权限', icon: 'none' });
      return;
    }
    goShipmentOps();
  },

  goInventoryOpsGuarded(opts) {
    const can =
      canSeeMenu(this.data.workspaceRole, MENU_KEYS.INVENTORY_OPS) ||
      canSeeMenu(this.data.workspaceRole, MENU_KEYS.RAW_INVENTORY_OPS);
    if (!can) {
      wx.showToast({ title: '无库存管理权限', icon: 'none' });
      return;
    }
    goInventoryOps(opts);
  },

  /** @deprecated 兼容旧绑定：进入库存管理 · 原材料 Tab */
  goRawInventoryOpsGuarded() {
    this.goInventoryOpsGuarded({ tab: 'raw' });
  },

  goStudioDashboardGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.STUDIO_DASHBOARD)) {
      wx.showToast({ title: '仅超管可查看工作室仪表盘', icon: 'none' });
      return;
    }
    goStudioDashboard();
  },

  goPropertyCostGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.PROPERTY_COST)) {
      wx.showToast({ title: '仅超管可管理物业成本', icon: 'none' });
      return;
    }
    goPropertyCost();
  },

  goArtisanCommissionGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.ARTISAN_COMMISSION)) {
      wx.showToast({ title: '仅超管可配置销售提成', icon: 'none' });
      return;
    }
    goArtisanCommission();
  },

  goBookingRulesGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.BOOKING_RULES)) {
      wx.showToast({ title: '仅超管可配置预约规则', icon: 'none' });
      return;
    }
    goBookingRules();
  },

  goSupportConfigGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.SUPPORT_CONFIG)) {
      wx.showToast({ title: '仅超管可配置客服入口', icon: 'none' });
      return;
    }
    goSupportConfig();
  },

  goMyPayslipGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.MY_PAYSLIP)) {
      wx.showToast({ title: '无工资条权限', icon: 'none' });
      return;
    }
    goMyPayslip();
  },

  goPayslipAdminGuarded() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.PAYSLIP_ADMIN)) {
      wx.showToast({ title: '仅超管可维护工资', icon: 'none' });
      return;
    }
    goPayslipAdmin();
  },

  goLiveStudio() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.LIVE)) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/subpackages/extra/live/studio/index',
      fail: () => wx.showToast({ title: '主播工作台暂不可用', icon: 'none' })
    });
  },

  goLiveBroadcast() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.LIVE)) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/subpackages/extra/live/broadcast/index',
      fail: () => wx.showToast({ title: '开播页暂不可用', icon: 'none' })
    });
  },

  /** 轻量拉取直播态：信息流「直播中」+ 菜单 LIVE 角标（配置/结束场次在主播工作台） */
  async loadLiveDash() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.LIVE)) return;
    this.setData({ liveDashLoading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageLiveSession',
        data: { action: 'getDashboard' }
      });
      const result = (res && res.result) || {};
      const active = result.active || null;
      const mine = result.mine || null;
      const current = (mine && mine.status === 'live') ? mine : active;
      let statusLabel = '暂无直播';
      let statusTone = '';
      if (current && current.status === 'live') {
        if (result.configured && current.pullUrl) {
          statusLabel = '直播中';
          statusTone = 'live';
        } else {
          statusLabel = '异常残留';
          statusTone = 'warn';
        }
      } else if (mine && mine.status === 'idle') {
        statusLabel = '待开播';
      }
      this.setData({
        liveDashLoading: false,
        liveDash: {
          statusLabel,
          statusTone,
          title: (current && current.title) || '',
          hostName: (current && current.hostName) || ''
        }
      });
      this.refreshOpsSignals();
    } catch (e) {
      this.setData({
        liveDashLoading: false,
        liveDash: {
          ...this.data.liveDash,
          statusLabel: '状态未知',
          statusTone: ''
        }
      });
      this.refreshOpsSignals();
    }
  },

  goStaffTabGuarded(e) {
    this.goStaffTab(e);
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
  /** 子视图 → 经营看板（页内 Tab，不改页面栈） */
  backToDashboard() {
    if (this.data.showCommentReplyModal) return;
    wx.vibrateShort({ type: 'light' });
    if (this.data.artisanEmbed) {
      this.leaveWorkbench();
      return;
    }
    this.setData({ curTab: 0, pageTitle: '' });
  },

  /**
   * 工作台统一返回：二级（curTab≠0）回看板；根看板才离开页。
   * 左上角按钮 / 自绘左缘 / 安卓 onBackPress 共用。
   */
  onWorkspaceBack() {
    if (this.data.showCommentReplyModal) return true;
    if (this.data.curTab !== 0) {
      this.backToDashboard();
      return true;
    }
    this.leaveWorkbench();
    return true;
  },

  /**
   * 离开工作台：仅根看板触发。优先 navigateBack 回进入前真实上一页。
   * 无栈（深链/分享直达）时 fallback 到探索 Tab。
   */
  leaveWorkbench() {
    if (this.data.showCommentReplyModal) return;
    leaveWorkspace({ fallbackUrl: '/pages/index/index' });
  },

  fallbackLeaveWorkbench() {
    fallbackLeaveWorkbench('/pages/index/index');
  },

  /** 安卓物理返回：二级先回看板，根视图再出栈 */
  onBackPress() {
    if (this.data.showCommentReplyModal) return false;
    if (this.data.curTab !== 0) {
      this.backToDashboard();
      return true;
    }
    return false;
  },

  goStorePoints: function (e) { this.goStorePointsGuarded(e); },
  goStaffDirectory: function () { this.goStaffDirectoryGuarded(); },
  goStoreStaffPermissions: function () { this.goStoreStaffPermissionsGuarded(); },
  goShareholderConfig: function () { this.goShareholderConfigGuarded(); },
  goInvoiceRequests: function () { this.goInvoiceRequestsGuarded(); },
  goGiftOps: function () { this.goGiftOpsGuarded(); },
  goGiftManage: function () { this.goGiftManageGuarded(); },
  goApprovals: function () { this.goApprovalsGuarded(); },
  goHonoraryCurators: function () { this.goHonoraryCuratorsGuarded(); },
  goMemberCrm: function () { this.goMemberCrmGuarded(); },
  goMemberLevelAdjust: function () { this.goMemberLevelAdjustGuarded(); },
  goWalletConfig: function () { this.goWalletConfigGuarded(); },
  goWelcomeGift: function () { this.goWelcomeGiftGuarded(); },
  goBirthdayGift: function () { this.goBirthdayGiftGuarded(); },
  goDepositOps: function () { this.goDepositOpsGuarded(); },
  goPurchaseOps: function () { this.goPurchaseOpsGuarded(); },
  goShipmentOps: function () { this.goShipmentOpsGuarded(); },
  goInventoryOps: function () { this.goInventoryOpsGuarded(); },
  goRawInventoryOps: function () { this.goRawInventoryOpsGuarded(); },
  goStudioDashboard: function () { this.goStudioDashboardGuarded(); },
  goPropertyCost: function () { this.goPropertyCostGuarded(); },
  goArtisanCommission: function () { this.goArtisanCommissionGuarded(); },
  goBookingRules: function () { this.goBookingRulesGuarded(); },
  goSupportConfig: function () { this.goSupportConfigGuarded(); },
  goStaffConsole,
  goStaffHome,

  /** 深链到店员工作台：推荐具名 tab=verify|grant|records|visit；数字按旧序迁移 */
  goStaffTab(e) {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.VERIFY) &&
        !canSeeMenu(this.data.workspaceRole, MENU_KEYS.GRANT_POINTS) &&
        !canSeeMenu(this.data.workspaceRole, MENU_KEYS.STAFF_CONSOLE)) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const tab = ds.tab || 'grant';
    const autoScan = /^(1|true|yes)$/i.test(String(ds.autoscan == null ? '' : ds.autoscan).trim());
    const qs = [`tab=${encodeURIComponent(tab)}`];
    if (autoScan) qs.push('autoScan=1');
    wx.navigateTo({
      url: `/subpackages/extra/staff/field/index?${qs.join('&')}`,
      fail: () => goStaffConsole()
    });
  },

  /** 首屏主 CTA：立刻开相机；成功后再进 field 复用核销/赠分 */
  goScanMember() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.VERIFY) &&
        !canSeeMenu(this.data.workspaceRole, MENU_KEYS.GRANT_POINTS) &&
        !canSeeMenu(this.data.workspaceRole, MENU_KEYS.STAFF_CONSOLE)) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    const tab = canSeeMenu(this.data.workspaceRole, MENU_KEYS.VERIFY) ? 'verify' : 'grant';
    openWorkspaceMemberScan({
      purpose: tab === 'grant' ? 'grant' : 'verify',
      tab
    });
  },

  noop() {},

  /**
   * Hub 菜单红角标 + 经营信号待办：进入工作台 / onShow 即并行预取。
   * - 与统计、分类等重请求解耦，单项失败不影响其它
   * - 覆盖：待发订单、售后计数、有信、工单、合作申请（以现有角标字段为准）
   */
  prefetchHubTodoBadges(options = {}) {
    if (this._hubBadgeInflight) return this._hubBadgeInflight;

    const force = !!(options && options.force);
    const menu = (options && options.menu) || this.data.menu || {};
    const now = Date.now();
    // force 短窗去重（覆盖 onLoad→onShow）；普通刷新 2.5s 节流
    const throttleMs = force ? 800 : 2500;
    if (this._hubBadgeLastAt && now - this._hubBadgeLastAt < throttleMs) {
      return Promise.resolve();
    }

    const safe = (label, fn) =>
      Promise.resolve()
        .then(fn)
        .catch((err) => {
          console.warn('prefetchHubTodoBadges', label, err);
        });

    const jobs = [];
    if (menu.orders) {
      jobs.push(safe('orders', () => this.loadOrders()));
      jobs.push(safe('opsOrderCounts', () => this.loadOpsOrderCounts()));
      jobs.push(safe('newOrderAlerts', () => this.loadNewOrderAlerts({ showPopup: true })));
    }
    if (menu.products) {
      jobs.push(safe('wishlistAlerts', () => this.loadWishlistAlerts()));
    }
    if (menu.support) {
      jobs.push(safe('support', () => this.loadSupportTickets()));
    }
    if (menu.framerRecruit) {
      jobs.push(safe('recruit', () => this.loadFramerRecruitApps()));
    }
    // 工单角标此前仅在 refreshSubData(10) 点进后才有
    if (menu.workOrders) {
      jobs.push(safe('workOrders', () => this.loadCustomOrders()));
    }
    if (menu.giftOps || menu.giftManage) {
      jobs.push(safe('gift', () => this.loadGiftHubBadge()));
    }
    if (menu.approvals) {
      jobs.push(safe('approvals', () => this.loadApprovalHubBadge()));
    }
    if (menu.invoice) {
      jobs.push(safe('invoice', () => this.loadInvoiceHubBadge()));
    }

    if (!jobs.length) {
      this.refreshOpsSignals();
      return Promise.resolve();
    }

    this._hubBadgeLastAt = now;
    const run = Promise.all(jobs).finally(() => {
      if (this._hubBadgeInflight === run) this._hubBadgeInflight = null;
      this.refreshOpsSignals();
      // 所有待办计数都到齐后才做声音判断：否则先到的单项会被当成「新增」误播（#29）
      this.syncWorkNoticeVoice();
    });
    this._hubBadgeInflight = run;
    return run;
  },

  // 🟢 全量刷新
  async refreshData() {
    wx.showNavigationBarLoading();
    const onHub = this.data.curTab === 0;
    // Hub 角标与看板基础数据并行；force 与 onShow 短窗去重，在飞则复用
    const badgePromise = onHub
      ? this.prefetchHubTodoBadges({ force: true })
      : Promise.resolve();
    try {
      await Promise.all([
          this.loadCategoriesTree(),
          this.loadFramers(),
          this.loadBookingConfig(),
          this.loadBanners(),
          this.loadTrendData(),
          badgePromise
      ]);
      // 核心统计刷新
      const offlineTotal = await this.loadOfflineStats();
      await this.loadStats(offlineTotal);
      this.loadDashboardStock();

      // 子模块页仍拉订单全量；Hub 角标已由 prefetchHubTodoBadges 覆盖
      if (!onHub) {
        await Promise.all([
            this.loadOrders(),
            this.loadShippedOrders(),
            this.loadCompletedOrders(),
            this.loadRefunds(),
            this.loadOpsOrderCounts(),
            this.loadBookings(),
            this.loadSupportTickets(),
            this.loadFramerRecruitApps()
        ]);
      }

    } catch (err) { console.error(err); }
    finally {
      wx.hideNavigationBarLoading();
      if (this.data.curTab === 0) this.scheduleChartLayout();
    }
  },

  async refreshSubData(idx) {
      if (!canAccessManagerTab(this.data.workspaceRole, idx)) return;
      if(idx === 1) {
        await this.loadProducts();
        await this.loadCategoriesTree();
        // 统计 / 分类管理按子 Tab 懒加载，避免一进藏品库就全拉
        if (this.data.productLibTab === 'stats') await this.loadProductStats();
        if (this.data.productLibTab === 'category') await this.loadCategoriesManage();
      }
      if(idx === 2) {
        await this.loadOrders();
        await this.loadShippedOrders();
        await this.loadCompletedOrders();
        await this.loadRefunds();
        await this.loadPendingPayOrders();
        await this.loadOpsOrderCounts();
      }
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
      if(idx === 14) { await this.loadFramerRecruitApps(); }
      if(idx === 11) {
        await this.loadYouxinSegments();
        await this.refreshYouxinSegmentPicker();
        await this.loadPushCampaigns();
        await this.loadAutoMessageLogs();
        await this.loadSupportTickets();
        await this.estimatePushRecipients();
      }
      if(idx === 12) { await this.loadAdminStores(); await this.loadStoreVisitStats(); }
      if(idx === 13) { await this.loadAnalyticsDashboard(); }
      if(idx === 15) { await this.loadShippingRules(); }
      if(idx === 16) { await this.loadContentDisplayFlags(); }
  },

  // 🟢 核心：加载线下营收（本月 store_ledger，三源合并；固定主店，勿用 C 端 preferred）
  async loadOfflineStats() {
    try {
        const { total: offlineTotal } = await storeLedger.sumMonthOffline(storeLedger.FINANCE_STORE_ID);
        
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

  /**
   * 小程序已付 GMV 按东八区营业日聚合（与 GMV 卡 / 观测台「线上」同口径）
   * 不含账本 online 字段；含礼赠 paid_awaiting_address
   */
  async _fetchMpGmvByDate(startDate, endDate) {
    const pad2 = (n) => String(n).padStart(2, '0');
    const toKey = (v) => {
      if (v == null) return '';
      const d = v instanceof Date ? v : new Date(v);
      if (Number.isNaN(d.getTime())) return '';
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    };
    const start = new Date(String(startDate).replace(/-/g, '/') + ' 00:00:00');
    const end = new Date(String(endDate).replace(/-/g, '/') + ' 23:59:59');
    const paidStatus = _.in(['paid', 'paid_awaiting_address', 'shipped', 'received']);
    const res = await db
      .collection('orders')
      .where({
        status: paidStatus,
        createTime: _.and(_.gte(start), _.lte(end)),
      })
      .limit(1000)
      .get();
    const map = {};
    (res.data || []).forEach((o) => {
      const key = toKey(o.paidTime || o.createTime);
      if (!key || key < startDate || key > endDate) return;
      map[key] = (map[key] || 0) + this.parseOrderAmount(o);
    });
    return map;
  },

  // 🟢 核心：加载全站统计（本月 = 小程序订单 GMV + 门店账本；二者不混入同一字段）
  async loadStats(offlineTotal = 0) {
    const fmtMoney = (n) => storeLedger.formatMoney(n);
    const emptyPatch = {
      'stats.displayGrand': '0',
      'stats.onlineTotal': '0.00',
      'stats.offlineTotal': fmtMoney(offlineTotal),
      'stats.onlineRatio': 0,
      'stats.offlineRatio': offlineTotal > 0 ? 100 : 0,
      'stats.donutStyle': offlineTotal > 0
        ? 'background: conic-gradient(#52B788 100%, #C4A76C 0);'
        : 'background: #262320;',
      'stats.visitCount': 0,
      'stats.visitCountFmt': '0',
      'stats.orderCount': 0,
      'stats.orderCountFmt': '0',
      'stats.avgOrderFmt': '—',
      'stats.dailyAvgFmt': '—',
      'stats.momLabel': '—',
      'stats.momClass': 'flat',
      'stats.ratioEmpty': offlineTotal <= 0,
      'stats.ordersEmpty': true,
      'trendMeta.momClass': 'flat',
    };
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const prevMonthStart = new Date(startOfMonth);
      prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
      const prevMonthEnd = new Date(startOfMonth.getTime() - 1);
      const prevYm = `${prevMonthStart.getFullYear()}-${String(prevMonthStart.getMonth() + 1).padStart(2, '0')}`;

      const paidStatus = _.in(['paid', 'paid_awaiting_address', 'shipped', 'received']);
      const [orderRes, prevOrderRes, visitRes, prevOfflineRes] = await Promise.all([
        db.collection('orders').where({
          status: paidStatus,
          createTime: _.gte(startOfMonth),
        }).limit(1000).get(),
        db.collection('orders').where({
          status: paidStatus,
          createTime: _.and(_.gte(prevMonthStart), _.lte(prevMonthEnd)),
        }).limit(1000).get(),
        db.collection('bookings').where({ type: 'museum_visit', status: 'used' }).count(),
        storeLedger.sumMonthOffline(storeLedger.FINANCE_STORE_ID, prevYm).catch(() => ({ total: 0 })),
      ]);

      let onlineSales = 0;
      const orders = orderRes.data || [];
      orders.forEach((o) => {
        onlineSales += this.parseOrderAmount(o);
      });
      const orderCount = orders.length;

      let prevOnlineSales = 0;
      (prevOrderRes.data || []).forEach((o) => {
        prevOnlineSales += this.parseOrderAmount(o);
      });
      const prevOffline = Number(prevOfflineRes && prevOfflineRes.total) || 0;
      const prevGrand = prevOnlineSales + prevOffline;
      
      const grandTotal = onlineSales + offlineTotal;
      const onlineRatio = grandTotal > 0 ? ((onlineSales / grandTotal) * 100) : 0;
      const offlineRatio = grandTotal > 0 ? ((offlineTotal / grandTotal) * 100) : 0;
      const dayOfMonth = Math.max(1, new Date().getDate());
      const dailyAvg = grandTotal / dayOfMonth;
      const avgOrder = orderCount > 0 ? onlineSales / orderCount : null;

      let momLabel = '—';
      let momClass = 'flat';
      if (prevGrand > 0) {
        const pct = ((grandTotal - prevGrand) / prevGrand) * 100;
        const rounded = Math.round(pct * 10) / 10;
        momLabel = `${rounded > 0 ? '+' : ''}${rounded}%`;
        momClass = rounded > 0.5 ? 'up' : (rounded < -0.5 ? 'down' : 'flat');
      } else if (grandTotal > 0) {
        momLabel = '新';
        momClass = 'up';
      }

      this.setData({
        'stats.displayGrand': Math.floor(grandTotal).toLocaleString(),
        'stats.onlineTotal': fmtMoney(onlineSales),
        'stats.offlineTotal': fmtMoney(offlineTotal),
        'stats.onlineRatio': onlineRatio.toFixed(0),
        'stats.offlineRatio': offlineRatio.toFixed(0),
        'stats.donutStyle': grandTotal > 0
          ? `background: conic-gradient(#52B788 ${offlineRatio.toFixed(1)}%, #C4A76C 0);`
          : 'background: #262320;',
        'stats.visitCount': visitRes.total || 0,
        'stats.visitCountFmt': String(visitRes.total || 0),
        'stats.orderCount': orderCount,
        'stats.orderCountFmt': String(orderCount),
        'stats.avgOrderFmt': avgOrder != null ? `¥${fmtMoney(avgOrder)}` : '—',
        'stats.dailyAvgFmt': fmtMoney(dailyAvg),
        'stats.momLabel': momLabel,
        'stats.momClass': momClass,
        'stats.ratioEmpty': grandTotal <= 0,
        'stats.ordersEmpty': orderCount <= 0,
        'trendMeta.momClass': momClass,
      });
      this.refreshOpsSignals();
    } catch (e) {
      console.error(e);
      this.setData(emptyPatch);
    }
  },

  // === 营收录入相关（后段「其他通用」会覆盖同名方法；此处保留趋势/删除）===
  deleteRevenue(e) {
      const id = e.currentTarget.dataset.id;
      const date = e.currentTarget.dataset.date;
      wx.showModal({
          title: '删除',
          content: '确定删除该日流水？删除后列表将不再展示该日合并数据。',
          success: async (res) => {
              if (!res.confirm) return;
              if (!date) {
                  wx.showToast({ title: '缺少营业日，无法删除', icon: 'none' });
                  return;
              }
              wx.showLoading({ title: '删除中…', mask: true });
              try {
                  await storeLedger.removeById(id, {
                      date,
                      storeId:
                        this.data.ledgerStoreId || storeLedger.FINANCE_STORE_ID,
                  });
                  wx.hideLoading();
                  wx.showToast({ title: '已删除', icon: 'success' });
                  await this.loadRevenues();
                  const offlineTotal = await this.loadOfflineStats();
                  await this.loadStats(offlineTotal);
              } catch (err) {
                  wx.hideLoading();
                  wx.showToast({
                      title: formatCloudFnError(err, '删除失败'),
                      icon: 'none',
                  });
              }
          },
      });
  },

  _shortMoney(n, compact) {
    const v = Number(n) || 0;
    if (v <= 0) return '';
    const useCompact = compact === true || (compact !== false && v >= 1000);
    if (useCompact) {
      if (v >= 10000) {
        const w = v / 10000;
        return `${w >= 10 ? Math.round(w) : w.toFixed(1).replace(/\.0$/, '')}w`;
      }
      if (v >= 1000) {
        const k = v / 1000;
        return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`;
      }
    }
    if (v >= 10000) return `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}万`;
    if (v >= 1000) return `${Math.round(v)}`;
    return String(Math.round(v));
  },

  // 🟢 加载趋势图：线上=小程序已付 GMV；门店=账本净额（不含 mp；账本 online 不计入「线上」条）
  async loadTrendData() {
    try {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      const pad2 = (n) => String(n).padStart(2, '0');
      const startStr = `${sevenDaysAgo.getFullYear()}-${pad2(sevenDaysAgo.getMonth() + 1)}-${pad2(sevenDaysAgo.getDate())}`;
      const endStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

      const [res, mpMapOrNull] = await Promise.all([
        storeLedger.listFromDate(null, startStr),
        this._fetchMpGmvByDate(startStr, endStr).catch((err) => {
          console.warn('近7日小程序 GMV 拉取失败，回退账本 mpOnline', err);
          return null;
        }),
      ]);

      const recordMap = {};
      (res || []).forEach((r) => {
        const row = storeLedger.ledgerToDisplayRow(r);
        recordMap[row.date] = row;
      });

      const weekMap = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const days = [];
      let weekOnline = 0;
      let weekOffline = 0;
      let peak = 0;

      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        const record = recordMap[dateKey] || { total: 0, mpOnline: 0 };
        // 门店 = 账本净额（可含历史 ledger.online，但不把该字段当作「线上」条）
        const offline = Math.max(0, Number(record.total) || 0);
        const online =
          mpMapOrNull != null
            ? Math.max(0, Number(mpMapOrNull[dateKey]) || 0)
            : Math.max(0, Number(record.mpOnline) || 0);
        const total = online + offline;
        weekOnline += online;
        weekOffline += offline;
        if (total > peak) peak = total;
        days.push({ dateKey, day: weekMap[d.getDay()], online, offline, total });
      }

      this._lastTrendDays = days;
      const layout = this._dashChartLayout || this.data.chartLayout || computeDashChartLayout(0, 0, dashWindowWidth());
      const chart = buildTrendChartEntries(days, (n, c) => this._shortMoney(n, c), layout);

      const weekTotal = weekOnline + weekOffline;
      const pct = (v) => (weekTotal > 0 ? Math.round((v / weekTotal) * 100) : 0);

      this.setData(
        {
          trendData: chart,
          trendMeta: {
            empty: weekTotal <= 0,
            error: false,
            weekTotalFmt: storeLedger.formatMoney(weekTotal),
            weekOnlineFmt: storeLedger.formatMoney(weekOnline),
            weekOfflineFmt: storeLedger.formatMoney(weekOffline),
            weekOnlineBar: `width:${pct(weekOnline)}%`,
            weekOfflineBar: `width:${pct(weekOffline)}%`,
            momClass: this.data.stats.momClass || 'flat',
          },
        },
        () => this.scheduleChartLayout()
      );
    } catch (e) {
      console.error(e);
      this.setData({
        trendMeta: {
          empty: true,
          error: true,
          weekTotalFmt: '0',
          weekOnlineFmt: '0',
          weekOfflineFmt: '0',
          weekOnlineBar: 'width:0%',
          weekOfflineBar: 'width:0%',
          momClass: 'flat',
        },
      });
    }
  },

  /** 看板库存速览：优先复用 productStats，否则拉 manageProducts stats */
  _applyDashStockFromStats(result) {
    if (!result || !result.counts) return;
    const counts = result.counts || {};
    const topCats = (result.categoryRoot || []).slice(0, 3).map((c) => ({
      key: c.key || c.name || '—',
      name: c.key || c.name || '—',
      count: c.count || 0,
      barStyle: `width:${Math.max(4, Number(c.pct) || 0)}%`,
    }));
    const onShelf = Number(counts.onShelf) || 0;
    const offShelf = Number(counts.offShelf) || 0;
    const stockTotal = Number(counts.stockTotal) || 0;
    this.setData({
      dashStock: {
        ready: true,
        loading: false,
        empty: onShelf + offShelf + stockTotal <= 0,
        error: false,
        onShelf,
        offShelf,
        stockTotal,
        lowStockSkus: Number(counts.lowStockSkus) || 0,
        topCats,
      },
    });
    this.refreshOpsSignals();
  },

  toggleOpsLegend() {
    if (!this.data.opsSignalExpanded) return;
    this.setData({ opsLegendOpen: !this.data.opsLegendOpen });
  },

  /** 经营信号整块展开 / 收起（与图例开关独立） */
  toggleOpsSignalBoard() {
    const next = !this.data.opsSignalExpanded;
    const patch = { opsSignalExpanded: next };
    if (!next) patch.opsLegendOpen = false;
    this.setData(patch);
    try {
      wx.setStorageSync(OPS_SIGNAL_EXPAND_KEY, next);
    } catch (e) { /* ignore */ }
  },

  /**
   * 收起态摘要：按灯色严重度取前 3 条短 chip。
   * @param {Array<{id:string,text:string,lamp:string,target:string}>} feed
   */
  buildOpsSignalSummary(feed) {
    const items = (Array.isArray(feed) ? feed : []).slice();
    const rank = (lamp) => {
      const s = String(lamp || '');
      if (s.indexOf('danger') >= 0 || s === 'live') return 0;
      if (s.indexOf('warn') >= 0) return 1;
      return 2;
    };
    items.sort((a, b) => rank(a.lamp) - rank(b.lamp));
    const shortMap = {
      pending: (it) => String(it.text || '').replace(/^待发订单\s*/, '待发 '),
      newOrders: (it) => String(it.text || '').replace(/^新订单(未读|待发货)\s*/, '新单 '),
      wishlist: (it) => String(it.text || '').replace(/^心愿补货\s*/, '心愿 '),
      aftersale: (it) => String(it.text || '').replace(/^售后待处理\s*/, '售后 '),
      support: () => {
        const n = (this.data.supportTickets || []).length;
        return `有信 ${n}`;
      },
      gift: () => `礼赠 ${Number(this.data.giftTodoCount) || 0}`,
      approvals: (it) => String(it.text || '').replace(/^审批待办\s*/, '审批 '),
      invoice: (it) => String(it.text || '').replace(/^发票待开\s*/, '发票 '),
      workOrders: (it) => String(it.text || '').replace(/^工单\s*/, '工单 '),
      recruit: (it) => String(it.text || '').replace(/^合作申请\s*/, '合作 '),
      live: () => '直播中',
      mom: (it) => String(it.text || '').replace(/^营收环比\s*/, '环比 ')
    };
    const chips = items.slice(0, 3).map((it) => {
      const fn = shortMap[it.id];
      const text = fn ? fn(it) : String(it.text || '').slice(0, 12);
      return { id: it.id, text, lamp: it.lamp, target: it.target };
    });
    const attentionCount = items.length;
    return {
      chips,
      attentionCount,
      label: attentionCount === 0 ? '全部健康' : `${attentionCount} 项待关注`,
      worstLamp: chips[0] ? chips[0].lamp : 'on'
    };
  },

  /**
   * 经营信号下方信息流：从 Hub 已加载待办聚合，仅展示需关注项。
   * 数据源：待发/售后、有信、礼赠、审批、发票、工单、合作、直播中、营收环比下降。
   */
  buildOpsInfoFeed() {
    const menu = this.data.menu || {};
    const items = [];
    const pending = (this.data.orders || []).length;
    const newOrderUnread = Number(this.data.newOrderUnreadCount) || 0;
    const wishlistUnread = Number(this.data.wishlistUnreadCount) || 0;
    const counts = this.data.opsOrderCounts || {};
    const aftersale = Number(counts.aftersale) || 0;
    const support = this.data.supportTickets || [];
    const giftTodo = Number(this.data.giftTodoCount) || 0;
    const giftTodos = this.data.giftTodos || {};
    const approval = Number(this.data.approvalPendingCount) || 0;
    const invoice = Number(this.data.invoicePendingCount) || 0;
    const workOrders = (this.data.customOrders || []).length;
    const recruit = (this.data.framerRecruitApps || []).length;
    const live = this.data.liveDash || {};
    const stats = this.data.stats || {};
    const momClass = stats.momClass || 'flat';
    const momLabel = stats.momLabel || '';

    const push = (id, text, lamp, target) => {
      items.push({ id, text, lamp, target });
    };

    if (menu.orders && newOrderUnread > 0) {
      push('newOrders', `新订单待发货 ${newOrderUnread}`, 'danger', 'newOrders');
    }
    if (menu.orders && pending > 0) {
      push('pending', `待发订单 ${pending}`, 'warn', 'pending');
    }
    if ((menu.products || menu.orders) && wishlistUnread > 0) {
      push('wishlist', `心愿补货 ${wishlistUnread}`, 'warn', 'wishlist');
    }
    if (menu.orders && aftersale > 0) {
      push(
        'aftersale',
        `售后待处理 ${aftersale}`,
        aftersale >= 5 ? 'danger' : 'warn',
        'aftersale'
      );
    }
    if (menu.support && support.length > 0) {
      const first = support[0] || {};
      const raw = String(first.content || first.title || first.subject || '').replace(/\s+/g, ' ').trim();
      const snippet = raw.length > 16 ? `${raw.slice(0, 16)}…` : raw;
      push(
        'support',
        snippet ? `有信待回 · ${snippet}` : `有信待回 ${support.length}`,
        'warn',
        'support'
      );
    }
    if ((menu.giftOps || menu.giftManage) && giftTodo > 0) {
      const parts = [];
      if (giftTodos.awaiting_address) parts.push(`待填址 ${giftTodos.awaiting_address}`);
      if (giftTodos.awaiting_ship) parts.push(`待发 ${giftTodos.awaiting_ship}`);
      if (giftTodos.pickup_verify) parts.push(`核销 ${giftTodos.pickup_verify}`);
      push(
        'gift',
        parts.length ? `礼赠 · ${parts.join(' · ')}` : `礼赠待办 ${giftTodo}`,
        giftTodo >= 8 ? 'danger' : 'warn',
        'gift'
      );
    }
    if (menu.approvals && approval > 0) {
      push('approvals', `审批待办 ${approval}`, 'warn', 'approvals');
    }
    if (menu.invoice && invoice > 0) {
      push('invoice', `发票待开 ${invoice}`, 'warn', 'invoice');
    }
    if (menu.workOrders && workOrders > 0) {
      push('workOrders', `工单 ${workOrders}`, 'warn', 'workOrders');
    }
    if (menu.framerRecruit && recruit > 0) {
      push('recruit', `合作申请 ${recruit}`, 'warn', 'recruit');
    }
    if (menu.live && live.statusTone === 'live') {
      const liveTitle = String(live.title || '').trim();
      push(
        'live',
        liveTitle ? `直播中 · ${liveTitle.slice(0, 12)}` : '直播中',
        'danger',
        'live'
      );
    }
    if (menu.dashboardKpi && momClass === 'down' && momLabel && momLabel !== '—') {
      push('mom', `营收环比 ${momLabel}`, 'danger', 'mom');
    }

    return items;
  },

  /** 经营信号灯：履约 / 风险待办 / 环比 / 库存（只读展示，不改权限） */
  /**
   * 工作通知声音（#29）：把当前待办计数快照交给引擎，只播「相比上次新增」的类型。
   *
   * 为什么只在 `prefetchHubTodoBadges` 全部落地后调一次：
   * 各 loader 各自 `refreshOpsSignals()`，若在那里判断声音，先到的单项（其余还是 0）
   * 会在后续计数补齐时被误判成「新增」，每次进工作台都要响一遍。
   *
   * 首次进入只建立基线不出声（见 `utils/workNoticeVoice.js` 的设计要点 1）。
   */
  syncWorkNoticeVoice() {
    try {
      if (!this.data.workspaceReady) return { announced: [], reason: 'not-ready' }
      const role = this.data.workspaceRole || ''
      if (!role) return { announced: [], reason: 'no-role' }
      const snapshot = workNoticeCatalog.buildSnapshot(this.data, role)
      const res = workNoticeVoice.announce(snapshot, role)
      if (res && res.announced && res.announced.length) {
        this._lastVoiceAnnounced = res.announced
      }
      return res
    } catch (e) {
      console.warn('syncWorkNoticeVoice', e)
      return { announced: [], reason: 'error' }
    }
  },

  refreshOpsSignals() {
    const momClass = (this.data.stats && this.data.stats.momClass) || 'flat';
    const stock = this.data.dashStock || {};
    const counts = this.data.opsOrderCounts || {};
    const shipped = Number(counts.shipped) || 0;
    const received = Number(counts.received) || 0;
    const aftersale = Number(counts.aftersale) || 0;
    const refunded = Number(counts.refunded) || 0;
    const giftTodo = Number(this.data.giftTodoCount) || 0;
    const opsInfoFeed = this.buildOpsInfoFeed();
    // 双段副本 + CSS -50% translate：有内容即跑马灯（含单条短文案，避免静止贴脸）
    const hasFeed = opsInfoFeed.length > 0;
    const opsInfoFeedSets = hasFeed ? [opsInfoFeed, opsInfoFeed] : [];
    // 旧字段保留：扁平双份列表（若他处仍读）
    const opsInfoFeedLoop = hasFeed
      ? opsInfoFeed.concat(opsInfoFeed.map((it) => ({ ...it, id: `${it.id}__loop` })))
      : [];
    const opsInfoFeedAnimSec = hasFeed
      ? Math.min(42, Math.max(14, opsInfoFeed.length * 5))
      : 0;
    const opsSignalSummary = this.buildOpsSignalSummary(opsInfoFeed);
    this.setData({
      opsSignals: {
        orders: countLamp((this.data.orders || []).length),
        shipped: fulfillmentLamp(shipped),
        received: receivedLamp(received),
        aftersale: countLamp(aftersale, { warnAt: 1, errorAt: 5 }),
        refunded: refundStockLamp(refunded, received),
        support: countLamp((this.data.supportTickets || []).length),
        workOrders: countLamp((this.data.customOrders || []).length),
        recruit: countLamp((this.data.framerRecruitApps || []).length),
        gift: countLamp(giftTodo, { warnAt: 1, errorAt: 8 }),
        mom: momLamp(momClass),
        stock: stockReadyLamp(stock)
      },
      opsInfoFeed,
      opsInfoFeedSets,
      opsInfoFeedLoop,
      opsInfoFeedAnimSec,
      opsInfoFeedAnimStyle: opsInfoFeedAnimSec ? `animation-duration:${opsInfoFeedAnimSec}s;` : '',
      opsSignalSummary
    });
  },

  /** Hub 礼赠待办角标：与 gift-manage / listBoard counts 同源（getSettings.stats） */
  async loadGiftHubBadge() {
    if (!this.data.menu || !(this.data.menu.giftOps || this.data.menu.giftManage)) {
      this.setData({ giftTodoCount: 0 });
      this.refreshOpsSignals();
      return;
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: { action: 'getSettings' }
      });
      const result = (res && res.result) || {};
      if (!result.success) return;
      const stats = result.stats || {};
      const todos = stats.todos || {};
      const awaiting_address = Number(todos.awaiting_address) || 0;
      const awaiting_ship = Number(todos.awaiting_ship) || 0;
      const pickup_verify = Number(todos.pickup_verify) || 0;
      const todoTotal =
        Number(stats.todoTotal) ||
        awaiting_address + awaiting_ship + pickup_verify;
      this.setData({
        giftTodoCount: todoTotal,
        giftTodos: { awaiting_address, awaiting_ship, pickup_verify }
      });
      this.refreshOpsSignals();
    } catch (err) {
      console.warn('loadGiftHubBadge', err);
    }
  },

  /** Hub 审批待办角标 */
  async loadApprovalHubBadge() {
    if (!this.data.menu || !this.data.menu.approvals) {
      this.setData({ approvalPendingCount: 0 });
      this.refreshOpsSignals();
      return;
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageApprovals',
        data: { action: 'countPending' }
      });
      const result = (res && res.result) || {};
      if (!result.success) return;
      const n = Number(result.count != null ? result.count : result.pendingCount) || 0;
      this.setData({ approvalPendingCount: n });
      this.refreshOpsSignals();
    } catch (err) {
      console.warn('loadApprovalHubBadge', err);
    }
  },

  /** Hub 发票待开具角标 */
  async loadInvoiceHubBadge() {
    if (!this.data.menu || !this.data.menu.invoice) {
      this.setData({ invoicePendingCount: 0 });
      this.refreshOpsSignals();
      return;
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageInvoiceRequests',
        data: { action: 'overview' }
      });
      const result = (res && res.result) || {};
      if (!result.success) return;
      const n = Number(
        (result.pending && result.pending.count) != null
          ? result.pending.count
          : (result.status && result.status.pending)
      ) || 0;
      this.setData({ invoicePendingCount: n });
      this.refreshOpsSignals();
    } catch (err) {
      console.warn('loadInvoiceHubBadge', err);
    }
  },

  /** 超管 / 店长：新订单未读角标 + 弹窗（同一订单本地已弹过不重复狂弹） */
  canReceiveNewOrderAlerts() {
    const role = this.data.workspaceRole;
    return (
      role === WORKSPACE_SUPER_ADMIN ||
      role === WORKSPACE_STORE_MANAGER ||
      !!(this.data.menu && this.data.menu.orders)
    );
  },

  _readAlertShownIds(storageKey) {
    try {
      const raw = wx.getStorageSync(storageKey);
      if (Array.isArray(raw)) return raw.map(String);
      if (raw && typeof raw === 'object') return Object.keys(raw);
    } catch (e) {
      // ignore
    }
    return [];
  },

  _markAlertShownIds(storageKey, ids) {
    const prev = this._readAlertShownIds(storageKey);
    const set = {};
    prev.concat(ids || []).forEach((id) => {
      if (id) set[String(id)] = true;
    });
    // 只保留最近 80 条，避免本地膨胀
    const next = Object.keys(set).slice(-80);
    try {
      wx.setStorageSync(storageKey, next);
    } catch (e) {
      // ignore
    }
  },

  async loadNewOrderAlerts(options = {}) {
    if (!this.canReceiveNewOrderAlerts() || !(this.data.menu && this.data.menu.orders)) {
      this.setData({ newOrderUnreadCount: 0, newOrderUnreadIds: [] });
      this.refreshOpsSignals();
      return;
    }
    try {
      // 订阅授权必须在用户 tap 中发起（见 enableStaffOrderWxNotify / onOrdersMenuTap）
      // 此处不再调用 requestSubscribeMessage，避免无手势导致静默失败

      const res = await wx.cloud.callFunction({
        name: 'getUserMessages',
        data: {
          action: 'getMessages',
          category: 'ops',
          queue: 'workflow',
          type: STAFF_ORDER_MSG_TYPE,
          page: 0,
          pageSize: 30
        }
      });
      const result = (res && res.result) || {};
      if (!result.success) return;
      const messages = Array.isArray(result.messages) ? result.messages : [];
      const unread = messages.filter((m) => m && m.read !== true);
      const count = unread.length;
      this.setData({
        newOrderUnreadCount: count,
        newOrderUnreadIds: unread.map((m) => String((m && (m._id || m.id)) || '')).filter(Boolean)
      });
      this.refreshOpsSignals();
      if (options.showPopup && count > 0) {
        this.maybeShowNewOrderPopup(unread);
      }
    } catch (err) {
      console.warn('loadNewOrderAlerts', err);
    }
  },

  maybeShowNewOrderPopup(unreadList) {
    if (this._newOrderPopupShowing) return;
    const role = this.data.workspaceRole;
    if (role !== WORKSPACE_SUPER_ADMIN && role !== WORKSPACE_STORE_MANAGER) return;

    const shown = this._readAlertShownIds(NEW_ORDER_ALERT_SHOWN_KEY);
    const shownSet = {};
    shown.forEach((id) => {
      shownSet[id] = true;
    });
    const fresh = (unreadList || []).filter((m) => {
      const key = String((m && (m.relatedId || m._id)) || '');
      return key && !shownSet[key];
    });
    if (!fresh.length) return;

    const latest = fresh[0];
    const n = fresh.length;
    const title = n === 1 ? '新订单待发货' : `${n} 笔新订单待处理`;
    const bodyRaw =
      (latest && latest.content) ||
      (latest && latest.title) ||
      '有新的已支付订单，请尽快安排发货。';
    const body = String(bodyRaw)
      .replace(/\n+/g, ' · ')
      .replace(/\s+/g, ' ')
      .trim();
    const content =
      n === 1
        ? `${body}\n点击「去处理」打开订单管理。`
        : `最近一笔：${body}\n另有 ${n - 1} 笔未读，请尽快处理。`;

    this._newOrderPopupShowing = true;
    this._markAlertShownIds(
      NEW_ORDER_ALERT_SHOWN_KEY,
      fresh.map((m) => m.relatedId || m._id)
    );

    try {
      wx.vibrateShort({ type: 'medium' });
    } catch (e) {
      // ignore
    }

    wx.showModal({
      title,
      content: String(content).slice(0, 160),
      confirmText: '去处理',
      cancelText: '稍后',
      confirmColor: '#C4A76C',
      success: (r) => {
        this._newOrderPopupShowing = false;
        // showModal 确认为用户手势，可攒订阅额度
        requestStaffOrderSubscribe().catch(() => null);
        if (r.confirm) {
          this.acknowledgeNewOrdersAndGo(fresh);
        }
      },
      fail: () => {
        this._newOrderPopupShowing = false;
      }
    });
  },

  async acknowledgeNewOrdersAndGo(messages) {
    await this.markStaffOpsMessagesRead(messages, STAFF_ORDER_MSG_TYPE);
    this.setData({ newOrderUnreadCount: 0 });
    this.refreshOpsSignals();
    if (!canAccessManagerTab(this.data.workspaceRole, 2)) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    wx.vibrateShort({ type: 'light' });
    goManagerModule(2, '订单管理');
  },

  async markStaffOpsMessagesRead(messages, type) {
    const list = Array.isArray(messages) ? messages : [];
    if (list.length) {
      await Promise.all(
        list.map((m) =>
          wx.cloud
            .callFunction({
              name: 'getUserMessages',
              data: { action: 'markRead', messageId: m._id }
            })
            .catch(() => null)
        )
      );
      return;
    }
    await wx.cloud
      .callFunction({
        name: 'getUserMessages',
        data: { action: 'markAllRead', category: 'ops', queue: 'workflow', type }
      })
      .catch(() => null);
  },

  async onOrdersMenuTap(e) {
    wx.vibrateShort({ type: 'light' });
    // 用户点击同步栈：攒一次新订单微信通知额度
    requestStaffOrderSubscribe().catch(() => null);
    if (this.data.newOrderUnreadCount > 0) {
      await this.markStaffOpsMessagesRead([], STAFF_ORDER_MSG_TYPE);
      this.setData({ newOrderUnreadCount: 0 });
      this.refreshOpsSignals();
    }
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    const title = e.currentTarget.dataset.title || '订单管理';
    if (!canAccessManagerTab(this.data.workspaceRole, idx)) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    goManagerModule(idx, title);
  },

  /**
   * 工作台显式入口：开启/续订「订单 + 工单」微信服务通知（需求 16）。
   * 用 requestStaffAllSubscribe 一次攒齐全部模板额度，避免为每个工单类别各弹一次授权。
   */
  enableStaffOrderWxNotify() {
    wx.vibrateShort({ type: 'light' });
    requestStaffAllSubscribe({ showTip: true }).catch(() => null);
  },

  /**
   * 需求 16：进入「工作信息」时才补攒工单类额度。
   * 刻意不放在 onShow / 异步回调里 —— 微信要求 requestSubscribeMessage 在用户点击同步栈内。
   */
  enableWorkOrderWxNotify() {
    wx.vibrateShort({ type: 'light' });
    requestStaffAllSubscribe({ showTip: true }).catch(() => null);
  },

  async loadWishlistAlerts() {
    if (!(this.data.menu && (this.data.menu.products || this.data.menu.orders))) {
      this.setData({ wishlistUnreadCount: 0 });
      this.refreshOpsSignals();
      return;
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserMessages',
        data: {
          action: 'getUnreadCount',
          category: 'ops',
          queue: 'workflow',
          type: WISHLIST_MSG_TYPE
        }
      });
      const result = (res && res.result) || {};
      if (!result.success) return;
      const n = Number(result.count) || 0;
      this.setData({ wishlistUnreadCount: n });
      this.refreshOpsSignals();
    } catch (err) {
      console.warn('loadWishlistAlerts', err);
    }
  },

  /**
   * 经营信号订单计数：与「待发订单」同口径 = 当前 status 快照（无今日/近 N 日窗）
   * shipped / received / refunding|aftersales / refunded
   */
  async loadOpsOrderCounts() {
    if (!this.data.menu || !this.data.menu.orders) {
      this.refreshOpsSignals();
      return;
    }
    try {
      const [shippedRes, receivedRes, aftersaleRes, refundedRes] = await Promise.all([
        db.collection('orders').where({ status: 'shipped' }).count(),
        db.collection('orders').where({ status: 'received' }).count(),
        db.collection('orders').where({ status: _.in(['refunding', 'aftersales', 'expired_refunding']) }).count(),
        db.collection('orders').where({ status: 'refunded' }).count()
      ]);
      this.setData({
        opsOrderCounts: {
          shipped: (shippedRes && shippedRes.total) || 0,
          received: (receivedRes && receivedRes.total) || 0,
          aftersale: (aftersaleRes && aftersaleRes.total) || 0,
          refunded: (refundedRes && refundedRes.total) || 0
        }
      });
    } catch (err) {
      console.warn('loadOpsOrderCounts', err);
    } finally {
      this.refreshOpsSignals();
    }
  },

  /** 经营信号 / 信息流 → 对应模块（订单 Tab / 有信 / 工单 / 合作 / 礼赠 / 审批等） */
  goOpsSignal(e) {
    const target = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.target) || '');
    const menu = this.data.menu || {};

    if (target === 'support') {
      if (!menu.support || !canAccessManagerTab(this.data.workspaceRole, 11)) {
        wx.showToast({ title: '无此功能权限', icon: 'none' });
        return;
      }
      wx.vibrateShort({ type: 'light' });
      goManagerModule(11, '山海有信');
      return;
    }
    if (target === 'workOrders') {
      if (!menu.workOrders || !canAccessManagerTab(this.data.workspaceRole, 10)) {
        wx.showToast({ title: '无此功能权限', icon: 'none' });
        return;
      }
      wx.vibrateShort({ type: 'light' });
      // 需求 16：进入工单的自然入口，就地在用户点击同步栈内攒工单类服务通知额度。
      // 与订单类共用一次授权（requestStaffAllSubscribe），避免用户被多次弹窗。
      requestStaffAllSubscribe().catch(() => null);
      goManagerModule(10, '工单');
      return;
    }
    if (target === 'recruit') {
      if (!menu.framerRecruit || !canAccessManagerTab(this.data.workspaceRole, 14)) {
        wx.showToast({ title: '无此功能权限', icon: 'none' });
        return;
      }
      wx.vibrateShort({ type: 'light' });
      goManagerModule(14, '标本师合作');
      return;
    }
    if (target === 'gift') {
      if (!(menu.giftOps || menu.giftManage)) {
        wx.showToast({ title: '无此功能权限', icon: 'none' });
        return;
      }
      wx.vibrateShort({ type: 'light' });
      // 信号灯一律进履约看板（配置页另有独立入口）
      if (menu.giftOps) goGiftOps();
      else goGiftManage();
      return;
    }
    if (target === 'approvals') {
      if (!menu.approvals) {
        wx.showToast({ title: '无此功能权限', icon: 'none' });
        return;
      }
      wx.vibrateShort({ type: 'light' });
      goApprovals();
      return;
    }
    if (target === 'invoice') {
      if (!menu.invoice) {
        wx.showToast({ title: '无此功能权限', icon: 'none' });
        return;
      }
      wx.vibrateShort({ type: 'light' });
      goInvoiceRequests();
      return;
    }
    if (target === 'live') {
      if (!menu.live) {
        wx.showToast({ title: '无此功能权限', icon: 'none' });
        return;
      }
      wx.vibrateShort({ type: 'light' });
      if (typeof this.goLiveStudio === 'function') this.goLiveStudio();
      return;
    }
    if (target === 'mom') {
      if (menu.analytics && canAccessManagerTab(this.data.workspaceRole, 13)) {
        wx.vibrateShort({ type: 'light' });
        goManagerModule(13, '数据报表');
        return;
      }
      if (menu.ledger && canAccessManagerTab(this.data.workspaceRole, 8)) {
        wx.vibrateShort({ type: 'light' });
        goManagerModule(8, '营收账本');
        return;
      }
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    if (target === 'stock') {
      if (!menu.products || !canAccessManagerTab(this.data.workspaceRole, 1)) {
        wx.showToast({ title: '无此功能权限', icon: 'none' });
        return;
      }
      wx.vibrateShort({ type: 'light' });
      goManagerModule(1, '藏品库');
      return;
    }
    if (target === 'newOrders') {
      this.onOrdersMenuTap({
        currentTarget: { dataset: { idx: 2, title: '订单管理' } }
      });
      return;
    }
    if (target === 'wishlist') {
      if (!menu.products || !canAccessManagerTab(this.data.workspaceRole, 1)) {
        wx.showToast({ title: '无此功能权限', icon: 'none' });
        return;
      }
      if (this.data.wishlistUnreadCount > 0) {
        this.markStaffOpsMessagesRead([], WISHLIST_MSG_TYPE).then(() => {
          this.setData({ wishlistUnreadCount: 0 });
          this.refreshOpsSignals();
        });
      }
      wx.vibrateShort({ type: 'light' });
      goManagerModule(1, '藏品库');
      return;
    }

    if (!menu.orders) return;
    if (!canAccessManagerTab(this.data.workspaceRole, 2)) {
      wx.showToast({ title: '无此功能权限', icon: 'none' });
      return;
    }
    // 0 待发 / 1 已发 / 2 已完成(签收) / 3 售后
    const subMap = {
      pending: 0,
      shipped: 1,
      received: 2,
      aftersale: 3,
      refunded: 3,
      pendingPay: 4
    };
    if (!Object.prototype.hasOwnProperty.call(subMap, target)) return;
    wx.vibrateShort({ type: 'light' });
    goManagerModule(2, '订单管理', `subTab=${subMap[target]}`);
  },

  async loadDashboardStock() {
    if (!this.data.menu || !this.data.menu.products) return;
    const now = Date.now();
    if (
      this._dashStockAt &&
      now - this._dashStockAt < 60000 &&
      this.data.dashStock &&
      this.data.dashStock.ready &&
      !this.data.dashStock.error
    ) {
      return;
    }
    // 有缓存先上屏，再拉云端刷新
    if (this.data.productStats && this.data.productStats.counts && !(this.data.dashStock && this.data.dashStock.ready)) {
      this._applyDashStockFromStats(this.data.productStats);
    }
    this.setData({ 'dashStock.loading': true, 'dashStock.error': false });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageProducts',
        data: { action: 'stats', trendDays: 7 },
      });
      const result = (res && res.result) || {};
      if (!result.success) throw new Error(result.msg || '统计失败');
      this._applyDashStockFromStats(result);
      this._dashStockAt = Date.now();
      const cost = result.cost || {};
      const fmt = (n) => Number(n || 0).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
      this.setData({
        productStats: {
          ...result,
          cost: {
            ...cost,
            displayOverstock: fmt(cost.estimatedOverstock),
            displayRecent: fmt(cost.recentOverstock),
            displayArchive: fmt(cost.archiveOverstock),
            recentRatio: Number(cost.recentRatio) || 0,
            missingCostItems: Number(cost.missingCostItems) || 0,
            missingCostStock: Number(cost.missingCostStock) || 0,
          },
        },
      });
    } catch (err) {
      console.warn('loadDashboardStock', err);
      if (this.data.dashStock && this.data.dashStock.ready) {
        this.setData({ 'dashStock.loading': false });
        return;
      }
      this.setData({
        dashStock: {
          ready: false,
          loading: false,
          empty: true,
          error: true,
          onShelf: 0,
          offShelf: 0,
          stockTotal: 0,
          topCats: [],
        },
      });
    }
  },
  
  // === 装修 (Banner) ===
  async loadBanners() {
    try {
      const res = await db.collection('banners').orderBy('sort', 'desc').get();
      this.setData({ banners: res.data || [] });
    } catch (e) {
      console.error('loadBanners', e);
      this.setData({ banners: [] });
      wx.showToast({ title: '轮播加载失败', icon: 'none' });
    }
  },
  openBannerModal(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const id = ds.id || (ds.item && ds.item._id) || '';
    const fromList = id
      ? (this.data.banners || []).find((b) => b._id === id)
      : null;
    const item = fromList || ds.item || null;
    const blank = {
      image: '', title: '', subtitle: '', btnText: '立即查看',
      type: 'product', target: '', targetName: '', link: '', sort: 100, enabled: true
    };
    let type = (item && item.type) || 'product';
    if (type === 'page' || type === 'path') type = 'scheme';
    const target = item
      ? (item.target || item.link || '')
      : '';
    this.setData({
      showBannerModal: true,
      isEditing: !!(item && (item._id || id)),
      editId: (item && item._id) || id || '',
      schemePresetIndex: type === 'scheme' ? matchSchemePresetIndex(target) : 0,
      tempBanner: item
        ? {
            image: item.image || '',
            title: item.title || '',
            subtitle: item.subtitle || '',
            btnText: item.btnText || '立即查看',
            type,
            target,
            targetName: item.targetName || '',
            link: item.link || '',
            sort: item.sort != null ? item.sort : 100,
            enabled: item.enabled !== false
          }
        : blank
    });
  },
  chooseBannerImage() {
    wx.chooseImage({
      count: 1,
      success: (res) => {
        const path = res.tempFilePaths && res.tempFilePaths[0];
        if (!path) return;
        this.setData({ 'tempBanner.image': path });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') === -1) {
          wx.showToast({ title: '选图失败', icon: 'none' });
        }
      }
    });
  },
  bindBInput(e) { this.setData({ [`tempBanner.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  bindBEnabledChange(e) {
    this.setData({ 'tempBanner.enabled': !!(e.detail && e.detail.value) });
  },
  bindBTypeChange(e) {
    const type = e.detail.value;
    const patch = { 'tempBanner.type': type };
    if (type === 'booking') {
      patch['tempBanner.target'] = '';
      patch['tempBanner.link'] = '';
    } else if (type === 'scheme') {
      const preset = SCHEME_PRESETS[this.data.schemePresetIndex] || SCHEME_PRESETS[0];
      if (preset && preset.path) patch['tempBanner.target'] = preset.path;
    }
    this.setData(patch);
  },
  onBannerSchemePreset(e) {
    const idx = Number(e.detail.value) || 0;
    const preset = SCHEME_PRESETS[idx] || SCHEME_PRESETS[0];
    const patch = { schemePresetIndex: idx };
    if (preset && preset.path) patch['tempBanner.target'] = preset.path;
    this.setData(patch);
  },
  bindBSchemePath(e) {
    const path = e.detail.value || '';
    this.setData({
      'tempBanner.target': path,
      schemePresetIndex: matchSchemePresetIndex(path)
    });
  },
  async submitBanner() {
    const b = this.data.tempBanner || {};
    if (!b.image || !String(b.title || '').trim()) {
      return wx.showToast({ title: '请填写图片和标题', icon: 'none' });
    }
    const type = b.type || 'product';
    if ((type === 'product' || type === 'category') && !String(b.target || '').trim()) {
      return wx.showToast({ title: type === 'product' ? '请填写藏品ID' : '请填写分类关键词', icon: 'none' });
    }
    if (type === 'scheme') {
      const v = validateSchemePath(b.target);
      if (!v.ok) return wx.showToast({ title: v.message, icon: 'none' });
    }
    wx.showLoading({ title: '发布中…', mask: true });
    try {
      let img = String(b.image);
      if (!img.startsWith('cloud') && !/^https?:\/\//i.test(img)) {
        const up = await wx.cloud.uploadFile({
          cloudPath: `banners/${Date.now()}.png`,
          filePath: img
        });
        img = up.fileID;
      }
      let target = type === 'booking' ? '' : String(b.target || '').trim();
      if (type === 'scheme') {
        const v = validateSchemePath(target);
        target = v.path;
      }
      const link = buildBannerLinkForSave(type, target);
      // 禁止把 _id / _openid 等系统字段塞进 update/add，否则云库会拒写且旧逻辑无 catch → 卡住无反馈
      const data = {
        image: img,
        title: String(b.title).trim(),
        subtitle: b.subtitle || '',
        btnText: b.btnText || '立即查看',
        type,
        target,
        targetName: b.targetName || '',
        link,
        sort: parseInt(b.sort, 10) || 0,
        enabled: b.enabled !== false,
        updateTime: Date.now()
      };
      const editId = this.data.editId;
      if (this.data.isEditing && editId) {
        await callStoreContent({ action: 'upsert', collection: 'banners', id: editId, data });
      } else {
        data.createTime = Date.now();
        await callStoreContent({ action: 'upsert', collection: 'banners', data });
      }
      wx.hideLoading();
      wx.showToast({ title: '已发布', icon: 'success' });
      this.setData({ showBannerModal: false });
      this.loadBanners();
    } catch (e) {
      console.error('submitBanner', e);
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(e, '发布失败'), icon: 'none' });
    }
  },
  deleteBanner(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return wx.showToast({ title: '缺少海报 ID', icon: 'none' });
    wx.showModal({
      title: '删除',
      content: '确定删除该轮播海报？',
      confirmColor: '#D64045',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中…', mask: true });
        try {
          await callStoreContent({ action: 'remove', collection: 'banners', id });
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadBanners();
        } catch (err) {
          console.error('deleteBanner', err);
          wx.hideLoading();
          wx.showToast({ title: formatCloudFnError(err, '删除失败'), icon: 'none' });
        }
      }
    });
  },

  // === 核销（走 verifyBooking 云函数，禁止客户端直写 bookings）===
  async loadBookings() { const res = await db.collection('bookings').where({ status: 'confirmed' }).orderBy('createTime', 'desc').limit(50).get(); this.setData({ bookings: res.data }); },
  verifyBooking(e) {
    const id = e.currentTarget.dataset.id;
    this.verifyBookingByRef(id, '');
  },
  verifyBookingByRef(bookingId, ticketCode) {
    const id = String(bookingId || '').trim();
    const code = String(ticketCode || '').trim();
    if (!id && !code) {
      wx.showToast({ title: '未识别到票号', icon: 'none' });
      return;
    }
    wx.vibrateShort({ type: 'heavy' });
    wx.showModal({
      title: '确认核销', content: '确认该访客已入场？', confirmColor: '#C4A76C',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '核销中…', mask: true });
        try {
          const call = await wx.cloud.callFunction({
            name: 'verifyBooking',
            data: {
              bookingId: id || undefined,
              ticketCode: code || undefined
            }
          });
          wx.hideLoading();
          const result = (call && call.result) || {};
          if (!result.success) {
            wx.showModal({
              title: '无法核销',
              content: formatCloudFnError(result, result.msg || '核销失败'),
              showCancel: false,
              confirmColor: '#C4A76C'
            });
            return;
          }
          this.setData({ showVerifySuccess: true });
          this.loadBookings();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: formatCloudFnError(err, '核销失败'), icon: 'none' });
        }
      }
    });
  },
  closeVerifyModal() { this.setData({ showVerifySuccess: false }); },
  handleScan() {
    wx.scanCode({
      scanType: ['qrCode'],
      success: (res) => {
        const raw = (res && res.result) || '';
        const member = parseMemberPassScan(raw);
        if (member) {
          this.verifyMemberPassScan(member);
          return;
        }
        if (!raw) {
          wx.showToast({ title: '未识别到内容', icon: 'none' });
          return;
        }
        const bookingUri = String(raw).match(/^BOOKING:([^:]+)(?::|$)/i);
        if (bookingUri) {
          this.verifyBookingByRef('', bookingUri[1].trim());
          return;
        }
        this.verifyBookingByRef(raw, '');
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') === -1) {
          wx.showToast({ title: '扫码失败', icon: 'none' });
        }
      }
    });
  },
  async verifyMemberPassScan(payload) {
    wx.showLoading({ title: '核验中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getMemberPass',
        data: { action: 'verify', token: payload.token, memberNo: payload.memberNo || '' }
      });
      wx.hideLoading();
      const result = res.result || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || '核验失败', icon: 'none' });
        return;
      }
      const perks = result.valid
        ? collectCurrentPerkItems(LEVEL_BENEFITS, result.level || 1)
        : [];
      this.setData({
        showMemberPassResult: true,
        memberPassResult: {
          valid: !!result.valid,
          expired: !!result.expired,
          msg: result.msg || (result.valid ? '核验通过' : '核验未通过'),
          memberNo: result.memberNo || payload.memberNo || '',
          nickName: result.nickName || '',
          levelName: result.levelName || '',
          discountText: formatDiscount(result.discountRate),
          perks
        }
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(e, '核验失败'), icon: 'none' });
    }
  },
  closeMemberPassResult() {
    this.setData({ showMemberPassResult: false });
  },

  // === 藏品 ===
  async loadProductStats() {
    this.setData({ productStatsLoading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageProducts',
        data: {
          action: 'stats',
          trendDays: this.data.productStatsTrendDays || 7
        }
      });
      const result = (res && res.result) || {};
      if (!result.success) throw new Error(result.msg || '统计失败');
      const cost = result.cost || {};
      const fmt = (n) => Number(n || 0).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      });
      result.cost = {
        ...cost,
        displayOverstock: fmt(cost.estimatedOverstock),
        displayRecent: fmt(cost.recentOverstock),
        displayArchive: fmt(cost.archiveOverstock),
        recentRatio: Number(cost.recentRatio) || 0,
        missingCostItems: Number(cost.missingCostItems) || 0,
        missingCostStock: Number(cost.missingCostStock) || 0
      };
      this.setData({ productStats: result });
      this._applyDashStockFromStats(result);
    } catch (err) {
      console.warn('loadProductStats', err);
      wx.showToast({ title: formatCloudFnError(err, '统计加载失败'), icon: 'none' });
    } finally {
      this.setData({ productStatsLoading: false });
    }
  },
  setProductStatsTrend(e) {
    const days = Number(e.currentTarget.dataset.days) === 30 ? 30 : 7;
    this.setData({ productStatsTrendDays: days }, () => this.loadProductStats());
  },
  async loadProducts(opts = {}) {
    const append = !!(opts && opts.append);
    if (this.data.productListLoading || (append && this.data.productLoadingMore)) return;
    if (append && !this.data.productHasMore) return;

    const page = append ? (Number(this.data.productPage) || 1) + 1 : 1;
    const pageSize = Number(this.data.productPageSize) || 50;
    this.setData(append
      ? { productLoadingMore: true }
      : { productListLoading: true, productPage: 1, productHasMore: false });
    if (!append) wx.showLoading({ title: '加载藏品…' });

    try {
      const listData = {
        action: 'list',
        page,
        pageSize,
        keyword: String(this.data.searchVal || '').trim(),
        archiveFilter: this.data.productArchiveFilter || 'all',
        promoFilter: this.data.productPromoFilter || 'all',
        sortBy: this.data.productSort || 'new'
      };
      if (
        this.data.artisanEmbed ||
        this.data.workspaceRole === WORKSPACE_SPECIMEN_ARTISAN
      ) {
        listData.mineOnly = true;
        listData.linkBackfill = true;
        const fid = String(this.data.artisanFramerId || '').trim();
        if (fid) listData.framerId = fid;
      }
      const res = await wx.cloud.callFunction({
        name: 'manageProducts',
        data: listData
      });
      const result = (res && res.result) || {};
      if (!result.success) throw new Error(result.msg || '加载失败');

      const mapped = (result.list || []).map((p) => {
        let rate = '0.0';
        if (p.price && p.price != 0 && p.costPrice) {
          const pr = parseFloat(p.price);
          const cp = parseFloat(p.costPrice);
          if (!isNaN(pr) && !isNaN(cp) && pr !== 0) rate = ((pr - cp) / pr * 100).toFixed(1);
        }
        const sold = Number(p.soldCount);
        const shelfWm = resolveProductShelfWatermark(p);
        return {
          ...p,
          profitRate: rate,
          soldCountDisplay: Number.isFinite(sold) && sold >= 0 ? sold : (Number(p.sales) || 0),
          shelfApprovalStatus: shelfWm.status,
          shelfWm: shelfWm.text,
          shelfWmClass: shelfWm.className,
          craftTypeLabel: craftTypeLabel(p.craftType) || '',
          craftProcessLabel: craftProcessLabel(p.craftProcess) || ''
        };
      });

      const products = append ? (this.data.products || []).concat(mapped) : mapped;
      const total = Number(result.total) || 0;
      const hasMore = products.length < total;

      const patch = {
        // 缩略图：云文件 ID 必须换 https（_subviews.wxml 直绑 images[0]，否则全部渲染不出）
        products: products.map((it) => (it ? {
          ...it,
          images: (Array.isArray(it.images) ? it.images : []).map((u) => imageUrl.thumbUrl(u))
        } : it)),
        productPage: page,
        productTotal: total,
        productHasMore: hasMore
      };
      if (!append && !this.data.artisanEmbed) {
        // 过期秒杀数走全量筛选 total，不依赖当前页
        try {
          const expRes = await wx.cloud.callFunction({
            name: 'manageProducts',
            data: { action: 'list', page: 1, pageSize: 1, promoFilter: 'seckill_expired' }
          });
          const exp = (expRes && expRes.result) || {};
          patch.expiredSeckillCount = exp.success ? (Number(exp.total) || 0) : 0;
        } catch (e) {
          patch.expiredSeckillCount = 0;
        }
      }
      this.setData(patch);
    } catch (err) {
      console.warn('loadProducts', err);
      wx.showToast({ title: formatCloudFnError(err, '加载藏品失败'), icon: 'none' });
      if (!append) this.setData({ products: [], productTotal: 0, productHasMore: false });
    } finally {
      if (!append) wx.hideLoading();
      this.setData({ productListLoading: false, productLoadingMore: false });
    }
  },

  loadMoreProducts() {
    this.loadProducts({ append: true });
  },

  _buildPriceSortLabel(sortKey) {
    if (sortKey === 'price_asc') return '价格↑';
    if (sortKey === 'price_desc') return '价格↓';
    return '价格';
  },

  setProductSort(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset.key) || 'new';
    let next = key;
    if (key === 'price') {
      if (this.data.productSort === 'price_asc') next = 'price_desc';
      else if (this.data.productSort === 'price_desc') next = 'price_asc';
      else next = 'price_asc';
    } else if (key === this.data.productSort) {
      return;
    }
    this.setData({
      productSort: next,
      productPriceSortLabel: this._buildPriceSortLabel(next)
    });
    this.loadProducts();
  },

  onSearchInput(e) {
    this.setData({ searchVal: e.detail.value });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.loadProducts(); }, 500);
  },
  setProductArchiveFilter(e) {
    const val = e.currentTarget.dataset.val || 'all';
    if (val === 'all') {
      this.setData({ productArchiveFilter: 'all', productPromoFilter: 'all' });
    } else {
      this.setData({ productArchiveFilter: val });
    }
    this.loadProducts();
  },
  setProductPromoFilter(e) {
    const val = e.currentTarget.dataset.val || 'all';
    this.setData({
      productPromoFilter: val,
      productArchiveFilter: this.data.productArchiveFilter === 'all' ? 'all' : this.data.productArchiveFilter
    });
    this.loadProducts();
  },
  async clearExpiredSeckill() {
    wx.showLoading({ title: '扫描过期秒杀…' });
    try {
      const ids = [];
      let page = 1;
      const pageSize = 100;
      let total = Infinity;
      while (ids.length < total && page <= 50) {
        const res = await wx.cloud.callFunction({
          name: 'manageProducts',
          data: { action: 'list', page, pageSize, promoFilter: 'seckill_expired' }
        });
        const result = (res && res.result) || {};
        if (!result.success) throw new Error(result.msg || '扫描失败');
        total = Number(result.total) || 0;
        const batch = (result.list || []).map((p) => p._id).filter(Boolean);
        ids.push(...batch);
        if (!batch.length || ids.length >= total) break;
        page += 1;
      }
      wx.hideLoading();
      if (!ids.length) return wx.showToast({ title: '无过期秒杀', icon: 'none' });

      const ok = await new Promise((resolve) => {
        wx.showModal({
          title: '清理过期秒杀',
          content: `将关闭 ${ids.length} 件藏品的过期秒杀，是否继续？`,
          success: (r) => resolve(!!r.confirm)
        });
      });
      if (!ok) return;

      wx.showLoading({ title: '清理中…' });
      let cleared = 0;
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const res = await wx.cloud.callFunction({
          name: 'manageProducts',
          data: { action: 'clearExpiredSeckill', productIds: chunk }
        });
        const result = (res && res.result) || {};
        if (!result.success) throw new Error(result.msg || '清理失败');
        cleared += Number(result.ok) || chunk.length;
      }
      wx.showToast({ title: `已清理 ${cleared} 件`, icon: 'none' });
      this.loadProducts();
    } catch (err) {
      wx.showToast({ title: formatCloudFnError(err, '清理失败'), icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
  async toggleShelf(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return wx.showToast({ title: '藏品信息缺失', icon: 'none' });
    const onShelf = !!e.detail.value;
    wx.showLoading({ title: onShelf ? '提交上架…' : '下架中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageApprovals',
        data: { action: 'submitProductShelf', productId: id, onShelf }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || '操作失败', icon: 'none' });
        this.loadProducts();
        return;
      }
      if (result.pendingApproval) {
        wx.showToast({ title: result.msg || '已提交超管审核', icon: 'none' });
      } else {
        wx.showToast({ title: result.msg || (onShelf ? '已上架' : '已下架'), icon: 'success' });
      }
      this.loadProducts();
    } catch (err) {
      console.error('toggleShelf', err);
      wx.showToast({ title: formatCloudFnError(err, '上下架失败'), icon: 'none' });
      this.loadProducts();
    } finally {
      wx.hideLoading();
    }
  },
  updateStock(e) { /* 省略具体逻辑，参考原代码 */ },

  /**
   * 删除藏品（编辑弹窗内，仅超管）
   * products 集合 write:false —— 必须走 manageProducts.remove 硬删，
   * 与 Admin 侧同一入口；云函数侧独立校验超管身份。
   */
  deleteProduct() {
    const item = this.data.tempProduct || {};
    const productId = String(this.data.editId || item._id || '').trim();
    if (!productId) {
      wx.showToast({ title: '缺少藏品 ID，无法删除', icon: 'none' });
      return;
    }
    const title = String(item.title || '').trim() || '该藏品';
    wx.showModal({
      title: '高风险操作',
      content: `确定要永久删除藏品《${title}》吗？\n删除后不可恢复（已售订单与账本记录不受影响）。`,
      confirmText: '确认删除',
      confirmColor: '#D64045',
      success: (res) => {
        if (!res.confirm) return;
        this.submitDeleteProduct(productId, title);
      }
    });
  },

  async submitDeleteProduct(productId, title) {
    wx.showLoading({ title: '删除中…', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageProducts',
        data: { action: 'remove', productId }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || '删除失败', icon: 'none' });
        return;
      }
      const next = (this.data.products || []).filter((p) => p && p._id !== productId);
      this.setData({
        products: next,
        productTotal: Math.max(0, (Number(this.data.productTotal) || 0) - 1),
        showProductModal: false,
        isEditing: false,
        editId: ''
      });
      wx.showToast({ title: '档案已销毁', icon: 'success' });
      this.loadProductStats && this.loadProductStats();
    } catch (err) {
      console.error('deleteProduct', err);
      wx.showToast({ title: formatCloudFnError(err, '删除失败，请确认已部署 manageProducts'), icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async openProductModal(e) { 
      await this.loadCategoriesTree();
      if (!(this.data.rootNames || []).length) {
        wx.showToast({ title: '暂无分类，请先在分类管理同步', icon: 'none' });
      }
      const item = e.currentTarget.dataset.item;
      const sizeFields = getSkuSizeFields(item || {});
      let sizeL = sizeFields.sizeL;
      let sizeW = sizeFields.sizeW;
      let sizeH = sizeFields.sizeH;
      const protectionType = (item && item.protectionType) || 'none';
      const protectionTypeIndex = Math.max(0, this.data.protectionTypeValues.indexOf(protectionType));
      const seckill = item && item.seckill && item.seckill.enabled ? item.seckill : null;
      const groupBuying = item && item.groupBuying && item.groupBuying.enabled ? item.groupBuying : null;
      const images = item && Array.isArray(item.images) ? item.images.filter(Boolean) : [];
      const skus = item && item.skus && item.skus.length
        ? item.skus.map((s, i) => normalizeSkuForEdit(s, i))
        : [];
      
      this.setData({ 
        showProductModal: true, 
        isEditing: !!item, 
        editId: item?item._id:'',
        oneOfAKindManualOff: false,
        productFormTab: 'basic',
        skuBulkPrice: '',
        skuBulkStock: '',
        skuDimBuilder: item && item.skuDimensions && item.skuDimensions.length
          ? item.skuDimensions.map((name) => ({ name: String(name || ''), valuesStr: '' }))
          : [{ name: '', valuesStr: '' }],
        tempProduct: item ? { 
          ...item, 
          images,
          tempImg: images[0] || '', 
          detailImages: item.detailImages || [],
          detailHtml: item.detailHtml || '',
          sizeL, sizeW, sizeH,
          hasSku: !!(item.hasSku && skus.length),
          skus,
          skuDimensionsStr: (item.skuDimensions || []).join(','),
          supportsCustom: item.supportsCustom !== false,
          giftEligible: item.giftEligible !== false,
          sensitiveBlur: !!(item.sensitiveBlur || item.contentWarning),
          sensitiveBlurSetByUser: !!item.sensitiveBlurSetByUser,
          productRarity: item.productRarity === 'rare' || item.productRarity === 'legendary'
            ? item.productRarity
            : 'common',
          productRaritySetByUser: !!item.productRaritySetByUser,
          memberDiscountEnabled: item.memberDiscountEnabled !== false,
          isOneOfAKind: !!item.isOneOfAKind,
          depositEligible: item.depositEligible != null
            ? !!item.depositEligible
            : !!item.isOneOfAKind,
          inArchive: !!item.inArchive,
          channel: item.channel || '',
          craftType: item.craftType || '',
          craftProcess: item.craftProcess || '',
          protectionType,
          collectionCertificate: item.collectionCertificate || '',
          tempCertificate: '',
          // 需求 28：按"当前实际是否挂墙"回填（含标题兜底），保存时再落成显式字段
          wishWallEnabled: isWishWallProduct(item),
          wishWallKey: String(item.wishWallKey || ''),
          taxonomy: toChineseTaxonomy(item.taxonomy || { kingdom: '', phylum: '', class: '', order: '', family: '', genus: '' }),
          tags: sanitizeProductTags(item.tags),
          tagDraft: '',
          giftScenes: readGiftScenes(item),
          seckillEnabled: !!(seckill && seckill.enabled),
          seckillPrice: seckill ? seckill.price : '',
          seckillStock: seckill ? seckill.stock : '',
          seckillLimitPerUser: seckill ? (seckill.limitPerUser || 1) : 1,
          seckillStartTime: seckill && seckill.startTime ? toLocalDateTimeInput(seckill.startTime) : '',
          seckillEndTime: seckill && seckill.endTime ? toLocalDateTimeInput(seckill.endTime) : '',
          groupBuyingEnabled: !!(groupBuying && groupBuying.enabled),
          groupBuyingPrice: groupBuying ? groupBuying.price : '',
          groupBuyingSize: groupBuying ? (groupBuying.groupSize || 2) : 2
        } : { 
          images: [],
          tempImg: '', title: '', price: '', costPrice: '', stock: 1, category: '', categoryId: '', rootCategoryName: '', rootCategoryId: '', categoryType: '', framerName: '', framerId: '', description: '', origin: '', latinName: '', sizeL:'', sizeW:'', sizeH:'', collectDate: '', isTreasure: false, isOneOfAKind: true, depositEligible: true, inArchive: true, memberDiscountEnabled: true, supportsCustom: false, giftEligible: true, sensitiveBlur: false, sensitiveBlurSetByUser: false, productRarity: 'common', productRaritySetByUser: false, hasSku: false, skus: [], skuDimensionsStr: '', detailImages: [], detailHtml: '',
          channel: '', craftType: '', craftProcess: '',
          protectionType: 'none',
          collectionCertificate: '',
          tempCertificate: '',
          // 需求 28：新建藏品默认不挂祈福墙
          wishWallEnabled: false,
          wishWallKey: '',
          taxonomy: { kingdom: '', phylum: '', class: '', order: '', family: '', genus: '' },
          tags: [],
          tagDraft: '',
          giftScenes: [],
          seckillEnabled: false, seckillPrice: '', seckillStock: '', seckillLimitPerUser: 1, seckillStartTime: '', seckillEndTime: '',
          groupBuyingEnabled: false, groupBuyingPrice: '', groupBuyingSize: 2
        },
        protectionTypeIndex,
        categorySubs: [],
        subNames: []
      });
      if (item) {
        this.syncProductCategoryPicker(this.data.tempProduct);
      } else if (this.data.artisanEmbed) {
        const fid = String(this.data.artisanFramerId || '').trim();
        if (fid) {
          this.setData({ 'tempProduct.framerId': fid });
        }
      }
      syncProductLatinRequired(this);
      syncProductTaxonomyFlags(this);
      this.syncGiftSceneOptionFlags();
      if (!item && this.data.artisanEmbed) {
        this.applyArtisanConceptPrefill();
      }
  },

  applyArtisanConceptPrefill() {
    let draft = null;
    try {
      draft = wx.getStorageSync(PREFILL_KEY);
    } catch (e) {
      return;
    }
    if (!draft || typeof draft !== 'object') return;
    const patch = {};
    const title = String(draft.title || '').trim();
    const price = String(draft.price || '').trim();
    const description = String(draft.description || '').trim();
    const origin = String(draft.origin || '').trim();
    const tags = sanitizeProductTags(draft.tags);
    const missing = [];
    if (title) patch['tempProduct.title'] = title;
    else missing.push('品名');
    if (price) patch['tempProduct.price'] = price;
    else missing.push('售价');
    if (description) patch['tempProduct.description'] = description;
    else missing.push('描述');
    if (origin) patch['tempProduct.origin'] = origin;
    if (tags.length) patch['tempProduct.tags'] = tags;
    if (draft.giftEligible === true) patch['tempProduct.giftEligible'] = true;
    if (!Object.keys(patch).length) return;
    this.setData(patch);
    try {
      wx.removeStorageSync(PREFILL_KEY);
    } catch (e) { /* ignore */ }
    const tip = missing.length
      ? `已填入概念草案（请补全：${missing.join('、')}）`
      : '已填入概念草案，请核对后保存';
    wx.showToast({ title: tip.length > 20 ? tip.slice(0, 18) + '…' : tip, icon: 'none', duration: 2400 });
  },
  syncGiftSceneOptionFlags() {
    const selected = new Set(sanitizeGiftScenes((this.data.tempProduct || {}).giftScenes));
    const giftSceneOptions = GIFT_SCENES.map((s) => ({
      key: s.key,
      label: s.label,
      on: selected.has(s.key)
    }));
    this.setData({ giftSceneOptions });
  },
  toggleProductGiftScene(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '').trim();
    if (!key) return;
    const current = sanitizeGiftScenes((this.data.tempProduct || {}).giftScenes);
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : sanitizeGiftScenes([...current, key]);
    this.setData({ 'tempProduct.giftScenes': next }, () => this.syncGiftSceneOptionFlags());
  },
  chooseProductImages() {
    const current = this.data.tempProduct.images || [];
    const remain = Math.max(0, 12 - current.length);
    if (remain <= 0) return wx.showToast({ title: '最多 12 张轮播图', icon: 'none' });
    wx.chooseImage({
      count: remain,
      success: async (res) => {
        const picked = res.tempFilePaths || [];
        if (!picked.length) return;
        // 需求 17：上传前做尺寸/体积核验（原实现把手机原图直接入队，4000px 级原图直传云存储）
        wx.showLoading({ title: '校验中…', mask: true });
        try {
          const { prepareUploadImages } = require('../utils/imageUploadGuard');
          const { accepted, rejected } = await prepareUploadImages(picked, { label: '藏品图' });
          wx.hideLoading();
          if (rejected.length) {
            wx.showModal({
              title: '部分图片未通过校验',
              content: rejected
                .slice(0, 3)
                .map((r) => `· ${r.reason}`)
                .join('\n') + (rejected.length > 3 ? `\n（共 ${rejected.length} 张未通过）` : ''),
              showCancel: false,
              confirmText: '知道了'
            });
          }
          if (!accepted.length) return;
          const next = current.concat(accepted);
          this.setData({
            'tempProduct.images': next,
            'tempProduct.tempImg': next[0] || ''
          });
        } catch (e) {
          wx.hideLoading();
          console.warn('prepareUploadImages', e);
          // 校验工具异常时降级放行，不阻塞上架
          const next = current.concat(picked);
          this.setData({
            'tempProduct.images': next,
            'tempProduct.tempImg': next[0] || ''
          });
        }
      }
    });
  },
  removeProductImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const imgs = [...(this.data.tempProduct.images || [])];
    if (idx < 0 || idx >= imgs.length) return;
    imgs.splice(idx, 1);
    this.setData({
      'tempProduct.images': imgs,
      'tempProduct.tempImg': imgs[0] || ''
    });
  },
  setProductCoverImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (idx <= 0) return;
    const imgs = [...(this.data.tempProduct.images || [])];
    if (idx >= imgs.length) return;
    const [picked] = imgs.splice(idx, 1);
    imgs.unshift(picked);
    this.setData({
      'tempProduct.images': imgs,
      'tempProduct.tempImg': imgs[0] || ''
    });
  },
  moveProductImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const delta = Number(e.currentTarget.dataset.delta) || 0;
    const imgs = [...(this.data.tempProduct.images || [])];
    const j = idx + delta;
    if (j < 0 || j >= imgs.length) return;
    [imgs[idx], imgs[j]] = [imgs[j], imgs[idx]];
    this.setData({
      'tempProduct.images': imgs,
      'tempProduct.tempImg': imgs[0] || ''
    });
  },
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
  moveDetailImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const delta = Number(e.currentTarget.dataset.delta) || 0;
    const imgs = [...(this.data.tempProduct.detailImages || [])];
    const j = idx + delta;
    if (j < 0 || j >= imgs.length) return;
    [imgs[idx], imgs[j]] = [imgs[j], imgs[idx]];
    this.setData({ 'tempProduct.detailImages': imgs });
  },
  bindPInput(e) {
    const field = e.currentTarget.dataset.field;
    const patch = { [`tempProduct.${field}`]: e.detail.value };
    this.setData(patch);
    if (field === 'stock') this.syncOneOfAKindFromStock(e.detail.value);
  },
  mergeProductTagsFromAi(current, incoming) {
    return sanitizeProductTags([...(current || []), ...(incoming || [])]);
  },
  addProductTag() {
    const p = this.data.tempProduct || {};
    const next = sanitizeProductTags([...(p.tags || []), p.tagDraft]);
    if (next.length === (p.tags || []).length && String(p.tagDraft || '').trim()) {
      wx.showToast({ title: '标签无效或已满 10 个', icon: 'none' });
    }
    this.setData({ 'tempProduct.tags': next, 'tempProduct.tagDraft': '' });
  },
  removeProductTag(e) {
    const tag = String((e.currentTarget.dataset && e.currentTarget.dataset.tag) || '');
    const tags = (this.data.tempProduct.tags || []).filter((item) => item !== tag);
    this.setData({ 'tempProduct.tags': tags });
  },
  syncOneOfAKindFromStock(stockVal) {
    if (this.data.tempProduct.hasSku) return;
    const n = parseInt(stockVal, 10);
    if (n === 1) {
      if (!this.data.oneOfAKindManualOff) {
        this.setData({ 'tempProduct.isOneOfAKind': true });
      }
    } else if (Number.isFinite(n) && n > 1) {
      this.setData({
        'tempProduct.isOneOfAKind': false,
        oneOfAKindManualOff: false
      });
    }
  },
  bindPFramerChange(e) { const f = this.data.framerList[e.detail.value]; this.setData({ 'tempProduct.framerName': f.name, 'tempProduct.framerId': f._id }); },
  bindPDateChange(e) { this.setData({ 'tempProduct.collectDate': e.detail.value }); },
  bindPTreasure(e) { this.setData({ 'tempProduct.isTreasure': e.detail.value }); },
  bindPOneOfAKind(e) {
    const val = e.detail.value;
    const patch = { 'tempProduct.isOneOfAKind': val };
    if (!val && Number(this.data.tempProduct.stock) === 1) {
      patch.oneOfAKindManualOff = true;
    } else if (val) {
      patch.oneOfAKindManualOff = false;
      if (this.data.tempProduct.depositEligible == null) {
        patch['tempProduct.depositEligible'] = true;
      }
    }
    this.setData(patch);
  },
  bindPDepositEligible(e) { this.setData({ 'tempProduct.depositEligible': !!e.detail.value }); },
  bindPInArchive(e) { this.setData({ 'tempProduct.inArchive': e.detail.value }); },
  bindPMemberDiscount(e) { this.setData({ 'tempProduct.memberDiscountEnabled': e.detail.value }); },
  bindPSupportsCustom(e) { this.setData({ 'tempProduct.supportsCustom': e.detail.value }); },
  bindPGiftEligible(e) { this.setData({ 'tempProduct.giftEligible': e.detail.value }); },
  /**
   * 需求 28：藏品是否挂祈福墙。
   * 关掉时顺手清空作用域：留着一个不可见的值，下次开启会莫名其妙"挂到别的墙上"。
   */
  bindPWishWall(e) {
    const on = !!e.detail.value;
    this.setData({
      'tempProduct.wishWallEnabled': on,
      ...(on ? {} : { 'tempProduct.wishWallKey': '' })
    });
  },
  /** 需求 28：祈福墙作用域。边输边净化成合法 key（与云函数/客户端同口径） */
  bindPWishWallKey(e) {
    const raw = String((e.detail && e.detail.value) || '');
    this.setData({ 'tempProduct.wishWallKey': normalizeProductKey(raw, '') });
  },
  bindPSensitiveBlur(e) {
    this.setData({
      'tempProduct.sensitiveBlur': !!e.detail.value,
      'tempProduct.sensitiveBlurSetByUser': true
    });
  },
  /** AI/分类补齐后：未手动改过则按敏感形态建议开启模糊 */
  applySensitiveBlurSuggestionFromForm(product) {
    const p = product || this.data.tempProduct || {};
    const suggested = suggestSensitiveBlurOnForm(p, !!p.sensitiveBlurSetByUser);
    if (suggested === true) {
      this.setData({ 'tempProduct.sensitiveBlur': true });
    }
  },
  /** 「珍稀」角标：仅人工打标，不参与任何自动推断 */
  bindPProductRarity(e) {
    this.setData({
      'tempProduct.productRarity': e.detail.value ? 'rare' : 'common',
      'tempProduct.productRaritySetByUser': true
    });
  },
  bindPSeckillEnabled(e) { this.setData({ 'tempProduct.seckillEnabled': e.detail.value }); },
  bindPGroupBuyingEnabled(e) { this.setData({ 'tempProduct.groupBuyingEnabled': e.detail.value }); },
  bindChannelChange(e) {
    const idx = parseInt(e.detail.value, 10) || 0;
    const val = (this.data.channelValues || [])[idx] || '';
    this.setData({ channelIndex: idx, 'tempProduct.channel': val });
  },
  bindCraftTypeChange(e) {
    const idx = parseInt(e.detail.value, 10) || 0;
    const val = (this.data.craftValues || [])[idx] || '';
    this.setData({ craftTypeIndex: idx, 'tempProduct.craftType': val });
    syncProductSizeForm(this);
  },
  bindCraftProcessChange(e) {
    const idx = parseInt(e.detail.value, 10) || 0;
    const val = (this.data.craftProcessValues || [])[idx] || '';
    this.setData({ craftProcessIndex: idx, 'tempProduct.craftProcess': val });
  },
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
  applyCategorySuggestion(cat) {
    if (!cat || !cat.rootCategoryId) return false;
    const roots = this.data.categoryRoots || [];
    const subMap = this.data.categorySubMap || {};
    const rootIdx = roots.findIndex((r) => r._id === cat.rootCategoryId);
    if (rootIdx < 0) return false;
    const rootCat = roots[rootIdx];
    const subs = subMap[rootCat._id] || [];
    const subNames = subs.map((c) => c.name);
    let subIdx = -1;
    if (cat.categoryId) subIdx = subs.findIndex((s) => s._id === cat.categoryId);
    else if (cat.category) subIdx = subs.findIndex((s) => s.name === cat.category);
    const patch = {
      categorySubs: subs,
      subNames,
      'tempProduct.rootCategoryIndex': rootIdx,
      'tempProduct.rootCategoryId': rootCat._id,
      'tempProduct.rootCategoryName': rootCat.name,
      'tempProduct.subCategoryIndex': subIdx,
      'tempProduct.category': '',
      'tempProduct.categoryId': '',
      'tempProduct.categoryType': cat.categoryType || rootCat.categoryType || ''
    };
    if (subIdx >= 0) {
      const subCat = subs[subIdx];
      patch['tempProduct.category'] = subCat.name;
      patch['tempProduct.categoryId'] = subCat._id;
      patch['tempProduct.categoryType'] = subCat.categoryType || patch['tempProduct.categoryType'];
    } else if (cat.category) {
      patch['tempProduct.category'] = cat.category;
      patch['tempProduct.categoryId'] = cat.categoryId || '';
    }
    this.setData(patch);
    syncProductLatinRequired(this);
    syncProductTaxonomyFlags(this);
    return true;
  },
  /** 一键补齐：仅需名称；补分类/描述/保护物种/taxonomy/学名（与 Admin 同源） */
  async assistProductFillAll() {
    const p = this.data.tempProduct || {};
    if (!String(p.title || '').trim()) return wx.showToast({ title: '请先填写名称', icon: 'none' });
    if (this.data.aiAssisting) return;
    this.setData({ aiAssisting: true });
    wx.showLoading({ title: '一键补齐中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'assistProductCopy',
        config: { timeout: 60000 },
        data: {
          title: p.title,
          category: p.category || '',
          rootCategory: p.rootCategoryName || '',
          origin: p.origin || '',
          // 礼赠场景标签规则需要价格档位（见 scripts/giftSceneRules.mjs）
          price: Number(p.price) || 0
        }
      });
      const result = res.result || {};
      if (!result.success) throw new Error(result.msg || '补齐失败');
      const d = result.data || {};
      const tax = toChineseTaxonomy(d.taxonomy || {});
      const latinName = String(d.latinName || '').trim();
      if (d.category) this.applyCategorySuggestion(d.category);
      const afterCat = this.data.tempProduct || p;
      if (!isMerchandiseProduct(afterCat) && !latinName) {
        throw new Error('未能补全拉丁学名，请核对名称后重试');
      }
      const pt = String(d.protectionType || '').trim();
      const protectionPatch = {};
      if (['none', 'sanyou', 'protected_plant', 'protected_animal'].includes(pt)) {
        // 无证书时不自动升为保护类，避免一键补齐后被收藏证书校验卡死
        const hasCert = !!(afterCat.collectionCertificate || afterCat.tempCertificate);
        if (pt === 'none') {
          protectionPatch['tempProduct.protectionType'] = 'none';
          protectionPatch.protectionTypeIndex = 0;
          protectionPatch['tempProduct.collectionCertificate'] = '';
          protectionPatch['tempProduct.tempCertificate'] = '';
        } else if (hasCert) {
          protectionPatch['tempProduct.protectionType'] = pt;
          protectionPatch.protectionTypeIndex = Math.max(0, this.data.protectionTypeValues.indexOf(pt));
        } else if (pt !== (afterCat.protectionType || 'none')) {
          wx.showToast({ title: `AI 建议保护等级，请手动确认并上传证书`, icon: 'none' });
        }
      }
      this.setData({
        'tempProduct.latinName': latinName || afterCat.latinName || '',
        'tempProduct.description': d.description || afterCat.description || '',
        'tempProduct.taxonomy.kingdom': tax.kingdom || afterCat.taxonomy?.kingdom || '',
        'tempProduct.taxonomy.phylum': tax.phylum || afterCat.taxonomy?.phylum || '',
        'tempProduct.taxonomy.class': tax.class || afterCat.taxonomy?.class || '',
        'tempProduct.taxonomy.order': tax.order || afterCat.taxonomy?.order || '',
        'tempProduct.taxonomy.family': tax.family || afterCat.taxonomy?.family || '',
        'tempProduct.taxonomy.genus': tax.genus || afterCat.taxonomy?.genus || '',
        ...protectionPatch,
        'tempProduct.tags': this.mergeProductTagsFromAi(afterCat.tags, d.tags),
        // 礼赠场景标签：随一键补齐一起打（云函数按规则算出）
        'tempProduct.giftScenes': (Array.isArray(d.giftScenes) && d.giftScenes.length)
          ? d.giftScenes
          : (this.data.tempProduct.giftScenes || [])
      });
      syncProductLatinRequired(this);
      syncProductTaxonomyFlags(this);
      this.applySensitiveBlurSuggestionFromForm(this.data.tempProduct);
      wx.showToast({ title: latinName ? '一键补齐完成' : '描述/分类已补齐', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: e.message || '一键补齐失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ aiAssisting: false });
    }
  },
  async assistProductWithAi() {
    const p = this.data.tempProduct || {};
    if (!p.title) return wx.showToast({ title: '请先填写名称', icon: 'none' });
    if (!isMerchandiseProduct(p) && !p.category && !p.rootCategoryName) {
      return wx.showToast({ title: '请先选择分类，或点「一键补齐」', icon: 'none' });
    }
    if (this.data.aiAssisting) return;
    this.setData({ aiAssisting: true });
    wx.showLoading({ title: 'AI 识别中…' });
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
      if (!result.success) throw new Error(result.msg || '识别失败');
      const d = result.data || {};
      const tax = toChineseTaxonomy(d.taxonomy || {});
      const latinName = String(d.latinName || '').trim();
      if (!isMerchandiseProduct(p) && !latinName) {
        throw new Error('未能识别拉丁学名，请补充名称或分类后重试');
      }
      this.setData({
        'tempProduct.latinName': latinName || p.latinName || '',
        'tempProduct.description': d.description || p.description || '',
        'tempProduct.taxonomy.kingdom': tax.kingdom || p.taxonomy?.kingdom || '',
        'tempProduct.taxonomy.phylum': tax.phylum || p.taxonomy?.phylum || '',
        'tempProduct.taxonomy.class': tax.class || p.taxonomy?.class || '',
        'tempProduct.taxonomy.order': tax.order || p.taxonomy?.order || '',
        'tempProduct.taxonomy.family': tax.family || p.taxonomy?.family || '',
        'tempProduct.taxonomy.genus': tax.genus || p.taxonomy?.genus || '',
        'tempProduct.tags': this.mergeProductTagsFromAi(p.tags, d.tags)
      });
      this.applySensitiveBlurSuggestionFromForm(this.data.tempProduct);
      wx.showToast({ title: latinName ? '识别成功' : '描述已补全', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: e.message || 'AI 识别失败', icon: 'none' });
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
      ? [emptySkuRow({
          id: `sku_${Date.now()}`,
          price: this.data.tempProduct.price || '',
          stock: 1
        })]
      : (this.data.tempProduct.skus || [])
    this.setData({
      'tempProduct.hasSku': hasSku,
      'tempProduct.skus': skus,
      productFormTab: hasSku ? 'sku' : this.data.productFormTab
    })
    if (hasSku) syncProductSizeForm(this)
  },
  setProductFormTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab) return
    if (this.data.artisanEmbed && tab === 'promo') return
    this.setData({ productFormTab: tab })
  },
  prevProductFormTab() {
    const tabs = this.data.productFormTabs || []
    const i = tabs.indexOf(this.data.productFormTab)
    if (i > 0) this.setData({ productFormTab: tabs[i - 1] })
  },
  nextProductFormTab() {
    const tabs = this.data.productFormTabs || []
    const i = tabs.indexOf(this.data.productFormTab)
    if (i >= 0 && i < tabs.length - 1) this.setData({ productFormTab: tabs[i + 1] })
  },
  bindSkuBulkInput(e) {
    const field = e.currentTarget.dataset.field
    if (field === 'price') this.setData({ skuBulkPrice: e.detail.value })
    else if (field === 'stock') this.setData({ skuBulkStock: e.detail.value })
  },
  applySkuBulkFields() {
    const skus = [...(this.data.tempProduct.skus || [])]
    if (!skus.length) return wx.showToast({ title: '暂无规格', icon: 'none' })
    const price = String(this.data.skuBulkPrice || '').trim()
    const stock = String(this.data.skuBulkStock || '').trim()
    if (!price && !stock) return wx.showToast({ title: '请填写统一价或库存', icon: 'none' })
    const next = skus.map((s) => ({
      ...s,
      price: price !== '' ? price : s.price,
      stock: stock !== '' ? stock : s.stock
    }))
    this.setData({ 'tempProduct.skus': next })
    wx.showToast({ title: '已应用到全部规格', icon: 'none' })
  },
  applyCoverToEmptySkus() {
    const cover = (this.data.tempProduct.images || [])[0] || this.data.tempProduct.tempImg || ''
    if (!cover) return wx.showToast({ title: '请先在基础页上传封面', icon: 'none' })
    const skus = [...(this.data.tempProduct.skus || [])]
    let filled = 0
    const next = skus.map((s) => {
      const imgs = Array.isArray(s.images) ? s.images.filter(Boolean) : (s.image ? [s.image] : [])
      if (imgs.length) return s
      filled += 1
      return { ...s, images: [cover], image: cover }
    })
    this.setData({ 'tempProduct.skus': next })
    wx.showToast({ title: filled ? `已补 ${filled} 条规格图` : '无需补图', icon: 'none' })
  },
  autoFillSkuCodes() {
    const title = String(this.data.tempProduct.title || 'SKU').replace(/\s+/g, '').slice(0, 8)
    const skus = [...(this.data.tempProduct.skus || [])]
    const next = skus.map((s, i) => {
      if (s.sku) return s
      const slug = String(s.specLabel || `S${i + 1}`).replace(/[\/\s]+/g, '-').slice(0, 16)
      return { ...s, sku: `${title}-${slug}-${i + 1}` }
    })
    this.setData({ 'tempProduct.skus': next })
    wx.showToast({ title: '已补全空编码', icon: 'none' })
  },
  addSkuRowsBatch() {
    const skus = [...(this.data.tempProduct.skus || [])]
    const basePrice = this.data.tempProduct.price || ''
    const ts = Date.now()
    for (let i = 0; i < 3; i += 1) {
      skus.push(emptySkuRow({
        id: `sku_${ts}_${skus.length}`,
        price: basePrice,
        stock: 1
      }))
    }
    this.setData({ 'tempProduct.hasSku': true, 'tempProduct.skus': skus })
    syncProductSizeForm(this)
  },
  bindSkuDimInput(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const field = e.currentTarget.dataset.field
    const rows = [...(this.data.skuDimBuilder || [])]
    if (!rows[idx]) return
    rows[idx] = { ...rows[idx], [field]: e.detail.value }
    this.setData({ skuDimBuilder: rows })
  },
  addSkuDimRow() {
    const rows = [...(this.data.skuDimBuilder || [])]
    if (rows.length >= 4) return wx.showToast({ title: '最多 4 个维度', icon: 'none' })
    rows.push({ name: '', valuesStr: '' })
    this.setData({ skuDimBuilder: rows })
  },
  removeSkuDimRow(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const rows = [...(this.data.skuDimBuilder || [])]
    if (rows.length <= 1) return
    rows.splice(idx, 1)
    this.setData({ skuDimBuilder: rows })
  },
  generateSkusFromDims() {
    const dims = (this.data.skuDimBuilder || [])
      .map((d) => ({
        name: String(d.name || '').trim(),
        values: String(d.valuesStr || '')
          .split(/[,，]/)
          .map((v) => v.trim())
          .filter(Boolean)
      }))
      .filter((d) => d.name && d.values.length)
    if (!dims.length) return wx.showToast({ title: '请填写维度名与取值', icon: 'none' })

    let combos = [[]]
    dims.forEach((dim) => {
      const next = []
      combos.forEach((prefix) => {
        dim.values.forEach((val) => {
          next.push(prefix.concat([{ name: dim.name, value: val }]))
        })
      })
      combos = next
    })
    if (combos.length > 50) {
      return wx.showToast({ title: `组合过多（${combos.length}），请精简取值`, icon: 'none' })
    }

    const basePrice = this.data.tempProduct.price || ''
    const cover = (this.data.tempProduct.images || [])[0] || ''
    const existingByLabel = {}
    ;(this.data.tempProduct.skus || []).forEach((s) => {
      if (s && s.specLabel) existingByLabel[String(s.specLabel).trim()] = s
    })

    const skus = combos.map((parts, i) => {
      const specLabel = parts.map((p) => p.value).join(' / ')
      const specs = {}
      parts.forEach((p) => { specs[p.name] = p.value })
      const prev = existingByLabel[specLabel]
      if (prev) {
        return {
          ...normalizeSkuForEdit(prev, i),
          specs
        }
      }
      return emptySkuRow({
        id: `sku_${Date.now()}_${i}`,
        specLabel,
        specs,
        price: basePrice,
        stock: 1,
        images: cover ? [cover] : [],
        image: cover || ''
      })
    })

    this.setData({
      'tempProduct.hasSku': true,
      'tempProduct.skus': skus,
      'tempProduct.skuDimensionsStr': dims.map((d) => d.name).join(',')
    })
    syncProductSizeForm(this)
    wx.showToast({ title: `已生成 ${skus.length} 个规格`, icon: 'none' })
  },
  addSkuRow() {
    const skus = [...(this.data.tempProduct.skus || [])]
    skus.push(emptySkuRow({
      id: `sku_${Date.now()}_${skus.length}`,
      price: this.data.tempProduct.price || '',
      stock: 1
    }))
    this.setData({ 'tempProduct.skus': skus })
    syncProductSizeForm(this)
  },
  removeSkuRow(e) {
    const idx = e.currentTarget.dataset.index
    const skus = [...(this.data.tempProduct.skus || [])]
    skus.splice(idx, 1)
    this.setData({ 'tempProduct.skus': skus, 'tempProduct.hasSku': skus.length > 0 })
  },
  bindSkuInput(e) {
    const { index, field } = e.currentTarget.dataset
    const patch = { [`tempProduct.skus[${index}].${field}`]: e.detail.value }
    if (field === 'specLabel' || field === 'sizeText') {
      const p = this.data.tempProduct || {}
      const skus = [...(p.skus || [])]
      const row = applySizeFormToRow(
        { ...(skus[index] || {}), [field]: e.detail.value },
        p.craftType || '',
        p.title || ''
      )
      skus[index] = row
      patch['tempProduct.skus'] = skus
      delete patch[`tempProduct.skus[${index}].${field}`]
    }
    this.setData(patch)
  },
  chooseSkuImages(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const skus = [...(this.data.tempProduct.skus || [])];
    const sku = skus[idx];
    if (!sku) return;
    const current = Array.isArray(sku.images) ? sku.images.filter(Boolean) : (sku.image ? [sku.image] : []);
    const remain = Math.max(0, 9 - current.length);
    if (remain <= 0) return wx.showToast({ title: '每规格最多 9 张图', icon: 'none' });
    wx.chooseImage({
      count: remain,
      success: (res) => {
        const next = current.concat(res.tempFilePaths || []);
        skus[idx] = { ...sku, images: next, image: next[0] || '' };
        this.setData({ 'tempProduct.skus': skus });
      }
    });
  },
  removeSkuImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const imgIdx = Number(e.currentTarget.dataset.imgIndex);
    const skus = [...(this.data.tempProduct.skus || [])];
    const sku = skus[idx];
    if (!sku) return;
    const imgs = [...(sku.images || [])];
    if (imgIdx < 0 || imgIdx >= imgs.length) return;
    imgs.splice(imgIdx, 1);
    skus[idx] = { ...sku, images: imgs, image: imgs[0] || '' };
    this.setData({ 'tempProduct.skus': skus });
  },
  setSkuCoverImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const imgIdx = Number(e.currentTarget.dataset.imgIndex);
    if (imgIdx <= 0) return;
    const skus = [...(this.data.tempProduct.skus || [])];
    const sku = skus[idx];
    if (!sku) return;
    const imgs = [...(sku.images || [])];
    if (imgIdx >= imgs.length) return;
    const [picked] = imgs.splice(imgIdx, 1);
    imgs.unshift(picked);
    skus[idx] = { ...sku, images: imgs, image: imgs[0] || '' };
    this.setData({ 'tempProduct.skus': skus });
  },
  async submitProduct() { 
      const p = this.data.tempProduct; if (!p.title) return wx.showToast({title:'信息不全',icon:'none'});
      if (!isMerchandiseProduct(p) && !String(p.latinName || '').trim()) {
        return wx.showToast({ title: '非文创类藏品须填写拉丁学名', icon: 'none' });
      }
      const needsCert = p.protectionType && p.protectionType !== 'none';
      const hasCert = !!(p.tempCertificate || p.collectionCertificate);
      if (needsCert && !hasCert) {
        return wx.showToast({ title: '请上传收藏证书', icon: 'none' });
      }

      let hasSku = false
      let skusDraft = []
      let skuDimensions = []
      if (p.hasSku && p.skus && p.skus.length) {
        skuDimensions = String(p.skuDimensionsStr || '')
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean)

        skusDraft = p.skus
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
            const rawImages = Array.isArray(s.images) ? s.images.filter(Boolean) : (s.image ? [s.image] : [])
            const sizeFields = normalizeSkuSizeForSave(s, {
              craftType: p.craftType,
              hintText: `${p.title || ''} ${specLabel}`
            })
            return {
              id: s.id || `sku_${Date.now()}_${i}`,
              specLabel,
              sku: s.sku || s.skuCode || '',
              specs: specs || {},
              price: parseFloat(s.price || p.price || 0),
              stock: parseInt(s.stock, 10) || 0,
              images: rawImages,
              sizeL: sizeFields.sizeL,
              sizeW: sizeFields.sizeW,
              sizeH: sizeFields.sizeH,
              sizeText: sizeFields.sizeText,
              size: sizeFields.size
            }
          })
        if (!skusDraft.length) {
          return wx.showToast({ title: '请至少添加一条有效规格（需填写规格名）', icon: 'none' });
        }
        const missingImg = skusDraft.find((s) => !s.images || !s.images.length);
        if (missingImg) {
          return wx.showToast({ title: `规格「${missingImg.specLabel}」请至少上传 1 张图`, icon: 'none' });
        }
        hasSku = true
      }

      wx.showLoading({title:'保存…', mask:true});
      try {
      const productSizeFields = normalizeSkuSizeForSave(
        { sizeL: p.sizeL, sizeW: p.sizeW, sizeH: p.sizeH, sizeText: p.sizeText },
        { craftType: p.craftType, hintText: p.title || '' }
      );
      const sizeStr = productSizeFields.size; 

      // 上传各规格图
      const skus = []
      for (let i = 0; i < skusDraft.length; i++) {
        const s = skusDraft[i]
        const uploaded = []
        for (let j = 0; j < s.images.length; j++) {
          const img = s.images[j]
          if (!img) continue
          if (isRemoteMediaUrl(img)) uploaded.push(img)
          else uploaded.push(await uploadProductMedia(img, `sku_${i}_${j}`))
        }
        skus.push({
          ...s,
          image: uploaded[0] || '',
          images: uploaded
        })
      }

      let salePrice = parseFloat(p.price)
      let totalStock = parseInt(p.stock, 10) || 0
      if (hasSku) {
        const prices = skus.map((s) => s.price).filter((n) => n > 0)
        salePrice = prices.length ? Math.min(...prices) : salePrice
        totalStock = skus.reduce((sum, s) => sum + s.stock, 0)
      }

      const detailImages = []
      for (let i = 0; i < (p.detailImages || []).length; i++) {
        const img = p.detailImages[i]
        if (!img) continue
        if (isRemoteMediaUrl(img)) detailImages.push(img)
        else detailImages.push(await uploadProductMedia(img, `detail_${i}`))
      }
      
      let collectionCertificate = p.collectionCertificate || '';
      if (p.tempCertificate && !isRemoteMediaUrl(p.tempCertificate)) {
        collectionCertificate = await uploadProductMedia(p.tempCertificate, 'cert');
      } else if (p.tempCertificate) {
        collectionCertificate = p.tempCertificate;
      }
      if (!needsCert) collectionCertificate = '';

      // 商品轮播图：多图上传；无图时用首规格封面兜底（与 Admin 一致）
      let images = []
      const rawProductImages = Array.isArray(p.images) && p.images.length
        ? p.images.filter(Boolean)
        : (p.tempImg ? [p.tempImg] : [])
      for (let i = 0; i < rawProductImages.length; i++) {
        const img = rawProductImages[i]
        if (!img) continue
        if (isRemoteMediaUrl(img)) images.push(img)
        else images.push(await uploadProductMedia(img, `cover_${i}`))
      }
      if (!images.length && hasSku && skus[0] && skus[0].images && skus[0].images[0]) {
        images = [skus[0].images[0]]
      }

      let seckill = null;
      if (p.seckillEnabled) {
        const startMs = p.seckillStartTime ? new Date(String(p.seckillStartTime).replace(' ', 'T')).getTime() : null;
        const endMs = p.seckillEndTime ? new Date(String(p.seckillEndTime).replace(' ', 'T')).getTime() : null;
        seckill = {
          enabled: true,
          price: parseFloat(p.seckillPrice) || 0,
          stock: parseInt(p.seckillStock, 10) || 0,
          limitPerUser: parseInt(p.seckillLimitPerUser, 10) || 1,
          startTime: Number.isFinite(startMs) ? startMs : null,
          endTime: Number.isFinite(endMs) ? endMs : null
        };
      }

      let groupBuying = null;
      if (p.groupBuyingEnabled) {
        groupBuying = {
          enabled: true,
          price: parseFloat(p.groupBuyingPrice) || 0,
          groupSize: parseInt(p.groupBuyingSize, 10) || 2
        };
      }

      const taxonomyOk = isTaxonomyEligibleProduct(p);
      const detailHtml = sanitizeDetailHtml(p.detailHtml || '');

      const safePrice = Number.isFinite(salePrice) ? salePrice : 0;
      const safeStock = Number.isFinite(totalStock) ? totalStock : 0;
      const safeCost = Number.isFinite(parseFloat(p.costPrice || 0)) ? parseFloat(p.costPrice || 0) : 0;
      const productId = this.data.isEditing ? String(this.data.editId || '').trim() : '';
      if (this.data.isEditing && !productId) {
        throw new Error('藏品 ID 缺失，请关闭后重新打开编辑');
      }

      const data = {
        title: p.title,
        latinName: p.latinName || '',
        price: safePrice,
        costPrice: safeCost,
        stock: safeStock,
        hasSku,
        skus: hasSku ? skus : [],
        skuDimensions: hasSku ? skuDimensions : [],
        category: p.category,
        categoryId: p.categoryId || '',
        categoryType: p.categoryType || '',
        rootCategoryName: p.rootCategoryName || '',
        rootCategoryId: p.rootCategoryId || '',
        channel: taxonomyOk ? normalizeChannel(p.channel) : '',
        craftType: taxonomyOk ? normalizeCraftType(p.craftType) : '',
        craftProcess: taxonomyOk ? normalizeCraftProcess(p.craftProcess) : '',
        framerName: p.framerName || 'NATURE',
        framerId: p.framerId || '',
        origin: p.origin || '',
        description: p.description || '',
        detailHtml,
        detailImages,
        collectDate: p.collectDate || '',
        size: sizeStr,
        sizeL: productSizeFields.sizeL,
        sizeW: productSizeFields.sizeW,
        sizeH: productSizeFields.sizeH,
        isTreasure: !!p.isTreasure,
        isOneOfAKind: !!p.isOneOfAKind,
        depositEligible: p.depositEligible != null ? !!p.depositEligible : !!p.isOneOfAKind,
        inArchive: !!p.inArchive,
        memberDiscountEnabled: p.memberDiscountEnabled !== false,
        supportsCustom: !!p.supportsCustom,
        giftEligible: p.giftEligible !== false,
        sensitiveBlur: !!p.sensitiveBlur,
        sensitiveBlurSetByUser: !!p.sensitiveBlurSetByUser,
        productRarity: (p.productRarity === 'rare' || p.productRarity === 'legendary')
          ? p.productRarity
          : 'common',
        productRaritySetByUser: !!p.productRaritySetByUser,
        protectionType: p.protectionType || 'none',
        // 需求 28：祈福墙。写成**显式**布尔，不再依赖"标题含马上有"的兜底 ——
        // 载入时已按实际状态回填，所以"打开就保存"不会把原本在墙上的藏品摘下来。
        // 作用域留空 → 由 resolveWishWallKey 回落到默认墙；**不在这里塞默认值**，
        // 否则每条藏品都会被写上 'mashangyou'，以后改默认墙要批量刷数据。
        wishWallEnabled: !!p.wishWallEnabled,
        wishWallKey: p.wishWallEnabled ? normalizeProductKey(p.wishWallKey, '') : '',
        collectionCertificate,
        taxonomy: toChineseTaxonomy(p.taxonomy || {}),
        tags: sanitizeProductTags(p.tags),
        giftScenes: sanitizeGiftScenes(p.giftScenes),
        images,
        // 上下架仅走 manageApprovals，保存时不改 isOffShelf（云函数也会剥离）
        // 写库必须走 manageProducts；禁止客户端直写 products
        seckill,
        groupBuying,
        updateTime: Date.now()
      };
      const call = await wx.cloud.callFunction({
        name: 'manageProducts',
        data: {
          action: 'upsert',
          productId,
          data
        }
      });
      const result = (call && call.result) || {};
      if (!result.success) {
        throw Object.assign(new Error(result.msg || '保存失败'), {
          code: result.code || '',
          msg: result.msg || '保存失败'
        });
      }
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showProductModal: false });
      if (this.data.artisanEmbed) {
        const worksUrl = '/subpackages/extra/artisan/works/index'
        const stack = typeof getCurrentPages === 'function' ? getCurrentPages() : []
        if (stack && stack.length > 1) {
          wx.navigateBack({
            fail: () => wx.redirectTo({ url: worksUrl })
          })
        } else {
          wx.redirectTo({ url: worksUrl })
        }
        return;
      }
      this.loadProducts();
      if (this.data.productStats || this.data.productLibTab === 'stats') this.loadProductStats();
      } catch (err) {
        wx.hideLoading();
        wx.showToast({ title: formatCloudFnError(err, '保存失败'), icon: 'none' });
      }
  },

  // === 订单 ===
  syncOmViews() {
    const q = this.data.omQuery
    const orders = this.data.orders || []
    this.setData({
      ordersView: filterManagerOrders(orders, q),
      shippedOrdersView: filterManagerOrders(this.data.shippedOrders, q),
      completedOrdersView: filterManagerOrders(this.data.completedOrders, q),
      refundsView: filterManagerOrders(this.data.refunds, q),
      pendingPayOrdersView: filterManagerOrders(this.data.pendingPayOrders, q),
      omPendingCopyCount: orders.filter((o) => o && o.canShip && o.addressCopyText).length
    })
  },

  currentOmTabKey() {
    return OM_TAB_BY_SUB[this.data.subTab] || 'pending'
  },

  onOmQueryInput(e) {
    const omQuery = (e.detail && e.detail.value) || ''
    this.setData({ omQuery }, () => this.syncOmViews())
    if (this._omSearchTimer) clearTimeout(this._omSearchTimer)
    this._omSearchTimer = setTimeout(() => {
      this.reloadOmCurrentTab()
    }, 450)
  },

  clearOmQuery() {
    if (this._omSearchTimer) clearTimeout(this._omSearchTimer)
    this.setData({ omQuery: '', omSearchHint: '' }, () => {
      this.syncOmViews()
      this.reloadOmCurrentTab()
    })
  },

  setOmDays(e) {
    const days = parseInt(e.currentTarget.dataset.days, 10)
    const omDays = days === 7 || days === 30 ? days : 0
    if (omDays === this.data.omDays) return
    this.setData({ omDays }, () => this.reloadAllOmTabs())
  },

  async reloadOmCurrentTab() {
    await this.loadOmTab(this.currentOmTabKey(), { append: false })
  },

  async reloadAllOmTabs() {
    await Promise.all([
      this.loadOmTab('pending', { append: false }),
      this.loadOmTab('shipped', { append: false }),
      this.loadOmTab('completed', { append: false }),
      this.loadOmTab('refund', { append: false }),
      this.loadOmTab('pendingPay', { append: false })
    ])
  },

  /**
   * 补履约（仅超管）：微信已实扣但支付回调缺失时，人工核对商户平台流水后补单。
   * 服务端 managerShipOrder.fulfillPaidOrder → confirmPayment.adminFulfill（幂等履约）。
   */
  fulfillPaidOrder(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    if (!id) {
      wx.showToast({ title: '订单信息缺失', icon: 'none' })
      return
    }
    const row = (this.data.pendingPayOrders || []).find((o) => o && o._id === id) || {}
    wx.showModal({
      title: '补履约',
      content: `仅在微信商户平台确认「${row.orderNo || id}」已收款后使用：将补写支付证据并执行履约（扣库存 / 核销礼券 / 发通知）。`,
      confirmText: '确认补履约',
      confirmColor: '#C4A76C',
      success: (res) => {
        if (!res.confirm) return
        this.submitFulfillPaidOrder(id)
      }
    })
  },

  async submitFulfillPaidOrder(orderId) {
    wx.showLoading({ title: '补履约中…', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'managerShipOrder',
        data: { action: 'fulfillPaidOrder', orderId }
      })
      const result = (res && res.result) || {}
      wx.hideLoading()
      if (!result.success) {
        wx.showToast({ title: result.msg || '补履约失败', icon: 'none' })
        return
      }
      wx.showToast({
        title: result.alreadyPaid ? '该单已支付' : '补履约已执行',
        icon: 'success'
      })
      this.loadOmTab('pendingPay', { append: false })
      this.loadOmTab('pending', { append: false })
      this.loadOpsOrderCounts()
    } catch (err) {
      wx.hideLoading()
      console.error('fulfillPaidOrder', err)
      wx.showToast({ title: (err && err.message) || '补履约失败', icon: 'none' })
    }
  },

  async loadOmTab(tab, { append = false } = {}) {
    const meta = OM_TAB_META[tab]
    if (!meta) return
    const loadingKey = append ? 'omLoadingMore' : meta.loadingKey
    if (append && this.data.omLoadingMore) return
    if (!append) this.setData({ [meta.loadingKey]: true })
    else this.setData({ omLoadingMore: true })

    try {
      const existing = this.data[meta.dataKey] || []
      const skip = append ? existing.length : 0
      const res = await wx.cloud.callFunction({
        name: 'managerShipOrder',
        data: {
          action: 'listManagerOrders',
          tab,
          query: String(this.data.omQuery || '').trim(),
          days: this.data.omDays || 0,
          skip,
          limit: 30
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        if (!append) await this.loadOmTabFallback(tab)
        else wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
        return
      }

      const prevExpand = {}
      existing.forEach((o) => {
        if (o && o._id && o.skuExpanded) prevExpand[o._id] = true
      })
      const mapped = (result.list || []).map((row) => {
        const item = mapOmOrderRaw(row, tab)
        if (prevExpand[item._id]) item.skuExpanded = true
        return item
      })
      let nextList = append ? existing.concat(mapped) : mapped
      if (tab === 'refund') {
        nextList = await this.resolveRefundEvidenceMedia(nextList)
      }
      const hint =
        result.mode === 'search'
          ? `云端匹配 ${result.matched || mapped.length} 单${result.truncated ? '（已截断扫描）' : ''}`
          : this.data.omDays
            ? `近 ${this.data.omDays} 日`
            : ''
      this.setData(
        {
          [meta.dataKey]: nextList,
          [meta.moreKey]: !!result.hasMore,
          omSearchHint: hint
        },
        () => this.syncOmViews()
      )
    } catch (err) {
      console.error('loadOmTab', tab, err)
      if (!append) await this.loadOmTabFallback(tab)
      else wx.showToast({ title: '加载更多失败', icon: 'none' })
    } finally {
      this.setData({ [loadingKey]: false })
      if (tab === 'pending') this.refreshOpsSignals()
    }
  },

  async loadOmTabFallback(tab) {
    const meta = OM_TAB_META[tab]
    if (!meta) return
    const statusMap = {
      pending: ['paid', 'paid_awaiting_address', 'ready_pickup'],
      shipped: ['shipped'],
      completed: ['received'],
      refund: ['refunding', 'aftersales', 'expired_refunding'],
      pendingPay: ['pending_pay', 'fulfilling']
    }
    try {
      const res = await db
        .collection('orders')
        .where({ status: _.in(statusMap[tab] || statusMap.pending) })
        .orderBy('createTime', 'desc')
        .limit(50)
        .get()
      let raw = res.data || []
      if (tab === 'refund') {
        try {
          const pendingWallet = await db
            .collection('orders')
            .where({ status: 'refunded', walletRefundPendingReconcile: true })
            .limit(20)
            .get()
          const extra = pendingWallet.data || []
          if (extra.length) {
            const seen = new Set(raw.map((o) => o._id))
            raw = extra.filter((o) => !seen.has(o._id)).concat(raw)
          }
        } catch (e) { /* ignore */ }
      }
      const mapped = raw.map((row) => mapOmOrderRaw(row, tab))
      const finalList = tab === 'refund' ? await this.resolveRefundEvidenceMedia(mapped) : mapped
      this.setData(
        {
          [meta.dataKey]: finalList,
          [meta.moreKey]: false,
          omSearchHint: '本地直读（请部署 managerShipOrder 以启用云端搜索）'
        },
        () => this.syncOmViews()
      )
    } catch (err) {
      console.error('loadOmTabFallback', tab, err)
      this.setData({ [meta.dataKey]: [], [meta.viewKey]: [], [meta.moreKey]: false })
    }
  },

  async loadOrders() {
    await this.loadOmTab('pending', { append: false })
  },
  async loadShippedOrders() {
    await this.loadOmTab('shipped', { append: false })
  },
  async loadCompletedOrders() {
    await this.loadOmTab('completed', { append: false })
  },
  async loadRefunds() {
    await this.loadOmTab('refund', { append: false })
  },
  async loadPendingPayOrders() {
    await this.loadOmTab('pendingPay', { append: false })
  },

  loadMoreOmOrders() {
    const tab = this.currentOmTabKey()
    const meta = OM_TAB_META[tab]
    if (!meta || !this.data[meta.moreKey] || this.data.omLoadingMore) return
    this.loadOmTab(tab, { append: true })
  },

  toggleOrderSkuExpand(e) {
    const id = e.currentTarget.dataset.id
    const scope = resolveOmListScope(e.currentTarget.dataset.scope)
    const list = (this.data[scope] || []).slice()
    const idx = list.findIndex((o) => o && o._id === id)
    if (idx < 0) return
    list[idx] = Object.assign({}, list[idx], { skuExpanded: !list[idx].skuExpanded })
    this.setData({ [scope]: list }, () => this.syncOmViews())
  },

  copyOrderAddress(e) {
    const id = e.currentTarget.dataset.id
    const scope = resolveOmListScope(e.currentTarget.dataset.scope)
    const order = (this.data[scope] || []).find((o) => o && o._id === id)
    const text = String((order && order.addressCopyText) || '').trim()
    if (!text) {
      wx.showToast({ title: '暂无收货信息', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制收货信息', icon: 'none' })
    })
  },

  /** 待发货卡 → 山海有信（指定用户） */
  openYouxinForBuyer(e) {
    const openid = String(
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.openid) || ''
    ).trim()
    const nick = String(
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.nick) || ''
    ).trim()
    if (!openid) {
      wx.showToast({ title: '缺少会员标识', icon: 'none' })
      return
    }
    const menu = this.data.menu || {}
    if (!menu.support || !canAccessManagerTab(this.data.workspaceRole, 11)) {
      wx.showToast({ title: '无有信权限', icon: 'none' })
      return
    }
    try {
      wx.vibrateShort({ type: 'light' })
    } catch (err) {
      /* ignore */
    }
    const extra = [
      'scope=single',
      `targetOpenid=${encodeURIComponent(openid)}`,
      nick ? `targetNick=${encodeURIComponent(nick)}` : ''
    ]
      .filter(Boolean)
      .join('&')
    goManagerModule(11, '山海有信', extra)
  },

  /** 订单备注输入：只改本地待发列表的当前值，点「保存」才写库 */
  onOrderNoteInput(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    if (!id) return
    const value = String((e.detail && e.detail.value) || '').slice(0, ORDER_NOTE_MAX)
    const list = this.data.orders || []
    const idx = list.findIndex((o) => o && o._id === id)
    if (idx < 0) return
    this.setData({ [`orders[${idx}].managerNote`]: value })
  },

  /**
   * 保存订单备注（orders.managerNote）
   * 发货时会以这里保存的备注为准，随「藏品已发出 / 标本已启程」私信发给会员
   */
  async saveOrderNote(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    if (!id) return
    const list = this.data.orders || []
    const idx = list.findIndex((o) => o && o._id === id)
    if (idx < 0) return
    const row = list[idx] || {}
    if (row.noteSaving) return
    const note = String(row.managerNote || '').trim().slice(0, ORDER_NOTE_MAX)
    if (note === String(row.savedNote || '')) {
      wx.showToast({ title: '备注未改动', icon: 'none' })
      return
    }
    this.setData({ [`orders[${idx}].noteSaving`]: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'managerShipOrder',
        data: { action: 'saveNote', orderId: id, note }
      })
      const result = (res && res.result) || {}
      if (!result.success) throw new Error(result.msg || '保存失败')
      const saved = String(result.note || '')
      this.setData({
        [`orders[${idx}].managerNote`]: saved,
        [`orders[${idx}].savedNote`]: saved,
        [`orders[${idx}].noteSaving`]: false
      })
      wx.showToast({ title: saved ? '备注已保存' : '备注已清空', icon: 'success' })
    } catch (err) {
      this.setData({ [`orders[${idx}].noteSaving`]: false })
      wx.showToast({
        title: (err && err.message) || '保存失败，请确认已部署 managerShipOrder',
        icon: 'none'
      })
    }
  },

  copyShipLabel(e) {
    const id = e.currentTarget.dataset.id
    const scope = resolveOmListScope(e.currentTarget.dataset.scope)
    const order = (this.data[scope] || []).find((o) => o && o._id === id)
    const text = String(
      (order && (order.shipLabelText || buildManagerShipLabelText(order))) || ''
    ).trim()
    if (!text) {
      wx.showToast({ title: '暂无可复制面单', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制面单文案', icon: 'none' })
    })
  },

  copyAllPendingAddresses() {
    const rows = (this.data.orders || []).filter((o) => o && o.canShip && o.addressCopyText)
    if (!rows.length) {
      wx.showToast({ title: '暂无可复制地址', icon: 'none' })
      return
    }
    const text = rows
      .map((o, i) => `${i + 1}. ${o.orderNo || ''}\n${o.addressCopyText}`)
      .join('\n\n')
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: `已复制 ${rows.length} 条地址`, icon: 'none' })
    })
  },

  copyOrderTracking(e) {
    const scope = resolveOmListScope(e.currentTarget.dataset.scope || 'shippedOrders')
    const id = e.currentTarget.dataset.id
    const order = (this.data[scope] || []).find((o) => o && o._id === id)
    const no = String((order && order.trackingNumber) || '').trim()
    if (!no) {
      wx.showToast({ title: '暂无运单号', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: no,
      success: () => wx.showToast({ title: '已复制运单号', icon: 'none' })
    })
  },

  async trackShippedOrder(e) {
    const scope = resolveOmListScope(e.currentTarget.dataset.scope || 'shippedOrders')
    const id = e.currentTarget.dataset.id
    const list = (this.data[scope] || []).slice()
    const idx = list.findIndex((o) => o && o._id === id)
    const order = idx >= 0 ? list[idx] : null
    if (!order) return

    const logistics = (order && order.logistics) || {}
    let token = String(
      order.waybillToken || logistics.waybillToken || logistics.followWaybillToken || ''
    ).trim()

    let ensureResult = null
    // 无 token 先补同步；有 token 则直接跳转 business 分包订单详情打开插件轨迹
    if (id && !token) {
      wx.showLoading({ title: '同步物流…', mask: true })
      try {
        const res = await wx.cloud.callFunction({
          name: 'managerShipOrder',
          // 店长主动查件：force 绕过冷却，避免旧 secret 失败态挡住新配置后的重试
          data: { action: 'ensureWxExpress', orderId: id, force: true }
        })
        ensureResult = (res && res.result) || {}
        token = String(ensureResult.waybillToken || '').trim()
        if (token && idx >= 0) {
          list[idx] = Object.assign({}, list[idx], {
            waybillToken: token,
            canOpenWxTrack: true
          })
          this.setData({ [scope]: list }, () => this.syncOmViews())
        }
        wx.hideLoading()
      } catch (err) {
        wx.hideLoading()
        console.warn('[manager] ensureWxExpress', err)
        ensureResult = {
          success: false,
          msg: (err && (err.errMsg || err.message)) || '同步物流失败'
        }
      }
    }

    if (token || (order && order.hasTracking)) {
      try {
        await openOrderDetailTrack(id, {
          token,
          trackingNumber: order.trackingNumber || '',
          carrier: order.carrier || ''
        })
        return
      } catch (err) {
        console.warn('[manager] openOrderDetailTrack', err)
        const no = String(order.trackingNumber || '').trim()
        const carrier = String(order.carrier || '快递').trim()
        if (!no) {
          wx.showToast({ title: '暂无运单号', icon: 'none' })
          return
        }
        const content = buildManagerTrackFallbackContent({
          token,
          carrier,
          ensureResult,
          navFailed: true
        })
        wx.setClipboardData({
          data: no,
          success: () => {
            wx.showModal({
              title: '单号已复制',
              content,
              showCancel: false,
              confirmText: '知道了',
              confirmColor: '#C4A76C'
            })
          }
        })
        return
      }
    }

    const no = String(order.trackingNumber || '').trim()
    const carrier = String(order.carrier || '快递').trim()
    if (!no) {
      wx.showToast({ title: '暂无运单号', icon: 'none' })
      return
    }
    const content = buildManagerTrackFallbackContent({
      token,
      carrier,
      ensureResult
    })
    wx.setClipboardData({
      data: no,
      success: () => {
        wx.showModal({
          title: '单号已复制',
          content,
          showCancel: false,
          confirmText: '知道了',
          confirmColor: '#C4A76C'
        })
      }
    })
  },

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
      this.refreshOpsSignals();
    } catch (e) {
      console.error('loadCustomOrders', e);
      this.setData({ customOrders: [] });
      this.refreshOpsSignals();
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

  switchFramerRecruitFilter(e) {
    const status = e.currentTarget.dataset.status || 'pending';
    this.setData({ framerRecruitFilter: status });
    this.loadFramerRecruitApps();
  },

  async loadFramerRecruitApps() {
    try {
      const filter = this.data.framerRecruitFilter || 'pending';
      let query = db.collection('framer_recruit_applications');
      if (filter !== 'all') {
        query = query.where({ status: filter });
      }
      const res = await query.orderBy('createTime', 'desc').limit(50).get();
      const statusLabels = {
        pending: '待跟进',
        contacted: '已联系',
        accepted: '已通过',
        rejected: '未通过'
      };
      this.setData({
        framerRecruitApps: (res.data || []).map((item) => ({
          ...item,
          statusLabel: statusLabels[item.status] || item.status,
          categoryText: (item.categoryLabels || []).join('、'),
          intentText: (item.intentLabels || []).join('、'),
          formatTime: item.createTime ? new Date(item.createTime).toLocaleString() : ''
        }))
      });
      this.refreshOpsSignals();
    } catch (e) {
      console.error('loadFramerRecruitApps', e);
      this.setData({ framerRecruitApps: [] });
      this.refreshOpsSignals();
    }
  },

  async updateFramerRecruitStatus(e) {
    const id = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    if (!id || !status) {
      return wx.showToast({ title: '参数缺失', icon: 'none' });
    }
    try {
      await callStoreContent({
        action: 'update',
        collection: 'framer_recruit_applications',
        id,
        data: {
          status,
          updateTime: Date.now(),
          reviewedAt: Date.now()
        }
      });
      wx.showToast({ title: '已更新' });
      this.loadFramerRecruitApps();
    } catch (err) {
      wx.showToast({ title: '更新失败', icon: 'none' });
    }
  },

  copyFramerRecruitText(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    const lines = [
      `标本师合作申请`,
      `姓名：${item.contactName || ''}`,
      `手机：${item.phone || ''}`,
      item.wechat ? `微信：${item.wechat}` : '',
      item.city ? `城市：${item.city}` : '',
      item.categoryText ? `品类：${item.categoryText}` : '',
      item.intentText ? `意向：${item.intentText}` : '',
      item.experience ? `经验：${item.experience}` : '',
      item.note ? `备注：${item.note}` : '',
      `状态：${item.statusLabel || item.status || ''}`,
      item.formatTime ? `提交：${item.formatTime}` : ''
    ].filter(Boolean);
    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showToast({ title: '已复制' })
    });
  },

  async updateInquiryStatus(e) {
    const id = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    if (!id || !status) {
      return wx.showToast({ title: '参数缺失', icon: 'none' });
    }
    const inquiry = this.data.customInquiries.find((i) => i._id === id);
    try {
      await callStoreContent({
        action: 'update',
        collection: 'custom_inquiries',
        id,
        data: { status, updateTime: Date.now() }
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
    if (!id || !status) {
      return wx.showToast({ title: '参数缺失', icon: 'none' });
    }
    const order = this.data.petMemorialOrders.find((o) => o._id === id);
    try {
      const note = PET_STATUS_LABELS[status] || status;
      await callStoreContent({
        action: 'update',
        collection: 'pet_memorial_orders',
        id,
        data: { status, updateTime: Date.now() },
        pushFields: { productionLog: [{ status, time: new Date().toISOString(), note }] }
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
      await callStoreContent({
        action: 'update',
        collection: 'pet_memorial_orders',
        id: orderId,
        data: {
          status: 'quoted',
          quote: {
            amount: num,
            note: (note || '').trim(),
            quotedAt: new Date().toISOString(),
            validUntil: validUntil || ''
          },
          updateTime: Date.now()
        },
        pushFields: { productionLog: [logEntry] }
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
    if (!id || !next) {
      return wx.showToast({ title: '参数缺失', icon: 'none' });
    }
    wx.showLoading({ title: '更新中…', mask: true });
    try {
      const call = await wx.cloud.callFunction({
        name: 'managerShipOrder',
        data: { action: 'advanceProduction', orderId: id, productionStatus: next }
      });
      const result = (call && call.result) || {};
      if (!result.success) throw new Error(result.msg || '更新失败');
      wx.showToast({ title: result.msg || '已更新' });
      this.loadCustomOrders();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '更新失败', icon: 'none' });
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
    const item = resolveListItem(this.data.customConfigs, e);
    this.setData({
      showCustomConfigModal: true,
      isEditing: !!(item && item._id),
      editId: item && item._id ? item._id : '',
      tempCustomConfig: item
        ? {
            configId: item.configId || '',
            type: item.type || 'frame',
            name: item.name || '',
            desc: item.desc || '',
            priceDelta: item.priceDelta != null ? item.priceDelta : 0,
            sort: item.sort != null ? item.sort : 10,
            status: item.status || 'active'
          }
        : {
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
    const c = this.data.tempCustomConfig || {};
    if (!c.name || !c.type) {
      wx.showToast({ title: '请填写名称与类型', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存…', mask: true });
    try {
      const data = {
        configId: c.configId || `cfg_${Date.now()}`,
        type: c.type,
        name: c.name,
        desc: c.desc || '',
        priceDelta: parseFloat(c.priceDelta) || 0,
        sort: parseInt(c.sort, 10) || 10,
        status: c.status || 'active'
      };
      if (this.data.isEditing && this.data.editId) {
        await callStoreContent({ action: 'upsert', collection: 'custom_configs', id: this.data.editId, data });
      } else {
        await callStoreContent({ action: 'upsert', collection: 'custom_configs', data });
      }
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showCustomConfigModal: false });
      this.loadCustomConfigs();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' });
    }
  },
  deleteCustomConfig(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return wx.showToast({ title: '缺少配置 ID', icon: 'none' });
    wx.showModal({
      title: '删除配置',
      confirmColor: '#D64045',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中…', mask: true });
        try {
          await callStoreContent({ action: 'remove', collection: 'custom_configs', id });
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadCustomConfigs();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: formatCloudFnError(err, '删除失败'), icon: 'none' });
        }
      }
    });
  },
  shipOrder(e) {
    // 兼容旧绑定：统一走带运单号的 managerShipOrder 弹窗，禁止直写集合
    this.openShipModal(e);
  },
  handleRefund(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '订单信息缺失', icon: 'none' });
      return;
    }
    const order = (this.data.refunds || []).find((item) => item._id === id) || { _id: id };
    const modal = buildAdminConfirm(order);
    const missingTip = order.missingUnboxVideo
      ? '\n\n注意：该单缺开箱影像，请谨慎审核。'
      : '';
    wx.showModal({
      title: modal.title,
      content: `${modal.content}${missingTip}`,
      confirmColor: '#C4A76C',
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        wx.cloud.callFunction({
          name: 'refundOrder',
          data: { orderId: id },
          success: (res) => {
            const result = (res && res.result) || {};
            if (result.success) {
              wx.showToast({
                title: result.pendingApproval
                  ? (result.msg || '已提交超管审核')
                  : (result.msg || '已退款'),
                icon: result.pendingApproval ? 'none' : 'success'
              });
              this.loadRefunds();
              this.loadOpsOrderCounts();
            } else {
              wx.showToast({ title: result.msg || '退款失败', icon: 'none' });
            }
          },
          fail: () => wx.showToast({ title: '退款请求失败', icon: 'none' })
        });
      }
    });
  },

  /**
   * 门店自取逆向：确认已收回顾客送回门店的藏品（确认后才允许退款）
   */
  confirmPickupReturn(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '订单信息缺失', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认收回藏品',
      content: '请核对顾客送回门店的藏品与订单一致后确认；确认收回后才能执行退款。',
      confirmText: '确认收回',
      confirmColor: '#C4A76C',
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        wx.showLoading({ title: '确认中…', mask: true });
        wx.cloud.callFunction({
          name: 'refundOrder',
          data: { action: 'confirmPickupReturn', orderId: id },
          success: (res) => {
            wx.hideLoading();
            const result = (res && res.result) || {};
            wx.showToast({
              title: result.msg || (result.success ? '已确认收回' : '确认失败'),
              icon: result.success ? 'success' : 'none'
            });
            if (result.success) {
              this.loadRefunds();
              this.loadOpsOrderCounts();
            }
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '确认请求失败', icon: 'none' });
          }
        });
      }
    });
  },

  async resolveRefundEvidenceMedia(list) {
    const rows = Array.isArray(list) ? list : [];
    const fileIds = [];
    rows.forEach((o) => {
      if (o && o.unboxVideoFileId) fileIds.push(o.unboxVideoFileId);
      (Array.isArray(o && o.evidenceImageFileIds) ? o.evidenceImageFileIds : []).forEach((id) => {
        if (id) fileIds.push(id);
      });
    });
    if (!fileIds.length) return rows;
    let map = {};
    try {
      map = await batchTempFileURLs(fileIds);
    } catch (e) {
      console.warn('resolveRefundEvidenceMedia', e);
    }
    return rows.map((o) => {
      const unboxVideoUrl = o.unboxVideoFileId
        ? map[o.unboxVideoFileId] || o.unboxVideoFileId
        : '';
      const evidenceImageUrls = (o.evidenceImageFileIds || [])
        .map((id) => map[id] || id)
        .filter(Boolean);
      return Object.assign({}, o, {
        unboxVideoUrl,
        evidenceImageUrls,
        hasEvidenceMedia: !!(unboxVideoUrl || evidenceImageUrls.length)
      });
    });
  },

  previewRefundEvidenceImage(e) {
    const id = e.currentTarget.dataset.id;
    const idx = parseInt(e.currentTarget.dataset.idx, 10) || 0;
    const order = (this.data.refunds || []).find((item) => item._id === id);
    const urls = (order && order.evidenceImageUrls) || [];
    if (!urls.length) return;
    wx.previewImage({ current: urls[idx], urls });
  },

  // === 其他通用（账本：store_ledger ↔ finance_records）===
  ensureLedgerMonth() {
    const ledgerMonth = this.data.ledgerMonth || storeLedger.getCurrentYearMonth();
    if (ledgerMonth !== this.data.ledgerMonth || !this.data.ledgerMonthLabel) {
      this.setData({
        ledgerMonth,
        ledgerMonthLabel: storeLedger.formatMonthLabel(ledgerMonth),
      });
    }
    return ledgerMonth;
  },

  onLedgerMonthChange(e) {
    const raw = (e.detail && e.detail.value) || '';
    const ledgerMonth = String(raw).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ledgerMonth)) return;
    this.setData({
      ledgerMonth,
      ledgerMonthLabel: storeLedger.formatMonthLabel(ledgerMonth),
      ledgerOverviewReady: false,
    });
    this.loadRevenues();
  },

  async loadRevenues() {
    const yearMonth = this.ensureLedgerMonth();
    const { endDate } = storeLedger.getMonthDateRange(yearMonth);
    this.ensureLedgerStoreOptions();
    const sid = storeLedger.normalizeStoreId(
      this.data.ledgerStoreId || storeLedger.FINANCE_STORE_ID,
    );
    const applyRows = async (revenues, meta = {}) => {
      const ledgerOverview = storeLedger.buildMonthOverview(revenues);
      const latest = revenues.length ? revenues[0].date : '';
      const lamp = ledgerSyncLamp({
        empty: !revenues.length || ledgerOverview.empty,
        cloudError: !!meta.cloudError,
        latestDate: latest,
        endDate,
        yearMonth,
        currentYearMonth: storeLedger.getCurrentYearMonth(),
      });
      const mall = await this.resolveLedgerMallCommission(
        Number(ledgerOverview.net) || 0,
        meta.mallSettings
      );
      if (mall) ledgerOverview.mall = mall;
      this.setData({
        revenues,
        ledgerOverview,
        ledgerOverviewReady: true,
        ledgerStoreId: sid,
        ledgerLatestDate: latest || '',
        ledgerSyncLampClass: lamp.lampClass,
        ledgerSyncTip: lamp.tip,
      });
    };
    try {
      let revenues = await storeLedger.refreshFromCloud(sid, {
        yearMonth,
        listLimit: 40,
      });
      if (!revenues.length) {
        revenues = await storeLedger.listByMonth(sid, yearMonth);
      }
      await applyRows(revenues);
      if (!revenues.length) {
        console.warn(
          '[ledger] 空月',
          yearMonth,
          'store=',
          sid,
        );
      }
    } catch (e) {
      console.warn('云端账本合并失败，使用本地 store_ledger', e);
      const revenues = await storeLedger.listByMonth(sid, yearMonth);
      await applyRows(revenues, { cloudError: true });
      if (!revenues.length && e && e.message) {
        wx.showToast({ title: String(e.message).slice(0, 40), icon: 'none' });
      }
    }
  },

  /** 商场月累计抽成：优先 finance_settings，缺省 17万 / 15% */
  async resolveLedgerMallCommission(monthNet, presetSettings) {
    let settings = presetSettings || null;
    if (!settings) {
      try {
        const res = await wx.cloud.callFunction({
          name: 'syncFinanceData',
          data: { action: 'download_settings' }
        });
        const result = (res && res.result) || {};
        const data = result.data || {};
        settings = data.settings || null;
      } catch (e) {
        settings = null;
      }
    }
    const safe = {
      mallThreshold:
        settings && Number.isFinite(Number(settings.mallThreshold))
          ? Number(settings.mallThreshold)
          : DEFAULT_MALL_THRESHOLD,
      mallRate:
        settings && Number.isFinite(Number(settings.mallRate))
          ? Number(settings.mallRate)
          : DEFAULT_MALL_RATE
    };
    return formatMallForUi(computeMallCommission(monthNet, safe));
  },

  ensureLedgerStoreOptions() {
    let stores = this.data.adminStores || [];
    if (!stores.length) {
      try {
        const { DEFAULT_STORES } = require('../../../utils/storeDefaults');
        stores = DEFAULT_STORES.slice();
      } catch (e) {
        stores = [
          { storeId: storeLedger.FINANCE_STORE_ID, name: '山海造物' },
          { storeId: 'store_xingchen', name: '星宸标本工作室' },
        ];
      }
    }
    const ledgerStoreOptions = stores
      .map((s) => ({
        storeId: storeLedger.normalizeStoreId(s.storeId || s.id),
        name: s.name || s.storeId || '门店',
      }))
      .filter((s, i, arr) => s.storeId && arr.findIndex((x) => x.storeId === s.storeId) === i);
    if (!ledgerStoreOptions.length) {
      ledgerStoreOptions.push({
        storeId: storeLedger.FINANCE_STORE_ID,
        name: '山海造物',
      });
    }
    const cur = this.data.ledgerStoreId;
    const ok = ledgerStoreOptions.some((s) => s.storeId === cur);
    this.setData({
      ledgerStoreOptions,
      ledgerStoreId: ok ? cur : ledgerStoreOptions[0].storeId,
      ledgerStoreName: (ok
        ? ledgerStoreOptions.find((s) => s.storeId === cur)
        : ledgerStoreOptions[0]
      ).name,
    });
  },

  onLedgerStoreChange(e) {
    const id = storeLedger.normalizeStoreId(
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '',
    );
    if (!id || id === this.data.ledgerStoreId) return;
    const opt = (this.data.ledgerStoreOptions || []).find((s) => s.storeId === id);
    this.setData({
      ledgerStoreId: id,
      ledgerStoreName: (opt && opt.name) || '',
      ledgerOverviewReady: false,
    });
    this.loadRevenues();
  },

  onLedgerSyncLampTap() {
    const tip = this.data.ledgerSyncTip || '账本同步状态';
    wx.showToast({ title: tip.slice(0, 40), icon: 'none', duration: 2800 });
  },

  openRevenueModal() {
    const sid =
      this.data.ledgerStoreId || storeLedger.FINANCE_STORE_ID;
    const opt = (this.data.ledgerStoreOptions || []).find(
      (s) => s.storeId === sid,
    );
    this.setData({
      showRevenueModal: true,
      ledgerStoreId: sid,
      ledgerStoreName: (opt && opt.name) || '当前门店',
      'tempRevenue.date': this.data.todayDate.replace(/\./g, '-'),
      'tempRevenue.pos': '',
      'tempRevenue.online': '',
      'tempRevenue.refund': '',
      'tempRevenue.cash': '',
      'tempRevenue.cashBalance': '',
      'tempRevenue.orderCount': '',
      'tempRevenue.rawText': '',
    });
  },
  bindRevInput(e) { this.setData({ [`tempRevenue.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  
// 🟢 智能解析（现金 = 在手余额，不计入当日营收；门店严格用当前选中，不因粘贴店名串写）
parseRevenueText(e) {
  const text = e.detail.value;
  const parsed = parseDailyFinanceText(text);
  if (!parsed.ok) {
    this.setData({ 'tempRevenue.rawText': text });
    if (text && text.trim().length > 12) {
      wx.showToast({ title: parsed.error || '无法识别日报', icon: 'none', duration: 2800 });
    }
    return;
  }

  const patch = {
    'tempRevenue.rawText': text,
    'tempRevenue.date': parsed.date,
    'tempRevenue.pos': parsed.pos != null ? String(parsed.pos) : '',
    'tempRevenue.online': parsed.online != null ? String(parsed.online) : '',
    'tempRevenue.refund': parsed.refund != null ? String(parsed.refund) : '',
    'tempRevenue.cash': '',
    'tempRevenue.cashBalance':
      parsed.cashBalance != null ? String(parsed.cashBalance) : '',
    'tempRevenue.orderCount':
      parsed.orderCount != null ? String(parsed.orderCount) : '',
  };

  const curSid = storeLedger.normalizeStoreId(
    this.data.ledgerStoreId || storeLedger.FINANCE_STORE_ID,
  );
  const hintSid = matchStoreIdFromHint(parsed.storeNameHint);
  let toastExtra = '';
  if (hintSid && hintSid !== curSid) {
    toastExtra = '（按当前选中门店入账）';
  }

  this.setData(patch);
  wx.showToast({
    title: parsed.legacyOnlineWarning
      ? `已识别（日报「线上」仅记入账本）${toastExtra}`
      : parsed.cashBalance != null
        ? `已识别 · 在手现金 ¥${parsed.cashBalance}${toastExtra}`
        : `已智能识别${toastExtra}`,
    icon: 'none',
    duration: parsed.legacyOnlineWarning || toastExtra ? 3200 : 2000,
  });
},

  // 🟢 提交营收 → store_ledger + 镜像 finance_records + 兼容 daily_revenues
  async submitRevenue() {
    const r = this.data.tempRevenue;
    
    if(!r.date) {
        return wx.showToast({ title: '日期必填', icon: 'none' });
    }
    
    wx.showLoading({ title: '入账中…', mask: true });
    
    try {
        const sid = storeLedger.normalizeStoreId(
          this.data.ledgerStoreId || storeLedger.FINANCE_STORE_ID,
        );
        await storeLedger.upsert(sid, {
          ...r,
          cash: 0,
          cashIncome: 0,
          cashBalance: r.cashBalance,
          orderCount: r.orderCount,
          rawText: r.rawText,
        });
        
        wx.hideLoading();
        this.setData({ showRevenueModal: false });
        this.loadRevenues();
        const offlineTotal = await this.loadOfflineStats();
        await this.loadStats(offlineTotal);
        const storeOpt = (this.data.ledgerStoreOptions || []).find((s) => s.storeId === sid);
        const storeLabel = (storeOpt && storeOpt.name) || '';
        wx.showToast({
          title: storeLabel ? `已入账 · ${storeLabel}` : '入账成功',
          icon: 'success',
        });
    } catch(e) {
        console.error(e);
        wx.hideLoading();
        wx.showToast({ title: '保存失败', icon: 'none' });
    }
},

  /** 店长手动触发：小程序商城订单写入 mp* 对账字段（仅超管） */
  async reconcileMpOrders() {
    if (!this.data.isSuperAdmin) {
      wx.showToast({ title: '仅超管可对账同步', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '对账中…', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'syncFinanceData',
        data: { action: 'reconcile_online_orders', persist: true },
        timeout: 60000,
      });
      const result = (res && res.result) || {};
      wx.hideLoading();
      if (result.success) {
        wx.showToast({ title: result.message || '对账完成', icon: 'none', duration: 3000 });
        this.loadRevenues();
      } else {
        wx.showToast({ title: result.message || '对账失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '对账请求失败', icon: 'none' });
    }
  },

  async loadFramers() {
    this.setData({ framerLoading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaff',
        data: { action: 'listArtisanAdmin' }
      });
      const result = (res && res.result) || {};
      if (result.success && Array.isArray(result.list)) {
        const list = result.list;
        this.setData({
          framers: list,
          framerList: list,
          framerNames: list.map((f) => f.name),
          framerAdminStats: result.stats || { total: list.length, active: 0, bound: 0, duplicateNames: 0, duplicateRows: 0 },
          framerStaffCandidates: Array.isArray(result.staffCandidates) ? result.staffCandidates : [],
          framerLoading: false
        });
        this.applyFramerFilters();
        return;
      }
      throw new Error(result.msg || 'listArtisanAdmin failed');
    } catch (e) {
      console.warn('loadFramers admin fallback', e);
      try {
        const res = await db.collection('framers').get();
        const list = (res.data || []).map((row) => ({
          ...row,
          typeLabel: row.type === 'partner' || row.type === 'guest' ? '特邀' : '门店',
          active: row.active !== false,
          statusLabel: row.active === false ? '下架' : '上架',
          staffBound: !!String(row.staffOpenid || '').trim(),
          staffName: '',
          staffOpenidTail: String(row.staffOpenid || '').slice(-6),
          isCanonical: false,
          isDuplicate: false,
          duplicateCount: 1,
          worksCount: 0,
          galleryCount: Array.isArray(row.gallery) ? row.gallery.length : 0
        }));
        this.setData({
          framers: list,
          framerList: list,
          framerNames: list.map((f) => f.name),
          framerAdminStats: {
            total: list.length,
            active: list.filter((x) => x.active).length,
            bound: list.filter((x) => x.staffBound).length,
            duplicateNames: 0,
            duplicateRows: 0
          },
          framerStaffCandidates: [],
          framerLoading: false
        });
        this.applyFramerFilters();
      } catch (err) {
        console.error('loadFramers', err);
        this.setData({
          framers: [],
          framersView: [],
          framerList: [],
          framerNames: [],
          framerLoading: false
        });
        wx.showToast({ title: '标本师加载失败', icon: 'none' });
      }
    }
  },

  applyFramerFilters() {
    const q = String(this.data.framerQuery || '').trim().toLowerCase();
    const typeFilter = this.data.framerTypeFilter || 'all';
    const statusFilter = this.data.framerStatusFilter || 'all';
    const dupOnly = !!this.data.framerDupOnly;
    const list = Array.isArray(this.data.framers) ? this.data.framers : [];
    const view = list.filter((item) => {
      if (!item) return false;
      if (typeFilter === 'store' && item.type === 'partner') return false;
      if (typeFilter === 'partner' && item.type !== 'partner') return false;
      if (statusFilter === 'active' && item.active === false) return false;
      if (statusFilter === 'off' && item.active !== false) return false;
      if (dupOnly && !item.isDuplicate) return false;
      if (!q) return true;
      const hay = [
        item.name,
        item.alias,
        item.title,
        item.staffName,
        item.typeLabel,
        item.staffOpenidTail
      ].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    this.setData({ framersView: view });
  },

  onFramerQueryInput(e) {
    this.setData({ framerQuery: (e.detail && e.detail.value) || '' });
    this.applyFramerFilters();
  },

  clearFramerQuery() {
    this.setData({ framerQuery: '' });
    this.applyFramerFilters();
  },

  setFramerTypeFilter(e) {
    const v = (e.currentTarget.dataset && e.currentTarget.dataset.value) || 'all';
    this.setData({ framerTypeFilter: v });
    this.applyFramerFilters();
  },

  setFramerStatusFilter(e) {
    const v = (e.currentTarget.dataset && e.currentTarget.dataset.value) || 'all';
    this.setData({ framerStatusFilter: v });
    this.applyFramerFilters();
  },

  toggleFramerDupOnly() {
    this.setData({ framerDupOnly: !this.data.framerDupOnly });
    this.applyFramerFilters();
  },

  async callManageStaffArtisan(action, data) {
    const res = await wx.cloud.callFunction({
      name: 'manageStaff',
      data: { action, ...(data || {}) }
    });
    const result = (res && res.result) || {};
    if (!result.success) {
      const err = new Error(result.msg || '操作失败');
      err.code = result.code || '';
      err.msg = result.msg || '';
      throw err;
    }
    return result;
  },

  openFramerPublic(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim();
    if (!id) {
      wx.showToast({ title: '该标本师暂无主页', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/subpackages/business/framer/index?id=${id}`,
      fail: () => wx.showToast({ title: '主页暂不可用', icon: 'none' })
    });
  },

  openFramerModal(e) {
    const source = Array.isArray(this.data.framers) ? this.data.framers : [];
    const item = resolveListItem(source, e);
    this.setData({
      showFramerModal: true,
      isEditing: !!(item && item._id),
      editId: item && item._id ? item._id : '',
      tempFramer: item
        ? {
            name: item.name || '',
            avatar: item.avatar || '',
            type: item.type || 'store',
            bio: item.bio || '',
            priceDelta: item.priceDelta != null ? item.priceDelta : 0,
            extraDays: item.extraDays != null ? item.extraDays : 0,
            active: item.active !== false,
            staffOpenid: item.staffOpenid || '',
            staffName: item.staffName || '',
            staffBound: !!item.staffBound,
            isCanonical: !!item.isCanonical,
            isDuplicate: !!item.isDuplicate,
            duplicateCount: item.duplicateCount || 1,
            worksCount: item.worksCount || 0
          }
        : {
            name: '',
            avatar: '',
            type: 'store',
            bio: '',
            priceDelta: 0,
            extraDays: 0,
            active: true,
            staffOpenid: '',
            staffName: '',
            staffBound: false,
            isCanonical: false,
            isDuplicate: false,
            duplicateCount: 1,
            worksCount: 0
          }
    });
  },

  chooseFramerImage() {
    wx.chooseImage({
      count: 1,
      success: (res) => {
        const path = res.tempFilePaths && res.tempFilePaths[0];
        if (path) this.setData({ 'tempFramer.avatar': path });
      }
    });
  },

  bindFInput(e) {
    this.setData({ [`tempFramer.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  bindFTypeChange(e) {
    this.setData({ 'tempFramer.type': e.detail.value });
  },

  bindFActiveChange(e) {
    this.setData({ 'tempFramer.active': !!(e.detail && e.detail.value) });
  },

  async submitFramer() {
    const f = this.data.tempFramer || {};
    if (!String(f.name || '').trim()) {
      return wx.showToast({ title: '请填写姓名', icon: 'none' });
    }
    wx.showLoading({ title: '保存中…', mask: true });
    try {
      let avatar = f.avatar || '';
      if (avatar && !isRemoteMediaUrl(avatar)) {
        const up = await wx.cloud.uploadFile({ cloudPath: `framers/${Date.now()}.png`, filePath: avatar });
        avatar = up.fileID;
      }
      const data = {
        name: String(f.name).trim(),
        type: f.type || 'store',
        bio: f.bio || '',
        avatar,
        priceDelta: parseFloat(f.priceDelta) || 0,
        extraDays: parseInt(f.extraDays, 10) || 0,
        active: f.active !== false
      };
      if (this.data.isEditing && this.data.editId) {
        await callStoreContent({ action: 'upsert', collection: 'framers', id: this.data.editId, data });
      } else {
        await callStoreContent({ action: 'upsert', collection: 'framers', data });
      }
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showFramerModal: false });
      this.loadFramers();
    } catch (e) {
      console.error('submitFramer', e);
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' });
    }
  },

  async toggleFramerActive(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim();
    const nextActive = String((e.currentTarget.dataset && e.currentTarget.dataset.active) || '') !== '1';
    if (!id) return;
    wx.showLoading({ title: nextActive ? '上架中…' : '下架中…', mask: true });
    try {
      const result = await this.callManageStaffArtisan('setArtisanActive', {
        framerId: id,
        active: nextActive
      });
      wx.hideLoading();
      wx.showToast({ title: result.msg || (nextActive ? '已上架' : '已下架'), icon: 'success' });
      this.loadFramers();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(err, '操作失败'), icon: 'none' });
    }
  },

  openFramerBindSheet(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || this.data.editId || '').trim();
    if (!id) {
      wx.showToast({ title: '请先保存档案', icon: 'none' });
      return;
    }
    const candidates = Array.isArray(this.data.framerStaffCandidates) ? this.data.framerStaffCandidates : [];
    this.setData({
      showFramerBindSheet: true,
      framerBindTargetId: id,
      framerBindKeyword: '',
      framerBindCandidatesView: candidates
    });
  },

  closeFramerBindSheet() {
    this.setData({ showFramerBindSheet: false, framerBindTargetId: '', framerBindKeyword: '' });
  },

  onFramerBindKeyword(e) {
    const kw = String((e.detail && e.detail.value) || '').trim().toLowerCase();
    const all = Array.isArray(this.data.framerStaffCandidates) ? this.data.framerStaffCandidates : [];
    const view = !kw
      ? all
      : all.filter((row) => {
          const hay = [row.name, row.openidTail, row.roleText].join(' ').toLowerCase();
          return hay.indexOf(kw) !== -1;
        });
    this.setData({ framerBindKeyword: (e.detail && e.detail.value) || '', framerBindCandidatesView: view });
  },

  async bindFramerStaffPick(e) {
    const staffOpenid = String((e.currentTarget.dataset && e.currentTarget.dataset.openid) || '').trim();
    const framerId = String(this.data.framerBindTargetId || '').trim();
    if (!staffOpenid || !framerId) return;
    wx.showLoading({ title: '绑定中…', mask: true });
    try {
      const result = await this.callManageStaffArtisan('bindArtisanStaff', {
        framerId,
        staffOpenid,
        pin: true
      });
      wx.hideLoading();
      wx.showToast({ title: result.msg || '已绑定', icon: 'success' });
      this.setData({ showFramerBindSheet: false, showFramerModal: false });
      this.loadFramers();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(err, '绑定失败'), icon: 'none' });
    }
  },

  async unbindFramerStaff(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || this.data.editId || '').trim();
    if (!id) return;
    const conf = await new Promise((resolve) => {
      wx.showModal({
        title: '解除绑定',
        content: '解绑后该员工将不再关联此标本师档案。确定？',
        success: (r) => resolve(!!r.confirm)
      });
    });
    if (!conf) return;
    wx.showLoading({ title: '解绑中…', mask: true });
    try {
      const result = await this.callManageStaffArtisan('bindArtisanStaff', {
        framerId: id,
        unbind: true
      });
      wx.hideLoading();
      wx.showToast({ title: result.msg || '已解绑', icon: 'success' });
      this.setData({ showFramerModal: false, showFramerBindSheet: false });
      this.loadFramers();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(err, '解绑失败'), icon: 'none' });
    }
  },

  async pinFramerCanonical(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || this.data.editId || '').trim();
    const item = (this.data.framers || []).find((row) => row && row._id === id);
    if (!id) return;
    if (!item || !item.staffBound) {
      wx.showToast({ title: '请先绑定员工', icon: 'none' });
      return;
    }
    const hasDup = !!(item && item.isDuplicate);
    const sheet = await new Promise((resolve) => {
      wx.showActionSheet({
        itemList: hasDup
          ? ['设为权威档案', '设为权威并下架同名重复']
          : ['设为权威档案'],
        success: (r) => resolve(r),
        fail: () => resolve(null)
      });
    });
    if (!sheet || typeof sheet.tapIndex !== 'number') return;
    const deactivateOthers = hasDup && sheet.tapIndex === 1;
    wx.showLoading({ title: '处理中…', mask: true });
    try {
      const result = await this.callManageStaffArtisan('pinArtisanCanonical', {
        framerId: id,
        deactivateOthers
      });
      wx.hideLoading();
      wx.showToast({ title: result.msg || '已设为权威', icon: 'success' });
      this.setData({ showFramerModal: false });
      this.loadFramers();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(err, '设置失败'), icon: 'none' });
    }
  },

  async resolveFramerDuplicates(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim();
    const item = (this.data.framers || []).find((row) => row && row._id === id);
    if (!id || !item) return;
    if (!item.staffBound) {
      wx.showToast({ title: '请先绑定员工，再处理重复', icon: 'none' });
      return;
    }
    const conf = await new Promise((resolve) => {
      wx.showModal({
        title: '处理同名重复',
        content: `以「${item.name}」当前档案为权威，将同名/同人其它档案下架并解除绑定。公开主页会按权威档案汇总展示。`,
        confirmText: '确认处理',
        success: (r) => resolve(!!r.confirm)
      });
    });
    if (!conf) return;
    wx.showLoading({ title: '处理中…', mask: true });
    try {
      const result = await this.callManageStaffArtisan('pinArtisanCanonical', {
        framerId: id,
        deactivateOthers: true
      });
      wx.hideLoading();
      wx.showToast({ title: result.msg || '已处理', icon: 'success' });
      this.loadFramers();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(err, '处理失败'), icon: 'none' });
    }
  },

  async loadRewards() {
    try {
      const res = await db.collection('rewards').orderBy('cost', 'asc').get();
      this.setData({ rewards: res.data || [] });
    } catch (e) {
      console.error('loadRewards', e);
      this.setData({ rewards: [] });
      wx.showToast({ title: '积分藏品加载失败', icon: 'none' });
    }
  },
  async loadVipLevels() {
    this.setData({ vipLevelsLoading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageMemberLevels',
        data: { action: 'list' }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        throw new Error(result.msg || '会员等级加载失败');
      }
      this.setData({
        vipLevels: Array.isArray(result.levels) ? result.levels : [],
        vipLevelsSource: result.source || '',
        vipLevelsLoading: false
      });
    } catch (e) {
      console.error('loadVipLevels', e);
      this.setData({ vipLevels: [], vipLevelsSource: '', vipLevelsLoading: false });
      wx.showToast({ title: formatCloudFnError(e, '会员等级加载失败'), icon: 'none' });
    }
  },
  openRewardModal(e) {
    const item = resolveListItem(this.data.rewards, e);
    this.setData({
      showRewardModal: true,
      isEditing: !!(item && item._id),
      editId: item && item._id ? item._id : '',
      tempReward: item
        ? {
            image: item.image || '',
            title: item.title || '',
            cost: item.cost != null ? item.cost : '',
            stock: item.stock != null ? item.stock : 99,
            type: item.type || 'virtual',
            description: item.description || '',
            value: item.value || '',
            minSpend: item.minSpend || '',
            expireDays: item.expireDays || '',
            limitPerUser: item.limitPerUser || '',
            channel: item.channel || 'all'
          }
        : {
            image: '', title: '', cost: '', stock: 99, type: 'virtual',
            description: '', value: '', minSpend: '', expireDays: '', limitPerUser: '',
            channel: 'all'
          }
    });
  },
  openVipModal(e) {
    let item = resolveListItem(this.data.vipLevels, e);
    if (!item) {
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
      const level = Number(ds.level);
      if (Number.isFinite(level)) {
        item = (this.data.vipLevels || []).find((row) => row && Number(row.level) === level) || null;
      }
    }
    const benefits = Array.isArray(item && item.benefits)
      ? item.benefits
      : (Array.isArray(item && item.privileges) ? item.privileges : []);
    const discountRate = item
      ? (item.discountRate != null ? item.discountRate : item.discount)
      : '';
    this.setData({
      showVipModal: true,
      isEditing: !!(item && (item._id || item.level != null)),
      editId: item && item._id ? item._id : '',
      tempVip: item
        ? {
            level: item.level != null ? item.level : '',
            name: item.name || '',
            threshold: item.threshold != null ? item.threshold : 0,
            discountRate: discountRate != null ? discountRate : '',
            benefitsStr: benefits.join('，'),
            icon: item.icon || ''
          }
        : { level: '', name: '', threshold: 0, discountRate: '1', benefitsStr: '', icon: '' }
    });
  },
  chooseRewardImage() {
    wx.chooseImage({
      count: 1,
      success: (res) => {
        const path = res.tempFilePaths && res.tempFilePaths[0];
        if (path) this.setData({ 'tempReward.image': path });
      }
    });
  },
  bindRInput(e) { this.setData({ [`tempReward.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  bindRTypeChange(e) { this.setData({ 'tempReward.type': e.detail.value }); },
  bindRChannelChange(e) { this.setData({ 'tempReward.channel': e.detail.value || 'online' }); },
  bindVInput(e) { this.setData({ [`tempVip.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  async submitReward() {
    const r = this.data.tempReward || {};
    if (!String(r.title || '').trim()) {
      return wx.showToast({ title: '请填写标题', icon: 'none' });
    }
    if (!r.image) {
      return wx.showToast({ title: '请上传图片', icon: 'none' });
    }
    wx.showLoading({ title: '保存中…', mask: true });
    try {
      let img = String(r.image);
      if (!isRemoteMediaUrl(img)) {
        const up = await wx.cloud.uploadFile({ cloudPath: `rewards/${Date.now()}.png`, filePath: img });
        img = up.fileID;
      }
      const toNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      // 不再下发 isOffShelf：小程序端没有上架开关，交由服务端保留既有状态，
      // 否则每次在超管工作台改库存/文案都会把 ERP 下架的兑换品静默重新上架。
      const data = {
        title: String(r.title).trim(),
        cost: parseInt(r.cost, 10) || 0,
        stock: parseInt(r.stock, 10) || 0,
        type: r.type || 'virtual',
        description: r.description || '',
        image: img,
        value: toNum(r.value),
        minSpend: toNum(r.minSpend),
        expireDays: parseInt(r.expireDays, 10) || 0,
        limitPerUser: parseInt(r.limitPerUser, 10) || 0,
        channel: ['online', 'store', 'all'].indexOf(String(r.channel || '')) !== -1
          ? String(r.channel)
          : 'all'
      };
      if (this.data.isEditing && this.data.editId) {
        await callStoreContent({ action: 'upsert', collection: 'rewards', id: this.data.editId, data });
      } else {
        await callStoreContent({ action: 'upsert', collection: 'rewards', data });
      }
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showRewardModal: false });
      this.loadRewards();
    } catch (e) {
      console.error('submitReward', e);
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' });
    }
  },
  async submitVipLevel() {
    const v = this.data.tempVip || {};
    if (v.level === '' || v.level == null) {
      return wx.showToast({ title: '请填写等级', icon: 'none' });
    }
    if (!String(v.name || '').trim()) {
      return wx.showToast({ title: '请填写名称', icon: 'none' });
    }
    wx.showLoading({ title: '保存中…', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageMemberLevels',
        data: {
          action: 'upsert',
          id: this.data.isEditing && this.data.editId ? this.data.editId : '',
          data: {
            level: parseInt(v.level, 10),
            name: String(v.name || '').trim(),
            threshold: parseInt(v.threshold, 10) || 0,
            discountRate: v.discountRate,
            benefitsStr: v.benefitsStr || '',
            icon: v.icon || ''
          }
        }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        throw new Error(result.msg || '保存失败');
      }
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showVipModal: false });
      this.loadVipLevels();
    } catch (e) {
      console.error('submitVipLevel', e);
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' });
    }
  },
  deleteReward(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return wx.showToast({ title: '缺少藏品 ID', icon: 'none' });
    wx.showModal({
      title: '删除',
      content: '确定删除该积分藏品？',
      confirmColor: '#D64045',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中…', mask: true });
        try {
          await callStoreContent({ action: 'remove', collection: 'rewards', id });
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadRewards();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: formatCloudFnError(err, '删除失败'), icon: 'none' });
        }
      }
    });
  },

  async loadActivities() {
    try {
      const res = await db.collection('activities').get();
      this.setData({ activities: res.data || [] });
    } catch (e) {
      console.error('loadActivities', e);
      this.setData({ activities: [] });
      wx.showToast({ title: '活动加载失败', icon: 'none' });
    }
  },
  openActivityModal(e) {
    const item = resolveListItem(this.data.activities, e);
    this.setData({
      showActivityModal: true,
      isEditing: !!(item && item._id),
      editId: item && item._id ? item._id : '',
      tempActivity: item
        ? {
            title: item.title || '',
            type: item.type || 'course',
            date: item.date || '',
            time: item.time || '',
            price: item.price != null ? item.price : '',
            maxPeople: item.maxPeople != null ? item.maxPeople : '',
            location: item.location || '本店',
            image: item.image || ''
          }
        : { title: '', type: 'course', date: '', time: '', price: '', maxPeople: '', location: '本店', image: '' }
    });
  },
  chooseActivityImage() {
    wx.chooseImage({
      count: 1,
      success: (res) => {
        const path = res.tempFilePaths && res.tempFilePaths[0];
        if (path) this.setData({ 'tempActivity.image': path });
      }
    });
  },
  bindAInput(e) { this.setData({ [`tempActivity.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  bindADateChange(e) { this.setData({ 'tempActivity.date': e.detail.value }); },
  bindATypeChange(e) { this.setData({ 'tempActivity.type': e.detail.value }); },
  async submitActivity() {
    const a = this.data.tempActivity || {};
    if (!String(a.title || '').trim() || !a.date) {
      return wx.showToast({ title: '请填写标题和日期', icon: 'none' });
    }
    wx.showLoading({ title: '发布中…', mask: true });
    try {
      let img = a.image || '';
      if (img && !isRemoteMediaUrl(img)) {
        const up = await wx.cloud.uploadFile({ cloudPath: `activities/${Date.now()}.png`, filePath: img });
        img = up.fileID;
      }
      const maxPeople = parseInt(a.maxPeople, 10) || 0;
      const data = {
        title: String(a.title).trim(),
        type: a.type || 'course',
        date: a.date,
        time: a.time || '',
        price: parseFloat(a.price || 0),
        maxPeople,
        location: a.location || '本店',
        image: img,
        status: 'open',
        remain: maxPeople
      };
      if (this.data.isEditing && this.data.editId) {
        await callStoreContent({ action: 'upsert', collection: 'activities', id: this.data.editId, data });
      } else {
        await callStoreContent({ action: 'upsert', collection: 'activities', data });
      }
      wx.hideLoading();
      wx.showToast({ title: '已发布', icon: 'success' });
      this.setData({ showActivityModal: false });
      this.loadActivities();
    } catch (e) {
      console.error('submitActivity', e);
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(e, '发布失败'), icon: 'none' });
    }
  },
  deleteActivity(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return wx.showToast({ title: '缺少活动 ID', icon: 'none' });
    wx.showModal({
      title: '删除',
      content: '确定删除该活动？',
      confirmColor: '#D64045',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中…', mask: true });
        try {
          await callStoreContent({ action: 'remove', collection: 'activities', id });
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadActivities();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: formatCloudFnError(err, '删除失败'), icon: 'none' });
        }
      }
    });
  },

 // 加载分类树（与 Admin 同源：categories 全量有效一二级，不套白名单）
 async loadCategoriesTree() {
  try {
    let tree = await loadCategoryPickerTree(db, { canonicalOnly: false });
    // 库空时才种子同步，避免 purge 掉 Admin 自建分类
    if (!(tree.categoryRoots || []).length) {
      await this.ensureDefaultCategories();
      tree = await loadCategoryPickerTree(db, { canonicalOnly: false });
    }
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
    // 与 Admin / 录入藏品同源：云库全部有效一二级；不强制六馆白名单。
    // 「同步标准分类」才跑 seedCategories sync（会停用非标准一级）。
    let tree = await loadCategoryPickerTree(db, { canonicalOnly: false });
    if (!(tree.categoryRoots || []).length) {
      await this.ensureDefaultCategories();
      tree = await loadCategoryPickerTree(db, { canonicalOnly: false });
    }
    let productCounts = {};
    try {
      productCounts = await fetchProductCountsByCategoryId(db);
    } catch (countErr) {
      console.warn('fetchProductCountsByCategoryId', countErr);
    }
    const manage = buildCategoryManageTree(tree.categoryRoots, tree.allSubs || [], {
      canonicalOnly: false,
      productCounts
    });
    this.setData({
      categoryManageTree: manage.categoryManageTree,
      catManageRootNames: manage.catManageRootNames,
      categories: manage.categories
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
  syncProductTaxonomyFlags(this);
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
  const tax = toChineseTaxonomy(subCat.taxonomy || {});
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
  syncProductTaxonomyFlags(this);
},

// === 🟢 新增/修改：订单发货逻辑 ===

  /** 门店自取：店员确认顾客已到店取件 */
  completeStorePickup(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const orderNo = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.orderno) || '')
    const code = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.code) || '')
    if (!id) {
      wx.showToast({ title: '订单信息缺失', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认门店自取',
      content: `确认订单 ${orderNo || id} 已由顾客到店领取？${code ? `\n自取码 ${code}` : ''}\n确认后订单将标记为已完成。`,
      confirmText: '确认自取',
      confirmColor: '#C4A76C',
      success: (res) => {
        if (!res.confirm) return
        this.submitCompleteStorePickup(id)
      }
    })
  },

  /** 复制门店自取码（现场核对 / 转告顾客） */
  copyPickupCode(e) {
    const code = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.code) || '').trim()
    if (!code) {
      wx.showToast({ title: '该订单暂无自取码', icon: 'none' })
      return
    }
    wx.setClipboardData({ data: code, success: () => wx.vibrateShort({ type: 'light' }) })
  },

  async submitCompleteStorePickup(orderId) {
    wx.showLoading({ title: '确认中…', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'managerShipOrder',
        data: { action: 'completeStorePickup', orderId }
      })
      const result = (res && res.result) || {}
      wx.hideLoading()
      if (!result.success) {
        wx.showToast({ title: result.msg || '确认失败', icon: 'none' })
        return
      }
      const omPoints = Number(result.pointsGranted) || 0
      if (!result.already && omPoints > 0) {
        wx.showToast({ title: `已确认自取，顾客获赠 ${omPoints} 积分`, icon: 'none' })
      } else {
        wx.showToast({
          title: result.already ? '此前已自取' : '已确认自取',
          icon: 'success'
        })
      }
      this.loadOmTab('pending', { append: false })
      this.loadOmTab('completed', { append: false })
      if (typeof this.loadOpsOrderCounts === 'function') this.loadOpsOrderCounts()
    } catch (err) {
      wx.hideLoading()
      console.error('completeStorePickup', err)
      wx.showToast({ title: (err && err.message) || '确认失败', icon: 'none' })
    }
  },

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
    const listed = (this.data.orders || []).find((o) => o._id === orderId);
    const addrSubmitted =
      listed &&
      listed.giftMeta &&
      listed.giftMeta.addressStatus === 'submitted';
    if (
      listed &&
      listed.giftAwaitingAddress &&
      !addrSubmitted
    ) {
      wx.showToast({ title: '礼赠待填址，暂不可发货', icon: 'none' });
      return;
    }
    if (
      listed &&
      listed.status === 'paid_awaiting_address' &&
      !addrSubmitted
    ) {
      wx.showToast({ title: '礼赠待填址，暂不可发货', icon: 'none' });
      return;
    }
    if (listed && (listed.isStorePickup || listed.canCompletePickup || listed.status === 'ready_pickup')) {
      wx.showToast({ title: '门店自取请点「确认自取」', icon: 'none' });
      return;
    }
    const defaultCarrier =
      (this.data.shippingForm && this.data.shippingForm.defaultCarrier) ||
      '顺丰速运';
    this.setData({
      showShipModal: true,
      tempShip: {
        orderId,
        orderNo,
        carrier: String(defaultCarrier).trim() || '顺丰速运',
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

  selectShipCarrier(e) {
    const carrier = String((e.currentTarget.dataset && e.currentTarget.dataset.carrier) || '').trim();
    if (!carrier) return;
    this.setData({ 'tempShip.carrier': carrier });
  },

  pasteTrackingNumber() {
    wx.getClipboardData({
      success: (res) => {
        const parsed = normalizeTrackingInput(res && res.data);
        if (!parsed || parsed.length < 6) {
          wx.showToast({ title: '剪贴板无有效单号', icon: 'none' });
          return;
        }
        this.setData({ 'tempShip.trackingNumber': parsed });
        wx.showToast({ title: '已粘贴单号', icon: 'none' });
      },
      fail: () => wx.showToast({ title: '读取剪贴板失败', icon: 'none' })
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

    wx.showLoading({ title: '发货中…', mask: true });

    try {
      // 订单备注：带上卡片里正在编辑的值（未保存也会随本次发货写入并发出）
      const noteRow = (this.data.orders || []).find((o) => o && o._id === orderId)
      const shipNote = String((noteRow && noteRow.managerNote) || '').trim().slice(0, ORDER_NOTE_MAX)
      const res = await wx.cloud.callFunction({
        name: 'managerShipOrder',
        data: {
          orderId,
          carrier: (carrier || '快递').trim(),
          trackingNumber,
          note: shipNote
        }
      });
      const result = res.result || {};

      wx.hideLoading();

      if (!result.success) {
        wx.showToast({ title: result.msg || '发货失败', icon: 'none' });
        return;
      }

      const express = result.expressSync || {};
      const expressOk = express.status === 'ok' || (express.status === 'partial' && express.waybillToken);
      const nextCarrier = String(carrier || '顺丰速运').trim() || '顺丰速运';
      this.setData({
        showShipModal: false,
        subTab: 1,
        tempShip: { orderId: '', orderNo: '', carrier: nextCarrier, trackingNumber: '' }
      });
      this.loadOrders();
      this.loadShippedOrders();
      this.loadOpsOrderCounts();

      if (expressOk) {
        wx.showToast({ title: '发货成功，已切到已发货', icon: 'none' });
      } else if (express.skipReason || express.error) {
        const reason = String(express.error || express.skipReason || '');
        const tokenHint =
          /access_token|WX_APP_SECRET|AppSecret|openapi/i.test(reason)
            ? '\n\n说明：发货本身已成功；这是轨迹同步凭证问题，不是物流服务未开通。请确认云函数已配置 WX_APP_SECRET 并重新部署。'
            : '';
        wx.showModal({
          title: '发货成功',
          content:
            '订单已标记为已发货，并已切换到「已发货」。官方物流轨迹同步失败，用户端会暂时显示「复制单号查询」。\n\n详情：' +
            reason.slice(0, 140) +
            tokenHint,
          showCancel: false,
          confirmText: '知道了'
        });
      } else if (!result.messageSent) {
        wx.showToast({ title: '已发货，已切到已发货', icon: 'none' });
      } else {
        wx.showToast({ title: '发货成功，已切到已发货', icon: 'none' });
      }
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
      showFramerBindSheet: false,
      showCatModal: false,
      showCatLinkModal: false,
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
    // 兼容旧入口：落到藏品库「分类管理」子 Tab
    if (this.data.curTab !== 1) {
      if (!canAccessManagerTab(this.data.workspaceRole, 1)) {
        wx.showToast({ title: '无此功能权限', icon: 'none' });
        return;
      }
      goManagerModule(1, '藏品库', 'productTab=category');
      return;
    }
    this.setData({
      showCatModal: false,
      newCatName: '',
      newCatEn: '',
      newCatLevel: 1,
      newCatParentIndex: 0
    });
    this.setProductLibTab('category');
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
      wx.showToast({ title: '分类已同步', icon: 'success' });
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

    wx.showLoading({ title: '添加中…', mask: true });
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
        await callStoreContent({
          action: 'upsert',
          collection: 'categories',
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
        await callStoreContent({
          action: 'upsert',
          collection: 'categories',
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
      : '确认删除该二级分类？删除后藏品 categoryId 可能悬空，建议先在「关联」里改挂。';

    wx.showModal({
      title,
      content,
      confirmColor: '#C4A76C',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中…' });
        try {
          if (level === 1) {
            await callStoreContent({
              action: 'removeWhere',
              collection: 'categories',
              where: { level: 2, parentId: id },
              limit: 100
            });
          }
          await callStoreContent({ action: 'remove', collection: 'categories', id });
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

  async fillL2LatinNames() {
    wx.showLoading({ title: '补齐拉丁名…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'seedCategories',
        data: { action: 'fillL2LatinNames', dryRun: false, force: false }
      });
      wx.hideLoading();
      const result = res.result || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || '补齐失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: result.msg || '已补齐', icon: 'success' });
      await this.loadCategoriesManage();
      await this.loadCategoriesTree();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '请先部署 seedCategories', icon: 'none' });
    }
  },

  async repairProductCategoryLinks() {
    wx.showModal({
      title: '修复藏品关联',
      content: '将把藏品上指向已删除/旧二级 id，或仅有短名 category 的记录，迁到当前启用的二级分类。确定继续？',
      confirmColor: '#C4A76C',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '修复中…' });
        try {
          const r = await wx.cloud.callFunction({
            name: 'seedCategories',
            data: { action: 'repairProductCategoryLinks', dryRun: false }
          });
          wx.hideLoading();
          const result = r.result || {};
          if (!result.success) {
            wx.showToast({ title: result.msg || '修复失败', icon: 'none' });
            return;
          }
          wx.showModal({
            title: '修复完成',
            content: result.msg || `已修复 ${result.updated || 0} 件`,
            showCancel: false
          });
          await this.loadCategoriesManage();
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: '请先部署 seedCategories', icon: 'none' });
        }
      }
    });
  },

  openCatLinkModal(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '';
    this.setData({
      showCatLinkModal: true,
      catLinkTarget: { _id: id, name },
      catLinkMode: 'auto',
      catLinkPreview: [],
      catLinkMatchCount: 0,
      catLinkAlreadyCount: 0,
      catLinkLastResult: null,
      catLinkLoading: false,
      catLinkEmptyHint: '正在扫描候选…'
    }, () => {
      this.previewCatLink('auto');
    });
  },

  closeCatLinkModal() {
    this.setData({ showCatLinkModal: false, catLinkTarget: null });
  },

  async previewCatLink(modeArg) {
    const target = this.data.catLinkTarget;
    if (!target || !target._id) return;
    const mode = modeArg === 'all' || modeArg === 'auto'
      ? modeArg
      : (this.data.catLinkMode || 'auto');
    this.setData({ catLinkMode: mode, catLinkLoading: true });
    wx.showLoading({ title: '扫描匹配…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'seedCategories',
        data: {
          action: 'previewLinkProducts',
          categoryId: target._id,
          mode
        }
      });
      wx.hideLoading();
      const result = res.result || {};
      if (!result.success) {
        this.setData({
          catLinkLoading: false,
          catLinkEmptyHint: result.msg || '预览失败'
        });
        wx.showToast({ title: result.msg || '预览失败', icon: 'none' });
        return;
      }
      const preview = (result.preview || []).map((p) => ({
        ...p,
        reasons: Array.isArray(p.reasons) ? p.reasons.join('/') : (p.reasons || '')
      }));
      const matchCount = result.matchCount || 0;
      const already = result.alreadyLinkedCount || 0;
      let emptyHint = '';
      if (!matchCount) {
        emptyHint = already
          ? `已有 ${already} 件挂在本分类；暂无更多可补挂候选。`
          : (mode === 'all'
            ? '一键全部规则下仍无候选：本馆可能没有可挂载的未分类藏品。'
            : '自动规则下无匹配。可点「一键全部」扩大到同馆未分类。');
      }
      this.setData({
        catLinkPreview: preview,
        catLinkMatchCount: matchCount,
        catLinkAlreadyCount: already,
        catLinkLoading: false,
        catLinkEmptyHint: emptyHint
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({
        catLinkLoading: false,
        catLinkEmptyHint: '请先部署 seedCategories'
      });
      wx.showToast({ title: '请先部署 seedCategories', icon: 'none' });
    }
  },

  async oneClickCatLink(e) {
    const mode = e.currentTarget.dataset.mode === 'all' ? 'all' : 'auto';
    const target = this.data.catLinkTarget;
    if (!target || !target._id) return;
    await this.previewCatLink(mode);
    const count = this.data.catLinkMatchCount || 0;
    if (!count) {
      wx.showToast({ title: this.data.catLinkEmptyHint || '无匹配藏品', icon: 'none' });
      return;
    }
    wx.showModal({
      title: mode === 'all' ? '一键全部关联' : '自动关联',
      content: `将把约 ${count} 件匹配藏品挂到「${target.name}」。可随后撤销。`,
      confirmColor: '#C4A76C',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '关联中…' });
        try {
          const r = await wx.cloud.callFunction({
            name: 'seedCategories',
            data: {
              action: 'linkProducts',
              categoryId: target._id,
              mode
            }
          });
          wx.hideLoading();
          const result = r.result || {};
          if (!result.success) {
            wx.showToast({ title: result.msg || '关联失败', icon: 'none' });
            return;
          }
          this.setData({
            catLinkLastResult: {
              linkedCount: result.linkedCount || 0,
              linked: result.linked || [],
              categoryId: target._id
            },
            catLinkMatchCount: 0,
            catLinkPreview: (result.preview || []).map((p) => ({
              ...p,
              reasons: '已关联'
            }))
          });
          wx.showModal({
            title: '关联完成',
            content: result.msg || `已关联 ${result.linkedCount || 0} 件`,
            showCancel: false
          });
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '关联失败', icon: 'none' });
        }
      }
    });
  },

  async undoCatLink() {
    const last = this.data.catLinkLastResult;
    if (!last || !last.linked || !last.linked.length) {
      wx.showToast({ title: '没有可撤销的记录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '撤销关联',
      content: `恢复上次关联的 ${last.linkedCount || last.linked.length} 件藏品的原分类字段？`,
      confirmColor: '#C4A76C',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '撤销中…' });
        try {
          const r = await wx.cloud.callFunction({
            name: 'seedCategories',
            data: {
              action: 'unlinkProducts',
              categoryId: last.categoryId,
              linked: last.linked
            }
          });
          wx.hideLoading();
          const result = r.result || {};
          if (!result.success) {
            wx.showToast({ title: result.msg || '撤销失败', icon: 'none' });
            return;
          }
          this.setData({ catLinkLastResult: null, catLinkPreview: [], catLinkMatchCount: 0 });
          await this.previewCatLink(this.data.catLinkMode || 'auto');
          wx.showToast({ title: result.msg || '已撤销', icon: 'success' });
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: '撤销失败', icon: 'none' });
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
      // 种子导入是**更新**已有文档（title/统计不变），按 _createTime 排会看不出变化。
      // 这里按最近写入时间重排，并补一个正文字数——导入后一眼能看出内容确实被替换了。
      const rows = (res.data || []).map((a) => {
        const text = String(a.content || '').replace(/<[^>]+>/g, '');
        const len = text.replace(/\s/g, '').length;
        return { ...a, _textLen: len, _writtenAt: Number(a.updateTime) || 0 };
      });
      rows.sort((a, b) => (b._writtenAt || 0) - (a._writtenAt || 0));
      this.setData({ articles: rows }); 
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
      markCommunityContentStale()
      const st = result.stats || {}
      const artN = Number(st.articles) || 0
      const exhN = Number(st.exhibitions) || 0
      wx.showToast({
        title: artN || exhN ? `已导入 ${artN} 篇 / ${exhN} 专题` : '内容已导入',
        icon: 'none',
        duration: 2500
      })
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
          markCommunityContentStale()
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
    const { GUIDES, CATEGORY_META } = require('../utils/careDefaults');
    wx.showLoading({ title: '同步中…' });
    try {
      const items = Object.values(GUIDES).map((g) => {
        const meta = CATEGORY_META[g.category] || {};
        return {
          matchValue: g.guideId,
          data: {
            guideId: g.guideId,
            category: g.category,
            title: g.title,
            overline: g.overline || meta.overline || g.category,
            summary: g.summary || '',
            disclaimer: g.disclaimer || '',
            sections: g.sections || [],
            framingAddons: g.framingAddons || [],
            status: 'active',
            updateTime: Date.now(),
            createTime: Date.now()
          }
        };
      });
      const result = await callStoreContent({
        action: 'batchUpsertByField',
        collection: 'care_guides',
        matchField: 'guideId',
        bumpVersion: true,
        items
      });
      wx.hideLoading();
      wx.showToast({ title: `已同步 ${result.count || items.length} 篇`, icon: 'success' });
      this.loadCareGuides();
    } catch (e) {
      wx.hideLoading();
      console.error('seedCareGuidesFromDefaults', e);
      wx.showToast({ title: '同步失败', icon: 'none' });
    }
  },
  openCareGuideModal(e) {
    wx.vibrateShort({ type: 'light' });
    const item = resolveListItem(this.data.careGuides, e);
    const { CATEGORY_META } = require('../utils/careDefaults');
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
    const { CATEGORY_META } = require('../utils/careDefaults');
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
    wx.showLoading({ title: '保存…', mask: true });
    try {
      if (this.data.isEditing && this.data.editId) {
        await callStoreContent({
          action: 'upsert',
          collection: 'care_guides',
          id: this.data.editId,
          data: { ...data, version: (g.version || 1) + 1 }
        });
      } else {
        await callStoreContent({
          action: 'upsert',
          collection: 'care_guides',
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
          await callStoreContent({ action: 'remove', collection: 'care_guides', id });
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
      url: `/subpackages/feature/care/guide/index?category=${category}&from=manager_preview`
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
          targetLabel: c.targetLabel || c.productTitle || [c.targetType, c.targetId].filter(Boolean).join(' · '),
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
    wx.showLoading({ title: '处理中…' });
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
    wx.showLoading({ title: '提交中…', mask: true });
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
    const type = (e.currentTarget.dataset && e.currentTarget.dataset.type) || this.data.contentType || 'exhibition';
    const list = type === 'exhibition' ? this.data.exhibitions : this.data.articles;
    const item = resolveListItem(list, e);
    const isEditing = !!(item && item._id);
    
    // 编辑模式：使用现有数据
    if (isEditing && item) {
      const tagsStr = (item.tags && Array.isArray(item.tags)) ? item.tags.join(',') : (item.tagsStr || '');
      const relatedSkus = normalizeRelatedSkus(item.relatedSkus, item.relatedProductIds);
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
          content: item.content || '<p>在此处撰写精彩内容…</p>',
          tagsStr: tagsStr,
          category: item.category || 'knowledge',
          author: item.author || '山海造物',
          status: item.status || 'published',
          videoUrl: item.videoUrl || '',
          relatedSkus,
          relatedProductIds: relatedIdsFromSkus(relatedSkus),
          type: item.type || type
        }
      });
      this.loadRelatedProductPreview(relatedSkus);
    } else {
      const defaultContent = {
        title: '',
        latinName: '',
        themeHint: '',
        coverImage: '',
        brief: '',
        content: '<p>在此处撰写精彩内容…</p>',
        tagsStr: type === 'exhibition' ? '专题' : '',
        category: 'knowledge',
        author: '山海造物',
        status: 'published',
        videoUrl: '',
        relatedSkus: [],
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

  async loadRelatedProductPreview(relatedSkus) {
    const list = normalizeRelatedSkus(relatedSkus, []);
    if (!list.length) {
      this.setData({ relatedProductPreview: [] });
      return;
    }
    try {
      const ids = relatedIdsFromSkus(list);
      const res = await db.collection('products').where({ _id: _.in(ids) }).get();
      const map = {};
      (res.data || []).forEach((p) => { map[p._id] = p; });
      const preview = list.map((rel) => {
        const key = skuKey(rel.productId, rel.skuId);
        const p = map[rel.productId];
        if (!p) {
          return {
            key,
            _id: rel.productId,
            title: `未找到(${String(rel.productId).slice(-6)})`,
            skuLabel: rel.skuLabel || '',
            price: '-',
            image: '',
            missing: true
          };
        }
        const sku = rel.skuId && Array.isArray(p.skus)
          ? p.skus.find((s) => s && String(s.id) === String(rel.skuId))
          : null;
        return {
          key,
          _id: p._id,
          title: p.title,
          skuLabel: rel.skuLabel || (sku && sku.specLabel) || '',
          price: sku ? sku.price : p.price,
          image: (sku && sku.image) || (p.images && p.images[0]) || '',
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
    const selectedKeys = (this.data.tempContent.relatedSkus || []).map((s) => skuKey(s.productId, s.skuId));
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
      const list = [];
      (res.data || []).forEach((p) => {
        const image = (p.images && p.images[0]) || '';
        if (p.hasSku && Array.isArray(p.skus) && p.skus.length) {
          p.skus.forEach((sku) => {
            if (!sku || !sku.id) return;
            const key = skuKey(p._id, sku.id);
            list.push({
              key,
              productId: p._id,
              skuId: sku.id,
              title: p.title,
              skuLabel: sku.specLabel || '',
              price: sku.price,
              category: p.category || '',
              image: sku.image || image,
              selected: selectedKeys.indexOf(key) >= 0
            });
          });
        } else {
          const key = skuKey(p._id, '');
          list.push({
            key,
            productId: p._id,
            skuId: '',
            title: p.title,
            skuLabel: '',
            price: p.price,
            category: p.category || '',
            image,
            selected: selectedKeys.indexOf(key) >= 0
          });
        }
      });
      this.setData({ productPickerList: list });
    } catch (e) {
      console.error('loadProductPickerList', e);
    }
  },

  togglePickerProduct(e) {
    const key = e.currentTarget.dataset.id;
    const skuLabel = e.currentTarget.dataset.label || '';
    const parsed = parseSkuKey(key);
    if (!parsed.productId) return;
    let relatedSkus = normalizeRelatedSkus(this.data.tempContent.relatedSkus, []);
    const idx = relatedSkus.findIndex((s) => skuKey(s.productId, s.skuId) === key);
    if (idx >= 0) relatedSkus.splice(idx, 1);
    else relatedSkus.push({ productId: parsed.productId, skuId: parsed.skuId, skuLabel });
    relatedSkus = normalizeRelatedSkus(relatedSkus, []);
    const selectedKeys = relatedSkus.map((s) => skuKey(s.productId, s.skuId));
    const list = this.data.productPickerList.map((item) => ({
      ...item,
      selected: selectedKeys.indexOf(item.key) >= 0
    }));
    this.setData({
      'tempContent.relatedSkus': relatedSkus,
      'tempContent.relatedProductIds': relatedIdsFromSkus(relatedSkus),
      productPickerList: list
    });
  },

  confirmProductPicker() {
    const relatedSkus = normalizeRelatedSkus(this.data.tempContent.relatedSkus, []);
    this.loadRelatedProductPreview(relatedSkus);
    this.setData({ showProductPicker: false });
  },

  removeRelatedProduct(e) {
    const key = e.currentTarget.dataset.key;
    const relatedSkus = normalizeRelatedSkus(this.data.tempContent.relatedSkus, [])
      .filter((s) => skuKey(s.productId, s.skuId) !== key);
    this.setData({
      'tempContent.relatedSkus': relatedSkus,
      'tempContent.relatedProductIds': relatedIdsFromSkus(relatedSkus)
    });
    this.loadRelatedProductPreview(relatedSkus);
  },

  async submitContent() {
    const c = this.data.tempContent;
    if(!c.title) return wx.showToast({title:'标题必填',icon:'none'});
    wx.showLoading({title:'保存…', mask:true});
    let img = c.coverImage;
    if(img && !img.startsWith('cloud') && !img.startsWith('http')) {
      const up = await wx.cloud.uploadFile({cloudPath:`content/${Date.now()}.png`,filePath:img});
      img = up.fileID;
    }
    const tags = c.tagsStr ? c.tagsStr.split(/[,，]/).map(s => s.trim()).filter(s => s) : [];
    const relatedSkus = normalizeRelatedSkus(c.relatedSkus, c.relatedProductIds);
    const relatedProductIds = relatedIdsFromSkus(relatedSkus);
    const collection = c.type === 'exhibition' ? 'cms_wikis' : 'articles';
    const data = c.type === 'exhibition' ? {
      title: c.title, latinName: c.latinName||'', coverImage: img, cover: img, brief: c.brief||'', 
      content: c.content||'', tags: tags, type: c.type || 'exhibition', status: c.status || 'published',
      relatedSkus,
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
        await callStoreContent({ action: 'upsert', collection, id: this.data.editId, data });
      } else {
        data.createTime = Date.now();
        data._createTime = Date.now();
        await callStoreContent({ action: 'upsert', collection, data });
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
          wx.showLoading({ title: '删除中…' });
          try {
            const collection = type === 'exhibition' ? 'cms_wikis' : 'articles';
            await callStoreContent({ action: 'remove', collection, id });
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

  /** 预约页头图：选图 → 传云存储 → 写 configs/booking_config（doc 不存在时 set 建档） */
  changeBookingHero() {
    wx.chooseImage({
      count: 1,
      success: async (res) => {
        const filePath = res.tempFilePaths && res.tempFilePaths[0];
        if (!filePath) return;
        wx.showLoading({ title: '上传中…' });
        try {
          const up = await wx.cloud.uploadFile({
            cloudPath: `banners/booking-hero-${Date.now()}.png`,
            filePath
          });
          await callStoreContent({
            action: 'setDoc',
            collection: 'configs',
            id: 'booking_config',
            data: { image: up.fileID, updateTime: Date.now() }
          });
          this.setData({ bookingHero: up.fileID });
          wx.showToast({ title: '已更新', icon: 'success' });
        } catch (e) {
          console.error('更新预约头图失败', e);
          wx.showToast({ title: '更新失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

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
          statusLabel:
            item.status === 'sent'
              ? '已发送'
              : item.status === 'draft'
                ? '草稿'
                : item.status === 'failed'
                  ? '失败'
                  : item.status === 'scheduled'
                    ? '待发送'
                    : item.status || '',
          scopeLabel:
            item.scope === 'all'
              ? '全局'
              : item.scope === 'segment'
                ? `分群${item.segment ? ' · ' + item.segment : ''}`
                : '指定用户',
          campaignTypeLabel:
            item.campaignType === 'recall'
              ? '召回'
              : item.campaignType === 'conversion'
                ? '转化'
                : '',
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
      this.refreshOpsSignals();
    } catch (e) {
      this.setData({ supportTickets: [] });
      this.refreshOpsSignals();
    }
  },

  async loadYouxinSegments() {
    if (this.data.youxinSegments.length) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'pushMessage',
        data: { action: 'listSegments' }
      });
      const list = (res.result && res.result.segments) || [];
      const tone = {
        champions: '#C4A76C',
        loyal: '#C4A76C',
        potential_loyal: '#52B788',
        new_customers: '#52B788',
        promising: '#52B788',
        need_attention: '#E9A23B',
        about_to_sleep: '#E9A23B',
        at_risk: '#D64045',
        cant_lose: '#D64045',
        hibernating: '#A09A90',
        lost: '#6B6560',
        never_purchased: '#A09A90'
      };
      this.setData({
        youxinSegments: list.map((s) => ({
          ...s,
          tone: tone[s.key] || '#D5D1C8'
        }))
      });
    } catch (e) {
      this.setData({ youxinSegments: [] });
    }
  },

  refreshYouxinSegmentPicker() {
    const { campaignType } = this.data.pushForm;
    const all = this.data.youxinSegments || [];
    let visible = all;
    if (campaignType === 'recall') {
      visible = all.filter((s) => s.recall);
    } else if (campaignType === 'conversion') {
      visible = all.filter((s) => s.conversion);
    }
    const segStillOk = visible.some((s) => s.key === this.data.pushForm.segment);
    const patch = { youxinSegmentsVisible: visible };
    if (!segStillOk) {
      patch['pushForm.segment'] = '';
    }
    this.setData(patch);
  },

  onYouxinCampaignTypeChange(e) {
    const idx = parseInt(e.detail.value, 10);
    const item = (this.data.youxinCampaignTypes || [])[idx];
    if (!item) return;
    this.setData({ 'pushForm.campaignType': item.key }, () => {
      this.refreshYouxinSegmentPicker();
      this.estimatePushRecipients();
    });
  },

  onYouxinSegmentTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const cur = this.data.pushForm.segment;
    this.setData({ 'pushForm.segment': cur === key ? '' : key }, () => {
      this.estimatePushRecipients();
    });
  },

  onYouxinFilterToggle(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    const path = `pushForm.${field}`;
    this.setData({ [path]: !!(e.detail && e.detail.value) }, () => {
      this.estimatePushRecipients();
    });
  },

  bindYouxinOfferHint(e) {
    this.setData({ 'pushForm.offerHint': e.detail.value });
  },

  async generateYouxinCopy() {
    const form = this.data.pushForm;
    if (!form.segment && form.scope === 'segment') {
      return wx.showToast({ title: '请先选择分群', icon: 'none' });
    }
    this.setData({ pushAiLoading: true });
    wx.showLoading({ title: '撰写中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'assistYouxinCopy',
        data: {
          campaignType: form.campaignType,
          segment: form.segment,
          offerHint: (form.offerHint || '').trim()
        }
      });
      wx.hideLoading();
      const r = res.result || {};
      if (!r.success) {
        wx.showToast({ title: r.msg || '撰写失败', icon: 'none' });
        return;
      }
      this.setData({
        'pushForm.title': r.title || '',
        'pushForm.content': r.content || ''
      });
      wx.showToast({ title: '已生成，可编辑', icon: 'none' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: 'AI 不可用', icon: 'none' });
    } finally {
      this.setData({ pushAiLoading: false });
    }
  },

  pushEstimatePayload() {
    const form = this.data.pushForm;
    return {
      action: 'estimate',
      scope: form.scope,
      targetOpenid: (form.targetOpenid || '').trim(),
      campaignType: form.campaignType,
      segment: form.segment,
      honoraryOnly: form.honoraryOnly,
      activeOnly: form.activeOnly,
      highValueOnly: form.highValueOnly
    };
  },

  async estimatePushRecipients() {
    try {
      const payload = this.pushEstimatePayload();
      const res = await wx.cloud.callFunction({
        name: 'pushMessage',
        data: payload
      });
      const r = res.result || {};
      this.setData({
        pushEstimate: r.count || 0,
        pushPreviewNote: r.previewNote || ''
      });
    } catch (e) {
      this.setData({ pushEstimate: 0, pushPreviewNote: '' });
    }
  },

  bindPushInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`pushForm.${field}`]: e.detail.value });
  },

  onPushScopeChange(e) {
    this.setData({ 'pushForm.scope': e.detail.value }, () => {
      this.estimatePushRecipients();
    });
  },

  onPushCategoryChange(e) {
    const idx = parseInt(e.detail.value, 10);
    this.setData({ 'pushForm.category': idx === 0 ? 'activity' : 'system' });
  },

  async seedMessageTemplates() {
    wx.showLoading({ title: '初始化…' });
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
    const { title, content, scope, targetOpenid, segment, campaignType } = this.data.pushForm;
    if (!title.trim() || !content.trim()) {
      return wx.showToast({ title: '请填写标题和正文', icon: 'none' });
    }
    if (scope === 'single' && !targetOpenid.trim()) {
      return wx.showToast({ title: '请填写用户 openid', icon: 'none' });
    }
    if (scope === 'segment' && !segment && campaignType === 'general') {
      return wx.showToast({ title: '请选择 RFM 分群', icon: 'none' });
    }
    if (scope === 'segment' && !segment && campaignType !== 'general') {
      return wx.showToast({ title: '请选择目标分群', icon: 'none' });
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
    wx.showLoading({ title: '发送中…', mask: true });
    try {
      const basePayload = {
        action: 'send',
        title: form.title.trim(),
        content: form.content.trim(),
        category: form.category,
        actionUrl: (form.actionUrl || '').trim(),
        scope: form.scope,
        targetOpenid: (form.targetOpenid || '').trim(),
        campaignType: form.campaignType,
        segment: form.segment,
        honoraryOnly: form.honoraryOnly,
        activeOnly: form.activeOnly,
        highValueOnly: form.highValueOnly
      };

      let campaignId = '';
      let sendOffset = 0;
      let lastResult = null;
      let guard = 0;
      do {
        const res = await wx.cloud.callFunction({
          name: 'pushMessage',
          data: {
            ...basePayload,
            campaignId: campaignId || undefined,
            sendOffset
          }
        });
        lastResult = res.result || {};
        if (!lastResult.success) break;
        campaignId = lastResult.campaignId || campaignId;
        if (form.scope !== 'segment' || !lastResult.hasMore) break;
        sendOffset = lastResult.nextOffset || 0;
        guard += 1;
        wx.showLoading({ title: `发送中 ${lastResult.stats ? lastResult.stats.sent : 0}…` });
      } while (guard < 20);

      wx.hideLoading();
      const result = lastResult || {};
      if (!result.success) {
        this.setData({ pushSending: false });
        wx.showToast({ title: result.msg || '发送失败', icon: 'none' });
        return;
      }
      const stats = result.stats || {};
      wx.showToast({
        title: stats.sent != null ? `送达 ${stats.sent}/${stats.target}` : '发送完成',
        icon: 'none'
      });
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
    wx.showLoading({ title: '发送中…', mask: true });
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
    this.setData({ storeTabLoading: true });
    try {
      const { DEFAULT_STORES } = require('../../../utils/storeDefaults');
      const res = await wx.cloud.callFunction({
        name: 'manageStoreConfig',
        data: { action: 'listStores' }
      });
      const cloudOk = !!(res.result && res.result.success !== false);
      let stores = (res.result && res.result.stores) || [];
      if (!stores.length) stores = DEFAULT_STORES.slice();
      stores = this.normalizeAdminStores(stores, DEFAULT_STORES);
      const selectedStoreId = this.pickStoreId(stores, this.data.selectedStoreId);
      this.setData({
        adminStores: stores,
        storeTabLoading: false,
        selectedStoreId
      });
      this.applyStoreSelection(selectedStoreId, stores);
      if (!cloudOk) {
        wx.showToast({ title: '已用本地门店兜底', icon: 'none' });
      }
    } catch (e) {
      console.error('loadAdminStores', e);
      try {
        const { DEFAULT_STORES } = require('../../../utils/storeDefaults');
        const stores = this.normalizeAdminStores(DEFAULT_STORES.slice(), DEFAULT_STORES);
        const selectedStoreId = this.pickStoreId(stores, this.data.selectedStoreId);
        this.setData({
          adminStores: stores,
          storeTabLoading: false,
          selectedStoreId
        });
        this.applyStoreSelection(selectedStoreId, stores);
        wx.showToast({ title: '云端失败，已用本地兜底', icon: 'none' });
      } catch (err) {
        this.setData({ storeTabLoading: false });
        wx.showToast({ title: '加载门店失败', icon: 'none' });
      }
    }
  },

  normalizeAdminStores(stores, defaults) {
    const seedMap = {};
    (defaults || []).forEach((s) => {
      if (s && s.storeId) seedMap[s.storeId] = s;
    });
    return (stores || []).map((raw) => {
      const seed = seedMap[raw.storeId] || {};
      const hours = Object.assign({}, seed.hours || {}, raw.hours || {});
      const status = raw.status || seed.status || 'active';
      const role = raw.role || seed.role || (raw.storeId === 'store_xingchen' ? 'workshop' : 'main');
      return Object.assign({}, seed, raw, {
        hours,
        status,
        role,
        roleLabel: raw.roleLabel || seed.roleLabel || (role === 'workshop' ? '标本工坊' : '品牌主店'),
        locationLabel: raw.locationLabel || seed.locationLabel || raw.floor || '',
        statusLabel: status === 'active' ? '营业中' : '已停用',
        isMain: role === 'main' || raw.storeId === 'store_shanhaizaowu',
        hoursText: hours.note
          ? `${hours.open || '10:00'}–${hours.close || '22:00'} · ${hours.note}`
          : `${hours.open || '10:00'}–${hours.close || '22:00'}`,
        visitCount: (this.data.storeVisitStats.byStore || {})[raw.storeId] || 0,
        features: Array.isArray(raw.features) && raw.features.length
          ? raw.features
          : (seed.features || []),
        visitTips: Array.isArray(raw.visitTips) && raw.visitTips.length
          ? raw.visitTips
          : (seed.visitTips || [])
      });
    }).sort((a, b) => (a.sort || 99) - (b.sort || 99));
  },

  pickStoreId(stores, preferred) {
    if (preferred && stores.some((s) => s.storeId === preferred)) return preferred;
    const main = stores.find((s) => s.isMain || s.storeId === 'store_shanhaizaowu');
    return (main && main.storeId) || (stores[0] && stores[0].storeId) || 'store_shanhaizaowu';
  },

  applyStoreSelection(storeId, storesOpt) {
    const stores = storesOpt || this.data.adminStores || [];
    const sid = this.pickStoreId(stores, storeId);
    const activeStore = stores.find((s) => s.storeId === sid) || null;
    const atlasAll = this.data.atlasSpotsAll || [];
    const atlasSpots = atlasAll.filter((s) => s.storeId === sid);
    const byStore = (this.data.storeVisitStats && this.data.storeVisitStats.byStore) || {};
    if (activeStore) {
      activeStore.visitCount = byStore[sid] || 0;
    }
    this.setData({
      selectedStoreId: sid,
      activeStore,
      atlasSpots
    });
  },

  switchStoreTab(e) {
    const storeId = e.currentTarget.dataset.storeId;
    if (!storeId || storeId === this.data.selectedStoreId) return;
    this.applyStoreSelection(storeId);
  },

  async loadStoreVisitStats() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'storeCheckIn',
        data: { action: 'getTodayStats' }
      });
      if (res.result && res.result.success) {
        const storeVisitStats = res.result.data || { total: 0, byStore: {} };
        this.setData({ storeVisitStats });
        if (this.data.activeStore) {
          this.applyStoreSelection(this.data.selectedStoreId);
        }
      }
    } catch (e) {
      console.warn('loadStoreVisitStats', e);
    }
  },

  openStoreEditModal(e) {
    const item = (e.currentTarget.dataset.item) || this.data.activeStore;
    if (!item) return;
    const hours = item.hours || {};
    this.setData({
      showStoreEditModal: true,
      tempStoreEdit: {
        storeId: item.storeId,
        name: item.name || '',
        phone: item.phone || '',
        address: item.address || '',
        floor: item.floor || '',
        heroTagline: item.heroTagline || '',
        intro: item.intro || '',
        hoursOpen: hours.open || '10:00',
        hoursClose: hours.close || '22:00',
        visitTipsText: (item.visitTips || []).join('\n'),
        status: item.status || 'active'
      }
    });
  },

  closeStoreEditModal() {
    this.setData({ showStoreEditModal: false });
  },

  bindStoreEditInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`tempStoreEdit.${field}`]: e.detail.value });
  },

  onStoreStatusToggle(e) {
    this.setData({
      'tempStoreEdit.status': e.detail.value ? 'active' : 'inactive'
    });
  },

  async saveStoreEdit() {
    const s = this.data.tempStoreEdit;
    if (!s || !s.storeId) {
      return wx.showToast({ title: '门店信息缺失', icon: 'none' });
    }
    if (!(s.name || '').trim()) {
      return wx.showToast({ title: '请填写门店名称', icon: 'none' });
    }
    wx.showLoading({ title: '保存中…' });
    try {
      const visitTips = (s.visitTipsText || '')
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await wx.cloud.callFunction({
        name: 'manageStoreConfig',
        data: {
          action: 'updateStore',
          storeId: s.storeId,
          data: {
            name: (s.name || '').trim(),
            phone: (s.phone || '').trim(),
            address: (s.address || '').trim(),
            floor: (s.floor || '').trim(),
            heroTagline: (s.heroTagline || '').trim(),
            intro: (s.intro || '').trim(),
            hours: { open: s.hoursOpen || '10:00', close: s.hoursClose || '22:00', note: '' },
            visitTips,
            status: s.status === 'inactive' ? 'inactive' : 'active'
          }
        }
      });
      wx.hideLoading();
      if (!(res.result && res.result.success)) {
        wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showStoreEditModal: false });
      this.loadAdminStores();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  async loadAnalyticsDashboard() {
    this.setData({ analyticsLoading: true, analyticsError: '' })
    try {
      const payload = this._buildAnalyticsRangePayload()
      const res = await wx.cloud.callFunction({
        name: 'getAnalyticsDashboard',
        data: payload
      })
      if (!(res.result && res.result.success && res.result.data)) {
        const msg = (res.result && res.result.msg) || '加载失败'
        this.setData({ analyticsLoading: false, analyticsError: msg })
        wx.showToast({ title: msg, icon: 'none' })
        return
      }
      const d = res.result.data
      const users = d.users || {}
      const orders = d.orders || {}
      const catalog = d.catalog || {}
      const behavior = d.behavior || {}
      const members = d.members || {}
      const category = d.category || {}
      const deposit = d.deposit || {}
      const commission = d.commission || {}
      const headline = d.headline || {}
      const summary = users.behaviorSummary || {}
      const fmtMoney = (n) => storeLedger.formatMoney(n)
      const totals = orders.totals || {}
      const mix = totals.mix || {}
      const layout =
        this._dashChartLayout || this.data.chartLayout || computeDashChartLayout(0, 0, dashWindowWidth())
      const range = d.range || users.range || orders.range || {}
      const spanDays = Number(range.days) || (this.data.analyticsRangeType === 'month' ? 31 : this.data.analyticsDays) || 7
      const maxBars = spanDays > 30 ? 12 : spanDays > 7 ? 14 : 7
      const chartSeries = downsampleReportSeries(orders.daily || [], maxBars)
      const chartHint =
        (orders.daily || []).length > maxBars
          ? `趋势已按约 ${maxBars} 段聚合展示，合计仍为全日明细`
          : ''
      const rangeLabel =
        range.startDate && range.endDate
          ? `${String(range.startDate).slice(5)} → ${String(range.endDate).slice(5)}`
          : this.data.analyticsRangeType === 'month'
            ? this.data.analyticsMonthLabel || '自然月'
            : `近${this.data.analyticsDays}日`

      const channelMix = buildReportShareMix(
        [
          { key: 'online', label: '线上净额', value: Number(headline.netOnline != null ? headline.netOnline : totals.netOnline) || 0, valueFmt: headline.netOnlineFmt || totals.netOnlineFmt },
          { key: 'offline', label: '门店账本', value: Number(headline.offlineLedger != null ? headline.offlineLedger : totals.offlineLedger) || 0, valueFmt: headline.offlineLedgerFmt || totals.offlineLedgerFmt }
        ],
        ['brass', 'forest']
      )
      const ledgerByStoreRaw = d.ledgerByStore || orders.ledgerByStore || headline.ledgerByStore || []
      const ledgerByStore = (ledgerByStoreRaw || []).map((row, i) => ({
        storeId: row.storeId || row.key || String(i),
        name: row.name || row.label || row.storeId || '',
        value: Number(row.value) || 0,
        valueFmt: row.valueFmt || fmtMoney(row.value || 0),
        pct: row.pct != null ? row.pct : 0,
        barStyle: row.barStyle || `width:${Math.max(0, Math.min(100, Number(row.pct) || 0))}%`
      }))
      const sourceMix = buildReportShareMix(
        [
          { key: 'commerce', label: '普通零售', value: Number(mix.commerce) || 0, valueFmt: mix.commerceFmt },
          { key: 'gift', label: '礼赠', value: Number(mix.gift) || 0, valueFmt: mix.giftFmt },
          { key: 'deposit', label: '定金单', value: Number(mix.deposit) || 0, valueFmt: mix.depositFmt },
          { key: 'deposit_balance', label: '尾款', value: Number(mix.depositBalance) || 0, valueFmt: mix.depositBalanceFmt },
          { key: 'custom', label: '定制', value: Number(mix.custom) || 0, valueFmt: mix.customFmt }
        ],
        ['brass', 'gold', 'forest']
      )
      const empty =
        !(Number(headline.grandTotal) || Number(totals.grandTotal) || Number(totals.gmvPaid) || Number(totals.offlineLedger))

      const signalsPack = d.signals || d.trafficLights || {}
      const signalItems = Array.isArray(signalsPack.items)
        ? signalsPack.items
        : Array.isArray(signalsPack)
          ? signalsPack
          : []

      this.setData({
        analytics: {
          summary: {
            totalEvents: summary.totalEvents || 0,
            uniqueUsers: summary.uniqueUsers || 0,
            pageViews: summary.pageViews || 0,
            byModule: [],
            byAction: behavior.topEvents || users.topEvents || []
          },
          byModule: [],
          byAction: behavior.topEvents || users.topEvents || [],
          funnel: behavior.funnel || {},
          dailyTrend: [],
          sampled: !!users.sampled || !!orders.truncated,
          note: (d.notes && d.notes[0]) || ''
        },
        analyticsReport: {
          notes: d.notes || [],
          rangeLabel,
          chartHint,
          empty,
          signals: {
            items: signalItems,
            summary: signalsPack.summary || { ok: 0, warn: 0, danger: 0, muted: 0 },
            rulesNote: signalsPack.rulesNote || ''
          },
          headline: {
            grandTotal: Number(headline.grandTotal) || Number(totals.grandTotal) || 0,
            grandTotalFmt: headline.grandTotalFmt || totals.grandTotalFmt || fmtMoney(0),
            netOnline: Number(headline.netOnline) || Number(totals.netOnline) || 0,
            netOnlineFmt: headline.netOnlineFmt || totals.netOnlineFmt || fmtMoney(0),
            gmvPaid: Number(headline.gmvPaid) || Number(totals.gmvPaid) || 0,
            gmvPaidFmt: headline.gmvPaidFmt || totals.gmvPaidFmt || fmtMoney(0),
            refundAmount: Number(headline.refundAmount) || Number(totals.refundAmount) || 0,
            refundAmountFmt: headline.refundAmountFmt || totals.refundAmountFmt || fmtMoney(0),
            offlineLedger: Number(headline.offlineLedger) || Number(totals.offlineLedger) || 0,
            offlineLedgerFmt: headline.offlineLedgerFmt || totals.offlineLedgerFmt || fmtMoney(0),
            paidOrders: headline.paidOrders != null ? headline.paidOrders : (totals.paid || 0),
            aovFmt: headline.aovFmt || totals.aovFmt || '—',
            avgDau: headline.avgDau != null ? headline.avgDau : (users.avgDau || 0),
            newUsers: headline.newUsers != null ? headline.newUsers : (users.totalNewUsers || 0)
          },
          channelMix,
          sourceMix,
          ledgerByStore,
          users: {
            totalNewUsers: users.totalNewUsers || 0,
            newUsersByDay: users.newUsersByDay || [],
            dauByDay: users.dauByDay || [],
            dauSource: users.dauSource || '',
            retention: users.retention || {},
            behaviorSummary: users.behaviorSummary || {},
            topEvents: users.topEvents || behavior.topEvents || []
          },
          members: {
            payingUsers: members.payingUsers || totals.payingUsers || 0,
            levelShare: members.levelShare || []
          },
          category: {
            byType: category.byType || []
          },
          deposit: {
            available: deposit.available !== false,
            counts: deposit.counts || {},
            paidDepositAmountFmt: deposit.paidDepositAmountFmt || fmtMoney(0),
            forfeitedAmountFmt: deposit.forfeitedAmountFmt || fmtMoney(0),
            settledCount: deposit.settledCount || 0
          },
          commission: {
            available: commission.available !== false,
            earnTotalFmt: commission.earnTotalFmt || fmtMoney(0),
            reverseTotalFmt: commission.reverseTotalFmt || fmtMoney(0),
            netTotalFmt: commission.netTotalFmt || fmtMoney(0),
            earnCount: commission.earnCount || 0,
            topArtisans: commission.topArtisans || []
          },
          orders: {
            daily: orders.daily || [],
            totals: {
              ...totals,
              gmvPaidFmt: totals.gmvPaidFmt || fmtMoney(totals.gmvPaid || 0),
              netOnlineFmt: totals.netOnlineFmt || fmtMoney(totals.netOnline || 0),
              aovFmt: totals.aov > 0 ? (totals.aovFmt || `¥${fmtMoney(totals.aov)}`) : '—',
              offlineLedgerFmt: totals.offlineLedgerFmt || fmtMoney(totals.offlineLedger || 0),
              mix: {
                commerceFmt: mix.commerceFmt || fmtMoney(mix.commerce || 0),
                giftFmt: mix.giftFmt || fmtMoney(mix.gift || 0),
                depositFmt: mix.depositFmt || fmtMoney(mix.deposit || 0),
                depositBalanceFmt: mix.depositBalanceFmt || fmtMoney(mix.depositBalance || 0),
                customFmt: mix.customFmt || fmtMoney(mix.custom || 0)
              }
            },
            truncated: !!orders.truncated
          },
          catalog: {
            counts: catalog.counts || {},
            byCategory: catalog.byCategory || [],
            truncated: !!catalog.truncated,
            lowStockThreshold: catalog.lowStockThreshold || 3
          },
          behavior: {
            funnel: behavior.funnel || {},
            topEvents: behavior.topEvents || []
          },
          charts: {
            newUsers: buildCountChartEntries(
              downsampleReportSeries(users.newUsersByDay || [], maxBars),
              layout,
              'count'
            ),
            dau: buildCountChartEntries(
              downsampleReportSeries(users.dauByDay || [], maxBars),
              layout,
              'dau'
            ),
            orderCount: buildCountChartEntries(chartSeries, layout, 'orders'),
            gmv: buildTrendChartEntries(
              chartSeries.map((row) => ({
                dateKey: row.dateKey,
                day: row.label || (row.dateKey || '').slice(5),
                online: Math.max(0, Number(row.netOnline != null ? row.netOnline : row.gmvPaid) || 0),
                offline: 0,
                total: Math.max(0, Number(row.netOnline != null ? row.netOnline : row.gmvPaid) || 0)
              })),
              (n, c) => this._shortMoney(n, c),
              layout
            ),
            revenue: buildTrendChartEntries(
              chartSeries.map((row) => {
                const online = Math.max(0, Number(row.netOnline != null ? row.netOnline : row.gmvPaid) || 0)
                const offline = Math.max(0, Number(row.offlineLedger) || 0)
                return {
                  dateKey: row.dateKey,
                  day: row.label || (row.dateKey || '').slice(5),
                  online,
                  offline,
                  total: online + offline
                }
              }),
              (n, c) => this._shortMoney(n, c),
              layout
            )
          }
        },
        analyticsLoading: false,
        analyticsError: ''
      }, () => this.scheduleChartLayout())
    } catch (e) {
      console.error('loadAnalyticsDashboard', e)
      const msg = formatCloudFnError(e, '加载失败')
      this.setData({ analyticsLoading: false, analyticsError: msg })
      wx.showToast({ title: msg, icon: 'none' })
    }
  },

  _buildAnalyticsRangePayload() {
    if (this.data.analyticsRangeType === 'month') {
      const current = storeLedger.getCurrentYearMonth()
      const yearMonth = this.data.analyticsMonth || current
      return {
        action: 'report',
        rangeType: 'month',
        yearMonth
      }
    }
    return {
      action: 'report',
      rangeType: 'days',
      days: this.data.analyticsDays || 7
    }
  },

  _syncAnalyticsMonthMeta(yearMonth) {
    const current = storeLedger.getCurrentYearMonth()
    const parts = String(current).split('-').map((x) => parseInt(x, 10))
    const y = parts[0] || new Date().getFullYear()
    const m = parts[1] || new Date().getMonth() + 1
    const prevDate = new Date(y, m - 2, 1)
    const prev = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`
    const ym = String(yearMonth || current).slice(0, 7)
    return {
      analyticsMonth: ym,
      analyticsMonthLabel: storeLedger.formatMonthLabel(ym),
      analyticsMonthCurrent: current,
      analyticsMonthPrev: prev,
      analyticsMonthMax: current
    }
  },

  setAnalyticsDays(e) {
    const days = parseInt(e.currentTarget.dataset.days, 10) || 7
    if (
      this.data.analyticsRangeType === 'days' &&
      days === this.data.analyticsDays &&
      !this.data.analyticsError
    ) {
      this.loadAnalyticsDashboard()
      return
    }
    this.setData({
      analyticsRangeType: 'days',
      analyticsDays: days,
      analyticsNotesOpen: false
    })
    this.loadAnalyticsDashboard()
  },

  setAnalyticsMonthMode() {
    const meta = this._syncAnalyticsMonthMeta(
      this.data.analyticsMonth || storeLedger.getCurrentYearMonth()
    )
    if (this.data.analyticsRangeType === 'month' && !this.data.analyticsError) {
      this.setData(meta)
      this.loadAnalyticsDashboard()
      return
    }
    this.setData({
      analyticsRangeType: 'month',
      analyticsNotesOpen: false,
      ...meta
    })
    this.loadAnalyticsDashboard()
  },

  setAnalyticsMonthPreset(e) {
    const preset = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.preset) || '')
    const metaBase = this._syncAnalyticsMonthMeta(storeLedger.getCurrentYearMonth())
    const yearMonth = preset === 'prev' ? metaBase.analyticsMonthPrev : metaBase.analyticsMonthCurrent
    const meta = this._syncAnalyticsMonthMeta(yearMonth)
    if (
      this.data.analyticsRangeType === 'month' &&
      this.data.analyticsMonth === yearMonth &&
      !this.data.analyticsError
    ) {
      this.loadAnalyticsDashboard()
      return
    }
    this.setData({
      analyticsRangeType: 'month',
      analyticsNotesOpen: false,
      ...meta
    })
    this.loadAnalyticsDashboard()
  },

  onAnalyticsMonthPick(e) {
    const raw = (e.detail && e.detail.value) || ''
    const yearMonth = String(raw).slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) return
    const meta = this._syncAnalyticsMonthMeta(yearMonth)
    if (
      this.data.analyticsRangeType === 'month' &&
      this.data.analyticsMonth === yearMonth &&
      !this.data.analyticsError
    ) {
      this.loadAnalyticsDashboard()
      return
    }
    this.setData({
      analyticsRangeType: 'month',
      analyticsNotesOpen: false,
      ...meta
    })
    this.loadAnalyticsDashboard()
  },

  toggleAnalyticsNotes() {
    this.setData({ analyticsNotesOpen: !this.data.analyticsNotesOpen })
  },

  async loadShippingRules() {
    this.setData({ shippingLoading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'getShippingRules',
        data: { action: 'get' }
      })
      const result = (res && res.result) || {}
      const cfg = result.config || {}
      const mix = cfg.mixCartStrategy || 'specimen_wins'
      const mixIndex = Math.max(0, (this.data.shippingMixValues || []).indexOf(mix))
      const campaign = cfg.freeShippingCampaign || {}
      const money = (n, fallback) => storeLedger.formatMoney(n != null ? n : fallback)
      const form = {
        name: cfg.name || '商城运费规则',
        defaultCarrier: cfg.defaultCarrier || cfg.carrier || '顺丰速运',
        flatFee: money(cfg.flatFee, 18),
        accessoryFreeThreshold: money(cfg.accessoryFreeThreshold, 200),
        specimenFreeThreshold: money(cfg.specimenFreeThreshold, 500),
        mixCartStrategy: mix,
        campaignEnabled: !!(campaign && campaign.enabled),
        campaignLabel: (campaign && campaign.label) || '当前全场免邮'
      }
      this.setData({
        shippingLoading: false,
        shippingRuleDocId: result.ruleDocId || '',
        shippingRuleText: this._buildShippingRuleText(form) || result.ruleText || '',
        shippingFromDefault: !!result.default,
        shippingMixIndex: mixIndex,
        shippingForm: form
      })
    } catch (e) {
      console.error('loadShippingRules', e)
      this.setData({ shippingLoading: false })
      wx.showToast({ title: formatCloudFnError(e, '运费规则加载失败'), icon: 'none' })
    }
  },

  /** 摘要展示用（两位小数），不改计价逻辑 */
  _buildShippingRuleText(form) {
    const f = form || {}
    const carrier = String(f.defaultCarrier || '顺丰速运').trim() || '顺丰速运'
    if (f.campaignEnabled) {
      const label = String(f.campaignLabel || '当前全场免邮').trim() || '当前全场免邮'
      return `${carrier} · ${label}（全场免邮）`
    }
    const accessory = storeLedger.formatMoney(f.accessoryFreeThreshold)
    const specimen = storeLedger.formatMoney(f.specimenFreeThreshold)
    const fee = storeLedger.formatMoney(f.flatFee)
    return `${carrier} · 饰品满 ¥${accessory} / 藏品满 ¥${specimen} 包邮，否则运费 ¥${fee}`
  },

  onShippingFieldInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ [`shippingForm.${field}`]: e.detail.value })
  },

  onShippingMixChange(e) {
    const index = parseInt(e.detail.value, 10) || 0
    const value = (this.data.shippingMixValues || [])[index] || 'specimen_wins'
    this.setData({
      shippingMixIndex: index,
      'shippingForm.mixCartStrategy': value
    })
  },

  onShippingCampaignToggle(e) {
    this.setData({ 'shippingForm.campaignEnabled': !!(e.detail && e.detail.value) })
  },

  async saveShippingRules() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.SHIPPING)) {
      wx.showToast({ title: '仅超管可改运费', icon: 'none' })
      return
    }
    if (this.data.shippingSaving) return
    const form = this.data.shippingForm || {}
    this.setData({ shippingSaving: true })
    wx.showLoading({ title: '保存中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'getShippingRules',
        data: {
          action: 'save',
          ruleDocId: this.data.shippingRuleDocId || '',
          config: {
            name: form.name,
            defaultCarrier: form.defaultCarrier,
            flatFee: Number(form.flatFee),
            accessoryFreeThreshold: Number(form.accessoryFreeThreshold),
            specimenFreeThreshold: Number(form.specimenFreeThreshold),
            mixCartStrategy: form.mixCartStrategy,
            freeShippingCampaign: {
              enabled: !!form.campaignEnabled,
              label: form.campaignLabel || '当前全场免邮'
            }
          }
        }
      })
      wx.hideLoading()
      const result = (res && res.result) || {}
      this.setData({ shippingSaving: false })
      if (!result.success) {
        wx.showToast({ title: result.msg || '保存失败', icon: 'none' })
        return
      }
      wx.showToast({ title: '运费规则已保存', icon: 'none' })
      const nextForm = {
        ...form,
        flatFee: storeLedger.formatMoney(form.flatFee),
        accessoryFreeThreshold: storeLedger.formatMoney(form.accessoryFreeThreshold),
        specimenFreeThreshold: storeLedger.formatMoney(form.specimenFreeThreshold)
      }
      this.setData({
        shippingRuleDocId: result.ruleDocId || this.data.shippingRuleDocId,
        shippingRuleText: this._buildShippingRuleText(nextForm) || result.ruleText || '',
        shippingFromDefault: false,
        shippingForm: nextForm
      })
    } catch (e) {
      wx.hideLoading()
      this.setData({ shippingSaving: false })
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' })
    }
  },

  async loadContentDisplayFlags() {
    this.setData({ contentFlagsLoading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'getContentDisplayFlags',
        data: { action: 'get' }
      })
      const result = (res && res.result) || {}
      const flags = result.flags || {}
      this.setData({
        contentFlagsLoading: false,
        contentFlagsDirty: false,
        contentFlagsDocId: result.docId || '',
        contentFlagsFromDefault: !!result.default,
        contentFlags: {
          showSpecimenArchive: flags.showSpecimenArchive === true,
          showUserCommunity: flags.showUserCommunity === true,
          showBookingEntry: flags.showBookingEntry !== false,
          showSpecimenCustom: flags.showSpecimenCustom === true,
          showPetMemorial: flags.showPetMemorial !== false,
          showLive: flags.showLive === true,
          showStoredValue: flags.showStoredValue === true,
          showAiIdentify: flags.showAiIdentify !== false,
          showStore: flags.showStore !== false,
          showStorePickup: flags.showStorePickup !== false,
          showGift: flags.showGift === true,
          showMaShangYou: flags.showMaShangYou === true,
          // 与 data 默认值同样必须齐全：这四项本面板不渲染开关，但保存时要原值回传，
          // 否则云函数按固定字段表整体写入时会它们重置为默认（见 data 处的说明）
          allowIosStoredValue: flags.allowIosStoredValue !== false,
          imageThumbEnabled: flags.imageThumbEnabled !== false,
          showAtlas: flags.showAtlas !== false,
          showAchievements: flags.showAchievements !== false
        }
      })
    } catch (e) {
      console.error('loadContentDisplayFlags', e)
      this.setData({ contentFlagsLoading: false })
      wx.showToast({ title: formatCloudFnError(e, '内容开关加载失败'), icon: 'none' })
    }
  },

  onContentFlagToggle(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    // 只改本地：必须点「保存开关」才写云端。标脏以免用户以为已经生效
    this.setData({ [`contentFlags.${field}`]: !!(e.detail && e.detail.value), contentFlagsDirty: true })
  },

  /**
   * 需求 28：祈福墙内容管理入口。
   * 弹幕不接审核 → 治理只能落在这里，故入口就放在内容开关同一面板内，
   * 让「开关 + 治理」在一次操作动线里闭合。
   */
  goWishWallManage() {
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({
      url: '/subpackages/manager/wish-wall/index',
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    })
  },

  async saveContentDisplayFlags() {
    if (!canSeeMenu(this.data.workspaceRole, MENU_KEYS.CONTENT_FLAGS)) {
      wx.showToast({ title: '仅超管可改内容开关', icon: 'none' })
      return
    }
    if (this.data.contentFlagsSaving) return
    this.setData({ contentFlagsSaving: true })
    wx.showLoading({ title: '保存中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'getContentDisplayFlags',
        data: {
          action: 'save',
          docId: this.data.contentFlagsDocId || '',
          flags: this.data.contentFlags
        }
      })
      wx.hideLoading()
      const result = (res && res.result) || {}
      this.setData({ contentFlagsSaving: false })
      if (!result.success) {
        wx.showToast({ title: result.msg || '保存失败', icon: 'none' })
        return
      }
      wx.showToast({ title: '内容开关已保存', icon: 'none' })
      this.setData({
        contentFlagsDocId: result.docId || this.data.contentFlagsDocId,
        contentFlagsFromDefault: false,
        contentFlagsDirty: false,
        contentFlags: result.flags || this.data.contentFlags
      })
      // 需求 28：开关改了，**本机的 C 端缓存必须立刻失效**。
      // contentFlags 走 SWR（TTL 10 分钟 / 陈旧窗口 24 小时），且缓存是落 storage 的：
      // 不失效的话，本机打开详情页最长 24 小时看不到变化
      // （实测反馈「开关开了但马上有详情页没有入口」就是这么来的）。
      // 这里只管本机；其它设备靠详情页/祈福墙页接住 SWR 的 onUpdate 收敛。
      try {
        require('../../../utils/contentDisplayFlags').invalidateContentDisplayFlags()
      } catch (e) {
        console.warn('invalidate content flags cache', e)
      }
    } catch (e) {
      wx.hideLoading()
      this.setData({ contentFlagsSaving: false })
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' })
    }
  }
};

module.exports = managerPageConfig;
