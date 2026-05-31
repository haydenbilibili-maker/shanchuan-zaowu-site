<template>
  <div class="permission-manager">
    <div class="header-section">
      <h2>权限管理系统</h2>
      <p class="subtitle">配置角色权限、查看操作日志和登录日志</p>
    </div>

    <el-tabs v-model="activeTab" type="card" class="config-tabs">
      <!-- 角色管理 -->
      <el-tab-pane label="👥 角色管理" name="roles">
        <div class="roles-section">
          <div class="action-bar">
            <el-button type="primary" @click="addRole">
              <el-icon><Plus /></el-icon>新增角色
            </el-button>
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
            <el-table-column prop="name" label="角色名称" min-width="150" />
            <el-table-column prop="code" label="角色代码" width="150" />
            <el-table-column prop="description" label="描述" min-width="200" />
            <el-table-column label="模块权限" min-width="300">
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
            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="editRole(row)">编辑权限</el-button>
                <el-button link type="danger" @click="deleteRole(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- 用户角色分配 -->
      <el-tab-pane label="👤 用户管理" name="users">
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
            <el-table-column prop="username" label="用户名" width="150" />
            <el-table-column prop="email" label="邮箱" width="200" />
            <el-table-column label="角色" width="200">
              <template #default="{ row }">
                <el-select 
                  v-model="row.roleCode" 
                  placeholder="选择角色"
                  @change="updateUserRole(row)"
                  size="small"
                >
                  <el-option 
                    v-for="role in roles" 
                    :key="role.code"
                    :label="role.name"
                    :value="role.code"
                  />
                </el-select>
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
    <el-dialog
      v-model="roleDialogVisible"
      :title="isEditingRole ? '编辑角色' : '新增角色'"
      width="700px"
      :close-on-click-modal="false"
    >
      <el-form :model="roleForm" label-width="120px" ref="roleFormRef">
        <el-form-item label="角色名称" prop="name" :rules="[{ required: true, message: '请输入角色名称' }]">
          <el-input v-model="roleForm.name" placeholder="如：超级管理员" />
        </el-form-item>
        <el-form-item label="角色代码" prop="code" :rules="[{ required: true, message: '请输入角色代码' }]">
          <el-input v-model="roleForm.code" placeholder="如：super_admin" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="roleForm.description" type="textarea" :rows="2" placeholder="角色描述" />
        </el-form-item>
        <el-form-item label="模块权限">
          <el-checkbox-group v-model="roleForm.modulePermissions">
            <el-checkbox 
              v-for="(name, code) in moduleNames" 
              :key="code"
              :label="code"
            >
              {{ name }}
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRole">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import {
  fetchCollectionLimit,
  fetchCollectionSorted,
  cdnAdd,
  cdnUpdate,
  cdnRemove,
  cdnQueryPage,
  cdnCount,
  getCdnDatabase,
} from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'

// --- 状态定义 ---
const activeTab = ref('roles')
const loading = ref(false)
const saving = ref(false)
const roleDialogVisible = ref(false)
const isEditingRole = ref(false)

// 角色管理
const roles = ref([])
const roleForm = reactive({
  _id: null,
  name: '',
  code: '',
  description: '',
  modulePermissions: []
})

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

const addRole = () => {
  isEditingRole.value = false
  Object.assign(roleForm, {
    _id: null,
    name: '',
    code: '',
    description: '',
    modulePermissions: []
  })
  roleDialogVisible.value = true
}

const editRole = (row) => {
  isEditingRole.value = true
  Object.assign(roleForm, {
    _id: row._id,
    name: row.name,
    code: row.code,
    description: row.description || '',
    modulePermissions: [...(row.modulePermissions || [])]
  })
  roleDialogVisible.value = true
}

const saveRole = async () => {
  if (!roleForm.name || !roleForm.code) {
    ElMessage.warning('请填写角色名称和代码')
    return
  }
  
  saving.value = true
  try {
    const data = {
      name: roleForm.name,
      code: roleForm.code,
      description: roleForm.description,
      modulePermissions: roleForm.modulePermissions,
      _updateTime: new Date()
    }
    
    if (isEditingRole.value && roleForm._id) {
      await cdnUpdate('admin_roles', roleForm._id, data)
      ElMessage.success('角色更新成功')
    } else {
      data._createTime = new Date()
      await cdnAdd('admin_roles', data)
      ElMessage.success('角色创建成功')
    }
    
    roleDialogVisible.value = false
    loadRoles()
  } catch (err) {
    console.error('保存角色失败', err)
    ElMessage.error('保存角色失败')
  } finally {
    saving.value = false
  }
}

const deleteRole = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要删除角色"${row.name}"吗？`, '确认删除', {
      type: 'warning'
    })
    
    await cdnRemove('admin_roles', row._id)
    ElMessage.success('角色删除成功')
    loadRoles()
  } catch (err) {
    if (err !== 'cancel') {
      console.error('删除角色失败', err)
      ElMessage.error('删除角色失败')
    }
  }
}

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

const updateUserRole = async (row) => {
  try {
    await cdnUpdate('admin_users', row._id, {
      roleCode: row.roleCode,
      _updateTime: new Date()
    })
    ElMessage.success('用户角色更新成功')
  } catch (err) {
    console.error('更新用户角色失败', err)
    ElMessage.error('更新用户角色失败')
    loadUsers()
  }
}

const filterUsers = () => {
  // 使用computed自动过滤
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
  background: #f5f7fa;
  color: #d4af37;
  border-bottom: 2px solid rgba(212, 175, 55, 0.2);
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
