<template>
  <div class="cf-subpanel topic-library">
    <div class="cf-subheader">
      <h3>选题库</h3>
      <p>AI 生成候选 · 人工挑选置 picked · 入看板选题列</p>
    </div>

    <div class="cf-toolbar">
      <el-button type="primary" @click="createManual">新建选题</el-button>
      <el-button :loading="generating" @click="runAgent">AI 生成选题</el-button>
      <el-button :loading="loading" @click="load">刷新</el-button>
      <el-radio-group v-model="statusFilter" size="small" @change="load">
        <el-radio-button label="">全部</el-radio-button>
        <el-radio-button label="candidate">候选</el-radio-button>
        <el-radio-button label="picked">已挑选</el-radio-button>
      </el-radio-group>
    </div>

    <div class="cf-card cf-card--flush">
      <el-table :data="topics" v-loading="loading" stripe>
        <el-table-column prop="title" label="选题" min-width="160" show-overflow-tooltip />
        <el-table-column prop="hook" label="钩子" min-width="140" show-overflow-tooltip />
        <el-table-column prop="angle" label="角度" width="100" show-overflow-tooltip />
        <el-table-column prop="platform" label="平台" width="88">
          <template #default="{ row }">{{ platformLabels[row.platform] || row.platform }}</template>
        </el-table-column>
        <el-table-column prop="ip" label="IP" width="96" />
        <el-table-column prop="category" label="品类" width="72" />
        <el-table-column prop="score" label="分" width="56" align="center" />
        <el-table-column prop="status" label="状态" width="88">
          <template #default="{ row }">
            <el-tag :type="row.status === 'picked' ? 'success' : 'info'" size="small">
              {{ row.status === 'picked' ? '已挑选' : '候选' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="source" label="来源" width="72" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status !== 'picked'"
              link
              type="primary"
              size="small"
              :loading="pickingId === row._id"
              @click="pick(row)"
            >挑选入看板</el-button>
            <span v-else class="cf-muted">已在看板</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useContentBoard } from '../../composables/useContentBoard'
import { useContentAgents } from '../../composables/useContentAgents'
import { PLATFORM_LABELS } from '../../config/contentConstitution'

const emit = defineEmits(['picked'])

const { fetchTopics, addTopic, pickTopic, createPieceFromTopic } = useContentBoard()
const { suggestTopics } = useContentAgents()

const loading = ref(false)
const generating = ref(false)
const pickingId = ref('')
const statusFilter = ref('candidate')
const topics = ref([])
const platformLabels = PLATFORM_LABELS

async function load() {
  loading.value = true
  try {
    topics.value = await fetchTopics(statusFilter.value || null)
  } catch (e) {
    ElMessage.error('加载选题失败：' + (e.message || e))
  } finally {
    loading.value = false
  }
}

async function createManual() {
  try {
    const { value } = await ElMessageBox.prompt('选题标题', '新建选题', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPlaceholder: '如：午后光落在蝶翅边缘',
    })
    if (!value?.trim()) return
    await addTopic({
      title: value.trim(),
      ip: 'GRAVITY',
      platform: 'xhs',
      category: '标本',
      angle: '光与容器',
      hook: value.trim(),
      rationale: '人工新建',
      source: 'human',
      status: 'candidate',
      score: 60,
    })
    ElMessage.success('选题已创建')
    await load()
  } catch {
    /* 取消 */
  }
}

async function runAgent() {
  generating.value = true
  try {
    const res = await suggestTopics({}, { persist: true })
    if (!res.ok) throw new Error(res.error)
    const list = res.data?.topics || []
    ElMessage.success(`已生成并入库 ${list.length} 条选题（status=candidate）`)
    statusFilter.value = 'candidate'
    await load()
  } catch (e) {
    ElMessage.error('选题 Agent 失败：' + (e.message || e))
  } finally {
    generating.value = false
  }
}

async function pick(row) {
  pickingId.value = row._id
  try {
    await pickTopic(row._id)
    await createPieceFromTopic(row)
    ElMessage.success('已挑选（picked）并加入看板选题列')
    emit('picked')
    await load()
  } catch (e) {
    ElMessage.error(e.message || '入板失败')
  } finally {
    pickingId.value = ''
  }
}

onMounted(load)
</script>

<style scoped>
.topic-library {
  min-height: 320px;
}
</style>
