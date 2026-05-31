<template>
  <div class="points-rules-config">
    <div class="header-section">
      <h2>积分规则配置</h2>
      <p class="subtitle">配置积分获取规则、上限和有效期设置</p>
    </div>

    <div class="config-container">
      <!-- 积分获取规则 -->
      <div class="rules-section">
        <h3>积分获取规则</h3>
        <el-card>
          <el-form :model="pointsRules" label-width="180px">
            <!-- 签到规则 -->
            <el-divider content-position="left">签到奖励</el-divider>
            <el-form-item label="每日签到积分">
              <el-input-number 
                v-model="pointsRules.checkIn.points" 
                :min="0"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">分</span>
            </el-form-item>
            <el-form-item label="每日签到上限">
              <el-input-number 
                v-model="pointsRules.checkIn.dailyLimit" 
                :min="1"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">次/天</span>
            </el-form-item>
            <el-form-item label="连续签到奖励">
              <el-input-number 
                v-model="pointsRules.checkIn.continuousBonus" 
                :min="0"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">连续签到额外奖励积分</span>
            </el-form-item>

            <!-- 浏览规则 -->
            <el-divider content-position="left">浏览奖励</el-divider>
            <el-form-item label="每次浏览积分">
              <el-input-number 
                v-model="pointsRules.browse.points" 
                :min="0"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">分</span>
            </el-form-item>
            <el-form-item label="每日浏览上限">
              <el-input-number 
                v-model="pointsRules.browse.dailyLimit" 
                :min="1"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">次/天</span>
            </el-form-item>
            <el-form-item label="同商品重复浏览">
              <el-switch 
                v-model="pointsRules.browse.allowDuplicate"
                active-text="允许"
                inactive-text="不允许"
              />
              <span style="margin-left: 10px; color: #999;">同一商品是否可重复获得积分</span>
            </el-form-item>

            <!-- 消费规则 -->
            <el-divider content-position="left">消费奖励</el-divider>
            <el-form-item label="消费金额比例">
              <el-input-number 
                v-model="pointsRules.consumption.rate" 
                :min="0"
                :step="0.1"
                :precision="2"
              />
              <span style="margin-left: 10px; color: #999;">元 = 1 积分</span>
            </el-form-item>
            <el-form-item label="消费积分上限">
              <el-input-number 
                v-model="pointsRules.consumption.dailyLimit" 
                :min="0"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">分/天（0表示无上限）</span>
            </el-form-item>

            <!-- 分享规则 -->
            <el-divider content-position="left">分享奖励</el-divider>
            <el-form-item label="每次分享积分">
              <el-input-number 
                v-model="pointsRules.share.points" 
                :min="0"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">分</span>
            </el-form-item>
            <el-form-item label="每日分享上限">
              <el-input-number 
                v-model="pointsRules.share.dailyLimit" 
                :min="1"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">次/天</span>
            </el-form-item>

            <!-- 评价规则 -->
            <el-divider content-position="left">评价奖励</el-divider>
            <el-form-item label="每次评价积分">
              <el-input-number 
                v-model="pointsRules.review.points" 
                :min="0"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">分</span>
            </el-form-item>
            <el-form-item label="每日评价上限">
              <el-input-number 
                v-model="pointsRules.review.dailyLimit" 
                :min="1"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">次/天</span>
            </el-form-item>

            <!-- 积分有效期 -->
            <el-divider content-position="left">积分有效期</el-divider>
            <el-form-item label="积分有效期">
              <el-radio-group v-model="pointsRules.expiry.type">
                <el-radio label="never">永久有效</el-radio>
                <el-radio label="days">按天数</el-radio>
                <el-radio label="year">按年度</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="有效期天数" v-if="pointsRules.expiry.type === 'days'">
              <el-input-number 
                v-model="pointsRules.expiry.days" 
                :min="1"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">天</span>
            </el-form-item>

            <!-- 特殊活动倍率 -->
            <el-divider content-position="left">特殊活动</el-divider>
            <el-form-item label="活动积分倍率">
              <el-input-number 
                v-model="pointsRules.activity.multiplier" 
                :min="1"
                :step="0.1"
                :precision="1"
              />
              <span style="margin-left: 10px; color: #999;">倍（活动期间积分倍率）</span>
            </el-form-item>
            <el-form-item label="活动开始时间" v-if="pointsRules.activity.enabled">
              <el-date-picker
                v-model="pointsRules.activity.startTime"
                type="datetime"
                placeholder="选择开始时间"
                format="YYYY-MM-DD HH:mm:ss"
                value-format="YYYY-MM-DD HH:mm:ss"
              />
            </el-form-item>
            <el-form-item label="活动结束时间" v-if="pointsRules.activity.enabled">
              <el-date-picker
                v-model="pointsRules.activity.endTime"
                type="datetime"
                placeholder="选择结束时间"
                format="YYYY-MM-DD HH:mm:ss"
                value-format="YYYY-MM-DD HH:mm:ss"
              />
            </el-form-item>
            <el-form-item label="启用活动倍率">
              <el-switch 
                v-model="pointsRules.activity.enabled"
                active-text="启用"
                inactive-text="禁用"
              />
            </el-form-item>

            <el-form-item>
              <el-button type="primary" @click="saveRules" :loading="saving">
                保存积分规则
              </el-button>
              <el-button @click="resetRules">重置为默认值</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </div>

      <!-- 积分流水记录 -->
      <div class="records-section" style="margin-top: 40px;">
        <h3>积分流水记录</h3>
        <div class="action-bar">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            @change="loadRecords"
          />
          <el-select v-model="actionFilter" placeholder="筛选动作类型" @change="loadRecords" style="width: 200px;">
            <el-option label="全部" value="" />
            <el-option label="签到" value="check_in" />
            <el-option label="浏览" value="browse" />
            <el-option label="消费" value="consumption" />
            <el-option label="分享" value="share" />
            <el-option label="评价" value="review" />
          </el-select>
          <el-button @click="loadRecords">
            <el-icon><Refresh /></el-icon>刷新
          </el-button>
        </div>

        <el-table 
          :data="records" 
          v-loading="recordsLoading"
          style="margin-top: 20px;"
          max-height="400"
        >
          <el-table-column prop="userName" label="用户" width="120" />
          <el-table-column prop="action" label="动作类型" width="100">
            <template #default="{ row }">
              <el-tag>{{ getActionName(row.action) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="points" label="积分" width="80">
            <template #default="{ row }">
              <span style="color: #d4af37;">+{{ row.points }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="dateStr" label="日期" width="120" />
          <el-table-column prop="createTime" label="时间" width="180">
            <template #default="{ row }">
              {{ formatTime(row.createTime) }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { fetchCollectionLimit, fetchCollectionWhere, cdnUpsertSingleton, getCdnDatabase, COLLECTIONS } from '../cloud'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'

const saving = ref(false)
const recordsLoading = ref(false)
const records = ref([])
const dateRange = ref(null)
const actionFilter = ref('')

// 积分规则配置
const pointsRules = reactive({
  checkIn: {
    points: 5,
    dailyLimit: 1,
    continuousBonus: 10
  },
  browse: {
    points: 1,
    dailyLimit: 5,
    allowDuplicate: false
  },
  consumption: {
    rate: 1, // 1元 = 1积分
    dailyLimit: 0 // 0表示无上限
  },
  share: {
    points: 2,
    dailyLimit: 10
  },
  review: {
    points: 3,
    dailyLimit: 5
  },
  expiry: {
    type: 'never', // never | days | year
    days: 365
  },
  activity: {
    enabled: false,
    multiplier: 2,
    startTime: null,
    endTime: null
  }
})

// 获取动作名称
const getActionName = (action) => {
  const map = {
    check_in: '签到',
    browse: '浏览',
    consumption: '消费',
    share: '分享',
    review: '评价'
  }
  return map[action] || action
}

// 格式化时间
const formatTime = (time) => {
  if (!time) return ''
  const date = time instanceof Date ? time : new Date(time)
  return date.toLocaleString('zh-CN')
}

// 加载积分规则
const loadRules = async () => {
  try {
    const rows = await fetchCollectionLimit(COLLECTIONS.POINTS_RULES, { limit: 1 })
    if (rows.length > 0) {
      Object.assign(pointsRules, rows[0].rules || pointsRules)
    }
  } catch (error) {
    console.error('加载积分规则失败:', error)
  }
}

// 保存积分规则
const saveRules = async () => {
  saving.value = true
  try {
    await cdnUpsertSingleton(COLLECTIONS.POINTS_RULES, {
      rules: { ...pointsRules },
      _updateTime: Date.now()
    })
    ElMessage.success('积分规则已保存')
  } catch (error) {
    console.error('保存积分规则失败:', error)
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

// 重置规则
const resetRules = () => {
  Object.assign(pointsRules, {
    checkIn: { points: 5, dailyLimit: 1, continuousBonus: 10 },
    browse: { points: 1, dailyLimit: 5, allowDuplicate: false },
    consumption: { rate: 1, dailyLimit: 0 },
    share: { points: 2, dailyLimit: 10 },
    review: { points: 3, dailyLimit: 5 },
    expiry: { type: 'never', days: 365 },
    activity: { enabled: false, multiplier: 2, startTime: null, endTime: null }
  })
  ElMessage.info('已重置为默认值')
}

// 加载积分流水记录
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

    const userIds = [...new Set(rows.map(r => r._openid).filter(Boolean))]
    let users = []
    if (userIds.length && _) {
      users = await fetchCollectionWhere(COLLECTIONS.USERS, { _openid: _.in(userIds) }, userIds.length)
    }

    const userMap = {}
    users.forEach(u => {
      userMap[u._openid] = u.nickName || u.name || '未知用户'
    })

    records.value = rows.map(r => ({
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
  loadRules()
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

.action-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  align-items: center;
}

:deep(.el-card) {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.2);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

:deep(.el-card__body) {
  color: #2c3e50;
}

:deep(.el-form-item__label) {
  color: #2c3e50;
}

:deep(.el-input__wrapper) {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.2);
}

:deep(.el-input__inner) {
  color: #2c3e50;
}

:deep(.el-table) {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.2);
}

:deep(.el-table th) {
  background: #f5f7fa;
  color: #d4af37;
  border-bottom: 2px solid rgba(212, 175, 55, 0.2);
}

:deep(.el-table td) {
  background: #ffffff;
  color: #2c3e50;
  border-bottom: 1px solid rgba(212, 175, 55, 0.1);
}

:deep(.el-divider__text) {
  background: #ffffff;
  color: #d4af37;
}

:deep(.el-date-editor) {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.2);
}

:deep(.el-select) {
  background: #ffffff;
}
</style>

