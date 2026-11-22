#!/usr/bin/env node
/**
 * 圆角角色守卫（2026-11-22 产品负责人「直角与圆角规范融合」，规范见 miniprogram/docs/圆角规范_直角圆角融合_2026-11-22.md）
 *
 * 原则：容器与控件圆、物件方、线条细。
 *   · 卡片 / 面板 / 标签 / 按钮 / 输入类选择器出现 ≤4rpx 圆角（0 / 1–4rpx）= 违规
 *   · 物件（票 / 证书 / 券 / 印 / 牌 / 框 / 纸）与线条（线 / 条 / 进度 / 把手 / 骨架线）豁免
 *   · 选择器名体现不了物件身份时，在规则体内写「radius:object」注释声明有意直角
 *   · 存量违规按文件记基线（第二批员工 / 商家端页面待改），**只许减不许增**；已改完的文件基线为 0
 *
 * 用法：
 *   node miniprogram/scripts/check-radius-roles.mjs            校验
 *   node miniprogram/scripts/check-radius-roles.mjs --update   改完一批后拧紧基线（只会变小，变大拒写）
 *   node miniprogram/scripts/check-radius-roles.mjs --selftest 内存注入，不写盘
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const BASELINE = join(HERE, 'radius-roles-baseline.json')
const SKIP = new Set(['node_modules', 'miniprogram_npm', '.git'])

/** 该圆的角色：选择器最后一个类名里出现这些词 */
const ROLE = /(card|panel|chip|tag|pill|btn|button|input|field|tile|block|box|banner|item|composer|cta)/i
/** 该方 / 该细的：物件与线条（命中即豁免） */
const EXEMPT = /(ticket|cert|coupon|seal|stamp|plate|namecard|store-card|frame|paper|serial|thread|mark|line|bar|rule|progress|handle|grip|slot|strip|notch|sheet|stub|label-print|receipt)/i
const SQUARE = /border-radius\s*:\s*(0|[1-4]rpx|[1-2]px)\s*;/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.wxss')) out.push(p)
  }
  return out
}

/** 返回 [{ sel, value }]：违规规则 */
export function violations(src) {
  // 规则体内写 /* radius:object */ = 有意的物件直角（选择器名体现不了物件身份时用，如「鉴」方印按钮）
  const text = src.replace(/\/\*\s*radius:object\s*\*\//g, '__RADIUS_OBJECT__').replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sq = m[2].match(SQUARE)
    if (!sq || m[2].includes('__RADIUS_OBJECT__')) continue
    const sels = m[1].trim().split(',').map((x) => x.trim()).filter(Boolean)
    for (const sel of sels) {
      const last = (sel.split(/\s+/).pop() || '').replace(/::?[a-z-]+(\([^)]*\))?/g, '')
      const classes = last.split('.').filter(Boolean).join(' ')
      if (!classes || /^@|^from$|^to$|%$/.test(classes)) continue
      if (EXEMPT.test(classes) || !ROLE.test(classes)) continue
      out.push({ sel, value: sq[1] })
    }
  }
  return out
}

function scan(read) {
  const counts = {}
  const detail = {}
  for (const abs of walk(MP)) {
    const rel = relative(MP, abs)
    const v = violations(read(abs, rel))
    if (v.length) { counts[rel] = v.length; detail[rel] = v }
  }
  return { counts, detail }
}

function judge(counts, base) {
  const problems = []
  const tighter = []
  for (const [rel, n] of Object.entries(counts)) {
    const b = base[rel] || 0
    if (n > b) problems.push(`${rel}: ${b} → ${n}`)
  }
  for (const [rel, b] of Object.entries(base)) {
    const n = counts[rel] || 0
    if (n < b) tighter.push(`${rel}: ${b} → ${n}`)
  }
  return { problems, tighter }
}

const fsRead = (abs) => readFileSync(abs, 'utf8')
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}

if (process.argv.includes('--selftest')) {
  const target = 'subpackages/feature/search/index.wxss'
  const cases = [
    ['卡片写回 4rpx 直角', (t) => t + '\n.x-result-card { border-radius: 4rpx; }\n', true],
    ['标签写回 2rpx 直角', (t) => t + '\n.x-filter-chip { padding: 0; border-radius: 2rpx; }\n', true],
    ['按钮 0 圆角', (t) => t + '\n.x-go-btn { border-radius: 0; }\n', true],
    ['物件（票根）保持直角不误报', (t) => t + '\n.x-ticket-card { border-radius: 4rpx; }\n', false],
    ['线条（进度条）不误报', (t) => t + '\n.x-progress-bar { border-radius: 2rpx; }\n', false],
    ['声明 radius:object 的按钮不误报', (t) => t + '\n.x-seal-btn { /* radius:object */ border-radius: 2rpx; }\n', false]
  ]
  let ok = judge(scan(fsRead).counts, base).problems.length === 0
  console.log(`${ok ? '✓' : '✗'} 基线：真源码无新增违规`)
  for (const [name, fn, expectRed] of cases) {
    const { counts } = scan((abs, rel) => (rel === target ? fn(fsRead(abs)) : fsRead(abs)))
    const red = judge(counts, base).problems.length > 0
    const pass = red === expectRed
    console.log(`${pass ? '✓' : '✗'} ${expectRed ? '注入' : '对照'}「${name}」→ ${red ? '检出' : '未检出'}`)
    if (!pass) ok = false
  }
  console.log(ok ? '✓ selftest 通过' : '✗ selftest 失败')
  process.exit(ok ? 0 : 1)
}

const { counts, detail } = scan(fsRead)
if (process.argv.includes('--update')) {
  const { problems } = judge(counts, base)
  if (problems.length && Object.keys(base).length) {
    console.log('✗ 拒绝写基线：以下文件违规变多（基线只许变小）：')
    problems.forEach((p) => console.log('  - ' + p))
    process.exit(1)
  }
  const sorted = Object.fromEntries(Object.keys(counts).sort().map((k) => [k, counts[k]]))
  writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`✓ 基线已写：${Object.keys(sorted).length} 个文件 / ${Object.values(sorted).reduce((a, b) => a + b, 0)} 处`)
  process.exit(0)
}

const { problems, tighter } = judge(counts, base)
const total = Object.values(counts).reduce((a, b) => a + b, 0)
if (problems.length) {
  console.log('✗ 圆角角色越线（卡片 / 标签 / 按钮 / 输入不再用 ≤4rpx 直角；物件与线条除外，规范见 docs/圆角规范_直角圆角融合_2026-11-22.md）：')
  for (const p of problems) {
    const rel = p.split(':')[0]
    console.log('  - ' + p)
    ;(detail[rel] || []).forEach((v) => console.log(`      ${v.sel} { border-radius: ${v.value} }`))
  }
  console.log('  改法：按角色取 var(--r-card / --r-control / --r-pill / --r-thumb)；确系物件请在选择器名里体现（ticket / cert / seal / plate …）')
  process.exit(1)
}
console.log(`✓ 圆角角色：存量待改 ${total} 处（${Object.keys(counts).length} 个文件，基线棘轮只减不增）`)
if (tighter.length) {
  console.log('  ℹ 以下文件已减少，可 --update 拧紧基线：')
  tighter.forEach((t) => console.log('    ' + t))
}
