<template>
  <div class="sdc-root">
    <header class="sdc-header">
      <div class="sdc-head-left">
        <h2 class="sdc-title">门店设计中心</h2>
        <p class="sdc-subtitle">动线 / 展陈 / VI / 物料 / 预算 / 排期 · 版本化沉淀与导出</p>
      </div>
      <div class="sdc-head-right">
        <el-button type="primary" :disabled="!selectedStoreId" @click="createNewVersion">新建版本</el-button>
        <el-button :disabled="!draft?._id" @click="cloneVersion">复制版本</el-button>
        <el-button type="primary" plain :disabled="!draft?._id || !aiAvailable" :loading="aiGenerating" @click="generateWithAI">AI 生成</el-button>
        <el-button type="warning" :disabled="!draft?._id" @click="saveVersion" :loading="saving">保存</el-button>
      </div>
    </header>

    <div class="sdc-layout">
      <aside class="sdc-left">
        <div class="card">
          <div class="card-title">选择门店</div>
          <el-select v-model="selectedStoreId" placeholder="请选择门店" filterable style="width: 100%">
            <el-option v-for="o in storeOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
          <div class="hint" v-if="!storeOptions.length">尚无门店主数据，请先在「店铺管理」新建门店。</div>
        </div>

        <div class="card">
          <div class="card-title-row">
            <div class="card-title">设计版本</div>
            <el-tag size="small" effect="plain">{{ versions.length }} 个</el-tag>
          </div>
          <div class="versions" v-loading="loadingVersions">
            <button
              v-for="v in versions"
              :key="v._id"
              type="button"
              :class="['ver-item', currentVersionId === v._id ? 'active' : '']"
              @click="selectVersion(v._id)"
            >
              <div class="ver-main">
                <div class="ver-name">{{ v.versionName || v._id }}</div>
                <div class="ver-meta">
                  <el-tag size="small" effect="plain" :type="statusTagType(v.status)">{{ statusLabel(v.status) }}</el-tag>
                  <span class="ver-time">{{ formatTime(v.updatedAt || v._updateTime || v._createTime) }}</span>
                </div>
              </div>
            </button>
            <div v-if="!versions.length && selectedStoreId" class="empty">暂无版本，点击「新建版本」开始。</div>
          </div>
        </div>
      </aside>

      <main class="sdc-main" v-loading="loadingCurrent">
        <div v-if="!draft" class="empty-main">
          <div class="empty-title">从左侧选择门店与版本</div>
          <div class="empty-desc">建议先创建一个版本，录入空间约束与分区，再生成/编辑方案。</div>
        </div>

        <template v-else>
          <div class="workbench">
            <el-tabs v-model="activeTab" class="workbench-tabs">
              <el-tab-pane label="概览" name="overview">
                <div class="grid2">
                  <div class="panel">
                    <div class="panel-head">
                      <div class="panel-title">目标指标</div>
                    </div>
                    <el-form label-position="top">
                      <el-row :gutter="12">
                        <el-col :span="8">
                          <el-form-item label="拍照率目标">
                            <el-input-number v-model="draft.goals.photoRateTarget" :min="0" :max="1" :step="0.05" style="width: 100%" />
                          </el-form-item>
                        </el-col>
                        <el-col :span="8">
                          <el-form-item label="转化率目标">
                            <el-input-number v-model="draft.goals.conversionTarget" :min="0" :max="1" :step="0.05" style="width: 100%" />
                          </el-form-item>
                        </el-col>
                        <el-col :span="8">
                          <el-form-item label="客单价目标(元)">
                            <el-input-number v-model="draft.goals.aovTarget" :min="0" :step="50" style="width: 100%" />
                          </el-form-item>
                        </el-col>
                      </el-row>
                    </el-form>
                  </div>
                  <div class="panel">
                    <div class="panel-head">
                      <div class="panel-title">版本信息</div>
                    </div>
                    <el-form label-position="top">
                      <el-row :gutter="12">
                        <el-col :span="12">
                          <el-form-item label="版本名">
                            <el-input v-model="draft.versionName" />
                          </el-form-item>
                        </el-col>
                        <el-col :span="12">
                          <el-form-item label="状态">
                            <el-select v-model="draft.status" style="width: 100%">
                              <el-option label="草稿" value="draft" />
                              <el-option label="启用" value="active" />
                              <el-option label="归档" value="archived" />
                            </el-select>
                          </el-form-item>
                        </el-col>
                      </el-row>
                      <el-form-item label="主题基调">
                        <el-input v-model="draft.narrative.theme" placeholder="如 自然美学 · 黑金质感" />
                      </el-form-item>
                    </el-form>
                  </div>
                </div>
              </el-tab-pane>

              <el-tab-pane label="约束" name="constraints">
                <div class="grid2">
                  <div class="panel">
                    <div class="panel-head">
                      <div class="panel-title">空间与施工约束</div>
                      <div class="panel-actions">
                        <el-button size="small" @click="fillFromStore">从门店档案补全</el-button>
                        <el-button size="small" type="success" plain :disabled="!canApplyChangchunLite" @click="applyChangchunLiteTemplate">长春 Lite 模板</el-button>
                      </div>
                    </div>
                    <el-form label-position="top">
                      <el-row :gutter="12">
                        <el-col :span="6">
                          <el-form-item label="面积(㎡)">
                            <el-input-number v-model="draft.constraints.areaM2" :min="0" :step="1" style="width: 100%" />
                          </el-form-item>
                        </el-col>
                        <el-col :span="6">
                          <el-form-item label="层高(米)">
                            <el-input-number v-model="draft.constraints.ceilingHeightM" :min="0" :step="0.1" style="width: 100%" />
                          </el-form-item>
                        </el-col>
                        <el-col :span="12">
                          <el-form-item label="柱位/结构约束">
                            <el-input v-model="draft.constraints.columns" placeholder="如 中央承重柱、无法拆改" />
                          </el-form-item>
                        </el-col>
                      </el-row>
                      <el-row :gutter="12">
                        <el-col :span="12">
                          <el-form-item label="墙面/地面材质">
                            <el-input v-model="draft.constraints.wallMaterial" placeholder="如 深灰水泥纹理、木地板" />
                          </el-form-item>
                        </el-col>
                        <el-col :span="12">
                          <el-form-item label="灯光/电源约束">
                            <el-input v-model="draft.constraints.lighting" placeholder="如 3000K 聚光灯、已有灯带" />
                          </el-form-item>
                        </el-col>
                      </el-row>
                      <el-form-item label="消防/合规">
                        <el-input v-model="draft.constraints.fireSafety" placeholder="如 消防喷淋不可遮挡" />
                      </el-form-item>
                      <el-form-item label="补充说明">
                        <el-input v-model="draft.constraints.notes" type="textarea" :rows="4" />
                      </el-form-item>
                    </el-form>
                  </div>
                  <div class="panel">
                    <div class="panel-head">
                      <div class="panel-title">规范与资料（公司治理）</div>
                    </div>
                    <el-alert
                      type="info"
                      :closable="false"
                      show-icon
                      class="gov-hint"
                      title="建议在生成方案前先对齐 VI 与展陈施工规范"
                      description="以下链接来自「公司治理 → 品牌管理中心」。如预览不完整，请下载用 WPS/Office 打开。"
                    />
                    <div class="gov-links">
                      <button type="button" class="gov-link" @click="openGovernanceAsset('brand', '山海造物-品牌视觉识别手册v2.0.docx')">
                        <span class="gov-link-title">VI 手册 v2</span>
                        <span class="gov-link-sub">品牌视觉识别规范</span>
                      </button>
                      <button type="button" class="gov-link" @click="openGovernanceAsset('brand', '山海造物-马上有-展陈施工方案Lite版.docx')">
                        <span class="gov-link-title">展陈施工 · Lite</span>
                        <span class="gov-link-sub">当前执行版（长春店）</span>
                      </button>
                      <button type="button" class="gov-link" @click="openGovernanceAsset('brand', '山海造物-马上有-展陈施工方案.docx')">
                        <span class="gov-link-title">展陈施工 · 完整版</span>
                        <span class="gov-link-sub">新店参考</span>
                      </button>
                      <button type="button" class="gov-link" @click="openGovernanceAsset('brand', '山海造物-马上有-愿望卡与纸鹤设计.docx')">
                        <span class="gov-link-title">互动物料</span>
                        <span class="gov-link-sub">愿望卡 / 纸鹤</span>
                      </button>
                      <button type="button" class="gov-link gov-link--muted" @click="openGovernanceCenter">
                        <span class="gov-link-title">打开公司治理</span>
                        <span class="gov-link-sub">查看更多资料与内化预览</span>
                      </button>
                    </div>
                  </div>
                </div>
              </el-tab-pane>

              <el-tab-pane label="分区与动线" name="zones">
                <div class="panel">
                  <div class="panel-head">
                    <div class="panel-title">分区与指标（可编辑）</div>
                    <div class="panel-actions">
                      <el-button size="small" @click="addZone">新增分区</el-button>
                    </div>
                  </div>
                  <el-table :data="draft.zones" border stripe size="small">
                    <el-table-column prop="name" label="分区" width="120">
                      <template #default="{ row }">
                        <el-input v-model="row.name" size="small" />
                      </template>
                    </el-table-column>
                    <el-table-column prop="description" label="说明">
                      <template #default="{ row }">
                        <el-input v-model="row.description" size="small" />
                      </template>
                    </el-table-column>
                    <el-table-column prop="traffic" label="热度(0-100)" width="120">
                      <template #default="{ row }">
                        <el-input-number v-model="row.traffic" :min="0" :max="100" :step="1" size="small" />
                      </template>
                    </el-table-column>
                    <el-table-column prop="conversion" label="转化(0-100)" width="120">
                      <template #default="{ row }">
                        <el-input-number v-model="row.conversion" :min="0" :max="100" :step="1" size="small" />
                      </template>
                    </el-table-column>
                    <el-table-column label="操作" width="80">
                      <template #default="{ $index }">
                        <el-button link type="danger" size="small" @click="removeZone($index)">删</el-button>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </el-tab-pane>

              <el-tab-pane label="方案" name="plan">
                <div class="grid2">
                  <div class="panel">
                    <div class="panel-head">
                      <div class="panel-title">核心叙事</div>
                      <div class="panel-actions">
                        <el-button size="small" type="primary" plain :disabled="!aiAvailable" :loading="aiGenerating" @click="generateWithAI">AI 生成方案</el-button>
                      </div>
                    </div>
                    <el-form label-position="top">
                      <el-form-item label="关键故事线">
                        <el-input v-model="draft.narrative.keyStory" type="textarea" :rows="6" />
                      </el-form-item>
                      <el-form-item label="打卡位（每行一个）">
                        <el-input v-model="photoSpotsText" type="textarea" :rows="4" placeholder="如 黑马聚光灯位\n黄铜触摸点特写位" />
                      </el-form-item>
                      <el-form-item label="互动点（每行一个）">
                        <el-input v-model="interactionsText" type="textarea" :rows="4" placeholder="如 愿望卡与纸鹤\n印章卡片盖章" />
                      </el-form-item>
                    </el-form>
                  </div>
                  <div class="panel">
                    <div class="panel-head">
                      <div class="panel-title">展陈方案摘要</div>
                    </div>
                    <el-form label-position="top">
                      <el-form-item label="摘要">
                        <el-input v-model="draft.displayPlan.summary" type="textarea" :rows="8" />
                      </el-form-item>
                    </el-form>
                  </div>
                </div>
              </el-tab-pane>

              <el-tab-pane label="物料与预算" name="bom">
                <div class="panel">
                  <div class="panel-head">
                    <div class="panel-title">BOM 清单</div>
                    <div class="panel-actions">
                      <el-button size="small" type="primary" plain :disabled="!aiAvailable" :loading="aiGenerating" @click="generateWithAI">AI 生成物料</el-button>
                      <el-button size="small" @click="addBom">新增物料</el-button>
                    </div>
                  </div>
                  <el-table :data="draft.bom" border stripe size="small">
                    <el-table-column prop="name" label="物料" width="160">
                      <template #default="{ row }"><el-input v-model="row.name" size="small" /></template>
                    </el-table-column>
                    <el-table-column prop="spec" label="规格/备注">
                      <template #default="{ row }"><el-input v-model="row.spec" size="small" /></template>
                    </el-table-column>
                    <el-table-column prop="qty" label="数量" width="90">
                      <template #default="{ row }"><el-input-number v-model="row.qty" :min="0" :step="1" size="small" /></template>
                    </el-table-column>
                    <el-table-column prop="unitPrice" label="单价" width="90">
                      <template #default="{ row }"><el-input-number v-model="row.unitPrice" :min="0" :step="10" size="small" /></template>
                    </el-table-column>
                    <el-table-column label="小计" width="100" align="right">
                      <template #default="{ row }">{{ formatMoney((Number(row.qty) || 0) * (Number(row.unitPrice) || 0)) }}</template>
                    </el-table-column>
                    <el-table-column label="操作" width="80">
                      <template #default="{ $index }">
                        <el-button link type="danger" size="small" @click="removeBom($index)">删</el-button>
                      </template>
                    </el-table-column>
                  </el-table>
                  <div class="budget-row">
                    <div class="budget-left">
                      <el-input v-model="draft.budget.notes" placeholder="预算备注（如 不含人工/不含运输）" />
                    </div>
                    <div class="budget-right">
                      <span class="budget-label">预算合计</span>
                      <span class="budget-value">¥{{ formatMoney(bomTotal) }}</span>
                    </div>
                  </div>
                </div>
              </el-tab-pane>

              <el-tab-pane label="排期" name="schedule">
                <div class="panel">
                  <div class="panel-head">
                    <div class="panel-title">施工与交付排期</div>
                    <div class="panel-actions">
                      <el-button size="small" type="primary" plain :disabled="!aiAvailable" :loading="aiGenerating" @click="generateWithAI">AI 生成排期</el-button>
                      <el-button size="small" @click="addMilestone">新增里程碑</el-button>
                    </div>
                  </div>
                  <el-form label-position="top">
                    <el-row :gutter="12">
                      <el-col :span="8">
                        <el-form-item label="工期(天)">
                          <el-input-number v-model="draft.schedule.durationDays" :min="1" :step="1" style="width: 100%" />
                        </el-form-item>
                      </el-col>
                      <el-col :span="16">
                        <el-form-item label="里程碑">
                          <div class="milestones">
                            <div v-for="(m, idx) in draft.schedule.milestones" :key="idx" class="ms-item">
                              <el-input v-model="m.name" placeholder="如 D1 下单 / D7 完工" />
                              <el-date-picker v-model="m.date" type="date" value-format="YYYY-MM-DD" placeholder="日期" />
                              <el-button link type="danger" @click="removeMilestone(idx)">删</el-button>
                            </div>
                          </div>
                        </el-form-item>
                      </el-col>
                    </el-row>
                  </el-form>
                </div>
              </el-tab-pane>

              <el-tab-pane label="导出" name="export">
                <div class="panel">
                  <div class="panel-head">
                    <div class="panel-title">导出预览（Markdown）</div>
                    <div class="panel-actions">
                      <el-button size="small" type="primary" @click="copyExport">复制</el-button>
                      <el-button size="small" @click="downloadExport">下载 .md</el-button>
                    </div>
                  </div>
                  <el-input v-model="exportText" type="textarea" :rows="18" readonly />
                  <div class="hint">后续可用浏览器打印样式导出 PDF。</div>
                </div>
              </el-tab-pane>
            </el-tabs>
          </div>
        </template>
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ensureDefaultFinanceStoreInLocalBundle, getStoreSelectOptions, loadStoreBundle } from '../utils/storeStorage'
import { cloneDesignVersion, createDesignVersion, createEmptyDesignVersion, listDesignVersions, updateDesignVersion } from '../utils/storeDesignStorage'
import { callGeminiAPI, getAIProviderConfigStatus } from '../utils/aiHelper'
import { governanceAssetUrl } from '../data/governanceLibrary'

const activeTab = ref('overview')
const loadingVersions = ref(false)
const loadingCurrent = ref(false)
const saving = ref(false)
const aiGenerating = ref(false)

const storeBundle = ref(loadStoreBundle())
const selectedStoreId = ref('')

const versions = ref([])
const currentVersionId = ref('')
const currentVersion = computed(() => versions.value.find((v) => v._id === currentVersionId.value) || null)

const draft = ref(null)

const storeOptions = computed(() => getStoreSelectOptions(storeBundle.value))
const selectedStore = computed(() => (storeBundle.value?.stores || []).find((s) => s.id === selectedStoreId.value) || null)

const photoSpotsText = computed({
  get: () => (draft.value?.narrative?.photoSpots || []).join('\n'),
  set: (v) => {
    if (!draft.value) return
    draft.value.narrative.photoSpots = String(v || '')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
  },
})

const interactionsText = computed({
  get: () => (draft.value?.narrative?.interactions || []).join('\n'),
  set: (v) => {
    if (!draft.value) return
    draft.value.narrative.interactions = String(v || '')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
  },
})

const bomTotal = computed(() =>
  (draft.value?.bom || []).reduce((sum, row) => sum + (Number(row.qty) || 0) * (Number(row.unitPrice) || 0), 0),
)

const exportText = computed(() => (draft.value ? buildExportMarkdown(draft.value, selectedStore.value) : ''))
const aiAvailable = computed(() => {
  const s = getAIProviderConfigStatus()
  return (s.gemini + s.openai + s.deepseek + s.local) > 0
})
const canApplyChangchunLite = computed(() => {
  const st = selectedStore.value
  if (!st) return false
  const name = String(st.name || '')
  return name.includes('长春') || name.includes('这有山') || String(st.city || '').includes('长春')
})

function statusLabel(s) {
  if (s === 'active') return '启用'
  if (s === 'archived') return '归档'
  return '草稿'
}

function statusTagType(s) {
  if (s === 'active') return 'success'
  if (s === 'archived') return 'info'
  return 'warning'
}

function formatMoney(n) {
  const v = Number(n) || 0
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatTime(ts) {
  const t = Number(ts) || 0
  if (!t) return '—'
  try {
    const d = new Date(t)
    return `${d.toLocaleDateString()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return '—'
  }
}

async function reloadVersions() {
  const storeId = selectedStoreId.value
  if (!storeId) {
    versions.value = []
    currentVersionId.value = ''
    draft.value = null
    return
  }
  loadingVersions.value = true
  try {
    versions.value = await listDesignVersions(storeId)
    const first = versions.value[0]?._id || ''
    currentVersionId.value = first
    if (first) {
      selectVersion(first)
    } else {
      draft.value = null
    }
  } catch (e) {
    versions.value = []
    currentVersionId.value = ''
    draft.value = null
    ElMessage.error(e?.message || '加载版本失败')
  } finally {
    loadingVersions.value = false
  }
}

function selectVersion(id) {
  currentVersionId.value = id
  const v = versions.value.find((x) => x._id === id)
  if (!v) {
    draft.value = null
    return
  }
  // 深拷贝，避免直接编辑列表对象
  draft.value = JSON.parse(JSON.stringify(v))
  // 补齐结构
  draft.value.goals ||= { photoRateTarget: 0.7, conversionTarget: 0.35, aovTarget: 800 }
  draft.value.constraints ||= {}
  draft.value.zones ||= []
  draft.value.narrative ||= { theme: '', keyStory: '', photoSpots: [], interactions: [] }
  draft.value.displayPlan ||= { summary: '', zonePlans: [] }
  draft.value.bom ||= []
  draft.value.budget ||= { currency: 'CNY', capexTotal: 0, notes: '', items: [] }
  draft.value.schedule ||= { durationDays: 7, milestones: [] }
  draft.value.ai ||= { lastPrompt: '', lastResult: null, updatedAt: 0 }
}

async function createNewVersion() {
  const st = selectedStore.value
  if (!st?.id) return
  const empty = createEmptyDesignVersion({ storeId: st.id, storeCode: st.code || '', storeName: st.name || '' })
  loadingCurrent.value = true
  try {
    const created = await createDesignVersion(empty)
    versions.value = [created, ...versions.value]
    selectVersion(created._id)
    ElMessage.success('已创建版本')
  } catch (e) {
    ElMessage.error(e?.message || '创建失败')
  } finally {
    loadingCurrent.value = false
  }
}

async function cloneVersion() {
  if (!currentVersion.value) return
  loadingCurrent.value = true
  try {
    const created = await cloneDesignVersion(currentVersion.value)
    await reloadVersions()
    selectVersion(created._id)
    ElMessage.success('已复制版本')
  } catch (e) {
    ElMessage.error(e?.message || '复制失败')
  } finally {
    loadingCurrent.value = false
  }
}

async function saveVersion() {
  const d = draft.value
  if (!d?._id) return
  saving.value = true
  try {
    // 同步预算合计
    d.budget ||= {}
    d.budget.capexTotal = bomTotal.value
    await updateDesignVersion(d._id, d)
    // 刷新列表时间
    await reloadVersions()
    selectVersion(d._id)
    ElMessage.success('已保存')
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function addZone() {
  if (!draft.value) return
  draft.value.zones.push({ key: `z_${Date.now()}`, name: '新分区', description: '', traffic: 50, conversion: 20 })
}

function removeZone(idx) {
  if (!draft.value) return
  draft.value.zones.splice(idx, 1)
}

function addBom() {
  if (!draft.value) return
  draft.value.bom.push({ name: '新物料', spec: '', qty: 1, unitPrice: 0 })
}

function removeBom(idx) {
  if (!draft.value) return
  draft.value.bom.splice(idx, 1)
}

function addMilestone() {
  if (!draft.value) return
  draft.value.schedule.milestones ||= []
  draft.value.schedule.milestones.push({ name: '里程碑', date: '' })
}

function removeMilestone(idx) {
  if (!draft.value) return
  draft.value.schedule.milestones.splice(idx, 1)
}

function fillFromStore() {
  const st = selectedStore.value
  if (!draft.value || !st) return
  draft.value.constraints ||= {}
  if (draft.value.constraints.areaM2 == null && st.areaM2 != null) draft.value.constraints.areaM2 = st.areaM2
  if (!draft.value.constraints.notes) {
    const addr = st.address ? `地址：${st.address}` : ''
    const lease = st.leaseStart || st.leaseEnd ? `租约：${st.leaseStart || '—'} ~ ${st.leaseEnd || '—'}` : ''
    const parts = [addr, lease].filter(Boolean)
    if (parts.length) draft.value.constraints.notes = parts.join('\n')
  }
  ElMessage.success('已从门店档案补全（可继续手动完善）')
}

function buildAiInputPayload() {
  const st = selectedStore.value
  const v = draft.value
  return {
    store: st
      ? {
          id: st.id,
          code: st.code,
          name: st.name,
          city: st.city,
          address: st.address,
          areaM2: st.areaM2,
        }
      : null,
    version: {
      id: v?._id,
      versionName: v?.versionName,
      status: v?.status,
    },
    goals: v?.goals,
    constraints: v?.constraints,
    zones: v?.zones,
    existing: {
      narrative: v?.narrative,
      displayPlan: v?.displayPlan,
      bom: v?.bom,
      schedule: v?.schedule,
    },
  }
}

function extractJson(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  // 优先取 ```json ... ```
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  // 否则取第一段大括号
  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) return raw.slice(firstBrace, lastBrace + 1)
  return null
}

function applyAiResultToDraft(result) {
  if (!draft.value || !result || typeof result !== 'object') return
  draft.value.narrative ||= { theme: '', keyStory: '', photoSpots: [], interactions: [] }
  draft.value.displayPlan ||= { summary: '', zonePlans: [] }
  draft.value.schedule ||= { durationDays: 7, milestones: [] }
  draft.value.bom ||= []

  if (result.narrative) {
    if (typeof result.narrative.theme === 'string') draft.value.narrative.theme = result.narrative.theme
    if (typeof result.narrative.keyStory === 'string') draft.value.narrative.keyStory = result.narrative.keyStory
    if (Array.isArray(result.narrative.photoSpots)) draft.value.narrative.photoSpots = result.narrative.photoSpots
    if (Array.isArray(result.narrative.interactions)) draft.value.narrative.interactions = result.narrative.interactions
  }
  if (result.displayPlan) {
    if (typeof result.displayPlan.summary === 'string') draft.value.displayPlan.summary = result.displayPlan.summary
    if (Array.isArray(result.displayPlan.zonePlans)) draft.value.displayPlan.zonePlans = result.displayPlan.zonePlans
  }
  if (Array.isArray(result.bom)) {
    draft.value.bom = result.bom.map((x) => ({
      name: x?.name || '物料',
      spec: x?.spec || '',
      qty: Number(x?.qty) || 0,
      unitPrice: Number(x?.unitPrice) || 0,
    }))
  }
  if (result.schedule) {
    if (Number.isFinite(Number(result.schedule.durationDays))) draft.value.schedule.durationDays = Number(result.schedule.durationDays)
    if (Array.isArray(result.schedule.milestones)) {
      draft.value.schedule.milestones = result.schedule.milestones.map((m) => ({
        name: m?.name || '里程碑',
        date: (m?.date || '').slice(0, 10),
      }))
    }
  }
  // 同步预算合计
  draft.value.budget ||= { currency: 'CNY', capexTotal: 0, notes: '', items: [] }
  draft.value.budget.capexTotal = bomTotal.value
}

async function generateWithAI() {
  if (!draft.value) return
  if (!aiAvailable.value) {
    ElMessage.warning('未检测到可用 AI 配置（云端 Key / 本地模型），请先配置 .env')
    return
  }
  aiGenerating.value = true
  try {
    const input = buildAiInputPayload()
    const prompt = `你是一位同时懂「门店空间设计、展陈叙事、施工落地、成本与排期」的专业顾问。\n\n请基于以下输入 JSON，输出一个严格 JSON（不要 Markdown、不要解释），用于门店设计中心落库。\n\n约束：\n- 输出必须是一个 JSON 对象。\n- 字段必须包含：narrative、displayPlan、bom、schedule。\n- narrative: { theme, keyStory, photoSpots[], interactions[] }\n- displayPlan: { summary, zonePlans[] }（zonePlans 每项至少含 zoneName, keyPoints, products, interaction）\n- bom[]: 每项包含 name, spec, qty, unitPrice（unitPrice 为估算即可）。\n- schedule: { durationDays, milestones[] }（milestones 每项包含 name, date(可空)）。\n\n输入：\n${JSON.stringify(input, null, 2)}`

    const resp = await callGeminiAPI(prompt, {
      systemInstruction: '你输出的内容将直接写入系统，请确保可执行、克制、可落地。',
      temperature: 0.6,
    })
    const jsonText = extractJson(resp)
    if (!jsonText) throw new Error('AI 输出未包含可解析的 JSON')
    const parsed = JSON.parse(jsonText)
    draft.value.ai ||= { lastPrompt: '', lastResult: null, updatedAt: 0 }
    draft.value.ai.lastPrompt = prompt
    draft.value.ai.lastResult = parsed
    draft.value.ai.updatedAt = Date.now()
    applyAiResultToDraft(parsed)
    ElMessage.success('AI 已生成并填入，可继续人工调整后保存')
  } catch (e) {
    console.error(e)
    ElMessage.error(e?.message || 'AI 生成失败')
  } finally {
    aiGenerating.value = false
  }
}

function applyChangchunLiteTemplate() {
  if (!draft.value) return
  // 参考经营手册中「长春店 Lite 展陈改造」描述：保留底座、黄铜铭板、聚光灯、墙面铭牌、愿望卡盘等。
  draft.value.narrative ||= { theme: '', keyStory: '', photoSpots: [], interactions: [] }
  draft.value.displayPlan ||= { summary: '', zonePlans: [] }
  draft.value.constraints ||= {}

  draft.value.narrative.theme = draft.value.narrative.theme || '自然美学 · 黑金质感 · 单点聚光'
  draft.value.narrative.photoSpots = [
    '黑马聚光灯主位（3-5张）',
    '鼻尖包铜细节特写位',
    '“马上有”铜字/黄铜铭板特写位',
    '愿望卡盘与铅笔氛围位',
  ]
  draft.value.narrative.interactions = ['愿望卡填写', '黄铜触摸点', '门店打卡语引导']
  if (!draft.value.narrative.keyStory) {
    draft.value.narrative.keyStory =
      '以“马上有”的朴素祝福为核心叙事：在商场里藏一座博物馆。通过单点聚光与黄铜触摸点形成仪式感；动线以靠墙展陈为主，减少结构改造，强调可快速施工与可复制。'
  }

  if (!draft.value.constraints.wallMaterial) draft.value.constraints.wallMaterial = '深灰水泥纹理（深色基调）'
  if (!draft.value.constraints.lighting) draft.value.constraints.lighting = '新增顶部单盏聚光灯（3000K，CRI≥90）+ 现有灯带环境光'
  if (!draft.value.constraints.columns) draft.value.constraints.columns = '黑马靠墙陈列，左右紧邻展柜与木柱，无法做环形绕圈动线'
  draft.value.constraints.notes =
    (draft.value.constraints.notes ? draft.value.constraints.notes + '\n\n' : '') +
    'Lite 版要点：保留现有底座；横向黄铜铭板；顶部单盏聚光灯；墙面挂铭牌；现有木架加愿望卡盘；纸鹤首期不做。预算约 ¥3,000–3,500，工期 5–7 天。'

  draft.value.displayPlan.summary =
    draft.value.displayPlan.summary ||
    '以黑马为“镇店标本”形成单点聚焦：灯光聚焦 + 黄铜触摸点 + 铭牌信息卡，配合愿望卡作为可传播的互动装置。陈列优先为“拍照率 > 70%”服务，同时不影响安全与通行。'

  draft.value.bom = [
    { name: '黄铜铭板（横向）', spec: '定制铜牌，含“马上有”字样/故事', qty: 1, unitPrice: 600 },
    { name: '黄铜铭牌/信息卡', spec: '墙面铭牌 + 物种/叙事卡', qty: 2, unitPrice: 300 },
    { name: '顶部聚光灯', spec: '商用 3000K CRI≥90', qty: 1, unitPrice: 350 },
    { name: '愿望卡盘', spec: '25×15×5cm 浅木盘', qty: 1, unitPrice: 250 },
    { name: '愿望卡印刷', spec: '500 张，含铅笔', qty: 1, unitPrice: 350 },
  ]
  draft.value.budget ||= { currency: 'CNY', capexTotal: 0, notes: '', items: [] }
  draft.value.budget.notes = draft.value.budget.notes || '不含人工与运输，按 Lite 版估算，实际以采购/施工报价为准'

  draft.value.schedule ||= { durationDays: 7, milestones: [] }
  draft.value.schedule.durationDays = 7
  draft.value.schedule.milestones = [
    { name: 'D1 物料下单（铜牌/铭牌/灯具/愿望卡）', date: '' },
    { name: 'D3 施工进场（安装灯具/铭牌）', date: '' },
    { name: 'D5 陈列调整（触摸点/愿望卡盘）', date: '' },
    { name: 'D7 完工验收 + 拍摄首批内容', date: '' },
  ]

  ElMessage.success('已载入「长春店 Lite」模板，可继续调整后保存')
}

async function copyExport() {
  try {
    await navigator.clipboard.writeText(exportText.value)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败')
  }
}

function downloadExport() {
  const blob = new Blob([exportText.value], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(selectedStore.value?.name || '门店')}_${draft.value?.versionName || '设计版本'}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function openGovernanceAsset(moduleId, fileName) {
  const url = governanceAssetUrl(moduleId, fileName)
  window.open(url, '_blank', 'noopener,noreferrer')
}

function openGovernanceCenter() {
  // 通过 hash 片段提示用户在左侧菜单打开「公司治理」
  // 这里不强耦合 App 的 currentTab 状态，避免跨组件依赖；先用新标签页打开根页提示。
  window.open((import.meta.env.BASE_URL || '/'), '_blank', 'noopener,noreferrer')
  ElMessage.info('请在侧边栏进入「公司治理」，并在品牌管理中心中查阅相关资料')
}

function buildExportMarkdown(v, st) {
  const storeLine = st ? `${st.code || '—'} · ${st.name || '—'} · ${st.city || '—'}` : '—'
  const zones = (v.zones || [])
    .map((z) => `- ${z.name}: ${z.description || '—'}（热度${z.traffic ?? '—'} / 转化${z.conversion ?? '—'}）`)
    .join('\n')
  const bom = (v.bom || [])
    .map((b, i) => `${i + 1}. ${b.name}｜${b.spec || '—'}｜${b.qty || 0} × ¥${b.unitPrice || 0} = ¥${(Number(b.qty) || 0) * (Number(b.unitPrice) || 0)}`)
    .join('\n')
  const ms = (v.schedule?.milestones || []).map((m) => `- ${m.date || '—'} ${m.name || ''}`.trim()).join('\n')
  return [
    `# 门店设计方案 · ${v.versionName || v._id}`,
    '',
    `- 门店：${storeLine}`,
    `- 状态：${statusLabel(v.status)}`,
    `- 更新时间：${formatTime(v.updatedAt)}`,
    '',
    `## 目标指标`,
    `- 拍照率目标：${v.goals?.photoRateTarget ?? '—'}`,
    `- 转化率目标：${v.goals?.conversionTarget ?? '—'}`,
    `- 客单价目标：¥${v.goals?.aovTarget ?? '—'}`,
    '',
    `## 空间与施工约束`,
    `- 面积：${v.constraints?.areaM2 ?? '—'} ㎡`,
    `- 层高：${v.constraints?.ceilingHeightM ?? '—'} m`,
    `- 柱位/结构：${v.constraints?.columns || '—'}`,
    `- 材质：${v.constraints?.wallMaterial || '—'}`,
    `- 灯光：${v.constraints?.lighting || '—'}`,
    `- 消防/合规：${v.constraints?.fireSafety || '—'}`,
    '',
    `## 分区与动线`,
    zones || '- —',
    '',
    `## 核心叙事`,
    `- 主题：${v.narrative?.theme || '—'}`,
    '',
    v.narrative?.keyStory ? v.narrative.keyStory : '（未填写）',
    '',
    `## 打卡位`,
    (v.narrative?.photoSpots || []).map((x) => `- ${x}`).join('\n') || '- —',
    '',
    `## 互动点`,
    (v.narrative?.interactions || []).map((x) => `- ${x}`).join('\n') || '- —',
    '',
    `## 展陈方案摘要`,
    v.displayPlan?.summary ? v.displayPlan.summary : '（未填写）',
    '',
    `## 物料与预算`,
    bom || '（暂无物料）',
    '',
    `- 预算合计：¥${formatMoney((v.budget?.capexTotal ?? 0) || 0)}`,
    v.budget?.notes ? `- 备注：${v.budget.notes}` : '',
    '',
    `## 排期`,
    ms || '- —',
    '',
  ]
    .filter((x) => x !== '')
    .join('\n')
}

onMounted(() => {
  storeBundle.value = ensureDefaultFinanceStoreInLocalBundle()
  if (storeOptions.value[0]?.value) selectedStoreId.value = storeOptions.value[0].value
})

watch(selectedStoreId, async () => {
  await reloadVersions()
})
</script>

<style scoped>
.sdc-root {
  min-height: 100%;
  padding: var(--space-6) var(--space-8);
  box-sizing: border-box;
}

.sdc-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: var(--space-5);
}

.sdc-title {
  margin: 0;
  font-size: var(--text-2xl);
  color: var(--light-text-primary);
}

.sdc-subtitle {
  margin: 6px 0 0;
  font-size: var(--text-sm);
  color: var(--light-text-secondary);
}

.sdc-layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: var(--space-6);
  align-items: start;
}

.sdc-left {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.card {
  background: var(--viz-surface);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-xl);
  padding: var(--space-4);
}

.card-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-2);
}

.card-title {
  font-weight: var(--weight-semibold);
  color: var(--light-text-primary);
  margin-bottom: var(--space-2);
}

.hint {
  margin-top: 10px;
  font-size: var(--text-xs);
  color: var(--light-text-tertiary);
}

.versions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.ver-item {
  width: 100%;
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-lg);
  padding: 10px 10px;
  background: var(--light-bg-elevated);
  cursor: pointer;
  text-align: left;
}

.ver-item.active {
  border-color: var(--brand-green-500);
  box-shadow: var(--shadow-sm);
}

.ver-name {
  font-weight: 600;
  color: var(--light-text-primary);
}

.ver-meta {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 6px;
}

.ver-time {
  font-size: 12px;
  color: var(--light-text-tertiary);
}

.empty {
  padding: 10px;
  font-size: 12px;
  color: var(--light-text-tertiary);
}

.sdc-main {
  background: var(--viz-surface);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-xl);
  min-height: 72vh;
  padding: var(--space-4);
}

.empty-main {
  padding: 32px 16px;
  text-align: center;
  color: var(--light-text-secondary);
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--light-text-primary);
  margin-bottom: 6px;
}

.empty-desc {
  font-size: 13px;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.panel {
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-xl);
  padding: var(--space-4);
  background: var(--light-bg-elevated);
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: var(--space-3);
}

.panel-title {
  font-weight: 600;
  color: var(--light-text-primary);
}

.gov-hint {
  margin-bottom: var(--space-3);
}

.gov-links {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.gov-link {
  width: 100%;
  text-align: left;
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-lg);
  padding: 10px 12px;
  background: var(--light-bg-elevated);
  cursor: pointer;
}

.gov-link:hover {
  border-color: var(--brand-green-500);
  box-shadow: var(--shadow-sm);
}

.gov-link--muted:hover {
  border-color: var(--light-border-default);
  box-shadow: none;
}

.gov-link-title {
  display: block;
  font-weight: 600;
  color: var(--light-text-primary);
}

.gov-link-sub {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--light-text-tertiary);
}

.budget-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.budget-left {
  flex: 1;
}

.budget-right {
  display: flex;
  gap: 10px;
  align-items: baseline;
}

.budget-label {
  font-size: 12px;
  color: var(--light-text-tertiary);
}

.budget-value {
  font-weight: 700;
  color: var(--light-text-primary);
}

.milestones {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ms-item {
  display: grid;
  grid-template-columns: 1fr 180px 40px;
  gap: 10px;
  align-items: center;
}

@media (max-width: 1100px) {
  .sdc-layout {
    grid-template-columns: 1fr;
  }
  .grid2 {
    grid-template-columns: 1fr;
  }
  .ms-item {
    grid-template-columns: 1fr;
  }
}
</style>

