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
 *
 * 用法：
 *   node miniprogram/scripts/check-dedupe-index-coverage.mjs
 *   node miniprogram/scripts/check-dedupe-index-coverage.mjs --selftest
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
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
 * 实测写入点（2026-09-17 逐行核对：`^\s*dedupeKey\s*[,:]` 且排除 `X.dedupeKey` 读取）。
 * 这张表是「人工核对过的事实」，用于校验 provision 脚本没有漏登记。
 */
export const OBSERVED_WRITERS = {
  point_records: ['bindPlatformOrder', 'claimBirthdayGift', 'claimStoreReceipt', 'exchangeCoupon', 'grantStorePoints', 'redeemReward', 'refundOrder', 'upsertUserProfile'],
  store_purchases: ['grantStorePoints'],
  platform_order_binds: ['bindPlatformOrder'],
  user_messages: ['toggleCollection'],
  store_coupon_redeems: ['verifyStoreCoupon'],
}

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
      problems.push(`provision 脚本缺少集合 ${collection} 的索引登记（代码里在写它的 dedupeKey）`)
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
  return problems
}

function scanRepo() {
  const specs = loadSpecs()
  if (!specs.length) return { problems: ['无法从 ensure-dedupe-indexes.cjs 读到 SPECS'], specs, writers: [] }
  const files = []
  for (const e of readdirSync(CF, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const f = join(CF, e.name, 'index.js')
    if (!existsSync(f)) continue
    const source = readFileSync(f, 'utf8')
    if (!source.includes('dedupeKey')) continue
    files.push({ name: e.name, source })
  }
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
    console.error('\n修法：在 miniprogram/scripts/ensure-dedupe-indexes.cjs 的 SPECS 里补登记，并跑该脚本建索引。')
    process.exit(1)
  }
  console.log(`✓ 幂等键索引覆盖齐全（${specs.length} 个集合：${specs.map((s) => s.collection).join(', ')}；代码侧写入方 ${writers.length} 个函数）`)
  console.log('  注意：本守卫只保证「登记齐全」，索引是否真的建好要用 ensure-dedupe-indexes.cjs --execute 或控制台核对。')
}
