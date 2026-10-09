#!/usr/bin/env node
/**
 * 9-24 重复录入的 10 张正式出货单 → 作废（产品负责人 2026-10-09 拍板）。**默认 dry-run**。
 * 口径：miniprogram/docs/出货中心首批SKU导入_2026-10-09.md §12
 *
 *   node scripts/void-duplicate-shipments-0924.mjs                    # dry-run：逐张核对前置状态 + 统计前后预估（只读）
 *   node scripts/void-duplicate-shipments-0924.mjs --apply            # 备份 ops_shipments 全量 → 逐张作废 → 读回核对
 *   node scripts/void-duplicate-shipments-0924.mjs --rollback --backup <备份目录> [--yes]
 *        # 按备份还原本脚本改过的五个字段；不带 --yes 只列出
 *
 * 「作废」用系统现有路径（manageStoreShipment.handleSetStatus 写的字段，且该路径不发任何通知）：
 *   status:'cancelled' + statusLabel:'已取消' + updatedAt + updatedBy；作废原因写进已有的 note（前置，原备注保留）。
 * 不删除（deleted 不动），金额 / 明细 / 门店 / 结算字段一律不动。
 * 前置条件（任何一张不满足就整体停下）：存在、未删、门店对得上、已确认、未结算、无账单、未标已付款。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLL = 'ops_shipments'
const REASON = '【作废】9-24 重复录入，保留 15:47 完整单，产品负责人 2026-10-09 确认'
const MARK = '产品负责人2026-10-09·9-24重复单作废'
const FIELDS = ['status', 'statusLabel', 'updatedAt', 'updatedBy', 'note']
const TARGETS = {
  山川造物: ['SH202609244916', 'SH202609245858', 'SH202609247114', 'SH202609241878', 'SH202609245829'],
  星宸标本: ['SH202609241103', 'SH202609245140', 'SH202609241603', 'SH202609248153', 'SH202609249690']
}
const KEEP = ['SH202609247221', 'SH202609248934']
const { canTransit, STATUS_LABEL } = require(resolve(ROOT, 'miniprogram/cloudfunctions/manageStoreShipment/shipmentDefaults.js'))
const { computeSettlementKpis } = require(resolve(ROOT, 'miniprogram/cloudfunctions/getStudioDashboard/settlementKpis.js'))

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const MODE = has('--apply') ? 'apply' : has('--rollback') ? 'rollback' : 'dry-run'

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

const active = (rows) => rows.filter((s) => s.deleted !== true && s.status !== 'cancelled')
const kpi = (rows) => {
  const a = active(rows)
  const k = computeSettlementKpis(a)
  return `笔数 ${a.length} · 出货额 ¥${k.shippedAmount} · 已结清 ¥${k.settledAmount} · 未收款 ¥${k.outstandingAmount}（${k.outstandingCount} 张）`
}

function precheck(s, store) {
  const why = []
  if (!s) return ['找不到']
  if (s.deleted === true) why.push('已删除')
  if ((s.storeName || '') !== store) why.push(`门店是「${s.storeName}」`)
  if (s.status !== 'confirmed') why.push(`状态是「${s.status}」`)
  if (s.settleStatus && s.settleStatus !== 'unsettled') why.push(`结算状态是「${s.settleStatus}」`)
  if (s.billId) why.push(`已在账单 ${s.billNo || s.billId}`)
  if (s.paidMarkedAt) why.push('已标已付款')
  if (String(s.shipmentDate || '') !== '2026-09-24') why.push(`出货日期是 ${s.shipmentDate}`)
  if (!canTransit(s.status, 'cancelled')) why.push('现有流程不允许改为已取消')
  return why
}

async function main() {
  const db = openDb()
  if (MODE === 'rollback') {
    const dir = opt('--backup', '')
    if (!dir || !existsSync(resolve(ROOT, dir, `${COLL}.json`))) throw new Error('须 --backup <本脚本 apply 前的备份目录>')
    const before = JSON.parse(readFileSync(resolve(ROOT, dir, `${COLL}.json`), 'utf8'))
    const byId = Object.fromEntries(before.map((r) => [r._id, r]))
    const mine = (await fetchAll(db)).filter((s) => s.updatedBy === MARK && s.status === 'cancelled' && byId[s._id])
    console.log(`本批作废（updatedBy=${MARK}）的单 ${mine.length} 张，将按备份还原 ${FIELDS.join(' / ')}`)
    mine.forEach((s) => console.log(`  · ${s.storeName} ${s.shipmentNo}`))
    if (!has('--yes')) { console.log('未带 --yes：只列出，不执行'); return }
    const _ = db.command
    for (const s of mine) {
      const prev = byId[s._id]
      const patch = {}
      FIELDS.forEach((k) => { patch[k] = Object.prototype.hasOwnProperty.call(prev, k) ? prev[k] : _.remove() })
      await db.collection(COLL).doc(s._id).update(patch)
    }
    console.log(`已还原 ${mine.length} 张`)
    return
  }

  const rows = await fetchAll(db)
  const byNo = {}
  rows.forEach((s) => { (byNo[s.shipmentNo] = byNo[s.shipmentNo] || []).push(s) })
  const target = []
  let blocked = 0
  let done = 0
  for (const [store, nos] of Object.entries(TARGETS)) {
    for (const no of nos) {
      const hits = byNo[no] || []
      if (hits.length !== 1) { blocked++; console.log(`✗ ${store} ${no}：单号命中 ${hits.length} 条`); continue }
      const s = hits[0]
      if (s.status === 'cancelled' && s.updatedBy === MARK) { done++; console.log(`· ${store} ${no}：已作废过（跳过）`); continue }
      const why = precheck(s, store)
      if (why.length) { blocked++; console.log(`✗ ${store} ${no}：${why.join('、')}`); continue }
      target.push(s)
      console.log(`✓ ${store} ${no} ¥${s.totalAmount} · ${(s.items || []).length} 行 · 已确认 / 未结算 / 无账单 / 未付款 · 备注「${s.note || ''}」`)
    }
  }
  for (const no of KEEP) {
    const hits = byNo[no] || []
    const s = hits[0]
    if (hits.length !== 1 || s.deleted === true || s.status === 'cancelled') { blocked++; console.log(`✗ 保留单 ${no} 不在正常状态`) }
    else console.log(`保留 ${s.storeName} ${no} ¥${s.totalAmount}（${s.status}）`)
  }
  if (blocked) { console.log(`\n${blocked} 张前置条件不满足，整体停下，未写库`); process.exit(2) }
  const sum = Math.round(target.reduce((n, s) => n + (Number(s.totalAmount) || 0), 0) * 100) / 100
  console.log(`\n待作废 ${target.length} 张（已作废过 ${done} 张），金额合计 ¥${sum}`)

  const now = Date.now()
  const patchOf = (s) => ({
    status: 'cancelled',
    statusLabel: STATUS_LABEL.cancelled,
    updatedAt: now,
    updatedBy: MARK,
    note: s.note ? `${REASON}｜${s.note}` : REASON
  })
  const ids = new Set(target.map((s) => s._id))
  console.log(`统计改前：${kpi(rows)}`)
  console.log(`统计改后：${kpi(rows.map((s) => (ids.has(s._id) ? Object.assign({}, s, patchOf(s)) : s)))}`)
  if (MODE !== 'apply' || !target.length) { console.log(MODE !== 'apply' ? '\n(dry-run，未写库)' : '\n无需写库'); return }

  const dir = resolve(ROOT, 'backups/shipment-void-0924', new Date().toISOString().replace(/[:.]/g, '-') + '-before-apply')
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, `${COLL}.json`), JSON.stringify(rows, null, 1))
  console.log(`备份 ${COLL} 全量 ${rows.length} 条 → ${dir.replace(ROOT + '/', '')}`)
  const want = {}
  for (const s of target) {
    want[s._id] = patchOf(s)
    const r = await db.collection(COLL).doc(s._id).update(want[s._id])
    if (!r || r.updated !== 1) console.error(`未更新：${s.shipmentNo}（updated=${r && r.updated}）`)
  }

  const after = await fetchAll(db)
  const prev = Object.fromEntries(rows.map((r) => [r._id, r]))
  let bad = 0
  for (const s of after) {
    const p = prev[s._id]
    if (!p) { bad++; console.error('多出一条', s._id); continue }
    const strip = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !FIELDS.includes(k)).sort()))
    if (strip(s) !== strip(p)) { bad++; console.error(`其它字段被改：${s.shipmentNo}`) }
    if (ids.has(s._id) && FIELDS.some((k) => s[k] !== want[s._id][k])) { bad++; console.error(`作废字段不对：${s.shipmentNo}`) }
    if (!ids.has(s._id) && FIELDS.some((k) => JSON.stringify(s[k]) !== JSON.stringify(p[k]))) { bad++; console.error(`范围外被改：${s.shipmentNo}`) }
  }
  if (after.length !== rows.length) { bad++; console.error(`条数变了 ${rows.length} → ${after.length}`) }
  console.log(bad ? `读回核对失败 ${bad} 处` : `读回核对通过：${target.length} 张只改了 ${FIELDS.join(' / ')}，未删除；其余 ${after.length - target.length} 张与备份逐字段一致`)
  console.log(`统计读回：${kpi(after)}`)
  if (bad) process.exit(1)
}

main().catch((e) => { console.error('失败：', (e && e.message) || e); process.exit(1) })
