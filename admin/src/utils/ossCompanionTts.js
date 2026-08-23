/**
 * 企业经营助理「马上有」— 开源 TTS（CosyVoice 风格）客户端。
 * 经同源 /api/oss-tts/* 代理；未启用/上游挂掉时安静返回 false，由调用方降级 NLS / Web Speech。
 *
 * P1 形态：
 * - 按句请求 synthesize，顺序播放 wav/mp3（主路径）
 * - 若响应为 PCM（audio/pcm / audio/L16），用 AudioContext 队列播放
 * - 可选尝试 /stream；失败则回落 synthesize
 *
 * 生产：设置 VITE_OSS_TTS_API_BASE 指向提供同一套路径的网关（无末尾斜杠）。
 */

function ttsApiBase() {
  const b = (import.meta.env.VITE_OSS_TTS_API_BASE || '').trim().replace(/\/$/, '')
  return b
}

/** 负缓存：上游不可用时短时间不再打 status，避免每句对话都探测 */
let statusNegCache = { until: 0, value: null }
let statusPosCache = { until: 0, value: null }

/**
 * @returns {Promise<{ ok: boolean, mode?: string, upstream?: string, message?: string }>}
 */
export async function fetchOssTtsStatus() {
  const now = Date.now()
  if (statusNegCache.value && now < statusNegCache.until) return statusNegCache.value
  if (statusPosCache.value && now < statusPosCache.until) return statusPosCache.value

  const base = ttsApiBase()
  try {
    const r = await fetch(`${base}/api/oss-tts/status`, { cache: 'no-store' })
    if (!r.ok) {
      const v = { ok: false, mode: 'http-error', message: `HTTP ${r.status}` }
      statusNegCache = { until: now + 15000, value: v }
      return v
    }
    const j = await r.json()
    if (j?.ok) {
      statusPosCache = { until: now + 8000, value: j }
      statusNegCache = { until: 0, value: null }
      return j
    }
    statusNegCache = { until: now + 15000, value: j }
    return j
  } catch (e) {
    const v = { ok: false, mode: 'unreachable', message: e?.message || String(e) }
    statusNegCache = { until: now + 15000, value: v }
    return v
  }
}

/** 按句切分（P1：LLM 整段返回时，句级请求 + 顺序播） */
export function sliceTextForOssTts(text, maxLen = 120) {
  const s = String(text || '').trim()
  if (!s) return []
  const parts = s.split(/(?<=[。！？；.!?\n])/).map((x) => x.trim()).filter(Boolean)
  const out = []
  for (const p of parts) {
    if (p.length <= maxLen) {
      out.push(p)
    } else {
      for (let i = 0; i < p.length; i += maxLen) {
        out.push(p.slice(i, i + maxLen))
      }
    }
  }
  return out.length ? out : [s]
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function isPcmContentType(ct) {
  const c = String(ct || '').toLowerCase()
  return c.includes('audio/pcm') || c.includes('audio/l16') || c.includes('audio/raw')
}

/**
 * 播放 PCM16 LE mono；返回可 pause 的伪 Audio，兼容 CompanionRobot halt。
 * @param {ArrayBuffer} pcmBuf
 * @param {{ sampleRate?: number, shouldContinue: () => boolean, onAttach?: Function, onDetach?: Function }} opts
 */
async function playPcm16Queue(pcmBuf, opts) {
  const { shouldContinue, onAttach, onDetach, sampleRate = 22050 } = opts
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) return false

  const ctx = new AudioCtx()
  const samples = new Int16Array(pcmBuf)
  if (!samples.length) {
    try {
      await ctx.close()
    } catch {
      /* ignore */
    }
    return false
  }

  const float = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    float[i] = samples[i] / 32768
  }
  const buffer = ctx.createBuffer(1, float.length, sampleRate)
  buffer.copyToChannel(float, 0)

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)

  let stopped = false
  const haltHandle = {
    pause() {
      if (stopped) return
      stopped = true
      try {
        source.stop(0)
      } catch {
        /* ignore */
      }
      try {
        ctx.close()
      } catch {
        /* ignore */
      }
    },
    removeAttribute() {},
    load() {},
  }

  onAttach?.(haltHandle)

  await new Promise((resolve) => {
    let poll = null
    const cleanup = () => {
      if (poll != null) {
        clearInterval(poll)
        poll = null
      }
      try {
        if (!stopped) {
          stopped = true
          ctx.close()
        }
      } catch {
        /* ignore */
      }
      resolve()
    }
    source.onended = cleanup
    poll = setInterval(() => {
      if (!shouldContinue()) {
        haltHandle.pause()
        cleanup()
      }
    }, 100)
    try {
      source.start(0)
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    } catch {
      cleanup()
    }
  })

  onDetach?.()
  return true
}

/**
 * 播放整段 audio blob（wav/mp3），与阿里云路径同风格。
 */
async function playAudioBlob(blob, opts) {
  const { shouldContinue, onAttach, onDetach } = opts
  const objectUrl = URL.createObjectURL(blob)
  const audio = new Audio(objectUrl)

  await new Promise((resolve) => {
    let finished = false
    let poll = null
    const cleanup = () => {
      if (finished) return
      finished = true
      if (poll != null) {
        clearInterval(poll)
        poll = null
      }
      try {
        URL.revokeObjectURL(objectUrl)
      } catch {
        /* ignore */
      }
      resolve()
    }
    audio.onended = cleanup
    audio.onerror = cleanup
    onAttach?.(audio, objectUrl)
    poll = setInterval(() => {
      if (!shouldContinue()) {
        try {
          audio.pause()
        } catch {
          /* ignore */
        }
        cleanup()
      }
    }, 100)
    audio.play().catch(() => cleanup())
  })

  onDetach?.()
}

async function fetchSynthChunk(base, text, voice, preferStream) {
  const endpoints = preferStream
    ? [`${base}/api/oss-tts/stream`, `${base}/api/oss-tts/synthesize`]
    : [`${base}/api/oss-tts/synthesize`]

  let lastFail = null
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          text,
          ...(voice ? { voice } : {}),
          ...(url.endsWith('/stream') ? { stream: true } : {}),
        }),
      })
      if (!res.ok) {
        lastFail = res
        if (url.endsWith('/stream')) continue
        return res
      }
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        lastFail = res
        if (url.endsWith('/stream')) continue
        return res
      }
      return res
    } catch (e) {
      lastFail = e
      if (url.endsWith('/stream')) continue
      throw e
    }
  }
  if (lastFail && typeof lastFail.ok === 'boolean') return lastFail
  throw lastFail || new Error('synthesize failed')
}

/**
 * 若成功播完（含用户取消），返回 true，调用方不再降级。
 * 若从未播成功任何一段，返回 false，调用方应降级阿里云 / Web Speech。
 *
 * @param {string} text
 * @param {{ shouldContinue: () => boolean, onAttach?: Function, onDetach?: Function, voice?: string }} opts
 */
export async function tryPlayOssCompanionTts(text, opts) {
  const { shouldContinue, onAttach, onDetach, voice } = opts

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false
  }

  const status = await fetchOssTtsStatus()
  if (!status.ok) {
    return false
  }

  const base = ttsApiBase()
  const chunks = sliceTextForOssTts(text, 120)
  let playedAny = false
  const preferStream = status.mode === 'mock' ? false : true
  const sampleRate = Number(import.meta.env.VITE_OSS_TTS_SAMPLE_RATE) || 22050

  for (let i = 0; i < chunks.length; i++) {
    if (!shouldContinue()) {
      onDetach?.()
      return true
    }

    let res
    try {
      res = await fetchSynthChunk(base, chunks[i], voice, preferStream && i === 0)
    } catch {
      if (!playedAny) return false
      onDetach?.()
      return true
    }

    if (!res.ok) {
      if (!playedAny) return false
      onDetach?.()
      return true
    }

    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      if (!playedAny) return false
      onDetach?.()
      return true
    }

    const buf = await res.arrayBuffer()
    if (!buf.byteLength) {
      if (!playedAny) return false
      onDetach?.()
      return true
    }

    if (isPcmContentType(ct) && !ct.includes('wav') && !ct.includes('mpeg')) {
      const ok = await playPcm16Queue(buf, {
        shouldContinue,
        onAttach,
        onDetach,
        sampleRate,
      })
      if (!ok && !playedAny) return false
      if (!shouldContinue()) return true
      playedAny = playedAny || ok
    } else {
      await playAudioBlob(new Blob([buf], { type: ct || 'audio/wav' }), {
        shouldContinue,
        onAttach,
        onDetach,
      })
      if (!shouldContinue()) return true
      playedAny = true
    }

    if (i < chunks.length - 1) {
      await sleep(100 + Math.floor(Math.random() * 100))
    }
  }

  return playedAny
}
