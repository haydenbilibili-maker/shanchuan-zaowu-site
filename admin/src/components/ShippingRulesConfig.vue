<template>
  <div class="shipping-rules-config">
    <div class="header-section">
      <h2>运费与包邮规则</h2>
      <p class="subtitle">
        线上 SSOT 为集合 <code>shipping_rules</code>（与小程序 makeOrder / getShippingRules 同源）。
        改门槛后无需改代码、无需重部署云函数逻辑。
      </p>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-top: 12px;"
        title="下单权威在 makeOrder：优先读本集合，失败回退代码 defaults（饰品满 200 / 标本满 500 / 运费 18 / 顺丰）。"
      />
    </div>

    <div class="config-container">
      <el-card v-loading="loading" class="rules-card">
        <p class="rule-preview">当前规则：{{ ruleText }}</p>
        <el-form :model="form" label-width="180px">
          <el-form-item label="规则名称">
            <el-input v-model="form.name" style="max-width: 360px;" maxlength="40" show-word-limit />
          </el-form-item>
          <el-form-item label="默认承运商">
            <el-select v-model="form.defaultCarrier" filterable allow-create style="width: 240px;">
              <el-option v-for="c in carriers" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item>
          <el-form-item label="不包邮运费（元）">
            <el-input-number v-model="form.flatFee" :min="0" :step="1" :precision="2" />
            <span class="hint">默认 18</span>
          </el-form-item>
          <el-form-item label="饰品包邮门槛（元）">
            <el-input-number v-model="form.accessoryFreeThreshold" :min="0" :step="10" :precision="2" />
            <span class="hint">默认 200</span>
          </el-form-item>
          <el-form-item label="标本包邮门槛（元）">
            <el-input-number v-model="form.specimenFreeThreshold" :min="0" :step="10" :precision="2" />
            <span class="hint">默认 500</span>
          </el-form-item>
          <el-form-item label="混合车策略">
            <el-radio-group v-model="form.mixCartStrategy">
              <el-radio :label="MIX_SPECIMEN_WINS">含标本 → 标本门槛</el-radio>
              <el-radio :label="MIX_MAX_THRESHOLD">取更高门槛</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-divider content-position="left">限时全场免邮</el-divider>
          <el-form-item label="活动开关">
            <el-switch
              v-model="form.freeShippingCampaign.enabled"
              active-text="全场免邮"
              inactive-text="按门槛"
            />
          </el-form-item>
          <el-form-item label="活动文案">
            <el-input
              v-model="form.freeShippingCampaign.label"
              style="max-width: 360px;"
              placeholder="限时免费邮寄"
            />
          </el-form-item>
          <el-form-item label="开始时间（可选）">
            <el-input
              v-model="form.freeShippingCampaign.startAt"
              style="max-width: 360px;"
              placeholder="如 2026-09-01T00:00:00+08:00"
            />
          </el-form-item>
          <el-form-item label="结束时间（可选）">
            <el-input
              v-model="form.freeShippingCampaign.endAt"
              style="max-width: 360px;"
              placeholder="如 2026-09-30T23:59:59+08:00"
            />
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="saving" @click="saveRules">保存运费规则</el-button>
            <el-button @click="resetDefaults">重置为默认</el-button>
            <el-button :loading="syncing" @click="saveViaCloud">经云函数保存（ops key）</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import {
  fetchCollectionLimit,
  cdnUpsertSingleton,
  cdnUpdate,
  COLLECTIONS,
  callCloudFunction
} from '../cloud'
import {
  getDefaultShippingConfig,
  normalizeShippingConfig,
  describeShippingRule,
  MIX_SPECIMEN_WINS,
  MIX_MAX_THRESHOLD
} from '../utils/shippingRules'
import { ElMessage } from 'element-plus'

const carriers = ['顺丰速运', '京东物流', '中通快递', '圆通速递', '申通快递', '韵达快递', 'EMS']

const loading = ref(false)
const saving = ref(false)
const syncing = ref(false)
const ruleDocId = ref('')
const form = reactive(getDefaultShippingConfig())
const ruleText = computed(() => describeShippingRule(form))

function applyForm(raw, docId = '') {
  const normalized = normalizeShippingConfig(raw || {})
  Object.keys(form).forEach((k) => delete form[k])
  Object.assign(form, normalized)
  if (!form.freeShippingCampaign) {
    form.freeShippingCampaign = getDefaultShippingConfig().freeShippingCampaign
  }
  ruleDocId.value = docId || ''
}

async function loadRules() {
  loading.value = true
  try {
    const rows = await fetchCollectionLimit(COLLECTIONS.SHIPPING_RULES, { limit: 10 })
    const active = (rows || [])
      .filter((r) => r.status !== 'inactive')
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    const top = active[0]
    if (top) {
      applyForm(top, top._id)
    } else {
      applyForm(getDefaultShippingConfig(), '')
    }
  } catch (error) {
    console.error('加载运费规则失败:', error)
    applyForm(getDefaultShippingConfig(), '')
    ElMessage.warning('未读到 shipping_rules，已使用代码默认值')
  } finally {
    loading.value = false
  }
}

function buildPayload() {
  const normalized = normalizeShippingConfig(form)
  return {
    ...normalized,
    freeShippingCampaign: { ...normalized.freeShippingCampaign },
    status: 'active',
    _updateTime: Date.now(),
    updateTime: Date.now()
  }
}

async function saveRules() {
  saving.value = true
  try {
    const payload = buildPayload()
    if (ruleDocId.value) {
      await cdnUpdate(COLLECTIONS.SHIPPING_RULES, ruleDocId.value, payload)
    } else {
      await cdnUpsertSingleton(COLLECTIONS.SHIPPING_RULES, {
        ...payload,
        ruleId: payload.ruleId || 'shipping_default_v1',
        _createTime: Date.now(),
        createTime: Date.now()
      })
    }
    ElMessage.success('已写入 shipping_rules')
    await loadRules()
  } catch (error) {
    console.error('保存运费规则失败:', error)
    ElMessage.error('保存失败：' + (error.message || '未知错误') + '（请确认已创建集合 shipping_rules）')
  } finally {
    saving.value = false
  }
}

async function saveViaCloud() {
  syncing.value = true
  try {
    const payload = buildPayload()
    const res = await callCloudFunction('getShippingRules', {
      action: 'save',
      ruleDocId: ruleDocId.value || '',
      config: payload
    })
    if (!res || res.success === false) {
      throw new Error(res?.msg || '云函数保存失败')
    }
    ElMessage.success('已通过 getShippingRules 保存')
    await loadRules()
  } catch (error) {
    console.error('云函数保存失败:', error)
    ElMessage.error(error.message || '云函数保存失败（可改用上方「保存运费规则」直写集合）')
  } finally {
    syncing.value = false
  }
}

function resetDefaults() {
  applyForm(getDefaultShippingConfig(), ruleDocId.value)
  ElMessage.info('已重置为默认（饰品 200 / 标本 500 / 运费 18）')
}

onMounted(() => {
  loadRules()
})
</script>

<style scoped>
.shipping-rules-config {
  padding: 8px 4px 32px;
  color: #33302c;
}
.header-section h2 {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 600;
  color: #33302c;
}
.subtitle {
  margin: 0;
  font-size: 13px;
  color: #6b6560;
  line-height: 1.5;
}
.subtitle code {
  background: #faf6ed;
  color: #8a7530;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.config-container {
  margin-top: 20px;
  max-width: 720px;
}
.rules-card {
  border: 1px solid #e8e5de;
  box-shadow: 0 1px 2px rgba(26, 24, 20, 0.05);
}
.rule-preview {
  margin: 0 0 20px;
  padding: 12px 14px;
  background: #faf6ed;
  border-left: 3px solid #c4a76c;
  color: #4a4540;
  font-size: 14px;
}
.hint {
  margin-left: 12px;
  color: #a09a90;
  font-size: 12px;
}
</style>
