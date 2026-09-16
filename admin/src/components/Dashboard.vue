<template>
  <div class="cockpit" :class="{ 'cockpit--refreshing': loading && ready }">
    <header class="cockpit-header">
      <div class="welcome">
        <h2>经营驾驶舱</h2>
        <p class="subtitle">
          <span v-if="showSkeleton" class="status-dot idle">加载中</span>
          <span v-else :class="['status-dot', businessStatus.tone]">{{ businessStatus.text }}</span>
          <span class="sep">·</span>
          <span>账本与线上分列 · 应捐按门店账本 1%</span>
        </p>
      </div>
      <div class="header-tools">
        <CompanionRobot
          v-if="ready"
          :dashboard-stats="robotStats"
          @ai-action="handleAIAction"
          @navigate="handleNavigate"
        />
        <div class="filters">
          <el-radio-group v-model="rangePreset" size="small" :disabled="loading && !ready" @change="onFilterChange">
            <el-radio-button value="today">今日</el-radio-button>
            <el-radio-button value="7">近7日</el-radio-button>
            <el-radio-button value="30">近30日</el-radio-button>
            <el-radio-button value="mtd">本月</el-radio-button>
          </el-radio-group>
          <el-select
            v-model="storeFilter"
            size="small"
            style="width: 150px"
            :disabled="loading && !ready"
            @change="onFilterChange"
          >
            <el-option label="全部门店" value="all" />
            <el-option
              v-for="s in storeOptions"
              :key="s.value"
              :label="s.label"
              :value="s.value"
            />
          </el-select>
          <el-button type="primary" size="small" :loading="loading" @click="refreshAll">
            刷新
          </el-button>
          <span class="clock"><el-icon><Clock /></el-icon> {{ currentTime }}</span>
        </div>
      </div>
    </header>

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      class="notes-alert load-error-alert"
    >
      <template #title>
        <div class="load-error-row">
          <span>{{ loadError }}</span>
          <el-button type="danger" size="small" plain :loading="loading" @click="refreshAll">
            重试
          </el-button>
        </div>
      </template>
    </el-alert>

    <el-alert
      v-if="ready && dataNotes.length"
      type="info"
      :closable="false"
      show-icon
      class="notes-alert"
    >
      <template #title>
        <span class="notes-inline">{{ dataNotes.join('；') }}</span>
      </template>
    </el-alert>

    <!-- 首屏骨架：壳 + 分区标题立即可见，避免奶油底「假白屏」 -->
    <div v-if="showSkeleton" class="cockpit-skeleton" aria-busy="true" aria-live="polite">
      <div class="skel-banner">
        <span class="skel-spinner" aria-hidden="true" />
        <span>正在聚合经营数据…</span>
      </div>
      <section class="section">
        <div class="section-head">
          <h3>营收与承诺</h3>
          <span class="muted tiny">加载中</span>
        </div>
        <div class="kpi-row">
          <div v-for="n in 5" :key="'sk-kpi-' + n" class="kpi skel-kpi" :class="{ 'kpi-gold': n === 1 }">
            <div class="skel-line skel-w40" />
            <div class="skel-line skel-w70 skel-lg" />
            <div class="skel-line skel-w55" />
          </div>
        </div>
      </section>
      <el-row :gutter="16" class="mid-row">
        <el-col :xs="24" :lg="15">
          <el-card shadow="never" class="panel">
            <template #header>
              <div class="panel-head"><span>趋势 · {{ rangeLabel }}</span></div>
            </template>
            <div class="chart-box skel-chart">
              <div class="skel-chart-bars">
                <span v-for="n in 8" :key="'bar-' + n" :style="{ height: 30 + (n % 5) * 18 + '%' }" />
              </div>
            </div>
          </el-card>
          <el-card shadow="never" class="panel" style="margin-top: 16px">
            <template #header>
              <div class="panel-head"><span>结构占比</span></div>
            </template>
            <div class="skel-mix-row">
              <div class="skel-donut" />
              <div class="skel-donut" />
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :lg="9">
          <el-card shadow="never" class="panel">
            <template #header>
              <div class="panel-head"><span>业务分区</span></div>
            </template>
            <div v-for="n in 4" :key="'sk-biz-' + n" class="biz-block skel-biz">
              <div class="skel-line skel-w45" />
              <div class="skel-line skel-w90" />
              <div class="skel-line skel-w60" />
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <template v-if="ready">
    <!-- 营收头条 -->
    <section class="section">
      <div class="section-head">
        <h3>营收与承诺</h3>
        <el-button link type="primary" @click="go('2')">营收账本</el-button>
      </div>
      <div class="kpi-row">
        <button type="button" class="kpi kpi-gold" @click="go('2')">
          <div class="kpi-label">综合营收</div>
          <div class="kpi-value">¥{{ fmt(headline.grandTotal) }}</div>
          <div class="kpi-sub">线上净额 + 账本净额 · {{ rangeLabel }}</div>
        </button>
        <button type="button" class="kpi" @click="go('2')">
          <div class="kpi-label">营收账本净额</div>
          <div class="kpi-value accent">¥{{ fmt(headline.ledgerNet) }}</div>
          <div class="kpi-sub">
            {{ headline.ledgerOrders || 0 }} 单
            <span v-if="headline.ledgerEmpty" class="muted"> · 账本空态</span>
            <span v-else-if="storeFilter === 'all'"> · 双店合计</span>
          </div>
        </button>
        <button type="button" class="kpi" @click="go('3')">
          <div class="kpi-label">小程序毛 GMV</div>
          <div class="kpi-value">¥{{ fmt(headline.gmvPaid) }}</div>
          <div class="kpi-sub">
            净额 ¥{{ fmt(headline.netOnline) }} · 退款 ¥{{ fmt(headline.refundAmount) }}
          </div>
        </button>
        <button type="button" class="kpi kpi-donate" @click="go('2')">
          <div class="kpi-label">应捐 1%</div>
          <div class="kpi-value">¥{{ fmt(headline.donationLedger) }}</div>
          <div class="kpi-sub">
            账本口径 · 综合对照 ¥{{ fmt(headline.donationGrand) }}
          </div>
        </button>
        <button type="button" class="kpi" @click="go('4')">
          <div class="kpi-label">会员 / 金粉兑换</div>
          <div class="kpi-value">{{ stats.totalUsers }}</div>
          <div class="kpi-sub">
            新会员 +{{ stats.newUsers }} · 兑换 {{ headline.exchangeCount }} 单
          </div>
        </button>
      </div>
    </section>

    <section class="section" v-if="headline.ledgerByStore?.length && storeFilter === 'all'">
      <div class="section-head">
        <h3>门店账本分列</h3>
        <span class="muted tiny">山川造物 + 星宸标本 · 净额占比</span>
      </div>
      <div class="store-split-row">
        <div class="store-split-card" v-for="s in headline.ledgerByStore" :key="s.storeId">
          <div class="store-split-head">
            <span class="store-split-name">{{ s.name }}</span>
            <span class="store-split-pct">{{ s.pct }}%</span>
          </div>
          <div class="store-split-track">
            <div class="store-split-fill" :style="{ width: Math.max(s.pct || 0, 0) + '%' }"></div>
          </div>
          <div class="store-split-val">¥{{ fmt(s.value) }}</div>
        </div>
      </div>
    </section>

    <el-row :gutter="16" class="mid-row">
      <el-col :xs="24" :lg="15">
        <el-card shadow="never" class="panel">
          <template #header>
            <div class="panel-head">
              <span>趋势 · {{ rangeLabel }}</span>
              <el-radio-group v-model="chartMode" size="small">
                <el-radio-button value="dual">账本+线上</el-radio-button>
                <el-radio-button value="ledger">仅账本</el-radio-button>
                <el-radio-button value="online">仅线上</el-radio-button>
              </el-radio-group>
            </div>
          </template>
          <div class="chart-box">
            <div v-if="chartEmpty && !loading" class="chart-empty">
              <div class="chart-empty-title">所选区间暂无营收</div>
              <div class="chart-empty-desc">请到营收账本录入日报，或确认小程序订单已支付入账。</div>
            </div>
            <canvas ref="trendCanvas" :class="{ dimmed: chartEmpty && !loading }"></canvas>
          </div>
        </el-card>

        <el-card shadow="never" class="panel" style="margin-top: 16px">
          <template #header>
            <div class="panel-head">
              <span>结构占比</span>
              <span class="muted tiny">已付订单来源 / 品类（采样内）</span>
            </div>
          </template>
          <el-row :gutter="12">
            <el-col :span="12">
              <div class="chart-box chart-box-sm">
                <div v-if="mixEmpty" class="chart-empty compact">暂无结构数据</div>
                <canvas ref="mixCanvas"></canvas>
              </div>
            </el-col>
            <el-col :span="12">
              <div class="chart-box chart-box-sm">
                <div v-if="catEmpty" class="chart-empty compact">暂无品类数据</div>
                <canvas ref="catCanvas"></canvas>
              </div>
            </el-col>
          </el-row>
        </el-card>

        <!-- C 端脉搏 -->
        <el-card shadow="never" class="panel" style="margin-top: 16px">
          <template #header>
            <div class="panel-head">
              <span>C 端脉搏</span>
              <el-button link type="primary" @click="go('44')">行为看板</el-button>
            </div>
          </template>
          <div class="pulse-grid">
            <button type="button" class="pulse-card" @click="go('44')">
              <div class="p-lbl">AI 鉴定（今日）</div>
              <div class="p-val">{{ miniapp.identifyToday }}</div>
              <div class="p-sub">成功率 {{ miniapp.identifySuccessRate }}%</div>
            </button>
            <button type="button" class="pulse-card" @click="go('38')">
              <div class="p-lbl">定制询单</div>
              <div class="p-val">{{ miniapp.customSubmitsToday }}</div>
              <div class="p-sub">伴宠 {{ miniapp.petSubmitsToday }}</div>
            </button>
            <button type="button" class="pulse-card" @click="go('40')">
              <div class="p-lbl">客服工单</div>
              <div class="p-val">{{ miniapp.supportToday }}</div>
              <div class="p-sub">主动求助</div>
            </button>
            <button type="button" class="pulse-card" @click="go('37')">
              <div class="p-lbl">到店签到</div>
              <div class="p-val">{{ miniapp.storeCheckinToday }}</div>
              <div class="p-sub">线下转化</div>
            </button>
            <button type="button" class="pulse-card" @click="go('44')">
              <div class="p-lbl">总事件</div>
              <div class="p-val">{{ miniapp.eventsToday }}</div>
              <div class="p-sub">埋点上报</div>
            </button>
            <button type="button" class="pulse-card" @click="go('44')">
              <div class="p-lbl">活跃 UV</div>
              <div class="p-val">{{ miniapp.uvToday }}</div>
              <div class="p-sub">独立 openid</div>
            </button>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="24" :lg="9">
        <!-- 业务分区卡片 -->
        <el-card shadow="never" class="panel">
          <template #header>
            <div class="panel-head">
              <span>业务分区</span>
              <el-button link type="primary" @click="showInsightsDialog = true">数据洞察</el-button>
            </div>
          </template>

          <div class="biz-block" @click="go('72')">
            <div class="biz-title">
              <span>售罄孤品定金</span>
              <el-tag size="small" type="warning" effect="plain">{{ deposit.openPipeline }} 进行中</el-tag>
            </div>
            <div class="biz-grid">
              <div><b>{{ deposit.counts.intent + deposit.counts.pending_pay }}</b><span>意向/待付</span></div>
              <div><b>{{ deposit.counts.deposit_paid }}</b><span>已付定金</span></div>
              <div><b>{{ deposit.counts.awaiting_balance }}</b><span>待尾款</span></div>
              <div class="warn"><b>{{ deposit.counts.overdue }}</b><span>逾期</span></div>
            </div>
            <div class="biz-foot">已付定金合计 ¥{{ fmt(deposit.paidDepositYuan) }}</div>
          </div>

          <div class="biz-block" @click="go('74')">
            <div class="biz-title">
              <span>标本师提成</span>
              <el-tag size="small" effect="plain">台账</el-tag>
            </div>
            <div class="biz-grid cols-3">
              <div><b>¥{{ fmt(commission.netAmount) }}</b><span>净佣金</span></div>
              <div><b>¥{{ fmt(commission.earnAmount) }}</b><span>入账 {{ commission.earnCount }}</span></div>
              <div><b>¥{{ fmt(commission.reverseAmount) }}</b><span>冲销 {{ commission.reverseCount }}</span></div>
            </div>
          </div>

          <div class="biz-block" @click="openGiftBoard">
            <div class="biz-title">
              <span>礼赠履约待办</span>
              <el-tag size="small" type="danger" effect="plain" v-if="gift.todo > 0">{{ gift.todo }}</el-tag>
            </div>
            <div class="biz-grid">
              <div><b>{{ gift.awaiting_address }}</b><span>待填址</span></div>
              <div><b>{{ gift.awaiting_ship }}</b><span>待发货</span></div>
              <div><b>{{ gift.pickup_verify }}</b><span>自提核销</span></div>
              <div><b>{{ gift.done }}</b><span>已完成</span></div>
            </div>
          </div>

          <div class="biz-block" @click="go('75')">
            <div class="biz-title">
              <span>生日礼</span>
              <el-tag size="small" :type="birthday.enabled ? 'success' : 'info'" effect="plain">
                {{ birthday.enabled ? '已启用' : '未启用 / 未读到' }}
              </el-tag>
            </div>
            <div class="biz-foot">
              {{ birthday.name || '跳转配置页 · 会员生日当天可领' }}
            </div>
          </div>
        </el-card>

        <el-card shadow="never" class="panel" style="margin-top: 16px">
          <template #header>
            <div class="panel-head">
              <span>待办摘要</span>
              <span class="todo-total" :class="{ hot: stats.totalTodos > 0 }">{{ stats.totalTodos }}</span>
            </div>
          </template>
          <div class="todo-list">
            <button
              v-for="item in todoItems"
              :key="item.key"
              type="button"
              class="todo-item"
              :class="{ active: item.count > 0 }"
              @click="item.action()"
            >
              <div class="todo-text">
                <div class="t-title">{{ item.title }}</div>
                <div class="t-desc">{{ item.desc }}</div>
              </div>
              <div class="todo-num" :class="{ warn: item.warn }">{{ item.count }}</div>
            </button>
          </div>
          <div class="insights-preview" v-if="insights.trend || insights.alert">
            <div class="insight-item" v-if="insights.trend">
              <el-icon class="insight-icon"><DataAnalysis /></el-icon>
              <div>
                <div class="insight-title">{{ insights.trend.title }}</div>
                <div class="insight-desc">{{ insights.trend.desc }}</div>
              </div>
            </div>
            <div class="insight-item alert" v-if="insights.alert">
              <el-icon class="insight-icon"><WarningFilled /></el-icon>
              <div>
                <div class="insight-title">{{ insights.alert.title }}</div>
                <div class="insight-desc">{{ insights.alert.desc }}</div>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <section class="section quick">
      <h3>快捷入口</h3>
      <div class="action-grid">
        <el-button @click="go('1')">藏品库</el-button>
        <el-button @click="go('2')">记一笔账</el-button>
        <el-button @click="go('3')">订单履约</el-button>
        <el-button @click="go('72')">定金管理</el-button>
        <el-button @click="go('74')">标本师提成</el-button>
        <el-button @click="openGiftBoard">礼赠履约</el-button>
        <el-button @click="go('75')">生日礼</el-button>
        <el-button @click="go('6')">权益营销</el-button>
        <el-button @click="go('4')">会员经营</el-button>
        <el-button @click="go('44')">行为洞察</el-button>
      </div>
    </section>

    <el-dialog
      v-model="showInsightsDialog"
      title="数据洞察"
      width="720px"
      :close-on-click-modal="false"
    >
      <div class="insights-dialog-body">
        <p v-if="insights.trend"><strong>{{ insights.trend.title }}</strong> — {{ insights.trend.desc }}</p>
        <p v-if="insights.alert"><strong>{{ insights.alert.title }}</strong> — {{ insights.alert.desc }}</p>
        <ul>
          <li v-for="(n, i) in dataNotes" :key="i">{{ n }}</li>
        </ul>
        <p class="muted">口径：线上与账本分列，避免把账本 online 渠道再加进小程序 GMV；兑换单不计 GMV，单独计「金粉兑换」。</p>
      </div>
      <template #footer>
        <el-button @click="showInsightsDialog = false">关闭</el-button>
        <el-button type="primary" @click="refreshAll">重新聚合</el-button>
      </template>
    </el-dialog>
    </template>
  </div>
</template>

<script setup>
import { safeWarn } from '../utils/safeStorage.js'
import { reactive, ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import {
  Clock,
  DataAnalysis,
  WarningFilled,
} from '@element-plus/icons-vue'
import {
  cdnCount,
  fetchCollectionLimit,
  fetchCollectionWhere,
  getCdnDatabase,
  callCloudFunction,
} from '../cloud'
import Chart from 'chart.js/auto'
import CompanionRobot from './CompanionRobot.vue'
import { ElMessage } from 'element-plus'
import { setHubSection } from '../utils/moduleAliases'
import { loadStoreBundle } from '../utils/storeStorage'
import {
  resolveRangePreset,
  loadLedgerRecords,
  filterLedgerByRange,
  summarizeLedger,
  summarizeLedgerByStore,
  aggregateOrders,
  mapAnalyticsOrdersToAgg,
  summarizeDepositIntents,
  donationFrom,
  fmtYuan,
  categoryLabel,
  ORDER_SCAN_MAX,
  todayBizDate,
} from '../utils/dashboardMetrics'
// 读本机账本前先「只读取新」：见 refreshAll 里的说明
import { ensureLedgerFresh } from '../utils/financialData.js'

const emit = defineEmits(['switch-tab'])

const loading = ref(false)
/** 至少成功聚合过一次后才展示正式 KPI，避免零值卡片造成假白屏 */
const ready = ref(false)
const loadError = ref('')
const showSkeleton = computed(() => loading.value && !ready.value)
const currentTime = ref(new Date().toLocaleTimeString())
const rangePreset = ref('7')
const storeFilter = ref('all')
const chartMode = ref('dual')
const chartEmpty = ref(false)
const mixEmpty = ref(true)
const catEmpty = ref(true)
const showInsightsDialog = ref(false)
const dataNotes = ref([])
const trendCanvas = ref(null)
const mixCanvas = ref(null)
const catCanvas = ref(null)
let trendChart = null
let mixChart = null
let catChart = null
let clockTimer = null

const storeOptions = ref([])

const headline = reactive({
  grandTotal: 0,
  ledgerNet: 0,
  ledgerOrders: 0,
  ledgerEmpty: true,
  ledgerByStore: [],
  gmvPaid: 0,
  netOnline: 0,
  refundAmount: 0,
  donationLedger: 0,
  donationGrand: 0,
  exchangeCount: 0,
  aov: 0,
})

const stats = reactive({
  totalUsers: 0,
  newUsers: 0,
  pendingOrders: 0,
  refunding: 0,
  lowStock: 0,
  totalTodos: 0,
  pendingBookings: 0,
  pendingCustom: 0,
  pendingPet: 0,
  pendingTickets: 0,
  pendingComments: 0,
  seckillActive: 0,
  seckillExpired: 0,
  groupProducts: 0,
  todaySales: 0,
})

const deposit = reactive({
  counts: {
    intent: 0,
    pending_pay: 0,
    deposit_paid: 0,
    awaiting_balance: 0,
    settled: 0,
    forfeited_open: 0,
    cancelled: 0,
    overdue: 0,
    other: 0,
  },
  paidDepositYuan: 0,
  openPipeline: 0,
  available: false,
})

const commission = reactive({
  netAmount: 0,
  earnAmount: 0,
  earnCount: 0,
  reverseAmount: 0,
  reverseCount: 0,
  available: false,
})

const gift = reactive({
  awaiting_address: 0,
  awaiting_ship: 0,
  pickup_verify: 0,
  done: 0,
  todo: 0,
  available: false,
})

const birthday = reactive({
  enabled: false,
  name: '',
})

const miniapp = reactive({
  eventsToday: 0,
  uvToday: 0,
  identifyToday: 0,
  identifySuccessRate: 0,
  customSubmitsToday: 0,
  petSubmitsToday: 0,
  supportToday: 0,
  storeCheckinToday: 0,
})

const insights = reactive({ trend: null, alert: null })

const chartState = reactive({
  labels: [],
  ledger: [],
  online: [],
  mix: [],
  categories: [],
})

const rangeLabel = computed(() => resolveRangePreset(rangePreset.value).label)

const businessStatus = computed(() => {
  const v = headline.grandTotal || stats.todaySales
  if (v > 5000) return { text: '生意火爆', tone: 'hot' }
  if (v > 1000) return { text: '平稳运行', tone: 'ok' }
  return { text: '待升温', tone: 'idle' }
})

const robotStats = computed(() => ({
  todaySales: headline.netOnline || headline.ledgerNet,
  todayOrderCount: headline.ledgerOrders,
  monthSales: headline.grandTotal,
  totalTodos: stats.totalTodos,
  lowStock: stats.lowStock,
}))

const todoItems = computed(() => [
  {
    key: 'ship',
    title: '待发货订单',
    desc: '已付待履约',
    count: stats.pendingOrders,
    action: () => go('3'),
  },
  {
    key: 'gift',
    title: '礼赠待办',
    desc: '填址 / 发货 / 自提',
    count: gift.todo,
    action: () => openGiftBoard(),
  },
  {
    key: 'deposit',
    title: '定金逾期/待尾款',
    desc: '孤品定金漏斗',
    count: deposit.counts.overdue || deposit.counts.awaiting_balance,
    warn: deposit.counts.overdue > 0,
    action: () => go('72'),
  },
  {
    key: 'book',
    title: '待核销预约',
    desc: '门票 / 课程',
    count: stats.pendingBookings,
    action: () => go('37'),
  },
  {
    key: 'custom',
    title: '定制询单',
    desc: '待报价',
    count: stats.pendingCustom,
    action: () => go('38'),
  },
  {
    key: 'pet',
    title: '伴宠审核',
    desc: '宠物纪念',
    count: stats.pendingPet,
    action: () => go('39'),
  },
  {
    key: 'ticket',
    title: '山海有信',
    desc: '待回复工单',
    count: stats.pendingTickets,
    action: () => go('40'),
  },
  {
    key: 'refund',
    title: '售后/退款',
    desc: '需审核',
    count: stats.refunding,
    action: () => go('42'),
  },
  {
    key: 'stock',
    title: '库存预警',
    desc: '库存不足 3 件',
    count: stats.lowStock,
    warn: stats.lowStock > 0,
    action: () => go('1'),
  },
  {
    key: 'seckill',
    title: '秒杀过期',
    desc: '仍开启但已过期',
    count: stats.seckillExpired,
    warn: stats.seckillExpired > 0,
    action: () => openPromoArchive('seckill_expired'),
  },
])

function fmt(n) {
  return fmtYuan(n)
}

function go(id) {
  emit('switch-tab', String(id))
}

function openGiftBoard() {
  setHubSection('6', 'gift-board')
  go('6')
}

function openPromoArchive(filter) {
  try {
    sessionStorage.setItem('sc_archive_promo_filter', filter)
  } catch (e) { safeWarn('Dashboard 会话存储写入失败（已忽略）', e) }
  go('1')
}

function handleAIAction(action) {
  if (action === 'analyze' || action === 'report') showInsightsDialog.value = true
  else ElMessage.info('正在生成建议…')
}

function handleNavigate(target) {
  if (target) go(target)
}

function onFilterChange() {
  refreshAll()
}

function refreshStoreOptions() {
  const bundle = loadStoreBundle()
  const stores = Array.isArray(bundle?.stores) ? bundle.stores : []
  storeOptions.value = stores.map((s) => ({
    value: String(s.storeId || s.id || ''),
    label: s.name || s.storeId || s.id,
  })).filter((s) => s.value)
}

async function safeCdnCount(coll, where = null) {
  try {
    return await cdnCount(coll, where)
  } catch (e) {
    console.warn(`[Cockpit] count ${coll}`, e?.message)
    return 0
  }
}

async function loadOpsModules() {
  const notes = []

  // 定金
  try {
    const res = await callCloudFunction('manageDeposit', {
      action: 'listIntents',
      status: 'all',
      limit: 100,
    })
    if (res && res.success !== false) {
      const sum = summarizeDepositIntents(res.list || [])
      Object.assign(deposit, { ...sum, available: true })
    } else {
      notes.push('定金意向暂不可用（manageDeposit）')
    }
  } catch (e) {
    notes.push('定金模块未连通')
    console.warn('[Cockpit] deposit', e?.message)
  }

  // 提成
  try {
    const res = await callCloudFunction('manageArtisanCommission', { action: 'getSummary' })
    const s = (res && (res.summary || res)) || {}
    if (res && res.success !== false) {
      Object.assign(commission, {
        netAmount: Number(s.netAmount) || 0,
        earnAmount: Number(s.earnAmount) || 0,
        earnCount: Number(s.earnCount) || 0,
        reverseAmount: Number(s.reverseAmount) || 0,
        reverseCount: Number(s.reverseCount) || 0,
        available: true,
      })
    } else {
      notes.push('标本师提成汇总暂不可用')
    }
  } catch (e) {
    notes.push('提成模块未连通')
    console.warn('[Cockpit] commission', e?.message)
  }

  // 礼赠
  try {
    const res = await callCloudFunction('manageGift', {
      action: 'listBoard',
      bucket: 'awaiting_address',
      page: 1,
      pageSize: 1,
    })
    if (res && res.success !== false) {
      const c = res.counts || {}
      gift.awaiting_address = Number(c.awaiting_address) || 0
      gift.awaiting_ship = Number(c.awaiting_ship) || 0
      gift.pickup_verify = Number(c.pickup_verify) || 0
      gift.done = Number(c.done) || 0
      gift.todo = gift.awaiting_address + gift.awaiting_ship + gift.pickup_verify
      gift.available = true
    } else {
      notes.push('礼赠履约看板暂不可用')
    }
  } catch (e) {
    notes.push('礼赠模块未连通')
    console.warn('[Cockpit] gift', e?.message)
  }

  // 生日礼配置（只读）
  try {
    const res = await callCloudFunction('manageBirthdayGift', { action: 'get' })
    const cfg = (res && (res.config || res.data || res)) || {}
    if (res && res.success !== false) {
      birthday.enabled = cfg.enabled !== false
      birthday.name = cfg.name || cfg.title || ''
    }
  } catch (e) {
    console.warn('[Cockpit] birthday', e?.message)
  }

  return notes
}

async function loadMiniappPulse() {
  const todayStr = todayBizDate()
  const startMs = new Date(`${todayStr}T00:00:00+08:00`).getTime()
  const cdnDb = await getCdnDatabase()
  const _ = cdnDb.command

  const applyPulseFromRows = (rows) => {
    const sum = (action) =>
      rows.filter((r) => r.action === action).reduce((s, r) => s + (r.count || 0), 0)
    const allUv = new Set()
    let total = 0
    rows.forEach((r) => {
      total += r.count || 0
      ;(r.uv || []).forEach((u) => allUv.add(u))
    })
    const idStart = sum('identify_start')
    const idSuccess = sum('identify_success')
    miniapp.eventsToday = total
    miniapp.uvToday = allUv.size
    miniapp.identifyToday = idStart
    miniapp.identifySuccessRate = idStart > 0 ? Math.round((idSuccess / idStart) * 100) : 0
    miniapp.customSubmitsToday = sum('custom_order_submit') + sum('custom_inquiry_submit')
    miniapp.petSubmitsToday = sum('pet_memorial_submit')
    miniapp.supportToday =
      sum('support_ticket_submit') + sum('support_call') + sum('support_wechat_contact')
    miniapp.storeCheckinToday = sum('store_checkin')
  }

  try {
    const rows = await fetchCollectionWhere('analytics_daily', { dateKey: todayStr }, 200)
    if (rows.length) {
      applyPulseFromRows(rows)
      return
    }
  } catch (e) {
    console.warn('analytics_daily', e?.message)
  }

  try {
    const events = await fetchCollectionWhere('user_behaviors', { timestamp: _.gte(startMs) }, 500)
    const cnt = (action) => events.filter((e) => e.action === action).length
    miniapp.eventsToday = events.length
    miniapp.uvToday = new Set(events.map((e) => e.userId).filter(Boolean)).size
    const idStart = cnt('identify_start')
    const idSuccess = cnt('identify_success')
    miniapp.identifyToday = idStart
    miniapp.identifySuccessRate = idStart > 0 ? Math.round((idSuccess / idStart) * 100) : 0
    miniapp.customSubmitsToday = cnt('custom_order_submit') + cnt('custom_inquiry_submit')
    miniapp.petSubmitsToday = cnt('pet_memorial_submit')
    miniapp.supportToday =
      cnt('support_ticket_submit') + cnt('support_call') + cnt('support_wechat_contact')
    miniapp.storeCheckinToday = cnt('store_checkin')
  } catch (e) {
    console.warn('user_behaviors', e?.message)
  }
}

function buildInsights(ledgerSum, orderAgg) {
  const daily = orderAgg.daily || []
  const last = daily[daily.length - 1]
  const prev = daily[daily.length - 2]
  const todayOnline = last?.gmvPaid || 0
  const yOnline = prev?.gmvPaid || 0
  const dir = todayOnline >= yOnline ? '升' : '降'
  const pct =
    yOnline > 0 ? Math.abs(((todayOnline - yOnline) / yOnline) * 100).toFixed(1) : '—'
  insights.trend = {
    title: `${rangeLabel.value}趋势`,
    desc: `账本 ¥${fmt(ledgerSum.revenue)} · 线上毛 GMV ¥${fmt(orderAgg.totals.gmvPaid)}；末日较前一日线上${dir} ${pct}%`,
  }
  const alerts = []
  if (stats.totalTodos > 0) alerts.push(`待办 ${stats.totalTodos}`)
  if (deposit.counts.overdue > 0) alerts.push(`定金逾期 ${deposit.counts.overdue}`)
  if (gift.todo > 0) alerts.push(`礼赠待办 ${gift.todo}`)
  if (stats.lowStock > 0) alerts.push(`库存预警 ${stats.lowStock}`)
  insights.alert = alerts.length
    ? { title: '待关注', desc: alerts.join('；') }
    : null
}

function renderCharts() {
  const labels = chartState.labels
  const ledger = chartState.ledger
  const online = chartState.online

  const showLedger = chartMode.value === 'dual' || chartMode.value === 'ledger'
  const showOnline = chartMode.value === 'dual' || chartMode.value === 'online'
  chartEmpty.value =
    (!showLedger || ledger.every((v) => !v)) && (!showOnline || online.every((v) => !v))

  const datasets = []
  if (showLedger) {
    datasets.push({
      label: '营收账本',
      data: ledger,
      borderColor: '#2D5A3F',
      backgroundColor: 'rgba(45, 90, 63, 0.12)',
      borderWidth: 2,
      tension: 0.35,
      fill: true,
      pointRadius: 3,
    })
  }
  if (showOnline) {
    datasets.push({
      label: '小程序毛 GMV',
      data: online,
      borderColor: '#C4A76C',
      backgroundColor: 'rgba(196, 167, 108, 0.15)',
      borderWidth: 2,
      tension: 0.35,
      fill: true,
      pointRadius: 3,
    })
  }

  if (trendChart) trendChart.destroy()
  if (trendCanvas.value) {
    trendChart = new Chart(trendCanvas.value, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: datasets.length > 1, position: 'bottom' } },
        scales: {
          y: { beginAtZero: true, grid: { color: '#E8E5DE' } },
          x: { grid: { display: false } },
        },
      },
    })
  }

  const mix = chartState.mix.filter((x) => x.value > 0)
  mixEmpty.value = !mix.length
  if (mixChart) mixChart.destroy()
  if (mixCanvas.value && mix.length) {
    mixChart = new Chart(mixCanvas.value, {
      type: 'doughnut',
      data: {
        labels: mix.map((m) => m.label),
        datasets: [
          {
            data: mix.map((m) => m.value),
            backgroundColor: ['#2D5A3F', '#C4A76C', '#7B68AE', '#5B8FB9', '#8B6F47'],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
      },
    })
  }

  const cats = chartState.categories.filter((x) => x.value > 0)
  catEmpty.value = !cats.length
  if (catChart) catChart.destroy()
  if (catCanvas.value && cats.length) {
    catChart = new Chart(catCanvas.value, {
      type: 'doughnut',
      data: {
        labels: cats.map((c) => c.label),
        datasets: [
          {
            data: cats.map((c) => c.value),
            backgroundColor: ['#52B788', '#7B68AE', '#6DA34D', '#5B8FB9', '#C4A76C', '#8B6F47', '#A09A90'],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
      },
    })
  }
}

const refreshAll = async () => {
  loading.value = true
  loadError.value = ''
  const notes = []
  try {
    refreshStoreOptions()
    const range = resolveRangePreset(rangePreset.value)
    const storeId = storeFilter.value

    // 读本机账本**之前**先做一次「只读取新」（云端 finance_records → 本机缓存）。
    // 不做的话，来自本机账本的数字会停在过期/空的缓存上 —— 实测清空 localStorage 后
    // 云端有 308 行账本，而本页「近7日趋势」显示「账本 ¥0」，同屏却又有云端口径的
    // 「营收账本净额 ¥35,329.44」，两个数字互相矛盾。只读：绝不回写云端。
    await ensureLedgerFresh()

    // 1) 账本（本地）— 先填壳，缩短空白感
    const allLedger = loadLedgerRecords()
    const ledgerRows = filterLedgerByRange(allLedger, {
      startDate: range.startDate,
      endDate: range.endDate,
      storeId,
    })
    const ledgerSum = summarizeLedger(ledgerRows)
    const bundle = loadStoreBundle()
    headline.ledgerNet = ledgerSum.revenue
    headline.ledgerOrders = ledgerSum.orderCount
    headline.ledgerEmpty = ledgerRows.length === 0
    headline.ledgerByStore =
      storeId === 'all' ? summarizeLedgerByStore(ledgerRows, bundle) : []
    if (headline.ledgerEmpty) notes.push('所选区间营收账本为空')

    // 2) 线上订单：优先 getAnalyticsDashboard 全量口径；失败再回退 CDN 采样
    let orderAgg = null
    let analyticsNewUsers = null
    try {
      const fnPayload = {
        action: 'report',
        startDate: range.startDate,
        endDate: range.endDate,
      }
      if (storeId && storeId !== 'all') fnPayload.storeId = storeId
      const res = await callCloudFunction('getAnalyticsDashboard', fnPayload)
      if (res && res.success !== false && res.data?.orders) {
        orderAgg = mapAnalyticsOrdersToAgg(res.data.orders)
        const fnNotes = (res.data.notes || orderAgg.notes || []).filter(Boolean)
        // 只保留与线上 GMV / 采样相关的短提示，避免刷屏
        fnNotes
          .filter((n) => /采样|门店范围|毛 GMV|周期退款|兑换|门店账本/.test(String(n)))
          .slice(0, 3)
          .forEach((n) => notes.push(String(n)))
        if (!fnNotes.some((n) => /采样/.test(String(n)))) {
          notes.push('线上 GMV 来自 getAnalyticsDashboard 全量口径')
        }
        if (res.data.users && res.data.users.totalNewUsers != null) {
          analyticsNewUsers = Number(res.data.users.totalNewUsers) || 0
        }
        // 与小程序对齐：优先用云函数双店账本净额 + 分店占比
        const cloudOffline = Number(
          res.data.headline?.offlineLedger ?? res.data.orders?.totals?.offlineLedger,
        )
        const cloudByStore = res.data.ledgerByStore || res.data.headline?.ledgerByStore || []
        if (Number.isFinite(cloudOffline) && cloudOffline >= 0) {
          headline.ledgerNet = cloudOffline
          headline.ledgerEmpty = cloudOffline <= 0 && !(cloudByStore || []).some((s) => Number(s.value) > 0)
          notes.push('门店账本来自 getAnalyticsDashboard（山川造物+星宸标本）')
        }
        if (storeId === 'all' && Array.isArray(cloudByStore) && cloudByStore.length) {
          headline.ledgerByStore = cloudByStore.map((s) => ({
            storeId: s.storeId,
            name: s.name || s.storeId,
            value: Number(s.value) || 0,
            pct: Number(s.pct) || 0,
          }))
        }
      } else {
        throw new Error(res?.msg || res?.code || 'getAnalyticsDashboard 返回失败')
      }
    } catch (e) {
      console.warn('[Cockpit] getAnalyticsDashboard', e?.message || e)
      notes.push('全量报表暂不可用，已回退 CDN 订单采样')
      let orderRows = []
      try {
        orderRows = await fetchCollectionLimit('orders', { limit: ORDER_SCAN_MAX })
      } catch (e2) {
        notes.push('订单采样失败，线上 GMV 暂缺')
        console.warn('[Cockpit] orders', e2?.message)
      }
      orderAgg = aggregateOrders(orderRows, {
        startDate: range.startDate,
        endDate: range.endDate,
        storeId,
      })
      if (orderAgg.truncated) {
        notes.push(`订单已采样最近 ${ORDER_SCAN_MAX} 单，GMV 为采样内统计`)
      }
    }

    headline.gmvPaid = orderAgg.totals.gmvPaid
    headline.netOnline = orderAgg.totals.netOnline
    headline.refundAmount = orderAgg.totals.refundAmount
    headline.aov = orderAgg.totals.aov
    headline.exchangeCount = orderAgg.totals.exchangeCount
    headline.grandTotal = Math.round((headline.netOnline + headline.ledgerNet) * 100) / 100
    headline.donationLedger = donationFrom(headline.ledgerNet)
    headline.donationGrand = donationFrom(headline.grandTotal)

    // 今日对照（给状态灯）
    const today = todayBizDate()
    const todayLedger = filterLedgerByRange(allLedger, {
      startDate: today,
      endDate: today,
      storeId,
    })
    const todayOnline = (orderAgg.daily || []).find((d) => d.dateKey === today)
    stats.todaySales =
      summarizeLedger(todayLedger).revenue || todayOnline?.gmvPaid || 0

    // 图表数据
    const keys = orderAgg.daily.map((d) => d.dateKey)
    chartState.labels = keys.map((k) => {
      const [, m, d] = k.split('-')
      return `${Number(m)}/${Number(d)}`
    })
    chartState.ledger = keys.map((k) => Math.round((ledgerSum.byDate[k]?.revenue || 0) * 100) / 100)
    chartState.online = orderAgg.daily.map((d) => d.gmvPaid)
    const mix = orderAgg.totals.mix
    chartState.mix = [
      { label: '零售', value: mix.commerce },
      { label: '礼赠', value: mix.gift },
      { label: '定金', value: mix.deposit },
      { label: '尾款', value: mix.depositBalance },
      { label: '定制', value: mix.custom },
    ]
    chartState.categories = orderAgg.categoryShare.map((c) => ({
      label: c.label || categoryLabel(c.key),
      value: c.value,
    }))

    // 3) 待办 counts
    const now = new Date()
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    const cdnDb = await getCdnDatabase()
    const _ = cdnDb.command

    const [
      usersTotal,
      newUsersTotal,
      pendingTotal,
      refundingOrders,
      pendingRefunds,
      stockTotal,
      bookingTotal,
      customTotal,
      petTotal,
      ticketTotal,
      commentTotal,
    ] = await Promise.all([
      safeCdnCount('users'),
      safeCdnCount('users', { createTime: _.gt(startOfDay) }),
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

    stats.totalUsers = usersTotal
    // 区间新会员优先用 getAnalyticsDashboard（与 GMV 同窗）；CDN 仅今日新增作兜底
    stats.newUsers = analyticsNewUsers != null ? analyticsNewUsers : newUsersTotal
    stats.pendingOrders = pendingTotal
    stats.refunding = refundingOrders + pendingRefunds
    stats.lowStock = stockTotal
    stats.pendingBookings = bookingTotal
    stats.pendingCustom = customTotal
    stats.pendingPet = petTotal
    stats.pendingTickets = ticketTotal
    stats.pendingComments = commentTotal

    try {
      const productRows = await fetchCollectionLimit('products', { limit: 500 })
      const nowMs = Date.now()
      let seckillActive = 0
      let seckillExpired = 0
      let groupN = 0
      productRows.forEach((p) => {
        if (p?.seckill?.enabled) {
          const end = p.seckill.endTime ? Number(p.seckill.endTime) : null
          if (end && end < nowMs) seckillExpired += 1
          else seckillActive += 1
        }
        if (p?.groupBuying?.enabled) groupN += 1
      })
      stats.seckillActive = seckillActive
      stats.seckillExpired = seckillExpired
      stats.groupProducts = groupN
    } catch (e) {
      console.warn('[Cockpit] products promo', e?.message)
    }

    const opsNotes = await loadOpsModules()
    notes.push(...opsNotes)

    stats.totalTodos =
      stats.pendingOrders +
      stats.refunding +
      stats.lowStock +
      stats.pendingBookings +
      stats.pendingCustom +
      stats.pendingPet +
      stats.pendingTickets +
      stats.pendingComments +
      gift.todo +
      deposit.counts.overdue

    await loadMiniappPulse().catch((e) => console.warn('pulse', e))

    buildInsights(ledgerSum, orderAgg)
    dataNotes.value = notes

    ready.value = true
    await nextTick()
    renderCharts()
  } catch (e) {
    console.error('驾驶舱加载失败', e)
    const msg = e?.message || '看板加载失败，请检查网络后刷新'
    loadError.value = msg
    if (!ready.value) {
      // 首屏失败：保留骨架区外的可读错误态，勿只弹 toast
    } else {
      ElMessage.warning(msg)
    }
  } finally {
    loading.value = false
  }
}

watch(chartMode, () => {
  nextTick(() => renderCharts())
})

onMounted(() => {
  clockTimer = setInterval(() => {
    currentTime.value = new Date().toLocaleTimeString()
  }, 1000)
  refreshStoreOptions()
  refreshAll()
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
  if (trendChart) trendChart.destroy()
  if (mixChart) mixChart.destroy()
  if (catChart) catChart.destroy()
})
</script>

<style scoped>
.cockpit {
  padding: 8px 4px 32px;
  color: var(--light-text-primary, #33302c);
  background: transparent;
  position: relative;
}
.cockpit--refreshing::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(242, 237, 228, 0.35) 0%,
    rgba(242, 237, 228, 0.12) 40%,
    transparent 100%
  );
  border-radius: 12px;
}
.load-error-alert { margin-bottom: 14px; }
.load-error-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  width: 100%;
}

/* Studio Mode 骨架：奶油底 + 白卡 + 可见边框，避免假白屏 */
.cockpit-skeleton {
  margin-top: 4px;
}
.skel-banner {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding: 8px 14px;
  border-radius: 9999px;
  background: #faf6ed;
  border: 1px solid #e0cfa3;
  color: #8a7530;
  font-size: 13px;
  font-weight: 500;
}
.skel-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #e0cfa3;
  border-top-color: #2d5a3f;
  animation: skel-spin 0.8s linear infinite;
}
@keyframes skel-spin {
  to { transform: rotate(360deg); }
}
.skel-kpi {
  pointer-events: none;
  min-height: 96px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  justify-content: center;
}
.skel-kpi.kpi-gold .skel-line {
  background: linear-gradient(90deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0.28) 100%);
  background-size: 200% 100%;
}
.skel-line {
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, #e8e5de 0%, #f0e6cc 45%, #e8e5de 90%);
  background-size: 200% 100%;
  animation: skel-shimmer 1.4s ease-in-out infinite;
}
.skel-lg { height: 22px; }
.skel-w40 { width: 40%; }
.skel-w45 { width: 45%; }
.skel-w55 { width: 55%; }
.skel-w60 { width: 60%; }
.skel-w70 { width: 70%; }
.skel-w90 { width: 90%; }
@keyframes skel-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
.skel-chart {
  display: flex;
  align-items: flex-end;
  background: #fafaf5;
  border: 1px dashed #e8e5de;
  border-radius: 8px;
  padding: 16px 12px 12px;
}
.skel-chart-bars {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  width: 100%;
  height: 100%;
}
.skel-chart-bars span {
  flex: 1;
  border-radius: 4px 4px 0 0;
  background: linear-gradient(180deg, #d4bc85 0%, #e8e5de 100%);
  opacity: 0.85;
  animation: skel-bar 1.2s ease-in-out infinite alternate;
}
.skel-chart-bars span:nth-child(odd) { animation-delay: 0.15s; }
.skel-chart-bars span:nth-child(3n) { animation-delay: 0.3s; }
@keyframes skel-bar {
  from { opacity: 0.45; }
  to { opacity: 0.95; }
}
.skel-mix-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  min-height: 180px;
  place-items: center;
}
.skel-donut {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  border: 18px solid #e8e5de;
  border-top-color: #c4a76c;
  border-right-color: #2d5a3f;
  animation: skel-spin 1.6s linear infinite;
}
.skel-biz {
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cockpit-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.welcome h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--light-text-primary, #33302c);
}
.subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--light-text-secondary, #6b6560);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.status-dot.hot { color: #d64045; }
.status-dot.ok { color: #2d5a3f; }
.status-dot.idle { color: #a09a90; }
.sep { color: #c5c2bb; }
.header-tools {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: #fff;
  border: 1px solid var(--light-border-subtle, #e8e5de);
  border-radius: 10px;
  padding: 6px 10px;
}
.clock {
  font-size: 12px;
  color: #6b6560;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.notes-alert { margin-bottom: 14px; }
.notes-inline { font-size: 12px; font-weight: 400; line-height: 1.5; }

.section { margin-bottom: 18px; }
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.section-head h3,
.quick h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  border-left: 3px solid var(--brand-green-500, #2d5a3f);
  padding-left: 10px;
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}
.kpi {
  text-align: left;
  border: 1px solid var(--light-border-subtle, #e8e5de);
  background: #fff;
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
  box-shadow: 0 1px 2px rgba(26, 24, 20, 0.04);
}
.kpi:hover {
  border-color: #c4a76c;
  box-shadow: 0 4px 12px rgba(26, 24, 20, 0.06);
  transform: translateY(-1px);
}
.kpi-gold {
  background: linear-gradient(135deg, #a8903c 0%, #c4a76c 100%);
  border-color: transparent;
  color: #fff;
}
.kpi-gold .kpi-label,
.kpi-gold .kpi-sub { color: rgba(255, 255, 255, 0.78); }
.kpi-gold .kpi-value { color: #fff; }
.store-split-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.store-split-card {
  background: #fff;
  border: 1px solid #e8e5de;
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 0 1px 2px rgba(26, 24, 20, 0.05);
}
.store-split-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}
.store-split-name {
  font-size: 14px;
  font-weight: 500;
  color: #33302c;
}
.store-split-pct {
  font-family: 'JetBrains Mono', 'DM Mono', ui-monospace, monospace;
  font-size: 13px;
  color: #c4a76c;
}
.store-split-track {
  height: 6px;
  border-radius: 9999px;
  background: #f2ede4;
  overflow: hidden;
}
.store-split-fill {
  height: 100%;
  border-radius: 9999px;
  background: linear-gradient(90deg, #2d5a3f, #c4a76c);
}
.store-split-val {
  margin-top: 8px;
  font-family: 'JetBrains Mono', 'DM Mono', ui-monospace, monospace;
  font-size: 16px;
  font-weight: 600;
  color: #4a4540;
}
@media (max-width: 640px) {
  .store-split-row { grid-template-columns: 1fr; }
}
.kpi-donate {
  background: #faf6ed;
  border-color: #e0cfa3;
}
.kpi-label {
  font-size: 12px;
  color: #6b6560;
  margin-bottom: 6px;
}
.kpi-value {
  font-size: 24px;
  font-weight: 700;
  font-family: 'JetBrains Mono', 'DM Mono', ui-monospace, monospace;
  letter-spacing: -0.02em;
  color: #33302c;
}
.kpi-value.accent { color: #c4a76c; }
.kpi-sub {
  margin-top: 6px;
  font-size: 11px;
  color: #a09a90;
  line-height: 1.4;
}
.muted { color: #a09a90; }
.tiny { font-size: 11px; font-weight: 400; }

.mid-row { margin-bottom: 8px; }
.panel {
  border: 1px solid var(--light-border-subtle, #e8e5de) !important;
  border-radius: 12px !important;
  background: #fff;
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}
.chart-box {
  height: 260px;
  position: relative;
}
.chart-box-sm { height: 200px; }
.chart-empty {
  position: absolute;
  inset: 8px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  pointer-events: none;
  background: rgba(255, 255, 255, 0.88);
  border-radius: 8px;
}
.chart-empty.compact { font-size: 12px; color: #909399; }
.chart-empty-title { font-size: 14px; font-weight: 600; color: #606266; }
.chart-empty-desc { margin-top: 6px; font-size: 12px; color: #909399; max-width: 320px; }
.dimmed { opacity: 0.35; }

.pulse-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.pulse-card {
  border: 1px solid #e8e5de;
  background: #fafaf5;
  border-radius: 10px;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
}
.pulse-card:hover { border-color: #c4a76c; background: #fff; }
.p-lbl { font-size: 11px; color: #a09a90; }
.p-val {
  font-size: 20px;
  font-weight: 700;
  color: #33302c;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  margin-top: 2px;
}
.p-sub { font-size: 11px; color: #c4a76c; margin-top: 2px; }

.biz-block {
  border: 1px solid #e8e5de;
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.biz-block:hover { border-color: #c4a76c; background: #faf6ed; }
.biz-block:last-child { margin-bottom: 0; }
.biz-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}
.biz-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.biz-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
.biz-grid > div {
  text-align: center;
}
.biz-grid b {
  display: block;
  font-size: 16px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: #33302c;
}
.biz-grid span {
  font-size: 11px;
  color: #a09a90;
}
.biz-grid .warn b { color: #d64045; }
.biz-foot {
  margin-top: 8px;
  font-size: 12px;
  color: #6b6560;
}

.todo-list { display: flex; flex-direction: column; gap: 8px; }
.todo-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #fafaf5;
  cursor: pointer;
  text-align: left;
}
.todo-item:hover { background: #fff; border-color: #e8e5de; }
.todo-item.active { border-left: 3px solid #d64045; }
.t-title { font-size: 13px; font-weight: 600; color: #33302c; }
.t-desc { font-size: 11px; color: #a09a90; margin-top: 2px; }
.todo-num {
  margin-left: auto;
  font-weight: 700;
  font-size: 16px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.todo-num.warn { color: #e9a23b; }
.todo-total {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 16px;
}
.todo-total.hot { color: #d64045; }

.insights-preview {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e8e5de;
}
.insight-item {
  display: flex;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  background: #e1f5ee55;
  border-left: 3px solid #2d5a3f;
  margin-bottom: 6px;
}
.insight-item.alert {
  background: #faf6ed;
  border-left-color: #e9a23b;
}
.insight-icon { color: #2d5a3f; margin-top: 2px; }
.insight-title { font-size: 12px; font-weight: 600; }
.insight-desc { font-size: 12px; color: #6b6560; margin-top: 2px; }

.action-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}
.insights-dialog-body { font-size: 13px; line-height: 1.6; color: #4a4540; }
.insights-dialog-body ul { padding-left: 18px; }

@media (max-width: 1200px) {
  .kpi-row { grid-template-columns: repeat(3, 1fr); }
  .pulse-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 768px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .biz-grid { grid-template-columns: repeat(2, 1fr); }
  .filters { width: 100%; }
}
@media (max-width: 480px) {
  .kpi-row { grid-template-columns: 1fr; }
  .pulse-grid { grid-template-columns: 1fr; }
}
</style>
