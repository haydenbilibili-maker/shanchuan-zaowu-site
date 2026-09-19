<template>
  <div class="price-book">
    <div class="header-section">
      <h2>价目表配置</h2>
      <p class="subtitle">
        出货单自动算价的价目来源：<b>材料（含等级）→ 材料费</b> + <b>包装（含尺寸）→ 包装费</b>
        + 手工费。改价<b>只影响之后的新单</b>——已出货的单存的是当时的定价快照。
        写权限仅超管；集合 <code>studio_material_prices</code> / <code>studio_packaging_prices</code>。
      </p>
    </div>

    <el-card shadow="never" class="main-card" v-loading="loading">
      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <el-tab-pane label="原材料价" name="material" />
        <el-tab-pane label="包装价" name="packaging" />
        <el-tab-pane label="费率与规则" name="config" />
      </el-tabs>

      <!-- ───────── 价目本（材料 / 包装共用一套表与表单） ───────── -->
      <template v-if="activeTab !== 'config'">
        <div class="toolbar">
          <el-input
            v-model="keyword"
            placeholder="搜名称或别名（如 大蓝闪）"
            clearable
            style="width: 220px"
            @keyup.enter="loadList"
            @clear="loadList"
          />
          <el-select v-model="statusFilter" style="width: 130px" @change="loadList">
            <el-option label="全部状态" value="all" />
            <el-option label="启用" value="active" />
            <el-option label="停用" value="inactive" />
          </el-select>
          <el-button @click="loadList">刷新</el-button>
          <el-button type="primary" @click="openCreate">新增{{ book.label }}</el-button>
          <el-button @click="runValidate">完整性校验</el-button>
        </div>

        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="rule-alert"
          :title="ruleTitle"
        />

        <el-table :data="list" stripe size="small" empty-text="还没有条目">
          <el-table-column prop="name" label="名称" min-width="140" />
          <el-table-column label="别名" min-width="130">
            <template #default="{ row }">
              <span v-if="!row.aliases || !row.aliases.length" class="muted">—</span>
              <el-tag v-for="a in row.aliases" :key="a" size="small" class="alias-tag">{{ a }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="book.optionLabel" width="100">
            <template #default="{ row }">
              {{ row.option }}
              <el-tag v-if="row.isDefaultOption" size="small" type="success" class="alias-tag">默认</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="单价" width="110" align="right">
            <template #default="{ row }">¥{{ money(row.unitPrice) }}</template>
          </el-table-column>
          <el-table-column prop="unit" label="单位" width="70" />
          <el-table-column label="用量/件" width="90" align="right">
            <template #default="{ row }">{{ row.qtyPerUnit }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'active' ? 'success' : 'info'">
                {{ row.status === 'active' ? '启用' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="sort" label="排序" width="70" align="right" />
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="onRemove(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>

      <!-- ───────── 费率与规则 ───────── -->
      <template v-else>
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          class="rule-alert"
          title="算价开关默认是关的：价目表没维护好时，系统不该自己开始算钱。维护完再打开。"
        />
        <el-form label-width="160px" class="config-form">
          <el-form-item label="启用算价">
            <el-switch v-model="config.enabled" />
            <span class="field-hint">
              关闭时：出货单可以照常录入，但不会自动算价，也不会产生待支付通知。
            </span>
          </el-form-item>
          <el-form-item label="手工费率">
            <el-input-number v-model="config.laborRatePct" :min="0" :max="500" :step="1" />
            <span class="field-hint">
              %（手工费 =（材料费 + 包装费）× 费率）。出货单页面上可按单覆盖，每一行还能再单独覆盖。
            </span>
          </el-form-item>
          <el-form-item label="要求填写包装">
            <el-switch v-model="config.requirePackaging" />
            <span class="field-hint">
              开启时：原文没写包装的行会报「未写包装方式」，必须人工选（这是产品负责人定的口径）。
            </span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="saveConfig">保存</el-button>
          </el-form-item>
        </el-form>
      </template>
    </el-card>

    <!-- 新增 / 编辑 -->
    <el-dialog v-model="dialog.visible" :title="dialog.title" width="560px">
      <el-form :model="form" label-width="120px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" :placeholder="book.kind === 'material' ? '如 独角仙展翅（含姿态，与出货单写法一致）' : '如 玻璃罩'" />
          <div class="field-hint">
            这是<b>匹配键</b>：出货单里写什么，这里就维护什么。姿态不同的材料要分行（独角仙展翅 / 独角仙没展翅）。
          </div>
        </el-form-item>
        <el-form-item label="别名">
          <el-input v-model="form.aliasesText" placeholder="逗号分隔，如：大蓝闪" />
          <div class="field-hint">
            用于兜简称与笔误（大蓝闪 → 大蓝闪蝶）。<b>别名不得跨条目重复</b>，否则校验会报错。
          </div>
        </el-form-item>
        <el-form-item :label="book.optionLabel">
          <el-input v-model="form.option" :placeholder="book.kind === 'material' ? '如 A1 / A2；留空即「默认」' : '如 20*10；留空即「默认」'" />
          <div class="field-hint">
            同一名称可以配多个{{ book.optionLabel }}，但<b>必须恰好有一个默认</b>（出货单没写{{ book.optionLabel }}时用它）。
          </div>
        </el-form-item>
        <el-form-item :label="book.optionLabel + '默认'">
          <el-switch v-model="form.isDefaultOption" />
        </el-form-item>
        <el-form-item label="单价" required>
          <el-input-number v-model="form.unitPrice" :min="0" :precision="2" :step="1" />
          <span class="field-hint">元 / 单位</span>
        </el-form-item>
        <el-form-item label="单位">
          <el-input v-model="form.unit" :placeholder="book.kind === 'material' ? '只 / 张' : '个 / 套'" style="width: 140px" />
        </el-form-item>
        <el-form-item label="用量/件">
          <el-input-number v-model="form.qtyPerUnit" :min="1" :step="1" />
          <div class="field-hint">一件成品用几个（只）。默认 1；「一个造景用 3 只蝶」才需要改。</div>
        </el-form-item>
        <el-form-item v-if="book.kind === 'material'" label="分类">
          <el-select v-model="form.category" clearable style="width: 160px">
            <el-option label="标本" value="标本" />
            <el-option label="工具" value="工具" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 160px">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="inactive" />
          </el-select>
          <span class="field-hint">停用后不再参与匹配（历史单的快照不受影响）</span>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort" :step="1" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { callCloudFunction } from '../cloud'

const FN = 'manageStudioSettlement'

const loading = ref(false)
const saving = ref(false)
const activeTab = ref('material')
const keyword = ref('')
const statusFilter = ref('all')
const list = ref([])
const books = ref([])
const config = reactive({ enabled: false, laborRatePct: 30, requirePackaging: true })

const dialog = reactive({ visible: false, title: '', id: '' })
const form = reactive({
  name: '',
  aliasesText: '',
  option: '',
  isDefaultOption: false,
  unitPrice: 0,
  unit: '',
  qtyPerUnit: 1,
  category: '',
  status: 'active',
  sort: 0,
  note: ''
})

const book = computed(() => {
  const hit = books.value.find((b) => b.kind === activeTab.value)
  return (
    hit || {
      kind: activeTab.value,
      label: activeTab.value === 'material' ? '原材料' : '包装方式',
      optionLabel: activeTab.value === 'material' ? '等级' : '尺寸'
    }
  )
})

const ruleTitle = computed(() => {
  if (book.value.kind === 'material') {
    return '匹配规则：出货单里「材料前缀 + 包装后缀」拆开；材料取最长命中，别名也参与匹配。等级没写就用「默认」那一行。'
  }
  return '匹配规则：包装取后缀最长命中，别名也参与匹配；尺寸没写就用「默认」那一行。'
})

function money(n) {
  const v = Number(n)
  return Number.isFinite(v) ? v.toFixed(2) : '0.00'
}

async function callFn(data) {
  const res = await callCloudFunction(FN, data)
  if (!res || res.success === false) throw new Error((res && res.msg) || '请求失败')
  return res
}

async function loadMeta() {
  const res = await callFn({ action: 'meta' })
  books.value = res.books || []
  const c = res.config || {}
  config.enabled = c.enabled === true
  config.laborRatePct = Number(c.laborRatePct) || 0
  config.requirePackaging = c.requirePackaging !== false
}

async function loadList() {
  if (activeTab.value === 'config') return
  loading.value = true
  try {
    const res = await callFn({
      action: 'priceBook.list',
      kind: activeTab.value,
      keyword: keyword.value || '',
      status: statusFilter.value === 'all' ? '' : statusFilter.value,
      limit: 200
    })
    list.value = res.list || []
    if (res.truncated) ElMessage.warning(`条目较多，仅显示前 ${list.value.length} 条，请用搜索缩小范围`)
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
    list.value = []
  } finally {
    loading.value = false
  }
}

function onTabChange() {
  keyword.value = ''
  statusFilter.value = 'all'
  if (activeTab.value === 'config') loadMeta()
  else loadList()
}

function resetForm() {
  Object.assign(form, {
    name: '',
    aliasesText: '',
    option: '',
    isDefaultOption: false,
    unitPrice: 0,
    unit: '',
    qtyPerUnit: 1,
    category: '',
    status: 'active',
    sort: 0,
    note: ''
  })
}

function openCreate() {
  resetForm()
  dialog.id = ''
  dialog.title = `新增${book.value.label}`
  dialog.visible = true
}

function openEdit(row) {
  resetForm()
  dialog.id = row._id
  dialog.title = `编辑${book.value.label}`
  form.name = row.name
  form.aliasesText = (row.aliases || []).join('，')
  form.option = row.option
  form.isDefaultOption = !!row.isDefaultOption
  form.unitPrice = Number(row.unitPrice) || 0
  form.unit = row.unit || ''
  form.qtyPerUnit = Number(row.qtyPerUnit) || 1
  form.category = row.category || ''
  form.status = row.status || 'active'
  form.sort = Number(row.sort) || 0
  form.note = row.note || ''
  dialog.visible = true
}

function buildItem() {
  const item = {
    name: form.name,
    aliases: form.aliasesText,
    unitPrice: form.unitPrice,
    unit: form.unit,
    qtyPerUnit: form.qtyPerUnit,
    status: form.status,
    sort: form.sort,
    note: form.note
  }
  if (book.value.kind === 'material') {
    item.grade = form.option
    item.isDefaultGrade = form.isDefaultOption
    item.category = form.category
  } else {
    item.size = form.option
    item.isDefaultSize = form.isDefaultOption
  }
  return item
}

async function submitForm() {
  if (!String(form.name || '').trim()) {
    ElMessage.warning('名称必填')
    return
  }
  saving.value = true
  try {
    const payload = { kind: book.value.kind, item: buildItem() }
    if (dialog.id) await callFn(Object.assign({ action: 'priceBook.update', id: dialog.id }, payload))
    else await callFn(Object.assign({ action: 'priceBook.create' }, payload))
    ElMessage.success('已保存')
    dialog.visible = false
    await loadList()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function onRemove(row) {
  try {
    await ElMessageBox.confirm(
      `删除「${row.name}${row.option ? ' · ' + row.option : ''}」？历史出货单的定价快照不受影响。`,
      '确认删除',
      { type: 'warning' }
    )
  } catch (e) {
    return
  }
  try {
    await callFn({ action: 'priceBook.remove', kind: book.value.kind, id: row._id })
    ElMessage.success('已删除')
    await loadList()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

async function runValidate() {
  loading.value = true
  try {
    const res = await callFn({ action: 'priceBook.validate' })
    if (res.ok) {
      ElMessage.success(res.msg || '价目表完整')
    } else {
      const first = (res.errors || []).slice(0, 3).map((x) => x.msg).join('；')
      ElMessage.error(`${res.msg || '存在问题'}：${first}`)
    }
  } catch (e) {
    ElMessage.error(e.message || '校验失败')
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  saving.value = true
  try {
    await callFn({
      action: 'config.save',
      config: {
        enabled: config.enabled,
        laborRatePct: config.laborRatePct,
        requirePackaging: config.requirePackaging
      }
    })
    ElMessage.success('已保存')
    await loadMeta()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  try {
    await loadMeta()
    await loadList()
  } catch (e) {
    ElMessage.error(e.message || '初始化失败')
  }
})
</script>

<style scoped>
/* 颜色一律用 ERP 设计令牌（admin/src/styles/design-tokens.css），
   不写硬编码 hex —— report:colors:strict 是棘轮（只许降），
   而 AGENTS.md 也明确「禁止 find-replace 改配色」。 */
.price-book { padding: var(--space-1, 4px); }
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
.alias-tag { margin-right: 6px; }
.muted { color: var(--light-text-tertiary); }
.field-hint {
  margin-left: 10px;
  color: var(--light-text-tertiary);
  font-size: var(--text-xs, 12px);
  line-height: 1.5;
}
.config-form { max-width: 760px; margin-top: var(--space-2, 8px); }
code {
  background: var(--light-bg-elevated);
  border: 1px solid var(--light-border-subtle);
  padding: 0 4px;
  border-radius: 3px;
}
</style>
