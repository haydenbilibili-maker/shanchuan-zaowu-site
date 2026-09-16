<template>
  <div class="staff-optimize-ai">
    <div class="ai-header">
      <h3>👔 人力排班优化AI</h3>
      <p class="subtitle">基于客流数据的智能排班与人力配置优化</p>
    </div>

    <div class="ai-sections">
      <div class="section-card">
        <h4>📅 智能排班建议</h4>
        <el-form :model="scheduleForm" label-width="120px">
          <el-form-item label="排班周期">
            <el-select v-model="scheduleForm.period">
              <el-option label="本周" value="week" />
              <el-option label="本月" value="month" />
            </el-select>
          </el-form-item>
          <el-form-item label="店员数量">
            <el-input-number v-model="scheduleForm.staffCount" :min="1" :max="20" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="generateSchedule" :loading="generating">
              生成排班方案
            </el-button>
          </el-form-item>
        </el-form>
        <div v-if="scheduleResult" class="result-content" v-html="scheduleResult"></div>
      </div>

      <div class="section-card">
        <h4>💰 人力成本优化</h4>
        <el-button type="primary" @click="optimizeCost" :loading="optimizing">
          分析人力成本
        </el-button>
        <div v-if="costResult" class="result-content" v-html="costResult"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { callGeminiAPI } from '../../utils/aiHelper'
import { ensureLedgerFresh } from '../../utils/financialData.js'
import { loadLedgerRecords } from '../../utils/dashboardMetrics.js'
import { marked } from 'marked'

const props = defineProps({
  feature: Object
})

const scheduleForm = ref({
  period: 'week',
  staffCount: 5
})

const generating = ref(false)
const optimizing = ref(false)
const scheduleResult = ref('')
const costResult = ref('')

// 从财务报表获取订单数据
const getFinancialData = async () => {
  try {
    // 与财务页/驾驶舱**同源**：先做一次「只读取新」（云端 finance_records → 本机缓存），
    // 再用共享的账本读取函数。原先这里自己 JSON.parse localStorage，
    // 于是本组件能不能看到数据，取决于本浏览器有没有先打开过财务页
    // （实测清空 localStorage 后云端有 308 行账本，这里读到的是 0）。
    await ensureLedgerFresh()
    const records = loadLedgerRecords()
    
    if (!records || records.length === 0) {
      return {
        orderCount: 0,
        revenue: 0,
        averageOrderValue: 0,
        periodLabel: scheduleForm.value.period === 'week' ? '本周' : '本月'
      }
    }

    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    const currentMonth = todayStr.substring(0, 7)
    
    // 计算本周/本月的日期范围
    let startDate, endDate, periodLabel
    if (scheduleForm.value.period === 'week') {
      // 本周：从周一到今天
      const dayOfWeek = now.getDay() // 0=周日, 1=周一, ...
      const monday = new Date(now)
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
      monday.setHours(0, 0, 0, 0)
      startDate = monday.toISOString().split('T')[0]
      endDate = todayStr
      periodLabel = '本周'
    } else {
      // 本月：从1号到今天
      startDate = `${currentMonth}-01`
      endDate = todayStr
      periodLabel = '本月'
    }

    // 筛选时间范围内的记录
    const periodRecords = records.filter(r => {
      const recordDate = r.date
      return recordDate >= startDate && recordDate <= endDate
    })

    // 计算订单数和营收
    const orderCount = periodRecords.reduce((sum, r) => sum + (r.orderCount || 0), 0)
    const revenue = periodRecords.reduce((sum, r) => sum + (r.revenue || 0), 0)
    const averageOrderValue = orderCount > 0 ? (revenue / orderCount) : 0

    return {
      orderCount,
      revenue,
      averageOrderValue,
      periodLabel,
      records: periodRecords // 保留记录以便进一步分析
    }
  } catch (error) {
    console.error('读取财务报表数据失败:', error)
    return {
      orderCount: 0,
      revenue: 0,
      averageOrderValue: 0,
      periodLabel: scheduleForm.value.period === 'week' ? '本周' : '本月'
    }
  }
}

const generateSchedule = async () => {
  generating.value = true
  try {
    // 从财务报表获取订单数据
    const financialData = await getFinancialData()

    if (!financialData) {
      ElMessage.error('获取财务报表数据失败')
      return
    }

    // 构建更详细的数据上下文
    const dataContext = `
${financialData.periodLabel}财务数据：
- 订单数量：${financialData.orderCount}单
- 总营收：¥${financialData.revenue.toFixed(2)}
- 平均客单价：¥${financialData.averageOrderValue.toFixed(2)}
- 日期范围：${financialData.periodLabel}
`

    const prompt = `你是山海造物标本艺术馆的人力资源管理专家，擅长排班优化和人力成本控制。

${dataContext}

排班需求：
- 排班周期：${financialData.periodLabel}
- 店员数量：${scheduleForm.value.staffCount}人

请基于以上财务数据，生成一份专业的智能排班方案，包含：
1. **每日排班建议**（考虑客流高峰时段，根据订单数据分布优化）
2. **人力配置优化**（根据${financialData.periodLabel}的订单量和营收情况，合理配置人力）
3. **排班成本分析**（估算排班成本，对比营收分析投入产出比）
4. **人员效率提升建议**（基于当前数据，提出提升人效的具体建议）

如果订单数据为0或较低，请特别说明在淡季/低客流情况下的排班策略。`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是人力资源管理专家，擅长基于财务数据做排班优化和人力成本控制。你会根据订单数据和营收情况，提供专业的排班建议。',
      temperature: 0.8,
      maxOutputTokens: 3000
    })
    
    scheduleResult.value = marked.parse(response)
  } catch (error) {
    console.error('生成排班方案失败:', error)
    ElMessage.error('生成失败：' + (error.message || '未知错误'))
  } finally {
    generating.value = false
  }
}

const optimizeCost = async () => {
  optimizing.value = true
  try {
    // 从财务报表获取数据
    const financialData = await getFinancialData()
    
    // 读取财务系统设置，获取人力成本相关参数
    const settingsRaw = localStorage.getItem('sc_finance_v12')
    const financeSettings = settingsRaw ? JSON.parse(settingsRaw).settings : {}
    const staffSalary = financeSettings.staffSalary || 5000 // 默认月薪5000
    const staffCount = scheduleForm.value.staffCount

    const dataContext = `
${financialData.periodLabel}财务数据：
- 订单数量：${financialData.orderCount}单
- 总营收：¥${financialData.revenue.toFixed(2)}
- 平均客单价：¥${financialData.averageOrderValue.toFixed(2)}
- 店员数量：${staffCount}人
- 人均月薪：¥${staffSalary}（参考值）
`

    const prompt = `你是山海造物标本艺术馆的人力成本优化专家。

${dataContext}

请基于以上数据，提供专业的人力成本优化分析，包含：
1. **人力成本结构分析**（基于${financialData.periodLabel}的订单量和营收，分析人力成本占比）
2. **优化排班降低成本**（提出具体的排班优化方案，在不影响服务质量的前提下降低成本）
3. **提升人效的建议**（基于平均客单价和订单量，提出提升人均产出的具体措施）
4. **成本节约方案**（给出可执行的成本节约建议，包括排班、激励、培训等方面）

如果营收较低或订单较少，请特别说明如何通过优化排班和提升效率来控制成本。`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是人力成本优化专家，擅长基于财务数据分析人力成本结构，提供优化建议。',
      temperature: 0.8,
      maxOutputTokens: 3000
    })
    
    costResult.value = marked.parse(response)
  } catch (error) {
    console.error('分析人力成本失败:', error)
    ElMessage.error('分析失败：' + (error.message || '未知错误'))
  } finally {
    optimizing.value = false
  }
}
</script>

<style scoped>
.staff-optimize-ai {
  padding: 24px;
  background: #000;
  color: #e0e0e0;
  min-height: 400px;
}

.ai-header h3 {
  color: #d4af37;
  margin: 0 0 8px 0;
}

.subtitle {
  color: #888;
  margin: 0 0 24px 0;
}

.ai-sections {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section-card {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 12px;
  padding: 20px;
}

.section-card h4 {
  color: #d4af37;
  margin: 0 0 16px 0;
}

.result-content {
  margin-top: 16px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  color: #e0e0e0;
  line-height: 1.8;
}

:deep(.el-form-item__label) {
  color: #e0e0e0 !important;
}

:deep(.el-input__wrapper),
:deep(.el-select .el-input__wrapper) {
  background: #000 !important;
  border-color: rgba(212, 175, 55, 0.2) !important;
}

:deep(.el-input__inner),
:deep(.el-select .el-input__inner) {
  color: #fff !important;
}

:deep(.el-button) {
  background: #000 !important;
  border-color: rgba(212, 175, 55, 0.3) !important;
  color: #fff !important;
}

:deep(.el-button:hover:not(:disabled)) {
  background: rgba(212, 175, 55, 0.1) !important;
  border-color: #d4af37 !important;
  color: #d4af37 !important;
}
</style>


