<template>
  <div class="support-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>山海有信 / SUPPORT INBOX</h2>
        <span class="subtitle">CUSTOMER TICKETS</span>
      </div>
      <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
    </div>

    <div class="layout">
      <!-- 左侧分类 -->
      <div class="sidebar">
        <div class="seg-title">话题分类</div>
        <div
          v-for="t in topics"
          :key="t.key"
          class="topic-item"
          :class="{ active: topicFilter === t.key }"
          @click="topicFilter = t.key; refresh()"
        >
          <span class="topic-icon">{{ t.icon }}</span>
          <span class="topic-name">{{ t.label }}</span>
          <span class="topic-count" v-if="counters[t.key]">{{ counters[t.key] }}</span>
        </div>
        <el-divider />
        <div class="seg-title">状态</div>
        <div
          v-for="s in statuses"
          :key="s.key"
          class="topic-item"
          :class="{ active: statusFilter === s.key }"
          @click="statusFilter = s.key; refresh()"
        >
          <span class="topic-name">{{ s.label }}</span>
        </div>
      </div>

      <!-- 中间列表 -->
      <div class="list-pane" v-loading="loading">
        <div v-if="!list.length" class="empty">该分类暂无工单</div>
        <div
          v-for="t in list"
          :key="t._id"
          class="ticket-item"
          :class="{ active: current?._id === t._id, unread: t.status === 'pending' }"
          @click="select(t)"
        >
          <div class="ti-row1">
            <span class="ti-topic">{{ t.topicLabel || topicLabel(t.topic) }}</span>
            <el-tag :type="statusType(t.status)" effect="dark" size="small">{{ statusLabel(t.status) }}</el-tag>
          </div>
          <div class="ti-msg">{{ t.message }}</div>
          <div class="ti-meta">
            <span>📞 {{ t.contactPhone || '未填' }}</span>
            <span>{{ fmt(t.createTime) }}</span>
          </div>
        </div>
      </div>

      <!-- 右侧详情 -->
      <div class="detail-pane" v-if="current">
        <div class="detail-header">
          <div>
            <div class="d-topic">{{ current.topicLabel || topicLabel(current.topic) }}</div>
            <div class="d-time">{{ fmt(current.createTime) }}</div>
          </div>
          <div>
            <el-tag :type="statusType(current.status)" effect="dark">{{ statusLabel(current.status) }}</el-tag>
          </div>
        </div>

        <el-descriptions :column="1" border size="small" style="margin-top: 15px;">
          <el-descriptions-item label="用户 OpenID">{{ current._openid?.slice(0, 16) }}...</el-descriptions-item>
          <el-descriptions-item label="联系电话">{{ current.contactPhone || '-' }}</el-descriptions-item>
          <el-descriptions-item v-if="current.orderNo" label="关联订单">{{ current.orderNo }}</el-descriptions-item>
          <el-descriptions-item v-if="current.productName" label="关联商品">{{ current.productName }}</el-descriptions-item>
        </el-descriptions>

        <!-- 客户画像卡 -->
        <div class="customer-profile-card" v-if="customerProfile">
          <div class="cp-head">
            <span class="cp-title">📇 客户档案</span>
            <el-tag
              v-if="customerProfile.segmentMeta"
              size="small"
              :style="{ background: customerProfile.segmentMeta.color + '20', color: customerProfile.segmentMeta.color, border: 'none' }"
            >
              {{ customerProfile.segmentMeta.icon }} {{ customerProfile.segmentMeta.name }}
            </el-tag>
          </div>
          <div class="cp-grid">
            <div class="cp-item"><span class="cp-lbl">RFM</span><span class="cp-val rfm">{{ customerProfile.rfm || '—' }}</span></div>
            <div class="cp-item"><span class="cp-lbl">累计</span><span class="cp-val">¥{{ formatNum(customerProfile.monetary) }}</span></div>
            <div class="cp-item"><span class="cp-lbl">订单</span><span class="cp-val">{{ customerProfile.frequency }} 单</span></div>
            <div class="cp-item"><span class="cp-lbl">最近</span><span class="cp-val">{{ customerProfile.recencyDays === Infinity ? '∞' : customerProfile.recencyDays + 'd' }}</span></div>
          </div>
          <div v-if="customerProfile.tags?.length" class="cp-tags">
            <el-tag
              v-for="t in customerProfile.tags"
              :key="t.key"
              size="small"
              :style="{ background: t.color + '20', color: t.color, border: 'none', marginRight: '4px', marginBottom: '4px' }"
            >
              {{ t.icon }} {{ t.label }}
            </el-tag>
          </div>
        </div>
        <div v-else-if="profileLoading" class="customer-profile-loading">
          <el-icon class="is-loading"><Loading /></el-icon> 加载客户画像…
        </div>

        <div class="msg-block">
          <div class="msg-title">客户留言</div>
          <div class="msg-content">{{ current.message }}</div>
        </div>

        <div class="msg-block" v-if="current.reply">
          <div class="msg-title">已回复</div>
          <div class="msg-content reply">{{ current.reply }}</div>
          <div class="reply-time">{{ fmt(current.replyTime) }}</div>
        </div>

        <!-- AI 沟通锦囊（基于工单 + 用户画像） -->
        <div class="ai-card-wrap" v-if="customerProfile">
          <TalkingScriptCard :profile="customerProfile" default-scenario="support_ticket" />
        </div>

        <div class="actions">
          <el-input
            v-model="replyText"
            type="textarea"
            :rows="4"
            placeholder="输入回复内容（建议引导用户加官方微信群或拨打客服电话）"
          />
          <div class="action-row">
            <el-button type="primary" color="#d4af37" @click="reply">发送回复</el-button>
            <el-button v-if="current.status !== 'resolved'" type="success" @click="resolve">标记已处理</el-button>
            <el-button v-if="current.status !== 'archived'" type="info" plain @click="archive">归档</el-button>
          </div>
        </div>
      </div>
      <div class="detail-pane empty-detail" v-else>请选择工单查看详情</div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Refresh, Loading } from '@element-plus/icons-vue'
import { fetchCollectionSorted, fetchCollectionWhere, cdnUpdate } from '../cloud'
import { loadPortraitForOpenid } from '../utils/portraitDataLoad'
import { ElMessage } from 'element-plus'
import { buildProfile } from '../utils/userSegmentation'
import TalkingScriptCard from './TalkingScriptCard.vue'

const list = ref([])
const loading = ref(false)
const current = ref(null)
const replyText = ref('')
const topicFilter = ref('all')
const statusFilter = ref('pending')
const counters = reactive({})

// 客户画像（从 _openid 拉取并构建）
const customerProfile = ref(null)
const profileLoading = ref(false)

const formatNum = (n) => {
  if (n == null || isNaN(n)) return 0
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return Number(n).toLocaleString()
}

// 选择工单后异步加载该用户的画像（竞态保护：快速切工单不会张冠李戴）
let profileReqSeq = 0
const loadCustomerProfile = async (openid) => {
  const seq = ++profileReqSeq
  if (!openid) {
    customerProfile.value = null
    return
  }
  profileLoading.value = true
  customerProfile.value = null
  try {
    const { users, orders, behaviors } = await loadPortraitForOpenid(openid)
    if (seq !== profileReqSeq) return
    const baseUsers = users.length
      ? users
      : [{ _id: openid, _openid: openid, nickName: '匿名访客', createTime: Date.now() }]
    const profile = buildProfile({ users: baseUsers, orders, behaviors })[0]
    // 单用户样本跑 RFM 分位无意义，隐藏分群徽章只留原始事实
    if (profile) {
      profile.rfm = ''
      profile.segment = null
      profile.segmentMeta = null
      profile.singleSample = true
    }
    customerProfile.value = profile
  } catch (e) {
    console.warn('客户画像加载失败', e)
  } finally {
    if (seq === profileReqSeq) profileLoading.value = false
  }
}

const topics = [
  { key: 'all', label: '全部话题', icon: '📥' },
  { key: 'order', label: '订单咨询', icon: '📦' },
  { key: 'booking', label: '预约改期', icon: '📅' },
  { key: 'product', label: '藏品鉴赏', icon: '🦋' },
  { key: 'custom', label: '标本定制', icon: '🎨' },
  { key: 'pet_memorial', label: '伴宠记忆', icon: '🐾' },
  { key: 'identify', label: '鉴定疑问', icon: '🔍' },
  { key: 'refund', label: '售后退款', icon: '💰' },
  { key: 'other', label: '其他问题', icon: '💬' }
]
const statuses = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待处理' },
  { key: 'replied', label: '已回复' },
  { key: 'resolved', label: '已处理' },
  { key: 'archived', label: '已归档' }
]

const STATUS = {
  pending: { text: '待处理', type: 'warning' },
  replied: { text: '已回复', type: '' },
  resolved: { text: '已处理', type: 'success' },
  archived: { text: '已归档', type: 'info' }
}
const statusLabel = (s) => STATUS[s]?.text || s
const statusType = (s) => STATUS[s]?.type || 'info'
const topicLabel = (t) => topics.find(x => x.key === t)?.label || t

const fmt = (ts) => {
  if (!ts) return ''
  const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const refresh = async () => {
  loading.value = true
  try {
    const where = {}
    if (topicFilter.value !== 'all') where.topic = topicFilter.value
    if (statusFilter.value !== 'all') where.status = statusFilter.value

    list.value = await fetchCollectionSorted('support_tickets', {
      limit: 200,
      where: Object.keys(where).length ? where : null,
      sortFn: (a, b) => (b.createTime || 0) - (a.createTime || 0)
    })

    const pendingRows = await fetchCollectionWhere('support_tickets', { status: 'pending' }, 500)
    const counts = {}
    pendingRows.forEach(t => {
      counts.all = (counts.all || 0) + 1
      counts[t.topic] = (counts[t.topic] || 0) + 1
    })
    Object.keys(counters).forEach(k => delete counters[k])
    Object.assign(counters, counts)
  } catch (e) {
    list.value = []
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}

const select = (t) => {
  current.value = t
  replyText.value = t.reply || ''
  loadCustomerProfile(t._openid)
}

const reply = async () => {
  if (!current.value) return
  if (!replyText.value.trim()) return ElMessage.warning('请输入回复内容')
  try {
    await cdnUpdate('support_tickets', current.value._id, {
      reply: replyText.value.trim(),
      replyTime: Date.now(),
      status: 'replied'
    })
    ElMessage.success('已回复（注意：站内信推送需在云函数侧处理）')
    refresh()
  } catch (e) {
    ElMessage.error('回复失败：' + e.message)
  }
}

const resolve = async () => {
  if (!current.value) return
  await cdnUpdate('support_tickets', current.value._id, {
    status: 'resolved',
    resolveTime: Date.now()
  })
  ElMessage.success('已标记处理')
  refresh()
}

const archive = async () => {
  if (!current.value) return
  await cdnUpdate('support_tickets', current.value._id, { status: 'archived' })
  ElMessage.success('已归档')
  refresh()
}

onMounted(refresh)
</script>

<style scoped>
.support-container { padding: 10px; height: calc(100vh - 60px); display: flex; flex-direction: column; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }

.layout { display: grid; grid-template-columns: 220px 380px 1fr; gap: 16px; flex: 1; min-height: 0; }
.sidebar, .list-pane, .detail-pane { background: #fff; border-radius: 10px; padding: 16px; box-shadow: 0 2px 6px rgba(0,0,0,0.04); overflow-y: auto; }
.seg-title { font-size: 12px; color: #999; margin-bottom: 10px; letter-spacing: 1px; text-transform: uppercase; }
.topic-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.topic-item:hover { background: #f9f9f9; }
.topic-item.active { background: #fdf6ec; color: #d4af37; font-weight: bold; }
.topic-icon { font-size: 14px; }
.topic-name { flex: 1; }
.topic-count { background: #f56c6c; color: #fff; font-size: 11px; padding: 0 6px; border-radius: 8px; min-width: 18px; text-align: center; }

.list-pane { padding: 8px; }
.ticket-item { padding: 12px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; margin-bottom: 6px; }
.ticket-item:hover { background: #fafafa; }
.ticket-item.active { background: #fdf6ec; border-color: #d4af37; }
.ticket-item.unread { border-left: 3px solid #f56c6c; }
.ti-row1 { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.ti-topic { font-weight: bold; color: #333; font-size: 13px; }
.ti-msg { color: #666; font-size: 12px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ti-meta { display: flex; justify-content: space-between; color: #999; font-size: 11px; margin-top: 6px; }

.detail-pane { display: flex; flex-direction: column; }
.empty-detail { display: flex; align-items: center; justify-content: center; color: #ccc; }
.detail-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid #f0f0f0; }
.d-topic { font-size: 18px; font-weight: bold; color: #333; }
.d-time { font-size: 12px; color: #999; margin-top: 4px; }
.msg-block { margin-top: 20px; }
.msg-title { font-size: 12px; color: #999; margin-bottom: 6px; }
.msg-content { background: #fafafa; padding: 14px; border-radius: 8px; font-size: 14px; line-height: 1.7; color: #333; white-space: pre-wrap; }
.msg-content.reply { background: #fdf6ec; border-left: 3px solid #d4af37; }
.reply-time { color: #999; font-size: 12px; margin-top: 4px; text-align: right; }

.actions { margin-top: auto; padding-top: 20px; }
.action-row { display: flex; gap: 10px; margin-top: 10px; justify-content: flex-end; }
.empty { text-align: center; color: #ccc; padding: 60px; }

/* 客户画像卡 */
.customer-profile-card { background: linear-gradient(135deg, #fafafa, #fff); border: 1px solid #f0f0f0; border-radius: 10px; padding: 12px 14px; margin-top: 14px; }
.cp-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.cp-title { font-weight: bold; font-size: 13px; color: #333; }
.cp-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.cp-item { display: flex; flex-direction: column; gap: 2px; }
.cp-lbl { font-size: 11px; color: #999; }
.cp-val { font-size: 14px; font-weight: bold; color: #333; }
.cp-val.rfm { color: #d4af37; font-family: monospace; }
.cp-tags { margin-top: 10px; padding-top: 8px; border-top: 1px dashed #f0f0f0; }
.customer-profile-loading { padding: 12px; color: #999; font-size: 12px; display: flex; gap: 6px; align-items: center; }
.ai-card-wrap { margin-top: 16px; }
</style>
