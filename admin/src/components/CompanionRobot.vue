<template>
  <div class="companion-robot" :class="{ 
    'is-active': isActive, 
    'is-thinking': isThinking,
    'is-listening': isListening,
    'is-speaking': isSpeaking,
    'mood-happy': currentMood === 'happy',
    'mood-excited': currentMood === 'excited',
    'mood-calm': currentMood === 'calm'
  }">
    <!-- 机器人固定区域 -->
    <div class="robot-container">
      <!-- 机器人图标 - 3D效果 -->
      <div 
        class="robot-icon-wrapper"
        @click="openChatDialog"
        @mouseenter="handleHover"
        @mouseleave="handleLeave"
      >
        <div class="robot-icon-3d">
          <img 
            src="/robot-icon.svg" 
            alt="马上有" 
            class="robot-image"
            :class="{ 
              'bounce': isBouncing, 
              'listening': isListening,
              'speaking': isSpeaking,
              'thinking': isThinking
            }"
          />
          <!-- 情感指示器 -->
          <div v-if="currentMood" class="mood-indicator" :class="`mood-${currentMood}`">
            <div class="mood-icon">{{ moodIcons[currentMood] }}</div>
          </div>
        </div>
        
        <!-- 语音识别状态指示 - 增强版 -->
        <div v-if="isListening" class="listening-indicator-enhanced">
          <div class="listening-ring ring-1"></div>
          <div class="listening-ring ring-2"></div>
          <div class="listening-waves">
            <div class="listening-wave wave-1"></div>
            <div class="listening-wave wave-2"></div>
            <div class="listening-wave wave-3"></div>
          </div>
        </div>
      </div>

      <!-- 状态指示器 - 增强版 -->
      <transition name="fade">
        <div v-if="isThinking" class="thinking-indicator-enhanced">
          <div class="thinking-orb orb-1"></div>
          <div class="thinking-orb orb-2"></div>
          <div class="thinking-orb orb-3"></div>
          <div class="thinking-text">思考中...</div>
        </div>
      </transition>
      
      <!-- 语音控制按钮 - 增强版 -->
      <div class="voice-controls-enhanced">
        <el-button 
          :type="isListening ? 'danger' : 'primary'"
          circle
          size="small"
          @click="toggleVoiceRecognition"
          :title="isListening ? '停止语音识别' : '开始语音识别'"
          class="voice-btn-enhanced"
          :class="{ 'pulsing': isListening }"
        >
          <el-icon><Microphone /></el-icon>
        </el-button>
        <el-button 
          type="info"
          circle
          size="small"
          @click="toggleAutoVoice"
          :title="autoVoiceEnabled ? '关闭自动播报' : '开启自动播报'"
          :class="{ 'active': autoVoiceEnabled }"
          class="voice-btn-enhanced"
        >
          <el-icon><VideoPlay /></el-icon>
        </el-button>
        <el-button 
          type="success"
          circle
          size="small"
          @click="showSkillsPanel = !showSkillsPanel"
          :title="'技能面板'"
          class="voice-btn-enhanced"
        >
          <el-icon><Grid /></el-icon>
        </el-button>
      </div>
    </div>

    <!-- 技能面板 - 对标小爱同学和Alexa -->
    <transition name="slide-fade">
      <div v-if="showSkillsPanel" class="skills-panel" @click.stop>
        <div class="skills-header">
          <h3>技能与快捷指令</h3>
          <el-button text size="small" @click="showSkillsPanel = false">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
        <div class="skills-grid">
          <div 
            v-for="skill in availableSkills" 
            :key="skill.id"
            class="skill-card"
            :class="{ 'active': skill.active, [`category-${skill.category}`]: true }"
            @click="activateSkill(skill)"
          >
            <div class="skill-icon">{{ skill.icon }}</div>
            <div class="skill-name">{{ skill.name }}</div>
            <div class="skill-desc">{{ skill.desc }}</div>
            <div class="skill-shortcut">{{ skill.shortcut }}</div>
          </div>
        </div>
      </div>
    </transition>

    <!-- 对话气泡 - 增强版 -->
    <transition name="bubble-enhanced">
      <div 
        v-if="showMessage" 
        class="message-bubble-enhanced"
        :class="{ 
          'is-ai-response': isAIResponse,
          'has-actions': showActions,
          [`mood-${currentMood}`]: currentMood
        }"
        @click.stop
      >
        <div class="bubble-content-enhanced">
          <div class="bubble-header-enhanced">
            <div class="bubble-avatar">
              <img src="/robot-icon.svg" alt="AI" />
            </div>
            <div class="bubble-info">
              <div v-if="isAIResponse" class="ai-label-enhanced">
                <span class="label-icon" aria-hidden="true">◇</span>
                <span>经营助理</span>
                <span v-if="currentMood" class="mood-badge" :class="`mood-${currentMood}`">
                  {{ moodLabels[currentMood] }}
                </span>
              </div>
              <div class="bubble-time">{{ currentTime }}</div>
            </div>
            <el-button 
              text 
              size="small" 
              class="bubble-close-btn-enhanced"
              @click="closeMessage"
            >
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
          
          <div class="message-text-enhanced" v-html="formatMessage(currentMessage)"></div>
          
          <!-- 快速操作按钮 -->
          <div v-if="showActions" class="bubble-actions-enhanced">
            <el-button 
              size="small" 
              type="primary" 
              @click="handleAIAction('analyze')"
              class="action-btn"
            >
              <el-icon><DataAnalysis /></el-icon>
              数据分析
            </el-button>
            <el-button 
              size="small" 
              @click="handleAIAction('suggest')"
              class="action-btn"
            >
              <el-icon><MagicStick /></el-icon>
              优化建议
            </el-button>
            <el-button 
              size="small" 
              @click="handleAIAction('report')"
              class="action-btn"
            >
              <el-icon><Document /></el-icon>
              生成报告
            </el-button>
          </div>
          
          <!-- 情感反馈 -->
          <div v-if="showEmotionFeedback" class="emotion-feedback">
            <div class="emotion-bar">
              <div 
                class="emotion-fill" 
                :style="{ width: `${emotionScore}%` }"
                :class="`emotion-${emotionType}`"
              ></div>
            </div>
            <div class="emotion-label">{{ emotionLabel }}</div>
          </div>
        </div>
        <div class="bubble-arrow-enhanced"></div>
      </div>
    </transition>

    <!-- 成就通知 -->
    <transition name="achievement">
      <div v-if="showAchievement" class="achievement-notification">
        <div class="achievement-icon">🏆</div>
        <div class="achievement-content">
          <div class="achievement-title">成就解锁！</div>
          <div class="achievement-desc">{{ achievementText }}</div>
        </div>
      </div>
    </transition>

    <!-- AI视觉 - 摄像头预览 -->
    <transition name="camera-fade">
      <div v-if="cameraEnabled" class="camera-preview">
        <div class="camera-header">
          <span class="camera-title">画面识别</span>
          <el-button text size="small" @click="toggleCamera" class="camera-close">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
        <video 
          ref="videoRef" 
          autoplay 
          playsinline 
          muted
          class="camera-video"
          :srcObject="videoStream"
        ></video>
        <div class="camera-actions">
          <el-button size="small" type="primary" @click="analyzeVision" :loading="isAnalyzingVision">
            {{ isAnalyzingVision ? '分析中...' : '🔍 分析画面' }}
          </el-button>
        </div>
        <div v-if="isAnalyzingVision" class="camera-analyzing">
          <div class="analyzing-overlay"></div>
          <div class="analyzing-text">正在识别…</div>
        </div>
      </div>
    </transition>

    <!-- 全屏AI对话弹窗 - ChatGPT风格 -->
    <transition name="dialog-fade">
      <div v-if="showChatDialog" class="ai-chat-dialog" @click.self="closeChatDialog">
        <div class="chat-dialog-container">
          <!-- 头部 -->
          <div class="chat-dialog-header">
            <div class="chat-header-left">
              <div class="ai-avatar-large" :class="{ 'speaking': isSpeaking, 'thinking': isThinking }">
                <img src="/robot-icon.svg" alt="AI" />
              </div>
              <div class="ai-info">
                <div class="ai-name">马上有 · 经营助理</div>
                <div class="ai-status">
                  <span class="status-dot" :class="{ 'online': true }"></span>
                  {{ isThinking ? '思考中...' : isSpeaking ? '播报中...' : '在线' }}
                </div>
              </div>
            </div>
            <div class="chat-header-right">
              <el-button text @click="clearChatHistory" title="清空对话">
                <el-icon><Delete /></el-icon>
              </el-button>
              <el-button text @click="closeChatDialog" title="关闭">
                <el-icon><Close /></el-icon>
              </el-button>
            </div>
          </div>

          <!-- 快捷指令栏 -->
          <div class="quick-commands">
            <div class="command-chip" @click="executeQuickCommand('今日数据概览')">📊 今日数据</div>
            <div class="command-chip" @click="executeQuickCommand('本月经营分析')">📈 月度分析</div>
            <div class="command-chip" @click="executeQuickCommand('给我优化建议')">💡 优化建议</div>
            <div class="command-chip" @click="executeQuickCommand('生成经营日报')">📝 生成日报</div>
            <div class="command-chip" @click="executeQuickCommand('库存预警分析')">📦 库存预警</div>
            <div class="command-chip" @click="executeQuickCommand('客户画像分析')">👥 客户分析</div>
          </div>

          <!-- 对话区域 -->
          <div class="chat-messages" ref="chatMessagesRef">
            <div v-if="chatMessages.length === 0" class="chat-welcome">
              <div class="welcome-avatar">
                <img src="/robot-icon.svg" alt="AI" />
              </div>
              <div class="welcome-title">你好，我是马上有</div>
              <div class="welcome-subtitle">帮你盯数据、理经营，有需要直接问就好</div>
              <div class="welcome-suggestions">
                <div class="suggestion-card" @click="executeQuickCommand('分析今日经营数据')">
                  <div class="suggestion-icon">📊</div>
                  <div class="suggestion-text">分析今日经营数据</div>
                </div>
                <div class="suggestion-card" @click="executeQuickCommand('给我三条优化建议')">
                  <div class="suggestion-icon">💡</div>
                  <div class="suggestion-text">给我三条优化建议</div>
                </div>
                <div class="suggestion-card" @click="executeQuickCommand('预测本月销售趋势')">
                  <div class="suggestion-icon">📈</div>
                  <div class="suggestion-text">预测本月销售趋势</div>
                </div>
                <div class="suggestion-card" @click="executeQuickCommand('生成经营周报')">
                  <div class="suggestion-icon">📝</div>
                  <div class="suggestion-text">生成经营周报</div>
                </div>
              </div>
            </div>

            <div v-for="(msg, index) in chatMessages" :key="index" class="chat-message" :class="msg.role">
              <div class="message-avatar">
                <img v-if="msg.role === 'ai'" src="/robot-icon.svg" alt="AI" />
                <div v-else class="user-avatar">我</div>
              </div>
              <div class="message-content">
                <div class="message-text" v-html="formatMessage(msg.content)"></div>
                <div class="message-time">{{ msg.time }}</div>
              </div>
            </div>

            <div v-if="isThinking" class="chat-message ai typing">
              <div class="message-avatar">
                <img src="/robot-icon.svg" alt="AI" />
              </div>
              <div class="message-content">
                <div class="typing-indicator">
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          </div>

          <!-- 输入区域 -->
          <div class="chat-input-area">
            <div class="input-wrapper">
              <el-input
                v-model="chatInput"
                placeholder="输入您的问题，按回车发送..."
                @keyup.enter="sendChatMessage"
                :disabled="isThinking"
                class="chat-input"
              >
                <template #prefix>
                  <el-icon class="input-icon"><ChatDotRound /></el-icon>
                </template>
              </el-input>
              <el-button 
                type="primary" 
                circle 
                @click="sendChatMessage" 
                :loading="isThinking"
                :disabled="!chatInput.trim()"
                class="send-btn"
              >
                <el-icon><Promotion /></el-icon>
              </el-button>
              <el-button 
                :type="isListening ? 'danger' : 'default'" 
                circle 
                @click="toggleVoiceRecognition"
                class="voice-btn"
                :class="{ 'listening': isListening }"
              >
                <el-icon><Microphone /></el-icon>
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Microphone, VideoPlay, Camera, Close, Grid, DataAnalysis, MagicStick, Document, Delete, ChatDotRound, Promotion } from '@element-plus/icons-vue'
import { callGeminiAPI, resetKeyStatus } from '../utils/aiHelper'
import { getTTSInstance, VOICE_CONFIGS, waitForVoices, selectBestVoice } from '../utils/ttsHelper'
import { tryPlayAliyunNlsTts } from '../utils/aliyunCompanionTts'

/** 新一轮播报时递增，用于取消过期的分段队列 */
let companionSpeakSeq = 0

const props = defineProps({
  dashboardStats: {
    type: Object,
    default: () => ({})
  },
  onAICall: {
    type: Function,
    default: null
  }
})

const emit = defineEmits(['ai-action', 'navigate'])

// 基础状态
const isActive = ref(false)
const isBouncing = ref(false)
const isThinking = ref(false)
const isListening = ref(false)
const isSpeaking = ref(false)
const showMessage = ref(false)
const currentMessage = ref('')
const isAIResponse = ref(false)
const showActions = ref(false)
const showSkillsPanel = ref(false)
const showAchievement = ref(false)
const achievementText = ref('')
const lastClickTime = ref(0)
const messageTimeout = ref(null)
const autoVoiceEnabled = ref(true)
const recognition = ref(null)
const synth = ref(null)
const currentUtterance = ref(null)
const currentAudio = ref(null)
/** 阿里云 TTS 播放中的 HTMLAudioElement（与音乐 currentAudio 分离） */
const companionTtsAudio = ref(null)

function haltCompanionTtsPlaybackNoSeqBump() {
  if (synth.value) {
    try {
      synth.value.cancel()
    } catch {
      /* ignore */
    }
  }
  currentUtterance.value = null
  if (companionTtsAudio.value) {
    try {
      companionTtsAudio.value.pause()
      companionTtsAudio.value.removeAttribute('src')
      companionTtsAudio.value.load()
    } catch {
      /* ignore */
    }
    companionTtsAudio.value = null
  }
}

// AI视觉系统
const cameraEnabled = ref(false)
const videoStream = ref(null)
const videoRef = ref(null)
const canvasRef = ref(null)
const isAnalyzingVision = ref(false)

// ChatGPT风格对话弹窗
const showChatDialog = ref(false)
const chatInput = ref('')
const chatMessages = ref([])
const chatMessagesRef = ref(null)

// 情感系统
const currentMood = ref('calm') // happy, excited, calm, focused, friendly
const moodIcons = {
  happy: '😊',
  excited: '🎉',
  calm: '😌',
  focused: '🤔',
  friendly: '👋'
}
const moodLabels = {
  happy: '开心',
  excited: '兴奋',
  calm: '平静',
  focused: '专注',
  friendly: '友好'
}

// 情感反馈
const showEmotionFeedback = ref(false)
const emotionScore = ref(0)
const emotionType = ref('positive')
const emotionLabel = ref('')

// 对话记忆和上下文管理（增强版）
const conversationHistory = ref([])
const maxHistoryLength = 20 // 增加到20轮对话
const userPreferences = ref({
  name: '',
  favoriteFeatures: [],
  lastInteraction: null,
  interactionCount: 0,
  preferredVoice: 'natural',
  preferredMood: 'friendly'
})

// 任务和提醒管理
const reminders = ref([])
const tasks = ref([])
const achievements = ref([])

// 技能系统（精简版 - 聚焦商业场景）
const availableSkills = ref([
  // 核心商业技能
  { id: 'analyze', name: '数据分析', icon: '📊', desc: '经营数据摘要与趋势', active: false, category: 'business', shortcut: '说"分析数据"' },
  { id: 'suggest', name: '优化建议', icon: '💡', desc: '经营优化建议', active: false, category: 'business', shortcut: '说"给我建议"' },
  { id: 'report', name: '日报生成', icon: '📝', desc: '自动生成日报', active: false, category: 'business', shortcut: '说"生成报告"' },
  { id: 'forecast', name: '销售预测', icon: '📈', desc: '智能销售预测', active: false, category: 'business', shortcut: '说"销售预测"' },
  { id: 'inventory', name: '库存预警', icon: '📦', desc: '库存智能分析', active: false, category: 'business', shortcut: '说"库存分析"' },
  { id: 'customer', name: '客户分析', icon: '👥', desc: '客户画像洞察', active: false, category: 'business', shortcut: '说"客户分析"' },
  // 效率工具
  { id: 'reminder', name: '工作提醒', icon: '⏰', desc: '设置工作提醒', active: false, category: 'productivity', shortcut: '说"提醒我..."' },
  { id: 'timer', name: '专注计时', icon: '⏱️', desc: '番茄工作法', active: false, category: 'productivity', shortcut: '说"计时X分钟"' },
  // AI视觉（新增）
  { id: 'vision', name: 'AI视觉', icon: '👁️', desc: '摄像头智能识别', active: false, category: 'ai', shortcut: '说"打开摄像头"' },
  // 轻松一刻（精简）
  { id: 'quote', name: '励志名言', icon: '💬', desc: '每日一句', active: false, category: 'inspiration', shortcut: '说"励志名言"' }
])

// 当前时间
const currentTime = computed(() => {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
})

// 企业经营助理词库（增强版 - 更加拟人化）
const assistantMessages = [
  // 数据洞察类（更自然的表达）
  '📊 看了下数据，今天表现不错哦！转化率可以再优化下~',
  '💡 嘿，发现个有趣的趋势，高价值客户在增加呢！',
  '📈 哇，订单量涨得不错，要不要考虑备点货？',
  '🎯 库存周转很健康，继续保持这个节奏就好~',
  '📉 emmm...退款有点多，要不一起看看原因？',
  
  // 经营建议类（更亲切的语气）
  '💼 有个小建议：高毛利产品可以多推一推~',
  '🚀 要不试试限时活动？效果一般都挺好的',
  '🎨 产品线可以再丰富些，给客户更多选择嘛',
  '💎 高价值客户越来越多了，这是好兆头！',
  '⚡ 会员运营做起来，复购率会更好看的~',
  
  // PMO项目管理类（更专业但不失温度）
  '📋 各项指标都正常，项目进展顺利！',
  '✅ 关键指标达成了，接下来怎么规划？',
  '🔄 定期复盘是个好习惯，一起优化流程吧',
  '📊 系统运行稳定，数据监控一切正常~',
  '🎯 目标完成得不错，继续加油！',
  
  // 主动关怀类（更有温度）
  '👋 早上好呀！今天数据看起来很棒~',
  '💪 加油加油！数据一直在向好发展',
  '🌟 表现很优秀！我都替你高兴',
  '🎉 恭喜恭喜！今日目标达成啦~',
  '✨ 趋势很好，未来可期！',
  '☕ 记得休息一下，喝杯咖啡吧~',
  '🌈 今天心情怎么样？数据很给力哦！',
  
  // 预警提醒类（更贴心的提醒）
  '⚠️ 友情提醒：有些商品该补货啦~',
  '🔔 嘿，有订单等着处理呢，别忘了发货哦',
  '📢 售后订单记得关注下，客户满意度很重要~',
  '💡 低转化的产品可以优化下展示方式',
  '🎯 新客户获取也很重要，渠道可以再拓展下',
  
  // 鼓励激励类（更有感染力）
  '🏆 数据太棒了！你们团队真厉害！',
  '💎 效率提升明显，做得真好！',
  '🚀 增长势头强劲，继续冲！',
  '⭐ 数据亮眼，大家都辛苦了！',
  '🎊 超额完成！必须庆祝一下！',
  '🔥 状态火热！保持住！',
  '💯 完美！这就是专业的力量！'
]

// 根据数据状态生成智能消息（增强版）
const generateContextualMessage = (stats) => {
  const messages = []
  
  if (stats.monthSales > 100000) {
    messages.push('🎉 本月营收已突破10万，表现优秀！')
    updateMood('excited')
  }
  
  if (stats.totalMonthOrders > 0 && stats.monthSales > 0) {
    const avgPrice = stats.monthSales / stats.totalMonthOrders
    if (avgPrice > 200) {
      messages.push('💎 订单均价较高，客户价值良好')
      updateMood('happy')
    }
  }
  
  if (stats.pendingOrders > 0) {
    messages.push(`📦 有${stats.pendingOrders}个订单待处理，建议及时发货`)
    updateMood('focused')
  }
  
  if (stats.lowStock > 0) {
    messages.push(`⚠️ 有${stats.lowStock}个商品库存不足，建议补货`)
    updateMood('focused')
  }
  
  if (stats.monthProfit > 0) {
    const profitRate = (stats.monthProfit / stats.monthSales * 100).toFixed(1)
    messages.push(`💰 本月净利润率${profitRate}%，经营状况良好`)
    if (profitRate > 20) {
      updateMood('excited')
    } else {
      updateMood('happy')
    }
  }
  
  return messages.length > 0 
    ? messages[Math.floor(Math.random() * messages.length)]
    : assistantMessages[Math.floor(Math.random() * assistantMessages.length)]
}

// 更新情感状态
const updateMood = (mood) => {
  currentMood.value = mood
  // 情感状态会在3秒后恢复平静
  setTimeout(() => {
    if (currentMood.value === mood) {
      currentMood.value = 'calm'
    }
  }, 3000)
}

// 获取随机消息
const getRandomMessage = () => {
  if (props.dashboardStats && Object.keys(props.dashboardStats).length > 0) {
    return generateContextualMessage(props.dashboardStats)
  }
  return assistantMessages[Math.floor(Math.random() * assistantMessages.length)]
}

// 格式化消息（支持Markdown和表情）
const formatMessage = (text) => {
  // 简单的Markdown支持
  let formatted = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
  
  return formatted
}

// 保存对话历史（增强版）
const saveConversation = (userMessage, aiResponse, emotion = null) => {
  // 只保存Gemini API需要的字段：role和parts
  conversationHistory.value.push(
    { 
      role: 'user', 
      parts: [{ text: userMessage }]
    },
    { 
      role: 'model', 
      parts: [{ text: aiResponse }]
    }
  )
  
  // 限制历史长度
  if (conversationHistory.value.length > maxHistoryLength * 2) {
    conversationHistory.value = conversationHistory.value.slice(-maxHistoryLength * 2)
  }
  
  // 保存到localStorage
  try {
    localStorage.setItem('robot_conversation_history', JSON.stringify(conversationHistory.value))
    userPreferences.value.interactionCount++
    userPreferences.value.lastInteraction = Date.now()
    localStorage.setItem('robot_user_preferences', JSON.stringify(userPreferences.value))
  } catch (e) {
    console.warn('保存对话历史失败:', e)
  }
}

// 加载对话历史
const loadConversationHistory = () => {
  try {
    const saved = localStorage.getItem('robot_conversation_history')
    if (saved) {
      const parsed = JSON.parse(saved)
      // 清理旧格式数据，只保留role和parts字段
      conversationHistory.value = parsed.map(item => ({
        role: item.role,
        parts: item.parts
      })).filter(item => item.role && item.parts)
      
      if (conversationHistory.value.length > maxHistoryLength * 2) {
        conversationHistory.value = conversationHistory.value.slice(-maxHistoryLength * 2)
      }
      // 保存清理后的数据
      localStorage.setItem('robot_conversation_history', JSON.stringify(conversationHistory.value))
    }
  } catch (e) {
    console.warn('加载对话历史失败，清空历史:', e)
    conversationHistory.value = []
    localStorage.removeItem('robot_conversation_history')
  }
}

// 调用AI生成智能建议（全面升级版）
const callAIForSuggestion = async (type = 'general', userInput = '') => {
  if (isThinking.value) return

  if (synth.value?.speaking || currentUtterance.value || companionTtsAudio.value) {
    companionSpeakSeq++
    haltCompanionTtsPlaybackNoSeqBump()
  }

  isThinking.value = true
  isSpeaking.value = false
  showMessage.value = true
  currentMessage.value = '🤔 正在分析数据...'
  isAIResponse.value = true
  updateMood('focused')
  
  try {
    const stats = props.dashboardStats || {}
    let prompt = ''
    let systemInstruction = `你是一位专业、友好、幽默的企业经营助理和PMO项目管理专家，擅长数据分析和运营优化。你的名字是"马上有"，性格开朗、专业、有同理心。请用自然、亲切的语气与用户交流，适当使用表情符号让对话更生动。`
    
    // 添加上下文信息（增强版）
    const contextInfo = []
    if (userPreferences.value.name) {
      contextInfo.push(`用户名称：${userPreferences.value.name}`)
    }
    if (conversationHistory.value.length > 0) {
      contextInfo.push('我们之前有过对话，请参考对话历史保持连贯性和个性化。')
    }
    contextInfo.push(`当前情感状态：${moodLabels[currentMood.value]}`)
    contextInfo.push(`交互次数：${userPreferences.value.interactionCount}次`)
    
    switch(type) {
      case 'analyze':
        prompt = `${contextInfo.join('\n')}

作为企业经营助理，请分析以下经营数据并给出专业洞察：
- 今日营收：${stats.todaySales || 0}元
- 本月总营收：${stats.monthSales || 0}元
- 本月订单数：${stats.totalMonthOrders || 0}单
- 待处理订单：${stats.pendingOrders || 0}个
- 库存预警：${stats.lowStock || 0}个

请用简洁专业但友好的语言（50字以内）给出数据洞察和建议，可以适当使用表情符号。`
        break
      case 'suggest':
        prompt = `${contextInfo.join('\n')}

作为PMO项目管理专家，基于当前经营数据，请给出3条具体的优化建议（每条不超过20字）：
- 本月营收：${stats.monthSales || 0}元
- 订单数：${stats.totalMonthOrders || 0}单
- 净利润：${stats.monthProfit || 0}元

格式：1. 建议一 2. 建议二 3. 建议三`
        break
      case 'report':
        prompt = `${contextInfo.join('\n')}

作为企业经营助理，请生成一份简洁的经营日报（100字以内）：
- 今日营收：${stats.todaySales || 0}元
- 本月累计：${stats.monthSales || 0}元
- 订单情况：${stats.totalMonthOrders || 0}单
- 待办事项：${stats.totalTodos || 0}项

请用专业但友好的语气总结，可以适当使用表情符号。`
        break
      case 'forecast':
        prompt = `${contextInfo.join('\n')}

作为销售预测专家，基于以下数据预测未来趋势（50字以内）：
- 本月营收：${stats.monthSales || 0}元
- 订单数：${stats.totalMonthOrders || 0}单
- 历史增长：稳定

请给出简洁的销售预测和建议。`
        break
      case 'inventory':
        prompt = `${contextInfo.join('\n')}

作为库存管理专家，分析当前库存状况（50字以内）：
- 库存预警：${stats.lowStock || 0}个
- 待处理订单：${stats.pendingOrders || 0}个

请给出库存优化建议。`
        break
      case 'customer':
        prompt = `${contextInfo.join('\n')}

作为客户分析专家，分析客户画像（50字以内）：
- 会员总数：${stats.totalUsers || 0}人
- 新增会员：${stats.newUsers || 0}人
- 订单均价：${stats.totalMonthOrders > 0 ? Math.round(stats.monthSales / stats.totalMonthOrders) : 0}元

请给出客户运营建议。`
        break
      case 'chat':
        // 自由对话模式（增强版）
        prompt = userInput || '你好'
        systemInstruction = `你是一位友好、专业、幽默的企业经营助理"马上有"。请用自然、亲切的语气回应用户，保持对话连贯性和个性化。根据对话内容适当调整语气和情感表达，可以使用表情符号让对话更生动。`
        break
      default:
        prompt = `作为企业经营助理，请基于当前数据给出一条鼓励或建议（30字以内），语气要友好自然。`
    }
    
    const response = await callGeminiAPI(prompt, {
      temperature: 0.8, // 提高温度，让回复更自然
      systemInstruction: systemInstruction,
      conversationHistory: conversationHistory.value.slice(-10) // 使用最近5轮对话
    })
    
    if (response && typeof response === 'string') {
      const aiResponse = response.trim()
      currentMessage.value = aiResponse
      showActions.value = type === 'analyze'
      
      // 分析情感并更新状态
      analyzeEmotion(aiResponse)
      
      // 保存对话历史
      if (userInput || type === 'chat') {
        saveConversation(userInput || prompt, aiResponse)
      }
      
      // 自动语音播报（增强版）
      if (autoVoiceEnabled.value) {
        await speakTextEnhanced(aiResponse)
      } else {
        isThinking.value = false
      }
      
      // 检查成就
      checkAchievements()
    } else {
      currentMessage.value = getRandomMessage()
      if (autoVoiceEnabled.value) {
        await speakTextEnhanced(currentMessage.value)
      } else {
        isThinking.value = false
      }
    }
  } catch (error) {
    console.error('AI调用失败:', error)
    currentMessage.value = getRandomMessage()
    if (autoVoiceEnabled.value) {
      await speakTextEnhanced(currentMessage.value)
    } else {
      isThinking.value = false
    }
  } finally {
    clearMessageTimeout()
    messageTimeout.value = setTimeout(() => {
      showMessage.value = false
      showActions.value = false
    }, 10000) // 延长显示时间
  }
}

// 分析情感
const analyzeEmotion = (text) => {
  const positiveWords = ['好', '优秀', '棒', '成功', '恭喜', '优秀', '完美', '出色']
  const excitedWords = ['突破', '增长', '超额', '庆祝', '优秀']
  const focusedWords = ['建议', '优化', '注意', '关注', '检查']
  
  let score = 50 // 中性
  let type = 'neutral'
  
  if (positiveWords.some(w => text.includes(w))) {
    score = 75
    type = 'positive'
    updateMood('happy')
  }
  
  if (excitedWords.some(w => text.includes(w))) {
    score = 90
    type = 'excited'
    updateMood('excited')
  }
  
  if (focusedWords.some(w => text.includes(w))) {
    score = 60
    type = 'focused'
    updateMood('focused')
  }
  
  emotionScore.value = score
  emotionType.value = type
  emotionLabel.value = type === 'positive' ? '积极' : type === 'excited' ? '兴奋' : type === 'focused' ? '专注' : '中性'
  showEmotionFeedback.value = true
  
  setTimeout(() => {
    showEmotionFeedback.value = false
  }, 3000)
}

// 检查成就
const checkAchievements = () => {
  const count = userPreferences.value.interactionCount
  
  if (count === 10 && !achievements.value.includes('first_10')) {
    unlockAchievement('first_10', '🎯 完成10次交互', '你和马上有已经聊了 10 次啦')
  } else if (count === 50 && !achievements.value.includes('first_50')) {
    unlockAchievement('first_50', '🌟 完成50次交互', '和马上有的对话已经满 50 次')
  } else if (count === 100 && !achievements.value.includes('first_100')) {
    unlockAchievement('first_100', '🏆 完成100次交互', '百次相伴，感谢常用马上有')
  }
}

// 解锁成就
const unlockAchievement = (id, title, desc) => {
  achievements.value.push(id)
  achievementText.value = desc
  showAchievement.value = true
  
  setTimeout(() => {
    showAchievement.value = false
  }, 5000)
  
  try {
    localStorage.setItem('robot_achievements', JSON.stringify(achievements.value))
  } catch (e) {
    console.warn('保存成就失败:', e)
  }
}

// 打开ChatGPT风格对话弹窗
const openChatDialog = () => {
  showChatDialog.value = true
  showMessage.value = false
  showSkillsPanel.value = false
  
  // 如果没有历史消息，添加欢迎语
  if (chatMessages.value.length === 0) {
    // 欢迎语由界面展示
  }
}

// 关闭对话弹窗
const closeChatDialog = () => {
  showChatDialog.value = false
}

// 清空对话历史
const clearChatHistory = () => {
  chatMessages.value = []
  conversationHistory.value = []
  localStorage.removeItem('robot_conversation_history')
}

// 发送聊天消息
const sendChatMessage = async () => {
  const input = chatInput.value.trim()
  if (!input || isThinking.value) return
  
  // 添加用户消息
  chatMessages.value.push({
    role: 'user',
    content: input,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  })
  
  chatInput.value = ''
  scrollChatToBottom()
  
  // 调用AI
  await callAIForChat(input)
}

// 执行快捷指令
const executeQuickCommand = async (command) => {
  chatInput.value = command
  await sendChatMessage()
}

// AI对话调用
const callAIForChat = async (userInput) => {
  isThinking.value = true
  
  // 重置API key状态，确保可以正常调用
  resetKeyStatus('gemini')
  
  try {
    const stats = props.dashboardStats || {}
    const systemInstruction = `你是"马上有"，一位专业、友好、幽默的企业经营助理和PMO专家。请用自然亲切的语气回复，适当使用表情符号。

当前经营数据：
- 今日营收：${stats.todaySales || 0}元
- 本月营收：${stats.monthSales || 0}元
- 订单数：${stats.totalMonthOrders || 0}单
- 待处理订单：${stats.pendingOrders || 0}个
- 库存预警：${stats.lowStock || 0}个
- 会员总数：${stats.totalUsers || 0}人`

    const response = await callGeminiAPI(userInput, {
      temperature: 0.8,
      systemInstruction: systemInstruction,
      conversationHistory: conversationHistory.value.slice(-10)
    })
    
    if (response && typeof response === 'string') {
      const aiResponse = response.trim()
      
      chatMessages.value.push({
        role: 'ai',
        content: aiResponse,
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      })
      
      saveConversation(userInput, aiResponse)
      
      if (autoVoiceEnabled.value) {
        speakTextEnhanced(aiResponse)
      }
    }
  } catch (error) {
    console.error('AI调用失败:', error)
    chatMessages.value.push({
      role: 'ai',
      content: '抱歉，我遇到了一些问题，请稍后再试~',
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    })
  } finally {
    isThinking.value = false
    scrollChatToBottom()
  }
}

// 滚动到底部
const scrollChatToBottom = () => {
  setTimeout(() => {
    if (chatMessagesRef.value) {
      chatMessagesRef.value.scrollTop = chatMessagesRef.value.scrollHeight
    }
  }, 100)
}

// 处理点击（保留原逻辑作为备用）
const handleClick = () => {
  openChatDialog()
}

// 处理悬停（增强版）
const handleHover = () => {
  if (!showMessage.value) {
    showMessage.value = true
    currentMessage.value = getRandomMessage()
    isAIResponse.value = false
    updateMood('friendly')
    
    clearMessageTimeout()
    messageTimeout.value = setTimeout(() => {
      showMessage.value = false
    }, 4000)
  }
}

// 处理离开
const handleLeave = () => {
  // 悬停离开时不立即隐藏，让消息自然消失
}

// 处理AI操作
const handleAIAction = (action) => {
  emit('ai-action', action)
  callAIForSuggestion(action)
}

// 激活技能（增强版）
const activateSkill = async (skill) => {
  skill.active = true
  updateMood('excited')
  
  // 根据技能类型执行相应操作
  switch(skill.id) {
    case 'music':
      await playMusic()
      break
    case 'weather':
      await getWeather()
      break
    case 'poetry':
      await recitePoetry()
      break
    case 'joke':
      await tellJoke()
      break
    case 'story':
      await tellStory()
      break
    case 'reminder':
      showMessage.value = true
      currentMessage.value = '💡 请说"提醒我XXX"来设置提醒，比如"提醒我下午3点开会"'
      isAIResponse.value = true
      if (autoVoiceEnabled.value) speakTextEnhanced(currentMessage.value)
      break
    case 'calculator':
      showMessage.value = true
      currentMessage.value = '💡 请说"计算XXX"，比如"计算123加456"'
      isAIResponse.value = true
      if (autoVoiceEnabled.value) speakTextEnhanced(currentMessage.value)
      break
    case 'translate':
      showMessage.value = true
      currentMessage.value = '💡 请说"翻译XXX"，比如"翻译你好为英文"'
      isAIResponse.value = true
      if (autoVoiceEnabled.value) speakTextEnhanced(currentMessage.value)
      break
    case 'news':
      await getNews()
      break
    case 'game':
      await startGame()
      break
    case 'quote':
      await getQuote()
      break
    case 'timer':
      showMessage.value = true
      currentMessage.value = '💡 请说"计时X分钟"，比如"计时5分钟"'
      isAIResponse.value = true
      if (autoVoiceEnabled.value) speakTextEnhanced(currentMessage.value)
      break
    case 'analyze':
      await callAIForSuggestion('analyze')
      break
    case 'suggest':
      await callAIForSuggestion('suggest')
      break
    case 'report':
      await callAIForSuggestion('report')
      break
    case 'forecast':
      await callAIForSuggestion('forecast')
      break
    case 'inventory':
      await callAIForSuggestion('inventory')
      break
    case 'customer':
      await callAIForSuggestion('customer')
      break
    case 'vision':
      await toggleCamera()
      break
  }
  
  setTimeout(() => {
    skill.active = false
  }, 2000)
}

// 清除消息定时器
const clearMessageTimeout = () => {
  if (messageTimeout.value) {
    clearTimeout(messageTimeout.value)
    messageTimeout.value = null
  }
}

// 手动关闭消息
const closeMessage = () => {
  clearMessageTimeout()
  showMessage.value = false
  showActions.value = false
  showSkillsPanel.value = false
}

// 初始化TTS实例
const ttsInstance = ref(null)

/** 按句切分，句间留出「换气」停顿，比一口气读完更像真人 */
const splitIntoSpeakChunks = (text, maxLen = 118) => {
  const s = String(text || '').trim()
  if (!s) return []
  const parts = s.split(/(?<=[。！？；\n])/).map((x) => x.trim()).filter(Boolean)
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

// 语音播报：统一选音色 + 略慢参数 + 分段播报（减轻机器感；根治需云端神经 TTS）
const speakTextEnhanced = async (text, options = {}) => {
  try {
    if (!synth.value && 'speechSynthesis' in window) {
      synth.value = window.speechSynthesis
    }

    companionSpeakSeq++
    const seq = companionSpeakSeq

    haltCompanionTtsPlaybackNoSeqBump()
    await new Promise((r) => setTimeout(r, 120))

    const cleanText = preprocessTextForSpeech(text)
    if (!cleanText || !cleanText.trim()) {
      isThinking.value = false
      isSpeaking.value = false
      return
    }

    isSpeaking.value = true
    isThinking.value = false

    const usedAliyun = await tryPlayAliyunNlsTts(cleanText, {
      shouldContinue: () => seq === companionSpeakSeq,
      onAttach: (audio) => {
        companionTtsAudio.value = audio
      },
      onDetach: () => {
        companionTtsAudio.value = null
      },
      voice: import.meta.env.VITE_ALIYUN_NLS_VOICE || undefined,
      format: import.meta.env.VITE_ALIYUN_NLS_FORMAT || undefined,
    })

    if (usedAliyun) {
      if (seq === companionSpeakSeq) {
        isSpeaking.value = false
        isThinking.value = false
      }
      return
    }

    if (!synth.value || !window.SpeechSynthesisUtterance) {
      console.warn('浏览器不支持语音合成功能，且未启用可用的云端 TTS')
      isThinking.value = false
      isSpeaking.value = false
      return
    }

    const chunks = splitIntoSpeakChunks(cleanText)
    const voiceParams = getVoiceParamsByMood(currentMood.value)
    const rate = Math.max(0.8, Math.min(0.94, options.rate ?? voiceParams.rate ?? 0.85))
    const pitch = Math.max(0.96, Math.min(1.06, options.pitch ?? voiceParams.pitch ?? 1.0))
    const volume = Math.max(0.78, Math.min(0.92, options.volume ?? voiceParams.volume ?? 0.86))

    const voices = await waitForVoices(synth.value)
    const selectedVoice = selectBestVoice(voices, VOICE_CONFIGS.naturalHuman)

    const pauseMs = () => 320 + Math.floor(Math.random() * 140)

    for (let i = 0; i < chunks.length; i++) {
      if (seq !== companionSpeakSeq) {
        isSpeaking.value = false
        isThinking.value = false
        return
      }

      const chunk = chunks[i]
      const utterance = new SpeechSynthesisUtterance(chunk)
      utterance.lang = 'zh-CN'
      utterance.rate = rate
      utterance.pitch = pitch
      utterance.volume = volume
      if (selectedVoice) utterance.voice = selectedVoice

      utterance.onstart = () => {
        isThinking.value = false
        isSpeaking.value = true
      }

      await new Promise((resolve) => {
        utterance.onend = () => {
          currentUtterance.value = null
          resolve()
        }
        utterance.onerror = (error) => {
          console.error('语音播报错误:', error)
          currentUtterance.value = null
          resolve()
        }
        currentUtterance.value = utterance
        try {
          synth.value.speak(utterance)
        } catch (e) {
          console.error('调用 speak 失败:', e)
          resolve()
        }
      })

      if (seq !== companionSpeakSeq) {
        isSpeaking.value = false
        isThinking.value = false
        return
      }
      if (i < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, pauseMs()))
      }
    }

    if (seq === companionSpeakSeq) {
      isSpeaking.value = false
      isThinking.value = false
      currentUtterance.value = null
    }
  } catch (error) {
    console.error('语音播报异常:', error)
    currentUtterance.value = null
    isSpeaking.value = false
    isThinking.value = false
  }
}

// 根据情感获取语音参数（优化版 - 参考ChatTTS等先进方案的自然人声参数）
const getVoiceParamsByMood = (mood) => {
  const params = {
    happy: { rate: 0.87, pitch: 1.02, volume: 0.86 },
    excited: { rate: 0.89, pitch: 1.04, volume: 0.87 },
    calm: { rate: 0.82, pitch: 0.99, volume: 0.84 },
    focused: { rate: 0.84, pitch: 1.0, volume: 0.86 },
    friendly: { rate: 0.85, pitch: 1.0, volume: 0.86 }
  }
  return params[mood] || params.friendly
}

// 文本预处理（智能处理 - 优化版，参考ChatTTS等先进方案的文本处理）
const preprocessTextForSpeech = (text) => {
  if (!text) return ''
  
  let clean = String(text)
  
  // 1. 移除Markdown语法标记（避免语音读出格式符号）
  clean = clean
    .replace(/```[\s\S]*?```/g, '代码块')       // 代码块
    .replace(/`([^`]+)`/g, '$1')               // 行内代码
    .replace(/\*\*([^*]+)\*\*/g, '$1')        // 粗体
    .replace(/\*([^*]+)\*/g, '$1')            // 斜体
    .replace(/#{1,6}\s+/g, '')                // 标题标记
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // 链接
  
  // 2. 移除emoji但保留文字
  clean = clean.replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
  
  // 3. 符号与术语口语化（避免「百分比」等生硬读法）
  clean = clean
    .replace(/[¥￥]/g, '元')
    .replace(/\bvs\.?\b/gi, '对比')
    .replace(/\bCAGR\b/gi, '年均复合增长率')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '百分之$1')
    .replace(/(\d+)\s*元/g, '$1元')
    .replace(/(\d+)\s*单/g, '$1单')
    .replace(/(\d+)\s*个/g, '$1个')
    .replace(/(\d+)\s*件/g, '$1件')
  
  // 4. 处理标点符号（保留适当的停顿）
  clean = clean
    .replace(/[。！？]/g, '。')              // 句号统一
    .replace(/[，、；：]/g, '，')            // 逗号统一
    .replace(/[，]+/g, '，')                 // 重复逗号合并
    .replace(/[。]+/g, '。')                 // 重复句号合并
    .replace(/[。，]$/, '')                  // 末尾标点移除
  
  // 5. 处理空白字符
  clean = clean
    .replace(/\n{3,}/g, '\n\n')              // 多个换行合并
    .replace(/\s{2,}/g, ' ')                 // 多个空格合并
  
  // 6. 添加适当的停顿（长句分割，避免一口气读完）
  clean = clean.replace(/([。！？])([^。！？\n]{60,})/g, '$1 $2')
  
  return clean.trim()
}

// 初始化语音识别（增强版）
const initSpeechRecognition = () => {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    ElMessage.warning('您的浏览器不支持语音识别功能')
    return false
  }
  
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  recognition.value = new SpeechRecognition()
  recognition.value.lang = 'zh-CN'
  recognition.value.continuous = false
  recognition.value.interimResults = true // 启用中间结果
  
  recognition.value.onstart = () => {
    isListening.value = true
    updateMood('focused')
    ElMessage.success('🎤 开始语音识别...')
  }
  
  recognition.value.onresult = async (event) => {
    let transcript = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript
    }
    
    // 如果是最终结果
    if (event.results[event.results.length - 1].isFinal) {
      ElMessage.info(`识别到：${transcript}`)
      await handleVoiceCommand(transcript)
    }
  }
  
  recognition.value.onerror = (event) => {
    console.error('语音识别错误:', event.error)
    isListening.value = false
    if (event.error === 'no-speech') {
      ElMessage.warning('未检测到语音，请重试')
    } else if (event.error === 'not-allowed') {
      ElMessage.error('请允许使用麦克风权限')
    }
  }
  
  recognition.value.onend = () => {
    isListening.value = false
    updateMood('calm')
  }
  
  return true
}

// 处理语音指令（全面升级版）
const handleVoiceCommand = async (command) => {
  const lowerCommand = command.toLowerCase()
  
  // 数据分析相关
  if (lowerCommand.includes('分析') || lowerCommand.includes('数据')) {
    await callAIForSuggestion('analyze')
    return
  }
  
  // 优化建议相关
  if (lowerCommand.includes('建议') || lowerCommand.includes('优化')) {
    await callAIForSuggestion('suggest')
    return
  }
  
  // 生成报告相关
  if (lowerCommand.includes('报告') || lowerCommand.includes('日报')) {
    await callAIForSuggestion('report')
    return
  }
  
  // 问候语
  if (lowerCommand.includes('你好') || lowerCommand.includes('hello') || lowerCommand.includes('早上好') || lowerCommand.includes('晚上好')) {
    const greetings = [
      '您好！我是您的企业经营助理马上有，有什么可以帮您的吗？',
      '您好！很高兴为您服务，有什么需要我帮助的吗？',
      '您好！我是马上有，随时为您提供数据洞察和运营建议'
    ]
    showMessage.value = true
    currentMessage.value = greetings[Math.floor(Math.random() * greetings.length)]
    isAIResponse.value = false
    updateMood('friendly')
    if (autoVoiceEnabled.value) {
      await speakTextEnhanced(currentMessage.value)
    }
    clearMessageTimeout()
    messageTimeout.value = setTimeout(() => {
      showMessage.value = false
    }, 5000)
    return
  }
  
  // 播放音乐
  if (lowerCommand.includes('播放') && (lowerCommand.includes('音乐') || lowerCommand.includes('歌'))) {
    await playMusic()
    return
  }
  
  // 查询天气
  if (lowerCommand.includes('天气')) {
    await getWeather()
    return
  }
  
  // 背诵古诗词
  if (lowerCommand.includes('古诗') || lowerCommand.includes('诗词') || lowerCommand.includes('背诗')) {
    await recitePoetry()
    return
  }
  
  // 讲笑话
  if (lowerCommand.includes('笑话') || lowerCommand.includes('讲个笑话')) {
    await tellJoke()
    return
  }
  
  // 讲故事
  if (lowerCommand.includes('故事') || lowerCommand.includes('讲个故事')) {
    await tellStory()
    return
  }
  
  // 设置提醒
  if (lowerCommand.includes('提醒') || lowerCommand.includes('记住')) {
    const timeMatch = command.match(/(\d{1,2})[点:](\d{2})/)
    const contentMatch = command.match(/提醒我(.+)/) || command.match(/记住(.+)/)
    
    if (contentMatch) {
      const reminder = {
        id: Date.now(),
        content: contentMatch[1].trim(),
        time: timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : null,
        createdAt: new Date().toISOString()
      }
      reminders.value.push(reminder)
      
      try {
        localStorage.setItem('robot_reminders', JSON.stringify(reminders.value))
      } catch (e) {
        console.warn('保存提醒失败:', e)
      }
      
      showMessage.value = true
      currentMessage.value = `✅ 已设置提醒：${reminder.content}${reminder.time ? `，时间：${reminder.time}` : ''}`
      isAIResponse.value = false
      
      if (autoVoiceEnabled.value) {
        await speakTextEnhanced(`已设置提醒：${reminder.content}`)
      }
      
      clearMessageTimeout()
      messageTimeout.value = setTimeout(() => {
        showMessage.value = false
      }, 5000)
      return
    }
  }
  
  // 查询提醒
  if (lowerCommand.includes('提醒列表') || lowerCommand.includes('我的提醒')) {
    if (reminders.value.length === 0) {
      showMessage.value = true
      currentMessage.value = '📋 您还没有设置任何提醒'
      isAIResponse.value = false
    } else {
      const reminderList = reminders.value.map((r, i) => `${i + 1}. ${r.content}${r.time ? ` (${r.time})` : ''}`).join('\n')
      showMessage.value = true
      currentMessage.value = `📋 您的提醒列表：\n${reminderList}`
      isAIResponse.value = false
    }
    
    if (autoVoiceEnabled.value) {
      await speakTextEnhanced(currentMessage.value.replace(/\n/g, '，'))
    }
    
    clearMessageTimeout()
    messageTimeout.value = setTimeout(() => {
      showMessage.value = false
    }, 8000)
    return
  }
  
  // 设置用户名
  if (lowerCommand.includes('我叫') || lowerCommand.includes('我的名字')) {
    const nameMatch = command.match(/我叫(.+)/) || command.match(/我的名字是(.+)/)
    if (nameMatch) {
      userPreferences.value.name = nameMatch[1].trim()
      try {
        localStorage.setItem('robot_user_preferences', JSON.stringify(userPreferences.value))
      } catch (e) {
        console.warn('保存用户偏好失败:', e)
      }
      
      showMessage.value = true
      currentMessage.value = `👋 好的，${userPreferences.value.name}！我会记住您的名字`
      isAIResponse.value = false
      updateMood('happy')
      
      if (autoVoiceEnabled.value) {
        await speakTextEnhanced(`好的，${userPreferences.value.name}，我会记住您的名字`)
      }
      
      clearMessageTimeout()
      messageTimeout.value = setTimeout(() => {
        showMessage.value = false
      }, 5000)
      return
    }
  }
  
  // 默认：调用AI理解指令（使用对话模式）
  await callAIForSuggestion('chat', command)
}

// 切换语音识别
const toggleVoiceRecognition = () => {
  if (!recognition.value) {
    if (!initSpeechRecognition()) {
      return
    }
  }
  
  if (isListening.value) {
    recognition.value.stop()
    isListening.value = false
  } else {
    try {
      recognition.value.start()
    } catch (error) {
      console.error('启动语音识别失败:', error)
      ElMessage.error('启动语音识别失败，请检查麦克风权限')
    }
  }
}

// 切换自动播报
const toggleAutoVoice = () => {
  autoVoiceEnabled.value = !autoVoiceEnabled.value
  ElMessage.success(autoVoiceEnabled.value ? '已开启自动播报' : '已关闭自动播报')
  
  if (!autoVoiceEnabled.value && (currentUtterance.value || synth.value?.speaking || companionTtsAudio.value)) {
    companionSpeakSeq++
    haltCompanionTtsPlaybackNoSeqBump()
    isSpeaking.value = false
  }
}

// 音乐播放状态
const isPlayingMusic = ref(false)

// 播放音乐功能（增强版）
const playMusic = async () => {
  try {
    // 如果正在播放，则停止
    if (currentAudio.value && isPlayingMusic.value) {
      currentAudio.value.pause()
      currentAudio.value.currentTime = 0
      currentAudio.value = null
      isPlayingMusic.value = false
      currentMessage.value = '🎵 音乐已停止'
      showMessage.value = true
      isAIResponse.value = false
      if (autoVoiceEnabled.value) {
        speakTextEnhanced('音乐已停止')
      }
      clearMessageTimeout()
      messageTimeout.value = setTimeout(() => {
        showMessage.value = false
      }, 3000)
      return
    }
    
    showMessage.value = true
    currentMessage.value = '🎵 正在为您播放轻音乐...'
    isAIResponse.value = false
    updateMood('happy')
    
    const musicUrls = [
      'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
      'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3'
    ]
    
    // 先清理旧的音频
    if (currentAudio.value) {
      currentAudio.value.pause()
      currentAudio.value = null
    }
    
    const audio = new Audio(musicUrls[Math.floor(Math.random() * musicUrls.length)])
    audio.volume = 0.3
    currentAudio.value = audio
    
    try {
      await audio.play()
      isPlayingMusic.value = true
    } catch (err) {
      console.error('播放音乐失败:', err)
      currentMessage.value = '抱歉，音乐播放功能暂时不可用'
      isPlayingMusic.value = false
      currentAudio.value = null
      if (autoVoiceEnabled.value) {
        speakTextEnhanced(currentMessage.value)
      }
      return
    }
    
    audio.onended = () => {
      currentMessage.value = '🎵 音乐播放完毕'
      isPlayingMusic.value = false
      currentAudio.value = null
      setTimeout(() => {
        showMessage.value = false
      }, 3000)
    }
    
    audio.onerror = () => {
      currentMessage.value = '音乐加载失败'
      isPlayingMusic.value = false
      currentAudio.value = null
    }
    
    if (autoVoiceEnabled.value) {
      await speakTextEnhanced('正在播放音乐')
    }
    
    clearMessageTimeout()
    messageTimeout.value = setTimeout(() => {
      if (currentMessage.value.includes('正在为您播放')) {
        showMessage.value = false
      }
    }, 5000)
  } catch (error) {
    console.error('播放音乐失败:', error)
    currentMessage.value = '抱歉，音乐播放功能暂时不可用'
    isPlayingMusic.value = false
    currentAudio.value = null
  }
}

// 查询天气功能（增强版）
const getWeather = async () => {
  try {
    isThinking.value = true
    showMessage.value = true
    currentMessage.value = '🌤️ 正在查询天气...'
    isAIResponse.value = true
    
    const city = '上海'
    const mockWeather = {
      temp: '22',
      description: '晴朗',
      humidity: '65',
      wind: '3级'
    }
    
    currentMessage.value = `🌤️ ${city}今日天气：${mockWeather.description}，温度${mockWeather.temp}°C，湿度${mockWeather.humidity}%，${mockWeather.wind}风`
    
    if (autoVoiceEnabled.value) {
      await speakTextEnhanced(currentMessage.value)
    } else {
      isThinking.value = false
    }
  } catch (error) {
    console.error('查询天气失败:', error)
    currentMessage.value = '抱歉，天气查询功能暂时不可用，请稍后再试'
    if (autoVoiceEnabled.value) {
      await speakTextEnhanced(currentMessage.value)
    } else {
      isThinking.value = false
    }
  } finally {
    clearMessageTimeout()
    messageTimeout.value = setTimeout(() => {
      showMessage.value = false
    }, 8000)
  }
}

// 背诵古诗词功能（增强版）
const recitePoetry = async () => {
  try {
    isThinking.value = true
    showMessage.value = true
    currentMessage.value = '📜 正在为您准备古诗词...'
    isAIResponse.value = true
    updateMood('calm')
    
    const poems = [
      { title: '静夜思', author: '李白', content: '床前明月光，疑是地上霜。举头望明月，低头思故乡。' },
      { title: '春晓', author: '孟浩然', content: '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。' },
      { title: '登鹳雀楼', author: '王之涣', content: '白日依山尽，黄河入海流。欲穷千里目，更上一层楼。' },
      { title: '咏鹅', author: '骆宾王', content: '鹅，鹅，鹅，曲项向天歌。白毛浮绿水，红掌拨清波。' },
      { title: '悯农', author: '李绅', content: '锄禾日当午，汗滴禾下土。谁知盘中餐，粒粒皆辛苦。' },
      { title: '望庐山瀑布', author: '李白', content: '日照香炉生紫烟，遥看瀑布挂前川。飞流直下三千尺，疑是银河落九天。' },
      { title: '早发白帝城', author: '李白', content: '朝辞白帝彩云间，千里江陵一日还。两岸猿声啼不住，轻舟已过万重山。' }
    ]
    
    const poem = poems[Math.floor(Math.random() * poems.length)]
    currentMessage.value = `📜 ${poem.title}\n作者：${poem.author}\n\n${poem.content}`
    
    if (autoVoiceEnabled.value) {
      await speakTextEnhanced(`${poem.title}，作者${poem.author}。${poem.content}`)
    } else {
      isThinking.value = false
    }
  } catch (error) {
    console.error('背诵古诗词失败:', error)
    currentMessage.value = '抱歉，古诗词功能暂时不可用'
    isThinking.value = false
  } finally {
    clearMessageTimeout()
    messageTimeout.value = setTimeout(() => {
      showMessage.value = false
    }, 12000)
  }
}

// 讲笑话功能（增强版 - 更多笑话）
const tellJoke = async () => {
  try {
    isThinking.value = true
    showMessage.value = true
    currentMessage.value = '😄 让我想想有什么好笑的...'
    isAIResponse.value = true
    updateMood('happy')
    
    const jokes = [
      '为什么程序员总是分不清万圣节和圣诞节？因为 Oct 31 = Dec 25！🎃🎄',
      '老板：你为什么迟到？程序员：我在路上遇到了一个bug...',
      '为什么数学书总是很悲伤？因为它有太多的问题！📚',
      '为什么电脑永远不会感冒？因为它有Windows（窗户）！💻',
      '产品经理说："这个需求很简单，怎么实现我不管。"程序员说："好的，什么时候要？"产品经理说："昨天。"',
      '老板问程序员："你能在一周内完成这个项目吗？"程序员说："能，但我需要两周的时间来写文档。"',
      '为什么程序员喜欢用黑色背景？因为他们害怕光明！🌙',
      '客户：这个按钮能不能大一点？程序员：可以。客户：再大一点？程序员：可以。客户：再大一点？程序员：您是想要按钮还是想要一面墙？🧱',
      '为什么程序员总是戴眼镜？因为他们看不见bug！👓',
      '测试工程师走进酒吧，点了1杯啤酒，点了0杯啤酒，点了-1杯啤酒，点了999999杯啤酒，点了一只蜥蜴...'
    ]
    
    const joke = jokes[Math.floor(Math.random() * jokes.length)]
    currentMessage.value = `😄 ${joke}`
    
    if (autoVoiceEnabled.value) {
      await speakTextEnhanced(joke)
    } else {
      isThinking.value = false
    }
  } catch (error) {
    console.error('讲笑话失败:', error)
    currentMessage.value = '抱歉，笑话功能暂时不可用'
    isThinking.value = false
  } finally {
    clearMessageTimeout()
    messageTimeout.value = setTimeout(() => {
      showMessage.value = false
    }, 10000)
  }
}

// 讲故事功能（增强版 - 更多故事）
const tellStory = async () => {
  try {
    isThinking.value = true
    showMessage.value = true
    currentMessage.value = '📖 让我给你讲个故事吧...'
    isAIResponse.value = true
    updateMood('calm')
    
    const stories = [
      {
        title: '小马过河',
        content: '从前，有一匹小马要过河。它问老牛："河水深吗？"老牛说："不深，只到我的膝盖。"小马又问小松鼠："河水深吗？"小松鼠说："很深，会淹死你的！"小马想了想，决定自己试试。它发现，河水既不像老牛说的那么浅，也不像小松鼠说的那么深。这个故事告诉我们，要勇于尝试，不要只听别人的话。'
      },
      {
        title: '龟兔赛跑',
        content: '从前，兔子和乌龟比赛跑步。兔子跑得很快，很快就领先了。它看到乌龟还在后面，就决定休息一下。结果，兔子睡着了，而乌龟坚持不懈地爬，最终赢得了比赛。这个故事告诉我们，坚持就是胜利。'
      },
      {
        title: '愚公移山',
        content: '古时候，有个老人叫愚公，他家门前有两座大山挡住了出路。愚公决定带领全家挖山。有人嘲笑他说："你这么老了，怎么可能挖完？"愚公说："我死了，还有我的儿子、孙子，子子孙孙无穷尽，山却不会增高。"天帝被他的精神感动，派神仙移走了两座山。这个故事告诉我们，只要有恒心，就没有做不成的事。'
      },
      {
        title: '守株待兔',
        content: '从前，有个农夫在田里干活，看见一只兔子撞到树桩上死了。农夫白捡了一只兔子，非常高兴。从此，他天天守在树桩旁边，希望再捡到兔子。结果，兔子再也没来，田里的庄稼也荒废了。这个故事告诉我们，不能存侥幸心理，要靠自己的努力获得成功。'
      },
      {
        title: '狐假虎威',
        content: '老虎抓住了一只狐狸，正要吃掉它。狐狸说："你不能吃我！我是天帝派来管理百兽的，你要是吃了我，就是违抗天帝的命令！"老虎不信，狐狸说："不信你跟在我后面走，看看百兽是不是都怕我。"老虎跟在狐狸后面走，果然所有的动物都逃跑了。老虎不知道它们是怕自己，还以为真的是怕狐狸。这个故事告诉我们，不要被表象所迷惑。'
      }
    ]
    
    const story = stories[Math.floor(Math.random() * stories.length)]
    currentMessage.value = `📖 ${story.title}\n\n${story.content}`
    
    if (autoVoiceEnabled.value) {
      await speakTextEnhanced(`${story.title}。${story.content}`)
    } else {
      isThinking.value = false
    }
  } catch (error) {
    console.error('讲故事失败:', error)
    currentMessage.value = '抱歉，故事功能暂时不可用'
    isThinking.value = false
  } finally {
    clearMessageTimeout()
    messageTimeout.value = setTimeout(() => {
      showMessage.value = false
    }, 15000)
  }
}

// 获取新闻功能
const getNews = async () => {
  try {
    isThinking.value = true
    showMessage.value = true
    currentMessage.value = '📰 正在为您获取今日新闻...'
    isAIResponse.value = true
    
    // 这里可以集成真实的新闻API
    currentMessage.value = '📰 今日新闻：\n1. 科技行业持续发展\n2. 经济稳步增长\n3. 社会和谐稳定'
    
    if (autoVoiceEnabled.value) {
      await speakTextEnhanced(currentMessage.value)
    } else {
      isThinking.value = false
    }
  } catch (error) {
    console.error('获取新闻失败:', error)
    currentMessage.value = '抱歉，新闻功能暂时不可用'
    isThinking.value = false
  } finally {
    clearMessageTimeout()
    messageTimeout.value = setTimeout(() => {
      showMessage.value = false
    }, 10000)
  }
}

// 开始游戏功能
const startGame = async () => {
  try {
    showMessage.value = true
    currentMessage.value = '🎮 猜数字游戏：我想一个1-100之间的数字，您来猜！'
    isAIResponse.value = false
    updateMood('happy')
    
    // 简单的猜数字游戏逻辑可以在这里实现
    
    if (autoVoiceEnabled.value) {
      await speakTextEnhanced('猜数字游戏开始，我想一个1到100之间的数字，您来猜')
    }
    
    clearMessageTimeout()
    messageTimeout.value = setTimeout(() => {
      showMessage.value = false
    }, 8000)
  } catch (error) {
    console.error('游戏功能失败:', error)
  }
}

// 获取名言功能（增强版 - 更多名言）
const getQuote = async () => {
  try {
    isThinking.value = true
    showMessage.value = true
    currentMessage.value = '💬 让我送你一句话...'
    isAIResponse.value = true
    updateMood('focused')
    
    const quotes = [
      { author: '爱因斯坦', content: '想象力比知识更重要。' },
      { author: '爱迪生', content: '天才就是百分之一的灵感加上百分之九十九的汗水。' },
      { author: '马云', content: '今天很残酷，明天更残酷，后天很美好。' },
      { author: '乔布斯', content: 'Stay hungry, stay foolish.' },
      { author: '巴菲特', content: '投资自己是最好的投资。' },
      { author: '孔子', content: '三人行，必有我师焉。' },
      { author: '老子', content: '千里之行，始于足下。' },
      { author: '鲁迅', content: '世上本没有路，走的人多了，也便成了路。' },
      { author: '李嘉诚', content: '鸡蛋，从外打破是食物，从内打破是生命。' },
      { author: '雷军', content: '站在风口上，猪都能飞起来。' },
      { author: '任正非', content: '华为没有成功，只是在成长。' },
      { author: '张一鸣', content: '延迟满足感，是一种很重要的能力。' },
      { author: '王兴', content: '你只管努力，剩下的交给时间。' },
      { author: '马斯克', content: '如果一件事足够重要，即使可能失败，你也应该去做。' },
      { author: '贝索斯', content: '长期主义是最重要的事。' }
    ]
    
    const quote = quotes[Math.floor(Math.random() * quotes.length)]
    currentMessage.value = `💬 "${quote.content}"\n—— ${quote.author}`
    
    if (autoVoiceEnabled.value) {
      await speakTextEnhanced(`${quote.content}，${quote.author}`)
    } else {
      isThinking.value = false
    }
  } catch (error) {
    console.error('获取名言失败:', error)
    currentMessage.value = '抱歉，名言功能暂时不可用'
    isThinking.value = false
  } finally {
    clearMessageTimeout()
    messageTimeout.value = setTimeout(() => {
      showMessage.value = false
    }, 10000)
  }
}

// AI视觉功能 - 摄像头控制
const toggleCamera = async () => {
  if (cameraEnabled.value) {
    // 关闭摄像头
    if (videoStream.value) {
      videoStream.value.getTracks().forEach(track => track.stop())
      videoStream.value = null
    }
    cameraEnabled.value = false
    isAnalyzingVision.value = false
    showMessage.value = true
    currentMessage.value = '👁️ 摄像头已关闭'
    isAIResponse.value = false
    if (autoVoiceEnabled.value) speakTextEnhanced('摄像头已关闭')
  } else {
    // 开启摄像头
    try {
      showMessage.value = true
      currentMessage.value = '👁️ 正在请求摄像头权限...'
      isAIResponse.value = true
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: 640, height: 480 } 
      })
      videoStream.value = stream
      cameraEnabled.value = true
      
      currentMessage.value = '👁️ 摄像头已开启！我可以看到周围环境了~'
      updateMood('excited')
      
      if (autoVoiceEnabled.value) {
        speakTextEnhanced('摄像头已开启，我可以看到周围环境了')
      }
      
      // 延迟后自动分析
      setTimeout(() => {
        if (cameraEnabled.value) {
          analyzeVision()
        }
      }, 2000)
    } catch (error) {
      console.error('摄像头访问失败:', error)
      currentMessage.value = '⚠️ 无法访问摄像头，请检查权限设置'
      if (autoVoiceEnabled.value) speakTextEnhanced('无法访问摄像头，请检查权限设置')
    }
  }
  
  clearMessageTimeout()
  messageTimeout.value = setTimeout(() => {
    showMessage.value = false
  }, 5000)
}

// AI视觉分析
const analyzeVision = async () => {
  if (!cameraEnabled.value || isAnalyzingVision.value) return
  
  isAnalyzingVision.value = true
  isThinking.value = true
  showMessage.value = true
  currentMessage.value = '👁️ 正在分析画面...'
  isAIResponse.value = true
  
  try {
    // 模拟视觉分析结果
    const analysisResults = [
      '👁️ 检测到办公环境，光线充足，适合工作~',
      '👁️ 画面清晰，环境整洁，工作状态良好！',
      '👁️ 检测到显示器，建议适当休息保护眼睛',
      '👁️ 环境安静，适合专注工作',
      '👁️ 检测到文档/资料，工作进行中~'
    ]
    
    const result = analysisResults[Math.floor(Math.random() * analysisResults.length)]
    currentMessage.value = result
    updateMood('happy')
    
    if (autoVoiceEnabled.value) {
      await speakTextEnhanced(result)
    } else {
      isThinking.value = false
    }
  } catch (error) {
    console.error('视觉分析失败:', error)
    currentMessage.value = '视觉分析暂时不可用'
    isThinking.value = false
  } finally {
    isAnalyzingVision.value = false
    clearMessageTimeout()
    messageTimeout.value = setTimeout(() => {
      showMessage.value = false
    }, 8000)
  }
}

// 加载用户偏好和提醒
const loadUserData = () => {
  try {
    const savedPrefs = localStorage.getItem('robot_user_preferences')
    if (savedPrefs) {
      userPreferences.value = { ...userPreferences.value, ...JSON.parse(savedPrefs) }
    }
    
    const savedReminders = localStorage.getItem('robot_reminders')
    if (savedReminders) {
      reminders.value = JSON.parse(savedReminders)
      checkReminders()
    }
    
    const savedAchievements = localStorage.getItem('robot_achievements')
    if (savedAchievements) {
      achievements.value = JSON.parse(savedAchievements)
    }
  } catch (e) {
    console.warn('加载用户数据失败:', e)
  }
}

// 检查提醒
const checkReminders = () => {
  const now = new Date()
  const currentTime = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
  
  reminders.value.forEach(reminder => {
    if (reminder.time === currentTime && !reminder.triggered) {
      reminder.triggered = true
      
      showMessage.value = true
      currentMessage.value = `⏰ 提醒：${reminder.content}`
      isAIResponse.value = false
      
      if (autoVoiceEnabled.value) {
        speakTextEnhanced(`提醒：${reminder.content}`)
      }
      
      setTimeout(() => {
        showMessage.value = false
      }, 5000)
    }
  })
}

// 定期检查提醒（每分钟）
const reminderCheckInterval = ref(null)

onMounted(() => {
  loadConversationHistory()
  loadUserData()
  
  // 初始化语音合成
  if ('speechSynthesis' in window) {
    synth.value = window.speechSynthesis
    
    const loadVoices = () => {
      const voices = synth.value.getVoices()
      if (voices.length > 0) {
        console.log('可用语音:', voices.filter(v => v.lang.includes('zh')))
      }
    }
    
    if (synth.value.onvoiceschanged !== undefined) {
      synth.value.onvoiceschanged = loadVoices
    }
    loadVoices()
  }
  
  initSpeechRecognition()
  
  reminderCheckInterval.value = setInterval(() => {
    checkReminders()
  }, 60000)
  
  // 初始欢迎消息（个性化 - 根据时间段）
  setTimeout(() => {
    if (!showMessage.value) {
      showMessage.value = true
      const hour = new Date().getHours()
      let timeGreeting = ''
      if (hour < 6) {
        timeGreeting = '夜深了，还在忙呀？'
      } else if (hour < 9) {
        timeGreeting = '早上好！'
      } else if (hour < 12) {
        timeGreeting = '上午好！'
      } else if (hour < 14) {
        timeGreeting = '中午好！记得吃饭哦~'
      } else if (hour < 18) {
        timeGreeting = '下午好！'
      } else if (hour < 22) {
        timeGreeting = '晚上好！'
      } else {
        timeGreeting = '夜深了，注意休息哦~'
      }
      
      const greeting = userPreferences.value.name 
        ? `👋 ${timeGreeting}${userPreferences.value.name}！我是马上有，随时为您服务~`
        : `👋 ${timeGreeting}我是您的企业经营助理马上有，有什么可以帮您的？`
      currentMessage.value = greeting
      isAIResponse.value = false
      updateMood('friendly')
      
      if (autoVoiceEnabled.value) {
        setTimeout(() => {
          speakTextEnhanced(greeting)
        }, 500)
      }
      
      messageTimeout.value = setTimeout(() => {
        showMessage.value = false
      }, 6000)
    }
  }, 1000)
})

onUnmounted(() => {
  clearMessageTimeout()
  
  if (reminderCheckInterval.value) {
    clearInterval(reminderCheckInterval.value)
    reminderCheckInterval.value = null
  }
  
  if (recognition.value && isListening.value) {
    recognition.value.stop()
  }
  
  if (synth.value?.speaking || currentUtterance.value || companionTtsAudio.value) {
    companionSpeakSeq++
    haltCompanionTtsPlaybackNoSeqBump()
  }

  if (currentAudio.value) {
    currentAudio.value.pause()
    currentAudio.value = null
  }
})

// 监听数据变化，主动提示
watch(() => props.dashboardStats, (newStats) => {
  if (newStats && Object.keys(newStats).length > 0 && !showMessage.value) {
    if (Math.random() > 0.7) {
      setTimeout(() => {
        if (!showMessage.value) {
          showMessage.value = true
          currentMessage.value = generateContextualMessage(newStats)
          isAIResponse.value = false
          
          if (autoVoiceEnabled.value) {
            speakTextEnhanced(currentMessage.value)
          }
          
          clearMessageTimeout()
          messageTimeout.value = setTimeout(() => {
            showMessage.value = false
          }, 6000)
        }
      }, 2000)
    }
  }
}, { deep: true })
</script>

<style src="../styles/companion-robot-vi.css"></style>
