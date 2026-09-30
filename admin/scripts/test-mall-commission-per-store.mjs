#!/usr/bin/env node
/**
 * test:mall-commission-per-store —— 商场抽成只按单店算（2026-09-30 产品负责人口径）
 *
 * 规则：每家门店各自月营业额超过阈值（默认 17 万）才开始抽成，每店 max(0, 该店营业额 − 阈值) × 扣点；
 *       多店视图（超管双店合计 / ERP 全部门店 / 双店账本汇总）的抽成 = 各店抽成之和，不得先加总营收再套阈值。
 *
 * 覆盖：
 *   1. 各副本单店公式同判据：manageStaffWorkspace / syncFinanceData / getShareholderObservatory /
 *      小程序 manager·extra / ERP mallCommission.js·.cjs 对同一组营收算出同一抽成
 *   2. 各副本多店函数：合计 = 各店之和；一店未达线一店达线、两店都未达线（合计过线）、两店都达线
 *   3. 工资条实时销售分成（真跑 salesShareRevenue 真源 + 内存库）：超管双店合计 = 各店之和；
 *      单店店员 / 店长 / 未绑店店长按该店算；未标门店的线上单与旧编号账本归山川造物
 *   4. syncFinanceData 双店账本汇总（真跑云函数真源 + 内存库）的商场抽成 = 各店之和
 *   5. ERP 财务页：月度商场分成与成绩单都按门店分组计，不直接对合计营收套阈值
 *   6. 界面文案：口径 / 公式 / 分店明细不含技术字段名；工资条页渲染分店明细
 *
 * --selftest：对各源码做内存注入（不写盘），每个注入都必须被检出。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Module from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const P = {
  mswMall: resolve(ROOT, 'miniprogram/cloudfunctions/manageStaffWorkspace/mallCommission.js'),
  salesShare: resolve(ROOT, 'miniprogram/cloudfunctions/manageStaffWorkspace/salesShareRevenue.js'),
  sfdMall: resolve(ROOT, 'miniprogram/cloudfunctions/syncFinanceData/mallCommission.js'),
  sfdIndex: resolve(ROOT, 'miniprogram/cloudfunctions/syncFinanceData/index.js'),
  sfdDup: resolve(ROOT, 'miniprogram/cloudfunctions/syncFinanceData/ledgerDuplicate.js'),
  gsoMall: resolve(ROOT, 'miniprogram/cloudfunctions/getShareholderObservatory/mallCommission.js'),
  mgrMall: resolve(ROOT, 'miniprogram/subpackages/manager/utils/mallCommission.js'),
  extraMall: resolve(ROOT, 'miniprogram/subpackages/extra/utils/mallCommission.js'),
  adminMall: resolve(ROOT, 'admin/src/utils/mallCommission.js'),
  adminMallCjs: resolve(ROOT, 'admin/src/utils/mallCommission.cjs'),
  finance: resolve(ROOT, 'admin/src/components/Finance.vue'),
  payslipJs: resolve(ROOT, 'miniprogram/subpackages/manager/payslip/index.js'),
  payslipWxml: resolve(ROOT, 'miniprogram/subpackages/manager/payslip/index.wxml'),
}
const SOURCES = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, readFileSync(p, 'utf8')]))

const MAIN = 'store_shanhaizaowu'
const XC = 'store_xingchen'
const LEGACY_MAIN = 'store_1780146782017_6w0okpr'
/** 界面文案里不得出现的技术字段 / 公式记号 */
const TECH_RE = /storeId|store_|openid|_id\b|max\(|mallFee|threshold|undefined|null|NaN|\bR\b/

function loadCjsFromSource(filename, source, stubs = {}) {
  const m = new Module(filename)
  m.filename = filename
  m.paths = Module._nodeModulePaths(dirname(filename))
  const origRequire = m.require.bind(m)
  m.require = (id) => (Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : origRequire(id))
  m._compile(source, filename)
  return m.exports
}
const importEsm = (source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

function makeAsserter() {
  const failures = []
  let pass = 0
  return {
    ok(name, cond, detail) {
      if (cond) pass += 1
      else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    },
    get failures() { return failures },
    get pass() { return pass },
  }
}
const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005

function sliceFunction(src, header) {
  const i = src.indexOf(header)
  if (i === -1) return ''
  const e = src.indexOf('\n}\n', i)
  return e === -1 ? '' : src.slice(i, e + 2)
}

/* ------------------------------ 内存库（salesShareRevenue / syncFinanceData 用到的查询子集） ------------------------------ */
function makeDb(seed) {
  const data = {}
  for (const [k, rows] of Object.entries(seed)) data[k] = rows.map((r) => ({ ...r }))
  const cmd = (op, v) => ({ __op: op, v, and(o) { return { __op: 'and', parts: [this, o] } } })
  const _ = { gte: (v) => cmd('gte', v), lte: (v) => cmd('lte', v), in: (v) => cmd('in', v) }
  const test = (val, c) => {
    if (c && typeof c === 'object' && c.__op) {
      if (c.__op === 'and') return c.parts.every((p) => test(val, p))
      if (c.__op === 'gte') return val >= c.v
      if (c.__op === 'lte') return val <= c.v
      if (c.__op === 'in') return c.v.includes(val)
    }
    return val === c
  }
  const match = (row, where) => !where || Object.entries(where).every(([k, c]) => test(row[k], c))
  function collection(name) {
    const st = { where: null, skip: 0, limit: 1000 }
    const rows = () => data[name] || []
    const api = {
      where(w) { st.where = w; return api },
      orderBy() { return api },
      field() { return api },
      skip(n) { st.skip = n; return api },
      limit(n) { st.limit = n; return api },
      async get() { return { data: rows().filter((r) => match(r, st.where)).slice(st.skip, st.skip + st.limit).map((r) => ({ ...r })) } },
      async add({ data: d }) { (data[name] = data[name] || []).push({ ...d }); return { _id: 'x' } },
      doc(id) {
        return {
          async get() { return { data: rows().filter((r) => r._id === id) } },
          async update() { return { stats: { updated: 0 } } },
          async set() { return {} },
          async remove() { return { stats: { removed: 0 } } },
        }
      },
    }
    return api
  }
  return { db: { collection, command: _, serverDate: () => new Date() }, _ }
}

/** 上个自然月（北京时间），保证整月都在「今天」之前 */
function lastYearMonth() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() // 0-based → 即上个月的 1-based
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, '0')}`
}

/** 场景：山川 = 线上无门店单 + 账本（含旧编号）；星宸 = 账本 */
function seedFor(ym, { mainOnline, mainLedger, mainLegacyLedger, xcLedger }) {
  const paid = new Date(`${ym}-10T04:00:00.000Z`)
  return {
    orders: mainOnline
      ? [{ _id: 'o1', status: 'paid', totalPrice: mainOnline, createTime: paid, paidTime: paid }]
      : [],
    store_ledger: [
      { _id: 'l1', storeId: MAIN, date: `${ym}-05`, pos: mainLedger, _updateTime: 1 },
      ...(mainLegacyLedger ? [{ _id: 'l2', storeId: LEGACY_MAIN, date: `${ym}-06`, pos: mainLegacyLedger, _updateTime: 1 }] : []),
      { _id: 'l3', storeId: XC, date: `${ym}-05`, pos: xcLedger, _updateTime: 1 },
    ],
    finance_settings: [],
    finance_records: [],
    daily_revenues: [],
    store_ledger_deletions: [],
  }
}

const SCENARIOS = [
  // 一店达线一店未达线：山川 30000 + 120000 + 30000 = 180000 → 1500；星宸 60000 → 0；旧合计口径会得 10500
  { name: '一店达线一店未达线', seed: { mainOnline: 30000, mainLedger: 120000, mainLegacyLedger: 30000, xcLedger: 60000 }, main: 180000, xc: 60000, mainFee: 1500, xcFee: 0 },
  // 两店都未达线但合计过线（2026-09 实数）：旧合计口径会得 3461.89
  { name: '两店都未达线（合计过线）', seed: { mainOnline: 3092.28, mainLedger: 143397.4, mainLegacyLedger: 0, xcLedger: 46589.56 }, main: 146489.68, xc: 46589.56, mainFee: 0, xcFee: 0 },
  // 两店都达线：4500 + 1500
  { name: '两店都达线', seed: { mainOnline: 0, mainLedger: 200000, mainLegacyLedger: 0, xcLedger: 180000 }, main: 200000, xc: 180000, mainFee: 4500, xcFee: 1500 },
]

/* ------------------------------------------ 断言 ------------------------------------------ */
async function runChecks(src) {
  const t = makeAsserter()

  // 1. 各副本单店公式
  const msw = loadCjsFromSource(P.mswMall, src.mswMall)
  const sfd = loadCjsFromSource(P.sfdMall, src.sfdMall)
  const gso = loadCjsFromSource(P.gsoMall, src.gsoMall)
  const mgr = loadCjsFromSource(P.mgrMall, src.mgrMall)
  const extra = loadCjsFromSource(P.extraMall, src.extraMall)
  const adm = await importEsm(src.adminMall)
  const admCjs = loadCjsFromSource(P.adminMallCjs, src.adminMallCjs)
  const singles = {
    manageStaffWorkspace: (r) => msw.computeMonthlyMallFee(r).mallFee,
    syncFinanceData: (r) => sfd.computeMallCommission(r).fee,
    getShareholderObservatory: (r) => gso.computeMallCommission(r).fee,
    '小程序 manager': (r) => mgr.computeMallCommission(r).fee,
    '小程序 extra': (r) => extra.computeMallCommission(r).fee,
    'ERP .js': (r) => adm.computeMallCommission(r).fee,
    'ERP .cjs': (r) => admCjs.computeMallCommission(r).fee,
  }
  const expectSingle = (r) => Math.round(Math.max(0, r - 170000) * 0.15 * 100) / 100
  for (const r of [0, 100000, 170000, 170000.01, 180000, 266902.57, 1000000]) {
    for (const [name, fn] of Object.entries(singles)) {
      const got = fn(r)
      t.ok(`${name} 单店 ¥${r} → ¥${expectSingle(r)}`, near(got, expectSingle(r)), String(got))
    }
  }

  // 2. 各副本多店函数：合计 = 各店之和
  const multis = {
    manageStaffWorkspace: (list) => msw.computeMallFeeByStores(list).mallFee,
    syncFinanceData: (list) => sfd.computeMallCommissionByStores(list).fee,
    'ERP .js': (list) => adm.computeMallCommissionByStores(list).fee,
    'ERP .cjs': (list) => admCjs.computeMallCommissionByStores(list).fee,
  }
  for (const sc of SCENARIOS) {
    const list = [{ storeId: MAIN, name: '山川造物', revenue: sc.main }, { storeId: XC, name: '星宸标本', revenue: sc.xc }]
    for (const [name, fn] of Object.entries(multis)) {
      let got = null
      try { got = fn(list) } catch (e) { got = `抛错 ${e.message}` }
      t.ok(`${name} 多店「${sc.name}」= 各店之和 ¥${sc.mainFee + sc.xcFee}`, near(got, sc.mainFee + sc.xcFee), String(got))
    }
  }

  // 3. 工资条实时销售分成（真跑真源 + 内存库）
  const ym = lastYearMonth()
  for (const sc of SCENARIOS) {
    const mem = makeDb(seedFor(ym, sc.seed))
    const mall = loadCjsFromSource(P.mswMall, src.mswMall)
    const share = loadCjsFromSource(P.salesShare, src.salesShare, { './mallCommission': mall })
    const run = (actor) => share.computeMonthlySalesShare(mem.db, mem._, { yearMonth: ym, actor })
    const dual = await run({ superAdmin: true, roles: ['super_admin'], storeIds: [] })
    const total = sc.main + sc.xc
    const fee = sc.mainFee + sc.xcFee
    t.ok(`工资条·超管双店「${sc.name}」营业额 = ¥${total}`, near(dual.monthRevenue, total), String(dual.monthRevenue))
    t.ok(`工资条·超管双店「${sc.name}」商场抽成 = 各店之和 ¥${fee}`, near(dual.mallFee, fee), String(dual.mallFee))
    t.ok(`工资条·超管双店「${sc.name}」分成 = (营业额 − 抽成) × 1%`, near(dual.shareAmount, Math.round((total - fee) * 0.01 * 100) / 100), String(dual.shareAmount))
    const by = Object.fromEntries((dual.mallByStore || []).map((s) => [s.storeId, s]))
    t.ok(`工资条·超管双店「${sc.name}」分店明细：山川 ¥${sc.main} / 抽成 ¥${sc.mainFee}`, by[MAIN] && near(by[MAIN].revenue, sc.main) && near(by[MAIN].mallFee, sc.mainFee), JSON.stringify(by[MAIN]))
    t.ok(`工资条·超管双店「${sc.name}」分店明细：星宸 ¥${sc.xc} / 抽成 ¥${sc.xcFee}`, by[XC] && near(by[XC].revenue, sc.xc) && near(by[XC].mallFee, sc.xcFee), JSON.stringify(by[XC]))
    const bt = String(dual.mallBreakdownText || '')
    t.ok(`工资条·超管双店「${sc.name}」明细文案含两店`, bt.includes('山川造物') && bt.includes('星宸标本'), bt)
    if (sc.xcFee === 0) t.ok(`工资条·超管双店「${sc.name}」未达线门店写明「未达 17 万起抽线」`, /星宸标本 ¥0\.00（营业额 ¥[\d.]+，未达 17 万起抽线）/.test(bt), bt)

    const views = [
      ['山川店员', { roles: ['staff'], storeIds: [MAIN] }, sc.main, sc.mainFee],
      ['星宸店员', { roles: ['staff'], storeIds: [XC] }, sc.xc, sc.xcFee],
      ['山川店长（旧编号绑定）', { roles: ['manager'], storeIds: [LEGACY_MAIN] }, sc.main, sc.mainFee],
      ['未绑店店长（回落山川）', { workspaceRole: 'store_manager', roles: ['manager'], storeIds: [] }, sc.main, sc.mainFee],
    ]
    for (const [label, actor, rev, f] of views) {
      const r = await run(actor)
      t.ok(`工资条·${label}「${sc.name}」按该店算：营业额 ¥${rev} / 抽成 ¥${f}`, near(r.monthRevenue, rev) && near(r.mallFee, f), JSON.stringify({ rev: r.monthRevenue, fee: r.mallFee }))
      t.ok(`工资条·${label}「${sc.name}」单店不出分店明细`, !r.mallBreakdownText, r.mallBreakdownText)
    }

    // 6. 界面文案
    for (const r of [dual, await run({ roles: ['staff'], storeIds: [XC] })]) {
      const texts = [r.scopeNote, r.formulaNote, r.mallBreakdownText, r.storeScopeLabel, r.revenueScopeLabel, ...(r.mallByStore || []).map((s) => s.detailText)]
      const bad = texts.filter((x) => TECH_RE.test(String(x || '')))
      t.ok(`工资条文案「${sc.name}·${r.storeScopeLabel}」无技术字段名`, bad.length === 0, bad.join(' | '))
      t.ok(`工资条口径「${sc.name}·${r.storeScopeLabel}」写明按单店算、未标门店的快递单计入山川造物`, /商场抽成按单店算/.test(r.scopeNote) && /未标门店的快递单计入山川造物/.test(r.scopeNote), r.scopeNote)
    }
  }

  // 4. syncFinanceData 双店账本汇总
  {
    const sc = SCENARIOS[0]
    const mem = makeDb(seedFor(ym, { ...sc.seed, mainOnline: 0, mainLedger: 150000, mainLegacyLedger: 30000 }))
    const sdk = { init() {}, DYNAMIC_CURRENT_ENV: 'x', database: () => mem.db, getWXContext: () => ({ OPENID: 'oa_admin' }) }
    let res = null
    try {
      const fn = loadCjsFromSource(P.sfdIndex, src.sfdIndex, {
        'wx-server-sdk': sdk,
        './staffGuard': { assertStaff: async () => ({ ok: true }), ROLE_MANAGER: 'manager' },
        './ledgerDuplicate': loadCjsFromSource(P.sfdDup, src.sfdDup),
        './mallCommission': loadCjsFromSource(P.sfdMall, src.sfdMall),
      })
      res = await fn.main({ action: 'sum_month_store_ledger', storeId: 'all', dualStore: true, startDate: `${ym}-01`, endDate: `${ym}-28`, persist: false })
    } catch (e) {
      res = { error: e.message }
    }
    const mall = (res && res.mall) || {}
    t.ok('syncFinanceData 双店账本：营业额 = 两店之和 ¥240000', near(mall.reached, 240000), JSON.stringify({ reached: mall.reached, err: res && res.error }))
    t.ok('syncFinanceData 双店账本：商场抽成 = 各店之和 ¥1500（非合计口径 ¥10500）', near(mall.fee, 1500), String(mall.fee))
    t.ok('syncFinanceData 双店账本：返回分店抽成明细', Array.isArray(mall.byStore) && mall.byStore.length === 2, JSON.stringify(mall.byStore))
  }

  // 5. ERP 财务页
  {
    const fnSrc = sliceFunction(src.finance, 'function mallCommissionForRecords(records, s) {')
    t.ok('ERP 财务页有按门店分组计抽成的 mallCommissionForRecords', !!fnSrc)
    t.ok('ERP 财务页不再对合计营收直接调用 computeMallCommission(', !/\bcomputeMallCommission\(/.test(src.finance))
    const brief = src.finance.match(/const mall = (\w+)\(mData, s\)/g) || []
    t.ok('ERP 月度商场分成与成绩单两处都走 mallCommissionForRecords', brief.length === 2 && brief.every((x) => x.includes('mallCommissionForRecords')), JSON.stringify(brief))
    if (fnSrc) {
      const agg = await import(`file://${resolve(ROOT, 'admin/src/utils/financeDayAggregate.js')}`)
      let got = null
      try {
        const make = new Function('resolveFinanceStore', 'computeMallCommissionByStores', `${fnSrc}\nreturn mallCommissionForRecords`)
        const f = make(agg.resolveFinanceStore, adm.computeMallCommissionByStores)
        got = f([
          { storeId: '', revenue: 100000 },
          { storeId: LEGACY_MAIN, revenue: 80000 },
          { storeId: XC, revenue: 60000 },
        ], {})
      } catch (e) { got = { error: e.message } }
      t.ok('ERP 全部门店：无门店 + 旧编号归山川（18 万 → ¥1500），星宸 6 万 → ¥0，合计 ¥1500', got && near(got.fee, 1500) && (got.byStore || []).length === 2, JSON.stringify(got))
    }
  }

  // 6. 工资条页面
  {
    t.ok('工资条页渲染分店明细列表', /wx:for="\{\{salesShare\.mallByStore\}\}"/.test(src.payslipWxml))
    t.ok('工资条页脚本映射分店明细', /s\.mallByStore\.map\(/.test(src.payslipJs))
    const visible = src.payslipWxml.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{[\s\S]*?\}\}/g, '').replace(/<[^>]+>/g, ' ')
    t.ok('工资条页静态文案无技术字段名', !TECH_RE.test(visible), (visible.match(TECH_RE) || [])[0])
    t.ok('工资条页不新增原生弹窗', !/wx\.showModal/.test(src.payslipJs))
  }
  return t
}

/* ------------------------------------------ 入口 ------------------------------------------ */
async function main() {
  if (process.argv.includes('--selftest')) {
    const inject = (key, from, to) => {
      if (!SOURCES[key].includes(from)) throw new Error(`注入锚点不存在：${key} ← ${from.slice(0, 60)}`)
      return { ...SOURCES, [key]: SOURCES[key].replace(from, to) }
    }
    const injections = [
      ['工资条回退为合计营收套阈值', inject('salesShare', 'const mall = computeMallFeeByStores(storeRevenues, mallSettings)', "const mall = computeMallFeeByStores([{ storeId: 'all', name: '合计', revenue: storeRevenues.reduce((a, s) => a + s.revenue, 0) }], mallSettings)")],
      ['云函数多店函数按合计套阈值', inject('mswMall', 'const mallFee = round2(byStore.reduce((a, s) => a + s.mallFee, 0))', 'const mallFee = computeMonthlyMallFee(byStore.reduce((a, s) => a + s.revenue, 0), cfg).mallFee')],
      ['未标门店的线上单不再归山川', inject('salesShare', '  if (!sid) return FINANCE_STORE_ID\n', '  if (!sid) return null\n')],
      ['口径文案回退为技术字段名', inject('salesShare', '未标门店的快递单计入山川造物', '无 storeId 的快递单计入山川造物')],
      ['分店明细文案写成公式记号', inject('salesShare', '未达 ${thrLabel}起抽线`', 'R < threshold`')],
      ['syncFinanceData 双店不传分店', inject('sfdIndex', ', dual.byStore)', ')')],
      ['syncFinanceData 多店函数按合计套阈值', inject('sfdMall', 'const fee = round2(byStore.reduce((a, s) => a + s.fee, 0))', 'const fee = computeMallCommission(byStore.reduce((a, s) => a + s.reached, 0), cfg).fee')],
      ['ERP .js 多店函数按合计套阈值', inject('adminMall', 'const fee = round2(byStore.reduce((a, s) => a + s.fee, 0))', 'const fee = computeMallCommission(byStore.reduce((a, s) => a + s.reached, 0), settings).fee')],
      ['ERP .cjs 多店函数按合计套阈值', inject('adminMallCjs', 'const fee = round2(byStore.reduce((a, s) => a + s.fee, 0))', 'const fee = computeMallCommission(byStore.reduce((a, s) => a + s.reached, 0), settings).fee')],
      ['ERP 财务页回退为合计营收套阈值', inject('finance', 'const mall = mallCommissionForRecords(mData, s);', 'const mall = computeMallCommission(totalRev, s);')],
      ['ERP 分组忽略门店（全部并成一组）', inject('finance', '        const st = resolveFinanceStore(r)\n', "        const st = { storeId: 'all', name: '全部' }\n")],
      ['股东观测台副本阈值漂移', inject('gsoMall', 'const DEFAULT_MALL_THRESHOLD = 170000', 'const DEFAULT_MALL_THRESHOLD = 160000')],
      ['工资条页不渲染分店明细', inject('payslipWxml', 'wx:for="{{salesShare.mallByStore}}"', 'wx:for="{{[]}}"')],
      ['工资条页脚本丢分店明细', inject('payslipJs', 's.mallByStore.map(', '[].map(')],
    ]
    let allCaught = true
    for (const [name, src] of injections) {
      let caught = false
      try { caught = (await runChecks(src)).failures.length > 0 } catch { caught = true }
      console.log(`${caught ? '✓' : '✗'} 注入「${name}」${caught ? '已检出' : '未检出'}`)
      if (!caught) allCaught = false
    }
    console.log(allCaught ? `✓ selftest：${injections.length} 个注入全部检出` : '✗ selftest 失败')
    process.exit(allCaught ? 0 : 1)
  }
  const t = await runChecks(SOURCES)
  if (t.failures.length) {
    console.error(`✗ test:mall-commission-per-store：${t.failures.length} 项失败（通过 ${t.pass}）`)
    for (const f of t.failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log(`✓ test:mall-commission-per-store：${t.pass} 项通过（商场抽成单店各自 17 万起抽 / 多店 = 各店之和 / 七份副本同判据 / 工资条与双店账本与 ERP 一致 / 文案无技术字段名）`)
}
main().catch((e) => { console.error(e); process.exit(1) })
