#!/usr/bin/env node
/**
 * WXML 事件处理函数存在性：每个 `bindtap="x"` / `catchtap="x"` / `bind:change="x"` …… 的 x
 * 必须在同名 .js（及其相对 require / import 的本地模块，传递）里有定义。
 *
 * 背景（2026-10-13 分子级摸底）：收货地址页「手动新增」表单自 2026-09-15 起
 * 绑定的是 `onChooseRegion` / `toggleDefault`，JS 里实现的却叫 `onRegionChange` / `toggleFormDefault`
 * —— 点「省市区」毫无反应、保存必报「请选择省市区」，手动地址一个月没能保存成功，
 * 编译、lint:wxml、全部既有守卫都是绿的（微信只在运行时打一行 warning）。
 *
 * 判据：名字在源码里以方法 / 属性 / 赋值形式出现即算定义（`x(`、`x:`、`'x':`、`x =`、`.x =`、`['x']`）；
 * `catchtap="true"`（只拦冒泡的惯用写法）放行。动态生成的方法名在 JS 里写一行
 * `// wxml-handlers: 名1 名2` 声明。
 *
 * 用法：node miniprogram/scripts/check-wxml-handlers.mjs [--selftest]
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const SKIP_DIRS = new Set(['node_modules', 'cloudfunctions', 'scripts', 'docs', 'minitest'])
const ALLOWED = new Set(['true'])

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP_DIRS.has(n)) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.wxml')) out.push(p)
  }
  return out
}

function collectSource(root, file, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return ''
  seen.add(file)
  const src = readFileSync(file, 'utf8')
  let all = src
  for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1] || m[2]
    let p = spec.startsWith('/') ? join(root, spec) : spec.startsWith('.') ? resolve(dirname(file), spec) : null
    if (!p) continue
    if (!p.endsWith('.js')) p = existsSync(`${p}.js`) ? `${p}.js` : join(p, 'index.js')
    all += `\n${collectSource(root, p, seen)}`
  }
  return all
}

const esc = (s) => s.replace(/[$]/g, '\\$')
function isDefined(name, src) {
  const n = esc(name)
  const re = new RegExp(
    `(^|[\\s,{;])(async\\s+)?${n}\\s*(\\(|:|=[^=])|['"]${n}['"]\\s*:|\\.${n}\\s*=[^=]|\\[\\s*['"]${n}['"]\\s*\\]|\\b${n}\\s*[,}]`,
    'm'
  )
  if (re.test(src)) return true
  return [...src.matchAll(/\/\/\s*wxml-handlers:\s*([^\n]+)/g)].some((m) => m[1].split(/\s+/).includes(name))
}

export function scan(root) {
  const problems = []
  for (const wxml of walk(root)) {
    const js = wxml.replace(/\.wxml$/, '.js')
    if (!existsSync(js)) continue // include / template 片段：处理函数在宿主页
    const src = collectSource(root, js)
    const text = readFileSync(wxml, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    const seen = new Set()
    for (const m of text.matchAll(/\b(?:capture-bind|capture-catch|mut-bind|bind|catch):?[a-z]+\s*=\s*["']([^"'{}]+)["']/g)) {
      const name = m[1].trim()
      if (!name || ALLOWED.has(name) || seen.has(name)) continue
      seen.add(name)
      if (!isDefined(name, src)) {
        const line = text.slice(0, m.index).split('\n').length
        problems.push(`${relative(root, wxml)}:${line}  ${m[0].trim()}  → ${relative(root, js)} 里没有 ${name}`)
      }
    }
  }
  return problems
}

function selftest() {
  const dir = mkdtempSync(join(tmpdir(), 'wxml-handlers-'))
  const page = (rel, wxml, js) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, `${rel}.wxml`), wxml)
    if (js != null) writeFileSync(join(dir, `${rel}.js`), js)
  }
  const cases = []
  try {
    // 1. 真回归：地址页原样（绑定名与实现名不一致）必须检出两条
    const addrWxml = readFileSync(join(MP, 'subpackages/business/address/index.wxml'), 'utf8')
      .replace('bindchange="onRegionChange"', 'bindtap="onChooseRegion"')
      .replace('bindtap="toggleFormDefault"', 'bindtap="toggleDefault"')
    page('a/address', addrWxml, readFileSync(join(MP, 'subpackages/business/address/index.js'), 'utf8'))
    // 2. 不误报：方法简写 / async / 属性函数 / 箭头 / behavior 里定义 / catchtap="true" / 声明的动态名
    page('b/ok', '<view bindtap="a" catchtap="true" bind:change="b" bindinput="c" catchtouchmove="d" bindload="e" bindscroll="f"/>',
      "const beh = require('./beh')\nPage({ behaviors: [beh], a() {}, async b(e) {}, c: function () {}, d: () => {} })\n// wxml-handlers: f\n")
    writeFileSync(join(dir, 'b/beh.js'), 'module.exports = Behavior({ methods: { e() {} } })\n')
    // 3. 组件 methods 里缺失必须检出
    page('c/comp', '<view bindtap="onTap" catchtap="gone"/>', 'Component({ methods: { onTap() {} } })\n')
    // 4. 只在字符串 / 注释里出现不算定义
    page('d/str', '<view bindtap="ghost"/>', "Page({ x() { console.log('ghost is not here') } })\n")

    const res = scan(dir)
    const has = (s) => res.some((r) => r.includes(s))
    cases.push(['地址页回归：onChooseRegion 被检出', has('a/address.wxml') && has('onChooseRegion')])
    cases.push(['地址页回归：toggleDefault 被检出', has('toggleDefault')])
    cases.push(['合法定义形式全部不误报', !has('b/ok.wxml')])
    cases.push(['组件缺失方法被检出', has('c/comp.wxml') && has(' gone')])
    cases.push(['组件已定义方法不误报', !res.some((r) => r.includes('c/comp.wxml') && r.includes(' onTap'))])
    cases.push(['字符串里出现不算定义', has('d/str.wxml')])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  let bad = 0
  for (const [label, ok] of cases) {
    console.log(`${ok ? '✓' : '✗'} ${label}`)
    if (!ok) bad += 1
  }
  if (bad) {
    console.error(`✗ 自检失败 ${bad} 项`)
    process.exit(1)
  }
  console.log(`✓ 自检通过（${cases.length} 项）`)
}

if (process.argv.includes('--selftest')) selftest()
else {
  const problems = scan(MP)
  if (problems.length) {
    console.error(`✗ WXML 绑定了不存在的处理函数（${problems.length} 处）——运行时点了没反应：`)
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }
  console.log('✓ WXML 事件处理函数全部有定义')
}
