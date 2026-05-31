<template>
  <div class="search-keywords-manager">
    <div class="header-section">
      <h2>搜索关键词管理</h2>
      <p class="subtitle">配置热门关键词、黑名单，查看搜索统计数据</p>
    </div>

    <el-tabs v-model="activeTab" type="card" class="config-tabs">
      <!-- 热门关键词配置 -->
      <el-tab-pane label="🔥 热门关键词" name="hot">
        <div class="hot-keywords-section">
          <div class="action-bar">
            <el-button type="primary" @click="addHotKeyword">
              <el-icon><Plus /></el-icon>新增关键词
            </el-button>
            <el-button @click="loadHotKeywords">
              <el-icon><Refresh /></el-icon>刷新
            </el-button>
            <el-button type="success" @click="saveAllHotKeywords" :loading="saving">
              <el-icon><Check /></el-icon>保存全部
            </el-button>
          </div>

          <el-table 
            :data="hotKeywords" 
            v-loading="loading"
            style="margin-top: 20px;"
            row-key="_id"
            :default-sort="{ prop: 'sortOrder', order: 'ascending' }"
          >
            <el-table-column type="index" label="排序" width="80" :index="indexMethod" />
            <el-table-column label="关键词" min-width="200">
              <template #default="{ row }">
                <el-input 
                  v-model="row.keyword" 
                  placeholder="请输入关键词"
                  size="small"
                  @change="markDirty(row)"
                />
              </template>
            </el-table-column>
            <el-table-column label="置顶" width="100">
              <template #default="{ row }">
                <el-switch
                  v-model="row.isPinned"
                  @change="markDirty(row)"
                />
              </template>
            </el-table-column>
            <el-table-column label="显示顺序" width="150">
              <template #default="{ row }">
                <el-input-number 
                  v-model="row.sortOrder" 
                  :min="0"
                  size="small"
                  @change="markDirty(row)"
                />
              </template>
            </el-table-column>
            <el-table-column label="搜索次数" width="120">
              <template #default="{ row }">
                {{ getKeywordStats(row.keyword)?.searchCount || 0 }}
              </template>
            </el-table-column>
            <el-table-column label="点击次数" width="120">
              <template #default="{ row }">
                {{ getKeywordStats(row.keyword)?.clickCount || 0 }}
              </template>
            </el-table-column>
            <el-table-column label="转化率" width="120">
              <template #default="{ row }">
                {{ formatConversionRate(getKeywordStats(row.keyword)) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button link type="danger" @click="deleteHotKeyword(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="tips-section">
            <el-alert
              title="使用说明"
              type="info"
              :closable="false"
              show-icon
            >
              <template #default>
                <p>• 置顶的关键词将优先显示在搜索结果页面</p>
                <p>• 显示顺序数字越小越靠前，相同顺序按创建时间排序</p>
                <p>• 建议配置5-10个热门关键词，提升用户体验</p>
              </template>
            </el-alert>
          </div>
        </div>
      </el-tab-pane>

      <!-- 关键词黑名单 -->
      <el-tab-pane label="🚫 黑名单" name="blacklist">
        <div class="blacklist-section">
          <div class="action-bar">
            <el-input
              v-model="newBlacklistKeyword"
              placeholder="输入要屏蔽的关键词"
              style="width: 300px; margin-right: 10px;"
              @keyup.enter="addBlacklistKeyword"
            >
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-button type="primary" @click="addBlacklistKeyword">
              <el-icon><Plus /></el-icon>添加
            </el-button>
            <el-button @click="loadBlacklist">
              <el-icon><Refresh /></el-icon>刷新
            </el-button>
          </div>

          <el-table 
            :data="blacklist" 
            v-loading="loading"
            style="margin-top: 20px;"
            row-key="_id"
          >
            <el-table-column prop="keyword" label="屏蔽关键词" min-width="200" />
            <el-table-column prop="reason" label="屏蔽原因" min-width="200">
              <template #default="{ row }">
                <el-input 
                  v-model="row.reason" 
                  placeholder="输入屏蔽原因（可选）"
                  size="small"
                  @change="updateBlacklistItem(row)"
                />
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="添加时间" width="180">
              <template #default="{ row }">
                {{ formatTime(row.createdAt) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button link type="danger" @click="deleteBlacklistItem(row)">移除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="tips-section">
            <el-alert
              title="黑名单说明"
              type="warning"
              :closable="false"
              show-icon
            >
              <template #default>
                <p>• 添加到黑名单的关键词将不会出现在搜索建议和热门关键词中</p>
                <p>• 用户搜索黑名单关键词时，将显示"无搜索结果"</p>
                <p>• 支持正则表达式匹配（如：*test*）</p>
              </template>
            </el-alert>
          </div>
        </div>
      </el-tab-pane>

      <!-- 搜索统计 -->
      <el-tab-pane label="📊 搜索统计" name="stats">
        <div class="stats-section">
          <div class="filter-bar">
            <el-date-picker
              v-model="statsDateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              style="width: 350px; margin-right: 10px;"
            />
            <el-select
              v-model="statsSortBy"
              placeholder="排序方式"
              style="width: 150px; margin-right: 10px;"
            >
              <el-option label="搜索次数" value="searchCount" />
              <el-option label="点击次数" value="clickCount" />
              <el-option label="转化率" value="conversionRate" />
            </el-select>
            <el-input-number
              v-model="statsLimit"
              :min="10"
              :max="100"
              :step="10"
              placeholder="显示数量"
              style="width: 120px; margin-right: 10px;"
            />
            <el-button type="primary" @click="loadSearchStats">
              <el-icon><Search /></el-icon>查询
            </el-button>
            <el-button @click="resetStatsFilters">
              <el-icon><Refresh /></el-icon>重置
            </el-button>
          </div>

          <el-table 
            :data="searchStats" 
            v-loading="loading"
            style="margin-top: 20px;"
            :default-sort="{ prop: statsSortBy, order: 'descending' }"
          >
            <el-table-column prop="keyword" label="关键词" min-width="200" />
            <el-table-column prop="searchCount" label="搜索次数" width="120" sortable>
              <template #default="{ row }">
                <span style="color: #409eff; font-weight: bold;">{{ row.searchCount }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="clickCount" label="点击次数" width="120" sortable>
              <template #default="{ row }">
                <span style="color: #67c23a; font-weight: bold;">{{ row.clickCount }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="viewCount" label="查看详情次数" width="140" sortable>
              <template #default="{ row }">
                <span style="color: #e6a23c;">{{ row.viewCount || 0 }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="purchaseCount" label="购买次数" width="120" sortable>
              <template #default="{ row }">
                <span style="color: #f56c6c; font-weight: bold;">{{ row.purchaseCount || 0 }}</span>
              </template>
            </el-table-column>
            <el-table-column label="点击率" width="120" sortable>
              <template #default="{ row }">
                {{ formatPercentage(row.clickCount / row.searchCount) }}
              </template>
            </el-table-column>
            <el-table-column label="转化率" width="120" sortable>
              <template #default="{ row }">
                {{ formatConversionRate(row) }}
              </template>
            </el-table-column>
          </el-table>

          <div class="stats-summary" style="margin-top: 20px;">
            <el-card>
              <template #header>
                <span style="font-weight: bold;">统计概览</span>
              </template>
              <el-row :gutter="20">
                <el-col :span="6">
                  <div class="stat-item">
                    <div class="stat-label">总搜索次数</div>
                    <div class="stat-value" style="color: #409eff;">{{ totalStats.searchCount }}</div>
                  </div>
                </el-col>
                <el-col :span="6">
                  <div class="stat-item">
                    <div class="stat-label">总点击次数</div>
                    <div class="stat-value" style="color: #67c23a;">{{ totalStats.clickCount }}</div>
                  </div>
                </el-col>
                <el-col :span="6">
                  <div class="stat-item">
                    <div class="stat-label">平均点击率</div>
                    <div class="stat-value" style="color: #e6a23c;">{{ formatPercentage(totalStats.clickCount / totalStats.searchCount) }}</div>
                  </div>
                </el-col>
                <el-col :span="6">
                  <div class="stat-item">
                    <div class="stat-label">平均转化率</div>
                    <div class="stat-value" style="color: #f56c6c;">{{ formatConversionRate(totalStats) }}</div>
                  </div>
                </el-col>
              </el-row>
            </el-card>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import {
  fetchCollectionSorted,
  fetchCollectionWhere,
  cdnAdd,
  cdnUpdate,
  cdnRemove,
} from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Search, Check } from '@element-plus/icons-vue'

// --- 状态定义 ---
const activeTab = ref('hot')
const loading = ref(false)
const saving = ref(false)

// 热门关键词
const hotKeywords = ref([])
const dirtyKeywords = ref(new Set())

// 黑名单
const blacklist = ref([])
const newBlacklistKeyword = ref('')

// 搜索统计
const searchStats = ref([])
const statsDateRange = ref(null)
const statsSortBy = ref('searchCount')
const statsLimit = ref(50)
const totalStats = reactive({
  searchCount: 0,
  clickCount: 0,
  viewCount: 0,
  purchaseCount: 0
})

// 关键词统计数据缓存
const keywordStatsCache = ref({})

// --- 工具方法 ---
const formatTime = (time) => {
  if (!time) return '-'
  return new Date(time).toLocaleString('zh-CN')
}

const formatPercentage = (value) => {
  if (!value || isNaN(value)) return '0%'
  return (value * 100).toFixed(2) + '%'
}

const formatConversionRate = (stats) => {
  if (!stats) return '0%'
  const { searchCount, purchaseCount } = stats
  if (!searchCount || searchCount === 0) return '0%'
  return formatPercentage((purchaseCount || 0) / searchCount)
}

const indexMethod = (index) => {
  return index + 1
}

const markDirty = (row) => {
  dirtyKeywords.value.add(row._id)
}

// --- 热门关键词管理 ---
const loadHotKeywords = async () => {
  loading.value = true
  try {
    hotKeywords.value = await fetchCollectionSorted('search_hot_keywords', {
      limit: 500,
      sortFn: (a, b) => {
        const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
        if (so !== 0) return so
        return (a._createTime || 0) - (b._createTime || 0)
      }
    })
    dirtyKeywords.value.clear()
  } catch (err) {
    console.error('加载热门关键词失败', err)
    hotKeywords.value = []
    ElMessage.error('加载热门关键词失败')
  } finally {
    loading.value = false
  }
}

const addHotKeyword = () => {
  const maxOrder = hotKeywords.value.length > 0 
    ? Math.max(...hotKeywords.value.map(k => k.sortOrder || 0))
    : 0
  
  hotKeywords.value.push({
    _id: null,
    keyword: '',
    isPinned: false,
    sortOrder: maxOrder + 1,
    _isNew: true
  })
  markDirty(hotKeywords.value[hotKeywords.value.length - 1])
}

const saveAllHotKeywords = async () => {
  if (dirtyKeywords.value.size === 0) {
    ElMessage.info('没有需要保存的更改')
    return
  }
  
  saving.value = true
  try {
    const savePromises = []
    
    for (const keyword of hotKeywords.value) {
      if (keyword._isNew) {
        // 新增
        if (keyword.keyword) {
          savePromises.push(
            cdnAdd('search_hot_keywords', {
              keyword: keyword.keyword,
              isPinned: keyword.isPinned || false,
              sortOrder: keyword.sortOrder || 0,
              _createTime: new Date()
            })
          )
        }
      } else if (dirtyKeywords.value.has(keyword._id)) {
        // 更新
        savePromises.push(
          cdnUpdate('search_hot_keywords', keyword._id, {
            keyword: keyword.keyword,
            isPinned: keyword.isPinned || false,
            sortOrder: keyword.sortOrder || 0,
            _updateTime: new Date()
          })
        )
      }
    }
    
    await Promise.all(savePromises)
    ElMessage.success('热门关键词保存成功')
    dirtyKeywords.value.clear()
    loadHotKeywords()
  } catch (err) {
    console.error('保存热门关键词失败', err)
    ElMessage.error('保存热门关键词失败')
  } finally {
    saving.value = false
  }
}

const deleteHotKeyword = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要删除关键词"${row.keyword}"吗？`, '确认删除', {
      type: 'warning'
    })
    
    if (row._isNew) {
      // 如果是新建的，直接从数组中移除
      const index = hotKeywords.value.findIndex(k => k === row)
      if (index > -1) {
        hotKeywords.value.splice(index, 1)
      }
      dirtyKeywords.value.delete(row._id)
      ElMessage.success('关键词已移除')
    } else {
      await cdnRemove('search_hot_keywords', row._id)
      ElMessage.success('关键词删除成功')
      loadHotKeywords()
    }
  } catch (err) {
    if (err !== 'cancel') {
      console.error('删除关键词失败', err)
      ElMessage.error('删除关键词失败')
    }
  }
}

// --- 黑名单管理 ---
const loadBlacklist = async () => {
  loading.value = true
  try {
    blacklist.value = await fetchCollectionSorted('search_blacklist', {
      limit: 500,
      sortFn: (a, b) => (b._createTime || 0) - (a._createTime || 0)
    })
  } catch (err) {
    console.error('加载黑名单失败', err)
    blacklist.value = []
    ElMessage.error('加载黑名单失败')
  } finally {
    loading.value = false
  }
}

const addBlacklistKeyword = async () => {
  if (!newBlacklistKeyword.value.trim()) {
    ElMessage.warning('请输入要屏蔽的关键词')
    return
  }
  
  const keyword = newBlacklistKeyword.value.trim()
  
  // 检查是否已存在
  const exists = blacklist.value.some(item => item.keyword === keyword)
  if (exists) {
    ElMessage.warning('该关键词已在黑名单中')
    return
  }
  
  try {
    await cdnAdd('search_blacklist', {
      keyword: keyword,
      reason: '',
      createdAt: new Date(),
      _createTime: new Date()
    })
    ElMessage.success('黑名单关键词添加成功')
    newBlacklistKeyword.value = ''
    loadBlacklist()
  } catch (err) {
    console.error('添加黑名单关键词失败', err)
    ElMessage.error('添加黑名单关键词失败')
  }
}

const updateBlacklistItem = async (row) => {
  try {
    await cdnUpdate('search_blacklist', row._id, {
      reason: row.reason,
      _updateTime: new Date()
    })
    ElMessage.success('更新成功')
  } catch (err) {
    console.error('更新黑名单项失败', err)
    ElMessage.error('更新失败')
  }
}

const deleteBlacklistItem = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要从黑名单中移除"${row.keyword}"吗？`, '确认移除', {
      type: 'warning'
    })
    
    await cdnRemove('search_blacklist', row._id)
    ElMessage.success('黑名单项移除成功')
    loadBlacklist()
  } catch (err) {
    if (err !== 'cancel') {
      console.error('移除黑名单项失败', err)
      ElMessage.error('移除失败')
    }
  }
}

// --- 搜索统计 ---
const inTimeRange = (timestamp, timeStart, timeEnd) => {
  if (!timeStart || !timeEnd) return true
  const ts = timestamp ?? 0
  return ts >= timeStart.getTime() && ts <= timeEnd.getTime()
}

const loadSearchStats = async () => {
  loading.value = true
  try {
    let timeStart = null
    let timeEnd = null
    if (statsDateRange.value && statsDateRange.value.length === 2) {
      timeStart = new Date(statsDateRange.value[0])
      timeStart.setHours(0, 0, 0, 0)
      timeEnd = new Date(statsDateRange.value[1])
      timeEnd.setHours(23, 59, 59, 999)
    }

    const searchRows = await fetchCollectionWhere('user_behaviors', { action: 'search' }, 2000)
    const clickRows = await fetchCollectionWhere('user_behaviors', { action: 'click', source: 'search' }, 2000)

    const keywordMap = new Map()

    searchRows.filter(b => inTimeRange(b.timestamp, timeStart, timeEnd)).forEach(behavior => {
      const keyword = behavior.keyword || behavior.targetId || ''
      if (!keyword || !keyword.trim()) return
      
      const normalizedKeyword = keyword.trim()
      if (!keywordMap.has(normalizedKeyword)) {
        keywordMap.set(normalizedKeyword, {
          keyword: normalizedKeyword,
          searchCount: 0,
          clickCount: 0,
          viewCount: 0,
          purchaseCount: 0
        })
      }
      
      const stats = keywordMap.get(normalizedKeyword)
      stats.searchCount++
    })

    clickRows.filter(b => inTimeRange(b.timestamp, timeStart, timeEnd)).forEach(behavior => {
      const keyword = behavior.searchKeyword || ''
      if (!keyword || !keyword.trim()) return
      
      const normalizedKeyword = keyword.trim()
      if (keywordMap.has(normalizedKeyword)) {
        keywordMap.get(normalizedKeyword).clickCount++
      }
    })
    
    // 查询查看详情和购买行为（可以通过targetId关联）
    // 这里简化处理，实际可能需要更复杂的关联查询
    
    // 转换为数组并排序
    const statsArray = Array.from(keywordMap.values())
      .sort((a, b) => {
        if (statsSortBy.value === 'searchCount') return b.searchCount - a.searchCount
        if (statsSortBy.value === 'clickCount') return b.clickCount - a.clickCount
        if (statsSortBy.value === 'conversionRate') {
          const rateA = (a.purchaseCount || 0) / a.searchCount
          const rateB = (b.purchaseCount || 0) / b.searchCount
          return rateB - rateA
        }
        return 0
      })
      .slice(0, statsLimit.value)
    
    searchStats.value = statsArray
    
    // 计算总计
    totalStats.searchCount = statsArray.reduce((sum, s) => sum + s.searchCount, 0)
    totalStats.clickCount = statsArray.reduce((sum, s) => sum + s.clickCount, 0)
    totalStats.viewCount = statsArray.reduce((sum, s) => sum + (s.viewCount || 0), 0)
    totalStats.purchaseCount = statsArray.reduce((sum, s) => sum + (s.purchaseCount || 0), 0)
    
    // 更新缓存
    statsArray.forEach(stat => {
      keywordStatsCache.value[stat.keyword] = stat
    })
    
  } catch (err) {
    console.error('加载搜索统计失败', err)
    ElMessage.error('加载搜索统计失败')
  } finally {
    loading.value = false
  }
}

const resetStatsFilters = () => {
  statsDateRange.value = null
  statsSortBy.value = 'searchCount'
  statsLimit.value = 50
  loadSearchStats()
}

const getKeywordStats = (keyword) => {
  return keywordStatsCache.value[keyword] || null
}

// --- 生命周期 ---
onMounted(() => {
  loadHotKeywords()
  loadBlacklist()
  loadSearchStats()
})
</script>

<style scoped>
.search-keywords-manager {
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

.tips-section {
  margin-top: 20px;
}

.stats-summary {
  margin-top: 20px;
}

.stat-item {
  text-align: center;
  padding: 15px;
}

.stat-label {
  font-size: 14px;
  color: #5a6c7d;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
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
</style>


