/**
 * 曾被公开部署的内部资料旧地址 → 由 Function 直接回 404（2026-09-29）
 *
 * 这些文件已迁入 governance-assets（构建剔除），源站构建里没有它们，public/_redirects 也写了 404；
 * 但线上实测 Pages 资产层仍对不带查询参数的旧 URL 返回上线前缓存的副本
 * （/admin/partner-destiny-center 200 529KB、age≈40min、s-maxage=604800；/admin/sanyou-minglu.pdf 200）。
 * Function 路由先于静态资产执行，不经过那层缓存，因此在这里显式拦住，与清缓存互为兜底。
 * 登录后可看的正式入口是 /api/private-asset（functions/api/private-asset.js）。
 */
export const LEGACY_INTERNAL_PATHS = Object.freeze([
  '/admin/shanhai-capital-architecture-sandbox.html',
  '/admin/shanhai-capital-architecture-sandbox',
  '/admin/shanhai-studio-startup-cost-model.html',
  '/admin/shanhai-studio-startup-cost-model',
  '/admin/partner-destiny-center.html',
  '/admin/partner-destiny-center',
  '/admin/sanyou-minglu.pdf',
])

export function legacyInternalGone() {
  return new Response('<!DOCTYPE html><html><head><meta charset="utf-8"><title>404</title></head><body>Not Found</body></html>', {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  })
}
