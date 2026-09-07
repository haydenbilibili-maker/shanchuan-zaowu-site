/**
 * 本地 Admin 云函数代理：密钥只读 admin/.env，不进 SPA。
 * 浏览器 POST /admin/api/cloud-fn 或 /api/cloud-fn
 */
import { handleCloudFnAction, proxyStatus } from '../../functions/_lib/cloudbaseCallFn.mjs'

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

function isCloudFnPath(url = '') {
  const path = url.split('?')[0]
  return path === '/api/cloud-fn' || path === '/admin/api/cloud-fn'
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function cloudEnv(env = {}) {
  return {
    TCB_SECRET_ID: env.TCB_SECRET_ID,
    TCB_SECRET_KEY: env.TCB_SECRET_KEY,
    ADMIN_OPS_KEY: env.ADMIN_OPS_KEY || env.VITE_ADMIN_OPS_KEY,
    VITE_ADMIN_OPS_KEY: env.VITE_ADMIN_OPS_KEY,
    CLOUDBASE_ENV: env.CLOUDBASE_ENV || env.TCB_ENV,
    CLOUDBASE_REGION: env.CLOUDBASE_REGION,
  }
}

function createMiddleware(env) {
  const tcbEnv = cloudEnv(env)
  return async function cloudFnMiddleware(req, res, next) {
    if (!isCloudFnPath(req.url || '')) {
      next()
      return
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    try {
      if (req.method === 'GET') {
        send(res, 200, proxyStatus(tcbEnv))
        return
      }
      if (req.method !== 'POST') {
        send(res, 405, { success: false, msg: '仅支持 GET/POST' })
        return
      }
      const payload = await readJsonBody(req)
      send(res, 200, await handleCloudFnAction(payload, tcbEnv))
    } catch (e) {
      send(res, 200, { success: false, msg: e.message || String(e) })
    }
  }
}

export function viteCloudFnPlugin(env) {
  const middleware = createMiddleware(env)
  return {
    name: 'cloudbase-cloud-fn-dev',
    configureServer: ({ middlewares }) => {
      middlewares.use(middleware)
    },
    configurePreviewServer: ({ middlewares }) => {
      middlewares.use(middleware)
    },
  }
}
