<template>
  <div class="content-ai">
    <div class="ai-header">
      <h3>✍️ 内容创作助手</h3>
      <p class="subtitle">一键生成各类营销内容</p>
    </div>

    <el-form :model="contentForm" label-width="120px">
      <el-form-item label="内容类型">
        <el-select v-model="contentForm.type">
          <el-option label="小红书文案" value="xiaohongshu" />
          <el-option label="朋友圈文案" value="wechat" />
          <el-option label="产品描述" value="product" />
          <el-option label="活动海报文案" value="poster" />
          <el-option label="短视频脚本" value="video" />
        </el-select>
      </el-form-item>
      <el-form-item label="产品/主题">
        <el-input v-model="contentForm.topic" placeholder="输入产品名称或主题" />
      </el-form-item>
      <el-form-item label="风格要求">
        <el-input v-model="contentForm.style" placeholder="如：自然、文艺、专业等" />
      </el-form-item>
      <el-form-item label="特殊要求">
        <el-input v-model="contentForm.requirements" type="textarea" :rows="3" placeholder="其他特殊要求（可选）" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="generateContent" :loading="generating">
          生成内容
        </el-button>
        <el-button @click="regenerateContent" :disabled="!generatedContent">重新生成</el-button>
      </el-form-item>
    </el-form>

    <div v-if="generatedContent" class="result-box">
      <div class="result-header">
        <span>生成结果</span>
        <el-button size="small" @click="copyContent">复制</el-button>
      </div>
      <div class="result-content" v-html="generatedContent"></div>
    </div>

    <el-divider />

    <div class="constitution-test">
      <div class="ai-header">
        <h3>🛡️ 话术宪法自测</h3>
        <p class="subtitle">校验「标本不作主语」等规则（useContentAgents.constitutionCheck）</p>
      </div>
      <el-form label-width="100px">
        <el-form-item label="待检文案">
          <el-input v-model="constitutionText" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item>
          <el-button type="warning" :loading="constitutionLoading" @click="runConstitutionTest">
            话术宪法校验
          </el-button>
          <el-button link type="primary" @click="fillConstitutionSample">填入违规样例</el-button>
        </el-form-item>
      </el-form>
      <div v-if="constitutionResult" class="result-box constitution-result">
        <el-alert
          :type="constitutionResult.passed ? 'success' : 'error'"
          :title="constitutionResult.passed ? '通过话术宪法' : '未通过话术宪法'"
          :closable="false"
          show-icon
        />
        <div v-if="constitutionResult.violations?.length" class="cr-block">
          <div class="cr-label">违规项</div>
          <ul>
            <li v-for="(v, i) in constitutionResult.violations" :key="i">{{ v }}</li>
          </ul>
        </div>
        <div v-if="constitutionResult.rewritten" class="cr-block">
          <div class="cr-label">合规改写</div>
          <p>{{ constitutionResult.rewritten }}</p>
        </div>
        <div v-if="constitutionResult.ip_tone_ok === false" class="cr-hint">IP 调性未对齐</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { callGeminiAPI } from '../../utils/aiHelper'
import { useContentAgents } from '../../composables/useContentAgents'
import { marked } from 'marked'

const { constitutionCheck } = useContentAgents()

const props = defineProps({
  feature: Object
})

const generating = ref(false)
const generatedContent = ref('')
const constitutionLoading = ref(false)
const constitutionResult = ref(null)
const constitutionText = ref('这只北美君主蝶展翅10cm，今年新品，快抢')
const contentForm = ref({
  type: 'xiaohongshu',
  topic: '',
  style: '',
  requirements: ''
})

const generateContent = async () => {
  if (!contentForm.value.topic) {
    ElMessage.warning('请输入产品/主题')
    return
  }

  generating.value = true
  console.log('[ContentAI] 开始生成内容...', contentForm.value)
  try {
    const typeText = {
      xiaohongshu: '小红书种草文案',
      wechat: '朋友圈文案',
      product: '产品描述',
      poster: '活动海报文案',
      video: '短视频脚本'
    }[contentForm.value.type]

    const prompt = `请为"${contentForm.value.topic}"生成${typeText}。

${contentForm.value.style ? `风格要求：${contentForm.value.style}` : ''}
${contentForm.value.requirements ? `特殊要求：${contentForm.value.requirements}` : ''}

要求：
1. 吸引眼球，有记忆点
2. 突出产品特色和卖点
3. 符合${typeText}的写作风格和格式
4. 包含相关话题标签（如适用）
5. 长度适中，易于传播
6. 语言自然流畅，不生硬

请生成3个不同版本供选择，每个版本都要有独特的切入角度。`

    console.log('[ContentAI] 调用AI API...')
    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位资深的内容创作专家，擅长撰写各种营销文案，文笔自然流畅，富有创意',
      temperature: 0.9
    })
    console.log('[ContentAI] AI响应:', response)
    generatedContent.value = marked.parse(response)
    console.log('[ContentAI] 内容生成完成')
  } catch (error) {
    console.error('[ContentAI] 生成失败:', error)
    ElMessage.error('生成失败：' + (error.message || '未知错误'))
  } finally {
    generating.value = false
    console.log('[ContentAI] Loading状态已重置')
  }
}

const regenerateContent = () => {
  generateContent()
}

const copyContent = () => {
  const text = document.createElement('textarea')
  text.value = generatedContent.value.replace(/<[^>]*>/g, '')
  document.body.appendChild(text)
  text.select()
  document.execCommand('copy')
  document.body.removeChild(text)
  ElMessage.success('已复制到剪贴板')
}

const CONSTITUTION_SAMPLE = '这只北美君主蝶展翅10cm，今年新品，快抢'

function fillConstitutionSample() {
  constitutionText.value = CONSTITUTION_SAMPLE
}

async function runConstitutionTest() {
  if (!constitutionText.value.trim()) {
    ElMessage.warning('请输入待检文案')
    return
  }
  constitutionLoading.value = true
  constitutionResult.value = null
  try {
    const res = await constitutionCheck({
      mode: 'check',
      text: constitutionText.value,
      ip: 'GRAVITY',
      platform: 'xhs',
      category: '标本',
    })
    constitutionResult.value = res
    if (res.passed) {
      ElMessage.success('通过话术宪法')
    } else {
      ElMessage.warning('未通过话术宪法，请查看违规项与改写建议')
    }
  } catch (e) {
    ElMessage.error(e.message || '校验失败')
  } finally {
    constitutionLoading.value = false
  }
}
</script>

<style scoped>
.content-ai {
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

.result-box {
  margin-top: 24px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 8px;
  padding: 24px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  color: #d4af37;
  font-weight: 600;
}

.result-content {
  line-height: 1.8;
  color: #e0e0e0;
}

.constitution-test {
  margin-top: 8px;
}

.constitution-result {
  margin-top: 16px;
}

.cr-block {
  margin-top: 12px;
}

.cr-label {
  font-size: 12px;
  font-weight: 600;
  color: #d4af37;
  margin-bottom: 6px;
}

.cr-block p {
  margin: 0;
  line-height: 1.7;
  color: #e0e0e0;
}

.cr-block ul {
  margin: 0;
  padding-left: 1.2em;
  color: #f0c0b0;
  font-size: 13px;
  line-height: 1.6;
}

.cr-hint {
  margin-top: 8px;
  font-size: 12px;
  color: #c4a76c;
}

:deep(.el-form-item__label) {
  color: #ccc;
}

:deep(.el-input__inner),
:deep(.el-select .el-input__inner),
:deep(.el-textarea__inner) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(212, 175, 55, 0.3);
  color: #e0e0e0;
}
</style>

