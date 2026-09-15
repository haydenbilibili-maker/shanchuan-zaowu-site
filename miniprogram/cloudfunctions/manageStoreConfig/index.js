const cloud = require('wx-server-sdk')
const { DEFAULT_STORES, DEFAULT_ZONES } = require('./storeSeed')
const { ensureStoreDocuments } = require('./ensureSeed')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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

  // 唯一公开的只读动作
  if (action === 'listPublic') {
    return listPublic()
  }

  // 鉴权前置：此前 seedStores 在鉴权之前 return，任意用户可触发写入门店/展区文档
  const guard = await assertStaff(db, openid, { role: ROLE_MANAGER, permission: 'manageStoreConfig' })
  if (!guard.ok) {
    return { success: false, code: guard.code, msg: guard.msg }
  }

  if (action === 'seedStores') {
    try {
      const seed = await ensureStoreDocuments(db)
      const listed = await listPublic()
      return { success: true, seed, stores: listed.stores, zones: listed.zones }
    } catch (e) {
      return { success: false, msg: e.message || '写入门店失败' }
    }
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
    await ensureStoreDocuments(db)
  } catch (e) {
    console.warn('listPublic ensureSeed', e.message)
  }
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
    await ensureStoreDocuments(db)
  } catch (e) {
    console.warn('listStores ensureSeed', e.message)
  }
  try {
    const res = await db.collection('stores').orderBy('sort', 'asc').get()
    const cloudList = (res.data && res.data.length) ? res.data : []
    const byId = {}
    cloudList.forEach((s) => {
      if (s && s.storeId) byId[s.storeId] = s
    })
    const stores = DEFAULT_STORES.map((seed) => {
      const cloud = byId[seed.storeId]
      if (!cloud) return { ...seed }
      return {
        ...seed,
        ...cloud,
        hours: { ...(seed.hours || {}), ...(cloud.hours || {}) },
        features: (cloud.features && cloud.features.length) ? cloud.features : (seed.features || []),
        visitTips: (cloud.visitTips && cloud.visitTips.length) ? cloud.visitTips : (seed.visitTips || [])
      }
    })
    cloudList.forEach((s) => {
      if (s && s.storeId && !DEFAULT_STORES.some((d) => d.storeId === s.storeId)) {
        stores.push(s)
      }
    })
    stores.sort((a, b) => (a.sort || 99) - (b.sort || 99))
    return { success: true, stores, fallback: cloudList.length === 0 }
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
