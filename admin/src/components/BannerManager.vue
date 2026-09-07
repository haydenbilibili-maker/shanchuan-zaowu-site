<template>
  <div class="banner-manager">
    <div class="header">
      <h2>首页轮播配置</h2>
      <el-button type="primary" icon="Plus" @click="openDialog">新增海报</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="banners" v-loading="loading" style="width: 100%">
        <el-table-column label="预览" width="180">
          <template #default="scope">
            <el-image 
              :src="scope.row.httpImage" 
              style="width: 160px; height: 90px; border-radius: 8px;" 
              fit="cover"
              :preview-src-list="[scope.row.httpImage]"
              preview-teleported
              :z-index="5000"
              hide-on-click-modal
            />
          </template>
        </el-table-column>
        <el-table-column prop="title" label="主标题" width="200" />
        <el-table-column prop="subtitle" label="副标题" />
        <el-table-column label="跳转目标">
          <template #default="scope">
            <el-tag size="small" type="info">{{ scope.row.type }}</el-tag>
            <span style="margin-left: 10px; font-size: 12px; color: #666">{{ scope.row.target }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="sort" label="排序权重" width="100" sortable />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="scope">
            <el-button size="small" circle icon="Edit" @click="editItem(scope.row)" />
            <el-button size="small" circle type="danger" icon="Delete" @click="deleteItem(scope.row)" />
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="isEditing ? '编辑海报' : '新增海报'" width="560px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="图片链接">
          <ImageUploadField
            v-model="form.image"
            folder="banners"
            hint="建议 16:9 比例 (800×450px)"
            tip="优先上传；也可粘贴 cloud:// 或 HTTPS。小程序按 FileID/CDN 链接消费。"
            preview-width="200px"
            preview-height="112px"
            :max-size-mb="8"
          />
        </el-form-item>
        
        <el-form-item label="主标题">
          <el-input v-model="form.title" placeholder="如：蓝色闪蝶特展" />
        </el-form-item>
        
        <el-form-item label="副标题">
          <el-input v-model="form.subtitle" placeholder="如：EXPLORE THE UNKNOWN" />
        </el-form-item>

        <el-form-item label="跳转类型">
          <el-radio-group v-model="form.type">
            <el-radio-button label="product">商品</el-radio-button>
            <el-radio-button label="category">分类</el-radio-button>
            <el-radio-button label="booking">预约</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="目标ID" v-if="form.type !== 'booking'">
          <el-input v-model="form.target" placeholder="商品ID 或 分类关键词 (如: insect)" />
        </el-form-item>

        <el-form-item label="排序权重">
          <el-input-number v-model="form.sort" :min="0" :max="999" />
          <span style="margin-left:10px; font-size:12px; color:#999">数字越大越靠前</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveBanner">保存发布</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getTempFileUrl, COLLECTIONS, fetchCollectionSorted } from '../cloud'
import { cdnAdd, cdnUpdate, cdnRemove } from '../utils/cloudbaseCdnDb'
import { ElMessage, ElMessageBox } from 'element-plus'
import ImageUploadField from './ImageUploadField.vue'

const banners = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const isEditing = ref(false)
const form = ref({ image: '', title: '', subtitle: '', type: 'product', target: '', sort: 100 })

const loadBanners = async () => {
  loading.value = true
  try {
    const rows = await fetchCollectionSorted(COLLECTIONS.BANNERS, {
      limit: 200,
      sortFn: (a, b) => (b.sort ?? 0) - (a.sort ?? 0)
    })
    banners.value = await Promise.all(rows.map(async item => ({
      ...item,
      httpImage: await getTempFileUrl(item.image)
    })))
  } catch (e) {
    console.error('加载轮播图失败', e)
    banners.value = []
    ElMessage.error('加载失败: ' + (e.message || '未知错误'))
  } finally {
    loading.value = false
  }
}

const openDialog = () => {
  form.value = { image: '', title: '', subtitle: '', type: 'product', target: '', sort: 100 }
  isEditing.value = false
  dialogVisible.value = true
}

const editItem = (row) => {
  form.value = { ...row }
  isEditing.value = true
  dialogVisible.value = true
}

const saveBanner = async () => {
  if (!form.value.image || !form.value.title) return ElMessage.warning('图片和标题必填')

  const data = {
    image: form.value.image,
    title: form.value.title,
    subtitle: form.value.subtitle,
    type: form.value.type,
    target: form.value.target,
    sort: form.value.sort,
    updateTime: Date.now()
  }

  try {
    if (isEditing.value) {
      await cdnUpdate(COLLECTIONS.BANNERS, form.value._id, data)
      ElMessage.success('更新成功')
    } else {
      data.createTime = Date.now()
      await cdnAdd(COLLECTIONS.BANNERS, data)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    loadBanners()
  } catch (e) {
    console.error('保存失败', e)
    ElMessage.error('操作失败: ' + (e.message || '未知错误'))
  }
}

const deleteItem = (row) => {
  ElMessageBox.confirm('确定删除该海报吗？', '警告', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(async () => {
    try {
      await cdnRemove(COLLECTIONS.BANNERS, row._id)
      ElMessage.success('已删除')
      loadBanners()
    } catch (e) {
      console.error('删除失败', e)
      ElMessage.error('删除失败: ' + (e.message || '未知错误'))
    }
  })
}

onMounted(() => loadBanners())
</script>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
</style>