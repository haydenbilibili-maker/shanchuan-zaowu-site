<template>
  <div class="po-container">
    <div class="stat-row">
      <button class="stat-card" :class="{ on: statusFilter === 'submitted' }" @click="quickFilter('submitted')">
        <div class="stat-num warn">{{ stats.submitted }}</div>
        <div class="stat-label">待确认</div>
      </button>
      <button class="stat-card" :class="{ on: statusFilter === 'toShip' }" @click="quickFilter('toShip')">
        <div class="stat-num">{{ stats.toShip }}</div>
        <div class="stat-label">待出货</div>
      </button>
      <button class="stat-card" :class="{ on: statusFilter === 'shipped' }" @click="quickFilter('shipped')">
        <div class="stat-num ok">{{ stats.shipped }}</div>
        <div class="stat-label">运输中</div>
      </button>
      <button class="stat-card" :class="{ on: paymentFilter === 'offline_pending' }" @click="quickPayFilter('offline_pending')">
        <div class="stat-num warn">{{ stats.offlinePending || 0 }}</div>
        <div class="stat-label">待对公</div>
      </button>
      <button class="stat-card" :class="{ on: statusFilter === 'all' && paymentFilter === 'all' }" @click="quickFilter('all')">
        <div class="stat-num">{{ stats.total }}</div>
        <div class="stat-label">全部订货单</div>
      </button>
      <div class="stat-card static">
        <div class="stat-num gold">¥{{ stats.monthAmount || 0 }}</div>
        <div class="stat-label">本月订货额</div>
      </div>
    </div>

    <div class="panel-header">
      <div class="title-box">
        <h2>订货单</h2>
        <span class="subtitle">确认 → 出货扣库 → 收货关闭 · 与店长端同一集合</span>
      </div>
      <div class="header-actions">
        <el-input
          v-model="keyword"
          size="small"
          clearable
          placeholder="单号 / 门店 / 联系人 / 电话"
          style="width: 220px"
          :prefix-icon="Search"
        />
        <el-select v-model="statusFilter" size="small" style="width: 120px">
          <el-option label="全部状态" value="all" />
          <el-option label="待确认" value="submitted" />
          <el-option label="待出货" value="toShip" />
          <el-option label="草稿" value="draft" />
          <el-option label="已确认" value="confirmed" />
          <el-option label="已发货" value="shipped" />
          <el-option label="已关闭" value="closed" />
          <el-option label="已取消" value="cancelled" />
        </el-select>
        <el-select v-model="buyerFilter" size="small" style="width: 110px">
          <el-option label="全部买方" value="all" />
          <el-option label="自营店" value="own_store" />
          <el-option label="渠道" value="channel" />
        </el-select>
        <el-select v-model="sourceFilter" size="small" style="width: 120px">
          <el-option label="全部来源" value="all" />
          <el-option label="店长" value="store_manager" />
          <el-option label="意向转单" value="price_list_convert" />
          <el-option label="采购商台" value="buyer_workbench" />
          <el-option label="Admin" value="admin" />
        </el-select>
        <el-select v-model="paymentFilter" size="small" style="width: 120px">
          <el-option label="全部支付" value="all" />
          <el-option label="待对公" value="offline_pending" />
          <el-option label="已支付" value="paid" />
          <el-option label="未支付" value="unpaid" />
        </el-select>
        <el-button size="small" :disabled="!selectedSubmitted.length" @click="batchConfirm">
          批量确认 ({{ selectedSubmitted.length }})
        </el-button>
        <el-button size="small" :icon="Download" :disabled="!filteredList.length" @click="exportCsv">导出</el-button>
        <el-button size="small" :loading="catalogPublishing" @click="publishCatalog">
          同步价目 ({{ catalogSource === 'configs' ? '云端' : '本地' }})
        </el-button>
        <el-button size="small" type="primary" @click="openCreate">新建订货单</el-button>
        <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
      </div>
    </div>

    <el-alert
      v-if="sourceHint"
      :title="sourceHint"
      type="warning"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
    />

    <el-card shadow="never">
      <el-table
        :data="filteredList"
        v-loading="loading"
        stripe
        @row-click="viewDetail"
        @selection-change="onSelect"
      >
        <template #empty>
          <ErpEmpty
            :description="emptyDesc"
            :hint="emptyHint"
          />
        </template>
        <el-table-column type="selection" width="42" :selectable="(row) => row.status === 'submitted'" />
        <el-table-column label="单号" width="150">
          <template #default="{ row }">
            <span class="t-main">{{ row.orderNo || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="160">
          <template #default="{ row }">{{ fmtTime(row.submittedAt || row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="买方" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="t-main">{{ row.storeName || row.company || '—' }}</div>
            <div class="t-sub">{{ buyerLabel(row.buyerType) }} · {{ row.contactName || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="件数" width="64" align="center">
          <template #default="{ row }">{{ skuCount(row.items) }}</template>
        </el-table-column>
        <el-table-column label="合计" width="100">
          <template #default="{ row }">
            <span v-if="row.totalAmount != null" class="amount">¥{{ row.totalAmount }}</span>
            <span v-else class="t-sub">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }">
            <el-tag :type="statusType(PO_STATUS, row.status)" effect="dark" size="small">
              {{ statusLabel(PO_STATUS, row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="支付" width="100">
          <template #default="{ row }">
            <el-tag
              v-if="row.paymentStatus"
              :type="statusType(PAYMENT_STATUS, row.paymentStatus)"
              size="small"
              effect="plain"
            >
              {{ statusLabel(PAYMENT_STATUS, row.paymentStatus) }}
            </el-tag>
            <span v-else class="t-sub">—</span>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="96">
          <template #default="{ row }">
            <span class="t-sub">{{ sourceLabel(row.source) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link @click.stop="viewDetail(row)">详情</el-button>
            <el-button
              v-if="row.status === 'submitted'"
              size="small"
              type="primary"
              @click.stop="confirmRow(row)"
            >确认</el-button>
            <el-button
              v-if="row.paymentStatus === 'offline_pending'"
              size="small"
              type="warning"
              @click.stop="confirmPayRow(row)"
            >确认到账</el-button>
            <el-button
              v-if="row.status === 'confirmed' || row.status === 'shipping'"
              size="small"
              type="success"
              @click.stop="openShip(row)"
            >出货</el-button>
            <el-button v-if="row.status === 'shipped'" size="small" @click.stop="receiveRow(row)">代收货</el-button>
            <el-button
              v-if="row.status === 'draft' || row.status === 'submitted'"
              size="small"
              type="info"
              link
              @click.stop="cancelRow(row)"
            >取消</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 详情 -->
    <el-drawer v-model="detailOpen" title="订货单详情" size="580px" destroy-on-close>
      <template v-if="current">
        <el-steps :active="stepIndex(current.status)" align-center finish-status="success" process-status="process" style="margin-bottom: 18px">
          <el-step title="提交" />
          <el-step title="确认" />
          <el-step title="出货" />
          <el-step title="收货" />
        </el-steps>

        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="单号">{{ current.orderNo }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(PO_STATUS, current.status)" size="small">{{ statusLabel(PO_STATUS, current.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="买方">{{ buyerLabel(current.buyerType) }} · {{ current.storeName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="门店 ID">{{ current.storeId || '—' }}</el-descriptions-item>
          <el-descriptions-item label="联系人">{{ current.contactName || '—' }} · {{ current.contactPhone || '—' }}</el-descriptions-item>
          <el-descriptions-item label="收货地址">{{ current.shipToAddress || '—' }}</el-descriptions-item>
          <el-descriptions-item label="客户备注">{{ current.note || '—' }}</el-descriptions-item>
          <el-descriptions-item label="内部备注">{{ current.adminNote || '—' }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ sourceLabel(current.source) }}</el-descriptions-item>
          <el-descriptions-item label="支付">
            <el-tag
              v-if="current.paymentStatus"
              :type="statusType(PAYMENT_STATUS, current.paymentStatus)"
              size="small"
            >{{ statusLabel(PAYMENT_STATUS, current.paymentStatus) }}</el-tag>
            <span v-else>—</span>
            <span v-if="current.paymentChannel" class="t-sub"> · {{ current.paymentChannel }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="节点">
            提交 {{ fmtTime(current.submittedAt) || '—' }}
            · 确认 {{ fmtTime(current.confirmedAt) || '—' }}
            · 发货 {{ fmtTime(current.shippedAt) || '—' }}
            · 收货 {{ fmtTime(current.receivedAt) || '—' }}
            · 支付 {{ fmtTime(current.paidAt) || '—' }}
          </el-descriptions-item>
        </el-descriptions>

        <div class="detail-items">
          <div class="seg">SKU 明细（{{ skuCount(current.items) }}）</div>
          <el-table :data="current.items || []" size="small" border>
            <el-table-column prop="name" label="品名" min-width="140" />
            <el-table-column prop="quantity" label="数量" width="70" />
            <el-table-column label="单价" width="90">
              <template #default="{ row }">
                {{ row.priceLabel || (row.unitPrice != null ? `¥${row.unitPrice}` : '—') }}
              </template>
            </el-table-column>
            <el-table-column label="档案" width="90">
              <template #default="{ row }">
                <el-tag v-if="row.productId" size="small" type="success">已绑定</el-tag>
                <el-tag v-else size="small" type="info">未绑</el-tag>
              </template>
            </el-table-column>
          </el-table>
          <p class="total-line" v-if="current.totalAmount != null">合计：¥{{ current.totalAmount }}</p>
        </div>

        <div class="detail-actions">
          <el-button @click="copyOrder(current)">复制明细</el-button>
          <el-button v-if="canEditMeta(current)" @click="openEditMeta(current)">改地址/备注</el-button>
          <el-button v-if="current.status === 'submitted'" type="primary" @click="confirmRow(current)">确认订货</el-button>
          <el-button
            v-if="current.paymentStatus === 'offline_pending'"
            type="warning"
            @click="confirmPayRow(current)"
          >确认对公到账</el-button>
          <el-button v-if="canReconcileWechat(current)" @click="reconcileRow(current)">微信查单补记</el-button>
          <el-button v-if="canRefundWechat(current)" type="danger" plain @click="refundRow(current)">微信退款</el-button>
          <el-button v-if="current.status === 'confirmed' || current.status === 'shipping'" type="success" @click="openShip(current)">出货</el-button>
          <el-button v-if="current.status === 'shipped'" @click="receiveRow(current)">代收货</el-button>
          <el-button v-if="current.status === 'draft' || current.status === 'submitted'" @click="cancelRow(current)">取消</el-button>
        </div>
      </template>
    </el-drawer>

    <!-- 出货 -->
    <el-dialog v-model="shipOpen" title="总部出货（扣 HQ 库存）" width="780px" destroy-on-close>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="每个 SKU 须绑定藏品档案。系统会按品名尝试自动匹配；库存不足将拦截发货。"
        style="margin-bottom: 12px"
      />
      <el-form label-width="96px" size="small">
        <el-form-item label="承运商">
          <el-select v-model="shipForm.carrier" filterable allow-create style="width: 240px">
            <el-option v-for="c in CARRIERS" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="物流单号">
          <el-input v-model="shipForm.trackingNumber" placeholder="至少 6 位" style="width: 280px" />
        </el-form-item>
      </el-form>
      <el-table :data="shipForm.items" size="small" border>
        <el-table-column prop="name" label="品名" min-width="130" />
        <el-table-column prop="quantity" label="数量" width="64" />
        <el-table-column label="HQ 库存" width="88">
          <template #default="{ row }">
            <span :class="{ 'stock-low': stockOf(row) < row.quantity }">{{ stockOf(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="商品档案" min-width="240">
          <template #default="{ row }">
            <el-select
              v-model="row.productId"
              filterable
              clearable
              placeholder="选择藏品"
              style="width: 100%"
            >
              <el-option
                v-for="p in productOptions"
                :key="p._id"
                :label="`${p.title || p.name} · 库存 ${productStock(p)}`"
                :value="p._id"
              />
            </el-select>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="shipOpen = false">取消</el-button>
        <el-button type="success" :loading="shipping" @click="confirmShip">确认发货并扣库</el-button>
      </template>
    </el-dialog>

    <!-- 新建 -->
    <el-dialog v-model="createOpen" title="新建订货单" width="760px" destroy-on-close top="6vh">
      <el-form label-width="96px" size="small">
        <el-form-item label="买方类型">
          <el-radio-group v-model="form.buyerType">
            <el-radio label="own_store">自营门店</el-radio>
            <el-radio label="channel">渠道</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.buyerType === 'own_store'" label="门店">
          <el-select
            v-model="form.storeId"
            filterable
            clearable
            placeholder="选择门店"
            style="width: 100%"
            @change="onStorePick"
          >
            <el-option
              v-for="s in stores"
              :key="s.storeId || s._id"
              :label="s.name || s.storeId"
              :value="s.storeId || s._id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="门店/公司">
          <el-input v-model="form.storeName" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="联系人"><el-input v-model="form.contactName" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="电话"><el-input v-model="form.contactPhone" /></el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="收货地址">
          <el-input v-model="form.shipToAddress" placeholder="门店或渠道收货地址" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="添加 SKU">
          <el-select
            filterable
            placeholder="从供货价目或藏品库添加"
            style="width: 100%"
            @change="addCatalogItem"
          >
            <el-option-group label="供货价目">
              <el-option
                v-for="c in B2B_CATALOG"
                :key="'c-' + c.skuId"
                :label="`${c.name} ${c.priceLabel}`"
                :value="'cat:' + c.skuId"
              />
            </el-option-group>
            <el-option-group label="藏品档案">
              <el-option
                v-for="p in productOptions"
                :key="'p-' + p._id"
                :label="`${p.title || p.name} · 库存 ${productStock(p)}`"
                :value="'prod:' + p._id"
              />
            </el-option-group>
          </el-select>
        </el-form-item>
      </el-form>
      <el-table :data="form.items" size="small" border>
        <el-table-column prop="name" label="品名" min-width="140" />
        <el-table-column label="数量" width="120">
          <template #default="{ row }">
            <el-input-number v-model="row.quantity" :min="1" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="单价" width="120">
          <template #default="{ row }">
            <el-input-number v-model="row.unitPrice" :min="0" :step="1" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="" width="64">
          <template #default="{ $index }">
            <el-button link type="danger" @click="form.items.splice($index, 1)">删</el-button>
          </template>
        </el-table-column>
      </el-table>
      <p class="total-line" v-if="createTotal != null">合计：¥{{ createTotal }}</p>
      <template #footer>
        <el-button @click="createOpen = false">取消</el-button>
        <el-button :loading="saving" @click="saveCreate('draft')">存草稿</el-button>
        <el-button type="primary" :loading="saving" @click="saveCreate('submitted')">提交订货</el-button>
      </template>
    </el-dialog>

    <!-- 改地址备注 -->
    <el-dialog v-model="metaOpen" title="修改联系与备注" width="480px" destroy-on-close>
      <el-form label-width="96px" size="small">
        <el-form-item label="联系人"><el-input v-model="metaForm.contactName" /></el-form-item>
        <el-form-item label="电话"><el-input v-model="metaForm.contactPhone" /></el-form-item>
        <el-form-item label="收货地址"><el-input v-model="metaForm.shipToAddress" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="客户备注"><el-input v-model="metaForm.note" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="内部备注"><el-input v-model="metaForm.adminNote" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="metaOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveMeta">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Refresh, Search, Download } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { cdnUpdate, cdnAdd } from '../cloud'
import {
  shipPurchaseOrder,
  markOrderReceived,
  confirmOfflinePaid,
  reconcileWechatPay,
  refundWechatPay,
  canReconcileWechat,
  canRefundWechat,
  PO_STATUS,
  PAYMENT_STATUS,
  CARRIERS,
  B2B_CATALOG,
  statusLabel,
  statusType,
  buyerLabel,
  sourceLabel,
  fmtTime,
  calcItemsTotal,
  genOrderNo,
  downloadCsv,
  copyText,
  loadStores,
  loadHqProducts,
  productStock,
  guessProduct,
  summarizeOrders,
  buildOrderCopyText,
  listPurchaseOrdersAdmin,
} from '../utils/b2bFulfillment'
import { loadB2bCatalog, publishB2bCatalog } from '../utils/b2bCatalogSync'
import ErpEmpty from './ErpEmpty.vue'

const emit = defineEmits(['shipped', 'changed'])

const COLLECTION = 'purchase_orders'
const list = ref([])
const loading = ref(false)
const saving = ref(false)
const shipping = ref(false)
const statusFilter = ref('submitted')
const paymentFilter = ref('all')
const buyerFilter = ref('all')
const sourceFilter = ref('all')
const keyword = ref('')
const detailOpen = ref(false)
const createOpen = ref(false)
const shipOpen = ref(false)
const metaOpen = ref(false)
const current = ref(null)
const shipTarget = ref(null)
const sourceHint = ref('')
const productOptions = ref([])
const stores = ref([])
const selected = ref([])
const catalogSource = ref('seed')
const catalogPublishing = ref(false)

const shipForm = ref({ carrier: '顺丰速运', trackingNumber: '', items: [] })
const metaForm = ref({})
const form = ref(emptyCreate())

function emptyCreate() {
  return {
    buyerType: 'own_store',
    storeId: '',
    storeName: '',
    contactName: '',
    contactPhone: '',
    shipToAddress: '',
    note: '',
    items: [],
  }
}

const skuCount = (items) => (Array.isArray(items) ? items.length : 0)
const stats = computed(() => summarizeOrders(list.value))
const selectedSubmitted = computed(() => selected.value.filter((r) => r.status === 'submitted'))
const createTotal = computed(() => calcItemsTotal(form.value.items))

const filteredList = computed(() => {
  return list.value.filter((r) => {
    if (statusFilter.value === 'toShip') {
      if (!['confirmed', 'shipping'].includes(r.status)) return false
    } else if (statusFilter.value !== 'all' && r.status !== statusFilter.value) {
      return false
    }
    if (paymentFilter.value !== 'all') {
      if (paymentFilter.value === 'paid') {
        if (!['paid', 'marked_paid'].includes(r.paymentStatus)) return false
      } else if ((r.paymentStatus || 'unpaid') !== paymentFilter.value) {
        return false
      }
    }
    if (buyerFilter.value !== 'all' && (r.buyerType || 'own_store') !== buyerFilter.value) return false
    if (sourceFilter.value !== 'all' && r.source !== sourceFilter.value) return false
    const q = keyword.value.trim().toLowerCase()
    if (!q) return true
    const blob = [r.orderNo, r.storeName, r.company, r.contactName, r.contactPhone, r.storeId, r.note]
      .map((x) => String(x || '').toLowerCase())
      .join(' ')
    return blob.includes(q)
  })
})

const emptyDesc = computed(() => {
  if (keyword.value.trim()) return '无匹配订货单'
  if (paymentFilter.value === 'offline_pending') return '暂无待对公订货单'
  if (statusFilter.value === 'submitted') return '暂无待确认订货单'
  return '暂无订货单'
})

const emptyHint = computed(() => {
  if (keyword.value.trim()) return '试试清空搜索，或放宽状态 / 支付 / 来源筛选。'
  if (paymentFilter.value === 'offline_pending') {
    return '采购商提交对公付款后会出现在此；确认到账后支付状态会变为已支付。'
  }
  if (statusFilter.value === 'submitted') {
    return '店长端或采购商台提交订货单后会出现；也可点右上角「新建订货单」。'
  }
  return '店长端、采购商台或本页新建提交后会出现在此。'
})

const quickFilter = (v) => {
  statusFilter.value = v
  if (v !== 'all') paymentFilter.value = 'all'
}

const quickPayFilter = (v) => {
  paymentFilter.value = v
  statusFilter.value = 'all'
}

const onSelect = (rows) => {
  selected.value = rows
}

const stepIndex = (status) => {
  if (status === 'cancelled') return 0
  if (status === 'draft' || status === 'submitted') return 0
  if (status === 'confirmed' || status === 'shipping') return 1
  if (status === 'shipped') return 2
  if (status === 'received' || status === 'closed') return 4
  return 0
}

const canEditMeta = (row) =>
  ['draft', 'submitted', 'confirmed', 'shipping', 'shipped'].includes(row?.status)

const stockOf = (row) => {
  const p = productOptions.value.find((x) => x._id === row.productId)
  return p ? productStock(p) : '—'
}

const refresh = async () => {
  loading.value = true
  sourceHint.value = ''
  try {
    list.value = await listPurchaseOrdersAdmin(300)
    emit('changed', summarizeOrders(list.value))
  } catch (e) {
    console.warn('purchase_orders load failed', e)
    list.value = []
    sourceHint.value = `采购单列表读取失败（${e?.message || e}）。列表经云函数 payB2bPurchase 读取，仅超管可用；请确认该函数已配置 ADMIN_OPS_KEY。`
  } finally {
    loading.value = false
  }
}

const viewDetail = (row) => {
  current.value = row
  detailOpen.value = true
}

const confirmRow = async (row) => {
  try {
    await ElMessageBox.confirm(`确认订货单 ${row.orderNo}？确认后可出货扣库。`, '确认订货', { type: 'warning' })
    const now = Date.now()
    await cdnUpdate(COLLECTION, row._id, { status: 'confirmed', confirmedAt: now, updatedAt: now })
    ElMessage.success('已确认')
    detailOpen.value = false
    await refresh()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '确认失败')
  }
}

/** 对公到账确认（仅 paymentStatus：offline_pending → paid） */
const confirmPayRow = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确认订货单 ${row.orderNo} 对公款项已到账？将标记为已支付（不改履约状态）。`,
      '确认对公到账',
      { type: 'warning' }
    )
    const res = await confirmOfflinePaid(row._id)
    ElMessage.success(res.alreadyPaid ? '该单已是已付状态' : '已确认对公到账')
    if (current.value && current.value._id === row._id) {
      current.value = {
        ...current.value,
        paymentStatus: 'paid',
        paymentChannel: 'offline',
        paidAt: Date.now(),
      }
    }
    await refresh()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '确认到账失败')
  }
}

/** 回调缺失时按微信侧真实交易补记（金额不一致会转「金额待核对」，不会标已付） */
const reconcileRow = async (row) => {
  try {
    const res = await reconcileWechatPay(row._id)
    if (res.paid || res.alreadyPaid) ElMessage.success(res.msg || '已确认支付')
    else ElMessage.info(res.msg || '微信侧未查到成功支付')
    detailOpen.value = false
    await refresh()
  } catch (e) {
    ElMessage.error(e.message || '查单失败')
  }
}

/** 微信原路全额退款：须输入完整订货单号 + 退款原因（资金操作，仅超管；云函数记录操作人） */
const refundRow = async (row) => {
  try {
    const { value: typed } = await ElMessageBox.prompt(
      `将把订货单 ${row.orderNo} 的微信支付（¥${row.totalAmount ?? '—'}）原路全额退回，不可撤销。请输入完整订货单号确认：`,
      '微信退款 · 二次确认',
      { type: 'warning', confirmButtonText: '下一步', inputPlaceholder: row.orderNo }
    )
    if (String(typed || '').trim() !== String(row.orderNo || '')) {
      ElMessage.warning('订货单号不一致，已取消')
      return
    }
    const { value: reason } = await ElMessageBox.prompt('退款原因（必填，会写入微信退款单与操作记录）', '微信退款 · 原因', {
      confirmButtonText: '确认退款',
      inputValidator: (v) => (String(v || '').trim() ? true : '请填写退款原因'),
    })
    const res = await refundWechatPay(row._id, { confirmOrderNo: String(typed).trim(), reason: String(reason).trim() })
    ElMessage.success(res.msg || '微信已受理退款')
    detailOpen.value = false
    await refresh()
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message || '退款失败')
  }
}

const batchConfirm = async () => {
  const rows = selectedSubmitted.value
  if (!rows.length) return
  try {
    await ElMessageBox.confirm(`确认选中的 ${rows.length} 张订货单？`, '批量确认', { type: 'warning' })
    const now = Date.now()
    for (const row of rows) {
      await cdnUpdate(COLLECTION, row._id, { status: 'confirmed', confirmedAt: now, updatedAt: now })
    }
    ElMessage.success(`已确认 ${rows.length} 单`)
    await refresh()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '批量确认失败')
  }
}

const cancelRow = async (row) => {
  try {
    await ElMessageBox.confirm(`取消订货单 ${row.orderNo}？`, '取消', { type: 'warning' })
    await cdnUpdate(COLLECTION, row._id, { status: 'cancelled', updatedAt: Date.now() })
    ElMessage.success('已取消')
    detailOpen.value = false
    await refresh()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '取消失败')
  }
}

const openShip = async (row) => {
  if (!productOptions.value.length) productOptions.value = await loadHqProducts()
  shipTarget.value = row
  shipForm.value = {
    carrier: '顺丰速运',
    trackingNumber: '',
    items: (row.items || []).map((it) => {
      const guessed = guessProduct(it, productOptions.value)
      return {
        skuId: it.skuId || '',
        name: it.name,
        quantity: it.quantity,
        productId: it.productId || guessed?._id || '',
      }
    }),
  }
  shipOpen.value = true
}

const confirmShip = async () => {
  if (!shipTarget.value) return
  shipping.value = true
  try {
    const res = await shipPurchaseOrder({
      order: shipTarget.value,
      items: shipForm.value.items,
      carrier: shipForm.value.carrier,
      trackingNumber: shipForm.value.trackingNumber,
    })
    ElMessage.success(`已出货 ${res.shipmentNo}，库存已扣减`)
    shipOpen.value = false
    detailOpen.value = false
    emit('shipped', res)
    statusFilter.value = 'shipped'
    await refresh()
  } catch (e) {
    ElMessage.error(e.message || '出货失败')
  } finally {
    shipping.value = false
  }
}

const receiveRow = async (row) => {
  try {
    await ElMessageBox.confirm(`确认门店已收到 ${row.orderNo}？（Admin 代收货）`, '代收货', { type: 'warning' })
    await markOrderReceived(row._id)
    ElMessage.success('已关闭订货单')
    detailOpen.value = false
    await refresh()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '收货失败')
  }
}

const openCreate = () => {
  form.value = emptyCreate()
  createOpen.value = true
}

const onStorePick = (id) => {
  const s = stores.value.find((x) => (x.storeId || x._id) === id)
  if (s) form.value.storeName = s.name || form.value.storeName
}

const addCatalogItem = (val) => {
  if (!val) return
  if (val.startsWith('cat:')) {
    const skuId = val.slice(4)
    const c = B2B_CATALOG.find((x) => x.skuId === skuId)
    if (!c) return
    const guessed = guessProduct({ name: c.name, skuId: c.skuId }, productOptions.value)
    form.value.items.push({
      skuId: c.skuId,
      name: c.name,
      quantity: 1,
      unitPrice: c.price,
      priceLabel: c.priceLabel,
      productId: guessed?._id || null,
    })
  } else if (val.startsWith('prod:')) {
    const id = val.slice(5)
    const p = productOptions.value.find((x) => x._id === id)
    if (!p) return
    form.value.items.push({
      skuId: p._id,
      productId: p._id,
      name: p.title || p.name,
      quantity: 1,
      unitPrice: p.price || p.supplyPrice || null,
    })
  }
}

const saveCreate = async (status) => {
  if (!form.value.items.length) return ElMessage.warning('请先添加 SKU')
  const normalized = form.value.items
    .map((it) => ({
      skuId: String(it.skuId || ''),
      productId: it.productId || null,
      name: String(it.name || '').trim(),
      quantity: Math.max(1, parseInt(it.quantity, 10) || 1),
      unitPrice: it.unitPrice != null ? Number(it.unitPrice) : null,
      priceLabel: it.priceLabel || null,
    }))
    .filter((it) => it.name)
  saving.value = true
  try {
    const now = Date.now()
    await cdnAdd(COLLECTION, {
      orderNo: genOrderNo(),
      source: 'admin',
      intentId: null,
      storeId: form.value.storeId || null,
      storeName: form.value.storeName || '',
      buyerType: form.value.buyerType,
      contactName: form.value.contactName || '',
      contactPhone: form.value.contactPhone || '',
      company: form.value.storeName || '',
      shipToAddress: form.value.shipToAddress || '',
      note: form.value.note || '',
      items: normalized,
      totalAmount: calcItemsTotal(normalized),
      status,
      shipmentIds: [],
      submittedAt: status === 'submitted' ? now : null,
      createdAt: now,
      updatedAt: now,
      createdBy: 'admin',
    })
    ElMessage.success(status === 'draft' ? '草稿已保存' : '已提交订货单')
    createOpen.value = false
    statusFilter.value = status
    await refresh()
  } catch (e) {
    ElMessage.error(e.message || '创建失败')
  } finally {
    saving.value = false
  }
}

const openEditMeta = (row) => {
  metaForm.value = {
    _id: row._id,
    contactName: row.contactName || '',
    contactPhone: row.contactPhone || '',
    shipToAddress: row.shipToAddress || '',
    note: row.note || '',
    adminNote: row.adminNote || '',
  }
  metaOpen.value = true
}

const saveMeta = async () => {
  saving.value = true
  try {
    await cdnUpdate(COLLECTION, metaForm.value._id, {
      contactName: metaForm.value.contactName,
      contactPhone: metaForm.value.contactPhone,
      shipToAddress: metaForm.value.shipToAddress,
      note: metaForm.value.note,
      adminNote: metaForm.value.adminNote,
      updatedAt: Date.now(),
    })
    ElMessage.success('已更新')
    metaOpen.value = false
    detailOpen.value = false
    await refresh()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const copyOrder = async (row) => {
  try {
    await copyText(buildOrderCopyText(row))
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.error('复制失败')
  }
}

const exportCsv = () => {
  const rows = filteredList.value.map((r) => [
    r.orderNo,
    fmtTime(r.submittedAt || r.createdAt),
    buyerLabel(r.buyerType),
    r.storeName || r.company,
    r.contactName,
    r.contactPhone,
    skuCount(r.items),
    r.totalAmount ?? '',
    statusLabel(PO_STATUS, r.status),
    sourceLabel(r.source),
    r.shipToAddress,
    (r.items || []).map((it) => `${it.name}×${it.quantity}`).join('；'),
  ])
  downloadCsv(`订货单_${new Date().toISOString().slice(0, 10)}.csv`, [
    '单号', '时间', '买方', '门店/公司', '联系人', '电话', 'SKU件数', '合计', '状态', '来源', '地址', '明细',
  ], rows)
  ElMessage.success(`已导出 ${rows.length} 条`)
}

const applyFilter = (status) => {
  statusFilter.value = status || 'all'
}

const refreshCatalogSource = async () => {
  try {
    const { source } = await loadB2bCatalog()
    catalogSource.value = source
  } catch {
    catalogSource.value = 'seed'
  }
}

const publishCatalog = async () => {
  try {
    await ElMessageBox.confirm(
      `将 Admin 本地 ${B2B_CATALOG.length} 条供货价目写入 configs/b2b_catalog，店长端 listCatalog 将优先读取云端。`,
      '同步价目到云端',
      { type: 'info' }
    )
  } catch {
    return
  }
  catalogPublishing.value = true
  try {
    await publishB2bCatalog(B2B_CATALOG)
    catalogSource.value = 'configs'
    ElMessage.success('价目已同步到云端')
  } catch (e) {
    ElMessage.error(e.message || '同步失败')
  } finally {
    catalogPublishing.value = false
  }
}

onMounted(async () => {
  refresh()
  refreshCatalogSource()
  productOptions.value = await loadHqProducts()
  stores.value = await loadStores()
})

defineExpose({ refresh, applyFilter })
</script>

<style scoped>
.po-container { padding: 4px 0 24px; }
.stat-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 14px; }
.stat-card {
  background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 12px 14px;
  text-align: left; cursor: pointer;
}
.stat-card.on { border-color: #d4af37; box-shadow: 0 0 0 1px #d4af37; }
.stat-card.static { cursor: default; }
.stat-num { font-size: 22px; font-weight: 700; color: #2c2c2c; }
.stat-num.warn { color: #b8860b; }
.stat-num.ok { color: #2d6a4f; }
.stat-num.gold { color: #8b6914; font-size: 18px; }
.stat-label { font-size: 12px; color: #999; margin-top: 2px; }
.panel-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 12px; margin-bottom: 14px; flex-wrap: wrap;
}
.title-box h2 { margin: 0; font-size: 18px; font-weight: 600; }
.subtitle { color: var(--el-text-color-secondary); font-size: 12px; }
.header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.t-main { font-weight: 500; }
.t-sub { font-size: 12px; color: var(--el-text-color-secondary); }
.amount { color: #8b6914; font-weight: 600; }
.detail-items { margin-top: 16px; }
.seg { font-weight: 600; margin-bottom: 8px; }
.total-line { margin-top: 10px; font-weight: 600; }
.detail-actions { margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
.stock-low { color: #c0392b; font-weight: 700; }
@media (max-width: 900px) {
  .stat-row { grid-template-columns: repeat(2, 1fr); }
}
</style>
