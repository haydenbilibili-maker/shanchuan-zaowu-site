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
 * 只有 dev 服务器（npm run dev:admin）能读到 —— 见 docs/全面审计_2026-09-17/README.md A1。
 */
export const INTERNAL_EMBED_DIR = 'governance-assets/erp-embeds'

export const internalEmbedsAvailable = Boolean(import.meta.env.DEV)

export const INTERNAL_EMBED_UNAVAILABLE_TIP =
  '本页内容属公司内部资料，已从公开部署中移除（与「公司治理」资料库同一口径）。' +
  '请在本地 / 私有环境（npm run dev:admin）打开；公开站点上无法加载属预期行为，不是数据丢失。'

export function internalEmbedPath(filename) {
  return `${INTERNAL_EMBED_DIR}/${filename}`
}
