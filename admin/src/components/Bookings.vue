<template>
  <div class="bookings-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>预约与核销 / BOOKINGS</h2>
        <span class="subtitle">RESERVATION & TICKET CHECK-IN</span>
      </div>
      <div class="header-actions">
        <el-input
          v-model="ticketInput"
          placeholder="扫描或输入票号 BOOKING:xxxx"
          style="width: 280px"
          clearable
          prefix-icon="Search"
          @keyup.enter="verifyTicket"
        />
        <el-button type="primary" color="#d4af37" :icon="Stamp" @click="verifyTicket">核销</el-button>
        <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
      </div>
    </div>

    <div class="filter-bar">
      <el-radio-group v-model="statusFilter" fill="#d4af37" @change="refresh">
        <el-radio-button label="all">全部</el-radio-button>
        <el-radio-button label="confirmed">已确认</el-radio-button>
        <el-radio-button label="pending">待确认</el-radio-button>
        <el-radio-button label="used">已核销</el-radio-button>
        <el-radio-button label="cancelled">已取消</el-radio-button>
      </el-radio-group>
      <el-select v-model="typeFilter" placeholder="预约类型" style="width: 160px" clearable @change="refresh">
        <el-option label="入馆参观" value="museum_visit" />
        <el-option label="手作课程" value="workshop" />
        <el-option label="活动报名" value="activity" />
        <el-option label="定制确认" value="custom_confirm" />
        <el-option label="宠物送检" value="pet_intake" />
      </el-select>
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        format="YYYY-MM-DD"
        value-format="YYYY-MM-DD"
        @change="refresh"
      />
    </div>

    <div class="stats-row">
      <div class="stat-pill">
        <span class="lbl">今日预约</span><span class="val">{{ todayCount }}</span>
      </div>
      <div class="stat-pill warn">
        <span class="lbl">待核销</span><span class="val">{{ pendingCheckIn }}</span>
      </div>
      <div class="stat-pill ok">
        <span class="lbl">已完成</span><span class="val">{{ usedCount }}</span>
      </div>
    </div>

    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" stripe height="calc(100vh - 360px)">
        <el-table-column label="票号" width="160">
          <template #default="{ row }">
            <div class="ticket-no">{{ row.ticketCode || row._id.slice(0, 8) }}</div>
            <div class="ticket-type">{{ typeLabel(row.type) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="活动主题" min-width="180">
          <template #default="{ row }">
            <div class="b-title">{{ row.title }}</div>
            <div class="b-store" v-if="row.storeName">📍 {{ row.storeName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">
            <div>{{ row.date }} <span v-if="row.week">({{ row.week }})</span></div>
            <div class="time-cell">{{ row.time || '全天' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="联系人" width="180">
          <template #default="{ row }">
            <div>{{ row.name }}</div>
            <div class="phone-cell">📞 {{ row.phone }}</div>
          </template>
        </el-table-column>
        <el-table-column label="人数" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ row.people || 1 }}人</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="100">
          <template #default="{ row }">
            <span class="price">¥{{ row.price || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="dark" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'confirmed'"
              size="small"
              type="primary"
              color="#d4af37"
              @click="checkIn(row)"
            >核销</el-button>
            <el-button
              v-if="row.status === 'pending'"
              size="small"
              type="success"
              @click="confirmBooking(row)"
            >确认</el-button>
            <el-button
              v-if="['pending', 'confirmed'].includes(row.status)"
              size="small"
              type="danger"
              link
              @click="cancelBooking(row)"
            >取消</el-button>
            <el-button size="small" link @click="viewDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="detailVisible" title="预约详情" width="600px">
      <el-descriptions :column="2" border v-if="currentBooking">
        <el-descriptions-item label="票号">{{ currentBooking.ticketCode }}</el-descriptions-item>
        <el-descriptions-item label="类型">{{ typeLabel(currentBooking.type) }}</el-descriptions-item>
        <el-descriptions-item label="主题" :span="2">{{ currentBooking.title }}</el-descriptions-item>
        <el-descriptions-item label="日期">{{ currentBooking.date }}</el-descriptions-item>
        <el-descriptions-item label="时段">{{ currentBooking.time || '全天' }}</el-descriptions-item>
        <el-descriptions-item label="人数">{{ currentBooking.people }}</el-descriptions-item>
        <el-descriptions-item label="金额">¥{{ currentBooking.price }}</el-descriptions-item>
        <el-descriptions-item label="姓名">{{ currentBooking.name }}</el-descriptions-item>
        <el-descriptions-item label="电话">{{ currentBooking.phone }}</el-descriptions-item>
        <el-descriptions-item label="门店" :span="2">{{ currentBooking.storeName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="statusType(currentBooking.status)">{{ statusLabel(currentBooking.status) }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ fmt(currentBooking.createTime) }}</el-descriptions-item>
        <el-descriptions-item v-if="currentBooking.customDraftId" label="关联定制" :span="2">
          {{ currentBooking.customDraftId }}
        </el-descriptions-item>
        <el-descriptions-item v-if="currentBooking.petMemorialOrderId" label="关联宠物订单" :span="2">
          {{ currentBooking.petMemorialOrderId }}
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Stamp, Refresh } from '@element-plus/icons-vue'
import {
  fetchCollectionLimit,
  fetchCollectionWhere,
  cdnUpdate,
  cdnDocGet,
} from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

const loading = ref(false)
const list = ref([])
const statusFilter = ref('all')
const typeFilter = ref('')
const dateRange = ref([])
const ticketInput = ref('')
const detailVisible = ref(false)
const currentBooking = ref(null)

const TYPE_MAP = {
  museum_visit: '入馆参观',
  workshop: '手作课程',
  activity: '活动报名',
  custom_confirm: '定制确认',
  pet_intake: '宠物送检'
}
const STATUS_MAP = {
  pending: { text: '待确认', type: 'warning' },
  confirmed: { text: '已确认', type: '' },
  used: { text: '已核销', type: 'success' },
  cancelled: { text: '已取消', type: 'info' }
}

const typeLabel = (t) => TYPE_MAP[t] || t || '未知'
const statusLabel = (s) => STATUS_MAP[s]?.text || s
const statusType = (s) => STATUS_MAP[s]?.type || 'info'

const todayCount = computed(() => {
  const today = new Date().toISOString().split('T')[0]
  return list.value.filter(b => b.date === today).length
})
const pendingCheckIn = computed(() => list.value.filter(b => b.status === 'confirmed').length)
const usedCount = computed(() => list.value.filter(b => b.status === 'used').length)

const fmt = (ts) => {
  if (!ts) return ''
  const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('zh-CN')
}

const refresh = async () => {
  loading.value = true
  try {
    const where = {}
    if (statusFilter.value !== 'all') where.status = statusFilter.value
    if (typeFilter.value) where.type = typeFilter.value

    let rows = Object.keys(where).length
      ? await fetchCollectionWhere('bookings', where, 500)
      : await fetchCollectionLimit('bookings', { limit: 500 })

    if (dateRange.value && dateRange.value.length === 2) {
      const [start, end] = dateRange.value
      rows = rows.filter(b => b.date >= start && b.date <= end)
    }

    rows.sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
    list.value = rows.slice(0, 100)
  } catch (e) {
    console.error(e)
    list.value = []
    ElMessage.error('加载预约失败')
  } finally {
    loading.value = false
  }
}

const checkIn = (row) => {
  ElMessageBox.confirm(`确定核销【${row.title}】吗？核销后状态变为已核销。`, '核销确认', {
    confirmButtonText: '确认核销',
    type: 'warning'
  }).then(async () => {
    try {
      await cdnUpdate('bookings', row._id, {
        status: 'used',
        usedTime: Date.now()
      })
      ElMessage.success('核销成功')
      refresh()
    } catch (e) {
      ElMessage.error('核销失败：' + e.message)
    }
  }).catch(() => {})
}

const confirmBooking = async (row) => {
  try {
    await cdnUpdate('bookings', row._id, { status: 'confirmed' })
    ElMessage.success('已确认')
    refresh()
  } catch (e) {
    ElMessage.error('操作失败')
  }
}

const cancelBooking = (row) => {
  ElMessageBox.confirm(`取消【${row.title}】的预约？`, '取消预约', { type: 'warning' }).then(async () => {
    await cdnUpdate('bookings', row._id, {
      status: 'cancelled',
      cancelTime: Date.now()
    })
    ElMessage.success('已取消')
    refresh()
  }).catch(() => {})
}

const verifyTicket = async () => {
  const input = ticketInput.value.trim()
  if (!input) return ElMessage.warning('请输入票号')
  // 支持 BOOKING:xxxx:openid 格式
  let code = input
  if (input.startsWith('BOOKING:')) {
    code = input.split(':')[1] || ''
  }
  loading.value = true
  try {
    const matches = await fetchCollectionWhere('bookings', { ticketCode: code }, 1)
    const b = matches[0]
    if (!b) {
      ElMessage.error('未找到该票号')
      return
    }
    if (b.status === 'used') {
      ElMessageBox.alert(`该票已于 ${fmt(b.usedTime)} 核销过`, '提示', { type: 'warning' })
      return
    }
    if (b.status === 'cancelled') {
      ElMessage.error('该票已取消，无法核销')
      return
    }
    currentBooking.value = b
    detailVisible.value = true
    ElMessageBox.confirm(`找到预约：${b.title}\n联系人：${b.name} (${b.phone})\n确定核销？`, '票号核销', {
      confirmButtonText: '确认核销',
      type: 'success'
    }).then(async () => {
      await cdnUpdate('bookings', b._id, {
        status: 'used',
        usedTime: Date.now()
      })
      ElMessage.success('核销成功')
      ticketInput.value = ''
      detailVisible.value = false
      refresh()
    }).catch(() => {})
  } catch (e) {
    ElMessage.error('查询失败：' + e.message)
  } finally {
    loading.value = false
  }
}

const viewDetail = (row) => {
  currentBooking.value = row
  detailVisible.value = true
}

onMounted(refresh)
</script>

<style scoped>
.bookings-container { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }
.header-actions { display: flex; gap: 10px; align-items: center; }
.filter-bar { display: flex; gap: 12px; align-items: center; margin-bottom: 15px; flex-wrap: wrap; }
.stats-row { display: flex; gap: 12px; margin-bottom: 15px; }
.stat-pill { background: #fff; padding: 10px 18px; border-radius: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); display: flex; gap: 10px; align-items: baseline; }
.stat-pill .lbl { font-size: 12px; color: #999; }
.stat-pill .val { font-size: 20px; font-weight: 800; color: #333; }
.stat-pill.warn .val { color: #e6a23c; }
.stat-pill.ok .val { color: #27ae60; }

.ticket-no { font-family: 'Segoe UI', monospace; font-weight: bold; font-size: 13px; color: #333; }
.ticket-type { font-size: 11px; color: #d4af37; margin-top: 2px; }
.b-title { font-weight: bold; color: #333; }
.b-store { font-size: 12px; color: #999; margin-top: 3px; }
.time-cell { color: #666; font-size: 12px; margin-top: 2px; }
.phone-cell { color: #999; font-size: 12px; margin-top: 2px; }
.price { color: #d4af37; font-weight: bold; }
</style>
