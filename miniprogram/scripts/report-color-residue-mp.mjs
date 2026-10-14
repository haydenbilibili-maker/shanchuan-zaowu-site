#!/usr/bin/env node
/**
 * 小程序侧**色彩残留**分类器 —— **只报告，不改动**
 *
 * 对标 ERP 的 `npm run report:colors`（`admin/scripts/report-color-residue.mjs`）。
 * 为什么小程序侧也要有：`VIS3落地规范_2026-10-13.md` §4-3 的「品类色逐页收口」一直卡在
 * **没有判断依据**上 —— 直接 find-replace 会把「成功色」当成「品类色」改错。
 *
 * ── 为什么不能 find-replace（本脚本存在的唯一理由）─────────────────────────
 * `app.wxss` 里这些**字面量相同、语义不同**：
 *   `--color-insecta: #52B788`  与  `--color-success: #52B788`   ← 昆虫品类色 / 成功态
 *   `--color-marine:  #5B8FB9`  与  `--color-info:    #5B8FB9`   ← 海洋·化石品类色 / 信息态
 * 同一个 `#52B788` 出现在 `.tag-insecta` 上和出现在 `.status-ok` 上，**该换成两个不同的令牌**。
 * 靠正则替换必然改错一半 —— 所以本脚本的产出是**判断依据**，不是补丁。
 *
 * ── 口径（三条）────────────────────────────────────────────────────────
 * ① **合规写法不算残留**：`var(--color-insecta, #52B788)` 里的字面量是**兜底值**，
 *    是规范写法（令牌缺失时仍能看），单独计数、不计入"需收口"。
 * ② **按"最近令牌"给候选**：字面量与某个令牌**同值** → 直接给该令牌；
 *    否则按 RGB 距离给最近的 1~2 个令牌 + 距离值（机械可算，不含主观判断）。
 * ③ **同值多令牌 = ambiguous**：一个字面量同时命中"品类色"和"功能色"时，
 *    标注 `ambiguous` 并**同时列出两个候选令牌** —— 这正是"必须人工定语义"的地方。
 *
 * 用法：
 *   node miniprogram/scripts/report-color-residue-mp.mjs            # 人读汇总
 *   node miniprogram/scripts/report-color-residue-mp.mjs --json     # 机器可读
 *   node miniprogram/scripts/report-color-residue-mp.mjs --ambiguous # 只看同值多令牌的
 *   node miniprogram/scripts/report-color-residue-mp.mjs --selftest # 判据自检（内存合成样本，不碰真源码）
 *
 * ⚠️ **只读**：不写任何文件。也**故意不进守卫**（先给依据、拍板后再谈替换；
 *    要拧成守卫就照 ERP 的路线加 `--strict` + 基线棘轮）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const MP = resolve(ROOT, 'miniprogram')
const SKIP = new Set(['node_modules', '.git', 'miniprogram_npm', 'dist', '.tmp', 'assets'])
const argv = process.argv.slice(2)
const has = (n) => argv.includes(n)

/** 品类色 / 功能色：**同值不同义**这两组是"语义 ambiguous"的来源 */
const CATEGORY_TOKENS = ['--color-wood', '--color-forest', '--color-insecta', '--color-minerals', '--color-plantae', '--color-marine']
const FUNCTIONAL_TOKENS = ['--color-success', '--color-warning', '--color-error', '--color-info']
/**
 * VIS 3.0 命名（规范第 04/05/06 页的那套）—— 与"短名"（`--primary` / `--bg-root` / `--text-main` …）
 * **同值并存**。实测 `app.wxss` 99 条令牌里 **38 条是短名**，且 **12 组值挂了多个令牌**
 * （`#C4A76C` 一个值挂了 `--primary` / `--gold` / `--text-gold` / `--color-primary` /
 * `--color-text-latin` / `--brass-400` **六个**）。
 * 所以"最近令牌"必须**优先给 VIS 3.0 名**，否则收口会收到历史短名上（那是反向收口）。
 */
const VIS3_TOKEN_RE = /^--(color|brass|dark|radius|dur|fs|font)-/

/* ── 采集 ────────────────────────────────────────────────────────────── */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(wxss|wxml)$/.test(name)) out.push(p)
  }
  return out
}
const readSrc = (p) => readFileSync(p, 'utf8')
const stripComments = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')

/** 从 app.wxss 的 `page { … }` 里取令牌表（唯一事实源） */
function loadTokens(src) {
  const start = src.indexOf('page {')
  if (start < 0) return {}
  const body = src.slice(start, src.indexOf('\n}', start))
  const out = {}
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const v = m[2].trim()
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)
    const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v)
    let rgb = null
    if (hex) {
      let h = hex[1]
      if (h.length === 3) h = h.split('').map((c) => c + c).join('')
      rgb = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
    } else if (rgba) rgb = [+rgba[1], +rgba[2], +rgba[3]]
    out[m[1]] = { raw: v, rgb }
  }
  return out
}

const HEX_RE = /#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi
const RGB_RE = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/gi
const toRgb = (lit) => {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(lit)
  if (h) {
    let x = h[1]
    if (x.length === 3) x = x.split('').map((c) => c + c).join('')
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)]
  }
  const r = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(lit)
  return r ? [+r[1], +r[2], +r[3]] : null
}
const dist = (a, b) => (a && b ? Math.round(Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)) : Infinity)
const norm = (lit) => {
  const rgb = toRgb(lit)
  return rgb ? '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase() : lit.toUpperCase()
}

/* ── 判据（纯函数，便于自检）────────────────────────────────────────── */
/** 判断一个字面量在给定令牌表下的归类 */
function classify(lit, tokens) {
  const rgb = toRgb(lit)
  const same = Object.entries(tokens).filter(([, t]) => t.rgb && dist(rgb, t.rgb) === 0).map(([k]) => k)
  const cat = same.filter((k) => CATEGORY_TOKENS.includes(k))
  const fn = same.filter((k) => FUNCTIONAL_TOKENS.includes(k))
  const vis3 = same.filter((k) => VIS3_TOKEN_RE.test(k))
  const legacy = same.filter((k) => !VIS3_TOKEN_RE.test(k))
  const near = Object.entries(tokens)
    .filter(([, t]) => t.rgb)
    // 同距离时**VIS 3.0 名优先**（收口要往规范那套收，不能收到历史短名上）
    .map(([k, t]) => ({ token: k, d: dist(rgb, t.rgb), vis3: VIS3_TOKEN_RE.test(k) }))
    .sort((a, b) => a.d - b.d || (b.vis3 ? 1 : 0) - (a.vis3 ? 1 : 0))
    .slice(0, 2)
  return {
    key: norm(lit),
    sameTokens: vis3.concat(legacy),
    vis3Tokens: vis3,
    legacyTokens: legacy,
    /** 同值同时命中"品类色"和"功能色" → 必须人工定语义（改错就是改错语义） */
    isAmbiguous: cat.length > 0 && fn.length > 0,
    /** 同值同时挂了 VIS 3.0 名与历史短名 → 收口时要定向到 VIS 3.0 名 */
    isNamingDuplicate: vis3.length > 0 && legacy.length > 0,
    categoryCandidate: cat[0] || null,
    functionalCandidate: fn[0] || null,
    nearest: near
  }
}

/** 扫一个文件：返回 { 字面量 → { 处数, 兜底处数 } } */
function scanText(src, tokens) {
  const code = stripComments(src)
  const fbRanges = []
  for (const m of code.matchAll(/var\([^)]*,\s*([^)]+)\)/g)) {
    fbRanges.push([m.index, m.index + m[0].length, m[1].trim()])
  }
  const isFallback = (lit, at) => fbRanges.some(([s, e, v]) => at >= s && at < e && norm(v) === norm(lit))
  const hits = new Map()
  for (const re of [HEX_RE, RGB_RE]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(code))) {
      const lit = m[0]
      const info = classify(lit, tokens)
      const cur = hits.get(info.key) || { ...info, count: 0, fallback: 0 }
      cur.count += 1
      if (isFallback(lit, m.index)) cur.fallback += 1
      hits.set(info.key, cur)
    }
  }
  return hits
}

/* ── 自检 ────────────────────────────────────────────────────────────── */
if (has('--selftest')) {
  const tokens = {
    '--color-insecta': { raw: '#52B788', rgb: [0x52, 0xB7, 0x88] },
    '--color-success': { raw: '#52B788', rgb: [0x52, 0xB7, 0x88] },
    '--color-marine': { raw: '#5B8FB9', rgb: [0x5B, 0x8F, 0xB9] },
    '--color-bg': { raw: '#1A1814', rgb: [0x1A, 0x18, 0x14] }
  }
  const t = (name, cond, extra) => {
    if (cond) console.log(`  ✓ ${name}`)
    else { console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); process.exitCode = 1 }
  }
  // ① 同值多令牌必须被判 ambiguous（这是"不能 find-replace"的核心判据）
  const c1 = classify('#52B788', tokens)
  t('同值多令牌判 ambiguous', c1.isAmbiguous === true, JSON.stringify(c1))
  t('ambiguous 同时给出品类色与功能色两个候选',
    c1.categoryCandidate === '--color-insecta' && c1.functionalCandidate === '--color-success', JSON.stringify(c1))
  // ② 同值单令牌不算 ambiguous
  const c2 = classify('#5B8FB9', tokens)
  t('同值单令牌不算 ambiguous', c2.isAmbiguous === false && c2.sameTokens.includes('--color-marine'))
  // ③ var() 兜底算合规、不计入需收口
  const h3 = scanText('.a { color: var(--color-bg, #1A1814); }', tokens)
  t('var() 兜底识别为合规', h3.get('#1A1814') && h3.get('#1A1814').fallback === 1, JSON.stringify([...h3]))
  // ④ 非兜底的裸字面量要计数
  const h4 = scanText('.a { color: #1A1814; } .b { color: #1A1814; }', tokens)
  t('裸字面量按处数累计', h4.get('#1A1814') && h4.get('#1A1814').count === 2 && h4.get('#1A1814').fallback === 0)
  // ⑤ 注释里的字面量不算（注释不是代码）
  const h5 = scanText('/* color: #1A1814 */ .a { color: #FFFFFF; }', tokens)
  t('注释里的字面量不计入', !h5.has('#1A1814'), JSON.stringify([...h5.keys()]))
  // ⑥ 最近令牌要给距离
  const c6 = classify('#52B789', tokens)
  t('非精确同值给最近令牌 + 距离', c6.sameTokens.length === 0 && c6.nearest[0].d <= 2, JSON.stringify(c6.nearest))
  // ⑦ 同值挂"VIS 3.0 名 + 历史短名"要判 namingDuplicate，且同距离时 VIS 3.0 名排前
  const c7 = classify('#1A1814', { ...tokens, '--bg-root': { raw: '#1A1814', rgb: [0x1A, 0x18, 0x14] } })
  t('同值新旧两套命名判 namingDuplicate', c7.isNamingDuplicate === true && c7.legacyTokens.includes('--bg-root'), JSON.stringify(c7))
  t('sameTokens 里 VIS 3.0 名排在历史短名之前',
    c7.sameTokens.indexOf('--color-bg') < c7.sameTokens.indexOf('--bg-root'), JSON.stringify(c7.sameTokens))
  const c8 = classify('#1A1815', { ...tokens, '--bg-root': { raw: '#1A1814', rgb: [0x1A, 0x18, 0x14] } })
  t('同距离时 VIS 3.0 名优先（不收口到历史短名）', c8.nearest[0].token === '--color-bg', JSON.stringify(c8.nearest))
  console.log(process.exitCode ? '\n✗ selftest 失败' : '\n✓ selftest 通过：6 项判据（合成样本，未读真实源码）')
  process.exit(process.exitCode || 0)
}

/* ── 主流程 ──────────────────────────────────────────────────────────── */
const tokens = loadTokens(readSrc(join(MP, 'app.wxss')))
if (!Object.keys(tokens).length) {
  console.error('✗ 读不到 app.wxss 的令牌表（判据主语消失 = 假通过）')
  process.exit(1)
}

const files = walk(MP)
const perFile = []
const byLiteral = new Map()
for (const abs of files) {
  const hits = scanText(readSrc(abs), tokens)
  if (!hits.size) continue
  const rel = relative(ROOT, abs)
  perFile.push({ file: rel, hits: [...hits.values()] })
  for (const h of hits.values()) {
    const cur = byLiteral.get(h.key) || { ...h, count: 0, fallback: 0, files: new Set() }
    cur.count += h.count
    cur.fallback += h.fallback
    cur.files.add(rel)
    byLiteral.set(h.key, cur)
  }
}

const literalRows = [...byLiteral.values()]
  .map((r) => ({ ...r, need: r.count - r.fallback, files: r.files.size }))
  .sort((a, b) => b.need - a.need || b.count - a.count)
const ambiguous = literalRows.filter((r) => r.isAmbiguous && r.need > 0)
const namingDup = literalRows.filter((r) => r.isNamingDuplicate && r.need > 0)

if (has('--json')) {
  console.log(JSON.stringify({
    tokenCount: Object.keys(tokens).length,
    scannedFiles: files.length,
    totals: {
      occurrences: literalRows.reduce((s, r) => s + r.count, 0),
      compliantFallbacks: literalRows.reduce((s, r) => s + r.fallback, 0),
      needTokenizing: literalRows.reduce((s, r) => s + r.need, 0),
      ambiguousLiterals: ambiguous.length,
      namingDuplicateLiterals: namingDup.length
    },
    literals: literalRows.map((r) => ({ ...r, files: [...r.files] })),
    perFile
  }, null, 1))
  process.exit(0)
}

const pad = (s, n) => String(s).padEnd(n)
if (has('--ambiguous')) {
  console.log(`小程序色彩残留 · **同值多令牌**：${ambiguous.length + namingDup.length} 个\n`)
  console.log(`① 语义 ambiguous（同值既是品类色又是功能色 → **必须人工定语义**）：${ambiguous.length} 个`)
  for (const r of ambiguous) {
    console.log(`  ${r.key}  ${r.need} 处 / ${r.files} 文件`)
    console.log(`    品类候选 ${r.categoryCandidate}   ←→   功能候选 ${r.functionalCandidate}`)
  }
  if (!ambiguous.length) console.log('  （无）')
  console.log(`\n② 命名重复（同值同时挂 VIS 3.0 名与历史短名 → 收口要**定向到 VIS 3.0 名**）：${namingDup.length} 个`)
  for (const r of namingDup) {
    console.log(`  ${r.key}  ${r.need} 处 / ${r.files} 文件`)
    console.log(`    VIS 3.0: ${r.vis3Tokens.join(' / ')}`)
    console.log(`    历史短名: ${r.legacyTokens.join(' / ')}`)
  }
  if (!namingDup.length) console.log('  （无）')
  process.exit(0)
}

console.log(`小程序色彩残留盘点（**只报告不改动**）· 扫描 ${files.length} 个 wxss/wxml · 令牌 ${Object.keys(tokens).length} 条\n`)
console.log(`合计：字面量 ${literalRows.reduce((s, r) => s + r.count, 0)} 处`
  + ` ＝ 合规 var() 兜底 ${literalRows.reduce((s, r) => s + r.fallback, 0)} 处`
  + ` + **需收口 ${literalRows.reduce((s, r) => s + r.need, 0)} 处**`)
console.log(`其中**同值多令牌**（不能盲替）${ambiguous.length + namingDup.length} 个`
  + ` ＝ 语义 ambiguous ${ambiguous.length} 个（${ambiguous.reduce((s, r) => s + r.need, 0)} 处，品类↔功能）`
  + ` + 命名重复 ${namingDup.length} 个（${namingDup.reduce((s, r) => s + r.need, 0)} 处，VIS 3.0 名↔历史短名）\n`)
console.log(`  ${pad('字面量', 10)}${pad('处数', 6)}${pad('兜底', 6)}${pad('需收口', 8)}${pad('文件', 6)}归类`)
for (const r of literalRows.slice(0, 24)) {
  const tag = r.isAmbiguous
    ? `ambiguous → ${r.categoryCandidate} / ${r.functionalCandidate}`
    : (r.isNamingDuplicate
      ? `命名重复 → ${r.vis3Tokens[0]}（另有短名 ${r.legacyTokens.join('/')}）`
      : (r.sameTokens[0] ? `→ ${r.sameTokens[0]}` : `最近 ${r.nearest[0] ? r.nearest[0].token + ' Δ' + r.nearest[0].d : '—'}`))
  console.log(`  ${pad(r.key, 10)}${pad(r.count, 6)}${pad(r.fallback, 6)}${pad(r.need, 8)}${pad(r.files, 6)}${tag}`)
}
if (literalRows.length > 24) console.log(`  …另有 ${literalRows.length - 24} 个字面量（--json 看全量）`)
console.log('\n提示：`--ambiguous` 只看"同值多令牌"；`--json` 出全量（含按文件明细）。')
console.log('⚠️ 本脚本**不产出补丁** —— 品类色收口要逐页定语义（见 VIS3落地规范 §4-3 / §7.1）。')
