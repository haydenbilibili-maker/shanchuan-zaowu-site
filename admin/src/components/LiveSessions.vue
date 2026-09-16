<template>
  <div class="live-sessions">
    <div class="header-section">
      <h2>直播管理</h2>
      <p class="subtitle">
        场次存 <code>live_sessions</code>，互动存 <code>live_messages</code> / <code>live_reminders</code>。
        与小程序主播工作台同源、同云函数 <code>manageLiveSession</code>：开播与挂车在主播端完成，本页做总部监控与兜底（查看、强制结束）。
      </p>
    </div>

    <el-card v-loading="loading">
      <template #header>
        <div class="card-head">
          <span>最近场次（20）</span>
          <div class="head-actions">
            <el-tag v-if="liveCount > 0" type="danger" effect="dark" size="small">{{ liveCount }} 场直播中</el-tag>
            <el-button size="small" :loading="loading" @click="load">刷新</el-button>
          </div>
        </div>
      </template>

      <el-table :data="sessions" size="small" border empty-text="暂无直播场次">
        <el-table-column label="场次" min-width="200">
          <template #default="scope">
            <div class="cell-title">{{ scope.row.title || '未命名场次' }}</div>
            <div class="cell-sub">{{ scope.row.scheduledLabel || '未排期' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="scope">
            <el-tag :type="statusTone(scope.row.status)" size="small" effect="dark">{{ statusLabel(scope.row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="主播" width="120">
          <template #default="scope">{{ scope.row.hostName || '—' }}</template>
        </el-table-column>
        <el-table-column label="挂车 / 在线 / 点赞" width="170">
          <template #default="scope">
            <span class="cell-sub">{{ scope.row.shelfCount || 0 }} 件 · {{ scope.row.viewerCount || 0 }} 人 · {{ scope.row.likeCount || 0 }} 赞</span>
          </template>
        </el-table-column>
        <el-table-column label="开播时间" width="150">
          <template #default="scope">{{ fmtTime(scope.row.startTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="scope">
            <el-button size="small" link type="primary" @click="openDetail(scope.row)">详情</el-button>
            <el-button
              v-if="scope.row.status === 'live'"
              size="small"
              type="danger"
              plain
              @click="forceEnd(scope.row)"
            >强制结束</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer v-model="detailVisible" :title="detail?.title || '场次详情'" size="440px">
      <div v-if="detail" class="detail">
        <div class="row"><span class="k">状态</span><span class="v">{{ statusLabel(detail.status) }}</span></div>
        <div class="row"><span class="k">主播</span><span class="v">{{ detail.hostName || '—' }}</span></div>
        <div class="row"><span class="k">排期</span><span class="v">{{ detail.scheduledLabel || '未排期' }}</span></div>
        <div class="row"><span class="k">开播 / 结束</span><span class="v">{{ fmtTime(detail.startTime) }} → {{ fmtTime(detail.endTime) }}</span></div>
        <div class="row"><span class="k">挂车商品</span><span class="v">{{ detail.shelfCount || 0 }} 件</span></div>
        <div class="row"><span class="k">在线 / 点赞</span><span class="v">{{ detail.viewerCount || 0 }} 人 · {{ detail.likeCount || 0 }} 赞</span></div>
        <div class="row" v-if="detail.notice"><span class="k">公告</span><span class="v">{{ detail.notice }}</span></div>
        <div class="row" v-if="detail.streamName"><span class="k">流名</span><span class="v mono">{{ detail.streamName }}</span></div>
        <div v-if="detail.pullUrl" class="row"><span class="k">拉流</span><span class="v mono small">{{ detail.pullUrl }}</span></div>
      </div>
      <el-empty v-else description="未读到场次详情" :image-size="80" />
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction } from '../cloud'

const FN = 'manageLiveSession'
const loading = ref(false)
const sessions = ref([])
const detail = ref(null)
const detailVisible = ref(false)

const liveCount = computed(() => sessions.value.filter((s) => s.status === 'live').length)

function statusLabel(s) {
  if (s === 'live') return '直播中'
  if (s === 'ended') return '已结束'
  if (s === 'idle') return '待开播'
  return s || '—'
}

function statusTone(s) {
  if (s === 'live') return 'danger'
  if (s === 'ended') return 'info'
  return 'warning'
}

function fmtTime(ts) {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const d = new Date(n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function load() {
  loading.value = true
  try {
    const res = await callCloudFunction(FN, { action: 'listRecent' })
    if (!res || res.success === false) throw new Error((res && res.msg) || '加载失败')
    sessions.value = res.list || []
  } catch (e) {
    sessions.value = []
    ElMessage.warning(e?.message || '直播场次加载失败，请刷新重试；持续失败请联系技术' /* 技术排查：请确认已部署 manageLiveSession */)
  } finally {
    loading.value = false
  }
}

async function openDetail(row) {
  detailVisible.value = true
  detail.value = row
  try {
    const res = await callCloudFunction(FN, { action: 'getSession', sessionId: row._id })
    if (res && res.success !== false && res.session) detail.value = res.session
  } catch (e) {
    console.warn('直播详情加载失败', e?.message)
  }
}

function forceEnd(row) {
  ElMessageBox.confirm(
    `强制结束「${row.title || '该场次'}」？主播端会立即下播，观众看到结束态。`,
    '强制结束直播',
    { confirmButtonText: '强制结束', cancelButtonText: '取消', type: 'warning' },
  )
    .then(async () => {
      try {
        const res = await callCloudFunction(FN, { action: 'forceEnd', sessionId: row._id })
        if (!res || res.success === false) throw new Error((res && res.msg) || '结束失败')
        ElMessage.success('已结束该场直播')
        load()
      } catch (e) {
        ElMessage.error(e?.message || '结束失败')
      }
    })
    .catch(() => {})
}

onMounted(load)
</script>

<style scoped>
.live-sessions { padding: 4px; }
.header-section h2 { margin: 0 0 6px; }
.subtitle { color: #8a8279; font-size: 13px; line-height: 1.6; margin: 0 0 16px; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.head-actions { display: flex; gap: 8px; align-items: center; }
.cell-title { font-size: 13px; }
.cell-sub { font-size: 12px; color: #8a8279; }
.detail .row { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px dashed rgba(255, 255, 255, 0.08); }
.detail .k { width: 84px; color: #8a8279; font-size: 12px; flex-shrink: 0; }
.detail .v { flex: 1; font-size: 13px; word-break: break-all; }
.detail .mono { font-family: ui-monospace, Menlo, monospace; }
.detail .small { font-size: 11px; color: #8a8279; }
</style>
