/**
 * ERP 内嵌静态页 URL（与 vite base /admin/ 对齐）
 */
export function embeddedPageUrl(filename, options = {}) {
  const { embed = true, cacheBuster = Date.now() } = options
  const base = import.meta.env.BASE_URL || '/admin/'
  const normalized = String(base).endsWith('/') ? base : `${base}/`
  const params = new URLSearchParams()
  if (embed) params.set('embed', '1')
  if (cacheBuster) params.set('v', String(cacheBuster))
  const qs = params.toString()
  return `${normalized}${filename}${qs ? `?${qs}` : ''}`
}

export function standalonePageUrl(filename, cacheBuster = Date.now()) {
  return embeddedPageUrl(filename, { embed: false, cacheBuster })
}

/**
 * 内部资料类内嵌页（资本架构沙盘 / 启动成本模型 / 合伙人命理 / 合规附件）所在目录。
 * governance-assets 由 scripts/build-admin.mjs 在构建后剔除，任何构建产物里都没有它，
 * 只有 dev 服务器（npm run dev:admin）能直接读到 —— 见 docs/全面审计_2026-09-17/README.md A1。
 * 线上改由 Pages Function /api/private-asset 校验超管会话 Cookie 后返回（functions/api/private-asset.js）。
 */
export const INTERNAL_EMBED_DIR = 'governance-assets/erp-embeds'

/** dev 服务器直读本地文件；线上一律走 /api/private-asset */
export const internalEmbedsAvailable = Boolean(import.meta.env.DEV)

/** 站点根路径（不拼 BASE_URL，同 /api/admin-session） */
export const PRIVATE_ASSET_API = '/api/private-asset'

export const INTERNAL_EMBED_UNAVAILABLE_TIP =
  '本页内容属公司内部资料，仅在 ERP 以最高管理权限口令登录后可看（不在公开静态目录中）。' +
  '当前未检测到有效的管理会话（未登录或已过期）：请退出后重新输入管理口令登录。'

export function internalEmbedPath(filename) {
  return `${INTERNAL_EMBED_DIR}/${filename}`
}

/** 内部资料页地址：dev → 本地 governance-assets；线上 → /api/private-asset（会话 Cookie 随同源请求自动携带） */
export function internalEmbedUrl(filename, options = {}) {
  const { embed = true, cacheBuster = Date.now() } = options
  if (internalEmbedsAvailable) return embeddedPageUrl(internalEmbedPath(filename), { embed, cacheBuster })
  const params = new URLSearchParams({ name: filename })
  if (embed) params.set('embed', '1')
  if (cacheBuster) params.set('v', String(cacheBuster))
  return `${PRIVATE_ASSET_API}?${params.toString()}`
}

/**
 * 挂 iframe 前先确认有权限：未登录时 iframe 里只会显示一段 401 JSON，不如直接给说明。
 * @returns {Promise<{ ok: boolean, msg?: string }>}
 */
export async function checkInternalEmbedAccess(filename) {
  if (internalEmbedsAvailable) return { ok: true }
  try {
    const res = await fetch(`${PRIVATE_ASSET_API}?name=${encodeURIComponent(filename)}`, {
      method: 'HEAD',
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (res.ok) return { ok: true }
    if (res.status === 401) return { ok: false, msg: INTERNAL_EMBED_UNAVAILABLE_TIP }
    return { ok: false, msg: `内部资料接口暂不可用（HTTP ${res.status}），请稍后重试或联系维护者。` }
  } catch {
    return { ok: false, msg: '无法连接内部资料接口，请检查网络后重试。' }
  }
}
