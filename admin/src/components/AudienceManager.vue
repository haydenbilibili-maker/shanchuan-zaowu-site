<template>
  <div class="audience-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>人群包 / AUDIENCES</h2>
        <span class="subtitle">SAVED COHORTS · CAMPAIGN TARGETS</span>
      </div>
      <div class="header-actions">
        <el-button type="primary" color="#d4af37" :icon="Plus" @click="openCreator">新建人群包</el-button>
        <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
      </div>
    </div>

    <!-- KPI -->
    <div class="kpi-strip">
      <div class="kpi-card">
        <div class="kpi-top"><span class="lbl">人群包总数</span><span class="ico">📦</span></div>
        <div class="kpi-val">{{ audiences.length }}</div>
        <div class="kpi-sub">已保存的运营人群</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><span class="lbl">覆盖用户</span><span class="ico">👥</span></div>
        <div class="kpi-val">{{ formatNum(totalCovered) }}</div>
        <div class="kpi-sub">去重 openid</div>
      </div>
      <div class="kpi-card hot">
        <div class="kpi-top"><span class="lbl">活动中的人群</span><span class="ico">🚀</span></div>
        <div class="kpi-val">{{ activeAudiences }}</div>
        <div class="kpi-sub">有活动正在触达</div>
      </div>
      <div class="kpi-card warn">
        <div class="kpi-top"><span class="lbl">触达总数</span><span class="ico">📤</span></div>
        <div class="kpi-val">{{ formatNum(totalDispatched) }}</div>
        <div class="kpi-sub">累计已发券/已推送</div>
      </div>
    </div>

    <!-- 人群列表 -->
    <el-card shadow="never">
      <el-table :data="audiences" v-loading="loading" stripe>
        <el-table-column label="名称" min-width="200">
          <template #default="{ row }">
            <div class="audience-row">
              <span class="aud-icon" :style="{ background: (row.color || '#d4af37') + '20', color: row.color || '#d4af37' }">
                {{ row.icon || '📦' }}
              </span>
              <div>
                <div class="aud-name">{{ row.name }}</div>
                <div class="aud-desc">{{ row.desc || '—' }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="规则类型" width="130">
          <template #default="{ row }">
            <el-tag size="small" :type="row.source === 'segment' ? 'warning' : (row.source === 'tag' ? 'success' : 'info')">
              {{ ruleLabel(row.source) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="规则摘要" min-width="200">
          <template #default="{ row }">
            <div class="rule-summary">{{ summarizeRule(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="规模" width="120" align="center">
          <template #default="{ row }">
            <span class="aud-size">{{ formatNum(row.size || 0) }} 人</span>
            <div class="aud-asof" v-if="row.refreshedAt">{{ fmtRel(row.refreshedAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="活动" width="160">
          <template #default="{ row }">
            <div v-if="row.lastCampaign" class="last-campaign">
              <el-tag :type="row.lastCampaign.type === 'coupon' ? 'warning' : 'primary'" size="small" effect="dark">
                {{ row.lastCampaign.type === 'coupon' ? '券' : 'EDM' }} · {{ row.lastCampaign.dispatched || 0 }}
              </el-tag>
              <div class="campaign-time">{{ fmtRel(row.lastCampaign.at) }}</div>
            </div>
            <span v-else class="empty-cell">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-switch v-model="row.active" active-color="#d4af37" @change="toggleActive(row)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="{ row }">
            <el-button-group size="small">
              <el-button :icon="Promotion" @click="openDispatch(row, 'coupon')" type="warning" plain>发券</el-button>
              <el-button :icon="Message" @click="openDispatch(row, 'edm')" type="primary" plain>触发 EDM</el-button>
              <el-button :icon="Download" @click="exportList(row)" plain>导出名单</el-button>
              <el-button :icon="View" @click="viewMembers(row)" plain>预览</el-button>
              <el-button :icon="Delete" @click="del(row)" type="danger" plain>删除</el-button>
            </el-button-group>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新建人群包 -->
    <el-dialog v-model="creatorVisible" title="新建人群包" width="640px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="例如：6 月鉴定爱好者复购" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.desc" type="textarea" :rows="2" placeholder="本人群包的运营目的（选填）" />
        </el-form-item>
        <el-form-item label="规则类型">
          <el-radio-group v-model="form.source">
            <el-radio-button label="segment">按分群</el-radio-button>
            <el-radio-button label="tag">按行为标签</el-radio-button>
            <el-radio-button label="rfm">按 RFM 阈值</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item v-if="form.source === 'segment'" label="选择分群">
          <el-select v-model="form.segmentKey" placeholder="选择一个分群">
            <el-option v-for="(seg, key) in SEGMENTS" :key="key" :value="key" :label="`${seg.icon} ${seg.name}`" />
          </el-select>
        </el-form-item>

        <el-form-item v-if="form.source === 'tag'" label="选择标签">
          <el-select v-model="form.tagKey" placeholder="选择标签（可见 user_behaviors 派生）">
            <el-option v-for="tag in availableTags" :key="tag.key" :value="tag.key" :label="`${tag.icon} ${tag.label}`" />
          </el-select>
        </el-form-item>

        <template v-if="form.source === 'rfm'">
          <el-form-item label="R 最小值">
            <el-slider v-model="form.rfmRule.rMin" :min="1" :max="5" :marks="{1:'1',5:'5'}" />
          </el-form-item>
          <el-form-item label="F 最小值">
            <el-slider v-model="form.rfmRule.fMin" :min="1" :max="5" :marks="{1:'1',5:'5'}" />
          </el-form-item>
          <el-form-item label="M 最小值">
            <el-slider v-model="form.rfmRule.mMin" :min="1" :max="5" :marks="{1:'1',5:'5'}" />
          </el-form-item>
        </template>

        <el-form-item label="预览">
          <el-alert :title="`匹配 ${preview.length} 个用户`" type="info" :closable="false" show-icon>
            <template #default>
              <div v-if="preview.length" class="preview-tags">
                <el-tag v-for="p in preview.slice(0, 8)" :key="p.openid" size="small">{{ p.nickName || p.openid.slice(0, 6) }}</el-tag>
                <span v-if="preview.length > 8" class="more">…还有 {{ preview.length - 8 }} 人</span>
              </div>
            </template>
          </el-alert>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="creatorVisible = false">取消</el-button>
        <el-button type="primary" color="#d4af37" @click="saveAudience" :disabled="!form.name || preview.length === 0">
          保存人群包
        </el-button>
      </template>
    </el-dialog>

    <!-- 发券/EDM 触发 -->
    <el-dialog v-model="dispatchVisible" :title="dispatchType === 'coupon' ? '定向发券' : '触发 EDM/站内信'" width="540px">
      <div v-if="currentAudience" class="dispatch-info">
        目标人群：<b>{{ currentAudience.name }}</b> · 覆盖 <b>{{ currentAudience.size }}</b> 人
      </div>
      <el-form :model="dispatchForm" label-width="100px" style="margin-top: 16px;">
        <template v-if="dispatchType === 'coupon'">
          <el-form-item label="优惠券名称">
            <el-input v-model="dispatchForm.couponName" placeholder="例如：藏家专享 30 元券" />
          </el-form-item>
          <el-form-item label="券类型">
            <el-radio-group v-model="dispatchForm.couponType">
              <el-radio label="amount">满减</el-radio>
              <el-radio label="discount">折扣</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item :label="dispatchForm.couponType === 'amount' ? '券面额(元)' : '折扣(0-1)'">
            <el-input-number v-model="dispatchForm.couponValue" :min="0" :precision="2" />
          </el-form-item>
          <el-form-item label="使用门槛">
            <el-input v-model="dispatchForm.condition" placeholder="例如：满 99 元可用" />
          </el-form-item>
          <el-form-item label="有效期">
            <el-date-picker v-model="dispatchForm.validUntil" type="date" value-format="YYYY-MM-DD" placeholder="过期日期" />
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item label="消息标题">
            <el-input v-model="dispatchForm.edmTitle" placeholder="例如：六月新展邀请函" />
          </el-form-item>
          <el-form-item label="正文">
            <el-input v-model="dispatchForm.edmBody" type="textarea" :rows="5" placeholder="可直接粘贴 AI 沟通锦囊产出的话术" />
          </el-form-item>
          <el-form-item label="跳转链接">
            <el-input v-model="dispatchForm.edmLink" placeholder="可选：小程序内页路径或外链" />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="dispatchVisible = false">取消</el-button>
        <el-button type="primary" color="#d4af37" @click="executeDispatch" :loading="dispatching">
          {{ dispatchType === 'coupon' ? '执行发券' : '触发推送' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 成员预览 -->
    <el-drawer v-model="membersDrawer" :title="currentAudience ? `${currentAudience.name} - 成员预览` : ''" size="640px">
      <el-table v-if="currentAudience" :data="currentMembers" size="small" max-height="700">
        <el-table-column label="#" type="index" width="48" />
        <el-table-column label="用户" min-width="160">
          <template #default="{ row }">
            <div class="u-cell">
              <el-avatar :size="28" :src="row.avatarUrl" />
              <div>
                <div class="u-name">{{ row.nickName || '匿名' }}</div>
                <div class="u-id">{{ (row.openid || '').slice(0, 10) }}...</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="分群" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.segmentMeta" size="small" :style="{ background: row.segmentMeta.color + '20', color: row.segmentMeta.color, border: 'none' }">
              {{ row.segmentMeta.icon }} {{ row.segmentMeta.name }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="消费" width="100">
          <template #default="{ row }">¥{{ formatNum(row.monetary || 0) }}</template>
        </el-table-column>
        <el-table-column label="近度" width="80" align="center">
          <template #default="{ row }">
            {{ row.recencyDays === Infinity ? '∞' : row.recencyDays + 'd' }}
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { Plus, Refresh, Promotion, Message, Download, View, Delete } from '@element-plus/icons-vue'
import { fetchCollectionSorted, cdnAdd, cdnUpdate, cdnRemove } from '../cloud'
import { loadPortraitSourceData } from '../utils/portraitDataLoad'
import { ElMessage, ElMessageBox } from 'element-plus'
import { buildProfile, SEGMENTS } from '../utils/userSegmentation'

const loading = ref(false)
const audiences = ref([])
const profiles = ref([])    // 全量用户画像（用于规则计算）
const creatorVisible = ref(false)
const dispatchVisible = ref(false)
const membersDrawer = ref(false)
const dispatching = ref(false)
const currentAudience = ref(null)
const currentMembers = ref([])
const dispatchType = ref('coupon')

const form = reactive({
  name: '', desc: '', source: 'segment', icon: '📦', color: '#d4af37',
  segmentKey: '',
  tagKey: '',
  rfmRule: { rMin: 4, fMin: 2, mMin: 2 }
})
const dispatchForm = reactive({
  couponName: '', couponType: 'amount', couponValue: 30, condition: '满 99 元可用', validUntil: '',
  edmTitle: '', edmBody: '', edmLink: ''
})

const formatNum = (n) => {
  if (n == null || isNaN(n)) return 0
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return Number(n).toLocaleString()
}
const fmtRel = (ts) => {
  if (!ts) return ''
  const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts)
  const diff = (Date.now() - d.getTime()) / 86400000
  if (diff < 1) return Math.floor(diff * 24) + ' 小时前'
  if (diff < 30) return Math.floor(diff) + ' 天前'
  return d.toLocaleDateString('zh-CN')
}

// ===== 全量画像加载（用于规则匹配） =====
const loadProfiles = async () => {
  const { users, orders, behaviors } = await loadPortraitSourceData({
    userLimit: 1000,
    orderLimit: 1000,
    behaviorLimit: 1000,
  })
  profiles.value = buildProfile({ users, orders, behaviors })
}

// ===== 可用标签集 =====
const availableTags = computed(() => {
  const seen = new Map()
  profiles.value.forEach(p => {
    (p.tags || []).forEach(t => {
      if (!seen.has(t.key)) seen.set(t.key, t)
    })
  })
  return Array.from(seen.values())
})

// ===== 规则预览 =====
const preview = computed(() => matchProfilesByRule(profiles.value, form))

function matchProfilesByRule(profs, rule) {
  if (!rule) return []
  if (rule.source === 'segment') {
    if (!rule.segmentKey) return []
    return profs.filter(p => p.segment === rule.segmentKey)
  }
  if (rule.source === 'tag') {
    if (!rule.tagKey) return []
    return profs.filter(p => (p.tags || []).some(t => t.key === rule.tagKey))
  }
  if (rule.source === 'rfm') {
    const r = rule.rfmRule || {}
    return profs.filter(p => p.R >= (r.rMin || 1) && p.F >= (r.fMin || 1) && p.M >= (r.mMin || 1))
  }
  return []
}

// ===== 列表 / CRUD =====
const refresh = async () => {
  loading.value = true
  try {
    await loadProfiles()
    const rawList = await fetchCollectionSorted('user_audiences', {
      limit: 100,
      sortFn: (a, b) => (b.createTime || 0) - (a.createTime || 0),
    })
    audiences.value = rawList.map(a => {
      const members = matchProfilesByRule(profiles.value, a)
      return {
        ...a,
        size: members.length,
        members,
        refreshedAt: Date.now()
      }
    })
  } catch (e) {
    audiences.value = []
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}

const ruleLabel = (s) => ({ segment: '分群', tag: '行为标签', rfm: 'RFM 阈值' })[s] || s
const summarizeRule = (a) => {
  if (a.source === 'segment') return SEGMENTS[a.segmentKey]?.name || a.segmentKey || '—'
  if (a.source === 'tag') return availableTags.value.find(t => t.key === a.tagKey)?.label || a.tagKey || '—'
  if (a.source === 'rfm') {
    const r = a.rfmRule || {}
    return `R≥${r.rMin || 1} · F≥${r.fMin || 1} · M≥${r.mMin || 1}`
  }
  return '—'
}

const openCreator = () => {
  Object.assign(form, {
    name: '', desc: '', source: 'segment', icon: '📦', color: '#d4af37',
    segmentKey: 'champions', tagKey: '', rfmRule: { rMin: 4, fMin: 2, mMin: 2 }
  })
  creatorVisible.value = true
}

const saveAudience = async () => {
  if (!form.name || preview.value.length === 0) {
    return ElMessage.warning('请填写名称且确保规则匹配到用户')
  }
  try {
    const matched = preview.value.slice(0, 1000)
    const data = {
      name: form.name,
      desc: form.desc,
      source: form.source,
      segmentKey: form.segmentKey || null,
      tagKey: form.tagKey || null,
      rfmRule: form.source === 'rfm' ? form.rfmRule : null,
      icon: form.icon,
      color: form.color,
      memberOpenids: matched.map(p => p.openid),
      size: matched.length,
      active: true,
      createTime: Date.now(),
      updateTime: Date.now()
    }
    await cdnAdd('user_audiences', data)
    ElMessage.success(`人群包已保存（匹配 ${matched.length} 人）`)
    creatorVisible.value = false
    refresh()
  } catch (e) {
    ElMessage.error('保存失败：' + e.message)
  }
}

const toggleActive = async (row) => {
  try {
    await cdnUpdate('user_audiences', row._id, { active: row.active })
    ElMessage.success(row.active ? '已启用' : '已停用')
  } catch (e) {
    row.active = !row.active
    ElMessage.error('操作失败')
  }
}

const del = (row) => {
  ElMessageBox.confirm(`删除人群包【${row.name}】？`, '删除确认', { type: 'warning' }).then(async () => {
    await cdnRemove('user_audiences', row._id)
    ElMessage.success('已删除')
    refresh()
  }).catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

const viewMembers = (row) => {
  currentAudience.value = row
  currentMembers.value = row.members || matchProfilesByRule(profiles.value, row)
  membersDrawer.value = true
}

const exportList = (row) => {
  const members = row.members || matchProfilesByRule(profiles.value, row)
  const rows = [['openid', 'nickName', 'segment', 'monetary', 'frequency', 'recencyDays']]
  members.forEach(p => {
    rows.push([p.openid, p.nickName || '', p.segmentMeta?.name || '', p.monetary, p.frequency, p.recencyDays === Infinity ? '' : p.recencyDays])
  })
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${row.name}-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  ElMessage.success(`已导出 ${members.length} 条`)
}

// ===== 发券 / EDM 触发 =====
const openDispatch = (row, type) => {
  currentAudience.value = row
  dispatchType.value = type
  Object.assign(dispatchForm, {
    couponName: '', couponType: 'amount', couponValue: 30, condition: '满 99 元可用', validUntil: '',
    edmTitle: '', edmBody: '', edmLink: ''
  })
  dispatchVisible.value = true
}

const executeDispatch = async () => {
  if (!currentAudience.value) return
  dispatching.value = true
  try {
    const openids = currentAudience.value.memberOpenids || []
    const campaign = {
      audienceId: currentAudience.value._id,
      audienceName: currentAudience.value.name,
      type: dispatchType.value,
      payload: dispatchType.value === 'coupon'
        ? { name: dispatchForm.couponName, type: dispatchForm.couponType, value: dispatchForm.couponValue, condition: dispatchForm.condition, validUntil: dispatchForm.validUntil }
        : { title: dispatchForm.edmTitle, body: dispatchForm.edmBody, link: dispatchForm.edmLink },
      targetOpenids: openids,
      dispatched: 0,
      status: 'queued',
      createTime: Date.now()
    }
    const res = await cdnAdd('audience_campaigns', campaign)

    await cdnUpdate('user_audiences', currentAudience.value._id, {
      lastCampaign: { type: dispatchType.value, at: Date.now(), dispatched: openids.length, campaignId: res.id || res._id || '' },
      updateTime: Date.now()
    })

    ElMessage.success(`已写入 audience_campaigns（${openids.length} 个目标），等待云函数侧执行实际推送`)
    dispatchVisible.value = false
    refresh()
  } catch (e) {
    ElMessage.error('触发失败：' + e.message)
  } finally {
    dispatching.value = false
  }
}

// ===== KPI 衍生 =====
const totalCovered = computed(() => {
  const set = new Set()
  audiences.value.forEach(a => (a.memberOpenids || []).forEach(id => set.add(id)))
  return set.size
})
const activeAudiences = computed(() => audiences.value.filter(a => a.active && a.lastCampaign).length)
const totalDispatched = computed(() => audiences.value.reduce((s, a) => s + (a.lastCampaign?.dispatched || 0), 0))

onMounted(refresh)
</script>

<style scoped>
.audience-container { padding: 16px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }
.header-actions { display: flex; gap: 10px; }

.kpi-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
.kpi-card { background: #fff; padding: 16px 18px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); border-top: 3px solid #e4e7ed; }
.kpi-card.hot { border-top-color: #d4af37; }
.kpi-card.warn { border-top-color: #f56c6c; }
.kpi-top { display: flex; justify-content: space-between; align-items: center; font-size: 12px; opacity: 0.7; }
.kpi-val { font-size: 26px; font-weight: 800; margin-top: 6px; }
.kpi-sub { font-size: 11px; color: #999; margin-top: 4px; }

.audience-row { display: flex; gap: 12px; align-items: center; }
.aud-icon { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
.aud-name { font-weight: bold; color: #333; }
.aud-desc { font-size: 12px; color: #999; }
.rule-summary { font-size: 13px; color: #666; }
.aud-size { font-weight: bold; color: #d4af37; font-size: 14px; }
.aud-asof { font-size: 11px; color: #999; }
.last-campaign { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.campaign-time { font-size: 11px; color: #999; }
.empty-cell { color: #ccc; }

.dispatch-info { background: #fdf6ec; padding: 10px 14px; border-radius: 8px; font-size: 13px; color: #b7950b; }
.preview-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.more { color: #999; font-size: 12px; }
.u-cell { display: flex; gap: 8px; align-items: center; }
.u-name { font-size: 13px; font-weight: 500; color: #333; }
.u-id { font-family: monospace; font-size: 10px; color: #999; }
</style>
