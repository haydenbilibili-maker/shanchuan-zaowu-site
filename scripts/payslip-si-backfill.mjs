#!/usr/bin/env node
/**
 * 已发工资条 → 按「社保扣缴标准」补明细。**默认 dry-run（只读 + 本地备份），不写库。**
 * 口径：miniprogram/docs/工资条社保明细_2026-10-10.md
 *
 *   node scripts/payslip-si-backfill.mjs                       # dry-run：备份 staff_payslips 全量 → 列出两种补法的前后差异
 *   node scripts/payslip-si-backfill.mjs --apply --mode detail-only --yes
 *        # 只补明细、不改金额：扣款仍是原数，拆成 养老 / 医疗 / 失业 三项 + 公司缴纳展示（不含大额医疗互助）
 *   node scripts/payslip-si-backfill.mjs --apply --mode with-annual --yes
 *        # 补明细并补扣大额医疗互助：扣款 +100、实发 −100（钱的变化，须产品负责人点名）
 *   node scripts/payslip-si-backfill.mjs --rollback --backup <备份目录> [--yes]
 *        # 只还原本脚本改过的工资条（siBackfillMark=本批标记）的 deduction / net / otherDeduction / socialInsurance
 *
 * 范围：没有社保快照、扣款 = 标准月度个人合计（452.50，即三项个人社保）的工资条；其余只列出不动。
 * --only <工资条月份> 可限定月份（默认全部）。写入前必先全量备份，写后逐张读回核对。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLL = 'staff_payslips'
const MARK = '社保明细补写·2026-10-10'
const TOUCHED = ['deduction', 'net', 'otherDeduction', 'socialInsurance']
const SI = require(resolve(ROOT, 'miniprogram/cloudfunctions/manageStaffWorkspace/socialInsurance.js'))

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const MODE = has('--apply') ? 'apply' : has('--rollback') ? 'rollback' : 'dry-run'
const FILL = opt('--mode', '')
const ONLY = opt('--only', '')

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const near = (a, b) => Math.abs(r2(a) - r2(b)) < 0.005
const mask = (s) => { s = String(s || ''); return s.length <= 4 ? '**' : `${s.slice(0, 2)}…${s.slice(-2)}` }

function openDb() {
  const env = {}
  for (const raw of readFileSync(resolve(ROOT, 'admin/.env'), 'utf8').split('\n')) {
    const m = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  if (!env.TCB_SECRET_ID || !env.TCB_SECRET_KEY) throw new Error('admin/.env 缺少 TCB_SECRET_ID / TCB_SECRET_KEY')
  let tcb = null
  for (const p of [
    resolve(ROOT, '../WeChatProjects/shanchuanspecimens-只上传/cloudfunctions/manageProducts/node_modules/@cloudbase/node-sdk'),
    resolve(ROOT, 'node_modules/@cloudbase/node-sdk')
  ]) {
    try { tcb = require(p); break } catch (e) { /* 试下一个 */ }
  }
  if (!tcb) throw new Error('未找到 @cloudbase/node-sdk')
  return tcb.init({ env: ENV_ID, secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY }).database()
}

async function fetchAll(db) {
  const out = []
  for (let skip = 0; ; skip += 100) {
    const r = await db.collection(COLL).skip(skip).limit(100).get()
    out.push(...r.data)
    if (r.data.length < 100) break
  }
  return out
}

function backup(rows, tag) {
  const dir = resolve(ROOT, 'backups/payslip-si', `${new Date().toISOString().replace(/[:.]/g, '-')}-${tag}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, `${COLL}.json`), JSON.stringify(rows, null, 2))
  return dir
}

/** 一张旧工资条按两种补法算出的新字段 */
function plan(row) {
  const paidMonth = SI.defaultPaidMonth(row.month)
  const std = SI.standardForMonth(paidMonth)
  if (!std) return { skip: `缴费月 ${paidMonth} 没有可用标准` }
  const monthly = SI.computeSocialInsurance({ standardId: std.id, paidMonth, includeAnnual: false })
  const annual = SI.computeSocialInsurance({ standardId: std.id, paidMonth, includeAnnual: true })
  if (!monthly.ok || !annual.ok) return { skip: monthly.msg || annual.msg }
  const oldDed = r2(row.deduction)
  const other = r2(oldDed - monthly.snapshot.personalTotal)
  if (!near(oldDed, monthly.snapshot.personalTotal)) {
    return { skip: `原扣款 ${oldDed.toFixed(2)} ≠ 标准月度个人合计 ${monthly.snapshot.personalTotal.toFixed(2)}，口径不明，不自动补` }
  }
  const gross = r2(row.gross != null ? row.gross : (Number(row.base) || 0) + (Number(row.bonus) || 0))
  const mk = (snap) => {
    const deduction = r2(other + snap.personalTotal)
    return { otherDeduction: other, deduction, net: r2(gross - deduction), socialInsurance: snap }
  }
  return { gross, oldDed, oldNet: r2(row.net), detailOnly: mk(monthly.snapshot), withAnnual: mk(annual.snapshot) }
}

function printPlan(rows) {
  const todo = []
  console.log(`\n${COLL} 共 ${rows.length} 张${ONLY ? `（仅 ${ONLY}）` : ''}\n`)
  for (const row of rows) {
    const who = `${row.staffName || '未命名'}（…${mask(row.staffOpenid)}）· ${row.month}`
    if (row.socialInsurance) { console.log(`· ${who}：已有社保快照，跳过`); continue }
    const p = plan(row)
    if (p.skip) { console.log(`· ${who}：跳过 —— ${p.skip}`); continue }
    todo.push({ row, p })
    const s = p.withAnnual.socialInsurance
    const per = s.personal.map((x) => `${x.name}${x.period} ${x.amount.toFixed(2)}`).join(' / ')
    console.log(`· ${who}`)
    console.log(`    现状：应发 ${p.gross.toFixed(2)}，扣款 ${p.oldDed.toFixed(2)}（未拆项），实发 ${p.oldNet.toFixed(2)}`)
    console.log(`    补法一「只补明细」：扣款 ${p.detailOnly.deduction.toFixed(2)}，实发 ${p.detailOnly.net.toFixed(2)}（金额不变）`)
    console.log(`    补法二「补扣大额医疗互助」：扣款 ${p.withAnnual.deduction.toFixed(2)}，实发 ${p.withAnnual.net.toFixed(2)}（实发 ${r2(p.withAnnual.net - p.oldNet).toFixed(2)}）`)
    console.log(`    个人明细（补法二）：${per}`)
    console.log(`    公司为你缴纳（只展示）：${s.company.map((x) => `${x.name} ${x.amount.toFixed(2)}`).join(' / ')}，合计 ${s.companyTotal.toFixed(2)}`)
  }
  return todo
}

async function main() {
  const db = openDb()
  if (MODE === 'rollback') {
    const dir = opt('--backup', '')
    const file = dir && resolve(ROOT, dir, `${COLL}.json`)
    if (!file || !existsSync(file)) throw new Error('须 --backup <本脚本 apply 前的备份目录>')
    const before = Object.fromEntries(JSON.parse(readFileSync(file, 'utf8')).map((r) => [r._id, r]))
    const mine = (await fetchAll(db)).filter((r) => r.siBackfillMark === MARK && before[r._id])
    console.log(`本批标记的工资条 ${mine.length} 张，将按备份还原 ${TOUCHED.join(' / ')}`)
    if (!has('--yes')) { console.log('未带 --yes：只列出，不执行'); return }
    const _ = db.command
    for (const r of mine) {
      const b = before[r._id]
      const data = { siBackfillMark: _.remove(), siBackfilledAt: _.remove() }
      for (const k of TOUCHED) data[k] = b[k] === undefined ? _.remove() : b[k]
      await db.collection(COLL).doc(r._id).update(data)
    }
    console.log('已还原')
    return
  }

  const all = await fetchAll(db)
  const rows = ONLY ? all.filter((r) => r.month === ONLY) : all
  const dir = backup(all, MODE === 'apply' ? 'before-apply' : 'dry-run')
  console.log(`已备份 ${all.length} 张到 ${dir.replace(ROOT + '/', '')}`)
  const todo = printPlan(rows)
  console.log(`\n可补 ${todo.length} 张。`)
  if (MODE === 'dry-run') { console.log('dry-run：未写库。'); return }

  if (!['detail-only', 'with-annual'].includes(FILL)) throw new Error('--apply 须带 --mode detail-only | with-annual')
  if (!has('--yes')) { console.log('未带 --yes：不执行'); return }
  for (const { row, p } of todo) {
    const next = FILL === 'with-annual' ? p.withAnnual : p.detailOnly
    await db.collection(COLL).doc(row._id).update({ ...next, siBackfillMark: MARK, siBackfilledAt: new Date() })
    const back = (await db.collection(COLL).doc(row._id).get()).data
    const got = Array.isArray(back) ? back[0] : back
    const ok = got && near(got.deduction, next.deduction) && near(got.net, next.net) && got.socialInsurance && got.socialInsurance.standardId === next.socialInsurance.standardId
    console.log(`${ok ? '✓' : '✗'} ${row.staffName} ${row.month}：扣款 ${got && got.deduction} / 实发 ${got && got.net}`)
    if (!ok) process.exitCode = 1
  }
  console.log(`回滚：node scripts/payslip-si-backfill.mjs --rollback --backup ${dir.replace(ROOT + '/', '')} --yes`)
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })
