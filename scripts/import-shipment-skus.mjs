#!/usr/bin/env node
/**
 * 出货中心首批 SKU 导入（飞书「出货表」→ studio_shipment_skus）。**默认 dry-run**。
 * 口径与复核指引：miniprogram/docs/出货中心首批SKU导入_2026-10-09.md
 *
 *   node scripts/import-shipment-skus.mjs                      # dry-run：按线上现状重新核对，打印将写入 / 跳过（只读）
 *   node scripts/import-shipment-skus.mjs --apply              # 先备份整个集合，再逐条 add（不改不删既有记录），最后读回核对
 *   node scripts/import-shipment-skus.mjs --rollback --yes     # 先备份，再软删 importBatch=本批次 的 SKU（与页面「删除 SKU」同形态）
 *   node scripts/import-shipment-skus.mjs --clear-review --yes # 复核通过后：本批次 needsReview → false
 *   node scripts/import-shipment-skus.mjs --hold-ball --yes    # 产品负责人 10-09：小球玻璃罩≠球形10 → 本批次「玻璃罩 球形10」SKU 停用 + 备注尺寸待确认（保持待复核）
 *   node scripts/import-shipment-skus.mjs --unhold-ball --yes  # 恢复：上一步停用的 SKU 回到启用、去掉备注前缀（原备注保留）
 *
 * 选项：--plan <json>（默认 .tmp/shipment-sku-batch1/sku-batch1.json，取其中 toWrite[].row）
 * 凭据：admin/.env 的 TCB_SECRET_ID / TCB_SECRET_KEY（不打印）。备份：backups/shipment-sku-batch1/<时间戳>-<动作>/（已 gitignore）。
 * 写入的每条 SKU 由生产 buildSkuRow 归一（与页面新建同形态），并带 importBatch / needsReview / importRef。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const SKU_COLLECTION = 'studio_shipment_skus'
const BATCH_ID = 'feishu-2026-10-09'
const ACTOR = '飞书首批导入'
const CF = resolve(ROOT, 'miniprogram/cloudfunctions/manageStudioSettlement')
const { buildSkuRow, skuKeyOf } = require(resolve(CF, 'settlementDefaults.js'))
const { normalizeName, buildContext, quoteLines, PRICING_STATUS } = require(resolve(CF, 'pricingCore.js'))

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const PLAN = resolve(ROOT, opt('--plan', '.tmp/shipment-sku-batch1/sku-batch1.json'))
const MODE = has('--apply') ? 'apply' : has('--rollback') ? 'rollback' : has('--clear-review') ? 'clear-review'
  : has('--hold-ball') ? 'hold-ball' : has('--unhold-ball') ? 'unhold-ball' : 'dry-run'
const HOLD_NOTE = '玻璃罩尺寸待确认（产品负责人 2026-10-09：小球玻璃罩不是「球形10」，正确尺寸待告知）｜'

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

async function fetchAll(db, name, where) {
  const out = []
  for (let skip = 0; ; skip += 100) {
    const q = where ? db.collection(name).where(where) : db.collection(name)
    const r = await q.skip(skip).limit(100).get()
    out.push(...r.data)
    if (r.data.length < 100) break
  }
  return out
}

async function backup(db, tag) {
  const rows = await fetchAll(db, SKU_COLLECTION)
  const dir = resolve(ROOT, 'backups/shipment-sku-batch1', new Date().toISOString().replace(/[:.]/g, '-') + '-' + tag)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, `${SKU_COLLECTION}.json`), JSON.stringify(rows, null, 1))
  console.log(`备份 ${SKU_COLLECTION} 全量 ${rows.length} 条 → ${dir.replace(ROOT + '/', '')}`)
  return rows
}

/** 按线上现状重新核对计划：引用必须仍在价目表、skuKey 不得重复、生产算价内核必须算得出价 */
async function plan(db) {
  const planDoc = JSON.parse(readFileSync(PLAN, 'utf8'))
  if (planDoc.batch !== BATCH_ID) throw new Error(`计划文件批次 ${planDoc.batch} ≠ ${BATCH_ID}`)
  const live = (r) => r.deleted !== true
  const mats = (await fetchAll(db, 'studio_material_prices')).filter(live)
  const pkgs = (await fetchAll(db, 'studio_packaging_prices')).filter(live)
  const skus = (await fetchAll(db, SKU_COLLECTION)).filter(live)
  const cfgRes = await db.collection('configs').doc('studio_settlement').get()
  const cfg = (Array.isArray(cfgRes.data) ? cfgRes.data[0] : cfgRes.data) || {}
  const ctx = buildContext({ materials: mats, packagings: pkgs, laborRatePct: cfg.laborRatePct, requirePackaging: cfg.requirePackaging })
  const keys = new Set(skus.map((s) => s.skuKey || skuKeyOf(s)))
  const add = [], skip = [], bad = []
  for (const item of planDoc.toWrite) {
    const built = buildSkuRow(item.row)
    if (!built.ok) { bad.push(`${item.candidate}：${built.msg}`); continue }
    const row = built.row
    const mat = mats.find((m) => m._id === row.materialId && m.status !== 'inactive')
    const pkg = pkgs.find((p) => p._id === row.packagingId && p.status !== 'inactive')
    if (!mat || normalizeName(mat.name) !== normalizeName(row.materialName) || mat.grade !== row.materialGrade) { bad.push(`${row.skuName}：原材料行已变/停用`); continue }
    if (!pkg || normalizeName(pkg.name) !== normalizeName(row.packagingName) || pkg.size !== row.packagingSize) { bad.push(`${row.skuName}：包装行已变/停用`); continue }
    if (keys.has(row.skuKey)) { skip.push(`${row.skuName}（skuKey 已存在）`); continue }
    const q = quoteLines([{ itemName: row.skuName, qty: 1, materialId: row.materialId, materialName: row.materialName, materialGrade: row.materialGrade,
      packagingId: row.packagingId, packagingName: row.packagingName, packagingSize: row.packagingSize, sceneCost: 0 }], ctx).lines[0]
    if (q.pricingStatus !== PRICING_STATUS.PRICED) { bad.push(`${row.skuName}：算价内核未定价（${q.pricingNote}）`); continue }
    keys.add(row.skuKey)
    add.push({ row, unitPrice: q.unitPrice, refPrice: item.refPrice, recordIds: item.recordIds })
  }
  return { add, skip, bad, liveCount: skus.length }
}

function printPlan(p) {
  console.log(`线上有效 SKU ${p.liveCount} 条；将写入 ${p.add.length}，跳过 ${p.skip.length}，异常 ${p.bad.length}`)
  p.add.forEach((a, i) => { if (i < 3 || has('--all')) console.log(`  + ${a.row.skuName} | 现算 ¥${a.unitPrice} | 飞书参考 ¥${a.refPrice ?? '—'} | skuKey ${a.row.skuKey}`) })
  if (p.add.length > 3 && !has('--all')) console.log(`  …（共 ${p.add.length} 条，加 --all 看全部）`)
  p.skip.forEach((s) => console.log('  = 跳过', s))
  p.bad.forEach((s) => console.log('  ✗', s))
}

async function apply(db) {
  const p = await plan(db)
  printPlan(p)
  if (p.bad.length) { console.error('✗ 有异常，未写入'); process.exit(1) }
  if (!p.add.length) { console.log('无需写入'); return }
  await backup(db, 'before-apply')
  const now = Date.now()
  const ids = []
  for (const a of p.add) {
    const data = Object.assign({}, a.row, {
      importBatch: BATCH_ID,
      needsReview: true,
      importRef: { source: '飞书「标本工作室采购库存管理系统」出货表 tbl2lCz8GX2MVDnO', recordIds: a.recordIds },
      createdAt: now, createdBy: ACTOR, updatedAt: now, updatedBy: ACTOR
    })
    const r = await db.collection(SKU_COLLECTION).add(data)
    ids.push(r.id || r._id)
  }
  console.log(`已写入 ${ids.length} 条`)
  await verify(db, p.add)
}

async function verify(db, expected) {
  const mine = (await fetchAll(db, SKU_COLLECTION, { importBatch: BATCH_ID })).filter((r) => r.deleted !== true)
  const byKey = Object.fromEntries(mine.map((r) => [r.skuKey, r]))
  const errs = []
  if (expected && mine.length !== expected.length) errs.push(`读回 ${mine.length} 条 ≠ 写入 ${expected.length} 条`)
  for (const a of expected || []) {
    const d = byKey[a.row.skuKey]
    if (!d) { errs.push('读回缺 ' + a.row.skuName); continue }
    for (const k of ['skuName', 'materialId', 'materialName', 'materialGrade', 'packagingId', 'packagingName', 'packagingSize', 'hasScene', 'sceneCost', 'laborRatePct', 'status', 'note']) {
      if (JSON.stringify(d[k]) !== JSON.stringify(a.row[k])) errs.push(`${a.row.skuName}.${k} 读回 ${JSON.stringify(d[k])} ≠ ${JSON.stringify(a.row[k])}`)
    }
    if (d.needsReview !== true || d.importBatch !== BATCH_ID || d.deleted !== false) errs.push(`${a.row.skuName} 批次/待复核标记不对`)
  }
  console.log(`读回本批次有效 SKU ${mine.length} 条，${errs.length ? '核对失败：\n  ' + errs.join('\n  ') : '逐字段核对通过'}`)
  if (errs.length) process.exit(1)
}

async function rollback(db) {
  const mine = (await fetchAll(db, SKU_COLLECTION, { importBatch: BATCH_ID })).filter((r) => r.deleted !== true)
  console.log(`本批次（${BATCH_ID}）有效 SKU ${mine.length} 条`)
  if (!has('--yes')) { console.log('（未执行；确认要回滚请加 --yes）'); return }
  await backup(db, 'before-rollback')
  const now = Date.now()
  for (const d of mine) {
    await db.collection(SKU_COLLECTION).doc(d._id).update({ deleted: true, deletedAt: now, updatedAt: now, updatedBy: ACTOR + '回滚' })
  }
  const left = (await fetchAll(db, SKU_COLLECTION, { importBatch: BATCH_ID })).filter((r) => r.deleted !== true)
  console.log(`已软删 ${mine.length} 条；读回本批次剩余有效 ${left.length} 条（历史出货单的快照不受影响）`)
}

async function clearReview(db) {
  const mine = (await fetchAll(db, SKU_COLLECTION, { importBatch: BATCH_ID })).filter((r) => r.deleted !== true && r.needsReview === true)
  console.log(`本批次待复核 ${mine.length} 条`)
  if (!has('--yes')) { console.log('（未执行；复核通过后加 --yes 清除标记）'); return }
  await backup(db, 'before-clear-review')
  const now = Date.now()
  for (const d of mine) await db.collection(SKU_COLLECTION).doc(d._id).update({ needsReview: false, reviewedAt: now, updatedAt: now })
  console.log(`已清除 ${mine.length} 条待复核标记`)
}

/**
 * SKU 必须绑定价目表里的包装行才能保存（checkSkuRefs），没有「包装待确认」这一态；
 * 影响最小且可恢复的做法 = 停用（status:inactive）：开单选择器只列启用 SKU → 不会被误用，
 * ERP「出货 SKU 目录」里仍可见，needsReview / 包装 / 材料都不动，一键 --unhold-ball 恢复。
 */
async function holdBall(db, hold) {
  const mine = (await fetchAll(db, SKU_COLLECTION, { importBatch: BATCH_ID })).filter((r) => r.deleted !== true &&
    r.packagingName === '玻璃罩' && r.packagingSize === '球形10' && (hold ? r.status !== 'inactive' : r.status === 'inactive' && String(r.note || '').startsWith(HOLD_NOTE)))
  console.log(`本批次${hold ? '待停用' : '待恢复'}的小球玻璃罩 SKU ${mine.length} 条：`)
  mine.forEach((d) => console.log(`  · ${d.skuName}（${d.status}${d.needsReview ? '·待复核' : ''}${d.note ? '·备注:' + d.note : ''}）`))
  const used = (await fetchAll(db, 'ops_shipments')).filter((s) => s.deleted !== true && (s.items || []).some((it) => mine.some((d) => d._id === it.skuId)))
  console.log(`已被出货单引用：${used.length} 张${used.length ? '（单据金额是快照，不受影响）' : ''}`)
  if (!has('--yes')) { console.log('（未执行；确认请加 --yes）'); return }
  await backup(db, hold ? 'before-hold-ball' : 'before-unhold-ball')
  const now = Date.now()
  const want = {}
  for (const d of mine) {
    const note = hold ? HOLD_NOTE + String(d.note || '') : String(d.note || '').slice(HOLD_NOTE.length)
    want[d._id] = { status: hold ? 'inactive' : 'active', note }
    await db.collection(SKU_COLLECTION).doc(d._id).update({ status: want[d._id].status, note, updatedAt: now, updatedBy: ACTOR + (hold ? '·尺寸待确认' : '·恢复') })
  }
  const back = (await fetchAll(db, SKU_COLLECTION, { importBatch: BATCH_ID })).filter((r) => want[r._id])
  const bad = back.filter((r) => r.status !== want[r._id].status || r.note !== want[r._id].note || r.needsReview !== true ||
    ['packagingId', 'packagingSize', 'materialId', 'skuKey'].some((k) => r[k] !== mine.find((d) => d._id === r._id)[k]))
  console.log(bad.length ? `读回不一致 ${bad.length} 条` : `读回核对通过：${back.length} 条${hold ? '已停用（仍待复核）' : '已恢复启用'}`)
  if (bad.length) process.exit(1)
}

const db = openDb()
if (MODE === 'hold-ball') await holdBall(db, true)
else if (MODE === 'unhold-ball') await holdBall(db, false)
else if (MODE === 'apply') await apply(db)
else if (MODE === 'rollback') await rollback(db)
else if (MODE === 'clear-review') await clearReview(db)
else { printPlan(await plan(db)); console.log('\n（dry-run：未写入。确认无误后加 --apply）') }
