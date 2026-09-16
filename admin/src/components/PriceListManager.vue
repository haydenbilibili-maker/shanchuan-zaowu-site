<template>
  <div class="pl-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>报价单配置 / PRICE LIST</h2>
        <span class="subtitle">PRICE LIST · 与官网报价单页同源</span>
      </div>
      <div class="header-actions">
        <el-checkbox v-model="forceOverwriteImages" style="margin-right: 4px">强制覆盖图片</el-checkbox>
        <el-button @click="seedDefaults" :loading="seeding">同步官网种子</el-button>
        <el-button type="success" plain :loading="publishing" @click="publishB2b">发布到订货价目</el-button>
        <el-button @click="openOfficialPreview">预览官网</el-button>
        <el-button type="primary" :icon="Plus" @click="openDialog()">新建 SKU</el-button>
        <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
      </div>
    </div>

    <div class="pub-status-bar">
      <span>
        上架
        <b class="pub-num">{{ activeSkuCount }}</b>
        / 共 {{ list.length }}
        <template v-if="statusFilter !== 'all' || packFilter || bioFilter || keyword">（当前筛选）</template>
      </span>
      <span class="pub-sep">·</span>
      <span>
        订货价目：
        <template v-if="b2bMeta.updatedAt">
          最近发布 {{ formatPubTime(b2bMeta.updatedAt) }}
          <template v-if="b2bMeta.itemCount != null"> · {{ b2bMeta.itemCount }} 条</template>
        </template>
        <template v-else>尚未从本页发布（或 configs/b2b_catalog 不可读）</template>
      </span>
      <el-button link type="primary" @click="openOfficialPreview">打开 shanhaizaowu.com/price-list</el-button>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="hint-alert"
      title="官网运行时匿名读取 status=active。图片：同步种子会写入 https://shanhaizaowu.com/images/price-list/… 绝对地址；默认可补全空图，勾选「强制覆盖图片」才覆盖已有图。可上传云存储（cloud://）写回 image/images。"
    />

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      class="hint-alert"
      :title="loadError"
      description="请确认 price_list_items 已 provision；加载失败时勿与「暂无条目」混淆。"
    />

    <el-skeleton v-if="loading && !list.length && !loadError" :rows="8" animated />
    <template v-else>
    <div class="filter-bar">
      <el-select v-model="packFilter" clearable placeholder="包装筛选" style="width: 140px" @change="refresh">
        <el-option v-for="p in PACKAGING_FILTERS" :key="p" :label="p" :value="p" />
      </el-select>
      <el-select v-model="bioFilter" clearable placeholder="题材筛选" style="width: 140px" @change="refresh">
        <el-option v-for="b in BIO_FILTERS" :key="b" :label="b" :value="b" />
      </el-select>
      <el-select v-model="statusFilter" style="width: 120px" @change="refresh">
        <el-option label="全部状态" value="all" />
        <el-option label="上架" value="active" />
        <el-option label="下架" value="inactive" />
      </el-select>
      <el-input
        v-model="keyword"
        clearable
        placeholder="搜品名 / SKU / 物种"
        style="width: 220px"
        @clear="refresh"
        @keyup.enter="refresh"
      />
      <el-button @click="refresh">筛选</el-button>
    </div>

    <el-table :data="list" v-loading="loading" stripe empty-text="暂无报价条目">
      <el-table-column label="排序" width="72" prop="sort" />
      <el-table-column label="图" width="72">
        <template #default="{ row }">
          <el-image
            v-if="row.httpImage"
            :src="row.httpImage"
            :preview-src-list="row.httpImages?.length ? row.httpImages : [row.httpImage]"
            preview-teleported
            fit="cover"
            class="thumb-img"
          />
          <div v-else class="thumb"><span class="oos">无图</span></div>
        </template>
      </el-table-column>
      <el-table-column label="品名" min-width="180">
        <template #default="{ row }">
          <div class="name">{{ row.name }}</div>
          <div class="sub">{{ row.skuId }}</div>
        </template>
      </el-table-column>
      <el-table-column label="物种" width="120" prop="species" show-overflow-tooltip />
      <el-table-column label="制作" width="72" prop="prepMethod" />
      <el-table-column label="包装" width="100" prop="packaging" show-overflow-tooltip />
      <el-table-column label="筛·包装" width="100" prop="packagingFilter" />
      <el-table-column label="筛·题材" width="90" prop="bioFilter" />
      <el-table-column label="供货" width="120">
        <template #default="{ row }">
          <span class="price">{{ formatPriceAmount(row.price) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="指导" width="120">
        <template #default="{ row }">
          {{ formatPriceAmount(row.guidePrice) }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-switch
            :model-value="row.status === 'active'"
            @change="(v) => toggleStatus(row, v)"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link @click="openDialog(row)">编辑</el-button>
          <el-button size="small" type="danger" link @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty
      v-if="!loading && !list.length"
      description="尚无条目。可「同步官网种子」一键写入 43 款，或新建 SKU。"
    />
    </template>

    <el-dialog
      v-model="dialogVisible"
      :title="form._id ? '编辑报价 SKU' : '新建报价 SKU'"
      width="720px"
      destroy-on-close
      top="4vh"
    >
      <el-form :model="form" label-width="110px">
        <el-form-item label="skuId" required>
          <el-input v-model="form.skuId" placeholder="稳定 id，如 morpho-solid-wood-frame" :disabled="!!form._id" />
        </el-form-item>
        <el-form-item label="品名" required>
          <el-input v-model="form.name" maxlength="80" show-word-limit />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="物种" required>
              <el-input v-model="form.species" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="制作" required>
              <el-select v-model="form.prepMethod" style="width: 100%">
                <el-option v-for="p in PREP_METHODS" :key="p" :label="p" :value="p" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="包装文案" required>
              <el-input v-model="form.packaging" placeholder="展示用，可与筛选项不同" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="排序">
              <el-input-number v-model="form.sort" :min="0" :max="9999" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="包装筛选" required>
              <el-select v-model="form.packagingFilter" style="width: 100%">
                <el-option v-for="p in PACKAGING_FILTERS" :key="p" :label="p" :value="p" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="题材筛选" required>
              <el-select v-model="form.bioFilter" style="width: 100%">
                <el-option v-for="b in BIO_FILTERS" :key="b" :label="b" :value="b" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">供货价</el-divider>
        <el-form-item label="类型">
          <el-radio-group v-model="form.priceMode">
            <el-radio-button label="single">单价</el-radio-button>
            <el-radio-button label="range">区间</el-radio-button>
            <el-radio-button label="empty">暂无价</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.priceMode === 'single'" label="金额(元)">
          <el-input-number v-model="form.priceSingle" :min="0" :precision="2" :step="1" />
        </el-form-item>
        <el-row v-if="form.priceMode === 'range'" :gutter="12">
          <el-col :span="12">
            <el-form-item label="下限">
              <el-input-number v-model="form.priceMin" :min="0" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="上限">
              <el-input-number v-model="form.priceMax" :min="0" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">指导售价</el-divider>
        <el-form-item label="类型">
          <el-radio-group v-model="form.guideMode">
            <el-radio-button label="single">单价</el-radio-button>
            <el-radio-button label="range">区间</el-radio-button>
            <el-radio-button label="empty">暂无价</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.guideMode === 'single'" label="金额(元)">
          <el-input-number v-model="form.guideSingle" :min="0" :precision="2" :step="1" />
        </el-form-item>
        <el-row v-if="form.guideMode === 'range'" :gutter="12">
          <el-col :span="12">
            <el-form-item label="下限">
              <el-input-number v-model="form.guideMin" :min="0" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="上限">
              <el-input-number v-model="form.guideMax" :min="0" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="规格">
          <el-input v-model="form.specs" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="主图">
          <div class="img-edit">
            <el-image
              v-if="form.imagePreview"
              :src="form.imagePreview"
              :preview-src-list="form.galleryPreviews.length ? form.galleryPreviews : [form.imagePreview]"
              preview-teleported
              fit="cover"
              class="img-edit-preview"
            />
            <div class="img-edit-actions">
              <el-input v-model="form.image" placeholder="https://… 或 /images/… 或 cloud://" @change="onPrimaryImageChange" />
              <el-upload
                :show-file-list="false"
                accept="image/*"
                :http-request="uploadPrimary"
              >
                <el-button :icon="Picture" :loading="uploading">上传主图</el-button>
              </el-upload>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="多图">
          <div class="gallery-edit">
            <div v-if="form.galleryPreviews.length" class="gallery-thumbs">
              <div v-for="(url, idx) in form.galleryPreviews" :key="idx" class="gallery-thumb">
                <el-image :src="url" :preview-src-list="form.galleryPreviews" :initial-index="idx" preview-teleported fit="cover" class="gallery-thumb-img" />
                <el-button size="small" type="danger" link class="gallery-remove" @click="removeGalleryAt(idx)">移除</el-button>
              </div>
            </div>
            <el-upload
              :show-file-list="false"
              accept="image/*"
              multiple
              :http-request="uploadGallery"
            >
              <el-button :icon="Picture" :loading="uploading">上传多图</el-button>
            </el-upload>
            <el-input
              v-model="form.imagesStr"
              type="textarea"
              :rows="2"
              class="gallery-paths"
              placeholder="也可每行一个 URL / 相对路径 / cloud://；首张同步到主图"
              @change="onImagesStrChange"
            />
          </div>
        </el-form-item>
        <el-form-item label="图片 alt">
          <el-input v-model="form.imageAlt" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.statusActive" active-text="上架" inactive-text="下架" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Plus, Refresh, Picture } from '@element-plus/icons-vue'
import {
  fetchCollectionSorted,
  cdnAdd,
  cdnUpdate,
  cdnRemove,
  uploadAdminBinary,
  getTempFileUrl,
  cdnDocGet,
} from '../cloud'
import { publishB2bCatalog } from '../utils/b2bCatalogSync'
import seedJson from '../utils/priceListSeed.json'
import {
  PREP_METHODS,
  PACKAGING_FILTERS,
  BIO_FILTERS,
  formatPriceAmount,
  formPriceToValue,
  valueToFormPrice,
  toB2bCatalogItem,
  toAbsoluteSiteUrl,
  normalizeImageFields,
  shouldApplySeedImages,
} from '../utils/priceListHelpers'
import { ElMessage, ElMessageBox } from 'element-plus'

const COLLECTION = 'price_list_items'

const list = ref([])
const loading = ref(false)
const loadError = ref('')
const seeding = ref(false)
const publishing = ref(false)
const saving = ref(false)
const uploading = ref(false)
const forceOverwriteImages = ref(false)
const packFilter = ref('')
const bioFilter = ref('')
const statusFilter = ref('all')
const keyword = ref('')
const dialogVisible = ref(false)
const form = ref(emptyForm())
const b2bMeta = ref({ updatedAt: null, itemCount: null })

const activeSkuCount = computed(() => list.value.filter((r) => r.status === 'active').length)

const formatPubTime = (ts) => {
  if (!ts) return ''
  const d = new Date(typeof ts === 'number' ? ts : Number(ts))
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { hour12: false })
}

const openOfficialPreview = () => {
  window.open('https://shanhaizaowu.com/price-list/', '_blank', 'noopener,noreferrer')
}

const loadB2bMeta = async () => {
  try {
    const doc = await cdnDocGet('configs', 'b2b_catalog')
    if (!doc) {
      b2bMeta.value = { updatedAt: null, itemCount: null }
      return
    }
    const items = doc.items || doc.catalog || []
    b2bMeta.value = {
      updatedAt: doc.updatedAt || null,
      itemCount: Array.isArray(items) ? items.length : null,
    }
  } catch {
    b2bMeta.value = { updatedAt: null, itemCount: null }
  }
}

function emptyForm() {
  return {
    _id: '',
    skuId: '',
    name: '',
    species: '',
    prepMethod: '干制',
    packaging: '',
    packagingFilter: '玻璃罩',
    bioFilter: '蝴蝶',
    priceMode: 'single',
    priceSingle: null,
    priceMin: null,
    priceMax: null,
    guideMode: 'single',
    guideSingle: null,
    guideMin: null,
    guideMax: null,
    specs: '',
    note: '',
    image: '',
    imagesStr: '',
    imageAlt: '',
    imagePreview: '',
    galleryPreviews: [],
    sort: 1,
    statusActive: true,
  }
}

function parseImages(str, fallbackImage) {
  const lines = String(str || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (lines.length) return lines
  return fallbackImage ? [fallbackImage] : []
}

async function resolvePreviewUrl(path) {
  const raw = String(path || '').trim()
  if (!raw) return ''
  if (raw.startsWith('cloud://')) {
    try {
      return (await getTempFileUrl(raw)) || ''
    } catch {
      return ''
    }
  }
  return toAbsoluteSiteUrl(raw)
}

async function resolvePreviewList(paths) {
  const list = (paths || []).map((u) => String(u || '').trim()).filter(Boolean)
  return (await Promise.all(list.map(resolvePreviewUrl))).filter(Boolean)
}

const refresh = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const where = {}
    if (packFilter.value) where.packagingFilter = packFilter.value
    if (bioFilter.value) where.bioFilter = bioFilter.value
    if (statusFilter.value !== 'all') where.status = statusFilter.value
    let rows = await fetchCollectionSorted(COLLECTION, {
      limit: 500,
      where: Object.keys(where).length ? where : null,
      throwOnError: true,
      sortFn: (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.skuId || '').localeCompare(String(b.skuId || '')),
    })
    const kw = keyword.value.trim().toLowerCase()
    if (kw) {
      rows = rows.filter(
        (r) =>
          String(r.name || '').toLowerCase().includes(kw) ||
          String(r.skuId || '').toLowerCase().includes(kw) ||
          String(r.species || '').toLowerCase().includes(kw),
      )
    }
    list.value = await Promise.all(
      rows.map(async (r) => {
        const imgs = Array.isArray(r.images) && r.images.length ? r.images : r.image ? [r.image] : []
        const httpImages = await resolvePreviewList(imgs)
        return {
          ...r,
          httpImage: httpImages[0] || '',
          httpImages,
        }
      }),
    )
    loadB2bMeta().catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
  } catch (e) {
    list.value = []
    loadError.value = '加载失败：' + (e.message || e)
    ElMessage.error(loadError.value)
  } finally {
    loading.value = false
  }
}

const openDialog = async (row) => {
  if (row) {
    const p = valueToFormPrice(row.price)
    const g = valueToFormPrice(row.guidePrice)
    const images = Array.isArray(row.images) && row.images.length ? row.images : row.image ? [row.image] : []
    form.value = {
      _id: row._id,
      skuId: row.skuId || '',
      name: row.name || '',
      species: row.species || '',
      prepMethod: row.prepMethod || '干制',
      packaging: row.packaging || '',
      packagingFilter: row.packagingFilter || '玻璃罩',
      bioFilter: row.bioFilter || '蝴蝶',
      priceMode: p.mode,
      priceSingle: p.single,
      priceMin: p.min,
      priceMax: p.max,
      guideMode: g.mode,
      guideSingle: g.single,
      guideMin: g.min,
      guideMax: g.max,
      specs: row.specs || '',
      note: row.note || '',
      image: row.image || '',
      imagesStr: images.join('\n'),
      imageAlt: row.imageAlt || '',
      imagePreview: row.httpImage || (await resolvePreviewUrl(row.image)),
      galleryPreviews: row.httpImages?.length ? [...row.httpImages] : await resolvePreviewList(images),
      sort: row.sort ?? 1,
      statusActive: row.status !== 'inactive',
    }
  } else {
    form.value = {
      ...emptyForm(),
      sort: (list.value.reduce((m, r) => Math.max(m, r.sort || 0), 0) || 0) + 1,
    }
  }
  dialogVisible.value = true
}

const onPrimaryImageChange = async () => {
  form.value.imagePreview = await resolvePreviewUrl(form.value.image)
}

const onImagesStrChange = async () => {
  const imgs = parseImages(form.value.imagesStr, form.value.image)
  form.value.galleryPreviews = await resolvePreviewList(imgs)
  if (!form.value.image && imgs[0]) {
    form.value.image = imgs[0]
    form.value.imagePreview = form.value.galleryPreviews[0] || ''
  }
}

const uploadPrimary = async (opt) => {
  uploading.value = true
  try {
    const fileID = await uploadAdminBinary(opt.file, 'price-list')
    const preview = await resolvePreviewUrl(fileID)
    form.value.image = fileID
    form.value.imagePreview = preview
    const lines = parseImages(form.value.imagesStr, '')
    if (!lines.length || lines[0] !== fileID) {
      form.value.imagesStr = [fileID, ...lines.filter((u) => u !== fileID)].join('\n')
    }
    form.value.galleryPreviews = await resolvePreviewList(parseImages(form.value.imagesStr, fileID))
    opt.onSuccess?.({}, opt.file)
    ElMessage.success('主图已上传')
  } catch (e) {
    opt.onError?.(e)
    ElMessage.error('上传失败：' + (e.message || e))
  } finally {
    uploading.value = false
  }
}

const uploadGallery = async (opt) => {
  uploading.value = true
  try {
    const fileID = await uploadAdminBinary(opt.file, 'price-list')
    const lines = parseImages(form.value.imagesStr, form.value.image)
    lines.push(fileID)
    form.value.imagesStr = lines.join('\n')
    if (!form.value.image) {
      form.value.image = fileID
      form.value.imagePreview = await resolvePreviewUrl(fileID)
    }
    form.value.galleryPreviews = await resolvePreviewList(lines)
    opt.onSuccess?.({}, opt.file)
    ElMessage.success('已加入多图')
  } catch (e) {
    opt.onError?.(e)
    ElMessage.error('上传失败：' + (e.message || e))
  } finally {
    uploading.value = false
  }
}

const removeGalleryAt = async (idx) => {
  const lines = parseImages(form.value.imagesStr, form.value.image)
  lines.splice(idx, 1)
  form.value.imagesStr = lines.join('\n')
  form.value.galleryPreviews = await resolvePreviewList(lines)
  if (form.value.image && !lines.includes(form.value.image)) {
    form.value.image = lines[0] || ''
    form.value.imagePreview = form.value.galleryPreviews[0] || ''
  }
}

const save = async () => {
  const f = form.value
  if (!f.skuId?.trim() || !f.name?.trim() || !f.species?.trim() || !f.packaging?.trim()) {
    return ElMessage.warning('skuId、品名、物种、包装文案必填')
  }
  const { image, images } = normalizeImageFields(f.image, parseImages(f.imagesStr, f.image), {
    // 保留 cloud://；相对路径写成官网绝对地址便于 Admin 预览
    absolute: true,
  })
  // normalize 会把 cloud:// 原样保留（toAbsoluteSiteUrl）
  const payload = {
    skuId: f.skuId.trim(),
    name: f.name.trim(),
    species: f.species.trim(),
    prepMethod: f.prepMethod,
    packaging: f.packaging.trim(),
    packagingFilter: f.packagingFilter,
    bioFilter: f.bioFilter,
    price: formPriceToValue(f.priceMode, f.priceSingle, f.priceMin, f.priceMax),
    guidePrice: formPriceToValue(f.guideMode, f.guideSingle, f.guideMin, f.guideMax),
    specs: f.specs || '',
    note: f.note || '',
    image,
    images,
    imageAlt: f.imageAlt || f.name.trim(),
    sort: f.sort ?? 1,
    status: f.statusActive ? 'active' : 'inactive',
    updatedAt: Date.now(),
  }
  saving.value = true
  try {
    if (f._id) {
      await cdnUpdate(COLLECTION, f._id, payload)
    } else {
      const existing = await fetchCollectionSorted(COLLECTION, {
        limit: 5,
        where: { skuId: payload.skuId },
      })
      if (existing.length) {
        ElMessage.warning(`skuId「${payload.skuId}」已存在`)
        return
      }
      await cdnAdd(COLLECTION, { ...payload, createTime: Date.now() })
    }
    ElMessage.success('已保存；官网刷新后可见（active）')
    dialogVisible.value = false
    await refresh()
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || e))
  } finally {
    saving.value = false
  }
}

const toggleStatus = async (row, on) => {
  try {
    await cdnUpdate(COLLECTION, row._id, {
      status: on ? 'active' : 'inactive',
      updatedAt: Date.now(),
    })
    row.status = on ? 'active' : 'inactive'
    ElMessage.success(on ? '已上架' : '已下架')
  } catch (e) {
    ElMessage.error('更新失败：' + (e.message || e))
  }
}

const remove = (row) => {
  ElMessageBox.confirm(`删除「${row.name}」？`, '确认', { type: 'warning' })
    .then(async () => {
      await cdnRemove(COLLECTION, row._id)
      ElMessage.success('已删除')
      refresh()
    })
    .catch((e) => { if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e) })
}

const seedDefaults = async () => {
  seeding.value = true
  try {
    const force = forceOverwriteImages.value
    const existing = await fetchCollectionSorted(COLLECTION, { limit: 500 })
    const bySku = new Map(existing.map((r) => [r.skuId, r]))
    let added = 0
    let updated = 0
    let imagesFilled = 0
    for (const raw of seedJson) {
      const imgs = normalizeImageFields(raw.image, raw.images, { absolute: true })
      const seed = {
        skuId: raw.skuId,
        name: raw.name,
        species: raw.species,
        prepMethod: raw.prepMethod,
        packaging: raw.packaging,
        packagingFilter: raw.packagingFilter,
        bioFilter: raw.bioFilter,
        price: raw.price ?? null,
        guidePrice: raw.guidePrice ?? null,
        specs: raw.specs || '',
        note: raw.note || '',
        imageAlt: raw.imageAlt || raw.name,
        sort: raw.sort ?? 1,
        status: raw.status || 'active',
        ...imgs,
      }
      const cur = bySku.get(seed.skuId)
      if (!cur) {
        await cdnAdd(COLLECTION, {
          ...seed,
          createTime: Date.now(),
          updatedAt: Date.now(),
        })
        added += 1
        continue
      }
      const patch = {
        name: seed.name,
        species: seed.species,
        prepMethod: seed.prepMethod,
        packaging: seed.packaging,
        packagingFilter: seed.packagingFilter,
        bioFilter: seed.bioFilter,
        price: seed.price,
        guidePrice: seed.guidePrice,
        specs: seed.specs,
        note: seed.note,
        imageAlt: seed.imageAlt,
        sort: seed.sort,
        updatedAt: Date.now(),
      }
      if (shouldApplySeedImages(cur, { forceOverwrite: force })) {
        patch.image = seed.image
        patch.images = seed.images
        if (seed.image) imagesFilled += 1
      }
      await cdnUpdate(COLLECTION, cur._id, patch)
      updated += 1
    }
    ElMessage.success(
      `种子同步完成：新增 ${added}，更新 ${updated}` +
        (imagesFilled ? `，补全/刷新图片 ${imagesFilled}` : '') +
        (force ? '（已强制覆盖图片）' : ''),
    )
    await refresh()
  } catch (e) {
    ElMessage.error('同步失败：' + (e.message || e))
  } finally {
    seeding.value = false
  }
}

const publishB2b = async () => {
  publishing.value = true
  try {
    const active = await fetchCollectionSorted(COLLECTION, {
      limit: 500,
      where: { status: 'active' },
      sortFn: (a, b) => (a.sort ?? 0) - (b.sort ?? 0),
    })
    if (!active.length) {
      ElMessage.warning('没有上架条目可发布')
      return
    }
    await ElMessageBox.confirm(
      `将 ${active.length} 条上架 SKU 写入 configs/b2b_catalog，供订货履约与店长选品。`,
      '发布到订货价目',
      { type: 'info' },
    )
    await publishB2bCatalog(active.map(toB2bCatalogItem))
    b2bMeta.value = { updatedAt: Date.now(), itemCount: active.length }
    ElMessage.success('已发布到 configs/b2b_catalog')
  } catch (e) {
    if (e !== 'cancel' && e?.toString?.() !== 'cancel') {
      ElMessage.error('发布失败：' + (e.message || e))
    }
  } finally {
    publishing.value = false
  }
}

onMounted(refresh)
</script>

<style scoped>
.pl-container {
  padding: 0 4px 24px;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.title-box h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #1a1a1a;
}
.subtitle {
  display: block;
  margin-top: 4px;
  font-size: 0.8rem;
  color: #909399;
}
.header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.pub-status-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-bottom: 14px;
  padding: 10px 14px;
  background: #f6f8f5;
  border: 1px solid #e4ebe6;
  border-radius: 8px;
  font-size: 13px;
  color: #606266;
}
.pub-num { color: #2D6A4F; font-size: 15px; }
.pub-sep { color: #c0c4cc; }
.hint-alert {
  margin-bottom: 14px;
}
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}
.thumb {
  width: 48px;
  height: 48px;
  border: 1px solid #ebeef5;
  background: #f5f7fa;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.thumb-img {
  width: 48px;
  height: 48px;
  border-radius: 2px;
}
.oos {
  font-size: 10px;
  color: #909399;
}
.name {
  font-weight: 500;
}
.sub {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
}
.price {
  color: #2d6a4f;
  font-weight: 600;
}
.img-edit {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  width: 100%;
}
.img-edit-preview {
  width: 88px;
  height: 88px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 2px;
}
.img-edit-actions {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gallery-edit {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gallery-thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.gallery-thumb {
  width: 72px;
  text-align: center;
}
.gallery-thumb-img {
  width: 72px;
  height: 72px;
  border: 1px solid #ebeef5;
}
.gallery-remove {
  margin-top: 2px;
}
.gallery-paths {
  width: 100%;
}
</style>
