#!/usr/bin/env node
/**
 * 小程序 JS「给 const 重新赋值」守卫（2026-10-01，A 流细节雕刻 R1）
 *
 * 起因：馆藏页 `onFilterConfirm` 里 `const applied = {…}`，在「全部」tab 选了某个馆后又写 `applied = synced.applied`。
 * 运行时抛 TypeError → 后面的关面板 / 恢复 tabBar / 拉数据全部不执行：筛选面板关不掉、底栏消失，用户只能退出小程序。
 * 这类错误语法上合法、`node --check` 查不出、只在那一条分支里炸，静态读代码也很难看见。
 *
 * 判据：用 esbuild（astro 依赖，已随 `npm ci --include=dev` 安装）逐个转译小程序全部 .js，
 * 它对「必然抛错的 const 赋值」给出 `This assignment will throw because "x" is a constant` —— 出现即红。
 * esbuild 加载不了 = 无法判定 → exit 2（错题本 E16：不得当作通过）。
 *
 * 用法：
 *   node miniprogram/scripts/check-mp-const-assign.mjs
 *   node miniprogram/scripts/check-mp-const-assign.mjs --selftest   （内存注入，不写盘）
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const SKIP = new Set(['node_modules', 'miniprogram_npm', 'scripts', 'docs', '.tmp', 'cloudfunctions'])

let transformSync
try {
  ({ transformSync } = await import('esbuild'))
} catch (e) {
  console.error('✗ 无法加载 esbuild（先 npm ci --include=dev）—— 无法判定，不能当作通过')
  process.exit(2)
}

function listJs(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const f = join(dir, e.name)
    if (e.isDirectory()) listJs(f, out)
    else if (e.name.endsWith('.js')) out.push(f)
  }
  return out
}

/** 返回该源码里所有「必然抛错的 const 赋值」：[{ line, text }] */
function constAssignHits(src) {
  try {
    const r = transformSync(src, { loader: 'js', format: 'cjs', logLevel: 'silent' })
    return r.warnings.filter((w) => /is a constant/.test(w.text)).map((w) => ({ line: w.location && w.location.line, text: w.text }))
  } catch (e) {
    return (e.errors || [{ text: String(e.message || e) }]).map((er) => ({ line: er.location && er.location.line, text: `转译失败：${er.text}` }))
  }
}

function run(files, readSrc) {
  const hits = []
  for (const f of files) for (const h of constAssignHits(readSrc(f))) hits.push(`${relative(MP, f)}:${h.line} ${h.text}`)
  return hits
}

const CATEGORY = join(MP, 'pages/category/index.js')

function selftest() {
  let ok = true
  const expect = (name, cond) => {
    console.log(`${cond ? '✓' : '✗'} ${name}`)
    if (!cond) ok = false
  }
  const real = readFileSync(CATEGORY, 'utf8')
  const anchor = 'let applied = {\n      categoryValue: detail.categoryValue'
  expect('锚点存在：馆藏 onFilterConfirm 的 applied 是 let', real.includes(anchor))
  const injected = real.replace(anchor, anchor.replace('let applied', 'const applied'))
  expect('注入①：把馆藏 applied 改回 const → 判红', constAssignHits(injected).length === 1)
  expect('注入②：自增 const 计数器 → 判红', constAssignHits('const n = 0\nfunction f () { n++ }\n').length === 1)
  expect('注入③：解构出来的 const 被重新赋值 → 判红', constAssignHits('const { a } = obj\nfunction g () { a = 2 }\n').length === 1)
  expect('不误报：内层同名 let 遮蔽外层 const', constAssignHits('const x = 1\nfunction h () { let x = 2; x = 3; return x }\n').length === 0)
  expect('不误报：const 对象改属性', constAssignHits('const o = {}\no.k = 1\n').length === 0)
  expect('真源码当前为 0 处', run(listJs(MP), (f) => readFileSync(f, 'utf8')).length === 0)
  console.log(ok ? '✓ selftest 通过（判据能红、不误报）' : '✗ selftest 失败')
  process.exit(ok ? 0 : 1)
}

if (process.argv.includes('--selftest')) selftest()

const files = listJs(MP)
const hits = run(files, (f) => readFileSync(f, 'utf8'))
if (hits.length) {
  console.error(`✗ 小程序 JS 里有 ${hits.length} 处给 const 重新赋值（运行到那一行必抛 TypeError）：`)
  hits.forEach((h) => console.error('  ' + h))
  process.exit(1)
}
console.log(`✓ 小程序 ${files.length} 个 JS 无 const 重新赋值`)
