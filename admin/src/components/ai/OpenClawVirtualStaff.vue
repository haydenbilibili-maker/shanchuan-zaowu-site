<template>
  <div class="openclaw-root">
    <header class="oc-header">
      <div class="oc-header-text">
        <div class="oc-kicker">OPENCLAW · VIRTUAL STAFF</div>
        <h3 class="oc-title">OpenClaw 虚拟员工</h3>
        <p class="oc-desc">
          将管理台内的「需求—交付」节奏与自托管
          <a href="https://www.openclaw-cn.com/" target="_blank" rel="noopener noreferrer">OpenClaw</a>
          体系对齐：本页负责 PRD 执行框架与派发摘要；实际任务执行、MCP 与多通道接入在 OpenClaw 侧完成。
        </p>
        <el-alert class="oc-deploy-alert" type="info" :closable="false" show-icon>
          <template #title>当前 OpenClaw 部署（阿里云）</template>
          <p class="oc-deploy-alert-body">
            与<strong>轻量应用服务器</strong>上的 OpenClaw 镜像对接：公网访问需在<strong>防火墙</strong>放行 Web
            服务端口；未配置 HTTPS 前请使用 <code>http://</code>。控制台地址一般为
            <code>http://&lt;公网IP&gt;:&lt;端口&gt;</code>（端口以实例内实际监听为准）。
          </p>
        </el-alert>
      </div>
      <div class="oc-header-actions">
        <el-button type="primary" @click="copyPrdBrief">复制 PRD 简报</el-button>
        <el-button v-if="consoleUrl" type="primary" plain @click="openConsole">打开控制台</el-button>
        <el-button plain @click="$emit('open-chat')">去智能咨询</el-button>
        <el-button text type="primary" @click="$emit('close')">返回工具台</el-button>
      </div>
    </header>

    <div class="oc-layout">
      <aside class="oc-side">
        <section class="card-block">
          <div class="card-head">
            <span class="card-title">对接配置</span>
            <el-tag size="small" type="warning" effect="plain">对接</el-tag>
          </div>
          <p class="oc-side-hint">配置保存在本机；Webhook 推送需服务端允许 CORS 或走网关。</p>
          <el-form label-position="top" class="oc-form" size="small">
            <el-form-item label="控制台地址">
              <el-input
                v-model="form.consoleUrl"
                placeholder="http://公网IP:端口 或 https://域名"
                clearable
              />
            </el-form-item>
            <el-form-item label="任务 Webhook">
              <el-input v-model="form.webhookUrl" placeholder="https://api.example.com/openclaw/tasks" clearable />
            </el-form-item>
            <el-form-item label="项目标识">
              <el-input v-model="form.projectSlug" placeholder="shanhai-admin" clearable />
            </el-form-item>
          </el-form>
          <el-button type="primary" class="oc-save-btn" @click="saveConfig">保存到本机</el-button>
        </section>

        <section class="card-block">
          <div class="card-head">
            <span class="card-title">质量闸门</span>
          </div>
          <ul class="oc-gates-list">
            <li><strong>需求</strong>：范围、非目标、验收口径一致</li>
            <li><strong>方案</strong>：数据流、权限、降级与回滚已评审</li>
            <li><strong>上线</strong>：监控、告警、值班与回滚就绪</li>
          </ul>
        </section>
      </aside>

      <div class="oc-main">
        <section class="card-block">
          <div class="card-head">
            <div>
              <span class="card-title">PRD 执行框架</span>
              <span class="card-hint">七阶段闸门 · 交付物与状态可持久化</span>
            </div>
            <div class="oc-phase-summary">
              <span>完成 {{ doneCount }}/{{ phases.length }}</span>
            </div>
          </div>
          <el-table :data="phases" border stripe class="oc-table" size="small">
            <el-table-column prop="phase" label="阶段" width="72" />
            <el-table-column prop="name" label="名称" min-width="110" />
            <el-table-column label="核心交付物" min-width="200">
              <template #default="{ row }">
                <el-tag v-for="d in row.deliverables" :key="d" size="small" class="oc-tag">{{ d }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="责任人" width="120">
              <template #default="{ row }">
                <el-input v-model="row.owner" size="small" placeholder="角色/姓名" />
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-select v-model="row.status" size="small" style="width: 100%">
                  <el-option label="未开始" value="todo" />
                  <el-option label="进行中" value="doing" />
                  <el-option label="已完成" value="done" />
                  <el-option label="阻塞" value="blocked" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="备注" min-width="140">
              <template #default="{ row }">
                <el-input v-model="row.note" size="small" type="textarea" :rows="1" placeholder="风险、依赖、链接" />
              </template>
            </el-table-column>
          </el-table>
        </section>

        <section class="card-block">
          <div class="card-head">
            <span class="card-title">派发到 OpenClaw</span>
            <el-button size="small" type="primary" :loading="dispatching" @click="dispatchWebhook">推送 Webhook</el-button>
          </div>
          <p class="oc-dispatch-hint">
            将当前阶段快照以 JSON POST 到 Webhook。若浏览器因 CORS 失败，请改为服务端或网关转发。
          </p>
          <el-input v-model="dispatchPreview" type="textarea" :rows="6" readonly class="oc-json-preview" />
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'

defineProps({
  feature: { type: Object, default: null },
})

defineEmits(['close', 'open-chat'])

const STORAGE_KEY = 'openclaw_virtual_staff_v1'

const defaultPhases = () => [
  { id: 'p0', phase: 'P0', name: '立项对齐', deliverables: ['一页纸', 'OKR / 边界', '干系人'], owner: '', status: 'todo', note: '' },
  { id: 'p1', phase: 'P1', name: '需求澄清', deliverables: ['PRD v0.1', '用户故事', '验收标准'], owner: '', status: 'todo', note: '' },
  { id: 'p2', phase: 'P2', name: '方案与设计', deliverables: ['技术方案', '线框 / 流程', '数据与权限'], owner: '', status: 'todo', note: '' },
  { id: 'p3', phase: 'P3', name: '评审闸门', deliverables: ['评审纪要', 'Go / No-Go'], owner: '', status: 'todo', note: '' },
  { id: 'p4', phase: 'P4', name: '开发与联调', deliverables: ['迭代计划', '缺陷清零标准'], owner: '', status: 'todo', note: '' },
  { id: 'p5', phase: 'P5', name: '验收与上线', deliverables: ['验收清单', '回滚预案'], owner: '', status: 'todo', note: '' },
  { id: 'p6', phase: 'P6', name: '复盘度量', deliverables: ['复盘文档', '指标看板'], owner: '', status: 'todo', note: '' },
]

const form = ref({
  consoleUrl: '',
  webhookUrl: '',
  projectSlug: '',
})

const phases = ref(defaultPhases())
const dispatching = ref(false)

const consoleUrl = computed(() => (form.value.consoleUrl || import.meta.env.VITE_OPENCLAW_CONSOLE_URL || '').trim())
const doneCount = computed(() => phases.value.filter((p) => p.status === 'done').length)

function normalizeExternalUrl(u) {
  const s = (u || '').trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) return `http://${s}`
  return s
}

const buildPayload = () => ({
  source: 'shanhai-admin-ai-center',
  project: form.value.projectSlug || 'default',
  generatedAt: new Date().toISOString(),
  phases: phases.value.map((p) => ({
    id: p.id,
    phase: p.phase,
    name: p.name,
    deliverables: p.deliverables,
    owner: p.owner,
    status: p.status,
    note: p.note,
  })),
})

const dispatchPreview = computed(() => JSON.stringify(buildPayload(), null, 2))

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    if (data.form) form.value = { ...form.value, ...data.form }
    if (Array.isArray(data.phases) && data.phases.length) {
      const defs = defaultPhases()
      phases.value = defs.map((def) => {
        const saved = data.phases.find((s) => s.id === def.id)
        return saved ? { ...def, ...saved, deliverables: def.deliverables } : def
      })
    }
  } catch {
    /* ignore */
  }
}

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      form: form.value,
      phases: phases.value,
    }),
  )
}

onMounted(() => {
  loadState()
  const fromEnv = (import.meta.env.VITE_OPENCLAW_CONSOLE_URL || '').trim()
  if (fromEnv && !(form.value.consoleUrl || '').trim()) {
    form.value.consoleUrl = fromEnv
  }
})

watch([form, phases], () => persist(), { deep: true })

function saveConfig() {
  persist()
  ElMessage.success('已保存到本机')
}

async function copyPrdBrief() {
  const text = [
    `# OpenClaw PRD 执行简报`,
    `项目: ${form.value.projectSlug || '（未填）'}`,
    '',
    ...phases.value.map((p) => `- ${p.phase} ${p.name} [${p.status}] ${p.owner ? '@' + p.owner : ''} ${p.note ? '— ' + p.note : ''}`),
  ].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.warning('复制失败，请手动全选导出区内容')
  }
}

function openConsole() {
  const u = normalizeExternalUrl(consoleUrl.value)
  if (u) window.open(u, '_blank', 'noopener,noreferrer')
  else ElMessage.warning('请先填写控制台地址')
}

async function dispatchWebhook() {
  const url = (form.value.webhookUrl || '').trim()
  if (!url) {
    ElMessage.warning('请先填写任务 Webhook')
    return
  }
  dispatching.value = true
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    ElMessage.success('已推送')
  } catch (e) {
    ElMessage.error(e?.message || '推送失败（常见原因：CORS 或服务未就绪）')
  } finally {
    dispatching.value = false
  }
}
</script>

<style scoped>
.openclaw-root {
  padding: 0;
  max-width: 1200px;
  margin: 0 auto;
}

.oc-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.oc-kicker {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--light-text-tertiary, var(--el-text-color-secondary));
  margin-bottom: 6px;
  font-weight: 600;
}

.oc-title {
  margin: 0 0 8px;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--light-text-primary, var(--el-text-color-primary));
}

.oc-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--light-text-secondary, var(--el-text-color-regular));
  max-width: 640px;
}

.oc-desc a {
  color: var(--brand-green-600, var(--el-color-primary));
}

.oc-deploy-alert {
  margin-top: 12px;
  max-width: 720px;
}

.oc-deploy-alert-body {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.55;
}

.oc-deploy-alert-body code {
  font-size: 12px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--light-bg-secondary, var(--el-fill-color-light));
}

.oc-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.oc-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.oc-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: sticky;
  top: 0;
}

.oc-side-hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--light-text-tertiary, var(--el-text-color-secondary));
  line-height: 1.45;
}

.oc-save-btn {
  width: 100%;
  margin-top: 4px;
}

.oc-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.card-block {
  background: var(--light-bg-primary, var(--el-bg-color));
  border: 1px solid var(--light-border-default, var(--el-border-color-lighter));
  border-radius: 10px;
  padding: 14px 16px;
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.card-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--light-text-primary, var(--el-text-color-primary));
}

.card-hint {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--light-text-tertiary, var(--el-text-color-secondary));
  font-weight: 400;
}

.oc-phase-summary {
  font-size: 12px;
  color: var(--brand-green-700, var(--el-color-primary));
  font-weight: 600;
}

.oc-form :deep(.el-form-item) {
  margin-bottom: 10px;
}

.oc-table {
  width: 100%;
}

.oc-tag {
  margin: 2px 4px 2px 0;
}

.oc-gates-list {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 13px;
  line-height: 1.7;
  color: var(--light-text-secondary, var(--el-text-color-regular));
}

.oc-dispatch-hint {
  font-size: 12px;
  color: var(--light-text-tertiary, var(--el-text-color-secondary));
  margin: 0 0 8px;
}

.oc-json-preview :deep(textarea) {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
}

@media (max-width: 960px) {
  .oc-layout {
    grid-template-columns: 1fr;
  }

  .oc-side {
    position: static;
  }
}
</style>
