<template>
  <div class="member-level-config">
    <div class="header-section">
      <h2>会员等级体系配置</h2>
      <p class="subtitle">配置会员等级、成长值门槛、折扣率和权益特权</p>
    </div>

    <div class="config-container">
      <!-- 等级列表 -->
      <div class="levels-section">
        <div class="action-bar">
          <el-button type="primary" @click="addLevel">
            <el-icon><Plus /></el-icon>新增等级
          </el-button>
          <el-button @click="loadLevels">
            <el-icon><Refresh /></el-icon>刷新
          </el-button>
          <el-button type="success" @click="saveAllLevels" :loading="saving">
            <el-icon><Check /></el-icon>保存全部配置
          </el-button>
        </div>

        <el-table 
          :data="levels" 
          v-loading="loading"
          style="margin-top: 20px;"
          row-key="level"
        >
          <el-table-column prop="level" label="等级" width="80" />
          <el-table-column prop="name" label="等级名称" min-width="150" />
          <el-table-column label="成长值门槛" width="120">
            <template #default="{ row }">
              <el-input-number 
                v-model="row.threshold" 
                :min="0" 
                size="small"
                @change="updateLevel(row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="折扣率" width="120">
            <template #default="{ row }">
              <el-input-number 
                v-model="row.discountRate" 
                :min="0" 
                :max="1" 
                :step="0.01"
                :precision="2"
                size="small"
                @change="updateLevel(row)"
              />
              <span style="margin-left: 5px; color: #999;">
                ({{ formatDiscount(row.discountRate) }})
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="icon" label="图标" width="100">
            <template #default="{ row }">
              <el-input 
                v-model="row.icon" 
                placeholder="图标路径"
                size="small"
                @change="updateLevel(row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="权益数量" width="100">
            <template #default="{ row }">
              {{ row.benefits?.length || 0 }} 项
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="editLevel(row)">编辑权益</el-button>
              <el-button link type="danger" @click="deleteLevel(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 成长值规则配置 -->
      <div class="growth-rules-section" style="margin-top: 40px;">
        <h3>成长值获取规则</h3>
        <el-card>
          <el-form :model="growthRules" label-width="180px">
            <el-form-item label="消费金额转成长值">
              <el-input-number 
                v-model="growthRules.consumptionRate" 
                :min="0" 
                :step="0.1"
                :precision="2"
              />
              <span style="margin-left: 10px; color: #999;">元 = 1 成长值</span>
            </el-form-item>
            <el-form-item label="签到奖励成长值">
              <el-input-number 
                v-model="growthRules.checkInPoints" 
                :min="0"
              />
              <span style="margin-left: 10px; color: #999;">每日签到获得</span>
            </el-form-item>
            <el-form-item label="连续签到奖励">
              <el-input-number 
                v-model="growthRules.continuousCheckInBonus" 
                :min="0"
              />
              <span style="margin-left: 10px; color: #999;">连续签到额外奖励</span>
            </el-form-item>
            <el-form-item label="分享奖励成长值">
              <el-input-number 
                v-model="growthRules.sharePoints" 
                :min="0"
              />
              <span style="margin-left: 10px; color: #999;">每次分享获得</span>
            </el-form-item>
            <el-form-item label="评价奖励成长值">
              <el-input-number 
                v-model="growthRules.reviewPoints" 
                :min="0"
              />
              <span style="margin-left: 10px; color: #999;">每次评价获得</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveGrowthRules" :loading="saving">
                保存成长值规则
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </div>
    </div>

    <!-- 编辑等级权益对话框 -->
    <el-dialog 
      v-model="levelDialogVisible" 
      :title="`编辑等级 ${editingLevel?.name || ''} 的权益`"
      width="600px"
      destroy-on-close
    >
      <el-form label-width="100px">
        <el-form-item label="等级名称">
          <el-input v-model="editingLevel.name" />
        </el-form-item>
        <el-form-item label="权益列表">
          <div v-for="(benefit, idx) in editingLevel.benefits" :key="idx" style="display: flex; gap: 10px; margin-bottom: 10px;">
            <el-input v-model="editingLevel.benefits[idx]" placeholder="输入权益内容" />
            <el-button type="danger" icon="Delete" circle size="small" @click="removeBenefit(idx)" />
          </div>
          <el-button type="primary" link icon="Plus" @click="addBenefit">添加权益</el-button>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="levelDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveLevelBenefits">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { COLLECTIONS, fetchCollectionSorted, fetchCollectionWhere, cdnAdd, cdnUpdate, cdnRemove, cdnDocGet, cdnSet } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Check, Delete } from '@element-plus/icons-vue'

const loading = ref(false)
const saving = ref(false)
const levels = ref([])
const levelDialogVisible = ref(false)
const editingLevel = ref(null)

// 成长值规则
const growthRules = reactive({
  consumptionRate: 1, // 消费1元 = 1成长值
  checkInPoints: 5, // 每日签到5成长值
  continuousCheckInBonus: 10, // 连续签到额外10成长值
  sharePoints: 2, // 每次分享2成长值
  reviewPoints: 3 // 每次评价3成长值
})

// 格式化折扣显示
const formatDiscount = (rate) => {
  if (rate >= 1) return '无折扣'
  return `${(rate * 10).toFixed(1)}折`
}

// 加载等级配置
const loadLevels = async () => {
  loading.value = true
  try {
    const rows = await fetchCollectionSorted(COLLECTIONS.MEMBER_LEVELS, {
      limit: 50,
      sortFn: (a, b) => (a.level ?? 0) - (b.level ?? 0)
    })

    if (rows.length > 0) {
      levels.value = rows
    } else {
      // 初始化默认等级
      levels.value = [
        { level: 1, name: '原木·见习者', threshold: 0, discountRate: 1.0, icon: '/assets/icons/knowledge.png', benefits: ['基础权益', '浏览收藏', '参与活动'] },
        { level: 2, name: '秘银·采集家', threshold: 500, discountRate: 0.98, icon: '/assets/icons/star.png', benefits: ['9.8折优惠', '优先预约', '生日礼包'] },
        { level: 3, name: '流金·研究员', threshold: 3000, discountRate: 0.95, icon: '/assets/icons/star-active.png', benefits: ['9.5折优惠', '专属客服', '优先预约', '生日礼包'] },
        { level: 4, name: '曜石·策展人', threshold: 10000, discountRate: 0.90, icon: '/assets/icons/medal_gold.png', benefits: ['9折优惠', '专属客服', '优先预约', '生日礼包', '专属活动'] },
        { level: 5, name: '星陨·守护者', threshold: 30000, discountRate: 0.85, icon: '/assets/icons/medal_gold.png', benefits: ['8.5折优惠', '专属客服', '优先预约', '生日礼包', '专属活动', '定制服务'] }
      ]
    }

    // 加载成长值规则
    try {
      const rulesData = await cdnDocGet('configs', 'member_growth_rules')
      if (rulesData) {
        Object.assign(growthRules, rulesData)
      }
    } catch (error) {
      console.warn('加载成长值规则失败，使用默认值:', error)
    }
  } catch (error) {
    console.error('加载等级配置失败:', error)
    ElMessage.error('加载配置失败')
  } finally {
    loading.value = false
  }
}

// 更新等级
const updateLevel = async (level) => {
  try {
    const existing = await fetchCollectionWhere(COLLECTIONS.MEMBER_LEVELS, { level: level.level }, 1)
    if (existing.length > 0) {
      await cdnUpdate(COLLECTIONS.MEMBER_LEVELS, existing[0]._id, {
        ...level,
        _updateTime: Date.now()
      })
    } else {
      await cdnAdd(COLLECTIONS.MEMBER_LEVELS, {
        ...level,
        _createTime: Date.now(),
        _updateTime: Date.now()
      })
    }
  } catch (error) {
    console.error('更新等级失败:', error)
  }
}

// 新增等级
const addLevel = () => {
  const maxLevel = levels.value.length > 0 
    ? Math.max(...levels.value.map(l => l.level)) 
    : 0
  
  const newLevel = {
    level: maxLevel + 1,
    name: `等级${maxLevel + 1}`,
    threshold: 0,
    discountRate: 1.0,
    icon: '',
    benefits: []
  }
  
  levels.value.push(newLevel)
  updateLevel(newLevel)
}

// 编辑等级权益
const editLevel = (level) => {
  editingLevel.value = JSON.parse(JSON.stringify(level))
  levelDialogVisible.value = true
}

// 添加权益
const addBenefit = () => {
  if (!editingLevel.value.benefits) {
    editingLevel.value.benefits = []
  }
  editingLevel.value.benefits.push('')
}

// 移除权益
const removeBenefit = (idx) => {
  editingLevel.value.benefits.splice(idx, 1)
}

// 保存等级权益
const saveLevelBenefits = async () => {
  try {
    const index = levels.value.findIndex(l => l.level === editingLevel.value.level)
    if (index >= 0) {
      levels.value[index] = { ...editingLevel.value }
      await updateLevel(editingLevel.value)
      ElMessage.success('权益配置已保存')
      levelDialogVisible.value = false
    }
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

// 删除等级
const deleteLevel = async (level) => {
  try {
    await ElMessageBox.confirm(
      `确定删除等级 ${level.name} 吗？`,
      '确认删除',
      { type: 'warning' }
    )

    const existing = await fetchCollectionWhere(COLLECTIONS.MEMBER_LEVELS, { level: level.level }, 1)
    if (existing.length > 0) {
      await cdnRemove(COLLECTIONS.MEMBER_LEVELS, existing[0]._id)
      
      levels.value = levels.value.filter(l => l.level !== level.level)
      ElMessage.success('删除成功')
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

// 保存全部等级
const saveAllLevels = async () => {
  saving.value = true
  try {
    for (const level of levels.value) {
      await updateLevel(level)
    }
    ElMessage.success('全部配置已保存')
  } catch (error) {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

const saveGrowthRules = async () => {
  saving.value = true
  try {
    const existing = await cdnDocGet('configs', 'member_growth_rules')
    const payload = {
      ...growthRules,
      _updateTime: Date.now()
    }
    if (existing) {
      await cdnUpdate('configs', 'member_growth_rules', payload)
    } else {
      await cdnSet('configs', 'member_growth_rules', {
        ...payload,
        _createTime: Date.now()
      })
    }
    ElMessage.success('成长值规则已保存')
  } catch (error) {
    console.error('保存成长值规则失败:', error)
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadLevels()
})
</script>

<style scoped>
.member-level-config {
  padding: 24px;
  background: linear-gradient(135deg, #fafbfc 0%, #f0f2f5 100%);
  min-height: calc(100vh - 120px);
  color: #2c3e50;
}

.header-section {
  margin-bottom: 30px;
}

.header-section h2 {
  color: #d4af37;
  margin: 0 0 8px 0;
  font-size: 24px;
}

.subtitle {
  color: #5a6c7d;
  margin: 0;
  font-size: 14px;
}

.config-container {
  background: #ffffff;
  border-radius: 12px;
  padding: 24px;
  border: 1px solid rgba(212, 175, 55, 0.2);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

.action-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.levels-section h3,
.growth-rules-section h3 {
  color: #d4af37;
  margin-bottom: 20px;
  font-size: 18px;
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

:deep(.el-card) {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.2);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

:deep(.el-card__body) {
  color: #2c3e50;
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

:deep(.el-dialog__header) {
  border-bottom: 1px solid rgba(212, 175, 55, 0.2);
}

:deep(.el-dialog__title) {
  color: #d4af37;
}

:deep(.el-dialog__body) {
  color: #2c3e50;
}
</style>

