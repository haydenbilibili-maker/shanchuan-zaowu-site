<template>
  <div class="customer-ai">
    <div class="ai-header">
      <h3>👥 客户画像分析</h3>
      <p class="subtitle">深度分析客户行为，生成精准用户画像</p>
    </div>

    <el-button type="primary" @click="analyzeCustomers" :loading="analyzing">
      分析客户画像
    </el-button>

    <div v-if="customerAnalysis" class="result-card">
      <div class="result-content" v-html="customerAnalysis"></div>
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
const customerAnalysis = ref('')

const analyzeCustomers = async () => {
  analyzing.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'week' })
    if (!data) {
      ElMessage.error('获取数据失败')
      return
    }

    const prompt = `基于以下客户数据，生成详细的客户画像分析：

客户数据：
- 总会员数：${data.members.total}
- 本周新增会员：${data.members.weeklyNew}
- 平均客单价：¥${data.finance.averageOrderValue.toFixed(2)}
- 本周订单数：${data.finance.weeklyOrdersCount}单

请提供：
1. 核心客户群体特征（年龄、性别、消费习惯等）
2. 客户消费行为分析
3. 客户价值分层（高价值、中价值、低价值）
4. 客户需求洞察
5. 个性化营销建议
6. 客户留存和复购策略`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位客户分析专家，擅长用户画像构建和客户行为分析',
      temperature: 0.8
    })
    customerAnalysis.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('分析失败：' + error.message)
  } finally {
    analyzing.value = false
  }
}
</script>

<style scoped>
.customer-ai {
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

.result-card {
  margin-top: 24px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 8px;
  padding: 24px;
}

.result-content {
  line-height: 1.8;
  color: #e0e0e0;
}
</style>

