<template>
  <div class="receipt-claims">
    <div class="panel-header">
      <div class="title-box">
        <h2>小票兑积分审核 / RECEIPT CLAIMS</h2>
        <span class="subtitle">门店小票自助兑积分 · claimStoreReceipt · 通常 3 个工作日</span>
      </div>
      <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
    </div>

    <div class="filter-bar">
      <el-radio-group v-model="statusFilter" fill="#d4af37" @change="onFilterChange">
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
          <el-empty description="暂无小票申请" :image-size="88" />
        </template>
        <el-table-column label="提交时间" width="150">
          <template #default="{ row }">
            <div class="ticket-no">{{ fmt(row.createTime) }}</div>
            <div class="ts mono">{{ shortId(row._id) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="门店 / 金额" min-width="160">
          <template #default="{ row }">
            <div class="reason-title">{{ row.storeName || row.storeId || '未选门店' }}</div>
            <div class="price-tag">¥{{ Number(row.amount || 0).toFixed(2) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="小票图片" width="160">
          <template #default="{ row }">
            <div class="thumbs" v-if="(row.images || row.imageFileIds || []).length">
              <el-image
                v-for="(img, i) in (row.images || row.imageFileIds || []).slice(0, 3)"
                :key="i"
                :src="img"
                :preview-src-list="row.images || row.imageFileIds"
                fit="cover"
                class="thumb"
              />
            </div>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="预估 / 入账" width="120">
          <template #default="{ row }">
            <div class="ts">预估 +{{ row.previewPoints ?? 0 }}</div>
            <div v-if="row.status === 'approved'">入账 +{{ row.pointsGranted ?? 0 }}</div>
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

    <el-drawer v-model="detailDrawer" title="小票申请详情" size="560px" destroy-on-close>
      <div v-if="currentRow" class="detail-panel">
        <div class="detail-hero">
          <div class="detail-hero-main">
            <div class="detail-amount">¥{{ Number(currentRow.amount || 0).toFixed(2) }}</div>
            <el-tag :type="statusType(currentRow.status)" effect="dark" size="small">
              {{ statusLabel(currentRow.status) }}
            </el-tag>
          </div>
          <div class="detail-hero-sub">
            {{ currentRow.storeName || currentRow.storeId || '未选门店' }}
            · 预估 +{{ currentRow.previewPoints ?? 0 }} 分
          </div>
        </div>

        <div class="detail-actions" v-if="currentRow.status === 'pending'">
          <el-button type="success" @click="approve(currentRow)">通过并入账</el-button>
          <el-button type="danger" @click="reject(currentRow)">驳回</el-button>
        </div>

        <div class="detail-section" v-if="(currentRow.images || currentRow.imageFileIds || []).length">
          <div class="detail-section-title">小票图片</div>
          <div class="thumbs large">
            <el-image
              v-for="(img, i) in (currentRow.images || currentRow.imageFileIds)"
              :key="i"
              :src="img"
              :preview-src-list="currentRow.images || currentRow.imageFileIds"
              fit="cover"
              class="thumb"
            />
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-section-title">申请信息</div>
          <div class="detail-grid">
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
              <span class="detail-value">{{ currentRow.storeName || currentRow.storeId || '—' }}</span>
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
              <span class="detail-value">{{ currentRow.reviewByName || currentRow.approvedByName || currentRow.reviewBy || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">审核时间</span>
              <span class="detail-value">{{ fmtFull(currentRow.reviewTime || currentRow.approveTime) }}</span>
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
              <span class="detail-value">{{ currentRow.rejectedBy || currentRow.reviewBy || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">驳回时间</span>
              <span class="detail-value">{{ fmtFull(currentRow.rejectTime || currentRow.reviewTime) }}</span>
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

const FN = 'claimStoreReceipt'

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
        '加载失败，请刷新重试；持续失败请联系技术' /* 技术排查：请确认已部署 Pages 代理 /api/cloud-fn、云函数 claimStoreReceipt，以及 ADMIN_OPS_KEY / TCB_SECRET_* */,
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
    '通过小票申请',
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
          claimId: row._id,
          amount
        })
        ElMessage.success(res.msg || `已入账 +${res.pointsGranted ?? 0} 分`)
        detailDrawer.value = false
        refresh()
      } catch (e) {
        ElMessage.error(e?.message || '通过失败')
      }
    })
    .catch(() => {})
}

function reject(row) {
  ElMessageBox.prompt('请填写驳回原因（可选，默认「店长驳回」）', '驳回小票申请', {
    confirmButtonText: '确认驳回',
    cancelButtonText: '取消',
    inputType: 'textarea',
    inputPlaceholder: '示例：小票不清晰 / 金额无法核对，请重新拍摄后提交',
    inputValue: ''
  })
    .then(async ({ value }) => {
      try {
        await callFn({
          action: 'reject',
          claimId: row._id,
          rejectReason: String(value || '').trim() || undefined
        })
        ElMessage.success('已驳回')
        detailDrawer.value = false
        refresh()
      } catch (e) {
        ElMessage.error(e?.message || '驳回失败')
      }
    })
    .catch(() => {})
}

onMounted(refresh)
</script>

<style scoped>
.receipt-claims { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 1px; }
.filter-bar { display: flex; gap: 16px; align-items: center; justify-content: space-between; margin-bottom: 15px; flex-wrap: wrap; }
.summary { display: flex; gap: 16px; font-size: 13px; color: #666; align-items: center; flex-wrap: wrap; }
.summary .rule { color: #8B6F47; font-size: 12px; max-width: 360px; }
.summary .muted, .muted { color: #999; font-size: 12px; }
.ticket-no { font-weight: 600; color: #333; font-size: 13px; }
.ts { font-size: 11px; color: #999; margin-top: 2px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.reason-title { font-weight: 500; color: #333; }
.reason-desc { font-size: 12px; color: #666; }
.price-tag { color: #c45c26; font-weight: bold; font-size: 15px; }
.pager { display: flex; justify-content: flex-end; margin-top: 12px; }
.thumbs { display: flex; gap: 6px; flex-wrap: wrap; }
.thumbs.large .thumb { width: 120px; height: 120px; }
.thumb { width: 48px; height: 48px; border-radius: 6px; }

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
