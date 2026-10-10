<template>
  <div class="module-wrapper payroll-mgmt">
    <div class="module-header">
      <div class="title-box">
        <h2>员工薪酬管理</h2>
        <span class="subtitle">PAYROLL · PRD v1.1</span>
      </div>
      <div class="header-toolbar">
        <span class="toolbar-label">薪酬月份</span>
        <el-date-picker
          v-model="yearMonth"
          type="month"
          value-format="YYYY-MM"
          placeholder="选择月份"
          style="width: 160px"
        />
        <el-button type="primary" plain @click="persistAll">
          <el-icon><Select /></el-icon>
          保存全部
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="payDayHint"
      type="info"
      show-icon
      :closable="false"
      class="payday-hint"
      :title="payDayHint"
    />

    <el-alert
      type="success"
      show-icon
      :closable="false"
      class="payroll-emp-moved-hint"
      title="员工档案在「员工花名册」维护"
      description="新增/编辑/删除员工请在左侧菜单进入「员工花名册」。此处考勤、算薪、导出仍使用同一套本地数据。"
    />

    <el-tabs v-model="activeTab" class="payroll-tabs">
      <el-tab-pane label="全局配置" name="settings">
        <el-card shadow="never" class="inner-card">
          <el-form :model="payroll.settings" label-width="160px" style="max-width: 640px">
            <el-form-item label="每月发薪日（日）">
              <el-input-number v-model="payroll.settings.payDayOfMonth" :min="1" :max="28" />
            </el-form-item>
            <el-form-item label="店员默认提点">
              <el-input-number
                :model-value="Math.round((payroll.settings.clerkCommissionRate || 0.01) * 10000) / 100"
                :min="0"
                :max="5"
                :step="0.05"
                :precision="2"
                @update:model-value="(v) => (payroll.settings.clerkCommissionRate = (Number(v) || 0) / 100)"
              />
              <span class="form-suffix">%（如 1 表示 1%）</span>
            </el-form-item>
            <el-form-item label="店员提成模式">
              <el-radio-group v-model="payroll.settings.clerkCommissionMode">
                <el-radio-button value="pool">全店提成池（平分）</el-radio-button>
                <el-radio-button value="per_head">每人独立 × 店营收</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="默认应出勤天数">
              <el-input-number v-model="payroll.settings.defaultExpectedWorkDays" :min="1" :max="31" />
            </el-form-item>
            <el-form-item label="工号·公司天干序号">
              <el-input-number v-model="payroll.settings.companyTianGanIndex" :min="0" :max="9" />
              <span class="form-suffix">0=甲 … 9=癸（与工号首字对应）</span>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" class="inner-card" style="margin-top: 16px">
          <template #header>
            <span>当月门店计提成营收覆盖（{{ yearMonth }}）</span>
            <span class="card-hint">无登记营收时使用；有登记则以店铺管理登记为准</span>
          </template>
          <el-table :data="overrideTableRows" border size="small" empty-text="暂无门店，请先在店铺管理新建门店">
            <el-table-column prop="label" label="门店" min-width="200" />
            <el-table-column label="覆盖金额(元)" width="200">
              <template #default="{ row }">
                <el-input-number
                  :model-value="overrideAmountModel(row.key)"
                  :min="0"
                  :precision="2"
                  :controls="false"
                  placeholder="可选覆盖"
                  style="width: 100%"
                  @update:model-value="(v) => setOverride(row.key, v)"
                />
              </template>
            </el-table-column>
            <el-table-column label="当月登记净额" width="140" align="right">
              <template #default="{ row }">
                {{ formatMoney(row.autoSum) }}
              </template>
            </el-table-column>
            <el-table-column label="店员提点覆盖(%)" width="150">
              <template #default="{ row }">
                <el-input-number
                  :model-value="storeCommissionRatePct(row.storeId)"
                  :min="0"
                  :max="5"
                  :step="0.05"
                  :precision="2"
                  :controls="false"
                  placeholder="默认全局"
                  style="width: 100%"
                  @update:model-value="(v) => setStoreCommissionRate(row.storeId, v)"
                />
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card shadow="never" class="inner-card" style="margin-top: 16px">
          <template #header>
            <span>社保扣缴标准 · {{ siStandard?.label || '未配置' }}</span>
            <span class="card-hint">与小程序「工资维护 / 工资条明细」同一份标准；来源：{{ siStandard?.source || '—' }}</span>
          </template>
          <el-table :data="siStandardRows" border size="small" empty-text="暂无社保扣缴标准">
            <el-table-column prop="name" label="品目" min-width="120" />
            <el-table-column prop="periodLabel" label="所属期" width="110" />
            <el-table-column label="合计·个人" width="110" align="right">
              <template #default="{ row }">{{ formatMoney(row.personalTotal) }}</template>
            </el-table-column>
            <el-table-column label="合计·单位" width="110" align="right">
              <template #default="{ row }">{{ formatMoney(row.companyTotal) }}</template>
            </el-table-column>
            <el-table-column label="每人·从工资扣" width="120" align="right">
              <template #default="{ row }">{{ row.companyOnly ? '个人不扣' : formatMoney(row.personalEach) }}</template>
            </el-table-column>
            <el-table-column label="每人·公司缴纳" width="120" align="right">
              <template #default="{ row }">{{ formatMoney(row.companyEach) }}</template>
            </el-table-column>
          </el-table>
          <p class="si-note">
            每人金额 = 合计 ÷ {{ siStandard?.splitHeadcount || '—' }}（只用于折算，不限制参保人数，所有参保员工按同一每人金额扣）；
            按「所属期 = 工资月」分到各月工资条，某月无记录时沿用最近一期金额；同一品目同一所属期只扣一次；
            工伤保险按政策个人不扣、只由公司缴纳；公司缴纳部分只展示，不从实发里扣。
            <template v-for="t in siExternalNotes" :key="t"><br />{{ t }}</template>
          </p>
          <el-form label-width="160px" style="max-width: 640px">
            <el-form-item label="参保员工">
              <el-select
                v-model="payroll.settings.siEnrolledEmployeeIds"
                multiple
                filterable
                placeholder="选中的员工生成薪酬时按此标准扣个人社保"
                style="width: 100%"
              >
                <el-option v-for="e in siEmployeeOptions" :key="e.id" :label="e.label" :value="e.id" />
              </el-select>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="考勤" name="attendance">
        <div class="tab-actions">
          <el-button @click="ensureAttendanceRows">补全本月考勤行</el-button>
          <el-button @click="downloadAttendanceTemplate">
            <el-icon><Download /></el-icon>
            下载 CSV 模板
          </el-button>
          <el-upload accept=".csv,text/csv" :show-file-list="false" :http-request="importAttendanceCsvRequest">
            <el-button>导入考勤 CSV</el-button>
          </el-upload>
        </div>
        <el-alert type="info" :closable="false" show-icon class="attn-csv-hint" title="导入说明" description="首行为表头；工号须与「员工花名册」一致。年月可省略，省略则按当前所选薪酬月份写入。" />
        <el-card shadow="never" class="table-card">
          <el-table :data="attendanceForMonth" stripe empty-text="暂无考勤，可点击「补全本月考勤行」">
            <el-table-column prop="employeeName" label="员工" width="120" />
            <el-table-column label="应出勤" width="100">
              <template #default="{ row }">
                <el-input-number v-model="row.expectedDays" :min="0" :max="31" size="small" controls-position="right" />
              </template>
            </el-table-column>
            <el-table-column label="实际出勤" width="100">
              <template #default="{ row }">
                <el-input-number v-model="row.actualDays" :min="0" :max="31" size="small" controls-position="right" />
              </template>
            </el-table-column>
            <el-table-column label="迟到次数" width="100">
              <template #default="{ row }">
                <el-input-number v-model="row.lateCount" :min="0" size="small" controls-position="right" />
              </template>
            </el-table-column>
            <el-table-column label="请假天数" width="100">
              <template #default="{ row }">
                <el-input-number v-model="row.leaveDays" :min="0" :step="0.5" size="small" controls-position="right" />
              </template>
            </el-table-column>
            <el-table-column label="考勤扣款(元)" width="120">
              <template #default="{ row }">
                <el-input-number v-model="row.deductionAmount" :min="0" :precision="2" size="small" controls-position="right" />
              </template>
            </el-table-column>
            <el-table-column label="备注" min-width="140">
              <template #default="{ row }">
                <el-input v-model="row.remark" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="saveAttendanceRow(row)">保存</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="薪酬明细" name="slips">
        <div class="tab-actions">
          <el-button type="primary" @click="runGenerate">
            <el-icon><Cpu /></el-icon>
            生成 / 重算当月薪酬
          </el-button>
          <el-button type="success" :disabled="!hasDraftSlips" @click="lockMonth">锁定本月</el-button>
          <el-button :disabled="!hasLockedSlips" @click="unlockMonth">解锁本月</el-button>
          <el-button @click="exportSlipsCsv">
            <el-icon><Download /></el-icon>
            导出 CSV
          </el-button>
          <el-button @click="exportSlipsXlsx">
            <el-icon><Document /></el-icon>
            导出 Excel
          </el-button>
        </div>
        <el-card shadow="never" class="table-card">
          <el-table :data="slipsForMonth" stripe empty-text="请先生成本月薪酬">
            <el-table-column prop="employeeNo" label="工号" width="90" />
            <el-table-column prop="employeeName" label="姓名" width="90" />
            <el-table-column label="类型" width="100">
              <template #default="{ row }">
                {{ EMPLOYEE_TYPES[row.employeeType] || row.employeeType }}
              </template>
            </el-table-column>
            <el-table-column label="门店编码" width="100">
              <template #default="{ row }">{{ row.storeCode || '—' }}</template>
            </el-table-column>
            <el-table-column label="基本工资" width="100" align="right">
              <template #default="{ row }">{{ formatMoney(row.basePortion) }}</template>
            </el-table-column>
            <el-table-column label="提成" width="100" align="right">
              <template #default="{ row }">{{ formatMoney(row.commissionPortion) }}</template>
            </el-table-column>
            <el-table-column label="绩效" width="100" align="right">
              <template #default="{ row }">{{ formatMoney(row.performanceBonus) }}</template>
            </el-table-column>
            <el-table-column label="扣款" width="90" align="right">
              <template #default="{ row }">{{ formatMoney(row.deduction) }}</template>
            </el-table-column>
            <el-table-column label="应发" width="100" align="right">
              <template #default="{ row }">{{ formatMoney(row.grossPay) }}</template>
            </el-table-column>
            <el-table-column label="社保个人扣" width="110" align="right">
              <template #default="{ row }">{{ row.socialInsurance ? formatMoney(row.siPersonal) : '—' }}</template>
            </el-table-column>
            <el-table-column label="公司缴纳(不扣)" width="120" align="right">
              <template #default="{ row }">{{ row.socialInsurance ? formatMoney(row.siCompany) : '—' }}</template>
            </el-table-column>
            <el-table-column label="实发" width="100" align="right">
              <template #default="{ row }">{{ formatMoney(row.netPay) }}</template>
            </el-table-column>
            <el-table-column label="提成基数(店营收)" width="130" align="right">
              <template #default="{ row }">
                {{ row.revenueBaseUsed != null ? formatMoney(row.revenueBaseUsed) : '—' }}
              </template>
            </el-table-column>
            <el-table-column label="提点%" width="80" align="right">
              <template #default="{ row }">
                {{ formatRatePct(row.commissionRateUsed) }}
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === 'locked' ? 'warning' : 'info'" size="small">
                  {{ row.status === 'locked' ? '已锁定' : '草稿' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button
                  link
                  type="primary"
                  size="small"
                  :disabled="row.status === 'locked'"
                  @click="runRecalcOne(row)"
                >
                  重算此人
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="分析看板" name="charts">
        <el-row :gutter="16">
          <el-col :xs="24" :md="12">
            <el-card shadow="never" class="inner-card">
              <template #header>近 12 个月薪酬结构（应发）</template>
              <canvas ref="chartTrendRef" height="220"></canvas>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="12">
            <el-card shadow="never" class="inner-card">
              <template #header>当月应发构成</template>
              <canvas ref="chartPieRef" height="220"></canvas>
            </el-card>
          </el-col>
          <el-col :span="24" style="margin-top: 16px">
            <el-card shadow="never" class="inner-card">
              <template #header>各店店员提成 vs 店营收（{{ yearMonth }}）</template>
              <canvas ref="chartStoreRef" height="260"></canvas>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Select, Cpu, Download, Document } from '@element-plus/icons-vue'
import Chart from 'chart.js/auto'
import * as XLSX from 'xlsx'
import { loadStoreBundle, getStoreSelectOptions, findStoreById, sumStoreNetRevenueForMonth } from '../utils/storeStorage.js'
import {
  loadPayrollBundle,
  savePayrollBundle,
  defaultPayrollSettings,
  EMPLOYEE_TYPES,
  genPayrollId,
  appendAuditLog,
} from '../utils/payrollStorage.js'
import { generateMonthlySlips, regeneratePartialMonthlySlips } from '../utils/payrollEngine.js'
import { SI_EXTERNAL_CHARGES, SI_ITEMS, SI_RECORDS, perHead } from '../utils/socialInsurance.js'
import { UNIFIED_EMPLOYEES_CHANGED } from '../utils/unifiedEmployeeSync.js'

const yearMonth = ref(monthStr(new Date()))
const activeTab = ref('settings')
const storeBundle = ref(loadStoreBundle())
const payroll = reactive(loadPayrollBundle())

if (!payroll.settings || typeof payroll.settings !== 'object') {
  payroll.settings = defaultPayrollSettings()
}

const chartTrendRef = ref(null)
const chartPieRef = ref(null)
const chartStoreRef = ref(null)
let chartTrend = null
let chartPie = null
let chartStore = null

function monthStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

const storeSelectOptions = computed(() => getStoreSelectOptions(storeBundle.value))

const siStandard = SI_RECORDS[SI_RECORDS.length - 1] || null
const siStandardRows = (siStandard?.lines || []).map((l) => {
  const item = SI_ITEMS.find((i) => i.key === l.key) || {}
  return {
    ...l,
    name: item.name || l.key,
    companyOnly: !!item.companyOnly,
    periodLabel: item.cycle === 'year' ? `${l.period} 年度` : l.period,
    personalEach: item.companyOnly ? 0 : perHead(l.personalTotal, siStandard.splitHeadcount),
    companyEach: perHead(l.companyTotal, siStandard.splitHeadcount),
  }
})
const siExternalNotes = SI_EXTERNAL_CHARGES.map((x) => x.text)
const siEmployeeOptions = computed(() =>
  (payroll.employees || [])
    .filter((e) => e.status !== 'left')
    .map((e) => ({ id: e.id, label: `${e.name || '未命名'}${e.employeeNo ? ` · ${e.employeeNo}` : ''}` }))
)
if (!Array.isArray(payroll.settings.siEnrolledEmployeeIds)) payroll.settings.siEnrolledEmployeeIds = []

const payDayHint = computed(() => {
  const d = payroll.settings?.payDayOfMonth
  if (!d) return ''
  return `当前配置：每月 ${d} 日为发薪日（首期以手动生成薪酬表为准）。`
})

function formatMoney(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return x.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 薪酬导出/表格：提点比例展示为百分比 */
function formatRatePct(rate) {
  const x = Number(rate)
  if (!Number.isFinite(x) || x <= 0) return '—'
  return `${(x * 100).toFixed(2)}%`
}

function storeLabel(storeId) {
  if (!storeId) return ''
  const s = findStoreById(storeBundle.value, storeId)
  if (!s) return storeId
  return `${s.code || '—'} · ${s.name || ''}`
}

const overrideTableRows = computed(() => {
  const ym = yearMonth.value
  return (storeBundle.value.stores || []).map((s) => ({
    key: `${s.id}::${ym}`,
    label: storeLabel(s.id),
    storeId: s.id,
    autoSum: sumStoreNetRevenueForMonth(storeBundle.value, s.id, ym),
  }))
})

function overrideAmountModel(key) {
  const raw = payroll.revenueOverrides[key]
  if (raw == null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function setOverride(key, v) {
  if (v == null || v === '' || Number.isNaN(Number(v))) {
    delete payroll.revenueOverrides[key]
  } else {
    payroll.revenueOverrides[key] = Number(v)
  }
}

function storeCommissionRatePct(storeId) {
  const raw = payroll.settings?.storeCommissionRates?.[storeId]
  if (raw == null || raw === '') return undefined
  const n = Number(raw) * 100
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined
}

function setStoreCommissionRate(storeId, v) {
  if (!payroll.settings.storeCommissionRates || typeof payroll.settings.storeCommissionRates !== 'object') {
    payroll.settings.storeCommissionRates = {}
  }
  if (v == null || v === '' || Number.isNaN(Number(v))) {
    delete payroll.settings.storeCommissionRates[storeId]
  } else {
    payroll.settings.storeCommissionRates[storeId] = Number(v) / 100
  }
}

function persistAll() {
  savePayrollBundle(payroll)
  ElMessage.success('薪酬数据已保存到本地')
}

function reloadPayrollFromDisk() {
  Object.assign(payroll, loadPayrollBundle())
  if (!payroll.settings || typeof payroll.settings !== 'object') {
    payroll.settings = defaultPayrollSettings()
  }
  storeBundle.value = loadStoreBundle()
}

const employeeMap = computed(() => {
  const m = new Map()
  for (const e of payroll.employees) m.set(e.id, e)
  return m
})

const attendanceForMonth = computed(() => {
  const ym = yearMonth.value
  const list = payroll.attendanceMonths.filter((a) => a.yearMonth === ym)
  return list.map((a) => ({
    ...a,
    employeeName: employeeMap.value.get(a.employeeId)?.name || a.employeeId,
  }))
})

function ensureAttendanceRows() {
  const ym = yearMonth.value
  const existing = new Set(payroll.attendanceMonths.filter((a) => a.yearMonth === ym).map((a) => a.employeeId))
  const defDays = payroll.settings?.defaultExpectedWorkDays ?? 22
  for (const e of payroll.employees) {
    if (e.status === 'left') continue
    if (existing.has(e.id)) continue
    payroll.attendanceMonths.push({
      id: genPayrollId('att'),
      employeeId: e.id,
      yearMonth: ym,
      expectedDays: defDays,
      actualDays: defDays,
      lateCount: 0,
      leaveDays: 0,
      deductionAmount: 0,
      remark: '',
      updatedAt: Date.now(),
    })
    existing.add(e.id)
  }
  savePayrollBundle(payroll)
  ElMessage.success('已补全考勤行')
}

function saveAttendanceRow(row) {
  const i = payroll.attendanceMonths.findIndex((a) => a.id === row.id)
  if (i < 0) return
  payroll.attendanceMonths[i] = {
    ...payroll.attendanceMonths[i],
    expectedDays: Number(row.expectedDays) || 0,
    actualDays: Number(row.actualDays) || 0,
    lateCount: Number(row.lateCount) || 0,
    leaveDays: Number(row.leaveDays) || 0,
    deductionAmount: Number(row.deductionAmount) || 0,
    remark: row.remark || '',
    updatedAt: Date.now(),
  }
  savePayrollBundle(payroll)
  ElMessage.success('考勤已保存')
}

/** 简易 CSV 行解析（支持双引号转义） */
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"'
        i++
        continue
      }
      q = !q
      continue
    }
    if (!q && ch === ',') {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur.trim())
  return out.map((s) => s.replace(/^"|"$/g, ''))
}

function downloadAttendanceTemplate() {
  const ym = yearMonth.value
  const headers = ['工号', '年月', '应出勤', '实际出勤', '迟到次数', '请假天数', '考勤扣款', '备注']
  const defDays = payroll.settings?.defaultExpectedWorkDays ?? 22
  const lines = [headers.join(',')]
  for (const e of payroll.employees.filter((x) => x.status !== 'left')) {
    lines.push(
      [e.employeeNo, ym, defDays, defDays, 0, 0, 0, '']
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(','),
    )
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `考勤导入模板_${ym}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('模板已下载')
}

/**
 * 应用考勤 CSV：表头工号,年月,...；年月可空=当前薪酬月
 * @returns 成功写入行数
 */
function applyAttendanceCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '')
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) throw new Error('文件无数据行')
  const head = parseCsvLine(lines[0]).map((h) => String(h).replace(/\s/g, ''))
  const idx = (name) => head.findIndex((h) => h === String(name).replace(/\s/g, ''))
  const iNo = idx('工号')
  if (iNo < 0) throw new Error('缺少「工号」列')
  const iYm = idx('年月')
  const iExp = idx('应出勤')
  const iAct = idx('实际出勤')
  const iLate = idx('迟到次数')
  const iLeave = idx('请假天数')
  const iDed = idx('考勤扣款')
  const iRemark = idx('备注')

  const byNo = new Map(payroll.employees.map((e) => [String(e.employeeNo || '').trim(), e]))
  let n = 0
  const defaultYm = yearMonth.value

  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li])
    const employeeNo = String(cols[iNo] || '').trim()
    if (!employeeNo) continue
    const emp = byNo.get(employeeNo)
    if (!emp) continue
    const ym = (iYm >= 0 && cols[iYm] ? String(cols[iYm]).trim().slice(0, 7) : defaultYm) || defaultYm
    let row = payroll.attendanceMonths.find((a) => a.employeeId === emp.id && a.yearMonth === ym)
    if (!row) {
      row = {
        id: genPayrollId('att'),
        employeeId: emp.id,
        yearMonth: ym,
        expectedDays: payroll.settings?.defaultExpectedWorkDays ?? 22,
        actualDays: payroll.settings?.defaultExpectedWorkDays ?? 22,
        lateCount: 0,
        leaveDays: 0,
        deductionAmount: 0,
        remark: '',
        updatedAt: Date.now(),
      }
      payroll.attendanceMonths.push(row)
    }
    if (iExp >= 0 && cols[iExp] !== '') row.expectedDays = Number(cols[iExp]) || 0
    if (iAct >= 0 && cols[iAct] !== '') row.actualDays = Number(cols[iAct]) || 0
    if (iLate >= 0 && cols[iLate] !== '') row.lateCount = Number(cols[iLate]) || 0
    if (iLeave >= 0 && cols[iLeave] !== '') row.leaveDays = Number(cols[iLeave]) || 0
    if (iDed >= 0 && cols[iDed] !== '') row.deductionAmount = Number(cols[iDed]) || 0
    if (iRemark >= 0) row.remark = String(cols[iRemark] || '')
    row.updatedAt = Date.now()
    n++
  }
  if (!n) throw new Error('未匹配到任何有效工号，请检查文件与员工档案')
  Object.assign(payroll, appendAuditLog(payroll, 'attendance_csv_import', `${n} 行`))
  savePayrollBundle(payroll)
  return n
}

function importAttendanceCsvRequest(opt) {
  const file = opt.file
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const n = applyAttendanceCsv(String(reader.result || ''))
      ElMessage.success(`已导入 ${n} 条考勤记录`)
      opt.onSuccess?.({}, file)
    } catch (e) {
      ElMessage.error(e?.message || '导入失败')
      opt.onError?.(e)
    }
  }
  reader.onerror = () => {
    ElMessage.error('读取文件失败')
    opt.onError?.(new Error('read'))
  }
  reader.readAsText(file, 'UTF-8')
}

const slipsForMonth = computed(() => {
  const ym = yearMonth.value
  return (payroll.slips || [])
    .filter((s) => s.yearMonth === ym)
    .map((s) => {
      const emp = employeeMap.value.get(s.employeeId)
      const st = s.storeId ? findStoreById(storeBundle.value, s.storeId) : null
      return {
        ...s,
        employeeNo: emp?.employeeNo || '—',
        employeeName: emp?.name || '—',
        storeCode: st?.code || '',
      }
    })
    .sort((a, b) => (a.employeeNo || '').localeCompare(b.employeeNo || ''))
})

const hasDraftSlips = computed(() => slipsForMonth.value.some((s) => s.status === 'draft'))
const hasLockedSlips = computed(() => slipsForMonth.value.some((s) => s.status === 'locked'))

function runRecalcOne(row) {
  if (row.status === 'locked') return
  if (!slipsForMonth.value.length) {
    ElMessage.warning('请先生成当月全表，再使用「重算此人」')
    return
  }
  storeBundle.value = loadStoreBundle()
  const { slips, errors, warnings } = regeneratePartialMonthlySlips(
    storeBundle.value,
    payroll,
    yearMonth.value,
    [row.employeeId],
  )
  if (errors?.length) {
    errors.forEach((e) => ElMessage.error(e))
    return
  }
  payroll.slips = slips
  warnings?.forEach((w) => ElMessage.warning(w))
  Object.assign(payroll, appendAuditLog(payroll, 'recalc_slip_one', row.employeeName || row.employeeId))
  savePayrollBundle(payroll)
  ElMessage.success('已重算该员工（同店店员提成池已联动更新）')
}

function runGenerate() {
  storeBundle.value = loadStoreBundle()
  const { slips, errors, warnings } = generateMonthlySlips(storeBundle.value, payroll, yearMonth.value)
  if (errors?.length) {
    errors.forEach((e) => ElMessage.error(e))
    return
  }
  payroll.slips = slips
  warnings?.forEach((w) => ElMessage.warning(w))
  Object.assign(payroll, appendAuditLog(payroll, 'generate_slips', yearMonth.value))
  savePayrollBundle(payroll)
  ElMessage.success('当月薪酬已生成（草稿）')
}

function lockMonth() {
  const ym = yearMonth.value
  payroll.slips = (payroll.slips || []).map((s) =>
    s.yearMonth === ym && s.status === 'draft' ? { ...s, status: 'locked', lockedAt: Date.now() } : s
  )
  Object.assign(payroll, appendAuditLog(payroll, 'lock_slips', ym))
  savePayrollBundle(payroll)
  ElMessage.success('本月薪酬已锁定')
}

function unlockMonth() {
  const ym = yearMonth.value
  payroll.slips = (payroll.slips || []).map((s) =>
    s.yearMonth === ym && s.status === 'locked' ? { ...s, status: 'draft', lockedAt: null } : s
  )
  Object.assign(payroll, appendAuditLog(payroll, 'unlock_slips', ym))
  savePayrollBundle(payroll)
  ElMessage.success('已解锁，可重新算薪')
}

function exportSlipsCsv() {
  const rows = slipsForMonth.value
  if (!rows.length) return ElMessage.warning('暂无数据')
  const headers = [
    '工号',
    '姓名',
    '员工类型',
    '门店编码',
    '基本工资',
    '提成',
    '绩效',
    '考勤扣款',
    '应发',
    '社保个人扣款',
    '公司缴纳社保(不扣)',
    '实发',
    '提成基数(店营收)',
    '提点比例',
    '月份',
    '状态',
  ]
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.employeeNo,
        r.employeeName,
        EMPLOYEE_TYPES[r.employeeType] || r.employeeType,
        r.storeCode || '',
        r.basePortion,
        r.commissionPortion,
        r.performanceBonus,
        r.deduction,
        r.grossPay,
        r.socialInsurance ? r.siPersonal : '',
        r.socialInsurance ? r.siCompany : '',
        r.netPay,
        r.revenueBaseUsed ?? '',
        r.commissionRateUsed != null && Number.isFinite(Number(r.commissionRateUsed))
          ? `${(Number(r.commissionRateUsed) * 100).toFixed(4)}%`
          : '',
        r.yearMonth,
        r.status,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(',')
    )
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `薪酬明细_${yearMonth.value}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('已导出 CSV')
}

function exportSlipsXlsx() {
  const rows = slipsForMonth.value
  if (!rows.length) return ElMessage.warning('暂无数据')
  const data = rows.map((r) => ({
    工号: r.employeeNo,
    姓名: r.employeeName,
    员工类型: EMPLOYEE_TYPES[r.employeeType] || r.employeeType,
    门店编码: r.storeCode || '',
    基本工资: r.basePortion,
    提成: r.commissionPortion,
    绩效: r.performanceBonus,
    考勤扣款: r.deduction,
    应发: r.grossPay,
    社保个人扣款: r.socialInsurance ? r.siPersonal : '',
    '公司缴纳社保(不扣)': r.socialInsurance ? r.siCompany : '',
    实发: r.netPay,
    提成基数: r.revenueBaseUsed ?? '',
    提点比例:
      r.commissionRateUsed != null && Number.isFinite(Number(r.commissionRateUsed))
        ? `${(Number(r.commissionRateUsed) * 100).toFixed(4)}%`
        : '',
    月份: r.yearMonth,
    状态: r.status,
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '薪酬')
  XLSX.writeFile(wb, `薪酬明细_${yearMonth.value}.xlsx`)
  ElMessage.success('已导出 Excel')
}

function destroyCharts() {
  chartTrend?.destroy()
  chartPie?.destroy()
  chartStore?.destroy()
  chartTrend = chartPie = chartStore = null
}

function renderCharts() {
  destroyCharts()
  const ym = yearMonth.value

  const monthKeys = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    monthKeys.push(monthStr(d))
  }

  const clerkByMonth = {}
  const funcByMonth = {}
  for (const m of monthKeys) {
    clerkByMonth[m] = 0
    funcByMonth[m] = 0
  }
  for (const s of payroll.slips || []) {
    if (!monthKeys.includes(s.yearMonth)) continue
    if (s.employeeType === 'store_clerk') {
      clerkByMonth[s.yearMonth] = (clerkByMonth[s.yearMonth] || 0) + (Number(s.commissionPortion) || 0)
    } else {
      funcByMonth[s.yearMonth] =
        (funcByMonth[s.yearMonth] || 0) +
        (Number(s.basePortion) || 0) +
        (Number(s.performanceBonus) || 0)
    }
  }

  if (chartTrendRef.value) {
    chartTrend = new Chart(chartTrendRef.value, {
      type: 'bar',
      data: {
        labels: monthKeys,
        datasets: [
          { label: '店员提成', data: monthKeys.map((k) => clerkByMonth[k] || 0), backgroundColor: 'rgba(45, 106, 79, 0.65)' },
          { label: '职能应发(基+绩)', data: monthKeys.map((k) => funcByMonth[k] || 0), backgroundColor: 'rgba(196, 165, 90, 0.75)' },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true } },
      },
    })
  }

  const curSlips = (payroll.slips || []).filter((s) => s.yearMonth === ym)
  let base = 0
  let comm = 0
  let perf = 0
  let ded = 0
  for (const s of curSlips) {
    base += Number(s.basePortion) || 0
    comm += Number(s.commissionPortion) || 0
    perf += Number(s.performanceBonus) || 0
    ded += Number(s.deduction) || 0
  }
  if (chartPieRef.value) {
    chartPie = new Chart(chartPieRef.value, {
      type: 'doughnut',
      data: {
        labels: ['基本工资', '店员提成', '职能绩效', '考勤扣款'],
        datasets: [
          {
            data: [base, comm, perf, ded],
            backgroundColor: [
              'rgba(45, 106, 79, 0.55)',
              'rgba(82, 183, 136, 0.75)',
              'rgba(196, 165, 90, 0.8)',
              'rgba(208, 84, 80, 0.55)',
            ],
          },
        ],
      },
      options: { responsive: true, plugins: { legend: { position: 'right' } } },
    })
  }

  const byStore = new Map()
  for (const s of curSlips) {
    if (s.employeeType !== 'store_clerk' || !s.storeId) continue
    const sid = s.storeId
    if (!byStore.has(sid)) byStore.set(sid, { comm: 0, rev: 0 })
    const row = byStore.get(sid)
    row.comm += Number(s.commissionPortion) || 0
    row.rev = sumStoreNetRevenueForMonth(storeBundle.value, sid, ym)
  }
  const labels = []
  const revs = []
  const comms = []
  for (const sid of byStore.keys()) {
    labels.push(storeLabel(sid))
    const row = byStore.get(sid)
    revs.push(row.rev)
    comms.push(row.comm)
  }
  if (chartStoreRef.value && labels.length) {
    chartStore = new Chart(chartStoreRef.value, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '店营收(登记)', data: revs, backgroundColor: 'rgba(100, 116, 139, 0.55)' },
          { label: '店员提成(当月)', data: comms, backgroundColor: 'rgba(45, 106, 79, 0.7)' },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true } },
      },
    })
  }

  if (chartStoreRef.value && !labels.length) {
    chartStore = new Chart(chartStoreRef.value, {
      type: 'bar',
      data: { labels: ['暂无店员数据'], datasets: [{ label: '—', data: [0] }] },
      options: { responsive: true },
    })
  }
}

watch([() => payroll.slips, yearMonth, activeTab], async () => {
  if (activeTab.value !== 'charts') return
  await nextTick()
  renderCharts()
})

onMounted(() => {
  storeBundle.value = loadStoreBundle()
  if (activeTab.value === 'charts') nextTick().then(renderCharts)
  window.addEventListener(UNIFIED_EMPLOYEES_CHANGED, reloadPayrollFromDisk)
})

onUnmounted(() => {
  window.removeEventListener(UNIFIED_EMPLOYEES_CHANGED, reloadPayrollFromDisk)
})

watch(activeTab, (t) => {
  if (t === 'charts') nextTick().then(renderCharts)
  if (t === 'settings' || t === 'attendance' || t === 'slips') storeBundle.value = loadStoreBundle()
})

watch(yearMonth, () => {
  storeBundle.value = loadStoreBundle()
})
</script>

<style scoped>
.payroll-mgmt .header-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.toolbar-label {
  font-size: 13px;
  color: var(--light-text-secondary, #606266);
}
.payday-hint {
  margin-bottom: 16px;
}
.payroll-emp-moved-hint {
  margin-bottom: 16px;
}
.payroll-tabs {
  margin-top: 8px;
}
.inner-card {
  border-radius: 12px;
}
.card-hint {
  margin-left: 12px;
  font-size: 12px;
  color: var(--light-text-tertiary, #909399);
  font-weight: normal;
}
.tab-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.form-suffix {
  margin-left: 8px;
  font-size: 13px;
  color: var(--light-text-secondary, #606266);
}
.si-note {
  margin: 10px 0 14px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--light-text-secondary);
}
.form-hint {
  font-size: 12px;
  color: var(--light-text-tertiary, #909399);
  margin-top: 4px;
}
.attn-csv-hint {
  margin-bottom: 12px;
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
