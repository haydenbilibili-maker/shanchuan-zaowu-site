<template>
  <div class="cat-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>分类管理 / CATEGORIES</h2>
        <span class="subtitle">CATEGORY TREE</span>
      </div>
      <el-button type="primary" color="#d4af37" :icon="Plus" @click="openRootDialog">新增一级分类</el-button>
    </div>

    <div class="layout">
      <!-- 左：一级分类 -->
      <div class="root-pane" v-loading="loading">
        <div class="pane-title">一级分类 (LEVEL 1)</div>
        <div v-for="r in roots" :key="r._id" class="root-row" :class="{ active: currentRoot?._id === r._id }" @click="selectRoot(r)">
          <span class="root-icon">{{ r.icon || '📁' }}</span>
          <div class="root-info">
            <div class="r-name">{{ r.name }}</div>
            <div class="r-sub">{{ getSubCount(r._id) }} 个子分类</div>
          </div>
          <el-dropdown trigger="click" @command="(cmd) => handleRoot(cmd, r)">
            <el-icon class="more-icon"><MoreFilled /></el-icon>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit">编辑</el-dropdown-item>
                <el-dropdown-item command="up">上移</el-dropdown-item>
                <el-dropdown-item command="down">下移</el-dropdown-item>
                <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div v-if="!loading && !roots.length" class="empty-tip">还没有分类，先新增一级分类</div>
      </div>

      <!-- 右：二级分类 -->
      <div class="sub-pane">
        <div class="pane-title">
          <span>二级分类 (LEVEL 2)</span>
          <el-button v-if="currentRoot" type="primary" color="#d4af37" :icon="Plus" size="small" @click="openSubDialog()">新增子分类</el-button>
        </div>
        <div v-if="!currentRoot" class="empty-tip">请选择一级分类</div>
        <el-table v-else :data="subs" stripe>
          <el-table-column label="排序" width="80">
            <template #default="{ row, $index }">
              <el-button-group size="small">
                <el-button :icon="ArrowUp" :disabled="$index === 0" @click="moveSub(row, -1)" />
                <el-button :icon="ArrowDown" :disabled="$index === subs.length - 1" @click="moveSub(row, 1)" />
              </el-button-group>
            </template>
          </el-table-column>
          <el-table-column label="名称" min-width="160">
            <template #default="{ row }">
              <span class="sub-icon">{{ row.icon || '🏷️' }}</span>
              <span>{{ row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="latinName" label="拉丁名 / 副标题" min-width="180" />
          <el-table-column label="商品数" width="100" align="center">
            <template #default="{ row }">{{ row.productCount || 0 }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-switch v-model="row.active" :active-value="true" :inactive-value="false" active-color="#d4af37" @change="toggleSubActive(row)" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160">
            <template #default="{ row }">
              <el-button size="small" link @click="openSubDialog(row)">编辑</el-button>
              <el-button size="small" type="danger" link @click="delSub(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 一级分类弹窗 -->
    <el-dialog v-model="rootDialog" :title="rootForm._id ? '编辑一级分类' : '新增一级分类'" width="500px">
      <el-form :model="rootForm" label-width="100px">
        <el-form-item label="分类名称"><el-input v-model="rootForm.name" /></el-form-item>
        <el-form-item label="图标"><el-input v-model="rootForm.icon" placeholder="emoji 或图片 URL" /></el-form-item>
        <el-form-item label="封面图"><el-input v-model="rootForm.cover" placeholder="cloud:// 或 https://" /></el-form-item>
        <el-form-item label="简介"><el-input v-model="rootForm.desc" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="排序权重"><el-input-number v-model="rootForm.sort" :min="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rootDialog = false">取消</el-button>
        <el-button type="primary" color="#d4af37" @click="saveRoot">保存</el-button>
      </template>
    </el-dialog>

    <!-- 二级分类弹窗 -->
    <el-dialog v-model="subDialog" :title="subForm._id ? '编辑子分类' : '新增子分类'" width="500px">
      <el-form :model="subForm" label-width="100px">
        <el-form-item label="名称"><el-input v-model="subForm.name" /></el-form-item>
        <el-form-item label="拉丁名"><el-input v-model="subForm.latinName" placeholder="例如：Lepidoptera" /></el-form-item>
        <el-form-item label="图标"><el-input v-model="subForm.icon" placeholder="emoji" /></el-form-item>
        <el-form-item label="简介"><el-input v-model="subForm.desc" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="subForm.active" active-color="#d4af37" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="subDialog = false">取消</el-button>
        <el-button type="primary" color="#d4af37" @click="saveSub">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Plus, MoreFilled, ArrowUp, ArrowDown } from '@element-plus/icons-vue'
import {
  fetchCollectionWhere,
  fetchCollectionSorted,
  cdnAdd,
  cdnUpdate,
  cdnRemove,
} from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

const roots = ref([])
const subs = ref([])
const currentRoot = ref(null)
const allSubs = ref([])
const loading = ref(false)
const rootDialog = ref(false)
const subDialog = ref(false)
const rootForm = reactive({ _id: '', name: '', icon: '', cover: '', desc: '', sort: 0 })
const subForm = reactive({ _id: '', name: '', latinName: '', icon: '', desc: '', active: true })

const refresh = async () => {
  loading.value = true
  try {
    roots.value = await fetchCollectionSorted('categories', {
      limit: 500,
      where: { level: 1 },
      sortFn: (a, b) => (a.sort ?? 0) - (b.sort ?? 0)
    })
    allSubs.value = await fetchCollectionSorted('categories', {
      limit: 500,
      where: { level: 2 },
      sortFn: (a, b) => (a.sort ?? 0) - (b.sort ?? 0)
    })
    if (currentRoot.value) {
      selectRoot(currentRoot.value)
    } else if (roots.value.length) {
      selectRoot(roots.value[0])
    }
  } catch (e) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}

const selectRoot = (r) => {
  currentRoot.value = r
  subs.value = allSubs.value.filter(s => s.parentId === r._id)
}

const getSubCount = (parentId) => allSubs.value.filter(s => s.parentId === parentId).length

const openRootDialog = (r) => {
  if (r) {
    Object.assign(rootForm, { ...r })
  } else {
    Object.assign(rootForm, { _id: '', name: '', icon: '', cover: '', desc: '', sort: roots.value.length })
  }
  rootDialog.value = true
}

const saveRoot = async () => {
  if (!rootForm.name) return ElMessage.warning('请输入分类名称')
  const data = {
    name: rootForm.name, icon: rootForm.icon, cover: rootForm.cover,
    desc: rootForm.desc, sort: rootForm.sort, level: 1,
    updateTime: Date.now()
  }
  try {
    if (rootForm._id) {
      await cdnUpdate('categories', rootForm._id, data)
    } else {
      data.createTime = Date.now()
      await cdnAdd('categories', data)
    }
    ElMessage.success('已保存')
    rootDialog.value = false
    refresh()
  } catch (e) {
    ElMessage.error('保存失败：' + e.message)
  }
}

const handleRoot = (cmd, r) => {
  if (cmd === 'edit') openRootDialog(r)
  else if (cmd === 'delete') delRoot(r)
  else if (cmd === 'up') moveRoot(r, -1)
  else if (cmd === 'down') moveRoot(r, 1)
}

const moveRoot = async (r, dir) => {
  const idx = roots.value.findIndex(x => x._id === r._id)
  const target = idx + dir
  if (target < 0 || target >= roots.value.length) return
  const other = roots.value[target]
  await Promise.all([
    cdnUpdate('categories', r._id, { sort: other.sort }),
    cdnUpdate('categories', other._id, { sort: r.sort })
  ])
  refresh()
}

const delRoot = (r) => {
  const subCount = getSubCount(r._id)
  ElMessageBox.confirm(`删除【${r.name}】？该一级分类下有 ${subCount} 个子分类，将一并删除。`, '删除确认', { type: 'warning' }).then(async () => {
    const children = await fetchCollectionWhere('categories', { parentId: r._id }, 500)
    await Promise.all(children.map(c => cdnRemove('categories', c._id)))
    await cdnRemove('categories', r._id)
    ElMessage.success('已删除')
    currentRoot.value = null
    refresh()
  }).catch(() => {})
}

const openSubDialog = (s) => {
  if (s) {
    Object.assign(subForm, { ...s, active: s.active !== false })
  } else {
    Object.assign(subForm, { _id: '', name: '', latinName: '', icon: '', desc: '', active: true })
  }
  subDialog.value = true
}

const saveSub = async () => {
  if (!subForm.name || !currentRoot.value) return ElMessage.warning('请输入名称')
  const data = {
    name: subForm.name, latinName: subForm.latinName, icon: subForm.icon, desc: subForm.desc,
    active: subForm.active, level: 2, parentId: currentRoot.value._id,
    parentName: currentRoot.value.name,
    updateTime: Date.now()
  }
  try {
    if (subForm._id) {
      await cdnUpdate('categories', subForm._id, data)
    } else {
      data.sort = subs.value.length
      data.createTime = Date.now()
      await cdnAdd('categories', data)
    }
    ElMessage.success('已保存')
    subDialog.value = false
    refresh()
  } catch (e) {
    ElMessage.error('保存失败：' + e.message)
  }
}

const toggleSubActive = async (row) => {
  try {
    await cdnUpdate('categories', row._id, { active: row.active })
    ElMessage.success(row.active ? '已启用' : '已停用')
  } catch (e) {
    row.active = !row.active
    ElMessage.error('操作失败')
  }
}

const delSub = (row) => {
  ElMessageBox.confirm(`删除子分类【${row.name}】？`, '删除确认', { type: 'warning' }).then(async () => {
    await cdnRemove('categories', row._id)
    ElMessage.success('已删除')
    refresh()
  }).catch(() => {})
}

const moveSub = async (row, dir) => {
  const idx = subs.value.findIndex(x => x._id === row._id)
  const target = idx + dir
  if (target < 0 || target >= subs.value.length) return
  const other = subs.value[target]
  await Promise.all([
    cdnUpdate('categories', row._id, { sort: other.sort ?? target }),
    cdnUpdate('categories', other._id, { sort: row.sort ?? idx })
  ])
  refresh()
}

onMounted(refresh)
</script>

<style scoped>
.cat-container { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }
.layout { display: grid; grid-template-columns: 300px 1fr; gap: 20px; }
.root-pane, .sub-pane { background: #fff; border-radius: 10px; padding: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.04); }
.pane-title { font-size: 14px; color: #333; font-weight: bold; margin-bottom: 15px; padding-bottom: 8px; border-bottom: 1px dashed #eee; display: flex; justify-content: space-between; align-items: center; }
.root-row { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 8px; cursor: pointer; margin-bottom: 6px; }
.root-row:hover { background: #fafafa; }
.root-row.active { background: #fdf6ec; border-left: 3px solid #d4af37; }
.root-icon { font-size: 22px; }
.root-info { flex: 1; }
.r-name { font-weight: bold; color: #333; }
.r-sub { font-size: 11px; color: #999; }
.more-icon { color: #999; cursor: pointer; }
.sub-icon { font-size: 16px; margin-right: 6px; }
.empty-tip { text-align: center; color: #ccc; padding: 40px; font-size: 13px; }
</style>
