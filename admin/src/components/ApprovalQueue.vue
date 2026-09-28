<template>
  <div class="approval-queue">
    <div class="panel-header">
      <div class="title-box">
        <h2>待我审批 / APPROVALS</h2>
        <span class="subtitle">SUPER-ADMIN QUEUE · 上架 / 退款 / 敏感发货 / 发票 / 逾期撤销 / 冲正</span>
      </div>
      <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
    </div>

    <div class="filter-bar">
      <el-radio-group v-model="statusFilter" @change="onFilterChange">
        <el-radio-button label="pending">待审核</el-radio-button>
        <el-radio-button label="approved">已通过</el-radio-button>
        <el-radio-button label="rejected">已驳回</el-radio-button>
        <el-radio-button label="all">全部</el-radio-button>
      </el-radio-group>
      <div class="summary">
        <span class="muted">本页 {{ list.length }} 条 · 共 {{ total }} 条 · scope={{ scope || '—' }}</span>
      </div>
    </div>

    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" stripe height="calc(100vh - 320px)">
        <template #empty>
          <ErpEmpty
            description="暂无审批单"
            hint="当前筛选项下没有单据。上架 / 退款 / 敏感发货等需审的操作提交后会出现；非本审级的单据服务端也不会让你通过。"
          />
        </template>
        <el-table-column label="提交时间" width="150">
          <template #default="{ row }">
            <div class="ticket-no">{{ fmt(row.createTimeMs || row.createTime) }}</div>
            <div class="ts mono">{{ shortId(row._id) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="类型 / 标题" min-width="200">
          <template #default="{ row }">
            <div class="reason-title">{{ row.title || row.actionLabel || row.actionType }}</div>
            <div class="ts">{{ row.actionLabel || row.actionType }}</div>
          </template>
        </el-table-column>
        <el-table-column label="摘要" min-width="180">
          <template #default="{ row }">
            <div class="reason-desc">{{ row.summary || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="申请人" width="140">
          <template #default="{ row }">
            <div>{{ row.applicantName || row.applicantRole || '—' }}</div>
            <div class="ts">{{ row.applicantWorkspaceRole || '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="dark" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status === 'pending' && row.canDecide">
              <el-button
                size="small"
                type="success"
                @click="approve(row)"
              >通过</el-button>
              <el-button
                size="small"
                type="danger"
                @click="reject(row)"
              >驳回</el-button>
            </template>
            <!-- 不是当前身份的审级：按钮点了服务端也会拒，直接说清原因（审计 P0-18） -->
            <el-tooltip
              v-else-if="row.status === 'pending'"
              content="该单据不属于你的审级，需对应审级的人处理"
              placement="top"
            >
              <el-tag type="info" effect="plain" size="small">非本审级</el-tag>
            </el-tooltip>
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
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction } from '../cloud'
import ErpEmpty from './ErpEmpty.vue'

const FN = 'manageApprovals'

const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const statusFilter = ref('pending')
const scope = ref('')

function shortId(id) {
  const s = String(id || '')
  return s.length > 10 ? s.slice(0, 10) + '…' : s
}

function statusLabel(s) {
  return ({ pending: '待审核', approved: '已通过', rejected: '已驳回' })[s] || s || '—'
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
      status: statusFilter.value === 'all' ? 'all' : statusFilter.value,
      page: page.value,
      pageSize,
      // 2026-09-17 审计 P0-18：原先硬编码 scope:'super_admin' → **店长审级**的单据在 ERP 永久不可见
      // （`points_store_grant` 等没有任何 ERP 替代入口，只能永久挂起）。
      // 改传 'all'：服务端 `manageApprovals` 对非超管 workspace 会自动降级为 store_manager，
      // 所以这里只是「请求全站」的提示，真正的可见范围仍由服务端按 actor 判定。
      scope: 'all'
    })
    list.value = res.list || []
    total.value = res.total || 0
    // 服务端未回 scope 时不要假装是超管审级（页头会显示「—」），避免给出错误的可见范围暗示
    scope.value = res.scope || ''
  } catch (e) {
    list.value = []
    total.value = 0
    ElMessage.error(
      e?.message ||
        '加载失败，请刷新重试；持续失败请联系技术' /* 技术排查：请确认已部署 manageApprovals、集合 staff_approvals，以及 ADMIN_OPS_KEY */
    )
  } finally {
    loading.value = false
  }
}

function refresh() {
  loadList()
}

function approve(row) {
  ElMessageBox.confirm(`确认通过「${row.title || row.actionType}」？通过后将执行原业务写入。`, '通过审批', {
    confirmButtonText: '确认通过',
    cancelButtonText: '取消',
    type: 'warning'
  })
    .then(async () => {
      try {
        const res = await callFn({ action: 'approve', approvalId: row._id })
        ElMessage.success(res.msg || '已通过')
        refresh()
      } catch (e) {
        ElMessage.error(e?.message || '通过失败')
      }
    })
    .catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

function reject(row) {
  ElMessageBox.prompt('请填写驳回原因（可选）', '驳回审批', {
    confirmButtonText: '确认驳回',
    cancelButtonText: '取消',
    inputType: 'textarea',
    inputPlaceholder: '驳回说明',
    inputValue: ''
  })
    .then(async ({ value }) => {
      try {
        const res = await callFn({
          action: 'reject',
          approvalId: row._id,
          rejectReason: String(value || '').trim() || '已驳回'
        })
        ElMessage.success(res.msg || '已驳回')
        refresh()
      } catch (e) {
        ElMessage.error(e?.message || '驳回失败')
      }
    })
    .catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

onMounted(loadList)
</script>

<style scoped>
.approval-queue { padding: 4px 2px 24px; }
.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}
.title-box h2 {
  margin: 0;
  font-size: 20px;
  color: #33302c;
  font-weight: 600;
}
.subtitle {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #6b6560;
  letter-spacing: 0.02em;
}
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.summary { font-size: 12px; color: #6b6560; }
.muted { color: #a09a90; }
.ticket-no { font-size: 13px; color: #33302c; }
.ts { font-size: 12px; color: #a09a90; margin-top: 2px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.reason-title { font-size: 14px; color: #33302c; font-weight: 500; }
.reason-desc { font-size: 13px; color: #4a4540; line-height: 1.4; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
