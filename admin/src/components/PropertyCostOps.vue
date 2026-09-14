<template>
  <div class="property-cost-ops">
    <div class="header-section">
      <h2>物业成本</h2>
      <p class="subtitle">
        记录两门店 + 工作室的水电费、房租及其他物业成本；支持支付票据上传与按主体/类型/月份筛选。集合
        <code>property_costs</code>。
      </p>
    </div>

    <el-card v-loading="loading" shadow="never" class="list-card">
      <template #header>
        <div class="card-head">
          <div class="filters">
            <el-select v-model="entityFilter" clearable placeholder="归属主体" style="width: 160px" @change="loadList">
              <el-option v-for="e in entities" :key="e.id" :label="e.name" :value="e.id" />
            </el-select>
            <el-select v-model="typeFilter" style="width: 130px" @change="loadList">
              <el-option label="全部类型" value="all" />
              <el-option v-for="t in costTypes" :key="t.value" :label="t.label" :value="t.value" />
            </el-select>
            <el-date-picker
              v-model="monthFilter"
              type="month"
              value-format="YYYY-MM"
              placeholder="所属月"
              style="width: 140px"
              @change="loadList"
            />
            <el-button :loading="loading" @click="loadList">刷新</el-button>
          </div>
          <el-button type="primary" @click="openCreate">登记成本</el-button>
        </div>
      </template>

      <el-table :data="list" size="small" border empty-text="暂无物业成本记录">
        <el-table-column prop="entityName" label="归属" width="120" />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="typeTone(row.costType)">{{ row.costTypeLabel }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="110">
          <template #default="{ row }">
            <span class="amount">¥{{ money(row.amount) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="成本周期" min-width="160">
          <template #default="{ row }">
            <div>{{ row.periodMonth || '—' }}</div>
            <div class="cell-sub" v-if="row.periodStart || row.periodEnd">
              {{ row.periodStart || '?' }} ~ {{ row.periodEnd || '?' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="paidAt" label="支付日期" width="110" />
        <el-table-column label="票据" width="90">
          <template #default="{ row }">
            <el-button
              v-if="row.receiptFileId"
              link
              type="primary"
              size="small"
              @click="previewReceipt(row)"
            >查看</el-button>
            <span v-else class="cell-sub">无</span>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="removeRow(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑物业成本' : '登记物业成本'"
      width="560px"
      destroy-on-close
    >
      <el-form :model="form" label-width="110px">
        <el-form-item label="归属主体" required>
          <el-select v-model="form.entityId" style="width: 100%">
            <el-option v-for="e in entities" :key="e.id" :label="e.name" :value="e.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="成本类型" required>
          <el-select v-model="form.costType" style="width: 100%">
            <el-option v-for="t in costTypes" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="金额（元）" required>
          <el-input-number v-model="form.amount" :min="0.01" :precision="2" :step="100" />
        </el-form-item>
        <el-form-item label="所属月">
          <el-date-picker v-model="form.periodMonth" type="month" value-format="YYYY-MM" style="width: 100%" />
        </el-form-item>
        <el-form-item label="周期起止">
          <el-date-picker
            v-model="periodRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="起"
            end-placeholder="止"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="支付日期">
          <el-date-picker v-model="form.paidAt" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="支付票据">
          <ImageUploadField
            v-model="form.receiptFileId"
            folder="property-receipts"
            upload-label="上传票据"
            tip="支持 JPG / PNG / WebP，建议清晰拍摄发票或缴费单"
          />
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

    <el-dialog v-model="previewVisible" title="支付票据" width="640px" destroy-on-close>
      <div v-loading="previewLoading" class="preview-box">
        <el-image
          v-if="previewUrl"
          :src="previewUrl"
          fit="contain"
          style="width: 100%; max-height: 70vh"
          :preview-src-list="[previewUrl]"
        />
        <p v-else class="cell-sub">暂无法预览</p>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction, getTempFileUrl } from '../cloud'
import ImageUploadField from './ImageUploadField.vue'

const FN = 'managePropertyCost'
const loading = ref(false)
const saving = ref(false)
const list = ref([])
const entities = ref([])
const costTypes = ref([
  { value: 'utilities', label: '水电费' },
  { value: 'rent', label: '房租' },
  { value: 'other', label: '其他' },
])
const entityFilter = ref('')
const typeFilter = ref('all')
const monthFilter = ref('')
const dialogVisible = ref(false)
const editingId = ref('')
const previewVisible = ref(false)
const previewLoading = ref(false)
const previewUrl = ref('')

const form = reactive({
  entityId: '',
  costType: 'utilities',
  amount: 0,
  periodMonth: '',
  periodStart: '',
  periodEnd: '',
  paidAt: '',
  receiptFileId: '',
  note: '',
})

const periodRange = computed({
  get() {
    if (form.periodStart || form.periodEnd) return [form.periodStart || '', form.periodEnd || '']
    return null
  },
  set(val) {
    if (Array.isArray(val) && val.length === 2) {
      form.periodStart = val[0] || ''
      form.periodEnd = val[1] || ''
      if (!form.periodMonth && form.periodStart) form.periodMonth = form.periodStart.slice(0, 7)
    } else {
      form.periodStart = ''
      form.periodEnd = ''
    }
  },
})

function money(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return v.toFixed(2).replace(/\.00$/, '')
}

function typeTone(t) {
  if (t === 'rent') return 'warning'
  if (t === 'utilities') return 'primary'
  return 'info'
}

function resetForm() {
  const first = entities.value[0]
  Object.assign(form, {
    entityId: first ? first.id : '',
    costType: 'utilities',
    amount: 0,
    periodMonth: new Date().toISOString().slice(0, 7),
    periodStart: '',
    periodEnd: '',
    paidAt: new Date().toISOString().slice(0, 10),
    receiptFileId: '',
    note: '',
  })
}

async function loadMeta() {
  try {
    const res = await callCloudFunction(FN, { action: 'meta' })
    if (!res || res.success === false) throw new Error((res && res.msg) || '加载失败')
    entities.value = res.entities || []
    if (res.costTypes?.length) costTypes.value = res.costTypes
  } catch (e) {
    ElMessage.warning(e?.message || '未读到物业成本元数据')
  }
}

async function loadList() {
  loading.value = true
  try {
    const res = await callCloudFunction(FN, {
      action: 'list',
      entityId: entityFilter.value || undefined,
      costType: typeFilter.value,
      periodMonth: monthFilter.value || undefined,
      limit: 80,
    })
    if (!res || res.success === false) throw new Error((res && res.msg) || '加载失败')
    list.value = res.list || []
  } catch (e) {
    list.value = []
    ElMessage.error(e?.message || '加载失败：请确认已部署 managePropertyCost 并配置 ADMIN_OPS_KEY')
  } finally {
    loading.value = false
  }
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
    costType: row.costType || 'other',
    amount: Number(row.amount) || 0,
    periodMonth: row.periodMonth || '',
    periodStart: row.periodStart || '',
    periodEnd: row.periodEnd || '',
    paidAt: row.paidAt || '',
    receiptFileId: row.receiptFileId || '',
    note: row.note || '',
  })
  dialogVisible.value = true
}

async function saveForm() {
  if (!form.periodMonth && !form.periodStart) {
    ElMessage.warning('请填写所属月或周期起止')
    return
  }
  saving.value = true
  try {
    const res = await callCloudFunction(FN, {
      action: editingId.value ? 'update' : 'create',
      id: editingId.value || undefined,
      item: { ...form },
    })
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

function removeRow(row) {
  ElMessageBox.confirm(
    `确认删除「${row.entityName} · ${row.costTypeLabel} · ¥${money(row.amount)}」？`,
    '删除物业成本',
    { type: 'warning', confirmButtonText: '删除' },
  )
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

async function previewReceipt(row) {
  previewVisible.value = true
  previewLoading.value = true
  previewUrl.value = ''
  try {
    const url = await getTempFileUrl(row.receiptFileId)
    previewUrl.value = url || row.receiptFileId
  } catch (e) {
    ElMessage.error(e?.message || '票据预览失败')
  } finally {
    previewLoading.value = false
  }
}

onMounted(async () => {
  await loadMeta()
  resetForm()
  loadList()
})
</script>

<style scoped>
.property-cost-ops {
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
.amount {
  color: #c4a76c;
  font-family: 'JetBrains Mono', 'DM Mono', monospace;
  font-weight: 600;
}
.cell-sub {
  color: #a09a90;
  font-size: 12px;
  margin-top: 2px;
}
.preview-box {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
