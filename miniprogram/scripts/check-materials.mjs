#!/usr/bin/env node
/**
 * 材质规范守卫（2026-11-25 产品负责人「材质相关模块缺少统一规范，需要规范和统一」，
 * 规范见 miniprogram/docs/材质规范_纸与金属_2026-11-25.md）
 *
 *   M1 app.wxss 的材质令牌齐全、单行（多行自定义属性值是 iOS 真机已知坑）
 *   M2 登记的材质模块都在用令牌（var(--mat-*)），不再自调色
 *   M3 纸面规则里不用暗底文字色（--color-text-*：纸上会变成「浅字」）
 *   M4 纸上的黄铜实心面不配黑投影（纸上的黑影像贴了一块塑料；用 --mat-brass-shadow）
 *   M5 纸笺水印（content 为文字的 ::after）必须 z-index:0，且同文件正文抬层 z-index:1 —— 否则水印压住按钮
 *   M6 裸写的纸 / 墨 / 印色值（已有令牌的那几种）按文件棘轮只减不增
 *
 * 用法：
 *   node miniprogram/scripts/check-materials.mjs             校验
 *   node miniprogram/scripts/check-materials.mjs --update    迁移后拧紧 M6 基线（只会变小，变大拒写）
 *   node miniprogram/scripts/check-materials.mjs --selftest  内存注入，不写盘
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const BASELINE = join(HERE, 'materials-baseline.json')
const SKIP = new Set(['node_modules', 'miniprogram_npm', '.git', 'scripts', '.tmp'])

export const TOKENS = [
  '--mat-paper-tone', '--mat-paper-tone-deep', '--mat-paper-label', '--mat-paper-letter', '--mat-paper-kraft', '--mat-paper-grain', '--mat-paper-edge',
  '--mat-paper-frame', '--mat-paper-rule', '--mat-paper-shadow', '--mat-paper-shadow-press',
  '--mat-ink', '--mat-ink-body', '--mat-ink-soft', '--mat-ink-label',
  '--mat-brass', '--mat-brass-polished', '--mat-brass-edge', '--mat-brass-shadow', '--mat-brass-ink', '--mat-brass-pin',
  '--mat-blackgold', '--mat-blackgold-line', '--mat-porcelain',
  '--mat-seal', '--mat-seal-ink', '--mat-seal-tint', '--mat-seal-line', '--mat-press-shift'
]

/** 已接入规范的材质模块（新增材质模块在这里登记） */
export const MODULES = [
  'subpackages/extra/user/messages/index.wxss', // 山海有信 · 来信列表纸笺
  'subpackages/extra/user/messages/detail/index.wxss', // 山海有信 · 信件正文
  'subpackages/feature/detail/index.wxss', // 详情 · 标本签知识卡 / 来源说明
  'subpackages/extra/user/certificates/index.wxss', // 荣誉档案 · 证书缩样
  'subpackages/extra/user/achievements/index.wxss', // 成就 · 纸签
  'subpackages/feature/gift/hub/index.wxss', // 礼赠 · 页头纸签
  'subpackages/feature/gift/my-gifts/index.wxss', // 礼赠 · 人情账本
  'subpackages/feature/gift/compose/index.wxss', // 礼笺编排
  'subpackages/feature/gift/receive/index.wxss' // 礼笺拆封
]

/** M6：已有令牌的裸色值（纸 / 墨 / 印 / 别针） */
const RAW = /#(F3ECDD|E8DFCB|2E2618|8E3B2E|B08D57|6B5A3E|8A6F45)\b/gi

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.wxss') && p !== join(MP, 'app.wxss')) out.push(p)
  }
  return out
}

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const rules = (s) => [...strip(s).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }))

export function checkFile(rel, src) {
  const out = []
  if (MODULES.includes(rel) && !/var\(--mat-/.test(src)) out.push(`M2 ${rel} 已登记为材质模块，却没用任何 --mat-* 令牌`)
  const rs = rules(src)
  for (const { sel, body } of rs) {
    const onPaper = /background[^;]*var\(--mat-paper-(label|letter|kraft)\)/.test(body)
    if (onPaper && /(^|[^-])color:\s*var\(--color-text-/.test(body)) out.push(`M3 ${rel} ${sel}：纸面规则用了暗底文字色 --color-text-*`)
    if (/background[^;]*var\(--mat-brass\)/.test(body) && /box-shadow:[^;]*rgba\(0, 0, 0,/.test(body)) out.push(`M4 ${rel} ${sel}：纸上黄铜面配了黑投影`)
  }
  if (MODULES.includes(rel)) {
    const marks = rs.filter(({ sel, body }) => /::after$/.test(sel) && /content:\s*'[^']+'/.test(body) && /position:\s*absolute/.test(body))
    for (const { sel, body } of marks) {
      if (!/z-index:\s*0;/.test(body)) out.push(`M5 ${rel} ${sel}：文字水印没沉底（缺 z-index: 0）`)
      else if (!rs.some((r) => /z-index:\s*1;/.test(r.body) && /position:\s*relative/.test(r.body))) out.push(`M5 ${rel}：水印沉底了，但正文没抬层（缺 position: relative + z-index: 1）`)
    }
  }
  return out
}

export function checkTokens(app) {
  const out = []
  for (const t of TOKENS) {
    const m = app.match(new RegExp(`\\n\\s*${t}:([^\\n]*)`))
    if (!m) out.push(`M1 app.wxss 缺材质令牌 ${t}`)
    else if (!/;\s*$/.test(m[1])) out.push(`M1 app.wxss 令牌 ${t} 跨行或缺分号（必须单行）`)
  }
  return out
}

function scan(read) {
  const problems = [...checkTokens(read(join(MP, 'app.wxss'), 'app.wxss'))]
  const counts = {}
  for (const abs of walk(MP)) {
    const rel = relative(MP, abs).split('\\').join('/')
    const src = read(abs, rel)
    problems.push(...checkFile(rel, src))
    const n = (strip(src).match(RAW) || []).length
    if (n) counts[rel] = n
  }
  for (const rel of MODULES) if (!existsSync(join(MP, rel))) problems.push(`M2 登记的材质模块不存在：${rel}`)
  return { problems, counts }
}

function judge(counts, base) {
  const up = []; const down = []
  for (const [rel, n] of Object.entries(counts)) if (n > (base[rel] || 0)) up.push(`M6 ${rel}：裸纸墨色值 ${base[rel] || 0} → ${n}（改用 --mat-* 令牌）`)
  for (const [rel, b] of Object.entries(base)) if ((counts[rel] || 0) < b) down.push(`${rel}: ${b} → ${counts[rel] || 0}`)
  return { up, down }
}

const fsRead = (abs) => readFileSync(abs, 'utf8')
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}

if (process.argv.includes('--selftest')) {
  const msg = 'subpackages/extra/user/messages/index.wxss'
  const det = 'subpackages/feature/detail/index.wxss'
  const cases = [
    ['令牌跨行', 'app.wxss', (t) => t.replace('--mat-ink: #2E2618;', '--mat-ink:\n    #2E2618;'), true],
    ['删掉一枚令牌', 'app.wxss', (t) => t.replace(/\n\s*--mat-seal-tint:[^\n]*/, ''), true],
    ['模块退回自调色（不用任何令牌）', 'subpackages/extra/user/certificates/index.wxss', (t) => t.replace(/var\(--mat-[a-z-]+\)/g, '#F3ECDD'), true],
    ['纸卡用了暗底字色', det, (t) => t + '\n.x-paper-note { background: var(--mat-paper-label); color: var(--color-text-secondary); }\n', true],
    ['纸上黄铜钮配黑投影', msg, (t) => t + '\n.x-go { background: var(--mat-brass); box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.25); }\n', true],
    ['水印浮到正文之上', msg, (t) => t.replace(/(content: '山海';\n  position: absolute;\n  )z-index: 0;/, '$1z-index: 2;'), true],
    ['新写裸纸色', det, (t) => t + '\n.x-label { background: #F3ECDD; color: #2E2618; }\n', true],
    ['对照：令牌写法不误报', det, (t) => t + '\n.x-ok { background: var(--mat-paper-label); color: var(--mat-ink); box-shadow: var(--mat-paper-shadow); }\n', false],
    ['对照：暗底按钮黑投影不误报', det, (t) => t + '\n.x-dark-btn { background: var(--brass-400); box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.3); }\n', false]
  ]
  const red = (r) => r.problems.length > 0 || judge(r.counts, base).up.length > 0
  let ok = !red(scan(fsRead))
  console.log(`${ok ? '✓' : '✗'} 前提：真源码通过`)
  for (const [name, target, fn, expect] of cases) {
    const before = fsRead(join(MP, target))
    if (expect && fn(before) === before) { ok = false; console.log(`✗ 注入「${name}」→ 锚点失效（注入未发生）`); continue }
    const got = red(scan((abs, rel) => (rel === target ? fn(fsRead(abs)) : fsRead(abs))))
    const pass = got === expect
    if (!pass) ok = false
    console.log(`${pass ? '✓' : '✗'} ${expect ? '注入' : '对照'}「${name}」→ ${got ? '检出' : '未检出'}`)
  }
  console.log(ok ? '✓ selftest 通过（内存注入，不写盘）' : '✗ selftest 失败')
  process.exit(ok ? 0 : 1)
}

const { problems, counts } = scan(fsRead)
const { up, down } = judge(counts, base)

if (process.argv.includes('--update')) {
  if (up.length && existsSync(BASELINE)) { console.error('✗ 拒写：基线只许变小\n  ' + up.join('\n  ')); process.exit(1) }
  writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2) + '\n')
  console.log(`✓ 基线已拧紧（${Object.keys(counts).length} 个文件，合计 ${Object.values(counts).reduce((a, b) => a + b, 0)} 处）`)
  process.exit(0)
}

const all = [...problems, ...up]
if (all.length) {
  console.error('✗ check:materials\n  - ' + all.join('\n  - ') + '\n  规范：miniprogram/docs/材质规范_纸与金属_2026-11-25.md')
  process.exit(1)
}
if (down.length) console.log('ℹ 裸色值变少了，可 `--update` 拧紧基线：\n  ' + down.join('\n  '))
console.log(`✓ check:materials：令牌 ${TOKENS.length} 枚齐全 · 材质模块 ${MODULES.length} 个在用令牌 · 纸面无暗底字 / 黄铜无黑影 / 水印沉底 · 裸纸墨色值 ${Object.values(counts).reduce((a, b) => a + b, 0)} 处（棘轮）`)
