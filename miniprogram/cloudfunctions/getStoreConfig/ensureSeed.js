/**
 * 把代码 seed 幂等写入 stores / store_zones，供 Admin「C端门店展区」与 getStoreConfig 共用。
 * 已有同 storeId / zoneId / 同名文档不重复插入；主店旧名「山海造物」会改成 seed.name。
 */
const { DEFAULT_STORES, DEFAULT_ZONES } = require('./storeSeed')

const LEGACY_MAIN_NAMES = ['山海造物', '山海造物主店']
const MAIN_STORE_IDS = ['store_shanhaizaowu', 'store_1780146782017_6w0okpr']

function errorText(err) {
  return [err && err.errCode, err && err.errMsg, err && err.message, String(err || '')]
    .filter(Boolean)
    .join(' ')
}

function isMissingCollectionError(err) {
  return /502005|DATABASE_COLLECTION_NOT_EXIST|collection not exist|not exist/i.test(errorText(err))
}

function isCollectionExistsError(err) {
  return /already exist|already exists|COLLECTION_EXIST|ResourceExist|-501001/i.test(errorText(err))
}

async function ensureCollection(db, name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    if (!isCollectionExistsError(err)) {
      console.warn('ensureCollection', name, errorText(err))
    }
  }
}

async function listAll(db, collection) {
  try {
    const res = await db.collection(collection).limit(100).get()
    return res.data || []
  } catch (e) {
    if (!isMissingCollectionError(e)) throw e
    await ensureCollection(db, collection)
    try {
      const res = await db.collection(collection).limit(100).get()
      return res.data || []
    } catch (e2) {
      return []
    }
  }
}

function isXingchenDoc(doc) {
  const name = String((doc && doc.name) || '')
  return (doc && doc.storeId === 'store_xingchen') || name.indexOf('星宸') !== -1
}

function shouldRenameMain(doc, seedName) {
  if (!doc || isXingchenDoc(doc)) return false
  const name = String(doc.name || '').trim()
  if (name === seedName) return false
  const id = String(doc.storeId || '')
  if (MAIN_STORE_IDS.indexOf(id) !== -1 && LEGACY_MAIN_NAMES.indexOf(name) !== -1) return true
  if (doc.role === 'main' && LEGACY_MAIN_NAMES.indexOf(name) !== -1) return true
  return false
}

async function addDoc(db, collection, data) {
  try {
    await db.collection(collection).add({ data })
  } catch (e) {
    if (!isMissingCollectionError(e)) throw e
    await ensureCollection(db, collection)
    await db.collection(collection).add({ data })
  }
}

async function ensureStoreDocuments(db) {
  const report = { stores: [], zones: [] }
  const storeRows = await listAll(db, 'stores')
  const byStoreId = {}
  const byName = {}
  storeRows.forEach((s) => {
    if (s && s.storeId) byStoreId[s.storeId] = s
    const n = String((s && s.name) || '').trim()
    if (n && !byName[n]) byName[n] = s
  })

  for (let i = 0; i < DEFAULT_STORES.length; i++) {
    const seed = DEFAULT_STORES[i]
    const found = byStoreId[seed.storeId] || byName[seed.name]
    if (found) {
      if (shouldRenameMain(found, seed.name) && found._id) {
        await db.collection('stores').doc(found._id).update({
          data: {
            name: seed.name,
            nameEn: seed.nameEn,
            intro: seed.intro,
            updatedAt: Date.now()
          }
        })
        report.stores.push({ storeId: seed.storeId, action: 'renamed', name: seed.name })
      } else {
        report.stores.push({
          storeId: found.storeId || seed.storeId,
          action: 'exists',
          name: found.name
        })
      }
      continue
    }
    await addDoc(db, 'stores', {
      ...seed,
      status: seed.status || 'active',
      createTime: Date.now(),
      updatedAt: Date.now()
    })
    report.stores.push({ storeId: seed.storeId, action: 'inserted', name: seed.name })
  }

  const zoneRows = await listAll(db, 'store_zones')
  const byZoneId = {}
  zoneRows.forEach((z) => {
    if (z && z.zoneId) byZoneId[z.zoneId] = z
  })
  for (let i = 0; i < DEFAULT_ZONES.length; i++) {
    const seed = DEFAULT_ZONES[i]
    if (byZoneId[seed.zoneId]) {
      report.zones.push({ zoneId: seed.zoneId, action: 'exists' })
      continue
    }
    await addDoc(db, 'store_zones', {
      ...seed,
      status: seed.status || 'active',
      createTime: Date.now(),
      updatedAt: Date.now()
    })
    report.zones.push({ zoneId: seed.zoneId, action: 'inserted' })
  }
  return report
}

module.exports = { ensureStoreDocuments }
