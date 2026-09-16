<template>
  <div class="error-monitor">
    <div class="em-head">
      <div class="em-title">
        <span class="em-dot" :class="statusClass"></span>
        C 端错误监控
        <span class="em-sub">error_logs · logError 上报</span>
      </div>
      <el-button size="small" :loading="loading" @click="load">刷新</el-button>
    </div>

    <!-- 不可读时明确报错，**不显示 0**（0 会被误读为「很健康」） -->
    <el-alert
      v-if="unavailable"
      type="error"
      :closable="false"
      show-icon
      title="错误日志不可读"
      :description="errorText"
    />

    <template v-else>
      <div class="em-kpis">
        <div class="em-kpi">
          <div class="em-num">{{ formatNum(data.total) }}</div>
          <div class="em-lbl">错误总数</div>
        </div>
        <div class="em-kpi">
          <div class="em-num">{{ formatNum(data.affectedUsers) }}</div>
          <div class="em-lbl">受影响用户</div>
        </div>
        <div class="em-kpi">
          <div class="em-num">{{ topTypeLabel }}</div>
          <div class="em-lbl">最多类型</div>
        </div>
      </div>

      <el-alert
        v-if="hasNotes"
        type="warning"
        :closable="false"
        show-icon
        class="em-note"
        :title="data.notes.join('；')"
      />

      <div v-if="data.total === 0" class="em-empty">所选范围内没有错误日志</div>

      <div v-else class="em-grid">
        <div class="em-card">
          <div class="em-card-title">按类型</div>
          <div v-for="t in data.byType" :key="t.key" class="em-row">
            <span class="em-key">{{ t.key }}</span>
            <span class="em-count">{{ t.count }}</span>
          </div>
        </div>

        <div class="em-card">
          <div class="em-card-title">高发页面</div>
          <div v-for="p in data.topPages" :key="p.key" class="em-row">
            <span class="em-key mono">{{ p.key }}</span>
            <span class="em-count">{{ p.count }}</span>
          </div>
        </div>

        <div class="em-card wide">
          <div class="em-card-title">高频错误消息</div>
          <div v-for="m in data.topMessages" :key="m.key" class="em-row">
            <span class="em-key">{{ m.key }}</span>
            <span class="em-count">{{ m.count }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
/**
 * C 端错误监控卡（#26-B）
 *
 * 背景：`logError` → `error_logs` 规则为 `read:false`，且 `admin/src` 原先**零引用**
 * → C 端 JS 错误率在 ERP 完全不可见。此处经 `getAnalyticsDashboard(action:'errors')`
 * 只读代理展示聚合结果（该云函数已在 admin 代理白名单内）。
 *
 * 设计要点：
 *   - 后端读不到时返回 `available:false` → 这里**显示错误而不是 0**，
 *     因为「0 个错误」与「读不到」是完全不同的结论
 *   - 只展示聚合与 Top 列表，不回传全量 stack（避免把日志集合当明细表拉）
 */
import { ref, computed, onMounted } from 'vue'
import { callCloudFunction } from '../cloud'

const props = defineProps({
  startDate: { type: String, default: '' },
  endDate: { type: String, default: '' }
})

const loading = ref(false)
const unavailable = ref(false)
const errorText = ref('')
const data = ref({
  total: 0,
  affectedUsers: 0,
  byType: [],
  byDate: [],
  topPages: [],
  topMessages: [],
  notes: []
})

const statusClass = computed(() => {
  if (unavailable.value) return 'is-error'
  const total = Number(data.value.total) || 0
  if (total === 0) return 'is-ok'
  return total > 50 ? 'is-warn' : 'is-info'
})

const topTypeLabel = computed(() => {
  const first = (data.value.byType || [])[0]
  return first ? `${first.key} (${first.count})` : '—'
})

const hasNotes = computed(() => Array.isArray(data.value.notes) && data.value.notes.length > 0)

function formatNum(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return v >= 10000 ? `${(v / 10000).toFixed(1)} 万` : String(v)
}

async function load() {
  loading.value = true
  unavailable.value = false
  errorText.value = ''
  try {
    const res = await callCloudFunction('getAnalyticsDashboard', {
      action: 'errors',
      startDate: props.startDate || undefined,
      endDate: props.endDate || undefined
    })
    if (!res || res.success === false) {
      unavailable.value = true
      errorText.value = (res && res.msg) || '云函数返回失败'
      return
    }
    const d = res.data || {}
    if (d.available === false) {
      unavailable.value = true
      errorText.value = d.error || 'error_logs 不可读'
      return
    }
    data.value = {
      total: Number(d.total) || 0,
      affectedUsers: Number(d.affectedUsers) || 0,
      byType: Array.isArray(d.byType) ? d.byType : [],
      byDate: Array.isArray(d.byDate) ? d.byDate : [],
      topPages: Array.isArray(d.topPages) ? d.topPages : [],
      topMessages: Array.isArray(d.topMessages) ? d.topMessages : [],
      notes: Array.isArray(d.notes) ? d.notes : []
    }
  } catch (e) {
    unavailable.value = true
    errorText.value = (e && e.message) || '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.error-monitor { margin-top: 18px; background: var(--color-bg-card, #fff); border-radius: 10px; padding: 16px 18px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06); }
.em-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.em-title { font-size: 15px; font-weight: 600; color: var(--color-text-primary); display: flex; align-items: center; gap: 8px; }
.em-sub { font-size: 12px; font-weight: 400; color: var(--color-text-muted); }
.em-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--info); }
.em-dot.is-ok { background: var(--success); }
.em-dot.is-info { background: var(--info); }
.em-dot.is-warn { background: var(--warning); }
.em-dot.is-error { background: var(--danger); }
.em-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.em-kpi { background: var(--color-bg-elevated); border-radius: 8px; padding: 12px 14px; }
.em-num { font-size: 20px; font-weight: 600; color: var(--color-text-primary); }
.em-lbl { font-size: 12px; color: var(--color-text-muted); margin-top: 4px; }
.em-note { margin-top: 12px; }
.em-empty { margin-top: 16px; color: var(--color-text-muted); font-size: 13px; text-align: center; padding: 18px 0; }
.em-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; }
.em-card { background: var(--color-bg-elevated); border-radius: 8px; padding: 12px 14px; }
.em-card.wide { grid-column: 1 / -1; }
.em-card-title { font-size: 13px; color: var(--color-text-secondary); margin-bottom: 8px; }
.em-row { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--color-text-primary); padding: 3px 0; }
.em-key { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.em-key.mono { font-family: monospace; }
.em-count { flex-shrink: 0; color: var(--color-text-muted); }
@media (max-width: 1200px) { .em-grid { grid-template-columns: 1fr; } }
</style>
