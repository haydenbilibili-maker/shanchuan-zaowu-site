/**
 * Cloudflare Pages Function · /api/cloud-fn
 * 用腾讯云 API 密钥服务端 Invoke 云开发云函数，绕开浏览器匿名 callFunction。
 *
 * ⚠️ 安全约束（2026-09-15 加固）：
 * 本路由会把 ADMIN_OPS_KEY 注入到允许名单内的管理类云函数，而命中 adminOpsKey 即等同超管
 * （见 cloudfunctions/<fn>/staffGuard.js）。因此**必须**先校验 /api/admin-session 下发的签名
 * Cookie，未登录一律 401，绝不允许公网匿名调用。缺 ADMIN_PROXY_PASSWORD 时直接拒绝服务
 * （fail-closed），避免「配置缺失 = 默认放行」。
 *
 * 密钥（Pages → Settings → Environment variables，勿进 SPA / 勿提交 git）：
 *   TCB_SECRET_ID / TCB_SECRET_KEY
 *   ADMIN_OPS_KEY（与小程序云函数环境变量同名同值）
 *   ADMIN_PROXY_PASSWORD（运营登录口令，必填）
 *   ADMIN_PROXY_SECRET / ADMIN_PROXY_ORIGINS（选填）
 *   CLOUDBASE_ENV（可选，默认 cloud1-8gnkty5bfff9f0bf）
 *   CLOUDBASE_REGION（可选，默认 ap-shanghai）
 *
 * 部署：本文件须随仓库 functions/ 一并 `wrangler pages deploy`；
 * 仅更新 public/admin 静态资源而不同步 functions/ 会导致本路由 404/405，
 * 而同目录的 /api/feishu-sync 仍可能正常（历史已发布）。
 */
import { handleCloudFnAction } from '../_lib/cloudbaseCallFn.mjs'
import {
  corsHeaders,
  originAllowed,
  parseCookies,
  passwordConfigured,
  SESSION_COOKIE,
  verifySessionToken,
} from '../_lib/proxySession.mjs'

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  })
}

function cloudEnv(env = {}) {
  return {
    TCB_SECRET_ID: env.TCB_SECRET_ID,
    TCB_SECRET_KEY: env.TCB_SECRET_KEY,
    ADMIN_OPS_KEY: env.ADMIN_OPS_KEY,
    CLOUDBASE_ENV: env.CLOUDBASE_ENV || env.TCB_ENV,
    CLOUDBASE_REGION: env.CLOUDBASE_REGION,
  }
}

export async function onRequest(context) {
  const { request, env } = context
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) })
  }

  const headers = corsHeaders(request, env)
  const tcbEnv = cloudEnv(env)

  try {
    if (!originAllowed(request, env)) {
      return json({ success: false, msg: '来源不被允许' }, 403, headers)
    }

    if (!passwordConfigured(env)) {
      return json(
        {
          success: false,
          code: 'PROXY_PASSWORD_NOT_CONFIGURED',
          msg: '服务端未配置 ADMIN_PROXY_PASSWORD，管理代理已拒绝服务（fail-closed）。',
        },
        503,
        headers,
      )
    }

    // 探活：GET 不再回显白名单与密钥状态，避免信息暴露
    if (request.method === 'GET') {
      return json({ success: true, msg: 'admin proxy online' }, 200, headers)
    }
    if (request.method !== 'POST') {
      return json({ success: false, msg: '仅支持 GET/POST' }, 405, headers)
    }

    // ---- 会话校验（唯一入口凭证）----
    const cookies = parseCookies(request)
    const session = await verifySessionToken(env, cookies[SESSION_COOKIE] || '')
    if (!session.ok) {
      const expired = session.reason === 'expired'
      return json(
        {
          success: false,
          code: expired ? 'SESSION_EXPIRED' : 'UNAUTHORIZED',
          msg: expired
            ? '管理会话已过期，请重新输入口令登录'
            : '未登录管理会话：请先在 ERP 登录页完成口令验证',
        },
        401,
        headers,
      )
    }

    const payload = await request.json().catch(() => ({}))
    return json(await handleCloudFnAction(payload, tcbEnv), 200, headers)
  } catch (e) {
    return json({ success: false, msg: e.message || String(e) }, 200, headers)
  }
}
