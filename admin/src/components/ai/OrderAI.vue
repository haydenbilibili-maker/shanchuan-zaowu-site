<template>
  <div class="order-ai">
    <div class="ai-header">
      <h3>🤖 AI订单助手</h3>
      <p class="subtitle">智能发货建议 · 异常检测 · 客服处理建议</p>
    </div>

    <div class="ai-tabs">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="智能发货" name="shipping">
          <div class="tab-content">
            <el-button 
              type="primary" 
              @click="analyzeShipping" 
              :loading="analyzingShipping"

            >
              <el-icon><Box /></el-icon>
              分析发货建议
            </el-button>
            <div v-if="shippingResult" class="result-card">
              <div class="result-content" v-html="shippingResult"></div>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="异常检测" name="anomaly">
          <div class="tab-content">
            <el-button 
              type="primary" 
              @click="detectAnomalies" 
              :loading="detectingAnomalies"

            >
              <el-icon><WarningFilled /></el-icon>
              检测异常订单
            </el-button>
            <div v-if="anomaliesResult" class="result-card">
              <div class="result-content" v-html="anomaliesResult"></div>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="客服建议" name="service">
          <div class="tab-content">
            <el-select 
              v-model="selectedOrderId" 
              placeholder="选择需要处理的订单"
              style="width: 100%; margin-bottom: 16px;"
              filterable
            >
              <el-option
                v-for="order in pendingOrders"
                :key="order._id"
                :label="`${order._id.substring(0, 8)}... - ¥${formatPrice(order.totalPrice ?? order.price)} - ${order.address?.name || '未知'}`"
                :value="order._id"
              />
            </el-select>
            <el-button 
              type="primary" 
              @click="getServiceAdvice" 
              :loading="gettingAdvice"
              :disabled="!selectedOrderId"

            >
              <el-icon><Service /></el-icon>
              获取处理建议
            </el-button>
            <div v-if="serviceAdvice" class="result-card">
              <div class="result-content" v-html="serviceAdvice"></div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Box, WarningFilled, Service } from '@element-plus/icons-vue'
import { callGeminiAPI } from '../../utils/aiHelper'
import { marked } from 'marked'

const props = defineProps({
  orders: {
    type: Array,
    default: () => []
  },
  pendingOrders: {
    type: Array,
    default: () => []
  }
})

const activeTab = ref('shipping')
const analyzingShipping = ref(false)
const detectingAnomalies = ref(false)
const gettingAdvice = ref(false)
const shippingResult = ref('')
const anomaliesResult = ref('')
const serviceAdvice = ref('')
const selectedOrderId = ref('')

/** CDN/CloudBase 订单金额可能是 string，统一转为 number */
function toPriceNum(val, fallback = 0) {
  const n = parseFloat(String(val ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : fallback
}

function formatPrice(val) {
  return toPriceNum(val).toFixed(2)
}

// 智能发货分析
const analyzeShipping = async () => {
  analyzingShipping.value = true
  try {
    const paidOrders = props.orders.filter(o => o.status === 'paid')
    if (paidOrders.length === 0) {
      ElMessage.warning('暂无待发货订单')
      analyzingShipping.value = false
      return
    }

    // 统计订单信息
    const ordersInfo = paidOrders.slice(0, 20).map(order => {
      const totalQty = order.products?.reduce((sum, p) => sum + (p.quantity || 1), 0) || 1
      const totalPrice = toPriceNum(order.totalPrice ?? order.price)
      const avgPrice = totalPrice / totalQty
      return {
        id: order._id.substring(0, 8),
        totalPrice,
        quantity: totalQty,
        avgPrice: avgPrice,
        province: order.address?.province || '未知',
        city: order.address?.city || '未知',
        products: order.products?.map(p => p.title).join('、') || ''
      }
    })

    const prompt = `作为物流配送专家，请分析以下待发货订单，提供智能发货建议：

待发货订单信息（共${paidOrders.length}单）：
${ordersInfo.map(o => `
订单${o.id}：
- 金额：¥${formatPrice(o.totalPrice)}
- 商品数量：${o.quantity}件
- 平均单价：¥${formatPrice(o.avgPrice)}
- 收货地址：${o.province}${o.city}
- 商品：${o.products}
`).join('\n')}

请提供：
1. 根据地址分布，推荐最适合的物流公司（顺丰速运、中通快递、圆通速递、EMS、京东物流等）
2. 优先级排序建议（哪些订单应优先发货）
3. 批量发货优化建议（是否可以合并配送）
4. 特殊订单提醒（高价值、偏远地区等）
5. 发货时效建议

请以清晰的格式输出建议，包含具体订单号和推荐物流公司。`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位经验丰富的物流配送专家，擅长根据订单特征和地址信息选择最佳物流方案，优化发货流程和成本。',
      temperature: 0.7
    })
    
    shippingResult.value = marked.parse(response)
  } catch (error) {
    console.error('[OrderAI] 发货分析失败:', error)
    ElMessage.error('分析失败：' + (error.message || '未知错误'))
  } finally {
    analyzingShipping.value = false
  }
}

// 异常订单检测
const detectAnomalies = async () => {
  detectingAnomalies.value = true
  try {
    const allOrders = props.orders
    if (allOrders.length === 0) {
      ElMessage.warning('暂无订单数据')
      detectingAnomalies.value = false
      return
    }

    // 统计订单特征
    const ordersData = allOrders.slice(0, 50).map(order => {
      const timeSinceCreated = Date.now() - order.createTime
      const hoursSinceCreated = Math.floor(timeSinceCreated / (1000 * 60 * 60))
      
      return {
        id: order._id.substring(0, 8),
        status: order.status,
        totalPrice: toPriceNum(order.totalPrice ?? order.price),
        createTime: new Date(order.createTime).toLocaleString(),
        hoursSinceCreated,
        phone: order.address?.phone || '',
        name: order.address?.name || '',
        address: `${order.address?.province || ''}${order.address?.city || ''}`,
        productCount: order.products?.length || 0
      }
    })

    // 检测重复订单（相同手机号短时间内多次下单）
    const phoneCounts = {}
    ordersData.forEach(o => {
      if (o.phone) {
        phoneCounts[o.phone] = (phoneCounts[o.phone] || 0) + 1
      }
    })

    const prompt = `作为订单风控专家，请分析以下订单数据，检测异常订单：

订单数据（最近${allOrders.length}单）：
${ordersData.map(o => `
订单${o.id}：
- 状态：${o.status}
- 金额：¥${formatPrice(o.totalPrice)}
- 下单时间：${o.createTime}（${o.hoursSinceCreated}小时前）
- 收货人：${o.name}
- 手机号：${o.phone}
- 地址：${o.address}
- 商品数：${o.productCount}件
`).join('\n')}

重复下单统计：
${Object.entries(phoneCounts)
  .filter(([phone, count]) => count > 1)
  .map(([phone, count]) => `- ${phone}：${count}次`)
  .join('\n') || '无重复下单'}

请检测以下异常情况：
1. 可疑订单（异常高额、异常低价、重复下单等）
2. 异常地址（地址格式异常、偏远地区高价值订单等）
3. 异常时间（深夜下单、异常频繁下单等）
4. 需要人工审核的订单
5. 风险提示和建议处理方式

请列出具体的异常订单编号和原因分析。`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位订单风控专家，擅长识别可疑订单和异常交易模式，保护商家免受欺诈和损失。',
      temperature: 0.6
    })
    
    anomaliesResult.value = marked.parse(response)
  } catch (error) {
    console.error('[OrderAI] 异常检测失败:', error)
    ElMessage.error('检测失败：' + (error.message || '未知错误'))
  } finally {
    detectingAnomalies.value = false
  }
}

// 客服处理建议
const getServiceAdvice = async () => {
  if (!selectedOrderId.value) {
    ElMessage.warning('请先选择订单')
    return
  }

  gettingAdvice.value = true
  try {
    const order = props.pendingOrders.find(o => o._id === selectedOrderId.value)
    if (!order) {
      ElMessage.error('订单不存在')
      gettingAdvice.value = false
      return
    }

    const prompt = `作为客服处理专家，请为以下订单提供专业的处理建议：

订单信息：
- 订单号：${order._id}
- 订单状态：${order.status}
- 订单金额：¥${formatPrice(order.totalPrice ?? order.price)}
- 下单时间：${new Date(order.createTime).toLocaleString()}
- 收货人：${order.address?.name || '未知'}
- 手机号：${order.address?.phone || '未知'}
- 收货地址：${order.address?.province || ''}${order.address?.city || ''}${order.address?.detail || ''}

商品信息：
${order.products?.map((p, i) => `${i + 1}. ${p.title} x${p.quantity || 1}`).join('\n') || '无'}

${order.status === 'refunding' ? `
这是一个退款申请订单，请提供：
1. 退款原因分析（可能的原因）
2. 是否应该同意退款的建议
3. 如果同意退款，处理流程建议
4. 如果拒绝退款，拒绝理由和沟通话术
5. 如何预防类似退款的发生
` : order.status === 'paid' ? `
这是一个待发货订单，请提供：
1. 发货前的检查清单
2. 客服跟进建议（是否需要主动联系客户）
3. 特殊情况处理（如地址不清、联系方式异常等）
4. 如何提升客户满意度
` : `
这是一个${order.status}状态的订单，请提供：
1. 当前状态的处理建议
2. 可能的后续问题和应对方案
3. 如何提升客户体验
4. 风险提示
`}

请提供专业、具体的处理建议和话术模板。`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位专业的客服处理专家，擅长处理各种订单问题，提供专业的客服话术和处理流程建议，既能维护客户关系，又能保护商家利益。',
      temperature: 0.8
    })
    
    serviceAdvice.value = marked.parse(response)
  } catch (error) {
    console.error('[OrderAI] 获取建议失败:', error)
    ElMessage.error('获取建议失败：' + (error.message || '未知错误'))
  } finally {
    gettingAdvice.value = false
  }
}
</script>

<style scoped>
.order-ai {
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

