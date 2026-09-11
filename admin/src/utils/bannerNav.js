/**
 * Admin 轮播跳转：与小程序 utils/bannerNav.js 对齐（CommonJS 版复制为 ESM）
 */

export const SCHEME_PRESETS = [
  { id: 'onboarding', label: '新用户注册', path: '/subpackages/feature/user/onboarding/index' },
  { id: 'onboarding-done', label: '注册完成页', path: '/subpackages/feature/user/onboarding/done' },
  { id: 'home', label: '探索首页', path: '/pages/index/index' },
  { id: 'category', label: '馆藏', path: '/pages/category/index' },
  { id: 'atelier', label: '标本工坊', path: '/pages/atelier/index' },
  { id: 'cart', label: '购物车', path: '/pages/cart/index' },
  { id: 'user', label: '我的', path: '/pages/user/index' },
  { id: 'atlas', label: '山海图鉴', path: '/subpackages/feature/collection/index' },
  { id: 'store', label: '线下门店', path: '/pages/store/index' },
  { id: 'booking', label: '预约到店', path: '/subpackages/business/booking/index' },
  { id: 'my-bookings', label: '我的预约', path: '/subpackages/business/my-bookings/index' },
  { id: 'points', label: '积分中心', path: '/subpackages/business/points/index' },
  { id: 'coupons', label: '我的券包', path: '/subpackages/business/coupons/index' },
  { id: 'orders', label: '订单列表', path: '/subpackages/business/orders/index' },
  { id: 'order-claim', label: '订单认领', path: '/subpackages/business/order-claim/index' },
  { id: 'profile', label: '个人资料（生日礼）', path: '/subpackages/feature/user/profile/index' },
  { id: 'pet-memorial', label: '伴宠记忆', path: '/subpackages/feature/custom/pet/index' },
  { id: 'support', label: '联系专员', path: '/subpackages/feature/user/support/index' },
  { id: 'framer-recruit', label: '标本师招募', path: '/subpackages/business/framer-recruit/index' },
  { id: 'community', label: '社区', path: '/subpackages/feature/community/index' },
  { id: 'care', label: '养护指南', path: '/subpackages/feature/care/index' },
  { id: 'identify', label: 'AI鉴定', path: '/subpackages/feature/identify/index' },
  { id: 'messages', label: '站内消息', path: '/subpackages/feature/user/messages/index' },
  { id: 'achievements', label: '成就中心', path: '/subpackages/feature/user/achievements/index' },
  { id: 'address', label: '地址管理', path: '/subpackages/business/address/index' },
  { id: 'search', label: '搜索', path: '/subpackages/feature/search/index' },
  { id: 'custom-service', label: '定制服务', path: '/subpackages/feature/custom/index' },
  { id: 'about', label: '关于山海', path: '/subpackages/business/about/index' },
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
