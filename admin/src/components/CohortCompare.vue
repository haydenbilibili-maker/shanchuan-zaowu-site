<template>
  <div class="cc-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>人群对比 / COHORT COMPARE</h2>
        <span class="subtitle">SIDE-BY-SIDE COHORT ANALYSIS</span>
      </div>
      <el-button :icon="Refresh" circle @click="loadData" :loading="loading" title="刷新" />
    </div>

    <!-- 选择 2-3 个人群 -->
    <el-card shadow="never" class="picker-card">
      <template #header>
        <div class="card-header">
          <span>🎯 选择对比人群（最多 3 个）</span>
          <el-button-group size="small">
            <el-button :icon="Plus" @click="addCohort" :disabled="selectedCohorts.length >= 3">添加人群</el-button>
            <el-button @click="clearCohorts">清空</el-button>
          </el-button-group>
        </div>
      </template>

      <div class="picker-grid">
        <div v-for="(c, idx) in selectedCohorts" :key="idx" class="picker-card-inner">
          <div class="pc-header">
            <span class="pc-num" :style="{ background: COMPARE_COLORS[idx] }">{{ idx + 1 }}</span>
            <el-select v-model="c.source" size="small" style="width: 110px" @change="updateCohort(idx)">
              <el-option label="分群" value="segment" />
              <el-option label="行为标签" value="tag" />
              <el-option label="自定义 RFM" value="rfm" />
            </el-select>
            <el-icon class="pc-close" @click="removeCohort(idx)"><CloseBold /></el-icon>
          </div>

          <el-select
            v-if="c.source === 'segment'"
            v-model="c.value"
            placeholder="选择分群"
            style="width: 100%; margin-top: 8px;"
            @change="updateCohort(idx)"
          >
            <el-option v-for="(seg, key) in SEGMENTS" :key="key" :value="key" :label="`${seg.icon} ${seg.name}`" />
          </el-select>

          <el-select
            v-else-if="c.source === 'tag'"
            v-model="c.value"
            placeholder="选择标签"
            style="width: 100%; margin-top: 8px;"
            @change="updateCohort(idx)"
          >
            <el-option v-for="t in availableTags" :key="t.key" :value="t.key" :label="`${t.icon} ${t.label}`" />
          </el-select>

          <div v-else class="rfm-controls">
            <div class="slider-row"><span>R≥</span><el-slider v-model="c.rfmRule.rMin" :min="1" :max="5" @change="updateCohort(idx)" /></div>
            <div class="slider-row"><span>F≥</span><el-slider v-model="c.rfmRule.fMin" :min="1" :max="5" @change="updateCohort(idx)" /></div>
            <div class="slider-row"><span>M≥</span><el-slider v-model="c.rfmRule.mMin" :min="1" :max="5" @change="updateCohort(idx)" /></div>
          </div>

          <div class="pc-size">
            <span class="pc-label">命中</span>
            <span class="pc-num-big" :style="{ color: COMPARE_COLORS[idx] }">{{ c.members.length }}</span>
            <span class="pc-label">人</span>
          </div>
        </div>

        <div v-if="selectedCohorts.length === 0" class="empty-picker">
          点击「添加人群」开始对比，最多可比较 3 个人群
        </div>
      </div>
    </el-card>

    <!-- 核心 KPI 并排对比 -->
    <el-card shadow="never" class="kpi-compare-card" v-if="selectedCohorts.length > 0">
      <template #header><div class="card-header"><span>📊 核心指标对比</span></div></template>
      <div class="kpi-table">
        <div class="kpi-row kpi-row-header">
          <div class="kpi-cell metric-cell">指标</div>
          <div v-for="(c, idx) in selectedCohorts" :key="idx" class="kpi-cell" :style="{ borderTopColor: COMPARE_COLORS[idx] }">
            <div class="kc-name">{{ cohortLabel(c) }}</div>
            <div class="kc-size">{{ c.members.length }} 人</div>
          </div>
        </div>
        <div v-for="m in METRICS" :key="m.key" class="kpi-row">
          <div class="kpi-cell metric-cell">
            <span class="metric-icon">{{ m.icon }}</span>
            <span class="metric-name">{{ m.name }}</span>
            <span class="metric-desc">{{ m.desc }}</span>
          </div>
          <div v-for="(c, idx) in selectedCohorts" :key="idx" class="kpi-cell">
            <span class="kc-val" :class="m.format === 'pct' ? 'kc-pct' : ''">{{ formatMetric(m, computeMetric(c.members, m.key)) }}</span>
            <span class="kc-delta" v-if="idx > 0 && selectedCohorts[0].members.length">
              {{ deltaText(computeMetric(c.members, m.key), computeMetric(selectedCohorts[0].members, m.key)) }}
            </span>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 模块偏好雷达 -->
    <div class="charts-row" v-if="selectedCohorts.length > 0">
      <el-card shadow="never">
        <template #header><div class="card-header"><span>🕸️ 模块偏好雷达</span></div></template>
        <div class="chart-wrap"><canvas ref="radarCanvas"></canvas></div>
      </el-card>

      <el-card shadow="never">
        <template #header><div class="card-header"><span>📊 关键指标柱状对比</span></div></template>
        <div class="chart-wrap"><canvas ref="barCanvas"></canvas></div>
      </el-card>
    </div>

    <!-- 主导行为 Top -->
    <el-card shadow="never" v-if="selectedCohorts.length > 0">
      <template #header><div class="card-header"><span>🔥 Top 主导行为对比 (每人群前 8)</span></div></template>
      <div class="behavior-table">
        <div class="bh-col" v-for="(c, idx) in selectedCohorts" :key="idx">
          <div class="bh-title" :style="{ borderBottomColor: COMPARE_COLORS[idx] }">
            <span class="bh-num" :style="{ background: COMPARE_COLORS[idx] }">{{ idx + 1 }}</span>
            {{ cohortLabel(c) }}
          </div>
          <div class="bh-list">
            <div v-for="(b, i) in topBehaviors(c.members).slice(0, 8)" :key="i" class="bh-item">
              <span class="bh-rank">#{{ i + 1 }}</span>
              <span class="bh-action">{{ b.desc || b.action }}</span>
              <span class="bh-count">{{ b.count }}</span>
            </div>
            <div v-if="!topBehaviors(c.members).length" class="empty-bh">暂无行为数据</div>
          </div>
        </div>
      </div>
    </el-card>

    <div class="data-source-tip">
      <el-icon><InfoFilled /></el-icon>
      <span>
        样本基于 <code>users + orders + user_behaviors</code> 全量数据 ·
        指标即时计算 · <b>{{ profiles.length }}</b> 个用户档案参与对比
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch, nextTick, onUnmounted } from 'vue'
import { Plus, Refresh, CloseBold, InfoFilled } from '@element-plus/icons-vue'
import { loadPortraitSourceData } from '../utils/portraitDataLoad'
import { ElMessage } from 'element-plus'
import Chart from 'chart.js/auto'
import { buildProfile, SEGMENTS } from '../utils/userSegmentation'
import { MODULE, MODULE_META, getEventMeta, EVENTS } from '../utils/analyticsSchema'

const COMPARE_COLORS = ['#d4af37', '#00BCD4', '#FF5722']

const loading = ref(false)
const profiles = ref([])
const allBehaviors = ref([])
const selectedCohorts = ref([])

const radarCanvas = ref(null)
const barCanvas = ref(null)
let radarChart = null
let barChart = null

// 可用标签
const availableTags = computed(() => {
  const seen = new Map()
  profiles.value.forEach(p => {
    (p.tags || []).forEach(t => { if (!seen.has(t.key)) seen.set(t.key, t) })
  })
  return Array.from(seen.values())
})

// 指标定义
const METRICS = [
  { key: 'count', name: '人数', icon: '👥', desc: '人群规模', format: 'num' },
  { key: 'avgMonetary', name: '平均客单', icon: '💰', desc: '人均累计消费', format: 'currency' },
  { key: 'avgFrequency', name: '平均频次', icon: '🔄', desc: '人均订单数', format: 'decimal' },
  { key: 'avgRecency', name: '平均近度', icon: '⏰', desc: '平均最后消费(天)', format: 'days' },
  { key: 'payRate', name: '付费率', icon: '💳', desc: '产生过订单的占比', format: 'pct' },
  { key: 'repurchaseRate', name: '复购率', icon: '🔁', desc: '≥2 单的占比', format: 'pct' },
  { key: 'avgTags', name: '平均标签数', icon: '🏷️', desc: '人均行为标签', format: 'decimal' },
  { key: 'avgPoints', name: '平均积分', icon: '⭐', desc: '会员积分均值', format: 'num' }
]

// ====== 数据加载 ======
const loadData = async () => {
  loading.value = true
  try {
    const { users, orders, behaviors } = await loadPortraitSourceData({
      userLimit: 1000,
      orderLimit: 1000,
      behaviorLimit: 2000,
    })
    allBehaviors.value = behaviors
    profiles.value = buildProfile({ users, orders, behaviors: allBehaviors.value })
    // 默认填两个示例
    if (selectedCohorts.value.length === 0 && profiles.value.length > 0) {
      selectedCohorts.value.push(makeCohort('segment', 'champions'))
      selectedCohorts.value.push(makeCohort('segment', 'at_risk'))
    }
    selectedCohorts.value.forEach((c, i) => updateCohort(i))
    nextTick(renderCharts)
  } catch (e) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}

// ====== 人群操作 ======
function makeCohort(source, value) {
  return {
    source,
    value,
    rfmRule: { rMin: 4, fMin: 3, mMin: 3 },
    members: matchMembers(profiles.value, source, value, { rMin: 4, fMin: 3, mMin: 3 })
  }
}

function matchMembers(profs, source, value, rfmRule) {
  if (source === 'segment') return profs.filter(p => p.segment === value)
  if (source === 'tag') return profs.filter(p => (p.tags || []).some(t => t.key === value))
  if (source === 'rfm') {
    return profs.filter(p => p.R >= (rfmRule.rMin || 1) && p.F >= (rfmRule.fMin || 1) && p.M >= (rfmRule.mMin || 1))
  }
  return []
}

const addCohort = () => {
  if (selectedCohorts.value.length >= 3) return
  selectedCohorts.value.push(makeCohort('segment', 'loyal'))
  nextTick(renderCharts)
}

const removeCohort = (idx) => {
  selectedCohorts.value.splice(idx, 1)
  nextTick(renderCharts)
}

const clearCohorts = () => {
  selectedCohorts.value = []
  nextTick(renderCharts)
}

const updateCohort = (idx) => {
  const c = selectedCohorts.value[idx]
  c.members = matchMembers(profiles.value, c.source, c.value, c.rfmRule)
  nextTick(renderCharts)
}

const cohortLabel = (c) => {
  if (c.source === 'segment') return SEGMENTS[c.value]?.name || c.value || '未选择'
  if (c.source === 'tag') return availableTags.value.find(t => t.key === c.value)?.label || c.value || '未选择'
  if (c.source === 'rfm') return `RFM≥${c.rfmRule.rMin}/${c.rfmRule.fMin}/${c.rfmRule.mMin}`
  return '未选择'
}

// ====== 指标计算 ======
function computeMetric(members, key) {
  if (!members.length) return 0
  if (key === 'count') return members.length
  if (key === 'avgMonetary') return members.reduce((s, p) => s + (p.monetary || 0), 0) / members.length
  if (key === 'avgFrequency') return members.reduce((s, p) => s + (p.frequency || 0), 0) / members.length
  if (key === 'avgRecency') {
    const valid = members.filter(p => p.recencyDays !== Infinity)
    if (!valid.length) return 0
    return valid.reduce((s, p) => s + p.recencyDays, 0) / valid.length
  }
  if (key === 'payRate') return members.filter(p => p.frequency > 0).length / members.length * 100
  if (key === 'repurchaseRate') {
    const paying = members.filter(p => p.frequency > 0)
    if (!paying.length) return 0
    return paying.filter(p => p.frequency >= 2).length / paying.length * 100
  }
  if (key === 'avgTags') return members.reduce((s, p) => s + (p.tags?.length || 0), 0) / members.length
  if (key === 'avgPoints') return members.reduce((s, p) => s + (p.points || 0), 0) / members.length
  return 0
}

function formatMetric(metric, value) {
  if (value == null || isNaN(value)) return '-'
  if (metric.format === 'currency') return '¥' + Math.round(value).toLocaleString()
  if (metric.format === 'pct') return value.toFixed(1) + '%'
  if (metric.format === 'days') return Math.round(value) + ' 天'
  if (metric.format === 'decimal') return value.toFixed(1)
  return Math.round(value).toLocaleString()
}

function deltaText(value, baseValue) {
  if (!baseValue || baseValue === 0) return ''
  const diff = ((value - baseValue) / baseValue) * 100
  if (Math.abs(diff) < 1) return ''
  const sign = diff > 0 ? '↑' : '↓'
  return `${sign}${Math.abs(diff).toFixed(0)}%`
}

// ====== 主导行为 ======
function topBehaviors(members) {
  const memberIds = new Set(members.map(m => m.openid))
  const counts = {}
  allBehaviors.value.forEach(b => {
    if (!memberIds.has(b.userId)) return
    if (!counts[b.action]) counts[b.action] = 0
    counts[b.action]++
  })
  return Object.entries(counts)
    .map(([action, count]) => ({
      action, count, desc: getEventMeta(action)?.desc || action
    }))
    .sort((a, b) => b.count - a.count)
}

// ====== 模块偏好计算（用于雷达图） ======
function moduleProfileOf(members) {
  const memberIds = new Set(members.map(m => m.openid))
  const result = {}
  Object.values(MODULE).forEach(m => { result[m] = 0 })
  allBehaviors.value.forEach(b => {
    if (!memberIds.has(b.userId)) return
    const meta = getEventMeta(b.action)
    const mod = meta?.module || 'system'
    result[mod] = (result[mod] || 0) + 1
  })
  // 归一化
  const total = Object.values(result).reduce((s, c) => s + c, 0)
  if (total === 0) return result
  Object.keys(result).forEach(k => { result[k] = (result[k] / total) * 100 })
  return result
}

// ====== Chart 渲染 ======
const renderCharts = () => {
  if (!radarCanvas.value || !barCanvas.value) return

  // 雷达图
  if (radarChart) radarChart.destroy()
  const moduleKeys = [
    MODULE.COMMERCE, MODULE.IDENTIFY, MODULE.CUSTOM,
    MODULE.STORE, MODULE.ENCYCLOPEDIA, MODULE.SUPPORT, MODULE.CARE
  ]
  const labels = moduleKeys.map(m => MODULE_META[m]?.icon + ' ' + MODULE_META[m]?.name)
  const datasets = selectedCohorts.value.map((c, idx) => {
    const profile = moduleProfileOf(c.members)
    return {
      label: cohortLabel(c),
      data: moduleKeys.map(k => Math.round(profile[k] || 0)),
      borderColor: COMPARE_COLORS[idx],
      backgroundColor: COMPARE_COLORS[idx] + '30',
      borderWidth: 2,
      pointRadius: 3
    }
  })
  radarChart = new Chart(radarCanvas.value, {
    type: 'radar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.r}%` } }
      },
      scales: { r: { beginAtZero: true, max: 100, ticks: { display: false } } }
    }
  })

  // 柱状图：关键指标
  if (barChart) barChart.destroy()
  const barMetrics = ['avgMonetary', 'avgFrequency', 'payRate', 'repurchaseRate']
  const barLabels = barMetrics.map(k => METRICS.find(m => m.key === k).name)
  const barDatasets = selectedCohorts.value.map((c, idx) => ({
    label: cohortLabel(c),
    data: barMetrics.map(k => computeMetric(c.members, k)),
    backgroundColor: COMPARE_COLORS[idx],
    borderRadius: 4
  }))
  barChart = new Chart(barCanvas.value, {
    type: 'bar',
    data: { labels: barLabels, datasets: barDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (c) => {
              const metric = METRICS.find(m => m.name === c.label) || METRICS[c.dataIndex]
              return `${c.dataset.label}: ${formatMetric(METRICS.find(m => m.key === barMetrics[c.dataIndex]), c.parsed.y)}`
            }
          }
        }
      },
      scales: { y: { beginAtZero: true, grid: { color: '#f5f5f5' } } }
    }
  })
}

watch(selectedCohorts, () => nextTick(renderCharts), { deep: true })

onMounted(loadData)
onUnmounted(() => {
  if (radarChart) radarChart.destroy()
  if (barChart) barChart.destroy()
})
</script>

<style scoped>
.cc-container { padding: 16px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }

.picker-card { margin-bottom: 20px; }
.picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.picker-card-inner { background: #fafafa; border: 1px solid #f0f0f0; border-radius: 10px; padding: 14px; position: relative; }
.pc-header { display: flex; gap: 10px; align-items: center; }
.pc-num { width: 24px; height: 24px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; }
.pc-close { color: #ccc; cursor: pointer; font-size: 16px; margin-left: auto; }
.pc-close:hover { color: #f56c6c; }
.rfm-controls { margin-top: 10px; padding: 0 8px; }
.slider-row { display: flex; gap: 12px; align-items: center; font-size: 12px; color: #666; }
.slider-row :deep(.el-slider) { flex: 1; }
.pc-size { display: flex; gap: 6px; align-items: baseline; margin-top: 14px; padding-top: 10px; border-top: 1px dashed #e4e7ed; }
.pc-label { color: #999; font-size: 12px; }
.pc-num-big { font-size: 28px; font-weight: 800; }
.empty-picker { grid-column: 1 / -1; padding: 40px; text-align: center; color: #ccc; }

.kpi-compare-card { margin-bottom: 20px; }
.kpi-table { display: flex; flex-direction: column; }
.kpi-row { display: grid; grid-template-columns: 280px repeat(auto-fit, minmax(160px, 1fr)); border-bottom: 1px solid #f5f5f5; padding: 14px 0; }
.kpi-row-header { border-bottom: 2px solid #f0f0f0; padding-bottom: 16px; }
.kpi-cell { padding: 0 14px; display: flex; flex-direction: column; gap: 4px; border-top: 3px solid transparent; }
.metric-cell { gap: 0; }
.metric-icon { font-size: 16px; }
.metric-name { font-weight: bold; color: #333; font-size: 14px; }
.metric-desc { font-size: 11px; color: #999; }
.kc-name { font-weight: bold; color: #333; font-size: 14px; }
.kc-size { font-size: 11px; color: #999; }
.kc-val { font-size: 18px; font-weight: 700; color: #d4af37; }
.kc-pct { color: #67C23A; }
.kc-delta { font-size: 12px; color: #999; }

.charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
.chart-wrap { height: 320px; position: relative; }

.behavior-table { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.bh-col { background: #fafafa; border-radius: 10px; padding: 14px; }
.bh-title { display: flex; gap: 8px; align-items: center; font-weight: bold; color: #333; padding-bottom: 8px; border-bottom: 2px solid; margin-bottom: 10px; }
.bh-num { width: 22px; height: 22px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; }
.bh-list { display: flex; flex-direction: column; gap: 6px; }
.bh-item { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 4px 0; }
.bh-rank { color: #999; font-weight: bold; width: 28px; }
.bh-action { flex: 1; color: #333; }
.bh-count { color: #d4af37; font-weight: bold; font-family: monospace; }
.empty-bh { padding: 20px; color: #ccc; text-align: center; font-size: 12px; }

.card-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 14px; }
.data-source-tip { background: #fdf6ec; padding: 10px 14px; border-radius: 8px; color: #b7950b; font-size: 12px; display: flex; gap: 8px; align-items: center; }
.data-source-tip code { background: rgba(255,255,255,0.6); padding: 1px 6px; border-radius: 4px; font-family: monospace; }

@media (max-width: 1200px) {
  .charts-row { grid-template-columns: 1fr; }
}
</style>
