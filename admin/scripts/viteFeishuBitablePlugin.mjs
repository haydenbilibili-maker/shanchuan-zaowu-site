/**
 * 本地 Admin 飞书对接：密钥只读 admin/.env，不进 SPA。
 * 浏览器 POST /admin/api/feishu-sync 或 /api/feishu-sync
 */
import { handleFeishuAction, envToken } from '../../functions/_lib/feishuBitable.mjs'

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function isSyncPath(url = '') {
  const path = url.split('?')[0]
  return path === '/api/feishu-sync' || path === '/admin/api/feishu-sync'
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function createMiddleware(env) {
  return async function feishuSyncMiddleware(req, res, next) {
    if (!isSyncPath(req.url || '')) {
      next()
      return
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    const feishuEnv = {
      FEISHU_APP_ID: env.FEISHU_APP_ID,
      FEISHU_APP_SECRET: env.FEISHU_APP_SECRET,
      FEISHU_APP_TOKEN: env.FEISHU_APP_TOKEN,
    }

    try {
      if (req.method === 'GET') {
        send(res, 200, await handleFeishuAction({ action: 'status' }, feishuEnv))
        return
      }
      if (req.method !== 'POST') {
        send(res, 405, { success: false, msg: '仅支持 GET/POST' })
        return
      }
      const payload = await readJsonBody(req)
      send(res, 200, await handleFeishuAction(payload, feishuEnv))
    } catch (e) {
      send(res, 200, { success: false, msg: e.message || String(e) })
    }
  }
}

export function viteFeishuBitablePlugin(env) {
  const middleware = createMiddleware(env)
  return {
    name: 'feishu-bitable-dev',
    configureServer: ({ middlewares }) => {
      middlewares.use(middleware)
    },
    configurePreviewServer: ({ middlewares }) => {
      middlewares.use(middleware)
    },
  }
}

export { envToken }
