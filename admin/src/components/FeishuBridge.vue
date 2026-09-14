<template>
  <div class="fsc">
    <div class="fsc-header">
      <div class="title-box">
        <h2>飞书同步中心</h2>
        <span class="subtitle">
          看状态 → 映射（可自动）→ 一键同步 · 采购账目写入 <code>ops_purchases</code>
        </span>
      </div>
      <div class="header-actions">
        <el-button @click="openBase">打开飞书 Base</el-button>
        <el-button :icon="Refresh" circle :loading="booting" @click="bootstrap({ forceInspect: false })" />
      </div>
    </div>

    <!-- ① 连接状态 -->
    <el-card shadow="never" class="status-card">
      <div class="status-row">
        <div class="status-pill">
          <span class="pill-label">连接</span>
          <el-tag :type="configured ? 'success' : 'danger'" size="small" effect="plain">
            {{ configured ? '已配置' : '未配置' }}
          </el-tag>
        </div>
        <div class="status-pill">
          <span class="pill-label">采购映射</span>
          <el-tag :type="purchaseMapped ? 'success' : 'warning'" size="small" effect="plain">
            {{ purchaseMapped ? '已就绪' : '待探测' }}
          </el-tag>
        </div>
        <div class="status-pill">
          <span class="pill-label">上次采购同步</span>
          <span class="pill-value">{{ fmt(syncMeta.lastPullAt) }}</span>
        </div>
        <div class="status-pill wide">
          <span class="pill-label">摘要</span>
          <span class="pill-value">{{ syncMeta.lastPullMsg || statusHint || '—' }}</span>
        </div>
        <div class="status-cta" v-if="!configured">
          <el-alert type="warning" :closable="false" show-icon title="请配置 FEISHU_APP_ID / FEISHU_APP_SECRET（本地 admin/.env 或 Cloudflare Pages 环境变量，勿加 VITE_）" />
        </div>
      </div>
      <div class="steps">
        <div class="step" :class="{ done: configured, current: step === 1 }">1 看状态</div>
        <div class="step-sep" />
        <div class="step" :class="{ done: purchaseMapped, current: step === 2 }">2 映射</div>
        <div class="step-sep" />
        <div class="step" :class="{ done: !!syncMeta.lastPullAt && syncMeta.lastPullOk, current: step === 3 }">
          3 同步
        </div>
      </div>
    </el-card>

    <el-tabs v-model="mainTab" class="fsc-tabs">
      <!-- 采购 -->
      <el-tab-pane name="purchase" label="采购同步">
        <div class="pane-toolbar">
          <el-button
            type="primary"
            size="large"
            :loading="busy === 'pullPurchases'"
            :disabled="!configured"
            @click="syncPurchases"
          >
            一键同步采购表 → ops_purchases
          </el-button>
          <el-button
            v-if="syncMeta.lastPullOk === false"
            type="warning"
            :loading="busy === 'pullPurchases'"
            @click="syncPurchases"
          >
            失败重试
          </el-button>
          <el-button :loading="inspecting" :disabled="!configured" @click="inspectAndMap({ autoSave: true })">
            {{ purchaseMapped ? '重新探测映射' : '探测并自动映射' }}
          </el-button>
        </div>
        <p class="hint-line">
          将同时写入镜像 <code>feishu_purchases</code> 与账目库 <code>ops_purchases</code>（按
          <code>feishuRecordId</code> upsert）。映射可自动时会自动保存，无需二次确认。
        </p>

        <el-collapse v-model="purchaseMapOpen" class="map-collapse">
          <el-collapse-item title="字段映射（采购）" name="map">
            <div class="map-actions">
              <el-button size="small" type="primary" :loading="saving" @click="saveMapping">保存映射</el-button>
              <span v-if="autoMappedHint" class="auto-hint">{{ autoMappedHint }}</span>
            </div>
            <el-empty
              v-if="!tables.length && !purchaseMapped"
              description="点「探测并自动映射」；成功后会列出 Base 内数据表。"
              :image-size="64"
            />
            <el-form v-else label-position="top" size="small" class="map-form">
              <el-form-item label="飞书数据表">
                <el-select v-model="mapping.purchase.tableId" filterable placeholder="选择采购表" style="width: 100%">
                  <el-option v-for="t in tables" :key="t.tableId" :label="t.name" :value="t.tableId" />
                </el-select>
              </el-form-item>
              <el-row :gutter="12">
                <el-col v-for="f in purchaseFields" :key="f.key" :span="8">
                  <el-form-item :label="f.label">
                    <el-select
                      v-model="mapping.purchase.fields[f.key]"
                      filterable
                      clearable
                      allow-create
                      :placeholder="f.hint"
                      style="width: 100%"
                    >
                      <el-option
                        v-for="col in fieldsOf(mapping.purchase.tableId)"
                        :key="col.name"
                        :label="`${col.name} (${col.uiType || col.type})`"
                        :value="col.name"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>
            </el-form>
          </el-collapse-item>
        </el-collapse>

        <el-card shadow="never" class="block">
          <template #header>
            <div class="card-head">
              <span>最近同步日志</span>
              <el-button size="small" text @click="refreshMirrors">刷新</el-button>
            </div>
          </template>
          <el-table :data="logs" v-loading="loadingMirrors" stripe max-height="280" size="small">
            <template #empty><el-empty description="尚无同步记录" :image-size="48" /></template>
            <el-table-column label="时间" width="168">
              <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column prop="action" label="动作" width="140" />
            <el-table-column label="结果" width="80">
              <template #default="{ row }">
                <el-tag :type="row.ok ? 'success' : 'danger'" size="small">{{ row.ok ? '成功' : '失败' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="message" label="摘要" min-width="220" show-overflow-tooltip />
            <el-table-column label="" width="88" fixed="right">
              <template #default="{ row }">
                <el-button
                  v-if="!row.ok && retryable(row.action)"
                  link
                  type="warning"
                  size="small"
                  @click="retryAction(row.action)"
                >
                  重试
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card shadow="never" class="block">
          <template #header>采购镜像预览</template>
          <el-table :data="purchases" v-loading="loadingMirrors" stripe max-height="320" size="small">
            <template #empty>
              <el-empty description="尚未拉取。映射就绪后点「一键同步采购表」。" :image-size="48" />
            </template>
            <el-table-column prop="orderNo" label="单号" width="140" show-overflow-tooltip />
            <el-table-column prop="skuName" label="物料" min-width="140" show-overflow-tooltip />
            <el-table-column prop="qty" label="数量" width="80" />
            <el-table-column prop="supplier" label="供应商" width="120" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="100" />
            <el-table-column prop="date" label="日期" width="120" />
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 库存 -->
      <el-tab-pane name="inventory" label="库存">
        <div class="pane-toolbar">
          <el-button :loading="busy === 'pullInventory'" :disabled="!configured" @click="run('pullInventory')">
            拉取库存镜像
          </el-button>
          <el-button
            type="warning"
            :loading="busy === 'applyInventory'"
            :disabled="!configured"
            @click="confirmApply"
          >
            应用为 HQ 库存
          </el-button>
          <el-button size="small" @click="mainTab = 'mapping'">编辑库存映射</el-button>
        </div>
        <p class="hint-line">
          拉取只更新镜像；「应用为 HQ 库存」才会改 <code>products.stock</code>（唯一需确认的危险操作）。
        </p>
        <el-row :gutter="12" class="stat-row">
          <el-col :span="8">
            <el-card shadow="never" class="stat">
              <div class="stat-num">{{ inventory.length }}</div>
              <div class="stat-label">成品库存镜像</div>
            </el-card>
          </el-col>
          <el-col :span="8">
            <el-card shadow="never" class="stat">
              <div class="stat-num">{{ matchedCount }}</div>
              <div class="stat-label">已映射藏品 SKU</div>
            </el-card>
          </el-col>
          <el-col :span="8">
            <el-button type="primary" :loading="busy === 'pullInventory'" :disabled="!configured" @click="run('pullInventory')">
              同步成品库存
            </el-button>
            <el-button :loading="busy === 'pullRawInventory'" :disabled="!configured" @click="run('pullRawInventory')" style="margin-left: 8px">
              同步原材料库存
            </el-button>
          </el-col>
        </el-row>
        <el-table :data="inventory" v-loading="loadingMirrors" stripe max-height="420" size="small">
          <template #empty><el-empty description="尚未拉取库存。" :image-size="48" /></template>
          <el-table-column prop="skuName" label="品名" min-width="140" show-overflow-tooltip />
          <el-table-column prop="skuId" label="SKU" width="120" show-overflow-tooltip />
          <el-table-column prop="qty" label="飞书数量" width="100" />
          <el-table-column prop="unit" label="单位" width="80" />
          <el-table-column label="映射藏品" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.productId" size="small" type="success">已映射</el-tag>
              <el-tag v-else size="small" type="info">未映射</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 出货：ops_shipments SSOT -->
      <el-tab-pane name="shipment" label="出货同步">
        <div class="pane-toolbar">
          <el-button
            type="primary"
            :loading="busy === 'pullShipments'"
            :disabled="!configured"
            @click="run('pullShipments')"
          >
            从飞书拉取 → ops_shipments
          </el-button>
          <el-button
            type="success"
            :loading="busy === 'pushShipments'"
            :disabled="!configured"
            @click="run('pushShipments')"
          >
            回写 ops_shipments → 飞书
          </el-button>
          <el-button size="small" @click="mainTab = 'mapping'">编辑出货映射</el-button>
        </div>
        <p class="hint-line">
          SSOT 为 <code>ops_shipments</code>：小程序超管/店长主录入，ERP 本处负责飞书双向同步与核对；订货履约
          <code>fulfillment_shipments</code> 仍走「订货履约」模块，不写入此表。
        </p>
      </el-tab-pane>

      <!-- 全量映射 -->
      <el-tab-pane name="mapping" label="映射设置">
        <div class="pane-toolbar">
          <el-button :loading="inspecting" type="primary" :disabled="!configured" @click="inspectAndMap({ autoSave: true })">
            探测表结构并自动映射
          </el-button>
          <el-button :loading="saving" @click="saveMapping">保存全部映射</el-button>
        </div>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 12px"
          title="开通：飞书应用 bitable:app → Base「添加文档应用」→ 配置密钥。探测成功后默认列名会自动猜测并保存。"
        />
        <el-empty v-if="!tables.length" description="先点「探测表结构」。" :image-size="64" />
        <el-row v-else :gutter="16">
          <el-col v-for="role in roles" :key="role.key" :span="8">
            <div class="role-title">{{ role.label }}</div>
            <el-form label-position="top" size="small">
              <el-form-item label="飞书数据表">
                <el-select v-model="mapping[role.key].tableId" placeholder="选择数据表" filterable style="width: 100%">
                  <el-option v-for="t in tables" :key="t.tableId" :label="t.name" :value="t.tableId" />
                </el-select>
              </el-form-item>
              <el-form-item v-for="f in role.fields" :key="f.key" :label="f.label">
                <el-select
                  v-model="mapping[role.key].fields[f.key]"
                  :placeholder="`飞书列 · ${f.hint}`"
                  filterable
                  clearable
                  allow-create
                  style="width: 100%"
                >
                  <el-option
                    v-for="col in fieldsOf(mapping[role.key].tableId)"
                    :key="col.name"
                    :label="`${col.name} (${col.uiType || col.type})`"
                    :value="col.name"
                  />
                </el-select>
              </el-form-item>
            </el-form>
          </el-col>
        </el-row>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { callCloudFunction, fetchCollectionLimit, COLLECTIONS } from '../cloud'
import { feishuProxyStatus, runFeishuSync } from '../utils/feishuSync'

const PURCHASE_FN = 'managePurchaseOrder'

const purchaseFields = [
  { key: 'orderNo', label: '采购编号列', hint: '采购编号' },
  { key: 'skuName', label: '物品名称列', hint: '物品名称' },
  { key: 'qty', label: '数量列', hint: '数量' },
  { key: 'unitPrice', label: '单价列', hint: '单价' },
  { key: 'supplier', label: '供应商列', hint: '供应商' },
  { key: 'status', label: '状态列', hint: '状态' },
  { key: 'date', label: '采购日期列', hint: '采购日期' },
  { key: 'spec', label: '规格型号列', hint: '规格型号' },
  { key: 'category', label: '分类列', hint: '分类' },
  { key: 'budgetType', label: '预算类型列', hint: '预算类型' },
  { key: 'platform', label: '采购平台列', hint: '采购平台' },
  { key: 'platformOrderNo', label: '平台订单号列', hint: '平台订单号' },
  { key: 'note', label: '备注列', hint: '备注' },
]

const roles = [
  { key: 'purchase', label: '采购记录 → ops_purchases', fields: purchaseFields },
  {
    key: 'inventory',
    label: '成品库存 → studio_inventory（飞书「成品库存」）',
    fields: [
      { key: 'skuName', label: '物品名称列', hint: '物品名称' },
      { key: 'framingSpec', label: '规格装裱列', hint: '规格装裱' },
      { key: 'qty', label: '数量列', hint: '数量' },
      { key: 'date', label: '盘点日期列', hint: '盘点日期' },
      { key: 'note', label: '备注列', hint: '备注' },
    ],
  },
  {
    key: 'rawInventory',
    label: '原材料库存 → studio_raw_inventory（飞书「库存管理」）',
    fields: [
      { key: 'inventoryNo', label: '库存编号列', hint: '库存编号' },
      { key: 'skuName', label: '物品名称列', hint: '物品名称' },
      { key: 'spec', label: '规格型号列', hint: '规格型号' },
      { key: 'category', label: '分类列', hint: '分类' },
      { key: 'qty', label: '当前库存列', hint: '当前库存' },
      { key: 'minQty', label: '最低预警列', hint: '最低库存预警' },
      { key: 'unitPrice', label: '单价列', hint: '单价' },
      { key: 'inboundTotal', label: '累计入库列', hint: '累计入库' },
      { key: 'outboundTotal', label: '累计出库列', hint: '累计出库' },
      { key: 'locationText', label: '存放位置列', hint: '存放位置' },
      { key: 'note', label: '备注列', hint: '备注' },
    ],
  },
  {
    key: 'shipment',
    label: '出货表 → ops_shipments',
    fields: [
      { key: 'shipmentNo', label: '出货编号列', hint: '出货编号' },
      { key: 'storeName', label: '客户名称列', hint: '客户名称' },
      { key: 'itemName', label: '物品名称列', hint: '物品名称' },
      { key: 'spec', label: '规格型号列', hint: '规格型号' },
      { key: 'category', label: '分类列', hint: '分类' },
      { key: 'qty', label: '数量列', hint: '数量' },
      { key: 'unitPrice', label: '单价列', hint: '单价' },
      { key: 'status', label: '状态列', hint: '状态' },
      { key: 'date', label: '出货日期列', hint: '出货日期' },
      { key: 'expressCompany', label: '快递公司列', hint: '快递公司' },
      { key: 'trackingNo', label: '运单号列', hint: '运单号' },
      { key: 'note', label: '备注列', hint: '备注' },
    ],
  },
]

const emptyMapping = () => ({
  purchase: {
    tableId: 'tblMHhGXhpmGTiI5',
    fields: {
      orderNo: '采购编号',
      skuName: '物品名称',
      qty: '数量',
      unitPrice: '单价',
      supplier: '供应商',
      status: '状态',
      date: '采购日期',
      entityName: '归属',
      spec: '规格型号',
      category: '分类',
      budgetType: '预算类型',
      platform: '采购平台',
      platformOrderNo: '平台订单号',
      note: '备注',
    },
  },
  inventory: {
    tableId: 'tblh9wqtrQmZgRO5',
    fields: {
      skuName: '物品名称',
      framingSpec: '规格装裱',
      qty: '数量',
      date: '盘点日期',
      note: '备注',
    },
  },
  rawInventory: {
    tableId: 'tblekBh0CRPMa7ie',
    fields: {
      inventoryNo: '库存编号',
      skuName: '物品名称',
      spec: '规格型号',
      category: '分类',
      qty: '当前库存',
      minQty: '最低库存预警',
      unitPrice: '单价',
      inboundTotal: '累计入库',
      outboundTotal: '累计出库',
      locationText: '存放位置',
      note: '备注',
    },
  },
  shipment: {
    tableId: 'tbl2lCz8GX2MVDnO',
    fields: {
      shipmentNo: '出货编号',
      storeName: '客户名称',
      itemName: '物品名称',
      spec: '规格型号',
      category: '分类',
      qty: '数量',
      unitPrice: '单价',
      status: '状态',
      date: '出货日期',
      expressCompany: '快递公司',
      trackingNo: '运单号',
      note: '备注',
    },
  },
})

const mapping = reactive(emptyMapping())
const tables = ref([])
const inspecting = ref(false)
const saving = ref(false)
const busy = ref('')
const booting = ref(false)
const configured = ref(false)
const statusHint = ref('')
const autoMappedHint = ref('')
const purchases = ref([])
const inventory = ref([])
const logs = ref([])
const loadingMirrors = ref(false)
const mainTab = ref('purchase')
const purchaseMapOpen = ref([])
const syncMeta = reactive({
  lastPullAt: null,
  lastPullOk: null,
  lastPullMsg: '',
})

const purchaseMapped = computed(() => !!mapping.purchase.tableId)
const matchedCount = computed(() => inventory.value.filter((r) => r.productId).length)
const step = computed(() => {
  if (!configured.value) return 1
  if (!purchaseMapped.value) return 2
  return 3
})

/** 与 pull/save 共用的纯对象映射，避免 Vue Proxy / 读库不一致 */
const plainTables = () =>
  JSON.parse(
    JSON.stringify({
      purchase: {
        tableId: mapping.purchase.tableId || '',
        fields: { ...mapping.purchase.fields },
      },
      inventory: {
        tableId: mapping.inventory.tableId || '',
        fields: { ...mapping.inventory.fields },
      },
      rawInventory: {
        tableId: mapping.rawInventory?.tableId || '',
        fields: { ...(mapping.rawInventory?.fields || {}) },
      },
      shipment: {
        tableId: mapping.shipment.tableId || '',
        fields: { ...mapping.shipment.fields },
      },
    }),
  )

const fieldsOf = (tableId) => {
  const t = tables.value.find((x) => x.tableId === tableId)
  return t?.fields || []
}

const openBase = () => {
  window.open('https://hcni0smm11e2.feishu.cn/base/WCs2bnIHsaty7vsjcnaczu0Wnod', '_blank', 'noopener')
}

const fmt = (t) => {
  if (!t) return '—'
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}

const guessRole = (name = '') => {
  if (/成品库存|成品盘点/i.test(name)) return 'inventory'
  if (/原材料|原料库存|^库存管理$/i.test(name)) return 'rawInventory'
  if (/采购记录|^采购$|订货|purchase/i.test(name)) return 'purchase'
  if (/出货|发货|物流|shipment/i.test(name)) return 'shipment'
  if (/库存|盘点|inventory|stock/i.test(name)) return 'rawInventory'
  return null
}

const guessField = (roleKey, fieldKey, cols) => {
  const names = cols.map((c) => c.name)
  const hints = {
    orderNo: [/采购编号/, /单号/, /编号/, /NO/i],
    skuName: [/物品名称/, /品名/, /物料/, /名称/, /商品/],
    skuId: [/SKU/i, /货号/, /编码/, /库存编号/],
    inventoryNo: [/库存编号/, /编号/],
    qty: [/当前库存/, /数量/, /余量/, /^库存$/],
    unit: [/单位/],
    unitPrice: [/单价/, /价格/],
    supplier: [/供应商/, /厂家/],
    status: [/状态/, /审批状态/],
    date: [/盘点日期/, /出货日期/, /采购日期/, /日期/, /时间/],
    entityName: [/归属/, /门店/, /主体/, /店铺/],
    spec: [/规格型号/, /规格/, /型号/],
    framingSpec: [/规格装裱/, /装裱/],
    category: [/^分类$/],
    budgetType: [/预算类型/],
    platform: [/采购平台/, /平台/],
    platformOrderNo: [/平台订单号/, /订单号/],
    note: [/备注/, /说明/],
    storeName: [/客户名称/, /客户/, /门店/, /收货/],
    customerName: [/客户名称/, /客户/],
    shipmentNo: [/出货编号/, /出货单/, /单号/, /编号/],
    itemName: [/物品名称/, /品名/, /物料/, /名称/, /商品/],
    expressCompany: [/快递公司/, /物流/, /承运/],
    trackingNo: [/运单号/, /运单/, /快递单/, /物流单/],
    minQty: [/最低库存/, /预警/],
    inboundTotal: [/累计入库/, /入库/],
    outboundTotal: [/累计出库/, /出库/],
    locationText: [/存放位置/, /位置/, /库位/],
  }
  const patterns = hints[fieldKey] || []
  return names.find((n) => patterns.some((p) => p.test(n))) || mapping[roleKey]?.fields?.[fieldKey] || ''
}

const unwrap = (res) => {
  if (!res) throw new Error('无返回')
  if (res.success === false) throw new Error(res.msg || '同步失败')
  return res
}

const retryable = (action) =>
  ['pullPurchases', 'pullInventory', 'pullRawInventory', 'pullShipments', 'pushShipments', 'applyInventory', 'inspect', 'saveMapping'].includes(action)

const retryAction = async (action) => {
  if (action === 'inspect' || action === 'saveMapping') {
    await inspectAndMap({ autoSave: true })
    return
  }
  if (action === 'applyInventory') {
    await confirmApply()
    return
  }
  await run(action)
}

const applyGuesses = (list) => {
  let guessedRoles = 0
  for (const t of list) {
    const role = guessRole(t.name)
    if (!role || !mapping[role]) continue
    if (!mapping[role].tableId) {
      mapping[role].tableId = t.tableId
      const roleDef = roles.find((r) => r.key === role)
      for (const f of (roleDef && roleDef.fields) || []) {
        mapping[role].fields[f.key] = guessField(role, f.key, t.fields)
      }
      guessedRoles += 1
    }
  }
  return guessedRoles
}

const inspectAndMap = async (opts = {}) => {
  const autoSave = typeof opts === 'object' && opts && 'autoSave' in opts ? !!opts.autoSave : true
  inspecting.value = true
  autoMappedHint.value = ''
  try {
    const res = unwrap(await runFeishuSync('inspect'))
    tables.value = res.tables || []
    const guessed = applyGuesses(tables.value)
    if (autoSave && mapping.purchase.tableId) {
      await saveMapping({ silent: true })
      autoMappedHint.value =
        guessed > 0
          ? `已自动映射 ${guessed} 张表并保存，可直接同步。`
          : '已按现有猜测保存映射，可直接同步。'
      ElMessage.success(autoMappedHint.value)
    } else {
      ElMessage.success(`已探测 ${tables.value.length} 张表。请核对映射后保存。`)
      purchaseMapOpen.value = ['map']
      mainTab.value = 'mapping'
    }
  } catch (e) {
    statusHint.value = `探测失败：${e.message || e}`
    ElMessage.error(statusHint.value)
  } finally {
    inspecting.value = false
  }
}

const saveMapping = async (opts = {}) => {
  const silent = typeof opts === 'object' && opts && !(opts instanceof Event) ? !!opts.silent : false
  saving.value = true
  try {
    unwrap(await runFeishuSync('saveMapping', { mapping: { tables: plainTables() } }))
    if (!silent) ElMessage.success('映射已保存')
  } catch (e) {
    if (!silent) ElMessage.error(e.message || '保存失败')
    throw e
  } finally {
    saving.value = false
  }
}

const run = async (action) => {
  busy.value = action
  try {
    const res = unwrap(await runFeishuSync(action, { mapping: { tables: plainTables() } }))
    ElMessage.success(res.msg || '完成')
    await Promise.all([refreshMirrors(), loadSyncMeta()])
  } catch (e) {
    ElMessage.error(e.message || '同步失败')
    await refreshMirrors()
  } finally {
    busy.value = ''
  }
}

const syncPurchases = async () => {
  if (!purchaseMapped.value) {
    await inspectAndMap({ autoSave: true })
    if (!purchaseMapped.value) {
      ElMessage.warning('请先完成采购表映射')
      purchaseMapOpen.value = ['map']
      return
    }
  }
  await run('pullPurchases')
}

const confirmApply = async () => {
  try {
    await ElMessageBox.confirm(
      '将把已映射 SKU 的飞书数量写入 products.stock，并追加 feishu_pull 流水。未映射行不会改动。确认？',
      '应用为 HQ 库存',
      { type: 'warning', confirmButtonText: '应用', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  await run('applyInventory')
}

const refreshMirrors = async () => {
  loadingMirrors.value = true
  try {
    const [p, i, l] = await Promise.all([
      fetchCollectionLimit(COLLECTIONS.FEISHU_PURCHASES, { limit: 200 }).catch(() => []),
      fetchCollectionLimit(COLLECTIONS.FEISHU_INVENTORY, { limit: 200 }).catch(() => []),
      fetchCollectionLimit(COLLECTIONS.FEISHU_SYNC_LOGS, { limit: 40 }).catch(() => []),
    ])
    purchases.value = p || []
    inventory.value = i || []
    logs.value = (l || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  } finally {
    loadingMirrors.value = false
  }
}

const loadConfig = async () => {
  try {
    const res = await runFeishuSync('getConfig')
    if (res?.success && res.config?.tables) {
      for (const key of ['purchase', 'inventory', 'rawInventory', 'shipment']) {
        if (!mapping[key]) continue
        if (res.config.tables[key]) {
          mapping[key].tableId = res.config.tables[key].tableId || ''
          mapping[key].fields = { ...mapping[key].fields, ...(res.config.tables[key].fields || {}) }
        }
      }
    }
  } catch {
    /* 映射尚未保存 */
  }
}

const loadSyncMeta = async () => {
  try {
    const st = await callCloudFunction(PURCHASE_FN, { action: 'syncStatus' })
    if (st && st.success !== false) {
      syncMeta.lastPullAt = st.lastPullAt || null
      syncMeta.lastPullOk = st.lastPullOk
      syncMeta.lastPullMsg = st.lastPullMsg || ''
    }
  } catch {
    /* non-blocking */
  }
}

const bootstrap = async ({ forceInspect = false } = {}) => {
  booting.value = true
  try {
    await Promise.all([refreshMirrors(), loadConfig(), loadSyncMeta()])
    const st = await feishuProxyStatus()
    configured.value = !!st.configured
    if (!configured.value) {
      statusHint.value = st.msg || '请配置飞书密钥后重试。'
      return
    }
    statusHint.value = '飞书代理已就绪'
    if (forceInspect || !purchaseMapped.value) {
      try {
        await inspectAndMap({ autoSave: true })
      } catch {
        /* already messaged */
      }
    }
  } finally {
    booting.value = false
  }
}

onMounted(() => bootstrap({ forceInspect: false }))

defineExpose({ refresh: refreshMirrors, bootstrap })
</script>

<style scoped>
.fsc {
  padding: 4px 0 24px;
}
.fsc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.title-box h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #33302c;
}
.subtitle {
  color: #6b6560;
  font-size: 12px;
  line-height: 1.5;
}
.subtitle code {
  font-size: 11px;
  background: #faf6ed;
  padding: 1px 5px;
  border-radius: 4px;
}
.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.status-card {
  border: 1px solid #e8e5de;
  margin-bottom: 14px;
}
.status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  align-items: center;
  margin-bottom: 12px;
}
.status-pill {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 140px;
}
.status-pill.wide {
  flex: 1;
  min-width: 220px;
}
.pill-label {
  color: #6b6560;
  font-size: 12px;
}
.pill-value {
  color: #33302c;
  font-size: 13px;
}
.status-cta {
  width: 100%;
}
.steps {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 4px;
  border-top: 1px solid #e8e5de;
}
.step {
  font-size: 12px;
  color: #a09a90;
  padding: 4px 10px;
  border-radius: 4px;
  background: #f5f3f0;
}
.step.done {
  color: #2d5a3f;
  background: #e1f5ee;
}
.step.current {
  color: #8a7530;
  background: #faf6ed;
  font-weight: 600;
}
.step-sep {
  width: 16px;
  height: 1px;
  background: #d5d1c8;
}
.fsc-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}
.pane-toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 10px;
}
.hint-line {
  margin: 0 0 14px;
  font-size: 12px;
  color: #6b6560;
  line-height: 1.6;
}
.hint-line code {
  font-size: 11px;
  background: #faf6ed;
  padding: 1px 5px;
  border-radius: 4px;
}
.map-collapse {
  margin-bottom: 14px;
  border: 1px solid #e8e5de;
  border-radius: 8px;
  overflow: hidden;
}
.map-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}
.auto-hint {
  font-size: 12px;
  color: #2d5a3f;
}
.map-form {
  max-width: 960px;
}
.block {
  border: 1px solid #e8e5de;
  margin-bottom: 14px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.stat-row {
  margin-bottom: 12px;
}
.stat {
  text-align: center;
  border: 1px solid #e8e5de;
}
.stat-num {
  font-size: 22px;
  font-weight: 600;
  color: #c4a76c;
  font-family: 'JetBrains Mono', 'DM Mono', monospace;
}
.stat-label {
  font-size: 12px;
  color: #6b6560;
}
.role-title {
  font-weight: 600;
  margin-bottom: 8px;
  color: #33302c;
}
</style>
