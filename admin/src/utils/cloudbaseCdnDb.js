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
const CDN_LOAD_TIMEOUT_MS = 12000
const AUTH_TIMEOUT_MS = 15000

export function isCloudbasePromiseBug(err) {
  const msg = err?.message || String(err)
  return msg.includes("setting 'promise'") || msg.includes('setting "promise"')
}

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} 超时（${Math.round(ms / 1000)}s）。请检查网络或 CloudBase 匿名登录/安全域名。`)),
      ms,
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** 确保 CDN SDK 可用（dev 热更新后 __cloudbaseCDN 可能丢失） */
async function ensureCdnSdk() {
  if (window.__cloudbaseCDN?.init) {
    return window.__cloudbaseCDN
  }

  // index.html 异步预载：有结果（含失败）后继续，不无限等待
  if (window.__cloudbaseCDNReady) {
    try {
      await withTimeout(window.__cloudbaseCDNReady, CDN_LOAD_TIMEOUT_MS, 'CloudBase CDN 预加载')
    } catch (e) {
      console.warn('[cloudbaseCdnDb]', e?.message || e)
    }
    if (window.__cloudbaseCDN?.init) return window.__cloudbaseCDN
    if (window.cloudbase?.init) {
      window.__cloudbaseCDN = window.cloudbase
      return window.__cloudbaseCDN
    }
  }

  const existing = document.querySelector(`script[src="${CDN_URL}"]`)
  if (existing && window.cloudbase?.init) {
    window.__cloudbaseCDN = window.cloudbase
    return window.__cloudbaseCDN
  }

  await withTimeout(
    new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = CDN_URL
      script.async = true
      script.onload = () => {
        window.__cloudbaseCDN = window.cloudbase
        resolve()
      }
      script.onerror = () => reject(new Error('CloudBase CDN 脚本加载失败，请检查网络'))
      document.head.appendChild(script)
    }),
    CDN_LOAD_TIMEOUT_MS,
    'CloudBase CDN 脚本加载',
  )

  if (!window.__cloudbaseCDN?.init) {
    throw new Error('CloudBase CDN SDK 未就绪')
  }
  return window.__cloudbaseCDN
}

export async function getCdnDatabase() {
  if (db) return db
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const cloudbase = await ensureCdnSdk()
        const app = cloudbase.init({ env: ENV_ID, region: REGION, persistence: 'local' })
        const auth = app.auth()
        try {
          const state = await withTimeout(
            Promise.resolve(auth.getLoginState()),
            AUTH_TIMEOUT_MS,
            'CloudBase 登录状态检查',
          )
          if (!state) {
            await withTimeout(
              Promise.resolve(auth.signInAnonymously()),
              AUTH_TIMEOUT_MS,
              'CloudBase 匿名登录',
            )
          }
        } catch (authErr) {
          // 二次尝试；仍失败则抛出，由调用方展示错误（禁止无限挂起）
          try {
            await withTimeout(
              Promise.resolve(auth.signInAnonymously()),
              AUTH_TIMEOUT_MS,
              'CloudBase 匿名登录重试',
            )
          } catch {
            throw authErr
          }
        }
        cdnApp = app
        db = app.database()
        return db
      } catch (err) {
        initPromise = null
        db = null
        cdnApp = null
        throw err
      }
    })()
  }
  return initPromise
}

/** 浏览器匿名 callFunction 常被拒；管理类函数走 /api/cloud-fn 服务端代理 */
const ADMIN_PROXY_FUNCTIONS = new Set([
  'manageInvoiceRequests',
  'manageHonoraryCurators',
  'manageMemberLevelAdjust',
  'manageStaff',
  'manageProducts',
  'bindPlatformOrder',
  'claimStoreReceipt',
  'managerShipOrder',
  'refundOrder',
  'getShippingRules',
  'manageStoredValue',
  'moderateComment',
  'assistProductCopy',
  'seedCategories',
  'manageGift',
])

function cloudFnProxyUrls() {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
  const urls = ['/api/cloud-fn']
  if (base && base !== '/') urls.push(`${base}/api/cloud-fn`)
  return [...new Set(urls)]
}

function proxyUnavailableMessage(detail = '') {
  const hint =
    'Admin 管理类云函数须经 /api/cloud-fn 代理（勿浏览器匿名直调）。' +
    '本地：admin/.env 配 TCB_SECRET_ID/TCB_SECRET_KEY 与 ADMIN_OPS_KEY 后重启 npm run dev:admin；' +
    '线上：提交并部署仓库 functions/api/cloud-fn.js，且 Cloudflare Pages 配置同名环境变量。' +
    '飞书同步走 /api/feishu-sync，与本代理无关。'
  return detail ? `${detail} ${hint}` : hint
}

async function callViaCloudFnProxy(name, data = {}) {
  const urls = cloudFnProxyUrls()
  let lastErr
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, data }),
      })
      const ctype = res.headers.get('content-type') || ''
      if (ctype.includes('text/html')) {
        lastErr = new Error(
          proxyUnavailableMessage(`${url} 未部署云函数代理（返回了 HTML，常见于 Pages Function 未随站点发布）。`),
        )
        continue
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok && json.success !== false) {
        // 线上无 Function 时常见：GET→404 HTML，POST→405 空 body
        const statusHint =
          res.status === 404 || res.status === 405
            ? `${url} 代理未部署（HTTP ${res.status}）。`
            : `云函数代理 HTTP ${res.status}。`
        lastErr = new Error(proxyUnavailableMessage(statusHint))
        continue
      }
      // 代理已到达：业务失败原样返回，由调用方读 success/msg
      return json
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error(proxyUnavailableMessage('云函数代理不可用。'))
}

function formatFnError(err) {
  const code = err?.code || err?.error?.code || ''
  const msg = err?.msg || err?.message || err?.error?.message || (typeof err === 'string' ? err : JSON.stringify(err))
  const blob = `${code} ${msg}`
  // 仅匹配云开发权限/函数缺失码；避免把普通业务「不存在」误映射成笼统提示
  if (/PERMISSION_DENIED|FUNCTION_NOT_FOUND|ResourceNotFound\.Function|function not exist/i.test(blob)) {
    return proxyUnavailableMessage(
      `云函数「调用被拒或未部署」（${code || 'PERMISSION_DENIED'}）。`,
    )
  }
  if (isCloudbasePromiseBug({ message: msg })) {
    return "CloudBase CDN/SDK 异常（setting 'promise'）。请确认 index.html 已预加载 CDN SDK，且业务走 getCdnDatabase，而非 bundle 内 db。"
  }
  return msg
}

/** 管理类云函数走 HTTP 代理；其它走 CDN SDK（密钥在云函数环境变量） */
export async function callCdnFunction(name, data = {}) {
  if (ADMIN_PROXY_FUNCTIONS.has(name)) {
    return callViaCloudFnProxy(name, data)
  }
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

/**
 * limit 拉取（不用 orderBy，避免索引/SDK bug）
 * 匿名客户端单次常被截断为 20 条：用 skip 循环凑满请求量。
 */
export async function fetchCollectionLimit(collectionName, options = {}) {
  const { limit = 500, where = null, batchSize = 20 } = options
  const db = await getCdnDatabase()
  const pageSize = Math.min(Math.max(parseInt(batchSize, 10) || 20, 1), 100)
  const maxRows = Math.max(0, parseInt(limit, 10) || 0)
  if (!maxRows) return []

  const all = []
  let skip = 0
  while (all.length < maxRows) {
    let query = db.collection(collectionName)
    if (where) query = query.where(where)
    const take = Math.min(pageSize, maxRows - all.length)
    const res = await query.skip(skip).limit(take).get()
    const batch = res.data || []
    if (!batch.length) break
    all.push(...batch)
    skip += batch.length
    if (batch.length < take) break
  }
  return all
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
