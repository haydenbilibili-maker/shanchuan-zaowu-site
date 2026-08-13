const https = require('https')

const DEFAULT_APP_TOKEN = 'WCs2bnIHsaty7vsjcnaczu0Wnod'
const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
const API = 'https://open.feishu.cn/open-apis/bitable/v1'

function envToken() {
  return process.env.FEISHU_APP_TOKEN || DEFAULT_APP_TOKEN
}

function httpJson(url, { method = 'GET', token, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const payload = body ? JSON.stringify(body) : null
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload)
    const req = https.request(
      {
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        method,
        headers,
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => {
          raw += c
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw || '{}'))
          } catch (e) {
            reject(new Error(`飞书响应无法解析：${raw.slice(0, 180)}`))
          }
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function feishuFetch(url, opts = {}) {
  const json = await httpJson(url, opts)
  if (json.code !== 0) {
    throw new Error(json.msg || `飞书接口错误 ${json.code}`)
  }
  return json.data
}

async function getTenantToken() {
  const app_id = process.env.FEISHU_APP_ID
  const app_secret = process.env.FEISHU_APP_SECRET
  if (!app_id || !app_secret) {
    throw new Error('未配置云函数环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET')
  }
  const json = await httpJson(TOKEN_URL, {
    method: 'POST',
    body: { app_id, app_secret },
  })
  if (json.code !== 0) throw new Error(json.msg || '获取 tenant_access_token 失败')
  return json.tenant_access_token
}

async function listTables(token, appToken = envToken()) {
  const data = await feishuFetch(`${API}/apps/${appToken}/tables?page_size=100`, { token })
  return data.items || []
}

async function listFields(token, tableId, appToken = envToken()) {
  const data = await feishuFetch(
    `${API}/apps/${appToken}/tables/${tableId}/fields?page_size=100`,
    { token }
  )
  return data.items || []
}

async function listAllRecords(token, tableId, appToken = envToken()) {
  const records = []
  let pageToken = ''
  do {
    const qs = new URLSearchParams({ page_size: '500' })
    if (pageToken) qs.set('page_token', pageToken)
    const data = await feishuFetch(
      `${API}/apps/${appToken}/tables/${tableId}/records?${qs}`,
      { token }
    )
    records.push(...(data.items || []))
    pageToken = data.has_more ? data.page_token : ''
  } while (pageToken)
  return records
}

async function createRecord(token, tableId, fields, appToken = envToken()) {
  const data = await feishuFetch(`${API}/apps/${appToken}/tables/${tableId}/records`, {
    method: 'POST',
    token,
    body: { fields },
  })
  return data.record
}

function cellText(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (v == null) return ''
        if (typeof v === 'string') return v
        if (typeof v === 'number') return String(v)
        if (v.text) return v.text
        if (v.name) return v.name
        return ''
      })
      .filter(Boolean)
      .join(',')
  }
  if (value.text) return String(value.text)
  if (value.name) return String(value.name)
  return String(value)
}

function cellNumber(value) {
  const n = Number(cellText(value).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function pickField(fields, name) {
  if (!name) return undefined
  if (fields[name] !== undefined) return fields[name]
  const key = Object.keys(fields || {}).find((k) => k.trim() === String(name).trim())
  return key ? fields[key] : undefined
}

module.exports = {
  DEFAULT_APP_TOKEN,
  envToken,
  getTenantToken,
  listTables,
  listFields,
  listAllRecords,
  createRecord,
  cellText,
  cellNumber,
  pickField,
}
