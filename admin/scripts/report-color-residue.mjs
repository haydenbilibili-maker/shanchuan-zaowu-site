#!/usr/bin/env node
/**
 * 色彩残留分类器 —— **只报告，不改动**（审计 C.2 明确要求的第一步）
 *
 * 审计原文：「350 处绿色 rgba + 274 处 `var(--brand-green-*)` + 61 处硬编码绿/蓝 + 340 处 `#d4af37`。
 * **禁止 find-replace**（同一 token 可能是品牌色也可能是成功色），须先出「只报告不改动」的分类脚本」。
 *
 * 为什么不能 find-replace：`#2d6a4f` 同时出现在
 *   · 侧栏/主按钮 —— 那是**品牌色**，黑金决策后应改金；
 *   · `.el-tag--success` / 「已完成」—— 那是**成功语义**，必须留绿。
 * 两者字面量完全相同，靠正则替换必然把其中一个改错。所以本脚本的产出是**判断依据**，不是补丁：
 *
 *   ① 残留字面量清单：出现 ≥3 次、且**没有任何令牌取同值**的硬编码颜色；
 *      按色相归族，并给出**最近令牌**与 RGB 距离（机械可算，不含主观判断）。
 *   ② 语义角色：对绿色家族逐处给出 brand / success / viz / 待定，**并引用判定依据**
 *      （命中的关键词），便于人工复核而不是盲信。
 *   ③ 对比度风险：`color:` 用了明亮金（`#d4af37` 一类，白底 2.10:1）的位置，按「底是深是浅」的
 *      现有证据分成 确定有风险 / 确定安全 / 需人工判断。**弹层（popper）那条是确定有风险的**：
 *      已核实全仓没有任何规则给 `el-select-dropdown` / `el-popper` / `el-dropdown-menu` 设深底，
 *      而 Element Plus 的弹层是 teleport 到 body 的浅色面板 —— 组件自己的深色主题管不到它。
 *   ④ 棘轮：`color-residue-baseline.json` 记录每个字面量的出现次数，只能降不能升。
 *
 * 用法：
 *   node admin/scripts/report-color-residue.mjs              # 报告
 *   node admin/scripts/report-color-residue.mjs --json
 *   node admin/scripts/report-color-residue.mjs --list '#d4af37'   # 逐处列出，供人工走查
 *   node admin/scripts/report-color-residue.mjs --update     # 复核后写入基线
 *   node admin/scripts/report-color-residue.mjs --strict     # 残留变多即 exit 1
 *   node admin/scripts/report-color-residue.mjs --selftest   # 合成样本证明判定会失败
 */
'use strict'

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// 登录态标记的唯一事实源（2026-09-17 审计 A4）
import { ADMIN_TOKEN_KEY, ADMIN_TOKEN_VALUE } from '../src/utils/cloudFnErrors.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADMIN = resolve(HERE, '..')
const SRC = join(ADMIN, 'src')
const TOKENS_FILE = join(SRC, 'styles', 'design-tokens.css')
const BASELINE_PATH = join(HERE, 'color-residue-baseline.json')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const argOf = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}

// ─────────────────────────── 纯逻辑（可离线自检）───────────────────────────

const norm = (hex) => {
  let h = String(hex).toLowerCase()
  if (h.length === 4) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
  return h
}
const rgbOf = (hex) => {
  const h = norm(hex)
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}
const dist = (a, b) => {
  const [r1, g1, b1] = rgbOf(a)
  const [r2, g2, b2] = rgbOf(b)
  return Math.round(Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2))
}
/** sRGB 相对亮度（WCAG）*/
const lum = (hex) => {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = rgbOf(hex)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
/** 对比度（WCAG），1~21 */
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100
}

/** 「明亮金」家族：白底对比度不足 3:1 的金色，用作文字即不可读 */
export const BRIGHT_GOLDS = ['#d4af37', '#c4a76c', '#e0cfa3', '#f0d98c']

/** 色相归族：仅用于分组展示，取自 hex 自身，不含主观判断 */
export function hueFamily(hex) {
  const [r, g, b] = rgbOf(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const sat = max - min
  if (sat < 18) return max > 235 ? '中性-近白' : max < 60 ? '中性-近黑' : '中性-灰'
  if (r === max && g >= r * 0.62 && b < g * 0.72) return '金/土'
  if (g === max && r < g * 0.86) return '绿'
  if (b === max && r < b * 0.92) return '蓝'
  if (r === max) return '红'
  return '其他'
}

/** 弹层选择器：Element Plus 把弹层 teleport 到 body，组件内的深色主题管不到它 */
const POPPER_RE = /el-(select-dropdown|dropdown-menu|popper|autocomplete|date-picker|cascader|tooltip|popover|message-box|drawer|dialog)/

/** 深底证据（含 3 位简写与 black 关键字）*/
const DARK_BG_RE = /background(-color)?\s*:\s*(#(0[0-9a-f]|1[0-9a-f]|2[0-9a-f])[0-9a-f]{4}|#(000|111|222|333)\b|black\b|var\(--(erp-black|erp-black-soft|dark-|earth-9)|rgba?\(\s*(\d{1,2}|[0-3]\d)\s*,)/i
/** 浅底证据 */
const LIGHT_BG_RE = /background(-color)?\s*:\s*(#(f|e|d)[0-9a-f]{5}|#fff|white|var\(--light-bg|var\(--bg-light|rgba?\(\s*2[0-5]\d\s*,\s*2[0-5]\d)/i

/**
 * 同一文件是否**自己把弹层涂成深色**。
 *
 * 这是弹层判定的必要补充：`AIStrategicBrain.vue` 里
 * `.el-select-dropdown__item { color: #fff !important; background: #000 !important; }`
 * 明确把弹层刷黑了 —— 那它后面给 `.selected` 用的明亮金就是**金字黑底**，没问题。
 * 只看选择器名字会把它误判成「浅色弹层上的金字」。
 */
export function filePaintsPopperDark(text) {
  const re = /el-(?:select-dropdown|dropdown-menu|popper|autocomplete|date-picker)[^{}]*\{([^}]*)\}/g
  let m
  while ((m = re.exec(text))) {
    const bg = m[1].match(/background(?:-color)?\s*:\s*([^;!]+)/)
    if (bg && DARK_BG_RE.test(`background: ${bg[1].trim()}`)) return true
  }
  return false
}

/**
 * 判定一处 `color: <明亮金>` 是否有对比度风险。
 *
 * **重要：静态分析不知道哪条声明最终生效。** 实测 `:deep(.el-table th) { background: #f5f7fa;
 * color: #d4af37; }` 看着是「金字浅底」，但 `global-refinement.css` 里有
 * `background: var(--erp-table-head-bg) !important`（深底）—— `!important` 压过组件里的浅底，
 * 真实渲染是「金字深底」，浏览器实测 **7.8:1**，完全没问题；组件那段浅底是**死代码**。
 * 所以本函数只产出「嫌疑」，`same-block` 类证据必须再用 `--verify` 在浏览器里量一次才能定性。
 * 只有 `popper`（弹层）类证据足够强：弹层 teleport 到 body，组件里的深色主题与 `!important`
 * 都够不着它，且已核实全仓无弹层深底覆盖。
 *
 * @returns {{ risk: 'popper'|'same-block'|'safe'|'undecided', why: string }}
 */
export function goldTextRisk({ selector = '', block = '', popperPaintedDark = false }) {
  if (POPPER_RE.test(selector)) {
    if (popperPaintedDark) return { risk: 'safe', why: '本文件自己把弹层刷成了深色，金字深底没问题' }
    return { risk: 'popper', why: '弹层选择器（teleport 到 body 的浅色面板，本文件未把弹层刷深）' }
  }
  if (DARK_BG_RE.test(block)) return { risk: 'safe', why: '同一声明块内出现深色背景' }
  if (LIGHT_BG_RE.test(block)) {
    return { risk: 'same-block', why: '同一声明块内有浅色背景 —— **可能是死代码**（被别处 !important 覆盖），需浏览器实测' }
  }
  if (/aside|sidebar|\.erp-black|dark-|footer/i.test(selector)) return { risk: 'safe', why: '选择器指向已知深色容器' }
  return { risk: 'undecided', why: '无法从同块或选择器判定底色，需人工走查' }
}

/**
 * 绿色家族的语义角色：品牌色 vs 成功色 —— 审计点名的「同一 token 可能是品牌色也可能是成功色」
 *
 * 词表边界（自检里各有一条用例）：
 * - `active/selected/hover/focus` 属**交互态**（品牌），不是成功语义 —— 起初误放进 SUCCESS_RE，
 *   导致 `.el-menu-item.is-active` 被判成 success（自检当场抓到）。
 * - `未完成 / 未通过 / 失败 / 错误` 等**否定**语境必须先排除：`完成` 是 `未完成` 的子串，
 *   否则「未完成」会被判成 success，正是审计警告的那类错判。
 */
const SUCCESS_RE = /success|成功|已完成|完成|通过|正常|生效|已启用|已上架|达标|有效|valid|positive/i
const NEGATIVE_RE = /未完成|未通过|未达标|失败|错误|异常|失效|已下架|禁用|不可用|停用|作废|error|danger|failed|invalid/i
const BRAND_RE = /brand|primary|logo|\.aside|sidebar|el-menu|nav-|header|hero|accent|主题色|品牌|主色|active|selected|hover|focus/i
const VIZ_RE = /chart|series|dataset|viz|gradient|spark|bar|line|pie|funnel|gauge|雷达|漏斗|图表/i

/**
 * @returns {{ role: 'success'|'brand'|'viz'|'undecided', why: string }}
 */
export function greenRole({ selector = '', prop = '', line = '', block = '' }) {
  const hay = `${selector} ${line}`
  const neg = hay.match(NEGATIVE_RE)
  if (neg) return { role: 'undecided', why: `命中否定语义「${neg[0]}」，需人工判断（勿当成功色）` }
  if (VIZ_RE.test(hay)) return { role: 'viz', why: '命中图表/渐变关键词' }
  const sm = hay.match(SUCCESS_RE)
  if (sm) return { role: 'success', why: `命中成功语义关键词「${sm[0]}」` }
  const bm = hay.match(BRAND_RE)
  if (bm) return { role: 'brand', why: `命中品牌/交互关键词「${bm[0]}」` }
  if (DARK_BG_RE.test(block) && prop === 'color') return { role: 'brand', why: '深底上的文字色，大概率是品牌强调' }
  return { role: 'undecided', why: '无关键词证据' }
}

// ─────────────────────────── 解析 ───────────────────────────

/** 读令牌表：值 → 令牌名列表，用于判断「这个字面量其实已有同值令牌」 */
export function readTokens(cssText) {
  const byValue = new Map()
  const byName = new Map()
  for (const m of cssText.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    const name = m[1]
    const val = norm(m[2])
    byName.set(name, val)
    if (!byValue.has(val)) byValue.set(val, [])
    byValue.get(val).push(name)
  }
  return { byValue, byName }
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(vue|css)$/.test(e.name)) out.push(p)
  }
  return out
}

/**
 * 把一份样式文本切成「块」，并给出每行的最内层所属块。
 *
 * 为什么必须真做括号配平：初版用「出现位置上下各若干行」当上下文，结果把**隔壁规则**的
 * `background: #fff` 当成了本规则的白底 —— 实测 `.stat-value { color: #d4af37 }` 被判成
 * 「金字白底高风险」，而它自己的块里根本没有背景。这类假阳性会直接导致错误的批量改色，
 * 所以宁可多写 30 行，也不能用窗口近似。
 *
 * @returns {Array<{ start: number, end: number, prelude: string }>} start/end 为 1 基行号
 */
export function blockIndex(lines) {
  const frames = []
  const stack = []
  let buf = ''
  lines.forEach((line, idx) => {
    const n = idx + 1
    for (const ch of line) {
      if (ch === '{') {
        stack.push({ start: n, prelude: buf.trim().replace(/\s+/g, ' ') })
        buf = ''
      } else if (ch === '}') {
        const f = stack.pop()
        if (f) frames.push({ start: f.start, end: n, prelude: f.prelude })
        buf = ''
      } else if (ch === ';') {
        buf = '' // 声明结束，之后的文本不可能是选择器
      } else {
        buf += ch
      }
    }
    if (buf.trim()) buf += ' ' // 选择器跨行时用空格连接，避免粘成一个词
  })
  return frames
}

/** 取包含第 line 行的最内层块（start 最大者）*/
export function innermostBlock(frames, line, lines) {
  let best = null
  for (const f of frames) {
    if (f.start <= line && line <= f.end && (!best || f.start > best.start)) best = f
  }
  if (!best) return { selector: '', block: '' }
  return { selector: best.prelude, block: lines.slice(best.start - 1, best.end).join('\n') }
}

/**
 * 逐处抽取颜色字面量及其上下文（选择器与所属块的**真实**内容）。
 */
export function scanOccurrences(files) {
  const out = []
  for (const file of files) {
    const rel = relative(ADMIN, file)
    const lines = readFileSync(file, 'utf8').split('\n')
    const frames = blockIndex(lines)
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return // 注释行不计
      const re = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g
      let m
      while ((m = re.exec(line))) {
        const { selector, block } = innermostBlock(frames, i + 1, lines)
        const propMatch = line.slice(0, m.index).match(/([a-z-]+)\s*:\s*$/)
        out.push({
          file: rel,
          line: i + 1,
          color: norm(m[0]),
          prop: propMatch ? propMatch[1] : '',
          selector,
          block,
          text: line.trim().slice(0, 120),
        })
      }
    })
  }
  return out
}

// ─────────────────────────── 报告 ───────────────────────────

function buildReport(occurrences, tokens) {
  const counts = new Map()
  for (const o of occurrences) {
    const c = counts.get(o.color) || { color: o.color, n: 0, files: new Set() }
    c.n += 1
    c.files.add(o.file)
    counts.set(o.color, c)
  }
  // ① 残留：出现 ≥3 次、且**没有同值令牌**的硬编码颜色
  const residue = [...counts.values()]
    .filter((c) => c.n >= 3 && !tokens.byValue.has(c.color))
    .map((c) => {
      let best = null
      for (const [val, names] of tokens.byValue) {
        const d = dist(c.color, val)
        if (!best || d < best.d) best = { d, val, names }
      }
      return {
        color: c.color,
        n: c.n,
        files: c.files.size,
        family: hueFamily(c.color),
        nearest: best && best.d <= 40 ? { token: best.names[0], value: best.val, delta: best.d } : null,
        contrastOnWhite: contrast(c.color, '#ffffff'),
      }
    })
    .sort((a, b) => b.n - a.n)

  // ② 绿色家族语义
  const greenish = occurrences.filter((o) => {
    const f = hueFamily(o.color)
    return f === '绿' || tokens.byValue.get(o.color)?.some((t) => /green|success/.test(t))
  })
  const greenRoles = { brand: [], success: [], viz: [], undecided: [] }
  for (const o of greenish) {
    const { role, why } = greenRole(o)
    greenRoles[role].push({ ...o, why })
  }

  // ③ 明亮金当文字用的对比度风险
  const goldText = occurrences.filter((o) => o.prop === 'color' && BRIGHT_GOLDS.includes(o.color))
  const goldRisks = { popper: [], 'same-block': [], safe: [], undecided: [] }
  const fileTextCache = new Map()
  const paintsDark = (file) => {
    if (!fileTextCache.has(file)) fileTextCache.set(file, filePaintsPopperDark(readFileSync(join(ADMIN, file), 'utf8')))
    return fileTextCache.get(file)
  }
  for (const o of goldText) {
    const { risk, why } = goldTextRisk({ ...o, popperPaintedDark: paintsDark(o.file) })
    goldRisks[risk].push({ ...o, why })
  }

  // ④ 有同值令牌但仍硬编码（可机械替换，但**改哪个令牌**仍需语义判断）
  const tokenisable = [...counts.values()]
    .filter((c) => c.n >= 3 && tokens.byValue.has(c.color))
    .map((c) => ({ color: c.color, n: c.n, files: c.files.size, tokens: tokens.byValue.get(c.color) }))
    .sort((a, b) => b.n - a.n)

  // ⑤ 模板内联色残留：`type="primary"` 的 el-button 又带上内联 color ——
  //    等于把品牌色写死成某个字面量。本轮清掉 57 处后应为 0，`--strict` 下非 0 即失败。
  const inlineBrandAttrs = []
  for (const o of occurrences) {
    if (o.prop) continue // 只看模板属性（`color="..."` 没有 CSS 冒号，prop 为空）
    if (/^\s*<el-(button|switch)/.test(o.text) || /<el-(button|switch)\b/.test(o.text)) {
      inlineBrandAttrs.push(o)
    }
  }

  // ⑥ 正文色不达 AA：浅色面上 < 4.5:1 的 `color:`。
  //    诚实声明：判定用的是「白底」这一最常见浅色面；若该处实际用于深色面则不成立，
  //    故只作「疑似」并配棘轮与 `--verify` 逐处实测（与 ③ 同一套纪律）。
  // 先用同一套「深色语境」证据排掉明显误报：白字/金字在侧栏、深色卡片上本来就对。
  const DARK_CONTAINER_RE = /aside|sidebar|\.erp-black|dark-|footer|\.el-menu|hero/i
  const lowContrastText = []
  let lowContrastExcludedDark = 0
  for (const o of occurrences) {
    if (o.prop !== 'color') continue
    const r = contrast(o.color, '#ffffff')
    if (r >= 4.5) continue
    if (DARK_BG_RE.test(o.block) || DARK_CONTAINER_RE.test(o.selector)) { lowContrastExcludedDark += 1; continue }
    lowContrastText.push({ ...o, ratioOnWhite: r })
  }
  const lowContrastByColor = {}
  for (const o of lowContrastText) {
    lowContrastByColor[o.color] = lowContrastByColor[o.color] || { color: o.color, n: 0, files: new Set(), ratio: o.ratioOnWhite }
    lowContrastByColor[o.color].n += 1
    lowContrastByColor[o.color].files.add(o.file)
  }
  const lowContrastList = Object.values(lowContrastByColor)
    .map((x) => ({ color: x.color, n: x.n, files: x.files.size, ratioOnWhite: x.ratio }))
    .sort((a, b) => b.n - a.n)

  return { residue, greenRoles, goldRisks, tokenisable, inlineBrandAttrs, lowContrastList, lowContrastTotal: lowContrastText.length, lowContrastExcludedDark, total: occurrences.length }
}

function printReport(rep) {
  const L = (s = '') => console.log(s)
  L(`扫描 ${rep.total} 处颜色字面量`)
  L()
  L('① 残留字面量（出现 ≥3 次且**无同值令牌**）—— 按出现次数排序')
  L('   颜色      次数  文件  色相家族   白底对比度  最近令牌')
  rep.residue.slice(0, 30).forEach((r) => {
    const near = r.nearest ? `${r.nearest.token} (${r.nearest.value}, Δ${r.nearest.delta})` : '—'
    L(`   ${r.color.padEnd(9)} ${String(r.n).padStart(4)} ${String(r.files).padStart(5)}  ${r.family.padEnd(10)} ${String(r.contrastOnWhite).padStart(5)}:1   ${near}`)
  })
  if (rep.residue.length > 30) L(`   …另有 ${rep.residue.length - 30} 种`)
  L()
  L('② 绿色家族语义角色（品牌色该改金 / 成功色必须留绿）—— 审计点名的不可 find-replace 之处')
  L(`   success ${rep.greenRoles.success.length}   brand ${rep.greenRoles.brand.length}   viz ${rep.greenRoles.viz.length}   待定 ${rep.greenRoles.undecided.length}`)
  rep.greenRoles.success.slice(0, 5).forEach((o) => L(`   [success] ${o.file}:${o.line} ${o.color} — ${o.why}`))
  rep.greenRoles.brand.slice(0, 5).forEach((o) => L(`   [brand]   ${o.file}:${o.line} ${o.color} — ${o.why}`))
  L()
  L('③ 明亮金用作文字色：对比度嫌疑（白底 <3:1 即不可读）')
  L(`   弹层证据 ${rep.goldRisks.popper.length}   同块浅底（可能是死代码）${rep.goldRisks['same-block'].length}   静态判安全 ${rep.goldRisks.safe.length}   无证据 ${rep.goldRisks.undecided.length}`)
  L('   ⚠ 静态分析不知道哪条声明生效：实测 el-table th 的「浅底 + 金字」被全局 !important 压掉，')
  L('     真实渲染是金字深底 7.8:1。同块浅底类必须用 `--verify` 在浏览器量一次再定。')
  rep.goldRisks.popper.slice(0, 6).forEach((o) => L(`   [弹层] ${o.file}:${o.line} ${o.color} — ${o.why}`))
  rep.goldRisks['same-block'].slice(0, 6).forEach((o) => L(`   [待验] ${o.file}:${o.line} ${o.color} — ${o.selector || '(无选择器)'}`))
  L()
  L('④ 有同值令牌但仍硬编码（可机械替换；改哪个令牌仍要看语义）')
  rep.tokenisable.slice(0, 12).forEach((r) => L(`   ${r.color.padEnd(9)} ${String(r.n).padStart(4)} 次 / ${String(r.files).padStart(3)} 文件  → ${r.tokens.join(' / ')}`))
  L()
  L(`⑤ 模板内联品牌色残留（type="primary" 的按钮/开关还写死 color="#hex"）：${rep.inlineBrandAttrs.length} 处 ${rep.inlineBrandAttrs.length ? '✗ 应为 0' : '✓'}`)
  rep.inlineBrandAttrs.slice(0, 6).forEach((o) => L(`   ${o.file}:${o.line}  ${o.text}`))
  L()
  L(`⑥ 疑似正文色不达 AA（浅色面上 < 4.5:1，共 ${rep.lowContrastTotal} 处 / ${rep.lowContrastList.length} 色；已按同块深底/深色容器证据排除 ${rep.lowContrastExcludedDark} 处）`)
  L('   ⚠ 仍是静态判定：被别处 !important 覆盖的情形需 --verify 实测')
  rep.lowContrastList.slice(0, 12).forEach((r) => L(`   ${r.color.padEnd(9)} ${String(r.n).padStart(4)} 次 / ${String(r.files).padStart(3)} 文件  白底 ${r.ratioOnWhite}:1`))
}

// ─────────────────────────── 自检 ───────────────────────────

if (has('--selftest')) {
  console.log('自检：用合成样本证明四类判定都会失败（不读仓库源码）\n')
  const cases = [
    ['绿色 + success 类名 → 判 success', () => greenRole({ selector: '.el-tag--success', line: 'color: #2d6a4f;' }).role === 'success'],
    ['绿色 + 侧栏选择器 → 判 brand', () => greenRole({ selector: '.aside .el-menu-item.is-active', line: 'color: #2d6a4f;' }).role === 'brand'],
    ['绿色 + 图表关键词 → 判 viz', () => greenRole({ selector: '.chart-series', line: 'fill: #2d6a4f;' }).role === 'viz'],
    ['同一个色值在两种语境下判出不同角色（不可 find-replace 的证据）', () => {
      const a = greenRole({ selector: '.el-tag--success', line: 'color: #2d6a4f;' }).role
      const b = greenRole({ selector: '.aside .menu', line: 'color: #2d6a4f;' }).role
      return a === 'success' && b === 'brand'
    }],
    ['否定语境不得判成 success（「未完成」含「完成」子串）', () => greenRole({ selector: '.task', line: '/* 未完成 */ color: #2d6a4f;' }).role === 'undecided'],
    ['交互态关键词 active 不算成功语义', () => greenRole({ selector: '.el-menu-item.is-active', line: 'color: #2d6a4f;' }).role === 'brand'],
    ['明亮金 + 弹层选择器 → 判弹层嫌疑', () => goldTextRisk({ selector: '.x :deep(.el-select-dropdown__item.selected)', block: 'color: #d4af37;' }).risk === 'popper'],
    ['本文件把弹层刷黑 → 弹层金字判安全（AIStrategicBrain 实测情形）', () => goldTextRisk({ selector: ':deep(.el-select-dropdown__item.selected)', block: 'color: #d4af37 !important;', popperPaintedDark: true }).risk === 'safe'],
    ['对比度可复现：白底低对比正文色会被 ⑥ 判定（#999 2.85:1 < 4.5）', () => contrast('#999999', '#ffffff') < 4.5 && contrast('#6b665d', '#ffffff') >= 4.5],
    ['识别「本文件把弹层刷黑」这一事实（含 #000 简写）', () => filePaintsPopperDark('.a :deep(.el-select-dropdown__item) {\n  color: #fff !important;\n  background: #000 !important;\n}') === true],
    ['未刷黑的弹层文件不得误判为深色', () => filePaintsPopperDark('.a :deep(.el-select-dropdown__item) { color: #333; }') === false],
    ['明亮金 + 同块深底 → 判安全', () => goldTextRisk({ selector: '.foo', block: 'background: #1c1a17;\ncolor: #d4af37;' }).risk === 'safe'],
    ['明亮金 + 同块白底 → 只判「嫌疑」，不直接定性（可能被 !important 覆盖）', () => goldTextRisk({ selector: '.foo', block: 'background: #ffffff;\ncolor: #d4af37;' }).risk === 'same-block'],
    ['明亮金 + 无任何证据 → 老实说「需人工判断」', () => goldTextRisk({ selector: '.foo', block: 'color: #d4af37;' }).risk === 'undecided'],
    ['对比度计算与 WCAG 一致（#d4af37 on #fff ≈ 2.1）', () => contrast('#d4af37', '#ffffff') < 2.3 && contrast('#d4af37', '#ffffff') > 1.9],
    ['#6e5b28 on #fff 达到 AA', () => contrast('#6e5b28', '#ffffff') >= 4.5],
    ['最近令牌按 RGB 距离选出（#c4a76c 应指向 gold-400 家族）', () => {
      const tokens = readTokens('--gold-400: #c4a55a;\n--gold-300: #d4b86a;')
      let best = null
      for (const [val, names] of tokens.byValue) {
        const d = dist('#c4a76c', val)
        if (!best || d < best.d) best = { d, names }
      }
      return best.names[0] === '--gold-400'
    }],
    ['色相归族：绿/金/蓝/灰分明', () => hueFamily('#2d6a4f') === '绿' && hueFamily('#d4af37') === '金/土' && hueFamily('#2c3e50') === '蓝' && hueFamily('#999999') === '中性-灰'],
    ['块配平：只取本规则，不把隔壁规则的背景当证据', () => {
      const lines = [
        '.other { background: #fff; }',
        '.stat-value {',
        '  font-size: 32px;',
        '  color: #d4af37;',
        '}',
      ]
      const frames = blockIndex(lines)
      const { selector, block } = innermostBlock(frames, 4, lines)
      return selector === '.stat-value' && !block.includes('background')
    }],
    ['块配平：同一行内的背景与颜色属于同一块', () => {
      const lines = ['.a { background: #fff; color: #d4af37; }']
      const frames = blockIndex(lines)
      const { selector, block } = innermostBlock(frames, 1, lines)
      return selector === '.a' && block.includes('background: #fff') && block.includes('#d4af37')
    }],
    ['块配平：嵌套（@media 里的规则）取最内层', () => {
      const lines = ['@media (max-width: 768px) {', '  .a {', '    color: #d4af37;', '  }', '}']
      const frames = blockIndex(lines)
      const { selector } = innermostBlock(frames, 3, lines)
      return selector === '.a'
    }],
    ['块配平：跨行选择器能拼起来', () => {
      const lines = ['.a,', '.b {', '  color: #d4af37;', '}']
      const frames = blockIndex(lines)
      const { selector } = innermostBlock(frames, 3, lines)
      return selector === '.a, .b'
    }],
  ]
  let bad = 0
  for (const [label, fn] of cases) {
    let ok = false
    let err = ''
    try { ok = !!fn() } catch (e) { err = `（异常：${e.message}）` }
    console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` ${err}`}`)
    if (!ok) bad += 1
  }
  console.log()
  if (bad) {
    console.error(`自检失败：${bad} 项判定不符，分类器不可信。`)
    process.exit(1)
  }
  console.log('自检通过：语义角色、对比度风险、最近令牌、色相归族四类判定均可复现。\n')
  process.exit(0)
}

// ─────────────────────────── 主流程 ───────────────────────────

const tokens = readTokens(readFileSync(TOKENS_FILE, 'utf8'))
const occurrences = scanOccurrences(walk(SRC))
const rep = buildReport(occurrences, tokens)

const listColor = argOf('--list', null)
if (listColor) {
  const want = norm(listColor)
  const hits = occurrences.filter((o) => o.color === want)
  console.log(`${want} 共 ${hits.length} 处：`)
  hits.forEach((o) => console.log(`  ${o.file}:${o.line}  [${o.prop || '?'}]  ${o.selector || '(无选择器)'}\n      ${o.text}`))
  process.exit(0)
}

/**
 * --verify：把静态「嫌疑」变成浏览器实测。
 * 用法：--verify '<选择器>' [--module <模块id>] [--base <地址>]
 * 关键点：文字元素自身的 background 常是透明的，必须**向上找最近的不透明祖先底** ——
 * 那才是人眼看到的底色；只量自身会得出「透明底」这种没意义的结论。
 */
const verifySelector = argOf('--verify', null)
if (verifySelector) {
  const { launchChrome } = await import('./lib/cdp.mjs')
  const base = argOf('--base', process.env.ADMIN_BASE_URL || 'http://localhost:5178/admin/')
  const moduleId = argOf('--module', '0')
  const chrome = await launchChrome({})
  try {
    await chrome.goto(base)
    // 登录态标记的唯一事实源（2026-09-17 审计 A4）
    await chrome.evaluate(`localStorage.setItem(${JSON.stringify(ADMIN_TOKEN_KEY)}, ${JSON.stringify(ADMIN_TOKEN_VALUE)})`)
    await chrome.reload()
    await chrome.waitFor("!document.querySelector('.login-mask')", { label: '进入控制台' })
    await chrome.goto(`${base}#/m/${moduleId}`)
    await new Promise((r) => setTimeout(r, 2500))
    const res = await chrome.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(verifySelector)})
      if (!el) return { found: false }
      const self = getComputedStyle(el)
      let bgEl = el, bg = self.backgroundColor
      const transparent = (c) => !c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent'
      while (bgEl && transparent(bg)) { bgEl = bgEl.parentElement; if (bgEl) bg = getComputedStyle(bgEl).backgroundColor }
      const parse = (s) => (String(s).match(/[\\d.]+/g) || []).slice(0, 3).map(Number)
      const lum = (rgb) => { const f = (c) => { const t = c / 255; return t <= 0.03928 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]) }
      const c1 = parse(self.color), c2 = parse(bg)
      const [hi, lo] = [lum(c1), lum(c2)].sort((a, b) => b - a)
      return {
        found: true,
        text: (el.innerText || '').trim().slice(0, 20),
        color: self.color,
        surface: bg,
        surfaceFrom: bgEl === el ? '自身' : (bgEl ? String(bgEl.className || bgEl.tagName).slice(0, 40) : '未找到'),
        ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
        fontSize: self.fontSize,
        fontWeight: self.fontWeight,
      }
    })()`)
    if (!res.found) {
      console.log(`✗ 未在当前页面找到匹配「${verifySelector}」的元素（module=${moduleId}）`)
      process.exit(1)
    }
    const large = parseFloat(res.fontSize) >= 24 || (parseFloat(res.fontSize) >= 18.66 && Number(res.fontWeight) >= 700)
    const need = large ? 3 : 4.5
    console.log(`选择器 ${verifySelector}（module=${moduleId}）`)
    console.log(`  文本「${res.text}」  字号 ${res.fontSize}/${res.fontWeight}${large ? '（大字，AA 需 3:1）' : '（正文，AA 需 4.5:1）'}`)
    console.log(`  文字色 ${res.color}`)
    console.log(`  可见底色 ${res.surface}（取自 ${res.surfaceFrom}）`)
    console.log(`  实测对比度 ${res.ratio}:1 → ${res.ratio >= need ? `✓ 达 AA(${need}:1)` : `✗ 未达 AA（需 ${need}:1）`}`)
    process.exit(res.ratio >= need ? 0 : 1)
  } finally {
    await chrome.close()
  }
}

if (has('--json')) {
  console.log(JSON.stringify({
    total: rep.total,
    residue: rep.residue,
    tokenisable: rep.tokenisable,
    greenRoles: Object.fromEntries(Object.entries(rep.greenRoles).map(([k, v]) => [k, v.length])),
    goldRisks: { popper: rep.goldRisks.popper.length, sameBlock: rep.goldRisks['same-block'].length, safe: rep.goldRisks.safe.length, undecided: rep.goldRisks.undecided.length },
    inlineBrandAttrs: rep.inlineBrandAttrs.map((o) => `${o.file}:${o.line}`),
    lowContrast: { total: rep.lowContrastTotal, excludedDarkContext: rep.lowContrastExcludedDark, byColor: rep.lowContrastList },
    goldRiskDetail: rep.goldRisks,
  }, null, 2))
  process.exit(0)
}

printReport(rep)

// 棘轮：每个字面量的出现次数只能降不能升
const current = Object.fromEntries(rep.residue.map((r) => [r.color, r.n]).sort((a, b) => a[0].localeCompare(b[0])))
const currentTokenisable = Object.fromEntries(rep.tokenisable.map((r) => [r.color, r.n]).sort((a, b) => a[0].localeCompare(b[0])))
// 除了「字面量计数」，还要单独卡「明亮金当文字用且疑似浅底」这类**具体缺陷**的数量：
// 否则「新增一处 + 修掉另一处」会让总数不变而缺陷溜过去。
const goldTextRiskCounts = {
  popper: rep.goldRisks.popper.length,
  sameBlock: rep.goldRisks['same-block'].length,
}
// 内联品牌色必须恒为 0；低对比正文色的总量只能降
const guardCounts = {
  inlineBrandAttrs: rep.inlineBrandAttrs.length,
  lowContrastText: rep.lowContrastTotal,
}
const snapshot = { residue: current, tokenisable: currentTokenisable, goldTextRisk: goldTextRiskCounts, guards: guardCounts }

if (has('--update')) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify({
    updatedAt: new Date().toISOString().slice(0, 10),
    note: '每个颜色字面量的出现次数只能降不能升；新增字面量会被 --strict 拦下',
    ...snapshot,
  }, null, 2)}\n`, 'utf8')
  console.log(`\n已写入基线：残留 ${Object.keys(current).length} 种 / 有同值令牌 ${Object.keys(currentTokenisable).length} 种`)
} else if (existsSync(BASELINE_PATH)) {
  const base = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  const grew = []
  const appeared = []
  for (const [c, n] of Object.entries(current)) {
    if (!(c in (base.residue || {}))) appeared.push(`${c}(${n})`)
    else if (n > base.residue[c]) grew.push(`${c} ${base.residue[c]}→${n}`)
  }
  console.log(`\n残留棘轮：基线 ${Object.keys(base.residue || {}).length} 种 / 本次 ${Object.keys(current).length} 种`)
  if (grew.length) console.log(`  ⚠ 变多：${grew.join('、')}`)
  if (appeared.length) console.log(`  ⚠ 新字面量：${appeared.join('、')}`)
  const baseGold = base.goldTextRisk || {}
  const goldBad = []
  for (const k of ['popper', 'sameBlock']) {
    const was = baseGold[k] ?? 0
    const now = goldTextRiskCounts[k]
    if (now > was) goldBad.push(`${k} ${was}→${now}`)
  }
  if (goldBad.length) console.log(`  ⚠ 明亮金当文字用的嫌疑变多：${goldBad.join('、')}`)
  const baseGuard = base.guards || {}
  const guardBad = []
  if (guardCounts.inlineBrandAttrs > (baseGuard.inlineBrandAttrs ?? 0)) {
    guardBad.push(`模板内联品牌色 ${baseGuard.inlineBrandAttrs ?? 0}→${guardCounts.inlineBrandAttrs}（应为 0）`)
  }
  if (guardCounts.lowContrastText > (baseGuard.lowContrastText ?? Number.MAX_SAFE_INTEGER)) {
    guardBad.push(`低对比正文色 ${baseGuard.lowContrastText}→${guardCounts.lowContrastText}`)
  }
  if (guardBad.length) console.log(`  ⚠ ${guardBad.join('、')}`)
  if (!grew.length && !appeared.length && !goldBad.length && !guardBad.length) console.log('  未增长。')
  if (has('--strict') && (grew.length || appeared.length || goldBad.length || guardBad.length)) {
    console.error('\n✗ --strict：色彩残留变多。要么改回，要么复核后执行 --update 收编。')
    process.exit(1)
  }
}
