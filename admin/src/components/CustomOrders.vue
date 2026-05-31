<template>
  <div class="custom-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>标本定制工坊 / CUSTOM WORKSHOP</h2>
        <span class="subtitle">DRAFTS · INQUIRIES · PRODUCTION</span>
      </div>
      <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
    </div>

    <el-tabs v-model="activeTab" @tab-change="refresh">
      <el-tab-pane label="客户询单" name="inquiry">
        <template #label>
          <span>客户询单</span>
          <el-badge v-if="inquiryPending > 0" :value="inquiryPending" class="badge" type="danger" />
        </template>
      </el-tab-pane>
      <el-tab-pane label="定制草稿" name="draft" />
      <el-tab-pane label="生产工单" name="production">
        <template #label>
          <span>生产工单</span>
          <el-badge v-if="productionCount > 0" :value="productionCount" class="badge" />
        </template>
      </el-tab-pane>
    </el-tabs>

    <!-- 客户询单 -->
    <div v-if="activeTab === 'inquiry'">
      <el-card shadow="never">
        <el-table :data="inquiries" v-loading="loading" stripe>
          <el-table-column label="询单号" width="160">
            <template #default="{ row }">
              <div class="ticket-no">{{ row._id.slice(0, 10) }}</div>
              <div class="ticket-type">{{ fmt(row.createTime) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="意向商品/方案" min-width="220">
            <template #default="{ row }">
              <div class="b-title">{{ row.title || row.payload?.productName || '未命名定制' }}</div>
              <div class="b-sub" v-if="row.payload?.materials">材料：{{ formatMaterials(row.payload.materials) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="联系方式" width="180">
            <template #default="{ row }">
              <div>{{ row.contact?.name || row.userName || '-' }}</div>
              <div class="phone-cell">📞 {{ row.contact?.phone || row.userPhone || '-' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="预算" width="100">
            <template #default="{ row }">
              <span class="price">¥{{ row.budget || row.payload?.budget || '面议' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag :type="inquiryStatusType(row.status)" effect="dark" size="small">
                {{ inquiryStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <el-button v-if="row.status === 'pending'" size="small" type="primary" color="#d4af37" @click="quoteInquiry(row)">报价</el-button>
              <el-button v-if="row.status === 'quoted'" size="small" type="success" @click="acceptInquiry(row)">确认接单</el-button>
              <el-button size="small" link @click="viewInquiry(row)">详情</el-button>
              <el-button size="small" type="danger" link @click="closeInquiry(row)">关闭</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <!-- 定制草稿 -->
    <div v-if="activeTab === 'draft'">
      <el-card shadow="never">
        <el-table :data="drafts" v-loading="loading" stripe>
          <el-table-column label="方案标题" min-width="200">
            <template #default="{ row }">
              <div class="b-title">{{ row.title || '未命名草稿' }}</div>
              <div class="b-sub">用户：{{ row._openid?.slice(0, 12) }}...</div>
            </template>
          </el-table-column>
          <el-table-column label="工艺/材料" min-width="200">
            <template #default="{ row }">
              <span>{{ row.customMeta?.craftLabel || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="分享状态" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.shareEnabled" type="warning" size="small">已分享</el-tag>
              <el-tag v-else size="small" type="info">私有</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="关联预约" width="160">
            <template #default="{ row }">
              <span v-if="row.linkedBookingId" class="link-id">{{ row.linkedBookingId.slice(0, 8) }}</span>
              <span v-else style="color:#ccc">未关联</span>
            </template>
          </el-table-column>
          <el-table-column label="更新时间" width="180">
            <template #default="{ row }">{{ fmt(row.updateTime) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button size="small" link @click="viewDraft(row)">查看</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <!-- 生产工单 -->
    <div v-if="activeTab === 'production'">
      <el-card shadow="never">
        <el-table :data="productions" v-loading="loading" stripe>
          <el-table-column label="工单号" width="160">
            <template #default="{ row }">
              <div class="ticket-no">{{ row.orderNo || row._id.slice(0, 10) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="客户" width="180">
            <template #default="{ row }">
              {{ row.contact?.name || row.userName || '-' }}
              <div class="phone-cell">{{ row.contact?.phone || '' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="生产阶段" width="140">
            <template #default="{ row }">
              <el-tag :type="productionStatusType(row.productionStatus)" effect="dark" size="small">
                {{ productionStatusLabel(row.productionStatus) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="负责师傅" width="140">
            <template #default="{ row }">
              {{ row.framerName || '未分配' }}
            </template>
          </el-table-column>
          <el-table-column label="预计完成" width="140">
            <template #default="{ row }">
              {{ row.estimatedDate || '-' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="280" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" color="#d4af37" @click="advanceProduction(row)">推进</el-button>
              <el-button size="small" @click="assignFramer(row)">分配师傅</el-button>
              <el-button size="small" link @click="viewInquiry(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <!-- 报价弹窗 -->
    <el-dialog v-model="quoteDialog" title="录入报价" width="500px">
      <el-form :model="quoteForm" label-width="100px">
        <el-form-item label="报价金额">
          <el-input-number v-model="quoteForm.amount" :min="0" :step="100" style="width: 100%" />
        </el-form-item>
        <el-form-item label="工期(天)">
          <el-input-number v-model="quoteForm.days" :min="1" :max="180" style="width: 100%" />
        </el-form-item>
        <el-form-item label="预计完成">
          <el-date-picker v-model="quoteForm.estimatedDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="quoteForm.note" type="textarea" :rows="3" placeholder="向客户说明工艺要求、材料替代等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="quoteDialog = false">取消</el-button>
        <el-button type="primary" color="#d4af37" @click="submitQuote">发送报价</el-button>
      </template>
    </el-dialog>

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailDrawer" title="询单 / 工单详情" size="560px">
      <pre v-if="currentRow" class="raw-json">{{ JSON.stringify(currentRow, null, 2) }}</pre>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import {
  fetchCollectionSorted,
  fetchCollectionWhere,
  cdnUpdate,
} from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

const activeTab = ref('inquiry')
const loading = ref(false)
const inquiries = ref([])
const drafts = ref([])
const productions = ref([])
const quoteDialog = ref(false)
const detailDrawer = ref(false)
const currentRow = ref(null)
const quoteForm = ref({ amount: 0, days: 14, estimatedDate: '', note: '' })

const inquiryPending = computed(() => inquiries.value.filter(i => i.status === 'pending').length)
const productionCount = computed(() => productions.value.filter(p => !['completed', 'cancelled'].includes(p.productionStatus)).length)

const fmt = (ts) => {
  if (!ts) return ''
  const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('zh-CN')
}

const formatMaterials = (arr) => Array.isArray(arr) ? arr.join('/') : (arr || '')

const STATUS_INQUIRY = {
  pending: { text: '待报价', type: 'warning' },
  quoted: { text: '已报价', type: '' },
  accepted: { text: '已接单', type: 'success' },
  closed: { text: '已关闭', type: 'info' }
}
const STATUS_PROD = {
  awaiting_intake: { text: '待收料', type: 'warning' },
  framing: { text: '装裱中', type: '' },
  packing: { text: '打包', type: '' },
  shipped: { text: '已发货', type: 'success' },
  completed: { text: '已完成', type: 'success' },
  cancelled: { text: '已取消', type: 'info' }
}
const inquiryStatusLabel = (s) => STATUS_INQUIRY[s]?.text || s || '-'
const inquiryStatusType = (s) => STATUS_INQUIRY[s]?.type || 'info'
const productionStatusLabel = (s) => STATUS_PROD[s]?.text || s || '待安排'
const productionStatusType = (s) => STATUS_PROD[s]?.type || 'info'

const refresh = async () => {
  loading.value = true
  try {
    if (activeTab.value === 'inquiry') {
      inquiries.value = await fetchCollectionSorted('custom_inquiries', {
        limit: 200,
        sortFn: (a, b) => (b.createTime || 0) - (a.createTime || 0)
      })
    } else if (activeTab.value === 'draft') {
      drafts.value = await fetchCollectionSorted('custom_drafts', {
        limit: 200,
        sortFn: (a, b) => (b.updateTime || 0) - (a.updateTime || 0)
      })
    } else if (activeTab.value === 'production') {
      const rows = await fetchCollectionWhere('custom_inquiries', { status: 'accepted' }, 200)
      rows.sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
      productions.value = rows
    }
  } catch (e) {
    console.error(e)
    ElMessage.error('数据加载失败')
  } finally {
    loading.value = false
  }
}

const quoteInquiry = (row) => {
  currentRow.value = row
  quoteForm.value = {
    amount: row.budget || 0,
    days: 14,
    estimatedDate: '',
    note: ''
  }
  quoteDialog.value = true
}

const submitQuote = async () => {
  if (!currentRow.value || !quoteForm.value.amount) {
    return ElMessage.warning('请输入报价金额')
  }
  try {
    await cdnUpdate('custom_inquiries', currentRow.value._id, {
      status: 'quoted',
      quote: {
        amount: quoteForm.value.amount,
        days: quoteForm.value.days,
        estimatedDate: quoteForm.value.estimatedDate,
        note: quoteForm.value.note,
        quotedAt: Date.now()
      }
    })
    ElMessage.success('报价已发送')
    quoteDialog.value = false
    refresh()
  } catch (e) {
    ElMessage.error('报价失败：' + e.message)
  }
}

const acceptInquiry = (row) => {
  ElMessageBox.confirm('确认接单后将进入生产工单跟踪。', '接单确认', { type: 'warning' }).then(async () => {
    await cdnUpdate('custom_inquiries', row._id, {
      status: 'accepted',
      productionStatus: 'awaiting_intake',
      acceptedAt: Date.now()
    })
    ElMessage.success('已接单')
    refresh()
  }).catch(() => {})
}

const closeInquiry = (row) => {
  ElMessageBox.confirm('关闭询单？关闭后无法继续报价。', '关闭确认', { type: 'warning' }).then(async () => {
    await cdnUpdate('custom_inquiries', row._id, { status: 'closed' })
    ElMessage.success('已关闭')
    refresh()
  }).catch(() => {})
}

const advanceProduction = (row) => {
  const order = ['awaiting_intake', 'framing', 'packing', 'shipped', 'completed']
  const cur = row.productionStatus || 'awaiting_intake'
  const idx = order.indexOf(cur)
  const next = order[Math.min(idx + 1, order.length - 1)]
  ElMessageBox.confirm(`推进至【${productionStatusLabel(next)}】？`, '阶段推进', { type: 'warning' }).then(async () => {
    await cdnUpdate('custom_inquiries', row._id, {
      productionStatus: next,
      [`stageTime.${next}`]: Date.now()
    })
    ElMessage.success('已推进')
    refresh()
  }).catch(() => {})
}

const assignFramer = (row) => {
  ElMessageBox.prompt('请输入师傅姓名 / ID', '分配标本师', { inputPlaceholder: '例如：王师傅' }).then(async ({ value }) => {
    if (!value) return
    await cdnUpdate('custom_inquiries', row._id, { framerName: value })
    ElMessage.success('已分配')
    refresh()
  }).catch(() => {})
}

const viewInquiry = (row) => {
  currentRow.value = row
  detailDrawer.value = true
}
const viewDraft = (row) => {
  currentRow.value = row
  detailDrawer.value = true
}

onMounted(refresh)
</script>

<style scoped>
.custom-container { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }
.badge { margin-left: 6px; }
.ticket-no { font-family: 'Segoe UI', monospace; font-weight: bold; color: #333; }
.ticket-type { font-size: 11px; color: #999; margin-top: 2px; }
.b-title { font-weight: bold; color: #333; }
.b-sub { font-size: 12px; color: #999; margin-top: 3px; }
.phone-cell { color: #999; font-size: 12px; margin-top: 2px; }
.price { color: #d4af37; font-weight: bold; }
.link-id { font-family: monospace; color: #409eff; font-size: 12px; }
.raw-json { background: #f5f5f5; padding: 16px; border-radius: 8px; font-size: 12px; max-height: 80vh; overflow: auto; }
</style>
