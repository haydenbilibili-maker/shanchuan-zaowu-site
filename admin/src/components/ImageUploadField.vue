<template>
  <div class="image-upload-field">
    <div v-if="previewUrl" class="preview-wrap">
      <el-image
        :src="previewUrl"
        :style="{ width: previewWidth, height: previewHeight }"
        fit="cover"
        :preview-src-list="[previewUrl]"
        preview-teleported
        hide-on-click-modal
      />
      <el-button
        v-if="clearable && modelValue"
        class="clear-btn"
        size="small"
        type="danger"
        link
        @click="clear"
      >
        清除
      </el-button>
    </div>

    <div class="actions">
      <el-input
        :model-value="modelValue"
        :placeholder="placeholder"
        clearable
        @update:model-value="onInput"
      >
        <template v-if="hint" #append>
          <el-tooltip :content="hint" placement="top">
            <el-icon><InfoFilled /></el-icon>
          </el-tooltip>
        </template>
      </el-input>
      <el-upload
        accept="image/*"
        :show-file-list="false"
        :disabled="uploading"
        :http-request="handleUpload"
        :before-upload="beforeUpload"
      >
        <el-button type="primary" plain :icon="Upload" :loading="uploading">
          {{ uploading ? '上传中…' : uploadLabel }}
        </el-button>
      </el-upload>
    </div>
    <p v-if="tip" class="tip">{{ tip }}</p>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Upload, InfoFilled } from '@element-plus/icons-vue'
import { uploadAdminBinary, getTempFileUrl } from '../cloud'

const props = defineProps({
  modelValue: { type: String, default: '' },
  /** 云存储目录前缀，如 banners / content / categories */
  folder: { type: String, default: 'admin-images' },
  placeholder: {
    type: String,
    default: '上传后自动填入，也可粘贴 cloud:// 或 HTTPS 链接',
  },
  hint: { type: String, default: '' },
  tip: { type: String, default: '支持 JPG / PNG / WebP / GIF，单张不超过限制体积' },
  uploadLabel: { type: String, default: '上传图片' },
  maxSizeMb: { type: Number, default: 5 },
  previewWidth: { type: String, default: '160px' },
  previewHeight: { type: String, default: '90px' },
  clearable: { type: Boolean, default: true },
})

const emit = defineEmits(['update:modelValue', 'uploaded'])

const uploading = ref(false)
const previewUrl = ref('')

async function refreshPreview(val) {
  const v = String(val || '').trim()
  if (!v) {
    previewUrl.value = ''
    return
  }
  try {
    previewUrl.value = (await getTempFileUrl(v)) || v
  } catch {
    previewUrl.value = v.startsWith('http') ? v : ''
  }
}

watch(
  () => props.modelValue,
  (v) => {
    refreshPreview(v)
  },
  { immediate: true }
)

onMounted(() => refreshPreview(props.modelValue))

function onInput(val) {
  emit('update:modelValue', val == null ? '' : String(val))
}

function clear() {
  emit('update:modelValue', '')
  previewUrl.value = ''
}

function beforeUpload(file) {
  const type = file?.type || ''
  if (type && !type.startsWith('image/')) {
    ElMessage.error('仅支持图片文件（image/*）')
    return false
  }
  const maxBytes = Math.max(0.5, props.maxSizeMb) * 1024 * 1024
  if (file.size > maxBytes) {
    ElMessage.error(`图片过大，请压缩到 ${props.maxSizeMb}MB 以内`)
    return false
  }
  return true
}

async function handleUpload(opt) {
  uploading.value = true
  try {
    const fileID = await uploadAdminBinary(opt.file, props.folder)
    emit('update:modelValue', fileID)
    emit('uploaded', fileID)
    await refreshPreview(fileID)
    opt.onSuccess?.({ fileID }, opt.file)
    ElMessage.success('图片已上传')
  } catch (e) {
    opt.onError?.(e)
    ElMessage.error('上传失败：' + (e?.message || '请检查登录态与云存储权限'))
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.image-upload-field {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.preview-wrap {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}

.preview-wrap :deep(.el-image) {
  border-radius: 8px;
  border: 1px solid #e8e5de;
  background: #fafaf5;
  overflow: hidden;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  width: 100%;
}

.actions :deep(.el-input) {
  flex: 1;
  min-width: 200px;
}

.tip {
  margin: 0;
  font-size: 12px;
  color: #6b6560;
  line-height: 1.4;
}

.clear-btn {
  flex-shrink: 0;
}
</style>
