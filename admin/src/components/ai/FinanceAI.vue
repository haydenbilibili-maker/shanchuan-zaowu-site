<template>
  <div class="finance-ai">
    <div class="ai-header">
      <h3>💰 财务AI助手</h3>
      <p class="subtitle">智能财务分析与决策支持</p>
    </div>

    <div class="finance-tabs">
      <div 
        v-for="tab in tabs" 
        :key="tab.id"
        @click="activeTab = tab.id"
        :class="['tab-item', { active: activeTab === tab.id }]"
      >
        {{ tab.icon }} {{ tab.name }}
      </div>
    </div>

    <!-- 财务分析 -->
    <div v-if="activeTab === 'analysis'" class="analysis-section">
      <el-form :model="analysisForm" label-width="120px">
        <el-form-item label="分析类型">
          <el-select v-model="analysisForm.type">
            <el-option label="营收分析" value="revenue" />
            <el-option label="成本分析" value="cost" />
            <el-option label="利润分析" value="profit" />
            <el-option label="现金流分析" value="cashflow" />
            <el-option label="投资回报分析" value="roi" />
          </el-select>
        </el-form-item>
        <el-form-item label="时间范围">
          <el-date-picker
            v-model="analysisForm.dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="analyzeFinance" :loading="analyzing">
            开始分析
          </el-button>
        </el-form-item>
      </el-form>
      <div v-if="analysisResult" class="result-box" v-html="analysisResult"></div>
    </div>

    <!-- 财务预测 -->
    <div v-if="activeTab === 'forecast'" class="forecast-section">
      <el-form :model="forecastForm" label-width="120px">
        <el-form-item label="预测类型">
          <el-select v-model="forecastForm.type">
            <el-option label="营收预测" value="revenue" />
            <el-option label="成本预测" value="cost" />
            <el-option label="利润预测" value="profit" />
            <el-option label="现金流预测" value="cashflow" />
          </el-select>
        </el-form-item>
        <el-form-item label="预测周期">
          <el-select v-model="forecastForm.period">
            <el-option label="未来1个月" value="1m" />
            <el-option label="未来3个月" value="3m" />
            <el-option label="未来6个月" value="6m" />
            <el-option label="未来1年" value="1y" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="forecastFinance" :loading="forecasting">
            生成预测
          </el-button>
        </el-form-item>
      </el-form>
      <div v-if="forecastResult" class="result-box" v-html="forecastResult"></div>
    </div>

    <!-- 风险预警 -->
    <div v-if="activeTab === 'risk'" class="risk-section">
      <el-button type="primary" @click="checkRisks" :loading="checking">
        检查财务风险
      </el-button>
      <div v-if="riskResult" class="result-box" v-html="riskResult"></div>
    </div>

    <!-- 优化建议 -->
    <div v-if="activeTab === 'optimization'" class="optimization-section">
      <el-form :model="optimizationForm" label-width="120px">
        <el-form-item label="优化目标">
          <el-select v-model="optimizationForm.target">
            <el-option label="提升利润率" value="profit" />
            <el-option label="降低成本" value="cost" />
            <el-option label="改善现金流" value="cashflow" />
            <el-option label="提升投资回报" value="roi" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="optimizeFinance" :loading="optimizing">
            生成优化方案
          </el-button>
        </el-form-item>
      </el-form>
      <div v-if="optimizationResult" class="result-box" v-html="optimizationResult"></div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { callGeminiAPI } from '../../utils/aiHelper'
import { marked } from 'marked'
import { fetchStoreData } from '../../utils/storeData'

const props = defineProps({
  feature: Object
})

const activeTab = ref('analysis')
const analyzing = ref(false)
const forecasting = ref(false)
const checking = ref(false)
const optimizing = ref(false)

const analysisResult = ref('')
const forecastResult = ref('')
const riskResult = ref('')
const optimizationResult = ref('')

const tabs = [
  { id: 'analysis', name: '财务分析', icon: '📊' },
  { id: 'forecast', name: '财务预测', icon: '🔮' },
  { id: 'risk', name: '风险预警', icon: '⚠️' },
  { id: 'optimization', name: '优化建议', icon: '💡' }
]

const analysisForm = ref({
  type: 'revenue',
  dateRange: null
})

const forecastForm = ref({
  type: 'revenue',
  period: '3m'
})

const optimizationForm = ref({
  target: 'profit'
})

const analyzeFinance = async () => {
  analyzing.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'month' })
    if (!data) {
      ElMessage.error('获取财务数据失败')
      analyzing.value = false
      return
    }

    const typeText = {
      revenue: '营收',
      cost: '成本',
      profit: '利润',
      cashflow: '现金流',
      roi: '投资回报'
    }[analysisForm.value.type]

    const prompt = `作为财务分析专家，请对以下财务数据进行${typeText}分析：

财务数据：
- 周营收：¥${data.finance?.weeklyRevenue || 0}
- 周订单数：${data.finance?.weeklyOrdersCount || 0}
- 平均客单价：¥${data.finance?.averageOrderValue || 0}
- 总营收：¥${data.finance?.totalRevenue || 0}

${analysisForm.value.dateRange ? `时间范围：${analysisForm.value.dateRange[0]} 至 ${analysisForm.value.dateRange[1]}` : ''}

请提供：
1. 数据趋势分析
2. 关键指标解读
3. 异常情况识别
4. 改进建议`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位资深的财务分析专家，擅长财务数据分析和解读',
      temperature: 0.7,
    })
    analysisResult.value = marked.parse(response)
  } catch (error) {
    console.error('财务分析失败:', error)
    ElMessage.error('分析失败：' + (error.message || '未知错误'))
  } finally {
    analyzing.value = false
  }
}

const forecastFinance = async () => {
  forecasting.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'month' })
    if (!data) {
      ElMessage.error('获取财务数据失败')
      forecasting.value = false
      return
    }

    const periodText = {
      '1m': '未来1个月',
      '3m': '未来3个月',
      '6m': '未来6个月',
      '1y': '未来1年'
    }[forecastForm.value.period]

    const typeText = {
      revenue: '营收',
      cost: '成本',
      profit: '利润',
      cashflow: '现金流'
    }[forecastForm.value.type]

    const prompt = `作为财务预测专家，请基于以下历史数据，预测${periodText}的${typeText}：

历史数据：
- 周营收：¥${data.finance?.weeklyRevenue || 0}
- 周订单数：${data.finance?.weeklyOrdersCount || 0}
- 平均客单价：¥${data.finance?.averageOrderValue || 0}

请提供：
1. 预测结果（具体数值和趋势）
2. 预测依据和假设
3. 关键影响因素分析
4. 风险提示`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位财务预测专家，擅长基于历史数据进行财务预测',
      temperature: 0.7,
    })
    forecastResult.value = marked.parse(response)
  } catch (error) {
    console.error('财务预测失败:', error)
    ElMessage.error('预测失败：' + (error.message || '未知错误'))
  } finally {
    forecasting.value = false
  }
}

const checkRisks = async () => {
  checking.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'month' })
    if (!data) {
      ElMessage.error('获取财务数据失败')
      checking.value = false
      return
    }

    const prompt = `作为财务风险专家，请分析以下财务数据，识别潜在风险：

财务数据：
- 周营收：¥${data.finance?.weeklyRevenue || 0}
- 周订单数：${data.finance?.weeklyOrdersCount || 0}
- 平均客单价：¥${data.finance?.averageOrderValue || 0}
- 库存状况：低库存${data.inventory?.lowStock || 0}件，缺货${data.inventory?.outOfStock || 0}件

请识别：
1. 财务风险点
2. 风险等级评估
3. 风险原因分析
4. 应对措施建议`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位财务风险专家，擅长识别和分析财务风险',
      temperature: 0.7,
    })
    riskResult.value = marked.parse(response)
  } catch (error) {
    console.error('风险检查失败:', error)
    ElMessage.error('检查失败：' + (error.message || '未知错误'))
  } finally {
    checking.value = false
  }
}

const optimizeFinance = async () => {
  optimizing.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'month' })
    if (!data) {
      ElMessage.error('获取财务数据失败')
      optimizing.value = false
      return
    }

    const targetText = {
      profit: '提升利润率',
      cost: '降低成本',
      cashflow: '改善现金流',
      roi: '提升投资回报'
    }[optimizationForm.value.target]

    const prompt = `作为财务优化专家，请针对"${targetText}"目标，提供具体的优化方案：

当前财务数据：
- 周营收：¥${data.finance?.weeklyRevenue || 0}
- 周订单数：${data.finance?.weeklyOrdersCount || 0}
- 平均客单价：¥${data.finance?.averageOrderValue || 0}
- 库存状况：低库存${data.inventory?.lowStock || 0}件，缺货${data.inventory?.outOfStock || 0}件

请提供：
1. 优化目标设定
2. 具体优化措施（至少5条）
3. 预期效果评估
4. 实施步骤和时间表
5. 风险提示`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位财务优化专家，擅长提供财务优化方案',
      temperature: 0.8,
    })
    optimizationResult.value = marked.parse(response)
  } catch (error) {
    console.error('优化方案生成失败:', error)
    ElMessage.error('生成失败：' + (error.message || '未知错误'))
  } finally {
    optimizing.value = false
  }
}
</script>

<style scoped>
.finance-ai {
  padding: 24px;
  color: #e0e0e0;
}

.ai-header {
  margin-bottom: 24px;
}

.ai-header h3 {
  font-size: 24px;
  color: #d4af37;
  margin: 0 0 8px 0;
}

.subtitle {
  color: #888;
  margin: 0;
}

.finance-tabs {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  border-bottom: 1px solid rgba(212, 175, 55, 0.2);
}

.tab-item {
  padding: 12px 20px;
  cursor: pointer;
  color: #888;
  border-bottom: 2px solid transparent;
  transition: all 0.3s;
}

.tab-item:hover {
  color: #d4af37;
}

.tab-item.active {
  color: #d4af37;
  border-bottom-color: #d4af37;
}

.result-box {
  margin-top: 24px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 8px;
  color: #e0e0e0;
  line-height: 1.8;
}

.result-box :deep(p) {
  margin: 12px 0;
}

.result-box :deep(ul),
.result-box :deep(ol) {
  margin: 12px 0;
  padding-left: 24px;
}

.result-box :deep(li) {
  margin: 6px 0;
}

.result-box :deep(h3),
.result-box :deep(h4) {
  color: #d4af37;
  margin-top: 16px;
  margin-bottom: 8px;
}
</style>



