<template>
  <div class="virtual-board">
    <div class="board-header">
      <h3>🏛️ 虚拟董事会</h3>
      <p class="subtitle">多角色AI战略决策会议系统</p>
    </div>

    <!-- 会议控制面板 -->
    <div class="board-controls">
      <el-button type="primary" @click="startMeeting" :disabled="isMeeting">
        🚀 召开董事会
      </el-button>
      <el-button @click="stopMeeting" :disabled="!isMeeting">⏹️ 结束会议</el-button>
      <el-select v-model="selectedTopic" placeholder="选择议题" style="width: 300px">
        <el-option label="门店扩张策略" value="expansion" />
        <el-option label="产品线优化" value="product" />
        <el-option label="营销预算分配" value="marketing" />
        <el-option label="数字化转型" value="digital" />
        <el-option label="客户体验提升" value="customer" />
        <el-option label="自定义议题" value="custom" />
      </el-select>
      <el-input 
        v-if="selectedTopic === 'custom'"
        v-model="customTopic"
        placeholder="输入议题..."
        style="width: 300px"
      />
    </div>

    <!-- 董事会成员 -->
    <div class="board-members">
      <div 
        v-for="member in boardMembers" 
        :key="member.id"
        class="member-card"
        :class="{ active: selectedMembers.includes(member.id) }"
        @click="toggleMember(member.id)"
      >
        <div class="member-avatar">{{ member.icon }}</div>
        <div class="member-info">
          <div class="member-name">{{ member.name }}</div>
          <div class="member-role">{{ member.role }}</div>
        </div>
        <div v-if="selectedMembers.includes(member.id)" class="member-check">✓</div>
      </div>
    </div>

    <!-- 会议对话展示框 -->
    <div class="meeting-chat" v-if="isMeeting || records.length > 0">
      <div class="chat-header">
        <h4>💬 会议讨论</h4>
        <div class="meeting-status" v-if="isMeeting">
          <span class="status-dot"></span>
          <span>会议进行中...</span>
        </div>
      </div>
      <div class="chat-container" ref="chatContainer">
        <div v-if="records.length === 0 && !isMeeting" class="empty-chat">
          <p>点击"召开董事会"开始会议讨论</p>
        </div>
        <div 
          v-for="(record, index) in records" 
          :key="index"
          class="chat-message"
          :class="record.role"
        >
          <div class="message-avatar">{{ record.icon }}</div>
          <div class="message-content">
            <div class="message-header">
              <span class="message-speaker">{{ record.speaker }}</span>
              <span class="message-time">{{ record.time }}</span>
            </div>
            <div class="message-text" v-html="record.content"></div>
          </div>
        </div>
        <div v-if="isGenerating" class="chat-message generating">
          <div class="message-avatar">🤖</div>
          <div class="message-content">
            <div class="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <div class="message-text">正在生成回复...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 会议记录（历史记录） -->
    <div class="meeting-records" v-if="records.length > 0 && !isMeeting">
      <h4>📝 会议记录</h4>
      <div class="records-list">
        <div 
          v-for="(record, index) in records" 
          :key="index"
          class="record-item"
          :class="record.role"
        >
          <div class="record-header">
            <span class="record-speaker">{{ record.speaker }}</span>
            <span class="record-time">{{ record.time }}</span>
          </div>
          <div class="record-content" v-html="record.content"></div>
        </div>
      </div>
    </div>

    <!-- 决策总结 -->
    <div class="decision-summary" v-if="summary">
      <h4>🎯 决策总结</h4>
      <div class="summary-content" v-html="summary"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { callGeminiAPI } from '../../utils/aiHelper'
import { marked } from 'marked'

const props = defineProps({
  feature: Object
})

const emit = defineEmits(['close'])

const isMeeting = ref(false)
const isGenerating = ref(false)
const selectedTopic = ref('')
const customTopic = ref('')
const selectedMembers = ref(['ceo', 'cfo', 'cmo'])
const records = ref([])
const summary = ref('')
const chatContainer = ref(null)

const boardMembers = [
  { id: 'ceo', name: '首席执行官', role: 'CEO', icon: '👔', prompt: '你是一位经验丰富的CEO，擅长战略规划和团队管理' },
  { id: 'cfo', name: '首席财务官', role: 'CFO', icon: '💰', prompt: '你是一位严谨的CFO，专注于财务分析和风险控制' },
  { id: 'cmo', name: '首席营销官', role: 'CMO', icon: '📢', prompt: '你是一位创新的CMO，擅长品牌建设和市场拓展' },
  { id: 'coo', name: '首席运营官', role: 'COO', icon: '⚙️', prompt: '你是一位高效的COO，专注于运营优化和流程改进' },
  { id: 'cto', name: '首席技术官', role: 'CTO', icon: '💻', prompt: '你是一位技术专家CTO，专注于数字化转型和技术创新' },
  { id: 'chro', name: '人力资源总监', role: 'CHRO', icon: '👥', prompt: '你是一位HR专家，专注于人才发展和组织建设' }
]

const toggleMember = (id) => {
  const index = selectedMembers.value.indexOf(id)
  if (index > -1) {
    selectedMembers.value.splice(index, 1)
  } else {
    selectedMembers.value.push(id)
  }
}

const startMeeting = async () => {
  if (!selectedTopic.value || (selectedTopic.value === 'custom' && !customTopic.value)) {
    ElMessage.warning('请选择或输入议题')
    return
  }

  if (selectedMembers.value.length < 2) {
    ElMessage.warning('至少需要2位董事会成员')
    return
  }

  isMeeting.value = true
  records.value = []
  summary.value = ''

  const topic = selectedTopic.value === 'custom' ? customTopic.value : selectedTopic.value
  const topicText = {
    expansion: '门店扩张策略：是否应该开设新店？如何选择位置？',
    product: '产品线优化：如何调整产品结构？哪些产品应该重点推广？',
    marketing: '营销预算分配：如何合理分配线上线下营销预算？',
    digital: '数字化转型：如何推进线上业务？需要哪些技术支持？',
    customer: '客户体验提升：如何提升客户满意度和复购率？'
  }[topic] || topic

  ElMessage.info('董事会会议开始...')

  // 让每位成员依次发言
  for (const memberId of selectedMembers.value) {
    if (!isMeeting.value) break

    const member = boardMembers.find(m => m.id === memberId)
    isGenerating.value = true
    
    const prompt = `作为${member.name}（${member.role}），请针对以下议题发表你的专业观点和建议：

议题：${topicText}

请从你的专业角度：
1. 分析当前状况和挑战
2. 提出你的建议和方案
3. 评估风险和机会
4. 给出具体的行动计划

保持专业、务实、有建设性。`

    try {
      const response = await callGeminiAPI(prompt, {
        systemInstruction: member.prompt,
        temperature: 0.8,
      })

      const record = {
        role: memberId,
        icon: member.icon,
        speaker: `${member.name} (${member.role})`,
        content: marked.parse(response),
        time: new Date().toLocaleTimeString('zh-CN')
      }
      
      records.value.push(record)
      isGenerating.value = false
      
      // 滚动到底部
      await nextTick()
      scrollToBottom()

      // 成员之间的发言间隔
      await new Promise(resolve => setTimeout(resolve, 1500))
    } catch (error) {
      console.error('成员发言失败:', error)
      isGenerating.value = false
      
      // 更友好的错误提示
      let errorMessage = '未知错误'
      if (error.message) {
        if (error.message.includes('429')) {
          errorMessage = '请求过于频繁，请稍后重试'
        } else if (error.message.includes('402')) {
          errorMessage = 'API Key需要付费，请检查配置'
        } else if (error.message.includes('不可用')) {
          errorMessage = error.message
        } else {
          errorMessage = error.message
        }
      }
      
      ElMessage.error(`${member.name}发言失败：${errorMessage}`)
      
      // 如果是关键错误，停止会议
      if (error.message && error.message.includes('所有AI服务都不可用')) {
        isMeeting.value = false
        ElMessage.error('会议已停止：AI服务不可用')
      }
    }
  }

  // 生成决策总结
  if (isMeeting.value) {
    const summaryPrompt = `请对以上董事会讨论进行总结，包括：
1. 各方核心观点
2. 达成的共识
3. 存在的分歧
4. 最终决策建议
5. 下一步行动计划

议题：${topicText}`

    try {
      const summaryResponse = await callGeminiAPI(summaryPrompt, {
        temperature: 0.7
      })
      summary.value = marked.parse(summaryResponse)
    } catch (error) {
      console.error('生成总结失败:', error)
    }
  }

  isMeeting.value = false
  ElMessage.success('董事会会议结束')
}

const stopMeeting = () => {
  isMeeting.value = false
  isGenerating.value = false
  ElMessage.info('会议已停止')
}

// 滚动到底部
const scrollToBottom = () => {
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
}

// 监听records变化，自动滚动
watch(records, () => {
  nextTick(() => {
    scrollToBottom()
  })
}, { deep: true })
</script>

<style scoped>
.virtual-board {
  padding: 24px;
  color: #e0e0e0;
}

.board-header {
  margin-bottom: 24px;
}

.board-header h3 {
  font-size: 24px;
  color: #d4af37;
  margin: 0 0 8px 0;
}

.subtitle {
  color: #888;
  margin: 0;
}

.board-controls {
  display: flex;
  gap: 16px;
  margin-bottom: 32px;
  flex-wrap: wrap;
}

.board-members {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.member-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  gap: 12px;
}

.member-card:hover {
  border-color: #d4af37;
  background: rgba(212, 175, 55, 0.1);
}

.member-card.active {
  border-color: #d4af37;
  background: rgba(212, 175, 55, 0.15);
}

.member-avatar {
  font-size: 32px;
}

.member-info {
  flex: 1;
}

.member-name {
  font-weight: 600;
  color: #fff;
  margin-bottom: 4px;
}

.member-role {
  font-size: 12px;
  color: #888;
}

.member-check {
  color: #d4af37;
  font-size: 20px;
}

/* 会议对话展示框 */
.meeting-chat {
  margin-top: 32px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(212, 175, 55, 0.3);
  border-radius: 12px;
  overflow: hidden;
  min-height: 400px;
  max-height: 600px;
  display: flex;
  flex-direction: column;
}

.chat-header {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(212, 175, 55, 0.2);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(212, 175, 55, 0.1);
}

.chat-header h4 {
  color: #d4af37;
  margin: 0;
  font-size: 18px;
}

.meeting-status {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #4ade80;
  font-size: 14px;
}

.status-dot {
  width: 8px;
  height: 8px;
  background: #4ade80;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.chat-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.empty-chat {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #888;
  font-size: 16px;
}

.chat-message {
  display: flex;
  gap: 12px;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.chat-message.ceo .message-content {
  border-left-color: #d4af37;
}

.chat-message.cfo .message-content {
  border-left-color: #4ade80;
}

.chat-message.cmo .message-content {
  border-left-color: #60a5fa;
}

.chat-message.coo .message-content {
  border-left-color: #f59e0b;
}

.chat-message.cto .message-content {
  border-left-color: #a78bfa;
}

.chat-message.chro .message-content {
  border-left-color: #ec4899;
}

.message-avatar {
  font-size: 36px;
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border-left: 3px solid #d4af37;
  padding: 16px;
  border-radius: 8px;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.message-speaker {
  font-weight: 600;
  color: #d4af37;
  font-size: 14px;
}

.message-time {
  font-size: 12px;
  color: #888;
}

.message-text {
  color: #e0e0e0;
  line-height: 1.8;
  word-wrap: break-word;
}

.message-text :deep(p) {
  margin: 8px 0;
}

.message-text :deep(ul),
.message-text :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.message-text :deep(li) {
  margin: 4px 0;
}

.chat-message.generating {
  opacity: 0.7;
}

.typing-indicator {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  background: #d4af37;
  border-radius: 50%;
  animation: typing 1.4s infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.7;
  }
  30% {
    transform: translateY(-10px);
    opacity: 1;
  }
}

/* 会议记录（历史记录） */
.meeting-records {
  margin-top: 32px;
}

.meeting-records h4 {
  color: #d4af37;
  margin-bottom: 16px;
}

.records-list {
  max-height: 500px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.record-item {
  background: rgba(255, 255, 255, 0.03);
  border-left: 3px solid #d4af37;
  padding: 16px;
  border-radius: 4px;
}

.record-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.record-speaker {
  font-weight: 600;
  color: #d4af37;
}

.record-time {
  font-size: 12px;
  color: #888;
}

.record-content {
  color: #ccc;
  line-height: 1.6;
}

.decision-summary {
  margin-top: 32px;
  padding: 24px;
  background: rgba(212, 175, 55, 0.1);
  border: 1px solid rgba(212, 175, 55, 0.3);
  border-radius: 8px;
}

.decision-summary h4 {
  color: #d4af37;
  margin-bottom: 16px;
}

.summary-content {
  color: #e0e0e0;
  line-height: 1.8;
}
</style>

