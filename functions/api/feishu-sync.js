/**
 * Cloudflare Pages Function · /api/feishu-sync
 * 密钥：Pages 环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET（勿进 SPA）
 *
 * ⚠️ 鉴权（2026-09-17 全面审计 A2）：本端点此前**完全无鉴权、CORS `*`** —— 线上实测
 * `GET /api/feishu-sync` 直接返回 `{success:true, configured:true, appToken:"…"}`，
 * 任何人可读写飞书多维表（含人事花名册 Base）并拿到 app_token。
 * 现与 /api/cloud-fn 同一道门：来源校验 → ADMIN_PROXY_PASSWORD 未配置即拒绝服务（fail-closed）
 * → 校验 /api/admin-session 下发的 HttpOnly 签名 Cookie；CORS 不再用 `*`。
 *
 * 另：响应**不再回显 appToken**（文档标识也不该出现在公网响应里）。ERP 自己知道该用哪个 Base，
 * 不需要服务端告知；这个字段此前只是泄露面。
 */
import { handleFeishuAction } from '../_lib/feishuBitable.mjs'
import {
  corsHeaders,
  guardAdminRequest,
} from '../_lib/proxySession.mjs'

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  })
}

/** 去掉 appToken（含 inspect 分支的返回值）后再出网 */
function withoutAppToken(result) {
  if (!result || typeof result !== 'object') return result
  if (!('appToken' in result)) return result
  const { appToken, ...rest } = result
  return rest
}

export async function onRequest(context) {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) })
  }

  const headers = corsHeaders(request, env)

  const feishuEnv = {
    FEISHU_APP_ID: env.FEISHU_APP_ID,
    FEISHU_APP_SECRET: env.FEISHU_APP_SECRET,
    FEISHU_APP_TOKEN: env.FEISHU_APP_TOKEN,
  }

  try {
    // 统一入口闸：来源 → 口令已配置 → 会话（GET 状态查询同样要对内网/运营开放，不对公网开放）
    const gate = await guardAdminRequest(request, env)
    if (!gate.ok) return json(gate.body, gate.status, headers)

    if (request.method === 'GET') {
      return json(withoutAppToken(await handleFeishuAction({ action: 'status' }, feishuEnv)), 200, headers)
    }
    if (request.method !== 'POST') {
      return json({ success: false, msg: '仅支持 GET/POST' }, 405, headers)
    }
    const payload = await request.json().catch(() => ({}))
    return json(withoutAppToken(await handleFeishuAction(payload, feishuEnv)), 200, headers)
  } catch (e) {
    return json({ success: false, msg: e.message || String(e) }, 200, headers)
  }
}
