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
 *
 * ⚠️ 2026-09-21 P1-9 **判据修正**（这是一条「判据自身错误」，错题本 E7）：
 *   `ensure-dedupe-indexes.cjs` 在 `229d94f` 已把 `user_messages.dedupeKey_1` 的语义结论定为
 *   **`nonUnique: true`（普通索引才是正确的）** —— 同一个 dedupeKey 跨 24h 时间窗**允许再次写入**
 *   （`dispatchMessage/core.js` 的 `DEDUPE_HOURS = 24`），唯一索引会把正常的再次到店感谢打成写失败。
 *   而本脚本原来的判据只有「字段上有没有**唯一**索引」，与生产者结论相反 → 线上索引即使完全正确也
 *   **恒红**；又因本脚本不在 guards 清单、无凭据时 exit 2，CI 也不会红 —— 一条永远错的判据无人看见。
 *   现在按 spec 声明的**期望唯一性**判：
 *     · 唯一 spec      → 字段上必须有唯一索引（Sparse 语义照旧）；
 *     · nonUnique spec → 字段上必须有**普通**索引；线上反而是唯一索引 → `unexpectedUnique` 判失败；
 *     · nonUnique spec 的重复键 / 缺字段只作**报告**（重复正是它被允许的语义），不阻断判定。
 *   本脚本**只读**：它不 import `updateCollection` 分支，语法上就不可能建/改任何线上索引。
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
 *
 * ⚠️ 2026-09-21 P1-9 判据修正（**判据自身错误**，错题本 E7 的那一族）：
 *   原判据只有一句 `!pre.hasUniqueDedupe → noIndex`，即「字段上没有**唯一**索引就算缺」。
 *   但 `ensure-dedupe-indexes.cjs` 在 `229d94f` 已把 `user_messages.dedupeKey_1` 的语义结论
 *   写成 **`nonUnique: true`（普通索引才是正确的）** —— 因为同一 dedupeKey 跨 24h 时间窗
 *   **允许再次写入**（dispatchMessage/core.js 的 `DEDUPE_HOURS = 24`），唯一索引会把正常写入打断。
 *   于是消费者（本文件）与生产者（ensure）语义相反 → 线上即使索引完全正确也**恒红**；
 *   而本脚本不在守卫清单、无凭据 exit 2，所以 CI 也不会红 —— 一条"永远错"的判据谁也看不见。
 *   现在按 spec 声明的**期望唯一性**判：
 *     · 唯一 spec  → 字段上必须有**唯一**索引（Sparse 语义照旧）；
 *     · nonUnique spec → 字段上必须有**普通**索引；若线上反而是唯一索引 → `unexpectedUnique` 判失败；
 *     · nonUnique spec 的**重复键 / 缺字段**只作报告（重复正是它允许的行为），不阻断判定。
 */
export function summarize(reports) {
  // 「集合不存在/读不到」的项不进汇总数字（它们单独列出，避免把 null 摊进总数）
  const readable = reports.filter((r) => r.pre.exists)
  const sum = (arr) => (arr.some((v) => v === null || v === undefined) ? null : arr.reduce((a, b) => a + b, 0))
  // 缺字段数：**报告用**全量；**判失败用**只算「要求唯一索引且非 Sparse」的 spec ——
  // Sparse 唯一索引不索引缺失字段（实测线上 point_records 就是 Sparse 且带 48 篇缺字段文档），
  // nonUnique 普通索引也不受缺失字段影响（缺字段视作 null 照常可索引、无唯一性约束）。
  const missingSum = sum(readable.map((r) => r.pre.missingField))
  const missingBlockingSum = sum(readable
    .filter((r) => r.spec.nonUnique !== true && r.spec.sparse !== true)
    .map((r) => r.pre.missingField))
  const dups = readable.map((r) => r.pre.duplicateKeys)
  const groups = readable.map((r) => r.pre.duplicateGroupCount)
  const dupSum = sum(dups)
  const dupGroupSum = sum(groups)
  // 重复键**只在要求唯一索引的 spec 上**构成阻断：nonUnique 集合里重复键是预期行为
  //（实测 user_messages 9 组、notification_logs 13 组 —— 后者是 Sparse 唯一，仍阻断）
  const dupBlockingSum = sum(readable.filter((r) => r.spec.nonUnique !== true).map((r) => r.pre.duplicateKeys))
  const dupGroupBlockingSum = sum(readable.filter((r) => r.spec.nonUnique !== true).map((r) => r.pre.duplicateGroupCount))
  const notExists = reports.filter((r) => !r.pre.exists).map((r) => r.spec.collection)
  // 缺索引：唯一 spec 看 hasUniqueDedupe；nonUnique spec 看字段上**有没有**索引（唯一与否下面另判）
  const noIndex = readable
    .filter((r) => (r.spec.nonUnique === true ? !r.pre.hasDedupeIndex : !r.pre.hasUniqueDedupe))
    .map((r) => r.spec.collection)
  // nonUnique spec 线上却是唯一索引 → 语义相反（唯一索引会打断跨时间窗的正常写入）
  const unexpectedUnique = readable
    .filter((r) => r.spec.nonUnique === true && r.pre.hasDedupeIndex && r.pre.dedupeIndexUnique === true)
    .map((r) => r.spec.collection)
  // spec 声明 sparse:true（缺字段不占槽位）却装了非 Sparse 索引 → 语义不一致，单独列出并判失败
  const sparseMismatch = reports
    .filter((r) => r.spec.sparse === true && r.pre.exists && r.pre.hasUniqueDedupe && r.pre.dedupeIndexSparse === false)
    .map((r) => r.spec.collection)
  return {
    missingSum, missingBlockingSum, dupSum, dupGroupSum, dupBlockingSum, dupGroupBlockingSum,
    notExists, noIndex, unexpectedUnique, sparseMismatch,
    readableCount: readable.length,
    // 重复键对 Sparse / 要求唯一的非 Sparse spec **都**阻断（实测 user_messages 9 组、notification_logs 13 组）；
    // 对 nonUnique spec 不阻断（重复是它被允许的语义）
    bad: !!(notExists.length || noIndex.length || unexpectedUnique.length || sparseMismatch.length
      || missingBlockingSum !== 0 || dupBlockingSum !== 0 || dupGroupBlockingSum !== 0),
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

  /* P1-9：nonUnique spec（229d94f 的语义结论：user_messages.dedupeKey 必须是**普通**索引）。
   * 旧判据只认"字段上有没有唯一索引" → 线上普通索引完全正确也**恒红**；这里钉住新语义。 */
  const nuOk = { spec: { collection: 'u', nonUnique: true }, pre: { exists: true, hasDedupeIndex: true, dedupeIndexUnique: false, hasUniqueDedupe: false, dedupeIndexSparse: false, missingField: 12, duplicateKeys: 5, duplicateGroupCount: 9 } }
  const nuMissing = { spec: { collection: 'u', nonUnique: true }, pre: { exists: true, hasDedupeIndex: false, dedupeIndexUnique: null, hasUniqueDedupe: false, missingField: 0, duplicateKeys: 0, duplicateGroupCount: 0 } }
  const nuUnique = { spec: { collection: 'u', nonUnique: true }, pre: { exists: true, hasDedupeIndex: true, dedupeIndexUnique: true, hasUniqueDedupe: true, dedupeIndexSparse: false, missingField: 0, duplicateKeys: 0, duplicateGroupCount: 0 } }
  t('★ nonUnique spec + 普通索引（含重复键/缺字段）→ 通过（与 229d94f 语义一致，不再恒红）',
    summarize([nuOk]).bad === false && summarize([nuOk]).noIndex.length === 0)
  t('★ nonUnique spec + 字段上没有索引 → 不通过', summarize([nuMissing]).bad === true && summarize([nuMissing]).noIndex.includes('u'))
  t('★ nonUnique spec + 线上却是唯一索引 → 不通过（语义相反，会打断跨窗写入）',
    summarize([nuUnique]).bad === true && summarize([nuUnique]).unexpectedUnique.includes('u'))
  t('★ nonUnique 的重复键只报告、不阻断（dupSum 仍如实统计）',
    summarize([nuOk]).dupBlockingSum === 0 && summarize([nuOk]).dupSum === 5 && summarize([nuOk]).dupGroupSum === 9)

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 判据不可信`)
    process.exit(1)
  }
  console.log('\n自检通过：缺索引 / 脏数据 / 读不到 都会被判为「不通过」，且读不到不会冒充 0；')
  console.log('          nonUnique spec 期望普通索引（重复键不阻断）—— 与 ensure-dedupe-indexes 的 229d94f 结论一致')
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
      const wantKind = spec.nonUnique ? '普通（非唯一）' : '唯一'
      const gotKind = pre.hasDedupeIndex ? (pre.dedupeIndexUnique ? '唯一' : '普通（非唯一）') : '**无**'
      console.log(`   期望 / 线上幂等索引：${wantKind} / ${gotKind}${pre.hasDedupeIndex ? `（Sparse=${pre.dedupeIndexSparse === true ? '是' : pre.dedupeIndexSparse === false ? '否' : '未知'}）` : ''}`)
      if (spec.sparse && pre.hasUniqueDedupe && pre.dedupeIndexSparse === false) {
        console.log('   ⚠️ Sparse 不一致：spec 要求 Sparse 唯一索引（缺字段不占槽位），线上这条**不是** Sparse')
      }
      if (spec.nonUnique && pre.dedupeIndexUnique === true) {
        console.log('   ⚠️ 唯一性相反：spec 要求**普通**索引（同一 dedupeKey 跨 24h 窗可再写），线上却是唯一索引')
      }
      console.log(`   缺 ${spec.field} 的文档数：${pre.missingField === null ? '读不到（' + (pre.countError || '') + '）' : pre.missingField}`)
      console.log(`   重复键：${pre.duplicateKeys === null ? '读不到（' + (pre.dupError || '') + '）' : `样本 ${pre.samples.length ? pre.samples.map((s) => `${s.key}×${s.n}`).join(', ') : '无'}；确切重复组数 ${pre.duplicateGroupCount === null ? '读不到' : pre.duplicateGroupCount}`}`)
    }
  }

  // 两个汇总数字（裁决 §6 步骤 1 明确要的两个数）
  const { missingSum, missingBlockingSum, dupSum, dupGroupSum, notExists, noIndex, unexpectedUnique, sparseMismatch, readableCount, bad } = summarize(reports)

  if (!asJson) {
    console.log(`\n汇总（只统计能读到的 ${readableCount} 个集合；集合不存在的见上，不摊进总数）：`)
    console.log(`  · 缺幂等键（dedupeKey / idempotencyKey）的文档数：${missingSum === null ? '读不到（见上）' : missingSum}`)
    console.log(`    （其中会**阻断创建唯一索引**的只有「要求唯一且非 Sparse」的 spec：${missingBlockingSum === null ? '读不到' : missingBlockingSum}；`
      + 'Sparse 的缺字段不占唯一槽位、普通索引不受缺字段影响）')
    console.log(`  · 重复键样本数：${dupSum === null ? '读不到（见上）' : dupSum}（每集合最多取 5 个样本）`)
    console.log(`  · 重复键**确切组数**：${dupGroupSum === null ? '读不到（见上）' : dupGroupSum}`)
    console.log(`  · 尚缺幂等索引的集合（${noIndex.length}）：${noIndex.length ? noIndex.join(', ') : '无'}`)
    if (unexpectedUnique.length) console.log(`  · 线上唯一性与 spec 相反（期望普通索引却是唯一，${unexpectedUnique.length}）：${unexpectedUnique.join(', ')}`)
    if (notExists.length) console.log(`  · 读不到的集合（${notExists.length}）：${notExists.join(', ')}`)
    if (sparseMismatch.length) console.log(`  · Sparse 与 spec 期望不一致（${sparseMismatch.length}）：${sparseMismatch.join(', ')}`)
    console.log('\n注意 Sparse：spec 标了 sparse:true 的集合（point_records / notification_logs）要求「唯一 + Sparse」——')
    console.log('      缺字段的文档**不占唯一槽位**，所以缺字段数只在按**非 Sparse** 建唯一索引时才会阻断创建。')
    console.log('      重复键仍**阻断**唯一索引的创建（对 nonUnique spec 不阻断 —— 那正是普通索引的语义）。')
    console.log('已覆盖：本脚本按 SPECS 检查，现已含 stored_value_ledgers.idempotencyKey（裁决 §2 第二个要件）。')
    console.log('判据：唯一 spec → 字段上必须有**唯一**索引（非 Sparse 时还要求缺字段=0、无重复键）；')
    console.log('      nonUnique spec（user_messages.dedupeKey）→ 字段上必须有**普通**索引，重复键是预期、不阻断。')
  }

  if (bad) {
    console.error('\n✗ 预检未通过：索引未全部就位 / 或历史数据不满足建唯一索引的前提。')
    process.exit(1)
  }
  console.log('\n✓ 预检通过：所有 spec 的唯一幂等索引都已存在。')
}

if (process.argv.includes('--selftest')) selftest()
else main().catch((e) => { console.error(e); process.exit(1) })
