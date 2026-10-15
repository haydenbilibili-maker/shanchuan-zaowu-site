#!/usr/bin/env node
/**
 * 全局零件守卫（VI 规范 v1 §8.9 · 升级路线 P6，2026-10-15）
 *
 * 把页面里反复手写、又反复写错的三件东西收成 app.wxss 零件：两栏行 `.ui-row*`、金额 `.ui-amount`、
 * 状态 pill `.ui-pill.is-*`。本守卫钉住零件在场 + 规范要求的关键声明不回退：
 *   · 金额 / 右列数值走等宽、不折行（纪律 05）；左标签走正文字族
 *   · 减免 is-off 只染金（color-primary）
 *   · 红 / 蓝 pill 的字走 *-on-tint（原色压同色淡底只有 3.0–3.8:1，2026-10-14 实测 34 处）
 *   · 零件上不出现阴影 / 发光（纪律 02）
 *
 * 用法：node miniprogram/scripts/check-ui-parts.mjs [--selftest]
 * 自检只改内存副本，不写盘。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = resolve(HERE, '..', 'app.wxss')

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
function rule(css, sel) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'm').exec(css)
  return m ? m[1] : null
}

export function judge(src) {
  const css = strip(src)
  const bad = []
  const need = (sel, re, why) => {
    const r = rule(css, sel)
    if (r === null) bad.push(`缺零件 ${sel}`)
    else if (re && !re.test(r)) bad.push(`${sel}：${why}`)
  }
  need('.ui-amount', /font-family:\s*var\(--font-mono\)[\s\S]*white-space:\s*nowrap|white-space:\s*nowrap[\s\S]*font-family:\s*var\(--font-mono\)/, '金额须等宽且不折行（纪律 05 / 08）')
  need('.ui-row', /justify-content:\s*space-between/, '两栏行须左右分布')
  need('.ui-row-l', /font-family:\s*var\(--font-body\)/, '左标签走正文字族')
  need('.ui-row-n', /color:\s*var\(--color-text-secondary\)/, '小注不低于说明色')
  need('.ui-row-v', /font-family:\s*var\(--font-mono\)/, '右列数值须等宽（纪律 05）')
  need('.ui-amount.is-off', /color:\s*var\(--color-primary\)/, '减免只染品牌金')
  need('.ui-pill', /white-space:\s*nowrap/, 'pill 不折行')
  need('.ui-pill.is-success', /color:\s*var\(--color-success\)/, '成功色')
  need('.ui-pill.is-warning', /color:\s*var\(--color-warning\)/, '提醒色')
  need('.ui-pill.is-error', /color:\s*var\(--color-error-on-tint\)/, '红淡底上的字须用 --color-error-on-tint')
  need('.ui-pill.is-info', /color:\s*var\(--color-info-on-tint\)/, '蓝淡底上的字须用 --color-info-on-tint')
  need('.ui-pill.is-brass', null)
  need('.ui-pill.is-muted', /color:\s*var\(--color-text-secondary\)/, '中性 pill 不低于说明色')
  for (const m of css.matchAll(/([^{}]*\.ui-(?:amount|row|pill)[^{}]*)\{([^}]*)\}/g)) {
    if (/(?:box|text)-shadow\s*:\s*(?!none)/.test(m[2])) bad.push(`${m[1].trim()}：零件不许有阴影 / 发光（纪律 02）`)
  }
  return bad
}

if (process.argv.includes('--selftest')) {
  const src = readFileSync(APP, 'utf8')
  const base = judge(src)
  if (base.length) { console.error('✗ 自检前提：真源须先通过\n  - ' + base.join('\n  - ')); process.exit(1) }
  const cases = [
    ['金额退回正文字体', (s) => s.replace('.ui-amount { font-family: var(--font-mono);', '.ui-amount { font-family: var(--font-body);')],
    ['右列数值退回正文字体', (s) => s.replace('.ui-row-v { flex-shrink: 0; font-family: var(--font-mono);', '.ui-row-v { flex-shrink: 0; font-family: var(--font-body);')],
    ['红 pill 退回原色（压不过淡底）', (s) => s.replace('.ui-pill.is-error { color: var(--color-error-on-tint);', '.ui-pill.is-error { color: var(--color-error);')],
    ['删掉一个 pill 变体', (s) => s.replace(/\.ui-pill\.is-info \{[^}]*\}\n/, '')],
    ['pill 加金色发光', (s) => s.replace('.ui-pill.is-brass { color: var(--brass-300);', '.ui-pill.is-brass { box-shadow: 0 0 12rpx rgba(196, 167, 108, 0.5); color: var(--brass-300);')]
  ]
  let bad = 0
  for (const [name, mut] of cases) {
    const s2 = mut(src)
    if (s2 === src) { bad += 1; console.log(`✗ 注入锚点失效：${name}`); continue }
    const hits = judge(s2)
    if (hits.length) console.log(`  ✓ 已检出：${name}（${hits[0]}）`)
    else { bad += 1; console.log(`✗ 未检出：${name}`) }
  }
  if (bad) { console.log(`✗ 自检失败 ${bad} 项`); process.exit(1) }
  console.log(`✓ 自检通过：${cases.length} 条内存注入全部检出，未写盘`)
} else {
  const bad = judge(readFileSync(APP, 'utf8'))
  if (bad.length) {
    console.log('✗ 全局零件守卫未通过：\n  - ' + bad.join('\n  - '))
    process.exit(1)
  }
  console.log('✓ 全局零件：两栏行 / 金额 / 状态 pill 在场，等宽、on-tint、不发光均未回退')
}
