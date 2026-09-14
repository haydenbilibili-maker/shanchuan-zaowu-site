<template>
  <div class="gift-ops-config">
    <div class="header-section">
      <h2>礼赠运营配置</h2>
      <p class="subtitle">
        对接云函数 <code>manageGift</code> · 集合 <code>gift_settings</code>。
        写入需超管（<code>manageGift</code>）。履约翻栏请到同 Hub「礼赠履约」页；C 端入口由内容开关 <code>showGift</code> 控制。
      </p>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="hint-alert"
        :title="contentFlagsHint || '加载后显示内容开关状态'"
      />
    </div>

    <el-card v-loading="loading" class="config-card">
      <template #header>
        <div class="card-head">
          <span>运营规则</span>
          <el-tag size="small" :type="fromDefault ? 'warning' : 'success'">
            {{ fromDefault ? '当前为代码默认' : '已写入云库' }}
          </el-tag>
        </div>
      </template>
      <p class="preview">{{ ruleText || '—' }}</p>
      <p class="hint">{{ nudgeRuleSummary }}</p>

      <el-form label-width="160px" style="margin-top: 16px; max-width: 720px;">
        <el-form-item label="填址超时（天）">
          <el-radio-group v-model="form.addressFillTimeoutDays" :disabled="!canEdit">
            <el-radio-button
              v-for="d in timeoutOptions"
              :key="d"
              :label="d"
            >{{ d }} 天</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="默认交付方式">
          <el-select v-model="form.defaultDeliveryType" style="width: 280px;" :disabled="!canEdit">
            <el-option
              v-for="opt in deliveryOptions"
              :key="opt.key"
              :label="opt.label"
              :value="opt.key"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="允许隐价开关">
          <el-switch v-model="form.allowHidePriceToggle" :disabled="!canEdit" />
          <span class="hint">关则 C 端送礼人不可关闭隐价</span>
        </el-form-item>
      </el-form>

      <div class="actions">
        <el-button :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" :loading="saving" :disabled="!canEdit" @click="save">
          保存配置
        </el-button>
        <el-tag v-if="!canEdit" type="info" effect="plain">当前身份仅可读（需超管 / manageGift）</el-tag>
      </div>
    </el-card>

    <el-card v-loading="loading" class="config-card">
      <template #header>近窗统计（约 200 笔采样）</template>
      <el-row :gutter="16">
        <el-col :span="4"><div class="stat"><div class="n">{{ stats.todayCount || 0 }}</div><div class="l">今日礼赠</div></div></el-col>
        <el-col :span="4"><div class="stat"><div class="n">{{ stats.last7Count || 0 }}</div><div class="l">近 7 日</div></div></el-col>
        <el-col :span="4"><div class="stat"><div class="n warn">{{ (stats.todos && stats.todos.awaiting_address) || 0 }}</div><div class="l">待填址</div></div></el-col>
        <el-col :span="4"><div class="stat"><div class="n">{{ (stats.todos && stats.todos.awaiting_ship) || 0 }}</div><div class="l">待发货</div></div></el-col>
        <el-col :span="4"><div class="stat"><div class="n">{{ (stats.todos && stats.todos.pickup_verify) || 0 }}</div><div class="l">自提待核销</div></div></el-col>
        <el-col :span="4"><div class="stat"><div class="n">{{ stats.todoTotal || 0 }}</div><div class="l">待办合计</div></div></el-col>
      </el-row>
      <p class="hint" v-if="stats.note">{{ stats.note }}</p>
      <p class="hint">逐单履约请切换到本 Hub「礼赠履约」页；本页只负责运营规则与订阅状态。</p>
    </el-card>

    <el-card v-loading="loading" class="config-card">
      <template #header>订阅消息</template>
      <p class="preview">{{ subscribe.summary || '未配置' }}</p>
      <p class="hint">{{ subscribe.hint }}</p>
      <el-table :data="subscribe.items || []" size="small" empty-text="无模板项">
        <el-table-column prop="key" label="键" width="200" />
        <el-table-column prop="label" label="说明" min-width="160" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.configured ? 'success' : 'info'">
              {{ row.configured ? '已配' : '未配' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { callCloudFunction } from '../cloud'
import { cloudFnErrorMessage } from '../utils/cloudFnErrors'

const FN = 'manageGift'

const loading = ref(false)
const saving = ref(false)
const canEdit = ref(false)
const fromDefault = ref(true)
const docId = ref('')
const ruleText = ref('')
const nudgeRuleSummary = ref('')
const contentFlagsHint = ref('')
const timeoutOptions = ref([3, 7, 14])
const deliveryOptions = ref([
  { key: 'invite_address', label: '邀请 TA 填写地址' },
  { key: 'ship_to_receiver', label: '快递给 TA' },
  { key: 'ship_to_self', label: '寄给我' },
  { key: 'store_pickup', label: '门店自提代赠' }
])
const form = reactive({
  addressFillTimeoutDays: 7,
  defaultDeliveryType: 'invite_address',
  allowHidePriceToggle: true
})
const stats = ref({ todayCount: 0, last7Count: 0, todoTotal: 0, todos: {}, note: '' })
const subscribe = ref({ summary: '', hint: '', items: [] })

async function callFn(data) {
  const res = await callCloudFunction(FN, data)
  if (!res || res.success === false) {
    const info = cloudFnErrorMessage(res, { preferSilentPermission: true })
    const err = new Error(info.message)
    err.code = info.code || res?.code
    err.kind = info.kind
    err.shouldToast = info.shouldToast
    throw err
  }
  return res
}

function apply(result) {
  const s = result.settings || {}
  form.addressFillTimeoutDays = s.addressFillTimeoutDays || 7
  form.defaultDeliveryType = s.defaultDeliveryType || 'invite_address'
  form.allowHidePriceToggle = s.allowHidePriceToggle !== false
  canEdit.value = !!result.canEdit
  fromDefault.value = !!result.fromDefault
  docId.value = result.docId || ''
  ruleText.value = result.ruleText || ''
  nudgeRuleSummary.value = result.nudgeRuleSummary || ''
  contentFlagsHint.value = result.contentFlagsHint || ''
  if (result.timeoutOptions?.length) timeoutOptions.value = result.timeoutOptions
  if (result.deliveryOptions?.length) deliveryOptions.value = result.deliveryOptions
  stats.value = result.stats || stats.value
  subscribe.value = result.subscribe || subscribe.value
}

function notifyCloudError(e, fallback) {
  const info = cloudFnErrorMessage(e || { message: fallback }, { preferSilentPermission: true })
  if (info.shouldToast === false || e?.shouldToast === false) return
  ElMessage.error(info.message || fallback)
}

async function load() {
  loading.value = true
  try {
    const res = await callFn({ action: 'getSettings' })
    apply(res)
  } catch (e) {
    notifyCloudError(e, '加载失败：请确认已部署 manageGift 与 ADMIN_OPS_KEY 代理')
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!canEdit.value) {
    ElMessage.warning('仅超管可保存礼赠运营配置')
    return
  }
  saving.value = true
  try {
    const res = await callFn({
      action: 'saveSettings',
      docId: docId.value,
      settings: {
        addressFillTimeoutDays: form.addressFillTimeoutDays,
        defaultDeliveryType: form.defaultDeliveryType,
        allowHidePriceToggle: form.allowHidePriceToggle
      }
    })
    ElMessage.success(res.msg || '已保存')
    await load()
  } catch (e) {
    notifyCloudError(e, '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.gift-ops-config { padding: 8px 4px 24px; color: #4A4540; }
.header-section h2 { margin: 0 0 6px; font-size: 20px; color: #33302C; font-weight: 600; }
.subtitle { font-size: 13px; color: #6B6560; line-height: 1.5; max-width: 820px; }
.hint-alert { margin-top: 12px; margin-bottom: 16px; }
.config-card { margin-bottom: 16px; border: 1px solid #E8E5DE; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.preview { margin: 0; font-weight: 500; color: #33302C; }
.hint { margin: 8px 0 0; font-size: 12px; color: #A09A90; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 16px; }
.stat { background: #FAF6ED; border-radius: 8px; padding: 14px; text-align: center; }
.stat .n { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 22px; color: #C4A76C; font-weight: 600; }
.stat .n.warn { color: #E9A23B; }
.stat .l { margin-top: 4px; font-size: 12px; color: #6B6560; }
</style>
