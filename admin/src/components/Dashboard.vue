<template>
  <div class="dashboard-container">
    <div class="header-section">
      <div class="welcome-text">
        <h2>指挥中心 / DASHBOARD</h2>
        <p class="subtitle">
          <span :class="businessStatus.color">● {{ businessStatus.text }}</span> 
          <span style="margin-left:10px; color:#999; font-size:12px;">(数据来源: 财务账本 + 实时订单)</span>
        </p>
      </div>
      <div class="header-right">
        <!-- 智能陪伴机器人 -->
        <CompanionRobot 
          :dashboard-stats="stats" 
          @ai-action="handleAIAction"
          @navigate="handleNavigate"
        />
        <div class="time-badge">
          <el-icon><Clock /></el-icon> {{ currentTime }}
          <el-button link type="primary" size="small" @click="refreshAll" :loading="loading" style="margin-left:10px;">刷新看板</el-button>
        </div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card black">
        <div class="kpi-top">
          <span class="label">今日营收 (元)</span>
          <el-tag type="success" size="small" effect="dark">+{{ stats.todayOrderCount }} 单</el-tag>
        </div>
        <div class="kpi-value">¥{{ stats.todaySales.toLocaleString() }}</div>
        <div class="kpi-sub">
          昨日: ¥{{ stats.yesterdaySales.toLocaleString() }}
          <span v-if="stats.isManualData" style="color:var(--gold-500); margin-left:5px;">(已入账)</span>
        </div>
      </div>

      <div class="kpi-card gold">
        <div class="kpi-top">
          <span class="label">本月总营收</span>
          <el-icon><Trophy /></el-icon>
        </div>
        <div class="kpi-value">¥{{ stats.monthSales.toLocaleString() }}</div>
        <div class="kpi-sub">净利润(估): ¥{{ stats.monthProfit.toLocaleString() }}</div>
      </div>

      <div class="kpi-card white">
        <div class="kpi-top">
          <span class="label">本月总订单数</span>
          <el-tag type="success" size="small" effect="light" v-if="stats.totalMonthOrders > 0">
            财务账本
          </el-tag>
        </div>
        <div class="kpi-value">{{ stats.totalMonthOrders > 0 ? stats.totalMonthOrders.toLocaleString() : '-' }}</div>
        <div class="kpi-sub">
          <span v-if="stats.totalMonthOrders > 0 && stats.monthSales > 0">
            订单均价: ¥{{ Math.round(stats.monthSales / stats.totalMonthOrders).toLocaleString() }}
          </span>
          <span v-else>数据来源: 财务账本</span>
        </div>
      </div>

      <div class="kpi-card white">
        <div class="kpi-top">
          <span class="label">会员总数</span>
          <el-tag type="warning" size="small" effect="light">+{{ stats.newUsers }} 新</el-tag>
        </div>
        <div class="kpi-value">{{ stats.totalUsers }}</div>
        <div class="kpi-sub">库存预警: <span class="text-red">{{ stats.lowStock }}</span></div>
      </div>

      <div class="kpi-card white">
        <div class="kpi-top">
          <span class="label">待处理事项</span>
          <el-icon color="#f56c6c"><Bell /></el-icon>
        </div>
        <div class="kpi-value" :class="{ 'text-red': stats.totalTodos > 0 }">{{ stats.totalTodos }}</div>
        <div class="kpi-sub">发货 · 售后 · 补货</div>
      </div>
    </div>

    <el-row :gutter="20" class="middle-section">
      <el-col :xs="24" :sm="24" :md="16" :lg="16" class="middle-left">
        <el-card shadow="never" class="chart-card">
          <template #header>
            <div class="card-header">
              <span>📈 营收趋势 (近7日)</span>
              <el-radio-group v-model="chartRange" size="small" fill="#2D6A4F">
                <el-radio-button label="7">资金视图</el-radio-button>
              </el-radio-group>
            </div>
          </template>
          <div class="chart-box" @click="handleChartClick" style="position: relative;">
            <div v-if="chartEmpty && !loading" class="chart-empty">
              <div class="chart-empty-title">近 7 日账本暂无营收</div>
              <div class="chart-empty-desc">请到财务模块录入日账，或确认今日订单已同步入账。下方仍会渲染零轴趋势供对照。</div>
            </div>
            <canvas ref="chartCanvas" :class="{ 'chart-dimmed': chartEmpty && !loading }"></canvas>
            <transition name="fade">
              <div v-if="showRobotMessage" class="chart-blessing">
                {{ robotMessage }}
              </div>
            </transition>
          </div>
        </el-card>

        <!-- C 端小程序脉搏：置于营收趋势下方，填满左栏空白 -->
        <div class="miniapp-pulse compact">
          <div class="mp-header">
            <h3>📱 C 端小程序脉搏 <span class="mp-sub">MINI-PROGRAM PULSE</span></h3>
            <el-button link type="primary" @click="$emit('switch-tab', '44')">
              行为看板 <el-icon><ArrowUp style="transform: rotate(45deg)" /></el-icon>
            </el-button>
          </div>
          <div class="mp-grid">
            <div class="mp-card" @click="$emit('switch-tab', '44')">
              <div class="mp-ico" style="background: #00BCD420; color: #00BCD4;">🔍</div>
              <div class="mp-info">
                <div class="mp-lbl">AI 鉴定（今日）</div>
                <div class="mp-val">{{ miniapp.identifyToday }}</div>
                <div class="mp-trend">成功率 {{ miniapp.identifySuccessRate }}%</div>
              </div>
            </div>
            <div class="mp-card" @click="$emit('switch-tab', '38')">
              <div class="mp-ico" style="background: #d4af3720; color: #d4af37;">🎨</div>
              <div class="mp-info">
                <div class="mp-lbl">定制询单（今日）</div>
                <div class="mp-val">{{ miniapp.customSubmitsToday }}</div>
                <div class="mp-trend">伴宠 {{ miniapp.petSubmitsToday }}</div>
              </div>
            </div>
            <div class="mp-card" @click="$emit('switch-tab', '40')">
              <div class="mp-ico" style="background: #FF572220; color: #FF5722;">💬</div>
              <div class="mp-info">
                <div class="mp-lbl">客服工单（今日）</div>
                <div class="mp-val">{{ miniapp.supportToday }}</div>
                <div class="mp-trend">主动求助</div>
              </div>
            </div>
            <div class="mp-card" @click="$emit('switch-tab', '37')">
              <div class="mp-ico" style="background: #67C23A20; color: #67C23A;">🏪</div>
              <div class="mp-info">
                <div class="mp-lbl">到店签到（今日）</div>
                <div class="mp-val">{{ miniapp.storeCheckinToday }}</div>
                <div class="mp-trend">线下转化</div>
              </div>
            </div>
            <div class="mp-card" @click="$emit('switch-tab', '44')">
              <div class="mp-ico" style="background: #E6A23C20; color: #E6A23C;">📈</div>
              <div class="mp-info">
                <div class="mp-lbl">总事件（今日）</div>
                <div class="mp-val">{{ miniapp.eventsToday }}</div>
                <div class="mp-trend">埋点上报</div>
              </div>
            </div>
            <div class="mp-card" @click="$emit('switch-tab', '44')">
              <div class="mp-ico" style="background: #9C27B020; color: #9C27B0;">👥</div>
              <div class="mp-info">
                <div class="mp-lbl">活跃 UV</div>
                <div class="mp-val">{{ miniapp.uvToday }}</div>
                <div class="mp-trend">独立 openid</div>
              </div>
            </div>
          </div>
        </div>
      </el-col>

      <el-col :xs="24" :sm="24" :md="8" :lg="8" class="middle-right">
        <el-card shadow="never" class="todo-card">
          <template #header>
            <div class="card-header">
              <span>📋 待办清单</span>
              <el-button 
                text 
                size="small" 
                type="primary" 
                @click="showInsightsDialog = true"
                title="数据洞察分析"
              >
                <el-icon><DataAnalysis /></el-icon>
                数据洞察
              </el-button>
            </div>
          </template>
          <div class="todo-list">
            <div class="todo-item" @click="$emit('switch-tab', '3')" :class="{active: stats.pendingOrders > 0}">
              <div class="todo-icon bg-blue"><el-icon><Box /></el-icon></div>
              <div class="todo-content"><div class="t-title">待发货订单</div><div class="t-desc">客户等待中</div></div>
              <div class="todo-num">{{ stats.pendingOrders }}</div>
            </div>
            <div class="todo-item" @click="$emit('switch-tab', '37')" :class="{active: stats.pendingBookings > 0}">
              <div class="todo-icon bg-blue"><el-icon><Calendar /></el-icon></div>
              <div class="todo-content"><div class="t-title">待核销预约</div><div class="t-desc">门票 / 课程 / 参观</div></div>
              <div class="todo-num">{{ stats.pendingBookings }}</div>
            </div>
            <div class="todo-item" @click="$emit('switch-tab', '38')" :class="{active: stats.pendingCustom > 0}">
              <div class="todo-icon bg-orange"><el-icon><EditPen /></el-icon></div>
              <div class="todo-content"><div class="t-title">定制询单</div><div class="t-desc">待报价 / 接单</div></div>
              <div class="todo-num">{{ stats.pendingCustom }}</div>
            </div>
            <div class="todo-item" @click="$emit('switch-tab', '39')" :class="{active: stats.pendingPet > 0}">
              <div class="todo-icon bg-orange"><el-icon><User /></el-icon></div>
              <div class="todo-content"><div class="t-title">伴宠订单</div><div class="t-desc">宠物纪念审核</div></div>
              <div class="todo-num">{{ stats.pendingPet }}</div>
            </div>
            <div class="todo-item" @click="$emit('switch-tab', '40')" :class="{active: stats.pendingTickets > 0}">
              <div class="todo-icon bg-red"><el-icon><Service /></el-icon></div>
              <div class="todo-content"><div class="t-title">山海有信</div><div class="t-desc">待回复工单</div></div>
              <div class="todo-num">{{ stats.pendingTickets }}</div>
            </div>
            <div class="todo-item" @click="$emit('switch-tab', '41')" :class="{active: stats.pendingComments > 0}">
              <div class="todo-icon bg-red"><el-icon><Service /></el-icon></div>
              <div class="todo-content"><div class="t-title">评论审核</div><div class="t-desc">UGC 待审</div></div>
              <div class="todo-num">{{ stats.pendingComments }}</div>
            </div>
            <div class="todo-item" @click="$emit('switch-tab', '42')" :class="{active: stats.refunding > 0}">
              <div class="todo-icon bg-red"><el-icon><Service /></el-icon></div>
              <div class="todo-content"><div class="t-title">售后/退款</div><div class="t-desc">需审核处理</div></div>
              <div class="todo-num">{{ stats.refunding }}</div>
            </div>
            <div class="todo-item" @click="openPromoArchive('seckill')" :class="{active: stats.seckillActive > 0 || stats.seckillExpired > 0}">
              <div class="todo-icon bg-red"><el-icon><Timer /></el-icon></div>
              <div class="todo-content">
                <div class="t-title">秒杀商品</div>
                <div class="t-desc">
                  进行中 {{ stats.seckillActive }}
                  <template v-if="stats.seckillExpired"> · 已过期 {{ stats.seckillExpired }}</template>
                </div>
              </div>
              <div class="todo-num" :class="{ 'todo-num-warn': stats.seckillExpired > 0 }">
                {{ stats.seckillActive }}
              </div>
            </div>
            <div class="todo-item" @click="openPromoArchive('group')" :class="{active: stats.groupProducts > 0}">
              <div class="todo-icon bg-orange"><el-icon><UserFilled /></el-icon></div>
              <div class="todo-content">
                <div class="t-title">拼团商品</div>
                <div class="t-desc">已启用拼团的 SKU</div>
              </div>
              <div class="todo-num">{{ stats.groupProducts }}</div>
            </div>
            <div
              v-if="stats.seckillExpired > 0"
              class="todo-item active"
              @click="openPromoArchive('seckill_expired')"
            >
              <div class="todo-icon bg-orange"><el-icon><Warning /></el-icon></div>
              <div class="todo-content">
                <div class="t-title">秒杀已过期</div>
                <div class="t-desc">仍开启但 endTime 已过，建议关闭</div>
              </div>
              <div class="todo-num todo-num-warn">{{ stats.seckillExpired }}</div>
            </div>
            <div class="todo-item" @click="$emit('switch-tab', '1')" :class="{active: stats.lowStock > 0}">
              <div class="todo-icon bg-orange"><el-icon><Warning /></el-icon></div>
              <div class="todo-content"><div class="t-title">库存预警</div><div class="t-desc">库存不足3件</div></div>
              <div class="todo-num">{{ stats.lowStock }}</div>
            </div>
          </div>
          
          <!-- 数据洞察卡片 -->
          <div class="insights-preview">
            <div class="insight-item" v-if="insights.trend">
              <el-icon class="insight-icon"><DataAnalysis /></el-icon>
              <div class="insight-content">
                <div class="insight-title">{{ insights.trend.title }}</div>
                <div class="insight-desc">{{ insights.trend.desc }}</div>
              </div>
            </div>
            <div class="insight-item" v-if="insights.alert">
              <el-icon class="insight-icon warning"><WarningFilled /></el-icon>
              <div class="insight-content">
                <div class="insight-title">{{ insights.alert.title }}</div>
                <div class="insight-desc">{{ insights.alert.desc }}</div>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 数据洞察分析弹窗 -->
    <el-dialog
      v-model="showInsightsDialog"
      title="🔍 数据洞察分析"
      width="900px"
      :close-on-click-modal="false"
      class="insights-dialog"
    >
      <div class="insights-container">
        <!-- 趋势分析 -->
        <div class="insight-section">
          <h3 class="section-title">
            <el-icon><DataBoard /></el-icon>
            趋势分析
          </h3>
          <div class="trend-analysis">
            <div class="trend-item" v-for="trend in trendAnalysis" :key="trend.metric">
              <div class="trend-label">{{ trend.label }}</div>
              <div class="trend-value" :class="trend.type">
                <el-icon v-if="trend.type === 'up'"><ArrowUp /></el-icon>
                <el-icon v-else-if="trend.type === 'down'"><ArrowDown /></el-icon>
                <span>{{ trend.value }}</span>
                <span class="trend-desc">{{ trend.desc }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 异常检测 -->
        <div class="insight-section" v-if="anomalies.length > 0">
          <h3 class="section-title">
            <el-icon><WarningFilled /></el-icon>
            异常检测
          </h3>
          <div class="anomalies-list">
            <div 
              v-for="(anomaly, index) in anomalies" 
              :key="index"
              class="anomaly-item"
              :class="anomaly.level"
            >
              <div class="anomaly-icon">
                <el-icon v-if="anomaly.level === 'high'"><WarningFilled /></el-icon>
                <el-icon v-else><InfoFilled /></el-icon>
              </div>
              <div class="anomaly-content">
                <div class="anomaly-title">{{ anomaly.title }}</div>
                <div class="anomaly-desc">{{ anomaly.desc }}</div>
                <div class="anomaly-action" v-if="anomaly.action">
                  <el-button size="small" type="primary" @click="handleAnomalyAction(anomaly)">
                    {{ anomaly.action }}
                  </el-button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 预测分析 -->
        <div class="insight-section">
          <h3 class="section-title">
            <el-icon><DataAnalysis /></el-icon>
            预测分析
          </h3>
          <div class="forecast-grid">
            <div class="forecast-card" v-for="forecast in forecasts" :key="forecast.metric">
              <div class="forecast-label">{{ forecast.label }}</div>
              <div class="forecast-value">{{ forecast.value }}</div>
              <div class="forecast-desc">{{ forecast.desc }}</div>
              <div class="forecast-confidence">
                <span>置信度: {{ forecast.confidence }}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 业务建议 -->
        <div class="insight-section" v-if="suggestions.length > 0">
          <h3 class="section-title">
            <el-icon><Star /></el-icon>
            AI 业务建议
          </h3>
          <div class="suggestions-list">
            <div 
              v-for="(suggestion, index) in suggestions" 
              :key="index"
              class="suggestion-item"
            >
              <div class="suggestion-icon">{{ suggestion.icon }}</div>
              <div class="suggestion-content">
                <div class="suggestion-title">{{ suggestion.title }}</div>
                <div class="suggestion-desc">{{ suggestion.desc }}</div>
                <div class="suggestion-impact">
                  <span>预期影响: {{ suggestion.impact }}</span>
                </div>
              </div>
              <div class="suggestion-action">
                <el-button size="small" @click="handleSuggestion(suggestion)">
                  查看详情
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="showInsightsDialog = false">关闭</el-button>
        <el-button type="primary" @click="exportInsights">导出报告</el-button>
        <el-button type="primary" @click="refreshInsights" :loading="insightsLoading">
          <el-icon><Refresh /></el-icon>
          刷新分析
        </el-button>
      </template>
    </el-dialog>

    <div class="quick-actions">
      <h3>⚡️ 快捷功能</h3>
      <div class="action-grid">
        <el-button size="large" icon="Plus" @click="$emit('switch-tab', '1')">发布新品</el-button>
        <el-button size="large" icon="EditPen" @click="$emit('switch-tab', '2')">记一笔账</el-button>
        <el-button size="large" icon="Ticket" @click="$emit('switch-tab', '6')">发优惠券</el-button>
        <el-button size="large" icon="User" @click="$emit('switch-tab', '4')">会员查询</el-button>
        <el-button size="large" icon="DataAnalysis" @click="$emit('switch-tab', '44')">C 端行为</el-button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { reactive, ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import { Clock, Trophy, Bell, Box, Service, Warning, EditPen, Plus, Ticket, User, DataAnalysis, DataBoard, WarningFilled, InfoFilled, ArrowUp, ArrowDown, Star, Refresh, Calendar, Timer, UserFilled } from '@element-plus/icons-vue'
import { cdnCount, fetchCollectionLimit, fetchCollectionWhere, getCdnDatabase } from '../cloud'
import Chart from 'chart.js/auto'
import CompanionRobot from './CompanionRobot.vue'
import { ElMessage } from 'element-plus'

const emit = defineEmits(['switch-tab'])

const loading = ref(false)
const currentTime = ref(new Date().toLocaleTimeString())
const chartEmpty = ref(false)
const chartRange = ref('7')
const chartCanvas = ref(null) // 🟢 使用 ref 引用 canvas
let chartInstance = null

// 机器人祝福消息
const robotMessage = ref('')
const showRobotMessage = ref(false)

// 数据洞察相关
const showInsightsDialog = ref(false)
const insightsLoading = ref(false)
const insights = reactive({
  trend: null,
  alert: null
})

const trendAnalysis = ref([])
const anomalies = ref([])
const forecasts = ref([])
const suggestions = ref([])

// 祝福文案库
const blessings = [
  '💰 恭喜发财，财源广进！',
  '🎉 生意兴隆，日进斗金！',
  '🌟 财源滚滚，大吉大利！',
  '💎 招财进宝，富贵吉祥！',
  '🎊 财源广进，生意红火！',
  '✨ 财源茂盛，蒸蒸日上！',
  '🏆 财源亨通，步步高升！',
  '💵 财源广进，日进斗金！',
  '🎁 财源滚滚，好运连连！',
  '💫 财源茂盛，生意兴隆！',
  '🔥 财源广进，大展宏图！',
  '⭐ 财源滚滚，前程似锦！',
  '💖 财源广进，心想事成！',
  '🎈 财源茂盛，万事如意！',
  '🌈 财源广进，福星高照！',
  '🚀 财源滚滚，事业腾飞！',
  '💐 财源广进，花开富贵！',
  '🎯 财源茂盛，目标达成！',
  '💪 财源广进，勇往直前！',
  '🎨 财源滚滚，创意无限！'
]

const getRandomBlessing = () => {
  return blessings[Math.floor(Math.random() * blessings.length)]
}

const handleChartClick = () => {
  // 点击图表时显示祝福
  robotMessage.value = getRandomBlessing()
  showRobotMessage.value = true
  
  setTimeout(() => {
    showRobotMessage.value = false
  }, 3000)
}

// 处理AI操作
const handleAIAction = (action) => {
  switch(action) {
    case 'analyze':
      ElMessage.info('正在调用AI进行数据分析...')
      break
    case 'suggest':
      ElMessage.info('正在生成优化建议...')
      break
    case 'report':
      ElMessage.info('正在生成经营报告...')
      break
  }
}

// 处理导航
const handleNavigate = (target) => {
  if (target) {
    emit('switch-tab', target)
  }
}

/** 跳转藏品库并带上营销筛选（App.vue 读 sessionStorage） */
const openPromoArchive = (filter) => {
  try {
    sessionStorage.setItem('sc_archive_promo_filter', filter)
  } catch (_) { /* ignore */ }
  emit('switch-tab', '1')
}

// 核心数据
const stats = reactive({
  todaySales: 0,
  yesterdaySales: 0,
  todayOrderCount: 0,
  monthSales: 0,
  monthProfit: 0,
  totalMonthOrders: 0, // 新增：本月总订单数
  totalUsers: 0,
  newUsers: 0,
  pendingOrders: 0,
  refunding: 0,
  lowStock: 0,
  totalTodos: 0,
  isManualData: false,
  // 🟢 对齐小程序的运营待办
  pendingBookings: 0,
  pendingCustom: 0,
  pendingPet: 0,
  pendingTickets: 0,
  pendingComments: 0,
  seckillProducts: 0,
  seckillActive: 0,
  seckillExpired: 0,
  groupProducts: 0
})

// 🟢 C 端小程序脉搏（来自 analytics_daily + user_behaviors 集合）
const miniapp = reactive({
  eventsToday: 0,
  uvToday: 0,
  identifyToday: 0,
  identifySuccessRate: 0,
  customSubmitsToday: 0,
  petSubmitsToday: 0,
  supportToday: 0,
  storeCheckinToday: 0
})

const businessStatus = computed(() => {
  if (stats.todaySales > 5000) return { text: '🔥 生意火爆', color: 'text-red' }
  if (stats.todaySales > 1000) return { text: '🙂 平稳运行', color: 'text-green' }
  return { text: '💤 暂无波澜', color: 'text-gray' }
})

const refreshAll = async () => {
  loading.value = true
  try {
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0] 
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0]
    const currentMonth = todayStr.substring(0, 7)

    // 1. 读取【财务系统】的账本数据（统一使用 shanhai_v12 key）
    const financeRaw = localStorage.getItem('shanhai_v12')
    const records = financeRaw ? JSON.parse(financeRaw) : []
    
    // 读取财务系统设置（从另一个key读取，如果存在）
    const settingsRaw = localStorage.getItem('sc_finance_v12')
    const financeSettings = settingsRaw ? JSON.parse(settingsRaw).settings : {}
    
    // 查找账本数据
    const todayRecord = records.find(r => r.date === todayStr)
    const yesterdayRecord = records.find(r => r.date === yesterdayStr)
    const monthRecords = records.filter(r => r.date.startsWith(currentMonth))
    const ledgerMonthSales = monthRecords.reduce((sum, r) => sum + (r.revenue || 0), 0)
    
    // 计算订单相关数据
    const monthOrderRecords = monthRecords.filter(r => r.orderCount && r.orderCount > 0)
    const totalMonthOrders = monthOrderRecords.reduce((sum, r) => sum + (r.orderCount || 0), 0)
    
    const costRate = (financeSettings?.costRate || 25) / 100
    const estProfit = Math.round(ledgerMonthSales * (1 - costRate))

    // 2. 读取【云数据库】实时数据（CDN SDK，避免 bundle db.count 静默失败）
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    const startMs = startOfDay.getTime()

    const cdnDb = await getCdnDatabase()
    const _ = cdnDb.command

    const safeCdnCount = async (coll, where = null) => {
      try {
        return await cdnCount(coll, where)
      } catch (e) {
        console.warn(`[Dashboard] count ${coll} failed:`, e?.message)
        return 0
      }
    }

    const [
      usersTotal, newUsersTotal, pendingTotal, refundingOrders, pendingRefunds, stockTotal,
      bookingTotal, customTotal, petTotal, ticketTotal, commentTotal
    ] = await Promise.all([
      safeCdnCount('users'),
      safeCdnCount('users', { createTime: _.gt(startMs) }),
      safeCdnCount('orders', { status: 'paid' }),
      safeCdnCount('orders', { status: 'refunding' }),
      safeCdnCount('refunds', { status: 'pending' }),
      safeCdnCount('products', { stock: _.lt(3) }),
      safeCdnCount('bookings', { status: 'confirmed' }),
      safeCdnCount('custom_inquiries', { status: 'pending' }),
      safeCdnCount('pet_memorial_orders', { status: 'pending_review' }),
      safeCdnCount('support_tickets', { status: 'pending' }),
      safeCdnCount('comments', { status: 'pending' }),
    ])
    const refundingTotal = refundingOrders + pendingRefunds

    // 3. 实时订单兜底：仅当今日尚未入账时才全量扫 orders（有账本则跳过，减一次 500 拉取）
    let realtimeTodaySales = 0
    let realtimeOrderCount = 0
    if (!todayRecord) {
      try {
        const todayOrderRows = await fetchCollectionLimit('orders', { limit: 500 })
        todayOrderRows.forEach(o => {
          const ts = o.createTime || o._createTime || 0
          if (ts >= startMs && ['paid', 'shipped', 'received'].includes(o.status)) {
            realtimeTodaySales += (parseFloat(o.totalPrice) || 0)
            realtimeOrderCount++
          }
        })
      } catch (e) {
        console.warn('[Dashboard] 今日订单兜底失败', e?.message)
      }
    }

    // 4. 合并数据（优先使用财务账本数据，保证数据一致性）
    if (todayRecord) {
        stats.todaySales = todayRecord.revenue
        stats.todayOrderCount = todayRecord.orderCount || 0
        stats.isManualData = true
    } else {
        stats.todaySales = realtimeTodaySales
        stats.todayOrderCount = realtimeOrderCount
        stats.isManualData = false
    }
    
    stats.yesterdaySales = yesterdayRecord ? yesterdayRecord.revenue : 0
    stats.monthSales = ledgerMonthSales || realtimeTodaySales
    stats.monthProfit = estProfit
    stats.totalMonthOrders = totalMonthOrders // 从财务账本读取本月总订单数
    // 会员数据与数据库保持一致
    stats.totalUsers = usersTotal
    stats.newUsers = newUsersTotal
    stats.pendingOrders = pendingTotal
    stats.refunding = refundingTotal
    stats.lowStock = stockTotal
    stats.pendingBookings = bookingTotal
    stats.pendingCustom = customTotal
    stats.pendingPet = petTotal
    stats.pendingTickets = ticketTotal
    stats.pendingComments = commentTotal

    // 活动商品 KPI（商品侧 seckill / groupBuying；秒杀拆「进行中 / 已过期」）
    try {
      const productRows = await fetchCollectionLimit('products', { limit: 500 })
      const nowMs = Date.now()
      let seckillN = 0
      let seckillActive = 0
      let seckillExpired = 0
      let groupN = 0
      productRows.forEach((p) => {
        if (p?.seckill?.enabled) {
          seckillN += 1
          const end = p.seckill.endTime ? Number(p.seckill.endTime) : null
          if (end && end < nowMs) seckillExpired += 1
          else seckillActive += 1
        }
        if (p?.groupBuying?.enabled) groupN += 1
      })
      stats.seckillProducts = seckillN
      stats.seckillActive = seckillActive
      stats.seckillExpired = seckillExpired
      stats.groupProducts = groupN
    } catch (e) {
      console.warn('[Dashboard] 活动商品统计失败', e?.message)
      stats.seckillProducts = 0
      stats.seckillActive = 0
      stats.seckillExpired = 0
      stats.groupProducts = 0
    }

    stats.totalTodos = pendingTotal + refundingTotal + stockTotal
                     + bookingTotal + customTotal + petTotal
                     + ticketTotal + commentTotal

    // 🟢 加载 C 端小程序脉搏数据（来自 analytics_daily / user_behaviors）
    loadMiniappPulse(todayStr).catch(e => console.warn('miniapp pulse skip', e))

    // 🟢 5. 渲染图表 (关键修复：使用 nextTick)
    await nextTick() // 等待 DOM 更新
    renderChart(records)
    
    // 6. 计算数据洞察
    calculateInsights(records, stats)

  } catch(e) {
    console.error('看板加载失败', e)
    ElMessage.warning(e?.message || '看板云数据加载失败，本地账本仍可使用；请检查网络后点「刷新看板」')
  } finally {
    loading.value = false
  }
}

// 根据账本与 stats 计算数据洞察（填充 insights.trend / insights.alert）
// 🟢 加载 C 端小程序脉搏数据（基于埋点）
const loadMiniappPulse = async (todayStr) => {
  const startMs = new Date(todayStr + 'T00:00:00').getTime()
  const cdnDb = await getCdnDatabase()
  const _ = cdnDb.command

  const applyPulseFromRows = (rows) => {
    const sum = (action) => rows
      .filter(r => r.action === action)
      .reduce((s, r) => s + (r.count || 0), 0)
    const allUv = new Set()
    let total = 0
    rows.forEach(r => {
      total += (r.count || 0)
      ;(r.uv || []).forEach(u => allUv.add(u))
    })
    const idStart = sum('identify_start')
    const idSuccess = sum('identify_success')
    miniapp.eventsToday = total
    miniapp.uvToday = allUv.size
    miniapp.identifyToday = idStart
    miniapp.identifySuccessRate = idStart > 0 ? Math.round((idSuccess / idStart) * 100) : 0
    miniapp.customSubmitsToday = sum('custom_order_submit') + sum('custom_inquiry_submit')
    miniapp.petSubmitsToday = sum('pet_memorial_submit')
    miniapp.supportToday = sum('support_ticket_submit') + sum('support_call') + sum('support_wechat_contact')
    miniapp.storeCheckinToday = sum('store_checkin')
  }

  // 优先用 analytics_daily 聚合表
  try {
    const rows = await fetchCollectionWhere('analytics_daily', { dateKey: todayStr }, 200)
    if (rows.length) {
      applyPulseFromRows(rows)
      return
    }
  } catch (e) {
    console.warn('analytics_daily 不可读', e?.message)
  }

  // 兜底：从 user_behaviors 实时统计今日
  try {
    const events = await fetchCollectionWhere('user_behaviors', { timestamp: _.gte(startMs) }, 500)
    const cnt = (action) => events.filter(e => e.action === action).length
    miniapp.eventsToday = events.length
    miniapp.uvToday = new Set(events.map(e => e.userId).filter(Boolean)).size
    const idStart = cnt('identify_start')
    const idSuccess = cnt('identify_success')
    miniapp.identifyToday = idStart
    miniapp.identifySuccessRate = idStart > 0 ? Math.round((idSuccess / idStart) * 100) : 0
    miniapp.customSubmitsToday = cnt('custom_order_submit') + cnt('custom_inquiry_submit')
    miniapp.petSubmitsToday = cnt('pet_memorial_submit')
    miniapp.supportToday = cnt('support_ticket_submit') + cnt('support_call') + cnt('support_wechat_contact')
    miniapp.storeCheckinToday = cnt('store_checkin')
  } catch (e) {
    console.warn('user_behaviors 不可读', e?.message)
  }
}

const calculateInsights = (records, stats) => {
  if (!records || !stats) return
  const weekRecords = (records || []).slice(-7)
  const weekSales = weekRecords.reduce((s, r) => s + (r.revenue || 0), 0)
  const avgDaily = weekRecords.length ? weekSales / weekRecords.length : 0
  const yesterday = stats.yesterdaySales || 0
  const today = stats.todaySales || 0
  const trendDir = today >= yesterday ? 'up' : 'down'
  const trendPct = yesterday > 0 ? Math.abs(((today - yesterday) / yesterday) * 100).toFixed(1) : '—'
  insights.trend = {
    title: weekRecords.length ? '近7日经营趋势' : '暂无账本数据',
    desc: weekRecords.length
      ? `日均营收 ¥${Math.round(avgDaily).toLocaleString()}，今日较昨日${trendDir === 'up' ? '升' : '降'} ${trendPct}%`
      : '请先在财务模块录入日报'
  }
  const todos = stats.totalTodos || 0
  const lowStock = stats.lowStock || 0
  if (todos > 0 || lowStock > 0) {
    insights.alert = {
      title: '待关注事项',
      desc: [todos > 0 && `待处理 ${todos} 项`, lowStock > 0 && `库存预警 ${lowStock} 件`].filter(Boolean).join('；') || '暂无'
    }
  } else {
    insights.alert = null
  }
  trendAnalysis.value = [
    { metric: 'today', label: '今日营收', value: `¥${(stats.todaySales || 0).toLocaleString()}`, type: 'neutral', desc: '' },
    { metric: 'month', label: '本月营收', value: `¥${(stats.monthSales || 0).toLocaleString()}`, type: 'neutral', desc: '' }
  ]
  if (stats.totalTodos > 0) {
    anomalies.value = [{ level: 'high', title: '待处理事项', desc: `共 ${stats.totalTodos} 项待处理`, action: '去处理' }]
  } else {
    anomalies.value = []
  }
  if (!forecasts.value?.length) forecasts.value = [{ period: '下周', value: '—', confidence: '-' }]
  if (!suggestions.value?.length) suggestions.value = [{ title: '保持数据录入', desc: '每日录入日报可提升看板准确性' }]
}

const refreshInsights = async () => {
  insightsLoading.value = true
  try {
    const financeRaw = localStorage.getItem('shanhai_v12')
    const records = financeRaw ? JSON.parse(financeRaw) : []
    calculateInsights(records, stats)
    ElMessage.success('洞察已刷新')
  } catch (e) {
    console.error('刷新洞察失败', e)
    ElMessage.error('刷新失败')
  } finally {
    insightsLoading.value = false
  }
}

const exportInsights = () => {
  const text = [
    `数据洞察报告 ${new Date().toLocaleDateString('zh-CN')}`,
    insights.trend ? `${insights.trend.title}: ${insights.trend.desc}` : '',
    insights.alert ? `${insights.alert.title}: ${insights.alert.desc}` : ''
  ].filter(Boolean).join('\n')
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `洞察报告_${new Date().toISOString().slice(0, 10)}.txt`
  a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('报告已导出')
}

const handleAnomalyAction = (anomaly) => {
  if (anomaly.action === '去处理') emit('switch-tab', '3')
  showInsightsDialog.value = false
}

const renderChart = (records) => {
  // 使用 ref 获取元素
  const ctx = chartCanvas.value
  if (!ctx) {
      console.warn("Canvas ref is null, chart rendering skipped.")
      return
  }

  // 构造近7天日期数组
  const labels = []
  const dataPoints = []
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    const displayDate = d.toLocaleDateString('zh-CN', {month:'numeric', day:'numeric'})
    
    // 在账本中查找，找不到则为 0
    const rec = records.find(r => r.date === dateStr)
    labels.push(displayDate)
    dataPoints.push(rec ? rec.revenue : 0)
  }

  chartEmpty.value = dataPoints.every((v) => !v)

  if (chartInstance) chartInstance.destroy()

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '营收趋势 (账本)',
        data: dataPoints,
        borderColor: '#2D6A4F',
        backgroundColor: 'rgba(45, 106, 79, 0.12)',
        borderWidth: 2,
        tension: 0.4,
        fill: true,
        pointBackgroundColor: '#fff',
        pointBorderColor: '#2D6A4F',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: '#f5f5f5' }, ticks: { font: { family: 'Arial' } } },
        x: { grid: { display: false } }
      }
    }
  })
}

let clockTimer = null

onMounted(() => {
  clockTimer = setInterval(() => { currentTime.value = new Date().toLocaleTimeString() }, 1000)
  refreshAll()
  // 初始化洞察数据
  setTimeout(() => {
    const financeRaw = localStorage.getItem('shanhai_v12')
    const records = financeRaw ? JSON.parse(financeRaw) : []
    calculateInsights(records, stats)
  }, 1000)
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<style scoped>
.dashboard-container { padding: 10px; height: 100%; box-sizing: border-box; overflow-y: auto; }

/* 头部 */
.header-section { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 25px; }
.header-section h2 { margin: 0; font-size: 26px; color: #333; }
.subtitle { color: #999; font-size: 13px; margin: 5px 0 0 0; display: flex; align-items: center; }
.text-red { color: #f56c6c; }
.text-green { color: #27ae60; }
.text-gray { color: #999; }

.header-right {
  display: flex;
  align-items: center;
  gap: 15px;
}

.time-badge { background: #fff; padding: 6px 15px; border-radius: 20px; font-size: 13px; font-weight: bold; color: #555; box-shadow: 0 2px 10px rgba(0,0,0,0.05); display: flex; align-items: center; gap: 5px; }

/* KPI Grid */
.kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 20px; margin-bottom: 30px; }
.kpi-card { padding: 20px; border-radius: 12px; height: 120px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 4px 15px rgba(0,0,0,0.03); position: relative; overflow: hidden; transition: 0.3s; cursor: pointer; }
.kpi-card:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,0.08); }

.kpi-card.black {
  background: var(--dark-bg-secondary);
  color: var(--dark-text-secondary);
  border: 1px solid var(--dark-border-subtle);
}
.kpi-card.black .kpi-value { color: var(--brand-green-300); }
.kpi-card.black .kpi-top { color: var(--dark-text-tertiary); }
.kpi-card.gold {
  background: var(--brand-green-50);
  color: var(--light-text-primary);
  border: 1px solid var(--light-border-default);
}
.kpi-card.gold .kpi-value { color: var(--brand-green-500); }
.kpi-card.gold .kpi-top .label { color: var(--light-text-secondary); }
.kpi-card.white { background: #fff; color: #333; border: 1px solid var(--light-border-subtle); }

.kpi-top { display: flex; justify-content: space-between; align-items: flex-start; font-size: 12px; opacity: 0.8; }
.kpi-value { font-size: 28px; font-weight: 600; font-family: var(--font-en-body), 'Segoe UI', sans-serif; letter-spacing: -0.5px; }
.kpi-sub { font-size: 12px; opacity: 0.6; }

/* 图表与待办 */
.middle-section { margin-bottom: 30px; align-items: stretch; }
.middle-left,
.middle-right { display: flex; flex-direction: column; gap: 16px; }
.middle-right .todo-card { flex: 1; }
.card-header { display: flex; justify-content: space-between; align-items: center; font-weight: bold; }
.chart-box { height: 250px; position: relative; width: 100%; } /* 确保有宽度 */
.chart-empty {
  position: absolute;
  inset: 12px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.72));
  border-radius: 8px;
}
.chart-empty-title { font-size: 14px; font-weight: 700; color: #606266; }
.chart-empty-desc { margin-top: 6px; font-size: 12px; color: #909399; max-width: 360px; line-height: 1.5; }
.chart-dimmed { opacity: 0.35; }

/* 待办列表 */
.todo-list { display: flex; flex-direction: column; gap: 15px; }
.todo-item { display: flex; align-items: center; padding: 12px; background: #f9f9f9; border-radius: 8px; cursor: pointer; transition: 0.2s; border: 1px solid transparent; }
.todo-item:hover { background: #fff; border-color: #eee; box-shadow: 0 4px 10px rgba(0,0,0,0.03); }
.todo-item.active { border-left: 3px solid #f56c6c; } 

.todo-icon { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #fff; margin-right: 12px; }
.bg-blue { background: #409eff; }
.bg-red { background: #f56c6c; }
.bg-orange { background: #e6a23c; }

.todo-content { flex: 1; }
.t-title { font-weight: bold; font-size: 14px; color: #333; }
.t-desc { font-size: 12px; color: #999; margin-top: 2px; }
.todo-num { font-weight: bold; font-size: 16px; color: #333; }
.todo-num-warn { color: #E6A23C; }

/* 快捷操作 */
.quick-actions h3 { border-left: 4px solid var(--brand-green-500); padding-left: 12px; margin-bottom: 20px; font-size: 16px; }
.action-grid { display: flex; gap: 15px; flex-wrap: wrap; }

/* C 端小程序脉搏 */
.miniapp-pulse { background: #fff; border-radius: 12px; padding: 16px 18px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }
.miniapp-pulse.compact { flex: 1; margin-bottom: 0; min-height: 0; }
.mp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.mp-header h3 { margin: 0; font-size: 15px; color: #333; border-left: 4px solid #d4af37; padding-left: 10px; }
.mp-sub { color: #999; font-size: 10px; letter-spacing: 1px; font-weight: normal; margin-left: 4px; }
.mp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.miniapp-pulse.compact .mp-card { padding: 10px; }
.miniapp-pulse.compact .mp-val { font-size: 18px; }
.mp-card { display: flex; gap: 10px; align-items: center; padding: 12px; background: #fafafa; border-radius: 10px; border: 1px solid transparent; cursor: pointer; transition: 0.2s; }
.mp-card:hover { background: #fff; border-color: #d4af37; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.15); transform: translateY(-2px); }
.mp-ico { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
.mp-info { flex: 1; min-width: 0; }
.mp-lbl { font-size: 11px; color: #999; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-val { font-size: 20px; font-weight: 800; color: #333; line-height: 1.2; margin-top: 2px; }
.mp-trend { font-size: 11px; color: #d4af37; margin-top: 2px; }
@media (max-width: 1200px) { .mp-grid { grid-template-columns: repeat(2, 1fr); } }

/* 图表祝福消息 */
.chart-blessing {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: var(--brand-green-50);
  color: var(--brand-green-700);
  border: 1px solid var(--light-border-default);
  padding: 15px 25px;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  box-shadow: var(--shadow-md);
  z-index: 10;
  pointer-events: none;
  animation: blessingPop 0.5s ease;
}

@keyframes blessingPop {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.5);
  }
  50% {
    transform: translate(-50%, -50%) scale(1.1);
  }
  100% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 数据洞察样式 */
.insights-preview {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #eee;
}

.insight-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.05) 0%, rgba(45, 106, 79, 0.02) 100%);
  border-radius: 8px;
  margin-bottom: 8px;
  border-left: 3px solid #2D6A4F;
}

.insight-icon {
  font-size: 18px;
  color: #2D6A4F;
  margin-top: 2px;
}

.insight-icon.warning {
  color: #f56c6c;
}

.insight-content {
  flex: 1;
}

.insight-title {
  font-size: 13px;
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
}

.insight-desc {
  font-size: 12px;
  color: #666;
  line-height: 1.4;
}

/* 洞察弹窗样式 */
.insights-container {
  max-height: 70vh;
  overflow-y: auto;
}

.insight-section {
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid #eee;
}

.insight-section:last-child {
  border-bottom: none;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: #333;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid #2D6A4F;
}

.section-title .el-icon {
  font-size: 18px;
  color: #2D6A4F;
}

.trend-analysis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.trend-item {
  padding: 16px;
  background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
  border: 1px solid #eee;
  border-radius: 10px;
  transition: all 0.3s ease;
}

.trend-item:hover {
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.15);
  transform: translateY(-2px);
}

.trend-label {
  font-size: 13px;
  color: #666;
  margin-bottom: 8px;
}

.trend-value {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 20px;
  font-weight: 700;
  color: #333;
}

.trend-value.up {
  color: #27ae60;
}

.trend-value.down {
  color: #f56c6c;
}

.trend-desc {
  font-size: 12px;
  color: #999;
  font-weight: normal;
}

.anomalies-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.anomaly-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  background: #fff;
  border: 1px solid #eee;
  border-radius: 10px;
  border-left: 4px solid #f56c6c;
  transition: all 0.3s ease;
}

.anomaly-item.medium {
  border-left-color: #e6a23c;
}

.anomaly-item:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.anomaly-icon {
  font-size: 20px;
  color: #f56c6c;
  margin-top: 2px;
}

.anomaly-item.medium .anomaly-icon {
  color: #e6a23c;
}

.anomaly-content {
  flex: 1;
}

.anomaly-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 6px;
}

.anomaly-desc {
  font-size: 13px;
  color: #666;
  line-height: 1.5;
  margin-bottom: 8px;
}

.anomaly-action {
  margin-top: 8px;
}

.forecast-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.forecast-card {
  padding: 20px;
  background: linear-gradient(135deg, rgba(45, 106, 79, 0.08) 0%, rgba(45, 106, 79, 0.03) 100%);
  border: 1px solid rgba(45, 106, 79, 0.2);
  border-radius: 12px;
  text-align: center;
  transition: all 0.3s ease;
}

.forecast-card:hover {
  box-shadow: 0 6px 20px rgba(45, 106, 79, 0.2);
  transform: translateY(-3px);
}

.forecast-label {
  font-size: 13px;
  color: #666;
  margin-bottom: 12px;
}

.forecast-value {
  font-size: 24px;
  font-weight: 700;
  color: #2D6A4F;
  margin-bottom: 8px;
}

.forecast-desc {
  font-size: 12px;
  color: #999;
  margin-bottom: 8px;
}

.forecast-confidence {
  font-size: 11px;
  color: #999;
  padding-top: 8px;
  border-top: 1px solid rgba(45, 106, 79, 0.1);
}

.suggestions-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.suggestion-item {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 16px;
  background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
  border: 1px solid #eee;
  border-radius: 10px;
  border-left: 4px solid #2D6A4F;
  transition: all 0.3s ease;
}

.suggestion-item:hover {
  box-shadow: 0 4px 12px rgba(45, 106, 79, 0.15);
  transform: translateX(4px);
}

.suggestion-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.suggestion-content {
  flex: 1;
}

.suggestion-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 6px;
}

.suggestion-desc {
  font-size: 13px;
  color: #666;
  line-height: 1.5;
  margin-bottom: 8px;
}

.suggestion-impact {
  font-size: 12px;
  color: #999;
}

.suggestion-action {
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .dashboard-container { padding: 0; }
  .header-section {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 16px;
  }
  .header-section h2 { font-size: 20px; }
  .header-right {
    width: 100%;
    flex-wrap: wrap;
    gap: 10px;
  }
  .time-badge { font-size: 12px; padding: 6px 12px; }
  .kpi-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-bottom: 20px;
  }
  .kpi-card {
    height: auto;
    min-height: 96px;
    padding: 14px;
  }
  .kpi-value { font-size: 22px; }
  .chart-box { height: 210px; }
  .card-header { flex-wrap: wrap; gap: 8px; }
  .todo-item { padding: 10px; }
  .todo-num { font-size: 15px; }
  .insights-preview { margin-top: 12px; padding-top: 12px; }
  .quick-actions h3 { font-size: 15px; margin-bottom: 14px; }
  .action-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .action-grid .el-button {
    width: 100%;
    margin: 0;
    min-height: 44px;
  }
  .mp-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 480px) {
  .kpi-grid { grid-template-columns: 1fr; }
  .mp-grid { grid-template-columns: 1fr; }
  .action-grid { grid-template-columns: 1fr; }
}
</style>