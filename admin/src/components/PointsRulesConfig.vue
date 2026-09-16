<template>
  <div class="points-rules-config">
    <div class="header-section">
      <h2>门店积分规则</h2>
      <p class="subtitle">
        线上 SSOT 为集合 <code>store_point_rules</code>（与小程序超管工作台共用 <code>getStorePointRules</code> 云函数）。默认：每满 ¥1 赠 1 分。
        旧集合 <code>points_rules</code> 仅作历史遗留，不再作为线上赠分来源。
      </p>
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        style="margin-top: 12px;"
        title="现场赠分 / 规则保存 / 外部订单绑定审核在小程序「门店积分」与店员工作台；本页用于总部对齐规则与模块开关。"
      />
    </div>

    <div class="config-container">
      <div class="rules-section">
        <h3>消费赠分（store_point_rules）</h3>
        <el-card v-loading="loading">
          <p class="rule-preview">当前规则：{{ ruleText }}</p>
          <el-form :model="storeRules" label-width="180px">
            <el-form-item label="规则名称">
              <el-input v-model="storeRules.name" style="max-width: 360px;" />
            </el-form-item>
            <el-form-item label="赠送方式">
              <el-radio-group v-model="storeRules.mode">
                <el-radio label="perThreshold">每满门槛累加</el-radio>
                <el-radio label="fixed">满门槛只送一次</el-radio>
                <el-radio label="ratio">按比例</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="storeRules.mode !== 'ratio'" label="金额门槛（元）">
              <el-input-number v-model="storeRules.threshold" :min="0.01" :step="1" :precision="2" />
              <span class="hint">默认 1（¥1 = 1 分）</span>
            </el-form-item>
            <el-form-item v-if="storeRules.mode !== 'ratio'" label="每档赠分">
              <el-input-number v-model="storeRules.pointsPerThreshold" :min="0" :precision="0" />
            </el-form-item>
            <template v-if="storeRules.mode === 'ratio'">
              <el-form-item label="最低消费（元）">
                <el-input-number v-model="storeRules.minAmount" :min="0" :precision="2" />
              </el-form-item>
              <el-form-item label="赠分比例">
                <el-input-number v-model="storeRules.ratio" :min="0" :max="10" :step="0.01" :precision="3" />
                <span class="hint">0.1 = 10%</span>
              </el-form-item>
            </template>
            <el-form-item label="取整方式">
              <el-radio-group v-model="storeRules.roundMode">
                <el-radio label="floor">向下取整</el-radio>
                <el-radio label="round">四舍五入</el-radio>
                <el-radio label="ceil">向上取整</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="单用户日上限">
              <el-input-number v-model="storeRules.dailyPointsCapPerUser" :min="0" :precision="0" />
              <span class="hint">分 / 天</span>
            </el-form-item>
            <el-form-item label="兑券说明">
              <span class="hint">小程序侧：100 积分 ≈ ¥10 代金券（见 exchangeCoupon / storePoints）</span>
            </el-form-item>

            <el-divider content-position="left">模块开关</el-divider>
            <el-form-item
              v-for="(label, key) in moduleLabels"
              :key="key"
              :label="label"
            >
              <el-switch v-model="storeRules.modules[key]" active-text="开" inactive-text="关" />
            </el-form-item>

            <el-divider content-position="left">行为奖励额度</el-divider>
            <el-form-item
              v-for="(cfg, key) in storeRules.moduleRewards"
              :key="key"
              :label="moduleLabels[key] || key"
            >
              <el-input-number v-model="cfg.points" :min="0" :precision="0" />
              <span class="hint">分 / 次</span>
              <el-input-number
                v-model="cfg.dailyLimit"
                :min="0"
                :precision="0"
                style="margin-left: 12px;"
              />
              <span class="hint">次 / 天</span>
            </el-form-item>

            <el-divider content-position="left">外部订单绑定</el-divider>
            <el-form-item label="须填写金额">
              <el-switch v-model="storeRules.platformOrderBind.requireAmount" />
            </el-form-item>
            <el-form-item label="须店长确认">
              <el-switch v-model="storeRules.platformOrderBind.requireManagerConfirm" />
            </el-form-item>
            <el-form-item label="支持平台">
              <el-tag
                v-for="p in storeRules.platformOrderBind.platforms"
                :key="p.id"
                style="margin-right: 8px;"
              >{{ p.name }}</el-tag>
              <span class="hint">审核入口在小程序门店积分 / 订单绑定</span>
            </el-form-item>

            <el-form-item>
              <el-button type="primary" :loading="saving" @click="saveStoreRules">保存门店积分规则</el-button>
              <el-button @click="resetStoreRules">重置为 v3 默认</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </div>

      <div class="records-section" style="margin-top: 40px;">
        <h3>积分流水（只读）</h3>
        <div class="action-bar">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            @change="loadRecords"
          />
          <el-select v-model="actionFilter" placeholder="筛选动作类型" style="width: 200px;" @change="loadRecords">
            <el-option label="全部" value="" />
            <el-option label="签到" value="check_in" />
            <el-option label="浏览" value="browse" />
            <el-option label="消费/门店赠分" value="store_purchase" />
            <el-option label="分享" value="share" />
            <el-option label="评价" value="review" />
            <el-option label="订单绑定" value="order_bind" />
          </el-select>
          <el-button @click="loadRecords">
            <el-icon><Refresh /></el-icon>刷新
          </el-button>
        </div>

        <el-table :data="records" v-loading="recordsLoading" style="margin-top: 20px;" max-height="400">
          <template #empty>
            <ErpEmpty description="暂无积分流水" hint="先确认筛选条件；人工调整积分会写入 admin_adjust 流水。" />
          </template>
          <el-table-column prop="userName" label="用户" width="120" />
          <el-table-column prop="action" label="动作类型" width="120">
            <template #default="{ row }">
              <el-tag>{{ getActionName(row.action || row.type || row.source) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="points" label="积分" width="80">
            <template #default="{ row }">
              <span style="color: #d4af37;">{{ formatPoints(row.points ?? row.delta) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="dateStr" label="日期" width="120" />
          <el-table-column prop="createTime" label="时间" width="180">
            <template #default="{ row }">
              {{ formatTime(row.createTime || row._createTime) }}
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-collapse style="margin-top: 32px;">
        <el-collapse-item title="旧 points_rules（遗留，勿当作线上源）" name="legacy">
          <el-alert
            type="error"
            :closable="false"
            show-icon
            title="此集合不被 earnPoints / grantStorePoints 读取。仅保留只读对照；请勿再依赖「元=1积分」口径。"
            style="margin-bottom: 16px;"
          />
          <pre class="legacy-pre">{{ legacyPreview }}</pre>
        </el-collapse-item>
      </el-collapse>
    </div>
  </div>
</template>

<script setup>
import ErpEmpty from './ErpEmpty.vue'
import { ref, reactive, computed, onMounted } from 'vue'
import {
  fetchCollectionLimit,
  fetchCollectionWhere,
  getCdnDatabase,
  callCloudFunction,
  COLLECTIONS
} from '../cloud'
import {
  getDefaultStorePointConfig,
  normalizeStorePointConfig,
  describeStorePointRule,
  MODULE_LABELS
} from '../utils/storePointRules'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'

const loading = ref(false)
const saving = ref(false)
const recordsLoading = ref(false)
const records = ref([])
const dateRange = ref(null)
const actionFilter = ref('')
const ruleDocId = ref('')
const moduleLabels = MODULE_LABELS

const storeRules = reactive(getDefaultStorePointConfig())
const legacyRules = ref(null)

const ruleText = computed(() => describeStorePointRule(storeRules))
const legacyPreview = computed(() =>
  legacyRules.value
    ? JSON.stringify(legacyRules.value, null, 2)
    : '（云库无 points_rules 文档）'
)

const getActionName = (action) => {
  const map = {
    check_in: '签到',
    browse: '浏览',
    consumption: '消费',
    store_purchase: '门店赠分',
    share: '分享',
    review: '评价',
    order_bind: '订单绑定',
    orderBind: '订单绑定'
  }
  return map[action] || action || '—'
}

const formatTime = (time) => {
  if (!time) return ''
  const date = time instanceof Date ? time : new Date(time)
  return date.toLocaleString('zh-CN')
}

const formatPoints = (n) => {
  const v = Number(n) || 0
  return v >= 0 ? `+${v}` : String(v)
}

const applyStoreConfig = (raw, docId = '') => {
  const normalized = normalizeStorePointConfig(raw || {})
  Object.keys(storeRules).forEach((k) => delete storeRules[k])
  Object.assign(storeRules, normalized)
  ruleDocId.value = docId || ''
}

/**
 * 读规则：优先走云函数（与小程序超管工作台同一 SSOT、同一取文档逻辑），
 * 云函数不可用（如当前账号非超管）再退回 CDN 直读。
 */
const loadStoreRules = async () => {
  loading.value = true
  try {
    const res = await callCloudFunction('getStorePointRules', { action: 'get' })
    if (res && res.success && res.config) {
      applyStoreConfig(res.config, res.ruleDocId || '')
      return
    }
    throw new Error((res && res.msg) || '云函数未返回规则')
  } catch (error) {
    console.warn('云函数读取积分规则失败，退回 CDN 直读:', error?.message || error)
    try {
      const rows = await fetchCollectionLimit(COLLECTIONS.STORE_POINT_RULES, { limit: 20 })
      const active = (rows || [])
        .filter((r) => r.status !== 'inactive')
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      const global = active.find((r) => !Array.isArray(r.storeIds) || !r.storeIds.length) || active[0]
      if (global) {
        applyStoreConfig(global, global._id)
      } else {
        applyStoreConfig(getDefaultStorePointConfig(), '')
      }
    } catch (cdnError) {
      console.error('加载门店积分规则失败:', cdnError)
      applyStoreConfig(getDefaultStorePointConfig(), '')
      ElMessage.warning('未读到 store_point_rules，已使用 v4 默认（每满 ¥1 赠 1 分）')
    }
  } finally {
    loading.value = false
  }
}

const loadLegacyRules = async () => {
  try {
    const rows = await fetchCollectionLimit(COLLECTIONS.POINTS_RULES, { limit: 1 })
    legacyRules.value = rows[0] || null
  } catch (e) {
    legacyRules.value = null
  }
}

/**
 * 写规则：必须经云函数。store_point_rules 的安全规则是 write:false，
 * 早前用 CDN 直写会被静默丢弃（页面提示「已写入」但数据未变，ERP 看起来一直是老数据）。
 * 云函数同时承载字段白名单、店长改规则的审批队列与校验。
 */
const saveStoreRules = async () => {
  saving.value = true
  try {
    const normalized = normalizeStorePointConfig(storeRules)
    const { modules, moduleRewards, platformOrderBind, ...rest } = normalized
    const payload = {
      ...rest,
      modules: { ...modules },
      moduleRewards: JSON.parse(JSON.stringify(moduleRewards)),
      platformOrderBind: {
        ...platformOrderBind,
        platforms: (platformOrderBind.platforms || []).slice()
      },
      status: 'active',
      applyMemberMultiplier: false
    }
    const res = await callCloudFunction('getStorePointRules', {
      action: 'save',
      ruleDocId: ruleDocId.value || '',
      config: payload
    })
    if (!res || res.success === false) {
      throw new Error((res && res.msg) || '云函数保存失败')
    }
    if (res.pendingApproval) {
      ElMessage.warning(res.msg || '已提交超管审核，通过后规则生效')
    } else {
      ElMessage.success('规则已保存到 store_point_rules')
    }
    await loadStoreRules()
  } catch (error) {
    console.error('保存门店积分规则失败:', error)
    ElMessage.error('保存失败：' + (error.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

const resetStoreRules = () => {
  applyStoreConfig(getDefaultStorePointConfig(), ruleDocId.value)
  ElMessage.info('已重置为 v4 默认（每满 ¥1 赠 1 分，含门店小票兑积分）')
}

const loadRecords = async () => {
  recordsLoading.value = true
  try {
    const cdnDb = await getCdnDatabase()
    const _ = cdnDb.command
    const where = {}

    if (dateRange.value && dateRange.value.length === 2) {
      const start = new Date(dateRange.value[0])
      start.setHours(0, 0, 0, 0)
      const end = new Date(dateRange.value[1])
      end.setHours(23, 59, 59, 999)
      where.createTime = _.gte(start).and(_.lte(end))
    }
    if (actionFilter.value) {
      where.action = actionFilter.value
    }

    let rows = Object.keys(where).length
      ? await fetchCollectionWhere('point_records', where, 200)
      : await fetchCollectionLimit('point_records', { limit: 200 })

    rows = rows
      .sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
      .slice(0, 100)

    const userIds = [...new Set(rows.map((r) => r._openid).filter(Boolean))]
    let users = []
    if (userIds.length && _) {
      users = await fetchCollectionWhere(COLLECTIONS.USERS, { _openid: _.in(userIds) }, userIds.length)
    }

    const userMap = {}
    users.forEach((u) => {
      userMap[u._openid] = u.nickName || u.name || '未知用户'
    })

    records.value = rows.map((r) => ({
      ...r,
      userName: userMap[r._openid] || '未知用户'
    }))
  } catch (error) {
    console.error('加载积分流水失败:', error)
    records.value = []
    ElMessage.error('加载失败')
  } finally {
    recordsLoading.value = false
  }
}

onMounted(() => {
  loadStoreRules()
  loadLegacyRules()
  loadRecords()
})
</script>

<style scoped>
.points-rules-config {
  padding: 24px;
  background: linear-gradient(135deg, #fafbfc 0%, #f0f2f5 100%);
  min-height: calc(100vh - 120px);
  color: #2c3e50;
}

.header-section {
  margin-bottom: 30px;
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
  background: #f5f0e6;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}

.config-container {
  background: #ffffff;
  border-radius: 12px;
  padding: 24px;
  border: 1px solid rgba(212, 175, 55, 0.2);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

.rules-section h3,
.records-section h3 {
  color: #d4af37;
  margin-bottom: 20px;
  font-size: 18px;
}

.rule-preview {
  margin: 0 0 16px;
  color: #8a7530;
  font-weight: 500;
}

.hint {
  margin-left: 10px;
  color: #999;
  font-size: 13px;
}

.action-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  align-items: center;
  flex-wrap: wrap;
}

.legacy-pre {
  background: #f8f6f2;
  border: 1px solid #e8e5de;
  border-radius: 8px;
  padding: 12px;
  font-size: 12px;
  max-height: 280px;
  overflow: auto;
  color: #4a4540;
}

:deep(.el-card) {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.2);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

:deep(.el-form-item__label) {
  color: #2c3e50;
}

:deep(.el-divider__text) {
  background: #ffffff;
  color: var(--gold-700);
}
</style>
