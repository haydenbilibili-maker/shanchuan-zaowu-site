/** 飞书多维表 Open API（Cloudflare Pages Function / Vite 中间件共用） */
export const DEFAULT_APP_TOKEN = 'WCs2bnIHsaty7vsjcnaczu0Wnod'
const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
const API = 'https://open.feishu.cn/open-apis/bitable/v1'

export function envToken(env = {}) {
  return env.FEISHU_APP_TOKEN || DEFAULT_APP_TOKEN
}

/** 单次请求可覆盖 app_token（人事 Base 与采购库存 Base 不同） */
function scopedEnv(env = {}, payload = {}) {
  const appToken = payload.appToken || payload.app_token
  if (!appToken) return env
  return { ...env, FEISHU_APP_TOKEN: String(appToken).trim() }
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

export async function listTableFields(tableId, env = {}) {
  const token = await getTenantToken(env)
  const appToken = envToken(env)
  const fieldsRes = await feishuJson(
    `${API}/apps/${appToken}/tables/${tableId}/fields?page_size=100`,
    { token },
  )
  return {
    appToken,
    tableId,
    fields: (fieldsRes.data?.items || []).map((f) => ({
      name: f.field_name,
      type: f.type,
      uiType: f.ui_type,
    })),
  }
}

export async function listAllRecords(tableId, env = {}, { viewId } = {}) {
  const token = await getTenantToken(env)
  const appToken = envToken(env)
  const records = []
  let pageToken = ''
  do {
    const qs = new URLSearchParams({ page_size: '500' })
    if (pageToken) qs.set('page_token', pageToken)
    if (viewId) qs.set('view_id', viewId)
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

export async function updateFeishuRecord(tableId, recordId, fields, env = {}) {
  const token = await getTenantToken(env)
  const appToken = envToken(env)
  const json = await feishuJson(
    `${API}/apps/${appToken}/tables/${tableId}/records/${recordId}`,
    {
      method: 'PUT',
      token,
      body: { fields },
    },
  )
  return json.data?.record
}

export async function handleFeishuAction(payload = {}, env = {}) {
  const configured = Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET)
  const action = payload.action
  const envScoped = scopedEnv(env, payload)

  if (action === 'status' || !action) {
    return {
      success: true,
      configured,
      appToken: envToken(envScoped),
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
    const data = await inspectBase(envScoped)
    return { success: true, ...data }
  }
  if (action === 'listFields') {
    if (!payload.tableId) return { success: false, msg: '缺少 tableId' }
    const data = await listTableFields(payload.tableId, envScoped)
    return { success: true, ...data }
  }
  if (action === 'listRecords') {
    if (!payload.tableId) return { success: false, msg: '缺少 tableId' }
    const records = await listAllRecords(payload.tableId, envScoped, {
      viewId: payload.viewId || payload.view_id || '',
    })
    return { success: true, records }
  }
  if (action === 'createRecord') {
    if (!payload.tableId) return { success: false, msg: '缺少 tableId' }
    const record = await createFeishuRecord(payload.tableId, payload.fields || {}, envScoped)
    return { success: true, record }
  }
  if (action === 'updateRecord') {
    if (!payload.tableId || !payload.recordId) {
      return { success: false, msg: '缺少 tableId 或 recordId' }
    }
    const record = await updateFeishuRecord(
      payload.tableId,
      payload.recordId,
      payload.fields || {},
      envScoped,
    )
    return { success: true, record }
  }
  return { success: false, msg: `未知 action: ${action}` }
}
