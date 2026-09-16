<template>
  <div class="ba-container">
    <!-- 头部 -->
    <div class="panel-header">
      <div class="title-box">
        <h2>C 端行为看板 / BEHAVIOR ANALYTICS</h2>
        <span class="subtitle">MINI-PROGRAM EVENT INTELLIGENCE</span>
      </div>
      <div class="header-actions">
        <el-radio-group v-model="rangePreset" size="small" @change="onPresetChange" fill="#d4af37">
          <el-radio-button label="today">今日</el-radio-button>
          <el-radio-button label="7d">近 7 天</el-radio-button>
          <el-radio-button label="30d">近 30 天</el-radio-button>
          <el-radio-button label="custom">自定义</el-radio-button>
        </el-radio-group>
        <el-date-picker
          v-if="rangePreset === 'custom'"
          v-model="dateRange"
          type="daterange"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
          range-separator="至"
          @change="refresh"
          size="small"
        />
        <el-button :icon="Refresh" circle @click="refresh" :loading="loading" title="刷新" />
        <el-button size="small" @click="guideVisible = true">埋点说明</el-button>
      </div>
    </div>

    <!-- KPI 区 -->
    <div class="kpi-strip">
      <div class="kpi-card big">
        <div class="kpi-top"><span class="lbl">PV 总曝光</span><span class="ico">👁️</span></div>
        <div class="kpi-val">{{ formatNum(kpi.totalEvents) }}</div>
        <div class="kpi-sub">期内事件总数 · 含所有 action</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><span class="lbl">UV 独立用户</span><span class="ico">👥</span></div>
        <div class="kpi-val">{{ formatNum(kpi.uv) }}</div>
        <div class="kpi-sub">活跃 openid 数</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><span class="lbl">会话数</span><span class="ico">🔄</span></div>
        <div class="kpi-val">{{ kpi.sessions != null ? formatNum(kpi.sessions) : '—' }}</div>
        <div class="kpi-sub">{{ kpi.sessionsNote }}</div>
      </div>
      <div class="kpi-card highlight">
        <div class="kpi-top"><span class="lbl">AI 鉴定数</span><span class="ico">🔍</span></div>
        <div class="kpi-val">{{ formatNum(kpi.identifyCount) }}</div>
        <div class="kpi-sub">识别成功 {{ kpi.identifySuccessRate }}%</div>
      </div>
      <div class="kpi-card highlight">
        <div class="kpi-top"><span class="lbl">定制询单</span><span class="ico">🎨</span></div>
        <div class="kpi-val">{{ formatNum(kpi.customSubmits) }}</div>
        <div class="kpi-sub">含伴宠 {{ kpi.petSubmits }}</div>
      </div>
      <div class="kpi-card warn">
        <div class="kpi-top"><span class="lbl">客服工单</span><span class="ico">💬</span></div>
        <div class="kpi-val">{{ formatNum(kpi.supportTickets) }}</div>
        <div class="kpi-sub">用户主动求助</div>
      </div>
    </div>

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      class="ba-alert"
      :title="loadError"
    />
    <el-alert
      v-else-if="!loading && !hasEventData"
      type="info"
      :closable="false"
      show-icon
      class="ba-alert"
      :title="EMPTY_TRACKING"
      description="请确认小程序已上报 trackBehavior，或缩短/调整日期范围。可点右上角「埋点说明」查看字段与联调步骤。"
    />

    <!-- 时间序列图 + 模块分布 -->
    <div class="main-grid">
      <el-card shadow="never" class="chart-card">
        <template #header>
          <div class="card-header">
            <span>📈 事件时间序列（按模块）</span>
            <el-select v-model="trendMetric" size="small" style="width: 120px" @change="renderTrendChart">
              <el-option label="事件数" value="count" />
              <el-option label="UV 数" value="uv" />
            </el-select>
          </div>
        </template>
        <div v-if="hasEventData" class="chart-wrap"><canvas ref="trendCanvas"></canvas></div>
        <el-empty v-else :description="EMPTY_TRACKING" :image-size="72" />
      </el-card>

      <el-card shadow="never" class="chart-card">
        <template #header>
          <div class="card-header"><span>🍩 模块流量分布</span></div>
        </template>
        <template v-if="moduleBreakdown.length">
          <div class="chart-wrap"><canvas ref="donutCanvas"></canvas></div>
          <div class="module-legend">
            <div v-for="m in moduleBreakdown" :key="m.key" class="lg-item">
              <span class="lg-dot" :style="{ background: m.color }"></span>
              <span class="lg-name">{{ m.icon }} {{ m.name }}</span>
              <span class="lg-num">{{ formatNum(m.count) }}</span>
            </div>
          </div>
        </template>
        <el-empty v-else :description="EMPTY_TRACKING" :image-size="72" />
      </el-card>
    </div>

    <!-- 漏斗区 -->
    <el-card shadow="never" class="funnels-card">
      <template #header>
        <div class="card-header">
          <span>🪜 核心转化漏斗</span>
          <span class="hint">每一步显示触发数 · 步骤间显示通过率</span>
        </div>
      </template>
      <div class="funnels-grid">
        <div v-for="f in funnelData" :key="f.key" class="funnel-card" v-loading="loading">
          <div class="funnel-head">
            <span class="f-icon" :style="{ background: f.color }">{{ f.icon }}</span>
            <div class="f-info">
              <div class="f-name">{{ f.name }}</div>
              <div class="f-conv">
                整体转化
                <b :class="convClass(f.totalConv)">{{ f.totalConv }}%</b>
              </div>
            </div>
          </div>
          <div class="funnel-steps">
            <div v-for="(s, i) in f.steps" :key="i" class="step-row">
              <div class="step-bar">
                <div class="step-fill" :style="{ width: s.barWidth + '%', background: f.color }">
                  <span class="step-count">{{ formatNum(s.count) }}</span>
                </div>
              </div>
              <div class="step-label">{{ s.label }}</div>
              <div v-if="i < f.steps.length - 1" class="step-arrow">
                ↓ <span :class="convClass(s.stepConv)">{{ s.stepConv }}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </el-card>

    <!-- Top 表格区 -->
    <div class="tables-grid">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span>🔥 Top 事件 (TOP 15)</span>
            <el-radio-group v-model="topMetric" size="small" @change="recomputeTops">
              <el-radio-button label="count">按次数</el-radio-button>
              <el-radio-button label="uv">按 UV</el-radio-button>
            </el-radio-group>
          </div>
        </template>
        <el-table :data="topEvents" size="small" v-loading="loading">
          <el-table-column label="#" width="48" type="index" />
          <el-table-column label="事件" min-width="200">
            <template #default="{ row }">
              <div class="ev-name">{{ row.desc || row.action }}</div>
              <div class="ev-code">{{ row.action }}</div>
            </template>
          </el-table-column>
          <el-table-column label="模块" width="120">
            <template #default="{ row }">
              <el-tag size="small" :style="{ background: row.moduleColor + '20', color: row.moduleColor, border: 'none' }">
                {{ row.moduleIcon }} {{ row.moduleName }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="次数" prop="count" width="100" sortable>
            <template #default="{ row }">
              <span class="num-cell">{{ formatNum(row.count) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="UV" prop="uv" width="80">
            <template #default="{ row }">{{ formatNum(row.uv) }}</template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span>📄 Top 页面 (TOP 10)</span>
          </div>
        </template>
        <el-table v-if="topPages.length" :data="topPages" size="small" v-loading="loading">
          <el-table-column label="#" width="48" type="index" />
          <el-table-column label="页面路径" min-width="240">
            <template #default="{ row }">
              <div class="page-path">{{ row.page || '(unknown)' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="PV" prop="pv" width="100" sortable>
            <template #default="{ row }">{{ formatNum(row.pv) }}</template>
          </el-table-column>
          <el-table-column label="UV" prop="uv" width="80">
            <template #default="{ row }">{{ formatNum(row.uv) }}</template>
          </el-table-column>
        </el-table>
        <el-empty
          v-else
          :description="pageStatsNote || EMPTY_TRACKING"
          :image-size="64"
        />
      </el-card>
    </div>

    <!-- 模块明细面板 -->
    <el-card shadow="never" class="module-detail-card">
      <template #header>
        <div class="card-header">
          <span>🧩 模块明细</span>
          <el-select v-model="selectedModule" size="small" style="width: 180px" @change="recomputeTops">
            <el-option v-for="(meta, key) in MODULE_META" :key="key" :value="key" :label="meta.icon + ' ' + meta.name" />
          </el-select>
        </div>
      </template>
      <div class="module-actions-grid">
        <div v-for="a in selectedModuleActions" :key="a.action" class="ma-row">
          <div class="ma-label">
            <span class="ma-desc">{{ a.desc }}</span>
            <span class="ma-code">{{ a.action }}</span>
          </div>
          <div class="ma-bar-wrap">
            <div class="ma-bar" :style="{ width: a.barWidth + '%' }"></div>
          </div>
          <div class="ma-num">{{ formatNum(a.count) }}</div>
        </div>
        <div v-if="!selectedModuleActions.length" class="empty">{{ EMPTY_TRACKING }}</div>
      </div>
    </el-card>

    <!-- 数据来源说明 -->
    <div class="data-source-tip">
      <el-icon><InfoFilled /></el-icon>
      <span>
        数据来源：<code>user_behaviors</code> 与 <code>analytics_daily</code> 集合（小程序 trackBehavior 实时上报）。
        埋点目录共 <b>{{ totalActions }}</b> 个事件 · 跨 <b>{{ totalModules }}</b> 个业务模块，
        与小程序 <code>utils/analytics/eventSchema.js</code> 保持同构。
        <el-button link type="primary" @click="guideVisible = true">查看埋点说明</el-button>
      </span>
    </div>

    <el-drawer v-model="guideVisible" title="C 端行为埋点说明" size="420px" direction="rtl">
      <div class="guide-body">
        <p>看板读取云集合 <code>user_behaviors</code> / <code>analytics_daily</code>，与小程序 <code>eventSchema.js</code> 同构。</p>
        <h4>必填字段</h4>
        <ul>
          <li><code>action</code> · 事件名</li>
          <li><code>module</code> · 业务模块</li>
          <li><code>openid</code> · UV</li>
          <li><code>createTime</code> · 毫秒时间戳</li>
        </ul>
        <h4>可选（影响 KPI）</h4>
        <ul>
          <li><code>sessionId</code> · 真实会话数</li>
          <li><code>page</code> · Top 页面表</li>
        </ul>
        <h4>空态约定</h4>
        <p>无数据时不展示假曲线；统一文案「所选时间段暂无埋点数据」。缺 page / sessionId 时另有专项提示。</p>
        <h4>文档</h4>
        <p>完整说明见仓库 <code>admin/docs/C端行为埋点说明.md</code>。</p>
        <el-button type="primary" @click="guideVisible = false">知道了</el-button>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { Refresh, InfoFilled } from '@element-plus/icons-vue'
import { getCdnDatabase, fetchCollectionWhere } from '../cloud'
import { ElMessage } from 'element-plus'
import Chart from 'chart.js/auto'
import { MODULE, MODULE_META, EVENTS, FUNNELS, getEventMeta, ACTION_NAMES } from '../utils/analyticsSchema'

const EMPTY_TRACKING = '所选时间段暂无埋点数据'

// ----- 状态 -----
const loading = ref(false)
const loadError = ref('')
const guideVisible = ref(false)
const rangePreset = ref('7d')
const dateRange = ref([])
const trendMetric = ref('count')
const topMetric = ref('count')
const selectedModule = ref(MODULE.IDENTIFY)

// 原始数据
const rawEvents = ref([])           // 每日聚合行：{ dateKey, action, module, count, uv:[] }
const sessionIds = ref([])          // 真实 sessionId 列表（来自 user_behaviors）
const pageAgg = ref([])             // { page, pv, uv }
const pageStatsNote = ref('')
const totalActions = ACTION_NAMES.length
const totalModules = Object.keys(MODULE).length
const hasEventData = computed(() => rawEvents.value.length > 0)

// 图表实例
const trendCanvas = ref(null)
const donutCanvas = ref(null)
let trendChart = null
let donutChart = null

// ----- 日期工具 -----
const todayStr = () => new Date().toISOString().split('T')[0]
const dateKeyAt = (offsetDays = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().split('T')[0]
}

const currentRange = computed(() => {
  if (rangePreset.value === 'today') return [todayStr(), todayStr()]
  if (rangePreset.value === '7d') return [dateKeyAt(-6), todayStr()]
  if (rangePreset.value === '30d') return [dateKeyAt(-29), todayStr()]
  if (rangePreset.value === 'custom' && dateRange.value?.length === 2) return dateRange.value
  return [dateKeyAt(-6), todayStr()]
})

const onPresetChange = () => {
  if (rangePreset.value !== 'custom') {
    dateRange.value = []
    refresh()
  }
}

const formatNum = (n) => {
  if (n == null) return '-'
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return Number(n).toLocaleString()
}

// ----- 数据加载 -----
const refresh = async () => {
  loading.value = true
  loadError.value = ''
  pageStatsNote.value = ''
  sessionIds.value = []
  pageAgg.value = []
  try {
    const [start, end] = currentRange.value
    const cdnDb = await getCdnDatabase()
    const _ = cdnDb.command
    let dailyRows = []
    try {
      dailyRows = await fetchCollectionWhere(
        'analytics_daily',
        { dateKey: _.gte(start).and(_.lte(end)) },
        1000
      )
      rawEvents.value = dailyRows || []
    } catch (e) {
      console.warn('analytics_daily 不可读，降级 user_behaviors', e?.message)
      rawEvents.value = []
    }

    // 页面 / 会话级明细：从 user_behaviors 聚合（analytics_daily 无 page/sessionId）
    let behaviorRows = []
    try {
      const ms = new Date(start + 'T00:00:00').getTime()
      const me = new Date(end + 'T23:59:59').getTime()
      behaviorRows = await fetchCollectionWhere(
        'user_behaviors',
        { timestamp: _.gte(ms).and(_.lte(me)) },
        1000
      )
      applyBehaviorExtras(behaviorRows)
      appendGateStepRows(behaviorRows)
      if (!rawEvents.value.length) {
        rawEvents.value = aggregateLocal(behaviorRows)
      }
    } catch (e) {
      console.warn('user_behaviors 不可读', e?.message)
      if (!rawEvents.value.length) {
        throw e
      }
      pageStatsNote.value = 'user_behaviors 不可读，页面/会话指标暂缺'
    }

    if (!rawEvents.value.length) {
      pageStatsNote.value = pageStatsNote.value || EMPTY_TRACKING
    } else if (!pageAgg.value.length) {
      pageStatsNote.value = '暂无页面级埋点（请确认事件含 page 字段）'
    }
  } catch (e) {
    const msg = e?.message || '未知错误'
    loadError.value = `行为看板加载失败：${msg}`
    rawEvents.value = []
    ElMessage.error(loadError.value)
  } finally {
    loading.value = false
    await nextTick()
    renderTrendChart()
    renderDonutChart()
  }
}

const aggregateLocal = (events) => {
  const map = {}
  events.forEach(ev => {
    const dateKey = (new Date(ev.timestamp || Date.now())).toISOString().split('T')[0]
    const key = `${dateKey}|${ev.action}`
    if (!map[key]) {
      map[key] = { dateKey, action: ev.action, module: ev.module || getEventMeta(ev.action)?.module, count: 0, uv: new Set() }
    }
    map[key].count++
    const uid = ev.userId || ev._openid
    if (uid) map[key].uv.add(uid)
  })
  return Object.values(map).map(r => ({ ...r, uv: Array.from(r.uv) }))
}

/**
 * 注册钩子漏斗：把 identify_save_atlas_gate 按 step 展开成合成 action
 * （identify_save_atlas_gate:show / :go_register / :dismiss / :resume_success），
 * 追加进 rawEvents 后即可复用通用 FUNNELS 渲染。
 * 注：analytics_daily 是动作级汇总、不含 step，故此处必须从 user_behaviors 明细派生。
 */
const appendGateStepRows = (events = []) => {
  const GATE_ACTION = 'identify_save_atlas_gate'
  const map = {}
  events.forEach((ev) => {
    if (ev.action !== GATE_ACTION) return
    const step = String(ev.step || '').trim()
    if (!step) return
    const dateKey = (new Date(ev.timestamp || Date.now())).toISOString().split('T')[0]
    const action = `${GATE_ACTION}:${step}`
    const key = `${dateKey}|${action}`
    if (!map[key]) {
      map[key] = {
        dateKey,
        action,
        module: ev.module || getEventMeta(GATE_ACTION)?.module,
        count: 0,
        uv: new Set()
      }
    }
    map[key].count++
    const uid = ev.userId || ev._openid
    if (uid) map[key].uv.add(uid)
  })
  const rows = Object.values(map).map((r) => ({ ...r, uv: Array.from(r.uv) }))
  if (rows.length) rawEvents.value = rawEvents.value.concat(rows)
}

const applyBehaviorExtras = (events = []) => {
  const sessions = new Set()
  const pages = {}
  events.forEach((ev) => {
    if (ev.sessionId) sessions.add(ev.sessionId)
    const page = (ev.page || '').trim()
    if (!page) return
    if (!pages[page]) pages[page] = { page, pv: 0, uv: new Set() }
    pages[page].pv += 1
    const uid = ev.userId || ev._openid
    if (uid) pages[page].uv.add(uid)
  })
  sessionIds.value = Array.from(sessions)
  pageAgg.value = Object.values(pages)
    .map((p) => ({ page: p.page, pv: p.pv, uv: p.uv.size }))
    .sort((a, b) => b.pv - a.pv)
    .slice(0, 10)
}

// ----- 聚合计算 -----
const groupedByAction = computed(() => {
  const map = {}
  rawEvents.value.forEach(r => {
    if (!map[r.action]) map[r.action] = { count: 0, uv: new Set() }
    map[r.action].count += (r.count || 0)
    ;(Array.isArray(r.uv) ? r.uv : []).forEach(u => map[r.action].uv.add(u))
  })
  return map
})

const groupedByDate = computed(() => {
  const map = {}
  rawEvents.value.forEach(r => {
    if (!map[r.dateKey]) map[r.dateKey] = {}
    const meta = getEventMeta(r.action)
    const mod = meta?.module || r.module || 'system'
    if (!map[r.dateKey][mod]) map[r.dateKey][mod] = { count: 0, uv: new Set() }
    map[r.dateKey][mod].count += (r.count || 0)
    ;(Array.isArray(r.uv) ? r.uv : []).forEach(u => map[r.dateKey][mod].uv.add(u))
  })
  return map
})

const kpi = computed(() => {
  let totalEvents = 0
  const uvSet = new Set()
  rawEvents.value.forEach(r => {
    totalEvents += (r.count || 0)
    ;(Array.isArray(r.uv) ? r.uv : []).forEach(u => uvSet.add(u))
  })
  const getCount = (action) => groupedByAction.value[action]?.count || 0
  const identifySuccess = getCount('identify_success')
  const identifyStart = getCount('identify_start')
  const hasSessions = sessionIds.value.length > 0
  return {
    totalEvents,
    uv: uvSet.size,
    sessions: hasSessions ? sessionIds.value.length : null,
    sessionsNote: hasSessions ? '独立 sessionId' : '待埋点 · 无 sessionId',
    identifyCount: identifyStart,
    identifySuccessRate: identifyStart > 0
      ? ((identifySuccess / identifyStart) * 100).toFixed(0)
      : '0',
    customSubmits: getCount('custom_order_submit') + getCount('custom_inquiry_submit'),
    petSubmits: getCount('pet_memorial_submit'),
    supportTickets: getCount('support_ticket_submit')
  }
})

const moduleBreakdown = computed(() => {
  const map = {}
  Object.keys(MODULE_META).forEach(k => { map[k] = 0 })
  rawEvents.value.forEach(r => {
    const meta = getEventMeta(r.action)
    const mod = meta?.module || r.module || 'system'
    map[mod] = (map[mod] || 0) + (r.count || 0)
  })
  return Object.entries(map)
    .map(([key, count]) => ({
      key, count,
      name: MODULE_META[key]?.name || key,
      icon: MODULE_META[key]?.icon || '•',
      color: MODULE_META[key]?.color || '#909399'
    }))
    .filter(m => m.count > 0)
    .sort((a, b) => b.count - a.count)
})

// 漏斗
const funnelData = computed(() => FUNNELS.map(f => {
  const steps = f.steps.map(s => ({ ...s, count: groupedByAction.value[s.action]?.count || 0 }))
  const top = Math.max(...steps.map(s => s.count), 1)
  steps.forEach((s, i) => {
    s.barWidth = Math.max(2, (s.count / top) * 100)
    s.stepConv = i < steps.length - 1
      ? ((steps[i + 1].count / Math.max(s.count, 1)) * 100).toFixed(1)
      : 100
  })
  const totalConv = ((steps[steps.length - 1].count / Math.max(steps[0].count, 1)) * 100).toFixed(1)
  return { ...f, steps, totalConv }
}))

const convClass = (v) => {
  const n = parseFloat(v)
  if (n >= 60) return 'conv-hot'
  if (n >= 30) return 'conv-ok'
  if (n >= 10) return 'conv-low'
  return 'conv-cold'
}

// Top 事件
const topEvents = ref([])
const topPages = ref([])

const recomputeTops = () => {
  const entries = Object.entries(groupedByAction.value).map(([action, v]) => {
    const meta = getEventMeta(action)
    const modKey = meta?.module || 'system'
    return {
      action,
      desc: meta?.desc || '',
      moduleName: MODULE_META[modKey]?.name || modKey,
      moduleIcon: MODULE_META[modKey]?.icon || '•',
      moduleColor: MODULE_META[modKey]?.color || '#909399',
      count: v.count,
      uv: v.uv.size
    }
  })
  entries.sort((a, b) => (b[topMetric.value] || 0) - (a[topMetric.value] || 0))
  topEvents.value = entries.slice(0, 15)
  topPages.value = pageAgg.value.slice(0, 10)
}

const selectedModuleActions = computed(() => {
  const arr = ACTION_NAMES
    .filter(a => getEventMeta(a)?.module === selectedModule.value)
    .map(a => ({
      action: a,
      desc: EVENTS[a].desc,
      count: groupedByAction.value[a]?.count || 0
    }))
  const top = Math.max(...arr.map(a => a.count), 1)
  arr.forEach(a => { a.barWidth = (a.count / top) * 100 })
  return arr.sort((a, b) => b.count - a.count)
})

// ----- Chart 渲染 -----
const renderTrendChart = () => {
  if (trendChart) {
    trendChart.destroy()
    trendChart = null
  }
  if (!trendCanvas.value || !hasEventData.value) return

  const dates = Object.keys(groupedByDate.value).sort()
  const topModules = moduleBreakdown.value.slice(0, 6)
  if (!dates.length || !topModules.length) return

  const datasets = topModules.map(m => ({
    label: m.icon + ' ' + m.name,
    data: dates.map(d => {
      const v = groupedByDate.value[d]?.[m.key]
      if (!v) return 0
      return trendMetric.value === 'uv' ? v.uv.size : v.count
    }),
    borderColor: m.color,
    backgroundColor: m.color + '20',
    borderWidth: 2,
    tension: 0.35,
    fill: false,
    pointRadius: 3
  }))

  trendChart = new Chart(trendCanvas.value, {
    type: 'line',
    data: { labels: dates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: '#f5f5f5' } },
        x: { grid: { display: false } }
      }
    }
  })
}

const renderDonutChart = () => {
  if (donutChart) {
    donutChart.destroy()
    donutChart = null
  }
  if (!donutCanvas.value) return
  const data = moduleBreakdown.value.slice(0, 10)
  if (!data.length) return
  donutChart = new Chart(donutCanvas.value, {
    type: 'doughnut',
    data: {
      labels: data.map(m => m.icon + ' ' + m.name),
      datasets: [{
        data: data.map(m => m.count),
        backgroundColor: data.map(m => m.color),
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => {
              const total = c.dataset.data.reduce((a, b) => a + b, 0)
              const pct = total ? ((c.parsed / total) * 100).toFixed(1) : '0'
              return `${c.label}: ${formatNum(c.parsed)} (${pct}%)`
            }
          }
        }
      }
    }
  })
}

onMounted(async () => {
  await refresh()
  recomputeTops()
})

onUnmounted(() => {
  if (trendChart) trendChart.destroy()
  if (donutChart) donutChart.destroy()
})

watch(rawEvents, () => recomputeTops(), { deep: true })
</script>

<style scoped>
.ba-container { padding: 16px; }
.ba-alert { margin-bottom: 16px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }
.header-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

/* KPI 区 */
.kpi-strip { display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; margin-bottom: 20px; }
.kpi-card { background: #fff; border-radius: 12px; padding: 16px 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); border-top: 3px solid #e4e7ed; transition: 0.2s; }
.kpi-card:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.08); }
.kpi-card.big { border-top-color: #2c2c2c; background: linear-gradient(145deg, #1c1c1c, #000); color: #d4af37; }
.kpi-card.highlight { border-top-color: #d4af37; }
.kpi-card.warn { border-top-color: #f56c6c; }
.kpi-top { display: flex; justify-content: space-between; align-items: center; font-size: 12px; opacity: 0.7; }
.kpi-top .ico { font-size: 18px; }
.kpi-val { font-size: 26px; font-weight: 800; margin-top: 6px; font-family: 'Segoe UI', sans-serif; letter-spacing: -0.5px; }
.kpi-sub { font-size: 11px; color: #999; margin-top: 4px; }
.kpi-card.big .kpi-sub { color: rgba(212, 175, 55, 0.6); }

/* 主图表区 */
.main-grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; margin-bottom: 20px; }
.chart-card { border-radius: 10px; }
.chart-card :deep(.el-card__header) { padding: 12px 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 14px; }
.card-header .hint { font-size: 11px; color: #999; font-weight: normal; }
.chart-wrap { height: 280px; position: relative; }

.module-legend { display: flex; flex-wrap: wrap; gap: 8px 12px; padding: 12px 4px 0; }
.lg-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #666; }
.lg-dot { width: 8px; height: 8px; border-radius: 50%; }
.lg-num { color: #333; font-weight: 600; margin-left: 2px; }

/* 漏斗区 */
.funnels-card { margin-bottom: 20px; }
.funnels-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 18px; }
.funnel-card { background: #fafafa; border-radius: 10px; padding: 16px; border: 1px solid #f0f0f0; }
.funnel-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.f-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 20px; }
.f-name { font-weight: bold; color: #333; font-size: 14px; }
.f-conv { font-size: 12px; color: #666; margin-top: 3px; }

.funnel-steps { display: flex; flex-direction: column; gap: 4px; }
.step-row { position: relative; }
.step-bar { background: #f0f0f0; border-radius: 4px; height: 22px; overflow: hidden; }
.step-fill { height: 100%; display: flex; align-items: center; padding: 0 8px; border-radius: 4px; transition: width 0.4s; min-width: 30px; }
.step-count { color: #fff; font-size: 11px; font-weight: bold; }
.step-label { font-size: 12px; color: #666; padding: 2px 4px; }
.step-arrow { text-align: center; font-size: 11px; color: #999; padding: 2px 0; }

.conv-hot { color: #27ae60; font-weight: bold; }
.conv-ok { color: #d4af37; font-weight: bold; }
.conv-low { color: #e6a23c; }
.conv-cold { color: #f56c6c; }

/* 表格区 */
.tables-grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 16px; margin-bottom: 20px; }
.ev-name { font-weight: 500; color: #333; font-size: 13px; }
.ev-code { font-family: monospace; font-size: 11px; color: #999; margin-top: 2px; }
.num-cell { font-weight: 600; color: #d4af37; }
.page-path { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #333; }

/* 模块明细 */
.module-detail-card { margin-bottom: 20px; }
.module-actions-grid { display: flex; flex-direction: column; gap: 10px; }
.ma-row { display: grid; grid-template-columns: 260px 1fr 80px; gap: 12px; align-items: center; padding: 6px 0; border-bottom: 1px dashed #f5f5f5; }
.ma-label { display: flex; flex-direction: column; }
.ma-desc { font-size: 13px; color: #333; }
.ma-code { font-family: monospace; font-size: 11px; color: #999; }
.ma-bar-wrap { background: #f5f5f5; height: 8px; border-radius: 4px; overflow: hidden; }
.ma-bar { height: 100%; background: linear-gradient(90deg, #d4af37, #b7950b); border-radius: 4px; transition: width 0.4s; }
.ma-num { text-align: right; font-weight: bold; color: #333; }

.empty { padding: 40px; text-align: center; color: var(--light-text-secondary); }
.data-source-tip { background: #fdf6ec; padding: 10px 14px; border-radius: 8px; color: #b7950b; font-size: 12px; display: flex; align-items: center; gap: 8px; }
.data-source-tip code { background: rgba(255,255,255,0.6); padding: 1px 6px; border-radius: 4px; font-family: monospace; }
.guide-body { font-size: 13px; color: #444; line-height: 1.6; }
.guide-body h4 { margin: 16px 0 8px; color: #2D6A4F; font-size: 14px; }
.guide-body ul { margin: 0; padding-left: 18px; }
.guide-body code { background: #f5f5f5; padding: 1px 5px; border-radius: 3px; font-size: 12px; }

@media (max-width: 1200px) {
  .kpi-strip { grid-template-columns: repeat(3, 1fr); }
  .main-grid, .tables-grid { grid-template-columns: 1fr; }
}
</style>
