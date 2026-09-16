<template>
  <div class="content-display-flags">
    <div class="header-section">
      <h2>内容展示开关</h2>
      <p class="subtitle">
        对齐小程序云函数 <code>getContentDisplayFlags</code> · 集合 <code>content_display_flags</code>。
        控制馆藏「标本档案」、我的「山海社区」、预约发起入口等前端区块显隐。
      </p>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="hint-alert"
        title="标本档案 / 山海社区 / 标本定制默认关闭；预约入口、伴宠记忆与 AI 鉴定默认开启。缺配置时小程序按上述默认策略显隐。"
      />
    </div>

    <el-card v-loading="loading" class="flags-card">
      <el-form label-width="200px">
        <el-form-item label="馆藏页 · 标本档案">
          <div class="switch-row">
            <el-switch
              v-model="form.showSpecimenArchive"
              active-text="展示"
              inactive-text="隐藏"
              inline-prompt
            />
            <span class="hint">关闭后馆藏页不渲染「标本档案」横向区，且不请求档案 feed</span>
          </div>
        </el-form-item>

        <el-form-item label="我的页 · 山海社区">
          <div class="switch-row">
            <el-switch
              v-model="form.showUserCommunity"
              active-text="展示"
              inactive-text="隐藏"
              inline-prompt
            />
            <span class="hint">关闭后「我的」馆藏服务列表隐藏「山海社区」入口</span>
          </div>
        </el-form-item>

        <el-form-item label="预约 · 发起入口">
          <div class="switch-row">
            <el-switch
              v-model="form.showBookingEntry"
              active-text="展示"
              inactive-text="隐藏"
              inline-prompt
            />
            <span class="hint">
              关闭后隐藏「我的预约」页发起 CTA，以及「我的」页「预约参观」菜单行；
              「我的预约」列表/票根仍可查看。缺配置默认开启。
            </span>
          </div>
        </el-form-item>

        <el-form-item label="标本工坊 · 标本定制">
          <div class="switch-row">
            <el-switch
              v-model="form.showSpecimenCustom"
              active-text="展示"
              inactive-text="隐藏"
              inline-prompt
            />
            <span class="hint">
              关闭后隐藏工坊「标本定制」、馆藏「定制」Pill、商详「定制」按钮及定制向导入口；
              伴宠记忆由独立开关控制。缺配置默认关闭。
            </span>
          </div>
        </el-form-item>

        <el-form-item label="标本工坊 · 伴宠记忆">
          <div class="switch-row">
            <el-switch
              v-model="form.showPetMemorial"
              active-text="展示"
              inactive-text="隐藏"
              inline-prompt
            />
            <span class="hint">
              关闭后隐藏工坊「伴宠记忆」卡片、首页 chip、伴宠工单入口，并拦截申请页直达。
              缺配置默认开启（现网已开放）。
            </span>
          </div>
        </el-form-item>

        <el-form-item label="我的 · 我的钱包">
          <div class="switch-row">
            <el-switch
              v-model="form.showStoredValue"
              active-text="展示"
              inactive-text="隐藏"
              inline-prompt
            />
            <span class="hint">
              关闭后隐藏「我的」页钱包入口，并拒绝充值。缺配置默认关闭。档位与折扣见「我的钱包」配置页。
            </span>
          </div>
        </el-form-item>

        <el-form-item label="AI · 标本鉴定">
          <div class="switch-row">
            <el-switch
              v-model="form.showAiIdentify"
              active-text="展示"
              inactive-text="隐藏"
              inline-prompt
            />
            <span class="hint">
              关闭后隐藏「我的」鉴定入口、馆藏搜索旁鉴定按钮、图鉴拍照采集入口，并拦截鉴定页直达。
              已有鉴定结果页仍可查看。缺配置默认开启。
            </span>
          </div>
        </el-form-item>

        <el-form-item label="门店 · 到店自取">
          <div class="switch-row">
            <el-switch
              v-model="form.showStorePickup"
              active-text="展示"
              inactive-text="隐藏"
              inline-prompt
            />
            <span class="hint">
              关闭后结算页不再提供「门店自取」交付方式，礼赠定制页移除「门店自提代赠」选项；
              已存在的自取订单仍可在订单详情查看凭证并到店核销（避免存量订单无法取货）。缺配置默认开启。
            </span>
          </div>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="saving" @click="saveFlags">
            保存开关
          </el-button>
          <el-button @click="resetDefaults">恢复默认</el-button>
          <el-button :loading="loading" @click="loadFlags">刷新</el-button>
        </el-form-item>
      </el-form>

      <p v-if="updatedAtText" class="meta">最近更新：{{ updatedAtText }}</p>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import {
  fetchCollectionSorted,
  cdnUpsertSingleton,
  cdnUpdate,
  COLLECTIONS
} from '../cloud'
import { ElMessage } from 'element-plus'

/** 与云函数 getContentDisplayFlags 默认策略对齐 */
const DEFAULT_FLAGS = {
  showSpecimenArchive: false,
  showUserCommunity: false,
  showBookingEntry: true,
  showSpecimenCustom: false,
  showPetMemorial: true,
  showStoredValue: false,
  showAiIdentify: true,
  showStorePickup: true
}

const loading = ref(false)
const saving = ref(false)
const docId = ref('')
const form = reactive({ ...DEFAULT_FLAGS })
const updatedAtText = ref('')

function formatTime(v) {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { hour12: false })
}

function applyFlags(raw = {}, id = '') {
  form.showSpecimenArchive = raw.showSpecimenArchive === true
  form.showUserCommunity = raw.showUserCommunity === true
  form.showBookingEntry = raw.showBookingEntry !== false
  form.showSpecimenCustom = raw.showSpecimenCustom === true
  form.showPetMemorial = raw.showPetMemorial !== false
  form.showStoredValue = raw.showStoredValue === true
  form.showAiIdentify = raw.showAiIdentify !== false
  form.showStorePickup = raw.showStorePickup !== false
  docId.value = id || ''
  updatedAtText.value = formatTime(raw.updateTime || raw._updateTime || raw.updatedAt || null)
}

async function loadFlags() {
  loading.value = true
  try {
    const rows = await fetchCollectionSorted(COLLECTIONS.CONTENT_DISPLAY_FLAGS, {
      limit: 10,
      throwOnError: true,
      sortFn: (a, b) => (b.priority || 0) - (a.priority || 0)
        || (b.updateTime || 0) - (a.updateTime || 0)
    })
    const top = (rows || []).find((r) => r.status !== 'inactive') || null
    if (top) {
      applyFlags(top, top._id)
    } else {
      applyFlags(DEFAULT_FLAGS, '')
      ElMessage.info('尚无配置记录，当前为默认值；保存后写入云库')
    }
  } catch (e) {
    applyFlags(DEFAULT_FLAGS, '')
    ElMessage.warning('加载失败，已回退为默认值：' + (e.message || e))
  } finally {
    loading.value = false
  }
}

function buildPayload() {
  return {
    name: '内容展示开关',
    status: 'active',
    priority: 10,
    showSpecimenArchive: form.showSpecimenArchive === true,
    showUserCommunity: form.showUserCommunity === true,
    showBookingEntry: form.showBookingEntry !== false,
    showSpecimenCustom: form.showSpecimenCustom === true,
    showPetMemorial: form.showPetMemorial !== false,
    showStoredValue: form.showStoredValue === true,
    showAiIdentify: form.showAiIdentify !== false,
    showStorePickup: form.showStorePickup !== false,
    updateTime: Date.now(),
    _updateTime: Date.now()
  }
}

async function saveFlags() {
  saving.value = true
  try {
    const payload = buildPayload()
    if (docId.value) {
      await cdnUpdate(COLLECTIONS.CONTENT_DISPLAY_FLAGS, docId.value, payload)
    } else {
      await cdnUpsertSingleton(COLLECTIONS.CONTENT_DISPLAY_FLAGS, {
        ...payload,
        createTime: Date.now(),
        _createTime: Date.now()
      })
    }
    ElMessage.success('已保存')
    await loadFlags()
  } catch (e) {
    ElMessage.error(
      '保存失败：' + (e.message || e) + '（请确认已 provision 集合 content_display_flags）'
    )
  } finally {
    saving.value = false
  }
}

function resetDefaults() {
  form.showSpecimenArchive = DEFAULT_FLAGS.showSpecimenArchive
  form.showUserCommunity = DEFAULT_FLAGS.showUserCommunity
  form.showBookingEntry = DEFAULT_FLAGS.showBookingEntry
  form.showSpecimenCustom = DEFAULT_FLAGS.showSpecimenCustom
  form.showPetMemorial = DEFAULT_FLAGS.showPetMemorial
  form.showStoredValue = DEFAULT_FLAGS.showStoredValue
  form.showAiIdentify = DEFAULT_FLAGS.showAiIdentify
  form.showStorePickup = DEFAULT_FLAGS.showStorePickup
  ElMessage.info('已恢复本地默认值，点击「保存开关」写入云库')
}

onMounted(loadFlags)
</script>

<style scoped>
.content-display-flags {
  padding: 8px 4px 32px;
}
.header-section h2 {
  margin: 0;
  font-size: 22px;
  color: #33302c;
  border-left: 5px solid #2d6a4f;
  padding-left: 12px;
  font-weight: 800;
}
.header-section .subtitle {
  margin: 8px 0 0;
  color: #6b6560;
  font-size: 13px;
  padding-left: 17px;
  line-height: 1.5;
}
.header-section code {
  font-size: 12px;
  background: #f2ede4;
  padding: 1px 6px;
  border-radius: 4px;
}
.hint-alert {
  margin: 14px 0 16px;
}
.flags-card {
  max-width: 720px;
  border-radius: 12px;
}
.switch-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.hint {
  font-size: 12px;
  color: #6b6560;
  line-height: 1.4;
}
.meta {
  margin: 8px 0 0;
  font-size: 12px;
  color: #a09a90;
}
</style>
