const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { cdnPath } = require('./cdn')

const DEFAULT_STORES = require('./storeSeed').DEFAULT_STORES
const DEFAULT_ZONES = require('./storeSeed').DEFAULT_ZONES

function normalizeStoreImageUrl(url) {
  if (!url || typeof url !== 'string') return ''
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('cloud://') || trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed
  }
  const withoutLeading = trimmed.replace(/^\//, '')
  if (withoutLeading.startsWith('assets/stores/')) {
    return cdnPath(withoutLeading.replace(/^assets\/stores\//, 'stores/'))
  }
  if (withoutLeading.startsWith('stores/')) {
    return cdnPath(withoutLeading)
  }
  return trimmed
}

function normalizeStoreRecord(store) {
  const seed = DEFAULT_STORES.find((s) => s.storeId === store.storeId)
  return {
    ...store,
    coverImage: normalizeStoreImageUrl(store.coverImage) || (seed && seed.coverImage) || ''
  }
}

function normalizeZoneRecord(zone) {
  const seed = DEFAULT_ZONES.find((z) => z.zoneId === zone.zoneId)
  const images = Array.isArray(zone.images)
    ? zone.images.map(normalizeStoreImageUrl).filter(Boolean)
    : []
  return {
    ...zone,
    coverImage: normalizeStoreImageUrl(zone.coverImage) || (seed && seed.coverImage) || '',
    images: images.length ? images : ((seed && seed.images) || [])
  }
}

function collectCloudFileIds(stores, zones) {
  const ids = new Set()
  stores.forEach((s) => {
    if (s.coverImage && s.coverImage.startsWith('cloud://')) ids.add(s.coverImage)
  })
  zones.forEach((z) => {
    if (z.coverImage && z.coverImage.startsWith('cloud://')) ids.add(z.coverImage)
    ;(z.images || []).forEach((img) => {
      if (img && img.startsWith('cloud://')) ids.add(img)
    })
  })
  return [...ids]
}

async function resolveMediaUrls(stores, zones) {
  const fileList = collectCloudFileIds(stores, zones)
  if (!fileList.length) return { stores, zones }

  const urlMap = {}
  for (let i = 0; i < fileList.length; i += 50) {
    const chunk = fileList.slice(i, i + 50)
    try {
      const res = await cloud.getTempFileURL({ fileList: chunk })
      ;(res.fileList || []).forEach((item) => {
        if (item.fileID && item.tempFileURL) urlMap[item.fileID] = item.tempFileURL
      })
    } catch (e) {
      console.warn('getStoreConfig resolveMediaUrls', e.message)
    }
  }

  const mapUrl = (url) => (url && url.startsWith('cloud://') && urlMap[url]) ? urlMap[url] : url
  return {
    stores: stores.map((s) => ({ ...s, coverImage: mapUrl(s.coverImage) })),
    zones: zones.map((z) => ({
      ...z,
      coverImage: mapUrl(z.coverImage),
      images: (z.images || []).map(mapUrl)
    }))
  }
}

exports.main = async () => {
  let stores = DEFAULT_STORES
  let zones = DEFAULT_ZONES
  try {
    const storeRes = await db.collection('stores').where({ status: 'active' }).orderBy('sort', 'asc').get()
    if (storeRes.data && storeRes.data.length) stores = storeRes.data.map(normalizeStoreRecord)
    const zoneRes = await db.collection('store_zones').where({ status: 'active' }).orderBy('sort', 'asc').get()
    if (zoneRes.data && zoneRes.data.length) zones = zoneRes.data.map(normalizeZoneRecord)
  } catch (e) {
    console.warn('getStoreConfig read failed:', e.message)
  }

  const resolved = await resolveMediaUrls(stores, zones)
  return { success: true, stores: resolved.stores, zones: resolved.zones }
}
