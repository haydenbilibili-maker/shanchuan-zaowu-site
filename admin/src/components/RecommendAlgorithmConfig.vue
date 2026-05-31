<template>
  <div class="recommend-algorithm-config">
    <div class="header-section">
      <h2>推荐算法配置</h2>
      <p class="subtitle">配置推荐算法类型、权重参数和推荐数量</p>
    </div>

    <div class="config-container">
      <!-- 算法类型配置 -->
      <el-card class="config-card" style="margin-bottom: 24px;">
        <template #header>
          <div class="card-header">
            <span>算法类型配置</span>
            <el-button type="primary" @click="saveAlgorithmConfig" :loading="saving">
              <el-icon><Check /></el-icon>保存配置
            </el-button>
          </div>
        </template>

        <el-form :model="algorithmConfig" label-width="180px">
          <el-form-item label="当前算法">
            <el-radio-group v-model="algorithmConfig.algorithmType">
              <el-radio label="mixed">混合推荐（推荐）</el-radio>
              <el-radio label="collaborative">协同过滤</el-radio>
              <el-radio label="content">内容推荐</el-radio>
              <el-radio label="hot">热门推荐</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="算法说明">
            <el-alert
              :title="getAlgorithmDescription(algorithmConfig.algorithmType)"
              type="info"
              :closable="false"
              show-icon
            />
          </el-form-item>

          <el-form-item label="推荐数量">
            <el-input-number 
              v-model="algorithmConfig.recommendCount" 
              :min="5" 
              :max="50" 
              :step="5"
            />
            <span style="margin-left: 10px; color: #5a6c7d;">条（建议10-20条）</span>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 权重配置 -->
      <el-card class="config-card" style="margin-bottom: 24px;">
        <template #header>
          <span>权重配置</span>
        </template>

        <el-form :model="algorithmConfig" label-width="180px">
          <el-form-item label="浏览权重">
            <el-slider 
              v-model="algorithmConfig.weights.view" 
              :min="0" 
              :max="100" 
              :step="5"
              show-input
              show-stops
            />
            <span style="margin-left: 10px; color: #5a6c7d;">影响推荐的相关性</span>
          </el-form-item>

          <el-form-item label="收藏权重">
            <el-slider 
              v-model="algorithmConfig.weights.collect" 
              :min="0" 
              :max="100" 
              :step="5"
              show-input
              show-stops
            />
            <span style="margin-left: 10px; color: #5a6c7d;">用户收藏行为权重</span>
          </el-form-item>

          <el-form-item label="购买权重">
            <el-slider 
              v-model="algorithmConfig.weights.purchase" 
              :min="0" 
              :max="100" 
              :step="5"
              show-input
              show-stops
            />
            <span style="margin-left: 10px; color: #5a6c7d;">购买行为权重（最高）</span>
          </el-form-item>

          <el-form-item label="分享权重">
            <el-slider 
              v-model="algorithmConfig.weights.share" 
              :min="0" 
              :max="100" 
              :step="5"
              show-input
              show-stops
            />
            <span style="margin-left: 10px; color: #5a6c7d;">分享行为权重</span>
          </el-form-item>

          <el-form-item label="评价权重">
            <el-slider 
              v-model="algorithmConfig.weights.review" 
              :min="0" 
              :max="100" 
              :step="5"
              show-input
              show-stops
            />
            <span style="margin-left: 10px; color: #5a6c7d;">评价行为权重</span>
          </el-form-item>

          <el-form-item>
            <el-button @click="resetWeights">重置为默认值</el-button>
            <el-button type="info" @click="normalizeWeights">自动归一化</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 高级配置 -->
      <el-card class="config-card">
        <template #header>
          <span>高级配置</span>
        </template>

        <el-form :model="algorithmConfig" label-width="180px">
          <el-form-item label="时间衰减因子">
            <el-slider 
              v-model="algorithmConfig.timeDecay" 
              :min="0" 
              :max="1" 
              :step="0.1"
              :format-tooltip="formatDecayTooltip"
            />
            <span style="margin-left: 10px; color: #5a6c7d;">
              {{ algorithmConfig.timeDecay === 0 ? '不考虑时间' : algorithmConfig.timeDecay === 1 ? '强时间衰减' : '中等时间衰减' }}
            </span>
          </el-form-item>

          <el-form-item label="冷启动策略">
            <el-radio-group v-model="algorithmConfig.coldStartStrategy">
              <el-radio label="popular">热门内容</el-radio>
              <el-radio label="diverse">多样化内容</el-radio>
              <el-radio label="random">随机推荐</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="多样性系数">
            <el-slider 
              v-model="algorithmConfig.diversity" 
              :min="0" 
              :max="100" 
              :step="5"
            />
            <span style="margin-left: 10px; color: #5a6c7d;">值越大推荐内容越多样</span>
          </el-form-item>

          <el-form-item label="个性化程度">
            <el-slider 
              v-model="algorithmConfig.personalization" 
              :min="0" 
              :max="100" 
              :step="5"
            />
            <span style="margin-left: 10px; color: #5a6c7d;">值越大越个性化</span>
          </el-form-item>

          <el-form-item label="启用A/B测试">
            <el-switch v-model="algorithmConfig.enableABTest" />
            <span style="margin-left: 10px; color: #5a6c7d;">对比不同算法效果</span>
          </el-form-item>

          <el-form-item v-if="algorithmConfig.enableABTest" label="A/B测试流量分配">
            <el-input-number 
              v-model="algorithmConfig.abTestRatio" 
              :min="0" 
              :max="100" 
              :step="10"
            />
            <span style="margin-left: 10px; color: #5a6c7d;">% 用户使用新算法</span>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 算法效果预览 -->
      <el-card class="config-card" style="margin-top: 24px;">
        <template #header>
          <div class="card-header">
            <span>算法效果预览</span>
            <el-button type="primary" @click="testAlgorithm" :loading="testing">
              <el-icon><Refresh /></el-icon>测试算法
            </el-button>
          </div>
        </template>

        <div v-if="testResults.length > 0">
          <el-table :data="testResults" style="width: 100%">
            <el-table-column prop="rank" label="排名" width="80" />
            <el-table-column prop="title" label="内容标题" min-width="200" />
            <el-table-column prop="type" label="类型" width="100" />
            <el-table-column prop="score" label="推荐分数" width="120">
              <template #default="{ row }">
                <span style="color: #409eff; font-weight: bold;">{{ row.score.toFixed(2) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="reason" label="推荐理由" min-width="200" />
          </el-table>
        </div>
        <el-empty v-else description='点击"测试算法"查看推荐效果' />
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { cdnDocGet, cdnUpsertDoc } from '../cloud'
import { ElMessage } from 'element-plus'
import { Check, Refresh } from '@element-plus/icons-vue'

// --- 状态定义 ---
const saving = ref(false)
const testing = ref(false)
const testResults = ref([])

// 算法配置
const algorithmConfig = reactive({
  algorithmType: 'mixed',
  recommendCount: 15,
  weights: {
    view: 30,
    collect: 50,
    purchase: 100,
    share: 40,
    review: 60
  },
  timeDecay: 0.5,
  coldStartStrategy: 'popular',
  diversity: 30,
  personalization: 70,
  enableABTest: false,
  abTestRatio: 50
})

// --- 工具方法 ---
const getAlgorithmDescription = (type) => {
  const descriptions = {
    mixed: '混合推荐：综合协同过滤、内容推荐和热门推荐，效果最佳，推荐使用',
    collaborative: '协同过滤：基于用户相似度和物品相似度，适合有丰富用户行为数据',
    content: '内容推荐：基于内容特征相似度，适合新用户或冷启动场景',
    hot: '热门推荐：基于热门度和时效性，简单有效但个性化程度低'
  }
  return descriptions[type] || descriptions.mixed
}

const formatDecayTooltip = (val) => {
  if (val === 0) return '不考虑时间'
  if (val <= 0.3) return '弱时间衰减'
  if (val <= 0.7) return '中等时间衰减'
  return '强时间衰减'
}

const resetWeights = () => {
  algorithmConfig.weights = {
    view: 30,
    collect: 50,
    purchase: 100,
    share: 40,
    review: 60
  }
  ElMessage.success('权重已重置为默认值')
}

const normalizeWeights = () => {
  const weights = algorithmConfig.weights
  const total = Object.values(weights).reduce((sum, val) => sum + val, 0)
  if (total === 0) return
  
  Object.keys(weights).forEach(key => {
    weights[key] = Math.round((weights[key] / total) * 100)
  })
  ElMessage.success('权重已归一化')
}

// --- 数据加载和保存 ---
const loadAlgorithmConfig = async () => {
  try {
    const doc = await cdnDocGet('recommend_algorithm_config', 'default')
    if (doc) {
      Object.assign(algorithmConfig, doc)
      if (!algorithmConfig.weights) {
        algorithmConfig.weights = {
          view: 30,
          collect: 50,
          purchase: 100,
          share: 40,
          review: 60
        }
      }
    }
  } catch (err) {
    console.error('加载算法配置失败', err)
  }
}

const saveAlgorithmConfig = async () => {
  saving.value = true
  try {
    await cdnUpsertDoc('recommend_algorithm_config', 'default', {
      ...algorithmConfig,
      _updateTime: new Date()
    })
    ElMessage.success('算法配置保存成功')
  } catch (err) {
    console.error('保存算法配置失败', err)
    ElMessage.error('保存算法配置失败')
  } finally {
    saving.value = false
  }
}

const testAlgorithm = async () => {
  testing.value = true
  testResults.value = []
  
  try {
    // 模拟算法测试结果
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // 这里应该调用实际的推荐算法或API
    // 目前使用模拟数据
    const mockResults = [
      { rank: 1, title: 'Morpho Didius 大蓝闪蝶', type: '藏品', score: 95.5, reason: '基于您的浏览历史和收藏偏好' },
      { rank: 2, title: '水晶甲虫标本', type: '藏品', score: 92.3, reason: '热门推荐，同类用户喜欢' },
      { rank: 3, title: '独角仙标本制作课程', type: '活动', score: 88.7, reason: '基于您的预约记录' },
      { rank: 4, title: 'Gold Collection 专题展', type: '专题', score: 85.2, reason: '内容相似度匹配' },
      { rank: 5, title: '镇店之宝系列', type: '藏品', score: 82.1, reason: '高评分推荐' }
    ]
    
    testResults.value = mockResults
    ElMessage.success('算法测试完成')
  } catch (err) {
    console.error('算法测试失败', err)
    ElMessage.error('算法测试失败')
  } finally {
    testing.value = false
  }
}

// --- 生命周期 ---
onMounted(() => {
  loadAlgorithmConfig()
})
</script>

<style scoped>
.recommend-algorithm-config {
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

.config-container {
  max-width: 1200px;
}

.config-card {
  background: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.2);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

:deep(.el-card__header) {
  background: linear-gradient(135deg, #fafbfc 0%, #ffffff 100%);
  border-bottom: 2px solid rgba(212, 175, 55, 0.15);
  font-weight: 700;
  color: #2c3e50;
}

:deep(.el-form-item__label) {
  color: #2c3e50;
  font-weight: 500;
}

:deep(.el-slider__runway) {
  background-color: rgba(212, 175, 55, 0.2);
}

:deep(.el-slider__bar) {
  background-color: #d4af37;
}

:deep(.el-slider__button) {
  border-color: #d4af37;
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
</style>
