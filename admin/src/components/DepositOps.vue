<template>
  <div class="deposit-ops">
    <div class="header-section">
      <h2>定金管理</h2>
      <p class="subtitle">
        售罄孤品定金：规则存 <code>deposit_rules</code>（doc key=default），意向存 <code>deposit_intents</code>。
        与小程序超管台「定金意向」同源、同云函数 <code>manageDeposit</code>；现场收款与尾款提醒在小程序侧完成，本页负责规则与逾期处置。
      </p>
    </div>

    <el-row :gutter="16">
      <el-col :span="10">
        <el-card v-loading="rulesLoading" header="定金规则">
          <el-form :model="rules" label-width="150px" size="default">
            <el-form-item label="启用定金">
              <el-switch v-model="rules.enabled" active-text="开" inactive-text="关" />
            </el-form-item>
            <el-form-item label="定金比例">
              <el-input-number v-model="rules.depositRatioPct" :min="1" :max="100" :precision="0" />
              <span class="hint">% of 商品价</span>
            </el-form-item>
            <el-form-item label="尾款窗口（天）">
              <el-input-number v-model="rules.balanceWindowDays" :min="1" :max="60" :precision="0" />
            </el-form-item>
            <el-form-item label="定金下限（元）">
              <el-input-number v-model="rules.minDepositAmount" :min="0" :precision="0" />
            </el-form-item>
            <el-form-item label="定金上限（元）">
              <el-input-number v-model="rules.maxDepositAmount" :min="0" :precision="0" />
            </el-form-item>
            <el-form-item label="逾期不退定金">
              <el-switch v-model="rules.depositNonRefundableOnExpire" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="rulesSaving" @click="saveRules">保存规则</el-button>
              <el-button link :disabled="rulesSaving" @click="loadRules">重新读取</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :span="14">
        <el-card v-loading="listLoading">
          <template #header>
            <div class="card-head">
              <span>定金意向</span>
              <div class="head-actions">
                <el-select v-model="statusFilter" size="small" style="width: 150px;" @change="loadIntents">
                  <el-option v-for="opt in statusOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
                <el-button size="small" :loading="listLoading" @click="loadIntents">刷新</el-button>
                <el-button size="small" type="warning" plain :loading="sweeping" @click="sweepOverdue">清扫逾期尾款</el-button>
              </div>
            </div>
          </template>

          <el-table :data="intents" size="small" border empty-text="该状态下暂无定金意向">
            <el-table-column label="商品" min-width="180">
              <template #default="scope">
                <div class="cell-title">{{ scope.row.productTitle || scope.row.title || '—' }}</div>
                <div class="cell-sub">{{ scope.row.productId || '' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="scope">
                <el-tag :type="statusTone(scope.row.status)" size="small" effect="dark">{{ statusLabel(scope.row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="商品价 / 定金 / 尾款" width="190">
              <template #default="scope">
                <div>¥{{ fen2yuan(scope.row.productPrice) }}</div>
                <div class="cell-sub">定金 ¥{{ fen2yuan(scope.row.depositAmount) }} · 尾款 ¥{{ fen2yuan(scope.row.balanceAmount) }}</div>
              </template>
            </el-table-column>
            <el-table-column label="尾款截止" width="150">
              <template #default="scope">
                <span :class="{ overdue: scope.row.overdue }">{{ scope.row.balanceDueLabel || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="scope">
                <el-button
                  v-if="scope.row.status === 'awaiting_balance'"
                  size="small"
                  type="warning"
                  @click="openExpired(scope.row)"
                >逾期开放</el-button>
                <span v-else class="cell-sub">—</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction } from '../cloud'

const FN = 'manageDeposit'
const rulesLoading = ref(false)
const rulesSaving = ref(false)
const listLoading = ref(false)
const sweeping = ref(false)
const intents = ref([])
const statusFilter = ref('all')

const rules = reactive({
  enabled: true,
  depositRatioPct: 10,
  balanceWindowDays: 7,
  minDepositAmount: 50,
  maxDepositAmount: 500,
  depositNonRefundableOnExpire: true,
})

const statusOptions = [
  { value: 'all', label: '全部' },
  { value: 'intent', label: '仅登记' },
  { value: 'pending_pay', label: '待付定金' },
  { value: 'deposit_paid', label: '已付定金' },
  { value: 'awaiting_balance', label: '待付尾款' },
  { value: 'settled', label: '已结清' },
  { value: 'forfeited_open', label: '逾期开放' },
  { value: 'cancelled', label: '已取消' },
]

const STATUS_LABEL = Object.fromEntries(statusOptions.slice(1).map((o) => [o.value, o.label]))

function statusLabel(s) {
  return STATUS_LABEL[s] || s || '—'
}

function statusTone(s) {
  if (s === 'awaiting_balance') return 'warning'
  if (s === 'settled') return 'success'
  if (s === 'forfeited_open' || s === 'cancelled') return 'info'
  if (s === 'deposit_paid') return 'primary'
  return 'info'
}

/** 后端金额单位是「分」，展示转元 */
function fen2yuan(fen) {
  const n = Number(fen)
  if (!Number.isFinite(n)) return '0'
  return (n / 100).toFixed(2).replace(/\.00$/, '')
}

function isOverdue(dueTs) {
  const t = Number(dueTs)
  return Number.isFinite(t) && t > 0 && t < Date.now()
}

async function loadRules() {
  rulesLoading.value = true
  try {
    const res = await callCloudFunction(FN, { action: 'getRules' })
    if (!res || res.success === false) throw new Error((res && res.msg) || '加载失败')
    const r = res.rules || {}
    Object.assign(rules, {
      enabled: r.enabled !== false,
      depositRatioPct: Math.round((Number(r.depositRatio) || 0.1) * 100),
      balanceWindowDays: Number(r.balanceWindowDays) || 7,
      minDepositAmount: Number(r.minDepositAmount) || 50,
      maxDepositAmount: Number(r.maxDepositAmount) || 500,
      depositNonRefundableOnExpire: r.depositNonRefundableOnExpire !== false,
    })
  } catch (e) {
    ElMessage.warning(e?.message || '未读到定金规则（规则暂不可用，请刷新重试）' /* 技术排查：请确认已部署 manageDeposit */)
  } finally {
    rulesLoading.value = false
  }
}

async function saveRules() {
  rulesSaving.value = true
  try {
    const res = await callCloudFunction(FN, {
      action: 'saveRules',
      rules: {
        enabled: rules.enabled !== false,
        depositRatio: (Number(rules.depositRatioPct) || 10) / 100,
        balanceWindowDays: Number(rules.balanceWindowDays) || 7,
        minDepositAmount: Number(rules.minDepositAmount) || 0,
        maxDepositAmount: Number(rules.maxDepositAmount) || 0,
        depositNonRefundableOnExpire: rules.depositNonRefundableOnExpire !== false,
      },
    })
    if (!res || res.success === false) throw new Error((res && res.msg) || '保存失败')
    ElMessage.success('定金规则已保存')
  } catch (e) {
    ElMessage.error(e?.message || '保存失败，请刷新重试；持续失败请联系技术' /* 技术排查：请确认已部署 manageDeposit 并配置 ADMIN_OPS_KEY */)
  } finally {
    rulesSaving.value = false
  }
}

async function loadIntents() {
  listLoading.value = true
  try {
    const res = await callCloudFunction(FN, {
      action: 'listIntents',
      status: statusFilter.value,
      limit: 80,
    })
    if (!res || res.success === false) throw new Error((res && res.msg) || '加载失败')
    intents.value = (res.list || []).map((row) => ({
      ...row,
      overdue: row.status === 'awaiting_balance' && isOverdue(row.balanceDueAt),
    }))
  } catch (e) {
    intents.value = []
    ElMessage.warning(e?.message || '定金意向加载失败')
  } finally {
    listLoading.value = false
  }
}

function openExpired(row) {
  ElMessageBox.confirm(
    `将「${row.productTitle || row.title || '该商品'}」标记为逾期开放：商品对所有人可购${rules.depositNonRefundableOnExpire ? '，且定金不退' : ''}。确认？`,
    '逾期开放',
    { confirmButtonText: '确认开放', cancelButtonText: '取消', type: 'warning' },
  )
    .then(async () => {
      try {
        const res = await callCloudFunction(FN, { action: 'openExpired', intentId: row._id })
        if (!res || res.success === false) throw new Error((res && res.msg) || '操作失败')
        ElMessage.success('已开放')
        loadIntents()
      } catch (e) {
        ElMessage.error(e?.message || '操作失败')
      }
    })
    .catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

function sweepOverdue() {
  ElMessageBox.confirm('清扫所有已过尾款窗口的意向（按规则处理定金），确认执行？', '清扫逾期尾款', {
    confirmButtonText: '执行',
    cancelButtonText: '取消',
    type: 'warning',
  })
    .then(async () => {
      sweeping.value = true
      try {
        const res = await callCloudFunction(FN, { action: 'sweepBalanceDue' })
        const n = Number(res && res.forfeited) || 0
        ElMessage.success(n > 0 ? `已清扫 ${n} 条逾期` : '没有逾期项')
        loadIntents()
      } catch (e) {
        ElMessage.error(e?.message || '清扫失败')
      } finally {
        sweeping.value = false
      }
    })
    .catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

onMounted(() => {
  loadRules()
  loadIntents()
})
</script>

<style scoped>
.deposit-ops { padding: 4px; }
.header-section h2 { margin: 0 0 6px; }
.subtitle { color: #8a8279; font-size: 13px; line-height: 1.6; margin: 0 0 16px; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.head-actions { display: flex; gap: 8px; align-items: center; }
.cell-title { font-size: 13px; }
.cell-sub { font-size: 12px; color: #8a8279; word-break: break-all; }
.overdue { color: #d64045; }
.hint { margin-left: 8px; color: #8a8279; font-size: 12px; }
</style>
