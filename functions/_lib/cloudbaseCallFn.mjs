/**
 * Admin 云函数代理共用逻辑（Cloudflare Pages Function / Vite 中间件）
 * 用腾讯云 API 密钥服务端 Invoke SCF，绕开浏览器匿名 callFunction 的 PERMISSION_DENIED。
 *
 * 环境变量（勿进 SPA / 勿提交 git）：
 *   TCB_SECRET_ID / TCB_SECRET_KEY
 *   ADMIN_OPS_KEY（注入到允许名单内的管理类云函数）
 *   CLOUDBASE_ENV（默认 cloud1-8gnkty5bfff9f0bf）
 *   CLOUDBASE_REGION（默认 ap-shanghai）
 */

export const DEFAULT_ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
export const DEFAULT_REGION = 'ap-shanghai'

/** 仅这些管理类函数走代理；其它请继续用 CDN SDK 或小程序 */
export const ALLOWED_FUNCTIONS = Object.freeze([
  'manageInvoiceRequests',
  'manageHonoraryCurators',
  'manageMemberLevelAdjust',
  'manageStaff',
  'bindPlatformOrder',
  'managerShipOrder',
  'refundOrder',
  'getShippingRules',
  'moderateComment',
  'assistProductCopy',
])

const ALLOWED = new Set(ALLOWED_FUNCTIONS)

function enc() {
  return new TextEncoder()
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(message) {
  const data = typeof message === 'string' ? enc().encode(message) : message
  return toHex(await crypto.subtle.digest('SHA-256', data))
}

async function hmac(key, message) {
  const keyData = typeof key === 'string' ? enc().encode(key) : key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, enc().encode(message)),
  )
}

/**
 * Tencent Cloud API TC3-HMAC-SHA256（Web Crypto，兼容 CF Workers / Node 18+）
 */
async function tc3Request({
  secretId,
  secretKey,
  service,
  host,
  region,
  action,
  version,
  payload,
}) {
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})
  const hashedRequestPayload = await sha256Hex(body)

  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload,
  ].join('\n')

  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const secretDate = await hmac(`TC3${secretKey}`, date)
  const secretService = await hmac(secretDate, service)
  const secretSigning = await hmac(secretService, 'tc3_request')
  const signature = toHex(await hmac(secretSigning, stringToSign))

  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': version,
      'X-TC-Region': region,
    },
    body,
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(json?.Response?.Error?.Message || `腾讯云 API HTTP ${res.status}`)
  }
  if (json?.Response?.Error) {
    const err = json.Response.Error
    throw new Error(err.Message || err.Code || '腾讯云 API 错误')
  }
  return json.Response
}

export async function invokeCloudFunction(name, data, env = {}) {
  const secretId = env.TCB_SECRET_ID
  const secretKey = env.TCB_SECRET_KEY
  if (!secretId || !secretKey) {
    throw new Error(
      '未配置 TCB_SECRET_ID / TCB_SECRET_KEY（Cloudflare Pages 环境变量或 admin/.env）',
    )
  }

  const envId = env.CLOUDBASE_ENV || env.TCB_ENV || DEFAULT_ENV_ID
  const region = env.CLOUDBASE_REGION || DEFAULT_REGION

  const response = await tc3Request({
    secretId,
    secretKey,
    service: 'scf',
    host: 'scf.tencentcloudapi.com',
    region,
    action: 'Invoke',
    version: '2018-04-16',
    payload: {
      FunctionName: name,
      Namespace: envId,
      ClientContext: JSON.stringify(data || {}),
      LogType: 'None',
      InvocationType: 'RequestResponse',
    },
  })

  const result = response?.Result || {}
  if (result.InvokeResult && Number(result.InvokeResult) !== 0) {
    throw new Error(result.ErrMsg || `云函数 ${name} 调用失败`)
  }

  const raw = result.RetMsg
  if (raw == null || raw === '') {
    return { success: true }
  }
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return { success: true, raw }
  }
}

export function proxyStatus(env = {}) {
  const hasSecrets = Boolean(env.TCB_SECRET_ID && env.TCB_SECRET_KEY)
  const hasOpsKey = Boolean(env.ADMIN_OPS_KEY || env.VITE_ADMIN_OPS_KEY)
  return {
    success: true,
    configured: hasSecrets,
    hasOpsKey,
    envId: env.CLOUDBASE_ENV || env.TCB_ENV || DEFAULT_ENV_ID,
    allowed: ALLOWED_FUNCTIONS.slice(),
    msg: hasSecrets
      ? '云函数代理已就绪'
      : '未配置 TCB_SECRET_ID / TCB_SECRET_KEY',
  }
}

/**
 * @param {{ name?: string, data?: object, action?: string }} payload
 * @param {Record<string, string>} env
 */
export async function handleCloudFnAction(payload = {}, env = {}) {
  const name = String(payload.name || '').trim()
  if (!name || payload.action === 'status') {
    return proxyStatus(env)
  }
  if (!ALLOWED.has(name)) {
    return {
      success: false,
      msg: `云函数「${name}」不在 Admin 代理白名单内`,
      allowed: ALLOWED_FUNCTIONS.slice(),
    }
  }

  const data = { ...(payload.data && typeof payload.data === 'object' ? payload.data : {}) }
  const opsKey = env.ADMIN_OPS_KEY || env.VITE_ADMIN_OPS_KEY || ''
  if (opsKey) {
    data.adminOpsKey = opsKey
  } else if (!data.adminOpsKey) {
    return {
      success: false,
      msg: '未配置 ADMIN_OPS_KEY（Cloudflare / admin/.env）；管理类云函数无法鉴权',
    }
  }

  try {
    const result = await invokeCloudFunction(name, data, env)
    return result
  } catch (e) {
    const msg = e.message || String(e)
    // 区分「代理已通但云函数未上传」vs「密钥/网络问题」
    if (/ResourceNotFound|FunctionName|does not exist|不存在|FUNCTION_NOT_FOUND/i.test(msg)) {
      return {
        success: false,
        msg: `云函数「${name}」未部署或不存在于当前环境。请在微信开发者工具上传并部署该云函数（含依赖），并配置 ADMIN_OPS_KEY。原始错误：${msg}`,
      }
    }
    if (/AuthFailure|SecretId|SecretKey|signature/i.test(msg)) {
      return {
        success: false,
        msg: `腾讯云 API 鉴权失败（检查 Cloudflare / admin/.env 的 TCB_SECRET_ID/TCB_SECRET_KEY 与权限）：${msg}`,
      }
    }
    return { success: false, msg }
  }
}
