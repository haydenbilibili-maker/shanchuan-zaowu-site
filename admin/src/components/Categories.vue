<template>
  <div class="cat-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>分类管理 / CATEGORIES</h2>
        <span class="subtitle">CATEGORY TREE · 藏品通过 categoryId / rootCategoryId 关联（录入藏品时选择）</span>
      </div>
      <div class="header-actions">
        <el-button @click="fillLatinNames" :loading="fillingLatin">补齐二级拉丁名</el-button>
        <el-button @click="scanDuplicates" :loading="scanning">扫描重复二级</el-button>
        <el-button type="primary" :icon="Plus" @click="openRootDialog">新增一级分类</el-button>
      </div>
    </div>

    <el-alert
      v-if="dupGroups.length"
      type="warning"
      :closable="false"
      class="dup-alert"
      :title="`发现 ${dupGroups.length} 组重复/近义二级分类`"
    >
      <div v-for="(g, gi) in dupGroups" :key="g.key" class="dup-row">
        <span>{{ g.label }} · {{ g.items.length }} 项 · 约 {{ g.totalProducts }} 件</span>
        <el-button size="small" type="primary" link @click="quickMergeGroup(g)">一键合并到最多商品项</el-button>
      </div>
    </el-alert>

    <div class="layout">
      <!-- 左：一级分类 -->
      <div class="root-pane" v-loading="loading">
        <div class="pane-title">一级分类 (LEVEL 1)</div>
        <div v-for="r in roots" :key="r._id" class="root-row" :class="{ active: currentRoot?._id === r._id }" @click="selectRoot(r)">
          <span class="root-icon">{{ r.icon || '📁' }}</span>
          <div class="root-info">
            <div class="r-name">{{ r.name }}</div>
            <div class="r-sub">{{ getSubCount(r._id) }} 个子分类</div>
          </div>
          <el-dropdown trigger="click" @command="(cmd) => handleRoot(cmd, r)">
            <el-icon class="more-icon"><MoreFilled /></el-icon>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit">编辑</el-dropdown-item>
                <el-dropdown-item command="up">上移</el-dropdown-item>
                <el-dropdown-item command="down">下移</el-dropdown-item>
                <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div v-if="!loading && !roots.length" class="empty-tip">还没有分类，先新增一级分类</div>
      </div>

      <!-- 右：二级分类 -->
      <div class="sub-pane">
        <div class="pane-title">
          <span>二级分类 (LEVEL 2)</span>
          <el-button v-if="currentRoot" type="primary" :icon="Plus" size="small" @click="openSubDialog()">新增子分类</el-button>
        </div>
        <div v-if="!currentRoot" class="empty-tip">请选择一级分类</div>
        <el-table v-else :data="subs" stripe>
          <el-table-column label="排序" width="80">
            <template #default="{ row, $index }">
              <el-button-group size="small">
                <el-button :icon="ArrowUp" :disabled="$index === 0" @click="moveSub(row, -1)" />
                <el-button :icon="ArrowDown" :disabled="$index === subs.length - 1" @click="moveSub(row, 1)" />
              </el-button-group>
            </template>
          </el-table-column>
          <el-table-column label="名称" min-width="160">
            <template #default="{ row }">
              <span class="sub-icon">{{ row.icon || '🏷️' }}</span>
              <span>{{ row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="latinName" label="拉丁名 / 副标题" min-width="180">
            <template #default="{ row }">
              <span>{{ row.latinName || row.latin || '—' }}</span>
              <el-tag v-if="row.latinStatus === 'pending_review'" size="small" type="warning" style="margin-left:6px">待审</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="enName" label="英文" min-width="120" />
          <el-table-column label="商品数" width="100" align="center">
            <template #default="{ row }">
              <span v-if="row.productCount == null && countsLoading" class="count-pending">…</span>
              <span v-else>{{ row.productCount ?? 0 }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-switch
                :model-value="categorySwitchOn(row)"
                :active-value="true"
                :inactive-value="false"
                @change="(on) => toggleSubActive(row, on)"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="300">
            <template #default="{ row }">
              <el-button size="small" link @click="openSubDialog(row)">编辑</el-button>
              <el-button size="small" link type="primary" @click="showLinkedProducts(row)">
                {{ row.productCount != null ? `已关联(${row.productCount})` : '已关联' }}
              </el-button>
              <el-button size="small" link type="primary" @click="openLinkDialog(row)">关联藏品</el-button>
              <el-button size="small" link @click="openMergeDialog(row)">合并</el-button>
              <el-button size="small" type="danger" link @click="delSub(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 一级分类弹窗 -->
    <el-dialog v-model="rootDialog" :title="rootForm._id ? '编辑一级分类' : '新增一级分类'" width="500px">
      <el-form :model="rootForm" label-width="100px">
        <el-form-item label="分类名称"><el-input v-model="rootForm.name" /></el-form-item>
        <el-form-item label="图标"><el-input v-model="rootForm.icon" placeholder="emoji 或图片 URL" /></el-form-item>
        <el-form-item label="封面图">
          <ImageUploadField
            v-model="rootForm.cover"
            folder="categories"
            tip="优先上传分类封面；也可粘贴 cloud:// 或 HTTPS"
            preview-width="120px"
            preview-height="120px"
          />
        </el-form-item>
        <el-form-item label="简介"><el-input v-model="rootForm.desc" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="排序权重"><el-input-number v-model="rootForm.sort" :min="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rootDialog = false">取消</el-button>
        <el-button type="primary" @click="saveRoot">保存</el-button>
      </template>
    </el-dialog>

    <!-- 二级分类弹窗 -->
    <el-dialog v-model="subDialog" :title="subForm._id ? '编辑子分类' : '新增子分类'" width="520px">
      <el-form :model="subForm" label-width="100px">
        <el-form-item label="名称"><el-input v-model="subForm.name" /></el-form-item>
        <el-form-item label="拉丁名">
          <el-input v-model="subForm.latinName" placeholder="保存时若为空会按种子自动补齐" />
        </el-form-item>
        <el-form-item label="英文 enName"><el-input v-model="subForm.enName" placeholder="如：LEPIDOPTERA" /></el-form-item>
        <el-form-item label="图标"><el-input v-model="subForm.icon" placeholder="emoji" /></el-form-item>
        <el-form-item label="简介"><el-input v-model="subForm.desc" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="subForm.active" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="subDialog = false">取消</el-button>
        <el-button type="primary" @click="saveSub">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="linkedDialog" :title="`已关联藏品 · ${linkedCatName}`" width="640px">
      <p class="linked-hint">按 categoryId 精确匹配；无 ID 的旧数据请用「自动/一键关联」回填。</p>
      <el-table :data="linkedProducts" v-loading="linkedLoading" max-height="400">
        <el-table-column prop="title" label="名称" min-width="200" />
        <el-table-column prop="category" label="分类名" width="120" />
        <el-table-column prop="price" label="售价" width="100" />
        <el-table-column label="会员折扣" width="100">
          <template #default="{ row }">
            {{ row.memberDiscountEnabled === false ? '关闭' : '开启' }}
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- 合并二级 -->
    <el-dialog v-model="mergeDialog" title="合并二级分类" width="520px">
      <p class="linked-hint">将被合并项「{{ mergeFrom?.name }}」并入保留项；商品 categoryId / rootCategory* / category 经云函数迁移，原分类停用。</p>
      <el-form label-width="100px">
        <el-form-item label="保留为">
          <el-select v-model="mergeToId" filterable placeholder="选择保留的二级" style="width: 100%">
            <el-option
              v-for="opt in mergeOptions"
              :key="opt._id"
              :label="opt.label"
              :value="opt._id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="previewMerge" :loading="mergeLoading">预览数量</el-button>
        <el-button type="primary" @click="confirmMerge" :loading="mergeLoading">确认合并</el-button>
      </template>
    </el-dialog>

    <!-- 关联藏品：打开即预览；主路径一键确认 -->
    <el-dialog
      v-model="linkDialog"
      :title="`关联藏品 · ${linkTarget?.name || ''}`"
      width="680px"
      @opened="onLinkDialogOpened"
    >
      <p class="linked-hint">
        打开即扫描「自动」候选（名称/旧别名、标题、标签、同馆未分类）。
        「自动关联」「一键全部」各一键确认写库；空态时再试「一键全部」（含同馆孤儿）。
        勾选行可只关联部分藏品。
      </p>
      <div class="link-toolbar">
        <el-button
          type="primary"
          :loading="linkLoading && linkMode === 'auto'"
          @click="oneClickLink('auto')"
        >
          自动关联{{ linkMode === 'auto' && linkMatchCount ? `（${linkMatchCount}）` : '' }}
        </el-button>
        <el-button
          type="primary"
          :loading="linkLoading && linkMode === 'all'"
          @click="oneClickLink('all')"
        >
          一键全部{{ linkMode === 'all' && linkMatchCount ? `（${linkMatchCount}）` : '' }}
        </el-button>
        <el-button link :loading="linkLoading" @click="previewLink()">刷新预览</el-button>
      </div>
      <div v-if="linkMatchCount" class="link-count">当前预览（{{ linkMode === 'all' ? '一键全部' : '自动' }}）：匹配 {{ linkMatchCount }} 件</div>
      <el-table
        ref="linkTableRef"
        :data="linkPreview"
        v-loading="linkLoading"
        max-height="300"
        size="small"
        empty-text=" "
        @selection-change="onLinkSelectionChange"
      >
        <el-table-column type="selection" width="42" />
        <el-table-column prop="title" label="名称" min-width="180" />
        <el-table-column prop="category" label="当前分类" width="120" />
        <el-table-column label="规则" width="140">
          <template #default="{ row }">{{ Array.isArray(row.reasons) ? row.reasons.join('/') : row.reasons }}</template>
        </el-table-column>
      </el-table>
      <div v-if="!linkLoading && !linkPreview.length" class="link-empty">
        {{ linkEmptyHint }}
      </div>
      <div v-if="linkLastResult" class="undo-box">
        上次关联 {{ linkLastResult.linkedCount }} 件
        <el-button size="small" link type="danger" @click="undoLink">撤销上次</el-button>
      </div>
      <template #footer>
        <el-button
          v-if="linkSelectedIds.length"
          type="primary"
          :loading="linkLoading"
          @click="confirmLinkSelected"
        >
          关联所选（{{ linkSelectedIds.length }}）
        </el-button>
        <el-button @click="linkDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { Plus, MoreFilled, ArrowUp, ArrowDown } from '@element-plus/icons-vue'
import {
  fetchCollectionWhere,
  fetchCollectionSorted,
  cdnAdd,
  cdnUpdate,
  cdnRemove,
  cdnCount,
  callCloudFunction,
} from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import ImageUploadField from './ImageUploadField.vue'
import { isActiveCategory, categorySwitchOn } from '../utils/categoryActive'

const roots = ref([])
const subs = ref([])
const currentRoot = ref(null)
const allSubs = ref([])
const loading = ref(false)
const countsLoading = ref(false)
const scanning = ref(false)
const fillingLatin = ref(false)
const dupGroups = ref([])
const rootDialog = ref(false)
const subDialog = ref(false)
const rootForm = reactive({ _id: '', name: '', icon: '', cover: '', desc: '', sort: 0 })
const subForm = reactive({ _id: '', name: '', latinName: '', enName: '', icon: '', desc: '', active: true })
const linkedDialog = ref(false)
const linkedLoading = ref(false)
const linkedProducts = ref([])
const linkedCatName = ref('')

const mergeDialog = ref(false)
const mergeLoading = ref(false)
const mergeFrom = ref(null)
const mergeToId = ref('')
const mergeOptions = computed(() =>
  allSubs.value
    .filter((s) => s._id !== mergeFrom.value?._id && isActiveCategory(s))
    .map((s) => {
      const root = roots.value.find((r) => r._id === s.parentId)
      return { _id: s._id, label: `${root?.name || '?' } / ${s.name}` }
    })
)

const linkDialog = ref(false)
const linkLoading = ref(false)
const linkTarget = ref(null)
const linkMode = ref('auto')
const linkPreview = ref([])
const linkMatchCount = ref(0)
const linkLastResult = ref(null)
const linkSelectedIds = ref([])
const linkEmptyHint = ref('打开后自动扫描中…')

/** 有限并发跑任务，避免二级分类过多时 N+1 打满连接 */
const mapPool = async (items, concurrency, fn) => {
  const list = items || []
  if (!list.length) return []
  const results = new Array(list.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (cursor < list.length) {
      const idx = cursor
      cursor += 1
      results[idx] = await fn(list[idx], idx)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * 按 categoryId 精确统计商品数并写入行（与「已关联」弹窗同源）。
 * @param {object[]} rows
 * @param {{ force?: boolean }} [opts] force=true 时强制重查（关联/合并后）
 */
const hydrateProductCounts = async (rows, opts = {}) => {
  const force = !!opts.force
  const targets = (rows || []).filter((r) => r && r._id && (force || r.productCount == null))
  if (!targets.length) return
  countsLoading.value = true
  try {
    await mapPool(targets, 6, async (row) => {
      try {
        row.productCount = await cdnCount('products', { categoryId: row._id })
      } catch {
        if (row.productCount == null) row.productCount = 0
      }
    })
    // 触发表格刷新（与 allSubs 共享同一对象引用）
    if (currentRoot.value) {
      subs.value = allSubs.value.filter((s) => s.parentId === currentRoot.value._id)
    }
  } finally {
    countsLoading.value = false
  }
}

const refreshRowProductCount = async (row) => {
  if (!row?._id) return
  try {
    row.productCount = await cdnCount('products', { categoryId: row._id })
    if (currentRoot.value) {
      subs.value = allSubs.value.filter((s) => s.parentId === currentRoot.value._id)
    }
  } catch {
    /* 保持原值 */
  }
}

const showLinkedProducts = async (row) => {
  linkedCatName.value = row.name || ''
  linkedDialog.value = true
  linkedLoading.value = true
  linkedProducts.value = []
  try {
    const [total, byId] = await Promise.all([
      cdnCount('products', { categoryId: row._id }),
      fetchCollectionWhere('products', { categoryId: row._id }, 100),
    ])
    linkedProducts.value = byId
    row.productCount = total
  } catch (e) {
    ElMessage.error('加载关联藏品失败：' + (e.message || ''))
  } finally {
    linkedLoading.value = false
  }
}

const fillLatinNames = async () => {
  fillingLatin.value = true
  try {
    const res = await callCloudFunction('seedCategories', {
      action: 'fillL2LatinNames',
      dryRun: false,
      force: false,
    })
    if (!res?.success) throw new Error(res?.msg || '补齐失败')
    ElMessage.success(res.msg || '已补齐')
    if (res.unmatched) {
      ElMessage.warning(`${res.unmatched} 项未匹配种子，请手工补拉丁名`)
    }
    await refresh()
  } catch (e) {
    ElMessage.error(e?.message || '补齐失败，请刷新重试；持续失败请联系技术' /* 技术排查：请确认已部署 seedCategories 与 ADMIN_OPS_KEY */)
  } finally {
    fillingLatin.value = false
  }
}

const scanDuplicates = async () => {
  scanning.value = true
  try {
    const res = await callCloudFunction('seedCategories', { action: 'findDuplicateL2' })
    if (!res?.success) throw new Error(res?.msg || '扫描失败')
    dupGroups.value = res.groups || []
    ElMessage.success(dupGroups.value.length ? `发现 ${dupGroups.value.length} 组重复` : '未发现重复二级')
  } catch (e) {
    ElMessage.error(e?.message || '扫描失败，请刷新重试；持续失败请联系技术' /* 技术排查：请确认已部署 seedCategories 与 ADMIN_OPS_KEY */)
  } finally {
    scanning.value = false
  }
}

const quickMergeGroup = async (g) => {
  if (!g?.items?.length) return
  const keep = g.items.find((i) => i._id === g.suggestedKeepId) || g.items[0]
  const others = g.items.filter((i) => i._id !== keep._id)
  try {
    await ElMessageBox.confirm(
      `保留「${keep.name}」（${keep.parentName || ''}），合并其余 ${others.length} 项？`,
      '一键合并',
      { type: 'warning' }
    )
  } catch {
    return
  }
  let ok = 0
  for (const from of others) {
    try {
      const res = await callCloudFunction('seedCategories', {
        action: 'mergeL2',
        fromId: from._id,
        toId: keep._id,
      })
      if (res?.success) ok += 1
    } catch {
      /* continue */
    }
  }
  ElMessage.success(`已合并 ${ok}/${others.length} 项`)
  await scanDuplicates()
  await refresh()
}

const openMergeDialog = (row) => {
  mergeFrom.value = row
  mergeToId.value = ''
  mergeDialog.value = true
}

const previewMerge = async () => {
  if (!mergeFrom.value?._id || !mergeToId.value) return ElMessage.warning('请选择保留项')
  mergeLoading.value = true
  try {
    const res = await callCloudFunction('seedCategories', {
      action: 'mergeL2',
      fromId: mergeFrom.value._id,
      toId: mergeToId.value,
      dryRun: true,
    })
    ElMessageBox.alert(res?.msg || '预览完成', '合并预览')
  } catch (e) {
    ElMessage.error(e?.message || '预览失败')
  } finally {
    mergeLoading.value = false
  }
}

const confirmMerge = async () => {
  if (!mergeFrom.value?._id || !mergeToId.value) return ElMessage.warning('请选择保留项')
  try {
    await ElMessageBox.confirm(
      `将「${mergeFrom.value.name}」并入保留项并停用？`,
      '确认合并',
      { type: 'warning' }
    )
  } catch {
    return
  }
  mergeLoading.value = true
  try {
    const res = await callCloudFunction('seedCategories', {
      action: 'mergeL2',
      fromId: mergeFrom.value._id,
      toId: mergeToId.value,
    })
    if (!res?.success) throw new Error(res?.msg || '合并失败')
    ElMessage.success(res.msg || '已合并')
    mergeDialog.value = false
    await refresh()
    await scanDuplicates()
  } catch (e) {
    ElMessage.error(e?.message || '合并失败')
  } finally {
    mergeLoading.value = false
  }
}

const openLinkDialog = (row) => {
  linkTarget.value = row
  linkMode.value = 'auto'
  linkPreview.value = []
  linkMatchCount.value = 0
  linkLastResult.value = null
  linkSelectedIds.value = []
  linkEmptyHint.value = '打开后自动扫描中…'
  linkDialog.value = true
}

const onLinkDialogOpened = () => {
  previewLink('auto')
}

const onLinkSelectionChange = (rows) => {
  linkSelectedIds.value = (rows || []).map((r) => r._id).filter(Boolean)
}

const previewLink = async (mode) => {
  if (!linkTarget.value?._id) return
  if (mode === 'auto' || mode === 'all') linkMode.value = mode
  linkLoading.value = true
  linkSelectedIds.value = []
  try {
    const res = await callCloudFunction('seedCategories', {
      action: 'previewLinkProducts',
      categoryId: linkTarget.value._id,
      mode: linkMode.value,
    })
    if (!res?.success) throw new Error(res?.msg || '预览失败')
    linkPreview.value = res.preview || []
    linkMatchCount.value = res.matchCount || 0
    if (!linkMatchCount.value) {
      linkEmptyHint.value =
        linkMode.value === 'all'
          ? '一键全部规则下仍无候选：本馆可能没有可挂载的孤儿商品，或均已正确分类。'
          : '自动规则下无匹配。可点「一键全部」扩大到同馆孤儿；若仍为空，说明暂无可关联藏品。'
    }
  } catch (e) {
    linkEmptyHint.value = e?.message || '预览失败'
    ElMessage.error(e?.message || '预览失败')
  } finally {
    linkLoading.value = false
  }
}

const runLink = async (mode, productIds) => {
  if (!linkTarget.value?._id) return
  linkMode.value = mode
  linkLoading.value = true
  try {
    const payload = {
      action: 'linkProducts',
      categoryId: linkTarget.value._id,
      mode,
    }
    if (Array.isArray(productIds) && productIds.length) payload.productIds = productIds
    const res = await callCloudFunction('seedCategories', payload)
    if (!res?.success) throw new Error(res?.msg || '关联失败')
    linkLastResult.value = {
      linkedCount: res.linkedCount || 0,
      linked: res.linked || [],
      categoryId: linkTarget.value._id,
    }
    linkPreview.value = res.preview || []
    linkMatchCount.value = 0
    linkSelectedIds.value = []
    ElMessage.success(res.msg || '已关联')
    await refreshRowProductCount(linkTarget.value)
  } catch (e) {
    ElMessage.error(e?.message || '关联失败')
  } finally {
    linkLoading.value = false
  }
}

const oneClickLink = async (mode) => {
  if (!linkTarget.value?._id) return
  await previewLink(mode)
  if (!linkMatchCount.value) {
    ElMessage.info(linkEmptyHint.value || '无匹配藏品')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将按「${mode === 'all' ? '一键全部' : '自动'}」关联约 ${linkMatchCount.value} 件到「${linkTarget.value.name}」？`,
      mode === 'all' ? '一键全部关联' : '自动关联',
      { type: 'warning' },
    )
  } catch {
    return
  }
  await runLink(mode)
}

const confirmLinkSelected = async () => {
  if (!linkSelectedIds.value.length) return ElMessage.warning('请先勾选藏品')
  try {
    await ElMessageBox.confirm(
      `仅关联所选 ${linkSelectedIds.value.length} 件到「${linkTarget.value.name}」？`,
      '关联所选',
      { type: 'warning' },
    )
  } catch {
    return
  }
  await runLink(linkMode.value, linkSelectedIds.value)
}

const undoLink = async () => {
  const last = linkLastResult.value
  if (!last?.linked?.length) return
  try {
    await ElMessageBox.confirm(`撤销上次关联的 ${last.linkedCount} 件？`, '撤销关联', { type: 'warning' })
  } catch {
    return
  }
  linkLoading.value = true
  try {
    const res = await callCloudFunction('seedCategories', {
      action: 'unlinkProducts',
      categoryId: last.categoryId,
      linked: last.linked,
    })
    if (!res?.success) throw new Error(res?.msg || '撤销失败')
    linkLastResult.value = null
    linkPreview.value = []
    await previewLink(linkMode.value)
    await refreshRowProductCount(linkTarget.value)
    ElMessage.success(res.msg || '已撤销')
  } catch (e) {
    ElMessage.error(e?.message || '撤销失败')
  } finally {
    linkLoading.value = false
  }
}

const refresh = async () => {
  loading.value = true
  try {
    const rawRoots = await fetchCollectionSorted('categories', {
      limit: 500,
      where: { level: 1 },
      sortFn: (a, b) => (a.sort ?? a.sortOrder ?? 0) - (b.sort ?? b.sortOrder ?? 0)
    })
    const rawSubs = await fetchCollectionSorted('categories', {
      limit: 500,
      where: { level: 2 },
      sortFn: (a, b) => (a.sort ?? a.sortOrder ?? 0) - (b.sort ?? b.sortOrder ?? 0)
    })
    // 一级：与店长一致只展示有效馆
    roots.value = (rawRoots || []).filter(isActiveCategory)
    // 二级：保留未合并项（含已停用），便于开关重新开启；已合并/deleted 不展示
    // productCount 不入库，列表侧用 cdnCount 按需灌入（避免默认 undefined→展示成 0 的假象）
    allSubs.value = (rawSubs || [])
      .filter((s) => s && !s.mergedInto && s.status !== 'deleted')
      .map((s) => ({ ...s, productCount: undefined }))
    if (currentRoot.value) {
      const still = roots.value.find((r) => r._id === currentRoot.value._id)
      if (still) await selectRoot(still)
      else if (roots.value.length) await selectRoot(roots.value[0])
      else {
        currentRoot.value = null
        subs.value = []
      }
    } else if (roots.value.length) {
      await selectRoot(roots.value[0])
    }
  } catch (e) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}

const selectRoot = async (r) => {
  currentRoot.value = r
  subs.value = allSubs.value.filter((s) => s.parentId === r._id)
  await hydrateProductCounts(subs.value)
}

const getSubCount = (parentId) => allSubs.value.filter(s => s.parentId === parentId).length

const openRootDialog = (r) => {
  if (r) {
    Object.assign(rootForm, { ...r })
  } else {
    Object.assign(rootForm, { _id: '', name: '', icon: '', cover: '', desc: '', sort: roots.value.length })
  }
  rootDialog.value = true
}

const saveRoot = async () => {
  if (!rootForm.name) return ElMessage.warning('请输入分类名称')
  const data = {
    name: rootForm.name, icon: rootForm.icon, cover: rootForm.cover,
    desc: rootForm.desc, sort: rootForm.sort, sortOrder: rootForm.sort,
    level: 1,
    status: 'active',
    active: true,
    updateTime: Date.now()
  }
  try {
    if (rootForm._id) {
      await cdnUpdate('categories', rootForm._id, data)
    } else {
      data.createTime = Date.now()
      await cdnAdd('categories', data)
    }
    ElMessage.success('已保存')
    rootDialog.value = false
    refresh()
  } catch (e) {
    ElMessage.error('保存失败：' + e.message)
  }
}

const handleRoot = (cmd, r) => {
  if (cmd === 'edit') openRootDialog(r)
  else if (cmd === 'delete') delRoot(r)
  else if (cmd === 'up') moveRoot(r, -1)
  else if (cmd === 'down') moveRoot(r, 1)
}

const moveRoot = async (r, dir) => {
  const idx = roots.value.findIndex(x => x._id === r._id)
  const target = idx + dir
  if (target < 0 || target >= roots.value.length) return
  const other = roots.value[target]
  await Promise.all([
    cdnUpdate('categories', r._id, { sort: other.sort ?? other.sortOrder, sortOrder: other.sortOrder ?? other.sort }),
    cdnUpdate('categories', other._id, { sort: r.sort ?? r.sortOrder, sortOrder: r.sortOrder ?? r.sort })
  ])
  refresh()
}

const delRoot = (r) => {
  const subCount = getSubCount(r._id)
  ElMessageBox.confirm(`删除【${r.name}】？该一级分类下有 ${subCount} 个子分类，将一并删除。`, '删除确认', { type: 'warning' }).then(async () => {
    const children = await fetchCollectionWhere('categories', { parentId: r._id }, 500)
    await Promise.all(children.map(c => cdnRemove('categories', c._id)))
    await cdnRemove('categories', r._id)
    ElMessage.success('已删除')
    currentRoot.value = null
    refresh()
  }).catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

const openSubDialog = (s) => {
  if (s) {
    Object.assign(subForm, {
      ...s,
      latinName: s.latinName || s.latin || '',
      enName: s.enName || '',
      active: categorySwitchOn(s),
    })
  } else {
    Object.assign(subForm, { _id: '', name: '', latinName: '', enName: '', icon: '', desc: '', active: true })
  }
  subDialog.value = true
}

const saveSub = async () => {
  if (!subForm.name || !currentRoot.value) return ElMessage.warning('请输入名称')
  let latinName = String(subForm.latinName || '').trim()
  let enName = String(subForm.enName || '').trim()
  if (!latinName && enName) {
    latinName = /\s/.test(enName)
      ? enName
      : enName.charAt(0) + enName.slice(1).toLowerCase()
  }
  const sortVal = subForm._id
    ? (typeof subForm.sort === 'number' ? subForm.sort : (subs.value.findIndex((x) => x._id === subForm._id)))
    : subs.value.length
  const data = {
    name: subForm.name,
    latinName,
    latin: latinName,
    enName,
    icon: subForm.icon,
    desc: subForm.desc,
    active: subForm.active !== false,
    status: subForm.active === false ? 'inactive' : 'active',
    level: 2,
    parentId: currentRoot.value._id,
    parentName: currentRoot.value.name,
    sort: sortVal,
    sortOrder: sortVal,
    updateTime: Date.now(),
  }
  try {
    let savedId = subForm._id
    if (subForm._id) {
      await cdnUpdate('categories', subForm._id, data)
    } else {
      data.sort = subs.value.length
      data.sortOrder = data.sort
      data.createTime = Date.now()
      const addRes = await cdnAdd('categories', data)
      savedId = addRes?.id || addRes?._id || addRes
    }
    // 缺拉丁/英文时按 categorySeed 自动补齐
    if (savedId && (!latinName || !enName)) {
      await callCloudFunction('seedCategories', {
        action: 'fillL2LatinNames',
        dryRun: false,
        force: false,
        categoryIds: [savedId],
      }).catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
    }
    ElMessage.success('已保存')
    subDialog.value = false
    refresh()
  } catch (e) {
    ElMessage.error('保存失败：' + e.message)
  }
}

const toggleSubActive = async (row, on) => {
  const enabled = on === true
  try {
    await cdnUpdate('categories', row._id, {
      active: enabled,
      status: enabled ? 'active' : 'inactive',
      // 与店长拉取字段对齐，避免只写 sort 时 orderBy 漏数
      sort: row.sort ?? row.sortOrder ?? 0,
      sortOrder: row.sortOrder ?? row.sort ?? 0,
      updateTime: Date.now(),
    })
    row.active = enabled
    row.status = enabled ? 'active' : 'inactive'
    ElMessage.success(enabled ? '已启用（店长分类管理刷新后可见）' : '已停用（店长端将隐藏）')
  } catch (e) {
    ElMessage.error('操作失败')
  }
}

const delSub = (row) => {
  ElMessageBox.confirm(`删除子分类【${row.name}】？建议先「合并」到保留项。`, '删除确认', { type: 'warning' }).then(async () => {
    await cdnRemove('categories', row._id)
    ElMessage.success('已删除')
    refresh()
  }).catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

const moveSub = async (row, dir) => {
  const idx = subs.value.findIndex(x => x._id === row._id)
  const target = idx + dir
  if (target < 0 || target >= subs.value.length) return
  const other = subs.value[target]
  await Promise.all([
    cdnUpdate('categories', row._id, { sort: other.sort ?? other.sortOrder ?? target, sortOrder: other.sortOrder ?? other.sort ?? target }),
    cdnUpdate('categories', other._id, { sort: row.sort ?? row.sortOrder ?? idx, sortOrder: row.sortOrder ?? row.sort ?? idx })
  ])
  refresh()
}

onMounted(refresh)
</script>

<style scoped>
.cat-container { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 12px; }
.header-actions { display: flex; gap: 8px; flex-shrink: 0; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }
.linked-hint { color: #6b6560; font-size: 13px; margin: 0 0 12px; }
.dup-alert { margin-bottom: 16px; }
.dup-row { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 13px; }
.link-count { font-size: 13px; color: #c4a76c; margin-bottom: 8px; }
.link-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.link-empty { text-align: center; color: #a09a90; font-size: 13px; padding: 24px 12px; line-height: 1.5; }
.undo-box { margin-top: 12px; font-size: 13px; color: #6b6560; }
.layout { display: grid; grid-template-columns: 300px 1fr; gap: 20px; }
.root-pane, .sub-pane { background: #fff; border-radius: 10px; padding: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.04); }
.pane-title { font-size: 14px; color: #333; font-weight: bold; margin-bottom: 15px; padding-bottom: 8px; border-bottom: 1px dashed #eee; display: flex; justify-content: space-between; align-items: center; }
.root-row { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 8px; cursor: pointer; margin-bottom: 6px; }
.root-row:hover { background: #fafafa; }
.root-row.active { background: #fdf6ec; border-left: 3px solid #d4af37; }
.root-icon { font-size: 22px; }
.root-info { flex: 1; }
.r-name { font-weight: bold; color: #333; }
.r-sub { font-size: 11px; color: #999; }
.more-icon { color: #999; cursor: pointer; }
.sub-icon { font-size: 16px; margin-right: 6px; }
/* 空态提示承载真实信息（如「还没有分类，先新增一级分类」），必须可读：
   #ccc 在白底只有 1.61:1，实测几乎看不见；改次级文字色后 5.74:1 达 AA。
   审计点名的 Categories.vue:899 1.5:1 就是这一处。 */
.empty-tip { text-align: center; color: var(--light-text-secondary); padding: 40px; font-size: 13px; }
.count-pending { color: #a09a90; }
</style>
