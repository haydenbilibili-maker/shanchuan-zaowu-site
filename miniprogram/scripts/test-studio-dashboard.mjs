#!/usr/bin/env node
/**
 * 工作室仪表盘 · 结算口径守卫（`settlementKpis.js`）
 *
 * 为什么需要（蓝图 §8.4 + 裁决 20）：
 *   ① 原实现把「写入当天即全额计入营收」叫 `revenueTotal`。上了收款之后，
 *      同一个词会被读出两种意思（"发了多少货"vs"收了多少钱"）→ 必须把口径拆开且可断言。
 *   ② **真毛利口径是产品负责人拍板的**：毛利 = 出货额 −（材料费 + 包装费），
 *      **手工费算工作室的收入、不减**。这条口径不能靠"记得"，只能靠断言。
 *   ③ 单位：单据里 `*CostCents`/`totalCents` 是**分**、`totalAmount` 是**元**。
 *      本仓库已因单位混用踩过 E18（总额翻倍且不报错），所以这里也钉一条不变量。
 *   ④ `totalCents` 是新字段：老数据（飞书导入等）没有它，必须**回落到**
 *      `totalAmount` → 明细 —— 回落断了会把历史出货额算成 0（营收凭空消失）。
 *
 * 用法：
 *   node miniprogram/scripts/test-studio-dashboard.mjs
 *   node miniprogram/scripts/test-studio-dashboard.mjs --selftest
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const FN_DIR = resolve(ROOT, 'miniprogram/cloudfunctions/getStudioDashboard')
const KPI_PATH = join(FN_DIR, 'settlementKpis.js')
const DASHBOARD_INDEX = join(FN_DIR, 'index.js')

let passes = 0
const failures = []
function ok(label, cond, detail) {
  if (cond) passes += 1
  else failures.push(detail ? `${label} —— ${detail}` : label)
}
function eq(label, got, want) {
  ok(label, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}

/** 一张已核价、已结清的单：材料 360 + 包装 90 + 手工 135 = 585 */
const S_SETTLED = {
  totalCents: 58500,
  materialCostCents: 36000,
  packagingCostCents: 9000,
  laborCostCents: 13500,
  settleStatus: 'settled',
  pricingStatus: 'priced'
}
/** 门店已标已付、超管未确认：材料 200 + 手工 60 = 260 */
const S_PAID_PENDING = {
  totalCents: 26000,
  materialCostCents: 20000,
  packagingCostCents: 0,
  laborCostCents: 6000,
  settleStatus: 'paid_pending',
  pricingStatus: 'priced'
}
/** 老数据：没有 totalCents / 没有成本字段，只有 totalAmount=100 与待核价 */
const S_LEGACY = { totalAmount: 100, settleStatus: 'unsettled', pricingStatus: 'incomplete' }

function runTests(K) {
  // ── A. 单位换算 ──
  eq('A1 元转分', K.toCents(585), 58500)
  eq('A2 元转分四舍五入', K.toCents(19.995), 2000)
  eq('A3 分转元', K.toYuan(58500), 585)
  eq('A4 分单位字段缺省为 0', K.centsField(undefined), 0)
  eq('A5 分单位字段负数归 0', K.centsField(-5), 0)
  eq('A6 分单位字段取整', K.centsField(1234.6), 1235)

  // ── B. 单据总额的三级回落 ──
  eq('B1 优先用 totalCents（最精确）', K.shipmentTotalCents(S_SETTLED), 58500)
  eq(
    'B2 无 totalCents 时回落到 totalAmount×100',
    K.shipmentTotalCents({ totalAmount: 100, settleStatus: 'unsettled' }),
    10000
  )
  eq(
    'B3 两者都没有时回落到明细求和',
    K.shipmentTotalCents({ items: [{ qty: 2, unitPrice: 30 }, { qty: 1, totalPrice: 15 }] }),
    7500
  )
  eq('B4 全都没有时为 0', K.shipmentTotalCents({}), 0)
  eq('B5 totalCents 为 0 时不被当成"有值"', K.shipmentTotalCents({ totalCents: 0, totalAmount: 5 }), 500)

  // ── C. 三口径拆分 ──
  const k = K.computeSettlementKpis([S_SETTLED, S_PAID_PENDING, S_LEGACY])
  eq('C1 出货额 = 全部有效单据之和', k.shippedAmount, 945)
  eq('C2 已结清额', k.settledAmount, 585)
  eq('C3 未收款额 = 未结 + 已付待确认', k.outstandingAmount, 360)
  eq('C4 其中"已付待确认"单列（待办）', k.paidPendingAmount, 260)
  eq('C5 未结清单数', k.outstandingCount, 2)
  eq('C6 已结清单数', k.settledCount, 1)
  eq('C7 已付待确认单数', k.paidPendingCount, 1)
  ok('C8 三口径自洽（已结清 + 未收款 = 出货额）', k.settledAmount + k.outstandingAmount === k.shippedAmount)
  eq('C9 待核价单数', k.pendingPricingCount, 1)
  ok('C10 老数据没被算成 0（回落生效）', k.shippedAmount > k.settledAmount + k.paidPendingAmount)

  // ── D. 真毛利口径（裁决 20）──
  eq('D1 材料费合计', k.materialCostTotal, 560)
  eq('D2 包装费合计', k.packagingCostTotal, 90)
  eq('D3 手工费合计', k.laborTotal, 195)
  eq('D4 材料+包装', k.materialAndPackagingTotal, 650)
  eq('D5 **真毛利 = 出货额 −（材料 + 包装）**', k.grossProfit, 295)
  eq(
    'D6 **手工费算工作室收入、不减**（若减了手工费，毛利会是 100）',
    k.grossProfit,
    945 - (560 + 90)
  )
  ok('D7 毛利率有值', k.grossMarginPct === 31.2, String(k.grossMarginPct))

  /**
   * ── D8–D11 造景成本（产品负责人 2026-09-19）──
   * 造景是**成本**：进成本合计、扣毛利；但**不进**「材料+包装」那一项（名字与口径必须一致）。
   */
  const ks = K.computeSettlementKpis([
    { totalAmount: 945, materialCostCents: 56000, packagingCostCents: 9000, sceneCostCents: 5000, laborCostCents: 19500, status: 'unsettled' }
  ])
  eq('D8 造景成本合计单列', ks.sceneCostTotal, 50)
  eq('D9 **材料+包装 不含造景**（名字与口径一致）', ks.materialAndPackagingTotal, 650)
  eq('D10 成本合计 = 材料 + 包装 + 造景', ks.costTotal, 700)
  eq('D11 **真毛利 = 出货额 − 成本合计（含造景）**', ks.grossProfit, 945 - 700)
  ok(
    'D11b 老单没有 sceneCostCents 字段时造景按 0（历史数字不变）',
    K.computeSettlementKpis([{ totalAmount: 945, materialCostCents: 56000, packagingCostCents: 9000, laborCostCents: 19500, status: 'unsettled' }]).sceneCostTotal === 0
  )

  // ── E. 边界 ──
  const empty = K.computeSettlementKpis([])
  eq('E1 空数据出货额为 0', empty.shippedAmount, 0)
  eq('E2 **出货额为 0 时毛利率为 null**（0% 与"没数据"含义不同）', empty.grossMarginPct, null)
  eq('E3 空数据不报负数毛利', empty.grossProfit, 0)
  const noStatus = K.computeSettlementKpis([{ totalCents: 10000, materialCostCents: 0, packagingCostCents: 0 }])
  // 10000 分 = 100 元（本守卫第一次跑就是在这里抓到我把 10000 分误算成 10 元）
  eq('E4 缺 settleStatus 视为未结', noStatus.outstandingAmount, 100)
  ok('E5 口径说明随结果回传（前端不必自己解释）', typeof k.note === 'string' && k.note.length > 10)

  // ── F. 单位不变量（E18 的同族防护）──
  ok(
    'F1 出货额（元）×100 精确等于分之和（无浮点尾数）',
    Math.round(k.shippedAmount * 100) === 94500,
    String(k.shippedAmount * 100)
  )
  ok(
    'F2 毛利（元）×100 精确等于分差',
    Math.round(k.grossProfit * 100) === 94500 - 65000,
    String(k.grossProfit * 100)
  )
  const frac = K.computeSettlementKpis([{ totalCents: 12345, materialCostCents: 1, packagingCostCents: 2 }])
  ok('F3 带零头时元值仍是 2 位小数', String(frac.shippedAmount).split('.')[1].length <= 2, String(frac.shippedAmount))
}

/**
 * 预算构成断言（**源码级**，2026-09-20 新增）。
 *
 * 为什么需要：产品负责人报「工作室仪表盘没把**识别到的房租和网费**加进去，预算相关信息错误」。
 * 实测：仪表盘里房租/宽带**只有年度预算常量**（54,200 / 1,098），**没有任何"已用"**；
 * 飞书同步进来的房租/宽带采购行只被并进总「已使用」，拆不出来；各预算池的本地重算
 * 对房租/宽带**没有分支** ⇒ used 恒为 0。这条业务口径此前**没有任何守卫**。
 *
 * 判据只钉"数从哪来"：必须是**按 `budgetType` 汇总的真实支出**（或飞书池的已使用），
 * 不许退回写死的常量；并且要一路露到结构/池子/kpis 上，否则算了也没人看得见。
 */
function budgetSourceProblems (src) {
  const problems = []
  const need = (re, msg) => { if (!re.test(src)) problems.push(msg) }
  need(/const RENT_BUDGET_TYPES = \[/, '缺 RENT_BUDGET_TYPES —— 房租的 budgetType 取值没有登记（识别到的那批行认不出来）')
  need(/const BROADBAND_BUDGET_TYPES = \[[^\]]*'宽带'/.test(src) ? /'宽带'/ : /$^/, 'BROADBAND_BUDGET_TYPES 里没有「宽带」')
  need(/const rentSpend = rentPrepaid !== null \? rentPrepaid : \(rentPoolUsed !== null \? rentPoolUsed : spendOfBudgetTypes\(RENT_BUDGET_TYPES\)\)/,
    '房租实际支出不是"已一次性缴纳 → 飞书池已用 → 按 budgetType 汇总"这条链（可能退回常量了）')
  need(/const broadbandSpend = broadbandPrepaid !== null \? broadbandPrepaid : \(broadbandPoolUsed !== null \? broadbandPoolUsed : spendOfBudgetTypes\(BROADBAND_BUDGET_TYPES\)\)/,
    '宽带/网费实际支出同上')
  // 「已一次性缴纳」的池：飞书那行"已用 0"与它自己的 note 冲突，必须按已缴口径呈现
  need(/const PREPAID_RE = \/一次性缴纳\|已付\//, '缺 PREPAID_RE（"已一次性缴纳"的池会被当成"没花过"）')
  need(/const prepaidAmt = \(p\.category === '房租' && rentPrepaid !== null\)/, '各池清单没有按已缴口径覆盖房租（同页会出现"剩 54200"的错觉）')
  need(/\{ key: 'rent', label: '房租', amount: rentBudget, used: rentSpend/,
    '预算结构里房租那行没带 `used`（只有预算、没有已用 ⇒ 运营看不出这笔账花了多少）')
  need(/\{ key: 'broadband', label: '宽带', amount: broadbandBudget, used: broadbandSpend/,
    '预算结构里宽带那行没带 `used`')
  need(/p\.category === '房租'\) used = rentSpend/, '各预算池的本地重算缺「房租」分支（used 会恒为 0）')
  need(/p\.category === '宽带'\) used = broadbandSpend/, '各预算池的本地重算缺「宽带」分支')
  need(/rentSpend,\s*\n\s*broadbandSpend,\s*\n\s*fixedSpend,/s, 'kpis 没把 rentSpend/broadbandSpend/fixedSpend 露出去（算了也没人看得见）')
  need(/collection: 'property_costs'/, '「物业成本」的集合名不是 property_costs（原来写成不存在的 ops_property_cost）')
  // 「已使用 / 使用率」必须含房租与宽带，且**不能和采购记录重复计账**
  need(/const fixedBudgetTypes = RENT_BUDGET_TYPES\.concat\(BROADBAND_BUDGET_TYPES\)/,
    '缺 fixedBudgetTypes —— 无法把房租/宽带从采购合计里剔除（会重复计账）')
  need(/const purchaseSpendExFixed = roundMoney\(/, '缺 purchaseSpendExFixed（采购合计没有排除房租/宽带行）')
  need(/const usedBudget = roundMoney\(purchaseSpendExFixed \+ rentSpend \+ broadbandSpend\)/,
    '「已使用」没有把房租/宽带算进去（产品负责人 2026-09-21 报的就是这个）')
  // 新增信号：账户余额 = 总预算 − 总支付 + 收入（出货单货款）
  need(/const accountBalance = roundMoney\(totalBudget - usedBudget \+ revenueTotal\)/,
    '账户余额的公式不是「总预算 − 总支付 + 收入（出货单货款）」')
  need(/id: 'account_balance',\s*\n\s*name: '账户余额'/, '预算承压看板里没有「账户余额」这一项')
  if (/const rentSpend = 54200|const rentSpend = roundMoney\(rentBudget\)/.test(src)) {
    problems.push('房租实际支出被写成了常量/预算本身 —— 正是产品负责人报的那个缺陷')
  }
  return problems
}

const SOURCE_INJECTIONS = [
  ['房租实际支出退回常量（就是产品负责人报的那个缺陷）',
   (src) => src.replace('const rentSpend = rentPrepaid !== null ? rentPrepaid : (rentPoolUsed !== null ? rentPoolUsed : spendOfBudgetTypes(RENT_BUDGET_TYPES))', 'const rentSpend = 54200')],
  ['「已使用」把房租/宽带漏掉（产品负责人 2026-09-21 报的那个）',
   (src) => src.replace('const usedBudget = roundMoney(purchaseSpendExFixed + rentSpend + broadbandSpend)', 'const usedBudget = purchaseTotal')],
  ['账户余额项目被删（预算承压看板少一项）',
   (src) => src.replace("      id: 'account_balance',\n      name: '账户余额',", "      id: 'x_removed',\n      name: '账户余额',")],
  ['「已一次性缴纳」的房租被当成没花过（线上实测就是 已用 0）',
   (src) => src.replace('const PREPAID_RE = /一次性缴纳|已付/', 'const PREPAID_RE = /绝不匹配/')],
  ['宽带池的本地重算分支被删（used 恒为 0）',
   (src) => src.replace("      else if (p.category === '宽带') used = broadbandSpend\n", '')],
  ['预算结构里房租那行不再带 used', 
   (src) => src.replace("amount: rentBudget, used: rentSpend", 'amount: rentBudget')],
  ['物业成本集合名又写回不存在的 ops_property_cost',
   (src) => src.replace("collection: 'property_costs'", "collection: 'ops_property_cost'")]
]

const INJECTIONS = [
  [
    '造景不进成本（加了桶却没扣毛利 —— 毛利虚高）',
    (src) => src.replace('  const costCents = materialCents + packagingCents + sceneCents', '  const costCents = materialCents + packagingCents')
  ],
  [
    '「材料+包装」那一项混进造景（名字与口径不一致）',
    (src) => src.replace('    materialAndPackagingTotal: toYuan(materialCents + packagingCents),', '    materialAndPackagingTotal: toYuan(materialCents + packagingCents + sceneCents),')
  ],

  [
    '真毛利把手工费也减掉（违反裁决 20）',
    (src) => src.replace('  const grossCents = shippedCents - costCents', '  const grossCents = shippedCents - costCents - laborCents')
  ],
  [
    '已付待确认被算进已结清（未收款凭空变少）',
    (src) => src.replace("    if (st === 'settled') {", "    if (st === 'settled' || st === 'paid_pending') {")
  ],
  [
    '不再回落到 totalAmount（老数据的出货额算成 0）',
    (src) => src.replace('  if (Number.isFinite(amount) && amount !== 0) return Math.round(amount * CENTS)\n', '')
  ],
  ['元转分不再 ×100（单位错，金额缩水 100 倍）', (src) => src.replace('  return Math.round(n * CENTS)', '  return Math.round(n)')],
  [
    '出货额为 0 时毛利率返回 0（把"没数据"说成"0%"）',
    (src) => src.replace('    grossMarginPct: shippedCents > 0 ? Math.round((grossCents / shippedCents) * 1000) / 10 : null,', '    grossMarginPct: shippedCents > 0 ? Math.round((grossCents / shippedCents) * 1000) / 10 : 0,')
  ]
]

function runOnce(kpiPath) {
  passes = 0
  failures.length = 0
  let K
  try {
    const resolved = require.resolve(kpiPath)
    delete require.cache[resolved]
    K = require(kpiPath)
  } catch (e) {
    failures.push(`加载模块失败：${e.message}`)
    return { failed: failures.length, failures: failures.slice() }
  }
  try {
    runTests(K)
  } catch (e) {
    failures.push(`断言执行抛异常：${e.message}`)
  }
  return { failed: failures.length, failures: failures.slice() }
}

function runSelfTest() {
  console.log('自检：确认「结算口径被破坏」时断言确实会失败\n')
  const original = readFileSync(KPI_PATH, 'utf8')
  let allDetected = true
  for (const [label, mutate] of INJECTIONS) {
    const dir = mkdtempSync(join(tmpdir(), 'studio-kpi-selftest-'))
    const mutated = mutate(original)
    if (mutated === original) {
      console.log(`✗ ${label} → 【注入锚点失效】（源码未改变，无法判定）`)
      allDetected = false
      rmSync(dir, { recursive: true, force: true })
      continue
    }
    const target = join(dir, 'settlementKpis.js')
    writeFileSync(target, mutated, 'utf8')
    copyFileSync(KPI_PATH, join(dir, '.orig'))
    const res = runOnce(target)
    const detected = res.failed > 0
    allDetected = allDetected && detected
    console.log(
      `${detected ? '✓' : '✗'} 注入 ${label} → ${detected ? '已检出' : '【漏检】'}${detected ? `（${res.failed} 项失败）` : ''}`
    )
    if (detected) res.failures.slice(0, 2).forEach((f) => console.log(`    · ${f}`))
    rmSync(dir, { recursive: true, force: true })
  }
  // 预算构成：源码级注入（不需要复制文件，直接对变异后的源码复跑那组判据）
  const budgetSrc = readFileSync(DASHBOARD_INDEX, 'utf8')
  for (const [label, mutate] of SOURCE_INJECTIONS) {
    const mutated = mutate(budgetSrc)
    if (mutated === budgetSrc) {
      console.log(`✗ ${label} → 【注入锚点失效】（源码未改变，无法判定）`)
      allDetected = false
      continue
    }
    const hit = budgetSourceProblems(mutated)
    allDetected = allDetected && hit.length > 0
    console.log(`${hit.length ? '✓' : '✗'} 注入 ${label} → ${hit.length ? `已检出（${hit[0]}）` : '【漏检】'}`)
  }
  const clean = runOnce(KPI_PATH)
  console.log(`\n${clean.failed === 0 ? '✓' : '✗'} 未注入时通过（${clean.failed === 0 ? '无假阳性' : '有假阳性'}）`)
  if (clean.failed > 0) clean.failures.slice(0, 5).forEach((f) => console.log(`    · ${f}`))
  if (!allDetected || clean.failed > 0) {
    console.log('\n✗ 自检失败')
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${INJECTIONS.length + SOURCE_INJECTIONS.length} 个注入全部被检出，且无假阳性`)
}

function runBudgetSourceChecks (src) {
  const problems = budgetSourceProblems(src)
  problems.forEach((p) => failures.push(p))
  if (!problems.length) passes += 1
  return problems.length
}

if (process.argv.includes('--selftest')) {
  runSelfTest()
} else {
  const res = runOnce(KPI_PATH)
  runBudgetSourceChecks(readFileSync(DASHBOARD_INDEX, 'utf8'))
  console.log(`工作室结算口径：通过 ${passes} / ${passes + res.failed}`)
  if (res.failed > 0) {
    console.log('')
    res.failures.forEach((f) => console.log(`  ✗ ${f}`))
    console.log(`\n✗ ${res.failed} 项失败`)
    process.exit(1)
  }
  console.log('✓ 结算口径断言全部通过（三口径拆分 / 真毛利不减手工费 / 三级回落 / 单位不变量 / 空数据边界）')
}
