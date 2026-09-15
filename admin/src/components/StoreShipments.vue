<template>
  <div class="store-shipments">
    <div class="header-section">
      <h2>出货单</h2>
      <p class="subtitle">
        SSOT 集合 <code>ops_shipments</code>。小程序超管/店长为主录入；本页用于核对、筛选与报表查看。
        飞书双向同步请到「飞书同步中心 · 出货」。
      </p>
    </div>

    <el-card shadow="never" class="list-card" v-loading="loading">
      <template #header>
        <div class="card-head">
          <div class="filters">
            <el-select v-model="storeFilter" clearable placeholder="门店" style="width: 140px" @change="loadList">
              <el-option v-for="s in stores" :key="s.id" :label="s.name" :value="s.id" />
            </el-select>
            <el-select v-model="statusFilter" style="width: 120px" @change="loadList">
              <el-option label="全部状态" value="all" />
              <el-option v-for="s in statuses" :key="s.value" :label="s.label" :value="s.value" />
            </el-select>
            <el-select v-model="sourceFilter" style="width: 120px" @change="loadList">
              <el-option label="全部来源" value="all" />
              <el-option label="飞书" value="feishu" />
              <el-option label="ERP" value="erp" />
              <el-option label="手工录入" value="manual" />
            </el-select>
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              value-format="YYYY-MM-DD"
              start-placeholder="起始日"
              end-placeholder="截止日"
              style="width: 240px"
              @change="loadList"
            />
            <el-button @click="loadList">刷新</el-button>
            <el-button @click="openFeishu">飞书同步中心</el-button>
          </div>
        </div>
      </template>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
        title="主录入在小程序「出货单」：粘贴文本 → 正则解析 → 确认写入。ERP 不另建账本。"
      />

      <div class="summary" v-if="summary">
        <span>{{ summary.count || 0 }} 单</span>
        <span>·</span>
        <span>{{ summary.itemCount || 0 }} 行</span>
        <span>·</span>
        <span>共 {{ summary.totalQty || 0 }} 件</span>
      </div>

      <el-table :data="list" stripe size="small" empty-text="暂无出货单">
        <el-table-column prop="shipmentDate" label="出货日" width="110" />
        <el-table-column prop="storeName" label="门店" width="110" />
        <el-table-column prop="shipmentNo" label="单号" width="150" />
        <el-table-column label="明细" min-width="220">
          <template #default="{ row }">
            {{ (row.items || []).map((i) => `${i.itemName}-${i.qty}`).join('；') }}
          </template>
        </el-table-column>
        <el-table-column prop="totalQty" label="件数" width="70" />
        <el-table-column prop="statusLabel" label="状态" width="90" />
        <el-table-column prop="sourceLabel" label="来源" width="90" />
        <el-table-column label="飞书" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.feishuRecordId" size="small" type="success">已绑</el-tag>
            <el-tag v-else size="small" type="info">未绑</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { callCloudFunction } from '../cloud'
import { useTabsManager } from '../composables/useTabsManager'

const FN = 'manageStoreShipment'
const { openTab } = useTabsManager()
const list = ref([])
const stores = ref([])
const statuses = ref([])
const loading = ref(false)
const storeFilter = ref('')
const statusFilter = ref('all')
const sourceFilter = ref('all')
const dateRange = ref([])
const summary = ref(null)

async function callFn(data) {
  const res = await callCloudFunction(FN, data)
  if (!res || res.success === false) throw new Error((res && res.msg) || '请求失败')
  return res
}

async function loadMeta() {
  const res = await callFn({ action: 'meta' })
  stores.value = res.stores || []
  statuses.value = res.statuses || []
}

async function loadList() {
  loading.value = true
  try {
    const [from, to] = Array.isArray(dateRange.value) ? dateRange.value : []
    const res = await callFn({
      action: 'list',
      storeId: storeFilter.value || undefined,
      status: statusFilter.value,
      source: sourceFilter.value,
      dateFrom: from || undefined,
      dateTo: to || undefined,
      limit: 100,
    })
    list.value = res.list || []
    summary.value = res.summary || null
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
    list.value = []
  } finally {
    loading.value = false
  }
}

function openFeishu() {
  openTab('78')
}

onMounted(async () => {
  try {
    await loadMeta()
    await loadList()
  } catch (e) {
    ElMessage.error(e.message || '初始化失败')
  }
})
</script>

<style scoped>
.store-shipments { padding: 4px; }
.header-section h2 { margin: 0 0 6px; color: #33302c; }
.subtitle { margin: 0 0 16px; color: #6b6560; font-size: 13px; line-height: 1.5; }
.card-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.summary { margin-bottom: 12px; color: #6b6560; font-size: 13px; display: flex; gap: 8px; }
code { background: #faf6ed; padding: 0 4px; border-radius: 3px; }
</style>
