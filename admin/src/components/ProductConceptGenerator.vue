<template>
  <div class="pcg-root">
    <header class="pcg-hero">
      <div class="pcg-hero-text">
        <p class="pcg-eyebrow">战略 · 产品立项</p>
        <h1 class="pcg-title">爆品概念生成器</h1>
        <p class="pcg-lead">
          基于产品定位与渠道客群筛选项，生成可落地的新品 SKU 概念：结构化字段、批量变体、历史收藏、导出与战略看板联动。
        </p>
      </div>
      <div class="pcg-hero-actions">
        <el-button @click="goStrategy">战略调研看板</el-button>
        <el-button type="primary" :disabled="!selectedIds.length" @click="exportBatch('md')">
          批量导出 MD
        </el-button>
        <el-button :disabled="!selectedIds.length" @click="exportBatch('json')">批量 JSON</el-button>
      </div>
    </header>

    <div class="pcg-workspace">
      <!-- 输入条件 -->
      <section class="pcg-panel pcg-input" aria-label="输入条件">
        <div class="pcg-panel-head">
          <h2>输入条件</h2>
          <span class="pcg-panel-hint">定位 · 类别 · 方向 · 渠道 · 客群</span>
        </div>

        <div class="pcg-type-grid">
          <button
            v-for="type in productTypes"
            :key="type.value"
            type="button"
            class="pcg-type-btn"
            :class="{ active: selectedProductType === type.value }"
            @click="selectedProductType = type.value"
          >
            <span class="pcg-type-icon" aria-hidden="true">{{ type.icon }}</span>
            <span class="pcg-type-name">{{ type.name }}</span>
            <span class="pcg-type-desc">{{ type.desc }}</span>
            <span class="pcg-type-meta">
              ¥{{ type.priceRange }} · 毛利 {{ type.margin }}%
            </span>
          </button>
        </div>

        <div class="pcg-filters">
          <div class="pcg-form-row">
            <div class="pcg-field">
              <label>产品类别</label>
              <el-select v-model="generatorOptions.category" style="width: 100%">
                <el-option
                  v-for="opt in categoryOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </div>
            <div class="pcg-field">
              <label>创新方向</label>
              <el-select v-model="generatorOptions.innovation" style="width: 100%">
                <el-option
                  v-for="opt in innovationOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </div>
          </div>

          <div class="pcg-form-row">
            <div class="pcg-field">
              <label>渠道场景</label>
              <el-select v-model="generatorOptions.channel" style="width: 100%">
                <el-option
                  v-for="opt in channelOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </div>
            <div class="pcg-field">
              <label>目标客群</label>
              <el-select v-model="generatorOptions.audience" style="width: 100%">
                <el-option
                  v-for="opt in audienceOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </div>
          </div>
        </div>

        <div class="pcg-field">
          <label>补充约束（可选）</label>
          <el-input
            v-model="generatorOptions.notes"
            type="textarea"
            :rows="3"
            maxlength="400"
            show-word-limit
            placeholder="例如：面向节气礼赠、强调合规可售标本来源、可搭配门店体验课…"
          />
        </div>

        <div class="pcg-examples">
          <span class="pcg-examples-label">示例一键填入</span>
          <div class="pcg-example-chips">
            <button
              v-for="ex in examples"
              :key="ex.id"
              type="button"
              class="pcg-chip"
              @click="applyExample(ex)"
            >
              {{ ex.label }}
            </button>
          </div>
        </div>

        <div class="pcg-gen-actions">
          <el-button
            type="primary"
            size="large"
            :loading="isGenerating && batchTotal === 1"
            :disabled="isGenerating"
            @click="generateProductConcept()"
          >
            {{ isGenerating && batchTotal === 1 ? '正在生成…' : '生成新品方案' }}
          </el-button>
          <el-button
            size="large"
            :loading="isGenerating && batchTotal > 1"
            :disabled="isGenerating"
            @click="generateBatch(3)"
          >
            {{ isGenerating && batchTotal > 1 ? `批量 ${batchDone}/${batchTotal}` : '批量 3 变体' }}
          </el-button>
          <el-button size="large" :disabled="isGenerating" @click="rollDice">
            灵感骰子
          </el-button>
          <el-button v-if="isGenerating" size="large" @click="abortGeneration">中止</el-button>
        </div>
        <p v-if="isGenerating && batchTotal > 1" class="pcg-batch-hint">
          正在串行生成第 {{ Math.min(batchDone + 1, batchTotal) }} / {{ batchTotal }} 个变体…
        </p>
      </section>

      <!-- 生成结果 -->
      <section class="pcg-panel pcg-result" aria-label="生成结果">
        <div class="pcg-panel-head">
          <h2>生成结果</h2>
          <span class="pcg-panel-hint">
            {{ batchResults.length > 1 ? `本批 ${batchResults.length} 个变体` : '结构化概念卡片' }}
          </span>
        </div>

        <div v-if="isGenerating && !generatedConcept" class="pcg-loading">
          <el-icon class="pcg-spin"><Loading /></el-icon>
          <p>
            {{
              batchTotal > 1
                ? `AI 正在批量构思（${batchDone}/${batchTotal}）…`
                : 'AI 正在构思爆品概念，可随时中止…'
            }}
          </p>
        </div>

        <div v-else-if="!generatedConcept" class="pcg-empty">
          <strong>从条件开始，或掷一次灵感骰子</strong>
          <p>
            选择定位卡片与筛选项后生成；也可点「灵感骰子」随机组合，或用示例一键填入。批量生成可一次得到 3 个差异化变体。
          </p>
        </div>

        <template v-else>
          <div v-if="batchResults.length > 1" class="pcg-batch-tabs">
            <button
              v-for="(item, idx) in batchResults"
              :key="item.id"
              type="button"
              class="pcg-batch-tab"
              :class="{ active: generatedConcept?.id === item.id }"
              @click="loadConcept(item)"
            >
              变体 {{ idx + 1 }} · {{ shortName(item.name) }}
            </button>
          </div>

          <article class="pcg-concept-card">
            <div class="pcg-concept-head">
              <div>
                <h3>{{ generatedConcept.name }}</h3>
                <div class="pcg-tags">
                  <span class="pcg-tag">{{ generatedConcept.position }}</span>
                  <span class="pcg-tag gold">¥{{ generatedConcept.price }}</span>
                  <span
                    v-for="tag in filterTags(generatedConcept)"
                    :key="tag"
                    class="pcg-tag soft"
                  >
                    {{ tag }}
                  </span>
                  <span v-if="generatedConcept.favorite" class="pcg-tag fav">已收藏</span>
                </div>
              </div>
              <div class="pcg-concept-actions">
                <el-button size="small" @click="copyConcept">复制</el-button>
                <el-button size="small" @click="toggleCurrentFavorite">
                  {{ generatedConcept.favorite ? '取消收藏' : '收藏' }}
                </el-button>
                <el-dropdown trigger="click" @command="onExportCurrent">
                  <el-button size="small">导出</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="md">Markdown</el-dropdown-item>
                      <el-dropdown-item command="json">JSON</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <el-button size="small" @click="regenerateSameFilters">同条件再生成</el-button>
                <el-button size="small" @click="generateVariant">变体再生成</el-button>
                <el-button size="small" type="primary" plain @click="bringToStrategy">
                  带回战略看板
                </el-button>
              </div>
            </div>

            <div class="pcg-fields-grid">
              <div class="pcg-field-block">
                <span class="pcg-label">品名</span>
                <p>{{ generatedConcept.name }}</p>
              </div>
              <div class="pcg-field-block">
                <span class="pcg-label">定位</span>
                <p>{{ generatedConcept.position }}</p>
              </div>
              <div class="pcg-field-block">
                <span class="pcg-label">价格带</span>
                <p>{{ generatedConcept.priceBand || `¥${generatedConcept.price}` }}</p>
              </div>
              <div class="pcg-field-block">
                <span class="pcg-label">建议定价 / 毛利</span>
                <p class="pcg-price">¥{{ generatedConcept.price }} · {{ generatedConcept.margin }}%</p>
              </div>
              <div class="pcg-field-block span-2">
                <span class="pcg-label">目标客群</span>
                <p>{{ generatedConcept.targetAudience }}</p>
              </div>
              <div class="pcg-field-block span-2">
                <span class="pcg-label">核心卖点</span>
                <ul class="pcg-list">
                  <li v-for="(p, i) in generatedConcept.sellingPoints || []" :key="i">{{ p }}</li>
                </ul>
              </div>
              <div class="pcg-field-block span-2">
                <span class="pcg-label">材质与工艺</span>
                <p>{{ generatedConcept.materials }}</p>
              </div>
              <div class="pcg-field-block">
                <span class="pcg-label">渠道建议</span>
                <ul class="pcg-list">
                  <li v-for="(ch, i) in asList(generatedConcept.channels)" :key="'ch-' + i">{{ ch }}</li>
                </ul>
              </div>
              <div class="pcg-field-block">
                <span class="pcg-label">市场策略</span>
                <p>{{ generatedConcept.strategy }}</p>
              </div>
              <div class="pcg-field-block">
                <span class="pcg-label">风险提示</span>
                <ul class="pcg-list warn">
                  <li v-for="(r, i) in asList(generatedConcept.risks)" :key="'rk-' + i">{{ r }}</li>
                </ul>
              </div>
              <div class="pcg-field-block">
                <span class="pcg-label">下一步动作</span>
                <ul class="pcg-list">
                  <li v-for="(a, i) in asList(generatedConcept.nextActions)" :key="'na-' + i">{{ a }}</li>
                </ul>
              </div>
            </div>

            <!-- 效果图 · 一键生图 -->
            <section class="pcg-image-section" aria-label="概念效果图">
              <div class="pcg-image-head">
                <div>
                  <h4>概念效果图</h4>
                  <p class="pcg-image-hint">基于结构化字段组装视觉描述，支持站内生图或跳转 Gemini 粘贴生成</p>
                </div>
                <div class="pcg-image-actions">
                  <el-button
                    type="primary"
                    :loading="imageGenLoading"
                    :disabled="imageGenLoading"
                    @click="generateInSiteImage"
                  >
                    {{
                      imageGenLoading
                        ? '正在生图…'
                        : imageGenEnabled
                          ? '生成效果图'
                          : '需配置 Key'
                    }}
                  </el-button>
                  <el-button :disabled="imageGenLoading" @click="openPromptPreview">
                    预览 / 编辑描述
                  </el-button>
                  <el-button :disabled="imageGenLoading" @click="openGeminiExternal">
                    在 Gemini 中生图
                  </el-button>
                </div>
              </div>

              <p v-if="!imageGenEnabled" class="pcg-image-config-hint">
                站内生图需配置
                <code>VITE_IMAGE_GEN_ENABLED=1</code>
                及 Gemini / OpenAI / 百炼 Key；亦可直接使用「在 Gemini 中生图」（自动复制描述）。
              </p>

              <div v-if="imageGenLoading" class="pcg-image-loading">
                <el-icon class="pcg-spin"><Loading /></el-icon>
                <span>AI 正在绘制产品效果图，约需 15–40 秒…</span>
              </div>

              <div v-else-if="imageGenError" class="pcg-image-error">
                <strong>生图失败</strong>
                <p>{{ imageGenError }}</p>
                <el-button size="small" type="primary" plain @click="openGeminiExternal">
                  改用 Gemini 外链
                </el-button>
              </div>

              <div v-else-if="currentDisplayImage" class="pcg-image-preview">
                <img :src="currentDisplayImage" :alt="`${generatedConcept.name} 概念效果图`" />
                <div class="pcg-image-meta">
                  <span v-if="generatedConcept.generatedImage?.provider">
                    {{ providerLabel(generatedConcept.generatedImage.provider) }}
                  </span>
                  <span v-if="generatedConcept.generatedImage?.createdAt">
                    {{ formatImageTime(generatedConcept.generatedImage.createdAt) }}
                  </span>
                  <el-button link type="primary" @click="downloadCurrentImage">下载</el-button>
                </div>
              </div>

              <div v-else class="pcg-image-empty">
                <span>尚无效果图，点击「生成效果图」或「在 Gemini 中生图」开始视觉化</span>
              </div>
            </section>
          </article>
        </template>
      </section>
    </div>

    <!-- 历史与收藏 -->
    <section class="pcg-panel pcg-history" aria-label="历史概念">
      <div class="pcg-panel-head pcg-history-head">
        <div>
          <h2>历史概念</h2>
          <span class="pcg-panel-hint">localStorage 持久化 · {{ conceptHistory.length }} 条</span>
        </div>
        <div class="pcg-history-tools">
          <el-input
            v-model="historyQuery"
            clearable
            placeholder="搜索品名 / 定位 / 客群 / 类别"
            style="width: 240px"
          />
          <el-radio-group v-model="historyFilter" size="small">
            <el-radio-button label="all">全部</el-radio-button>
            <el-radio-button label="fav">收藏</el-radio-button>
          </el-radio-group>
          <el-button
            size="small"
            :disabled="!filteredHistory.length"
            @click="selectAllFiltered"
          >
            {{ allFilteredSelected ? '取消全选' : '全选当前' }}
          </el-button>
        </div>
      </div>

      <div v-if="!filteredHistory.length" class="pcg-empty compact">
        <p>
          {{
            conceptHistory.length
              ? '无匹配结果'
              : '生成后的概念会出现在这里。试试灵感骰子或示例填入，再点生成 / 批量变体。'
          }}
        </p>
      </div>

      <div v-else class="pcg-history-grid">
        <div
          v-for="item in filteredHistory"
          :key="item.id"
          class="pcg-history-card"
          :class="{ active: generatedConcept?.id === item.id, selected: selectedIds.includes(item.id) }"
        >
          <label class="pcg-check">
            <input
              type="checkbox"
              :checked="selectedIds.includes(item.id)"
              @change="toggleSelect(item.id)"
            />
          </label>
          <button type="button" class="pcg-history-main" @click="loadConcept(item)">
            <div class="pcg-history-top">
              <strong>{{ item.name }}</strong>
              <span v-if="item.favorite" class="pcg-star" title="已收藏">★</span>
            </div>
            <div class="pcg-history-meta">
              <span>{{ item.position }}</span>
              <span>¥{{ item.price }}</span>
              <span v-if="item.options?.categoryLabel">{{ item.options.categoryLabel }}</span>
            </div>
            <p class="pcg-history-snippet">{{ snippet(item) }}</p>
          </button>
          <div class="pcg-history-ops">
            <el-button link type="primary" @click="loadConcept(item)">打开</el-button>
            <el-button link @click="regenerateFromHistory(item)">同条件</el-button>
            <el-button link @click="generateVariantFrom(item)">变体</el-button>
            <el-button link @click="toggleFavoriteById(item.id)">
              {{ item.favorite ? '取消收藏' : '收藏' }}
            </el-button>
            <el-button link type="danger" @click="deleteConcept(item.id)">删除</el-button>
          </div>
        </div>
      </div>
    </section>

    <el-dialog
      v-model="promptPreviewVisible"
      title="视觉描述预览"
      width="min(640px, 92vw)"
      destroy-on-close
    >
      <p class="pcg-dialog-hint">可编辑后用于站内生图或复制到 Gemini；外链无法自动填入，需手动粘贴。</p>
      <el-input
        v-model="editablePrompt"
        type="textarea"
        :rows="12"
        maxlength="4000"
        show-word-limit
      />
      <template #footer>
        <el-button @click="promptPreviewVisible = false">关闭</el-button>
        <el-button @click="copyEditablePrompt">复制描述</el-button>
        <el-button type="primary" plain @click="openGeminiFromPreview">在 Gemini 中生图</el-button>
        <el-button
          type="primary"
          :loading="imageGenLoading"
          :disabled="!imageGenEnabled || imageGenLoading"
          @click="generateFromPreview"
        >
          {{ imageGenEnabled ? '站内生图' : '需配置 Key' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import { callGeminiAPI, extractJSON, isAbortError } from '../utils/aiHelper'
import {
  PRODUCT_TYPES,
  CATEGORY_OPTIONS,
  INNOVATION_OPTIONS,
  CHANNEL_OPTIONS,
  AUDIENCE_OPTIONS,
  CONCEPT_EXAMPLES,
  labelOf,
  randomFilterCombo
} from '../data/productConcept'
import {
  loadConcepts,
  upsertConcept,
  removeConcept,
  toggleFavorite,
  markForStrategyBoard,
  downloadTextFile,
  conceptToMarkdown
} from '../utils/productConceptStorage'
import {
  buildConceptVisualPrompt,
  generateConceptImage,
  isImageGenEnabled,
  openGeminiImageApp,
  revokeConceptImageUrls
} from '../utils/conceptImageGen'

defineOptions({ name: 'ProductConceptGenerator' })

const emit = defineEmits(['switch-tab'])

const productTypes = PRODUCT_TYPES
const categoryOptions = CATEGORY_OPTIONS
const innovationOptions = INNOVATION_OPTIONS
const channelOptions = CHANNEL_OPTIONS
const audienceOptions = AUDIENCE_OPTIONS
const examples = CONCEPT_EXAMPLES

const selectedProductType = ref('profit')
const generatorOptions = ref({
  category: 'insect',
  innovation: 'design',
  channel: 'store',
  audience: 'family',
  notes: ''
})
const isGenerating = ref(false)
const generatedConcept = ref(null)
const conceptHistory = ref([])
const historyQuery = ref('')
const historyFilter = ref('all')
const selectedIds = ref([])
const batchResults = ref([])
const batchTotal = ref(1)
const batchDone = ref(0)

const imageGenLoading = ref(false)
const imageGenError = ref('')
const promptPreviewVisible = ref(false)
const editablePrompt = ref('')
const liveImageUrl = ref('')
const imageGenEnabled = isImageGenEnabled()

let abortController = null
let imageAbortController = null

const typeMeta = (value) => productTypes.find((t) => t.value === value)

const asList = (v) => {
  if (Array.isArray(v)) return v.filter(Boolean)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

const shortName = (name) => {
  const s = String(name || '').trim()
  return s.length > 10 ? `${s.slice(0, 10)}…` : s || '未命名'
}

const snippet = (item) => {
  const t = String(item?.targetAudience || item?.strategy || '').replace(/\s+/g, ' ').trim()
  return t ? `${t.slice(0, 72)}${t.length > 72 ? '…' : ''}` : '—'
}

const snapshotOptions = () => {
  const type = typeMeta(selectedProductType.value)
  const opts = generatorOptions.value
  return {
    productType: selectedProductType.value,
    category: opts.category,
    innovation: opts.innovation,
    channel: opts.channel,
    audience: opts.audience,
    notes: opts.notes || '',
    productTypeLabel: type?.name || '',
    categoryLabel: labelOf(categoryOptions, opts.category),
    innovationLabel: labelOf(innovationOptions, opts.innovation),
    channelLabel: labelOf(channelOptions, opts.channel),
    audienceLabel: labelOf(audienceOptions, opts.audience)
  }
}

const applyOptionsSnapshot = (options = {}) => {
  if (options.productType) selectedProductType.value = options.productType
  generatorOptions.value = {
    category: options.category || generatorOptions.value.category,
    innovation: options.innovation || generatorOptions.value.innovation,
    channel: options.channel || generatorOptions.value.channel || 'store',
    audience: options.audience || generatorOptions.value.audience || 'family',
    notes: options.notes ?? generatorOptions.value.notes ?? ''
  }
}

const filterTags = (concept) => {
  const o = concept?.options || {}
  return [o.categoryLabel, o.innovationLabel, o.channelLabel, o.audienceLabel].filter(Boolean)
}

const filteredHistory = computed(() => {
  const q = historyQuery.value.trim().toLowerCase()
  return conceptHistory.value.filter((c) => {
    if (historyFilter.value === 'fav' && !c.favorite) return false
    if (!q) return true
    const o = c.options || {}
    const hay = [
      c.name,
      c.position,
      c.targetAudience,
      ...(c.sellingPoints || []),
      o.categoryLabel,
      o.innovationLabel,
      o.channelLabel,
      o.audienceLabel
    ]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
})

const allFilteredSelected = computed(() => {
  const ids = filteredHistory.value.map((c) => c.id)
  return ids.length > 0 && ids.every((id) => selectedIds.value.includes(id))
})

const currentVisualPrompt = computed(() =>
  generatedConcept.value ? buildConceptVisualPrompt(generatedConcept.value) : ''
)

const currentDisplayImage = computed(() => {
  if (liveImageUrl.value) return liveImageUrl.value
  const thumb = generatedConcept.value?.generatedImage?.thumbUrl
  return thumb || ''
})

const providerLabel = (p) =>
  ({ gemini: 'Gemini Imagen', openai: 'OpenAI', bailian: '百炼万相' }[p] || p)

const formatImageTime = (ts) =>
  ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : ''

const resetImageSession = () => {
  if (liveImageUrl.value?.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(liveImageUrl.value)
    } catch {
      /* ignore */
    }
  }
  liveImageUrl.value = ''
  imageGenError.value = ''
}

const persistConceptImage = (concept, imageResult) => {
  if (!concept?.id || !imageResult) return concept
  const next = {
    ...concept,
    generatedImage: {
      thumbUrl: imageResult.thumbUrl,
      provider: imageResult.provider,
      createdAt: imageResult.createdAt,
    },
  }
  conceptHistory.value = upsertConcept(next, conceptHistory.value)
  if (generatedConcept.value?.id === concept.id) {
    generatedConcept.value = { ...next }
  }
  const inBatch = batchResults.value.findIndex((c) => c.id === concept.id)
  if (inBatch >= 0) {
    batchResults.value = batchResults.value.map((c) => (c.id === concept.id ? next : c))
  }
  return next
}

const runInSiteImageGen = async (promptText) => {
  if (!generatedConcept.value) return
  const prompt = String(promptText || '').trim()
  if (!prompt) {
    ElMessage.warning('视觉描述为空')
    return
  }
  if (!imageGenEnabled) {
    ElMessage.warning('站内生图未配置 Key，请使用「在 Gemini 中生图」')
    openPromptPreview()
    return
  }

  imageGenLoading.value = true
  imageGenError.value = ''
  imageAbortController = new AbortController()

  try {
    const result = await generateConceptImage(prompt, { signal: imageAbortController.signal })
    resetImageSession()
    liveImageUrl.value = result.displayUrl
    persistConceptImage(generatedConcept.value, result)
    ElMessage.success(`效果图已生成（${providerLabel(result.provider)}）`)
    promptPreviewVisible.value = false
  } catch (error) {
    if (isAbortError(error)) {
      ElMessage.info('已中止生图')
    } else {
      console.error('[概念生图]', error)
      imageGenError.value = error.message || '未知错误'
      ElMessage.error(`生图失败：${imageGenError.value}`)
    }
  } finally {
    imageGenLoading.value = false
    imageAbortController = null
  }
}

const generateInSiteImage = () => runInSiteImageGen(currentVisualPrompt.value)

const generateFromPreview = () => runInSiteImageGen(editablePrompt.value)

const openPromptPreview = () => {
  editablePrompt.value = currentVisualPrompt.value
  promptPreviewVisible.value = true
}

const copyEditablePrompt = async () => {
  try {
    await navigator.clipboard.writeText(editablePrompt.value)
    ElMessage.success('视觉描述已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选中复制')
  }
}

const launchGeminiWithPrompt = async (prompt) => {
  const text = String(prompt || '').trim()
  if (!text) {
    ElMessage.warning('视觉描述为空')
    return
  }
  try {
    const { copied } = await openGeminiImageApp(text)
    if (copied) {
      ElMessage.success('已复制视觉描述，请在 Gemini 粘贴后生成')
    } else {
      ElMessage.warning('无法写入剪贴板，请从预览弹窗手动复制后粘贴到 Gemini')
      editablePrompt.value = text
      promptPreviewVisible.value = true
    }
  } catch (error) {
    ElMessage.error(error.message || '打开 Gemini 失败')
  }
}

const openGeminiExternal = () => launchGeminiWithPrompt(currentVisualPrompt.value)

const openGeminiFromPreview = () => launchGeminiWithPrompt(editablePrompt.value)

const downloadCurrentImage = () => {
  const src = currentDisplayImage.value
  if (!src || !generatedConcept.value) return
  const safe = String(generatedConcept.value.name || 'concept').replace(/[\\/:*?"<>|]/g, '_')
  const a = document.createElement('a')
  a.href = src
  a.download = `${safe}_效果图.jpg`
  a.click()
}

const goStrategy = () => {
  emit('switch-tab', '10')
  window.dispatchEvent(new CustomEvent('switch-tab', { detail: '10' }))
}

const applyExample = (ex) => {
  selectedProductType.value = ex.productType
  generatorOptions.value = {
    category: ex.category,
    innovation: ex.innovation,
    channel: ex.channel || 'store',
    audience: ex.audience || 'family',
    notes: ex.notes || ''
  }
  ElMessage.success(`已填入示例：${ex.label}`)
}

const rollDice = () => {
  const combo = randomFilterCombo()
  selectedProductType.value = combo.productType
  generatorOptions.value = {
    category: combo.category,
    innovation: combo.innovation,
    channel: combo.channel,
    audience: combo.audience,
    notes: ''
  }
  const type = typeMeta(combo.productType)
  ElMessage.success(
    `灵感组合：${type?.name} · ${labelOf(categoryOptions, combo.category)} · ${labelOf(innovationOptions, combo.innovation)}`
  )
}

const normalizeConcept = (raw, meta = {}) => {
  const snap = meta.optionsSnapshot || snapshotOptions()
  const productType = typeMeta(snap.productType) || typeMeta(selectedProductType.value)
  const price = String(raw.price ?? '').replace(/[^\d.]/g, '') || String(raw.price || '')
  return {
    id: meta.id || `concept_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    name: raw.name || '未命名概念',
    position: raw.position || productType?.name || '',
    price,
    priceBand: raw.priceBand || (productType ? `¥${productType.priceRange}` : ''),
    margin: String(raw.margin ?? productType?.margin ?? '').replace(/%/g, ''),
    materials: raw.materials || '',
    sellingPoints: Array.isArray(raw.sellingPoints) ? raw.sellingPoints : asList(raw.sellingPoints),
    targetAudience: raw.targetAudience || '',
    strategy: raw.strategy || '',
    channels: Array.isArray(raw.channels) ? raw.channels : asList(raw.channels),
    risks: Array.isArray(raw.risks) ? raw.risks : asList(raw.risks),
    nextActions: Array.isArray(raw.nextActions) ? raw.nextActions : asList(raw.nextActions),
    favorite: Boolean(meta.favorite ?? raw.favorite),
    createdAt: meta.createdAt || Date.now(),
    options: snap,
    variantOf: meta.variantOf || null
  }
}

const buildPrompt = (opts = {}) => {
  const snap = opts.optionsSnapshot || snapshotOptions()
  const productType = typeMeta(snap.productType)
  const randomSeed = Math.floor(Math.random() * 10000)
  const notes = snap.notes?.trim()
  const baseHint = opts.variantOf
    ? `\n这是基于「${opts.variantOf.name}」的变体方案，请保留定位与客群方向，但品名、卖点与材质必须明显不同。`
    : ''
  const batchHint =
    opts.batchIndex != null
      ? `\n这是同条件批量生成的第 ${opts.batchIndex + 1} 个变体，请与同批其他方案在品名、叙事角度、材质组合上明显区分。`
      : ''

  return `你是山海造物标本艺术馆的产品设计师。请基于以下信息，生成一个全新的、独特的爆品SKU方案（随机种子 ${randomSeed}，请确保内容独特）：

产品定位：${productType.name}（${productType.desc}）
价格区间：¥${productType.priceRange}
目标毛利率：${productType.margin}%
产品类别：${snap.categoryLabel}（仅使用合规可售的标本 / 自然文创品类，勿建议违法采集或禁售物种）
创新方向：${snap.innovationLabel}
渠道场景：${snap.channelLabel}
目标客群筛选项：${snap.audienceLabel}
${notes ? `补充约束：${notes}` : ''}
${baseHint}${batchHint}

请生成完整产品方案，并以 JSON 返回（不要 markdown 代码块）：
{
  "name": "产品名称",
  "position": "${productType.name}",
  "price": "具体价格数字",
  "priceBand": "¥${productType.priceRange}",
  "margin": "毛利率百分比数字",
  "materials": "材质与工艺详细描述",
  "sellingPoints": ["卖点1", "卖点2", "卖点3"],
  "targetAudience": "目标客群描述（需呼应筛选项「${snap.audienceLabel}」）",
  "strategy": "市场策略描述（需呼应渠道「${snap.channelLabel}」）",
  "channels": ["渠道1", "渠道2"],
  "risks": ["风险1", "风险2"],
  "nextActions": ["下一步动作1", "下一步动作2", "下一步动作3"]
}`
}

const abortGeneration = () => {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
}

const runSingleGeneration = async (opts = {}) => {
  const snap = opts.optionsSnapshot || snapshotOptions()
  const productType = typeMeta(snap.productType)
  if (!productType) throw new Error('请先选择产品定位')

  abortController = new AbortController()
  const text = await callGeminiAPI(buildPrompt({ ...opts, optionsSnapshot: snap }), {
    temperature: 0.95,
    maxOutputTokens: 4096,
    usePro: false,
    useCache: false,
    signal: abortController.signal
  })

  const raw = extractJSON(text)
  if (!raw?.name || !raw?.price) {
    throw new Error('AI 返回数据不完整，缺少品名或定价')
  }

  return normalizeConcept(raw, {
    variantOf: opts.variantOf?.id || null,
    favorite: false,
    optionsSnapshot: snap
  })
}

const generateProductConcept = async (opts = {}) => {
  if (isGenerating.value) return

  const snap = opts.optionsSnapshot || snapshotOptions()
  if (!typeMeta(snap.productType)) {
    ElMessage.warning('请先选择产品定位')
    return
  }

  if (!opts.keepBatch) batchResults.value = []
  if (!opts.silentClear) generatedConcept.value = null

  isGenerating.value = true
  batchTotal.value = 1
  batchDone.value = 0

  try {
    const concept = await runSingleGeneration(opts)
    generatedConcept.value = concept
    batchResults.value = [concept]
    conceptHistory.value = upsertConcept(concept, conceptHistory.value)
    batchDone.value = 1
    ElMessage.success('概念已生成并写入历史')
  } catch (error) {
    if (isAbortError(error)) {
      ElMessage.info('已中止生成')
    } else {
      console.error('[爆品概念生成]', error)
      ElMessage.error(`生成失败：${error.message || '未知错误'}`)
    }
    if (!opts.keepBatch) {
      generatedConcept.value = null
      batchResults.value = []
    }
  } finally {
    isGenerating.value = false
    abortController = null
    batchTotal.value = 1
  }
}

const generateBatch = async (count = 3) => {
  if (isGenerating.value) return
  const snap = snapshotOptions()
  if (!typeMeta(snap.productType)) {
    ElMessage.warning('请先选择产品定位')
    return
  }

  const n = Math.min(Math.max(Number(count) || 3, 2), 3)
  isGenerating.value = true
  batchTotal.value = n
  batchDone.value = 0
  batchResults.value = []
  generatedConcept.value = null

  try {
    for (let i = 0; i < n; i++) {
      const concept = await runSingleGeneration({
        optionsSnapshot: snap,
        batchIndex: i
      })
      batchResults.value = [...batchResults.value, concept]
      conceptHistory.value = upsertConcept(concept, conceptHistory.value)
      generatedConcept.value = concept
      batchDone.value = i + 1
    }
    ElMessage.success(`已生成 ${batchResults.value.length} 个变体`)
  } catch (error) {
    if (isAbortError(error)) {
      ElMessage.info(
        batchDone.value ? `已中止（已完成 ${batchDone.value}/${n}）` : '已中止生成'
      )
    } else {
      console.error('[爆品概念批量]', error)
      ElMessage.error(`批量生成失败：${error.message || '未知错误'}`)
    }
  } finally {
    isGenerating.value = false
    abortController = null
    batchTotal.value = 1
  }
}

const regenerateSameFilters = () => {
  if (generatedConcept.value?.options) {
    applyOptionsSnapshot(generatedConcept.value.options)
  }
  generateProductConcept()
}

const regenerateFromHistory = (item) => {
  loadConcept(item)
  regenerateSameFilters()
}

const generateVariant = () => {
  if (!generatedConcept.value) return
  if (generatedConcept.value.options) {
    applyOptionsSnapshot({
      ...generatedConcept.value.options,
      notes:
        generatorOptions.value.notes ||
        `基于「${generatedConcept.value.name}」做差异化变体`
    })
  }
  generateProductConcept({ variantOf: generatedConcept.value })
}

const generateVariantFrom = (item) => {
  loadConcept(item)
  generateVariant()
}

const loadConcept = (concept) => {
  if (!concept) return
  resetImageSession()
  generatedConcept.value = { ...concept }
  if (concept.options) applyOptionsSnapshot(concept.options)
  if (!batchResults.value.some((c) => c.id === concept.id)) {
    batchResults.value = [concept]
  }
}

const toggleCurrentFavorite = () => {
  if (!generatedConcept.value?.id) return
  conceptHistory.value = toggleFavorite(generatedConcept.value.id, conceptHistory.value)
  const updated = conceptHistory.value.find((c) => c.id === generatedConcept.value.id)
  if (updated) generatedConcept.value = { ...updated }
}

const toggleFavoriteById = (id) => {
  conceptHistory.value = toggleFavorite(id, conceptHistory.value)
  if (generatedConcept.value?.id === id) {
    const updated = conceptHistory.value.find((c) => c.id === id)
    if (updated) generatedConcept.value = { ...updated }
  }
}

const deleteConcept = async (id) => {
  try {
    await ElMessageBox.confirm('确定删除该概念？此操作不可恢复。', '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  conceptHistory.value = removeConcept(id, conceptHistory.value)
  selectedIds.value = selectedIds.value.filter((x) => x !== id)
  batchResults.value = batchResults.value.filter((c) => c.id !== id)
  if (generatedConcept.value?.id === id) {
    generatedConcept.value = batchResults.value[0] || null
  }
  ElMessage.success('已删除')
}

const copyConcept = async () => {
  if (!generatedConcept.value) return
  const text = conceptToMarkdown(generatedConcept.value)
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.warning('复制失败，请手动导出')
  }
}

const onExportCurrent = (cmd) => {
  if (!generatedConcept.value) return
  const c = generatedConcept.value
  const safe = String(c.name || 'concept').replace(/[\\/:*?"<>|]/g, '_')
  if (cmd === 'json') {
    downloadTextFile(JSON.stringify(c, null, 2), `${safe}_概念.json`)
  } else {
    downloadTextFile(conceptToMarkdown(c), `${safe}_概念.md`)
  }
  ElMessage.success('已导出')
}

const toggleSelect = (id) => {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((x) => x !== id)
  } else {
    selectedIds.value = [...selectedIds.value, id]
  }
}

const selectAllFiltered = () => {
  const ids = filteredHistory.value.map((c) => c.id)
  if (allFilteredSelected.value) {
    selectedIds.value = selectedIds.value.filter((id) => !ids.includes(id))
  } else {
    selectedIds.value = Array.from(new Set([...selectedIds.value, ...ids]))
  }
}

const exportBatch = (fmt) => {
  const items = conceptHistory.value.filter((c) => selectedIds.value.includes(c.id))
  if (!items.length) {
    ElMessage.warning('请先勾选要导出的概念')
    return
  }
  const stamp = new Date().toISOString().slice(0, 10)
  if (fmt === 'json') {
    downloadTextFile(JSON.stringify(items, null, 2), `爆品概念批量_${stamp}.json`)
  } else {
    const md = items.map(conceptToMarkdown).join('\n\n---\n\n')
    downloadTextFile(md, `爆品概念批量_${stamp}.md`)
  }
  ElMessage.success(`已导出 ${items.length} 条`)
}

const bringToStrategy = () => {
  if (!generatedConcept.value) return
  markForStrategyBoard(generatedConcept.value)
  ElMessage.success('已标记，正在打开战略看板')
  goStrategy()
}

onMounted(() => {
  conceptHistory.value = loadConcepts()
})

onBeforeUnmount(() => {
  abortGeneration()
  if (imageAbortController) imageAbortController.abort()
  resetImageSession()
  revokeConceptImageUrls({ displayUrl: liveImageUrl.value })
})
</script>

<style scoped>
.pcg-root {
  --pcg-green: #2d6a4f;
  --pcg-green-soft: rgba(45, 106, 79, 0.08);
  --pcg-gold: #c4a55a;
  --pcg-gold-soft: rgba(196, 165, 90, 0.12);
  --pcg-border: rgba(45, 106, 79, 0.14);
  --pcg-text: #1a2e24;
  --pcg-muted: #5c6b63;
  --pcg-bg: linear-gradient(165deg, #f4f7f5 0%, #eef3f0 45%, #f7f5ef 100%);
  min-height: calc(100vh - 88px);
  padding: 20px 24px 40px;
  background: var(--pcg-bg);
  color: var(--pcg-text);
}

.pcg-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
  margin-bottom: 20px;
  padding: 22px 24px;
  border-radius: 16px;
  border: 1px solid var(--pcg-border);
  background:
    radial-gradient(ellipse at 0% 0%, var(--pcg-green-soft), transparent 55%),
    radial-gradient(ellipse at 100% 0%, var(--pcg-gold-soft), transparent 50%),
    #fff;
}

.pcg-eyebrow {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--pcg-green);
  font-weight: 700;
}

.pcg-title {
  margin: 0 0 8px;
  font-size: clamp(22px, 2.4vw, 30px);
  font-weight: 800;
  color: var(--pcg-text);
}

.pcg-lead {
  margin: 0;
  max-width: 42rem;
  font-size: 14px;
  line-height: 1.65;
  color: var(--pcg-muted);
}

.pcg-hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}

.pcg-workspace {
  display: grid;
  grid-template-columns: minmax(320px, 460px) 1fr;
  gap: 16px;
  margin-bottom: 16px;
  align-items: start;
}

.pcg-panel {
  background: #fff;
  border: 1px solid var(--pcg-border);
  border-radius: 14px;
  padding: 18px 18px 20px;
  box-shadow: 0 4px 18px rgba(26, 46, 36, 0.04);
}

.pcg-input {
  max-height: calc(100vh - 160px);
  overflow-y: auto;
}

.pcg-panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(45, 106, 79, 0.1);
}

.pcg-panel-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.pcg-panel-hint {
  font-size: 12px;
  color: var(--pcg-muted);
}

.pcg-type-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}

.pcg-type-btn {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto auto;
  column-gap: 10px;
  row-gap: 2px;
  text-align: left;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1.5px solid #e2e8e4;
  background: #fafcfb;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
}

.pcg-type-btn:hover {
  border-color: var(--pcg-green);
}

.pcg-type-btn.active {
  border-color: var(--pcg-green);
  background: var(--pcg-green-soft);
  box-shadow: inset 0 0 0 1px rgba(45, 106, 79, 0.15);
}

.pcg-type-icon {
  grid-row: 1 / span 3;
  font-size: 24px;
  align-self: center;
}

.pcg-type-name {
  font-weight: 700;
  font-size: 14px;
}

.pcg-type-desc,
.pcg-type-meta {
  font-size: 11px;
  color: var(--pcg-muted);
  line-height: 1.35;
}

.pcg-filters {
  margin-bottom: 4px;
}

.pcg-form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.pcg-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.pcg-form-row .pcg-field {
  margin-bottom: 0;
}

.pcg-field label,
.pcg-examples-label,
.pcg-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--pcg-muted);
  letter-spacing: 0.02em;
}

.pcg-examples {
  margin-bottom: 16px;
}

.pcg-example-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.pcg-chip {
  border: 1px solid var(--pcg-border);
  background: #fff;
  color: var(--pcg-green);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.pcg-chip:hover {
  background: var(--pcg-green-soft);
  border-color: var(--pcg-green);
}

.pcg-gen-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.pcg-batch-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--pcg-muted);
}

.pcg-loading,
.pcg-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 8px;
  min-height: 280px;
  padding: 24px;
  color: var(--pcg-muted);
  background: var(--pcg-green-soft);
  border-radius: 12px;
}

.pcg-empty.compact {
  min-height: 80px;
  background: #f7faf8;
}

.pcg-empty strong {
  color: var(--pcg-text);
  font-size: 16px;
}

.pcg-spin {
  font-size: 28px;
  color: var(--pcg-green);
  animation: pcg-spin 1s linear infinite;
}

@keyframes pcg-spin {
  to {
    transform: rotate(360deg);
  }
}

.pcg-batch-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.pcg-batch-tab {
  border: 1px solid var(--pcg-border);
  background: #fafcfb;
  color: var(--pcg-text);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.pcg-batch-tab.active {
  border-color: var(--pcg-green);
  background: var(--pcg-green-soft);
  color: var(--pcg-green);
  font-weight: 700;
}

.pcg-concept-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pcg-concept-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  align-items: flex-start;
}

.pcg-concept-head h3 {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 800;
}

.pcg-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pcg-tag {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--pcg-green-soft);
  color: var(--pcg-green);
  font-weight: 600;
}

.pcg-tag.gold {
  background: var(--pcg-gold-soft);
  color: #8a6d2f;
}

.pcg-tag.soft {
  background: #f0f4f1;
  color: var(--pcg-muted);
  font-weight: 500;
}

.pcg-tag.fav {
  background: #fff4e5;
  color: #b45309;
}

.pcg-concept-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pcg-fields-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.pcg-field-block {
  padding: 12px 14px;
  border-radius: 10px;
  background: #f7faf8;
  border-left: 3px solid var(--pcg-green);
}

.pcg-field-block.span-2 {
  grid-column: span 2;
}

.pcg-field-block p {
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 1.65;
  color: var(--pcg-text);
}

.pcg-price {
  color: var(--pcg-green) !important;
  font-weight: 700;
  font-size: 16px !important;
}

.pcg-list {
  margin: 6px 0 0;
  padding: 0 0 0 18px;
  font-size: 14px;
  line-height: 1.6;
}

.pcg-list.warn {
  color: #9a3412;
}

.pcg-image-section {
  margin-top: 4px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--pcg-border);
  background:
    radial-gradient(ellipse at 0% 0%, var(--pcg-gold-soft), transparent 55%),
    #fafcfb;
}

.pcg-image-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.pcg-image-head h4 {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 700;
  color: var(--pcg-text);
}

.pcg-image-hint,
.pcg-image-config-hint,
.pcg-dialog-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--pcg-muted);
}

.pcg-image-config-hint {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--pcg-green-soft);
}

.pcg-image-config-hint code {
  font-size: 11px;
  color: var(--pcg-green);
}

.pcg-image-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pcg-image-loading,
.pcg-image-empty,
.pcg-image-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 160px;
  padding: 20px;
  border-radius: 10px;
  background: #fff;
  border: 1px dashed rgba(45, 106, 79, 0.2);
  text-align: center;
  color: var(--pcg-muted);
  font-size: 13px;
}

.pcg-image-error {
  border-color: rgba(185, 28, 28, 0.25);
  background: #fef2f2;
}

.pcg-image-error strong {
  color: #991b1b;
}

.pcg-image-error p {
  margin: 0;
  font-size: 12px;
  color: #7f1d1d;
  max-width: 36rem;
}

.pcg-image-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pcg-image-preview img {
  width: 100%;
  max-height: 420px;
  object-fit: contain;
  border-radius: 10px;
  border: 1px solid var(--pcg-border);
  background: #fff;
  box-shadow: 0 8px 24px rgba(26, 46, 36, 0.08);
}

.pcg-image-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  font-size: 12px;
  color: var(--pcg-muted);
}

.pcg-history-head {
  flex-wrap: wrap;
}

.pcg-history-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.pcg-history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.pcg-history-card {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: 1fr auto;
  gap: 4px 8px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid #e5ebe7;
  background: #fafcfb;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.pcg-history-card:hover,
.pcg-history-card.active {
  border-color: var(--pcg-green);
  box-shadow: 0 4px 14px rgba(45, 106, 79, 0.1);
}

.pcg-history-card.selected {
  background: var(--pcg-green-soft);
}

.pcg-check {
  grid-row: 1 / span 2;
  padding-top: 4px;
}

.pcg-history-main {
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  padding: 0;
  color: inherit;
}

.pcg-history-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.pcg-star {
  color: var(--pcg-gold);
}

.pcg-history-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--pcg-muted);
  margin-bottom: 6px;
}

.pcg-history-snippet {
  margin: 0;
  font-size: 12px;
  color: var(--pcg-muted);
  line-height: 1.5;
}

.pcg-history-ops {
  grid-column: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

@media (min-width: 1200px) {
  .pcg-type-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 960px) {
  .pcg-root {
    padding: 12px 12px 28px;
  }

  .pcg-hero {
    flex-direction: column;
    align-items: stretch;
  }

  .pcg-workspace {
    grid-template-columns: 1fr;
  }

  .pcg-input {
    max-height: none;
  }

  .pcg-type-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .pcg-form-row,
  .pcg-fields-grid {
    grid-template-columns: 1fr;
  }

  .pcg-field-block.span-2 {
    grid-column: span 1;
  }
}

@media (max-width: 520px) {
  .pcg-type-grid {
    grid-template-columns: 1fr;
  }
}
</style>
