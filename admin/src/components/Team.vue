<template>
  <div class="team-container">
    <div class="panel-header">
      <div class="panel-header-text">
        <h2>{{ pageTitle }}</h2>
        <p class="panel-sub">{{ pageSubtitle }}</p>
      </div>
    </div>

    <div v-if="section === 'framer'" class="framer-section">
      <div class="stat-row">
        <div class="stat-card">
          <div class="stat-num">{{ framerList.length }}</div>
          <div class="stat-label">已注册</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">{{ activeCount }}</div>
          <div class="stat-label">展示中</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">{{ storeCount }}</div>
          <div class="stat-label">门店标本师</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">{{ partnerCount }}</div>
          <div class="stat-label">特邀合作</div>
        </div>
      </div>

      <div class="action-bar">
        <div class="filters">
          <el-input
            v-model="keyword"
            size="small"
            clearable
            placeholder="搜索姓名 / 头衔 / 擅长"
            style="width: 220px"
            :prefix-icon="Search"
          />
          <el-select v-model="statusFilter" size="small" style="width: 120px">
            <el-option label="全部状态" value="all" />
            <el-option label="展示中" value="active" />
            <el-option label="已隐藏" value="hidden" />
          </el-select>
          <el-select v-model="typeFilter" size="small" style="width: 130px">
            <el-option label="全部类型" value="all" />
            <el-option label="门店标本师" value="store" />
            <el-option label="特邀合作" value="partner" />
          </el-select>
          <el-radio-group v-model="viewMode" size="small">
            <el-radio-button label="card">卡片</el-radio-button>
            <el-radio-button label="table">列表</el-radio-button>
          </el-radio-group>
        </div>
        <el-button type="primary" :icon="Plus" @click="openFramerDialog()">签约新标本师</el-button>
      </div>

      <el-alert
        v-if="loadHint"
        :title="loadHint"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
      />

      <!-- 卡片 -->
      <div v-if="viewMode === 'card'" class="framer-grid" v-loading="loading">
        <div
          v-for="f in filteredList"
          :key="f._id"
          class="framer-card"
          @click="openDetail(f)"
        >
          <div class="card-status">
            <el-tag v-if="f.active !== false" type="success" effect="dark" size="small">展示中</el-tag>
            <el-tag v-else type="info" effect="dark" size="small">已隐藏</el-tag>
          </div>
          <div class="card-visual">
            <el-avatar :size="80" :src="f.httpAvatar" class="avatar-box">
              {{ (f.name || '?').charAt(0) }}
            </el-avatar>
            <div class="f-name">{{ f.name }}</div>
            <div class="f-title">{{ f.title || typeLabel(f.type) }}</div>
          </div>
          <div class="card-content">
            <div class="f-tags">
              <span class="tag-item type-tag">{{ typeLabel(f.type) }}</span>
              <span v-for="(tag, idx) in (f.tags || []).slice(0, 3)" :key="idx" class="tag-item">{{ tag }}</span>
            </div>
            <div class="f-desc">{{ f.bio || f.desc || '暂无简介' }}</div>
          </div>
          <div class="card-footer" @click.stop>
            <el-switch
              v-model="f.active"
              size="small"
              inline-prompt
              active-text="显"
              inactive-text="隐"
              @change="toggleFramerStatus(f)"
            />
            <div class="actions">
              <el-button link type="primary" :icon="View" @click="openDetail(f)">查看</el-button>
              <el-button link type="primary" :icon="Edit" @click="openFramerDialog(f)">编辑</el-button>
              <el-button link type="danger" :icon="Delete" @click="deleteFramer(f)">解约</el-button>
            </div>
          </div>
        </div>

        <div class="framer-card add-placeholder" @click="openFramerDialog()">
          <el-icon :size="40"><Plus /></el-icon>
          <span>添加新成员</span>
        </div>
      </div>

      <!-- 列表 -->
      <el-card v-else shadow="never" v-loading="loading">
        <el-table :data="filteredList" stripe @row-click="openDetail">
          <template #empty>
            <el-empty description="暂无已注册标本师" :image-size="80" />
          </template>
          <el-table-column label="档案" min-width="220">
            <template #default="{ row }">
              <div class="table-name">
                <el-avatar :size="36" :src="row.httpAvatar">{{ (row.name || '?').charAt(0) }}</el-avatar>
                <div>
                  <div class="t-main">{{ row.name }}</div>
                  <div class="t-sub">{{ row.title || '—' }}</div>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="110">
            <template #default="{ row }">{{ typeLabel(row.type) }}</template>
          </el-table-column>
          <el-table-column label="擅长" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ (row.tags || []).join('、') || '—' }}</template>
          </el-table-column>
          <el-table-column label="定制加价" width="100">
            <template #default="{ row }">{{ row.priceDelta > 0 ? `+¥${row.priceDelta}` : '—' }}</template>
          </el-table-column>
          <el-table-column label="额外交期" width="100">
            <template #default="{ row }">{{ row.extraDays > 0 ? `+${row.extraDays} 天` : '—' }}</template>
          </el-table-column>
          <el-table-column label="排序" prop="sort" width="72" />
          <el-table-column label="状态" width="88">
            <template #default="{ row }">
              <el-tag :type="row.active !== false ? 'success' : 'info'" size="small">
                {{ row.active !== false ? '展示' : '隐藏' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button size="small" link @click.stop="openDetail(row)">查看</el-button>
              <el-button size="small" link type="primary" @click.stop="openFramerDialog(row)">编辑</el-button>
              <el-button size="small" link type="danger" @click.stop="deleteFramer(row)">解约</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <div v-if="section === 'staff'" class="staff-section unified-staff-wrap">
      <div class="action-bar">
        <div class="tip">
          与「员工薪酬管理」「店铺管理」门店员工 Tab 使用同一套本地花名册；门店店员绑定门店后将同步至对应店铺详情。
          小程序店长登录账号仍使用云库 <code>staffs</code>，与本地花名册独立，需另行维护。
        </div>
      </div>
      <UnifiedEmployeePanel />
    </div>

    <!-- 详情 -->
    <el-drawer v-model="detailOpen" title="标本师档案" size="560px" destroy-on-close>
      <template v-if="current">
        <div class="detail-hero">
          <el-avatar :size="88" :src="current.httpAvatar">{{ (current.name || '?').charAt(0) }}</el-avatar>
          <div>
            <h3>{{ current.name }}</h3>
            <p>{{ current.title || typeLabel(current.type) }}</p>
            <el-tag size="small" :type="current.active !== false ? 'success' : 'info'">
              {{ current.active !== false ? '小程序展示中' : '已隐藏' }}
            </el-tag>
          </div>
        </div>
        <el-descriptions :column="1" border size="small" class="detail-desc">
          <el-descriptions-item label="类型">{{ typeLabel(current.type) }}</el-descriptions-item>
          <el-descriptions-item label="艺名">{{ current.alias || '—' }}</el-descriptions-item>
          <el-descriptions-item label="常驻城市">{{ current.city || '—' }}</el-descriptions-item>
          <el-descriptions-item label="从业年限">{{ current.yearsExperience > 0 ? `${current.yearsExperience} 年` : '—' }}</el-descriptions-item>
          <el-descriptions-item label="入驻时间">{{ current.joinedAt || '—' }}</el-descriptions-item>
          <el-descriptions-item label="擅长">{{ (current.tags || []).join('、') || '—' }}</el-descriptions-item>
          <el-descriptions-item label="技法/风格">{{ current.signatureStyle || '—' }}</el-descriptions-item>
          <el-descriptions-item label="学习经历">{{ current.education || '—' }}</el-descriptions-item>
          <el-descriptions-item label="一句理念">{{ current.quote || '—' }}</el-descriptions-item>
          <el-descriptions-item label="简介">{{ current.bio || current.desc || '—' }}</el-descriptions-item>
          <el-descriptions-item label="定制加价">{{ current.priceDelta > 0 ? `+¥${current.priceDelta}` : '无' }}</el-descriptions-item>
          <el-descriptions-item label="额外交期">{{ current.extraDays > 0 ? `+${current.extraDays} 天` : '无' }}</el-descriptions-item>
          <el-descriptions-item label="内部备注">{{ current.note || '—' }}</el-descriptions-item>
        </el-descriptions>

        <div v-if="current.httpGallery?.length" class="gallery-block">
          <div class="seg">作品照片</div>
          <div class="gallery-row">
            <el-image
              v-for="(url, i) in current.httpGallery"
              :key="i"
              :src="url"
              :preview-src-list="current.httpGallery"
              :initial-index="i"
              preview-teleported
              :z-index="5000"
              hide-on-click-modal
              fit="cover"
              class="gal-img"
            />
          </div>
        </div>

        <div class="gallery-block">
          <div class="seg">关联藏品（framerId）</div>
          <el-table v-if="linkedWorks.length" :data="linkedWorks" size="small">
            <el-table-column prop="title" label="品名" min-width="140" />
            <el-table-column prop="stock" label="库存" width="70" />
          </el-table>
          <p v-else class="t-sub">暂无绑定藏品。可在藏品档案库填写标本师 ID。</p>
        </div>

        <div class="detail-actions">
          <el-button type="primary" color="#d4af37" @click="openFramerDialog(current)">编辑档案</el-button>
        </div>
      </template>
    </el-drawer>

    <!-- 编辑 / 新建 -->
    <el-dialog
      v-model="framerDialog.visible"
      :title="framerDialog.isEdit ? '编辑标本师档案' : '签约新标本师'"
      width="720px"
      destroy-on-close
      top="6vh"
    >
      <el-form :model="framerForm" label-width="108px" size="small">
        <el-divider content-position="left">基础身份</el-divider>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="姓名" required>
              <el-input v-model="framerForm.name" placeholder="真名或对外署名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="艺名">
              <el-input v-model="framerForm.alias" placeholder="可选" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="头衔">
              <el-input v-model="framerForm.title" placeholder="如：首席标本制作师" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="类型">
              <el-radio-group v-model="framerForm.type">
                <el-radio label="store">门店标本师</el-radio>
                <el-radio label="partner">特邀合作</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="常驻城市">
              <el-input v-model="framerForm.city" placeholder="如：长春" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="从业年限">
              <el-input-number v-model="framerForm.yearsExperience" :min="0" :max="60" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="入驻日期">
          <el-date-picker v-model="framerForm.joinedAt" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>

        <el-divider content-position="left">照片</el-divider>
        <el-form-item label="头像">
          <div class="upload-row">
            <el-avatar :size="72" :src="framerForm.avatarPreview">
              {{ (framerForm.name || '?').charAt(0) }}
            </el-avatar>
            <el-upload
              accept="image/*"
              :show-file-list="false"
              :http-request="(opt) => uploadImage(opt, 'avatar')"
            >
              <el-button :icon="Picture" :loading="uploading">上传头像</el-button>
            </el-upload>
          </div>
        </el-form-item>
        <el-form-item label="封面图">
          <div class="upload-row">
            <el-image
              v-if="framerForm.coverPreview"
              :src="framerForm.coverPreview"
              fit="cover"
              class="cover-preview"
            />
            <el-upload
              accept="image/*"
              :show-file-list="false"
              :http-request="(opt) => uploadImage(opt, 'cover')"
            >
              <el-button :icon="Picture" :loading="uploading">上传封面</el-button>
            </el-upload>
          </div>
          <div class="form-hint">用于小程序个人主页背景；不传则沿用默认 Banner。</div>
        </el-form-item>
        <el-form-item label="作品照片">
          <el-upload
            accept="image/*"
            list-type="picture-card"
            :file-list="galleryFileList"
            :http-request="uploadGallery"
            :on-remove="removeGallery"
            :limit="9"
          >
            <el-icon><Plus /></el-icon>
          </el-upload>
        </el-form-item>

        <el-divider content-position="left">对外介绍</el-divider>
        <el-form-item label="擅长领域">
          <el-select
            v-model="framerForm.tagList"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入后回车"
            style="width: 100%"
          >
            <el-option v-for="t in TAG_OPTIONS" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="技法/风格">
          <el-input v-model="framerForm.signatureStyle" placeholder="如：干制展翅、浸液封存、微距构图" />
        </el-form-item>
        <el-form-item label="学习经历">
          <el-input v-model="framerForm.education" placeholder="院校 / 师承 / 工作坊" />
        </el-form-item>
        <el-form-item label="一句理念">
          <el-input v-model="framerForm.quote" placeholder="展示在档案页的短句" maxlength="80" show-word-limit />
        </el-form-item>
        <el-form-item label="个人简介">
          <el-input v-model="framerForm.bio" type="textarea" :rows="4" placeholder="同步小程序名师页与定制选师" />
        </el-form-item>

        <el-divider content-position="left">定制与展示</el-divider>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="定制加价">
              <el-input-number v-model="framerForm.priceDelta" :min="0" :step="10" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="额外交期">
              <el-input-number v-model="framerForm.extraDays" :min="0" :max="60" />
              <span class="unit">天</span>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="排序权重">
              <el-input-number v-model="framerForm.sort" :min="0" :max="999" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="小程序展示">
          <el-switch v-model="framerForm.active" active-text="展示" inactive-text="隐藏" />
        </el-form-item>
        <el-form-item label="内部备注">
          <el-input v-model="framerForm.note" type="textarea" :rows="2" placeholder="仅后台可见" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="framerDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveFramer">确认保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { Plus, Edit, Delete, Search, View, Picture } from '@element-plus/icons-vue'
import UnifiedEmployeePanel from './UnifiedEmployeePanel.vue'
import {
  fetchCollectionSorted,
  cdnAdd,
  cdnUpdate,
  cdnRemove,
  uploadAdminBinary,
  getTempFileUrl,
} from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'

const TAG_OPTIONS = ['昆虫', '蝴蝶', '植物封存', '浸液', '干制', '矿物', '海洋', '装裱', '微距摄影', '定制礼盒']

const emptyForm = () => ({
  _id: null,
  name: '',
  alias: '',
  title: '',
  type: 'store',
  bio: '',
  avatar: '',
  avatarPreview: '',
  cover: '',
  coverPreview: '',
  gallery: [],
  galleryPreviews: [],
  tagList: [],
  priceDelta: 0,
  extraDays: 0,
  sort: 100,
  active: true,
  city: '',
  yearsExperience: 0,
  quote: '',
  education: '',
  signatureStyle: '',
  note: '',
  joinedAt: '',
})

const props = defineProps({
  initialSection: {
    type: String,
    default: 'framer',
    validator: (v) => v === 'framer' || v === 'staff',
  },
})

const section = computed(() => props.initialSection)
const pageTitle = computed(() =>
  section.value === 'framer' ? '标本师管理' : '员工花名册'
)
const pageSubtitle = computed(() =>
  section.value === 'framer'
    ? '已注册标本师档案 · 上传照片与个性化字段同步小程序「名师」与定制选师'
    : '总部职能与门店店员主数据 · 与薪酬、店铺员工联动'
)

const loading = ref(false)
const saving = ref(false)
const uploading = ref(false)
const loadHint = ref('')
const keyword = ref('')
const statusFilter = ref('all')
const typeFilter = ref('all')
const viewMode = ref('card')
const framerList = ref([])
const detailOpen = ref(false)
const current = ref(null)
const linkedWorks = ref([])
const framerDialog = reactive({ visible: false, isEdit: false })
const framerForm = reactive(emptyForm())

const typeLabel = (t) => (t === 'partner' ? '特邀合作' : '门店标本师')

const activeCount = computed(() => framerList.value.filter((f) => f.active !== false).length)
const storeCount = computed(() => framerList.value.filter((f) => (f.type || 'store') === 'store').length)
const partnerCount = computed(() => framerList.value.filter((f) => f.type === 'partner').length)

const filteredList = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return framerList.value.filter((f) => {
    if (statusFilter.value === 'active' && f.active === false) return false
    if (statusFilter.value === 'hidden' && f.active !== false) return false
    if (typeFilter.value !== 'all' && (f.type || 'store') !== typeFilter.value) return false
    if (!q) return true
    const blob = [f.name, f.alias, f.title, f.city, ...(f.tags || [])].join(' ').toLowerCase()
    return blob.includes(q)
  })
})

const galleryFileList = computed(() =>
  (framerForm.gallery || []).map((fileID, i) => ({
    name: `gallery-${i}`,
    url: framerForm.galleryPreviews[i] || fileID,
    fileID,
  }))
)

const resolveUrl = async (path) => {
  if (!path) return ''
  try {
    return await getTempFileUrl(path)
  } catch {
    return path
  }
}

const fetchFramers = async () => {
  loading.value = true
  loadHint.value = ''
  try {
    const rows = await fetchCollectionSorted('framers', {
      limit: 200,
      throwOnError: true,
      sortFn: (a, b) => (b.sort ?? 0) - (a.sort ?? 0) || (b.createTime || 0) - (a.createTime || 0),
    })
    framerList.value = await Promise.all(
      rows.map(async (i) => {
        const gallery = Array.isArray(i.gallery) ? i.gallery : []
        return {
          ...i,
          tags: i.tags || [],
          type: i.type || 'store',
          active: i.active !== false,
          priceDelta: Number(i.priceDelta) || 0,
          extraDays: Number(i.extraDays) || 0,
          gallery,
          httpAvatar: await resolveUrl(i.avatar),
          httpCover: await resolveUrl(i.cover),
          httpGallery: (await Promise.all(gallery.map(resolveUrl))).filter(Boolean),
        }
      })
    )
  } catch (e) {
    console.error('加载名师手作失败', e)
    framerList.value = []
    loadHint.value = '加载 framers 失败，请检查集合权限与云连接。'
  } finally {
    loading.value = false
  }
}

const openDetail = async (row) => {
  current.value = row
  detailOpen.value = true
  linkedWorks.value = []
  try {
    const products = await fetchCollectionSorted('products', {
      limit: 200,
      throwOnError: false,
    })
    linkedWorks.value = (products || []).filter((p) => p.framerId === row._id).slice(0, 20)
  } catch {
    linkedWorks.value = []
  }
}

const openFramerDialog = (row = null) => {
  framerDialog.isEdit = !!row
  Object.assign(framerForm, emptyForm())
  if (row) {
    Object.assign(framerForm, {
      _id: row._id,
      name: row.name || '',
      alias: row.alias || '',
      title: row.title || '',
      type: row.type || 'store',
      bio: row.bio || row.desc || '',
      avatar: row.avatar || '',
      avatarPreview: row.httpAvatar || '',
      cover: row.cover || '',
      coverPreview: row.httpCover || '',
      gallery: Array.isArray(row.gallery) ? [...row.gallery] : [],
      galleryPreviews: Array.isArray(row.httpGallery) ? [...row.httpGallery] : [],
      tagList: [...(row.tags || [])],
      priceDelta: Number(row.priceDelta) || 0,
      extraDays: Number(row.extraDays) || 0,
      sort: row.sort ?? 100,
      active: row.active !== false,
      city: row.city || '',
      yearsExperience: row.yearsExperience ?? 0,
      quote: row.quote || '',
      education: row.education || '',
      signatureStyle: row.signatureStyle || '',
      note: row.note || '',
      joinedAt: row.joinedAt || '',
    })
  }
  detailOpen.value = false
  framerDialog.visible = true
}

const uploadImage = async (opt, field) => {
  uploading.value = true
  try {
    const fileID = await uploadAdminBinary(opt.file, 'framers')
    const preview = await resolveUrl(fileID)
    framerForm[field] = fileID
    framerForm[`${field}Preview`] = preview
    opt.onSuccess?.({}, opt.file)
    ElMessage.success('已上传')
  } catch (e) {
    opt.onError?.(e)
    ElMessage.error('上传失败：' + (e.message || '请检查云存储权限'))
  } finally {
    uploading.value = false
  }
}

const uploadGallery = async (opt) => {
  try {
    const fileID = await uploadAdminBinary(opt.file, 'framers')
    const preview = await resolveUrl(fileID)
    framerForm.gallery = [...framerForm.gallery, fileID]
    framerForm.galleryPreviews = [...framerForm.galleryPreviews, preview]
    opt.onSuccess?.({}, opt.file)
  } catch (e) {
    opt.onError?.(e)
    ElMessage.error('作品图上传失败')
  }
}

const removeGallery = (file) => {
  const idx = galleryFileList.value.findIndex((x) => x.url === file.url || x.fileID === file.fileID)
  if (idx < 0) return
  framerForm.gallery.splice(idx, 1)
  framerForm.galleryPreviews.splice(idx, 1)
}

const saveFramer = async () => {
  if (!framerForm.name?.trim()) return ElMessage.warning('姓名必填')
  saving.value = true
  try {
    const bio = (framerForm.bio || '').trim()
    const data = {
      name: framerForm.name.trim(),
      alias: (framerForm.alias || '').trim(),
      title: (framerForm.title || '').trim(),
      type: framerForm.type === 'partner' ? 'partner' : 'store',
      bio,
      desc: bio,
      avatar: framerForm.avatar || '',
      cover: framerForm.cover || '',
      gallery: framerForm.gallery || [],
      tags: framerForm.tagList || [],
      priceDelta: Number(framerForm.priceDelta) || 0,
      extraDays: parseInt(framerForm.extraDays, 10) || 0,
      sort: Number(framerForm.sort) || 0,
      active: !!framerForm.active,
      city: (framerForm.city || '').trim(),
      yearsExperience: Number(framerForm.yearsExperience) || 0,
      quote: (framerForm.quote || '').trim(),
      education: (framerForm.education || '').trim(),
      signatureStyle: (framerForm.signatureStyle || '').trim(),
      note: (framerForm.note || '').trim(),
      joinedAt: framerForm.joinedAt || '',
      updatedAt: Date.now(),
    }

    if (framerDialog.isEdit) {
      await cdnUpdate('framers', framerForm._id, data)
    } else {
      await cdnAdd('framers', { ...data, createTime: Date.now() })
    }
    ElMessage.success('档案已保存')
    framerDialog.visible = false
    await fetchFramers()
  } catch (e) {
    console.error('保存失败', e)
    ElMessage.error('保存失败: ' + (e.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

const deleteFramer = (row) => {
  ElMessageBox.confirm(`确定解约并删除「${row.name}」的档案吗？此操作不可恢复。`, '解约', {
    type: 'warning',
  }).then(async () => {
    try {
      await cdnRemove('framers', row._id)
      ElMessage.success('已删除')
      detailOpen.value = false
      fetchFramers()
    } catch (e) {
      console.error('删除失败', e)
      ElMessage.error('删除失败')
    }
  }).catch(() => {})
}

const toggleFramerStatus = async (row) => {
  try {
    await cdnUpdate('framers', row._id, { active: !!row.active, updatedAt: Date.now() })
  } catch (e) {
    console.error('状态更新失败', e)
    row.active = !row.active
    ElMessage.error('状态更新失败')
  }
}

onMounted(() => {
  if (props.initialSection === 'framer') fetchFramers()
})
</script>

<style scoped>
.team-container { height: 100%; display: flex; flex-direction: column; }
.panel-header { margin-bottom: 20px; }
.panel-header-text { display: flex; flex-direction: column; gap: 6px; }
.panel-header h2 { margin: 0; color: #333; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
.panel-sub { margin: 0; color: #888; font-size: 13px; line-height: 1.5; max-width: 52rem; }

.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.stat-card {
  background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 14px 16px;
}
.stat-num { font-size: 22px; font-weight: 700; color: #2c2c2c; }
.stat-label { font-size: 12px; color: #999; margin-top: 4px; }

.action-bar {
  display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
  background: #fff; padding: 12px 15px; border-radius: 8px; margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.03);
}
.filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.tip { color: #999; font-size: 13px; }

.framer-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px; }

.framer-card {
  background: #fff; border-radius: 12px; overflow: hidden; position: relative;
  border: 1px solid #eee; transition: all 0.3s;
  display: flex; flex-direction: column; cursor: pointer;
}
.framer-card:hover { transform: translateY(-5px); box-shadow: 0 10px 30px rgba(0,0,0,0.1); border-color: #d4af37; }

.card-status { position: absolute; top: 10px; right: 10px; z-index: 2; }
.card-visual {
  height: 148px; background: linear-gradient(135deg, #2b2b2b, #1a1a1a);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: #fff; padding-top: 20px;
}
.avatar-box { border: 3px solid #d4af37; font-size: 24px; background: #333; font-weight: bold; margin-bottom: 10px; }
.f-name { font-size: 18px; font-weight: bold; letter-spacing: 1px; }
.f-title { font-size: 12px; color: #d4af37; margin-top: 2px; }

.card-content { padding: 15px; flex: 1; }
.f-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
.tag-item { font-size: 10px; background: #f5f5f5; padding: 2px 6px; border-radius: 4px; color: #666; }
.type-tag { background: #faf6eb; color: #8b6914; }
.f-desc { font-size: 12px; color: #888; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.card-footer {
  padding: 10px 15px; border-top: 1px solid #f5f5f5; background: #fafafa;
  display: flex; justify-content: space-between; align-items: center;
}

.add-placeholder {
  border: 2px dashed #ddd; background: transparent; display: flex; align-items: center; justify-content: center;
  flex-direction: column; color: #aaa; cursor: pointer; min-height: 280px;
}
.add-placeholder:hover { border-color: #d4af37; color: #d4af37; background: rgba(212, 175, 55, 0.05); }
.add-placeholder span { margin-top: 10px; font-size: 14px; }

.table-name { display: flex; align-items: center; gap: 10px; }
.t-main { font-weight: 600; }
.t-sub { font-size: 12px; color: #999; }

.detail-hero { display: flex; gap: 16px; align-items: center; margin-bottom: 16px; }
.detail-hero h3 { margin: 0 0 4px; font-size: 20px; }
.detail-hero p { margin: 0 0 8px; color: #888; font-size: 13px; }
.detail-desc { margin-bottom: 16px; }
.seg { font-size: 12px; color: #999; margin: 12px 0 8px; letter-spacing: 1px; }
.gallery-row { display: flex; flex-wrap: wrap; gap: 8px; }
.gal-img { width: 88px; height: 88px; border-radius: 8px; }
.detail-actions { margin-top: 20px; }

.upload-row { display: flex; align-items: center; gap: 12px; }
.cover-preview { width: 160px; height: 72px; border-radius: 8px; }
.form-hint { font-size: 12px; color: #999; margin-top: 4px; }
.unit { margin-left: 6px; color: #999; font-size: 12px; }

@media (max-width: 720px) {
  .stat-row { grid-template-columns: repeat(2, 1fr); }
}
</style>
