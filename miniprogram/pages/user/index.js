// pages/user/index.js
const app = getApp();
const db = wx.cloud.database();
const { trackBehavior } = require('../../utils/trackBehavior');
const { requestManagerAccess, requestWorkspaceAccess } = require('../../utils/managerAuth');
const { requestStaffOrderSubscribe } = require('../../utils/staffOrderSubscribe');
const { withAppModal } = require('../../utils/appModal');
const {
  workbenchEntries,
  resolveWorkspaceRole,
  isSuperAdminOpenid,
  WORKSPACE_SUPER_ADMIN,
  WORKSPACE_STORE_MANAGER,
  WORKSPACE_STORE_STAFF
} = require('../../utils/workspaceRoles');

/** 与店长台共用：同一订单本地已弹过不重复狂弹 */
const NEW_ORDER_ALERT_SHOWN_KEY = 'manager_new_order_alert_shown_ids';
const STAFF_ORDER_MSG_TYPE = 'staff_order_paid';

const WORKBENCH_TILE_ICONS = {
  super_admin: '/assets/icons/lock.png',
  manager: '/assets/icons/store.png',
  staff: '/assets/icons/checkin.png',
  specimen_artisan: '/assets/icons/care.png',
  live_host: '/assets/icons/video-tab.png',
  investor: '/assets/icons/trend.png',
  shareholder: '/assets/icons/trend.png',
  workflow: '/assets/icons/message.png'
};
const { fetchUserSession, needsOnboarding, ensureOpenId, isLocalLoggedOut, resumeLocalSession } = require('../../utils/userSession');
const { formatBadgeText, getAchievementNewCount, markAchievementsSeen } = require('../../utils/badgeDisplay');
const { INTEREST_OPTIONS, LEVEL_BENEFITS, ZODIAC_OPTIONS } = require('../../utils/profileConstants');
const {
  getInterestTags,
  birthdayCountdown,
  zodiacLabelFromKey,
  formatCompactMoney,
  formatCompactCount,
  formatGrowthDisplay,
  buildLevelBenefitsUI,
  collectCurrentPerkItems,
  getNextLevelBenefit,
  mergeLevelLadderWithDefaults,
  buildGrowthMilestoneHint,
  formatDiscount,
  isPlaceholderLevelName,
  resolveAuthState
} = require('../../utils/profileHelper');
const { fetchMyCoupons } = require('../../utils/couponService');
const { pickAvatarImage, avatarExtFromPath, toastAvatarPickError } = require('../../utils/pickAvatar');
const easterEggHost = require('../../utils/easterEggHost');
const easterEgg = require('../../utils/easterEgg');
const {
  REDEEM_POLL_MS,
  REDEEM_ANIM_MS,
  softVibrate,
  pollMemberPassRedeem,
  shouldAcceptRedeem,
  formatRedeemValueText
} = require('../../utils/passRedeemFeedback');

/**
 * 六档会员卡「标本剪影水印 + 材质」固定映射表。
 * 元素同构预约票 .watermark：大尺寸淡影 emoji（grayscale + 低透明度），
 * 非彩色贴纸、非铜牌角标。档位仅做单色染色（金/银/木褐等）。
 * 材质递进（纸 → 木 → 金属，下一级优于上一级）见 UserVipCard index.wxss：
 *   Lv1 道林纸 · Lv2 云龙纸 · Lv3 胡桃木 · Lv4 紫檀 · Lv5 白银 · Lv6 黄金
 *   Lv99 荣誉馆长独立「黑蟒皮」（深黑鳞纹 + 克制黄铜点缀），不与 Lv6 共用皮肤。
 */
const CARD_SPECIMENS = {
  1: { emoji: '🍀', name: '四叶草', latin: 'Trifolium repens', material: '道林纸' },
  2: { emoji: '🦀', name: '招潮蟹', latin: 'Uca pugilator', material: '云龙纸' },
  3: { emoji: '🐞', name: '瓢虫', latin: 'Coccinella septempunctata', material: '胡桃木' },
  4: { emoji: '🦋', name: '凤蝶', latin: 'Papilio maackii', material: '紫檀' },
  5: { emoji: '🦎', name: '绿鬣蜥', latin: 'Iguana iguana', material: '白银' },
  6: { emoji: '💎', name: '紫晶簇', latin: 'Quartz var. Amethyst', material: '黄金' },
  99: { emoji: '🏵', name: '蔷薇章', latin: 'Rosa gallica', material: '黑蟒皮' }
};

/** 与钱包页 stored_value_wallet_snapshot_v1 同模式：本地快照避免首屏闪默认态 */
const MEMBER_CARD_CACHE_KEY = 'member_vip_card_snapshot_v1';
/** 工作台蓝点 + 跑马灯：stale-while-revalidate，避免从店长台返回后晚跳出 */
const WORKBENCH_BADGE_CACHE_KEY = 'workbench_badge_snapshot_v1';
const WORKBENCH_BADGE_SOFT_TTL_MS = 90 * 1000;
const GUEST_NICK = '未登录用户';
/** 无快照时用黄金结构骨架（Lv6），避免浅色纸卡「未登录」闪屏 */
const PENDING_SKIN_LEVEL = 6;
/** 会员码/礼券码二维码：加载与绘制失败的重试预算；用尽后必须落到可见的 error 态 */
const QR_DRAW_RETRY_MAX = 4;
const QR_DRAW_RETRY_MS = 180;
/** require.async 跨分包加载二维码模块的兜底超时（不回调也要有结论，否则就是空白框） */
const QR_DRAWER_TIMEOUT_MS = 2500;

function currentOpenid() {
  try {
    const a = getApp();
    return (a && a.globalData && a.globalData.openid) || '';
  } catch (e) {
    return '';
  }
}

function emptyWorkbenchBadgeState() {
  return {
    workbenchEntries: [],
    workbenchTiles: [],
    workflowUnreadCount: 0,
    workbenchDigestUnread: 0,
    workbenchOrderUnread: 0,
    workbenchWishlistUnread: 0,
    workbenchApprovalPending: 0,
    workbenchMarqueeShow: false,
    workbenchMarqueeText: '',
    workbenchMarqueeDuration: '12s'
  };
}

function normalizeWorkbenchCounts(raw) {
  return {
    workflow: Math.max(0, Number(raw && raw.workflow) || 0),
    digest: Math.max(0, Number(raw && raw.digest) || 0),
    approval: Math.max(0, Number(raw && raw.approval) || 0),
    order: Math.max(0, Number(raw && raw.order) || 0),
    wishlist: Math.max(0, Number(raw && raw.wishlist) || 0)
  };
}

function buildWorkbenchMarqueeFields(counts = {}) {
  const c = normalizeWorkbenchCounts(counts);
  const parts = [];
  if (c.workflow > 0) parts.push(`${c.workflow} 条工作信息待阅`);
  if (c.order > 0) parts.push(c.order === 1 ? '新订单待发货' : `${c.order} 笔新订单待发货`);
  if (c.approval > 0) parts.push(`${c.approval} 项待审批`);
  if (c.wishlist > 0) parts.push(c.wishlist === 1 ? '心愿补货待处理' : `${c.wishlist} 条心愿补货`);
  const core = parts.join(' · ');
  if (!core) {
    return {
      workbenchMarqueeShow: false,
      workbenchMarqueeText: '',
      workbenchMarqueeDuration: '12s'
    };
  }
  const loopUnit = `${core}　　·　　`;
  const durationSec = Math.max(10, Math.min(32, Math.round(loopUnit.length * 0.42)));
  return {
    workbenchMarqueeShow: true,
    workbenchMarqueeText: loopUnit,
    workbenchMarqueeDuration: `${durationSec}s`
  };
}

function buildWorkbenchTilesFromCounts(entries, counts = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return [];
  const c = normalizeWorkbenchCounts(counts);
  const decorate = (badgeCount) => {
    const n = Math.min(999, Math.max(0, Number(badgeCount) || 0));
    const text = formatBadgeText(n);
    return {
      badgeCount: n,
      badgeText: text,
      badgeWide: text === '99+'
    };
  };
  const managerBadge = Math.min(999, c.approval + c.order);
  const tiles = [
    {
      key: 'workflow',
      kind: 'workflow',
      title: '工作信息',
      en: 'WORKFLOW',
      workspace: '',
      icon: '/assets/icons/message.png',
      ...decorate(c.workflow)
    },
  ];
  /* ⚠️ 2026-09-21 产品负责人：「把日报放在工作信息中，没有必要单独提供一个入口 banner」。
     去掉了工作台上那张独立「日报」瓦片 —— 日报本来就是**工作信息里的一个分类**
     （与待办/审批并列的那一档，见 `WORKFLOW_FILTER_TABS` 的 `digest`），
     工作台再开一个入口是重复入口。可达性不受影响：
       · 工作信息瓦片的角标本来就统计整个 workflow 队列（日报也在里面）；
       · 进去之后「日报」档就在筛选分栏上，历史日报照旧可翻。 */
  list.forEach((e) => {
    let badgeCount = 0;
    if (e.kind === 'super_admin' || e.kind === 'manager') {
      badgeCount = managerBadge;
    } else if (e.kind === 'artisan' || e.key === 'specimen_artisan') {
      badgeCount = c.wishlist;
    }
    tiles.push({
      key: e.key,
      kind: e.kind,
      title: e.title,
      en: e.en,
      workspace: e.workspace || '',
      icon: e.icon || WORKBENCH_TILE_ICONS[e.key] || '/assets/icons/lock.png',
      ...decorate(badgeCount)
    });
  });
  return tiles;
}

function readWorkbenchBadgeCache() {
  try {
    const raw = wx.getStorageSync(WORKBENCH_BADGE_CACHE_KEY);
    if (!raw || typeof raw !== 'object') return null;
    const openid = currentOpenid();
    if (openid && raw.openid && raw.openid !== openid) return null;
    if (!Array.isArray(raw.entries) || !raw.entries.length) return null;
    return raw;
  } catch (e) {
    return null;
  }
}

function persistWorkbenchBadgeCache(counts, entries) {
  try {
    const list = (Array.isArray(entries) ? entries : [])
      .filter((e) => e && e.key)
      .map((e) => ({
        key: e.key,
        kind: e.kind,
        title: e.title,
        en: e.en,
        workspace: e.workspace || '',
        icon: e.icon || WORKBENCH_TILE_ICONS[e.key] || '/assets/icons/lock.png'
      }));
    if (!list.length) return;
    const c = normalizeWorkbenchCounts(counts);
    wx.setStorageSync(WORKBENCH_BADGE_CACHE_KEY, {
      v: 1,
      openid: currentOpenid() || '',
      ts: Date.now(),
      workflow: c.workflow,
      digest: c.digest,
      approval: c.approval,
      order: c.order,
      wishlist: c.wishlist,
      entries: list
    });
  } catch (e) { /* ignore */ }
}

function clearWorkbenchBadgeCache() {
  try {
    wx.removeStorageSync(WORKBENCH_BADGE_CACHE_KEY);
  } catch (e) { /* ignore */ }
}

function snapshotToWorkbenchFields(snap) {
  if (!snap) return emptyWorkbenchBadgeState();
  const counts = normalizeWorkbenchCounts(snap);
  const entries = (Array.isArray(snap.entries) ? snap.entries : []).map((e) => ({
    ...e,
    badgeCount: 0,
    icon: e.icon || WORKBENCH_TILE_ICONS[e.key] || '/assets/icons/lock.png'
  }));
  return {
    workbenchEntries: entries,
    workbenchTiles: buildWorkbenchTilesFromCounts(entries, counts),
    workflowUnreadCount: counts.workflow,
    workbenchDigestUnread: counts.digest,
    workbenchOrderUnread: counts.order,
    workbenchWishlistUnread: counts.wishlist,
    workbenchApprovalPending: counts.approval,
    ...buildWorkbenchMarqueeFields(counts)
  };
}

/** 首屏同步态：有工作台快照则立刻画出跑马灯与瓦片蓝点 */
function buildBootWorkbenchState() {
  if (isLocalLoggedOut()) return emptyWorkbenchBadgeState();
  const snap = readWorkbenchBadgeCache();
  if (!snap) return emptyWorkbenchBadgeState();
  return snapshotToWorkbenchFields(snap);
}

const _bootWorkbench = buildBootWorkbenchState();


function resolveSkinClass(level) {
  const n = Number(level);
  if (n === 99) return 'level-skin-99';
  if (n >= 1 && n <= 6) return `level-skin-${n}`;
  return 'level-skin-1';
}

function specimenFieldsFor(level) {
  const meta = CARD_SPECIMENS[Number(level)] || CARD_SPECIMENS[1];
  return {
    specimenEmoji: meta.emoji,
    specimenName: meta.name,
    specimenLatin: meta.latin,
    specimenMaterial: meta.material
  };
}

function guestMemberCardFields() {
  return {
    cardPending: false,
    /** 需求 20：未注册 / 本机退出 !== Lv1 等级卡，走信封卡（见 UserVipCard） */
    cardGuest: true,
    userInfo: { avatarUrl: '', nickName: GUEST_NICK },
    level: 1,
    cardSkinClass: 'level-skin-1',
    levelName: '原木·见习者',
    memberNo: 'MT-0000-0000',
    discountRate: 1.0,
    discountText: '',
    growthValue: 0,
    growthValueDisplay: '0',
    growthGap: 0,
    growthGapDisplay: '',
    growthIsMax: false,
    growthNextName: '',
    growthGapLine: '',
    growthPerkDelta: '',
    nextThreshold: 500,
    nextThresholdDisplay: '',
    progressWidth: '0%',
    progressPercent: 0,
    profileScore: 0,
    points: 0,
    ...specimenFieldsFor(1)
  };
}

function pendingMemberCardFields() {
  return {
    cardPending: true,
    /** 骨架态不画信封（还不知道是不是未注册），避免闪一下又换成等级卡 */
    cardGuest: false,
    userInfo: { avatarUrl: '', nickName: '' },
    level: PENDING_SKIN_LEVEL,
    cardSkinClass: resolveSkinClass(PENDING_SKIN_LEVEL),
    levelName: '',
    memberNo: '',
    discountRate: 1.0,
    discountText: '',
    growthValue: 0,
    growthValueDisplay: '',
    growthGap: 0,
    growthGapDisplay: '',
    growthIsMax: false,
    growthNextName: '',
    growthGapLine: '',
    growthPerkDelta: '',
    nextThreshold: 0,
    nextThresholdDisplay: '',
    progressWidth: '0%',
    progressPercent: 0,
    profileScore: 100,
    ...specimenFieldsFor(PENDING_SKIN_LEVEL)
  };
}

function readMemberCardCache() {
  try {
    const raw = wx.getStorageSync(MEMBER_CARD_CACHE_KEY);
    if (!raw || typeof raw !== 'object') return null;
    const openid = currentOpenid();
    if (openid && raw.openid && raw.openid !== openid) return null;
    if (!raw.nickName && !raw.cardSkinClass && !raw.level) return null;
    return raw;
  } catch (e) {
    return null;
  }
}

function clearMemberCardCache() {
  try {
    wx.removeStorageSync(MEMBER_CARD_CACHE_KEY);
  } catch (e) { /* ignore */ }
}

function snapshotToPageFields(snap) {
  const level = Number(snap.level) || 1;
  const skin = snap.cardSkinClass || resolveSkinClass(level);
  const specimen = specimenFieldsFor(level);
  return {
    cardPending: false,
    /** 有快照 = 已建立档案（快照只在有正式代号时写入），不是信封态 */
    cardGuest: false,
    isLocalLoggedOut: false,
    userInfo: {
      avatarUrl: snap.avatarUrl || '',
      nickName: snap.nickName || '藏家'
    },
    level,
    cardSkinClass: skin,
    levelName: snap.levelName || '',
    discountRate: snap.discountRate != null ? Number(snap.discountRate) : 1,
    discountText: snap.discountText || '',
    growthValue: Number(snap.growthValue) || 0,
    growthValueDisplay: snap.growthValueDisplay != null ? String(snap.growthValueDisplay) : '0',
    growthGap: Number(snap.growthGap) || 0,
    growthGapDisplay: snap.growthGapDisplay || '',
    growthIsMax: !!snap.growthIsMax,
    growthNextName: snap.growthNextName || '',
    growthGapLine: snap.growthGapLine || '',
    growthPerkDelta: snap.growthPerkDelta || '',
    nextThreshold: Number(snap.nextThreshold) || 0,
    nextThresholdDisplay: snap.nextThresholdDisplay || '',
    progressWidth: snap.progressWidth || '0%',
    progressPercent: Number(snap.progressPercent) || 0,
    memberNo: snap.memberNo || '',
    profileScore: snap.profileScore != null ? Number(snap.profileScore) : 100,
    points: snap.points != null ? Number(snap.points) : 0,
    specimenEmoji: snap.specimenEmoji || specimen.specimenEmoji,
    specimenName: snap.specimenName || specimen.specimenName,
    specimenLatin: snap.specimenLatin || specimen.specimenLatin,
    specimenMaterial: snap.specimenMaterial || specimen.specimenMaterial
  };
}

/** 首屏同步态：已退出→访客卡；有快照→真卡；否则→黄金骨架（不闪未登录纸卡） */
function buildBootMemberCardState() {
  if (isLocalLoggedOut()) {
    return Object.assign({ isLocalLoggedOut: true }, guestMemberCardFields());
  }
  const snap = readMemberCardCache();
  if (snap) return snapshotToPageFields(snap);
  return Object.assign({ isLocalLoggedOut: false }, pendingMemberCardFields());
}

const _bootCard = buildBootMemberCardState();

Page(withAppModal({
  behaviors: [easterEggHost],
  data: {
    // 「藏品订单」数字角标（待付款/待发货/待收货/售后；0 或空则不渲染）
    // 数字来自 getUserStats 的分状态计数，分桶口径与订单页签一致
    orderBadges: { pay: '', paid: '', shipped: '', signed: '', refund: '' },
    // 统一主视觉轻提示（铭牌 + 铜金）——取代原生 toast，见 components/AppToast
    toastShow: false,
    toastOverline: '',
    toastTitle: '',
    toastDesc: '',
    toastDuration: 2200,
    // 微信助手个人名片码（相对长期有效）；替换 assets/qrcode/wechat-assistant-qr.png 即可
    communityQrUrl: '/assets/qrcode/wechat-assistant-qr.png',
    userInfo: _bootCard.userInfo,
    
    // 统计数据
    collectionCount: 0,
    bookingCount: 0,
    certificateCount: 0,
    couponCount: 0, // 🟢 实时代金券数量
    points: _bootCard.points != null ? _bootCard.points : 0, 
    
    // 会员等级（优先本地快照 / 黄金骨架，避免默认浅色未登录卡）
    level: _bootCard.level,
    cardSkinClass: _bootCard.cardSkinClass,
    specimenEmoji: _bootCard.specimenEmoji,
    specimenName: _bootCard.specimenName,
    specimenLatin: _bootCard.specimenLatin,
    specimenMaterial: _bootCard.specimenMaterial,
    levelName: _bootCard.levelName, 
    memberNo: _bootCard.memberNo || 'MT-0000-0000', 
    discountRate: _bootCard.discountRate,
    discountText: _bootCard.discountText, 
    growthValue: _bootCard.growthValue,
    growthValueDisplay: _bootCard.growthValueDisplay,
    growthGap: _bootCard.growthGap || 0,
    growthGapDisplay: _bootCard.growthGapDisplay || '',
    growthIsMax: _bootCard.growthIsMax,
    growthNextName: _bootCard.growthNextName || '',
    growthGapLine: _bootCard.growthGapLine,
    growthPerkDelta: _bootCard.growthPerkDelta,
    nextThreshold: _bootCard.nextThreshold,
    nextThresholdDisplay: _bootCard.nextThresholdDisplay,
    progressWidth: _bootCard.progressWidth,
    progressPercent: _bootCard.progressPercent,
    /** 无快照且可能已登录：黄金骨架中；有快照或已退出则为 false */
    cardPending: !!_bootCard.cardPending,
    /** 需求 20：未注册 / 本机退出 → 信封卡（与 Lv1 等级卡区分） */
    cardGuest: !!_bootCard.cardGuest,
    /** 本机已退出（信封卡文案与未注册不同：重新进入 vs 开启档案） */
    guestLoggedOut: !!_bootCard.isLocalLoggedOut,

    // 状态
    hasCheckedIn: false,
    checkingIn: false, // 🔧 签到加载状态锁，防止重复点击
    isAdmin: false,
    // 后台入口：三级工作台可见性
    staffRole: '',
    workspaceRole: '',
    isStaffOnly: false,
    showManagerEntry: false,
    showStaffEntry: false,
    workbenchEntries: _bootWorkbench.workbenchEntries,
    workbenchTiles: _bootWorkbench.workbenchTiles,
    workflowUnreadCount: _bootWorkbench.workflowUnreadCount,
    workbenchDigestUnread: _bootWorkbench.workbenchDigestUnread,
    workbenchOrderUnread: _bootWorkbench.workbenchOrderUnread,
    workbenchWishlistUnread: _bootWorkbench.workbenchWishlistUnread,
    workbenchApprovalPending: _bootWorkbench.workbenchApprovalPending,
    workbenchMarqueeShow: !!_bootWorkbench.workbenchMarqueeShow,
    workbenchMarqueeText: _bootWorkbench.workbenchMarqueeText || '',
    workbenchMarqueeDuration: _bootWorkbench.workbenchMarqueeDuration || '12s',
    
    // 弹窗
    showQrModal: false,
    passCouponHint: '',
    showGroupModal: false, // 官方社群二维码弹窗
    showStatisticsModal: false, // 数据统计弹窗
    showMyDataModule: false, // 临时隐藏「我的数据」预览面板（业务逻辑保留）
    /** 内容运营开关：山海社区入口；缺配置默认关闭 */
    showUserCommunity: false,
    /** 预约入口（参观/工坊/我的预约合并）；缺配置默认开启 */
    showBookingEntry: true,
    /** 我的钱包入口；缺配置默认关闭（开关字段仍为 showStoredValue） */
    showStoredValue: false,
    /** 礼赠入口；缺配置默认关闭（与商详送礼一致） */
    showGift: false,
    /** 山海图鉴入口（需求 22）；缺配置默认开启（现网已开放） */
    showAtlas: true,
    /** 我的成就入口（需求 23）；缺配置默认开启（现网已开放） */
    showAchievements: true,
    /** 礼赠角标：往来待办 + 近 7 日日子（对齐 manageGift.badgeCount） */
    giftTodoCount: 0,
    /** 往来待办（todo+attention），用于深链 hub=flow */
    giftFlowBadge: 0,
    /** 近 7 日日子数，用于深链 hub=dates */
    giftDateBadge: 0,
    /** AI 标本鉴定入口；缺配置默认开启（现网已开放） */
    showAiIdentify: true,
    /** 这有店入口；缺配置默认开启（现网已有门店） */
    showStore: true,
    showLevelModal: false, // 等级权益弹窗
    
    // 光效
    shineStyle: '',
    
    // 🟢 数据统计
    statistics: {
      viewCount: 0,
      collectCount: 0,
      shareCount: 0,
      searchCount: 0,
      totalConsumption: '0.00',
      orderCount: 0,
      avgOrderValue: '0.00',
      courseCount: 0,
      certificateCount: 0,
      collectionByType: { product: 0, activity: 0, course: 0 },
      lastActiveTime: null
    },
    loadingStatistics: false,
    formattedLastActive: '暂无', // 格式化后的最后活跃时间
    
    // 🟢 等级权益
    levelBenefits: [], // 等级权益列表
    levelLadderSource: [], // 云端/本地 LEVEL_BENEFITS 兼容源（供权益汇总）
    currentLevelIcon: '/assets/icons/knowledge.png', // 当前等级图标（默认）
    
    // 🟢 成就系统
    achievementStats: null, // 成就统计数据
    achievementNewCount: 0, // 较上次进入成就页的新点亮数
    achievementBadgeText: '',
    achievementBadgeWide: false,
    atlasStats: { unlocked: 0, total: 0 },
    
    // 🟢 站内信
    unreadMessageCount: 0, // 未读消息数量
    messageBadgeText: '',
    messageBadgeWide: false,
    couponBadgeText: '',
    couponBadgeWide: false,

    profileScore: _bootCard.profileScore != null ? _bootCard.profileScore : 0,
    onboardingDone: true,
    memberPassToken: '',
    passCountdown: 60,
    qrPayload: '',
    passState: 'loading',
    passErrorMsg: '',
    redeemTitle: '',
    redeemValue: 0,
    redeemValueText: '',
    redeemAnimating: false,
    currentLevelPerkItems: [],

    showOnboardingBanner: false,
    onboardingResumeStep: 1,
    showGiftRepairBanner: false,
    giftRepairing: false,
    /** 本机已退出：展示访客态与「重新进入」入口 */
    isLocalLoggedOut: !!_bootCard.isLocalLoggedOut,
    showLevelUp: false,
    levelUpName: '',
    levelUpLevel: 0,
    currentLevelPerks: [],
    nextLevelPreview: null,

    cardFlipped: false,
    cardBirthday: { hasBirthday: false, headline: '填写生日', subline: '解锁生日礼券与专属祝福' },
    cardInterestTags: [],
    cardPersona: '',
    cardConsumptionDisplay: '¥0',
    cardPointsDisplay: '0',

    showBirthdayCard: false,
    birthdayGiftInfo: null,
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
      this.setData({
        statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20
      });
    }
    // Tab 首屏：再灌一次快照（与 data 启动态对齐；openid 未就绪时仍可用上次快照）
    if (!isLocalLoggedOut()) {
      this.hydrateMemberCardSnapshot();
    }
  },

  onShow() {
    try {
      require('../../utils/museumPageChrome').applyMuseumPageChrome();
    } catch (e) { /* ignore */ }
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 });
    }

    // 角标可能已过期（刚付过款 / 刚签收 / 刚提交售后）→ 轻量刷新
    this.refreshOrderBadges();

    // 券夹「到店亮码」备用通路：带提示打开会员码
    try {
      const pending = wx.getStorageSync('pendingMemberPassHint')
      if (pending && pending.tip) {
        wx.removeStorageSync('pendingMemberPassHint')
        this._passPreferredCouponId = String(pending.couponId || '').trim()
        this.setData({ passCouponHint: String(pending.tip) })
        setTimeout(() => this.showMemberCode({
          couponHint: String(pending.tip),
          couponId: pending.couponId || ''
        }), 120)
      }
    } catch (e) { /* ignore */ }

    const overlayOpen = this.data.showQrModal || this.data.showLevelModal;
    this.setTabBarVisible(!overlayOpen);
    if (this.data.showQrModal) {
      this.boostScreenBrightness();
      // 息屏/切后台后回来：保持弹层，恢复倒计时与核销轮询
      if (this.data.passState !== 'redeemed') {
        this.startPassTimer();
        if (this.data.passState === 'ready' || this.data.passState === 'loading') {
          this.startRedeemPoll();
        }
      }
    } else {
      this.restoreScreenBrightness();
    }

    // 本机退出后必须立刻切访客态，避免 30s 刷新窗口内仍显示旧档案
    if (isLocalLoggedOut()) {
      this.applyLoggedOutState();
      this.loadDisplayFlags();
      this.startMotion();
      trackBehavior('user_center_view', 'user', 'guest');
      return;
    }

    // 同步灌入快照，避免异步 whoami 前闪浅色未登录卡
    this.hydrateMemberCardSnapshot();
    // 工作台跑马灯 / 瓦片蓝点：先缓存占位，再后台刷新（从店长台返回不晚跳出）
    this.hydrateWorkbenchBadgeSnapshot();

    const now = Date.now();
    const forceUser = !!(app.globalData && app.globalData.forceUserRefresh);
    if (forceUser && app.globalData) app.globalData.forceUserRefresh = false;
    const forceWorkbench =
      forceUser ||
      !!(app.globalData && app.globalData.forceWorkbenchBadgeRefresh);
    if (app.globalData && app.globalData.forceWorkbenchBadgeRefresh) {
      app.globalData.forceWorkbenchBadgeRefresh = false;
    }
    const shouldRefresh = forceUser || this._forceRefresh || !this._lastInit || now - this._lastInit > 30000;
    if (shouldRefresh) {
      this._lastInit = now;
      this._forceRefresh = false;
      this.initUserData();
    }
    this.loadUnreadMessageCount();
    this.loadWorkbenchBadges({ force: forceWorkbench });
    this.loadDisplayFlags();
    this.startMotion();
    trackBehavior('user_center_view', 'user', app.globalData.openid || 'guest');
    this.refreshOnboardingBanner();
  },

  async loadDisplayFlags() {
    if (this._displayFlagsLoading) return
    this._displayFlagsLoading = true
    try {
      const { fetchContentDisplayFlags, getCachedContentDisplayFlags } = require('../../utils/contentDisplayFlags');
      const applyFlags = (flags) => {
        const showGift = flags.showGift === true
        this.setData({
          showUserCommunity: flags.showUserCommunity === true,
          showBookingEntry: flags.showBookingEntry !== false,
          showStoredValue: flags.showStoredValue === true,
          showAiIdentify: flags.showAiIdentify !== false,
          // 需求 22/23：缺字段 → 开启；仅显式 false 关闭
          showAtlas: flags.showAtlas !== false,
          showAchievements: flags.showAchievements !== false,
          showStore: flags.showStore !== false,
          showGift,
          giftTodoCount: showGift ? this.data.giftTodoCount : 0,
          giftFlowBadge: showGift ? this.data.giftFlowBadge : 0,
          giftDateBadge: showGift ? this.data.giftDateBadge : 0
        })
        if (showGift) this.loadGiftTodoCount()
      }
      const cached = getCachedContentDisplayFlags();
      if (cached && cached.flags) {
        applyFlags(cached.flags);
      }
      const res = await fetchContentDisplayFlags({
        onUpdate: (payload) => {
          applyFlags((payload && payload.flags) || {});
        }
      });
      applyFlags((res && res.flags) || {});
    } catch (e) {
      console.warn('loadDisplayFlags', e);
      this.setData({
        showUserCommunity: false,
        showBookingEntry: true,
        showStoredValue: false,
        showAiIdentify: true,
        showStore: true,
        showGift: false,
        giftTodoCount: 0,
        giftFlowBadge: 0,
        giftDateBadge: 0
      });
    } finally {
      this._displayFlagsLoading = false;
    }
  },

  async loadGiftTodoCount() {
    if (!this.data.showGift) return
    if (this._giftTodoLoading) return
    if (isLocalLoggedOut()) {
      this.setData({ giftTodoCount: 0, giftFlowBadge: 0, giftDateBadge: 0 })
      return
    }
    this._giftTodoLoading = true
    try {
      // tab 不影响 badge 口径：云端始终汇总送出+收到+近七日日子
      const call = await wx.cloud.callFunction({
        name: 'manageGift',
        data: { action: 'listMine', tab: 'sent', page: 1, pageSize: 1 }
      })
      const result = (call && call.result) || {}
      if (result.success) {
        const todo = Number(result.todoCount) || 0
        const attention = Number(result.attentionCount) || 0
        const upcoming = Number(result.upcomingDateCount) || 0
        const flowBadge = todo + attention
        const badge =
          result.badgeCount != null
            ? Number(result.badgeCount) || 0
            : flowBadge + upcoming
        this.setData({
          giftTodoCount: badge,
          giftFlowBadge: flowBadge,
          giftDateBadge: upcoming
        })
      }
    } catch (e) {
      console.warn('loadGiftTodoCount', e)
    } finally {
      this._giftTodoLoading = false
    }
  },

  async refreshOnboardingBanner() {
    if (this._onboardingChecking) return;
    if (isLocalLoggedOut()) {
      this.setData({
        showOnboardingBanner: false,
        showGiftRepairBanner: false,
        isLocalLoggedOut: true
      });
      return;
    }
    this._onboardingChecking = true;
    try {
      const session = await fetchUserSession(app);
      const needOnboard = needsOnboarding(session);
      const user = session.user || {};
      const needGiftRepair = !!(
        session.success
        && session.onboardingDone
        && user
        && (user.registerGiftClaimed === false || user.registerGiftIncomplete === true)
      );
      this.setData({
        showOnboardingBanner: needOnboard,
        showGiftRepairBanner: !needOnboard && needGiftRepair,
        onboardingResumeStep: (session.user && session.user.onboardingStep) || 1,
        onboardingDone: session.onboardingDone === true,
        isLocalLoggedOut: false
      });
    } catch (e) {
      console.warn('refreshOnboardingBanner', e);
    } finally {
      this._onboardingChecking = false;
    }
  },

  dismissOnboardingBanner() {
    this.setData({ showOnboardingBanner: false });
  },

  dismissGiftRepairBanner() {
    this.setData({ showGiftRepairBanner: false });
  },

  async repairWelcomeGift() {
    if (this.data.giftRepairing || isLocalLoggedOut()) return;
    this.setData({ giftRepairing: true });
    wx.showLoading({ title: '补领中', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'upsertUserProfile',
        data: { patch: {}, repairRegisterGift: true }
      });
      const payload = res.result || {};
      wx.hideLoading();
      if (!payload.success) {
        wx.showToast({ title: payload.msg || '补领失败', icon: 'none' });
        return;
      }
      const gift = payload.registerGift || {};
      const ok = !!(gift.claimed || gift.alreadyGranted) && !gift.error && !gift.partial;
      await this.initUserData();
      this.refreshOnboardingBanner();
      if (ok) {
        this.showAppToast({
          overline: 'GIFT',
          title: '新客礼已放入账户',
          desc: '可在「我的钱包 → 礼券夹」查看'
        });
        this.setData({ showGiftRepairBanner: false });
      } else if (gift.partial) {
        wx.showToast({ title: gift.msg || '礼券仍未齐，请稍后再试', icon: 'none' });
      } else if (gift.disabled) {
        wx.showToast({ title: gift.msg || '礼包暂未开放', icon: 'none' });
        this.setData({ showGiftRepairBanner: false });
      } else {
        wx.showToast({ title: gift.msg || '补领未完成，请稍后再试', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '网络异常', icon: 'none' });
    } finally {
      this.setData({ giftRepairing: false });
    }
  },

  startOnboarding() {
    wx.vibrateShort({ type: 'light' });
    if (isLocalLoggedOut()) {
      this.resumeLogin({ thenOnboarding: true });
      return;
    }
    wx.navigateTo({ url: '/subpackages/extra/user/onboarding/index?from=hub' });
  },

  applyLoggedOutState() {
    if (app.globalData) {
      app.globalData.openid = '';
      app.globalData.userInfo = null;
      app.globalData.userSession = null;
      app.globalData.cartBadgeCount = 0;
    }
    clearMemberCardCache();
    clearWorkbenchBadgeCache();
    this.setData({
      isLocalLoggedOut: true,
      showOnboardingBanner: false,
      ...guestMemberCardFields(),
      /** 信封卡文案分流：本机退出是「重新进入」，未注册是「开启档案」 */
      guestLoggedOut: true,
      isAdmin: false,
      staffRole: '',
      workspaceRole: '',
      isStaffOnly: false,
      showManagerEntry: false,
      showStaffEntry: false,
      ...emptyWorkbenchBadgeState(),
      managerEntryTitle: '店长工作台',
      managerEntryEn: 'MANAGER',
      staffEntryTitle: '店员工作台',
      staffEntryEn: 'STAFF',
      hasCheckedIn: false,
      collectionCount: 0,
      bookingCount: 0,
      certificateCount: 0,
      couponCount: 0,
      couponBadgeText: '',
      couponBadgeWide: false,
      unreadMessageCount: 0,
      messageBadgeText: '',
      messageBadgeWide: false,
      achievementStats: null,
      achievementNewCount: 0,
      achievementBadgeText: '',
      achievementBadgeWide: false,
      onboardingDone: true,
      showGiftRepairBanner: false,
      giftRepairing: false,
      currentLevelPerkItems: [],
      cardFlipped: false,
      cardBirthday: { hasBirthday: false, headline: '填写生日', subline: '解锁生日礼券与专属祝福' },
      cardInterestTags: [],
      cardPersona: '',
      cardConsumptionDisplay: '¥0',
      cardPointsDisplay: '0'
    });
  },

  /** 同步灌入本地会员卡快照；无快照则保持/切到黄金骨架，绝不先画未登录纸卡 */
  hydrateMemberCardSnapshot() {
    if (isLocalLoggedOut()) return false;
    const nick = (this.data.userInfo && this.data.userInfo.nickName) || '';
    // 内存里已是真卡：勿用快照回写，避免回退旧数字
    if (!this.data.cardPending && nick && nick !== GUEST_NICK) {
      return true;
    }
    const snap = readMemberCardCache();
    if (snap) {
      this.setData(snapshotToPageFields(snap));
      return true;
    }
    if (nick === GUEST_NICK || !nick || this.data.cardPending) {
      this.setData(pendingMemberCardFields());
    }
    return false;
  },

  persistMemberCardSnapshot() {
    if (isLocalLoggedOut() || this.data.cardPending) return;
    const user = this.data.userInfo || {};
    const nick = user.nickName || '';
    if (!nick || nick === GUEST_NICK) return;
    try {
      wx.setStorageSync(MEMBER_CARD_CACHE_KEY, {
        v: 1,
        openid: currentOpenid() || '',
        avatarUrl: user.avatarUrl || '',
        nickName: nick,
        level: this.data.level,
        cardSkinClass: this.data.cardSkinClass,
        levelName: this.data.levelName || '',
        discountRate: this.data.discountRate,
        discountText: this.data.discountText || '',
        growthValue: this.data.growthValue,
        growthValueDisplay: this.data.growthValueDisplay || '',
        growthGap: this.data.growthGap,
        growthGapDisplay: this.data.growthGapDisplay || '',
        growthIsMax: !!this.data.growthIsMax,
        growthNextName: this.data.growthNextName || '',
        growthGapLine: this.data.growthGapLine || '',
        growthPerkDelta: this.data.growthPerkDelta || '',
        nextThreshold: this.data.nextThreshold,
        nextThresholdDisplay: this.data.nextThresholdDisplay || '',
        progressWidth: this.data.progressWidth || '0%',
        progressPercent: this.data.progressPercent || 0,
        memberNo: this.data.memberNo || '',
        profileScore: this.data.profileScore,
        points: this.data.points,
        specimenEmoji: this.data.specimenEmoji,
        specimenName: this.data.specimenName,
        specimenLatin: this.data.specimenLatin,
        specimenMaterial: this.data.specimenMaterial,
        ts: Date.now()
      });
    } catch (e) { /* ignore */ }
  },

  /**
   * 统一主视觉轻提示（铭牌 + 铜金 + 衬线标题）—— 取代原生 toast。
   * 原生 toast 是系统样式，出现在博物黑界面里最不像本产品（见 components/AppToast）。
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

  /** 「欢迎回来」：重新进入成功后的道候（原先是原生 toast「已重新进入」） */
  showWelcomeBack(desc) {
    const nick = String((this.data.userInfo && this.data.userInfo.nickName) || this.data.nickName || '').trim()
    this.showAppToast({
      overline: 'WELCOME BACK',
      title: nick ? `欢迎回来，${nick}` : '欢迎回来',
      desc: desc || '账号与礼券已恢复'
    })
  },

  onToastClose() {
    this.setData({ toastShow: false })
  },
  async resumeLogin(options = {}) {
    if (this._resumingLogin) return;
    this._resumingLogin = true;
    wx.showLoading({ title: '进入中', mask: true });
    try {
      resumeLocalSession();
      // 退出后再进：先黄金骨架，避免短暂回闪浅色未登录卡
      this.setData(Object.assign({ isLocalLoggedOut: false }, pendingMemberCardFields()));
      await ensureOpenId(app);
      this._forceRefresh = true;
      await this.initUserData();
      this.refreshOnboardingBanner();
      wx.hideLoading();
      try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* ignore */ }
      if (options.thenOnboarding) {
        wx.navigateTo({ url: '/subpackages/extra/user/onboarding/index?from=hub' });
      } else if (options.thenProfile) {
        wx.navigateTo({
          url: '/subpackages/extra/user/profile/index',
          fail: () => wx.showToast({ title: '无法打开藏家档案', icon: 'none' })
        });
      } else {
        // 用主视觉铭牌提示「欢迎回来」，替代原生 toast（系统样式与博物黑界面脱节）
        this.showWelcomeBack();
      }
    } catch (e) {
      wx.hideLoading();
      console.warn('resumeLogin', e);
      wx.showToast({ title: '进入失败，请重试', icon: 'none' });
    } finally {
      this._resumingLogin = false;
    }
  },

  onResumeLoginTap() {
    wx.vibrateShort({ type: 'light' });
    this.resumeLogin();
  },

  onHide() {
    this.stopMotion();
    // 关键：切后台/息屏会触发 onHide。若此处 closeMemberCode，店员核销成功后顾客永远看不到成功态。
    // 只停定时器；弹层状态与亮度保持，onShow 再恢复轮询。
    this.stopRedeemPoll();
    this.stopPassTimer();
    if (!this.data.showQrModal) {
      this.restoreScreenBrightness();
      this.setTabBarVisible(true);
    }
  },
  onUnload() {
    this.stopMotion();
    this.stopRedeemPoll();
    this.stopPassTimer();
    this.restoreScreenBrightness();
    this.setTabBarVisible(true);
  },
  
  onPullDownRefresh() {
    this._forceRefresh = true;
    this.initUserData().then(() => wx.stopPullDownRefresh());
  },

  // 陀螺仪光效
  startMotion() {
    if (!wx.onDeviceMotionChange || this._motionStarted) return;
    this._motionStarted = true;
    this._motionHandler = (res) => {
      const { beta, gamma } = res;
      let x = gamma;
      let y = beta;
      if (x > 40) x = 40;
      if (x < -40) x = -40;
      if (y > 60) y = 60;
      if (y < 20) y = 20;
      const percentX = 50 + (x / 40) * 60;
      const percentY = 50 + ((y - 40) / 40) * 60;
      this.setData({ shineStyle: `background-position: ${percentX}% ${percentY}%` });
    };
    wx.startDeviceMotionListening({ interval: 'ui' });
    wx.onDeviceMotionChange(this._motionHandler);
  },
  stopMotion() {
    if (this._motionHandler && wx.offDeviceMotionChange) {
      wx.offDeviceMotionChange(this._motionHandler);
    }
    if (wx.stopDeviceMotionListening) wx.stopDeviceMotionListening();
    this._motionStarted = false;
    this._motionHandler = null;
  },

  async initUserData() {
    if (isLocalLoggedOut()) {
      this.applyLoggedOutState();
      return;
    }

    // 🔧 优化：添加重试次数限制，防止无限递归
    if (!this.initRetryCount) {
      this.initRetryCount = 0;
    }
    const MAX_RETRY = 10; // 最多重试10次，共5秒
    
    if (!app.globalData.openid) {
      if (this.initRetryCount >= MAX_RETRY) {
        console.error('获取openid失败，已达到最大重试次数');
        wx.showToast({
          title: '初始化失败，请重新进入',
          icon: 'none',
          duration: 2000
        });
        return;
      }
      this.initRetryCount++;
      setTimeout(() => { 
        if (isLocalLoggedOut()) {
          this.initRetryCount = 0;
          this.applyLoggedOutState();
          return;
        }
        if (app.globalData.openid) {
          this.initRetryCount = 0; // 重置计数器
          this.initUserData();
        } else {
          this.initUserData();
        }
      }, 500); 
      return; 
    }
    
    // 重置计数器
    this.initRetryCount = 0;
    
    const openid = app.globalData.openid;
    if (!openid || typeof openid !== 'string' || openid.length < 8) {
      console.error('openid格式无效:', openid);
      wx.showToast({
        title: '用户信息异常',
        icon: 'none'
      });
      return;
    }

    // 「藏品订单」角标：**必须独立于 stats 的来源**取一次。
    // ⚠️ 踩过的坑：把它挂在 `if (!statsLoaded)` 里那次 getUserStats 上是错的 ——
    //    登录用户的会话（fetchUserSession）通常自带 stats，会走 `if (session.stats)` 分支并
    //    `statsLoaded = true`，那次 getUserStats **根本不会执行**，角标永远拿不到数据。
    //    故这里无条件走轻量通道（action: 'orderCounts'）。
    this.refreshOrderBadges(true);

    // openid 就绪后按账号隔离：快照属他人则切黄金骨架，等会话回填
    try {
      const raw = wx.getStorageSync(MEMBER_CARD_CACHE_KEY);
      if (raw && raw.openid && raw.openid !== openid) {
        if (!this.data.cardPending) this.setData(pendingMemberCardFields());
      } else if (!this.data.cardPending && !readMemberCardCache()) {
        // 无可用快照且当前仍像访客默认态 → 骨架
        const nick = (this.data.userInfo && this.data.userInfo.nickName) || '';
        if (nick === GUEST_NICK) this.setData(pendingMemberCardFields());
      }
    } catch (e) { /* ignore */ }
    
    const shortId = openid.substr(openid.length - 8).toUpperCase();
    this.setData({ memberNo: `MT-${shortId.substr(0,4)}-${shortId.substr(4,4)}` });

    // 1. 会话与用户档案
    let statsLoaded = false;
    try {
      const session = await fetchUserSession(app);
      if (session.success) {
        if (session.memberNo) this.setData({ memberNo: session.memberNo });
        if (session.user) {
          // 需求 20：未完成注册 ≠ 等级卡 → 信封卡。
          // 判定取两侧并集：未绑手机（注册的完成标志，见 onboarding「授权手机号即可完成注册」）
          // 或 resolveAuthState 判为 guest（无有效代号）。
          const sessionAuthState = resolveAuthState(session.user);
          const notRegistered = !session.user.phone || sessionAuthState === 'guest';
          this.setData({
            userInfo: session.user,
            profileScore: session.profileScore || 0,
            onboardingDone: session.onboardingDone === true,
            showGiftRepairBanner: !!(
              session.onboardingDone
              && session.user
              && (
                session.user.registerGiftClaimed === false
                || session.user.registerGiftIncomplete === true
              )
            ),
            cardPending: false,
            cardGuest: notRegistered,
            guestLoggedOut: false
          });
          this.syncCardBackPanel(session.user);
          app.globalData.userInfo = session.user;
        }
        if (session.stats) {
          const data = session.stats;
          const levelIcon = this.getLevelIcon(data.level || 1);
          if (Array.isArray(data.levelLadder) && data.levelLadder.length) {
            this.applyLevelLadder(data.levelLadder);
          }
          this.setData({
            points: data.points || 0,
            level: data.level || 1,
            cardSkinClass: this.resolveCardSkinClass(data.level || 1),
            levelName: this.resolveDisplayLevelName(data.level || 1, data.levelName),
            discountRate: data.discountRate || 1.0,
            discountText: formatDiscount(data.discountRate || 1.0),
            isAdmin: data.isAdmin || false,
            currentLevelIcon: levelIcon,
            cardPending: false,
            ...this.resolveSpecimenFields(data.level || 1),
            ...this.buildStaffEntryFields(data),
            ...this.buildGrowthFields(data)
          });
          this.syncLevelPerks(data.level || 1);
          this.checkLevelUpgrade(data.level || 1);
          this.syncCardBackStats();
          this.persistMemberCardSnapshot();
          this.loadWorkbenchBadges({ force: true });
          statsLoaded = true;
        }
      }
    } catch (e) {
      console.error('fetchUserSession', e);
    }

    if (!statsLoaded) {
      wx.cloud.callFunction({
        name: 'getUserStats',
        success: (res) => {
          if (!res || !res.result) return;
          const data = res.result;
          if (Array.isArray(data.levelLadder) && data.levelLadder.length) {
            this.applyLevelLadder(data.levelLadder);
          }

          this.setData({
            points: data.points || 0,
            level: data.level || 1,
            cardSkinClass: this.resolveCardSkinClass(data.level || 1),
            levelName: this.resolveDisplayLevelName(data.level || 1, data.levelName),
            discountRate: data.discountRate || 1.0,
            discountText: formatDiscount(data.discountRate || 1.0),
            isAdmin: data.isAdmin || false,
            currentLevelIcon: this.getLevelIcon(data.level || 1),
            cardPending: false,
            ...this.resolveSpecimenFields(data.level || 1),
            ...this.buildStaffEntryFields(data),
            ...this.buildGrowthFields(data)
          });
          this.syncLevelPerks(data.level || 1);
          this.checkLevelUpgrade(data.level || 1);
          this.syncCardBackStats();
          this.persistMemberCardSnapshot();
          this.loadWorkbenchBadges({ force: true });
        }
      });
    }

    // 3. 获取基础统计
    this.queryBasicStats();
    
    // 4. 检查今日签到
    this.checkTodaySignStatus();
    
    // 5. 数据统计：面板隐藏时不预拉，打开弹窗时再 loadUserStatistics
    if (this.data.showMyDataModule) {
      this.loadUserStatistics();
    }
    
    // 6. 等级权益：若会话未带回云端 ladder，再用本地常量兜底
    if (!(this.data.levelLadderSource || []).length) {
      const levelBenefits = buildLevelBenefitsUI(LEVEL_BENEFITS);
      this.setData({ levelBenefits, levelLadderSource: LEVEL_BENEFITS });
    }
    this.syncLevelPerks(this.data.level);
    this.checkLevelUpgrade(this.data.level);
    if (!this.data.cardPending) this.persistMemberCardSnapshot();
    
    // 7. 🟢 加载成就数据
    this.loadAchievements();
    this.loadAtlasProgress();

    // 8. 生日礼券：当天自助领取 / 补发
    this.maybeClaimBirthdayGift();
  },

  /**
   * 生日当天检查并发放礼券（同一自然年幂等）。
   * 首次到账弹出生日卡；同年已发过则每天最多提醒一次（本地标记）。
   */
  async maybeClaimBirthdayGift() {
    if (this._birthdayClaiming) return;
    this._birthdayClaiming = true;
    try {
      const res = await wx.cloud.callFunction({
        name: 'claimBirthdayGift',
        data: { action: 'claim' }
      });
      const r = (res && res.result) || {};
      if (!r.success) return;

      if (r.granted) {
        const gift = {
          points: r.points || 200,
          couponCount: r.couponCount || 3,
          couponValue: r.couponValue || 20,
          minSpend: r.minSpend || 100,
          expireDate: r.expireDate || ''
        };
        this.setData({
          showBirthdayCard: true,
          birthdayGiftInfo: gift,
          points: (this.data.points || 0) + (gift.points || 0)
        });
        this.syncCardBackStats();
        this.queryBasicStats();
        trackBehavior('birthday_gift_claimed', 'user', String(r.year || ''));
        return;
      }

      if (r.isBirthdayToday && r.alreadyGranted) {
        const key = `birthday_card_seen_${r.year || new Date().getFullYear()}`;
        const seen = wx.getStorageSync(key);
        const today = new Date().toISOString().slice(0, 10);
        if (seen !== today) {
          wx.setStorageSync(key, today);
          this.setData({
            showBirthdayCard: true,
            birthdayGiftInfo: {
              points: 200,
              couponCount: 3,
              couponValue: 20,
              minSpend: 100,
              expireDate: '',
              alreadyGranted: true
            }
          });
        }
        // 刷新卡背文案
        if (this.data.userInfo && this.data.userInfo.birthday) {
          const card = birthdayCountdown(this.data.userInfo.birthday);
          if (card.isToday) {
            card.subline = '生日礼券已放入账户';
            this.setData({ cardBirthday: card });
          }
        }
      }
    } catch (e) {
      console.warn('maybeClaimBirthdayGift', e);
    } finally {
      this._birthdayClaiming = false;
    }
  },

  closeBirthdayCard() {
    this.setData({ showBirthdayCard: false });
  },

  goBirthdayCoupons() {
    this.setData({ showBirthdayCard: false });
    const { openWalletHub } = require('../../utils/rewardsNav');
    openWalletHub({ tab: 'coupons', couponCount: this.data.couponCount || 1 });
  },

  async queryBasicStats() {
    try {
      const openid = app.globalData.openid;
      if (!openid) return;

      const [bookRes, certRes, couponPack, colRes] = await Promise.all([
        db.collection('bookings').where({ _openid: openid, status: 'confirmed' }).count(),
        db.collection('orders').where({ _openid: openid, status: 'received' }).count(),
        fetchMyCoupons({ usableOnly: true }),
        db.collection('collections').where({ _openid: openid }).count()
      ]);

      this.setData({
        bookingCount: bookRes.total || 0,
        certificateCount: certRes.total || 0,
        couponCount: (couponPack.list || []).length,
        ...this._couponBadgeFields((couponPack.list || []).length),
        collectionCount: colRes.total || 0
      });
    } catch (err) {
      console.error('queryBasicStats失败:', err);
    }
  },

  async checkTodaySignStatus() {
    // 🔧 优化：添加openid校验
    const openid = app.globalData.openid;
    if (!openid) {
      return;
    }
    
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    try {
      const res = await db.collection('point_records').where({
        _openid: openid, 
        action: 'check_in', 
        dateStr: todayStr
      }).count();
      
      // 🔧 优化：添加数据验证
      const hasCheckedIn = (res && res.total > 0) ? true : false;
      this.setData({ hasCheckedIn });
    } catch (e) {
      console.error('checkTodaySignStatus失败:', e);
      // 🔧 优化：出错时默认未签到
      this.setData({ hasCheckedIn: false });
    }
  },

  buildGrowthFields(data) {
    const nextThreshold = data.nextThreshold || 0;
    const growthValue = data.growthValue || 0;
    let widthStr = '0%';
    let progressPercent = 0;
    if (nextThreshold > 0) {
      const percent = Math.min((growthValue / nextThreshold) * 100, 100);
      widthStr = `${Math.max(0, percent).toFixed(1)}%`;
      progressPercent = Math.floor(Math.max(0, percent));
    }
    return {
      growthValue,
      nextThreshold,
      progressWidth: widthStr,
      progressPercent,
      growthValueDisplay: formatGrowthDisplay(growthValue),
      nextThresholdDisplay: nextThreshold > 0 ? formatGrowthDisplay(nextThreshold) : '',
      growthGap: nextThreshold > 0 ? Math.max(0, nextThreshold - growthValue) : 0,
      growthGapDisplay: nextThreshold > 0
        ? formatGrowthDisplay(Math.max(0, nextThreshold - growthValue))
        : ''
    };
  },

  syncCardBackPanel(user) {
    if (!user) return;
    const personaParts = [];
    if (user.mbti) personaParts.push(user.mbti);
    const zodiacLabel = zodiacLabelFromKey(user.zodiac, ZODIAC_OPTIONS);
    if (zodiacLabel) personaParts.push(zodiacLabel);
    this.setData({
      cardBirthday: birthdayCountdown(user.birthday),
      cardInterestTags: getInterestTags(user.interests, INTEREST_OPTIONS),
      cardPersona: personaParts.join(' · '),
      cardConsumptionDisplay: formatCompactMoney(this.data.statistics.totalConsumption),
      cardPointsDisplay: formatCompactCount(this.data.points)
    });
  },

  syncCardBackStats() {
    this.setData({
      cardConsumptionDisplay: formatCompactMoney(this.data.statistics.totalConsumption),
      cardPointsDisplay: formatCompactCount(this.data.points)
    });
  },

  onVipCardEasterEgg(e) {
    const eggId = (e.detail && e.detail.eggId) || '';
    this.onEasterEggLongPress({ currentTarget: { dataset: { eggId } } });
  },

  toggleCardFlip() {
    if (easterEgg.shouldIgnoreTap(this)) return;
    const next = !this.data.cardFlipped;
    wx.vibrateShort({ type: 'light' });
    this.setData({ cardFlipped: next });
    trackBehavior('member_card_flip', 'side', next ? 'back' : 'front');
  },

  goToProfileFromCardBack() {
    wx.vibrateShort({ type: 'light' });
    if (isLocalLoggedOut()) {
      this.resumeLogin({ thenProfile: true });
      return;
    }
    wx.navigateTo({
      url: '/subpackages/extra/user/profile/index',
      fail: () => wx.showToast({ title: '无法打开藏家档案', icon: 'none' })
    });
  },

  /**
   * 需求 20：信封卡主 CTA —— 未注册 → 注册引导（领新客礼）；
   * 本机已退出 → 重新进入（恢复会话后可继续建档）。
   */
  onGuestCardCta() {
    if (isLocalLoggedOut()) {
      this.onResumeLoginTap();
      return;
    }
    this.startOnboarding();
  },

  /**
   * 「藏品订单」数字角标：把云端的**分状态计数**转成角标文案。
   *
   * 口径说明（与订单页签一致，别在这里另立一套）：
   *   · 待付款 / 待发货 / 待收货 / 售后 —— 只在这四格上显示（都是"要你去处理"的状态）
   *   · 已签收是终态，累计数会一直是正数 → **不显示角标**（否则 我的 页常年挂一个数字）
   *   · 0 / 空不渲染、>99 显示 99+（沿用 badgeDisplay 的规范）
   */
  applyOrderBadges(counts) {
    const src = counts && typeof counts === 'object' ? counts : {}
    const pick = (k) => formatBadgeText(src[k])
    this.setData({
      orderBadges: {
        pay: pick('pay'),
        paid: pick('paid'),
        shipped: pick('shipped'),
        signed: '', // 终态不显示（见上方说明）
        refund: pick('refund')
      }
    })
  },

  /**
   * onShow 轻量刷新角标：切回本 Tab 时可能刚付过款/刚签收，不刷新会显示过期数字。
   * 走 `action: 'orderCounts'` 专用通道（只做 10 个 count，不跑花销/等级聚合）。
   */
  refreshOrderBadges(force) {
    if (!force && !this._orderBadgesLoaded) return
    const now = Date.now()
    if (!force && now - (this._orderBadgesAt || 0) < 5000) return // 5s 内不重复打
    this._orderBadgesAt = now
    this._orderBadgesLoaded = true
    wx.cloud.callFunction({
      name: 'getUserStats',
      data: { action: 'orderCounts' },
      success: (res) => {
        const r = (res && res.result) || {}
        if (r.success && r.orderStatusCounts) this.applyOrderBadges(r.orderStatusCounts)
      },
      fail: (err) => console.warn('refreshOrderBadges', err && (err.errMsg || err))
    })
  },

  applyLevelLadder(ladder) {
    if (!Array.isArray(ladder) || !ladder.length) return null;
    const merged = mergeLevelLadderWithDefaults(ladder, LEVEL_BENEFITS);
    const levelBenefits = buildLevelBenefitsUI(merged);
    // 同步写入，供紧随其后的 syncLevelPerks 立刻读到合并名
    this.data.levelLadderSource = merged;
    this.data.levelBenefits = levelBenefits;
    this.setData({ levelLadderSource: merged, levelBenefits });
    return merged;
  },

  /**
   * 会员卡皮肤 class：完整字符串绑定（level-skin-N）。
   * 必须整串下发，不要拆成 `level-skin-{{level}}` 拼接——微信端会出现皮肤不生效。
   * 六档自测走下面的 previewLevel()，比手改 AppData 更完整（同时刷新标本元素与材质）。
   */
  resolveCardSkinClass(level) {
    return resolveSkinClass(level);
  },

  /**
   * 开发者工具自测六档：在 Console 里执行
   *   getCurrentPages().find(p => p.route.indexOf('pages/user') === 0).previewLevel(5)
   * 会同时切换皮肤 class、标本元素、材质、动效与等级名（不写库，重进页面即恢复真实等级）。
   */
  previewLevel(level) {
    const n = Number(level) || 1;
    const levelName = this.resolveDisplayLevelName(n, '');
    this.setData({
      level: n,
      cardSkinClass: this.resolveCardSkinClass(n),
      levelName,
      currentLevelIcon: this.getLevelIcon(n),
      cardPending: false,
      ...this.resolveSpecimenFields(n)
    });
    this.syncLevelPerks(n);
    return `已预览 Lv${n} · ${levelName}`;
  },

  /** 当前档标本元素文案（背板铭牌用），与 wxss 里的 .level-skin-N 视觉一一对应 */
  resolveSpecimenFields(level) {
    return specimenFieldsFor(level);
  },

  /** 当前档正式名：云端占位名时用 ladder / 本地常量兜底 */
  resolveDisplayLevelName(level, fallbackName) {
    const n = Number(level) || 1;
    if (fallbackName && !isPlaceholderLevelName(fallbackName, n)) {
      return String(fallbackName).trim();
    }
    const fromLadder = (this.data.levelBenefits || []).find((b) => b.level === n);
    if (fromLadder && fromLadder.name && !isPlaceholderLevelName(fromLadder.name, n)) {
      return fromLadder.name;
    }
    const fromDefault = LEVEL_BENEFITS.find((b) => b.level === n);
    if (fromDefault && fromDefault.name) return fromDefault.name;
    return (fallbackName && String(fallbackName).trim()) || '原木·见习者';
  },

  syncLevelPerks(level) {
    const source = (this.data.levelLadderSource && this.data.levelLadderSource.length)
      ? this.data.levelLadderSource
      : LEVEL_BENEFITS;
    const list = this.data.levelBenefits.length
      ? this.data.levelBenefits
      : buildLevelBenefitsUI(source);
    const perkItems = collectCurrentPerkItems(source, level);
    const nextLevelPreview = getNextLevelBenefit(list, level);
    const milestone = buildGrowthMilestoneHint({
      level,
      discountRate: this.data.discountRate,
      discountText: this.data.discountText,
      nextThreshold: this.data.nextThreshold,
      growthGapDisplay: this.data.growthGapDisplay,
      nextPreview: nextLevelPreview
    });
    this.setData({
      currentLevelPerks: perkItems.map((item) => item.label || item.title),
      currentLevelPerkItems: perkItems,
      nextLevelPreview,
      ...milestone
    });
  },

  checkLevelUpgrade(newLevel) {
    const openid = app.globalData.openid;
    if (!openid || !newLevel) return;
    const key = `member_last_level_${openid.slice(-8)}`;
    const lastLevel = wx.getStorageSync(key);
    if (lastLevel && newLevel > lastLevel) {
      const benefit = (this.data.levelBenefits || []).find((b) => b.level === newLevel);
      this.setData({
        showLevelUp: true,
        levelUpName: benefit ? benefit.name : `Lv${newLevel}`,
        levelUpLevel: newLevel
      });
      wx.vibrateShort({ type: 'heavy' });
      trackBehavior('level_up', 'level', String(newLevel));
    }
    wx.setStorageSync(key, newLevel);
  },

  closeLevelUp() {
    this.setData({ showLevelUp: false });
  },

  // 🟢 签到逻辑
  async doCheckIn() {
    if (isLocalLoggedOut()) {
      this.modal({
        title: '先重新进入',
        overline: 'RE-ENTER',
        content: '退出登录后需重新进入，方可签到领取积分。',
        confirmText: '重新进入',
        cancelText: '稍后'
      }).then((res) => {
        if (res.confirm) this.resumeLogin();
      });
      return;
    }
    if (!this.data.onboardingDone) {
      this.modal({
        title: '领取新客礼包',
        overline: 'WELCOME GIFT',
        content: '授权手机号即可完成注册并签到领积分。',
        confirmText: '去领取',
        cancelText: '稍后'
      }).then((res) => {
        if (res.confirm) this.startOnboarding();
      });
      return;
    }
    // 🔧 优化：添加防重复点击
    if (this.data.hasCheckedIn) {
      wx.showToast({ title: '今日已签到', icon: 'none' });
      return;
    }
    if (this.data.checkingIn) {
      return;
    }
    
    wx.vibrateShort({ type: 'medium' });
    this.setData({ checkingIn: true }); // 设置加载状态锁
    wx.showLoading({ title: '签到中…', mask: true });

    wx.cloud.callFunction({
      name: 'earnPoints', 
      data: { action: 'check_in' },
      success: res => {
        wx.hideLoading();
        this.setData({ checkingIn: false }); // 释放锁
        
        // 🔧 优化：添加数据验证
        if (res && res.result && res.result.success) {
          const points = res.result.points || 0;
          this.setData({ hasCheckedIn: true });
          this.initUserData(); // 刷新积分
          wx.showToast({ 
            title: `+${points} 积分`, 
            icon: 'success',
            duration: 2000
          });
        } else {
          const msg = (res && res.result && res.result.msg) ? res.result.msg : '签到失败';
          this.setData({ hasCheckedIn: true }); // 可能已签过
          wx.showToast({ 
            title: msg, 
            icon: 'none',
            duration: 2000
          });
        }
      },
      fail: (err) => { 
        wx.hideLoading(); 
        this.setData({ checkingIn: false }); // 释放锁
        console.error('签到云函数调用失败:', err);
        wx.showToast({ 
          title: '网络异常，请稍后重试', 
          icon: 'none',
          duration: 2000
        }); 
      }
    });
  },

  // 菜单跳转逻辑
  handleMenuClick(e) {
    const path = e.currentTarget.dataset.path;
    wx.vibrateShort({ type: 'light' });
    const go = (url) => wx.navigateTo({
      url,
      fail: (err) => {
        console.error('[user-menu] navigateTo failed', url, err);
        wx.showToast({ title: '页面暂不可用', icon: 'none' });
      }
    });

    switch (path) {
      case 'points':
        go('/subpackages/business/points/index');
        break;
      case 'storedValue':
        go('/subpackages/extra/user/stored-value/index');
        break;
      case 'rewards': {
        // 旧「积分与券」入口 → 钱包枢纽（有券优先券夹）
        const { openWalletHub } = require('../../utils/rewardsNav');
        openWalletHub({ couponCount: this.data.couponCount || 0 });
        break;
      }
      case 'orderClaim':
        go('/subpackages/business/order-claim/index');
        break;
      case 'profile':
        // 需求 21：卡片异常时的兜底入口（此前「我的」页无独立档案入口）
        this.goToProfile();
        break;
      case 'booking': // 旧「我的预约」别名 → 合并预约页
      case 'visitBooking': {
        const { getPreferredStoreId } = require('../../utils/storeHelper');
        const storeId = getPreferredStoreId();
        go(`/subpackages/business/booking/index?storeId=${storeId}&tab=0&from=user`);
        break;
      }
      case 'courseBooking': {
        const { getWorkshopStore } = require('../../utils/storeHelper');
        const workshop = getWorkshopStore();
        if (!workshop || !workshop.storeId) {
          wx.showToast({ title: '工坊门店未配置', icon: 'none' });
          break;
        }
        go(`/subpackages/business/booking/index?storeId=${workshop.storeId}&tab=1&from=user`);
        break;
      }
      case 'certificate':
        go('/subpackages/extra/user/certificates/index');
        break;
      case 'orders':
        go('/subpackages/business/orders/index');
        break;
      case 'address':
        go('/subpackages/business/address/index');
        break;
      case 'admin':
        requestManagerAccess();
        break;
      case 'about':
        go('/subpackages/business/about/index');
        break;
      case 'feedback':
        go('/subpackages/extra/user/feedback/index');
        break;
      case 'coupons':
        go('/subpackages/business/coupons/index');
        break;
      case 'myGifts': {
        // 角标驱动深链：有往来待办进往来；仅日子提醒进日子；否则默认往来
        const flow = Number(this.data.giftFlowBadge) || 0
        const dates = Number(this.data.giftDateBadge) || 0
        let q = ''
        if (flow > 0) q = '?hub=flow'
        else if (dates > 0) q = '?hub=dates'
        go(`/subpackages/feature/gift/my-gifts/index${q}`)
        break
      }
      case 'group':
        wx.vibrateShort({ type: 'medium' });
        this.setData({ showGroupModal: true });
        break;
      case 'statistics':
        this.showStatistics();
        break;
      case 'identify':
        go('/subpackages/feature/identify/index');
        break;
      case 'collection':
        // 需求 22：开关关闭时不放行（UI 已隐藏，此处兜底，避免深链/旧缓存进入）
        if (this.data.showAtlas === false) {
          wx.showToast({ title: '山海图鉴暂未开放', icon: 'none' });
          return;
        }
        go('/subpackages/feature/collection/index');
        break;
      case 'wishlist':
        go('/subpackages/extra/user/wishlist/index');
        break;
      case 'contact': /* wxml中已通过 button open-type 实现 */ break;
      default:
        wx.showToast({ title: '入口即将开放', icon: 'none' });
        break;
    }
  },

  // 列表跳转
  goToOrderList(e) {
    const type = e.currentTarget.dataset.type || 'all';
    wx.navigateTo({
      url: `/subpackages/business/orders/index?type=${type}`,
      fail: () => wx.showToast({ title: '无法打开订单', icon: 'none' })
    });
  },

  setTabBarVisible(visible) {
    try {
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        this.getTabBar().setData({ hidden: !visible });
      }
    } catch (e) { /* ignore */ }
  },

  clampBrightness(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > 1) return null;
    return n;
  },

  boostScreenBrightness() {
    const token = (this._brightnessToken || 0) + 1;
    this._brightnessToken = token;
    this._brightnessBoosted = true;
    wx.getScreenBrightness({
      success: (res) => {
        if (this._brightnessToken !== token) return;
        const saved = this.clampBrightness(res && res.value);
        if (saved != null) this._savedBrightness = saved;
        wx.setScreenBrightness({ value: 1, fail: () => {} });
      },
      fail: () => {
        if (this._brightnessToken !== token) return;
        wx.setScreenBrightness({ value: 1, fail: () => {} });
      }
    });
  },

  restoreScreenBrightness() {
    this._brightnessToken = (this._brightnessToken || 0) + 1;
    const boosted = this._brightnessBoosted;
    const saved = this._savedBrightness;
    this._brightnessBoosted = false;
    this._savedBrightness = null;
    if (!boosted) return;
    const value = this.clampBrightness(saved);
    if (value == null) return;
    wx.setScreenBrightness({ value, fail: () => {} });
  },

  /** 新开亮码会话：清掉上次 redeemed / 旧 token，避免再开立刻命中历史核销 */
  beginPassSession(options = {}) {
    this.stopPassTimer();
    this.stopRedeemPoll();
    this._passSession = (this._passSession || 0) + 1;
    this._acceptRedeem = false;
    this._passWatchArmed = false;
    this._passPreferredCouponId = String(
      (options && options.couponId) || ''
    ).trim();
    this._passToken = '';
    this._passRefreshing = false;
    return this._passSession;
  },

  async showMemberCode(options) {
    softVibrate('medium');
    if (isLocalLoggedOut()) {
      this.modal({
        title: '先重新进入',
        overline: 'RE-ENTER',
        content: '退出登录后需重新进入，方可出示会员码。',
        confirmText: '重新进入',
        cancelText: '稍后'
      }).then((res) => {
        if (res.confirm) this.resumeLogin();
      });
      return;
    }
    const openid = await ensureOpenId(app);
    if (!openid) {
      wx.showToast({ title: '请先登录后再出示会员码', icon: 'none' });
      return;
    }
    this.syncLevelPerks(this.data.level);
    trackBehavior('member_code_show', 'user', openid || 'guest');
    this.beginPassSession(options || {});
    this.setData({
      showQrModal: true,
      passCountdown: 60,
      passState: 'loading',
      passErrorMsg: '',
      memberPassToken: '',
      qrPayload: '',
      redeemTitle: '',
      redeemValue: 0,
      redeemValueText: '',
      redeemAnimating: false,
      passCouponHint: (options && options.couponHint) || ''
    });
    this.setTabBarVisible(false);
    this.boostScreenBrightness();
    this.refreshMemberPass();
    this.startPassTimer();
    // 等本会话发码成功后再启轮询，禁止用上次已核销 token 立刻打成功态
  },

  startPassTimer() {
    this.stopPassTimer();
    this._passTimer = setInterval(() => {
      if (!this.data.showQrModal || this.data.passState === 'redeemed') {
        this.stopPassTimer();
        return;
      }
      if (this._passRefreshing) return;
      const next = (this.data.passCountdown || 0) - 1;
      if (next <= 0) {
        // 倒计时归零：信号灯转灰，触发刷新（与 TTL 节奏对齐）
        this.setData({ passCountdown: 0 });
        this.refreshMemberPass();
      } else {
        this.setData({ passCountdown: next });
      }
    }, 1000);
  },

  stopPassTimer() {
    if (this._passTimer) {
      clearInterval(this._passTimer);
      this._passTimer = null;
    }
    this._passRefreshing = false;
  },

  startRedeemPoll() {
    this.stopRedeemPoll();
    if (!this._acceptRedeem) return;
    const preferredCouponId = String(this._passPreferredCouponId || '').trim();
    const token = String(this._passToken || this.data.memberPassToken || '').trim();
    if (!preferredCouponId && !token) return;
    this._redeemPollTimer = setInterval(() => {
      this.pollRedeemStatus();
    }, REDEEM_POLL_MS);
    this.pollRedeemStatus();
  },

  stopRedeemPoll() {
    if (this._redeemPollTimer) {
      clearInterval(this._redeemPollTimer);
      this._redeemPollTimer = null;
    }
    this._redeemPolling = false;
  },

  /**
   * 发码成功后启用核销监听（每会话仅一次基线）。
   * 若打开时券/token 已是历史核销，不弹成功态，只展示新码。
   */
  async armRedeemWatch(session) {
    if (session !== this._passSession) return;
    if (this._passWatchArmed) {
      this._acceptRedeem = true;
      if (!this._redeemPollTimer) this.startRedeemPoll();
      return;
    }
    this._passWatchArmed = true;
    if (!this.data.showQrModal || this.data.passState === 'redeemed') return;
    const preferredCouponId = String(this._passPreferredCouponId || '').trim();
    const token = String(this._passToken || this.data.memberPassToken || '').trim();
    if (preferredCouponId || token) {
      try {
        const baseline = await pollMemberPassRedeem({ preferredCouponId, token });
        if (session !== this._passSession) return;
        if (shouldAcceptRedeem(baseline, { preferredCouponId })) {
          // 历史已核销：取消盯旧券，避免再开立刻成功动画
          this._passPreferredCouponId = '';
        }
      } catch (e) { /* ignore */ }
    }
    if (session !== this._passSession) return;
    if (!this.data.showQrModal || this.data.passState === 'redeemed') return;
    this._acceptRedeem = true;
    if (!this._redeemPollTimer) this.startRedeemPoll();
  },

  async pollRedeemStatus() {
    if (this._redeemPolling) return;
    if (!this._acceptRedeem) return;
    if (!this.data.showQrModal || this.data.passState === 'redeemed') return;
    const session = this._passSession;
    const preferredCouponId = String(this._passPreferredCouponId || '').trim();
    const token = String(this._passToken || this.data.memberPassToken || '').trim();
    if (!preferredCouponId && !token) return;

    this._redeemPolling = true;
    try {
      const payload = await pollMemberPassRedeem({ preferredCouponId, token });
      if (session !== this._passSession || !this._acceptRedeem) return;
      if (!this.data.showQrModal || this.data.passState === 'redeemed') return;
      if (shouldAcceptRedeem(payload, { preferredCouponId })) {
        this.onPassRedeemed(payload);
      }
    } catch (e) {
      // 轮询失败静默，下轮再试
    } finally {
      this._redeemPolling = false;
    }
  },

  onPassRedeemed(payload) {
    if (this.data.passState === 'redeemed') return;
    this._acceptRedeem = false;
    this.stopRedeemPoll();
    this.stopPassTimer();

    const title = (payload && payload.title) || '门店礼券';
    const value = Number((payload && payload.value) != null ? payload.value : 0) || 0;
    const redeemValueText = formatRedeemValueText(value);

    softVibrate('medium');
    this.setData({
      passState: 'redeemed',
      passCountdown: 0,
      passCouponHint: '',
      redeemTitle: title,
      redeemValue: value,
      redeemValueText,
      redeemAnimating: true
    });
    try {
      wx.showToast({ title: '核销成功', icon: 'success', duration: 1800 });
    } catch (e) { /* ignore */ }

    // 与券夹一致：动画结束后保持结果卡，不自动关弹层
    setTimeout(() => {
      if (!this.data.showQrModal) return;
      this.setData({ redeemAnimating: false });
    }, REDEEM_ANIM_MS);
  },

  /**
   * 加载二维码绘制器：主包 → business 分包，**必须**用 require.async（分包异步化）。
   *
   * 2026-09-18（礼券夹亮码真机空白事故）：这类「异步加载 + 失败只重试不置错」的写法
   * 会让二维码区永远空白且毫无提示。这里做三件事：
   *   ① 两种 API 形态都兼容（返回 thenable / 第二参回调），不赌平台的返回值约定；
   *   ② 加载失败或超时都 reject → 调用方落到可见的 error 态；
   *   ③ 失败不缓存，下次亮码还能再试。
   */
  loadQrDrawer() {
    if (this._qrDrawerPromise) return this._qrDrawerPromise;
    this._qrDrawerPromise = new Promise((resolve, reject) => {
      let done = false;
      let timer = null;
      const fail = (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e || new Error('qrCanvas 加载失败'));
      };
      const succeed = (mod) => {
        if (done) return;
        if (mod && typeof mod.drawMemberQr === 'function') {
          done = true;
          clearTimeout(timer);
          this._drawMemberQr = mod.drawMemberQr;
          resolve(mod.drawMemberQr);
        } else {
          fail(new Error('qrCanvas 未导出 drawMemberQr'));
        }
      };
      timer = setTimeout(() => fail(new Error('qrCanvas 加载超时')), QR_DRAWER_TIMEOUT_MS);
      try {
        const ret = require.async('../../subpackages/business/utils/qrCanvas.js', succeed);
        if (ret && typeof ret.then === 'function') ret.then(succeed).catch(fail);
      } catch (e) {
        fail(e);
      }
    });
    this._qrDrawerPromise.catch(() => { this._qrDrawerPromise = null; });
    return this._qrDrawerPromise;
  },

  drawPassQr(payload, attempt = 0) {
    if (!payload || !this.data.showQrModal || this.data.passState === 'redeemed') return;
    const failDraw = () => {
      if (attempt < QR_DRAW_RETRY_MAX) {
        setTimeout(() => this.drawPassQr(payload, attempt + 1), QR_DRAW_RETRY_MS);
        return;
      }
      this.setData({
        passState: 'error',
        passErrorMsg: '二维码绘制失败，可出示下方编号'
      });
    };
    const runDraw = (drawMemberQr) => {
      drawMemberQr('#memberPassQrCanvas', payload, this, 264, {
        bg: '#F2EDE4',
        fg: '#1A1814',
        margin: 12
      }).then((ok) => {
        if (ok || !this.data.showQrModal || this.data.passState === 'redeemed') return;
        failDraw();
      }).catch(failDraw);
    };
    if (this._drawMemberQr) {
      runDraw(this._drawMemberQr);
      return;
    }
    this.loadQrDrawer().then(runDraw).catch(failDraw);
  },

  async refreshMemberPass() {
    if (!this.data.showQrModal || this._passRefreshing) return;
    if (this.data.passState === 'redeemed') return;
    const session = this._passSession;
    this._passRefreshing = true;
    try {
      const preferredCouponId = String(this._passPreferredCouponId || '').trim();
      const res = await wx.cloud.callFunction({
        name: 'getMemberPass',
        data: {
          ...(preferredCouponId ? { preferredCouponId } : {})
        }
      });
      const payload = res.result || {};
      if (session !== this._passSession) return;
      if (!this.data.showQrModal || this.data.passState === 'redeemed') return;
      if (!payload.success) {
        const guest = /未登录/.test(payload.msg || '');
        if (!guest && this.data.qrPayload && this.data.passState === 'ready') {
          // 刷新失败但仍可出示：恢复绿灯与短倒计时，避免一直灰灯
          this.setData({ passCountdown: Math.max(this.data.passCountdown || 0, 15) });
          wx.showToast({ title: '刷新失败，仍可出示当前码', icon: 'none' });
          return;
        }
        this.setData({
          passState: guest ? 'guest' : 'error',
          passErrorMsg: payload.msg || '会员码生成失败',
          passCountdown: 0
        });
        return;
      }
      const ttl = Math.max(15, Math.min(120, Number(payload.expiresIn) || 60));
      this._passToken = payload.token;
      this.setData({
        memberPassToken: payload.token,
        qrPayload: payload.qrPayload,
        memberNo: payload.memberNo || this.data.memberNo,
        passCountdown: ttl,
        passState: 'ready',
        passErrorMsg: ''
      });
      setTimeout(() => this.drawPassQr(payload.qrPayload, 0), 80);
      this.armRedeemWatch(session);
    } catch (e) {
      console.warn('refreshMemberPass', e);
      if (session !== this._passSession) return;
      if (!this.data.showQrModal || this.data.passState === 'redeemed') return;
      if (this.data.qrPayload && this.data.passState === 'ready') {
        this.setData({ passCountdown: Math.max(this.data.passCountdown || 0, 15) });
        wx.showToast({ title: '刷新失败，仍可出示当前码', icon: 'none' });
        return;
      }
      this.setData({
        passState: 'error',
        passErrorMsg: '会员码暂时无法刷新',
        passCountdown: 0
      });
    } finally {
      this._passRefreshing = false;
    }
  },

  closeMemberCode(options = {}) {
    this.stopPassTimer();
    this.stopRedeemPoll();
    this._passPreferredCouponId = '';
    this._passToken = '';
    this._acceptRedeem = false;
    this._passWatchArmed = false;
    this._passSession = (this._passSession || 0) + 1;
    this.setData({
      showQrModal: false,
      passState: 'loading',
      memberPassToken: '',
      qrPayload: '',
      passCouponHint: '',
      redeemTitle: '',
      redeemValue: 0,
      redeemValueText: '',
      redeemAnimating: false
    });
    this.restoreScreenBrightness();
    if (!options.keepTabBarHidden && !this.data.showLevelModal) {
      this.setTabBarVisible(true);
    }
  },

  preventPassClose() {},

  openLevelFromPass() {
    this.closeMemberCode({ keepTabBarHidden: true });
    setTimeout(() => this.showLevelBenefits(), 280);
  },
  closeGroupModal() { 
    wx.vibrateShort({ type: 'light' });
    this.setData({ showGroupModal: false }); 
  },
  
  // 二维码加载错误处理
  onQrError(e) {
    console.error('二维码加载失败', e);
  },

  // 头像：选图 → 云存储 → upsertUserProfile
  async onChangeAvatar() {
    if (isLocalLoggedOut()) {
      this.resumeLogin();
      return;
    }
    if (this._avatarSaving) {
      wx.showToast({ title: '头像保存中…', icon: 'none' });
      return;
    }
    try { wx.vibrateShort({ type: 'light' }); } catch (e) { /* ignore */ }
    try {
      const path = await pickAvatarImage();
      await this.uploadAvatarPath(path);
    } catch (err) {
      toastAvatarPickError(err);
    }
  },

  async uploadAvatarPath(avatarUrl) {
    if (this._avatarSaving) return;
    this._avatarSaving = true;
    this.setData({ 'userInfo.avatarUrl': avatarUrl });
    if (this._avatarSaveTimer) clearTimeout(this._avatarSaveTimer);
    this._avatarSaveTimer = setTimeout(() => {
      if (!this._avatarSaving) return;
      this._avatarSaving = false;
      try { wx.hideLoading(); } catch (e) { /* ignore */ }
      wx.showToast({ title: '头像上传超时，请重试', icon: 'none' });
    }, 20000);
    wx.showLoading({ title: '更新头像', mask: true });
    try {
      const openid = app.globalData.openid || 'user';
      const ext = avatarExtFromPath(avatarUrl);
      const up = await wx.cloud.uploadFile({
        cloudPath: `avatars/${openid}/${Date.now()}.${ext}`,
        filePath: avatarUrl
      });
      const fileID = up && up.fileID;
      if (!fileID) throw new Error('AVATAR_UPLOAD');
      this.setData({ 'userInfo.avatarUrl': fileID });
      await this.updateUserProfile({ avatarUrl: fileID });
      this.persistMemberCardSnapshot();
      wx.hideLoading();
      wx.vibrateShort({ type: 'light' });
      wx.showToast({ title: '头像已更新', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.warn('avatar upload', err);
      wx.showToast({ title: '头像上传失败，请重试', icon: 'none' });
    } finally {
      if (this._avatarSaveTimer) {
        clearTimeout(this._avatarSaveTimer);
        this._avatarSaveTimer = null;
      }
      this._avatarSaving = false;
    }
  },

  onUpdateNickName(e) {
    const nickName = e.detail.value;
    if (!nickName) return;
    this.setData({ 'userInfo.nickName': nickName });
    this.persistMemberCardSnapshot();
    this.updateUserProfile({ nickName }).catch(() => {
      wx.showToast({ title: '昵称保存失败', icon: 'none' });
    });
  },

  goToProfile() {
    wx.vibrateShort({ type: 'light' });
    if (isLocalLoggedOut()) {
      this.resumeLogin({ thenProfile: true });
      return;
    }
    wx.navigateTo({
      url: '/subpackages/extra/user/profile/index',
      fail: () => wx.showToast({ title: '无法打开藏家档案', icon: 'none' })
    });
  },

  goToFeedback() {
    wx.navigateTo({
      url: '/subpackages/extra/user/feedback/index',
      fail: () => wx.showToast({ title: '无法打开反馈', icon: 'none' })
    });
  },

  goToLegal(e) {
    const type = (e.currentTarget.dataset.type === 'privacy') ? 'privacy' : 'terms';
    wx.navigateTo({
      url: `/subpackages/extra/user/legal/index?type=${type}`,
      fail: () => wx.showToast({ title: '无法打开协议', icon: 'none' })
    });
  },

  async updateUserProfile(data) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'upsertUserProfile',
        data: { patch: data }
      });
      const payload = (res && res.result) || {};
      if (!payload.success) {
        throw new Error(payload.msg || '保存失败');
      }
      await fetchUserSession(app);
      return true;
    } catch (e) {
      console.warn('updateUserProfile', e);
      throw e;
    }
  },

  // 管理员验证（已迁移至 utils/managerAuth.js，保留别名便于兼容）
  checkAdminPassword() {
    requestManagerAccess();
  },

  /**
   * 后台入口可见性。真正的权限由各云函数自行校验，这里只决定菜单显示哪一项。
   * 与 manageStaff.whoami 强一致：优先 session/whoami 的 workspaceRole；
   * 仅当云端未返回时，才用本地硬编码超管 / staffRole 兜底。
   */
  buildStaffEntryFields(data) {
    try {
      const appInstance = getApp();
      const openid = (appInstance && appInstance.globalData && appInstance.globalData.openid) || '';
      const payload = { ...(data || {}) };
      if (!payload.roles || !payload.roles.length) {
        const fallback = [];
        if (payload.isSuperAdmin) fallback.push('super_admin');
        if (payload.isManager) fallback.push('manager');
        if (payload.isInvestor) fallback.push('investor');
        if (payload.isShareholder) fallback.push('shareholder');
        if (payload.isStaff) fallback.push('staff');
        if (payload.isArtisan) fallback.push('specimen_artisan');
        if (payload.isLiveHost) fallback.push('live_host');
        if (fallback.length) {
          payload.roles = fallback;
        } else if (isSuperAdminOpenid(openid)) {
          payload.roles = ['super_admin'];
        } else if (payload.isAdmin) {
          payload.roles = ['manager'];
        }
      }
      // session 旧版可能漏掉 investor/shareholder：用显式标记补回
      if (payload.isInvestor || payload.staffRole === 'investor') {
        const roles = Array.isArray(payload.roles) ? payload.roles.slice() : [];
        if (roles.indexOf('investor') === -1) roles.push('investor');
        payload.roles = roles;
      }
      if (payload.isShareholder || payload.staffRole === 'shareholder') {
        const roles = Array.isArray(payload.roles) ? payload.roles.slice() : [];
        if (roles.indexOf('shareholder') === -1) roles.push('shareholder');
        payload.roles = roles;
      }
      const entries = workbenchEntries(payload).map((e) => ({
        ...e,
        badgeCount: Number(e.badgeCount) || 0,
        icon: WORKBENCH_TILE_ICONS[e.key] || '/assets/icons/lock.png'
      }));
      const cached = readWorkbenchBadgeCache();
      const counts = {
        workflow: this.data.workflowUnreadCount || (cached && cached.workflow) || 0,
        digest: this.data.workbenchDigestUnread || (cached && cached.digest) || 0,
        approval: this.data.workbenchApprovalPending || (cached && cached.approval) || 0,
        order: this.data.workbenchOrderUnread || (cached && cached.order) || 0,
        wishlist: this.data.workbenchWishlistUnread || (cached && cached.wishlist) || 0
      };
      const tiles = buildWorkbenchTilesFromCounts(entries, counts);
      const resolved = resolveWorkspaceRole(payload);
      return {
        staffRole: payload.staffRole || '',
        workspaceRole: resolved,
        workbenchEntries: entries,
        workbenchTiles: tiles,
        workflowUnreadCount: counts.workflow,
        workbenchDigestUnread: counts.digest,
        workbenchOrderUnread: counts.order,
        workbenchWishlistUnread: counts.wishlist,
        workbenchApprovalPending: counts.approval,
        ...buildWorkbenchMarqueeFields(counts),
        isStaffOnly: resolved === WORKSPACE_STORE_STAFF && entries.length === 1,
        showManagerEntry: entries.some((e) => e.kind === 'super_admin' || e.kind === 'manager' || e.kind === 'artisan' || e.kind === 'live_host' || e.kind === 'investor' || e.kind === 'shareholder'),
        showStaffEntry: entries.some((e) => e.kind === 'staff'),
        managerEntryTitle: '店长工作台',
        managerEntryEn: 'MANAGER',
        staffEntryTitle: '店员工作台',
        staffEntryEn: 'STAFF'
      };
    } catch (e) {
      console.warn('buildStaffEntryFields', e);
      return {
        staffRole: '',
        workspaceRole: '',
        ...emptyWorkbenchBadgeState(),
        isStaffOnly: false,
        showManagerEntry: false,
        showStaffEntry: false,
        managerEntryTitle: '店长工作台',
        managerEntryEn: 'MANAGER',
        staffEntryTitle: '店员工作台',
        staffEntryEn: 'STAFF'
      };
    }
  },

  /**
   * 工作台框阵：工作信息置首 + 各角色入口
   * counts: { workflow, approval, order, wishlist }
   */
  buildWorkbenchTiles(entries, counts = {}) {
    return buildWorkbenchTilesFromCounts(entries, counts);
  },

  _workbenchMarqueeFields(counts = {}) {
    return buildWorkbenchMarqueeFields(counts);
  },

  /** 同步灌入工作台快照（SWR 占位，避免返回「我的」后跑马灯晚跳出） */
  hydrateWorkbenchBadgeSnapshot() {
    if (isLocalLoggedOut()) return false;
    const snap = readWorkbenchBadgeCache();
    if (!snap) return false;
    const counts = normalizeWorkbenchCounts(snap);
    const liveEntries = Array.isArray(this.data.workbenchEntries) ? this.data.workbenchEntries : [];
    if (liveEntries.length) {
      this.setData({
        workflowUnreadCount: counts.workflow,
        workbenchOrderUnread: counts.order,
        workbenchWishlistUnread: counts.wishlist,
        workbenchApprovalPending: counts.approval,
        workbenchTiles: buildWorkbenchTilesFromCounts(liveEntries, counts),
        ...buildWorkbenchMarqueeFields(counts)
      });
      return true;
    }
    this.setData(snapshotToWorkbenchFields(snap));
    return true;
  },

  onWorkbenchMarqueeTap() {
    wx.vibrateShort({ type: 'light' });
    const workflow = Number(this.data.workflowUnreadCount) || 0;
    const order = Number(this.data.workbenchOrderUnread) || 0;
    const wishlist = Number(this.data.workbenchWishlistUnread) || 0;
    const approval = Number(this.data.workbenchApprovalPending) || 0;
    if (workflow > 0 || order > 0 || wishlist > 0 || approval <= 0) {
      this.goToWorkflowMessages();
      return;
    }
    const entries = Array.isArray(this.data.workbenchEntries) ? this.data.workbenchEntries : [];
    const manager = entries.find((e) => e && (e.kind === 'manager' || e.kind === 'super_admin'));
    if (manager) {
      requestWorkspaceAccess(manager.kind, manager.workspace || '');
      return;
    }
    this.goToWorkflowMessages();
  },

  _couponBadgeFields(count) {
    const text = formatBadgeText(count);
    return {
      couponBadgeText: text,
      couponBadgeWide: text === '99+'
    };
  },

  _messageBadgeFields(count) {
    const text = formatBadgeText(count);
    return {
      messageBadgeText: text,
      messageBadgeWide: text === '99+'
    };
  },

  _achievementBadgeFields(unlocked) {
    const openid = (app.globalData && app.globalData.openid) || '';
    const newCount = getAchievementNewCount(unlocked, openid);
    const text = formatBadgeText(newCount);
    return {
      achievementNewCount: newCount,
      achievementBadgeText: text,
      achievementBadgeWide: text === '99+'
    };
  },

  _clearAchievementBadge(unlocked) {
    const openid = (app.globalData && app.globalData.openid) || '';
    markAchievementsSeen(
      unlocked != null ? unlocked : ((this.data.achievementStats && this.data.achievementStats.unlocked) || 0),
      openid
    );
    this.setData({
      achievementNewCount: 0,
      achievementBadgeText: '',
      achievementBadgeWide: false
    });
  },

  onWorkbenchTap(e) {
    const ds = e.currentTarget.dataset || {};
    const kind = String(ds.kind || '').trim();
    if (!kind) return;
    wx.vibrateShort({ type: 'light' });
    requestWorkspaceAccess(kind, ds.workspace || '');
  },

  onWorkbenchTileTap(e) {
    const ds = e.currentTarget.dataset || {};
    const key = String(ds.key || '').trim();
    if (!key) return;
    wx.vibrateShort({ type: 'light' });
    try {
      if (app.globalData) app.globalData.forceWorkbenchBadgeRefresh = true;
    } catch (err) { /* ignore */ }
    if (key === 'workflow') {
      this.goToWorkflowMessages();
      return;
    }
    requestWorkspaceAccess(String(ds.kind || '').trim(), ds.workspace || '');
  },

  /* 2026-09-21：`goToDigestMessages()` 随工作台那张独立「日报」瓦片一起去掉了。
     日报的入口现在是**工作信息里的「日报」档**（`WORKFLOW_FILTER_TABS` 的 digest），
     进工作信息后点那一栏即可，深链参数由消息页自己处理。 */

  goToWorkflowMessages() {
    try {
      if (app.globalData) app.globalData.forceWorkbenchBadgeRefresh = true;
    } catch (e) { /* ignore */ }
    wx.navigateTo({
      url: '/subpackages/extra/user/messages/index?queue=workflow&from=workbench',
      success: () => {
        setTimeout(() => {
          this.loadUnreadMessageCount();
          this.loadWorkbenchBadges({ force: true });
        }, 500);
      },
      fail: () => wx.showToast({ title: '无法打开工作信息', icon: 'none' })
    });
  },

  goStaffConsole() {
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({
      url: '/subpackages/extra/staff/index',
      fail: () => wx.showToast({ title: '店员工作台暂不可用', icon: 'none' })
    });
  },

  // 🟢 加载用户统计数据
  async loadUserStatistics() {
    if (this.data.loadingStatistics) return;
    
    this.setData({ loadingStatistics: true });
    
    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserStatistics'
      });

      if (res.result && res.result.success) {
        const stats = res.result.data;
        // 格式化最后活跃时间
        const formattedTime = this.formatTime(stats.lastActiveTime);
        this.setData({
          statistics: stats,
          formattedLastActive: formattedTime,
          loadingStatistics: false
        });
        this.syncCardBackStats();
      } else {
        console.error('获取统计数据失败:', res.result?.msg);
        this.setData({ loadingStatistics: false });
      }
    } catch (err) {
      console.error('加载统计数据失败:', err);
      this.setData({ loadingStatistics: false });
    }
  },

  // 🟢 显示数据统计面板
  showStatistics() {
    wx.vibrateShort({ type: 'medium' });
    this.setData({ showStatisticsModal: true });
    // 如果统计数据为空，重新加载
    if (this.data.statistics.viewCount === 0 && !this.data.loadingStatistics) {
      this.loadUserStatistics();
    }
  },

  // 🟢 关闭数据统计面板
  closeStatistics() {
    wx.vibrateShort({ type: 'light' });
    this.setData({ showStatisticsModal: false });
  },

  // 🟢 格式化时间
  formatTime(timestamp) {
    if (!timestamp) return '暂无';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    if (days < 30) return `${Math.floor(days / 7)}周前`;
    if (days < 365) return `${Math.floor(days / 30)}个月前`;
    return `${Math.floor(days / 365)}年前`;
  },

  // 🟢 显示等级权益页面
  showLevelBenefits() {
    wx.vibrateShort({ type: 'medium' });
    this.restoreScreenBrightness();
    this.syncLevelPerks(this.data.level);
    this.setData({ showLevelModal: true });
    this.setTabBarVisible(false);
  },

  closeLevelModal() {
    wx.vibrateShort({ type: 'light' });
    this.setData({ showLevelModal: false });
    if (!this.data.showQrModal) this.setTabBarVisible(true);
  },

  // 🟢 获取等级图标
  getLevelIcon(level) {
    const icons = {
      1: '/assets/icons/knowledge.png',
      2: '/assets/icons/star.png',
      3: '/assets/icons/star-active.png',
      4: '/assets/icons/medal_gold.png',
      5: '/assets/icons/medal_gold.png',
      99: '/assets/icons/medal_gold.png'
    };
    return icons[level] || '/assets/icons/knowledge.png';
  },

  async loadAtlasProgress() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageAtlas',
        data: { action: 'catalog' }
      });
      const stats = res.result && res.result.data && res.result.data.stats;
      if (stats) {
        this.setData({
          atlasStats: {
            unlocked: stats.unlocked || 0,
            total: stats.total || 0
          }
        });
      }
    } catch (e) {
      console.warn('loadAtlasProgress', e);
    }
  },
  async loadAchievements() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserAchievements',
        data: { userId: app.globalData.openid }
      });
      
      if (res.result && res.result.success) {
        const stats = res.result.data.stats || {};
        const unlocked = Number(stats.unlocked) || 0;
        this.setData({
          achievementStats: stats,
          ...this._achievementBadgeFields(unlocked)
        });
      }
    } catch (e) {
      console.error('加载成就数据失败:', e);
    }
  },

  // 🟢 跳转到成就页面
  goToAchievements() {
    // 需求 23：开关关闭时不放行（UI 已隐藏，此处兜底，避免深链/旧缓存进入）
    if (this.data.showAchievements === false) {
      wx.showToast({ title: '我的成就暂未开放', icon: 'none' });
      return;
    }
    try {
      wx.vibrateShort({ type: 'medium' });
      wx.navigateTo({
        url: '/subpackages/extra/user/achievements/index',
        success: () => {
          this._clearAchievementBadge();
        },
        fail: (err) => {
          console.error('跳转成就页面失败:', err);
          let errorMsg = '页面加载失败';
          if (err.errMsg) {
            if (err.errMsg.includes('not found')) {
              errorMsg = '页面不存在，请检查配置';
            } else if (err.errMsg.includes('fail')) {
              errorMsg = '跳转失败，请重试';
            }
          }
          wx.showToast({
            title: errorMsg,
            icon: 'none',
            duration: 2000
          });
        }
      });
    } catch (e) {
      console.error('跳转成就页面异常:', e);
      wx.showToast({
        title: '跳转异常，请重试',
        icon: 'none',
        duration: 2000
      });
    }
  },

  // 🟢 加载未读消息数量（顾客队列；工作流不计入红点）
  async loadUnreadMessageCount() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserMessages',
        data: {
          action: 'getUnreadCount',
          queue: 'customer'
        }
      });

      if (res.result && res.result.success) {
        const count = Number(res.result.count) || 0;
        this.setData({
          unreadMessageCount: count,
          ...this._messageBadgeFields(count)
        });
      }
    } catch (e) {
      console.error('加载未读消息数量失败:', e);
    }
  },

  /**
   * 工作台蓝点 + 跑马灯（stale-while-revalidate）：
   * - 先 hydrate 缓存占位，再拉云端；写回 storage
   * - force=true：读信/审批返回后强制刷新
   * - soft TTL 仅影响「是否跳过网络」；默认始终后台 revalidate
   */
  async loadWorkbenchBadges(options = {}) {
    const force = !!(options && options.force);
    if (this._workbenchBadgeLoading && !force) return;
    if (isLocalLoggedOut()) {
      this.setData(emptyWorkbenchBadgeState());
      return;
    }

    // 无内存态时先用缓存画出，避免晚跳出
    if (!this.data.workbenchMarqueeShow && !(this.data.workbenchTiles || []).length) {
      this.hydrateWorkbenchBadgeSnapshot();
    } else if (!this.data.workbenchMarqueeShow) {
      this.hydrateWorkbenchBadgeSnapshot();
    }

    let entries = Array.isArray(this.data.workbenchEntries) ? this.data.workbenchEntries : [];
    if (!entries.length) {
      const snap = readWorkbenchBadgeCache();
      if (snap && Array.isArray(snap.entries) && snap.entries.length) {
        this.hydrateWorkbenchBadgeSnapshot();
        entries = Array.isArray(this.data.workbenchEntries) ? this.data.workbenchEntries : [];
      }
      if (!entries.length) {
        // 尚无角色入口：不清空已有跑马灯；等 session 回来再刷
        return;
      }
    }

    const cached = readWorkbenchBadgeCache();
    const cacheAge = cached && cached.ts ? Date.now() - Number(cached.ts) : Infinity;
    if (
      !force &&
      cached &&
      cacheAge < WORKBENCH_BADGE_SOFT_TTL_MS &&
      this.data.workbenchMarqueeShow
    ) {
      // 软 TTL 内已有画面：仍后台刷新，但不阻塞；允许并发一次
    }

    this._workbenchBadgeLoading = true;
    const needsManagerBadge = entries.some(
      (e) => e && (e.kind === 'super_admin' || e.kind === 'manager')
    );
    const needsArtisanBadge = entries.some(
      (e) => e && (e.kind === 'artisan' || e.key === 'specimen_artisan')
    );

    let workflowUnread = 0;
    let digestUnread = 0;
    let approvalPending = 0;
    let orderUnread = 0;
    let wishlistUnread = 0;

    try {
      const tasks = [
        wx.cloud.callFunction({
          name: 'getUserMessages',
          data: { action: 'getUnreadCount', queue: 'workflow' }
        }).catch(() => null)
      ];
      const taskMeta = ['workflow'];

      // 日报**单独一档**：角标只数「日报这一档的未读」。
      // 为什么不并入 workflow 未读：那会把「有 N 条工作信息待阅」的语义搞糊，
      // 而日报的未读只表示「这一期你还没点开看」。
      tasks.push(
        wx.cloud.callFunction({
          name: 'getUserMessages',
          data: {
            action: 'getUnreadCount',
            queue: 'workflow',
            category: 'digest'
          }
        }).catch(() => null)
      );
      taskMeta.push('digest');

      if (needsManagerBadge) {
        tasks.push(
          wx.cloud.callFunction({
            name: 'manageApprovals',
            data: { action: 'countPending' }
          }).catch(() => null)
        );
        taskMeta.push('approval');
        tasks.push(
          wx.cloud.callFunction({
            name: 'getUserMessages',
            data: {
              action: 'getUnreadCount',
              queue: 'workflow',
              category: 'ops',
              type: 'staff_order_paid'
            }
          }).catch(() => null)
        );
        taskMeta.push('order');
      }

      if (needsArtisanBadge) {
        tasks.push(
          wx.cloud.callFunction({
            name: 'getUserMessages',
            data: {
              action: 'getUnreadCount',
              queue: 'workflow',
              category: 'ops',
              type: 'wishlist_restock_request'
            }
          }).catch(() => null)
        );
        taskMeta.push('wishlist');
      }

      const results = await Promise.all(tasks);
      taskMeta.forEach((key, idx) => {
        const payload = (results[idx] && results[idx].result) || {};
        if (!payload.success) return;
        const n = Number(payload.count != null ? payload.count : payload.pendingCount) || 0;
        if (key === 'workflow') workflowUnread = n;
        if (key === 'digest') digestUnread = n;
        if (key === 'approval') approvalPending = n;
        if (key === 'order') orderUnread = n;
        if (key === 'wishlist') wishlistUnread = n;
      });
    } catch (e) {
      console.warn('loadWorkbenchBadges', e);
      this._workbenchBadgeLoading = false;
      return;
    }

    const counts = {
      workflow: workflowUnread,
      digest: digestUnread,
      approval: approvalPending,
      order: orderUnread,
      wishlist: wishlistUnread
    };
    const liveEntries = Array.isArray(this.data.workbenchEntries) && this.data.workbenchEntries.length
      ? this.data.workbenchEntries
      : entries;
    const nextEntries = liveEntries.map((e) => {
      if (!e) return e;
      if (e.kind === 'super_admin' || e.kind === 'manager') {
        return { ...e, badgeCount: Math.min(999, approvalPending + orderUnread) };
      }
      if (e.kind === 'artisan' || e.key === 'specimen_artisan') {
        return { ...e, badgeCount: Math.min(999, wishlistUnread) };
      }
      return { ...e, badgeCount: 0 };
    });

    persistWorkbenchBadgeCache(counts, nextEntries);
    this.setData({
      workbenchEntries: nextEntries,
      workflowUnreadCount: workflowUnread,
      workbenchOrderUnread: orderUnread,
      workbenchWishlistUnread: wishlistUnread,
      workbenchApprovalPending: approvalPending,
      workbenchDigestUnread: counts.digest,
      workbenchTiles: buildWorkbenchTilesFromCounts(nextEntries, counts),
      ...buildWorkbenchMarqueeFields(counts)
    });
    this._workbenchBadgeLoading = false;

    if (needsManagerBadge && orderUnread > 0) {
      this.maybeShowNewOrderAlertFromUser({ count: orderUnread });
    }
    // 订阅授权必须在用户点击工作台入口时发起（managerAuth / 弹窗确认），
    // 不可在 onShow 异步回调里调 requestSubscribeMessage
  },

  _readNewOrderAlertShownIds() {
    try {
      const raw = wx.getStorageSync(NEW_ORDER_ALERT_SHOWN_KEY);
      if (Array.isArray(raw)) return raw.map(String);
      if (raw && typeof raw === 'object') return Object.keys(raw);
    } catch (e) {
      // ignore
    }
    return [];
  },

  _markNewOrderAlertShownIds(ids) {
    const prev = this._readNewOrderAlertShownIds();
    const set = {};
    prev.concat(ids || []).forEach((id) => {
      if (id) set[String(id)] = true;
    });
    const next = Object.keys(set).slice(-80);
    try {
      wx.setStorageSync(NEW_ORDER_ALERT_SHOWN_KEY, next);
    } catch (e) {
      // ignore
    }
  },

  /**
   * 「我的」页：超管/店长看到未读新订单时加强弹窗一次（与店长台共用本地去重）
   */
  async maybeShowNewOrderAlertFromUser(options = {}) {
    if (this._newOrderPopupShowing) return;
    const entries = Array.isArray(this.data.workbenchEntries) ? this.data.workbenchEntries : [];
    const canAlert = entries.some(
      (e) => e && (e.kind === 'super_admin' || e.kind === 'manager')
    );
    if (!canAlert) return;

    const countHint = Math.max(0, Number(options.count) || 0);
    if (countHint <= 0) return;

    let unread = [];
    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserMessages',
        data: {
          action: 'getMessages',
          category: 'ops',
          queue: 'workflow',
          type: STAFF_ORDER_MSG_TYPE,
          page: 0,
          pageSize: 20
        }
      });
      const result = (res && res.result) || {};
      const messages = Array.isArray(result.messages) ? result.messages : [];
      unread = messages.filter((m) => m && m.read !== true);
    } catch (e) {
      console.warn('maybeShowNewOrderAlertFromUser', e);
      return;
    }
    if (!unread.length) return;

    const shown = this._readNewOrderAlertShownIds();
    const shownSet = {};
    shown.forEach((id) => {
      shownSet[id] = true;
    });
    const fresh = unread.filter((m) => {
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
        ? `${body}\n点击「去处理」进入店长工作台。`
        : `最近一笔：${body}\n另有 ${n - 1} 笔未读。`;

    this._newOrderPopupShowing = true;
    this._markNewOrderAlertShownIds(fresh.map((m) => m.relatedId || m._id));

    try {
      wx.vibrateShort({ type: 'medium' });
    } catch (e) {
      // ignore
    }

    this.modal({
      title,
      overline: 'NEW ORDER',
      content: String(content).slice(0, 160),
      confirmText: '去处理',
      cancelText: '稍后'
    }).then((r) => {
      this._newOrderPopupShowing = false;
      // 自定义弹窗的确认同样是用户手势，可攒订阅额度
      requestStaffOrderSubscribe().catch(() => null);
      if (r.confirm) {
        const mgr = entries.find(
          (e) => e && (e.kind === 'super_admin' || e.kind === 'manager')
        );
        requestWorkspaceAccess(
          (mgr && mgr.kind) || 'manager',
          (mgr && mgr.workspace) || ''
        );
      }
    }).catch(() => {
      // 弹窗未正常结算时也要解除「正在展示」标记，否则后续新订单提醒会被吞掉
      this._newOrderPopupShowing = false;
    });
  },

  // 🟢 线下门店 · 这有店
  goToStore() {
    if (!this.data.showStore) {
      const { toastStoreClosed } = require('../../utils/contentDisplayFlags')
      toastStoreClosed()
      return
    }
    wx.vibrateShort({ type: 'medium' })
    wx.navigateTo({
      url: '/subpackages/business/store/index?from=user',
      fail: () => wx.showToast({ title: '无法打开这有店', icon: 'none' })
    })
  },

  goToCare() {
    wx.vibrateShort({ type: 'medium' })
    wx.navigateTo({ url: '/subpackages/feature/care/index?from=user' })
  },

  goToCommunity() {
    wx.vibrateShort({ type: 'medium' })
    trackBehavior('community_entry_click', 'user', app.globalData.openid || 'guest', { source: 'user_services' })
    wx.navigateTo({ url: '/subpackages/feature/community/index?from=user' })
  },

  goToPetOrders() {
    wx.vibrateShort({ type: 'medium' })
    try {
      const { fetchContentDisplayFlags, toastPetMemorialClosed } = require('../../utils/contentDisplayFlags')
      fetchContentDisplayFlags().then(({ flags }) => {
        if (flags.showPetMemorial === false) {
          toastPetMemorialClosed()
          return
        }
        wx.navigateTo({ url: '/subpackages/feature/custom/pet/list/index?from=user' })
      }).catch(() => {
        wx.navigateTo({ url: '/subpackages/feature/custom/pet/list/index?from=user' })
      })
    } catch (e) {
      wx.navigateTo({ url: '/subpackages/feature/custom/pet/list/index?from=user' })
    }
  },

  // 🟢 跳转到联系专员
  goToSupport() {
    try {
      wx.vibrateShort({ type: 'medium' });
      wx.navigateTo({
        url: '/subpackages/extra/user/support/index',
        fail: (err) => {
          console.error('跳转联系专员失败:', err);
          wx.showToast({ title: '页面加载失败', icon: 'none' });
        }
      });
    } catch (e) {
      wx.showToast({ title: '跳转异常，请重试', icon: 'none' });
    }
  },

  // 🟢 跳转到站内信页面
  goToMessages() {
    try {
      wx.vibrateShort({ type: 'medium' });
      try {
        if (app.globalData) app.globalData.forceWorkbenchBadgeRefresh = true;
      } catch (e) { /* ignore */ }
      wx.navigateTo({
        url: '/subpackages/extra/user/messages/index',
        success: () => {
          setTimeout(() => {
            this.loadUnreadMessageCount();
            this.loadWorkbenchBadges({ force: true });
          }, 500);
        },
        fail: (err) => {
          console.error('跳转站内信页面失败:', err);
          wx.showToast({
            title: '页面加载失败',
            icon: 'none',
            duration: 2000
          });
        }
      });
    } catch (e) {
      console.error('跳转站内信页面异常:', e);
      wx.showToast({
        title: '跳转异常，请重试',
        icon: 'none',
        duration: 2000
      });
    }
  }
}));
