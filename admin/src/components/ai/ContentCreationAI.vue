<template>
  <div class="content-creation-ai">
    <div class="ai-header">
      <h3>✍️ AI内容创作助手</h3>
      <p class="subtitle">智能辅助文章和专题创作，提升内容质量与创作效率</p>
    </div>

    <el-tabs v-model="activeTab" class="ai-tabs">
      <!-- 专题创作 -->
      <el-tab-pane label="专题创作" name="exhibition">
        <el-form :model="exhibitionForm" label-width="120px">
          <el-form-item label="专题主题">
            <el-input 
              v-model="exhibitionForm.theme" 
              placeholder="如：昆虫的多样性、自然之美等"
              clearable
            />
          </el-form-item>
          <el-form-item label="风格定位">
            <el-select v-model="exhibitionForm.style" placeholder="选择风格" style="width: 100%">
              <el-option label="📖 学术专业" value="academic" />
              <el-option label="🎨 艺术鉴赏" value="artistic" />
              <el-option label="📚 科普教育" value="educational" />
              <el-option label="✨ 文艺唯美" value="literary" />
              <el-option label="🔬 科学严谨" value="scientific" />
            </el-select>
          </el-form-item>
          <el-form-item label="目标受众">
            <el-select v-model="exhibitionForm.audience" placeholder="选择受众" style="width: 100%">
              <el-option label="👨‍🎓 学生群体" value="students" />
              <el-option label="👨‍🔬 专业人士" value="professionals" />
              <el-option label="👨‍👩‍👧 普通大众" value="general" />
              <el-option label="🎨 艺术爱好者" value="art-lovers" />
            </el-select>
          </el-form-item>
          <el-form-item label="内容要点">
            <el-input 
              v-model="exhibitionForm.keyPoints" 
              type="textarea" 
              :rows="4"
              placeholder="请输入想要涵盖的内容要点，用逗号分隔。如：物种分类、生态习性、保护意义等"
            />
          </el-form-item>
          <el-form-item label="特殊要求">
            <el-input 
              v-model="exhibitionForm.requirements" 
              type="textarea" 
              :rows="3"
              placeholder="其他特殊要求（可选）"
            />
          </el-form-item>
          <el-form-item>
            <el-button 
              type="primary" 
              @click="generateExhibition" 
              :loading="generating.exhibition"

            >
              生成专题内容
            </el-button>
            <el-button @click="regenerate('exhibition')" :disabled="!exhibitionResult">
              重新生成
            </el-button>
          </el-form-item>
        </el-form>

        <div v-if="exhibitionResult" class="result-box">
          <div class="result-header">
            <span>生成结果</span>
            <div>
              <el-button size="small" @click="copyResult('exhibition')">复制全部</el-button>
              <el-button size="small" @click="applyToForm('exhibition')" type="primary">
                应用到表单
              </el-button>
            </div>
          </div>
          <div class="result-content" v-html="exhibitionResult"></div>
        </div>
      </el-tab-pane>

      <!-- 文章创作 -->
      <el-tab-pane label="文章创作" name="article">
        <el-form :model="articleForm" label-width="120px">
          <el-form-item label="文章主题">
            <el-input 
              v-model="articleForm.topic" 
              placeholder="如：蝴蝶的生命周期、标本制作技巧等"
              clearable
            />
          </el-form-item>
          <el-form-item label="文章分类">
            <el-select v-model="articleForm.category" placeholder="选择分类" style="width: 100%">
              <el-option label="📚 标本知识" value="knowledge" />
              <el-option label="🎨 艺术鉴赏" value="art" />
              <el-option label="🔧 制作工艺" value="craft" />
              <el-option label="📖 藏品故事" value="story" />
            </el-select>
          </el-form-item>
          <el-form-item label="文章风格">
            <el-select v-model="articleForm.style" placeholder="选择风格" style="width: 100%">
              <el-option label="📝 科普易懂" value="popular" />
              <el-option label="🎯 专业深入" value="professional" />
              <el-option label="✨ 故事化" value="narrative" />
              <el-option label="📊 数据驱动" value="data-driven" />
            </el-select>
          </el-form-item>
          <el-form-item label="文章长度">
            <el-radio-group v-model="articleForm.length">
              <el-radio label="short">短篇（500-800字）</el-radio>
              <el-radio label="medium">中篇（1000-1500字）</el-radio>
              <el-radio label="long">长篇（2000-3000字）</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="内容大纲">
            <el-input 
              v-model="articleForm.outline" 
              type="textarea" 
              :rows="4"
              placeholder="请输入文章大纲或想要涵盖的内容点，用换行分隔。如：引言、主要内容、总结等"
            />
          </el-form-item>
          <el-form-item label="特殊要求">
            <el-input 
              v-model="articleForm.requirements" 
              type="textarea" 
              :rows="3"
              placeholder="其他特殊要求（可选）"
            />
          </el-form-item>
          <el-form-item>
            <el-button 
              type="primary" 
              @click="generateArticle" 
              :loading="generating.article"

            >
              生成文章内容
            </el-button>
            <el-button @click="regenerate('article')" :disabled="!articleResult">
              重新生成
            </el-button>
          </el-form-item>
        </el-form>

        <div v-if="articleResult" class="result-box">
          <div class="result-header">
            <span>生成结果</span>
            <div>
              <el-button size="small" @click="copyResult('article')">复制全部</el-button>
              <el-button size="small" @click="applyToForm('article')" type="primary">
                应用到表单
              </el-button>
            </div>
          </div>
          <div class="result-content" v-html="articleResult"></div>
        </div>
      </el-tab-pane>

      <!-- 内容优化 -->
      <el-tab-pane label="内容优化" name="optimize">
        <el-form :model="optimizeForm" label-width="120px">
          <el-form-item label="原始内容">
            <el-input 
              v-model="optimizeForm.content" 
              type="textarea" 
              :rows="10"
              placeholder="请粘贴需要优化的内容"
            />
          </el-form-item>
          <el-form-item label="优化方向">
            <el-checkbox-group v-model="optimizeForm.directions">
              <el-checkbox label="readability">提升可读性</el-checkbox>
              <el-checkbox label="structure">优化结构</el-checkbox>
              <el-checkbox label="language">润色语言</el-checkbox>
              <el-checkbox label="engagement">增强吸引力</el-checkbox>
              <el-checkbox label="seo">SEO优化</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item label="目标风格">
            <el-select v-model="optimizeForm.targetStyle" placeholder="选择目标风格" style="width: 100%">
              <el-option label="简洁明了" value="concise" />
              <el-option label="生动有趣" value="vivid" />
              <el-option label="专业严谨" value="professional" />
              <el-option label="文艺优雅" value="elegant" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button 
              type="primary" 
              @click="optimizeContent" 
              :loading="generating.optimize"

            >
              优化内容
            </el-button>
          </el-form-item>
        </el-form>

        <div v-if="optimizeResult" class="result-box">
          <div class="result-header">
            <span>优化结果</span>
            <el-button size="small" @click="copyResult('optimize')">复制全部</el-button>
          </div>
          <div class="result-content" v-html="optimizeResult"></div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { callGeminiAPI } from '../../utils/aiHelper'
import { marked } from 'marked'

const emit = defineEmits(['apply-content'])

const activeTab = ref('exhibition')

// 表单数据
const exhibitionForm = ref({
  theme: '',
  style: 'literary',
  audience: 'general',
  keyPoints: '',
  requirements: ''
})

const articleForm = ref({
  topic: '',
  category: 'knowledge',
  style: 'popular',
  length: 'medium',
  outline: '',
  requirements: ''
})

const optimizeForm = ref({
  content: '',
  directions: ['readability', 'structure'],
  targetStyle: 'concise'
})

// 生成状态
const generating = ref({
  exhibition: false,
  article: false,
  optimize: false
})

// 生成结果
const exhibitionResult = ref('')
const articleResult = ref('')
const optimizeResult = ref('')

// 生成专题内容
const generateExhibition = async () => {
  if (!exhibitionForm.value.theme) {
    ElMessage.warning('请输入专题主题')
    return
  }

  generating.value.exhibition = true
  try {
    const styleMap = {
      academic: '学术专业',
      artistic: '艺术鉴赏',
      educational: '科普教育',
      literary: '文艺唯美',
      scientific: '科学严谨'
    }

    const audienceMap = {
      students: '学生群体',
      professionals: '专业人士',
      general: '普通大众',
      'art-lovers': '艺术爱好者'
    }

    const prompt = `请为"${exhibitionForm.value.theme}"创建一个专题策展内容。

风格定位：${styleMap[exhibitionForm.value.style] || '文艺唯美'}
目标受众：${audienceMap[exhibitionForm.value.audience] || '普通大众'}
${exhibitionForm.value.keyPoints ? `内容要点：${exhibitionForm.value.keyPoints}` : ''}
${exhibitionForm.value.requirements ? `特殊要求：${exhibitionForm.value.requirements}` : ''}

请生成完整的专题内容，包括：
1. 专题标题（主标题和副标题/拉丁名）
2. 专题摘要（100-150字，引人入胜）
3. 专题正文内容（结构清晰，内容丰富）
4. 相关标签建议（3-5个）

要求：
- 内容专业且易懂
- 语言优美，符合${styleMap[exhibitionForm.value.style]}风格
- 结构清晰，层次分明
- 适合${audienceMap[exhibitionForm.value.audience]}阅读
- 突出主题的核心价值

请用Markdown格式输出，并使用HTML标签优化格式。`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位资深的内容策划专家，擅长创作高质量的专题策展内容，文笔优美，思路清晰，富有感染力',
      temperature: 0.8
    })

    exhibitionResult.value = marked.parse(response)
    ElMessage.success('专题内容生成成功')
  } catch (error) {
    console.error('生成失败:', error)
    ElMessage.error('生成失败：' + (error.message || '未知错误'))
  } finally {
    generating.value.exhibition = false
  }
}

// 生成文章内容
const generateArticle = async () => {
  if (!articleForm.value.topic) {
    ElMessage.warning('请输入文章主题')
    return
  }

  generating.value.article = true
  try {
    const categoryMap = {
      knowledge: '标本知识',
      art: '艺术鉴赏',
      craft: '制作工艺',
      story: '藏品故事'
    }

    const styleMap = {
      popular: '科普易懂',
      professional: '专业深入',
      narrative: '故事化',
      'data-driven': '数据驱动'
    }

    const lengthMap = {
      short: '500-800字',
      medium: '1000-1500字',
      long: '2000-3000字'
    }

    const prompt = `请为"${articleForm.value.topic}"创建一篇文章。

文章分类：${categoryMap[articleForm.value.category] || '标本知识'}
文章风格：${styleMap[articleForm.value.style] || '科普易懂'}
文章长度：${lengthMap[articleForm.value.length] || '1000-1500字'}
${articleForm.value.outline ? `内容大纲：\n${articleForm.value.outline}` : ''}
${articleForm.value.requirements ? `特殊要求：${articleForm.value.requirements}` : ''}

请生成完整的文章内容，包括：
1. 文章标题
2. 文章摘要（50-100字）
3. 正文内容（按照大纲结构，${lengthMap[articleForm.value.length]}）
4. 文章标签建议（3-5个）

要求：
- 内容准确专业
- 语言${styleMap[articleForm.value.style]}
- 结构清晰，逻辑严密
- 适合${categoryMap[articleForm.value.category]}类文章
- 可读性强，引人入胜

请用Markdown格式输出，并使用HTML标签优化格式。`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位资深的内容创作专家，擅长撰写高质量的文章，文笔流畅，逻辑清晰，富有感染力',
      temperature: 0.8
    })

    articleResult.value = marked.parse(response)
    ElMessage.success('文章内容生成成功')
  } catch (error) {
    console.error('生成失败:', error)
    ElMessage.error('生成失败：' + (error.message || '未知错误'))
  } finally {
    generating.value.article = false
  }
}

// 优化内容
const optimizeContent = async () => {
  if (!optimizeForm.value.content) {
    ElMessage.warning('请输入需要优化的内容')
    return
  }

  generating.value.optimize = true
  try {
    const directionText = {
      readability: '提升可读性',
      structure: '优化结构',
      language: '润色语言',
      engagement: '增强吸引力',
      seo: 'SEO优化'
    }

    const directions = optimizeForm.value.directions
      .map(d => directionText[d])
      .join('、')

    const styleMap = {
      concise: '简洁明了',
      vivid: '生动有趣',
      professional: '专业严谨',
      elegant: '文艺优雅'
    }

    const prompt = `请优化以下内容：

原文：
${optimizeForm.value.content}

优化要求：
- ${directions || '提升整体质量'}
- 目标风格：${styleMap[optimizeForm.value.targetStyle] || '简洁明了'}

请提供优化后的内容，并在开头说明主要优化点。`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位资深的内容优化专家，擅长提升内容质量，优化语言表达，增强可读性和吸引力',
      temperature: 0.7
    })

    optimizeResult.value = marked.parse(response)
    ElMessage.success('内容优化成功')
  } catch (error) {
    console.error('优化失败:', error)
    ElMessage.error('优化失败：' + (error.message || '未知错误'))
  } finally {
    generating.value.optimize = false
  }
}

// 重新生成
const regenerate = (type) => {
  if (type === 'exhibition') {
    generateExhibition()
  } else if (type === 'article') {
    generateArticle()
  }
}

// 复制结果
const copyResult = (type) => {
  let text = ''
  if (type === 'exhibition') {
    text = exhibitionResult.value
  } else if (type === 'article') {
    text = articleResult.value
  } else if (type === 'optimize') {
    text = optimizeResult.value
  }

  // 移除HTML标签
  const plainText = text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
  
  navigator.clipboard.writeText(plainText).then(() => {
    ElMessage.success('已复制到剪贴板')
  }).catch(() => {
    // 降级方案
    const textarea = document.createElement('textarea')
    textarea.value = plainText
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    ElMessage.success('已复制到剪贴板')
  })
}

// 应用到表单
const applyToForm = (type) => {
  let content = ''
  if (type === 'exhibition') {
    content = exhibitionResult.value
  } else if (type === 'article') {
    content = articleResult.value
  }

  // 移除HTML标签，保留纯文本
  const plainText = content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
  
  emit('apply-content', {
    type,
    content: plainText,
    htmlContent: content
  })
  
  ElMessage.success('内容已应用到表单')
}
</script>

<style scoped>
.content-creation-ai {
  padding: 20px;
  color: #333;
}

.ai-header {
  margin-bottom: 24px;
}

.ai-header h3 {
  color: #d4af37;
  margin: 0 0 8px 0;
  font-size: 20px;
  font-weight: 600;
}

.subtitle {
  color: #666;
  margin: 0;
  font-size: 14px;
}

.ai-tabs {
  margin-top: 20px;
}

.result-box {
  margin-top: 24px;
  background: #f9f9f9;
  border: 1px solid #e0e0e0;
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

.result-header > div {
  display: flex;
  gap: 8px;
}

.result-content {
  line-height: 1.8;
  color: #333;
}

.result-content :deep(h1),
.result-content :deep(h2),
.result-content :deep(h3) {
  color: #d4af37;
  margin-top: 20px;
  margin-bottom: 10px;
}

.result-content :deep(p) {
  margin-bottom: 12px;
}

.result-content :deep(ul),
.result-content :deep(ol) {
  margin-bottom: 12px;
  padding-left: 24px;
}

.result-content :deep(li) {
  margin-bottom: 6px;
}

:deep(.el-form-item__label) {
  font-weight: 500;
}

:deep(.el-tabs__item) {
  font-weight: 500;
}

:deep(.el-tabs__item.is-active) {
  color: #d4af37;
}

:deep(.el-tabs__active-bar) {
  background-color: #d4af37;
}
</style>

