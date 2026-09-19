<template>
  <div class="studio-bills">
    <div class="header-section">
      <h2>工作室账单</h2>
      <p class="subtitle">
        门店 → 工作室货款对账。账单是<b>结算的唯一依据</b>：出货单上的结算状态由它派生。
        两步确认：<b>店长标「已付款」→ 超管「确认收款」</b>；确认收款即订单终结
        （账单结清 + 相关出货单转为「已完成」）。集合 <code>ops_settlement_bills</code>。
      </p>
    </div>

    <el-card shadow="never" class="main-card" v-loading="loading">
      <template #header>
        <div class="card-head">
          <div class="filters">
            <el-select v-model="storeFilter" clearable placeholder="门店" style="width: 140px" @change="load">
              <el-option v-for="s in stores" :key="s.id" :label="s.name" :value="s.id" />
            </el-select>
            <el-select v-model="statusFilter" style="width: 150px" @change="load">
              <el-option label="全部状态" value="all" />
              <el-option v-for="s in statuses" :key="s.value" :label="s.label" :value="s.value" />
            </el-select>
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              value-format="YYYY-MM-DD"
              start-placeholder="账期起"
              end-placeholder="账期止"
              style="width: 240px"
              @change="load"
            />
            <el-button @click="load">刷新</el-button>
            <el-button :disabled="!list.length" @click="exportCsv">导出对账明细</el-button>
          </div>
        </div>
      </template>

      <!-- 对账口径：三个数各自什么意思，直接写在页面上 -->
      <div class="summary">
        <div class="summary-cell">
          <div class="summary-label">未收款合计</div>
          <div class="summary-value">{{ outstandingText }}</div>
          <div class="summary-hint">未结 + 已付待确认（钱还没确认到账）</div>
        </div>
        <div class="summary-cell">
          <div class="summary-label">已结清合计</div>
          <div class="summary-value">{{ settledText }}</div>
          <div class="summary-hint">超管已确认收款</div>
        </div>
        <div class="summary-cell">
          <div class="summary-label">待确认收款</div>
          <div class="summary-value">{{ paidPendingCount }} 笔</div>
          <div class="summary-hint">门店已标付款、等你核对到账</div>
        </div>
        <div class="summary-cell">
          <div class="summary-label">本次筛选合计</div>
          <div class="summary-value">{{ filteredText }}</div>
          <div class="summary-hint">{{ list.length }} 张账单</div>
        </div>
      </div>

      <el-table :data="list" stripe size="small" empty-text="暂无账单">
        <el-table-column prop="billNo" label="单号" width="160" />
        <el-table-column prop="storeName" label="门店" width="110" />
        <el-table-column prop="periodText" label="账期" width="200" />
        <el-table-column label="构成" min-width="200">
          <template #default="{ row }">
            材料 ¥{{ money(row.materialCents) }} · 包装 ¥{{ money(row.packagingCents) }} ·
            手工 ¥{{ money(row.laborCents) }}
          </template>
        </el-table-column>
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }"><b>¥{{ money(row.totalCents) }}</b></template>
        </el-table-column>
        <el-table-column label="单/件" width="100">
          <template #default="{ row }">{{ row.shipmentCount }} 单 · {{ row.totalQty }} 件</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="toneOf(row.status)">{{ row.statusLabel }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="留痕" min-width="180">
          <template #default="{ row }">
            <span v-if="row.paidMarkedByName">门店：{{ row.paidMarkedByName }}</span>
            <span v-if="row.settledByName">　收款：{{ row.settledByName }}</span>
            <span v-if="!row.paidMarkedByName && !row.settledByName" class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">明细</el-button>
            <el-button v-if="row.status === 'unsettled'" link type="danger" @click="onVoid(row)">作废</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 明细：这张账单里到底结了哪几张出货单 -->
    <el-dialog v-model="detailVisible" :title="detailTitle" width="760px">
      <el-descriptions :column="2" border size="small" v-if="detail">
        <el-descriptions-item label="单号">{{ detail.billNo }}</el-descriptions-item>
        <el-descriptions-item label="门店">{{ detail.storeName }}</el-descriptions-item>
        <el-descriptions-item label="账期">{{ detail.periodText }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ detail.statusLabel }}</el-descriptions-item>
        <el-descriptions-item label="材料费">¥{{ money(detail.materialCents) }}</el-descriptions-item>
        <el-descriptions-item label="包装费">¥{{ money(detail.packagingCents) }}</el-descriptions-item>
        <el-descriptions-item label="手工费">¥{{ money(detail.laborCents) }}</el-descriptions-item>
        <el-descriptions-item label="合计"><b>¥{{ money(detail.totalCents) }}</b></el-descriptions-item>
        <el-descriptions-item label="本单手工费率">
          {{ detail.laborRatePct === null ? '—' : detail.laborRatePct + '%' }}
        </el-descriptions-item>
        <el-descriptions-item label="门店备注">{{ detail.paidNote || '—' }}</el-descriptions-item>
      </el-descriptions>

      <el-table :data="detailRows" size="small" stripe class="detail-table" empty-text="没有明细">
        <el-table-column prop="shipmentNo" label="出货单号" width="160" />
        <el-table-column prop="shipmentDate" label="出货日" width="120" />
        <el-table-column prop="qtyText" label="件数" width="90" />
        <el-table-column prop="amountText" label="金额" width="120" align="right" />
        <el-table-column prop="settleLabel" label="结算状态" />
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction } from '../cloud'

const FN = 'manageStudioSettlement'

const loading = ref(false)
const list = ref([])
const stores = ref([])
const statuses = ref([])
const storeFilter = ref('')
const statusFilter = ref('all')
const dateRange = ref([])

const detailVisible = ref(false)
const detail = ref(null)
const detailRows = ref([])

function money(cents) {
  const n = Number(cents)
  return Number.isFinite(n) ? (n / 100).toFixed(2) : '0.00'
}

function toneOf(status) {
  if (status === 'settled') return 'success'
  if (status === 'paid_pending') return 'warning'
  if (status === 'void') return 'info'
  return 'danger'
}

function mapRow(b) {
  const r = b || {}
  return {
    ...r,
    materialCents: Number(r.materialCostCents) || 0,
    packagingCents: Number(r.packagingCostCents) || 0,
    laborCents: Number(r.laborCostCents) || 0,
    totalCents: Number(r.totalCents) || 0,
    periodText: r.periodFrom && r.periodTo ? `${r.periodFrom} ~ ${r.periodTo}` : r.periodFrom || '—'
  }
}

async function callFn(data) {
  const res = await callCloudFunction(FN, data)
  if (!res || res.success === false) throw new Error((res && res.msg) || '请求失败')
  return res
}

async function loadMeta() {
  const meta = await callFn({ action: 'bill.meta' })
  statuses.value = (meta && meta.statuses) || []
}

/**
 * 门店筛选选项**从账单列表派生**，不另调出货单云函数。
 *
 * 两个好处：① 少一次跨云函数往返；② 只列出**真有账单**的门店，
 * 不会出现一个选了什么都没有的门店。
 * 只在**未按门店筛选**时重建，否则一筛选选项就会缩成那一家、切不回去。
 */
function rebuildStoreOptions(rows) {
  if (storeFilter.value) return
  const seen = new Map()
  for (const r of rows) {
    if (r.storeId && !seen.has(r.storeId)) seen.set(r.storeId, r.storeName || r.storeId)
  }
  stores.value = [...seen.entries()].map(([id, name]) => ({ id, name }))
}

async function load() {
  loading.value = true
  try {
    const res = await callFn({
      action: 'bill.list',
      storeId: storeFilter.value || '',
      status: statusFilter.value === 'all' ? '' : statusFilter.value,
      limit: 200
    })
    const rows = (res.list || []).map(mapRow)
    list.value = rows
    rebuildStoreOptions(rows)
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
    list.value = []
  } finally {
    loading.value = false
  }
}

/**
 * 未收款/已结清按**账期**过滤（这是对账最关心的维度）。
 * 用账期而不是创建时间：一张 8 月的账单可能 9 月才生成，但归属是 8 月。
 */
const filtered = computed(() => {
  const [from, to] = Array.isArray(dateRange.value) ? dateRange.value : []
  if (!from && !to) return list.value
  return list.value.filter((r) => {
    const a = r.periodFrom || ''
    const b = r.periodTo || r.periodFrom || ''
    if (from && b && b < from) return false
    if (to && a && a > to) return false
    return true
  })
})

const outstandingText = computed(() =>
  '¥' + money(filtered.value.filter((r) => r.status !== 'settled' && r.status !== 'void').reduce((n, r) => n + r.totalCents, 0))
)
const settledText = computed(() =>
  '¥' + money(filtered.value.filter((r) => r.status === 'settled').reduce((n, r) => n + r.totalCents, 0))
)
const paidPendingCount = computed(() => filtered.value.filter((r) => r.status === 'paid_pending').length)
const filteredText = computed(() => '¥' + money(filtered.value.reduce((n, r) => n + r.totalCents, 0)))

async function openDetail(row) {
  loading.value = true
  try {
    const res = await callFn({ action: 'bill.get', id: row._id })
    detail.value = mapRow(res.bill)
    detailRows.value = (res.shipments || []).map((s) => ({
      shipmentNo: s.shipmentNo,
      shipmentDate: s.shipmentDate,
      qtyText: `${s.totalQty} 件`,
      amountText: '¥' + money(Math.round((Number(s.totalAmount) || 0) * 100)),
      settleLabel:
        s.settleStatus === 'settled' ? '已结清' : s.settleStatus === 'paid_pending' ? '已付待确认' : '未结'
    }))
    detailVisible.value = true
  } catch (e) {
    ElMessage.error(e.message || '明细加载失败')
  } finally {
    loading.value = false
  }
}

async function onVoid(row) {
  try {
    await ElMessageBox.confirm(
      `作废账单 ${row.billNo}？其下 ${row.shipmentCount} 张出货单会回到「未结」，可重新入账。`,
      '确认作废',
      { type: 'warning' }
    )
  } catch (e) {
    return
  }
  try {
    const res = await callFn({ action: 'bill.void', id: row._id })
    ElMessage.success(res.msg || '已作废')
    await load()
  } catch (e) {
    ElMessage.error(e.message || '作废失败')
  }
}

/**
 * 导出对账明细（CSV）。
 * 金额导出**元**（带两位小数），便于直接贴进表格核对；
 * 不导出内部 id（对账用不到，也避免外泄）。
 */
function exportCsv() {
  const header = ['单号', '门店', '账期起', '账期止', '材料费', '包装费', '手工费', '合计', '单数', '件数', '状态', '门店标记人', '收款人']
  const lines = [header.join(',')]
  for (const r of filtered.value) {
    lines.push(
      [
        r.billNo,
        r.storeName,
        r.periodFrom || '',
        r.periodTo || '',
        (r.materialCents / 100).toFixed(2),
        (r.packagingCents / 100).toFixed(2),
        (r.laborCents / 100).toFixed(2),
        (r.totalCents / 100).toFixed(2),
        r.shipmentCount,
        r.totalQty,
        r.statusLabel,
        r.paidMarkedByName || '',
        r.settledByName || ''
      ]
        .map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`)
        .join(',')
    )
  }
  // BOM 让 Excel 正确识别 UTF-8，否则中文列名会乱码
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `工作室账单_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${filtered.value.length} 条`)
}

onMounted(async () => {
  try {
    await loadMeta()
    await load()
  } catch (e) {
    ElMessage.error(e.message || '初始化失败')
  }
})
</script>

<style scoped>
/* 颜色一律用 ERP 设计令牌，不写硬编码 hex（report:colors:strict 是只许降的棘轮） */
.studio-bills { padding: var(--space-1, 4px); }
.header-section h2 { margin: 0 0 6px; color: var(--light-text-primary); }
.subtitle { margin: 0 0 var(--space-4, 16px); color: var(--light-text-secondary); font-size: var(--text-sm, 13px); line-height: 1.6; }
.main-card { border-radius: 10px; }
.card-head { display: flex; justify-content: space-between; gap: var(--space-3, 12px); flex-wrap: wrap; }
.filters { display: flex; flex-wrap: wrap; gap: var(--space-2, 8px); align-items: center; }
.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3, 12px);
  margin-bottom: var(--space-4, 16px);
}
.summary-cell {
  border: 1px solid var(--light-border-subtle);
  border-radius: 8px;
  padding: var(--space-3, 12px);
  background: var(--light-bg-elevated);
}
.summary-label { color: var(--light-text-secondary); font-size: var(--text-xs, 12px); }
.summary-value { color: var(--light-text-primary); font-size: var(--text-lg, 20px); font-weight: var(--weight-semibold, 600); margin: 4px 0; }
.summary-hint { color: var(--light-text-tertiary); font-size: var(--text-xs, 12px); line-height: 1.4; }
.muted { color: var(--light-text-tertiary); }
.detail-table { margin-top: var(--space-3, 12px); }
code { background: var(--light-bg-elevated); border: 1px solid var(--light-border-subtle); padding: 0 4px; border-radius: 3px; }
</style>
