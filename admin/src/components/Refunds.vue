<template>
  <div class="refunds-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>退款审核 / REFUND CENTER</h2>
        <span class="subtitle">REFUND & AFTERSALES</span>
      </div>
      <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
    </div>

    <div class="filter-bar">
      <el-radio-group v-model="statusFilter" fill="#d4af37" @change="refresh">
        <el-radio-button label="all">全部</el-radio-button>
        <el-radio-button label="pending">待审核</el-radio-button>
        <el-radio-button label="approved">已批准</el-radio-button>
        <el-radio-button label="rejected">已拒绝</el-radio-button>
        <el-radio-button label="refunded">已退款</el-radio-button>
      </el-radio-group>
      <div class="summary">
        <span>总待审：<b class="warn">{{ pendingTotal }}</b> 笔</span>
        <span>待退金额：<b class="price">¥{{ pendingAmount.toFixed(2) }}</b></span>
      </div>
    </div>

    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" stripe height="calc(100vh - 290px)">
        <el-table-column label="申请编号" width="180">
          <template #default="{ row }">
            <div class="ticket-no">{{ row._id.slice(0, 12) }}</div>
            <div class="ts">{{ fmt(row.createTime) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="原订单" width="180">
          <template #default="{ row }">
            <div class="link-id" @click="viewOrder(row)">{{ row.orderNo || row.orderId?.slice(0, 12) }}</div>
            <div class="ts" v-if="row.relatedOrder">¥{{ row.relatedOrder.totalPrice }}</div>
          </template>
        </el-table-column>
        <el-table-column label="申请退款金额" width="140">
          <template #default="{ row }">
            <span class="price-tag">¥{{ (row.amount || row.refundAmount || 0).toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="退款原因" min-width="240">
          <template #default="{ row }">
            <div class="reason-title">{{ row.reason || row.reasonType || '客户申请' }}</div>
            <div class="reason-desc" v-if="row.description">{{ row.description }}</div>
          </template>
        </el-table-column>
        <el-table-column label="申请人" width="160">
          <template #default="{ row }">
            <div>{{ row.userName || '匿名' }}</div>
            <div class="ts">{{ row.contactPhone || row._openid?.slice(0, 10) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="dark" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'pending'" size="small" type="success" @click="approve(row)">批准</el-button>
            <el-button v-if="row.status === 'pending'" size="small" type="danger" @click="reject(row)">拒绝</el-button>
            <el-button v-if="row.status === 'approved'" size="small" type="primary" color="#d4af37" @click="execRefund(row)">执行退款</el-button>
            <el-button size="small" link @click="viewDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer v-model="detailDrawer" title="退款申请详情" size="560px">
      <pre v-if="currentRow" class="raw-json">{{ JSON.stringify(currentRow, null, 2) }}</pre>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import {
  fetchCollectionSorted,
  fetchCollectionWhere,
  cdnUpdate,
} from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

const list = ref([])
const loading = ref(false)
const statusFilter = ref('pending')
const detailDrawer = ref(false)
const currentRow = ref(null)

const STATUS = {
  pending: { text: '待审核', type: 'warning' },
  approved: { text: '已批准', type: '' },
  rejected: { text: '已拒绝', type: 'danger' },
  refunded: { text: '已退款', type: 'success' }
}
const statusLabel = (s) => STATUS[s]?.text || s
const statusType = (s) => STATUS[s]?.type || 'info'

const fmt = (ts) => {
  if (!ts) return ''
  const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const pendingTotal = computed(() => list.value.filter(r => r.status === 'pending').length)
const pendingAmount = computed(() => list.value
  .filter(r => r.status === 'pending')
  .reduce((s, r) => s + (r.amount || r.refundAmount || 0), 0))

const refresh = async () => {
  loading.value = true
  try {
    const where = statusFilter.value !== 'all' ? { status: statusFilter.value } : null
    list.value = await fetchCollectionSorted('refunds', {
      limit: 200,
      where,
      sortFn: (a, b) => (b.createTime || 0) - (a.createTime || 0)
    })

    if (!list.value.length) {
      const orders = await fetchCollectionWhere('orders', { status: 'refunding' }, 50)
      orders.sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
      list.value = orders.map(o => ({
        _id: o._id,
        orderId: o._id,
        orderNo: o.orderNo || o._id,
        amount: o.totalPrice,
        reason: o.refundReason || '客户申请退款',
        description: o.refundDesc || '',
        userName: o.address?.name || '',
        contactPhone: o.address?.phone || '',
        status: 'pending',
        createTime: o.refundTime || o.createTime,
        _isLegacy: true,
        relatedOrder: o
      }))
    }
  } catch (e) {
    list.value = []
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}

const approve = (row) => {
  ElMessageBox.confirm(`批准退款 ¥${row.amount || row.refundAmount}？批准后将进入待执行状态。`, '批准退款', { type: 'warning' }).then(async () => {
    if (row._isLegacy) {
      await cdnUpdate('orders', row.orderId, {
        status: 'refund_approved',
        refundApprovedTime: Date.now()
      })
    } else {
      await cdnUpdate('refunds', row._id, {
        status: 'approved',
        approvedTime: Date.now()
      })
    }
    ElMessage.success('已批准')
    refresh()
  }).catch(() => {})
}

const reject = (row) => {
  ElMessageBox.prompt('请填写拒绝原因（将通知用户）', '拒绝退款', {
    inputType: 'textarea',
    inputPlaceholder: '示例：商品已签收超过 7 天，不符合无理由退款规则'
  }).then(async ({ value }) => {
    if (!value) return
    if (row._isLegacy) {
      await cdnUpdate('orders', row.orderId, {
        status: 'refund_rejected',
        refundRejectReason: value,
        refundRejectTime: Date.now()
      })
    } else {
      await cdnUpdate('refunds', row._id, {
        status: 'rejected',
        rejectReason: value,
        rejectTime: Date.now()
      })
    }
    ElMessage.success('已拒绝')
    refresh()
  }).catch(() => {})
}

const execRefund = (row) => {
  ElMessageBox.confirm(`确认执行退款 ¥${row.amount}？\n注意：实际打款需在云函数 refundOrder 中调用微信支付退款接口。`, '执行退款', { type: 'warning' }).then(async () => {
    await cdnUpdate('refunds', row._id, {
      status: 'refunded',
      refundedTime: Date.now()
    })
    if (row.orderId) {
      try {
        await cdnUpdate('orders', row.orderId, { status: 'refunded' })
      } catch { /* ignore */ }
    }
    ElMessage.success('已标记为已退款（请确认微信侧实际打款）')
    refresh()
  }).catch(() => {})
}

const viewDetail = (row) => {
  currentRow.value = row
  detailDrawer.value = true
}
const viewOrder = (row) => {
  ElMessage.info('订单详情请到「全渠道订单」模块查看：' + (row.orderNo || row.orderId))
}

onMounted(refresh)
</script>

<style scoped>
.refunds-container { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }
.filter-bar { display: flex; gap: 16px; align-items: center; justify-content: space-between; margin-bottom: 15px; }
.summary { display: flex; gap: 16px; font-size: 13px; color: #666; }
.summary .warn { color: #e6a23c; font-size: 16px; }
.summary .price { color: #d4af37; font-size: 16px; }
.ticket-no { font-family: monospace; font-weight: bold; color: #333; font-size: 13px; }
.ts { font-size: 11px; color: #999; margin-top: 2px; }
.link-id { font-family: monospace; color: #409eff; cursor: pointer; font-size: 13px; }
.link-id:hover { text-decoration: underline; }
.price-tag { color: #f56c6c; font-weight: bold; font-size: 15px; }
.reason-title { font-weight: 500; color: #333; }
.reason-desc { font-size: 12px; color: #999; margin-top: 3px; }
.raw-json { background: #f5f5f5; padding: 16px; border-radius: 8px; font-size: 12px; max-height: 80vh; overflow: auto; }
</style>
