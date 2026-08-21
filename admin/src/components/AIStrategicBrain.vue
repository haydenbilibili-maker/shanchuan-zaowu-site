<template>
  <div class="ai-strategic-brain">
    <!-- 顶部导航栏 -->
    <div class="ai-header">
      <div class="header-left">
        <h2 class="title">✦ AI 战略智脑</h2>
        <div class="mode-switcher">
          <button 
            @click="currentMode = 'chat'"
            :class="['mode-btn', currentMode === 'chat' ? 'active' : '']"
          >
            💬 单角色咨询
          </button>
          <button 
            @click="currentMode = 'debate'"
            :class="['mode-btn', currentMode === 'debate' ? 'active' : '']"
          >
            🗣️ 智能博弈辩论
          </button>
        </div>
      </div>
      <div class="header-right">
        <button @click="handleToolCenterAction" class="tool-center-btn" :title="isEmbedded ? '关闭战略智脑' : '前往AI工具中心'">
          {{ isEmbedded ? '关闭工作台' : '🛠️ 工具中心' }}
        </button>
        <button @click="showPersonaPanel = !showPersonaPanel" class="persona-toggle-btn" :class="{ active: showPersonaPanel }">
          {{ showPersonaPanel ? '隐藏' : '显示' }}角色面板
        </button>
        <button @click="clearHistory" class="clear-btn" title="清空对话历史">
          🗑️ 清空
        </button>
        <div v-if="isSpeaking" class="speaking-indicator">🔊 正在播报...</div>
      </div>
    </div>

    <div class="ai-container">
      <!-- 左侧：角色选择面板 -->
      <div class="persona-panel" :class="{ 'panel-hidden': !showPersonaPanel }">
        <div class="panel-header">
          <h3>角色选择</h3>
          <div class="persona-search">
            <el-input
              v-model="personaSearch"
              placeholder="搜索角色..."
              size="small"
              clearable
            />
          </div>
        </div>
        <div class="persona-list">
          <div
            v-for="(persona, key) in filteredPersonas"
            :key="key"
            @click="selectPersona(key)"
            :class="['persona-card', personaMode === key ? 'active' : '']"
          >
            <div class="persona-icon">{{ persona.icon }}</div>
            <div class="persona-info">
              <div class="persona-name">{{ persona.name }}</div>
              <div class="persona-desc">{{ persona.shortDesc }}</div>
            </div>
            <div v-if="personaMode === key" class="persona-check">✓</div>
          </div>
        </div>
      </div>

      <!-- 中间：聊天区域 -->
      <div class="chat-area">
        <div class="chat-header" v-if="currentMode === 'debate'">
          <div class="debate-controls">
            <el-button size="small" @click="startDebate" :disabled="isDebating || isAiThinking">
              🚀 开始辩论
            </el-button>
            <el-button size="small" @click="stopDebate" :disabled="!isDebating">
              ⏹️ 停止辩论
            </el-button>
            <el-select v-model="debateTopic" size="small" placeholder="选择辩论主题" style="width: 200px">
              <el-option label="是否应该扩大线上销售渠道？" value="online-expansion" />
              <el-option label="是否应该增加门店体验投入？" value="store-experience" />
              <el-option label="是否应该开发新产品线？" value="product-line" />
              <el-option label="是否应该加大营销预算？" value="marketing-budget" />
              <el-option label="自定义主题" value="custom" />
            </el-select>
            <el-input
              v-if="debateTopic === 'custom'"
              v-model="customDebateTopic"
              size="small"
              placeholder="输入辩论主题..."
              style="width: 200px"
            />
            <el-select v-model="selectedDebatePersonas" multiple size="small" placeholder="选择参与角色" style="width: 300px">
              <el-option
                v-for="(persona, key) in personas"
                :key="key"
                :label="persona.name"
                :value="key"
              />
            </el-select>
          </div>
        </div>

        <div ref="chatBoxRef" class="chat-box">
          <div 
            v-for="(msg, index) in messages" 
            :key="index" 
            :class="['chat-item', msg.role === 'ai' ? 'ai-msg' : 'user-msg', msg.persona ? `persona-${msg.persona}` : '']"
          >
            <div class="msg-header" v-if="msg.persona">
              <span class="persona-badge" :style="{ '--persona-color': personas[msg.persona]?.color || '#38bdf8' }">
                {{ personas[msg.persona]?.icon }} {{ personas[msg.persona]?.name }}
              </span>
            </div>
            <div :class="['chat-bubble', msg.role === 'ai' ? 'bubble-ai' : 'bubble-user']">
              <div v-html="msg.content"></div>
              <div 
                v-if="msg.role === 'ai' && msg.rawText" 
                @click="playAudio(msg.rawText, msg.persona)" 
                :class="['voice-btn', isPlaying && currentAudioText === msg.rawText ? 'voice-active' : '']"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="voice-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                </svg>
                播放语音
              </div>
            </div>
          </div>
          <div v-if="isAiThinking" class="chat-item ai-msg">
            <div class="chat-bubble bubble-ai thinking">
              {{ currentPersona.thinkingMsg }}
              <span class="thinking-dots">
                <span>.</span><span>.</span><span>.</span>
              </span>
            </div>
          </div>
        </div>
        
        <!-- 输入区域 -->
        <div class="input-area">
          <el-input
            v-model="aiInput"
            @keyup.enter="handleEnterKey"
            @keydown.enter.prevent
            :placeholder="currentMode === 'debate' ? '输入辩论主题或观察...' : '输入指令，例如：生成经营诊断、评估风险、制定营销方案...'"
            class="ai-input"
            clearable
            :disabled="isAiThinking || isDebating"
          />
          <el-button 
            type="primary" 
            @click="sendAI" 
            :loading="isAiThinking || isDebating"
            :disabled="!aiInput.trim() || isAiThinking || isDebating"
            class="send-btn"
          >
            发送
          </el-button>
        </div>
      </div>

      <!-- 右侧：快捷指令区域 -->
      <div class="quick-actions">
        <div class="quick-title">快捷指令</div>
        
        <!-- 周报生成区域 -->
        <div class="weekly-report-section">
          <div class="section-title">📊 智能周报生成</div>
          <el-button 
            @click="generateWeeklyReport('finance')" 
            class="report-btn"
            :loading="isGeneratingReport"
            :disabled="isAiThinking || isDebating || isGeneratingReport"
          >
            💰 财务周报
          </el-button>
          <el-button 
            @click="generateWeeklyReport('operations')" 
            class="report-btn"
            :loading="isGeneratingReport"
            :disabled="isAiThinking || isDebating || isGeneratingReport"
          >
            ⚙️ 运营周报
          </el-button>
          <el-button 
            @click="generateWeeklyReport('inventory')" 
            class="report-btn"
            :loading="isGeneratingReport"
            :disabled="isAiThinking || isDebating || isGeneratingReport"
          >
            📦 库存周报
          </el-button>
          <el-button 
            @click="generateWeeklyReport('members')" 
            class="report-btn"
            :loading="isGeneratingReport"
            :disabled="isAiThinking || isDebating || isGeneratingReport"
          >
            👥 会员周报
          </el-button>
          <el-button 
            @click="generateWeeklyReport('activities')" 
            class="report-btn"
            :loading="isGeneratingReport"
            :disabled="isAiThinking || isDebating || isGeneratingReport"
          >
            🎯 活动周报
          </el-button>
          <el-button 
            @click="generateWeeklyReport('all')" 
            class="report-btn report-btn-full"
            :loading="isGeneratingReport"
            :disabled="isAiThinking || isDebating || isGeneratingReport"
          >
            📋 全站综合周报
          </el-button>
        </div>
        
        <el-divider style="margin: 16px 0; border-color: #333;" />
        
        <div class="quick-title">常规指令</div>
        <el-button 
          v-for="(action, key) in quickActions"
          :key="key"
          @click="quickAI(key)" 
          class="quick-btn"
          text
          :disabled="isAiThinking || isDebating"
        >
          {{ action.icon }} {{ action.label }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import { marked } from 'marked'
import { ElMessage } from 'element-plus'
import { COLLECTIONS, getCollectionData, countCollection } from '../cloud'
import { callGeminiAPI, buildConversationHistory as buildHistory, enhancePrompt } from '../utils/aiHelper'

const props = defineProps({
  feature: {
    type: Object,
    default: null,
  },
})
const emit = defineEmits(['close'])
const isEmbedded = computed(() => Boolean(props.feature))

// 状态
const messages = ref([
  {
    role: 'ai',
    content: '<strong>AI 战略顾问:</strong> 系统已就绪 (API Connected)。<br>全量业务数据已加载。<br>可以选择单个角色咨询，或启动智能博弈辩论模式。',
    rawText: '系统已就绪，全量业务数据已加载。可以选择单个角色咨询，或启动智能博弈辩论模式。'
  }
])
const aiInput = ref('')
const personaMode = ref('cfo')
const currentMode = ref('chat') // 'chat' | 'debate'
const isAiThinking = ref(false)
const isSpeaking = ref(false)
const currentAudioText = ref('')
const isPlaying = ref(false)
const chatBoxRef = ref(null)
const showPersonaPanel = ref(true)
const personaSearch = ref('')
const isDebating = ref(false)
const debateTopic = ref('')
const customDebateTopic = ref('')
const selectedDebatePersonas = ref(['cfo', 'cmo', 'coo'])
const isGeneratingReport = ref(false)
const siteData = ref(null) // 全站数据缓存

// 语音设置 - 自然普通话，国语声调，男性
// 参数说明：rate(0.5-2.0) 语速，pitch(0-2) 音调，volume(0-1) 音量
// 优化原则：使用标准普通话参数，保持自然、清晰、不机械
const voiceSettings = {
  default: { 
    rate: 1.0,       // 标准语速，自然流畅
    pitch: 1.0,     // 标准音调，自然清晰
    volume: 0.9,    // 标准音量，清晰可听
    preferredVoices: [
      'Microsoft Yunyang',      // 微软云扬（男声，标准普通话）
      'Microsoft Yunxi',         // 微软云希（男声，标准普通话）
      'Microsoft Yunfeng',       // 微软云峰（男声，标准普通话）
      'Microsoft Yunjian',       // 微软云健（男声，标准普通话）
      'Google 普通话（中国大陆）', // Google 标准普通话
    ]
  },
  // CFO - 严谨财务：标准普通话，稍沉稳
  cfo: { 
    rate: 0.95,      // 稍慢，更沉稳
    pitch: 0.98,     // 标准音调，稍低更沉稳
    volume: 0.9,     // 标准音量
    preferredVoices: [
      'Microsoft Yunyang',      // 云扬 - 标准普通话（首选）
      'Microsoft Yunfeng',      // 云峰 - 标准普通话
      'Microsoft Yunjian',      // 云健 - 标准普通话
      'Google 普通话（中国大陆）'
    ]
  },
  // CMO - 创意营销：标准普通话，清晰有活力
  cmo: { 
    rate: 1.0,       // 标准语速
    pitch: 1.0,      // 标准音调
    volume: 0.9,     // 标准音量
    preferredVoices: [
      'Microsoft Yunxi',         // 云希 - 标准普通话（首选）
      'Microsoft Yunjian',        // 云健 - 标准普通话
      'Microsoft Yunyang',        // 云扬 - 标准普通话
      'Google 普通话（中国大陆）'
    ]
  },
  // COO - 运营管理：标准普通话，自然专业
  coo: { 
    rate: 1.0,       // 标准语速
    pitch: 1.0,      // 标准音调
    volume: 0.9,     // 标准音量
    preferredVoices: [
      'Microsoft Yunyang',      // 云扬 - 标准普通话（首选）
      'Microsoft Yunxi',         // 云希 - 标准普通话
      'Google 普通话（中国大陆）'
    ]
  },
  // Designer - 产品设计：标准普通话，自然温和
  designer: { 
    rate: 0.98,      // 标准语速，稍慢
    pitch: 1.0,      // 标准音调
    volume: 0.9,     // 标准音量
    preferredVoices: [
      'Microsoft Yunxi',         // 云希 - 标准普通话（首选）
      'Microsoft Yunjian',        // 云健 - 标准普通话
      'Microsoft Yunyang',        // 云扬 - 标准普通话
      'Google 普通话（中国大陆）'
    ]
  },
  // Visual - 视觉设计：标准普通话，清晰专业
  visual: { 
    rate: 1.0,       // 标准语速
    pitch: 1.0,      // 标准音调
    volume: 0.9,     // 标准音量
    preferredVoices: [
      'Microsoft Yunxi',         // 云希 - 标准普通话（首选）
      'Microsoft Yunjian',        // 云健 - 标准普通话
      'Microsoft Yunyang',        // 云扬 - 标准普通话
      'Google 普通话（中国大陆）'
    ]
  },
  // Store - 门店营销：标准普通话，稳重专业
  store: { 
    rate: 0.98,      // 标准语速，稍慢
    pitch: 0.98,     // 标准音调，稍低
    volume: 0.9,     // 标准音量
    preferredVoices: [
      'Microsoft Yunyang',      // 云扬 - 标准普通话（首选）
      'Microsoft Yunfeng',      // 云峰 - 标准普通话
      'Microsoft Yunjian',      // 云健 - 标准普通话
      'Google 普通话（中国大陆）'
    ]
  },
  // Online - 线上流量：标准普通话，清晰有活力
  online: { 
    rate: 1.0,       // 标准语速
    pitch: 1.0,      // 标准音调
    volume: 0.9,     // 标准音量
    preferredVoices: [
      'Microsoft Yunxi',         // 云希 - 标准普通话（首选）
      'Microsoft Yunjian',        // 云健 - 标准普通话
      'Microsoft Yunyang',        // 云扬 - 标准普通话
      'Google 普通话（中国大陆）'
    ]
  },
  // Private - 私域运营：标准普通话，亲和自然
  private: { 
    rate: 0.98,      // 标准语速，稍慢
    pitch: 1.0,      // 标准音调
    volume: 0.9,     // 标准音量
    preferredVoices: [
      'Microsoft Yunxi',         // 云希 - 标准普通话（首选）
      'Microsoft Yunjian',        // 云健 - 标准普通话
      'Microsoft Yunyang',        // 云扬 - 标准普通话
      'Google 普通话（中国大陆）'
    ]
  },
}

// 全局调试开关
const DEBUG_MODE = true
const debugLog = (...args) => {
  if (DEBUG_MODE) {
    console.log('[AI Debug]', ...args)
  }
}

// 全站数据获取函数
const fetchSiteData = async (showMessage = true) => {
  debugLog('fetchSiteData 开始执行', { showMessage, hasCache: !!siteData.value })
  
  // 如果缓存数据在5分钟内，直接返回
  if (siteData.value && siteData.value.fetchTime && (Date.now() - siteData.value.fetchTime) < 5 * 60 * 1000) {
    debugLog('使用缓存数据', siteData.value)
    return siteData.value // 返回缓存数据
  }
  
  try {
    debugLog('开始拉取全站数据（CDN）...')
    
    if (showMessage) {
      ElMessage.info('正在获取全站数据...')
    }
    
    // 计算本周时间范围
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay()) // 本周一
    weekStart.setHours(0, 0, 0, 0)
    const weekStartTime = weekStart.getTime()
    
    const weekAgo = new Date(now)
    weekAgo.setDate(now.getDate() - 7)
    const weekAgoTime = weekAgo.getTime()
    
    debugLog('开始并行获取数据...', { weekStartTime, weekAgoTime })
    
    // 并行获取所有数据（添加错误处理）
    let products = [], orders = [], users = [], activities = [], bookings = [], coupons = []
    let productsCount = 0, ordersCount = 0, usersCount = 0, activitiesCount = 0, bookingsCount = 0, couponsCount = 0
    
    try {
      const results = await Promise.allSettled([
        // 获取数据
        getCollectionData(COLLECTIONS.PRODUCTS, { limit: 1000 }).catch(e => { debugLog('获取products失败', e); return [] }),
        getCollectionData(COLLECTIONS.ORDERS, { 
          orderBy: { field: 'createTime', order: 'desc' },
          limit: 500 
        }).catch(e => { debugLog('获取orders失败', e); return [] }),
        getCollectionData(COLLECTIONS.USERS, { limit: 1000 }).catch(e => { debugLog('获取users失败', e); return [] }),
        getCollectionData(COLLECTIONS.ACTIVITIES, { limit: 100 }).catch(e => { debugLog('获取activities失败', e); return [] }),
        getCollectionData(COLLECTIONS.BOOKINGS, { limit: 500 }).catch(e => { debugLog('获取bookings失败', e); return [] }),
        getCollectionData(COLLECTIONS.COUPONS, { limit: 500 }).catch(e => { debugLog('获取coupons失败', e); return [] }),
        // 统计数据
        countCollection(COLLECTIONS.PRODUCTS).catch(e => { debugLog('统计products失败', e); return 0 }),
        countCollection(COLLECTIONS.ORDERS).catch(e => { debugLog('统计orders失败', e); return 0 }),
        countCollection(COLLECTIONS.USERS).catch(e => { debugLog('统计users失败', e); return 0 }),
        countCollection(COLLECTIONS.ACTIVITIES).catch(e => { debugLog('统计activities失败', e); return 0 }),
        countCollection(COLLECTIONS.BOOKINGS).catch(e => { debugLog('统计bookings失败', e); return 0 }),
        countCollection(COLLECTIONS.COUPONS).catch(e => { debugLog('统计coupons失败', e); return 0 })
      ])
      
      debugLog('数据获取结果:', results.map((r, i) => ({ index: i, status: r.status, value: r.status === 'fulfilled' ? (Array.isArray(r.value) ? r.value.length : r.value) : r.reason })))
      
      // 处理结果
      products = results[0].status === 'fulfilled' ? (results[0].value || []) : []
      orders = results[1].status === 'fulfilled' ? (results[1].value || []) : []
      users = results[2].status === 'fulfilled' ? (results[2].value || []) : []
      activities = results[3].status === 'fulfilled' ? (results[3].value || []) : []
      bookings = results[4].status === 'fulfilled' ? (results[4].value || []) : []
      coupons = results[5].status === 'fulfilled' ? (results[5].value || []) : []
      
      productsCount = results[6].status === 'fulfilled' ? (results[6].value || 0) : products.length
      ordersCount = results[7].status === 'fulfilled' ? (results[7].value || 0) : orders.length
      usersCount = results[8].status === 'fulfilled' ? (results[8].value || 0) : users.length
      activitiesCount = results[9].status === 'fulfilled' ? (results[9].value || 0) : activities.length
      bookingsCount = results[10].status === 'fulfilled' ? (results[10].value || 0) : bookings.length
      couponsCount = results[11].status === 'fulfilled' ? (results[11].value || 0) : coupons.length
      
      debugLog('数据解析完成', { 
        products: products.length, orders: orders.length, users: users.length,
        activities: activities.length, bookings: bookings.length, coupons: coupons.length
      })
    } catch (dataErr) {
      debugLog('数据获取过程出错', dataErr)
      // 继续执行，使用空数据
    }
    
    // 本周新增订单（增强错误处理）
    const weeklyOrders = orders.filter(o => {
      try {
        const orderTime = o.createTime || o._createTime || o.create_time || 0
        return orderTime >= weekAgoTime
      } catch (e) {
        debugLog('订单时间解析失败', o, e)
        return false
      }
    })
    
    debugLog('本周订单数:', weeklyOrders.length)
    
    // 本周新增用户（增强错误处理）
    const weeklyUsers = users.filter(u => {
      try {
        const userTime = u.createTime || u._createTime || u.create_time || u.registerTime || 0
        return userTime >= weekAgoTime
      } catch (e) {
        debugLog('用户时间解析失败', u, e)
        return false
      }
    })
    
    debugLog('本周用户数:', weeklyUsers.length)
    
    // 计算财务数据（增强错误处理和多种字段支持）
    let totalRevenue = 0
    try {
      totalRevenue = weeklyOrders
        .filter(o => {
          const status = o.status || o.orderStatus || ''
          return status === 'paid' || status === 'completed' || status === '已支付' || status === '已完成'
        })
        .reduce((sum, o) => {
          try {
            const amount = parseFloat(o.totalAmount) || parseFloat(o.total_amount) || parseFloat(o.amount) || parseFloat(o.price) || 0
            return sum + amount
          } catch (e) {
            debugLog('订单金额解析失败', o, e)
            return sum
          }
        }, 0)
      debugLog('本周营收:', totalRevenue)
    } catch (e) {
      debugLog('财务数据计算失败', e)
      totalRevenue = 0
    }
    
    // 库存数据
    const lowStockProducts = products.filter(p => (p.stock || 0) < 3 && p.stock > 0)
    const outOfStockProducts = products.filter(p => (p.stock || 0) === 0)
    const totalInventoryValue = products.reduce((sum, p) => {
      const stock = p.stock || 0
      const cost = parseFloat(p.costPrice) || parseFloat(p.price) * 0.6 || 0
      return sum + (stock * cost)
    }, 0)
    
    // 会员数据
    const activeMembers = users.filter(u => {
      const lastActive = u.lastActiveTime || u.updateTime || u._updateTime || 0
      return lastActive >= weekAgoTime
    })
    
    // 活动数据
    const activeActivities = activities.filter(a => {
      const now = Date.now()
      const startTime = a.startTime || a.date || 0
      const endTime = a.endTime || a.date || 0
      return startTime <= now && endTime >= now
    })
    
    // 构建返回数据
    const data = {
      // 基础统计
      products: { total: productsCount, items: products },
      orders: { total: ordersCount, items: orders, weekly: weeklyOrders },
      users: { total: usersCount, items: users, weekly: weeklyUsers, active: activeMembers },
      activities: { total: activitiesCount, items: activities, active: activeActivities },
      bookings: { total: bookingsCount, items: bookings },
      coupons: { total: couponsCount, items: coupons },
      
      // 财务数据
      finance: {
        weeklyRevenue: totalRevenue,
        weeklyOrdersCount: weeklyOrders.length,
        averageOrderValue: weeklyOrders.length > 0 ? totalRevenue / weeklyOrders.length : 0,
        totalRevenue: totalRevenue, // 添加总营收字段
        totalProfit: totalRevenue * 0.55 // 假设毛利率55%
      },
      
      // 库存数据
      inventory: {
        totalProducts: productsCount,
        lowStock: lowStockProducts.length,
        outOfStock: outOfStockProducts.length,
        totalValue: totalInventoryValue,
        lowStockProducts: lowStockProducts,
        outOfStockProducts: outOfStockProducts
      },
      
      // 会员数据
      members: {
        total: usersCount,
        weeklyNew: weeklyUsers.length,
        active: activeMembers.length,
        activeRate: usersCount > 0 ? parseFloat((activeMembers.length / usersCount * 100).toFixed(2)) : 0
      },
      
      // 活动数据
      activitiesData: {
        total: activitiesCount,
        active: activeActivities.length,
        upcoming: activities.filter(a => {
          const startTime = a.startTime || a.date || 0
          return startTime > Date.now()
        }).length
      },
      
      // 时间范围
      timeRange: {
        weekStart: weekStartTime,
        weekAgo: weekAgoTime,
        now: Date.now()
      },
      
      fetchTime: Date.now()
    }
    
    siteData.value = data
    debugLog('数据构建完成', data)
    
    if (showMessage) {
      ElMessage.success(`全站数据获取成功 (商品${productsCount}件, 订单${ordersCount}单, 用户${usersCount}人)`)
    }
    return data
  } catch (error) {
    debugLog('获取全站数据失败', error)
    console.error('❌ 获取全站数据失败:', error)
    const errorMsg = error.message || error.toString() || '未知错误'
    ElMessage.error(`获取全站数据失败: ${errorMsg}`)
    
    // 返回空数据结构，避免后续报错
    const emptyData = {
      products: { total: 0, items: [] },
      orders: { total: 0, items: [], weekly: [] },
      users: { total: 0, items: [], weekly: [], active: [] },
      activities: { total: 0, items: [], active: [] },
      bookings: { total: 0, items: [] },
      coupons: { total: 0, items: [] },
      finance: { weeklyRevenue: 0, weeklyOrdersCount: 0, averageOrderValue: 0, totalRevenue: 0, totalProfit: 0 },
      inventory: { totalProducts: 0, lowStock: 0, outOfStock: 0, totalValue: 0, lowStockProducts: [], outOfStockProducts: [] },
      members: { total: 0, weeklyNew: 0, active: 0, activeRate: 0 },
      activitiesData: { total: 0, active: 0, upcoming: 0 },
      timeRange: { weekStart: 0, weekAgo: 0, now: Date.now() },
      fetchTime: Date.now()
    }
    siteData.value = emptyData
    return null
  }
}

// 生成周报
const generateWeeklyReport = async (type) => {
  isGeneratingReport.value = true
  
  try {
    ElMessage.info('正在获取数据并生成周报...')
    
    // 获取全站数据（显示提示）
    const data = await fetchSiteData(true)
    if (!data) {
      ElMessage.error('数据获取失败，无法生成周报')
      isGeneratingReport.value = false
      return
    }
    
    // 构建周报提示词
    let reportPrompt = ''
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay())
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    
    const dateRange = `${weekStart.getMonth() + 1}月${weekStart.getDate()}日 - ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`
    
    switch (type) {
      case 'finance':
        reportPrompt = `请生成${dateRange}的财务周报。基于以下数据：
        
财务数据：
- 本周营收：¥${data.finance.weeklyRevenue.toFixed(2)}
- 本周订单数：${data.finance.weeklyOrdersCount}单
- 平均客单价：¥${data.finance.averageOrderValue.toFixed(2)}
- 订单总数：${data.orders.total}

订单状态分布：
${data.orders.items.slice(0, 50).reduce((acc, o) => {
  const status = o.status || 'unknown'
  acc[status] = (acc[status] || 0) + 1
  return acc
}, {})}

请生成一份专业的财务周报，包括：
1. 本周财务总结
2. 关键指标分析
3. 对比分析（如有历史数据）
4. 风险提示
5. 下周财务建议`
        break
        
      case 'operations':
        reportPrompt = `请生成${dateRange}的运营周报。基于以下数据：
        
运营数据：
- 商品总数：${data.products.total}
- 订单总数：${data.orders.total}
- 本周新增订单：${data.orders.weekly.length}
- 活动总数：${data.activities.total}
- 进行中活动：${data.activitiesData.active}
- 预约总数：${data.bookings.total}

请生成一份专业的运营周报，包括：
1. 本周运营总结
2. 关键运营指标
3. 活动效果分析
4. 运营问题识别
5. 下周运营计划`
        break
        
      case 'inventory':
        reportPrompt = `请生成${dateRange}的库存管理周报。基于以下数据：
        
库存数据：
- 商品总数：${data.inventory.totalProducts}
- 库存总价值：¥${data.inventory.totalValue.toFixed(2)}
- 低库存商品：${data.inventory.lowStock}件
- 缺货商品：${data.inventory.outOfStock}件

低库存商品列表：
${data.inventory.lowStockProducts.slice(0, 10).map(p => `- ${p.title} (库存: ${p.stock})`).join('\n')}

缺货商品列表：
${data.inventory.outOfStockProducts.slice(0, 10).map(p => `- ${p.title}`).join('\n')}

请生成一份专业的库存管理周报，包括：
1. 库存概况
2. 低库存和缺货预警
3. 库存周转分析
4. 补货建议
5. 库存优化方案`
        break
        
      case 'members':
        reportPrompt = `请生成${dateRange}的会员周报。基于以下数据：
        
会员数据：
- 会员总数：${data.members.total}
- 本周新增会员：${data.members.weeklyNew}
- 活跃会员：${data.members.active}
- 活跃率：${data.members.activeRate}%

用户增长趋势：
本周新增${data.members.weeklyNew}位会员

请生成一份专业的会员周报，包括：
1. 会员增长分析
2. 活跃度分析
3. 会员行为洞察
4. 会员运营建议
5. 会员留存策略`
        break
        
      case 'activities':
        reportPrompt = `请生成${dateRange}的活动周报。基于以下数据：
        
活动数据：
- 活动总数：${data.activitiesData.total}
- 进行中活动：${data.activitiesData.active}
- 即将开始：${data.activitiesData.upcoming}

活动列表：
${data.activities.items.slice(0, 10).map(a => `- ${a.title} (状态: ${a.status || 'active'})`).join('\n')}

请生成一份专业的活动周报，包括：
1. 活动执行情况
2. 活动效果评估
3. 参与度分析
4. 活动优化建议
5. 下周活动规划`
        break
        
      case 'all':
        reportPrompt = `请生成${dateRange}的全站综合周报。基于以下完整数据：
        
=== 财务数据 ===
- 本周营收：¥${data.finance.weeklyRevenue.toFixed(2)}
- 本周订单数：${data.finance.weeklyOrdersCount}单
- 平均客单价：¥${data.finance.averageOrderValue.toFixed(2)}

=== 运营数据 ===
- 商品总数：${data.products.total}
- 订单总数：${data.orders.total}
- 活动总数：${data.activities.total}
- 进行中活动：${data.activitiesData.active}

=== 库存数据 ===
- 库存总价值：¥${data.inventory.totalValue.toFixed(2)}
- 低库存商品：${data.inventory.lowStock}件
- 缺货商品：${data.inventory.outOfStock}件

=== 会员数据 ===
- 会员总数：${data.members.total}
- 本周新增：${data.members.weeklyNew}
- 活跃会员：${data.members.active}
- 活跃率：${data.members.activeRate}%

=== 活动数据 ===
- 进行中活动：${data.activitiesData.active}
- 即将开始：${data.activitiesData.upcoming}

请生成一份全面的全站综合周报，包括：
1. 执行摘要
2. 各模块数据概览
3. 关键指标分析
4. 问题与风险识别
5. 下周重点工作建议
6. 数据可视化建议`
        break
    }
    
    // 使用当前选中的角色生成周报
    aiInput.value = reportPrompt
    await sendAI()
    
    ElMessage.success('周报生成完成')
  } catch (error) {
    console.error('生成周报失败:', error)
    ElMessage.error('生成周报失败: ' + (error.message || '未知错误'))
  } finally {
    isGeneratingReport.value = false
  }
}

// 完整的人格配置（包含所有新角色）
const personas = {
  cfo: {
    name: '严谨 CFO',
    icon: '💰',
    color: '#38bdf8',
    shortDesc: '财务分析专家',
    thinkingMsg: '正在分析财务数据',
    systemPrompt: `你是山海造物标本艺术馆的CFO（首席财务官）。你的职责是：
- 提供严谨的财务分析和风险评估
- 基于数据进行决策建议
- 关注成本控制、利润优化和现金流管理
- 分析业务模式的财务可行性

当前业务数据：
- 月营收：¥130k-200k（波动性高）
- 行业规模：¥120亿（CAGR +22%）
- 目标：建立可持续的盈利模式

回答要求：基于数据、逻辑严谨、条理清晰，提供可执行的财务建议。`
  },
  cmo: {
    name: '创意 CMO',
    icon: '🎯',
    color: '#10b981',
    shortDesc: '营销策略专家',
    thinkingMsg: '正在构思创意方案',
    systemPrompt: `你是山海造物标本艺术馆的CMO（首席营销官）。你的职责是：
- 制定品牌传播和营销策略
- 设计创意营销方案
- 分析用户增长和留存
- 制定内容营销计划

品牌定位：自然美学、手作体验、教育价值
目标人群：25-40岁新中产、自然爱好者、教育焦虑家长
核心优势：标本艺术化、沉浸式体验、知识赋能

回答要求：富有创意、洞察深入、可执行性强，结合社交媒体和内容营销。`
  },
  coo: {
    name: '运营 COO',
    icon: '⚙️',
    color: '#f59e0b',
    shortDesc: '运营管理专家',
    thinkingMsg: '正在制定运营策略',
    systemPrompt: `你是山海造物标本艺术馆的COO（首席运营官）。你的职责是：
- 优化门店运营效率和用户体验
- 设计产品线和库存管理
- 规划供应链和供应商管理
- 制定运营标准和SOP

当前运营状况：
- 单店模型：已验证可行
- 手作课程转化率：28.4%
- 核心挑战：非标品管理、供应链风险、易碎物流

回答要求：注重实操、系统性思考、平衡成本与体验，提供可落地的运营方案。`
  },
  designer: {
    name: '标本设计师',
    icon: '🦋',
    color: '#8b5cf6',
    shortDesc: '产品设计专家',
    thinkingMsg: '正在构思设计方案',
    systemPrompt: `你是山海造物标本艺术馆的标本设计师。你的职责是：
- 设计标本产品的艺术呈现方式
- 平衡科学准确性与美学价值
- 考虑标本保存和展示的技术要求
- 创新标本与装饰的结合方式

专业背景：
- 熟悉昆虫、植物、海洋生物的标本制作工艺
- 了解树脂封装、标本画、生态缸等呈现形式
- 关注自然美学与现代家居的结合

设计理念：科学严谨 + 艺术美感 + 教育价值

回答要求：从设计角度思考问题，注重美学、工艺和用户体验的结合。`
  },
  visual: {
    name: '视觉设计师',
    icon: '🎨',
    color: '#ec4899',
    shortDesc: '视觉传达专家',
    thinkingMsg: '正在设计视觉方案',
    systemPrompt: `你是山海造物标本艺术馆的视觉设计师。你的职责是：
- 设计品牌视觉识别系统
- 创建营销素材和宣传视觉
- 优化产品摄影和展示效果
- 设计门店视觉体验

设计风格：
- 自然美学：温暖、有机、真实
- 黑金质感：高端、神秘、品质感
- 教育导向：清晰、专业、启发思考

专业技能：
- 品牌VI设计、包装设计、空间视觉设计
- 摄影构图、色彩搭配、版面设计
- 数字化视觉、社交媒体视觉

回答要求：从视觉传达角度思考，注重品牌一致性、用户体验和视觉冲击力。`
  },
  store: {
    name: '门店营销师',
    icon: '🏪',
    color: '#14b8a6',
    shortDesc: '门店运营专家',
    thinkingMsg: '正在制定门店策略',
    systemPrompt: `你是山海造物标本艺术馆的门店营销师。你的职责是：
- 设计门店体验流程和空间布局
- 制定门店促销和活动方案
- 优化店员服务标准和话术
- 提升进店转化和客单价

门店特色：
- 沉浸式体验：标本展示、手作工坊、知识讲解
- 教育属性：自然科普、亲子互动、学习价值
- 高客单价：艺术价值、收藏价值、情感价值

核心挑战：
- 如何将体验转化为销售
- 如何提高复购率
- 如何处理易碎品的展示

回答要求：从门店运营实战角度思考，注重可执行性、效果可测量性和用户体验。`
  },
  online: {
    name: '线上流量运营',
    icon: '📱',
    color: '#f97316',
    shortDesc: '流量增长专家',
    thinkingMsg: '正在分析流量数据',
    systemPrompt: `你是山海造物标本艺术馆的线上流量运营。你的职责是：
- 制定全平台流量获取策略（抖音、小红书、淘宝、微信）
- 分析流量转化漏斗和用户行为
- 优化内容投放和广告ROI
- 设计用户增长活动和裂变机制

流量渠道：
- 内容平台：小红书种草、抖音短视频、B站科普
- 电商平台：淘宝、京东、抖音小店
- 社交平台：微信群、朋友圈、视频号

核心指标：
- 获客成本（CAC）
- 转化率（CTR、CVR）
- 用户生命周期价值（LTV）
- ROI

回答要求：从流量运营角度思考，注重数据驱动、成本控制和增长效率。`
  },
  private: {
    name: '私域运营',
    icon: '👥',
    color: '#06b6d4',
    shortDesc: '私域增长专家',
    thinkingMsg: '正在设计私域策略',
    systemPrompt: `你是山海造物标本艺术馆的私域运营。你的职责是：
- 构建和管理微信私域生态（个人号、社群、企业微信）
- 设计用户分层和精准运营策略
- 策划社群活动和会员体系
- 提升用户复购和口碑传播

私域价值：
- 降低获客成本
- 提高用户粘性和复购率
- 建立品牌忠诚度
- 收集用户反馈和数据

运营策略：
- 内容运营：知识分享、产品故事、自然科普
- 活动运营：限时优惠、拼团活动、会员专享
- 服务运营：一对一咨询、售后服务、个性化推荐

回答要求：从私域运营角度思考，注重用户关系、社群价值和长期价值。`
  }
}

const currentPersona = computed(() => personas[personaMode.value] || personas.cfo)
const filteredPersonas = computed(() => {
  if (!personaSearch.value) return personas
  const search = personaSearch.value.toLowerCase()
  return Object.fromEntries(
    Object.entries(personas).filter(([key, persona]) => 
      persona.name.toLowerCase().includes(search) || 
      persona.shortDesc.toLowerCase().includes(search)
    )
  )
})

// 快捷指令
const quickActions = {
  diagnosis: { icon: '📊', label: '经营诊断报告' },
  copy: { icon: '✍️', label: '小红书种草文案' },
  risk: { icon: '⚠️', label: '风险评估分析' },
  marketing: { icon: '📢', label: '营销方案制定' },
  strategy: { icon: '🎯', label: '战略规划建议' },
  data: { icon: '📈', label: '数据分析洞察' },
  design: { icon: '🎨', label: '产品设计方案' },
  visual: { icon: '🖼️', label: '视觉设计建议' },
  store: { icon: '🏪', label: '门店营销方案' },
  online: { icon: '📱', label: '流量获取策略' },
  private: { icon: '👥', label: '私域运营方案' }
}

// 选择角色
const selectPersona = (key) => {
  if (currentMode.value === 'chat') {
    personaMode.value = key
    ElMessage.success(`已切换到${personas[key].name}`)
  }
}

// 构建对话历史
// 使用统一的AI辅助工具中的buildConversationHistory
const buildConversationHistory = () => {
  const recentMessages = messages.value.slice(-10)
  return buildHistory(recentMessages.map(msg => ({
    role: msg.role === 'ai' ? 'assistant' : msg.role,
    content: msg.rawText || msg.content.replace(/<[^>]*>/g, '')
  })))
}

// 发送AI请求（单角色模式）
const sendAI = async (retryCount = 0, useBackup = false, prompt = null, specificPersona = null) => {
  if (retryCount === 0) {
    if (!aiInput.value.trim() && !prompt) {
      ElMessage.warning('请输入指令')
      return
    }
    prompt = prompt || aiInput.value.trim()
    messages.value.push({ role: 'user', content: prompt })
    aiInput.value = ''
  }
  
  if (!prompt || !String(prompt).trim()) {
    const lastUserMsg = messages.value.length > 0
      ? [...messages.value].reverse().find(msg => msg.role === 'user')
      : null
    if (lastUserMsg && lastUserMsg.content) {
      prompt = lastUserMsg.content
    } else {
      ElMessage.warning({ message: '请输入问题或指令', duration: 2000 })
      return
    }
  }
  
  isAiThinking.value = true
  await nextTick()
  scrollToBottom()

  try {
    const persona = specificPersona ? personas[specificPersona] : currentPersona.value
    const conversationHistory = buildConversationHistory()
    
    // 获取全站数据（如果需要，但不在周报生成流程中）
    let dataContext = ''
    if (!isGeneratingReport.value && (prompt.includes('数据') || prompt.includes('分析') || prompt.includes('统计') || prompt.includes('营收') || prompt.includes('订单') || prompt.includes('库存') || prompt.includes('会员') || prompt.includes('战略') || prompt.includes('规划') || prompt.includes('竞品') || prompt.includes('产业链') || prompt.includes('门店'))) {
      // 静默获取数据，不显示提示
      try {
        const data = await fetchSiteData(false)
        if (data) {
          dataContext = `\n\n=== 全站实时数据（供参考）===
财务：本周营收¥${data.finance.weeklyRevenue.toFixed(2)}，订单${data.finance.weeklyOrdersCount}单，平均客单价¥${data.finance.averageOrderValue.toFixed(2)}
库存：总价值¥${data.inventory.totalValue.toFixed(2)}，低库存${data.inventory.lowStock}件，缺货${data.inventory.outOfStock}件
会员：总数${data.members.total}，本周新增${data.members.weeklyNew}，活跃${data.members.active}（活跃率${data.members.activeRate}%）
活动：总数${data.activitiesData.total}，进行中${data.activitiesData.active}，即将开始${data.activitiesData.upcoming}
订单：总数${data.orders.total}，本周${data.orders.weekly.length}
商品：总数${data.products.total}

=== 战略参考数据 ===
行业规模：2024年市场规模约¥85亿，CAGR 22.3%，预计2027年达到¥180亿
产品结构：引流款（50%）、利润款（40%）、形象款（10%）
流量渠道：线下门店CAC¥80 ROI 3.5x，小红书CAC¥120 ROI 2.8x，抖音CAC¥150 ROI 2.2x，私域CAC¥30 ROI 5.0x
盈利模型：当前月均订单150单，客单价¥680，毛利率55%，固定成本¥8万
3年规划：2025基础夯实年，2026扩张增长年，2027品牌提升年，目标年营收¥2000万+
`
        }
      } catch (e) {
        console.warn('获取数据失败，但不影响回答:', e)
      }
    }
    
    // 使用统一的AI辅助工具
    const enhancedPrompt = enhancePrompt(prompt, {
      persona: persona.systemPrompt,
      data: dataContext
    })

    const finalPrompt = conversationHistory.length > 0 
      ? prompt 
      : `${persona.systemPrompt}\n\n用户问题：${enhancedPrompt}${dataContext}`

    const text = await callGeminiAPI(finalPrompt, {
      usePro: useBackup,
      temperature: specificPersona === 'cfo' ? 0.7 : 0.9,
      maxOutputTokens: 2048,
      useCache: true,
      systemInstruction: persona.systemPrompt + '\n\n你可以访问全站实时数据来回答用户问题。如果用户询问数据相关的问题，请提供准确的数据分析和洞察。',
      conversationHistory: conversationHistory.length > 0 ? conversationHistory : []
    })
    
    if (text) {
      const parsedContent = marked.parse(text)
      
      messages.value.push({
        role: 'ai',
        content: parsedContent,
        rawText: text,
        persona: specificPersona || personaMode.value
      })
      
      if (useBackup) ElMessage.success('已自动切换到备选模型')
    } else {
      throw new Error('Invalid response format')
    }
  } catch (error) {
    console.error('AI请求失败:', error)
    const errorMsg = error.message || '未知错误'
    ElMessage.error(`AI请求失败: ${errorMsg}`)
    messages.value.push({
      role: 'ai',
      content: `抱歉，连接失败。<br><small style="color: #888;">错误: ${errorMsg}</small>`,
      rawText: `抱歉，连接失败。错误: ${errorMsg}`,
      persona: specificPersona || personaMode.value
    })
  } finally {
    isAiThinking.value = false
    await nextTick()
    scrollToBottom()
  }
}

// 智能博弈辩论系统
const startDebate = async () => {
  if (!debateTopic.value || debateTopic.value === 'custom' && !customDebateTopic.value) {
    ElMessage.warning('请选择或输入辩论主题')
    return
  }
  
  if (selectedDebatePersonas.value.length < 2) {
    ElMessage.warning('至少需要选择2个角色参与辩论')
    return
  }
  
  isDebating.value = true
  const topic = debateTopic.value === 'custom' ? customDebateTopic.value : debateTopic.value
  
  // 初始化辩论
  messages.value.push({
    role: 'user',
    content: `开始智能博弈辩论：${topic}`
  })
  
  // 让每个角色依次发表观点
  for (const personaKey of selectedDebatePersonas.value) {
    if (!isDebating.value) break // 允许中途停止
    
    const persona = personas[personaKey]
    const debatePrompt = `请针对主题"${topic}"发表你的观点和立场。作为${persona.name}，请从你的专业角度分析这个问题，提出你的观点、理由和建议。你可以：
1. 表达明确立场
2. 提供专业分析和数据支持
3. 提出可能的担忧或挑战
4. 与其他角色的观点形成对比（如果已有其他观点）

保持专业但可以有一定的辩论色彩，让讨论更有深度。`
    
    await sendAI(0, false, debatePrompt, personaKey)
    await new Promise(resolve => setTimeout(resolve, 1000)) // 间隔1秒
  }
  
  // 辩论总结
  if (isDebating.value) {
    const summaryPrompt = `请对以上关于"${topic}"的辩论进行总结，提炼各方的核心观点，找出共识和分歧，并给出综合建议。`
    await sendAI(0, false, summaryPrompt, 'cfo') // 用CFO做总结
  }
  
  isDebating.value = false
}

const stopDebate = () => {
  isDebating.value = false
  ElMessage.info('辩论已停止')
}

// 快捷指令（经营诊断报告使用当前日期，避免显示错误日期）
const quickAI = (type) => {
  const now = new Date()
  const reportDateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
  const prompts = {
    diagnosis: `生成一份全面的经营诊断报告，包括当前运营状况、主要问题、改进建议。报告标题为《山海造物标本艺术馆经营诊断报告》。报告元信息请务必使用：报告日期：${reportDateStr}；报告对象：山海造物管理层；报告撰写：AI战略顾问。`,
    copy: '为标本艺术馆"山海造物"写一段小红书种草文案，突出自然美学和手作体验。',
    risk: '评估当前业务模式的主要风险点，并提供应对策略。',
    marketing: '制定一份针对自然教育品牌的营销推广方案。',
    strategy: '基于当前业务数据，制定未来6-12个月的战略规划建议。',
    data: '分析当前业务数据，提供数据洞察和增长机会识别。',
    design: '针对标本产品设计，提供创新设计方案和建议。',
    visual: '针对品牌视觉设计，提供视觉传达方案和建议。',
    store: '针对门店营销，提供门店运营和营销方案。',
    online: '针对线上流量获取，制定流量增长策略。',
    private: '针对私域运营，制定私域增长和运营方案。'
  }
  
  if (prompts[type]) {
    const promptText = prompts[type]
    aiInput.value = promptText
    sendAI(0, false, promptText)
  }
}

const goToAICenter = () => {
  ElMessage.info('正在跳转到AI智能中心...')
  window.dispatchEvent(new CustomEvent('switch-tab', { detail: '12' }))
}

const handleToolCenterAction = () => {
  if (isEmbedded.value) {
    emit('close')
    return
  }
  goToAICenter()
}

const clearHistory = () => {
  messages.value = [{
    role: 'ai',
    content: '<strong>AI 战略顾问:</strong> 对话历史已清空。系统已重新就绪。',
    rawText: '对话历史已清空。系统已重新就绪。'
  }]
  ElMessage.success('对话历史已清空')
}

// 滚动到底部
const scrollToBottom = () => {
  if (chatBoxRef.value) {
    nextTick(() => {
      chatBoxRef.value.scrollTop = chatBoxRef.value.scrollHeight
    })
  }
}

// 处理Enter键
const handleEnterKey = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (aiInput.value.trim() && !isAiThinking.value && !isDebating.value) {
      sendAI()
    }
  }
}

// 测试API连接
const testConnection = async () => {
  try {
    debugLog('测试API连接...')
    await callGeminiAPI('请回复“ok”，用于测试战略智脑统一 AI 调用链路。', {
      useCache: false,
      maxOutputTokens: 16,
      temperature: 0.1,
    })
    debugLog('✓ API连接成功')
  } catch (error) {
    debugLog('⚠️ API连接测试异常:', error?.message || error)
  }
}

// 优化后的语音播报 - 使用更自然的人声
const playAudio = async (text, personaKey = null) => {
  try {
    if (isSpeaking.value && currentAudioText.value === text) {
      isSpeaking.value = false
      currentAudioText.value = ''
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
      return
    }

    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      ElMessage.warning('您的浏览器不支持语音合成功能')
      isSpeaking.value = false
      currentAudioText.value = ''
      isPlaying.value = false
      return
    }

    // 停止当前播报
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel()
    }

    isSpeaking.value = true
    currentAudioText.value = text
    isPlaying.value = true

    // 清理文本
    const cleanText = text
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/【.*?】/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    
    if (!cleanText || cleanText.length === 0) {
      isSpeaking.value = false
      currentAudioText.value = ''
      isPlaying.value = false
      return
    }
    
    // 等待语音列表加载（某些浏览器需要）
    let voices = window.speechSynthesis.getVoices()
    if (voices.length === 0) {
      await new Promise((resolve) => {
        const checkVoices = () => {
          voices = window.speechSynthesis.getVoices()
          if (voices.length > 0) {
            resolve()
          } else {
            setTimeout(checkVoices, 100)
          }
        }
        window.speechSynthesis.onvoiceschanged = () => {
          voices = window.speechSynthesis.getVoices()
          resolve()
        }
        setTimeout(() => {
          if (voices.length === 0) {
            checkVoices()
          } else {
            resolve()
          }
        }, 100)
      })
      voices = window.speechSynthesis.getVoices()
    }
    
    // 真实人声优先：神经/自然语音 > 高质量中文 > 女声 > 任意中文
    const nameLower = (v) => (v.name || '').toLowerCase()
    const zhVoices = voices.filter(v => v.lang && v.lang.includes('zh'))
    let selectedVoice = null

    const neuralOrNatural = zhVoices.filter(v => {
      const n = nameLower(v)
      return n.includes('neural') || n.includes('natural') || n.includes('online')
    })
    if (neuralOrNatural.length > 0) {
      selectedVoice = neuralOrNatural.find(v => nameLower(v).includes('yunxi')) ||
        neuralOrNatural.find(v => nameLower(v).includes('yunyang')) ||
        neuralOrNatural.find(v => nameLower(v).includes('xiaoxiao')) ||
        neuralOrNatural[0]
      console.log(`[语音] 选择神经/自然语音: ${selectedVoice.name}`)
    }
    if (!selectedVoice) {
      const preferredNames = [
        'Yunxi', 'Microsoft Yunxi', 'Yunyang', 'Microsoft Yunyang',
        'Xiaoxiao', 'Microsoft Xiaoxiao', 'Yaoyao', 'Microsoft Yaoyao',
        'Huihui', 'Microsoft Huihui', 'Xiaoyi', 'Microsoft Xiaoyi',
        'Google 普通话', 'Google 中文', 'Kangkang', 'Microsoft Kangkang'
      ]
      for (const preferred of preferredNames) {
        selectedVoice = zhVoices.find(v => nameLower(v).includes(preferred.toLowerCase()))
        if (selectedVoice) {
          console.log(`[语音] 选择语音: ${selectedVoice.name}`)
          break
        }
      }
    }
    if (!selectedVoice) {
      const femaleVoices = zhVoices.filter(v => {
        const n = nameLower(v)
        return n.includes('yaoyao') || n.includes('xiaoxiao') || n.includes('huihui') || n.includes('xiaoyi') || n.includes('xiaoyu')
      })
      if (femaleVoices.length > 0) {
        selectedVoice = femaleVoices[0]
        console.log(`[语音] 选择女声: ${selectedVoice.name}`)
      }
    }
    if (!selectedVoice) {
      selectedVoice = zhVoices.find(v => v.name && nameLower(v).includes('microsoft')) ||
        zhVoices.find(v => v.name && nameLower(v).includes('google')) ||
        zhVoices[0]
      if (selectedVoice) console.log(`[语音] 选择备用: ${selectedVoice.name}`)
    }

    const utterance = new SpeechSynthesisUtterance(cleanText)
    utterance.lang = 'zh-CN'
    // 真实人声向参数：略慢语速、中性音调
    utterance.rate = 0.86
    utterance.pitch = 1.0
    utterance.volume = 0.86
    
    if (selectedVoice) {
      utterance.voice = selectedVoice
      console.log(`[语音] 使用语音: ${selectedVoice.name}, rate: ${utterance.rate}, pitch: ${utterance.pitch}`)
    }
    
    // 事件处理
    utterance.onstart = () => {
      console.log('▶️ 语音播放开始')
      isSpeaking.value = true
      isPlaying.value = true
    }
    
    utterance.onend = () => {
      isSpeaking.value = false
      currentAudioText.value = ''
      isPlaying.value = false
    }
    
    utterance.onerror = (error) => {
      console.error('语音播报错误:', error)
      // 不显示错误给用户，静默处理
      isSpeaking.value = false
      currentAudioText.value = ''
      isPlaying.value = false
    }
    
    // 使用try-catch包装speak调用
    try {
      window.speechSynthesis.speak(utterance)
    } catch (speakError) {
      console.error('调用speak失败:', speakError)
      isSpeaking.value = false
      currentAudioText.value = ''
      isPlaying.value = false
    }
  } catch (error) {
    console.error('语音播报异常:', error)
    isSpeaking.value = false
    currentAudioText.value = ''
    isPlaying.value = false
  }
}

// 初始化语音系统并列出可用语音（按角色分类）
onMounted(() => {
  if (window.speechSynthesis) {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices()
      const chineseVoices = voices.filter(v => {
        const lang = v.lang.toLowerCase()
        return lang.includes('zh') || lang.includes('cn') || lang.includes('chinese')
      })
      
      debugLog('📢 可用中文语音列表:', chineseVoices.map(v => ({
        name: v.name,
        lang: v.lang,
        default: v.default,
        localService: v.localService
      })))
      
      // 显示每个角色的推荐语音和参数
      debugLog('🎭 各角色语音配置:')
      Object.entries(voiceSettings).forEach(([key, setting]) => {
        if (key !== 'default' && setting.preferredVoices) {
          const available = setting.preferredVoices.filter(pref => {
            return chineseVoices.some(v => {
              const vName = v.name.toLowerCase()
              const pName = pref.toLowerCase()
              return vName.includes(pName) || pName.includes(vName)
            })
          })
          if (available.length > 0) {
            debugLog(`  ${key}:`, {
              voices: available.join(', '),
              rate: setting.rate,
              pitch: setting.pitch,
              volume: setting.volume
            })
          }
        }
      })
    }
    
    // 立即加载一次
    loadVoices()
    
    // 监听语音列表变化（某些浏览器需要异步加载）
    window.speechSynthesis.onvoiceschanged = loadVoices
    
    // 延迟再次加载（确保所有语音都已加载）
    setTimeout(loadVoices, 1000)
  }
  
  // 测试API连接
  testConnection()
})
</script>

<style scoped>
/* 全局覆盖 Element Plus 组件的白色背景 */
.ai-strategic-brain :deep(.el-select-dropdown),
.ai-strategic-brain :deep(.el-popper),
.ai-strategic-brain :deep(.el-select-dropdown__item),
.ai-strategic-brain :deep(.el-scrollbar__view),
.ai-strategic-brain :deep(.el-overlay),
.ai-strategic-brain :deep(.el-select-dropdown__list),
.ai-strategic-brain :deep(.el-popper__arrow::before),
.ai-strategic-brain :deep(.el-popper__arrow),
.ai-strategic-brain :deep(.el-select-dropdown__wrap),
.ai-strategic-brain :deep(.el-scrollbar__bar),
.ai-strategic-brain :deep(.el-scrollbar__thumb),
.ai-strategic-brain :deep(.el-dialog),
.ai-strategic-brain :deep(.el-dialog__header),
.ai-strategic-brain :deep(.el-dialog__body),
.ai-strategic-brain :deep(.el-drawer),
.ai-strategic-brain :deep(.el-drawer__body),
.ai-strategic-brain :deep(.el-dropdown__menu),
.ai-strategic-brain :deep(.el-popover),
.ai-strategic-brain :deep(.el-tooltip__popper) {
  background: #000 !important;
  border: 1px solid rgba(212, 175, 55, 0.2) !important;
  background-color: #000 !important;
}

.ai-strategic-brain :deep(.el-select-dropdown__item:hover),
.ai-strategic-brain :deep(.el-dropdown-menu__item:hover) {
  background: rgba(212, 175, 55, 0.1) !important;
}

.ai-strategic-brain :deep(.el-select-dropdown__item.selected),
.ai-strategic-brain :deep(.el-dropdown-menu__item.is-selected) {
  background: rgba(212, 175, 55, 0.2) !important;
  color: #d4af37 !important;
}

.ai-strategic-brain :deep(.el-select-dropdown__item) {
  color: #fff !important;
  background: #000 !important;
}

.ai-strategic-brain :deep(.el-select-dropdown__item:hover) {
  background: rgba(212, 175, 55, 0.1) !important;
  color: #d4af37 !important;
}

.ai-strategic-brain :deep(.el-select-dropdown__item.is-selected) {
  background: rgba(212, 175, 55, 0.2) !important;
  color: #d4af37 !important;
}

.ai-strategic-brain :deep(.el-tag) {
  background: #000 !important;
  border-color: #333 !important;
  color: #fff !important;
}

.ai-strategic-brain :deep(.el-divider) {
  border-color: #333 !important;
}

.ai-strategic-brain :deep(.el-message) {
  background: #000 !important;
  border: 1px solid #333 !important;
  color: #fff !important;
}

.ai-strategic-brain :deep(.el-message__content) {
  color: #fff !important;
}

.ai-strategic-brain :deep(.el-input__suffix) {
  color: #999 !important;
  background: transparent !important;
}

.ai-strategic-brain :deep(.el-input__suffix:hover) {
  color: #d4af37 !important;
  background: transparent !important;
}

/* 全面覆盖所有可能的白色背景 */
.ai-strategic-brain :deep(.el-input__wrapper),
.ai-strategic-brain :deep(.el-textarea__inner),
.ai-strategic-brain :deep(.el-form-item__label),
.ai-strategic-brain :deep(.el-radio__label),
.ai-strategic-brain :deep(.el-checkbox__label) {
  background: #000 !important;
  background-color: #000 !important;
  color: #fff !important;
  border-color: #333 !important;
}

.ai-strategic-brain :deep(.el-input__inner),
.ai-strategic-brain :deep(.el-textarea__inner) {
  background: #000 !important;
  background-color: #000 !important;
  color: #fff !important;
  border-color: #333 !important;
}

/* 覆盖所有可能的白色边框 - 确保全局黑色主题 */
.ai-strategic-brain :deep(.el-input__wrapper),
.ai-strategic-brain :deep(.el-textarea__wrapper) {
  border-color: rgba(212, 175, 55, 0.2) !important;
}

.ai-strategic-brain :deep(.el-input__wrapper.is-focus),
.ai-strategic-brain :deep(.el-textarea__wrapper.is-focus) {
  border-color: rgba(212, 175, 55, 0.5) !important;
  box-shadow: 0 0 0 2px rgba(212, 175, 55, 0.1) !important;
}

.ai-strategic-brain :deep(.el-button--primary) {
  background: linear-gradient(135deg, #d4af37 0%, #f4d882 100%) !important;
  border-color: #d4af37 !important;
  color: #000 !important;
}

.ai-strategic-brain :deep(.el-button--primary:hover:not(:disabled)) {
  background: linear-gradient(135deg, #e8c856 0%, #f5de9e 100%) !important;
  border-color: #e8c856 !important;
}

.ai-strategic-brain :deep(.el-button) {
  background: #000 !important;
  background-color: #000 !important;
  border-color: #333 !important;
  color: #fff !important;
}

.ai-strategic-brain :deep(.el-button:hover:not(:disabled)) {
  background: #222 !important;
  background-color: #222 !important;
  border-color: #d4af37 !important;
  color: #d4af37 !important;
}

.ai-strategic-brain {
  width: 100%;
  height: 100vh;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #0a0a0a 100%);
  color: #a3a3a3;
  font-size: 13px;
  position: relative;
  overflow: hidden;
}

/* 添加动态背景光效 */
.ai-strategic-brain::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, rgba(212, 175, 55, 0.03) 0%, transparent 70%);
  animation: backgroundPulse 20s ease-in-out infinite;
  pointer-events: none;
  z-index: 0;
}

@keyframes backgroundPulse {
  0%, 100% {
    transform: translate(0, 0) scale(1);
    opacity: 0.3;
  }
  50% {
    transform: translate(10%, 10%) scale(1.1);
    opacity: 0.5;
  }
}

.ai-strategic-brain > * {
  position: relative;
  z-index: 1;
}

.ai-header {
  padding: 20px 24px;
  border-bottom: 1px solid rgba(212, 175, 55, 0.2);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.8) 0%, rgba(20, 20, 20, 0.9) 100%);
  backdrop-filter: blur(20px) saturate(180%);
  flex-shrink: 0;
  gap: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
  min-width: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.title {
  font-size: 24px;
  font-weight: 700;
  background: linear-gradient(135deg, #d4af37 0%, #f4d882 50%, #d4af37 100%);
  background-size: 200% 200%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0;
  white-space: nowrap;
  animation: titleShimmer 3s ease-in-out infinite;
  text-shadow: 0 0 30px rgba(212, 175, 55, 0.3);
  letter-spacing: 1px;
}

@keyframes titleShimmer {
  0%, 100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}

.mode-switcher {
  display: flex;
  gap: 6px;
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.6) 0%, rgba(20, 20, 20, 0.8) 100%);
  padding: 4px;
  border-radius: 8px;
  border: 1px solid rgba(212, 175, 55, 0.2);
  backdrop-filter: blur(10px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.mode-btn {
  padding: 6px 12px;
  background: transparent;
  border: none;
  color: #666;
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.3s;
  white-space: nowrap;
}

.mode-btn:hover:not(.active) {
  color: #aaa;
  background: rgba(255, 255, 255, 0.05);
}

.mode-btn.active {
  background: linear-gradient(135deg, rgba(212, 175, 55, 0.2) 0%, rgba(212, 175, 55, 0.1) 100%);
  color: #d4af37;
  font-weight: 600;
  border: 1px solid rgba(212, 175, 55, 0.5);
  box-shadow: 
    0 2px 8px rgba(212, 175, 55, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.persona-toggle-btn,
.clear-btn {
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid #333;
  color: #888;
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.3s;
  white-space: nowrap;
}

.persona-toggle-btn:hover,
.clear-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border-color: #555;
}

.persona-toggle-btn.active {
  background: #222;
  color: #d4af37;
}

.speaking-indicator {
  font-size: 12px;
  color: #d4af37;
  animation: pulse 1s infinite;
  white-space: nowrap;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.ai-container {
  flex: 1;
  display: flex;
  gap: 16px;
  padding: 16px;
  overflow: hidden;
  min-height: 0;
  width: 100%;
  position: relative;
}

/* 角色面板 */
.persona-panel {
  width: 280px;
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.9) 0%, rgba(20, 20, 20, 0.95) 100%);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  flex-shrink: 0;
  backdrop-filter: blur(10px) saturate(150%);
  box-shadow: 
    0 4px 20px rgba(0, 0, 0, 0.5),
    0 0 30px rgba(212, 175, 55, 0.1);
}

.persona-panel.panel-hidden {
  width: 0;
  padding: 0;
  border: none;
  overflow: hidden;
}

.panel-header {
  padding: 16px;
  border-bottom: 1px solid #262626;
}

.panel-header h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: #fff;
  font-weight: 600;
}

.persona-search :deep(.el-input__wrapper) {
  background: #000 !important;
  border: 1px solid #333 !important;
  box-shadow: none !important;
}

.persona-search :deep(.el-input__inner) {
  color: #fff !important;
  background: transparent !important;
}

.persona-search :deep(.el-input__wrapper.is-focus) {
  border-color: #d4af37 !important;
  box-shadow: 0 0 0 2px rgba(212, 175, 55, 0.1) !important;
}

.persona-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.persona-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  margin-bottom: 10px;
  border: 1px solid transparent;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.02) 0%, rgba(255, 255, 255, 0.01) 100%);
  position: relative;
  overflow: hidden;
}

.persona-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.1), transparent);
  transition: left 0.5s ease;
}

.persona-card:hover::before {
  left: 100%;
}

.persona-card:hover {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.04) 100%);
  border-color: rgba(212, 175, 55, 0.3);
  transform: translateX(4px);
  box-shadow: 0 4px 12px rgba(212, 175, 55, 0.15);
}

.persona-card.active {
  background: linear-gradient(135deg, rgba(212, 175, 55, 0.2) 0%, rgba(212, 175, 55, 0.1) 100%);
  border-color: #d4af37;
  box-shadow: 
    0 4px 16px rgba(212, 175, 55, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  transform: translateX(0);
}

.persona-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.persona-info {
  flex: 1;
  min-width: 0;
}

.persona-name {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  margin-bottom: 4px;
}

.persona-desc {
  font-size: 11px;
  color: #666;
}

.persona-check {
  color: #d4af37;
  font-weight: bold;
  flex-shrink: 0;
}

/* 聊天区域 */
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.95) 0%, rgba(10, 10, 10, 0.98) 100%);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 12px;
  overflow: hidden;
  min-width: 0;
  backdrop-filter: blur(10px) saturate(150%);
  box-shadow: 
    0 4px 20px rgba(0, 0, 0, 0.5),
    0 0 30px rgba(212, 175, 55, 0.1);
}

.chat-header {
  padding: 12px 16px;
  border-bottom: 1px solid #262626;
  background: #000;
}

.debate-controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.debate-controls :deep(.el-button),
.debate-controls :deep(.el-select),
.debate-controls :deep(.el-input) {
  font-size: 12px;
}

.debate-controls :deep(.el-input__wrapper) {
  background: #000 !important;
  border: 1px solid #333 !important;
  box-shadow: none !important;
}

.debate-controls :deep(.el-input__inner) {
  color: #fff !important;
  background: transparent !important;
}

.debate-controls :deep(.el-select .el-input__wrapper) {
  background: #000 !important;
  border: 1px solid #333 !important;
}

.debate-controls :deep(.el-select .el-input__inner) {
  color: #fff !important;
}

.debate-controls :deep(.el-select:hover .el-input__wrapper) {
  border-color: #555 !important;
}

.debate-controls :deep(.el-select.is-focused .el-input__wrapper) {
  border-color: #d4af37 !important;
}

.debate-controls :deep(.el-button) {
  background: #000 !important;
  border-color: #333 !important;
  color: #fff !important;
}

.debate-controls :deep(.el-button:hover:not(:disabled)) {
  background: #222 !important;
  border-color: #d4af37 !important;
  color: #d4af37 !important;
}

.chat-box {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.95) 0%, rgba(10, 10, 10, 0.98) 100%);
  position: relative;
}

/* 聊天框滚动条美化 */
.chat-box::-webkit-scrollbar {
  width: 8px;
}

.chat-box::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
}

.chat-box::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(212, 175, 55, 0.4) 0%, rgba(212, 175, 55, 0.6) 100%);
  border-radius: 4px;
  transition: background 0.3s;
}

.chat-box::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(212, 175, 55, 0.6) 0%, rgba(244, 216, 130, 0.8) 100%);
}

.chat-item {
  display: flex;
  flex-direction: column;
  margin-bottom: 20px;
}

.msg-header {
  margin-bottom: 8px;
}

.persona-badge {
  display: inline-block;
  padding: 4px 10px;
  background: var(--persona-color, #d4af37);
  color: #000;
  font-size: 11px;
  font-weight: 600;
  border-radius: 12px;
}

.chat-item.ai-msg {
  align-items: flex-start;
}

.chat-item.user-msg {
  align-items: flex-end;
}

.chat-bubble {
  max-width: 75%;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  position: relative;
  word-wrap: break-word;
}

.bubble-ai {
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.8) 0%, rgba(20, 20, 20, 0.9) 100%);
  border: 1px solid rgba(212, 175, 55, 0.3);
  color: #f4d882;
  border-left: 3px solid #d4af37;
  box-shadow: 
    0 4px 16px rgba(0, 0, 0, 0.4),
    0 0 20px rgba(212, 175, 55, 0.1);
  backdrop-filter: blur(10px);
  position: relative;
}

.bubble-ai::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 3px;
  height: 100%;
  background: linear-gradient(180deg, #d4af37 0%, #f4d882 100%);
  opacity: 0.8;
}

.bubble-ai :deep(strong) {
  color: #fff;
}

.bubble-ai :deep(ul),
.bubble-ai :deep(ol) {
  list-style-type: disc;
  padding-left: 1.5em;
  margin: 8px 0;
}

.bubble-ai :deep(p) {
  margin: 8px 0;
}

.bubble-ai.thinking {
  color: #d4af37;
}

.thinking-dots {
  display: inline-block;
  margin-left: 4px;
}

.thinking-dots span {
  animation: blink 1.4s infinite;
}

.thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
.thinking-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes blink {
  0%, 80%, 100% { opacity: 0; }
  40% { opacity: 1; }
}

.bubble-user {
  background: #222;
  color: #fff;
  text-align: right;
  border-radius: 8px 8px 0 8px;
}

.voice-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 10px;
  color: #555;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid #333;
  padding: 4px 8px;
  border-radius: 4px;
  background: transparent;
}

.voice-btn:hover {
  color: #d4af37;
  border-color: #d4af37;
}

.voice-btn.voice-active {
  color: #d4af37;
  border-color: #d4af37;
  animation: pulse 1s infinite;
}

.voice-icon {
  width: 12px;
  height: 12px;
}

.input-area {
  padding: 16px;
  border-top: 1px solid #262626;
  background: #000;
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

.ai-input {
  flex: 1;
}

.ai-input :deep(.el-input__wrapper) {
  background: #000 !important;
  border: 1px solid #333 !important;
  box-shadow: none !important;
}

.ai-input :deep(.el-input__wrapper:hover) {
  border-color: #555 !important;
}

.ai-input :deep(.el-input__inner) {
  color: #d4af37 !important;
  font-family: 'JetBrains Mono', monospace;
  background: transparent !important;
}

.ai-input :deep(.el-input__wrapper.is-focus) {
  border-color: #d4af37 !important;
  box-shadow: 0 0 0 2px rgba(212, 175, 55, 0.1) !important;
}

.send-btn {
  background: linear-gradient(135deg, #d4af37 0%, #f4d882 100%);
  border-color: #d4af37;
  color: #000;
  font-weight: 600;
  flex-shrink: 0;
  box-shadow: 
    0 4px 12px rgba(212, 175, 55, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.send-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #e8c856 0%, #f5de9e 100%);
  border-color: #e8c856;
  transform: translateY(-2px);
  box-shadow: 
    0 6px 20px rgba(212, 175, 55, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.send-btn:active:not(:disabled) {
  transform: translateY(0);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 快捷指令 */
.quick-actions {
  width: 220px;
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.9) 0%, rgba(20, 20, 20, 0.95) 100%);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
  overflow-y: auto;
  backdrop-filter: blur(10px) saturate(150%);
  box-shadow: 
    0 4px 20px rgba(0, 0, 0, 0.5),
    0 0 30px rgba(212, 175, 55, 0.1);
}

.quick-title {
  font-size: 10px;
  font-weight: 700;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
}

.quick-btn {
  width: 100%;
  justify-content: flex-start;
  color: #ddd;
  padding: 12px 14px;
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%);
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  text-align: left;
  font-size: 12px;
  position: relative;
  overflow: hidden;
}

.quick-btn::before {
  content: '';
  position: absolute;
  top: 50%;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.15), transparent);
  transform: translateY(-50%);
  transition: left 0.4s ease;
}

.quick-btn:hover:not(:disabled)::before {
  left: 100%;
}

.quick-btn:hover:not(:disabled) {
  color: #f4d882;
  border-color: #d4af37;
  background: linear-gradient(135deg, rgba(212, 175, 55, 0.15) 0%, rgba(212, 175, 55, 0.08) 100%);
  transform: translateX(4px);
  box-shadow: 0 4px 12px rgba(212, 175, 55, 0.2);
}

.quick-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 滚动条 */
.chat-box::-webkit-scrollbar,
.quick-actions::-webkit-scrollbar,
.persona-list::-webkit-scrollbar {
  width: 5px;
}

.chat-box::-webkit-scrollbar-track,
.quick-actions::-webkit-scrollbar-track,
.persona-list::-webkit-scrollbar-track {
  background: #000;
}

.chat-box::-webkit-scrollbar-thumb,
.quick-actions::-webkit-scrollbar-thumb,
.persona-list::-webkit-scrollbar-thumb {
  background: #333;
  border-radius: 3px;
}

.chat-box::-webkit-scrollbar-thumb:hover,
.quick-actions::-webkit-scrollbar-thumb:hover,
.persona-list::-webkit-scrollbar-thumb:hover {
  background: #d4af37;
}

/* 周报生成区域样式 */
.weekly-report-section {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #333;
}

.section-title {
  font-size: 11px;
  font-weight: 700;
  color: #d4af37;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.report-btn {
  width: 100%;
  justify-content: flex-start;
  color: #ddd;
  padding: 10px;
  border: 1px solid #333;
  border-radius: 4px;
  background: #000;
  transition: all 0.3s;
  text-align: left;
  font-size: 12px;
  margin-bottom: 6px;
}

.report-btn:hover:not(:disabled) {
  color: #d4af37;
  border-color: #d4af37;
  background: rgba(212, 175, 55, 0.1);
}

.report-btn-full {
  background: rgba(212, 175, 55, 0.15);
  border-color: #d4af37;
  color: #d4af37;
  font-weight: 600;
}

.report-btn-full:hover:not(:disabled) {
  background: rgba(212, 175, 55, 0.25);
  border-color: #e8c856;
  color: #e8c856;
}

.report-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 响应式 */
@media (max-width: 1400px) {
  .persona-panel {
    width: 240px;
  }
  
  .quick-actions {
    width: 180px;
  }
}

@media (max-width: 1200px) {
  .showPersonaPanel .persona-panel {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 100;
    width: 280px;
  }
}
</style>