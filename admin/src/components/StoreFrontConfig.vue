<template>
  <div class="storefront-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>C 端门店展区 / STORE FRONT</h2>
        <span class="subtitle">STOREFRONT · 小程序门店与展区展示配置（与「门店中心」的合规档案不同）</span>
      </div>
      <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
    </div>

    <el-alert
      type="warning"
      :closable="false"
      show-icon
      class="dual-track-alert"
      title="双轨说明：本页维护小程序「这有店」云库 stores / store_zones；业务运营「店铺管理」是 ERP 合规档案，二者刻意不同步，勿互相覆盖。"
    />

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      class="dual-track-alert"
      :title="loadError"
      description="请确认集合 stores / store_zones 已 provision，且当前账号可匿名读 / 管理写。"
    />

    <el-skeleton v-if="loading && !stores.length && !zones.length && !loadError" :rows="7" animated style="margin-top: 8px" />
    <template v-else>
    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <el-tab-pane label="门店主数据" name="stores" />
      <el-tab-pane label="展区 / 动线" name="zones" />
    </el-tabs>

    <div v-if="activeTab === 'stores'">
      <div class="action-bar">
        <span class="tip">小程序「这有店」读取 status=active 的门店；字段与 manageStoreConfig 对齐。</span>
        <el-button type="primary" color="#2D6A4F" :icon="Plus" @click="openStoreDialog()">新建门店</el-button>
      </div>
      <el-table :data="stores" v-loading="loading" stripe empty-text="暂无 C 端门店">
        <el-table-column label="排序" width="72" prop="sort" />
        <el-table-column label="门店" min-width="200">
          <template #default="{ row }">
            <div class="name">{{ row.name }}</div>
            <div class="sub">{{ row.storeId }} · {{ row.roleLabel || row.role || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="楼层/地址" min-width="220">
          <template #default="{ row }">
            <div>{{ row.floor || '-' }}</div>
            <div class="sub">{{ row.address || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="phone" label="电话" width="130" />
        <el-table-column label="营业" width="120">
          <template #default="{ row }">
            {{ row.hours?.open || '-' }}–{{ row.hours?.close || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link @click="openStoreDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" link @click="removeStore(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !stores.length" description="尚无门店主数据，新建后小程序「这有店」即可展示。" />
    </div>

    <div v-if="activeTab === 'zones'">
      <div class="action-bar">
        <el-select v-model="zoneStoreFilter" placeholder="按门店筛选" clearable style="width: 220px" @change="loadZones">
          <el-option v-for="s in stores" :key="s.storeId" :label="s.name" :value="s.storeId" />
        </el-select>
        <el-button type="primary" color="#2D6A4F" :icon="Plus" @click="openZoneDialog()">新建展区</el-button>
      </div>
      <el-table :data="zones" v-loading="loading" stripe empty-text="暂无展区">
        <el-table-column label="排序" width="72" prop="sort" />
        <el-table-column label="展区" min-width="180">
          <template #default="{ row }">
            <div class="name">{{ row.title }}</div>
            <div class="sub">{{ row.zoneId }} · {{ row.overline }}</div>
          </template>
        </el-table-column>
        <el-table-column label="所属门店" width="160">
          <template #default="{ row }">{{ storeName(row.storeId) }}</template>
        </el-table-column>
        <el-table-column prop="categoryTag" label="品类标签" width="110" />
        <el-table-column label="描述" min-width="200" show-overflow-tooltip prop="desc" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link @click="openZoneDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" link @click="removeZone(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !zones.length" description="尚无展区动线，可按门店新建。" />
    </div>
    </template>

    <el-dialog v-model="storeDialog" :title="storeForm._id ? '编辑门店' : '新建门店'" width="640px" destroy-on-close>
      <el-form :model="storeForm" label-width="110px">
        <el-form-item label="storeId" required>
          <el-input v-model="storeForm.storeId" :disabled="!!storeForm._id" placeholder="如 store_shanhaizaowu" />
        </el-form-item>
        <el-form-item label="名称" required><el-input v-model="storeForm.name" /></el-form-item>
        <el-form-item label="英文名"><el-input v-model="storeForm.nameEn" /></el-form-item>
        <el-form-item label="角色标签"><el-input v-model="storeForm.roleLabel" placeholder="品牌主店 / 标本工坊" /></el-form-item>
        <el-form-item label="电话"><el-input v-model="storeForm.phone" /></el-form-item>
        <el-form-item label="楼层"><el-input v-model="storeForm.floor" /></el-form-item>
        <el-form-item label="地址"><el-input v-model="storeForm.address" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="一句话"><el-input v-model="storeForm.heroTagline" /></el-form-item>
        <el-form-item label="简介"><el-input v-model="storeForm.intro" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="封面图">
          <ImageUploadField
            v-model="storeForm.coverImage"
            folder="stores"
            tip="优先上传门店封面；也可粘贴 cloud:// 或 HTTPS"
            preview-width="160px"
            preview-height="100px"
          />
        </el-form-item>
        <el-form-item label="营业时段">
          <div class="hours-row">
            <el-input v-model="storeForm.hoursOpen" placeholder="10:00" style="width: 120px" />
            <span>—</span>
            <el-input v-model="storeForm.hoursClose" placeholder="22:00" style="width: 120px" />
          </div>
        </el-form-item>
        <el-form-item label="特色标签">
          <el-input v-model="storeForm.featuresStr" placeholder="逗号分隔，如：入店参观,馆藏零售" />
        </el-form-item>
        <el-form-item label="排序"><el-input-number v-model="storeForm.sort" :min="0" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="storeForm.status" style="width: 160px">
            <el-option label="active" value="active" />
            <el-option label="inactive" value="inactive" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="storeDialog = false">取消</el-button>
        <el-button type="primary" color="#2D6A4F" :loading="saving" @click="saveStore">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="zoneDialog" :title="zoneForm._id ? '编辑展区' : '新建展区'" width="640px" destroy-on-close>
      <el-form :model="zoneForm" label-width="110px">
        <el-form-item label="zoneId" required>
          <el-input v-model="zoneForm.zoneId" :disabled="!!zoneForm._id" placeholder="如 zone_insect" />
        </el-form-item>
        <el-form-item label="所属门店" required>
          <el-select v-model="zoneForm.storeId" style="width: 100%">
            <el-option v-for="s in stores" :key="s.storeId" :label="s.name" :value="s.storeId" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题" required><el-input v-model="zoneForm.title" /></el-form-item>
        <el-form-item label="overline"><el-input v-model="zoneForm.overline" placeholder="INSECTA" /></el-form-item>
        <el-form-item label="品类标签"><el-input v-model="zoneForm.categoryTag" /></el-form-item>
        <el-form-item label="短描述"><el-input v-model="zoneForm.desc" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="长描述"><el-input v-model="zoneForm.longDesc" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="封面图">
          <ImageUploadField
            v-model="zoneForm.coverImage"
            folder="store-zones"
            tip="优先上传展区封面；也可粘贴 cloud:// 或 HTTPS"
            preview-width="160px"
            preview-height="100px"
          />
        </el-form-item>
        <el-form-item label="图集">
          <div class="gallery-upload-row">
            <el-upload
              accept="image/*"
              :show-file-list="false"
              :http-request="uploadZoneGalleryImage"
            >
              <el-button type="primary" plain :loading="zoneGalleryUploading">上传并追加</el-button>
            </el-upload>
            <span class="gallery-hint">上传一张追加一行；下方可批量粘贴/调整顺序</span>
          </div>
          <el-input
            v-model="zoneForm.imagesStr"
            type="textarea"
            :rows="2"
            placeholder="多张 URL，逗号或换行分隔"
            style="margin-top: 8px"
          />
        </el-form-item>
        <el-form-item label="排序"><el-input-number v-model="zoneForm.sort" :min="0" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="zoneForm.status" style="width: 160px">
            <el-option label="active" value="active" />
            <el-option label="inactive" value="inactive" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="zoneDialog = false">取消</el-button>
        <el-button type="primary" color="#2D6A4F" :loading="saving" @click="saveZone">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { fetchCollectionSorted, cdnAdd, cdnUpdate, cdnRemove, uploadAdminBinary } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import ImageUploadField from './ImageUploadField.vue'

const activeTab = ref('stores')
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const stores = ref([])
const zones = ref([])
const zoneStoreFilter = ref('')
const storeDialog = ref(false)
const zoneDialog = ref(false)
const storeForm = ref(emptyStore())
const zoneForm = ref(emptyZone())
const zoneGalleryUploading = ref(false)

async function uploadZoneGalleryImage(opt) {
  const file = opt?.file
  if (!file) return
  if (file.type && !file.type.startsWith('image/')) {
    ElMessage.error('仅支持图片文件')
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error('图片过大，请压缩到 5MB 以内')
    return
  }
  zoneGalleryUploading.value = true
  try {
    const fileID = await uploadAdminBinary(file, 'store-zones')
    const existing = String(zoneForm.value.imagesStr || '')
      .split(/[\n,，]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!existing.includes(fileID)) existing.push(fileID)
    zoneForm.value.imagesStr = existing.join('\n')
    opt.onSuccess?.({ fileID }, file)
    ElMessage.success('已追加到图集')
  } catch (e) {
    opt.onError?.(e)
    ElMessage.error('上传失败：' + (e?.message || '请检查云存储权限'))
  } finally {
    zoneGalleryUploading.value = false
  }
}

function emptyStore() {
  return {
    _id: '',
    storeId: '',
    name: '',
    nameEn: '',
    roleLabel: '',
    phone: '',
    floor: '',
    address: '',
    heroTagline: '',
    intro: '',
    coverImage: '',
    hoursOpen: '10:00',
    hoursClose: '22:00',
    featuresStr: '',
    sort: 1,
    status: 'active'
  }
}

function emptyZone() {
  return {
    _id: '',
    zoneId: '',
    storeId: '',
    title: '',
    overline: '',
    categoryTag: '',
    desc: '',
    longDesc: '',
    coverImage: '',
    imagesStr: '',
    sort: 1,
    status: 'active'
  }
}

const storeName = (id) => stores.value.find((s) => s.storeId === id)?.name || id || '-'

const loadStores = async () => {
  stores.value = await fetchCollectionSorted('stores', {
    limit: 100,
    throwOnError: true,
    sortFn: (a, b) => (a.sort || 0) - (b.sort || 0)
  })
}

const loadZones = async () => {
  const where = zoneStoreFilter.value ? { storeId: zoneStoreFilter.value } : null
  zones.value = await fetchCollectionSorted('store_zones', {
    limit: 200,
    where,
    throwOnError: true,
    sortFn: (a, b) => (a.sort || 0) - (b.sort || 0)
  })
}

const refresh = async () => {
  loading.value = true
  loadError.value = ''
  try {
    await loadStores()
    if (activeTab.value === 'zones') await loadZones()
  } catch (e) {
    loadError.value = '加载失败：' + (e.message || e)
    ElMessage.error(loadError.value)
  } finally {
    loading.value = false
  }
}

const onTabChange = async () => {
  loading.value = true
  loadError.value = ''
  try {
    if (activeTab.value === 'stores') await loadStores()
    else await loadZones()
  } catch (e) {
    loadError.value = '加载失败：' + (e.message || e)
    ElMessage.error(loadError.value)
  } finally {
    loading.value = false
  }
}

const openStoreDialog = (row) => {
  if (row) {
    storeForm.value = {
      _id: row._id,
      storeId: row.storeId || '',
      name: row.name || '',
      nameEn: row.nameEn || '',
      roleLabel: row.roleLabel || '',
      phone: row.phone || '',
      floor: row.floor || '',
      address: row.address || '',
      heroTagline: row.heroTagline || '',
      intro: row.intro || '',
      coverImage: row.coverImage || '',
      hoursOpen: row.hours?.open || '10:00',
      hoursClose: row.hours?.close || '22:00',
      featuresStr: Array.isArray(row.features) ? row.features.join(',') : '',
      sort: row.sort ?? 1,
      status: row.status || 'active'
    }
  } else {
    storeForm.value = emptyStore()
  }
  storeDialog.value = true
}

const saveStore = async () => {
  const f = storeForm.value
  if (!f.storeId?.trim() || !f.name?.trim()) return ElMessage.warning('storeId 与名称必填')
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{2,63}$/.test(f.storeId.trim())) {
    return ElMessage.warning('storeId 需字母开头，仅字母数字_-，长度 3–64')
  }
  if (f.phone?.trim() && !/^[\d+\-\s]{6,20}$/.test(f.phone.trim())) {
    return ElMessage.warning('电话格式不正确')
  }
  const payload = {
    storeId: f.storeId.trim(),
    name: f.name.trim(),
    nameEn: f.nameEn || '',
    roleLabel: f.roleLabel || '',
    phone: f.phone || '',
    floor: f.floor || '',
    address: f.address || '',
    heroTagline: f.heroTagline || '',
    intro: f.intro || '',
    coverImage: f.coverImage || '',
    hours: { open: f.hoursOpen || '10:00', close: f.hoursClose || '22:00', note: '' },
    features: String(f.featuresStr || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    sort: f.sort ?? 1,
    status: f.status || 'active',
    updatedAt: Date.now()
  }
  if (!f._id) {
    const dup = stores.value.find((s) => s.storeId === payload.storeId)
    if (dup) return ElMessage.warning(`storeId「${payload.storeId}」已存在`)
  }
  saving.value = true
  try {
    if (f._id) await cdnUpdate('stores', f._id, payload)
    else await cdnAdd('stores', { ...payload, createTime: Date.now() })
    ElMessage.success('门店已保存')
    storeDialog.value = false
    await loadStores()
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || e))
  } finally {
    saving.value = false
  }
}

const removeStore = (row) => {
  ElMessageBox.confirm(`删除门店「${row.name}」？展区不会自动删除。`, '确认', { type: 'warning' }).then(async () => {
    await cdnRemove('stores', row._id)
    ElMessage.success('已删除')
    loadStores()
  }).catch(() => {})
}

const parseImages = (str) => String(str || '')
  .split(/[\n,，]/)
  .map((s) => s.trim())
  .filter(Boolean)

const openZoneDialog = (row) => {
  if (row) {
    zoneForm.value = {
      _id: row._id,
      zoneId: row.zoneId || '',
      storeId: row.storeId || '',
      title: row.title || '',
      overline: row.overline || '',
      categoryTag: row.categoryTag || '',
      desc: row.desc || '',
      longDesc: row.longDesc || '',
      coverImage: row.coverImage || '',
      imagesStr: Array.isArray(row.images) ? row.images.join('\n') : '',
      sort: row.sort ?? 1,
      status: row.status || 'active'
    }
  } else {
    zoneForm.value = {
      ...emptyZone(),
      storeId: zoneStoreFilter.value || stores.value[0]?.storeId || ''
    }
  }
  zoneDialog.value = true
}

const saveZone = async () => {
  const f = zoneForm.value
  if (!f.zoneId?.trim() || !f.title?.trim() || !f.storeId) {
    return ElMessage.warning('zoneId、标题、所属门店必填')
  }
  const payload = {
    zoneId: f.zoneId.trim(),
    storeId: f.storeId,
    title: f.title.trim(),
    overline: f.overline || '',
    categoryTag: f.categoryTag || '',
    desc: f.desc || '',
    longDesc: f.longDesc || '',
    coverImage: f.coverImage || '',
    images: parseImages(f.imagesStr),
    sort: f.sort ?? 1,
    status: f.status || 'active',
    updatedAt: Date.now()
  }
  saving.value = true
  try {
    if (f._id) await cdnUpdate('store_zones', f._id, payload)
    else await cdnAdd('store_zones', { ...payload, createTime: Date.now() })
    ElMessage.success('展区已保存')
    zoneDialog.value = false
    await loadZones()
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || e))
  } finally {
    saving.value = false
  }
}

const removeZone = (row) => {
  ElMessageBox.confirm(`删除展区「${row.title}」？`, '确认', { type: 'warning' }).then(async () => {
    await cdnRemove('store_zones', row._id)
    ElMessage.success('已删除')
    loadZones()
  }).catch(() => {})
}

onMounted(refresh)
</script>

<style scoped>
.storefront-container { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #2D6A4F; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; }
.gallery-upload-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.gallery-hint { font-size: 12px; color: #6b6560; }
.dual-track-alert { margin-bottom: 12px; }
.action-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 12px; flex-wrap: wrap; }
.tip { color: #888; font-size: 13px; }
.name { font-weight: 600; color: #333; }
.sub { font-size: 12px; color: #999; margin-top: 2px; }
.hours-row { display: flex; align-items: center; gap: 8px; }
</style>
