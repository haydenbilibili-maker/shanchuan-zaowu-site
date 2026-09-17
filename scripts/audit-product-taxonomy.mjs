/**
 * 学名 / 分类一致性**只读审计**（不写库）
 *
 * 起因：详情页截图里一件「孔雀标本」挂着「鸟纲」分类与 `Morpho menelaus`（大蓝闪蝶）学名 ✗ ——
 * 三者互相矛盾，顾客一眼可见。此类错误多来自 AI 一键补齐或人工复制粘贴。
 *
 * 本脚本只做**跨字段一致性**检查（确定性规则，不需要外部物种库）：
 *   R1 同一 latinName 出现在**不同根分类**的商品上（强信号：复制粘贴/AI 串味）
 *   R2 同一 latinName 对应**不同 speciesZh**（同一学名两个中文名）
 *   R3 latinName 与 taxonomy.class 明显冲突（鸟纲 ↔ 蝶/蛾/虫类属名等粗判）
 *   R4 学名形状不合双名法（含中文、单词、含数字/括号等）
 *   R5 分类为衍生品/文创却填了拉丁学名（按图文详情规则应为空）
 *
 * 用法：node scripts/audit-product-taxonomy.mjs [--out docs/xxx.md]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const require = createRequire(import.meta.url)
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const args = process.argv.slice(2)
const outArg = args.indexOf('--out')
const OUT = resolve(ROOT, outArg >= 0 ? args[outArg + 1] : 'docs/学名分类一致性审计_2026-09-17.md')

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

const rows = []
for (let skip = 0; skip < 5000; skip += 100) {
  const r = await db.collection('products')
    .field({ title: true, latinName: true, speciesZh: true, taxonomy: true, category: true, rootCategoryName: true, isOffShelf: true })
    .skip(skip).limit(100).get()
  const b = (r && r.data) || []
  rows.push(...b)
  if (b.length < 100) break
}
const live = rows.filter((r) => r.isOffShelf !== true)
const L = (x) => String(x || '').trim()
const key = (r) => L(r.latinName).toLowerCase()

const findings = []
const push = (rule, title, detail, id) => findings.push({ rule, title, detail, id })

// R1 同学名跨根分类
const byLatin = new Map()
for (const r of live) { const k = key(r); if (!k) continue; if (!byLatin.has(k)) byLatin.set(k, []); byLatin.get(k).push(r) }
for (const [k, list] of byLatin) {
  const roots = [...new Set(list.map((r) => L(r.rootCategoryName) || '(无根分类)'))]
  if (roots.length > 1) {
    push('R1', `同学名跨分类：${L(list[0].latinName)}`, `${roots.join(' / ')} —— ${list.map((r) => L(r.title)).slice(0, 4).join('、')}`, list[0]._id)
  }
  const zh = [...new Set(list.map((r) => L(r.speciesZh)).filter(Boolean))]
  if (zh.length > 1) push('R2', `同学名多中文名：${L(list[0].latinName)}`, zh.join(' / '), list[0]._id)
}

// R3/R4/R5 逐件
const INSECT_HINT = /morpho|papilio|danaus|pieris|saturnia|attacus|caligo|heliconius|vanessa|polygonia|nymphalis|parnassius|troides|orithya|junonia|hypolimnas|graphium|delias|catopsilia|eurema|lycaen|stichophthalma|sasakia/i
for (const r of live) {
  const latin = L(r.latinName); const cls = L(r.taxonomy && r.taxonomy.class)
  const root = L(r.rootCategoryName); const cat = L(r.category)
  if (latin) {
    if (/[\u4e00-\u9fa5]/.test(latin)) push('R4', `学名含中文：${latin}`, `${L(r.title)}`, r._id)
    else if (!/^[A-Z][a-z]+(\s+[a-z][a-z-]+)+$/.test(latin)) push('R4', `学名形状可疑：${latin}`, `${L(r.title)}（应为「属名 种加词」）`, r._id)
    if (cls && /鸟纲|哺乳纲|爬行纲|两栖纲|硬骨鱼纲|软骨鱼纲/.test(cls) && INSECT_HINT.test(latin)) {
      push('R3', `纲与学名冲突：${cls} ↔ ${latin}`, `${L(r.title)}（${root}/${cat}）`, r._id)
    }
  }
  if (/衍生品|文创|首饰|饰品/.test(root + cat) && latin) {
    push('R5', `衍生物却填了学名：${latin}`, `${L(r.title)}（${root}/${cat}）`, r._id)
  }
}

const lines = [
  '# 学名 / 分类一致性审计（只读，2026-09-17）', '',
  '> **只读扫描，未改动任何数据。** 规则见脚本头注释（R1–R5，确定性判据）。', '',
  `在售商品 ${live.length} 件，命中 ${findings.length} 条疑点。`, '',
  '| # | 规则 | 问题 | 详情 | 商品 _id |', '|---|---|---|---|---|'
]
findings.forEach((f, i) => lines.push(`| ${i + 1} | ${f.rule} | ${f.title} | ${f.detail} | \`${f.id}\` |`))
if (!findings.length) lines.push('| — | — | 未命中 | 三类判据均未发现矛盾 | — |')
lines.push('', '## 复核建议', '',
  '- R1/R2 是**最强信号**（同一学名分属不同分类 / 对应不同中文名）→ 优先核；',
  '- R3 是粗判（纲 vs 属名），可能含拉丁名正确但分类标错的组合；',
  '- R5 依据「图文详情规则：衍生品/文创 latinName 应为空」；',
  '- 确认后再走写回脚本（带回滚文件），本审计**不会**自动改数据。')
writeFileSync(OUT, lines.join('\n') + '\n')
console.log(`  ✓ 审计完成：在售 ${live.length} 件，命中 ${findings.length} 条疑点`)
for (const f of findings.slice(0, 12)) console.log(`    [${f.rule}] ${f.title} — ${f.detail.slice(0, 48)}`)
console.log(`  报告：${OUT.replace(ROOT + '/', '')}`)
