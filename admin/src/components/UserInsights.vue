<template>
  <div class="ui-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>用户画像与分群 / USER INSIGHTS</h2>
        <span class="subtitle">RFM · COHORT · AUTO-TAGS</span>
      </div>
      <div class="header-actions">
        <el-button :icon="Download" @click="exportCSV">导出 CSV</el-button>
        <el-button :icon="Refresh" circle @click="refresh" :loading="loading" title="刷新" />
      </div>
    </div>

    <!-- 概览 KPI -->
    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
      :title="loadError"
      description="请确认 users / orders / user_behaviors 可读；失败时勿与「暂无会员」混淆。"
    />
    <el-alert
      v-else-if="!loading && !totalUsers"
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
      title="暂无会员画像数据"
      description="请确认云库 users 集合有数据；orders / user_behaviors 用于 RFM 与标签。"
    />
    <div class="kpi-strip">
      <div class="kpi-card">
        <div class="kpi-top"><span class="lbl">活跃用户</span><span class="ico">👥</span></div>
        <div class="kpi-val">{{ formatNum(totalUsers) }}</div>
        <div class="kpi-sub">已注册会员总数</div>
      </div>
      <div class="kpi-card hot">
        <div class="kpi-top"><span class="lbl">付费用户</span><span class="ico">💳</span></div>
        <div class="kpi-val">{{ formatNum(paidUsers) }}</div>
        <div class="kpi-sub">付费率 {{ paidRate }}%</div>
      </div>
      <div class="kpi-card gold">
        <div class="kpi-top"><span class="lbl">客单价</span><span class="ico">💰</span></div>
        <div class="kpi-val">¥{{ formatNum(avgMonetary) }}</div>
        <div class="kpi-sub">付费用户平均</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><span class="lbl">复购率</span><span class="ico">🔄</span></div>
        <div class="kpi-val">{{ repurchaseRate }}%</div>
        <div class="kpi-sub">≥2 单占比</div>
      </div>
      <div class="kpi-card warn">
        <div class="kpi-top"><span class="lbl">高流失风险</span><span class="ico">🚨</span></div>
        <div class="kpi-val">{{ formatNum(atRiskCount) }}</div>
        <div class="kpi-sub">建议召回</div>
      </div>
    </div>

    <!-- 11 分群卡片 -->
    <el-card shadow="never" class="segments-card">
      <template #header>
        <div class="card-header">
          <span>🎯 11 分群矩阵</span>
          <span class="hint">基于 R/F/M 三维分位评分，点击卡片查看用户列表</span>
        </div>
      </template>
      <div class="segments-grid" v-loading="loading">
        <div
          v-for="seg in segmentSummary"
          :key="seg.key"
          class="segment-card"
          :class="{ active: currentSegment === seg.key }"
          :style="{ borderTopColor: seg.color }"
          @click="selectSegment(seg.key)"
        >
          <div class="seg-head">
            <span class="seg-icon" :style="{ background: seg.color + '20', color: seg.color }">{{ seg.icon }}</span>
            <div class="seg-name">{{ seg.name }}</div>
          </div>
          <div class="seg-count">
            <span class="big-num">{{ seg.count }}</span>
            <span class="seg-pct">{{ totalUsers > 0 ? Math.round(seg.count / totalUsers * 100) : 0 }}%</span>
          </div>
          <div class="seg-meta">
            <span>客单 ¥{{ formatNum(seg.avgMonetary) }}</span>
            <span>频次 {{ seg.avgFrequency }}</span>
          </div>
          <div class="seg-desc">{{ seg.desc }}</div>
        </div>
      </div>
    </el-card>

    <!-- RFM 热力矩阵 + 留存矩阵 -->
    <div class="matrix-row">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span>🔥 R × F 热力矩阵</span>
            <el-radio-group v-model="matrixDim" size="small">
              <el-radio-button label="rf">R × F</el-radio-button>
              <el-radio-button label="rm">R × M</el-radio-button>
              <el-radio-button label="fm">F × M</el-radio-button>
            </el-radio-group>
          </div>
        </template>
        <div class="heatmap">
          <div class="hm-y-label">{{ matrixYLabel }} (高 → 低)</div>
          <div class="hm-grid">
            <div v-for="y in [5,4,3,2,1]" :key="'r'+y" class="hm-row">
              <div class="hm-y">{{ y }}</div>
              <div
                v-for="x in [1,2,3,4,5]"
                :key="x"
                class="hm-cell"
                :style="{ background: heatmapColor(heatmapValue(y, x)), color: heatmapValue(y, x) > maxHeatValue * 0.4 ? '#fff' : '#333' }"
                :title="`${matrixYLabel}=${y}, ${matrixXLabel}=${x}: ${heatmapValue(y, x)} 人`"
              >
                {{ heatmapValue(y, x) }}
              </div>
            </div>
            <div class="hm-row hm-axis-row">
              <div class="hm-y"></div>
              <div v-for="x in [1,2,3,4,5]" :key="'x'+x" class="hm-x">{{ x }}</div>
            </div>
          </div>
          <div class="hm-x-label">{{ matrixXLabel }} (低 → 高)</div>
        </div>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span>📊 留存矩阵 (周 cohort)</span>
            <span class="hint">每行：当周新增 cohort</span>
          </div>
        </template>
        <div class="cohort-table">
          <table>
            <thead>
              <tr>
                <th>注册周</th>
                <th>规模</th>
                <th v-for="(_, i) in 8" :key="i">W{{ i }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in retentionCohorts" :key="c.cohortWeek">
                <td>{{ c.cohortWeek }}</td>
                <td class="td-size">{{ c.cohortSize }}</td>
                <td
                  v-for="(v, i) in c.retention"
                  :key="i"
                  :style="{ background: retentionColor(v), color: v > 50 ? '#fff' : '#333' }"
                >{{ v }}%</td>
              </tr>
              <tr v-if="!retentionCohorts.length">
                <td colspan="10" style="text-align:center; padding: 40px; color: #ccc;">暂无 cohort 数据</td>
              </tr>
            </tbody>
          </table>
        </div>
      </el-card>
    </div>

    <!-- 标签云 + Top 用户 -->
    <div class="bottom-row">
      <el-card shadow="never">
        <template #header><div class="card-header"><span>🏷️ 用户兴趣标签云</span></div></template>
        <div class="tag-cloud">
          <span
            v-for="t in tagCloud"
            :key="t.key"
            class="tag-bubble"
            :style="{
              background: t.color + '20',
              color: t.color,
              fontSize: Math.min(24, 12 + t.count / 5) + 'px',
              padding: '6px ' + (10 + t.count / 8) + 'px'
            }"
          >
            {{ t.icon }} {{ t.label }} · {{ t.count }}
          </span>
          <div v-if="!tagCloud.length" class="empty">暂无标签</div>
        </div>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span>💎 TOP 20 高价值用户</span>
            <el-radio-group v-model="topSortBy" size="small">
              <el-radio-button label="monetary">按消费</el-radio-button>
              <el-radio-button label="frequency">按频次</el-radio-button>
              <el-radio-button label="recency">按近度</el-radio-button>
            </el-radio-group>
          </div>
        </template>
        <el-table :data="topUsers" size="small" max-height="380">
          <el-table-column label="#" width="48" type="index" />
          <el-table-column label="用户" min-width="160">
            <template #default="{ row }">
              <div class="u-cell">
                <el-avatar :size="28" :src="row.avatarUrl" />
                <div>
                  <div class="u-name">{{ row.nickName || '匿名' }}</div>
                  <div class="u-id">{{ (row.openid || '').slice(0, 8) }}...</div>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="分群" width="120">
            <template #default="{ row }">
              <el-tag size="small" :style="{ background: row.segmentMeta.color + '20', color: row.segmentMeta.color, border: 'none' }">
                {{ row.segmentMeta.icon }} {{ row.segmentMeta.name }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="RFM" width="80" align="center">
            <template #default="{ row }">
              <span class="rfm-badge">{{ row.rfm }}</span>
            </template>
          </el-table-column>
          <el-table-column label="消费" width="110">
            <template #default="{ row }">¥{{ formatNum(row.monetary) }}</template>
          </el-table-column>
          <el-table-column label="频次" width="80" align="center">
            <template #default="{ row }">{{ row.frequency }}</template>
          </el-table-column>
          <el-table-column label="最近(天)" width="100" align="center">
            <template #default="{ row }">
              <span :class="recencyClass(row.recencyDays)">
                {{ row.recencyDays === Infinity ? '∞' : row.recencyDays }}
              </span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <!-- 分群用户列表抽屉 -->
    <el-drawer v-model="segmentDrawer" :title="currentSegmentMeta ? `${currentSegmentMeta.icon} ${currentSegmentMeta.name} (${segmentUsers.length} 人)` : ''" size="780px">
      <div v-if="currentSegmentMeta" class="segment-drawer">
        <el-alert :title="currentSegmentMeta.desc" type="info" :closable="false" show-icon />
        <div class="action-bar">
          <span>建议运营动作：</span>
          <el-tag v-for="(a, i) in suggestedActions" :key="i" size="small" effect="plain">{{ a }}</el-tag>
        </div>
        <el-table :data="segmentUsers" size="small" max-height="600">
          <el-table-column label="#" width="48" type="index" />
          <el-table-column label="用户" min-width="160">
            <template #default="{ row }">
              <div class="u-cell">
                <el-avatar :size="28" :src="row.avatarUrl" />
                <div>
                  <div class="u-name">{{ row.nickName || '匿名' }}</div>
                  <div class="u-id">{{ (row.openid || '').slice(0, 12) }}</div>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="RFM" width="80" align="center">
            <template #default="{ row }">
              <span class="rfm-badge">{{ row.rfm }}</span>
            </template>
          </el-table-column>
          <el-table-column label="消费" width="100">
            <template #default="{ row }">¥{{ formatNum(row.monetary) }}</template>
          </el-table-column>
          <el-table-column label="频次" width="60" align="center">
            <template #default="{ row }">{{ row.frequency }}</template>
          </el-table-column>
          <el-table-column label="近度" width="80" align="center">
            <template #default="{ row }">
              <span :class="recencyClass(row.recencyDays)">{{ row.recencyDays === Infinity ? '∞' : row.recencyDays }}d</span>
            </template>
          </el-table-column>
          <el-table-column label="标签" min-width="220">
            <template #default="{ row }">
              <el-tag
                v-for="t in (row.tags || [])"
                :key="t.key"
                size="small"
                :style="{ background: t.color + '20', color: t.color, border: 'none', marginRight: '4px' }"
              >
                {{ t.icon }} {{ t.label }}
              </el-tag>
              <span v-if="!row.tags?.length" style="color: #ccc; font-size: 11px;">—</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-drawer>

    <div class="data-source-tip">
      <el-icon><InfoFilled /></el-icon>
      <span>
        画像数据：<code>users</code> + <code>orders</code> + <code>user_behaviors</code>。
        样本规模 <b>{{ totalUsers }}</b> 人 · 处理事件 <b>{{ formatNum(eventCount) }}</b> 条 ·
        RFM 采用分位法切分，分群命名参考 Marketo / Klaviyo 标准。
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Refresh, Download, InfoFilled } from '@element-plus/icons-vue'
import { loadPortraitSourceData } from '../utils/portraitDataLoad'
import { ElMessage } from 'element-plus'
import {
  buildProfile, summarizeSegments, computeRetentionCohort, SEGMENTS
} from '../utils/userSegmentation'

const loading = ref(false)
const loadError = ref('')
const profiles = ref([])
const retentionCohorts = ref([])
const eventCount = ref(0)

const matrixDim = ref('rf')
const topSortBy = ref('monetary')
const currentSegment = ref('')
const segmentDrawer = ref(false)

const formatNum = (n) => {
  if (n == null || isNaN(n)) return 0
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return Number(n).toLocaleString()
}

// ========= 数据加载 =========
const refresh = async () => {
  loading.value = true
  loadError.value = ''
  try {
    let { users, orders, behaviors } = await loadPortraitSourceData({
      userLimit: 1000,
      orderLimit: 1000,
      behaviorLimit: 1000,
    })

    if (!users.length) {
      profiles.value = []
      retentionCohorts.value = []
      eventCount.value = behaviors.length
      ElMessage.info('云库暂无会员数据，画像为空态')
      return
    }

    eventCount.value = behaviors.length
    profiles.value = buildProfile({ users, orders, behaviors })
    retentionCohorts.value = computeRetentionCohort(users, behaviors, { weeks: 8 })
  } catch (e) {
    console.error(e)
    profiles.value = []
    retentionCohorts.value = []
    eventCount.value = 0
    loadError.value = '加载失败：' + (e.message || '未知错误')
    ElMessage.error(loadError.value)
  } finally {
    loading.value = false
  }
}

// ========= 派生指标 =========
const totalUsers = computed(() => profiles.value.length)
const paidUsers = computed(() => profiles.value.filter(p => p.frequency > 0).length)
const paidRate = computed(() => totalUsers.value > 0 ? Math.round(paidUsers.value / totalUsers.value * 100) : 0)
const avgMonetary = computed(() => {
  if (!paidUsers.value) return 0
  const total = profiles.value.reduce((s, p) => s + (p.monetary || 0), 0)
  return Math.round(total / paidUsers.value)
})
const repurchaseRate = computed(() => {
  if (!paidUsers.value) return 0
  const repurchaseUsers = profiles.value.filter(p => p.frequency >= 2).length
  return Math.round(repurchaseUsers / paidUsers.value * 100)
})
const segmentSummary = computed(() => summarizeSegments(profiles.value))
const atRiskCount = computed(() =>
  profiles.value.filter(p => ['at_risk', 'cant_lose', 'about_to_sleep'].includes(p.segment)).length
)

// ========= 热力矩阵 =========
const matrixAxes = computed(() => {
  if (matrixDim.value === 'rf') return { y: 'R', x: 'F', yLabel: 'Recency (近度)', xLabel: 'Frequency (频次)' }
  if (matrixDim.value === 'rm') return { y: 'R', x: 'M', yLabel: 'Recency (近度)', xLabel: 'Monetary (消费)' }
  return { y: 'F', x: 'M', yLabel: 'Frequency (频次)', xLabel: 'Monetary (消费)' }
})
const matrixYLabel = computed(() => matrixAxes.value.yLabel)
const matrixXLabel = computed(() => matrixAxes.value.xLabel)

const heatmapMatrix = computed(() => {
  const m = {}
  const { y, x } = matrixAxes.value
  profiles.value.forEach(p => {
    if (p.frequency === 0) return
    const key = `${p[y]}_${p[x]}`
    m[key] = (m[key] || 0) + 1
  })
  return m
})
const heatmapValue = (y, x) => heatmapMatrix.value[`${y}_${x}`] || 0
const maxHeatValue = computed(() => {
  return Math.max(1, ...Object.values(heatmapMatrix.value))
})
const heatmapColor = (v) => {
  const t = Math.min(1, v / maxHeatValue.value)
  const r = Math.round(255 - (255 - 212) * t)
  const g = Math.round(255 - (255 - 175) * t)
  const b = Math.round(255 - (255 - 55) * t)
  return `rgb(${r},${g},${b})`
}
const retentionColor = (v) => {
  if (v <= 0) return '#fafafa'
  const t = Math.min(1, v / 60)
  const r = Math.round(255 - (255 - 39) * t)
  const g = Math.round(255 - (255 - 174) * t)
  const b = Math.round(255 - (255 - 96) * t)
  return `rgb(${r},${g},${b})`
}

// ========= Top 用户 =========
const topUsers = computed(() => {
  const sorted = [...profiles.value]
  if (topSortBy.value === 'monetary') sorted.sort((a, b) => b.monetary - a.monetary)
  else if (topSortBy.value === 'frequency') sorted.sort((a, b) => b.frequency - a.frequency)
  else sorted.sort((a, b) => (a.recencyDays === Infinity ? 99999 : a.recencyDays) - (b.recencyDays === Infinity ? 99999 : b.recencyDays))
  return sorted.slice(0, 20)
})

// ========= 标签云 =========
const tagCloud = computed(() => {
  const map = {}
  profiles.value.forEach(p => {
    (p.tags || []).forEach(t => {
      if (!map[t.key]) map[t.key] = { ...t, count: 0 }
      map[t.key].count++
    })
  })
  return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 18)
})

const recencyClass = (d) => {
  if (d === Infinity || d > 90) return 'rec-cold'
  if (d > 30) return 'rec-warn'
  if (d > 7) return 'rec-ok'
  return 'rec-hot'
}

// ========= 分群抽屉 =========
const segmentUsers = ref([])
const currentSegmentMeta = computed(() => SEGMENTS[currentSegment.value])
const suggestedActions = computed(() => SUGGEST_MAP[currentSegment.value] || ['—'])

const SUGGEST_MAP = {
  champions: ['VIP 专属权益', '邀请新品体验', '社群运营加深绑定'],
  loyal: ['复购满减券', '生日礼遇', '老带新分销'],
  potential_loyal: ['第二单折扣', '展示热门 SKU', '订阅邮件营销'],
  new_customers: ['新人礼包', '产品教学内容', '首单售后回访'],
  promising: ['限时优惠券', '推送相关品类', '社群引导'],
  need_attention: ['唤醒短信', '回归礼包', '小额优惠'],
  about_to_sleep: ['流失预警 EDM', '客服主动联系', '专属优惠激活'],
  at_risk: ['客服 1V1 回访', '高额挽回券', '电话回访'],
  cant_lose: ['店长亲自联系', '专属重磅福利', '客户体验调研'],
  hibernating: ['年度大促唤醒', '会员日提醒', '低频低成本触达'],
  lost: ['品牌焕新通知', '最后一波激活券', '可考虑放弃'],
  never_purchased: ['新人首单券', '免费体验活动', '注册赠分']
}

const selectSegment = (key) => {
  currentSegment.value = key
  segmentUsers.value = profiles.value
    .filter(p => p.segment === key)
    .sort((a, b) => b.monetary - a.monetary)
  segmentDrawer.value = true
}

// ========= 导出 =========
const exportCSV = () => {
  const rows = [['openid', 'nickName', 'segment', 'R', 'F', 'M', 'recencyDays', 'frequency', 'monetary', 'tags']]
  profiles.value.forEach(p => {
    rows.push([
      p.openid, p.nickName || '', p.segmentMeta.name,
      p.R, p.F, p.M,
      p.recencyDays === Infinity ? '' : p.recencyDays,
      p.frequency, p.monetary,
      (p.tags || []).map(t => t.label).join('|')
    ])
  })
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `user-profiles-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  ElMessage.success(`已导出 ${profiles.value.length} 条用户画像`)
}

onMounted(refresh)
</script>

<style scoped>
.ui-container { padding: 16px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }
.header-actions { display: flex; gap: 10px; align-items: center; }

/* KPI */
.kpi-strip { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin-bottom: 20px; }
.kpi-card { background: #fff; padding: 16px 18px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); border-top: 3px solid #e4e7ed; }
.kpi-card.hot { border-top-color: #d4af37; }
.kpi-card.gold { border-top-color: #d4af37; background: linear-gradient(145deg, #d4af37, #b7950b); color: #fff; }
.kpi-card.warn { border-top-color: #f56c6c; }
.kpi-top { display: flex; justify-content: space-between; align-items: center; font-size: 12px; opacity: 0.7; }
.kpi-val { font-size: 26px; font-weight: 800; margin-top: 6px; }
.kpi-sub { font-size: 11px; color: #999; margin-top: 4px; }
.kpi-card.gold .kpi-sub { color: rgba(255,255,255,0.7); }

/* 分群卡 */
.segments-card { margin-bottom: 20px; }
.segments-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
.segment-card {
  background: #fff; padding: 14px 16px; border-radius: 10px; border: 1px solid #f0f0f0; border-top-width: 3px;
  cursor: pointer; transition: 0.2s;
}
.segment-card:hover { box-shadow: 0 6px 16px rgba(0,0,0,0.08); transform: translateY(-2px); }
.segment-card.active { box-shadow: 0 0 0 2px #d4af37; }
.seg-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.seg-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
.seg-name { font-weight: bold; font-size: 14px; color: #333; }
.seg-count { display: flex; align-items: baseline; gap: 6px; margin: 4px 0; }
.big-num { font-size: 24px; font-weight: 800; color: #333; }
.seg-pct { font-size: 12px; color: #d4af37; font-weight: 600; }
.seg-meta { display: flex; gap: 12px; font-size: 11px; color: #666; margin-bottom: 6px; }
.seg-desc { font-size: 11px; color: #999; line-height: 1.5; min-height: 32px; }

/* 矩阵 */
.matrix-row { display: grid; grid-template-columns: 1fr 1.4fr; gap: 16px; margin-bottom: 20px; }
.heatmap { padding: 10px; }
.hm-y-label { font-size: 11px; color: #999; text-align: center; margin-bottom: 6px; transform: rotate(-90deg) translateX(-90px); width: 0; height: 0; }
.hm-grid { display: flex; flex-direction: column; }
.hm-row { display: grid; grid-template-columns: 40px repeat(5, 1fr); gap: 4px; margin-bottom: 4px; }
.hm-y { display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; color: #999; }
.hm-cell { padding: 10px; text-align: center; font-weight: bold; border-radius: 4px; transition: 0.2s; cursor: default; font-size: 13px; }
.hm-cell:hover { transform: scale(1.06); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
.hm-axis-row { margin-top: 4px; border-top: 1px solid #f0f0f0; padding-top: 4px; }
.hm-x { text-align: center; font-size: 11px; color: #999; padding: 4px; }
.hm-x-label { text-align: center; font-size: 11px; color: #999; margin-top: 4px; }

/* 留存矩阵 */
.cohort-table { overflow-x: auto; }
.cohort-table table { width: 100%; border-collapse: collapse; font-size: 12px; }
.cohort-table th, .cohort-table td { padding: 6px 8px; text-align: center; border: 1px solid #f5f5f5; }
.cohort-table th { background: #fafafa; color: #666; font-weight: 600; }
.cohort-table td { transition: 0.2s; font-weight: 500; }
.cohort-table .td-size { background: #f5f5f5; font-weight: bold; }

/* 底部行 */
.bottom-row { display: grid; grid-template-columns: 1fr 1.4fr; gap: 16px; margin-bottom: 20px; }
.tag-cloud { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px; min-height: 200px; align-content: flex-start; }
.tag-bubble { border-radius: 20px; font-weight: 600; line-height: 1.4; }

.u-cell { display: flex; gap: 8px; align-items: center; }
.u-name { font-size: 13px; font-weight: 500; color: #333; }
.u-id { font-family: monospace; font-size: 10px; color: #999; }

.rfm-badge { background: #d4af37; color: #fff; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-family: monospace; font-size: 12px; }
.rec-hot { color: #27ae60; font-weight: bold; }
.rec-ok { color: #d4af37; }
.rec-warn { color: #e6a23c; }
.rec-cold { color: #f56c6c; }

/* 抽屉 */
.segment-drawer { padding: 0 20px; }
.action-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 14px 0; font-size: 12px; color: #666; }

.card-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 14px; }
.card-header .hint { font-size: 11px; color: #999; font-weight: normal; }
.empty { color: #ccc; padding: 30px; text-align: center; width: 100%; }
.data-source-tip { background: #fdf6ec; padding: 10px 14px; border-radius: 8px; color: #b7950b; font-size: 12px; display: flex; align-items: center; gap: 8px; }
.data-source-tip code { background: rgba(255,255,255,0.6); padding: 1px 6px; border-radius: 4px; }

@media (max-width: 1200px) {
  .kpi-strip { grid-template-columns: repeat(3, 1fr); }
  .matrix-row, .bottom-row { grid-template-columns: 1fr; }
}
</style>
