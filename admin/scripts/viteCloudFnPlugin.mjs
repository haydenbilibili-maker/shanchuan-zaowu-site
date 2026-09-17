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

/**
 * 本地开发代理的来源校验（2026-09-17 审计 B5）
 *
 * 为什么必须有：本中间件会**无条件注入 ADMIN_OPS_KEY**（= 超管身份），而 dev server 原先
 * `host: '0.0.0.0'` —— 同局域网任何人 POST `/api/cloud-fn` 即拿到 30 个管理云函数的超管身份；
 * 即使只绑本机，开发者浏览器里的任意恶意页面也能跨源 POST 到 localhost 打穿它。
 *
 * 语义与生产 `proxySession.originAllowed` 一致：带 Origin/Referer 时必须与请求 Host 同源；
 * 两者都不带（curl / 脚本）视为非浏览器客户端，放行。浏览器对跨源 POST 一定带 Origin，
 * 因此这一条即挡住 CSRF。
 */
function devOriginAllowed(req) {
  const hostOf = (u) => {
    try { return new URL(u).host } catch { return '' }
  }
  const candidate = hostOf(req.headers.origin) || hostOf(req.headers.referer)
  if (!candidate) return true
  return candidate === String(req.headers.host || '')
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
    // 只认非 VITE_ 前缀的 ADMIN_OPS_KEY：VITE_ 变量会被打进前端包（历史泄露点）
    ADMIN_OPS_KEY: env.ADMIN_OPS_KEY,
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

    if (!devOriginAllowed(req)) {
      send(res, 403, { success: false, msg: '来源不被允许：本地代理只接受本站页面发起的请求' })
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
