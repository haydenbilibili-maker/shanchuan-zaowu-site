<template>
  <div class="rich-html-editor">
    <div class="rich-toolbar" role="toolbar">
      <button type="button" title="加粗" @mousedown.prevent="exec('bold')"><b>B</b></button>
      <button type="button" title="斜体" @mousedown.prevent="exec('italic')"><i>I</i></button>
      <button type="button" title="下划线" @mousedown.prevent="exec('underline')"><u>U</u></button>
      <span class="sep" />
      <button type="button" title="二级标题" @mousedown.prevent="exec('formatBlock', 'h2')">H2</button>
      <button type="button" title="段落" @mousedown.prevent="exec('formatBlock', 'p')">P</button>
      <button type="button" title="无序列表" @mousedown.prevent="exec('insertUnorderedList')">• 列表</button>
      <button type="button" title="有序列表" @mousedown.prevent="exec('insertOrderedList')">1. 列表</button>
      <span class="sep" />
      <button type="button" title="插入链接" @mousedown.prevent="insertLink">链接</button>
      <button type="button" title="清除格式" @mousedown.prevent="exec('removeFormat')">清除</button>
      <el-upload
        class="img-upload"
        :show-file-list="false"
        accept="image/*"
        :http-request="insertImage"
      >
        <button type="button" title="插入图片（HTTPS 临时链，建议优先用详情图）" :disabled="uploading">
          {{ uploading ? '上传中…' : '插图' }}
        </button>
      </el-upload>
    </div>
    <div
      ref="editorRef"
      class="rich-body"
      contenteditable="true"
      data-placeholder="输入藏品图文描述，支持加粗/列表/链接…"
      @input="onInput"
      @paste="onPaste"
      @blur="onInput"
    />
    <p class="rich-hint">写入字段 detailHtml；插图会上传云存储并嵌入 HTTPS 临时链接（可能过期）。长期展示图请用「详情图」。</p>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { uploadAdminBinary, getTempFileUrl } from '../cloud'

const props = defineProps({
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'image-uploaded'])

const editorRef = ref(null)
const uploading = ref(false)
let syncing = false

function sanitizeHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
}

function setEditorHtml(html) {
  const el = editorRef.value
  if (!el) return
  const next = sanitizeHtml(html)
  if (el.innerHTML === next) return
  syncing = true
  el.innerHTML = next || ''
  nextTick(() => { syncing = false })
}

function onInput() {
  if (syncing || !editorRef.value) return
  emit('update:modelValue', sanitizeHtml(editorRef.value.innerHTML))
}

function exec(cmd, value = null) {
  editorRef.value?.focus()
  document.execCommand(cmd, false, value)
  onInput()
}

function insertLink() {
  const url = window.prompt('链接地址（https://…）')
  if (!url) return
  exec('createLink', url.trim())
}

async function insertImage(opt) {
  uploading.value = true
  try {
    const fileID = await uploadAdminBinary(opt.file, 'products')
    const url = await getTempFileUrl(fileID)
    if (!url) throw new Error('未获取到图片链接')
    editorRef.value?.focus()
    document.execCommand('insertImage', false, url)
    onInput()
    emit('image-uploaded', fileID)
    ElMessage.success('图片已插入（建议同时保留在详情图）')
  } catch (e) {
    ElMessage.error('插图失败: ' + (e.message || '未知错误'))
  } finally {
    uploading.value = false
  }
}

function onPaste(e) {
  // 粘贴纯文本时避免带入危险属性；富文本粘贴仍走浏览器默认，blur/input 时 sanitize
  const text = e.clipboardData?.getData('text/plain')
  const html = e.clipboardData?.getData('text/html')
  if (html) return
  if (text) {
    e.preventDefault()
    document.execCommand('insertText', false, text)
  }
}

watch(
  () => props.modelValue,
  (v) => {
    if (!editorRef.value) return
    if (sanitizeHtml(editorRef.value.innerHTML) === sanitizeHtml(v)) return
    setEditorHtml(v)
  },
)

onMounted(() => setEditorHtml(props.modelValue))
</script>

<style scoped>
.rich-html-editor {
  width: 100%;
  border: 1px solid var(--el-border-color, #E8E5DE);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}
.rich-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  padding: 8px;
  background: #FAF6ED;
  border-bottom: 1px solid #E8E5DE;
}
.rich-toolbar button {
  border: 1px solid #E0CFA3;
  background: #fff;
  color: #33302C;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  line-height: 1.2;
}
.rich-toolbar button:hover:not(:disabled) {
  border-color: #C4A76C;
  color: #2D5A3F;
}
.rich-toolbar button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.sep {
  width: 1px;
  height: 18px;
  background: #E0CFA3;
  margin: 0 4px;
}
.img-upload {
  display: inline-flex;
}
.rich-body {
  min-height: 160px;
  max-height: 320px;
  overflow: auto;
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.7;
  color: #4A4540;
  outline: none;
}
.rich-body:empty:before {
  content: attr(data-placeholder);
  color: #A09A90;
}
.rich-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}
.rich-body :deep(h2) {
  font-size: 16px;
  margin: 0.6em 0 0.3em;
  color: #33302C;
}
.rich-hint {
  margin: 0;
  padding: 6px 12px 10px;
  font-size: 11px;
  color: #6B6560;
  background: #Fafaf5;
  border-top: 1px solid #E8E5DE;
}
</style>
