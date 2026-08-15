/** 飞书多维表 Open API（Cloudflare Pages Function / Vite 中间件共用） */
export const DEFAULT_APP_TOKEN = 'WCs2bnIHsaty7vsjcnaczu0Wnod'
const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
const API = 'https://open.feishu.cn/open-apis/bitable/v1'

export function envToken(env = {}) {
  return env.FEISHU_APP_TOKEN || DEFAULT_APP_TOKEN
}

async function feishuJson(url, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (json.code !== 0) {
    throw new Error(json.msg || `飞书接口错误 ${json.code || res.status}`)
  }
  return json
}

export async function getTenantToken(env = {}) {
  const app_id = env.FEISHU_APP_ID
  const app_secret = env.FEISHU_APP_SECRET
  if (!app_id || !app_secret) {
    throw new Error('未配置 FEISHU_APP_ID / FEISHU_APP_SECRET（Cloudflare Pages 环境变量或 admin/.env）')
  }
  const json = await feishuJson(TOKEN_URL, {
    method: 'POST',
    body: { app_id, app_secret },
  })
  return json.tenant_access_token
}

export async function inspectBase(env = {}) {
  const token = await getTenantToken(env)
  const appToken = envToken(env)
  const tablesRes = await feishuJson(`${API}/apps/${appToken}/tables?page_size=100`, { token })
  const tables = []
  for (const t of tablesRes.data?.items || []) {
    const fieldsRes = await feishuJson(
      `${API}/apps/${appToken}/tables/${t.table_id}/fields?page_size=100`,
      { token },
    )
    tables.push({
      tableId: t.table_id,
      name: t.name,
      fields: (fieldsRes.data?.items || []).map((f) => ({
        name: f.field_name,
        type: f.type,
        uiType: f.ui_type,
      })),
    })
  }
  return { appToken, tables }
}

export async function listAllRecords(tableId, env = {}) {
  const token = await getTenantToken(env)
  const appToken = envToken(env)
  const records = []
  let pageToken = ''
  do {
    const qs = new URLSearchParams({ page_size: '500' })
    if (pageToken) qs.set('page_token', pageToken)
    const json = await feishuJson(
      `${API}/apps/${appToken}/tables/${tableId}/records?${qs}`,
      { token },
    )
    records.push(...(json.data?.items || []))
    pageToken = json.data?.has_more ? json.data.page_token : ''
  } while (pageToken)
  return records
}

export async function createFeishuRecord(tableId, fields, env = {}) {
  const token = await getTenantToken(env)
  const appToken = envToken(env)
  const json = await feishuJson(`${API}/apps/${appToken}/tables/${tableId}/records`, {
    method: 'POST',
    token,
    body: { fields },
  })
  return json.data?.record
}

export async function handleFeishuAction(payload = {}, env = {}) {
  const configured = Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET)
  const action = payload.action

  if (action === 'status' || !action) {
    return {
      success: true,
      configured,
      appToken: envToken(env),
      msg: configured
        ? '飞书密钥已配置'
        : '未配置 FEISHU_APP_ID / FEISHU_APP_SECRET',
    }
  }

  if (!configured) {
    return {
      success: false,
      msg: '未配置 FEISHU_APP_ID / FEISHU_APP_SECRET。本地写 admin/.env；线上写 Cloudflare Pages → Settings → Environment variables。',
    }
  }

  if (action === 'inspect') {
    const data = await inspectBase(env)
    return { success: true, ...data }
  }
  if (action === 'listRecords') {
    if (!payload.tableId) return { success: false, msg: '缺少 tableId' }
    const records = await listAllRecords(payload.tableId, env)
    return { success: true, records }
  }
  if (action === 'createRecord') {
    if (!payload.tableId) return { success: false, msg: '缺少 tableId' }
    const record = await createFeishuRecord(payload.tableId, payload.fields || {}, env)
    return { success: true, record }
  }
  return { success: false, msg: `未知 action: ${action}` }
}
