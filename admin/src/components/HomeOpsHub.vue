<template>
  <ModuleHub
    hub-id="13"
    title="首页运营"
    subtitle="轮播 · 模块布局 · 内容展示开关"
    :tabs="tabs"
    :initial-section="initialSection"
  />
</template>

<script setup>
import ModuleHub from './ModuleHub.vue'
import BannerManager from './BannerManager.vue'
import HomeConfigManager from './HomeConfigManager.vue'
import ContentDisplayFlags from './ContentDisplayFlags.vue'

defineProps({
  initialSection: { type: String, default: 'layout' }
})

const tabs = [
  { name: 'banner', label: '首页轮播', comp: BannerManager },
  { name: 'layout', label: '首页模块配置', comp: HomeConfigManager },
  { name: 'flags', label: '内容展示开关', comp: ContentDisplayFlags }
]
</script>
