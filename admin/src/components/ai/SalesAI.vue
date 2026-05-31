<template>
  <div class="sales-ai">
    <div class="ai-header">
      <h3>📈 销售预测分析</h3>
      <p class="subtitle">基于数据的智能销售趋势预测</p>
    </div>

    <el-button type="primary" @click="forecastSales" :loading="forecasting">
      生成销售预测
    </el-button>

    <div v-if="forecastResult" class="result-card">
      <div class="result-content" v-html="forecastResult"></div>
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

const forecasting = ref(false)
const forecastResult = ref('')

const forecastSales = async () => {
  forecasting.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'week' })
    if (!data) {
      ElMessage.error('获取数据失败')
      return
    }

    const prompt = `基于以下销售数据，预测未来30天的销售趋势：

当前数据：
- 本周营收：¥${data.finance.weeklyRevenue.toFixed(2)}
- 本周订单数：${data.finance.weeklyOrdersCount}单
- 平均客单价：¥${data.finance.averageOrderValue.toFixed(2)}
- 总会员数：${data.members.total}
- 本周新增会员：${data.members.weeklyNew}

请提供：
1. 未来30天销售预测（按周分解）
2. 预测依据和假设
3. 关键影响因素分析
4. 风险提示
5. 提升销量的建议`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位销售预测专家，擅长基于历史数据和趋势进行销售预测',
      temperature: 0.7
    })
    forecastResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('预测失败：' + error.message)
  } finally {
    forecasting.value = false
  }
}
</script>

<style scoped>
.sales-ai {
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

