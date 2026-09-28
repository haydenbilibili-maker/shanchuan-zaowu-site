/**
 * 发货包装图片（**可选**）：与云端 `orderSummary.pickPackagePhotos` **同一口径**，
 * 但多一步**渲染态转换**（cloud fileID → https），见下面 normalizePackagePhotos。
 *
 * ⚠️ 下面那个转换函数是**刻意内联**的，不 `require('./imageUrl')`：
 * 本模块被 `test-legacy-remap` / `test-message-products` 用「任何 require 都非法」的桩
 * 直接加载（本仓对「被测试直接加载的纯模块」就是这么管的），加顶层 require 会把那两条守卫弄红。
 * 内联件与 `utils/imageUrl.cloudIdToHttps` **必须同口径** ——
 * 守卫 `check:package-photos` 会真跑两侧并比对结果（含一条专门注入）。
 */

/** cloud fileID → 免签名 https（真机 `<image src="cloud://…">` 渲染不出来，详见 utils/imageUrl.js） */
function cloudFileIdToHttps(fileID) {
  const s = String(fileID == null ? '' : fileID).trim()
  if (!s || s.indexOf('cloud://') !== 0) return s
  const rest = s.slice('cloud://'.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return s
  const host = rest.slice(0, slash)
  const path = rest.slice(slash + 1)
  const dot = host.indexOf('.')
  const bucket = dot === -1 ? '' : host.slice(dot + 1)
  if (!bucket || !path) return s
  return `https://${bucket}.tcb.qcloud.la/${path}`
}

const CATEGORY_META = {
  all: { label: '全部', icon: '/assets/icons/message.png' },
  booking: { label: '约访', icon: '/assets/icons/booking.png' },
  order: { label: '藏品', icon: '/assets/icons/cart.png' },
  custom: { label: '定制', icon: '/assets/icons/gift.png' },
  activity: { label: '馆讯', icon: '/assets/icons/gift.png' },
  system: { label: '馆务', icon: '/assets/icons/message.png' },
  ops: { label: '工作流', icon: '/assets/icons/message.png' },
  // 每日日报：工作信息里的独立一档（与「待办 ops」「审批 system」并列）。
  // 'digest' 同时是云函数写入时的 category（dailyDigest/reportCatalog.js MESSAGE_CATEGORY）
  // 与信箱工作流分页签的 id —— 三处必须一致，否则「日报」页签永远是空的。
  digest: { label: '日报', icon: '/assets/icons/trend.png' },
  other: { label: '其他', icon: '/assets/icons/message.png' }
};

const TYPE_META = {
  booking_success: { label: '预约已记下', category: 'booking' },
  booking_reminder: { label: '约访提醒', category: 'booking' },
  booking_changed: { label: '约访改期', category: 'booking' },
  booking_cancelled: { label: '约访取消', category: 'booking' },
  booking_verified: { label: '已核销', category: 'booking' },
  order_created: { label: '待落定', category: 'order' },
  order_paid: { label: '已入账', category: 'order' },
  staff_order_paid: { label: '新单待发', category: 'ops' },
  wishlist_restock_request: { label: '候补补货', category: 'ops' },
  order_shipped: { label: '已启程', category: 'order' },
  order_received: { label: '已入柜', category: 'order' },
  care_tip: { label: '养护来信', category: 'activity' },
  order_cancelled: { label: '已释出', category: 'order' },
  order_refunded: { label: '款项退回', category: 'order' },
  gift_paid: { label: '心意备妥', category: 'order' },
  gift_awaiting_address: { label: '待填地址', category: 'order' },
  gift_accepted: { label: '礼笺已开', category: 'order' },
  gift_address_submitted: { label: '去处已留', category: 'order' },
  gift_nudge: { label: '礼赠提醒', category: 'order' },
  gift_nudge_receiver: { label: '山海等你', category: 'order' },
  gift_shipped: { label: '礼赠启程', category: 'order' },
  gift_delivered: { label: '礼物到柜', category: 'order' },
  gift_received: { label: '到店领取', category: 'order' },
  gift_expired_refund: { label: '邀约过期', category: 'order' },
  gift_expired_refund_receiver: { label: '礼笺收回', category: 'order' },
  gift_refunded_receiver: { label: '心意收回', category: 'order' },
  // 以下 6 个云端会发送但此前无渲染分支（站内信显示为未知类型）
  gift_address_submitted_receiver: { label: 'TA 已留地址', category: 'order' },
  staff_artisan_sku_sold: { label: '作品售出', category: 'ops' },
  staff_deposit_paid: { label: '定金已付·待制作', category: 'ops' },
  staff_deposit_balance_window: { label: '尾款期临近', category: 'ops' },
  staff_deposit_forfeited: { label: '定金已没收', category: 'ops' },
  staff_deposit_settled: { label: '尾款已结清', category: 'ops' },
  wishlist_registered: { label: '候补已记', category: 'activity' },
  wishlist_available: { label: '候补回柜', category: 'activity' },
  deposit_paid_confirm: { label: '定金收妥', category: 'order' },
  deposit_balance_due: { label: '尾款窗口', category: 'order' },
  deposit_forfeited: { label: '尾款逾期', category: 'order' },
  deposit_settled_confirm: { label: '尾款结清', category: 'order' },
  custom_inquiry_received: { label: '定制入册', category: 'custom' },
  custom_inquiry_contacted: { label: '专员跟进', category: 'custom' },
  custom_production_framing: { label: '开始装裱', category: 'custom' },
  custom_production_packing: { label: '进入包装', category: 'custom' },
  custom_production_shipped: { label: '定制启程', category: 'custom' },
  pet_memorial_received: { label: '伴宠意向', category: 'custom' },
  pet_memorial_need_info: { label: '需补充', category: 'custom' },
  pet_memorial_quoted: { label: '伴宠报价', category: 'custom' },
  pet_memorial_accepted: { label: '已承接', category: 'custom' },
  pet_memorial_awaiting_intake: { label: '待交接', category: 'custom' },
  pet_intake_booked: { label: '交接预约', category: 'custom' },
  pet_memorial_in_production: { label: '制作中', category: 'custom' },
  pet_memorial_completed: { label: '已完成', category: 'custom' },
  support_ticket_received: { label: '留言入册', category: 'system' },
  support_ticket_replied: { label: '专员回复', category: 'system' },
  invoice_request_received: { label: '开票入册', category: 'system' },
  invoice_request_staff: { label: '开票待办', category: 'ops' },
  invoice_request_issued: { label: '发票已开', category: 'system' },
  invoice_request_rejected: { label: '开票未过', category: 'system' },
  approval_submitted: { label: '审批提交', category: 'ops' },
  approval_approved: { label: '审批通过', category: 'ops' },
  approval_rejected: { label: '审批驳回', category: 'ops' },
  // 每日日报（与云函数 dailyDigest 的 MESSAGE_TYPE 一致）
  daily_digest: { label: '每日日报', category: 'digest' },
  identify_result: { label: '鉴定结果', category: 'activity' },
  store_visit_thanks: { label: '到访回执', category: 'activity' },
  store_points_granted: { label: '积分入账', category: 'activity' },
  store_points_revoked: { label: '积分调整', category: 'activity' },
  store_receipt_submitted: { label: '小票入册', category: 'activity' },
  store_receipt_approved: { label: '小票入账', category: 'activity' },
  store_receipt_rejected: { label: '小票未过', category: 'activity' },
  platform_order_submitted: { label: '外部入册', category: 'activity' },
  platform_order_approved: { label: '外部入账', category: 'activity' },
  platform_order_rejected: { label: '外部未过', category: 'activity' },
  coupon_exchanged: { label: '礼券入夹', category: 'activity' },
  birthday_gift: { label: '生日心意', category: 'activity' },
  honorary_curator_granted: { label: '荣誉馆长', category: 'activity' },
  live_reminder: { label: '开播提醒', category: 'activity' },
  activity_notice: { label: '馆讯', category: 'activity' },
  system_notice: { label: '馆务', category: 'system' }
};

const ACTION_LABELS = {
  booking: '查看约访',
  order: '打开订单',
  custom: '查看工单',
  activity: '前往相关页',
  system: '前往相关页',
  ops: '去处理',
  other: '前往相关页'
};

const TYPE_ACTION_LABELS = {
  identify_result: '查看报告',
  booking_success: '查看约访',
  booking_reminder: '查看约访',
  booking_changed: '查看约访',
  booking_cancelled: '查看约访',
  custom_inquiry_received: '查看工单',
  custom_inquiry_contacted: '查看工单',
  support_ticket_replied: '阅读回复',
  care_tip: '阅读养护要点',
  birthday_gift: '查看礼券',
  coupon_exchanged: '打开礼券夹',
  live_reminder: '进入直播',
  staff_order_paid: '去处理订单',
  staff_artisan_sku_sold: '去处理订单',
  staff_deposit_paid: '去安排制作',
  staff_deposit_balance_window: '去催尾款',
  staff_deposit_forfeited: '查看定金单',
  staff_deposit_settled: '查看定金单',
  wishlist_restock_request: '去藏品库',
  invoice_request_staff: '去开票台',
  approval_submitted: '去审批',
  approval_approved: '查看审批',
  approval_rejected: '查看审批',
  daily_digest: '查看口径',
  activity_notice: '前往相关页'
};

function getCategoryMeta(category) {
  return CATEGORY_META[category] || CATEGORY_META.other;
}

function getTypeMeta(type) {
  return TYPE_META[type] || null;
}

function formatMessageTime(dateInput) {
  let date = dateInput;
  if (!(date instanceof Date)) {
    try {
      date = dateInput ? new Date(dateInput) : new Date();
    } catch (e) {
      date = new Date();
    }
  }
  if (isNaN(date.getTime())) return '时间未知';

  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 0) return '刚刚';

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`;

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${d} ${h}:${m}`;
}

function resolveActionLabel(message) {
  if (!message || !message.actionUrl) return '';
  if (message.type && TYPE_ACTION_LABELS[message.type]) {
    return TYPE_ACTION_LABELS[message.type];
  }
  return ACTION_LABELS[message.category] || ACTION_LABELS.other;
}

function pickRelatedId(msg) {
  if (!msg) return '';
  return String(
    msg.relatedId || msg.record_id || msg.recordId || msg.orderId || ''
  ).trim();
}

function isInboxSelfUrl(url) {
  const path = String(url || '').split('?')[0].replace(/^\//, '');
  return path === 'subpackages/extra/user/messages/index'
    || path === 'pages/user/messages/index';
}

const FEATURE_LEGACY_PREFIXES = [
  '/pages/community',
  '/pages/custom',
  '/pages/care',
  '/pages/detail',
  '/pages/search',
  '/pages/identify',
  '/pages/collection',
  '/pages/articles'
].sort((a, b) => b.length - a.length);

/**
 * 2026-09-27 包体治理：videos / comment / collection-detail 从 feature 迁到 content。
 * 旧 `/pages/*` 与已发出的 `/subpackages/feature/{videos,comment,collection-detail}/*`
 * 都靠本表 + MOVED_SUBPACKAGE_ALIASES 落到 content。
 */
const CONTENT_LEGACY_PREFIXES = [
  '/pages/collection-detail',
  '/pages/comment',
  '/pages/videos',
  '/pages/user/legal'
].sort((a, b) => b.length - a.length);

/**
 * 个人中心整棵子树（原 `subpackages/feature/user/*`）已于 2026-09-16 迁入
 * `subpackages/extra/user/*`（feature 分包逼近 2M 上限，见包体优化记录）。
 *
 * 旧站内信 / 已发出的订阅消息 / 历史分享里存的仍是 `/pages/user/*`，
 * 它们靠本表重映射到现在的页面。**必须单独一张表**：如果继续留在
 * FEATURE_LEGACY_PREFIXES 里，拼接结果会是已不存在的 `subpackages/feature/user/*`，
 * 用户点通知直接跳空 —— 这类断链静态扫不到（目标是拼出来的，不是字面量），
 * 由 `npm run test:legacy-remap` 兜住。
 */
const EXTRA_LEGACY_PREFIXES = [
  '/pages/user/onboarding',
  '/pages/user/profile',
  '/pages/user/achievements',
  '/pages/user/messages',
  '/pages/user/support',
  '/pages/user/feedback',
  '/pages/user/certificates',
  '/pages/user/invoice-request',
  // 店员工作台整棵子树也迁到了 extra（原 subpackages/manager/staff/*）：
  // 站内信里的 `/pages/staff`、`/pages/staff/field` 等同样要落到 extra。
  '/pages/staff'
].sort((a, b) => b.length - a.length);

/**
 * 店长 / 员工管理页（`/pages/manager`、`/pages/store-points`、`/pages/invoice-requests`）
 * 实际在 `subpackages/manager/*`，**不在 business**。
 *
 * 这四条曾被错放在 BUSINESS_LEGACY_PREFIXES 里，于是拼成
 * `/subpackages/business/staff/index` 这种从不存在的路径 —— 员工点「新单待发」
 * 之类的通知直接跳空。实测由 `npm run test:legacy-remap` 抓出（4 条真实断链）。
 */
const MANAGER_LEGACY_PREFIXES = [
  '/pages/manager',
  '/pages/store-points',
  '/pages/invoice-requests'
].sort((a, b) => b.length - a.length);

/** 业务页迁入 subpackages/business 后的旧 path（站内信 / 分享历史） */
const BUSINESS_LEGACY_PREFIXES = [
  '/pages/my-bookings',
  '/pages/ticket',
  '/pages/orders',
  '/pages/order-detail',
  '/pages/confirm-order',
  '/pages/address',
  '/pages/points',
  '/pages/order-claim',
  '/pages/coupons',
  '/pages/certificate',
  '/pages/framer-recruit',
  '/pages/framer',
  '/pages/about',
  '/pages/ar',
  '/pages/booking',
  '/pages/store',
  '/pages/store-zone'
].sort((a, b) => b.length - a.length);

/**
 * **第二代**遗留路径：**分包内部搬迁**（2026-09-17 `b312a0f`「拆出 extra 分包解决超限」）。
 *
 * 上面四张表只认「主包 → 分包」那一代（`/pages/xxx`）。但页面还搬过**第二次家**：
 *   · `subpackages/feature/user/*` → `subpackages/extra/user/*`（整棵个人中心子树，12 个页根）
 *   · `subpackages/user/*`         → `subpackages/extra/user/*`（更早一代，achievements / certificates）
 *   · `subpackages/manager/*`      → `subpackages/extra/*`（管理侧页，**不是整根搬**，逐页列举）
 * 这些路径**不是拼出来的**（当年是真实存在的字面量），所以静态扫 navigation 调用点扫不到它们，
 * 而它们已经**印在物料上 / 存在已发出的订阅消息与站内信里**，改不掉。
 *
 * 为什么必须有（2026-09-20 真机反馈的**同一类**问题）：
 *   收银台「新用户注册」立牌的小程序码生成于 2026-09-15 15:03，当时注册页
 *   （当天 `b424752` 首次新增）就在 `subpackages/feature/user/onboarding/index`；
 *   09-17 `b312a0f` 把它搬去 `extra/user/onboarding`。于是**印出去的码**今天解析不到页面
 *   → 走 `onPageNotFound` → 旧表无此路径 → 落首页（用户看到的就是「扫码跳到主页」）。
 *
 * 安全性（`npm run test:legacy-remap` 强制）：每条 `from` 都必须是**已不存在的死路径** ——
 *   只要某条 `from` 仍命中 app.json 的注册页，就说明它会改写活路径，守卫直接红。
 * 顺序：按 `from` 长度倒序，保证长前缀（`artisan-commission`）不被短前缀（`artisan`）截胡。
 */
const MOVED_SUBPACKAGE_ALIASES = [
  // ① 个人中心整棵子树（feature/user → extra/user）
  { from: '/subpackages/feature/user', to: '/subpackages/extra/user' },
  // ② 更早一代（subpackages/user → extra/user）
  { from: '/subpackages/user', to: '/subpackages/extra/user' },
  // ③ manager 分包里搬去 extra 的页（manager 分包仍在，还有 19 个页 → 绝不可整根替换）
  { from: '/subpackages/manager/approvals', to: '/subpackages/extra/approvals' },
  { from: '/subpackages/manager/artisan', to: '/subpackages/extra/artisan' },
  { from: '/subpackages/manager/artisan-commission', to: '/subpackages/extra/artisan-commission' },
  { from: '/subpackages/manager/honorary-curators', to: '/subpackages/extra/honorary-curators' },
  { from: '/subpackages/manager/inventory-ops', to: '/subpackages/extra/inventory-ops' },
  { from: '/subpackages/manager/investor', to: '/subpackages/extra/investor' },
  { from: '/subpackages/manager/live/broadcast', to: '/subpackages/extra/live/broadcast' },
  { from: '/subpackages/manager/live/studio', to: '/subpackages/extra/live/studio' },
  { from: '/subpackages/manager/member-crm', to: '/subpackages/extra/member-crm' },
  { from: '/subpackages/manager/member-level-adjust', to: '/subpackages/extra/member-level-adjust' },
  { from: '/subpackages/manager/property-cost', to: '/subpackages/extra/property-cost' },
  { from: '/subpackages/manager/purchase-ops', to: '/subpackages/extra/purchase-ops' },
  { from: '/subpackages/manager/shareholder', to: '/subpackages/extra/shareholder' },
  { from: '/subpackages/manager/shareholder-config', to: '/subpackages/extra/shareholder-config' },
  { from: '/subpackages/manager/shipment-ops', to: '/subpackages/extra/shipment-ops' },
  { from: '/subpackages/manager/staff', to: '/subpackages/extra/staff' },
  { from: '/subpackages/manager/staff-permissions', to: '/subpackages/extra/staff-permissions' },
  // ④ 2026-09-27 主包体积治理：玩法页 → plays；影像/评价/馆藏详情 → content
  { from: '/subpackages/feature/play-qian', to: '/subpackages/plays/play-qian' },
  { from: '/subpackages/feature/play-cookie', to: '/subpackages/plays/play-cookie' },
  { from: '/subpackages/feature/play-zodiac', to: '/subpackages/plays/play-zodiac' },
  { from: '/subpackages/feature/play-mbti', to: '/subpackages/plays/play-mbti' },
  { from: '/subpackages/feature/play-solar', to: '/subpackages/plays/play-solar' },
  { from: '/subpackages/feature/play-coin', to: '/subpackages/plays/play-coin' },
  { from: '/subpackages/feature/videos', to: '/subpackages/content/videos' },
  { from: '/subpackages/feature/comment', to: '/subpackages/content/comment' },
  { from: '/subpackages/feature/collection-detail', to: '/subpackages/content/collection-detail' },
  { from: '/subpackages/extra/feishu-sync', to: '/subpackages/manager/feishu-sync' },
  { from: '/subpackages/extra/user/legal', to: '/subpackages/content/user/legal' },
  { from: '/subpackages/feature/live', to: '/subpackages/content/live' }
].sort((a, b) => b.from.length - a.from.length);

/**
 * 命中「分包内搬迁」别名则返回改写后的路径；未命中返回空串（交由后面的旧表继续处理）。
 * 只做整段前缀替换 + 保留尾段/query，不碰其它任何东西。
 */
function remapMovedSubpackage(url) {
  for (let i = 0; i < MOVED_SUBPACKAGE_ALIASES.length; i++) {
    const alias = MOVED_SUBPACKAGE_ALIASES[i];
    const from = alias.from;
    if (
      url === from
      || url.indexOf(`${from}/`) === 0
      || url.indexOf(`${from}?`) === 0
    ) {
      return alias.to + url.slice(from.length);
    }
  }
  return '';
}

function ensurePageIndex(url) {
  const original = String(url || '');
  if (!original) return original;
  const hashIdx = original.indexOf('#');
  const hash = hashIdx >= 0 ? original.slice(hashIdx) : '';
  const noHash = hashIdx >= 0 ? original.slice(0, hashIdx) : original;
  const qIdx = noHash.indexOf('?');
  const query = qIdx >= 0 ? noHash.slice(qIdx) : '';
  const path = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
  if (!path || path === '/') return original;
  const leading = path.charAt(0) === '/';
  const abs = leading ? path : `/${path}`;
  if (abs.indexOf('/pages/') !== 0 && abs.indexOf('/subpackages/') !== 0) {
    return original;
  }
  if (/\/index$/.test(abs)) return original;
  // app.json 中唯一不以 /index 结尾的页：user/onboarding/done
  if (/\/onboarding\/done$/.test(abs)) {
    return (leading ? abs : abs.slice(1)) + query + hash;
  }
  const withIndex = `${abs}/index`;
  return (leading ? withIndex : withIndex.slice(1)) + query + hash;
}

function remapLegacyPageUrl(raw) {
  const original = String(raw || '');
  if (!original) return original;
  const hadSlash = original.charAt(0) === '/';
  const url = hadSlash ? original : `/${original}`;
  let mapped = url;
  // ② 第二代遗留路径（分包内部搬迁）优先：只可能命中**已死**的 subpackages 前缀，
  //    与下面的「主包 → 分包」四张表互不重叠（那四张表的 from 全是 `/pages/*`）。
  const movedTarget = remapMovedSubpackage(url);
  if (movedTarget) {
    mapped = movedTarget;
  } else if (
    // 标本工坊已升为主包 Tab
    url === '/pages/atelier'
    || url.indexOf('/pages/atelier/') === 0
    || url.indexOf('/pages/atelier?') === 0
    || url === '/subpackages/feature/custom/hub'
    || url.indexOf('/subpackages/feature/custom/hub/') === 0
    || url.indexOf('/subpackages/feature/custom/hub?') === 0
    || url === '/pages/custom/hub'
    || url.indexOf('/pages/custom/hub/') === 0
    || url.indexOf('/pages/custom/hub?') === 0
  ) {
    mapped = '/pages/atelier/index';
  } else if (url.indexOf('/pages/custom/framer-recruit') === 0) {
    mapped = `/subpackages/business/framer-recruit${url.slice('/pages/custom/framer-recruit'.length)}`;
  } else {
    let remapped = false;
    for (let i = 0; i < BUSINESS_LEGACY_PREFIXES.length; i++) {
      const prefix = BUSINESS_LEGACY_PREFIXES[i];
      if (url === prefix || url.indexOf(`${prefix}/`) === 0 || url.indexOf(`${prefix}?`) === 0) {
        mapped = `/subpackages/business${url.slice('/pages'.length)}`;
        remapped = true;
        break;
      }
    }
    if (!remapped) {
      for (let i = 0; i < FEATURE_LEGACY_PREFIXES.length; i++) {
        const prefix = FEATURE_LEGACY_PREFIXES[i];
        if (url === prefix || url.indexOf(`${prefix}/`) === 0 || url.indexOf(`${prefix}?`) === 0) {
          mapped = `/subpackages/feature${url.slice('/pages'.length)}`;
          remapped = true;
          break;
        }
      }
    }
    if (!remapped) {
      for (let i = 0; i < CONTENT_LEGACY_PREFIXES.length; i++) {
        const prefix = CONTENT_LEGACY_PREFIXES[i];
        if (url === prefix || url.indexOf(`${prefix}/`) === 0 || url.indexOf(`${prefix}?`) === 0) {
          mapped = `/subpackages/content${url.slice('/pages'.length)}`;
          remapped = true;
          break;
        }
      }
    }
    if (!remapped) {
      for (let i = 0; i < MANAGER_LEGACY_PREFIXES.length; i++) {
        const prefix = MANAGER_LEGACY_PREFIXES[i];
        if (url === prefix || url.indexOf(`${prefix}/`) === 0 || url.indexOf(`${prefix}?`) === 0) {
          mapped = `/subpackages/manager${url.slice('/pages'.length)}`;
          remapped = true;
          break;
        }
      }
    }
    if (!remapped) {
      for (let i = 0; i < EXTRA_LEGACY_PREFIXES.length; i++) {
        const prefix = EXTRA_LEGACY_PREFIXES[i];
        if (url === prefix || url.indexOf(`${prefix}/`) === 0 || url.indexOf(`${prefix}?`) === 0) {
          mapped = `/subpackages/extra${url.slice('/pages'.length)}`;
          break;
        }
      }
    }
  }
  mapped = ensurePageIndex(mapped);
  return hadSlash ? mapped : mapped.slice(1);
}

function stripLeadingSlash(url) {
  return String(url || '').replace(/^\//, '');
}

/**
 * 有完整 actionUrl 时沿用；否则按类型 + relatedId / record_id 补全。
 * 历史消息常因发送时传入空 actionUrl 而丢掉模板 path。
 */
function inferActionUrl(msg = {}) {
  const existing = normalizeMiniProgramUrl(msg.actionUrl || '');
  if (existing && !isInboxSelfUrl(existing)) {
    return stripLeadingSlash(existing);
  }

  const type = String(msg.type || msg.templateCode || '');
  const id = pickRelatedId(msg);
  const looksIdentify = type === 'identify_result'
    || type.indexOf('identify_') === 0
    || /鉴定/.test(String(msg.title || ''));

  if (looksIdentify) {
    return id ? `subpackages/feature/identify/result/index?record_id=${id}` : '';
  }
  if (type.indexOf('order_') === 0 || type.indexOf('custom_production') === 0) {
    return id ? `subpackages/business/order-detail/index?id=${id}` : '';
  }
  if (type === 'booking_success' || type === 'booking_changed') {
    return id
      ? `subpackages/business/ticket/index?id=${id}`
      : 'subpackages/business/booking/index?tab=3';
  }
  if (type === 'booking_reminder' || type === 'booking_cancelled') {
    return 'subpackages/business/booking/index?tab=3';
  }
  if (type.indexOf('pet_memorial') === 0 || type === 'pet_intake_booked') {
    return id
      ? `subpackages/feature/custom/pet/status/index?id=${id}`
      : 'subpackages/feature/custom/orders/index';
  }
  if (type.indexOf('custom_inquiry') === 0) {
    return 'subpackages/feature/custom/orders/index';
  }
  if (type === 'support_ticket_replied') {
    return 'subpackages/extra/user/support/index';
  }
  if (type === 'support_ticket_received') {
    return '';
  }
  if (type === 'care_tip') {
    const productId = msg.productId || '';
    const category = msg.careCategory || msg.productCategory || '';
    if (id || productId) {
      return `subpackages/feature/care/guide/index?category=${encodeURIComponent(category)}&orderId=${id}&productId=${productId}&from=message`;
    }
    return 'subpackages/feature/care/index';
  }
  if (type === 'store_visit_thanks') {
    return 'subpackages/business/store/index';
  }
  if (type.indexOf('store_points_') === 0) {
    return 'subpackages/business/points/index';
  }
  if (type.indexOf('store_receipt_') === 0) {
    return 'subpackages/business/order-claim/index?mode=receipt';
  }
  if (type.indexOf('platform_order_') === 0) {
    return 'subpackages/business/order-claim/index?mode=order';
  }
  if (type === 'coupon_exchanged' || type === 'birthday_gift') {
    return 'subpackages/business/coupons/index';
  }
  if (type === 'honorary_curator_granted') {
    return 'pages/user/index';
  }
  if (type === 'live_reminder') {
    return id ? `subpackages/feature/live/watch/index?sessionId=${id}` : '';
  }
  if (type.indexOf('invoice_request_') === 0) {
    return '';
  }
  return '';
}

function inferOrderActionUrl(type, relatedId, existing) {
  return inferActionUrl({ type, relatedId, actionUrl: existing });
}

const TAB_PATHS = {
  '/pages/index/index': true,
  '/pages/category/index': true,
  '/pages/atelier/index': true,
  '/pages/cart/index': true,
  '/pages/user/index': true
};

function hasEmptyRequiredId(url) {
  const q = url.split('?')[1] || '';
  if (!q) return false;
  return q.split('&').some((pair) => {
    const eq = pair.indexOf('=');
    const key = eq >= 0 ? pair.slice(0, eq) : pair;
    const val = eq >= 0 ? pair.slice(eq + 1) : '';
    return (key === 'id' || key === 'record_id') && !val;
  });
}

function normalizeMiniProgramUrl(raw) {
  if (!raw) return '';
  let url = String(raw).trim();
  if (!url) return '';
  url = remapLegacyPageUrl(url);
  if (url.charAt(0) !== '/') url = '/' + url;
  url = url.replace(/^\/+/, '/');
  url = ensurePageIndex(url);
  if (hasEmptyRequiredId(url)) return '';
  return url;
}

function openMiniProgramUrl(raw) {
  const url = normalizeMiniProgramUrl(raw);
  if (!url || url === '/') {
    wx.showToast({ title: '链接无效', icon: 'none' });
    return;
  }
  const path = url.split('?')[0];
  const fail = () => wx.showToast({ title: '页面暂不可用', icon: 'none' });
  if (TAB_PATHS[path]) {
    wx.switchTab({ url: path, fail });
    return;
  }
  wx.navigateTo({
    url,
    fail: () => wx.redirectTo({ url, fail })
  });
}

function eventDedupeKey(item) {
  const type = item.type || 'system_notice';
  const relatedId = item.relatedId || item.campaignId || '';
  if (relatedId) return `${type}::${relatedId}`;
  return item.dedupeKey || `${type}::${item.title || ''}::${item._id}`;
}

/**
 * 同一 relatedId + 同类型事件只保留一条；优先带「查看订单」跳转的卡片。
 */
function dedupeInboxMessages(list) {
  if (!Array.isArray(list) || list.length < 2) return list || [];
  const best = new Map();
  const order = [];
  list.forEach((item) => {
    const key = eventDedupeKey(item);
    const prev = best.get(key);
    const curHas = !!(item && item.actionUrl);
    const prevHas = !!(prev && prev.actionUrl);
    if (!prev) {
      best.set(key, item);
      order.push(key);
      return;
    }
    if (!prevHas && curHas) {
      best.set(key, item);
    }
  });
  return order.map((key) => best.get(key));
}

function isCampaignMessage(msg = {}) {
  if (msg.campaignId) return true;
  if (msg.channel === 'inapp_campaign') return true;
  const type = String(msg.type || msg.templateCode || '');
  return type === 'activity_notice' || type === 'live_reminder';
}

function splitParagraphs(content) {
  return String(content || '')
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function makePreview(content, maxLen = 48) {
  const first = splitParagraphs(content)[0] || String(content || '').replace(/\s+/g, ' ').trim();
  if (!first) return '';
  if (first.length <= maxLen) return first;
  return `${first.slice(0, maxLen).replace(/[，。、；,.!\s]+$/, '')}…`;
}

const LETTER_TOKEN_SPECS = [
  // 店长订单备注（发货私信）：整行高亮，必须排在最前，避免被金额/日期等规则切碎
  { type: 'note', pattern: '馆员留言[：:][^\\n]+' },
  { type: 'coupon', pattern: '\\d[\\d,]*(?:\\.\\d+)?\\s*元\\s*(?:代金券|优惠券|礼券)' },
  { type: 'money', pattern: '[¥￥]\\s*\\d[\\d,]*(?:\\.\\d+)?' },
  { type: 'money', pattern: '\\d[\\d,]*(?:\\.\\d+)?\\s*元' },
  { type: 'points', pattern: '\\d[\\d,]*(?:\\.\\d+)?\\s*积分' },
  { type: 'growth', pattern: '\\d[\\d,]*(?:\\.\\d+)?\\s*成长值' },
  { type: 'balance', pattern: '\\d[\\d,]*(?:\\.\\d+)?\\s*分(?!成)' },
  { type: 'name', pattern: '「[^」]{1,16}」' },
  { type: 'name', pattern: '『[^』]{1,16}』' },
  { type: 'name', pattern: '《[^》]{1,16}》' },
  { type: 'date', pattern: '\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}' }
];

function looksLikeName(inner) {
  const s = String(inner || '').replace(/^[「『《"“]+|[」』》"”]+$/g, '').trim();
  if (s.length < 1 || s.length > 16) return false;
  if (/点击|查看|订单|积分|报告|详情|链接/.test(s)) return false;
  return true;
}

function tightenUnit(text) {
  return String(text || '').replace(/\s+/g, '');
}

function collectTokenHits(line) {
  const hits = [];
  LETTER_TOKEN_SPECS.forEach((spec) => {
    const re = new RegExp(spec.pattern, 'g');
    let m = re.exec(line);
    while (m) {
      const raw = m[0];
      if (spec.type === 'name' && !looksLikeName(raw)) {
        m = re.exec(line);
        continue;
      }
      hits.push({
        type: spec.type,
        start: m.index,
        end: m.index + raw.length,
        text: spec.type === 'name' ? raw : tightenUnit(raw)
      });
      m = re.exec(line);
    }
  });

  const ident = /已识别为\s*([「『"“]?)([^」』"”》，。,\s]{1,16})\1?/.exec(line);
  if (ident && ident.index >= 0) {
    const quoted = ident[1];
    const name = ident[2];
    if (!quoted && looksLikeName(name)) {
      const start = ident.index + ident[0].lastIndexOf(name);
      hits.push({
        type: 'name',
        start,
        end: start + name.length,
        text: name
      });
    }
  }

  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const picked = [];
  hits.forEach((hit) => {
    if (picked.some((prev) => hit.start < prev.end && hit.end > prev.start)) return;
    picked.push(hit);
  });
  return picked.sort((a, b) => a.start - b.start);
}

function tokenizeLetterLine(line) {
  const text = String(line || '');
  if (!text) return [];
  const hits = collectTokenHits(text);
  if (!hits.length) {
    return [{ rid: 't0', type: 'text', text }];
  }
  const runs = [];
  let cursor = 0;
  hits.forEach((hit, idx) => {
    if (hit.start > cursor) {
      runs.push({ rid: `t${cursor}`, type: 'text', text: text.slice(cursor, hit.start) });
    }
    runs.push({ rid: `h${hit.start}-${idx}`, type: hit.type, text: hit.text });
    cursor = hit.end;
  });
  if (cursor < text.length) {
    runs.push({ rid: `t${cursor}`, type: 'text', text: text.slice(cursor) });
  }
  return runs;
}

function matchSummaryLine(text) {
  const m = String(text || '').match(/^(当前可用|可用余额|账户余额)\s*(.+)$/);
  if (!m) return null;
  return {
    label: m[1],
    value: tightenUnit(m[2])
  };
}

function parseLetterContent(content) {
  const lines = splitParagraphs(content);
  const bodyBlocks = [];
  const summaries = [];
  (lines.length ? lines : []).forEach((line, i) => {
    const summary = matchSummaryLine(line);
    if (summary) {
      summaries.push({
        id: `s${i}`,
        label: summary.label,
        value: summary.value
      });
      return;
    }
    bodyBlocks.push({
      id: `p${i}`,
      text: line,
      runs: tokenizeLetterLine(line)
    });
  });
  return { bodyBlocks, summaries };
}

function resolveKind(msg, isCampaign) {
  if (isCampaign) {
    return { kind: 'campaign', kindLabel: '馆讯', kindLampClass: 'lamp-info' };
  }
  const queue = String(msg.queue || '');
  const category = msg.category || '';
  // 日报是工作信息里的独立一档（与「待办」「审批」并列），标签不能沿用队列名「工作流」
  if (category === 'digest' || String(msg.type || '') === 'daily_digest') {
    return { kind: 'digest', kindLabel: '日报', kindLampClass: 'lamp-info' };
  }
  if (queue === 'workflow' || category === 'ops') {
    return { kind: 'workflow', kindLabel: '工作流', kindLampClass: 'lamp-forest' };
  }
  if (category === 'system') {
    return { kind: 'notice', kindLabel: '通知', kindLampClass: 'lamp-info hollow' };
  }
  return { kind: 'receipt', kindLabel: '回执', kindLampClass: 'lamp-success' };
}

const STATUS_WARNING_TYPES = {
  order_created: true,
  booking_reminder: true,
  booking_changed: true,
  booking_cancelled: true,
  order_cancelled: true,
  pet_memorial_need_info: true,
  pet_memorial_quoted: true,
  pet_memorial_awaiting_intake: true,
  invoice_request_rejected: true,
  invoice_request_staff: true,
  store_receipt_rejected: true,
  platform_order_rejected: true,
  store_points_revoked: true,
  live_reminder: true,
  care_tip: true,
  support_ticket_replied: true,
  staff_order_paid: true,
  wishlist_restock_request: true,
  approval_submitted: true,
  approval_rejected: true,
  // 这三个属于「需要有人去做事」，必须优先于 /_paid$/ 的「已办妥」判定
  staff_deposit_paid: true,
  staff_deposit_balance_window: true,
  staff_deposit_forfeited: true
};

const STATUS_SUCCESS_TYPES = {
  order_paid: true,
  order_shipped: true,
  order_received: true,
  order_refunded: true,
  booking_success: true,
  booking_verified: true,
  coupon_exchanged: true,
  birthday_gift: true,
  store_points_granted: true,
  store_receipt_approved: true,
  platform_order_approved: true,
  invoice_request_issued: true,
  honorary_curator_granted: true,
  pet_memorial_completed: true,
  pet_memorial_accepted: true,
  store_visit_thanks: true,
  custom_production_shipped: true,
  identify_result: true
};

function resolveStatus(type, hasAction, isCampaign) {
  const t = String(type || '');
  // 日报是定时快照，不是待办：状态必须说「快照」，避免员工以为还要去「处理」
  if (t === 'daily_digest') {
    return { statusTone: 'info', statusLabel: '快照', statusLampClass: 'lamp-info' };
  }
  if (STATUS_WARNING_TYPES[t] || /_rejected$|_cancelled$|_revoked$|need_info/.test(t)) {
    return { statusTone: 'warning', statusLabel: '需处理', statusLampClass: 'lamp-warning' };
  }
  if (STATUS_SUCCESS_TYPES[t] || /_paid$|_granted$|_approved$|_issued$|_completed$|_success$|_verified$/.test(t)) {
    return { statusTone: 'success', statusLabel: '已办妥', statusLampClass: 'lamp-forest' };
  }
  if (isCampaign) {
    return {
      statusTone: 'info',
      statusLabel: hasAction ? '可前往' : '备阅',
      statusLampClass: 'lamp-info'
    };
  }
  return {
    statusTone: 'info',
    statusLabel: hasAction ? '可前往' : '备阅',
    statusLampClass: 'lamp-info'
  };
}

/**
 * 需求 10：信件商品卡。
 * 粒度口径由业务确认为「名称 + 图片 + 规格」（图片缺省时不占位，名称/规格始终显示）。
 * 商品卡是**附件式**展示：正文照旧，卡片补上「买的是什么」，不重复正文句子。
 */
function buildProductCards(raw) {
  const list = Array.isArray(raw) ? raw : []
  return list
    .filter((item) => item && (item.title || item.image))
    .slice(0, 5)
    .map((item, i) => {
      const count = Math.max(1, parseInt(item.count, 10) || 1)
      return {
        id: String(item.id || `pc${i}`),
        title: String(item.title || '藏品'),
        image: String(item.image || ''),
        hasImage: !!item.image,
        skuLabel: String(item.skuLabel || ''),
        hasSku: !!item.skuLabel,
        count,
        countText: count > 1 ? `×${count}` : ''
      }
    })
}

/**
 * 发货包装图片（**可选**）：与云端 `orderSummary.pickPackagePhotos` **同一口径**。
 *
 * 为什么前端也要收敛一遍（而不是直接把 doc.photos 递给 WXML）：
 *   ① 云库文档可能被人工改过 / 是历史版本 —— 直接渲染会出空 src 破图；
 *   ② **存量消息根本没有 photos 键**（需求 4：老订单一切照旧），
 *      这里必须把它与「这次没传图」收敛成同一个结果：**空数组**。
 *   ③ 只收能被 `<image>` 渲染且**换设备仍在**的地址；`wxfile://` / `http://tmp/…`
 *      是选图返回的本机临时路径，落库后别人打开都是破图。
 *
 * 口径必须与 `cloudfunctions/dispatchMessage/orderSummary.js` 的
 * `pickPackagePhotos` 一致（守卫 `check:package-photos` 会真跑两侧比对）。
 */
const MAX_PACKAGE_PHOTOS = 6

function isRenderablePackagePhoto(url) {
  const s = String(url || '').trim()
  if (!s) return false
  if (s.indexOf('cloud://') === 0) return true
  if (s.indexOf('wxfile://') === 0) return false
  if (/^https?:\/\/tmp\//i.test(s)) return false
  return s.indexOf('https://') === 0
}

function normalizePackagePhotos(raw) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (item === null || item === undefined) continue
    const value = typeof item === 'string'
      ? item
      : (typeof item === 'object' ? (item.url || item.fileID || item.src) : '')
    const url = String(value == null ? '' : value).trim().slice(0, 512)
    if (!isRenderablePackagePhoto(url)) continue
    // ⚠️ **必须换成 https**：`<image src="cloud://…">` 在真机上**渲染不出来**（封面全空），
    // 这是本仓已记录的事实（见 utils/imageUrl.js 的 cloudIdToHttps 头注）。
    // 少了这一步 = 字段/接口/守卫全绿、顾客手机上是六个空白方块（最典型的一类假交付）。
    const renderable = cloudFileIdToHttps(url)
    if (!renderable) continue
    if (out.indexOf(renderable) !== -1) continue
    out.push(renderable)
    if (out.length >= MAX_PACKAGE_PHOTOS) break
  }
  return out
}

function enrichMessage(msg) {
  const typeMeta = getTypeMeta(msg.type);
  const category = msg.category || (typeMeta && typeMeta.category) || 'other';
  const categoryMeta = getCategoryMeta(category);
  const relatedId = pickRelatedId(msg);
  const actionUrl = inferActionUrl({ ...msg, relatedId, category });
  const content = msg.content || '';
  const paragraphs = splitParagraphs(content);
  const { bodyBlocks, summaries } = parseLetterContent(content);
  // 需求 10：商品卡（名称 + 图片 + 规格）
  const productCards = buildProductCards(msg.products);
  // 发货包装图片（可选附件）：与商品卡是**两类东西**，独立字段独立渲染。
  // 空数组 = 不渲染任何东西（存量消息 / 本次没传图 走同一条分支）。
  const packagePhotos = normalizePackagePhotos(msg.photos);
  const preview = makePreview(content);
  const isCampaign = isCampaignMessage(msg);
  const isPaper = true;
  const { kind, kindLabel, kindLampClass } = resolveKind({ ...msg, category }, isCampaign);
  const isDigest = kind === 'digest' || String(msg.type || '') === 'daily_digest';
  const stampEn = isDigest
    ? 'DIGEST'
    : (kind === 'campaign'
      ? 'YOU XIN'
      : (kind === 'workflow' ? 'WORKFLOW' : (kind === 'notice' ? 'NOTICE' : 'RECEIPT')));
  const stampCn = isDigest
    ? '日报'
    : (kind === 'campaign'
      ? '馆方'
      : (kind === 'workflow' ? '工作流' : (kind === 'notice' ? '通知' : '回执')));
  // 日报是备阅快照，落款不能写「请处理」（那是待办语义）
  const signOff = isDigest
    ? '备阅'
    : (kind === 'receipt' ? '此据' : (kind === 'workflow' ? '请处理' : '谨启'));
  const needsExpand = paragraphs.length > 8 || String(content).length > 280;
  const isUnread = msg.read !== true;
  const { statusTone, statusLabel, statusLampClass } = resolveStatus(msg.type, !!actionUrl, isCampaign);
  let date;
  try {
    date = msg.createTime ? new Date(msg.createTime) : new Date(msg._createTime || Date.now());
  } catch (e) {
    date = new Date();
  }

  const typeName = typeMeta ? typeMeta.label : (isCampaign ? '馆讯' : categoryMeta.label);

  return {
    ...msg,
    relatedId,
    actionUrl,
    hasAction: !!actionUrl,
    needsExpand,
    paragraphs: (paragraphs.length ? paragraphs : (content ? [content] : [])).map((text, i) => ({
      id: `p${i}`,
      text
    })),
    bodyBlocks,
    summaries,
    productCards,
    hasProductCards: productCards.length > 0,
    // 发货包装图片（可选附件，需求 2/3）：信内直接可见。
    // `hasPackagePhotos` 是**唯一**的渲染开关 —— 老消息没有 photos 键 → 空数组 → false
    // → WXML 整块不出现，与改造前逐字节一致（需求 4）。
    packagePhotos,
    hasPackagePhotos: packagePhotos.length > 0,
    packagePhotoCountText: packagePhotos.length > 1 ? `${packagePhotos.length} 张` : '',
    // 需求 10：列表页用的紧凑摘要（最多 3 张缩略图 + 「首件 等 N 项」）
    productThumbs: productCards.filter((c) => c.hasImage).slice(0, 3).map((c) => ({ id: c.id, image: c.image })),
    productSummary: productCards.length
      ? (productCards.length > 1
          ? `${productCards[0].title} 等 ${productCards.length} 项`
          : productCards[0].title)
      : '',
    preview,
    isCampaign,
    isPaper,
    senderName: '山海造物馆方',
    stampEn,
    stampCn,
    signOff,
    kind,
    kindLabel,
    kindLampClass,
    statusTone,
    statusLabel,
    statusLampClass,
    readLampClass: isUnread ? 'lamp-brass' : 'lamp-brass hollow',
    readLabel: isUnread ? '未读' : '已读',
    categoryName: categoryMeta.label,
    categoryIcon: msg.icon || categoryMeta.icon,
    typeName,
    formattedTime: formatMessageTime(date),
    actionLabel: isDigest
      ? '查看口径'
      : (isCampaign
        ? (actionUrl ? (TYPE_ACTION_LABELS[msg.type] || '前往相关页') : '')
        : resolveActionLabel({ ...msg, actionUrl, category })),
    isUnread,
    isDigest
  };
}

module.exports = {
  CATEGORY_META,
  TYPE_META,
  // 导出内联件：守卫 check:package-photos 要用它跟 utils/imageUrl.cloudIdToHttps 比对同口径
  cloudFileIdToHttps,
  MAX_PACKAGE_PHOTOS,
  normalizePackagePhotos,
  isRenderablePackagePhoto,
  getCategoryMeta,
  getTypeMeta,
  formatMessageTime,
  resolveActionLabel,
  enrichMessage,
  dedupeInboxMessages,
  openMiniProgramUrl,
  normalizeMiniProgramUrl,
  remapLegacyPageUrl,
  inferActionUrl,
  isCampaignMessage
};
