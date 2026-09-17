<template>
  <div class="gov-root">
    <header class="gov-header">
      <div class="gov-header-text">
        <h1 class="gov-title">公司治理</h1>
        <p class="gov-subtitle">
          Corporate Governance · 品牌 / IP / 自媒体 / 招商加盟 / 投资股权 / <strong>人事劳动</strong> — 资料归宗、<strong>分批页面内化</strong>与文件分发
        </p>
      </div>
    </header>

    <el-alert
      type="warning"
      show-icon
      :closable="false"
      class="gov-advisory"
      title="内部资料不在公开站点提供"
      description="劳动合同、保密与竞业协议、投资人 BP、股权架构等属公司内部文档，已从公开部署中移除（见 docs/全面审计_2026-09-17/README.md A1）。本页在本地 / 私有环境可正常预览与下载；公开站点上「打开 / 下载 / 内化预览」会失败，这属于预期行为，不是数据丢失。"
    />

    <div class="gov-embed-legend">
      <span class="gov-legend-title">内化进度</span>
      <el-tag size="small" type="success" effect="plain">第一批</el-tag>
      <span class="gov-legend-desc">Markdown / HTML / 源码</span>
      <el-tag size="small" type="warning" effect="plain">第二批</el-tag>
      <span class="gov-legend-desc">Word 正文浏览器抽取</span>
      <el-tag size="small" type="info" effect="plain">第三批</el-tag>
      <span class="gov-legend-desc">PPT 等以摘录与说明为主</span>
    </div>

    <div class="gov-layout">
      <aside class="gov-nav" aria-label="子模块导航">
        <button
          v-for="m in governanceModules"
          :key="m.id"
          type="button"
          :class="['gov-nav-btn', { active: activeId === m.id }]"
          @click="activeId = m.id"
        >
          <span class="gov-nav-icon" aria-hidden="true">{{ m.icon }}</span>
          <span class="gov-nav-label">{{ m.label }}</span>
          <span class="gov-nav-en">{{ m.en }}</span>
        </button>
      </aside>

      <main class="gov-main">
        <section v-for="m in governanceModules" v-show="activeId === m.id" :key="m.id" class="gov-panel">
          <div class="gov-panel-head">
            <h2>{{ m.label }}</h2>
            <p class="gov-panel-summary">{{ m.summary }}</p>
          </div>

          <div class="gov-toolbar">
            <el-input
              v-model="queries[m.id]"
              clearable
              placeholder="按文件名或说明筛选…"
              class="gov-search"
            />
            <span class="gov-count">共 {{ filteredFiles(m).length }} 份</span>
          </div>

          <div class="gov-table-wrap">
            <el-table :data="filteredFiles(m)" stripe border class="gov-table" empty-text="无匹配文件">
              <el-table-column label="类型" width="88" align="center">
                <template #default="{ row }">
                  <el-tag size="small" effect="plain" type="info">{{ extLabel(row.file) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="file" label="文件名" min-width="200" show-overflow-tooltip />
              <el-table-column prop="blurb" label="说明" min-width="160" show-overflow-tooltip />
              <el-table-column label="内化" width="120" align="center">
                <template #default="{ row }">
                  <template v-if="previewAvailable(row.file)">
                    <el-tag size="small" effect="dark" type="primary">{{ embedBadge(row.file) }}</el-tag>
                  </template>
                  <span v-else class="gov-no-preview">—</span>
                </template>
              </el-table-column>
              <el-table-column label="页面预览" width="112" align="center" fixed="right">
                <template #default="{ row }">
                  <el-button
                    v-if="previewAvailable(row.file)"
                    type="primary"
                    link
                    @click="openInlinePreview(m.id, row.file)"
                  >
                    内化预览
                  </el-button>
                  <span v-else class="gov-muted">不支持</span>
                </template>
              </el-table-column>
              <el-table-column label="文件" width="148" align="center" fixed="right">
                <template #default="{ row }">
                  <el-button type="primary" link @click="openAsset(m.id, row.file)">打开</el-button>
                  <el-button type="primary" link @click="downloadAsset(m.id, row.file)">下载</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <p class="gov-hint">
            「内化预览」在页面内分批呈现正文：Office 文档中 Word 支持抽取文本样式；PPT 暂以纲要占位，可持续在资料库配置中补充摘录。
          </p>
        </section>
      </main>
    </div>

    <el-drawer
      v-model="drawerVisible"
      :title="drawerTitle"
      direction="rtl"
      size="min(92vw, 720px)"
      class="gov-drawer"
      destroy-on-close
      @closed="resetDrawer"
    >
      <template #header>
        <div class="gov-drawer-head">
          <span class="gov-drawer-title">{{ drawerTitle }}</span>
          <el-tag v-if="drawerBatchLabel" size="small" type="success" effect="plain">{{ drawerBatchLabel }}</el-tag>
        </div>
      </template>

      <div v-loading="drawerLoading" class="gov-drawer-body">
        <el-alert v-if="drawerWarning" :title="drawerWarning" type="warning" show-icon class="gov-drawer-alert" />

        <iframe
          v-if="drawerMode === 'iframe' && drawerIframeSrc"
          class="gov-drawer-iframe"
          :src="drawerIframeSrc"
          title="HTML 预览"
        />

        <div v-else-if="drawerMode === 'html' && drawerHtml" class="gov-md-body" v-html="drawerHtml" />

        <div v-else-if="!drawerLoading && drawerMode === 'empty'" class="gov-drawer-empty">
          <p>当前格式暂无页面预览，请使用「打开」或「下载」。</p>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { marked } from 'marked'
import mammoth from 'mammoth'
import {
  governanceModules,
  governanceAssetUrl,
  fileExt
} from '../data/governanceLibrary.js'
import {
  getEmbedMeta,
  getManualSummaryMarkdown,
  hasInlinePreview
} from '../data/governanceEmbed.js'

const activeId = ref(governanceModules[0].id)

const queries = reactive(
  Object.fromEntries(governanceModules.map((m) => [m.id, '']))
)

const drawerVisible = ref(false)
const drawerTitle = ref('')
const drawerBatchLabel = ref('')
const drawerLoading = ref(false)
const drawerMode = ref('empty')
const drawerHtml = ref('')
const drawerIframeSrc = ref('')
const drawerWarning = ref('')

function resetDrawer() {
  drawerIframeSrc.value = ''
  drawerHtml.value = ''
  drawerWarning.value = ''
  drawerMode.value = 'empty'
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function filteredFiles(m) {
  const q = (queries[m.id] || '').trim().toLowerCase()
  if (!q) return m.files
  return m.files.filter(
    (row) =>
      row.file.toLowerCase().includes(q) ||
      (row.blurb && row.blurb.toLowerCase().includes(q))
  )
}

function extLabel(name) {
  const e = fileExt(name)
  if (e === 'docx') return 'DOCX'
  if (e === 'pptx') return 'PPTX'
  if (e === 'md') return 'MD'
  if (e === 'html') return 'HTML'
  if (e === 'jsx') return 'JSX'
  return (e || 'FILE').toUpperCase()
}

function previewAvailable(fileName) {
  return hasInlinePreview(fileExt(fileName))
}

function embedBadge(fileName) {
  const meta = getEmbedMeta('', '', fileExt(fileName))
  return `批${meta.batch || '—'}`
}

async function openInlinePreview(moduleId, fileName) {
  const url = governanceAssetUrl(moduleId, fileName)
  const ext = fileExt(fileName)
  const meta = getEmbedMeta(moduleId, fileName, ext)

  drawerTitle.value = fileName
  drawerBatchLabel.value = meta.batchLabel
  drawerVisible.value = true
  drawerLoading.value = true
  drawerWarning.value = ''
  drawerIframeSrc.value = ''
  drawerHtml.value = ''

  try {
    if (meta.strategy === 'markdown-fetch') {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`加载失败 (${res.status})`)
      const text = await res.text()
      drawerHtml.value = marked.parse(text)
      drawerMode.value = 'html'
      return
    }

    if (meta.strategy === 'html-iframe') {
      drawerIframeSrc.value = url
      drawerMode.value = 'iframe'
      drawerWarning.value =
        '以下为网页快照预览；若外链资源受限，请以「下载」后的本地打开为准。'
      return
    }

    if (meta.strategy === 'jsx-code') {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`加载失败 (${res.status})`)
      const text = await res.text()
      drawerHtml.value = `<pre class="gov-code-block"><code>${escapeHtml(text)}</code></pre>`
      drawerMode.value = 'html'
      return
    }

    if (meta.strategy === 'docx-mammoth') {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`加载失败 (${res.status})`)
      const buf = await res.arrayBuffer()
      const result = await mammoth.convertToHtml({ arrayBuffer: buf })
      drawerHtml.value = result.value || '<p>（未能抽取正文，可能为空文档）</p>'
      if (result.messages?.length) {
        const warn = result.messages.map((m) => m.message).join(' ')
        if (warn) drawerWarning.value = `转换提示：${warn.slice(0, 280)}`
      }
      drawerMode.value = 'html'
      return
    }

    if (meta.strategy === 'pptx-placeholder') {
      const manual = getManualSummaryMarkdown(moduleId, fileName)
      const fallback = `### ${fileName}\n\n> **PowerPoint** 无法在浏览器内稳定还原版式与动画。\n\n请先 **下载** 原件查阅；后续将在「第三批」中分批补充**人工摘录要点**至此抽屉。\n\n—— 公司治理资料内化工作项`
      drawerHtml.value = marked.parse(manual || fallback)
      drawerMode.value = 'html'
      return
    }

    drawerMode.value = 'empty'
  } catch (e) {
    console.error(e)
    drawerHtml.value = marked.parse(
      `### 预览失败\n\n${escapeHtml(e.message || String(e))}\n\n请改用 **打开** 或 **下载** 查阅原件。`
    )
    drawerMode.value = 'html'
    ElMessage.error('页面内化加载失败，已提示错误说明')
  } finally {
    drawerLoading.value = false
  }
}

function openAsset(moduleId, fileName) {
  const url = governanceAssetUrl(moduleId, fileName)
  const e = fileExt(fileName)
  if (['docx', 'pptx', 'jsx'].includes(e)) {
    ElMessage.info('若已在「内化预览」中查阅仍不完整，请使用本地 WPS / Office 打开原件。')
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

function downloadAsset(moduleId, fileName) {
  const url = governanceAssetUrl(moduleId, fileName)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener noreferrer'
  a.target = '_blank'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
</script>

<style scoped>
.gov-root {
  min-height: 100%;
  padding: var(--space-6) var(--space-8);
  background: linear-gradient(
    165deg,
    var(--light-bg-primary) 0%,
    var(--light-bg-secondary) 45%,
    var(--light-bg-tertiary) 100%
  );
  box-sizing: border-box;
}

.gov-header {
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--light-border-subtle);
}

.gov-title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-3xl);
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
  font-family: var(--font-cn-display), var(--font-cn-body), sans-serif;
}

.gov-subtitle {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
}

.gov-subtitle strong {
  color: var(--brand-green-700);
  font-weight: var(--weight-semibold);
}

.gov-embed-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  margin-bottom: var(--space-6);
  padding: var(--space-3) var(--space-4);
  background: var(--viz-surface);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-lg);
  font-size: var(--text-xs);
  color: var(--light-text-secondary);
}

.gov-legend-title {
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
  margin-right: var(--space-2);
}

.gov-legend-desc {
  margin-right: var(--space-2);
}

.gov-layout {
  display: flex;
  gap: var(--space-6);
  align-items: flex-start;
  max-width: 1400px;
}

.gov-nav {
  flex: 0 0 220px;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  position: sticky;
  top: var(--space-4);
}

.gov-nav-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px solid var(--light-border-subtle);
  background: var(--viz-surface);
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--duration-normal) var(--ease-standard),
    box-shadow var(--duration-normal) var(--ease-standard);
  font: inherit;
  color: var(--light-text-primary);
}

.gov-nav-btn:hover {
  border-color: var(--brand-green-300);
  box-shadow: var(--shadow-sm);
}

.gov-nav-btn.active {
  border-color: var(--brand-green-500);
  box-shadow: var(--focus-ring);
  background: linear-gradient(135deg, var(--brand-green-50) 0%, var(--viz-surface) 100%);
}

.gov-nav-icon {
  font-size: 1.35rem;
  line-height: 1;
}

.gov-nav-label {
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
}

.gov-nav-en {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--light-text-tertiary);
  text-transform: uppercase;
}

.gov-main {
  flex: 1;
  min-width: 0;
}

.gov-panel-head h2 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xl);
  color: var(--light-text-primary);
}

.gov-panel-summary {
  margin: 0 0 var(--space-5);
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
  line-height: var(--leading-loose);
  max-width: 72ch;
}

.gov-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
  flex-wrap: wrap;
}

.gov-search {
  max-width: 360px;
  flex: 1;
  min-width: 200px;
}

.gov-count {
  font-size: var(--text-sm);
  color: var(--light-text-tertiary);
  white-space: nowrap;
}

.gov-table-wrap {
  background: var(--viz-surface);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-2);
  box-shadow: var(--shadow-sm);
}

.gov-table {
  width: 100%;
}

.gov-no-preview,
.gov-muted {
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
}

.gov-hint {
  margin: var(--space-4) 0 0;
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
  line-height: var(--leading-normal);
}

.gov-drawer-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding-right: var(--space-8);
}

.gov-drawer-title {
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
  font-size: var(--text-base);
}

.gov-drawer-body {
  min-height: 200px;
}

.gov-drawer-alert {
  margin-bottom: var(--space-4);
}

.gov-drawer-iframe {
  width: 100%;
  min-height: 72vh;
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-md);
  background: var(--light-bg-secondary);
}

.gov-drawer-empty {
  padding: var(--space-8);
  text-align: center;
  color: var(--light-text-tertiary);
}

.gov-md-body {
  font-size: var(--text-base);
  color: var(--light-text-primary);
  line-height: var(--leading-loose);
}

.gov-md-body :deep(h1),
.gov-md-body :deep(h2),
.gov-md-body :deep(h3) {
  font-family: var(--font-cn-display), sans-serif;
  color: var(--light-text-primary);
  margin: var(--space-5) 0 var(--space-3);
}

.gov-md-body :deep(h1) {
  font-size: var(--text-2xl);
}
.gov-md-body :deep(h2) {
  font-size: var(--text-xl);
}
.gov-md-body :deep(h3) {
  font-size: var(--text-lg);
}

.gov-md-body :deep(p) {
  margin: 0 0 var(--space-3);
}

.gov-md-body :deep(ul),
.gov-md-body :deep(ol) {
  margin: 0 0 var(--space-3);
  padding-left: var(--space-6);
}

.gov-md-body :deep(blockquote) {
  margin: var(--space-3) 0;
  padding: var(--space-2) var(--space-4);
  border-left: 4px solid var(--brand-green-400);
  background: var(--brand-green-50);
  color: var(--light-text-secondary);
}

.gov-md-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: var(--space-4) 0;
  font-size: var(--text-sm);
}

.gov-md-body :deep(th),
.gov-md-body :deep(td) {
  border: 1px solid var(--light-border-default);
  padding: var(--space-2) var(--space-3);
}

.gov-md-body :deep(th) {
  background: var(--light-bg-tertiary);
}

.gov-code-block {
  margin: 0;
  padding: var(--space-4);
  border-radius: var(--radius-md);
  background: var(--dark-bg-secondary);
  color: var(--dark-text-primary);
  font-size: var(--text-sm);
  line-height: 1.55;
  overflow: auto;
  max-height: 75vh;
}

.gov-code-block code {
  font-family: var(--font-mono, monospace);
  white-space: pre;
}

@media (max-width: 900px) {
  .gov-layout {
    flex-direction: column;
  }

  .gov-nav {
    flex: none;
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
    position: static;
  }

  .gov-nav-btn {
    flex: 1 1 calc(50% - var(--space-2));
    min-width: 140px;
  }
}
</style>
