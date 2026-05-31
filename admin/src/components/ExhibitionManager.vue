<template>
  <div class="exhibition-manager">
    <div class="header">
      <h2>专题策展 CMS</h2>
      <el-button type="primary" icon="Plus" @click="openDialog">新建专题</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="wikis" v-loading="loading" style="width: 100%">
        <el-table-column label="封面" width="100">
          <template #default="scope">
            <el-image 
              :src="scope.row.httpCover" 
              style="width: 80px; height: 100px; border-radius: 4px;" 
              fit="cover"
            />
          </template>
        </el-table-column>
        <el-table-column prop="title" label="专题标题" width="200">
           <template #default="scope">
              <div style="font-weight:bold">{{scope.row.title}}</div>
              <div style="font-size:12px; color:#999">{{scope.row.latinName}}</div>
           </template>
        </el-table-column>
        <el-table-column prop="brief" label="导语/摘要" show-overflow-tooltip />
        <el-table-column label="标签">
          <template #default="scope">
            <el-tag v-for="t in scope.row.tags" :key="t" size="small" style="margin-right:4px">{{t}}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="scope">
            <el-button size="small" circle icon="Edit" @click="editItem(scope.row)" />
            <el-button size="small" circle type="danger" icon="Delete" @click="deleteItem(scope.row)" />
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="isEditing ? '编辑专题' : '新建专题'" width="800px" top="5vh">
      <el-form :model="form" label-width="80px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="中文标题">
              <el-input v-model="form.title" placeholder="如：黄金时代的余晖" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="副标/拉丁">
              <el-input v-model="form.latinName" placeholder="如：THE GOLDEN AGE" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="封面图">
          <el-input v-model="form.coverImage" placeholder="请输入图片链接 (云存储ID或HTTPS)" />
        </el-form-item>

        <el-form-item label="导语">
          <el-input v-model="form.brief" type="textarea" :rows="2" placeholder="用于列表页展示的简短介绍" />
        </el-form-item>

        <el-form-item label="标签">
          <el-input v-model="form.tagsStr" placeholder="用逗号分隔，如：昆虫,历史,收藏" />
        </el-form-item>

        <el-divider content-position="left">富文本内容 (HTML)</el-divider>
        
        <el-form-item label-width="0">
          <el-input 
            v-model="form.content" 
            type="textarea" 
            :rows="15" 
            placeholder="在此输入 HTML 内容。支持 <p>, <img>, <blockquote> 等标签。小程序端 mp-html 组件会自动解析。"
            style="font-family: monospace; font-size: 14px; background: #f9f9f9;"
          />
        </el-form-item>
        
        <div class="editor-tips">
           提示：支持 &lt;p&gt;, &lt;img&gt;, &lt;blockquote&gt; 等标签。图片请使用网络链接。
        </div>

      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveWiki">发布专题</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { db, getTempFileUrl, loginToCloud, COLLECTIONS } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

const wikis = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const isEditing = ref(false)
const form = ref({ 
  title: '', latinName: '', coverImage: '', brief: '', 
  content: '<p>在此处撰写精彩内容...</p>', 
  tagsStr: '',
  type: 'exhibition'
})

const loadWikis = async () => {
  loading.value = true
  try {
    // 确保数据库连接
    const connected = await loginToCloud()
    if (!connected) {
      ElMessage.error('数据库连接失败，请检查网络或配置')
      return
    }
    
    // 读取 cms_wikis 集合（小程序使用的集合名）
    const res = await db.collection(COLLECTIONS.CMS_WIKIS).orderBy('_createTime', 'desc').get()
    
    wikis.value = await Promise.all(res.data.map(async item => ({
      ...item,
      httpCover: await getTempFileUrl(item.coverImage || item.cover)
    })))
  } catch (e) {
    console.error('加载专题失败', e)
    ElMessage.error('加载失败: ' + (e.message || '未知错误'))
    // 如果集合不存在，列表为空
    wikis.value = []
  } finally {
    loading.value = false
  }
}

const openDialog = () => {
  form.value = { 
    title: '', latinName: '', coverImage: '', brief: '', 
    content: '<p>在此处撰写精彩内容...</p>', 
    tagsStr: '专题',
    type: 'exhibition'
  }
  isEditing.value = false
  dialogVisible.value = true
}

const editItem = (row) => {
  form.value = { 
    ...row, 
    tagsStr: (row.tags || []).join(',') 
  }
  isEditing.value = true
  dialogVisible.value = true
}

const saveWiki = async () => {
  if (!form.value.title) return ElMessage.warning('标题必填')
  
  const connected = await loginToCloud()
  if (!connected) {
    ElMessage.error('数据库连接失败')
    return
  }
  
  const tags = form.value.tagsStr.split(/[,，]/).map(s => s.trim()).filter(s => s)
  
  const data = {
    title: form.value.title,
    latinName: form.value.latinName,
    coverImage: form.value.coverImage,
    cover: form.value.coverImage, // 兼容小程序字段名
    brief: form.value.brief,
    content: form.value.content,
    tags: tags,
    type: 'exhibition', // 固定为专题类型
    status: 'published', // 发布状态
    _updateTime: Date.now()
  }

  try {
    if (isEditing.value) {
      await db.collection(COLLECTIONS.CMS_WIKIS).doc(form.value._id).update(data)
      ElMessage.success('更新成功')
    } else {
      data._createTime = Date.now()
      data.createTime = Date.now()
      await db.collection(COLLECTIONS.CMS_WIKIS).add(data)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    loadWikis()
  } catch (e) {
    console.error('保存失败', e)
    ElMessage.error('保存失败: ' + (e.message || '未知错误'))
  }
}

const deleteItem = (row) => {
  ElMessageBox.confirm('确定删除该专题吗？', '警告', { type: 'warning' }).then(async () => {
    try {
      const connected = await loginToCloud()
      if (!connected) {
        ElMessage.error('数据库连接失败')
        return
      }
      await db.collection(COLLECTIONS.CMS_WIKIS).doc(row._id).remove()
      ElMessage.success('已删除')
      loadWikis()
    } catch (e) {
      console.error('删除失败', e)
      ElMessage.error('删除失败: ' + (e.message || '未知错误'))
    }
  })
}

onMounted(() => loadWikis())
</script>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.editor-tips { font-size: 12px; color: #999; margin-top: 10px; }
</style>