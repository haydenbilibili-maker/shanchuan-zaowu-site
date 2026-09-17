/**
 * Cloudflare Pages Function · /api/admin-session
 *
 * 运营人员登录 / 登出管理代理会话。登录成功后下发 HMAC 签名的 HttpOnly Cookie，
 * /api/cloud-fn 依赖该 Cookie 才会注入 ADMIN_OPS_KEY 调用管理类云函数。
 *
 * 环境变量：ADMIN_PROXY_PASSWORD（必填）、ADMIN_PROXY_SECRET / ADMIN_PROXY_ORIGINS（选填）
 * 详见 functions/_lib/proxySession.mjs
 */
import {
  buildClearCookie,
  buildSessionCookie,
  corsHeaders,
  issueSessionToken,
  originAllowed,
  parseCookies,
  passwordConfigured,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  verifySessionToken,
} from '../_lib/proxySession.mjs'

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  })
}

export async function onRequest(context) {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) })
  }

  const headers = corsHeaders(request, env)

  if (!originAllowed(request, env)) {
    return json({ success: false, msg: '来源不被允许' }, 403, headers)
  }

  // ── 会话探活（2026-09-17 审计 A4）──────────────────────────────
  // 只回答「当前浏览器是否持有有效会话」，不要求任何输入、不回显任何配置。
  // ⚠️ 原先 `GET` 与 `DELETE` 同义（= 登出）—— 那是个隐患：任何预取/直链/爬虫命中都会把
  // 运营踢下线；而前端从未用 GET 登出（clearAdminSession 用的是 DELETE）。故改为探活。
  if (request.method === 'GET') {
    const cookies = parseCookies(request)
    const session = await verifySessionToken(env, cookies[SESSION_COOKIE] || '')
    return json({ success: true, active: session.ok === true }, 200, headers)
  }

  if (!passwordConfigured(env)) {
    return json(
      {
        success: false,
        code: 'PROXY_PASSWORD_NOT_CONFIGURED',
        msg: '服务端未配置 ADMIN_PROXY_PASSWORD，管理代理已拒绝服务。请在 Cloudflare Pages 环境变量中配置后重新部署。',
      },
      503,
      headers,
    )
  }

  if (request.method === 'DELETE') {
    return json({ success: true, msg: '已退出管理会话' }, 200, {
      ...headers,
      'Set-Cookie': buildClearCookie(),
    })
  }

  if (request.method !== 'POST') {
    return json({ success: false, msg: '仅支持 GET/POST/DELETE' }, 405, headers)
  }

  const body = await request.json().catch(() => ({}))
  const password = String((body && body.password) || '')
  if (!password) {
    return json({ success: false, msg: '请输入管理口令' }, 400, headers)
  }

  // 恒定时间比较，避免口令被逐字符探测
  const expected = String(env.ADMIN_PROXY_PASSWORD || '')
  let diff = expected.length === password.length ? 0 : 1
  for (let i = 0; i < Math.max(expected.length, password.length); i += 1) {
    diff |= (expected.charCodeAt(i) || 0) ^ (password.charCodeAt(i) || 0)
  }
  if (diff !== 0) {
    return json({ success: false, msg: '口令错误或无权访问' }, 401, headers)
  }

  const token = await issueSessionToken(env)
  if (!token) {
    return json({ success: false, msg: '服务端签名密钥缺失，无法建立会话' }, 500, headers)
  }

  return json(
    { success: true, msg: '身份验证通过', ttlSec: SESSION_TTL_SEC },
    200,
    { ...headers, 'Set-Cookie': buildSessionCookie(token) },
  )
}
