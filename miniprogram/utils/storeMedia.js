/**
 * 门店模块图片：legacy 路径归一化 + cloud:// 转临时 HTTPS
 */
const { cdnPath } = require('../config/cdn')

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

function normalizeStoreImageList(list) {
  if (!Array.isArray(list)) return []
  return list.map(normalizeStoreImageUrl).filter(Boolean)
}

const _storeUrlMem = Object.create(null)
const STORE_URL_TTL = 50 * 60 * 1000

async function batchResolveCloudUrls(fileIds) {
  const urlMap = {}
  const unique = [...new Set((fileIds || []).filter((id) => id && String(id).startsWith('cloud://')))]
  if (!unique.length || !wx.cloud) return urlMap

  const now = Date.now()
  const miss = []
  unique.forEach((id) => {
    const hit = _storeUrlMem[id]
    if (hit && hit.url && now - hit.at < STORE_URL_TTL) {
      urlMap[id] = hit.url
    } else {
      miss.push(id)
    }
  })
  if (!miss.length) return urlMap

  try {
    const res = await wx.cloud.callFunction({
      name: 'getStoreMediaUrls',
      data: { fileList: miss }
    })
    if (res.result && res.result.urlMap) {
      Object.keys(res.result.urlMap).forEach((id) => {
        const url = res.result.urlMap[id]
        if (url) {
          urlMap[id] = url
          _storeUrlMem[id] = { url, at: now }
        }
      })
    }
  } catch (e) {
    console.warn('getStoreMediaUrls cloud function failed, fallback to getTempFileURL', e)
    try {
      const { batchTempFileURLs } = require('./util')
      const mapped = await batchTempFileURLs(miss.filter((id) => !urlMap[id]))
      Object.keys(mapped).forEach((id) => {
        urlMap[id] = mapped[id]
        _storeUrlMem[id] = { url: mapped[id], at: now }
      })
    } catch (err) {
      console.warn('batchTempFileURLs fallback failed', err)
    }
  }
  return urlMap
}

function pickDisplayUrl(fileId, urlMap) {
  if (!fileId) return ''
  if (fileId.startsWith('https://') || fileId.startsWith('http://')) return fileId
  if (fileId.startsWith('cloud://')) {
    return (urlMap && urlMap[fileId]) || fileId
  }
  return fileId
}

function collectStoreMediaIds(store) {
  const ids = []
  if (store && store.coverImage) ids.push(normalizeStoreImageUrl(store.coverImage))
  ;(store && store.zones || []).forEach((zone) => {
    if (zone.coverImage) ids.push(normalizeStoreImageUrl(zone.coverImage))
    normalizeStoreImageList(zone.images).forEach((img) => ids.push(img))
  })
  return ids.filter((id) => id.startsWith('cloud://'))
}

function applyResolvedUrls(store, urlMap) {
  if (!store) return store
  const cover = normalizeStoreImageUrl(store.coverImage)
  return {
    ...store,
    coverImage: pickDisplayUrl(cover, urlMap),
    zones: (store.zones || []).map((zone) => {
      const zCover = normalizeStoreImageUrl(zone.coverImage)
      return {
        ...zone,
        coverImage: pickDisplayUrl(zCover, urlMap),
        images: normalizeStoreImageList(zone.images).map((img) => pickDisplayUrl(img, urlMap))
      }
    })
  }
}

async function hydrateStoreMedia(store) {
  if (!store) return store
  const normalized = applyResolvedUrls(store, {})
  const urlMap = await batchResolveCloudUrls(collectStoreMediaIds(normalized))
  return applyResolvedUrls(normalized, urlMap)
}

async function hydrateStoresMedia(stores) {
  if (!Array.isArray(stores) || !stores.length) return stores || []
  const normalized = stores.map((s) => applyResolvedUrls(s, {}))
  const allIds = []
  normalized.forEach((s) => allIds.push(...collectStoreMediaIds(s)))
  const urlMap = await batchResolveCloudUrls(allIds)
  return normalized.map((s) => applyResolvedUrls(s, urlMap))
}

async function hydrateImageList(urls) {
  const normalized = normalizeStoreImageList(urls)
  const urlMap = await batchResolveCloudUrls(normalized)
  return normalized.map((img) => pickDisplayUrl(img, urlMap))
}

async function hydrateZoneMedia(zone) {
  if (!zone) return zone
  const cover = normalizeStoreImageUrl(zone.coverImage)
  const images = normalizeStoreImageList(zone.images)
  const urlMap = await batchResolveCloudUrls([cover, ...images].filter(Boolean))
  return {
    ...zone,
    coverImage: pickDisplayUrl(cover, urlMap),
    images: images.map((img) => pickDisplayUrl(img, urlMap))
  }
}

module.exports = {
  normalizeStoreImageUrl,
  normalizeStoreImageList,
  batchResolveCloudUrls,
  hydrateStoreMedia,
  hydrateStoresMedia,
  hydrateImageList,
  hydrateZoneMedia
}
