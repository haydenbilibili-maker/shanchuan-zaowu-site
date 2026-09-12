<template>
  <ModuleHub
    hub-id="26"
    title="监控大屏"
    subtitle="实时告警 · 经营看板"
    :tabs="tabs"
    :initial-section="initialSection"
  />
</template>

<script setup>
import ModuleHub from './ModuleHub.vue'
import RealtimeMonitor from './RealtimeMonitor.vue'

defineProps({
  initialSection: { type: String, default: 'live' }
})

const tabs = [
  { name: 'live', label: '实时监控 · 告警', comp: RealtimeMonitor, props: { variant: 'live' } },
  { name: 'business', label: '经营数据看板', comp: RealtimeMonitor, props: { variant: 'business' } }
]
</script>
