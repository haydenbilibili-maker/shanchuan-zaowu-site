#!/usr/bin/env node
/**
 * 集合**结构文档**守卫 —— 云函数引用到的每个集合都必须有 `cloudbase/schema/<name>.md`
 *
 * 为什么需要（这是一个**登记了几轮都没人守**的历史空洞）：
 *   新增集合在 AGENTS.md 里要求「三处同步」（`admin/src/cloud.js` ↔ `cloudbase/rules/` ↔
 *   `cloudbase/schema/`），`check:fn-collection-rules` 只守住了 **rules** 那一处；
 *   `cloudbase/schema/` **一直没有任何守卫**。
 *   后果已经发生：`cloudbase/schema/ops_shipments.md` 只列 5 个字段，
 *   而实际单据有 20+ 字段 —— 文档与代码长期不一致，且没人会发现。
 *
 * 本守卫**复用** `check-fn-collection-rules` 的 `resolveCollections()`，
 * 不重写「常量名形态」的解析逻辑 —— 那是最容易写错、也最容易两份实现漂移的部分。
 *
 * ⚠️ **冻结基线**：建守卫时盘点是 **39 / 95** 个集合缺文档（历史欠账）。
 *    不逐个补文档，但也不因此不设守卫 —— 用 `collection-docs-baseline.json` 冻结现状：
 *      · **不在基线里的缺失 → 直接报错**（新集合没文档过不去）
 *      · **基线里「已不再缺失」的条目 → 也报错**（强制收敛，例外只许变小）
 *    想收敛一条：补齐文档后 `npm run check:collection-docs --update`。
 *
 * 证不了什么（写清楚）：
 *   · 不校验 schema 文档的**内容**是否与代码字段一致（那需要字段级 diff，属另一条活，
 *     本次只在文档缺**整份文件**时报警）。
 *   · 不覆盖「只被 ERP 直写、云函数从不引用」的集合（与 check:fn-collection-rules 同边界）。
 *
 * 用法：
 *   node miniprogram/scripts/check-collection-docs.mjs
 *   node miniprogram/scripts/check-collection-docs.mjs --selftest
 * 退出码：缺文档 1。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveCollections } from './check-fn-collection-rules.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const CF = join(ROOT, 'miniprogram', 'cloudfunctions')
const SCHEMA = join(ROOT, 'cloudbase', 'schema')

/** 收集全部云函数源码（与 check-fn-collection-rules 同边界，便于复用解析器） */
function scanCloudFunctions() {
  const files = []
  for (const e of readdirSync(CF, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const walk = (p) => {
      for (const x of readdirSync(p, { withFileTypes: true })) {
        if (x.name === 'node_modules' || x.name.startsWith('.')) continue
        const q = join(p, x.name)
        if (x.isDirectory()) walk(q)
        else if (x.name.endsWith('.js')) files.push({ name: e.name, source: readFileSync(q, 'utf8') })
      }
    }
    walk(join(CF, e.name))
  }
  return files
}

/** 缺结构文档的集合（纯函数，自检用临时 schema 目录） */
export function missingSchemaDocs(collections, schemaExists) {
  return collections.filter((c) => !schemaExists(c))
}

const BASELINE_PATH = join(HERE, 'collection-docs-baseline.json')

function loadBaseline() {
  try {
    const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    return Array.isArray(raw.missing) ? raw.missing : []
  } catch (e) {
    return null // 读不到基线 → 调用方按"无法判定"处理（E16），不静默放行
  }
}

/**
 * 基线比对（纯函数，自检直接测它）。
 *   · `added`  当前缺失但不在基线里 → **新增欠账，必须报错**
 *   · `fixed`  在基线里但当前已不缺 → **基线过期，也必须报错**（例外只许变小）
 */
export function diffBaseline(baseline, now) {
  const baseSet = new Set(baseline || [])
  const nowSet = new Set(now || [])
  return {
    added: (now || []).filter((c) => !baseSet.has(c)),
    fixed: (baseline || []).filter((c) => !nowSet.has(c))
  }
}

function collect(schemaDir, cfFiles) {
  const res = resolveCollections(cfFiles)
  const schemaExists = (c) => existsSync(join(schemaDir, `${c}.md`))
  return { resolved: res.resolved, dynamic: res.dynamic, problems: missingSchemaDocs(res.resolved, schemaExists) }
}

// ── 自检：造一个最小云函数集合 + 临时 schema 目录 ──

function makeTempTree() {
  const dir = mkdtempSync(join(tmpdir(), 'coldocs-selftest-'))
  mkdirSync(join(dir, 'schema'), { recursive: true })
  // 两个被引用的集合：一个写法是字面量、一个是常量名（验证复用了解析器的常量解析）
  const files = [
    {
      name: 'fnA',
      source: [
        "const cloud = require('wx-server-sdk')",
        "const COL_A = 'alpha_col'",
        'async function run(db) {',
        "  await db.collection('beta_col').get()",
        '  await db.collection(COL_A).get()',
        '}'
      ].join('\n')
    }
  ]
  return { dir, files }
}

function runOn(schemaDir, files) {
  return collect(schemaDir, files)
}

function runSelfTest() {
  console.log('自检：确认「缺结构文档」时守卫确实会失败\n')
  const { dir, files } = makeTempTree()
  const schemaDir = join(dir, 'schema')
  let allDetected = true

  // 基线：两份文档都在 → 不该报
  writeFileSync(join(schemaDir, 'alpha_col.md'), '# alpha\n')
  writeFileSync(join(schemaDir, 'beta_col.md'), '# beta\n')
  const okRes = runOn(schemaDir, files)
  const baseClean = okRes.problems.length === 0 && okRes.resolved.length === 2
  console.log(`${baseClean ? '✓' : '✗'} 基线：常量名与字面量两种写法都被解析出，且文档齐全时不报`)
  if (!baseClean) {
    console.log(`    · 解析出 ${JSON.stringify(okRes.resolved)} / 问题 ${JSON.stringify(okRes.problems)}`)
    allDetected = false
  }

  // 注入 1：删掉一份文档
  rmSync(join(schemaDir, 'beta_col.md'))
  const r1 = runOn(schemaDir, files)
  const d1 = r1.problems.includes('beta_col')
  allDetected = allDetected && d1
  console.log(`${d1 ? '✓' : '✗'} 注入 删掉 beta_col.md → ${d1 ? '已检出' : '【漏检】'}`)
  if (d1) console.log(`    · ${r1.problems.join(', ')}`)

  // 注入 2：常量名写法被漏解析（等价于"只认字面量"的实现）
  writeFileSync(join(schemaDir, 'beta_col.md'), '# beta\n')
  const onlyLiterals = { resolved: ['beta_col'], dynamic: [] }
  const r2 = missingSchemaDocs(onlyLiterals.resolved, (c) => existsSync(join(schemaDir, `${c}.md`)))
  const d2 = r2.length === 0
  allDetected = allDetected && d2
  console.log(`${d2 ? '✓' : '✗'} 判据边界：只解析字面量时**不会**发现 alpha_col 缺失（说明常量解析必须复用，不能自己写）`)

  // 注入 3：新集合没文档（不在基线里）→ 必须报
  const b3 = diffBaseline(['alpha_col'], ['alpha_col', 'beta_col'])
  const d3 = b3.added.length === 1 && b3.added[0] === 'beta_col' && b3.fixed.length === 0
  allDetected = allDetected && d3
  console.log(`${d3 ? '✓' : '✗'} 注入 新增集合没文档（基线外）→ ${d3 ? '已检出' : '【漏检】'}`)
  if (d3) console.log(`    · 新增缺失：${b3.added.join(', ')}`)

  // 注入 4：基线过期（文档已补齐但没删条目）→ 也必须报，逼收敛（例外只许变小）
  const b4 = diffBaseline(['alpha_col', 'beta_col'], ['alpha_col'])
  const d4 = b4.fixed.length === 1 && b4.fixed[0] === 'beta_col' && b4.added.length === 0
  allDetected = allDetected && d4
  console.log(`${d4 ? '✓' : '✗'} 注入 基线过期未收敛 → ${d4 ? '已检出' : '【漏检】'}`)
  if (d4) console.log(`    · 基线过期：${b4.fixed.join(', ')}`)

  rmSync(dir, { recursive: true, force: true })

  // 真实仓库：不许有新增欠账、不许有基线过期
  const real = collect(SCHEMA, scanCloudFunctions())
  const baseline = loadBaseline()
  const realDiff = baseline === null ? { added: ['(读不到基线)'], fixed: [] } : diffBaseline(baseline, real.problems)
  const clean = realDiff.added.length === 0 && realDiff.fixed.length === 0
  console.log(
    `\n${clean ? '✓' : '✗'} 真实仓库：${real.resolved.length} 个被引用集合，` +
      `${real.resolved.length - real.problems.length} 个有文档，基线 ${baseline ? baseline.length : '?'} 条`
  )
  realDiff.added.slice(0, 10).forEach((p) => console.log(`    · 新增缺失：${p}`))
  realDiff.fixed.slice(0, 10).forEach((p) => console.log(`    · 基线过期：${p}`))

  if (!allDetected || !clean) {
    console.log('\n✗ 自检失败')
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过（含"为什么必须复用常量解析"的反例）`)
}

if (process.argv.includes('--selftest')) {
  runSelfTest()
} else if (process.argv.includes('--update')) {
  /**
   * 收敛基线：**只许变小**。若当前缺失比基线多，拒绝更新（否则等于用 --update 放水）。
   */
  const baseline = loadBaseline()
  const real = collect(SCHEMA, scanCloudFunctions())
  if (baseline === null) {
    console.log('✗ 读不到基线文件，无法收敛')
    process.exit(1)
  }
  if (real.problems.length > baseline.length) {
    console.log(
      `✗ 拒绝更新基线：当前缺失 ${real.problems.length} 个，比基线 ${baseline.length} 个**更多**。\n` +
        '  --update 只能用来收敛（补齐文档后删条目），不能用来放水。'
    )
    process.exit(1)
  }
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        _doc: '集合结构文档守卫的**冻结基线**：这些集合被云函数引用但还没有 cloudbase/schema/<name>.md。',
        _why: '2026-09-19 建守卫时盘点出的**历史欠账**（39 / 95）。不逐个补文档，但也不放弃守卫 —— 用基线冻结现状：**新集合没文档直接报错**，基线只许变小。',
        _rule: '修好一个就从这里删一条（npm run check:collection-docs --update）；基线里「已不再缺失」的条目会被判为问题，强制收敛。',
        frozenAt: '2026-09-19',
        missing: real.problems
      },
      null,
      2
    ) + '\n',
    'utf8'
  )
  console.log(`✓ 基线已收敛：${baseline.length} → ${real.problems.length}`)
} else {
  const baseline = loadBaseline()
  if (baseline === null) {
    // E16：无法判定必须非 0 退出，不许静默通过
    console.log('✗ 无法判定：读不到 collection-docs-baseline.json')
    process.exit(1)
  }
  const real = collect(SCHEMA, scanCloudFunctions())
  const { added, fixed } = diffBaseline(baseline, real.problems)

  if (added.length || fixed.length) {
    console.log('✗ 集合结构文档守卫未通过：\n')
    added.forEach((c) => console.log(`  ✗ 新增缺失：cloudbase/schema/${c}.md（新集合必须有结构文档）`))
    fixed.forEach((c) =>
      console.log(`  ✗ 基线过期：cloudbase/schema/${c}.md 已补齐，请运行 npm run check:collection-docs --update 收敛基线`)
    )
    console.log(`\n（基线 ${baseline.length} 条 / 当前缺失 ${real.problems.length} 条）`)
    process.exit(1)
  }
  console.log(
    `✓ 集合结构文档：${real.resolved.length} 个被云函数引用的集合，` +
      `${real.resolved.length - real.problems.length} 个有文档，${real.problems.length} 个为冻结基线内的历史欠账（只许变小）` +
      (real.dynamic.length ? `；另有 ${real.dynamic.length} 个动态集合名不可静态判定` : '')
  )
}
