#!/usr/bin/env node
/**
 * 9.21 前的飞书同步出货单 → 统一标「已结清」（产品负责人 2026-10-09 拍板）。**默认 dry-run**。
 * 口径：miniprogram/docs/出货中心首批SKU导入_2026-10-09.md §11
 *
 *   node scripts/settle-feishu-history-shipments.mjs                 # dry-run：列清单 + 统计前后预估（只读）
 *   node scripts/settle-feishu-history-shipments.mjs --apply         # 备份 ops_shipments 全量 → 逐张改结算标记 → 读回核对
 *   node scripts/settle-feishu-history-shipments.mjs --rollback --backup <备份目录> [--yes]
 *        # 按备份把本脚本改过的单（settledBy=本批标记）的四个结算字段还原；不带 --yes 只列出
 *
 * 「已结清」用系统现有口径（manageStudioSettlement/billCore.confirmSettlePatch 写的字段）：
 *   settleStatus:'settled' + settleLabel:'已结清' + settledAt + settledBy。
 *   看板 / 工作室仪表盘（getStudioDashboard/settlementKpis）按 settleStatus==='settled' 计「已结清」，其余计「未收款」；
 *   账单勾选（billCore.shipmentBlockReason）对非 unsettled 的单拒绝入账 → 改完不会再被拉进新账单。
 * **不写** billId / billNo（没有账单）、不改 status（本来就是 completed）、金额 / 明细 / 门店一律不动。
 * 范围：source=feishu 且有 feishuRecordId、未删、未取消、没有账单、结算状态为空或未结、出货日期 < 2026-09-21。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLL = 'ops_shipments'
const CUTOFF = '2026-09-21'
const MARK = '历史结清·产品负责人2026-10-09'
const SETTLE_FIELDS = ['settleStatus', 'settleLabel', 'settledAt', 'settledBy']
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

const inScope = (s) => s.source === 'feishu' && !!s.feishuRecordId && s.deleted !== true && s.status !== 'cancelled' &&
  !s.billId && (!s.settleStatus || s.settleStatus === 'unsettled') && String(s.shipmentDate || '') < CUTOFF
const active = (rows) => rows.filter((s) => s.deleted !== true && s.status !== 'cancelled')
const kpi = (rows) => { const k = computeSettlementKpis(active(rows)); return `出货额 ¥${k.shippedAmount} · 已结清 ¥${k.settledAmount}（${k.settledCount} 张）· 未收款 ¥${k.outstandingAmount}（${k.outstandingCount} 张）· 待确认 ¥${k.paidPendingAmount}` }

async function main() {
  const db = openDb()
  if (MODE === 'rollback') {
    const dir = opt('--backup', '')
    if (!dir || !existsSync(resolve(ROOT, dir, `${COLL}.json`))) throw new Error('须 --backup <本脚本 apply 前的备份目录>')
    const before = JSON.parse(readFileSync(resolve(ROOT, dir, `${COLL}.json`), 'utf8'))
    const byId = Object.fromEntries(before.map((r) => [r._id, r]))
    const mine = (await fetchAll(db)).filter((s) => s.settledBy === MARK && !s.billId && byId[s._id])
    console.log(`本批标记（settledBy=${MARK}）且无账单的单 ${mine.length} 张，将按备份还原 ${SETTLE_FIELDS.join(' / ')}`)
    if (!has('--yes')) { console.log('未带 --yes：只列出，不执行'); return }
    const _ = db.command
    for (const s of mine) {
      const prev = byId[s._id]
      const patch = {}
      SETTLE_FIELDS.forEach((k) => { patch[k] = Object.prototype.hasOwnProperty.call(prev, k) ? prev[k] : _.remove() })
      await db.collection(COLL).doc(s._id).update(patch)
    }
    console.log(`已还原 ${mine.length} 张`)
    return
  }

  const rows = await fetchAll(db)
  const target = rows.filter(inScope).sort((a, b) => (a.shipmentDate + a.shipmentNo < b.shipmentDate + b.shipmentNo ? -1 : 1))
  const sum = Math.round(target.reduce((n, s) => n + (Number(s.totalAmount) || 0), 0) * 100) / 100
  console.log(`范围内 ${target.length} 张，金额合计 ¥${sum}，日期 ${target[0] && target[0].shipmentDate} ~ ${target.length && target[target.length - 1].shipmentDate}`)
  const lines = target.map((s) => [s.shipmentNo, s.shipmentDate, s.storeName || s.storeId, s.totalAmount, s.status, s.settleStatus || '（空）'].join(','))
  mkdirSync(resolve(ROOT, '.tmp/feishu-settle'), { recursive: true })
  writeFileSync(resolve(ROOT, '.tmp/feishu-settle/清单.csv'), '\ufeff单号,出货日期,门店,金额,状态,当前结算状态\n' + lines.join('\n') + '\n')
  console.log('清单 → .tmp/feishu-settle/清单.csv')
  const byStore = {}
  target.forEach((s) => { const k = s.storeName || s.storeId; byStore[k] = byStore[k] || { n: 0, amt: 0 }; byStore[k].n += 1; byStore[k].amt += Number(s.totalAmount) || 0 })
  Object.entries(byStore).forEach(([k, v]) => console.log(`  · ${k}：${v.n} 张 ¥${Math.round(v.amt * 100) / 100}`))
  const now = Date.now()
  const patch = { settleStatus: 'settled', settleLabel: '已结清', settledAt: now, settledBy: MARK }
  const ids = new Set(target.map((s) => s._id))
  console.log(`统计（结算口径）改前：${kpi(rows)}`)
  console.log(`统计（结算口径）改后：${kpi(rows.map((s) => (ids.has(s._id) ? Object.assign({}, s, patch) : s)))}`)
  if (MODE !== 'apply') { console.log('\n(dry-run，未写库)'); return }

  const dir = resolve(ROOT, 'backups/feishu-settle', new Date().toISOString().replace(/[:.]/g, '-') + '-before-apply')
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, `${COLL}.json`), JSON.stringify(rows, null, 1))
  console.log(`备份 ${COLL} 全量 ${rows.length} 条 → ${dir.replace(ROOT + '/', '')}`)
  for (const s of target) {
    const r = await db.collection(COLL).doc(s._id).update(patch)
    if (!r || r.updated !== 1) console.error(`未更新：${s.shipmentNo}（updated=${r && r.updated}）`)
  }

  const after = await fetchAll(db)
  const prev = Object.fromEntries(rows.map((r) => [r._id, r]))
  let bad = 0
  for (const s of after) {
    const p = prev[s._id]
    if (!p) { bad++; console.error('多出一条', s._id); continue }
    const strip = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !SETTLE_FIELDS.includes(k)).sort()))
    if (strip(s) !== strip(p)) { bad++; console.error(`非结算字段被改：${s.shipmentNo}`) }
    if (ids.has(s._id) && SETTLE_FIELDS.some((k) => s[k] !== patch[k])) { bad++; console.error(`结算标记不对：${s.shipmentNo}`) }
    if (!ids.has(s._id) && SETTLE_FIELDS.some((k) => JSON.stringify(s[k]) !== JSON.stringify(p[k]))) { bad++; console.error(`范围外被改：${s.shipmentNo}`) }
  }
  if (after.length !== rows.length) { bad++; console.error(`条数变了 ${rows.length} → ${after.length}`) }
  console.log(bad ? `读回核对失败 ${bad} 处` : `读回核对通过：${target.length} 张只改了 ${SETTLE_FIELDS.join(' / ')}；其余 ${after.length - target.length} 张与备份逐字段一致`)
  console.log(`统计（结算口径）读回：${kpi(after)}`)
  if (bad) process.exit(1)
}

main().catch((e) => { console.error('失败：', (e && e.message) || e); process.exit(1) })
