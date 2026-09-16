<template>
  <div ref="rootRef" class="realtime-monitor" :class="{ 'realtime-monitor--fs': isFullscreen }">
    <header class="monitor-header">
      <div class="monitor-header-brand">
        <p class="monitor-kicker">{{ pageKicker }}</p>
        <h1 class="monitor-title">{{ pageTitle }}</h1>
        <p class="monitor-hint">{{ pageHint }}</p>
        <p class="monitor-meta">
          <span>上次更新 {{ lastUpdatedText }}</span>
          <template v-if="isAutoRefresh">
            <span class="monitor-meta-dot" aria-hidden="true">·</span>
            <span>间隔 {{ refreshInterval }}s</span>
          </template>
        </p>
      </div>
      <div class="monitor-header-actions">
        <el-tag :type="isAutoRefresh ? 'success' : 'info'" effect="plain" round size="small" class="monitor-status-tag">
          {{ isAutoRefresh ? '自动刷新' : '手动模式' }}
        </el-tag>
        <div class="monitor-toolbar">
          <el-select v-model="refreshInterval" class="monitor-interval" size="small" @change="updateRefreshInterval">
            <el-option label="10 秒" :value="10" />
            <el-option label="30 秒" :value="30" />
            <el-option label="60 秒" :value="60" />
            <el-option label="5 分钟" :value="300" />
          </el-select>
          <el-switch v-model="isAutoRefresh" size="small" inline-prompt active-text="开" inactive-text="关" @change="handleAutoRefreshChange" />
          <el-tooltip content="立即刷新" placement="bottom">
            <el-button type="primary" plain size="small" :loading="loading" :icon="Refresh" @click="refreshData" />
          </el-tooltip>
          <el-tooltip :content="isFullscreen ? '退出全屏' : '全屏展示'" placement="bottom">
            <el-button size="small" :icon="FullScreen" @click="toggleFullscreen" />
          </el-tooltip>
          <el-tooltip content="阈值与告警设置" placement="bottom">
            <el-button size="small" :icon="Setting" @click="showSettings = true" />
          </el-tooltip>
        </div>
      </div>
    </header>

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      class="monitor-load-error"
      :title="loadError"
      description="请确认 CDN 云库可读（orders / products / users / analytics）。失败时勿把零 KPI 当成真实空闲。"
    />

    <!-- 核心指标卡片区 -->
    <div class="kpi-grid">
      <div class="kpi-card revenue" :class="{ 'alert': revenueAlert }">
        <div class="kpi-header">
          <span class="kpi-label">今日营收</span>
          <el-tag :type="revenueAlert ? 'danger' : 'success'" size="small" effect="plain" round>{{ revenueTrend }}</el-tag>
        </div>
        <div class="kpi-value">¥{{ formatNumber(stats.todayRevenue) }}</div>
        <div class="kpi-footer">
          <span>昨日: ¥{{ formatNumber(stats.yesterdayRevenue) }}</span>
          <span class="kpi-change" :class="stats.revenueChange >= 0 ? 'positive' : 'negative'">
            {{ stats.revenueChange >= 0 ? '+' : '' }}{{ stats.revenueChange.toFixed(1) }}%
          </span>
        </div>
      </div>

      <div class="kpi-card orders" :class="{ 'alert': ordersAlert }">
        <div class="kpi-header">
          <span class="kpi-label">今日订单</span>
          <el-tag :type="ordersAlert ? 'danger' : 'success'" size="small" effect="plain" round>{{ ordersTrend }}</el-tag>
        </div>
        <div class="kpi-value">{{ stats.todayOrders }}</div>
        <div class="kpi-footer">
          <span>昨日: {{ stats.yesterdayOrders }}</span>
          <span class="kpi-change" :class="stats.ordersChange >= 0 ? 'positive' : 'negative'">
            {{ stats.ordersChange >= 0 ? '+' : '' }}{{ stats.ordersChange.toFixed(1) }}%
          </span>
        </div>
      </div>

      <div class="kpi-card customers" :class="{ 'alert': customersAlert }">
        <div class="kpi-header">
          <span class="kpi-label">会员总数</span>
          <el-icon class="pulse-icon"><UserFilled /></el-icon>
        </div>
        <div class="kpi-value">{{ stats.activeUsers }}</div>
        <div class="kpi-footer">
          <span>今日活跃 UV: {{ stats.onlineUsers != null ? stats.onlineUsers : '—' }}</span>
          <span class="kpi-change" :class="stats.onlineUsers != null ? 'positive' : ''">
            {{ stats.onlineUsersNote || '云库' }}
          </span>
        </div>
      </div>

      <div class="kpi-card inventory" :class="{ 'alert': inventoryAlert }">
        <div class="kpi-header">
          <span class="kpi-label">库存预警</span>
          <el-icon v-if="inventoryAlert" class="alert-icon"><Warning /></el-icon>
        </div>
        <div class="kpi-value">{{ stats.lowStockCount }}</div>
        <div class="kpi-footer">
          <span>缺货: {{ stats.outOfStockCount }}</span>
          <el-button size="small" type="danger" link @click="handleInventoryAlert">查看详情</el-button>
        </div>
      </div>

      <div class="kpi-card conversion" :class="{ 'alert': conversionAlert }">
        <div class="kpi-header">
          <span class="kpi-label">转化率</span>
          <el-tag :type="conversionAlert ? 'warning' : 'success'" size="small" effect="plain" round>{{ stats.conversionRate }}%</el-tag>
        </div>
        <div class="kpi-value">{{ stats.conversionRate.toFixed(2) }}%</div>
        <div class="kpi-footer">
          <span>目标: {{ settings.conversionTarget }}%</span>
          <span class="kpi-change" :class="conversionGap >= 0 ? 'positive' : 'negative'">
            {{ conversionGap >= 0 ? '+' : '' }}{{ conversionGap.toFixed(1) }}%
          </span>
        </div>
      </div>

      <div class="kpi-card profit" :class="{ 'alert': profitAlert }">
        <div class="kpi-header">
          <span class="kpi-label">今日利润</span>
          <el-tag :type="profitAlert ? 'danger' : 'success'" size="small" effect="plain" round>实时</el-tag>
        </div>
        <div class="kpi-value">¥{{ formatNumber(stats.todayProfit) }}</div>
        <div class="kpi-footer">
          <span>利润率: {{ stats.profitMargin.toFixed(2) }}%</span>
          <span class="kpi-change" :class="stats.profitMargin >= settings.profitTarget ? 'positive' : 'negative'">
            {{ stats.profitMargin >= settings.profitTarget ? '✓' : '✗' }}
          </span>
        </div>
      </div>
    </div>

    <!-- 图表和数据区 -->
    <div class="charts-grid">
      <!-- 营收趋势图 -->
      <div class="chart-card chart-card--revenue">
        <div class="chart-header">
          <div class="chart-heading">
            <h3>营收趋势</h3>
            <p class="chart-sub">财务账本 / 周期汇总</p>
          </div>
          <el-radio-group v-model="revenueChartRange" size="small" class="chart-range" @change="updateRevenueChart">
            <el-radio-button label="1h">1 小时</el-radio-button>
            <el-radio-button label="24h">24 小时</el-radio-button>
            <el-radio-button label="7d">7 天</el-radio-button>
          </el-radio-group>
        </div>
        <div ref="revenueChartWrap" class="chart-container">
          <canvas v-show="revenueData.length" ref="revenueChartCanvas" />
          <div v-if="!revenueData.length && !loading" class="empty-stream chart-empty">
            {{ revenueEmptyNote || '暂无营收趋势数据' }}
          </div>
        </div>
      </div>

      <!-- 订单实时流 -->
      <div class="chart-card chart-card--orders">
        <div class="chart-header">
          <div class="chart-heading">
            <h3>订单实时流</h3>
            <p class="chart-sub">近 24 小时 · 最新在上</p>
          </div>
          <el-tag type="success" effect="plain" round size="small">实时</el-tag>
        </div>
        <div class="order-stream">
          <div 
            v-for="(order, index) in recentOrders" 
            :key="order.id || index"
            class="order-item"
            :class="{ 'new': order.isNew }"
          >
            <div class="order-time">{{ formatTime(order.createTime) }}</div>
            <div class="order-info">
              <span class="order-amount">¥{{ formatNumber(order.amount) }}</span>
              <span class="order-desc">{{ order.description || '新订单' }}</span>
            </div>
          </div>
          <div v-if="recentOrders.length === 0" class="empty-stream">暂无订单数据</div>
        </div>
      </div>

      <!-- 商品销售Top10 -->
      <div class="chart-card chart-card--top">
        <div class="chart-header">
          <div class="chart-heading">
            <h3>商品销售 Top10</h3>
            <p class="chart-sub">按成交金额排序</p>
          </div>
          <el-tag type="warning" effect="plain" round size="small">今日</el-tag>
        </div>
        <div class="top-products">
          <div 
            v-for="(product, index) in topProducts" 
            :key="product.id || index"
            class="product-item"
          >
            <div class="product-rank">{{ index + 1 }}</div>
            <div class="product-info">
              <div class="product-name">{{ product.name }}</div>
              <div class="product-stats">
                <span>销量 {{ product.sales }}</span>
                <span>¥{{ formatNumber(product.revenue) }}</span>
              </div>
              <div v-if="topProductsRevenueMax > 0" class="product-bar-track">
                <div class="product-bar-fill" :style="{ width: ((product.revenue || 0) / topProductsRevenueMax) * 100 + '%' }" />
              </div>
            </div>
            <div class="product-trend">
              <el-icon v-if="product.trend > 0" class="trend-up"><ArrowUp /></el-icon>
              <el-icon v-else-if="product.trend < 0" class="trend-down"><ArrowDown /></el-icon>
              <span :class="product.trend > 0 ? 'positive' : product.trend < 0 ? 'negative' : ''">
                {{ product.trend > 0 ? '+' : '' }}{{ product.trend }}%
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 告警列表 -->
      <div class="chart-card alerts-card">
        <div class="chart-header">
          <div class="chart-heading">
            <h3>系统告警</h3>
            <p class="chart-sub">阈值命中与运营提醒</p>
          </div>
          <el-badge :value="alerts.filter((a) => !a.read).length" :max="99" type="danger">
            <el-button size="small" plain @click="markAllAlertsRead">全部已读</el-button>
          </el-badge>
        </div>
        <div class="alerts-list">
          <div 
            v-for="alert in alerts" 
            :key="alert.id"
            class="alert-item"
            :class="{ 'read': alert.read, 'critical': alert.level === 'critical', 'warning': alert.level === 'warning' }"
            @click="handleAlertClick(alert)"
          >
            <div class="alert-icon">
              <el-icon v-if="alert.level === 'critical'"><WarningFilled /></el-icon>
              <el-icon v-else-if="alert.level === 'warning'"><InfoFilled /></el-icon>
              <el-icon v-else><Bell /></el-icon>
            </div>
            <div class="alert-content">
              <div class="alert-title">{{ alert.title }}</div>
              <div class="alert-desc">{{ alert.description }}</div>
              <div class="alert-time">{{ formatRelativeTime(alert.time) }}</div>
            </div>
            <div class="alert-actions">
              <el-button size="small" link @click.stop="dismissAlert(alert.id)">忽略</el-button>
            </div>
          </div>
          <div v-if="alerts.length === 0" class="empty-alerts">
            <el-empty description="暂无告警" :image-size="80" />
          </div>
        </div>
      </div>
    </div>

    <!-- 设置对话框 -->
    <el-dialog
      v-model="showSettings"
      title="监控大屏设置"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form :model="settings" label-width="140px">
        <el-form-item label="营收预警阈值">
          <el-input-number 
            v-model="settings.revenueThreshold" 
            :min="0" 
            :precision="0"
            :step="1000"
          />
          <span class="form-hint-muted">低于此值将触发预警</span>
        </el-form-item>
        <el-form-item label="订单预警阈值">
          <el-input-number 
            v-model="settings.ordersThreshold" 
            :min="0" 
            :step="1"
          />
          <span class="form-hint-muted">低于此值将触发预警</span>
        </el-form-item>
        <el-form-item label="转化率目标">
          <el-input-number 
            v-model="settings.conversionTarget" 
            :min="0" 
            :max="100"
            :precision="2"
            :step="0.1"
          />
          <span class="form-hint-muted">%</span>
        </el-form-item>
        <el-form-item label="利润率目标">
          <el-input-number 
            v-model="settings.profitTarget" 
            :min="0" 
            :max="100"
            :precision="2"
            :step="0.1"
          />
          <span class="form-hint-muted">%</span>
        </el-form-item>
        <el-form-item label="库存预警数量">
          <el-input-number 
            v-model="settings.inventoryThreshold" 
            :min="0" 
            :step="1"
          />
          <span class="form-hint-muted">超过此值将触发预警</span>
        </el-form-item>
        <el-form-item label="告警通知">
          <el-switch v-model="settings.enableAlerts" />
          <span class="form-hint-muted">启用系统告警</span>
        </el-form-item>
        <el-form-item label="声音提示">
          <el-switch v-model="settings.enableSound" />
          <span class="form-hint-muted">告警时播放提示音</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showSettings = false">取消</el-button>
        <el-button type="primary" @click="saveSettings">保存设置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { 
  Refresh, FullScreen, Setting, UserFilled, Warning, 
  WarningFilled, InfoFilled, Bell, ArrowUp, ArrowDown
} from '@element-plus/icons-vue'
import { fetchStoreData } from '../utils/storeData'
import { fetchFinancialData } from '../utils/financialData'
import { fetchCollectionWhere, getCdnDatabase } from '../cloud'

/** live=菜单「实时监控」；business=菜单「经营数据大屏」——同一组件，文案入口不同 */
const props = defineProps({
  variant: {
    type: String,
    default: 'live',
    validator: (v) => ['live', 'business'].includes(v),
  },
})

const pageTitle = computed(() =>
  props.variant === 'business' ? '经营数据大屏' : '实时监控大屏'
)
const pageKicker = computed(() =>
  props.variant === 'business' ? 'COCKPIT · 经营看板' : 'LIVE · 实时监控'
)
const pageHint = computed(() =>
  props.variant === 'business'
    ? '与「实时监控大屏」共用同一数据源；本入口侧重全屏经营看板展示'
    : '与「经营数据大屏」共用同一数据源；本入口侧重自动刷新与阈值告警'
)

// 状态管理
const loading = ref(false)
const loadError = ref('')
const isAutoRefresh = ref(true)
const refreshInterval = ref(30) // 默认30秒
let refreshTimer = null

// 大屏状态
const isFullscreen = ref(false)
const rootRef = ref(null)
const revenueChartWrap = ref(null)
const lastUpdated = ref(null)
let chartResizeObserver = null
/** 避免 ResizeObserver ↔ 改 canvas 尺寸 形成布局反馈环 */
let lastChartDrawSize = { w: 0, h: 0 }
let chartResizeRaf = null

const lastUpdatedText = computed(() => {
  if (!lastUpdated.value) return '—'
  return new Date(lastUpdated.value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
})

const topProductsRevenueMax = computed(() => {
  const list = topProducts.value || []
  const m = Math.max(0, ...list.map((p) => Number(p.revenue) || 0))
  return m > 0 ? m : 0
})

// 统计数据
const stats = ref({
  todayRevenue: 0,
  yesterdayRevenue: 0,
  revenueChange: 0,
  todayOrders: 0,
  yesterdayOrders: 0,
  ordersChange: 0,
  activeUsers: 0,
  onlineUsers: null,
  onlineUsersNote: '待埋点',
  lowStockCount: 0,
  outOfStockCount: 0,
  conversionRate: 0,
  todayProfit: 0,
  profitMargin: 0
})

// 图表相关
const revenueChartCanvas = ref(null)
const revenueChartRange = ref('24h')
const revenueData = ref([])
const revenueEmptyNote = ref('')
const cachedOrders = ref([])

// 订单流
const recentOrders = ref([])

// Top商品
const topProducts = ref([])

// 告警系统
const alerts = ref([])
let alertIdCounter = 0

// 设置
const showSettings = ref(false)
const settings = ref({
  revenueThreshold: 1000,
  ordersThreshold: 10,
  conversionTarget: 3.0,
  profitTarget: 20.0,
  inventoryThreshold: 5,
  enableAlerts: true,
  enableSound: false
})

// 加载设置
const loadSettings = () => {
  const saved = localStorage.getItem('realtimeMonitorSettings')
  if (saved) {
    try {
      settings.value = { ...settings.value, ...JSON.parse(saved) }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  }
}

// 保存设置
const saveSettings = () => {
  localStorage.setItem('realtimeMonitorSettings', JSON.stringify(settings.value))
  showSettings.value = false
  ElMessage.success('设置已保存')
  checkAlerts() // 重新检查告警
}

// 计算属性 - 告警状态
const revenueAlert = computed(() => {
  return settings.value.enableAlerts && stats.value.todayRevenue < settings.value.revenueThreshold
})

const ordersAlert = computed(() => {
  return settings.value.enableAlerts && stats.value.todayOrders < settings.value.ordersThreshold
})

const inventoryAlert = computed(() => {
  return settings.value.enableAlerts && stats.value.lowStockCount > settings.value.inventoryThreshold
})

const conversionAlert = computed(() => {
  return settings.value.enableAlerts && stats.value.conversionRate < settings.value.conversionTarget
})

const profitAlert = computed(() => {
  return settings.value.enableAlerts && stats.value.profitMargin < settings.value.profitTarget
})

const revenueTrend = computed(() => {
  return stats.value.revenueChange >= 0 ? '↑' : '↓'
})

const ordersTrend = computed(() => {
  return stats.value.ordersChange >= 0 ? '↑' : '↓'
})

const conversionGap = computed(() => {
  return stats.value.conversionRate - settings.value.conversionTarget
})

// 格式化数字
const formatNumber = (num) => {
  return (num || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// 格式化相对时间
const formatRelativeTime = (timestamp) => {
  if (!timestamp) return ''
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  
  if (seconds < 60) return `${seconds}秒前`
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

// 刷新数据
const refreshData = async () => {
  loading.value = true
  loadError.value = ''
  try {
    // 获取财务数据（真实数据）
    const financialData = await fetchFinancialData({ period: 'today' })
    const yesterdayFinancialData = await fetchFinancialData({ 
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() - 24 * 60 * 60 * 1000)
    })
    
    // 获取综合数据
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'week' })
    
    // 计算今日和昨日数据
    const todayRevenue = financialData.today?.revenue || 0
    const yesterdayRevenue = yesterdayFinancialData.revenue || financialData.yesterday?.revenue || 0
    const revenueChange = yesterdayRevenue > 0 ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue * 100) : 0
    
    const todayOrders = financialData.today?.orderCount || 0
    const yesterdayOrders = yesterdayFinancialData.orderCount || financialData.yesterday?.orderCount || 0
    const ordersChange = yesterdayOrders > 0 ? ((todayOrders - yesterdayOrders) / yesterdayOrders * 100) : 0
    
    // 计算利润（从财务设置获取成本率）
    const financeSettings = financialData.settings || {}
    const costRate = financeSettings.costRate || 0.6 // 默认成本率60%
    const todayCost = todayRevenue * costRate
    const todayProfit = todayRevenue - todayCost
    const profitMargin = todayRevenue > 0 ? (todayProfit / todayRevenue * 100) : 0
    
    // 今日活跃 UV：优先 analytics_daily / user_behaviors，无埋点则标注待埋点
    let todayUv = null
    let uvNote = '待埋点'
    try {
      const todayStr = new Date().toISOString().split('T')[0]
      const startMs = new Date(todayStr + 'T00:00:00').getTime()
      const cdnDb = await getCdnDatabase()
      const _ = cdnDb.command
      const daily = await fetchCollectionWhere('analytics_daily', { dateKey: todayStr }, 200)
      if (daily.length) {
        const uvSet = new Set()
        daily.forEach((r) => (Array.isArray(r.uv) ? r.uv : []).forEach((u) => uvSet.add(u)))
        todayUv = uvSet.size
        uvNote = '今日埋点 UV'
      } else {
        const behaviors = await fetchCollectionWhere(
          'user_behaviors',
          { timestamp: _.gte(startMs) },
          500
        )
        if (behaviors.length) {
          const uvSet = new Set()
          behaviors.forEach((b) => {
            const uid = b.userId || b._openid
            if (uid) uvSet.add(uid)
          })
          todayUv = uvSet.size
          uvNote = '今日行为 UV'
        }
      }
    } catch (e) {
      console.warn('[RealtimeMonitor] 今日 UV 拉取失败', e?.message)
      uvNote = 'UV 加载失败'
    }

    // 转化率：今日订单 / 今日 UV（有埋点时）；否则用会员总数作分母并标注口径
    const conversionBase = todayUv != null && todayUv > 0 ? todayUv : (data?.members?.total || 0)
    const conversionRate = conversionBase > 0 ? (todayOrders / conversionBase * 100) : 0
    
    stats.value = {
      todayRevenue,
      yesterdayRevenue,
      revenueChange,
      todayOrders,
      yesterdayOrders,
      ordersChange,
      activeUsers: data?.members?.total || 0,
      onlineUsers: todayUv,
      onlineUsersNote: uvNote,
      lowStockCount: data?.inventory?.lowStock || 0,
      outOfStockCount: data?.inventory?.outOfStock || 0,
      conversionRate,
      todayProfit,
      profitMargin
    }

    // 保留订单列表供小时级营收聚合
    cachedOrders.value = data?.orders?.items || []
    
    // 更新订单流（从订单列表获取最新订单，按时间倒序）
    if (data?.orders?.items && data.orders.items.length > 0) {
      const now = Date.now()
      const recentItems = data.orders.items
        .filter(order => {
          const orderTime = order.createTime || order._createTime || 0
          // 只显示最近24小时内的订单
          return now - orderTime < 24 * 60 * 60 * 1000
        })
        .sort((a, b) => {
          const timeA = a.createTime || a._createTime || 0
          const timeB = b.createTime || b._createTime || 0
          return timeB - timeA
        })
        .slice(0, 20)
      
      recentOrders.value = recentItems.map((order, index) => {
        const orderTime = order.createTime || order._createTime || Date.now()
        const isNewOrder = now - orderTime < 5 * 60 * 1000 // 5分钟内的订单标记为新订单
        return {
          id: order._id || `order-${orderTime}-${index}`,
          createTime: orderTime,
          amount: order.totalPrice || order.price || 0,
          description: order.orderNo || `订单 ${order._id?.substring(0, 8) || index + 1}`,
          isNew: isNewOrder && index < 5
        }
      })
      
      // 延迟移除新订单标记
      setTimeout(() => {
        recentOrders.value.forEach(order => {
          order.isNew = false
        })
      }, 5000)
    } else {
      recentOrders.value = []
    }
    
    // 更新Top商品（基于实际订单数据统计销量）
    if (data?.products?.items && data.products.items.length > 0 && data?.orders?.items) {
      const products = data.products.items
      const orders = data.orders.items || []
      
      // 统计每个商品的销量和收入
      const productSales = {}
      orders.forEach(order => {
        if (order.products && Array.isArray(order.products)) {
          order.products.forEach(product => {
            const productId = product.productId || product._id
            if (!productSales[productId]) {
              productSales[productId] = {
                sales: 0,
                revenue: 0
              }
            }
            const quantity = product.quantity || 1
            const price = product.price || 0
            productSales[productId].sales += quantity
            productSales[productId].revenue += price * quantity
          })
        }
      })
      
      // 合并商品信息和销量数据
      const productsWithSales = products.map(product => {
        const salesData = productSales[product._id] || { sales: 0, revenue: 0 }
        return {
          ...product,
          ...salesData
        }
      })
      
      // 按收入排序，取前10个
      topProducts.value = productsWithSales
        .sort((a, b) => (b.revenue || 0) - (a.revenue || 0))
        .slice(0, 10)
        .map((product, index, array) => {
          // 计算趋势（与上一个商品对比，简化处理）
          const prevProduct = index > 0 ? array[index - 1] : null
          const trend = prevProduct && prevProduct.revenue > 0 
            ? ((product.revenue - prevProduct.revenue) / prevProduct.revenue * 100)
            : 0
          
          return {
            id: product._id || `product-${index}`,
            name: product.title || '商品',
            sales: product.sales || 0,
            revenue: product.revenue || 0,
            trend: trend
          }
        })
    } else if (data?.products?.items && data.products.items.length > 0) {
      // 如果没有订单数据，按库存价值排序
      const products = data.products.items
      topProducts.value = products
        .filter(p => p.isOnShelf) // 只统计上架商品
        .sort((a, b) => {
          const valueA = (a.price || 0) * (a.stock || 0)
          const valueB = (b.price || 0) * (b.stock || 0)
          return valueB - valueA
        })
        .slice(0, 10)
        .map((product, index) => ({
          id: product._id || `product-${index}`,
          name: product.title || '商品',
          sales: product.salesCount || 0,
          revenue: (product.price || 0) * (product.salesCount || 0),
          trend: 0 // 无订单数据时趋势为0
        }))
    } else {
      topProducts.value = []
    }
    
    // 更新图表数据（使用真实财务记录）
    updateRevenueChartData()
    
  } catch (error) {
    console.error('[RealtimeMonitor] 刷新数据失败:', error)
    loadError.value = '刷新数据失败: ' + (error.message || '未知错误')
    ElMessage.error(loadError.value)
  } finally {
    loading.value = false
    lastUpdated.value = Date.now()
  }
}

// 更新营收图表数据（财务账本 / 订单真实聚合，无假波动）
const updateRevenueChartData = async (financialData = null) => {
  try {
    revenueEmptyNote.value = ''
    let records = []

    if (revenueChartRange.value === '1h') {
      // 今日订单按小时聚合（无订单级实时流则空态，不造假曲线）
      const now = new Date()
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const paid = (cachedOrders.value || []).filter((order) => {
        const t = order.createTime || order._createTime || 0
        return t >= startOfDay && ['paid', 'shipped', 'received', 'completed'].includes(order.status)
      })
      if (!paid.length) {
        revenueData.value = []
        revenueEmptyNote.value = '今日暂无已支付订单，无法绘制小时营收（待更高频财务流水）'
      } else {
        const byHour = {}
        paid.forEach((order) => {
          const t = order.createTime || order._createTime || 0
          const h = new Date(t).getHours()
          byHour[h] = (byHour[h] || 0) + (Number(order.totalPrice || order.price) || 0)
        })
        const maxH = now.getHours()
        revenueData.value = Array.from({ length: maxH + 1 }, (_, h) => ({
          time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0).getTime(),
          value: byHour[h] || 0
        }))
      }
    } else if (revenueChartRange.value === '24h' || revenueChartRange.value === '7d') {
      const weekData = financialData || await fetchFinancialData({ period: 'week' })
      records = weekData.records || []

      if (records.length > 0) {
        const dailyRevenue = {}
        records.forEach(record => {
          const date = record.date
          if (!dailyRevenue[date]) dailyRevenue[date] = 0
          dailyRevenue[date] += record.revenue || 0
        })
        const sortedDates = Object.keys(dailyRevenue).sort()
        const slice = revenueChartRange.value === '24h' ? sortedDates.slice(-1) : sortedDates.slice(-7)
        // 24h 标签仍用日粒度账本；无日流水时尝试今日订单单点
        if (revenueChartRange.value === '24h' && slice.length === 0) {
          revenueData.value = []
        } else if (revenueChartRange.value === '24h') {
          // 展示最近有数据的日期（日账本）；若仅今日有值也可
          const last7 = sortedDates.slice(-7)
          revenueData.value = last7.map(date => ({
            time: new Date(date + 'T00:00:00').getTime(),
            value: dailyRevenue[date]
          }))
        } else {
          revenueData.value = slice.map(date => ({
            time: new Date(date + 'T00:00:00').getTime(),
            value: dailyRevenue[date]
          }))
        }
      } else {
        revenueData.value = []
        revenueEmptyNote.value = '财务账本暂无记录'
      }
    }

    if (revenueData.value.length === 0 && !revenueEmptyNote.value) {
      revenueEmptyNote.value = '暂无营收趋势数据'
    }

    nextTick(() => {
      drawRevenueChart()
    })
  } catch (error) {
    console.error('[RealtimeMonitor] 更新图表数据失败:', error)
    revenueData.value = []
    revenueEmptyNote.value = '营收趋势加载失败: ' + (error.message || '未知错误')
    ElMessage.error(revenueEmptyNote.value)
    nextTick(() => {
      drawRevenueChart()
    })
  }
}

const chartCssColor = (varName, fallback) => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
    return v || fallback
  } catch {
    return fallback
  }
}

// 绘制营收图表（Canvas + 设计 token 色）
const drawRevenueChart = () => {
  if (!revenueChartCanvas.value || revenueData.value.length === 0) return

  const canvas = revenueChartCanvas.value
  const wrap = revenueChartWrap.value
  const ctx = canvas.getContext('2d')
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  // 与 ResizeObserver 一致使用 client 尺寸，避免与 getBoundingClientRect 差 1px 导致反复触发
  let w = wrap ? Math.floor(wrap.clientWidth) : 0
  let h = wrap ? Math.floor(wrap.clientHeight) : 0
  if (w < 64) w = 320
  if (h < 64) h = 280
  w = Math.min(Math.max(w, 64), 4096)
  h = Math.min(Math.max(h, 120), 900)

  canvas.width = Math.floor(w * dpr)
  canvas.height = Math.floor(h * dpr)
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const width = w
  const height = h
  ctx.clearRect(0, 0, width, height)

  const brand = chartCssColor('--brand-green-500', '#2d6a4f')
  const brandLight = chartCssColor('--brand-green-300', '#52b788')
  const gridColor = chartCssColor('--light-border-subtle', '#e5e2db')
  const textMuted = chartCssColor('--light-text-tertiary', '#9b968d')
  const textBody = chartCssColor('--light-text-secondary', '#6b665d')

  const values = revenueData.value.map((item) => item.value)
  const maxValue = Math.max(...values, 1)
  const minValue = Math.min(...values, 0)
  const range = maxValue - minValue || 1

  const paddingL = 44
  const paddingR = 12
  const paddingT = 16
  const paddingB = 28
  const chartWidth = width - paddingL - paddingR
  const chartHeight = height - paddingT - paddingB
  const stepX = chartWidth / (revenueData.value.length - 1 || 1)

  // 水平参考线
  ctx.strokeStyle = gridColor
  ctx.lineWidth = 1
  const gridLines = 4
  for (let g = 0; g <= gridLines; g++) {
    const gy = paddingT + (chartHeight * g) / gridLines
    ctx.beginPath()
    ctx.moveTo(paddingL, gy)
    ctx.lineTo(width - paddingR, gy)
    ctx.stroke()
  }

  const points = revenueData.value.map((item, index) => {
    const x = paddingL + index * stepX
    const y = paddingT + chartHeight - ((item.value - minValue) / range) * chartHeight
    return { x, y }
  })

  const grad = ctx.createLinearGradient(0, paddingT, 0, height - paddingB)
  grad.addColorStop(0, `${brandLight}33`)
  grad.addColorStop(1, `${brand}00`)

  ctx.beginPath()
  ctx.moveTo(paddingL, height - paddingB)
  points.forEach((p) => ctx.lineTo(p.x, p.y))
  ctx.lineTo(width - paddingR, height - paddingB)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  ctx.beginPath()
  ctx.strokeStyle = brand
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  })
  ctx.stroke()

  ctx.fillStyle = brand
  points.forEach((p) => {
    ctx.beginPath()
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = chartCssColor('--light-bg-elevated', '#fff')
    ctx.lineWidth = 2
    ctx.stroke()
  })

  ctx.strokeStyle = gridColor
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(paddingL, height - paddingB)
  ctx.lineTo(width - paddingR, height - paddingB)
  ctx.stroke()

  ctx.fillStyle = textBody
  ctx.font = '11px var(--font-cn-body), system-ui, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText('¥0', paddingL - 6, height - paddingB + 4)
  if (maxValue > 0) {
    ctx.fillText(`¥${Math.round(maxValue).toLocaleString('zh-CN')}`, paddingL - 6, paddingT + 10)
  }

  ctx.fillStyle = textMuted
  ctx.font = '10px var(--font-cn-body), system-ui, sans-serif'
  ctx.textAlign = 'center'
  const labelCount = Math.min(6, revenueData.value.length)
  const labelStep = Math.max(1, Math.floor(revenueData.value.length / labelCount))
  for (let i = 0; i < revenueData.value.length; i += labelStep) {
    const item = revenueData.value[i]
    const x = paddingL + i * stepX
    const date = new Date(item.time)
    const label =
      revenueData.value.length <= 7
        ? `${date.getMonth() + 1}/${date.getDate()}`
        : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    ctx.fillText(label, x, height - paddingB + 16)
  }

  lastChartDrawSize = { w, h }
}

// 更新图表范围
const updateRevenueChart = () => {
  updateRevenueChartData()
}

// 自动刷新控制
const handleAutoRefreshChange = (value) => {
  if (value) {
    startAutoRefresh()
  } else {
    stopAutoRefresh()
  }
}

const updateRefreshInterval = () => {
  if (isAutoRefresh.value) {
    stopAutoRefresh()
    startAutoRefresh()
  }
}

const startAutoRefresh = () => {
  stopAutoRefresh()
  refreshTimer = setInterval(() => {
    refreshData()
  }, refreshInterval.value * 1000)
}

const stopAutoRefresh = () => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

// 全屏切换（仅大屏根节点，避免整页 DOM 进全屏）
const toggleFullscreen = async () => {
  const el = rootRef.value
  if (!el) return
  try {
    if (!document.fullscreenElement) {
      await el.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  } catch (err) {
    console.error('[RealtimeMonitor] 全屏失败:', err)
    ElMessage.warning('无法进入全屏，请重试或检查浏览器权限')
  }
}

const handleFullscreenChange = () => {
  isFullscreen.value = document.fullscreenElement === rootRef.value
}

// 检查告警
const checkAlerts = () => {
  if (!settings.value.enableAlerts) return
  
  const newAlerts = []
  
  // 营收告警
  if (revenueAlert.value) {
    newAlerts.push({
      id: `revenue-${Date.now()}`,
      level: 'critical',
      title: '营收预警',
      description: `今日营收 ¥${formatNumber(stats.value.todayRevenue)} 低于预警阈值 ¥${formatNumber(settings.value.revenueThreshold)}`,
      time: Date.now(),
      read: false
    })
  }
  
  // 订单告警
  if (ordersAlert.value) {
    newAlerts.push({
      id: `orders-${Date.now()}`,
      level: 'warning',
      title: '订单预警',
      description: `今日订单 ${stats.value.todayOrders} 单低于预警阈值 ${settings.value.ordersThreshold} 单`,
      time: Date.now(),
      read: false
    })
  }
  
  // 库存告警
  if (inventoryAlert.value) {
    newAlerts.push({
      id: `inventory-${Date.now()}`,
      level: 'warning',
      title: '库存预警',
      description: `有 ${stats.value.lowStockCount} 个商品库存不足，需要及时补货`,
      time: Date.now(),
      read: false
    })
  }
  
  // 转化率告警
  if (conversionAlert.value) {
    newAlerts.push({
      id: `conversion-${Date.now()}`,
      level: 'warning',
      title: '转化率预警',
      description: `当前转化率 ${stats.value.conversionRate.toFixed(2)}% 低于目标 ${settings.value.conversionTarget}%`,
      time: Date.now(),
      read: false
    })
  }
  
  // 利润率告警
  if (profitAlert.value) {
    newAlerts.push({
      id: `profit-${Date.now()}`,
      level: 'critical',
      title: '利润率预警',
      description: `当前利润率 ${stats.value.profitMargin.toFixed(2)}% 低于目标 ${settings.value.profitTarget}%`,
      time: Date.now(),
      read: false
    })
  }
  
  // 添加新告警（避免重复）
  newAlerts.forEach(newAlert => {
    const exists = alerts.value.some(a => 
      a.title === newAlert.title && !a.read && (Date.now() - a.time < 60000) // 1分钟内不重复
    )
    if (!exists) {
      alerts.value.unshift(newAlert)
      if (settings.value.enableSound) {
        // 播放提示音（浏览器限制，需要用户交互）
        try {
          const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSyBzvLYiTcIGWi77+efTRAOUKfj8LZjHAY4kdfyzHksBSR3x/DdkEAKFF606euoVRQKRp/g8r5sIQUsgc7y2Ik3CBlou+/nn00QDlCn4/C2YxwGOJHX8sx5LAUkd8fw3ZBACg==')
          audio.volume = 0.3
          audio.play().catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) }) // 忽略错误
        } catch (e) {
          console.warn('无法播放提示音:', e)
        }
      }
    }
  })
  
  // 限制告警数量
  if (alerts.value.length > 50) {
    alerts.value = alerts.value.slice(0, 50)
  }
}

// 处理告警点击
const handleAlertClick = (alert) => {
  alert.read = true
  if (alert.title.includes('库存')) {
    handleInventoryAlert()
  }
}

// 标记所有告警已读
const markAllAlertsRead = () => {
  alerts.value.forEach(alert => {
    alert.read = true
  })
  ElMessage.success('已标记所有告警为已读')
}

// 忽略告警
const dismissAlert = (alertId) => {
  const index = alerts.value.findIndex(a => a.id === alertId)
  if (index > -1) {
    alerts.value.splice(index, 1)
  }
}

// 处理库存告警
const handleInventoryAlert = () => {
  ElMessage.info('跳转到库存管理页面')
  // 这里可以触发路由跳转或打开库存管理对话框
}

// 生命周期
onMounted(() => {
  loadSettings()
  refreshData()
  if (isAutoRefresh.value) {
    startAutoRefresh()
  }

  document.addEventListener('fullscreenchange', handleFullscreenChange)

  nextTick(() => {
    if (revenueChartWrap.value && typeof ResizeObserver !== 'undefined') {
      chartResizeObserver = new ResizeObserver((entries) => {
        const target = entries[0]?.target
        if (!target) return
        const nw = Math.round(target.clientWidth)
        const nh = Math.round(target.clientHeight)
        if (nw < 32 || nh < 32) return
        if (nw === lastChartDrawSize.w && nh === lastChartDrawSize.h) return
        if (chartResizeRaf != null) cancelAnimationFrame(chartResizeRaf)
        chartResizeRaf = requestAnimationFrame(() => {
          chartResizeRaf = null
          drawRevenueChart()
        })
      })
      chartResizeObserver.observe(revenueChartWrap.value)
    }
  })
})

onUnmounted(() => {
  stopAutoRefresh()
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  if (chartResizeRaf != null) {
    cancelAnimationFrame(chartResizeRaf)
    chartResizeRaf = null
  }
  chartResizeObserver?.disconnect()
  chartResizeObserver = null
})

// 监听窗口大小变化，重新绘制图表
watch(() => revenueChartCanvas.value, (newVal) => {
  if (newVal) {
    nextTick(() => {
      drawRevenueChart()
    })
  }
})

// 监听数据变化重绘（避免 deep 监听同一数组内对象抖动导致频繁绘制）
watch(
  () => revenueData.value.map((d) => `${d.time}:${d.value}`).join('|'),
  () => {
    nextTick(() => drawRevenueChart())
  },
)
</script>

<style scoped>
.realtime-monitor {
  padding: var(--space-5) var(--space-6) var(--space-8);
  background: var(--light-bg-primary);
  min-height: 100vh;
  color: var(--light-text-primary);
  box-sizing: border-box;
}

.realtime-monitor--fs {
  overflow: auto;
  background: var(--light-bg-secondary);
}

.realtime-monitor--fs .monitor-title {
  font-size: clamp(1.25rem, 2.2vw, 1.75rem);
}

.monitor-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4) var(--space-6);
  margin-bottom: var(--space-5);
  padding: var(--space-5) var(--space-6);
  background: var(--light-bg-elevated);
  border-radius: var(--radius-xl);
  border: 1px solid var(--light-border-default);
  box-shadow: var(--shadow-sm);
  position: relative;
}
.monitor-load-error {
  margin: 0 0 var(--space-4);
}

.monitor-header::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: var(--radius-xl) 0 0 var(--radius-xl);
  background: linear-gradient(180deg, var(--gold-400), var(--brand-green-500));
  pointer-events: none;
}

.monitor-header-brand {
  position: relative;
  z-index: 1;
  min-width: 0;
  padding-left: var(--space-2);
}

.monitor-hint {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--light-text-tertiary);
  max-width: 520px;
}
.monitor-kicker {
  margin: 0 0 var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.1em;
  color: var(--brand-green-600);
  text-transform: uppercase;
}

.monitor-title {
  margin: 0 0 var(--space-1);
  font-size: var(--text-2xl);
  font-weight: var(--weight-semibold);
  color: var(--brand-green-700);
  letter-spacing: -0.02em;
}

.monitor-meta {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}

.monitor-meta-dot {
  opacity: 0.45;
}

.monitor-header-actions {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  justify-content: flex-end;
}

.monitor-status-tag {
  border-color: var(--light-border-default);
}

.monitor-toolbar {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.monitor-interval {
  width: 112px;
}

.form-hint-muted {
  margin-left: 8px;
  color: var(--light-text-tertiary);
  font-size: 13px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

.kpi-card {
  background: var(--light-bg-elevated);
  border: 1px solid var(--light-border-default);
  border-radius: var(--radius-xl);
  padding: var(--space-5) var(--space-5);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
  position: relative;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 148px;
}

.kpi-card:hover {
  border-color: var(--brand-green-400);
  box-shadow: var(--shadow-md);
}

.kpi-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--brand-green-500);
}

.kpi-card.alert {
  border-color: var(--semantic-error-icon);
  background: var(--semantic-error-bg);
  animation: pulse 2s infinite;
}

.kpi-card.alert::before {
  background: linear-gradient(90deg, var(--semantic-error-icon), transparent);
}

@keyframes pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--semantic-error-icon) 35%, transparent);
  }
  50% {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--semantic-error-icon) 0%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .kpi-card.alert {
    animation: none;
  }
}

.kpi-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.kpi-label {
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  font-weight: 500;
  letter-spacing: 0.3px;
}

.kpi-value {
  font-size: clamp(1.5rem, 3.2vw, var(--text-4xl));
  font-weight: var(--weight-semibold);
  color: var(--brand-green-700);
  margin: var(--space-3) 0;
  line-height: var(--leading-tight);
  font-family: var(--font-mono), var(--font-en-body), ui-monospace, system-ui, sans-serif;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.kpi-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--light-text-tertiary);
  margin-top: 8px;
}

.kpi-change {
  font-weight: 600;
}

.kpi-change.positive {
  color: var(--semantic-success-text);
}

.kpi-change.negative {
  color: var(--semantic-error-text);
}

.pulse-icon {
  animation: pulse-icon 2s infinite;
  color: var(--semantic-success-icon);
}

@keyframes pulse-icon {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.kpi-card .alert-icon {
  color: var(--semantic-error-icon);
  animation: pulse-icon 1s infinite;
}

.charts-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 1fr);
  grid-template-rows: minmax(260px, 1fr) minmax(260px, 1fr) auto;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
  align-items: stretch;
  min-height: 0;
}

.chart-card--revenue {
  grid-column: 1;
  grid-row: 1 / span 2;
}

.chart-card--orders {
  grid-column: 2;
  grid-row: 1;
}

.chart-card--top {
  grid-column: 2;
  grid-row: 2;
}

.alerts-card {
  grid-column: 1 / -1;
  grid-row: 3;
  min-height: 220px;
}

.chart-card {
  background: var(--light-bg-elevated);
  border: 1px solid var(--light-border-default);
  border-radius: var(--radius-xl);
  padding: var(--space-5);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  min-height: 0;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.chart-card:hover {
  border-color: var(--light-border-strong);
  box-shadow: var(--shadow-md);
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--light-border-subtle);
  flex-shrink: 0;
}

.chart-heading h3 {
  margin: 0 0 var(--space-1);
  color: var(--brand-green-700);
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
}

.chart-sub {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  line-height: var(--leading-tight);
}

.chart-range {
  flex-shrink: 0;
}

.chart-container {
  /* 固定可视高度，避免 flex + canvas 百分比高度形成布局反馈导致页面无限增高 */
  flex: 0 0 auto;
  width: 100%;
  min-width: 0;
  height: clamp(280px, 36vh, 440px);
  position: relative;
  overflow: hidden;
  background: var(--light-bg-secondary);
  border-radius: var(--radius-lg);
  border: 1px solid var(--light-border-subtle);
  padding: var(--space-2);
  box-sizing: border-box;
}

.chart-container canvas {
  display: block;
  max-width: 100%;
  /* 高度由脚本按容器 client 尺寸写入，禁止 100% 参与父级高度计算 */
}

.order-stream {
  flex: 1;
  max-height: 420px;
  overflow-y: auto;
  min-height: 240px;
  padding: var(--space-1);
}

.order-item {
  display: flex;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-2);
  background: var(--light-bg-secondary);
  border-radius: var(--radius-md);
  border-left: 3px solid transparent;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
  border: 1px solid var(--light-border-subtle);
}

.order-item:hover {
  background: var(--gold-50);
  border-color: var(--gold-200);
}

.order-item.new {
  border-left-color: var(--brand-green-500);
  background: var(--brand-green-50);
  animation: slide-in 0.45s ease;
}

@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.order-time {
  font-size: 12px;
  color: var(--light-text-tertiary);
  width: 80px;
  flex-shrink: 0;
}

.order-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
}

.order-amount {
  font-size: 17px;
  font-weight: 700;
  color: var(--brand-green-600);
  letter-spacing: 0.3px;
}

.order-desc {
  font-size: 14px;
  color: var(--light-text-secondary);
}

.empty-stream {
  text-align: center;
  padding: 40px;
  color: var(--light-text-tertiary);
}
.chart-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.top-products {
  flex: 1;
  max-height: 420px;
  overflow-y: auto;
  min-height: 240px;
  padding: var(--space-1);
}

.product-item {
  display: flex;
  align-items: center;
  padding: var(--space-3);
  margin-bottom: var(--space-2);
  background: var(--light-bg-secondary);
  border-radius: var(--radius-md);
  border: 1px solid var(--light-border-subtle);
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.product-item:hover {
  background: var(--gold-50);
  border-color: var(--gold-200);
}

.product-rank {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-green-500);
  border-radius: var(--radius-full);
  font-weight: var(--weight-semibold);
  font-size: var(--text-xs);
  color: var(--light-bg-elevated);
  flex-shrink: 0;
  margin-right: var(--space-3);
}

.product-info {
  flex: 1;
}

.product-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--light-text-primary);
  margin-bottom: 4px;
}

.product-stats {
  font-size: var(--text-xs);
  color: var(--light-text-secondary);
  display: flex;
  gap: var(--space-3);
}

.product-bar-track {
  margin-top: var(--space-2);
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--light-bg-tertiary);
  overflow: hidden;
}

.product-bar-fill {
  height: 100%;
  border-radius: var(--radius-full);
  background: linear-gradient(90deg, var(--brand-green-500), var(--brand-green-300));
  transition: width 0.35s ease;
}

.product-trend {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 600;
}

.trend-up {
  color: var(--semantic-success-text);
}

.trend-down {
  color: var(--semantic-error-text);
}

.alerts-list {
  flex: 1;
  max-height: 420px;
  overflow-y: auto;
  min-height: 240px;
  padding: 4px;
}

.alert-item {
  display: flex;
  align-items: flex-start;
  padding: var(--space-4);
  margin-bottom: var(--space-3);
  background: var(--light-bg-secondary);
  border-radius: var(--radius-lg);
  border-left: 4px solid var(--light-border-strong);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
  border: 1px solid var(--light-border-subtle);
}

.alert-item:hover {
  background: var(--light-bg-elevated);
  border-color: var(--light-border-default);
}

.alert-item.critical {
  border-left-color: var(--semantic-error-icon);
  background: linear-gradient(90deg, rgba(245, 108, 108, 0.08) 0%, rgba(245, 108, 108, 0.03) 100%);
  border-left-width: 5px;
}

.alert-item.warning {
  border-left-color: #e6a23c;
  background: linear-gradient(90deg, rgba(230, 162, 60, 0.08) 0%, rgba(230, 162, 60, 0.03) 100%);
  border-left-width: 5px;
}

.alert-item.read {
  opacity: 0.6;
}

.alert-item .alert-icon {
  margin-right: 12px;
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--light-text-secondary);
  animation: none;
}

.alert-content {
  flex: 1;
}

.alert-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--light-text-primary);
  margin-bottom: 4px;
}

.alert-desc {
  font-size: 12px;
  color: var(--light-text-secondary);
  margin-bottom: 4px;
}

.alert-time {
  font-size: 11px;
  color: var(--light-text-tertiary);
}

.alert-actions {
  flex-shrink: 0;
}

.empty-alerts {
  text-align: center;
  padding: 40px;
}

/* 滚动条样式 */
.order-stream::-webkit-scrollbar,
.top-products::-webkit-scrollbar,
.alerts-list::-webkit-scrollbar {
  width: 8px;
}

.order-stream::-webkit-scrollbar-track,
.top-products::-webkit-scrollbar-track,
.alerts-list::-webkit-scrollbar-track {
  background: rgba(240, 240, 240, 0.5);
  border-radius: 4px;
}

.order-stream::-webkit-scrollbar-thumb,
.top-products::-webkit-scrollbar-thumb,
.alerts-list::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #2D6A4F 0%, #245A42 100%);
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.order-stream::-webkit-scrollbar-thumb:hover,
.top-products::-webkit-scrollbar-thumb:hover,
.alerts-list::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, #245A42 0%, #9a7e1a 100%);
}

/* 响应式 */
@media (max-width: 1280px) {
  .charts-grid {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }

  .chart-card--revenue,
  .chart-card--orders,
  .chart-card--top,
  .alerts-card {
    grid-column: auto;
    grid-row: auto;
  }
}

@media (max-width: 768px) {
  .realtime-monitor {
    padding: var(--space-4);
  }

  .monitor-header {
    flex-direction: column;
    align-items: stretch;
    padding: var(--space-4);
  }

  .monitor-header-actions {
    justify-content: space-between;
    width: 100%;
  }

  .monitor-toolbar {
    width: 100%;
    justify-content: flex-end;
  }

  .kpi-grid {
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }

  .kpi-card {
    padding: var(--space-4);
    min-height: 132px;
  }

  .kpi-value {
    font-size: 1.75rem;
  }

  .charts-grid {
    gap: var(--space-3);
  }

  .chart-card {
    padding: var(--space-4);
  }

  .chart-container {
    height: clamp(220px, 40vh, 380px);
  }
}
</style>
