<template>
  <div class="bookings-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>预约与核销 / BOOKINGS</h2>
        <span class="subtitle">RESERVATION · WAITLIST · CHECK-IN</span>
      </div>
      <div class="header-actions">
        <template v-if="activeTab === 'bookings'">
          <el-input
            v-model="ticketInput"
            placeholder="扫描或输入票号 BOOKING:xxxx"
            style="width: 280px"
            clearable
            prefix-icon="Search"
            @keyup.enter="verifyTicket"
          />
          <el-button type="primary" :icon="Stamp" @click="verifyTicket">核销</el-button>
        </template>
        <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
      </div>
    </div>

    <el-tabs v-model="activeTab" @tab-change="refresh">
      <el-tab-pane label="预约列表" name="bookings" />
      <el-tab-pane label="候补队列" name="waitlist" />
    </el-tabs>

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
      :title="loadError"
      :description="activeTab === 'waitlist'
        ? '请确认 waitlist 集合已 provision；失败时勿与「暂无候补」混淆。'
        : '请确认 bookings 可读；失败时勿与「暂无预约」混淆。'"
    />

    <template v-if="activeTab === 'bookings'">
      <!-- 写通道不可用必须前置告知：否则运营会以为按钮坏了／或以为操作成功了 -->
      <el-alert
        type="warning"
        show-icon
        :closable="false"
        class="booking-write-alert"
        title="本页的确认 / 取消当前不会生效（核销已可用）"
      >
        <template #default>
          <b>核销已接入</b>：走云函数 <code>verifyBooking</code>（与小程序扫码核销同一个函数、
          同一份权限判定与操作人留痕）。<br />
          但<b>确认 / 取消仍不可用</b>：<code>bookings</code> 集合线上为<b>只读</b>
          （<code>write: false</code>），而 <code>updateBooking</code> / <code>cancelBooking</code>
          是<b>顾客本人通道</b>（只认 <code>wxContext.OPENID</code>），ERP 走代理没有 openid，
          接进来也会被拒 —— 这两个需要在服务端补一条 staff 侧分支，属待开发项。
          在此之前，本页的确认/取消会<b>明确报错</b>而不是假装成功；请先在小程序端完成。
        </template>
      </el-alert>

      <div class="filter-bar">
        <el-radio-group v-model="statusFilter" @change="refresh">
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
        <el-table :data="list" v-loading="loading" stripe height="calc(100vh - 420px)">
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
    </template>

    <template v-else>
      <div class="filter-bar">
        <el-radio-group v-model="waitStatusFilter" @change="refresh">
          <el-radio-button label="waiting">候补中</el-radio-button>
          <el-radio-button label="notified">已通知</el-radio-button>
          <el-radio-button label="converted">已转预约</el-radio-button>
          <el-radio-button label="cancelled">已取消</el-radio-button>
          <el-radio-button label="all">全部</el-radio-button>
        </el-radio-group>
      </div>
      <el-card shadow="never">
        <el-table :data="waitlist" v-loading="loading" stripe height="calc(100vh - 360px)" empty-text="暂无候补记录">
          <el-table-column label="排位" width="72" prop="position" />
          <el-table-column label="日期时段" width="180">
            <template #default="{ row }">
              <div>{{ row.date }}</div>
              <div class="time-cell">{{ row.time }}</div>
            </template>
          </el-table-column>
          <el-table-column label="联系人" width="180">
            <template #default="{ row }">
              <div>{{ row.name }}</div>
              <div class="phone-cell">{{ row.phone }}</div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag size="small" :type="waitStatusType(row.status)">{{ waitStatusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="加入时间" width="180">
            <template #default="{ row }">{{ fmt(row.createTime) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="220" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="row.status === 'waiting'"
                size="small"
                type="primary"
                @click="notifyWait(row)"
              >标记已通知</el-button>
              <el-button
                v-if="['waiting', 'notified'].includes(row.status)"
                size="small"
                type="success"
                @click="convertWait(row)"
              >已转预约</el-button>
              <el-button
                v-if="['waiting', 'notified'].includes(row.status)"
                size="small"
                type="danger"
                link
                @click="cancelWait(row)"
              >取消</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty
          v-if="!loading && !waitlist.length"
          description="当前筛选下无候补。小程序约满后用户可加入 waitlist。"
          :image-size="80"
        />
      </el-card>
    </template>

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
import { safeWarn } from '../utils/safeStorage.js'
import { assertWriteApplied } from '../utils/cloudbaseCdnDb.js'
import {
  fetchCollectionLimit,
  fetchCollectionWhere,
  fetchCollectionSorted,
  cdnUpdate,
  cdnDocGet,
  callCloudFunction,
} from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

/**
 * 预约写操作守卫。
 *
 * `bookings` 线上规则是 `{ read: "auth != null", write: false }` —— **ERP 直写必被拒**，
 * 而权威写通道是云函数（`updateBooking` / `verifyBooking` / `cancelBooking`），
 * 它们**不在**前端代理白名单里。也就是说本页所有写按钮当前**没有任何可用通道**。
 *
 * 更危险的是 CloudBase `update` 对不匹配/无权限的文档**返回 `{updated:0}` 而不抛错**
 * （本仓已在 `test:write-layer` 里钉住这个语义），于是原实现会：
 *   · `checkIn` / `confirmBooking` 打出「核销成功 / 已确认」而实际零落库；
 *   · `cancelBooking` 连失败都不提示（错误被确认框的 catch 一起吞掉）。
 * 现在统一走 `assertWriteApplied`：没写进去就抛 `WriteNotAppliedError`，调用方如实报错。
 *
 * 真正的修法是「部署后把预约写通道接进代理」（见审计 C.3），在此之前本页必须**说真话**。
 */
const BOOKING_WRITE_BLOCKED_HINT = '预约写操作当前不可用：bookings 集合为只读，且服务端写通道尚未接入 ERP。请在小程序端处理，或联系技术接入后再用。'

/**
 * 预约**核销**走云函数 `verifyBooking`（经 /api/cloud-fn 代理）。
 *
 * 为什么不能像确认/取消那样直写：`bookings` 线上 `write:false`，直写必被拒。
 * 为什么选 `verifyBooking`：三个候选里只有它接受代理注入的 `adminOpsKey`
 * （`verifyBooking/index.js:244/254`）；`updateBooking`/`cancelBooking` 只认
 * `wxContext.OPENID` 且校验 `booking._openid !== openid`，是**顾客本人通道**，ERP 没有 openid。
 * 它与小程序扫码核销是同一个函数 → 同一份权限判定、同一份状态机、同一份操作人留痕。
 */
async function verifyBookingRemote(row) {
  const res = await callCloudFunction('verifyBooking', { action: 'verify', bookingId: row._id })
  if (!res || res.success === false) {
    const err = new Error(res?.msg || '核销失败')
    err.code = res?.code
    throw err
  }
  return res
}

function writeBooking(id, patch, actionLabel) {
  return cdnUpdate('bookings', id, patch).then((res) => {
    assertWriteApplied('bookings', res, actionLabel)
    return res
  })
}

const activeTab = ref('bookings')
const loading = ref(false)
const loadError = ref('')
const list = ref([])
const waitlist = ref([])
const statusFilter = ref('all')
const waitStatusFilter = ref('waiting')
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
const WAIT_STATUS = {
  waiting: { text: '候补中', type: 'warning' },
  notified: { text: '已通知', type: '' },
  converted: { text: '已转预约', type: 'success' },
  cancelled: { text: '已取消', type: 'info' }
}

const typeLabel = (t) => TYPE_MAP[t] || t || '未知'
const statusLabel = (s) => STATUS_MAP[s]?.text || s
const statusType = (s) => STATUS_MAP[s]?.type || 'info'
const waitStatusLabel = (s) => WAIT_STATUS[s]?.text || s
const waitStatusType = (s) => WAIT_STATUS[s]?.type || 'info'

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
  loadError.value = ''
  try {
    if (activeTab.value === 'waitlist') {
      const where = waitStatusFilter.value !== 'all' ? { status: waitStatusFilter.value } : null
      waitlist.value = await fetchCollectionSorted('waitlist', {
        limit: 200,
        where,
        throwOnError: true,
        sortFn: (a, b) => String(a.date || '').localeCompare(String(b.date || ''))
          || (a.position || 0) - (b.position || 0)
      })
    } else {
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
    }
  } catch (e) {
    console.error(e)
    list.value = []
    waitlist.value = []
    loadError.value = (activeTab.value === 'waitlist' ? '加载候补失败：' : '加载预约失败：') + (e.message || e)
    ElMessage.error(loadError.value)
  } finally {
    loading.value = false
  }
}

const notifyWait = async (row) => {
  try {
    await cdnUpdate('waitlist', row._id, { status: 'notified', notifiedAt: Date.now() })
    ElMessage.success('已标记通知')
    refresh()
  } catch (e) {
    ElMessage.error('操作失败：' + e.message)
  }
}

const convertWait = async (row) => {
  try {
    await cdnUpdate('waitlist', row._id, { status: 'converted', convertedAt: Date.now() })
    ElMessage.success('已标记转预约')
    refresh()
  } catch (e) {
    ElMessage.error('操作失败：' + e.message)
  }
}

const cancelWait = (row) => {
  ElMessageBox.confirm(`取消 ${row.name} 的候补？`, '取消候补', { type: 'warning' }).then(async () => {
    await cdnUpdate('waitlist', row._id, { status: 'cancelled', cancelTime: Date.now() })
    ElMessage.success('已取消')
    refresh()
  }).catch((e) => {
      if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
}

const checkIn = (row) => {
  ElMessageBox.confirm(`确定核销【${row.title}】吗？核销后状态变为已核销。`, '核销确认', {
    confirmButtonText: '确认核销',
    type: 'warning'
  }).then(async () => {
    try {
      await verifyBookingRemote(row)
      ElMessage.success('核销成功')
      refresh()
    } catch (e) {
      // 核销现在走云函数：失败是**真实**失败（权限不足 / 状态机不允许 / 网络），
      // 与「直写被规则拒绝」不是一回事，故不再套用 BOOKING_WRITE_BLOCKED_HINT
      ElMessage.error('核销失败：' + (e?.message || '请重试'))
    }
  }).catch((e) => {
      if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
}

const confirmBooking = async (row) => {
  try {
    await writeBooking(row._id, { status: 'confirmed' }, '确认预约')
    ElMessage.success('已确认')
    refresh()
  } catch (e) {
    ElMessage.error(e?.name === 'WriteNotAppliedError'
      ? `确认未生效：${BOOKING_WRITE_BLOCKED_HINT}`
      : '操作失败：' + (e?.message || '请重试'))
  }
}

const cancelBooking = (row) => {
  ElMessageBox.confirm(`取消【${row.title}】的预约？`, '取消预约', { type: 'warning' }).then(async () => {
    // 写操作单独 try/catch：与「用户点取消」分开，否则真实失败会被当成取消静默吞掉
    try {
      await writeBooking(row._id, {
        status: 'cancelled',
        cancelTime: Date.now()
      }, '取消预约')
      ElMessage.success('已取消')
      refresh()
    } catch (e) {
      ElMessage.error(e?.name === 'WriteNotAppliedError'
        ? `取消失败：${BOOKING_WRITE_BLOCKED_HINT}`
        : '取消失败：' + (e?.message || '请重试'))
    }
  }).catch((e) => {
      if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
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
      // 写操作单独 try/catch（同 cancelBooking：别让真实失败被「用户取消」吞掉）
      try {
        // 与列表里的「核销」同一个云函数通道（见 verifyBookingRemote 的说明）
        await verifyBookingRemote(b)
        ElMessage.success('核销成功')
        ticketInput.value = ''
        detailVisible.value = false
        refresh()
      } catch (e) {
        ElMessage.error('核销失败：' + (e?.message || '请重试'))
      }
    }).catch((e) => {
      if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
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
.booking-write-alert { margin-bottom: 12px; }
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
