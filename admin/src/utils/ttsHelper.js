/**
 * 文字转语音工具模块 - 优化版
 * 基于Web Speech API，提供自然、真实的人声合成
 * 
 * 参考：
 * - GitHub: ChatTTS (自然语音合成)
 * - GitHub: GPT-SoVITS (高质量语音生成)
 * - Web Speech API (浏览器原生TTS)
 */

// 语音配置预设（以真实人声为目标：神经/自然语音优先，语速略慢、音调中性）
const VOICE_CONFIGS = {
  // 真实人声优先 - 神经/自然语音（推荐，减少机器人感）
  naturalHuman: {
    name: [
      'Yunxi', 'Microsoft Yunxi', 'Yunyang', 'Microsoft Yunyang',
      'Xiaoxiao', 'Microsoft Xiaoxiao', 'Xiaoyi', 'Microsoft Xiaoyi',
      'Yaoyao', 'Microsoft Yaoyao', 'Huihui', 'Microsoft Huihui'
    ],
    rate: 0.86,     // 略慢更接近真人对话，避免机械感
    pitch: 1.0,     // 中性音调，减少电子感
    volume: 0.86,
    lang: 'zh-CN'
  },
  // 年轻女声 - 柔和自然
  youngFemale: {
    name: ['Microsoft Yaoyao', 'Yaoyao', 'Microsoft Xiaoxiao', 'Xiaoxiao', 'Microsoft Yunxi', 'Yunxi'],
    rate: 0.86,
    pitch: 1.02,
    volume: 0.86,
    lang: 'zh-CN'
  },
  // 成熟女声 - 专业稳重
  matureFemale: {
    name: ['Microsoft Huihui', 'Huihui', 'Microsoft Xiaoyi', 'Xiaoyi'],
    rate: 0.85,
    pitch: 1.0,
    volume: 0.86,
    lang: 'zh-CN'
  },
  // 年轻男声 - 清晰有力
  youngMale: {
    name: ['Microsoft Yunyang', 'Yunyang', 'Microsoft Kangkang', 'Kangkang'],
    rate: 0.88,
    pitch: 0.98,
    volume: 0.86,
    lang: 'zh-CN'
  },
  // 默认配置 - 与 naturalHuman 一致，追求真实人声
  default: {
    name: [
      'Yunxi', 'Microsoft Yunxi', 'Yunyang', 'Microsoft Yunyang',
      'Xiaoxiao', 'Microsoft Xiaoxiao', 'Yaoyao', 'Microsoft Yaoyao',
      'Huihui', 'Microsoft Huihui', 'Xiaoyi', 'Microsoft Xiaoyi'
    ],
    rate: 0.86,
    pitch: 1.0,
    volume: 0.86,
    lang: 'zh-CN'
  }
}

/**
 * 文本预处理 - 优化语音合成效果
 */
export function preprocessTextForTTS(text) {
  if (!text) return ''
  
  let processed = String(text)
  
  // 1. 移除Markdown语法标记
  processed = processed
    .replace(/```[\s\S]*?```/g, '代码块') // 代码块
    .replace(/`([^`]+)`/g, '$1')           // 行内代码
    .replace(/\*\*([^*]+)\*\*/g, '$1')     // 粗体
    .replace(/\*([^*]+)\*/g, '$1')         // 斜体
    .replace(/#{1,6}\s+/g, '')            // 标题标记
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // 链接
  
  // 2. 处理特殊字符和标点
  processed = processed
    .replace(/\n{3,}/g, '\n\n')            // 多个换行合并
    .replace(/\s{2,}/g, ' ')               // 多个空格合并
    .replace(/[，,]\s*[，,]+/g, '，')      // 重复逗号
    .replace(/[。.]\s*[。.]+/g, '。')      // 重复句号
  
  // 3. 数字和单位处理（更自然的读法）
  processed = processed
    .replace(/(\d+)\s*元/g, '$1元')        // 金额
    .replace(/(\d+)\s*%/g, '$1百分比')     // 百分比
    .replace(/(\d+)\s*件/g, '$1件')        // 数量
    .replace(/(\d+)\s*个/g, '$1个')        // 数量
  
  // 4. 添加适当的停顿（长句分割）
  processed = processed.replace(/([。！？；])([^。！？；\n]{50,})/g, '$1$2')
  
  return processed.trim()
}

/**
 * 等待语音列表加载
 */
export async function waitForVoices(synth, timeout = 3000) {
  return new Promise((resolve) => {
    let voices = synth.getVoices()
    if (voices.length > 0) {
      resolve(voices)
      return
    }
    
    const startTime = Date.now()
    const checkVoices = () => {
      voices = synth.getVoices()
      if (voices.length > 0 || Date.now() - startTime > timeout) {
        resolve(voices)
      } else {
        setTimeout(checkVoices, 100)
      }
    }
    
    synth.onvoiceschanged = () => {
      voices = synth.getVoices()
      resolve(voices)
    }
    
    setTimeout(checkVoices, 100)
  })
}

/**
 * 选择最佳语音（真实人声优先：神经/自然 > 配置列表 > 高质量厂商 > 任意中文）
 */
export function selectBestVoice(voices, config = VOICE_CONFIGS.default) {
  if (!voices || voices.length === 0) return null

  const chineseVoices = voices.filter(v =>
    v.lang && (v.lang.includes('zh') || v.lang.includes('CN'))
  )
  if (chineseVoices.length === 0) return null

  const nameLower = (v) => (v.name || '').toLowerCase()

  // 1. 最优先：神经/自然/在线语音（真实人声感最强）
  const neuralOrNatural = chineseVoices.filter(v => {
    const n = nameLower(v)
    return n.includes('neural') || n.includes('natural') || n.includes('online')
  })
  if (neuralOrNatural.length > 0) {
    // 在神经语音中再优选中英文名常见的自然音色
    const preferred = neuralOrNatural.find(v => nameLower(v).includes('yunxi')) ||
      neuralOrNatural.find(v => nameLower(v).includes('yunyang')) ||
      neuralOrNatural.find(v => nameLower(v).includes('xiaoxiao')) ||
      neuralOrNatural[0]
    console.log(`[TTS] 选择神经/自然语音: ${preferred.name}`)
    return preferred
  }

  // 2. 按配置的优先名称列表匹配（多为高质量中文音色）
  for (const preferredName of config.name) {
    const voice = chineseVoices.find(v =>
      nameLower(v).includes(preferredName.toLowerCase())
    )
    if (voice) {
      console.log(`[TTS] 选择语音: ${voice.name}`)
      return voice
    }
  }

  // 3. 高质量厂商语音
  const qualityVoices = chineseVoices.filter(v => {
    const n = nameLower(v)
    return n.includes('microsoft') || n.includes('google')
  })
  if (qualityVoices.length > 0) {
    console.log(`[TTS] 选择高质量语音: ${qualityVoices[0].name}`)
    return qualityVoices[0]
  }

  console.log(`[TTS] 选择默认中文语音: ${chineseVoices[0].name}`)
  return chineseVoices[0]
}

/**
 * 创建语音合成实例（优化版）
 */
export function createOptimizedUtterance(text, options = {}) {
  if (!window.SpeechSynthesisUtterance) {
    throw new Error('浏览器不支持语音合成')
  }
  
  // 文本预处理
  const processedText = preprocessTextForTTS(text)
  if (!processedText || processedText.trim().length === 0) {
    throw new Error('文本为空')
  }
  
  // 使用配置或默认配置
  const voiceConfig = options.voiceConfig || VOICE_CONFIGS.default
  
  const utterance = new SpeechSynthesisUtterance(processedText)
  utterance.lang = voiceConfig.lang || 'zh-CN'
  
  // 真实人声向参数：略慢语速、中性音调
  utterance.rate = Math.max(0.7, Math.min(1.15, options.rate ?? voiceConfig.rate ?? 0.86))
  utterance.pitch = Math.max(0.85, Math.min(1.2, options.pitch ?? voiceConfig.pitch ?? 1.0))
  utterance.volume = Math.max(0.6, Math.min(1.0, options.volume ?? voiceConfig.volume ?? 0.86))
  
  return utterance
}

/**
 * 高级语音合成类
 */
export class AdvancedTTS {
  constructor(options = {}) {
    this.synth = window.speechSynthesis || null
    this.currentUtterance = null
    this.voices = []
    this.voiceConfig = options.voiceConfig || VOICE_CONFIGS.default
    this.onStart = options.onStart || null
    this.onEnd = options.onEnd || null
    this.onError = options.onError || null
    
    this.init()
  }
  
  async init() {
    if (!this.synth) {
      console.warn('[TTS] 浏览器不支持语音合成')
      return
    }
    
    // 加载语音列表
    this.voices = await waitForVoices(this.synth)
    console.log(`[TTS] 加载了 ${this.voices.length} 个语音`)
    
    // 选择最佳语音
    const selectedVoice = selectBestVoice(this.voices, this.voiceConfig)
    if (selectedVoice) {
      this.selectedVoice = selectedVoice
    }
  }
  
  /**
   * 合成并播放语音
   */
  async speak(text, options = {}) {
    if (!this.synth) {
      throw new Error('语音合成不可用')
    }
    
    // 停止当前播放
    this.stop()
    
    try {
      // 创建优化后的语音实例
      const utterance = createOptimizedUtterance(text, {
        ...options,
        voiceConfig: this.voiceConfig
      })
      
      // 设置选择的语音
      if (this.selectedVoice) {
        utterance.voice = this.selectedVoice
      }
      
      // 事件处理
      utterance.onstart = () => {
        console.log('[TTS] 开始播放')
        if (this.onStart) this.onStart()
      }
      
      utterance.onend = () => {
        console.log('[TTS] 播放结束')
        this.currentUtterance = null
        if (this.onEnd) this.onEnd()
      }
      
      utterance.onerror = (error) => {
        console.error('[TTS] 播放错误:', error)
        this.currentUtterance = null
        if (this.onError) this.onError(error)
      }
      
      // 保存引用并播放
      this.currentUtterance = utterance
      this.synth.speak(utterance)
      
    } catch (error) {
      console.error('[TTS] 合成失败:', error)
      throw error
    }
  }
  
  /**
   * 停止播放
   */
  stop() {
    if (this.synth && this.currentUtterance) {
      this.synth.cancel()
      this.currentUtterance = null
    }
  }
  
  /**
   * 暂停播放
   */
  pause() {
    if (this.synth && this.synth.speaking) {
      this.synth.pause()
    }
  }
  
  /**
   * 恢复播放
   */
  resume() {
    if (this.synth && this.synth.paused) {
      this.synth.resume()
    }
  }
  
  /**
   * 检查是否正在播放
   */
  isSpeaking() {
    return this.synth && this.synth.speaking && !this.synth.paused
  }
  
  /**
   * 切换语音配置
   */
  setVoiceConfig(configName) {
    if (VOICE_CONFIGS[configName]) {
      this.voiceConfig = VOICE_CONFIGS[configName]
      // 重新选择语音
      this.selectedVoice = selectBestVoice(this.voices, this.voiceConfig)
      console.log(`[TTS] 切换到语音配置: ${configName}`)
    }
  }
  
  /**
   * 获取可用语音列表
   */
  getAvailableVoices() {
    return this.voices.filter(v => 
      v.lang && (v.lang.includes('zh') || v.lang.includes('CN'))
    )
  }
}

/**
 * 创建TTS实例（单例模式）
 */
let ttsInstance = null

export function getTTSInstance(options = {}) {
  if (!ttsInstance && window.speechSynthesis) {
    ttsInstance = new AdvancedTTS(options)
  }
  return ttsInstance
}

/**
 * 快速语音播放（便捷方法）
 */
export async function quickSpeak(text, options = {}) {
  const tts = getTTSInstance()
  if (!tts) {
    console.warn('[TTS] 语音合成不可用')
    return
  }
  
  try {
    await tts.speak(text, options)
  } catch (error) {
    console.error('[TTS] 播放失败:', error)
  }
}

// 导出配置供外部使用
export { VOICE_CONFIGS }



