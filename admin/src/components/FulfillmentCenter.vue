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
        <template #label>飞书同步</template>
        <el-card shadow="never" class="feishu-link-card">
          <h3>飞书能力已迁至「飞书同步中心」</h3>
          <p>
            连接状态、字段映射、一键同步采购表、库存应用与出货回写，请统一在同步中心操作，避免两处维护。
          </p>
          <div class="feishu-link-actions">
            <el-button type="primary" @click="openFeishuCenter">打开飞书同步中心</el-button>
            <el-button @click="openPurchaseOps">采购管理（快捷同步）</el-button>
          </div>
        </el-card>
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
import { useTabsManager } from '../composables/useTabsManager'

const { openTab } = useTabsManager()
const active = ref('orders')
const ordersRef = ref(null)
const intentsRef = ref(null)
const shipmentsRef = ref(null)
const stockRef = ref(null)
const counts = ref({ submitted: 0, toShip: 0, shipped: 0 })

const openFeishuCenter = () => openTab('78')
const openPurchaseOps = () => openTab('76')

const onTab = (name) => {
  if (name === 'orders') ordersRef.value?.refresh?.()
  if (name === 'intents') intentsRef.value?.refresh?.()
  if (name === 'shipments') shipmentsRef.value?.refresh?.()
  if (name === 'stock') stockRef.value?.refresh?.()
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
.feishu-link-card {
  border: 1px solid #e8e5de;
  max-width: 640px;
  margin-top: 8px;
}
.feishu-link-card h3 {
  margin: 0 0 8px;
  font-size: 16px;
  color: #33302c;
  font-weight: 600;
}
.feishu-link-card p {
  margin: 0 0 16px;
  font-size: 13px;
  color: #6b6560;
  line-height: 1.6;
}
.feishu-link-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
