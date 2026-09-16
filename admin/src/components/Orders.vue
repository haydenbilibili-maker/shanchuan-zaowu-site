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

        <!-- 错误态优先于空态渲染：取数失败时不再显示「暂无符合条件的订单」 -->
        <el-alert
            v-if="loadError"
            type="error"
            show-icon
            :closable="false"
            style="margin-bottom: 12px;"
            :title="'订单数据加载失败：' + loadError"
        >
            <template #default>
                <span>列表当前为空是因为<b>请求失败</b>，不代表没有订单。</span>
                <el-button link type="primary" @click="fetchOrders">重试</el-button>
            </template>
        </el-alert>

        <el-table 
            ref="orderTableRef"
            :data="orderList" 
            v-loading="loading" 
            style="width: 100%" 
            stripe 
            height="calc(100vh - 240px)"
            @selection-change="handleSelectionChange"
        >
            <el-table-column type="selection" width="55" fixed="left" :selectable="checkSelectable" />
            <el-table-column label="商品信息" min-width="280" fixed="left">
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
            
            <el-table-column label="实付金额" width="120" sortable>
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

            <el-table-column label="店长备注" width="170">
                <template #default="scope">
                    <div v-if="scope.row.managerNote" class="note-cell" :title="scope.row.managerNote">{{ scope.row.managerNote }}</div>
                    <span v-else class="note-empty">—</span>
                </template>
            </el-table-column>
            
            <el-table-column label="时间/状态" width="160">
                <template #default="scope">
                    <div class="time-info">{{ formatDate(scope.row.createTime) }}</div>
                    <div style="margin-top:5px;">
                        <el-tag v-if="scope.row.status==='paid'" type="warning" effect="dark" size="small">待发货</el-tag>
                        <el-tag v-else-if="scope.row.status==='ready_pickup'" type="warning" effect="plain" size="small">待自取</el-tag>
                        <el-tag v-else-if="scope.row.status==='shipped'" type="primary" effect="plain" size="small">运输中</el-tag>
                        <el-tag v-else-if="scope.row.status==='received'" type="success" size="small">已完成</el-tag>
                        <el-tag v-else-if="scope.row.status==='refunding'" type="danger" effect="plain" size="small">退款中</el-tag>
                        <el-tag v-else-if="scope.row.status==='aftersales'" type="danger" effect="plain" size="small">{{ scope.row.returnMode==='store_return' && scope.row.pickupReturnStatus!=='returned' ? '售后中 · 待收回藏品' : '售后中' }}</el-tag>
                        <el-tag v-else-if="scope.row.status==='refunded'" type="info" size="small">已退款</el-tag>
                        <el-tag v-else type="info" size="small">{{ scope.row.status }}</el-tag>
                    </div>
                </template>
            </el-table-column>
            
            <el-table-column label="操作" width="150" fixed="right">
                <template #default="scope">
                    <el-button v-if="scope.row.status==='paid'" type="primary" size="small" @click="openShip(scope.row)">发货</el-button>
                    <!-- 门店自取未取货：可直接退款（货未交付，无逆向） -->
                    <el-button v-else-if="scope.row.status==='ready_pickup'" type="danger" size="small" @click="handleRefund(scope.row)">退款</el-button>
                    <el-button v-else-if="scope.row.status==='refunding'" type="danger" size="small" @click="handleRefund(scope.row)">退款</el-button>
                    <!-- 门店自取已交付：逆向流程 = 确认收回藏品 → 退款 -->
                    <template v-else-if="scope.row.status==='aftersales'">
                        <el-button
                            v-if="scope.row.returnMode==='store_return' && scope.row.pickupReturnStatus!=='returned'"
                            type="warning"
                            size="small"
                            @click="confirmPickupReturn(scope.row)"
                        >确认收回藏品</el-button>
                        <el-button v-else type="danger" size="small" @click="handleRefund(scope.row)">退款</el-button>
                    </template>
                    <el-popover v-else-if="scope.row.status==='shipped'" placement="left" title="物流信息" :width="220" trigger="click">
                        <template #reference><el-button size="small" link>物流</el-button></template>
                        <p><b>{{ scope.row.logistics?.carrier }}</b></p>
                        <p style="font-family:monospace">{{ scope.row.logistics?.trackingNumber }}</p>
                        <el-button size="small" link type="primary" @click="copyText(scope.row.logistics?.trackingNumber)">复制单号</el-button>
                    </el-popover>
                    <el-button size="small" link type="primary" @click="editOrderNote(scope.row)">备注</el-button>
                    <el-button
                        v-if="scope.row.status==='pending_pay'"
                        size="small"
                        link
                        type="danger"
                        @click="adminFulfill(scope.row)"
                    >补履约</el-button>
                </template>
            </el-table-column>
            
            <template #empty>
                <el-empty
                    v-if="!loadError"
                    description="暂无符合条件的订单"
                    :image-size="100"
                />
                <el-empty
                    v-else
                    description="加载失败，请点击上方「重试」"
                    :image-size="100"
                />
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

    <el-dialog v-model="shipVisible" title="订单发货" width="400px" destroy-on-close>
        <!-- 校验必须落到字段上：原先只有一个会消失的 toast，
             运营不知道要改哪个框（审计 P1：el-form 90 处但 :rules 仅 16 处） -->
        <el-form ref="shipFormRef" :model="shipForm" :rules="shipRules" label-position="top">
            <el-form-item label="物流公司" prop="carrier">
                <el-select v-model="shipForm.carrier" style="width:100%">
                    <el-option value="顺丰速运"/><el-option value="中通快递"/><el-option value="圆通速递"/><el-option value="EMS"/><el-option value="京东物流"/>
                </el-select>
            </el-form-item>
            <el-form-item label="快递单号" prop="trackingNumber">
                <el-input v-model="shipForm.trackingNumber" placeholder="请扫描或手动输入真实运单号" clearable @keyup.enter="confirmShip" />
            </el-form-item>
        </el-form>
        <template #footer>
            <el-button @click="shipVisible = false">取消</el-button>
            <el-button type="primary" @click="confirmShip" :loading="submitting">确认发货</el-button>
        </template>
    </el-dialog>

    <el-dialog v-model="batchShipVisible" title="批量发货" width="560px" destroy-on-close>
        <p style="margin:0 0 12px;color:#6B6560;font-size:13px;">每单须填写真实运单号（至少 6 位），禁止自动生成假单号。</p>
        <el-form label-position="top">
            <el-form-item label="统一物流公司（可按单覆盖）">
                <el-select v-model="batchShipCarrier" style="width:100%" @change="applyBatchCarrier">
                    <el-option value="顺丰速运"/><el-option value="中通快递"/><el-option value="圆通速递"/><el-option value="EMS"/><el-option value="京东物流"/>
                </el-select>
            </el-form-item>
            <div v-for="row in batchShipRows" :key="row.id" style="display:grid;grid-template-columns:1fr 1.2fr;gap:8px;margin-bottom:10px;align-items:end;">
                <el-form-item :label="row.label" style="margin-bottom:0;">
                    <el-select v-model="row.carrier" style="width:100%">
                        <el-option value="顺丰速运"/><el-option value="中通快递"/><el-option value="圆通速递"/><el-option value="EMS"/><el-option value="京东物流"/>
                    </el-select>
                </el-form-item>
                <el-form-item label="运单号" style="margin-bottom:0;" required>
                    <el-input v-model="row.trackingNumber" placeholder="真实运单号" clearable />
                </el-form-item>
            </div>
        </el-form>
        <template #footer>
            <el-button @click="batchShipVisible = false">取消</el-button>
            <el-button type="primary" @click="confirmBatchShip" :loading="submitting">确认发货</el-button>
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
import { getTempFileUrl, cdnUpdate, cdnCount, fetchCollectionLimit, callCloudFunction } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import { safeWarn } from '../utils/safeStorage.js'
import { excludeExchangeOrders } from '../utils/orderFilters'
import OrderAI from './ai/OrderAI.vue'

// --- 状态 ---
const loading = ref(false)
const submitting = ref(false)
const activeTab = ref('paid')
const orderList = ref([])
/** 取数失败信息；非空时列表区显示错误态而不是空态（审计 P1：错误被伪装成「无数据」） */
const loadError = ref('')
const paidCount = ref(0) 

// 分页与搜索
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)
const searchKeyword = ref('')

const shipVisible = ref(false)
const shipForm = ref({ id: '', carrier: '顺丰速运', trackingNumber: '' })
const shipFormRef = ref(null)
/** 运单号至少 6 位（与批量发货弹窗的口径一致） */
const shipRules = {
    carrier: [{ required: true, message: '请选择物流公司', trigger: 'change' }],
    trackingNumber: [
        { required: true, message: '请填写运单号', trigger: 'blur' },
        { min: 6, message: '运单号至少 6 位（禁止填假单号）', trigger: 'blur' }
    ]
}
const batchShipVisible = ref(false)
const batchShipCarrier = ref('顺丰速运')
const batchShipRows = ref([])
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

// 批量发货：打开表单，强制每单填写真实运单号（禁止自动生成假 SF 单号）
const handleBatchShip = () => {
  const shipOrders = selectedOrders.value.filter(order => order.status === 'paid')
  if (shipOrders.length === 0) {
    ElMessage.warning('请选择待发货的订单')
    return
  }
  batchShipCarrier.value = '顺丰速运'
  batchShipRows.value = shipOrders.map((order) => ({
    id: order._id,
    label: order.orderNo || String(order._id).slice(-8),
    carrier: '顺丰速运',
    trackingNumber: String(order.logistics?.trackingNumber || '').trim()
  }))
  batchShipVisible.value = true
}

const applyBatchCarrier = (carrier) => {
  const next = carrier || '顺丰速运'
  batchShipRows.value = batchShipRows.value.map((row) => ({ ...row, carrier: next }))
}

const confirmBatchShip = async () => {
  const rows = batchShipRows.value || []
  if (!rows.length) {
    ElMessage.warning('没有待发货订单')
    return
  }
  const invalid = rows.find((row) => {
    const tracking = String(row.trackingNumber || '').trim().replace(/\s/g, '')
    return !tracking || tracking.length < 6
  })
  if (invalid) {
    ElMessage.warning(`请为订单 ${invalid.label} 填写真实运单号（至少 6 位）`)
    return
  }

  submitting.value = true
  try {
    for (const row of rows) {
      const tracking = String(row.trackingNumber || '').trim().replace(/\s/g, '')
      const result = await callCloudFunction('managerShipOrder', {
        orderId: row.id,
        carrier: row.carrier || batchShipCarrier.value || '顺丰速运',
        trackingNumber: tracking
      })
      if (result && result.success === false) {
        throw new Error(result.msg || `订单 ${row.label} 发货失败`)
      }
    }
    ElMessage.success(`成功发货 ${rows.length} 个订单`)
    batchShipVisible.value = false
    clearSelection()
    fetchOrders()
  } catch (error) {
    console.error('批量发货失败:', error)
    ElMessage.error(error?.message || '批量发货失败，请刷新重试；持续失败请联系技术' /* 技术排查：请确认已部署 managerShipOrder 并配置 ADMIN_OPS_KEY */)
  } finally {
    submitting.value = false
  }
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
        // 兑换单（source=exchange）不属于藏品订单：与小程序侧同口径过滤
        let rows = excludeExchangeOrders(await fetchCollectionLimit('orders', { limit: 500 }))

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
        loadError.value = ''
        updateBadge()
    } catch(e) {
        console.error(e)
        orderList.value = []
        // 错误态与空态必须互斥：否则取数失败会显示「暂无符合条件的订单」，运营会判断成「今天没单」
        loadError.value = e?.message || '数据加载失败，请检查网络'
        ElMessage.error('数据加载失败，请检查网络')
    } finally {
        loading.value = false
    }
}

const updateBadge = async () => {
    try {
        paidCount.value = await cdnCount('orders', { status: 'paid' })
    } catch(e){
        safeWarn('订单角标计数失败（已忽略，角标可能滞后）', e)
    }
}

// --- 业务操作 ---
const openShip = (row) => {
    shipForm.value = { id: row._id, carrier: '顺丰速运', trackingNumber: '' }
    shipVisible.value = true
}

const confirmShip = async () => {
    // 内联校验：错误显示在对应字段下方，而不是一个会消失的 toast
    try {
        await shipFormRef.value?.validate()
    } catch (invalid) {
        return // Element Plus 已在字段上标红
    }
    submitting.value = true
    try {
        // SSOT 写路径：与小程序店长一致，走 managerShipOrder（站内信 + 物流字段）
        const result = await callCloudFunction('managerShipOrder', {
            orderId: shipForm.value.id,
            carrier: shipForm.value.carrier || '顺丰速运',
            trackingNumber: String(shipForm.value.trackingNumber || '').trim()
        })
        if (result && result.success === false) {
            throw new Error(result.msg || result.message || '发货失败')
        }
        ElMessage.success(result?.messageSent === false ? '已发货（通知可能延迟）' : '发货成功')
        shipVisible.value = false
        fetchOrders()
    } catch(e) {
        console.error('发货失败', e)
        ElMessage.error(e?.message || '操作失败，请刷新重试；持续失败请联系技术' /* 技术排查：请确认已部署 managerShipOrder，且配置 ADMIN_OPS_KEY */)
    } finally {
        submitting.value = false
    }
}

const handleRefund = (row) => {
    ElMessageBox.confirm(
        `确认对订单执行微信退款 ¥${row.totalPrice}？将调用云函数 refundOrder（含库存回滚）。若仅想改状态请取消后联系技术。`,
        '退款确认',
        {
            confirmButtonText: '确认退款',
            confirmButtonClass: 'el-button--danger',
            type: 'warning'
        }
    ).then(async () => {
        try {
            // 先确保状态为 refunding，refundOrder 只接受 refunding/aftersales
            if (row.status === 'paid' || row.status === 'ready_pickup' || row.status === 'shipped' || row.status === 'received') {
                await cdnUpdate('orders', row._id, { status: 'refunding', refundRequestedAt: Date.now() })
            }
            const result = await callCloudFunction('refundOrder', {
                orderId: row._id
            })
            if (result && result.success === false) {
                // Web 匿名身份可能无 admin openid：降级提示，禁止静默假退款
                ElMessageBox.alert(
                    (result.msg || '云函数退款失败') +
                    '。请在小程序「店长后台 → 订单 → 退款」处理真实退款，避免 Admin 直改状态导致未退款到账。',
                    '需在小程序完成退款',
                    { type: 'warning' }
                )
                fetchOrders()
                return
            }
            ElMessage.success(result?.msg || '退款已提交')
            fetchOrders()
        } catch (e) {
            console.error('退款失败', e)
            ElMessage.error(e?.message || '退款失败')
            fetchOrders()
        }
    }).catch((e) => {
      if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
}

// --- 工具函数 ---
const confirmPickupReturn = (row) => {
    ElMessageBox.confirm(
        '门店自取逆向：请核对顾客送回门店的藏品与订单一致后确认。确认收回后才能执行退款。',
        '确认收回藏品',
        {
            confirmButtonText: '确认收回',
            confirmButtonClass: 'el-button--warning',
            type: 'warning'
        }
    ).then(async () => {
        try {
            const result = await callCloudFunction('refundOrder', {
                action: 'confirmPickupReturn',
                orderId: row._id
            })
            if (result && result.success === false) {
                ElMessage.error(result.msg || '确认失败')
                fetchOrders()
                return
            }
            ElMessage.success(result?.msg || '已确认收回藏品')
            fetchOrders()
        } catch (e) {
            console.error('确认收回失败', e)
            ElMessage.error(e?.message || '确认失败')
            fetchOrders()
        }
    }).catch((e) => {
      if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
}

const formatPrice = (p) => parseFloat(p).toLocaleString('en-US', {minimumFractionDigits: 2})
const formatDate = (ts) => new Date(ts).toLocaleString()

/**
 * 店长备注（orders.managerNote）：与小程序店长台同字段、同入口。
 * 保存走 managerShipOrder.saveNote —— products 写权限之外的订单写路径统一在该函数内做鉴权。
 * 备注会随发货私信「馆员留言」发给买家，所以这里提示清楚。
 */
const editOrderNote = (row) => {
    if (!row || !row._id) return ElMessage.warning('订单信息缺失')
    ElMessageBox.prompt('店长备注会随发货私信发给买家（上限 100 字）', `订单备注 · ${row.orderNo || row._id}`, {
        confirmButtonText: '保存',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputValue: String(row.managerNote || ''),
        inputPlaceholder: '如：附赠养护卡 · 易碎请轻放',
        inputValidator: (value) => String(value || '').length <= 100 || '最多 100 字',
    })
        .then(async ({ value }) => {
            try {
                const note = String(value || '').trim()
                const res = await callCloudFunction('managerShipOrder', {
                    action: 'saveNote',
                    orderId: row._id,
                    note,
                })
                if (!res || res.success === false) {
                    throw new Error((res && res.msg) || '保存失败')
                }
                row.managerNote = (res && res.note) || ''
                ElMessage.success(note ? '备注已保存' : '备注已清空')
            } catch (e) {
                ElMessage.error(e?.message || '保存失败，请刷新重试；持续失败请联系技术' /* 技术排查：请确认已部署 managerShipOrder */)
            }
        })
    .catch((e) => {
      if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
}

/**
 * 补履约：用户微信已实扣、但支付回调缺失（如 2026-09-15 回调误判事故）时的补救入口。
 * 仅超管可用（Admin Web 携带 ADMIN_OPS_KEY，服务端二次校验）；会真实扣库存/发券/发消息，
 * 所以弹窗明确要求先在微信商户平台核对到账。
 */
const adminFulfill = (row) => {
    if (!row || !row._id) return ElMessage.warning('订单信息缺失')
    ElMessageBox.prompt(
        '仅在微信商户平台确认该单已收款后使用：将补写支付证据并执行履约（扣库存 / 核销券 / 发通知）。',
        `补履约 · ${row.orderNo || row._id}`,
        {
            confirmButtonText: '确认补履约',
            cancelButtonText: '取消',
            inputType: 'textarea',
            inputPlaceholder: '可填微信交易号或备注（选填）',
        },
    )
        .then(async ({ value }) => {
            try {
                const text = String(value || '').trim()
                // 弹窗文案允许填微信交易号：纯数字长串视为 transactionId，同时写入备注便于审计
                const looksLikeTx = /^\d{18,}$/.test(text)
                const res = await callCloudFunction('confirmPayment', {
                    action: 'adminFulfill',
                    orderId: row._id,
                    transactionId: looksLikeTx ? text : '',
                    note: text,
                })
                if (!res || res.success === false) {
                    throw new Error((res && res.msg) || '补履约失败')
                }
                ElMessage.success(res.alreadyPaid ? '该单已支付，无需补履约' : '补履约已执行')
                fetchOrders()
            } catch (e) {
                ElMessage.error(e?.message || '补履约失败：请确认云函数 confirmPayment 已部署')
            }
        })
    .catch((e) => {
      if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
    })
}

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
.note-cell {
    font-size: 12px;
    color: #b88a4d;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-all;
}
.note-empty { color: #6b6560; }
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
