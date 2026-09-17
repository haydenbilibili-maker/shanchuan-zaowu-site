/**
 * 学名/物种名修正写回（**默认 dry-run，--apply 才写**）
 *
 * 依据：docs/学名分类一致性审计_2026-09-17.md（43 条疑点）逐条人工判断后，
 * **只改确定的错**；合法的上一级分类（Coleoptera/Lepidoptera/spp./Crinoidea…）与
 * 「首饰用真蝶故名学名」一律保留。
 *
 * 安全：默认 dry-run；写前落回滚文件；只更新 latinName / speciesZh；幂等；--rollback 可恢复。
 *
 *   node scripts/fix-product-taxonomy.mjs            # dry-run
 *   node scripts/fix-product-taxonomy.mjs --apply
 *   node scripts/fix-product-taxonomy.mjs --rollback
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const require = createRequire(import.meta.url)
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const ROLLBACK = resolve(HERE, 'fix-product-taxonomy-rollback.result.json')
const RESULT = resolve(HERE, 'fix-product-taxonomy.result.json')

/**
 * 修正清单：以「标题 + 当前（错误）学名」双条件定位 —— 无歧义、且若匹配不到会明确告警。
 * 判断依据写在 why 里，便于复核；合法的上一级分类与「首饰用真蝶」不在清单内。
 */
const FIXES = [
  { title: '孔雀标本', from: 'Morpho menelaus', latinName: 'Pavo cristatus', speciesZh: '蓝孔雀',
    why: 'R3 鸟纲↔蝶属名矛盾：孔雀标本误填大蓝闪蝶学名' },
  { title: '绿灰碟K金手镯', from: 'K18', latinName: 'Graphium agamemnon',
    why: 'R4 金纯度标记 K18 误填进学名字段；与同系列绿灰碟吊坠/手链一致' },
  { title: '雅灰碟k金手镯', from: 'Au750', latinName: 'Pieris canidia',
    why: 'R4 金纯度标记 Au750 误填；与雅灰碟手表/手链一致' },
  { title: '蝶翅画鹦鹉', from: 'N/A', latinName: '',
    why: 'R4 蝶翅画为拼贴、无单一物种 → 清空占位符' },
  { title: '植物与蝴蝶组合相框', from: 'various', latinName: '',
    why: 'R4 组合件 → 清空英文占位词 various' },
  { title: '自然小集·植物与蝴蝶组合框', from: 'various', latinName: '',
    why: 'R4 组合件 → 清空英文占位词 various' },
  { title: '绿色蝴蝶合集', from: 'various species of Lepidoptera exhibiting structural green coloration', latinName: 'Lepidoptera',
    why: 'R4 蝴蝶合集取上一级分类，比英文长串更准确' },
  { title: '橙色蝴蝶合集', from: 'various species of Lepidoptera with orange wing coloration', latinName: 'Lepidoptera',
    why: 'R4 蝴蝶合集同上' }
]

let tcb = null
for (const p of [
  resolve(ROOT, '../WeChatProjects/shanchuanspecimens-只上传/cloudfunctions/manageProducts/node_modules/@cloudbase/node-sdk'),
  resolve(ROOT, 'node_modules/@cloudbase/node-sdk')
]) { try { tcb = require(p); break } catch (e) {} }
if (!tcb) { console.error('✗ 未找到 @cloudbase/node-sdk'); process.exit(1) }
const env = {}
for (const raw of readFileSync(resolve(ROOT, 'admin/.env'), 'utf8').split('\n')) {
  const t = raw.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue
  const [k, ...r] = t.split('='); env[k.trim()] = r.join('=').trim()
}
const db = tcb.init({ env: ENV_ID, secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY }).database()
const args = process.argv.slice(2)

if (args.includes('--rollback')) {
  if (!existsSync(ROLLBACK)) { console.error('✗ 没有回滚文件'); process.exit(1) }
  const snap = JSON.parse(readFileSync(ROLLBACK, 'utf8'))
  let n = 0
  for (const it of snap.items || []) {
    await db.collection('products').doc(it._id).update({ latinName: it.beforeLatinName || '', speciesZh: it.beforeSpeciesZh || '' })
    n += 1
  }
  console.log(`  ✓ 已回滚 ${n} 件`)
  process.exit(0)
}

const APPLY = args.includes('--apply')
const plan = []
for (const f of FIXES) {
  let row = null
  try {
    const r = await db.collection('products')
      .where({ title: f.title, latinName: f.from }).limit(1).get()
    row = (r && r.data && r.data[0]) || null
  } catch (e) { console.log(`  ⚠️ 查询失败 ${f.title}: ${e.message}`) }
  if (!row) { console.log(`  ⚠️ 未匹配到：${f.title}（当前学名应为 ${f.from}）—— 跳过并请复核`); continue }
  const patch = {}
  if (String(row.latinName || '') !== f.latinName) patch.latinName = f.latinName
  if (f.speciesZh !== undefined && String(row.speciesZh || '') !== f.speciesZh) patch.speciesZh = f.speciesZh
  plan.push({ _id: row._id, title: row.title, root: row.rootCategoryName || '',
    before: { latinName: row.latinName || '', speciesZh: row.speciesZh || '' }, patch, why: f.why })
}
const todo = plan.filter((p) => Object.keys(p.patch).length)
console.log(`  清单 ${FIXES.length} 件；匹配 ${plan.length} 件；需变更 ${todo.length} 件${APPLY ? '' : '（dry-run，未写库）'}`)
for (const p of plan) {
  const from = p.before.latinName || '(空)'
  const to = p.patch.latinName !== undefined ? (p.patch.latinName || '(清空)') : '(不变)'
  console.log(`    · ${String(p.title).slice(0, 20).padEnd(22)} ${p.root.padEnd(6)} ${from.slice(0, 34)} → ${to}`)
  console.log(`        ↳ ${p.why}`)
}
if (!APPLY) { console.log('  ⚠️ 加 --apply 才写入（会先生成回滚文件）'); process.exit(0) }

writeFileSync(ROLLBACK, JSON.stringify({ at: new Date().toISOString(), items: todo.map((p) => ({ _id: p._id, ...p.before })) }, null, 1) + '\n')
let ok = 0; const failed = []
for (const p of todo) {
  try { await db.collection('products').doc(p._id).update(p.patch); ok += 1 }
  catch (e) { failed.push({ _id: p._id, title: p.title, error: (e && e.message) || String(e) }) }
}
writeFileSync(RESULT, JSON.stringify({ at: new Date().toISOString(), planned: FIXES.length, changed: todo.length, ok, failed }, null, 1) + '\n')
console.log(`  ✓ 已写入 ${ok}/${todo.length}；失败 ${failed.length}；回滚文件 fix-product-taxonomy-rollback.result.json`)
