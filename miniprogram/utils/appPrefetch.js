/**
 * 冷启动 / Tab 轻预取：并行拉高频只读接口，写入分层缓存。
 */

const { cleanExpiredCache, shouldRefresh } = require('./cache')

function safeRequire(path) {
  try {
    return require(path)
  } catch (e) {
    return null
  }
}

/**
 * App.onLaunch 后调用：不阻塞首屏，失败静默。
 */
function prefetchColdStart(app) {
  try {
    cleanExpiredCache()
  } catch (e) { /* ignore */ }

  const tasks = []

  const flagsMod = safeRequire('./contentDisplayFlags')
  if (flagsMod && flagsMod.fetchContentDisplayFlags) {
    tasks.push(flagsMod.fetchContentDisplayFlags({ revalidate: true }).catch(() => {}))
  }

  const catalogMod = safeRequire('./storeCatalog')
  if (catalogMod && catalogMod.fetchStoreCatalog) {
    tasks.push(catalogMod.fetchStoreCatalog({ revalidate: true }).catch(() => {}))
  }

  const sessionMod = safeRequire('./userSession')
  if (sessionMod && !sessionMod.isLocalLoggedOut() && sessionMod.ensureSession) {
    tasks.push(sessionMod.ensureSession(app).catch(() => {}))
  }

  return Promise.all(tasks).catch(() => {})
}

/**
 * 切 Tab 前轻预取（节流），避免冷页空白。
 * @param {'explore'|'category'|'atelier'|'cart'|'user'} tabKey
 */
function prefetchTab(tabKey) {
  if (!shouldRefresh(`tab_prefetch_${tabKey}`, 8000)) return

  if (tabKey === 'user') {
    const sessionMod = safeRequire('./userSession')
    if (sessionMod && !sessionMod.isLocalLoggedOut() && sessionMod.ensureSession) {
      sessionMod.ensureSession().catch(() => {})
    }
    return
  }

  if (tabKey === 'atelier' || tabKey === 'explore' || tabKey === 'category') {
    const flagsMod = safeRequire('./contentDisplayFlags')
    if (flagsMod && flagsMod.fetchContentDisplayFlags) {
      flagsMod.fetchContentDisplayFlags().catch(() => {})
    }
  }

  if (tabKey === 'explore') {
    const catalogMod = safeRequire('./storeCatalog')
    if (catalogMod && catalogMod.fetchStoreCatalog) {
      catalogMod.fetchStoreCatalog().catch(() => {})
    }
  }
}

module.exports = {
  prefetchColdStart,
  prefetchTab
}
