<template>
  <div class="marketing-ai">
    <div class="ai-header">
      <h3>📱 线上营销AI助手</h3>
      <p class="subtitle">智能内容创作与营销策略优化</p>
    </div>

    <div class="marketing-tabs">
      <div 
        v-for="tab in tabs" 
        :key="tab.id"
        @click="activeTab = tab.id"
        :class="['tab-item', { active: activeTab === tab.id }]"
      >
        {{ tab.icon }} {{ tab.name }}
      </div>
    </div>

    <!-- 内容创作 -->
    <div v-if="activeTab === 'content'" class="content-gen">
      <el-form :model="contentForm" label-width="100px">
        <el-form-item label="内容类型">
          <el-select v-model="contentForm.type">
            <el-option label="小红书文案" value="xiaohongshu" />
            <el-option label="朋友圈文案" value="wechat" />
            <el-option label="产品描述" value="product" />
            <el-option label="活动海报文案" value="poster" />
          </el-select>
        </el-form-item>
        <el-form-item label="产品/主题">
          <el-input v-model="contentForm.topic" placeholder="输入产品名称或主题" />
        </el-form-item>
        <el-form-item label="风格要求">
          <el-input v-model="contentForm.style" placeholder="如：自然、文艺、专业等" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="generateContent" :loading="generating">
            生成内容
          </el-button>
        </el-form-item>
      </el-form>
      <div v-if="generatedContent" class="result-box" v-html="generatedContent"></div>
    </div>

    <!-- 广告策略 -->
    <div v-if="activeTab === 'ad'" class="ad-strategy">
      <el-button type="primary" @click="analyzeAdPerformance" :loading="analyzing">分析广告效果</el-button>
      <el-button type="primary" @click="optimizeAdStrategy" :loading="optimizing">优化投放策略</el-button>
      <div v-if="adAnalysis" class="result-box" v-html="adAnalysis"></div>
      <div v-if="adStrategy" class="result-box" v-html="adStrategy"></div>
    </div>

    <!-- SEO优化 -->
    <div v-if="activeTab === 'seo'" class="seo-optimize">
      <el-form :model="seoForm" label-width="120px">
        <el-form-item label="产品名称">
          <el-input v-model="seoForm.productName" />
        </el-form-item>
        <el-form-item label="当前标题">
          <el-input v-model="seoForm.currentTitle" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="optimizeSEO" :loading="seoOptimizing">
            优化SEO
          </el-button>
        </el-form-item>
      </el-form>
      <div v-if="seoResult" class="result-box" v-html="seoResult"></div>
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

const activeTab = ref('content')
const generating = ref(false)
const analyzing = ref(false)
const optimizing = ref(false)
const seoOptimizing = ref(false)

const generatedContent = ref('')
const adAnalysis = ref('')
const adStrategy = ref('')
const seoResult = ref('')

const contentForm = ref({
  type: 'xiaohongshu',
  topic: '',
  style: ''
})

const seoForm = ref({
  productName: '',
  currentTitle: ''
})

const tabs = [
  { id: 'content', name: '内容创作', icon: '✍️' },
  { id: 'ad', name: '广告策略', icon: '📢' },
  { id: 'seo', name: 'SEO优化', icon: '🔍' }
]

const generateContent = async () => {
  if (!contentForm.value.topic) {
    ElMessage.warning('请输入产品/主题')
    return
  }

  generating.value = true
  try {
    const typeText = {
      xiaohongshu: '小红书种草文案',
      wechat: '朋友圈文案',
      product: '产品描述',
      poster: '活动海报文案'
    }[contentForm.value.type]

    const prompt = `请为"${contentForm.value.topic}"生成${typeText}。

${contentForm.value.style ? `风格要求：${contentForm.value.style}` : ''}

要求：
1. 吸引眼球，有记忆点
2. 突出产品特色和卖点
3. 符合${typeText}的写作风格
4. 包含相关话题标签（如适用）
5. 长度适中，易于传播

请生成3个不同版本供选择。`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位资深的内容创作专家，擅长撰写各种营销文案',
      temperature: 0.9
    })
    generatedContent.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('生成失败：' + error.message)
  } finally {
    generating.value = false
  }
}

const analyzeAdPerformance = async () => {
  analyzing.value = true
  try {
    const prompt = `请分析线上广告投放效果，提供：
1. 关键指标分析（点击率、转化率、ROI等）
2. 表现好的广告特征
3. 表现差的广告问题
4. 优化建议`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位数字营销专家，擅长广告效果分析',
      temperature: 0.8
    })
    adAnalysis.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('分析失败：' + error.message)
  } finally {
    analyzing.value = false
  }
}

const optimizeAdStrategy = async () => {
  optimizing.value = true
  try {
    const prompt = `请提供广告投放优化策略：
1. 最佳投放时段
2. 目标人群定位
3. 广告创意建议
4. 预算分配建议
5. A/B测试方案`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位广告策略优化专家',
      temperature: 0.8
    })
    adStrategy.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('优化失败：' + error.message)
  } finally {
    optimizing.value = false
  }
}

const optimizeSEO = async () => {
  if (!seoForm.value.productName) {
    ElMessage.warning('请输入产品名称')
    return
  }

  seoOptimizing.value = true
  try {
    const prompt = `请为产品"${seoForm.value.productName}"优化SEO：

${seoForm.value.currentTitle ? `当前标题：${seoForm.value.currentTitle}` : ''}

请提供：
1. 优化后的标题（包含核心关键词）
2. 产品描述优化建议
3. 关键词建议（主关键词+长尾关键词）
4. SEO优化要点
5. 搜索排名提升策略`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是一位SEO优化专家，擅长关键词研究和内容优化',
      temperature: 0.8
    })
    seoResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('优化失败：' + error.message)
  } finally {
    seoOptimizing.value = false
  }
}
</script>

<style scoped>
.marketing-ai {
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

.marketing-tabs {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
  border-bottom: 1px solid rgba(212, 175, 55, 0.2);
}

.tab-item {
  padding: 12px 24px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.3s;
}

.tab-item:hover {
  color: #d4af37;
}

.tab-item.active {
  color: #d4af37;
  border-bottom-color: #d4af37;
}

.content-gen,
.ad-strategy,
.seo-optimize {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 8px;
  padding: 24px;
}

.result-box {
  margin-top: 24px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  line-height: 1.8;
  color: #e0e0e0;
}

:deep(.el-form-item__label) {
  color: var(--light-text-secondary);
}

:deep(.el-input__inner),
:deep(.el-select .el-input__inner) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(212, 175, 55, 0.3);
  color: #e0e0e0;
}
</style>

