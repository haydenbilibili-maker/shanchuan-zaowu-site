#!/usr/bin/env node
/**
 * test:payslip-social-insurance —— 工资条社保明细（2026-10-10 产品负责人点名；同日第 3 轮口径）
 *
 * 口径（产品负责人原话）：
 *   ① 按扣除项目拆分薪酬明细；② 截图是两个人的合计，个人展示 = 金额 ÷ 2；③ 工伤保险个人不扣，仅公司支付。
 *   「第三个人另有缴费记录，三人都该扣」（折算人数只用于折算，不限制参保人数）；
 *   「截图中的是8月的扣除项目，仅仅作为项目样例，每月的扣出都是相同的……每月的个人扣除皆为452.5元」；
 *   缺新版时「按上期金额扣」（某月用不晚于该月的最近一版标准）；
 *   「大额医疗互助8月工资已经扣除」（2026 年度系统外已扣，不再扣；下一年度当年第一张扣 100）。
 *
 * 覆盖：
 *   A 标准真源：自检、工伤只能公司缴、每人 = 合计 ÷ 折算人数、各月个人 452.50 / 公司 910.27 钉死、版本按生效月取、年度品目只一次
 *   B ERP 副本与真源同标准、同算法、保持 ESM
 *   C 真跑 manageStaffWorkspace + 内存库：旧入参逐字不变；三名员工都能套用；每月同扣 452.50；公司部分不进实发；
 *     年度品目 2026 被拦、2027 首张扣一次、重存不误判；预览 = 保存
 *   D ERP 薪酬引擎：同口径；公司部分不扣；未参保不变
 *   E 小程序：员工明细（三项个人 + 公司四项 + 8 月已扣说明，不展示所属月）、超管页入参与预览、不新增原生弹窗
 *
 * --selftest：对源码做内存注入（不写盘），每个注入都必须被检出。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Module from 'node:module'
import { isDeepStrictEqual } from 'node:util'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MSW = resolve(ROOT, 'miniprogram/cloudfunctions/manageStaffWorkspace')
const P = {
  siCjs: resolve(MSW, 'socialInsurance.js'),
  mswIndex: resolve(MSW, 'index.js'),
  siEsm: resolve(ROOT, 'admin/src/utils/socialInsurance.js'),
  engine: resolve(ROOT, 'admin/src/utils/payrollEngine.js'),
  payrollVue: resolve(ROOT, 'admin/src/components/PayrollManagement.vue'),
  view: resolve(ROOT, 'miniprogram/subpackages/manager/payslip/payslipView.js'),
  pageJs: resolve(ROOT, 'miniprogram/subpackages/manager/payslip/index.js'),
  pageWxml: resolve(ROOT, 'miniprogram/subpackages/manager/payslip/index.wxml'),
  adminJs: resolve(ROOT, 'miniprogram/subpackages/manager/payslip/admin/index.js'),
  adminWxml: resolve(ROOT, 'miniprogram/subpackages/manager/payslip/admin/index.wxml'),
}
const SOURCES = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, readFileSync(p, 'utf8')]))

function loadCjsFromSource(filename, source, stubs = {}) {
  const m = new Module(filename)
  m.filename = filename
  m.paths = Module._nodeModulePaths(dirname(filename))
  const origRequire = m.require.bind(m)
  m.require = (id) => (Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : origRequire(id))
  m._compile(source, filename)
  return m.exports
}
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

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
const amounts = (rows) => Object.fromEntries((rows || []).map((r) => [r.key, r.amount]))

/* ------------------------------ 内存库（工资条用到的查询子集） ------------------------------ */
function makeDb(seed = []) {
  const rows = seed.map((r) => ({ ...r }))
  const clone = (r) => JSON.parse(JSON.stringify(r))
  function collection() {
    const st = { where: null, limit: 1000 }
    const q = {
      where(w) { st.where = w; return q },
      orderBy() { return q },
      skip() { return q },
      limit(n) { st.limit = n; return q },
      async get() {
        const hit = rows.filter((r) => !st.where || Object.entries(st.where).every(([k, v]) => r[k] === v))
        return { data: hit.slice(0, st.limit).map(clone) }
      },
      doc(id) {
        return {
          async get() {
            const r = rows.find((x) => x._id === id)
            if (!r) throw new Error('not found')
            return { data: clone(r) }
          },
          async set({ data }) {
            const i = rows.findIndex((x) => x._id === id)
            const d = { ...clone(data), _id: id }
            if (i >= 0) rows[i] = d
            else rows.push(d)
            return {}
          },
          async remove() { return {} },
        }
      },
      async add({ data }) { rows.push(clone(data)); return { _id: data._id } },
    }
    return q
  }
  return { rows, db: { collection, command: {}, serverDate: () => new Date() } }
}

function loadSi(src) {
  return loadCjsFromSource(P.siCjs, src.siCjs)
}

function loadMsw(src, db) {
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'oSUPER_ADMIN_TEST' }),
  }
  const staffGuard = {
    assertStaff: async () => ({ ok: true, actor: { name: '测试超管', workspaceRole: 'super_admin', role: 'super_admin' } }),
    ROLE_MANAGER: 'store_manager',
    hasRole: () => true,
    STORED_ROLE_SUPER: 'super_admin',
    WORKSPACE_SUPER_ADMIN: 'super_admin',
    WORKSPACE_STORE_MANAGER: 'store_manager',
  }
  return loadCjsFromSource(P.mswIndex, src.mswIndex, {
    'wx-server-sdk': cloud,
    './staffGuard': staffGuard,
    './salesShareRevenue': { computeMonthlySalesShare: async () => ({}) },
    './socialInsurance': loadSi(src),
  })
}

/* ------------------------------ A 标准真源 ------------------------------ */
const SEP = '2026-09'
const OCT = '2026-10'
const sumAmt = (rows) => rows.reduce((s, x) => s + x.amount, 0)
const MONTHLY_KEYS = 'pension,medical,unemployment'

function checkStandard(t, SI) {
  const errs = SI.validateAll()
  t.ok('A1 月度标准自检通过', errs.length === 0, errs.join('；'))
  const injuryItem = SI.SI_ITEMS.find((i) => i.key === 'injury')
  const injuryLines = SI.SI_STANDARDS.flatMap((s) => s.lines.filter((l) => l.key === 'injury'))
  t.ok('A2 工伤品目只由公司缴纳、个人部分为 0', injuryItem && injuryItem.companyOnly === true && injuryLines.length > 0 && injuryLines.every((l) => Number(l.personalTotal) === 0))
  for (const std of SI.SI_STANDARDS) {
    t.ok(`A3 ${std.id} 有生效月、折算人数 ≥ 1`, /^\d{4}-\d{2}$/.test(std.effectiveFrom) && Number(std.splitHeadcount) >= 1)
    for (const l of std.lines) {
      t.ok(`A3 ${std.id}·${l.key} 每人 = 合计 ÷ ${std.splitHeadcount}`,
        near(SI.perHead(l.personalTotal, std.splitHeadcount), l.personalTotal / std.splitHeadcount) &&
        near(SI.perHead(l.companyTotal, std.splitHeadcount), l.companyTotal / std.splitHeadcount))
    }
  }
  const cur = SI.standardForMonth(SEP)
  t.ok('A3 当前版自 2026-08 起生效、折算人数 2（只用于折算）', cur && cur.effectiveFrom === '2026-08' && cur.splitHeadcount === 2)

  // 每月同一份：8 / 9 / 10 / 12 月、2027 年都扣同样的月度个人部分
  for (const ym of ['2026-08', SEP, OCT, '2026-12', '2027-03']) {
    const r = SI.computeSocialInsurance({ payslipMonth: ym, includeAnnual: false })
    const s = r.ok && r.snapshot
    const p = s ? amounts(s.personal) : {}
    t.ok(`A4 ${ym} 月度个人：养老 351.46 + 医疗 87.86 + 失业 13.18 = 452.50`,
      s && near(p.pension, 351.46) && near(p.medical, 87.86) && near(p.unemployment, 13.18) && near(s.personalTotal, 452.5) && s.personal.map((x) => x.key).join(',') === MONTHLY_KEYS,
      s ? JSON.stringify(p) : r.msg)
    const c = s ? amounts(s.company) : {}
    t.ok(`A4 ${ym} 公司缴纳：养老 527.18 + 医疗 338.28 + 失业 30.75 + 工伤 14.06 = 910.27`,
      s && near(c.pension, 527.18) && near(c.medical, 338.28) && near(c.unemployment, 30.75) && near(c.injury, 14.06) && near(s.companyTotal, 910.27), s ? JSON.stringify(c) : '')
    t.ok(`A4 ${ym} 工伤不在个人扣款里、合计 = 各项之和`, s && !s.personal.some((x) => x.key === 'injury') && near(s.personalTotal, sumAmt(s.personal)) && near(s.companyTotal, sumAmt(s.company)))
    t.ok(`A4 ${ym} 明细不带所属月 / 参考上期标记`, s && s.personal.concat(s.company).every((x) => !('period' in x) && !('refPeriod' in x) && !('advance' in x)))
  }
  t.ok('A5 生效月之前没有标准、不可套用', !SI.computeSocialInsurance({ payslipMonth: '2026-07' }).ok)

  // 2026 年度大额医疗互助：系统外已于 8 月扣
  const sep = SI.computeSocialInsurance({ payslipMonth: SEP }).snapshot
  t.ok('A6 2026 年不扣大额医疗互助、注明 8 月已扣', sep && near(sep.personalTotal, 452.5) && sep.annualIncluded === false &&
    sep.info.some((x) => x.kind === 'external' && /2026 年度已于 8 月工资扣缴/.test(x.text)) && /8 月/.test(sep.annualBlocked))
  const forced = SI.computeSocialInsurance({ payslipMonth: OCT, includeAnnual: true }).snapshot
  t.ok('A6 2026 年强行要求扣也不进扣款、给出原因', forced && near(forced.personalTotal, 452.5) && !!forced.annualBlocked)
  // 2027 年：当年第一张扣 100，之后不再扣
  const y1 = SI.computeSocialInsurance({ payslipMonth: '2027-01' }).snapshot
  t.ok('A7 2027 年第一张扣大额医疗互助 100（552.50）', y1 && near(amounts(y1.personal).medicalMutual, 100) && y1.annualIncluded === true && near(y1.personalTotal, 552.5), y1 && `${y1.personalTotal}`)
  const y2 = SI.computeSocialInsurance({ payslipMonth: '2027-02', annualChargedIn: '2027-01' }).snapshot
  t.ok('A7 2027 年已扣过：不再扣、写明在哪月扣的', y2 && near(y2.personalTotal, 452.5) && /2027-01/.test(y2.annualBlocked))
  const y3 = SI.computeSocialInsurance({ payslipMonth: '2027-01', includeAnnual: false }).snapshot
  t.ok('A7 可选本张暂不扣：列为提示、仍可勾选', y3 && near(y3.personalTotal, 452.5) && y3.annualAvailable === true && y3.info.some((x) => x.kind === 'deferred'))
  t.ok('A7 往期已扣月份从工资条快照里找', SI.annualChargedMonth([{ month: '2027-01', socialInsurance: y1 }], '2027') === '2027-01' && SI.annualChargedMonth([{ month: '2027-01', socialInsurance: y1 }], '2028') === '')

  const base = SI.SI_STANDARDS[0]
  const bad1 = { ...base, lines: base.lines.map((l) => (l.key === 'injury' ? { ...l, personalTotal: 28.12 } : l)) }
  const bad2 = { ...base, effectiveFrom: '2026/08' }
  t.ok('A8 自检拦得住「工伤个人部分不为 0」', SI.validateStandard(bad1).length > 0)
  t.ok('A8 自检拦得住「生效月格式不对」', SI.validateStandard(bad2).length > 0)
}

/* ------------------------------ B ERP 副本 ------------------------------ */
async function checkErpCopy(t, SI, src) {
  t.ok('B1 ERP 副本保持 ESM（不得出现 module.exports）', !/module\.exports/.test(src.siEsm))
  let E
  try {
    E = await import(dataUrl(src.siEsm))
  } catch (e) {
    t.ok('B1 ERP 副本可加载', false, e.message)
    return
  }
  const j = (x) => JSON.parse(JSON.stringify(x))
  t.ok('B2 ERP 副本标准 / 品目 / 系统外已扣与真源一致',
    isDeepStrictEqual(j(E.SI_STANDARDS), j(SI.SI_STANDARDS)) && isDeepStrictEqual(j(E.SI_ITEMS), j(SI.SI_ITEMS)) && isDeepStrictEqual(j(E.SI_EXTERNAL_CHARGES), j(SI.SI_EXTERNAL_CHARGES)))
  const cases = [
    { payslipMonth: SEP },
    { payslipMonth: OCT, includeAnnual: true },
    { payslipMonth: '2027-01' },
    { payslipMonth: '2027-02', annualChargedIn: '2027-01' },
    { payslipMonth: '2027-01', includeAnnual: false },
    { payslipMonth: '2026-07' },
  ]
  for (const c of cases) {
    t.ok(`B3 ERP 副本计算一致 ${JSON.stringify(c)}`, isDeepStrictEqual(E.computeSocialInsurance(c), SI.computeSocialInsurance(c)))
  }
}

/* ------------------------------ C 云函数真源 ------------------------------ */
async function checkCloudFn(t, src) {
  const { rows, db } = makeDb([
    { _id: `oL_${SEP}`, staffOpenid: 'oL', staffName: '旧', month: SEP, base: 4000, bonus: 200, gross: 4200, deduction: 452.5, net: 3747.5 },
  ])
  let fn
  try {
    fn = loadMsw(src, db)
  } catch (e) {
    t.ok('C0 manageStaffWorkspace 可加载', false, e.message)
    return
  }
  const call = (data) => fn.main(data)
  const doc = (id) => rows.find((r) => r._id === id)
  const up = (openid, month, extra = {}) => call({ action: 'payslipUpsert', staffOpenid: openid, staffName: openid, month, base: 4000, bonus: 200, deduction: 0, socialInsurance: { apply: true }, ...extra })

  // C1 旧入参：结果逐字不变
  const legacy = await call({ action: 'payslipUpsert', staffOpenid: 'oLEGACY', staffName: '旧', month: OCT, base: 4000, bonus: 200, deduction: 452.5 })
  const d1 = doc(`oLEGACY_${OCT}`)
  t.ok('C1 旧入参保存成功', legacy.success === true, legacy.msg)
  t.ok('C1 旧入参：扣款 / 应发 / 实发不变', d1 && d1.deduction === 452.5 && d1.gross === 4200 && d1.net === 3747.5, d1 && JSON.stringify(d1))
  t.ok('C1 旧入参：不写社保快照、不写其他扣款', d1 && !('socialInsurance' in d1) && !('otherDeduction' in d1))

  // C2 三名员工都按同一每人金额扣（折算人数 2 只用于折算）
  for (const who of ['oA', 'oB', 'oC']) await up(who, SEP)
  const sep3 = ['oA', 'oB', 'oC'].map((w) => doc(`${w}_${SEP}`))
  t.ok('C2 三名员工都套用成功', sep3.every((d) => d && d.socialInsurance), JSON.stringify(sep3.map((d) => !!d)))
  t.ok('C2 每月扣款 452.50、实发 3747.50（公司缴纳不扣）', sep3.every((d) => d && near(d.deduction, 452.5) && near(d.net, 3747.5)), sep3.map((d) => d && `${d.deduction}/${d.net}`).join(','))
  t.ok('C2 公司缴纳 910.27 只存快照、不进实发', sep3.every((d) => d && near(d.socialInsurance?.companyTotal, 910.27) && near(d.gross - d.net, d.deduction)))
  t.ok('C2 2026 年不扣大额医疗互助、注明 8 月已扣', sep3.every((d) => d && !d.socialInsurance?.personal?.some((p) => p.key === 'medicalMutual') &&
    d.socialInsurance?.info?.some((x) => x.kind === 'external')))

  // C3 其他扣款 + 社保
  await up('oD', SEP, { base: 5000, bonus: 0, deduction: 50 })
  const d3 = doc(`oD_${SEP}`)
  t.ok('C3 其他扣款 50 + 个人社保 452.50 = 502.50', d3 && near(d3.deduction, 502.5) && d3.otherDeduction === 50 && near(d3.net, 4497.5), d3 && `${d3.deduction}/${d3.net}`)

  // C4 下个月扣同样的数（不按月拆分、不去重月度品目）
  await up('oA', OCT)
  const d4 = doc(`oA_${OCT}`)
  t.ok('C4 下个月同样扣 452.50（三项都扣）', d4 && near(d4.deduction, 452.5) && d4.socialInsurance?.personal?.map((p) => p.key).join(',') === MONTHLY_KEYS, d4 && `${d4.deduction}`)
  const pvL = await call({ action: 'payslipSiPreview', staffOpenid: 'oL', month: OCT, socialInsurance: {} })
  t.ok('C4 旧工资条没有明细也不影响下个月（照扣 452.50）', pvL.snapshot && near(pvL.snapshot.personalTotal, 452.5))

  // C5 年度品目
  const r5 = await up('oA', '2026-11', { socialInsurance: { apply: true, includeAnnual: true } })
  t.ok('C5 2026 年度强行扣大额医疗互助被拒（8 月已扣）、不落库', r5.success === false && /8 月/.test(r5.msg || '') && !doc('oA_2026-11'), r5.msg)
  await up('oA', '2027-01')
  t.ok('C5 2027 年第一张扣大额医疗互助 100', doc('oA_2027-01')?.socialInsurance?.annualIncluded === true && near(doc('oA_2027-01')?.deduction, 552.5))
  const r5b = await up('oA', '2027-02', { socialInsurance: { apply: true, includeAnnual: true } })
  t.ok('C5 2027 年第二张再扣被拒', r5b.success === false && /全年只扣一次/.test(r5b.msg || ''), r5b.msg)
  await up('oA', '2027-02')
  t.ok('C5 2027 年第二张默认不扣', doc('oA_2027-02')?.socialInsurance?.annualIncluded === false && near(doc('oA_2027-02')?.deduction, 452.5))
  await up('oA', '2027-01', { bonus: 300 })
  t.ok('C5 重存 2027-01 不把自己当成已扣（仍含 100）', doc('oA_2027-01')?.socialInsurance?.annualIncluded === true && near(doc('oA_2027-01')?.deduction, 552.5))

  // C6 预览 = 保存
  const pv = await call({ action: 'payslipSiPreview', staffOpenid: 'oE', month: SEP, socialInsurance: {} })
  await up('oE', SEP, { bonus: 0 })
  t.ok('C6 预览快照 = 保存快照', pv.success === true && pv.snapshot && isDeepStrictEqual(pv.snapshot, doc(`oE_${SEP}`)?.socialInsurance))
  const pv2 = await call({ action: 'payslipSiPreview', staffOpenid: 'oA', month: '2027-03', socialInsurance: { includeAnnual: true } })
  t.ok('C6 预览：已扣过再勾全年品目给出原因、不出快照', !pv2.snapshot && /全年只扣一次/.test(pv2.msg || ''), pv2.msg)

  // C7 明细项模式 + 社保
  await call({ action: 'payslipUpsert', staffOpenid: 'oF', staffName: '丁', month: SEP, items: [{ name: '基本工资', amount: 5000, kind: 'earn' }, { name: '迟到', amount: 100, kind: 'deduct' }], socialInsurance: { apply: true } })
  const d7 = doc(`oF_${SEP}`)
  t.ok('C7 明细项模式：扣款 = 明细扣款 100 + 社保 452.50', d7 && near(d7.deduction, 552.5) && d7.otherDeduction === 100 && near(d7.net, 4447.5), d7 && `${d7.deduction}/${d7.net}`)

  // C8 取消套用：整张覆盖，快照不残留
  await call({ action: 'payslipUpsert', staffOpenid: 'oD', staffName: '乙', month: SEP, base: 5000, bonus: 0, deduction: 50 })
  const d8 = doc(`oD_${SEP}`)
  t.ok('C8 取消套用后快照不残留、扣款回到其他扣款', d8 && !d8.socialInsurance && d8.deduction === 50 && d8.net === 4950)

  t.ok('C9 所有工资条：个人扣款里都没有工伤', rows.every((r) => !r.socialInsurance || !r.socialInsurance.personal.some((p) => p.key === 'injury')))
}

/* ------------------------------ D ERP 薪酬引擎 ------------------------------ */
async function checkErpEngine(t, src) {
  const engineSrc = src.engine
    .replace("from './storeStorage.js'", `from '${pathToFileURL(resolve(ROOT, 'admin/src/utils/storeStorage.js')).href}'`)
    .replace("from './payrollStorage.js'", `from '${pathToFileURL(resolve(ROOT, 'admin/src/utils/payrollStorage.js')).href}'`)
    .replace("from './socialInsurance.js'", `from '${dataUrl(src.siEsm)}'`)
  t.ok('D0 引擎从 socialInsurance.js 取标准', engineSrc !== src.engine && /data:text\/javascript/.test(engineSrc))
  let E
  try {
    E = await import(dataUrl(engineSrc))
  } catch (e) {
    t.ok('D0 ERP 引擎可加载', false, e.message)
    return
  }
  const emps = [
    { id: 'e1', name: '甲', employeeType: 'specimen', baseSalaryMonthly: 4000, monthlyPerformanceBonus: 200, status: 'active' },
    { id: 'e2', name: '乙', employeeType: 'function', baseSalaryMonthly: 5000, monthlyPerformanceBonus: 0, status: 'active' },
    { id: 'e3', name: '丙', employeeType: 'specimen', baseSalaryMonthly: 4000, monthlyPerformanceBonus: 200, status: 'active' },
  ]
  const bundle = { settings: { siEnrolledEmployeeIds: ['e1', 'e3'] }, employees: emps, attendanceMonths: [], slips: [] }
  const find = (g, id, ym) => (g.slips || []).find((s) => s.employeeId === id && s.yearMonth === ym)
  const g1 = E.generateMonthlySlips({}, bundle, SEP)
  const s1 = find(g1, 'e1', SEP)
  const s3 = find(g1, 'e3', SEP)
  const s2 = find(g1, 'e2', SEP)
  t.ok('D1 参保员工：个人 452.50、公司 910.27（第三人同样扣）', [s1, s3].every((s) => s && near(s.siPersonal, 452.5) && near(s.siCompany, 910.27)), s1 && `${s1.siPersonal}/${s1.siCompany}`)
  t.ok('D1 参保员工：实发 = 应发 − 个人社保（公司部分不扣）', s1 && near(s1.netPay, s1.grossPay - s1.siPersonal), s1 && `${s1.grossPay}/${s1.netPay}`)
  t.ok('D1 参保员工：工伤不在个人扣款里', s1 && s1.socialInsurance && !s1.socialInsurance.personal.some((p) => p.key === 'injury'))
  t.ok('D2 未参保员工：实发 = 应发、无快照', s2 && s2.netPay === s2.grossPay && s2.socialInsurance == null && s2.siPersonal === 0)
  const g2 = E.generateMonthlySlips({}, { ...bundle, slips: g1.slips }, OCT)
  t.ok('D3 下个月同样 452.50', near(find(g2, 'e1', OCT)?.siPersonal, 452.5), `${find(g2, 'e1', OCT)?.siPersonal}`)
  const g3 = E.generateMonthlySlips({}, { ...bundle, slips: g2.slips }, '2027-01')
  const g4 = E.generateMonthlySlips({}, { ...bundle, slips: g3.slips }, '2027-02')
  t.ok('D4 2027 年首月扣大额医疗互助、次月不再扣', near(find(g3, 'e1', '2027-01')?.siPersonal, 552.5) && near(find(g4, 'e1', '2027-02')?.siPersonal, 452.5),
    `${find(g3, 'e1', '2027-01')?.siPersonal}/${find(g4, 'e1', '2027-02')?.siPersonal}`)
  const g5 = E.regeneratePartialMonthlySlips({}, { ...bundle, slips: g4.slips }, '2027-02', ['e1'])
  const s5 = find(g5, 'e1', '2027-02')
  t.ok('D5 重算此人与整月生成同口径', s5 && near(s5.siPersonal, 452.5) && near(s5.netPay, s5.grossPay - s5.siPersonal))
  t.ok('D6 ERP 页面展示社保列并导出、写明折算口径与生效月', /社保个人扣/.test(src.payrollVue) && /公司缴纳\(不扣\)/.test(src.payrollVue) && /社保个人扣款/.test(src.payrollVue) &&
    /siEnrolledEmployeeIds/.test(src.payrollVue) && /不限制参保人数/.test(src.payrollVue) && /effectiveFrom/.test(src.payrollVue) && !/所属期/.test(src.payrollVue))
}

/* ------------------------------ E 小程序展示 ------------------------------ */
function checkMiniprogram(t, src, SI) {
  let V
  try {
    V = loadCjsFromSource(P.view, src.view)
  } catch (e) {
    t.ok('E0 payslipView 可加载', false, e.message)
    return
  }
  const snap = SI.computeSocialInsurance({ payslipMonth: SEP }).snapshot
  const det = V.enrichDetail({ month: SEP, base: 4000, bonus: 200, gross: 4200, otherDeduction: 0, deduction: 452.5, net: 3747.5, socialInsurance: snap })
  t.ok('E1 明细：个人三项 养老 / 医疗 / 失业', det.si && det.si.personal.map((r) => `${r.name}${r.amountFmt}`).join(',') === '养老保险351.46,医疗保险87.86,失业保险13.18', det.si && JSON.stringify(det.si.personal))
  t.ok('E1 明细：扣款合计 = 工资条扣款（不含公司缴纳）', near(det.deductDisplay, 452.5), `${det.deductDisplay}`)
  t.ok('E1 明细：公司缴纳单列四项（含工伤）、合计 910.27', det.si && det.si.company.length === 4 && det.si.company.some((r) => r.key === 'injury') && det.si.companyTotalFmt === '910.27')
  t.ok('E1 明细：注明大额医疗互助 8 月已扣、工伤个人不扣、折算口径', det.si && det.si.infos.some((x) => /2026 年度已于 8 月工资扣缴/.test(x)) && /工伤/.test(det.si.injuryNote) && /÷ 2/.test(det.si.splitNote) && /不限制参保人数/.test(det.si.splitNote))
  const old = V.enrichDetail({ month: SEP, base: 4000, bonus: 200, gross: 4200, deduction: 452.5, net: 3747.5 })
  t.ok('E2 旧工资条（无快照）原样显示', old.si === null && old.deductDisplay === 452.5 && old.grossDisplay === 4200)

  const wxml = src.pageWxml
  t.ok('E3 员工页：有「公司为你缴纳」卡片', /公司为你缴纳/.test(wxml) && /wx:for="\{\{detail\.si\.company\}\}"/.test(wxml))
  const cStart = wxml.indexOf('class="scene-card si-company"')
  const cEnd = cStart >= 0 ? wxml.indexOf('<view hover-class', cStart) : -1
  const companyBlock = cStart >= 0 && cEnd > cStart ? wxml.slice(cStart, cEnd) : ''
  t.ok('E3 员工页：公司缴纳金额不带减号', companyBlock.includes('¥{{item.amountFmt}}') && !/-¥/.test(companyBlock))
  t.ok('E3 员工页：个人社保逐项列出、列出说明、不展示所属月 / 参考上期', /wx:for="\{\{detail\.si\.personal\}\}"/.test(wxml) && /detail\.si\.infos/.test(wxml) &&
    !/所属期|item\.period|item\.tag|refNote/.test(wxml) && !/所属期|参考上期|refPeriod/.test(src.view))
  t.ok('E3 员工页脚本走 payslipView 整理', /require\('\.\/payslipView'\)/.test(src.pageJs) && !/function enrichDetail/.test(src.pageJs))
  t.ok('E4 超管页：保存时送 apply、走预览、不再有缴费月 / 所属期 / 旧工资条重复扣提醒',
    /apply: true, includeAnnual: f\.siIncludeAnnual/.test(src.adminJs) && /action: 'payslipSiPreview'/.test(src.adminJs) &&
    !/siPaidMonth|所属期|参考上期|legacyMonths/.test(src.adminJs + src.adminWxml))
  t.ok('E4 超管页：扣款栏写明不含社保、公司部分写明不扣', /其他扣款（考勤等，不含社保）/.test(src.adminWxml) && /公司缴纳合计（不扣工资，只展示）/.test(src.adminWxml))
  // 2026-10-13 弹层规范第 3 批：超管页那 1 处已改样式化弹窗（openAppModal）—— 判据「恰好 1」→「不超过 1」，意图（不新增）不变
  t.ok('E5 不新增原生弹窗', !/wx\.showModal/.test(src.pageJs) && (src.adminJs.match(/wx\.showModal/g) || []).length <= 1)
}

async function runAll(src) {
  const t = makeAsserter()
  let SI
  try {
    SI = loadSi(src)
  } catch (e) {
    t.ok('A0 socialInsurance.js 可加载', false, e.message)
    return t
  }
  checkStandard(t, SI)
  await checkErpCopy(t, SI, src)
  await checkCloudFn(t, src, SI)
  await checkErpEngine(t, src)
  checkMiniprogram(t, src, SI)
  return t
}

function inject(key, from, to) {
  return (s) => {
    if (!s[key].includes(from)) return null
    return { ...s, [key]: s[key].replace(from, to) }
  }
}

const INJECTIONS = [
  ['工伤个人部分被填了金额', inject('siCjs', "{ key: 'injury', personalTotal: 0,", "{ key: 'injury', personalTotal: 28.12,"), /A1|A2/],
  ['个人金额没除以折算人数', inject('siCjs', 'return Math.round(toCents(total) / hc) / 100', 'return Math.round(toCents(total)) / 100'), /A3 .*÷|A4/],
  ['工伤品目丢了「仅公司缴纳」标记', inject('siCjs', "item: '工伤保险费', companyOnly: true }", "item: '工伤保险费' }"), /A1|A2/],
  ['月度金额漂移（医疗）', inject('siCjs', "{ key: 'medical', personalTotal: 175.72,", "{ key: 'medical', personalTotal: 175.27,"), /A4 .*452\.50/],
  ['取标准时取了最早一版而非最近一版', inject('siCjs', 'return hit.length ? hit[hit.length - 1] : null', 'return hit.length ? null : null'), /A3 当前版|A4/],
  ['系统外已扣（8 月大额医疗互助）被忽略', inject('siCjs', 'const ext = SI_EXTERNAL_CHARGES.find(', 'const ext = null && SI_EXTERNAL_CHARGES.find('), /A6|C2 2026/],
  ['同年度已扣仍再扣年度品目', inject('siCjs', '      } else if (chargedIn) {', '      } else if (false) {'), /A7 2027 年已扣过|C5 2027 年第二张|D4/],
  ['公司缴纳被算进扣款', inject('mswIndex', 'doc.deduction = Math.round((totals.deduction + si.snapshot.personalTotal) * 100) / 100', 'doc.deduction = Math.round((totals.deduction + si.snapshot.personalTotal + si.snapshot.companyTotal) * 100) / 100'), /C2 每月扣款|C3/],
  ['强行要求扣年度品目时不拦', inject('mswIndex', '  if (includeAnnual === true && r.snapshot.annualBlocked) return', '  if (false) return'), /C5 .*被拒/],
  ['重存时把本张当成已扣过', inject('mswIndex', 'r && r._id !== excludeId && r.month !== payslipMonth', 'r'), /C5 重存/],
  ['旧入参被改成默认套用社保', inject('mswIndex', '  if (!raw || !raw.apply) return { snapshot: null }', '  if (!raw || !raw.apply) raw = { apply: true }'), /C1/],
  ['ERP 副本金额漂移', inject('siEsm', 'personalTotal: 175.72', 'personalTotal: 175.27'), /B2|B3/],
  ['ERP 副本混入 CommonJS 尾巴', (s) => ({ ...s, siEsm: s.siEsm + '\nmodule.exports = {}\n' }), /B1/],
  ['ERP 引擎把公司缴纳也从实发里扣', inject('engine', 'netPay: Math.round((grossPay - si.personalTotal) * 100) / 100', 'netPay: Math.round((grossPay - si.personalTotal - si.companyTotal) * 100) / 100'), /D1 参保员工：实发/],
  ['ERP 引擎不看往期（年度品目重复扣）', inject('engine', 'annualChargedIn: annualChargedMonth(others, ym.slice(0, 4))', "annualChargedIn: ''"), /D4/],
  ['员工明细把公司缴纳加进扣款合计', inject('view', 'detail.deductDisplay = round2(Number(detail.deduction) || 0)', 'detail.deductDisplay = round2((Number(detail.deduction) || 0) + (Number(detail.socialInsurance.companyTotal) || 0))'), /E1 明细：扣款合计/],
  ['员工页又展示所属月', inject('pageWxml', '<text class="row-sub">{{item.name}}</text>', '<text class="row-sub">{{item.name}} 所属期 {{item.period}}</text>'), /E3 员工页：个人社保/],
  ['员工页公司缴纳金额带减号', inject('pageWxml', '<text class="amount-row si-amount">¥{{item.amountFmt}}</text>', '<text class="amount-row si-amount">-¥{{item.amountFmt}}</text>'), /E3 员工页：公司缴纳金额/],
  ['旧工资条被当成有社保快照', inject('view', "  if (!si || typeof si !== 'object') return null", "  if (!si || typeof si !== 'object') si = { personal: [{ key: 'x', name: '社保', amount: 1 }] }"), /E2/],
  ['超管页保存不送套用标记', inject('adminJs', 'apply: true, includeAnnual: f.siIncludeAnnual', 'apply: false, includeAnnual: f.siIncludeAnnual'), /E4/],
]

async function selftest() {
  let bad = 0
  for (const [name, fn, expect] of INJECTIONS) {
    const mod = fn(SOURCES)
    if (!mod) {
      console.error(`  ✗ 注入锚点失效：${name}`)
      bad += 1
      continue
    }
    const t = await runAll(mod)
    const hit = t.failures.some((f) => expect.test(f))
    if (hit) console.log(`  ✓ 检出：${name}`)
    else {
      console.error(`  ✗ 未检出：${name}（失败项：${t.failures.slice(0, 3).join(' | ') || '无'}）`)
      bad += 1
    }
  }
  if (bad) {
    console.error(`\n✗ test:payslip-social-insurance 自检失败 ${bad}/${INJECTIONS.length}`)
    process.exitCode = 1
  } else {
    console.log(`\n✓ test:payslip-social-insurance 自检：${INJECTIONS.length} 个注入全部检出`)
  }
}

async function main() {
  if (process.argv.includes('--selftest')) {
    const base = await runAll(SOURCES)
    if (base.failures.length) {
      console.error('✗ 基线未通过，自检无意义：')
      base.failures.forEach((f) => console.error(`  - ${f}`))
      process.exitCode = 1
      return
    }
    await selftest()
    return
  }
  const t = await runAll(SOURCES)
  if (t.failures.length) {
    console.error(`✗ test:payslip-social-insurance：${t.failures.length} 项失败（通过 ${t.pass}）`)
    t.failures.forEach((f) => console.error(`  - ${f}`))
    process.exitCode = 1
  } else {
    console.log(`✓ test:payslip-social-insurance：${t.pass} 项全部通过（标准 / ERP 副本 / 云函数真跑 / ERP 引擎 / 小程序展示）`)
  }
}

await main()
process.exit()
