<template>
  <el-drawer
    :model-value="modelValue"
    title="人工终审"
    size="640px"
    destroy-on-close
    class="content-factory-drawer"
    @update:model-value="emit('update:modelValue', $event)"
    @opened="onOpened"
  >
    <template v-if="piece">
      <div class="rv-meta">
        <el-tag type="info">{{ platformLabel }}</el-tag>
        <el-tag>{{ ipLabel }}</el-tag>
        <el-tag :type="ipToneOk ? 'success' : 'warning'">
          IP 调性 {{ ipToneOk ? '对齐' : '待校正' }}
        </el-tag>
      </div>

      <el-alert
        :type="compliancePassed ? 'success' : 'warning'"
        :closable="false"
        show-icon
        :title="compliancePassed ? 'AI 合规校验已通过' : 'AI 合规校验未通过'"
        class="rv-alert"
      />

      <div v-if="liveViolations.length" class="rv-violations cf-card">
        <div class="rv-label">违规项</div>
        <ul>
          <li v-for="(v, i) in liveViolations" :key="i">{{ v }}</li>
        </ul>
      </div>

      <div class="rv-section">
        <div class="rv-label">标题</div>
        <div class="rv-title">{{ piece.title }}</div>
      </div>

      <div class="rv-compare">
        <div class="rv-compare-col">
          <div class="rv-label">原文</div>
          <el-input v-model="editBody" type="textarea" :rows="9" placeholder="正文 / 脚本" />
        </div>
        <div class="rv-compare-col">
          <div class="rv-label">AI 合规改写</div>
          <div v-if="checking" class="rv-checking">
            <el-icon class="is-loading"><Loading /></el-icon>
            话术宪法校验中…
          </div>
          <div v-else-if="rewritten" class="rv-rewritten-text">{{ rewritten }}</div>
          <div v-else class="cf-muted">提交终审或打开抽屉时将自动校验</div>
          <el-button
            v-if="rewritten"
            size="small"
            type="primary"
            link
            @click="applyRewritten"
          >采用改写</el-button>
        </div>
      </div>

      <el-input
        v-model="comment"
        type="textarea"
        :rows="2"
        placeholder="终审备注（可选）"
        class="rv-comment"
      />

      <div class="rv-actions">
        <el-button
          type="primary"
          :disabled="!canApprove"
          :loading="loading"
          @click="onApprove"
        >
          通过
        </el-button>
        <el-button :loading="loading" @click="onRewrite">打回重写</el-button>
        <el-button :loading="loading" @click="onDirectEdit">直接改</el-button>
      </div>
      <p v-if="!canApprove" class="rv-hint">
        compliance.passed=false 时「通过」不可用。请采用改写、手动编辑后点「直接改」重新校验。
      </p>
    </template>
  </el-drawer>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import { useContentBoard } from '../../composables/useContentBoard'
import { getContentOpenid } from '../../utils/contentDb'
import { useContentAgents } from '../../composables/useContentAgents'
import { PLATFORM_LABELS, IP_LABELS } from '../../config/contentConstitution'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  piece: { type: Object, default: null },
})

const emit = defineEmits(['update:modelValue', 'done'])

const { submitReview, updatePiece, getPiece } = useContentBoard()
const { constitutionCheck } = useContentAgents()

const loading = ref(false)
const checking = ref(false)
const editBody = ref('')
const comment = ref('')
const rewritten = ref('')
const ipToneOk = ref(true)
const liveCompliance = ref(null)

const platformLabel = computed(() => PLATFORM_LABELS[props.piece?.platform] || props.piece?.platform)
const ipLabel = computed(() => IP_LABELS[props.piece?.ip] || props.piece?.ip)
const compliancePassed = computed(() => (liveCompliance.value ?? props.piece?.compliance)?.passed === true)
const liveViolations = computed(() => (liveCompliance.value ?? props.piece?.compliance)?.violations || [])
const canApprove = computed(() => compliancePassed.value)

watch(
  () => props.piece,
  (p) => {
    editBody.value = p?.body || ''
    comment.value = ''
    rewritten.value = p?.rewritten || ''
    liveCompliance.value = p?.compliance ? { ...p.compliance } : null
    ipToneOk.value = true
  },
  { immediate: true }
)

function applyRewritten() {
  if (rewritten.value) editBody.value = rewritten.value
}

async function runComplianceCheck() {
  if (!props.piece?._id) return
  checking.value = true
  try {
    const check = await constitutionCheck({
      mode: 'check',
      text: editBody.value,
      ip: props.piece.ip || 'GRAVITY',
      platform: props.piece.platform || 'xhs',
      category: '标本',
    })
    const techErr = check.violations.find((v) => /^(模型调用失败|JSON 解析失败)/.test(v))
    if (techErr) throw new Error(techErr)

    const compliance = {
      passed: check.passed,
      violations: check.violations,
      checkedBy: 'agent',
      checkedAt: Date.now(),
    }
    liveCompliance.value = compliance
    rewritten.value = check.rewritten || ''
    ipToneOk.value = check.ip_tone_ok !== false
    await updatePiece(props.piece._id, {
      body: editBody.value,
      compliance,
      rewritten: check.rewritten,
    })
    return { compliance, check }
  } finally {
    checking.value = false
  }
}

function onOpened() {
  if (props.piece?.state === 'review') {
    runComplianceCheck().catch((e) => ElMessage.error(e.message || '合规校验失败'))
  }
}

async function recheckAndPatch() {
  const result = await runComplianceCheck()
  if (!result) throw new Error('校验失败')
  return result
}

async function onApprove() {
  if (!canApprove.value) return
  loading.value = true
  try {
    const reviewer = await getContentOpenid()
    const fresh = await getPiece(props.piece._id)
    await submitReview({
      pieceId: props.piece._id,
      piece: fresh || { ...props.piece, compliance: liveCompliance.value },
      decision: 'approve',
      comment: comment.value,
      constitutionCheck: { passed: true },
      reviewer,
    })
    ElMessage.success('已通过终审')
    emit('update:modelValue', false)
    emit('done')
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  } finally {
    loading.value = false
  }
}

async function onRewrite() {
  loading.value = true
  try {
    const reviewer = await getContentOpenid()
    await submitReview({
      pieceId: props.piece._id,
      piece: props.piece,
      decision: 'rewrite',
      comment: comment.value,
      reviewer,
    })
    ElMessage.info('已打回撰写中')
    emit('update:modelValue', false)
    emit('done')
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  } finally {
    loading.value = false
  }
}

async function onDirectEdit() {
  loading.value = true
  try {
    const { compliance } = await recheckAndPatch()
    if (!compliance.passed) {
      ElMessage.warning('编辑后仍未通过话术宪法，请继续修改或采用改写')
      return
    }
    const reviewer = await getContentOpenid()
    const updatedPiece = {
      ...props.piece,
      body: editBody.value,
      compliance,
    }
    await submitReview({
      pieceId: props.piece._id,
      piece: updatedPiece,
      decision: 'approve',
      comment: comment.value || '人工直接修改后通过',
      constitutionCheck: { passed: true },
      reviewer,
    })
    ElMessage.success('已直接修改并通过终审')
    emit('update:modelValue', false)
    emit('done')
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.rv-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.rv-alert {
  margin-bottom: 14px;
}

.rv-section {
  margin-bottom: 14px;
}

.rv-title {
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
}

.rv-compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 14px;
}

@media (max-width: 560px) {
  .rv-compare {
    grid-template-columns: 1fr;
  }
}

.rv-checking {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
  color: var(--brand-green-600);
  min-height: 80px;
}

.rv-comment {
  margin-bottom: 12px;
}
</style>
