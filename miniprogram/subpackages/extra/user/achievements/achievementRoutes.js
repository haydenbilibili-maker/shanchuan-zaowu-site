/**
 * 成就 →「去点亮」落点（2026-11-23）：把「还差 3 件」变成一步可走的路。
 * 按徽章 id 前缀定落点；没有明确落点的（分享）只给一句提示，不给假入口。
 * 纯函数，无 require；守卫在内存里求值。
 */
const CATEGORY_TAB = { url: '/pages/category/index', tab: true, label: '去馆藏' }

const ROUTES = [
  { prefix: 'explore_', ...CATEGORY_TAB },
  { prefix: 'collect_', ...CATEGORY_TAB },
  { prefix: 'first_purchase', ...CATEGORY_TAB },
  { prefix: 'spend_', ...CATEGORY_TAB },
  // 证书随签收的藏品签发 → 去馆藏
  { prefix: 'certificate_', ...CATEGORY_TAB },
  { prefix: 'search_', url: '/subpackages/feature/search/index', tab: false, label: '去搜索' },
  { prefix: 'folder_', url: '/subpackages/extra/user/wishlist/index', tab: false, label: '去收藏夹' },
  { prefix: 'atlas_', url: '/subpackages/feature/collection/index', tab: false, label: '去图鉴' },
  { prefix: 'course_', url: '/subpackages/business/booking/index', tab: false, label: '去预约课程' }
]

const HINTS = {
  share_: '在藏品页或图鉴页点右上角 ··· 分享'
}

/** 徽章 id → { url, tab, label } 或 null */
function routeOf(id) {
  const s = String(id || '')
  const hit = ROUTES.find((r) => s.indexOf(r.prefix) === 0)
  return hit ? { url: hit.url, tab: hit.tab, label: hit.label } : null
}

/** 没有落点时的一句提示（可空） */
function hintOf(id) {
  const s = String(id || '')
  const key = Object.keys(HINTS).find((k) => s.indexOf(k) === 0)
  return key ? HINTS[key] : ''
}

module.exports = { routeOf, hintOf, ROUTES }
