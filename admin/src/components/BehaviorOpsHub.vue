<template>
  <ModuleHub
    hub-id="44"
    title="行为洞察"
    subtitle="C 端事件看板 · 埋点规则配置"
    :tabs="tabs"
    :initial-section="initialSection"
  />
</template>

<script setup>
import ModuleHub from './ModuleHub.vue'
import BehaviorAnalytics from './BehaviorAnalytics.vue'
import UserBehaviorConfig from './UserBehaviorConfig.vue'

defineProps({
  initialSection: { type: String, default: 'analytics' }
})

const tabs = [
  { name: 'analytics', label: '行为看板', comp: BehaviorAnalytics },
  { name: 'config', label: '追踪配置', comp: UserBehaviorConfig }
]
</script>
