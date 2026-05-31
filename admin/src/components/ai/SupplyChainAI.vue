<template>
  <div class="supply-chain-ai">
    <div class="ai-header">
      <h3>🚚 供应链优化AI</h3>
      <p class="subtitle">智能供应链分析与供应商管理优化</p>
    </div>

    <div class="ai-sections">
      <div class="section-card">
        <h4>📊 供应链效率分析</h4>
        <el-button type="primary" @click="analyzeSupplyChain" :loading="analyzing">
          分析供应链效率
        </el-button>
        <div v-if="analysisResult" class="result-content" v-html="analysisResult"></div>
      </div>

      <div class="section-card">
        <h4>💡 供应商优化建议</h4>
        <el-button type="primary" @click="optimizeSuppliers" :loading="optimizing">
          获取优化建议
        </el-button>
        <div v-if="optimizationResult" class="result-content" v-html="optimizationResult"></div>
      </div>

      <div class="section-card">
        <h4>💰 采购成本优化</h4>
        <el-button type="primary" @click="optimizeCost" :loading="costOptimizing">
          分析采购成本
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
import { fetchStoreData } from '../../utils/storeData'
import { marked } from 'marked'

const props = defineProps({
  feature: Object
})

const analyzing = ref(false)
const optimizing = ref(false)
const costOptimizing = ref(false)
const analysisResult = ref('')
const optimizationResult = ref('')
const costResult = ref('')

const analyzeSupplyChain = async () => {
  analyzing.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'month' })
    if (!data) {
      ElMessage.error('获取数据失败')
      return
    }

    const prompt = `分析门店供应链效率：
- 商品总数：${data.products.total}
- 低库存商品：${data.inventory.lowStock}件
- 缺货商品：${data.inventory.outOfStock}件

请提供：
1. 供应链效率评估
2. 采购周期分析
3. 库存周转效率
4. 供应链风险识别`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是供应链管理专家，擅长分析供应链效率和优化',
      temperature: 0.8
    })
    analysisResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('分析失败：' + (error.message || '未知错误'))
  } finally {
    analyzing.value = false
  }
}

const optimizeSuppliers = async () => {
  optimizing.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'month' })
    if (!data) {
      ElMessage.error('获取数据失败')
      return
    }

    const prompt = `提供供应商优化建议：
- 当前库存状况：低库存${data.inventory.lowStock}件，缺货${data.inventory.outOfStock}件

请提供：
1. 供应商选择建议
2. 采购策略优化
3. 供应商关系管理
4. 风险分散方案`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是供应商管理专家',
      temperature: 0.8
    })
    optimizationResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('分析失败：' + (error.message || '未知错误'))
  } finally {
    optimizing.value = false
  }
}

const optimizeCost = async () => {
  costOptimizing.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'month' })
    if (!data) {
      ElMessage.error('获取数据失败')
      return
    }

    const prompt = `分析采购成本优化机会：
- 库存总价值：¥${data.inventory.totalValue?.toFixed(2) || 0}
- 商品数量：${data.products.total}

请提供：
1. 采购成本结构分析
2. 批量采购优化建议
3. 成本降低策略
4. 预算规划建议`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是采购成本优化专家',
      temperature: 0.8
    })
    costResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('分析失败：' + (error.message || '未知错误'))
  } finally {
    costOptimizing.value = false
  }
}
</script>

<style scoped>
.supply-chain-ai {
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


