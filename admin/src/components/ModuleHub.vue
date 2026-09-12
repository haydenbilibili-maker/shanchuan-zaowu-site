<template>
  <div class="module-hub">
    <div class="hub-header">
      <div class="title-box">
        <h2>{{ title }}</h2>
        <span v-if="subtitle" class="subtitle">{{ subtitle }}</span>
      </div>
    </div>
    <el-tabs v-model="active" class="hub-tabs" @tab-change="onTabChange">
      <el-tab-pane
        v-for="tab in tabs"
        :key="tab.name"
        :label="tab.label"
        :name="tab.name"
        lazy
      />
    </el-tabs>
    <div class="hub-body">
      <component :is="activeComp" :key="active" v-bind="activeProps" />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { hubSections, setHubSection } from '../utils/moduleAliases'

const props = defineProps({
  hubId: { type: String, required: true },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  tabs: { type: Array, required: true },
  initialSection: { type: String, default: '' }
})

const defaultSection = computed(() => props.tabs[0]?.name || '')

const resolveInitial = () => {
  const fromProp = props.initialSection
  if (fromProp && props.tabs.some((t) => t.name === fromProp)) return fromProp
  const fromStore = hubSections[props.hubId]
  if (fromStore && props.tabs.some((t) => t.name === fromStore)) return fromStore
  return defaultSection.value
}

const active = ref(resolveInitial())

watch(
  () => [props.initialSection, hubSections[props.hubId]],
  () => {
    const next = resolveInitial()
    if (next && next !== active.value) active.value = next
  }
)

const onTabChange = (name) => {
  setHubSection(props.hubId, name)
}

const activeTab = computed(() => props.tabs.find((t) => t.name === active.value) || props.tabs[0])
const activeComp = computed(() => activeTab.value?.comp)
const activeProps = computed(() => activeTab.value?.props || {})
</script>

<style scoped>
.module-hub {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 100%;
}
.hub-header {
  margin-bottom: 4px;
}
.title-box h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #33302c;
}
.subtitle {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: #6b6560;
  text-transform: uppercase;
}
.hub-tabs {
  margin-bottom: 12px;
}
.hub-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}
.hub-body {
  flex: 1;
  min-height: 0;
}
/* 子页自带大标题时略压缩顶距，避免双层标题过重 */
.hub-body :deep(> .module-wrapper > .module-header),
.hub-body :deep(> .panel-header),
.hub-body :deep(> .header-section),
.hub-body :deep(> .header),
.hub-body :deep(> .ba-container > .panel-header),
.hub-body :deep(> .ui-container > .panel-header),
.hub-body :deep(> .audience-container > .panel-header),
.hub-body :deep(> .storefront-container > .panel-header),
.hub-body :deep(> .member-level-adjust > .panel-header) {
  margin-top: 0;
}
</style>
