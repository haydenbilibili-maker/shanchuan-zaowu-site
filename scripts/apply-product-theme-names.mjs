/**
 * 主题名写回（方式 2：默认取候选 #1 + 人工圈定覆盖）
 *
 * 规则
 *   · 默认：每件取候选列表的**第 1 个**；
 *   · 覆盖：`scripts/product-theme-selection.json` 里的人工圈定优先（按 title 或 _id 指定）；
 *   · 纪律：写入前逐条过 `scripts/productThemeName.mjs` 校验，不合规**跳过并报出**（不写脏名字）；
 *   · 安全：默认 dry-run；`--apply` 才写，且写前落**回滚文件**、只更新 themeName/themeNote、幂等跳过无差异项；
 *   · 复核：`--rollback` 按回滚文件恢复。
 *
 * 用法：
 *   node scripts/apply-product-theme-names.mjs                    # dry-run（默认）
 *   node scripts/apply-product-theme-names.mjs --apply
 *   node scripts/apply-product-theme-names.mjs --rollback
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isValidThemeName } from './productThemeName.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const require = createRequire(import.meta.url)
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const CAND = resolve(HERE, 'product-theme-candidates.result.json')
const SELECTION = resolve(HERE, 'product-theme-selection.json')
const ROLLBACK = resolve(HERE, 'apply-product-theme-names-rollback.result.json')
const RESULT = resolve(HERE, 'apply-product-theme-names.result.json')
const PLAN = resolve(HERE, 'apply-product-theme-names-plan.result.json')

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const ROLLBACK_MODE = args.includes('--rollback')
const LIMIT = parseInt((args[args.indexOf('--limit') + 1] || '0'), 10) || 0

let tcb = null
for (const p of [
  resolve(ROOT, '../WeChatProjects/shanchuanspecimens-只上传/cloudfunctions/manageProducts/node_modules/@cloudbase/node-sdk'),
  resolve(ROOT, 'node_modules/@cloudbase/node-sdk')
]) { try { tcb = require(p); break } catch (e) { /* 继续 */ } }
if (!tcb) { console.error('✗ 未找到 @cloudbase/node-sdk'); process.exit(1) }
const env = {}
for (const raw of readFileSync(resolve(ROOT, 'admin/.env'), 'utf8').split('\n')) {
  const line = raw.trim(); if (!line || line.startsWith('#') || !line.includes('=')) continue
  const [k, ...rest] = line.split('='); env[k.trim()] = rest.join('=').trim()
}
const db = tcb.init({ env: ENV_ID, secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY }).database()

if (ROLLBACK_MODE) {
  if (!existsSync(ROLLBACK)) { console.error('✗ 没有回滚文件'); process.exit(1) }
  const snap = JSON.parse(readFileSync(ROLLBACK, 'utf8'))
  let n = 0
  for (const it of snap.items || []) {
    await db.collection('products').doc(it._id).update({ themeName: it.beforeThemeName || '', themeNote: it.beforeThemeNote || '' })
    n += 1
  }
  console.log(`  ✓ 已回滚 ${n} 件`)
  process.exit(0)
}

if (!existsSync(CAND)) { console.error(`✗ 缺少候选文件 ${CAND}；先跑 scripts/scan-product-theme-candidates.mjs`); process.exit(1) }
const cand = JSON.parse(readFileSync(CAND, 'utf8')).items || {}
const overrides = existsSync(SELECTION) ? (JSON.parse(readFileSync(SELECTION, 'utf8')).overrides || {}) : {}

// 组装计划：覆盖优先，否则候选 #1
const byId = new Map(Object.entries(cand))
const plan = []
const skipped = []
for (const [id, it] of byId) {
  const ov = overrides[id] || overrides[it.title]
  let pick = null
  if (ov && (ov.themeName || ov.themeNote)) {
    pick = { themeName: String(ov.themeName || '').trim(), themeNote: String(ov.themeNote || '').trim(), source: '人工圈定' }
  } else if (Array.isArray(it.candidates) && it.candidates.length) {
    const c = it.candidates[0]
    pick = { themeName: c.themeName, themeNote: c.note || '', source: '候选#1' }
  }
  if (!pick) { skipped.push({ id, title: it.title, why: '无候选' }); continue }
  if (!isValidThemeName(pick.themeName)) { skipped.push({ id, title: it.title, why: `不合规: ${pick.themeName}` }); continue }
  plan.push({ _id: id, title: it.title, price: it.price, ...pick })
}

const rows = (await db.collection('products').field({ themeName: true, themeNote: true }).limit(1000).get()).data || []
const currentById = new Map(rows.map((r) => [r._id, r]))
let todo = plan.filter((p) => {
  const cur = currentById.get(p._id) || {}
  return String(cur.themeName || '') !== p.themeName || String(cur.themeNote || '') !== p.themeNote
})
if (LIMIT) todo = todo.slice(0, LIMIT)

console.log(`  候选 ${byId.size} 件 | 人工圈定覆盖 ${Object.keys(overrides).length} 条 | 计划 ${plan.length} 件 | 需变更 ${todo.length} 件${APPLY ? '' : '（dry-run，未写库）'}`)
for (const p of todo.slice(0, 12)) {
  const cur = currentById.get(p._id) || {}
  console.log(`    · ${String(p.title).slice(0, 18).padEnd(20)} ${p.source.padEnd(6)} ${cur.themeName ? `[现:${cur.themeName}] ` : ''}→ ${p.themeName}  ${p.themeNote.slice(0, 22)}`)
}
if (skipped.length) { console.log(`  ⚠️ 跳过 ${skipped.length} 件：`); for (const s of skipped.slice(0, 6)) console.log(`    - ${String(s.title).slice(0, 18)}：${s.why}`) }
writeFileSync(PLAN, `${JSON.stringify({ at: new Date().toISOString(), count: todo.length, items: todo }, null, 1)}\n`)

if (!APPLY) { console.log('  ⚠️ 加 --apply 才写入（会先生成回滚文件）；计划已落 apply-product-theme-names-plan.result.json'); process.exit(0) }

writeFileSync(ROLLBACK, `${JSON.stringify({ at: new Date().toISOString(), items: todo.map((p) => { const cur = currentById.get(p._id) || {}; return { _id: p._id, beforeThemeName: cur.themeName || '', beforeThemeNote: cur.themeNote || '' } }) }, null, 1)}\n`)
let ok = 0; const failed = []
for (const p of todo) {
  try { await db.collection('products').doc(p._id).update({ themeName: p.themeName, themeNote: p.themeNote }); ok += 1 }
  catch (e) { failed.push({ _id: p._id, title: p.title, error: (e && e.message) || String(e) }) }
}
writeFileSync(RESULT, `${JSON.stringify({ at: new Date().toISOString(), planned: plan.length, changed: todo.length, ok, failed, skipped }, null, 1)}\n`)
console.log(`  ✓ 已写入 ${ok}/${todo.length}；失败 ${failed.length}；回滚文件 apply-product-theme-names-rollback.result.json`)
