#!/usr/bin/env node
/**
 * 幂等唯一索引的**只读线上预检**（只查不建）—— 契约 C2「钱账本」裁决 §6 步骤 1
 *
 * 为什么单独成一个脚本：
 *   `ensure-dedupe-indexes.cjs` 虽然默认也只预检，但它**带着 `--execute`**；
 *   而裁决 §2 是硬红线 ——「唯一索引未证实存在之前，不得改动任何钱路径代码」。
 *   所以需要一个**语法上就不可能建索引**的入口：本脚本只调用
 *   `describeCollection` / `runCommands(count|aggregate)`，不 import `updateCollection` 分支
 *   （预检实现直接复用 ensure-dedupe-indexes.cjs 导出的 `preflight`，避免两套判据漂移）。
 *
 * 无凭据时的行为（仓库约定：**没凭据的命令不许被当作「通过」**）：
 *   打印 ⏭ 并明确写「这不是通过」；退出码 0（跳过 ≠ 失败，也 ≠ 通过）。
 *   索引存在性在无凭据时**无法证实** → C2 的钱路径红线依然生效。
 *
 * 用法：
 *   node miniprogram/scripts/check-dedupe-index-live.mjs
 *   node miniprogram/scripts/check-dedupe-index-live.mjs --json
 *   node miniprogram/scripts/check-dedupe-index-live.mjs --selftest   # 证明判据会失败（不需要凭据）
 *
 * 凭据：admin/.env 的 TCB_SECRET_ID / TCB_SECRET_KEY（勿提交）
 * 覆盖范围：只覆盖 SPECS 里的 `dedupeKey`（本脚本不检查 `stored_value_ledgers.idempotencyKey`
 *          —— 它还没有 spec，见输出末尾的「未覆盖」提示）。
 */
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const ROOT = resolve(MP, '..')
const require = createRequire(import.meta.url)

/**
 * 预检结果 → 两个汇总数字 + 是否通过（纯函数，便于自检）。
 * 「读不到」一律算**不通过**（不许把 null 当成 0 —— 那是 E10 的变体：没实测就写数字）。
 */
export function summarize(reports) {
  // 「集合不存在/读不到」的项不进汇总数字（它们单独列出，避免把 null 摊进总数）
  const readable = reports.filter((r) => r.pre.exists)
  const sum = (arr) => (arr.some((v) => v === null || v === undefined) ? null : arr.reduce((a, b) => a + b, 0))
  // 缺字段数：**报告用**全量；**判失败用**只算非 Sparse 的 spec ——
  // Sparse 唯一索引不索引缺失字段（实测线上 point_records 就是 Sparse 且带 48 篇缺字段文档），
  // 所以缺字段只对「非 Sparse」创建构成阻断，对 Sparse 只是数据质量信号。
  const missingSum = sum(readable.map((r) => r.pre.missingField))
  const missingBlockingSum = sum(readable.filter((r) => r.spec.sparse !== true).map((r) => r.pre.missingField))
  const dups = readable.map((r) => r.pre.duplicateKeys)
  const groups = readable.map((r) => r.pre.duplicateGroupCount)
  const dupSum = sum(dups)
  const dupGroupSum = sum(groups)
  const notExists = reports.filter((r) => !r.pre.exists).map((r) => r.spec.collection)
  const noIndex = reports.filter((r) => r.pre.exists && !r.pre.hasUniqueDedupe).map((r) => r.spec.collection)
  // spec 声明 sparse:true（缺字段不占槽位）却装了非 Sparse 索引 → 语义不一致，单独列出并判失败
  const sparseMismatch = reports
    .filter((r) => r.spec.sparse === true && r.pre.exists && r.pre.hasUniqueDedupe && r.pre.dedupeIndexSparse === false)
    .map((r) => r.spec.collection)
  return {
    missingSum, missingBlockingSum, dupSum, dupGroupSum, notExists, noIndex, sparseMismatch,
    readableCount: readable.length,
    // 重复键对 Sparse / 非 Sparse **都**阻断（实测 user_messages 9 组、notification_logs 13 组）
    bad: !!(notExists.length || noIndex.length || sparseMismatch.length
      || missingBlockingSum !== 0 || dupSum !== 0 || dupGroupSum !== 0),
  }
}

function selftest() {
  let bad = 0
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`) }
  const ok = { spec: { collection: 'c' }, pre: { exists: true, hasUniqueDedupe: true, missingField: 0, duplicateKeys: 0, duplicateGroupCount: 0 } }
  const noIdx = { spec: { collection: 'c' }, pre: { exists: true, hasUniqueDedupe: false, missingField: 0, duplicateKeys: 0, duplicateGroupCount: 0 } }
  const dirty = { spec: { collection: 'c' }, pre: { exists: true, hasUniqueDedupe: false, missingField: 3, duplicateKeys: 2, duplicateGroupCount: 7 } }
  const unreadable = { spec: { collection: 'c' }, pre: { exists: true, hasUniqueDedupe: false, missingField: null, duplicateKeys: null, duplicateGroupCount: null } }
  const badColl = { spec: { collection: 'z' }, pre: { exists: false } }

  t('全部就位 → 通过', summarize([ok]).bad === false)
  t('★ 缺唯一索引 → 不通过', summarize([noIdx]).bad === true)
  t('★ 缺字段/重复键 > 0 → 不通过', summarize([dirty]).bad === true)
  t('★ 数字读不到（null）→ 不通过，且不冒充 0', summarize([unreadable]).bad === true && summarize([unreadable]).missingSum === null)
  t('★ 集合读不到 → 不通过', summarize([badColl]).bad === true)
  t('★ 集合读不到时不摊进两个汇总数字（坏集合不污染总数）',
    summarize([dirty, badColl]).missingSum === 3 && summarize([dirty, badColl]).dupSum === 2
    && summarize([dirty, badColl]).dupGroupSum === 7)
  t('两个数字会求和（3+0 / 2+0）', summarize([dirty, ok]).missingSum === 3 && summarize([dirty, ok]).dupSum === 2)
  t('★ 重复键确切组数参与判定（样本被 limit 5 截断也不漏）',
    summarize([{ spec: { collection: 'c' }, pre: { exists: true, hasUniqueDedupe: false, missingField: 0, duplicateKeys: 0, duplicateGroupCount: 9 } }]).bad === true)
  // Sparse 语义：spec 要 Sparse（缺字段不占槽位），线上却装了非 Sparse → 必须报出来
  const sparseSpecNonSparseLive = { spec: { collection: 'c', sparse: true }, pre: { exists: true, hasUniqueDedupe: true, dedupeIndexSparse: false, missingField: 5, duplicateKeys: 0, duplicateGroupCount: 0 } }
  const sparseSpecOkLive = { spec: { collection: 'c', sparse: true }, pre: { exists: true, hasUniqueDedupe: true, dedupeIndexSparse: true, missingField: 5, duplicateKeys: 0, duplicateGroupCount: 0 } }
  const noSparseSpec = { spec: { collection: 'c' }, pre: { exists: true, hasUniqueDedupe: true, dedupeIndexSparse: false, missingField: 5, duplicateKeys: 0, duplicateGroupCount: 0 } }
  t('★ spec 要 Sparse 但线上是非 Sparse → 不通过',
    summarize([sparseSpecNonSparseLive]).bad === true && summarize([sparseSpecNonSparseLive]).sparseMismatch.includes('c'))
  t('  spec 要 Sparse、线上也是 Sparse → 通过（缺字段 5 不阻断）', summarize([sparseSpecOkLive]).bad === false)
  t('  没声明 sparse 的 spec 不做 Sparse 比对', summarize([noSparseSpec]).sparseMismatch.length === 0)
  t('★ 非 Sparse spec 缺字段 5 → 不通过（缺字段只对非 Sparse 构成阻断）',
    summarize([noSparseSpec]).bad === true && summarize([noSparseSpec]).missingBlockingSum === 5)
  t('  Sparse spec 的缺字段仍进「报告用」总数（不当 0 吞掉）',
    summarize([sparseSpecOkLive]).missingSum === 5 && summarize([sparseSpecOkLive]).missingBlockingSum === 0)

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 判据不可信`)
    process.exit(1)
  }
  console.log('\n自检通过：缺索引 / 脏数据 / 读不到 都会被判为「不通过」，且读不到不会冒充 0')
}

const provision = require(join(HERE, 'ensure-dedupe-indexes.cjs'))
const { SPECS = [], ENV_ID } = provision

const SKIP = (why) => {
  console.log(`⏭ 未验证（跳过）：${why}`)
  console.log('   这不是「通过」—— 唯一索引是否真的存在**仍未证实**，')
  console.log('   契约 C2 裁决 §2 的红线（索引未证实前不得改钱路径代码）继续生效。')
  console.log('   要拿到数字：把 TCB_SECRET_ID / TCB_SECRET_KEY 写进 admin/.env 后重跑本脚本。')
  // ⚠️ 2026-09-18 集成官改（原本 exit 0）：
  //    无凭据时**必须非 0 退出**，否则一旦有人把它接进 `check:admin`（守卫链），
  //    汇总里它就是一行 `✓` —— 而它其实什么都没验证。这正是本仓反复吃亏的
  //    「空头承诺」形态（check:dedupe-index-coverage 曾报 `✓ 覆盖齐全` 却只扫了 10/29 个函数；
  //    check:species-dedup 的"副本一致"曾是 `cmp A A` 恒真）。
  //    仓库既有约定：需要凭据的守卫 exit 2 并**留在链外**（见 check:fn-sync / audit:collections）。
  //    所以本脚本：**不进任何域文件**，只按需手动跑；无凭据时 exit 2。
  process.exit(2)
}

async function main() {
  const asJson = process.argv.includes('--json')

  // 只读预检依赖的导出（缺了说明 ensure-dedupe-indexes.cjs 被改坏 → 明说，不当通过）
  if (typeof provision.loadDotEnv !== 'function' || typeof provision.preflight !== 'function') {
    console.error('✗ ensure-dedupe-indexes.cjs 未导出 loadDotEnv/preflight —— 本脚本无法复用同一套预检实现。')
    process.exit(2)
  }
  if (!SPECS.length) {
    console.error('✗ 读不到 SPECS —— 没有可预检的集合。')
    process.exit(2)
  }

  provision.loadDotEnv()
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) {
    SKIP('缺少 TCB_SECRET_ID / TCB_SECRET_KEY（admin/.env 不存在或缺键）')
  }

  let CloudBase = null
  for (const id of ['@cloudbase/manager-node', join(ROOT, 'node_modules', '@cloudbase', 'manager-node')]) {
    try { CloudBase = require(id); break } catch { /* 换下一个候选 */ }
  }
  if (!CloudBase) {
    console.error('✗ 未安装 @cloudbase/manager-node（admin devDependencies；worktree 未装时可用 NODE_PATH 指向主库 node_modules）')
    process.exit(2)
  }
  const app = CloudBase.init({ secretId, secretKey, envId: ENV_ID })
  const { database } = app

  const reports = []
  for (const spec of SPECS) {
    reports.push({ spec, pre: await provision.preflight(database, spec) })
  }

  if (asJson) {
    console.log(JSON.stringify(reports.map((r) => ({ ...r.spec, pre: r.pre })), null, 2))
  } else {
    console.log(`env=${ENV_ID}  只读预检（本脚本没有建索引的代码路径）\n`)
    for (const { spec, pre } of reports) {
      console.log(`── ${spec.collection}.${spec.field}（${spec.indexName}）`)
      if (!pre.exists) {
        console.log(`   ✗ 集合不存在或读不到：${pre.error || ''}`)
        continue
      }
      console.log(`   已有唯一幂等索引：${pre.hasUniqueDedupe ? `是（Sparse=${pre.dedupeIndexSparse === true ? '是' : pre.dedupeIndexSparse === false ? '否' : '未知'}）` : '**否**'}`)
      if (spec.sparse && pre.hasUniqueDedupe && pre.dedupeIndexSparse === false) {
        console.log('   ⚠️ Sparse 不一致：spec 要求 Sparse 唯一索引（缺字段不占槽位），线上这条**不是** Sparse')
      }
      console.log(`   缺 ${spec.field} 的文档数：${pre.missingField === null ? '读不到（' + (pre.countError || '') + '）' : pre.missingField}`)
      console.log(`   重复键：${pre.duplicateKeys === null ? '读不到（' + (pre.dupError || '') + '）' : `样本 ${pre.samples.length ? pre.samples.map((s) => `${s.key}×${s.n}`).join(', ') : '无'}；确切重复组数 ${pre.duplicateGroupCount === null ? '读不到' : pre.duplicateGroupCount}`}`)
    }
  }

  // 两个汇总数字（裁决 §6 步骤 1 明确要的两个数）
  const { missingSum, missingBlockingSum, dupSum, dupGroupSum, notExists, noIndex, sparseMismatch, readableCount, bad } = summarize(reports)

  if (!asJson) {
    console.log(`\n汇总（只统计能读到的 ${readableCount} 个集合；集合不存在的见上，不摊进总数）：`)
    console.log(`  · 缺幂等键（dedupeKey / idempotencyKey）的文档数：${missingSum === null ? '读不到（见上）' : missingSum}`)
    console.log(`    （其中会**阻断创建**的只有非 Sparse spec：${missingBlockingSum === null ? '读不到' : missingBlockingSum}；Sparse 的缺字段不占唯一槽位）`)
    console.log(`  · 重复键样本数：${dupSum === null ? '读不到（见上）' : dupSum}（每集合最多取 5 个样本）`)
    console.log(`  · 重复键**确切组数**：${dupGroupSum === null ? '读不到（见上）' : dupGroupSum}`)
    console.log(`  · 尚缺唯一索引的集合（${noIndex.length}）：${noIndex.length ? noIndex.join(', ') : '无'}`)
    if (notExists.length) console.log(`  · 读不到的集合（${notExists.length}）：${notExists.join(', ')}`)
    if (sparseMismatch.length) console.log(`  · Sparse 与 spec 期望不一致（${sparseMismatch.length}）：${sparseMismatch.join(', ')}`)
    console.log('\n注意 Sparse：spec 标了 sparse:true 的集合（point_records / notification_logs）要求「唯一 + Sparse」——')
    console.log('      缺字段的文档**不占唯一槽位**，所以缺字段数只在按**非 Sparse** 建时才会阻断创建。')
    console.log('已覆盖：本脚本按 SPECS 检查，现已含 stored_value_ledgers.idempotencyKey（裁决 §2 第二个要件）。')
    console.log('判据：**无重复键** 才能建唯一索引（若按非 Sparse 建，还要求缺字段数为 0）。')
  }

  if (bad) {
    console.error('\n✗ 预检未通过：索引未全部就位 / 或历史数据不满足建唯一索引的前提。')
    process.exit(1)
  }
  console.log('\n✓ 预检通过：所有 spec 的唯一幂等索引都已存在。')
}

if (process.argv.includes('--selftest')) selftest()
else main().catch((e) => { console.error(e); process.exit(1) })
