#!/usr/bin/env node
/**
 * 小程序侧对比度守卫 · `check:mp-contrast`
 *
 * 判据来源：`docs/小程序对比度实测_2026-09-19.md`（只读调研报告）§8.2。
 * 现状：小程序侧**全仓没有**对比度守卫；ERP 侧的 `admin/scripts/check-brand-contrast.mjs`
 * 只对**硬编码常量**算对比度（改一行 CSS 它不会红，属假绿形态），不能替代本守卫。
 *
 * ── 只做一件事（窄而硬）───────────────────────────────────────────────
 * 同一 CSS 规则块内同时出现 `color` 与 `background`/`background-color` 的配对。
 * 报告实测：62 条确证里有 60 条落在这一档，且这类配对**不依赖父面、不依赖运行时**、纯静态可判定。
 * 任何需要「父面 / 渐变位置 / 条件类名 / 运行时数据」的判定**一律不做** ——
 * 报告已证明同一条规则换个父面就从 1.73 变 5.37（假阳）或从 6.80 变 2.11（假阴）。
 *
 * ── 判据（按解析后的颜色值，不按令牌名）─────────────────────────────
 *   1. 两端 `var()` 递归解析到字面量（含 fallback）；解析不到 → 计入 `skipped`，**不判违规**；
 *   2. 背景 alpha == 1 → 直接算；半透明 → 在 7 种标准面上各合成一次，
 *      **只有 7 面全部低于阈值**才判 violation（=「与父面无关的不达」）；
 *      只要有一面达标 → suspect（父面相关，只打印不变红）；
 *   3. 阈值：font-size >= 48rpx → 3.0；>= 38rpx 且 bold → 3.0；其余（含未写 font-size）→ 4.5；
 *   4. 白名单逐条写明理由（见 WHITELIST），不为「变绿」扩容；
 *   5. 三档输出 violation / suspect / pass；`suspect` 只打印，**绝不变红**。
 *
 * 禁止：追父面、按令牌名判、把 suspect 当 violation、为让 CI 变绿扩白名单。
 *
 * 已知边界（诚实口径）：
 *   · 只覆盖「同规则配对」；报告 §3.3 的 C17/C18（`app.wxss` 全局类，需追父面）抓不到；
 *   · gradient()/url() 背景不解析（记 skipped，不猜第一个色停靠点）→ 报告 D4（`.plate-avatar`）抓不到；
 *   · 不追父面 → 报告里「父面已证」的 4 条半透明 C（C8/C10/C13/C16）与 D7 只会进 suspect，不算违规；
 *     这不是漏检，而是本守卫**只认「7 种标准面全部不达」这一种与父面无关的证明**（报告 §8.2 的原话）；
 *   · 不做 `!important`/特异性的跨规则层叠模拟（同规则内按 CSS 声明序 + !important 取生效值）；
 *   · 不做 WXML 可达性分析：`.tag-minerals`/`.tag-marine`/`.run-note` 报告判为死规则（§7.3）不计，
 *     本守卫照样计入（死规则也会渲染失败），故基线会比报告多 3 条；宁可红，不做会误杀的粗筛
 *     （报告 §4 复核 2 已证明「粗筛判死 CSS」不可信：`.btn.verify`/`.vc-btn` 经 `<include>`/`@import` 是活的）；
 *   · `#888`/`#222` 这类非令牌字面量照样按值判（S13 `.btn.retry` 报告因「可能有后置覆盖」存疑，
 *     实测该文件里没有任何后置规则覆盖它的 background → 按代码为准，判为 violation）。
 *
 * ── 与报告的差异（66 vs 62，**以代码为准**，报告 §8.2 的内部不一致已登记）────────
 * 报告的 62 是人工策展清单；同一份 §8.2 判据机械扫描实测 **66** 条：
 *   · 抓到报告 §3 的 55 条；
 *   · 报告漏登记 2 条真实违规：`.note-badge`（community，2.23）、`.footer-submit`（community/publish，2.72）；
 *   · 报告列为 suspect/dead 但按 §8.2「7 面全不达」应为违规的 9 条：
 *     `.tag-minerals` `.tag-marine` `.run-note`（死规则）＋ S10 的 4 条（ops-museum×2 / artisan-works / WalletPanelCoupons）
 *     ＋ S12 `.tag`(manager:889) ＋ S13 `.btn.retry`(ar:169)；
 *     ——报告 §5 给 S10 的区间是 4.22~4.41、S12 是 4.40，**全部 < 4.5**，与它自己的 §8.2 判据矛盾（§5 vs §8.2 冲突）；
 *   · 报告 D6 记 1 条，本守卫命中 `.voice-hold`/`.voice-play` 两个选择器（报告 §3.6 自己也说「各计 1 条」）。
 * 若把基线强行压到 ≤62，守卫在 HEAD 就是红的（= 阻塞项）；故棘轮基线冻结在**本守卫实测值**（见 baseline 的 total）。
 *
 * 用法：
 *   node miniprogram/scripts/check-mp-contrast.mjs             # 检查（棘轮）
 *   node miniprogram/scripts/check-mp-contrast.mjs --report    # 只报告全量三档清单
 *   node miniprogram/scripts/check-mp-contrast.mjs --json      # 机器可读
 *   node miniprogram/scripts/check-mp-contrast.mjs --update    # 修完一批后重设棘轮基线
 *   node miniprogram/scripts/check-mp-contrast.mjs --selftest
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP = resolve(ROOT, 'miniprogram')
const BASELINE = resolve(HERE, 'mp-contrast-baseline.json')
const SKIP_DIRS = new Set(['node_modules', '.git', 'miniprogram_npm', 'dist'])

/** 报告 §8.2 列的 7 种标准面（3 深 + 4 浅）；半透明底必须在其上「全部」不达才定案 */
const SURFACES = ['#1A1814', '#1F1D1A', '#262320', '#FAF6ED', '#F2EDE4', '#EFE8DA', '#FFFFFF']

/**
 * 白名单 —— **每一条都要写明理由**。不许「因为红了所以加」。
 * 报告 §7 已排除的 8 条禁用态（WCAG 1.4.3 豁免）+ §8.2 列的纯装饰类。
 * 产品明确接受（附 issue 号）的条目当前为 **0 条**：报告里没有登记任何「接受」项，
 * 所以这里一条都不加 —— 宁可红，不许假绿。
 */
const WHITELIST = [
  { re: /\[disabled\]/, reason: 'WCAG 1.4.3：inactive 组件豁免（[disabled]）' },
  { re: /:disabled\b/, reason: 'WCAG 1.4.3：inactive 组件豁免（:disabled）' },
  { re: /\.(?:[\w-]*-)?disabled\b/, reason: 'WCAG 1.4.3：inactive 组件豁免（.disabled / .xxx-disabled）' },
  { re: /\bis-disabled\b/, reason: 'WCAG 1.4.3：inactive 组件豁免（.is-disabled）' },
  { re: /\bsubmitting\b/, reason: 'WCAG 1.4.3：提交中态视作 inactive（.submitting）' },
  { re: /\bcard-inactive\b/, reason: 'WCAG 1.4.3：失效卡整体 inactive（.card-inactive）' },
  { re: /\.card-specimen-back\b/, reason: '纯装饰：标本卡背纹，不承载文字语义' },
  { re: /\.hero-watermark\b/, reason: '纯装饰：会员卡水印' },
  { re: /\.bg-texture\b/, reason: '纯装饰：背景纹理' }
]

// ───────────────────────── 颜色 ─────────────────────────
const NAMED = { white: '#FFFFFF', black: '#000000' }

function parseColor(raw) {
  if (raw == null) return null
  let v = String(raw).trim().toLowerCase()
  if (!v) return null
  if (v === 'transparent') return { rgb: [0, 0, 0], alpha: 0, hex: 'transparent' }
  if (NAMED[v]) v = NAMED[v].toLowerCase()
  let m = /^#([0-9a-f]{3,8})$/.exec(v)
  if (m) {
    const h = m[1]
    let r; let g; let b; let a = 1
    if (h.length === 3 || h.length === 4) {
      r = parseInt(h[0] + h[0], 16); g = parseInt(h[1] + h[1], 16); b = parseInt(h[2] + h[2], 16)
      if (h.length === 4) a = parseInt(h[3] + h[3], 16) / 255
    } else if (h.length === 6 || h.length === 8) {
      r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16)
      if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255
    } else return null
    if ([r, g, b, a].some((n) => !Number.isFinite(n))) return null
    return { rgb: [r, g, b], alpha: a, hex: toHex([r, g, b]) }
  }
  m = /^rgba?\(([^)]*)\)$/.exec(v)
  if (m) {
    const parts = m[1].split(/[,\s/]+/).map((s) => s.trim()).filter(Boolean)
    if (parts.length < 3) return null
    const chan = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)))
    let alpha = 1
    if (parts[3] != null) alpha = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
    if ([...chan, alpha].some((n) => !Number.isFinite(n))) return null
    const rgb = chan.map((n) => Math.max(0, Math.min(255, Math.round(n))))
    return { rgb, alpha: Math.max(0, Math.min(1, alpha)), hex: toHex(rgb) }
  }
  return null
}

const toHex = (rgb) => '#' + rgb.map((n) => Math.round(n).toString(16).padStart(2, '0').toUpperCase()).join('')

const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
function luminance([r, g, b]) {
  return 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255)
}
function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
const over = (fg, alpha, bg) => fg.map((c, i) => alpha * c + (1 - alpha) * bg[i])

// ───────────────────────── CSS 解析 ─────────────────────────
/** 注释替换成等长空白（保留换行）→ 行号不漂移。报告 §10.5 同口径。 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
}
const lineOf = (css, index) => css.slice(0, index).split('\n').length

function findRules(css) {
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const selector = m[1].trim()
    if (!selector || selector.startsWith('@')) continue
    const lead = m[1].length - m[1].trimStart().length
    rules.push({ selector, body: m[2], line: lineOf(css, m.index + lead) })
  }
  return rules
}

/** 按 CSS 声明序 + !important 取生效声明 */
function cascadePick(decls, props) {
  let chosen = null
  for (const d of decls) {
    if (!props.includes(d.prop)) continue
    if (chosen && chosen.important && !d.important) continue
    chosen = d
  }
  return chosen
}

function splitTop(str, sep) {
  const out = []
  let depth = 0
  let quote = null
  let cur = ''
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (quote) {
      cur += c
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue }
    if (c === '(') depth++
    else if (c === ')') depth--
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out
}

function parseDecls(body) {
  return splitTop(body, ';').map((chunk) => {
    const idx = splitTop(chunk, ':')
    if (idx.length < 2) return null
    const prop = idx[0].trim().toLowerCase()
    let value = idx.slice(1).join(':').trim()
    if (!prop || !value) return null
    let important = false
    if (/!\s*important\s*$/i.test(value)) { important = true; value = value.replace(/!\s*important\s*$/i, '').trim() }
    return { prop, value, important }
  }).filter(Boolean)
}

function collectTokens(css) {
  const map = Object.create(null)
  const re = /(--[\w-]+)\s*:\s*([^;{}]+)/g
  let m
  while ((m = re.exec(css))) map[m[1]] = m[2].trim()
  return map
}

function matchParen(s, open) {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') { depth--; if (depth === 0) return i }
  }
  return -1
}

function topLevelComma(s) {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') depth--
    else if (s[i] === ',' && depth === 0) return i
  }
  return -1
}

/** 递归解析 var()（含 fallback）；任何一环解析不到 → null（不猜） */
function resolveVars(value, maps, depth = 0) {
  if (value == null || depth > 12) return null
  let out = ''
  let i = 0
  while (i < value.length) {
    const idx = value.indexOf('var(', i)
    if (idx === -1) { out += value.slice(i); break }
    out += value.slice(i, idx)
    const open = idx + 3
    const close = matchParen(value, open)
    if (close === -1) return null
    const inner = value.slice(open + 1, close)
    const comma = topLevelComma(inner)
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma === -1 ? null : inner.slice(comma + 1)
    let raw = null
    for (const map of maps) { if (map && Object.prototype.hasOwnProperty.call(map, name)) { raw = map[name]; break } }
    if (raw == null) {
      if (fallback == null) return null
      raw = fallback
    }
    const sub = resolveVars(raw, maps, depth + 1)
    if (sub == null) return null
    out += sub
    i = close + 1
  }
  return out
}

/** 从 background 简写里抠出颜色；gradient/url 一律不解析 */
function backgroundColor(value) {
  const direct = parseColor(value)
  if (direct) return { color: direct }
  let v = value
  // 去掉所有函数调用（url()/linear-gradient()/rgba() 等）
  for (;;) {
    const idx = v.indexOf('(')
    if (idx === -1) break
    const close = matchParen(v, idx)
    if (close === -1) break
    v = v.slice(0, Math.max(0, v.lastIndexOf(' ', idx))) + ' ' + v.slice(close + 1)
  }
  v = v.replace(/\b(?:no-repeat|repeat-x|repeat-y|repeat|cover|contain|center|left|right|top|bottom|fixed|local|scroll|none|border-box|padding-box|content-box|auto)\b/g, ' ')
  const c = parseColor(v.trim())
  if (c) return { color: c }
  return { color: null, reason: /gradient\(|url\(/i.test(value) ? 'gradient/图片背景（不解析，不猜）' : '背景值解析不到字面量' }
}

function thresholdOf(decls, maps) {
  const fs = cascadePick(decls, ['font-size'])
  const fw = cascadePick(decls, ['font-weight'])
  let rpx = null
  if (fs) {
    const v = resolveVars(fs.value, maps)
    if (v != null) {
      let m = /([\d.]+)\s*rpx/.exec(v)
      if (m) rpx = parseFloat(m[1])
      else if ((m = /([\d.]+)\s*px/.exec(v))) rpx = parseFloat(m[1]) * 2 // 1px = 2rpx（375 参考宽）
    }
  }
  let bold = false
  if (fw) {
    const v = resolveVars(fw.value, maps)
    if (v != null) bold = /^(?:bold|bolder|[6-9]00)$/i.test(v.trim())
  }
  if (rpx != null && rpx >= 48) return 3.0
  if (rpx != null && rpx >= 38 && bold) return 3.0
  return 4.5
}

function whitelistReason(selector, decls, maps) {
  for (const w of WHITELIST) if (w.re.test(selector)) return w.reason
  if (/(::?before|::?after|::?placeholder)/.test(selector)) {
    const c = cascadePick(decls, ['content'])
    if (c) {
      const v = resolveVars(c.value, maps)
      if (v != null && /^(?:none|''|""|normal)$/.test(v.trim())) return '伪元素无内容（纯装饰）'
    }
  }
  return null
}

// ───────────────────────── 扫描 ─────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.wxss')) out.push(p)
  }
  return out
}

function record(target, entry) { target.push(entry) }

function scan() {
  const globalTokens = collectTokens(stripComments(readFileSync(join(MP, 'app.wxss'), 'utf8')))
  const files = walk(MP).sort()
  const violation = []
  const suspect = []
  const skipped = []
  const whitelisted = []
  let pairs = 0

  for (const abs of files) {
    const rel = relative(ROOT, abs)
    const css = stripComments(readFileSync(abs, 'utf8'))
    const fileTokens = collectTokens(css)
    for (const rule of findRules(css)) {
      const decls = parseDecls(rule.body)
      const colorDecl = cascadePick(decls, ['color'])
      const bgDecl = cascadePick(decls, ['background', 'background-color'])
      if (!colorDecl || !bgDecl) continue // 不是「同规则配对」，不在判据范围

      const ruleTokens = Object.create(null)
      for (const d of decls) if (d.prop.startsWith('--')) ruleTokens[d.prop] = d.value
      const maps = [ruleTokens, fileTokens, globalTokens]

      const wl = whitelistReason(rule.selector, decls, maps)
      if (wl) { record(whitelisted, { file: rel, line: rule.line, selector: rule.selector, reason: wl }); continue }

      pairs += 1
      const where = { file: rel, line: rule.line, selector: rule.selector }

      const fgRaw = resolveVars(colorDecl.value, maps)
      const fg = fgRaw == null ? null : parseColor(fgRaw)
      if (!fg) { record(skipped, { ...where, reason: `color 解析不到字面量（${colorDecl.value}）` }); continue }

      const bgRaw = resolveVars(bgDecl.value, maps)
      if (bgRaw == null) { record(skipped, { ...where, reason: `background var() 解析不到字面量（${bgDecl.value}）` }); continue }
      const bgRes = backgroundColor(bgRaw)
      if (!bgRes.color) { record(skipped, { ...where, reason: bgRes.reason }); continue }
      const bg = bgRes.color

      if (bg.alpha === 0) { record(skipped, { ...where, reason: '背景 transparent（没有可判的底）' }); continue }
      if (fg.alpha === 0) { record(skipped, { ...where, reason: '文字 transparent' }); continue }

      const threshold = thresholdOf(decls, maps)

      if (bg.alpha === 1) {
        const ratio = contrast(over(fg.rgb, fg.alpha, bg.rgb), bg.rgb)
        if (ratio < threshold) {
          record(violation, { ...where, kind: 'opaque', fg: fg.hex, bg: bg.hex, ratio: +ratio.toFixed(3), threshold })
        }
        continue
      }

      const ratios = SURFACES.map((s) => {
        const base = parseColor(s).rgb
        const solid = over(bg.rgb, bg.alpha, base)
        return contrast(over(fg.rgb, fg.alpha, solid), solid)
      })
      const min = Math.min(...ratios)
      const max = Math.max(...ratios)
      if (max < threshold) {
        record(violation, {
          ...where, kind: 'translucent-all-fail', fg: fg.hex, bg: `${bg.hex}@${bg.alpha}`,
          ratio: +max.toFixed(3), min: +min.toFixed(3), max: +max.toFixed(3), threshold
        })
      } else {
        record(suspect, {
          ...where, fg: fg.hex, bg: `${bg.hex}@${bg.alpha}`,
          min: +min.toFixed(3), max: +max.toFixed(3), threshold,
          reason: '半透明底：7 种标准面里有达标面 → 实际父面决定，静态判不出'
        })
      }
    }
  }

  return { files: files.length, pairs, violation, suspect, skipped, whitelisted }
}

// ───────────────────────── 输出 ─────────────────────────
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const sortByRatio = (a, b) => a.ratio - b.ratio
const countsOf = (r) => ({
  violation: r.violation.length,
  suspect: r.suspect.length,
  pass: r.pairs - r.violation.length - r.suspect.length - r.skipped.length,
  skipped: r.skipped.length,
  whitelisted: r.whitelisted.length
})

function skippedSummary(rows) {
  const by = new Map()
  for (const r of rows) by.set(r.reason, (by.get(r.reason) || 0) + 1)
  return [...by.entries()].sort((a, b) => b[1] - a[1])
}

function printHuman(r, ratchet) {
  const c = countsOf(r)
  const full = has('--report')
  console.log('小程序对比度守卫（判据：同一规则内 color × background，窄而硬）')
  console.log(`扫描 ${r.files} 个 .wxss；候选配对 ${r.pairs} 对`)
  console.log(`violation ${c.violation} / suspect ${c.suspect} / pass ${c.pass} / skipped ${c.skipped} / 白名单 ${c.whitelisted}`)
  console.log('')

  if (r.violation.length) {
    console.log(`✗ violation（确证：背景不透明，或半透明底在 7 种标准面上全部不达）—— ${r.violation.length} 条：`)
    for (const v of [...r.violation].sort(sortByRatio)) {
      const range = v.kind === 'translucent-all-fail' ? `（7 面 ${v.min}~${v.max}）` : ''
      console.log(`  ${v.ratio.toFixed(3)}  ${v.file}:${v.line}  ${v.selector}  ${v.fg} on ${v.bg}${range}（阈值 ${v.threshold}）`)
    }
    console.log('')
  }

  if (r.suspect.length) {
    const rows = [...r.suspect].sort((a, b) => a.max - b.max)
    const shown = full ? rows : rows.slice(0, 30)
    console.log(`? suspect（半透明底在 7 面里有达标面 → 父面相关；**只打印不变红**）—— ${r.suspect.length} 条${full ? '' : `，列最紧的 30 条`}：`)
    for (const s of shown) {
      console.log(`  ${s.max.toFixed(3)}  ${s.file}:${s.line}  ${s.selector}  ${s.fg} on ${s.bg}（7 面 ${s.min}~${s.max}，阈值 ${s.threshold}）`)
    }
    if (!full && rows.length > shown.length) console.log(`  …另有 ${rows.length - shown.length} 条（完整清单：--report）`)
    console.log('')
  }

  if (r.skipped.length) {
    console.log(`– skipped（解析不到 → 不判违规）—— ${r.skipped.length} 条：`)
    for (const [reason, n] of skippedSummary(r.skipped)) console.log(`    ${n}  ${reason}`)
    if (full) for (const s of r.skipped) console.log(`      ${s.file}:${s.line} ${s.selector}  ← ${s.reason}`)
    console.log('')
  }

  if (r.whitelisted.length) {
    console.log(`= 白名单（逐条理由）—— ${r.whitelisted.length} 条：`)
    for (const w of r.whitelisted) console.log(`    ${w.file}:${w.line} ${w.selector}  ← ${w.reason}`)
    console.log('')
  }

  if (ratchet) {
    const base = ratchet.base
    if (!ratchet.problems.length) {
      console.log(`✓ 对比度棘轮：当前 ${c.violation} 条 ≤ 基线 ${base.total} 条（只许降不许涨）`)
    } else {
      console.log('✗ 对比度棘轮被突破（不得新增同规则对比度违规）：')
      for (const p of ratchet.problems) console.log('  - ' + p)
      console.log(`✗ ${ratchet.problems.length} 处越线（当前 ${c.violation} / 基线 ${base.total}）`)
    }
  }
}

const result = scan()
const counts = countsOf(result)

if (has('--selftest')) {
  // 用 exitCode 而不是 process.exit()：大 JSON 走管道时 process.exit 会截断未 flush 的 stdout
  process.exitCode = selftest()
} else if (has('--update')) {
  const countsByFile = {}
  for (const v of result.violation) countsByFile[v.file] = (countsByFile[v.file] || 0) + 1
  writeFileSync(BASELINE, JSON.stringify({
    _doc: '小程序对比度棘轮基线。总数与逐文件数**只许降不许涨**；修完一批用 --update 重设并说明理由。',
    _report: 'docs/小程序对比度实测_2026-09-19.md（人工策展确证 62 条；本守卫按 §8.2 判据机械扫描实测 66 条，见文件头「与报告的差异」）',
    at: new Date().toISOString(),
    total: counts.violation,
    counts: countsByFile
  }, null, 1) + '\n')
  console.log(`✓ 对比度棘轮基线已更新：${counts.violation} 条 / ${Object.keys(countsByFile).length} 个文件（suspect:${counts.suspect} skipped:${counts.skipped}）`)
} else {
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null
  let ratchet = null
  if (base) {
    const problems = []
    const nowByFile = {}
    for (const v of result.violation) nowByFile[v.file] = (nowByFile[v.file] || 0) + 1
    for (const [f, n] of Object.entries(nowByFile)) {
      const was = base.counts[f] || 0
      if (n > was) problems.push(`${f}: ${was} → ${n}（+${n - was}）` + (was === 0 ? '  ← 该文件此前无同规则对比度违规' : ''))
    }
    if (counts.violation > base.total) problems.push(`总量增长：${base.total} → ${counts.violation}（+${counts.violation - base.total}）`)
    ratchet = { base, problems }
  } else if (!has('--json') && !has('--report')) {
    console.log('✗ 缺少棘轮基线文件（先跑 --update 生成）')
    process.exitCode = 1
  }

  if (has('--json')) {
    console.log(JSON.stringify({ counts, ratchet: ratchet ? { baseTotal: ratchet.base.total, problems: ratchet.problems } : null, ...result }, null, 1))
  } else {
    printHuman(result, ratchet)
  }
  if (ratchet && ratchet.problems.length) process.exitCode = 1
}

// ───────────────────────── 自检 ─────────────────────────
function selftest() {
  const target = join(MP, 'pages/index/index.wxss')
  const orig = readFileSync(target)
  const hash = (b) => createHash('sha256').update(b).digest('hex')
  const origHash = hash(orig)
  const runGuard = (args) => {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: 'utf8' })
    let json = null
    try { json = JSON.parse(r.stdout) } catch { /* 非 JSON 输出留空 */ }
    return { ...r, json }
  }
  const restore = () => {
    writeFileSync(target, orig)
    const back = readFileSync(target)
    if (hash(back) !== origHash) {
      console.log('✗ 源文件未被逐字节还原 —— 自检不可信（请检查工作区）')
      process.exit(1)
    }
  }

  let ok = true
  try {
    // ① 注入已知违规：#fff on #52B788 = 2.47（报告 A3/A4 的同款）
    writeFileSync(target, Buffer.concat([orig, Buffer.from('\n.mp-contrast-selftest-probe { background: #52B788; color: #fff; }\n')]))
    const vio = runGuard(['--json'])
    const hit = (vio.json?.violation || []).find((v) => v.selector.includes('.mp-contrast-selftest-probe'))
    // 检出 = 被归入 violation（分类证明）；退出码是棘轮层的第二重证明（无基线时棘轮不参与）
    const redProof = existsSync(BASELINE) ? vio.status !== 0 : true
    const detected = !!hit && hit.ratio < hit.threshold && redProof
    console.log(`${detected ? '✓' : '✗'} 注入违规 #fff on #52B788 → ${hit ? `已检出（${hit.ratio} < ${hit.threshold}）` : '【漏检】'}；退出码 ${vio.status}（有基线时棘轮越线应为非 0）`)
    if (!detected) ok = false
    restore()
    console.log(`✓ 源文件逐字节还原（sha256 ${origHash.slice(0, 12)}…）`)

    // ② suspect 不得变红：半透明底在 7 面里「有达标面」→ 只能 suspect
    writeFileSync(target, Buffer.concat([orig, Buffer.from('\n.mp-contrast-selftest-suspect { background: rgba(196, 167, 108, 0.12); color: #6B5A24; font-size: 20rpx; }\n')]))
    const sus = runGuard(['--json'])
    const sHit = (sus.json?.suspect || []).find((v) => v.selector.includes('.mp-contrast-selftest-suspect'))
    const vHit = (sus.json?.violation || []).find((v) => v.selector.includes('.mp-contrast-selftest-suspect'))
    const nonRed = !!sHit && !vHit && sus.status === 0
    console.log(`${nonRed ? '✓' : '✗'} 注入 suspect → 分类为 suspect=${!!sHit} / violation=${!!vHit}；退出码 ${sus.status}（suspect 不得变红 → 应为 0）`)
    if (!nonRed) ok = false
    restore()
    console.log(`✓ 源文件逐字节还原（sha256 ${origHash.slice(0, 12)}…）`)

    // ③ suspect「不变红」的证明宽度（诚实口径）
    const real = runGuard(['--json'])
    const realNonRed = real.status === 0 && (real.json?.counts?.suspect || 0) > 0
    console.log(`${realNonRed ? '✓' : '✗'} 真实仓：suspect ${real.json?.counts?.suspect ?? '—'} 条且退出码 ${real.status} → 证明「suspect 不变红」在**全量真实语料**上成立，不是只有合成样例`)
    if (!realNonRed) ok = false
  } finally {
    restore()
  }
  console.log(ok ? '\n✓ 自检通过：已知违规被检出、suspect 不变红、源文件逐字节还原' : '\n✗ 自检失败')
  return ok ? 0 : 1
}
