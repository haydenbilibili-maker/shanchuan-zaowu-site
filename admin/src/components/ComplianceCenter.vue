<template>
  <div class="compliance-center module-wrapper">
    <div class="module-header">
      <div class="title-box">
        <h2>合规专栏</h2>
        <span class="subtitle">COMPLIANCE CENTER</span>
      </div>
      <div class="actions">
        <el-button size="small" @click="resetAll">重置默认</el-button>
        <el-button size="small" type="primary" @click="saveAll">保存</el-button>
      </div>
    </div>

    <div class="info-card">
      <h2 class="section-title">合规专栏 · 核心事项管理</h2>
      <p class="section-text">
        <strong>依据：</strong>《中国动植物标本产业链深度调研与“山海造物”品牌拓展战略报告》政策法规与合规体系章节。
        本模块将合规事项结构化为可执行清单、物种清单、采购证据链与大型标本台账，并提供完整度核查与风险提示。
      </p>
    </div>

    <div class="compliance-grid">
      <div class="chart-card full-width">
        <div class="compliance-toolbar">
          <h3 class="chart-title">相关知识库</h3>
          <div class="toolbar-right">
            <input v-model="kbSearch" class="filter-input" placeholder="搜索：标题/关键词/正文" />
            <button class="chart-action-btn" @click="newKbEntry">新增条目</button>
            <button class="chart-action-btn" @click="saveKb">保存</button>
            <button class="chart-action-btn" @click="resetKb">重置默认</button>
          </div>
        </div>

        <div class="kb-layout">
          <div class="kb-list">
            <div
              v-for="it in filteredKbEntries"
              :key="it.id"
              class="kb-item"
              :class="{ active: selectedKbId === it.id }"
              @click="selectKb(it.id)"
            >
              <div class="kb-item-title">{{ it.title || '未命名条目' }}</div>
              <div class="kb-item-meta">{{ it.tags?.join(' / ') || '—' }}</div>
            </div>
          </div>

          <div class="kb-editor" v-if="currentKb">
            <div v-if="currentKb.docUrl" class="kb-doc">
              <div class="kb-doc-bar">
                <span class="kb-doc-hint">附件 PDF（扫描件，支持内嵌预览）</span>
                <a :href="currentKb.docUrl" class="kb-doc-link" target="_blank" rel="noopener noreferrer">新窗口打开</a>
              </div>
              <iframe :src="currentKb.docUrl" class="kb-pdf-frame" title="PDF 预览" />
            </div>
            <div class="kb-row">
              <div class="sf-label">标题</div>
              <input v-model="currentKb.title" class="cell-input" placeholder="法规/制度/要点标题" />
            </div>
            <div class="kb-row">
              <div class="sf-label">关键词（逗号分隔）</div>
              <input v-model="kbTagsInput" class="cell-input" placeholder="例如：CITES, 进出口, 允许进出口证明书" />
            </div>
            <div class="kb-row">
              <div class="sf-label">正文（可粘贴原文/摘录，建议保留条款编号）</div>
              <textarea v-model="currentKb.content" class="kb-textarea" rows="14" placeholder="粘贴法规原文或内部解读…"></textarea>
            </div>
            <div class="kb-actions">
              <button class="mini-btn" @click="applyKbTags">应用关键词</button>
              <button class="mini-btn danger" @click="removeKbEntry(currentKb.id)">删除条目</button>
            </div>
          </div>

          <div class="kb-editor kb-empty" v-else>
            请选择左侧条目，或点击“新增条目”建立知识库内容。
          </div>
        </div>
      </div>

      <div class="chart-card">
        <h3 class="chart-title">合规覆盖率</h3>
        <div class="compliance-progress">
          <div class="progress-label">
            <span>已完成</span>
            <span class="progress-num">{{ complianceStats.done }}/{{ complianceItems.length }}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: complianceStats.coverage + '%' }"></div>
          </div>
          <div class="progress-hint">覆盖率 {{ complianceStats.coverage.toFixed(0) }}% · 高风险未关闭 {{ complianceStats.highOpen }}</div>
        </div>
      </div>

      <div class="chart-card">
        <h3 class="chart-title">合规红线（绝对禁区）</h3>
        <div class="compliance-cards">
          <div class="compliance-callout danger">
            <div class="callout-title">绝对禁止商业贸易</div>
            <ul>
              <li>犀牛、虎及其制品（任何来源均禁止）</li>
              <li>象牙及其制品（2017 起全面禁止商业性加工销售）</li>
              <li>避免误导性命名：如“象牙果”需明确标注为植物来源</li>
            </ul>
          </div>
          <div class="compliance-callout warning">
            <div class="callout-title">高敏物种与“三有”动态调整</div>
            <ul>
              <li>“三有”名录动态调整：新增/调出会改变审批流程与合规成本</li>
              <li>选品策略：优先使用政策相对宽松的无脊椎与植物；对名录调整保持持续跟踪</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="chart-card full-width">
        <div class="compliance-toolbar">
          <h3 class="chart-title">物种合规清单</h3>
          <div class="toolbar-right">
            <input v-model="speciesSearch" class="filter-input" placeholder="搜索：物种/别名/备注" />
            <select v-model="speciesTab" class="filter-select">
              <option value="banned">绝对禁止</option>
              <option value="sanyou">三有/敏感</option>
              <option value="protected">保护名录</option>
            </select>
            <button class="chart-action-btn" @click="addSpeciesItem">新增</button>
            <button class="chart-action-btn" @click="saveSpeciesLists">保存</button>
            <button class="chart-action-btn" @click="resetSpeciesLists">重置默认</button>
          </div>
        </div>

        <div class="species-table">
          <div class="st-head">
            <div>名称</div>
            <div>别名/说明</div>
            <div>来源/依据</div>
            <div>备注</div>
            <div></div>
          </div>
          <div v-for="row in filteredSpeciesList" :key="row.id" class="st-row">
            <div><input v-model="row.name" class="cell-input" placeholder="物种/关键词" /></div>
            <div><input v-model="row.alias" class="cell-input" placeholder="别名/识别要点" /></div>
            <div><input v-model="row.basis" class="cell-input" placeholder="依据/链接/内部文档" /></div>
            <div><input v-model="row.note" class="cell-input" placeholder="备注" /></div>
            <div class="st-actions">
              <button class="mini-btn danger" @click="removeSpeciesItem(row.id)">删除</button>
            </div>
          </div>
        </div>

        <div class="compliance-note">
          <strong>使用建议：</strong>该清单用于“选品预审/命名审核/内容审核”的第一层过滤；三有/保护名录可能动态调整，建议每季度复核一次。
        </div>
      </div>

      <div class="chart-card full-width">
        <div class="compliance-toolbar">
          <h3 class="chart-title">合规事项清单（可执行）</h3>
          <div class="toolbar-right">
            <select v-model="complianceFilter.risk" class="filter-select">
              <option value="">全部风险</option>
              <option value="high">高风险</option>
              <option value="medium">中风险</option>
              <option value="low">低风险</option>
            </select>
            <select v-model="complianceFilter.status" class="filter-select">
              <option value="">全部状态</option>
              <option value="open">待处理</option>
              <option value="doing">进行中</option>
              <option value="done">已完成</option>
            </select>
            <button class="chart-action-btn" @click="resetCompliance">重置默认</button>
            <button class="chart-action-btn" @click="saveCompliance">保存</button>
          </div>
        </div>

        <div class="compliance-table">
          <div class="ct-head">
            <div>事项</div>
            <div>风险</div>
            <div>状态</div>
            <div>证据链/材料</div>
            <div>负责人</div>
          </div>
          <div v-for="item in filteredComplianceItems" :key="item.id" class="ct-row">
            <div class="ct-title">
              <div class="t1">{{ item.title }}</div>
              <div class="t2">{{ item.desc }}</div>
            </div>
            <div class="ct-pill">
              <span class="pill" :class="item.risk">{{ riskText[item.risk] }}</span>
            </div>
            <div class="ct-pill">
              <select v-model="item.status" class="cell-select">
                <option value="open">待处理</option>
                <option value="doing">进行中</option>
                <option value="done">已完成</option>
              </select>
            </div>
            <div class="ct-evidence">
              <ul>
                <li v-for="(e, idx) in item.evidence" :key="idx">{{ e }}</li>
              </ul>
            </div>
            <div class="ct-owner">
              <input v-model="item.owner" class="cell-input" placeholder="负责人" />
            </div>
          </div>
        </div>
      </div>

      <div class="chart-card full-width">
        <div class="compliance-toolbar">
          <h3 class="chart-title">大型标本台账（录入/核查/风险提示）</h3>
          <div class="toolbar-right">
            <input v-model="specimenSearch" class="filter-input" placeholder="搜索：标本名/物种/供应商/证号/标识号" />
            <select v-model="specimenRiskFilter" class="filter-select">
              <option value="">全部风险</option>
              <option value="high">高风险</option>
              <option value="medium">中风险</option>
              <option value="low">低风险</option>
            </select>
            <button class="chart-action-btn" @click="newSpecimen">新增标本</button>
            <button class="chart-action-btn" @click="upsertSpecimen(specimenForm)">保存标本</button>
          </div>
        </div>

        <div class="specimen-form">
          <div class="sf-grid">
            <div class="sf-item"><div class="sf-label">标本名称</div><input v-model="specimenForm.name" class="cell-input" placeholder="例如：暹罗鳄头骨标本" /></div>
            <div class="sf-item"><div class="sf-label">物种/关键词</div><input v-model="specimenForm.species" class="cell-input" placeholder="中文/学名/关键词" /></div>
            <div class="sf-item">
              <div class="sf-label">来源类型</div>
              <select v-model="specimenForm.sourceType" class="cell-select">
                <option value="breeding">人工繁育</option>
                <option value="import">进口</option>
                <option value="purchase">采购</option>
                <option value="consignment">寄售/合作方</option>
                <option value="unknown">未知</option>
              </select>
            </div>
            <div class="sf-item"><div class="sf-label">保护/三有等级</div><input v-model="specimenForm.protectedLevel" class="cell-input" placeholder="一级/二级/三有/非保护/未知" /></div>
            <div class="sf-item"><div class="sf-label">供应商</div><input v-model="specimenForm.supplier" class="cell-input" placeholder="供应商/养殖场/加工企业" /></div>
            <div class="sf-item"><div class="sf-label">批次号</div><input v-model="specimenForm.batchNo" class="cell-input" placeholder="批次/编号" /></div>
            <div class="sf-item"><div class="sf-label">入库日期</div><input v-model="specimenForm.entryDate" class="cell-input" placeholder="YYYY-MM-DD" /></div>
            <div class="sf-item"><div class="sf-label">存放位置</div><input v-model="specimenForm.storageLocation" class="cell-input" placeholder="库位/展柜/仓位" /></div>
            <div class="sf-item sf-check">
              <label class="check"><input type="checkbox" v-model="specimenForm.hasSpecialTag" /> 专用标识</label>
              <input v-model="specimenForm.specialTagCode" class="cell-input" placeholder="标识号/扫码信息" :disabled="!specimenForm.hasSpecialTag" />
            </div>
            <div class="sf-item sf-check">
              <label class="check"><input type="checkbox" v-model="specimenForm.hasCollectionCert" /> 收藏证</label>
              <input v-model="specimenForm.collectionCertNo" class="cell-input" placeholder="收藏证编号" :disabled="!specimenForm.hasCollectionCert" />
            </div>
            <div class="sf-item sf-wide">
              <div class="sf-label">备注</div>
              <input v-model="specimenForm.notes" class="cell-input" placeholder="补充说明、风险点、处理意见" />
            </div>
          </div>

          <div class="sf-risk" :class="specimenRisk(specimenForm).risk">
            <div class="sf-risk-title">完整度核查与风险提示</div>
            <div v-if="specimenRisk(specimenForm).missing.length > 0" class="sf-risk-line">
              <strong>缺失：</strong>{{ specimenRisk(specimenForm).missing.join('、') }}
            </div>
            <div v-if="specimenRisk(specimenForm).highFlags.length > 0" class="sf-risk-line">
              <strong>高风险：</strong>
              <ul>
                <li v-for="(x, i) in specimenRisk(specimenForm).highFlags" :key="i">{{ x }}</li>
              </ul>
            </div>
            <div v-if="specimenRisk(specimenForm).missing.length === 0 && specimenRisk(specimenForm).highFlags.length === 0" class="sf-risk-line">
              当前记录完整度良好，未发现明显高风险项。
            </div>
          </div>
        </div>

        <div class="specimen-list">
          <div class="ct-head">
            <div>标本</div>
            <div>风险</div>
            <div>来源/等级</div>
            <div>证据链</div>
            <div>操作</div>
          </div>
          <div v-for="s in filteredSpecimens" :key="s.id" class="ct-row">
            <div class="ct-title">
              <div class="t1">{{ s.name || '未命名标本' }}</div>
              <div class="t2">{{ s.species }} · {{ s.supplier || '未填供应商' }} · 入库 {{ s.entryDate || '-' }} · {{ s.storageLocation || '未填位置' }}</div>
            </div>
            <div class="ct-pill">
              <span class="pill" :class="specimenRisk(s).risk">
                {{ specimenRisk(s).risk === 'high' ? '高风险' : (specimenRisk(s).risk === 'medium' ? '待完善' : '低风险') }}
              </span>
            </div>
            <div class="ct-evidence">
              <div>来源：{{ s.sourceType }} / {{ s.protectedLevel || '未标注' }}</div>
              <div>批次：{{ s.batchNo || '-' }}</div>
            </div>
            <div class="ct-evidence">
              <div>专用标识：{{ s.hasSpecialTag ? (s.specialTagCode || '已勾选未填') : '无' }}</div>
              <div>收藏证：{{ s.hasCollectionCert ? (s.collectionCertNo || '已勾选未填') : '无' }}</div>
            </div>
            <div class="st-actions">
              <button class="mini-btn" @click="specimenForm = { ...s }">编辑</button>
              <button class="mini-btn danger" @click="removeSpecimen(s.id)">删除</button>
            </div>
          </div>
        </div>
      </div>

      <div class="chart-card full-width">
        <div class="compliance-toolbar">
          <h3 class="chart-title">采购记录录入（证据链）</h3>
          <div class="toolbar-right">
            <button class="chart-action-btn" @click="newProcurement">新增采购</button>
            <button class="chart-action-btn" @click="upsertProcurement(procurementForm)">保存采购</button>
          </div>
        </div>

        <div class="proc-form">
          <div class="sf-grid">
            <div class="sf-item"><div class="sf-label">供应商</div><input v-model="procurementForm.supplier" class="cell-input" placeholder="供应商/养殖场/加工厂" /></div>
            <div class="sf-item"><div class="sf-label">联系人</div><input v-model="procurementForm.contact" class="cell-input" placeholder="电话/微信/邮箱" /></div>
            <div class="sf-item"><div class="sf-label">日期</div><input v-model="procurementForm.date" class="cell-input" placeholder="YYYY-MM-DD" /></div>
            <div class="sf-item"><div class="sf-label">金额</div><input v-model="procurementForm.amount" class="cell-input" placeholder="¥" /></div>
            <div class="sf-item sf-wide"><div class="sf-label">采购内容</div><input v-model="procurementForm.items" class="cell-input" placeholder="品类/数量/规格" /></div>
            <div class="sf-item sf-wide">
              <div class="sf-label">证据材料</div>
              <div class="docs">
                <label class="check"><input type="checkbox" v-model="procurementForm.docs.contract" /> 合同</label>
                <label class="check"><input type="checkbox" v-model="procurementForm.docs.invoice" /> 发票</label>
                <label class="check"><input type="checkbox" v-model="procurementForm.docs.deliveryNote" /> 出货/送货单</label>
                <label class="check"><input type="checkbox" v-model="procurementForm.docs.breedingProof" /> 养殖/来源证明</label>
                <label class="check"><input type="checkbox" v-model="procurementForm.docs.quarantine" /> 检疫/检验证明</label>
                <label class="check"><input type="checkbox" v-model="procurementForm.docs.customs" /> 报关/进口资料</label>
                <label class="check"><input type="checkbox" v-model="procurementForm.docs.other" /> 其他</label>
              </div>
            </div>
            <div class="sf-item sf-wide"><div class="sf-label">备注</div><input v-model="procurementForm.notes" class="cell-input" placeholder="补充说明" /></div>
          </div>
        </div>

        <div class="proc-list">
          <div class="ct-head">
            <div>采购</div>
            <div>材料覆盖</div>
            <div>日期/金额</div>
            <div>内容</div>
            <div>操作</div>
          </div>
          <div v-for="p in procurements" :key="p.id" class="ct-row">
            <div class="ct-title">
              <div class="t1">{{ p.supplier || '未填供应商' }}</div>
              <div class="t2">{{ p.contact || '-' }}</div>
            </div>
            <div class="ct-evidence">
              <div>合同：{{ p.docs?.contract ? '✅' : '—' }} / 出货单：{{ p.docs?.deliveryNote ? '✅' : '—' }} / 来源证明：{{ p.docs?.breedingProof ? '✅' : '—' }}</div>
              <div>发票：{{ p.docs?.invoice ? '✅' : '—' }} / 检疫：{{ p.docs?.quarantine ? '✅' : '—' }} / 报关：{{ p.docs?.customs ? '✅' : '—' }}</div>
            </div>
            <div class="ct-evidence">{{ p.date || '-' }} · {{ p.amount || '-' }}</div>
            <div class="ct-evidence">{{ p.items || '-' }}</div>
            <div class="st-actions">
              <button class="mini-btn" @click="procurementForm = { ...p, docs: { ...p.docs } }">编辑</button>
              <button class="mini-btn danger" @click="removeProcurement(p.id)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const COMPLIANCE_STORAGE_KEY = 'sc_strategy_compliance_items_v1'
const SPECIES_LIST_STORAGE_KEY = 'sc_strategy_compliance_species_lists_v1'
const SPECIES_LIST_VERSION = 1
const SPECIMEN_STORAGE_KEY = 'sc_strategy_compliance_specimens_v1'
const PROCUREMENT_STORAGE_KEY = 'sc_strategy_compliance_procurements_v1'
const KB_STORAGE_KEY = 'sc_compliance_kb_v1'

const riskText = { high: '高风险', medium: '中风险', low: '低风险' }

const defaultComplianceItems = () => ([
  { id: 'c-001', title: '绝对禁区物种排除', desc: '选品/素材/命名均不得涉及虎、犀牛、象牙等绝对禁区；避免误导性命名。', risk: 'high', status: 'open', evidence: ['选品禁区清单（内部）', '商品命名规范与敏感词库'], owner: '' },
  { id: 'c-002', title: '“三有”与保护名录定期复核', desc: '对“三有”名录动态调整与保护名录变更保持追踪，评估SKU影响与审批流程变化。', risk: 'high', status: 'doing', evidence: ['名录版本记录（季度）', 'SKU 受影响清单与替代方案'], owner: '' },
  { id: 'c-003', title: '白名单/可经营利用物种策略', desc: '优先使用可商业经营利用“白名单”物种与政策相对宽松的无脊椎/植物，降低合规成本。', risk: 'medium', status: 'open', evidence: ['白名单物种列表（内部整理）', '供应商资质与出货单样例'], owner: '' },
  { id: 'c-004', title: '专用标识与《标本收藏证》闭环', desc: '涉及重点保护物种的标本，必须具备专用标识与收藏证，做到可追溯、可核验、可归档。', risk: 'high', status: 'open', evidence: ['专用标识照片/扫码记录', '收藏证扫描件', '入库/出库台账'], owner: '' },
  { id: 'c-005', title: '防“洗白”采购制度', desc: '对来源模糊、手续不完整、价格异常的货源一票否决；供应商分级管理与抽检机制。', risk: 'high', status: 'open', evidence: ['供应商尽调表', '抽检与复核记录', '拒绝采购记录'], owner: '' },
  { id: 'c-006', title: '上游来源证明与证据链标准化', desc: '昆虫/贝类/植物等“相对宽松物种”也需保留来源证明（养殖场出货单/采购合同/物流单）。', risk: 'medium', status: 'doing', evidence: ['出货单/采购合同模板', '物流/批次号与照片留存规则'], owner: '' },
  { id: 'c-007', title: '跨境/进口合规（如涉及）', desc: '涉 CITES/濒危物种、动植物检疫、海关申报等，必须在方案阶段完成合规审查。', risk: 'high', status: 'open', evidence: ['进口许可/检疫证明（如适用）', '报关单/申报要素归档'], owner: '' },
  { id: 'c-008', title: '内容与营销合规（平台与公众沟通）', desc: '商品详情页与宣发内容避免“野生捕猎/猎奇炫耀”叙事，强调自然教育、可持续与合规来源。', risk: 'low', status: 'open', evidence: ['详情页话术规范', '平台审核敏感点清单'], owner: '' }
])

const loadCompliance = () => {
  try { const raw = localStorage.getItem(COMPLIANCE_STORAGE_KEY); const p = raw ? JSON.parse(raw) : null; return Array.isArray(p) ? p : null } catch { return null }
}
const complianceItems = ref(loadCompliance() || defaultComplianceItems())
const complianceFilter = ref({ risk: '', status: '' })
const saveCompliance = () => { try { localStorage.setItem(COMPLIANCE_STORAGE_KEY, JSON.stringify(complianceItems.value)) } catch {} }
watch(complianceItems, () => Promise.resolve().then(() => saveCompliance()), { deep: true })

const filteredComplianceItems = computed(() => {
  let list = complianceItems.value || []
  if (complianceFilter.value.risk) list = list.filter(i => i.risk === complianceFilter.value.risk)
  if (complianceFilter.value.status) list = list.filter(i => i.status === complianceFilter.value.status)
  return list
})
const complianceStats = computed(() => {
  const total = complianceItems.value.length || 0
  const done = complianceItems.value.filter(i => i.status === 'done').length
  const highOpen = complianceItems.value.filter(i => i.risk === 'high' && i.status !== 'done').length
  const coverage = total === 0 ? 0 : (done / total) * 100
  return { total, done, highOpen, coverage }
})
const resetCompliance = () => { complianceItems.value = defaultComplianceItems(); saveCompliance() }

const defaultSpeciesLists = () => ({
  version: SPECIES_LIST_VERSION,
  banned: [
    { id: 'b-001', name: '虎', alias: '虎皮/虎骨/虎牙等制品', basis: '红线：绝对禁止商业贸易', note: '' },
    { id: 'b-002', name: '犀牛', alias: '犀牛角/犀牛皮等制品', basis: '红线：绝对禁止商业贸易', note: '' },
    { id: 'b-003', name: '象牙', alias: '象牙制品（雕刻/饰品/摆件）', basis: '2017 起全面禁止商业性加工销售', note: '' }
  ],
  sanyou: [
    { id: 's-001', name: '三有动物（占位）', alias: '按最新“三有名录”维护', basis: '名录动态调整（需季度复核）', note: '在此维护敏感物种与审批提示' }
  ],
  protected: [
    { id: 'p-001', name: '国家重点保护野生动物（占位）', alias: '按最新重点保护名录维护', basis: '涉及专用标识与收藏证制度', note: '建议按一级/二级/附录分类维护' }
  ]
})
const loadSpeciesLists = () => {
  try {
    const raw = localStorage.getItem(SPECIES_LIST_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.banned || !parsed.sanyou || !parsed.protected) return null
    return parsed
  } catch { return null }
}
const speciesLists = ref(loadSpeciesLists() || defaultSpeciesLists())
const saveSpeciesLists = () => { try { localStorage.setItem(SPECIES_LIST_STORAGE_KEY, JSON.stringify(speciesLists.value)) } catch {} }
watch(speciesLists, () => Promise.resolve().then(() => saveSpeciesLists()), { deep: true })
const resetSpeciesLists = () => { speciesLists.value = defaultSpeciesLists(); saveSpeciesLists() }

const speciesTab = ref('banned')
const speciesSearch = ref('')
const activeSpeciesList = computed(() => speciesLists.value?.[speciesTab.value] || [])
const filteredSpeciesList = computed(() => {
  const q = (speciesSearch.value || '').trim().toLowerCase()
  if (!q) return activeSpeciesList.value
  return activeSpeciesList.value.filter(r => `${r.name || ''} ${r.alias || ''} ${r.basis || ''} ${r.note || ''}`.toLowerCase().includes(q))
})
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const addSpeciesItem = () => {
  const key = speciesTab.value
  const list = speciesLists.value[key] || []
  list.unshift({ id: newId(key[0] || 'x'), name: '', alias: '', basis: '', note: '' })
  speciesLists.value[key] = list
}
const removeSpeciesItem = (id) => {
  const key = speciesTab.value
  speciesLists.value[key] = (speciesLists.value[key] || []).filter(r => r.id !== id)
  saveSpeciesLists()
}

const loadJsonArray = (key) => { try { const raw = localStorage.getItem(key); const p = raw ? JSON.parse(raw) : []; return Array.isArray(p) ? p : [] } catch { return [] } }
const saveJsonArray = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }

// ------------------------------
// 合规知识库（本地可编辑 + 持久化）
// ------------------------------
const SANYOU_KB_ID = 'kb-002'

const defaultSanyouKbEntry = () => ({
  id: SANYOU_KB_ID,
  title: '国家保护的有益的或者有重要经济、科学研究价值的陆生野生动物名录（三有名录）',
  tags: ['三有名录', '陆生野生动物', '名录', '合规选品', 'PDF'],
  docUrl: '/sanyou-minglu.pdf',
  content:
`本条目附带《三有名录》原文 PDF（扫描件），上方可直接内嵌预览。

说明：「三有」及配套名录会随政策调整而更新，请以国家林业和草原局等主管部门最新公布文本为准；选品、命名与内容审核请结合本页「物种合规清单—三有/敏感」栏目持续维护，并与法务/合作方意见一致。

若内嵌 PDF 无法显示，请使用「新窗口打开」用系统或浏览器阅读器查看。`
})

const defaultKb = () => ([
  {
    id: 'kb-001',
    title: '中华人民共和国濒危野生动植物进出口管理条例（2006/2018/2019修订）',
    tags: ['CITES', '进出口', '允许进出口证明书', '审批流程', '禁止商业贸易'],
    content:
`（2006年4月12日国务院第131次常务会议通过 2006年4月29日国务院令第465号公布 自2006年9月1日起施行
根据2018年3月19日国务院令第698号修改 根据2019年3月2日国务院令第709号修改）

第一条 为了加强对濒危野生动植物及其产品的进出口管理…履行《濒危野生动植物种国际贸易公约》（CITES），制定本条例。
第二条 进口或者出口公约限制进出口的濒危野生动植物及其产品，应当遵守本条例。
第六条 禁止进口或者出口公约禁止以商业贸易为目的进出口的濒危野生动植物及其产品…
第十条 申请人应当…提交进口/出口合同、名称种类数量用途等材料…
第十一条 国务院野生动植物主管部门应当自收到申请之日起20个工作日内作出批准/不批准决定…
第十二条 取得进出口批准文件后…向国家濒危物种进出口管理机构申请核发允许进出口证明书…
第二十一条 应当向海关提交允许进出口证明书…并在海关放行之日起30日内备案…

（建议：结合本店业务建立“进出口项目清单 + 材料模板 + 口岸与时限提醒”，避免遗漏关键节点。）`
  },
  defaultSanyouKbEntry()
])

const mergeSanyouKbIfMissing = (list) => {
  const base = Array.isArray(list) && list.length ? [...list] : defaultKb()
  if (base.some((x) => x && x.id === SANYOU_KB_ID)) return base
  return [...base, defaultSanyouKbEntry()]
}

const loadKb = () => {
  try {
    const raw = localStorage.getItem(KB_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

const _loadedKb = loadKb()
const _mergedKb = mergeSanyouKbIfMissing(_loadedKb || defaultKb())
const kbEntries = ref(_mergedKb)
const kbSearch = ref('')
const selectedKbId = ref(kbEntries.value[0]?.id || '')
const kbTagsInput = ref('')

const saveKb = () => {
  try { localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(kbEntries.value)) } catch {}
}

if (JSON.stringify(_loadedKb) !== JSON.stringify(_mergedKb)) {
  saveKb()
}

watch(kbEntries, () => Promise.resolve().then(() => saveKb()), { deep: true })

const resetKb = () => {
  kbEntries.value = defaultKb()
  selectedKbId.value = kbEntries.value[0]?.id || ''
  kbTagsInput.value = ''
  saveKb()
}

const filteredKbEntries = computed(() => {
  const q = (kbSearch.value || '').trim().toLowerCase()
  if (!q) return kbEntries.value
  return (kbEntries.value || []).filter((it) => {
    const hay = `${it.title || ''} ${(it.tags || []).join(' ')} ${it.content || ''} ${it.docUrl || ''}`.toLowerCase()
    return hay.includes(q)
  })
})

const currentKb = computed(() => (kbEntries.value || []).find(x => x.id === selectedKbId.value) || null)

const selectKb = (id) => {
  selectedKbId.value = id
  const it = (kbEntries.value || []).find(x => x.id === id)
  kbTagsInput.value = (it?.tags || []).join(', ')
}

const newKbEntry = () => {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const entry = { id: `kb-${id}`, title: '', tags: [], content: '' }
  kbEntries.value.unshift(entry)
  selectKb(entry.id)
}

const applyKbTags = () => {
  if (!currentKb.value) return
  const tags = (kbTagsInput.value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 20)
  currentKb.value.tags = tags
  saveKb()
}

const removeKbEntry = (id) => {
  kbEntries.value = (kbEntries.value || []).filter(x => x.id !== id)
  if (selectedKbId.value === id) {
    selectedKbId.value = kbEntries.value[0]?.id || ''
    kbTagsInput.value = (kbEntries.value[0]?.tags || []).join(', ')
  }
  saveKb()
}

const specimens = ref(loadJsonArray(SPECIMEN_STORAGE_KEY))
const procurements = ref(loadJsonArray(PROCUREMENT_STORAGE_KEY))
watch(specimens, () => Promise.resolve().then(() => saveJsonArray(SPECIMEN_STORAGE_KEY, specimens.value)), { deep: true })
watch(procurements, () => Promise.resolve().then(() => saveJsonArray(PROCUREMENT_STORAGE_KEY, procurements.value)), { deep: true })

const specimenSearch = ref('')
const specimenRiskFilter = ref('')
const specimenForm = ref({
  id: '', name: '', species: '', category: 'large', sourceType: 'breeding', protectedLevel: '',
  hasSpecialTag: false, specialTagCode: '', hasCollectionCert: false, collectionCertNo: '',
  supplier: '', purchaseId: '', batchNo: '', entryDate: '', storageLocation: '', notes: ''
})
const newSpecimen = () => {
  specimenForm.value = { id: '', name: '', species: '', category: 'large', sourceType: 'breeding', protectedLevel: '', hasSpecialTag: false, specialTagCode: '', hasCollectionCert: false, collectionCertNo: '', supplier: '', purchaseId: '', batchNo: '', entryDate: '', storageLocation: '', notes: '' }
}

const procurementForm = ref({
  id: '', supplier: '', contact: '', date: '', items: '', amount: '',
  docs: { contract: false, invoice: false, deliveryNote: false, breedingProof: false, quarantine: false, customs: false, other: false },
  notes: ''
})
const newProcurement = () => {
  procurementForm.value = { id: '', supplier: '', contact: '', date: '', items: '', amount: '', docs: { contract: false, invoice: false, deliveryNote: false, breedingProof: false, quarantine: false, customs: false, other: false }, notes: '' }
}

const specimenRisk = (s) => {
  const missing = []
  const highFlags = []
  const protectedText = (s.protectedLevel || '').toLowerCase()
  const sourceType = s.sourceType
  if (!s.species) missing.push('物种/学名/关键词')
  if (!s.supplier) missing.push('供应商')
  if (!s.entryDate) missing.push('入库日期')
  if (!s.storageLocation) missing.push('存放位置')
  const isSensitive = protectedText.includes('一级') || protectedText.includes('二级') || protectedText.includes('三有') || protectedText.includes('重点') || protectedText.includes('未知')
  if (isSensitive) {
    if (!s.hasSpecialTag) missing.push('专用标识')
    if (!s.hasCollectionCert) missing.push('收藏证')
  }
  if (protectedText.includes('一级') || protectedText.includes('重点')) highFlags.push('疑似重点保护物种：必须专用标识 + 收藏证 + 完整来源证明')
  if (sourceType === 'unknown') highFlags.push('来源未知：高风险，建议暂停展示/销售并补齐证据链')
  if (isSensitive && (!s.hasSpecialTag || !s.hasCollectionCert)) highFlags.push('敏感物种证据链不完整：存在合规风险')
  const risk = highFlags.length > 0 ? 'high' : (missing.length > 0 ? 'medium' : 'low')
  return { risk, missing, highFlags }
}
const filteredSpecimens = computed(() => {
  const q = (specimenSearch.value || '').trim().toLowerCase()
  let list = specimens.value || []
  if (q) list = list.filter(s => `${s.name || ''} ${s.species || ''} ${s.supplier || ''} ${s.collectionCertNo || ''} ${s.specialTagCode || ''}`.toLowerCase().includes(q))
  if (specimenRiskFilter.value) list = list.filter(s => specimenRisk(s).risk === specimenRiskFilter.value)
  return list
})
const upsertSpecimen = (s) => {
  const obj = { ...s }
  if (!obj.id) obj.id = newId('sp')
  const idx = specimens.value.findIndex(x => x.id === obj.id)
  if (idx >= 0) specimens.value[idx] = obj
  else specimens.value.unshift(obj)
}
const removeSpecimen = (id) => { specimens.value = specimens.value.filter(s => s.id !== id) }
const upsertProcurement = (p) => {
  const obj = { ...p }
  if (!obj.id) obj.id = newId('pr')
  const idx = procurements.value.findIndex(x => x.id === obj.id)
  if (idx >= 0) procurements.value[idx] = obj
  else procurements.value.unshift(obj)
}
const removeProcurement = (id) => { procurements.value = procurements.value.filter(x => x.id !== id) }

const saveAll = () => { saveCompliance(); saveSpeciesLists(); saveKb(); saveJsonArray(SPECIMEN_STORAGE_KEY, specimens.value); saveJsonArray(PROCUREMENT_STORAGE_KEY, procurements.value) }
const resetAll = () => { resetCompliance(); resetSpeciesLists(); resetKb(); specimens.value = []; procurements.value = []; newSpecimen(); newProcurement(); saveAll() }
</script>

<style scoped>
.compliance-center {
  background: var(--light-bg-primary);
}

.actions {
  display: inline-flex;
  gap: var(--space-3);
}

.info-card {
  background: var(--light-bg-elevated);
  border: 1px solid var(--light-border-subtle);
  border-radius: var(--radius-xl);
  padding: 24px;
  box-shadow: var(--shadow-sm);
  margin-bottom: 20px;
}

.section-title {
  font-size: 22px;
  margin: 0 0 12px 0;
  color: var(--light-text-primary);
  border-left: 4px solid var(--brand-green-500);
  padding-left: 12px;
}

.section-text {
  margin: 0;
  color: var(--light-text-secondary);
  line-height: var(--leading-loose);
}

.compliance-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.chart-card {
  background: var(--light-bg-elevated);
  border: 1px solid var(--light-border-subtle);
  border-radius: 16px;
  padding: 20px;
  box-shadow: var(--shadow-sm);
}

.chart-card.full-width { grid-column: 1 / -1; }

.chart-title {
  margin: 0 0 12px 0;
  color: var(--light-text-primary);
  font-weight: 800;
}

.compliance-progress .progress-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--light-text-secondary);
  font-size: 13px;
  margin-bottom: 10px;
}
.compliance-progress .progress-num { font-weight: 800; color: var(--light-text-primary); }
.progress-bar { height: 10px; border-radius: 999px; background: var(--light-bg-tertiary); border: 1px solid var(--light-border-subtle); overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--brand-green-500), var(--brand-green-300)); }
.progress-hint { margin-top: 10px; font-size: 12px; color: var(--light-text-tertiary); }

.compliance-cards { display: grid; gap: 12px; }
.compliance-callout { border-radius: 12px; padding: 14px 16px; border: 1px solid var(--light-border-default); background: var(--light-bg-elevated); }
.compliance-callout .callout-title { font-weight: 800; color: var(--light-text-primary); margin-bottom: 8px; }
.compliance-callout ul { margin: 0; padding-left: 18px; color: var(--light-text-secondary); line-height: 1.7; font-size: 13px; }
.compliance-callout.danger { border-color: rgba(208, 84, 80, 0.35); background: var(--semantic-error-bg); }
.compliance-callout.warning { border-color: rgba(196, 165, 90, 0.45); background: var(--semantic-warning-bg); }

.compliance-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.toolbar-right { display: inline-flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.filter-input { border: 1px solid var(--light-border-default); border-radius: 10px; padding: 8px 10px; font-size: 13px; background: var(--light-bg-elevated); color: var(--light-text-primary); min-width: 240px; }
.filter-select { border: 1px solid var(--light-border-default); border-radius: 10px; padding: 8px 10px; font-size: 13px; background: var(--light-bg-elevated); color: var(--light-text-primary); }
.chart-action-btn { padding: 8px 12px; background: var(--light-bg-secondary); border: 1px solid var(--light-border-subtle); border-radius: 10px; font-size: 13px; cursor: pointer; color: var(--light-text-secondary); }
.chart-action-btn:hover { background: var(--brand-green-50); border-color: var(--brand-green-400); color: var(--light-text-primary); }

.species-table, .compliance-table { border: 1px solid var(--light-border-default); border-radius: 12px; overflow: hidden; background: var(--light-bg-elevated); }
.st-head, .st-row { display: grid; grid-template-columns: 0.8fr 1.2fr 1.1fr 1.2fr 0.35fr; }
.ct-head, .ct-row { display: grid; grid-template-columns: 1.4fr 0.5fr 0.7fr 1.5fr 0.6fr; }
.st-head, .ct-head { background: var(--light-bg-secondary); color: var(--light-text-secondary); font-weight: 800; font-size: 12px; border-bottom: 1px solid var(--light-border-subtle); }
.st-head > div, .st-row > div, .ct-head > div, .ct-row > div { padding: 12px 14px; border-right: 1px solid var(--light-border-subtle); }
.st-head > div:last-child, .st-row > div:last-child, .ct-head > div:last-child, .ct-row > div:last-child { border-right: none; }
.st-row, .ct-row { border-bottom: 1px solid var(--light-border-subtle); }
.st-row:last-child, .ct-row:last-child { border-bottom: none; }

.cell-input, .cell-select { width: 100%; border: 1px solid var(--light-border-default); border-radius: 10px; padding: 8px 10px; font-size: 13px; background: var(--light-bg-elevated); color: var(--light-text-primary); }
.ct-title .t1 { font-weight: 800; color: var(--light-text-primary); margin-bottom: 4px; }
.ct-title .t2 { font-size: 12px; color: var(--light-text-tertiary); line-height: 1.6; }
.ct-evidence ul { margin: 0; padding-left: 18px; color: var(--light-text-secondary); font-size: 12px; line-height: 1.7; }

.pill { display: inline-flex; align-items: center; justify-content: center; padding: 2px 10px; font-size: 12px; border-radius: 999px; border: 1px solid var(--light-border-default); background: var(--light-bg-elevated); color: var(--light-text-secondary); font-weight: 800; }
.pill.high { border-color: rgba(208, 84, 80, 0.35); background: var(--semantic-error-bg); color: var(--semantic-error-text); }
.pill.medium { border-color: rgba(196, 165, 90, 0.45); background: var(--semantic-warning-bg); color: var(--semantic-warning-text); }
.pill.low { border-color: rgba(45, 106, 79, 0.22); background: var(--semantic-success-bg); color: var(--semantic-success-text); }

.st-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.mini-btn { border: 1px solid var(--light-border-default); background: var(--light-bg-elevated); color: var(--light-text-secondary); border-radius: 10px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
.mini-btn.danger { border-color: rgba(208, 84, 80, 0.35); background: var(--semantic-error-bg); color: var(--semantic-error-text); }

.compliance-note { margin-top: 14px; font-size: 12px; color: var(--light-text-secondary); background: var(--light-bg-secondary); border: 1px solid var(--light-border-subtle); border-radius: 12px; padding: 12px 14px; }

.kb-layout { display: grid; grid-template-columns: 280px 1fr; gap: 12px; }
.kb-list { border: 1px solid var(--light-border-default); border-radius: 12px; overflow: hidden; background: var(--light-bg-elevated); max-height: 520px; overflow-y: auto; }
.kb-item { padding: 12px 14px; border-bottom: 1px solid var(--light-border-subtle); cursor: pointer; }
.kb-item:last-child { border-bottom: none; }
.kb-item.active { background: var(--brand-green-50); }
.kb-item-title { font-weight: 800; color: var(--light-text-primary); font-size: 13px; margin-bottom: 4px; }
.kb-item-meta { color: var(--light-text-tertiary); font-size: 12px; }
.kb-editor { border: 1px solid var(--light-border-default); border-radius: 12px; background: var(--light-bg-elevated); padding: 14px; }
.kb-editor.kb-empty { display: flex; align-items: center; justify-content: center; color: var(--light-text-tertiary); font-size: 13px; min-height: 220px; }
.kb-row { margin-bottom: 12px; }
.kb-doc {
  margin-bottom: 16px;
  border: 1px solid var(--light-border-subtle);
  border-radius: 12px;
  overflow: hidden;
  background: var(--light-bg-secondary);
}
.kb-doc-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--light-border-subtle);
  background: var(--light-bg-elevated);
  font-size: 12px;
  color: var(--light-text-secondary);
}
.kb-doc-hint { font-weight: 700; }
.kb-doc-link {
  color: var(--brand-green-600);
  font-weight: 800;
  text-decoration: none;
}
.kb-doc-link:hover { text-decoration: underline; }
.kb-pdf-frame {
  display: block;
  width: 100%;
  height: min(70vh, 720px);
  border: 0;
  background: var(--light-bg-tertiary, #f0ede6);
}
.kb-textarea { width: 100%; border: 1px solid var(--light-border-default); border-radius: 10px; padding: 10px 12px; font-size: 13px; background: var(--light-bg-elevated); color: var(--light-text-primary); line-height: 1.7; resize: vertical; }
.kb-textarea:focus { outline: none; border-color: var(--brand-green-400); box-shadow: 0 0 0 2px rgba(45, 106, 79, 0.12); }
.kb-actions { display: flex; justify-content: flex-end; gap: 10px; }

.specimen-form, .proc-form { margin-top: 14px; border: 1px solid var(--light-border-default); border-radius: 12px; background: var(--light-bg-elevated); padding: 14px; }
.sf-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.sf-item { min-width: 0; }
.sf-wide { grid-column: 1 / -1; }
.sf-label { font-size: 12px; color: var(--light-text-tertiary); margin-bottom: 6px; font-weight: 800; }
.sf-check { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 10px; }
.check { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--light-text-secondary); font-weight: 700; white-space: nowrap; }
.docs { display: flex; flex-wrap: wrap; gap: 12px; padding: 10px 12px; border: 1px solid var(--light-border-subtle); border-radius: 10px; background: var(--light-bg-secondary); }
.sf-risk { margin-top: 12px; border-radius: 12px; border: 1px solid var(--light-border-default); background: var(--light-bg-secondary); padding: 12px 14px; color: var(--light-text-secondary); }
.sf-risk.high { border-color: rgba(208, 84, 80, 0.35); background: var(--semantic-error-bg); }
.sf-risk.medium { border-color: rgba(196, 165, 90, 0.45); background: var(--semantic-warning-bg); }
.sf-risk.low { border-color: rgba(45, 106, 79, 0.22); background: var(--semantic-success-bg); }
.sf-risk-title { font-weight: 900; color: var(--light-text-primary); margin-bottom: 8px; }
.sf-risk-line { font-size: 12px; line-height: 1.7; }
.sf-risk ul { margin: 6px 0 0 0; padding-left: 18px; }
.specimen-list, .proc-list { margin-top: 14px; }

@media (max-width: 1200px) {
  .compliance-grid { grid-template-columns: 1fr; }
  .sf-grid { grid-template-columns: repeat(2, 1fr); }
  .kb-layout { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .filter-input { min-width: 0; width: 100%; }
  .st-head, .ct-head { display: none; }
  .st-row, .ct-row { grid-template-columns: 1fr; }
  .st-row > div, .ct-row > div { border-right: none; border-bottom: 1px solid var(--light-border-subtle); }
  .st-row > div:last-child, .ct-row > div:last-child { border-bottom: none; }
  .sf-grid { grid-template-columns: 1fr; }
  .sf-check { grid-template-columns: 1fr; }
  .kb-list { max-height: 260px; }
  .kb-pdf-frame { height: min(52vh, 480px); }
}
</style>

