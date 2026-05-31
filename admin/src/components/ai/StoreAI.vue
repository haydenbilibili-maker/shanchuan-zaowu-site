<template>
  <div class="store-ai">
    <div class="ai-header">
      <h3>🏪 门店经营AI助手</h3>
      <p class="subtitle">全方位门店运营智能分析与建议</p>
    </div>

    <div class="ai-sections">
      <!-- 实时经营状况 -->
      <div class="section-card">
        <h4>📊 实时经营状况</h4>
        <el-button type="primary" @click="analyzeStoreStatus" :loading="analyzing">分析当前状况</el-button>
        <div v-if="storeAnalysis" class="analysis-result" v-html="storeAnalysis"></div>
      </div>

      <!-- 优化建议 -->
      <div class="section-card">
        <h4>💡 智能优化建议</h4>
        <el-button type="primary" @click="getOptimizationSuggestions" :loading="optimizing">获取建议</el-button>
        <div v-if="suggestions" class="suggestions-list" v-html="suggestions"></div>
      </div>

      <!-- 风险预警 -->
      <div class="section-card">
        <h4>⚠️ 风险预警</h4>
        <el-button type="primary" @click="checkRisks" :loading="checkingRisks">检查风险</el-button>
        <div v-if="risks" class="risks-list" v-html="risks"></div>
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

const analyzing = ref(false)
const optimizing = ref(false)
const checkingRisks = ref(false)
const storeAnalysis = ref('')
const suggestions = ref('')
const risks = ref('')

const analyzeStoreStatus = async () => {
  analyzing.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'week' })
    const prompt = `请分析门店当前经营状况，基于以下数据：

财务数据：
- 本周营收：¥${data?.finance?.weeklyRevenue || 0}
- 本周订单数：${data?.finance?.weeklyOrdersCount || 0}
- 平均客单价：¥${data?.finance?.averageOrderValue || 0}

库存数据：
- 总商品数：${data?.products?.total || 0}
- 低库存商品：${data?.inventory?.lowStock || 0}
- 缺货商品：${data?.inventory?.outOfStock || 0}

会员数据：
- 总会员数：${data?.members?.total || 0}
- 本周新增：${data?.members?.weeklyNew || 0}
- 活跃率：${data?.members?.activeRate || 0}%

请提供：
1. 经营状况评估
2. 关键指标分析
3. 亮点和问题
4. 改进方向`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位资深的门店运营专家，擅长数据分析和管理优化',
      temperature: 0.8
    })
    storeAnalysis.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('分析失败：' + error.message)
  } finally {
    analyzing.value = false
  }
}

const getOptimizationSuggestions = async () => {
  optimizing.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'week' })
    const prompt = `基于门店当前数据，请提供具体的优化建议：

当前数据：
- 营收：¥${data?.finance?.weeklyRevenue || 0}/周
- 订单：${data?.finance?.weeklyOrdersCount || 0}单/周
- 客单价：¥${data?.finance?.averageOrderValue || 0}
- 库存状况：低库存${data?.inventory?.lowStock || 0}件，缺货${data?.inventory?.outOfStock || 0}件

请提供：
1. 提升营收的具体措施
2. 优化库存管理的建议
3. 提升客单价的方法
4. 增强客户复购的策略
5. 每个建议都要具体可执行`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位门店运营优化专家，提供务实、可执行的建议',
      temperature: 0.9
    })
    suggestions.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('获取建议失败：' + error.message)
  } finally {
    optimizing.value = false
  }
}

const checkRisks = async () => {
  checkingRisks.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'week' })
    const prompt = `请分析门店当前存在的风险和问题：

数据情况：
- 营收趋势
- 库存状况
- 会员活跃度
- 订单情况

请识别：
1. 潜在风险点
2. 风险严重程度
3. 可能的影响
4. 应对措施`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位风险管理专家，擅长识别和评估经营风险',
      temperature: 0.7
    })
    risks.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('风险检查失败：' + error.message)
  } finally {
    checkingRisks.value = false
  }
}
</script>

<style scoped>
.store-ai {
  color: #e0e0e0;
}

.ai-header {
  margin-bottom: 24px;
}

.ai-header h3 {
  color: #d4af37;
  margin: 0 0 8px 0;
}

.subtitle {
  color: #888;
  margin: 0;
}

.ai-sections {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.section-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 8px;
  padding: 24px;
}

.section-card h4 {
  color: #d4af37;
  margin: 0 0 16px 0;
}

.analysis-result,
.suggestions-list,
.risks-list {
  margin-top: 16px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  line-height: 1.8;
  color: #e0e0e0;
}
</style>

