<template>
  <ModuleHub
    hub-id="4"
    title="会员经营"
    subtitle="CRM · 画像 · 人群 · 等级 · 荣誉馆长"
    :tabs="tabs"
    :initial-section="initialSection"
  />
</template>

<script setup>
import ModuleHub from './ModuleHub.vue'
import CRM from './CRM.vue'
import UserInsights from './UserInsights.vue'
import AudienceManager from './AudienceManager.vue'
import CohortCompare from './CohortCompare.vue'
import MemberLevelConfig from './MemberLevelConfig.vue'
import MemberLevelAdjust from './MemberLevelAdjust.vue'
import HonoraryCurators from './HonoraryCurators.vue'

defineProps({
  initialSection: { type: String, default: 'crm' }
})

const tabs = [
  { name: 'crm', label: '会员 CRM', comp: CRM },
  { name: 'insights', label: '用户画像', comp: UserInsights },
  { name: 'audience', label: '人群包', comp: AudienceManager },
  { name: 'cohort', label: '人群对比', comp: CohortCompare },
  { name: 'levels', label: '等级体系', comp: MemberLevelConfig },
  { name: 'adjust', label: '等级调整', comp: MemberLevelAdjust },
  { name: 'honorary', label: '荣誉馆长', comp: HonoraryCurators }
]
</script>
