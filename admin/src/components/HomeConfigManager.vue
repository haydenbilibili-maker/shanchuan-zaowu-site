<template>
  <div class="home-config-manager">
    <div class="header-section">
      <h2>首页动态化配置</h2>
      <p class="subtitle">管理小程序首页模块的显示顺序、参数和状态</p>
    </div>

    <el-alert
      v-if="loadError"
      type="warning"
      :title="loadError"
      show-icon
      class="load-error-alert"
      closable
      @close="loadError = null"
    >
      <el-button type="primary" size="small" link @click="loadConfigs">重试</el-button>
    </el-alert>

    <div class="config-container">
      <!-- 配置列表 -->
      <div class="config-list-section">
        <div class="action-bar">
          <el-button type="primary" @click="loadConfigs" :loading="loading">
            <el-icon><Refresh /></el-icon>刷新配置
          </el-button>
          <el-button type="success" @click="createNewConfig">
            <el-icon><Plus /></el-icon>新建配置
          </el-button>
          <el-button type="info" @click="previewConfig" :disabled="!selectedConfig">
            <el-icon><View /></el-icon>预览效果
          </el-button>
        </div>

        <div class="table-wrapper">
        <el-table 
          :data="configList" 
          v-loading="loading"
          highlight-current-row
          @row-click="selectConfig"
          style="width: 100%;"
        >
          <el-table-column prop="name" label="配置名称" min-width="150" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'info'">
                {{ row.status === 'active' ? '生效中' : '草稿' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="priority" label="优先级" width="100" />
          <el-table-column prop="version" label="版本" width="100" />
          <el-table-column label="模块数" width="100">
            <template #default="{ row }">
              {{ row.modules?.length || 0 }}
            </template>
          </el-table-column>
          <el-table-column label="更新时间" width="180">
            <template #default="{ row }">
              {{ formatTime(row._updateTime || row.updatedAt) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click.stop="editConfig(row)">编辑</el-button>
              <el-button link type="success" @click.stop="activateConfig(row)" v-if="row.status !== 'active'">
                激活
              </el-button>
              <el-button link type="danger" @click.stop="deleteConfig(row)">删除</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <div class="table-empty">
              <el-icon class="empty-icon"><DocumentCopy /></el-icon>
              <p>暂无配置</p>
              <p class="empty-hint">点击「新建配置」创建首页方案</p>
            </div>
          </template>
        </el-table>
        </div>
      </div>

      <!-- 配置编辑区域 -->
      <div class="config-editor-section" v-if="selectedConfig">
        <div class="editor-header">
          <h3>{{ selectedConfig.name || '未命名配置' }}</h3>
          <div class="editor-actions">
            <el-button @click="resetConfig">重置</el-button>
            <el-button type="primary" @click="saveConfig" :loading="saving">
              保存配置
            </el-button>
          </div>
        </div>

        <div class="module-list">
          <div 
            v-for="(module, index) in sortedModules" 
            :key="module.id"
            class="module-item"
            :class="{ disabled: !module.enabled }"
          >
            <div class="module-header">
              <div class="module-info">
                <el-icon class="drag-handle"><Rank /></el-icon>
                <span class="module-name">{{ module.name }}</span>
                <el-switch 
                  :model-value="module.enabled" 
                  active-text="开"
                  inactive-text="关"
                  @update:model-value="(val) => toggleModule(module, val)"
                />
              </div>
              <div class="module-order">
                顺序: {{ module.order }}
              </div>
            </div>

            <div class="module-config" v-if="module.enabled">
              <el-form :model="module.config" label-width="120px" size="small">
                <!-- 轮播图配置 -->
                <template v-if="module.id === 'banners'">
                  <el-form-item label="显示数量">
                    <el-input-number 
                      :model-value="module.config.limit" 
                      @update:model-value="(val) => updateModuleConfig(module, 'limit', val)"
                      :min="1" 
                      :max="10" 
                    />
                  </el-form-item>
                  <el-form-item label="自动播放">
                    <el-switch 
                      :model-value="module.config.autoplay" 
                      @update:model-value="(val) => updateModuleConfig(module, 'autoplay', val)"
                    />
                  </el-form-item>
                  <el-form-item label="轮播间隔(ms)" v-if="module.config.autoplay">
                    <el-input-number 
                      :model-value="module.config.interval" 
                      @update:model-value="(val) => updateModuleConfig(module, 'interval', val)"
                      :min="3000" 
                      :max="10000" 
                      :step="1000" 
                    />
                  </el-form-item>
                </template>

                <!-- 分类球配置 -->
                <template v-if="module.id === 'categories'">
                  <el-form-item label="显示数量">
                    <el-input-number 
                      :model-value="module.config.limit" 
                      @update:model-value="(val) => updateModuleConfig(module, 'limit', val)"
                      :min="1" 
                      :max="10" 
                    />
                  </el-form-item>
                </template>

                <!-- 专题展览配置 -->
                <template v-if="module.id === 'collections'">
                  <el-form-item label="显示数量">
                    <el-input-number 
                      :model-value="module.config.limit" 
                      @update:model-value="(val) => updateModuleConfig(module, 'limit', val)"
                      :min="1" 
                      :max="20" 
                    />
                  </el-form-item>
                  <el-form-item label="排序字段">
                    <el-select 
                      :model-value="module.config.sortBy"
                      @update:model-value="(val) => updateModuleConfig(module, 'sortBy', val)"
                    >
                      <el-option label="创建时间" value="createTime" />
                      <el-option label="更新时间" value="updateTime" />
                      <el-option label="排序权重" value="sort" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="排序方式">
                    <el-radio-group 
                      :model-value="module.config.sortOrder"
                      @update:model-value="(val) => updateModuleConfig(module, 'sortOrder', val)"
                    >
                      <el-radio label="desc">降序</el-radio>
                      <el-radio label="asc">升序</el-radio>
                    </el-radio-group>
                  </el-form-item>
                </template>

                <!-- 名师手作配置 -->
                <template v-if="module.id === 'framers'">
                  <el-form-item label="显示数量">
                    <el-input-number 
                      :model-value="module.config.limit" 
                      @update:model-value="(val) => updateModuleConfig(module, 'limit', val)"
                      :min="1" 
                      :max="20" 
                    />
                  </el-form-item>
                  <el-form-item label="排序字段">
                    <el-select 
                      :model-value="module.config.sortBy"
                      @update:model-value="(val) => updateModuleConfig(module, 'sortBy', val)"
                    >
                      <el-option label="创建时间" value="createTime" />
                      <el-option label="更新时间" value="updateTime" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="排序方式">
                    <el-radio-group 
                      :model-value="module.config.sortOrder"
                      @update:model-value="(val) => updateModuleConfig(module, 'sortOrder', val)"
                    >
                      <el-radio label="desc">降序</el-radio>
                      <el-radio label="asc">升序</el-radio>
                    </el-radio-group>
                  </el-form-item>
                </template>

                <!-- 近期活动配置 -->
                <template v-if="module.id === 'activities'">
                  <el-form-item label="显示数量">
                    <el-input-number 
                      :model-value="module.config.limit" 
                      @update:model-value="(val) => updateModuleConfig(module, 'limit', val)"
                      :min="1" 
                      :max="20" 
                    />
                  </el-form-item>
                  <el-form-item label="活动状态">
                    <el-select 
                      :model-value="module.config.status"
                      @update:model-value="(val) => updateModuleConfig(module, 'status', val)"
                    >
                      <el-option label="开放中" value="open" />
                      <el-option label="全部" value="all" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="排序字段">
                    <el-select 
                      :model-value="module.config.sortBy"
                      @update:model-value="(val) => updateModuleConfig(module, 'sortBy', val)"
                    >
                      <el-option label="日期" value="date" />
                      <el-option label="创建时间" value="createTime" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="排序方式">
                    <el-radio-group 
                      :model-value="module.config.sortOrder"
                      @update:model-value="(val) => updateModuleConfig(module, 'sortOrder', val)"
                    >
                      <el-radio label="asc">升序(即将开始)</el-radio>
                      <el-radio label="desc">降序</el-radio>
                    </el-radio-group>
                  </el-form-item>
                </template>

                <!-- 为你推荐配置 -->
                <template v-if="module.id === 'recommendations'">
                  <el-form-item label="显示数量">
                    <el-input-number 
                      :model-value="module.config.limit" 
                      @update:model-value="(val) => updateModuleConfig(module, 'limit', val)"
                      :min="1" 
                      :max="20" 
                    />
                  </el-form-item>
                  <el-form-item label="推荐算法">
                    <el-select 
                      :model-value="module.config.algorithm"
                      @update:model-value="(val) => updateModuleConfig(module, 'algorithm', val)"
                    >
                      <el-option label="混合推荐" value="mixed" />
                      <el-option label="热门推荐" value="hot" />
                      <el-option label="个性化推荐" value="personalized" />
                    </el-select>
                  </el-form-item>
                </template>

                <!-- 最新入库配置 -->
                <template v-if="module.id === 'newArrivals'">
                  <el-form-item label="显示数量">
                    <el-input-number 
                      :model-value="module.config.limit" 
                      @update:model-value="(val) => updateModuleConfig(module, 'limit', val)"
                      :min="1" 
                      :max="30" 
                    />
                  </el-form-item>
                  <el-form-item label="排序字段">
                    <el-select 
                      :model-value="module.config.sortBy"
                      @update:model-value="(val) => updateModuleConfig(module, 'sortBy', val)"
                    >
                      <el-option label="创建时间" value="createTime" />
                      <el-option label="更新时间" value="updateTime" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="排序方式">
                    <el-radio-group 
                      :model-value="module.config.sortOrder"
                      @update:model-value="(val) => updateModuleConfig(module, 'sortOrder', val)"
                    >
                      <el-radio label="desc">降序(最新在前)</el-radio>
                      <el-radio label="asc">升序</el-radio>
                    </el-radio-group>
                  </el-form-item>
                </template>
              </el-form>
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="empty-state">
        <div class="editor-empty">
          <el-icon class="editor-empty-icon"><EditPen /></el-icon>
          <p class="editor-empty-title">未选择配置</p>
          <p class="editor-empty-desc">在左侧列表点击一条配置进行编辑，或新建配置</p>
        </div>
      </div>
    </div>

    <!-- 新建/编辑配置对话框 -->
    <el-dialog 
      v-model="showConfigDialog" 
      :title="editingConfig ? '编辑配置' : '新建配置'"
      width="500px"
    >
      <el-form :model="configForm" label-width="100px">
        <el-form-item label="配置名称" required>
          <el-input v-model="configForm.name" placeholder="如：2025春节首页配置" />
        </el-form-item>
        <el-form-item label="版本号">
          <el-input v-model="configForm.version" placeholder="如：1.0.0" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="configForm.priority" :min="1" :max="100" />
          <span style="margin-left: 10px; color: #999; font-size: 12px;">
            数字越大优先级越高，生效中的配置优先级最高者生效
          </span>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="configForm.status">
            <el-radio label="active">生效中</el-radio>
            <el-radio label="draft">草稿</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showConfigDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmCreateConfig">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { fetchCollectionSorted } from '../cloud'
import { cdnAdd, cdnUpdate, cdnRemove } from '../utils/cloudbaseCdnDb'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Plus, View, Rank, DocumentCopy, EditPen } from '@element-plus/icons-vue'

const loading = ref(false)
const saving = ref(false)
const loadError = ref(null)
const configList = ref([])
const selectedConfig = ref(null)
const showConfigDialog = ref(false)
const editingConfig = ref(null)
const configForm = ref({
  name: '',
  version: '1.0.0',
  priority: 1,
  status: 'draft'
})

// 默认模块配置
const getDefaultModules = () => [
  {
    id: 'banners',
    name: '轮播图',
    enabled: true,
    order: 1,
    config: { limit: 5, autoplay: true, interval: 6000 }
  },
  {
    id: 'categories',
    name: '分类球',
    enabled: true,
    order: 2,
    config: { limit: 4, showAll: false }
  },
  {
    id: 'collections',
    name: '专题展览',
    // 与小程序一致：缺省关闭，仅 enabled === true 才展示
    enabled: false,
    order: 3,
    config: { limit: 10, sortBy: 'createTime', sortOrder: 'desc' }
  },
  {
    id: 'framers',
    name: '名师手作',
    enabled: true,
    order: 4,
    config: { limit: 6, sortBy: 'createTime', sortOrder: 'desc' }
  },
  {
    id: 'activities',
    name: '近期活动',
    // 与小程序一致：缺省关闭，仅 enabled === true 才展示
    enabled: false,
    order: 5,
    config: { limit: 5, status: 'open', sortBy: 'date', sortOrder: 'asc' }
  },
  {
    id: 'recommendations',
    name: '为你推荐',
    enabled: true,
    order: 6,
    config: { limit: 8, algorithm: 'mixed' }
  },
  {
    id: 'newArrivals',
    name: '最新入库',
    enabled: true,
    order: 7,
    config: { limit: 10, sortBy: 'createTime', sortOrder: 'desc' }
  }
]

// 排序后的模块列表
const sortedModules = computed(() => {
  if (!selectedConfig.value?.modules) return []
  return [...selectedConfig.value.modules].sort((a, b) => (a.order || 999) - (b.order || 999))
})

// 加载配置列表（CDN SDK 读取，避免 bundle SDK setting 'promise' bug）
const loadConfigs = async () => {
  if (loading.value) return
  loading.value = true
  loadError.value = null
  try {
    configList.value = await fetchCollectionSorted('home_configs', {
      limit: 200,
      sortFn: (a, b) => {
        const pd = (b.priority ?? 0) - (a.priority ?? 0)
        if (pd !== 0) return pd
        return (b._updateTime ?? 0) - (a._updateTime ?? 0)
      }
    })
  } catch (error) {
    console.error('加载配置失败:', error)
    configList.value = []
    loadError.value = error?.message || '加载失败，请点击刷新重试'
    ElMessage.error('加载配置失败：' + loadError.value)
  } finally {
    loading.value = false
  }
}

// 选择配置
const selectConfig = (row) => {
  // 🔧 修复：深度克隆避免引用问题，防止无限刷新
  selectedConfig.value = JSON.parse(JSON.stringify(row))
  // 确保modules存在
  if (!selectedConfig.value.modules || selectedConfig.value.modules.length === 0) {
    selectedConfig.value.modules = getDefaultModules()
  }
}

// 创建新配置
const createNewConfig = () => {
  editingConfig.value = null
  configForm.value = {
    name: '',
    version: '1.0.0',
    priority: 1,
    status: 'draft'
  }
  showConfigDialog.value = true
}

// 编辑配置
const editConfig = (row) => {
  editingConfig.value = row
  configForm.value = {
    name: row.name || '',
    version: row.version || '1.0.0',
    priority: row.priority || 1,
    status: row.status || 'draft'
  }
  showConfigDialog.value = true
}

// 确认创建/编辑配置
const confirmCreateConfig = async () => {
  if (!configForm.value.name) {
    ElMessage.warning('请输入配置名称')
    return
  }

  try {
    const configData = {
      ...configForm.value,
      modules: editingConfig.value?.modules || getDefaultModules(),
      updatedAt: new Date(),
      _updateTime: Date.now()
    }

    if (editingConfig.value?._id) {
      // 更新
      await cdnUpdate('home_configs', editingConfig.value._id, configData)
      ElMessage.success('配置更新成功')
    } else {
      // 新建
      configData._createTime = Date.now()
      await cdnAdd('home_configs', configData)
      ElMessage.success('配置创建成功')
    }

    showConfigDialog.value = false
    await loadConfigs()
    await nextTick()
    
    // 🔧 修复：如果编辑的是当前选中的配置，只更新数据不重新选择，避免无限刷新
    if (editingConfig.value?._id === selectedConfig.value?._id) {
      const updated = configList.value.find(c => c._id === editingConfig.value._id)
      if (updated && selectedConfig.value) {
        // 只更新非modules的字段，保留用户正在编辑的modules
        const { modules, ...restUpdated } = updated
        Object.assign(selectedConfig.value, restUpdated)
        // 保留当前编辑的modules
        selectedConfig.value.modules = selectedConfig.value.modules || modules || getDefaultModules()
      }
    }
  } catch (error) {
    console.error('保存配置失败:', error)
    ElMessage.error('保存配置失败：' + (error.message || '未知错误'))
  }
}

// 保存配置
const saveConfig = async () => {
  if (!selectedConfig.value) return

  saving.value = true
  try {
    // 🔧 优化：深拷贝配置数据，避免直接修改响应式对象
    const configData = {
      name: selectedConfig.value.name,
      version: selectedConfig.value.version,
      priority: selectedConfig.value.priority,
      status: selectedConfig.value.status,
      modules: JSON.parse(JSON.stringify(selectedConfig.value.modules || [])),
      updatedAt: new Date(),
      _updateTime: Date.now()
    }

    await cdnUpdate('home_configs', selectedConfig.value._id, configData)
    ElMessage.success('配置保存成功')
    
    // 🔧 修复：先更新列表，但不立即更新选中状态，避免无限刷新
    await loadConfigs()
    await nextTick()
    
    // 更新选中状态（只更新数据，保留当前编辑的modules）
    const currentId = selectedConfig.value._id
    const currentModules = selectedConfig.value.modules
    const updated = configList.value.find(c => c._id === currentId)
    if (updated) {
      // 只更新非modules的字段，保留用户正在编辑的modules
      const { modules, ...restUpdated } = updated
      Object.assign(selectedConfig.value, restUpdated)
      // 保留当前编辑的modules
      selectedConfig.value.modules = currentModules || modules || getDefaultModules()
    }
  } catch (error) {
    console.error('保存配置失败:', error)
    ElMessage.error('保存配置失败：' + (error.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

// 切换模块启用状态
const toggleModule = (module, enabled) => {
  if (!selectedConfig.value?.modules) return
  
  // 🔧 修复：创建新的模块对象，避免直接修改
  const moduleIndex = selectedConfig.value.modules.findIndex(m => m.id === module.id)
  if (moduleIndex === -1) return
  
  // 创建新数组和新模块对象
  const updatedModules = selectedConfig.value.modules.map((m, index) => {
    if (index === moduleIndex) {
      return { ...m, enabled }
    }
    return { ...m }
  })
  
  // 更新模块数组
  selectedConfig.value.modules = updatedModules
  
  // 更新模块顺序
  updateModuleOrder()
}

// 更新模块配置
const updateModuleConfig = (module, key, value) => {
  if (!selectedConfig.value?.modules) return
  
  const moduleIndex = selectedConfig.value.modules.findIndex(m => m.id === module.id)
  if (moduleIndex === -1) return
  
  // 创建新的模块数组和配置对象
  const updatedModules = selectedConfig.value.modules.map((m, index) => {
    if (index === moduleIndex) {
      return {
        ...m,
        config: {
          ...m.config,
          [key]: value
        }
      }
    }
    return { ...m }
  })
  
  // 更新模块数组
  selectedConfig.value.modules = updatedModules
}

// 更新模块顺序
const updateModuleOrder = () => {
  if (!selectedConfig.value?.modules) return
  
  // 🔧 修复：创建新数组避免直接修改导致无限刷新
  // 先根据enabled状态和order排序
  const sorted = [...selectedConfig.value.modules].sort((a, b) => {
    if (a.enabled && !b.enabled) return -1
    if (!a.enabled && b.enabled) return 1
    return (a.order || 999) - (b.order || 999)
  })
  
  // 重新分配order
  const updatedModules = sorted.map((module, index) => {
    const newModule = { ...module }
    if (newModule.enabled) {
      newModule.order = index + 1
    } else {
      newModule.order = 999
    }
    return newModule
  })
  
  // 🔧 修复：使用新数组替换，触发响应式更新
  selectedConfig.value.modules = updatedModules
}

// 激活配置
const activateConfig = async (row) => {
  try {
    await ElMessageBox.confirm(
      '激活此配置后，将自动停用其他生效中的配置。是否继续？',
      '确认激活',
      { type: 'warning' }
    )

    // 先停用其他配置
    const activeConfigs = configList.value.filter(c => c.status === 'active' && c._id !== row._id)
    for (const config of activeConfigs) {
      await cdnUpdate('home_configs', config._id, {
        status: 'inactive',
        _updateTime: Date.now()
      })
    }

    // 激活当前配置
    await cdnUpdate('home_configs', row._id, {
      status: 'active',
      _updateTime: Date.now()
    })

    ElMessage.success('配置已激活')
    await loadConfigs()
  } catch (error) {
    if (error !== 'cancel') {
      console.error('激活配置失败:', error)
      ElMessage.error('激活配置失败：' + (error.message || '未知错误'))
    }
  }
}

// 删除配置
const deleteConfig = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除配置"${row.name}"吗？此操作不可恢复。`,
      '确认删除',
      { type: 'warning' }
    )

    await cdnRemove('home_configs', row._id)
    ElMessage.success('配置已删除')
    
    if (selectedConfig.value?._id === row._id) {
      selectedConfig.value = null
    }
    
    await loadConfigs()
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除配置失败:', error)
      ElMessage.error('删除配置失败：' + (error.message || '未知错误'))
    }
  }
}

// 预览配置
const previewConfig = () => {
  if (!selectedConfig.value) {
    ElMessage.warning('请先选择一个配置')
    return
  }
  
  // 构建预览信息
  const enabledModules = (selectedConfig.value.modules || [])
    .filter(m => m.enabled)
    .map(m => m.name)
    .join('、')
  
  ElMessageBox.alert(
    `<div style="text-align: left; padding: 10px 0;">
      <p><strong>配置名称：</strong>${selectedConfig.value.name || '未命名'}</p>
      <p><strong>启用模块：</strong>${enabledModules || '无'}</p>
      <p><strong>模块数量：</strong>${enabledModules ? enabledModules.split('、').length : 0}个</p>
      <p style="margin-top: 15px; color: #666; font-size: 12px;">
        💡 提示：配置保存后将实时同步到小程序首页
      </p>
    </div>`,
    '配置预览',
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: '我知道了'
    }
  )
}

// 重置配置
const resetConfig = async () => {
  if (!selectedConfig.value) return
  
  // 原先 confirm 与实际操作共用同一个 catch，注释写「用户取消」，
  // 但真实错误也会被当成「用户取消」静默丢弃（审计 P1）
  try {
    await ElMessageBox.confirm(
      '重置后将恢复所有模块到默认配置，是否继续？',
      '确认重置',
      {
        type: 'warning',
        confirmButtonText: '确认重置',
        cancelButtonText: '取消'
      }
    )
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') console.error('重置确认框异常', e)
    return
  }
  try {
    // 🔧 优化：使用深拷贝避免引用问题
    selectedConfig.value.modules = JSON.parse(JSON.stringify(getDefaultModules()))
    ElMessage.success('配置已重置为默认值')
  } catch (e) {
    console.error('重置配置失败', e)
    ElMessage.error(`重置失败：${e?.message || '未知错误'}`)
  }
}

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN')
}

onMounted(() => {
  loadConfigs()
})
</script>

<style scoped>
.home-config-manager {
  padding: 24px;
  background: linear-gradient(135deg, #fafbfc 0%, #f0f2f5 100%);
  color: #2c3e50;
  min-height: calc(100vh - 60px);
}

.header-section {
  margin-bottom: 24px;
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
}

.home-config-manager {
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
  box-sizing: border-box;
}

.config-container {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
  gap: 24px;
  min-width: 0;
  max-width: 100%;
}

@media (max-width: 1200px) {
  .config-container {
    grid-template-columns: 1fr;
  }
  
  .config-editor-section {
    margin-top: 24px;
  }
}

.config-list-section {
  background: #ffffff;
  border: 1.5px solid rgba(212, 175, 55, 0.2);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.table-wrapper {
  min-width: 0;
  overflow-x: auto;
  margin-top: 20px;
}

.config-editor-section {
  background: #ffffff;
  border: 1.5px solid rgba(212, 175, 55, 0.2);
  border-radius: 16px;
  padding: 24px;
  max-height: calc(100vh - 200px);
  overflow-y: auto;
  overflow-x: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  min-width: 0;
}

.load-error-alert {
  margin-bottom: 16px;
  border-radius: 10px;
}

.table-empty {
  padding: 40px 20px;
  text-align: center;
  color: #909399;
}
.table-empty .empty-icon {
  font-size: 48px;
  color: rgba(212, 175, 55, 0.4);
  margin-bottom: 12px;
}
.table-empty p {
  margin: 0 0 6px 0;
  font-size: 14px;
}
.table-empty .empty-hint {
  font-size: 12px;
  color: #c0c4cc;
}

.empty-state {
  background: #ffffff;
  border: 1.5px solid rgba(212, 175, 55, 0.15);
  border-radius: 16px;
  padding: 24px;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
}

.editor-empty {
  text-align: center;
  padding: 24px;
}
.editor-empty-icon {
  font-size: 64px;
  color: rgba(212, 175, 55, 0.25);
  margin-bottom: 16px;
}
.editor-empty-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 8px 0;
}
.editor-empty-desc {
  font-size: 13px;
  color: #909399;
  margin: 0;
  max-width: 260px;
  line-height: 1.5;
}

.action-bar {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 18px;
  border-bottom: 2px solid rgba(212, 175, 55, 0.15);
}

.editor-header h3 {
  background: linear-gradient(135deg, #9d7a0a 0%, #d4af37 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}

.editor-actions {
  display: flex;
  gap: 12px;
}

.module-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.module-item {
  background: #ffffff;
  border: 1.5px solid rgba(212, 175, 55, 0.2);
  border-radius: 12px;
  padding: 18px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.module-item.disabled {
  opacity: 0.5;
  background: #f5f7fa;
}

.module-item:hover {
  border-color: rgba(212, 175, 55, 0.4);
  box-shadow: 0 4px 16px rgba(212, 175, 55, 0.15);
  transform: translateY(-2px);
}

.module-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.module-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.drag-handle {
  color: #d4af37;
  cursor: move;
}

.module-name {
  font-weight: 600;
  color: #2c3e50;
  font-size: 15px;
}

.module-order {
  color: #5a6c7d;
  font-size: 12px;
}

.module-config {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1.5px solid rgba(212, 175, 55, 0.15);
  background: #fafbfc;
  padding: 16px;
  border-radius: 8px;
  margin-left: -2px;
  margin-right: -2px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}

:deep(.el-table) {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.2);
}

:deep(.el-table th) {
  background: var(--erp-table-head-bg);
  color: var(--erp-table-head-fg);
  border-bottom: 2px solid var(--erp-hairline-gold);
  font-weight: 600;
}

:deep(.el-table td) {
  background: #ffffff;
  color: #2c3e50;
  border-bottom: 1px solid rgba(212, 175, 55, 0.1);
}

:deep(.el-table__row:hover > td) {
  background: rgba(212, 175, 55, 0.05);
}

:deep(.el-table__row.current-row > td) {
  background: rgba(212, 175, 55, 0.1);
}

:deep(.el-form-item__label) {
  color: #2c3e50 !important;
}

:deep(.el-input__wrapper),
:deep(.el-select .el-input__wrapper) {
  background: #ffffff;
  border-color: rgba(212, 175, 55, 0.2);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

:deep(.el-input__wrapper:hover),
:deep(.el-select .el-input__wrapper:hover) {
  border-color: rgba(212, 175, 55, 0.4);
}

:deep(.el-input__inner),
:deep(.el-select .el-input__inner) {
  color: #2c3e50;
}

:deep(.el-switch.is-checked .el-switch__core) {
  background-color: #d4af37;
}

:deep(.el-tag--success) {
  background-color: rgba(212, 175, 55, 0.1);
  border-color: rgba(212, 175, 55, 0.3);
  color: #d4af37;
}

:deep(.el-tag--info) {
  background-color: #f5f7fa;
  border-color: rgba(90, 108, 125, 0.2);
  color: #5a6c7d;
}
</style>

