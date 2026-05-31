/**
 * AI 全局辅助工具
 * 提供统一的AI调用接口、缓存、错误处理等功能
 * 支持多个API Key，自动故障转移和负载均衡
 */

function readEnvList(...names) {
  return names
    .flatMap((name) => String(import.meta.env?.[name] || '').split(','))
    .map((key) => key.trim())
    .filter(Boolean)
}

// API Key 仅从 Vite 环境变量读取，避免在前端源码中继续扩散明文密钥。
const GEMINI_API_KEYS = readEnvList('VITE_GEMINI_API_KEYS', 'VITE_GEMINI_API_KEY')
const OPENAI_API_KEYS = readEnvList('VITE_OPENAI_API_KEYS', 'VITE_OPENAI_API_KEY')
const DEEPSEEK_API_KEYS = readEnvList('VITE_DEEPSEEK_API_KEYS', 'VITE_DEEPSEEK_API_KEY')
const BAILIAN_API_KEYS = readEnvList('VITE_BAILIAN_API_KEYS', 'VITE_BAILIAN_API_KEY', 'VITE_DASHSCOPE_API_KEY')
const BAILIAN_MODEL_DEFAULT = import.meta.env.VITE_BAILIAN_MODEL || 'qwen-plus'
const BAILIAN_MODEL_PRO = import.meta.env.VITE_BAILIAN_MODEL_PRO || 'qwen-max'
const DEFAULT_AI_PROVIDER = import.meta.env.VITE_AI_DEFAULT_PROVIDER
  || (BAILIAN_API_KEYS.length ? 'bailian' : 'gemini')

function getFallbackProvider(excludeProvider) {
  for (const p of ['bailian', 'gemini', 'deepseek', 'openai']) {
    if (p === excludeProvider) continue
    const counts = {
      bailian: BAILIAN_API_KEYS.length,
      gemini: GEMINI_API_KEYS.length,
      deepseek: DEEPSEEK_API_KEYS.length,
      openai: OPENAI_API_KEYS.length,
    }
    if (counts[p] > 0) return p
  }
  return null
}

// 本地模型配置（Ollama）- 已部署多个模型
const LOCAL_MODEL_CONFIG = {
  enabled: true, // 启用本地模型
  baseURL: 'http://localhost:11434', // Ollama默认地址
  model: 'llama3.2:1b', // 默认使用内存占用小的模型（已验证可用）
  timeout: 30000, // 30秒超时
  fallbackEnabled: true, // 作为兜底方案
  // 备用模型列表（按优先级排序）- 优先使用内存占用小的模型
  fallbackModels: ['llama3.2:1b', 'llama3.2:3b', 'qwen2.5:7b']
}

// API Key状态追踪
const keyStatus = {
  bailian: BAILIAN_API_KEYS.map(key => ({ key, failures: 0, lastFailure: 0, successCount: 0 })),
  gemini: GEMINI_API_KEYS.map(key => ({ key, failures: 0, lastFailure: 0, successCount: 0 })),
  openai: OPENAI_API_KEYS.map(key => ({ key, failures: 0, lastFailure: 0, successCount: 0 })),
  deepseek: DEEPSEEK_API_KEYS.map(key => ({ key, failures: 0, lastFailure: 0, successCount: 0 })),
  local: [{ key: 'local', failures: 0, lastFailure: 0, successCount: 0 }] // 本地模型状态
}

export function getAIProviderConfigStatus() {
  return {
    bailian: BAILIAN_API_KEYS.length,
    gemini: GEMINI_API_KEYS.length,
    openai: OPENAI_API_KEYS.length,
    deepseek: DEEPSEEK_API_KEYS.length,
    local: LOCAL_MODEL_CONFIG.enabled ? 1 : 0,
    defaultProvider: DEFAULT_AI_PROVIDER,
  }
}

// Key故障恢复时间（毫秒）
const KEY_RECOVERY_TIME = 5 * 60 * 1000 // 5分钟

/**
 * 选择可用的API Key（轮询 + 故障转移）
 */
function selectAvailableKey(type = 'gemini') {
  const keys = keyStatus[type] || []
  const now = Date.now()
  
  // 过滤出可用的keys（失败次数少或已恢复）
  const availableKeys = keys.filter(keyInfo => {
    // 如果最近失败过，检查是否已过恢复时间
    if (keyInfo.lastFailure > 0 && now - keyInfo.lastFailure < KEY_RECOVERY_TIME) {
      return false
    }
    // 失败次数过多（>5次）的key暂时不使用
    if (keyInfo.failures > 5) {
      return false
    }
    return true
  })
  
  if (availableKeys.length === 0) {
    // 如果没有可用key，重置所有key的状态并返回第一个
    console.warn(`[AI] 所有${type} keys都不可用，重置状态并尝试使用第一个`)
    keys.forEach(k => { k.failures = 0; k.lastFailure = 0 })
    return keys[0]?.key || null
  }
  
  // 按成功率排序，优先使用成功率高的key
  availableKeys.sort((a, b) => {
    const aScore = a.successCount - a.failures
    const bScore = b.successCount - b.failures
    return bScore - aScore
  })
  
  return availableKeys[0].key
}

/**
 * 记录API Key成功
 */
function recordKeySuccess(type, key) {
  const keyInfo = keyStatus[type].find(k => k.key === key)
  if (keyInfo) {
    keyInfo.successCount++
    // 成功时减少失败计数（每成功10次减少1次失败计数）
    if (keyInfo.successCount % 10 === 0 && keyInfo.failures > 0) {
      keyInfo.failures--
    }
  }
}

/**
 * 记录API Key失败
 */
function recordKeyFailure(type, key) {
  const keyInfo = keyStatus[type].find(k => k.key === key)
  if (keyInfo) {
    keyInfo.failures++
    keyInfo.lastFailure = Date.now()
  }
}

/**
 * 生成Gemini API URL
 */
function getGeminiURL(model = 'flash', apiKey = null) {
  const key = apiKey || selectAvailableKey('gemini')
  if (!key) return null
  const modelName = model === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash'
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`
}

/**
 * 生成OpenAI API URL
 */
function getOpenAIURL(model = 'gpt-4o-mini') {
  const key = selectAvailableKey('openai')
  return {
    url: 'https://api.openai.com/v1/chat/completions',
    key: key
  }
}

/**
 * 生成DeepSeek API URL
 */
function getDeepSeekURL(model = 'deepseek-chat') {
  const key = selectAvailableKey('deepseek')
  return {
    url: 'https://api.deepseek.com/v1/chat/completions',
    key: key
  }
}

/**
 * 阿里云百炼（DashScope OpenAI 兼容模式）
 */
function getBailianURL(model = BAILIAN_MODEL_DEFAULT) {
  const key = selectAvailableKey('bailian')
  const baseUrl = (import.meta.env.VITE_BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '')
  return {
    url: import.meta.env.DEV ? '/api/bailian/chat/completions' : `${baseUrl}/chat/completions`,
    key,
    model,
  }
}

// 请求缓存（内存缓存）
const requestCache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5分钟缓存

// 请求队列（防止并发过多）
const requestQueue = []
let activeRequests = 0
const MAX_CONCURRENT_REQUESTS = 3

/**
 * 生成缓存键（安全版本，支持Unicode字符）
 */
function generateCacheKey(prompt, options = {}) {
  const key = JSON.stringify({ prompt, ...options })
  // 使用 encodeURIComponent 替代 btoa，支持 Unicode 字符
  try {
    return encodeURIComponent(key).substring(0, 100).replace(/[^a-zA-Z0-9]/g, '_')
  } catch (e) {
    // 如果编码失败，使用简单的哈希
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36).substring(0, 50)
  }
}

/**
 * 检查缓存
 */
function getCachedResponse(cacheKey) {
  const cached = requestCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.response
  }
  return null
}

/**
 * 设置缓存
 */
function setCachedResponse(cacheKey, response) {
  requestCache.set(cacheKey, {
    response,
    timestamp: Date.now()
  })
}

/**
 * 清理过期缓存
 */
function cleanExpiredCache() {
  const now = Date.now()
  for (const [key, value] of requestCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL) {
      requestCache.delete(key)
    }
  }
}

// 定期清理缓存（每10分钟）
setInterval(cleanExpiredCache, 10 * 60 * 1000)

/**
 * 请求队列管理
 */
async function queueRequest(requestFn) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ requestFn, resolve, reject })
    processQueue()
  })
}

async function processQueue() {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS || requestQueue.length === 0) {
    return
  }

  activeRequests++
  const { requestFn, resolve, reject } = requestQueue.shift()

  try {
    const result = await requestFn()
    resolve(result)
  } catch (error) {
    reject(error)
  } finally {
    activeRequests--
    processQueue()
  }
}

/**
 * 调用本地模型（Ollama）
 * @param {string} prompt - 用户提示词
 * @param {object} options - 配置选项
 * @returns {Promise<string>} AI响应文本
 */
async function callLocalModel(prompt, options = {}) {
  if (!LOCAL_MODEL_CONFIG.enabled) {
    throw new Error('本地模型未启用')
  }
  
  const { systemInstruction, conversationHistory = [], temperature = 0.7 } = options
  
  try {
    // 检查Ollama是否可用
    let healthCheck
    try {
      healthCheck = await fetch(`${LOCAL_MODEL_CONFIG.baseURL}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000) // 3秒超时
      })
    } catch (e) {
      throw new Error('无法连接到本地模型服务，请确保Ollama正在运行（http://localhost:11434）')
    }
    
    if (!healthCheck || !healthCheck.ok) {
      throw new Error('本地模型服务不可用，请确保Ollama正在运行')
    }
    
    // 检查是否有可用模型
    const tagsData = await healthCheck.json().catch(() => ({ models: [] }))
    const availableModels = tagsData.models || []
    
    // 确定要使用的模型
    let modelToUse = LOCAL_MODEL_CONFIG.model
    
    if (availableModels.length > 0) {
      // 如果有模型列表，尝试匹配
      const modelExists = availableModels.some(m => {
        const modelName = m.name || m.model || ''
        return modelName === LOCAL_MODEL_CONFIG.model || 
               modelName.startsWith(LOCAL_MODEL_CONFIG.model) ||
               LOCAL_MODEL_CONFIG.model.startsWith(modelName) ||
               modelName.includes(LOCAL_MODEL_CONFIG.model.split(':')[0])
      })
      
      if (!modelExists) {
        // 尝试使用备用模型列表
        let foundModel = null
        for (const fallbackModel of LOCAL_MODEL_CONFIG.fallbackModels) {
          const found = availableModels.find(m => {
            const modelName = m.name || m.model || ''
            return modelName === fallbackModel || 
                   modelName.startsWith(fallbackModel) ||
                   modelName.includes(fallbackModel.split(':')[0])
          })
          if (found) {
            foundModel = found.name || found.model || fallbackModel
            break
          }
        }
        
        if (foundModel) {
          console.warn(`[AI] 模型 ${LOCAL_MODEL_CONFIG.model} 不存在，使用备用模型: ${foundModel}`)
          modelToUse = foundModel
        } else {
          // 使用第一个可用模型
          const firstModel = availableModels[0]
          modelToUse = firstModel.name || firstModel.model || LOCAL_MODEL_CONFIG.model
          console.warn(`[AI] 模型 ${LOCAL_MODEL_CONFIG.model} 不存在，使用第一个可用模型: ${modelToUse}`)
        }
      } else {
        // 找到匹配的模型
        const matchedModel = availableModels.find(m => {
          const modelName = m.name || m.model || ''
          return modelName === LOCAL_MODEL_CONFIG.model || 
                 modelName.startsWith(LOCAL_MODEL_CONFIG.model) ||
                 LOCAL_MODEL_CONFIG.model.startsWith(modelName) ||
                 modelName.includes(LOCAL_MODEL_CONFIG.model.split(':')[0])
        })
        if (matchedModel) {
          modelToUse = matchedModel.name || matchedModel.model || LOCAL_MODEL_CONFIG.model
        }
      }
      
      console.log(`[AI] 可用模型列表:`, availableModels.map(m => m.name || m.model))
    } else {
      // 如果模型列表为空，直接尝试使用配置的模型（可能模型刚下载，列表还未更新）
      console.warn(`[AI] 模型列表为空，直接尝试使用配置的模型: ${modelToUse}`)
      // 如果失败，会尝试备用模型
    }
    
    console.log(`[AI] 将使用模型: ${modelToUse}`)
    
    // 构建消息
    const messages = []
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction })
    }
    
    if (conversationHistory.length > 0) {
      conversationHistory.forEach(msg => {
          // 安全地提取消息内容
          let msgContent = ''
          if (msg.parts && Array.isArray(msg.parts) && msg.parts.length > 0) {
            const textPart = msg.parts.find(p => p && (p.text !== undefined && p.text !== null))
            msgContent = textPart ? textPart.text : (msg.content || '')
          } else {
            msgContent = msg.content || ''
          }
          messages.push({
            role: msg.role === 'model' ? 'assistant' : msg.role,
            content: msgContent
          })
      })
    }
    
    messages.push({ role: 'user', content: prompt })
    
    console.log(`[AI] 调用本地模型: ${modelToUse}`)
    
    // 调用Ollama API（优先尝试 /api/chat，如果404则自动切换到 /api/generate）
    let response
    let useGenerateAPI = false
    
    // 先尝试 /api/chat
    response = await fetch(`${LOCAL_MODEL_CONFIG.baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelToUse,
        messages: messages,
        stream: false,
        options: {
          temperature: temperature
        }
      }),
      signal: AbortSignal.timeout(LOCAL_MODEL_CONFIG.timeout)
    })
    
    // 如果404，立即尝试 /api/generate（某些Ollama版本可能不支持 /api/chat）
    if (response.status === 404) {
      console.log(`[AI] /api/chat 返回404，切换到 /api/generate`)
      useGenerateAPI = true
      
      // 将 messages 转换为 prompt
      const promptText = messages.map(m => {
        if (m.role === 'system') return `系统: ${m.content}\n\n`
        if (m.role === 'assistant') return `助手: ${m.content}\n\n`
        return `用户: ${m.content}\n\n`
      }).join('') + '助手:'
      
      response = await fetch(`${LOCAL_MODEL_CONFIG.baseURL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelToUse,
          prompt: promptText,
          stream: false,
          options: {
            temperature: temperature
          }
        }),
        signal: AbortSignal.timeout(LOCAL_MODEL_CONFIG.timeout)
      })
    }
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      let errorMsg = `本地模型API错误: ${response.status}`
      
      if (response.status === 404) {
        // 如果404，尝试使用备用模型
        console.log(`[AI] 模型 ${modelToUse} 返回404，尝试备用模型...`)
        
        for (const fallbackModel of LOCAL_MODEL_CONFIG.fallbackModels) {
          if (fallbackModel === modelToUse) continue // 跳过已尝试的模型
          
          console.log(`[AI] 尝试备用模型: ${fallbackModel}`)
          try {
            const fallbackResponse = await fetch(`${LOCAL_MODEL_CONFIG.baseURL}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: fallbackModel,
                messages: messages,
                stream: false,
                options: { temperature: temperature }
              }),
              signal: AbortSignal.timeout(LOCAL_MODEL_CONFIG.timeout)
            })
            
            if (fallbackResponse.ok) {
              const fallbackData = await fallbackResponse.json()
              if (fallbackData.message && fallbackData.message.content) {
                recordKeySuccess('local', 'local')
                console.log(`[AI] 备用模型 ${fallbackModel} 调用成功`)
                return fallbackData.message.content
              }
            } else {
              const fallbackError = await fallbackResponse.text().catch(() => '')
              console.warn(`[AI] 备用模型 ${fallbackModel} 返回 ${fallbackResponse.status}: ${fallbackError.substring(0, 50)}`)
            }
          } catch (e) {
            console.warn(`[AI] 备用模型 ${fallbackModel} 调用异常:`, e.message)
          }
        }
        
        // 如果所有备用模型都失败，尝试使用 /api/generate API（兼容旧版本）
        console.log(`[AI] 尝试使用 /api/generate API`)
        try {
          // 将 messages 转换为 prompt
          const promptText = messages.map(m => {
            if (m.role === 'system') return `系统: ${m.content}\n\n`
            if (m.role === 'assistant') return `助手: ${m.content}\n\n`
            return `用户: ${m.content}\n\n`
          }).join('') + '助手:'
          
          const generateResponse = await fetch(`${LOCAL_MODEL_CONFIG.baseURL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: modelToUse,
              prompt: promptText,
              stream: false,
              options: { temperature: temperature }
            }),
            signal: AbortSignal.timeout(LOCAL_MODEL_CONFIG.timeout)
          })
          
          if (generateResponse.ok) {
            const generateData = await generateResponse.json()
            if (generateData.response) {
              recordKeySuccess('local', 'local')
              console.log(`[AI] 使用 /api/generate 调用成功`)
              return generateData.response
            }
          } else {
            const generateError = await generateResponse.text().catch(() => '')
            console.warn(`[AI] /api/generate 返回 ${generateResponse.status}: ${generateError.substring(0, 50)}`)
          }
        } catch (e) {
          console.warn(`[AI] /api/generate 调用异常:`, e.message)
        }
        
        // 如果所有方法都失败，尝试直接使用模型名称（不带版本号）
        const baseModelName = modelToUse.split(':')[0]
        if (baseModelName !== modelToUse) {
          console.log(`[AI] 尝试使用基础模型名称: ${baseModelName}`)
          try {
            const baseResponse = await fetch(`${LOCAL_MODEL_CONFIG.baseURL}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: baseModelName,
                messages: messages,
                stream: false,
                options: { temperature: temperature }
              }),
              signal: AbortSignal.timeout(LOCAL_MODEL_CONFIG.timeout)
            })
            
            if (baseResponse.ok) {
              const baseData = await baseResponse.json()
              if (baseData.message && baseData.message.content) {
                recordKeySuccess('local', 'local')
                console.log(`[AI] 基础模型 ${baseModelName} 调用成功`)
                return baseData.message.content
              }
            }
          } catch (e) {
            console.warn(`[AI] 基础模型 ${baseModelName} 也失败:`, e.message)
          }
        }
        
        errorMsg = `模型 ${modelToUse} 不存在。请运行: ollama pull ${modelToUse}。错误详情: ${errorText.substring(0, 100)}`
      } else if (response.status === 400) {
        errorMsg = `请求格式错误: ${errorText.substring(0, 100)}`
      }
      
      throw new Error(errorMsg)
    }
    
    const data = await response.json()
    
    // 处理两种API格式的响应
    if (useGenerateAPI) {
      // /api/generate 格式
      if (data.response) {
        recordKeySuccess('local', 'local')
        console.log('[AI] 本地模型调用成功（使用 /api/generate）')
        return data.response
      } else {
        console.error('[AI] 本地模型返回格式错误（generate）:', data)
        throw new Error('本地模型返回格式错误')
      }
    } else {
      // /api/chat 格式
      if (data.message && data.message.content) {
        recordKeySuccess('local', 'local')
        console.log('[AI] 本地模型调用成功（使用 /api/chat）')
        return data.message.content
      } else {
        console.error('[AI] 本地模型返回格式错误（chat）:', data)
        throw new Error('本地模型返回格式错误，请检查Ollama版本')
      }
    }
  } catch (error) {
    recordKeyFailure('local', 'local')
    console.error('[AI] 本地模型调用失败:', error.message)
    
    if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
      throw new Error('本地模型响应超时，请检查模型是否正在运行')
    }
    
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('无法连接到本地模型服务，请确保Ollama正在运行')
    }
    
    throw error
  }
}

/**
 * 统一的AI API调用函数（增强版，支持多Key和故障转移）
 * @param {string} prompt - 用户提示词
 * @param {object} options - 配置选项
 * @param {string} options.provider - 'bailian' | 'gemini' | 'openai' | 'deepseek' | 'local'，默认百炼（有 Key 时）
 * @param {boolean} options.usePro - 是否使用 Pro 模型（百炼 qwen-max / Gemini Pro）
 * @param {number} options.temperature - 温度参数
 * @param {number} options.maxOutputTokens - 最大输出token数
 * @param {boolean} options.useCache - 是否使用缓存
 * @param {object} options.systemInstruction - 系统指令
 * @param {array} options.conversationHistory - 对话历史
 * @param {string} options.openaiModel - OpenAI模型名称，默认'gpt-4o-mini'
 * @param {string} options.deepseekModel - DeepSeek模型名称，默认'deepseek-chat'
 * @param {string} options.bailianModel - 百炼模型名称，默认 qwen-plus
 * @returns {Promise<string>} AI响应文本
 */
export async function callGeminiAPI(prompt, options = {}) {
  const {
    provider = DEFAULT_AI_PROVIDER,
    usePro = false,
    temperature = 0.9,
    topP = 0.95,
    topK = 40,
    maxOutputTokens = 2048,
    useCache = true,
    systemInstruction = null,
    conversationHistory = [],
    openaiModel = 'gpt-4o-mini',
    deepseekModel = 'deepseek-chat',
    bailianModel = BAILIAN_MODEL_DEFAULT,
    retryCount = 0,
    maxRetries = 3
  } = options

  // 如果直接指定使用本地模型
  if (provider === 'local') {
    return await callLocalModel(prompt, options)
  }

  // 检查缓存
  if (useCache && retryCount === 0) {
    const cacheKey = generateCacheKey(prompt, { provider, usePro, temperature })
    const cached = getCachedResponse(cacheKey)
    if (cached) {
      console.log('[AI Cache Hit]', cacheKey.substring(0, 20))
      return cached
    }
  }

  // 选择可用的API Key并生成URL
  let currentKey = null
  let url = null
  let apiType = provider
  let useProxy = false // 是否使用代理（解决CORS问题）
  let activeModel = null // OpenAI 兼容接口使用的模型名
  
  // 如果所有云端API都失败，尝试使用本地模型作为兜底
  if (retryCount >= maxRetries && LOCAL_MODEL_CONFIG.fallbackEnabled && LOCAL_MODEL_CONFIG.enabled && apiType !== 'local') {
    console.warn('[AI] 所有云端API失败，尝试使用本地模型作为兜底')
    try {
      return await callLocalModel(prompt, options)
    } catch (localError) {
      console.error('[AI] 本地模型也失败:', localError)
      throw new Error(`所有AI服务不可用: ${localError.message}`)
    }
  }
  
  if (apiType === 'bailian') {
    const bailianConfig = getBailianURL(usePro ? BAILIAN_MODEL_PRO : bailianModel)
    url = bailianConfig.url
    currentKey = bailianConfig.key
    activeModel = bailianConfig.model
    useProxy = import.meta.env.DEV
  } else if (apiType === 'openai') {
    const openaiConfig = getOpenAIURL(openaiModel)
    // 开发环境使用代理，生产环境直接调用
    url = import.meta.env.DEV ? '/api/openai/chat/completions' : openaiConfig.url
    currentKey = openaiConfig.key
    activeModel = openaiModel
    useProxy = import.meta.env.DEV
  } else if (apiType === 'deepseek') {
    const deepseekConfig = getDeepSeekURL(deepseekModel)
    // 开发环境使用代理，生产环境直接调用
    url = import.meta.env.DEV ? '/api/deepseek/chat/completions' : deepseekConfig.url
    currentKey = deepseekConfig.key
    activeModel = deepseekModel
    useProxy = import.meta.env.DEV
  } else {
    currentKey = selectAvailableKey('gemini')
    url = getGeminiURL(usePro ? 'pro' : 'flash', currentKey)
    useProxy = false // Gemini API 支持CORS
  }

  if (!currentKey || !url) {
    if (LOCAL_MODEL_CONFIG.fallbackEnabled && LOCAL_MODEL_CONFIG.enabled) {
      console.warn(`[AI] ${apiType} 未配置 API Key，尝试使用本地模型兜底`)
      return await callLocalModel(prompt, options)
    }
    throw new Error(
      `未配置 ${apiType} API Key。请在 .env 中配置 VITE_BAILIAN_API_KEY 等变量，或启用本地模型。`,
    )
  }

  const requestFn = async () => {
    console.log('[AI] 开始API调用，provider:', apiType, 'usePro:', usePro, 'useProxy:', useProxy)
    let payload = {}
    let headers = {}
    
    if (apiType === 'openai' || apiType === 'deepseek' || apiType === 'bailian') {
      // OpenAI 兼容格式（百炼 / OpenAI / DeepSeek）
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentKey}`
      }
      
      const messages = conversationHistory.length > 0 
        ? conversationHistory.map(msg => {
            // 安全地提取消息内容
            let msgContent = ''
            if (msg.parts && Array.isArray(msg.parts) && msg.parts.length > 0) {
              const textPart = msg.parts.find(p => p && (p.text !== undefined && p.text !== null))
              msgContent = textPart ? textPart.text : (msg.content || '')
            } else {
              msgContent = msg.content || ''
            }
            return {
              role: msg.role === 'model' ? 'assistant' : msg.role,
              content: msgContent
            }
          })
        : [{ role: 'user', content: prompt }]
      
      if (systemInstruction) {
        messages.unshift({ role: 'system', content: systemInstruction })
      }
      
      const model = activeModel || (apiType === 'deepseek' ? deepseekModel : openaiModel)
      payload = {
        model: model,
        messages: messages,
        temperature: temperature,
        max_tokens: maxOutputTokens
      }
    } else {
      // Gemini格式 - 需要确保conversationHistory格式正确
      let contents = []
      
      if (conversationHistory.length > 0) {
        // 验证并转换conversationHistory格式
        contents = conversationHistory.map(msg => {
          // 如果已经是正确的格式（有parts），直接使用
          if (msg.parts && Array.isArray(msg.parts)) {
            return {
              role: msg.role === 'model' ? 'model' : (msg.role === 'user' ? 'user' : msg.role),
              parts: msg.parts
            }
          } else {
            // 转换为Gemini格式
            const role = msg.role === 'model' ? 'model' : (msg.role === 'assistant' ? 'model' : 'user')
            const content = msg.content || msg.parts?.[0]?.text || ''
            return {
              role: role,
              parts: [{ text: content }]
            }
          }
        })
      } else {
        // 没有历史记录，创建新的用户消息
        contents = [{
          role: 'user',
          parts: [{ text: prompt }]
        }]
      }
      
      // 如果conversationHistory不为空，添加当前prompt作为新的用户消息
      if (conversationHistory.length > 0) {
        contents.push({
          role: 'user',
          parts: [{ text: prompt }]
        })
      }
      
      payload = {
        contents: contents,
        generationConfig: {
          temperature,
          topP,
          topK,
          maxOutputTokens
        }
      }

      if (systemInstruction) {
        payload.systemInstruction = { parts: [{ text: systemInstruction }] }
      }
      
      headers = { 'Content-Type': 'application/json' }
      
      console.log('[AI] Gemini payload contents数量:', contents.length)
      console.log('[AI] Gemini payload contents格式:', JSON.stringify(contents).substring(0, 300))
    }

    console.log('[AI] 发送请求到:', url.substring(0, 80) + '...')
    console.log('[AI] 使用代理:', useProxy)
    console.log('[AI] 请求payload:', JSON.stringify(payload).substring(0, 200))
    
    // 如果使用代理，需要将Authorization header通过query参数传递（或使用其他方式）
    const fetchHeaders = { ...headers }
    
    // 如果使用代理，添加自定义header传递API Key，代理服务器会将其转换为Authorization header
    if (useProxy) {
      fetchHeaders['X-API-Key'] = currentKey
      // 移除Authorization header，因为代理会处理
      delete fetchHeaders['Authorization']
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: fetchHeaders,
      body: JSON.stringify(payload)
    })
    
    console.log('[AI] 收到响应，状态码:', response.status)

    if (!response.ok) {
      const errorText = await response.text()
      let errorData
      try {
        errorData = JSON.parse(errorText)
      } catch {
        errorData = { error: { message: errorText.substring(0, 200) } }
      }

      // 402错误：Payment Required，切换到其他可用 provider
      if (response.status === 402 && retryCount === 0) {
        recordKeyFailure(apiType, currentKey)
        const fallback = getFallbackProvider(apiType)
        if (fallback) {
          console.warn(`[AI] ${apiType} 402错误，切换到 ${fallback}`)
          await new Promise(resolve => setTimeout(resolve, 1000))
          return callGeminiAPI(prompt, { ...options, provider: fallback, retryCount: retryCount + 1 })
        }
      }

      // 401/403错误：API Key无效，切换到下一个key
      if ((response.status === 401 || response.status === 403) && retryCount < maxRetries) {
        recordKeyFailure(apiType, currentKey)
        console.warn(`[AI] ${response.status}错误，API Key可能无效，切换到下一个key (${retryCount + 1}/${maxRetries})`)
        
        // 尝试使用下一个key
        if (apiType === 'bailian') {
          const nextKey = selectAvailableKey('bailian')
          if (nextKey && nextKey !== currentKey) {
            await new Promise(resolve => setTimeout(resolve, 500))
            return callGeminiAPI(prompt, { ...options, retryCount: retryCount + 1 })
          }
        } else if (apiType === 'gemini') {
          const nextKey = selectAvailableKey('gemini')
          if (nextKey && nextKey !== currentKey) {
            await new Promise(resolve => setTimeout(resolve, 500))
            return callGeminiAPI(prompt, { ...options, retryCount: retryCount + 1 })
          }
        } else if (apiType === 'deepseek') {
          const nextKey = selectAvailableKey('deepseek')
          if (nextKey && nextKey !== currentKey) {
            await new Promise(resolve => setTimeout(resolve, 500))
            return callGeminiAPI(prompt, { ...options, retryCount: retryCount + 1 })
          }
        } else {
          const nextKey = selectAvailableKey('openai')
          if (nextKey && nextKey !== currentKey) {
            await new Promise(resolve => setTimeout(resolve, 500))
            return callGeminiAPI(prompt, { ...options, retryCount: retryCount + 1 })
          }
        }
      }

      // 503错误：模型过载，切换到 Pro 模型或重试
      if (response.status === 503 && (apiType === 'gemini' || apiType === 'bailian') && !usePro && retryCount < maxRetries) {
        console.warn(`[AI] 503错误，切换到Pro模型重试 (${retryCount + 1}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, 1500 * (retryCount + 1)))
        return callGeminiAPI(prompt, { ...options, usePro: true, retryCount: retryCount + 1 })
      }

      // 429错误：请求过于频繁，尝试切换key、切换provider或指数退避
      if (response.status === 429 && retryCount < maxRetries) {
        const fallback = getFallbackProvider(apiType)
        if (fallback && retryCount === 0) {
          console.warn(`[AI] ${apiType} 429错误，尝试切换到 ${fallback}`)
          try {
            const fallbackResult = await callGeminiAPI(prompt, { ...options, provider: fallback, retryCount: retryCount + 1 })
            return fallbackResult
          } catch (fallbackError) {
            console.warn(`[AI] ${fallback} 也失败:`, fallbackError.message)
          }
        }
        
        // 先尝试切换key
        if (apiType === 'bailian') {
          const nextKey = selectAvailableKey('bailian')
          if (nextKey && nextKey !== currentKey) {
            console.warn(`[AI] 429错误，切换到下一个key重试 (${retryCount + 1}/${maxRetries})`)
            await new Promise(resolve => setTimeout(resolve, 2000))
            return callGeminiAPI(prompt, { ...options, retryCount: retryCount + 1 })
          }
        } else if (apiType === 'gemini') {
          const nextKey = selectAvailableKey('gemini')
          if (nextKey && nextKey !== currentKey) {
            console.warn(`[AI] 429错误，切换到下一个key重试 (${retryCount + 1}/${maxRetries})`)
            await new Promise(resolve => setTimeout(resolve, 2000)) // 增加等待时间
            return callGeminiAPI(prompt, { ...options, retryCount: retryCount + 1 })
          }
        } else if (apiType === 'deepseek') {
          const nextKey = selectAvailableKey('deepseek')
          if (nextKey && nextKey !== currentKey) {
            console.warn(`[AI] 429错误，切换到下一个key重试 (${retryCount + 1}/${maxRetries})`)
            await new Promise(resolve => setTimeout(resolve, 2000))
            return callGeminiAPI(prompt, { ...options, retryCount: retryCount + 1 })
          }
        } else {
          const nextKey = selectAvailableKey('openai')
          if (nextKey && nextKey !== currentKey) {
            console.warn(`[AI] 429错误，切换到下一个key重试 (${retryCount + 1}/${maxRetries})`)
            await new Promise(resolve => setTimeout(resolve, 2000))
            return callGeminiAPI(prompt, { ...options, retryCount: retryCount + 1 })
          }
        }
        
        // 如果无法切换key，使用指数退避（增加等待时间）
        const waitTime = Math.pow(2, retryCount) * 3000 // 从2秒增加到3秒基础时间
        console.warn(`[AI] 429错误，${waitTime/1000}秒后重试 (${retryCount + 1}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
        return callGeminiAPI(prompt, { ...options, retryCount: retryCount + 1 })
      }
      
      // 402错误：Payment Required（如果之前没有处理）
      if (response.status === 402 && retryCount < maxRetries) {
        recordKeyFailure(apiType, currentKey)
        const fallback = getFallbackProvider(apiType)
        if (fallback) {
          console.warn(`[AI] 402错误，切换到 ${fallback} (${retryCount + 1}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, 1000))
          return callGeminiAPI(prompt, { ...options, provider: fallback, retryCount: retryCount + 1 })
        }
      }

      // 如果所有API都失败，尝试使用本地模型作为兜底
      if (retryCount >= maxRetries && LOCAL_MODEL_CONFIG.fallbackEnabled && LOCAL_MODEL_CONFIG.enabled) {
        console.warn('[AI] 所有云端API失败，尝试使用本地模型作为兜底')
        try {
          return await callLocalModel(prompt, options)
        } catch (localError) {
          console.error('[AI] 本地模型也失败:', localError)
        }
      }
      
      // 记录key失败
      recordKeyFailure(apiType, currentKey)
      throw new Error(`API错误 ${response.status}: ${errorData.error?.message || JSON.stringify(errorData).substring(0, 200)}`)
    }

    const data = await response.json()

    if (data.error) {
      // 402错误：Payment Required
      if (data.error.code === 402 && retryCount < maxRetries) {
        recordKeyFailure(apiType, currentKey)
        const fallback = getFallbackProvider(apiType)
        if (fallback) {
          console.warn(`[AI] 402错误，切换到 ${fallback} (${retryCount + 1}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, 1000))
          return callGeminiAPI(prompt, { ...options, provider: fallback, retryCount: retryCount + 1 })
        }
      }
      
      // 401/403错误：API Key无效
      if ((data.error.code === 401 || data.error.code === 403) && retryCount < maxRetries) {
        recordKeyFailure(apiType, currentKey)
        console.warn(`[AI] API Key错误，切换到下一个key (${retryCount + 1}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, 500))
        return callGeminiAPI(prompt, { ...options, retryCount: retryCount + 1 })
      }
      
      // 503错误：模型过载
      if (data.error.code === 503 && (apiType === 'gemini' || apiType === 'bailian') && !usePro && retryCount < maxRetries) {
        console.warn(`[AI] 503错误，切换到Pro模型重试 (${retryCount + 1}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, 1500 * (retryCount + 1)))
        return callGeminiAPI(prompt, { ...options, usePro: true, retryCount: retryCount + 1 })
      }
      
      // 如果所有API都失败，尝试使用本地模型作为兜底
      if (retryCount >= maxRetries && LOCAL_MODEL_CONFIG.fallbackEnabled && LOCAL_MODEL_CONFIG.enabled) {
        console.warn('[AI] 所有云端API失败，尝试使用本地模型作为兜底')
        try {
          return await callLocalModel(prompt, options)
        } catch (localError) {
          console.error('[AI] 本地模型也失败:', localError)
        }
      }
      
      recordKeyFailure(apiType, currentKey)
      throw new Error(`API错误: ${data.error.message || JSON.stringify(data.error)}`)
    }

    // 解析响应
    console.log('[AI] 解析响应数据...')
    console.log('[AI] 完整响应数据（前1500字符）:', JSON.stringify(data, null, 2).substring(0, 1500))
    let text = null
    if (apiType === 'openai' || apiType === 'deepseek' || apiType === 'bailian') {
      // OpenAI 兼容格式
      if (data.choices && Array.isArray(data.choices) && data.choices.length > 0 && data.choices[0] && data.choices[0].message) {
        text = data.choices[0].message.content
      } else {
        const providerLabel = apiType === 'bailian' ? '百炼' : (apiType === 'deepseek' ? 'DeepSeek' : 'OpenAI')
        console.error(`[AI] ${providerLabel}响应格式错误:`, JSON.stringify(data))
        recordKeyFailure(apiType, currentKey)
        throw new Error(`${providerLabel} API返回数据格式错误`)
      }
    } else {
      // Gemini API响应格式处理
      console.log('[AI] Gemini响应数据:', {
        hasCandidates: !!data.candidates,
        candidatesType: Array.isArray(data.candidates) ? 'array' : typeof data.candidates,
        candidatesLength: Array.isArray(data.candidates) ? data.candidates.length : 'N/A',
        firstCandidate: data.candidates && Array.isArray(data.candidates) && data.candidates[0] ? data.candidates[0] : 'N/A'
      })
      
      if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
        console.error('[AI] Gemini响应格式错误：candidates不存在或为空:', JSON.stringify(data))
        recordKeyFailure(apiType, currentKey)
        throw new Error('Gemini API返回数据格式错误：candidates不存在或为空')
      }
      
      const firstCandidate = data.candidates[0]
      if (!firstCandidate || !firstCandidate.content) {
        console.error('[AI] Gemini响应格式错误：candidates[0]或content不存在:', JSON.stringify(firstCandidate))
        recordKeyFailure(apiType, currentKey)
        throw new Error('Gemini API返回数据格式错误：candidates[0]或content不存在')
      }
      
      const content = firstCandidate.content
      const finishReason = firstCandidate.finishReason
      
      console.log('[AI] 完整响应数据:', JSON.stringify(data, null, 2).substring(0, 1000))
      console.log('[AI] FirstCandidate完整数据:', JSON.stringify(firstCandidate, null, 2))
      console.log('[AI] Content完整结构:', JSON.stringify(content, null, 2))
      console.log('[AI] Content结构:', {
        hasParts: !!content.parts,
        partsType: Array.isArray(content.parts) ? 'array' : typeof content.parts,
        partsLength: Array.isArray(content.parts) ? content.parts.length : 'N/A',
        hasText: !!content.text,
        role: content.role,
        finishReason: finishReason,
        allKeys: Object.keys(content),
        fullContent: JSON.stringify(content)
      })
      
      // 检查finishReason，如果是SAFETY或其他错误，说明生成被阻止
      if (finishReason && finishReason !== 'STOP') {
        console.warn(`[AI] Gemini响应完成原因: ${finishReason}`)
        if (finishReason === 'SAFETY') {
          recordKeyFailure(apiType, currentKey)
          throw new Error('内容被安全过滤器阻止，请尝试重新表述您的问题')
        } else if (finishReason === 'RECITATION') {
          recordKeyFailure(apiType, currentKey)
          throw new Error('检测到重复内容，请尝试重新表述您的问题')
        } else if (finishReason === 'MAX_TOKENS') {
          console.warn('[AI] 响应达到最大token限制')
        }
      }
      
      // 检查是否有usageMetadata，这可能包含有用的信息
      if (data.usageMetadata) {
        console.log('[AI] 使用统计:', data.usageMetadata)
      }
      
      // 检查promptFeedback，看是否有阻止信息
      if (data.promptFeedback) {
        console.log('[AI] Prompt反馈:', data.promptFeedback)
        if (data.promptFeedback.blockReason) {
          console.warn('[AI] 内容被阻止，原因:', data.promptFeedback.blockReason)
          recordKeyFailure(apiType, currentKey)
          throw new Error(`内容被阻止: ${data.promptFeedback.blockReason}`)
        }
      }
      
      // 安全地访问parts数组
      if (content.parts && Array.isArray(content.parts) && content.parts.length > 0) {
        // 查找包含text的part
        const textPart = content.parts.find(part => part && part.text !== undefined && part.text !== null)
        if (textPart) {
          text = textPart.text
          console.log('[AI] 从parts中提取到文本，长度:', text.length)
        } else {
          console.error('[AI] Gemini响应中parts数组没有包含text字段:', JSON.stringify(content.parts))
          // 检查parts中是否有其他类型的content
          const hasFunctionCall = content.parts.some(p => p.functionCall)
          const hasFunctionResponse = content.parts.some(p => p.functionResponse)
          if (hasFunctionCall || hasFunctionResponse) {
            console.warn('[AI] 响应包含函数调用，不是文本响应')
            text = '这是一个函数调用响应，请查看详细日志'
          } else if (finishReason === 'STOP') {
            text = '' // 允许空响应
            console.warn('[AI] Gemini返回了空响应（finishReason: STOP）')
          } else {
            recordKeyFailure(apiType, currentKey)
            throw new Error('Gemini API返回数据格式错误：parts中没有text字段')
          }
        }
      } else if (content.text) {
        // 尝试直接访问text字段（某些情况下可能直接存在）
        text = content.text
        console.log('[AI] 从content.text中提取到文本，长度:', text.length)
      } else {
        // 如果只有role字段，可能是空响应或响应格式问题
        const contentKeys = Object.keys(content)
        console.warn('[AI] Content对象只有这些字段:', contentKeys)
        
        if (contentKeys.length === 1 && content.role === 'model') {
          console.warn('[AI] Gemini返回了只包含role的空响应')
          // 检查是否是请求格式问题 - 可能需要使用generateContent而不是chat
          // 但首先，检查是否是安全过滤或其他问题
          if (finishReason === 'STOP') {
            // 可能是API返回了空响应，尝试使用本地模型作为fallback
            console.warn('[AI] Gemini返回空响应，尝试使用本地模型')
            if (LOCAL_MODEL_CONFIG.enabled && LOCAL_MODEL_CONFIG.fallbackEnabled) {
              try {
                const localResult = await callLocalModel(prompt, options)
                if (localResult) {
                  console.log('[AI] 本地模型fallback成功')
                  return localResult
                }
              } catch (localError) {
                console.error('[AI] 本地模型fallback也失败:', localError)
              }
            }
            text = '' // 允许空响应，稍后会设置默认消息
          } else {
            recordKeyFailure(apiType, currentKey)
            throw new Error('Gemini API返回了空响应，请稍后重试')
          }
        } else {
          console.error('[AI] Gemini响应格式错误，parts为空且没有text字段:', JSON.stringify(content))
          recordKeyFailure(apiType, currentKey)
          throw new Error('Gemini API返回数据格式错误：parts数组为空且没有text字段')
        }
      }
      
      // 如果text为空字符串，提供友好的提示
      if (!text || text.trim().length === 0) {
        console.warn('[AI] Gemini返回了空文本响应')
        text = '抱歉，我无法生成合适的回复，请尝试重新表述您的问题。'
      }
    }

    // 最终验证text是否有效
    if (!text || typeof text !== 'string') {
      console.error('[AI] 解析后的text无效:', text)
      recordKeyFailure(apiType, currentKey)
      throw new Error('AI返回的数据格式错误，无法提取文本内容')
    }
    
    console.log('[AI] 成功获取响应，长度:', text.length)

    // 记录key成功
    recordKeySuccess(apiType, currentKey)

    // 缓存响应
    if (useCache && retryCount === 0) {
      const cacheKey = generateCacheKey(prompt, { provider, usePro, temperature })
      setCachedResponse(cacheKey, text)
    }

    return text
  }

  return queueRequest(requestFn)
}

/**
 * 批量调用AI（优化性能）
 * @param {Array<{prompt: string, options?: object}>} requests - 请求数组
 * @returns {Promise<Array<string>>} 响应数组
 */
export async function batchCallGeminiAPI(requests) {
  const results = await Promise.allSettled(
    requests.map(req => callGeminiAPI(req.prompt, req.options || {}))
  )

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return { success: true, data: result.value, index }
    } else {
      console.error(`[AI Batch] 请求 ${index} 失败:`, result.reason)
      return { success: false, error: result.reason.message, index }
    }
  })
}

/**
 * 流式响应支持（实验性）
 * @param {string} prompt - 用户提示词
 * @param {object} options - 配置选项
 * @param {function} onChunk - 接收数据块的回调函数
 * @returns {Promise<void>}
 */
export async function streamGeminiAPI(prompt, options = {}, onChunk) {
  // 注意：Gemini API的流式响应需要使用不同的端点
  // 这里提供一个基础实现框架
  console.warn('[AI Stream] 流式响应功能正在开发中')
  
  // 临时实现：使用普通调用，然后模拟流式输出
  const fullResponse = await callGeminiAPI(prompt, options)
  const chunks = fullResponse.split(/(?<=[。！？\n])/)
  
  for (const chunk of chunks) {
    if (chunk.trim()) {
      await new Promise(resolve => setTimeout(resolve, 50))
      onChunk(chunk)
    }
  }
}

/**
 * 提取JSON数据（增强版）
 * @param {string} text - AI返回的文本
 * @returns {object} 解析后的JSON对象
 */
export function extractJSON(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('AI返回的数据为空或格式不正确')
  }

  let jsonText = text.trim()

  // 移除markdown代码块标记
  if (jsonText.includes('```json')) {
    const parts = jsonText.split('```json')
    if (parts.length > 1) {
      jsonText = parts[1].split('```')[0].trim()
    }
  } else if (jsonText.includes('```')) {
    const parts = jsonText.split('```')
    if (parts.length > 1) {
      jsonText = parts[1].split('```')[0].trim()
    }
  }

  // 如果内容太短，可能是被截断了
  if (jsonText.length < 50) {
    console.warn('[extractJSON] 响应内容可能不完整，长度:', jsonText.length)
    console.warn('[extractJSON] 内容预览:', jsonText.substring(0, 200))
  }

  // 尝试解析JSON
  try {
    const parsed = JSON.parse(jsonText)
    return parsed
  } catch (e) {
    // 如果解析失败，尝试提取JSON对象（使用更宽松的匹配）
    let jsonMatch = jsonText.match(/\{[\s\S]*\}/)
    
    // 如果没找到完整的JSON，尝试查找第一个 { 到最后一个可能的 }
    if (!jsonMatch && jsonText.includes('{')) {
      const startIdx = jsonText.indexOf('{')
      // 尝试从最后一个 } 往前匹配
      const lastBraceIdx = jsonText.lastIndexOf('}')
      if (lastBraceIdx > startIdx) {
        jsonMatch = [jsonText.substring(startIdx, lastBraceIdx + 1)]
      }
    }

    if (jsonMatch) {
      try {
        let candidate = jsonMatch[0]
        // 如果JSON不完整，尝试修复常见的截断情况
        if (!candidate.endsWith('}')) {
          // 尝试找到最后一个完整的字段
          const lastQuote = candidate.lastIndexOf('"')
          const lastColon = candidate.lastIndexOf(':')
          if (lastColon > lastQuote) {
            // 可能有未完成的字段，尝试修复
            candidate = candidate.substring(0, candidate.lastIndexOf(','))
            candidate += '\n}'
          } else {
            candidate += '\n}'
          }
        }
        
        const parsed = JSON.parse(candidate)
        console.warn('[extractJSON] 成功从部分内容中提取JSON')
        return parsed
      } catch (e2) {
        console.error('[extractJSON] JSON解析失败:', e2)
        console.error('[extractJSON] 尝试解析的内容:', jsonMatch[0].substring(0, 500))
        throw new Error(`无法解析AI返回的JSON格式数据: ${e2.message}`)
      }
    }
    
    console.error('[extractJSON] 未找到有效的JSON内容')
    console.error('[extractJSON] 原始内容:', jsonText.substring(0, 500))
    throw new Error('AI返回的数据格式不正确：未找到有效的JSON结构')
  }
}

/**
 * 构建对话历史
 * @param {Array<{role: string, content: string}>} messages - 消息数组
 * @returns {Array<{role: string, parts: Array}>} Gemini格式的对话历史
 */
export function buildConversationHistory(messages) {
  return messages
    .filter(msg => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'model')
    .map(msg => ({
      role: msg.role === 'assistant' ? 'model' : msg.role,
      parts: [{ text: msg.content || msg.rawText || '' }]
    }))
}

/**
 * 优化提示词（添加上下文、格式化等）
 * @param {string} basePrompt - 基础提示词
 * @param {object} context - 上下文数据
 * @returns {string} 优化后的提示词
 */
export function enhancePrompt(basePrompt, context = {}) {
  let enhanced = basePrompt

  // 添加时间上下文
  const now = new Date()
  enhanced += `\n\n当前时间：${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`

  // 添加数据上下文
  if (context.data) {
    enhanced += `\n\n=== 数据上下文 ===\n${JSON.stringify(context.data, null, 2).substring(0, 2000)}`
  }

  // 添加角色上下文
  if (context.persona) {
    enhanced += `\n\n=== 角色设定 ===\n${context.persona}`
  }

  return enhanced
}

/**
 * 清理缓存
 */
export function clearCache() {
  requestCache.clear()
  console.log('[AI Cache] 缓存已清理')
}

/**
 * 获取缓存统计
 */
export function getCacheStats() {
  return {
    size: requestCache.size,
    maxSize: 1000, // 最大缓存条目数
    ttl: CACHE_TTL
  }
}

/**
 * 获取API Key状态统计
 */
export function getKeyStats() {
  const mapKeys = (list) => list.map(k => ({
    key: k.key.substring(0, 20) + '...',
    failures: k.failures,
    successCount: k.successCount,
    lastFailure: k.lastFailure ? new Date(k.lastFailure).toISOString() : null,
    isAvailable: k.failures <= 5 && (k.lastFailure === 0 || Date.now() - k.lastFailure > KEY_RECOVERY_TIME)
  }))
  return {
    bailian: mapKeys(keyStatus.bailian),
    gemini: mapKeys(keyStatus.gemini),
    openai: mapKeys(keyStatus.openai),
    deepseek: mapKeys(keyStatus.deepseek),
  }
}

/**
 * 重置API Key状态
 */
export function resetKeyStatus(type = null) {
  if (type === 'bailian' || type === null) {
    keyStatus.bailian.forEach(k => {
      k.failures = 0
      k.lastFailure = 0
      k.successCount = 0
    })
  }
  if (type === 'gemini' || type === null) {
    keyStatus.gemini.forEach(k => {
      k.failures = 0
      k.lastFailure = 0
      k.successCount = 0
    })
  }
  if (type === 'openai' || type === null) {
    keyStatus.openai.forEach(k => {
      k.failures = 0
      k.lastFailure = 0
      k.successCount = 0
    })
  }
  console.log('[AI] API Key状态已重置')
}

/**
 * 添加新的API Key
 */
export function addAPIKey(key, type = 'bailian') {
  if (type === 'bailian') {
    if (!BAILIAN_API_KEYS.includes(key)) {
      BAILIAN_API_KEYS.push(key)
      keyStatus.bailian.push({ key, failures: 0, lastFailure: 0, successCount: 0 })
      console.log('[AI] 已添加新的百炼 API Key')
    }
  } else if (type === 'gemini') {
    if (!GEMINI_API_KEYS.includes(key)) {
      GEMINI_API_KEYS.push(key)
      keyStatus.gemini.push({ key, failures: 0, lastFailure: 0, successCount: 0 })
      console.log('[AI] 已添加新的Gemini API Key')
    }
  } else if (type === 'openai') {
    if (!OPENAI_API_KEYS.includes(key)) {
      OPENAI_API_KEYS.push(key)
      keyStatus.openai.push({ key, failures: 0, lastFailure: 0, successCount: 0 })
      console.log('[AI] 已添加新的OpenAI API Key')
    }
  } else if (type === 'deepseek') {
    if (!DEEPSEEK_API_KEYS.includes(key)) {
      DEEPSEEK_API_KEYS.push(key)
      keyStatus.deepseek.push({ key, failures: 0, lastFailure: 0, successCount: 0 })
      console.log('[AI] 已添加新的DeepSeek API Key')
    }
  }
}

export default {
  callGeminiAPI,
  batchCallGeminiAPI,
  streamGeminiAPI,
  extractJSON,
  buildConversationHistory,
  enhancePrompt,
  clearCache,
  getCacheStats,
  getKeyStats,
  resetKeyStatus,
  addAPIKey,
  getAIProviderConfigStatus,
}
