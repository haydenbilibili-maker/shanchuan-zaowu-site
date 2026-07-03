<template>
  <div class="cf-subpanel content-review">
    <div class="cf-subheader cf-review-header">
      <div>
        <h3>内容复盘</h3>
        <p>PIECES METRICS + 飞轮回灌选题库</p>
      </div>
      <div class="cf-toolbar cf-toolbar--end">
        <el-radio-group v-model="rangePreset" size="small" @change="onRangeChange">
          <el-radio-button label="all">全部已发布</el-radio-button>
          <el-radio-button label="30d">近 30 天</el-radio-button>
        </el-radio-group>
        <el-button :icon="Refresh" circle :loading="loading" @click="refresh" title="刷新" />
        <el-button type="primary" :loading="generating" @click="runRetrospect">运行复盘 Agent</el-button>
      </div>
    </div>

    <div class="cf-kpi-strip">
      <div class="cf-kpi-card is-hero">
        <div class="cf-kpi-top"><span>总播放</span><span>👁️</span></div>
        <div class="cf-kpi-val">{{ formatNum(metrics.totalViews) }}</div>
        <div class="cf-kpi-sub">已发布 {{ metrics.publishedCount }} 条</div>
      </div>
      <div class="cf-kpi-card is-highlight">
        <div class="cf-kpi-top"><span>平均完播率</span><span>▶️</span></div>
        <div class="cf-kpi-val">{{ metrics.avg完播率 }}%</div>
        <div class="cf-kpi-sub">有数据条目均值</div>
      </div>
      <div class="cf-kpi-card">
        <div class="cf-kpi-top"><span>总收藏</span><span>⭐</span></div>
        <div class="cf-kpi-val">{{ formatNum(metrics.total收藏) }}</div>
        <div class="cf-kpi-sub">内容吸引力</div>
      </div>
      <div class="cf-kpi-card">
        <div class="cf-kpi-top"><span>评论具体句</span><span>💬</span></div>
        <div class="cf-kpi-val">{{ formatNum(metrics.total评论具体句) }}</div>
        <div class="cf-kpi-sub">非泛泛互动</div>
      </div>
      <div class="cf-kpi-card is-warn">
        <div class="cf-kpi-top"><span>引流私域</span><span>🔗</span></div>
        <div class="cf-kpi-val">{{ formatNum(metrics.total引流私域) }}</div>
        <div class="cf-kpi-sub">转化向指标</div>
      </div>
      <div class="cf-kpi-card">
        <div class="cf-kpi-top"><span>周期</span><span>📅</span></div>
        <div class="cf-kpi-val" style="font-size: 18px">{{ metrics.period }}</div>
        <div class="cf-kpi-sub">复盘飞轮周期</div>
      </div>
    </div>

    <div class="cf-chart-grid">
      <el-card shadow="never" class="cf-chart-card">
        <template #header>
          <div class="cf-chart-header">
            <span>发布内容播放趋势</span>
            <el-select v-model="trendMetric" size="small" style="width: 120px" @change="renderTrendChart">
              <el-option label="播放量" value="views" />
              <el-option label="发布条数" value="count" />
            </el-select>
          </div>
        </template>
        <div class="cf-chart-wrap"><canvas ref="trendCanvas"></canvas></div>
      </el-card>

      <el-card shadow="never" class="cf-chart-card">
        <template #header>
          <div class="cf-chart-header"><span>平台播放分布</span></div>
        </template>
        <div class="cf-chart-wrap"><canvas ref="donutCanvas"></canvas></div>
        <div class="platform-legend">
          <div v-for="p in platformBreakdown" :key="p.key" class="cf-legend-item">
            <span class="cf-legend-dot" :style="{ background: p.color }"></span>
            <span class="cf-muted" style="flex: 1">{{ p.label }}</span>
            <span style="font-weight: 600">{{ formatNum(p.views) }}</span>
          </div>
        </div>
      </el-card>
    </div>

    <el-card shadow="never" class="cf-chart-card">
      <template #header>
        <div class="cf-chart-header"><span>Top 已发布内容（按播放）</span></div>
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

    <el-card shadow="never" class="cf-chart-card">
      <template #header>
        <div class="cf-chart-header">
          <span>复盘记录 · content_analytics</span>
          <el-button size="small" link @click="loadRecords">刷新</el-button>
        </div>
      </template>
      <div v-if="!records.length" class="cf-muted empty-hint">暂无复盘记录，点击「运行复盘 Agent」</div>
      <div v-for="rec in records" :key="rec._id" class="cf-rec-block">
        <div class="rec-head">
          <el-tag size="small">{{ rec.period }}</el-tag>
          <span class="cf-muted rec-by">{{ rec.generatedBy }}</span>
        </div>
        <div v-if="rec.insights?.length" class="rec-section">
          <div class="cf-rec-label">洞察</div>
          <ul><li v-for="(x, i) in rec.insights" :key="i">{{ x }}</li></ul>
        </div>
        <div v-if="rec.nextTopics?.length" class="rec-section">
          <div class="cf-rec-label">回灌选题（flywheel）</div>
          <el-tag v-for="(t, i) in rec.nextTopics" :key="i" size="small" class="topic-tag">{{ t }}</el-tag>
        </div>
        <div v-if="rec.stopList?.length" class="rec-section stop">
          <div class="cf-rec-label">停做清单</div>
          <ul><li v-for="(x, i) in rec.stopList" :key="i">{{ x }}</li></ul>
        </div>
      </div>
    </el-card>

    <div class="cf-data-tip">
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
        borderColor: '#2d6a4f',
        backgroundColor: 'rgba(45, 106, 79, 0.12)',
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
        y: { beginAtZero: true, grid: { color: 'rgba(26, 24, 21, 0.07)' }, ticks: { color: '#9b968d' } },
        x: { grid: { display: false }, ticks: { color: '#9b968d', maxRotation: 45 } },
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
      data: { labels: ['暂无'], datasets: [{ data: [1], backgroundColor: ['#e5e2db'] }] },
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
        borderColor: '#ffffff',
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
  padding-bottom: var(--space-6);
}

.cf-review-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.cf-toolbar--end {
  margin-bottom: 0;
}

.platform-legend {
  margin: var(--space-3) var(--space-4) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rec-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.rec-section ul {
  margin: 0;
  padding-left: 18px;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--light-text-secondary);
}

.rec-section.stop ul {
  color: var(--semantic-error-text);
}

.topic-tag {
  margin: 2px 4px 2px 0;
}

.empty-hint {
  text-align: center;
  padding: var(--space-6);
}
</style>
