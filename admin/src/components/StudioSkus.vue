<template>
  <div class="studio-skus">
    <div class="header-section">
      <h2>出货 SKU 目录</h2>
      <p class="subtitle">
        出货开单时直接选的<b>可复用组合</b>：<b>材料 × 等级 × 包装 × 尺寸 × 是否造景</b>（+ 默认手工费率 / 默认造景成本）。
        SKU <b>不持有价格</b>——单价在出货时按<b>当时的价目表</b>算，并把快照写进单据，所以之后改价目表不会回头改老单。
        集合 <code>studio_shipment_skus</code>；写权限仅超管。
      </p>
    </div>

    <el-alert
      v-if="!config.enabled"
      type="warning"
      :closable="false"
      show-icon
      class="rule-alert"
      title="算价未启用，所以下面的「现算单价」都会是待核价"
    >
      <template #default>
        去 <b>价目表配置 → 费率与规则</b> 打开「启用算价」后，这里才会出现真实单价。
        在此之前 SKU 目录本身可以照常维护（组合与费率与价格无关）。
      </template>
    </el-alert>

    <el-card shadow="never" class="main-card" v-loading="loading">
      <div class="toolbar">
        <el-input
          v-model="keyword"
          placeholder="搜 SKU 名或组合（如 大蓝闪 / 玻璃罩）"
          clearable
          style="width: 240px"
          @keyup.enter="loadList"
          @clear="loadList"
        />
        <el-select v-model="statusFilter" style="width: 130px" @change="loadList">
          <el-option label="全部状态" value="all" />
          <el-option label="启用" value="active" />
          <el-option label="停用" value="inactive" />
        </el-select>
        <el-button @click="loadList">刷新</el-button>
        <el-button type="primary" @click="openCreate">新增 SKU</el-button>
      </div>

      <div class="rule-hint">
        <b>为什么要先建 SKU：</b>一张出货单通常重复卖同几个组合。建一次之后开单只选不填，
        名字写法不会再有歧义。<b>想改默认费率或造景成本，编辑这一条 —— 不要新建</b>：
        同一个组合重复建会被服务端挡下（唯一键 = 材料|等级|包装|尺寸|是否造景）。
      </div>

      <el-table :data="list" stripe size="small" empty-text="还没有 SKU —— 点「新增 SKU」建第一条">
        <el-table-column prop="skuName" label="SKU 名" min-width="210" />
        <el-table-column prop="materialName" label="材料" min-width="120" />
        <el-table-column label="等级" width="95">
          <template #default="{ row }">
            <span :class="{ muted: !row.materialGrade || row.materialGrade === '默认' }">{{ shown(row.materialGrade) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="packagingName" label="包装" min-width="110" />
        <el-table-column label="尺寸" width="115">
          <template #default="{ row }">
            <span :class="{ muted: !row.packagingSize || row.packagingSize === '默认' }">{{ shown(row.packagingSize) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="造景" width="120">
          <template #default="{ row }">
            <template v-if="row.hasScene">
              <el-tag size="small" type="warning">造景</el-tag>
              <span class="cell-sub">¥{{ money(row.sceneCost) }}/件</span>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="手工费率" width="110" align="right">
          <template #default="{ row }">
            <span v-if="row.useGlobalRate" class="muted">全局 {{ config.laborRatePct }}%</span>
            <span v-else>{{ row.laborRatePct }}%</span>
          </template>
        </el-table-column>
        <el-table-column label="现算单价" width="120" align="right">
          <template #default="{ row }">
            <span v-if="row.unitPrice !== null && row.unitPrice !== undefined">¥{{ money(row.unitPrice) }}</span>
            <el-tooltip v-else :content="row.pricingNote || '取不到价'" placement="top">
              <el-tag size="small" type="info">待核价</el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'active' ? 'success' : 'info'">
              {{ row.status === 'active' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link size="small" @click="toggleStatus(row)">
              {{ row.status === 'active' ? '停用' : '启用' }}
            </el-button>
            <el-button link type="danger" size="small" @click="removeSku(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- ───────── 新增 / 编辑 ───────── -->
    <el-dialog v-model="dialog.visible" :title="dialog.id ? '编辑 SKU' : '新增 SKU'" width="620px">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="rule-alert"
        title="组合决定这是什么货；费率与造景成本只是默认值，出货时还能在单行上改"
      />
      <el-form label-width="104px" label-position="left">
        <el-form-item label="原材料" required>
          <el-select
            v-model="form.materialName"
            filterable
            remote
            reserve-keyword
            :remote-method="searchMaterials"
            :loading="searching.material"
            placeholder="搜材料名或别名（如 大蓝闪）"
            style="width: 100%"
            @change="onMaterialChange"
          >
            <el-option v-for="g in materialGroups" :key="g.normName" :label="g.displayName" :value="g.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="等级">
          <el-select v-model="form.materialGrade" placeholder="默认（不写等级时用的行）" style="width: 100%">
            <el-option label="默认" value="" />
            <el-option v-for="o in materialOptions" :key="o._id" :label="optionLabel(o)" :value="o.option" />
          </el-select>
          <div class="field-hint">只列出该材料在价目表里<b>已配的等级</b>。要用新等级，先去价目表加行。</div>
        </el-form-item>
        <el-form-item label="包装方式" required>
          <el-select
            v-model="form.packagingName"
            filterable
            remote
            reserve-keyword
            :remote-method="searchPackagings"
            :loading="searching.packaging"
            placeholder="搜包装名或别名（如 相框 / 框）"
            style="width: 100%"
            @change="onPackagingChange"
          >
            <el-option v-for="g in packagingGroups" :key="g.normName" :label="g.displayName" :value="g.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="尺寸">
          <el-select v-model="form.packagingSize" placeholder="默认（不写尺寸时用的行）" style="width: 100%">
            <el-option label="默认" value="" />
            <el-option v-for="o in packagingOptions" :key="o._id" :label="optionLabel(o)" :value="o.option" />
          </el-select>
        </el-form-item>
        <el-form-item label="造景">
          <el-switch v-model="form.hasScene" />
          <span class="field-hint">勾上表示这条 SKU 含造景 —— <b>「有无造景」是组合的一部分</b>（有/无是两种货）。</span>
        </el-form-item>
        <el-form-item v-if="form.hasScene" label="造景成本" required>
          <el-input-number v-model="form.sceneCost" :min="0" :precision="2" :step="5" style="width: 180px" />
          <span class="field-hint">元 / 件。计入本单金额、从毛利里扣，<b>不计入手工费基数</b>。不额外计价可填 0。</span>
        </el-form-item>
        <el-form-item label="手工费率">
          <el-switch v-model="form.useGlobalRate" active-text="用全局" />
          <el-input-number
            v-if="!form.useGlobalRate"
            v-model="form.laborRatePct"
            :min="0"
            :max="500"
            :precision="0"
            style="width: 140px; margin-left: 10px"
          />
          <span class="field-hint">
            全局 {{ config.laborRatePct }}%。填 <b>0 是合法值</b>（这条不收手工费），与"用全局"含义不同。
          </span>
        </el-form-item>
        <el-form-item label="SKU 名">
          <el-input v-model="form.skuName" placeholder="留空即自动生成（材料 等级 · 包装 尺寸 · 造景）" />
        </el-form-item>
      </el-form>

      <el-alert v-if="dialog.problems.length" type="error" :closable="false" class="rule-alert">
        <div v-for="(p, i) in dialog.problems" :key="i">{{ p }}</div>
      </el-alert>

      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction } from '../cloud'

const FN = 'manageStudioSettlement'

const loading = ref(false)
const saving = ref(false)
const keyword = ref('')
const statusFilter = ref('all')
const list = ref([])
const config = reactive({ enabled: false, laborRatePct: 30 })

const materialGroups = ref([])
const packagingGroups = ref([])
const materialOptions = ref([])
const packagingOptions = ref([])
const searching = reactive({ material: false, packaging: false })

const dialog = reactive({ visible: false, id: '', problems: [] })
const form = reactive({
  materialName: '',
  materialGrade: '',
  packagingName: '',
  packagingSize: '',
  hasScene: false,
  sceneCost: 0,
  useGlobalRate: true,
  laborRatePct: 30,
  skuName: ''
})

function money(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : '—'
}
/** 「默认」是占位值不是真等级/尺寸，界面统一显示成破折号，避免误以为有个叫「默认」的规格 */
function shown(v) {
  const s = String(v == null ? '' : v).trim()
  return !s || s === '默认' ? '—' : s
}
function optionLabel(o) {
  const price = Number(o && o.unitPrice ? o.unitPrice : 0)
  return `${o.option === '默认' ? '默认' : o.option}（¥${price.toFixed(2)}${o.isDefault ? ' · 默认行' : ''}）`
}

async function callFn(data) {
  const res = await callCloudFunction({ name: FN, data })
  const body = res && res.result !== undefined ? res.result : res
  if (body && body.success === false) throw new Error(body.msg || '请求失败')
  return body || {}
}

async function loadConfig() {
  try {
    const res = await callFn({ action: 'config.get' })
    const c = res.config || res
    config.enabled = c.enabled === true
    config.laborRatePct = Number(c.laborRatePct) || 30
  } catch (e) {
    // 刻意不弹错：读不到结算配置**不影响维护 SKU 目录**（组合与价目表无关），
    // 只影响"现算单价"那一列（会显示待核价），页面上另有提示条说明。
    // 这里必须留下 warn —— check:silent-catch 是只许降的棘轮，不允许空 catch。
    console.warn('[StudioSkus] 结算配置读取失败，现算单价将显示为待核价：', e && e.message ? e.message : e)
  }
}

async function loadList() {
  loading.value = true
  try {
    const res = await callFn({
      action: 'sku.list',
      keyword: keyword.value,
      status: statusFilter.value === 'all' ? '' : statusFilter.value,
      limit: 200
    })
    list.value = res.list || []
  } catch (e) {
    ElMessage.error(e.message || 'SKU 列表加载失败')
  } finally {
    loading.value = false
  }
}

async function searchGroups(kind, kw, groupsRef, loadingKey) {
  searching[loadingKey] = true
  try {
    const res = await callFn({ action: 'searchPriceBook', kind, keyword: kw || '', limit: 30 })
    groupsRef.value = res.groups || []
  } catch (e) {
    // 搜索失败就置空下拉（人还能手输关键词重试）—— 但不许静默，留 warn
    console.warn('[StudioSkus] 价目表搜索失败：', e && e.message ? e.message : e)
    groupsRef.value = []
  } finally {
    searching[loadingKey] = false
  }
}
const searchMaterials = (kw) => searchGroups('material', kw, materialGroups, 'material')
const searchPackagings = (kw) => searchGroups('packaging', kw, packagingGroups, 'packaging')

/** 选材料后带出它已配的等级，并把默认行预选上（与出货时"不写等级"的取值一致） */
function onMaterialChange(name) {
  const g = materialGroups.value.find((x) => x.name === name)
  materialOptions.value = g ? g.options || [] : []
  const def = materialOptions.value.find((o) => o.isDefault)
  form.materialGrade = def && def.option !== '默认' ? def.option : ''
}
function onPackagingChange(name) {
  const g = packagingGroups.value.find((x) => x.name === name)
  packagingOptions.value = g ? g.options || [] : []
  const def = packagingOptions.value.find((o) => o.isDefault)
  form.packagingSize = def && def.option !== '默认' ? def.option : ''
}

async function openCreate() {
  Object.assign(form, {
    materialName: '',
    materialGrade: '',
    packagingName: '',
    packagingSize: '',
    hasScene: false,
    sceneCost: 0,
    useGlobalRate: true,
    laborRatePct: config.laborRatePct,
    skuName: ''
  })
  materialOptions.value = []
  packagingOptions.value = []
  dialog.id = ''
  dialog.problems = []
  await Promise.all([searchMaterials(''), searchPackagings('')])
  dialog.visible = true
}

async function openEdit(row) {
  Object.assign(form, {
    materialName: row.materialName || '',
    materialGrade: row.materialGrade === '默认' ? '' : row.materialGrade || '',
    packagingName: row.packagingName || '',
    packagingSize: row.packagingSize === '默认' ? '' : row.packagingSize || '',
    hasScene: row.hasScene === true,
    sceneCost: Number(row.sceneCost) || 0,
    useGlobalRate: row.useGlobalRate !== false,
    laborRatePct: row.laborRatePct === null || row.laborRatePct === undefined ? config.laborRatePct : Number(row.laborRatePct),
    skuName: row.skuName || ''
  })
  dialog.id = row._id
  dialog.problems = []
  await Promise.all([searchMaterials(row.materialName || ''), searchPackagings(row.packagingName || '')])
  const mg = materialGroups.value.find((x) => x.name === form.materialName)
  materialOptions.value = mg ? mg.options || [] : []
  const pg = packagingGroups.value.find((x) => x.name === form.packagingName)
  packagingOptions.value = pg ? pg.options || [] : []
  dialog.visible = true
}

function buildItem() {
  const item = {
    materialName: form.materialName,
    materialGrade: form.materialGrade,
    packagingName: form.packagingName,
    packagingSize: form.packagingSize,
    hasScene: form.hasScene === true,
    sceneCost: form.hasScene ? Number(form.sceneCost) || 0 : 0
  }
  if (!form.useGlobalRate) item.laborRatePct = Number(form.laborRatePct) || 0
  if (String(form.skuName || '').trim()) item.skuName = String(form.skuName).trim()
  return item
}

async function save() {
  dialog.problems = []
  if (!form.materialName) return (dialog.problems = ['请选择原材料'])
  if (!form.packagingName) return (dialog.problems = ['请选择包装方式'])
  if (form.hasScene && !(Number(form.sceneCost) >= 0)) {
    return (dialog.problems = ['勾了造景就必须填「造景成本」（元/件；不额外计价可填 0）'])
  }
  saving.value = true
  try {
    const item = buildItem()
    const res = dialog.id
      ? await callFn({ action: 'sku.update', id: dialog.id, item })
      : await callFn({ action: 'sku.create', item })
    if (res.ok === false) {
      // 服务端把"已存在的那个 SKU"带回来了 → 直接告诉他去编辑，不要新建
      dialog.problems = [res.msg || '保存失败'].concat(
        res.duplicate ? [`已在目录里：${res.duplicate.skuName}（打开它改，别新建）`] : []
      )
      if (res.problems && res.problems.length) dialog.problems = dialog.problems.concat(res.problems)
      return
    }
    ElMessage.success(dialog.id ? 'SKU 已更新' : 'SKU 已创建')
    dialog.visible = false
    await loadList()
  } catch (e) {
    dialog.problems = [e.message || '保存失败']
  } finally {
    saving.value = false
  }
}

/**
 * 停用 / 启用：只传 `{status}` 即可 —— 云函数的 `sku.update` 是**部分更新**
 * （服务端会先读出原行再合并，见 `settlementDefaults.mergeSkuUpdate`）。
 * 之所以要专门写一句注释：这个接口原先直接拿 item 过 `buildSkuRow`，
 * 只传 status 会被判成"必须选原材料"而失败 —— 界面上看着像"停用按钮坏了"。
 */
async function toggleStatus(row) {
  const next = row.status === 'active' ? 'inactive' : 'active'
  try {
    const res = await callFn({ action: 'sku.update', id: row._id, item: { status: next } })
    if (res.ok === false) throw new Error(res.msg || '操作失败')
    ElMessage.success(next === 'active' ? '已启用' : '已停用（历史单的快照不受影响）')
    await loadList()
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  }
}

async function removeSku(row) {
  try {
    await ElMessageBox.confirm(
      `删除「${row.skuName}」？删除是软删（历史出货单的定价快照不受影响），之后开单时不再出现。`,
      '确认删除',
      { type: 'warning' }
    )
  } catch (e) {
    return
  }
  try {
    await callFn({ action: 'sku.remove', id: row._id })
    ElMessage.success('已删除')
    await loadList()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

onMounted(async () => {
  await loadConfig()
  await loadList()
})
</script>

<style scoped>
/* 颜色一律用 ERP 设计令牌（admin/src/styles/design-tokens.css），
   不写硬编码 hex —— report:colors:strict 是棘轮（只许降）。 */
.studio-skus { padding: var(--space-1, 4px); }
.header-section h2 {
  margin: 0 0 6px;
  color: var(--light-text-primary);
}
.subtitle {
  margin: 0 0 var(--space-4, 16px);
  color: var(--light-text-secondary);
  font-size: var(--text-sm, 13px);
  line-height: 1.6;
}
.main-card { border-radius: 10px; }
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2, 8px);
  align-items: center;
  margin-bottom: var(--space-3, 12px);
}
.rule-alert { margin-bottom: var(--space-3, 12px); }
.rule-hint {
  margin-bottom: var(--space-3, 12px);
  color: var(--light-text-secondary);
  font-size: var(--text-xs, 12px);
  line-height: 1.6;
}
.muted { color: var(--light-text-tertiary); }
.cell-sub { margin-left: 6px; color: var(--light-text-tertiary); font-size: var(--text-xs, 12px); }
.field-hint {
  margin-left: 10px;
  color: var(--light-text-tertiary);
  font-size: var(--text-xs, 12px);
  line-height: 1.5;
}
</style>
