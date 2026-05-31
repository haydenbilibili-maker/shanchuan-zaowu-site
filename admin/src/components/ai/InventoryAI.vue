<template>
  <div class="inventory-ai">
    <div class="ai-header">
      <h3>📦 智能库存管理</h3>
      <p class="subtitle">AI驱动的库存分析与补货建议</p>
    </div>

    <div class="ai-actions">
      <el-button type="primary" @click="analyzeInventory" :loading="analyzing">
        分析库存状况
      </el-button>
      <el-button type="primary" @click="predictStockout" :loading="predicting">预测缺货风险</el-button>
      <el-button type="primary" @click="generateReplenishment" :loading="generating">生成补货建议</el-button>
    </div>

    <div v-if="analysisResult" class="result-card">
      <h4>📊 库存分析结果</h4>
      <div class="result-content" v-html="analysisResult"></div>
    </div>

    <div v-if="predictionResult" class="result-card">
      <h4>⚠️ 缺货风险预测</h4>
      <div class="result-content" v-html="predictionResult"></div>
    </div>

    <div v-if="replenishmentPlan" class="result-card">
      <h4>📋 补货建议</h4>
      <div class="result-content" v-html="replenishmentPlan"></div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { callGeminiAPI } from '../../utils/aiHelper'
import { marked } from 'marked'

const props = defineProps({
  products: {
    type: Array,
    default: () => []
  }
})

const analyzing = ref(false)
const predicting = ref(false)
const generating = ref(false)
const analysisResult = ref('')
const predictionResult = ref('')
const replenishmentPlan = ref('')

const analyzeInventory = async () => {
  analyzing.value = true
  try {
    console.log('[InventoryAI] 开始分析库存...')
    
    // 使用传入的商品数据
    const productsList = props.products || []
    if (productsList.length === 0) {
      ElMessage.warning('暂无商品数据，请先录入商品')
      analyzing.value = false
      return
    }

    // 计算库存统计
    const totalProducts = productsList.length
    const lowStockProducts = productsList.filter(p => p.stock > 0 && p.stock < 5)
    const outOfStockProducts = productsList.filter(p => !p.stock || p.stock === 0)
    const totalStock = productsList.reduce((sum, p) => sum + (p.stock || 0), 0)
    const avgStock = totalProducts > 0 ? totalStock / totalProducts : 0

    // 构建商品列表信息
    const lowStockList = lowStockProducts.slice(0, 10).map(p => `- ${p.title}（库存：${p.stock || 0}件，售价：¥${p.price || 0}）`).join('\n')
    const outOfStockList = outOfStockProducts.slice(0, 10).map(p => `- ${p.title}（售价：¥${p.price || 0}）`).join('\n')

    const prompt = `请分析门店库存状况：

库存数据统计：
- 总商品数：${totalProducts}件
- 总库存量：${totalStock}件
- 平均库存：${avgStock.toFixed(1)}件/商品
- 低库存商品（<5件）：${lowStockProducts.length}件
- 缺货商品：${outOfStockProducts.length}件

低库存商品列表：
${lowStockList || '暂无'}

缺货商品列表：
${outOfStockList || '暂无'}

请提供：
1. 库存健康度评估（优秀/良好/一般/预警）
2. 库存周转率分析
3. 库存结构问题识别
4. 针对性的优化建议（具体可操作的建议）
5. 需要优先处理的商品清单`

    console.log('[InventoryAI] 调用AI API...')
    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位库存管理专家，擅长库存分析和优化，能够提供具体可操作的建议',
      temperature: 0.8
    })
    console.log('[InventoryAI] AI响应:', response)
    analysisResult.value = marked.parse(response)
    console.log('[InventoryAI] 分析完成')
    ElMessage.success('库存分析完成')
  } catch (error) {
    console.error('[InventoryAI] 分析失败:', error)
    ElMessage.error('分析失败：' + (error.message || '未知错误'))
  } finally {
    analyzing.value = false
    console.log('[InventoryAI] Loading状态已重置')
  }
}

const predictStockout = async () => {
  predicting.value = true
  try {
    const productsList = props.products || []
    if (productsList.length === 0) {
      ElMessage.warning('暂无商品数据')
      predicting.value = false
      return
    }

    // 分析库存状况
    const lowStockProducts = productsList.filter(p => p.stock > 0 && p.stock < 5)
    const outOfStockProducts = productsList.filter(p => !p.stock || p.stock === 0)
    const criticalStock = productsList.filter(p => p.stock > 0 && p.stock < 3)

    // 构建风险商品列表
    const criticalList = criticalStock.slice(0, 10).map(p => `- ${p.title}（当前库存：${p.stock}件，售价：¥${p.price || 0}）`).join('\n')
    const lowStockList = lowStockProducts.slice(0, 10).map(p => `- ${p.title}（当前库存：${p.stock}件）`).join('\n')

    const prompt = `基于当前库存数据，预测哪些商品可能在近期缺货：

当前库存状况：
- 总商品数：${productsList.length}件
- 高风险商品（库存<3件）：${criticalStock.length}件
- 低库存商品（库存3-4件）：${lowStockProducts.length}件
- 已缺货商品：${outOfStockProducts.length}件

高风险商品列表：
${criticalList || '暂无'}

低库存商品列表：
${lowStockList || '暂无'}

请预测：
1. 未来7天内可能缺货的商品（按风险等级排序）
2. 每个商品的缺货风险等级（高/中/低）
3. 建议补货时间（紧急/本周/本月）
4. 紧急程度评估和原因分析
5. 缺货影响评估（对销售的影响）`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位库存预测专家，擅长基于当前库存数据预测缺货风险，能够提供准确的预测和紧急程度评估',
      temperature: 0.7
    })
    predictionResult.value = marked.parse(response)
    ElMessage.success('缺货风险预测完成')
  } catch (error) {
    console.error('[InventoryAI] 预测失败:', error)
    ElMessage.error('预测失败：' + (error.message || '未知错误'))
  } finally {
    predicting.value = false
  }
}

const generateReplenishment = async () => {
  generating.value = true
  try {
    const productsList = props.products || []
    if (productsList.length === 0) {
      ElMessage.warning('暂无商品数据')
      generating.value = false
      return
    }

    // 分析需要补货的商品
    const needReplenish = productsList.filter(p => !p.stock || p.stock < 5)
    const criticalNeed = productsList.filter(p => !p.stock || p.stock < 3)
    
    // 计算总价值和成本
    const totalValue = productsList.reduce((sum, p) => sum + ((p.price || 0) * (p.stock || 0)), 0)
    const avgPrice = productsList.reduce((sum, p) => sum + (p.price || 0), 0) / productsList.length
    const avgCostPrice = productsList.filter(p => p.costPrice).reduce((sum, p) => sum + (p.costPrice || 0), 0) / productsList.filter(p => p.costPrice).length || 0

    // 构建补货商品列表
    const criticalList = criticalNeed.slice(0, 15).map(p => {
      const currentStock = p.stock || 0
      const suggestedStock = Math.max(5, Math.ceil((p.price || avgPrice) / 100))
      return `- ${p.title}（当前库存：${currentStock}件，建议补至：${suggestedStock}件，成本价：¥${p.costPrice || avgCostPrice || 0}，售价：¥${p.price || 0}）`
    }).join('\n')

    const prompt = `请生成详细的补货建议：

当前库存状况：
- 总商品数：${productsList.length}件
- 急需补货商品（库存<3件或已缺货）：${criticalNeed.length}件
- 建议补货商品（库存<5件）：${needReplenish.length}件
- 平均售价：¥${avgPrice.toFixed(2)}
- 平均成本价：¥${avgCostPrice.toFixed(2)}

急需补货商品清单：
${criticalList || '暂无'}

请提供：
1. 优先补货商品清单（按紧急程度和重要性排序，列出前10个）
2. 每个商品的建议补货数量（考虑销售速度和安全库存）
3. 补货时间安排（立即/本周/本月）
4. 补货成本预估（基于成本价）
5. 预期收益分析（基于售价和预估销量）
6. 补货优先级说明`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位采购和库存管理专家，提供务实、可执行的补货建议，考虑成本、收益和紧急程度',
      temperature: 0.8
    })
    replenishmentPlan.value = marked.parse(response)
    ElMessage.success('补货建议生成完成')
  } catch (error) {
    console.error('[InventoryAI] 生成建议失败:', error)
    ElMessage.error('生成建议失败：' + (error.message || '未知错误'))
  } finally {
    generating.value = false
  }
}
</script>

<style scoped>
.inventory-ai {
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

.ai-actions {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.result-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 24px;
}

.result-card h4 {
  color: #d4af37;
  margin: 0 0 16px 0;
}

.result-content {
  line-height: 1.8;
  color: #e0e0e0;
}
</style>

