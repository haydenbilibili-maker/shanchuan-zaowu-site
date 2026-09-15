const { DEFAULT_STORES } = require('./storeDefaults')
const { displayStoreName } = require('./storeName')
const { swr, peekCache, setCache, invalidate, TTL, STALE_WINDOW } = require('./cache')

const CACHE_KEY = 'STORE_CATALOG'

let cachedStores = null
let cachedZones = null

function mapStoreOptions(stores) {
  return (stores || []).map((s) => ({
    storeId: s.storeId,
    name: displayStoreName(s),
    locationLabel: s.locationLabel || s.floor || '',
    role: s.role || ''
  }))
}

function applyMemory(stores, zones) {
  if (stores && stores.length) cachedStores = stores
  if (zones) cachedZones = zones
}

function hydrateMemoryFromDisk() {
  if (cachedStores && cachedStores.length) return
  const peeked = peekCache(CACHE_KEY, { staleMs: STALE_WINDOW.STORE })
  if (peeked && peeked.data && peeked.data.stores && peeked.data.stores.length) {
    applyMemory(peeked.data.stores, peeked.data.zones || [])
  }
}

async function fetchFromCloud() {
  const res = await wx.cloud.callFunction({ name: 'getStoreConfig' })
  const list = res && res.result && res.result.stores
  const zones = (res && res.result && res.result.zones) || []
  if (list && list.length) {
    return { stores: list, zones }
  }
  return { stores: DEFAULT_STORES, zones: [] }
}

/**
 * @param {boolean|{{ force?: boolean, revalidate?: boolean, onUpdate?: Function }}} forceOrOpts
 */
async function fetchStoreCatalog(forceOrOpts) {
  const opts = typeof forceOrOpts === 'boolean'
    ? { force: forceOrOpts }
    : (forceOrOpts || {})

  hydrateMemoryFromDisk()
  if (cachedStores && cachedStores.length && !opts.force && !opts.revalidate) {
    const peeked = peekCache(CACHE_KEY, { staleMs: STALE_WINDOW.STORE })
    if (peeked && peeked.fresh) return cachedStores
  }

  try {
    const payload = await swr(CACHE_KEY, fetchFromCloud, {
      expiry: TTL.STORE,
      staleMs: STALE_WINDOW.STORE,
      force: !!opts.force,
      revalidate: !!opts.revalidate,
      onUpdate: (data, meta) => {
        if (data && data.stores && data.stores.length) {
          applyMemory(data.stores, data.zones || [])
        }
        if (typeof opts.onUpdate === 'function') opts.onUpdate(data, meta)
      }
    })
    if (payload && payload.stores && payload.stores.length) {
      applyMemory(payload.stores, payload.zones || [])
      return payload.stores
    }
  } catch (e) {
    console.warn('fetchStoreCatalog', e)
  }

  if (cachedStores && cachedStores.length) return cachedStores
  applyMemory(DEFAULT_STORES, [])
  setCache(CACHE_KEY, { stores: DEFAULT_STORES, zones: [] }, TTL.STORE)
  return cachedStores
}

function getCachedStores() {
  hydrateMemoryFromDisk()
  return (cachedStores && cachedStores.length) ? cachedStores : DEFAULT_STORES
}

function getCachedZones() {
  hydrateMemoryFromDisk()
  return cachedZones || []
}

/** 完整门店配置（含 zones），供门店页水合 */
function getCachedStoreConfig() {
  hydrateMemoryFromDisk()
  const peeked = peekCache(CACHE_KEY, { staleMs: STALE_WINDOW.STORE })
  if (peeked && peeked.data && peeked.data.stores && peeked.data.stores.length) {
    return {
      stores: peeked.data.stores,
      zones: peeked.data.zones || [],
      fresh: peeked.fresh,
      fromCache: true
    }
  }
  if (cachedStores && cachedStores.length) {
    return { stores: cachedStores, zones: cachedZones || [], fresh: false, fromCache: true }
  }
  return null
}

function findCatalogStore(storeId, stores) {
  const list = stores && stores.length ? stores : getCachedStores()
  if (storeId) {
    const matched = list.find((s) => s.storeId === storeId)
    if (matched) return matched
  }
  return list.find((s) => s.isDefault) || list[0] || null
}

function findWorkshopStore(stores) {
  const list = stores && stores.length ? stores : getCachedStores()
  return list.find((s) => s.role === 'workshop' || s.storeId === 'store_xingchen') || list[1] || null
}

function invalidateStoreCatalog() {
  cachedStores = null
  cachedZones = null
  invalidate(CACHE_KEY)
}

module.exports = {
  fetchStoreCatalog,
  getCachedStores,
  getCachedZones,
  getCachedStoreConfig,
  findCatalogStore,
  findWorkshopStore,
  mapStoreOptions,
  invalidateStoreCatalog
}
