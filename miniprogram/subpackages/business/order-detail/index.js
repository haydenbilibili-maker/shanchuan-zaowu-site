// pages/order-detail/index.js
const app = getApp();
const db = wx.cloud.database();
const { withAppModal } = require('../../../utils/appModal');

// 物流查询插件：仅 business 分包 plugins.logisticsPlugin（provider wx9ad912bf20548d92；同 provider 不可多分包/根级重复声明）
// 官方：requirePlugin + openWaybillTracking({ waybillToken })
// waybillToken 来自发货云函数 trace_waybill / follow_waybill，须真机预览（开发者工具无法模拟）
let logisticsPlugin = null;
try {
  logisticsPlugin = requirePlugin('logisticsPlugin');
} catch (err) {
  console.warn('[order-detail] logisticsPlugin 未就绪（需 MP 添加插件 wx9ad912bf20548d92 并开通查询组件）', err);
}
const { payForOrder } = require('../utils/payment');
const { buildPreviewSummary } = require('../utils/customHelper');
const { PRODUCTION_STATUS_LABELS } = require('../utils/customDefaults');
const { resolveCareContext, confirmReceiptOnOrder } = require('../utils/careHelper');
const { buildGuideUrl } = require('../utils/careDefaults');
const { ensureOpenId, isOrderOwnedBy, isGiftReceiverOf, canAccessOrder, denyOrderAccess } = require('../../../utils/orderScope');
const { formatPickupTime } = require('../utils/pickupPass');
const { fetchStoreCatalog, findCatalogStore } = require('../../../utils/storeCatalog');
const shippingConfig = require('../../../config/shipping');
const {
  getPolicy,
  getDisplayNotice,
  canUserRequestRefund,
  needsUnboxEvidence
} = require('../utils/refundPolicy');
const { batchTempFileURLs } = require('../../../utils/util');

function formatAddressLine(addr) {
  if (!addr) return '';
  const region = Array.isArray(addr.region)
    ? addr.region.filter(Boolean).join(' ')
    : (addr.region || '');
  return [region, addr.detail].filter(Boolean).join(' ');
}

function looksLikePlaceholderTracking(trackingNumber) {
  const s = String(trackingNumber || '')
    .trim()
    .replace(/\s/g, '');
  if (!s || s.length < 6) return true;
  if (/^(.)\1+$/.test(s)) return true;
  if (/^0+$/.test(s) || /^1{8,}$/.test(s) || /^9{8,}$/.test(s)) return true;
  return false;
}

function buildTrackHint({ canOpenWxTrack, trackingNumber, logistics, ensureResult, hasPlugin, hasToken }) {
  if (canOpenWxTrack) return '';
  const skip =
    (ensureResult && (ensureResult.wxExpressSkipReason || ensureResult.skipReason)) ||
    (logistics && logistics.wxExpressSkipReason) ||
    '';
  const err =
    (ensureResult && ensureResult.wxExpressError) ||
    (logistics && logistics.wxExpressError) ||
    '';
  if (hasToken && !hasPlugin) {
    return '官方轨迹已就绪，请重新编译/更新小程序后点「查询物流轨迹」（需物流查询插件）';
  }
  if (looksLikePlaceholderTracking(trackingNumber) || skip === 'placeholder_waybill') {
    return '当前运单号无法查询轨迹，请联系专员核对真实单号';
  }
  if (skip === 'missing_trans_id' || /wxTransactionId|交易单号/.test(err)) {
    return '该订单缺少微信支付交易号，暂无法开通官方物流轨迹';
  }
  if (/access_token|WX_APP_SECRET|AppSecret/i.test(String(skip) + String(err))) {
    return '发货已完成，轨迹同步凭证未就绪，可先复制单号查询';
  }
  if (/未开通|48001|查询组件|物流消息/.test(String(skip) + String(err))) {
    return '官方物流能力未完全开通，可先复制单号在快递 App 查询';
  }
  return '暂无法打开官方轨迹，可复制单号查询';
}

Page(withAppModal({
  data: {
    // 页面数据容器
    order: {},
    orderId: '',
    loading: true,
    loadError: false,
    
    // UI 状态控制
    stampClass: '',       // 印章样式类 (warn/active/success/void)
    stampText: '',        // 印章文字 (PENDING/ARCHIVED...)
    isDecrypted: false,   // 控制档案袋解密动画
    isGiftOrder: false,
    giftAwaitingAddress: false,
    giftExpireHint: '',
    giftShareToken: '',
    giftShowPickupClaim: false,
    giftClaimCode: '',
    showOrderPickup: false,
    orderPickupCode: '',
    orderPickupStoreName: '',
    /** 领取门店的地址/营业时间/坐标（来自门店配置，异步补齐） */
    pickupStoreInfo: null,
    /** 自取已完成态：核销时间行 */
    pickupDoneInfo: null,
    isStorePickup: false,
    pickupStoreName: '',
    // ── 礼赠档案区（2026-09-21）：订单详情页原本只在**底栏**按状态给礼赠动作，
    //    没有任何"回看这封礼笺 / 看这份礼赠进展"的入口（产品负责人报的缺口）。
    giftRecipientName: '',
    giftStatusText: '',
    giftStatusTone: 'flat',
    giftNotePreview: '',
    giftEnvelopeLabel: '查看礼赠信封',
    giftCardBody: '',
    giftCardSignature: '',
    giftHasVoice: false,
    giftShareImageUrl: '',
    
    // 模拟物流节点 (仅作展示用)
    logistics: [],
    hasTracking: false,
    waybillToken: '',
    canOpenWxTrack: false,
    trackHint: '',

    showCare: false,
    careContext: {},
    refundPolicyLabel: '',
    refundPolicyParagraphs: [],
    refundPolicyRichParagraphs: [],
    showRefundEntry: false,
    /** 支付确认中（fulfilling）的自救入口 */
    showPayConfirmRetry: false,
    payConfirmBusy: false,
    refundEntryLabel: '申请退款',
    evidenceVideoUrl: '',
    evidenceImageUrls: [],
    hasEvidenceBlock: false,
    /** 当前用户是否为礼赠受赠人（非付款人） */
    isGiftReceiver: false,
    /** 受礼人待填址 */
    giftReceiverNeedsAddress: false,
    /** 是否展示金额（受赠人 + hidePrice 时隐藏） */
    showOrderPrice: true,
    /** 签收后评价状态 */
    reviewSummaryLabel: '',
    reviewCanAny: false,
    reviewPendingCount: 0,
    reviewProducts: []
  },

  onLoad(options) {
    // 朋友圈礼赠卡：打开订单详情页时带 giftOrderId，导到领取页
    const timelineOrderId = String((options && options.giftOrderId) || '').trim();
    const timelineToken = String((options && options.token) || '').trim();
    if (timelineOrderId) {
      const q = [`orderId=${encodeURIComponent(timelineOrderId)}`];
      if (timelineToken) q.push(`token=${encodeURIComponent(timelineToken)}`);
      wx.redirectTo({
        url: `/subpackages/feature/gift/receive/index?${q.join('&')}`,
        fail: () => {
          this.setData({ orderId: timelineOrderId });
          this.loadOrderDetail(timelineOrderId);
        }
      });
      return;
    }
    const id = (options && options.id) || '';
    const openTrack = String((options && options.openTrack) || '') === '1';
    if (id) {
      this.setData({ orderId: id, _openTrackOnLoad: openTrack });
      this.loadOrderDetail(id);
    } else {
      this.setData({ loading: false, loadError: true });
      wx.showToast({ title: '订单信息不存在', icon: 'none' });
    }
  },

  onShow() {
    const order = this.data.order || {};
    // 从自取凭证页返回：状态可能刚被专员核销，主动拉一次最新订单
    if (this._refreshOnShow) {
      this._refreshOnShow = false;
      if (this.data.orderId) this.loadOrderDetail(this.data.orderId);
    }
    if (
      this.data.orderId &&
      (order.status === 'received' || order.status === 'signed') &&
      !this.data.isVoucherOrder
    ) {
      this.loadReviewStatus(this.data.orderId);
    }
  },

  retryLoad() {
    if (this.data.orderId) this.loadOrderDetail(this.data.orderId);
  },

  // 🟢 核心：加载订单详情
  async loadOrderDetail(id) {
    wx.showNavigationBarLoading();
    
    try {
      const openid = await ensureOpenId(app);
      if (!openid) {
        this.setData({ loading: false });
        denyOrderAccess();
        return;
      }

      const res = await db.collection('orders').doc(id).get();
      const data = res.data;

      if (!data) {
        this.setData({ loading: false, loadError: true });
        wx.showToast({ title: '订单不存在', icon: 'none' });
        return;
      }

      if (!canAccessOrder(data, openid)) {
        this.setData({ loading: false });
        denyOrderAccess();
        return;
      }

      const isGiver = isOrderOwnedBy(data, openid);
      const isReceiver = isGiftReceiverOf(data, openid) && !isGiver;
      const giftMeta = data.giftMeta || {};
      const hidePriceForViewer =
        isReceiver && giftMeta.hidePrice !== false;
      
      const dateObj = data.createTime ? new Date(data.createTime) : new Date();

      // 金额数据清洗 (防止 undefined 计算报错)
      // 数据库存的 totalPrice 可能是字符串 "1,200.00" 也可能是数字
      const totalRaw = data.totalPrice != null ? data.totalPrice : 0;
      const total = parseFloat(String(totalRaw).replace(/,/g, '')) || 0;
      const original = data.originalPrice 
        ? parseFloat(String(data.originalPrice).replace(/,/g, '')) 
        : total;
      const coupon = parseFloat(data.couponValue || 0);
      const shippingFee = parseFloat(data.shippingFee != null ? data.shippingFee : 0) || 0;
      const catalogFee = Math.max(
        0,
        parseFloat(
          shippingConfig.flatFee != null ? shippingConfig.flatFee : shippingConfig.shippingFee
        ) || 0
      );
      const isShippingFree = shippingFee <= 0;
      const showShippingStrike = isShippingFree && catalogFee > 0;
      
      // 计算实际优惠金额 (用于展示省了多少钱)；total 含运费，需加回 shippingFee
      let discountAmt = (original + shippingFee - total - coupon).toFixed(2);
      if (discountAmt < 0) discountAmt = 0;

      // 格式化为 2025.11.22
      const dateStr = dateObj.toLocaleDateString().replace(/\//g, '.');
      const orderNoTail = data.orderNo ? String(data.orderNo).slice(-6) : String(data._id || '').slice(-6);
      const serialNo = `ARC-${orderNoTail || '------'}-${dateObj.getFullYear()}`;

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
          sText = '待付款'; 
          break;
        case 'fulfilling':
          sClass = 'warn';
          sText = '支付确认中';
          break;
        case 'void':
          sClass = 'void';
          sText = '已取消';
          break;
        case 'paid':        // 待发货
          sClass = 'warn'; 
          sText = (data.storePickup || data.fulfillmentType === 'store_pickup')
            ? '待自取'
            : '待发货'; 
          break;
        case 'ready_pickup':
          sClass = 'warn';
          sText = '待自取';
          break;
        case 'paid_awaiting_address':
          sClass = 'warn';
          sText =
            data.giftMeta && data.giftMeta.addressStatus === 'submitted'
              ? '待发货'
              : (isReceiver ? '待你填写地址' : '待 TA 填写地址');
          break;
        case 'expired_refunding':
          sClass = 'error';
          sText = '填址过期退款中';
          break;    
        case 'shipped':     // 待收货
          sClass = 'active'; 
          sText = '待收货'; 
          break; 
        case 'received':    // 已签收
          sClass = 'success'; 
          sText = '已签收'; 
          break;
        case 'aftersales':
          sClass = 'error';
          sText = '售后中';
          break;
        case 'refunding':   // 退款中
          sClass = 'error'; 
          sText = '退款中'; 
          break; 
        case 'refunded':    // 已退款
          sClass = 'void'; 
          sText = '已退款'; 
          break;
        // ERP 侧「批准退款」写入的状态：此前 C 端无分支 → 显示成「处理中」
        case 'refund_approved':
          sClass = 'error';
          sText = '退款审核通过 · 处理中';
          break;
        // ERP 侧「拒绝退款」写入的状态：此前无分支 → 永久「处理中」且无法再次申请
        case 'refund_rejected':
          sClass = 'error';
          sText = '退款未通过 · 可重新申请';
          break;
        case 'cancelled':
          sClass = 'void';
          sText = '已取消';
          break;
      }

      // 礼赠待填址：以 addressStatus 为准（填址后偶发 status 未翻转，勿仅看 paid_awaiting_address）
      const giftStampBlocked = [
        'shipped', 'received', 'refunded', 'void', 'cancelled',
        'expired_refunding', 'refunding', 'aftersales', 'refund_approved'
      ].includes(data.status)
      const gmStamp = data.giftMeta || {}
      const giftAwaitingForStamp = !giftStampBlocked &&
        gmStamp.deliveryType === 'invite_address' &&
        gmStamp.addressStatus !== 'submitted' &&
        (data.status === 'paid_awaiting_address' || data.status === 'paid')
      if (giftAwaitingForStamp) {
        sClass = 'warn'
        sText = isReceiver ? '待你填写地址' : '待 TA 填写地址'
      }

      // 定金 / 尾款单：覆盖印章文案，避免「已付定金」显示成「待发货」
      try {
        const { resolveDepositDisplay } = require('../utils/depositOrderDisplay')
        const depositDisp = resolveDepositDisplay(data)
        if (depositDisp && depositDisp.label) {
          sText = depositDisp.label
          if (data.status === 'paid' && (data.orderType === 'deposit' || data.source === 'deposit')) {
            sClass = 'success'
          }
        }
        data._depositTag = depositDisp ? depositDisp.tag : ''
        data._depositPayLabel =
          depositDisp && data.status === 'pending_pay'
            ? (data.orderType === 'deposit' || data.source === 'deposit' ? '付定金' : '付尾款')
            : ''
      } catch (e) { /* ignore */ }

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
      const productsForView = Array.isArray(data.products)
        ? data.products.map((p) => {
            if (!hidePriceForViewer || !p || typeof p !== 'object') return p
            const next = { ...p }
            delete next.price
            return next
          })
        : []
      const orderPayload = {
          ...data,
          _id: data._id,
          archiveDate: dateStr,
          serialNo: serialNo,
          
          // 确保金额显示为两位小数（受赠人隐价时不展示）
          totalPrice: hidePriceForViewer
            ? ''
            : total.toLocaleString('en-US', { minimumFractionDigits: 2 }),
          originalPrice: hidePriceForViewer
            ? ''
            : original.toLocaleString('en-US', { minimumFractionDigits: 2 }),
          shippingFee,
          shippingFeeDisplay: shippingFee.toFixed(2),
          shippingFeeLabel: isShippingFree
            ? '免邮'
            : `¥ ${shippingFee.toFixed(2)}`,
          showShippingStrike,
          originalShippingFeeDisplay: catalogFee.toFixed(2),
          discountAmount: hidePriceForViewer ? 0 : discountAmt,
          couponValue: hidePriceForViewer ? 0 : coupon,
          discountRate: data.discountRate || 1.0,

          // 🟢 关键：确保物流对象存在，防止 WXML 报错
          logistics: data.logistics || { 
            carrier: '等待揽收', 
            trackingNumber: '---' 
          },
          address: data.address || { name: '—', phone: '', region: [], detail: '' },
          addressLine: formatAddressLine(data.address),
          products: productsForView
        };

      const careContext = await resolveCareContext(orderPayload);
      const logistics = orderPayload.logistics || {};
      const trackingNumber = String(logistics.trackingNumber || '').trim();
      const hasTracking = !!(trackingNumber && trackingNumber !== '---' && trackingNumber.length >= 6);
      const waybillToken = logistics.waybillToken || logistics.followWaybillToken || '';
      const hasPlugin = !!logisticsPlugin;
      const canOpenWxTrack = !!(waybillToken && hasPlugin);
      const refundNotice = getDisplayNotice(data);
      const refundPolicy = getPolicy(data);
      const trackHint = buildTrackHint({
        canOpenWxTrack,
        trackingNumber,
        logistics,
        hasPlugin,
        hasToken: !!waybillToken
      });

      this.setData({ 
        order: orderPayload,
        hasTracking,
        waybillToken,
        canOpenWxTrack,
        trackHint,
        isVoucherOrder: isVoucherOrder, // 标识是否为代金券订单
        isStorePickup: !!(
          data.storePickup ||
          data.fulfillmentType === 'store_pickup' ||
          (data.giftMeta && data.giftMeta.deliveryType === 'store_pickup')
        ),
        pickupStoreName: data.storeName || (data.giftMeta && data.giftMeta.storeName) || '山川造物',
        customPreviewLines: data.customMeta ? buildPreviewSummary(data.customMeta) : [],
        isCustomOrder: !!(data.customMeta && data.customMeta.isCustom),
        refundPolicyLabel: refundNotice.label,
        refundPolicyParagraphs: refundNotice.paragraphs,
        refundPolicyRichParagraphs: refundNotice.richParagraphs || [],
        showPayConfirmRetry: data.status === 'fulfilling',
        // 兑换单（source=exchange，0 元）不走支付退款通道：退款金额为 0 必然失败，
        // 会把订单永久卡在 refunding；如需撤销兑换应有独立流程（退 usedPoints + 回补库存）
        showRefundEntry:
          data.source !== 'exchange' &&
          isGiver &&
          refundPolicy.userCanRequest &&
          (data.status === 'paid' ||
            data.status === 'ready_pickup' ||
            data.status === 'paid_awaiting_address' ||
            data.status === 'shipped' ||
            data.status === 'received' ||
            data.status === 'refund_rejected'),
        refundEntryLabel:
          data.status === 'shipped' || data.status === 'received' ? '申请售后' : '申请退款',
        evidenceVideoUrl: '',
        evidenceImageUrls: [],
        hasEvidenceBlock: false,
        productionStatusLabel: data.productionStatus
          ? (PRODUCTION_STATUS_LABELS[data.productionStatus] || '')
          : '',
        isGiftOrder: data.source === 'gift' || !!data.giftMeta,
        isGiftReceiver: isReceiver,
        showOrderPrice: !hidePriceForViewer,
        giftAwaitingAddress: (() => {
          // 待填址分享/催填仅送礼人操作
          if (!isGiver) return false
          const blocked = [
            'shipped', 'received', 'refunded', 'void', 'cancelled',
            'expired_refunding', 'refunding', 'aftersales', 'refund_approved'
          ].includes(data.status)
          if (blocked) return false
          const gm = data.giftMeta || {}
          return gm.deliveryType === 'invite_address' &&
            gm.addressStatus !== 'submitted' &&
            (data.status === 'paid_awaiting_address' || data.status === 'paid')
        })(),
        giftReceiverNeedsAddress: (() => {
          if (!isReceiver) return false
          const blocked = [
            'shipped', 'received', 'refunded', 'void', 'cancelled',
            'expired_refunding', 'refunding', 'aftersales', 'refund_approved'
          ].includes(data.status)
          if (blocked) return false
          const gm = data.giftMeta || {}
          return gm.deliveryType === 'invite_address' &&
            gm.addressStatus !== 'submitted' &&
            (data.status === 'paid_awaiting_address' || data.status === 'paid')
        })(),
        giftExpireHint: (() => {
          const gm = data.giftMeta || {}
          const blocked = [
            'shipped', 'received', 'refunded', 'void', 'cancelled',
            'expired_refunding', 'refunding', 'aftersales', 'refund_approved'
          ].includes(data.status)
          const awaiting = !blocked &&
            gm.deliveryType === 'invite_address' &&
            gm.addressStatus !== 'submitted' &&
            (data.status === 'paid_awaiting_address' || data.status === 'paid')
          if (!awaiting) {
            if (data.status === 'expired_refunding') return '填址已过期，退款处理中'
            return ''
          }
          if (gm.expireAt) {
            try {
              const d = new Date(gm.expireAt)
              if (!isNaN(d.getTime())) {
                return isReceiver
                  ? `请在 ${d.getMonth() + 1}月${d.getDate()}日前留下地址`
                  : `请在 ${d.getMonth() + 1}月${d.getDate()}日前请 TA 留下地址`
              }
            } catch (e) { /* ignore */ }
          }
          const days = parseInt(gm.addressTimeoutDays, 10) || 7
          return isReceiver
            ? `请在 ${days} 日内留下地址`
            : `请在 ${days} 日内请 TA 留下地址`
        })(),
        giftShareToken: (data.giftMeta && data.giftMeta.shareToken) || '',
        giftShowPickupClaim: !!(data.giftMeta && data.giftMeta.deliveryType === 'store_pickup' && data.giftMeta.claimCode && data.status !== 'received' && data.giftMeta.claimStatus !== 'claimed'),
        giftClaimCode: (data.giftMeta && data.giftMeta.claimCode) || '',
        showOrderPickup: !!(
          !(data.source === 'gift' || data.giftMeta) &&
          (data.storePickup || data.fulfillmentType === 'store_pickup') &&
          data.pickupCode &&
          data.status !== 'received' &&
          data.pickupStatus !== 'claimed'
        ),
        orderPickupCode: data.pickupCode || '',
        orderPickupStoreName: data.storeName || '',
        pickupDoneInfo: (() => {
          if (data.source === 'gift' || data.giftMeta) return null;
          const isPickup = !!(data.storePickup || data.fulfillmentType === 'store_pickup');
          if (!isPickup) return null;
          if (data.status !== 'received' && data.status !== 'signed') return null;
          return {
            code: data.pickupCode || '',
            claimedAt: data.pickupClaimedAt || data.receiveTime || null,
            claimedAtText: formatPickupTime(data.pickupClaimedAt || data.receiveTime)
          };
        })(),
        giftCardBody: (data.giftMeta && data.giftMeta.cardBody) || '',
        giftCardSignature: (data.giftMeta && data.giftMeta.cardSignature) || '',
        giftHasVoice: !!(data.giftMeta && data.giftMeta.voiceFileID && data.giftMeta.voiceDuration),
        // 礼赠档案：受赠人 / 状态 / 礼笺摘要（订单详情页要给"回看这封礼笺 + 看进展"的入口）
        giftRecipientName: (data.giftMeta && (data.giftMeta.recipientName || data.giftMeta.toName)) ||
          (data.address && data.address.name) || '',
        giftStatusText: (() => {
          const gm = data.giftMeta || {}
          const addrSubmitted = gm.addressStatus === 'submitted'
          const invite = gm.deliveryType === 'invite_address'
          if (invite && !addrSubmitted && ['paid', 'paid_awaiting_address'].includes(data.status)) {
            return isGiver ? '等待 TA 留下收件去处' : '等你留下收件去处'
          }
          if (gm.claimStatus === 'claimed') return 'TA 已领取'
          if (data.status === 'shipped') return '礼物已寄出'
          if (data.status === 'received') return '礼物已送达'
          if (['refunded', 'expired_refunding', 'refunding'].includes(data.status)) return '礼赠已退回'
          return '等待 TA 领取'
        })(),
        giftStatusTone: (() => {
          const gm = data.giftMeta || {}
          if (['refunded', 'expired_refunding', 'refunding'].includes(data.status)) return 'muted'
          if (data.status === 'received' || gm.claimStatus === 'claimed') return 'done'
          if (data.status === 'shipped') return 'moving'
          return 'waiting'
        })(),
        giftNotePreview: String((data.giftMeta && (data.giftMeta.cardBody || data.giftMeta.themeNote)) || '')
          .replace(/\s+/g, ' ')
          .slice(0, 48),
        // 受赠人看到的入口应回**自己拆信那一页**（receive），送礼人才看封缄页（success）
        giftEnvelopeLabel: isReceiver ? '再拆一次这封礼笺' : '查看礼赠信封',
        stampClass: sClass,
        stampText: sText,
        depositTag: data._depositTag || '',
        payBtnLabel: data._depositPayLabel || '',
        isDepositOrder: !!(data.orderType === 'deposit' || data.source === 'deposit'),
        depositCredit: data.depositCredit != null ? data.depositCredit : 0,
        isExpired: isExpired,
        loading: false,
        loadError: false,
        showCare: careContext.showCare,
        careContext,
        reviewSummaryLabel: '',
        reviewCanAny: false,
        reviewPendingCount: 0,
        reviewProducts: []
      });
      
      wx.hideNavigationBarLoading();

      this.resolveEvidenceMedia(data);

      // 门店自取：异步补齐领取门店的地址/营业时间/坐标（走本地缓存，不额外等待）
      // 二维码与核销码在独立页 subpackages/business/pickup-pass 绘制
      if (this.data.isStorePickup) {
        this.hydratePickupStore(data.storeId || '');
      }

      if ((data.status === 'received' || data.status === 'signed') && !isVoucherOrder) {
        this.loadReviewStatus(id);
      }

      // 6. 启动解密动画 (延迟 300ms 让页面先渲染，提升体验)
      setTimeout(() => {
        try {
          this.setData({ isDecrypted: true });
          if (this.data.isGiftOrder) this._prepareGiftShareImage();
        } catch (e) {
          console.warn('解密动画异常（不阻塞展示）', e && e.message);
        }
      }, 300);
      // 兜底：定时器被回收或回调异常时，确保内容不停留在 opacity:0 的不可见态
      setTimeout(() => {
        if (!this.data.isDecrypted) this.setData({ isDecrypted: true });
      }, 900);

      if (hasTracking && !waybillToken && (data.status === 'shipped' || data.status === 'received')) {
        // 占位单号不必请求云函数；真实单号则补同步（云函数已修复「失败状态永久锁死」）
        if (!looksLikePlaceholderTracking(trackingNumber)) {
          this.ensureWxExpressToken(id);
        }
      }

      // 店长工作台跳转：同步打开官方轨迹（插件仅在本分包声明）
      if (this.data._openTrackOnLoad) {
        this.setData({ _openTrackOnLoad: false });
        setTimeout(() => {
          this.openWaybillTracking();
        }, 450);
      }

    } catch (err) {
      console.error('订单加载失败', err);
      this.setData({ loading: false, loadError: true, _openTrackOnLoad: false });
      wx.showToast({ title: '档案读取失败', icon: 'none' });
      wx.hideNavigationBarLoading();
    }
  },

  // 待付款 — 唤起支付
  async handlePay() {
    const orderId = this.data.order && this.data.order._id;
    if (!orderId) {
      wx.showToast({ title: '订单信息未就绪', icon: 'none' });
      return;
    }

    // 上一次支付后仍在确认中（回调延迟）：短时间内禁止再次发起支付，避免重复扣款
    if (this._payCooldownUntil && Date.now() < this._payCooldownUntil) {
      const secs = Math.ceil((this._payCooldownUntil - Date.now()) / 1000);
      this.modal({
        title: '支付结果确认中',
        overline: 'PAYMENT PENDING',
        content: `这笔订单的支付结果仍在确认（约 ${secs} 秒后可重试）。请勿重复支付；确认后下拉刷新即可看到最新状态。`,
        showCancel: false
      });
      return;
    }

    if (this.data.order.payExpireTime && new Date(this.data.order.payExpireTime).getTime() < Date.now()) {
      wx.showToast({ title: '订单已过期', icon: 'none' });
      this.loadOrderDetail(orderId);
      return;
    }

    wx.vibrateShort({ type: 'medium' });
    try {
      const payResult = await payForOrder(orderId);
      const pending = !!(payResult && payResult.pendingConfirm);
      wx.showToast({
        title: pending ? '支付确认中，请稍后下拉刷新' : '支付成功',
        icon: pending ? 'none' : 'success'
      });
      if (pending) {
        // 2 分钟冷却：给支付回调留出重试与补单时间
        this._payCooldownUntil = Date.now() + 2 * 60 * 1000;
      } else {
        this._payCooldownUntil = 0;
      }
      this.loadOrderDetail(orderId);
    } catch (err) {
      if (err.message === '已取消支付') return;
      const msg = err.message || '支付失败';
      if (/支付未开通|暂不可用|支付服务不可用|支付参数|预支付/.test(msg)) {
        this.modal({
          title: '暂无法支付',
          overline: 'PAYMENT UNAVAILABLE',
          content: msg.replace(/^requestPayment:fail\s*/i, ''),
          showCancel: false
        });
      } else {
        wx.showToast({ title: msg.replace(/^requestPayment:fail\s*/i, '').slice(0, 40), icon: 'none' });
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

    this.modal({
      title: '取消订单',
      overline: 'CANCEL ORDER',
      content: '确定取消该待付款订单？',
      confirmText: '取消订单',
      danger: true
    }).then(async (res) => {
      if (!res.confirm) return;
      wx.showLoading({ title: '取消中…' });
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
    });
  },

  // 🟢 交互：复制物流单号
  copyTracking() {
    const logistics = this.data.order && this.data.order.logistics;
    const no = logistics && logistics.trackingNumber;
    // 如果没有单号或单号无效，不执行
    if (!no || no === '---') return;
    
    wx.vibrateShort({ type: 'light' });
    wx.setClipboardData({
      data: no,
      success: () => wx.showToast({ title: '单号已复制', icon: 'none' })
    });
  },

  async ensureWxExpressToken(orderId, { force = false } = {}) {
    if (this._ensuringExpress || !orderId) return;
    this._ensuringExpress = true;
    try {
      const res = await wx.cloud.callFunction({
        name: 'managerShipOrder',
        data: { action: 'ensureWxExpress', orderId, force: !!force }
      });
      const result = (res && res.result) || {};
      const token = result.waybillToken || '';
      const logistics = (this.data.order && this.data.order.logistics) || {};
      const trackingNumber = String(logistics.trackingNumber || '').trim();
      if (token) {
        const canOpenWxTrack = !!logisticsPlugin;
        this.setData({
          waybillToken: token,
          canOpenWxTrack,
          trackHint: canOpenWxTrack
            ? ''
            : buildTrackHint({
                canOpenWxTrack: false,
                trackingNumber,
                logistics,
                hasPlugin: !!logisticsPlugin,
                hasToken: true
              }),
          'order.logistics.waybillToken': token,
          'order.logistics.wxExpressStatus': result.wxExpressStatus || 'ok',
          'order.logistics.wxExpressSkipReason': '',
          'order.logistics.wxExpressError': ''
        });
      } else {
        const mergedLogistics = {
          ...logistics,
          wxExpressStatus: result.wxExpressStatus || logistics.wxExpressStatus || '',
          wxExpressSkipReason: result.wxExpressSkipReason || logistics.wxExpressSkipReason || '',
          wxExpressError: result.wxExpressError || logistics.wxExpressError || ''
        };
        this.setData({
          trackHint: buildTrackHint({
            canOpenWxTrack: false,
            trackingNumber,
            logistics: mergedLogistics,
            ensureResult: result,
            hasPlugin: !!logisticsPlugin,
            hasToken: false
          }),
          'order.logistics.wxExpressStatus': mergedLogistics.wxExpressStatus,
          'order.logistics.wxExpressSkipReason': mergedLogistics.wxExpressSkipReason,
          'order.logistics.wxExpressError': mergedLogistics.wxExpressError
        });
      }
    } catch (err) {
      console.warn('[order-detail] ensureWxExpress', err);
    } finally {
      this._ensuringExpress = false;
    }
  },

  // 官方物流查询插件：有 waybill_token 打开轨迹，否则先补同步，再复制单号降级
  async openWaybillTracking() {
    if (this._openingTrack) return;
    this._openingTrack = true;
    wx.vibrateShort({ type: 'light' });
    let token = this.data.waybillToken;
    const orderId = this.data.orderId || (this.data.order && this.data.order._id);
    let showedLoading = false;

    try {
      if ((!token || !logisticsPlugin) && orderId && !looksLikePlaceholderTracking(
        (this.data.order && this.data.order.logistics && this.data.order.logistics.trackingNumber) || ''
      )) {
        showedLoading = true;
        wx.showLoading({ title: '同步物流…', mask: true });
        await this.ensureWxExpressToken(orderId, { force: !token });
        token = this.data.waybillToken;
      }

      if (token && logisticsPlugin && typeof logisticsPlugin.openWaybillTracking === 'function') {
        try {
          if (showedLoading) {
            wx.hideLoading();
            showedLoading = false;
          }
          logisticsPlugin.openWaybillTracking({ waybillToken: token });
          return;
        } catch (err) {
          console.warn('[order-detail] openWaybillTracking', err);
        }
      }

      if (showedLoading) {
        wx.hideLoading();
        showedLoading = false;
      }

      if (token && !logisticsPlugin) {
        this.modal({
          title: '轨迹组件未加载',
          overline: 'PLUGIN MISSING',
          content:
            '该订单已开通官方轨迹，但当前小程序未加载物流查询插件。请用微信开发者工具重新编译预览，或等待体验版/正式版更新后再试。',
          showCancel: false,
          confirmText: '先复制单号'
        });
      }
      this.copyTracking();
    } finally {
      if (showedLoading) {
        try { wx.hideLoading(); } catch (e) { /* ignore */ }
      }
      this._openingTrack = false;
    }
  },

  // 🟢 交互：复制档案编号
  copyOrderNo() {
    const orderNo = this.data.order && this.data.order.orderNo;
    if (!orderNo) {
      wx.showToast({ title: '编号暂不可用', icon: 'none' });
      return;
    }
    wx.vibrateShort({ type: 'light' });
    wx.setClipboardData({
      data: String(orderNo),
      success: () => wx.showToast({ title: '编号已复制', icon: 'none' })
    });
  },

  // 🟢 核心业务：确认收货 (闭环最后一步)
  confirmReceipt() {
    wx.vibrateShort({ type: 'heavy' }); // 重震动提醒重要性
    
    this.modal({
      title: '确认签收',
      overline: 'CONFIRM RECEIPT',
      content: '确认已收到藏品？\n签收后将生成收藏证书，并可写下感受与查看养护指南。',
      confirmText: '确认签收'
    }).then(async (res) => {
      if (!res.confirm) return;
      wx.showLoading({ title: '确认签收…', mask: true });

      try {
        const orderSnapshot = { ...this.data.order };
        const care = await confirmReceiptOnOrder(this.data.order._id, orderSnapshot);
        await this.loadOrderDetail(this.data.order._id);
        // 确认收货赠分提示（与门店同规则，按订单幂等）
        if (care && care.pointsGranted > 0) {
          wx.showToast({
            title: `已签收，获赠 ${care.pointsGranted} 积分`,
            icon: 'none',
            duration: 2600
          });
        }
      } catch (err) {
        console.error(err);
        wx.showToast({ title: '操作失败，请重试', icon: 'none' });
      } finally {
        wx.hideLoading();
      }
    });
  },

  // 申请退款 / 售后：统一进入举证申请页
  requestRefund() {
    wx.vibrateShort({ type: 'medium' });
    const order = this.data.order || {};
    const check = canUserRequestRefund(order);
    if (!check.ok) {
      this.modal({
        title: needsUnboxEvidence(order) ? '无法申请售后' : '无法申请退款',
        overline: 'NOT AVAILABLE',
        content: check.reason || '当前不可申请',
        confirmText: '联系专员'
      }).then((res) => {
        if (res.confirm) this.goToSupport();
      });
      return;
    }
    if (!order._id) {
      wx.showToast({ title: '订单信息缺失', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/subpackages/business/aftersale-apply/index?id=${order._id}`,
      fail: () => wx.showToast({ title: '无法打开申请页', icon: 'none' })
    });
  },

  async resolveEvidenceMedia(order) {
    const videoId = String((order && order.unboxVideoFileId) || '').trim();
    const imageIds = Array.isArray(order && order.evidenceImageFileIds)
      ? order.evidenceImageFileIds.filter(Boolean)
      : [];
    if (!videoId && !imageIds.length) {
      this.setData({ evidenceVideoUrl: '', evidenceImageUrls: [], hasEvidenceBlock: false });
      return;
    }
    try {
      const map = await batchTempFileURLs([videoId].concat(imageIds).filter(Boolean));
      const evidenceVideoUrl = (videoId && map[videoId]) || videoId || '';
      const evidenceImageUrls = imageIds.map((id) => map[id] || id).filter(Boolean);
      this.setData({
        evidenceVideoUrl,
        evidenceImageUrls,
        hasEvidenceBlock: !!(evidenceVideoUrl || evidenceImageUrls.length)
      });
    } catch (e) {
      console.warn('resolveEvidenceMedia', e);
      this.setData({
        evidenceVideoUrl: videoId,
        evidenceImageUrls: imageIds,
        hasEvidenceBlock: !!(videoId || imageIds.length)
      });
    }
  },

  previewEvidenceImage(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10) || 0;
    const urls = this.data.evidenceImageUrls || [];
    if (!urls.length) return;
    wx.previewImage({ current: urls[idx], urls });
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
    const fail = () => wx.showToast({ title: '无法打开养护指南', icon: 'none' });
    if (!ctx.showCare) {
      wx.navigateTo({ url: '/subpackages/feature/care/index?from=order', fail });
      return;
    }
    wx.navigateTo({
      url: ctx.guideUrl || buildGuideUrl({
        category: ctx.category,
        orderId: this.data.order._id,
        productId: ctx.productId,
        from: 'order'
      }),
      fail
    });
  },

  // 点击商品卡片跳转详情
  goToProduct(e) {
    const id = e.currentTarget.dataset.id;
    if (id) {
      wx.navigateTo({
        url: `/subpackages/feature/detail/index?id=${id}`,
        fail: () => wx.showToast({ title: '无法打开藏品', icon: 'none' })
      });
    }
  },

  async loadReviewStatus(orderId) {
    const id = orderId || this.data.orderId || (this.data.order && this.data.order._id);
    if (!id) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'submitComment',
        data: { action: 'orderStatus', orderId: id }
      });
      const result = (res && res.result) || {};
      if (!result.success) return;
      this.setData({
        reviewSummaryLabel: result.summaryLabel || '',
        reviewCanAny: !!result.canReviewAny,
        reviewPendingCount: result.pendingCount || 0,
        reviewProducts: Array.isArray(result.products) ? result.products : []
      });
    } catch (e) {
      console.warn('loadReviewStatus', e);
    }
  },

  // 评价入口：绑定 orderId，优先跳未评价商品
  goToComment(e) {
    const order = this.data.order || {};
    const orderId = order._id || this.data.orderId;
    if (!orderId) {
      wx.showToast({ title: '订单信息异常', icon: 'none' });
      return;
    }

    const fromTap = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.productId
      : '';
    const products = this.data.reviewProducts || [];
    let productId = fromTap || '';
    if (!productId) {
      const pending = products.find((p) => p.canReview);
      productId = (pending && pending.productId) || (products[0] && products[0].productId) || '';
    }
    if (!productId && order.products && order.products[0]) {
      const first = order.products[0];
      productId = first.id || first._id || first.productId || '';
    }
    if (!productId) {
      wx.showToast({ title: '暂无藏品可评价', icon: 'none' });
      return;
    }

    wx.vibrateShort({ type: 'light' });
    let url = `/subpackages/feature/comment/index?targetType=product&orderId=${encodeURIComponent(orderId)}&targetId=${encodeURIComponent(productId)}`;
    wx.navigateTo({
      url,
      fail: () => wx.showToast({ title: '无法打开评价页', icon: 'none' })
    });
  },


  // 联系专员（强制带订单；顺带首件藏品，便于客服对照）
  /**
   * 支付确认中（fulfilling）自救：重新向云端确认支付结果。
   * 此前该状态无任何入口（前端只在 payOrder 成功后才会调 confirmPayment），
   * 一旦回调抢占后函数超时，订单会永久停在「支付确认中」。
   */
  async retryConfirmPayment() {
    if (this.data.payConfirmBusy) return;
    const order = this.data.order || {};
    if (!order._id) return;
    this.setData({ payConfirmBusy: true });
    wx.showLoading({ title: '确认支付结果…', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'confirmPayment',
        data: { orderId: order._id }
      });
      wx.hideLoading();
      const result = (res && res.result) || {};
      if (result.success) {
        wx.showToast({ title: '支付已确认，订单已更新', icon: 'none' });
        await this.loadOrderDetail(order._id);
      } else {
        wx.showToast({ title: result.msg || '仍未确认到支付，请稍后再试', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '确认失败，请稍后再试', icon: 'none' });
    } finally {
      this.setData({ payConfirmBusy: false });
    }
  },

  /** 下拉刷新（配置在 index.json 的 enablePullDownRefresh） */
  async onPullDownRefresh() {
    const order = this.data.order || {};
    try {
      if (order._id && typeof this.loadOrderDetail === 'function') {
        await this.loadOrderDetail(order._id);
      }
    } catch (e) {
      console.warn('onPullDownRefresh failed', e);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  goToSupport() {
    const { buildSupportQuery, pickProductFromOrder } = require('../utils/supportHelper');
    const order = this.data.order || {};
    if (!order._id) {
      wx.navigateTo({
        url: '/subpackages/extra/user/support/index?topic=order',
        fail: () => wx.showToast({ title: '无法打开联系专员', icon: 'none' })
      });
      return;
    }
    const picked = pickProductFromOrder(order);
    const url =
      '/subpackages/extra/user/support/index' +
      buildSupportQuery({
        topic: 'order',
        orderId: order._id,
        orderNo: order.orderNo || '',
        productId: picked.productId,
        productName: picked.productName,
        productCount: picked.productCount
      });
    wx.navigateTo({
      url,
      fail: () => wx.showToast({ title: '无法打开联系专员', icon: 'none' })
    });
  },

  async _prepareGiftShareImage() {
    try {
      const { renderGiftShareImage } = require('../gift/giftShareCard');
      const order = this.data.order || {};
      const products = order.products || [];
      const p0 = products[0] || {};
      const specimenFileID = p0.image || (p0.images && p0.images[0]) || '';
      const path = await renderGiftShareImage('#giftShareCanvas', this, {
        cardBody: this.data.giftCardBody,
        cardSignature: this.data.giftCardSignature,
        hasVoice: this.data.giftHasVoice,
        specimenFileID
      });
      if (path) this.setData({ giftShareImageUrl: path });
    } catch (e) {
      console.warn('order gift share image', e);
    }
  },

  /** 查看礼赠信封：送礼人 → 封缄/分享页；受赠人 → 自己拆信那一页 */
  goGiftEnvelope() {
    const order = this.data.order || {};
    const id = order._id || this.data.orderId || '';
    if (!id) return;
    const token = this.data.giftShareToken || (order.giftMeta && order.giftMeta.shareToken) || '';
    const q = [`orderId=${encodeURIComponent(id)}`];
    if (token) q.push(`token=${encodeURIComponent(token)}`);
    const base = this.data.isGiftReceiver
      ? '/subpackages/feature/gift/receive/index'
      : '/subpackages/feature/gift/success/index';
    wx.navigateTo({
      url: `${base}?${q.join('&')}`,
      // ⚠️ 不用 `wx.showToast` 兜底：本页的原生弹窗计数被 `check:dialog-ratchet` 棘轮钉住（只许降不许涨）。
      //    失败时把人送到「我的礼赠」——比弹一句"打不开"更有用，也不新增原生调用。
      fail: () => wx.navigateTo({ url: '/subpackages/feature/gift/my-gifts/index?tab=sent' })
    });
  },

  /** 礼赠详情：到「我的礼赠」里这份礼赠所在的那一栏（送出 / 收到） */
  goGiftDetail() {
    const name = String(this.data.giftRecipientName || '').trim();
    const parts = [`tab=${this.data.isGiftReceiver ? 'received' : 'sent'}`];
    // 送礼人按受赠人筛，能直接落到"致 某某"这一份；受赠人那边没有这个维度，就落到整栏
    if (name && !this.data.isGiftReceiver) parts.push(`contactName=${encodeURIComponent(name)}`);
    wx.navigateTo({
      url: `/subpackages/feature/gift/my-gifts/index?${parts.join('&')}`,
      // 同上：不新增原生 toast；退无可退时回个人中心（那里本来就有「我的礼赠」入口）
      fail: () => wx.switchTab({ url: '/pages/user/index' })
    });
  },

  onShareAppMessage() {
    const order = this.data.order || {};
    const token = this.data.giftShareToken || (order.giftMeta && order.giftMeta.shareToken) || '';
    const id = order._id || this.data.orderId || '';
    const payload = {
      title: '请拆开这封山海礼笺',
      path: `/subpackages/feature/gift/receive/index?orderId=${id}&token=${token}`
    };
    if (this.data.giftShareImageUrl) payload.imageUrl = this.data.giftShareImageUrl;
    return payload;
  },

  onShareTimeline() {
    const order = this.data.order || {};
    const id = order._id || this.data.orderId || '';
    const token = this.data.giftShareToken || (order.giftMeta && order.giftMeta.shareToken) || '';
    const parts = [];
    if (id) parts.push(`giftOrderId=${encodeURIComponent(id)}`);
    if (token) parts.push(`token=${encodeURIComponent(token)}`);
    const payload = {
      title: '请拆开这封山海礼笺',
      query: parts.join('&')
    };
    if (this.data.giftShareImageUrl) payload.imageUrl = this.data.giftShareImageUrl;
    return payload;
  },

  async nudgeGift() {
    const id = this.data.orderId || (this.data.order && this.data.order._id);
    if (!id) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageGift',
        data: { action: 'nudge', orderId: id }
      });
      const result = (res && res.result) || {};
      wx.showToast({ title: result.msg || (result.success ? '已轻轻提醒' : '此刻未能提醒'), icon: 'none' });
    } catch (e) {
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  goFillGiftAddress() {
    const id = this.data.orderId || (this.data.order && this.data.order._id);
    if (!id) return;
    wx.navigateTo({
      url: `/subpackages/feature/gift/address/index?orderId=${encodeURIComponent(id)}`
    });
  },


  goGiftPickupClaim() {
    const id = this.data.orderId || (this.data.order && this.data.order._id);
    if (!id) return;
    wx.navigateTo({
      url: `/subpackages/feature/gift/success/index?orderId=${id}`
    });
  },

  // ------------------------------------------------------------ 门店自取

  /**
   * 打开独立的自取凭证页（凭证本体与订单详情解耦）
   * 带着自取码跳转，凭证页可立即出码，再异步补状态/门店信息。
   */
  openPickupPass() {
    const id = this.data.orderId || (this.data.order && this.data.order._id) || '';
    const code = this.data.orderPickupCode || '';
    if (!id && !code) {
      wx.showToast({ title: '凭证信息未就绪', icon: 'none' });
      return;
    }
    const qs = [];
    if (id) qs.push(`id=${encodeURIComponent(id)}`);
    if (code) qs.push(`code=${encodeURIComponent(code)}`);
    // 凭证页可能被核销：返回本页时刷新一次状态
    this._refreshOnShow = true;
    wx.navigateTo({
      url: `/subpackages/business/pickup-pass/index?${qs.join('&')}`,
      fail: () => wx.showToast({ title: '无法打开自取凭证', icon: 'none' })
    });
  },

  /** 领取门店信息（地址/营业时间/坐标）：门户块展示用，失败不阻塞主流程 */
  async hydratePickupStore(storeId) {
    try {
      const stores = await fetchStoreCatalog();
      const s = findCatalogStore(storeId, stores);
      if (!s) return;
      const hours = s.hours && s.hours.open ? `${s.hours.open}–${s.hours.close}` : '';
      this.setData({
        pickupStoreInfo: {
          name: s.name || '',
          floor: s.floor || s.locationLabel || '',
          address: s.address || '',
          hours,
          latitude: Number(s.latitude) || 0,
          longitude: Number(s.longitude) || 0,
          canNavigate: !!(s.latitude && s.longitude)
        }
      });
    } catch (e) {
      console.warn('[order-detail] 门店信息补齐失败', e);
    }
  },

  // 返回大厅
  goHome() { 
    wx.switchTab({ url: '/pages/index/index' }); 
  }
}));
