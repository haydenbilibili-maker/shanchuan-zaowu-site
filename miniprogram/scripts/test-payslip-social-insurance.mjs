#!/usr/bin/env node
/**
 * test:payslip-social-insurance —— 工资条社保明细（2026-10-10 产品负责人点名；同日第 2 轮口径）
 *
 * 口径（产品负责人原话）：
 *   ① 按缴费记录的扣出项目拆分薪酬明细；② 记录是两个人的合计，个人展示 = 金额 ÷ 2；③ 工伤保险个人不扣，仅公司支付。
 *   第 2 轮：「第三个人另有缴费记录，三人都该扣」（记录人数只用于折算，不限制参保人数）；
 *   「按所属月分到各自的工资条」（所属期 = 工资月，缺记录沿用最近一期并标「参考上期」）；
 *   「大额医疗互助8月工资已经扣除」（2026 年度系统外已扣，不再扣；下一年度仍一次扣清）。
 *   另：公司缴纳只展示、不进扣款；同一品目同一所属期只扣一次（含预扣）；旧工资条照原样显示。
 *
 * 覆盖：
 *   A 标准真源：记录自检、工伤只能公司缴、每人 = 合计 ÷ 记录人数、9 / 10 月 / 2027 年数值钉死、系统外已扣、参考上期、预扣去重
 *   B ERP 副本与真源同记录、同算法、保持 ESM
 *   C 真跑 manageStaffWorkspace + 内存库：旧入参逐字不变；三名员工都能套用；9 月只扣所属 9 月品目；
 *     10 月识别 9 月预扣不再扣医疗；2026 年度互助被拦、2027 年扣一次；预览 = 保存；重存保留预扣行；旧工资条提醒
 *   D ERP 薪酬引擎：同口径；公司部分不扣；未参保不变
 *   E 小程序：员工明细（逐项 + 所属期 + 参考上期 / 预扣标注 + 系统外已扣说明）、超管页入参与预览、不新增原生弹窗
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

function checkStandard(t, SI) {
  const errs = SI.validateAll()
  t.ok('A1 缴费记录自检通过', errs.length === 0, errs.join('；'))
  const injuryItem = SI.SI_ITEMS.find((i) => i.key === 'injury')
  const injuryLines = SI.SI_RECORDS.flatMap((r) => r.lines.filter((l) => l.key === 'injury'))
  t.ok('A2 工伤品目只由公司缴纳、个人部分为 0', injuryItem && injuryItem.companyOnly === true && injuryLines.length > 0 && injuryLines.every((l) => Number(l.personalTotal) === 0))
  for (const rec of SI.SI_RECORDS) {
    t.ok(`A3 ${rec.id} 记录人数 ≥ 1`, Number(rec.splitHeadcount) >= 1)
    for (const l of rec.lines) {
      const src = SI.lineFor(l.key, l.period)
      const item = SI.SI_ITEMS.find((i) => i.key === l.key)
      t.ok(`A3 ${rec.id}·${l.key} 每人 = 合计 ÷ ${rec.splitHeadcount}`,
        src && near(SI.perHead(l.personalTotal, rec.splitHeadcount), l.personalTotal / rec.splitHeadcount) &&
        near(SI.perHead(l.companyTotal, rec.splitHeadcount), l.companyTotal / rec.splitHeadcount) && !!item)
    }
  }
  t.ok('A3 2026-09-03 记录是两人合计（只用于折算）', SI.SI_RECORDS.some((r) => r.id === 'si-2026-09-03' && r.splitHeadcount === 2))

  // 9 月：只扣所属 9 月的品目
  const sep = SI.computeSocialInsurance({ payslipMonth: SEP })
  t.ok('A4 9 月可算', sep.ok, sep.msg)
  if (sep.ok) {
    const s = sep.snapshot
    const p = amounts(s.personal)
    const c = amounts(s.company)
    t.ok('A4 9 月个人：养老 351.46 + 失业 13.18 = 364.64', near(p.pension, 351.46) && near(p.unemployment, 13.18) && near(s.personalTotal, 364.64) && s.personal.length === 2, JSON.stringify(p))
    t.ok('A4 9 月不扣医疗（所属 10 月）', p.medical == null)
    t.ok('A4 9 月公司：养老 527.18 + 失业 30.75 + 工伤 14.06 = 571.99', near(c.pension, 527.18) && near(c.unemployment, 30.75) && near(c.injury, 14.06) && near(s.companyTotal, 571.99) && c.medical == null, JSON.stringify(c))
    t.ok('A4 9 月不扣大额医疗互助、注明 8 月已扣', p.medicalMutual == null && s.annualIncluded === false && s.info.some((x) => x.kind === 'external' && /2026 年度已于 8 月工资扣缴/.test(x.text)))
    t.ok('A4 工伤不在个人扣款里', !s.personal.some((x) => x.key === 'injury'))
    t.ok('A4 合计 = 各项之和', near(s.personalTotal, sumAmt(s.personal)) && near(s.companyTotal, sumAmt(s.company)))
    t.ok('A4 9 月各项所属期都是 2026-09、无「参考上期」', s.personal.concat(s.company).every((x) => x.period === SEP && !x.refPeriod))
  }

  // 10 月：医疗按记录，其余参考上期
  const oct = SI.computeSocialInsurance({ payslipMonth: OCT })
  t.ok('A5 10 月可算', oct.ok, oct.msg)
  if (oct.ok) {
    const s = oct.snapshot
    const p = Object.fromEntries(s.personal.map((x) => [x.key, x]))
    t.ok('A5 10 月医疗 87.86 按当期记录', p.medical && near(p.medical.amount, 87.86) && !p.medical.refPeriod)
    t.ok('A5 10 月养老 / 失业沿用 9 月并标参考上期', p.pension && p.pension.refPeriod === SEP && p.unemployment && p.unemployment.refPeriod === SEP)
    t.ok('A5 10 月个人 452.50、公司 910.27（医疗公司 338.28）', near(s.personalTotal, 452.5) && near(s.companyTotal, 910.27) && near(amounts(s.company).medical, 338.28), `${s.personalTotal}/${s.companyTotal}`)
  }

  // 10 月：9 月已预扣医疗 → 不再扣
  const octPrior = SI.computeSocialInsurance({ payslipMonth: OCT, charged: [{ key: 'medical', period: OCT, month: SEP }] })
  t.ok('A6 10 月识别 9 月已预扣医疗：个人 364.64、列出提示', octPrior.ok && near(octPrior.snapshot.personalTotal, 364.64) &&
    octPrior.snapshot.info.some((x) => x.kind === 'prior' && x.key === 'medical' && x.month === SEP), octPrior.ok && `${octPrior.snapshot.personalTotal}`)
  t.ok('A6 预扣去重只影响个人部分，公司缴纳照常展示', octPrior.ok && near(octPrior.snapshot.companyTotal, 910.27))

  // 9 月预扣 10 月医疗（方案①）
  const sepAdv = SI.computeSocialInsurance({ payslipMonth: SEP, advance: [{ key: 'medical', period: OCT }] })
  t.ok('A7 9 月预扣 10 月医疗：个人 452.50、医疗行标预扣、公司仍 571.99', sepAdv.ok && near(sepAdv.snapshot.personalTotal, 452.5) &&
    sepAdv.snapshot.personal.some((x) => x.key === 'medical' && x.period === OCT && x.advance === true) && near(sepAdv.snapshot.companyTotal, 571.99) &&
    sepAdv.snapshot.info.some((x) => x.kind === 'advance' && /2026-10）87\.86 已在本张工资预扣/.test(x.text)))

  // 年度品目
  const y1 = SI.computeSocialInsurance({ payslipMonth: '2027-01' })
  t.ok('A8 2027 年首张扣大额医疗互助 100（下一年度当年一次扣清）', y1.ok && near(amounts(y1.snapshot.personal).medicalMutual, 100) && y1.snapshot.annualIncluded === true && near(y1.snapshot.personalTotal, 552.5), y1.ok && `${y1.snapshot.personalTotal}`)
  const y2 = SI.computeSocialInsurance({ payslipMonth: '2027-02', charged: [{ key: 'medicalMutual', period: '2027', month: '2027-01' }] })
  t.ok('A8 2027 年第二张不再扣', y2.ok && amounts(y2.snapshot.personal).medicalMutual == null && !!y2.snapshot.annualBlocked)
  const y3 = SI.computeSocialInsurance({ payslipMonth: '2027-01', includeAnnual: false })
  t.ok('A8 可选暂不扣：列为提示、仍可勾选', y3.ok && amounts(y3.snapshot.personal).medicalMutual == null && y3.snapshot.annualAvailable === true && y3.snapshot.info.some((x) => x.kind === 'deferred'))
  const y4 = SI.computeSocialInsurance({ payslipMonth: '2026-11', includeAnnual: true })
  t.ok('A8 2026 年度强行要求扣也不出现在扣款里、给出系统外已扣原因', y4.ok && amounts(y4.snapshot.personal).medicalMutual == null && /8 月/.test(y4.snapshot.annualBlocked))

  t.ok('A9 没有任何记录的月份不可套用', !SI.computeSocialInsurance({ payslipMonth: '2026-08' }).ok)
  const base = SI.SI_RECORDS[0]
  const bad1 = { ...base, lines: base.lines.map((l) => (l.key === 'injury' ? { ...l, personalTotal: 28.12 } : l)) }
  const bad2 = { ...base, lines: base.lines.map((l) => (l.key === 'medical' ? { ...l, period: '2026' } : l)) }
  t.ok('A10 自检拦得住「工伤个人部分不为 0」', SI.validateRecord(bad1).length > 0)
  t.ok('A10 自检拦得住「月度品目所属期写成年」', SI.validateRecord(bad2).length > 0)
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
  t.ok('B2 ERP 副本记录 / 品目 / 系统外已扣与真源一致',
    isDeepStrictEqual(j(E.SI_RECORDS), j(SI.SI_RECORDS)) && isDeepStrictEqual(j(E.SI_ITEMS), j(SI.SI_ITEMS)) && isDeepStrictEqual(j(E.SI_EXTERNAL_CHARGES), j(SI.SI_EXTERNAL_CHARGES)))
  const cases = [
    { payslipMonth: SEP },
    { payslipMonth: OCT },
    { payslipMonth: OCT, charged: [{ key: 'medical', period: OCT, month: SEP }] },
    { payslipMonth: SEP, advance: [{ key: 'medical', period: OCT }] },
    { payslipMonth: '2027-01', includeAnnual: false },
    { payslipMonth: '2026-08' },
  ]
  for (const c of cases) {
    t.ok(`B3 ERP 副本计算一致 ${JSON.stringify(c)}`, isDeepStrictEqual(E.computeSocialInsurance(c), SI.computeSocialInsurance(c)))
  }
  const rows = [{ month: SEP, socialInsurance: SI.computeSocialInsurance({ payslipMonth: SEP }).snapshot }]
  t.ok('B3 ERP 副本已扣汇总一致', isDeepStrictEqual(E.chargedFromSnapshots(rows), SI.chargedFromSnapshots(rows)))
}

/* ------------------------------ C 云函数真源 ------------------------------ */
async function checkCloudFn(t, src, SI) {
  const advSnap = SI.computeSocialInsurance({ payslipMonth: SEP, advance: [{ key: 'medical', period: OCT }] }).snapshot
  const { rows, db } = makeDb([
    { _id: `oP_${SEP}`, staffOpenid: 'oP', staffName: '预', month: SEP, base: 4000, bonus: 200, gross: 4200, otherDeduction: 0, deduction: 452.5, net: 3747.5, socialInsurance: advSnap },
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

  // C2 三名员工都按同一每人金额扣（记录人数 2 只用于折算）
  for (const who of ['oA', 'oB', 'oC']) await up(who, SEP)
  const sep3 = ['oA', 'oB', 'oC'].map((w) => doc(`${w}_${SEP}`))
  t.ok('C2 三名员工 9 月都套用成功', sep3.every((d) => d && d.socialInsurance), JSON.stringify(sep3.map((d) => !!d)))
  t.ok('C2 9 月扣款 364.64、实发 3835.36（公司缴纳不扣）', sep3.every((d) => d && near(d.deduction, 364.64) && near(d.net, 3835.36)), sep3.map((d) => d && `${d.deduction}/${d.net}`).join(','))
  t.ok('C2 9 月公司缴纳 571.99 只存快照', sep3.every((d) => d && near(d.socialInsurance?.companyTotal, 571.99) && near(d.gross - d.net, d.deduction)))
  t.ok('C2 9 月不扣医疗、注明大额医疗互助 8 月已扣', sep3.every((d) => d && !d.socialInsurance?.personal?.some((p) => p.key === 'medical' || p.key === 'medicalMutual') &&
    d.socialInsurance?.info?.some((x) => x.kind === 'external')))

  // C3 其他扣款 + 社保
  await up('oD', SEP, { base: 5000, bonus: 0, deduction: 50 })
  const d3 = doc(`oD_${SEP}`)
  t.ok('C3 其他扣款 50 + 个人社保 364.64 = 414.64', d3 && near(d3.deduction, 414.64) && d3.otherDeduction === 50 && near(d3.net, 4585.36), d3 && `${d3.deduction}/${d3.net}`)

  // C4 10 月：医疗按记录、其余参考上期
  await up('oA', OCT)
  const d4 = doc(`oA_${OCT}`)
  t.ok('C4 10 月扣款 452.50（医疗 87.86 + 养老 / 失业参考上期）', d4 && near(d4.deduction, 452.5) &&
    d4.socialInsurance?.personal?.some((p) => p.key === 'pension' && p.refPeriod === SEP), d4 && `${d4.deduction}`)

  // C5 9 月已预扣医疗（方案①）→ 10 月不再扣；重存 9 月保留预扣行
  await up('oP', OCT)
  const d5 = doc(`oP_${OCT}`)
  t.ok('C5 10 月识别 9 月预扣：扣款 364.64、不再扣医疗', d5 && near(d5.deduction, 364.64) && !d5.socialInsurance?.personal?.some((p) => p.key === 'medical') &&
    d5.socialInsurance?.info?.some((x) => x.kind === 'prior' && x.month === SEP), d5 && `${d5.deduction}`)
  await up('oP', SEP, { bonus: 200 })
  const d5b = doc(`oP_${SEP}`)
  t.ok('C5 重存 9 月保留预扣行（452.50）', d5b && near(d5b.deduction, 452.5) && d5b.socialInsurance?.personal?.some((p) => p.key === 'medical' && p.advance), d5b && `${d5b.deduction}`)

  // C6 年度品目
  const r6 = await up('oA', '2026-11', { socialInsurance: { apply: true, includeAnnual: true } })
  t.ok('C6 2026 年度强行扣大额医疗互助被拒（8 月已扣）、不落库', r6.success === false && /8 月/.test(r6.msg || '') && !doc('oA_2026-11'), r6.msg)
  await up('oA', '2027-01')
  t.ok('C6 2027 年首张扣大额医疗互助 100', doc('oA_2027-01') && doc('oA_2027-01').socialInsurance?.annualIncluded === true && near(doc('oA_2027-01').deduction, 552.5))
  const r6b = await up('oA', '2027-02', { socialInsurance: { apply: true, includeAnnual: true } })
  t.ok('C6 2027 年第二张再扣被拒', r6b.success === false && /全年只扣一次/.test(r6b.msg || ''), r6b.msg)
  await up('oA', '2027-02')
  t.ok('C6 2027 年第二张默认不扣', doc('oA_2027-02') && doc('oA_2027-02').socialInsurance?.annualIncluded === false && near(doc('oA_2027-02').deduction, 452.5))

  // C7 预览 = 保存；旧工资条提醒
  const pv = await call({ action: 'payslipSiPreview', staffOpenid: 'oE', month: SEP, socialInsurance: {} })
  await up('oE', SEP, { base: 4000, bonus: 0 })
  t.ok('C7 预览快照 = 保存快照', pv.success === true && pv.snapshot && isDeepStrictEqual(pv.snapshot, doc(`oE_${SEP}`).socialInsurance))
  const pvL = await call({ action: 'payslipSiPreview', staffOpenid: 'oL', month: OCT, socialInsurance: {} })
  t.ok('C7 预览点名没有社保明细的旧工资条月份', Array.isArray(pvL.legacyMonths) && pvL.legacyMonths.includes(SEP), JSON.stringify(pvL.legacyMonths))
  const pv2 = await call({ action: 'payslipSiPreview', staffOpenid: 'oA', month: '2027-03', socialInsurance: { includeAnnual: true } })
  t.ok('C7 预览：已扣过再勾全年品目给出原因、不出快照', !pv2.snapshot && /全年只扣一次/.test(pv2.msg || ''), pv2.msg)

  // C8 明细项模式 + 社保
  await call({ action: 'payslipUpsert', staffOpenid: 'oF', staffName: '丁', month: SEP, items: [{ name: '基本工资', amount: 5000, kind: 'earn' }, { name: '迟到', amount: 100, kind: 'deduct' }], socialInsurance: { apply: true } })
  const d8 = doc(`oF_${SEP}`)
  t.ok('C8 明细项模式：扣款 = 明细扣款 100 + 社保 364.64', d8 && near(d8.deduction, 464.64) && d8.otherDeduction === 100 && near(d8.net, 4535.36), d8 && `${d8.deduction}/${d8.net}`)

  // C9 取消套用：整张覆盖，快照不残留
  await call({ action: 'payslipUpsert', staffOpenid: 'oD', staffName: '乙', month: SEP, base: 5000, bonus: 0, deduction: 50 })
  const d9 = doc(`oD_${SEP}`)
  t.ok('C9 取消套用后快照不残留、扣款回到其他扣款', d9 && !d9.socialInsurance && d9.deduction === 50 && d9.net === 4950)

  // C10 重存同月不把自己当成已扣
  await up('oA', OCT, { bonus: 300 })
  t.ok('C10 重存 10 月仍扣 452.50（不把本张当成已扣）', near(doc(`oA_${OCT}`)?.deduction, 452.5), `${doc(`oA_${OCT}`)?.deduction}`)

  t.ok('C11 所有工资条：个人扣款里都没有工伤', rows.every((r) => !r.socialInsurance || !r.socialInsurance?.personal?.some((p) => p.key === 'injury')))
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
  t.ok('D1 参保员工 9 月：个人 364.64、公司 571.99（第三人同样扣）', [s1, s3].every((s) => s && near(s.siPersonal, 364.64) && near(s.siCompany, 571.99)), s1 && `${s1.siPersonal}/${s1.siCompany}`)
  t.ok('D1 参保员工：实发 = 应发 − 个人社保（公司部分不扣）', s1 && near(s1.netPay, s1.grossPay - s1.siPersonal), s1 && `${s1.grossPay}/${s1.netPay}`)
  t.ok('D1 参保员工：工伤不在个人扣款里', s1 && s1.socialInsurance && !s1.socialInsurance.personal.some((p) => p.key === 'injury'))
  t.ok('D2 未参保员工：实发 = 应发、无快照', s2 && s2.netPay === s2.grossPay && s2.socialInsurance == null && s2.siPersonal === 0)
  const g2 = E.generateMonthlySlips({}, { ...bundle, slips: g1.slips }, OCT)
  t.ok('D3 10 月 452.50（医疗按所属期进 10 月）', near(find(g2, 'e1', OCT)?.siPersonal, 452.5), `${find(g2, 'e1', OCT)?.siPersonal}`)
  const g3 = E.generateMonthlySlips({}, { ...bundle, slips: g2.slips }, '2027-01')
  const g4 = E.generateMonthlySlips({}, { ...bundle, slips: g3.slips }, '2027-02')
  t.ok('D4 2027 年首月扣大额医疗互助、次月不再扣', near(find(g3, 'e1', '2027-01')?.siPersonal, 552.5) && near(find(g4, 'e1', '2027-02')?.siPersonal, 452.5),
    `${find(g3, 'e1', '2027-01')?.siPersonal}/${find(g4, 'e1', '2027-02')?.siPersonal}`)
  const g5 = E.regeneratePartialMonthlySlips({}, { ...bundle, slips: g4.slips }, '2027-02', ['e1'])
  const s5 = find(g5, 'e1', '2027-02')
  t.ok('D5 重算此人与整月生成同口径', s5 && near(s5.siPersonal, 452.5) && near(s5.netPay, s5.grossPay - s5.siPersonal))
  t.ok('D6 ERP 页面展示社保列并导出、写明折算口径', /社保个人扣/.test(src.payrollVue) && /公司缴纳\(不扣\)/.test(src.payrollVue) && /社保个人扣款/.test(src.payrollVue) &&
    /siEnrolledEmployeeIds/.test(src.payrollVue) && /不限制参保人数/.test(src.payrollVue))
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
  const adv = SI.computeSocialInsurance({ payslipMonth: SEP, advance: [{ key: 'medical', period: OCT }] }).snapshot
  const det = V.enrichDetail({ month: SEP, base: 4000, bonus: 200, gross: 4200, otherDeduction: 0, deduction: 452.5, net: 3747.5, socialInsurance: adv })
  t.ok('E1 明细：个人三项（养老 / 失业 / 医疗预扣）', det.si && det.si.personal.map((r) => r.amountFmt).join(',') === '351.46,13.18,87.86' && det.si.personal[2].tag === '预扣', det.si && JSON.stringify(det.si.personal))
  t.ok('E1 明细：扣款合计 = 工资条扣款（不含公司缴纳）', near(det.deductDisplay, 452.5), `${det.deductDisplay}`)
  t.ok('E1 明细：公司缴纳单列（含工伤）、合计 571.99', det.si && det.si.company.some((r) => r.key.startsWith('injury')) && det.si.companyTotalFmt === '571.99')
  t.ok('E1 明细：注明大额医疗互助 8 月已扣、工伤个人不扣、折算口径', det.si && det.si.infos.some((x) => /2026 年度已于 8 月工资扣缴/.test(x)) && /工伤/.test(det.si.injuryNote) && /÷ 2/.test(det.si.splitNote) && /不限制参保人数/.test(det.si.splitNote))
  const octSnap = SI.computeSocialInsurance({ payslipMonth: OCT }).snapshot
  const det2 = V.enrichDetail({ month: OCT, gross: 4200, otherDeduction: 0, deduction: 452.5, net: 3747.5, socialInsurance: octSnap })
  t.ok('E1 明细：沿用上期的品目标「参考上期」并加说明', det2.si && det2.si.personal.some((r) => r.tag === '参考上期 2026-09') && /参考上期/.test(det2.si.refNote))
  const old = V.enrichDetail({ month: SEP, base: 4000, bonus: 200, gross: 4200, deduction: 452.5, net: 3747.5 })
  t.ok('E2 旧工资条（无快照）原样显示', old.si === null && old.deductDisplay === 452.5 && old.grossDisplay === 4200)

  const wxml = src.pageWxml
  t.ok('E3 员工页：有「公司为你缴纳」卡片', /公司为你缴纳/.test(wxml) && /wx:for="\{\{detail\.si\.company\}\}"/.test(wxml))
  const cStart = wxml.indexOf('class="scene-card si-company"')
  const cEnd = cStart >= 0 ? wxml.indexOf('<view hover-class', cStart) : -1
  const companyBlock = cStart >= 0 && cEnd > cStart ? wxml.slice(cStart, cEnd) : ''
  t.ok('E3 员工页：公司缴纳金额不带减号', companyBlock.includes('¥{{item.amountFmt}}') && !/-¥/.test(companyBlock))
  t.ok('E3 员工页：个人社保逐项列出、带所属期与标注、列出说明', /wx:for="\{\{detail\.si\.personal\}\}"/.test(wxml) && /所属期 \{\{item\.period\}\}/.test(wxml) &&
    /\{\{item\.tag\}\}/.test(wxml) && /detail\.si\.infos/.test(wxml) && /detail\.si\.refNote/.test(wxml))
  t.ok('E3 员工页脚本走 payslipView 整理', /require\('\.\/payslipView'\)/.test(src.pageJs) && !/function enrichDetail/.test(src.pageJs))
  t.ok('E4 超管页：保存时送 apply、走预览、不再有缴费月输入', /apply: true, includeAnnual: f\.siIncludeAnnual/.test(src.adminJs) && /action: 'payslipSiPreview'/.test(src.adminJs) && !/siPaidMonth/.test(src.adminJs + src.adminWxml))
  t.ok('E4 超管页：扣款栏写明不含社保、公司部分写明不扣、点名旧工资条', /其他扣款（考勤等，不含社保）/.test(src.adminWxml) && /公司缴纳合计（不扣工资，只展示）/.test(src.adminWxml) && /siPreview\.legacyMonths/.test(src.adminWxml))
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
  ['工伤个人部分被填了金额', inject('siCjs', "{ key: 'injury', period: '2026-09', personalTotal: 0,", "{ key: 'injury', period: '2026-09', personalTotal: 28.12,"), /A1|A2/],
  ['个人金额没除以记录人数', inject('siCjs', 'return Math.round(toCents(total) / hc) / 100', 'return Math.round(toCents(total)) / 100'), /A3 .*÷|A4/],
  ['医疗所属期被当成缴费当月', inject('siCjs', "{ key: 'medical', period: '2026-10',", "{ key: 'medical', period: '2026-09',"), /A4 9 月/],
  ['系统外已扣（8 月大额医疗互助）被忽略', inject('siCjs', 'const ext = SI_EXTERNAL_CHARGES.find(', 'const ext = null && SI_EXTERNAL_CHARGES.find('), /A4 9 月不扣大额|C2 9 月/],
  ['之前工资条已扣（含预扣）被忽略', inject('siCjs', 'const prior = charged.find(', 'const prior = null && charged.find('), /A6|C5 10 月/],
  ['缺记录时不沿用上期', inject('siCjs', '  if (before.length) {', '  if (false) {'), /A5|C4/],
  ['公司缴纳被算进扣款', inject('mswIndex', 'doc.deduction = Math.round((totals.deduction + si.snapshot.personalTotal) * 100) / 100', 'doc.deduction = Math.round((totals.deduction + si.snapshot.personalTotal + si.snapshot.companyTotal) * 100) / 100'), /C2 9 月扣款|C3/],
  ['强行要求扣年度品目时不拦', inject('mswIndex', '  if (includeAnnual === true && r.snapshot.annualBlocked) return', '  if (false) return'), /C6 .*被拒/],
  ['重存时把本张当成已扣过', inject('mswIndex', 'r && r._id !== excludeId && r.month !== payslipMonth', 'r && r.socialInsurance'), /C10|C5 重存/],
  ['重存丢掉预扣行', inject('mswIndex', 'advance: hist.advance })', 'advance: [] })'), /C5 重存/],
  ['旧入参被改成默认套用社保', inject('mswIndex', '  if (!raw || !raw.apply) return { snapshot: null, legacyMonths: [] }', '  if (!raw || !raw.apply) raw = { apply: true }'), /C1/],
  ['ERP 副本金额漂移', inject('siEsm', 'personalTotal: 175.72', 'personalTotal: 175.27'), /B2|B3/],
  ['ERP 副本混入 CommonJS 尾巴', (s) => ({ ...s, siEsm: s.siEsm + '\nmodule.exports = {}\n' }), /B1/],
  ['ERP 引擎把公司缴纳也从实发里扣', inject('engine', 'netPay: Math.round((grossPay - si.personalTotal) * 100) / 100', 'netPay: Math.round((grossPay - si.personalTotal - si.companyTotal) * 100) / 100'), /D1 参保员工：实发/],
  ['ERP 引擎不看往期（年度品目重复扣）', inject('engine', 'charged: chargedFromSnapshots(others)', 'charged: []'), /D4/],
  ['员工明细把公司缴纳加进扣款合计', inject('view', 'detail.deductDisplay = round2(Number(detail.deduction) || 0)', 'detail.deductDisplay = round2((Number(detail.deduction) || 0) + (Number(detail.socialInsurance.companyTotal) || 0))'), /E1 明细：扣款合计/],
  ['员工明细丢了「参考上期」标注', inject('view', 'if (r.refPeriod) return `参考上期 ${r.refPeriod}`', "if (r.refPeriod) return ''"), /E1 明细：沿用上期/],
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
