<template>
  <div class="marketing-rules-config">
    <div class="header-section">
      <h2>活动营销规则配置</h2>
      <p class="subtitle">配置秒杀、拼团和优惠券的全局规则</p>
    </div>

    <el-tabs v-model="activeTab" type="card" class="config-tabs">
      <!-- 秒杀规则 -->
      <el-tab-pane label="⚡ 秒杀规则" name="seckill">
        <el-card class="config-card">
          <template #header>
            <div class="card-header">
              <span>秒杀活动全局规则</span>
              <el-button type="primary" @click="saveSeckillRules" :loading="saving">
                <el-icon><Check /></el-icon>保存配置
              </el-button>
            </div>
          </template>

          <el-form :model="seckillRules" label-width="200px">
            <el-form-item label="默认限购数量">
              <el-input-number 
                v-model="seckillRules.defaultLimitPerUser" 
                :min="1" 
                :max="10"
              />
              <span style="margin-left: 10px; color: #5a6c7d;">件/人（商品可单独配置）</span>
            </el-form-item>

            <el-form-item label="库存释放规则">
              <el-radio-group v-model="seckillRules.stockReleaseRule">
                <el-radio label="immediate">立即释放（订单取消后立即释放库存）</el-radio>
                <el-radio label="delay">延迟释放（订单取消后30分钟释放库存）</el-radio>
                <el-radio label="manual">手动释放（需要管理员手动释放库存）</el-radio>
              </el-radio-group>
            </el-form-item>

            <el-form-item v-if="seckillRules.stockReleaseRule === 'delay'" label="释放延迟时间">
              <el-input-number 
                v-model="seckillRules.stockReleaseDelay" 
                :min="5" 
                :max="120"
              />
              <span style="margin-left: 10px; color: #5a6c7d;">分钟</span>
            </el-form-item>

            <el-form-item label="防刷机制">
              <el-checkbox-group v-model="seckillRules.antiBrushMeasures">
                <el-checkbox label="ipLimit">IP限制（同一IP限购数量）</el-checkbox>
                <el-checkbox label="deviceLimit">设备限制（同一设备限购数量）</el-checkbox>
                <el-checkbox label="accountLimit">账号限制（同一账号限购数量）</el-checkbox>
              </el-checkbox-group>
            </el-form-item>

            <el-form-item v-if="seckillRules.antiBrushMeasures.includes('ipLimit')" label="IP限购数量">
              <el-input-number 
                v-model="seckillRules.ipLimit" 
                :min="1" 
                :max="10"
              />
              <span style="margin-left: 10px; color: #5a6c7d;">件/IP</span>
            </el-form-item>

            <el-form-item label="超时未支付处理">
              <el-radio-group v-model="seckillRules.unpaidAction">
                <el-radio label="cancel">自动取消订单并释放库存</el-radio>
                <el-radio label="hold">保留订单，手动处理</el-radio>
              </el-radio-group>
            </el-form-item>

            <el-form-item v-if="seckillRules.unpaidAction === 'cancel'" label="支付超时时间">
              <el-input-number 
                v-model="seckillRules.paymentTimeout" 
                :min="5" 
                :max="60"
              />
              <span style="margin-left: 10px; color: #5a6c7d;">分钟</span>
            </el-form-item>

            <el-form-item label="秒杀提醒">
              <el-switch v-model="seckillRules.enableReminder" />
              <span style="margin-left: 10px; color: #5a6c7d;">开始前提醒用户</span>
            </el-form-item>

            <el-form-item v-if="seckillRules.enableReminder" label="提醒时间">
              <el-checkbox-group v-model="seckillRules.reminderTimes">
                <el-checkbox label="1h">开始前1小时</el-checkbox>
                <el-checkbox label="30m">开始前30分钟</el-checkbox>
                <el-checkbox label="10m">开始前10分钟</el-checkbox>
                <el-checkbox label="5m">开始前5分钟</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- 拼团规则 -->
      <el-tab-pane label="👥 拼团规则" name="group">
        <el-card class="config-card">
          <template #header>
            <div class="card-header">
              <span>拼团活动全局规则</span>
              <el-button type="primary" @click="saveGroupBuyRules" :loading="saving">
                <el-icon><Check /></el-icon>保存配置
              </el-button>
            </div>
          </template>

          <el-form :model="groupBuyRules" label-width="200px">
            <el-form-item label="默认成团人数">
              <el-input-number 
                v-model="groupBuyRules.defaultGroupSize" 
                :min="2" 
                :max="10"
              />
              <span style="margin-left: 10px; color: #5a6c7d;">人（商品可单独配置）</span>
            </el-form-item>

            <el-form-item label="拼团有效期">
              <el-input-number 
                v-model="groupBuyRules.defaultExpireHours" 
                :min="1" 
                :max="168"
              />
              <span style="margin-left: 10px; color: #5a6c7d;">小时（默认24小时）</span>
            </el-form-item>

            <el-form-item label="成团后处理">
              <el-radio-group v-model="groupBuyRules.successAction">
                <el-radio label="autoOrder">自动创建订单</el-radio>
                <el-radio label="notify">仅通知用户支付</el-radio>
              </el-radio-group>
            </el-form-item>

            <el-form-item label="拼团失败处理">
              <el-radio-group v-model="groupBuyRules.failedAction">
                <el-radio label="autoRefund">自动退款</el-radio>
                <el-radio label="manualRefund">手动退款</el-radio>
                <el-radio label="convert">转换为普通订单（按原价）</el-radio>
              </el-radio-group>
            </el-form-item>

            <el-form-item v-if="groupBuyRules.failedAction === 'autoRefund'" label="退款到账时间">
              <el-input-number 
                v-model="groupBuyRules.refundDays" 
                :min="1" 
                :max="30"
              />
              <span style="margin-left: 10px; color: #5a6c7d;">个工作日</span>
            </el-form-item>

            <el-form-item label="成团提醒">
              <el-switch v-model="groupBuyRules.enableSuccessReminder" />
              <span style="margin-left: 10px; color: #5a6c7d;">成团时提醒所有成员</span>
            </el-form-item>

            <el-form-item label="失败提醒">
              <el-switch v-model="groupBuyRules.enableFailedReminder" />
              <span style="margin-left: 10px; color: #5a6c7d;">拼团失败时提醒用户</span>
            </el-form-item>

            <el-form-item label="拼团进度提醒">
              <el-switch v-model="groupBuyRules.enableProgressReminder" />
              <span style="margin-left: 10px; color: #5a6c7d;">还差X人成团时提醒</span>
            </el-form-item>

            <el-form-item v-if="groupBuyRules.enableProgressReminder" label="提醒阈值">
              <el-input-number 
                v-model="groupBuyRules.progressReminderThreshold" 
                :min="1" 
                :max="5"
              />
              <span style="margin-left: 10px; color: #5a6c7d;">还差N人时提醒</span>
            </el-form-item>

            <el-form-item label="允许重复参团">
              <el-switch v-model="groupBuyRules.allowRejoin" />
              <span style="margin-left: 10px; color: #5a6c7d;">同一用户可参加多个拼团</span>
            </el-form-item>

            <el-form-item label="限购规则">
              <el-radio-group v-model="groupBuyRules.limitRule">
                <el-radio label="none">不限购</el-radio>
                <el-radio label="perGroup">每团限购1件</el-radio>
                <el-radio label="perUser">每用户限购1件</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- 优惠券规则 -->
      <el-tab-pane label="🎫 优惠券规则" name="coupon">
        <el-card class="config-card">
          <template #header>
            <div class="card-header">
              <span>优惠券发放规则</span>
              <el-button type="primary" @click="saveCouponRules" :loading="saving">
                <el-icon><Check /></el-icon>保存配置
              </el-button>
            </div>
          </template>

          <el-form :model="couponRules" label-width="200px">
            <el-form-item label="每日发放上限">
              <el-input-number 
                v-model="couponRules.dailyIssueLimit" 
                :min="0"
              />
              <span style="margin-left: 10px; color: #5a6c7d;">张（0表示不限制）</span>
            </el-form-item>

            <el-form-item label="用户每日领取上限">
              <el-input-number 
                v-model="couponRules.userDailyLimit" 
                :min="1" 
                :max="10"
              />
              <span style="margin-left: 10px; color: #5a6c7d;">张/人/天</span>
            </el-form-item>

            <el-form-item label="用户总领取上限">
              <el-input-number 
                v-model="couponRules.userTotalLimit" 
                :min="0"
              />
              <span style="margin-left: 10px; color: #5a6c7d;">张/人（0表示不限制）</span>
            </el-form-item>

            <el-form-item label="优惠券有效期">
              <el-radio-group v-model="couponRules.validityType">
                <el-radio label="fixed">固定时间（发放时指定）</el-radio>
                <el-radio label="relative">相对时间（领取后N天有效）</el-radio>
              </el-radio-group>
            </el-form-item>

            <el-form-item v-if="couponRules.validityType === 'relative'" label="默认有效期">
              <el-input-number 
                v-model="couponRules.defaultValidityDays" 
                :min="1" 
                :max="365"
              />
              <span style="margin-left: 10px; color: #5a6c7d;">天</span>
            </el-form-item>

            <el-form-item label="过期提醒">
              <el-switch v-model="couponRules.enableExpireReminder" />
              <span style="margin-left: 10px; color: #5a6c7d;">过期前提醒用户</span>
            </el-form-item>

            <el-form-item v-if="couponRules.enableExpireReminder" label="提醒时间">
              <el-checkbox-group v-model="couponRules.expireReminderTimes">
                <el-checkbox label="7d">过期前7天</el-checkbox>
                <el-checkbox label="3d">过期前3天</el-checkbox>
                <el-checkbox label="1d">过期前1天</el-checkbox>
                <el-checkbox label="1h">过期前1小时</el-checkbox>
              </el-checkbox-group>
            </el-form-item>

            <el-form-item label="新用户专享券">
              <el-switch v-model="couponRules.enableNewUserCoupon" />
              <span style="margin-left: 10px; color: #5a6c7d;">自动发放新用户优惠券</span>
            </el-form-item>

            <el-form-item v-if="couponRules.enableNewUserCoupon" label="新用户券金额">
              <el-input-number 
                v-model="couponRules.newUserCouponAmount" 
                :min="0" 
                :precision="2"
              />
              <span style="margin-left: 10px; color: #5a6c7d;">元</span>
            </el-form-item>

            <el-form-item label="分享领取">
              <el-switch v-model="couponRules.enableShareReward" />
              <span style="margin-left: 10px; color: #5a6c7d;">分享后好友领取，分享者获得奖励</span>
            </el-form-item>

            <el-form-item v-if="couponRules.enableShareReward" label="分享者奖励">
              <el-input-number 
                v-model="couponRules.shareRewardAmount" 
                :min="0" 
                :precision="2"
              />
              <span style="margin-left: 10px; color: #5a6c7d;">元优惠券</span>
            </el-form-item>

            <el-form-item label="使用限制">
              <el-checkbox-group v-model="couponRules.usageRestrictions">
                <el-checkbox label="minAmount">最低消费金额限制</el-checkbox>
                <el-checkbox label="categoryLimit">分类限制</el-checkbox>
                <el-checkbox label="productLimit">商品限制</el-checkbox>
                <el-checkbox label="firstOrder">仅首次订单可用</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { cdnDocGet, cdnUpsertDoc } from '../cloud'
import { ElMessage } from 'element-plus'
import { Check } from '@element-plus/icons-vue'

// --- 状态定义 ---
const activeTab = ref('seckill')
const saving = ref(false)

// 秒杀规则
const seckillRules = reactive({
  defaultLimitPerUser: 1,
  stockReleaseRule: 'immediate',
  stockReleaseDelay: 30,
  antiBrushMeasures: ['accountLimit'],
  ipLimit: 2,
  unpaidAction: 'cancel',
  paymentTimeout: 15,
  enableReminder: true,
  reminderTimes: ['1h', '10m']
})

// 拼团规则
const groupBuyRules = reactive({
  defaultGroupSize: 2,
  defaultExpireHours: 24,
  successAction: 'autoOrder',
  failedAction: 'autoRefund',
  refundDays: 3,
  enableSuccessReminder: true,
  enableFailedReminder: true,
  enableProgressReminder: true,
  progressReminderThreshold: 1,
  allowRejoin: false,
  limitRule: 'perGroup'
})

// 优惠券规则
const couponRules = reactive({
  dailyIssueLimit: 0,
  userDailyLimit: 3,
  userTotalLimit: 0,
  validityType: 'relative',
  defaultValidityDays: 7,
  enableExpireReminder: true,
  expireReminderTimes: ['3d', '1d'],
  enableNewUserCoupon: true,
  newUserCouponAmount: 10,
  enableShareReward: false,
  shareRewardAmount: 5,
  usageRestrictions: []
})

// --- 数据加载和保存 ---
const loadSeckillRules = async () => {
  try {
    const doc = await cdnDocGet('marketing_rules_config', 'seckill')
    if (doc) Object.assign(seckillRules, doc)
  } catch (err) {
    console.error('加载秒杀规则失败', err)
  }
}

const loadGroupBuyRules = async () => {
  try {
    const doc = await cdnDocGet('marketing_rules_config', 'group_buy')
    if (doc) Object.assign(groupBuyRules, doc)
  } catch (err) {
    console.error('加载拼团规则失败', err)
  }
}

const loadCouponRules = async () => {
  try {
    const doc = await cdnDocGet('marketing_rules_config', 'coupon')
    if (doc) Object.assign(couponRules, doc)
  } catch (err) {
    console.error('加载优惠券规则失败', err)
  }
}

const saveSeckillRules = async () => {
  saving.value = true
  try {
    await cdnUpsertDoc('marketing_rules_config', 'seckill', {
      ...seckillRules,
      _updateTime: new Date()
    })
    ElMessage.success('秒杀规则保存成功')
  } catch (err) {
    console.error('保存秒杀规则失败', err)
    ElMessage.error('保存秒杀规则失败')
  } finally {
    saving.value = false
  }
}

const saveGroupBuyRules = async () => {
  saving.value = true
  try {
    await cdnUpsertDoc('marketing_rules_config', 'group_buy', {
      ...groupBuyRules,
      _updateTime: new Date()
    })
    ElMessage.success('拼团规则保存成功')
  } catch (err) {
    console.error('保存拼团规则失败', err)
    ElMessage.error('保存拼团规则失败')
  } finally {
    saving.value = false
  }
}

const saveCouponRules = async () => {
  saving.value = true
  try {
    await cdnUpsertDoc('marketing_rules_config', 'coupon', {
      ...couponRules,
      _updateTime: new Date()
    })
    ElMessage.success('优惠券规则保存成功')
  } catch (err) {
    console.error('保存优惠券规则失败', err)
    ElMessage.error('保存优惠券规则失败')
  } finally {
    saving.value = false
  }
}

// --- 生命周期 ---
onMounted(() => {
  loadSeckillRules()
  loadGroupBuyRules()
  loadCouponRules()
})
</script>

<style scoped>
.marketing-rules-config {
  padding: 24px;
  background: linear-gradient(135deg, #fafbfc 0%, #f0f2f5 100%);
  min-height: calc(100vh - 120px);
  color: #2c3e50;
}

.header-section {
  margin-bottom: 30px;
}

.header-section h2 {
  background: linear-gradient(135deg, #9d7a0a 0%, #d4af37 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0 0 8px 0;
  font-size: 24px;
  font-weight: 800;
}

.subtitle {
  color: #5a6c7d;
  margin: 0;
  font-size: 14px;
}

.config-tabs {
  background: #ffffff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

.config-card {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.2);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

:deep(.el-card__header) {
  background: linear-gradient(135deg, #fafbfc 0%, #ffffff 100%);
  border-bottom: 2px solid rgba(212, 175, 55, 0.15);
  font-weight: 700;
  color: #2c3e50;
}

:deep(.el-form-item__label) {
  color: #2c3e50;
  font-weight: 500;
}

:deep(.el-input__wrapper) {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.2);
}

:deep(.el-input__inner) {
  color: #2c3e50;
}
</style>


