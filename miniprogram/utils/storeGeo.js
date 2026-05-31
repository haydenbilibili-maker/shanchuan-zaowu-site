/** 门店地理：距离计算与就近推荐 */
const { DEFAULT_STORES } = require('./storeDefaults')

const EARTH_RADIUS_KM = 6371

function toRad(deg) {
  return (deg * Math.PI) / 180
}

function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v == null || Number.isNaN(Number(v)))) return Infinity
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function findNearestStore(latitude, longitude, stores) {
  const list = stores && stores.length ? stores : DEFAULT_STORES
  let best = null
  let bestKm = Infinity
  list.forEach((s) => {
    const km = haversineKm(latitude, longitude, s.latitude, s.longitude)
    if (km < bestKm) {
      bestKm = km
      best = s
    }
  })
  if (!best) return null
  return { store: best, distanceKm: bestKm }
}

function formatDistance(km) {
  if (km == null || !Number.isFinite(km)) return ''
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1)} km`
}

module.exports = { haversineKm, findNearestStore, formatDistance }
