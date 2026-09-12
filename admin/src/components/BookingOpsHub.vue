<template>
  <ModuleHub
    hub-id="37"
    title="预约中心"
    subtitle="预约核销 · 候补 · 预约规则"
    :tabs="tabs"
    :initial-section="initialSection"
  />
</template>

<script setup>
import ModuleHub from './ModuleHub.vue'
import Bookings from './Bookings.vue'
import BookingRulesConfig from './BookingRulesConfig.vue'

defineProps({
  initialSection: { type: String, default: 'ops' }
})

const tabs = [
  { name: 'ops', label: '预约与核销', comp: Bookings },
  { name: 'rules', label: '预约规则', comp: BookingRulesConfig }
]
</script>
