/**
 * 飞书多维表**服务端**读取（云函数版）。
 *
 * 为什么单独一份、不与 `functions/_lib/feishuBitable.mjs` 共用：
 * 那个文件是 **ESM（.mjs）**、跑在 Cloudflare Pages；云函数是 **CJS**、跑在 Nodejs16。
 * 模块系统不同 → 没法共享文件。因此这里是一份**刻意的精简移植**，
 * 只含服务端同步需要的读能力（换 token + 分页拉记录 + 列举字段），并保持：
 *   · 端点、分页大小（500）、`code !== 0` 即抛错 三点与 Pages 版一致；
 *   · **不打印任何凭据**（token 只用于 Authorization 头）。
 *
 * ⚠️ 运行时是 **Nodejs16.13**，**没有全局 `fetch`** —— 必须用内置 `https`。
 *    用 fetch 会在线上报 `fetch is not defined`，而本地 Node 22 跑得好好的。
 */
const https = require('https')

const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
const API = 'https://open.feishu.cn/open-apis/bitable/v1'
const DEFAULT_APP_TOKEN = 'WCs2bnIHsaty7vsjcnaczu0Wnod'

/** 极简 JSON 请求（Node16 无 fetch）。返回解析后的 JSON。 */
function requestJson (url, { method = 'GET', token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : ''
    const u = new URL(url)
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          token ? { Authorization: 'Bearer ' + token } : {},
          data ? { 'Content-Length': Buffer.byteLength(data) } : {}
        ),
        timeout: 15000
      },
      (res) => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { raw += c })
        res.on('end', () => {
          let json = {}
          try { json = JSON.parse(raw || '{}') } catch (e) { json = {} }
          resolve({ status: res.statusCode, json })
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('飞书请求超时')))
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

async function feishuJson (url, opts) {
  const { status, json } = await requestJson(url, opts)
  if (json.code !== 0) {
    throw new Error(json.msg || `飞书接口错误 ${json.code || status}`)
  }
  return json
}

function envCreds (env) {
  const e = env || {}
  const appId = e.FEISHU_APP_ID || process.env.FEISHU_APP_ID || ''
  const appSecret = e.FEISHU_APP_SECRET || process.env.FEISHU_APP_SECRET || ''
  const appToken = e.FEISHU_APP_TOKEN || process.env.FEISHU_APP_TOKEN || DEFAULT_APP_TOKEN
  return { appId, appSecret, appToken }
}

/** 凭据是否已配置（**只报有无，不回显值**） */
function credsStatus (env) {
  const { appId, appSecret, appToken } = envCreds(env)
  return {
    configured: !!(appId && appSecret),
    hasAppId: !!appId,
    hasAppSecret: !!appSecret,
    appTokenTail: appToken ? String(appToken).slice(-6) : ''
  }
}

async function getTenantToken (env) {
  const { appId, appSecret } = envCreds(env)
  if (!appId || !appSecret) {
    const err = new Error('云函数未配置 FEISHU_APP_ID / FEISHU_APP_SECRET')
    err.code = 'FEISHU_CREDS_MISSING'
    throw err
  }
  const json = await feishuJson(TOKEN_URL, { method: 'POST', body: { app_id: appId, app_secret: appSecret } })
  return json.tenant_access_token
}

/** 分页拉全表（page_size 上限 500，与 Pages 版一致） */
async function listAllRecords (tableId, env) {
  const token = await getTenantToken(env)
  const { appToken } = envCreds(env)
  const records = []
  let pageToken = ''
  do {
    const qs = new URLSearchParams({ page_size: '500' })
    if (pageToken) qs.set('page_token', pageToken)
    const json = await feishuJson(
      `${API}/apps/${appToken}/tables/${tableId}/records?${qs}`,
      { token }
    )
    records.push(...((json.data && json.data.items) || []))
    pageToken = json.data && json.data.has_more ? json.data.page_token : ''
  } while (pageToken)
  return records
}

/** 只读计数（用于「线上数据到底同没同步」的对比，不拉字段） */
async function countRecords (tableId, env) {
  const rows = await listAllRecords(tableId, env)
  return rows.length
}

module.exports = { credsStatus, getTenantToken, listAllRecords, countRecords, DEFAULT_APP_TOKEN }
