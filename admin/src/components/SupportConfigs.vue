<template>
  <div class="support-cfg-container">
    <div class="panel-header">
      <div class="title-box">
        <h2>客服入口配置 / SUPPORT</h2>
        <span class="subtitle">SUPPORT · 小程序「联系专员」页配置</span>
      </div>
      <div class="header-actions">
        <el-button @click="seedDefault" :loading="seeding">写入默认配置</el-button>
        <el-button type="primary" color="#2D6A4F" :icon="Plus" @click="openDialog()">新建配置</el-button>
        <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
      </div>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="hint-alert"
      title="小程序读取 status=active 且 priority 最高的一条；字段覆盖云函数默认值。未配置时 C 端自动回退内置默认。"
    />

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      class="hint-alert"
      :title="loadError"
      description="请确认 support_configs 已 provision；权限不足时勿与「暂无配置」混淆。"
    />

    <el-skeleton v-if="loading && !list.length && !loadError" :rows="6" animated />
    <template v-else>
    <el-table :data="list" v-loading="loading" stripe empty-text="暂无客服配置">
      <el-table-column label="优先级" width="88" prop="priority" />
      <el-table-column label="名称" min-width="160">
        <template #default="{ row }">
          <div class="name">{{ row.name || '客服入口' }}</div>
          <div class="sub">{{ row._id?.slice(0, 10) }}…</div>
        </template>
      </el-table-column>
      <el-table-column label="客服电话" width="140">
        <template #default="{ row }">{{ row.config?.phone || '-' }}</template>
      </el-table-column>
      <el-table-column label="营业时间" width="140">
        <template #default="{ row }">{{ row.config?.hours || '-' }}</template>
      </el-table-column>
      <el-table-column label="FAQ" width="72" align="center">
        <template #default="{ row }">{{ (row.config?.faqs || []).length }}</template>
      </el-table-column>
      <el-table-column label="主题" width="72" align="center">
        <template #default="{ row }">{{ (row.config?.topics || []).length }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-switch
            :model-value="row.status === 'active'"
            active-color="#2D6A4F"
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
      description="尚无配置。可「写入默认配置」一键落地，或新建后编辑 FAQ / 主题。"
    />
    </template>

    <el-dialog
      v-model="dialogVisible"
      :title="form._id ? '编辑客服配置' : '新建客服配置'"
      width="820px"
      destroy-on-close
      top="4vh"
    >
      <el-form :model="form" label-width="110px">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="如：主店客服入口" maxlength="40" show-word-limit />
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="form.priority" :min="0" :max="999" />
          <span class="form-hint-inline">数值越大优先被读取</span>
        </el-form-item>
        <el-form-item label="客服电话" required>
          <el-input v-model="form.phone" placeholder="客服热线，如 19917242871" maxlength="20" />
          <div class="form-hint-block">C 端「联系专员」与标本师招募拨号读取此号；与门店电话（门店前台配置）相互独立。</div>
        </el-form-item>
        <el-form-item label="营业时间">
          <el-input v-model="form.hours" placeholder="10:00 - 22:00" />
        </el-form-item>
        <el-form-item label="响应提示">
          <el-input v-model="form.responseHint" type="textarea" :rows="2" maxlength="120" show-word-limit />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.address" type="textarea" :rows="2" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="纬度">
              <el-input-number v-model="form.latitude" :precision="6" :step="0.0001" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="经度">
              <el-input-number v-model="form.longitude" :precision="6" :step="0.0001" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="社群二维码">
          <ImageUploadField
            v-model="form.communityQr"
            folder="qrcode"
            tip="优先上传社群二维码图；也可粘贴 cloud:// 或 HTTPS"
            preview-width="120px"
            preview-height="120px"
            :max-size-mb="3"
          />
        </el-form-item>

        <el-divider content-position="left">咨询主题</el-divider>
        <div class="row-editor">
          <div class="row-editor-bar">
            <span class="row-editor-tip">小程序联系专员页的主题列表（id 用于埋点与跳转上下文）</span>
            <el-button size="small" :icon="Plus" @click="addTopic">添加主题</el-button>
          </div>
          <div v-for="(t, idx) in form.topics" :key="'t-' + idx" class="row-card">
            <div class="row-card-head">
              <span class="row-idx">#{{ idx + 1 }}</span>
              <div class="row-card-actions">
                <el-button size="small" link :disabled="idx === 0" @click="moveTopic(idx, -1)">上移</el-button>
                <el-button size="small" link :disabled="idx === form.topics.length - 1" @click="moveTopic(idx, 1)">下移</el-button>
                <el-button size="small" type="danger" link @click="removeTopic(idx)">删除</el-button>
              </div>
            </div>
            <el-row :gutter="10">
              <el-col :span="8">
                <el-input v-model="t.id" placeholder="id（如 order）" />
              </el-col>
              <el-col :span="8">
                <el-input v-model="t.label" placeholder="显示名" />
              </el-col>
              <el-col :span="8">
                <div class="icon-field">
                  <span class="icon-preview" :title="t.icon">{{ iconEmoji(t.icon) }}</span>
                  <el-select
                    v-model="t.icon"
                    filterable
                    allow-create
                    default-first-option
                    placeholder="选择或输入路径"
                    style="flex: 1"
                  >
                    <el-option
                      v-for="opt in TOPIC_ICON_PRESETS"
                      :key="opt.path"
                      :label="`${opt.emoji} ${opt.label}`"
                      :value="opt.path"
                    >
                      <span class="icon-opt">
                        <span class="icon-opt-emoji">{{ opt.emoji }}</span>
                        <span>{{ opt.label }}</span>
                        <span class="icon-opt-path">{{ opt.path }}</span>
                      </span>
                    </el-option>
                  </el-select>
                </div>
              </el-col>
            </el-row>
            <el-input v-model="t.desc" placeholder="简述" style="margin-top: 8px" />
          </div>
          <el-empty v-if="!form.topics.length" description="暂无主题，点击添加" :image-size="56" />
        </div>

        <el-divider content-position="left">常见问题 FAQ</el-divider>
        <div class="row-editor">
          <div class="row-editor-bar">
            <span class="row-editor-tip">折叠展示在联系专员页</span>
            <el-button size="small" :icon="Plus" @click="addFaq">添加 FAQ</el-button>
          </div>
          <div v-for="(f, idx) in form.faqs" :key="'f-' + idx" class="row-card">
            <div class="row-card-head">
              <span class="row-idx">#{{ idx + 1 }}</span>
              <div class="row-card-actions">
                <el-button size="small" link :disabled="idx === 0" @click="moveFaq(idx, -1)">上移</el-button>
                <el-button size="small" link :disabled="idx === form.faqs.length - 1" @click="moveFaq(idx, 1)">下移</el-button>
                <el-button size="small" type="danger" link @click="removeFaq(idx)">删除</el-button>
              </div>
            </div>
            <el-input v-model="f.q" placeholder="问题" style="margin-bottom: 8px" />
            <el-input v-model="f.a" type="textarea" :rows="2" placeholder="回答" />
          </div>
          <el-empty v-if="!form.faqs.length" description="暂无 FAQ，点击添加" :image-size="56" />
        </div>

        <el-form-item label="状态" style="margin-top: 12px">
          <el-switch v-model="form.statusActive" active-text="active" inactive-text="inactive" active-color="#2D6A4F" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" color="#2D6A4F" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { fetchCollectionSorted, cdnAdd, cdnUpdate, cdnRemove } from '../cloud'
import { ElMessage, ElMessageBox } from 'element-plus'
import ImageUploadField from './ImageUploadField.vue'

/** 小程序 assets/icons 常用主题图标（路径写入云端；Admin 用 emoji 预览） */
const TOPIC_ICON_PRESETS = [
  { path: '/assets/icons/cart.png', label: '购物车', emoji: '🛒' },
  { path: '/assets/icons/booking.png', label: '预约', emoji: '📅' },
  { path: '/assets/icons/knowledge.png', label: '知识/藏品', emoji: '📖' },
  { path: '/assets/icons/camera.png', label: '相机/鉴定', emoji: '📷' },
  { path: '/assets/icons/discount.png', label: '优惠/退款', emoji: '🏷' },
  { path: '/assets/icons/message.png', label: '消息', emoji: '💬' },
  { path: '/assets/icons/service.png', label: '客服', emoji: '🎧' },
  { path: '/assets/icons/phone.png', label: '电话', emoji: '📞' },
  { path: '/assets/icons/gift.png', label: '礼品', emoji: '🎁' },
  { path: '/assets/icons/heart.png', label: '心愿', emoji: '❤️' },
  { path: '/assets/icons/star.png', label: '星标', emoji: '⭐' },
  { path: '/assets/icons/store.png', label: '门店', emoji: '🏪' },
  { path: '/assets/icons/ticket.png', label: '工单', emoji: '🎫' },
  { path: '/assets/icons/refund.png', label: '退款', emoji: '↩️' },
  { path: '/assets/icons/feedback.png', label: '反馈', emoji: '📝' },
  { path: '/assets/icons/box.png', label: '包裹', emoji: '📦' },
  { path: '/assets/icons/group.png', label: '拼团/社群', emoji: '👥' },
  { path: '/assets/icons/location.png', label: '定位', emoji: '📍' }
]

const iconEmoji = (path) => {
  const hit = TOPIC_ICON_PRESETS.find((p) => p.path === path)
  return hit?.emoji || '🖼'
}

const DEFAULT_CONFIG = {
  phone: '19917242871',
  hours: '10:00 - 22:00',
  responseHint: '专员通常在工作时间内 30 分钟内回复',
  address: '吉林省长春市朝阳区红旗街959号这有山商场山坡X-06-1',
  latitude: 43.86661,
  longitude: 125.29306,
  communityQr: 'cloud://cloud1-8gnkty5bfff9f0bf.636c-cloud1-8gnkty5bfff9f0bf-1387508856/qrcode/community-qrcode.jpg',
  topics: [
    { id: 'order', label: '订单咨询', desc: '支付、物流、售后', icon: '/assets/icons/cart.png' },
    { id: 'booking', label: '预约改期', desc: '到店预约与变更', icon: '/assets/icons/booking.png' },
    { id: 'product', label: '藏品鉴赏', desc: '选品与规格咨询', icon: '/assets/icons/knowledge.png' },
    { id: 'custom', label: '标本定制', desc: '标品工坊与伴宠记忆', icon: '/assets/icons/knowledge.png' },
    { id: 'specimen_care', label: '标本养护', desc: '安放、清洁与异常咨询', icon: '/assets/icons/knowledge.png' },
    { id: 'pet_memorial', label: '伴宠记忆', desc: '宠物标本制作意向', icon: '/assets/icons/heart.png' },
    { id: 'identify', label: '鉴定疑问', desc: 'AI 鉴定结果咨询', icon: '/assets/icons/camera.png' },
    { id: 'refund', label: '售后退款', desc: '退款进度与凭证', icon: '/assets/icons/refund.png' },
    { id: 'feedback', label: '反馈与建议', desc: '功能体验与内容建议', icon: '/assets/icons/feedback.png' },
    { id: 'other', label: '其他问题', desc: '品牌与合作等', icon: '/assets/icons/message.png' }
  ],
  faqs: [
    { q: '订单支付后多久发货？', a: '现货订单通常在 1-3 个工作日内发出。定制或装裱类藏品以商详页说明为准，专员会在发货前通过山海有信通知您。' },
    { q: '如何修改或取消预约？', a: '进入「预约」→「我的预约」，在预约详情中查看是否支持改期或取消。若页面无入口，请选择「预约改期」联系专员协助处理。' },
    { q: '退款多久到账？', a: '退款申请审核通过后，微信支付的款项一般 1-7 个工作日原路退回，具体以支付渠道为准。' },
    { q: '会员等级如何提升？', a: '在门店消费、完成预约参观、收藏与分享等行为均可获得成长值。进入「我的」可查看当前等级与下一级门槛。' },
    { q: '企业团购如何询价？', a: '在「标本工坊」完成方案选配后，于预览页选择「企业团购意向」提交（10 件起）。专员会在 1-2 个工作日内联系报价，无需立即支付。' },
    { q: 'AI 鉴定结果准确吗？', a: 'AI 鉴定仅供参考。若对结果有疑问，可选择「鉴定疑问」联系专员，或携带实物到店由标本师进一步确认。' }
  ]
}

const list = ref([])
const loading = ref(false)
const loadError = ref('')
const seeding = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const form = ref(emptyForm())

function cloneTopics(arr) {
  return (arr || []).map((t) => ({
    id: t.id || '',
    label: t.label || '',
    desc: t.desc || '',
    icon: t.icon || '/assets/icons/message.png'
  }))
}

function cloneFaqs(arr) {
  return (arr || []).map((f) => ({ q: f.q || '', a: f.a || '' }))
}

function emptyForm() {
  return {
    _id: '',
    name: '主店客服入口',
    priority: 10,
    phone: DEFAULT_CONFIG.phone,
    hours: DEFAULT_CONFIG.hours,
    responseHint: DEFAULT_CONFIG.responseHint,
    address: DEFAULT_CONFIG.address,
    latitude: DEFAULT_CONFIG.latitude,
    longitude: DEFAULT_CONFIG.longitude,
    communityQr: DEFAULT_CONFIG.communityQr,
    topics: cloneTopics(DEFAULT_CONFIG.topics),
    faqs: cloneFaqs(DEFAULT_CONFIG.faqs),
    statusActive: true
  }
}

const addTopic = () => {
  form.value.topics.push({ id: '', label: '', desc: '', icon: '/assets/icons/message.png' })
}
const removeTopic = (idx) => { form.value.topics.splice(idx, 1) }
const moveTopic = (idx, delta) => {
  const arr = form.value.topics
  const j = idx + delta
  if (j < 0 || j >= arr.length) return
  ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
}

const addFaq = () => { form.value.faqs.push({ q: '', a: '' }) }
const removeFaq = (idx) => { form.value.faqs.splice(idx, 1) }
const moveFaq = (idx, delta) => {
  const arr = form.value.faqs
  const j = idx + delta
  if (j < 0 || j >= arr.length) return
  ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
}

const refresh = async () => {
  loading.value = true
  loadError.value = ''
  try {
    list.value = await fetchCollectionSorted('support_configs', {
      limit: 50,
      throwOnError: true,
      sortFn: (a, b) => (b.priority || 0) - (a.priority || 0)
        || (b.updateTime || 0) - (a.updateTime || 0)
    })
  } catch (e) {
    list.value = []
    loadError.value = '加载失败：' + (e.message || e)
    ElMessage.error(loadError.value)
  } finally {
    loading.value = false
  }
}

const openDialog = (row) => {
  if (row) {
    const cfg = row.config || {}
    form.value = {
      _id: row._id,
      name: row.name || '客服入口',
      priority: row.priority ?? 10,
      phone: cfg.phone || '',
      hours: cfg.hours || '',
      responseHint: cfg.responseHint || '',
      address: cfg.address || '',
      latitude: cfg.latitude ?? null,
      longitude: cfg.longitude ?? null,
      communityQr: cfg.communityQr || '',
      topics: cloneTopics(cfg.topics?.length ? cfg.topics : []),
      faqs: cloneFaqs(cfg.faqs?.length ? cfg.faqs : []),
      statusActive: row.status !== 'inactive'
    }
  } else {
    form.value = emptyForm()
  }
  dialogVisible.value = true
}

const validateForm = () => {
  const f = form.value
  if (!f.phone?.trim()) {
    ElMessage.warning('客服电话必填')
    return false
  }
  if (!/^[\d+\-\s]{6,20}$/.test(f.phone.trim())) {
    ElMessage.warning('客服电话格式不正确（仅数字、空格、+、-）')
    return false
  }
  const topics = f.topics || []
  for (let i = 0; i < topics.length; i++) {
    const t = topics[i]
    if (!t.id?.trim() || !t.label?.trim()) {
      ElMessage.warning(`主题 #${i + 1}：id 与显示名必填`)
      return false
    }
  }
  const ids = topics.map((t) => t.id.trim())
  if (new Set(ids).size !== ids.length) {
    ElMessage.warning('主题 id 不可重复')
    return false
  }
  const faqs = f.faqs || []
  for (let i = 0; i < faqs.length; i++) {
    const item = faqs[i]
    if (!item.q?.trim() || !item.a?.trim()) {
      ElMessage.warning(`FAQ #${i + 1}：问题与回答必填`)
      return false
    }
  }
  return true
}

const save = async () => {
  if (!validateForm()) return
  const f = form.value
  const payload = {
    name: (f.name || '客服入口').trim(),
    priority: f.priority ?? 10,
    status: f.statusActive ? 'active' : 'inactive',
    config: {
      phone: f.phone.trim(),
      hours: f.hours || '',
      responseHint: f.responseHint || '',
      address: f.address || '',
      latitude: f.latitude,
      longitude: f.longitude,
      communityQr: f.communityQr || '',
      topics: (f.topics || []).map((t) => ({
        id: t.id.trim(),
        label: t.label.trim(),
        desc: (t.desc || '').trim(),
        icon: (t.icon || '').trim() || '/assets/icons/message.png'
      })),
      faqs: (f.faqs || []).map((item) => ({
        q: item.q.trim(),
        a: item.a.trim()
      }))
    },
    updateTime: Date.now()
  }

  saving.value = true
  try {
    if (f._id) {
      await cdnUpdate('support_configs', f._id, payload)
    } else {
      payload.createTime = Date.now()
      await cdnAdd('support_configs', payload)
    }
    ElMessage.success('已保存')
    dialogVisible.value = false
    refresh()
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || e))
  } finally {
    saving.value = false
  }
}

const toggleStatus = async (row, active) => {
  try {
    await cdnUpdate('support_configs', row._id, {
      status: active ? 'active' : 'inactive',
      updateTime: Date.now()
    })
    row.status = active ? 'active' : 'inactive'
    ElMessage.success(active ? '已启用' : '已停用')
  } catch {
    ElMessage.error('更新状态失败')
  }
}

const remove = (row) => {
  ElMessageBox.confirm(`删除「${row.name || '客服配置'}」？`, '确认删除', { type: 'warning' }).then(async () => {
    try {
      await cdnRemove('support_configs', row._id)
      ElMessage.success('已删除')
      refresh()
    } catch (e) {
      ElMessage.error('删除失败：' + (e.message || e))
    }
  }).catch(() => {})
}

const writeDefaultDoc = async () => {
  await cdnAdd('support_configs', {
    name: '默认客服入口',
    priority: 10,
    status: 'active',
    config: {
      ...DEFAULT_CONFIG,
      topics: cloneTopics(DEFAULT_CONFIG.topics),
      faqs: cloneFaqs(DEFAULT_CONFIG.faqs)
    },
    createTime: Date.now(),
    updateTime: Date.now()
  })
  ElMessage.success('已写入默认配置')
  refresh()
}

const seedDefault = async () => {
  seeding.value = true
  try {
    const existing = await fetchCollectionSorted('support_configs', { limit: 20 })
    if (existing.length) {
      await ElMessageBox.confirm(
        '已有配置记录。继续将再新增一条默认配置（priority=10、active）。是否继续？',
        '写入默认配置',
        { type: 'info' }
      )
    }
    await writeDefaultDoc()
  } catch (e) {
    if (e === 'cancel' || e?.toString?.().includes('cancel')) return
    ElMessage.error('写入失败：' + (e.message || e))
  } finally {
    seeding.value = false
  }
}

onMounted(refresh)
</script>

<style scoped>
.support-cfg-container { padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 12px; flex-wrap: wrap; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #2D6A4F; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 1px; }
.header-actions { display: flex; gap: 8px; align-items: center; }
.hint-alert { margin-bottom: 14px; }
.name { font-weight: 600; color: #333; }
.sub { font-size: 11px; color: #999; font-family: monospace; margin-top: 2px; }
.form-hint-inline { margin-left: 10px; font-size: 12px; color: #999; }
.form-hint-block { margin-top: 6px; font-size: 12px; color: #999; line-height: 1.5; }
.row-editor { margin: 0 0 8px 0; padding: 0 0 0 12px; }
.row-editor-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 8px; flex-wrap: wrap; }
.row-editor-tip { font-size: 12px; color: #888; }
.row-card {
  border: 1px solid #e8ebe6;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
  background: #fafbf9;
}
.row-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.row-idx { font-size: 12px; font-weight: 700; color: #2D6A4F; }
.row-card-actions { display: flex; gap: 2px; }
.icon-field { display: flex; align-items: center; gap: 8px; width: 100%; }
.icon-preview {
  width: 32px; height: 32px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff; border: 1px solid #e8ebe6; border-radius: 8px; font-size: 16px;
}
.icon-opt { display: flex; align-items: center; gap: 8px; width: 100%; }
.icon-opt-emoji { width: 22px; text-align: center; }
.icon-opt-path { margin-left: auto; font-size: 11px; color: #aaa; font-family: monospace; }
</style>
