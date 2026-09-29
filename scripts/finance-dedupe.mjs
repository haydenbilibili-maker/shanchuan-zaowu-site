/**
 * 财务日账历史重复清理（**默认只读报告，需显式 --apply**）
 *
 * 判据与 ERP 录入弹窗同一份：admin/src/utils/financeDuplicateCheck.js
 *   重复 = 归属后同门店（旧主店 id / 空 storeId → 山川造物）+ 同营业日；
 *   只删「完全重复」（金额字段一致）的多余副本，每组保留 1 条；
 *   「同日同店金额不同」**一条不删**，列入报告交产品负责人逐条定。
 *
 * 安全设计
 *   · 备份：--apply 先把三集合**全量**快照写到 backups/finance-dedupe/（.gitignore 覆盖，不在发布目录），
 *     再单独写一份「将删文档」清单；备份写失败即中止；
 *   · 按 _id 删除，删前重读确认文档仍存在且内容未变；
 *   · 审计：结果（删除 _id、前后各月合计）落 backups/finance-dedupe/audit-<时间>.json；
 *   · 恢复：--restore <备份文件>，按原 _id 写回（已存在的跳过，幂等）。
 *
 * 用法：
 *   node scripts/finance-dedupe.mjs                     # 只读：重复清单 + 各月合计
 *   node scripts/finance-dedupe.mjs --apply             # 备份后删除完全重复的多余副本
 *   node scripts/finance-dedupe.mjs --restore <file>    # 按备份恢复被删文档
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyDuplicateGroups,
  canonicalLedgerStoreId,
  ledgerAmounts,
  ledgerDateOf,
} from '../admin/src/utils/financeDuplicateCheck.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const BACKUP_DIR = resolve(ROOT, 'backups/finance-dedupe')
const COLLECTIONS = ['store_ledger', 'finance_records', 'daily_revenues']
const require = createRequire(import.meta.url)

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const RESTORE = args.includes('--restore') ? args[args.indexOf('--restore') + 1] : null

function readCreds() {
  const out = {}
  for (const raw of readFileSync(resolve(ROOT, 'admin/.env'), 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const [k, ...rest] = line.split('=')
    out[k.trim()] = rest.join('=').trim()
  }
  if (!out.TCB_SECRET_ID || !out.TCB_SECRET_KEY) throw new Error('admin/.env 缺少 TCB_SECRET_*')
  return out
}

let tcb = null
for (const p of [
  resolve(ROOT, 'node_modules/@cloudbase/node-sdk'),
  resolve(ROOT, '../WeChatProjects/shanchuanspecimens-只上传/cloudfunctions/manageProducts/node_modules/@cloudbase/node-sdk'),
]) {
  try { tcb = require(p); break } catch { /* 继续 */ }
}
if (!tcb) { console.error('✗ 未找到 @cloudbase/node-sdk'); process.exit(1) }
const creds = readCreds()
const db = tcb.init({ env: 'cloud1-8gnkty5bfff9f0bf', secretId: creds.TCB_SECRET_ID, secretKey: creds.TCB_SECRET_KEY }).database()

async function fetchAll(col) {
  const out = []
  for (let skip = 0; ; skip += 1000) {
    const { data } = await db.collection(col).skip(skip).limit(1000).get()
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

const round2 = (n) => Math.round(n * 100) / 100
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

/** 各月合计：原样逐行求和（= 按原始 storeId 区分时的口径）与按归属键去重后的口径 */
function monthTotals(rows) {
  const raw = {}
  const byKey = new Map()
  for (const r of rows) {
    if (r.deleted === true) continue
    const d = ledgerDateOf(r)
    if (!d) continue
    const m = d.slice(0, 7)
    const v = ledgerAmounts(r).revenue
    raw[m] = round2((raw[m] || 0) + v)
    const k = `${canonicalLedgerStoreId(r)}|${d}`
    byKey.set(k, Math.max(byKey.get(k) ?? -Infinity, v))
  }
  const dedup = {}
  for (const [k, v] of byKey) {
    const m = k.split('|')[1].slice(0, 7)
    dedup[m] = round2((dedup[m] || 0) + v)
  }
  return { raw, dedup }
}

function summarize(col, rows) {
  const groups = classifyDuplicateGroups(rows)
  return {
    col,
    total: rows.length,
    identicalGroups: groups.filter((g) => g.identical).length,
    differGroups: groups.filter((g) => !g.identical).length,
    removeIds: groups.flatMap((g) => g.remove.map((x) => x.row._id)),
    groups: groups.map((g) => ({
      key: g.key,
      identical: g.identical,
      keep: { _id: g.keep.row._id, storeId: g.keep.row.storeId ?? null, ...ledgerAmounts(g.keep.row) },
      others: g.others.map((x, i) => ({
        _id: x.row._id,
        storeId: x.row.storeId ?? null,
        ...ledgerAmounts(x.row),
        diffs: g.diffs[i],
      })),
    })),
    months: monthTotals(rows),
  }
}

async function restore(file) {
  const payload = JSON.parse(readFileSync(resolve(file), 'utf8'))
  const docs = payload.removed || []
  let restored = 0
  let skipped = 0
  for (const { col, doc } of docs) {
    const { _id, ...data } = doc
    const exists = await db.collection(col).doc(_id).get().then((r) => (r.data || []).length > 0).catch(() => false)
    if (exists) { skipped++; continue }
    await db.collection(col).doc(_id).set(data)
    restored++
  }
  console.log(`✓ 恢复完成：写回 ${restored} 条，已存在跳过 ${skipped} 条`)
}

async function main() {
  if (RESTORE) return restore(RESTORE)

  const data = {}
  for (const col of COLLECTIONS) data[col] = await fetchAll(col)
  const before = COLLECTIONS.map((c) => summarize(c, data[c]))

  for (const s of before) {
    console.log(`\n== ${s.col}：${s.total} 行 · 完全重复 ${s.identicalGroups} 组（拟删 ${s.removeIds.length} 条）· 金额不同 ${s.differGroups} 组（不删，待逐条定）`)
    for (const g of s.groups) {
      const tag = g.identical ? '完全重复' : '金额不同'
      const others = g.others
        .map((o) => `${o.storeId || '∅'} ¥${o.revenue}${o.diffs.length ? ' [' + o.diffs.map((d) => `${d.label} ${d.existing}→${d.incoming}`).join('，') + ']' : ''}`)
        .join('；')
      console.log(`  ${tag} ${g.key} 保留 ${g.keep.storeId || '∅'} ¥${g.keep.revenue} ｜ 其余 ${others}`)
    }
    const { raw, dedup } = s.months
    const changed = Object.keys(raw).filter((m) => raw[m] !== dedup[m]).sort()
    for (const m of changed) {
      console.log(`  月合计 ${m}：逐行求和 ¥${raw[m]} → 按归属去重 ¥${dedup[m]}（差 ¥${round2(raw[m] - dedup[m])}）`)
    }
  }

  const toRemove = before.flatMap((s) => s.removeIds.map((id) => ({ col: s.col, id })))
  if (!APPLY) {
    console.log(`\n只读模式：完全重复多余副本共 ${toRemove.length} 条。确认后加 --apply 执行（会先全量备份）。`)
    return
  }

  mkdirSync(BACKUP_DIR, { recursive: true })
  const ts = stamp()
  const snapshotFile = resolve(BACKUP_DIR, `snapshot-${ts}.json`)
  writeFileSync(snapshotFile, JSON.stringify({ at: new Date().toISOString(), data }, null, 1))
  const removed = toRemove.map(({ col, id }) => ({ col, doc: data[col].find((d) => d._id === id) }))
  const backupFile = resolve(BACKUP_DIR, `removed-${ts}.json`)
  writeFileSync(backupFile, JSON.stringify({ at: new Date().toISOString(), removed }, null, 1))
  if (!existsSync(snapshotFile) || !existsSync(backupFile)) throw new Error('备份未落盘，中止')
  console.log(`\n✓ 全量快照 ${snapshotFile}\n✓ 将删文档 ${backupFile}`)

  const done = []
  for (const { col, doc } of removed) {
    const cur = await db.collection(col).doc(doc._id).get()
    const now = (cur.data || [])[0]
    if (!now) continue
    if (JSON.stringify(ledgerAmounts(now)) !== JSON.stringify(ledgerAmounts(doc))) {
      console.log(`  跳过 ${col}/${doc._id}：备份后内容已变`)
      continue
    }
    const res = await db.collection(col).doc(doc._id).remove()
    done.push({ col, _id: doc._id, deleted: res?.deleted ?? null })
  }

  const after = {}
  for (const col of COLLECTIONS) after[col] = summarize(col, await fetchAll(col))
  const auditFile = resolve(BACKUP_DIR, `audit-${ts}.json`)
  writeFileSync(auditFile, JSON.stringify({
    at: new Date().toISOString(),
    operator: 'scripts/finance-dedupe.mjs --apply',
    backupFile,
    snapshotFile,
    deleted: done,
    before: Object.fromEntries(before.map((s) => [s.col, { identicalGroups: s.identicalGroups, differGroups: s.differGroups, months: s.months }])),
    after: Object.fromEntries(Object.entries(after).map(([c, s]) => [c, { identicalGroups: s.identicalGroups, differGroups: s.differGroups, months: s.months }])),
  }, null, 1))
  console.log(`\n✓ 删除 ${done.length} 条；审计 ${auditFile}`)
  console.log(`恢复：node scripts/finance-dedupe.mjs --restore ${backupFile}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error('✗', e?.message || e); process.exit(1) })
