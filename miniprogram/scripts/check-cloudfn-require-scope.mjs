#!/usr/bin/env node
/**
 * 云函数禁止 require 函数目录之外的相对路径（cross 域；2026-09-29）
 *
 * 事故：listCategories/categoryTree.js 写了 `require('../seedCategories/categorySeed')`。
 * 本地仓库里两个目录挨着，能跑；但 `tcb fn deploy` 只打包**本函数目录**，
 * 线上每次调用都 `Cannot find module`，馆藏页每次白等 1.3–2.6 s 再走客户端兜底 —— 零报警。
 * 共享代码的正确做法是逐函数留副本，并在 check:shared-modules 登记一致性。
 *
 * 判据：miniprogram/cloudfunctions/<fn>/ 下（不含 node_modules）每个 .js 去注释后，
 * `require('./…' | '../…')` 解析后的路径必须仍在 <fn>/ 之内。
 * 存量越界登记在 BASELINE（棘轮：只许删）；登记条目已不再越界也判红，要求删掉该条。当前为空。
 *
 * 用法：
 *   node miniprogram/scripts/check-cloudfn-require-scope.mjs
 *   node miniprogram/scripts/check-cloudfn-require-scope.mjs --selftest   （注入全在内存，不写盘）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FN_DIR = resolve(HERE, '../cloudfunctions')

/** 存量越界：'<fn>/<file> → <spec>'；只许删、不许加（不属本流的函数只报不修时登记在这里） */
const BASELINE = []

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
const REQUIRE_RE = /require\s*\(\s*(['"`])(\.{1,2}\/[^'"`]*)\1\s*\)/g

/** files: { '<fn>/<相对路径>.js': 源码 } → 越界列表 '<fn>/<file> → <spec>' */
export function findEscapes(files) {
  const out = []
  for (const [rel, src] of Object.entries(files)) {
    const fn = rel.split('/')[0]
    const dir = posix.dirname(rel)
    for (const m of stripComments(src).matchAll(REQUIRE_RE)) {
      const target = posix.normalize(posix.join(dir, m[2]))
      if (target !== fn && !target.startsWith(fn + '/')) out.push(`${rel} → ${m[2]}`)
    }
  }
  return out.sort()
}

export function judge(escapes, baseline) {
  const problems = []
  escapes.filter((e) => !baseline.includes(e))
    .forEach((e) => problems.push(`越界 require（部署包只含本函数目录，线上必 Cannot find module）：${e}`))
  baseline.filter((b) => !escapes.includes(b))
    .forEach((b) => problems.push(`基线条目已不再越界，请从 BASELINE 删除（棘轮只许减少）：${b}`))
  return problems
}

function collectReal() {
  const files = {}
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(abs, name)
      const r = rel ? `${rel}/${name}` : name
      if (statSync(p).isDirectory()) walk(p, r)
      else if (name.endsWith('.js') && r.includes('/')) files[r] = readFileSync(p, 'utf8')
    }
  }
  walk(FN_DIR, '')
  return files
}

function selftest() {
  const real = collectReal()
  const cases = [
    { name: '★ 跨函数目录 require（本次事故原形）', files: { ...real, 'demoFn/tree.js': "const s = require('../seedCategories/categorySeed')" }, fail: true },
    { name: '★ 子目录里 ../../ 越出函数根', files: { ...real, 'demoFn/lib/a.js': 'require("../../other/x")' }, fail: true },
    { name: '★ 模板字符串形态', files: { ...real, 'demoFn/a.js': 'require(`../shared/x`)' }, fail: true },
    { name: '★ 基线条目已修好仍留着（棘轮）', files: real, baseline: ['ghostFn/a.js → ../x'], fail: true },
    { name: '反例：子目录 ../ 回到函数根内不误报', files: { ...real, 'demoFn/lib/a.js': "require('../util')" }, fail: false },
    { name: '反例：注释里的越界 require 不误报', files: { ...real, 'demoFn/a.js': "// require('../seedCategories/categorySeed')\n/* require('../x') */" }, fail: false },
    { name: '反例：已登记基线的存量越界不报', files: { ...real, 'legacyFn/a.js': "require('../x')" }, baseline: ['legacyFn/a.js → ../x'], fail: false }
  ]
  let bad = 0
  for (const c of cases) {
    const problems = judge(findEscapes(c.files), c.baseline || BASELINE)
    const ok = c.fail ? problems.length > 0 : problems.length === 0
    if (!ok) bad += 1
    console.log(`${ok ? '  ✓' : '✗'} ${c.name}${ok ? '' : ` — ${problems.join('; ') || '未检出'}`}`)
  }
  if (bad) {
    console.log(`✗ 自检失败：${bad} 项`)
    process.exitCode = 1
  } else {
    console.log(`✓ 自检通过：${cases.length} 条（4 条判红注入 + 3 条不误报反例，内存副本不写盘）`)
  }
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const files = collectReal()
  const fnCount = new Set(Object.keys(files).map((f) => f.split('/')[0])).size
  const problems = judge(findEscapes(files), BASELINE)
  if (problems.length) {
    console.log('✗ 云函数 require 越界：')
    problems.forEach((p) => console.log('  - ' + p))
    process.exitCode = 1
  } else {
    console.log(`✓ 云函数 require 均在本函数目录内（${fnCount} 个函数 / ${Object.keys(files).length} 个 .js；基线 ${BASELINE.length} 条）`)
  }
}
