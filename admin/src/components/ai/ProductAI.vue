<template>
  <div class="product-ai">
    <div class="ai-header">
      <h3>🤖 AI商品助手</h3>
      <p class="subtitle">智能定价 · 库存优化 · 商品推荐</p>
    </div>

    <div class="ai-tabs">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="智能定价" name="pricing">
          <div class="tab-content">
            <el-select 
              v-model="selectedProductId" 
              placeholder="选择需要定价建议的商品"
              style="width: 100%; margin-bottom: 16px;"
              filterable
            >
              <el-option
                v-for="product in products"
                :key="product._id"
                :label="`${product.title} - 当前价: ¥${product.price} - 成本: ¥${product.costPrice || 0}`"
                :value="product._id"
              />
            </el-select>
            <el-button 
              type="primary" 
              @click="getPricingAdvice" 
              :loading="gettingPricing"
              :disabled="!selectedProductId"

            >
              <el-icon><Money /></el-icon>
              获取定价建议
            </el-button>
            <div v-if="pricingAdvice" class="result-card">
              <div class="result-content" v-html="pricingAdvice"></div>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="库存优化" name="inventory">
          <div class="tab-content">
            <el-button 
              type="primary" 
              @click="analyzeInventory" 
              :loading="analyzingInventory"

            >
              <el-icon><Box /></el-icon>
              分析库存状况
            </el-button>
            <div v-if="inventoryResult" class="result-card">
              <div class="result-content" v-html="inventoryResult"></div>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="商品推荐" name="recommendation">
          <div class="tab-content">
            <el-button 
              type="primary" 
              @click="getRecommendations" 
              :loading="gettingRecommendations"

            >
              <el-icon><Star /></el-icon>
              获取商品推荐
            </el-button>
            <div v-if="recommendations" class="result-card">
              <div class="result-content" v-html="recommendations"></div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Money, Box, Star } from '@element-plus/icons-vue'
import { callGeminiAPI } from '../../utils/aiHelper'
import { marked } from 'marked'

const props = defineProps({
  products: {
    type: Array,
    default: () => []
  }
})

const activeTab = ref('pricing')
const gettingPricing = ref(false)
const analyzingInventory = ref(false)
const gettingRecommendations = ref(false)
const pricingAdvice = ref('')
const inventoryResult = ref('')
const recommendations = ref('')
const selectedProductId = ref('')

// 获取定价建议
const getPricingAdvice = async () => {
  if (!selectedProductId.value) {
    ElMessage.warning('请先选择商品')
    return
  }

  gettingPricing.value = true
  try {
    const product = props.products.find(p => p._id === selectedProductId.value)
    if (!product) {
      ElMessage.error('商品不存在')
      gettingPricing.value = false
      return
    }

    // 获取同类商品的价格信息
    const sameCategoryProducts = props.products.filter(p => 
      p.category === product.category && p._id !== product._id
    )
    const categoryPrices = sameCategoryProducts.map(p => p.price)
    const avgCategoryPrice = categoryPrices.length > 0 
      ? categoryPrices.reduce((sum, p) => sum + p, 0) / categoryPrices.length 
      : product.price

    const prompt = `作为商品定价专家，请为以下商品提供专业的定价建议：

商品信息：
- 商品名称：${product.title}
- 当前售价：¥${product.price}
- 进货成本：¥${product.costPrice || '未知'}
- 商品分类：${product.category}
- 当前库存：${product.stock}件
- 是否上架：${product.isOnShelf ? '是' : '否'}
${product.description ? `- 商品描述：${product.description.substring(0, 200)}` : ''}

同类商品价格参考：
${sameCategoryProducts.length > 0 ? `
- 同类商品数量：${sameCategoryProducts.length}件
- 同类商品平均价格：¥${avgCategoryPrice.toFixed(2)}
- 同类商品价格范围：¥${Math.min(...categoryPrices).toFixed(2)} - ¥${Math.max(...categoryPrices).toFixed(2)}
` : '- 暂无同类商品数据'}

请提供：
1. 基于成本、市场价、库存状态的定价建议（给出具体价格范围）
2. 定价策略分析（高价策略、中价策略、低价策略的利弊）
3. 促销定价建议（如限时折扣、满减等）
4. 动态定价建议（根据库存、销量调整价格）
5. 利润率分析（不同价格下的利润率）
6. 风险评估（价格过高或过低的风险）

请提供具体、可操作的建议。`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位资深的商品定价专家，擅长基于成本、市场、竞争和库存状况制定合理的定价策略，平衡利润和销量。',
      temperature: 0.7
    })
    
    pricingAdvice.value = marked.parse(response)
  } catch (error) {
    console.error('[ProductAI] 获取定价建议失败:', error)
    ElMessage.error('获取建议失败：' + (error.message || '未知错误'))
  } finally {
    gettingPricing.value = false
  }
}

// 分析库存状况
const analyzeInventory = async () => {
  analyzingInventory.value = true
  try {
    const totalProducts = props.products.length
    const lowStockProducts = props.products.filter(p => p.stock < 5 && p.stock > 0)
    const outOfStockProducts = props.products.filter(p => p.stock === 0)
    const onShelfProducts = props.products.filter(p => p.isOnShelf)
    const offShelfProducts = props.products.filter(p => !p.isOnShelf)

    // 计算库存价值
    const totalStockValue = props.products.reduce((sum, p) => 
      sum + (p.stock || 0) * (p.costPrice || 0), 0
    )
    const totalSalesValue = props.products.reduce((sum, p) => 
      sum + (p.stock || 0) * (p.price || 0), 0
    )

    const prompt = `作为库存管理专家，请分析以下商品库存状况，提供优化建议：

库存概况：
- 商品总数：${totalProducts}件
- 在售商品：${onShelfProducts.length}件
- 下架商品：${offShelfProducts.length}件
- 低库存商品（<5件）：${lowStockProducts.length}件
- 缺货商品：${outOfStockProducts.length}件
- 库存总成本：¥${totalStockValue.toFixed(2)}
- 库存总售价：¥${totalSalesValue.toFixed(2)}

低库存商品列表（前10个）：
${lowStockProducts.slice(0, 10).map(p => `
- ${p.title}：库存${p.stock}件，售价¥${p.price}，成本¥${p.costPrice || 0}
`).join('')}

缺货商品列表（前10个）：
${outOfStockProducts.slice(0, 10).map(p => `
- ${p.title}：已售罄，售价¥${p.price}
`).join('')}

请提供：
1. 库存健康度评估（整体库存状况评分和问题分析）
2. 补货建议（哪些商品需要立即补货，建议补货数量）
3. 滞销商品识别（长期未销售的商品）
4. 库存结构优化建议（商品品类分布是否合理）
5. 资金占用分析（库存资金占用是否合理）
6. 库存周转优化建议

请提供具体、可操作的建议，包含商品名称和具体数量。`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位库存管理专家，擅长库存分析、补货预测和库存优化，能够帮助商家维持合理的库存水平，避免缺货和积压。',
      temperature: 0.7
    })
    
    inventoryResult.value = marked.parse(response)
  } catch (error) {
    console.error('[ProductAI] 库存分析失败:', error)
    ElMessage.error('分析失败：' + (error.message || '未知错误'))
  } finally {
    analyzingInventory.value = false
  }
}

// 获取商品推荐
const getRecommendations = async () => {
  gettingRecommendations.value = true
  try {
    const onShelfProducts = props.products.filter(p => p.isOnShelf)
    const offShelfProducts = props.products.filter(p => !p.isOnShelf)
    
    // 按价格分组
    const priceGroups = {
      low: onShelfProducts.filter(p => p.price < 100),
      medium: onShelfProducts.filter(p => p.price >= 100 && p.price < 500),
      high: onShelfProducts.filter(p => p.price >= 500)
    }

    const prompt = `作为商品运营专家，请基于以下商品信息，提供商品推荐和运营建议：

商品概况：
- 在售商品：${onShelfProducts.length}件
- 下架商品：${offShelfProducts.length}件

价格分布：
- 低价商品（<100元）：${priceGroups.low.length}件
- 中价商品（100-500元）：${priceGroups.medium.length}件
- 高价商品（≥500元）：${priceGroups.high.length}件

在售商品列表（前20个）：
${onShelfProducts.slice(0, 20).map(p => `
- ${p.title}：¥${p.price}，库存${p.stock}件，分类：${p.category}
`).join('')}

${offShelfProducts.length > 0 ? `
下架商品列表（前10个）：
${offShelfProducts.slice(0, 10).map(p => `
- ${p.title}：¥${p.price}，库存${p.stock}件
`).join('')}
` : ''}

请提供：
1. 主推商品推荐（哪些商品应该重点推广，原因分析）
2. 促销商品推荐（哪些商品适合做促销活动）
3. 新品推荐建议（如有下架商品，哪些可以重新上架）
4. 商品组合推荐（哪些商品可以组合销售）
5. 商品定位建议（商品定价和定位是否合理）
6. 商品优化建议（如何提升商品吸引力）

请提供具体、可操作的建议，包含商品名称和具体策略。`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位商品运营专家，擅长商品推荐、组合销售和运营策略，能够帮助商家提升商品销量和客户满意度。',
      temperature: 0.8
    })
    
    recommendations.value = marked.parse(response)
  } catch (error) {
    console.error('[ProductAI] 获取推荐失败:', error)
    ElMessage.error('获取推荐失败：' + (error.message || '未知错误'))
  } finally {
    gettingRecommendations.value = false
  }
}
</script>

<style scoped>
.product-ai {
  padding: 20px;
  color: #333;
}

.ai-header {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 2px solid #eee;
}

.ai-header h3 {
  color: #d4af37;
  margin: 0 0 8px 0;
  font-size: 20px;
}

.subtitle {
  color: #666;
  margin: 0;
  font-size: 14px;
}

.ai-tabs {
  margin-top: 20px;
}

.tab-content {
  padding: 20px 0;
}

.result-card {
  margin-top: 24px;
  background: linear-gradient(135deg, rgba(212, 175, 55, 0.05) 0%, rgba(212, 175, 55, 0.02) 100%);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.result-content {
  line-height: 1.8;
  color: #333;
  font-size: 14px;
}

.result-content :deep(h1),
.result-content :deep(h2),
.result-content :deep(h3) {
  color: #d4af37;
  margin-top: 20px;
  margin-bottom: 12px;
}

.result-content :deep(h1) {
  font-size: 20px;
  border-bottom: 2px solid #d4af37;
  padding-bottom: 8px;
}

.result-content :deep(h2) {
  font-size: 18px;
}

.result-content :deep(h3) {
  font-size: 16px;
}

.result-content :deep(ul),
.result-content :deep(ol) {
  margin: 12px 0;
  padding-left: 24px;
}

.result-content :deep(li) {
  margin: 8px 0;
}

.result-content :deep(code) {
  background: rgba(212, 175, 55, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Monaco', 'Courier New', monospace;
  font-size: 13px;
}

.result-content :deep(strong) {
  color: #d4af37;
  font-weight: 600;
}

.result-content :deep(blockquote) {
  border-left: 4px solid #d4af37;
  padding-left: 16px;
  margin: 16px 0;
  color: #666;
  font-style: italic;
}
</style>

