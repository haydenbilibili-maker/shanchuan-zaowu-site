<template>
  <div class="pi-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>采购意向清单 / PURCHASE INTENTS</h2>
        <span class="subtitle">PRICE-LIST · 官网报价单提交</span>
      </div>
      <div class="header-actions">
        <el-select v-model="statusFilter" size="small" style="width: 120px" @change="refresh">
          <el-option label="全部状态" value="all" />
          <el-option label="待处理" value="pending" />
          <el-option label="已联系" value="contacted" />
          <el-option label="已关闭" value="closed" />
        </el-select>
        <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
      </div>
    </div>

    <el-alert
      v-if="sourceHint"
      :title="sourceHint"
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
    />

    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" stripe @row-click="viewDetail">
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">
            <div class="t-main">{{ fmt(row.createdAt || row.createTime) }}</div>
            <div class="t-sub">{{ row.source || 'price-list' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="联系人" width="140">
          <template #default="{ row }">
            <div class="t-main">{{ row.contactName || '-' }}</div>
            <div class="t-sub" v-if="row.company">{{ row.company }}</div>
          </template>
        </el-table-column>
        <el-table-column label="联系方式" width="160">
          <template #default="{ row }">
            <span class="phone">{{ row.contactPhone || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="SKU 明细" min-width="220">
          <template #default="{ row }">
            <div class="items-preview">{{ itemsPreview(row.items) }}</div>
            <div class="t-sub" v-if="row.totalAmount != null">
              估算合计 ¥{{ row.totalAmount }}{{ hasRange(row.items) ? '（含区间按下限）' : '' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.note || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="dark" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link @click.stop="viewDetail(row)">详情</el-button>
            <el-button
              v-if="row.status === 'pending'"
              size="small"
              type="primary"
              color="#d4af37"
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
              v-if="row.status === 'closed'"
              size="small"
              link
              @click.stop="setStatus(row, 'pending')"
            >重开</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer v-model="detailOpen" title="采购意向详情" size="480px" destroy-on-close>
      <template v-if="current">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="提交时间">{{ fmt(current.createdAt || current.createTime) }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(current.status)" size="small">{{ statusLabel(current.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="联系人">{{ current.contactName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="电话/微信">{{ current.contactPhone || '-' }}</el-descriptions-item>
          <el-descriptions-item label="公司/店铺">{{ current.company || '—' }}</el-descriptions-item>
          <el-descriptions-item label="备注">{{ current.note || '—' }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ current.source || 'price-list' }}</el-descriptions-item>
          <el-descriptions-item label="存储">{{ current.persistedVia || (String(current._id || '').startsWith('local_') ? 'local' : 'cloudbase') }}</el-descriptions-item>
        </el-descriptions>

        <div class="detail-items">
          <div class="seg">SKU 明细</div>
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
            估算合计：¥{{ current.totalAmount }}
            <span v-if="hasRange(current.items)">（区间 SKU 按下限）</span>
          </p>
        </div>

        <div class="detail-actions">
          <el-button v-if="current.status !== 'contacted'" type="primary" color="#d4af37" @click="setStatus(current, 'contacted')">标记已联系</el-button>
          <el-button v-if="current.status !== 'closed'" @click="setStatus(current, 'closed')">关闭</el-button>
          <el-button v-if="current.status !== 'pending'" @click="setStatus(current, 'pending')">标为待处理</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { fetchCollectionSorted, cdnUpdate } from '../cloud'

const COLLECTION = 'purchase_intents'
const LOCAL_KEY = 'shanhai_purchase_intents_v1'

const list = ref([])
const loading = ref(false)
const statusFilter = ref('pending')
const detailOpen = ref(false)
const current = ref(null)
const sourceHint = ref('')

const STATUS = {
  pending: { text: '待处理', type: 'warning' },
  contacted: { text: '已联系', type: '' },
  closed: { text: '已关闭', type: 'info' }
}
const statusLabel = (s) => STATUS[s]?.text || s || '待处理'
const statusType = (s) => STATUS[s]?.type || 'info'

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

const itemsPreview = (items) => {
  if (!Array.isArray(items) || !items.length) return '—'
  return items
    .slice(0, 3)
    .map((i) => `${i.name}×${i.quantity}`)
    .join('、') + (items.length > 3 ? ` 等${items.length}项` : '')
}

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
  try {
    let cloudRows = []
    let cloudOk = false
    try {
      const where = statusFilter.value === 'all' ? null : { status: statusFilter.value }
      cloudRows = await fetchCollectionSorted(COLLECTION, {
        limit: 200,
        where,
        sortFn: (a, b) => (b.createdAt || b.createTime || 0) - (a.createdAt || a.createTime || 0)
      })
      cloudOk = true
    } catch (e) {
      console.warn('purchase_intents cloud load failed', e)
      sourceHint.value = 'CloudBase 集合 purchase_intents 暂不可用，已显示本机镜像（需建集合并配置规则后可云端同步）'
    }

    let localRows = readLocal()
    if (statusFilter.value !== 'all') {
      localRows = localRows.filter((r) => (r.status || 'pending') === statusFilter.value)
    }

    list.value = mergeById(cloudRows, localRows)
    if (cloudOk && !cloudRows.length && localRows.length) {
      sourceHint.value = '云端暂无记录；列表含本机暂存（同源报价页提交）'
    } else if (cloudOk && localRows.some((r) => r.persistedVia === 'local')) {
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

const setStatus = async (row, status) => {
  if (!row?._id) return
  const id = row._id
  const isLocal = String(id).startsWith('local_') || row.persistedVia === 'local'
  try {
    if (!isLocal) {
      await cdnUpdate(COLLECTION, id, { status, updatedAt: Date.now() })
    }
    // 同步本地镜像
    const local = readLocal()
    const idx = local.findIndex((x) => x._id === id)
    if (idx >= 0) {
      local[idx] = { ...local[idx], status, updatedAt: Date.now() }
      writeLocal(local)
    } else if (isLocal) {
      // 仅本地：更新列表项本身
      writeLocal([{ ...row, status, updatedAt: Date.now() }, ...local.filter((x) => x._id !== id)])
    }
    ElMessage.success(`已更新为「${statusLabel(status)}」`)
    if (current.value?._id === id) current.value = { ...current.value, status }
    refresh()
  } catch (e) {
    // 云端失败时仍改本地
    const local = readLocal()
    const next = local.map((x) => (x._id === id ? { ...x, status, updatedAt: Date.now() } : x))
    if (!next.find((x) => x._id === id)) next.unshift({ ...row, status, updatedAt: Date.now() })
    writeLocal(next)
    ElMessage.warning('云端更新失败，已写入本机镜像：' + (e.message || e))
    refresh()
  }
}

onMounted(refresh)
</script>

<style scoped>
.pi-container { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }
.header-actions { display: flex; align-items: center; gap: 8px; }
.t-main { font-weight: 600; color: #333; }
.t-sub { font-size: 12px; color: #999; margin-top: 2px; }
.phone { color: #666; }
.items-preview { font-size: 13px; color: #333; line-height: 1.45; }
.detail-items { margin-top: 20px; }
.seg { font-size: 12px; color: #999; margin-bottom: 8px; letter-spacing: 1px; }
.total-line { margin-top: 12px; color: #d4af37; font-weight: 700; }
.detail-actions { margin-top: 20px; display: flex; gap: 8px; flex-wrap: wrap; }
</style>
