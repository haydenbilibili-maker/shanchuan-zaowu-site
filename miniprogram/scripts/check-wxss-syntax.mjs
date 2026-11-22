/**
 * WXSS 语法体检守卫
 *
 * 起因（2026-09-19）：删「逐字落笔」动画时**没删干净**，`@keyframes` 的 `to { … }` 与收尾 `}`
 * 成了孤儿片段 → WXSS **编译失败** → 礼赠编排页整页打不开 ✗。开发者工具会报，但仓库守卫
 * 当时只管 wxml（`lint:wxml`），**没人管 wxss** —— 这个守卫补上这个缺口。
 *
 * 判据（都不需要跑编译器）：
 *   ① 每个 .wxss 的 `{`/`}` **配平**（剥注释后计数）；
 *   ② **`@keyframes` 之外的 `from {` / `to {` / `N% {`** 视为孤儿片段（删动画时的典型残留）；
 *   ③ `font-family` 里未加引号的中文族名；
 *   ④ A8 无限动画必须有 `prefers-reduced-motion` 减弱分支；
 *   ⑤ A9 `custom-tab-bar` 只许用自己的变量（它在**页面树之外**，取不到 `page{}` 令牌）；
 *   ⑥ **A10 全站**：`var(--x)` **不带兜底**时 `--x` 必须能解析（本文件 / `page{}` / `@import` 链 /
 *      运行时注入白名单）—— 见 A10 注释里的 `--radius-full` 真事故。
 *   ⑦ **A11 tab 栏 @import 闭包**：被 `custom-tab-bar` @import 的公共样式里，`var(--x)` 必须带字面量兜底 ——
 *      令牌能解析不代表 tab 栏取得到（它在页面树之外）。见 A11 注释里的购物车角标真事故。
 *
 * 用法：
 *   node miniprogram/scripts/check-wxss-syntax.mjs
 *   node miniprogram/scripts/check-wxss-syntax.mjs --selftest
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const MP = resolve(ROOT, 'miniprogram')
const SKIP = new Set(['node_modules', '.git', 'dist', 'miniprogram_npm'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.wxss')) out.push(p)
  }
  return out
}

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')

/** app.wxss 的 `page { }` 全局令牌（唯一事实源）—— A10 判定"能不能解析"时要用 */
function pageTokens() {
  const app = strip(readFileSync(join(MP, 'app.wxss'), 'utf8'))
  const i = app.indexOf('page {')
  if (i < 0) return new Set()
  const body = app.slice(i, app.indexOf('\n}', i))
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
}
const PAGE_TOKENS = pageTokens()

/**
 * 运行时注入的变量白名单 —— **每条都要写清谁注入的**。
 * 这些变量不在任何 wxss 里定义（由 wxml 内联 style 或 JS setData 注入），
 * 所以"本文件 / app.wxss / @import 链都找不到"是**正常**的，不是缺陷。
 */
const RUNTIME_SET_VARS = {
  '--donut-size': '由 JS 注入（`subpackages/manager/manager/managerPageConfig.js` 拼内联 style）',
  '--seg-tone': '由 wxml 内联 style 注入（`manager/workspace/_subviews.wxml`）'
}

/** 把一个 wxss 的 @import 链摊平后的令牌集合（相对路径 + `/` 开头都认） */
function importedTokens(abs, seen = new Set()) {
  const out = new Set()
  if (seen.has(abs)) return out
  seen.add(abs)
  let src = ''
  try { src = strip(readFileSync(abs, 'utf8')) } catch { return out }
  for (const m of src.matchAll(/@import\s+['"]([^'"]+)['"];?/g)) {
    const rel = m[1]
    const p = rel.startsWith('/') ? join(MP, rel) : resolve(dirname(abs), rel)
    for (const t of importedTokens(p, seen)) out.add(t)
    try { for (const d of strip(readFileSync(p, 'utf8')).matchAll(/(--[\w-]+)\s*:/g)) out.add(d[1]) } catch { /* 缺文件不管 */ }
  }
  return out
}

/** 取 `var(` 调用：返回 { name, hasFallback }（按括号配平找配对的 `)`，再找深度 0 的逗号） */
function varCalls(src) {
  const out = []
  for (const m of src.matchAll(/var\(/g)) {
    let i = m.index + m[0].length
    let depth = 1
    let comma = -1
    while (i < src.length && depth > 0) {
      const c = src[i]
      if (c === '(') depth += 1
      else if (c === ')') depth -= 1
      else if (c === ',' && depth === 1 && comma < 0) comma = i
      i += 1
    }
    const inner = src.slice(m.index + m[0].length, i - 1)
    const name = (inner.match(/^\s*(--[\w-]+)/) || [])[1]
    if (name) out.push({ name, hasFallback: comma > 0 })
  }
  return out
}

/** custom-tab-bar 的 @import 闭包（不含它自己；A9 管它自己） */
const TABBAR_IMPORTS = (() => {
  const out = new Set()
  const visit = (file) => {
    let src = ''
    try { src = strip(readFileSync(file, 'utf8')) } catch (e) { return }
    for (const m of src.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
      const next = resolve(dirname(file), m[1])
      if (out.has(next)) continue
      out.add(next)
      visit(next)
    }
  }
  visit(join(MP, 'custom-tab-bar/index.wxss'))
  return out
})()

function inspect(abs) {
  const src = strip(readFileSync(abs, 'utf8'))
  const problems = []
  const open = (src.match(/\{/g) || []).length
  const close = (src.match(/\}/g) || []).length
  if (open !== close) problems.push(`花括号不配平：{ ${open} vs } ${close}（多半是删规则时残留了片段）`)
  // font-family 里**未加引号的中文族名**：WXSS 编译器容忍度低，可能整条声明失效
  //   （2026-09-19 iOS 事故：`KaiTi, 楷体, "Songti SC"` → 手写体全线落回系统默认）
  src.split('\n').forEach((l, i) => {
    if (!/font-family/.test(l)) return
    const val = l.split('font-family:')[1] || ''
    const noQuoted = val.replace(/"[^"]*"/g, '').replace(/'/g, '')
    if (/[\u4e00-\u9fa5]/.test(noQuoted)) {
      problems.push(`第 ${i + 1} 行 font-family 含**未加引号的中文族名**（请写成 "楷体" 这类带引号形式）：${l.trim().slice(0, 48)}`)
    }
  })
  // 孤儿 from/to/N%：关键帧块必须**直接在** @keyframes 里（按花括号深度判定，避免把
  // `from { … }` 的收尾 `}` 误当成退出 keyframes —— 那样会产生大量误报 ✗）
  const lines = src.split('\n')
  let depth = 0
  let keyframesAt = -1      // 进入 @keyframes 时的深度（其直接子层 = keyframesAt + 1）
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i].trim()
    const isKeyframeStep = /^(from|to|\d+(\.\d+)?%)\s*\{/.test(l)
    if (isKeyframeStep && depth !== keyframesAt + 1) {
      problems.push(`第 ${i + 1} 行是 @keyframes 之外的关键帧块（孤儿片段）：${l.slice(0, 40)}`)
    }
    if (/@keyframes\b/.test(l) && l.includes('{')) keyframesAt = depth
    depth += (l.match(/\{/g) || []).length
    depth -= (l.match(/\}/g) || []).length
    if (keyframesAt >= 0 && depth <= keyframesAt) keyframesAt = -1
  }
  // A8（契约 C7 §5.3 / VI 规范 v1 §10.3）：带无限循环动画的选择器，必须在同文件的
  //   @media (prefers-reduced-motion: reduce) 里重写 animation —— 系统开「减少动态效果」时停在静止态。
  //   2026-10-15 全站补齐（54 个文件 / 148 个选择器），此后新增无限动画不带减弱分支即红。
  for (const sel of uncoveredInfinite(src)) {
    problems.push(`A8 无限动画 ${sel} 没有 prefers-reduced-motion 减弱分支（在同文件补 @media (prefers-reduced-motion: reduce) { ${sel} { animation: none; } }）`)
  }
  // A9：custom-tab-bar 渲染在**页面树之外**，app.wxss 的 `page{}` 令牌够不到它 ——
  //   写 var(--fs-20) 等于未定义：字号整条失效、回落成默认大字（2026-10-15 真事故：P3 字阶令牌化把
  //   底部 tab 的 20rpx/18rpx 换成令牌，真机字号变大）。本文件只许用自己定义的变量。
  if (/[\\/]custom-tab-bar[\\/]/.test(abs)) {
    const own = new Set([...src.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
    for (const m of src.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!own.has(m[1])) problems.push(`A9 custom-tab-bar 用了页面令牌 var(${m[1]})（tab 栏在页面树之外，取不到 app.wxss 的 page{} 变量 → 声明失效）：请写字面量`)
    }
  }
  // A10（2026-10-16）：**全站**任何 wxss 里 `var(--x)` **不带兜底值**时，`--x` 必须能解析 ——
  //   本文件定义 / app.wxss 的 `page{}` 全局 / `@import` 链 / 运行时注入白名单，四者之一。
  //   起因：`--radius-full` 被 **62 个文件**引用却**从未定义过** → `border-radius` 整条失效
  //   （本该全圆角的 pill / 头像渲染成直角），而且**静默不报错**；A9 只覆盖了 custom-tab-bar 一个目录。
  //   带兜底（`var(--x, fallback)`）的**不算缺陷** —— 那是规范写法，取不到也能优雅降级。
  const ownVars = new Set([...src.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
  const reachable = new Set([...PAGE_TOKENS, ...ownVars, ...importedTokens(abs)])
  for (const { name, hasFallback } of varCalls(src)) {
    if (hasFallback) continue
    if (reachable.has(name)) continue
    if (RUNTIME_SET_VARS[name]) continue
    problems.push(`A10 var(${name}) 解析不到（本文件与 app.wxss 的 page{} 与 @import 链都没有${name}，也不是运行时注入）→ 整条声明失效且无兜底：请定义令牌、或改成字面量、或写成 var(${name}, 兜底值)`)
  }
  // A11：custom-tab-bar **@import 进来的公共样式**同样在页面树之外（2026-11-22 真事故：styles/badges.wxss 被 P3 令牌化成
  //   var(--fs-16)，tab 栏购物车角标字号失效、回落默认大字，A9 只查 tab 栏自身文件没拦住）。
  //   公共文件还要给页面用，不必改回字面量：每个 var() 都必须带字面量兜底 var(--x, 值)。
  if (TABBAR_IMPORTS.has(abs)) {
    const own = new Set([...src.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
    for (const m of src.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
      if (!own.has(m[1])) problems.push(`A11 被 custom-tab-bar 引入的样式用了无兜底令牌 var(${m[1]})（tab 栏取不到 page{} 变量 → 声明失效）：写成 var(${m[1]}, 字面量)`)
    }
  }
  return problems
}

/** 深度 0 的规则：[头, 体]（at-rule 的内部作为体返回，由调用方决定是否下钻） */
function topRules(src) {
  const out = []
  let i = 0
  while (i < src.length) {
    const j = src.indexOf('{', i)
    if (j < 0) break
    let d = 1
    let k = j + 1
    while (k < src.length && d) { if (src[k] === '{') d += 1; else if (src[k] === '}') d -= 1; k += 1 }
    out.push([src.slice(i, j).trim(), src.slice(j + 1, k - 1)])
    i = k
  }
  return out
}
const INFINITE = /animation(?:-iteration-count)?\s*:[^;}]*\binfinite\b/
function uncoveredInfinite(src) {
  const need = []
  const covered = new Set()
  for (const [head, body] of topRules(src)) {
    if (head.startsWith('@media') && head.includes('prefers-reduced-motion')) {
      for (const [h2, b2] of topRules(body)) if (/animation\s*:/.test(b2)) h2.split(',').forEach((x) => covered.add(x.trim().replace(/\s+/g, ' ')))
    } else if (head.startsWith('@')) {
      continue
    } else if (INFINITE.test(body)) {
      head.split(',').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean).forEach((x) => { if (!need.includes(x)) need.push(x) })
    }
  }
  return need.filter((x) => !covered.has(x))
}

const files = walk(MP)
const failures = []
for (const f of files) {
  for (const p of inspect(f)) failures.push(`${relative(ROOT, f)}: ${p}`)
}

if (process.argv.includes('--selftest')) {
  const target = join(MP, 'subpackages/feature/gift/compose/index.wxss')
  const orig = readFileSync(target, 'utf8')
  let bad = 0
  const cases = [
    { name: '残留孤儿 to{…}（本次真事故）', inject: '\nto { opacity: 1; transform: translateY(0) rotate(0); }\n}\n' },
    { name: '少一个收尾 }', inject: '\n.x-orphan { color: red;\n' },
    { name: 'font-family 里未加引号的中文族名', inject: '\n.x-font { font-family: KaiTi, 楷体, serif; }\n' },
    { name: 'A8 新增无限动画但没有减弱动效分支', inject: '\n.x-spin { animation: x-spin 1s linear infinite; }\n' },
    { name: 'A9 custom-tab-bar 用页面令牌（底部 tab 字号变大真事故）', file: join(MP, 'custom-tab-bar/index.wxss'), inject: '\n.tab-text { font-size: var(--fs-20); }\n' },
    { name: 'A10 用了从未定义的令牌且无兜底（--radius-full 真事故）', file: join(MP, 'components/UserVipCard/index.wxss'), inject: '\n.x-probe { border-radius: var(--radius-nonexistent); }\n' },
    { name: 'A10 负例：带兜底值的未定义令牌应放行', file: join(MP, 'components/UserVipCard/index.wxss'), inject: '\n.x-probe-ok { color: var(--x-not-defined, #fff); }\n', expectPass: true },
    { name: 'A11 tab 栏引入的公共样式用无兜底令牌（购物车角标变大真事故）', file: join(MP, 'styles/badges.wxss'), inject: '\n.badge-solid-danger.badge-sm { font-size: var(--fs-16); }\n' }
  ]
  for (const c of cases) {
    const t = c.file || target
    const o = c.file ? readFileSync(t, 'utf8') : orig
    writeFileSync(t, o + c.inject)
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    writeFileSync(t, o)
    if (readFileSync(t, 'utf8') !== o) { console.log(`✗ 未能逐字还原`); bad += 1; continue }
    if (c.expectPass) {
      if (r.status === 0) console.log(`  ✓ 负例放行：${c.name}`)
      else { console.log(`✗ 负例被误报：${c.name}`); bad += 1 }
    } else if (r.status === 0) { console.log(`✗ 注入未被检出：${c.name}`); bad += 1 } else console.log(`  ✓ 已检出：${c.name}`)
  }
  if (bad) { console.log(`✗ 自检失败：${bad} 项`); process.exit(1) }
  console.log(`✓ 自检通过：${cases.length} 条注入全部被检出、源文件逐字还原`)
} else if (failures.length) {
  console.log('✗ WXSS 语法体检未通过：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failures.length} 处问题 / 共 ${files.length} 个 wxss`)
  process.exit(1)
} else {
  console.log(`✓ WXSS 语法体检通过（${files.length} 个文件：括号配平、无 @keyframes 孤儿片段、无限动画都有减弱动效分支）`)
}
