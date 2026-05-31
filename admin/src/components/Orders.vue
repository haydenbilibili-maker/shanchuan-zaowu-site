<template>
  <div class="order-container">
    <el-card shadow="never">
        <div class="filter-bar">
            <el-tabs v-model="activeTab" @tab-change="resetAndFetch" class="custom-tabs">
                <el-tab-pane label="全部订单" name="all"></el-tab-pane>
                <el-tab-pane name="paid">
                    <template #label>
                        <span>待发货</span>
                        <el-badge v-if="paidCount>0" :value="paidCount" class="badge-item" type="warning" />
                    </template>
                </el-tab-pane>
                <el-tab-pane label="运输中" name="shipped"></el-tab-pane>
                <el-tab-pane label="售后/维权" name="refunding"></el-tab-pane>
            </el-tabs>
            
            <div class="search-group">
                <el-input 
                    v-model="searchKeyword" 
                    placeholder="搜手机号 / 订单号 / 收件人" 
                    prefix-icon="Search" 
                    style="width: 250px" 
                    clearable
                    @keyup.enter="resetAndFetch"
                    @clear="resetAndFetch"
                />
                <el-button type="primary" @click="resetAndFetch">查询</el-button>
                <el-button :icon="Refresh" circle @click="resetAndFetch" title="刷新列表" />
                <el-button 
                    type="primary" 
 
                    :icon="MagicStick" 
                    @click="showAIDialog = true"
                    title="AI订单助手"
                >
                    AI助手
                </el-button>
            </div>
            
            <!-- 批量操作栏 -->
            <div class="batch-operations" v-if="selectedOrders.length > 0">
                <div class="batch-info">
                    <span>已选择 <strong>{{ selectedOrders.length }}</strong> 个订单</span>
                </div>
                <div class="batch-actions">
                    <el-button 
                        type="primary" 
                        size="small" 

                        @click="handleBatchShip"
                        :disabled="!canBatchShip"
                    >
                        <el-icon><Box /></el-icon>
                        批量发货 ({{ batchShipCount }})
                    </el-button>
                    <el-button 
                        size="small" 
                        @click="handleBatchExport"
                    >
                        <el-icon><DocumentCopy /></el-icon>
                        批量导出
                    </el-button>
                    <el-button 
                        size="small" 
                        @click="clearSelection"
                    >
                        取消选择
                    </el-button>
                </div>
            </div>
        </div>

        <el-table 
            ref="orderTableRef"
            :data="orderList" 
            v-loading="loading" 
            style="width: 100%" 
            stripe 
            height="calc(100vh - 240px)"
            @selection-change="handleSelectionChange"
        >
            <el-table-column type="selection" width="55" :selectable="checkSelectable" />
            <el-table-column label="商品信息" min-width="280">
                <template #default="scope">
                    <div v-for="(p, i) in scope.row.products" :key="i" class="prod-row">
                       <el-image :src="p.httpImage" class="prod-img" fit="cover" loading="lazy">
                           <template #error><div class="img-err"><el-icon><Picture /></el-icon></div></template>
                       </el-image>
                       <div class="prod-info">
                           <div class="prod-title">{{ p.title }}</div>
                           <div class="prod-sku">数量: {{ p.quantity || 1 }}</div>
                       </div>
                    </div>
                </template>
            </el-table-column>
            
            <el-table-column label="实付金额" width="120">
                <template #default="scope">
                    <div class="price-cell">
                        <span class="currency">¥</span>
                        <span class="amount">{{ formatPrice(scope.row.totalPrice) }}</span>
                    </div>
                </template>
            </el-table-column>
            
            <el-table-column label="收货信息" width="220">
                <template #default="scope">
                    <div class="user-info">
                        <div class="u-top">{{ scope.row.address?.name }} <span class="u-phone">{{ scope.row.address?.phone }}</span></div>
                        <div class="u-addr">{{ scope.row.address?.province }}{{ scope.row.address?.city }}{{ scope.row.address?.detail }}</div>
                    </div>
                </template>
            </el-table-column>
            
            <el-table-column label="时间/状态" width="160">
                <template #default="scope">
                    <div class="time-info">{{ formatDate(scope.row.createTime) }}</div>
                    <div style="margin-top:5px;">
                        <el-tag v-if="scope.row.status==='paid'" type="warning" effect="dark" size="small">待发货</el-tag>
                        <el-tag v-else-if="scope.row.status==='shipped'" type="primary" effect="plain" size="small">运输中</el-tag>
                        <el-tag v-else-if="scope.row.status==='received'" type="success" size="small">已完成</el-tag>
                        <el-tag v-else-if="scope.row.status==='refunded'" type="info" size="small">已退款</el-tag>
                        <el-tag v-else type="info" size="small">{{ scope.row.status }}</el-tag>
                    </div>
                </template>
            </el-table-column>
            
            <el-table-column label="操作" width="100" fixed="right">
                <template #default="scope">
                    <el-button v-if="scope.row.status==='paid'" type="primary" size="small" @click="openShip(scope.row)">发货</el-button>
                    <el-button v-else-if="scope.row.status==='refunding'" type="danger" size="small" @click="handleRefund(scope.row)">退款</el-button>
                    <el-popover v-else-if="scope.row.status==='shipped'" placement="left" title="物流信息" :width="220" trigger="click">
                        <template #reference><el-button size="small" link>物流</el-button></template>
                        <p><b>{{ scope.row.logistics?.carrier }}</b></p>
                        <p style="font-family:monospace">{{ scope.row.logistics?.trackingNumber }}</p>
                        <el-button size="small" link type="primary" @click="copyText(scope.row.logistics?.trackingNumber)">复制单号</el-button>
                    </el-popover>
                </template>
            </el-table-column>
            
            <template #empty>
                <el-empty description="暂无符合条件的订单" :image-size="100" />
            </template>
        </el-table>

        <div class="pagination-bar">
            <el-pagination
                v-model:current-page="currentPage"
                v-model:page-size="pageSize"
                :total="total"
                layout="total, prev, pager, next, jumper"
                @current-change="fetchOrders"
                background
            />
        </div>
    </el-card>

    <el-dialog v-model="shipVisible" title="📦 订单发货" width="400px" destroy-on-close>
        <el-form label-position="top">
            <el-form-item label="物流公司">
                <el-select v-model="shipForm.carrier" style="width:100%">
                    <el-option value="顺丰速运"/><el-option value="中通快递"/><el-option value="圆通速递"/><el-option value="EMS"/><el-option value="京东物流"/>
                </el-select>
            </el-form-item>
            <el-form-item label="快递单号">
                <el-input v-model="shipForm.trackingNumber" placeholder="请扫描或手动输入" clearable />
            </el-form-item>
        </el-form>
        <template #footer>
            <el-button @click="shipVisible = false">取消</el-button>
            <el-button type="primary" @click="confirmShip" :loading="submitting">确认发货</el-button>
        </template>
    </el-dialog>

    <!-- AI订单助手弹窗 -->
    <el-dialog
      v-model="showAIDialog"
      title="🤖 AI订单助手"
      width="900px"
      :close-on-click-modal="false"
      class="order-ai-dialog"
      destroy-on-close
    >
      <OrderAI :orders="orderList" :pending-orders="pendingOrdersList" />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed, nextTick } from 'vue'
import { Refresh, Search, Picture, MagicStick, Box, DocumentCopy } from '@element-plus/icons-vue'
import { getTempFileUrl, cdnUpdate, cdnCount, fetchCollectionLimit } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import OrderAI from './ai/OrderAI.vue'

// --- 状态 ---
const loading = ref(false)
const submitting = ref(false)
const activeTab = ref('paid')
const orderList = ref([])
const paidCount = ref(0) 

// 分页与搜索
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)
const searchKeyword = ref('')

const shipVisible = ref(false)
const shipForm = ref({ id: '', carrier: '顺丰速运', trackingNumber: '' })
const showAIDialog = ref(false)
const orderTableRef = ref(null)

// 计算待处理的订单列表（用于AI助手）
const pendingOrdersList = computed(() => {
  return orderList.value.filter(order => 
    order.status === 'paid' || order.status === 'refunding'
  )
})

// 批量操作
const selectedOrders = ref([])

const handleSelectionChange = (selection) => {
  if (Array.isArray(selection)) {
    selectedOrders.value = selection
  } else {
    selectedOrders.value = []
  }
}

const checkSelectable = (row) => {
  // 只允许选择待发货的订单进行批量操作
  return row.status === 'paid'
}

const clearSelection = () => {
  selectedOrders.value = []
  // 使用nextTick确保DOM更新后再清除选择
  nextTick(() => {
    if (orderTableRef.value && typeof orderTableRef.value.clearSelection === 'function') {
      try {
        orderTableRef.value.clearSelection()
      } catch (err) {
        console.warn('清除选择失败:', err)
      }
    }
  })
}

const canBatchShip = computed(() => {
  return selectedOrders.value.length > 0 && 
         selectedOrders.value.every(order => order.status === 'paid')
})

const batchShipCount = computed(() => {
  return selectedOrders.value.filter(order => order.status === 'paid').length
})

// 批量发货
const handleBatchShip = async () => {
  const shipOrders = selectedOrders.value.filter(order => order.status === 'paid')
  if (shipOrders.length === 0) {
    ElMessage.warning('请选择待发货的订单')
    return
  }

  ElMessageBox.confirm(
    `确认批量发货 ${shipOrders.length} 个订单吗？`,
    '批量发货确认',
    {
      confirmButtonText: '确认发货',
      cancelButtonText: '取消',
      type: 'warning'
    }
  ).then(async () => {
    try {
      submitting.value = true
      // 这里可以打开批量发货对话框，或者使用默认物流信息
      // 为了简化，我们使用默认物流信息
      const defaultCarrier = '顺丰速运'
      
      const promises = shipOrders.map(async (order) => {
        // 为每个订单生成一个临时单号（实际应该由用户输入或系统生成）
        const tempTrackingNumber = `SF${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`
        
        return cdnUpdate('orders', order._id, {
          status: 'shipped',
          logistics: {
            carrier: defaultCarrier,
            trackingNumber: tempTrackingNumber,
            shipTime: new Date().getTime()
          }
        })
      })
      
      await Promise.all(promises)
      ElMessage.success(`成功发货 ${shipOrders.length} 个订单`)
      clearSelection()
      fetchOrders()
    } catch (error) {
      console.error('批量发货失败:', error)
      ElMessage.error('批量发货失败，请重试')
    } finally {
      submitting.value = false
    }
  }).catch(() => {})
}

// 批量导出
const handleBatchExport = () => {
  if (selectedOrders.value.length === 0) {
    ElMessage.warning('请先选择要导出的订单')
    return
  }

  const exportData = selectedOrders.value.map(order => ({
    订单号: order._id,
    订单状态: order.status,
    订单金额: `¥${order.totalPrice.toFixed(2)}`,
    商品: order.products?.map(p => `${p.title} x${p.quantity || 1}`).join('; ') || '',
    收货人: order.address?.name || '',
    手机号: order.address?.phone || '',
    收货地址: `${order.address?.province || ''}${order.address?.city || ''}${order.address?.detail || ''}`,
    下单时间: new Date(order.createTime).toLocaleString(),
    物流公司: order.logistics?.carrier || '',
    快递单号: order.logistics?.trackingNumber || ''
  }))

  // 转换为CSV格式
  const headers = Object.keys(exportData[0])
  const csvContent = [
    headers.join(','),
    ...exportData.map(row => 
      headers.map(header => `"${row[header] || ''}"`).join(',')
    )
  ].join('\n')

  // 添加BOM以支持中文
  const BOM = '\uFEFF'
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.setAttribute('href', url)
  link.setAttribute('download', `订单导出_${new Date().toISOString().split('T')[0]}.csv`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  
  ElMessage.success(`已导出 ${selectedOrders.value.length} 个订单`)
  clearSelection()
}

// --- 核心数据获取 ---
const resetAndFetch = () => {
    currentPage.value = 1
    fetchOrders()
}

const fetchOrders = async () => {
    loading.value = true
    try {
        let rows = await fetchCollectionLimit('orders', { limit: 500 })

        if (activeTab.value !== 'all') {
            rows = rows.filter(o => o.status === activeTab.value)
        }

        if (searchKeyword.value.trim()) {
            const k = searchKeyword.value.trim().toLowerCase()
            rows = rows.filter(o =>
                String(o._id || '').toLowerCase().includes(k) ||
                String(o.orderNo || '').toLowerCase().includes(k) ||
                String(o.address?.phone || '').includes(k) ||
                String(o.address?.name || '').toLowerCase().includes(k)
            )
        }

        rows.sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
        total.value = rows.length

        const start = (currentPage.value - 1) * pageSize.value
        const pageRows = rows.slice(start, start + pageSize.value)

        const list = await Promise.all(pageRows.map(async item => {
            if (item.products) {
                for (let p of item.products) {
                    p.httpImage = await getTempFileUrl(p.image)
                }
            }
            return item
        }))
        orderList.value = list
        updateBadge()
    } catch(e) {
        console.error(e)
        orderList.value = []
        ElMessage.error('数据加载失败，请检查网络')
    } finally {
        loading.value = false
    }
}

const updateBadge = async () => {
    try {
        paidCount.value = await cdnCount('orders', { status: 'paid' })
    } catch(e){}
}

// --- 业务操作 ---
const openShip = (row) => {
    shipForm.value = { id: row._id, carrier: '顺丰速运', trackingNumber: '' }
    shipVisible.value = true
}

const confirmShip = async () => {
    if(!shipForm.value.trackingNumber) return ElMessage.warning('请填写单号')
    submitting.value = true
    try {
        await cdnUpdate('orders', shipForm.value.id, {
            status: 'shipped',
            logistics: {
                carrier: shipForm.value.carrier,
                trackingNumber: shipForm.value.trackingNumber,
                shipTime: new Date().getTime()
            }
        })
        ElMessage.success('发货成功')
        shipVisible.value = false
        fetchOrders()
    } catch(e) {
        ElMessage.error('操作失败')
    } finally {
        submitting.value = false
    }
}

const handleRefund = (row) => {
    ElMessageBox.confirm(`确认退款 ¥${row.totalPrice} 吗？此操作不可撤销。`, '退款确认', {
        confirmButtonText: '确认退款',
        confirmButtonClass: 'el-button--danger',
        type: 'warning'
    }).then(async () => {
        await cdnUpdate('orders', row._id, { status: 'refunded' })
        ElMessage.success('状态已更新为已退款')
        fetchOrders()
    })
}

// --- 工具函数 ---
const formatPrice = (p) => parseFloat(p).toLocaleString('en-US', {minimumFractionDigits: 2})
const formatDate = (ts) => new Date(ts).toLocaleString()
const copyText = (text) => {
    navigator.clipboard.writeText(text)
    ElMessage.success('复制成功')
}

onMounted(() => fetchOrders())
</script>

<style scoped>
.order-container { height: 100%; display: flex; flex-direction: column; }
.filter-bar { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f0f0f0; padding-bottom: 15px; margin-bottom: 15px; }
.custom-tabs :deep(.el-tabs__header) { margin: 0; }
.search-group { display: flex; gap: 10px; }
.badge-item { margin-left: 5px; transform: translateY(-2px); }

.prod-row { display: flex; align-items: center; margin-bottom: 8px; }
.prod-row:last-child { margin-bottom: 0; }
.prod-img { width: 44px; height: 44px; border-radius: 4px; border: 1px solid #eee; flex-shrink: 0; background: #f9f9f9; display: flex; align-items: center; justify-content: center; }
.img-err { color: #ccc; font-size: 16px; }
.prod-info { margin-left: 10px; overflow: hidden; }
.prod-title { font-size: 13px; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prod-sku { font-size: 12px; color: #999; margin-top: 2px; }

.price-cell { font-family: 'Segoe UI', sans-serif; font-weight: bold; color: #d4af37; }
.price-cell .currency { font-size: 12px; margin-right: 2px; }

.user-info { line-height: 1.4; }
.u-top { font-size: 13px; font-weight: bold; color: #333; }
.u-phone { font-weight: normal; color: #999; margin-left: 5px; font-size: 12px; }
.u-addr { font-size: 12px; color: #666; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.time-info { font-size: 12px; color: #999; font-family: sans-serif; }
.pagination-bar { margin-top: 20px; display: flex; justify-content: flex-end; }

/* 批量操作栏 */
.batch-operations {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  margin-top: 16px;
  background: linear-gradient(135deg, rgba(212, 175, 55, 0.1) 0%, rgba(212, 175, 55, 0.05) 100%);
  border: 1px solid rgba(212, 175, 55, 0.3);
  border-radius: 8px;
}

.batch-info {
  font-size: 14px;
  color: #333;
}

.batch-info strong {
  color: #d4af37;
  font-weight: 700;
}

.batch-actions {
  display: flex;
  gap: 10px;
}
</style>