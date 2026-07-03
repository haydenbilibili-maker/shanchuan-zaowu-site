<template>
  <div class="content-review">
    <div class="panel-header">
      <div class="title-box">
        <h2>内容复盘 · CONTENT RETROSPECT</h2>
        <span class="subtitle">PIECES METRICS + 飞轮回灌选题库</span>
      </div>
      <div class="header-actions">
        <el-radio-group v-model="rangePreset" size="small" @change="onRangeChange">
          <el-radio-button label="all">全部已发布</el-radio-button>
          <el-radio-button label="30d">近 30 天</el-radio-button>
        </el-radio-group>
        <el-button :icon="Refresh" circle :loading="loading" @click="refresh" title="刷新" />
        <el-button type="primary" :loading="generating" @click="runRetrospect">运行复盘 Agent</el-button>
      </div>
    </div>

    <!-- KPI（BehaviorAnalytics 范式） -->
    <div class="kpi-strip">
      <div class="kpi-card big">
        <div class="kpi-top"><span class="lbl">总播放</span><span class="ico">👁️</span></div>
        <div class="kpi-val">{{ formatNum(metrics.totalViews) }}</div>
        <div class="kpi-sub">已发布 {{ metrics.publishedCount }} 条</div>
      </div>
      <div class="kpi-card highlight">
        <div class="kpi-top"><span class="lbl">平均完播率</span><span class="ico">▶️</span></div>
        <div class="kpi-val">{{ metrics.avg完播率 }}%</div>
        <div class="kpi-sub">有数据条目均值</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><span class="lbl">总收藏</span><span class="ico">⭐</span></div>
        <div class="kpi-val">{{ formatNum(metrics.total收藏) }}</div>
        <div class="kpi-sub">内容吸引力</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><span class="lbl">评论具体句</span><span class="ico">💬</span></div>
        <div class="kpi-val">{{ formatNum(metrics.total评论具体句) }}</div>
        <div class="kpi-sub">非泛泛互动</div>
      </div>
      <div class="kpi-card warn">
        <div class="kpi-top"><span class="lbl">引流私域</span><span class="ico">🔗</span></div>
        <div class="kpi-val">{{ formatNum(metrics.total引流私域) }}</div>
        <div class="kpi-sub">转化向指标</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><span class="lbl">周期</span><span class="ico">📅</span></div>
        <div class="kpi-val kpi-period">{{ metrics.period }}</div>
        <div class="kpi-sub">复盘飞轮周期</div>
      </div>
    </div>

    <!-- 图表区 -->
    <div class="main-grid">
      <el-card shadow="never" class="chart-card">
        <template #header>
          <div class="card-header">
            <span>📈 发布内容播放趋势</span>
            <el-select v-model="trendMetric" size="small" style="width: 120px" @change="renderTrendChart">
              <el-option label="播放量" value="views" />
              <el-option label="发布条数" value="count" />
            </el-select>
          </div>
        </template>
        <div class="chart-wrap"><canvas ref="trendCanvas"></canvas></div>
      </el-card>

      <el-card shadow="never" class="chart-card">
        <template #header>
          <div class="card-header"><span>🍩 平台播放分布</span></div>
        </template>
        <div class="chart-wrap"><canvas ref="donutCanvas"></canvas></div>
        <div class="platform-legend">
          <div v-for="p in platformBreakdown" :key="p.key" class="lg-item">
            <span class="lg-dot" :style="{ background: p.color }"></span>
            <span class="lg-name">{{ p.label }}</span>
            <span class="lg-num">{{ formatNum(p.views) }}</span>
          </div>
        </div>
      </el-card>
    </div>

    <!-- Top 内容 -->
    <el-card shadow="never" class="top-card">
      <template #header>
        <div class="card-header"><span>🔥 Top 已发布内容（按播放）</span></div>
      </template>
      <el-table :data="metrics.topPieces" size="small" v-loading="loading" stripe>
        <el-table-column type="index" width="48" />
        <el-table-column prop="title" label="标题" min-width="180" show-overflow-tooltip />
        <el-table-column label="平台" width="88">
          <template #default="{ row }">{{ platformLabels[row.platform] || row.platform }}</template>
        </el-table-column>
        <el-table-column prop="views" label="播放" width="88" sortable>
          <template #default="{ row }">{{ formatNum(row.views) }}</template>
        </el-table-column>
        <el-table-column prop="完播率" label="完播%" width="80" />
        <el-table-column prop="收藏" label="收藏" width="72" />
        <el-table-column prop="引流私域" label="私域" width="72" />
      </el-table>
    </el-card>

    <!-- 复盘记录 -->
    <el-card shadow="never" class="records-card">
      <template #header>
        <div class="card-header">
          <span>🔄 复盘记录 · content_analytics</span>
          <el-button size="small" link @click="loadRecords">刷新</el-button>
        </div>
      </template>
      <div v-if="!records.length" class="empty-hint">暂无复盘记录，点击「运行复盘 Agent」</div>
      <div v-for="rec in records" :key="rec._id" class="rec-block section-card">
        <div class="rec-head">
          <el-tag size="small">{{ rec.period }}</el-tag>
          <span class="rec-by">{{ rec.generatedBy }}</span>
        </div>
        <div v-if="rec.insights?.length" class="rec-section">
          <div class="rec-label">洞察</div>
          <ul><li v-for="(x, i) in rec.insights" :key="i">{{ x }}</li></ul>
        </div>
        <div v-if="rec.nextTopics?.length" class="rec-section">
          <div class="rec-label">回灌选题（flywheel）</div>
          <el-tag v-for="(t, i) in rec.nextTopics" :key="i" size="small" class="topic-tag">{{ t }}</el-tag>
        </div>
        <div v-if="rec.stopList?.length" class="rec-section stop">
          <div class="rec-label">停做清单</div>
          <ul><li v-for="(x, i) in rec.stopList" :key="i">{{ x }}</li></ul>
        </div>
      </div>
    </el-card>

    <div class="data-source-tip">
      <el-icon><InfoFilled /></el-icon>
      <span>
        指标来源：<code>content_pieces.metrics</code>（已发布工单）；
        行为参考：<code>analytics_daily</code>（与 BehaviorAnalytics 同源）。
        复盘结果写入 <code>content_analytics</code>，<code>nextTopics</code> 回灌 <code>content_topics</code>（source=flywheel）。
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { Refresh, InfoFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import Chart from 'chart.js/auto'
import { useContentBoard } from '../../composables/useContentBoard'
import { useContentAgents } from '../../composables/useContentAgents'
import { getCdnDatabase } from '../../utils/cloudbaseCdnDb'
import {
  assembleContentMetrics,
  fetchBehaviorSnippet,
  PLATFORM_CHART_COLORS,
} from '../../utils/contentMetrics'
import { PLATFORM_LABELS } from '../../config/contentConstitution'

const { fetchPieces, fetchAnalytics } = useContentBoard()
const { retrospect } = useContentAgents()

const loading = ref(false)
const generating = ref(false)
const rangePreset = ref('all')
const trendMetric = ref('views')
const allPieces = ref([])
const records = ref([])
const platformLabels = PLATFORM_LABELS

const trendCanvas = ref(null)
const donutCanvas = ref(null)
let trendChart = null
let donutChart = null

const filteredPieces = computed(() => {
  const pub = allPieces.value.filter((p) => p.state === 'published')
  if (rangePreset.value !== '30d') return pub
  const cutoff = Date.now() - 30 * 86400000
  return pub.filter((p) => (p.publishMeta?.publishedAt || p.updatedAt || 0) >= cutoff)
})

const metrics = ref(assembleContentMetrics([]))

const platformBreakdown = computed(() => {
  const bp = metrics.value.byPlatform || {}
  return Object.entries(bp).map(([key, v]) => ({
    key,
    label: platformLabels[key] || key,
    views: v.views || 0,
    count: v.count || 0,
    color: PLATFORM_CHART_COLORS[key] || PLATFORM_CHART_COLORS.other,
  })).sort((a, b) => b.views - a.views)
})

const formatNum = (n) => {
  if (n == null) return '-'
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return Number(n).toLocaleString()
}

async function loadRecords() {
  try {
    records.value = await fetchAnalytics()
  } catch {
    records.value = []
  }
}

async function refresh() {
  loading.value = true
  try {
    allPieces.value = await fetchPieces()
    const behavior = await fetchBehaviorSnippet(getCdnDatabase)
    metrics.value = assembleContentMetrics(filteredPieces.value, behavior)
    await loadRecords()
  } catch (e) {
    ElMessage.error('加载指标失败：' + (e.message || e))
  } finally {
    loading.value = false
    await nextTick()
    renderTrendChart()
    renderDonutChart()
  }
}

function onRangeChange() {
  const behavior = metrics.value.behaviorSnippet
  metrics.value = assembleContentMetrics(filteredPieces.value, behavior)
  nextTick(() => {
    renderTrendChart()
    renderDonutChart()
  })
}

async function runRetrospect() {
  generating.value = true
  try {
    const behavior = await fetchBehaviorSnippet(getCdnDatabase)
    const assembled = assembleContentMetrics(filteredPieces.value, behavior)
    metrics.value = assembled

    const res = await retrospect(assembled, { persist: true, period: assembled.period })
    if (!res.ok) throw new Error(res.error)

    const n = res.data?.flywheelTopicIds?.length || res.data?.nextTopics?.length || 0
    ElMessage.success(`复盘完成 · 已写入 analytics · 回灌 ${n} 条选题`)
    await loadRecords()
  } catch (e) {
    ElMessage.error(e.message || '复盘失败')
  } finally {
    generating.value = false
  }
}

function renderTrendChart() {
  if (!trendCanvas.value) return
  if (trendChart) trendChart.destroy()

  const trend = metrics.value.trendByDate || {}
  const dates = Object.keys(trend).sort()
  const values = dates.map((d) =>
    trendMetric.value === 'count' ? trend[d].count : trend[d].views
  )

  trendChart = new Chart(trendCanvas.value, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: trendMetric.value === 'count' ? '发布条数' : '播放量',
        data: values,
        borderColor: '#d4af37',
        backgroundColor: 'rgba(212, 175, 55, 0.12)',
        borderWidth: 2,
        tension: 0.35,
        fill: true,
        pointRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' } },
        x: { grid: { display: false }, ticks: { color: '#888', maxRotation: 45 } },
      },
    },
  })
}

function renderDonutChart() {
  if (!donutCanvas.value) return
  if (donutChart) donutChart.destroy()

  const data = platformBreakdown.value.filter((p) => p.views > 0)
  if (!data.length) {
    donutChart = new Chart(donutCanvas.value, {
      type: 'doughnut',
      data: { labels: ['暂无'], datasets: [{ data: [1], backgroundColor: ['#333'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
    })
    return
  }

  donutChart = new Chart(donutCanvas.value, {
    type: 'doughnut',
    data: {
      labels: data.map((p) => p.label),
      datasets: [{
        data: data.map((p) => p.views),
        backgroundColor: data.map((p) => p.color),
        borderWidth: 2,
        borderColor: '#141210',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => {
              const total = c.dataset.data.reduce((a, b) => a + b, 0)
              const pct = total ? ((c.parsed / total) * 100).toFixed(1) : 0
              return `${c.label}: ${formatNum(c.parsed)} (${pct}%)`
            },
          },
        },
      },
    },
  })
}

onMounted(refresh)

onUnmounted(() => {
  if (trendChart) trendChart.destroy()
  if (donutChart) donutChart.destroy()
})

watch(filteredPieces, () => onRangeChange(), { deep: true })
</script>

<style scoped>
.content-review {
  padding: 8px 0 24px;
  color: #e0e0e0;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.title-box h2 {
  margin: 0;
  font-size: 20px;
  color: #d4af37;
  border-left: 4px solid #d4af37;
  padding-left: 12px;
  font-weight: 700;
}

.title-box .subtitle {
  color: #666;
  font-size: 11px;
  padding-left: 16px;
  letter-spacing: 1.5px;
}

.header-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.kpi-strip {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

@media (max-width: 1100px) {
  .kpi-strip { grid-template-columns: repeat(3, 1fr); }
}

.kpi-card {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  padding: 14px 16px;
  border-top: 3px solid rgba(212, 175, 55, 0.25);
}

.kpi-card.big {
  border-top-color: #d4af37;
  background: linear-gradient(145deg, #1c1c1c, #0a0a0a);
  color: #d4af37;
}

.kpi-card.highlight { border-top-color: #d4af37; }
.kpi-card.warn { border-top-color: #c45c4a; }

.kpi-top {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  opacity: 0.75;
}

.kpi-val {
  font-size: 24px;
  font-weight: 800;
  margin-top: 6px;
}

.kpi-period { font-size: 18px; }

.kpi-sub {
  font-size: 11px;
  color: #888;
  margin-top: 4px;
}

.main-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}

@media (max-width: 900px) {
  .main-grid { grid-template-columns: 1fr; }
}

.chart-card,
.top-card,
.records-card {
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(212, 175, 55, 0.15);
  margin-bottom: 16px;
}

.chart-card :deep(.el-card__header),
.top-card :deep(.el-card__header),
.records-card :deep(.el-card__header) {
  border-bottom: 1px solid rgba(212, 175, 55, 0.1);
  color: #e0e0e0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: 14px;
}

.chart-wrap {
  height: 260px;
  position: relative;
}

.platform-legend {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lg-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.lg-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.lg-name { flex: 1; color: #aaa; }
.lg-num { font-weight: 600; color: #e0e0e0; }

.section-card {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(212, 175, 55, 0.12);
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 12px;
}

.rec-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.rec-by { font-size: 12px; color: #666; }

.rec-label {
  font-size: 12px;
  font-weight: 600;
  color: #d4af37;
  margin-bottom: 6px;
}

.rec-section ul {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.55;
  color: #ccc;
}

.rec-section.stop ul { color: #e8a090; }

.topic-tag { margin: 2px 4px 2px 0; }

.empty-hint {
  text-align: center;
  color: #666;
  padding: 24px;
  font-size: 13px;
}

.data-source-tip {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: #666;
  margin-top: 8px;
  line-height: 1.5;
}

.data-source-tip code {
  color: #c4a76c;
  font-size: 11px;
}

:deep(.el-table) {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: rgba(0, 0, 0, 0.3);
  color: #e0e0e0;
}

:deep(.el-table th.el-table__cell) { color: #d4af37; }
</style>
