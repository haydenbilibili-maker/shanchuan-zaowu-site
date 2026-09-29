/**
 * 财务日账 · 产品负责人 2026-09-29 拍板的生产数据修正（**默认只读演练，需显式 --apply**）
 *
 *   step1 8 天主/旧编号并存（旧主店 id store_1780146782017_6w0okpr）：保留主编号行，把旧编号行的
 *         订单数与原文补进主编号行（store_ledger + finance_records），再删旧编号行
 *   step2 2025-11-22：以原文「银联POS收款:8903.5元」为准修正主编号 POS，联动合计
 *         （store_ledger + finance_records + daily_revenues 同日副本）
 *   step3 未登记编号 store_1780160394767_szo1k77 / store_1780841157244_p48w0bx 的 8 条改成主编号
 *         （改前确认三集合同日无山川归属的记录）
 *   step4 2026-09-26 山川 POS 9812.6 → 原文 9773.60，联动合计与三集合副本
 *
 * 安全设计
 *   · 前置条件逐条核对（当前值必须等于取证时的值），任何一条不符整体中止，一条不写；
 *   · --apply 先写三集合全量快照 + 每步「改前文档」备份（backups/finance-dedupe/，.gitignore 覆盖，不在发布目录），
 *     备份写失败即中止；写前按 _id 重读，内容与计划时不同即中止；
 *   · 被改行 _updateTime 取当前时间：ERP 本地旧缓存（旧值、旧时间戳）回推时按时间戳输给修正后的云端行；
 *   · 审计：每条变更的改前/改后字段 + 各月合计落 backups/finance-dedupe/fix-audit-<时间>.json；
 *   · 恢复：--restore <备份文件>，按原 _id 整条覆盖写回（被删的重建、被改的还原）。
 *
 * 用法：
 *   node scripts/finance-fix-decisions.mjs                    # 只读演练：变更清单 + 各月合计前后
 *   node scripts/finance-fix-decisions.mjs --apply            # 备份后执行
 *   node scripts/finance-fix-decisions.mjs --restore <file>   # 按备份整条写回
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalLedgerStoreId, ledgerDateOf } from '../admin/src/utils/financeDuplicateCheck.js'
import { parseDailyFinanceText } from '../admin/src/utils/financeDailyParse.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const BACKUP_DIR = resolve(ROOT, 'backups/finance-dedupe')
const COLLECTIONS = ['store_ledger', 'finance_records', 'daily_revenues']
const require = createRequire(import.meta.url)

const MAIN = 'store_shanhaizaowu'
const OLD = 'store_1780146782017_6w0okpr'
const UNKNOWN = ['store_1780160394767_szo1k77', 'store_1780841157244_p48w0bx']
const PAIR_DATES = ['2025-11-20', '2025-11-21', '2025-11-22', '2025-11-23', '2025-11-24', '2026-05-22', '2026-05-23', '2026-05-26']
const D1122 = '2025-11-22'
const D0926 = '2026-09-26'

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
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')
const fmtYuan = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })
const rowRevenue = (r) => Number(r.revenue ?? r.netAmount ?? r.total ?? 0) || 0

class Abort extends Error {}
function need(cond, msg) { if (!cond) throw new Abort(msg) }

/** 某集合某日按归属后门店 = 山川造物的行 */
const mainRowsOn = (rows, date) => rows.filter((r) => ledgerDateOf(r) === date && canonicalLedgerStoreId(r) === MAIN)

/* ------------------------------------------ 计划 ------------------------------------------ */
function buildPlan(data, NOW) {
  const changes = [] // { step, col, _id, op: 'update'|'remove', before, patch }
  const upd = (step, col, doc, patch) => {
    const prev = changes.find((c) => c.col === col && c._id === doc._id && c.op === 'update')
    if (prev) { Object.assign(prev.patch, patch); if (!prev.steps.includes(step)) prev.steps.push(step); return }
    changes.push({ step, steps: [step], col, _id: doc._id, op: 'update', before: doc, patch: { ...patch } })
  }
  const del = (step, col, doc) => changes.push({ step, steps: [step], col, _id: doc._id, op: 'remove', before: doc, patch: null })
  const stamps = (col) => (col === 'daily_revenues' ? { updateTime: NOW } : { _updateTime: NOW, syncedAt: NOW })

  // step1 + step2（11-22 的主编号行两步合成一次写）
  for (const date of PAIR_DATES) {
    for (const col of ['store_ledger', 'finance_records']) {
      const rows = data[col].filter((r) => ledgerDateOf(r) === date)
      const main = rows.filter((r) => String(r.storeId || '') === MAIN)
      const alias = rows.filter((r) => String(r.storeId || '') === OLD)
      need(main.length === 1 && alias.length === 1, `${col} ${date}：应有主编号 1 条 + 旧编号 1 条，实际 ${main.length} + ${alias.length}`)
      const m = main[0]
      const a = alias[0]
      need(!(Number(m.orderCount) > 0), `${col} ${date}：主编号行已有订单数 ${m.orderCount}，与取证不符`)
      need(!String(m.raw || '').trim(), `${col} ${date}：主编号行已有原文，与取证不符`)
      need(Number(a.orderCount) > 0 && String(a.raw || '').trim(), `${col} ${date}：旧编号行缺订单数或原文`)
      let revenue = rowRevenue(m)
      const patch = { orderCount: Number(a.orderCount), raw: a.raw, ...stamps(col) }
      if ('remark' in m) patch.remark = String(m.remark || '').trim() ? m.remark : a.raw
      if (date === D1122) {
        const parsed = parseDailyFinanceText(a.raw)
        need(parsed.ok && near(parsed.pos, 8903.5) && near(parsed.online, 180), `${col} ${date}：旧编号原文解析不是 POS 8903.5 / 线上 180`)
        need(near(revenue, 9100.5), `${col} ${date}：主编号合计应为 9100.5，实际 ${revenue}`)
        // 渠道以 finance_records 主编号行为准（store_ledger 主编号行只存了合计）：POS 8898.5 → 8903.5，线上 180、现金收入 22、退款 0 不变
        const frMain = data.finance_records.find((r) => ledgerDateOf(r) === date && String(r.storeId || '') === MAIN)
        need(frMain && near(frMain.pos, 8898.5) && near(frMain.online, 180) && near(frMain.cash, 22) && near(frMain.refund || 0, 0), `${date}：finance_records 主编号渠道与取证不符`)
        const pos = 8903.5
        revenue = round2(pos + 180 + 22 - 0)
        Object.assign(patch, { pos, online: 180, cash: 22, cashIncome: 22, refund: 0, revenue })
        if ('grossAmount' in m) patch.grossAmount = revenue
        if ('netAmount' in m) patch.netAmount = revenue
        if ('refundAmount' in m) patch.refundAmount = 0
      }
      patch.avgOrderPrice = round2(revenue / Number(a.orderCount))
      patch.customerPrice = patch.avgOrderPrice
      upd(date === D1122 ? 'step1+step2' : 'step1', col, m, patch)
      del('step1', col, a)
    }
  }
  // step2：daily_revenues 11-22 同日副本
  const dr1122 = mainRowsOn(data.daily_revenues, D1122)
  need(dr1122.length === 1 && near(dr1122[0].pos, 8898.5) && near(dr1122[0].total, 9100.5), `daily_revenues ${D1122}：应有 1 条 POS 8898.5 / 合计 9100.5`)
  upd('step2', 'daily_revenues', dr1122[0], { pos: 8903.5, total: 9105.5, totalFmt: '9,105.5', updateTime: new Date(NOW).toISOString() })

  // step3：未登记编号 → 主编号
  for (const col of ['store_ledger', 'finance_records']) {
    const rows = data[col].filter((r) => UNKNOWN.includes(String(r.storeId || '')))
    need(rows.length === 8, `${col}：未登记编号应有 8 条，实际 ${rows.length}`)
    for (const r of rows) {
      const d = ledgerDateOf(r)
      for (const c of COLLECTIONS) {
        const clash = data[c].filter((x) => ledgerDateOf(x) === d && x._id !== r._id && !UNKNOWN.includes(String(x.storeId || '')) && canonicalLedgerStoreId(x) === MAIN)
        need(clash.length === 0, `${d}：${c} 已有山川归属记录 ${clash.map((x) => x._id).join(',')}，不能直接改编号`)
      }
      upd('step3', col, r, { storeId: MAIN, ...stamps(col) })
    }
  }

  // step4：9/26
  for (const col of COLLECTIONS) {
    const rows = mainRowsOn(data[col], D0926)
    need(rows.length === 1, `${col} ${D0926}：山川应有 1 条，实际 ${rows.length}`)
    const r = rows[0]
    need(near(r.pos, 9812.6) && near(rowRevenue(r), 9812.6), `${col} ${D0926}：当前 POS/合计应为 9812.6，实际 ${r.pos}/${rowRevenue(r)}`)
    need(!(Number(r.online) || Number(r.refund) || Number(r.cashIncome ?? r.cash)), `${col} ${D0926}：线上/退款/现金收入非 0，合计不能直接等于 POS`)
    if (col !== 'daily_revenues') {
      const parsed = parseDailyFinanceText(String(r.raw || ''))
      need(parsed.ok && near(parsed.pos, 9773.6), `${col} ${D0926}：原文解析不是 9773.6`)
    }
    const patch = col === 'daily_revenues'
      ? { pos: 9773.6, total: 9773.6, updateTime: NOW }
      : { pos: 9773.6, revenue: 9773.6, ...stamps(col) }
    if ('grossAmount' in r) patch.grossAmount = 9773.6
    if ('netAmount' in r) patch.netAmount = 9773.6
    if ('totalFmt' in r) patch.totalFmt = '9,773.6'
    upd('step4', col, r, patch)
  }
  return changes
}

/** 应用计划到内存副本（演练用 / 核对用） */
function project(data, changes) {
  const out = Object.fromEntries(COLLECTIONS.map((c) => [c, data[c].map((r) => ({ ...r }))]))
  for (const ch of changes) {
    if (ch.op === 'remove') out[ch.col] = out[ch.col].filter((r) => r._id !== ch._id)
    else { const r = out[ch.col].find((x) => x._id === ch._id); Object.assign(r, ch.patch) }
  }
  return out
}

/** 月合计：逐行求和（云端原样）+ 归属后同店同日只计一行（ERP 修复后的展示口径） */
function monthTotals(rows, months) {
  const out = {}
  for (const ym of months) {
    const inMonth = rows.filter((r) => ledgerDateOf(r).startsWith(ym))
    const raw = round2(inMonth.reduce((s, r) => s + rowRevenue(r), 0))
    const byKey = new Map()
    for (const r of inMonth) {
      const k = `${canonicalLedgerStoreId(r)}|${ledgerDateOf(r)}`
      const prev = byKey.get(k)
      if (!prev || (Number(r._updateTime) || 0) > (Number(prev._updateTime) || 0)) byKey.set(k, r)
    }
    const attributed = round2([...byKey.values()].reduce((s, r) => s + rowRevenue(r), 0))
    out[ym] = { rows: inMonth.length, raw, attributed, keys: byKey.size }
  }
  return out
}

const MONTHS = ['2025-11', '2026-05', '2026-06', '2026-09']

function printTotals(label, before, after) {
  console.log(`\n${label}（逐行求和 = 云端原样；归属去重 = 同店同日只计一行）`)
  for (const ym of MONTHS) {
    const b = before[ym]
    const a = after[ym]
    console.log(`  ${ym}  逐行 ¥${fmtYuan(b.raw)}（${b.rows} 行） → ¥${fmtYuan(a.raw)}（${a.rows} 行）   归属去重 ¥${fmtYuan(b.attributed)} → ¥${fmtYuan(a.attributed)}`)
  }
}

/* ------------------------------------------ 恢复 ------------------------------------------ */
async function restore(file) {
  const payload = JSON.parse(readFileSync(resolve(ROOT, file), 'utf8'))
  const docs = payload.docs || []
  let n = 0
  for (const { col, doc } of docs) {
    const { _id, ...rest } = doc
    await db.collection(col).doc(_id).set(rest)
    n++
  }
  console.log(`✓ 恢复完成：按原 _id 整条写回 ${n} 条（${file}）`)
}

/* ------------------------------------------ 主流程 ------------------------------------------ */
async function main() {
  if (RESTORE) return restore(RESTORE)
  const data = {}
  for (const c of COLLECTIONS) data[c] = await fetchAll(c)
  const NOW = Date.now()
  let changes
  try {
    changes = buildPlan(data, NOW)
  } catch (e) {
    if (e instanceof Abort) { console.error(`✗ 前置条件不符，整体中止（一条未写）：${e.message}`); process.exit(1) }
    throw e
  }
  const after = project(data, changes)
  console.log(`计划：${changes.filter((c) => c.op === 'update').length} 条修改 + ${changes.filter((c) => c.op === 'remove').length} 条删除`)
  for (const ch of changes) {
    const d = ledgerDateOf(ch.before)
    const desc = ch.op === 'remove'
      ? `删除（旧编号 ${ch.before.storeId}，营收 ${rowRevenue(ch.before)}，订单 ${ch.before.orderCount}）`
      : Object.entries(ch.patch).filter(([k]) => !['_updateTime', 'syncedAt', 'updateTime', 'raw', 'remark'].includes(k))
        .map(([k, v]) => `${k} ${JSON.stringify(ch.before[k])}→${JSON.stringify(v)}`).join('，') + (ch.patch.raw ? '，补原文' : '')
    console.log(`  [${ch.steps.join('+')}] ${d} ${ch.col.padEnd(15)} ${ch._id} ${desc}`)
  }
  const tBefore = { store_ledger: monthTotals(data.store_ledger, MONTHS), finance_records: monthTotals(data.finance_records, MONTHS) }
  const tAfter = { store_ledger: monthTotals(after.store_ledger, MONTHS), finance_records: monthTotals(after.finance_records, MONTHS) }
  printTotals('store_ledger 各月合计', tBefore.store_ledger, tAfter.store_ledger)
  printTotals('finance_records 各月合计', tBefore.finance_records, tAfter.finance_records)

  if (!APPLY) { console.log('\n（只读演练，未写入；确认后加 --apply）'); return }

  mkdirSync(BACKUP_DIR, { recursive: true })
  const ts = stamp()
  const snapshotFile = resolve(BACKUP_DIR, `fix-snapshot-${ts}.json`)
  writeFileSync(snapshotFile, JSON.stringify({ at: new Date(NOW).toISOString(), data }, null, 2))
  const stepFiles = {}
  for (const step of ['step1', 'step2', 'step3', 'step4']) {
    const docs = changes.filter((c) => c.steps.some((s) => s.split('+').includes(step))).map((c) => ({ col: c.col, doc: c.before }))
    const f = resolve(BACKUP_DIR, `fix-before-${step}-${ts}.json`)
    writeFileSync(f, JSON.stringify({ at: new Date(NOW).toISOString(), step, docs }, null, 2))
    stepFiles[step] = f
  }
  const allBeforeFile = resolve(BACKUP_DIR, `fix-before-all-${ts}.json`)
  writeFileSync(allBeforeFile, JSON.stringify({ at: new Date(NOW).toISOString(), docs: changes.map((c) => ({ col: c.col, doc: c.before })) }, null, 2))
  console.log(`\n✓ 备份：${snapshotFile}\n  改前文档（全部）：${allBeforeFile}`)

  // 写前重读：与计划时一字不差才写
  for (const ch of changes) {
    const { data: cur } = await db.collection(ch.col).doc(ch._id).get()
    const doc = Array.isArray(cur) ? cur[0] : cur
    if (!doc || JSON.stringify(doc) !== JSON.stringify(ch.before)) {
      console.error(`✗ ${ch.col} ${ch._id} 在计划后被改动，整体中止（一条未写）`)
      process.exit(1)
    }
  }
  const done = []
  for (const ch of changes) {
    if (ch.op === 'remove') await db.collection(ch.col).doc(ch._id).remove()
    else await db.collection(ch.col).doc(ch._id).update(ch.patch)
    done.push({ steps: ch.steps, col: ch.col, _id: ch._id, op: ch.op, date: ledgerDateOf(ch.before), before: ch.op === 'remove' ? ch.before : Object.fromEntries(Object.keys(ch.patch).map((k) => [k, ch.before[k] ?? null])), after: ch.patch })
  }
  const reread = {}
  for (const c of COLLECTIONS) reread[c] = await fetchAll(c)
  const tActual = { store_ledger: monthTotals(reread.store_ledger, MONTHS), finance_records: monthTotals(reread.finance_records, MONTHS) }
  const auditFile = resolve(BACKUP_DIR, `fix-audit-${ts}.json`)
  writeFileSync(auditFile, JSON.stringify({
    at: new Date(NOW).toISOString(),
    operator: 'scripts/finance-fix-decisions.mjs（产品负责人 2026-09-29 拍板 1–4）',
    backups: { snapshot: snapshotFile, allBefore: allBeforeFile, ...stepFiles },
    changes: done,
    totals: { before: tBefore, projected: tAfter, actual: tActual },
  }, null, 2))
  printTotals('执行后重读 store_ledger', tBefore.store_ledger, tActual.store_ledger)
  printTotals('执行后重读 finance_records', tBefore.finance_records, tActual.finance_records)
  console.log(`\n✓ 已执行 ${done.length} 条；审计：${auditFile}`)
  console.log(`恢复：node scripts/finance-fix-decisions.mjs --restore ${allBeforeFile.replace(ROOT + '/', '')}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
