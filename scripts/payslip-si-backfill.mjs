#!/usr/bin/env node
/**
 * 已发工资条修正（2026-10-10 产品负责人点名）。**默认 dry-run（只读 + 本地全量备份），不写库。**
 * 口径：miniprogram/docs/工资条社保明细_2026-10-10.md
 *
 *   node scripts/payslip-si-backfill.mjs
 *        # dry-run：备份 staff_payslips 全量 → 列出「月份修正」计划 + 两种金额处理的前后对比（含对 10 月工资条的影响）
 *   node scripts/payslip-si-backfill.mjs --apply-month --yes
 *        # 月份修正（产品负责人已授权）：工资条 2026-10 → 2026-09。文档 _id = openid_月份，所以是「按新 _id 建一张、读回逐字段核对、再删旧的」；
 *        # 只动月份，金额 / 明细不动。可重复执行：已改过的跳过；新 _id 已被别的工资条占用 → 整批停下。
 *   node scripts/payslip-si-backfill.mjs --rollback-month --backup <apply 前备份目录> [--yes]
 *        # 撤销月份修正：按新文档原样建回旧 _id（月份改回）、删掉新文档；只动本脚本标记过的
 *
 * 金额处理（方案① 保持 452.50 + 医疗 10 月预扣；方案② 改为 364.64、10 月补发 87.86）**只预演、不写库**，等产品负责人选定。
 * 范围：月份 = 2026-10、没有社保快照、扣款 = 452.50 的工资条；其余只列出不动。
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
const SI = require(resolve(ROOT, 'miniprogram/cloudfunctions/manageStaffWorkspace/socialInsurance.js'))

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const MODE = has('--apply-month') ? 'apply-month' : has('--rollback-month') ? 'rollback-month' : 'dry-run'

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

/** 两种金额处理（只预演）：9 月这张 + 对 10 月工资条的影响 */
function amountPlans(row) {
  const gross = r2(row.gross != null ? row.gross : (Number(row.base) || 0) + (Number(row.bonus) || 0))
  const oldDed = r2(row.deduction)
  const sep1 = SI.computeSocialInsurance({ payslipMonth: TO, advance: [{ key: 'medical', period: '2026-10' }] })
  const sep2 = SI.computeSocialInsurance({ payslipMonth: TO })
  if (!sep1.ok || !sep2.ok) return { skip: sep1.msg || sep2.msg }
  const s1 = sep1.snapshot
  const s2 = sep2.snapshot
  const other1 = r2(oldDed - s1.personalTotal)
  const other2 = r2(oldDed - s1.personalTotal)
  const oct1 = SI.computeSocialInsurance({ payslipMonth: '2026-10', charged: SI.chargedFromSnapshots([{ month: TO, socialInsurance: s1 }]) }).snapshot
  const oct2 = SI.computeSocialInsurance({ payslipMonth: '2026-10', charged: SI.chargedFromSnapshots([{ month: TO, socialInsurance: s2 }]) }).snapshot
  return {
    gross,
    oldDed,
    oldNet: r2(row.net),
    plan1: { otherDeduction: other1, deduction: r2(other1 + s1.personalTotal), net: r2(gross - other1 - s1.personalTotal), si: s1, oct: oct1 },
    plan2: { otherDeduction: other2, deduction: r2(other2 + s2.personalTotal), net: r2(gross - other2 - s2.personalTotal), si: s2, oct: oct2, topUp: r2(s1.personalTotal - s2.personalTotal) }
  }
}

function lines(si) {
  const tag = (x) => (x.advance ? '·预扣' : x.refPeriod ? `·参考上期${x.refPeriod}` : '')
  return {
    p: si.personal.map((x) => `${x.name}(${x.period}${tag(x)}) ${f2(x.amount)}`).join(' + '),
    c: si.company.map((x) => `${x.name} ${f2(x.amount)}`).join(' + '),
    i: si.info.filter((x) => x.kind !== 'missing').map((x) => x.text).join('；')
  }
}

function printDryRun(all) {
  const mp = monthPlan(all)
  console.log(`\n${COLL} 共 ${all.length} 张`)
  console.log(`\n【一】月份修正 ${FROM} → ${TO}（已授权，--apply-month 写入）`)
  if (!mp.length) console.log('  没有符合范围的工资条')
  for (const x of mp) {
    const label = { todo: '待改', half: '上次中断（新文档已建、旧文档未删）', done: '已改过', clash: `冲突，整批不会执行：${x.why}` }[x.state]
    console.log(`  · ${who(x.row)} ${x.row._id.replace(x.row.staffOpenid, '…' + mask(x.row.staffOpenid))} → ${label}`)
  }
  console.log(`\n【二】金额处理（只预演，不写库；以修正后月份 ${TO} 计）`)
  for (const x of mp.filter((y) => y.state !== 'clash')) {
    const row = x.state === 'done' ? x.row : x.row
    const a = amountPlans(row)
    if (a.skip) { console.log(`  · ${who(row)}：跳过 —— ${a.skip}`); continue }
    const l1 = lines(a.plan1.si)
    const l2 = lines(a.plan2.si)
    console.log(`\n  · ${who(row)}  现状：应发 ${f2(a.gross)}，扣款 ${f2(a.oldDed)}（未拆项），实发 ${f2(a.oldNet)}`)
    console.log(`    方案①（建议）9 月：扣款 ${f2(a.plan1.deduction)}，实发 ${f2(a.plan1.net)}（实发不变）`)
    console.log(`        个人：${l1.p}`)
    console.log(`        说明：${l1.i}`)
    console.log(`        10 月工资条将扣：${f2(a.plan1.oct.personalTotal)}（${lines(a.plan1.oct).p}；${lines(a.plan1.oct).i}）`)
    console.log(`    方案② 9 月：扣款 ${f2(a.plan2.deduction)}，实发 ${f2(a.plan2.net)}（实发 +${f2(a.plan2.net - a.oldNet)}，已发少了这么多 → 10 月补发 ${f2(a.plan2.topUp)}）`)
    console.log(`        个人：${l2.p}`)
    console.log(`        10 月工资条将扣：${f2(a.plan2.oct.personalTotal)}（${lines(a.plan2.oct).p}），另补发 ${f2(a.plan2.topUp)}`)
    console.log(`    两方案 9 月公司缴纳（只展示）：${l1.c}，合计 ${f2(a.plan1.si.companyTotal)}`)
  }
  return mp
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
  printDryRun(all)
  if (MODE === 'dry-run') { console.log('\ndry-run：未写库。'); return }
  await applyMonth(db, all, dir)
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })
