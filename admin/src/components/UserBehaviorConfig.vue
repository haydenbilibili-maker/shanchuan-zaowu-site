<template>
  <div class="user-behavior-config">
    <div class="header-section">
      <h2>用户行为追踪配置</h2>
      <p class="subtitle">配置行为追踪规则和统计报表</p>
    </div>

    <el-tabs v-model="activeTab" type="card" class="config-tabs">
      <!-- 追踪配置 -->
      <el-tab-pane label="⚙️ 追踪配置" name="config">
        <div class="config-section">
          <el-card class="config-card">
            <template #header>
              <div class="card-header">
                <span>追踪动作类型配置</span>
                <el-button type="primary" size="small" @click="addBehaviorType">
                  <el-icon><Plus /></el-icon>新增类型
                </el-button>
              </div>
            </template>

            <el-table :data="behaviorTypes" v-loading="loading">
              <el-table-column prop="action" label="动作代码" width="150" />
              <el-table-column prop="name" label="动作名称" min-width="150" />
              <el-table-column prop="category" label="分类" width="120">
                <template #default="{ row }">
                  <el-tag :type="getCategoryTagType(row.category)">
                    {{ getCategoryName(row.category) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="是否追踪" width="100">
                <template #default="{ row }">
                  <el-switch v-model="row.enabled" @change="saveConfig" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="150" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="editBehaviorType(row)">编辑</el-button>
                  <el-button link type="danger" @click="deleteBehaviorType(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>

          <el-card class="config-card" style="margin-top: 20px;">
            <template #header>
              <div class="card-header">
                <span>全局配置</span>
              </div>
            </template>

            <el-form :model="globalConfig" label-width="200px">
              <el-form-item label="数据保留时间（天）">
                <el-input-number
                  v-model="globalConfig.dataRetentionDays"
                  :min="1"
                  :max="365"
                  @change="saveConfig"
                />
                <div class="form-tip">超过此时间的行为数据将被自动清理</div>
              </el-form-item>
              <el-form-item label="实时追踪">
                <el-switch v-model="globalConfig.realTimeTracking" @change="saveConfig" />
                <div class="form-tip">开启后将实时记录用户行为，关闭则延迟记录</div>
              </el-form-item>
              <el-form-item label="匿名追踪">
                <el-switch v-model="globalConfig.anonymousTracking" @change="saveConfig" />
                <div class="form-tip">开启后将对匿名用户也进行追踪（不使用openid）</div>
              </el-form-item>
              <el-form-item label="采样率（%）">
                <el-input-number
                  v-model="globalConfig.samplingRate"
                  :min="0"
                  :max="100"
                  :precision="1"
                  @change="saveConfig"
                />
                <div class="form-tip">100表示记录所有行为，50表示只记录50%的行为（用于大数据量场景）</div>
              </el-form-item>
            </el-form>
          </el-card>
        </div>
      </el-tab-pane>

      <!-- 行为统计 -->
      <el-tab-pane label="📊 行为统计" name="stats">
        <div class="stats-section">
          <!-- 时间筛选 -->
          <div class="filter-bar">
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              format="YYYY-MM-DD"
              value-format="YYYY-MM-DD"
              @change="loadStatistics"
            />
            <el-button type="primary" @click="loadStatistics" :loading="statsLoading">
              <el-icon><Refresh /></el-icon>刷新
            </el-button>
            <el-button @click="exportStatistics">
              <el-icon><Download /></el-icon>导出
            </el-button>
          </div>

          <!-- 统计卡片 -->
          <el-row :gutter="20" style="margin-top: 20px;">
            <el-col :span="6" v-for="(stat, key) in statistics.summary" :key="key">
              <el-card class="stat-card">
                <div class="stat-label">{{ getActionName(key) }}</div>
                <div class="stat-value">{{ stat.count || 0 }}</div>
                <div class="stat-desc">总次数</div>
              </el-card>
            </el-col>
          </el-row>

          <!-- 行为趋势图 -->
          <el-card style="margin-top: 20px;">
            <template #header>
              <div class="card-header">
                <span>行为趋势</span>
                <el-select v-model="chartAction" placeholder="选择动作" style="width: 200px;">
                  <el-option label="全部" value="" />
                  <el-option
                    v-for="type in behaviorTypes"
                    :key="type.action"
                    :label="type.name"
                    :value="type.action"
                  />
                </el-select>
              </div>
            </template>
            <div ref="chartContainer" style="height: 400px;"></div>
          </el-card>

          <!-- 行为明细表 -->
          <el-card style="margin-top: 20px;">
            <template #header>
              <div class="card-header">
                <span>行为明细</span>
              </div>
            </template>
            <el-table :data="statistics.details" v-loading="statsLoading">
              <el-table-column prop="action" label="动作" width="150">
                <template #default="{ row }">
                  {{ getActionName(row.action) }}
                </template>
              </el-table-column>
              <el-table-column prop="count" label="次数" width="100" sortable />
              <el-table-column prop="uniqueUsers" label="独立用户数" width="120" sortable />
              <el-table-column label="平均每用户" width="120">
                <template #default="{ row }">
                  {{ (row.count / (row.uniqueUsers || 1)).toFixed(2) }}
                </template>
              </el-table-column>
              <el-table-column prop="lastTime" label="最后发生时间" min-width="180">
                <template #default="{ row }">
                  {{ formatDate(row.lastTime) }}
                </template>
              </el-table-column>
            </el-table>
          </el-card>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 行为类型编辑对话框 -->
    <el-dialog
      v-model="behaviorTypeDialogVisible"
      :title="isEditingBehaviorType ? '编辑行为类型' : '新增行为类型'"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form :model="behaviorTypeForm" label-width="120px" ref="behaviorTypeFormRef">
        <el-form-item label="动作代码" prop="action" :rules="[{ required: true, message: '请输入动作代码' }]">
          <el-input v-model="behaviorTypeForm.action" placeholder="如：view_product" :disabled="isEditingBehaviorType" />
        </el-form-item>
        <el-form-item label="动作名称" prop="name" :rules="[{ required: true, message: '请输入动作名称' }]">
          <el-input v-model="behaviorTypeForm.name" placeholder="如：浏览商品" />
        </el-form-item>
        <el-form-item label="分类" prop="category" :rules="[{ required: true }]">
          <el-select v-model="behaviorTypeForm.category" placeholder="选择分类">
            <el-option label="浏览" value="view" />
            <el-option label="交互" value="interaction" />
            <el-option label="转化" value="conversion" />
            <el-option label="社交" value="social" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="是否追踪">
          <el-switch v-model="behaviorTypeForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="behaviorTypeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveBehaviorType">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { COLLECTIONS, fetchCollectionWhere, fetchCollectionLimit, cdnUpsertByWhere, getCdnDatabase } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Download } from '@element-plus/icons-vue'
// 采样上限单一真源（原实现写死 1000）
import { BEHAVIOR_PULSE_LIMIT } from '../utils/analyticsLimits'
import Chart from 'chart.js/auto'

// --- 状态定义 ---
const activeTab = ref('config')
const loading = ref(false)
const statsLoading = ref(false)
const behaviorTypeDialogVisible = ref(false)
const isEditingBehaviorType = ref(false)
const dateRange = ref([getDateString(-7), getDateString(0)])
const chartAction = ref('')
const chartContainer = ref(null)
let chartInstance = null

// 行为类型列表
const behaviorTypes = ref([])

// 全局配置
const globalConfig = reactive({
  dataRetentionDays: 90,
  realTimeTracking: true,
  anonymousTracking: false,
  samplingRate: 100
})

// 行为类型表单
const behaviorTypeForm = reactive({
  action: '',
  name: '',
  category: 'view',
  enabled: true
})

// 统计数据
const statistics = reactive({
  summary: {},
  details: []
})

// --- 工具方法 ---
function getDateString(daysOffset = 0) {
  const date = new Date()
  date.setDate(date.getDate() + daysOffset)
  return date.toISOString().split('T')[0]
}

const getCategoryName = (category) => {
  const names = {
    view: '浏览',
    interaction: '交互',
    conversion: '转化',
    social: '社交',
    other: '其他'
  }
  return names[category] || category
}

const getCategoryTagType = (category) => {
  const types = {
    view: '',
    interaction: 'success',
    conversion: 'warning',
    social: 'info',
    other: 'info'
  }
  return types[category] || 'info'
}

const getActionName = (action) => {
  const type = behaviorTypes.value.find(t => t.action === action)
  return type ? type.name : action
}

const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

// --- 数据加载和保存 ---
const loadBehaviorTypes = async () => {
  loading.value = true
  try {
    const rows = await fetchCollectionWhere(COLLECTIONS.USER_BEHAVIOR_CONFIG, { type: 'behavior_types' }, 1)
    if (rows.length > 0) {
      behaviorTypes.value = rows[0].types || []
    } else {
      behaviorTypes.value = [
        { action: 'view_product', name: '浏览商品', category: 'view', enabled: true },
        { action: 'view_exhibition', name: '浏览专题', category: 'view', enabled: true },
        { action: 'view_article', name: '浏览文章', category: 'view', enabled: true },
        { action: 'collect', name: '收藏', category: 'interaction', enabled: true },
        { action: 'share', name: '分享', category: 'social', enabled: true },
        { action: 'add_to_cart', name: '加入购物车', category: 'conversion', enabled: true },
        { action: 'purchase', name: '购买', category: 'conversion', enabled: true },
        { action: 'search', name: '搜索', category: 'view', enabled: true },
        { action: 'review', name: '评价', category: 'social', enabled: true },
        { action: 'booking', name: '预约', category: 'conversion', enabled: true }
      ]
      await saveBehaviorTypes()
    }
  } catch (err) {
    console.error('加载行为类型失败', err)
    ElMessage.error('加载行为类型失败')
  } finally {
    loading.value = false
  }
}

const loadGlobalConfig = async () => {
  try {
    const rows = await fetchCollectionWhere(COLLECTIONS.USER_BEHAVIOR_CONFIG, { type: 'global_config' }, 1)
    if (rows.length > 0) {
      Object.assign(globalConfig, rows[0].config || {})
    } else {
      await saveGlobalConfig()
    }
  } catch (err) {
    console.error('加载全局配置失败', err)
  }
}

const saveBehaviorTypes = async () => {
  try {
    await cdnUpsertByWhere(COLLECTIONS.USER_BEHAVIOR_CONFIG, { type: 'behavior_types' }, {
      type: 'behavior_types',
      types: behaviorTypes.value,
      _updateTime: new Date()
    })
  } catch (err) {
    console.error('保存行为类型失败', err)
    ElMessage.error('保存失败')
  }
}

const saveGlobalConfig = async () => {
  try {
    await cdnUpsertByWhere(COLLECTIONS.USER_BEHAVIOR_CONFIG, { type: 'global_config' }, {
      type: 'global_config',
      config: { ...globalConfig },
      _updateTime: new Date()
    })
  } catch (err) {
    console.error('保存全局配置失败', err)
    ElMessage.error('保存失败')
  }
}

const saveConfig = () => {
  saveBehaviorTypes()
  saveGlobalConfig()
}

const addBehaviorType = () => {
  isEditingBehaviorType.value = false
  Object.assign(behaviorTypeForm, {
    action: '',
    name: '',
    category: 'view',
    enabled: true
  })
  behaviorTypeDialogVisible.value = true
}

const editBehaviorType = (row) => {
  isEditingBehaviorType.value = true
  Object.assign(behaviorTypeForm, { ...row })
  behaviorTypeDialogVisible.value = true
}

const saveBehaviorType = async () => {
  if (!behaviorTypeForm.action || !behaviorTypeForm.name) {
    ElMessage.warning('请填写动作代码和名称')
    return
  }
  
  if (isEditingBehaviorType.value) {
    const index = behaviorTypes.value.findIndex(t => t.action === behaviorTypeForm.action)
    if (index >= 0) {
      behaviorTypes.value[index] = { ...behaviorTypeForm }
    }
  } else {
    // 检查是否已存在
    if (behaviorTypes.value.find(t => t.action === behaviorTypeForm.action)) {
      ElMessage.warning('动作代码已存在')
      return
    }
    behaviorTypes.value.push({ ...behaviorTypeForm })
  }
  
  await saveBehaviorTypes()
  behaviorTypeDialogVisible.value = false
  ElMessage.success('保存成功')
}

const deleteBehaviorType = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要删除行为类型"${row.name}"吗？`, '确认删除', {
      type: 'warning'
    })
    
    const index = behaviorTypes.value.findIndex(t => t.action === row.action)
    if (index >= 0) {
      behaviorTypes.value.splice(index, 1)
      await saveBehaviorTypes()
      ElMessage.success('删除成功')
    }
  } catch (err) {
    if (err !== 'cancel') {
      console.error('删除失败', err)
    }
  }
}

// --- 统计数据 ---
const loadStatistics = async () => {
  if (!dateRange.value || dateRange.value.length !== 2) {
    ElMessage.warning('请选择日期范围')
    return
  }
  
  statsLoading.value = true
  try {
    const startDate = new Date(dateRange.value[0])
    const endDate = new Date(dateRange.value[1])
    endDate.setHours(23, 59, 59, 999)

    const cdnDb = await getCdnDatabase()
    const _ = cdnDb.command
    const rows = await fetchCollectionWhere('user_behaviors', {
      timestamp: _.gte(startDate).and(_.lte(endDate))
    }, BEHAVIOR_PULSE_LIMIT)
    
    // 统计数据
    const summary = {}
    const detailsMap = {}
    const userSet = new Set()
    
    rows.forEach(behavior => {
      const action = behavior.action || 'unknown'
      if (!summary[action]) {
        summary[action] = { count: 0, users: new Set() }
      }
      summary[action].count++
      if (behavior._openid) {
        summary[action].users.add(behavior._openid)
        userSet.add(behavior._openid)
      }
      
      if (!detailsMap[action]) {
        detailsMap[action] = {
          action,
          count: 0,
          users: new Set(),
          lastTime: null
        }
      }
      detailsMap[action].count++
      if (behavior._openid) {
        detailsMap[action].users.add(behavior._openid)
      }
      const timestamp = behavior.timestamp ? new Date(behavior.timestamp).getTime() : 0
      if (!detailsMap[action].lastTime || timestamp > new Date(detailsMap[action].lastTime).getTime()) {
        detailsMap[action].lastTime = behavior.timestamp
      }
    })
    
    // 转换为统计格式
    Object.keys(summary).forEach(action => {
      summary[action] = {
        count: summary[action].count,
        uniqueUsers: summary[action].users.size
      }
    })
    
    statistics.summary = summary
    statistics.details = Object.values(detailsMap).map(item => ({
      action: item.action,
      count: item.count,
      uniqueUsers: item.users.size,
      lastTime: item.lastTime
    }))
    
    // 更新图表
    updateChart()
  } catch (err) {
    console.error('加载统计数据失败', err)
    ElMessage.error('加载统计数据失败')
  } finally {
    statsLoading.value = false
  }
}

const updateChart = () => {
  if (!chartContainer.value) return
  
  const ctx = chartContainer.value.getContext('2d')
  
  // 准备数据
  const labels = []
  const data = []
  
  Object.keys(statistics.summary).forEach(action => {
    if (!chartAction.value || action === chartAction.value) {
      labels.push(getActionName(action))
      data.push(statistics.summary[action].count)
    }
  })
  
  if (chartInstance) {
    chartInstance.destroy()
  }
  
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '行为次数',
        data,
        borderColor: '#d4af37',
        backgroundColor: 'rgba(212, 175, 55, 0.1)',
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  })
}

const exportStatistics = () => {
  // TODO: 实现导出功能
  ElMessage.info('导出功能开发中')
}

watch(chartAction, () => {
  updateChart()
})

// --- 生命周期 ---
onMounted(async () => {
  await loadBehaviorTypes()
  await loadGlobalConfig()
  await loadStatistics()
})
</script>

<style scoped>
.user-behavior-config {
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
  border: 1px solid rgba(212, 175, 55, 0.2);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  color: #2c3e50;
}

.filter-bar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.stat-card {
  text-align: center;
  background: linear-gradient(135deg, #fafbfc 0%, #ffffff 100%);
}

.stat-label {
  font-size: 14px;
  color: #5a6c7d;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  color: #d4af37;
}

.stat-desc {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
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


