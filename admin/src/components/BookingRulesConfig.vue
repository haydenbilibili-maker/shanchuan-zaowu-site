<template>
  <div class="booking-rules-config">
    <div class="header-section">
      <h2>预约规则配置</h2>
      <p class="subtitle">配置预约取消、改期规则和时间段设置</p>
    </div>

    <div class="config-container">
      <!-- 取消规则 -->
      <div class="rules-section">
        <h3>取消规则配置</h3>
        <el-card>
          <el-form :model="cancelRules" label-width="200px">
            <el-form-item label="免费取消时间阈值">
              <el-input-number 
                v-model="cancelRules.freeCancelHours" 
                :min="0"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">小时（提前X小时可免费取消）</span>
            </el-form-item>
            <el-form-item label="取消手续费比例">
              <el-input-number 
                v-model="cancelRules.feeRate" 
                :min="0"
                :max="1"
                :step="0.01"
                :precision="2"
              />
              <span style="margin-left: 10px; color: #999;">（不足免费取消时间时收取的手续费比例）</span>
            </el-form-item>
            <el-form-item label="允许取消时间">
              <el-input-number 
                v-model="cancelRules.minCancelHours" 
                :min="0"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">小时（距离预约时间X小时内不允许取消）</span>
            </el-form-item>
          </el-form>
        </el-card>
      </div>

      <!-- 改期规则 -->
      <div class="rules-section" style="margin-top: 30px;">
        <h3>改期规则配置</h3>
        <el-card>
          <el-form :model="rescheduleRules" label-width="200px">
            <el-form-item label="可改期天数范围">
              <el-input-number 
                v-model="rescheduleRules.maxDays" 
                :min="1"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">天（可改期到未来X天内）</span>
            </el-form-item>
            <el-form-item label="每月改期次数限制">
              <el-input-number 
                v-model="rescheduleRules.monthlyLimit" 
                :min="0"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">次（0表示无限制）</span>
            </el-form-item>
            <el-form-item label="改期手续费">
              <el-input-number 
                v-model="rescheduleRules.fee" 
                :min="0"
                :precision="2"
              />
              <span style="margin-left: 10px; color: #999;">元（每次改期手续费，0表示免费）</span>
            </el-form-item>
            <el-form-item label="允许改期时间">
              <el-input-number 
                v-model="rescheduleRules.minRescheduleHours" 
                :min="0"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">小时（距离预约时间X小时内不允许改期）</span>
            </el-form-item>
          </el-form>
        </el-card>
      </div>

      <!-- 时间段配置 -->
      <div class="rules-section" style="margin-top: 30px;">
        <h3>时间段配置</h3>
        <el-card>
          <div class="action-bar">
            <el-button type="primary" @click="addTimeSlot">
              <el-icon><Plus /></el-icon>新增时间段
            </el-button>
            <el-button type="success" @click="saveTimeSlots" :loading="saving">
              <el-icon><Check /></el-icon>保存时间段配置
            </el-button>
          </div>

          <el-table 
            :data="timeSlots" 
            style="margin-top: 20px;"
            row-key="id"
          >
            <el-table-column label="时间段" width="200">
              <template #default="{ row }">
                <el-time-picker
                  v-model="row.time"
                  format="HH:mm"
                  value-format="HH:mm"
                  placeholder="选择时间"
                  size="small"
                  @change="updateTimeSlot(row)"
                />
              </template>
            </el-table-column>
            <el-table-column label="每日限额" width="150">
              <template #default="{ row }">
                <el-input-number 
                  v-model="row.limit" 
                  :min="1"
                  :precision="0"
                  size="small"
                  @change="updateTimeSlot(row)"
                />
              </template>
            </el-table-column>
            <el-table-column label="是否启用" width="120">
              <template #default="{ row }">
                <el-switch 
                  v-model="row.enabled"
                  active-text="启用"
                  inactive-text="禁用"
                  @change="updateTimeSlot(row)"
                />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button link type="danger" @click="deleteTimeSlot(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </div>

      <!-- 每日限额配置 -->
      <div class="rules-section" style="margin-top: 30px;">
        <h3>每日限额配置</h3>
        <el-card>
          <el-form :model="dailyLimitRules" label-width="200px">
            <el-form-item label="每日总预约数上限">
              <el-input-number 
                v-model="dailyLimitRules.totalLimit" 
                :min="0"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">人（0表示无限制）</span>
            </el-form-item>
            <el-form-item label="每人每日预约上限">
              <el-input-number 
                v-model="dailyLimitRules.perUserLimit" 
                :min="1"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">次</span>
            </el-form-item>
          </el-form>
        </el-card>
      </div>

      <!-- 不可预约日期配置 -->
      <div class="rules-section" style="margin-top: 30px;">
        <h3>不可预约日期配置</h3>
        <el-card>
          <div class="action-bar">
            <el-date-picker
              v-model="newBlockedDate"
              type="date"
              placeholder="选择不可预约日期"
              format="YYYY-MM-DD"
              value-format="YYYY-MM-DD"
            />
            <el-input 
              v-model="newBlockedReason"
              placeholder="原因（可选）"
              style="width: 200px;"
            />
            <el-button type="primary" @click="addBlockedDate">
              <el-icon><Plus /></el-icon>添加
            </el-button>
          </div>

          <el-table 
            :data="blockedDates" 
            style="margin-top: 20px;"
          >
            <el-table-column prop="date" label="日期" width="150" />
            <el-table-column prop="reason" label="原因" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button link type="danger" @click="deleteBlockedDate(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </div>

      <!-- 候补规则配置 -->
      <div class="rules-section" style="margin-top: 30px;">
        <h3>候补规则配置</h3>
        <el-card>
          <el-form :model="waitlistRules" label-width="200px">
            <el-form-item label="候补队列最大长度">
              <el-input-number 
                v-model="waitlistRules.maxLength" 
                :min="1"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">人</span>
            </el-form-item>
            <el-form-item label="自动通知候补">
              <el-switch 
                v-model="waitlistRules.autoNotify"
                active-text="启用"
                inactive-text="禁用"
              />
              <span style="margin-left: 10px; color: #999;">有空位时自动通知候补用户</span>
            </el-form-item>
            <el-form-item label="候补转正时限">
              <el-input-number 
                v-model="waitlistRules.notifyExpireHours" 
                :min="1"
                :precision="0"
              />
              <span style="margin-left: 10px; color: #999;">小时（通知后X小时内需确认，否则取消候补）</span>
            </el-form-item>
          </el-form>
        </el-card>
      </div>

      <!-- 保存按钮 -->
      <div class="save-section" style="margin-top: 40px;">
        <el-button type="primary" size="large" @click="saveAllRules" :loading="saving">
          <el-icon><Check /></el-icon>保存全部配置
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { fetchCollectionLimit, cdnUpsertSingleton, COLLECTIONS } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Check } from '@element-plus/icons-vue'

const saving = ref(false)
const newBlockedDate = ref(null)
const newBlockedReason = ref('')

// 取消规则
const cancelRules = reactive({
  freeCancelHours: 24, // 提前24小时可免费取消
  feeRate: 0.2, // 20%手续费
  minCancelHours: 1 // 距离预约时间1小时内不允许取消
})

// 改期规则
const rescheduleRules = reactive({
  maxDays: 14, // 可改期到未来14天
  monthlyLimit: 3, // 每月最多3次
  fee: 0, // 改期手续费
  minRescheduleHours: 2 // 距离预约时间2小时内不允许改期
})

// 时间段配置
const timeSlots = ref([
  { id: 1, time: '09:00', limit: 20, enabled: true },
  { id: 2, time: '10:30', limit: 20, enabled: true },
  { id: 3, time: '14:00', limit: 20, enabled: true },
  { id: 4, time: '15:30', limit: 20, enabled: true },
  { id: 5, time: '17:00', limit: 20, enabled: true },
  { id: 6, time: '18:30', limit: 20, enabled: true }
])

// 每日限额规则
const dailyLimitRules = reactive({
  totalLimit: 0, // 0表示无限制
  perUserLimit: 1 // 每人每日最多1次
})

// 不可预约日期
const blockedDates = ref([])

// 候补规则
const waitlistRules = reactive({
  maxLength: 50, // 候补队列最大50人
  autoNotify: true, // 自动通知
  notifyExpireHours: 24 // 24小时内需确认
})

// 加载配置
const loadRules = async () => {
  try {
    const rows = await fetchCollectionLimit(COLLECTIONS.BOOKING_RULES, { limit: 1 })
    if (rows.length > 0) {
      const config = rows[0]
      if (config.cancelRules) Object.assign(cancelRules, config.cancelRules)
      if (config.rescheduleRules) Object.assign(rescheduleRules, config.rescheduleRules)
      if (config.timeSlots) timeSlots.value = config.timeSlots
      if (config.dailyLimitRules) Object.assign(dailyLimitRules, config.dailyLimitRules)
      if (config.blockedDates) blockedDates.value = config.blockedDates
      if (config.waitlistRules) Object.assign(waitlistRules, config.waitlistRules)
    }
  } catch (error) {
    console.error('加载预约规则失败:', error)
  }
}

// 更新时间段
const updateTimeSlot = async (slot) => {
  // 实时更新，但不立即保存到数据库
}

// 新增时间段
const addTimeSlot = () => {
  const maxId = timeSlots.value.length > 0 
    ? Math.max(...timeSlots.value.map(s => s.id)) 
    : 0
  
  timeSlots.value.push({
    id: maxId + 1,
    time: '09:00',
    limit: 20,
    enabled: true
  })
}

// 删除时间段
const deleteTimeSlot = (slot) => {
  const index = timeSlots.value.findIndex(s => s.id === slot.id)
  if (index >= 0) {
    timeSlots.value.splice(index, 1)
  }
}

// 保存时间段配置
const saveTimeSlots = async () => {
  await saveAllRules()
}

// 添加不可预约日期
const addBlockedDate = () => {
  if (!newBlockedDate.value) {
    ElMessage.warning('请选择日期')
    return
  }

  if (blockedDates.value.find(d => d.date === newBlockedDate.value)) {
    ElMessage.warning('该日期已存在')
    return
  }

  blockedDates.value.push({
    date: newBlockedDate.value,
    reason: newBlockedReason.value || '闭馆日'
  })

  newBlockedDate.value = null
  newBlockedReason.value = ''
}

// 删除不可预约日期
const deleteBlockedDate = (item) => {
  const index = blockedDates.value.findIndex(d => d.date === item.date)
  if (index >= 0) {
    blockedDates.value.splice(index, 1)
  }
}

// 保存全部配置
const saveAllRules = async () => {
  saving.value = true
  try {
    await cdnUpsertSingleton(COLLECTIONS.BOOKING_RULES, {
      cancelRules: { ...cancelRules },
      rescheduleRules: { ...rescheduleRules },
      timeSlots: [...timeSlots.value],
      dailyLimitRules: { ...dailyLimitRules },
      blockedDates: [...blockedDates.value],
      waitlistRules: { ...waitlistRules },
      _updateTime: Date.now()
    })
    ElMessage.success('预约规则已保存')
  } catch (error) {
    console.error('保存预约规则失败:', error)
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadRules()
})
</script>

<style scoped>
.booking-rules-config {
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

.rules-section h3 {
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

.save-section {
  text-align: center;
  padding: 20px 0;
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
  background: var(--erp-table-head-bg);
  color: var(--erp-table-head-fg);
  border-bottom: 2px solid var(--erp-hairline-gold);
}

:deep(.el-table td) {
  background: #ffffff;
  color: #2c3e50;
  border-bottom: 1px solid rgba(212, 175, 55, 0.1);
}

:deep(.el-date-editor) {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.2);
}
</style>

