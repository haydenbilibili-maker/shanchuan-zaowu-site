<template>
  <ModuleHub
    hub-id="84"
    title="供应商运营总控"
    subtitle="总部运营 · 非供应商登录面 · 价目维护 / 履约 / 出货核对 / 工作室账单"
    :tabs="tabs"
    :initial-section="initialSection"
  />
</template>

<script setup>
/**
 * 供应商工作台相关 · Admin 运营总控旁路（可选）
 *
 * ⚠️ 本 Hub 给总部运营用，不是第三方供应商登录面。
 * 供应商可见面在小程序 `/subpackages/extra/supplier/`（禁止把本页子 Tab 理解成供应商能力）。
 * 蓝图：admin/docs/供应商工作台_Phase1_技术蓝图_2026-09-24.md
 */
import ModuleHub from './ModuleHub.vue'
import PriceListManager from './PriceListManager.vue'
import FulfillmentCenter from './FulfillmentCenter.vue'
import StoreShipments from './StoreShipments.vue'
import StudioBills from './StudioBills.vue'
import FranchiseManagement from './FranchiseManagement.vue'

defineProps({
  initialSection: { type: String, default: 'catalog' }
})

const tabs = [
  { name: 'catalog', label: '供货价目', comp: PriceListManager },
  { name: 'orders', label: '订货履约', comp: FulfillmentCenter },
  { name: 'ship', label: '出货单', comp: StoreShipments },
  { name: 'bills', label: '账单收款', comp: StudioBills },
  { name: 'partners', label: '加盟商', comp: FranchiseManagement }
]
</script>
