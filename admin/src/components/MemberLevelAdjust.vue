<template>
  <div class="member-level-adjust">
    <div class="panel-header">
      <div class="title-box">
        <h2>会员等级调整</h2>
        <span class="subtitle">
          将会员调至 Lv1–Lv6 各档 · 默认成长下限（保留自动升级）· 需授权密码 · manageMemberLevelAdjust
        </span>
      </div>
      <div class="header-actions">
        <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
      </div>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="hint-alert"
      title="定级规则：荣誉馆长（isHonorary）优先；否则看 levelOverride（floor=成长下限 / exact=强制锁定）；再否则按自然成长值对照 member_levels。调离荣誉馆长会同步移出名单。Lv99 请走「荣誉馆长名单」。"
    />

    <div class="layout">
      <el-card shadow="never" class="levels-card">
        <div class="card-head">
          <h3>可选等级（member_levels）</h3>
          <span class="muted">来源 {{ levelsSource || '—' }}</span>
        </div>
        <el-table :data="paidLevels" v-loading="levelsLoading" size="small" max-height="320">
          <el-table-column label="等级" width="70">
            <template #default="{ row }">Lv{{ row.level }}</template>
          </el-table-column>
          <el-table-column prop="name" label="名称" min-width="120" />
          <el-table-column label="成长门槛" width="100">
            <template #default="{ row }">{{ row.threshold }}</template>
          </el-table-column>
          <el-table-column label="折扣" width="90">
            <template #default="{ row }">{{ row.discountLabel }}</template>
          </el-table-column>
          <el-table-column label="权益" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ (row.benefits || []).join('、') || '—' }}</template>
          </el-table-column>
        </el-table>
        <p class="muted tip" v-if="honorary">
          荣誉馆长 {{ honorary.name }}（{{ honorary.discountLabel }}）不在本页调整，请使用荣誉馆长名单。
        </p>
      </el-card>

      <el-card shadow="never" class="search-card">
        <div class="card-head">
          <h3>搜索会员</h3>
        </div>
        <div class="filter-bar">
          <el-input
            v-model="keyword"
            clearable
            placeholder="手机号 / openid / 昵称"
            style="width: 280px"
            @keyup.enter="doSearch"
          />
          <el-button type="primary" :loading="searching" @click="doSearch">搜索</el-button>
        </div>

        <el-table :data="members" v-loading="searching" stripe max-height="360">
          <template #empty>
            <el-empty :description="searchHint" :image-size="72" />
          </template>
          <el-table-column label="会员" min-width="140">
            <template #default="{ row }">
              <div>{{ row.nickName || '藏家' }}</div>
              <div class="ts mono">{{ row.phoneMasked || '无手机号' }}</div>
              <div class="ts mono">{{ row.openidMasked }}</div>
            </template>
          </el-table-column>
          <el-table-column label="当前等级" width="130">
            <template #default="{ row }">
              <div>{{ row.levelName }}</div>
              <div class="ts">{{ row.discountLabel }}</div>
              <el-tag v-if="row.isHonorary" size="small" type="warning" effect="plain">荣誉馆长</el-tag>
              <el-tag v-else-if="row.overrideMode === 'exact'" size="small" type="danger" effect="plain">锁定</el-tag>
              <el-tag v-else-if="row.overrideMode === 'floor'" size="small" type="success" effect="plain">下限</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="自然档 / 成长" width="130">
            <template #default="{ row }">
              <div>Lv{{ row.naturalLevel }} {{ row.naturalLevelName }}</div>
              <div class="ts">成长 {{ row.growthValue }}</div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" link @click="openAdjust(row)">调整</el-button>
              <el-button
                v-if="row.levelOverride"
                size="small"
                type="danger"
                link
                @click="openClear(row)"
              >清除覆盖</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <el-card shadow="never" class="ops-card">
      <div class="ops-head">
        <h3>最近操作日志</h3>
        <el-button size="small" text @click="loadOps">刷新</el-button>
      </div>
      <el-table :data="opsList" v-loading="opsLoading" size="small" max-height="240">
        <template #empty>
          <span class="muted">暂无日志</span>
        </template>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ fmtFull(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="动作" width="100">
          <template #default="{ row }">
            <el-tag :type="row.action === 'adjust' ? 'success' : 'info'" size="small" effect="plain">
              {{ row.actionLabel || row.action }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="会员" min-width="140">
          <template #default="{ row }">
            <div>{{ row.nickName || '—' }}</div>
            <div class="ts mono">{{ row.phoneMasked || row.openidMasked }}</div>
          </template>
        </el-table-column>
        <el-table-column label="从 → 到" min-width="180">
          <template #default="{ row }">
            {{ row.fromLevelName || `Lv${row.fromLevel}` }}
            →
            {{ row.toLevelName || `Lv${row.toLevel}` }}
            <span v-if="row.mode" class="ts">（{{ row.mode }}）</span>
          </template>
        </el-table-column>
        <el-table-column label="操作人" width="140" prop="operatorName" />
        <el-table-column label="备注" min-width="120" show-overflow-tooltip prop="note" />
      </el-table>
    </el-card>

    <!-- 调整 -->
    <el-dialog v-model="adjustVisible" title="调整会员等级" width="520px" destroy-on-close @closed="resetAdjust">
      <div v-if="adjustRow" class="preview-box">
        <div><strong>{{ adjustRow.nickName }}</strong>（{{ adjustRow.phoneMasked || adjustRow.openidMasked }}）</div>
        <div class="ts">
          当前 {{ adjustRow.levelName }} · 自然档 Lv{{ adjustRow.naturalLevel }} · 成长值 {{ adjustRow.growthValue }}
        </div>
        <el-alert
          v-if="adjustRow.isHonorary"
          type="warning"
          :closable="false"
          show-icon
          class="preview-alert"
          title="该会员当前为荣誉馆长；确认后将移出荣誉馆长并写入目标付费档。"
        />
      </div>
      <el-form label-position="top">
        <el-form-item label="目标等级" required>
          <el-select v-model="adjustForm.targetLevel" placeholder="选择等级" style="width: 100%">
            <el-option
              v-for="lv in paidLevels"
              :key="lv.level"
              :label="`Lv${lv.level} ${lv.name} · 门槛 ${lv.threshold} · ${lv.discountLabel}`"
              :value="lv.level"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="调整模式" required>
          <el-radio-group v-model="adjustForm.mode">
            <el-radio-button label="floor">成长下限（推荐）</el-radio-button>
            <el-radio-button label="exact">强制锁定</el-radio-button>
          </el-radio-group>
          <p class="muted tip">
            floor：把定级成长下限设为目标档门槛，自然成长更高时仍自动升级。
            exact：锁定到目标档，暂停自动升级直至清除覆盖。
          </p>
        </el-form-item>
        <el-form-item label="备注（可选）">
          <el-input v-model="adjustForm.note" maxlength="200" placeholder="如：客诉补偿 / 测试账号" />
        </el-form-item>
        <el-form-item label="授权密码" required>
          <el-input
            v-model="adjustForm.password"
            type="password"
            show-password
            placeholder="与荣誉馆长授权密码相同（或 MEMBER_LEVEL_ADJUST_PASSWORD）"
            @keyup.enter="confirmAdjust"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adjustVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmAdjust">确认调整</el-button>
      </template>
    </el-dialog>

    <!-- 清除覆盖 -->
    <el-dialog v-model="clearVisible" title="清除等级覆盖" width="480px" destroy-on-close @closed="resetClear">
      <p class="remove-tip">
        将清除 <span class="mono">{{ clearRow?.nickName }}</span> 的人工覆盖，等级按自然成长值恢复。
      </p>
      <el-form label-position="top">
        <el-form-item label="授权密码" required>
          <el-input
            v-model="clearPassword"
            type="password"
            show-password
            placeholder="请输入授权密码"
            @keyup.enter="confirmClear"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="clearVisible = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="confirmClear">确认清除</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { callCloudFunction } from '../cloud'

const FN = 'manageMemberLevelAdjust'

const levelsLoading = ref(false)
const searching = ref(false)
const opsLoading = ref(false)
const submitting = ref(false)

const paidLevels = ref([])
const honorary = ref(null)
const levelsSource = ref('')
const keyword = ref('')
const members = ref([])
const searchHint = ref('输入关键词搜索会员')
const opsList = ref([])

const adjustVisible = ref(false)
const clearVisible = ref(false)
const adjustRow = ref(null)
const clearRow = ref(null)
const adjustForm = ref({ targetLevel: null, mode: 'floor', note: '', password: '' })
const clearPassword = ref('')

function fmtFull(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN')
}

async function callFn(data) {
  const res = await callCloudFunction(FN, { ...data })
  if (!res || res.success === false) {
    const err = new Error(res?.msg || '云函数调用失败')
    err.code = res?.code
    throw err
  }
  return res
}

async function loadLevels() {
  levelsLoading.value = true
  try {
    const res = await callFn({ action: 'listLevels' })
    paidLevels.value = res.paidLevels || (res.levels || []).filter((l) => l.level !== 99)
    honorary.value = res.honorary || null
    levelsSource.value = res.source || ''
  } catch (e) {
    paidLevels.value = []
    ElMessage.error(e?.message || '加载等级失败：请确认已部署 manageMemberLevelAdjust')
  } finally {
    levelsLoading.value = false
  }
}

async function doSearch() {
  const q = keyword.value.trim()
  if (!q) {
    ElMessage.warning('请输入搜索关键词')
    return
  }
  searching.value = true
  try {
    const res = await callFn({ action: 'search', keyword: q })
    members.value = res.list || []
    searchHint.value = res.msg || '未找到匹配会员'
  } catch (e) {
    members.value = []
    searchHint.value = e?.message || '搜索失败'
    ElMessage.error(e?.message || '搜索失败')
  } finally {
    searching.value = false
  }
}

async function loadOps() {
  opsLoading.value = true
  try {
    const res = await callFn({ action: 'recentOps', limit: 30 })
    opsList.value = res.list || []
  } catch (e) {
    opsList.value = []
  } finally {
    opsLoading.value = false
  }
}

function refresh() {
  loadLevels()
  loadOps()
  if (keyword.value.trim()) doSearch()
}

function openAdjust(row) {
  adjustRow.value = row
  adjustForm.value = {
    targetLevel: row.isHonorary ? (paidLevels.value[0]?.level ?? 1) : row.level,
    mode: 'floor',
    note: '',
    password: ''
  }
  adjustVisible.value = true
}

function resetAdjust() {
  adjustRow.value = null
  adjustForm.value = { targetLevel: null, mode: 'floor', note: '', password: '' }
}

function openClear(row) {
  clearRow.value = row
  clearPassword.value = ''
  clearVisible.value = true
}

function resetClear() {
  clearRow.value = null
  clearPassword.value = ''
}

async function confirmAdjust() {
  if (!adjustRow.value) return
  if (!adjustForm.value.targetLevel) {
    ElMessage.warning('请选择目标等级')
    return
  }
  if (!adjustForm.value.password) {
    ElMessage.warning('请输入授权密码')
    return
  }
  submitting.value = true
  try {
    const res = await callFn({
      action: 'adjust',
      userId: adjustRow.value._id,
      openid: adjustRow.value.openid,
      targetLevel: adjustForm.value.targetLevel,
      mode: adjustForm.value.mode,
      note: adjustForm.value.note,
      confirmPassword: adjustForm.value.password
    })
    if (res.warning) ElMessage.warning(res.warning)
    else ElMessage.success(res.msg || '已调整')
    adjustVisible.value = false
    await doSearch()
    await loadOps()
  } catch (e) {
    ElMessage.error(e?.message || '调整失败')
  } finally {
    submitting.value = false
  }
}

async function confirmClear() {
  if (!clearRow.value) return
  if (!clearPassword.value) {
    ElMessage.warning('请输入授权密码')
    return
  }
  submitting.value = true
  try {
    const res = await callFn({
      action: 'clearOverride',
      userId: clearRow.value._id,
      openid: clearRow.value.openid,
      confirmPassword: clearPassword.value
    })
    ElMessage.success(res.msg || '已清除')
    clearVisible.value = false
    await doSearch()
    await loadOps()
  } catch (e) {
    ElMessage.error(e?.message || '清除失败')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  refresh()
})
</script>

<style scoped>
.member-level-adjust {
  padding: 24px;
  background: #f2ede4;
  min-height: calc(100vh - 120px);
  color: #33302c;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
  gap: 16px;
}

.title-box h2 {
  margin: 0 0 6px;
  font-size: 22px;
  color: #2d5a3f;
  font-weight: 600;
}

.subtitle {
  color: #6b6560;
  font-size: 13px;
}

.hint-alert {
  margin-bottom: 16px;
}

.layout {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 16px;
  margin-bottom: 16px;
}

@media (max-width: 1100px) {
  .layout {
    grid-template-columns: 1fr;
  }
}

.levels-card,
.search-card,
.ops-card {
  background: #fff;
  border: 1px solid #e8e5de;
  border-radius: 12px;
}

.card-head,
.ops-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.card-head h3,
.ops-head h3 {
  margin: 0;
  font-size: 16px;
  color: #33302c;
}

.filter-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.muted {
  color: #6b6560;
  font-size: 12px;
}

.tip {
  margin: 10px 0 0;
  line-height: 1.5;
}

.ts {
  color: #a09a90;
  font-size: 12px;
}

.mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.preview-box {
  margin-bottom: 12px;
  padding: 12px;
  background: #faf6ed;
  border: 1px solid #e0cfa3;
  border-radius: 8px;
}

.preview-alert {
  margin-top: 10px;
}

.remove-tip {
  margin: 0 0 12px;
  color: #4a4540;
  line-height: 1.6;
}
</style>
