<template>
  <div class="fulfillment-center">
    <el-tabs v-model="active" class="fc-tabs" @tab-change="onTab">
      <el-tab-pane name="orders">
        <template #label>
          订货单
          <el-badge v-if="counts.submitted" :value="counts.submitted" class="tab-badge" />
        </template>
        <PurchaseOrders ref="ordersRef" @shipped="onShipped" @changed="onCounts" />
      </el-tab-pane>
      <el-tab-pane name="intents">
        <template #label>意向线索</template>
        <PurchaseIntents ref="intentsRef" @converted="onConverted" />
      </el-tab-pane>
      <el-tab-pane name="shipments">
        <template #label>出货单</template>
        <FulfillmentShipments ref="shipmentsRef" />
      </el-tab-pane>
      <el-tab-pane name="stock">
        <template #label>库存流水</template>
        <FulfillmentStock ref="stockRef" />
      </el-tab-pane>
      <el-tab-pane name="feishu">
        <template #label>飞书对接</template>
        <FeishuBridge ref="feishuRef" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import PurchaseOrders from './PurchaseOrders.vue'
import PurchaseIntents from './PurchaseIntents.vue'
import FulfillmentShipments from './FulfillmentShipments.vue'
import FulfillmentStock from './FulfillmentStock.vue'
import FeishuBridge from './FeishuBridge.vue'

const active = ref('orders')
const ordersRef = ref(null)
const intentsRef = ref(null)
const shipmentsRef = ref(null)
const stockRef = ref(null)
const feishuRef = ref(null)
const counts = ref({ submitted: 0, toShip: 0, shipped: 0 })

const onTab = (name) => {
  if (name === 'orders') ordersRef.value?.refresh?.()
  if (name === 'intents') intentsRef.value?.refresh?.()
  if (name === 'shipments') shipmentsRef.value?.refresh?.()
  if (name === 'stock') stockRef.value?.refresh?.()
  if (name === 'feishu') feishuRef.value?.refresh?.()
}

const onConverted = () => {
  active.value = 'orders'
  ordersRef.value?.applyFilter?.('submitted')
  ordersRef.value?.refresh?.()
}

const onShipped = () => {
  active.value = 'shipments'
  shipmentsRef.value?.refresh?.()
  stockRef.value?.refresh?.()
}

const onCounts = (s) => {
  if (s) counts.value = s
}
</script>

<style scoped>
.fulfillment-center { min-height: 420px; }
.fc-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.tab-badge { margin-left: 6px; }
.tab-badge :deep(.el-badge__content) { position: static; transform: none; }
</style>
