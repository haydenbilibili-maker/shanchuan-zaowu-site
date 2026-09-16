<template>
  <div class="welcome-gift-config">
    <div class="header-section">
      <h2>新会员礼包</h2>
      <p class="subtitle">
        唯一权威入口：与小程序「我的 → 超管工作台 → 新会员礼包」<strong>共用同一个云函数</strong>
        <code>manageWelcomeGift</code> 与同一条记录（集合 <code>member_welcome_gift</code>，
        注册时由 <code>upsertUserProfile</code> 发放同源）。本页已不再直写集合——
        直写会漏掉「操作人归属」与「已发未使用券条款同步」。
        缺配置走代码默认：100 积分 + 满49减5 / 满299减30 / 满499减50 / 满999减100（90 天、不可叠加）。
      </p>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-top: 12px;"
        title="同一 openid 整包只发一次（积分 + 礼券共用幂等键 register_gift:{openid}）。下单链路一单一券，与「不可叠加」一致。"
      />
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        style="margin-top: 8px;"
        title="礼券总开关必须至少启用一条券行：总开关开着但券行全停 = 新用户静默收不到券（保存会被服务端拒绝）。"
      />
    </div>

    <div class="config-container">
      <el-card v-loading="loading" class="rules-card">
        <p class="rule-preview">
          当前规则：{{ ruleText }}
          <span v-if="fromDefault" class="hint">（当前为代码默认，保存后写入 member_welcome_gift）</span>
        </p>
        <el-form :model="form" label-width="160px">
          <el-form-item label="启用礼包">
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
            <span class="hint">写入 bonusPoints；默认不计成长值</span>
          </el-form-item>
          <el-form-item label="不计成长值">
            <el-switch v-model="form.excludeGrowth" />
          </el-form-item>

          <el-divider content-position="left">礼券</el-divider>
          <el-form-item label="发放礼券">
            <el-switch v-model="form.couponsEnabled" active-text="开" inactive-text="关" />
          </el-form-item>
          <el-form-item label="默认有效天数">
            <el-input-number
              v-model="form.expireDays"
              :min="1"
              :precision="0"
              :disabled="!form.couponsEnabled"
              @change="onDefaultExpireDaysChange"
            />
            <el-button
              type="primary"
              link
              :disabled="!form.couponsEnabled || !(form.coupons && form.coupons.length)"
              style="margin-left: 8px;"
              @click="applyExpireDaysToAll"
            >应用到全部券</el-button>
            <span class="hint">改默认会同步「仍等于旧默认」的券行；也可点「应用到全部券」。保存后以各券 expireDays 为准。</span>
          </el-form-item>
          <el-form-item label="允许券叠加">
            <el-switch
              v-model="form.stackable"
              active-text="允许"
              inactive-text="不可叠加"
              :disabled="!form.couponsEnabled"
            />
            <span class="hint">默认关。即使打开，下单仍只接单张 couponId（与现网一致）</span>
          </el-form-item>

          <el-table :data="form.coupons" border size="small" style="margin-bottom: 16px;" empty-text="暂无礼券档位">
            <el-table-column label="启用" width="70" align="center">
              <template #default="{ row }">
                <el-switch v-model="row.enabled" :disabled="!form.couponsEnabled" />
              </template>
            </el-table-column>
            <el-table-column label="面额（元）" width="120">
              <template #default="{ row }">
                <el-input-number v-model="row.value" :min="1" :precision="0" size="small" :disabled="!form.couponsEnabled" />
              </template>
            </el-table-column>
            <el-table-column label="门槛（元）" width="120">
              <template #default="{ row }">
                <el-input-number v-model="row.minSpend" :min="0" :precision="0" size="small" :disabled="!form.couponsEnabled" />
              </template>
            </el-table-column>
            <el-table-column label="张数" width="100">
              <template #default="{ row }">
                <el-input-number v-model="row.count" :min="0" :precision="0" size="small" :disabled="!form.couponsEnabled" />
              </template>
            </el-table-column>
            <el-table-column label="有效天数" width="110">
              <template #default="{ row }">
                <el-input-number v-model="row.expireDays" :min="1" :precision="0" size="small" :disabled="!form.couponsEnabled" />
              </template>
            </el-table-column>
            <el-table-column label="渠道" width="130">
              <template #default="{ row }">
                <el-select v-model="row.channel" size="small" :disabled="!form.couponsEnabled">
                  <el-option label="仅线上" value="online" />
                  <el-option label="仅门店" value="store" />
                  <el-option label="线上+门店" value="all" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="券标题" min-width="180">
              <template #default="{ row }">
                <el-input v-model="row.title" size="small" :disabled="!form.couponsEnabled" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" fixed="right">
              <template #default="{ $index }">
                <el-button link type="danger" :disabled="!form.couponsEnabled" @click="removeCoupon($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-button
            type="primary"
            plain
            :disabled="!form.couponsEnabled"
            style="margin-bottom: 20px;"
            @click="addCoupon"
          >新增券档</el-button>

          <el-form-item>
            <el-button type="primary" :loading="saving" @click="saveRules">保存新会员礼包</el-button>
            <el-button @click="resetDefaults">重置为默认</el-button>
            <el-button :loading="loading" @click="loadRules">刷新</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, nextTick } from 'vue'
import { callCloudFunction } from '../cloud'
import {
  getDefaultWelcomeGiftConfig,
  normalizeWelcomeGiftConfig,
  applyDefaultExpireDaysToCoupons,
  resolveExpireDays,
  coerceNumber,
  validateWelcomeGiftCoupons
} from '../utils/welcomeGift'
import { ElMessage } from 'element-plus'

/** 与小程序超管工作台同一个云函数（唯一权威写入路径；代理注入 ADMIN_OPS_KEY → 判为超管） */
const FN = 'manageWelcomeGift'

const loading = ref(false)
const saving = ref(false)
const hydrating = ref(false)
const ruleDocId = ref('')
const fromDefault = ref(false)
/** 规则摘要由服务端 describeConfig 生成（含「券行全停」告警），不在前端另算一份 */
const ruleText = ref('')
/** 加载时的顶层默认天数；保存时用于同步「未单独改」的券行 */
const loadedExpireDays = ref(30)
const form = reactive(getDefaultWelcomeGiftConfig())

function applyForm(raw, docId = '') {
  hydrating.value = true
  const normalized = normalizeWelcomeGiftConfig(raw || {})
  // 禁止 delete 全量字段：会触发 el-input-number @change(undefined) → 被 resolve 成 30 并污染券行
  Object.assign(form, {
    ruleId: normalized.ruleId,
    name: normalized.name,
    status: normalized.status,
    enabled: normalized.enabled,
    title: normalized.title,
    messageTitle: normalized.messageTitle,
    points: normalized.points,
    pointsEnabled: normalized.pointsEnabled,
    excludeGrowth: normalized.excludeGrowth,
    couponsEnabled: normalized.couponsEnabled,
    expireDays: normalized.expireDays,
    stackable: normalized.stackable,
    priority: normalized.priority,
    coupons: (normalized.coupons || []).map((c) => ({ ...c }))
  })
  ruleDocId.value = docId || ''
  const topDays = resolveExpireDays(normalized.expireDays, null, 30)
  const couponDays = (form.coupons || []).map((c) => resolveExpireDays(c.expireDays, topDays, 30))
  if (couponDays.length && couponDays.every((d) => d === couponDays[0])) {
    loadedExpireDays.value = couponDays[0]
  } else {
    loadedExpireDays.value = topDays
  }
  nextTick(() => {
    hydrating.value = false
  })
}

async function loadRules() {
  loading.value = true
  try {
    const res = await callCloudFunction(FN, { action: 'get' })
    if (!res || res.success === false) throw new Error((res && res.msg) || '加载失败')
    applyForm(res.config, res.docId || '')
    ruleText.value = res.ruleText || ''
    fromDefault.value = !!res.fromDefault
  } catch (error) {
    console.error('加载新会员礼包失败:', error)
    applyForm(getDefaultWelcomeGiftConfig(), '')
    ElMessage.warning(
      (error && error.message) ||
        '未读到新会员礼包配置，已使用代码默认值（请确认 manageWelcomeGift 已部署、ADMIN_OPS_KEY 已配置）'
    )
  } finally {
    loading.value = false
  }
}

/** 提交前的纯表单整理（默认天数下发给「仍等于旧默认」的券行），不构造写库 payload */
function prepareForm() {
  const days = resolveExpireDays(form.expireDays, null, 30)
  form.expireDays = days
  const loaded = resolveExpireDays(loadedExpireDays.value, null, 30)
  if (days !== loaded) {
    applyDefaultExpireDaysToCoupons(form.coupons, days, { onlyMatching: loaded })
  }
  ;(form.coupons || []).forEach((row) => {
    if (!row) return
    const n = coerceNumber(row.expireDays)
    if (!Number.isFinite(n) || n < 1) row.expireDays = days
  })
  return days
}

async function saveRules() {
  saving.value = true
  try {
    // 前端只做「快速反馈」的预校验；权威校验、条款同步、操作人归属都在云函数里
    const couponCheck = validateWelcomeGiftCoupons(form)
    if (!couponCheck.ok) {
      throw new Error(couponCheck.msg || '礼券档位不符合折扣纪律')
    }
    const days = prepareForm()
    if (!(days >= 1)) {
      throw new Error('有效天数无效，请重新设置后再保存')
    }
    const res = await callCloudFunction(FN, {
      action: 'save',
      docId: ruleDocId.value,
      config: { ...form }
    })
    if (!res || res.success === false) throw new Error((res && res.msg) || '保存失败')
    ruleDocId.value = res.docId || ruleDocId.value
    ruleText.value = res.ruleText || ruleText.value
    fromDefault.value = false
    const sync = res.couponSync
    const syncMsg = sync && sync.updated ? `；已同步 ${sync.updated} 张未使用礼券门槛` : ''
    ElMessage.success(`新会员礼包已保存（默认 ${days} 天）${syncMsg}`)
    await loadRules()
  } catch (error) {
    console.error('保存新会员礼包失败:', error)
    ElMessage.error('保存失败：' + ((error && error.message) || '未知错误'))
  } finally {
    saving.value = false
  }
}

function resetDefaults() {
  // 与小程序超管工作台一致：服务端返回代码默认（不写库），需再点保存
  callCloudFunction(FN, { action: 'resetDefaults' })
    .then((res) => {
      if (!res || res.success === false) throw new Error((res && res.msg) || '恢复默认失败')
      applyForm(res.config, ruleDocId.value)
      ruleText.value = res.ruleText || ''
      fromDefault.value = true
      ElMessage.info(res.msg || '已恢复代码默认，记得点保存')
    })
    .catch((error) => {
      ElMessage.error('恢复默认失败：' + ((error && error.message) || '未知错误'))
    })
}

function onDefaultExpireDaysChange(next, prev) {
  // 加载/回填期间忽略；next 为空时绝不能 resolve 成 30 再回写券行
  if (hydrating.value) return
  const nextNum = coerceNumber(next)
  if (!Number.isFinite(nextNum) || nextNum < 1) return
  const nextDays = Math.max(1, Math.floor(nextNum))
  const prevNum = coerceNumber(prev)
  if (!Number.isFinite(prevNum) || prevNum < 1) return
  const prevDays = Math.max(1, Math.floor(prevNum))
  if (nextDays === prevDays) return
  applyDefaultExpireDaysToCoupons(form.coupons, nextDays, { onlyMatching: prevDays })
}

function applyExpireDaysToAll() {
  const days = applyDefaultExpireDaysToCoupons(form.coupons, form.expireDays)
  form.expireDays = days
  ElMessage.success(`已将有效天数 ${days} 应用到全部券行`)
}

function addCoupon() {
  const days = resolveExpireDays(form.expireDays, null, 30)
  form.coupons.push({
    id: `c${Date.now()}`,
    enabled: true,
    value: 10,
    minSpend: 100,
    expireDays: days,
    count: 1,
    title: '新会员礼券',
    channel: 'all'
  })
}

function removeCoupon(index) {
  form.coupons.splice(index, 1)
}

onMounted(() => {
  loadRules()
})
</script>

<style scoped>
.welcome-gift-config {
  padding: 24px;
  background: linear-gradient(135deg, #fafbfc 0%, #f0f2f5 100%);
  min-height: calc(100vh - 120px);
  color: #2c3e50;
}

.header-section {
  margin-bottom: 24px;
}

.header-section h2 {
  color: #d4af37;
  margin: 0 0 8px 0;
  font-size: 24px;
}

.subtitle {
  color: #5a6c7d;
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
}

.subtitle code {
  background: #f0ebe0;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}

.rules-card {
  max-width: 960px;
}

.rule-preview {
  margin: 0 0 20px;
  padding: 12px 14px;
  background: #faf6ed;
  border: 1px solid #e0cfa3;
  border-radius: 8px;
  color: #6b5a24;
  font-size: 14px;
}

.hint {
  margin-left: 10px;
  color: #999;
  font-size: 12px;
}
</style>
