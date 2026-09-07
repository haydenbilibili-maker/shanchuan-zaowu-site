<template>
  <div class="content-display-flags">
    <div class="header-section">
      <h2>内容展示开关</h2>
      <p class="subtitle">
        对齐小程序云函数 <code>getContentDisplayFlags</code> · 集合 <code>content_display_flags</code>。
        控制馆藏「标本档案」、我的「山海社区」等前端区块显隐。
      </p>
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        class="hint-alert"
        title="默认关闭，内容生态成熟后再开放。缺配置时小程序按关闭兜底，不会误开。"
      />
    </div>

    <el-card v-loading="loading" class="flags-card">
      <el-form label-width="200px">
        <el-form-item label="馆藏页 · 标本档案">
          <div class="switch-row">
            <el-switch
              v-model="form.showSpecimenArchive"
              active-text="展示"
              inactive-text="隐藏"
              inline-prompt
            />
            <span class="hint">关闭后馆藏页不渲染「标本档案」横向区，且不请求档案 feed</span>
          </div>
        </el-form-item>

        <el-form-item label="我的页 · 山海社区">
          <div class="switch-row">
            <el-switch
              v-model="form.showUserCommunity"
              active-text="展示"
              inactive-text="隐藏"
              inline-prompt
            />
            <span class="hint">关闭后「我的」馆藏服务列表隐藏「山海社区」入口</span>
          </div>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" color="#2D6A4F" :loading="saving" @click="saveFlags">
            保存开关
          </el-button>
          <el-button @click="resetClosed">全部关闭（推荐默认）</el-button>
          <el-button :loading="loading" @click="loadFlags">刷新</el-button>
        </el-form-item>
      </el-form>

      <p v-if="updatedAtText" class="meta">最近更新：{{ updatedAtText }}</p>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import {
  fetchCollectionSorted,
  cdnUpsertSingleton,
  cdnUpdate,
  COLLECTIONS
} from '../cloud'
import { ElMessage } from 'element-plus'

const DEFAULT_FLAGS = {
  showSpecimenArchive: false,
  showUserCommunity: false
}

const loading = ref(false)
const saving = ref(false)
const docId = ref('')
const form = reactive({ ...DEFAULT_FLAGS })
const updatedAtText = ref('')

function formatTime(v) {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { hour12: false })
}

function applyFlags(raw = {}, id = '') {
  form.showSpecimenArchive = raw.showSpecimenArchive === true
  form.showUserCommunity = raw.showUserCommunity === true
  docId.value = id || ''
  updatedAtText.value = formatTime(raw.updateTime || raw._updateTime || raw.updatedAt || null)
}

async function loadFlags() {
  loading.value = true
  try {
    const rows = await fetchCollectionSorted(COLLECTIONS.CONTENT_DISPLAY_FLAGS, {
      limit: 10,
      throwOnError: true,
      sortFn: (a, b) => (b.priority || 0) - (a.priority || 0)
        || (b.updateTime || 0) - (a.updateTime || 0)
    })
    const top = (rows || []).find((r) => r.status !== 'inactive') || null
    if (top) {
      applyFlags(top, top._id)
    } else {
      applyFlags(DEFAULT_FLAGS, '')
      ElMessage.info('尚无配置记录，当前为默认关闭；保存后写入云库')
    }
  } catch (e) {
    applyFlags(DEFAULT_FLAGS, '')
    ElMessage.warning('加载失败，已回退为默认关闭：' + (e.message || e))
  } finally {
    loading.value = false
  }
}

function buildPayload() {
  return {
    name: '内容展示开关',
    status: 'active',
    priority: 10,
    showSpecimenArchive: form.showSpecimenArchive === true,
    showUserCommunity: form.showUserCommunity === true,
    updateTime: Date.now(),
    _updateTime: Date.now()
  }
}

async function saveFlags() {
  saving.value = true
  try {
    const payload = buildPayload()
    if (docId.value) {
      await cdnUpdate(COLLECTIONS.CONTENT_DISPLAY_FLAGS, docId.value, payload)
    } else {
      await cdnUpsertSingleton(COLLECTIONS.CONTENT_DISPLAY_FLAGS, {
        ...payload,
        createTime: Date.now(),
        _createTime: Date.now()
      })
    }
    ElMessage.success('已保存（默认关闭项不会被误开）')
    await loadFlags()
  } catch (e) {
    ElMessage.error(
      '保存失败：' + (e.message || e) + '（请确认已 provision 集合 content_display_flags）'
    )
  } finally {
    saving.value = false
  }
}

function resetClosed() {
  form.showSpecimenArchive = false
  form.showUserCommunity = false
  ElMessage.info('已本地全部关闭，点击「保存开关」写入云库')
}

onMounted(loadFlags)
</script>

<style scoped>
.content-display-flags {
  padding: 8px 4px 32px;
}
.header-section h2 {
  margin: 0;
  font-size: 22px;
  color: #33302c;
  border-left: 5px solid #2d6a4f;
  padding-left: 12px;
  font-weight: 800;
}
.header-section .subtitle {
  margin: 8px 0 0;
  color: #6b6560;
  font-size: 13px;
  padding-left: 17px;
  line-height: 1.5;
}
.header-section code {
  font-size: 12px;
  background: #f2ede4;
  padding: 1px 6px;
  border-radius: 4px;
}
.hint-alert {
  margin: 14px 0 16px;
}
.flags-card {
  max-width: 720px;
  border-radius: 12px;
}
.switch-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.hint {
  font-size: 12px;
  color: #6b6560;
  line-height: 1.4;
}
.meta {
  margin: 8px 0 0;
  font-size: 12px;
  color: #a09a90;
}
</style>
