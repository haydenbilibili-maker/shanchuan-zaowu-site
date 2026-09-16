/**
 * 首页 / 装修海报跳转：统一解析 banners 的 type / target / link
 * type: product | category | booking | scheme | page | path
 */
const { remapLegacyPageUrl } = require('./messageHelper');

const TAB_ROOTS = [
  '/pages/index/index',
  '/pages/category/index',
  '/pages/atelier/index',
  '/pages/cart/index',
  '/pages/user/index'
];

/** Admin / 店长共用的功能页预设（path 可带 query；须与 app.json 已注册页一致） */
const SCHEME_PRESETS = [
  // 注册 / 引导
  { id: 'onboarding', label: '新用户注册', path: '/subpackages/extra/user/onboarding/index' },
  { id: 'onboarding-done', label: '注册完成页', path: '/subpackages/extra/user/onboarding/done' },
  // Tab 根页
  { id: 'home', label: '探索首页', path: '/pages/index/index' },
  { id: 'category', label: '馆藏', path: '/pages/category/index' },
  { id: 'atelier', label: '标本工坊', path: '/pages/atelier/index' },
  { id: 'cart', label: '购物车', path: '/pages/cart/index' },
  { id: 'user', label: '我的', path: '/pages/user/index' },
  // 常用功能
  { id: 'atlas', label: '山海图鉴', path: '/subpackages/feature/collection/index' },
  { id: 'store', label: '线下门店', path: '/subpackages/business/store/index' },
  { id: 'booking', label: '预约到店', path: '/subpackages/business/booking/index' },
  { id: 'my-bookings', label: '我的预约', path: '/subpackages/business/my-bookings/index' },
  { id: 'points', label: '我的积分', path: '/subpackages/business/points/index' },
  { id: 'coupons', label: '我的礼券夹', path: '/subpackages/business/coupons/index' },
  { id: 'stored-value', label: '我的钱包', path: '/subpackages/extra/user/stored-value/index' },
  { id: 'rewards', label: '我的钱包（含礼券夹）', path: '/subpackages/business/rewards/index' },
  { id: 'orders', label: '订单列表', path: '/subpackages/business/orders/index' },
  { id: 'order-claim', label: '订单认领', path: '/subpackages/business/order-claim/index' },
  { id: 'profile', label: '个人资料（生日礼）', path: '/subpackages/extra/user/profile/index' },
  { id: 'gift', label: '礼赠', path: '/subpackages/feature/gift/hub/index' },
  { id: 'my-gifts', label: '我的礼赠', path: '/subpackages/feature/gift/my-gifts/index' },
  { id: 'pet-memorial', label: '伴宠记忆', path: '/subpackages/feature/custom/pet/index' },
  { id: 'pet-orders', label: '伴宠工单', path: '/subpackages/feature/custom/pet/list/index' },
  { id: 'custom-orders', label: '定制订单', path: '/subpackages/feature/custom/orders/index' },
  { id: 'live', label: '馆内直播', path: '/subpackages/feature/live/watch/index' },
  { id: 'videos', label: '山海影像', path: '/subpackages/feature/videos/index' },
  { id: 'articles', label: '博物文章', path: '/subpackages/feature/articles/index' },
  { id: 'certificates', label: '我的证书', path: '/subpackages/extra/user/certificates/index' },
  { id: 'support', label: '联系专员', path: '/subpackages/extra/user/support/index' },
  { id: 'framer-recruit', label: '标本师招募', path: '/subpackages/business/framer-recruit/index' },
  { id: 'community', label: '社区', path: '/subpackages/feature/community/index' },
  { id: 'care', label: '养护指南', path: '/subpackages/feature/care/index' },
  { id: 'identify', label: 'AI 鉴定', path: '/subpackages/feature/identify/index' },
  { id: 'messages', label: '站内消息', path: '/subpackages/extra/user/messages/index' },
  { id: 'achievements', label: '成就中心', path: '/subpackages/extra/user/achievements/index' },
  { id: 'address', label: '地址管理', path: '/subpackages/business/address/index' },
  { id: 'search', label: '搜索', path: '/subpackages/feature/search/index' },
  { id: 'custom-service', label: '定制服务', path: '/subpackages/feature/custom/index' },
  { id: 'about', label: '关于山海', path: '/subpackages/business/about/index' },
  // 保留末项
  { id: 'custom', label: '自定义路径', path: '' }
];

function ensureLeadingSlash(path) {
  const s = String(path || '').trim();
  if (!s) return '';
  return s.charAt(0) === '/' ? s : `/${s}`;
}

/** Admin / 店长保存 scheme 路径时的基本校验 */
function validateSchemePath(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, message: '请填写小程序路径' };
  const lower = s.toLowerCase();
  if (lower.indexOf('javascript:') === 0 || lower.indexOf('data:') === 0 || lower.indexOf('vbscript:') === 0) {
    return { ok: false, message: '不允许使用该协议' };
  }
  if (/^https?:\/\//i.test(s)) {
    return { ok: false, message: '请使用小程序路径（/pages/ 或 /subpackages/），不要用外链' };
  }
  const pathOnly = ensureLeadingSlash(s.split('?')[0]);
  if (pathOnly.indexOf('/pages/') !== 0 && pathOnly.indexOf('/subpackages/') !== 0) {
    return { ok: false, message: '路径须以 /pages/ 或 /subpackages/ 开头' };
  }
  return { ok: true, path: ensureLeadingSlash(s) };
}

function resolveFromTypeTarget(type, target) {
  const t = String(type || '').toLowerCase();
  const raw = String(target || '').trim();
  if (t === 'product' && raw) {
    return `/subpackages/feature/detail/index?id=${encodeURIComponent(raw)}`;
  }
  if (t === 'booking') {
    return '/subpackages/business/booking/index';
  }
  if (t === 'scheme' || t === 'page' || t === 'path') {
    return ensureLeadingSlash(raw);
  }
  // category：无直链，由 openBannerItem 用 globalData + switchTab
  return '';
}

/**
 * @returns {{ href: string, categoryTarget: string }}
 * categoryTarget 非空时走馆藏 Tab，不 navigateTo
 */
function resolveBannerNav(item) {
  const row = item || {};
  const type = String(row.type || '').toLowerCase();
  const target = String(row.target || '').trim();
  const explicit = String(row.link || row.url || row.path || '').trim();

  if (type === 'category') {
    return { href: '', categoryTarget: target };
  }

  let href = explicit || resolveFromTypeTarget(type, target);
  if (!href && target && (target.indexOf('/pages/') === 0 || target.indexOf('/subpackages/') === 0 || target.indexOf('pages/') === 0 || target.indexOf('subpackages/') === 0)) {
    href = ensureLeadingSlash(target);
  }
  href = remapLegacyPageUrl(href);
  return { href: ensureLeadingSlash(href), categoryTarget: '' };
}

function isTabPath(url) {
  const path = String(url || '').split('?')[0];
  return TAB_ROOTS.indexOf(path) >= 0;
}

/**
 * @returns {boolean} 是否已发起跳转（含失败 toast 仍算已处理）
 */
function openBannerItem(item, options) {
  try {
    const { blockIfSinglePage } = require('./singlePageMode');
    if (blockIfSinglePage()) return false;
  } catch (e) { /* ignore */ }
  const opts = options || {};
  const trackFramer = typeof opts.onFramerRecruit === 'function' ? opts.onFramerRecruit : null;

  const { href, categoryTarget } = resolveBannerNav(item);

  if (categoryTarget) {
    try {
      const app = getApp();
      if (app && app.globalData) app.globalData.targetCategory = categoryTarget;
    } catch (e) { /* ignore */ }
    wx.switchTab({
      url: '/pages/category/index',
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    });
    return true;
  }

  if (!href) {
    wx.showToast({ title: '暂无跳转链接', icon: 'none' });
    return false;
  }

  if (href.indexOf('framer-recruit') >= 0 && trackFramer) trackFramer();

  if (href.indexOf('/pages/') !== 0 && href.indexOf('/subpackages/') !== 0) {
    wx.showToast({ title: '页面暂不可用', icon: 'none' });
    return false;
  }

  if (isTabPath(href)) {
    wx.switchTab({
      url: href.split('?')[0],
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    });
  } else {
    wx.navigateTo({
      url: href,
      fail: (err) => {
        console.error('openBannerItem navigate failed', href, err);
        wx.showToast({ title: '页面暂不可用', icon: 'none' });
      }
    });
  }
  return true;
}

/** Admin / 店长保存时：由 type+target 生成 link */
function buildBannerLinkForSave(type, target) {
  const t = String(type || '').toLowerCase();
  if (t === 'category') return '';
  return resolveFromTypeTarget(t, target) || ensureLeadingSlash(target);
}

module.exports = {
  SCHEME_PRESETS,
  resolveBannerNav,
  openBannerItem,
  buildBannerLinkForSave,
  isTabPath,
  validateSchemePath
};
