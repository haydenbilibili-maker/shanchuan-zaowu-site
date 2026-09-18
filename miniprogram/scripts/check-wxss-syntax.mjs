/**
 * WXSS 语法体检守卫
 *
 * 起因（2026-09-19）：删「逐字落笔」动画时**没删干净**，`@keyframes` 的 `to { … }` 与收尾 `}`
 * 成了孤儿片段 → WXSS **编译失败** → 礼赠编排页整页打不开 ✗。开发者工具会报，但仓库守卫
 * 当时只管 wxml（`lint:wxml`），**没人管 wxss** —— 这个守卫补上这个缺口。
 *
 * 两条判据（都不需要跑编译器）：
 *   ① 每个 .wxss 的 `{`/`}` **配平**（剥注释后计数）；
 *   ② **`@keyframes` 之外的 `from {` / `to {` / `N% {`** 视为孤儿片段（删动画时的典型残留）。
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
  return problems
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
    { name: 'font-family 里未加引号的中文族名', inject: '\n.x-font { font-family: KaiTi, 楷体, serif; }\n' }
  ]
  for (const c of cases) {
    writeFileSync(target, orig + c.inject)
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    writeFileSync(target, orig)
    if (readFileSync(target, 'utf8') !== orig) { console.log(`✗ 未能逐字还原`); bad += 1; continue }
    if (r.status === 0) { console.log(`✗ 注入未被检出：${c.name}`); bad += 1 } else console.log(`  ✓ 已检出：${c.name}`)
  }
  if (bad) { console.log(`✗ 自检失败：${bad} 项`); process.exit(1) }
  console.log(`✓ 自检通过：${cases.length} 条注入全部被检出、源文件逐字还原`)
} else if (failures.length) {
  console.log('✗ WXSS 语法体检未通过：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failures.length} 处问题 / 共 ${files.length} 个 wxss`)
  process.exit(1)
} else {
  console.log(`✓ WXSS 语法体检通过（${files.length} 个文件：括号配平、无 @keyframes 孤儿片段）`)
}
