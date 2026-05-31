const cloud = require('wx-server-sdk')
const { DEFAULT_STORES, DEFAULT_ZONES } = require('./storeSeed')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function getAdminOpenids() {
  const env = process.env.MESSAGE_ADMIN_OPENIDS || ''
  return env.split(',').map((s) => s.trim()).filter(Boolean)
}

function isAdmin(openid) {
  const admins = getAdminOpenids()
  if (!admins.length) return true
  return admins.includes(openid)
}

const ALLOWED_STORE_FIELDS = [
  'name', 'nameEn', 'phone', 'intro', 'heroTagline', 'address', 'floor',
  'hours', 'visitTips', 'features', 'coverImage', 'status', 'sort'
]

const ALLOWED_ZONE_FIELDS = [
  'title', 'overline', 'desc', 'longDesc', 'coverImage', 'images',
  'categoryTag', 'sort', 'status', 'relatedProductIds', 'relatedWikiIds'
]

function pickFields(obj, allowed) {
  const out = {}
  allowed.forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k]
  })
  return out
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action } = event

  if (action === 'listPublic') {
    return listPublic()
  }

  if (!isAdmin(openid)) {
    return { success: false, msg: '无管理权限' }
  }

  switch (action) {
    case 'listStores':
      return listStores()
    case 'updateStore':
      return updateStore(event.storeId, event.data)
    case 'listZones':
      return listZones(event.storeId)
    case 'updateZone':
      return updateZone(event.zoneId, event.data)
    default:
      return { success: false, msg: '未知 action' }
  }
}

async function listPublic() {
  try {
    let stores = DEFAULT_STORES
    let zones = DEFAULT_ZONES
    const storeRes = await db.collection('stores').where({ status: 'active' }).orderBy('sort', 'asc').get()
    if (storeRes.data && storeRes.data.length) stores = storeRes.data
    const zoneRes = await db.collection('store_zones').where({ status: 'active' }).orderBy('sort', 'asc').get()
    if (zoneRes.data && zoneRes.data.length) zones = zoneRes.data
    return { success: true, stores, zones }
  } catch (e) {
    return { success: true, stores: DEFAULT_STORES, zones: DEFAULT_ZONES, fallback: true }
  }
}

async function listStores() {
  try {
    const res = await db.collection('stores').orderBy('sort', 'asc').get()
    const stores = res.data && res.data.length ? res.data : DEFAULT_STORES
    return { success: true, stores }
  } catch (e) {
    return { success: true, stores: DEFAULT_STORES, fallback: true }
  }
}

async function updateStore(storeId, data) {
  if (!storeId || !data) return { success: false, msg: '参数不完整' }
  const patch = pickFields(data, ALLOWED_STORE_FIELDS)
  patch.updatedAt = Date.now()
  try {
    const existing = await db.collection('stores').where({ storeId }).limit(1).get()
    if (existing.data && existing.data.length) {
      await db.collection('stores').doc(existing.data[0]._id).update({ data: patch })
    } else {
      const seed = DEFAULT_STORES.find((s) => s.storeId === storeId) || { storeId }
      await db.collection('stores').add({
        data: { ...seed, ...patch, storeId, status: patch.status || 'active' }
      })
    }
    return { success: true }
  } catch (e) {
    console.error('updateStore', e)
    return { success: false, msg: e.message || '保存失败' }
  }
}

async function listZones(storeId) {
  if (!storeId) return { success: false, msg: '缺少 storeId' }
  try {
    const res = await db.collection('store_zones').where({ storeId }).orderBy('sort', 'asc').get()
    const zones =
      res.data && res.data.length
        ? res.data
        : DEFAULT_ZONES.filter((z) => z.storeId === storeId)
    return { success: true, zones }
  } catch (e) {
    return {
      success: true,
      zones: DEFAULT_ZONES.filter((z) => z.storeId === storeId),
      fallback: true
    }
  }
}

async function updateZone(zoneId, data) {
  if (!zoneId || !data) return { success: false, msg: '参数不完整' }
  const patch = pickFields(data, ALLOWED_ZONE_FIELDS)
  patch.updatedAt = Date.now()
  try {
    const existing = await db.collection('store_zones').where({ zoneId }).limit(1).get()
    if (existing.data && existing.data.length) {
      await db.collection('store_zones').doc(existing.data[0]._id).update({ data: patch })
    } else {
      const seed = DEFAULT_ZONES.find((z) => z.zoneId === zoneId)
      if (!seed) return { success: false, msg: '未知分区' }
      await db.collection('store_zones').add({
        data: { ...seed, ...patch, zoneId, storeId: seed.storeId, status: patch.status || 'active' }
      })
    }
    return { success: true }
  } catch (e) {
    return { success: false, msg: e.message || '保存失败' }
  }
}
