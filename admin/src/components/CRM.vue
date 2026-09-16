<template>
  <div>
    <div class="header-row">
      <h2>会员 CRM / MEMBERS</h2>
      <div class="header-actions">
        <el-select
          v-model="segmentFilter"
          placeholder="按分群筛选"
          style="width: 200px"
          clearable
          @change="applyFilters"
        >
          <el-option
            v-for="(seg, key) in SEGMENTS"
            :key="key"
            :value="key"
            :label="`${seg.icon} ${seg.name}`"
          />
        </el-select>
        <el-input
          v-model="keyword"
          placeholder="搜索昵称 / openid..."
          prefix-icon="Search"
          style="width: 260px"
          clearable
          @change="applyFilters"
          @clear="applyFilters"
        />
        <el-button type="primary" :icon="MagicStick" @click="$emit('switch-tab', '45')">查看完整画像</el-button>
      </div>
    </div>

    <!-- 快速概览 -->
    <div class="quick-stats">
      <div v-for="seg in topSegments" :key="seg.key" class="qs-pill" @click="segmentFilter = seg.key; applyFilters()">
        <span class="qs-icon" :style="{ color: seg.color }">{{ seg.icon }}</span>
        <span class="qs-name">{{ seg.name }}</span>
        <span class="qs-count">{{ seg.count }}</span>
      </div>
    </div>

    <el-card shadow="never">
      <el-table :data="filteredUsers" v-loading="loading" style="width: 100%" @row-click="openDetail">
        <template #empty>
          <ErpEmpty description="暂无会员" hint="会员在小程序完成注册后会自动同步到这里。" />
        </template>

        <el-table-column label="用户档案" min-width="220">
          <template #default="scope">
            <div class="user-row">
              <el-avatar :src="scope.row.avatarUrl" :size="40" />
              <div class="u-info">
                <div class="u-name">{{ scope.row.nickName || '未授权用户' }}</div>
                <div class="u-id">ID: {{ (scope.row.openid || scope.row._id || '').substring(0, 8) }}...</div>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="分群" width="140">
          <template #default="scope">
            <el-tag
              v-if="scope.row.segmentMeta"
              size="small"
              :style="{ background: scope.row.segmentMeta.color + '20', color: scope.row.segmentMeta.color, border: 'none' }"
            >
              {{ scope.row.segmentMeta.icon }} {{ scope.row.segmentMeta.name }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="RFM" width="90" align="center">
          <template #default="scope">
            <span v-if="scope.row.rfm && scope.row.rfm !== '000'" class="rfm-badge">{{ scope.row.rfm }}</span>
            <span v-else class="rfm-empty">—</span>
          </template>
        </el-table-column>

        <el-table-column label="消费" width="110">
          <template #default="scope">
            <span class="amt">¥{{ formatNum(scope.row.monetary || 0) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="频次" width="70" align="center">
          <template #default="scope">{{ scope.row.frequency || 0 }}</template>
        </el-table-column>

        <el-table-column label="近度" width="80" align="center">
          <template #default="scope">
            <span :class="recencyClass(scope.row.recencyDays)">
              {{ scope.row.recencyDays === Infinity ? '∞' : scope.row.recencyDays + 'd' }}
            </span>
          </template>
        </el-table-column>

        <el-table-column label="兴趣标签" min-width="220">
          <template #default="scope">
            <el-tag
              v-for="t in (scope.row.tags || []).slice(0, 3)"
              :key="t.key"
              size="small"
              :style="{ background: t.color + '20', color: t.color, border: 'none', marginRight: '4px' }"
            >
              {{ t.icon }} {{ t.label }}
            </el-tag>
            <span v-if="scope.row.tags?.length > 3" class="more">+{{ scope.row.tags.length - 3 }}</span>
            <span v-if="!scope.row.tags?.length" class="rfm-empty">—</span>
          </template>
        </el-table-column>

        <el-table-column label="积分" width="100" sortable>
          <template #default="scope">
            <span class="points">{{ scope.row.points || 0 }}</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="160" fixed="right">
          <template #default="scope">
            <el-button size="small" @click.stop="openEdit(scope.row)">调整积分</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="footer-tip">
        <el-icon><InfoFilled /></el-icon>
        共 <b>{{ filteredUsers.length }}</b> / {{ users.length }} 位会员
        · 算法依据 <code>orders</code> + <code>user_behaviors</code>
        · 完整图谱见 <el-link type="primary" @click="$emit('switch-tab', '45')">用户画像看板</el-link>
        <el-tag v-if="dataCapped" type="warning" size="small" style="margin-left: 8px;">
          数据量达上限，RFM 可能偏低
        </el-tag>
      </div>
    </el-card>

    <!-- 用户详情抽屉 -->
    <el-drawer v-model="detailVisible" :title="currentUser?.nickName || '用户详情'" size="560px">
      <div v-if="currentUser" class="detail-panel">
        <div class="d-header">
          <el-avatar :size="64" :src="currentUser.avatarUrl" />
          <div>
            <div class="d-name">{{ currentUser.nickName || '匿名用户' }}</div>
            <div class="d-id">{{ currentUser.openid }}</div>
            <el-tag
              v-if="currentUser.segmentMeta"
              :style="{ background: currentUser.segmentMeta.color + '20', color: currentUser.segmentMeta.color, border: 'none', marginTop: '6px' }"
            >
              {{ currentUser.segmentMeta.icon }} {{ currentUser.segmentMeta.name }}
            </el-tag>
          </div>
        </div>

        <el-descriptions :column="3" border style="margin-top: 16px;">
          <el-descriptions-item label="R 近度">{{ currentUser.R || 0 }}/5</el-descriptions-item>
          <el-descriptions-item label="F 频次">{{ currentUser.F || 0 }}/5</el-descriptions-item>
          <el-descriptions-item label="M 消费">{{ currentUser.M || 0 }}/5</el-descriptions-item>
          <el-descriptions-item label="累计消费" :span="3">¥{{ formatNum(currentUser.monetary || 0) }}</el-descriptions-item>
          <el-descriptions-item label="订单数">{{ currentUser.frequency || 0 }}</el-descriptions-item>
          <el-descriptions-item label="最近消费">{{ currentUser.recencyDays === Infinity ? '从未' : currentUser.recencyDays + ' 天前' }}</el-descriptions-item>
          <el-descriptions-item label="积分">{{ currentUser.points || 0 }}</el-descriptions-item>
          <el-descriptions-item label="注册时间" :span="3">{{ formatDate(currentUser.createTime) }}</el-descriptions-item>
        </el-descriptions>

        <div class="d-section" v-if="currentUser.tags?.length">
          <div class="d-title">兴趣标签（自动派生）</div>
          <el-tag
            v-for="t in currentUser.tags"
            :key="t.key"
            :style="{ background: t.color + '20', color: t.color, border: 'none', marginRight: '6px', marginBottom: '6px' }"
          >
            {{ t.icon }} {{ t.label }}
          </el-tag>
        </div>

        <div class="d-section">
          <div class="d-title">运营建议</div>
          <el-alert
            :title="currentUser.segmentMeta?.desc"
            :type="advisorType(currentUser.segment)"
            :closable="false"
            show-icon
          />
          <div class="suggest-list">
            <el-tag v-for="(a, i) in suggested(currentUser.segment)" :key="i" effect="plain" size="small">{{ a }}</el-tag>
          </div>
        </div>

        <div class="d-section">
          <TalkingScriptCard :profile="currentUser" default-scenario="general" />
        </div>

        <div class="d-actions">
          <el-button @click="openEdit(currentUser)">调整积分</el-button>
          <el-button type="primary" color="#d4af37" @click="$emit('switch-tab', '45')">查看完整画像</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import ErpEmpty from './ErpEmpty.vue'
import { ref, computed, onMounted } from 'vue'
import { Search, MagicStick, InfoFilled } from '@element-plus/icons-vue'
import { callCloudFunction } from '../cloud'
import { loadPortraitSourceData } from '../utils/portraitDataLoad'
import { ElMessage, ElMessageBox } from 'element-plus'
import { buildProfile, summarizeSegments, SEGMENTS } from '../utils/userSegmentation'
import TalkingScriptCard from './TalkingScriptCard.vue'

defineEmits(['switch-tab'])

const users = ref([])           // 增强后的 profile
const loading = ref(false)
const keyword = ref('')
const segmentFilter = ref('')
const detailVisible = ref(false)
const currentUser = ref(null)

const SUGGEST_MAP = {
  champions: ['VIP 专属权益', '邀请新品体验', '社群运营加深绑定'],
  loyal: ['复购满减券', '生日礼券', '老带新分销'],
  potential_loyal: ['第二单折扣', '展示热门 SKU'],
  new_customers: ['新人礼包', '产品教学内容', '首单售后回访'],
  promising: ['限时优惠券', '推送相关品类'],
  need_attention: ['唤醒短信', '回归礼包'],
  about_to_sleep: ['流失预警 EDM', '客服主动联系'],
  at_risk: ['客服 1V1 回访', '高额挽回券'],
  cant_lose: ['店长亲自联系', '专属重磅福利'],
  hibernating: ['年度大促唤醒', '低成本触达'],
  lost: ['品牌焕新通知', '最后一波激活'],
  never_purchased: ['新人首单券', '免费体验活动']
}
const suggested = (s) => SUGGEST_MAP[s] || []

const ADVISOR_TYPE = {
  champions: 'success', loyal: 'success', potential_loyal: 'success',
  new_customers: 'success', promising: 'info', need_attention: 'warning',
  about_to_sleep: 'warning', at_risk: 'error', cant_lose: 'error',
  hibernating: 'info', lost: 'info', never_purchased: 'info'
}
const advisorType = (s) => ADVISOR_TYPE[s] || 'info'

const formatNum = (n) => {
  if (n == null || isNaN(n)) return 0
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return Number(n).toLocaleString()
}
const formatDate = (ts) => {
  if (!ts) return '-'
  const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('zh-CN')
}

// ====== 数据加载 ======
const FETCH_CAP = 1000
const dataCapped = ref(false)

const fetchUsers = async () => {
  loading.value = true
  try {
    const { users: rawUsers, orders, behaviors } = await loadPortraitSourceData({
      userLimit: FETCH_CAP,
      orderLimit: FETCH_CAP,
      behaviorLimit: FETCH_CAP,
    })
    dataCapped.value = rawUsers.length >= FETCH_CAP || orders.length >= FETCH_CAP || behaviors.length >= FETCH_CAP
    users.value = buildProfile({ users: rawUsers, orders, behaviors })
  } catch (e) {
    console.error(e)
    users.value = []
    ElMessage.error('加载失败：' + (e.message || '未知错误'))
  } finally {
    loading.value = false
  }
}

// ====== 筛选 ======
const filteredUsers = computed(() => {
  let arr = users.value
  if (segmentFilter.value) arr = arr.filter(u => u.segment === segmentFilter.value)
  if (keyword.value) {
    const k = keyword.value.toLowerCase()
    arr = arr.filter(u =>
      (u.nickName || '').toLowerCase().includes(k) ||
      (u.openid || '').toLowerCase().includes(k)
    )
  }
  return arr.slice(0, 200)
})

const topSegments = computed(() => {
  const sum = summarizeSegments(users.value)
  return sum.slice(0, 6)
})

const applyFilters = () => { /* computed handles */ }

// ====== 抽屉 ======
const openDetail = (row) => {
  currentUser.value = row
  detailVisible.value = true
}

const recencyClass = (d) => {
  if (d === Infinity || d > 90) return 'rec-cold'
  if (d > 30) return 'rec-warn'
  if (d > 7) return 'rec-ok'
  return 'rec-hot'
}

// ====== 操作 ======
/**
 * 人工调整积分。
 *
 * ⚠️ 原实现是浏览器直写 `users.points`（`cdnDb.collection('users').doc().update`），
 * 而线上 `users` 规则为 `{"read":"auth != null && doc._openid == auth.openid","write":false}`
 * → 写入必被拒；写 `point_records` 的异常还被 `catch { /* 忽略 *\/ }` 吞掉，
 * 于是「余额没变、台账也没记，界面却弹成功」（审计 §0 P0-3）。
 *
 * 现改为调用服务端 `manageMemberCrm.adjustPoints`（与小程序同一实现）：
 * 它写 `bonusPoints`（权威可用积分口径）+ `points`（兼容 ERP 直读）+ 积分台账 + 操作人归属。
 */
const openEdit = (row) => {
  ElMessageBox.prompt('请输入变动积分（正数增加，负数扣除）', '人工调整积分', {
    confirmButtonText: '确认',
    cancelButtonText: '取消',
    inputPattern: /^-?\d+$/,
    inputErrorMessage: '请输入有效的整数'
  }).then(async ({ value }) => {
    const val = parseInt(value)
    if (val === 0) return
    try {
      const res = await callCloudFunction('manageMemberCrm', {
        action: 'adjustPoints',
        userId: row._id,
        amount: val,
        desc: '管理员后台调整（ERP 会员 CRM）'
      })
      if (!res || res.success === false) {
        throw new Error((res && res.msg) || '积分调整失败')
      }
      ElMessage.success(res.msg || '积分调整成功')
      // ⚠️ 不要用 res.points 覆盖列表字段：那是「可用积分」口径（growth + bonus − used），
      // 而 ERP 列表展示的是 users.points —— 两个不同指标（审计 §0 P1「积分口径三分裂」）。
      // 服务端 adjustPoints 对 users.points 同样做了 inc(amount)，所以本地按 +val 更新才与列表一致。
      row.points = (Number(row.points) || 0) + val
      if (currentUser.value && currentUser.value._id === row._id) {
        currentUser.value.points = row.points
      }
      const authoritative = Number(res.points)
      if (Number.isFinite(authoritative)) {
        console.info(
          `[CRM] 积分已调整 ${val}；可用积分（服务端口径）=${authoritative}，` +
          `ERP 列表字段 users.points=${row.points}`
        )
      }
    } catch (e) {
      console.error('积分调整失败', e)
      ElMessage.error(`积分未调整：${e?.message || '未知错误'}`)
    }
  }).catch((e) => {
    if (e !== 'cancel' && e !== 'close') console.error('积分调整输入框异常', e)
  })
}

onMounted(fetchUsers)
</script>

<style scoped>
.header-row { display: flex; justify-content: space-between; margin-bottom: 18px; align-items: center; }
.header-actions { display: flex; gap: 10px; align-items: center; }

.quick-stats { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
.qs-pill { display: flex; align-items: center; gap: 6px; background: #fff; padding: 8px 14px; border-radius: 16px; box-shadow: 0 2px 6px rgba(0,0,0,0.04); cursor: pointer; transition: 0.2s; font-size: 13px; }
.qs-pill:hover { box-shadow: 0 4px 12px rgba(212, 175, 55, 0.2); transform: translateY(-1px); }
.qs-icon { font-size: 16px; }
.qs-name { color: #666; }
.qs-count { color: #333; font-weight: bold; }

.user-row { display: flex; gap: 12px; align-items: center; cursor: pointer; }
.u-info { display: flex; flex-direction: column; gap: 2px; }
.u-name { font-weight: bold; color: #333; }
.u-id { font-size: 11px; color: #999; font-family: monospace; }

.rfm-badge { background: linear-gradient(135deg, #d4af37, #b7950b); color: #fff; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-family: monospace; font-size: 12px; }
.rfm-empty { color: #ccc; font-size: 12px; }

.amt { color: #d4af37; font-weight: bold; font-family: 'Segoe UI', sans-serif; }
.points { color: #d4af37; font-weight: bold; font-size: 16px; }
.more { color: #999; font-size: 11px; margin-left: 4px; }

.rec-hot { color: #27ae60; font-weight: bold; }
.rec-ok { color: #d4af37; }
.rec-warn { color: #e6a23c; }
.rec-cold { color: #f56c6c; }

.footer-tip { margin-top: 16px; padding: 10px 14px; background: #fafafa; border-radius: 8px; color: #666; font-size: 12px; display: flex; align-items: center; gap: 6px; }
.footer-tip code { background: rgba(255,255,255,0.8); padding: 1px 6px; border-radius: 4px; font-family: monospace; }

.detail-panel { padding: 16px 24px; }
.d-header { display: flex; gap: 16px; align-items: center; }
.d-name { font-size: 18px; font-weight: bold; color: #333; }
.d-id { font-family: monospace; font-size: 11px; color: #999; margin-top: 4px; }
.d-section { margin-top: 18px; }
.d-title { font-size: 13px; color: #999; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px dashed #f0f0f0; }
.suggest-list { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.d-actions { margin-top: 24px; display: flex; gap: 10px; justify-content: flex-end; }
</style>
