<template>
  <div class="birthday-gift-config">
    <div class="header-section">
      <h2>生日礼配置</h2>
      <p class="subtitle">
        SSOT 集合 <code>member_birthday_gift</code>（与小程序超管台「生日礼包」同源、同云函数
        <code>manageBirthdayGift</code>）。缺配置走代码默认值；会员生日当天可在小程序自行领取，防重键
        <code>birthday_gift:{openid}:{year}</code>。
      </p>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-top: 12px;"
        title="两端改的是同一份配置：ERP 保存后，小程序端刷新即生效；小程序侧修改同样会体现在本页。"
      />
    </div>

    <div class="config-container">
      <el-card v-loading="loading" class="rules-card">
        <p class="rule-preview">当前规则：{{ ruleText }}</p>
        <el-form :model="form" label-width="160px">
          <el-form-item label="启用生日礼">
            <el-switch v-model="form.enabled" active-text="开" inactive-text="关" />
          </el-form-item>
          <el-form-item label="规则名称">
            <el-input v-model="form.name" style="max-width: 360px;" maxlength="40" show-word-limit />
          </el-form-item>
          <el-form-item label="礼包标题">
            <el-input v-model="form.title" style="max-width: 360px;" maxlength="40" show-word-limit />
            <span class="hint">写入积分流水标题</span>
          </el-form-item>
          <el-form-item label="站内信标题">
            <el-input v-model="form.messageTitle" style="max-width: 360px;" maxlength="40" show-word-limit />
          </el-form-item>

          <el-divider content-position="left">积分</el-divider>
          <el-form-item label="发放积分">
            <el-switch v-model="form.pointsEnabled" active-text="开" inactive-text="关" />
          </el-form-item>
          <el-form-item label="积分数量">
            <el-input-number v-model="form.points" :min="0" :precision="0" :disabled="!form.pointsEnabled" />
            <span class="hint">默认不计成长值</span>
          </el-form-item>
          <el-form-item label="不计成长值">
            <el-switch v-model="form.excludeGrowth" />
          </el-form-item>

          <el-divider content-position="left">礼券</el-divider>
          <el-form-item label="发放礼券">
            <el-switch v-model="form.couponsEnabled" active-text="开" inactive-text="关" />
          </el-form-item>
          <el-form-item label="有效期模式">
            <el-radio-group v-model="form.expireMode" :disabled="!form.couponsEnabled">
              <el-radio-button label="days">按天数</el-radio-button>
              <el-radio-button label="end_of_month">当月月底</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.expireMode === 'days'" label="默认有效天数">
            <el-input-number v-model="form.expireDays" :min="1" :precision="0" :disabled="!form.couponsEnabled" />
          </el-form-item>
          <el-form-item label="允许叠加">
            <el-switch v-model="form.stackable" active-text="允许" inactive-text="不可叠加" :disabled="!form.couponsEnabled" />
          </el-form-item>

          <el-table :data="form.coupons" border size="small" style="margin-bottom: 16px;" empty-text="暂无礼券档位">
            <el-table-column label="启用" width="70" align="center">
              <template #default="scope"><el-switch v-model="scope.row.enabled" /></template>
            </el-table-column>
            <el-table-column label="券标题" min-width="150">
              <template #default="scope"><el-input v-model="scope.row.title" maxlength="20" placeholder="如 生日礼券" /></template>
            </el-table-column>
            <el-table-column label="面额（元）" width="120">
              <template #default="scope"><el-input-number v-model="scope.row.value" :min="0" :precision="0" size="small" /></template>
            </el-table-column>
            <el-table-column label="门槛（元）" width="120">
              <template #default="scope"><el-input-number v-model="scope.row.minSpend" :min="0" :precision="0" size="small" /></template>
            </el-table-column>
            <el-table-column label="有效天数" width="120">
              <template #default="scope"><el-input-number v-model="scope.row.expireDays" :min="1" :precision="0" size="small" /></template>
            </el-table-column>
            <el-table-column label="张数" width="100">
              <template #default="scope"><el-input-number v-model="scope.row.count" :min="1" :precision="0" size="small" /></template>
            </el-table-column>
          </el-table>

          <div class="actions">
            <el-button type="primary" :loading="saving" @click="save">保存配置</el-button>
            <el-button :disabled="saving" @click="resetDefaults">恢复默认</el-button>
            <el-button link :disabled="loading || saving" @click="load">重新读取</el-button>
          </div>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction } from '../cloud'

const FN = 'manageBirthdayGift'
const loading = ref(false)
const saving = ref(false)
const fromDefault = ref(false)
const ruleText = ref('')
/** 单例文档 id：小程序端保存时也会回写，两端共用同一条记录 */
const docId = ref('')

const defaultForm = () => ({
  enabled: true,
  name: '生日礼包',
  title: '生日礼包',
  messageTitle: '生日快乐，礼券已到账',
  pointsEnabled: true,
  points: 0,
  pointsTitle: '生日礼券 · 专属积分',
  excludeGrowth: true,
  couponsEnabled: true,
  expireMode: 'end_of_month',
  expireDays: 30,
  stackable: false,
  coupons: [],
})

const form = reactive(defaultForm())
const couponTotal = computed(() => (form.coupons || []).filter((c) => c.enabled !== false).length)

function applyConfig(cfg) {
  const c = cfg || {}
  Object.assign(form, {
    enabled: c.enabled !== false,
    name: c.name || '生日礼包',
    title: c.title || '生日礼包',
    messageTitle: c.messageTitle || '生日快乐，礼券已到账',
    pointsEnabled: c.pointsEnabled !== false,
    points: Number(c.points) || 0,
    pointsTitle: c.pointsTitle || '生日礼券 · 专属积分',
    excludeGrowth: c.excludeGrowth !== false,
    couponsEnabled: c.couponsEnabled !== false,
    expireMode: c.expireMode === 'days' ? 'days' : 'end_of_month',
    expireDays: Number(c.expireDays) || 30,
    stackable: c.stackable === true,
    coupons: (c.coupons || []).map((x) => ({
      id: x.id || `c_${Math.random().toString(36).slice(2, 8)}`,
      enabled: x.enabled !== false,
      title: x.title || '',
      value: Number(x.value) || 0,
      minSpend: Number(x.minSpend) || 0,
      expireDays: Number(x.expireDays) || 30,
      count: Number(x.count) || 1,
    })),
  })
}

async function load() {
  loading.value = true
  try {
    const res = await callCloudFunction(FN, { action: 'get' })
    if (!res || res.success === false) throw new Error((res && res.msg) || '加载失败')
    applyConfig(res.config)
    fromDefault.value = !!res.fromDefault
    ruleText.value = res.ruleText || ''
    docId.value = res.docId || ''
  } catch (e) {
    applyConfig(defaultForm())
    ElMessage.warning(e?.message || '未读到生日礼配置，已使用代码默认值')
  } finally {
    loading.value = false
  }
}

async function save() {
  if (form.couponsEnabled && !(form.coupons || []).length) {
    ElMessage.warning('已开启礼券但没有任何档位；可关闭礼券或补一档')
    return
  }
  saving.value = true
  try {
    const res = await callCloudFunction(FN, { action: 'save', docId: docId.value, config: { ...form } })
    if (!res || res.success === false) throw new Error((res && res.msg) || '保存失败')
    docId.value = res.docId || docId.value
    ruleText.value = res.ruleText || ruleText.value
    ElMessage.success('生日礼配置已保存，小程序端刷新即生效')
  } catch (e) {
    ElMessage.error(e?.message || '保存失败，请刷新重试；持续失败请联系技术' /* 技术排查：请确认已部署 manageBirthdayGift，并配置 ADMIN_OPS_KEY */)
  } finally {
    saving.value = false
  }
}

function resetDefaults() {
  ElMessageBox.confirm('将恢复为代码内置的生日礼默认配置（不会立即写库，需再点保存）。', '恢复默认', {
    confirmButtonText: '恢复',
    cancelButtonText: '取消',
    type: 'warning',
  })
    .then(async () => {
      try {
        const res = await callCloudFunction(FN, { action: 'resetDefaults' })
        if (res && res.success !== false && res.config) {
          applyConfig(res.config)
          ruleText.value = res.ruleText || ''
        } else {
          applyConfig(defaultForm())
        }
        ElMessage.success('已恢复默认，确认后点「保存配置」写入')
      } catch (e) {
        applyConfig(defaultForm())
        ElMessage.warning(e?.message || '恢复默认失败，已载入本地默认值')
      }
    })
    .catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

onMounted(load)
</script>

<style scoped>
.birthday-gift-config { padding: 4px; }
.header-section h2 { margin: 0 0 6px; }
.subtitle { color: #8a8279; font-size: 13px; line-height: 1.6; margin: 0; }
.config-container { margin-top: 16px; }
.rule-preview { color: #b88a4d; font-size: 13px; margin: 0 0 16px; }
.hint { margin-left: 8px; color: #8a8279; font-size: 12px; }
.actions { display: flex; gap: 12px; align-items: center; }
</style>
