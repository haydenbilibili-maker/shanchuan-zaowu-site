<template>
  <div class="operations-decision-center">
    <header class="ops-hero">
      <div class="ops-hero-main">
        <p class="eyebrow">运营决策 · Operations</p>
        <h2 class="ops-hero-title">智能运营决策中心</h2>
        <p class="subtitle">经营驾驶舱与 AI 决策流统一口径：财务账本、商品库存、门店排行、薪酬花名册。</p>
        <p v-if="snapshot" class="ops-hero-meta">
          <span>快照 {{ formatGeneratedAt(snapshot.generatedAt) }}</span>
          <span class="dot" aria-hidden="true">·</span>
          <span>{{ snapshot.period === 'month' ? '本月' : snapshot.period }} · {{ snapshot.yearMonth }}</span>
        </p>
      </div>
      <div class="hero-actions">
        <el-button type="primary" :loading="loadingSnapshot" @click="loadSnapshot">
          <el-icon><Refresh /></el-icon>
          刷新快照
        </el-button>
        <el-button v-if="feature" plain @click="$emit('close')">关闭</el-button>
      </div>
    </header>

    <el-alert
      v-if="snapshotError"
      type="warning"
      show-icon
      :closable="false"
      class="ops-alert"
      :title="snapshotError"
    />

    <div v-if="loadingSnapshot && !snapshot" class="ops-skeleton" aria-busy="true">
      <el-skeleton :rows="2" animated />
      <div class="skeleton-kpis">
        <el-skeleton v-for="n in 6" :key="n" class="sk-kpi" variant="rect" style="height: 96px" animated />
      </div>
    </div>

    <div v-if="snapshot" class="dashboard-grid">
      <div v-for="kpi in snapshot.kpis" :key="kpi.key" class="kpi-card" :class="'kpi-card--' + kpi.key">
        <div class="kpi-label">{{ kpi.label }}</div>
        <div class="kpi-value">{{ kpi.value }}</div>
        <div class="kpi-desc">{{ kpi.desc }}</div>
      </div>
    </div>

    <div v-if="snapshot" class="viz-grid">
      <section class="panel viz-panel">
        <div class="panel-header">
          <div class="panel-title-block">
            <h3>库存结构</h3>
            <p class="panel-lead">按 SKU 状态的分布占比</p>
          </div>
          <span class="panel-meta">{{ snapshot.inventoryViz?.total ?? 0 }} SKU</span>
        </div>
        <div v-if="snapshot.inventoryViz?.segments?.length" class="inv-strip-wrap" role="img" :aria-label="'库存结构 ' + snapshot.inventoryViz.total + ' 件'">
          <div class="inv-strip">
            <div
              v-for="seg in snapshot.inventoryViz.segments"
              :key="seg.key"
              class="inv-seg"
              :class="'inv-seg--' + seg.tone"
              :style="{ flex: Math.max(seg.value, 1) + ' 1 0' }"
              :title="seg.label + ' ' + seg.value"
            />
          </div>
          <ul class="viz-legend">
            <li v-for="seg in snapshot.inventoryViz.segments" :key="'lg-' + seg.key">
              <span class="lg-dot" :class="'inv-seg--' + seg.tone" />
              <span class="viz-legend-label">{{ seg.label }}</span>
              <strong class="viz-legend-val">{{ seg.value }}</strong>
              <span class="viz-pct">{{ formatInventoryPct(seg.value, snapshot.inventoryViz.total) }}%</span>
            </li>
          </ul>
        </div>
        <div v-else class="empty-block">暂无商品分布数据。</div>
      </section>

      <section class="panel viz-panel">
        <div class="panel-header">
          <div class="panel-title-block">
            <h3>周期营收趋势</h3>
            <p class="panel-lead">账本周期内的相对强弱</p>
          </div>
          <span class="panel-meta">{{ snapshot.finance?.sourceLabel || '财务' }}</span>
        </div>
        <p v-if="snapshot.financeTrend?.length && sparkSummary" class="spark-summary">{{ sparkSummary }}</p>
        <div v-if="snapshot.financeTrend?.length" class="spark-wrap">
          <div class="spark-bars" role="img" aria-label="按记录周期的营收柱状趋势">
            <div
              v-for="(pt, i) in snapshot.financeTrend"
              :key="pt.date + '-' + i"
              class="spark-cell"
              :title="(pt.date || '') + ' ¥' + Math.round(pt.revenue).toLocaleString()"
            >
              <div class="spark-bar" :style="{ height: Math.max(4, pt.barPct) + '%' }" />
              <span class="spark-x">{{ formatTrendAxis(pt.date) }}</span>
            </div>
          </div>
        </div>
        <div v-else class="empty-block">暂无账本周期序列，可在财务模块录入后刷新。</div>
      </section>
    </div>

    <div v-if="snapshot" class="ops-layout">
      <section class="panel panel-wide">
        <div class="panel-header">
          <div class="panel-title-block">
            <h3>经营风险与机会</h3>
            <p class="panel-lead">基于当前快照的规则摘要</p>
          </div>
          <el-tag size="small" effect="plain" round :type="snapshot.risks.some((r) => r.level === 'high') ? 'danger' : 'success'">
            {{ snapshot.risks.length ? `${snapshot.risks.length} 个风险` : '风险稳定' }}
          </el-tag>
        </div>
        <div class="insight-grid">
          <div v-for="risk in snapshot.risks" :key="risk.title" class="insight-item risk" :class="risk.level">
            <strong>{{ risk.title }}</strong>
            <p>{{ risk.desc }}</p>
          </div>
          <div v-for="opp in snapshot.opportunities" :key="opp.title" class="insight-item opportunity">
            <strong>{{ opp.title }}</strong>
            <p>{{ opp.desc }}</p>
          </div>
          <div v-if="!snapshot.risks.length && !snapshot.opportunities.length" class="empty-block">暂无显著风险或机会。</div>
        </div>
      </section>

      <section class="panel panel-stores">
        <div class="panel-header">
          <div class="panel-title-block">
            <h3>门店营收</h3>
            <p class="panel-lead">相对本月 Top1 的对比条</p>
          </div>
          <span class="panel-meta">{{ snapshot.yearMonth }}</span>
        </div>
        <div v-if="snapshot.storeBars?.length" class="store-bar-list">
          <div v-for="(row, idx) in snapshot.storeBars" :key="row.id" class="store-bar-row">
            <div class="store-bar-top">
              <span class="rank-badge">{{ idx + 1 }}</span>
              <div class="store-bar-title">
                <strong>{{ row.name }}</strong>
                <p>{{ row.staffCount }} 人 · 人效 ¥{{ Math.round(row.revenuePerStaff).toLocaleString() }}</p>
              </div>
              <span class="store-bar-rev">¥{{ Math.round(row.revenue).toLocaleString() }}</span>
            </div>
            <div class="store-bar-track">
              <div class="store-bar-fill" :style="{ width: row.barPct + '%' }" />
            </div>
          </div>
        </div>
        <div v-else class="empty-block">暂无门店数据。</div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div class="panel-title-block">
            <h3>行动队列</h3>
            <p class="panel-lead">可结合下方「经营诊断」生成更细报告</p>
          </div>
          <el-button type="primary" plain size="small" @click="generateDiagnosis" :loading="diagnosing">生成诊断</el-button>
        </div>
        <ol class="action-list">
          <li v-for="item in snapshot.actionQueue" :key="item">{{ item }}</li>
        </ol>
      </section>
    </div>

    <div v-if="snapshot" class="source-health">
      <div v-for="source in snapshot.sourceHealth" :key="source.name" class="source-pill" :class="source.status">
        <span>{{ source.name }}</span>
        <strong>{{ source.detail }}</strong>
      </div>
    </div>

    <el-tabs v-model="activeTab" type="border-card" class="decision-tabs">
      <el-tab-pane label="经营诊断" name="diagnosis">
        <DecisionAction
          title="经营诊断报告"
          desc="基于统一运营快照，输出健康度评分、关键问题、风险优先级与阶段行动计划。"
          button-text="生成经营诊断报告"
          :loading="diagnosing"
          :result="diagnosisResult"
          :level="diagnosisLevel"
          @run="generateDiagnosis"
          @export="exportReport('经营诊断报告', diagnosisMarkdown)"
        />
      </el-tab-pane>

      <el-tab-pane label="选品推荐" name="selection">
        <div class="ops-inline-controls">
          <el-select v-model="selectionType" class="ops-select" placeholder="选品类型">
            <el-option label="新品推荐" value="new" />
            <el-option label="商品组合优化" value="combination" />
            <el-option label="季节性商品" value="seasonal" />
            <el-option label="滞销商品处理" value="slow-moving" />
          </el-select>
        </div>
        <DecisionAction
          title="选品推荐结果"
          desc="结合热销、滞销、库存与季节，生成新品方向、组合销售与补货建议。"
          button-text="获取选品推荐"
          :loading="selecting"
          :result="selectionResult"
          @run="getSelectionRecommendations"
          @export="exportReport('选品推荐结果', selectionMarkdown)"
        />
      </el-tab-pane>

      <el-tab-pane label="定价策略" name="pricing">
        <div class="ops-inline-controls">
          <el-select v-model="pricingScope" class="ops-select" placeholder="分析范围">
            <el-option label="全部商品" value="all" />
            <el-option label="指定分类" value="category" />
            <el-option label="指定商品" value="product" />
          </el-select>
          <el-select v-if="pricingScope === 'category'" v-model="selectedCategory" class="ops-select" placeholder="选择分类" filterable>
            <el-option v-for="cat in categories" :key="cat" :label="cat" :value="cat" />
          </el-select>
        </div>
        <DecisionAction
          title="定价策略分析"
          desc="基于成本、价格带、库存和销量，输出调价优先级与促销策略。"
          button-text="分析定价策略"
          :loading="pricingAnalyzing"
          :result="pricingResult"
          @run="analyzePricingStrategy"
          @export="exportReport('定价策略分析', pricingMarkdown)"
        />
      </el-tab-pane>

      <el-tab-pane label="库存优化" name="inventory">
        <DecisionAction
          title="库存优化方案"
          desc="识别缺货、低库存、高库存与资金占用，生成补货和清货行动表。"
          button-text="生成库存优化方案"
          :loading="inventoryOptimizing"
          :result="inventoryOptimizationResult"
          @run="optimizeInventory"
          @export="exportReport('库存优化方案', inventoryMarkdown)"
        />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, onMounted, ref } from 'vue'
import { ElButton, ElMessage, ElTag } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { marked } from 'marked'
import { callGeminiAPI } from '../../utils/aiHelper'
import { buildOperationsDecisionData, operationsDataForPrompt } from '../../utils/operationsDecisionData'

const props = defineProps({
  feature: {
    type: Object,
    default: null,
  },
  products: {
    type: Array,
    default: () => [],
  },
  orders: {
    type: Array,
    default: () => [],
  },
})
defineEmits(['close'])

const DecisionAction = defineComponent({
  name: 'DecisionAction',
  props: {
    title: String,
    desc: String,
    buttonText: String,
    loading: Boolean,
    result: String,
    level: String,
  },
  emits: ['run', 'export'],
  setup(componentProps, { emit }) {
    return () => h('div', { class: 'decision-action' }, [
      h('div', { class: 'decision-action-head' }, [
        h('div', { class: 'panel-title-block' }, [
          h('h3', componentProps.title),
          h('p', { class: 'panel-lead decision-desc' }, componentProps.desc),
        ]),
        h('div', { class: 'decision-action-buttons' }, [
          h(ElButton, { type: 'primary', loading: componentProps.loading, onClick: () => emit('run') }, () => componentProps.buttonText),
          h(ElButton, { disabled: !componentProps.result, onClick: () => emit('export') }, () => '导出报告'),
        ]),
      ]),
      componentProps.result
        ? h('div', { class: 'result-card' }, [
          h('div', { class: 'result-header' }, [
            h('h3', componentProps.title),
            componentProps.level
              ? h(ElTag, { type: componentProps.level === '优秀' ? 'success' : componentProps.level === '良好' ? 'warning' : 'danger', effect: 'plain', size: 'small', round: true }, () => componentProps.level)
              : null,
          ]),
          h('div', { class: 'result-content', innerHTML: componentProps.result }),
        ])
        : h('div', { class: 'empty-result ops-empty-hint', role: 'status' }, '点击「生成」后，将基于当前运营快照输出结构化报告。'),
    ])
  },
})

const activeTab = ref('diagnosis')
const loadingSnapshot = ref(false)
const snapshot = ref(null)
const snapshotError = ref('')

const diagnosing = ref(false)
const diagnosisMarkdown = ref('')
const diagnosisResult = ref('')
const diagnosisLevel = ref('')

const selecting = ref(false)
const selectionMarkdown = ref('')
const selectionResult = ref('')
const selectionType = ref('new')

const pricingAnalyzing = ref(false)
const pricingMarkdown = ref('')
const pricingResult = ref('')
const pricingScope = ref('all')
const selectedCategory = ref('')

const inventoryOptimizing = ref(false)
const inventoryMarkdown = ref('')
const inventoryOptimizationResult = ref('')

const categories = computed(() => snapshot.value?.products?.categories || [])

const sparkSummary = computed(() => {
  const trend = snapshot.value?.financeTrend
  if (!trend?.length) return ''
  const revenues = trend.map((p) => Number(p.revenue) || 0)
  const max = Math.max(...revenues)
  const sum = revenues.reduce((a, b) => a + b, 0)
  return `峰值 ¥${Math.round(max).toLocaleString('zh-CN')} · 周期合计 ¥${Math.round(sum).toLocaleString('zh-CN')}`
})

function formatInventoryPct(value, total) {
  const t = Number(total) || 0
  if (t <= 0) return '—'
  return ((Number(value) || 0) / t * 100).toFixed(1)
}

async function loadSnapshot() {
  loadingSnapshot.value = true
  snapshotError.value = ''
  try {
    snapshot.value = await buildOperationsDecisionData({
      products: props.products || [],
      orders: props.orders || [],
      period: 'month',
    })
  } catch (error) {
    console.error('[OperationsDecisionCenter] 快照加载失败:', error)
    snapshotError.value = `运营数据快照加载失败：${error.message || '未知错误'}`
  } finally {
    loadingSnapshot.value = false
  }
}

async function ensureSnapshot() {
  if (!snapshot.value) await loadSnapshot()
  return snapshot.value
}

function renderMarkdown(markdown) {
  return marked.parse(markdown || '')
}

async function runDecision({ loading, markdownRef, htmlRef, systemInstruction, prompt }) {
  loading.value = true
  markdownRef.value = ''
  htmlRef.value = ''
  try {
    const snap = await ensureSnapshot()
    if (!snap) throw new Error('暂无可用运营数据')
    const response = await callGeminiAPI(`${prompt}\n\n## 统一运营数据快照\n${operationsDataForPrompt(snap)}`, {
      systemInstruction,
      temperature: 0.72,
      maxOutputTokens: 2600,
    })
    markdownRef.value = response
    htmlRef.value = renderMarkdown(response)
    ElMessage.success('AI 决策报告生成完成')
    return response
  } catch (error) {
    console.error('[OperationsDecisionCenter] AI 决策失败:', error)
    ElMessage.error('生成失败：' + (error.message || '未知错误'))
    return ''
  } finally {
    loading.value = false
  }
}

async function generateDiagnosis() {
  diagnosisLevel.value = ''
  const response = await runDecision({
    loading: diagnosing,
    markdownRef: diagnosisMarkdown,
    htmlRef: diagnosisResult,
    systemInstruction: '你是一位资深 COO 与门店经营诊断专家，擅长基于多源经营数据识别风险、机会和行动优先级。',
    prompt: `请生成经营诊断报告，必须包含：
1. 经营健康度评分（0-100）与等级（优秀/良好/一般/预警）
2. 财务、商品、库存、门店、人效五类指标解读
3. 高优先级风险与证据指标
4. 未来 7 天、30 天、90 天行动计划
5. 数据口径说明，明确哪些来自财务账本、云订单、本地店铺/薪酬。`,
  })
  const levelMatch = response.match(/等级[：:]\s*([优秀良好一般预警]+)/)
  diagnosisLevel.value = levelMatch?.[1] || (snapshot.value?.risks?.some((r) => r.level === 'high') ? '预警' : '良好')
}

async function getSelectionRecommendations() {
  const typeText = {
    new: '新品推荐',
    combination: '商品组合优化',
    seasonal: '季节性商品',
    'slow-moving': '滞销商品处理',
  }[selectionType.value]
  await runDecision({
    loading: selecting,
    markdownRef: selectionMarkdown,
    htmlRef: selectionResult,
    systemInstruction: '你是一位商品选品与零售运营专家，擅长将商品、库存、销售和客群数据转化为可执行选品策略。',
    prompt: `请围绕「${typeText}」生成选品决策报告，必须包含推荐方向、证据指标、优先级、预估影响、风险与执行清单。`,
  })
}

async function analyzePricingStrategy() {
  await runDecision({
    loading: pricingAnalyzing,
    markdownRef: pricingMarkdown,
    htmlRef: pricingResult,
    systemInstruction: '你是一位定价策略专家，擅长基于成本、销量、库存和价格带制定调价与促销策略。',
    prompt: `请生成定价策略分析。分析范围：${pricingScope.value}${selectedCategory.value ? `；分类：${selectedCategory.value}` : ''}。
必须包含价格带诊断、毛利风险、调价商品类型、促销策略、执行顺序和监控指标。`,
  })
}

async function optimizeInventory() {
  await runDecision({
    loading: inventoryOptimizing,
    markdownRef: inventoryMarkdown,
    htmlRef: inventoryOptimizationResult,
    systemInstruction: '你是一位库存管理专家，擅长平衡缺货风险、资金占用和动销效率。',
    prompt: '请生成库存优化方案，必须包含缺货补货、高库存清理、滞销处理、安全库存建议、7 天执行清单和资金占用风险。',
  })
}

function exportReport(title, markdown) {
  if (!markdown) {
    ElMessage.warning('暂无报告可导出')
    return
  }
  const content = `# ${title}\n\n${markdown}\n\n---\n导出时间：${new Date().toLocaleString('zh-CN')}`
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${title}_${new Date().toISOString().slice(0, 10)}.md`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  ElMessage.success('报告已导出')
}

function formatGeneratedAt(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function formatTrendAxis(dateStr) {
  if (!dateStr) return ''
  const s = String(dateStr)
  if (s.length >= 10) return s.slice(5, 10)
  if (s.length >= 7) return s.slice(5)
  return s
}

onMounted(loadSnapshot)
</script>

<style scoped>
.operations-decision-center {
  padding: var(--space-6);
  color: var(--light-text-primary);
}

.ops-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-6);
  padding: var(--space-6);
  margin-bottom: var(--space-5);
  border-radius: var(--radius-xl);
  background: var(--light-bg-elevated);
  border: 1px solid var(--light-border-default);
  box-shadow: var(--shadow-sm);
  position: relative;
  overflow: hidden;
}

.ops-hero::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: linear-gradient(180deg, var(--gold-400), var(--brand-green-500));
  border-radius: var(--radius-xl) 0 0 var(--radius-xl);
  pointer-events: none;
}

.ops-hero-main {
  position: relative;
  z-index: 1;
  min-width: 0;
}

.eyebrow {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--brand-green-600);
  font-weight: var(--weight-semibold);
}

.ops-hero-title {
  margin: 0 0 var(--space-2);
  font-size: clamp(var(--text-xl), 2.5vw, var(--text-3xl));
  font-weight: var(--weight-semibold);
  font-family: var(--font-cn-display);
  color: var(--brand-green-700);
  letter-spacing: -0.02em;
  line-height: var(--leading-tight);
}

.subtitle {
  margin: 0;
  font-size: var(--text-base);
  line-height: var(--leading-loose);
  color: var(--light-text-secondary);
  max-width: 48ch;
}

.ops-hero-meta {
  margin: var(--space-4) 0 0;
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}

.ops-hero-meta .dot {
  opacity: 0.5;
}

.hero-actions {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  flex-shrink: 0;
}

.ops-alert {
  margin-bottom: var(--space-4);
}

.ops-skeleton {
  margin-bottom: var(--space-5);
}

.skeleton-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.sk-kpi {
  border-radius: var(--radius-lg);
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.kpi-card,
.panel,
.decision-tabs {
  background: var(--light-bg-elevated);
  border: 1px solid var(--light-border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
}

.kpi-card {
  padding: var(--space-5);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.kpi-card:hover {
  border-color: var(--light-border-strong);
  box-shadow: var(--shadow-md);
}

.kpi-label {
  color: var(--light-text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  letter-spacing: 0.02em;
}

.kpi-value {
  margin: var(--space-2) 0 var(--space-1);
  font-size: clamp(1.125rem, 2.4vw, var(--text-2xl));
  font-weight: var(--weight-semibold);
  font-family: var(--font-mono), var(--font-cn-body), system-ui, sans-serif;
  color: var(--brand-green-700);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
}

.kpi-card--stockRisk .kpi-value {
  color: var(--semantic-error-text);
}

.kpi-card--profit .kpi-value {
  color: var(--semantic-success-text);
}

.kpi-desc {
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--light-text-tertiary);
}

.viz-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.viz-panel .panel-header h3 {
  margin: 0;
}

.panel-meta {
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  font-weight: var(--weight-medium);
}

.inv-strip-wrap {
  margin-top: var(--space-2);
}

.inv-strip {
  display: flex;
  height: 18px;
  border-radius: var(--radius-full);
  overflow: hidden;
  background: var(--light-bg-tertiary);
}

.inv-seg {
  min-width: 4px;
  transition: opacity 0.15s ease;
}

.inv-seg:hover {
  opacity: 0.88;
}

.inv-seg--error {
  background: var(--semantic-error-icon);
}

.inv-seg--warning {
  background: var(--semantic-warning-icon);
}

.inv-seg--info {
  background: var(--semantic-info-icon);
}

.inv-seg--success {
  background: var(--semantic-success-icon);
}

.viz-legend {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-5);
  font-size: var(--text-xs);
  color: var(--light-text-secondary);
}

.viz-legend li {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.viz-legend-val {
  color: var(--light-text-primary);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
}

.viz-legend-label {
  color: var(--light-text-secondary);
}

.viz-pct {
  font-size: 0.625rem;
  color: var(--light-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.spark-summary {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--light-text-secondary);
  font-variant-numeric: tabular-nums;
}

.lg-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.spark-wrap {
  margin-top: var(--space-2);
}

.spark-bars {
  display: flex;
  align-items: flex-end;
  justify-content: stretch;
  gap: var(--space-2);
  height: 128px;
  padding: var(--space-3) var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  background: linear-gradient(180deg, var(--light-bg-secondary) 0%, transparent 55%);
  border-bottom: 1px solid var(--light-border-subtle);
}

.spark-cell {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-1);
}

.spark-bar {
  width: 100%;
  max-width: 18px;
  margin: 0 auto;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: linear-gradient(180deg, var(--brand-green-400), var(--brand-green-600));
  min-height: 4px;
  transition: opacity 0.15s ease;
}

.spark-cell:hover .spark-bar {
  opacity: 0.92;
}

.spark-x {
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.store-bar-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.store-bar-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  margin: 0 calc(-1 * var(--space-2));
  border-radius: var(--radius-md);
  transition: background 0.15s ease;
}

.store-bar-row:hover {
  background: var(--light-bg-secondary);
}

.store-bar-top {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

.rank-badge {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-md);
  background: var(--gold-50);
  color: var(--gold-700);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--gold-200);
}

.store-bar-title {
  flex: 1;
  min-width: 0;
}

.store-bar-title strong {
  color: var(--light-text-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}

.store-bar-title p {
  margin: 2px 0 0;
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
}

.store-bar-rev {
  flex-shrink: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--brand-green-700);
  font-variant-numeric: tabular-nums;
}

.store-bar-track {
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--light-bg-tertiary);
  overflow: hidden;
}

.store-bar-fill {
  height: 100%;
  border-radius: var(--radius-full);
  background: linear-gradient(90deg, var(--brand-green-500), var(--brand-green-300));
  transition: width 0.35s ease;
}

.ops-layout {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.panel {
  padding: var(--space-5);
}

.panel-wide {
  grid-row: span 2;
}

.panel-header,
.result-header,
.decision-action-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.panel-title-block {
  min-width: 0;
}

.panel-header h3,
.decision-action h3 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  font-family: var(--font-cn-display);
  color: var(--brand-green-700);
  line-height: var(--leading-tight);
}

.panel-lead {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--light-text-tertiary);
  max-width: 42ch;
}

.decision-desc.panel-lead {
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  max-width: 56ch;
}

.insight-grid {
  display: grid;
  gap: var(--space-3);
}

.insight-item {
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--light-bg-secondary);
  border-left: 4px solid var(--brand-green-500);
  border: 1px solid var(--light-border-subtle);
  border-left-width: 4px;
}

.insight-item strong {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.insight-item.risk.high { border-left-color: var(--semantic-error-text); }
.insight-item.risk.medium { border-left-color: var(--semantic-warning); }
.insight-item.opportunity { border-left-color: var(--gold-400); }

.insight-item p,
.ranking-row p,
.decision-action-head p {
  margin: var(--space-2) 0 0;
  color: var(--light-text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-loose);
}

.ranking-list {
  display: grid;
  gap: 10px;
}

.ranking-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--light-border-subtle);
}

.ranking-row:last-child {
  border-bottom: none;
}

.action-list {
  margin: 0;
  padding-left: var(--space-6);
  font-size: var(--text-sm);
  line-height: var(--leading-loose);
  color: var(--light-text-primary);
}

.action-list li {
  margin-bottom: var(--space-3);
  padding-left: var(--space-1);
}

.action-list li::marker {
  color: var(--brand-green-500);
  font-weight: var(--weight-semibold);
}

.source-health {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.source-pill {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--light-bg-elevated);
  border: 1px solid var(--light-border-default);
  font-size: var(--text-xs);
  line-height: var(--leading-tight);
}

.source-pill span {
  color: var(--light-text-secondary);
}

.source-pill strong {
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
}

.source-pill.ok strong {
  color: var(--semantic-success);
}

.source-pill.empty strong {
  color: var(--semantic-warning);
}

/* 读取失败必须比「空」更显眼：空是数据事实，失败是系统问题，不能看起来差不多 */
.source-pill.error strong {
  color: var(--semantic-error-text);
}
.source-pill.error span {
  color: var(--semantic-error-text);
}

.decision-tabs {
  padding: 0;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.decision-tabs :deep(.el-tabs__header) {
  margin: 0;
  background: var(--light-bg-secondary);
  border-bottom: 1px solid var(--light-border-default);
}

.decision-tabs :deep(.el-tabs__content) {
  padding: var(--space-6);
  background: var(--light-bg-elevated);
}

.decision-tabs :deep(.el-tabs__item) {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}

.decision-tabs :deep(.el-tabs__item.is-active) {
  font-weight: var(--weight-semibold);
  color: var(--brand-green-700);
}

.ops-inline-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.ops-select {
  width: min(100%, 200px);
}

.ops-empty-hint {
  font-size: var(--text-sm);
  line-height: var(--leading-loose);
  color: var(--light-text-secondary);
}

.decision-action-head {
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--light-border-subtle);
}

.decision-action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.result-card {
  background: var(--light-bg-secondary);
  border: 1px solid var(--light-border-default);
  border-radius: var(--radius-md);
  padding: var(--space-6);
  margin-top: var(--space-6);
}

.result-content {
  font-size: var(--text-sm);
  line-height: var(--leading-loose);
  color: var(--light-text-primary);
}

.result-content :deep(h1),
.result-content :deep(h2),
.result-content :deep(h3),
.result-content :deep(h4) {
  color: var(--brand-green-700);
}

.result-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
}

.result-content :deep(table th),
.result-content :deep(table td) {
  border: 1px solid var(--light-border-default);
  padding: 8px 12px;
  text-align: left;
}

.empty-result,
.empty-block {
  padding: var(--space-4) var(--space-5);
  color: var(--light-text-secondary);
  background: var(--light-bg-secondary);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--light-border-default);
  margin-top: var(--space-4);
}

@media (max-width: 960px) {
  .ops-hero,
  .panel-header,
  .decision-action-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .ops-layout {
    grid-template-columns: 1fr;
  }

  .viz-grid {
    grid-template-columns: 1fr;
  }
}
</style>
