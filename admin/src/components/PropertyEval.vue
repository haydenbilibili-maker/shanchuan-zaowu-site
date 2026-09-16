<template>
  <div class="pe-container">
    <!-- 头部 -->
    <div class="panel-header">
      <div class="title-box">
        <h2>物业合作测算 / PROPERTY EVAL</h2>
        <span class="subtitle">PROPERTY DEAL MODELING · v3</span>
      </div>
      <div class="header-actions">
        <el-button :icon="Plus" type="primary" color="#d4af37" @click="createNew">新增物业</el-button>
        <el-button :icon="Refresh" circle @click="refresh" title="刷新" />
      </div>
    </div>

    <div class="layout">
      <!-- 左侧物业列表 -->
      <div class="props-pane">
        <div class="pane-title">物业清单 ({{ properties.length }})</div>
        <div v-for="p in properties" :key="p.id" class="prop-card" :class="{ active: currentId === p.id }" @click="selectProperty(p.id)">
          <div class="pc-head">
            <span class="pc-icon">{{ STATUS_LABELS[p.status]?.icon || '🏢' }}</span>
            <span class="pc-name">{{ p.name }}</span>
          </div>
          <div class="pc-meta">
            <span>{{ p.city || '—' }}</span>
            <el-tag size="small" :type="STATUS_LABELS[p.status]?.type">{{ STATUS_LABELS[p.status]?.text }}</el-tag>
          </div>
          <div class="pc-result" v-if="propSummaries[p.id] && p.status !== 'declined'">
            <span class="lbl">三年园区(阶梯)</span>
            <span class="val">¥{{ propSummaries[p.id].recommendedTotal }} 万</span>
          </div>
          <div class="pc-result pc-declined" v-else-if="p.status === 'declined'">
            <span class="lbl">结论</span>
            <span class="val">🚫 不合作</span>
          </div>
        </div>
        <div v-if="!properties.length" class="empty-tip">还没有物业，点右上"新增"</div>
      </div>

      <!-- 右侧详情 -->
      <div class="detail-pane" v-if="current">
        <div class="detail-header">
          <div>
            <div class="prop-title">
              <input v-model="current.name" class="title-input" placeholder="物业名称" />
            </div>
            <div class="prop-sub">
              <el-input v-model="current.city" placeholder="城市" size="small" style="width:100px" />
              <el-input v-model="current.address" placeholder="地址" size="small" style="width:280px" />
              <el-date-picker v-model="current.proposalDate" type="date" value-format="YYYY-MM-DD" size="small" placeholder="提案日期" style="width:140px" />
              <el-select v-model="current.status" size="small" style="width:120px">
                <el-option v-for="(meta, key) in STATUS_LABELS" :key="key" :value="key" :label="`${meta.icon} ${meta.text}`" />
              </el-select>
            </div>
          </div>
          <div class="detail-actions">
            <el-tooltip content="实时计算已开启，任何参数变化都会自动重算" placement="top">
              <div class="live-indicator" :class="{ flash: justRecomputed }">
                <span class="dot"></span>
                <span class="ind-text">🟢 实时计算中</span>
                <span class="ind-time" v-if="lastComputeStamp">·  上次 {{ relativeTime(lastComputeStamp) }}</span>
              </div>
            </el-tooltip>
            <el-button :icon="RefreshRight" @click="forceRecompute" title="强制重算（默认已实时）">重算</el-button>
            <el-button :icon="Setting" plain @click="resetToDefaults" :disabled="!current.isPreset">恢复默认</el-button>
            <el-button :icon="Document" plain @click="exportCSV">导出 CSV</el-button>
            <el-button :icon="Delete" type="danger" plain @click="deleteCurrent" :disabled="current.isPreset">删除</el-button>
            <el-button type="primary" color="#d4af37" :icon="Check" @click="saveCurrent">保存</el-button>
          </div>
        </div>

        <!-- 关键摘要 -->
        <div class="kpi-summary" v-if="result" :class="{ flash: justRecomputed }">
          <div class="kpi-mini gold">
            <span class="lbl">推荐结构(阶梯)·三年园区收益</span>
            <span class="val">¥{{ result.summary.recommendedTotal }}<small>万</small></span>
            <span class="sub">较传统 {{ formatPct(result.summary.recommendedDelta) }}</span>
          </div>
          <div class="kpi-mini">
            <span class="lbl">山海三年毛利留存(阶梯)</span>
            <span class="val">¥{{ result.metrics.threeYearProfitLadder }}<small>万</small></span>
            <span class="sub">5 年 {{ result.metrics.fiveYearProfitLadder }} 万</span>
          </div>
          <div class="kpi-mini">
            <span class="lbl">山海净改造投入</span>
            <span class="val">¥{{ result.metrics.capexAll }}<small>万</small></span>
            <span class="sub">园区分担 {{ result.capex.parkBear }} 万</span>
          </div>
          <div class="kpi-mini hot">
            <span class="lbl">回本周期 · 阶梯</span>
            <span class="val">{{ fmtPayback(result.metrics.paybackLadder) }}</span>
            <span class="sub">5y IRR {{ formatPct(result.metrics.irr5) }}</span>
          </div>
          <div class="kpi-mini">
            <span class="lbl">园区有效分润率</span>
            <span class="val">{{ formatPct(result.summary.effectiveShareRate) }}</span>
            <span class="sub">占可分润毛利</span>
          </div>
        </div>

        <!-- 6 Tab -->
        <el-tabs v-model="activeTab" class="pe-tabs">
          <!-- Tab 1: 关键参数 -->
          <el-tab-pane label="① 关键参数" name="inputs">
            <div class="params-grid">
              <div class="param-section">
                <div class="ps-title">📐 面积与锚点</div>
                <div class="form-grid">
                  <ParamInput v-model="current.areaTotal" label="名义建筑面积 (㎡)" :step="50" />
                  <ParamInput v-model="current.areaOpRatio" label="经营面积占比" :step="0.05" :pct="true" />
                  <ParamReadout label="经营面积 (㎡)" :value="(current.areaTotal * current.areaOpRatio).toFixed(0)" />
                  <ParamReadout label="公共面积 (㎡)" :value="(current.areaTotal * (1 - current.areaOpRatio)).toFixed(0)" />
                  <ParamInput v-model="current.anchorArea" label="【这有山】门店面积 (㎡)" :step="5" />
                  <ParamInput v-model="current.anchorRevenueLow" label="淡季月营收 (万元)" :step="1" />
                  <ParamInput v-model="current.anchorRevenueHigh" label="旺季月营收 (万元)" :step="1" />
                  <ParamInput v-model="current.anchorNetMargin" label="实测净利率（参考）" :step="0.01" :pct="true" />
                </div>
              </div>

              <div class="param-section">
                <div class="ps-title">🏬 旗舰大店折让</div>
                <div class="form-grid">
                  <ParamInput v-model="current.bigStoreDiscount" label="大店密度折让系数" :step="0.05" :pct="true" />
                  <ParamReadout label="锚点·淡季坪效" :value="result?.derived?.anchorEffLow + ' 元/㎡/月'" />
                  <ParamReadout label="锚点·旺季坪效" :value="result?.derived?.anchorEffHigh + ' 元/㎡/月'" />
                  <ParamReadout label="旗舰·下行" :value="result?.derived?.flagshipLow + ' 元/㎡/月'" />
                  <ParamReadout label="旗舰·中性" :value="result?.derived?.flagshipMid + ' 元/㎡/月'" />
                  <ParamReadout label="旗舰·上行" :value="result?.derived?.flagshipHigh + ' 元/㎡/月'" />
                </div>
                <div class="scenario-switcher">
                  <span class="ss-label">情景开关：</span>
                  <el-radio-group v-model="current.scenario" fill="#d4af37">
                    <el-radio-button :label="1">1 · 下行(保守)</el-radio-button>
                    <el-radio-button :label="2">2 · 中性(基准)</el-radio-button>
                    <el-radio-button :label="3">3 · 上行(乐观)</el-radio-button>
                  </el-radio-group>
                  <span class="ss-current">→ 当前坪效 <b>{{ result?.derived?.currentEff }} 元/㎡/月</b></span>
                </div>
              </div>

              <div class="param-section">
                <div class="ps-title">📈 营收增长 / 经营假设</div>
                <div class="form-grid">
                  <ParamInput v-model="current.growthY2" label="第二年增长率" :step="0.05" :pct="true" />
                  <ParamInput v-model="current.growthY3" label="第三年增长率" :step="0.05" :pct="true" />
                  <ParamInput v-model="current.monthsPerYear" label="年营业月数" :step="1" :min="1" :max="12" />
                  <ParamInput v-model="current.grossMargin" label="综合毛利率" :step="0.05" :pct="true" />
                  <ParamInput v-model="current.opCostRate" label="必要运营成本率" :step="0.05" :pct="true" />
                  <ParamReadout label="分润基数率(可分润毛利/营收)" :value="result ? formatPct(result.gross.rate) : '-'" />
                </div>
              </div>

              <div class="param-section">
                <div class="ps-title">🤝 四种合作结构参数</div>
                <div class="form-grid">
                  <ParamInput v-model="current.baseRent" label="当地租金基准 (元/㎡/月)" :step="5" />
                  <ParamInput v-model="current.rentGrowth" label="传统租金年涨幅" :step="0.01" :pct="true" />
                  <ParamInput v-model="current.rev_pure_share" label="【纯分成】园区取毛利比例" :step="0.02" :pct="true" />
                  <ParamInput v-model="current.rev_floor_rent" label="【保底+分成】保底 (元/㎡/月)" :step="5" />
                  <ParamInput v-model="current.rev_floor_share" label="【保底+分成】抽成比例" :step="0.02" :pct="true" />
                  <ParamInput v-model="current.ladder_floor_rent" label="【阶梯】保底 (元/㎡/月)" :step="5" />
                  <ParamInput v-model="current.ladder_share_y1" label="【阶梯】第一年" :step="0.02" :pct="true" />
                  <ParamInput v-model="current.ladder_share_y2" label="【阶梯】第二年" :step="0.02" :pct="true" />
                  <ParamInput v-model="current.ladder_share_y3" label="【阶梯】第三年" :step="0.02" :pct="true" />
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- Tab 2: 营收预测 -->
          <el-tab-pane label="② 营收 & 毛利" name="revenue">
            <el-table :data="revenueRows" border>
              <el-table-column label="项目" prop="label" width="200" />
              <el-table-column label="第一年" prop="y1" align="right" />
              <el-table-column label="第二年" prop="y2" align="right" />
              <el-table-column label="第三年" prop="y3" align="right" />
              <el-table-column label="三年累计" prop="total" align="right">
                <template #default="{ row }">
                  <span class="cell-total">{{ row.total }}</span>
                </template>
              </el-table-column>
            </el-table>
            <div class="formula-note">可分润毛利 = 营收 × (毛利率 − 必要成本率) = 营收 × {{ result ? formatPct(result.gross.rate) : '-' }}。园区分润以此为基数，非营收。</div>
            <div class="chart-wrap"><canvas ref="revChartRef"></canvas></div>
          </el-tab-pane>

          <!-- Tab 3: 四结构对比 -->
          <el-tab-pane label="③ 四结构对比" name="structures">
            <el-table :data="result?.structures || []" border :row-class-name="(r) => r.row?.recommended ? 'row-recommended' : ''">
              <el-table-column label="结构" min-width="180">
                <template #default="{ row }">
                  <strong>{{ row.name }}</strong>
                  <el-tag v-if="row.recommended" size="small" type="warning" effect="dark" style="margin-left: 8px;">⭐ 推荐</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="第一年" prop="y1" align="right" width="100" />
              <el-table-column label="第二年" prop="y2" align="right" width="100" />
              <el-table-column label="第三年" prop="y3" align="right" width="100" />
              <el-table-column label="三年累计" prop="total" align="right" width="120">
                <template #default="{ row }">
                  <span class="cell-total">{{ row.total }}</span>
                </template>
              </el-table-column>
              <el-table-column label="较传统" align="right" width="100">
                <template #default="{ row }">
                  <span :class="deltaClass(row.deltaVsTraditional)">{{ row.deltaVsTraditional ? formatPct(row.deltaVsTraditional) : '基准' }}</span>
                </template>
              </el-table-column>
            </el-table>
            <div class="chart-wrap"><canvas ref="structChartRef"></canvas></div>
          </el-tab-pane>

          <!-- Tab 4: 山海留存 -->
          <el-tab-pane label="④ 山海留存" name="retention">
            <el-table :data="result?.structures || []" border>
              <el-table-column label="结构" prop="name" min-width="180" />
              <el-table-column label="三年累计可分润毛利" align="right">
                <template #default>
                  <span>{{ result?.gross.total }}</span>
                </template>
              </el-table-column>
              <el-table-column label="减：园区所得" align="right" width="120">
                <template #default="{ row }">−{{ row.total }}</template>
              </el-table-column>
              <el-table-column label="山海留存" align="right" width="130">
                <template #default="{ row }">
                  <span class="cell-total">{{ row.retention }}</span>
                </template>
              </el-table-column>
              <el-table-column label="园区占毛利比" align="right" width="120">
                <template #default="{ row }">{{ formatPct(row.retentionShareOfGross) }}</template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <!-- Tab 5: 改造与回本 -->
          <el-tab-pane label="⑤ 改造与回本" name="capex">
            <div class="capex-grid">
              <div class="param-section">
                <div class="ps-title">🛠 改造投入假设</div>
                <div class="form-grid">
                  <ParamInput v-model="current.renovOp" label="经营区改造 (元/㎡)" :step="100" />
                  <ParamInput v-model="current.renovPublic" label="公共区改造 (元/㎡)" :step="100" />
                  <ParamInput v-model="current.renovPublicParkPart" label="园区承担公共区比例" :step="0.05" :pct="true" />
                  <ParamInput v-model="current.renovBase" label="基础改造 (元/㎡)" :step="100" />
                  <ParamInput v-model="current.renovBaseParkPart" label="园区承担基础比例" :step="0.05" :pct="true" />
                  <ParamInput v-model="current.capexExhibition" label="标本展陈装置 (万元)" :step="5" />
                  <ParamInput v-model="current.capexIP" label="双 IP 装置 (万元)" :step="2" />
                  <ParamInput v-model="current.capexWorkshop" label="内容工坊设备 (万元)" :step="2" />
                  <ParamInput v-model="current.capexDesign" label="设计与软装 (万元)" :step="5" />
                  <ParamInput v-model="current.capexPrep" label="开办筹备 (万元)" :step="2" />
                  <ParamInput v-model="current.steadyGrowth" label="稳态年增长(第四年起)" :step="0.02" :pct="true" />
                </div>
              </div>

              <div class="capex-summary" v-if="result">
                <div class="cs-title">📊 投入结构</div>
                <div class="cs-row"><span>经营区改造</span><b>{{ result.capex.renovOpTotal }} 万</b></div>
                <div class="cs-row"><span>公共区·合计</span><span class="dim">{{ result.capex.renovPublicTotal }} 万</span></div>
                <div class="cs-row"><span>公共区·山海承担</span><b>{{ result.capex.renovPublicSelf }} 万</b></div>
                <div class="cs-row"><span>基础改造·合计</span><span class="dim">{{ result.capex.renovBaseTotal }} 万</span></div>
                <div class="cs-row"><span>基础改造·山海承担</span><b>{{ result.capex.renovBaseSelf }} 万</b></div>
                <div class="cs-row"><span>专项装置合计</span><b>{{ result.capex.capexSpecial }} 万</b></div>
                <div class="cs-row"><span>设计与软装</span><b>{{ result.capex.capexDesign }} 万</b></div>
                <div class="cs-row"><span>开办筹备</span><b>{{ result.capex.capexPrep }} 万</b></div>
                <div class="cs-row hl"><span>山海净改造投入(K)</span><b>{{ result.capex.capexAll }} 万</b></div>
                <div class="cs-row sub"><span>园区承担(参考)</span><span>{{ result.capex.parkBear }} 万</span></div>
              </div>
            </div>

            <h4 class="block-title">五年现金流 · 阶梯结构</h4>
            <el-table :data="result?.cashflow || []" border size="small">
              <el-table-column label="期间" prop="period" width="100" />
              <el-table-column label="营业收入" prop="revenue" align="right" />
              <el-table-column label="可分润毛利" prop="gross" align="right" />
              <el-table-column label="园区所得" prop="parkShare" align="right" />
              <el-table-column label="经营利润" prop="profit" align="right">
                <template #default="{ row }">
                  <span :class="row.profit >= 0 ? 'cell-profit-pos' : 'cell-profit-neg'">{{ row.profit }}</span>
                </template>
              </el-table-column>
              <el-table-column label="改造投入" prop="capex" align="right" />
              <el-table-column label="年度净现金流" prop="net" align="right" />
              <el-table-column label="累计净现金流" prop="cum" align="right">
                <template #default="{ row }">
                  <strong :class="row.cum >= 0 ? 'cell-profit-pos' : 'cell-profit-neg'">{{ row.cum }}</strong>
                </template>
              </el-table-column>
            </el-table>

            <h4 class="block-title">回本周期敏感性</h4>
            <div class="payback-grid">
              <div class="pb-card recommended">
                <div class="pb-label">阶梯·毛利分润 (推荐)</div>
                <div class="pb-val">{{ fmtPayback(result?.metrics.paybackLadder) }}</div>
              </div>
              <div class="pb-card">
                <div class="pb-label">传统固定租金</div>
                <div class="pb-val">{{ fmtPayback(result?.metrics.paybackTraditional) }}</div>
              </div>
              <div class="pb-card">
                <div class="pb-label">纯分成</div>
                <div class="pb-val">{{ fmtPayback(result?.metrics.paybackPure) }}</div>
              </div>
              <div class="pb-card">
                <div class="pb-label">保底+抽成</div>
                <div class="pb-val">{{ fmtPayback(result?.metrics.paybackFloor) }}</div>
              </div>
            </div>
          </el-tab-pane>

          <!-- Tab 6: 三情景敏感性 -->
          <el-tab-pane label="⑥ 三情景对照" name="sensitivity">
            <el-table :data="result?.sensitivity || []" border>
              <el-table-column label="情景" prop="label" width="160" />
              <el-table-column label="经营面积坪效(元/㎡/月)" prop="eff" align="right" width="180" />
              <el-table-column label="三年总营收" prop="revTotal" align="right" />
              <el-table-column label="园区·传统(固定)" prop="parkTraditional" align="right" />
              <el-table-column label="园区·阶梯" prop="parkLadder" align="right">
                <template #default="{ row }">
                  <span class="cell-total">{{ row.parkLadder }}</span>
                </template>
              </el-table-column>
              <el-table-column label="山海·阶梯留存" prop="retentionLadder" align="right" />
              <el-table-column label="阶梯有效分润率" align="right" width="120">
                <template #default="{ row }">{{ formatPct(row.effectiveShareRate) }}</template>
              </el-table-column>
            </el-table>
            <div class="formula-note">
              「传统固定租金」三档相同——旱涝照收；「阶梯毛利分润」随毛利升降：下行年园区少分、山海少付，
              即分润相对固定租金的下行保护，也是山海让出上行所换的对价。
            </div>
            <div class="chart-wrap"><canvas ref="senseChartRef"></canvas></div>
          </el-tab-pane>
        </el-tabs>

        <!-- 风险与决策（评估案例） -->
        <div class="risk-section" v-if="current.decision || (current.risks && current.risks.length)">
          <div class="risk-head">
            <span class="risk-title">🚦 风险与决策</span>
            <el-tag v-if="current.decision?.result === 'declined'" type="danger" effect="dark">🚫 结论：不合作</el-tag>
            <el-tag v-else-if="current.decision" type="warning">{{ current.decision.summary || current.decision.result }}</el-tag>
          </div>
          <div class="terms-box" v-if="current.dealTerms && current.dealTerms.length">
            <div class="terms-title">📋 合作条件（原文记录）</div>
            <ul class="terms-list">
              <li v-for="(t, i) in current.dealTerms" :key="i">{{ t }}</li>
            </ul>
          </div>
          <div class="risk-list" v-if="current.risks && current.risks.length">
            <div v-for="(r, i) in current.risks" :key="i" class="risk-item">
              <el-tag size="small" :type="riskTagType(r.level)" effect="dark">{{ riskLevelText(r.level) }}</el-tag>
              <span class="risk-point">{{ r.point }}</span>
            </div>
          </div>
        </div>

        <!-- 备注 -->
        <div class="note-section">
          <label class="note-label">📝 谈判要点 / 备注</label>
          <el-input
            v-model="current.note"
            type="textarea"
            :rows="5"
            placeholder="可填写关键约束、谈判要点、风险提示等"
          />
        </div>
      </div>

      <div v-else class="empty-detail">请在左侧选择一个物业</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, reactive, watch, onMounted, onUnmounted, nextTick, h } from 'vue'
import { Plus, Refresh, Document, Delete, Check, RefreshRight, Setting } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fetchCollectionLimit, fetchCollectionWhere, cdnAdd, cdnUpdate } from '../cloud'
import Chart from 'chart.js/auto'
import { DEFAULT_INPUTS, PRESET_PROPERTIES, STATUS_LABELS, computeProposal } from '../utils/propertyEvalModel'

const STORAGE_KEY = 'sc_property_proposals_v3'

const properties = ref([])
const currentId = ref('')
const activeTab = ref('inputs')
const revChartRef = ref(null)
const structChartRef = ref(null)
const senseChartRef = ref(null)
let revChart = null, structChart = null, senseChart = null

const current = computed(() => properties.value.find(p => p.id === currentId.value))

// 强制重算的版本号（点"重算"时 +1，可让 result 重新计算）
const recomputeVersion = ref(0)
const lastComputeStamp = ref(0)
const justRecomputed = ref(false)
let flashTimer = null

// computed 保持纯函数（getter 无副作用），flash/时间戳等 UI 状态移到 watch 里
const result = computed(() => {
  // 引用 recomputeVersion 让"重算"按钮也能触发
  // eslint-disable-next-line no-unused-expressions
  recomputeVersion.value
  if (!current.value) return null
  return computeProposal(current.value)
})

// 左侧物业卡片的三年收益预览（之前模板引用 p._result 但从未赋值）
const propSummaries = computed(() => {
  const map = {}
  properties.value.forEach(p => {
    try { map[p.id] = computeProposal(p).summary } catch (e) { safeWarn('PropertyEval 测算某项失败（已忽略该行）', e) }
  })
  return map
})

const forceRecompute = () => {
  recomputeVersion.value++
  ElMessage.success({ message: '已重新计算', duration: 1200 })
}

const resetToDefaults = () => {
  if (!current.value || !current.value.isPreset) return
  ElMessageBox.confirm('恢复为 v3 默认参数？当前修改将丢失。', '恢复默认', { type: 'warning' }).then(() => {
    const preset = PRESET_PROPERTIES.find(p => p.id === current.value.id)
    if (preset) {
      // 替换 properties 中的对应项（保持响应式）
      const idx = properties.value.findIndex(p => p.id === current.value.id)
      if (idx >= 0) {
        properties.value[idx] = { ...preset }
        persistLocal()
        recomputeVersion.value++
        ElMessage.success('已恢复默认参数')
      }
    }
  }).catch((e) => {
    if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
  })
}

const relativeTime = (ts) => {
  const diff = Date.now() - ts
  if (diff < 2000) return '刚刚'
  if (diff < 60000) return Math.floor(diff / 1000) + ' 秒前'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// 调试用：开发模式下 console 一次便于验证
if (typeof window !== 'undefined') {
  window.__propertyEvalDebug = () => ({
    current: current.value, result: result.value, version: recomputeVersion.value
  })
}

const formatPct = (v) => {
  if (v == null || isNaN(v)) return '-'
  return (v * 100).toFixed(1) + '%'
}
/** 回本周期：null 表示五年内未回本（不能显示成 0 年） */
const fmtPayback = (v) => {
  if (v == null) return '5年内未回本'
  return v + ' 年'
}
const deltaClass = (v) => v > 0.05 ? 'delta-up' : (v < -0.05 ? 'delta-down' : 'delta-flat')

// 风险等级 → 标签类型/文案
const riskTagType = (l) => ({ critical: 'danger', high: 'warning', medium: 'primary', low: 'info' }[l] || 'info')
const riskLevelText = (l) => ({ critical: '致命', high: '高', medium: '中', low: '低' }[l] || l)

const revenueRows = computed(() => {
  if (!result.value) return []
  return [
    { label: '营业收入', y1: result.value.revenue.y1, y2: result.value.revenue.y2, y3: result.value.revenue.y3, total: result.value.revenue.total },
    { label: '可分润毛利(扣必要成本)', y1: result.value.gross.y1, y2: result.value.gross.y2, y3: result.value.gross.y3, total: result.value.gross.total }
  ]
})

// ====== 内联子组件（用 el-input-number 解决输入丢失问题） ======
import { ElInputNumber } from 'element-plus'
import { safeWarn } from '../utils/safeStorage.js'
const ParamInput = {
  props: {
    modelValue: { type: [Number, String], default: 0 },
    label: String,
    step: { type: Number, default: 1 },
    pct: Boolean,
    min: { type: Number, default: 0 },
    max: Number
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const inner = computed({
      get: () => {
        if (props.modelValue == null || isNaN(+props.modelValue)) return null
        return props.pct ? +(props.modelValue * 100).toFixed(2) : +props.modelValue
      },
      set: (v) => {
        if (v == null || isNaN(v)) return
        emit('update:modelValue', props.pct ? +(v / 100).toFixed(6) : +v)
      }
    })
    return () => h('div', { class: 'form-item' }, [
      h('label', { class: 'fi-label' }, props.label),
      h('div', { class: 'fi-control-en' }, [
        h(ElInputNumber, {
          modelValue: inner.value,
          'onUpdate:modelValue': (v) => { inner.value = v },
          step: props.pct ? 1 : props.step,
          stepStrictly: false,
          min: props.min,
          max: props.max,
          controls: true,
          controlsPosition: 'right',
          size: 'small',
          precision: props.pct ? 2 : (props.step >= 1 ? 0 : 4)
        }),
        props.pct ? h('span', { class: 'fi-unit' }, '%') : null
      ])
    ])
  }
}
const ParamReadout = {
  props: { label: String, value: [String, Number] },
  setup(props) {
    return () => h('div', { class: 'form-item readout' }, [
      h('label', { class: 'fi-label' }, props.label),
      h('div', { class: 'fi-readout' }, props.value ?? '-')
    ])
  }
}

// ====== 加载 / 保存 ======
function loadFromLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.length) return arr
    }
  } catch (e) { safeWarn('PropertyEval 本地缓存读取失败（回落预置案例）', e) }
  return null
}
function persistLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(properties.value))
  } catch (e) { console.warn('保存物业失败', e) }
}

const refresh = async () => {
  const local = loadFromLocal()
  if (local) {
    // 老用户也可见新增的预置案例（如评估案例）：按 id 补齐缺失预置
    const ids = new Set(local.map(p => p.id))
    PRESET_PROPERTIES.forEach(p => { if (!ids.has(p.id)) local.push({ ...p }) })
    properties.value = local
  } else {
    properties.value = PRESET_PROPERTIES.map(p => ({ ...p }))
    persistLocal()
  }
  if (!currentId.value && properties.value.length) {
    currentId.value = properties.value[0].id
  }
  // 后台同步云端（CDN SDK，避免 bundle db promise bug）
  fetchCollectionLimit('property_proposals', { limit: 100 })
    .then((cloud) => {
      if (!cloud?.length) return
      const map = new Map(properties.value.map(p => [p.id, p]))
      cloud.forEach(c => map.set(c.id || c._id, c))
      properties.value = Array.from(map.values())
      persistLocal()
    })
    .catch((e) => console.warn('云端拉取失败', e))
}

const selectProperty = (id) => { currentId.value = id; nextTick(renderCharts) }

const createNew = () => {
  const id = 'prop-' + Date.now()
  properties.value.push({ ...DEFAULT_INPUTS, id, name: '新物业', isPreset: false })
  currentId.value = id
  persistLocal()
}

const saveCurrent = async () => {
  persistLocal()
  ElMessage.success('已保存到本机')
  // 后台云端同步（CDN SDK）
  try {
    const payload = JSON.parse(JSON.stringify(current.value))
    payload.snapshot = result.value
    payload.updateTime = Date.now()
    // 不吞错：查重失败若被当成「不存在」，会走新建分支产生重复提案
    const exist = await fetchCollectionWhere('property_proposals', { id: current.value.id }, 1)
    if (exist?.length) {
      await cdnUpdate('property_proposals', exist[0]._id, payload)
    } else {
      payload.createTime = Date.now()
      await cdnAdd('property_proposals', payload)
    }
    ElMessage.success('已同步到云端')
  } catch (e) {
    // 不再只 console.warn：本地已存不会丢数据，但云端没同步上必须让用户知道
    console.error('云端保存失败', e)
    ElMessage.warning(`已保存到本机，但云端同步失败：${e?.message || '未知错误'}`)
  }
}

const deleteCurrent = () => {
  if (current.value.isPreset) {
    return ElMessage.warning('预置案例不可删除')
  }
  ElMessageBox.confirm(`删除物业「${current.value.name}」？`, '删除确认', { type: 'warning' }).then(() => {
    properties.value = properties.value.filter(p => p.id !== currentId.value)
    currentId.value = properties.value[0]?.id || ''
    persistLocal()
    ElMessage.success('已删除')
  }).catch((e) => {
    if (e !== 'cancel' && e !== 'close') console.error('确认框异常', e)
  })
}

const exportCSV = () => {
  if (!current.value || !result.value) return
  const lines = []
  lines.push(['物业', current.value.name])
  lines.push(['地址', current.value.address])
  lines.push(['日期', current.value.proposalDate])
  lines.push([])
  lines.push(['一、营收 & 毛利'])
  lines.push(['项目', '第一年', '第二年', '第三年', '三年累计'])
  lines.push(['营业收入', result.value.revenue.y1, result.value.revenue.y2, result.value.revenue.y3, result.value.revenue.total])
  lines.push(['可分润毛利', result.value.gross.y1, result.value.gross.y2, result.value.gross.y3, result.value.gross.total])
  lines.push([])
  lines.push(['二、四结构对比 (园区收益, 万元)'])
  lines.push(['结构', '第一年', '第二年', '第三年', '三年累计', '较传统'])
  result.value.structures.forEach(s => {
    lines.push([s.name, s.y1, s.y2, s.y3, s.total, formatPct(s.deltaVsTraditional)])
  })
  lines.push([])
  lines.push(['三、五年现金流 (阶梯)'])
  lines.push(['期间', '营收', '可分润毛利', '园区所得', '经营利润', '改造', '净现金流', '累计'])
  result.value.cashflow.forEach(c => {
    lines.push([c.period, c.revenue, c.gross, c.parkShare, c.profit, c.capex, c.net, c.cum])
  })
  lines.push([])
  lines.push(['四、回本与回报'])
  lines.push(['指标', '值'])
  lines.push(['山海净改造投入(万元)', result.value.metrics.capexAll])
  lines.push(['回本周期·阶梯', fmtPayback(result.value.metrics.paybackLadder)])
  lines.push(['三年累计经营利润', result.value.metrics.threeYearProfitLadder])
  lines.push(['五年累计经营利润', result.value.metrics.fiveYearProfitLadder])
  lines.push(['五年 IRR', formatPct(result.value.metrics.irr5)])

  const csv = lines.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${current.value.name}-测算-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  ElMessage.success('已导出 CSV')
}

// ====== Chart 渲染 ======
const renderCharts = () => {
  if (!result.value) return

  // 营收 chart
  if (revChartRef.value) {
    if (revChart) revChart.destroy()
    revChart = new Chart(revChartRef.value, {
      type: 'bar',
      data: {
        labels: ['第一年', '第二年', '第三年'],
        datasets: [
          { label: '营业收入', data: [result.value.revenue.y1, result.value.revenue.y2, result.value.revenue.y3], backgroundColor: '#3498db', borderRadius: 4 },
          { label: '可分润毛利', data: [result.value.gross.y1, result.value.gross.y2, result.value.gross.y3], backgroundColor: '#d4af37', borderRadius: 4 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }
    })
  }
  // 四结构 chart
  if (structChartRef.value) {
    if (structChart) structChart.destroy()
    structChart = new Chart(structChartRef.value, {
      type: 'bar',
      data: {
        labels: result.value.structures.map(s => s.name),
        datasets: [
          { label: '三年累计园区收益(万元)', data: result.value.structures.map(s => s.total), backgroundColor: ['#909399', '#3498db', '#67C23A', '#d4af37'], borderRadius: 4 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    })
  }
  // 敏感性 chart
  if (senseChartRef.value) {
    if (senseChart) senseChart.destroy()
    senseChart = new Chart(senseChartRef.value, {
      type: 'bar',
      data: {
        labels: result.value.sensitivity.map(s => s.label),
        datasets: [
          { label: '园区·传统固定租金', data: result.value.sensitivity.map(s => s.parkTraditional), backgroundColor: '#909399', borderRadius: 4 },
          { label: '园区·阶梯毛利分润', data: result.value.sensitivity.map(s => s.parkLadder), backgroundColor: '#d4af37', borderRadius: 4 },
          { label: '山海·阶梯留存', data: result.value.sensitivity.map(s => s.retentionLadder), backgroundColor: '#67C23A', borderRadius: 4 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }
    })
  }
}

// result 是 computed 返回的新对象，引用变化即触发，无需 deep（省去大对象深遍历）
watch(result, () => {
  // flash + 时间戳（从 computed getter 移出，保持 getter 纯净）
  lastComputeStamp.value = Date.now()
  if (flashTimer) clearTimeout(flashTimer)
  justRecomputed.value = true
  flashTimer = setTimeout(() => { justRecomputed.value = false }, 600)
  nextTick(renderCharts)
})
watch(() => activeTab.value, () => nextTick(renderCharts))

onMounted(() => {
  refresh()
  nextTick(renderCharts)
})
onUnmounted(() => {
  ;[revChart, structChart, senseChart].forEach(c => { try { c?.destroy() } catch (e) { safeWarn('PropertyEval 图表销毁失败（已忽略）', e) } })
  if (flashTimer) clearTimeout(flashTimer)
})
</script>

<style scoped>
.pe-container { padding: 16px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.title-box h2 { margin: 0; font-size: 22px; color: #333; border-left: 5px solid #d4af37; padding-left: 12px; font-weight: 800; }
.title-box .subtitle { color: #999; font-size: 12px; padding-left: 17px; letter-spacing: 2px; }
.header-actions { display: flex; gap: 10px; }

.layout { display: grid; grid-template-columns: 280px 1fr; gap: 16px; }
.props-pane { background: #fff; border-radius: 12px; padding: 14px; box-shadow: 0 2px 6px rgba(0,0,0,0.04); }
.pane-title { font-size: 12px; color: #999; letter-spacing: 1px; margin-bottom: 10px; }
.prop-card { padding: 12px; border-radius: 8px; cursor: pointer; transition: 0.15s; border: 1px solid transparent; margin-bottom: 6px; }
.prop-card:hover { background: #fafafa; }
.prop-card.active { background: #fdf6ec; border-color: #d4af37; }
.pc-head { display: flex; align-items: center; gap: 8px; }
.pc-icon { font-size: 16px; }
.pc-name { font-weight: bold; color: #333; font-size: 13px; }
.pc-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 11px; color: #999; }
.pc-result { margin-top: 6px; padding-top: 6px; border-top: 1px dashed #f0f0f0; display: flex; justify-content: space-between; font-size: 11px; }
.pc-result .lbl { color: #999; }
.pc-result .val { color: #d4af37; font-weight: bold; }
.empty-tip, .empty-detail { color: #ccc; text-align: center; padding: 60px 20px; font-size: 13px; }

.detail-pane { background: #fff; border-radius: 12px; padding: 18px; box-shadow: 0 2px 6px rgba(0,0,0,0.04); }
.detail-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; padding-bottom: 14px; border-bottom: 1px solid #f0f0f0; }
.prop-title .title-input { font-size: 20px; font-weight: bold; border: none; border-bottom: 2px solid transparent; padding: 4px 0; outline: none; color: #333; min-width: 260px; }
.prop-title .title-input:focus { border-bottom-color: #d4af37; }
.prop-sub { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.detail-actions { display: flex; gap: 8px; }

.kpi-summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 18px; }
.kpi-mini { padding: 14px 16px; border-radius: 10px; background: #fafafa; border-top: 3px solid #e4e7ed; display: flex; flex-direction: column; gap: 4px; }
.kpi-mini.gold { background: linear-gradient(135deg, #fffbe6, #fff5d9); border-top-color: #d4af37; }
.kpi-mini.hot { background: linear-gradient(135deg, #fef0f0, #fde2e2); border-top-color: #f56c6c; }
.kpi-mini .lbl { font-size: 11px; color: #999; }
.kpi-mini .val { font-size: 22px; font-weight: 800; color: #333; line-height: 1.2; }
.kpi-mini .val small { font-size: 11px; color: #999; margin-left: 2px; font-weight: 500; }
.kpi-mini .sub { font-size: 11px; color: #d4af37; }

.pe-tabs { margin-top: 6px; }
.params-grid { display: flex; flex-direction: column; gap: 14px; }
.param-section { background: #fafafa; border-radius: 10px; padding: 14px 16px; border: 1px solid #f0f0f0; }
.ps-title { font-weight: bold; color: #333; font-size: 13px; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px dashed #e4e7ed; }
.form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px 16px; }
.form-item { display: flex; flex-direction: column; gap: 4px; }
.fi-label { font-size: 11px; color: #666; }
.fi-control { display: flex; align-items: center; gap: 4px; background: #fff; border: 1px solid #e4e7ed; border-radius: 6px; padding: 2px 8px; transition: 0.15s; }
.fi-control:focus-within { border-color: #d4af37; box-shadow: 0 0 0 2px rgba(212, 175, 55, 0.15); }
.fi-control input { flex: 1; border: none; outline: none; padding: 6px 0; font-size: 13px; font-family: 'JetBrains Mono', ui-monospace, monospace; }
.fi-control-en { display: flex; align-items: center; gap: 6px; }
.fi-control-en :deep(.el-input-number) { flex: 1; width: 100%; }
.fi-control-en :deep(.el-input-number .el-input__inner) { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; text-align: left; }
.fi-unit { color: #d4af37; font-size: 12px; font-weight: 600; padding-right: 2px; }

/* 实时计算指示器 */
.live-indicator {
    display: inline-flex; align-items: center; gap: 6px;
    background: linear-gradient(135deg, #f0f9eb, #e7f5dc);
    border: 1px solid #c2e7b0;
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 12px;
    color: #67C23A;
    font-weight: 600;
    transition: all 0.3s;
    margin-right: 8px;
}
.live-indicator .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #67C23A;
    box-shadow: 0 0 0 0 rgba(103, 194, 58, 0.7);
    animation: live-pulse 1.6s infinite;
}
.live-indicator.flash {
    background: linear-gradient(135deg, #fffbe6, #fff5d9);
    border-color: #d4af37;
    color: #b7950b;
    transform: scale(1.04);
}
.live-indicator.flash .dot { background: #d4af37; box-shadow: 0 0 8px rgba(212, 175, 55, 0.6); animation: none; }
.ind-text { white-space: nowrap; }
.ind-time { color: #999; font-weight: normal; font-size: 11px; }
@keyframes live-pulse {
    0% { box-shadow: 0 0 0 0 rgba(103, 194, 58, 0.6); }
    70% { box-shadow: 0 0 0 8px rgba(103, 194, 58, 0); }
    100% { box-shadow: 0 0 0 0 rgba(103, 194, 58, 0); }
}

/* KPI 区 flash */
.kpi-summary.flash .kpi-mini {
    animation: kpi-flash 0.6s ease;
}
@keyframes kpi-flash {
    0% { transform: scale(1); }
    35% { transform: scale(1.03); box-shadow: 0 4px 18px rgba(212, 175, 55, 0.25); }
    100% { transform: scale(1); }
}
.form-item.readout .fi-readout { padding: 7px 10px; background: #f0f9eb; border: 1px solid #c2e7b0; border-radius: 6px; font-size: 13px; color: #555; font-family: monospace; }

.scenario-switcher { display: flex; align-items: center; gap: 14px; margin-top: 12px; padding-top: 10px; border-top: 1px dashed #e4e7ed; flex-wrap: wrap; }
.ss-label { font-size: 12px; color: #666; }
.ss-current { font-size: 12px; color: #b7950b; }
.ss-current b { color: #d4af37; }

.capex-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 18px; }
.capex-summary { background: linear-gradient(135deg, #fffbe6, #fff5d9); border-radius: 10px; padding: 14px 16px; border: 1px solid #f3e6c0; }
.cs-title { font-weight: bold; color: #b7950b; margin-bottom: 10px; font-size: 13px; }
.cs-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
.cs-row .dim { color: #999; }
.cs-row.hl { font-weight: bold; border-top: 2px solid #d4af37; padding-top: 8px; margin-top: 4px; color: #b7950b; font-size: 14px; }
.cs-row.sub { font-size: 11px; color: #999; border-top: 1px dashed #f0f0f0; padding-top: 4px; }

.block-title { font-size: 14px; color: #333; margin: 20px 0 10px; padding-left: 8px; border-left: 3px solid #d4af37; }

.payback-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 10px; }
.pb-card { background: #fafafa; border-radius: 10px; padding: 14px; text-align: center; border-top: 3px solid #e4e7ed; }
.pb-card.recommended { background: linear-gradient(135deg, #fffbe6, #fff5d9); border-top-color: #d4af37; }
.pb-label { font-size: 11px; color: #666; margin-bottom: 4px; }
.pb-val { font-size: 26px; font-weight: 800; color: #333; }
.pb-val small { font-size: 12px; color: #999; font-weight: 500; }

.chart-wrap { height: 280px; margin-top: 16px; }
.formula-note { font-size: 12px; color: #999; padding: 10px 14px; background: #fdf6ec; border-radius: 6px; line-height: 1.6; margin-top: 12px; }
.cell-total { color: #d4af37; font-weight: bold; }
.cell-profit-pos { color: #27ae60; font-weight: bold; }
.cell-profit-neg { color: #f56c6c; font-weight: bold; }
.delta-up { color: #27ae60; font-weight: bold; }
.delta-down { color: #f56c6c; font-weight: bold; }
.delta-flat { color: #999; }

:deep(.row-recommended) { background: #fffbe6 !important; }

.note-section { margin-top: 20px; padding-top: 16px; border-top: 1px solid #f0f0f0; }
.note-label { display: block; font-size: 12px; color: #666; margin-bottom: 6px; }

/* 风险与决策（评估案例） */
.risk-section { margin-top: 18px; padding: 14px 16px; background: #fdf6ec; border: 1px solid #f3e0bd; border-radius: 10px; }
.risk-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.risk-title { font-weight: bold; color: #333; font-size: 13px; }
.terms-box { margin-bottom: 10px; }
.terms-title { font-size: 12px; color: #b7950b; margin-bottom: 4px; }
.terms-list { margin: 0; padding-left: 18px; font-size: 12px; color: #666; line-height: 1.8; }
.risk-list { display: flex; flex-direction: column; gap: 7px; }
.risk-item { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: #444; line-height: 1.6; }
.risk-item :deep(.el-tag) { margin-top: 1px; flex-shrink: 0; }
.risk-point { flex: 1; }
.pc-declined .val { color: #f56c6c; }

@media (max-width: 1200px) {
  .layout { grid-template-columns: 1fr; }
  .kpi-summary { grid-template-columns: repeat(2, 1fr); }
  .form-grid { grid-template-columns: repeat(2, 1fr); }
  .payback-grid { grid-template-columns: repeat(2, 1fr); }
  .capex-grid { grid-template-columns: 1fr; }
}
</style>
