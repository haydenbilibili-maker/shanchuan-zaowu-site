<template>
  <div class="customer-service-ai">
    <div class="ai-header">
      <h3>💬 客服智能助手</h3>
      <p class="subtitle">AI客服话术生成、问题解答与客户情绪分析</p>
    </div>

    <div class="ai-sections">
      <div class="section-card">
        <h4>📝 客服话术生成</h4>
        <el-input
          v-model="customerQuery"
          type="textarea"
          :rows="3"
          placeholder="输入客户问题或场景描述..."
          class="query-input"
        />
        <el-button type="primary" @click="generateResponse" :loading="generating" style="margin-top: 12px;">
          生成回复话术
        </el-button>
        <div v-if="responseResult" class="result-content" v-html="responseResult"></div>
      </div>

      <div class="section-card">
        <h4>❓ 常见问题解答</h4>
        <el-button type="primary" @click="generateFAQ" :loading="faqGenerating">
          生成常见问题库
        </el-button>
        <div v-if="faqResult" class="result-content" v-html="faqResult"></div>
      </div>

      <div class="section-card">
        <h4>😊 客户情绪分析</h4>
        <el-input
          v-model="customerText"
          type="textarea"
          :rows="3"
          placeholder="输入客户消息内容..."
          class="query-input"
        />
        <el-button type="primary" @click="analyzeEmotion" :loading="analyzing">
          分析客户情绪
        </el-button>
        <div v-if="emotionResult" class="result-content" v-html="emotionResult"></div>
      </div>
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

const customerQuery = ref('')
const customerText = ref('')
const generating = ref(false)
const faqGenerating = ref(false)
const analyzing = ref(false)
const responseResult = ref('')
const faqResult = ref('')
const emotionResult = ref('')

const generateResponse = async () => {
  if (!customerQuery.value.trim()) {
    ElMessage.warning('请输入客户问题')
    return
  }

  generating.value = true
  try {
    const prompt = `生成专业客服回复话术：
客户问题：${customerQuery.value}

请提供：
1. 专业、友好的回复话术
2. 处理建议
3. 可能的后续跟进话术`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是专业的客服专家，擅长用友好、专业的方式回复客户问题',
      temperature: 0.9
    })
    responseResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('生成失败：' + (error.message || '未知错误'))
  } finally {
    generating.value = false
  }
}

const generateFAQ = async () => {
  faqGenerating.value = true
  try {
    const prompt = `为标本艺术馆"山海造物"生成常见问题库：

请生成10-15个常见问题及专业回答，包括：
1. 产品相关问题（标本保存、展示等）
2. 购买相关问题（配送、退换货等）
3. 服务相关问题（课程、预约等）
4. 其他常见问题

每个问题需要：
- 清晰的问题描述
- 专业友好的回答
- 相关建议或提示`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是客户服务专家，擅长编写FAQ和客户问题解答',
      temperature: 0.8
    })
    faqResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('生成失败：' + (error.message || '未知错误'))
  } finally {
    faqGenerating.value = false
  }
}

const analyzeEmotion = async () => {
  if (!customerText.value.trim()) {
    ElMessage.warning('请输入客户消息内容')
    return
  }

  analyzing.value = true
  try {
    const prompt = `分析客户消息的情绪和意图：
客户消息：${customerText.value}

请提供：
1. 情绪分析（正面/中性/负面）
2. 情绪强度评估
3. 客户意图识别
4. 处理建议
5. 回复策略建议`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是客户情绪分析专家，擅长分析客户消息中的情绪和意图',
      temperature: 0.7
    })
    emotionResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('分析失败：' + (error.message || '未知错误'))
  } finally {
    analyzing.value = false
  }
}
</script>

<style scoped>
.customer-service-ai {
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




