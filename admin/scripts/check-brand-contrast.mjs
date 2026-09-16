#!/usr/bin/env node
/**
 * ERP 黑金配色对比度守卫（WCAG AA）
 *
 * 背景（2026-09-16 品牌适配决策）：
 *   黑金是小程序的品牌色。ERP 做「适配」而非「复制」——品牌放外壳与点缀，
 *   工作台保持浅色以守住效率与视觉舒适度。
 *   这条约束的硬边界是**对比度**：
 *     · 亮金 #d4af37 在白底只有 2.10:1，gold-500 也只有 3.20:1 → 正文完全不可读；
 *     · 因此白底上一律用 gold-700（6.58:1），亮金只允许出现在深色面（>7:1）。
 *   本脚本把这条规则固化，防止后续有人为了「更像金」把亮金写回浅色面。
 *
 * 用法：
 *   node admin/scripts/check-brand-contrast.mjs
 *   node admin/scripts/check-brand-contrast.mjs --selftest   # 证明检查会失败
 */
'use strict'

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const TOKENS = resolve(HERE, '..', 'src', 'styles', 'design-tokens.css')

/** 允许的配对：[说明, 前景, 背景, 最低要求] */
const PAIRS = [
  ['主按钮：白字 on 主色', '#ffffff', '#6e5b28', 4.5],
  ['白底正文/链接：主色 on 白', '#6e5b28', '#ffffff', 4.5],
  ['表头：金 on 深面', '#d4b86a', '#2e2517', 4.5],
  ['侧栏：金 on 近黑', '#d4b86a', '#1c1a17', 4.5],
  ['侧栏：浅字 on 近黑', '#f5f2ec', '#1c1a17', 4.5]
]

/** 必须失败的反例：证明「亮金写进浅色面」能被抓住 */
const NEGATIVE = [
  ['亮金 #d4af37 on 白', '#d4af37', '#ffffff'],
  ['gold-500 #a88d42 on 白', '#a88d42', '#ffffff']
]

function toRgb(hex) {
  let h = String(hex).replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
}
const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
function luminance(hex) {
  const [r, g, b] = toRgb(hex).map(lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** 令牌文件里必须存在的黑金旋钮 */
const REQUIRED_TOKENS = [
  '--erp-black',
  '--erp-black-soft',
  '--erp-gold-on-dark',
  '--erp-table-head-bg',
  '--erp-table-head-fg',
  '--erp-gold-on-light'
]

function runChecks() {
  const failures = []
  let pass = 0
  const check = (name, ok, detail) => {
    if (ok) pass += 1
    else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  }

  PAIRS.forEach(([name, fg, bg, need]) => {
    const r = contrast(fg, bg)
    check(`${name} ≥ ${need}`, r >= need, `实际 ${r.toFixed(2)}:1`)
  })

  NEGATIVE.forEach(([name, fg, bg]) => {
    const r = contrast(fg, bg)
    check(`反例必须不达标：${name}`, r < 4.5, `实际 ${r.toFixed(2)}:1`)
  })

  const css = readFileSync(TOKENS, 'utf8')
  REQUIRED_TOKENS.forEach((t) => check(`令牌存在 ${t}`, css.includes(t)))
  check(
    '主色已转金（不应再是品牌绿 #2d6a4f）',
    !/--el-color-primary:\s*#2d6a4f/.test(css),
    '仍在使用品牌绿'
  )
  return { failures, pass }
}

if (process.argv.includes('--selftest')) {
  console.log('自检：把亮金写回浅色面时，检查必须失败\n')
  // 构造一个「违规」配对：gold-300 on 白 —— 模拟有人把亮金用在工作台上
  const bad = contrast('#d4b86a', '#ffffff')
  const detected = bad < 4.5
  console.log(`${detected ? '✓' : '✗'} 亮金 on 白（${bad.toFixed(2)}:1）→ ${detected ? '已检出' : '【漏检】'}`)
  if (!detected) {
    console.error('\n自检失败：亮金写进浅色面却没被抓到，检查不可信。')
    process.exit(1)
  }
  console.log('\n自检通过：违规配色会被判不达标。\n')
}

const { failures, pass } = runChecks()
console.log(`ERP 黑金配色对比度检查：${pass} 项通过，${failures.length} 项失败`)
if (failures.length) {
  console.error('\n失败明细：')
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('全部通过：黑金配色在浅色面与深色面均满足 AA，旋钮令牌齐备。')
