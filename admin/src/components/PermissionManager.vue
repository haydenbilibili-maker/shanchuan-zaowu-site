<template>
  <div class="permission-manager">
    <div class="header-section">
      <h2>权限与审计日志</h2>
      <p class="subtitle">仅查看：操作日志与登录日志</p>
    </div>

    <el-alert
      type="warning"
      :closable="false"
      show-icon
      style="margin-bottom: 16px;"
      title="ERP 是单层控制台：本页的角色/用户配置不参与鉴权"
    >
      <template #default>
        ERP 前端没有按角色过滤菜单的能力，真实授权全部由云函数
        <code>staffGuard</code> 在服务端完成。因此「角色管理」「用户管理」两个页签已改为
        <b>只读</b>——它们写入的 <code>admin_roles</code> / <code>admin_users</code>
        目前没有任何消费方，改了对权限毫无影响（2026-09-16 审计 §0 P0-4 / §7.5 决策 B）。
        按人账号落地后，才会重新评估是否真正实现 RBAC。
      </template>
    </el-alert>

    <el-tabs v-model="activeTab" type="card" class="config-tabs">
      <!-- 角色管理：决策 B 后改为只读（见 admin/docs/ERP系统专项审计_2026-09-16.md §7.5） -->
      <el-tab-pane label="👥 角色（只读·不参与鉴权）" name="roles">
        <div class="roles-section">
          <div class="action-bar">
            <el-button @click="loadRoles">
              <el-icon><Refresh /></el-icon>刷新
            </el-button>
          </div>

          <el-table 
            :data="roles" 
            v-loading="loading"
            style="margin-top: 20px;"
            row-key="_id"
          >
            <template #empty>
              <ErpEmpty description="暂无角色记录" hint="该表当前不参与鉴权，仅作记录（见页面顶部说明）。" />
            </template>
            <el-table-column prop="name" label="角色名称" min-width="150" />
            <el-table-column prop="code" label="角色代码" width="150" />
            <el-table-column prop="description" label="描述" min-width="200" />
            <el-table-column label="模块权限（仅记录）" min-width="300">
              <template #default="{ row }">
                <el-tag 
                  v-for="module in row.modulePermissions" 
                  :key="module"
                  style="margin-right: 5px; margin-bottom: 5px;"
                >
                  {{ getModuleName(module) }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- 用户角色分配：决策 B 后改为只读（原先 el-select 的 @change 会直接写库） -->
      <el-tab-pane label="👤 用户（只读·不参与鉴权）" name="users">
        <div class="users-section">
          <div class="action-bar">
            <el-input
              v-model="userSearch"
              placeholder="搜索用户名或邮箱"
              style="width: 300px;"
              clearable
              @input="filterUsers"
            >
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-button @click="loadUsers">
              <el-icon><Refresh /></el-icon>刷新
            </el-button>
          </div>

          <el-table 
            :data="filteredUsers" 
            v-loading="loading"
            style="margin-top: 20px;"
            row-key="_id"
          >
            <template #empty>
              <ErpEmpty description="暂无管理员用户记录" hint="该表当前不参与鉴权，仅作记录。" />
            </template>
            <el-table-column prop="username" label="用户名" width="150" />
            <el-table-column prop="email" label="邮箱" width="200" />
            <el-table-column label="角色（仅记录）" width="200">
              <template #default="{ row }">
                <span class="readonly-role">{{ roleName(row.roleCode) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="lastLoginTime" label="最后登录" width="180">
              <template #default="{ row }">
                {{ formatTime(row.lastLoginTime) }}
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="row.active ? 'success' : 'info'">
                  {{ row.active ? '启用' : '禁用' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- 操作日志 -->
      <el-tab-pane label="📝 操作日志" name="operations">
        <div class="logs-section">
          <div class="filter-bar">
            <el-date-picker
              v-model="operationDateRange"
              type="datetimerange"
              range-separator="至"
              start-placeholder="开始时间"
              end-placeholder="结束时间"
              style="width: 400px; margin-right: 10px;"
            />
            <el-select
              v-model="operationModule"
              placeholder="选择模块"
              clearable
              style="width: 150px; margin-right: 10px;"
            >
              <el-option 
                v-for="(name, code) in moduleNames" 
                :key="code"
                :label="name"
                :value="code"
              />
            </el-select>
            <el-select
              v-model="operationAction"
              placeholder="选择操作"
              clearable
              style="width: 150px; margin-right: 10px;"
            >
              <el-option label="查看" value="view" />
              <el-option label="新增" value="create" />
              <el-option label="编辑" value="update" />
              <el-option label="删除" value="delete" />
              <el-option label="配置" value="config" />
            </el-select>
            <el-input
              v-model="operationUser"
              placeholder="搜索用户名"
              style="width: 150px; margin-right: 10px;"
              clearable
            >
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-button type="primary" @click="loadOperationLogs">
              <el-icon><Search /></el-icon>查询
            </el-button>
            <el-button @click="resetOperationFilters">
              <el-icon><Refresh /></el-icon>重置
            </el-button>
          </div>

          <el-table 
            :data="operationLogs" 
            v-loading="loading"
            style="margin-top: 20px;"
            max-height="600"
          >
            <template #empty>
              <ErpEmpty description="暂无操作日志" hint="操作审计目前只有部分云函数写入；筛选条件也可能过窄。" />
            </template>
            <el-table-column prop="username" label="用户名" width="120" />
            <el-table-column prop="module" label="模块" width="150">
              <template #default="{ row }">
                {{ getModuleName(row.module) }}
              </template>
            </el-table-column>
            <el-table-column prop="action" label="操作" width="100">
              <template #default="{ row }">
                {{ getActionName(row.action) }}
              </template>
            </el-table-column>
            <el-table-column prop="description" label="操作描述" min-width="200" show-overflow-tooltip />
            <el-table-column prop="ip" label="IP地址" width="140" />
            <el-table-column prop="timestamp" label="时间" width="180">
              <template #default="{ row }">
                {{ formatTime(row.timestamp) }}
              </template>
            </el-table-column>
          </el-table>

          <el-pagination
            v-model:current-page="operationPage"
            v-model:page-size="operationPageSize"
            :page-sizes="[20, 50, 100]"
            :total="operationTotal"
            layout="total, sizes, prev, pager, next, jumper"
            @size-change="loadOperationLogs"
            @current-change="loadOperationLogs"
            style="margin-top: 20px; justify-content: flex-end;"
          />
        </div>
      </el-tab-pane>

      <!-- 登录日志 -->
      <el-tab-pane label="🔐 登录日志" name="login">
        <div class="logs-section">
          <div class="filter-bar">
            <el-date-picker
              v-model="loginDateRange"
              type="datetimerange"
              range-separator="至"
              start-placeholder="开始时间"
              end-placeholder="结束时间"
              style="width: 400px; margin-right: 10px;"
            />
            <el-select
              v-model="loginStatus"
              placeholder="登录状态"
              clearable
              style="width: 150px; margin-right: 10px;"
            >
              <el-option label="成功" value="success" />
              <el-option label="失败" value="failed" />
            </el-select>
            <el-input
              v-model="loginUser"
              placeholder="搜索用户名"
              style="width: 150px; margin-right: 10px;"
              clearable
            >
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-button type="primary" @click="loadLoginLogs">
              <el-icon><Search /></el-icon>查询
            </el-button>
            <el-button @click="resetLoginFilters">
              <el-icon><Refresh /></el-icon>重置
            </el-button>
          </div>

          <el-table 
            :data="loginLogs" 
            v-loading="loading"
            style="margin-top: 20px;"
            max-height="600"
          >
            <template #empty>
              <ErpEmpty description="暂无登录记录" hint="服务端尚未写入登录日志（审计 P1），此表可能长期为空。" />
            </template>
            <el-table-column prop="username" label="用户名" width="120" />
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="row.status === 'success' ? 'success' : 'danger'">
                  {{ row.status === 'success' ? '成功' : '失败' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="reason" label="失败原因" width="200" show-overflow-tooltip />
            <el-table-column prop="ip" label="IP地址" width="140" />
            <el-table-column prop="userAgent" label="设备信息" min-width="200" show-overflow-tooltip />
            <el-table-column prop="timestamp" label="登录时间" width="180">
              <template #default="{ row }">
                {{ formatTime(row.timestamp) }}
              </template>
            </el-table-column>
          </el-table>

          <el-pagination
            v-model:current-page="loginPage"
            v-model:page-size="loginPageSize"
            :page-sizes="[20, 50, 100]"
            :total="loginTotal"
            layout="total, sizes, prev, pager, next, jumper"
            @size-change="loadLoginLogs"
            @current-change="loadLoginLogs"
            style="margin-top: 20px; justify-content: flex-end;"
          />
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 角色编辑对话框 -->
    <!-- 角色编辑弹窗已于 2026-09-16 随决策 B 移除（不再有任何触发入口） -->
  </div>
</template>

<script setup>
import ErpEmpty from './ErpEmpty.vue'
import { ref, onMounted, computed } from 'vue'
import {
  fetchCollectionLimit,
  fetchCollectionSorted,
  cdnQueryPage,
  cdnCount,
  getCdnDatabase,
} from '../cloud'
import { ElMessage } from 'element-plus'
import { Refresh, Search } from '@element-plus/icons-vue'

// --- 状态定义 ---
const activeTab = ref('roles')
const loading = ref(false)

// 角色：只读列表（写入相关状态与处理函数随决策 B 于 2026-09-16 移除）
const roles = ref([])

// 用户管理
const users = ref([])
const userSearch = ref('')
const filteredUsers = computed(() => {
  if (!userSearch.value) return users.value
  const keyword = userSearch.value.toLowerCase()
  return users.value.filter(u => 
    (u.username && u.username.toLowerCase().includes(keyword)) ||
    (u.email && u.email.toLowerCase().includes(keyword))
  )
})

// 操作日志
const operationLogs = ref([])
const operationDateRange = ref(null)
const operationModule = ref('')
const operationAction = ref('')
const operationUser = ref('')
const operationPage = ref(1)
const operationPageSize = ref(20)
const operationTotal = ref(0)

// 登录日志
const loginLogs = ref([])
const loginDateRange = ref(null)
const loginStatus = ref('')
const loginUser = ref('')
const loginPage = ref(1)
const loginPageSize = ref(20)
const loginTotal = ref(0)

// 模块名称映射
const moduleNames = {
  dashboard: '经营驾驶舱',
  products: '藏品管理',
  orders: '订单中心',
  finance: '财务报表',
  crm: 'CRM客户管理',
  marketing: '权益与营销',
  activities: '活动管理',
  team: '标本师与花名册',
  banner: '轮播图管理',
  content: '内容管理',
  home_config: '首页配置',
  strategy: '战略调研',
  ai_center: 'AI智能中心',
  member_level: '会员等级配置',
  points_rules: '积分规则配置',
  booking_rules: '预约规则配置',
  permission: '权限管理'
}

// --- 工具方法 ---
const getModuleName = (code) => moduleNames[code] || code
const getActionName = (action) => {
  const map = {
    view: '查看',
    create: '新增',
    update: '编辑',
    delete: '删除',
    config: '配置'
  }
  return map[action] || action
}
const formatTime = (time) => {
  if (!time) return '-'
  return new Date(time).toLocaleString('zh-CN')
}

// --- 角色管理 ---
const loadRoles = async () => {
  loading.value = true
  try {
    roles.value = await fetchCollectionLimit('admin_roles', { limit: 200 })
  } catch (err) {
    console.error('加载角色列表失败', err)
    roles.value = []
    ElMessage.error('加载角色列表失败')
  } finally {
    loading.value = false
  }
}

// 角色写入（addRole/editRole/saveRole/deleteRole）与 updateUserRole 已于 2026-09-16 移除：
// 决策 B —— ERP 为单层控制台，admin_roles/admin_users 无任何消费方，
// 保留这些写入只会制造「改了以为生效」的错觉（审计 §0 P0-4、§7.5）。
// 待「按人账号 → 真实权限点 → 前端 RBAC」做完后，再连同正确的鉴权一起恢复。

// --- 用户管理 ---
const loadUsers = async () => {
  loading.value = true
  try {
    users.value = await fetchCollectionLimit('admin_users', { limit: 500 })
  } catch (err) {
    console.error('加载用户列表失败', err)
    users.value = []
    ElMessage.error('加载用户列表失败')
  } finally {
    loading.value = false
  }
}

const filterUsers = () => {
  // 使用computed自动过滤
}

/** 只读展示：把 roleCode 映射成角色名（本地映射，不回写） */
const roleName = (code) => {
  const hit = roles.value.find((r) => r.code === code)
  return hit ? hit.name : (code || '—')
}

// --- 操作日志 ---
const loadOperationLogs = async () => {
  loading.value = true
  try {
    const cdnDb = await getCdnDatabase()
    const _ = cdnDb.command
    const where = {}
    if (operationModule.value) where.module = operationModule.value
    if (operationAction.value) where.action = operationAction.value
    if (operationUser.value) {
      where.username = cdnDb.RegExp({ regexp: operationUser.value, options: 'i' })
    }
    if (operationDateRange.value && operationDateRange.value.length === 2) {
      where.timestamp = _.gte(operationDateRange.value[0].getTime())
        .and(_.lte(operationDateRange.value[1].getTime()))
    }

    operationTotal.value = await cdnCount('admin_operation_logs', where)
    operationLogs.value = await cdnQueryPage('admin_operation_logs', {
      where,
      orderField: 'timestamp',
      direction: 'desc',
      skip: (operationPage.value - 1) * operationPageSize.value,
      limit: operationPageSize.value
    })
  } catch (err) {
    console.error('加载操作日志失败', err)
    operationLogs.value = []
    ElMessage.error('加载操作日志失败')
  } finally {
    loading.value = false
  }
}

const resetOperationFilters = () => {
  operationDateRange.value = null
  operationModule.value = ''
  operationAction.value = ''
  operationUser.value = ''
  operationPage.value = 1
  loadOperationLogs()
}

// --- 登录日志 ---
const loadLoginLogs = async () => {
  loading.value = true
  try {
    const cdnDb = await getCdnDatabase()
    const _ = cdnDb.command
    const where = {}
    if (loginStatus.value) where.status = loginStatus.value
    if (loginUser.value) {
      where.username = cdnDb.RegExp({ regexp: loginUser.value, options: 'i' })
    }
    if (loginDateRange.value && loginDateRange.value.length === 2) {
      where.timestamp = _.gte(loginDateRange.value[0].getTime())
        .and(_.lte(loginDateRange.value[1].getTime()))
    }

    loginTotal.value = await cdnCount('admin_login_logs', where)
    loginLogs.value = await cdnQueryPage('admin_login_logs', {
      where,
      orderField: 'timestamp',
      direction: 'desc',
      skip: (loginPage.value - 1) * loginPageSize.value,
      limit: loginPageSize.value
    })
  } catch (err) {
    console.error('加载登录日志失败', err)
    loginLogs.value = []
    ElMessage.error('加载登录日志失败')
  } finally {
    loading.value = false
  }
}

const resetLoginFilters = () => {
  loginDateRange.value = null
  loginStatus.value = ''
  loginUser.value = ''
  loginPage.value = 1
  loadLoginLogs()
}

// --- 生命周期 ---
onMounted(() => {
  loadRoles()
  loadUsers()
  loadOperationLogs()
  loadLoginLogs()
})
</script>

<style scoped>
.permission-manager {
  padding: 24px;
  background: linear-gradient(135deg, #fafbfc 0%, #f0f2f5 100%);
  min-height: calc(100vh - 120px);
  color: #2c3e50;
}

.header-section {
  margin-bottom: 30px;
}

.header-section h2 {
  background: linear-gradient(135deg, #9d7a0a 0%, #d4af37 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0 0 8px 0;
  font-size: 24px;
  font-weight: 800;
}

.subtitle {
  color: #5a6c7d;
  margin: 0;
  font-size: 14px;
}

.config-tabs {
  background: #ffffff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

.action-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  align-items: center;
}

.filter-bar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

:deep(.el-table) {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.2);
}

:deep(.el-table th) {
  background: var(--erp-table-head-bg);
  color: var(--erp-table-head-fg);
  border-bottom: 2px solid var(--erp-hairline-gold);
}

:deep(.el-table td) {
  background: #ffffff;
  color: #2c3e50;
  border-bottom: 1px solid rgba(212, 175, 55, 0.1);
}

:deep(.el-table tr:hover > td) {
  background: rgba(212, 175, 55, 0.05);
}

:deep(.el-form-item__label) {
  color: #2c3e50;
}

:deep(.el-input__wrapper) {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.2);
}

:deep(.el-input__inner) {
  color: #2c3e50;
}

:deep(.el-dialog) {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.3);
}

:deep(.el-dialog__title) {
  background: linear-gradient(135deg, #9d7a0a 0%, #d4af37 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
</style>
