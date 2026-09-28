<template>
  <div class="comments-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>评论审核 / COMMENT MODERATION</h2>
        <span class="subtitle">UGC · moderateComment</span>
      </div>
      <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
    </div>

    <div class="filter-bar">
      <el-radio-group v-model="statusFilter" @change="refresh">
        <el-radio-button label="pending">
          待审核
          <el-badge v-if="pendingCount > 0" :value="pendingCount" class="b" type="danger" />
        </el-radio-button>
        <el-radio-button label="approved">已通过</el-radio-button>
        <el-radio-button label="hidden">已隐藏</el-radio-button>
        <el-radio-button label="all">全部</el-radio-button>
      </el-radio-group>
      <el-input
        v-model="keyword"
        placeholder="搜索内容关键字..."
        style="width: 240px"
        clearable
        prefix-icon="Search"
      />
    </div>

    <el-card shadow="never">
      <el-table :data="filteredList" v-loading="loading" stripe height="calc(100vh - 280px)">
        <template #empty>
          <ErpEmpty
            description="暂无评论"
            hint="当前筛选下没有评论。用户在商品/内容页发表后会出现；也可换状态或清空关键字。"
          />
        </template>
        <el-table-column label="评论内容" min-width="320">
          <template #default="{ row }">
            <div class="comment-content">{{ row.content }}</div>
            <div class="comment-meta">
              <span v-if="row.isPinned" class="pin-tag">已置顶</span>
              <span>赞 {{ row.likes || 0 }}</span>
              <span v-if="row.images?.length">图 {{ row.images.length }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="目标内容" width="180">
          <template #default="{ row }">
            <div>{{ row.targetType || row.type || '商品' }}</div>
            <div class="target-id">{{ (row.targetId || row.productId || '').slice(0, 12) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="用户" width="160">
          <template #default="{ row }">
            <div class="user-info">
              <el-avatar :size="28" :src="row.userAvatar" />
              <div>
                <div class="user-name">{{ row.userName || row.nickName || '匿名用户' }}</div>
                <div class="user-id">{{ shortId(row._openid) }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="150">
          <template #default="{ row }">
            <div>{{ fmt(row.createTime || row.createdAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status !== 'approved'"
              size="small"
              type="success"
              :loading="busyId === row._id"
              @click="moderate(row, 'approve')"
            >通过</el-button>
            <el-button
              v-if="row.status !== 'hidden'"
              size="small"
              type="warning"
              :loading="busyId === row._id"
              @click="moderate(row, 'hide')"
            >隐藏</el-button>
            <el-button
              size="small"
              :type="row.isPinned ? 'info' : 'primary'"
              plain
              :loading="busyId === row._id"
              @click="togglePin(row)"
            >
              {{ row.isPinned ? '取消置顶' : '置顶' }}
            </el-button>
            <el-button size="small" type="danger" link :loading="busyId === row._id" @click="del(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { callCloudFunction } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import ErpEmpty from './ErpEmpty.vue'

const FN = 'moderateComment'

const list = ref([])
const loading = ref(false)
const busyId = ref('')
const statusFilter = ref('pending')
const keyword = ref('')
const pendingCount = ref(0)

const STATUS = {
  pending: { text: '待审核', type: 'warning' },
  approved: { text: '已通过', type: 'success' },
  hidden: { text: '已隐藏', type: 'info' }
}
const statusLabel = (s) => STATUS[s]?.text || s || '—'
const statusType = (s) => STATUS[s]?.type || 'info'

function shortId(id) {
  const s = String(id || '')
  return s ? `${s.slice(0, 8)}…` : '—'
}

function fmt(ts) {
  if (!ts) return '—'
  const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN')
}

const filteredList = computed(() => {
  if (!keyword.value) return list.value
  const k = keyword.value.toLowerCase()
  return list.value.filter((c) => (c.content || '').toLowerCase().includes(k))
})

async function callFn(data) {
  const res = await callCloudFunction(FN, data)
  if (!res || res.success === false) {
    throw new Error(res?.msg || '云函数调用失败')
  }
  return res
}

const refresh = async () => {
  loading.value = true
  try {
    const res = await callFn({
      action: 'list',
      listFilter: statusFilter.value,
      limit: 200,
      skip: 0
    })
    list.value = res.list || res.data || []
    pendingCount.value = Number(res.pendingCount) || 0
  } catch (e) {
    list.value = []
    ElMessage.error(e?.message || '加载失败，请刷新重试；持续失败请联系技术' /* 技术排查：请确认已部署 moderateComment 并配置 ADMIN_OPS_KEY */)
  } finally {
    loading.value = false
  }
}

function applyLocalStatus(row, newStatus) {
  const id = row._id
  if (statusFilter.value !== 'all' && statusFilter.value !== newStatus) {
    list.value = list.value.filter((c) => c._id !== id)
  } else {
    list.value = list.value.map((c) => (c._id === id ? { ...c, status: newStatus } : c))
  }
  if (row.status === 'pending' && newStatus !== 'pending' && pendingCount.value > 0) {
    pendingCount.value -= 1
  }
}

const moderate = async (row, action) => {
  if (!row?._id) return
  busyId.value = row._id
  try {
    const res = await callFn({ action, commentId: row._id })
    const newStatus = res.status || (action === 'approve' ? 'approved' : 'hidden')
    applyLocalStatus(row, newStatus)
    ElMessage.success(res.msg || (newStatus === 'approved' ? '已通过' : '已隐藏'))
    // 后台再拉一次，校正角标
    refresh()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    busyId.value = ''
  }
}

const togglePin = async (row) => {
  if (!row?._id) return
  busyId.value = row._id
  try {
    const res = await callFn({ action: 'pin', commentId: row._id })
    const isPinned = typeof res.isPinned === 'boolean' ? res.isPinned : !row.isPinned
    list.value = list.value.map((c) => (c._id === row._id ? { ...c, isPinned } : c))
    ElMessage.success(res.msg || (isPinned ? '已置顶' : '已取消置顶'))
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    busyId.value = ''
  }
}

const del = (row) => {
  if (!row?._id) return
  ElMessageBox.confirm('永久删除此评论？', '删除确认', { type: 'warning' })
    .then(async () => {
      busyId.value = row._id
      try {
        const res = await callFn({ action: 'delete', commentId: row._id })
        list.value = list.value.filter((c) => c._id !== row._id)
        if (row.status === 'pending' && pendingCount.value > 0) pendingCount.value -= 1
        ElMessage.success(res.msg || '已删除')
      } catch (e) {
        ElMessage.error(e?.message || '删除失败')
      } finally {
        busyId.value = ''
      }
    })
    .catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

onMounted(refresh)
</script>

<style scoped>
.comments-container { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }
.filter-bar { display: flex; gap: 12px; align-items: center; margin-bottom: 15px; }
.b { margin-left: 6px; }
.comment-content { color: #333; font-size: 14px; line-height: 1.6; }
.comment-meta { display: flex; gap: 14px; margin-top: 6px; font-size: 12px; color: #999; }
.pin-tag { color: #d4af37; font-weight: bold; }
.target-id { font-family: monospace; font-size: 11px; color: #999; margin-top: 3px; }
.user-info { display: flex; gap: 10px; align-items: center; }
.user-name { font-size: 13px; color: #333; font-weight: 500; }
.user-id { font-family: monospace; font-size: 11px; color: #999; }
</style>
