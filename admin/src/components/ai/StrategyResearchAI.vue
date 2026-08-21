<template>
  <div class="strategy-research-ai">
    <div class="ai-header">
      <h3>🔬 战略用研AI</h3>
      <p class="subtitle">智能用户研究与战略调研 · 专业报告生成 · 自动同步到调研看板</p>
      <div class="header-tips">
        <span class="tip-item">💡 支持市场、用户、竞品、行业趋势、产品需求等多维度调研</span>
        <span class="tip-item">📊 生成专业报告，自动提取关键发现</span>
        <span class="tip-item">🔄 一键同步到战略调研看板</span>
      </div>
    </div>

    <div class="ai-sections">
      <!-- 调研类型选择 -->
      <div class="section-card">
        <h4>📋 调研类型</h4>
        <el-form :model="researchForm" label-width="120px">
          <el-form-item label="调研类型" required>
            <el-select v-model="researchForm.type" placeholder="请选择调研类型" style="width: 100%">
              <el-option label="📊 市场调研" value="market">
                <span style="margin-right: 8px;">📊</span>
                <span>市场调研 - 市场规模、增长趋势、细分市场分析</span>
              </el-option>
              <el-option label="👥 用户调研" value="user">
                <span style="margin-right: 8px;">👥</span>
                <span>用户调研 - 用户画像、需求痛点、行为模式</span>
              </el-option>
              <el-option label="🔍 竞品调研" value="competitor">
                <span style="margin-right: 8px;">🔍</span>
                <span>竞品调研 - 竞品分析、竞争格局、差异化机会</span>
              </el-option>
              <el-option label="📈 行业趋势调研" value="trend">
                <span style="margin-right: 8px;">📈</span>
                <span>行业趋势调研 - 宏观环境、技术发展、新兴趋势</span>
              </el-option>
              <el-option label="💡 产品需求调研" value="product">
                <span style="margin-right: 8px;">💡</span>
                <span>产品需求调研 - 用户需求、功能优先级、市场空白</span>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="调研主题" required>
            <el-input 
              v-model="researchForm.topic" 
              placeholder="例如：标本艺术市场消费者行为分析、目标用户群体画像研究..."
              maxlength="100"
              show-word-limit
            />
            <div class="form-hint">💡 建议：主题要具体明确，便于AI生成精准的调研报告</div>
          </el-form-item>
          <el-form-item label="调研目标">
            <el-input
              v-model="researchForm.objective"
              type="textarea"
              :rows="4"
              placeholder="描述本次调研的主要目标和期望获得的信息，例如：&#10;1. 了解目标用户对标本艺术品的接受度和购买意愿&#10;2. 分析市场空白和增长机会&#10;3. 识别潜在风险和挑战..."
              maxlength="500"
              show-word-limit
            />
            <div class="form-hint">💡 建议：详细描述调研目标有助于生成更精准的报告</div>
          </el-form-item>
          <el-form-item>
            <el-button 
              @click="generateResearch" 
              :loading="generating" 
              type="primary"

              size="large"
              :disabled="!researchForm.topic.trim()"
            >
              <span v-if="!generating">🚀 开始调研分析</span>
              <span v-else>🔄 AI正在深度分析中，请稍候...</span>
            </el-button>
            <el-button 
              @click="resetForm" 
              :disabled="generating"
              size="large"
            >
              重置表单
            </el-button>
          </el-form-item>
        </el-form>
      </div>

      <!-- 调研结果 -->
      <div class="section-card" v-if="researchResult">
        <div class="result-header">
          <h4>📊 调研报告</h4>
          <div class="result-meta">
            <span class="meta-item">类型：{{ getTypeLabel(researchForm.type) }}</span>
            <span class="meta-item">主题：{{ researchForm.topic }}</span>
            <span class="meta-item">生成时间：{{ new Date().toLocaleString('zh-CN') }}</span>
          </div>
        </div>
        <div class="result-content" v-html="researchResult"></div>
        <div class="result-actions">
          <el-button 
            @click="saveToResearchBoard" 
            :loading="saving" 
            type="primary"

            size="default"
          >
            <span v-if="!saving">💾 同步到调研看板</span>
            <span v-else>同步中...</span>
          </el-button>
          <el-button @click="exportResult" size="default">
            📥 导出Markdown报告
          </el-button>
          <el-button @click="copyResult" size="default">
            📋 复制报告内容
          </el-button>
        </div>
      </div>

      <!-- 历史调研记录 -->
      <div class="section-card">
        <div class="history-header-section">
          <h4>📚 历史调研记录</h4>
          <div class="history-actions">
            <el-button size="small" @click="loadResearchHistory" :loading="loadingHistory">
              🔄 刷新
            </el-button>
            <el-button size="small" @click="clearHistory" type="danger" :disabled="researchHistory.length === 0">
              🗑️ 清空历史
            </el-button>
          </div>
        </div>
        <div class="history-stats" v-if="researchHistory.length > 0">
          <span>共 {{ researchHistory.length }} 条记录</span>
          <span>最近更新：{{ formatDate(researchHistory[0]?.createTime) }}</span>
        </div>
        <div class="history-list" v-if="researchHistory.length > 0">
          <div
            v-for="item in researchHistory"
            :key="item._id"
            class="history-item"
            @click="loadHistoryItem(item)"
          >
            <div class="history-header">
              <span class="history-type">{{ getTypeLabel(item.type) }}</span>
              <span class="history-date">{{ formatDate(item.createTime) }}</span>
            </div>
            <div class="history-topic">{{ item.topic }}</div>
            <div class="history-summary">{{ item.summary || '暂无摘要' }}</div>
            <div class="history-footer">
              <el-button size="small" text @click.stop="loadHistoryItem(item)">
                查看详情
              </el-button>
              <el-button size="small" text type="danger" @click.stop="deleteHistoryItem(item._id)">
                删除
              </el-button>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <div class="empty-icon">📋</div>
          <p class="empty-title">暂无历史记录</p>
          <p class="empty-hint">完成首次调研后，记录将自动保存到这里</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callGeminiAPI } from '../../utils/aiHelper'
import { fetchCollectionSorted, cdnAdd, cdnRemove, COLLECTIONS } from '../../cloud'
import { marked } from 'marked'

const props = defineProps({
  feature: Object
})

const researchForm = ref({
  type: 'market',
  topic: '',
  objective: ''
})

const generating = ref(false)
const saving = ref(false)
const loadingHistory = ref(false)
const researchResult = ref('')
const researchHistory = ref([])
const rawResult = ref('') // 保存原始文本用于导出

const getTypeLabel = (type) => {
  const map = {
    market: '市场调研',
    user: '用户调研',
    competitor: '竞品调研',
    trend: '行业趋势',
    product: '产品需求'
  }
  return map[type] || type
}

const formatDate = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const resetForm = () => {
  researchForm.value = {
    type: 'market',
    topic: '',
    objective: ''
  }
  researchResult.value = ''
  rawResult.value = ''
  ElMessage.info('表单已重置')
}

const generateResearch = async () => {
  if (!researchForm.value.topic.trim()) {
    ElMessage.warning({
      message: '请输入调研主题',
      duration: 2000
    })
    return
  }
  
  if (researchForm.value.topic.length < 5) {
    ElMessage.warning({
      message: '调研主题过短，请提供更详细的主题描述',
      duration: 3000
    })
    return
  }

  generating.value = true
  try {
    const typeLabels = {
      market: '市场调研',
      user: '用户调研',
      competitor: '竞品调研',
      trend: '行业趋势调研',
      product: '产品需求调研'
    }

    const prompt = `作为战略研究专家，请进行${typeLabels[researchForm.value.type]}分析：

调研主题：${researchForm.value.topic}
调研目标：${researchForm.value.objective || '深度了解相关领域，为战略决策提供依据'}

请生成一份专业的调研报告，包含：
1. 执行摘要（核心发现和结论）
2. 研究方法论
3. 详细分析（数据、洞察、趋势）
4. 关键发现（3-5个最重要的发现）
5. 战略建议（基于调研结果的具体建议）
6. 风险与机会识别
7. 下一步行动建议

请以专业的商业报告格式呈现，数据要具体，建议要可执行。`

    const response = await callGeminiAPI(prompt, {
      systemInstruction: '你是战略研究和市场调研专家，擅长生成专业、深入的调研报告',
      temperature: 0.8,
      maxOutputTokens: 4096
    })
    
    rawResult.value = response
    researchResult.value = marked.parse(response)
    ElMessage.success({
      message: '✅ 调研分析完成！报告已生成，可同步到调研看板或导出',
      duration: 4000,
      showClose: true
    })
    // 自动保存到历史记录
    await saveToResearchBoard(true) // 静默保存
  } catch (error) {
    console.error('调研失败:', error)
    ElMessage.error({
      message: '调研失败：' + (error.message || '未知错误'),
      duration: 4000,
      showClose: true
    })
  } finally {
    generating.value = false
  }
}

const copyResult = () => {
  if (!rawResult.value) {
    ElMessage.warning('没有可复制的内容')
    return
  }
  navigator.clipboard.writeText(rawResult.value).then(() => {
    ElMessage.success('报告内容已复制到剪贴板')
  }).catch(() => {
    ElMessage.error('复制失败，请手动复制')
  })
}

const saveToResearchBoard = async (silent = false) => {
  if (!researchResult.value) {
    if (!silent) {
      ElMessage.warning('请先生成调研结果')
    }
    return
  }

  saving.value = true
  try {
    // 提取摘要（取前200字）
    const plainText = rawResult.value.replace(/<[^>]*>/g, '').replace(/\n/g, ' ')
    const summary = plainText.length > 200 ? plainText.substring(0, 200) + '...' : plainText

    // 提取关键发现（尝试从markdown中提取）
    const keyFindings = []
    const lines = rawResult.value.split('\n')
    let inFindingsSection = false
    for (const line of lines) {
      if (line.includes('关键发现') || line.includes('主要发现')) {
        inFindingsSection = true
        continue
      }
      if (inFindingsSection) {
        if (line.trim().startsWith('-') || line.trim().startsWith('•') || line.trim().match(/^\d+\./)) {
          keyFindings.push(line.trim().replace(/^[-•\d.]+/, '').trim())
          if (keyFindings.length >= 5) break
        }
        if (line.startsWith('##') || line.startsWith('#')) {
          if (!line.includes('发现')) break
        }
      }
    }

    const researchData = {
      type: researchForm.value.type,
      topic: researchForm.value.topic,
      objective: researchForm.value.objective || '',
      content: rawResult.value,
      summary: summary,
      keyFindings: keyFindings,
      status: 'active',
      source: 'ai_research',
      createTime: Date.now(),
      updateTime: Date.now()
    }

    await cdnAdd(COLLECTIONS.STRATEGY_RESEARCH, researchData)
    if (!silent) {
      ElMessage.success({
        message: '✅ 已同步到调研看板，可在战略调研看板中查看',
        duration: 3000
      })
    }
    
    // 重新加载历史记录
    await loadResearchHistory()
  } catch (error) {
    console.error('保存失败:', error)
    if (!silent) {
      ElMessage.error({
        message: '同步失败：' + (error.message || '未知错误'),
        duration: 4000,
        showClose: true
      })
    }
  } finally {
    saving.value = false
  }
}

const exportResult = () => {
  if (!rawResult.value) {
    ElMessage.warning('没有可导出的内容')
    return
  }

  const filename = `战略调研_${researchForm.value.topic}_${new Date().toISOString().split('T')[0]}.md`
  const blob = new Blob([rawResult.value], { type: 'text/markdown;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
  ElMessage.success('导出成功')
}

const loadHistoryItem = (item) => {
  researchForm.value = {
    type: item.type,
    topic: item.topic,
    objective: item.objective || ''
  }
  rawResult.value = item.content
  researchResult.value = marked.parse(item.content)
  ElMessage.info('已加载历史记录')
}

const loadResearchHistory = async () => {
  loadingHistory.value = true
  try {
    researchHistory.value = await fetchCollectionSorted(COLLECTIONS.STRATEGY_RESEARCH, {
      limit: 20,
      throwOnError: true,
      sortFn: (a, b) => (b.createTime || 0) - (a.createTime || 0),
    })
  } catch (error) {
    console.error('加载历史记录失败:', error)
    ElMessage.error('加载历史记录失败：' + (error.message || '未知错误'))
  } finally {
    loadingHistory.value = false
  }
}

const clearHistory = () => {
  ElMessageBox.confirm(
    '确定要清空所有历史调研记录吗？此操作不可恢复。',
    '确认清空',
    {
      confirmButtonText: '确定清空',
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: 'el-button--danger'
    }
  ).then(async () => {
    try {
      for (const item of researchHistory.value) {
        await cdnRemove(COLLECTIONS.STRATEGY_RESEARCH, item._id)
      }
      researchHistory.value = []
      ElMessage.success('历史记录已清空')
    } catch (error) {
      console.error('清空失败:', error)
      ElMessage.error('清空失败：' + (error.message || '未知错误'))
    }
  }).catch(() => {
    // 用户取消
  })
}

const deleteHistoryItem = async (id) => {
  ElMessageBox.confirm(
    '确定要删除这条调研记录吗？',
    '确认删除',
    {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: 'el-button--danger'
    }
  ).then(async () => {
    try {
      await cdnRemove(COLLECTIONS.STRATEGY_RESEARCH, id)
      researchHistory.value = researchHistory.value.filter(item => item._id !== id)
      ElMessage.success('删除成功')
    } catch (error) {
      console.error('删除失败:', error)
      ElMessage.error('删除失败：' + (error.message || '未知错误'))
    }
  }).catch(() => {
    // 用户取消
  })
}

onMounted(() => {
  loadResearchHistory()
})
</script>

<style scoped>
.strategy-research-ai {
  padding: 24px;
  background: #000;
  color: #e0e0e0;
  min-height: 400px;
}

.ai-header h3 {
  color: #d4af37;
  margin: 0 0 8px 0;
  font-size: 24px;
  font-weight: 700;
}

.subtitle {
  color: #888;
  margin: 0 0 12px 0;
  font-size: 14px;
}

.header-tips {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(212, 175, 55, 0.1);
}

.tip-item {
  font-size: 12px;
  color: #aaa;
  padding: 4px 8px;
  background: rgba(212, 175, 55, 0.05);
  border-radius: 4px;
  border: 1px solid rgba(212, 175, 55, 0.1);
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
  font-size: 18px;
  font-weight: 600;
}

.form-hint {
  font-size: 12px;
  color: #888;
  margin-top: 6px;
  line-height: 1.5;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(212, 175, 55, 0.2);
}

.result-header h4 {
  margin: 0;
}

.result-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
}

.meta-item {
  font-size: 12px;
  color: #aaa;
  padding: 2px 8px;
  background: rgba(212, 175, 55, 0.05);
  border-radius: 4px;
}

.history-header-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.history-header-section h4 {
  margin: 0;
}

.history-actions {
  display: flex;
  gap: 8px;
}

.history-stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(212, 175, 55, 0.05);
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 12px;
  color: #aaa;
}

.history-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(212, 175, 55, 0.1);
}

.result-content {
  margin-bottom: 20px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  color: #e0e0e0;
  line-height: 1.8;
  max-height: 500px;
  overflow-y: auto;
}

.result-actions {
  display: flex;
  gap: 12px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
}

.history-item {
  padding: 16px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.history-item:hover {
  background: rgba(212, 175, 55, 0.1);
  border-color: rgba(212, 175, 55, 0.4);
  transform: translateX(4px);
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.history-type {
  padding: 4px 12px;
  background: rgba(212, 175, 55, 0.2);
  border-radius: 12px;
  font-size: 12px;
  color: #d4af37;
}

.history-date {
  font-size: 12px;
  color: #888;
}

.history-topic {
  font-weight: 600;
  color: #fff;
  margin-bottom: 8px;
}

.history-summary {
  font-size: 13px;
  color: #aaa;
  line-height: 1.6;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #888;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: #aaa;
  margin: 8px 0;
}

.empty-hint {
  font-size: 13px;
  color: #666;
  margin: 8px 0;
  line-height: 1.6;
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


