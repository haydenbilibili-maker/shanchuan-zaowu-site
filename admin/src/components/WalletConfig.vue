<template>
  <div class="wallet-config">
    <div class="header-section">
      <h2>我的钱包</h2>
      <p class="subtitle">
        对齐小程序云函数 <code>manageStoredValue</code> · 集合 <code>stored_value_config</code>。
        本页配置充值档位；支付折扣以「会员等级体系」为准。入口开关为 <code>showStoredValue</code>。
      </p>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="hint-alert"
        title="充值不赠送：实付全额记入本金。用钱包支付时享受本单可达的会员等级折扣（与高价值购预升级同一套定级），无独立钱包折扣率。"
      />
    </div>

    <el-card v-loading="loading" class="config-card">
      <template #header>
        <div class="card-head">
          <span>入口与权益说明</span>
          <el-tag size="small" :type="enabled ? 'success' : 'info'">
            {{ enabled ? 'C 端入口已开（showStoredValue）' : 'C 端入口关闭' }}
          </el-tag>
        </div>
      </template>
      <p class="hint">
        入口开关请在「内容展示开关」或店长后台打开 <code>showStoredValue</code>。
        折扣请到「会员等级体系」配置，勿再配置独立钱包折。
      </p>
      <p class="preview">{{ BENEFIT_RULE }}</p>
      <el-form label-width="140px" style="margin-top: 16px; max-width: 640px;">
        <el-form-item label="C 端说明文案">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="用钱包支付时，按本单可达的会员等级享受专属支付折扣。充值金额将全额计入可用余额。"
          />
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-loading="loading" class="config-card">
      <template #header>充值档位（元）</template>
      <el-table :data="form.packages" border size="small" style="width: 100%; max-width: 720px;">
        <el-table-column label="档位 ID" width="120">
          <template #default="{ row }">
            <el-input v-model="row.id" maxlength="16" />
          </template>
        </el-table-column>
        <el-table-column label="名称" min-width="140">
          <template #default="{ row }">
            <el-input v-model="row.name" maxlength="40" />
          </template>
        </el-table-column>
        <el-table-column label="充值金额（元）" width="150">
          <template #default="{ row }">
            <el-input-number
              v-model="row.payYuan"
              :min="1"
              :step="50"
              :precision="0"
              controls-position="right"
            />
          </template>
        </el-table-column>
        <el-table-column label="排序" width="100">
          <template #default="{ row }">
            <el-input-number v-model="row.sort" :min="0" :step="10" controls-position="right" />
          </template>
        </el-table-column>
        <el-table-column label="启用" width="80" align="center">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" />
          </template>
        </el-table-column>
        <el-table-column label="" width="80" align="center">
          <template #default="{ $index }">
            <el-button link type="danger" @click="removePackage($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="row-actions">
        <el-button @click="addPackage">添加档位</el-button>
      </div>
    </el-card>

    <el-card v-loading="loading" class="config-card">
      <template #header>自定义金额充值</template>
      <p class="hint">
        C 端除档位外可输入任意金额。默认 1 元起、5 万元封顶、1 元步进；关闭后仅可按档位充值。
      </p>
      <el-form label-width="160px" style="margin-top: 12px; max-width: 560px;">
        <el-form-item label="允许自定义金额">
          <el-switch v-model="form.allowCustom" />
        </el-form-item>
        <el-form-item label="最低金额（元）">
          <el-input-number
            v-model="form.minCustomYuan"
            :min="1"
            :max="form.maxCustomYuan"
            :step="1"
            :precision="0"
            controls-position="right"
            :disabled="!form.allowCustom"
          />
        </el-form-item>
        <el-form-item label="最高金额（元）">
          <el-input-number
            v-model="form.maxCustomYuan"
            :min="form.minCustomYuan"
            :max="100000"
            :step="100"
            :precision="0"
            controls-position="right"
            :disabled="!form.allowCustom"
          />
        </el-form-item>
        <el-form-item label="步进（元）">
          <el-input-number
            v-model="form.customStepYuan"
            :min="1"
            :max="1000"
            :step="1"
            :precision="0"
            controls-position="right"
            :disabled="!form.allowCustom"
          />
        </el-form-item>
      </el-form>
    </el-card>

    <div class="footer-actions">
      <el-button type="primary" color="#2D6A4F" :loading="saving" @click="saveConfig">
        保存钱包配置
      </el-button>
      <el-button @click="resetDefaults">恢复默认</el-button>
      <el-button :loading="loading" @click="loadConfig">刷新</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { callCloudFunction } from '../cloud'
import { ElMessage } from 'element-plus'

const BENEFIT_RULE =
  '钱包权益 = 会员等级支付折扣（含本单金额预估可达等级）。无独立「钱包 9.5 折」等配置。'

const DEFAULT_PACKAGES = [
  { id: 'T100', name: '充值 100', payYuan: 100, sort: 10, enabled: true },
  { id: 'T300', name: '充值 300', payYuan: 300, sort: 20, enabled: true },
  { id: 'T500', name: '充值 500', payYuan: 500, sort: 30, enabled: true },
  { id: 'T1000', name: '充值 1000', payYuan: 1000, sort: 40, enabled: true }
]

const DEFAULT_DESCRIPTION =
  '用钱包支付时，按本单可达的会员等级享受专属支付折扣。充值金额将全额计入可用余额。'

const DEFAULT_RECHARGE = {
  allowCustom: true,
  minCustomYuan: 1,
  maxCustomYuan: 50000,
  customStepYuan: 1
}

const loading = ref(false)
const saving = ref(false)
const enabled = ref(false)
const form = reactive({
  packages: DEFAULT_PACKAGES.map((p) => ({ ...p })),
  description: DEFAULT_DESCRIPTION,
  allowCustom: DEFAULT_RECHARGE.allowCustom,
  minCustomYuan: DEFAULT_RECHARGE.minCustomYuan,
  maxCustomYuan: DEFAULT_RECHARGE.maxCustomYuan,
  customStepYuan: DEFAULT_RECHARGE.customStepYuan
})

const opsKey = () => import.meta.env?.VITE_ADMIN_OPS_KEY || undefined

function fenToYuan(fen) {
  return Math.round((Number(fen) || 0)) / 100
}

function yuanToFen(yuan) {
  return Math.round((Number(yuan) || 0) * 100)
}

function applyRemote(result) {
  enabled.value = result.enabled === true
  const cfg = result.config || {}
  const pkgs = Array.isArray(cfg.packages) && cfg.packages.length
    ? cfg.packages
    : DEFAULT_PACKAGES.map((p) => ({
      id: p.id,
      name: p.name,
      payFen: yuanToFen(p.payYuan),
      sort: p.sort,
      enabled: true
    }))
  form.packages = pkgs.map((p, i) => ({
    id: p.id || `T${i + 1}`,
    name: p.name || `充值 ${fenToYuan(p.payFen)}`,
    payYuan: fenToYuan(p.payFen != null ? p.payFen : p.payYuan),
    sort: p.sort != null ? Number(p.sort) : (i + 1) * 10,
    enabled: p.enabled !== false
  }))
  const desc = (cfg.benefit && cfg.benefit.description) || result.benefitText || ''
  form.description = desc && !/选用钱包支付时可享|更优一档/.test(desc)
    ? desc
    : DEFAULT_DESCRIPTION
  const recharge = cfg.recharge || result.recharge || {}
  form.allowCustom = recharge.allowCustom !== false
  form.minCustomYuan = recharge.minCustomFen != null
    ? fenToYuan(recharge.minCustomFen)
    : (recharge.minCustomYuan != null ? Number(recharge.minCustomYuan) : DEFAULT_RECHARGE.minCustomYuan)
  form.maxCustomYuan = recharge.maxCustomFen != null
    ? fenToYuan(recharge.maxCustomFen)
    : (recharge.maxCustomYuan != null ? Number(recharge.maxCustomYuan) : DEFAULT_RECHARGE.maxCustomYuan)
  form.customStepYuan = recharge.customStepFen != null
    ? fenToYuan(recharge.customStepFen)
    : (recharge.customStepYuan != null ? Number(recharge.customStepYuan) : DEFAULT_RECHARGE.customStepYuan)
}

async function loadConfig() {
  loading.value = true
  try {
    const res = await callCloudFunction('manageStoredValue', {
      action: 'getConfig',
      adminOpsKey: opsKey()
    })
    if (!res || res.success === false) {
      throw new Error((res && res.msg) || '加载失败')
    }
    applyRemote(res)
    if (res.fromDefault) {
      ElMessage.info('当前为默认配置；保存后写入云库')
    }
  } catch (e) {
    applyRemote({
      enabled: false,
      config: {
        packages: DEFAULT_PACKAGES.map((p) => ({
          id: p.id,
          name: p.name,
          payFen: yuanToFen(p.payYuan),
          sort: p.sort,
          enabled: true
        })),
        benefit: { description: DEFAULT_DESCRIPTION }
      }
    })
    ElMessage.warning('加载失败，已回退默认：' + (e.message || e))
  } finally {
    loading.value = false
  }
}

function addPackage() {
  const n = form.packages.length + 1
  form.packages.push({
    id: `T${n * 100}`,
    name: `充值 ${n * 100}`,
    payYuan: n * 100,
    sort: n * 10,
    enabled: true
  })
}

function removePackage(index) {
  if (form.packages.length <= 1) {
    ElMessage.warning('至少保留一个档位')
    return
  }
  form.packages.splice(index, 1)
}

function resetDefaults() {
  form.packages = DEFAULT_PACKAGES.map((p) => ({ ...p }))
  form.description = DEFAULT_DESCRIPTION
  form.allowCustom = DEFAULT_RECHARGE.allowCustom
  form.minCustomYuan = DEFAULT_RECHARGE.minCustomYuan
  form.maxCustomYuan = DEFAULT_RECHARGE.maxCustomYuan
  form.customStepYuan = DEFAULT_RECHARGE.customStepYuan
  ElMessage.info('已恢复本地默认，点击保存写入云库')
}

function buildPayload() {
  const minYuan = Math.max(1, Number(form.minCustomYuan) || 1)
  const maxYuan = Math.max(minYuan, Number(form.maxCustomYuan) || 50000)
  const stepYuan = Math.max(1, Number(form.customStepYuan) || 1)
  return {
    packages: form.packages.map((p, i) => ({
      id: String(p.id || `T${i + 1}`).trim(),
      name: String(p.name || '').trim(),
      payFen: yuanToFen(p.payYuan),
      principalFen: yuanToFen(p.payYuan),
      bonusFen: 0,
      sort: Number(p.sort) || (i + 1) * 10,
      enabled: p.enabled !== false
    })),
    benefit: {
      enabled: false,
      discountRate: 1,
      stackMode: 'none',
      description: String(form.description || DEFAULT_DESCRIPTION).slice(0, 200)
    },
    recharge: {
      allowCustom: form.allowCustom !== false,
      minCustomFen: yuanToFen(minYuan),
      maxCustomFen: yuanToFen(maxYuan),
      customStepFen: yuanToFen(stepYuan)
    }
  }
}

async function saveConfig() {
  const payload = buildPayload()
  if (!payload.packages.some((p) => p.enabled && p.payFen > 0)) {
    ElMessage.error('请至少启用一个有效充值档位')
    return
  }
  saving.value = true
  try {
    const res = await callCloudFunction('manageStoredValue', {
      action: 'saveConfig',
      adminOpsKey: opsKey(),
      config: payload
    })
    if (!res || res.success === false) {
      throw new Error((res && res.msg) || '保存失败')
    }
    ElMessage.success('钱包配置已保存')
    await loadConfig()
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || e))
  } finally {
    saving.value = false
  }
}

onMounted(loadConfig)
</script>

<style scoped>
.wallet-config {
  padding: 8px 4px 40px;
}
.header-section h2 {
  margin: 0;
  font-size: 22px;
  color: #33302c;
  border-left: 5px solid #2d6a4f;
  padding-left: 12px;
  font-weight: 800;
}
.header-section .subtitle {
  margin: 8px 0 0;
  color: #6b6560;
  font-size: 13px;
  padding-left: 17px;
  line-height: 1.5;
}
.header-section code,
.hint code {
  font-size: 12px;
  background: #f2ede4;
  padding: 1px 6px;
  border-radius: 4px;
}
.hint-alert {
  margin: 14px 0 16px;
}
.config-card {
  margin-bottom: 16px;
  border-radius: 12px;
  max-width: 900px;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.hint {
  font-size: 12px;
  color: #6b6560;
  line-height: 1.5;
  margin: 0;
}
.preview {
  margin: 12px 0 0;
  font-size: 13px;
  color: #4a4540;
  line-height: 1.55;
}
.row-actions {
  margin-top: 12px;
}
.footer-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
