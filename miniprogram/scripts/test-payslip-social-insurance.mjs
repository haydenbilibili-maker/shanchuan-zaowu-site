#!/usr/bin/env node
/**
 * test:payslip-social-insurance —— 工资条社保明细（2026-10-10 产品负责人点名）
 *
 * 口径（产品负责人原话）：
 *   ① 按缴费记录的扣出项目拆分薪酬明细；② 记录是两个人的合计，个人展示 = 金额 ÷ 2；
 *   ③ 工伤保险按政策个人不扣，仅公司支付。
 *   另：公司缴纳部分只展示，不进实发扣款；大额医疗互助全年只扣一次；没有社保快照的旧工资条照原样显示。
 *
 * 覆盖：
 *   A 标准真源（云函数 socialInsurance.js）：每张标准自检通过、工伤只能公司缴、个人 / 公司 = 合计 ÷ 人数、
 *     产品负责人给出的每人金额逐项钉死、所属期偏移
 *   B ERP 副本（admin/src/utils/socialInsurance.js）与真源同标准、同算法、保持 ESM
 *   C 真跑 manageStaffWorkspace 真源 + 内存库：旧入参结果逐字不变；套用标准后 扣款 = 其他扣款 + 个人社保、
 *     实发 = 应发 − 扣款（公司部分不扣）；同年度大额医疗互助只扣一次、重存本张不误判；预览 = 保存
 *   D ERP 薪酬引擎：参保员工实发 = 应发 − 个人社保，公司部分不扣；未参保员工实发不变；次月不重复扣全年品目
 *   E 小程序：员工明细整理（个人扣款 / 公司缴纳分开、扣款合计不含公司部分、旧工资条不变）；
 *     页面文案与入参（公司缴纳无减号、超管页送 socialInsurance 且走预览、不新增原生弹窗）
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
const STD = 'si-2026-09'

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
function checkStandard(t, SI) {
  for (const std of SI.SI_STANDARDS) {
    const errs = SI.validateStandard(std)
    t.ok(`A1 标准 ${std.id} 自检通过`, errs.length === 0, errs.join('；'))
    const injury = std.lines.filter((l) => l.key === 'injury')
    t.ok(`A2 标准 ${std.id} 有工伤品目且只由公司缴纳`, injury.length === 1 && injury[0].companyOnly === true && Number(injury[0].personalTotal) === 0)
    const r = SI.computeSocialInsurance({ standardId: std.id, paidMonth: std.effectiveFrom, includeAnnual: true })
    t.ok(`A3 标准 ${std.id} 可计算`, r.ok, r.msg)
    if (!r.ok) continue
    const snap = r.snapshot
    t.ok(`A3 ${std.id} 工伤不出现在个人扣款里`, !snap.personal.some((p) => p.key === 'injury'))
    for (const l of std.lines) {
      const p = snap.personal.find((x) => x.key === l.key)
      const c = snap.company.find((x) => x.key === l.key)
      if (Number(l.personalTotal) > 0 && !l.companyOnly) {
        t.ok(`A3 ${std.id}·${l.name} 个人 = 合计 ÷ ${std.headcount}`, p && near(p.amount, l.personalTotal / std.headcount), p && `${p.amount}`)
      }
      if (Number(l.companyTotal) > 0) {
        t.ok(`A3 ${std.id}·${l.name} 公司 = 合计 ÷ ${std.headcount}`, c && near(c.amount, l.companyTotal / std.headcount), c && `${c.amount}`)
      }
    }
    const sum = (rows) => rows.reduce((s, x) => s + x.amount, 0)
    t.ok(`A3 ${std.id} 个人合计 = 各项之和`, near(snap.personalTotal, sum(snap.personal)))
    t.ok(`A3 ${std.id} 公司合计 = 各项之和`, near(snap.companyTotal, sum(snap.company)))
  }

  // 产品负责人给出的每人金额（两人合计 ÷ 2），逐项钉死
  const full = SI.computeSocialInsurance({ standardId: STD, paidMonth: '2026-09', includeAnnual: true })
  const monthly = SI.computeSocialInsurance({ standardId: STD, paidMonth: '2026-09', includeAnnual: false })
  t.ok('A4 2026-09 标准可算', full.ok && monthly.ok, full.msg || monthly.msg)
  if (full.ok && monthly.ok) {
    const p = amounts(full.snapshot.personal)
    const c = amounts(full.snapshot.company)
    t.ok('A4 个人：养老 351.46', near(p.pension, 351.46), `${p.pension}`)
    t.ok('A4 个人：医疗 87.86', near(p.medical, 87.86), `${p.medical}`)
    t.ok('A4 个人：大额医疗互助 100.00', near(p.medicalMutual, 100), `${p.medicalMutual}`)
    t.ok('A4 个人：失业 13.18', near(p.unemployment, 13.18), `${p.unemployment}`)
    t.ok('A4 个人：工伤不扣', p.injury == null)
    t.ok('A4 个人合计（含全年品目）552.50', near(full.snapshot.personalTotal, 552.5), `${full.snapshot.personalTotal}`)
    t.ok('A4 个人合计（不含全年品目）452.50', near(monthly.snapshot.personalTotal, 452.5), `${monthly.snapshot.personalTotal}`)
    t.ok('A4 公司：养老 527.18 / 医疗 338.28 / 失业 30.75 / 工伤 14.06',
      near(c.pension, 527.18) && near(c.medical, 338.28) && near(c.unemployment, 30.75) && near(c.injury, 14.06), JSON.stringify(c))
    t.ok('A4 公司合计 910.27', near(full.snapshot.companyTotal, 910.27), `${full.snapshot.companyTotal}`)
    const per = Object.fromEntries(full.snapshot.personal.map((r) => [r.key, r.period]))
    t.ok('A6 所属期：养老 / 失业 = 缴费月，医疗 = 次月，大额医疗互助 = 全年',
      per.pension === '2026-09' && per.unemployment === '2026-09' && per.medical === '2026-10' && per.medicalMutual === '2026 全年', JSON.stringify(per))
    t.ok('A6 全年品目只在 includeAnnual 时出现', monthly.snapshot.annualIncluded === false && full.snapshot.annualIncluded === true)
  }

  // 判据本身能拦住「工伤个人扣」
  const base = SI.SI_STANDARDS.find((s) => s.id === STD)
  const bad1 = { ...base, lines: base.lines.map((l) => (l.key === 'injury' ? { ...l, personalTotal: 28.12 } : l)) }
  const bad2 = { ...base, lines: base.lines.map((l) => (l.key === 'injury' ? { ...l, companyOnly: false } : l)) }
  t.ok('A5 自检拦得住「工伤个人部分不为 0」', SI.validateStandard(bad1).length > 0)
  t.ok('A5 自检拦得住「工伤没标仅公司缴纳」', SI.validateStandard(bad2).length > 0)
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
  t.ok('B2 ERP 副本标准与真源一致', isDeepStrictEqual(JSON.parse(JSON.stringify(E.SI_STANDARDS)), JSON.parse(JSON.stringify(SI.SI_STANDARDS))))
  const cases = [
    { standardId: STD, paidMonth: '2026-09', includeAnnual: true },
    { standardId: STD, paidMonth: '2026-12', includeAnnual: false },
    { standardId: STD, paidMonth: '2027-01', includeAnnual: true },
    { standardId: STD, paidMonth: '2026-08', includeAnnual: true },
    { standardId: 'nope', paidMonth: '2026-09' },
  ]
  for (const c of cases) {
    t.ok(`B3 ERP 副本计算一致 ${JSON.stringify(c)}`, isDeepStrictEqual(E.computeSocialInsurance(c), SI.computeSocialInsurance(c)))
  }
  t.ok('B3 ERP 副本默认缴费月一致', E.defaultPaidMonth('2026-01') === SI.defaultPaidMonth('2026-01') && SI.defaultPaidMonth('2026-01') === '2025-12')
}

/* ------------------------------ C 云函数真源 ------------------------------ */
async function checkCloudFn(t, src) {
  const { rows, db } = makeDb()
  let fn
  try {
    fn = loadMsw(src, db)
  } catch (e) {
    t.ok('C0 manageStaffWorkspace 可加载', false, e.message)
    return
  }
  const call = (data) => fn.main(data)
  const doc = (id) => rows.find((r) => r._id === id)

  // C1 旧入参：结果逐字不变
  const legacy = await call({ action: 'payslipUpsert', staffOpenid: 'oLEGACY', staffName: '旧', month: '2026-10', base: 4000, bonus: 200, deduction: 452.5 })
  const d1 = doc('oLEGACY_2026-10')
  t.ok('C1 旧入参保存成功', legacy.success === true, legacy.msg)
  t.ok('C1 旧入参：扣款 / 应发 / 实发不变', d1 && d1.deduction === 452.5 && d1.gross === 4200 && d1.net === 3747.5, d1 && JSON.stringify(d1))
  t.ok('C1 旧入参：不写社保快照、不写其他扣款', d1 && !('socialInsurance' in d1) && !('otherDeduction' in d1))

  // C2 套用标准：首张自动含全年品目
  const r2 = await call({ action: 'payslipUpsert', staffOpenid: 'oA', staffName: '甲', month: '2026-10', base: 4000, bonus: 200, deduction: 0, socialInsurance: { standardId: STD } })
  const d2 = doc('oA_2026-10')
  t.ok('C2 套用标准保存成功', r2.success === true, r2.msg)
  const s2 = d2 && d2.socialInsurance
  t.ok('C2 默认缴费月 = 工资月上一月', s2 && s2.paidMonth === '2026-09', s2 && s2.paidMonth)
  t.ok('C2 首张自动扣大额医疗互助', s2 && s2.annualIncluded === true)
  t.ok('C2 扣款 = 其他扣款 + 个人社保 552.50', d2 && near(d2.deduction, 552.5) && d2.otherDeduction === 0, d2 && `${d2.deduction}`)
  t.ok('C2 实发 = 应发 − 扣款（公司缴纳不扣）3647.50', d2 && near(d2.net, 3647.5), d2 && `${d2.net}`)
  t.ok('C2 公司缴纳只存快照 910.27、不进扣款', s2 && near(s2.companyTotal, 910.27) && near(d2.gross - d2.net, d2.deduction))
  t.ok('C2 工伤不在个人扣款里', s2 && !s2.personal.some((p) => p.key === 'injury') && s2.company.some((p) => p.key === 'injury'))

  // C3 其他扣款 + 社保
  await call({ action: 'payslipUpsert', staffOpenid: 'oB', staffName: '乙', month: '2026-10', base: 5000, bonus: 0, deduction: 50, socialInsurance: { standardId: STD, includeAnnual: false } })
  const d3 = doc('oB_2026-10')
  t.ok('C3 其他扣款 50 + 个人社保 452.50 = 502.50', d3 && near(d3.deduction, 502.5) && d3.otherDeduction === 50, d3 && `${d3.deduction}`)
  t.ok('C3 实发 4497.50', d3 && near(d3.net, 4497.5), d3 && `${d3.net}`)

  // C4 全年品目只扣一次
  const r4 = await call({ action: 'payslipUpsert', staffOpenid: 'oA', staffName: '甲', month: '2026-11', base: 4000, bonus: 200, deduction: 0, socialInsurance: { standardId: STD } })
  const d4 = doc('oA_2026-11')
  t.ok('C4 次月保存成功', r4.success === true, r4.msg)
  t.ok('C4 次月自动不再扣大额医疗互助（452.50）', d4 && d4.socialInsurance && d4.socialInsurance.annualIncluded === false && near(d4.deduction, 452.5), d4 && `${d4.deduction}`)
  const r4b = await call({ action: 'payslipUpsert', staffOpenid: 'oA', staffName: '甲', month: '2026-12', base: 4000, bonus: 200, deduction: 0, socialInsurance: { standardId: STD, includeAnnual: true } })
  t.ok('C4 同年度强行再扣被拒、不落库', r4b.success === false && /全年只扣一次/.test(r4b.msg || '') && !doc('oA_2026-12'), r4b.msg)
  const r4c = await call({ action: 'payslipUpsert', staffOpenid: 'oA', staffName: '甲', month: '2027-02', base: 4000, bonus: 200, deduction: 0, socialInsurance: { standardId: STD } })
  t.ok('C4 跨年度重新扣一次', r4c.success === true && doc('oA_2027-02').socialInsurance.annualIncluded === true)

  // C5 重存同一张不把自己当成「已扣过」
  const r5 = await call({ action: 'payslipUpsert', staffOpenid: 'oA', staffName: '甲', month: '2026-10', base: 4000, bonus: 300, deduction: 0, socialInsurance: { standardId: STD, includeAnnual: true } })
  t.ok('C5 重存首张仍可含全年品目', r5.success === true && doc('oA_2026-10').socialInsurance.annualIncluded === true, r5.msg)

  // C6 预览 = 保存
  const pv = await call({ action: 'payslipSiPreview', staffOpenid: 'oC', month: '2026-10', socialInsurance: {} })
  await call({ action: 'payslipUpsert', staffOpenid: 'oC', staffName: '丙', month: '2026-10', base: 4000, bonus: 0, deduction: 0, socialInsurance: { standardId: pv.standardId, paidMonth: pv.paidMonth, includeAnnual: pv.snapshot && pv.snapshot.annualIncluded } })
  t.ok('C6 预览给出默认标准与缴费月', pv.success === true && pv.standardId === STD && pv.paidMonth === '2026-09' && Array.isArray(pv.standards))
  t.ok('C6 预览快照 = 保存快照', pv.snapshot && isDeepStrictEqual(pv.snapshot, doc('oC_2026-10').socialInsurance))
  const pv2 = await call({ action: 'payslipSiPreview', staffOpenid: 'oA', month: '2026-12', socialInsurance: { includeAnnual: true } })
  t.ok('C6 预览：已扣过再勾全年品目给出原因、不出快照', !pv2.snapshot && /全年只扣一次/.test(pv2.msg || '') && pv2.annualChargedIn === '2026-10', JSON.stringify(pv2.msg))

  // C7 明细项模式 + 社保
  await call({ action: 'payslipUpsert', staffOpenid: 'oD', staffName: '丁', month: '2026-10', items: [{ name: '基本工资', amount: 5000, kind: 'earn' }, { name: '迟到', amount: 100, kind: 'deduct' }], socialInsurance: { standardId: STD, includeAnnual: false } })
  const d7 = doc('oD_2026-10')
  t.ok('C7 明细项模式：扣款 = 明细扣款 100 + 社保 452.50', d7 && near(d7.deduction, 552.5) && d7.otherDeduction === 100 && near(d7.net, 4447.5), d7 && `${d7.deduction}/${d7.net}`)

  // C8 取消套用：整张覆盖，快照不残留
  await call({ action: 'payslipUpsert', staffOpenid: 'oB', staffName: '乙', month: '2026-10', base: 5000, bonus: 0, deduction: 50 })
  const d8 = doc('oB_2026-10')
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
  ]
  const bundle = { settings: { siEnrolledEmployeeIds: ['e1'] }, employees: emps, attendanceMonths: [], slips: [] }
  const g1 = E.generateMonthlySlips({}, bundle, '2026-10')
  const s1 = (g1.slips || []).find((s) => s.employeeId === 'e1')
  const s2 = (g1.slips || []).find((s) => s.employeeId === 'e2')
  t.ok('D1 参保员工：个人社保 552.50、公司 910.27', s1 && near(s1.siPersonal, 552.5) && near(s1.siCompany, 910.27), s1 && `${s1.siPersonal}/${s1.siCompany}`)
  t.ok('D1 参保员工：实发 = 应发 − 个人社保（公司部分不扣）', s1 && near(s1.netPay, s1.grossPay - s1.siPersonal) && near(s1.netPay, 3647.5), s1 && `${s1.grossPay}/${s1.netPay}`)
  t.ok('D1 参保员工：工伤不在个人扣款里', s1 && s1.socialInsurance && !s1.socialInsurance.personal.some((p) => p.key === 'injury'))
  t.ok('D2 未参保员工：实发 = 应发、无快照', s2 && s2.netPay === s2.grossPay && s2.socialInsurance == null && s2.siPersonal === 0)
  const g2 = E.generateMonthlySlips({}, { ...bundle, slips: g1.slips }, '2026-11')
  const s3 = (g2.slips || []).find((s) => s.employeeId === 'e1' && s.yearMonth === '2026-11')
  t.ok('D3 次月不再扣大额医疗互助（452.50）', s3 && near(s3.siPersonal, 452.5) && s3.socialInsurance.annualIncluded === false, s3 && `${s3.siPersonal}`)
  const g3 = E.regeneratePartialMonthlySlips({}, { ...bundle, slips: g2.slips }, '2026-11', ['e1'])
  const s4 = (g3.slips || []).find((s) => s.employeeId === 'e1' && s.yearMonth === '2026-11')
  t.ok('D4 重算此人与整月生成同口径', s4 && near(s4.siPersonal, 452.5) && near(s4.netPay, s4.grossPay - s4.siPersonal))
  t.ok('D5 ERP 页面展示社保列并导出', /社保个人扣/.test(src.payrollVue) && /公司缴纳\(不扣\)/.test(src.payrollVue) && /社保个人扣款/.test(src.payrollVue) && /siEnrolledEmployeeIds/.test(src.payrollVue))
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
  const snap = SI.computeSocialInsurance({ standardId: STD, paidMonth: '2026-09', includeAnnual: true }).snapshot
  const det = V.enrichDetail({ month: '2026-10', base: 4000, bonus: 200, gross: 4200, otherDeduction: 0, deduction: 552.5, net: 3647.5, socialInsurance: snap })
  t.ok('E1 明细：个人扣款四项、金额与快照一致', det.si && det.si.personal.length === 4 && det.si.personal.map((r) => r.amountFmt).join(',') === '351.46,87.86,100.00,13.18', det.si && det.si.personal.map((r) => r.amountFmt).join(','))
  t.ok('E1 明细：扣款合计 = 工资条扣款（不含公司缴纳）', near(det.deductDisplay, 552.5), `${det.deductDisplay}`)
  t.ok('E1 明细：公司缴纳单列（含工伤）、合计 910.27', det.si && det.si.company.some((r) => r.key.startsWith('injury')) && det.si.companyTotalFmt === '910.27')
  t.ok('E1 明细：注明工伤个人不扣、按人数均摊', det.si && /工伤/.test(det.si.injuryNote) && /÷ 2/.test(det.si.splitNote))
  const old = V.enrichDetail({ month: '2026-10', base: 4000, bonus: 200, gross: 4200, deduction: 452.5, net: 3747.5 })
  t.ok('E2 旧工资条（无快照）原样显示', old.si === null && old.deductDisplay === 452.5 && old.grossDisplay === 4200)

  const wxml = src.pageWxml
  t.ok('E3 员工页：有「公司为你缴纳」卡片', /公司为你缴纳/.test(wxml) && /wx:for="\{\{detail\.si\.company\}\}"/.test(wxml))
  const cStart = wxml.indexOf('class="scene-card si-company"')
  const cEnd = cStart >= 0 ? wxml.indexOf('<view hover-class', cStart) : -1
  const companyBlock = cStart >= 0 && cEnd > cStart ? wxml.slice(cStart, cEnd) : ''
  t.ok('E3 员工页：公司缴纳金额不带减号', companyBlock.includes('¥{{item.amountFmt}}') && !/-¥/.test(companyBlock))
  t.ok('E3 员工页：个人社保逐项列出且带所属期', /wx:for="\{\{detail\.si\.personal\}\}"/.test(wxml) && /所属期 \{\{item\.period\}\}/.test(wxml))
  t.ok('E3 员工页脚本走 payslipView 整理', /require\('\.\/payslipView'\)/.test(src.pageJs) && !/function enrichDetail/.test(src.pageJs))
  t.ok('E4 超管页：保存时送 socialInsurance、走预览', /socialInsurance: f\.siOn/.test(src.adminJs) && /action: 'payslipSiPreview'/.test(src.adminJs))
  t.ok('E4 超管页：扣款栏在套用时写明不含社保、公司部分写明不扣', /其他扣款（考勤等，不含社保）/.test(src.adminWxml) && /公司缴纳合计（不扣工资，只展示）/.test(src.adminWxml))
  t.ok('E5 不新增原生弹窗', !/wx\.showModal/.test(src.pageJs) && (src.adminJs.match(/wx\.showModal/g) || []).length === 1)
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
  await checkCloudFn(t, src)
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
  ['工伤个人部分被填了金额', inject('siCjs', 'personalTotal: 0, companyTotal: 28.12', 'personalTotal: 28.12, companyTotal: 28.12'), /A1|A2/],
  ['计算时把工伤算进个人扣款', inject('siCjs', '    if (p > 0) {', '    if (p > 0 || l.companyOnly) {'), /工伤不(在|出现在)个人扣款/],
  ['个人金额没除以均摊人数', inject('siCjs', 'return Math.round(toCents(total) / hc) / 100', 'return Math.round(toCents(total)) / 100'), /A3 .*÷|A4/],
  ['公司缴纳被算进扣款', inject('mswIndex', 'doc.deduction = Math.round((totals.deduction + si.snapshot.personalTotal) * 100) / 100', 'doc.deduction = Math.round((totals.deduction + si.snapshot.personalTotal + si.snapshot.companyTotal) * 100) / 100'), /C2 扣款|C2 实发/],
  ['同年度已扣仍可再扣全年品目', inject('mswIndex', '  if (includeAnnual && chargedIn) return {', '  if (false) return {'), /C4 同年度/],
  ['自动判断总是扣全年品目', inject('mswIndex', 'raw.includeAnnual == null ? !chargedIn :', 'raw.includeAnnual == null ? true :'), /C4 次月/],
  ['重存时把本张当成已扣过', inject('mswIndex', 'r && r._id !== excludeId && r.socialInsurance', 'r && r.socialInsurance'), /C5/],
  ['旧入参被改成默认套用社保', inject('mswIndex', "  if (!raw || !raw.standardId) return { snapshot: null, annualChargedIn: '' }", "  if (!raw || !raw.standardId) raw = { standardId: 'si-2026-09' }"), /C1/],
  ['ERP 副本金额漂移', inject('siEsm', 'personalTotal: 175.72', 'personalTotal: 175.27'), /B2|B3/],
  ['ERP 副本混入 CommonJS 尾巴', (s) => ({ ...s, siEsm: s.siEsm + '\nmodule.exports = {}\n' }), /B1/],
  ['ERP 引擎把公司缴纳也从实发里扣', inject('engine', 'netPay: Math.round((grossPay - si.personalTotal) * 100) / 100', 'netPay: Math.round((grossPay - si.personalTotal - si.companyTotal) * 100) / 100'), /D1 参保员工：实发/],
  ['ERP 引擎次月重复扣全年品目', inject('engine', 'includeAnnual: !charged', 'includeAnnual: true'), /D3/],
  ['员工明细把公司缴纳加进扣款合计', inject('view', 'detail.deductDisplay = round2(Number(detail.deduction) || 0)', 'detail.deductDisplay = round2((Number(detail.deduction) || 0) + (Number(detail.socialInsurance.companyTotal) || 0))'), /E1 明细：扣款合计/],
  ['员工页公司缴纳金额带减号', inject('pageWxml', '<text class="amount-row si-amount">¥{{item.amountFmt}}</text>', '<text class="amount-row si-amount">-¥{{item.amountFmt}}</text>'), /E3 员工页：公司缴纳金额/],
  ['旧工资条被当成有社保快照', inject('view', "  if (!si || typeof si !== 'object') return null", "  if (!si || typeof si !== 'object') si = { personal: [{ key: 'x', name: '社保', amount: 1 }] }"), /E2/],
  ['超管页保存不送社保入参', inject('adminJs', 'socialInsurance: f.siOn', 'socialInsuranceOff: f.siOn'), /E4/],
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
