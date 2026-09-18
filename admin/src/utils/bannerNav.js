/**
 * Admin 轮播跳转：与小程序 utils/bannerNav.js 对齐（CommonJS 版复制为 ESM）
 *
 * ⚠️ `SCHEME_PRESETS` 必须与 `miniprogram/utils/bannerNav.js` 的**同名常量逐字一致**
 *    （id / label / path，含顺序）—— 两处编辑的是**同一个 `banners` 集合**，
 *    列表一旦漂移，运营在 ERP 与店长工作台看到的「功能页」候选就不一样。
 *    守卫 `npm run test:banner-presets` 会比对两份；**加新功能页请只改小程序那份，再跑守卫提示的同步**。
 *
 * 其余函数是**有意精简**的：ERP 只需要"校验路径 / 生成 link / 回填预设"，不需要运行时跳转。
 */
export const SCHEME_PRESETS = [
  // 注册 / 引导
  { id: 'onboarding', label: '新用户注册', path: '/subpackages/extra/user/onboarding/index' },
  { id: 'onboarding-done', label: '注册完成页', path: '/subpackages/extra/user/onboarding/done' },
  // Tab 根页
  { id: 'home', label: '探索首页', path: '/pages/index/index' },
  { id: 'category', label: '馆藏', path: '/pages/category/index' },
  { id: 'atelier', label: '标本工坊', path: '/pages/atelier/index' },
  { id: 'cart', label: '购物车', path: '/pages/cart/index' },
  { id: 'user', label: '我的', path: '/pages/user/index' },
  // 核心互动（新增核心功能优先放这里，海报/物料要能直接指向）
  // ⚠️ 祈福墙是**多面墙**：不带参数 = 默认墙；要指向某一面墙请在路径后补 `?productKey=<藏品键>`
  //    （页面 onLoad 对非法/缺失的 key 一律回落默认墙，不会跳出空白页）
  { id: 'wish-wall', label: '祈福墙', path: '/subpackages/feature/wish-wall/index' },
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
  { id: 'care-mine', label: '我的标本养护', path: '/subpackages/feature/care/my/index' },
  { id: 'identify', label: 'AI 鉴定', path: '/subpackages/feature/identify/index' },
  { id: 'messages', label: '站内消息', path: '/subpackages/extra/user/messages/index' },
  { id: 'achievements', label: '成就中心', path: '/subpackages/extra/user/achievements/index' },
  { id: 'address', label: '地址管理', path: '/subpackages/business/address/index' },
  { id: 'search', label: '搜索', path: '/subpackages/feature/search/index' },
  { id: 'custom-service', label: '定制服务', path: '/subpackages/feature/custom/index' },
  { id: 'about', label: '关于山海', path: '/subpackages/business/about/index' },
  // 工具与合规（同一页靠 query 区分两份文档）
  { id: 'wishlist', label: '收藏与候补', path: '/subpackages/extra/user/wishlist/index' },
  { id: 'ar', label: 'AR 试摆', path: '/subpackages/business/ar/index' },
  { id: 'feedback', label: '反馈与建议', path: '/subpackages/extra/user/feedback/index' },
  { id: 'terms', label: '用户协议', path: '/subpackages/extra/user/legal/index?type=terms' },
  { id: 'privacy', label: '隐私政策', path: '/subpackages/extra/user/legal/index?type=privacy' },
  // 保留末项
  { id: 'custom', label: '自定义路径', path: '' }
]

export function ensureLeadingSlash(path) {
  const s = String(path || '').trim()
  if (!s) return ''
  return s.charAt(0) === '/' ? s : `/${s}`
}

export function buildBannerLinkForSave(type, target) {
  const t = String(type || '').toLowerCase()
  const raw = String(target || '').trim()
  if (t === 'product' && raw) return `/subpackages/feature/detail/index?id=${encodeURIComponent(raw)}`
  if (t === 'booking') return '/subpackages/business/booking/index'
  if (t === 'scheme' || t === 'page' || t === 'path') return ensureLeadingSlash(raw)
  return ''
}

export function validateSchemePath(raw) {
  const s = String(raw || '').trim()
  if (!s) return { ok: false, message: '请填写小程序路径' }
  const lower = s.toLowerCase()
  if (lower.indexOf('javascript:') === 0 || lower.indexOf('data:') === 0 || lower.indexOf('vbscript:') === 0) {
    return { ok: false, message: '不允许使用该协议' }
  }
  if (/^https?:\/\//i.test(s)) {
    return { ok: false, message: '请使用小程序路径（/pages/ 或 /subpackages/），不要用外链' }
  }
  const pathOnly = ensureLeadingSlash(s.split('?')[0])
  if (pathOnly.indexOf('/pages/') !== 0 && pathOnly.indexOf('/subpackages/') !== 0) {
    return { ok: false, message: '路径须以 /pages/ 或 /subpackages/ 开头' }
  }
  return { ok: true, path: ensureLeadingSlash(s) }
}

export function matchSchemePresetId(path) {
  const p = ensureLeadingSlash(path).split('?')[0]
  const hit = SCHEME_PRESETS.find((x) => x.path && x.path === p)
  return hit ? hit.id : 'custom'
}
