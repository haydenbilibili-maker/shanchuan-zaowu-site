<template>
  <div class="unified-employee-panel">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="ue-hint"
      title="员工主数据唯一入口"
      description="此处维护的人员与「员工薪酬管理」考勤/算薪、「店铺管理」门店花名册自动同步。门店店员须绑定门店；标本师/职能用于薪酬分支。身份证/银行卡完整值存本地；列表默认脱敏。"
    />
    <div class="tab-actions">
      <el-button type="primary" @click="openEmployeeDialog()">
        <el-icon><Plus /></el-icon>
        新增员工
      </el-button>
      <el-button :loading="syncing" @click="openFeishuSync">
        <el-icon><Refresh /></el-icon>
        从飞书同步
      </el-button>
      <el-button link type="primary" @click="mappingDialog = true">字段映射</el-button>
      <el-switch v-model="revealSensitive" active-text="显示敏感信息" inactive-text="脱敏" />
    </div>
    <el-card shadow="never" class="table-card">
      <el-table :data="payroll.employees" stripe empty-text="暂无员工">
        <el-table-column prop="employeeNo" label="工号" width="100" />
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.employeeType === 'store_clerk' ? 'success' : 'info'">
              {{ EMPLOYEE_TYPES[row.employeeType] || row.employeeType }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="phone" label="手机" width="120" />
        <el-table-column label="身份证" min-width="160">
          <template #default="{ row }">
            {{ displayIdCard(row.idCardNumber) || '—' }}
          </template>
        </el-table-column>
        <el-table-column label="银行卡" min-width="150">
          <template #default="{ row }">
            {{ displayBankCard(row.bankCardNumber) || '—' }}
          </template>
        </el-table-column>
        <el-table-column prop="bankName" label="开户行" width="120" show-overflow-tooltip />
        <el-table-column prop="department" label="部门" width="100" />
        <el-table-column prop="position" label="岗位" width="100" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            {{ row.status === 'left' ? '离职' : '在职' }}
          </template>
        </el-table-column>
        <el-table-column label="门店" min-width="140">
          <template #default="{ row }">
            {{ storeLabel(row.storeId) || '—' }}
          </template>
        </el-table-column>
        <el-table-column label="基本工资" width="110" align="right">
          <template #default="{ row }">{{ formatMoney(row.baseSalaryMonthly) }}</template>
        </el-table-column>
        <el-table-column label="参与提成" width="90" align="center">
          <template #default="{ row }">
            <span v-if="row.employeeType === 'store_clerk'">{{ row.commissionParticipate ? '是' : '否' }}</span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="绩效/奖金(月)" width="120" align="right">
          <template #default="{ row }">
            <span v-if="row.employeeType !== 'store_clerk'">{{ formatMoney(row.monthlyPerformanceBonus) }}</span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEmployeeDialog(row)">编辑</el-button>
            <el-button link type="danger" @click="removeEmployee(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="empDialog" :title="empEditingId ? '编辑员工' : '新增员工'" width="560px" destroy-on-close @closed="resetEmpForm">
      <el-form :model="empForm" label-width="120px">
        <el-form-item label="工号">
          <div class="emp-no-row">
            <el-input v-model="empForm.employeeNo" maxlength="32" readonly placeholder="自动生成" />
            <el-button @click="regenEmployeeNo">重新生成</el-button>
          </div>
          <div class="form-hint">公司天干 + 门店字母 + 四位序号（店员须先选门店）</div>
        </el-form-item>
        <el-form-item label="姓名" required>
          <el-input v-model="empForm.name" maxlength="32" />
        </el-form-item>
        <el-form-item label="手机">
          <el-input v-model="empForm.phone" maxlength="20" placeholder="与门店花名册、考勤联系用" />
        </el-form-item>
        <el-form-item label="身份证号">
          <el-input v-model="empForm.idCardNumber" maxlength="32" placeholder="完整号码仅本地保存" />
        </el-form-item>
        <el-form-item label="银行卡号">
          <el-input v-model="empForm.bankCardNumber" maxlength="32" placeholder="完整卡号仅本地保存" />
        </el-form-item>
        <el-form-item label="开户行">
          <el-input v-model="empForm.bankName" maxlength="64" />
        </el-form-item>
        <el-form-item label="性别">
          <el-select v-model="empForm.gender" clearable placeholder="可选" style="width: 100%">
            <el-option label="男" value="male" />
            <el-option label="女" value="female" />
          </el-select>
        </el-form-item>
        <el-form-item label="员工类型" required>
          <el-select v-model="empForm.employeeType" style="width: 100%">
            <el-option v-for="(lab, key) in EMPLOYEE_TYPES" :key="key" :label="lab" :value="key" />
          </el-select>
        </el-form-item>
        <el-form-item label="归属门店" :required="empForm.employeeType === 'store_clerk'">
          <el-select v-model="empForm.storeId" clearable filterable placeholder="请选择门店" style="width: 100%">
            <el-option v-for="o in storeSelectOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="部门">
          <el-input v-model="empForm.department" />
        </el-form-item>
        <el-form-item label="岗位">
          <el-input v-model="empForm.position" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="empForm.status">
            <el-radio-button value="active">在职</el-radio-button>
            <el-radio-button value="left">离职</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="入职日">
          <el-date-picker v-model="empForm.hireDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item v-if="empForm.status === 'left'" label="离职日">
          <el-date-picker v-model="empForm.leaveDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="基本工资/月">
          <el-input-number v-model="empForm.baseSalaryMonthly" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
        <template v-if="empForm.employeeType === 'store_clerk'">
          <el-form-item label="参与门店提成">
            <el-switch v-model="empForm.commissionParticipate" />
          </el-form-item>
          <el-form-item label="个人提点覆盖">
            <el-input-number
              v-model="empForm.commissionRateOverridePct"
              :min="0"
              :max="5"
              :step="0.05"
              :precision="2"
              placeholder="留空则按门店默认"
              style="width: 100%"
            />
            <div class="form-hint">如 0.5 表示 0.5%；留空走全局/门店默认</div>
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item label="月度绩效/奖金">
            <el-input-number v-model="empForm.monthlyPerformanceBonus" :min="0" :precision="2" style="width: 100%" />
          </el-form-item>
        </template>
        <el-form-item v-if="empForm.feishuRecordId" label="飞书记录">
          <el-input :model-value="empForm.feishuRecordId" readonly />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="empDialog = false">取消</el-button>
        <el-button type="primary" @click="saveEmployee">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="mappingDialog" title="飞书人事表字段映射" width="640px" destroy-on-close>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="ue-hint"
        title="人事 Base 与采购库存 Base 不同"
        description="默认 app_token=UOIcbbRBwaX9U1sIR9xcezhenzb · table=tblSuPKdcSnJwNTq。密钥仍用 FEISHU_APP_ID/SECRET；请确认该应用已添加到此人事 Base。"
      />
      <el-form label-width="100px" size="small">
        <el-form-item label="app_token">
          <el-input v-model="mappingForm.appToken" />
        </el-form-item>
        <el-form-item label="table_id">
          <el-input v-model="mappingForm.tableId" />
        </el-form-item>
        <el-form-item label="view_id">
          <el-input v-model="mappingForm.viewId" placeholder="可选，按视图过滤" />
        </el-form-item>
        <el-divider content-position="left">列映射（飞书列名）</el-divider>
        <el-form-item v-for="def in ROSTER_FIELD_DEFS" :key="def.key" :label="def.label">
          <el-select
            v-model="mappingForm.fields[def.key]"
            filterable
            clearable
            allow-create
            default-first-option
            :placeholder="def.hints?.[0] || '飞书列名'"
            style="width: 100%"
          >
            <el-option v-for="col in probedFields" :key="col.name" :label="`${col.name} (${col.uiType || col.type})`" :value="col.name" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :loading="probing" @click="probeFields">探测字段</el-button>
        <el-button @click="mappingDialog = false">取消</el-button>
        <el-button type="primary" @click="saveMapping">保存映射</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { loadStoreBundle, getStoreSelectOptions, findStoreById, saveStoreBundle } from '../utils/storeStorage.js'
import {
  loadPayrollBundle,
  savePayrollBundle,
  EMPLOYEE_TYPES,
  genPayrollId,
  appendAuditLog,
} from '../utils/payrollStorage.js'
import { generateNextEmployeeNo } from '../utils/employeeNoGenerator.js'
import { rebuildStoreStaffFromPayrollEmployees, UNIFIED_EMPLOYEES_CHANGED } from '../utils/unifiedEmployeeSync.js'
import { maskIdCard, maskBankCard } from '../utils/sensitiveMask.js'
import {
  ROSTER_FIELD_DEFS,
  loadRosterMapping,
  saveRosterMapping,
  inspectRosterTable,
  syncRosterFromFeishu,
} from '../utils/feishuRosterSync.js'

const payroll = reactive(loadPayrollBundle())
const storeBundle = ref(loadStoreBundle())

const empDialog = ref(false)
const empEditingId = ref(null)
const revealSensitive = ref(false)
const syncing = ref(false)
const probing = ref(false)
const mappingDialog = ref(false)
const probedFields = ref([])
const mappingForm = reactive(loadRosterMapping())

const empForm = reactive({
  employeeNo: '',
  name: '',
  phone: '',
  idCardNumber: '',
  bankCardNumber: '',
  bankName: '',
  gender: '',
  employeeType: 'function',
  storeId: null,
  department: '',
  position: '',
  status: 'active',
  hireDate: '',
  leaveDate: '',
  baseSalaryMonthly: 0,
  commissionParticipate: true,
  commissionRateOverridePct: null,
  monthlyPerformanceBonus: 0,
  feishuRecordId: '',
})

const storeSelectOptions = computed(() => getStoreSelectOptions(storeBundle.value))

function formatMoney(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return x.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function storeLabel(storeId) {
  if (!storeId) return ''
  const s = findStoreById(storeBundle.value, storeId)
  if (!s) return storeId
  return `${s.code || '—'} · ${s.name || ''}`
}

function displayIdCard(v) {
  if (!v) return ''
  return revealSensitive.value ? String(v) : maskIdCard(v)
}

function displayBankCard(v) {
  if (!v) return ''
  return revealSensitive.value ? String(v) : maskBankCard(v)
}

function reloadFromDisk() {
  storeBundle.value = loadStoreBundle()
  const next = loadPayrollBundle()
  Object.keys(payroll).forEach((k) => delete payroll[k])
  Object.assign(payroll, next)
}

function persistPayrollAndSyncStores() {
  savePayrollBundle(payroll)
  const b = loadStoreBundle()
  rebuildStoreStaffFromPayrollEmployees(b, payroll)
  saveStoreBundle(b)
  storeBundle.value = b
  window.dispatchEvent(new CustomEvent(UNIFIED_EMPLOYEES_CHANGED))
}

function openEmployeeDialog(row) {
  if (row) {
    empEditingId.value = row.id
    empForm.employeeNo = row.employeeNo || ''
    empForm.name = row.name || ''
    empForm.phone = row.phone || ''
    empForm.idCardNumber = row.idCardNumber || ''
    empForm.bankCardNumber = row.bankCardNumber || ''
    empForm.bankName = row.bankName || ''
    empForm.gender = row.gender || ''
    empForm.employeeType = row.employeeType || 'function'
    empForm.storeId = row.storeId || null
    empForm.department = row.department || ''
    empForm.position = row.position || ''
    empForm.status = row.status || 'active'
    empForm.hireDate = row.hireDate || ''
    empForm.leaveDate = row.leaveDate || ''
    empForm.baseSalaryMonthly = Number(row.baseSalaryMonthly) || 0
    empForm.commissionParticipate = row.commissionParticipate !== false
    empForm.commissionRateOverridePct =
      row.commissionRateOverride != null && row.commissionRateOverride !== ''
        ? Math.round(Number(row.commissionRateOverride) * 10000) / 100
        : null
    empForm.monthlyPerformanceBonus = Number(row.monthlyPerformanceBonus) || 0
    empForm.feishuRecordId = row.feishuRecordId || ''
  } else {
    empEditingId.value = null
    resetEmpForm()
  }
  empDialog.value = true
}

function resetEmpForm() {
  empForm.employeeNo = ''
  empForm.name = ''
  empForm.phone = ''
  empForm.idCardNumber = ''
  empForm.bankCardNumber = ''
  empForm.bankName = ''
  empForm.gender = ''
  empForm.employeeType = 'function'
  empForm.storeId = null
  empForm.department = ''
  empForm.position = ''
  empForm.status = 'active'
  empForm.hireDate = ''
  empForm.leaveDate = ''
  empForm.baseSalaryMonthly = 0
  empForm.commissionParticipate = true
  empForm.commissionRateOverridePct = null
  empForm.monthlyPerformanceBonus = 0
  empForm.feishuRecordId = ''
}

function regenEmployeeNo() {
  try {
    if (empForm.employeeType === 'store_clerk' && !empForm.storeId) {
      ElMessage.warning('门店店员请先选择归属门店')
      return
    }
    empForm.employeeNo = generateNextEmployeeNo({
      employees: payroll.employees,
      storeBundle: storeBundle.value,
      payrollSettings: payroll.settings,
      storeId: empForm.employeeType === 'store_clerk' ? empForm.storeId : null,
      excludeEmployeeId: empEditingId.value || null,
    })
  } catch (e) {
    ElMessage.error(e?.message || '工号生成失败')
  }
}

function applyAutoEmployeeNoForNew() {
  if (!empDialog.value || empEditingId.value) return
  if (empForm.employeeType === 'store_clerk' && !empForm.storeId) {
    empForm.employeeNo = ''
    return
  }
  regenEmployeeNo()
}

function saveEmployee() {
  if (!empForm.name?.trim()) return ElMessage.warning('请填写姓名')
  if (empForm.employeeType === 'store_clerk' && !empForm.storeId) {
    return ElMessage.warning('门店店员必须选择归属门店')
  }
  let employeeNo = empForm.employeeNo?.trim()
  if (!employeeNo) {
    try {
      employeeNo = generateNextEmployeeNo({
        employees: payroll.employees,
        storeBundle: storeBundle.value,
        payrollSettings: payroll.settings,
        storeId: empForm.employeeType === 'store_clerk' ? empForm.storeId : null,
        excludeEmployeeId: empEditingId.value || null,
      })
    } catch (e) {
      ElMessage.error(e?.message || '工号生成失败')
      return
    }
  }
  const now = Date.now()
  const payload = {
    employeeNo,
    name: empForm.name.trim(),
    phone: (empForm.phone || '').trim(),
    idCardNumber: (empForm.idCardNumber || '').replace(/\s/g, '').trim(),
    bankCardNumber: (empForm.bankCardNumber || '').replace(/\s/g, '').trim(),
    bankName: (empForm.bankName || '').trim(),
    gender: empForm.gender || '',
    employeeType: empForm.employeeType,
    storeId: empForm.storeId || null,
    department: empForm.department || '',
    position: empForm.position || '',
    status: empForm.status,
    hireDate: empForm.hireDate || '',
    leaveDate: empForm.status === 'left' ? empForm.leaveDate || '' : '',
    baseSalaryMonthly: Number(empForm.baseSalaryMonthly) || 0,
    commissionParticipate: empForm.employeeType === 'store_clerk' ? !!empForm.commissionParticipate : false,
    commissionRateOverride:
      empForm.employeeType === 'store_clerk' &&
      empForm.commissionRateOverridePct != null &&
      empForm.commissionRateOverridePct !== ''
        ? Number(empForm.commissionRateOverridePct) / 100
        : null,
    monthlyPerformanceBonus:
      empForm.employeeType !== 'store_clerk' ? Number(empForm.monthlyPerformanceBonus) || 0 : 0,
    feishuRecordId: empForm.feishuRecordId || undefined,
    teamMemberId: null,
    updatedAt: now,
  }
  if (empEditingId.value) {
    const i = payroll.employees.findIndex((e) => e.id === empEditingId.value)
    if (i >= 0) payroll.employees[i] = { ...payroll.employees[i], ...payload }
  } else {
    payroll.employees.push({
      id: genPayrollId('emp'),
      ...payload,
      createdAt: now,
    })
  }
  Object.assign(payroll, appendAuditLog(payroll, 'employee_save', empForm.name))
  persistPayrollAndSyncStores()
  empDialog.value = false
  ElMessage.success('员工已保存，并已同步店铺花名册')
}

function removeEmployee(row) {
  ElMessageBox.confirm(`确定删除员工「${row.name}」？将同步移除店铺管理中对应花名册行。`, '提示', { type: 'warning' })
    .then(() => {
      payroll.employees = payroll.employees.filter((e) => e.id !== row.id)
      payroll.attendanceMonths = payroll.attendanceMonths.filter((a) => a.employeeId !== row.id)
      payroll.slips = payroll.slips.filter((s) => s.employeeId !== row.id)
      Object.assign(payroll, appendAuditLog(payroll, 'employee_remove', row.name))
      persistPayrollAndSyncStores()
      ElMessage.success('已删除')
    })
    .catch(() => {})
}

async function probeFields() {
  probing.value = true
  try {
    const res = await inspectRosterTable({
      appToken: mappingForm.appToken,
      tableId: mappingForm.tableId,
      viewId: mappingForm.viewId,
      fields: mappingForm.fields,
    })
    if (!res.success) {
      ElMessage.error(res.msg || '探测失败')
      return
    }
    probedFields.value = res.fields || []
    if (res.guessed) {
      Object.assign(mappingForm.fields, res.guessed)
    }
    ElMessage.success(res.msg || '探测成功')
  } finally {
    probing.value = false
  }
}

function saveMapping() {
  const saved = saveRosterMapping({
    appToken: mappingForm.appToken,
    tableId: mappingForm.tableId,
    viewId: mappingForm.viewId,
    fields: { ...mappingForm.fields },
  })
  Object.assign(mappingForm, saved)
  mappingDialog.value = false
  ElMessage.success('字段映射已保存')
}

async function openFeishuSync() {
  const map = loadRosterMapping()
  Object.assign(mappingForm, map, { fields: { ...map.fields } })
  try {
    await ElMessageBox.confirm(
      '将从飞书人事多维表拉取员工，按「飞书 record_id」优先、其次「姓名+手机」upsert 到本地花名册。是否继续？',
      '从飞书同步',
      { type: 'info', confirmButtonText: '开始同步', cancelButtonText: '先改映射' },
    )
  } catch {
    mappingDialog.value = true
    return
  }
  syncing.value = true
  try {
    const res = await syncRosterFromFeishu(payroll, {
      mapping: loadRosterMapping(),
      storeBundle: storeBundle.value,
    })
    if (!res.success) {
      ElMessage.error(res.msg || '同步失败')
      mappingDialog.value = true
      return
    }
    Object.keys(payroll).forEach((k) => delete payroll[k])
    Object.assign(payroll, res.payroll)
    persistPayrollAndSyncStores()
    ElMessage.success(res.msg)
  } finally {
    syncing.value = false
  }
}

watch(
  () => [empDialog.value, empEditingId.value, empForm.storeId, empForm.employeeType],
  () => applyAutoEmployeeNoForNew(),
)

onMounted(() => {
  reloadFromDisk()
  const map = loadRosterMapping()
  Object.assign(mappingForm, map, { fields: { ...map.fields } })
  window.addEventListener(UNIFIED_EMPLOYEES_CHANGED, reloadFromDisk)
})

onUnmounted(() => {
  window.removeEventListener(UNIFIED_EMPLOYEES_CHANGED, reloadFromDisk)
})
</script>

<style scoped>
.unified-employee-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.ue-hint {
  margin-bottom: 14px;
}
.tab-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.table-card {
  border-radius: 12px;
}
.form-hint {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
.emp-no-row {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
}
.emp-no-row .el-input {
  flex: 1;
}
</style>
