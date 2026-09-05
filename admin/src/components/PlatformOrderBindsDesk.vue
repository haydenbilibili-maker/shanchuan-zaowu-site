<template>
  <div class="bind-desk">
    <div class="panel-header">
      <div class="title-box">
        <h2>订单绑定审核台</h2>
        <span class="subtitle">PLATFORM ORDER BINDS · platform_order_binds</span>
      </div>
      <el-button :icon="Refresh" circle @click="loadList" title="刷新" />
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="hint"
      :title="ruleText
        ? `赠分规则：${ruleText}。对接 bindPlatformOrder（listPending / approve / reject）。`
        : '对接云函数 bindPlatformOrder。通过后按门店积分规则赠分；需 ADMIN_OPS_KEY / VITE_ADMIN_OPS_KEY。'"
    />

    <div class="toolbar">
      <el-radio-group v-model="statusFilter" @change="onFilterChange">
        <el-radio-button label="pending">待审核</el-radio-button>
        <el-radio-button label="approved">已通过</el-radio-button>
        <el-radio-button label="rejected">已驳回</el-radio-button>
      </el-radio-group>
    </div>

    <div class="layout">
      <div class="list-pane" v-loading="loading">
        <el-table
          :data="list"
          highlight-current-row
          height="100%"
          @current-change="onSelect"
        >
          <el-table-column prop="platformName" label="平台" width="110" />
          <el-table-column prop="orderNo" label="订单号" min-width="140" show-overflow-tooltip />
          <el-table-column label="金额" width="90">
            <template #default="{ row }">¥{{ Number(row.amount || 0).toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="预估积分" width="90">
            <template #default="{ row }">{{ row.previewPoints ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="statusType(row.status)" size="small" effect="plain">
                {{ statusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="申请时间" width="150">
            <template #default="{ row }">{{ fmt(row.createTime) }}</template>
          </el-table-column>
        </el-table>
        <div class="pager">
          <el-pagination
            v-model:current-page="page"
            :page-size="pageSize"
            :total="total"
            layout="total, prev, pager, next"
            small
            @current-change="loadList"
          />
        </div>
      </div>

      <div class="detail-pane" v-if="current">
        <div class="detail-header">
          <div>
            <div class="d-title">{{ current.platformName || current.platformId }} · {{ current.orderNo }}</div>
            <div class="d-sub">申请人 {{ maskOpenid(current.memberOpenid || current._openid) }}</div>
          </div>
          <el-tag :type="statusType(current.status)" effect="dark">{{ statusLabel(current.status) }}</el-tag>
        </div>

        <el-descriptions :column="1" border size="small" class="desc">
          <el-descriptions-item label="平台">{{ current.platformName || current.platformId }}</el-descriptions-item>
          <el-descriptions-item label="订单号">{{ current.orderNo }}</el-descriptions-item>
          <el-descriptions-item label="申报金额">¥{{ Number(current.amount || 0).toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="预估积分">{{ current.previewPoints ?? '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="current.pointsGranted != null" label="实赠积分">{{ current.pointsGranted }}</el-descriptions-item>
          <el-descriptions-item label="申请人">{{ maskOpenid(current.memberOpenid || current._openid) }}</el-descriptions-item>
          <el-descriptions-item label="门店">{{ current.storeId || '全局' }}</el-descriptions-item>
          <el-descriptions-item label="备注">{{ current.remark || '—' }}</el-descriptions-item>
          <el-descriptions-item label="申请时间">{{ fmt(current.createTime) }}</el-descriptions-item>
          <el-descriptions-item v-if="current.rejectReason" label="驳回原因">{{ current.rejectReason }}</el-descriptions-item>
          <el-descriptions-item v-if="current.approvedByName" label="审核人">{{ current.approvedByName }}</el-descriptions-item>
        </el-descriptions>

        <div v-if="current.status === 'pending'" class="actions">
          <el-form label-width="90px" class="approve-form">
            <el-form-item label="确认金额">
              <el-input-number v-model="approveAmount" :min="0.01" :precision="2" :step="10" />
            </el-form-item>
          </el-form>
          <el-button type="primary" color="#2D5A3F" :loading="acting" @click="confirmApprove">通过并赠分</el-button>
          <el-button type="danger" plain @click="openReject">驳回</el-button>
        </div>
      </div>
      <div v-else class="detail-pane empty-detail">选择左侧申请查看详情</div>
    </div>

    <el-dialog v-model="rejectVisible" title="驳回绑定申请" width="440px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="驳回原因">
          <el-input v-model="rejectReason" type="textarea" :rows="3" placeholder="选填" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" :loading="acting" @click="confirmReject">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction } from '../cloud'

const loading = ref(false)
const acting = ref(false)
const list = ref([])
const current = ref(null)
const statusFilter = ref('pending')
const page = ref(1)
const pageSize = 20
const total = ref(0)
const ruleText = ref('')
const approveAmount = ref(0)
const rejectVisible = ref(false)
const rejectReason = ref('')

function adminOpsKey() {
  return import.meta.env?.VITE_ADMIN_OPS_KEY || undefined
}

function statusLabel(s) {
  return { pending: '待审核', approved: '已通过', rejected: '已驳回' }[s] || s || '—'
}

function statusType(s) {
  return { pending: 'warning', approved: 'success', rejected: 'danger' }[s] || 'info'
}

function fmt(t) {
  if (!t) return '—'
  const d = t instanceof Date ? t : new Date(t)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN')
}

function maskOpenid(id) {
  const s = String(id || '')
  if (!s) return '—'
  if (s.length <= 10) return s
  return `${s.slice(0, 6)}…${s.slice(-4)}`
}

async function callBind(action, data = {}) {
  const result = await callCloudFunction('bindPlatformOrder', {
    action,
    adminOpsKey: adminOpsKey(),
    ...data
  })
  const body = result?.result ?? result
  if (!body || body.success === false) {
    throw new Error(body?.msg || '云函数调用失败')
  }
  return body
}

async function loadList() {
  loading.value = true
  try {
    const body = await callBind('listPending', {
      status: statusFilter.value,
      page: page.value,
      pageSize
    })
    list.value = body.list || []
    total.value = body.total || 0
    if (body.ruleText) ruleText.value = body.ruleText
    if (current.value) {
      const hit = list.value.find((r) => r._id === current.value._id)
      if (hit) {
        current.value = hit
        approveAmount.value = Number(hit.amount) || 0
      }
    }
  } catch (e) {
    list.value = []
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function onFilterChange() {
  page.value = 1
  current.value = null
  loadList()
}

function onSelect(row) {
  if (!row) return
  current.value = row
  approveAmount.value = Number(row.amount) || 0
}

function openReject() {
  rejectReason.value = ''
  rejectVisible.value = true
}

async function confirmApprove() {
  if (!current.value) return
  const amount = Number(approveAmount.value)
  if (!(amount > 0)) {
    ElMessage.warning('请确认订单实付金额')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认通过绑定并按规则赠分？\n平台：${current.value.platformName}\n订单：${current.value.orderNo}\n金额：¥${amount.toFixed(2)}`,
      '通过并赠分',
      { type: 'warning', confirmButtonText: '确认通过' }
    )
  } catch {
    return
  }
  acting.value = true
  try {
    const body = await callBind('approve', {
      bindId: current.value._id,
      amount
    })
    ElMessage.success(body.msg || '已通过')
    await loadList()
    current.value = null
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  } finally {
    acting.value = false
  }
}

async function confirmReject() {
  if (!current.value) return
  acting.value = true
  try {
    const body = await callBind('reject', {
      bindId: current.value._id,
      rejectReason: rejectReason.value.trim() || 'Admin 驳回'
    })
    ElMessage.success(body.msg || '已驳回')
    rejectVisible.value = false
    await loadList()
    current.value = null
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  } finally {
    acting.value = false
  }
}

onMounted(loadList)
</script>

<style scoped>
.bind-desk {
  padding: 20px 24px;
  background: #f2ede4;
  min-height: calc(100vh - 120px);
  color: #33302c;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.title-box h2 {
  margin: 0;
  font-size: 22px;
  color: #33302c;
  border-left: 4px solid #2d5a3f;
  padding-left: 12px;
  font-weight: 700;
}
.subtitle {
  display: block;
  margin-top: 4px;
  padding-left: 16px;
  color: #6b6560;
  font-size: 12px;
  letter-spacing: 0.08em;
}
.hint { margin-bottom: 16px; }
.toolbar { margin-bottom: 16px; }
.layout {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 16px;
  min-height: 520px;
}
.list-pane, .detail-pane {
  background: #fff;
  border: 1px solid #e8e5de;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 1px 2px rgba(26, 24, 20, 0.05);
}
.list-pane { display: flex; flex-direction: column; }
.pager { margin-top: 12px; display: flex; justify-content: flex-end; }
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}
.d-title { font-size: 17px; font-weight: 600; color: #33302c; }
.d-sub { margin-top: 4px; color: #6b6560; font-size: 13px; }
.desc { margin-top: 8px; }
.actions { margin-top: 20px; display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }
.approve-form { width: 100%; margin-bottom: 4px; }
.empty-detail {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a09a90;
}
@media (max-width: 960px) {
  .layout { grid-template-columns: 1fr; }
}
</style>
