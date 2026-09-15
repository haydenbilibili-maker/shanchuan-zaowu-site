#!/usr/bin/env node
/**
 * 小程序「文案规范 + 样式 token」批处理（P0）
 *
 * 用法：
 *   node scripts/normalize-style.mjs --copy   --dry-run          # 文案规范：只报告
 *   node scripts/normalize-style.mjs --copy   --fix              # 文案规范：写入
 *   node scripts/normalize-style.mjs --colors --dry-run          # 颜色 token：只报告
 *   node scripts/normalize-style.mjs --colors --fix              # 颜色 token：写入
 *   node scripts/normalize-style.mjs --fix --manifest=/tmp/x.json  # 写入并导出改动清单
 *   （不带 --copy / --colors 时两者都处理；不带 --fix 即预演）
 *
 * 文案规则（只作用于**面向用户的字符串**：WXML 文本节点 / 允许的属性、JS 含中文的
 * 字符串字面量、页面 JSON 的 navigationBarTitleText；自动跳过注释与 console.*）：
 *   1. 省略号 `...` → `…`
 *   2. 中文被半角括号包裹 → 全角（）
 *   3. 中文后的半角冒号 → 全角：
 *   4. 商品名词口径（产品 2026-09-15 决定）：**标本 / 商品 → 藏品**（默认）；
 *      可用 `--product-term=标本` 反向切换成「藏品 / 商品 → 标本」。
 *      专名与存量数据值不动：`标本师`（角色）、门店名「星宸标本」、
 *      分类名 `化石标本` / `标本工具耗材`、伴宠保存方式 `浸液标本`/`剥制标本`/`骨骼标本`；
 *      与存量数据做等值比较的中文字面量（如 `<类别> === '标本'`）也自动跳过。
 *   5. 代金券 / 优惠券 → 礼券
 *   6. 店长 → 馆长（仅对客文案；`subpackages/manager/**` 员工侧不动）
 *   7. 去支付 → 立即支付
 *
 * 颜色规则：与设计 token 同值的硬编码色 → var(--token)；
 *   只在**已经使用过 var(--) 的 wxss** 中替换（证明该文件的变量级联有效）；
 *   自动跳过 `var(--token, #HEX)` 的回退值与 `--token: #HEX` 的变量定义，
 *   避免生成自引用或破坏回退。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CJK = /[\u4e00-\u9fa5]/

const args = process.argv.slice(2)
const FIX = args.includes('--fix')
const DRY = !FIX
const DO_COPY = args.includes('--copy') || !args.includes('--colors')
const DO_COLORS = args.includes('--colors') || !args.includes('--copy')
const manifestArg = args.find((a) => a.startsWith('--manifest='))
const MANIFEST = manifestArg ? manifestArg.slice('--manifest='.length) : ''
const termArg = args.find((a) => a.startsWith('--product-term='))
const PRODUCT_TERM = termArg ? termArg.slice('--product-term='.length) : '藏品'

/** 文案目录（含员工侧；员工侧只跑商品名词，不跑「店长 → 馆长」） */
const COPY_DIRS = ['pages', 'subpackages', 'components', 'custom-tab-bar', 'utils', 'config']
const COLOR_DIRS = ['pages', 'subpackages', 'components', 'custom-tab-bar', 'styles']

/** 商品名词统一为「藏品」时，这些专名 / 存量数据值必须原样保留 */
const PROTECTED_WHEN_COLLECTION = [
  '标本师', '标本工坊', '标本定制', '标本养护', '标本鉴定', '标本档案', '标本故事', '标本知识', '标本展', '标本制作师',
  '海洋标本', '植物标本', '昆虫标本', '矿石标本', '动物标本', '湿标本', '干制标本',
  '星宸标本', '化石标本', '标本工具耗材', '浸液标本', '剥制标本', '骨骼标本', '生物标本',
]
/** 品牌名 / 专名的固定写法（批量口径是「藏品」，这些仍用「标本」，会把被改过的纠回来） */
const BRAND_FIXES = [
  ['藏品工坊', '标本工坊'],
  ['藏品制作师', '标本制作师'],
  ['藏品定制', '标本定制'],
  ['藏品养护', '标本养护'],
  ['藏品鉴定', '标本鉴定'],
  ['藏品档案', '标本档案'],
  ['藏品故事', '标本故事'],
  ['藏品知识', '标本知识'],
  ['海洋藏品', '海洋标本'],
  ['植物藏品', '植物标本'],
  ['昆虫藏品', '昆虫标本'],
  ['矿石藏品', '矿石标本'],
  ['动物藏品', '动物标本'],
  ['干制藏品', '干制标本'],
  ['湿藏品', '湿标本'],
  ['藏品展', '标本展']
]

// ── 颜色映射（值取自 app.wxss 的 token 定义，均与硬编码同值） ──
const COLOR_MAP = {
  '#C4A76C': '--gold',
  '#1A1814': '--color-bg',
  '#1F1D1A': '--color-bg-card',
  '#262320': '--color-bg-elevated',
  '#A09A90': '--color-text-secondary',
  '#6B6560': '--color-text-muted',
  '#D5D1C8': '--color-text-body',
  '#FFFFFF': '--color-text-primary',
}

// 员工侧措辞：即使出现在对客文件里也不替换「店长」
const STAFF_ONLY = /店长工作台|店长台|为店长或超管|店长审核队列|店长权限/
// 代码片段 / 正则字面量：整条跳过
const CODE_LIKE = /[\\]|\(\?/
// 与存量数据做等值比较的中文字面量：不能改（改了就对不上库里的值）
const DATA_COMPARE_JS = /(===|!==|==|!=|includes\(|indexOf\(|startsWith\(|endsWith\()\s*$/
const DATA_COMPARE_WXML = /(===|!==|==|!=|includes\(|indexOf\()\s*'[^']*(标本|商品|藏品|店长|券)[^']*'/

const WXML_ATTRS = ['placeholder', 'label', 'title', 'content', 'confirmText', 'cancelText', 'aria-label', 'tip', 'emptyText', 'desc', 'value', 'note', 'range', 'hint', 'subtitle', 'message', 'caption']

function isDir(p) {
  try { return readdirSync(p) && true } catch { return false }
}

function walk(dir, exts, out = []) {
  let names = []
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (name === 'node_modules' || name === 'docs' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (isDir(full)) walk(full, exts, out)
    else if (exts.some((e) => name.endsWith(e))) out.push(full)
  }
  return out
}

/** 注释区间（用于跳过注释里的中文，避免误改说明文字） */
function commentRanges(file, src) {
  const ranges = []
  if (file.endsWith('.wxml')) {
    for (const m of src.matchAll(/<!--[\s\S]*?-->/g)) ranges.push([m.index, m.index + m[0].length])
    return ranges
  }
  for (const m of src.matchAll(/\/\*[\s\S]*?\*\//g)) ranges.push([m.index, m.index + m[0].length])
  for (const m of src.matchAll(/(^|\n)([ \t]*)\/\/[^\n]*/g)) {
    const start = m.index + (m[1] ? m[1].length : 0)
    ranges.push([start, start + m[0].length - (m[1] ? m[1].length : 0)])
  }
  return ranges
}

const inRanges = (pos, ranges) => ranges.some(([a, b]) => pos >= a && pos < b)

/** 找出 ${…} / {{…}} 表达式区间（按大括号深度配对） */
function exprRanges(raw, openTag) {
  const out = []
  for (let i = 0; i < raw.length; i++) {
    if (!raw.startsWith(openTag, i)) continue
    let depth = 0
    let j = i + openTag.length - 1
    for (; j < raw.length; j++) {
      if (raw[j] === '{') depth += 1
      else if (raw[j] === '}') { depth -= 1; if (depth === 0) { j += 1; break } }
    }
    out.push([i, j])
    i = j - 1
  }
  return out
}

/**
 * 把原文切成「文案段」与「代码段」：表达式里的代码是代码，
 * 但表达式里被引号包住的字符串仍算文案（如 ${x ? '装裱预览' : y}）。
 */
function segmentLiteral(raw, exprs) {
  const parts = []
  const text = (a, b) => { if (b > a) parts.push({ code: false, a, b }) }
  const code = (a, b) => { if (b > a) parts.push({ code: true, a, b }) }
  let cursor = 0
  for (const [a, b] of exprs) {
    text(cursor, a)
    const inner = raw.slice(a, b)
    let k = a
    for (const m of inner.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
      code(k, a + m.index)
      text(a + m.index, a + m.index + m[0].length)
      k = a + m.index + m[0].length
    }
    code(k, b)
    cursor = b
  }
  text(cursor, raw.length)
  return parts
}

/** 代码段用 \u0001 占位（文案规则不会触碰它），替换完再原样还原 */
function maskParts(raw, parts) {
  let masked = ''
  const codes = []
  for (const p of parts) {
    if (p.code) { masked += '\u0001'; codes.push(raw.slice(p.a, p.b)) }
    else masked += raw.slice(p.a, p.b)
  }
  return { masked, codes }
}

function unmask(out, codes) {
  let i = 0
  return out.replace(/\u0001/g, () => (i < codes.length ? codes[i++] : ''))
}

/**
 * 先把整份 WXML 的 {{…}} 各自压成一个占位符，再定位文本节点／属性，
 * 避免表达式里的 `<` `>` 把 `<view>` 切片切坏（例如 {{a > 1 ? 'x' : 'y'}}）。
 * 返回遮蔽后的文本与「遮蔽位置 ↔ 原文位置」映射。
 */
function maskWxmlSource(src) {
  const exprs = exprRanges(src, '{{')
  let masked = ''
  const startMap = []
  const endMap = []
  let cursor = 0
  const copyRange = (a, b) => {
    for (let i = a; i < b; i++) { masked += src[i]; startMap.push(i); endMap.push(i + 1) }
  }
  for (const [a, b] of exprs) {
    if (a < cursor) continue
    copyRange(cursor, a)
    masked += '\u0001'
    startMap.push(a)
    endMap.push(b)
    cursor = b
  }
  copyRange(cursor, src.length)
  return { masked, startMap, endMap }
}

/** 收集需要处理的字符串片段（原文精确偏移；跳过注释与 console.*） */
function stringSpans(file, src) {
  const spans = []
  const ranges = commentRanges(file, src)
  if (file.endsWith('.wxml')) {
    const { masked, startMap, endMap } = maskWxmlSource(src)
    const take = (ms, me, extraCheck) => {
      const os = startMap[ms]
      const oe = endMap[me - 1]
      if (os === undefined || oe === undefined) return
      const raw = src.slice(os, oe)
      if (!CJK.test(raw)) return
      if (inRanges(os, ranges)) return
      if (DATA_COMPARE_WXML.test(raw)) return // 表达式里在跟存量值比对，整段不动
      const parts = maskParts(raw, segmentLiteral(raw, exprRanges(raw, '{{')))
      spans.push({ start: os, end: oe, text: parts.masked, codes: parts.codes })
    }
    for (const m of masked.matchAll(/>([^<>]{1,400})</g)) take(m.index + 1, m.index + 1 + m[1].length)
    for (const m of masked.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
      if (!WXML_ATTRS.includes(m[1])) continue
      if (!m[2].length) continue
      take(m.index + m[0].indexOf('"') + 1, m.index + m[0].indexOf('"') + 1 + m[2].length)
    }
    return spans
  }
  if (file.endsWith('.json')) {
    for (const m of src.matchAll(/"navigationBarTitleText"\s*:\s*"([^"]*)"/g)) {
      const text = m[1]
      if (!CJK.test(text)) continue
      const start = m.index + m[0].indexOf('"', m[0].indexOf(':')) + 1
      spans.push({ start, end: start + text.length, text })
    }
    return spans
  }
  if (!file.endsWith('.js')) return spans
  const push = (quoteIndex, text, codes, rawLength) => {
    if (!CJK.test(text) || (!codes && CODE_LIKE.test(text))) return
    const before = src.slice(Math.max(0, quoteIndex - 48), quoteIndex)
    if (/console\.\w+\(\s*$/.test(before)) return
    if (DATA_COMPARE_JS.test(before) || /case\s*$/.test(before)) return
    if (inRanges(quoteIndex, ranges)) return
    spans.push({ start: quoteIndex + 1, end: quoteIndex + 1 + (rawLength === undefined ? text.length : rawLength), text, codes })
  }
  const templateRanges = []
  // 模板字符串：遮蔽 ${…} 代码，保留其中的引号文案
  for (const m of src.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    const raw = m[1]
    const base = m.index + 1
    templateRanges.push([base, base + raw.length])
    const { masked, codes } = maskParts(raw, segmentLiteral(raw, exprRanges(raw, '${')))
    push(m.index, masked, codes, raw.length)
  }
  // 单／双引号字符串字面量（模板字符串内的由上面统一处理）
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
    if (templateRanges.some(([a, b]) => m.index >= a && m.index < b)) continue
    push(m.index, m[1] !== undefined ? m[1] : m[2], null)
  }
  return spans
}

function fixCopyText(text, opts = {}) {
  if (CODE_LIKE.test(text)) return { out: text, notes: [], counts: {} }
  let out = text
  const notes = []
  const counts = {}
  const hit = (name, n) => { counts[name] = (counts[name] || 0) + n }
  if (/(?<!\.)\.\.\.(?!\.)/.test(out)) {
    hit('省略号 ... → …', (out.match(/(?<!\.)\.\.\.(?!\.)/g) || []).length)
    out = out.replace(/(?<!\.)\.\.\.(?!\.)/g, '…')
    notes.push('省略号 ... → …')
  }
  if (/\([^)]*[\u4e00-\u9fa5][^)]*\)/.test(out)) {
    hit('半角括号 → 全角', (out.match(/\([^)]*[\u4e00-\u9fa5][^)]*\)/g) || []).length)
    out = out.replace(/\(([^)]*[\u4e00-\u9fa5][^)]*)\)/g, '（$1）')
    notes.push('半角括号 → 全角')
  }
  if (/[\u4e00-\u9fa5]\s*:/.test(out)) {
    hit('半角冒号 → 全角', (out.match(/[\u4e00-\u9fa5]\s*:/g) || []).length)
    out = out.replace(/([\u4e00-\u9fa5])\s*:/g, '$1：')
    notes.push('半角冒号 → 全角')
  }
  // 商品名词统一：默认 标本 / 商品 → 藏品（--product-term=标本 可反向）
  if (PRODUCT_TERM === '藏品') {
    const kept = []
    let s = out
    for (const word of PROTECTED_WHEN_COLLECTION) {
      while (s.includes(word)) {
        const i = kept.length
        kept.push(word)
        s = s.replace(word, `\u0002${i}\u0002`)
      }
    }
    if (s.includes('标本')) { hit('标本 → 藏品', s.split('标本').length - 1); s = s.split('标本').join('藏品'); notes.push('标本 → 藏品') }
    if (s.includes('商品')) { hit('商品 → 藏品', s.split('商品').length - 1); s = s.split('商品').join('藏品'); notes.push('商品 → 藏品') }
    if (kept.length) s = s.replace(/\u0002(\d+)\u0002/g, (m, i) => kept[Number(i)])
    for (const [from, to] of BRAND_FIXES) {
      if (!s.includes(from)) continue
      hit(`${from} → ${to}（品牌名固定）`, s.split(from).length - 1)
      s = s.split(from).join(to)
      notes.push(`${from} → ${to}（品牌名固定）`)
    }
    out = s
  } else {
    if (out.includes('藏品')) { hit('藏品 → 标本', out.split('藏品').length - 1); out = out.split('藏品').join('标本'); notes.push('藏品 → 标本') }
    if (out.includes('商品')) { hit('商品 → 标本', out.split('商品').length - 1); out = out.split('商品').join('标本'); notes.push('商品 → 标本') }
  }
  if (/代金券|优惠券/.test(out)) { hit('代金券/优惠券 → 礼券', (out.match(/代金券|优惠券/g) || []).length); out = out.replace(/代金券|优惠券/g, '礼券'); notes.push('代金券/优惠券 → 礼券') }
  // 券夹 → 礼券夹；泛指的「券」→ 礼券。
  // 免邮券 / 现金券 / 兑换券 / 代金券 / 礼券 是既有子类型或已统一，保持不动。
  if (out.includes('券')) {
    let s = out
    // 幂等修复：历史脚本重复执行过的「礼礼券」→「礼券」
    if (s.includes('礼礼券')) { hit('礼礼券 → 礼券（幂等修复）', s.split('礼礼券').length - 1); s = s.split('礼礼券').join('礼券'); notes.push('礼礼券 → 礼券（幂等修复）') }
    const n1 = (s.match(/(?<![礼代优邮现兑])券(?!夹)/g) || []).length
    const n2 = (s.match(/(?<!礼)券夹/g) || []).length
    const unified = s.replace(/(?<!礼)券夹/g, '礼券夹').replace(/(?<![礼代优邮现兑])券(?!夹)/g, '礼券')
    if (unified !== s) { hit('券 → 礼券（券夹 / 泛称）', n1 + n2); s = unified; notes.push('券 → 礼券（券夹 / 泛称）') }
    out = s
  }
  if (!opts.staffSide && out.includes('店长') && !STAFF_ONLY.test(out)) { hit('店长 → 馆长', out.split('店长').length - 1); out = out.split('店长').join('馆长'); notes.push('店长 → 馆长') }
  if (out.includes('去支付')) { hit('去支付 → 立即支付', out.split('去支付').length - 1); out = out.split('去支付').join('立即支付'); notes.push('去支付 → 立即支付') }
  return { out, notes, counts }
}

function runCopy() {
  const files = COPY_DIRS
    .map((d) => join(ROOT, d))
    .filter((d) => existsSync(d))
    .flatMap((d) => walk(d, ['.wxml', '.js', '.json']))
  const stat = {}
  const changed = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const rel = relative(ROOT, file)
    const spans = stringSpans(rel, src)
    if (!spans.length) continue
    const edits = []
    const notes = []
    const staffSide = rel.startsWith('subpackages/manager/')
    for (const sp of spans) {
      const res = fixCopyText(sp.text, { staffSide })
      if (res.out === sp.text) continue
      const out = sp.codes ? unmask(res.out, sp.codes) : res.out
      res.notes.forEach((n) => { stat[n] = (stat[n] || 0) + (res.counts[n] || 1) })
      notes.push(...res.notes)
      edits.push({ start: sp.start, end: sp.end, out })
    }
    if (!edits.length) continue
    changed.push({ file: rel, edits: edits.length, rules: [...new Set(notes)] })
    if (DRY) continue
    edits.sort((a, b) => b.start - a.start)
    let next = src
    for (const e of edits) next = next.slice(0, e.start) + e.out + next.slice(e.end)
    writeFileSync(file, next)
  }
  console.log('== 文案规范 ==')
  for (const [k, v] of Object.entries(stat).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v} 处`)
  console.log(`  涉及文件：${changed.length} 个，替换点：${changed.reduce((s, c) => s + c.edits, 0)} 处${DRY ? '（预演，未写入）' : ''}`)
  if (DRY && changed.length) {
    console.log('  示例文件：')
    for (const c of changed.slice(0, 12)) console.log(`    ${c.file}  [${c.rules.join('、')}]`)
  }
  return changed.map((c) => c.file)
}

/** CSS 里把同值硬编码色换成 token（跳过注释 / 回退值 / 变量定义） */
function fixCssColors(src) {
  const ranges = []
  for (const m of src.matchAll(/\/\*[\s\S]*?\*\//g)) ranges.push([m.index, m.index + m[0].length])
  const stat = {}
  let skipped = 0
  const out = src.replace(/#([0-9a-fA-F]{6})(?![0-9a-fA-F])/g, (m, hex, offset) => {
    const token = COLOR_MAP[`#${hex.toUpperCase()}`]
    if (!token) return m
    if (inRanges(offset, ranges)) { skipped += 1; return m }
    const declStart = Math.max(src.lastIndexOf('{', offset), src.lastIndexOf(';', offset), src.lastIndexOf('}', offset))
    const colon = src.indexOf(':', declStart)
    if (colon === -1 || colon > offset) { skipped += 1; return m }        // 非 k:v 形式
    const prop = src.slice(declStart + 1, colon).trim()
    if (prop.startsWith('--')) { skipped += 1; return m }                  // 变量定义
    const valueSoFar = src.slice(colon + 1, offset)
    if (/var\(\s*--[\w-]+\s*,\s*$/.test(valueSoFar)) { skipped += 1; return m } // var() 回退值
    const key = `${m.toUpperCase()} → var(${token})`
    stat[key] = (stat[key] || 0) + 1
    return `var(${token})`
  })
  return { out, stat, skipped }
}

function runColors() {
  const files = COLOR_DIRS
    .map((d) => join(ROOT, d))
    .filter((d) => existsSync(d))
    .flatMap((d) => walk(d, ['.wxss']))
  const stat = {}
  let changedFiles = 0
  let skippedInPlace = 0
  const changed = []
  const skippedFileList = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    if (!/var\(--/.test(src)) {
      if (Object.keys(COLOR_MAP).some((hex) => new RegExp(hex, 'i').test(src))) skippedFileList.push(relative(ROOT, file))
      continue
    }
    const { out, stat: s, skipped } = fixCssColors(src)
    skippedInPlace += skipped
    for (const [k, v] of Object.entries(s)) stat[k] = (stat[k] || 0) + v
    if (out !== src) {
      changedFiles += 1
      changed.push(relative(ROOT, file))
      if (!DRY) writeFileSync(file, out)
    }
  }
  console.log('\n== 颜色 token ==')
  for (const [k, v] of Object.entries(stat).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v} 处`)
  console.log(`  涉及文件：${changedFiles} 个${DRY ? '（预演，未写入）' : ''}`)
  console.log(`  跳过（回退值 / 变量定义 / 注释）：${skippedInPlace} 处`)
  console.log(`  跳过（文件中尚未用过 var()，需人工确认级联）：${skippedFileList.length} 个`)
  for (const f of skippedFileList.slice(0, 8)) console.log(`    ${f}`)
  return changed
}

const copyChanged = DO_COPY ? runCopy() : []
const colorChanged = DO_COLORS ? runColors() : []

if (MANIFEST) {
  writeFileSync(MANIFEST, JSON.stringify({ copy: copyChanged, colors: colorChanged, dry: DRY }, null, 2))
  console.log(`\n改动清单：${MANIFEST}`)
}
console.log(`\n${DRY ? '（预演模式：加 --fix 才会写入）' : '（已写入）'}`)
