<template>
  <div class="achievement-config">
    <div class="header-section">
      <h2>成就系统配置</h2>
      <p class="subtitle">配置成就类型、达成条件和奖励</p>
    </div>

    <el-tabs v-model="activeTab" type="card" class="config-tabs">
      <!-- 成就列表 -->
      <el-tab-pane label="🏆 成就列表" name="list">
        <div class="achievements-section">
          <div class="action-bar">
            <el-button type="primary" @click="addAchievement">
              <el-icon><Plus /></el-icon>新增成就
            </el-button>
            <el-button @click="loadAchievements">
              <el-icon><Refresh /></el-icon>刷新
            </el-button>
            <el-button type="success" @click="saveAllAchievements" :loading="saving">
              <el-icon><Check /></el-icon>保存全部
            </el-button>
          </div>

          <!-- 筛选器 -->
          <div class="filter-bar" style="margin-top: 20px;">
            <el-select
              v-model="filterType"
              placeholder="筛选类型"
              clearable
              style="width: 150px; margin-right: 10px;"
              @change="filterAchievements"
            >
              <el-option label="全部" value="" />
              <el-option label="探索类" value="explore" />
              <el-option label="收藏类" value="collect" />
              <el-option label="社交类" value="social" />
              <el-option label="消费类" value="consumption" />
              <el-option label="其他" value="other" />
            </el-select>
            <el-select
              v-model="filterStatus"
              placeholder="筛选状态"
              clearable
              style="width: 150px;"
              @change="filterAchievements"
            >
              <el-option label="全部" value="" />
              <el-option label="启用" value="enabled" />
              <el-option label="禁用" value="disabled" />
            </el-select>
          </div>

          <el-table 
            :data="filteredAchievements" 
            v-loading="loading"
            style="margin-top: 20px;"
            row-key="id"
          >
            <el-table-column label="图标" width="80">
              <template #default="{ row }">
                <el-image
                  v-if="row.icon && row.icon.startsWith('http')"
                  :src="row.icon"
                  style="width: 40px; height: 40px; border-radius: 6px;"
                  fit="cover"
                />
                <span v-else style="font-size: 32px;">{{ row.icon || '🏆' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="成就名称" min-width="150" />
            <el-table-column prop="type" label="类型" width="100">
              <template #default="{ row }">
                <el-tag :type="getTypeTagType(row.type)">
                  {{ getTypeName(row.type) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="desc" label="描述" min-width="200" />
            <el-table-column label="达成条件" min-width="150">
              <template #default="{ row }">
                <span>{{ getConditionText(row) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="奖励" width="120">
              <template #default="{ row }">
                <el-tag type="success" v-if="row.reward">
                  +{{ row.reward.points || 0 }} 积分
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-switch
                  v-model="row.enabled"
                  @change="markDirty(row)"
                />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="editAchievement(row)">编辑</el-button>
                <el-button link type="danger" @click="deleteAchievement(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- 成就统计 -->
      <el-tab-pane label="📊 成就统计" name="stats">
        <div class="stats-section">
          <el-row :gutter="20">
            <el-col :span="6" v-for="(count, type) in achievementStats" :key="type">
              <el-card class="stat-card">
                <div class="stat-label">{{ getTypeName(type) }}</div>
                <div class="stat-value">{{ count }}</div>
              </el-card>
            </el-col>
          </el-row>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 成就编辑对话框 -->
    <el-dialog
      v-model="achievementDialogVisible"
      :title="isEditingAchievement ? '编辑成就' : '新增成就'"
      width="700px"
      :close-on-click-modal="false"
    >
      <el-form :model="achievementForm" label-width="120px" ref="achievementFormRef">
        <el-form-item label="成就ID" prop="id" :rules="[{ required: true, message: '请输入成就ID' }]">
          <el-input v-model="achievementForm.id" placeholder="如：explore_10" :disabled="isEditingAchievement" />
        </el-form-item>
        <el-form-item label="成就名称" prop="name" :rules="[{ required: true, message: '请输入成就名称' }]">
          <el-input v-model="achievementForm.name" placeholder="如：初探者" />
        </el-form-item>
        <el-form-item label="类型" prop="type" :rules="[{ required: true, message: '请选择类型' }]">
          <el-select v-model="achievementForm.type" placeholder="选择类型">
            <el-option label="探索类" value="explore" />
            <el-option label="收藏类" value="collect" />
            <el-option label="社交类" value="social" />
            <el-option label="消费类" value="consumption" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="achievementForm.desc" type="textarea" :rows="2" placeholder="成就描述" />
        </el-form-item>
        <el-form-item label="图标">
          <el-input v-model="achievementForm.icon" placeholder="图标路径或emoji" />
          <div style="margin-top: 8px; font-size: 32px;">{{ achievementForm.icon || '🏆' }}</div>
        </el-form-item>
        <el-form-item label="达成条件类型" prop="conditionType" :rules="[{ required: true }]">
          <el-select v-model="achievementForm.conditionType" placeholder="选择条件类型">
            <el-option label="浏览数量" value="viewCount" />
            <el-option label="收藏数量" value="collectCount" />
            <el-option label="搜索次数" value="searchCount" />
            <el-option label="分享次数" value="shareCount" />
            <el-option label="消费次数" value="purchaseCount" />
            <el-option label="消费金额" value="purchaseAmount" />
            <el-option label="评价次数" value="reviewCount" />
            <el-option label="预约次数" value="bookingCount" />
            <el-option label="连续签到天数" value="checkInDays" />
            <el-option label="证书数量" value="certificateCount" />
          </el-select>
        </el-form-item>
        <el-form-item label="达成阈值" prop="threshold" :rules="[{ required: true, message: '请输入达成阈值' }]">
          <el-input-number v-model="achievementForm.threshold" :min="1" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="奖励积分">
          <el-input-number v-model="achievementForm.rewardPoints" :min="0" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="启用状态">
          <el-switch v-model="achievementForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="achievementDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveAchievement">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { COLLECTIONS, fetchCollectionSorted, cdnAdd, cdnUpdate, cdnRemove, fetchCollectionWhere } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Check } from '@element-plus/icons-vue'

// --- 状态定义 ---
const activeTab = ref('list')
const loading = ref(false)
const saving = ref(false)
const achievementDialogVisible = ref(false)
const isEditingAchievement = ref(false)
const filterType = ref('')
const filterStatus = ref('')

// 成就列表
const achievements = ref([])
const dirtyAchievements = ref(new Set())

// 成就表单
const achievementForm = reactive({
  id: '',
  name: '',
  type: 'explore',
  desc: '',
  icon: '🏆',
  conditionType: 'viewCount',
  threshold: 10,
  rewardPoints: 10,
  enabled: true,
  reward: { points: 10, type: 'points' }
})

// --- 计算属性 ---
const filteredAchievements = computed(() => {
  let filtered = achievements.value
  
  if (filterType.value) {
    filtered = filtered.filter(a => a.type === filterType.value)
  }
  
  if (filterStatus.value) {
    if (filterStatus.value === 'enabled') {
      filtered = filtered.filter(a => a.enabled !== false)
    } else {
      filtered = filtered.filter(a => a.enabled === false)
    }
  }
  
  return filtered
})

const achievementStats = computed(() => {
  const stats = {}
  achievements.value.forEach(achievement => {
    const type = achievement.type || 'other'
    stats[type] = (stats[type] || 0) + 1
  })
  return stats
})

// --- 工具方法 ---
const getTypeName = (type) => {
  const names = {
    explore: '探索类',
    collect: '收藏类',
    social: '社交类',
    consumption: '消费类',
    other: '其他'
  }
  return names[type] || type
}

const getTypeTagType = (type) => {
  const types = {
    explore: '',
    collect: 'success',
    social: 'warning',
    consumption: 'danger',
    other: 'info'
  }
  return types[type] || 'info'
}

const getConditionText = (achievement) => {
  const conditionNames = {
    viewCount: '浏览',
    collectCount: '收藏',
    searchCount: '搜索',
    shareCount: '分享',
    purchaseCount: '购买',
    purchaseAmount: '消费金额',
    reviewCount: '评价',
    bookingCount: '预约',
    checkInDays: '连续签到',
    certificateCount: '证书'
  }
  const name = conditionNames[achievement.conditionType] || achievement.conditionType
  const threshold = achievement.threshold || 0
  return `${name} ${threshold}${achievement.conditionType.includes('Amount') ? '元' : '次'}`
}

const markDirty = (row) => {
  dirtyAchievements.value.add(row.id)
}

const filterAchievements = () => {
  // 使用computed自动过滤
}

// --- 数据加载和保存 ---
const loadAchievements = async () => {
  loading.value = true
  try {
    await fetchCollectionSorted('achievement_configs', {
      limit: 500,
      sortFn: (a, b) => {
        const tc = (a.type || '').localeCompare(b.type || '')
        if (tc !== 0) return tc
        return (a.threshold ?? 0) - (b.threshold ?? 0)
      }
    })
    dirtyAchievements.value.clear()
    ElMessage.success('成就列表加载成功')
  } catch (err) {
    console.error('加载成就列表失败', err)
    ElMessage.error('加载成就列表失败')
  } finally {
    loading.value = false
  }
}

const addAchievement = () => {
  isEditingAchievement.value = false
  Object.assign(achievementForm, {
    id: '',
    name: '',
    type: 'explore',
    desc: '',
    icon: '🏆',
    conditionType: 'viewCount',
    threshold: 10,
    rewardPoints: 10,
    enabled: true,
    reward: { points: 10, type: 'points' }
  })
  achievementDialogVisible.value = true
}

const editAchievement = (row) => {
  isEditingAchievement.value = true
  Object.assign(achievementForm, {
    id: row.id,
    name: row.name,
    type: row.type,
    desc: row.desc || '',
    icon: row.icon || '🏆',
    conditionType: row.conditionType || (row.check ? getConditionTypeFromCheck(row.check) : 'viewCount'),
    threshold: row.threshold || 10,
    rewardPoints: row.reward?.points || 10,
    enabled: row.enabled !== false,
    reward: { points: row.reward?.points || 10, type: 'points' }
  })
  achievementDialogVisible.value = true
}

const getConditionTypeFromCheck = (checkFunc) => {
  // 尝试从check函数字符串推断条件类型
  const funcStr = checkFunc.toString()
  if (funcStr.includes('viewCount')) return 'viewCount'
  if (funcStr.includes('collectCount')) return 'collectCount'
  if (funcStr.includes('searchCount')) return 'searchCount'
  if (funcStr.includes('shareCount')) return 'shareCount'
  if (funcStr.includes('purchaseCount')) return 'purchaseCount'
  if (funcStr.includes('purchaseAmount')) return 'purchaseAmount'
  return 'viewCount'
}

const saveAchievement = async () => {
  if (!achievementForm.id || !achievementForm.name) {
    ElMessage.warning('请填写成就ID和名称')
    return
  }
  
  saving.value = true
  try {
    const data = {
      id: achievementForm.id,
      name: achievementForm.name,
      type: achievementForm.type,
      desc: achievementForm.desc,
      icon: achievementForm.icon,
      conditionType: achievementForm.conditionType,
      threshold: achievementForm.threshold,
      reward: {
        points: achievementForm.rewardPoints || 0,
        type: 'points'
      },
      enabled: achievementForm.enabled !== false,
      _updateTime: new Date()
    }
    
    // 构建check函数（用于小程序端验证）
    data.check = `() => stats.${achievementForm.conditionType} >= ${achievementForm.threshold}`
    
    if (isEditingAchievement.value) {
      // 更新
      const existing = achievements.value.find(a => a.id === achievementForm.id)
      if (existing && existing._id) {
        await cdnUpdate('achievement_configs', existing._id, data)
        ElMessage.success('成就更新成功')
      } else {
        ElMessage.warning('找不到要更新的成就')
      }
    } else {
      // 新增
      // 检查ID是否已存在
      const existing = achievements.value.find(a => a.id === achievementForm.id)
      if (existing) {
        ElMessage.warning('成就ID已存在，请使用不同的ID')
        return
      }
      
      data._createTime = new Date()
      await cdnAdd('achievement_configs', data)
      ElMessage.success('成就创建成功')
    }
    
    achievementDialogVisible.value = false
    loadAchievements()
  } catch (err) {
    console.error('保存成就失败', err)
    ElMessage.error('保存成就失败')
  } finally {
    saving.value = false
  }
}

const saveAllAchievements = async () => {
  if (dirtyAchievements.value.size === 0) {
    ElMessage.info('没有需要保存的更改')
    return
  }
  
  saving.value = true
  try {
    const savePromises = []
    
    for (const achievement of achievements.value) {
      if (dirtyAchievements.value.has(achievement.id)) {
        const data = {
          ...achievement,
          _updateTime: new Date()
        }
        delete data._id
        
        if (achievement._id) {
          savePromises.push(
            cdnUpdate('achievement_configs', achievement._id, data)
          )
        }
      }
    }
    
    await Promise.all(savePromises)
    ElMessage.success('成就保存成功')
    dirtyAchievements.value.clear()
    loadAchievements()
  } catch (err) {
    console.error('保存成就失败', err)
    ElMessage.error('保存成就失败')
  } finally {
    saving.value = false
  }
}

const deleteAchievement = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要删除成就"${row.name}"吗？`, '确认删除', {
      type: 'warning'
    })
    
    if (row._id) {
      await cdnRemove('achievement_configs', row._id)
      ElMessage.success('成就删除成功')
      loadAchievements()
    } else {
      ElMessage.warning('无法删除，缺少ID')
    }
  } catch (err) {
    if (err !== 'cancel') {
      console.error('删除成就失败', err)
      ElMessage.error('删除成就失败')
    }
  }
}

// --- 生命周期 ---
onMounted(() => {
  loadAchievements()
})
</script>

<style scoped>
.achievement-config {
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
  align-items: center;
}

.stats-section {
  margin-top: 20px;
}

.stat-card {
  text-align: center;
  background: linear-gradient(135deg, #fafbfc 0%, #ffffff 100%);
}

.stat-label {
  font-size: 14px;
  color: #5a6c7d;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  color: #d4af37;
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
  font-weight: 500;
}

:deep(.el-input__wrapper) {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.2);
}

:deep(.el-input__inner) {
  color: #2c3e50;
}
</style>


