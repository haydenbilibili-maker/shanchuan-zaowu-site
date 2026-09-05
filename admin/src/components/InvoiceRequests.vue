<template>
  <div class="invoice-requests">
    <div class="panel-header">
      <div class="title-box">
        <h2>开票申请台 / INVOICE REQUESTS</h2>
        <span class="subtitle">C 端开票 · manageInvoiceRequests</span>
      </div>
      <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
    </div>

    <div class="filter-bar">
      <el-radio-group v-model="statusFilter" fill="#d4af37" @change="onFilterChange">
        <el-radio-button label="">全部</el-radio-button>
        <el-radio-button label="pending">待开具</el-radio-button>
        <el-radio-button label="issued">已开具</el-radio-button>
        <el-radio-button label="rejected">已驳回</el-radio-button>
      </el-radio-group>
      <div class="summary">
        <span>待开具：<b class="warn">{{ pendingHint }}</b></span>
        <span class="muted">本页 {{ list.length }} 条 · 共 {{ total }} 条</span>
      </div>
    </div>

    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" stripe height="calc(100vh - 320px)">
        <template #empty>
          <el-empty description="暂无开票申请" :image-size="88" />
        </template>
        <el-table-column label="申请时间" width="160">
          <template #default="{ row }">
            <div class="ticket-no">{{ fmt(row.createTime) }}</div>
            <div class="ts mono">{{ shortId(row._id) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="订单" width="160">
          <template #default="{ row }">
            <div class="mono">{{ row.orderNo || '—' }}</div>
            <div class="ts" v-if="row.orderMatch?.matched">已匹配订单</div>
          </template>
        </el-table-column>
        <el-table-column label="抬头 / 类型" min-width="180">
          <template #default="{ row }">
            <div class="reason-title">{{ row.title || '—' }}</div>
            <div class="ts">{{ row.invoiceTypeLabel || row.invoiceType || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="联系" width="160">
          <template #default="{ row }">
            <div>{{ row.email || '—' }}</div>
            <div class="ts">{{ row.phone || '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="dark" size="small">
              {{ row.statusLabel || statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'pending'"
              size="small"
              type="success"
              @click="markIssued(row)"
            >标记开具</el-button>
            <el-button
              v-if="row.status === 'pending'"
              size="small"
              type="danger"
              @click="reject(row)"
            >驳回</el-button>
            <el-button size="small" link @click="viewDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager" v-if="total > pageSize">
        <el-pagination
          background
          layout="prev, pager, next"
          :total="total"
          :page-size="pageSize"
          v-model:current-page="page"
          @current-change="loadList"
        />
      </div>
    </el-card>

    <el-drawer v-model="detailDrawer" title="开票申请详情" size="560px" destroy-on-close>
      <div v-if="currentRow" class="detail-panel" v-loading="detailLoading">
        <div class="detail-hero">
          <div class="detail-hero-main">
            <div class="detail-amount">{{ currentRow.title || '—' }}</div>
            <el-tag :type="statusType(currentRow.status)" effect="dark" size="small">
              {{ currentRow.statusLabel || statusLabel(currentRow.status) }}
            </el-tag>
          </div>
          <div class="detail-hero-sub">{{ currentRow.invoiceTypeLabel || currentRow.invoiceType }} · {{ currentRow.orderNo || '无订单号' }}</div>
        </div>

        <div class="detail-actions" v-if="currentRow.status === 'pending'">
          <el-button type="success" @click="markIssued(currentRow)">标记已开具</el-button>
          <el-button type="danger" @click="reject(currentRow)">驳回</el-button>
        </div>

        <div class="detail-section">
          <div class="detail-section-title">开票信息</div>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">抬头</span>
              <span class="detail-value">{{ currentRow.title || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">类型</span>
              <span class="detail-value">{{ currentRow.invoiceTypeLabel || '—' }}</span>
            </div>
            <div class="detail-item detail-item--block" v-if="currentRow.taxNo">
              <span class="detail-label">税号</span>
              <span class="detail-value mono">{{ currentRow.taxNo }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">邮箱</span>
              <span class="detail-value">{{ currentRow.email || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">电话</span>
              <span class="detail-value">{{ currentRow.phone || '—' }}</span>
            </div>
            <div class="detail-item detail-item--block" v-if="currentRow.remark">
              <span class="detail-label">用户备注</span>
              <span class="detail-value">{{ currentRow.remark }}</span>
            </div>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-section-title">订单</div>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">订单号</span>
              <span class="detail-value mono">{{ currentRow.orderNo || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">订单 ID</span>
              <span class="detail-value mono wrap">{{ currentRow.orderId || '—' }}</span>
            </div>
            <div class="detail-item detail-item--block" v-if="currentRow.orderMatch">
              <span class="detail-label">匹配</span>
              <span class="detail-value">{{ currentRow.orderMatch.matched ? '已匹配' : '未匹配' }}{{ currentRow.orderMatch.note ? ` · ${currentRow.orderMatch.note}` : '' }}</span>
            </div>
          </div>
        </div>

        <div class="detail-section" v-if="currentRow.status !== 'pending'">
          <div class="detail-section-title">处理结果</div>
          <div class="detail-grid">
            <div class="detail-item" v-if="currentRow.invoiceNo">
              <span class="detail-label">发票号</span>
              <span class="detail-value mono">{{ currentRow.invoiceNo }}</span>
            </div>
            <div class="detail-item" v-if="currentRow.rejectReason">
              <span class="detail-label">驳回原因</span>
              <span class="detail-value">{{ currentRow.rejectReason }}</span>
            </div>
            <div class="detail-item detail-item--block" v-if="currentRow.staffNote">
              <span class="detail-label">开票备注</span>
              <span class="detail-value">{{ currentRow.staffNote }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">处理人</span>
              <span class="detail-value">{{ currentRow.handledByName || currentRow.handledBy || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">处理时间</span>
              <span class="detail-value">{{ fmtFull(currentRow.handledAt) }}</span>
            </div>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction } from '../cloud'

const FN = 'manageInvoiceRequests'
const opsKey = () => import.meta.env?.VITE_ADMIN_OPS_KEY || undefined

const loading = ref(false)
const detailLoading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const statusFilter = ref('pending')
const detailDrawer = ref(false)
const currentRow = ref(null)

const pendingHint = computed(() => {
  if (statusFilter.value === 'pending') return total.value
  return '—'
})

function shortId(id) {
  const s = String(id || '')
  return s.length > 10 ? s.slice(0, 10) + '…' : s
}

function statusLabel(s) {
  return ({ pending: '待开具', issued: '已开具', rejected: '已驳回' })[s] || s || '—'
}

function statusType(s) {
  return ({ pending: 'warning', issued: 'success', rejected: 'danger' })[s] || 'info'
}

function fmt(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtFull(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN')
}

async function callFn(data) {
  const res = await callCloudFunction(FN, { ...data, adminOpsKey: opsKey() })
  if (!res || res.success === false) {
    throw new Error(res?.msg || '云函数调用失败')
  }
  return res
}

function onFilterChange() {
  page.value = 1
  loadList()
}

async function loadList() {
  loading.value = true
  try {
    const res = await callFn({
      action: 'list',
      status: statusFilter.value,
      page: page.value,
      pageSize
    })
    list.value = res.list || []
    total.value = res.total || 0
  } catch (e) {
    list.value = []
    total.value = 0
    ElMessage.error(e?.message || '加载失败：请确认已部署 manageInvoiceRequests 并配置 ADMIN_OPS_KEY')
  } finally {
    loading.value = false
  }
}

function refresh() {
  loadList()
}

async function viewDetail(row) {
  currentRow.value = row
  detailDrawer.value = true
  detailLoading.value = true
  try {
    const res = await callFn({ action: 'detail', id: row._id })
    if (res.item) currentRow.value = res.item
  } catch (e) {
    ElMessage.warning(e?.message || '详情加载失败，已展示列表数据')
  } finally {
    detailLoading.value = false
  }
}

function markIssued(row) {
  ElMessageBox.prompt('发票号（可选），确认后将标记为已开具并通知用户', '标记已开具', {
    confirmButtonText: '确认开具',
    cancelButtonText: '取消',
    inputPlaceholder: '发票号（可选）',
    inputValue: ''
  })
    .then(async ({ value }) => {
      let staffNote = ''
      try {
        const noteRes = await ElMessageBox.prompt('开票备注（可选）', '开票备注', {
          confirmButtonText: '提交',
          cancelButtonText: '跳过',
          inputPlaceholder: '备注',
          inputValue: ''
        })
        staffNote = noteRes.value || ''
      } catch {
        /* skip note */
      }
      await callFn({
        action: 'markIssued',
        id: row._id,
        invoiceNo: value || '',
        staffNote
      })
      ElMessage.success('已标记开具')
      detailDrawer.value = false
      refresh()
    })
    .catch(() => {})
}

function reject(row) {
  ElMessageBox.prompt('请填写驳回原因（必填，将通知用户）', '驳回开票申请', {
    confirmButtonText: '确认驳回',
    cancelButtonText: '取消',
    inputType: 'textarea',
    inputPlaceholder: '示例：抬头与订单信息不一致，请核对后重新提交',
    inputValidator: (v) => (v && String(v).trim() ? true : '请填写驳回原因')
  })
    .then(async ({ value }) => {
      await callFn({
        action: 'reject',
        id: row._id,
        rejectReason: String(value).trim()
      })
      ElMessage.success('已驳回')
      detailDrawer.value = false
      refresh()
    })
    .catch(() => {})
}

onMounted(refresh)
</script>

<style scoped>
.invoice-requests { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 1px; }
.filter-bar { display: flex; gap: 16px; align-items: center; justify-content: space-between; margin-bottom: 15px; flex-wrap: wrap; }
.summary { display: flex; gap: 16px; font-size: 13px; color: #666; align-items: center; }
.summary .warn { color: #e6a23c; font-size: 16px; }
.summary .muted { color: #999; font-size: 12px; }
.ticket-no { font-weight: 600; color: #333; font-size: 13px; }
.ts { font-size: 11px; color: #999; margin-top: 2px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.reason-title { font-weight: 500; color: #333; }
.pager { display: flex; justify-content: flex-end; margin-top: 12px; }

.detail-panel { padding: 0 4px 24px; }
.detail-hero {
  padding: 16px 18px;
  border-radius: 12px;
  background: linear-gradient(135deg, color-mix(in srgb, #d4af37 12%, #fff), #faf8f2);
  border: 1px solid color-mix(in srgb, #d4af37 28%, transparent);
  margin-bottom: 16px;
}
.detail-hero-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.detail-amount { font-size: 20px; font-weight: 800; color: #333; margin-right: 4px; }
.detail-hero-sub { margin-top: 8px; font-size: 13px; color: #666; }
.detail-section { margin-bottom: 16px; }
.detail-section-title {
  font-size: 13px; font-weight: 700; color: #333; margin-bottom: 10px;
  padding-left: 8px; border-left: 3px solid #d4af37;
}
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
.detail-item {
  display: flex; flex-direction: column; gap: 4px;
  padding: 10px 12px; background: #f7f7f5; border-radius: 8px;
}
.detail-item--block { grid-column: 1 / -1; }
.detail-label { font-size: 11px; color: #999; }
.detail-value { font-size: 13px; color: #222; word-break: break-all; }
.detail-value.wrap { white-space: pre-wrap; }
.detail-actions { display: flex; gap: 8px; margin: 0 0 16px; flex-wrap: wrap; }
</style>
