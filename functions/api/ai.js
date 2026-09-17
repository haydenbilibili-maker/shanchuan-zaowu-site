/**
 * Cloudflare Pages Function · /api/ai
 *
 * 生产环境 AI 网关：厂商密钥只存服务端环境变量，浏览器不再持有任何 AI Key。
 * （历史做法是把 VITE_DEEPSEEK_API_KEY 打进前端包，任何人下载 /admin 的 JS 即可盗用额度。）
 *
 * Pages → Settings → Environment variables 需配置（按实际使用的厂商）：
 *   DEEPSEEK_API_KEY   DeepSeek（默认通道）
 *   BAILIAN_API_KEY    阿里云百炼 / DashScope（可选）
 *   OPENAI_API_KEY     可选
 *   GEMINI_API_KEY     可选
 *
 * 请求：POST { provider: 'deepseek'|'bailian'|'openai'|'gemini', payload: {...} }
 * 响应：原样透传厂商返回体（状态码随之透传），便于前端沿用既有解析逻辑。
 * GET：返回各厂商密钥是否已配置（不泄露任何值）。
 *
 * ⚠️ 鉴权（2026-09-17 全面审计 A3）：本端点此前**完全无鉴权、CORS `*`** —— 线上实测任何人
 * 都能拿它当免费 LLM 代理，盗刷 DEEPSEEK_API_KEY 额度。现与 /api/cloud-fn 同一道门：
 * 来源校验 → ADMIN_PROXY_PASSWORD 未配置即拒绝服务（fail-closed）→ 校验 /api/admin-session
 * 下发的 HttpOnly 签名 Cookie。CORS 不再用 `*`，只回显本站来源并允许携带凭证。
 */
import {
  corsHeaders,
  guardAdminRequest,
} from '../_lib/proxySession.mjs'

const VENDORS = {
  deepseek: {
    base: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
    style: 'openai',
  },
  bailian: {
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyEnv: 'BAILIAN_API_KEY',
    style: 'openai',
    envKeyFallbacks: ['DASHSCOPE_API_KEY'],
  },
  openai: {
    base: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    style: 'openai',
  },
  gemini: {
    base: 'https://generativelanguage.googleapis.com/v1beta',
    keyEnv: 'GEMINI_API_KEY',
    style: 'gemini',
  },
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  })
}

function resolveKey(vendor, env) {
  const names = [vendor.keyEnv].concat(vendor.envKeyFallbacks || [])
  for (const name of names) {
    const value = String(env[name] || '').trim()
    if (value) return value
  }
  return ''
}

/** 只允许模型/生图相关路径，避免把网关变成任意 URL 转发器 */
function resolveUpstreamPath(vendor, payload = {}) {
  const requested = String(payload.upstreamPath || '').trim()
  if (vendor.style === 'gemini') {
    if (/^\/models\/[A-Za-z0-9._-]+:(generateContent|streamGenerateContent)$/.test(requested)) return requested
    return '/models/gemini-2.5-flash:generateContent'
  }
  const allowed = [
    '/chat/completions',
    '/images/generations',
    '/compatible-mode/v1/chat/completions',
    '/compatible-mode/v1/images/generations',
  ]
  if (allowed.includes(requested)) return requested
  return '/chat/completions'
}

export async function onRequest(context) {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) })
  }

  const headers = corsHeaders(request, env)

  // 统一入口闸：来源 → 口令已配置 → 会话。未登录一律 401，GET 也不再对公网开放。
  const gate = await guardAdminRequest(request, env)
  if (!gate.ok) return json(gate.body, gate.status, headers)

  if (request.method === 'GET') {
    const configured = {}
    for (const [name, vendor] of Object.entries(VENDORS)) {
      configured[name] = Boolean(resolveKey(vendor, env))
    }
    return json({ ok: true, configured }, 200, headers)
  }

  if (request.method !== 'POST') {
    return json({ error: { message: '仅支持 GET/POST' } }, 405, headers)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: { message: '请求体不是合法 JSON' } }, 400, headers)
  }

  const provider = String(body?.provider || '').trim().toLowerCase()
  const vendor = VENDORS[provider]
  if (!vendor) {
    return json({ error: { message: `不支持的 provider：${provider || '(空)'}` } }, 400, headers)
  }

  const apiKey = resolveKey(vendor, env)
  if (!apiKey) {
    return json(
      {
        error: {
          message: `AI 网关未配置 ${vendor.keyEnv}。请在 Cloudflare Pages → Settings → Environment variables 添加后重新部署。`,
        },
        code: 'AI_KEY_NOT_CONFIGURED',
      },
      503,
      headers,
    )
  }

  const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {}
  const upstreamPath = resolveUpstreamPath(vendor, payload)
  const url =
    vendor.style === 'gemini'
      ? `${vendor.base}${upstreamPath}?key=${encodeURIComponent(apiKey)}`
      : `${vendor.base}${upstreamPath}`

  // 注意：CORS 响应头叫 headers（见 onRequest 顶部），上游请求头另起名避免遮蔽
  const upstreamHeaders = { 'Content-Type': 'application/json' }
  if (vendor.style === 'openai') upstreamHeaders.Authorization = `Bearer ${apiKey}`

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(payload),
    })
    const text = await upstream.text()
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...headers,
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      },
    })
  } catch (e) {
    return json({ error: { message: `上游调用失败：${e.message || e}` } }, 502, headers)
  }
}
