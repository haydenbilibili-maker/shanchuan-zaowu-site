#!/usr/bin/env node
/**
 * 按压态停留时长守卫（2026-11-22 交互质感巡查）
 *
 * 微信 view 的 hover-stay-time 默认 400ms：只写 hover-class 不写停留时长，松手后元素还暗 0.4 秒，显得「粘手」。
 * 项目口径（app.wxss .tap-press 注释）：hover-class 必须配 hover-stay-time（通常 80）。巡查时全仓 262 处已补齐，此后为硬判据。
 *
 * 用法：node miniprogram/scripts/check-hover-stay.mjs [--selftest]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const SKIP = new Set(['node_modules', 'miniprogram_npm', 'scripts', 'cloudfunctions', 'docs', '.tmp', '.git'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.wxml')) out.push(p)
  }
  return out
}

/** 返回缺停留时长的标签摘要（hover-class="none" 不算） */
export function missing(src) {
  const text = src.replace(/<!--[\s\S]*?-->/g, '')
  const out = []
  for (const m of text.matchAll(/<(view|text|button|navigator)\b((?:[^>"]|"[^"]*")*)>/g)) {
    const hc = /hover-class="([^"]*)"/.exec(m[2])
    if (!hc || hc[1] === 'none' || /hover-stay-time=/.test(m[2])) continue
    out.push(`<${m[1]} … hover-class="${hc[1]}"`)
  }
  return out
}

function scan(read) {
  const bad = []
  for (const abs of walk(MP)) {
    for (const t of missing(read(abs))) bad.push(`${relative(MP, abs)}: ${t}`)
  }
  return bad
}

const fsRead = (abs) => readFileSync(abs, 'utf8')

if (process.argv.includes('--selftest')) {
  const cases = [
    ['view 只写 hover-class', '<view class="x" bindtap="a" hover-class="tap-press">x</view>', true],
    ['text 条件 hover-class', '<text bindtap="a" hover-class="{{on ? \'tap-press\' : \'none\'}}">x</text>', true],
    ['跨行属性', '<view\n  class="x"\n  hover-class="tap-press-soft"\n>x</view>', true],
    ['写全不误报', '<view hover-class="tap-press" hover-stay-time="80">x</view>', false],
    ['hover-class="none" 不误报', '<view hover-class="none">x</view>', false],
    ['注释里不误报', '<!-- <view hover-class="tap-press"> -->', false]
  ]
  let ok = scan(fsRead).length === 0
  console.log(`${ok ? '✓' : '✗'} 基线：真源码 0 处缺失`)
  for (const [name, src, red] of cases) {
    const hit = missing(src).length > 0
    const pass = hit === red
    console.log(`${pass ? '✓' : '✗'} ${red ? '注入' : '对照'}「${name}」→ ${hit ? '检出' : '未检出'}`)
    if (!pass) ok = false
  }
  console.log(ok ? '✓ selftest 通过' : '✗ selftest 失败')
  process.exit(ok ? 0 : 1)
}

const bad = scan(fsRead)
if (bad.length) {
  console.log(`✗ ${bad.length} 处 hover-class 没写 hover-stay-time（微信 view 默认 400ms，松手后仍暗，显得粘手；项目口径 80）：`)
  bad.slice(0, 30).forEach((b) => console.log('  - ' + b))
  process.exit(1)
}
console.log('✓ 按压态停留时长：所有 hover-class 均配 hover-stay-time')
