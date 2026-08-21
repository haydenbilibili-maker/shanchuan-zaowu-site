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
      <el-tab-pane label="定制选项" name="config" />
    </el-tabs>

    <!-- 客户询单 -->
    <div v-if="activeTab === 'inquiry'">
      <el-card shadow="never">
        <el-table :data="inquiries" v-loading="loading" stripe>
          <template #empty>
            <el-empty description="暂无客户询单（小程序企业团购/到店确认提交后出现）" :image-size="80" />
          </template>
          <el-table-column label="询单号" width="160">
            <template #default="{ row }">
              <div class="ticket-no">{{ row._id.slice(0, 10) }}</div>
              <div class="ticket-type">{{ fmt(row.createTime) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="意向方案" min-width="220">
            <template #default="{ row }">
              <div class="b-title">{{ inquiryTitle(row) }}</div>
              <div class="b-sub" v-if="metaSummary(row)">{{ metaSummary(row) }}</div>
              <div class="b-sub" v-if="row.message">留言：{{ row.message }}</div>
            </template>
          </el-table-column>
          <el-table-column label="联系方式" width="180">
            <template #default="{ row }">
              <div>{{ contactNameOf(row) }}</div>
              <div class="phone-cell">{{ contactPhoneOf(row) }}</div>
              <div class="b-sub" v-if="row.companyName">{{ row.companyName }}</div>
            </template>
          </el-table-column>
          <el-table-column label="数量" width="80">
            <template #default="{ row }">
              <span class="price">{{ row.quantity || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag :type="inquiryStatusType(row.status)" effect="dark" size="small">
                {{ inquiryStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="280" fixed="right">
            <template #default="{ row }">
              <el-button v-if="row.status === 'pending'" size="small" type="primary" color="#d4af37" @click="quoteInquiry(row)">报价</el-button>
              <el-button v-if="row.status === 'pending'" size="small" @click="markContacted(row)">已联系</el-button>
              <el-button v-if="row.status === 'quoted'" size="small" type="success" @click="acceptInquiry(row)">确认接单</el-button>
              <el-button size="small" link @click="viewInquiry(row)">详情</el-button>
              <el-button v-if="row.status !== 'closed'" size="small" type="danger" link @click="closeInquiry(row)">关闭</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <!-- 定制草稿 -->
    <div v-if="activeTab === 'draft'">
      <el-card shadow="never">
        <el-table :data="drafts" v-loading="loading" stripe>
          <template #empty>
            <el-empty description="暂无定制草稿" :image-size="80" />
          </template>
          <el-table-column label="方案标题" min-width="200">
            <template #default="{ row }">
              <div class="b-title">{{ row.title || row.customMeta?.specimen?.title || '未命名草稿' }}</div>
              <div class="b-sub">用户：{{ row._openid?.slice(0, 12) || '—' }}...</div>
            </template>
          </el-table-column>
          <el-table-column label="工艺/材料" min-width="200">
            <template #default="{ row }">
              <span>{{ metaSummary(row) || '-' }}</span>
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
              <span v-if="row.linkedBookingId || row.bookingId" class="link-id">{{ (row.linkedBookingId || row.bookingId).slice(0, 8) }}</span>
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
          <template #empty>
            <el-empty description="暂无生产工单（接单询单或小程序定制订单会出现在此）" :image-size="80" />
          </template>
          <el-table-column label="工单号" width="160">
            <template #default="{ row }">
              <div class="ticket-no">{{ row.orderNo || row._id.slice(0, 10) }}</div>
              <div class="ticket-type">{{ row._source === 'order' ? '定制订单' : '询单接单' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="客户" width="180">
            <template #default="{ row }">
              {{ contactNameOf(row) }}
              <div class="phone-cell">{{ contactPhoneOf(row) }}</div>
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
              {{ row.framerName || row.customMeta?.framer?.name || '未分配' }}
            </template>
          </el-table-column>
          <el-table-column label="预计完成" width="140">
            <template #default="{ row }">
              {{ row.estimatedDate || row.quote?.estimatedDate || '-' }}
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

    <!-- 定制选项（框型 / 包装，与 getCustomConfig 对齐） -->
    <div v-if="activeTab === 'config'">
      <div class="config-toolbar">
        <el-select v-model="configTypeFilter" size="small" style="width: 120px" @change="refresh">
          <el-option label="全部类型" value="all" />
          <el-option label="框型" value="frame" />
          <el-option label="包装" value="packaging" />
        </el-select>
        <el-button size="small" type="primary" color="#d4af37" @click="openConfigForm()">新增选项</el-button>
      </div>
      <el-card shadow="never">
        <el-table :data="filteredConfigs" v-loading="loading" stripe>
          <template #empty>
            <el-empty description="暂无定制选项，可新增或由云函数种子配置兜底" :image-size="80" />
          </template>
          <el-table-column label="名称" min-width="140">
            <template #default="{ row }">
              <div class="b-title">{{ row.name }}</div>
              <div class="b-sub">{{ row.configId || row._id }}</div>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="90">
            <template #default="{ row }">
              <el-tag size="small">{{ configTypeLabel(row.type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="描述" min-width="160" show-overflow-tooltip prop="desc" />
          <el-table-column label="加价" width="90">
            <template #default="{ row }">¥{{ row.priceDelta || 0 }}</template>
          </el-table-column>
          <el-table-column label="排序" width="72" prop="sort" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
                {{ row.status === 'active' ? '启用' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="{ row }">
              <el-button size="small" link @click="openConfigForm(row)">编辑</el-button>
              <el-button size="small" type="danger" link @click="deleteConfig(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <!-- 定制选项编辑 -->
    <el-dialog v-model="configDialog" :title="configForm._id ? '编辑定制选项' : '新增定制选项'" width="480px">
      <el-form :model="configForm" label-width="88px">
        <el-form-item label="类型" required>
          <el-select v-model="configForm.type" style="width: 100%">
            <el-option label="框型" value="frame" />
            <el-option label="包装" value="packaging" />
          </el-select>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="configForm.name" placeholder="如：经典木框" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="configForm.desc" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="加价">
          <el-input-number v-model="configForm.priceDelta" :min="0" :step="10" style="width: 100%" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="configForm.sort" :min="0" :max="999" style="width: 100%" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="configForm.active" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="configDialog = false">取消</el-button>
        <el-button type="primary" color="#d4af37" :loading="configSaving" @click="saveConfig">保存</el-button>
      </template>
    </el-dialog>

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
  COLLECTIONS,
  fetchCollectionSorted,
  fetchCollectionWhere,
  cdnAdd,
  cdnUpdate,
  cdnRemove,
} from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

const activeTab = ref('inquiry')
const loading = ref(false)
const inquiries = ref([])
const drafts = ref([])
const productions = ref([])
const customConfigs = ref([])
const configTypeFilter = ref('all')
const configDialog = ref(false)
const configSaving = ref(false)
const configForm = ref(emptyConfigForm())
const quoteDialog = ref(false)
const detailDrawer = ref(false)
const currentRow = ref(null)
const quoteForm = ref({ amount: 0, days: 14, estimatedDate: '', note: '' })

const inquiryPending = computed(() => inquiries.value.filter(i => i.status === 'pending').length)
const productionCount = computed(() => productions.value.filter(p => !['completed', 'cancelled'].includes(p.productionStatus)).length)
const filteredConfigs = computed(() => {
  if (configTypeFilter.value === 'all') return customConfigs.value
  return customConfigs.value.filter((c) => c.type === configTypeFilter.value)
})

function emptyConfigForm() {
  return {
    _id: '',
    type: 'frame',
    name: '',
    desc: '',
    priceDelta: 0,
    sort: 10,
    active: true,
  }
}

const configTypeLabel = (t) => ({ frame: '框型', packaging: '包装' }[t] || t || '—')

const fmt = (ts) => {
  if (!ts) return ''
  const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('zh-CN')
}

const formatMaterials = (arr) => Array.isArray(arr) ? arr.join('/') : (arr || '')

const contactNameOf = (row) =>
  row?.contactName || row?.contact?.name || row?.userName || row?.products?.[0]?.buyerName || '-'
const contactPhoneOf = (row) =>
  row?.contactPhone || row?.contact?.phone || row?.userPhone || ''

const inquiryTitle = (row) =>
  row?.summary ||
  row?.companyName ||
  row?.typeLabel ||
  row?.customMeta?.specimen?.title ||
  row?.title ||
  '定制意向'

const metaSummary = (row) => {
  const m = row?.customMeta
  if (!m) return formatMaterials(row?.payload?.materials) || ''
  if (m.craftLabel) return m.craftLabel
  const parts = [
    m.specimen?.title ? `标本：${m.specimen.title}` : '',
    m.frame?.name ? `装裱：${m.frame.name}` : '',
    m.packaging?.name ? `包装：${m.packaging.name}` : '',
    m.framer?.name ? `标本师：${m.framer.name}` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

const STATUS_INQUIRY = {
  pending: { text: '待跟进', type: 'warning' },
  contacted: { text: '已联系', type: '' },
  quoted: { text: '已报价', type: '' },
  accepted: { text: '已接单', type: 'success' },
  closed: { text: '已关闭', type: 'info' }
}
const STATUS_PROD = {
  pending_make: { text: '待制作', type: 'warning' },
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
      // 询单接单 + 小程序定制订单（source=custom）合并
      const [acceptedInquiries, customOrders] = await Promise.all([
        fetchCollectionWhere('custom_inquiries', { status: 'accepted' }, 200).catch(() => []),
        fetchCollectionWhere(COLLECTIONS.ORDERS, { source: 'custom' }, 200).catch(() => []),
      ])
      const merged = [
        ...(acceptedInquiries || []).map((r) => ({ ...r, _source: 'inquiry', _collection: 'custom_inquiries' })),
        ...(customOrders || []).map((r) => ({ ...r, _source: 'order', _collection: COLLECTIONS.ORDERS })),
      ]
      merged.sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
      productions.value = merged
    } else if (activeTab.value === 'config') {
      customConfigs.value = await fetchCollectionSorted(COLLECTIONS.CUSTOM_CONFIGS, {
        limit: 200,
        sortFn: (a, b) => (a.sort ?? 0) - (b.sort ?? 0),
      })
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
    amount: row.quote?.amount || row.budget || 0,
    days: row.quote?.days || 14,
    estimatedDate: row.quote?.estimatedDate || '',
    note: row.quote?.note || ''
  }
  quoteDialog.value = true
}

const markContacted = async (row) => {
  try {
    await cdnUpdate('custom_inquiries', row._id, {
      status: 'contacted',
      updateTime: Date.now()
    })
    ElMessage.success('已标记为已联系')
    refresh()
  } catch (e) {
    ElMessage.error(e.message || '更新失败')
  }
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
      },
      updateTime: Date.now()
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
      productionStatus: 'pending_make',
      acceptedAt: Date.now(),
      updateTime: Date.now()
    })
    ElMessage.success('已接单')
    refresh()
  }).catch(() => {})
}

const closeInquiry = (row) => {
  ElMessageBox.confirm('关闭询单？关闭后无法继续报价。', '关闭确认', { type: 'warning' }).then(async () => {
    await cdnUpdate('custom_inquiries', row._id, { status: 'closed', updateTime: Date.now() })
    ElMessage.success('已关闭')
    refresh()
  }).catch(() => {})
}

const advanceProduction = (row) => {
  const order = ['pending_make', 'awaiting_intake', 'framing', 'packing', 'shipped', 'completed']
  const cur = row.productionStatus || 'pending_make'
  const idx = Math.max(0, order.indexOf(cur))
  const next = order[Math.min(idx + 1, order.length - 1)]
  const collection = row._collection || 'custom_inquiries'
  ElMessageBox.confirm(`推进至【${productionStatusLabel(next)}】？`, '阶段推进', { type: 'warning' }).then(async () => {
    await cdnUpdate(collection, row._id, {
      productionStatus: next,
      [`stageTime.${next}`]: Date.now(),
      updateTime: Date.now()
    })
    ElMessage.success('已推进')
    refresh()
  }).catch(() => {})
}

const assignFramer = (row) => {
  ElMessageBox.prompt('请输入师傅姓名 / ID', '分配标本师', { inputPlaceholder: '例如：王师傅' }).then(async ({ value }) => {
    if (!value) return
    const collection = row._collection || 'custom_inquiries'
    await cdnUpdate(collection, row._id, { framerName: value, updateTime: Date.now() })
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

const openConfigForm = (row) => {
  if (row) {
    configForm.value = {
      _id: row._id,
      type: row.type || 'frame',
      name: row.name || '',
      desc: row.desc || '',
      priceDelta: Number(row.priceDelta) || 0,
      sort: Number(row.sort) || 10,
      active: row.status !== 'inactive',
    }
  } else {
    configForm.value = emptyConfigForm()
  }
  configDialog.value = true
}

const saveConfig = async () => {
  const f = configForm.value
  if (!f.name?.trim() || !f.type) return ElMessage.warning('请填写名称与类型')
  configSaving.value = true
  try {
    const data = {
      type: f.type,
      name: f.name.trim(),
      desc: (f.desc || '').trim(),
      priceDelta: Number(f.priceDelta) || 0,
      sort: Number(f.sort) || 10,
      status: f.active ? 'active' : 'inactive',
    }
    if (f._id) {
      await cdnUpdate(COLLECTIONS.CUSTOM_CONFIGS, f._id, data)
    } else {
      await cdnAdd(COLLECTIONS.CUSTOM_CONFIGS, { ...data, configId: `cfg_${Date.now()}` })
    }
    ElMessage.success('已保存')
    configDialog.value = false
    refresh()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    configSaving.value = false
  }
}

const deleteConfig = (row) => {
  ElMessageBox.confirm(`删除「${row.name}」？小程序定制页将不再展示。`, '删除确认', { type: 'warning' })
    .then(async () => {
      await cdnRemove(COLLECTIONS.CUSTOM_CONFIGS, row._id)
      ElMessage.success('已删除')
      refresh()
    })
    .catch(() => {})
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
.config-toolbar { display: flex; gap: 10px; margin-bottom: 12px; align-items: center; }
</style>
