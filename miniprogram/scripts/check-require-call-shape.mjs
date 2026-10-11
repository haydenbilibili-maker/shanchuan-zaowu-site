#!/usr/bin/env node
/**
 * 小程序「把对象当函数调」守卫（2026-10-11）
 *
 * 起因：礼赠领取页与注册引导卡写成 `const trackBehavior = require('…/utils/trackBehavior')`，
 * 而该模块导出的是 `{ trackBehavior, track, … }` 对象 —— 调用 `trackBehavior(…)` 必抛 TypeError。
 * 领取页的这一句在载入流程的 try 里，异常被吞成「柜门片刻未应」：**所有受礼人打不开领取页**；
 * 引导卡则在注册成功后抛错，`done` 事件永远发不出去。静态守卫（未定义名、const 重赋值）都看不出来。
 *
 * 判据：小程序全部 .js（不含云函数、node_modules、miniprogram_npm），`const X = require('相对路径')`
 * 解析到的模块若**确定**导出对象（`module.exports = { … }`，或 `module.exports = require(…)` 递归到对象，
 * 或只有 `exports.x =` / `module.exports.x =` 形式），则本文件出现 `X(` 调用即红。导出形态判不出的模块跳过（不误报）。
 *
 * 用法：node miniprogram/scripts/check-require-call-shape.mjs [--selftest]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const ROOT = resolve(MP, '..')
const SKIP_DIRS = new Set(['node_modules', 'miniprogram_npm', 'cloudfunctions', 'scripts', '.git'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) walk(abs, out)
    else if (name.endsWith('.js')) out.push(abs)
  }
  return out
}

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

function resolveModule(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  for (const cand of [base, `${base}.js`, join(base, 'index.js')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand
  }
  return null
}

/** 'object' | 'other' | null（判不出） */
function exportShape(file, files, seen = new Set()) {
  if (seen.has(file)) return null
  seen.add(file)
  const src = stripComments(files.get(file) ?? readFileSync(file, 'utf8'))
  const assigns = [...src.matchAll(/(^|[^.\w])module\.exports\s*=\s*([^\n;]*)/g)]
  if (assigns.length) {
    const rhs = assigns[assigns.length - 1][2].trim()
    if (rhs.startsWith('{')) return 'object'
    const req = /^require\(\s*['"]([^'"]+)['"]\s*\)/.exec(rhs)
    if (req) {
      const target = resolveModule(file, req[1])
      return target ? exportShape(target, files, seen) : null
    }
    return 'other'
  }
  if (/(^|[^.\w])(module\.)?exports\.\w+\s*=/.test(src)) return 'object'
  return null
}

function scan(files) {
  const hits = []
  for (const [file, raw] of files) {
    const src = stripComments(raw)
    for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const [, name, spec] = m
      const target = resolveModule(file, spec)
      if (!target || exportShape(target, files) !== 'object') continue
      const callRe = new RegExp(`(^|[^.\\w$])${name.replace(/\$/g, '\\$')}\\s*\\(`, 'g')
      const rest = src.slice(m.index + m[0].length)
      if (callRe.test(rest)) hits.push(`${relative(ROOT, file)}：${name} = require('${spec}') 导出是对象，却被当函数调用`)
    }
  }
  return hits
}

function loadFiles() {
  const files = new Map()
  for (const f of walk(MP)) files.set(f, readFileSync(f, 'utf8'))
  return files
}

function selftest() {
  const base = loadFiles()
  const recv = join(MP, 'subpackages/feature/gift/receive/index.js')
  const cases = [
    {
      name: '礼赠领取页把 trackBehavior 模块对象当函数调（10-11 事故原形）',
      file: recv,
      from: /const \{ trackBehavior \} = require\('\.\.\/\.\.\/\.\.\/\.\.\/utils\/trackBehavior'\)/,
      to: "const trackBehavior = require('../../../../utils/trackBehavior')",
      expectRed: true
    },
    {
      name: '直接 require analytics/index 当函数调',
      file: recv,
      from: /const \{ trackBehavior \} = require\('\.\.\/\.\.\/\.\.\/\.\.\/utils\/trackBehavior'\)/,
      to: "const trackBehavior = require('../../../../utils/analytics/index')",
      expectRed: true
    },
    {
      name: '不误报：解构取函数照常调用',
      file: recv,
      from: null,
      expectRed: false
    }
  ]
  let bad = 0
  for (const c of cases) {
    const files = new Map(base)
    if (c.from) {
      const src = files.get(c.file)
      if (!c.from.test(src)) { console.log(`✗ 锚点缺失：${c.name}`); bad += 1; continue }
      files.set(c.file, src.replace(c.from, c.to))
    }
    const red = scan(files).length > 0
    if (red === c.expectRed) console.log(`  ✓ ${c.name}${c.expectRed ? ' → 已检出' : ' → 未误报'}`)
    else { console.log(`  ✗ ${c.name}${c.expectRed ? ' → 未检出' : ' → 误报'}`); bad += 1 }
  }
  if (bad) { console.log(`✗ 自检失败 ${bad} 项`); process.exit(1) }
  console.log(`✓ 自检通过：${cases.length} 个用例（内存副本，不写盘）`)
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const files = loadFiles()
  const hits = scan(files)
  if (hits.length) {
    console.log('✗ 把模块导出的对象当函数调用（运行时必抛 TypeError）：')
    for (const h of hits) console.log(`  - ${h}`)
    process.exit(1)
  }
  console.log(`✓ require 调用形态：${files.size} 个小程序 JS，无「导出对象被当函数调」`)
}
