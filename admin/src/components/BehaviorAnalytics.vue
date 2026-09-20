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
      v-else-if="sourceNote"
      type="warning"
      :closable="true"
      show-icon
      class="ba-alert"
      title="口径已降级：数字与权威口径不一致"
      :description="sourceNote"
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

    <!-- 祈福墙 · 注册转化监测表（需求 28）：表格式看板 —— 每行口径都来自真实埋点，
         门店码来源单独拆出来（现场转化是这一期的重点） -->
    <el-card shadow="never" class="wall-monitor-card">
      <template #header>
        <div class="card-header">
          <span>🕯️ 祈福墙 · 注册转化监测表</span>
          <span class="hint">
            数据源 user_behaviors 明细（analytics_daily 无 step/来源维度）；「—」= 该环节没有曝光，不是 0%
          </span>
        </div>
      </template>
      <template v-if="wallMonitor.hasData">
        <el-table :data="wallMonitor.steps" size="small" v-loading="loading" class="wall-monitor-table">
          <el-table-column label="环节" min-width="220">
            <template #default="{ row }">
              <span :class="{ 'wm-indent': row.indent }">{{ row.label }}</span>
            </template>
          </el-table-column>
          <el-table-column label="次数" width="90" align="right">
            <template #default="{ row }">{{ formatNum(row.count) }}</template>
          </el-table-column>
          <el-table-column label="独立用户" width="100" align="right">
            <template #default="{ row }">{{ formatNum(row.uv) }}</template>
          </el-table-column>
          <el-table-column label="转化率" width="110" align="right">
            <template #default="{ row }">
              <span v-if="row.rate === null" class="wm-empty">—</span>
              <b v-else :class="convClass(row.rate)">{{ row.rate }}%</b>
            </template>
          </el-table-column>
          <el-table-column label="口径" min-width="260">
            <template #default="{ row }">
              <span class="wm-desc">{{ row.desc }}</span>
            </template>
          </el-table-column>
        </el-table>

        <div class="wall-source-title">按入口来源拆分（门店现场 vs 线上）</div>
        <el-table :data="wallMonitor.sources" size="small" v-loading="loading" class="wall-monitor-table">
          <el-table-column label="来源" min-width="200">
            <template #default="{ row }">
              <div>{{ row.label }}</div>
              <div class="wm-desc">{{ row.hint }}</div>
            </template>
          </el-table-column>
          <el-table-column label="进墙次数" width="100" align="right">
            <template #default="{ row }">{{ formatNum(row.enter) }}</template>
          </el-table-column>
          <el-table-column label="进墙人数" width="100" align="right">
            <template #default="{ row }">{{ formatNum(row.enterUv) }}</template>
          </el-table-column>
          <el-table-column label="落愿成功" width="100" align="right">
            <template #default="{ row }">{{ formatNum(row.post) }}</template>
          </el-table-column>
          <el-table-column label="转化率" width="110" align="right">
            <template #default="{ row }">
              <span v-if="row.rate === null" class="wm-empty">—</span>
              <b v-else :class="convClass(row.rate)">{{ row.rate }}%</b>
            </template>
          </el-table-column>
        </el-table>
      </template>
      <el-empty v-else :description="wallMonitorEmptyHint" :image-size="60" />
    </el-card>

    <!-- 📱 物料码转化监测（2026-09-20）：三张印刷二维码的扫码→到达→转化。
         口径只可能来自 user_behaviors 明细 —— 归因值 `entrySource` 是文档顶层字段，
         而 analytics_daily 是「日期+action」二维汇总、**没有来源维度**，按它算会把三张码
         合并成一个数（这正是本功能要解决的问题）。故本卡片复用本页已加载的明细，
         不新增云查询。 -->
    <el-card shadow="never" class="wall-monitor-card">
      <template #header>
        <div class="card-header">
          <span>📱 物料码转化监测</span>
          <span class="hint">
            口径 = 明细行 <code>entrySource === 'qr:&lt;物料 key&gt;'</code>（会话级归因，扫码后该会话全部事件都带）；
            「—」= 分母为 0，不是 0%
          </span>
        </div>
      </template>

      <el-alert
        v-if="qrMaterialTotals.fallback > 0"
        type="warning"
        :closable="false"
        show-icon
        class="ba-alert"
        title="有失效码：扫码进来落到了首页，需要重新印制或发版兜底"
        :description="`共 ${formatNum(qrMaterialTotals.fallback)} 条 fallback_home 记录（页面解析不到物料且未能重映射）—— 该码已失效，现场立牌建议重印。`"
      />

      <template v-if="qrMaterialRows.length">
        <el-table :data="qrMaterialRows" size="small" v-loading="loading" class="wall-monitor-table">
          <el-table-column label="物料" min-width="260">
            <template #default="{ row }">
              <div>{{ row.label }}</div>
              <div class="wm-desc">{{ row.hint }}</div>
            </template>
          </el-table-column>
          <el-table-column label="扫码进入" width="110" align="right">
            <template #default="{ row }">
              <div>{{ formatNum(row.enterUv) }} 人</div>
              <div class="wm-desc">{{ formatNum(row.enterCount) }} 次</div>
            </template>
          </el-table-column>
          <el-table-column label="到达目标页" width="120" align="right">
            <template #default="{ row }">{{ formatNum(row.pageUv) }}</template>
          </el-table-column>
          <el-table-column label="关键转化" width="110" align="right">
            <template #default="{ row }">
              <div>{{ formatNum(row.convertUv) }}</div>
              <div class="wm-desc">{{ row.convertLabel }}</div>
            </template>
          </el-table-column>
          <el-table-column label="总转化率" width="110" align="right">
            <template #default="{ row }">
              <span v-if="row.rate === null" class="wm-empty">—</span>
              <b v-else :class="convClass(row.rate)">{{ row.rate }}%</b>
            </template>
          </el-table-column>
          <el-table-column label="码状态" min-width="200">
            <template #default="{ row }">
              <el-tag v-if="row.fallback > 0" size="small" type="warning">
                ⚠️ 该码已失效 · {{ formatNum(row.fallback) }} 条落首页
              </el-tag>
              <span v-else class="wm-desc">正常</span>
            </template>
          </el-table-column>
        </el-table>
        <div class="wm-desc mat-note">
          三张码的归因（<code>entrySource</code>）<b>从新版本发布后</b>才开始记录，历史数据无法回溯；
          因此卡片里的数字天然小于「AI 鉴定 / 注册」等全站口径。
        </div>
      </template>
      <el-empty v-else v-loading="loading" :description="qrMaterialEmptyHint" :image-size="60" />
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
        「物料码转化监测」卡片只读 <code>user_behaviors</code> 明细 —— 归因值 <code>entrySource</code> 是明细顶层字段，
        而 <code>analytics_daily</code> 是「日期+动作」汇总、<b>没有来源维度</b>，按它算会把三张码合并成一个数。
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

    <!-- #26-B：C 端错误监控（error_logs 只读代理）。放在模板末尾以避免上移既有行号 -->
    <error-monitor :start-date="resolvedStart" :end-date="resolvedEnd" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { Refresh, InfoFilled } from '@element-plus/icons-vue'
import { getCdnDatabase, fetchCollectionWhere } from '../cloud'
import { ElMessage } from 'element-plus'
import Chart from 'chart.js/auto'
import { MODULE, MODULE_META, EVENTS, FUNNELS, QR_MATERIALS, getEventMeta, ACTION_NAMES } from '../utils/analyticsSchema'
import { buildWallMonitor } from '../utils/wishWallMonitor'
// 采样上限单一真源：避免同一指标在不同页面取样上限不一致（原实现此处写死 1000）
import { BEHAVIOR_SAMPLE_LIMIT, DAILY_ROLLUP_LIMIT } from '../utils/analyticsLimits'
import ErrorMonitor from './ErrorMonitor.vue'

const EMPTY_TRACKING = '所选时间段暂无埋点数据'

// ----- 状态 -----
const loading = ref(false)
const loadError = ref('')
const guideVisible = ref(false)
const rangePreset = ref('7d')
const dateRange = ref([])
/**
 * #26-B：把当前生效的起止日期暴露给子组件（ErrorMonitor）。
 * 优先用自定义区间；否则留空由子组件自己决定（不传 = 服务端按「至今」处理）。
 */
const resolvedStart = computed(() => {
  const r = dateRange.value
  return Array.isArray(r) && r.length === 2 && r[0] ? String(r[0]).slice(0, 10) : ''
})
const resolvedEnd = computed(() => {
  const r = dateRange.value
  return Array.isArray(r) && r.length === 2 && r[1] ? String(r[1]).slice(0, 10) : ''
})
const trendMetric = ref('count')
const topMetric = ref('count')
const selectedModule = ref(MODULE.IDENTIFY)

// 原始数据
const rawEvents = ref([])           // 每日聚合行：{ dateKey, action, module, count, uv:[] }
const sessionIds = ref([])          // 真实 sessionId 列表（来自 user_behaviors）
const pageAgg = ref([])             // { page, pv, uv }
const wallRows = ref([])            // 祈福墙监测表用的 user_behaviors 明细（与漏斗同源，口径一致）
const pageStatsNote = ref('')
/**
 * 口径降级说明（#26）。
 *
 * 为什么需要：`analytics_daily`（权威聚合）读失败时，原实现只是 `console.warn` 后把 rawEvents 置空，
 * 随后 `aggregateLocal(behaviorRows)` 会**静默改用 user_behaviors 明细推算** ——
 * 用户看到的仍是数字，但口径已经换了，**无从察觉**。这与仓库「禁止静默兜底」原则冲突。
 * 现在把降级显式呈现出来。
 */
const sourceNote = ref('')
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
  sourceNote.value = ''
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
        DAILY_ROLLUP_LIMIT
      )
      rawEvents.value = dailyRows || []
    } catch (e) {
      // #26：不再静默。透出真实原因（含 RUNTIME 场合的 code/堆栈摘要），并标注口径已降级。
      const detail = [e?.message, e?.code, e?.runtime].filter(Boolean).join(' · ')
      console.warn('analytics_daily 不可读，降级 user_behaviors', detail)
      rawEvents.value = []
      sourceNote.value =
        'analytics_daily（权威日汇总）读取失败，本页数字已退回「user_behaviors 明细现场推算」，'
        + '口径与权威不一致，仅供参考。原因：' + (detail || '未知')
    }

    // 页面 / 会话级明细：从 user_behaviors 聚合（analytics_daily 无 page/sessionId）
    let behaviorRows = []
    try {
      const ms = new Date(start + 'T00:00:00').getTime()
      const me = new Date(end + 'T23:59:59').getTime()
      behaviorRows = await fetchCollectionWhere(
        'user_behaviors',
        { timestamp: _.gte(ms).and(_.lte(me)) },
        BEHAVIOR_SAMPLE_LIMIT
      )
      applyBehaviorExtras(behaviorRows)
      // 监测表与漏斗**同源**（同一批明细）：两处数字不一致会被当成"报表坏了"
      wallRows.value = behaviorRows
      // 先确定 rawEvents 基线，再合并合成行 —— 原实现顺序相反，导致被覆盖后漏斗恒 0
      if (!rawEvents.value.length) {
        rawEvents.value = aggregateLocal(behaviorRows)
      }
      mergeSyntheticRows(buildGateStepRows(behaviorRows))
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
 * 带 step 的漏斗事件集合：**从 analyticsSchema 的 FUNNELS 派生**，不再写死单个 action。
 *
 * ⚠️ 2026-09-18 真缺陷：这里原来硬编码 `identify_save_atlas_gate`，
 * 于是**祈福墙**的 `wish_wall_register_gate:show/dismiss/resume_success` 从来没被展开 →
 * 「祈福墙 · 落愿注册钩子」漏斗**恒为 0**（与 identify 当初那个"恒为 0"是同一个坑，只是换了个 action）。
 * 现在任何在 FUNNELS 里声明了 `action:step` 的漏斗都会自动展开 —— 新增漏斗不必回来改这里。
 */
const STEP_GATE_ACTIONS = Array.from(new Set(
  FUNNELS
    .flatMap((f) => (f.steps || []))
    .map((s) => /^([^:]+):([^:]+)$/.exec(String((s && s.action) || '')))
    .filter(Boolean)
    .map((m) => m[1])
))

/**
 * 注册钩子漏斗：把**带 step 的漏斗事件**按 step 展开成合成 action
 * （identify_save_atlas_gate:show / :go_register / …；wish_wall_register_gate:show / :dismiss / :resume_success / :fail_*），
 * 追加进 rawEvents 后即可复用通用 FUNNELS 渲染。
 *
 * 注：analytics_daily 是动作级汇总、不含 step，故此处必须从 user_behaviors 明细派生。
 *
 * ⚠️ 调用时序（真实缺陷修复 2026-09-16）：本函数返回**合成行数组**，由调用方在
 * `rawEvents` 最终确定之后合并。原实现直接 `rawEvents.value = rawEvents.value.concat(rows)`，
 * 但它在 `rawEvents.value = aggregateLocal(behaviorRows)` **之前**执行 —— 当 analytics_daily
 * 不可读（`rawEvents` 为空）时，紧随其后的赋值会**整体覆盖**，合成行被丢弃，
 * 于是「AI 识别 · 注册钩子」漏斗恒为 0。改为返回数组 + 合并去重，彻底消除顺序依赖。
 */
const buildGateStepRows = (events = []) => {
  const map = {}
  events.forEach((ev) => {
    if (!STEP_GATE_ACTIONS.includes(ev.action)) return
    // step 由客户端 properties 展开到顶层（云端 flattenProperties），两种位置都兼容
    const step = String(ev.step || (ev.properties && ev.properties.step) || '').trim()
    if (!step) return
    const dateKey = (new Date(ev.timestamp || Date.now())).toISOString().split('T')[0]
    // ⚠️ 2026-09-20 修：这里原来写的是 `${GATE_ACTION}:${step}`，而 `GATE_ACTION` **全仓无定义**
    //    （HEAD 版本同样如此 → 非本次改动引入）。明细里只要出现任一 `STEP_GATE_ACTIONS` 命中事件
    //    就会抛 `ReferenceError`，被下面的 catch 吞掉 → 注册钩子类漏斗**恒 0**，且页面**谎报**
    //    「user_behaviors 不可读」。合成 action 必须用**该事件自己的 action**（上面刚按它过滤过），
    //    才能与 FUNNELS 里声明的 `action:step` 对上（由 check:analytics-schema 的 F 段防回归）。
    const action = `${ev.action}:${step}`
    const key = `${dateKey}|${action}`
    if (!map[key]) {
      map[key] = {
        dateKey,
        action,
        module: ev.module || getEventMeta(ev.action)?.module,
        count: 0,
        uv: new Set()
      }
    }
    map[key].count++
    const uid = ev.userId || ev._openid
    if (uid) map[key].uv.add(uid)
  })
  return Object.values(map).map((r) => ({ ...r, uv: Array.from(r.uv) }))
}

/** 把合成行并入 rawEvents（同 dateKey+action 相加，避免与明细重复计数） */
const mergeSyntheticRows = (rows = []) => {
  if (!rows.length) return
  const merged = rawEvents.value.slice()
  const index = new Map(merged.map((r, i) => [`${r.dateKey}|${r.action}`, i]))
  rows.forEach((row) => {
    const key = `${row.dateKey}|${row.action}`
    const at = index.get(key)
    if (at == null) {
      index.set(key, merged.length)
      merged.push(row)
      return
    }
    const prev = merged[at]
    const uvSet = new Set([...(Array.isArray(prev.uv) ? prev.uv : []), ...(row.uv || [])])
    merged[at] = { ...prev, count: (prev.count || 0) + (row.count || 0), uv: Array.from(uvSet) }
  })
  rawEvents.value = merged
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
/** 祈福墙监测表：纯函数在 utils/wishWallMonitor.js（口径与聚合都能单测/守卫） */
const wallMonitor = computed(() => buildWallMonitor(wallRows.value))
const wallMonitorEmptyHint = computed(() =>
  wallRows.value.length
    ? '所选区间内没有祈福墙埋点'
    : '所选区间内没有 user_behaviors 明细（监测表不读 analytics_daily：它没有 step 与来源维度）'
)

/* ----- 📱 物料码转化监测（2026-09-20）-----
 *
 * 口径（三张印刷二维码各自的扫码→到达→转化）：
 *   1. 归因：app 级入口识别到码后把 `entrySource = 'qr:<key>'` 写进会话，
 *      此后**该会话内所有事件**都带它（云端白名单字段，落在 user_behaviors 顶层）；
 *   2. 因此本卡片必须**按 entrySource 在明细行上过滤**：
 *      - 扫码进入 = `action === 'qr_material_enter'`（step=open 为主；step 缺失的也计入，
 *        因为「能扫码进入」本身就是事实，且兼容未写 step 的旧版本上报）
 *      - 到达目标页 = `action === 'page_view' && page === targetPage`
 *      - 关键转化 = `action === convertAction`
 *      - 失效提醒 = `step === 'fallback_home'` 的条数（码已失效）
 *   3. 为什么不用 `funnelData`：它只按 action 全局计数、不区分物料；
 *      为什么不用 `analytics_daily`：它是「dateKey+action」汇总，**没有来源维度**。
 */
const qrMaterialActionLabel = (action) => {
  const meta = getEventMeta(action)
  return meta?.desc ? meta.desc.split('（')[0] : action
}

/** 一条明细行的 step（云端 flattenProperties 会同时写到顶层与 properties 里，两处都兼容） */
const qrMaterialStep = (ev = {}) =>
  String(ev.step || (ev.properties && ev.properties.step) || '').trim()

/** 去重用户数；明细行没有 userId/_openid 时退回行数（口径要在卡片上说明） */
const qrUv = (rows = []) => {
  const ids = new Set()
  let noId = 0
  rows.forEach((ev) => {
    const uid = ev.userId || ev._openid
    if (uid) ids.add(uid)
    else noId += 1
  })
  return ids.size + noId
}

const qrMaterialRows = computed(() => QR_MATERIALS.map((qr) => {
  const source = `qr:${qr.key}`
  const rows = wallRows.value.filter((ev) => ev.entrySource === source)
  const enterRows = rows.filter((ev) => ev.action === 'qr_material_enter')
  // 严格只算 step=open；缺 step 的旧上报也计入（兼容），fallback_home 明确排除
  const openRows = enterRows.filter((ev) => {
    const step = qrMaterialStep(ev)
    return step === 'open' || step === ''
  })
  // 分母为 0 时 rate 保持 null → 模板渲染「—」，而不是误导性的 0%
  const enterUv = qrUv(openRows)
  const pageUv = qrUv(rows.filter((ev) => ev.action === 'page_view' && ev.page === qr.targetPage))
  const convertUv = qrUv(rows.filter((ev) => ev.action === qr.convertAction))
  const rate = enterUv > 0 ? ((convertUv / enterUv) * 100).toFixed(1) : null
  return {
    key: qr.key,
    label: qr.label,
    hint: `entrySource = ${source} · scene ${qr.scene}`,
    enterUv,
    enterCount: openRows.length,
    pageUv,
    convertUv,
    convertLabel: qrMaterialActionLabel(qr.convertAction),
    rate,
    fallback: rows.filter((ev) => qrMaterialStep(ev) === 'fallback_home').length
  }
}))

const qrMaterialTotals = computed(() => ({
  fallback: qrMaterialRows.value.reduce((sum, r) => sum + r.fallback, 0)
}))

const qrMaterialEmptyHint = computed(() =>
  wallRows.value.length
    ? '暂无该物料数据（埋点自新版本发布后开始记录）'
    : '所选区间内没有 user_behaviors 明细（本卡片不读 analytics_daily：它没有来源维度）'
)

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


.wall-monitor-card { margin-bottom: 20px; }
.wall-monitor-table { margin-bottom: 8px; }
/* ⚠️ 不写死颜色：report:colors:strict 是**棘轮**，新增硬编码色会直接把守卫弄红。
   这里用设计 token（浅色面正文/次级），既合规范也不会让残留计数变多。 */
.wall-source-title { margin: 10px 0 6px; font-size: 13px; color: var(--light-text-tertiary); }
.wm-indent { padding-left: 14px; color: var(--light-text-tertiary); }
.wm-desc { font-size: 12px; color: var(--light-text-secondary); }
.wm-empty { color: var(--light-text-tertiary); }
/* 物料码卡片脚注（复用监测表字号/配色，不新增硬编码色） */
.mat-note { margin-top: 8px; line-height: 1.6; }

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
