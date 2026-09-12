<template>
  <div
    ref="rootRef"
    class="admin-nav-hub"
    tabindex="-1"
    @keydown="onHubKeydown"
  >
    <header class="hub-hero">
      <p class="hub-overline">{{ domain.overline }}</p>
      <h1 class="hub-title">{{ domain.title }}</h1>
      <p class="hub-sub">{{ domain.subtitle }}</p>
      <div class="hub-toolbar">
        <el-input
          ref="searchRef"
          v-model="query"
          clearable
          class="hub-search"
          placeholder="搜索本域功能（/ 聚焦，Esc 清空）"
          :prefix-icon="Search"
          @keydown.down.prevent="focusEntry(0)"
          @keydown.enter.prevent="openFirstMatch"
        />
        <span class="hub-count">
          <template v-if="query.trim()">匹配 {{ entryCount }} / {{ totalCount }}</template>
          <template v-else>{{ entryCount }} 个入口</template>
        </span>
      </div>
    </header>

    <div v-if="!baseSections.length" class="hub-empty">
      <p class="empty-title">本域暂无可用功能</p>
      <p class="empty-hint">可能因权限过滤或模块未注册。可从命令面板 ⌘K 搜索其它入口。</p>
    </div>

    <div v-else-if="!visibleSections.length" class="hub-empty">
      <p class="empty-title">未找到「{{ query.trim() }}」</p>
      <p class="empty-hint">试试更短的关键词，或清空后浏览全部分区。</p>
      <el-button type="primary" plain @click="clearSearch">清空搜索</el-button>
    </div>

    <section
      v-for="(section, sIdx) in visibleSections"
      :key="section.key"
      class="hub-section"
    >
      <div class="section-head">
        <span v-if="section.overline" class="section-overline">{{ section.overline }}</span>
        <h2 class="section-title">{{ section.title }}</h2>
        <span class="section-count">{{ section.entries.length }}</span>
      </div>
      <div class="entry-grid" role="list">
        <button
          v-for="(entry, eIdx) in section.entries"
          :key="entry.id"
          type="button"
          class="entry-card"
          role="listitem"
          :data-flat-index="flatIndex(sIdx, eIdx)"
          :aria-label="`${entry.title}：${entry.desc}`"
          @click="openEntry(entry)"
          @keydown.enter.prevent="openEntry(entry)"
          @keydown.space.prevent="openEntry(entry)"
        >
          <span class="entry-icon" aria-hidden="true">
            <el-icon :size="20"><component :is="resolveIcon(entry.icon || 'Menu')" /></el-icon>
          </span>
          <span class="entry-body">
            <span class="entry-title">{{ entry.title }}</span>
            <span class="entry-desc">{{ entry.desc }}</span>
          </span>
          <span class="entry-arrow" aria-hidden="true">
            <el-icon :size="14"><ArrowRight /></el-icon>
          </span>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import * as Icons from '@element-plus/icons-vue'
import { Search, ArrowRight } from '@element-plus/icons-vue'
import { filterDomainSections, getNavDomain, searchDomainEntries } from '../config/adminNavDomains'
import { MODULES_BY_ID } from '../utils/modulesRegistry'

const props = defineProps({
  domainId: { type: String, required: true },
  /** 可选：权限可见模块 id 列表；null 表示全部已注册模块 */
  visibleIds: { type: Array, default: null },
})

const emit = defineEmits(['open-module'])

const query = ref('')
const rootRef = ref(null)
const searchRef = ref(null)
const focusedFlat = ref(-1)

const domain = computed(() => getNavDomain(props.domainId) || {
  id: props.domainId,
  title: '导航',
  overline: 'NAV',
  subtitle: '',
  sections: [],
})

const baseSections = computed(() =>
  filterDomainSections(domain.value, props.visibleIds)
)

const visibleSections = computed(() =>
  searchDomainEntries(domain.value, query.value, props.visibleIds)
)

const flatEntries = computed(() =>
  visibleSections.value.flatMap((s) => s.entries)
)

const entryCount = computed(() => flatEntries.value.length)
const totalCount = computed(() =>
  baseSections.value.reduce((n, s) => n + s.entries.length, 0)
)

const resolveIcon = (name) => Icons[name] || Icons.Menu

const flatIndex = (sIdx, eIdx) => {
  let n = 0
  for (let i = 0; i < sIdx; i++) n += visibleSections.value[i].entries.length
  return n + eIdx
}

const openEntry = (entry) => {
  if (!entry || !MODULES_BY_ID[entry.id]) return
  emit('open-module', { id: entry.id, domainId: props.domainId })
}

const clearSearch = () => {
  query.value = ''
  focusedFlat.value = -1
  nextTick(() => searchRef.value?.focus?.())
}

const openFirstMatch = () => {
  const first = flatEntries.value[0]
  if (first) openEntry(first)
}

const focusEntry = (index) => {
  const list = flatEntries.value
  if (!list.length) return
  const i = Math.max(0, Math.min(index, list.length - 1))
  focusedFlat.value = i
  nextTick(() => {
    const el = rootRef.value?.querySelector(`[data-flat-index="${i}"]`)
    el?.focus?.()
  })
}

const onHubKeydown = (e) => {
  const tag = (e.target && e.target.tagName) || ''
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA'

  if (e.key === '/' && !inInput && !e.metaKey && !e.ctrlKey) {
    e.preventDefault()
    searchRef.value?.focus?.()
    return
  }
  if (e.key === 'Escape') {
    if (query.value) {
      e.preventDefault()
      clearSearch()
    }
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (inInput) focusEntry(0)
    else focusEntry(focusedFlat.value < 0 ? 0 : focusedFlat.value + 1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (inInput) return
    focusEntry(focusedFlat.value <= 0 ? 0 : focusedFlat.value - 1)
    return
  }
  if (e.key === 'Enter' && !inInput && focusedFlat.value >= 0) {
    const entry = flatEntries.value[focusedFlat.value]
    if (entry) {
      e.preventDefault()
      openEntry(entry)
    }
  }
}

watch(query, () => { focusedFlat.value = -1 })

onMounted(() => {
  // 大屏打开时不抢焦点（避免打断侧栏），但保证容器可接收快捷键
  rootRef.value?.focus?.({ preventScroll: true })
})
</script>

<style scoped>
.admin-nav-hub {
  min-height: 100%;
  padding: 12px 16px 56px;
  outline: none;
  background:
    radial-gradient(ellipse 70% 42% at 8% 0%, rgba(196, 167, 108, 0.1), transparent 58%),
    linear-gradient(180deg, #faf8f4 0%, #f2ede4 38%, #f2ede4 100%);
}

.hub-hero {
  max-width: 960px;
  margin: 0 auto 28px;
  padding: 24px 4px 0;
}

.hub-overline {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #8a7530;
}

.hub-title {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: #33302c;
  letter-spacing: 0.02em;
}

.hub-sub {
  margin: 10px 0 0;
  max-width: 36em;
  font-size: 14px;
  line-height: 1.55;
  color: #6b6560;
}

.hub-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 22px;
  flex-wrap: wrap;
}

.hub-search {
  width: min(400px, 100%);
}

.hub-search :deep(.el-input__wrapper) {
  background: #fff;
  box-shadow: 0 1px 2px rgba(26, 24, 20, 0.05);
  border-radius: 8px;
  border: 1px solid #e8e5de;
}

.hub-search :deep(.el-input__wrapper.is-focus) {
  border-color: #c4a76c;
  box-shadow: 0 0 0 3px rgba(196, 167, 108, 0.18);
}

.hub-count {
  font-size: 12px;
  color: #a09a90;
  letter-spacing: 0.04em;
}

.hub-section {
  max-width: 960px;
  margin: 0 auto 40px;
  padding: 0 4px;
}

.section-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e8e5de;
}

.section-overline {
  width: 100%;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #a09a90;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  color: #33302c;
}

.section-count {
  font-size: 11px;
  color: #a09a90;
  font-variant-numeric: tabular-nums;
}

.entry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.entry-card {
  display: grid;
  grid-template-columns: 40px 1fr 18px;
  align-items: start;
  gap: 12px;
  min-height: 88px;
  padding: 16px 14px;
  text-align: left;
  background: #ffffff;
  border: 1px solid #e8e5de;
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  font: inherit;
  color: inherit;
}

.entry-card:hover {
  border-color: #d4bc85;
  background: #faf6ed;
  box-shadow: 0 2px 8px rgba(26, 24, 20, 0.06);
}

.entry-card:focus-visible {
  outline: 2px solid #2d5a3f;
  outline-offset: 2px;
  border-color: #2d5a3f;
  background: #fff;
}

.entry-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(45, 90, 63, 0.08);
  color: #2d5a3f;
}

.entry-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding-top: 2px;
}

.entry-title {
  font-size: 15px;
  font-weight: 500;
  color: #33302c;
  line-height: 1.3;
}

.entry-desc {
  font-size: 12px;
  line-height: 1.45;
  color: #6b6560;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.entry-arrow {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10px;
  color: #c4a76c;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.entry-card:hover .entry-arrow,
.entry-card:focus-visible .entry-arrow {
  opacity: 1;
}

.hub-empty {
  max-width: 960px;
  margin: 56px auto;
  padding: 32px 24px;
  text-align: center;
  background: #fff;
  border: 1px dashed #e8e5de;
  border-radius: 12px;
  color: #6b6560;
}

.empty-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 500;
  color: #33302c;
}

.empty-hint {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.5;
  color: #6b6560;
}

@media (max-width: 768px) {
  .admin-nav-hub {
    padding: 8px 12px 40px;
  }
  .hub-title {
    font-size: 22px;
  }
  .entry-grid {
    grid-template-columns: 1fr;
  }
}
</style>
