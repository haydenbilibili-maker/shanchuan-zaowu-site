<template>
  <div class="store-staff-permissions">
    <div class="panel-header">
      <div class="title-box">
        <h2>店员工作台权限</h2>
        <span class="subtitle">
          维护小程序店长 / 店员账号（云库 staff_members）· 支持手机号查找与 openid 配置 · 控制「店长后台 / 店员工作台」入口
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
        <el-radio-button label="manager">店长</el-radio-button>
        <el-radio-button label="staff">店员</el-radio-button>
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
        <el-table-column label="角色" width="100">
          <template #default="{ row }">
            <el-tag :type="row.role === 'manager' ? 'warning' : 'success'" effect="plain" size="small">
              {{ row.roleText || (row.role === 'manager' ? '店长' : '店员') }}
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
      :title="form._id ? '编辑店长 / 店员权限' : '开通店长 / 店员权限'"
      width="520px"
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
          <el-radio-group v-model="form.role">
            <el-radio label="manager">店长</el-radio>
            <el-radio label="staff">店员</el-radio>
          </el-radio-group>
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
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction } from '../cloud'

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

function emptyForm() {
  return {
    _id: '',
    openid: '',
    name: '',
    staffNo: '',
    role: 'staff',
    storeIdsText: '',
    dailyGrantCap: 0,
    active: true
  }
}

const filteredList = computed(() => {
  let rows = list.value.slice()
  if (roleFilter.value !== 'all') {
    rows = rows.filter((r) => r.role === roleFilter.value)
  }
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return rows
  return rows.filter((r) => {
    const blob = `${r.name || ''} ${r.staffNo || ''} ${r.openid || ''} ${r.openidTail || ''}`.toLowerCase()
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
    ElMessage.error(e?.message || '加载失败：请确认已部署 manageStaff 并配置 ADMIN_OPS_KEY')
  } finally {
    loading.value = false
  }
}

function refresh() {
  loadList()
}

function onSearch() {
  // filteredList 为计算属性
}

function openUpsert(row) {
  candidates.value = []
  phoneLookup.value = ''
  if (row) {
    form.value = {
      _id: row._id || '',
      openid: row.openid || '',
      name: row.name || '',
      staffNo: row.staffNo || '',
      role: row.role === 'manager' ? 'manager' : 'staff',
      storeIdsText: (row.storeIds || []).join(','),
      dailyGrantCap: Number(row.dailyGrantCap) || 0,
      active: row.status !== 'disabled'
    }
  } else {
    form.value = emptyForm()
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
  submitting.value = true
  try {
    const res = await callFn({
      action: 'upsert',
      openid: String(f.openid).trim(),
      name: f.name,
      staffNo: f.staffNo,
      role: f.role,
      storeIds: f.storeIdsText,
      dailyGrantCap: f.dailyGrantCap,
      status: f.active ? 'active' : 'disabled'
    })
    ElMessage.success(res.msg || '已保存')
    dialogVisible.value = false
    await loadList()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

async function onDisable(row) {
  try {
    await ElMessageBox.confirm(
      `确认停用「${row.name || row.openidTail}」的小程序店长/店员权限？`,
      '停用权限',
      { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' }
    )
    await callFn({ action: 'remove', staffId: row._id })
    ElMessage.success('已停用')
    await loadList()
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(e?.message || '停用失败')
  }
}

async function onReactivate(row) {
  try {
    await callFn({
      action: 'upsert',
      openid: row.openid,
      name: row.name,
      staffNo: row.staffNo,
      role: row.role,
      storeIds: row.storeIds,
      dailyGrantCap: row.dailyGrantCap,
      status: 'active'
    })
    ElMessage.success('已恢复')
    await loadList()
  } catch (e) {
    ElMessage.error(e?.message || '恢复失败')
  }
}

onMounted(() => {
  loadList()
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
</style>
