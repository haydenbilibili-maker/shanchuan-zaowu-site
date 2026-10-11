#!/usr/bin/env node
/**
 * test:finance-duplicate —— 财务日账「重复」判定 + 录入弹窗 + 服务端兜底（2026-09-29 产品负责人：
 * 「清理历史重复数据，并且以后录入数据如果发现重复录入需要弹窗提示」）
 *
 * 覆盖：
 *   1. 判定（ERP ESM 真源 + 云函数 CJS 副本同一组用例）：旧主店 id / 空 storeId 归山川造物；
 *      完全重复 vs 金额不同；订单数 / 在手现金单边缺失不参与比对；两份实现逐用例结果一致
 *   2. 历史分组：完全重复删多余只留 1 条（主店 canonical id 优先）；金额不同一条不删
 *   3. ERP 合并：storeLedgerSync.mergeRecords 把「主店 + 旧主店 id」同日两条收成一条（不再双计），
 *      同时间戳时留主店行；financeSync 同步路径只删完全重复
 *   4. 入口必须先检测：ERP 粘贴日报 addRecord / 小程序录入日报 submitRevenue（带 checkDuplicate，
 *      三选一走自定义弹层，不新增 wx.showModal）；两份 storeLedger.js 一致
 *   5. 服务端兜底（真跑 syncFinanceData 真源 + 内存库）：checkDuplicate 命中同店同日（含旧 id / 空 id /
 *      daily_revenues）→ DUPLICATE_ENTRY 且零写入；confirmDuplicate 覆盖不新增文档；旧客户端不带参数行为不变；
 *      upload_records 带旧 id 也不会新建第二条日账
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
  check: resolve(ROOT, 'admin/src/utils/financeDuplicateCheck.js'),
  aggregate: resolve(ROOT, 'admin/src/utils/financeDayAggregate.js'),
  ledgerSync: resolve(ROOT, 'admin/src/utils/storeLedgerSync.js'),
  financeSync: resolve(ROOT, 'admin/src/utils/financeSync.js'),
  cleanup: resolve(ROOT, 'admin/src/utils/financeDuplicateCleanup.js'),
  finance: resolve(ROOT, 'admin/src/components/Finance.vue'),
  fnDir: resolve(ROOT, 'miniprogram/cloudfunctions/syncFinanceData'),
  fnIndex: resolve(ROOT, 'miniprogram/cloudfunctions/syncFinanceData/index.js'),
  fnDup: resolve(ROOT, 'miniprogram/cloudfunctions/syncFinanceData/ledgerDuplicate.js'),
  mgrLedger: resolve(ROOT, 'miniprogram/subpackages/manager/utils/storeLedger.js'),
  extraLedger: resolve(ROOT, 'miniprogram/subpackages/extra/utils/storeLedger.js'),
  page: resolve(ROOT, 'miniprogram/subpackages/manager/manager/managerPageConfig.js'),
  wsWxml: resolve(ROOT, 'miniprogram/subpackages/manager/manager/workspace/index.wxml'),
  wsJson: resolve(ROOT, 'miniprogram/subpackages/manager/manager/workspace/index.json'),
  modalJs: resolve(ROOT, 'miniprogram/components/AppModal/index.js'),
  modalWxml: resolve(ROOT, 'miniprogram/components/AppModal/index.wxml'),
}
const read = (p) => readFileSync(p, 'utf8')
const SOURCES = Object.fromEntries(Object.entries(P).filter(([k]) => k !== 'fnDir').map(([k, p]) => [k, read(p)]))

const MAIN = 'store_shanhaizaowu'
const ALIAS = 'store_1780146782017_6w0okpr'
const XC = 'store_xingchen'

function loadCjsFromSource(filename, source, stubs = {}) {
  const m = new Module(filename)
  m.filename = filename
  m.paths = Module._nodeModulePaths(dirname(filename))
  const origRequire = m.require.bind(m)
  m.require = (id) => (Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : origRequire(id))
  m._compile(source, filename)
  return m.exports
}

/** 从内存源码加载 ESM（相对 import 改成真文件绝对 URL），注入不写盘 */
async function importEsm(source, filePath, rewrites = {}) {
  let s = source
  for (const [spec, target] of Object.entries(rewrites)) {
    s = s.split(`'${spec}'`).join(`'${target}'`)
  }
  s = s.replace(/from '(\.\/[^']+)'/g, (_, rel) => `from '${pathToFileURL(resolve(dirname(filePath), rel)).href}'`)
  return import(`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`)
}

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

/** 取某个方法 / 函数体（到下一个同缩进的顶层成员为止），用于「检测先于写入」的顺序断言 */
function sliceBody(src, startRe, endRe) {
  const m = src.match(startRe)
  if (!m) return ''
  const rest = src.slice(m.index)
  const e = rest.slice(m[0].length).search(endRe)
  return e === -1 ? rest : rest.slice(0, m[0].length + e)
}

/* ------------------------------ 内存库（syncFinanceData 用到的查询子集） ------------------------------ */
function makeDb(seed) {
  const data = {}
  for (const [k, rows] of Object.entries(seed)) data[k] = rows.map((r) => ({ ...r }))
  let seq = 0
  const writes = []
  const cmd = (op, v) => ({
    __op: op, v,
    and(o) { return { __op: 'and', parts: [this, o] } },
  })
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
        writes.push({ op: 'add', name, _id })
        return { _id }
      },
      doc(id) {
        return {
          async get() { return { data: rows().filter((r) => r._id === id) } },
          async update({ data: d }) {
            const r = rows().find((x) => x._id === id)
            if (r) Object.assign(r, d)
            writes.push({ op: 'update', name, _id: id })
            return { stats: { updated: r ? 1 : 0 } }
          },
          async remove() {
            data[name] = rows().filter((x) => x._id !== id)
            writes.push({ op: 'remove', name, _id: id })
            return { stats: { removed: 1 } }
          },
        }
      },
    }
    return api
  }
  return { data, writes, db: { collection, command: _, serverDate: () => new Date() } }
}

async function runFn(indexSource, dupSource, seed, event) {
  const mem = makeDb(seed)
  const sdk = {
    init() {},
    DYNAMIC_CURRENT_ENV: 'x',
    database: () => mem.db,
    getWXContext: () => ({ OPENID: 'oa_admin' }),
  }
  const stubs = {
    'wx-server-sdk': sdk,
    './staffGuard': { assertStaff: async () => ({ ok: true }), ROLE_MANAGER: 'manager' },
    './ledgerDuplicate': loadCjsFromSource(P.fnDup, dupSource),
  }
  const fn = loadCjsFromSource(P.fnIndex, indexSource, stubs)
  const res = await fn.main(event)
  return { res, mem }
}

/* ------------------------------------------ 断言 ------------------------------------------ */
const pairMain = { _id: 'm1', date: '2025-11-21', storeId: MAIN, storeCode: '', revenue: 4883.6, netAmount: 4883.6, pos: 4376.6, cashIncome: 507, orderCount: 0, _updateTime: 5 }
const pairAlias = { _id: 'a1', date: '2025-11-21', storeId: ALIAS, storeCode: 'CCYS001', revenue: 4376.6, netAmount: 4376.6, orderCount: 68, raw: '山川造物\n银联POS收款:4376.6元', _updateTime: 5 }

async function runChecks(src) {
  const t = makeAsserter()
  const esm = await importEsm(src.check, P.check)
  const cjs = loadCjsFromSource(P.fnDup, src.fnDup)

  // 1. 判定
  t.ok('旧主店 id 与主店同键', esm.duplicateKey(pairAlias) === esm.duplicateKey(pairMain), `${esm.duplicateKey(pairAlias)} vs ${esm.duplicateKey(pairMain)}`)
  t.ok('空 storeId 归山川造物', esm.duplicateKey({ date: '2025-11-21' }) === esm.duplicateKey(pairMain))
  t.ok('星宸与山川不同键', esm.duplicateKey({ date: '2025-11-21', storeId: XC }) !== esm.duplicateKey(pairMain))
  const fixtures = [
    ['同金额（订单数单边缺失）', { revenue: 100, pos: 100, orderCount: 3 }, { revenue: 100, pos: 100 }, true],
    ['营收不同', pairMain, pairAlias, false],
    ['在手现金双边有值且不同', { revenue: 10, pos: 10, cashBalance: 5 }, { revenue: 10, pos: 10, cashBalance: 6 }, false],
    ['daily_revenues 字段形状（total/cash）', { total: 50, pos: 40, cash: 10 }, { revenue: 50, pos: 40, cashIncome: 10 }, true],
    ['退款字段 refundAmount/refund 等价', { revenue: 9, pos: 10, refundAmount: 1 }, { revenue: 9, pos: 10, refund: 1 }, true],
    ['只有退款不同', { revenue: 9, pos: 10, refund: 1 }, { revenue: 9, pos: 10, refund: 2 }, false],
    ['只有线上不同', { revenue: 9, pos: 9, online: 0 }, { revenue: 9, pos: 9, online: 3 }, false],
    ['只有现金收入不同', { revenue: 9, pos: 9, cashIncome: 1 }, { revenue: 9, pos: 9, cashIncome: 2 }, false],
  ]
  for (const [name, a, b, want] of fixtures) {
    const x = esm.compareLedgerEntries(a, b)
    const y = cjs.compareLedgerEntries(a, b)
    t.ok(`判定：${name}`, x.identical === want, JSON.stringify(x.diffs))
    t.ok(`ERP 与云函数副本一致：${name}`, JSON.stringify(x) === JSON.stringify(y), `${JSON.stringify(x.diffs)} vs ${JSON.stringify(y.diffs)}`)
  }
  const found = esm.findExistingDuplicate([pairMain, { date: '2025-11-22', storeId: MAIN, revenue: 1 }], { date: '2025-11-21', storeId: ALIAS, revenue: 4883.6, pos: 4376.6, cashIncome: 507 })
  t.ok('录入检测：旧 id 录入命中主店已有记录且判为完全重复', found && found.identical === true && found.record === pairMain, JSON.stringify(found && found.diffs))
  t.ok('录入检测：他日无命中', esm.findExistingDuplicate([pairMain], { date: '2025-11-23', storeId: MAIN, revenue: 1 }) === null)
  const acc = esm.accumulateLedgerEntry({ pos: 100, online: 10, orderCount: 2, cashBalance: 50, raw: 'a' }, { pos: 20, orderCount: 1, cashBalance: 80, raw: 'b' })
  t.ok('仍要新增 = 流水累加、在手现金取本次', acc.pos === 120 && acc.online === 10 && acc.revenue === 130 && acc.orderCount === 3 && acc.cashBalance === 80 && /a[\s\S]*b/.test(acc.raw), JSON.stringify(acc))

  // 2. 历史分组
  const twin = { ...pairMain, _id: 'm2', _updateTime: 9 }
  const g1 = esm.classifyDuplicateGroups([pairMain, twin])
  t.ok('完全重复：删多余只留 1 条', g1.length === 1 && g1[0].identical && g1[0].remove.length === 1, JSON.stringify(g1.map((g) => [g.identical, g.remove.length])))
  const g2 = esm.classifyDuplicateGroups([pairAlias, pairMain])
  t.ok('金额不同：一条不删、保留主店行', g2.length === 1 && !g2[0].identical && g2[0].remove.length === 0 && g2[0].keep.row._id === 'm1', JSON.stringify(g2.map((g) => [g.identical, g.remove.length, g.keep.row._id])))
  const g3 = esm.classifyDuplicateGroups([{ ...pairMain, _id: 'x', storeId: '' }, { ...pairMain, _id: 'y', storeId: MAIN }])
  t.ok('空 id 与主店同内容 = 完全重复，保留主店 canonical id', g3.length === 1 && g3[0].identical && g3[0].keep.row._id === 'y', JSON.stringify(g3.map((g) => g.keep.row._id)))

  // 3. ERP 合并与同步
  const ledgerSync = await importEsm(src.ledgerSync, P.ledgerSync, { './financeDuplicateCheck.js': `data:text/javascript;base64,${Buffer.from(src.check.replace(/from '(\.\/[^']+)'/g, (_, rel) => `from '${pathToFileURL(resolve(dirname(P.check), rel)).href}'`)).toString('base64')}` })
  for (const order of [[pairAlias, pairMain], [pairMain, pairAlias]]) {
    const merged = ledgerSync.mergeRecords([], order)
    t.ok(`ERP 合并：主店 + 旧 id 同日收成 1 条且留主店行（顺序 ${order[0]._id} 先）`, merged.length === 1 && merged[0].storeId === MAIN && merged[0].revenue === 4883.6, JSON.stringify(merged.map((r) => [r.storeId, r.revenue])))
  }
  const localWithAlias = ledgerSync.mergeRecords([pairAlias], [pairMain])
  t.ok('本机缓存残留旧 id 行不会与云端主店行并存（删了不会被推回）', localWithAlias.length === 1, JSON.stringify(localWithAlias.map((r) => r.storeId)))
  const keyBody = sliceBody(src.ledgerSync, /export function ledgerKey\(/, /\n}\n/)
  t.ok('ledgerKey 按归属门店（不再用 storeCode 优先）', /canonicalLedgerStoreId\(/.test(keyBody) && !/storeCode/.test(keyBody))
  const saveBody = sliceBody(src.financeSync, /export async function saveFinanceRecordsToCloud\(/, /\nexport /)
  t.ok('同步路径只删完全重复', /classifyDuplicateGroups\(/.test(saveBody) && /\.remove\b/.test(saveBody) && !/slice\(1\)/.test(saveBody))
  const cleanupBody = sliceBody(src.cleanup, /export async function cleanupDuplicateFinanceRecords\(/, /\n}\n/)
  t.ok('「清理重复日账」只删 group.remove（完全重复）', /group\.remove/.test(cleanupBody) && !/group\.others/.test(cleanupBody))
  t.ok('「清理重复日账」预览读云端原始行', /previewDuplicateCleanup\(await fetchCloudFinanceRows\(\)\)/.test(src.finance))

  // 4. 入口
  const addBody = sliceBody(src.finance, /\n {4}async addRecord\(\) \{/, /\n {4}\/\/ |\n {4}async [a-zA-Z]+\(|\n {4}[a-zA-Z]+\([^)]*\) \{/)
  const iDetect = addBody.indexOf('findExistingDuplicate(this.data, this.tempRecord)')
  const iAsk = addBody.indexOf('askDuplicateEntry(')
  const iWrite = addBody.indexOf('this.data.push(this.tempRecord)')
  t.ok('ERP 粘贴日报：写入前先检测并弹窗', iDetect !== -1 && iAsk > iDetect && iWrite > iAsk, `detect@${iDetect} ask@${iAsk} write@${iWrite}`)
  t.ok('ERP 取消即不写', /choice === 'cancel'\)[\s\S]{0,160}return/.test(addBody))
  t.ok('ERP 弹窗三选一', ["settleDuplicateEntry('cancel')", "settleDuplicateEntry('append')", "settleDuplicateEntry('overwrite')"].every((s) => src.finance.includes(s)))

  const upsertBody = sliceBody(src.mgrLedger, /\nasync function upsert\(/, /\n}\n/)
  t.ok('小程序 upsert 透传 checkDuplicate / confirmDuplicate', /checkDuplicate: o\.checkDuplicate === true/.test(upsertBody) && /confirmDuplicate: o\.confirmDuplicate === true/.test(upsertBody))
  t.ok('小程序 upsert 把对比带回调用方', /err\.duplicate = result\.duplicate/.test(upsertBody))
  t.ok('两份 storeLedger.js 一致', src.mgrLedger === src.extraLedger)
  const submitBody = sliceBody(src.page, /\n {2}async submitRevenue\(\) \{/, /\n {2}(async )?[a-zA-Z]+\([^)]*\) \{|\n {2}\/\*\*/)
  t.ok('小程序录入日报：首次写入带 checkDuplicate', /storeLedger\.upsert\(sid, form, \{ checkDuplicate: true \}\)/.test(submitBody))
  t.ok('小程序录入日报：命中后三选一再写', /DUPLICATE_ENTRY/.test(submitBody) && /askLedgerDuplicate\(/.test(submitBody) && /confirmDuplicate: true/.test(submitBody) && /choice === 'cancel'[\s\S]{0,200}return/.test(submitBody))
  const askBody = sliceBody(src.page, /\n {2}async askLedgerDuplicate\(dup\) \{/, /\n {2}\},\n/)
  t.ok('小程序弹窗走自定义弹层、不新增原生弹窗', /selectComponent\('#appModal'\)/.test(askBody) && !/wx\.showModal/.test(askBody) && ['overwrite', 'append', 'cancel'].every((k) => askBody.includes(`key: '${k}'`)))
  t.ok('工作台页挂载 app-modal', /<app-modal id="appModal"/.test(src.wsWxml) && /"app-modal": "\/components\/AppModal\/index"/.test(src.wsJson))
  t.ok('AppModal 支持多选项 actions', /onAction\(e\)/.test(src.modalJs) && /action: key/.test(src.modalJs) && /bindtap="onAction"/.test(src.modalWxml))

  // 5. 服务端兜底（真跑）
  const dupSrc = src.fnDup
  const baseSeed = () => ({ store_ledger: [{ ...pairAlias, bizDate: pairAlias.date }], finance_records: [], daily_revenues: [], store_ledger_deletions: [] })
  const rec = { date: '2025-11-21', pos: 4376.6, cashIncome: 507, orderCount: 68 }
  let r = await runFn(src.fnIndex, dupSrc, baseSeed(), { action: 'upsert_store_ledger_day', storeId: MAIN, record: rec, checkDuplicate: true })
  t.ok('服务端：旧 id 已有同日 → DUPLICATE_ENTRY 且零写入', r.res.code === 'DUPLICATE_ENTRY' && r.mem.writes.length === 0 && r.res.duplicate && Array.isArray(r.res.duplicate.diffs), JSON.stringify(r.res).slice(0, 200))
  r = await runFn(src.fnIndex, dupSrc, { store_ledger: [], finance_records: [], daily_revenues: [{ _id: 'd1', date: '2025-11-21', total: 4883.6, pos: 4376.6, cash: 507 }], store_ledger_deletions: [] }, { action: 'upsert_store_ledger_day', storeId: MAIN, record: rec, checkDuplicate: true })
  t.ok('服务端：daily_revenues 空 id 行同样命中且判完全重复', r.res.code === 'DUPLICATE_ENTRY' && r.res.duplicate.identical === true && r.mem.writes.length === 0, JSON.stringify(r.res.duplicate && r.res.duplicate.diffs))
  r = await runFn(src.fnIndex, dupSrc, { store_ledger: [{ _id: 'x1', date: '2025-11-21', bizDate: '2025-11-21', storeId: XC, revenue: 99, pos: 99 }], finance_records: [], daily_revenues: [], store_ledger_deletions: [] }, { action: 'upsert_store_ledger_day', storeId: MAIN, record: rec, checkDuplicate: true })
  t.ok('服务端：星宸同日记录不算山川重复', r.res.success === true, JSON.stringify(r.res).slice(0, 160))
  r = await runFn(src.fnIndex, dupSrc, baseSeed(), { action: 'upsert_store_ledger_day', storeId: MAIN, record: rec, checkDuplicate: true, confirmDuplicate: true })
  const ledgerCount = r.mem.data.store_ledger.length
  t.ok('服务端：confirmDuplicate 覆盖、不新增日账文档', r.res.success === true && ledgerCount === 1, `success=${r.res.success} store_ledger=${ledgerCount}`)
  r = await runFn(src.fnIndex, dupSrc, baseSeed(), { action: 'upsert_store_ledger_day', storeId: MAIN, record: rec })
  t.ok('服务端：旧客户端不带 checkDuplicate 行为不变（照常写入）', r.res.success === true && r.res.code !== 'DUPLICATE_ENTRY' && r.mem.writes.length > 0)
  r = await runFn(src.fnIndex, dupSrc, { store_ledger: [{ ...pairMain, bizDate: pairMain.date }], finance_records: [{ ...pairMain, _id: 'fm1' }], daily_revenues: [], store_ledger_deletions: [] }, { action: 'upload_records', records: [{ ...pairAlias, _id: undefined, _updateTime: 1 }] })
  t.ok('服务端：upload_records 带旧 id 不会新建第二条日账 / 镜像', r.res.success === true && r.mem.data.store_ledger.length === 1 && r.mem.data.finance_records.length === 1, `ledger=${r.mem.data.store_ledger.length} fr=${r.mem.data.finance_records.length}`)

  return t
}

function report(t, label) {
  if (t.failures.length) {
    console.error(`✗ ${label}：${t.failures.length} 项失败（通过 ${t.pass}）`)
    t.failures.forEach((f) => console.error(`  - ${f}`))
    return false
  }
  console.log(`✓ ${label}：${t.pass} 项通过`)
  return true
}

if (process.argv.includes('--selftest')) {
  const injections = [
    ['判定不再把旧主店 id 归山川', { check: (s) => s.replace('return resolveFinanceStore(record).storeId', "return String(record?.storeId || '').trim() || 'store_shanhaizaowu'") }],
    ['可选字段单边缺失也判不同', { check: (s) => s.replace('if (f.optional && (x == null || y == null)) continue', '') }],
    ['云函数副本判据漂移（不比退款）', { fnDup: (s) => s.replace("  { key: 'refund', label: '退款' },\n", '') }],
    ['金额不同也删', { check: (s) => s.replace('remove: identical ? sorted.slice(1) : []', 'remove: sorted.slice(1)') }],
    ['去留不再优先主店 canonical id', { check: (s) => s.replace("sid && sid === canonicalLedgerStoreId(r) ? 1 : 0,", '0,') }],
    ['ledgerKey 回退为 storeCode 优先', { ledgerSync: (s) => s.replace('return `${canonicalLedgerStoreId(record)}|${date}`', "const store = String(record?.storeCode || '').trim() || String(record?.storeId || '').trim() || 'default'\n  return `${store}|${date}`") }],
    ['同时间戳不再按主店定去留', { ledgerSync: (s) => s.replace('(ts === existing.updateTime && compareForKeep(rec, existing) > 0)', 'false') }],
    ['同步路径删全部同键副本', { financeSync: (s) => s.replace('for (const { row: stale } of group.remove) {', 'for (const { row: stale } of group.others) {') }],
    ['清理按钮删金额不同的', { cleanup: (s) => s.replace('for (const rec of group.remove) {', 'for (const rec of group.others) {') }],
    ['ERP 录入不再检测', { finance: (s) => s.replace('const dup = findExistingDuplicate(this.data, this.tempRecord)', 'const dup = null') }],
    ['ERP 取消后仍写入', { finance: (s) => s.replace("ElMessage.info(dup.identical ? '已取消：该日报已录入过' : '已取消，未改动已有记录')\n                    return", "ElMessage.info('x')") }],
    ['小程序录入不带 checkDuplicate', { page: (s) => s.replace('storeLedger.upsert(sid, form, { checkDuplicate: true })', 'storeLedger.upsert(sid, form)') }],
    ['小程序弹窗改回原生 showModal', { page: (s) => s.replace("async askLedgerDuplicate(dup) {\n    const host = this.selectComponent && this.selectComponent('#appModal');", "async askLedgerDuplicate(dup) {\n    wx.showModal({ title: 'x' }); const host = null;") }],
    ['storeLedger 副本漂移', { extraLedger: (s) => s.replace('checkDuplicate: o.checkDuplicate === true,', '') }],
    ['服务端不再拦截', { fnIndex: (s) => s.replace("if (options.checkDuplicate === true && options.confirmDuplicate !== true) {", 'if (false) {') }],
    ['服务端入口不透传 checkDuplicate', { fnIndex: (s) => s.replace('checkDuplicate: event.checkDuplicate === true,', 'checkDuplicate: false,') }],
    ['服务端 ledgerKey 不再归并旧 id', { fnIndex: (s) => s.replace(/(const MAIN_STORE_ALIAS_IDS = \[[^\]]*?)\n {2}'store_1780146782017_6w0okpr',?/, '$1') }],
  ]
  let allCaught = true
  for (const [name, mut] of injections) {
    const src = { ...SOURCES }
    for (const [k, fn] of Object.entries(mut)) {
      if (!fn) continue
      const next = fn(src[k])
      if (next === src[k]) { console.error(`✗ 注入「${name}」未生效（锚点失配：${k}）`); allCaught = false }
      src[k] = next
    }
    let t
    try { t = await runChecks(src) } catch (e) { t = { failures: [`抛错：${e.message}`], pass: 0 } }
    if (t.failures.length) console.log(`  ✓ 检出「${name}」（${t.failures.length} 项）`)
    else { console.error(`  ✗ 未检出「${name}」`); allCaught = false }
  }
  const clean = await runChecks(SOURCES)
  if (!report(clean, '基线')) allCaught = false
  console.log(allCaught ? `✓ selftest：${injections.length} 个注入全部检出` : '✗ selftest 失败')
  process.exit(allCaught ? 0 : 1)
} else {
  const ok = report(await runChecks(SOURCES), 'test:finance-duplicate')
  process.exit(ok ? 0 : 1)
}
