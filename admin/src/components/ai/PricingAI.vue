<template>
  <div class="pricing-ai">
    <div class="ai-header">
      <h3>💰 动态定价优化</h3>
      <p class="subtitle">AI驱动的智能定价策略</p>
    </div>

    <div class="pricing-form">
      <el-form :model="pricingForm" label-width="120px">
        <el-form-item label="商品名称">
          <el-input v-model="pricingForm.productName" placeholder="输入商品名称" />
        </el-form-item>
        <el-form-item label="当前价格">
          <el-input-number v-model="pricingForm.currentPrice" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="成本价格">
          <el-input-number v-model="pricingForm.costPrice" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="库存数量">
          <el-input-number v-model="pricingForm.stock" :min="0" />
        </el-form-item>
        <el-form-item label="销售目标">
          <el-select v-model="pricingForm.target">
            <el-option label="最大化利润" value="profit" />
            <el-option label="快速清仓" value="clearance" />
            <el-option label="提升销量" value="volume" />
            <el-option label="保持竞争力" value="competitive" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="optimizePricing" :loading="optimizing">
            生成定价建议
          </el-button>
        </el-form-item>
      </el-form>
    </div>

    <div v-if="pricingResult" class="result-card">
      <h4>💡 定价建议</h4>
      <div class="result-content" v-html="pricingResult"></div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { callGeminiAPI } from '../../utils/aiHelper'
import { marked } from 'marked'

const props = defineProps({
  feature: Object
})

const optimizing = ref(false)
const pricingResult = ref('')
const pricingForm = ref({
  productName: '',
  currentPrice: 0,
  costPrice: 0,
  stock: 0,
  target: 'profit'
})

const optimizePricing = async () => {
  if (!pricingForm.value.productName || !pricingForm.value.currentPrice) {
    ElMessage.warning('请填写商品信息')
    return
  }

  optimizing.value = true
  try {
    const targetText = {
      profit: '最大化利润',
      clearance: '快速清仓',
      volume: '提升销量',
      competitive: '保持竞争力'
    }[pricingForm.value.target]

    const prompt = `请为以下商品提供定价优化建议：

商品信息：
- 商品名称：${pricingForm.value.productName}
- 当前价格：¥${pricingForm.value.currentPrice}
- 成本价格：¥${pricingForm.value.costPrice}
- 当前库存：${pricingForm.value.stock}件
- 销售目标：${targetText}

请提供：
1. 最优定价建议（具体金额）
2. 定价理由分析
3. 预期销量和利润
4. 风险提示
5. 分阶段定价策略（如适用）`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位定价策略专家，擅长基于市场数据和商品特性制定最优定价',
      temperature: 0.8
    })
    pricingResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('生成建议失败：' + error.message)
  } finally {
    optimizing.value = false
  }
}
</script>

<style scoped>
.pricing-ai {
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

.pricing-form {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 24px;
}

.result-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 8px;
  padding: 24px;
}

.result-card h4 {
  color: #d4af37;
  margin: 0 0 16px 0;
}

.result-content {
  line-height: 1.8;
  color: #e0e0e0;
}

:deep(.el-form-item__label) {
  color: #ccc;
}

:deep(.el-input__inner),
:deep(.el-select .el-input__inner) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(212, 175, 55, 0.3);
  color: #e0e0e0;
}
</style>

