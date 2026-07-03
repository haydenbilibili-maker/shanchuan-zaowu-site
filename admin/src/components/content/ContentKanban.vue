<template>
  <div class="content-kanban">
    <div class="ai-header">
      <h3>📋 内容看板</h3>
      <p class="subtitle">按状态分列 · 卡片 = content_pieces</p>
    </div>

    <div class="kb-toolbar">
      <el-button type="primary" :loading="loading" @click="load">刷新看板</el-button>
      <el-button @click="createDraft">新建草稿</el-button>
    </div>

    <el-alert
      v-if="loadError"
      type="warning"
      :title="loadError"
      show-icon
      :closable="false"
      class="kb-alert"
    />

    <div class="kb-columns">
      <div v-for="st in states" :key="st" class="kb-col section-card">
        <div class="kb-col-title">{{ stateLabels[st] }} ({{ columnPieces(st).length }})</div>
        <div v-if="!columnPieces(st).length" class="kb-empty">暂无</div>
        <div
          v-for="p in columnPieces(st)"
          :key="p._id"
          class="kb-card"
          :class="{ 'kb-card--warn': p.compliance && !p.compliance.passed }"
          @click="onCardClick(p)"
        >
          <div class="kb-card-title">{{ p.title || '未命名' }}</div>
          <div class="kb-card-meta">
            <el-tag size="small" type="info">{{ platformLabels[p.platform] || p.platform }}</el-tag>
            <el-tag size="small">{{ ipLabels[p.ip] || p.ip }}</el-tag>
          </div>
          <div v-if="p.compliance && !p.compliance.passed" class="kb-warn">⚠ 合规未过</div>
          <div class="kb-actions" @click.stop>
            <el-button
              v-if="st === 'topic'"
              size="small"
              link
              type="primary"
              @click="startDrafting(p)"
            >开始撰写</el-button>
            <el-button
              v-if="st === 'drafting'"
              size="small"
              link
              type="primary"
              :loading="movingId === p._id"
              @click="submitToReview(p)"
            >提交终审</el-button>
            <el-button
              v-if="st === 'review'"
              size="small"
              link
              type="warning"
              @click="emit('open-review', p)"
            >终审</el-button>
            <el-button
              v-if="st === 'approved'"
              size="small"
              link
              @click="publish(p)"
            >登记发布</el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useContentBoard } from '../../composables/useContentBoard'
import { useContentAgents } from '../../composables/useContentAgents'
import { KANBAN_STATES, PIECE_STATE_LABELS, PLATFORM_LABELS, IP_LABELS } from '../../config/contentConstitution'

const emit = defineEmits(['open-review'])

const { fetchPieces, transitionPiece, createPiece, updatePiece, registerPublish } = useContentBoard()
const { constitutionCheck } = useContentAgents()

const loading = ref(false)
const movingId = ref('')
const loadError = ref('')
const pieces = ref([])
const states = KANBAN_STATES
const stateLabels = PIECE_STATE_LABELS
const platformLabels = PLATFORM_LABELS
const ipLabels = IP_LABELS

function columnPieces(state) {
  return pieces.value.filter((p) => p.state === state)
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    pieces.value = await fetchPieces()
  } catch (e) {
    loadError.value = `加载失败：${e.message || e}。请确认 CloudBase 已创建 content_pieces 集合。`
    pieces.value = []
  } finally {
    loading.value = false
  }
}

async function startDrafting(piece) {
  try {
    let body = piece.body || ''
    if (!body.trim()) {
      const { value } = await ElMessageBox.prompt('输入正文/脚本草稿', '开始撰写', {
        confirmButtonText: '保存并进入撰写中',
        inputType: 'textarea',
        inputValue: piece.hook || '',
      })
      body = value || ''
      await updatePiece(piece._id, { body })
      piece = { ...piece, body }
    }
    await transitionPiece(piece._id, piece, 'drafting')
    ElMessage.success('已进入撰写中')
    await load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '流转失败')
  }
}

async function submitToReview(piece) {
  movingId.value = piece._id
  try {
    const text = piece.body || piece.title || ''
    const check = await constitutionCheck({
      mode: 'check',
      text,
      ip: piece.ip || 'GRAVITY',
      platform: piece.platform || 'xhs',
      category: '标本',
    })
    const compliance = {
      passed: check.passed,
      violations: check.violations,
      checkedBy: 'agent',
      checkedAt: Date.now(),
    }
    const patched = { ...piece, compliance, rewritten: check.rewritten }
    await updatePiece(piece._id, { compliance, rewritten: check.rewritten })
    await transitionPiece(piece._id, patched, 'review')
    ElMessage.success(check.passed ? '已提交终审（合规已通过）' : '已提交终审（待人工修正合规问题）')
    await load()
  } catch (e) {
    ElMessage.error(e.message || '提交失败')
  } finally {
    movingId.value = ''
  }
}

async function createDraft() {
  try {
    const { value } = await ElMessageBox.prompt('输入草稿标题', '新建内容草稿', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
    })
    await createPiece({
      title: value,
      body: '',
      ip: 'GRAVITY',
      platform: 'xhs',
      tags: [],
      state: 'drafting',
    })
    ElMessage.success('草稿已创建')
    await load()
  } catch {
    /* 取消 */
  }
}

async function publish(piece) {
  try {
    const { value } = await ElMessageBox.prompt('粘贴发布链接（人工发布后登记）', '发布登记', {
      confirmButtonText: '登记',
      inputPlaceholder: 'https://...',
    })
    await registerPublish(piece._id, piece, { externalUrl: value || '' })
    ElMessage.success('已登记发布')
    await load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '登记失败')
  }
}

function onCardClick(p) {
  if (p.state === 'review') emit('open-review', p)
}

onMounted(load)

defineExpose({ load })
</script>

<style scoped>
.content-kanban {
  min-height: 400px;
}

.ai-header h3 {
  color: #d4af37;
  margin: 0 0 6px 0;
}

.subtitle {
  color: #888;
  margin: 0 0 16px 0;
  font-size: 13px;
}

.kb-toolbar {
  margin-bottom: 16px;
  display: flex;
  gap: 8px;
}

.kb-alert {
  margin-bottom: 12px;
}

.kb-columns {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
}

.section-card {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 12px;
  padding: 12px;
}

.kb-col {
  flex: 0 0 240px;
  min-height: 360px;
}

.kb-col-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
  color: #d4af37;
}

.kb-empty {
  font-size: 12px;
  color: #666;
  text-align: center;
  padding: 24px 0;
}

.kb-card {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(212, 175, 55, 0.15);
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.kb-card:hover {
  border-color: rgba(212, 175, 55, 0.45);
  box-shadow: 0 2px 12px rgba(212, 175, 55, 0.08);
}

.kb-card--warn {
  border-color: rgba(196, 92, 74, 0.45);
}

.kb-card-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 6px;
  color: #e0e0e0;
}

.kb-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.kb-warn {
  font-size: 11px;
  color: #e8a090;
  margin-bottom: 4px;
}

.kb-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

:deep(.el-button) {
  background: #000 !important;
  border-color: rgba(212, 175, 55, 0.3) !important;
  color: #fff !important;
}

:deep(.el-button--primary) {
  border-color: #d4af37 !important;
  color: #d4af37 !important;
}
</style>
