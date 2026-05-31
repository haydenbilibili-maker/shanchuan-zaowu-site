/**
 * 企业经营助理「马上有」— 阿里云 NLS 云端 TTS（通过同源 /api/aliyun-nls/* 代理）。
 *
 * 约束说明：
 * - 云端合成必须联网；无账号/未配置环境变量时自动走 Web Speech（见 CompanionRobot）。
 * - 生产环境静态托管无 Node 中间件时，需自建反向代理到同一套 API，并设置
 *   import.meta.env.VITE_ALIYUN_TTS_API_BASE 指向你的网关域名（仅路径前缀，不含末尾斜杠）。
 *
 * 开通与配置（摘要）：
 * 1. 注册阿里云 → 开通「智能语音交互」→ 创建项目取得 AppKey。
 * 2. 准备 RAM 用户 AccessKey（切勿把 Secret 写进前端代码；本仓库仅 dev/preview 的 Vite 插件读 .env）。
 * 3. 项目根目录 .env 填写 ALIYUN_NLS_ACCESS_KEY_ID、ALIYUN_NLS_ACCESS_KEY_SECRET、ALIYUN_NLS_APPKEY。
 */

function ttsApiBase() {
  const b = (import.meta.env.VITE_ALIYUN_TTS_API_BASE || '').trim().replace(/\/$/, '')
  return b
}

/**
 * @returns {Promise<{ ok: boolean, configured?: boolean, message?: string }>}
 */
export async function fetchAliyunNlsTtsStatus() {
  const base = ttsApiBase()
  try {
    const r = await fetch(`${base}/api/aliyun-nls/status`, { cache: 'no-store' })
    if (!r.ok) return { ok: false, configured: false, message: `HTTP ${r.status}` }
    return await r.json()
  } catch (e) {
    return { ok: false, configured: false, message: e?.message || String(e) }
  }
}

/** 单次 REST 合成上限 300 字符（官方文档） */
export function sliceTextForAliyunNls(text, maxLen = 300) {
  const t = String(text || '').trim()
  if (!t) return []
  const out = []
  for (let i = 0; i < t.length; i += maxLen) {
    out.push(t.slice(i, i + maxLen))
  }
  return out
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 若成功走完整条播报（含用户中途取消导致的提前结束），返回 true，调用方不再使用 Web Speech。
 * 若因未配置/网络/接口错误未能播放任何音频，返回 false，调用方应回退 Web Speech。
 *
 * @param {string} text
 * @param {{ shouldContinue: () => boolean, onAttach?: (a: HTMLAudioElement, url: string) => void, onDetach?: () => void, voice?: string, format?: string }} opts
 */
export async function tryPlayAliyunNlsTts(text, opts) {
  const { shouldContinue, onAttach, onDetach, voice, format } = opts

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false
  }

  const status = await fetchAliyunNlsTtsStatus()
  if (!status.ok || !status.configured) {
    return false
  }

  const base = ttsApiBase()
  const chunks = sliceTextForAliyunNls(text, 300)
  let playedAny = false

  for (let i = 0; i < chunks.length; i++) {
    if (!shouldContinue()) {
      onDetach?.()
      return true
    }

    let res
    try {
      res = await fetch(`${base}/api/aliyun-nls/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          text: chunks[i],
          ...(voice ? { voice } : {}),
          ...(format ? { format } : {}),
        }),
      })
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

    const blob = await res.blob()
    if (!blob.size) {
      if (!playedAny) return false
      onDetach?.()
      return true
    }

    const objectUrl = URL.createObjectURL(blob)
    const audio = new Audio(objectUrl)

    await new Promise((resolve) => {
      let finished = false
      let poll = null
      const cleanup = () => {
        if (finished) return
        finished = true
        if (poll != null) {
          try {
            clearInterval(poll)
          } catch {
            /* ignore */
          }
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

      audio.play().catch(() => {
        cleanup()
      })
    })

    onDetach?.()

    if (!shouldContinue()) {
      return true
    }

    playedAny = true
    if (i < chunks.length - 1) {
      await sleep(120 + Math.floor(Math.random() * 120))
    }
  }

  return playedAny
}
