#!/usr/bin/env node
/**
 * 已发工资条修正（2026-10-10 产品负责人点名）。**默认 dry-run（只读 + 本地全量备份），不写库。**
 * 口径：miniprogram/docs/工资条社保明细_2026-10-10.md
 *
 *   node scripts/payslip-si-backfill.mjs
 *        # dry-run：备份 staff_payslips 全量 → 列出「月份修正」状态 +「补明细」计划
 *   node scripts/payslip-si-backfill.mjs --apply-detail --yes
 *        # 补明细（产品负责人已授权）：给 2026-09 的已发工资条写入社保快照（三项个人 + 公司缴纳 + 大额医疗互助 8 月已扣说明）
 *        # 和 otherDeduction；**扣款 / 实发不写**。补完后的个人社保 + 其他扣款 ≠ 原扣款（即补明细会让金额变）→ 整批停下。
 *        # 可重复执行：已补过的跳过。写后逐张读回核对扣款 / 实发未变。
 *   node scripts/payslip-si-backfill.mjs --rollback-detail --backup <apply 前备份目录> [--yes]
 *        # 撤销补明细：删掉本脚本补写的 socialInsurance / otherDeduction / 标记（只动带本批标记、且备份里没有这些字段的）
 *   node scripts/payslip-si-backfill.mjs --apply-month --yes                                   # 月份修正（已于 2026-10-10 执行）
 *   node scripts/payslip-si-backfill.mjs --rollback-month --backup <apply 前备份目录> [--yes]  # 撤销月份修正
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLL = 'staff_payslips'
const FROM = '2026-10'
const TO = '2026-09'
const OLD_DEDUCTION = 452.5
const MONTH_MARK = '工资条月份修正·2026-10→2026-09'
const DETAIL_MARK = '社保明细补写·2026-10-10'
const DETAIL_FIELDS = ['socialInsurance', 'otherDeduction', 'siBackfillMark', 'siBackfilledAt']
const SI = require(resolve(ROOT, 'miniprogram/cloudfunctions/manageStaffWorkspace/socialInsurance.js'))

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const MODE = has('--apply-month') ? 'apply-month' : has('--rollback-month') ? 'rollback-month'
  : has('--apply-detail') ? 'apply-detail' : has('--rollback-detail') ? 'rollback-detail' : 'dry-run'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const near = (a, b) => Math.abs(r2(a) - r2(b)) < 0.005
const f2 = (n) => r2(n).toFixed(2)
const mask = (s) => { s = String(s || ''); return s.length <= 4 ? '**' : `${s.slice(0, 2)}…${s.slice(-2)}` }
const who = (row) => `${row.staffName || '未命名'}（…${mask(row.staffOpenid)}）`
const newIdOf = (row) => `${row.staffOpenid}_${TO}`

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

async function getDoc(db, id) {
  const r = await db.collection(COLL).doc(id).get()
  const d = Array.isArray(r.data) ? r.data[0] : r.data
  return d || null
}

function backup(rows, tag) {
  const dir = resolve(ROOT, 'backups/payslip-si', `${new Date().toISOString().replace(/[:.]/g, '-')}-${tag}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, `${COLL}.json`), JSON.stringify(rows, null, 2))
  return dir
}

const isTarget = (r) => r && r.month === FROM && !r.socialInsurance && near(r.deduction, OLD_DEDUCTION) && r._id === `${r.staffOpenid}_${FROM}`
const isMoved = (r) => r && r.month === TO && r.monthFixMark === MONTH_MARK

/** 除 _id / 月份 / 修正标记外，两张文档逐字段一致 */
function sameBody(a, b) {
  const skip = new Set(['_id', 'month', 'monthFixMark', 'monthFixedFrom', 'monthFixedAt'])
  const norm = (d) => JSON.stringify(Object.keys(d).filter((k) => !skip.has(k)).sort().map((k) => [k, d[k]]))
  return norm(a) === norm(b)
}

/** 月份修正计划：每张 → 待改 / 已改 / 冲突 */
function monthPlan(all) {
  const byId = Object.fromEntries(all.map((r) => [r._id, r]))
  const out = []
  for (const r of all.filter(isTarget)) {
    const nid = newIdOf(r)
    const clash = byId[nid] || all.find((x) => x._id !== r._id && x.staffOpenid === r.staffOpenid && x.month === TO)
    if (clash && !isMoved(clash)) out.push({ row: r, state: 'clash', why: `已有 ${TO} 工资条（${clash._id === nid ? '同 _id' : '同员工同月'}）` })
    else if (clash) out.push({ row: r, state: 'half', moved: clash })
    else out.push({ row: r, state: 'todo' })
  }
  for (const m of all.filter(isMoved)) {
    if (!out.some((x) => x.moved && x.moved._id === m._id)) out.push({ row: m, state: 'done' })
  }
  return out
}

/** 补明细计划：2026-09、没有社保快照的已发工资条 → 快照 + 其他扣款；扣款 / 实发不动 */
function detailPlan(all) {
  const out = []
  for (const r of all.filter((x) => x && x.month === TO)) {
    if (r.siBackfillMark === DETAIL_MARK) { out.push({ row: r, state: 'done' }); continue }
    if (r.socialInsurance) { out.push({ row: r, state: 'skip', why: '已有社保明细（不是本脚本写的）' }); continue }
    const c = SI.computeSocialInsurance({ payslipMonth: r.month })
    if (!c.ok) { out.push({ row: r, state: 'stop', why: c.msg }); continue }
    const snap = c.snapshot
    const other = r2(Number(r.deduction) - snap.personalTotal)
    const gross = r2(r.gross != null ? r.gross : (Number(r.base) || 0) + (Number(r.bonus) || 0))
    if (snap.annualIncluded) out.push({ row: r, state: 'stop', why: '会扣大额医疗互助，金额会变' })
    else if (!near(other, 0)) out.push({ row: r, state: 'stop', why: `原扣款 ${f2(r.deduction)} ≠ 月度个人社保 ${f2(snap.personalTotal)}，补明细会改变金额` })
    else if (!near(gross - Number(r.deduction), r.net)) out.push({ row: r, state: 'stop', why: `应发 − 扣款 ≠ 实发（${f2(gross)} − ${f2(r.deduction)} ≠ ${f2(r.net)}）` })
    else out.push({ row: r, state: 'todo', patch: { socialInsurance: snap, otherDeduction: 0 } })
  }
  return out
}

function printDryRun(all) {
  const mp = monthPlan(all)
  console.log(`\n${COLL} 共 ${all.length} 张`)
  console.log(`\n【一】月份修正 ${FROM} → ${TO}`)
  if (!mp.length) console.log('  没有符合范围的工资条')
  for (const x of mp) {
    const label = { todo: '待改', half: '上次中断（新文档已建、旧文档未删）', done: '已改过', clash: `冲突：${x.why}` }[x.state]
    console.log(`  · ${who(x.row)} → ${label}`)
  }
  const dp = detailPlan(all)
  console.log(`\n【二】补明细（${TO}，扣款 / 实发不动）`)
  if (!dp.length) console.log('  没有符合范围的工资条')
  for (const x of dp) {
    const r = x.row
    const head = `  · ${who(r)} 应发 ${f2(r.gross)}，扣款 ${f2(r.deduction)}，实发 ${f2(r.net)}`
    if (x.state !== 'todo') { console.log(`${head} → ${{ done: '已补过', skip: `跳过：${x.why}`, stop: `停：${x.why}` }[x.state]}`); continue }
    const s = x.patch.socialInsurance
    console.log(`${head} → 待补`)
    console.log(`      个人（从工资扣）：${s.personal.map((y) => `${y.name} ${f2(y.amount)}`).join(' + ')} = ${f2(s.personalTotal)}；其他扣款 0.00`)
    console.log(`      公司为你缴纳（不扣）：${s.company.map((y) => `${y.name} ${f2(y.amount)}`).join(' + ')} = ${f2(s.companyTotal)}`)
    console.log(`      说明：${s.info.map((y) => y.text).join('；')}`)
  }
  return { mp, dp }
}

async function applyDetail(db, all, dir) {
  const dp = detailPlan(all)
  const stop = dp.filter((x) => x.state === 'stop')
  if (stop.length) {
    stop.forEach((x) => console.error(`✗ ${who(x.row)}：${x.why}`))
    throw new Error('补明细会改变金额或口径不明，整批停下，未写库')
  }
  const work = dp.filter((x) => x.state === 'todo')
  console.log(`\n待补 ${work.length} 张，已补过 ${dp.filter((x) => x.state === 'done').length} 张`)
  if (!has('--yes')) { console.log('未带 --yes：不执行'); return }
  for (const x of work) {
    const r = x.row
    await db.collection(COLL).doc(r._id).update({ ...x.patch, siBackfillMark: DETAIL_MARK, siBackfilledAt: new Date() })
    const got = await getDoc(db, r._id)
    const ok = got && got.deduction === r.deduction && got.net === r.net && got.gross === r.gross && got.month === r.month &&
      got.siBackfillMark === DETAIL_MARK && got.socialInsurance && near(got.socialInsurance.personalTotal + got.otherDeduction, got.deduction)
    console.log(`${ok ? '✓' : '✗'} ${who(r)}：扣款 ${got && got.deduction} / 实发 ${got && got.net}（未变），个人社保 ${got && got.socialInsurance && got.socialInsurance.personalTotal}，公司缴纳 ${got && got.socialInsurance && got.socialInsurance.companyTotal}`)
    if (!ok) process.exitCode = 1
  }
  console.log(`回滚：node scripts/payslip-si-backfill.mjs --rollback-detail --backup ${dir.replace(ROOT + '/', '')} --yes`)
}

async function rollbackDetail(db, all) {
  const dir = opt('--backup', '')
  const file = dir && resolve(ROOT, dir, `${COLL}.json`)
  if (!file || !existsSync(file)) throw new Error('须 --backup <--apply-detail 前的备份目录>')
  const before = Object.fromEntries(JSON.parse(readFileSync(file, 'utf8')).map((r) => [r._id, r]))
  const mine = all.filter((r) => r.siBackfillMark === DETAIL_MARK && before[r._id] && DETAIL_FIELDS.every((k) => !(k in before[r._id])))
  console.log(`本脚本补过明细的工资条 ${mine.length} 张，将删掉 ${DETAIL_FIELDS.join(' / ')}`)
  if (!has('--yes')) { console.log('未带 --yes：只列出，不执行'); return }
  const _ = db.command
  for (const r of mine) {
    await db.collection(COLL).doc(r._id).update(Object.fromEntries(DETAIL_FIELDS.map((k) => [k, _.remove()])))
    const got = await getDoc(db, r._id)
    const ok = got && DETAIL_FIELDS.every((k) => !(k in got)) && got.deduction === r.deduction && got.net === r.net
    console.log(`${ok ? '✓' : '✗'} ${who(r)}：已撤销补明细`)
    if (!ok) process.exitCode = 1
  }
}

async function applyMonth(db, all, dir) {
  const mp = monthPlan(all)
  const clash = mp.filter((x) => x.state === 'clash')
  if (clash.length) {
    clash.forEach((x) => console.error(`✗ ${who(x.row)}：${x.why}`))
    throw new Error('存在冲突，整批停下，未写库')
  }
  const work = mp.filter((x) => x.state === 'todo' || x.state === 'half')
  console.log(`\n待改 ${work.length} 张，已改过 ${mp.filter((x) => x.state === 'done').length} 张`)
  if (!has('--yes')) { console.log('未带 --yes：不执行'); return }
  for (const x of work) {
    const old = x.row
    const nid = newIdOf(old)
    if (x.state === 'todo') {
      const { _id, ...body } = old
      await db.collection(COLL).doc(nid).set({ ...body, month: TO, monthFixMark: MONTH_MARK, monthFixedFrom: old._id, monthFixedAt: new Date() })
    }
    const got = await getDoc(db, nid)
    if (!got || got.month !== TO || got.monthFixMark !== MONTH_MARK || !sameBody(got, old)) {
      console.error(`✗ ${who(old)}：新文档读回不一致，旧文档保留不删`)
      process.exitCode = 1
      continue
    }
    await db.collection(COLL).doc(old._id).remove()
    const gone = !(await getDoc(db, old._id).catch(() => null))
    console.log(`${gone ? '✓' : '✗'} ${who(old)}：${FROM} → ${TO}；扣款 ${got.deduction} / 实发 ${got.net}（未动）`)
    if (!gone) process.exitCode = 1
  }
  console.log(`回滚：node scripts/payslip-si-backfill.mjs --rollback-month --backup ${dir.replace(ROOT + '/', '')} --yes`)
}

async function rollbackMonth(db, all) {
  const dir = opt('--backup', '')
  const file = dir && resolve(ROOT, dir, `${COLL}.json`)
  if (!file || !existsSync(file)) throw new Error('须 --backup <--apply-month 前的备份目录>')
  const before = Object.fromEntries(JSON.parse(readFileSync(file, 'utf8')).map((r) => [r._id, r]))
  const mine = all.filter((r) => isMoved(r) && before[r.monthFixedFrom])
  console.log(`本脚本改过月份的工资条 ${mine.length} 张，将改回 ${FROM}`)
  if (!has('--yes')) { console.log('未带 --yes：只列出，不执行'); return }
  for (const m of mine) {
    const oldId = m.monthFixedFrom
    const { _id, monthFixMark, monthFixedFrom, monthFixedAt, ...body } = m
    await db.collection(COLL).doc(oldId).set({ ...body, month: FROM })
    const got = await getDoc(db, oldId)
    if (!got || got.month !== FROM || !sameBody(got, m)) {
      console.error(`✗ ${who(m)}：旧 _id 读回不一致，新文档保留不删`)
      process.exitCode = 1
      continue
    }
    await db.collection(COLL).doc(m._id).remove()
    console.log(`✓ ${who(m)}：已改回 ${FROM}`)
  }
}

async function main() {
  const db = openDb()
  const all = await fetchAll(db)
  const dir = backup(all, MODE === 'dry-run' ? 'dry-run' : `before-${MODE}`)
  console.log(`已备份 ${all.length} 张到 ${dir.replace(ROOT + '/', '')}`)
  if (MODE === 'rollback-month') return rollbackMonth(db, all)
  if (MODE === 'rollback-detail') return rollbackDetail(db, all)
  printDryRun(all)
  if (MODE === 'dry-run') { console.log('\ndry-run：未写库。'); return }
  if (MODE === 'apply-detail') return applyDetail(db, all, dir)
  await applyMonth(db, all, dir)
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })
