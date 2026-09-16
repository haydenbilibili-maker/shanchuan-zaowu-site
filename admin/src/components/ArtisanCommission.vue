<template>
  <div class="artisan-commission">
    <div class="header-section">
      <h2>装裱师佣金</h2>
      <p class="subtitle">
        按单提成：规则存 <code>artisan_commission_config</code>，台账存 <code>artisan_commission_ledger</code>。
        与小程序超管台「装裱师佣金」同源、同云函数 <code>manageArtisanCommission</code>；
        订单支付时自动入账（<code>postForOrder</code>），退款时自动冲销（<code>reverseForOrder</code>）。
      </p>
    </div>

    <el-row :gutter="16">
      <el-col :span="9">
        <el-card v-loading="ruleLoading" header="提成规则">
          <el-form :model="rule" label-width="130px">
            <el-form-item label="启用提成">
              <el-switch v-model="rule.enabled" active-text="开" inactive-text="关" />
            </el-form-item>
            <el-form-item label="规则名称">
              <el-input v-model="rule.name" maxlength="30" style="max-width: 260px;" />
            </el-form-item>
            <el-form-item label="提成比例">
              <el-input-number v-model="rule.ratePercent" :min="0" :max="100" :precision="1" />
              <span class="hint">%（按销售额）</span>
            </el-form-item>
            <el-form-item label="适用工艺">
              <el-input
                v-model="rule.craftTypesStr"
                style="max-width: 260px;"
                placeholder="逗号分隔，如 wing_art"
              />
              <span class="hint">留空=不限工艺</span>
            </el-form-item>
            <el-form-item label="计费说明">
              <el-input v-model="rule.basisNote" type="textarea" :rows="2" maxlength="60" style="max-width: 300px;" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="ruleSaving" @click="saveRule">保存规则</el-button>
              <el-button :disabled="ruleSaving" @click="resetRule">恢复默认</el-button>
            </el-form-item>
          </el-form>
          <p v-if="ruleText" class="rule-preview">{{ ruleText }}</p>
        </el-card>
      </el-col>

      <el-col :span="15">
        <el-card v-loading="summaryLoading" header="佣金汇总">
          <el-row :gutter="12">
            <el-col :span="6"><div class="kpi"><div class="kpi-v">{{ fmtMoney(summary.netAmount) }}</div><div class="kpi-l">净佣金</div></div></el-col>
            <el-col :span="6"><div class="kpi"><div class="kpi-v">{{ fmtMoney(summary.earnAmount) }}</div><div class="kpi-l">已入账（{{ summary.earnCount || 0 }} 条）</div></div></el-col>
            <el-col :span="6"><div class="kpi"><div class="kpi-v">{{ fmtMoney(summary.reverseAmount) }}</div><div class="kpi-l">已冲销（{{ summary.reverseCount || 0 }} 条）</div></div></el-col>
            <el-col :span="6"><div class="kpi"><div class="kpi-v">{{ fmtMoney(summary.salesAmount) }}</div><div class="kpi-l">计佣销售额</div></div></el-col>
          </el-row>
        </el-card>

        <el-card v-loading="ledgerLoading" style="margin-top: 16px;">
          <template #header>
            <div class="card-head">
              <span>佣金台账</span>
              <div class="head-actions">
                <el-select v-model="typeFilter" size="small" style="width: 130px;" @change="loadLedger">
                  <el-option label="全部" value="" />
                  <el-option label="入账" value="earn" />
                  <el-option label="冲销" value="reverse" />
                </el-select>
                <el-button size="small" :loading="ledgerLoading" @click="refreshAll">刷新</el-button>
              </div>
            </div>
          </template>

          <el-table :data="ledger" size="small" border empty-text="暂无佣金记录">
            <el-table-column label="时间" width="150">
              <template #default="scope">{{ fmtTime(scope.row.createTime || scope.row.paidAt) }}</template>
            </el-table-column>
            <el-table-column label="订单 / 商品" min-width="200">
              <template #default="scope">
                <div class="cell-title">{{ scope.row.orderNo || scope.row.orderId || '—' }}</div>
                <div class="cell-sub">{{ scope.row.productTitle || '—' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="装裱师" width="130">
              <template #default="scope">{{ scope.row.artisanName || scope.row.artisanId || '—' }}</template>
            </el-table-column>
            <el-table-column label="销售额" width="110" align="right">
              <template #default="scope">¥{{ fmtNum(scope.row.salesAmount) }}</template>
            </el-table-column>
            <el-table-column label="比例" width="80" align="right">
              <template #default="scope">{{ ratePct(scope.row.rate) }}</template>
            </el-table-column>
            <el-table-column label="佣金" width="110" align="right">
              <template #default="scope"><b>{{ fmtMoney(scope.row.amount) }}</b></template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="scope">
                <el-tag :type="scope.row.reversed ? 'info' : 'success'" size="small" effect="dark">
                  {{ scope.row.reversed ? '已冲销' : '已入账' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>

          <div class="pager">
            <el-button size="small" :disabled="page <= 1 || ledgerLoading" @click="page--, loadLedger()">上一页</el-button>
            <span class="pager-text">第 {{ page }} 页</span>
            <el-button size="small" :disabled="ledger.length < pageSize || ledgerLoading" @click="page++, loadLedger()">下一页</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction } from '../cloud'

const FN = 'manageArtisanCommission'
const ruleLoading = ref(false)
const ruleSaving = ref(false)
const summaryLoading = ref(false)
const ledgerLoading = ref(false)
const ledger = ref([])
/** 字段与云函数 summarizeRows() 一致：netAmount / earnAmount+earnCount / reverseAmount+reverseCount / salesAmount */
const summary = reactive({ netAmount: 0, earnAmount: 0, earnCount: 0, reverseAmount: 0, reverseCount: 0, salesAmount: 0 })
const ruleText = ref('')
const ruleDocId = ref('')
const typeFilter = ref('')
const page = ref(1)
const pageSize = 20

const rule = reactive({
  enabled: true,
  name: '标本师销售提成',
  ratePercent: 10,
  craftTypesStr: 'wing_art',
  basisNote: '按已支付订单销售额计佣，退款即冲销',
})

function fmtNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2).replace(/\.00$/, '') : '0'
}

/** 台账 amount 由 commissionCore.round2 生成，单位是「元」（销售额 × 比例） */
function fmtMoney(v) {
  return `¥${fmtNum(v)}`
}

function ratePct(rate) {
  const n = Number(rate)
  return Number.isFinite(n) ? `${(n * 100).toFixed(1).replace(/\.0$/, '')}%` : '—'
}

function fmtTime(ts) {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const d = new Date(n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function applyRule(cfg) {
  const c = cfg || {}
  Object.assign(rule, {
    enabled: c.enabled !== false,
    name: c.name || '标本师销售提成',
    ratePercent: Math.round(((Number(c.rate) || 0.1) * 100) * 10) / 10,
    craftTypesStr: Array.isArray(c.craftTypes) ? c.craftTypes.join(',') : '',
    basisNote: c.basisNote || '按已支付订单销售额计佣，退款即冲销',
  })
}

async function loadRule() {
  ruleLoading.value = true
  try {
    const res = await callCloudFunction(FN, { action: 'getRule' })
    if (!res || res.success === false) throw new Error((res && res.msg) || '加载失败')
    applyRule(res.config)
    ruleDocId.value = res.docId || ''
    ruleText.value = res.ruleText || ''
  } catch (e) {
    ElMessage.warning(e?.message || '未读到佣金规则（规则暂不可用，请刷新重试）' /* 技术排查：请确认已部署 manageArtisanCommission */)
  } finally {
    ruleLoading.value = false
  }
}

async function saveRule() {
  ruleSaving.value = true
  try {
    const craftTypes = String(rule.craftTypesStr || '')
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const res = await callCloudFunction(FN, {
      action: 'saveRule',
      docId: ruleDocId.value,
      config: {
        enabled: rule.enabled !== false,
        name: rule.name,
        rate: (Number(rule.ratePercent) || 0) / 100,
        craftTypes,
        basisNote: rule.basisNote,
      },
    })
    if (!res || res.success === false) throw new Error((res && res.msg) || '保存失败')
    ruleDocId.value = res.docId || ruleDocId.value
    ruleText.value = res.ruleText || ruleText.value
    ElMessage.success('佣金规则已保存')
  } catch (e) {
    ElMessage.error(e?.message || '保存失败，请刷新重试；持续失败请联系技术' /* 技术排查：请确认 ADMIN_OPS_KEY 与云函数已部署 */)
  } finally {
    ruleSaving.value = false
  }
}

function resetRule() {
  ElMessageBox.confirm('恢复为代码内置默认（蝶翅画 10%）；确认后需点「保存规则」写入。', '恢复默认', {
    confirmButtonText: '恢复',
    cancelButtonText: '取消',
    type: 'warning',
  })
    .then(async () => {
      try {
        const res = await callCloudFunction(FN, { action: 'resetDefaults', docId: ruleDocId.value })
        if (res && res.success !== false && res.config) applyRule(res.config)
        ruleText.value = (res && res.ruleText) || ''
        ElMessage.success('已载入默认规则')
      } catch (e) {
        ElMessage.warning(e?.message || '恢复默认失败')
      }
    })
    .catch(() => {})
}

async function loadSummary() {
  summaryLoading.value = true
  try {
    const res = await callCloudFunction(FN, { action: 'getSummary' })
    const s = (res && (res.summary || res)) || {}
    Object.assign(summary, {
      netAmount: Number(s.netAmount ?? 0),
      earnAmount: Number(s.earnAmount ?? 0),
      earnCount: Number(s.earnCount ?? 0),
      reverseAmount: Number(s.reverseAmount ?? 0),
      reverseCount: Number(s.reverseCount ?? 0),
      salesAmount: Number(s.salesAmount ?? 0),
    })
  } catch (e) {
    console.warn('佣金汇总加载失败', e?.message)
  } finally {
    summaryLoading.value = false
  }
}

async function loadLedger() {
  ledgerLoading.value = true
  try {
    const res = await callCloudFunction(FN, {
      action: 'listLedger',
      page: page.value,
      pageSize,
      type: typeFilter.value || undefined,
    })
    if (!res || res.success === false) throw new Error((res && res.msg) || '加载失败')
    ledger.value = res.list || []
  } catch (e) {
    ledger.value = []
    ElMessage.warning(e?.message || '佣金台账加载失败')
  } finally {
    ledgerLoading.value = false
  }
}

function refreshAll() {
  page.value = 1
  loadLedger()
  loadSummary()
}

onMounted(() => {
  loadRule()
  loadSummary()
  loadLedger()
})
</script>

<style scoped>
.artisan-commission { padding: 4px; }
.header-section h2 { margin: 0 0 6px; }
.subtitle { color: #8a8279; font-size: 13px; line-height: 1.6; margin: 0 0 16px; }
.rule-preview { color: #b88a4d; font-size: 12px; margin: 8px 0 0; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.head-actions { display: flex; gap: 8px; align-items: center; }
.kpi { text-align: center; padding: 6px 0; }
.kpi-v { font-size: 18px; font-weight: 600; color: #b88a4d; }
.kpi-l { font-size: 12px; color: #8a8279; margin-top: 4px; }
.cell-title { font-size: 13px; }
.cell-sub { font-size: 12px; color: #8a8279; }
.pager { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.pager-text { font-size: 12px; color: #8a8279; }
.hint { margin-left: 8px; color: #8a8279; font-size: 12px; }
</style>
