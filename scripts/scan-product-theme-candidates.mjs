/**
 * 存量商品：批量生成「主题名」候选（**只产清单、不写库**）
 *
 * 与录入端同一套纪律（scripts/productThemeName.mjs，云函数内有同源副本）。
 * 产出供人工挑选，确认后再由写入脚本按圈定项写回（另一步，带回滚文件）。
 *
 * 用法：
 *   node scripts/scan-product-theme-candidates.mjs --dry-run          # 只列将要处理的商品（不需要 key）
 *   node scripts/scan-product-theme-candidates.mjs --limit 5          # 小批试跑
 *   node scripts/scan-product-theme-candidates.mjs --limit 200 --concurrency 2
 *   node scripts/scan-product-theme-candidates.mjs --report           # 由已有结果生成复核清单(markdown)
 *
 * key 解析顺序：环境变量 DEEPSEEK_API_KEY → admin/.env 的 DEEPSEEK_API_KEY / VITE_DEEPSEEK_API_KEY
 * 断点续跑：结果文件里已处理过的 _id 会跳过（--redo 可强制重跑）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeThemeCandidates, THEME_PROMPT_RULES } from './productThemeName.mjs'
import { proposeScenes } from './giftSceneRules.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const require = createRequire(import.meta.url)
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const OUT = resolve(HERE, 'product-theme-candidates.result.json')
const REPORT = resolve(ROOT, 'docs/主题名候选_存量复核_2026-09-17.md')

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const DRY = has('--dry-run')
const REPORT_ONLY = has('--report')
const REDO = has('--redo')
const LIMIT = parseInt(val('--limit', '5'), 10) || 5
const CONC = Math.max(1, Math.min(4, parseInt(val('--concurrency', '2'), 10) || 2))

function readEnv(name) {
  if (process.env[name]) return process.env[name]
  try {
    for (const raw of readFileSync(resolve(ROOT, 'admin/.env'), 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#') || !line.includes('=')) continue
      const [k, ...rest] = line.split('=')
      if (k.trim() === name) return rest.join('=').trim()
    }
  } catch (e) { /* ignore */ }
  return ''
}
const API_KEY = readEnv('DEEPSEEK_API_KEY') || readEnv('VITE_DEEPSEEK_API_KEY')

let tcb = null
for (const p of [
  resolve(ROOT, '../WeChatProjects/shanchuanspecimens-只上传/cloudfunctions/manageProducts/node_modules/@cloudbase/node-sdk'),
  resolve(ROOT, 'node_modules/@cloudbase/node-sdk')
]) { try { tcb = require(p); break } catch (e) { /* 继续 */ } }
if (!tcb) { console.error('✗ 未找到 @cloudbase/node-sdk'); process.exit(1) }

function creds() {
  const txt = readFileSync(resolve(ROOT, 'admin/.env'), 'utf8'); const out = {}
  for (const raw of txt.split('\n')) {
    const line = raw.trim(); if (!line || line.startsWith('#') || !line.includes('=')) continue
    const [k, ...rest] = line.split('='); out[k.trim()] = rest.join('=').trim()
  }
  return out
}
const c = creds()
const db = tcb.init({ env: ENV_ID, secretId: c.TCB_SECRET_ID, secretKey: c.TCB_SECRET_KEY }).database()

async function fetchAll() {
  const rows = []
  for (let skip = 0; skip < 5000; skip += 100) {
    const res = await db.collection('products')
      .field({ title: true, name: true, category: true, rootCategoryName: true, price: true,
               isOffShelf: true, themeName: true, latinName: true, giftScenes: true })
      .skip(skip).limit(100).get()
    const batch = (res && res.data) || []
    rows.push(...batch)
    if (batch.length < 100) break
  }
  return rows
}

/** 逐件调 AI（OpenAI 兼容接口）；失败返回 null，交给上层记录 */
async function askAi(p) {
  const body = {
    model: 'deepseek-chat',
    temperature: 1.0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你是山海造物（自然标本藏品店）的命名编辑，擅长把博物藏品写成有场景感、有留白的短名。只输出 JSON。' },
      { role: 'user', content: `藏品标准名：${p.title}\n品类：${p.rootCategoryName || ''} / ${p.category || ''}\n价格：¥${p.price || 0}\n该商品按门店规则**只适合**这些礼赠场景：${[...new Set(proposeScenes({ price: Number(p.price) || 0, rootCategoryName: p.rootCategoryName || '', isOffShelf: false }))].join('/')}（scenes 只能从中选）\n\n${THEME_PROMPT_RULES}\n\n只输出 JSON：{"nameCandidates":[{"themeName":"","note":"","scenes":[]}]}` }
    ]
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const text = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
      const parsed = JSON.parse(String(text || '{}').replace(/^```(?:json)?|```$/g, '').trim())
      const allowed = new Set(proposeScenes({ price: Number(p.price) || 0, rootCategoryName: p.rootCategoryName || '', isOffShelf: false }))
      return normalizeThemeCandidates(parsed.nameCandidates, p.title).map((c) => {
        // 一致性：AI 自拟的场景必须落在「这件商品按 R0–R5 规则允许的场景」内
        const keep = (c.scenes || []).filter((k) => allowed.has(k))
        return { ...c, scenes: keep.length ? keep : [...allowed].slice(0, 3) }
      })
    } catch (e) {
      if (attempt === 1) { console.warn(`  ✗ ${String(p.title).slice(0, 16)}: ${e.message}`); return null }
      await new Promise((r) => setTimeout(r, 1200))
    }
  }
  return null
}

const rows = (await fetchAll()).filter((r) => r.isOffShelf !== true)
const done = existsSync(OUT) && !REDO ? JSON.parse(readFileSync(OUT, 'utf8')) : { at: '', items: {} }
const items = done.items || {}
const pending = rows.filter((r) => !items[r._id] || REDO)

if (REPORT_ONLY) {
  writeReport(rows, items); process.exit(0)
}
if (DRY) {
  console.log(`  在售商品 ${rows.length} 件；已有候选 ${Object.keys(items).length} 件；本次将处理 ${Math.min(LIMIT, pending.length)} 件`)
  for (const p of pending.slice(0, LIMIT)) console.log(`    · ${String(p.title).slice(0, 24)}  ¥${p.price || 0}  ${p.rootCategoryName || ''}`)
  console.log('  （--dry-run 不调用 AI、不写库；去掉该参数即执行）')
  process.exit(0)
}
if (!API_KEY) {
  console.error('✗ 缺少 DeepSeek key：请在 admin/.env 填 DEEPSEEK_API_KEY（或导出环境变量 DEEPSEEK_API_KEY）后重跑。')
  console.error('  提示：key 只用于本机生成候选清单，不会写入仓库。')
  process.exit(1)
}

const queue = pending.slice(0, LIMIT)
console.log(`  待处理 ${queue.length} 件（并发 ${CONC}）；已完成 ${Object.keys(items).length} 件将跳过`)
let ok = 0
for (let i = 0; i < queue.length; i += CONC) {
  const chunk = queue.slice(i, i + CONC)
  const results = await Promise.all(chunk.map(async (p) => ({ p, cands: await askAi(p) })))
  for (const { p, cands } of results) {
    if (cands) { items[p._id] = { title: p.title, root: p.rootCategoryName || '', price: p.price || 0, candidates: cands }; ok += 1 }
    else { items[p._id] = { title: p.title, root: p.rootCategoryName || '', price: p.price || 0, candidates: [], error: true } }
  }
  writeFileSync(OUT, `${JSON.stringify({ at: new Date().toISOString(), items }, null, 1)}\n`)
  console.log(`  进度 ${Math.min(i + CONC, queue.length)}/${queue.length}（成功 ${ok}）`)
}
writeFileSync(OUT, `${JSON.stringify({ at: new Date().toISOString(), items }, null, 1)}\n`)
writeReport(rows, items)
console.log(`  ✓ 结果：${OUT}`)
console.log('  ⚠️ 仅生成清单，未写库；复核后另跑写入脚本（带回滚文件）')

function writeReport(all, map) {
  const L = ['# 主题名候选 · 存量复核清单（2026-09-17）', '',
    '> **只读扫描 + AI 候选，未写入任何数据。** 复核后按圈定项写回（另一步，带回滚文件）。', '',
    '| # | 标准名（title，不动） | 品类 | 价格 | 候选主题名（含适合场景 / 一句话点题） |', '|---|---|---|---|---|']
  let i = 0
  for (const p of all) {
    const it = map[p._id]; if (!it || !it.candidates || !it.candidates.length) continue
    i += 1
    const cands = it.candidates.map((cd) => `**${cd.themeName}**${cd.scenes && cd.scenes.length ? `（${cd.scenes.join('/')}）` : ''}${cd.note ? ` — ${cd.note}` : ''}`).join('<br>')
    L.push(`| ${i} | ${p.title} | ${p.rootCategoryName || ''} | ¥${p.price || 0} | ${cands} |`)
  }
  L.push('', `共 ${i} 件有候选（在售 ${all.length} 件）。`)
  writeFileSync(REPORT, `${L.join('\n')}\n`)
  console.log(`  ✓ 复核清单：docs/主题名候选_存量复核_2026-09-17.md（${i} 件）`)
}
