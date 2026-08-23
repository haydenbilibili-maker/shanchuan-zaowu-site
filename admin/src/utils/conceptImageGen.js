/**
 * 爆品概念 · 视觉 prompt 组装与站内生图
 * 支持 Gemini Imagen / OpenAI DALL·E / 百炼万相（可选）
 */
import { syncRuntimeApiKeysFromStorage } from './aiHelper'

const DEFAULT_GEMINI_APP_URL =
  'https://gemini.google.com/app/e267ab1bf45eed45?hl=zh'

function isPlausibleApiKey(key) {
  const s = String(key || '').trim()
  if (!s || s.length < 8) return false
  if (/^(sk-)?your[-_]?|placeholder|changeme|xxx+|<.*>|example/i.test(s)) return false
  return true
}

function readEnvList(...names) {
  return names
    .flatMap((name) => String(import.meta.env?.[name] || '').split(','))
    .map((key) => key.trim())
    .filter(isPlausibleApiKey)
}

function resolveLocalApiProxyUrl(apiPath) {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
  const segment = String(apiPath || '').replace(/^\/+/, '')
  const joined = base ? `${base}/${segment}` : `/${segment}`
  return joined.replace(/([^:]\/)\/+/g, '$1')
}

function shouldUseLocalAiProxy() {
  return Boolean(import.meta.env.DEV)
}

function readKeys() {
  syncRuntimeApiKeysFromStorage()
  return {
    gemini: readEnvList('VITE_GEMINI_API_KEYS', 'VITE_GEMINI_API_KEY'),
    openai: readEnvList('VITE_OPENAI_API_KEYS', 'VITE_OPENAI_API_KEY'),
    bailian: readEnvList('VITE_BAILIAN_API_KEYS', 'VITE_BAILIAN_API_KEY', 'VITE_DASHSCOPE_API_KEY'),
  }
}

function resolveProvider() {
  const fromEnv = String(import.meta.env.VITE_IMAGE_GEN_PROVIDER || '').trim().toLowerCase()
  const keys = readKeys()
  if (fromEnv && ['gemini', 'openai', 'bailian'].includes(fromEnv)) {
    if (keys[fromEnv]?.length) return fromEnv
  }
  if (keys.gemini.length) return 'gemini'
  if (keys.openai.length) return 'openai'
  if (keys.bailian.length) return 'bailian'
  return null
}

/** 是否具备站内生图凭证 */
export function hasImageGenCredentials() {
  return Boolean(resolveProvider())
}

/** 站内生图总开关：显式 false 关闭；显式 true 需有 Key；未设则随 Key 自动启用 */
export function isImageGenEnabled() {
  const flag = String(import.meta.env.VITE_IMAGE_GEN_ENABLED ?? '').trim().toLowerCase()
  if (flag === '0' || flag === 'false' || flag === 'off') return false
  if (flag === '1' || flag === 'true' || flag === 'on') return hasImageGenCredentials()
  return hasImageGenCredentials()
}

export function getImageGenStatus() {
  const provider = resolveProvider()
  return {
    enabled: isImageGenEnabled(),
    provider,
    geminiAppUrl: String(import.meta.env.VITE_GEMINI_IMAGE_APP_URL || DEFAULT_GEMINI_APP_URL).trim(),
    models: {
      gemini: import.meta.env.VITE_GEMINI_IMAGE_MODEL || 'imagen-3.0-generate-002',
      openai: import.meta.env.VITE_OPENAI_IMAGE_MODEL || 'dall-e-3',
      bailian: import.meta.env.VITE_BAILIAN_IMAGE_MODEL || 'wanx-v1',
    },
  }
}

const VI_STYLE_HINT =
  'Shanhai Zaowu brand aesthetic: natural specimen art museum, premium black-gold accents, forest green (#2d6a4f) and antique gold (#c4a55a), museum-grade lighting, tactile materials, elegant Chinese contemporary gift product photography, 8K product render, clean background, no text overlay'

/**
 * 从概念结构化字段组装视觉 prompt（中英混合，供 Imagen / DALL·E / Gemini 粘贴）
 */
export function buildConceptVisualPrompt(concept) {
  if (!concept) return ''
  const opts = concept.options || {}
  const selling = (concept.sellingPoints || []).slice(0, 4).join('；')
  const channels = Array.isArray(concept.channels)
    ? concept.channels.join('、')
    : String(concept.channels || '')

  const lines = [
    `产品效果图 / product concept render for「${concept.name || '未命名'}」`,
    concept.position && `定位 positioning: ${concept.position}`,
    (concept.priceBand || concept.price) &&
      `价格带 price tier: ${concept.priceBand || `¥${concept.price}`}`,
    opts.categoryLabel && `品类 category: ${opts.categoryLabel}`,
    opts.innovationLabel && `创新方向 innovation: ${opts.innovationLabel}`,
    opts.channelLabel && `渠道 channel: ${opts.channelLabel}`,
    concept.targetAudience && `目标客群 audience: ${concept.targetAudience}`,
    selling && `核心卖点 key selling points: ${selling}`,
    concept.materials && `材质工艺 materials & craft: ${concept.materials}`,
    channels && `使用场景 usage scenes: ${channels}`,
    concept.strategy && `市场叙事 market narrative: ${concept.strategy}`,
    VI_STYLE_HINT,
    '单件产品居中展示，专业电商/门店陈列级光影，无水印无文字，写实与文创感平衡。',
  ].filter(Boolean)

  return lines.join('\n')
}

function pickKey(provider) {
  const keys = readKeys()
  return keys[provider]?.[0] || null
}

async function blobToCompressedDataUrl(blob, maxWidth = 512, quality = 0.72) {
  if (typeof document === 'undefined') {
    return URL.createObjectURL(blob)
  }
  try {
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, maxWidth / bitmap.width)
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (dataUrl.length > 180_000) return canvas.toDataURL('image/jpeg', 0.55)
    return dataUrl
  } catch {
    return URL.createObjectURL(blob)
  }
}

async function generateViaGemini(prompt, { signal, model }) {
  const key = pickKey('gemini')
  if (!key) throw new Error('未配置 VITE_GEMINI_API_KEY')

  const modelId = model || getImageGenStatus().models.gemini
  const url = shouldUseLocalAiProxy()
    ? `${resolveLocalApiProxyUrl(`api/gemini/models/${modelId}:predict`)}?key=${encodeURIComponent(key)}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:predict?key=${encodeURIComponent(key)}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '1:1' },
    }),
    ...(signal ? { signal } : {}),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Gemini Imagen ${response.status}: ${errText.slice(0, 200)}`)
  }

  const data = await response.json()
  const b64 =
    data?.predictions?.[0]?.bytesBase64Encoded ||
    data?.generatedImages?.[0]?.image?.imageBytes ||
    data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data

  if (!b64) throw new Error('Gemini Imagen 未返回图片数据')
  const blob = await fetch(`data:image/png;base64,${b64}`).then((r) => r.blob())
  const displayUrl = URL.createObjectURL(blob)
  const thumbUrl = await blobToCompressedDataUrl(blob)
  return { displayUrl, thumbUrl, provider: 'gemini', mimeType: 'image/png' }
}

async function generateViaOpenAI(prompt, { signal, model }) {
  const key = pickKey('openai')
  if (!key) throw new Error('未配置 VITE_OPENAI_API_KEY')

  const modelId = model || getImageGenStatus().models.openai
  const url = shouldUseLocalAiProxy()
    ? resolveLocalApiProxyUrl('api/openai/images/generations')
    : 'https://api.openai.com/v1/images/generations'

  const headers = { 'Content-Type': 'application/json' }
  if (shouldUseLocalAiProxy()) headers['X-API-Key'] = key
  else headers.Authorization = `Bearer ${key}`

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: modelId,
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    }),
    ...(signal ? { signal } : {}),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`OpenAI Images ${response.status}: ${errText.slice(0, 200)}`)
  }

  const data = await response.json()
  const b64 = data?.data?.[0]?.b64_json
  const remoteUrl = data?.data?.[0]?.url
  if (b64) {
    const blob = await fetch(`data:image/png;base64,${b64}`).then((r) => r.blob())
    const displayUrl = URL.createObjectURL(blob)
    const thumbUrl = await blobToCompressedDataUrl(blob)
    return { displayUrl, thumbUrl, provider: 'openai', mimeType: 'image/png' }
  }
  if (remoteUrl) {
    const blob = await fetch(remoteUrl, signal ? { signal } : {}).then((r) => r.blob())
    const displayUrl = URL.createObjectURL(blob)
    const thumbUrl = await blobToCompressedDataUrl(blob)
    return { displayUrl, thumbUrl, provider: 'openai', mimeType: blob.type || 'image/png' }
  }
  throw new Error('OpenAI Images 未返回图片数据')
}

function bailianNativeUrl(path) {
  const segment = String(path || '').replace(/^\/+/, '')
  if (shouldUseLocalAiProxy()) {
    return resolveLocalApiProxyUrl(`api/bailian-native/${segment}`)
  }
  return `https://dashscope.aliyuncs.com/api/v1/${segment}`
}

async function pollBailianTask(taskId, key, signal, maxAttempts = 30) {
  const base = bailianNativeUrl('tasks')

  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) throw new DOMException('The user aborted a request.', 'AbortError')
    await new Promise((r) => setTimeout(r, 2000))
    const headers = { Authorization: `Bearer ${key}` }
    const res = await fetch(`${base}/${taskId}`, { headers, ...(signal ? { signal } : {}) })
    if (!res.ok) continue
    const data = await res.json()
    const status = data?.output?.task_status || data?.task_status
    if (status === 'SUCCEEDED') {
      const imgUrl = data?.output?.results?.[0]?.url || data?.output?.url
      if (imgUrl) return imgUrl
    }
    if (status === 'FAILED') {
      throw new Error(data?.output?.message || data?.message || '百炼文生图任务失败')
    }
  }
  throw new Error('百炼文生图超时，请稍后重试')
}

async function generateViaBailian(prompt, { signal, model }) {
  const key = pickKey('bailian')
  if (!key) throw new Error('未配置 VITE_BAILIAN_API_KEY')

  const modelId = model || getImageGenStatus().models.bailian
  const url = bailianNativeUrl('services/aigc/text2image/image-synthesis')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: modelId,
      input: { prompt },
      parameters: { size: '1024*1024', n: 1 },
    }),
    ...(signal ? { signal } : {}),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`百炼文生图 ${response.status}: ${errText.slice(0, 200)}`)
  }

  const data = await response.json()
  const taskId = data?.output?.task_id || data?.task_id
  let imgUrl = data?.output?.results?.[0]?.url

  if (!imgUrl && taskId) {
    imgUrl = await pollBailianTask(taskId, key, signal)
  }
  if (!imgUrl) throw new Error('百炼文生图未返回图片 URL')

  const blob = await fetch(imgUrl, signal ? { signal } : {}).then((r) => r.blob())
  const displayUrl = URL.createObjectURL(blob)
  const thumbUrl = await blobToCompressedDataUrl(blob)
  return { displayUrl, thumbUrl, provider: 'bailian', mimeType: blob.type || 'image/png' }
}

/**
 * 站内生图：按配置 provider 调用，失败时可传 fallbackProvider
 * @returns {{ displayUrl, thumbUrl, provider, mimeType, createdAt }}
 */
export async function generateConceptImage(prompt, options = {}) {
  const { signal, provider: forcedProvider, fallback = true } = options
  if (!prompt?.trim()) throw new Error('视觉描述为空')
  if (!isImageGenEnabled()) {
    throw new Error('站内生图未启用或未配置 API Key')
  }

  const primary = forcedProvider || resolveProvider()
  const chain = fallback
    ? [primary, 'gemini', 'openai', 'bailian'].filter(Boolean)
    : [primary]

  const seen = new Set()
  let lastError = null

  for (const p of chain) {
    if (!p || seen.has(p)) continue
    seen.add(p)
    if (!pickKey(p)) continue
    try {
      let result
      if (p === 'openai') result = await generateViaOpenAI(prompt, options)
      else if (p === 'bailian') result = await generateViaBailian(prompt, options)
      else result = await generateViaGemini(prompt, options)
      return { ...result, createdAt: Date.now() }
    } catch (err) {
      lastError = err
      console.warn(`[概念生图] ${p} 失败:`, err.message)
    }
  }

  throw lastError || new Error('所有生图通道均不可用')
}

/** Gemini 外链：复制 prompt 后打开 App（URL 无法可靠预填，以剪贴板为主路径） */
export async function openGeminiImageApp(prompt, options = {}) {
  const { previewOnly = false } = options
  const url = getImageGenStatus().geminiAppUrl || DEFAULT_GEMINI_APP_URL
  const text = String(prompt || '').trim()
  if (!text) throw new Error('视觉描述为空')

  if (previewOnly) return { url, copied: false }

  let copied = false
  try {
    await navigator.clipboard.writeText(text)
    copied = true
  } catch {
    copied = false
  }

  window.open(url, '_blank', 'noopener,noreferrer')
  return { url, copied }
}

export function revokeConceptImageUrls(imageMeta) {
  if (!imageMeta) return
  if (imageMeta.displayUrl?.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(imageMeta.displayUrl)
    } catch {
      /* ignore */
    }
  }
}
