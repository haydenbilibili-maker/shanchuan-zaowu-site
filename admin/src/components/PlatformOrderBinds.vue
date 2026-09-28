<template>
  <div class="platform-binds">
    <div class="panel-header">
      <div class="title-box">
        <h2>订单绑定审核 / PLATFORM BINDS</h2>
        <span class="subtitle">外部平台订单兑积分 · bindPlatformOrder</span>
      </div>
      <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
    </div>

    <div class="filter-bar">
      <el-radio-group v-model="statusFilter" @change="onFilterChange">
        <el-radio-button label="pending">待审核</el-radio-button>
        <el-radio-button label="approved">已入账</el-radio-button>
        <el-radio-button label="rejected">已驳回</el-radio-button>
        <el-radio-button label="all">全部</el-radio-button>
      </el-radio-group>
      <div class="summary">
        <span v-if="ruleText" class="rule">{{ ruleText }}</span>
        <span class="muted">本页 {{ list.length }} 条 · 共 {{ total }} 条</span>
      </div>
    </div>

    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" stripe height="calc(100vh - 320px)">
        <template #empty>
          <ErpEmpty
            description="暂无绑定申请"
            hint="顾客在小程序提交外部平台订单兑积分后会出现在此；也可切换上方状态再看。"
          />
        </template>
        <el-table-column label="提交时间" width="150">
          <template #default="{ row }">
            <div class="ticket-no">{{ fmt(row.createTime) }}</div>
            <div class="ts mono">{{ shortId(row._id) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="平台 / 订单号" min-width="200">
          <template #default="{ row }">
            <div class="reason-title">{{ row.platformName || row.platformId || '—' }}</div>
            <div class="mono ts">{{ row.orderNo || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="金额 / 预估分" width="140">
          <template #default="{ row }">
            <div class="price-tag">¥{{ Number(row.amount || 0).toFixed(2) }}</div>
            <div class="ts">+{{ row.previewPoints ?? row.pointsGranted ?? 0 }} 分</div>
          </template>
        </el-table-column>
        <el-table-column label="门店" width="120">
          <template #default="{ row }">
            <div>{{ row.storeId || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="140">
          <template #default="{ row }">
            <div class="reason-desc">{{ row.remark || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="dark" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'pending'"
              size="small"
              type="success"
              @click="approve(row)"
            >通过</el-button>
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

    <el-drawer v-model="detailDrawer" title="绑定申请详情" size="560px" destroy-on-close>
      <div v-if="currentRow" class="detail-panel">
        <div class="detail-hero">
          <div class="detail-hero-main">
            <div class="detail-amount">¥{{ Number(currentRow.amount || 0).toFixed(2) }}</div>
            <el-tag :type="statusType(currentRow.status)" effect="dark" size="small">
              {{ statusLabel(currentRow.status) }}
            </el-tag>
          </div>
          <div class="detail-hero-sub">
            {{ currentRow.platformName || currentRow.platformId }} · {{ currentRow.orderNo }}
            · 预估 +{{ currentRow.previewPoints ?? 0 }} 分
          </div>
        </div>

        <div class="detail-actions" v-if="currentRow.status === 'pending'">
          <el-button type="success" @click="approve(currentRow)">通过并入账</el-button>
          <el-button type="danger" @click="reject(currentRow)">驳回</el-button>
        </div>

        <div class="detail-section">
          <div class="detail-section-title">申请信息</div>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">平台</span>
              <span class="detail-value">{{ currentRow.platformName || currentRow.platformId || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">外部订单号</span>
              <span class="detail-value mono">{{ currentRow.orderNo || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">实付金额</span>
              <span class="detail-value">¥{{ Number(currentRow.amount || 0).toFixed(2) }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">预估积分</span>
              <span class="detail-value">+{{ currentRow.previewPoints ?? 0 }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">门店</span>
              <span class="detail-value">{{ currentRow.storeId || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">提交时间</span>
              <span class="detail-value">{{ fmtFull(currentRow.createTime) }}</span>
            </div>
            <div class="detail-item detail-item--block" v-if="currentRow.remark">
              <span class="detail-label">用户备注</span>
              <span class="detail-value">{{ currentRow.remark }}</span>
            </div>
            <div class="detail-item detail-item--block" v-if="currentRow.memberOpenid || currentRow._openid">
              <span class="detail-label">会员 OpenID</span>
              <span class="detail-value mono wrap">{{ currentRow.memberOpenid || currentRow._openid }}</span>
            </div>
            <div class="detail-item detail-item--block" v-if="currentRow.dedupeKey">
              <span class="detail-label">去重键</span>
              <span class="detail-value mono">{{ currentRow.dedupeKey }}</span>
            </div>
          </div>
        </div>

        <div class="detail-section" v-if="currentRow.status === 'approved'">
          <div class="detail-section-title">入账结果</div>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">实际入账</span>
              <span class="detail-value">+{{ currentRow.pointsGranted ?? 0 }} 分</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">审核人</span>
              <span class="detail-value">{{ currentRow.approvedByName || currentRow.approvedBy || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">审核时间</span>
              <span class="detail-value">{{ fmtFull(currentRow.approveTime) }}</span>
            </div>
          </div>
        </div>

        <div class="detail-section" v-if="currentRow.status === 'rejected'">
          <div class="detail-section-title">驳回结果</div>
          <div class="detail-grid">
            <div class="detail-item detail-item--block">
              <span class="detail-label">驳回原因</span>
              <span class="detail-value">{{ currentRow.rejectReason || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">处理人</span>
              <span class="detail-value">{{ currentRow.rejectedBy || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">驳回时间</span>
              <span class="detail-value">{{ fmtFull(currentRow.rejectTime) }}</span>
            </div>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction } from '../cloud'
import ErpEmpty from './ErpEmpty.vue'

const FN = 'bindPlatformOrder'
/** 鉴权密钥由 /api/cloud-fn 服务端注入 ADMIN_OPS_KEY；勿再依赖 VITE_ 进 SPA */

const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const statusFilter = ref('pending')
const ruleText = ref('')
const detailDrawer = ref(false)
const currentRow = ref(null)

function shortId(id) {
  const s = String(id || '')
  return s.length > 10 ? s.slice(0, 10) + '…' : s
}

function statusLabel(s) {
  return ({ pending: '待审核', approved: '已入账', rejected: '已驳回' })[s] || s || '—'
}

function statusType(s) {
  return ({ pending: 'warning', approved: 'success', rejected: 'danger' })[s] || 'info'
}

function toMs(value) {
  if (!value) return 0
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'object' && value.$date) return new Date(value.$date).getTime()
  if (typeof value.getTime === 'function') return value.getTime()
  const n = Date.parse(value)
  return Number.isFinite(n) ? n : 0
}

function fmt(value) {
  const ms = toMs(value)
  if (!ms) return '—'
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtFull(value) {
  const ms = toMs(value)
  if (!ms) return '—'
  return new Date(ms).toLocaleString('zh-CN')
}

async function callFn(data) {
  const res = await callCloudFunction(FN, data)
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
      action: 'listPending',
      status: statusFilter.value === 'all' ? '' : statusFilter.value,
      page: page.value,
      pageSize
    })
    list.value = res.list || []
    total.value = res.total || 0
    ruleText.value = res.ruleText || ''
  } catch (e) {
    list.value = []
    total.value = 0
    ElMessage.error(
      e?.message ||
        '加载失败，请刷新重试；持续失败请联系技术' /* 技术排查：请确认已部署 Pages 代理 /api/cloud-fn、云函数 bindPlatformOrder，以及 Cloudflare / 云函数环境变量 ADMIN_OPS_KEY、TCB_SECRET_* */,
    )
  } finally {
    loading.value = false
  }
}

function refresh() {
  loadList()
}

function viewDetail(row) {
  currentRow.value = row
  detailDrawer.value = true
}

function approve(row) {
  ElMessageBox.prompt(
    `确认通过并按金额入账？当前金额 ¥${Number(row.amount || 0).toFixed(2)}，预估 +${row.previewPoints ?? 0} 分。可在此修正实付金额（元）。`,
    '通过绑定申请',
    {
      confirmButtonText: '确认入账',
      cancelButtonText: '取消',
      inputValue: String(row.amount ?? ''),
      inputPlaceholder: '实付金额（元）'
    }
  )
    .then(async ({ value }) => {
      const amount = value === '' || value == null ? undefined : Number(value)
      if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
        ElMessage.warning('金额无效')
        return
      }
      try {
        const res = await callFn({
          action: 'approve',
          bindId: row._id,
          amount
        })
        ElMessage.success(res.msg || `已入账 +${res.pointsGranted ?? 0} 分`)
        detailDrawer.value = false
        refresh()
      } catch (e) {
        ElMessage.error(e?.message || '通过失败')
      }
    })
    .catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

function reject(row) {
  ElMessageBox.prompt('请填写驳回原因（可选，默认「店长驳回」）', '驳回绑定申请', {
    confirmButtonText: '确认驳回',
    cancelButtonText: '取消',
    inputType: 'textarea',
    inputPlaceholder: '示例：订单号无法核验，请补充截图后重新提交',
    inputValue: ''
  })
    .then(async ({ value }) => {
      try {
        await callFn({
          action: 'reject',
          bindId: row._id,
          rejectReason: String(value || '').trim() || undefined
        })
        ElMessage.success('已驳回')
        detailDrawer.value = false
        refresh()
      } catch (e) {
        ElMessage.error(e?.message || '驳回失败')
      }
    })
    .catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

onMounted(refresh)
</script>

<style scoped>
.platform-binds { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 1px; }
.filter-bar { display: flex; gap: 16px; align-items: center; justify-content: space-between; margin-bottom: 15px; flex-wrap: wrap; }
.summary { display: flex; gap: 16px; font-size: 13px; color: #666; align-items: center; flex-wrap: wrap; }
.summary .rule { color: #8B6F47; font-size: 12px; max-width: 360px; }
.summary .muted { color: #999; font-size: 12px; }
.ticket-no { font-weight: 600; color: #333; font-size: 13px; }
.ts { font-size: 11px; color: #999; margin-top: 2px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.reason-title { font-weight: 500; color: #333; }
.reason-desc { font-size: 12px; color: #666; }
.price-tag { color: #c45c26; font-weight: bold; font-size: 15px; }
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
.detail-amount { font-size: 28px; font-weight: 800; color: #c45c26; letter-spacing: 0.5px; margin-right: 4px; }
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
