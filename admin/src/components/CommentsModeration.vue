<template>
  <div class="comments-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>评论审核 / COMMENT MODERATION</h2>
        <span class="subtitle">UGC REVIEW & MODERATION</span>
      </div>
      <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
    </div>

    <div class="filter-bar">
      <el-radio-group v-model="statusFilter" fill="#d4af37" @change="refresh">
        <el-radio-button label="pending">
          待审核
          <el-badge v-if="pendingCount > 0" :value="pendingCount" class="b" type="danger" />
        </el-radio-button>
        <el-radio-button label="approved">已通过</el-radio-button>
        <el-radio-button label="hidden">已隐藏</el-radio-button>
        <el-radio-button label="all">全部</el-radio-button>
      </el-radio-group>
      <el-input v-model="keyword" placeholder="搜索内容关键字..." style="width: 240px" clearable prefix-icon="Search" @change="filterLocal" />
    </div>

    <el-card shadow="never">
      <el-table :data="filteredList" v-loading="loading" stripe height="calc(100vh - 280px)">
        <el-table-column label="评论内容" min-width="320">
          <template #default="{ row }">
            <div class="comment-content">{{ row.content }}</div>
            <div class="comment-meta">
              <span v-if="row.isPinned" class="pin-tag">📌 已置顶</span>
              <span>👍 {{ row.likes || 0 }}</span>
              <span v-if="row.images?.length">🖼️ {{ row.images.length }} 图</span>
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
                <div class="user-id">{{ row._openid?.slice(0, 8) }}...</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="150">
          <template #default="{ row }">
            <div>{{ fmt(row.createTime) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status !== 'approved'" size="small" type="success" @click="moderate(row, 'approved')">通过</el-button>
            <el-button v-if="row.status !== 'hidden'" size="small" type="warning" @click="moderate(row, 'hidden')">隐藏</el-button>
            <el-button size="small" :type="row.isPinned ? 'info' : 'primary'" color="#d4af37" plain @click="togglePin(row)">
              {{ row.isPinned ? '取消置顶' : '置顶' }}
            </el-button>
            <el-button size="small" type="danger" link @click="del(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { fetchCollectionSorted, cdnCount, cdnUpdate, cdnRemove } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

const list = ref([])
const loading = ref(false)
const statusFilter = ref('pending')
const keyword = ref('')
const pendingCount = ref(0)

const STATUS = {
  pending: { text: '待审核', type: 'warning' },
  approved: { text: '已通过', type: 'success' },
  hidden: { text: '已隐藏', type: 'info' }
}
const statusLabel = (s) => STATUS[s]?.text || s
const statusType = (s) => STATUS[s]?.type || 'info'

const fmt = (ts) => {
  if (!ts) return ''
  const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('zh-CN')
}

const filteredList = computed(() => {
  if (!keyword.value) return list.value
  const k = keyword.value.toLowerCase()
  return list.value.filter(c => (c.content || '').toLowerCase().includes(k))
})

const filterLocal = () => {}

const refresh = async () => {
  loading.value = true
  try {
    const where = statusFilter.value !== 'all' ? { status: statusFilter.value } : null
    list.value = await fetchCollectionSorted('comments', {
      limit: 200,
      where,
      sortFn: (a, b) => (b.createTime || 0) - (a.createTime || 0)
    })
    pendingCount.value = await cdnCount('comments', { status: 'pending' })
  } catch (e) {
    list.value = []
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}

const moderate = async (row, newStatus) => {
  try {
    await cdnUpdate('comments', row._id, {
      status: newStatus,
      updatedAt: Date.now()
    })
    ElMessage.success(newStatus === 'approved' ? '已通过' : '已隐藏')
    refresh()
  } catch (e) {
    ElMessage.error('操作失败：' + e.message)
  }
}

const togglePin = async (row) => {
  try {
    await cdnUpdate('comments', row._id, {
      isPinned: !row.isPinned,
      updatedAt: Date.now()
    })
    ElMessage.success(row.isPinned ? '已取消置顶' : '已置顶')
    refresh()
  } catch (e) {
    ElMessage.error('操作失败')
  }
}

const del = (row) => {
  ElMessageBox.confirm('永久删除此评论？', '删除确认', { type: 'warning' }).then(async () => {
    await cdnRemove('comments', row._id)
    ElMessage.success('已删除')
    refresh()
  }).catch(() => {})
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
