<template>
  <div class="cf-subpanel asset-library">
    <div class="cf-subheader">
      <h3>母素材库</h3>
      <p>登记拍摄素材 · 关联藏品档案 · 改写分发至多平台</p>
    </div>

    <div class="cf-toolbar">
      <el-button type="primary" @click="openAdd">登记母素材</el-button>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="cf-card cf-card--flush">
      <el-table :data="assets" v-loading="loading" stripe>
        <el-table-column prop="title" label="标题" min-width="140" />
        <el-table-column prop="type" label="类型" width="72">
          <template #default="{ row }">{{ row.type === 'video' ? '视频' : '照片' }}</template>
        </el-table-column>
        <el-table-column prop="desc" label="描述" min-width="180" show-overflow-tooltip />
        <el-table-column label="藏品关联" width="120" show-overflow-tooltip>
          <template #default="{ row }">
            {{ specimenLabel(row.specimenRef) }}
          </template>
        </el-table-column>
        <el-table-column label="文件" width="80">
          <template #default="{ row }">{{ (row.fileRefs || []).length }} 个</template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              size="small"
              :loading="repurposingId === row._id"
              @click="openRepurpose(row)"
            >多平台改写</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 登记母素材 -->
    <el-dialog v-model="showAdd" title="登记母素材" width="520px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" placeholder="如：午后展柜侧光拍摄" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" style="width: 100%">
            <el-option label="视频" value="video" />
            <el-option label="照片" value="photo" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联藏品">
          <el-select
            v-model="form.specimenRef"
            filterable
            clearable
            placeholder="从藏品档案库选择（可选）"
            style="width: 100%"
            :loading="specimensLoading"
          >
            <el-option
              v-for="p in specimens"
              :key="p._id"
              :label="p.title"
              :value="p._id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="客观描述" required>
          <el-input
            v-model="form.desc"
            type="textarea"
            :rows="4"
            placeholder="供改写 Agent 使用：场景、光线、容器、无标本主语句式"
          />
        </el-form-item>
        <el-form-item label="文件引用">
          <el-input
            v-model="fileRefInput"
            placeholder="云存储路径或 CDN URL，回车添加"
            @keyup.enter="addFileRef"
          />
          <div v-if="form.fileRefs.length" class="file-tags">
            <el-tag
              v-for="(f, i) in form.fileRefs"
              :key="i"
              closable
              size="small"
              @close="form.fileRefs.splice(i, 1)"
            >{{ f }}</el-tag>
          </div>
        </el-form-item>
        <el-form-item label="IP 标签">
          <el-checkbox-group v-model="form.ipTags">
            <el-checkbox label="GRAVITY" />
            <el-checkbox label="LIGHTNESS" />
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 改写分发 -->
    <el-dialog v-model="showRepurpose" title="多平台改写分发" width="440px" destroy-on-close>
      <p v-if="repurposeRow" class="cf-muted rp-hint">母素材：{{ repurposeRow.title }}</p>
      <el-form label-width="90px">
        <el-form-item label="目标平台">
          <el-checkbox-group v-model="targetPlatforms">
            <el-checkbox label="xhs">小红书</el-checkbox>
            <el-checkbox label="douyin">抖音</el-checkbox>
            <el-checkbox label="shipinhao">视频号</el-checkbox>
            <el-checkbox label="bilibili">B站</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="IP">
          <el-select v-model="repurposeIp" style="width: 100%">
            <el-option label="GRAVITY · 沉静" value="GRAVITY" />
            <el-option label="LIGHTNESS · 明亮" value="LIGHTNESS" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showRepurpose = false">取消</el-button>
        <el-button type="primary" :loading="!!repurposingId" @click="runRepurpose">开始改写</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useContentBoard } from '../../composables/useContentBoard'
import { useContentAgents } from '../../composables/useContentAgents'
import { fetchCollectionLimit } from '../../utils/cloudbaseCdnDb'
import { defaultAsset } from '../../utils/contentDb'

const emit = defineEmits(['repurposed'])

const { fetchAssets, addAsset, createPiece } = useContentBoard()
const { repurpose: repurposeAgent } = useContentAgents()

const loading = ref(false)
const saving = ref(false)
const specimensLoading = ref(false)
const repurposingId = ref('')
const showAdd = ref(false)
const showRepurpose = ref(false)
const repurposeRow = ref(null)
const assets = ref([])
const specimens = ref([])
const fileRefInput = ref('')
const targetPlatforms = ref(['xhs', 'douyin', 'shipinhao'])
const repurposeIp = ref('GRAVITY')

const form = ref({
  title: '',
  type: 'video',
  desc: '',
  fileRefs: [],
  specimenRef: '',
  ipTags: ['GRAVITY'],
})

function specimenLabel(id) {
  if (!id) return '—'
  const p = specimens.value.find((s) => s._id === id)
  return p?.title || id.slice(0, 8) + '…'
}

function resetForm() {
  form.value = {
    title: '',
    type: 'video',
    desc: '',
    fileRefs: [],
    specimenRef: '',
    ipTags: ['GRAVITY'],
  }
  fileRefInput.value = ''
}

function addFileRef() {
  const v = fileRefInput.value.trim()
  if (!v) return
  if (!form.value.fileRefs.includes(v)) {
    form.value.fileRefs.push(v)
  }
  fileRefInput.value = ''
}

async function loadSpecimens() {
  specimensLoading.value = true
  try {
    const rows = await fetchCollectionLimit('products', { limit: 200 })
    specimens.value = rows.filter((p) => p.inArchive === true || p.isTreasure === true)
    if (!specimens.value.length) specimens.value = rows.slice(0, 50)
  } catch (e) {
    console.warn('加载藏品档案失败', e)
    specimens.value = []
  } finally {
    specimensLoading.value = false
  }
}

async function load() {
  loading.value = true
  try {
    assets.value = await fetchAssets()
  } catch (e) {
    ElMessage.error('加载母素材失败：' + (e.message || e))
  } finally {
    loading.value = false
  }
}

function openAdd() {
  resetForm()
  showAdd.value = true
  if (!specimens.value.length) loadSpecimens()
}

function openRepurpose(row) {
  repurposeRow.value = row
  targetPlatforms.value = ['xhs', 'douyin', 'shipinhao']
  repurposeIp.value = row.ipTags?.[0] || 'GRAVITY'
  showRepurpose.value = true
}

async function save() {
  if (!form.value.title?.trim()) {
    ElMessage.warning('请填写标题')
    return
  }
  if (!form.value.desc?.trim()) {
    ElMessage.warning('请填写客观描述')
    return
  }
  saving.value = true
  try {
    const payload = defaultAsset({
      ...form.value,
      title: form.value.title.trim(),
      desc: form.value.desc.trim(),
      ipTags: form.value.ipTags?.length ? form.value.ipTags : ['GRAVITY'],
    })
    await addAsset(payload)
    ElMessage.success('母素材已登记')
    showAdd.value = false
    resetForm()
    await load()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function runRepurpose() {
  const row = repurposeRow.value
  if (!row?._id) return
  if (!targetPlatforms.value.length) {
    ElMessage.warning('请至少选择一个目标平台')
    return
  }

  repurposingId.value = row._id
  try {
    const res = await repurposeAgent(row, targetPlatforms.value, { ip: repurposeIp.value })
    if (!res.ok) throw new Error(res.error)

    const pieces = res.data?.pieces || []
    let reviewCount = 0

    for (const p of pieces) {
      const state = p.suggestedState || (p.compliance?.passed ? 'drafting' : 'review')
      if (state === 'review') reviewCount += 1

      await createPiece({
        assetId: row._id,
        platform: p.platform,
        title: p.title,
        body: p.body,
        tags: p.tags || [],
        coverCopy: p.coverCopy || '',
        clipSuggestions: p.clipSuggestions || [],
        compliance: p.compliance,
        rewritten: p.rewritten,
        state,
        ip: repurposeIp.value,
        stateHistory: [{ state, at: Date.now(), by: 'agent' }],
      })
    }

    showRepurpose.value = false
    const msg =
      reviewCount > 0
        ? `已生成 ${pieces.length} 条工单，其中 ${reviewCount} 条合规未过已进入待终审（标红）`
        : `已生成 ${pieces.length} 条成品工单`
    ElMessage.success(msg)
    emit('repurposed')
  } catch (e) {
    ElMessage.error(e.message || '改写失败')
  } finally {
    repurposingId.value = ''
  }
}

onMounted(() => {
  load()
  loadSpecimens()
})
</script>

<style scoped>
.asset-library {
  min-height: 320px;
}

.file-tags {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.rp-hint {
  margin: 0 0 12px;
}
</style>
