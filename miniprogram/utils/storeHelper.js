const {
  DEFAULT_STORE_ID,
  DEFAULT_STORES,
  DEFAULT_ZONES,
  STORE_SERVICES
} = require('./storeDefaults')
const { normalizeStoreImageUrl, normalizeStoreImageList } = require('./storeMedia')
const { displayStoreName } = require('./storeName')
const { getCachedStores } = require('./storeCatalog')

const PREFERRED_STORE_KEY = 'preferredStoreId'

const CATEGORY_COLORS = {
  INSECTA: '#52B788',
  MINERALS: '#7B68AE',
  PLANTAE: '#6DA34D',
  MARINE: '#5B8FB9',
  GIFT: '#C4A76C',
  ATELIER: '#C4A76C',
  FRAMING: '#8B6F47',
  WORKSHOP: '#C4A76C'
}

function getPreferredStoreId() {
  try {
    const id = wx.getStorageSync(PREFERRED_STORE_KEY)
    if (id && DEFAULT_STORES.some((s) => s.storeId === id)) return id
  } catch (e) {}
  return DEFAULT_STORE_ID
}

function setPreferredStoreId(storeId) {
  try {
    wx.setStorageSync(PREFERRED_STORE_KEY, storeId)
  } catch (e) {}
}

function findStore(storeId) {
  const catalog = getCachedStores()
  const fromCatalog = catalog.find((s) => s.storeId === storeId)
  if (fromCatalog) return fromCatalog
  return DEFAULT_STORES.find((s) => s.storeId === storeId) || DEFAULT_STORES[0]
}

function getDefaultStore() {
  return findStore(DEFAULT_STORE_ID)
}

function getWorkshopStore() {
  const catalog = getCachedStores()
  return catalog.find((s) => s.role === 'workshop') || DEFAULT_STORES.find((s) => s.role === 'workshop') || DEFAULT_STORES[1]
}

function getZonesForStore(storeId) {
  return DEFAULT_ZONES.filter((z) => z.storeId === storeId).sort((a, b) => a.sort - b.sort)
}

function getServicesForStore(store) {
  if (!store) return []
  return STORE_SERVICES.filter((s) => s.storeRoles.includes(store.role))
}

function formatHours(hours) {
  if (!hours) return ''
  const note = hours.note ? ` · ${hours.note}` : ''
  return `${hours.open} – ${hours.close}${note}`
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null
  const parts = timeStr.split(':').map(Number)
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null
  return parts[0] * 60 + parts[1]
}

function getTodayDateStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function closedReasonLabel(reason) {
  if (reason === 'weekend') return '周末店休'
  return '今日店休'
}

function mergeWalkingGuide(store, stores) {
  if (!store) return null
  const list = (stores && stores.length) ? stores : getCachedStores()
  const seed = DEFAULT_STORES.find((s) => s.storeId === store.storeId)
  const guide = store.walkingGuide || (seed && seed.walkingGuide)
  if (!guide) return null
  const peer = list.find((s) => s.storeId === guide.peerStoreId)
    || DEFAULT_STORES.find((s) => s.storeId === guide.peerStoreId)
  const peerName = displayStoreName(peer)
  const goingDown = store.role !== 'workshop'
  const headline = peerName && peerName !== '门店'
    ? `${goingDown ? '下楼到' : '上山到'}${peerName} · 步行约 5 分钟`
    : (guide.headline || '')
  return {
    ...guide,
    headline,
    peerName,
    peerLocation: (peer && (peer.locationLabel || peer.floor)) || ''
  }
}

function getOpenStatus(hours) {
  if (!hours || !hours.open || !hours.close) {
    return { isOpen: true, label: '营业中', statusClass: 'open' }
  }
  const openMins = parseTimeToMinutes(hours.open)
  const closeMins = parseTimeToMinutes(hours.close)
  if (openMins == null || closeMins == null) {
    return { isOpen: true, label: '营业中', statusClass: 'open' }
  }
  const now = new Date()
  const mins = now.getHours() * 60 + now.getMinutes()
  const isOpen = mins >= openMins && mins < closeMins
  return {
    isOpen,
    label: isOpen ? '营业中' : '已打烊',
    statusClass: isOpen ? 'open' : 'closed'
  }
}

function enrichZone(zone) {
  if (!zone) return null
  const seed = DEFAULT_ZONES.find((z) => z.zoneId === zone.zoneId)
  const coverFromDb = normalizeStoreImageUrl(zone.coverImage)
  const imagesFromDb = normalizeStoreImageList(zone.images)
  return {
    ...zone,
    coverImage: coverFromDb || (seed && seed.coverImage) || '',
    images: imagesFromDb.length ? imagesFromDb : normalizeStoreImageList((seed && seed.images) || []),
    longDesc: zone.longDesc || (seed && seed.longDesc) || '',
    featuredSpecies: zone.featuredSpecies || (seed && seed.featuredSpecies) || [],
    relatedProductIds: zone.relatedProductIds || (seed && seed.relatedProductIds) || [],
    relatedWikiIds: zone.relatedWikiIds || (seed && seed.relatedWikiIds) || [],
    color: CATEGORY_COLORS[zone.categoryTag] || '#C4A76C'
  }
}

function enrichStore(store) {
  if (!store) return null
  const seed = DEFAULT_STORES.find((s) => s.storeId === store.storeId)
  const openStatus = getOpenStatus(store.hours)
  const visitTips = (store.visitTips && store.visitTips.length)
    ? store.visitTips
    : ((seed && seed.visitTips) || [])
  const mapMarkers = [{
    id: 1,
    latitude: store.latitude,
    longitude: store.longitude,
    title: displayStoreName(store),
    width: 24,
    height: 24
  }]
  return {
    ...store,
    name: displayStoreName(store),
    coverImage: normalizeStoreImageUrl(store.coverImage) || (seed && seed.coverImage) || '',
    hoursText: formatHours(store.hours),
    openStatus,
    visitTips,
    mapMarkers,
    zones: getZonesForStore(store.storeId).map(enrichZone),
    services: getServicesForStore(store)
  }
}

module.exports = {
  PREFERRED_STORE_KEY,
  getPreferredStoreId,
  setPreferredStoreId,
  findStore,
  getDefaultStore,
  getWorkshopStore,
  getZonesForStore,
  getServicesForStore,
  formatHours,
  getTodayDateStr,
  closedReasonLabel,
  mergeWalkingGuide,
  getOpenStatus,
  enrichZone,
  enrichStore,
  CATEGORY_COLORS
}
