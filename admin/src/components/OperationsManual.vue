<template>
  <div class="module-wrapper ops-manual-root">
    <div class="module-header">
      <div class="title-box">
        <h2>山海造物 · 经营手册</h2>
        <span class="subtitle">OPERATIONS MANUAL</span>
      </div>
    </div>

    <div v-if="loading" class="ops-loading">
      <p>正在加载经营手册…</p>
    </div>

    <template v-else-if="data">
      <div class="ops-summary table-card">
        <div class="ops-summary-head">
          <span class="ops-summary-kicker">Nature's Creations</span>
          <span class="ops-summary-hint">经营快照 · 与 VI 手册数据同源</span>
        </div>
        <div class="ops-stats">
          <div class="ops-stat">
            <div class="ops-stat-num">{{ totalConfirmed }}</div>
            <div class="ops-stat-label">已确认决策</div>
          </div>
          <div class="ops-stat">
            <div class="ops-stat-num ops-stat-num--gold">{{ totalPending }}</div>
            <div class="ops-stat-label">待推进项</div>
          </div>
          <div class="ops-stat" :class="{ 'ops-stat--alert': p0Count > 0 }">
            <div class="ops-stat-num">{{ p0Count }}</div>
            <div class="ops-stat-label">P0 立即行动</div>
          </div>
          <div class="ops-stat">
            <div class="ops-stat-num ops-stat-num--date">{{ data.lastUpdated }}</div>
            <div class="ops-stat-label">最后更新</div>
          </div>
        </div>
      </div>

      <div class="ops-toggle" role="tablist" aria-label="手册视图">
        <button
          type="button"
          role="tab"
          :aria-selected="view === 'priority'"
          :class="{ on: view === 'priority' }"
          @click="view = 'priority'"
        >
          优先任务
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="view === 'modules'"
          :class="{ on: view === 'modules' }"
          @click="view = 'modules'"
        >
          全部模块
        </button>
      </div>

      <div v-if="view === 'priority' && data.priorities" class="ops-priority">
        <template v-for="level in ['P0', 'P1', 'P2', 'P3']" :key="level">
          <template v-if="prioritiesByLevel(level).length">
            <div class="ops-priority-block">
              <div class="ops-priority-head">
                <span class="ops-p-badge" :class="'ops-p-badge--' + level.toLowerCase()">{{ level }}</span>
                <span class="ops-p-label" :class="'ops-p-label--' + level.toLowerCase()">{{ pLevels[level].label }}</span>
                <span class="ops-p-count">{{ prioritiesByLevel(level).length }} 项</span>
              </div>
              <div
                v-for="p in prioritiesByLevel(level)"
                :key="p.id"
                class="ops-p-card"
                :class="'ops-p-card--' + level.toLowerCase()"
              >
                <div class="ops-p-task">{{ p.task }}</div>
                <div class="ops-p-why">{{ p.why }}</div>
                <div class="ops-p-meta">
                  <span class="ops-p-mod">{{ modNames[p.module] || p.module }}</span>
                  <span>负责：{{ p.owner }}</span>
                  <span :class="{ 'deps-ok': depsIsClear(p.deps) }">{{ p.deps || '—' }}</span>
                  <span v-if="p.since" class="ops-p-since">录入 {{ p.since }}</span>
                </div>
              </div>
            </div>
          </template>
        </template>
      </div>

      <div v-else-if="view === 'modules'" class="ops-modules">
        <div
          v-for="mod in data.modules"
          :key="mod.id"
          class="ops-mod"
          :class="{ core: mod.weight === 'core' }"
        >
          <div class="ops-mod-head" @click="toggleModule(mod.id)">
            <div class="ops-mod-titles">
              <span v-if="mod.weight === 'core'" class="ops-core-tag">CORE</span>
              <span class="ops-mod-title">{{ mod.title }}</span>
              <span class="ops-mod-sub">{{ mod.subtitle }}</span>
            </div>
            <div class="ops-mod-right">
              <span class="ops-status" :class="'st-' + mod.status">{{ statusLabel(mod.status) }}</span>
              <div class="ops-bar">
                <div
                  class="ops-bar-fill"
                  :class="barFillClass(mod.progress)"
                  :style="{ width: mod.progress + '%' }"
                />
              </div>
              <span class="ops-pct">{{ mod.progress }}%</span>
              <span class="ops-chev" :class="{ open: expandedModules[mod.id] }">▼</span>
            </div>
          </div>

          <div v-show="expandedModules[mod.id]" class="ops-mod-body">
            <div v-if="mod.strategicNote" class="ops-strategic">
              <div class="ops-strategic-k">战略权重说明</div>
              <div class="ops-strategic-t">{{ mod.strategicNote }}</div>
            </div>
            <div v-for="(sec, si) in mod.sections" :key="si" class="ops-sec">
              <div class="ops-sec-head" @click="toggleSection(sectionKey(mod.id, si))">
                <span class="ops-sec-chev" :class="{ open: sectionOpen(mod.id, si) }">▶</span>
                <span class="ops-sec-title">{{ sec.title }}</span>
                <span class="ops-sec-ratio">
                  {{ sec.items.filter((i) => i.type === 'confirmed').length }}/{{ sec.items.length }}
                </span>
              </div>
              <div v-show="sectionOpen(mod.id, si)" class="ops-sec-items">
                <div
                  v-for="(item, ii) in sec.items"
                  :key="ii"
                  class="ops-item"
                  :class="{ pending: item.type === 'pending' }"
                >
                  <span class="ops-item-dot" />
                  <div class="ops-item-body">
                    <div class="ops-item-top">
                      <span class="ops-item-label">{{ item.label }}</span>
                      <span v-if="item.since" class="ops-item-since">{{ item.since }}</span>
                    </div>
                    <div class="ops-item-value">{{ item.value }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="ops-footer">山海造物 · 经营手册 v3.0 · {{ data.lastUpdated }}</div>
    </template>
  </div>
</template>

<script setup>
import { safeWarn } from '../utils/safeStorage.js'
import { ref, computed, onMounted } from 'vue'
import { STORAGE_KEY, DATA_VERSION, initialData } from '../data/operationsManualData.js'

const loading = ref(true)
const data = ref(null)
const expandedModules = ref({ ip: true })
const expandedSections = ref({})
const view = ref('priority')

const pLevels = {
  P0: { label: '立即' },
  P1: { label: '近期' },
  P2: { label: '中期' },
  P3: { label: '远期' },
}

const statusColors = {
  confirmed: { label: '已确认' },
  'in-progress': { label: '推进中' },
  pending: { label: '待展开' },
}

function statusLabel(s) {
  return statusColors[s]?.label || s
}

function prioritiesByLevel(level) {
  return (data.value?.priorities || []).filter((p) => p.level === level)
}

function depsIsClear(deps) {
  return deps && String(deps).includes('无')
}

const modNames = computed(() => {
  const m = {}
  ;(data.value?.modules || []).forEach((mod) => {
    m[mod.id] = mod.title
  })
  return m
})

const totalConfirmed = computed(() => {
  if (!data.value?.modules) return 0
  return data.value.modules.reduce(
    (sum, mod) =>
      sum + mod.sections.reduce((s2, sec) => s2 + sec.items.filter((i) => i.type === 'confirmed').length, 0),
    0,
  )
})

const totalPending = computed(() => {
  if (!data.value?.modules) return 0
  return data.value.modules.reduce(
    (sum, mod) =>
      sum + mod.sections.reduce((s2, sec) => s2 + sec.items.filter((i) => i.type === 'pending').length, 0),
    0,
  )
})

const p0Count = computed(() => (data.value?.priorities || []).filter((p) => p.level === 'P0').length)

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed._v === DATA_VERSION) {
        data.value = parsed
        loading.value = false
        return
      }
    }
  } catch (_) { safeWarn('OperationsManual 非关键操作失败（已忽略）', _) }
  const fresh = { ...initialData, _v: DATA_VERSION }
  data.value = fresh
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh))
  } catch (_) { safeWarn('OperationsManual 非关键操作失败（已忽略）', _) }
  loading.value = false
}

function toggleModule(id) {
  expandedModules.value = { ...expandedModules.value, [id]: !expandedModules.value[id] }
}

function sectionKey(modId, si) {
  return `${modId}-${si}`
}

function sectionOpen(modId, si) {
  const k = sectionKey(modId, si)
  return expandedSections.value[k] !== false
}

function toggleSection(key) {
  const cur = expandedSections.value[key] !== false
  expandedSections.value = { ...expandedSections.value, [key]: !cur }
}

function barFillClass(p) {
  if (p >= 80) return 'ops-bar-fill--gold'
  if (p >= 40) return 'ops-bar-fill--warn'
  return 'ops-bar-fill--muted'
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
/* ERP Studio Mode：标本纸底、白卡片、苔藓绿主色、黄铜金点缀 — 对齐 design-tokens.css */

.ops-manual-root {
  font-family: var(--font-cn-body);
  color: var(--light-text-primary);
}

.ops-loading {
  padding: var(--space-16);
  text-align: center;
  color: var(--gold-600);
  font-size: var(--text-base);
  background: var(--light-bg-elevated);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

/* 复用 App.vue .table-card，并加与模块标题一致的左侧主色条 */
.ops-summary {
  margin-bottom: var(--space-5);
  padding: var(--space-5) var(--space-6);
  border-left: 4px solid var(--primary);
}

.ops-summary-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.ops-summary-kicker {
  font-size: var(--text-xs);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--earth-500);
  font-family: var(--font-en-body);
  font-weight: var(--weight-medium);
}

.ops-summary-hint {
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
}

.ops-stats {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.ops-stat {
  min-width: 5.5rem;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--light-bg-secondary);
  border: 1px solid var(--light-border-subtle);
}

.ops-stat--alert {
  background: var(--semantic-error-bg);
  border-color: rgba(208, 84, 80, 0.28);
}

.ops-stat-num {
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  color: var(--gold-600);
  line-height: var(--leading-tight);
  font-variant-numeric: tabular-nums;
}

.ops-stat-num--gold {
  color: var(--gold-500);
}

.ops-stat-num--date {
  font-size: var(--text-lg);
  color: var(--light-text-primary);
}

.ops-stat-label {
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  font-weight: var(--weight-medium);
}

.ops-toggle {
  display: flex;
  margin-bottom: var(--space-5);
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--light-border-default);
  background: var(--light-bg-elevated);
  box-shadow: var(--shadow-sm);
}

.ops-toggle button {
  flex: 1;
  padding: var(--space-3) var(--space-4);
  text-align: center;
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  font-family: var(--font-cn-body);
  border: none;
  background: transparent;
  color: var(--light-text-secondary);
  transition: background 0.2s, color 0.2s;
}

.ops-toggle button:hover {
  background: var(--light-bg-secondary);
  color: var(--light-text-primary);
}

.ops-toggle button.on {
  background: var(--primary);
  color: var(--light-bg-elevated);
  box-shadow: inset 0 0 0 1px var(--primary-dark);
}

.ops-priority-block {
  margin-bottom: var(--space-5);
}

.ops-priority-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
  padding: 0 var(--space-1);
}

.ops-p-badge {
  display: inline-block;
  padding: 2px var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  font-family: var(--font-cn-body);
  border: 1px solid transparent;
}

.ops-p-badge--p0 {
  background: var(--semantic-error-bg);
  color: var(--semantic-error-text);
  border-color: rgba(208, 84, 80, 0.35);
}

.ops-p-badge--p1 {
  background: var(--semantic-warning-bg);
  color: var(--semantic-warning-text);
  border-color: rgba(196, 165, 90, 0.45);
}

.ops-p-badge--p2 {
  background: var(--semantic-info-bg);
  color: var(--semantic-info-text);
  border-color: rgba(91, 143, 185, 0.35);
}

.ops-p-badge--p3 {
  background: var(--light-bg-tertiary);
  color: var(--light-text-secondary);
  border-color: var(--light-border-default);
}

.ops-p-label {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}

.ops-p-label--p0 {
  color: var(--semantic-error-text);
}

.ops-p-label--p1 {
  color: var(--semantic-warning-text);
}

.ops-p-label--p2 {
  color: var(--semantic-info-text);
}

.ops-p-label--p3 {
  color: var(--light-text-secondary);
}

.ops-p-count {
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.ops-p-card {
  border: 1px solid var(--light-border-subtle);
  border-left-width: 3px;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-2);
  background: var(--light-bg-elevated);
  box-shadow: var(--shadow-sm);
}

.ops-p-card--p0 {
  border-left-color: var(--semantic-error-icon);
  background: linear-gradient(90deg, var(--semantic-error-bg) 0%, var(--light-bg-elevated) 48px);
}

.ops-p-card--p1 {
  border-left-color: var(--semantic-warning-icon);
  background: linear-gradient(90deg, var(--semantic-warning-bg) 0%, var(--light-bg-elevated) 48px);
}

.ops-p-card--p2 {
  border-left-color: var(--semantic-info-icon);
  background: linear-gradient(90deg, var(--semantic-info-bg) 0%, var(--light-bg-elevated) 48px);
}

.ops-p-card--p3 {
  border-left-color: var(--tier-fossil);
  background: linear-gradient(90deg, var(--light-bg-secondary) 0%, var(--light-bg-elevated) 48px);
}

.ops-p-task {
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
  margin-bottom: var(--space-1);
  line-height: var(--leading-normal);
}

.ops-p-why {
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  margin-bottom: var(--space-2);
  line-height: var(--leading-loose);
}

.ops-p-meta {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  align-items: center;
}

.ops-p-mod {
  background: var(--gold-50);
  color: var(--gold-800);
  padding: 2px var(--space-2);
  border-radius: var(--radius-sm);
  border: 1px solid rgba(196, 165, 90, 0.35);
  font-weight: var(--weight-medium);
}

.deps-ok {
  color: var(--semantic-success-text);
}

.ops-p-since {
  color: var(--light-text-tertiary);
  font-family: var(--font-mono);
  margin-left: auto;
}

.ops-mod {
  margin-bottom: var(--space-3);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--light-bg-elevated);
  box-shadow: var(--shadow-sm);
}

.ops-mod.core {
  border-color: var(--gold-300);
  background: linear-gradient(180deg, var(--gold-50) 0%, var(--light-bg-elevated) 56px);
  box-shadow: var(--shadow-md);
}

.ops-mod-head {
  padding: var(--space-3) var(--space-4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  user-select: none;
}

.ops-mod-head:hover {
  background: var(--light-bg-secondary);
}

.ops-mod-titles {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}

.ops-core-tag {
  font-size: 10px;
  font-weight: var(--weight-semibold);
  color: var(--light-bg-elevated);
  background: var(--gold-500);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-family: var(--font-en-body);
  letter-spacing: 0.06em;
}

.ops-mod-title {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--brand-green-700);
}

.ops-mod-sub {
  font-size: var(--text-xs);
  color: var(--earth-600);
  font-family: var(--font-en-body);
}

.ops-mod-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.ops-status {
  font-size: 10px;
  font-family: var(--font-cn-body);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-weight: var(--weight-medium);
}

.ops-status.st-confirmed {
  background: var(--gold-50);
  color: var(--gold-800);
  border: 1px solid rgba(196, 165, 90, 0.35);
}

.ops-status.st-in-progress {
  background: var(--semantic-warning-bg);
  color: var(--semantic-warning-text);
  border: 1px solid rgba(196, 165, 90, 0.45);
}

.ops-status.st-pending {
  background: var(--light-bg-tertiary);
  color: var(--light-text-secondary);
  border: 1px solid var(--light-border-subtle);
}

.ops-bar {
  width: 52px;
  height: 4px;
  background: var(--light-bg-tertiary);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.ops-bar-fill {
  height: 100%;
  border-radius: var(--radius-full);
  transition: width 0.25s ease;
}

.ops-bar-fill--gold {
  background: var(--gold-400);
}

.ops-bar-fill--warn {
  background: var(--semantic-warning-icon);
}

.ops-bar-fill--muted {
  background: var(--tier-fossil);
}

.ops-pct {
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  font-variant-numeric: tabular-nums;
  min-width: 2.25rem;
  text-align: right;
}

.ops-chev {
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  transition: transform 0.2s;
  display: inline-block;
}

.ops-chev.open {
  transform: rotate(180deg);
}

.ops-mod-body {
  padding: 0 var(--space-4) var(--space-3);
}

.ops-strategic {
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-3);
  background: var(--gold-50);
  border-left: 3px solid var(--gold-400);
  border-radius: var(--radius-md);
  border: 1px solid rgba(196, 165, 90, 0.25);
}

.ops-strategic-k {
  font-size: 10px;
  font-weight: var(--weight-semibold);
  color: var(--gold-800);
  letter-spacing: 0.12em;
  font-family: var(--font-cn-body);
  margin-bottom: var(--space-1);
}

.ops-strategic-t {
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  line-height: var(--leading-loose);
}

.ops-sec {
  margin-bottom: var(--space-2);
}

.ops-sec-head {
  padding: var(--space-2) 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  user-select: none;
  border-bottom: 1px solid var(--light-border-subtle);
}

.ops-sec-chev {
  font-size: 9px;
  color: var(--earth-600);
  transition: transform 0.15s;
  display: inline-block;
}

.ops-sec-chev.open {
  transform: rotate(90deg);
}

.ops-sec-title {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--light-text-primary);
}

.ops-sec-ratio {
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.ops-sec-items {
  padding: var(--space-2) 0 var(--space-1);
}

.ops-item {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-2);
  background: var(--light-bg-secondary);
  border-radius: var(--radius-md);
  align-items: flex-start;
  border: 1px solid var(--light-border-subtle);
  border-left: 2px solid var(--gold-300);
}

.ops-item.pending {
  background: var(--semantic-warning-bg);
  border-left-color: var(--semantic-warning-icon);
}

.ops-item-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--gold-400);
  margin-top: 6px;
  flex-shrink: 0;
}

.ops-item.pending .ops-item-dot {
  background: var(--semantic-warning-icon);
}

.ops-item-body {
  flex: 1;
  min-width: 0;
}

.ops-item-top {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.ops-item-label {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--light-text-primary);
}

.ops-item-since {
  font-size: 10px;
  color: var(--light-text-tertiary);
  font-family: var(--font-mono);
}

.ops-item-value {
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  margin-top: 2px;
  line-height: var(--leading-loose);
  word-break: break-word;
}

.ops-footer {
  text-align: center;
  padding: var(--space-5) var(--space-4) var(--space-3);
  color: var(--light-text-tertiary);
  font-size: var(--text-xs);
  font-family: var(--font-en-body);
}
</style>
