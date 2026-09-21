#!/usr/bin/env node
/**
 * 幂等键（dedupeKey）索引覆盖守卫
 *
 * 背景（2026-09-17 全面审计 C2，P0）：
 *   全仓防重都建立在「`xxx.dedupeKey` 上有唯一索引」之上，但此前**没有任何脚本/校验**管这件事：
 *   `ensure-{gift,leave,orders-pay-expire}-indexes` 都不覆盖 dedupeKey，文档也自认
 *   「不建等于没有防重」（miniprogram/docs/门店积分上线操作清单.md:77-85）。
 *   索引缺失时，所有「先查再写」退化为 read-then-write 竞态 → 重复发积分/券/入账，**资损级**。
 *
 * 本守卫把「代码里写了 dedupeKey」与「provision 脚本里登记了对应集合的索引」绑在一起：
 *   C1 每个 spec 的集合必须有安全规则文件（cloudbase/rules/<name>.json）
 *   C2 guard 内的「实测写入点」表必须完整出现在对应 spec 的 usedBy 里（脚本与代码不脱节）
 *   C3 任何云函数里出现 `dedupeKey` **写入**却完全没被登记 → 失败（新增用法必须登记）
 *   C4 usedBy 里的函数目录必须真实存在
 *   C5 **反向**：机械扫到的每个写入方都必须出现在 OBSERVED_WRITERS 里（人工表不许有洞）
 *
 * 扫描范围（2026-09-18 修）：**递归**扫每个云函数目录下的全部 `*.js`。
 * 旧实现写死 `index.js`，漏掉兄弟文件（rechargeRewards.js / artisanCommission.js ×4 /
 * inAppMessage.js ×24）→ 输出「✓ 覆盖齐全」而实际漏登记 30+ 处（错题本 E7：守卫判据自身错误）。
 *
 * ⚠️ 本案仍不能发现的：已登记函数**新写入另一个集合**时的集合级漂移 ——
 *    判据是「函数级」的（`dedupeKey` 写入行 → 函数名），不做写入点→集合的归属推断
 *    （试过按 `data:`/`const doc =` 反推，`posted.push({dedupeKey})` 这类回显会误判，宁可不做假精度）。
 *    改动钱路径的写入集合时，请连同 OBSERVED_WRITERS 一起改。
 *
 * 用法：
 *   node miniprogram/scripts/check-dedupe-index-coverage.mjs
 *   node miniprogram/scripts/check-dedupe-index-coverage.mjs --selftest
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const ROOT = resolve(MP, '..')
const CF = join(MP, 'cloudfunctions')
const require = createRequire(import.meta.url)

/** provision 脚本是唯一事实源（它会被真正执行来建索引） */
export function loadSpecs() {
  const mod = require(join(HERE, 'ensure-dedupe-indexes.cjs'))
  return mod && Array.isArray(mod.SPECS) ? mod.SPECS : []
}

/**
 * 实测写入点（2026-09-18 **递归**核对云函数目录下全部 `*.js`，不再只看 `index.js`；
 * 判据 `^\s*dedupeKey\s*[,:]` 且排除 `X.dedupeKey` 读取。逐处 file:line 见 ensure-dedupe-indexes.cjs 顶部注释）。
 *
 * ⚠️ 这张表是「人工核对过的事实」，**必须**覆盖 `scanFunctionFiles()` 扫出的每一个函数 ——
 *    守卫里有一条判据专门校验这件事（否则它又会退化成 2026-09-17 那种「✓ 覆盖齐全」的空头承诺）。
 *
 * 2026-09-18 第二轮：原先列在这里、**未 provision** 的两个集合已补进 SPECS（集成官裁决「补 spec 让它真绿」）：
 *   · `artisan_commission_ledger` —— 师傅分账流水，4 个函数各一份**逐字节相同**的副本
 *     （artisanCommission.js ×3 + manageArtisanCommission/commissionCore.js；写入点 :670 / :789）
 *   · `notification_logs` —— 仅 `dispatchMessage/core.js:120` 那份副本带 dedupeKey
 * 现在这两条是**正常登记**，不再是待办；`UNPROVISIONED_NOTE` 因此为空（见该常量处的说明）。
 */
export const OBSERVED_WRITERS = {
  point_records: ['bindPlatformOrder', 'claimBirthdayGift', 'claimStoreReceipt', 'exchangeCoupon', 'grantStorePoints', 'manageStoredValue', 'payCallback', 'redeemReward', 'refundOrder', 'upsertUserProfile'],
  store_purchases: ['grantStorePoints'],
  platform_order_binds: ['bindPlatformOrder'],
  user_messages: [
    'authPhone', 'bindPlatformOrder', 'cancelOrder', 'claimBirthdayGift', 'claimStoreReceipt',
    'confirmOrderReceipt', 'confirmPayment', 'createBooking', 'dispatchMessage', 'exchangeCoupon',
    'grantStorePoints', 'makeOrder', 'manageApprovals', 'manageGift', 'manageHonoraryCurators',
    'manageInvoiceRequests', 'managerShipOrder', 'payCallback', 'refundOrder', 'submitCustomInquiry',
    'submitInvoiceRequest', 'submitSupportTicket', 'sweepExpiredOrders', 'toggleCollection',
    // 每日日报（2026-09-21）：幂等键 daily_digest:<role>:<YYYY-MM-DD>:<openid>，
    // 同一天同一人同角色重复触发只写一条（dailyDigest/dailyDigestStore.js writeDigestMessage）
    'dailyDigest',
  ],
  store_coupon_redeems: ['verifyStoreCoupon'],
  artisan_commission_ledger: ['confirmPayment', 'manageArtisanCommission', 'payCallback', 'refundOrder'],
  notification_logs: ['dispatchMessage'],
}

/**
 * 「已知未 provision」白名单 —— **当前为空，这是有意的**。
 *
 * 曾经有两条（artisan_commission_ledger / notification_logs），2026-09-18 已按集成官裁决补进 SPECS，
 * 所以真信号清零、判据必须真绿。**不要再往里塞东西来换绿**：往这里加一条等于把真信号降级成
 * 「公示的例外」，只有在产品负责人明确拍板「这个集合不建唯一索引」并写清理由时才允许。
 * 自检里有一条断言钉住「当前为空」，防止悄悄加项。
 */
export const UNPROVISIONED_NOTE = {}

/** 是否是 dedupeKey 的**写入**行（排除 `dedupeKey: found.dedupeKey` 这类读取） */
export function isWriteLine(line) {
  if (!/^\s*dedupeKey\s*[,:]/.test(line)) return false
  if (/^\s*dedupeKey\s*:\s*[A-Za-z_$][\w$]*\./.test(line)) return false // dedupeKey: doc.dedupeKey
  return true
}

/** 纯函数：扫一组 {name, source} 找出写入 dedupeKey 的函数名 */
export function findWriterFunctions(files) {
  const writers = new Set()
  for (const { name, source } of files) {
    if (String(source).split('\n').some(isWriteLine)) writers.add(name)
  }
  return [...writers].sort()
}

/** 纯函数：校验 specs 与观测表 / 规则文件 */
export function checkCoverage(specs, observed, writerFns, rulesExists, fnExists) {
  const problems = []
  const byCollection = new Map(specs.map((s) => [s.collection, s]))

  for (const [collection, fns] of Object.entries(observed)) {
    const spec = byCollection.get(collection)
    if (!spec) {
      const note = UNPROVISIONED_NOTE[collection]
      problems.push(note
        ? `⏳ 待 provision：${collection}.dedupeKey 有写入（${fns.join(', ')}）但 SPECS 无登记 —— ${note}`
        : `provision 脚本缺少集合 ${collection} 的索引登记（代码里在写它的 dedupeKey）：${fns.join(', ')}`)
      continue
    }
    for (const fn of fns) {
      if (!(spec.usedBy || []).includes(fn)) {
        problems.push(`${collection} 的登记里缺少写入方 ${fn}（usedBy 与实测写入点不一致）`)
      }
    }
  }

  for (const spec of specs) {
    if (!rulesExists(spec.collection)) {
      problems.push(`${spec.collection} 没有安全规则文件 cloudbase/rules/${spec.collection}.json`)
    }
    if (!spec.indexName || !spec.field) {
      problems.push(`${spec.collection} 的索引登记缺少 field/indexName`)
    }
    for (const fn of spec.usedBy || []) {
      if (!fnExists(fn)) problems.push(`${spec.collection} 的 usedBy 列了不存在的云函数：${fn}`)
    }
  }

  const registered = new Set(specs.flatMap((s) => s.usedBy || []))
  for (const fn of writerFns) {
    if (!registered.has(fn)) {
      problems.push(`云函数 ${fn} 写了 dedupeKey，但没有任何 spec 登记它 —— 请确认它写哪个集合并补进 SPECS.usedBy`)
    }
  }

  // 反向校验：机械扫出来的每个写入方都必须出现在人工核对表里。
  // 没有这一条，「判据只扫 index.js」那类漏扫会再次变成「✓ 覆盖齐全」的空头承诺（错题本 E7）。
  const observedFns = new Set(Object.values(observed).flat())
  for (const fn of writerFns) {
    if (!observedFns.has(fn)) {
      problems.push(`云函数 ${fn} 实测写了 dedupeKey，但不在 OBSERVED_WRITERS 里 —— 人工核对表有洞，请核对它写进哪个集合`)
    }
  }
  return problems
}

/**
 * 递归收集云函数目录下的全部 `*.js`（只保留含 `dedupeKey` 的文件）。
 *
 * 为什么必须递归（2026-09-18 修判据，裁决记录 §0 ① / §5 第 2 项）：
 *   旧实现写死 `join(CF, e.name, 'index.js')` —— 同目录兄弟文件里的 `dedupeKey` 写入**全被漏掉**：
 *   `manageStoredValue/rechargeRewards.js`、4 份 `artisanCommission.js`、24 份 `inAppMessage.js` /
 *   `messageWrite.js` / `dispatchMessage/core.js`。于是守卫输出「✓ 覆盖齐全」而实际漏登记 30+ 处。
 *
 * @param {string} baseDir 云函数根目录
 * @param {{readdirSync?: Function, readFileSync?: Function}} deps 便于自检注入
 * @returns {{name: string, file: string, source: string}[]} name = 云函数目录名（写入方函数名）
 */
export function scanFunctionFiles(baseDir = CF, deps = {}) {
  const readdir = deps.readdirSync || readdirSync
  const readFile = deps.readFileSync || readFileSync
  const out = []
  const walk = (dir, fnName) => {
    for (const e of readdir(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue // 依赖里的 dedupeKey 与我们的索引无关
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p, fnName); continue }
      if (!e.name.endsWith('.js')) continue
      const source = readFile(p, 'utf8')
      if (!String(source).includes('dedupeKey')) continue
      out.push({ name: fnName, file: p, source })
    }
  }
  for (const e of readdir(baseDir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(baseDir, e.name), e.name)
  }
  return out
}

function scanRepo() {
  const specs = loadSpecs()
  if (!specs.length) return { problems: ['无法从 ensure-dedupe-indexes.cjs 读到 SPECS'], specs, writers: [] }
  const files = scanFunctionFiles(CF)
  const writers = findWriterFunctions(files)
  const rulesExists = (c) => existsSync(join(ROOT, 'cloudbase', 'rules', `${c}.json`))
  const fnExists = (n) => existsSync(join(CF, n, 'index.js'))
  return { problems: checkCoverage(specs, OBSERVED_WRITERS, writers, rulesExists, fnExists), specs, writers }
}

function selftest() {
  let bad = 0
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`) }
  const rulesOk = () => true
  const fnOk = () => true

  t('★ 写入行能识别', isWriteLine('          dedupeKey,') && isWriteLine('        dedupeKey: `x:${id}`,'))
  t('  读取行不算写入（dedupeKey: doc.dedupeKey）', !isWriteLine('        dedupeKey: found.dedupeKey'))
  t('  查询条件不算写入（where({ dedupeKey })）', !isWriteLine('  const dup = await db.collection(X).where({ dedupeKey }).limit(1).get()'))
  t('  const dedupeKey = ... 不算写入', !isWriteLine('    const dedupeKey = `${a}:${b}`'))

  const goodSpecs = [{ collection: 'c1', field: 'dedupeKey', indexName: 'dedupeKey_1', usedBy: ['f1'] }]
  t('  完全一致 → 无问题', checkCoverage(goodSpecs, { c1: ['f1'] }, ['f1'], rulesOk, fnOk).length === 0)

  t('★ 未登记的写入方 → 检出',
    checkCoverage(goodSpecs, { c1: ['f1'] }, ['f1', 'fNew'], rulesOk, fnOk).some((p) => /fNew 写了 dedupeKey/.test(p)))
  t('★ 实测写入点不在 usedBy 里 → 检出',
    checkCoverage([{ collection: 'c1', field: 'd', indexName: 'i', usedBy: [] }], { c1: ['f1'] }, ['f1'], rulesOk, fnOk)
      .some((p) => /缺少写入方 f1/.test(p)))
  t('★ 缺安全规则文件 → 检出',
    checkCoverage(goodSpecs, { c1: ['f1'] }, ['f1'], () => false, fnOk).some((p) => /没有安全规则文件/.test(p)))
  t('★ usedBy 列了不存在的函数 → 检出',
    checkCoverage(goodSpecs, { c1: ['f1'] }, ['f1'], rulesOk, () => false).some((p) => /不存在的云函数/.test(p)))
  t('★ 脚本漏登记集合 → 检出',
    checkCoverage([], { c9: ['f1'] }, ['f1'], rulesOk, fnOk).some((p) => /缺少集合 c9/.test(p)))

  const files = [{ name: 'a', source: 'x\n  dedupeKey,\n' }, { name: 'b', source: 'dedupeKey: doc.dedupeKey' }]
  t('  只有 a 被判为写入方', findWriterFunctions(files).join() === 'a')

  /* ★ 判据自身：递归扫描（旧实现写死 index.js，同目录兄弟文件全漏） */
  const tmp = mkdtempSync(join(tmpdir(), 'dedupe-scan-'))
  try {
    mkdirSync(join(tmp, 'fnA'))
    mkdirSync(join(tmp, 'fnA', 'node_modules'))
    mkdirSync(join(tmp, 'fnB'))
    writeFileSync(join(tmp, 'fnA', 'index.js'), 'const x = 1\n')
    writeFileSync(join(tmp, 'fnA', 'rechargeRewards.js'), 'db.collection(P).add({\n  data: {\n    dedupeKey,\n  }\n})\n')
    writeFileSync(join(tmp, 'fnA', 'node_modules', 'dep.js'), 'dedupeKey,\n')
    mkdirSync(join(tmp, 'fnB', 'deep'))
    writeFileSync(join(tmp, 'fnB', 'deep', 'nested.js'), 'const doc = {\n  dedupeKey,\n}\n')
    writeFileSync(join(tmp, 'fnB', 'notes.md'), 'dedupeKey,\n')
    const scanned = scanFunctionFiles(tmp)
    const names = findWriterFunctions(scanned)
    t('★ 同目录兄弟文件里的 dedupeKey 写入被扫到（旧判据在此漏扫）', names.includes('fnA'))
    t('  嵌套子目录也扫（deep/nested.js）', names.includes('fnB'))
    t('  node_modules 被跳过', !scanned.some((f) => f.file.includes('node_modules')))
    t('  非 .js 文件不参与', !scanned.some((f) => f.file.endsWith('.md')))
    t('  不含 dedupeKey 的 index.js 不进列表', !scanned.some((f) => f.file.endsWith(join('fnA', 'index.js'))))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  /* ★ 人工核对表的完整性（防止「只扫 index.js」那类漏扫再次静默变绿） */
  t('★ 实测写入方不在人工核对表里 → 检出',
    checkCoverage(goodSpecs, { c1: ['f1'] }, ['f1', 'fGhost'], rulesOk, fnOk)
      .some((p) => /不在 OBSERVED_WRITERS 里/.test(p)))
  t('★ 未 provision 集合 → 检出（不是「通过」）',
    checkCoverage([], { ledger_x: ['f1'] }, ['f1'], rulesOk, fnOk)
      .some((p) => /缺少集合 ledger_x 的索引登记/.test(p)))
  t('★ 「已知未 provision」白名单必须为空（补 spec 换成真绿，不许把真信号降级成公示例外）',
    Object.keys(UNPROVISIONED_NOTE).length === 0)
  t('★ 已补齐的两个集合确实进了 SPECS（否则上一轮的真信号会以假绿回归）',
    ['artisan_commission_ledger', 'notification_logs'].every((c) => loadSpecs().some((s) => s.collection === c)))

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：写入/读取区分正确，漏登记/缺规则/幽灵函数都会被抓')
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const { problems, specs, writers } = scanRepo()
  if (problems.length) {
    console.error(`✗ 幂等键索引覆盖不足 ${problems.length} 处：`)
    problems.forEach((p) => console.error(`  - ${p}`))
    const todo = problems.filter((p) => p.startsWith('⏳ 待 provision'))
    if (todo.length) {
      console.error(`\n其中 ${todo.length} 个集合是**未 provision**（不是「通过」，是待办）：`)
      console.error('  · 建不建唯一索引需产品负责人拍板；决定要建就补进 ensure-dedupe-indexes.cjs 的 SPECS，')
      console.error('    决定不建就在本守卫里写明理由（不许直接把判据删掉换取变绿）。')
    }
    console.error('\n修法：在 miniprogram/scripts/ensure-dedupe-indexes.cjs 的 SPECS 里补登记（含 usedBy），')
    console.error('      并同步本文件的 OBSERVED_WRITERS；建索引的动作由持凭据者执行。')
    console.error('      只读预检（不建索引）：node miniprogram/scripts/check-dedupe-index-live.mjs')
    process.exit(1)
  }
  console.log(`✓ 幂等键索引覆盖齐全（${specs.length} 个集合：${specs.map((s) => s.collection).join(', ')}；代码侧写入方 ${writers.length} 个函数）`)
  console.log('  注意：本守卫只保证「登记齐全」，索引是否真的建好要用 ensure-dedupe-indexes.cjs --execute 或控制台核对。')
}
