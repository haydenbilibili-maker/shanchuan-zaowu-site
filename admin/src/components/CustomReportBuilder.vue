<template>
  <div class="custom-report-builder">
    <div class="header-section">
      <h2>数据报表增强</h2>
      <p class="subtitle">自定义报表配置、模板管理和数据导出</p>
    </div>

    <el-tabs v-model="activeTab" type="card" class="config-tabs">
      <!-- 自定义报表 -->
      <el-tab-pane label="📊 自定义报表" name="builder">
        <div class="report-builder-section">
          <el-row :gutter="24">
            <el-col :span="6">
              <el-card class="config-card">
                <template #header>
                  <span>报表配置</span>
                </template>

                <el-form :model="reportConfig" label-width="100px" label-position="top">
                  <el-form-item label="报表名称">
                    <el-input v-model="reportConfig.name" placeholder="输入报表名称" />
                  </el-form-item>

                  <el-form-item label="时间范围">
                    <el-date-picker
                      v-model="reportConfig.dateRange"
                      type="daterange"
                      range-separator="至"
                      start-placeholder="开始日期"
                      end-placeholder="结束日期"
                      style="width: 100%;"
                    />
                  </el-form-item>

                  <el-form-item label="分组维度">
                    <el-checkbox-group v-model="reportConfig.groupBy">
                      <el-checkbox label="date">按日期</el-checkbox>
                      <el-checkbox label="category">按分类</el-checkbox>
                      <el-checkbox label="status">按状态</el-checkbox>
                      <el-checkbox label="user">按用户</el-checkbox>
                    </el-checkbox-group>
                  </el-form-item>

                  <el-form-item label="选择指标">
                    <el-checkbox-group v-model="reportConfig.metrics">
                      <el-checkbox label="revenue">营收</el-checkbox>
                      <el-checkbox label="orders">订单数</el-checkbox>
                      <el-checkbox label="users">用户数</el-checkbox>
                      <el-checkbox label="products">商品数</el-checkbox>
                      <el-checkbox label="profit">利润</el-checkbox>
                      <el-checkbox label="cost">成本</el-checkbox>
                    </el-checkbox-group>
                  </el-form-item>

                  <el-form-item>
                    <el-button type="primary" @click="generateReport" :loading="generating" style="width: 100%;">
                      <el-icon><Refresh /></el-icon>生成报表
                    </el-button>
                  </el-form-item>

                  <el-form-item>
                    <el-button @click="saveAsTemplate" style="width: 100%;">
                      <el-icon><Document /></el-icon>保存为模板
                    </el-button>
                  </el-form-item>
                </el-form>
              </el-card>
            </el-col>

            <el-col :span="18">
              <el-card class="config-card">
                <template #header>
                  <div class="card-header">
                    <span>报表预览</span>
                    <div>
                      <el-button @click="exportToExcel" :disabled="!reportData.length">
                        <el-icon><Download /></el-icon>导出Excel
                      </el-button>
                      <el-button @click="exportToPDF" :disabled="!reportData.length">
                        <el-icon><Document /></el-icon>导出PDF
                      </el-button>
                    </div>
                  </div>
                </template>

                <div v-if="reportData.length > 0">
                  <el-table 
                    :data="reportData" 
                    v-loading="generating"
                    style="width: 100%;"
                    border
                    stripe
                  >
                    <el-table-column 
                      v-for="column in reportColumns" 
                      :key="column.prop"
                      :prop="column.prop"
                      :label="column.label"
                      :width="column.width"
                      :formatter="column.formatter"
                    />
                  </el-table>

                  <div class="report-summary" style="margin-top: 20px;">
                    <el-card>
                      <template #header>
                        <span>汇总统计</span>
                      </template>
                      <el-row :gutter="20">
                        <el-col 
                          v-for="(value, key) in reportSummary" 
                          :key="key"
                          :span="6"
                        >
                          <div class="summary-item">
                            <div class="summary-label">{{ getMetricLabel(key) }}</div>
                            <div class="summary-value">{{ formatValue(value, key) }}</div>
                          </div>
                        </el-col>
                      </el-row>
                    </el-card>
                  </div>
                </div>
                <el-empty v-else description='配置报表参数并点击"生成报表"查看数据' />
              </el-card>
            </el-col>
          </el-row>
        </div>
      </el-tab-pane>

      <!-- 报表模板 -->
      <el-tab-pane label="📁 报表模板" name="templates">
        <div class="templates-section">
          <div class="action-bar">
            <el-button type="primary" @click="createNewTemplate">
              <el-icon><Plus /></el-icon>新建模板
            </el-button>
            <el-button @click="loadTemplates">
              <el-icon><Refresh /></el-icon>刷新
            </el-button>
          </div>

          <el-table 
            :data="templates" 
            v-loading="loading"
            style="margin-top: 20px;"
            row-key="_id"
          >
            <el-table-column prop="name" label="模板名称" min-width="200" />
            <el-table-column prop="description" label="描述" min-width="300" />
            <el-table-column prop="metrics" label="指标" min-width="200">
              <template #default="{ row }">
                <el-tag 
                  v-for="metric in row.metrics" 
                  :key="metric"
                  size="small"
                  style="margin-right: 5px;"
                >
                  {{ getMetricLabel(metric) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="创建时间" width="180">
              <template #default="{ row }">
                {{ formatTime(row.createdAt) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="applyTemplate(row)">应用</el-button>
                <el-button link type="danger" @click="deleteTemplate(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 新建模板对话框 -->
    <el-dialog
      v-model="templateDialogVisible"
      title="保存报表模板"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form :model="templateForm" label-width="100px">
        <el-form-item label="模板名称" required>
          <el-input v-model="templateForm.name" placeholder="输入模板名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="templateForm.description" type="textarea" :rows="3" placeholder="模板描述" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="templateDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveTemplate">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { fetchCollectionSorted, cdnAdd, cdnRemove } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Download, Document } from '@element-plus/icons-vue'
import * as XLSX from 'xlsx'

// --- 状态定义 ---
const activeTab = ref('builder')
const loading = ref(false)
const generating = ref(false)
const templateDialogVisible = ref(false)

// 报表配置
const reportConfig = reactive({
  name: '',
  dateRange: null,
  groupBy: [],
  metrics: ['revenue', 'orders']
})

// 报表数据
const reportData = ref([])
const reportSummary = reactive({})

// 模板管理
const templates = ref([])
const templateForm = reactive({
  name: '',
  description: '',
  config: null
})

// 报表列定义
const reportColumns = computed(() => {
  const columns = []
  
  // 根据分组维度添加列
  if (reportConfig.groupBy.includes('date')) {
    columns.push({ prop: 'date', label: '日期', width: 120 })
  }
  if (reportConfig.groupBy.includes('category')) {
    columns.push({ prop: 'category', label: '分类', width: 120 })
  }
  if (reportConfig.groupBy.includes('status')) {
    columns.push({ prop: 'status', label: '状态', width: 100 })
  }
  if (reportConfig.groupBy.includes('user')) {
    columns.push({ prop: 'user', label: '用户', width: 150 })
  }
  
  // 根据指标添加列
  reportConfig.metrics.forEach(metric => {
    columns.push({
      prop: metric,
      label: getMetricLabel(metric),
      width: 150,
      formatter: (row) => formatValue(row[metric], metric)
    })
  })
  
  return columns
})

// --- 工具方法 ---
const getMetricLabel = (metric) => {
  const labels = {
    revenue: '营收(元)',
    orders: '订单数',
    users: '用户数',
    products: '商品数',
    profit: '利润(元)',
    cost: '成本(元)'
  }
  return labels[metric] || metric
}

const formatValue = (value, metric) => {
  if (value === null || value === undefined) return '-'
  if (metric === 'revenue' || metric === 'profit' || metric === 'cost') {
    return '¥' + value.toLocaleString()
  }
  return value.toLocaleString()
}

const formatTime = (time) => {
  if (!time) return '-'
  return new Date(time).toLocaleString('zh-CN')
}

// --- 报表生成 ---
const generateReport = async () => {
  if (!reportConfig.dateRange || reportConfig.dateRange.length !== 2) {
    ElMessage.warning('请选择时间范围')
    return
  }
  
  if (reportConfig.metrics.length === 0) {
    ElMessage.warning('请至少选择一个指标')
    return
  }
  
  generating.value = true
  try {
    const startDate = new Date(reportConfig.dateRange[0])
    startDate.setHours(0, 0, 0, 0)
    const endDate = new Date(reportConfig.dateRange[1])
    endDate.setHours(23, 59, 59, 999)
    
    // 模拟数据生成（实际应该从数据库查询）
    // 这里简化处理，实际应该根据groupBy和metrics从数据库聚合数据
    const mockData = generateMockReportData(startDate, endDate)
    reportData.value = mockData
    
    // 计算汇总
    calculateSummary(mockData)
    
    ElMessage.success('报表生成成功')
  } catch (err) {
    console.error('生成报表失败', err)
    ElMessage.error('生成报表失败')
  } finally {
    generating.value = false
  }
}

const generateMockReportData = (startDate, endDate) => {
  const data = []
  const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
  
  for (let i = 0; i < Math.min(days, 30); i++) {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + i)
    
    const row = {
      date: date.toISOString().split('T')[0]
    }
    
    reportConfig.metrics.forEach(metric => {
      if (metric === 'revenue') row[metric] = Math.floor(Math.random() * 10000) + 5000
      else if (metric === 'orders') row[metric] = Math.floor(Math.random() * 50) + 10
      else if (metric === 'users') row[metric] = Math.floor(Math.random() * 20) + 5
      else if (metric === 'products') row[metric] = Math.floor(Math.random() * 100) + 50
      else if (metric === 'profit') row[metric] = Math.floor((row.revenue || 0) * 0.3)
      else if (metric === 'cost') row[metric] = Math.floor((row.revenue || 0) * 0.7)
    })
    
    data.push(row)
  }
  
  return data
}

const calculateSummary = (data) => {
  reportConfig.metrics.forEach(metric => {
    reportSummary[metric] = data.reduce((sum, row) => sum + (row[metric] || 0), 0)
  })
}

// --- 模板管理 ---
const loadTemplates = async () => {
  loading.value = true
  try {
    templates.value = await fetchCollectionSorted('report_templates', {
      limit: 200,
      sortFn: (a, b) => new Date(b.createdAt || b._createTime || 0) - new Date(a.createdAt || a._createTime || 0)
    })
  } catch (err) {
    console.error('加载模板失败', err)
    templates.value = []
    ElMessage.error('加载模板失败')
  } finally {
    loading.value = false
  }
}

const createNewTemplate = () => {
  templateForm.name = reportConfig.name || '未命名报表'
  templateForm.description = ''
  templateForm.config = JSON.parse(JSON.stringify(reportConfig))
  templateDialogVisible.value = true
}

const saveAsTemplate = () => {
  if (!reportConfig.name) {
    reportConfig.name = '报表_' + new Date().toLocaleString('zh-CN')
  }
  createNewTemplate()
}

const saveTemplate = async () => {
  if (!templateForm.name) {
    ElMessage.warning('请输入模板名称')
    return
  }
  
  try {
    await cdnAdd('report_templates', {
      name: templateForm.name,
      description: templateForm.description,
      config: templateForm.config ?? JSON.parse(JSON.stringify(reportConfig)),
      createdAt: new Date(),
      _createTime: Date.now()
    })
    ElMessage.success('模板保存成功')
    templateDialogVisible.value = false
    loadTemplates()
  } catch (err) {
    console.error('保存模板失败', err)
    ElMessage.error('保存模板失败')
  }
}

const applyTemplate = (template) => {
  Object.assign(reportConfig, template.config)
  ElMessage.success('模板已应用')
  generateReport()
}

const deleteTemplate = async (template) => {
  try {
    await ElMessageBox.confirm(`确定要删除模板"${template.name}"吗？`, '确认删除', {
      type: 'warning'
    })
    
    await cdnRemove('report_templates', template._id)
    ElMessage.success('模板删除成功')
    loadTemplates()
  } catch (err) {
    if (err !== 'cancel') {
      console.error('删除模板失败', err)
      ElMessage.error('删除模板失败')
    }
  }
}

// --- 数据导出 ---
const exportToExcel = () => {
  if (reportData.value.length === 0) {
    ElMessage.warning('没有数据可导出')
    return
  }
  
  try {
    // 准备导出数据
    const exportData = reportData.value.map(row => {
      const exportRow = {}
      reportColumns.value.forEach(col => {
        const value = col.formatter ? col.formatter(row) : (row[col.prop] || '')
        exportRow[col.label] = typeof value === 'string' ? value.replace(/¥/g, '') : value
      })
      return exportRow
    })
    
    // 创建工作簿
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(exportData)
    
    // 设置列宽
    const colWidths = reportColumns.value.map(() => ({ wch: 15 }))
    ws['!cols'] = colWidths
    
    // 添加工作表
    XLSX.utils.book_append_sheet(wb, ws, '报表数据')
    
    // 导出文件
    const fileName = (reportConfig.name || '报表') + '_' + new Date().toISOString().split('T')[0] + '.xlsx'
    XLSX.writeFile(wb, fileName)
    
    ElMessage.success('Excel导出成功')
  } catch (err) {
    console.error('导出Excel失败', err)
    ElMessage.error('导出Excel失败: ' + err.message)
  }
}

const exportToPDF = () => {
  if (reportData.value.length === 0) {
    ElMessage.warning('没有数据可导出')
    return
  }
  
  try {
    // 使用浏览器打印功能导出PDF
    const printWindow = window.open('', '_blank')
    const tableHtml = generateTableHTML()
    const reportName = reportConfig.name || '数据报表'
    const reportTime = new Date().toLocaleString('zh-CN')
    
    // 分离script标签以避免模板字符串解析问题
    const scriptContent = 'window.onload = function() { window.print(); }'
    
    printWindow.document.write('<!DOCTYPE html><html><head>' +
      '<title>' + reportName + '</title>' +
      '<style>' +
      'body { font-family: Arial, sans-serif; padding: 20px; }' +
      'h1 { color: #2c3e50; }' +
      'table { width: 100%; border-collapse: collapse; margin-top: 20px; }' +
      'th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }' +
      'th { background-color: #f5f7fa; font-weight: bold; }' +
      '@media print { @page { size: A4 landscape; } }' +
      '</style>' +
      '</head><body>' +
      '<h1>' + reportName + '</h1>' +
      '<p>生成时间: ' + reportTime + '</p>' +
      tableHtml +
      '<' + 'script' + '>' + scriptContent + '</' + 'script' + '>' +
      '</body></html>')
    printWindow.document.close()
  } catch (err) {
    console.error('导出PDF失败', err)
    ElMessage.error('导出PDF失败')
  }
}

const generateTableHTML = () => {
  let html = '<table><thead><tr>'
  reportColumns.value.forEach(col => {
    html += `<th>${col.label}</th>`
  })
  html += '</tr></thead><tbody>'
  
  reportData.value.forEach(row => {
    html += '<tr>'
    reportColumns.value.forEach(col => {
      const value = col.formatter ? col.formatter(row) : row[col.prop]
      html += `<td>${value || '-'}</td>`
    })
    html += '</tr>'
  })
  
  html += '</tbody></table>'
  return html
}

// --- 生命周期 ---
onMounted(() => {
  loadTemplates()
})
</script>

<style scoped>
.custom-report-builder {
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

.action-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.report-summary {
  margin-top: 20px;
}

.summary-item {
  text-align: center;
  padding: 15px;
}

.summary-label {
  font-size: 14px;
  color: #5a6c7d;
  margin-bottom: 8px;
}

.summary-value {
  font-size: 24px;
  font-weight: 700;
  color: #d4af37;
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

:deep(.el-form-item__label) {
  color: #2c3e50;
  font-weight: 500;
}
</style>
