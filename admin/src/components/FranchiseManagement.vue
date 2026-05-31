<template>
  <div class="module-wrapper franchise-mgmt">
    <div class="module-header">
      <div class="title-box">
        <h2>加盟商管理</h2>
        <span class="subtitle">FRANCHISE PIPELINE</span>
      </div>
    </div>

    <div class="funnel-row">
      <div v-for="(label, key) in LEAD_STAGES" :key="key" class="funnel-chip" :class="{ dim: stageCount(key) === 0 }">
        <span class="funnel-n">{{ stageCount(key) }}</span>
        <span class="funnel-l">{{ label }}</span>
      </div>
    </div>

    <el-tabs v-model="mainTab" class="main-tabs">
      <el-tab-pane label="加盟意向库" name="leads">
        <el-card class="table-card" shadow="never">
          <div class="toolbar">
            <el-select v-model="filterStage" placeholder="阶段" clearable style="width: 140px">
              <el-option v-for="(lab, k) in LEAD_STAGES" :key="k" :label="lab" :value="k" />
            </el-select>
            <el-input v-model="filterKeyword" placeholder="姓名 / 手机" clearable style="width: 180px" />
            <el-button type="primary" @click="openLeadDialog()">
              <el-icon><Plus /></el-icon>
              新建意向
            </el-button>
            <el-button @click="exportLeadsCsv">导出 CSV</el-button>
          </div>
          <el-table :data="filteredLeads" stripe empty-text="暂无加盟意向">
            <el-table-column prop="name" label="姓名" width="100" />
            <el-table-column label="手机" width="120">
              <template #default="{ row }">{{ maskPhone(row.phone) }}</template>
            </el-table-column>
            <el-table-column label="主意向城市" min-width="120">
              <template #default="{ row }">{{ primaryCityDisplay(row) }}</template>
            </el-table-column>
            <el-table-column label="阶段" width="110">
              <template #default="{ row }">
                <el-tag size="small" :type="stageTagType(row.stage)">{{ LEAD_STAGES[row.stage] || row.stage }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="source" label="来源" width="100" show-overflow-tooltip />
            <el-table-column prop="ownerName" label="跟进人" width="100" />
            <el-table-column label="关联门店" min-width="130">
              <template #default="{ row }">
                <template v-if="row.linkedStoreCode">
                  <el-tag type="success" size="small">{{ row.linkedStoreCode }}</el-tag>
                </template>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="更新" width="108">
              <template #default="{ row }">{{ fmtTime(row.updatedAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openLeadDrawer(row)">详情</el-button>
                <el-button link @click="openLeadDialog(row)">编辑</el-button>
                <el-button link type="danger" @click="removeLead(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="城市选址" name="cities">
        <el-card class="table-card" shadow="never">
          <div class="toolbar">
            <el-button type="primary" @click="openCityDialog()">
              <el-icon><Plus /></el-icon>
              新建城市档案
            </el-button>
          </div>
          <el-table :data="bundle.cities" stripe empty-text="暂无城市档案">
            <el-table-column label="省 / 市" min-width="160">
              <template #default="{ row }">{{ cityLabel(row) }}</template>
            </el-table-column>
            <el-table-column label="优先级" width="88">
              <template #default="{ row }">
                <el-tag size="small" :type="priorityTag(row.priority)">{{ CITY_PRIORITY[row.priority] || row.priority }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">{{ CITY_STATUS[row.status] || row.status }}</template>
            </el-table-column>
            <el-table-column prop="summary" label="摘要" min-width="200" show-overflow-tooltip />
            <el-table-column label="考察次数" width="92" align="center">
              <template #default="{ row }">{{ (row.inspections || []).length }}</template>
            </el-table-column>
            <el-table-column label="操作" width="160" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openCityDrawer(row)">详情</el-button>
                <el-button link @click="openCityDialog(row)">编辑</el-button>
                <el-button link type="danger" @click="removeCity(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="商业资源" name="resources">
        <el-card class="table-card" shadow="never">
          <div class="toolbar">
            <el-button type="primary" @click="openResourceDialog()">
              <el-icon><Plus /></el-icon>
              新建资源
            </el-button>
          </div>
          <el-table :data="bundle.resources" stripe empty-text="暂无商业资源">
            <el-table-column label="类型" width="120">
              <template #default="{ row }">{{ RESOURCE_TYPES[row.type] || row.type }}</template>
            </el-table-column>
            <el-table-column prop="orgName" label="资源方" min-width="140" />
            <el-table-column prop="contactName" label="对接人" width="100" />
            <el-table-column label="手机" width="120">
              <template #default="{ row }">{{ maskPhone(row.contactPhone) }}</template>
            </el-table-column>
            <el-table-column label="合作状态" width="100">
              <template #default="{ row }">{{ RESOURCE_COOP[row.cooperationStatus] || row.cooperationStatus }}</template>
            </el-table-column>
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openResourceDialog(row)">编辑</el-button>
                <el-button link type="danger" @click="removeResource(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 意向表单 -->
    <el-dialog v-model="leadDialog" :title="leadEditingId ? '编辑意向' : '新建加盟意向'" width="560px" destroy-on-close @closed="resetLeadForm">
      <el-form :model="leadForm" label-width="108px">
        <el-form-item label="姓名" required>
          <el-input v-model="leadForm.name" maxlength="32" placeholder="真实姓名或称呼" />
        </el-form-item>
        <el-form-item label="手机" required>
          <el-input v-model="leadForm.phone" maxlength="11" placeholder="11 位手机号" />
        </el-form-item>
        <el-form-item label="微信">
          <el-input v-model="leadForm.wechat" maxlength="32" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="leadForm.email" maxlength="64" />
        </el-form-item>
        <el-form-item label="获知渠道">
          <el-input v-model="leadForm.source" placeholder="如 小红书 / 转介绍" maxlength="64" />
        </el-form-item>
        <el-form-item label="主意向城市">
          <el-select v-model="leadForm.primaryCityId" clearable filterable placeholder="可选：关联城市档案" style="width: 100%">
            <el-option v-for="c in bundle.cities" :key="c.id" :label="cityLabel(c)" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="城市（文本）">
          <el-input v-model="leadForm.primaryCityText" placeholder="无档案时填写，如 长春" maxlength="64" />
        </el-form-item>
        <el-form-item label="候选城市">
          <el-select v-model="leadForm.cityIds" multiple collapse-tags filterable placeholder="多选城市档案" style="width: 100%">
            <el-option v-for="c in bundle.cities" :key="c.id" :label="cityLabel(c)" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="阶段">
          <el-select v-model="leadForm.stage" style="width: 100%">
            <el-option v-for="(lab, k) in LEAD_STAGES" :key="k" :label="lab" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="leadForm.stage === 'lost'" label="流失原因" required>
          <el-select v-model="leadForm.lostReason" style="width: 100%">
            <el-option v-for="(lab, k) in LOST_REASONS" :key="k" :label="lab" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="跟进人">
          <el-input v-model="leadForm.ownerName" maxlength="32" />
        </el-form-item>
        <el-form-item label="投资区间">
          <el-input v-model="leadForm.investRange" placeholder="如 80–120 万" maxlength="32" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="leadForm.notes" type="textarea" :rows="3" maxlength="2000" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="leadDialog = false">取消</el-button>
        <el-button type="primary" @click="saveLead">保存</el-button>
      </template>
    </el-dialog>

    <!-- 意向详情 -->
    <el-drawer v-model="leadDrawer" :title="currentLead?.name || '意向详情'" size="min(560px, 96vw)" destroy-on-close>
      <template v-if="currentLead">
        <el-descriptions :column="1" border size="small" class="desc-block">
          <el-descriptions-item label="手机">{{ currentLead.phone }}</el-descriptions-item>
          <el-descriptions-item label="微信">{{ currentLead.wechat || '—' }}</el-descriptions-item>
          <el-descriptions-item label="邮箱">{{ currentLead.email || '—' }}</el-descriptions-item>
          <el-descriptions-item label="主意向城市">{{ primaryCityDisplay(currentLead) }}</el-descriptions-item>
          <el-descriptions-item label="阶段">
            <el-select v-model="currentLead.stage" size="small" style="width: 100%" @change="onLeadStageChange">
              <el-option v-for="(lab, k) in LEAD_STAGES" :key="k" :label="lab" :value="k" />
            </el-select>
          </el-descriptions-item>
          <el-descriptions-item v-if="currentLead.stage === 'lost'" label="流失原因">
            <el-select v-model="currentLead.lostReason" size="small" style="width: 100%" @change="persist">
              <el-option v-for="(lab, k) in LOST_REASONS" :key="k" :label="lab" :value="k" />
            </el-select>
          </el-descriptions-item>
          <el-descriptions-item label="关联门店">
            <template v-if="currentLead.linkedStoreCode">
              {{ currentLead.linkedStoreCode }}（{{ currentLead.linkedStoreId }}）
            </template>
            <span v-else>—</span>
          </el-descriptions-item>
        </el-descriptions>

        <div v-if="canCreatePrepStore(currentLead)" class="prep-store-actions">
          <el-button type="primary" @click="openPrepStoreDialog">创建筹备门店</el-button>
          <span class="hint">将写入「店铺管理」并关联本意向</span>
        </div>

        <h4 class="sub-title">跟进记录</h4>
        <el-timeline v-if="(currentLead.followUps || []).length">
          <el-timeline-item v-for="fu in sortedFollowUps(currentLead)" :key="fu.id" :timestamp="fmtTime(fu.createdAt)" placement="top">
            {{ fu.content }}
            <div v-if="fu.nextFollowUpAt" class="next-fu">下次：{{ fu.nextFollowUpAt }}</div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="暂无跟进" :image-size="60" />

        <el-form label-width="88px" class="fu-form">
          <el-form-item label="跟进内容">
            <el-input v-model="followForm.content" type="textarea" :rows="3" placeholder="沟通摘要" maxlength="2000" />
          </el-form-item>
          <el-form-item label="下次跟进">
            <el-date-picker v-model="followForm.nextFollowUpAt" type="date" value-format="YYYY-MM-DD" placeholder="可选" style="width: 100%" />
          </el-form-item>
          <el-button type="primary" @click="addFollowUp">添加记录</el-button>
        </el-form>
      </template>
    </el-drawer>

    <!-- 筹备门店 -->
    <el-dialog v-model="prepStoreDialog" title="创建筹备门店" width="480px" destroy-on-close>
      <el-form :model="prepStoreForm" label-width="100px">
        <el-form-item label="门店编码" required>
          <el-input v-model="prepStoreForm.code" maxlength="32" placeholder="唯一编码" />
        </el-form-item>
        <el-form-item label="门店名称" required>
          <el-input v-model="prepStoreForm.name" maxlength="64" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="prepStoreDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmPrepStore">创建</el-button>
      </template>
    </el-dialog>

    <!-- 城市 -->
    <el-dialog v-model="cityDialog" :title="cityEditingId ? '编辑城市档案' : '新建城市档案'" width="560px" destroy-on-close @closed="resetCityForm">
      <el-form :model="cityForm" label-width="100px">
        <el-form-item label="省" required>
          <el-input v-model="cityForm.province" maxlength="32" placeholder="如 吉林省" />
        </el-form-item>
        <el-form-item label="市" required>
          <el-input v-model="cityForm.city" maxlength="32" placeholder="如 长春市" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-radio-group v-model="cityForm.priority">
            <el-radio-button v-for="(lab, k) in CITY_PRIORITY" :key="k" :label="k">{{ lab }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="拓展状态">
          <el-select v-model="cityForm.status" style="width: 100%">
            <el-option v-for="(lab, k) in CITY_STATUS" :key="k" :label="lab" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="市场摘要">
          <el-input v-model="cityForm.summary" type="textarea" :rows="4" maxlength="4000" show-word-limit />
        </el-form-item>
        <el-form-item label="商圈/点位">
          <el-input v-model="cityForm.siteNotes" type="textarea" :rows="3" maxlength="4000" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cityDialog = false">取消</el-button>
        <el-button type="primary" @click="saveCity">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="cityDrawer" :title="cityLabel(currentCity)" size="min(520px, 96vw)" destroy-on-close>
      <template v-if="currentCity">
        <el-descriptions :column="1" border size="small" class="desc-block">
          <el-descriptions-item label="优先级">{{ CITY_PRIORITY[currentCity.priority] }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ CITY_STATUS[currentCity.status] }}</el-descriptions-item>
          <el-descriptions-item label="摘要">{{ currentCity.summary || '—' }}</el-descriptions-item>
          <el-descriptions-item label="商圈/点位">{{ currentCity.siteNotes || '—' }}</el-descriptions-item>
        </el-descriptions>

        <h4 class="sub-title">考察记录</h4>
        <el-table :data="currentCity.inspections || []" size="small" max-height="240" empty-text="暂无">
          <el-table-column prop="date" label="日期" width="120" />
          <el-table-column prop="attendees" label="参与人" width="120" />
          <el-table-column prop="conclusion" label="结论" min-width="160" show-overflow-tooltip />
        </el-table>
        <el-form :model="inspForm" label-width="88px" class="insp-form">
          <el-form-item label="日期" required>
            <el-date-picker v-model="inspForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
          <el-form-item label="参与人">
            <el-input v-model="inspForm.attendees" maxlength="128" />
          </el-form-item>
          <el-form-item label="结论">
            <el-input v-model="inspForm.conclusion" type="textarea" :rows="2" maxlength="2000" />
          </el-form-item>
          <el-button type="primary" @click="addInspection">添加考察</el-button>
        </el-form>

        <h4 class="sub-title">关联意向</h4>
        <el-select v-model="currentCity.relatedLeadIds" multiple collapse-tags style="width: 100%" @change="persist">
          <el-option v-for="l in bundle.leads" :key="l.id" :label="`${l.name} · ${maskPhone(l.phone)}`" :value="l.id" />
        </el-select>
      </template>
    </el-drawer>

    <!-- 商业资源 -->
    <el-dialog v-model="resourceDialog" :title="resourceEditingId ? '编辑商业资源' : '新建商业资源'" width="560px" destroy-on-close @closed="resetResourceForm">
      <el-form :model="resourceForm" label-width="100px">
        <el-form-item label="类型" required>
          <el-select v-model="resourceForm.type" style="width: 100%">
            <el-option v-for="(lab, k) in RESOURCE_TYPES" :key="k" :label="lab" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="资源方" required>
          <el-input v-model="resourceForm.orgName" maxlength="128" />
        </el-form-item>
        <el-form-item label="对接人">
          <el-input v-model="resourceForm.contactName" maxlength="32" />
        </el-form-item>
        <el-form-item label="手机">
          <el-input v-model="resourceForm.contactPhone" maxlength="11" />
        </el-form-item>
        <el-form-item label="关系说明">
          <el-input v-model="resourceForm.description" type="textarea" :rows="3" maxlength="2000" />
        </el-form-item>
        <el-form-item label="适用城市">
          <el-select v-model="resourceForm.cityIds" multiple collapse-tags filterable style="width: 100%">
            <el-option v-for="c in bundle.cities" :key="c.id" :label="cityLabel(c)" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联意向">
          <el-select v-model="resourceForm.relatedLeadIds" multiple collapse-tags filterable style="width: 100%">
            <el-option v-for="l in bundle.leads" :key="l.id" :label="`${l.name} · ${maskPhone(l.phone)}`" :value="l.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="合作状态">
          <el-select v-model="resourceForm.cooperationStatus" style="width: 100%">
            <el-option v-for="(lab, k) in RESOURCE_COOP" :key="k" :label="lab" :value="k" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resourceDialog = false">取消</el-button>
        <el-button type="primary" @click="saveResource">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  loadFranchiseBundle,
  saveFranchiseBundle,
  genFranchiseId,
  LEAD_STAGES,
  LOST_REASONS,
  CITY_PRIORITY,
  CITY_STATUS,
  RESOURCE_TYPES,
  RESOURCE_COOP,
  maskPhone,
  normalizePhone,
  isValidCnMobile,
  cityLabel,
} from '../utils/franchiseStorage'
import { loadStoreBundle, saveStoreBundle, genStoreEntityId } from '../utils/storeStorage'

const emit = defineEmits(['switch-tab'])

const bundle = reactive(loadFranchiseBundle())
const mainTab = ref('leads')
const filterStage = ref('')
const filterKeyword = ref('')

const leadDialog = ref(false)
const leadEditingId = ref('')
const leadForm = reactive({
  name: '',
  phone: '',
  wechat: '',
  email: '',
  source: '',
  primaryCityId: '',
  primaryCityText: '',
  cityIds: [],
  stage: 'new',
  lostReason: '',
  ownerName: '',
  investRange: '',
  notes: '',
})

const leadDrawer = ref(false)
const leadDrawerId = ref('')
const followForm = reactive({ content: '', nextFollowUpAt: '' })

const prepStoreDialog = ref(false)
const prepStoreForm = reactive({ code: '', name: '' })

const cityDialog = ref(false)
const cityEditingId = ref('')
const cityForm = reactive({
  province: '',
  city: '',
  priority: 'medium',
  status: 'idle',
  summary: '',
  siteNotes: '',
})

const cityDrawer = ref(false)
const cityDrawerId = ref('')
const inspForm = reactive({ date: '', attendees: '', conclusion: '' })

const resourceDialog = ref(false)
const resourceEditingId = ref('')
const resourceForm = reactive({
  type: 'landlord',
  orgName: '',
  contactName: '',
  contactPhone: '',
  description: '',
  cityIds: [],
  relatedLeadIds: [],
  cooperationStatus: 'touch',
})

function persist() {
  saveFranchiseBundle(JSON.parse(JSON.stringify(bundle)))
}

function stageCount(stage) {
  return bundle.leads.filter((l) => l.stage === stage).length
}

const filteredLeads = computed(() => {
  let list = [...bundle.leads]
  if (filterStage.value) list = list.filter((l) => l.stage === filterStage.value)
  const kw = filterKeyword.value.trim().toLowerCase()
  if (kw) {
    list = list.filter((l) => {
      const n = (l.name || '').toLowerCase()
      const p = normalizePhone(l.phone).toLowerCase()
      return n.includes(kw) || p.includes(kw.replace(/\s/g, ''))
    })
  }
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
})

const currentLead = computed(() => bundle.leads.find((l) => l.id === leadDrawerId.value) || null)
const currentCity = computed(() => bundle.cities.find((c) => c.id === cityDrawerId.value) || null)

function primaryCityDisplay(lead) {
  if (!lead) return '—'
  if (lead.primaryCityId) {
    const c = bundle.cities.find((x) => x.id === lead.primaryCityId)
    if (c) return cityLabel(c)
  }
  return lead.primaryCityText || '—'
}

function stageTagType(st) {
  if (st === 'won') return 'success'
  if (st === 'lost') return 'info'
  if (st === 'approved' || st === 'contracting') return 'warning'
  if (st === 'site_selection') return ''
  return 'info'
}

function priorityTag(p) {
  if (p === 'high') return 'danger'
  if (p === 'medium') return 'warning'
  return 'info'
}

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function resetLeadForm() {
  leadEditingId.value = ''
  Object.assign(leadForm, {
    name: '',
    phone: '',
    wechat: '',
    email: '',
    source: '',
    primaryCityId: '',
    primaryCityText: '',
    cityIds: [],
    stage: 'new',
    lostReason: '',
    ownerName: '',
    investRange: '',
    notes: '',
  })
}

function openLeadDialog(row) {
  resetLeadForm()
  if (row) {
    leadEditingId.value = row.id
    Object.assign(leadForm, {
      name: row.name || '',
      phone: row.phone || '',
      wechat: row.wechat || '',
      email: row.email || '',
      source: row.source || '',
      primaryCityId: row.primaryCityId || '',
      primaryCityText: row.primaryCityText || '',
      cityIds: [...(row.cityIds || [])],
      stage: row.stage || 'new',
      lostReason: row.lostReason || '',
      ownerName: row.ownerName || '',
      investRange: row.investRange || '',
      notes: row.notes || '',
    })
  }
  leadDialog.value = true
}

function saveLead() {
  if (!leadForm.name?.trim()) {
    ElMessage.warning('请填写姓名')
    return
  }
  const phone = normalizePhone(leadForm.phone)
  if (!isValidCnMobile(phone)) {
    ElMessage.warning('请填写有效的 11 位手机号')
    return
  }
  if (leadForm.stage === 'lost' && !leadForm.lostReason) {
    ElMessage.warning('流失阶段请填写流失原因')
    return
  }
  const dup = bundle.leads.some((l) => normalizePhone(l.phone) === phone && l.id !== leadEditingId.value)
  if (dup) {
    ElMessage.warning('该手机号已存在其他意向，请核对或编辑原记录')
    return
  }
  const now = Date.now()
  if (leadEditingId.value) {
    const idx = bundle.leads.findIndex((l) => l.id === leadEditingId.value)
    if (idx >= 0) {
      const lostReason = leadForm.stage === 'lost' ? leadForm.lostReason : ''
      bundle.leads[idx] = {
        ...bundle.leads[idx],
        ...leadForm,
        name: leadForm.name.trim(),
        phone,
        lostReason,
        followUps: bundle.leads[idx].followUps || [],
        updatedAt: now,
      }
    }
    ElMessage.success('已更新')
  } else {
    bundle.leads.push({
      id: genFranchiseId('lead'),
      ...leadForm,
      name: leadForm.name.trim(),
      phone,
      lostReason: leadForm.stage === 'lost' ? leadForm.lostReason : '',
      followUps: [],
      linkedStoreId: '',
      linkedStoreCode: '',
      createdAt: now,
      updatedAt: now,
    })
    ElMessage.success('已创建')
  }
  persist()
  leadDialog.value = false
}

function removeLead(row) {
  ElMessageBox.confirm(`确定删除意向「${row.name}」？`, '提示', { type: 'warning' })
    .then(() => {
      bundle.leads = bundle.leads.filter((l) => l.id !== row.id)
      for (const c of bundle.cities) {
        if (Array.isArray(c.relatedLeadIds)) c.relatedLeadIds = c.relatedLeadIds.filter((id) => id !== row.id)
      }
      for (const r of bundle.resources) {
        if (Array.isArray(r.relatedLeadIds)) r.relatedLeadIds = r.relatedLeadIds.filter((id) => id !== row.id)
      }
      if (leadDrawerId.value === row.id) leadDrawer.value = false
      persist()
      ElMessage.success('已删除')
    })
    .catch(() => {})
}

function openLeadDrawer(row) {
  leadDrawerId.value = row.id
  followForm.content = ''
  followForm.nextFollowUpAt = ''
  leadDrawer.value = true
}

function sortedFollowUps(lead) {
  return [...(lead.followUps || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

function addFollowUp() {
  const lead = currentLead.value
  if (!lead) return
  if (!followForm.content?.trim()) {
    ElMessage.warning('请填写跟进内容')
    return
  }
  if (!lead.followUps) lead.followUps = []
  lead.followUps.push({
    id: genFranchiseId('fu'),
    content: followForm.content.trim(),
    nextFollowUpAt: followForm.nextFollowUpAt || '',
    createdAt: Date.now(),
  })
  lead.updatedAt = Date.now()
  followForm.content = ''
  followForm.nextFollowUpAt = ''
  persist()
  ElMessage.success('已添加跟进')
}

function onLeadStageChange() {
  const lead = currentLead.value
  if (lead?.stage === 'lost' && !lead.lostReason) lead.lostReason = 'other'
  if (lead) lead.updatedAt = Date.now()
  persist()
}

function canCreatePrepStore(lead) {
  if (!lead || lead.linkedStoreId) return false
  return lead.stage === 'approved' || lead.stage === 'won'
}

function openPrepStoreDialog() {
  const lead = currentLead.value
  if (!lead) return
  const suffix = String(Date.now()).slice(-6)
  prepStoreForm.code = `JM${suffix}`
  prepStoreForm.name = `${lead.name}·加盟筹备`
  prepStoreDialog.value = true
}

function confirmPrepStore() {
  const lead = currentLead.value
  if (!lead) return
  const code = prepStoreForm.code?.trim()
  const name = prepStoreForm.name?.trim()
  if (!code || !name) {
    ElMessage.warning('请填写门店编码与名称')
    return
  }
  const sb = loadStoreBundle()
  if (sb.stores.some((s) => s.code === code)) {
    ElMessage.warning('门店编码已存在，请更换')
    return
  }
  const store = {
    id: genStoreEntityId('store'),
    code,
    name,
    status: 'preparing',
    city: primaryCityDisplay(lead) !== '—' ? primaryCityDisplay(lead) : lead.primaryCityText || '',
    managerName: lead.name,
    address: '',
    postalCode: '',
    latLng: '',
    areaM2: null,
    unitNo: '',
    leaseStart: '',
    leaseEnd: '',
    landlordName: '',
    landlordContact: lead.phone || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  sb.stores.push(store)
  saveStoreBundle(sb)
  lead.linkedStoreId = store.id
  lead.linkedStoreCode = store.code
  if (lead.stage !== 'won') lead.stage = 'contracting'
  lead.updatedAt = Date.now()
  persist()
  prepStoreDialog.value = false
  leadDrawer.value = false
  ElMessage.success('已创建筹备门店并关联')
  emit('switch-tab', '30')
}

function exportLeadsCsv() {
  const headers = ['姓名', '手机', '主意向城市', '阶段', '来源', '跟进人', '关联门店编码', '创建日', '备注']
  const lines = [headers.join(',')]
  for (const l of bundle.leads) {
    const city = primaryCityDisplay(l)
    lines.push(
      [
        l.name,
        l.phone,
        city,
        LEAD_STAGES[l.stage] || l.stage,
        l.source || '',
        l.ownerName || '',
        l.linkedStoreCode || '',
        fmtTime(l.createdAt),
        (l.notes || '').replace(/"/g, '""'),
      ]
        .map((c) => `"${String(c)}"`)
        .join(','),
    )
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `加盟意向_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('已导出')
}

function resetCityForm() {
  cityEditingId.value = ''
  Object.assign(cityForm, {
    province: '',
    city: '',
    priority: 'medium',
    status: 'idle',
    summary: '',
    siteNotes: '',
  })
}

function openCityDialog(row) {
  resetCityForm()
  if (row) {
    cityEditingId.value = row.id
    Object.assign(cityForm, {
      province: row.province || '',
      city: row.city || '',
      priority: row.priority || 'medium',
      status: row.status || 'idle',
      summary: row.summary || '',
      siteNotes: row.siteNotes || '',
    })
  }
  cityDialog.value = true
}

function saveCity() {
  if (!cityForm.province?.trim() || !cityForm.city?.trim()) {
    ElMessage.warning('请填写省、市')
    return
  }
  const now = Date.now()
  if (cityEditingId.value) {
    const idx = bundle.cities.findIndex((c) => c.id === cityEditingId.value)
    if (idx >= 0) {
      bundle.cities[idx] = {
        ...bundle.cities[idx],
        ...cityForm,
        province: cityForm.province.trim(),
        city: cityForm.city.trim(),
        inspections: bundle.cities[idx].inspections || [],
        relatedLeadIds: bundle.cities[idx].relatedLeadIds || [],
        updatedAt: now,
      }
    }
    ElMessage.success('已更新')
  } else {
    bundle.cities.push({
      id: genFranchiseId('city'),
      ...cityForm,
      province: cityForm.province.trim(),
      city: cityForm.city.trim(),
      inspections: [],
      relatedLeadIds: [],
      createdAt: now,
      updatedAt: now,
    })
    ElMessage.success('已创建')
  }
  persist()
  cityDialog.value = false
}

function removeCity(row) {
  ElMessageBox.confirm(`确定删除城市档案「${cityLabel(row)}」？`, '提示', { type: 'warning' })
    .then(() => {
      bundle.cities = bundle.cities.filter((c) => c.id !== row.id)
      for (const l of bundle.leads) {
        if (l.primaryCityId === row.id) l.primaryCityId = ''
        if (Array.isArray(l.cityIds)) l.cityIds = l.cityIds.filter((id) => id !== row.id)
      }
      for (const r of bundle.resources) {
        if (Array.isArray(r.cityIds)) r.cityIds = r.cityIds.filter((id) => id !== row.id)
      }
      if (cityDrawerId.value === row.id) cityDrawer.value = false
      persist()
      ElMessage.success('已删除')
    })
    .catch(() => {})
}

function openCityDrawer(row) {
  cityDrawerId.value = row.id
  inspForm.date = ''
  inspForm.attendees = ''
  inspForm.conclusion = ''
  if (!row.relatedLeadIds) row.relatedLeadIds = []
  cityDrawer.value = true
}

function addInspection() {
  const c = currentCity.value
  if (!c) return
  if (!inspForm.date) {
    ElMessage.warning('请选择考察日期')
    return
  }
  if (!c.inspections) c.inspections = []
  c.inspections.push({
    id: genFranchiseId('insp'),
    date: inspForm.date,
    attendees: inspForm.attendees?.trim() || '',
    conclusion: inspForm.conclusion?.trim() || '',
  })
  c.updatedAt = Date.now()
  inspForm.date = ''
  inspForm.attendees = ''
  inspForm.conclusion = ''
  persist()
  ElMessage.success('已添加考察记录')
}

function resetResourceForm() {
  resourceEditingId.value = ''
  Object.assign(resourceForm, {
    type: 'landlord',
    orgName: '',
    contactName: '',
    contactPhone: '',
    description: '',
    cityIds: [],
    relatedLeadIds: [],
    cooperationStatus: 'touch',
  })
}

function openResourceDialog(row) {
  resetResourceForm()
  if (row) {
    resourceEditingId.value = row.id
    Object.assign(resourceForm, {
      type: row.type || 'landlord',
      orgName: row.orgName || '',
      contactName: row.contactName || '',
      contactPhone: row.contactPhone || '',
      description: row.description || '',
      cityIds: [...(row.cityIds || [])],
      relatedLeadIds: [...(row.relatedLeadIds || [])],
      cooperationStatus: row.cooperationStatus || 'touch',
    })
  }
  resourceDialog.value = true
}

function saveResource() {
  if (!resourceForm.orgName?.trim()) {
    ElMessage.warning('请填写资源方名称')
    return
  }
  const now = Date.now()
  if (resourceEditingId.value) {
    const idx = bundle.resources.findIndex((r) => r.id === resourceEditingId.value)
    if (idx >= 0) {
      bundle.resources[idx] = {
        ...bundle.resources[idx],
        ...resourceForm,
        orgName: resourceForm.orgName.trim(),
        contactPhone: normalizePhone(resourceForm.contactPhone),
        updatedAt: now,
      }
    }
    ElMessage.success('已更新')
  } else {
    bundle.resources.push({
      id: genFranchiseId('res'),
      ...resourceForm,
      orgName: resourceForm.orgName.trim(),
      contactPhone: normalizePhone(resourceForm.contactPhone),
      createdAt: now,
      updatedAt: now,
    })
    ElMessage.success('已创建')
  }
  persist()
  resourceDialog.value = false
}

function removeResource(row) {
  ElMessageBox.confirm(`确定删除资源「${row.orgName}」？`, '提示', { type: 'warning' })
    .then(() => {
      bundle.resources = bundle.resources.filter((r) => r.id !== row.id)
      persist()
      ElMessage.success('已删除')
    })
    .catch(() => {})
}
</script>

<style scoped>
.franchise-mgmt .table-card {
  margin-top: 0;
}
.funnel-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}
.funnel-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--light-bg-elevated, #f5f7fa);
  border: 1px solid var(--el-border-color-lighter);
  font-size: 13px;
}
.funnel-chip.dim {
  opacity: 0.55;
}
.funnel-n {
  font-weight: 700;
  font-size: 16px;
  color: var(--brand-green-500, #409eff);
}
.funnel-l {
  color: var(--light-text-secondary, #606266);
}
.main-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
  align-items: center;
}
.muted {
  color: var(--light-text-tertiary, #909399);
  font-size: 12px;
}
.desc-block {
  margin-bottom: 16px;
}
.sub-title {
  margin: 16px 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--light-text-secondary, #606266);
}
.next-fu {
  font-size: 12px;
  color: var(--el-color-warning);
  margin-top: 4px;
}
.fu-form {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed var(--el-border-color-lighter);
}
.prep-store-actions {
  margin: 12px 0;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.prep-store-actions .hint {
  font-size: 12px;
  color: var(--light-text-tertiary, #909399);
}
.insp-form {
  margin-top: 12px;
}
</style>
