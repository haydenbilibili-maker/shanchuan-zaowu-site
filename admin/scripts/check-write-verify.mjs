#!/usr/bin/env node
/**
 * 写结果校验守卫
 *
 * 背景（2026-09-16 真实浏览器实测）：权限被拒时 CloudBase SDK **不抛错**，
 * 而是 resolve 一个带错误码的对象 `{ code: 'DATABASE_PERMISSION_DENIED', … }`。
 * 因此「await 一句写 + 弹一句成功」**在权限被拒时依然显示成功** —— 这是审计
 * P0-5 / P1「写失败被当成成功」最隐蔽的形态。
 *
 * 两条写路径的安全性不同：
 *   · **代理路径**（`cloud-fn`，仅 13 个集合走它）：服务端失败会返回 `success:false`，
 *     `callCloudFunction` 会**抛错** → 天然安全，本守卫不要求额外校验。
 *   · **CDN 直写路径**（其余集合）：可能静默 resolve 错误码 → **必须校验写结果**，
 *     否则就是假成功。
 *
 * **2026-09-16 更新（本守卫的关切面已收窄）**：`cloudbaseCdnDb.js` 的四个直写包装器
 * （`cdnAdd`/`cdnUpdate`/`cdnRemove`/`cdnSet`）现在**集中**调用 `assertNoWriteError()`，
 * 权限被拒会**由包装器自己抛 `WriteNotAppliedError`** —— 也就是说「权限被拒却假成功」
 * 这一类已经在**一个地方**根治，不再依赖每个调用点各自校验。
 *
 * 因此本守卫现在盯的是**残余关切**：`updated:0` / `deleted:0`（没有匹配到文档）——
 * 这类不会被集中层拦（一刀切会制造假失败），仍需要调用点明确语义（用 upsert 或断言）。
 * 基线里的历史项据此降级为「info」性质，但**棘轮照旧**：新增未校验直写仍会失败。
 *
 * 本守卫对 CDN 直写调用点要求附近存在校验证据：
 *   `assertWriteApplied` / `writeApplied` / `WriteNotAppliedError` / `success === false`
 *
 * 用法：
 *   node admin/scripts/check-write-verify.mjs            # 报告
 *   node admin/scripts/check-write-verify.mjs --update   # 复核后收编基线
 *   node admin/scripts/check-write-verify.mjs --strict   # 出现新的未校验写即失败
 *   node admin/scripts/check-write-verify.mjs --selftest # 证明会失败
 */
'use strict'

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADMIN = resolve(HERE, '..')
const SRC = join(ADMIN, 'src')
const BASELINE = join(HERE, 'write-verify-baseline.json')
const CLOUD_JS = join(SRC, 'cloud.js')

/**
 * 从 `cloud.js` 读 `COLLECTIONS` 的「键 → 集合名」映射。
 * 为什么需要：87 处写调用的集合实参不是字面量，其中最多的是 `COLLECTIONS.PRODUCTS` 这类
 * **常量引用** —— 它们完全可静态解析，不该被当成盲区（尤其 `products` 恰恰是 write:false）。
 */
export function readCollectionsMap(cloudSrc) {
  const start = cloudSrc.indexOf('export const COLLECTIONS = {')
  if (start < 0) return {}
  const body = cloudSrc.slice(start, cloudSrc.indexOf('\n}', start))
  const map = {}
  for (const m of body.matchAll(/^\s*([A-Z_0-9]+):\s*'([^']+)'/gm)) map[m[1]] = m[2]
  return map
}

/** 走代理的集合（与 utils/cloudbaseCdnDb.js 的 STORE_CONTENT_WRITE_COLLECTIONS 对齐） */
export const PROXIED_COLLECTIONS = [
  'banners', 'categories', 'activities', 'rewards', 'framers', 'care_guides',
  'custom_configs', 'custom_inquiries', 'pet_memorial_orders',
  'framer_recruit_applications', 'articles', 'cms_wikis', 'configs',
]

export const WRITE_HELPERS = [
  'cdnAdd', 'cdnUpdate', 'cdnSet', 'cdnRemove',
  'cdnUpsertSingleton', 'cdnUpsertDoc', 'cdnUpsertByWhere',
]

const VERIFY_RE = /assertWriteApplied|writeApplied|WriteNotAppliedError|success\s*===\s*false/

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(vue|js)$/.test(e.name)) out.push(p)
  }
  return out
}

/**
 * 找出「CDN 直写且未校验结果」的调用点。
 * @param {string} txt 文件内容
 * @param {string} rel 相对路径（用于报告）
 * @param {Set<string>} proxied 走代理的集合名
 * @returns {Array<{line:number, helper:string, collection:string}>}
 */
export function findUnverifiedWrites(txt, rel = '', proxied = new Set(PROXIED_COLLECTIONS), collectionsMap = {}) {
  const lines = txt.split('\n')
  const out = []
  for (const helper of WRITE_HELPERS) {
    // 1) 字面量集合名；2) `COLLECTIONS.KEY` 常量引用（可静态解析，不该算盲区）
    // 其余（真正的变量）留作已知盲区，由统计单独报出。
    const patterns = [
      { re: new RegExp(`\\b${helper}\\(\\s*(['"\`])([a-z_]+)\\1`, 'g'), pick: (m) => m[2] },
      { re: new RegExp(`\\b${helper}\\(\\s*COLLECTIONS\\.([A-Z_0-9]+)`, 'g'), pick: (m) => collectionsMap[m[1]] || null },
    ]
    for (const { re, pick } of patterns) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(txt))) {
        const collection = pick(m)
        if (!collection) continue
        if (proxied.has(collection)) continue
        const line = txt.slice(0, m.index).split('\n').length
        const ctx = lines.slice(Math.max(0, line - 25), line + 25).join('\n')
        if (VERIFY_RE.test(ctx)) continue
        out.push({ line, helper, collection })
      }
    }
  }
  return out
}

const CASES = [
  ['直写且不校验 → 命中', (c) => c.findUnverifiedWrites(`
    const save = async () => {
      await cdnUpdate('home_configs', id, { a: 1 })
      ElMessage.success('已保存')
    }`).length === 1],
  ['直写 + assertWriteApplied → 不命中', (c) => c.findUnverifiedWrites(`
    const save = async () => {
      const res = await cdnUpdate('home_configs', id, { a: 1 })
      assertWriteApplied('home_configs', res, '保存')
    }`).length === 0],
  ['直写 + writeApplied 判定 → 不命中', (c) => c.findUnverifiedWrites(`
    const res = await cdnUpdate('home_configs', id, { a: 1 })
    if (!writeApplied(res)) throw new Error('no')`).length === 0],
  ['代理集合的直写 → 不要求校验（代理会抛错）', (c) => c.findUnverifiedWrites(`
    await cdnUpdate('categories', id, { a: 1 })`).length === 0],
  ['代理 + 非代理混用 → 只报非代理那个', (c) => {
    const r = c.findUnverifiedWrites(`
      await cdnUpdate('categories', id, { a: 1 })
      await cdnUpdate('stores', id, { a: 1 })`)
    return r.length === 1 && r[0].collection === 'stores'
  }],
  ['变量集合名 → 静态不可判，不误报', (c) => c.findUnverifiedWrites(`
    await cdnUpdate(colName, id, { a: 1 })`).length === 0],
  ['COLLECTIONS.KEY 常量引用可解析（不该算盲区）', (c) => {
    const map = { PRODUCTS: 'products' }
    const r = c.findUnverifiedWrites(`await cdnUpdate(COLLECTIONS.PRODUCTS, id, { stock: 1 })`, '', new Set(), map)
    return r.length === 1 && r[0].collection === 'products'
  }],
  ['COLLECTIONS.X 指向代理集合 → 不要求校验', (c) => {
    const map = { BANNERS: 'banners' }
    return c.findUnverifiedWrites(`await cdnAdd(COLLECTIONS.BANNERS, d)`, '', c.PROXIED_COLLECTIONS, map).length === 0
  }],
  ['校验出现在同一函数内的较远处（窗口内）→ 不命中', (c) => c.findUnverifiedWrites(`
    const save = async () => {
      const res = await cdnUpdate('stores', id, { a: 1 })
      await doOther()
      await doMore()
      assertWriteApplied('stores', res, '保存')
    }`).length === 0],
]

if (process.argv.includes('--selftest')) {
  console.log('自检：证明「该拦的会拦、该放的不拦」\n')
  let bad = 0
  for (const [label, fn] of CASES) {
    let ok = false
    let err = ''
    try { ok = !!fn({ findUnverifiedWrites, PROXIED_COLLECTIONS: new Set(PROXIED_COLLECTIONS) }) } catch (e) { err = e.message }
    console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` ${err}`}`)
    if (!ok) bad += 1
  }
  console.log()
  if (bad) {
    console.error(`自检失败：${bad} 项判定不符，守卫不可信。`)
    process.exit(1)
  }
  console.log('自检通过：未校验的直写会被拦，已校验/代理/变量集合不会误报。\n')
  process.exit(0)
}

const collectionsMap = readCollectionsMap(readFileSync(CLOUD_JS, 'utf8'))
const files = walk(SRC).filter((p) => !p.includes('cloudbaseCdnDb.js') && !p.includes('cloud.js'))
const findings = []
let variableWrites = 0
let proxiedWrites = 0
for (const p of files) {
  const txt = readFileSync(p, 'utf8')
  const rel = relative(ADMIN, p)
  for (const f of findUnverifiedWrites(txt, rel, new Set(PROXIED_COLLECTIONS), collectionsMap)) findings.push({ file: rel, ...f })
  // 只统计**非注释行**上的调用，避免把文档/注释里的示例也算进来
  // （上一版就因为这个把「变量集合」报成了约 87 处，是假的数字，已删）
  const codeLines = txt.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  for (const helper of WRITE_HELPERS) {
    const all = codeLines.match(new RegExp(`\\b${helper}\\(`, 'g')) || []
    const literal = codeLines.match(new RegExp(`\\b${helper}\\(\\s*['"\`][a-z_]+['"\`]`, 'g')) || []
    const constRef = codeLines.match(new RegExp(`\\b${helper}\\(\\s*COLLECTIONS\\.[A-Z_0-9]+`, 'g')) || []
    variableWrites += all.length - literal.length - constRef.length
    literal.forEach((s2) => {
      const c = s2.match(/['"`]([a-z_]+)['"`]/)[1]
      if (PROXIED_COLLECTIONS.includes(c)) proxiedWrites += 1
    })
  }
}
findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
const key = (f) => `${f.file}:${f.line} ${f.helper}('${f.collection}')`
const keys = findings.map(key)

console.log(`写结果校验守卫：扫描 ${files.length} 个文件`)
console.log(`  走代理（天然安全，不要求校验）：约 ${proxiedWrites} 处`)
console.log(`  集合名是变量、**静态不可判定**（本守卫覆盖不到）：${variableWrites} 处 —— 这是本守卫的已知盲区`)
console.log(`  CDN 直写但调用点未校验（残余关切：updated:0 类；权限被拒已由包装器集中抛出）：${findings.length} 处`)

let fail = 0
if (existsSync(BASELINE)) {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const known = new Set(base.unverified || [])
  const added = keys.filter((k) => !known.has(k))
  console.log(`\n棘轮：基线 ${known.size} 处 / 本次 ${keys.length} 处`)
  if (added.length) {
    console.error(`✗ 新增 ${added.length} 处未校验的直写（权限被拒时会假成功）：`)
    added.forEach((a) => console.error(`   ${a}`))
    fail += added.length
  } else {
    console.log('  无新增。')
  }
} else {
  console.log(`\n（未找到基线 ${BASELINE.replace(ADMIN + '/', '')}，用 --update 生成）`)
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({
    updatedAt: new Date().toISOString().slice(0, 10),
    note: '已知的「CDN 直写但未校验写结果」调用点。权限被拒时 SDK 不抛错 → 会假成功。'
      + '新增即失败；逐项改为 assertWriteApplied / writeApplied 后再 --update 收编。'
      + '走代理的集合不需要校验（代理失败会抛错），不计入。',
    unverified: keys,
  }, null, 2)}\n`, 'utf8')
  console.log(`已写入基线（${keys.length} 处）`)
  process.exit(0)
}

console.log()
if (fail || process.argv.includes('--strict') && findings.length === 0) process.exit(1)
if (findings.length) {
  console.log('当前未校验的调用点（按文件）：')
  const byFile = new Map()
  findings.forEach((f) => {
    if (!byFile.has(f.file)) byFile.set(f.file, [])
    byFile.get(f.file).push(f)
  })
  ;[...byFile.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([file, list]) => {
    console.log(`   ${file}  (${list.length})`)
    list.slice(0, 3).forEach((f) => console.log(`      ${f.line}  ${f.helper}('${f.collection}')`))
    if (list.length > 3) console.log(`      …另有 ${list.length - 3} 处`)
  })
}
console.log(fail ? '\n✗ 守卫失败。' : '\n通过（仍有待收编的历史项，见基线）。')
process.exit(fail ? 1 : 0)
