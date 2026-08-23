/**
 * Vite 开发/预览：开源 TTS（CosyVoice 风格）同源代理。
 * Secret/上游地址只读环境变量，不进入前端 bundle。
 *
 * 环境变量：
 * - OSS_TTS_ENABLED=1          启用代理（未启用不影响对话）
 * - OSS_TTS_UPSTREAM           本机/内网 CosyVoice HTTP，如 http://127.0.0.1:50000
 * - OSS_TTS_MOCK=1             不连上游，返回极短静音 WAV（接线验证）
 * - OSS_TTS_API_STYLE          auto | sft | openai（默认 auto）
 * - OSS_TTS_SFT_PATH           默认 /inference_sft
 * - OSS_TTS_OPENAI_PATH        默认 /v1/audio/speech
 * - OSS_TTS_VOICE              默认发音人 / spk_id
 * - OSS_TTS_PROBE_PATH         status 探测路径，默认依次试 /health、/v1/models、/
 */

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

/** 极短静音 WAV（16kHz mono PCM16），供 MOCK 模式接线验证 */
function makeSilentWav(durationMs = 90, sampleRate = 16000) {
  const numSamples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000))
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  return buf
}

function normalizeUpstream(raw) {
  return String(raw || '')
    .trim()
    .replace(/\/$/, '')
}

async function probeUpstream(upstream, probePath) {
  const paths = probePath
    ? [probePath]
    : ['/health', '/v1/models', '/docs', '/']
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 1600)
  try {
    for (const p of paths) {
      try {
        const r = await fetch(`${upstream}${p}`, {
          method: 'GET',
          signal: ac.signal,
          headers: { Accept: 'application/json,*/*' },
        })
        // 任意 HTTP 响应（含 404）说明进程在听端口
        if (r.status > 0) return { ok: true, probe: p, status: r.status }
      } catch {
        /* try next */
      }
    }
    return { ok: false, message: '上游无响应（连接失败或超时）' }
  } finally {
    clearTimeout(timer)
  }
}

async function forwardSft(upstream, sftPath, text, voice) {
  const url = `${upstream}${sftPath}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'audio/*,application/octet-stream,*/*' },
    body: JSON.stringify({
      tts_text: text,
      text,
      spk_id: voice,
      speaker: voice,
    }),
  })
  return res
}

async function forwardOpenai(upstream, openaiPath, text, voice, stream) {
  const url = `${upstream}${openaiPath}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'audio/*,application/octet-stream,*/*' },
    body: JSON.stringify({
      model: 'cosyvoice',
      input: text,
      voice: voice || 'default',
      response_format: stream ? 'pcm' : 'wav',
      ...(stream ? { stream: true } : {}),
    }),
  })
  return res
}

function createMiddleware(env) {
  const mock = String(env.OSS_TTS_MOCK || '') === '1'
  const enabled = mock || String(env.OSS_TTS_ENABLED || '') === '1'
  const upstream = normalizeUpstream(env.OSS_TTS_UPSTREAM)
  const apiStyle = String(env.OSS_TTS_API_STYLE || 'auto').toLowerCase()
  const sftPath = env.OSS_TTS_SFT_PATH || '/inference_sft'
  const openaiPath = env.OSS_TTS_OPENAI_PATH || '/v1/audio/speech'
  const defaultVoice = env.OSS_TTS_VOICE || '中文女'
  const probePath = env.OSS_TTS_PROBE_PATH || ''

  let lastProbe = { at: 0, result: null }

  async function cachedProbe() {
    const now = Date.now()
    if (lastProbe.result && now - lastProbe.at < 8000) return lastProbe.result
    const result = await probeUpstream(upstream, probePath || undefined)
    lastProbe = { at: now, result }
    return result
  }

  return async function ossTtsMiddleware(req, res, next) {
    const url = req.url || ''
    if (!url.startsWith('/api/oss-tts/')) {
      next()
      return
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    if (url.startsWith('/api/oss-tts/status') && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      if (mock) {
        res.end(JSON.stringify({ ok: true, mode: 'mock', upstream: 'mock', message: 'OSS_TTS_MOCK=1' }))
        return
      }
      if (!enabled) {
        res.end(
          JSON.stringify({
            ok: false,
            mode: 'disabled',
            upstream: upstream || null,
            message: '未设置 OSS_TTS_ENABLED=1（或 OSS_TTS_MOCK=1），开源 TTS 跳过',
          }),
        )
        return
      }
      if (!upstream) {
        res.end(
          JSON.stringify({
            ok: false,
            mode: 'misconfigured',
            upstream: null,
            message: '已启用但未配置 OSS_TTS_UPSTREAM',
          }),
        )
        return
      }
      const probe = await cachedProbe()
      if (!probe.ok) {
        res.end(
          JSON.stringify({
            ok: false,
            mode: 'unavailable',
            upstream,
            message: probe.message || '上游不可用',
          }),
        )
        return
      }
      res.end(
        JSON.stringify({
          ok: true,
          mode: apiStyle === 'auto' ? 'proxy-auto' : `proxy-${apiStyle}`,
          upstream,
          probe: probe.probe,
          apiStyle,
        }),
      )
      return
    }

    const isSynth = url.startsWith('/api/oss-tts/synthesize') && req.method === 'POST'
    const isStream = url.startsWith('/api/oss-tts/stream') && req.method === 'POST'
    if (!isSynth && !isStream) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }

    let body
    try {
      body = await readJsonBody(req)
    } catch {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'JSON 解析失败' }))
      return
    }

    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: '缺少 text' }))
      return
    }
    if (text.length > 500) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: '单次合成不超过 500 字符，请按句分段' }))
      return
    }

    const voice = (typeof body.voice === 'string' && body.voice.trim()) || defaultVoice

    if (mock) {
      const wav = makeSilentWav(80)
      res.statusCode = 200
      res.setHeader('Content-Type', 'audio/wav')
      res.setHeader('X-OSS-TTS-Mode', 'mock')
      res.end(wav)
      return
    }

    if (!enabled || !upstream) {
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: '开源 TTS 未启用或未配置上游' }))
      return
    }

    const wantStream = isStream || Boolean(body.stream)
    const styles =
      apiStyle === 'sft'
        ? ['sft']
        : apiStyle === 'openai'
          ? ['openai']
          : ['openai', 'sft']

    let lastErr = '上游合成失败'
    for (const style of styles) {
      try {
        const upstreamRes =
          style === 'sft'
            ? await forwardSft(upstream, sftPath, text, voice)
            : await forwardOpenai(upstream, openaiPath, text, voice, wantStream)

        const ct = upstreamRes.headers.get('content-type') || ''
        const buf = Buffer.from(await upstreamRes.arrayBuffer())

        if (!upstreamRes.ok) {
          if (upstreamRes.status === 404 && styles.length > 1) {
            lastErr = `上游 ${style} 路径不存在`
            continue
          }
          let errMsg = buf.toString('utf8').slice(0, 400)
          try {
            const j = JSON.parse(errMsg)
            errMsg = j.error?.message || j.message || j.detail || errMsg
          } catch {
            /* ignore */
          }
          lastErr = errMsg || `HTTP ${upstreamRes.status}`
          if (styles.length > 1 && (upstreamRes.status === 404 || upstreamRes.status === 405)) continue
          res.statusCode = upstreamRes.status >= 400 ? upstreamRes.status : 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: lastErr }))
          return
        }

        if (ct.includes('application/json')) {
          lastErr = buf.toString('utf8').slice(0, 400)
          if (styles.length > 1) continue
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: lastErr || '上游返回 JSON 错误' }))
          return
        }

        res.statusCode = 200
        res.setHeader('Content-Type', ct || (wantStream ? 'audio/pcm' : 'audio/wav'))
        res.setHeader('X-OSS-TTS-Upstream-Style', style)
        res.end(buf)
        return
      } catch (e) {
        lastErr = e?.message || String(e)
        if (styles.length > 1) continue
      }
    }

    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: lastErr }))
  }
}

export function viteOssTtsPlugin(env) {
  const middleware = createMiddleware(env)
  return {
    name: 'oss-tts-dev',
    configureServer: ({ middlewares }) => {
      middlewares.use(middleware)
    },
    configurePreviewServer: ({ middlewares }) => {
      middlewares.use(middleware)
    },
  }
}
