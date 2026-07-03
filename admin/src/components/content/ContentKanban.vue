<template>
  <div class="cf-subpanel content-kanban">
    <div class="cf-subheader">
      <h3>内容看板</h3>
      <p>按状态分列 · 卡片 = content_pieces · 点击待终审卡片可打开终审抽屉</p>
    </div>

    <div class="cf-toolbar">
      <el-button type="primary" :loading="loading" @click="load">刷新看板</el-button>
      <el-button @click="createDraft">新建草稿</el-button>
    </div>

    <el-alert
      v-if="loadError"
      type="warning"
      :title="loadError"
      show-icon
      :closable="false"
      style="margin-bottom: 12px"
    />

    <div class="kb-columns">
      <div v-for="st in states" :key="st" class="kb-col" :data-state="st">
        <div class="kb-col-title">
          <span>{{ stateLabels[st] }}</span>
          <span class="kb-col-count">{{ columnPieces(st).length }}</span>
        </div>
        <div v-if="!columnPieces(st).length" class="kb-empty">暂无内容<br /><span class="cf-muted">可从未选题库挑选入板</span></div>
        <div
          v-for="p in columnPieces(st)"
          :key="p._id"
          class="kb-card"
          :class="{ 'kb-card--warn': p.compliance && !p.compliance.passed }"
          tabindex="0"
          role="button"
          @click="onCardClick(p)"
          @keyup.enter="onCardClick(p)"
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
</style>
