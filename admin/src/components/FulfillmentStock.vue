<template>
  <div class="mv-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>HQ 成品流水</h2>
        <span class="subtitle">warehouseId = hq · 出货扣库自动写入 · 飞书对齐记 feishu_pull</span>
      </div>
      <div class="header-actions">
        <el-input
          v-model="keyword"
          size="small"
          clearable
          placeholder="品名 / 订货单号"
          style="width: 200px"
          :prefix-icon="Search"
        />
        <el-select v-model="typeFilter" size="small" style="width: 130px">
          <el-option label="全部类型" value="all" />
          <el-option label="出货扣减" value="outbound_ship" />
          <el-option label="手工入库" value="inbound_manual" />
          <el-option label="盘点调整" value="adjust" />
          <el-option label="退货回库" value="return_in" />
          <el-option label="飞书对齐" value="feishu_pull" />
        </el-select>
        <el-button :icon="Refresh" circle @click="refresh" />
      </div>
    </div>

    <el-alert v-if="hint" :title="hint" type="warning" :closable="false" show-icon style="margin-bottom: 12px" />

    <el-card shadow="never">
      <el-table :data="filtered" v-loading="loading" stripe>
        <template #empty>
          <el-empty description="暂无流水。出货成功后会出现 outbound_ship 记录。" :image-size="80" />
        </template>
        <el-table-column label="时间" width="168">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">{{ typeLabel(row.type) }}</template>
        </el-table-column>
        <el-table-column prop="skuName" label="商品" min-width="140" show-overflow-tooltip />
        <el-table-column label="变动" width="88">
          <template #default="{ row }">
            <span :class="row.delta < 0 ? 'neg' : 'pos'">{{ row.delta > 0 ? '+' : '' }}{{ row.delta }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="balanceAfter" label="结余" width="80" />
        <el-table-column label="关联" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.note || row.refId || '—' }}</template>
        </el-table-column>
        <el-table-column prop="operator" label="操作者" width="90" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Refresh, Search } from '@element-plus/icons-vue'
import { listStockMovements, fmtTime } from '../utils/b2bFulfillment'

const TYPE = {
  outbound_ship: '出货扣减',
  inbound_manual: '手工入库',
  adjust: '盘点调整',
  return_in: '退货回库',
  feishu_pull: '飞书对齐',
}
const typeLabel = (t) => TYPE[t] || t || '—'

const list = ref([])
const loading = ref(false)
const hint = ref('')
const keyword = ref('')
const typeFilter = ref('all')

const filtered = computed(() => {
  return list.value.filter((r) => {
    if (typeFilter.value !== 'all' && r.type !== typeFilter.value) return false
    const q = keyword.value.trim().toLowerCase()
    if (!q) return true
    const blob = [r.skuName, r.note, r.refId, r.productId].map((x) => String(x || '').toLowerCase()).join(' ')
    return blob.includes(q)
  })
})

const refresh = async () => {
  loading.value = true
  hint.value = ''
  try {
    list.value = await listStockMovements({ limit: 200 })
  } catch (e) {
    list.value = []
    hint.value = '集合 stock_movements 不可用。请运行：cd admin && node scripts/provision-fulfillment-p1.mjs'
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
defineExpose({ refresh })
</script>

<style scoped>
.mv-container { padding: 4px 0 24px; }
.panel-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 12px; margin-bottom: 14px; flex-wrap: wrap;
}
.title-box h2 { margin: 0; font-size: 18px; font-weight: 600; }
.subtitle { color: var(--el-text-color-secondary); font-size: 12px; }
.header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.neg { color: #c0392b; font-weight: 600; }
.pos { color: #2d6a4f; font-weight: 600; }
</style>
