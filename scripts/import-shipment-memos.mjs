#!/usr/bin/env node
/**
 * 飞书出货表 → 出货中心「草稿箱」/「历史备忘」（集合 ops_shipment_memos）。**默认 dry-run**。
 * 口径：miniprogram/docs/出货中心首批SKU导入_2026-10-09.md §8–§9；集合说明：cloudbase/schema/ops_shipment_memos.md
 *
 *   node scripts/import-shipment-memos.mjs --kind draft             # dry-run：9.21（含）起 → 草稿；只读，打印将写入 / 跳过
 *   node scripts/import-shipment-memos.mjs --kind history           # dry-run：9.21 之前 → 已结清历史备忘
 *   node scripts/import-shipment-memos.mjs --kind draft --apply     # 备份 → 逐张 add → 读回核对（不碰 ops_shipments）
 *   node scripts/import-shipment-memos.mjs --kind draft --rollback --yes   # 备份 → 软删本批次（已转正式的草稿只报告，正式单不动）
 *
 * 选项：--records <json>（默认 .tmp/shipment-sku-batch1/raw/tbl2lCz8GX2MVDnO.records.json，飞书出货表只读拉取结果）
 * 分组：同一「出货日期（东八区）」+ 同一「客户名称」= 一张单；门店按 guessStoreId（与飞书同步同规则），认不出 = 门店待匹配。
 * 跳过：①记录已作为飞书同步单进了 ops_shipments（feishuRecordId）；②同日同门店已有正式单
 *       （草稿：未删且未取消；历史：未删、任何状态）；③同 importKey 已导入过（含已删除，不复活）。
 * 行对应 SKU：只认首批 SKU 的来源记录（studio_shipment_skus.importRef.recordIds），其余标「待匹配」，飞书原文照存。
 * 凭据：admin/.env 的 TCB_SECRET_ID / TCB_SECRET_KEY（不打印）。备份：backups/shipment-memos/<时间戳>-<kind>-<动作>/（已 gitignore）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const MEMO = 'ops_shipment_memos'
const CUTOFF = '2026-09-21'
const KINDS = {
  draft: { batch: 'feishu-drafts-2026-10-09', source: 'feishu-draft', status: 'draft', inRange: (d) => d >= CUTOFF, includeCancelled: false },
  history: { batch: 'feishu-history-pre-0921', source: 'feishu-history', status: 'history', inRange: (d) => d < CUTOFF, includeCancelled: true }
}
const ACTOR = '飞书出货导入'
const FN = resolve(ROOT, 'miniprogram/cloudfunctions/manageStoreShipment')
const { guessStoreId, storeById } = require(resolve(FN, 'shipmentDefaults.js'))
const { buildContext, quoteLines, PRICING_STATUS } = require(resolve(FN, 'pricingEngine.js'))
const { summarizeMemo } = require(resolve(FN, 'shipmentMemos.js'))

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const KIND = opt('--kind', '')
if (!KINDS[KIND]) { console.error('须指定 --kind draft | history'); process.exit(1) }
const K = KINDS[KIND]
const RECORDS = resolve(ROOT, opt('--records', '.tmp/shipment-sku-batch1/raw/tbl2lCz8GX2MVDnO.records.json'))
const MODE = has('--apply') ? 'apply' : has('--rollback') ? 'rollback' : 'dry-run'

function readEnv() {
  const env = {}
  for (const raw of readFileSync(resolve(ROOT, 'admin/.env'), 'utf8').split('\n')) {
    const m = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  if (!env.TCB_SECRET_ID || !env.TCB_SECRET_KEY) throw new Error('admin/.env 缺少 TCB_SECRET_ID / TCB_SECRET_KEY')
  return env
}

/** 集合不存在才建，并仅在新建时套 cloudbase/rules/<集合>.json 的 ACL（同 provision-studio-settlement.cjs） */
async function ensureCollection() {
  const env = readEnv()
  const CB = require(resolve(ROOT, 'node_modules/@cloudbase/manager-node'))
  const { database, permission } = CB.init({ secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY, envId: ENV_ID })
  let existed = false
  try { await database.describeCollection(MEMO); existed = true } catch (e) { existed = false }
  if (existed) return
  await database.createCollectionIfNotExists(MEMO)
  const rule = JSON.parse(readFileSync(resolve(ROOT, `cloudbase/rules/${MEMO}.json`), 'utf8'))
  await permission.modifyResourcePermission({ resourceType: 'collection', resource: MEMO, permission: 'CUSTOM', securityRule: JSON.stringify(rule) })
  console.log(`已创建集合 ${MEMO} 并设权限 CUSTOM ${JSON.stringify(rule)}（仅云函数可读写）`)
}

function openDb() {
  const env = readEnv()
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

async function fetchAll(db, name, where) {
  const out = []
  try {
    for (let skip = 0; ; skip += 100) {
      const q = where ? db.collection(name).where(where) : db.collection(name)
      const r = await q.skip(skip).limit(100).get()
      out.push(...r.data)
      if (r.data.length < 100) break
    }
  } catch (e) {
    if (/not exist|不存在|ResourceNotFound|DATABASE_COLLECTION_NOT_EXIST/i.test(String((e && (e.message || e.code)) || e))) return null
    throw e
  }
  return out
}

const text = (v) => (v == null ? '' : Array.isArray(v) ? v.map((x) => (x && x.text) || '').join('') : String(v)).trim()
const num = (v) => { const n = Number(text(v)); return text(v) !== '' && Number.isFinite(n) ? n : null }
const day = (ms) => new Date(Number(ms) + 8 * 3600e3).toISOString().slice(0, 10)
const r2 = (n) => Math.round(n * 100) / 100
const hintOf = (name) => name.replace(/(玻璃罩|相框|冰箱贴|造景|闹钟|挂件|摆件|标本|小球|大球)/g, '').trim() || name

async function buildPlan(db) {
  const records = JSON.parse(readFileSync(RECORDS, 'utf8'))
  const ships = (await fetchAll(db, 'ops_shipments')) || []
  const skus = ((await fetchAll(db, 'studio_shipment_skus')) || []).filter((s) => s.deleted !== true && s.status !== 'inactive')
  const memos = (await fetchAll(db, MEMO)) || []
  const synced = new Set(ships.filter((s) => s.feishuRecordId).map((s) => s.feishuRecordId))
  const skuByRecord = {}
  skus.forEach((s) => ((s.importRef && s.importRef.recordIds) || []).forEach((id) => { skuByRecord[id] = s }))
  const formal = ships.filter((s) => s.deleted !== true && !s.feishuRecordId && (K.includeCancelled || s.status !== 'cancelled'))
  const memoKeys = new Set(memos.map((m) => m.importKey))

  const live = (r) => r.deleted !== true
  const mats = ((await fetchAll(db, 'studio_material_prices')) || []).filter(live)
  const pkgs = ((await fetchAll(db, 'studio_packaging_prices')) || []).filter(live)
  const cfgRes = await db.collection('configs').doc('studio_settlement').get().catch(() => ({ data: [] }))
  const cfg = (Array.isArray(cfgRes.data) ? cfgRes.data[0] : cfgRes.data) || {}
  const ctx = buildContext({ materials: mats, packagings: pkgs, laborRatePct: Number(cfg.laborRatePct), requirePackaging: cfg.requirePackaging !== false })

  const inRange = records.filter((r) => r.fields && r.fields['出货日期'] && K.inRange(day(r.fields['出货日期'])))
  const alreadySynced = inRange.filter((r) => synced.has(r.record_id))
  const groups = {}
  inRange.filter((r) => !synced.has(r.record_id)).forEach((r) => {
    const f = r.fields
    const key = `${KIND}|${day(f['出货日期'])}|${text(f['客户名称'])}`
    ;(groups[key] = groups[key] || []).push(r)
  })

  const toWrite = []
  const skipped = []
  for (const key of Object.keys(groups).sort()) {
    const recs = groups[key]
    const [, date, customer] = key.split('|')
    const storeId = guessStoreId(customer, '')
    const store = storeById(storeId)
    if (memoKeys.has(key)) { skipped.push({ key, date, customer, rows: recs.length, reason: '已导入过（同 importKey）' }); continue }
    const hits = store ? formal.filter((s) => s.shipmentDate === date && s.storeId === storeId) : []
    if (hits.length) {
      skipped.push({ key, date, customer, rows: recs.length, reason: `同日同门店已有正式单 ${hits.length} 张`, formalIds: hits.map((s) => s._id), formalStatus: hits.map((s) => s.status) })
      continue
    }
    const lines = recs.map((r) => {
      const f = r.fields
      const qty = Math.max(1, Math.floor(num(f['数量']) || 1))
      const unit = num(f['单价'])
      const total = num(f['总价'])
      const unpriced = (total === null || total === 0) && !(unit > 0)
      const sku = skuByRecord[r.record_id]
      const line = {
        key: r.record_id,
        feishuRecordId: r.record_id,
        feishuNo: text(f['出货编号']),
        rawName: text(f['物品名称']),
        rawSpec: text(f['规格型号']),
        qty,
        feishuQtyRaw: text(f['数量']),
        feishuUnitPrice: unit,
        feishuAmount: unpriced ? null : total !== null ? total : unit !== null ? r2(unit * qty) : null,
        feishuAmountRaw: total,
        feishuNote: text(f['备注']),
        feishuMeta: { category: text(f['分类']), status: text(f['状态']), courier: text(f['快递公司']), trackingNo: text(f['运单号']) },
        match: sku ? 'sku' : 'none',
        skuId: sku ? sku._id : '',
        skuName: sku ? sku.skuName : '',
        matchNote: sku ? `按首批 SKU 来源记录自动对应${sku.needsReview ? '（该 SKU 待复核）' : ''}` : '待匹配：请在草稿里选 SKU',
        hintKeyword: hintOf(text(f['物品名称'])),
        refUnitPrice: null,
        refAmount: null,
        diff: null,
        removed: false
      }
      if (sku && KIND === 'draft') {
        const q = quoteLines([{
          itemName: sku.skuName, qty, materialId: sku.materialId, materialName: sku.materialName, materialGrade: sku.materialGrade,
          packagingId: sku.packagingId, packagingName: sku.packagingName, packagingSize: sku.packagingSize, sceneCost: Number(sku.sceneCost) || 0,
          laborRatePct: sku.laborRatePct === null || sku.laborRatePct === undefined ? undefined : sku.laborRatePct
        }], ctx).lines[0]
        if (q && q.pricingStatus === PRICING_STATUS.PRICED) {
          line.refUnitPrice = r2(q.unitPrice)
          line.refAmount = r2(q.totalPrice)
          line.diff = line.feishuAmount === null ? null : r2(q.totalPrice - line.feishuAmount)
        }
      }
      return line
    })
    const now = Date.now()
    toWrite.push({
      kind: KIND, status: K.status, source: K.source,
      historical: KIND === 'history', settled: KIND === 'history',
      storeId: store ? store.id : '', storeName: store ? store.name : '', storeMatched: !!store,
      customerName: customer, shipmentDate: date, note: '',
      lines,
      importBatch: K.batch, importKey: key, feishuRecordIds: recs.map((r) => r.record_id),
      deleted: false, createdAt: now, updatedAt: now, createdBy: ACTOR, updatedBy: ACTOR
    })
  }
  return { toWrite, skipped, alreadySynced: alreadySynced.length, inRange: inRange.length, memosBefore: memos, shipsCount: ships.length }
}

function report(p) {
  const sums = p.toWrite.map((d) => Object.assign({ d }, summarizeMemo(d)))
  const feishu = r2(sums.reduce((a, s) => a + (s.feishuTotal || 0), 0))
  console.log(`\n== ${KIND === 'draft' ? '草稿（9.21 起）' : '历史备忘（9.21 前，已结清）'} · 批次 ${K.batch} · ${MODE} ==`)
  console.log(`飞书记录在范围内 ${p.inRange} 条：已是飞书同步单 ${p.alreadySynced} 条（跳过）`)
  console.log(`拟写入 ${p.toWrite.length} 张 / ${sums.reduce((a, s) => a + s.lineCount, 0)} 行；飞书金额合计 ¥${feishu}` +
    `（无价行 ${sums.reduce((a, s) => a + s.feishuMissing, 0)}）；待匹配行 ${sums.reduce((a, s) => a + s.pendingLines, 0)}；门店待匹配 ${p.toWrite.filter((d) => !d.storeMatched).length} 张`)
  if (p.toWrite.length) {
    const dates = p.toWrite.map((d) => d.shipmentDate).sort()
    console.log(`日期范围 ${dates[0]} ~ ${dates[dates.length - 1]}`)
  }
  sums.forEach(({ d, lineCount, feishuTotal, feishuMissing, refTotal, refMissing, pendingLines }) => {
    console.log(`  · ${d.shipmentDate} ${d.customerName} → ${d.storeMatched ? d.storeName : '门店待匹配'}：${lineCount} 行，飞书 ¥${feishuTotal}${feishuMissing ? `（${feishuMissing} 行无价）` : ''}` +
      (KIND === 'draft' ? `，参考 ¥${refTotal}${refMissing ? `（${refMissing} 行未算出）` : ''}` : '') + `，待匹配 ${pendingLines}`)
    d.lines.forEach((l) => console.log(`      - ${l.rawName}${l.rawSpec ? ' / ' + l.rawSpec : ''} ×${l.qty} 飞书 ${l.feishuAmount === null ? '无价' : '¥' + l.feishuAmount}` +
      (l.match === 'sku' ? ` → ${l.skuName}${l.refAmount !== null ? ` 参考 ¥${l.refAmount}（差 ${l.diff === null ? '—' : l.diff}）` : ''}` : ' → 待匹配')))
  })
  if (p.skipped.length) {
    console.log(`跳过 ${p.skipped.length} 组：`)
    p.skipped.forEach((s) => console.log(`  · ${s.date} ${s.customer}（${s.rows} 行）：${s.reason}${s.formalIds ? ' ' + s.formalIds.map((id, i) => `${id.slice(-6)}[${s.formalStatus[i]}]`).join(' ') : ''}`))
  }
  return { feishu, sums }
}

async function backup(db, tag) {
  const dir = resolve(ROOT, 'backups/shipment-memos', new Date().toISOString().replace(/[:.]/g, '-') + `-${KIND}-${tag}`)
  mkdirSync(dir, { recursive: true })
  for (const name of [MEMO, 'ops_shipments']) {
    const rows = await fetchAll(db, name)
    writeFileSync(resolve(dir, `${name}.json`), JSON.stringify(rows || [], null, 1))
    console.log(`备份 ${name} 全量 ${rows ? rows.length : 0} 条${rows ? '' : '（集合尚不存在）'}`)
  }
  console.log(`→ ${dir.replace(ROOT + '/', '')}`)
  return dir
}

async function main() {
  const db = openDb()
  if (MODE === 'rollback') {
    const mine = ((await fetchAll(db, MEMO, { importBatch: K.batch })) || []).filter((m) => m.deleted !== true)
    const confirmed = mine.filter((m) => m.status === 'confirmed' || m.status === 'confirming')
    console.log(`批次 ${K.batch}：未删除 ${mine.length} 张，其中已转正式 ${confirmed.length} 张（正式出货单不动，只软删备忘本身）`)
    confirmed.forEach((m) => console.log(`  · ${m.shipmentDate} ${m.customerName} → 正式单 ${m.confirmedShipmentId}`))
    if (!has('--yes')) { console.log('未带 --yes：只列出，不执行'); return }
    await backup(db, 'before-rollback')
    for (const m of mine) await db.collection(MEMO).doc(m._id).update({ deleted: true, deletedAt: Date.now(), updatedAt: Date.now(), updatedBy: ACTOR + '·回滚' })
    console.log(`已软删 ${mine.length} 张`)
    return
  }

  const p = await buildPlan(db)
  const { feishu } = report(p)
  const out = resolve(ROOT, '.tmp/shipment-memos')
  mkdirSync(out, { recursive: true })
  writeFileSync(resolve(out, `${KIND}-plan.json`), JSON.stringify({ kind: KIND, batch: K.batch, feishuTotal: feishu, toWrite: p.toWrite, skipped: p.skipped, alreadySynced: p.alreadySynced }, null, 1))
  if (MODE !== 'apply') { console.log(`\n(dry-run，未写库；计划 → .tmp/shipment-memos/${KIND}-plan.json)`); return }
  if (!p.toWrite.length) { console.log('\n无可写入（幂等：已全部导入或被跳过）'); return }

  await backup(db, 'before-apply')
  await ensureCollection()
  const ids = []
  for (const doc of p.toWrite) {
    const r = await db.collection(MEMO).add(doc)
    ids.push(r.id || r._id)
  }
  console.log(`已写入 ${ids.length} 张`)

  const back = (await fetchAll(db, MEMO, { importBatch: K.batch })) || []
  let bad = 0
  for (const doc of p.toWrite) {
    const got = back.find((b) => b.importKey === doc.importKey && b.deleted !== true)
    const same = got && ['kind', 'status', 'storeId', 'shipmentDate', 'customerName', 'importBatch', 'settled', 'historical'].every((k) => got[k] === doc[k]) &&
      JSON.stringify(got.lines) === JSON.stringify(doc.lines) && JSON.stringify(got.feishuRecordIds) === JSON.stringify(doc.feishuRecordIds)
    if (!same) { bad++; console.error(`读回不一致：${doc.importKey}`) }
  }
  const shipsAfter = ((await fetchAll(db, 'ops_shipments')) || []).length
  if (shipsAfter !== p.shipsCount) { bad++; console.error(`ops_shipments 条数变了：${p.shipsCount} → ${shipsAfter}`) }
  console.log(bad ? `读回核对失败 ${bad} 处` : `读回核对通过：${p.toWrite.length} 张逐字段一致；ops_shipments 条数未变（${shipsAfter}）`)
  if (bad) process.exit(1)
}

main().catch((e) => { console.error('失败：', (e && e.message) || e); process.exit(1) })
