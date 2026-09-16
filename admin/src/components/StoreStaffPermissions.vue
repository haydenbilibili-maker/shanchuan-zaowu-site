<template>
  <div class="store-staff-permissions">
    <div class="panel-header">
      <div class="title-box">
        <h2>店员工作台权限</h2>
        <span class="subtitle">
          维护小程序超管 / 店长 / 店员（staff_members + workspace_acl）· 支持手机号查找与 openid 配置
        </span>
      </div>
      <div class="header-actions">
        <el-button :icon="Refresh" circle title="刷新" @click="refresh" />
        <el-button type="primary" @click="openUpsert()">开通权限</el-button>
      </div>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="hint-alert"
      title="与「员工花名册」相互独立：本页写入 staff_members，供小程序 staffGuard 鉴权；花名册用于总部 HR / 薪酬，不会自动开通小程序店长权限。"
    />

    <el-card shadow="never" class="acl-card" v-loading="aclLoading">
      <template #header>
        <div class="acl-header">
          <div>
            <div class="acl-title">超管白名单（workspace_acl）</div>
            <div class="acl-sub">硬编码兜底始终生效；此处仅管理云库追加 openid。保存后约 1 分钟内各云函数缓存刷新。</div>
          </div>
          <el-button type="primary" :loading="aclSaving" @click="saveAcl">保存超管名单</el-button>
        </div>
      </template>
      <div class="acl-hardcoded" v-if="aclHardcoded.length">
        <span class="acl-label">硬编码兜底</span>
        <el-tag v-for="id in aclHardcoded" :key="id" size="small" type="warning" effect="plain" class="oid-tag">…{{ id.slice(-8) }}</el-tag>
      </div>
      <el-input
        v-model="aclOpenidsText"
        type="textarea"
        :rows="3"
        placeholder="每行一个 openid（可追加；硬编码项不必重复填写）"
      />
    </el-card>

    <div class="filter-bar">
      <el-input
        v-model="keyword"
        clearable
        placeholder="搜索姓名 / openid 尾号 / 工号"
        style="width: 280px"
        @keyup.enter="onSearch"
        @clear="onSearch"
      />
      <el-radio-group v-model="statusFilter" fill="#2D5A3F" @change="loadList">
        <el-radio-button label="active">生效中</el-radio-button>
        <el-radio-button label="disabled">已停用</el-radio-button>
        <el-radio-button label="all">全部</el-radio-button>
      </el-radio-group>
      <el-radio-group v-model="roleFilter" fill="#2D5A3F" @change="onSearch">
        <el-radio-button label="all">全部角色</el-radio-button>
        <el-radio-button label="super_admin">超管</el-radio-button>
        <el-radio-button label="manager">店长</el-radio-button>
        <el-radio-button label="staff">店员</el-radio-button>
        <el-radio-button label="specimen_artisan">标本师</el-radio-button>
        <el-radio-button label="live_host">主播</el-radio-button>
        <el-radio-button label="investor">投资人</el-radio-button>
        <el-radio-button label="shareholder">股东</el-radio-button>
      </el-radio-group>
      <div class="summary muted">本页 {{ filteredList.length }} 条</div>
    </div>

    <el-card shadow="never" class="table-card">
      <el-table :data="filteredList" v-loading="loading" stripe height="calc(100vh - 380px)">
        <template #empty>
          <el-empty description="暂无店长 / 店员权限记录" :image-size="88" />
        </template>
        <el-table-column label="姓名" min-width="120">
          <template #default="{ row }">
            <div class="name-main">{{ row.name || '未命名' }}</div>
            <div class="ts" v-if="row.staffNo">工号 {{ row.staffNo }}</div>
          </template>
        </el-table-column>
        <el-table-column label="角色" min-width="140">
          <template #default="{ row }">
            <el-tag
              :type="roleTagType(row.role)"
              effect="plain"
              size="small"
            >
              {{ row.roleText || rolesLabel(row.roles || [row.role]) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="openid" min-width="160">
          <template #default="{ row }">
            <span class="mono" :title="row.openid">…{{ row.openidTail || String(row.openid || '').slice(-8) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="门店" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            {{ (row.storeIds || []).length ? row.storeIds.join('、') : '全部门店' }}
          </template>
        </el-table-column>
        <el-table-column label="日赠分上限" width="110">
          <template #default="{ row }">
            {{ row.dailyGrantCap > 0 ? row.dailyGrantCap : '不限' }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" effect="plain" size="small">
              {{ row.status === 'active' ? '生效' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openUpsert(row)">编辑</el-button>
            <el-button
              v-if="row.status === 'active'"
              size="small"
              type="danger"
              link
              @click="onDisable(row)"
            >停用</el-button>
            <el-button
              v-else
              size="small"
              type="success"
              link
              @click="onReactivate(row)"
            >恢复</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="form._id ? '编辑工作台权限' : '开通店长 / 店员权限'"
      width="640px"
      destroy-on-close
    >
      <el-form label-width="100px">
        <el-form-item label="手机号查找">
          <div class="phone-row">
            <el-input v-model="phoneLookup" maxlength="11" placeholder="11 位手机号（对方需已授权）" />
            <el-button :loading="lookingUp" @click="lookupPhone">查找</el-button>
          </div>
          <div v-if="candidates.length" class="candidates">
            <el-radio-group v-model="form.openid">
              <el-radio
                v-for="c in candidates"
                :key="c.openid"
                :label="c.openid"
              >
                {{ c.nickName || c.name || '藏家' }} · {{ c.phoneMasked }} · …{{ c.openidTail }}
              </el-radio>
            </el-radio-group>
          </div>
        </el-form-item>
        <el-form-item label="openid" required>
          <el-input v-model="form.openid" :disabled="!!form._id" placeholder="微信 openid" />
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="form.name" maxlength="20" placeholder="展示名" />
        </el-form-item>
        <el-form-item label="工号">
          <el-input v-model="form.staffNo" maxlength="20" placeholder="可选" />
        </el-form-item>
        <el-form-item label="角色" required>
          <el-checkbox-group v-model="form.roles">
            <el-checkbox label="staff">店员</el-checkbox>
            <el-checkbox label="manager">店长</el-checkbox>
            <el-checkbox label="specimen_artisan">标本师</el-checkbox>
            <el-checkbox label="live_host">直播主播</el-checkbox>
            <el-checkbox label="investor">投资人</el-checkbox>
            <el-checkbox label="shareholder">股东</el-checkbox>
            <el-checkbox label="super_admin">超管</el-checkbox>
          </el-checkbox-group>
          <div class="field-hint" v-if="(form.roles || []).includes('super_admin')">
            保存后写入 staff_members，并自动并入 workspace_acl 超管名单
          </div>
        </el-form-item>
        <el-form-item label="股东配置" v-if="(form.roles || []).includes('shareholder')">
          <div class="shareholder-config">
            <el-select v-model="form.shareholderStoreId" placeholder="绑定门店股东" style="width: 100%; margin-bottom: 10px">
              <el-option label="山川造物" value="store_shanhaizaowu" />
              <el-option label="星宸标本" value="store_xingchen" />
            </el-select>
            <div class="shareholder-grid">
              <el-input-number v-model="form.ownershipRatio" :min="0" :max="100" :step="1" placeholder="占股%" controls-position="right" />
              <span class="field-hint">占股 %</span>
              <el-input-number v-model="form.dividendRatio" :min="0" :max="100" :step="1" placeholder="分成%" controls-position="right" />
              <span class="field-hint">分成 %</span>
              <el-input-number v-model="form.capitalContribution" :min="0" :step="1000" placeholder="出资额" controls-position="right" />
              <span class="field-hint">出资额（元）</span>
              <el-date-picker v-model="form.effectiveDate" type="date" value-format="YYYY-MM-DD" placeholder="生效日" style="width: 100%" />
              <span class="field-hint">生效日</span>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="能力勾选" v-if="featureGroups.length">
          <div class="feature-groups">
            <div v-for="g in featureGroups" :key="g.roleKey" class="feature-group">
              <div class="feature-group-title">{{ g.title }} <span class="en">{{ g.en }}</span></div>
              <el-checkbox
                v-for="item in g.items"
                :key="item.key"
                :model-value="item.checked"
                :disabled="item.disabled || g.readOnly"
                @change="(v) => toggleFeature(g.roleKey, item.key, v)"
              >
                {{ item.label }}
              </el-checkbox>
            </div>
          </div>
          <div class="field-hint">与小程序「门店后台权限」同源；保存时写入 permissionsExplicit</div>
        </el-form-item>
        <el-form-item label="门店 ID">
          <el-input
            v-model="form.storeIdsText"
            placeholder="多个用英文逗号分隔；留空=全部门店"
          />
        </el-form-item>
        <el-form-item label="日赠分上限">
          <el-input-number v-model="form.dailyGrantCap" :min="0" :step="100" />
          <span class="field-hint">0 表示不限</span>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch
            v-model="form.active"
            inline-prompt
            active-text="生效"
            inactive-text="停用"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitUpsert">保存</el-button>
      </template>
    </el-dialog>

    <el-card shadow="never" class="audit-card" v-loading="auditLoading">
      <template #header>
        <div class="acl-header">
          <div>
            <div class="acl-title">操作审计（只读）</div>
            <div class="acl-sub">staff_audit_logs · 发货 / 积分审核 / 权限变更等</div>
          </div>
          <div class="audit-actions">
            <el-select v-model="auditAction" clearable placeholder="全部 action" style="width: 180px" @change="loadAudit">
              <el-option v-for="a in auditActionOptions" :key="a" :label="a" :value="a" />
            </el-select>
            <el-select v-model="auditSinceDays" style="width: 120px" @change="loadAudit">
              <el-option :value="1" label="近 1 天" />
              <el-option :value="7" label="近 7 天" />
              <el-option :value="30" label="近 30 天" />
              <el-option :value="0" label="不限" />
            </el-select>
            <el-button :icon="Refresh" circle title="刷新审计" @click="loadAudit" />
          </div>
        </div>
      </template>
      <el-table :data="auditList" stripe max-height="320" size="small">
        <template #empty>
          <el-empty description="暂无审计记录" :image-size="64" />
        </template>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ formatAuditTime(row.createdAtMs) }}</template>
        </el-table-column>
        <el-table-column prop="action" label="action" width="140" />
        <el-table-column label="操作者" width="100">
          <template #default="{ row }">…{{ row.openidTail || '—' }}</template>
        </el-table-column>
        <el-table-column prop="workspaceRole" label="角色" width="120" />
        <el-table-column prop="relatedId" label="relatedId" min-width="140" show-overflow-tooltip />
        <el-table-column label="详情" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ formatAuditDetail(row.detail) }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction } from '../cloud'
import {
  buildWorkbenchFeatureUI,
  featureKeysForRoles,
  permissionsFromFeatureGroups
} from '../utils/workspaceFeatures'

const FN = 'manageStaff'

const loading = ref(false)
const lookingUp = ref(false)
const submitting = ref(false)
const list = ref([])
const keyword = ref('')
const statusFilter = ref('active')
const roleFilter = ref('all')
const dialogVisible = ref(false)
const phoneLookup = ref('')
const candidates = ref([])
const form = ref(emptyForm())
const featureGroups = ref([])
const editingPermissions = ref([])
const aclLoading = ref(false)
const aclSaving = ref(false)
const aclHardcoded = ref([])
const aclOpenidsText = ref('')
const auditLoading = ref(false)
const auditList = ref([])
const auditAction = ref('')
const auditSinceDays = ref(7)
const auditActionOptions = [
  'staff_upsert',
  'staff_remove',
  'workspace_acl_save',
  'order_ship',
  'order_refund',
  'points_review'
]

function emptyForm() {
  return {
    _id: '',
    openid: '',
    name: '',
    staffNo: '',
    role: 'staff',
    roles: ['staff'],
    storeIdsText: '',
    dailyGrantCap: 0,
    active: true,
    shareholderStoreId: '',
    ownershipRatio: 0,
    dividendRatio: 0,
    capitalContribution: 0,
    effectiveDate: ''
  }
}

function roleLabel(role) {
  if (role === 'super_admin') return '超管'
  if (role === 'manager') return '店长'
  if (role === 'specimen_artisan') return '标本师'
  if (role === 'live_host') return '主播'
  if (role === 'investor') return '投资人'
  if (role === 'shareholder') return '股东'
  return '店员'
}

function rolesLabel(roles) {
  const list = Array.isArray(roles) ? roles.filter(Boolean) : []
  if (!list.length) return '店员'
  return list.map(roleLabel).join(' / ')
}

function roleTagType(role) {
  if (role === 'super_admin') return 'danger'
  if (role === 'manager') return 'warning'
  if (role === 'investor' || role === 'shareholder') return 'info'
  if (role === 'specimen_artisan' || role === 'live_host') return ''
  return 'success'
}

function normalizeRoles(row) {
  if (row && Array.isArray(row.roles) && row.roles.length) {
    return row.roles.map((r) => String(r || '').trim()).filter(Boolean)
  }
  if (row && (row.role === 'super_admin' || row.isSuperAdmin)) return ['super_admin']
  if (row && row.role) return [String(row.role)]
  return ['staff']
}

function rebuildFeatureGroups(roles, permissions) {
  const roleList = Array.isArray(roles) ? roles.filter(Boolean) : []
  const selected =
    Array.isArray(permissions) && permissions.length
      ? permissions
      : featureKeysForRoles(roleList)
  featureGroups.value = buildWorkbenchFeatureUI(roleList, selected)
  editingPermissions.value = selected.slice()
}

function toggleFeature(roleKey, key, checked) {
  const groups = featureGroups.value.map((g) => {
    if (g.roleKey !== roleKey || g.readOnly) return g
    return {
      ...g,
      items: (g.items || []).map((item) =>
        item.key === key ? { ...item, checked: !!checked } : item
      )
    }
  })
  featureGroups.value = groups
}

watch(
  () => (form.value.roles || []).slice().sort().join(','),
  () => {
    if (!dialogVisible.value) return
    const picked = permissionsFromFeatureGroups(featureGroups.value)
    const fallback = picked.length ? picked : editingPermissions.value
    rebuildFeatureGroups(form.value.roles, fallback)
  }
)

const filteredList = computed(() => {
  let rows = list.value.slice()
  if (roleFilter.value !== 'all') {
    rows = rows.filter((r) => {
      const roles = normalizeRoles(r)
      return roles.includes(roleFilter.value) || r.role === roleFilter.value
    })
  }
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return rows
  return rows.filter((r) => {
    const blob = `${r.name || ''} ${r.staffNo || ''} ${r.openid || ''} ${r.openidTail || ''} ${r.roleText || ''} ${rolesLabel(normalizeRoles(r))}`.toLowerCase()
    return blob.includes(kw)
  })
})

async function callFn(data) {
  const res = await callCloudFunction(FN, { ...data })
  if (!res || res.success === false) {
    const err = new Error(res?.msg || '云函数调用失败')
    err.code = res?.code
    throw err
  }
  return res
}

async function loadList() {
  loading.value = true
  try {
    const res = await callFn({ action: 'list', status: statusFilter.value })
    list.value = res.list || []
  } catch (e) {
    list.value = []
    ElMessage.error(e?.message || '加载失败，请刷新重试；持续失败请联系技术' /* 技术排查：请确认已部署 manageStaff 并配置 ADMIN_OPS_KEY */)
  } finally {
    loading.value = false
  }
}

async function loadAcl() {
  aclLoading.value = true
  try {
    const res = await callFn({ action: 'getWorkspaceAcl' })
    aclHardcoded.value = res.hardcoded || []
    const configured = res.configured || []
    aclOpenidsText.value = configured.join('\n')
  } catch (e) {
    aclHardcoded.value = []
    aclOpenidsText.value = ''
    // 非超管或未部署时不打断主列表
    console.warn('getWorkspaceAcl', e)
  } finally {
    aclLoading.value = false
  }
}

async function saveAcl() {
  const openids = String(aclOpenidsText.value || '')
    .split(/[\n,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  aclSaving.value = true
  try {
    const res = await callFn({ action: 'saveWorkspaceAcl', openids })
    ElMessage.success(res.msg || '超管名单已保存')
    aclHardcoded.value = res.hardcoded || aclHardcoded.value
    aclOpenidsText.value = (res.configured || []).join('\n')
    await loadList()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败（需超管权限，且云库已建 workspace_acl）')
  } finally {
    aclSaving.value = false
  }
}

async function loadAudit() {
  auditLoading.value = true
  try {
    const payload = { action: 'listAuditLogs', limit: 50 }
    if (auditAction.value) payload.actionFilter = auditAction.value
    if (auditSinceDays.value > 0) {
      payload.sinceMs = Date.now() - auditSinceDays.value * 24 * 60 * 60 * 1000
    }
    const res = await callFn(payload)
    auditList.value = res.list || []
  } catch (e) {
    auditList.value = []
    console.warn('listAuditLogs', e)
  } finally {
    auditLoading.value = false
  }
}

function formatAuditTime(ms) {
  const n = Number(ms) || 0
  if (!n) return '—'
  const d = new Date(n)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function formatAuditDetail(detail) {
  if (!detail) return '—'
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail)
  } catch (_) {
    return String(detail)
  }
}

function refresh() {
  loadList()
  loadAcl()
  loadAudit()
}

function onSearch() {
  // filteredList 为计算属性
}

function openUpsert(row) {
  candidates.value = []
  phoneLookup.value = ''
  if (row) {
    const roles = normalizeRoles(row)
    const sp = row.shareholderProfile || {}
    form.value = {
      _id: row._id || '',
      openid: row.openid || '',
      name: row.name || '',
      staffNo: row.staffNo || '',
      role: roles[0] || row.role || 'staff',
      roles: roles.slice(),
      storeIdsText: (row.storeIds || []).join(','),
      dailyGrantCap: Number(row.dailyGrantCap) || 0,
      active: row.status !== 'disabled',
      shareholderStoreId: sp.storeId || '',
      ownershipRatio: Number(sp.ownershipRatio) || 0,
      dividendRatio: Number(sp.dividendRatio) || 0,
      capitalContribution: Number(sp.capitalContribution) || 0,
      effectiveDate: sp.effectiveDate || ''
    }
    rebuildFeatureGroups(roles, row.permissions || [])
  } else {
    form.value = emptyForm()
    rebuildFeatureGroups(['staff'], featureKeysForRoles(['staff']))
  }
  dialogVisible.value = true
}

async function lookupPhone() {
  const phone = String(phoneLookup.value || '').replace(/\D/g, '')
  if (!/^1\d{10}$/.test(phone)) {
    ElMessage.warning('请输入 11 位手机号')
    return
  }
  lookingUp.value = true
  try {
    const res = await callFn({ action: 'lookupByPhone', phone })
    candidates.value = res.candidates || []
    if (!candidates.value.length) {
      ElMessage.warning(res.msg || '未找到用户')
    } else if (candidates.value.length === 1) {
      form.value.openid = candidates.value[0].openid
      if (!form.value.name) form.value.name = candidates.value[0].name || candidates.value[0].nickName || ''
    }
  } catch (e) {
    ElMessage.error(e?.message || '查找失败')
  } finally {
    lookingUp.value = false
  }
}

async function submitUpsert() {
  const f = form.value
  if (!String(f.openid || '').trim()) {
    ElMessage.warning('请填写 openid')
    return
  }
  const roles = Array.isArray(f.roles) ? f.roles.filter(Boolean) : []
  if (!roles.length) {
    ElMessage.warning('请至少选择一个角色')
    return
  }
  if (roles.includes('shareholder') && !String(f.shareholderStoreId || '').trim()) {
    ElMessage.warning('请为股东绑定门店（山川造物 / 星宸标本）')
    return
  }
  submitting.value = true
  try {
    const permissions = permissionsFromFeatureGroups(featureGroups.value)
    const payload = {
      action: 'upsert',
      openid: String(f.openid).trim(),
      name: f.name,
      staffNo: f.staffNo,
      roles,
      role: roles[0],
      storeIds: f.storeIdsText,
      dailyGrantCap: f.dailyGrantCap,
      status: f.active ? 'active' : 'disabled',
      permissions,
      permissionsExplicit: true
    }
    if (roles.includes('shareholder')) {
      payload.shareholderProfile = {
        storeId: String(f.shareholderStoreId || '').trim(),
        ownershipRatio: f.ownershipRatio,
        dividendRatio: f.dividendRatio,
        capitalContribution: f.capitalContribution,
        effectiveDate: f.effectiveDate || ''
      }
    } else {
      payload.shareholderProfile = null
    }
    const res = await callFn(payload)
    ElMessage.success(res.msg || '已保存')
    dialogVisible.value = false
    await Promise.all([loadList(), loadAcl(), loadAudit()])
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

async function onDisable(row) {
  try {
    await ElMessageBox.confirm(
      `确认停用「${row.name || row.openidTail}」的工作台权限？` +
        (row.role === 'super_admin' || row.isSuperAdmin ? '（将同步移出超管 ACL）' : ''),
      '停用权限',
      { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' }
    )
    await callFn({ action: 'remove', staffId: row._id })
    ElMessage.success('已停用')
    await Promise.all([loadList(), loadAcl(), loadAudit()])
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(e?.message || '停用失败')
  }
}

async function onReactivate(row) {
  try {
    const roles = normalizeRoles(row)
    const payload = {
      action: 'upsert',
      openid: row.openid,
      name: row.name,
      staffNo: row.staffNo,
      roles,
      role: roles[0] || row.role,
      storeIds: row.storeIds,
      dailyGrantCap: row.dailyGrantCap,
      status: 'active'
    }
    if (roles.includes('shareholder')) {
      payload.shareholderProfile = row.shareholderProfile || null
    }
    await callFn(payload)
    ElMessage.success('已恢复')
    await Promise.all([loadList(), loadAcl(), loadAudit()])
  } catch (e) {
    ElMessage.error(e?.message || '恢复失败')
  }
}

onMounted(() => {
  loadList()
  loadAcl()
  loadAudit()
})
</script>

<style scoped>
.store-staff-permissions {
  padding: 8px 4px 24px;
  color: #4A4540;
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.title-box h2 {
  margin: 0 0 6px;
  font-size: 20px;
  color: #33302C;
  font-weight: 600;
}

.subtitle {
  display: block;
  font-size: 13px;
  color: #6B6560;
  line-height: 1.5;
  max-width: 720px;
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.hint-alert {
  margin-bottom: 16px;
}

.acl-card {
  margin-bottom: 16px;
  border: 1px solid #E8E5DE;
}

.acl-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.acl-title {
  font-weight: 600;
  color: #33302C;
}

.acl-sub {
  margin-top: 4px;
  font-size: 12px;
  color: #6B6560;
  line-height: 1.4;
}

.acl-hardcoded {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.acl-label {
  font-size: 12px;
  color: #6B6560;
}

.oid-tag {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.summary {
  margin-left: auto;
  font-size: 13px;
}

.muted { color: #A09A90; }
.ts { font-size: 12px; color: #A09A90; margin-top: 2px; }
.mono {
  font-family: 'JetBrains Mono', 'DM Mono', ui-monospace, monospace;
  font-size: 12px;
  color: #6B6560;
}
.name-main { font-weight: 500; color: #33302C; }

.table-card {
  border: 1px solid #E8E5DE;
  border-radius: 12px;
}

.phone-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.candidates {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-hint {
  margin-left: 10px;
  font-size: 12px;
  color: #A09A90;
}

.shareholder-config {
  width: 100%;
}
.shareholder-grid {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px 10px;
  align-items: center;
}

.feature-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-height: 280px;
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid #E8E5DE;
  border-radius: 8px;
  background: #FAF6ED;
}

.feature-group-title {
  font-size: 13px;
  font-weight: 600;
  color: #33302C;
  margin-bottom: 6px;
}

.feature-group-title .en {
  margin-left: 6px;
  font-size: 11px;
  color: #A09A90;
  font-weight: 500;
  letter-spacing: 0.06em;
}

.feature-group :deep(.el-checkbox) {
  display: flex;
  margin-right: 0;
  margin-bottom: 4px;
  height: auto;
  white-space: normal;
}

.audit-card {
  margin-top: 16px;
  border: 1px solid #E8E5DE;
}

.audit-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
</style>
