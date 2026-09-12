<template>
  <div class="welcome-gift-config">
    <div class="header-section">
      <h2>新会员礼包</h2>
      <p class="subtitle">
        线上 SSOT 为集合 <code>member_welcome_gift</code>（与小程序
        <code>upsertUserProfile</code> 完成注册时发放同源）。缺配置走代码默认：100 积分 + 10/30/50/100 元礼券各一张（30 天、不可叠加）。
      </p>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-top: 12px;"
        title="同一 openid 整包只发一次（积分 + 礼券共用幂等键 register_gift:{openid}）。下单链路一单一券，与「不可叠加」一致。"
      />
    </div>

    <div class="config-container">
      <el-card v-loading="loading" class="rules-card">
        <p class="rule-preview">当前规则：{{ ruleText }}</p>
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
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import {
  fetchCollectionLimit,
  cdnUpsertSingleton,
  cdnUpdate,
  COLLECTIONS
} from '../cloud'
import {
  getDefaultWelcomeGiftConfig,
  normalizeWelcomeGiftConfig,
  describeWelcomeGift,
  applyDefaultExpireDaysToCoupons,
  resolveExpireDays,
  coerceNumber,
  buildWelcomeGiftWritePayload
} from '../utils/welcomeGift'
import { ElMessage } from 'element-plus'

const loading = ref(false)
const saving = ref(false)
const hydrating = ref(false)
const ruleDocId = ref('')
/** 加载时的顶层默认天数；保存时用于同步「未单独改」的券行 */
const loadedExpireDays = ref(30)
const form = reactive(getDefaultWelcomeGiftConfig())
const ruleText = computed(() => describeWelcomeGift(form))

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
    const rows = await fetchCollectionLimit(COLLECTIONS.MEMBER_WELCOME_GIFT, { limit: 10 })
    const active = (rows || [])
      .filter((r) => r.status !== 'inactive')
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    const top = active[0]
    if (top) {
      applyForm(top, top._id)
    } else {
      applyForm(getDefaultWelcomeGiftConfig(), '')
    }
  } catch (error) {
    console.error('加载新会员礼包失败:', error)
    applyForm(getDefaultWelcomeGiftConfig(), '')
    ElMessage.warning('未读到 member_welcome_gift，已使用代码默认值（请确认已创建集合）')
  } finally {
    loading.value = false
  }
}

function buildPayload() {
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
  return buildWelcomeGiftWritePayload(form)
}

async function saveRules() {
  saving.value = true
  try {
    const payload = buildPayload()
    if (!(payload.expireDays >= 1)) {
      throw new Error('有效天数无效，请重新设置后再保存')
    }
    if (ruleDocId.value) {
      await cdnUpdate(COLLECTIONS.MEMBER_WELCOME_GIFT, ruleDocId.value, payload)
    } else {
      await cdnUpsertSingleton(COLLECTIONS.MEMBER_WELCOME_GIFT, {
        ...payload,
        ruleId: payload.ruleId || 'member_welcome_gift_v1',
        _createTime: Date.now(),
        createTime: Date.now()
      })
    }
    ElMessage.success(`已写入 member_welcome_gift（默认 ${payload.expireDays} 天）`)
    await loadRules()
  } catch (error) {
    console.error('保存新会员礼包失败:', error)
    ElMessage.error('保存失败：' + (error.message || '未知错误') + '（请确认已创建集合 member_welcome_gift）')
  } finally {
    saving.value = false
  }
}

function resetDefaults() {
  applyForm(getDefaultWelcomeGiftConfig(), ruleDocId.value)
  ElMessage.info('已恢复默认值，记得点保存')
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
    minSpend: 10,
    expireDays: days,
    count: 1,
    title: '新会员礼券',
    channel: 'online'
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
