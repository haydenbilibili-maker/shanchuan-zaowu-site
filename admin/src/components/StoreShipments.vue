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
            <el-button type="warning" plain @click="openReprice">重算历史单</el-button>
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

    <!-- 重算历史单：**先试算**再确认。已结清/已入账单的单会被拒并给出原因。 -->
    <el-dialog v-model="reprice.visible" title="重算历史单（按当前价目表）" width="820px">
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
        title="重算只影响「未结清且未入账单」的单。已结清的单永不重算；已入账单的要先作废那张账单。"
      />
      <div v-if="reprice.result" class="reprice-summary">
        <span>扫描 {{ reprice.result.scanned }} 张</span>
        <span>· 可重算 <b>{{ reprice.result.eligibleCount }}</b> 张</span>
        <span>· 金额会变 <b>{{ reprice.result.changedCount }}</b> 张</span>
        <span>· 合计差额 <b>¥{{ reprice.result.deltaSumAmount }}</b></span>
        <span v-if="reprice.result.skippedCount">· 跳过 {{ reprice.result.skippedCount }} 张</span>
        <el-tag v-if="reprice.result.dryRun" type="info" size="small">试算（未写入）</el-tag>
        <el-tag v-else type="success" size="small">已写入</el-tag>
      </div>

      <el-table :data="reprice.result ? reprice.result.changes : []" size="small" stripe max-height="320" empty-text="没有需要变更的单">
        <el-table-column prop="shipmentNo" label="单号" width="150" />
        <el-table-column prop="storeName" label="门店" width="110" />
        <el-table-column prop="shipmentDate" label="出货日" width="110" />
        <el-table-column label="改前" width="110" align="right">
          <template #default="{ row }">¥{{ (row.beforeCents / 100).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="改后" width="110" align="right">
          <template #default="{ row }">¥{{ (row.afterCents / 100).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="差额" width="110" align="right">
          <template #default="{ row }">
            <span :class="row.deltaCents === 0 ? '' : 'delta-changed'">
              {{ (row.deltaCents / 100).toFixed(2) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="pricingStatus" label="核价状态" />
      </el-table>

      <el-table
        v-if="reprice.result && reprice.result.skipped.length"
        :data="reprice.result.skipped"
        size="small"
        max-height="180"
        style="margin-top: 12px"
      >
        <el-table-column prop="shipmentNo" label="跳过单号" width="150" />
        <el-table-column prop="code" label="原因码" width="120" />
        <el-table-column prop="msg" label="说明" />
      </el-table>

      <template #footer>
        <el-button @click="reprice.visible = false">关闭</el-button>
        <el-button :loading="reprice.loading" @click="runReprice(true)">重新试算</el-button>
        <el-button
          type="danger"
          :loading="reprice.loading"
          :disabled="!reprice.result || reprice.result.dryRun === false || !reprice.result.changedCount"
          @click="runReprice(false)"
        >
          确认重算（写入 {{ reprice.result ? reprice.result.changedCount : 0 }} 张）
        </el-button>
      </template>
    </el-dialog>
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
/** 重算历史单（裁决 16）：先试算再确认。默认 dry-run，只有点「确认重算」才真写。 */
const reprice = ref({ visible: false, loading: false, result: null })

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

function openReprice() {
  reprice.value = { visible: true, loading: false, result: null }
  runReprice(true)
}

async function runReprice(dryRun) {
  reprice.value.loading = true
  try {
    const res = await callFn({ action: 'repriceShipments', dryRun, limit: 300 })
    reprice.value.result = res
    if (!dryRun) {
      ElMessage.success(res.msg || '已重算')
      await loadList()
    }
  } catch (e) {
    ElMessage.error(e.message || '重算失败')
  } finally {
    reprice.value.loading = false
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
.header-section h2 { margin: 0 0 6px; color: var(--light-text-primary); }
.subtitle { margin: 0 0 16px; color: var(--light-text-secondary); font-size: 13px; line-height: 1.5; }
.card-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.summary { margin-bottom: 12px; color: var(--light-text-secondary); font-size: 13px; display: flex; gap: 8px; }
.reprice-summary { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 8px; color: var(--light-text-secondary); font-size: 13px; }
.delta-changed { color: var(--el-color-danger); font-weight: 600; }
code { background: var(--light-bg-elevated); border: 1px solid var(--light-border-subtle); padding: 0 4px; border-radius: 3px; }
</style>
