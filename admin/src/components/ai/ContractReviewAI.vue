<template>
  <div class="contract-review-ai">
    <div class="ai-header">
      <h3>📄 合同智能审查AI</h3>
      <p class="subtitle">AI审查合同条款，识别风险点并提供修改建议</p>
    </div>

    <div class="ai-sections">
      <div class="section-card">
        <h4>📋 合同审查</h4>
        <el-input
          v-model="contractText"
          type="textarea"
          :rows="8"
          placeholder="粘贴合同内容..."
          class="contract-input"
        />
        <el-button type="primary" @click="reviewContract" :loading="reviewing" style="margin-top: 12px;">
          审查合同
        </el-button>
        <div v-if="reviewResult" class="result-content" v-html="reviewResult"></div>
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

const contractText = ref('')
const reviewing = ref(false)
const reviewResult = ref('')

const reviewContract = async () => {
  if (!contractText.value.trim()) {
    ElMessage.warning('请输入合同内容')
    return
  }

  reviewing.value = true
  try {
    const prompt = `审查以下合同内容，识别风险点并提供修改建议：

合同内容：
${contractText.value}

请提供：
1. 合同类型识别
2. 关键条款分析
3. 风险点识别（高风险/中风险/低风险）
4. 问题条款说明
5. 修改建议
6. 补充建议条款（如适用）
7. 整体评价`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是合同审查专家，擅长识别合同风险点和提供专业修改建议',
      temperature: 0.7,
      maxOutputTokens: 2048
    })
    reviewResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('审查失败：' + (error.message || '未知错误'))
  } finally {
    reviewing.value = false
  }
}
</script>

<style scoped>
.contract-review-ai {
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

.contract-input {
  width: 100%;
}

.result-content {
  margin-top: 16px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  color: #e0e0e0;
  line-height: 1.8;
  max-height: 600px;
  overflow-y: auto;
}

:deep(.el-textarea__inner) {
  background: #000 !important;
  border-color: rgba(212, 175, 55, 0.2) !important;
  color: #fff !important;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
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




