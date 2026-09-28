/**
 * 内部资料「登录后可看」（Cloudflare Pages Functions · /api/private-asset?name=<文件名>）
 *
 * 资本架构沙盘 / 启动成本模型 / 合伙人命理中心 属内部资料（股权架构、11 位具名人员及家属生辰八字），
 * 2026-09-29 已从 ERP 公开目录迁入 admin/public/governance-assets/erp-embeds/（构建后剔除，公开 dist 里没有）。
 * 线上改由该端点在**服务端**校验 /api/admin-session 下发的超管会话 Cookie 后返回内容；
 * 文件内容以文本模块打进 Function 包（functions/api/private-asset.js import），不经过任何公开静态路径。
 *
 * 判定顺序（路由文件负责第 1 步）：统一闸 guardAdminRequest（来源 403 → 未配置口令 503 → 无/过期/伪造会话 401）
 * → 方法 → 白名单。先鉴权再查白名单：未登录时不论文件名是否存在一律 401，不泄露白名单。
 */

/** 白名单：只认精确文件名（数组成员比对，不做路径拼接，无目录穿越面） */
export const PRIVATE_ASSET_NAMES = Object.freeze([
  'shanhai-capital-architecture-sandbox.html',
  'shanhai-studio-startup-cost-model.html',
  'partner-destiny-center.html',
])

export const PRIVATE_ASSET_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  Vary: 'Cookie',
})

/** 拒绝类响应同样带 no-store / noindex，避免 CDN 或浏览器缓存 401 页、被收录 */
export function privateJson(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...PRIVATE_ASSET_HEADERS },
  })
}

/**
 * 已过闸之后的处理：方法 + 白名单 + 返回内容。
 * @param {Request} request
 * @param {Record<string, string>} assets 文件名 → 内容（由路由文件注入）
 */
export function servePrivateAsset(request, assets = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return privateJson({ success: false, msg: '仅支持 GET/HEAD' }, 405)
  }
  const name = new URL(request.url).searchParams.get('name') || ''
  if (!PRIVATE_ASSET_NAMES.includes(name) || typeof assets[name] !== 'string') {
    return privateJson({ success: false, code: 'NOT_FOUND', msg: '资料不存在或不在白名单内' }, 404)
  }
  return new Response(request.method === 'HEAD' ? null : assets[name], {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...PRIVATE_ASSET_HEADERS },
  })
}
