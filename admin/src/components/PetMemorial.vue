<template>
  <div class="pet-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>伴宠记忆 / PET MEMORIAL</h2>
        <span class="subtitle">PET MEMORIAL · 伴宠纪念订单与工艺配置</span>
      </div>
      <div class="header-actions">
        <el-button v-if="activeTab === 'crafts'" type="primary" color="#d4af37" @click="openCraftDialog()">新建工艺</el-button>
        <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
      </div>
    </div>

    <el-tabs v-model="activeTab" @tab-change="refresh">
      <el-tab-pane label="订单履约" name="orders" />
      <el-tab-pane label="工艺配置" name="crafts" />
    </el-tabs>

    <template v-if="activeTab === 'orders'">
      <div class="filter-bar">
        <el-radio-group v-model="statusFilter" fill="#d4af37" @change="refresh">
          <el-radio-button label="all">全部</el-radio-button>
          <el-radio-button label="pending_review">待审核</el-radio-button>
          <el-radio-button label="accepted">已接单</el-radio-button>
          <el-radio-button label="awaiting_intake">待收件</el-radio-button>
          <el-radio-button label="in_production">制作中</el-radio-button>
          <el-radio-button label="completed">已完成</el-radio-button>
        </el-radio-group>
      </div>

      <div class="cards-grid" v-loading="loading">
        <div v-for="row in list" :key="row._id" class="pet-card">
          <div class="card-header">
            <span class="order-no">{{ row.orderNo || row._id.slice(0, 10) }}</span>
            <el-tag :type="statusType(row.status)" effect="dark" size="small">{{ statusLabel(row.status) }}</el-tag>
          </div>
          <div class="pet-info">
            <div class="pet-avatar">{{ row.pet?.name?.charAt(0) || '🐾' }}</div>
            <div class="pet-detail">
              <div class="pet-name">{{ row.pet?.name || '未命名' }}</div>
              <div class="pet-species">{{ row.pet?.species }} <span v-if="row.pet?.breed">· {{ row.pet.breed }}</span></div>
              <div class="pet-meta" v-if="row.pet?.weight || row.pet?.age">
                <span v-if="row.pet?.weight">体重 {{ row.pet.weight }}</span>
                <span v-if="row.pet?.age" style="margin-left: 10px">年龄 {{ row.pet.age }}</span>
              </div>
            </div>
          </div>
          <div class="craft-info">
            <div class="row-line">
              <span class="lbl">工艺</span><span class="val">{{ row.craft?.craftName || row.craft?.craftId }}</span>
            </div>
            <div class="row-line" v-if="row.intake?.method">
              <span class="lbl">送检</span><span class="val">{{ intakeLabel(row.intake.method) }}</span>
            </div>
            <div class="row-line">
              <span class="lbl">联系人</span><span class="val">{{ row.contact?.name }} ({{ row.contact?.phone }})</span>
            </div>
            <div class="row-line" v-if="row.quote">
              <span class="lbl">报价</span><span class="val price">¥{{ row.quote.amount }}</span>
            </div>
          </div>

          <div class="timeline" v-if="row.productionLog && row.productionLog.length">
            <div v-for="(log, i) in row.productionLog.slice(-3)" :key="i" class="tl-item">
              <span class="tl-dot"></span>
              <div class="tl-content">
                <div class="tl-status">{{ statusLabel(log.status) }}</div>
                <div class="tl-time">{{ fmtTime(log.time) }}</div>
                <div class="tl-note" v-if="log.note">{{ log.note }}</div>
              </div>
            </div>
          </div>

          <div class="card-actions">
            <el-button v-if="row.status === 'pending_review'" size="small" type="primary" color="#d4af37" @click="quoteOrder(row)">报价并接单</el-button>
            <el-button v-if="row.status === 'accepted'" size="small" type="success" @click="advance(row, 'awaiting_intake')">通知送件</el-button>
            <el-button v-if="row.status === 'awaiting_intake'" size="small" type="success" @click="advance(row, 'in_production')">开始制作</el-button>
            <el-button v-if="row.status === 'in_production'" size="small" type="success" @click="advance(row, 'completed')">标记完成</el-button>
            <el-button size="small" link @click="viewDetail(row)">详情</el-button>
          </div>
        </div>
        <div v-if="!loading && !list.length" class="empty">暂无订单</div>
      </div>
    </template>

    <template v-else>
      <el-table :data="crafts" v-loading="loading" stripe>
        <el-table-column prop="sort" label="排序" width="72" />
        <el-table-column label="工艺" min-width="160">
          <template #default="{ row }">
            <div class="pet-name">{{ row.name }}</div>
            <div class="g-id">{{ row.craftId }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="desc" label="说明" min-width="220" show-overflow-tooltip />
        <el-table-column prop="estimatedWeeks" label="周期" width="120" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link @click="openCraftDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" link @click="removeCraft(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!loading && !crafts.length" class="empty">暂无工艺配置；小程序将回退内置默认三项</div>
    </template>

    <!-- 报价弹窗 -->
    <el-dialog v-model="quoteDialog" title="录入报价单" width="500px">
      <el-form :model="quoteForm" label-width="100px">
        <el-form-item label="报价金额">
          <el-input-number v-model="quoteForm.amount" :min="0" :step="100" style="width: 100%" />
        </el-form-item>
        <el-form-item label="报价有效期">
          <el-date-picker v-model="quoteForm.validUntil" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="quoteForm.note" type="textarea" :rows="3" placeholder="工艺说明、附加费用等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="quoteDialog = false">取消</el-button>
        <el-button type="primary" color="#d4af37" @click="submitQuote">发送报价并接单</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="craftDialog" :title="craftForm._id ? '编辑工艺' : '新建工艺'" width="520px" destroy-on-close>
      <el-form :model="craftForm" label-width="100px">
        <el-form-item label="craftId" required>
          <el-input v-model="craftForm.craftId" :disabled="!!craftForm._id" placeholder="如 fluid / taxidermy" />
        </el-form-item>
        <el-form-item label="名称" required><el-input v-model="craftForm.name" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="craftForm.desc" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="周期"><el-input v-model="craftForm.estimatedWeeks" placeholder="约 4–8 周" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="craftForm.sort" :min="0" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="craftForm.status" style="width: 160px">
            <el-option label="active" value="active" />
            <el-option label="inactive" value="inactive" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="craftDialog = false">取消</el-button>
        <el-button type="primary" color="#d4af37" @click="saveCraft">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="detailDrawer" title="订单完整数据" size="600px">
      <pre v-if="currentRow" class="raw-json">{{ JSON.stringify(currentRow, null, 2) }}</pre>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import {
  fetchCollectionSorted,
  cdnAdd,
  cdnUpdate,
  cdnRemove,
  cdnDocGet,
} from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

const activeTab = ref('orders')
const list = ref([])
const crafts = ref([])
const loading = ref(false)
const statusFilter = ref('all')
const quoteDialog = ref(false)
const craftDialog = ref(false)
const detailDrawer = ref(false)
const currentRow = ref(null)
const quoteForm = ref({ amount: 0, validUntil: '', note: '' })
const craftForm = ref({ _id: '', craftId: '', name: '', desc: '', estimatedWeeks: '', sort: 1, status: 'active' })

const STATUS = {
  pending_review: { text: '待审核', type: 'warning' },
  accepted: { text: '已接单', type: '' },
  awaiting_intake: { text: '待收件', type: 'warning' },
  in_production: { text: '制作中', type: '' },
  completed: { text: '已完成', type: 'success' },
  cancelled: { text: '已取消', type: 'info' }
}
const statusLabel = (s) => STATUS[s]?.text || s
const statusType = (s) => STATUS[s]?.type || 'info'
const INTAKE = { mail: '快递到店', visit: '门店送达', pickup: '上门取件' }
const intakeLabel = (m) => INTAKE[m] || m

const fmt = (ts) => {
  if (!ts) return ''
  const d = typeof ts === 'object' && ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('zh-CN')
}
const fmtTime = (t) => {
  if (!t) return ''
  return new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const refresh = async () => {
  loading.value = true
  try {
    if (activeTab.value === 'crafts') {
      crafts.value = await fetchCollectionSorted('pet_craft_configs', {
        limit: 100,
        sortFn: (a, b) => (a.sort || 0) - (b.sort || 0)
      })
    } else {
      const where = statusFilter.value !== 'all' ? { status: statusFilter.value } : null
      list.value = await fetchCollectionSorted('pet_memorial_orders', {
        limit: 200,
        where,
        sortFn: (a, b) => (b.createTime || 0) - (a.createTime || 0)
      })
    }
  } catch (e) {
    list.value = []
    crafts.value = []
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}

const openCraftDialog = (row) => {
  craftForm.value = row
    ? {
        _id: row._id,
        craftId: row.craftId || '',
        name: row.name || '',
        desc: row.desc || '',
        estimatedWeeks: row.estimatedWeeks || '',
        sort: row.sort ?? 1,
        status: row.status || 'active'
      }
    : { _id: '', craftId: '', name: '', desc: '', estimatedWeeks: '', sort: 1, status: 'active' }
  craftDialog.value = true
}

const saveCraft = async () => {
  const f = craftForm.value
  if (!f.craftId?.trim() || !f.name?.trim()) return ElMessage.warning('craftId 与名称必填')
  const payload = {
    craftId: f.craftId.trim(),
    name: f.name.trim(),
    desc: f.desc || '',
    estimatedWeeks: f.estimatedWeeks || '',
    sort: f.sort ?? 1,
    status: f.status || 'active',
    updateTime: Date.now()
  }
  try {
    if (f._id) await cdnUpdate('pet_craft_configs', f._id, payload)
    else await cdnAdd('pet_craft_configs', { ...payload, createTime: Date.now() })
    ElMessage.success('工艺已保存')
    craftDialog.value = false
    refresh()
  } catch (e) {
    ElMessage.error('保存失败：' + e.message)
  }
}

const removeCraft = (row) => {
  ElMessageBox.confirm(`删除工艺「${row.name}」？`, '确认', { type: 'warning' }).then(async () => {
    await cdnRemove('pet_craft_configs', row._id)
    ElMessage.success('已删除')
    refresh()
  }).catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

const quoteOrder = (row) => {
  currentRow.value = row
  quoteForm.value = { amount: 0, validUntil: '', note: '' }
  quoteDialog.value = true
}

const submitQuote = async () => {
  if (!quoteForm.value.amount) return ElMessage.warning('请输入报价金额')
  try {
    const log = {
      status: 'accepted',
      time: new Date().toISOString(),
      note: `报价 ¥${quoteForm.value.amount}${quoteForm.value.note ? ' · ' + quoteForm.value.note : ''}`
    }
    const existing = await cdnDocGet('pet_memorial_orders', currentRow.value._id)
    const productionLog = [...(existing?.productionLog || []), log]
    await cdnUpdate('pet_memorial_orders', currentRow.value._id, {
      status: 'accepted',
      quote: {
        amount: quoteForm.value.amount,
        validUntil: quoteForm.value.validUntil,
        note: quoteForm.value.note,
        quotedAt: Date.now()
      },
      productionLog,
      updateTime: Date.now()
    })
    ElMessage.success('已报价并接单')
    quoteDialog.value = false
    refresh()
  } catch (e) {
    ElMessage.error('操作失败：' + e.message)
  }
}

const advance = (row, nextStatus) => {
  ElMessageBox.prompt(`推进至【${statusLabel(nextStatus)}】？可附备注。`, '阶段推进', {
    inputType: 'textarea',
    inputPlaceholder: '可填阶段说明（选填）'
  }).then(async ({ value }) => {
    const log = {
      status: nextStatus,
      time: new Date().toISOString(),
      note: value || ''
    }
    const existing = await cdnDocGet('pet_memorial_orders', row._id)
    const productionLog = [...(existing?.productionLog || []), log]
    await cdnUpdate('pet_memorial_orders', row._id, {
      status: nextStatus,
      productionLog,
      updateTime: Date.now()
    })
    ElMessage.success('已推进')
    refresh()
  }).catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

const viewDetail = (row) => {
  currentRow.value = row
  detailDrawer.value = true
}

onMounted(refresh)
</script>

<style scoped>
.pet-container { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 12px; }
.header-actions { display: flex; gap: 8px; align-items: center; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }
.filter-bar { margin-bottom: 20px; }
.g-id { font-size: 11px; color: #999; font-family: monospace; margin-top: 2px; }

.cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
.pet-card { background: #fff; border-radius: 12px; padding: 18px; border: 1px solid #f0f0f0; box-shadow: 0 2px 8px rgba(0,0,0,0.04); display: flex; flex-direction: column; gap: 12px; }
.pet-card:hover { box-shadow: 0 6px 20px rgba(212,175,55,0.15); transform: translateY(-2px); transition: 0.2s; }

.card-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; border-bottom: 1px dashed #eee; }
.order-no { font-family: monospace; font-weight: bold; color: #333; }

.pet-info { display: flex; align-items: center; gap: 12px; }
.pet-avatar { width: 50px; height: 50px; border-radius: 50%; background: linear-gradient(135deg, #d4af37, #b7950b); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: bold; }
.pet-name { font-weight: bold; font-size: 16px; color: #333; }
.pet-species { font-size: 13px; color: #666; margin-top: 2px; }
.pet-meta { font-size: 11px; color: #999; margin-top: 4px; }

.craft-info { background: #fafafa; padding: 10px; border-radius: 8px; }
.row-line { display: flex; gap: 8px; font-size: 13px; margin: 4px 0; }
.row-line .lbl { color: #999; width: 50px; }
.row-line .val { color: #333; flex: 1; }
.row-line .val.price { color: #d4af37; font-weight: bold; }

.timeline { border-left: 2px solid #f5f5f5; padding-left: 12px; }
.tl-item { position: relative; margin-bottom: 8px; }
.tl-dot { position: absolute; left: -17px; top: 5px; width: 8px; height: 8px; background: #d4af37; border-radius: 50%; }
.tl-status { font-size: 12px; font-weight: bold; color: #333; }
.tl-time { font-size: 11px; color: #999; }
.tl-note { font-size: 12px; color: #666; margin-top: 2px; }

.card-actions { display: flex; gap: 8px; justify-content: flex-end; padding-top: 8px; border-top: 1px dashed #eee; flex-wrap: wrap; }

.empty { text-align: center; color: #ccc; padding: 60px; grid-column: 1 / -1; }
.raw-json { background: #f5f5f5; padding: 16px; border-radius: 8px; font-size: 12px; max-height: 80vh; overflow: auto; }
</style>
