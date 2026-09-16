<template>
  <div class="pi-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>意向线索 / PURCHASE INTENTS</h2>
        <span class="subtitle">官网报价单 · 可转正式订货单</span>
      </div>
      <div class="header-actions">
        <el-input
          v-model="keyword"
          size="small"
          clearable
          placeholder="搜索联系人 / 电话"
          style="width: 180px"
          :prefix-icon="Search"
        />
        <el-select v-model="statusFilter" size="small" style="width: 120px" @change="refresh">
          <el-option label="全部状态" value="all" />
          <el-option label="待处理" value="pending" />
          <el-option label="已联系" value="contacted" />
          <el-option label="已关闭" value="closed" />
        </el-select>
        <el-button size="small" :icon="Download" @click="exportCsv" :disabled="!filteredList.length">导出</el-button>
        <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
      </div>
    </div>

    <el-alert
      v-if="sourceHint"
      :title="sourceHint"
      :type="hintType"
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
      >
        <template #empty>
          <el-empty :description="emptyDesc" :image-size="88" />
        </template>
        <el-table-column label="提交时间" width="168">
          <template #default="{ row }">
            <div class="t-main">{{ fmt(row.createdAt || row.createTime) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="联系人" width="110" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="t-main">{{ row.contactName || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="电话/微信" width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="phone">{{ row.contactPhone || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="公司" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.company || '—' }}</template>
        </el-table-column>
        <el-table-column label="SKU 件数" width="90" align="center">
          <template #default="{ row }">{{ skuCount(row.items) }}</template>
        </el-table-column>
        <el-table-column label="供货小计" width="120">
          <template #default="{ row }">
            <template v-if="row.totalAmount != null">
              <span class="amount">¥{{ row.totalAmount }}</span>
              <div class="t-sub" v-if="hasRange(row.items)">含区间下限</div>
            </template>
            <span v-else class="t-sub">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="dark" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="100">
          <template #default="{ row }">
            <span class="t-sub">{{ sourceLabel(row.source) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link @click.stop="viewDetail(row)">详情</el-button>
            <el-button
              v-if="canConvert(row)"
              size="small"
              type="primary"
              @click.stop="convertToOrder(row)"
            >转正式单</el-button>
            <el-button
              v-if="row.status === 'pending'"
              size="small"
              @click.stop="setStatus(row, 'contacted')"
            >已联系</el-button>
            <el-button
              v-if="row.status !== 'closed'"
              size="small"
              type="info"
              link
              @click.stop="setStatus(row, 'closed')"
            >关闭</el-button>
            <el-button
              v-if="row.status === 'closed' && !row.convertedOrderId"
              size="small"
              link
              @click.stop="setStatus(row, 'pending')"
            >重开</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer v-model="detailOpen" title="采购意向详情" size="520px" destroy-on-close>
      <template v-if="current">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="提交时间">{{ fmt(current.createdAt || current.createTime) }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(current.status)" size="small">{{ statusLabel(current.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="联系人">{{ current.contactName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="电话/微信">{{ current.contactPhone || '-' }}</el-descriptions-item>
          <el-descriptions-item label="公司/店铺">{{ current.company || '—' }}</el-descriptions-item>
          <el-descriptions-item label="客户备注">{{ current.note || '—' }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ sourceLabel(current.source) }}</el-descriptions-item>
          <el-descriptions-item label="存储">{{ storageLabel(current) }}</el-descriptions-item>
          <el-descriptions-item v-if="current.convertedOrderId" label="已转订货单">
            {{ current.convertedOrderId }}
          </el-descriptions-item>
        </el-descriptions>

        <div class="detail-items">
          <div class="seg">SKU 明细（{{ skuCount(current.items) }} 件）</div>
          <el-table :data="current.items || []" size="small" border>
            <el-table-column prop="name" label="品名" min-width="140" />
            <el-table-column prop="quantity" label="数量" width="70" />
            <el-table-column label="供货价" width="110">
              <template #default="{ row }">
                {{ row.priceLabel || formatItemPrice(row) }}
              </template>
            </el-table-column>
            <el-table-column label="指导价" width="110">
              <template #default="{ row }">
                {{ row.guidePriceLabel || formatItemPrice({ price: row.guidePrice, priceMax: row.guidePriceMax, priceIsRange: row.guidePriceMax != null && row.guidePriceMax !== row.guidePrice }) }}
              </template>
            </el-table-column>
          </el-table>
          <p class="total-line" v-if="current.totalAmount != null">
            供货小计：¥{{ current.totalAmount }}
            <span v-if="hasRange(current.items)">（区间 SKU 按下限）</span>
          </p>
        </div>

        <div class="detail-actions">
          <el-button
            v-if="canConvert(current)"
            type="primary"
            :loading="converting"
            @click="convertToOrder(current)"
          >转为正式订货单</el-button>
          <el-button v-if="current.status !== 'contacted'" @click="setStatus(current, 'contacted')">标记已联系</el-button>
          <el-button v-if="current.status !== 'closed'" @click="setStatus(current, 'closed')">关闭</el-button>
          <el-button v-if="current.status !== 'pending' && !current.convertedOrderId" @click="setStatus(current, 'pending')">标为待处理</el-button>
          <el-button :icon="DocumentCopy" @click="copyDetail(current)">复制明细</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Refresh, Search, Download, DocumentCopy } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fetchCollectionSorted, cdnUpdate, cdnAdd } from '../cloud'

const emit = defineEmits(['converted'])

const COLLECTION = 'purchase_intents'
const ORDERS_COL = 'purchase_orders'
const LOCAL_KEY = 'shanhai_purchase_intents_v1'

const list = ref([])
const loading = ref(false)
const converting = ref(false)
const statusFilter = ref('pending')
const keyword = ref('')
const detailOpen = ref(false)
const current = ref(null)
const sourceHint = ref('')
const hintType = ref('info')
const cloudOk = ref(false)

const STATUS = {
  pending: { text: '待处理', type: 'warning' },
  contacted: { text: '已联系', type: '' },
  closed: { text: '已关闭', type: 'info' }
}
const statusLabel = (s) => STATUS[s]?.text || s || '待处理'
const statusType = (s) => STATUS[s]?.type || 'info'

const sourceLabel = (s) => {
  if (!s || s === 'price-list') return '报价页'
  return s
}

const storageLabel = (row) => {
  if (row.persistedVia) return row.persistedVia
  return String(row._id || '').startsWith('local_') ? 'local' : 'cloudbase'
}

const fmt = (ts) => {
  if (!ts) return ''
  const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN')
}

const formatItemPrice = (row) => {
  if (!row) return '—'
  if (row.priceLabel) return row.priceLabel
  if (row.priceIsRange && row.price != null && row.priceMax != null) return `${row.price}–${row.priceMax}`
  if (row.price != null) return String(row.price)
  return '—'
}

const hasRange = (items) => Array.isArray(items) && items.some((i) => i?.priceIsRange)

const skuCount = (items) => (Array.isArray(items) ? items.length : 0)

const filteredList = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return list.value
  return list.value.filter((r) => {
    const name = String(r.contactName || '').toLowerCase()
    const phone = String(r.contactPhone || '').toLowerCase()
    const company = String(r.company || '').toLowerCase()
    return name.includes(q) || phone.includes(q) || company.includes(q)
  })
})

const emptyDesc = computed(() => {
  if (keyword.value.trim()) return '无匹配联系人/电话'
  if (statusFilter.value === 'pending') return '暂无待处理意向（可切换「全部状态」查看）'
  if (!cloudOk.value) return '云端不可用且本机暂无镜像'
  return '暂无采购意向'
})

const readLocal = () => {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

const writeLocal = (rows) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rows.slice(0, 200)))
  } catch { /* ignore */ }
}

const mergeById = (cloudRows, localRows) => {
  const map = new Map()
  for (const r of localRows) {
    if (r && r._id) map.set(r._id, { ...r, persistedVia: r.persistedVia || 'local' })
  }
  for (const r of cloudRows) {
    if (r && r._id) map.set(r._id, { ...r, persistedVia: 'cloudbase' })
  }
  return Array.from(map.values()).sort(
    (a, b) => (b.createdAt || b.createTime || 0) - (a.createdAt || a.createTime || 0)
  )
}

const refresh = async () => {
  loading.value = true
  sourceHint.value = ''
  hintType.value = 'info'
  cloudOk.value = false
  try {
    let cloudRows = []
    try {
      const where = statusFilter.value === 'all' ? null : { status: statusFilter.value }
      cloudRows = await fetchCollectionSorted(COLLECTION, {
        limit: 200,
        where,
        throwOnError: true,
        sortFn: (a, b) => (b.createdAt || b.createTime || 0) - (a.createdAt || a.createTime || 0)
      })
      cloudOk.value = true
    } catch (e) {
      console.warn('purchase_intents cloud load failed', e)
      hintType.value = 'warning'
      sourceHint.value = 'CloudBase 集合 purchase_intents 暂不可用，已显示本机镜像（需建集合并配置规则后可云端同步）'
    }

    let localRows = readLocal()
    if (statusFilter.value !== 'all') {
      localRows = localRows.filter((r) => (r.status || 'pending') === statusFilter.value)
    }

    list.value = mergeById(cloudRows, localRows)
    if (cloudOk.value && !cloudRows.length && !localRows.length) {
      // 空态由 el-empty 展示，无需额外提示
    } else if (cloudOk.value && !cloudRows.length && localRows.length) {
      sourceHint.value = '云端暂无记录；列表含本机暂存（同源报价页提交）'
    } else if (cloudOk.value && localRows.some((r) => r.persistedVia === 'local')) {
      sourceHint.value = '已合并 CloudBase 与本机暂存'
    }
  } catch (e) {
    list.value = []
    ElMessage.error('加载失败：' + (e.message || e))
  } finally {
    loading.value = false
  }
}

const viewDetail = (row) => {
  current.value = row
  detailOpen.value = true
}

const buildDetailText = (row) => {
  const lines = [
    `【采购意向】${fmt(row.createdAt || row.createTime)}`,
    `联系人：${row.contactName || '-'}`,
    `电话/微信：${row.contactPhone || '-'}`,
    `公司：${row.company || '—'}`,
    `状态：${statusLabel(row.status)}`,
    `来源：${sourceLabel(row.source)}`,
    `备注：${row.note || '—'}`,
    '',
    'SKU 明细：',
    ...(Array.isArray(row.items) ? row.items.map((it, i) =>
      `${i + 1}. ${it.name} × ${it.quantity} · 供货 ${it.priceLabel || formatItemPrice(it)}`
    ) : ['（无）']),
  ]
  if (row.totalAmount != null) lines.push('', `供货小计：¥${row.totalAmount}`)
  return lines.join('\n')
}

const copyDetail = async (row) => {
  try {
    await navigator.clipboard.writeText(buildDetailText(row))
    ElMessage.success('明细已复制')
  } catch {
    ElMessage.error('复制失败，请手动选择文本')
  }
}

const exportCsv = () => {
  const rows = filteredList.value
  if (!rows.length) return
  const header = ['提交时间', '联系人', '电话微信', '公司', 'SKU件数', '供货小计', '状态', '来源', '备注', '明细']
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [header.join(',')]
  for (const r of rows) {
    const detail = (r.items || [])
      .map((it) => `${it.name}×${it.quantity}`)
      .join('；')
    lines.push([
      fmt(r.createdAt || r.createTime),
      r.contactName,
      r.contactPhone,
      r.company || '',
      skuCount(r.items),
      r.totalAmount ?? '',
      statusLabel(r.status),
      sourceLabel(r.source),
      r.note || '',
      detail
    ].map(escape).join(','))
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `采购意向_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 条`)
}

const setStatus = async (row, status) => {
  if (!row?._id) return
  const id = row._id
  const isLocal = String(id).startsWith('local_') || row.persistedVia === 'local'
  try {
    if (!isLocal) {
      await cdnUpdate(COLLECTION, id, { status, updatedAt: Date.now() })
    }
    const local = readLocal()
    const idx = local.findIndex((x) => x._id === id)
    if (idx >= 0) {
      local[idx] = { ...local[idx], status, updatedAt: Date.now() }
      writeLocal(local)
    } else if (isLocal) {
      writeLocal([{ ...row, status, updatedAt: Date.now() }, ...local.filter((x) => x._id !== id)])
    }
    ElMessage.success(`已更新为「${statusLabel(status)}」`)
    if (current.value?._id === id) current.value = { ...current.value, status }
    refresh()
  } catch (e) {
    const local = readLocal()
    const next = local.map((x) => (x._id === id ? { ...x, status, updatedAt: Date.now() } : x))
    if (!next.find((x) => x._id === id)) next.unshift({ ...row, status, updatedAt: Date.now() })
    writeLocal(next)
    ElMessage.warning('云端更新失败，已写入本机镜像：' + (e.message || e))
    refresh()
  }
}

const canConvert = (row) => {
  if (!row || row.convertedOrderId) return false
  if (String(row._id || '').startsWith('local_') || row.persistedVia === 'local') return false
  return Array.isArray(row.items) && row.items.length > 0
}

const genOrderNo = () => {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const seq = String(Math.floor(Math.random() * 900) + 100)
  return `PO${y}${m}${day}${seq}`
}

const convertToOrder = async (row) => {
  if (!canConvert(row)) {
    ElMessage.warning(row.convertedOrderId ? '已转过正式单' : '本机镜像请先确保已写入云端后再转单')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将「${row.contactName || '客户'}」的意向转为正式订货单？转单后意向将关闭。`,
      '转正式订货单',
      { type: 'warning' }
    )
  } catch {
    return
  }

  converting.value = true
  try {
    const items = (row.items || []).map((it) => ({
      skuId: String(it.skuId || ''),
      productId: null,
      name: String(it.name || '').trim(),
      quantity: Math.max(1, parseInt(it.quantity, 10) || 1),
      unitPrice: it.price != null ? Number(it.price) : null,
      priceLabel: it.priceLabel || null,
      priceMax: it.priceMax != null ? Number(it.priceMax) : null,
      priceIsRange: !!it.priceIsRange,
    })).filter((it) => it.name)
    if (!items.length) {
      ElMessage.error('意向明细为空')
      return
    }
    let totalAmount = 0
    let any = false
    for (const it of items) {
      if (it.unitPrice != null && Number.isFinite(it.unitPrice)) {
        totalAmount += it.unitPrice * it.quantity
        any = true
      }
    }
    const now = Date.now()
    const addRes = await cdnAdd(ORDERS_COL, {
      orderNo: genOrderNo(),
      source: 'price_list_convert',
      intentId: row._id,
      storeId: null,
      storeName: row.company || '',
      buyerType: 'channel',
      contactName: row.contactName || '',
      contactPhone: row.contactPhone || '',
      company: row.company || '',
      shipToAddress: '',
      note: row.note || '',
      items,
      totalAmount: any ? Math.round(totalAmount * 100) / 100 : row.totalAmount ?? null,
      status: 'submitted',
      shipmentIds: [],
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: 'admin',
    })
    const orderId = addRes?.id || addRes?._id
    if (!orderId) throw new Error('未返回订货单 id')
    await cdnUpdate(COLLECTION, row._id, {
      status: 'closed',
      convertedOrderId: orderId,
      convertedAt: now,
      updatedAt: now,
    })
    ElMessage.success('已转为正式订货单')
    detailOpen.value = false
    emit('converted', { orderId, intentId: row._id })
    await refresh()
  } catch (e) {
    ElMessage.error(e.message || '转单失败（请确认已创建 purchase_orders 集合）')
  } finally {
    converting.value = false
  }
}

onMounted(refresh)
defineExpose({ refresh })
</script>

<style scoped>
.pi-container { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }
.header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.t-main { font-weight: 600; color: #333; }
.t-sub { font-size: 12px; color: #999; margin-top: 2px; }
.phone { color: #666; }
.amount { font-weight: 700; color: #333; }
.detail-items { margin-top: 20px; }
.seg { font-size: 12px; color: #999; margin-bottom: 8px; letter-spacing: 1px; }
.total-line { margin-top: 12px; color: #d4af37; font-weight: 700; }
.detail-actions { margin-top: 20px; display: flex; gap: 8px; flex-wrap: wrap; }
</style>
