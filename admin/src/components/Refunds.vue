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
        <span class="muted">共 {{ list.length }} 条</span>
      </div>
    </div>

    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" stripe height="calc(100vh - 290px)">
        <template #empty>
          <el-empty :description="emptyHint" :image-size="88" />
        </template>
        <el-table-column label="申请编号" width="180">
          <template #default="{ row }">
            <div class="ticket-no">{{ displayId(row) }}</div>
            <div class="ts">{{ fmt(row.createTime) }}</div>
            <el-tag v-if="row._fromOrder" size="small" type="info" effect="plain" class="src-tag">订单回流</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="原订单" width="180">
          <template #default="{ row }">
            <div class="link-id" @click="viewOrder(row)">{{ row.orderNo || row.orderId?.slice?.(0, 12) || '—' }}</div>
            <div class="ts" v-if="row.relatedOrder">¥{{ Number(row.relatedOrder.totalPrice || 0).toFixed(2) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="申请退款金额" width="140">
          <template #default="{ row }">
            <span class="price-tag">¥{{ Number(row.amount || row.refundAmount || 0).toFixed(2) }}</span>
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
            <div class="ts">{{ row.contactPhone || row._openid?.slice?.(0, 10) || '' }}</div>
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

    <el-drawer v-model="detailDrawer" title="退款申请详情" size="560px" destroy-on-close>
      <div v-if="currentRow" class="detail-panel">
        <div class="detail-hero">
          <div class="detail-hero-main">
            <div class="detail-amount">¥{{ Number(currentRow.amount || currentRow.refundAmount || 0).toFixed(2) }}</div>
            <el-tag :type="statusType(currentRow.status)" effect="dark" size="small">{{ statusLabel(currentRow.status) }}</el-tag>
            <el-tag v-if="currentRow._fromOrder" size="small" type="info" effect="plain">订单回流</el-tag>
          </div>
          <div class="detail-hero-sub">{{ currentRow.reason || currentRow.reasonType || '客户申请退款' }}</div>
        </div>

        <div class="detail-section">
          <div class="detail-section-title">申请信息</div>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">申请编号</span>
              <span class="detail-value mono">{{ displayId(currentRow) }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">申请时间</span>
              <span class="detail-value">{{ fmtFull(currentRow.createTime) }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">退款原因</span>
              <span class="detail-value">{{ currentRow.reason || currentRow.reasonType || '—' }}</span>
            </div>
            <div class="detail-item detail-item--block">
              <span class="detail-label">补充说明</span>
              <span class="detail-value">{{ currentRow.description || '无' }}</span>
            </div>
            <div class="detail-item" v-if="refundNoOf(currentRow)">
              <span class="detail-label">退款单号</span>
              <span class="detail-value mono">{{ refundNoOf(currentRow) }}</span>
            </div>
            <div class="detail-item" v-if="hasRefundMockFlag(currentRow)">
              <span class="detail-label">退款模式</span>
              <span class="detail-value">{{ isRefundMock(currentRow) ? '开发模拟' : '微信实退' }}</span>
            </div>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-section-title">申请人</div>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">姓名</span>
              <span class="detail-value">{{ currentRow.userName || currentRow.relatedOrder?.address?.name || '匿名' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">手机</span>
              <span class="detail-value">{{ currentRow.contactPhone || currentRow.relatedOrder?.address?.phone || '—' }}</span>
            </div>
            <div class="detail-item detail-item--block" v-if="currentRow._openid">
              <span class="detail-label">OpenID</span>
              <span class="detail-value mono wrap">{{ currentRow._openid }}</span>
            </div>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-section-title">原订单</div>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">订单号</span>
              <span class="detail-value link" @click="viewOrder(currentRow)">{{ currentRow.orderNo || currentRow.orderId || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">订单金额</span>
              <span class="detail-value">¥{{ Number(currentRow.relatedOrder?.totalPrice || currentRow.amount || 0).toFixed(2) }}</span>
            </div>
            <div class="detail-item" v-if="currentRow._orderStatus || currentRow.relatedOrder?.status">
              <span class="detail-label">订单状态</span>
              <span class="detail-value">{{ currentRow._orderStatus || currentRow.relatedOrder?.status }}</span>
            </div>
            <div class="detail-item detail-item--block" v-if="formatAddress(currentRow)">
              <span class="detail-label">收货地址</span>
              <span class="detail-value">{{ formatAddress(currentRow) }}</span>
            </div>
          </div>
        </div>

        <div class="detail-section" v-if="orderProducts(currentRow).length">
          <div class="detail-section-title">商品明细</div>
          <div class="product-list">
            <div v-for="(p, i) in orderProducts(currentRow)" :key="i" class="product-row">
              <div class="product-name">{{ p.name || p.title || p.productName || '商品' }}</div>
              <div class="product-meta">
                <span v-if="p.skuName || p.sku">{{ p.skuName || p.sku }}</span>
                <span>×{{ p.count || p.quantity || 1 }}</span>
                <span v-if="p.price != null">¥{{ Number(p.price).toFixed(2) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="detail-actions" v-if="currentRow.status === 'pending' || currentRow.status === 'approved'">
          <el-button v-if="currentRow.status === 'pending'" type="success" @click="approve(currentRow)">批准</el-button>
          <el-button v-if="currentRow.status === 'pending'" type="danger" @click="reject(currentRow)">拒绝</el-button>
          <el-button v-if="currentRow.status === 'approved'" type="primary" color="#d4af37" @click="execRefund(currentRow)">执行退款</el-button>
        </div>

        <el-collapse class="detail-raw-collapse">
          <el-collapse-item title="查看原始数据" name="raw">
            <pre class="raw-json">{{ JSON.stringify(currentRow, null, 2) }}</pre>
          </el-collapse-item>
        </el-collapse>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import {
  COLLECTIONS,
  fetchCollectionSorted,
  fetchCollectionWhere,
  cdnUpdate,
  cdnAdd,
  callCloudFunction,
} from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

/** 订单侧历史退款相关状态（小程序申请 / 店长退款 / 云函数完成后写入） */
const ORDER_REFUND_STATUSES = [
  'refunding',       // 小程序申请退款
  'aftersales',      // 售后中
  'refund_approved', // Admin 批准后（订单侧）
  'refund_rejected',
  'refunded',        // 历史已退款（关键：此前审核页未拉取）
]

const list = ref([])
const loading = ref(false)
/** 默认「全部」，才能看到历史已退款 */
const statusFilter = ref('all')
const detailDrawer = ref(false)
const currentRow = ref(null)
const loadMeta = ref({ refunds: 0, orders: 0 })

const STATUS = {
  pending: { text: '待审核', type: 'warning' },
  approved: { text: '已批准', type: '' },
  rejected: { text: '已拒绝', type: 'danger' },
  refunded: { text: '已退款', type: 'success' },
}
const statusLabel = (s) => STATUS[s]?.text || s || '—'
const statusType = (s) => STATUS[s]?.type || 'info'

const fmt = (ts) => {
  if (!ts) return ''
  const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const fmtFull = (ts) => {
  if (!ts) return '—'
  const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const formatAddress = (row) => {
  const addr = row?.relatedOrder?.address || row?.address
  if (!addr) return ''
  const region = Array.isArray(addr.region) ? addr.region.filter(Boolean).join(' ') : (addr.region || '')
  const detail = addr.detail || addr.address || ''
  const line = [region, detail].filter(Boolean).join(' ')
  if (!line) return ''
  const who = [addr.name, addr.phone].filter(Boolean).join(' · ')
  return who ? `${line}（${who}）` : line
}

const orderProducts = (row) => {
  const o = row?.relatedOrder
  if (!o) return []
  const list = o.products || o.items || o.goods || o.productList || []
  if (Array.isArray(list) && list.length) return list
  // 部分订单仅有 collectionIds
  const ids = o.collectionIds || o.productIds || []
  if (Array.isArray(ids) && ids.length) {
    return ids.map((id, i) => ({ name: `藏品 ${i + 1}`, sku: String(id).slice(0, 10), count: 1 }))
  }
  return []
}

const refundNoOf = (row) => row?.refundNo || row?.refund_no || row?.outRefundNo || ''
const hasRefundMockFlag = (row) => typeof row?.refundMock === 'boolean' || typeof row?.refund_mock === 'boolean'
const isRefundMock = (row) => Boolean(row?.refundMock ?? row?.refund_mock)

const displayId = (row) => {
  const id = String(row._id || row.orderId || '')
  return id ? id.slice(0, 12) : '—'
}

const pendingTotal = computed(() => list.value.filter((r) => r.status === 'pending').length)
const pendingAmount = computed(() =>
  list.value
    .filter((r) => r.status === 'pending')
    .reduce((s, r) => s + Number(r.amount || r.refundAmount || 0), 0),
)

const emptyHint = computed(() => {
  if (statusFilter.value === 'all') {
    return loadMeta.value.refunds === 0 && loadMeta.value.orders === 0
      ? '暂无退款记录（refunds 集合与订单退款状态均为空）'
      : '当前筛选下无数据'
  }
  return `暂无「${STATUS[statusFilter.value]?.text || statusFilter.value}」记录`
})

function mapOrderStatusToRefundStatus(orderStatus) {
  switch (orderStatus) {
    case 'refunding':
    case 'aftersales':
      return 'pending'
    case 'refund_approved':
      return 'approved'
    case 'refund_rejected':
      return 'rejected'
    case 'refunded':
      return 'refunded'
    default:
      return 'pending'
  }
}

function normalizeRefundDoc(doc) {
  const amount = Number(doc.amount ?? doc.refundAmount ?? doc.refundFee ?? 0)
  return {
    ...doc,
    amount,
    refundAmount: amount,
    orderId: doc.orderId || doc.order_id || '',
    orderNo: doc.orderNo || doc.order_no || '',
    reason: doc.reason || doc.reasonType || doc.refundReason || '客户申请',
    description: doc.description || doc.refundDesc || '',
    userName: doc.userName || doc.address?.name || '',
    contactPhone: doc.contactPhone || doc.address?.phone || '',
    status: doc.status || 'pending',
    createTime: doc.createTime || doc.refundTime || doc._createTime || 0,
    _fromOrder: false,
  }
}

function orderToRefundRow(o) {
  const amount = Number(o.refundFee ?? o.refundAmount ?? o.totalPrice ?? 0)
  return {
    _id: `order_${o._id}`,
    orderId: o._id,
    orderNo: o.orderNo || o._id,
    amount,
    refundAmount: amount,
    reason: o.refundReason || o.refundDesc || '客户申请退款',
    description: o.refundDesc || '',
    userName: o.address?.name || o.userName || '',
    contactPhone: o.address?.phone || '',
    _openid: o._openid,
    status: mapOrderStatusToRefundStatus(o.status),
    createTime: o.refundTime || o.refundRequestedAt || o.updateTime || o.createTime || 0,
    refundNo: o.refundNo || '',
    refundMock: o.refundMock,
    _fromOrder: true,
    _orderStatus: o.status,
    relatedOrder: o,
  }
}

function sortByTimeDesc(a, b) {
  return (Number(b.createTime) || 0) - (Number(a.createTime) || 0)
}

/** 合并 refunds 单据 + 订单回流；同一 orderId 优先正式 refunds 文档 */
function mergeRefundRows(refundDocs, orderDocs) {
  const byKey = new Map()
  for (const row of (orderDocs || []).map(orderToRefundRow)) {
    byKey.set(row.orderId || row._id, row)
  }
  for (const row of (refundDocs || []).map(normalizeRefundDoc)) {
    byKey.set(row.orderId || row._id, row)
  }
  return [...byKey.values()].sort(sortByTimeDesc)
}

async function loadOrderRefunds() {
  const chunks = await Promise.all(
    ORDER_REFUND_STATUSES.map((status) =>
      fetchCollectionWhere(COLLECTIONS.ORDERS, { status }, 100).catch(() => []),
    ),
  )
  const map = new Map()
  for (const rows of chunks) {
    for (const o of rows || []) {
      if (o?._id) map.set(o._id, o)
    }
  }
  return [...map.values()]
}

const refresh = async () => {
  loading.value = true
  try {
    const [refundDocs, orderDocs] = await Promise.all([
      fetchCollectionSorted(COLLECTIONS.REFUNDS, {
        limit: 300,
        sortFn: sortByTimeDesc,
      }).catch(() => []),
      loadOrderRefunds(),
    ])

    loadMeta.value = {
      refunds: refundDocs.length,
      orders: orderDocs.length,
    }

    let rows = mergeRefundRows(refundDocs, orderDocs)
    if (statusFilter.value !== 'all') {
      rows = rows.filter((r) => r.status === statusFilter.value)
    }
    list.value = rows
  } catch (e) {
    list.value = []
    ElMessage.error('加载失败：' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function ensureRefundDoc(row, patch) {
  if (row._fromOrder) {
    const payload = {
      orderId: row.orderId,
      orderNo: row.orderNo || '',
      amount: Number(row.amount || 0),
      reason: row.reason || '客户申请退款',
      description: row.description || '',
      userName: row.userName || '',
      contactPhone: row.contactPhone || '',
      _openid: row._openid || '',
      createTime: row.createTime || Date.now(),
      source: 'order_backfill',
      ...patch,
    }
    const res = await cdnAdd(COLLECTIONS.REFUNDS, payload)
    return res?.id || res?._id || null
  }
  await cdnUpdate(COLLECTIONS.REFUNDS, row._id, patch)
  return row._id
}

const approve = (row) => {
  ElMessageBox.confirm(
    `批准退款 ¥${Number(row.amount || row.refundAmount || 0).toFixed(2)}？批准后将进入待执行状态。`,
    '批准退款',
    { type: 'warning' },
  )
    .then(async () => {
      const patch = { status: 'approved', approvedTime: Date.now() }
      if (row._fromOrder && row.orderId) {
        await cdnUpdate(COLLECTIONS.ORDERS, row.orderId, {
          status: 'refund_approved',
          refundApprovedTime: Date.now(),
        })
      }
      await ensureRefundDoc(row, patch)
      ElMessage.success('已批准')
      refresh()
    })
    .catch(() => {})
}

const reject = (row) => {
  ElMessageBox.prompt('请填写拒绝原因（将通知用户）', '拒绝退款', {
    inputType: 'textarea',
    inputPlaceholder: '示例：商品已签收超过 7 天，不符合无理由退款规则',
  })
    .then(async ({ value }) => {
      if (!value) return
      const patch = {
        status: 'rejected',
        rejectReason: value,
        rejectTime: Date.now(),
      }
      if (row._fromOrder && row.orderId) {
        await cdnUpdate(COLLECTIONS.ORDERS, row.orderId, {
          status: 'refund_rejected',
          refundRejectReason: value,
          refundRejectTime: Date.now(),
        })
      }
      await ensureRefundDoc(row, patch)
      ElMessage.success('已拒绝')
      refresh()
    })
    .catch(() => {})
}

const execRefund = (row) => {
  ElMessageBox.confirm(
    `确认执行退款 ¥${Number(row.amount || 0).toFixed(2)}？将调用云函数 refundOrder 发起微信退款。`,
    '执行退款',
    { type: 'warning' },
  )
    .then(async () => {
      const orderId = row.orderId || (row._fromOrder ? String(row._id).replace(/^order_/, '') : '')
      if (!orderId) {
        ElMessage.error('缺少订单 ID，无法执行退款')
        return
      }
      try {
        // 确保订单处于可退状态
        try {
          await cdnUpdate(COLLECTIONS.ORDERS, orderId, { status: 'refunding' })
        } catch {
          /* ignore if already refunding */
        }
        const result = await callCloudFunction('refundOrder', {
          orderId
        })
        if (!result || result.success === false) {
          ElMessage.error(result?.msg || '退款失败')
          return
        }
        const patch = { status: 'refunded', refundedTime: Date.now() }
        await ensureRefundDoc(row, patch)
        ElMessage.success(result.msg || '退款已提交')
        refresh()
      } catch (e) {
        ElMessage.error(e?.message || '退款失败')
      }
    })
    .catch(() => {})
}

const viewDetail = (row) => {
  currentRow.value = row
  detailDrawer.value = true
}

const viewOrder = (row) => {
  ElMessage.info('订单详情请到「全渠道订单」模块查看：' + (row.orderNo || row.orderId || ''))
}

onMounted(refresh)
</script>

<style scoped>
.refunds-container { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.title-box { }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }
.filter-bar { display: flex; gap: 16px; align-items: center; justify-content: space-between; margin-bottom: 15px; flex-wrap: wrap; }
.summary { display: flex; gap: 16px; font-size: 13px; color: #666; align-items: center; }
.summary .warn { color: #e6a23c; font-size: 16px; }
.summary .price { color: #d4af37; font-size: 16px; }
.summary .muted { color: #999; font-size: 12px; }
.ticket-no { font-family: monospace; font-weight: bold; color: #333; font-size: 13px; }
.ts { font-size: 11px; color: #999; margin-top: 2px; }
.src-tag { margin-top: 4px; }
.link-id { font-family: monospace; color: #409eff; cursor: pointer; font-size: 13px; }
.link-id:hover { text-decoration: underline; }
.price-tag { color: #f56c6c; font-weight: bold; font-size: 15px; }
.reason-title { font-weight: 500; color: #333; }
.reason-desc { font-size: 12px; color: #999; margin-top: 3px; }

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
  font-size: 13px;
  font-weight: 700;
  color: #333;
  margin-bottom: 10px;
  padding-left: 8px;
  border-left: 3px solid #d4af37;
}
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: #f7f7f5;
  border-radius: 8px;
}
.detail-item--block { grid-column: 1 / -1; }
.detail-label { font-size: 11px; color: #999; }
.detail-value { font-size: 13px; color: #222; word-break: break-all; }
.detail-value.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.detail-value.wrap { white-space: pre-wrap; }
.detail-value.link { color: #409eff; cursor: pointer; }
.detail-value.link:hover { text-decoration: underline; }
.product-list { display: flex; flex-direction: column; gap: 8px; }
.product-row {
  padding: 10px 12px;
  border-radius: 8px;
  background: #f7f7f5;
}
.product-name { font-size: 13px; font-weight: 600; color: #333; }
.product-meta { margin-top: 4px; display: flex; gap: 12px; font-size: 12px; color: #888; }
.detail-actions { display: flex; gap: 8px; margin: 8px 0 16px; flex-wrap: wrap; }
.detail-raw-collapse { margin-top: 8px; border: none; }
.detail-raw-collapse :deep(.el-collapse-item__header) {
  font-size: 12px;
  color: #999;
  height: 36px;
  border: none;
  background: transparent;
}
.detail-raw-collapse :deep(.el-collapse-item__wrap) { border: none; }
.raw-json {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 8px;
  font-size: 11px;
  max-height: 40vh;
  overflow: auto;
  margin: 0;
  color: #555;
}
</style>
