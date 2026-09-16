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
            <!-- 只有一个保存入口：shipping_rules 为只读集合，写必须经 getShippingRules 云函数。
                 原先并排放着「直写集合」和「经云函数保存」两个按钮，前者必失败却显示成功
                 （并误导用户去点它），属典型的「同一件事两个通道、其中一个是坏的」。 -->
            <el-button type="primary" :loading="saving" @click="saveRules">保存运费规则</el-button>
            <el-button @click="resetDefaults">重置为默认</el-button>
            <span class="save-hint">经 <code>getShippingRules</code> 云函数写入（集合本身只读）</span>
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
    // 直读失败（例如将来把 read 收紧为 false）时**先试云函数**，最后才回落代码默认值，
    // 避免「读不到就静默用默认值」掩盖真实配置
    console.error('直读 shipping_rules 失败，改试云函数:', error)
    try {
      const res = await callCloudFunction('getShippingRules', { action: 'get' })
      if (res && res.success !== false && res.config) {
        applyForm({ ...res.config, ruleId: res.config.ruleId || 'shipping_default_v1' }, res.ruleDocId || '')
        ElMessage.info('运费规则经云函数读取（集合直读不可用）')
        return
      }
      throw new Error(res?.msg || '云函数未返回配置')
    } catch (e2) {
      console.error('云函数读取运费规则也失败:', e2)
      applyForm(getDefaultShippingConfig(), '')
      ElMessage.warning('未读到运费规则，已使用代码默认值（保存仍可经云函数进行）')
    }
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

/**
 * 保存运费规则 —— **唯一**写入通道：`getShippingRules` 云函数。
 *
 * 为什么不能直写：线上 `shipping_rules` 规则是 `{ read: true, write: false }`，
 * 直写会被安全规则拒绝；而权限被拒时 SDK **不抛错**（只 resolve 错误码），
 * 于是原来的直写分支会打出「已写入 shipping_rules」却零落库，
 * 还把失败原因误导成「请确认已创建集合」。
 * `getShippingRules` 已在代理白名单内，实测 `action:'get'` 返回 success（同函数同鉴权路径）。
 */
async function saveRules() {
  saving.value = true
  try {
    const payload = buildPayload()
    const res = await callCloudFunction('getShippingRules', {
      action: 'save',
      ruleDocId: ruleDocId.value || '',
      config: payload
    })
    if (!res || res.success === false) {
      throw new Error(res?.msg || '云函数未返回成功')
    }
    ElMessage.success('运费规则已保存')
    await loadRules()
  } catch (error) {
    console.error('保存运费规则失败:', error)
    // 不再把权限问题误诊为「集合未创建」，也不再引导用户去走已删除的直写通道
    ElMessage.error('保存失败：' + (error.message || '未知错误') + '（运费规则必须经 getShippingRules 云函数写入，请确认该函数已部署且代理已配置 ADMIN_OPS_KEY）')
  } finally {
    saving.value = false
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
.save-hint { margin-left: 8px; font-size: 12px; color: var(--light-text-secondary); }
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
