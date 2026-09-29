#!/usr/bin/env node
/**
 * test:finance-ledger-integrity —— 财务日账归属 / 解析 / 删除标记（2026-09-29 产品负责人拍板的 5 项修正配套守卫）
 *
 * 覆盖：
 *   1. 山川造物历史 id 归属：admin financeDayAggregate.LEGACY_MAIN_STORE_IDS 是真源，
 *      syncFinanceData / getAnalyticsDashboard / dailyDigest / manageStaffWorkspace / 小程序 storeLedger.js（两份）
 *      的 MAIN_STORE_ALIAS_IDS 必须逐字一致；ERP resolveFinanceStore / canonicalLedgerStoreId / dashboardMetrics 均归主店
 *   2. 源头：ERP 本地门店（只有 genStoreEntityId 本地 id）认得出是山川 / 星宸时，账本写 canonical id，
 *      认不出（加盟新店）才写本地 id；findStoreById 用 canonical id 能找回本地门店
 *   3. 解析：2026-09-26 山川造物生产原文（明细含「戒指 39」）→ ERP + 小程序两份解析器 POS 都是 9773.6；
 *      表头缺 POS、明细里有「POS 39」→ 必须报错而不是拿明细
 *   4. 小程序提交前核对：表单 POS ≠ 原文表头 POS → rawPosMismatch 命中；submitRevenue 在写入前调用并走自定义弹层
 *   5. 删除标记（真跑 syncFinanceData + 内存库）：删除前的旧行被挡；删除后重新录入的同日账照常显示
 *   6. store_ledger_deletions 三处登记：COLLECTIONS / rules（读写全拒）/ schema
 *
 * --selftest：对各源码做内存注入（不写盘），每个注入都必须被检出。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Module from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const P = {
  aggregate: resolve(ROOT, 'admin/src/utils/financeDayAggregate.js'),
  dupCheck: resolve(ROOT, 'admin/src/utils/financeDuplicateCheck.js'),
  storeStorage: resolve(ROOT, 'admin/src/utils/storeStorage.js'),
  dashboard: resolve(ROOT, 'admin/src/utils/dashboardMetrics.js'),
  erpParse: resolve(ROOT, 'admin/src/utils/financeDailyParse.js'),
  fnSync: resolve(ROOT, 'miniprogram/cloudfunctions/syncFinanceData/index.js'),
  fnDup: resolve(ROOT, 'miniprogram/cloudfunctions/syncFinanceData/ledgerDuplicate.js'),
  fnAnalytics: resolve(ROOT, 'miniprogram/cloudfunctions/getAnalyticsDashboard/index.js'),
  fnDigest: resolve(ROOT, 'miniprogram/cloudfunctions/dailyDigest/reportCatalog.js'),
  fnSalesShare: resolve(ROOT, 'miniprogram/cloudfunctions/manageStaffWorkspace/salesShareRevenue.js'),
  mgrLedger: resolve(ROOT, 'miniprogram/subpackages/manager/utils/storeLedger.js'),
  extraLedger: resolve(ROOT, 'miniprogram/subpackages/extra/utils/storeLedger.js'),
  mgrParse: resolve(ROOT, 'miniprogram/subpackages/manager/utils/financeDailyParse.js'),
  extraParse: resolve(ROOT, 'miniprogram/subpackages/extra/utils/financeDailyParse.js'),
  formCheck: resolve(ROOT, 'miniprogram/subpackages/manager/utils/ledgerFormCheck.js'),
  page: resolve(ROOT, 'miniprogram/subpackages/manager/manager/managerPageConfig.js'),
  cloudJs: resolve(ROOT, 'admin/src/cloud.js'),
  rules: resolve(ROOT, 'cloudbase/rules/store_ledger_deletions.json'),
  schema: resolve(ROOT, 'cloudbase/schema/store_ledger_deletions.md'),
}
const read = (p) => readFileSync(p, 'utf8')
const SOURCES = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, read(p)]))

const MAIN = 'store_shanhaizaowu'
const XC = 'store_xingchen'
const ALIAS_FILES = ['fnSync', 'fnAnalytics', 'fnDigest', 'fnSalesShare', 'mgrLedger', 'extraLedger']

/** 2026-09-26 山川造物日报生产原文（store_ledger 92994ce0…）：入库 POS 9812.6，原文 9773.60，差额 = 明细「戒指 39」 */
const RAW_0926 = [
  '山川造物', '2026年 9月26日', '银联POS收款:9773.60元', '订单数:150', '线上：0元', '退款：0元', '现金：1549.5元',
  '9月合计：127204.18元', '—————————', '1.蓝闪蝶', '   戒指 39', '  蛇戒 0', '  手链 单珠 37', '           三珠30',
  '           四珠1', '           五珠29', '           六珠7', '           吊坠23', '           耳钉 45s925 7个',
  '           八珠项链 9', '           蓝闪胸针2', '2.夜明珠', '   戒指 0', '  手链 单珠 22', '           三珠 21',
  '           吊坠 18', '3.血漪蛱蝶', '   戒指31', '  手链  单珠17', '            吊坠 54', '4.华艳色螅  ', '   戒指27',
  '5.光明女神', '   戒指0', '6.彩珠 手链0', '7.雅灰蝶', '  胸针 9', '  手镯 2', '  手链1', '8.蝴蝶翅膀耳钉17',
].join('\n')
/** 表头缺 POS、明细里有「POS 39」：必须报错，不得拿明细当刷卡 */
const RAW_NO_HEADER_POS = RAW_0926.replace('银联POS收款:9773.60元\n', '').replace('   戒指 39', '   POS 39')

function loadCjsFromSource(filename, source, stubs = {}) {
  const m = new Module(filename)
  m.filename = filename
  m.paths = Module._nodeModulePaths(dirname(filename))
  const origRequire = m.require.bind(m)
  m.require = (id) => (Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : origRequire(id))
  m._compile(source, filename)
  return m.exports
}

/** 从内存源码加载 ESM；rewrites 把相对 import 指到内存里的注入版本（data: URL），其余指真文件 */
async function importEsm(source, filePath, rewrites = {}) {
  const s = source.replace(/from '(\.\/[^']+)'/g, (_, rel) => {
    if (rewrites[rel]) return `from '${rewrites[rel]}'`
    return `from '${pathToFileURL(resolve(dirname(filePath), rel)).href}'`
  })
  return import(`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`)
}
const dataUrl = (s) => `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`

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

function sliceBody(src, startRe, endRe) {
  const m = src.match(startRe)
  if (!m) return ''
  const rest = src.slice(m.index)
  const e = rest.slice(m[0].length).search(endRe)
  return e === -1 ? rest : rest.slice(0, m[0].length + e)
}

function aliasListOf(src) {
  const m = src.match(/const MAIN_STORE_ALIAS_IDS = \[([^\]]*)\]/)
  if (!m) return null
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

/* ------------------------------ 内存库（syncFinanceData 用到的查询子集） ------------------------------ */
function makeDb(seed) {
  const data = {}
  for (const [k, rows] of Object.entries(seed)) data[k] = rows.map((r) => ({ ...r }))
  let seq = 0
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
    const rows = () => {
      if (!data[name]) { const e = new Error('Db or Table not exist'); e.errCode = -502005; throw e }
      return data[name]
    }
    const api = {
      where(w) { st.where = w; return api },
      orderBy() { return api },
      field() { return api },
      skip(n) { st.skip = n; return api },
      limit(n) { st.limit = n; return api },
      async get() { return { data: rows().filter((r) => match(r, st.where)).slice(st.skip, st.skip + st.limit).map((r) => ({ ...r })) } },
      async add({ data: d }) {
        const _id = `new_${++seq}`
        ;(data[name] = data[name] || []).push({ ...d, _id })
        return { _id }
      },
      doc(id) {
        return {
          async get() { return { data: rows().filter((r) => r._id === id) } },
          async update({ data: d }) { const r = rows().find((x) => x._id === id); if (r) Object.assign(r, d); return { stats: { updated: r ? 1 : 0 } } },
          async set({ data: d }) { const list = rows(); const i = list.findIndex((x) => x._id === id); if (i >= 0) list[i] = { ...d, _id: id }; else list.push({ ...d, _id: id }); return {} },
          async remove() { data[name] = rows().filter((x) => x._id !== id); return { stats: { removed: 1 } } },
        }
      },
    }
    return api
  }
  return { data, db: { collection, command: _, serverDate: () => new Date() } }
}

function loadSyncFn(src, mem) {
  const sdk = { init() {}, DYNAMIC_CURRENT_ENV: 'x', database: () => mem.db, getWXContext: () => ({ OPENID: 'oa_admin' }) }
  return loadCjsFromSource(P.fnSync, src.fnSync, {
    'wx-server-sdk': sdk,
    './staffGuard': { assertStaff: async () => ({ ok: true }), ROLE_MANAGER: 'manager' },
    './ledgerDuplicate': loadCjsFromSource(P.fnDup, src.fnDup),
  })
}

/* ------------------------------------------ 断言 ------------------------------------------ */
async function runChecks(src) {
  const t = makeAsserter()
  const agg = await importEsm(src.aggregate, P.aggregate)
  const aggUrl = dataUrl(src.aggregate)
  const LEGACY = agg.LEGACY_MAIN_STORE_IDS || []

  // 1. 归属
  t.ok('真源含 3 个山川历史 id', LEGACY.length === 3 && LEGACY.includes('store_1780160394767_szo1k77') && LEGACY.includes('store_1780841157244_p48w0bx'), JSON.stringify(LEGACY))
  for (const k of ALIAS_FILES) {
    const list = aliasListOf(src[k])
    t.ok(`${k} 的 MAIN_STORE_ALIAS_IDS 与真源逐字一致`, JSON.stringify(list) === JSON.stringify(LEGACY), JSON.stringify(list))
  }
  t.ok('dailyDigest REPORT_STORES 用 MAIN_STORE_ALIAS_IDS', /name: '山川造物', aliases: MAIN_STORE_ALIAS_IDS/.test(src.fnDigest))
  t.ok('syncFinanceData REPORT_STORES 用 MAIN_STORE_ALIAS_IDS', /name: '山川造物', aliases: MAIN_STORE_ALIAS_IDS/.test(src.fnSync))
  t.ok('dashboardMetrics 主店别名展开真源', /aliases: \[\.\.\.LEGACY_MAIN_STORE_IDS/.test(src.dashboard))
  const dup = await importEsm(src.dupCheck, P.dupCheck, { './financeDayAggregate.js': aggUrl })
  for (const id of LEGACY) {
    t.ok(`ERP resolveFinanceStore(${id}) → 山川造物`, agg.resolveFinanceStore({ storeId: id }).storeId === MAIN)
    t.ok(`ERP 去重键 ${id} 与主店同键`, dup.canonicalLedgerStoreId({ storeId: id }) === MAIN)
  }

  // 2. 源头
  const ss = await importEsm(src.storeStorage, P.storeStorage, { './financeDayAggregate.js': aggUrl })
  const localMain = { id: 'store_1780841157244_p48w0bx', code: 'CCYS001', name: '长春这有山1号门店' }
  const localMainByName = { id: 'store_1_x', code: '', name: '山川造物' }
  const localXc = { id: 'store_2_y', code: '', name: '星宸标本工作室' }
  const localNew = { id: 'store_3_z', code: 'JM01', name: '加盟店 · 哈尔滨' }
  t.ok('本地「CCYS001 · 长春这有山1号门店」写 canonical 主店 id', ss.resolveFinanceStoreWriteId(localMain) === MAIN, ss.resolveFinanceStoreWriteId(localMain))
  t.ok('本地「山川造物」写 canonical 主店 id', ss.resolveFinanceStoreWriteId(localMainByName) === MAIN)
  t.ok('本地「星宸标本工作室」写 canonical 星宸 id', ss.resolveFinanceStoreWriteId(localXc) === XC)
  t.ok('认不出的新店仍写本地 id（不瞎归）', ss.resolveFinanceStoreWriteId(localNew) === 'store_3_z')
  t.ok('已有 canonical storeId 原样用', ss.resolveFinanceStoreWriteId({ id: 'store_9', storeId: XC, name: '山川造物' }) === XC)
  t.ok('findStoreById 用 canonical id 找回本地门店', ss.findStoreById({ stores: [localNew, localMain] }, MAIN) === localMain)
  const matchIds = ss.financeStoreMatchIds(localMain)
  t.ok('门店筛选匹配 id 含全部历史 id', LEGACY.every((id) => matchIds.includes(id)), JSON.stringify(matchIds))

  // 3. 解析
  const erp = await importEsm(src.erpParse, P.erpParse)
  const parsers = [
    ['ERP', erp.parseDailyFinanceText],
    ['小程序 manager', loadCjsFromSource(P.mgrParse, src.mgrParse).parseDailyFinanceText],
    ['小程序 extra', loadCjsFromSource(P.extraParse, src.extraParse).parseDailyFinanceText],
  ]
  for (const [name, parse] of parsers) {
    const r = parse(RAW_0926)
    t.ok(`${name} 解析 9/26 原文 POS = 9773.6（明细「戒指 39」不计入）`, r.ok && Math.abs(r.pos - 9773.6) < 0.005 && Math.abs(r.revenue - 9773.6) < 0.005 && r.orderCount === 150, JSON.stringify({ pos: r.pos, revenue: r.revenue, orderCount: r.orderCount }))
    const bad = parse(RAW_NO_HEADER_POS)
    t.ok(`${name} 表头缺 POS、明细有「POS 39」→ 报错`, !bad.ok, JSON.stringify({ ok: bad.ok, pos: bad.pos }))
  }

  // 4. 提交前核对
  const fc = loadCjsFromSource(P.formCheck, src.formCheck, { './financeDailyParse': loadCjsFromSource(P.mgrParse, src.mgrParse) })
  const gap = fc.rawPosMismatch(RAW_0926, '9812.6')
  t.ok('表单 9812.6 vs 原文 9773.60 → 命中', gap && Math.abs(gap.rawPos - 9773.6) < 0.005 && Math.abs(gap.formPos - 9812.6) < 0.005, JSON.stringify(gap))
  t.ok('表单与原文一致 → 不打扰', fc.rawPosMismatch(RAW_0926, '9773.60') === null)
  t.ok('无原文 → 不打扰', fc.rawPosMismatch('', '100') === null)
  const submit = sliceBody(src.page, /\n\s+async submitRevenue\(\) \{/, /\n {2}(async )?[A-Za-z_]+\([^)]*\) \{/)
  const iCheck = submit.indexOf('rawPosMismatch(')
  const iWrite = submit.indexOf('storeLedger.upsert(')
  t.ok('submitRevenue 写入前核对原文 POS', iCheck !== -1 && iWrite !== -1 && iCheck < iWrite)
  const ask = sliceBody(src.page, /\n\s+async askRawPosMismatch\(gap\) \{/, /\n {2}\/\*\*/)
  t.ok('POS 不一致走自定义弹层（不新增 wx.showModal）', /#appModal/.test(ask) && /actions:/.test(ask) && !/wx\.showModal/.test(ask))

  // 5. 删除标记
  const D = '2026-09-20'
  const seedOld = {
    store_ledger: [{ _id: 'old1', storeId: MAIN, date: D, bizDate: D, revenue: 100, pos: 100, _updateTime: 1000 }],
    finance_records: [{ _id: 'fr1', storeId: 'store_1780146782017_6w0okpr', date: D, revenue: 100, _updateTime: 1000 }],
    daily_revenues: [],
    store_ledger_deletions: [{ _id: 't1', key: `${MAIN}|${D}`, storeId: MAIN, date: D, deletedAt: 2000 }],
  }
  const refresh = { action: 'refresh_store_ledger', storeId: MAIN, startDate: '2026-09-01', endDate: '2026-09-30', persist: false }
  let mem = makeDb(seedOld)
  let res = await loadSyncFn(src, mem).main(refresh)
  t.ok('删除前的旧行（含旧 id 镜像）被删除标记挡住', res && res.success && !(res.data || []).some((r) => r.date === D), JSON.stringify(res && res.data))
  mem = makeDb({ ...seedOld, store_ledger: [{ _id: 'new1', storeId: MAIN, date: D, bizDate: D, revenue: 200, pos: 200, _updateTime: 3000 }] })
  res = await loadSyncFn(src, mem).main(refresh)
  const row = (res.data || []).find((r) => r.date === D)
  t.ok('删除后重新录入的同日账照常显示', row && Math.abs(Number(row.revenue) - 200) < 0.005, JSON.stringify(res && res.data))

  // 6. 三处登记
  t.ok('COLLECTIONS 登记 store_ledger_deletions', /STORE_LEDGER_DELETIONS:\s*'store_ledger_deletions'/.test(src.cloudJs))
  let rules = null
  try { rules = JSON.parse(src.rules) } catch { /* 下方判红 */ }
  t.ok('rules 读写全拒（客户端 0 引用，比 R1 更紧）', rules && rules.read === false && rules.write === false, src.rules)
  t.ok('schema 字段与写入点一致（key / deletedAt / deletedBy）', ['`key`', '`deletedAt`', '`deletedBy`'].every((f) => src.schema.includes(f)))
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
      ['云函数别名少一个历史 id', inject('fnSalesShare', "  'store_1780841157244_p48w0bx'\n", '')],
      ['小程序 storeLedger 别名少一个历史 id', inject('extraLedger', "'store_1780160394767_szo1k77', ", '')],
      ['dailyDigest 主店别名写死旧值', inject('fnDigest', "name: '山川造物', aliases: MAIN_STORE_ALIAS_IDS", "name: '山川造物', aliases: ['store_1780146782017_6w0okpr']")],
      ['ERP 真源漏 id', inject('aggregate', "  'store_1780841157244_p48w0bx',\n", '')],
      ['源头回退：本地门店写本地 id', inject('storeStorage', '  if (key) return CANONICAL_STORE_IDS[key]\n', '')],
      ['findStoreById 不再按 canonical 找本地门店', inject('storeStorage', '    stores.find((s) => !s.storeId && CANONICAL_STORE_IDS[canonicalKeyOfLocalStore(s)] === sid) ||\n', '')],
      ['小程序解析器不再切表头（明细混入）', inject('mgrParse', 'function splitDailyReportHeader(text) {', 'function splitDailyReportHeader(text) {\n  return { header: String(text || \'\'), detail: \'\' }')],
      ['提交前核对失效', inject('formCheck', '  if (!text) return null\n', '  return null\n')],
      ['submitRevenue 不再核对原文 POS', inject('page', '    const posGap = rawPosMismatch(r.rawText, r.pos);', '    const posGap = null;')],
      ['删除标记回退为整日隐藏', inject('fnSync', '    if (deletedKeys.has(key) && ts < deletedKeys.get(key)) return', '    if (deletedKeys.has(key)) return')],
      ['删除标记完全失效', inject('fnSync', '    if (deletedKeys.has(key) && ts < deletedKeys.get(key)) return', '')],
      ['rules 放开读', { ...SOURCES, rules: '{ "read": "auth != null", "write": false }' }],
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
    console.error(`✗ test:finance-ledger-integrity：${t.failures.length} 项失败（通过 ${t.pass}）`)
    for (const f of t.failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log(`✓ test:finance-ledger-integrity：${t.pass} 项通过（历史 id 归属全仓一致 / 源头写 canonical id / 9-26 原文不计明细 / 提交前核对 / 删除标记只挡旧行 / 三处登记）`)
}
main().catch((e) => { console.error(e); process.exit(1) })
