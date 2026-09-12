<template>
  <ModuleHub
    hub-id="30"
    title="门店中心"
    subtitle="ERP 档案 · C 端展区 · 设计 · 店员权限"
    :tabs="tabs"
    :initial-section="initialSection"
  />
</template>

<script setup>
import ModuleHub from './ModuleHub.vue'
import StoreManagement from './StoreManagement.vue'
import StoreFrontConfig from './StoreFrontConfig.vue'
import StoreDesignCenter from './StoreDesignCenter.vue'
import StoreStaffPermissions from './StoreStaffPermissions.vue'

defineProps({
  initialSection: { type: String, default: 'erp' }
})

const tabs = [
  { name: 'erp', label: 'ERP 店铺档案', comp: StoreManagement },
  { name: 'front', label: 'C 端门店展区', comp: StoreFrontConfig },
  { name: 'design', label: '门店设计中心', comp: StoreDesignCenter },
  { name: 'staff', label: '店员工作台权限', comp: StoreStaffPermissions }
]
</script>
