<template>
  <div class="content-manager">
    <div class="header">
      <h2>内容管理 / CMS</h2>
      <div class="header-actions">
        <el-radio-group v-model="contentType" @change="switchType" size="small">
          <el-radio-button label="exhibition">专题策展</el-radio-button>
          <el-radio-button label="article">知识文章</el-radio-button>
        </el-radio-group>
        <el-button 
          type="primary" 
 
          :icon="MagicStick"
          @click="showAIDialog = true"
          title="AI内容创作助手"
        >
          AI助手
        </el-button>
        <el-button type="primary" icon="Plus" @click="openDialog">新建{{contentType === 'exhibition' ? '专题' : '文章'}}</el-button>
      </div>
    </div>

    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" style="width: 100%">
        <el-table-column label="封面" width="100">
          <template #default="scope">
            <el-image 
              :src="scope.row.httpCover" 
              style="width: 80px; height: 100px; border-radius: 4px;" 
              fit="cover"
            />
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" width="200">
           <template #default="scope">
              <div style="font-weight:bold">{{scope.row.title}}</div>
              <div style="font-size:12px; color:#999" v-if="contentType === 'exhibition'">{{scope.row.latinName}}</div>
              <div style="font-size:12px; color:#999" v-else>{{getCategoryText(scope.row.category)}}</div>
           </template>
        </el-table-column>
        <el-table-column prop="brief" label="摘要" show-overflow-tooltip />
        <el-table-column label="标签">
          <template #default="scope">
            <el-tag v-for="t in scope.row.tags" :key="t" size="small" style="margin-right:4px">{{t}}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" v-if="contentType === 'article'">
          <template #default="scope">
            <el-tag v-if="scope.row.status === 'published'" type="success" size="small">已发布</el-tag>
            <el-tag v-else type="info" size="small">草稿</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="统计" width="150" v-if="contentType === 'article'">
          <template #default="scope">
            <div style="font-size:12px; color:#999">
              浏览: {{scope.row.stats?.views || 0}} | 
              点赞: {{scope.row.stats?.likes || 0}}
            </div>
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

    <!-- 统一的编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="isEditing ? `编辑${contentType === 'exhibition' ? '专题' : '文章'}` : `新建${contentType === 'exhibition' ? '专题' : '文章'}`" width="900px" top="3vh">
      <el-form :model="form" label-width="90px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="标题">
              <el-input v-model="form.title" :placeholder="contentType === 'exhibition' ? '如：黄金时代的余晖' : '请输入文章标题'" />
            </el-form-item>
          </el-col>
          <el-col :span="12" v-if="contentType === 'exhibition'">
            <el-form-item label="副标/拉丁">
              <el-input v-model="form.latinName" placeholder="如：THE GOLDEN AGE" />
            </el-form-item>
          </el-col>
          <el-col :span="12" v-else>
            <el-form-item label="分类">
              <el-select v-model="form.category" placeholder="选择分类" style="width:100%">
                <el-option label="标本知识" value="knowledge" />
                <el-option label="艺术鉴赏" value="art" />
                <el-option label="制作工艺" value="craft" />
                <el-option label="藏品故事" value="story" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20" v-if="contentType === 'article'">
          <el-col :span="12">
            <el-form-item label="作者">
              <el-input v-model="form.author" placeholder="默认：山海造物" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-radio-group v-model="form.status">
                <el-radio label="published">已发布</el-radio>
                <el-radio label="draft">草稿</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="封面图">
          <ImageUploadField
            v-model="form.coverImage"
            folder="content"
            tip="优先上传封面；也可粘贴 cloud:// 或 HTTPS"
            preview-width="160px"
            preview-height="100px"
          />
        </el-form-item>

        <el-form-item label="摘要">
          <el-input v-model="form.brief" type="textarea" :rows="2" placeholder="用于列表页展示的简短介绍" />
        </el-form-item>

        <el-form-item label="标签">
          <el-input v-model="form.tagsStr" placeholder="用逗号分隔，如：昆虫,历史,收藏" />
        </el-form-item>

        <el-form-item label="视频链接" v-if="contentType === 'article'">
          <el-input v-model="form.videoUrl" placeholder="可选：文章视频链接" />
        </el-form-item>

        <el-divider content-position="left">富文本内容 (HTML)</el-divider>
        
        <el-form-item label-width="0">
          <el-input 
            v-model="form.content" 
            type="textarea" 
            :rows="18" 
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
          <el-button type="primary" @click="saveContent">发布{{contentType === 'exhibition' ? '专题' : '文章'}}</el-button>
        </span>
      </template>
    </el-dialog>

    <!-- AI内容创作助手弹窗 -->
    <el-dialog
      v-model="showAIDialog"
      title="AI内容创作助手"
      width="1000px"
      :close-on-click-modal="false"
      class="content-ai-dialog"
      destroy-on-close
    >
      <ContentCreationAI @apply-content="handleApplyAIContent" />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { getTempFileUrl, COLLECTIONS, fetchCollectionSorted, cdnAdd, cdnUpdate, cdnRemove } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MagicStick } from '@element-plus/icons-vue'
import ContentCreationAI from './ai/ContentCreationAI.vue'
import ImageUploadField from './ImageUploadField.vue'

const contentType = ref('exhibition') // 'exhibition' | 'article'
const list = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const isEditing = ref(false)
const showAIDialog = ref(false)
const form = ref({})

// 获取分类文本
const getCategoryText = (category) => {
  const map = {
    knowledge: '📚 标本知识',
    art: '🎨 艺术鉴赏',
    craft: '🔧 制作工艺',
    story: '📖 藏品故事'
  }
  return map[category] || category
}

// 切换内容类型
const switchType = () => {
  loadContent()
}

// 加载内容列表
const loadContent = async () => {
  loading.value = true
  try {
    const collection = contentType.value === 'exhibition' ? COLLECTIONS.CMS_WIKIS : 'articles'
    const rows = await fetchCollectionSorted(collection, {
      limit: 300,
      sortFn: (a, b) => (b._createTime || b.createTime || 0) - (a._createTime || a.createTime || 0)
    })
    list.value = await Promise.all(rows.map(async item => ({
      ...item,
      httpCover: await getTempFileUrl(item.coverImage || item.cover || '')
    })))
  } catch (e) {
    console.error('加载内容失败', e)
    ElMessage.error('加载失败: ' + (e.message || '未知错误'))
    list.value = []
  } finally {
    loading.value = false
  }
}

// 打开编辑弹窗
const openDialog = () => {
  form.value = {
    title: '',
    latinName: '',
    coverImage: '',
    brief: '',
    content: '<p>在此处撰写精彩内容...</p>',
    tagsStr: contentType.value === 'exhibition' ? '专题' : '',
    category: 'knowledge',
    author: '山海造物',
    status: 'published',
    videoUrl: '',
    type: contentType.value
  }
  isEditing.value = false
  dialogVisible.value = true
}

// 编辑项目
const editItem = (row) => {
  form.value = { 
    ...row, 
    tagsStr: (row.tags || []).join(',')
  }
  isEditing.value = true
  dialogVisible.value = true
}

// 保存内容
const saveContent = async () => {
  if (!form.value.title) return ElMessage.warning('标题必填')

  const tags = form.value.tagsStr.split(/[,，]/).map(s => s.trim()).filter(s => s)
  const collection = contentType.value === 'exhibition' ? COLLECTIONS.CMS_WIKIS : 'articles'
  
  const data = {
    title: form.value.title,
    brief: form.value.brief,
    content: form.value.content,
    tags: tags,
    coverImage: form.value.coverImage,
    type: contentType.value,
    _updateTime: Date.now()
  }

  // 专题特有字段
  if (contentType.value === 'exhibition') {
    data.latinName = form.value.latinName
    data.cover = form.value.coverImage // 兼容字段
    data.status = 'published'
  }

  // 文章特有字段
  if (contentType.value === 'article') {
    data.category = form.value.category
    data.author = form.value.author || '山海造物'
    data.status = form.value.status || 'published'
    data.videoUrl = form.value.videoUrl || ''
    // 初始化统计
    if (!isEditing.value) {
      data.stats = {
        views: 0,
        likes: 0,
        comments: 0
      }
    }
  }

  try {
    if (isEditing.value) {
      await cdnUpdate(collection, form.value._id, data)
      ElMessage.success('更新成功')
    } else {
      data._createTime = Date.now()
      data.createTime = Date.now()
      await cdnAdd(collection, data)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    loadContent()
  } catch (e) {
    console.error('保存失败', e)
    ElMessage.error('保存失败: ' + (e.message || '未知错误'))
  }
}

// 删除内容
const deleteItem = (row) => {
  const typeText = contentType.value === 'exhibition' ? '专题' : '文章'
  ElMessageBox.confirm(`确定删除该${typeText}吗？`, '警告', { type: 'warning' }).then(async () => {
    try {
      const collection = contentType.value === 'exhibition' ? COLLECTIONS.CMS_WIKIS : 'articles'
      await cdnRemove(collection, row._id)
      ElMessage.success('已删除')
      loadContent()
    } catch (e) {
      console.error('删除失败', e)
      ElMessage.error('删除失败: ' + (e.message || '未知错误'))
    }
  })
}

// 处理AI生成的内容应用到表单
const handleApplyAIContent = (data) => {
  if (!dialogVisible.value) {
    // 如果对话框未打开，先打开它
    openDialog()
  }
  
  // 解析AI生成的内容
  const htmlContent = data.htmlContent || data.content || ''
  const plainText = htmlContent.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
  
  // 尝试从内容中提取标题、摘要等信息
  const titleMatch = plainText.match(/^#\s*(.+?)$/m) || plainText.match(/^(.+?)\n/m)
  const title = titleMatch ? titleMatch[1].trim() : ''
  
  // 提取摘要（第一段或前150字）
  const paragraphs = plainText.split('\n\n').filter(p => p.trim())
  const brief = paragraphs[0] ? paragraphs[0].substring(0, 150).trim() : ''
  
  // 提取标签（如果内容中包含标签信息）
  const tagMatch = plainText.match(/标签[：:]\s*([^\n]+)/i)
  const tagsStr = tagMatch ? tagMatch[1].trim() : ''
  
  // 应用到表单
  if (data.type === 'exhibition') {
    form.value.title = title || form.value.title
    form.value.brief = brief || form.value.brief
    form.value.content = htmlContent || plainText
    if (tagsStr) {
      form.value.tagsStr = tagsStr
    }
  } else if (data.type === 'article') {
    form.value.title = title || form.value.title
    form.value.brief = brief || form.value.brief
    form.value.content = htmlContent || plainText
    if (tagsStr) {
      form.value.tagsStr = tagsStr
    }
  }
  
  // 关闭AI对话框
  showAIDialog.value = false
  ElMessage.success('内容已应用到表单，请检查并调整')
}

onMounted(() => loadContent())
</script>

<style scoped>
.header { 
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  margin-bottom: 20px; 
}

.header-actions {
  display: flex;
  gap: 20px;
  align-items: center;
}

.editor-tips { 
  font-size: 12px; 
  color: #999; 
  margin-top: 10px; 
}

:deep(.content-ai-dialog) {
  .el-dialog__body {
    padding: 20px;
  }
}
</style>





