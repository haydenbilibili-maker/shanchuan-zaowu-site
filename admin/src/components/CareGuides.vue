<template>
  <div class="care-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>养护指南 / CARE GUIDES</h2>
        <span class="subtitle">CARE GUIDES · 与小程序「养护指南」同源</span>
      </div>
      <div class="header-actions">
        <el-button @click="seedDefaults" :loading="seeding">同步默认 6 类</el-button>
        <el-button type="primary" :icon="Plus" @click="openDialog()">新建指南</el-button>
        <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
      </div>
    </div>

    <div class="filter-bar">
      <el-radio-group v-model="categoryFilter" fill="#2D6A4F" @change="refresh">
        <el-radio-button label="all">全部</el-radio-button>
        <el-radio-button v-for="c in CATEGORIES" :key="c" :label="c">{{ CATEGORY_LABEL[c] }}</el-radio-button>
      </el-radio-group>
    </div>

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      class="mod-alert"
      :title="loadError"
      description="请确认已登录 Admin、安全域名白名单含本机，且 care_guides 集合已 provision。可点刷新重试。"
    />

    <el-skeleton v-if="loading && !list.length && !loadError" :rows="8" animated />
    <template v-else>
    <el-table :data="list" v-loading="loading" stripe empty-text="暂无养护指南">
      <el-table-column label="品类" width="120">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">{{ row.category || '-' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="标题" min-width="200">
        <template #default="{ row }">
          <div class="g-title">{{ row.title }}</div>
          <div class="g-id">{{ row.guideId }}</div>
        </template>
      </el-table-column>
      <el-table-column prop="overline" label="副标题" width="120" />
      <el-table-column label="摘要" min-width="220" show-overflow-tooltip prop="summary" />
      <el-table-column label="板块数" width="90" align="center">
        <template #default="{ row }">{{ (row.sections || []).length }}</template>
      </el-table-column>
      <el-table-column label="版本" width="72" prop="version" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-switch
            :model-value="row.status === 'active'"
            @change="(v) => toggleStatus(row, v)"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link @click="openDialog(row)">编辑</el-button>
          <el-button size="small" type="danger" link @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty
      v-if="!loading && !list.length"
      description="尚无指南。可点「同步默认 6 类」快速落地，或新建自定义指南。"
    />
    </template>

    <el-dialog v-model="dialogVisible" :title="form._id ? '编辑养护指南' : '新建养护指南'" width="720px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="品类" required>
          <el-select v-model="form.category" style="width: 100%">
            <el-option v-for="c in CATEGORIES" :key="c" :label="`${CATEGORY_LABEL[c]} (${c})`" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="guideId">
          <el-input v-model="form.guideId" placeholder="空则自动生成 care_{category}_v…" />
        </el-form-item>
        <el-form-item label="标题" required>
          <el-input v-model="form.title" />
        </el-form-item>
        <el-form-item label="副标题">
          <el-input v-model="form.overline" />
        </el-form-item>
        <el-form-item label="摘要" required>
          <el-input v-model="form.summary" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="免责声明">
          <el-input v-model="form.disclaimer" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="板块 JSON" required>
          <el-input
            v-model="form.sectionsJson"
            type="textarea"
            :rows="12"
            placeholder='[{"key":"environment","title":"适宜环境","body":"…","tips":["…"]}]'
          />
          <div class="form-hint">sections 数组；含 key / title / body / tips；warning 板块用于异常信号</div>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.statusActive" active-text="active" inactive-text="inactive" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { fetchCollectionSorted, cdnAdd, cdnUpdate, cdnRemove } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

const CATEGORIES = ['GENERAL', 'INSECTA', 'PLANTAE', 'MARINE', 'MINERALS', 'FRAMING']
const CATEGORY_LABEL = {
  GENERAL: '通用安放',
  INSECTA: '蝴蝶昆虫',
  PLANTAE: '植物果实',
  MARINE: '海洋标本',
  MINERALS: '矿石馆',
  FRAMING: '装裱养护'
}

const DEFAULT_SEEDS = CATEGORIES.map((category) => ({
  guideId: `care_${category.toLowerCase()}_v1`,
  category,
  title: `${CATEGORY_LABEL[category]}指南`,
  overline: category,
  summary: `${CATEGORY_LABEL[category]}的日常安放与注意事项`,
  disclaimer: '一般性建议，具体以随件说明或专员指引为准。',
  sections: [
    {
      key: 'environment',
      title: '适宜环境',
      body: '请在稳定、干燥的室内环境中陈列，避免阳光直射与高湿。',
      tips: ['室温 18–26℃', '相对湿度 45–60%']
    },
    {
      key: 'warning',
      title: '异常信号',
      body: '若发现返潮、异味或结构异常，请停止自行处理并联系门店专员。',
      tips: ['框角开胶', '异味或虫蛀痕迹']
    }
  ],
  framingAddons: [],
  status: 'active',
  version: 1
}))

const list = ref([])
const loading = ref(false)
const loadError = ref('')
const seeding = ref(false)
const saving = ref(false)
const categoryFilter = ref('all')
const dialogVisible = ref(false)
const form = ref(emptyForm())

function emptyForm() {
  return {
    _id: '',
    guideId: '',
    category: 'GENERAL',
    title: '',
    overline: 'GENERAL',
    summary: '',
    disclaimer: '',
    sectionsJson: '[]',
    statusActive: true,
    version: 1
  }
}

const refresh = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const where = categoryFilter.value !== 'all' ? { category: categoryFilter.value } : null
    list.value = await fetchCollectionSorted('care_guides', {
      limit: 100,
      where,
      throwOnError: true,
      sortFn: (a, b) => String(a.category || '').localeCompare(String(b.category || ''))
        || String(a.guideId || '').localeCompare(String(b.guideId || ''))
    })
  } catch (e) {
    list.value = []
    loadError.value = '加载失败：' + (e.message || e)
    ElMessage.error(loadError.value)
  } finally {
    loading.value = false
  }
}

const openDialog = (row) => {
  if (row) {
    form.value = {
      _id: row._id,
      guideId: row.guideId || '',
      category: row.category || 'GENERAL',
      title: row.title || '',
      overline: row.overline || '',
      summary: row.summary || '',
      disclaimer: row.disclaimer || '',
      sectionsJson: JSON.stringify(row.sections || [], null, 2),
      statusActive: row.status !== 'inactive',
      version: row.version || 1
    }
  } else {
    form.value = emptyForm()
  }
  dialogVisible.value = true
}

const save = async () => {
  const f = form.value
  if (!f.title?.trim() || !f.summary?.trim()) {
    return ElMessage.warning('标题与摘要必填')
  }
  let sections = []
  try {
    sections = JSON.parse(f.sectionsJson || '[]')
    if (!Array.isArray(sections)) throw new Error('sections must be array')
  } catch {
    return ElMessage.warning('板块 JSON 格式有误')
  }
  const guideId = f.guideId?.trim() || `care_${String(f.category || 'general').toLowerCase()}_v${Date.now()}`
  if (!f._id) {
    const dup = list.value.find((r) => r.guideId === guideId)
    if (dup) return ElMessage.warning(`guideId「${guideId}」已存在，请更换`)
  } else {
    const dup = list.value.find((r) => r.guideId === guideId && r._id !== f._id)
    if (dup) return ElMessage.warning(`guideId「${guideId}」已被其它记录占用`)
  }
  const payload = {
    guideId,
    category: f.category,
    title: f.title.trim(),
    overline: f.overline || f.category,
    summary: f.summary.trim(),
    disclaimer: f.disclaimer || '',
    sections,
    framingAddons: [],
    status: f.statusActive ? 'active' : 'inactive',
    updateTime: Date.now()
  }
  saving.value = true
  try {
    if (f._id) {
      payload.version = (f.version || 1) + 1
      await cdnUpdate('care_guides', f._id, payload)
    } else {
      payload.version = 1
      payload.createTime = Date.now()
      await cdnAdd('care_guides', payload)
    }
    ElMessage.success('已保存')
    dialogVisible.value = false
    refresh()
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || e))
  } finally {
    saving.value = false
  }
}

const toggleStatus = async (row, active) => {
  try {
    await cdnUpdate('care_guides', row._id, {
      status: active ? 'active' : 'inactive',
      updateTime: Date.now()
    })
    row.status = active ? 'active' : 'inactive'
  } catch (e) {
    ElMessage.error('更新状态失败')
  }
}

const remove = (row) => {
  ElMessageBox.confirm(`删除「${row.title}」？`, '确认删除', { type: 'warning' }).then(async () => {
    await cdnRemove('care_guides', row._id)
    ElMessage.success('已删除')
    refresh()
  }).catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

const seedDefaults = async () => {
  seeding.value = true
  try {
    const existing = await fetchCollectionSorted('care_guides', { limit: 100 })
    const byGuideId = new Map(existing.map((r) => [r.guideId, r]))
    let synced = 0
    for (const seed of DEFAULT_SEEDS) {
      const hit = byGuideId.get(seed.guideId)
      if (hit) {
        await cdnUpdate('care_guides', hit._id, {
          ...seed,
          version: (hit.version || 1) + 1,
          updateTime: Date.now()
        })
      } else {
        await cdnAdd('care_guides', { ...seed, createTime: Date.now(), updateTime: Date.now() })
      }
      synced += 1
    }
    ElMessage.success(`已同步 ${synced} 篇默认指南`)
    refresh()
  } catch (e) {
    ElMessage.error('同步失败：' + (e.message || e))
  } finally {
    seeding.value = false
  }
}

onMounted(refresh)
</script>

<style scoped>
.care-container { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #2D6A4F; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 1px; }
.header-actions { display: flex; gap: 8px; align-items: center; }
.filter-bar { margin-bottom: 16px; }
.mod-alert { margin-bottom: 14px; }
.g-title { font-weight: 600; color: #333; }
.g-id { font-size: 11px; color: #999; font-family: monospace; margin-top: 2px; }
.form-hint { font-size: 12px; color: #999; margin-top: 6px; }
</style>
