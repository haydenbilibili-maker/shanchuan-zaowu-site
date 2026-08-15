<template>
  <div class="fb-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>飞书多维表对接</h2>
        <span class="subtitle">
          飞书管采购/原料库存 · Admin 管订货履约与成品仓 · 禁止无映射双写
        </span>
      </div>
      <div class="header-actions">
        <el-button @click="openBase">打开飞书 Base</el-button>
        <el-button :loading="inspecting" type="primary" @click="inspect">探测表结构</el-button>
        <el-button :icon="Refresh" circle @click="refreshMirrors" />
      </div>
    </div>

    <el-alert
      v-if="hint"
      :title="hint"
      :type="hintType"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
    />

    <el-alert
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 14px"
      title="开通：飞书应用 bitable:app → 添加文档应用（可编辑）→ 本地 admin/.env 或线上 Cloudflare Pages 环境变量填写 FEISHU_APP_ID / FEISHU_APP_SECRET（不要 VITE_）。密钥不进 SPA。"
    />

    <el-row :gutter="12" class="stat-row">
      <el-col :span="8">
        <el-card shadow="never" class="stat">
          <div class="stat-num">{{ purchases.length }}</div>
          <div class="stat-label">采购镜像</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never" class="stat">
          <div class="stat-num">{{ inventory.length }}</div>
          <div class="stat-label">库存镜像</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never" class="stat">
          <div class="stat-num">{{ matchedCount }}</div>
          <div class="stat-label">已映射藏品 SKU</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="block">
      <template #header>
        <div class="card-head">
          <span>表与字段映射</span>
          <el-button size="small" type="primary" :loading="saving" @click="saveMapping">
            保存映射
          </el-button>
        </div>
      </template>
      <el-empty v-if="!tables.length" description="先点「探测表结构」。成功后会列出 Base 内所有数据表。" :image-size="72" />
      <el-row v-else :gutter="16">
        <el-col v-for="role in roles" :key="role.key" :span="8">
          <div class="role-title">{{ role.label }}</div>
          <el-form label-position="top" size="small">
            <el-form-item label="飞书数据表">
              <el-select v-model="mapping[role.key].tableId" placeholder="选择数据表" filterable style="width: 100%">
                <el-option v-for="t in tables" :key="t.tableId" :label="t.name" :value="t.tableId" />
              </el-select>
            </el-form-item>
            <el-form-item v-for="f in role.fields" :key="f.key" :label="f.label">
              <el-select
                v-model="mapping[role.key].fields[f.key]"
                :placeholder="`飞书列 · ${f.hint}`"
                filterable
                clearable
                allow-create
                style="width: 100%"
              >
                <el-option
                  v-for="col in fieldsOf(mapping[role.key].tableId)"
                  :key="col.name"
                  :label="`${col.name} (${col.uiType || col.type})`"
                  :value="col.name"
                />
              </el-select>
            </el-form-item>
          </el-form>
        </el-col>
      </el-row>
    </el-card>

    <el-card shadow="never" class="block">
      <template #header>同步动作</template>
      <div class="actions">
        <el-button :loading="busy === 'pullPurchases'" @click="run('pullPurchases')">拉取采购</el-button>
        <el-button :loading="busy === 'pullInventory'" @click="run('pullInventory')">拉取库存</el-button>
        <el-button type="warning" :loading="busy === 'applyInventory'" @click="confirmApply">应用为 HQ 库存</el-button>
        <el-button type="success" :loading="busy === 'pushShipments'" @click="run('pushShipments')">回写出货单</el-button>
      </div>
      <p class="hint-line">
        拉取只更新镜像，不改商城库存。「应用为 HQ 库存」才把已映射 SKU 写入 products.stock 并记 feishu_pull 流水。
      </p>
    </el-card>

    <el-tabs v-model="mirrorTab">
      <el-tab-pane name="purchases" label="采购镜像">
        <el-table :data="purchases" v-loading="loadingMirrors" stripe max-height="420">
          <template #empty><el-empty description="尚未拉取。映射采购表后点「拉取采购」。" :image-size="64" /></template>
          <el-table-column prop="orderNo" label="单号" width="140" show-overflow-tooltip />
          <el-table-column prop="skuName" label="物料" min-width="140" show-overflow-tooltip />
          <el-table-column prop="qty" label="数量" width="80" />
          <el-table-column prop="supplier" label="供应商" width="120" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="100" />
          <el-table-column prop="date" label="日期" width="120" />
        </el-table>
      </el-tab-pane>
      <el-tab-pane name="inventory" label="库存镜像">
        <el-table :data="inventory" v-loading="loadingMirrors" stripe max-height="420">
          <template #empty><el-empty description="尚未拉取。映射库存表后点「拉取库存」。" :image-size="64" /></template>
          <el-table-column prop="skuName" label="品名" min-width="140" show-overflow-tooltip />
          <el-table-column prop="skuId" label="SKU" width="120" show-overflow-tooltip />
          <el-table-column prop="qty" label="飞书数量" width="100" />
          <el-table-column prop="unit" label="单位" width="80" />
          <el-table-column label="映射藏品" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.productId" size="small" type="success">已映射</el-tag>
              <el-tag v-else size="small" type="info">未映射</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
      <el-tab-pane name="logs" label="同步日志">
        <el-table :data="logs" stripe max-height="420">
          <template #empty><el-empty description="尚无同步记录。" :image-size="64" /></template>
          <el-table-column label="时间" width="168">
            <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column prop="action" label="动作" width="140" />
          <el-table-column label="结果" width="80">
            <template #default="{ row }">
              <el-tag :type="row.ok ? 'success' : 'danger'" size="small">{{ row.ok ? '成功' : '失败' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="message" label="摘要" min-width="220" show-overflow-tooltip />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { fetchCollectionLimit, COLLECTIONS } from '../cloud'
import { feishuProxyStatus, runFeishuSync } from '../utils/feishuSync'

const roles = [
  {
    key: 'purchase',
    label: '采购（飞书主写）',
    fields: [
      { key: 'orderNo', label: '单号列', hint: '单号' },
      { key: 'skuName', label: '物料列', hint: '物料' },
      { key: 'qty', label: '数量列', hint: '数量' },
      { key: 'supplier', label: '供应商列', hint: '供应商' },
      { key: 'status', label: '状态列', hint: '状态' },
      { key: 'date', label: '日期列', hint: '日期' },
    ],
  },
  {
    key: 'inventory',
    label: '库存（飞书主写）',
    fields: [
      { key: 'skuName', label: '品名列', hint: '品名' },
      { key: 'skuId', label: 'SKU 列', hint: 'SKU' },
      { key: 'qty', label: '数量列', hint: '数量' },
      { key: 'unit', label: '单位列', hint: '单位' },
    ],
  },
  {
    key: 'shipment',
    label: '出货（Admin 回写）',
    fields: [
      { key: 'orderNo', label: '订货单号列', hint: '订货单号' },
      { key: 'storeName', label: '门店列', hint: '门店' },
      { key: 'carrier', label: '物流公司列', hint: '物流公司' },
      { key: 'trackingNumber', label: '物流单号列', hint: '物流单号' },
      { key: 'status', label: '状态列', hint: '状态' },
    ],
  },
]

const emptyMapping = () => ({
  purchase: { tableId: '', fields: { orderNo: '单号', skuName: '物料', qty: '数量', supplier: '供应商', status: '状态', date: '日期' } },
  inventory: { tableId: '', fields: { skuName: '品名', skuId: 'SKU', qty: '数量', unit: '单位' } },
  shipment: { tableId: '', fields: { orderNo: '订货单号', storeName: '门店', carrier: '物流公司', trackingNumber: '物流单号', status: '状态' } },
})

const mapping = reactive(emptyMapping())
const tables = ref([])
const inspecting = ref(false)
const saving = ref(false)
const busy = ref('')
const hint = ref('')
const hintType = ref('warning')
const purchases = ref([])
const inventory = ref([])
const logs = ref([])
const loadingMirrors = ref(false)
const mirrorTab = ref('purchases')

const matchedCount = computed(() => inventory.value.filter((r) => r.productId).length)

const fieldsOf = (tableId) => {
  const t = tables.value.find((x) => x.tableId === tableId)
  return t?.fields || []
}

const openBase = () => {
  window.open('https://hcni0smm11e2.feishu.cn/base/WCs2bnIHsaty7vsjcnaczu0Wnod', '_blank', 'noopener')
}

const fmt = (t) => {
  if (!t) return '—'
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}

const guessRole = (name = '') => {
  if (/采购|订货|purchase/i.test(name)) return 'purchase'
  if (/出货|发货|物流|shipment/i.test(name)) return 'shipment'
  if (/库存|盘点|inventory|stock/i.test(name)) return 'inventory'
  return null
}

const guessField = (roleKey, fieldKey, cols) => {
  const names = cols.map((c) => c.name)
  const hints = {
    orderNo: [/单号/, /编号/, /NO/i],
    skuName: [/品名/, /物料/, /名称/, /商品/],
    skuId: [/SKU/i, /货号/, /编码/],
    qty: [/数量/, /库存/, /余量/],
    unit: [/单位/],
    supplier: [/供应商/, /厂家/],
    status: [/状态/],
    date: [/日期/, /时间/],
    storeName: [/门店/, /客户/, /收货/],
    carrier: [/物流/, /快递/, /承运/],
    trackingNumber: [/运单/, /快递单/, /物流单/],
  }
  const patterns = hints[fieldKey] || []
  return names.find((n) => patterns.some((p) => p.test(n))) || mapping[roleKey].fields[fieldKey] || ''
}

const unwrap = (res) => {
  if (!res) throw new Error('无返回')
  if (res.success === false) throw new Error(res.msg || '同步失败')
  return res
}

const inspect = async () => {
  inspecting.value = true
  hint.value = ''
  try {
    const res = unwrap(await runFeishuSync('inspect'))
    tables.value = res.tables || []
    for (const t of tables.value) {
      const role = guessRole(t.name)
      if (role && !mapping[role].tableId) {
        mapping[role].tableId = t.tableId
        for (const f of roles.find((r) => r.key === role).fields) {
          mapping[role].fields[f.key] = guessField(role, f.key, t.fields)
        }
      }
    }
    hint.value = `已探测 ${tables.value.length} 张表。请核对映射后保存。`
    hintType.value = 'success'
    ElMessage.success(hint.value)
  } catch (e) {
    hintType.value = 'warning'
    hint.value = `探测失败：${e.message || e}`
  } finally {
    inspecting.value = false
  }
}

const saveMapping = async () => {
  saving.value = true
  try {
    unwrap(await runFeishuSync('saveMapping', { mapping: { tables: { ...mapping } } }))
    ElMessage.success('映射已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const run = async (action) => {
  busy.value = action
  try {
    const res = unwrap(await runFeishuSync(action))
    ElMessage.success(res.msg || '完成')
    await refreshMirrors()
  } catch (e) {
    ElMessage.error(e.message || '同步失败')
  } finally {
    busy.value = ''
  }
}

const confirmApply = async () => {
  try {
    await ElMessageBox.confirm(
      '将把已映射 SKU 的飞书数量写入 products.stock，并追加 feishu_pull 流水。未映射行不会改动。确认？',
      '应用为 HQ 库存',
      { type: 'warning', confirmButtonText: '应用', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await run('applyInventory')
}

const refreshMirrors = async () => {
  loadingMirrors.value = true
  try {
    const [p, i, l] = await Promise.all([
      fetchCollectionLimit(COLLECTIONS.FEISHU_PURCHASES, { limit: 200 }).catch(() => []),
      fetchCollectionLimit(COLLECTIONS.FEISHU_INVENTORY, { limit: 200 }).catch(() => []),
      fetchCollectionLimit(COLLECTIONS.FEISHU_SYNC_LOGS, { limit: 40 }).catch(() => []),
    ])
    purchases.value = p || []
    inventory.value = i || []
    logs.value = (l || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    if (!p?.length && !i?.length) {
      hintType.value = 'info'
      if (!hint.value) hint.value = '镜像为空。先探测并映射，再拉取采购/库存。'
    }
  } finally {
    loadingMirrors.value = false
  }
}

const loadConfig = async () => {
  try {
    const res = await runFeishuSync('getConfig')
    if (res?.success && res.config?.tables) {
      for (const key of ['purchase', 'inventory', 'shipment']) {
        if (res.config.tables[key]) {
          mapping[key].tableId = res.config.tables[key].tableId || ''
          mapping[key].fields = { ...mapping[key].fields, ...(res.config.tables[key].fields || {}) }
        }
      }
    }
  } catch {
    /* 映射尚未保存 */
  }
}

onMounted(async () => {
  await refreshMirrors()
  await loadConfig()
  const st = await feishuProxyStatus()
  if (!st.configured) {
    hintType.value = 'warning'
    hint.value = st.msg || '请配置 FEISHU_APP_ID / FEISHU_APP_SECRET 后重试。'
  } else if (!hint.value) {
    hintType.value = 'success'
    hint.value = '飞书代理已就绪，可点「探测表结构」。'
  }
})

defineExpose({ refresh: refreshMirrors })
</script>

<style scoped>
.fb-container { padding: 4px 0 24px; }
.panel-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 12px; margin-bottom: 14px; flex-wrap: wrap;
}
.title-box h2 { margin: 0; font-size: 18px; font-weight: 600; }
.subtitle { color: var(--el-text-color-secondary); font-size: 12px; }
.header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.stat-row { margin-bottom: 12px; }
.stat { text-align: center; }
.stat-num { font-size: 22px; font-weight: 600; }
.stat-label { font-size: 12px; color: var(--el-text-color-secondary); }
.block { margin-bottom: 14px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.role-title { font-weight: 600; margin-bottom: 8px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.hint-line { margin: 10px 0 0; font-size: 12px; color: var(--el-text-color-secondary); }
</style>
