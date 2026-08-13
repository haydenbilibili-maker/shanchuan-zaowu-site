<template>
  <div class="fs-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>出货单</h2>
        <span class="subtitle">总部仓 → 门店/渠道 · 物流与扣库记录</span>
      </div>
      <div class="header-actions">
        <el-input
          v-model="keyword"
          size="small"
          clearable
          placeholder="出货单号 / 订货单 / 物流单号"
          style="width: 220px"
          :prefix-icon="Search"
        />
        <el-select v-model="statusFilter" size="small" style="width: 120px" @change="refresh">
          <el-option label="全部" value="all" />
          <el-option label="待发" value="pending" />
          <el-option label="已发货" value="shipped" />
          <el-option label="已送达" value="delivered" />
        </el-select>
        <el-button size="small" :icon="Download" :disabled="!filtered.length" @click="exportCsv">导出</el-button>
        <el-button :icon="Refresh" circle @click="refresh" />
      </div>
    </div>

    <el-alert v-if="hint" :title="hint" type="warning" :closable="false" show-icon style="margin-bottom: 12px" />

    <el-card shadow="never">
      <el-table :data="filtered" v-loading="loading" stripe @row-click="openDetail">
        <template #empty>
          <el-empty description="暂无出货单（在订货单「已确认」后点出货）" :image-size="80" />
        </template>
        <el-table-column prop="shipmentNo" label="出货单号" width="150" />
        <el-table-column prop="orderNo" label="订货单" width="140" />
        <el-table-column label="门店" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.storeName || '—' }}</template>
        </el-table-column>
        <el-table-column label="件数" width="64" align="center">
          <template #default="{ row }">{{ (row.items || []).length }}</template>
        </el-table-column>
        <el-table-column label="物流" min-width="170">
          <template #default="{ row }">
            <div>{{ row.logistics?.carrier || '—' }}</div>
            <div class="t-sub">{{ row.logistics?.trackingNumber || '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="扣库" width="72" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.stockDeducted ? 'success' : 'info'">
              {{ row.stockDeducted ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }">
            <el-tag size="small" effect="dark" :type="statusType(SHIP_STATUS, row.status)">
              {{ statusLabel(SHIP_STATUS, row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="发货时间" width="160">
          <template #default="{ row }">{{ fmtTime(row.logistics?.shipTime || row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link @click.stop="openDetail(row)">详情</el-button>
            <el-button
              v-if="row.logistics?.trackingNumber"
              size="small"
              link
              @click.stop="copyTrack(row)"
            >复制单号</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer v-model="detailOpen" title="出货单详情" size="520px" destroy-on-close>
      <template v-if="current">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="出货单号">{{ current.shipmentNo }}</el-descriptions-item>
          <el-descriptions-item label="订货单">{{ current.orderNo }}</el-descriptions-item>
          <el-descriptions-item label="门店">{{ current.storeName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="承运商">{{ current.logistics?.carrier || '—' }}</el-descriptions-item>
          <el-descriptions-item label="物流单号">{{ current.logistics?.trackingNumber || '—' }}</el-descriptions-item>
          <el-descriptions-item label="扣库">{{ current.stockDeducted ? '已扣 HQ 库存' : '未扣' }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ statusLabel(SHIP_STATUS, current.status) }}</el-descriptions-item>
        </el-descriptions>
        <div class="seg">明细</div>
        <el-table :data="current.items || []" size="small" border>
          <el-table-column prop="name" label="品名" min-width="140" />
          <el-table-column prop="quantity" label="数量" width="70" />
        </el-table>
        <div class="detail-actions">
          <el-button v-if="current.logistics?.trackingNumber" @click="copyTrack(current)">复制物流单号</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Refresh, Search, Download } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  listShipments,
  SHIP_STATUS,
  statusLabel,
  statusType,
  fmtTime,
  downloadCsv,
  copyText,
} from '../utils/b2bFulfillment'

const list = ref([])
const loading = ref(false)
const statusFilter = ref('all')
const keyword = ref('')
const hint = ref('')
const detailOpen = ref(false)
const current = ref(null)

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return list.value
  return list.value.filter((r) => {
    const blob = [r.shipmentNo, r.orderNo, r.storeName, r.logistics?.trackingNumber, r.logistics?.carrier]
      .map((x) => String(x || '').toLowerCase())
      .join(' ')
    return blob.includes(q)
  })
})

const refresh = async () => {
  loading.value = true
  hint.value = ''
  try {
    list.value = await listShipments({ status: statusFilter.value, limit: 200 })
  } catch (e) {
    list.value = []
    hint.value = '集合 fulfillment_shipments 不可用。请运行：cd admin && node scripts/provision-fulfillment-p1.mjs'
  } finally {
    loading.value = false
  }
}

const openDetail = (row) => {
  current.value = row
  detailOpen.value = true
}

const copyTrack = async (row) => {
  const t = row.logistics?.trackingNumber
  if (!t) return
  try {
    await copyText(`${row.logistics?.carrier || ''} ${t}`.trim())
    ElMessage.success('已复制物流单号')
  } catch {
    ElMessage.error('复制失败')
  }
}

const exportCsv = () => {
  const rows = filtered.value.map((r) => [
    r.shipmentNo,
    r.orderNo,
    r.storeName,
    r.logistics?.carrier,
    r.logistics?.trackingNumber,
    r.stockDeducted ? '是' : '否',
    statusLabel(SHIP_STATUS, r.status),
    fmtTime(r.logistics?.shipTime || r.createdAt),
    (r.items || []).map((it) => `${it.name}×${it.quantity}`).join('；'),
  ])
  downloadCsv(`出货单_${new Date().toISOString().slice(0, 10)}.csv`, [
    '出货单号', '订货单', '门店', '承运商', '物流单号', '扣库', '状态', '时间', '明细',
  ], rows)
  ElMessage.success(`已导出 ${rows.length} 条`)
}

onMounted(refresh)
defineExpose({ refresh })
</script>

<style scoped>
.fs-container { padding: 4px 0 24px; }
.panel-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 12px; margin-bottom: 14px; flex-wrap: wrap;
}
.title-box h2 { margin: 0; font-size: 18px; font-weight: 600; }
.subtitle { color: var(--el-text-color-secondary); font-size: 12px; }
.header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.t-sub { font-size: 12px; color: var(--el-text-color-secondary); }
.seg { font-weight: 600; margin: 16px 0 8px; }
.detail-actions { margin-top: 16px; }
</style>
