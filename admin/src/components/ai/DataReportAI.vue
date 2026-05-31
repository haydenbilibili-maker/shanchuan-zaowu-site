<template>
  <div class="data-report-ai">
    <div class="ai-header">
      <h3>📊 数据报告生成AI</h3>
      <p class="subtitle">一键生成经营数据报告、财务报告与运营分析报告</p>
    </div>

    <div class="ai-sections">
      <div class="section-card">
        <h4>📈 报告类型选择</h4>
        <el-form :model="reportForm" label-width="120px">
          <el-form-item label="报告类型">
            <el-select v-model="reportForm.type">
              <el-option label="经营数据报告" value="business" />
              <el-option label="财务分析报告" value="finance" />
              <el-option label="运营分析报告" value="operations" />
              <el-option label="综合报告" value="comprehensive" />
            </el-select>
          </el-form-item>
          <el-form-item label="时间范围">
            <el-select v-model="reportForm.period">
              <el-option label="本周" value="week" />
              <el-option label="本月" value="month" />
              <el-option label="本季度" value="quarter" />
              <el-option label="自定义" value="custom" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="generateReport" :loading="generating">
              生成报告
            </el-button>
          </el-form-item>
        </el-form>
        <div v-if="reportResult" class="result-content" v-html="reportResult"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { callGeminiAPI } from '../../utils/aiHelper'
import { fetchStoreData } from '../../utils/storeData'
import { marked } from 'marked'

const props = defineProps({
  feature: Object
})

const reportForm = ref({
  type: 'business',
  period: 'week'
})

const generating = ref(false)
const reportResult = ref('')

const generateReport = async () => {
  generating.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: reportForm.value.period })
    if (!data) {
      ElMessage.error('获取数据失败')
      return
    }

    const typeMap = {
      business: '经营数据报告',
      finance: '财务分析报告',
      operations: '运营分析报告',
      comprehensive: '综合报告'
    }

    const periodMap = {
      week: '本周',
      month: '本月',
      quarter: '本季度',
      custom: '指定时间段'
    }

    let prompt = `生成${periodMap[reportForm.value.period]}${typeMap[reportForm.value.type]}：

业务数据：
- 营收：¥${data.finance?.weeklyRevenue?.toFixed(2) || 0}（${reportForm.value.period === 'week' ? '本周' : '本月'}）
- 订单数：${data.finance?.weeklyOrdersCount || 0}单
- 平均客单价：¥${data.finance?.averageOrderValue?.toFixed(2) || 0}
- 商品总数：${data.products.total}
- 库存价值：¥${data.inventory?.totalValue?.toFixed(2) || 0}
- 会员总数：${data.members.total}
- 活跃会员：${data.members.active}（活跃率${data.members.activeRate}%）`

    if (reportForm.value.type === 'finance' || reportForm.value.type === 'comprehensive') {
      prompt += `

财务详细：
- 净利润（估）：¥${data.finance?.totalProfit?.toFixed(2) || 0}
- 毛利率：约55%`
    }

    if (reportForm.value.type === 'operations' || reportForm.value.type === 'comprehensive') {
      prompt += `

运营数据：
- 低库存商品：${data.inventory.lowStock}件
- 缺货商品：${data.inventory.outOfStock}件
- 活动总数：${data.activitiesData.total}
- 进行中活动：${data.activitiesData.active}`
    }

    prompt += `

请生成专业的${typeMap[reportForm.value.type]}，包括：
1. 执行摘要
2. 关键指标分析
3. 数据趋势分析
4. 问题识别
5. 改进建议
6. 下一步行动计划`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是数据分析报告专家，擅长生成专业、全面的数据报告',
      temperature: 0.7,
      maxOutputTokens: 4096
    })
    reportResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('生成失败：' + (error.message || '未知错误'))
  } finally {
    generating.value = false
  }
}
</script>

<style scoped>
.data-report-ai {
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
  max-height: 600px;
  overflow-y: auto;
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


