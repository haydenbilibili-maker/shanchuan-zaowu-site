/**
 * Vite 开发/预览：代理阿里云 NLS Token 与 TTS，Secret 只读环境变量，不进入前端 bundle。
 */
import { fetchNlsToken } from './aliyunNlsPopSign.mjs'

const DEFAULT_GATEWAY = 'https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/tts'

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

function createMiddleware(env) {
  const ak = env.ALIYUN_NLS_ACCESS_KEY_ID || env.ALIYUN_AK_ID
  const sk = env.ALIYUN_NLS_ACCESS_KEY_SECRET || env.ALIYUN_AK_SECRET
  const appkey = env.ALIYUN_NLS_APPKEY
  const gateway = env.ALIYUN_NLS_GATEWAY || DEFAULT_GATEWAY
  const defaultVoice = env.ALIYUN_NLS_VOICE || 'xiaoyun'
  const defaultFormat = env.ALIYUN_NLS_FORMAT || 'mp3'

  const configured = Boolean(ak && sk && appkey)

  let tokenCache = { id: null, expireTime: 0 }

  async function getValidToken() {
    const nowSec = Math.floor(Date.now() / 1000)
    if (tokenCache.id && tokenCache.expireTime > nowSec + 120) {
      return tokenCache.id
    }
    const t = await fetchNlsToken(ak, sk)
    tokenCache = { id: t.id, expireTime: Number(t.expireTime) || 0 }
    return tokenCache.id
  }

  return async function aliyunNlsMiddleware(req, res, next) {
    const url = req.url || ''
    if (!url.startsWith('/api/aliyun-nls/')) {
      next()
      return
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    if (url.startsWith('/api/aliyun-nls/status') && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      if (!configured) {
        res.end(
          JSON.stringify({
            ok: false,
            configured: false,
            message: '未配置 ALIYUN_NLS_ACCESS_KEY_ID / ALIYUN_NLS_ACCESS_KEY_SECRET / ALIYUN_NLS_APPKEY，将使用浏览器语音',
          }),
        )
        return
      }
      try {
        await getValidToken()
        res.end(JSON.stringify({ ok: true, configured: true, gateway: gateway.replace(/\/stream\/v1\/tts$/, '') }))
      } catch (e) {
        res.end(
          JSON.stringify({
            ok: false,
            configured: true,
            message: e?.message || String(e),
          }),
        )
      }
      return
    }

    if (url.startsWith('/api/aliyun-nls/tts') && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      if (!configured) {
        res.statusCode = 503
        res.end(JSON.stringify({ error: 'NLS 未配置' }))
        return
      }
      let body
      try {
        body = await readJsonBody(req)
      } catch {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'JSON 解析失败' }))
        return
      }
      const text = typeof body.text === 'string' ? body.text : ''
      if (!text.trim()) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: '缺少 text' }))
        return
      }
      if (text.length > 300) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: '单次合成不超过 300 字符，请分段' }))
        return
      }
      let token
      try {
        token = await getValidToken()
      } catch (e) {
        res.statusCode = 502
        res.end(JSON.stringify({ error: e?.message || String(e) }))
        return
      }
      const payload = {
        appkey,
        text,
        token,
        format: body.format || defaultFormat,
        voice: body.voice || defaultVoice,
        volume: typeof body.volume === 'number' ? body.volume : 50,
        speech_rate: typeof body.speech_rate === 'number' ? body.speech_rate : 0,
        pitch_rate: typeof body.pitch_rate === 'number' ? body.pitch_rate : 0,
        sample_rate: typeof body.sample_rate === 'number' ? body.sample_rate : 16000,
      }
      try {
        const ttsRes = await fetch(gateway, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(payload),
        })
        const ct = ttsRes.headers.get('content-type') || ''
        const buf = Buffer.from(await ttsRes.arrayBuffer())
        if (!ttsRes.ok || ct.includes('application/json')) {
          let errMsg = buf.toString('utf8').slice(0, 500)
          try {
            const j = JSON.parse(errMsg)
            errMsg = j.message || j.Message || errMsg
          } catch {
            /* ignore */
          }
          res.statusCode = ttsRes.ok ? 502 : ttsRes.status
          res.end(JSON.stringify({ error: errMsg || 'TTS 失败' }))
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', ct || 'audio/mpeg')
        const rid = ttsRes.headers.get('x-nls-requestid')
        if (rid) res.setHeader('X-NLS-RequestId', rid)
        res.end(buf)
      } catch (e) {
        res.statusCode = 502
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: e?.message || String(e) }))
      }
      return
    }

    res.statusCode = 404
    res.end()
  }
}

export function viteAliyunNlsPlugin(env) {
  const middleware = createMiddleware(env)
  return {
    name: 'aliyun-nls-tts-dev',
    configureServer: ({ middlewares }) => {
      middlewares.use(middleware)
    },
    configurePreviewServer: ({ middlewares }) => {
      middlewares.use(middleware)
    },
  }
}
