#!/usr/bin/env node
/**
 * 工作室账单守卫（`billCore.js`）—— 状态机 + **终结副作用** + 幂等
 *
 * 为什么需要（依据蓝图 §6 / §10-④）：
 *   ① 「超管确认收款 = 订单终结」（裁决 13）是**一个动作改多处**：账单结清 +
 *      其下**每一张**出货单 `settleStatus=settled` **且** `status=completed`。
 *      这类逻辑最容易漏改一处，而它动的是**钱和订单终态**。
 *   ② 两步收款（裁决 12）必须**真的**做到「没标已付不能确认收款」，
 *      否则超管可以跳过门店直接终结订单 —— 双方留痕就白设计了。
 *   ③ 幂等：网络重试/连点必须短路，否则重复通知 + 重复写。
 *   ④ 待核价的单**不许入账**（裁决 14 的拦截口）；门店不匹配不许入账。
 *
 * 本守卫**不测** db 层（写库、批量 patch、通知投递）—— 那些由云函数集成验证覆盖；
 * 这里只钉**纯逻辑**，因为纯逻辑是「改了哪几个字段」的唯一真相。
 *
 * 用法：
 *   node miniprogram/scripts/test-studio-bill.mjs
 *   node miniprogram/scripts/test-studio-bill.mjs --selftest
 * 退出码：断言失败 1；注入未被检出 1；全通过 0。
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const FN_DIR = resolve(ROOT, 'miniprogram/cloudfunctions/manageStudioSettlement')
const CORE_PATH = join(FN_DIR, 'billCore.js')

let passes = 0
const failures = []
function ok(label, cond, detail) {
  if (cond) passes += 1
  else failures.push(detail ? `${label} —— ${detail}` : label)
}
function eq(label, got, want) {
  ok(label, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}
function deepEq(label, got, want) {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  ok(label, a === b, `期望 ${b}，实际 ${a}`)
}

const STORE = 'store_xingchen'

/** 两张可入账的单据；金额用的是「分」，totalCents = 三分项之和 */
function ship(id, over) {
  return Object.assign(
    {
      _id: id,
      shipmentNo: 'SH' + id,
      storeId: STORE,
      storeName: '星宸标本',
      shipmentDate: '2026-09-14',
      pricingStatus: 'priced',
      pricingIssueCount: 0,
      settleStatus: 'unsettled',
      billId: '',
      materialCostCents: 36000,
      packagingCostCents: 9000,
      laborCostCents: 13500,
      totalCents: 58500,
      totalQty: 2,
      itemCount: 1
    },
    over || {}
  )
}

function runTests(B) {
  // ── A. 状态机 ──
  ok('A1 未结 → 已付待确认 允许', B.canTransitBill('unsettled', 'paid_pending') === true)
  ok('A2 未结 → 已结清 **不允许**（必须先由门店标已付款，裁决 12）', B.canTransitBill('unsettled', 'settled') === false)
  ok('A3 已付待确认 → 已结清 允许', B.canTransitBill('paid_pending', 'settled') === true)
  ok('A4 已付待确认 → 撤回未结 允许', B.canTransitBill('paid_pending', 'unsettled') === true)
  ok('A5 已结清是终态（不能再去任何状态）', (B.BILL_FLOW.settled || []).length === 0)
  ok('A6 已作废是终态', (B.BILL_FLOW.void || []).length === 0)
  ok('A7 未结可作废', B.canTransitBill('unsettled', 'void') === true)
  ok('A8 已付待确认 **不可**作废（要先撤回）', B.canTransitBill('paid_pending', 'void') === false)

  // ── B. buildBill：入账校验与汇总 ──
  const base = { actor: { openid: 'o1', name: '超管' }, now: 1000, seq: 1 }
  ok('B1 未选门店被拒', B.buildBill(Object.assign({}, base, { storeId: '', shipments: [ship('s1')] })).ok === false)
  ok('B2 未选单据被拒', B.buildBill(Object.assign({}, base, { storeId: STORE, shipments: [] })).ok === false)

  const wrongStore = B.buildBill(
    Object.assign({}, base, { storeId: 'store_shanhaizaowu', shipments: [ship('s1')] })
  )
  ok('B3 门店不匹配被拒', wrongStore.ok === false)
  eq('B4 门店不匹配的原因码', wrongStore.blocked[0].code, 'WRONG_STORE')

  const incomplete = B.buildBill(
    Object.assign({}, base, {
      storeId: STORE,
      shipments: [ship('s1'), ship('s2', { pricingStatus: 'incomplete', pricingIssueCount: 3 })]
    })
  )
  ok('B5 含待核价单被拒（裁决 14 的拦截口）', incomplete.ok === false)
  eq('B6 待核价的原因码', incomplete.blocked[0].code, 'PRICING_INCOMPLETE')
  ok('B7 待核价的原因文案带出行数', /3 行待核价/.test(incomplete.blocked[0].msg), incomplete.blocked[0].msg)

  const already = B.buildBill(
    Object.assign({}, base, { storeId: STORE, shipments: [ship('s1', { settleStatus: 'settled' })] })
  )
  ok('B8 已结清的单不能重复入账', already.ok === false)
  eq('B9 已入账的原因码', already.blocked[0].code, 'ALREADY_IN_BILL')
  const inBill = B.buildBill(
    Object.assign({}, base, { storeId: STORE, shipments: [ship('s1', { billId: 'b9' })] })
  )
  ok('B10 已在别的账单里的单不能重复入账', inBill.ok === false)
  const voidedShip = B.buildBill(
    Object.assign({}, base, { storeId: STORE, shipments: [ship('s1', { status: 'cancelled' })] })
  )
  ok('B10a 已作废（cancelled）的出货单不能入账', voidedShip.ok === false)
  eq('B10b 已作废的原因码', voidedShip.blocked && voidedShip.blocked[0] && voidedShip.blocked[0].code, 'CANCELLED')

  const built = B.buildBill(
    Object.assign({}, base, {
      storeId: STORE,
      shipments: [
        ship('s1'),
        // ⚠️ 覆盖时必须**四个金额字段一起改**：totalCents 与三分项必须自洽，
        //    否则 B15 的单位不变量断言会（正确地）失败 —— 本守卫第一次跑就是这么抓到的。
        ship('s2', {
          shipmentDate: '2026-09-15',
          materialCostCents: 20000,
          packagingCostCents: 0,
          laborCostCents: 6000,
          totalCents: 26000
        })
      ]
    })
  )
  ok('B11 正常入账成功', built.ok === true)
  const bill = built.bill
  eq('B12 汇总材料费（分）', bill.materialCostCents, 36000 + 20000)
  eq('B13 汇总合计（分）= 各单据 totalCents 之和', bill.totalCents, 58500 + 26000)
  eq('B14 合计（元）= 合计（分）÷ 100', bill.totalAmount, 845)
  ok(
    'B15 合计（分）= 三分项之和（单位不变量）',
    bill.totalCents === bill.materialCostCents + bill.packagingCostCents + bill.laborCostCents,
    `${bill.materialCostCents}+${bill.packagingCostCents}+${bill.laborCostCents} vs ${bill.totalCents}`
  )
  eq('B16 单据数', bill.shipmentCount, 2)
  eq('B17 件数合计', bill.totalQty, 4)
  eq('B18 账期起 = 最早出货日（推导，不是手填）', bill.periodFrom, '2026-09-14')
  eq('B19 账期止 = 最晚出货日', bill.periodTo, '2026-09-15')
  eq('B20 初始状态为未结', bill.status, 'unsettled')
  ok('B21 单号格式 SB+日期+4位序号', /^SB\d{8}-\d{4}$/.test(bill.billNo), bill.billNo)
  eq('B22 纳入的单据 id 全在', bill.shipmentIds.length, 2)
  eq('B23 初始无收款人', bill.paidMarkedBy, '')

  const withId = Object.assign({ _id: 'bill1' }, bill)

  // ── C. 门店标「已付款」──
  const paid = B.markPaidPatch(withId, { openid: 'm1', name: '店长' }, { now: 2000, note: '已转账' })
  ok('C1 未结可标已付款', paid.ok === true)
  eq('C2 账单状态变已付待确认', paid.patch.status, 'paid_pending')
  eq('C3 记录标记人', paid.patch.paidMarkedByName, '店长')
  eq('C4 记录备注', paid.patch.paidNote, '已转账')
  eq('C5 **单据镜像**为已付待确认（店长在自己列表也能看到）', paid.shipmentPatch.settleStatus, 'paid_pending')
  eq('C6 镜像写所属账单 id', paid.shipmentPatch.billId, 'bill1')
  eq('C7 镜像覆盖账单下全部单据', paid.shipmentIds.length, 2)

  const paidBill = Object.assign({}, withId, paid.patch)
  ok('C8 重复标已付款 → 幂等短路', B.markPaidPatch(paidBill, { openid: 'm1' }, {}).noop === true)
  ok('C9 已结清的账单再标 → 幂等短路（不报错）', B.markPaidPatch(Object.assign({}, paidBill, { status: 'settled' }), {}, {}).noop === true)
  ok('C10 已作废的账单不能标已付款', B.markPaidPatch(Object.assign({}, paidBill, { status: 'void' }), {}, {}).ok === false)

  // ── D. 超管「确认收款」= 终结（裁决 13）──
  const settle = B.confirmSettlePatch(paidBill, { openid: 'o1', name: '超管' }, { now: 3000, note: '已收到' })
  ok('D1 已付待确认可确认收款', settle.ok === true)
  eq('D2 账单变已结清', settle.billPatch.status, 'settled')
  eq('D3 记录收款人', settle.billPatch.settledByName, '超管')
  eq('D4 **终结①：单据结算状态变已结清**', settle.shipmentPatch.settleStatus, 'settled')
  eq('D5 **终结②：单据物流状态变已完成**（裁决 13「订单终结」）', settle.shipmentPatch.status, 'completed')
  eq('D6 终结写账单 id（可回查）', settle.shipmentPatch.billId, 'bill1')
  eq('D7 终结写账单号', settle.shipmentPatch.billNo, bill.billNo)
  eq('D8 终结覆盖账单下**每一张**单', settle.shipmentIds.length, 2)

  const settledBill = Object.assign({}, paidBill, settle.billPatch)
  ok('D9 重复确认收款 → 幂等短路（据此不重复通知）', B.confirmSettlePatch(settledBill, { openid: 'o1' }, {}).noop === true)
  const skipPaid = B.confirmSettlePatch(withId, { openid: 'o1' }, {})
  ok('D10 **未标已付款不能确认收款**（裁决 12 的两步不能被绕过）', skipPaid.ok === false)
  ok('D11 拒绝文案说明要先由门店标记', /先由门店标记已付款/.test(skipPaid.msg), skipPaid.msg)
  ok('D12 已作废的账单不能确认收款', B.confirmSettlePatch(Object.assign({}, paidBill, { status: 'void' }), {}, {}).ok === false)
  ok(
    'D13 无单据的账单不能终结（防呆）',
    B.confirmSettlePatch(Object.assign({}, paidBill, { shipmentIds: [] }), {}, {}).ok === false
  )

  // ── E. 作废：释放其下单据 ──
  const voided = B.voidPatch(withId, { openid: 'o1' }, { now: 4000 })
  ok('E1 未结可作废', voided.ok === true)
  eq('E2 账单变已作废', voided.patch.status, 'void')
  eq('E3 单据结算状态回到未结', voided.shipmentPatch.settleStatus, 'unsettled')
  eq('E4 单据解绑账单 id（可重新入账）', voided.shipmentPatch.billId, '')
  eq('E5 单据解绑账单号', voided.shipmentPatch.billNo, '')
  ok('E6 已付待确认不可作废（要先撤回）', B.voidPatch(paidBill, {}, {}).ok === false)
  ok('E7 已结清不可作废（终态）', B.voidPatch(settledBill, {}, {}).ok === false)
  ok('E8 重复作废 → 幂等', B.voidPatch(Object.assign({}, withId, { status: 'void' }), {}, {}).noop === true)

  // ── F. 撤回已付款 ──
  const back = B.withdrawPaidPatch(paidBill, { openid: 'o1' })
  ok('F1 已付待确认可撤回未结', back.ok === true)
  eq('F2 账单回到未结', back.patch.status, 'unsettled')
  eq('F3 清空标记人', back.patch.paidMarkedBy, '')
  eq('F4 单据镜像回到未结', back.shipmentPatch.settleStatus, 'unsettled')
  ok('F5 已结清不可撤回（终态）', B.withdrawPaidPatch(settledBill, {}, {}).ok === false)
  ok('F6 本来就是未结 → 幂等', B.withdrawPaidPatch(withId, {}, {}).noop === true)

  // ── G. mapBill：派生字段由状态算出，前端不自己判断 ──
  const m1 = B.mapBill(withId)
  eq('G1 未结可标已付款', m1.canMarkPaid, true)
  eq('G2 未结不可确认收款', m1.canConfirmSettle, false)
  eq('G3 未结可作废', m1.canVoid, true)
  eq('G4 状态标签由状态派生', m1.statusLabel, '未结')
  eq('G5 合计（元）由分派生', m1.totalAmount, 845)
  const m2 = B.mapBill(settledBill)
  eq('G6 已结清不可再标已付款', m2.canMarkPaid, false)
  eq('G7 已结清不可确认收款', m2.canConfirmSettle, false)
  eq('G8 已结清不可作废', m2.canVoid, false)
  eq('G9 已结清标签', m2.statusLabel, '已结清')
  const m3 = B.mapBill(paidBill)
  eq('G10 已付待确认**可**确认收款', m3.canConfirmSettle, true)
  eq('G11 已付待确认不可再标已付款', m3.canMarkPaid, false)
  eq('G12 未知状态兜底为未结', B.mapBill({ status: '???' }).status === 'unsettled', true)

  // ── H. 只写状态码，不写展示标签（避免第二份真相）──
  ok('H1 终结 patch **不含** statusLabel', settle.shipmentPatch.statusLabel === undefined)
  ok('H2 终结 patch **不含** settleLabel', settle.shipmentPatch.settleLabel === undefined)
  ok('H3 账单 patch 不含 statusLabel', settle.billPatch.statusLabel === undefined)
}

/** 每条注入都必须让至少一条断言失败 */
const INJECTIONS = [
  [
    '确认收款不再终结物流状态（订单不终结）',
    (src) => src.replace('    status: TERMINAL_SHIPMENT_STATUS,\n', '')
  ],
  [
    '去掉幂等短路（重复确认会重复写、重复通知）',
    (src) => src.replace("if (status === BILL_STATUS.SETTLED) return { ok: true, noop: true, msg: '该账单已结清（重复确认已忽略）' }", 'if (false) return { ok: true, noop: true }')
  ],
  [
    '未标已付款也能确认收款（绕过两步流程）',
    (src) => src.replace('  if (!canTransitBill(status, BILL_STATUS.SETTLED)) {', '  if (false) {')
  ],
  [
    '待核价的单也能入账（阻塞失效）',
    (src) => src.replace("  if (String(s.pricingStatus || '') !== 'priced') {", '  if (false) {')
  ],
  [
    '不校验门店归属（可把别家门店的单入账）',
    (src) => src.replace("  if (storeId && s.storeId !== storeId) return { code: 'WRONG_STORE', msg: '不属于该门店' }\n", '')
  ],
  [
    '已作废的出货单也能入账（作废单被重复收款）',
    (src) => src.replace("  if (String(s.status || '') === 'cancelled') return { code: 'CANCELLED', msg: '已作废' }\n", '')
  ],
  [
    '汇总把「元」当「分」累加（单位错，金额缩水 100 倍）',
    (src) => src.replace('    totalCents += toCents(s.totalCents)', '    totalCents += toCents(s.totalAmount)')
  ],
  [
    '标已付款不再镜像到单据（店长看不到已付待确认）',
    (src) => src.replace('      settleStatus: SETTLE_STATUS.PAID_PENDING,', '      settleStatus: SETTLE_STATUS.UNSETTLED,')
  ],
  [
    '作废不释放其下单据（单据永远卡在旧账单里）',
    (src) => src.replace("      billId: '',\n      billNo: '',", '      billId: String(b._id || \'\'),\n      billNo: String(b.billNo || \'\'),')
  ]
]

function runOnce(corePath) {
  passes = 0
  failures.length = 0
  let B
  try {
    const resolved = require.resolve(corePath)
    delete require.cache[resolved]
    B = require(corePath)
  } catch (e) {
    failures.push(`加载模块失败：${e.message}`)
    return { failed: failures.length, failures: failures.slice() }
  }
  try {
    runTests(B)
  } catch (e) {
    failures.push(`断言执行抛异常：${e.message}`)
  }
  return { failed: failures.length, failures: failures.slice() }
}

function runSelfTest() {
  console.log('自检：确认「账单逻辑被破坏」时断言确实会失败\n')
  const original = readFileSync(CORE_PATH, 'utf8')
  let allDetected = true
  for (const [label, mutate] of INJECTIONS) {
    const dir = mkdtempSync(join(tmpdir(), 'studio-bill-selftest-'))
    const mutated = mutate(original)
    if (mutated === original) {
      console.log(`✗ ${label} → 【注入锚点失效】（源码未改变，无法判定）`)
      allDetected = false
      rmSync(dir, { recursive: true, force: true })
      continue
    }
    const target = join(dir, 'billCore.js')
    writeFileSync(target, mutated, 'utf8')
    copyFileSync(CORE_PATH, join(dir, '.orig'))
    const res = runOnce(target)
    const detected = res.failed > 0
    allDetected = allDetected && detected
    console.log(
      `${detected ? '✓' : '✗'} 注入 ${label} → ${detected ? '已检出' : '【漏检】'}${detected ? `（${res.failed} 项失败）` : ''}`
    )
    if (detected) res.failures.slice(0, 2).forEach((f) => console.log(`    · ${f}`))
    rmSync(dir, { recursive: true, force: true })
  }
  const clean = runOnce(CORE_PATH)
  console.log(`\n${clean.failed === 0 ? '✓' : '✗'} 未注入时通过（${clean.failed === 0 ? '无假阳性' : '有假阳性'}）`)
  if (clean.failed > 0) clean.failures.slice(0, 5).forEach((f) => console.log(`    · ${f}`))
  if (!allDetected || clean.failed > 0) {
    console.log('\n✗ 自检失败')
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${INJECTIONS.length} 个注入全部被检出，且无假阳性`)
}

if (process.argv.includes('--selftest')) {
  runSelfTest()
} else {
  const res = runOnce(CORE_PATH)
  console.log(`工作室账单：通过 ${passes} / ${passes + res.failed}`)
  if (res.failed > 0) {
    console.log('')
    res.failures.forEach((f) => console.log(`  ✗ ${f}`))
    console.log(`\n✗ ${res.failed} 项失败`)
    process.exit(1)
  }
  console.log('✓ 账单断言全部通过（状态机 / 入账校验 / 两步收款 / 确认收款终结 / 幂等 / 作废释放 / 派生字段 / 只写状态码）')
}
