<template>
  <div class="purchase-ops">
    <div class="header-section">
      <h2>采购管理</h2>
      <p class="subtitle">
        门店采购（山川造物 / 星宸标本）与工作室采购。字段对齐飞书采购表常见列（单号、物料、数量、供应商、状态、日期），并扩展规格/单价/备注；
        <strong>当前为 Admin 主写</strong>，可后续与飞书多维表同步。集合 <code>ops_purchases</code>（与订货履约
        <code>purchase_orders</code> 分离）。
      </p>
    </div>

    <el-tabs v-model="activeScope" @tab-change="onScopeChange">
      <el-tab-pane label="门店采购" name="store" />
      <el-tab-pane label="工作室采购" name="studio" />
    </el-tabs>

    <el-card v-loading="loading" shadow="never" class="list-card">
      <template #header>
        <div class="card-head">
          <div class="filters">
            <el-select v-model="entityFilter" clearable placeholder="归属主体" style="width: 160px" @change="loadList">
              <el-option
                v-for="e in scopeEntities"
                :key="e.id"
                :label="e.name"
                :value="e.id"
              />
            </el-select>
            <el-select v-model="statusFilter" style="width: 130px" @change="loadList">
              <el-option label="全部状态" value="all" />
              <el-option
                v-for="s in statuses"
                :key="s.value"
                :label="s.label"
                :value="s.value"
              />
            </el-select>
            <el-input
              v-model="keyword"
              clearable
              placeholder="搜单号/品名/供应商"
              style="width: 200px"
              @keyup.enter="loadList"
            />
            <el-button :loading="loading" @click="loadList">刷新</el-button>
          </div>
          <el-button type="primary" @click="openCreate">新增采购</el-button>
        </div>
      </template>

      <el-table :data="list" size="small" border empty-text="暂无采购记录">
        <el-table-column prop="orderNo" label="单号" width="140" />
        <el-table-column prop="entityName" label="归属" width="110" />
        <el-table-column label="品名 / 规格" min-width="180">
          <template #default="{ row }">
            <div class="cell-title">{{ row.itemName }}</div>
            <div class="cell-sub">{{ row.spec || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="数量" width="90">
          <template #default="{ row }">{{ row.qty }} {{ row.unit }}</template>
        </el-table-column>
        <el-table-column label="单价 / 金额" width="130">
          <template #default="{ row }">
            <div>¥{{ money(row.unitPrice) }}</div>
            <div class="cell-sub">合计 ¥{{ money(row.amount) }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="supplier" label="供应商" width="120" show-overflow-tooltip />
        <el-table-column prop="purchaseDate" label="采购日期" width="110" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTone(row.status)" size="small" effect="plain">{{ row.statusLabel }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-dropdown v-if="nextStatuses(row).length" trigger="click" @command="(s) => setStatus(row, s)">
              <el-button link type="warning" size="small">流转</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="s in nextStatuses(row)" :key="s" :command="s">
                    {{ statusLabelOf(s) }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button link type="danger" size="small" @click="removeRow(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑采购' : '新增采购'"
      width="560px"
      destroy-on-close
    >
      <el-form :model="form" label-width="100px">
        <el-form-item label="归属主体" required>
          <el-select v-model="form.entityId" style="width: 100%">
            <el-option v-for="e in scopeEntities" :key="e.id" :label="e.name" :value="e.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="品名/物料" required>
          <el-input v-model="form.itemName" placeholder="如：蝴蝶展翅框 / 树脂原料" />
        </el-form-item>
        <el-form-item label="规格">
          <el-input v-model="form.spec" placeholder="可选" />
        </el-form-item>
        <el-form-item label="数量" required>
          <el-input-number v-model="form.qty" :min="0.01" :precision="2" :step="1" />
          <el-input v-model="form.unit" style="width: 80px; margin-left: 8px" placeholder="单位" />
        </el-form-item>
        <el-form-item label="单价（元）">
          <el-input-number v-model="form.unitPrice" :min="0" :precision="2" :step="1" />
        </el-form-item>
        <el-form-item label="供应商">
          <el-input v-model="form.supplier" />
        </el-form-item>
        <el-form-item label="采购日期">
          <el-date-picker v-model="form.purchaseDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option v-for="s in statuses" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveForm">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction } from '../cloud'

const FN = 'managePurchaseOrder'
const loading = ref(false)
const saving = ref(false)
const list = ref([])
const statuses = ref([])
const entities = ref([])
const activeScope = ref('store')
const entityFilter = ref('')
const statusFilter = ref('all')
const keyword = ref('')
const dialogVisible = ref(false)
const editingId = ref('')

const form = reactive({
  entityId: '',
  itemName: '',
  spec: '',
  qty: 1,
  unit: '件',
  unitPrice: 0,
  supplier: '',
  purchaseDate: '',
  status: 'draft',
  note: '',
})

const scopeEntities = computed(() =>
  (entities.value || []).filter((e) => e.scope === activeScope.value),
)

function money(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return v.toFixed(2).replace(/\.00$/, '')
}

function statusTone(s) {
  if (s === 'received') return 'success'
  if (s === 'ordered' || s === 'shipped') return 'warning'
  if (s === 'cancelled') return 'info'
  return ''
}

function statusLabelOf(s) {
  const hit = statuses.value.find((x) => x.value === s)
  return hit ? hit.label : s
}

function nextStatuses(row) {
  const hit = statuses.value.find((x) => x.value === row.status)
  return (hit && hit.next) || []
}

function resetForm() {
  const first = scopeEntities.value[0]
  Object.assign(form, {
    entityId: first ? first.id : '',
    itemName: '',
    spec: '',
    qty: 1,
    unit: '件',
    unitPrice: 0,
    supplier: '',
    purchaseDate: new Date().toISOString().slice(0, 10),
    status: 'draft',
    note: '',
  })
}

async function loadMeta() {
  try {
    const res = await callCloudFunction(FN, { action: 'meta' })
    if (!res || res.success === false) throw new Error((res && res.msg) || '加载元数据失败')
    entities.value = res.entities || []
    statuses.value = res.statuses || []
  } catch (e) {
    ElMessage.warning(e?.message || '未读到采购元数据')
  }
}

async function loadList() {
  loading.value = true
  try {
    const res = await callCloudFunction(FN, {
      action: 'list',
      scope: activeScope.value,
      entityId: entityFilter.value || undefined,
      status: statusFilter.value,
      keyword: keyword.value || undefined,
      limit: 80,
    })
    if (!res || res.success === false) throw new Error((res && res.msg) || '加载失败')
    list.value = res.list || []
  } catch (e) {
    list.value = []
    ElMessage.error(e?.message || '加载失败：请确认已部署 managePurchaseOrder 并配置 ADMIN_OPS_KEY')
  } finally {
    loading.value = false
  }
}

function onScopeChange() {
  entityFilter.value = ''
  loadList()
}

function openCreate() {
  editingId.value = ''
  resetForm()
  dialogVisible.value = true
}

function openEdit(row) {
  editingId.value = row._id
  Object.assign(form, {
    entityId: row.entityId,
    itemName: row.itemName,
    spec: row.spec || '',
    qty: Number(row.qty) || 1,
    unit: row.unit || '件',
    unitPrice: Number(row.unitPrice) || 0,
    supplier: row.supplier || '',
    purchaseDate: row.purchaseDate || '',
    status: row.status || 'draft',
    note: row.note || '',
  })
  dialogVisible.value = true
}

async function saveForm() {
  saving.value = true
  try {
    const payload = {
      action: editingId.value ? 'update' : 'create',
      id: editingId.value || undefined,
      item: { ...form },
    }
    const res = await callCloudFunction(FN, payload)
    if (!res || res.success === false) throw new Error((res && res.msg) || '保存失败')
    ElMessage.success('已保存')
    dialogVisible.value = false
    loadList()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function setStatus(row, status) {
  try {
    const res = await callCloudFunction(FN, { action: 'setStatus', id: row._id, status })
    if (!res || res.success === false) throw new Error((res && res.msg) || '流转失败')
    ElMessage.success('状态已更新')
    loadList()
  } catch (e) {
    ElMessage.error(e?.message || '流转失败')
  }
}

function removeRow(row) {
  ElMessageBox.confirm(`确认删除采购单「${row.orderNo} / ${row.itemName}」？`, '删除采购', {
    type: 'warning',
    confirmButtonText: '删除',
  })
    .then(async () => {
      const res = await callCloudFunction(FN, { action: 'remove', id: row._id })
      if (!res || res.success === false) throw new Error((res && res.msg) || '删除失败')
      ElMessage.success('已删除')
      loadList()
    })
    .catch((e) => {
      if (e === 'cancel' || e === 'close') return
      ElMessage.error(e?.message || '删除失败')
    })
}

onMounted(async () => {
  await loadMeta()
  resetForm()
  loadList()
})
</script>

<style scoped>
.purchase-ops {
  padding: 10px 4px 24px;
}
.header-section h2 {
  margin: 0 0 6px;
  color: #33302c;
  font-size: 20px;
  font-weight: 600;
}
.subtitle {
  margin: 0 0 16px;
  color: #6b6560;
  font-size: 13px;
  line-height: 1.6;
}
.subtitle code {
  font-size: 12px;
  background: #faf6ed;
  padding: 1px 6px;
  border-radius: 4px;
}
.list-card {
  border: 1px solid #e8e5de;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.cell-title {
  color: #33302c;
  font-weight: 500;
}
.cell-sub {
  color: #a09a90;
  font-size: 12px;
  margin-top: 2px;
}
</style>
