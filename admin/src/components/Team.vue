<template>
  <div class="team-container">
    <div class="panel-header">
      <div class="panel-header-text">
        <h2>{{ pageTitle }}</h2>
        <p class="panel-sub">{{ pageSubtitle }}</p>
      </div>
    </div>

    <div v-if="section === 'framer'" class="framer-section">
      <div class="action-bar">
        <div class="tip">管理品牌核心资产——手作师档案，展示于小程序“名师”板块。</div>
        <el-button type="primary" :icon="Plus" @click="openFramerDialog()">签约新标本师</el-button>
      </div>

      <div class="framer-grid" v-loading="loading">
        <div v-for="f in framerList" :key="f._id" class="framer-card">
          <div class="card-status">
            <el-tag v-if="f.active" type="success" effect="dark" size="small">签约中</el-tag>
            <el-tag v-else type="info" effect="dark" size="small">已隐藏</el-tag>
          </div>
          
          <div class="card-visual">
            <el-avatar :size="80" :src="f.avatar" class="avatar-box">
              {{ f.name.charAt(0) }}
            </el-avatar>
            <div class="f-name">{{ f.name }}</div>
            <div class="f-title">{{ f.title }}</div>
          </div>

          <div class="card-content">
            <div class="f-tags">
              <span v-for="(tag, idx) in (f.tags || [])" :key="idx" class="tag-item">{{ tag }}</span>
            </div>
            <div class="f-desc">{{ f.desc }}</div>
          </div>

          <div class="card-footer">
            <el-switch
              v-model="f.active"
              size="small"
              inline-prompt
              active-text="显"
              inactive-text="隐"
              @change="toggleFramerStatus(f)"
            />
            <div class="actions">
              <el-button link type="primary" :icon="Edit" @click="openFramerDialog(f)">编辑</el-button>
              <el-button link type="danger" :icon="Delete" @click="deleteFramer(f)">解约</el-button>
            </div>
          </div>
        </div>

        <div class="framer-card add-placeholder" @click="openFramerDialog()">
          <el-icon :size="40"><Plus /></el-icon>
          <span>添加新成员</span>
        </div>
      </div>
    </div>

    <div v-if="section === 'staff'" class="staff-section unified-staff-wrap">
      <div class="action-bar">
        <div class="tip">
          与「员工薪酬管理」「店铺管理」门店员工 Tab 使用同一套本地花名册；门店店员绑定门店后将同步至对应店铺详情。
          小程序店长登录账号仍使用云库 <code>staffs</code>，与本地花名册独立，需另行维护。
        </div>
      </div>
      <UnifiedEmployeePanel />
    </div>

    <el-dialog v-model="framerDialog.visible" :title="framerDialog.isEdit ? '编辑档案' : '录入标本师'" width="500px">
      <el-form :model="framerForm" label-width="80px">
        <el-form-item label="姓名"><el-input v-model="framerForm.name" placeholder="输入姓名或艺名" /></el-form-item>
        <el-form-item label="头衔"><el-input v-model="framerForm.title" placeholder="如：首席标本制作师" /></el-form-item>
        <el-form-item label="头像地址"><el-input v-model="framerForm.avatar" placeholder="请输入图片URL (暂不支持直接上传)" /></el-form-item>
        <el-form-item label="擅长领域"><el-input v-model="framerForm.tagsStr" placeholder="用逗号分隔，如：昆虫, 植物封存" /></el-form-item>
        <el-form-item label="个人简介"><el-input v-model="framerForm.desc" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="framerDialog.visible = false">取消</el-button>
          <el-button type="primary" @click="saveFramer">确认保存</el-button>
        </span>
      </template>
    </el-dialog>

  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { Plus, Edit, Delete } from '@element-plus/icons-vue'
import UnifiedEmployeePanel from './UnifiedEmployeePanel.vue'
import { db, loginToCloud } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

const props = defineProps({
  /** 由侧栏 Tab 决定：framer=标本师管理，staff=员工花名册 */
  initialSection: {
    type: String,
    default: 'framer',
    validator: (v) => v === 'framer' || v === 'staff'
  }
})

const section = computed(() => props.initialSection)

const pageTitle = computed(() =>
  section.value === 'framer' ? '标本师管理' : '员工花名册'
)
const pageSubtitle = computed(() =>
  section.value === 'framer'
    ? '签约标本师档案 · 同步小程序「名师」展示'
    : '总部职能与门店店员主数据 · 与薪酬、店铺员工联动'
)

const loading = ref(false)

// --- 标本师逻辑 ---
const framerList = ref([])
const framerDialog = reactive({ visible: false, isEdit: false })
const framerForm = reactive({ _id: null, name: '', title: '', desc: '', avatar: '', tagsStr: '', active: true })

const fetchFramers = async () => {
  loading.value = true
  try {
    // 确保数据库连接
    const connected = await loginToCloud()
    if (!connected) {
      console.error('数据库连接失败')
      loading.value = false
      return
    }
    
    const res = await db.collection('framers').orderBy('createTime', 'desc').get()
    // 兼容处理 tags
    framerList.value = res.data.map(i => ({...i, tags: i.tags || []}))
  } catch(e) {
    console.error('加载名师手作失败', e)
  } finally { 
    loading.value = false 
  }
}

const openFramerDialog = (row = null) => {
  framerDialog.isEdit = !!row
  if(row) {
    Object.assign(framerForm, row, { tagsStr: (row.tags || []).join(',') })
  } else {
    Object.assign(framerForm, { _id: null, name: '', title: '', desc: '', avatar: '', tagsStr: '', active: true })
  }
  framerDialog.visible = true
}

const saveFramer = async () => {
  if(!framerForm.name) return ElMessage.warning('姓名必填')
  
  try {
    const connected = await loginToCloud()
    if (!connected) {
      ElMessage.error('数据库连接失败')
      return
    }
    
    const data = {
      ...framerForm,
      tags: framerForm.tagsStr.split(/[,，]/).map(s => s.trim()).filter(Boolean)
    }
    delete data.tagsStr
    delete data._id

    if(framerDialog.isEdit) {
      await db.collection('framers').doc(framerForm._id).update(data)
    } else {
      await db.collection('framers').add({ ...data, createTime: Date.now() })
    }
    ElMessage.success('保存成功')
    framerDialog.visible = false
    fetchFramers()
  } catch(e) { 
    console.error('保存失败', e)
    ElMessage.error('保存失败: ' + (e.message || '未知错误')) 
  }
}

const deleteFramer = (row) => {
  ElMessageBox.confirm('确定解约并删除该档案吗？').then(async () => {
    try {
      const connected = await loginToCloud()
      if (!connected) {
        ElMessage.error('数据库连接失败')
        return
      }
      await db.collection('framers').doc(row._id).remove()
      fetchFramers()
    } catch(e) {
      console.error('删除失败', e)
      ElMessage.error('删除失败')
    }
  })
}

const toggleFramerStatus = async (row) => {
  try {
    const connected = await loginToCloud()
    if (!connected) {
      ElMessage.error('数据库连接失败')
      return
    }
    await db.collection('framers').doc(row._id).update({ active: row.active })
  } catch(e) {
    console.error('状态更新失败', e)
    row.active = !row.active // 回滚
  }
}

onMounted(() => {
  if (props.initialSection === 'framer') fetchFramers()
})
</script>

<style scoped>
.team-container { height: 100%; display: flex; flex-direction: column; }
.panel-header { margin-bottom: 20px; }
.panel-header-text { display: flex; flex-direction: column; gap: 6px; }
.panel-header h2 { margin: 0; color: #333; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
.panel-sub { margin: 0; color: #888; font-size: 13px; line-height: 1.5; max-width: 52rem; }

.action-bar { display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 15px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.03); }
.tip { color: #999; font-size: 13px; }

/* 标本师 Grid 布局 */
.framer-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px; }

/* 标本师卡片设计 */
.framer-card { 
  background: #fff; border-radius: 12px; overflow: hidden; position: relative; 
  border: 1px solid #eee; transition: all 0.3s; 
  display: flex; flex-direction: column;
}
.framer-card:hover { transform: translateY(-5px); box-shadow: 0 10px 30px rgba(0,0,0,0.1); border-color: #d4af37; }

.card-status { position: absolute; top: 10px; right: 10px; z-index: 2; }

.card-visual { 
  height: 140px; background: linear-gradient(135deg, #2b2b2b, #1a1a1a); 
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: #fff; padding-top: 20px;
}
.avatar-box { border: 3px solid #d4af37; font-size: 24px; background: #333; font-weight: bold; margin-bottom: 10px; }
.f-name { font-size: 18px; font-weight: bold; letter-spacing: 1px; }
.f-title { font-size: 12px; color: #d4af37; margin-top: 2px; }

.card-content { padding: 15px; flex: 1; }
.f-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
.tag-item { font-size: 10px; background: #f5f5f5; padding: 2px 6px; border-radius: 4px; color: #666; }
.f-desc { font-size: 12px; color: #888; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.card-footer { 
  padding: 10px 15px; border-top: 1px solid #f5f5f5; background: #fafafa;
  display: flex; justify-content: space-between; align-items: center;
}

/* 占位卡片 */
.add-placeholder {
  border: 2px dashed #ddd; background: transparent; display: flex; align-items: center; justify-content: center;
  flex-direction: column; color: #aaa; cursor: pointer; min-height: 280px;
}
.add-placeholder:hover { border-color: #d4af37; color: #d4af37; background: rgba(212, 175, 55, 0.05); }
.add-placeholder span { margin-top: 10px; font-size: 14px; }

/* 表格卡片 */
.table-card { border-radius: 8px; border: none; }
</style>