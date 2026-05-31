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
