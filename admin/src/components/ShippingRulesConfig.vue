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
        title="下单权威在 makeOrder：优先读本集合，失败回退代码 defaults（相框/玻璃罩类满 299 / 运费 18 / 顺丰；其余装裱方式免邮）。判定只看商品「装裱方式」craftType，未标注一律免邮。"
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
          <el-divider content-position="left">按装裱方式配置邮费</el-divider>
          <el-alert
            type="info"
            :closable="false"
            show-icon
            style="margin: 0 0 12px;"
            title="每一种装裱方式都可以单独设「包邮门槛」与「不包邮运费」；没单独配置的跟随最下面那条通配符。混合车（一单里有多种装裱方式）按门槛最高的一档算。"
          />
          <el-table :data="ruleRows" size="small" style="width: 100%; margin-bottom: 8px;">
            <el-table-column label="装裱方式" min-width="140">
              <template #default="{ row }">
                <span :class="{ 'rule-wildcard': row.isWildcard }">{{ row.label }}</span>
                <span v-if="row.isWildcard" class="hint">（通配符）</span>
              </template>
            </el-table-column>
            <el-table-column label="单独配置" width="100">
              <template #default="{ row }">
                <el-switch
                  v-if="!row.isWildcard"
                  :model-value="row.enabled"
                  @update:model-value="(v) => toggleRow(row, v)"
                />
                <span v-else class="hint">必配</span>
              </template>
            </el-table-column>
            <el-table-column label="包邮门槛（元）" width="170">
              <template #default="{ row }">
                <el-input-number
                  v-model="row.freeShippingThreshold"
                  :min="0" :step="10" :precision="2" :disabled="!row.enabled"
                  controls-position="right" style="width: 140px;"
                />
              </template>
            </el-table-column>
            <el-table-column label="不包邮运费（元/单）" width="180">
              <template #default="{ row }">
                <el-input-number
                  v-model="row.flatFee"
                  :min="0" :step="1" :precision="2" :disabled="!row.enabled"
                  controls-position="right" style="width: 140px;"
                />
              </template>
            </el-table-column>
            <el-table-column label="说明" min-width="160">
              <template #default="{ row }">
                <span class="hint">{{ row.enabled ? `满 ¥${fmt(row.freeShippingThreshold)} 免邮，否则 ¥${fmt(row.flatFee)}/单` : '跟随通配符' }}</span>
              </template>
            </el-table-column>
          </el-table>
          <div class="hint hint-block" style="margin-bottom: 12px;">
            判定只看商品的「装裱方式」（craftType），不看标题与类别。
            <strong>通配符那一档必须保留</strong>：未标注装裱方式的商品、以及后台用「选项维护」新加的
            （塑封 / 玻璃瓶…）都走它 —— 没有它，新装裱方式就没有规则可落。
          </div>

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
  DEFAULT_CHARGED_CRAFT_TYPES,
  DEFAULT_CRAFT_TYPE_RULES,
  CRAFT_TYPE_LABELS,
  WILDCARD_CRAFT_TYPE,
  VALID_CRAFT_TYPES
} from '../utils/shippingRules'
import { ElMessage } from 'element-plus'

const carriers = ['顺丰速运', '京东物流', '中通快递', '圆通速递', '申通快递', '韵达快递', 'EMS']

const fmt = (v) => (Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(2))

/**
 * 规则表的可编辑行 = **每一种装裱方式** + 一条通配符（2026-09-21 产品负责人重构）。
 * `enabled = false` 的行**不写进 craftTypeRules**（= 跟随通配符），避免存一堆同值规则。
 */
const ruleRows = ref(buildRows(getDefaultShippingConfig()))

function buildRows (cfg) {
  const rules = Array.isArray(cfg.craftTypeRules) && cfg.craftTypeRules.length
    ? cfg.craftTypeRules
    : DEFAULT_CRAFT_TYPE_RULES
  const wildcard = rules.find((r) => r.craftType === WILDCARD_CRAFT_TYPE) || DEFAULT_CRAFT_TYPE_RULES[DEFAULT_CRAFT_TYPE_RULES.length - 1]
  const rows = VALID_CRAFT_TYPES.map((value) => {
    const hit = rules.find((r) => r.craftType === value)
    return {
      craftType: value,
      label: CRAFT_TYPE_LABELS[value] || value,
      isWildcard: false,
      enabled: !!hit,
      freeShippingThreshold: hit ? hit.freeShippingThreshold : wildcard.freeShippingThreshold,
      flatFee: hit ? hit.flatFee : wildcard.flatFee
    }
  })
  rows.push({
    craftType: WILDCARD_CRAFT_TYPE,
    label: '其它',
    isWildcard: true,
    enabled: true,
    freeShippingThreshold: wildcard.freeShippingThreshold,
    flatFee: wildcard.flatFee
  })
  return rows
}

function toggleRow (row, on) {
  row.enabled = !!on
  if (row.enabled && (row.freeShippingThreshold == null || row.flatFee == null)) {
    const wildcard = ruleRows.value.find((r) => r.isWildcard)
    row.freeShippingThreshold = wildcard ? wildcard.freeShippingThreshold : 39
    row.flatFee = wildcard ? wildcard.flatFee : 10
  }
}

/** 表格 → craftTypeRules（只存"单独配置"的行 + 通配符） */
function rowsToRules () {
  return ruleRows.value
    .filter((r) => r.isWildcard || r.enabled)
    .map((r) => ({
      craftType: r.craftType,
      freeShippingThreshold: Number(r.freeShippingThreshold) || 0,
      flatFee: Number(r.flatFee) || 0
    }))
}

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
  ruleRows.value = buildRows(form)
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
  // 规则表以**表格**为准（它才是产品负责人要编辑的东西）；旧字段由 normalize 派生镜像
  const normalized = normalizeShippingConfig({ ...form, craftTypeRules: rowsToRules() })
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
  // 规则表校验（前端先拦；云端 getShippingRules 也会拒）
  const rules = rowsToRules()
  if (!rules.some((r) => r.craftType === WILDCARD_CRAFT_TYPE)) {
    ElMessage.warning('通配符那一档不能删（未标注与后台新增的装裱方式都靠它兜底）')
    return
  }
  if (!rules.some((r) => r.craftType !== WILDCARD_CRAFT_TYPE)) {
    ElMessage.warning('至少要单独配置一种装裱方式（全都跟随通配符 = 所有订单同一档）')
    return
  }
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
  ElMessage.info('已重置为默认（相框/三种玻璃罩 满 ¥299 免邮、否则 ¥18/单；其余含未标注 满 ¥39 免邮、否则 ¥10/单）')
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
.rule-wildcard { font-weight: 600; }
.hint-block {
  display: block;
  margin: 6px 0 0;
  line-height: 1.6;
}
</style>
