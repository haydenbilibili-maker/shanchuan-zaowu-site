/**
 * Cloudflare Pages Function · /api/feishu-sync
 * 密钥：Pages 环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET（勿进 SPA）
 */
import { handleFeishuAction } from '../_lib/feishuBitable.mjs'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors })
}

export async function onRequest(context) {
  const { request, env } = context
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  const feishuEnv = {
    FEISHU_APP_ID: env.FEISHU_APP_ID,
    FEISHU_APP_SECRET: env.FEISHU_APP_SECRET,
    FEISHU_APP_TOKEN: env.FEISHU_APP_TOKEN,
  }

  try {
    if (request.method === 'GET') {
      return json(await handleFeishuAction({ action: 'status' }, feishuEnv))
    }
    if (request.method !== 'POST') {
      return json({ success: false, msg: '仅支持 GET/POST' }, 405)
    }
    const payload = await request.json().catch(() => ({}))
    return json(await handleFeishuAction(payload, feishuEnv))
  } catch (e) {
    return json({ success: false, msg: e.message || String(e) })
  }
}
