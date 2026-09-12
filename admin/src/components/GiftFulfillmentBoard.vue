<template>
  <div class="gift-board">
    <div class="header-section">
      <h2>礼赠履约看板</h2>
      <p class="subtitle">
        与小程序 <code>gift-ops</code> 同级：待填址 / 待发货 / 自提核销 / 已完成。
        对接 <code>manageGift.listBoard</code>（约 200 笔采样）。运营规则请到「礼赠运营」页。
      </p>
    </div>

    <div class="bucket-row">
      <button
        v-for="b in buckets"
        :key="b.key"
        type="button"
        class="bucket-chip"
        :class="{ on: bucket === b.key }"
        @click="switchBucket(b.key)"
      >
        <span class="bucket-val">{{ counts[b.key] || 0 }}</span>
        <span class="bucket-lbl">{{ b.label }}</span>
      </button>
      <el-button class="refresh-btn" :loading="loading" @click="load(true)">刷新</el-button>
    </div>

    <p class="note" v-if="note">{{ note }}</p>
    <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError" class="err-alert" />

    <el-card v-loading="loading && !list.length" class="board-card" shadow="never">
      <el-empty
        v-if="!loading && !list.length && !loadError"
        description="本栏暂无单 · 礼赠支付后会出现在对应栏位"
        :image-size="72"
      />

      <div v-else class="card-list">
        <div
          v-for="item in list"
          :key="item.orderId"
          class="order-card"
          :class="{ expanded: expandedId === item.orderId }"
          @click="toggleExpand(item.orderId)"
        >
          <div class="card-top">
            <div class="card-titles">
              <div class="card-title">{{ item.productTitle || '礼赠商品' }}</div>
              <div class="card-sub">{{ item.deliveryLabel }} · {{ item.bucketLabel }}</div>
            </div>
            <div class="card-price" v-if="item.totalPrice">¥{{ item.totalPrice }}</div>
          </div>
          <div class="card-meta">
            <span>{{ item.orderNo || item.orderId }}</span>
            <span v-if="item.paidText">付 {{ item.paidText }}</span>
            <span class="warn" v-if="item.expireText && bucket === 'awaiting_address'">止 {{ item.expireText }}</span>
          </div>
          <div class="card-extra" v-if="expandedId === item.orderId" @click.stop>
            <p v-if="item.recipientName">写给 · {{ item.recipientName }}</p>
            <p v-if="item.storeName">门店 · {{ item.storeName }}</p>
            <p v-if="item.claimCode">妥投码 · {{ item.claimCode }}</p>
            <template v-if="item.address">
              <p>{{ item.address.name }} {{ item.address.phone }}</p>
              <p>{{ item.address.line }}</p>
            </template>
            <p class="warn" v-if="item.shipBlockReason">{{ item.shipBlockReason }}</p>
            <div class="extra-actions">
              <el-button size="small" @click="copyText(item.orderNo || item.orderId)">复制单号</el-button>
              <el-button
                v-if="item.address && (item.address.phone || item.address.line)"
                size="small"
                @click="copyAddress(item)"
              >复制地址</el-button>
            </div>
          </div>
        </div>
      </div>

      <div class="list-foot" v-if="list.length">
        <el-button v-if="hasMore" :loading="loading" link type="primary" @click="load(false)">加载更多</el-button>
        <span v-else class="muted">共 {{ total }} 笔</span>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { callCloudFunction } from '../cloud'
import { cloudFnErrorMessage } from '../utils/cloudFnErrors'

const FN = 'manageGift'
const opsKey = () => import.meta.env?.VITE_ADMIN_OPS_KEY || undefined

const BUCKETS = [
  { key: 'awaiting_address', label: '待填址' },
  { key: 'awaiting_ship', label: '待发货' },
  { key: 'pickup_verify', label: '自提核销' },
  { key: 'done', label: '已完成' }
]

const buckets = BUCKETS
const bucket = ref('awaiting_address')
const loading = ref(false)
const loadError = ref('')
const note = ref('')
const list = ref([])
const page = ref(1)
const hasMore = ref(false)
const total = ref(0)
const expandedId = ref('')
const counts = reactive({
  awaiting_address: 0,
  awaiting_ship: 0,
  pickup_verify: 0,
  done: 0
})

async function callFn(data) {
  const res = await callCloudFunction(FN, { ...data, adminOpsKey: opsKey() })
  if (!res || res.success === false) {
    const info = cloudFnErrorMessage(res)
    const err = new Error(info.message)
    err.code = info.code || res?.code
    throw err
  }
  return res
}

function switchBucket(key) {
  if (!key || key === bucket.value) return
  bucket.value = key
  expandedId.value = ''
  load(true)
}

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? '' : id
}

async function copyText(text) {
  const t = String(text || '').trim()
  if (!t) return
  try {
    await navigator.clipboard.writeText(t)
    ElMessage.success('已复制')
  } catch (e) {
    ElMessage.warning('复制失败，请手动选择')
  }
}

function copyAddress(item) {
  const addr = item?.address || {}
  const lines = [
    [addr.name, addr.phone].filter(Boolean).join(' '),
    addr.line || ''
  ].filter(Boolean)
  copyText(lines.join('\n'))
}

async function load(reset) {
  if (loading.value) return
  const nextPage = reset ? 1 : page.value + 1
  loading.value = true
  if (reset) loadError.value = ''
  try {
    const result = await callFn({
      action: 'listBoard',
      bucket: bucket.value,
      page: nextPage,
      pageSize: 20
    })
    const nextList = reset ? (result.list || []) : list.value.concat(result.list || [])
    list.value = nextList
    page.value = result.page || nextPage
    hasMore.value = !!result.hasMore
    total.value = result.total || 0
    note.value = result.note || ''
    const c = result.counts || {}
    counts.awaiting_address = Number(c.awaiting_address) || 0
    counts.awaiting_ship = Number(c.awaiting_ship) || 0
    counts.pickup_verify = Number(c.pickup_verify) || 0
    counts.done = Number(c.done) || 0
  } catch (e) {
    loadError.value = e?.message || '礼赠看板暂不可用'
    if (reset) list.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => load(true))
</script>

<style scoped>
.gift-board { padding: 8px 4px 24px; color: #4A4540; }
.header-section h2 { margin: 0 0 6px; font-size: 20px; color: #33302C; font-weight: 600; }
.subtitle { font-size: 13px; color: #6B6560; line-height: 1.5; max-width: 820px; }
.bucket-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin: 16px 0 8px;
}
.bucket-chip {
  min-width: 88px;
  padding: 10px 14px;
  border: 1px solid #E8E5DE;
  border-radius: 8px;
  background: #FFFFFF;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
}
.bucket-chip:hover { border-color: #C4A76C; }
.bucket-chip.on {
  border-color: #C4A76C;
  background: #FAF6ED;
}
.bucket-val {
  display: block;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 20px;
  font-weight: 600;
  color: #C4A76C;
}
.bucket-lbl { display: block; margin-top: 2px; font-size: 12px; color: #6B6560; }
.refresh-btn { margin-left: auto; }
.note, .muted { font-size: 12px; color: #A09A90; }
.err-alert { margin: 8px 0 12px; }
.board-card { border: 1px solid #E8E5DE; }
.card-list { display: flex; flex-direction: column; gap: 10px; }
.order-card {
  border: 1px solid #E8E5DE;
  border-radius: 8px;
  padding: 12px 14px;
  background: #FFFFFF;
  cursor: pointer;
}
.order-card.expanded { border-color: #C4A76C; background: #FAF6ED; }
.card-top { display: flex; justify-content: space-between; gap: 12px; }
.card-title { font-weight: 600; color: #33302C; }
.card-sub { margin-top: 4px; font-size: 12px; color: #6B6560; }
.card-price {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: #C4A76C;
  font-weight: 600;
  white-space: nowrap;
}
.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  font-size: 12px;
  color: #A09A90;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.card-meta .warn, .card-extra .warn, .warn { color: #E9A23B; }
.card-extra {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #E8E5DE;
  font-size: 13px;
  color: #4A4540;
  line-height: 1.5;
}
.card-extra p { margin: 0 0 4px; }
.extra-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.list-foot { margin-top: 14px; text-align: center; }
</style>
