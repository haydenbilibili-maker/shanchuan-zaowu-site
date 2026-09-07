<template>
  <div class="honorary-curators">
    <div class="panel-header">
      <div class="title-box">
        <h2>荣誉馆长名单</h2>
        <span class="subtitle">
          以手机号维护 Lv99「荣誉馆长」· 授予/移出均需授权密码 · manageHonoraryCurators
        </span>
      </div>
      <div class="header-actions">
        <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
        <el-button type="primary" @click="openAdd">授予荣誉馆长</el-button>
      </div>
    </div>

    <el-alert
      type="warning"
      :closable="false"
      show-icon
      class="hint-alert"
      title="严格限制发放：仅总部运营通过本页维护。新增与移出均需云端授权密码，且必须经 /api/cloud-fn 代理鉴权，无法绕过前端直写。"
    />

    <div class="filter-bar">
      <el-input
        v-model="phoneSearch"
        clearable
        placeholder="搜索手机号（完整或后几位）"
        style="width: 260px"
        @keyup.enter="onSearch"
        @clear="onSearch"
      />
      <el-radio-group v-model="statusFilter" fill="#2D5A3F" @change="onFilterChange">
        <el-radio-button label="active">生效中</el-radio-button>
        <el-radio-button label="removed">已移出</el-radio-button>
        <el-radio-button label="all">全部</el-radio-button>
      </el-radio-group>
      <el-button @click="onSearch">搜索</el-button>
      <div class="summary muted">本页 {{ list.length }} 条 · 共 {{ total }} 条</div>
    </div>

    <el-card shadow="never" class="table-card">
      <el-table :data="list" v-loading="loading" stripe height="calc(100vh - 380px)">
        <template #empty>
          <el-empty description="暂无荣誉馆长记录" :image-size="88" />
        </template>
        <el-table-column label="手机号" width="160">
          <template #default="{ row }">
            <span class="mono">{{ row.phoneMasked || maskPhone(row.phone) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" effect="plain" size="small">
              {{ row.statusLabel || (row.status === 'active' ? '生效中' : '已移出') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="绑定用户" min-width="140">
          <template #default="{ row }">
            <div>{{ row.matchedUserCount || 0 }} 人</div>
            <div class="ts" v-if="row.nickNames?.length">{{ row.nickNames.slice(0, 2).join('、') }}</div>
          </template>
        </el-table-column>
        <el-table-column label="加入时间" width="170">
          <template #default="{ row }">
            {{ fmtFull(row.createTime) }}
          </template>
        </el-table-column>
        <el-table-column label="操作人" width="140">
          <template #default="{ row }">
            <div>{{ row.createdByName || row.createdBy || '—' }}</div>
            <div class="ts" v-if="row.status === 'removed'">
              移出：{{ row.removedByName || row.removedBy || '—' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.note || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'active'"
              size="small"
              type="danger"
              link
              @click="openRemove(row)"
            >移出</el-button>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager" v-if="total > pageSize">
        <el-pagination
          background
          layout="prev, pager, next"
          :total="total"
          :page-size="pageSize"
          v-model:current-page="page"
          @current-change="loadList"
        />
      </div>
    </el-card>

    <el-card shadow="never" class="ops-card">
      <div class="ops-head">
        <h3>最近操作日志</h3>
        <el-button size="small" text @click="loadOps">刷新</el-button>
      </div>
      <el-table :data="opsList" v-loading="opsLoading" size="small" max-height="220">
        <template #empty>
          <span class="muted">暂无日志</span>
        </template>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ fmtFull(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="动作" width="80">
          <template #default="{ row }">
            <el-tag :type="row.action === 'add' ? 'success' : 'danger'" size="small" effect="plain">
              {{ row.actionLabel || row.action }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="手机号" width="140">
          <template #default="{ row }">
            <span class="mono">{{ row.phoneMasked }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作人" width="140" prop="operatorName" />
        <el-table-column label="同步账号" width="90">
          <template #default="{ row }">{{ row.matchedUserCount || 0 }}</template>
        </el-table-column>
        <el-table-column label="备注" min-width="120" show-overflow-tooltip prop="note" />
      </el-table>
    </el-card>

    <!-- 授予 -->
    <el-dialog v-model="addVisible" title="授予荣誉馆长" width="480px" destroy-on-close @closed="resetAdd">
      <el-form label-position="top">
        <el-form-item label="手机号" required>
          <el-input
            v-model="addForm.phone"
            maxlength="11"
            placeholder="11 位手机号"
            @blur="previewPhone"
          />
        </el-form-item>
        <el-alert
          v-if="previewMsg"
          :type="previewOnRoster ? 'warning' : 'info'"
          :closable="false"
          show-icon
          :title="previewMsg"
          class="preview-alert"
        />
        <el-form-item label="备注（可选）">
          <el-input v-model="addForm.note" maxlength="200" placeholder="如：创始会员 / 活动赠予" />
        </el-form-item>
        <el-form-item label="授权密码" required>
          <el-input
            v-model="addForm.password"
            type="password"
            show-password
            placeholder="请输入荣誉馆长授权密码"
            @keyup.enter="confirmAdd"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmAdd">确认授予</el-button>
      </template>
    </el-dialog>

    <!-- 移出 -->
    <el-dialog v-model="removeVisible" title="移出荣誉馆长" width="480px" destroy-on-close @closed="resetRemove">
      <p class="remove-tip">
        将移出 <span class="mono">{{ removeRow?.phoneMasked }}</span>。移出后
        <code>isHonorary</code> 清除，等级按成长值回落。移出同样需要授权密码。
      </p>
      <el-form label-position="top">
        <el-form-item label="授权密码" required>
          <el-input
            v-model="removePassword"
            type="password"
            show-password
            placeholder="请输入荣誉馆长授权密码"
            @keyup.enter="confirmRemove"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="removeVisible = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="confirmRemove">确认移出</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { callCloudFunction } from '../cloud'

const FN = 'manageHonoraryCurators'

const loading = ref(false)
const opsLoading = ref(false)
const submitting = ref(false)
const list = ref([])
const opsList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const statusFilter = ref('active')
const phoneSearch = ref('')

const addVisible = ref(false)
const removeVisible = ref(false)
const addForm = ref({ phone: '', note: '', password: '' })
const removeRow = ref(null)
const removePassword = ref('')
const previewMsg = ref('')
const previewOnRoster = ref(false)

function maskPhone(phone) {
  const value = String(phone || '')
  if (value.length < 7) return value || '—'
  return value.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

function fmtFull(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN')
}

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
    const res = await callFn({
      action: 'list',
      status: statusFilter.value,
      phone: phoneSearch.value.trim(),
      page: page.value,
      pageSize
    })
    list.value = res.list || []
    total.value = res.total || 0
  } catch (e) {
    list.value = []
    total.value = 0
    ElMessage.error(e?.message || '加载失败：请确认已部署 manageHonoraryCurators 并配置 ADMIN_OPS_KEY')
  } finally {
    loading.value = false
  }
}

async function loadOps() {
  opsLoading.value = true
  try {
    const res = await callFn({ action: 'recentOps', limit: 20 })
    opsList.value = res.list || []
  } catch (e) {
    opsList.value = []
  } finally {
    opsLoading.value = false
  }
}

function refresh() {
  loadList()
  loadOps()
}

function onFilterChange() {
  page.value = 1
  loadList()
}

function onSearch() {
  page.value = 1
  loadList()
}

function openAdd() {
  resetAdd()
  addVisible.value = true
}

function resetAdd() {
  addForm.value = { phone: '', note: '', password: '' }
  previewMsg.value = ''
  previewOnRoster.value = false
}

function openRemove(row) {
  removeRow.value = row
  removePassword.value = ''
  removeVisible.value = true
}

function resetRemove() {
  removeRow.value = null
  removePassword.value = ''
}

async function previewPhone() {
  const phone = String(addForm.value.phone || '').replace(/\D/g, '')
  if (!/^1\d{10}$/.test(phone)) {
    previewMsg.value = ''
    return
  }
  try {
    const res = await callFn({ action: 'lookupByPhone', phone })
    previewOnRoster.value = !!res.onRoster
    previewMsg.value = res.msg || ''
  } catch (e) {
    previewMsg.value = e?.message || ''
  }
}

async function confirmAdd() {
  const phone = String(addForm.value.phone || '').replace(/\D/g, '')
  if (!/^1\d{10}$/.test(phone)) {
    ElMessage.warning('请输入有效的 11 位手机号')
    return
  }
  if (!addForm.value.password) {
    ElMessage.warning('请输入授权密码')
    return
  }
  submitting.value = true
  try {
    const res = await callFn({
      action: 'add',
      phone,
      note: addForm.value.note,
      confirmPassword: addForm.value.password
    })
    ElMessage.success(res.msg || '已授予')
    addVisible.value = false
    refresh()
  } catch (e) {
    ElMessage.error(e?.message || '授予失败')
  } finally {
    submitting.value = false
  }
}

async function confirmRemove() {
  if (!removeRow.value) return
  if (!removePassword.value) {
    ElMessage.warning('请输入授权密码')
    return
  }
  submitting.value = true
  try {
    const res = await callFn({
      action: 'remove',
      id: removeRow.value._id,
      phone: removeRow.value.phone,
      confirmPassword: removePassword.value
    })
    ElMessage.success(res.msg || '已移出')
    removeVisible.value = false
    refresh()
  } catch (e) {
    ElMessage.error(e?.message || '移出失败')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  refresh()
})
</script>

<style scoped>
.honorary-curators {
  padding: 24px;
  background: linear-gradient(135deg, #fafbfc 0%, #f0f2f5 100%);
  min-height: calc(100vh - 120px);
  color: #33302c;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
  gap: 16px;
}

.title-box h2 {
  margin: 0 0 6px;
  font-size: 22px;
  color: #2d5a3f;
  font-weight: 600;
}

.subtitle {
  color: #6b6560;
  font-size: 13px;
}

.header-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.hint-alert {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
}

.summary {
  margin-left: auto;
  font-size: 13px;
}

.table-card,
.ops-card {
  border: 1px solid #e8e5de;
  margin-bottom: 16px;
}

.ops-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.ops-head h3 {
  margin: 0;
  font-size: 15px;
  color: #33302c;
  font-weight: 500;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.mono {
  font-family: 'JetBrains Mono', 'DM Mono', ui-monospace, monospace;
  letter-spacing: 0.02em;
}

.ts {
  font-size: 12px;
  color: #a09a90;
  margin-top: 2px;
}

.muted {
  color: #a09a90;
}

.preview-alert {
  margin-bottom: 12px;
}

.remove-tip {
  margin: 0 0 16px;
  color: #4a4540;
  line-height: 1.6;
  font-size: 14px;
}

:deep(.el-table th) {
  background: #faf6ed;
  color: #33302c;
}
</style>
