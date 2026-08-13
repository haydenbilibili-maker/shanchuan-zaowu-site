/**
 * CloudBase 数据库（CDN SDK）
 * bundle 内 @cloudbase/js-sdk 的 db.get() 存在 setting 'promise' bug；
 * 财务 / 店长账本同步统一走 index.html 预加载的 CDN SDK。
 */
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const REGION = 'ap-shanghai'

let db = null
let cdnApp = null
let initPromise = null

export { ENV_ID, REGION }

const CDN_URL = 'https://static.cloudbase.net/cloudbase-js-sdk/2.11.0/cloudbase.full.js'

/** 确保 CDN SDK 可用（dev 热更新后 __cloudbaseCDN 可能丢失） */
async function ensureCdnSdk() {
  if (window.__cloudbaseCDN?.init) {
    return window.__cloudbaseCDN
  }
  const existing = document.querySelector(`script[src="${CDN_URL}"]`)
  if (existing && window.cloudbase?.init) {
    window.__cloudbaseCDN = window.cloudbase
    return window.__cloudbaseCDN
  }
  await new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CDN_URL
    script.async = false
    script.onload = () => {
      window.__cloudbaseCDN = window.cloudbase
      resolve()
    }
    script.onerror = () => reject(new Error('CloudBase CDN 脚本加载失败，请检查网络'))
    document.head.appendChild(script)
  })
  if (!window.__cloudbaseCDN?.init) {
    throw new Error('CloudBase CDN SDK 未就绪')
  }
  return window.__cloudbaseCDN
}

export async function getCdnDatabase() {
  if (db) return db
  if (!initPromise) {
    initPromise = (async () => {
      const cloudbase = await ensureCdnSdk()
      const app = cloudbase.init({ env: ENV_ID, region: REGION, persistence: 'local' })
      const auth = app.auth()
      try {
        if (!(await auth.getLoginState())) {
          await auth.signInAnonymously()
        }
      } catch {
        await auth.signInAnonymously()
      }
      cdnApp = app
      db = app.database()
      return db
    })()
  }
  return initPromise
}

function formatFnError(err) {
  const code = err?.code || err?.error?.code || ''
  const msg = err?.msg || err?.message || err?.error?.message || (typeof err === 'string' ? err : JSON.stringify(err))
  const blob = `${code} ${msg}`
  if (/PERMISSION_DENIED|FUNCTION_NOT_FOUND|not found|不存在/i.test(blob)) {
    return '云函数无权调用或尚未部署。请用微信开发者工具上传 syncFeishuBitable，并在云函数环境变量填写 FEISHU_APP_ID / FEISHU_APP_SECRET（不要写进 admin/.env）。'
  }
  return msg
}

/** 与数据库同一 CDN SDK 实例调用云函数（密钥在云函数环境变量） */
export async function callCdnFunction(name, data = {}) {
  await getCdnDatabase()
  if (!cdnApp || typeof cdnApp.callFunction !== 'function') {
    throw new Error('CloudBase SDK 不支持 callFunction')
  }
  try {
    const res = await cdnApp.callFunction({ name, data })
    return res?.result ?? res
  } catch (err) {
    throw new Error(formatFnError(err))
  }
}

export function isCloudbasePromiseBug(err) {
  const msg = err?.message || String(err)
  return msg.includes("setting 'promise'") || msg.includes('setting "promise"')
}

/** limit 拉取（不用 orderBy，避免索引/SDK bug） */
export async function fetchCollectionLimit(collectionName, options = {}) {
  const { limit = 500, where = null } = options
  const db = await getCdnDatabase()
  let query = db.collection(collectionName)
  if (where) query = query.where(where)
  const res = await query.limit(limit).get()
  return res.data || []
}

export async function cdnAdd(collectionName, data) {
  const db = await getCdnDatabase()
  return db.collection(collectionName).add(data)
}

export async function cdnUpdate(collectionName, docId, data) {
  const db = await getCdnDatabase()
  return db.collection(collectionName).doc(docId).update(data)
}

export async function cdnRemove(collectionName, docId) {
  const db = await getCdnDatabase()
  return db.collection(collectionName).doc(docId).remove()
}

export async function cdnDocGet(collectionName, docId) {
  const db = await getCdnDatabase()
  const res = await db.collection(collectionName).doc(docId).get()
  const data = res?.data
  if (Array.isArray(data)) return data.length > 0 ? data[0] : null
  return data ?? null
}

export async function cdnSet(collectionName, docId, data) {
  const db = await getCdnDatabase()
  return db.collection(collectionName).doc(docId).set(data)
}

export async function fetchCollectionWhere(collectionName, where, limit = 500) {
  const db = await getCdnDatabase()
  const res = await db.collection(collectionName).where(where).limit(limit).get()
  return res.data || []
}

export async function cdnCount(collectionName, where = null) {
  const db = await getCdnDatabase()
  let query = db.collection(collectionName)
  if (where) query = query.where(where)
  const res = await query.count()
  return res.total || 0
}

/** 分页查询（单 where；排序字段可选） */
export async function cdnQueryPage(collectionName, options = {}) {
  const { where = null, orderField = null, direction = 'desc', skip = 0, limit = 20 } = options
  const db = await getCdnDatabase()
  let query = db.collection(collectionName)
  if (where && Object.keys(where).length) query = query.where(where)
  if (orderField) query = query.orderBy(orderField, direction)
  const res = await query.skip(skip).limit(limit).get()
  return res.data || []
}

/** 固定 docId upsert：先 update，失败则 add */
export async function cdnUpsertDoc(collectionName, docId, data) {
  try {
    await cdnUpdate(collectionName, docId, data)
  } catch {
    await cdnAdd(collectionName, {
      ...data,
      _id: docId,
      _createTime: data._createTime ?? Date.now(),
    })
  }
}

/** 集合仅一条配置时 upsert */
export async function cdnUpsertSingleton(collectionName, data) {
  const rows = await fetchCollectionLimit(collectionName, { limit: 1 })
  if (rows.length > 0) {
    await cdnUpdate(collectionName, rows[0]._id, data)
    return rows[0]._id
  }
  await cdnAdd(collectionName, {
    ...data,
    _createTime: data._createTime ?? Date.now(),
  })
}

/** where 匹配 upsert（如 type: 'behavior_types'） */
export async function cdnUpsertByWhere(collectionName, where, data) {
  const rows = await fetchCollectionWhere(collectionName, where, 1)
  if (rows.length > 0) {
    await cdnUpdate(collectionName, rows[0]._id, data)
    return rows[0]._id
  }
  await cdnAdd(collectionName, {
    ...data,
    _createTime: data._createTime ?? Date.now(),
  })
}

/** 分页拉全量，避免 limit(1000) 无排序漏掉近期记录 */
export async function fetchAllFromCollection(collectionName, options = {}) {
  const {
    orderField = 'date',
    direction = 'desc',
    pageSize = 100,
    maxRows = 5000,
    where = null,
  } = options
  const db = await getCdnDatabase()
  const all = []
  let skip = 0

  while (all.length < maxRows) {
    let query = db.collection(collectionName)
    if (where) query = query.where(where)
    if (orderField) query = query.orderBy(orderField, direction)
    const res = await query.skip(skip).limit(pageSize).get()
    const batch = res.data || []
    if (!batch.length) break
    all.push(...batch)
    if (batch.length < pageSize) break
    skip += pageSize
  }

  return all
}
