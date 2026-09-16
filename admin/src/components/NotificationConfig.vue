<template>
  <div class="notification-config">
    <div class="header-section">
      <h2>通知消息配置</h2>
      <p class="subtitle">配置消息模板和发送规则</p>
    </div>

    <el-tabs v-model="activeTab" type="card" class="config-tabs">
      <!-- 消息模板 -->
      <el-tab-pane label="📧 消息模板" name="templates">
        <div class="templates-section">
          <div class="action-bar">
            <el-button type="primary" @click="addTemplate">
              <el-icon><Plus /></el-icon>新增模板
            </el-button>
            <el-button @click="loadTemplates">
              <el-icon><Refresh /></el-icon>刷新
            </el-button>
          </div>

          <!-- 筛选器 -->
          <div class="filter-bar" style="margin-top: 20px;">
            <el-select
              v-model="filterCategory"
              placeholder="筛选分类"
              clearable
              style="width: 200px;"
              @change="filterTemplates"
            >
              <el-option label="全部" value="" />
              <el-option label="预约相关" value="booking" />
              <el-option label="订单相关" value="order" />
              <el-option label="活动相关" value="activity" />
              <el-option label="系统通知" value="system" />
              <el-option label="其他" value="other" />
            </el-select>
          </div>

          <el-table :data="filteredTemplates" v-loading="loading" style="margin-top: 20px;" row-key="_id">
            <el-table-column prop="code" label="模板代码" width="150" />
            <el-table-column prop="name" label="模板名称" min-width="150" />
            <el-table-column prop="category" label="分类" width="120">
              <template #default="{ row }">
                <el-tag :type="getCategoryTagType(row.category)">
                  {{ getCategoryName(row.category) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="标题" min-width="200" />
            <el-table-column prop="content" label="内容" min-width="250" show-overflow-tooltip />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-switch v-model="row.enabled" @change="updateTemplate(row)" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="editTemplate(row)">编辑</el-button>
                <el-button link type="danger" @click="deleteTemplate(row)">删除</el-button>
                <el-button link type="success" @click="testTemplate(row)">测试</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- 发送规则 -->
      <el-tab-pane label="⚙️ 发送规则" name="rules">
        <div class="rules-section">
          <el-card v-for="rule in sendRules" :key="rule.category" class="rule-card" style="margin-bottom: 20px;">
            <template #header>
              <div class="card-header">
                <span>{{ getCategoryName(rule.category) }}</span>
              </div>
            </template>

            <el-form :model="rule" label-width="200px">
              <el-form-item label="启用自动发送">
                <el-switch v-model="rule.enabled" @change="saveRules" />
              </el-form-item>
              <el-form-item label="发送时机">
                <el-checkbox-group v-model="rule.sendTiming">
                  <el-checkbox label="immediate">立即发送</el-checkbox>
                  <el-checkbox label="scheduled">定时发送</el-checkbox>
                  <el-checkbox label="batch">批量发送</el-checkbox>
                </el-checkbox-group>
              </el-form-item>
              <el-form-item label="批量发送时间" v-if="rule.sendTiming.includes('batch')">
                <el-time-picker
                  v-model="rule.batchTime"
                  format="HH:mm"
                  value-format="HH:mm"
                  @change="saveRules"
                />
              </el-form-item>
              <el-form-item label="延迟发送（分钟）">
                <el-input-number
                  v-model="rule.delayMinutes"
                  :min="0"
                  :max="1440"
                  @change="saveRules"
                />
                <div class="form-tip">0表示立即发送，大于0表示延迟发送</div>
              </el-form-item>
              <el-form-item label="发送渠道">
                <el-checkbox-group v-model="rule.channels">
                  <el-checkbox label="subscribe">订阅消息</el-checkbox>
                  <el-checkbox label="inapp">站内消息</el-checkbox>
                  <el-checkbox label="sms">短信</el-checkbox>
                </el-checkbox-group>
              </el-form-item>
            </el-form>
          </el-card>
        </div>
      </el-tab-pane>

      <!-- 发送记录 -->
      <el-tab-pane label="📋 发送记录" name="logs">
        <div class="logs-section">
          <!-- 筛选器 -->
          <div class="filter-bar">
            <el-date-picker
              v-model="logDateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              format="YYYY-MM-DD"
              value-format="YYYY-MM-DD"
              @change="loadLogs"
            />
            <el-select
              v-model="logFilterStatus"
              placeholder="筛选状态"
              clearable
              style="width: 150px;"
              @change="loadLogs"
            >
              <el-option label="全部" value="" />
              <el-option label="成功" value="success" />
              <el-option label="失败" value="failed" />
              <el-option label="待发送" value="pending" />
            </el-select>
            <el-select
              v-model="logFilterCategory"
              placeholder="筛选分类"
              clearable
              style="width: 150px;"
              @change="loadLogs"
            >
              <el-option label="全部" value="" />
              <el-option label="预约相关" value="booking" />
              <el-option label="订单相关" value="order" />
              <el-option label="活动相关" value="activity" />
              <el-option label="系统通知" value="system" />
            </el-select>
            <el-button type="primary" @click="loadLogs" :loading="logsLoading">
              <el-icon><Refresh /></el-icon>刷新
            </el-button>
          </div>

          <el-table :data="logs" v-loading="logsLoading" style="margin-top: 20px;">
            <el-table-column prop="templateName" label="模板名称" min-width="150" />
            <el-table-column prop="category" label="分类" width="120">
              <template #default="{ row }">
                <el-tag :type="getCategoryTagType(row.category)" size="small">
                  {{ getCategoryName(row.category) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="recipient" label="接收人" width="150" />
            <el-table-column prop="channel" label="发送渠道" width="120">
              <template #default="{ row }">
                <el-tag size="small">{{ getChannelName(row.channel) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="getStatusTagType(row.status)" size="small">
                  {{ getStatusName(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="sentAt" label="发送时间" min-width="180">
              <template #default="{ row }">
                {{ formatDate(row.sentAt) }}
              </template>
            </el-table-column>
            <el-table-column prop="error" label="错误信息" min-width="200" show-overflow-tooltip />
          </el-table>

          <el-pagination
            v-model:current-page="logPage"
            v-model:page-size="logPageSize"
            :total="logTotal"
            :page-sizes="[10, 20, 50, 100]"
            layout="total, sizes, prev, pager, next, jumper"
            @size-change="loadLogs"
            @current-change="loadLogs"
            style="margin-top: 20px; justify-content: flex-end;"
          />
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 模板编辑对话框 -->
    <el-dialog
      v-model="templateDialogVisible"
      :title="isEditingTemplate ? '编辑模板' : '新增模板'"
      width="800px"
      :close-on-click-modal="false"
    >
      <el-form :model="templateForm" label-width="120px" ref="templateFormRef">
        <el-form-item label="模板代码" prop="code" :rules="[{ required: true, message: '请输入模板代码' }]">
          <el-input v-model="templateForm.code" placeholder="如：booking_success" :disabled="isEditingTemplate" />
        </el-form-item>
        <el-form-item label="模板名称" prop="name" :rules="[{ required: true, message: '请输入模板名称' }]">
          <el-input v-model="templateForm.name" placeholder="如：预约成功" />
        </el-form-item>
        <el-form-item label="分类" prop="category" :rules="[{ required: true }]">
          <el-select v-model="templateForm.category" placeholder="选择分类">
            <el-option label="预约相关" value="booking" />
            <el-option label="订单相关" value="order" />
            <el-option label="活动相关" value="activity" />
            <el-option label="系统通知" value="system" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题" prop="title" :rules="[{ required: true, message: '请输入标题' }]">
          <el-input v-model="templateForm.title" placeholder="消息标题，可使用变量：{{date}}, {{time}}, {{name}}等" />
        </el-form-item>
        <el-form-item label="内容" prop="content" :rules="[{ required: true, message: '请输入内容' }]">
          <el-input
            v-model="templateForm.content"
            type="textarea"
            :rows="6"
            placeholder="消息内容，可使用变量：{{date}}, {{time}}, {{name}}, {{code}}等"
          />
        </el-form-item>
        <el-form-item label="变量说明">
          <div class="variable-help">
            <div>可用变量：</div>
            <div><code>{{date}}</code> - 日期</div>
            <div><code>{{time}}</code> - 时间</div>
            <div><code>{{name}}</code> - 名称</div>
            <div><code>{{code}}</code> - 编号/代码</div>
            <div><code>{{amount}}</code> - 金额</div>
          </div>
        </el-form-item>
        <el-form-item label="启用状态">
          <el-switch v-model="templateForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="templateDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveTemplate">保存</el-button>
      </template>
    </el-dialog>

    <!-- 测试对话框 -->
    <el-dialog v-model="testDialogVisible" title="测试消息模板" width="600px">
      <el-form :model="testForm" label-width="120px">
        <el-form-item label="接收人">
          <el-input v-model="testForm.recipient" placeholder="输入接收人openid或手机号" />
        </el-form-item>
        <el-form-item label="预览内容">
          <el-card>
            <div class="preview-title">{{ testPreview.title }}</div>
            <div class="preview-content">{{ testPreview.content }}</div>
          </el-card>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="testDialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="sendTestMessage">发送测试</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, watch } from 'vue'
import {
  COLLECTIONS,
  fetchCollectionSorted,
  fetchCollectionWhere,
  cdnAdd,
  cdnUpdate,
  cdnRemove,
  cdnUpsertByWhere,
  cdnQueryPage,
  cdnCount,
  getCdnDatabase,
} from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'

// --- 状态定义 ---
const activeTab = ref('templates')
const loading = ref(false)
const logsLoading = ref(false)
const templateDialogVisible = ref(false)
const testDialogVisible = ref(false)
const isEditingTemplate = ref(false)
const filterCategory = ref('')
const logDateRange = ref([getDateString(-7), getDateString(0)])
const logFilterStatus = ref('')
const logFilterCategory = ref('')
const logPage = ref(1)
const logPageSize = ref(20)
const logTotal = ref(0)

// 模板列表
const templates = ref([])

// 模板表单
const templateForm = reactive({
  code: '',
  name: '',
  category: 'booking',
  title: '',
  content: '',
  enabled: true
})

// 测试表单
const testForm = reactive({
  recipient: '',
  templateCode: ''
})

const testPreview = computed(() => {
  const template = templates.value.find(t => t.code === testForm.templateCode)
  if (!template) return { title: '', content: '' }
  
  // 替换变量为测试数据
  let title = template.title || ''
  let content = template.content || ''
  
  const vars = {
    date: '2025-01-XX',
    time: '14:00',
    name: '测试用户',
    code: 'TEST123',
    amount: '¥100.00'
  }
  
  Object.keys(vars).forEach(key => {
    const regex = new RegExp(`{{${key}}}`, 'g')
    title = title.replace(regex, vars[key])
    content = content.replace(regex, vars[key])
  })
  
  return { title, content }
})

// 发送规则
const sendRules = ref([
  {
    category: 'booking',
    enabled: true,
    sendTiming: ['immediate'],
    batchTime: '09:00',
    delayMinutes: 0,
    channels: ['subscribe', 'inapp']
  },
  {
    category: 'order',
    enabled: true,
    sendTiming: ['immediate'],
    batchTime: '09:00',
    delayMinutes: 0,
    channels: ['subscribe', 'inapp']
  },
  {
    category: 'activity',
    enabled: true,
    sendTiming: ['immediate'],
    batchTime: '09:00',
    delayMinutes: 0,
    channels: ['subscribe', 'inapp']
  },
  {
    category: 'system',
    enabled: true,
    sendTiming: ['immediate'],
    batchTime: '09:00',
    delayMinutes: 0,
    channels: ['inapp']
  }
])

// 发送记录
const logs = ref([])

// --- 工具方法 ---
function getDateString(daysOffset = 0) {
  const date = new Date()
  date.setDate(date.getDate() + daysOffset)
  return date.toISOString().split('T')[0]
}

const getCategoryName = (category) => {
  const names = {
    booking: '预约相关',
    order: '订单相关',
    activity: '活动相关',
    system: '系统通知',
    other: '其他'
  }
  return names[category] || category
}

const getCategoryTagType = (category) => {
  const types = {
    booking: '',
    order: 'success',
    activity: 'warning',
    system: 'info',
    other: 'info'
  }
  return types[category] || 'info'
}

const getChannelName = (channel) => {
  const names = {
    subscribe: '订阅消息',
    inapp: '站内消息',
    sms: '短信'
  }
  return names[channel] || channel
}

const getStatusName = (status) => {
  const names = {
    success: '成功',
    failed: '失败',
    pending: '待发送'
  }
  return names[status] || status
}

const getStatusTagType = (status) => {
  const types = {
    success: 'success',
    failed: 'danger',
    pending: 'warning'
  }
  return types[status] || 'info'
}

const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

// --- 计算属性 ---
const filteredTemplates = computed(() => {
  if (!filterCategory.value) return templates.value
  return templates.value.filter(t => t.category === filterCategory.value)
})

// --- 数据加载和保存 ---
const loadTemplates = async () => {
  loading.value = true
  try {
    templates.value = await fetchCollectionSorted(COLLECTIONS.NOTIFICATION_TEMPLATES, {
      limit: 500,
      sortFn: (a, b) => {
        const cat = (a.category || '').localeCompare(b.category || '')
        if (cat !== 0) return cat
        return (a.code || '').localeCompare(b.code || '')
      }
    })
    if (templates.value.length === 0) {
      await initDefaultTemplates()
    }
  } catch (err) {
    console.error('加载模板失败', err)
    templates.value = []
    ElMessage.error('加载模板失败')
  } finally {
    loading.value = false
  }
}

const initDefaultTemplates = async () => {
  const defaultTemplates = [
    {
      code: 'booking_success',
      name: '预约成功',
      category: 'booking',
      title: '预约成功',
      content: '您的预约已确认\n日期：{{date}}\n时间：{{time}}\n票号：{{code}}',
      enabled: true
    },
    {
      code: 'booking_reminder_day',
      name: '预约提醒（前一天）',
      category: 'booking',
      title: '预约提醒',
      content: '提醒：您明天有预约\n日期：{{date}}\n时间：{{time}}\n请准时到达',
      enabled: true
    },
    {
      code: 'booking_reminder_hour',
      name: '预约提醒（前2小时）',
      category: 'booking',
      title: '预约提醒',
      content: '提醒：您2小时后有预约\n时间：{{time}}\n请准时到达',
      enabled: true
    },
    {
      code: 'booking_changed',
      name: '预约变更',
      category: 'booking',
      title: '预约变更',
      content: '您的预约已变更\n新日期：{{date}}\n新时间：{{time}}',
      enabled: true
    },
    {
      code: 'booking_cancelled',
      name: '预约取消',
      category: 'booking',
      title: '预约取消',
      content: '您的预约已取消\n日期：{{date}}\n时间：{{time}}',
      enabled: true
    },
    {
      code: 'order_paid',
      name: '订单支付成功',
      category: 'order',
      title: '订单支付成功',
      content: '您的订单已支付成功\n订单号：{{code}}\n金额：{{amount}}',
      enabled: true
    },
    {
      code: 'order_shipped',
      name: '订单已发货',
      category: 'order',
      title: '订单已发货',
      content: '您的订单已发货\n订单号：{{code}}\n请注意查收',
      enabled: true
    }
  ]
  
  try {
    for (const template of defaultTemplates) {
      template._createTime = new Date()
      await cdnAdd(COLLECTIONS.NOTIFICATION_TEMPLATES, template)
    }
    ElMessage.success('默认模板初始化成功')
    loadTemplates()
  } catch (err) {
    console.error('初始化模板失败', err)
  }
}

const loadRules = async () => {
  try {
    const rows = await fetchCollectionWhere(COLLECTIONS.NOTIFICATION_TEMPLATES, { type: 'send_rules' }, 1)
    if (rows.length > 0) {
      sendRules.value = rows[0].rules || sendRules.value
    }
  } catch (err) {
    console.error('加载规则失败', err)
  }
}

const saveRules = async () => {
  try {
    await cdnUpsertByWhere(COLLECTIONS.NOTIFICATION_TEMPLATES, { type: 'send_rules' }, {
      type: 'send_rules',
      rules: sendRules.value,
      _updateTime: new Date()
    })
    ElMessage.success('规则保存成功')
  } catch (err) {
    console.error('保存规则失败', err)
    ElMessage.error('保存规则失败')
  }
}

const loadLogs = async () => {
  if (!logDateRange.value || logDateRange.value.length !== 2) {
    ElMessage.warning('请选择日期范围')
    return
  }
  
  logsLoading.value = true
  try {
    const cdnDb = await getCdnDatabase()
    const _ = cdnDb.command
    const startDate = new Date(logDateRange.value[0])
    const endDate = new Date(logDateRange.value[1])
    endDate.setHours(23, 59, 59, 999)
    
    const where = {
      sentAt: _.gte(startDate).and(_.lte(endDate))
    }
    if (logFilterStatus.value) where.status = logFilterStatus.value
    if (logFilterCategory.value) where.category = logFilterCategory.value

    logs.value = await cdnQueryPage('notification_logs', {
      where,
      orderField: 'sentAt',
      direction: 'desc',
      skip: (logPage.value - 1) * logPageSize.value,
      limit: logPageSize.value
    })
    logTotal.value = await cdnCount('notification_logs', where)
  } catch (err) {
    console.error('加载日志失败', err)
    logs.value = []
    ElMessage.error('加载日志失败')
  } finally {
    logsLoading.value = false
  }
}

const addTemplate = () => {
  isEditingTemplate.value = false
  Object.assign(templateForm, {
    code: '',
    name: '',
    category: 'booking',
    title: '',
    content: '',
    enabled: true
  })
  templateDialogVisible.value = true
}

const editTemplate = (row) => {
  isEditingTemplate.value = true
  Object.assign(templateForm, { ...row })
  templateDialogVisible.value = true
}

const updateTemplate = async (row) => {
  try {
    await cdnUpdate(COLLECTIONS.NOTIFICATION_TEMPLATES, row._id, {
      enabled: row.enabled,
      _updateTime: new Date()
    })
    ElMessage.success('更新成功')
  } catch (err) {
    console.error('更新失败', err)
    ElMessage.error('更新失败')
  }
}

const saveTemplate = async () => {
  if (!templateForm.code || !templateForm.name || !templateForm.title || !templateForm.content) {
    ElMessage.warning('请填写完整信息')
    return
  }
  
  try {
    const data = {
      ...templateForm,
      _updateTime: new Date()
    }
    
    if (isEditingTemplate.value) {
      const existing = templates.value.find(t => t.code === templateForm.code && t._id)
      if (existing) {
        await cdnUpdate(COLLECTIONS.NOTIFICATION_TEMPLATES, existing._id, data)
        ElMessage.success('模板更新成功')
      }
    } else {
      const existing = templates.value.find(t => t.code === templateForm.code)
      if (existing) {
        ElMessage.warning('模板代码已存在')
        return
      }
      data._createTime = new Date()
      await cdnAdd(COLLECTIONS.NOTIFICATION_TEMPLATES, data)
      ElMessage.success('模板创建成功')
    }
    
    templateDialogVisible.value = false
    loadTemplates()
  } catch (err) {
    console.error('保存模板失败', err)
    ElMessage.error('保存模板失败')
  }
}

const deleteTemplate = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要删除模板"${row.name}"吗？`, '确认删除', {
      type: 'warning'
    })
    
    await cdnRemove(COLLECTIONS.NOTIFICATION_TEMPLATES, row._id)
    ElMessage.success('删除成功')
    loadTemplates()
  } catch (err) {
    if (err !== 'cancel') {
      console.error('删除失败', err)
      ElMessage.error('删除失败')
    }
  }
}

const testTemplate = (row) => {
  testForm.templateCode = row.code
  testForm.recipient = ''
  testDialogVisible.value = true
}

const sendTestMessage = () => {
  if (!testForm.recipient) {
    ElMessage.warning('请输入接收人')
    return
  }
  ElMessage.info('测试消息功能开发中，请在小程序中测试')
}

const filterTemplates = () => {
  // 使用computed自动过滤
}

watch(() => templateForm.content, () => {
  // 内容变化时更新预览
})

// --- 生命周期 ---
onMounted(async () => {
  await loadTemplates()
  await loadRules()
})
</script>

<style scoped>
.notification-config {
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

.action-bar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.filter-bar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.rule-card {
  border: 1px solid rgba(212, 175, 55, 0.2);
}

.card-header {
  font-weight: 600;
  color: #2c3e50;
}

.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.variable-help {
  font-size: 13px;
  color: #5a6c7d;
  background: #f5f7fa;
  padding: 12px;
  border-radius: 6px;
}

.variable-help code {
  background: #ffffff;
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--gold-700);
  font-weight: 600;
}

.preview-title {
  font-size: 16px;
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 12px;
}

.preview-content {
  font-size: 14px;
  color: #5a6c7d;
  white-space: pre-wrap;
  line-height: 1.6;
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
</style>


