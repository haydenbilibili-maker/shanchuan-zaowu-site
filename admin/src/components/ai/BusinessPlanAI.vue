<template>
  <div class="business-plan-ai">
    <div class="ai-header">
      <h3>📋 商业计划生成AI</h3>
      <p class="subtitle">快速生成商业计划书、项目提案与投资路演材料</p>
    </div>

    <div class="ai-sections">
      <div class="section-card">
        <h4>📄 商业计划书生成</h4>
        <el-form :model="planForm" label-width="120px">
          <el-form-item label="计划类型">
            <el-select v-model="planForm.type">
              <el-option label="创业计划书" value="startup" />
              <el-option label="扩张计划书" value="expansion" />
              <el-option label="融资计划书" value="funding" />
            </el-select>
          </el-form-item>
          <el-form-item label="目标受众">
            <el-input v-model="planForm.audience" placeholder="如：投资人、合作伙伴等" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="generatePlan" :loading="generating">
              生成商业计划书
            </el-button>
          </el-form-item>
        </el-form>
        <div v-if="planResult" class="result-content" v-html="planResult"></div>
      </div>

      <div class="section-card">
        <h4>🎯 项目提案生成</h4>
        <el-input
          v-model="projectDescription"
          type="textarea"
          :rows="4"
          placeholder="描述项目背景、目标、需求等..."
          class="query-input"
        />
        <el-button type="primary" @click="generateProposal" :loading="proposalGenerating" style="margin-top: 12px;">
          生成项目提案
        </el-button>
        <div v-if="proposalResult" class="result-content" v-html="proposalResult"></div>
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

const planForm = ref({
  type: 'startup',
  audience: '投资人'
})

const projectDescription = ref('')
const generating = ref(false)
const proposalGenerating = ref(false)
const planResult = ref('')
const proposalResult = ref('')

const generatePlan = async () => {
  generating.value = true
  try {
    // 使用统一数据源（优先从财务报表获取订单数据）
    const data = await fetchStoreData(false, { useFinancialData: true, period: 'month' })
    const typeMap = {
      startup: '创业计划书',
      expansion: '扩张计划书',
      funding: '融资计划书'
    }

    const prompt = `生成${typeMap[planForm.value.type]}：
目标受众：${planForm.value.audience}

当前业务数据：
- 月营收：¥${data?.finance?.monthSales?.toLocaleString() || '130k-200k'}
- 商品总数：${data?.products?.total || 0}
- 会员总数：${data?.members?.total || 0}

品牌定位：山海造物标本艺术馆
- 自然美学、手作体验、教育价值
- 目标人群：25-40岁新中产、自然爱好者、教育焦虑家长

请生成完整的${typeMap[planForm.value.type]}，包括：
1. 执行摘要
2. 市场分析
3. 产品与服务
4. 商业模式
5. 营销策略
6. 财务预测
7. 团队与管理
8. 风险分析
9. 资金需求（如适用）
10. 发展规划`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是商业计划书撰写专家，擅长撰写专业、全面的商业计划书',
      temperature: 0.8,
      maxOutputTokens: 4096
    })
    planResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('生成失败：' + (error.message || '未知错误'))
  } finally {
    generating.value = false
  }
}

const generateProposal = async () => {
  if (!projectDescription.value.trim()) {
    ElMessage.warning('请输入项目描述')
    return
  }

  proposalGenerating.value = true
  try {
    const prompt = `生成项目提案：
项目描述：${projectDescription.value}

请生成专业的项目提案，包括：
1. 项目背景
2. 项目目标
3. 实施方案
4. 预期成果
5. 资源需求
6. 时间计划
7. 风险评估
8. 成功指标`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是项目提案撰写专家',
      temperature: 0.8,
      maxOutputTokens: 2048
    })
    proposalResult.value = marked.parse(response)
  } catch (error) {
    ElMessage.error('生成失败：' + (error.message || '未知错误'))
  } finally {
    proposalGenerating.value = false
  }
}
</script>

<style scoped>
.business-plan-ai {
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
  max-height: 600px;
  overflow-y: auto;
}

:deep(.el-form-item__label) {
  color: #e0e0e0 !important;
}

:deep(.el-input__wrapper),
:deep(.el-select .el-input__wrapper),
:deep(.el-textarea__inner) {
  background: #000 !important;
  border-color: rgba(212, 175, 55, 0.2) !important;
  color: #fff !important;
}

:deep(.el-input__inner),
:deep(.el-select .el-input__inner) {
  color: #fff !important;
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


