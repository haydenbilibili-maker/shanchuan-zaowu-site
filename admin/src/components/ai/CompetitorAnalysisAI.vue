<template>
  <div class="competitor-analysis-ai">
    <div class="ai-header">
      <h3>🔍 竞品分析助手</h3>
      <p class="subtitle">AI分析竞品策略，提供竞争洞察与差异化建议</p>
    </div>

    <div class="ai-sections">
      <div class="section-card">
        <h4>💰 竞品价格分析</h4>
        <el-input
          v-model="competitorInfo"
          type="textarea"
          :rows="4"
          placeholder="输入竞品信息：名称、价格、产品特点等..."
          class="query-input"
        />
        <el-button type="primary" @click="analyzePrice" :loading="analyzing" style="margin-top: 12px;">
          分析竞品价格
        </el-button>
        <div v-if="priceResult" class="result-content" v-html="priceResult"></div>
      </div>

      <div class="section-card">
        <h4>📢 竞品营销策略分析</h4>
        <el-button type="primary" @click="analyzeMarketing" :loading="marketingAnalyzing">
          分析营销策略
        </el-button>
        <div v-if="marketingResult" class="result-content" v-html="marketingResult"></div>
      </div>

      <div class="section-card">
        <h4>💡 差异化建议</h4>
        <el-button type="primary" @click="generateDifferentiation" :loading="differentiating">
          生成差异化策略
        </el-button>
        <div v-if="differentiationResult" class="result-content" v-html="differentiationResult"></div>
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

const competitorInfo = ref('')
const analyzing = ref(false)
const marketingAnalyzing = ref(false)
const differentiating = ref(false)
const priceResult = ref('')
const marketingResult = ref('')
const differentiationResult = ref('')

const analyzePrice = async () => {
  analyzing.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'month' })
    if (!data) {
      ElMessage.error('获取数据失败')
      return
    }

    const prompt = `分析竞品价格策略：
${competitorInfo.value || '请基于行业平均水平分析'}

当前业务数据：
- 平均客单价：¥${data.finance?.averageOrderValue?.toFixed(2) || 0}
- 商品总数：${data.products.total}
- 定价策略：标本艺术馆，高端定位

请提供：
1. 竞品价格对比分析
2. 价格优势/劣势
3. 定价建议
4. 价格竞争策略`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是市场分析专家，擅长竞品价格分析和定价策略',
      temperature: 0.8
    })
    priceResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('分析失败：' + (error.message || '未知错误'))
  } finally {
    analyzing.value = false
  }
}

const analyzeMarketing = async () => {
  marketingAnalyzing.value = true
  try {
    const prompt = `分析竞品营销策略：
${competitorInfo.value || '请基于标本艺术/自然教育行业分析'}

请提供：
1. 竞品营销渠道分析
2. 内容营销策略
3. 促销活动分析
4. 品牌定位对比`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是营销策略专家，擅长分析竞品营销策略',
      temperature: 0.8
    })
    marketingResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('分析失败：' + (error.message || '未知错误'))
  } finally {
    marketingAnalyzing.value = false
  }
}

const generateDifferentiation = async () => {
  differentiating.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'month' })
    const prompt = `生成差异化竞争策略：
当前业务：
- 品牌：山海造物标本艺术馆
- 定位：自然美学、手作体验、教育价值
- 目标人群：25-40岁新中产、自然爱好者、教育焦虑家长
${competitorInfo.value ? `\n竞品信息：\n${competitorInfo.value}` : ''}

请提供：
1. 核心竞争力识别
2. 差异化定位建议
3. 独特卖点提炼
4. 竞争策略建议`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是战略定位专家，擅长差异化竞争策略',
      temperature: 0.9
    })
    differentiationResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('生成失败：' + (error.message || '未知错误'))
  } finally {
    differentiating.value = false
  }
}
</script>

<style scoped>
.competitor-analysis-ai {
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

.query-input {
  width: 100%;
}

.result-content {
  margin-top: 16px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  color: #e0e0e0;
  line-height: 1.8;
}

:deep(.el-textarea__inner) {
  background: #000 !important;
  border-color: rgba(212, 175, 55, 0.2) !important;
  color: #fff !important;
}

:deep(.el-textarea__inner:focus) {
  border-color: rgba(212, 175, 55, 0.5) !important;
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


