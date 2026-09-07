/**
 * Cloudflare Pages Function · /api/cloud-fn
 * 用腾讯云 API 密钥服务端 Invoke 云开发云函数，绕开浏览器匿名 callFunction。
 *
 * 密钥（Pages → Settings → Environment variables，勿进 SPA / 勿提交 git）：
 *   TCB_SECRET_ID / TCB_SECRET_KEY
 *   ADMIN_OPS_KEY（与小程序云函数环境变量同名同值）
 *   CLOUDBASE_ENV（可选，默认 cloud1-8gnkty5bfff9f0bf）
 *   CLOUDBASE_REGION（可选，默认 ap-shanghai）
 *
 * 部署：本文件须随仓库 functions/ 一并 `wrangler pages deploy`；
 * 仅更新 public/admin 静态资源而不同步 functions/ 会导致本路由 404/405，
 * 而同目录的 /api/feishu-sync 仍可能正常（历史已发布）。
 */
import { handleCloudFnAction, proxyStatus } from '../_lib/cloudbaseCallFn.mjs'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors })
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
    return new Response(null, { status: 204, headers: cors })
  }

  const tcbEnv = cloudEnv(env)

  try {
    if (request.method === 'GET') {
      return json(proxyStatus(tcbEnv))
    }
    if (request.method !== 'POST') {
      return json({ success: false, msg: '仅支持 GET/POST' }, 405)
    }
    const payload = await request.json().catch(() => ({}))
    return json(await handleCloudFnAction(payload, tcbEnv))
  } catch (e) {
    return json({ success: false, msg: e.message || String(e) })
  }
}
