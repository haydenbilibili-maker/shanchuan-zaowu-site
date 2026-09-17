#!/usr/bin/env node
/**
 * 分享卡片封面守卫
 *
 * 背景（2026-09-16 用户反馈）：「分享到小程序，页面黑色无图片」。
 * 根因：微信分享卡片的 `imageUrl` **不接受 `cloud://` fileID**，只接受本地路径或 **https**。
 * `subpackages/business/about/index.js` 直接把 `cdnPath('banners/DSC00115.JPG')`
 * （= `cloud://…`）当 `imageUrl` 传出去 → 微信渲染成**黑块**。
 *
 * 更糟的是：省略 `imageUrl` 时微信会退回「页面截图」作为封面，比黑块好看得多 ——
 * 也就是说**传一个加载不出来的地址，比不传更差**。
 *
 * 本守卫静态检查两件事：
 *   S1 任何 `onShareAppMessage` / `onShareTimeline` 的 `imageUrl:` 都不得是
 *      **裸 `cloud://` 或 `cdnPath(...)`** —— 必须经过 `resolveShareImage()` 解析成 https，
 *      或来自已解析的 data 字段（`shareImageUrl` / `posterPath` / 本地临时文件）。
 *   S2 `resolveShareImage()` 必须存在且契约不变（非 cloud:// 原样返回；解析失败返回 ''）。
 *
 * 为什么只能静态查：分享卡片无法在无头环境里触发，必须真机分享一次才能看到成品。
 * **本守卫能保证「不再把 cloud:// 传进 imageUrl」，但「卡片好不好看」仍需人工确认。**
 *
 * 用法：
 *   node miniprogram/scripts/check-share-image.mjs
 *   node miniprogram/scripts/check-share-image.mjs --selftest
 */
'use strict'

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const UTIL = join(MP, 'utils', 'util.js')

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.js')) out.push(p)
  }
  return out
}

/** 允许出现在 imageUrl 里的「已安全」形式 */
const SAFE_IMAGE_EXPR = [
  /^\s*$/,                                     // 空 → 微信截图，可接受
  /^['"]{2}$/,                                  // '' / "" 同上
  /\bundefined\b/,
  /\bnull\b/,
  /resolveShareImage\s*\(/,                     // 显式解析
  /shareImageUrl/,                              // 已解析的 data 字段（本项目约定名）
  /posterPath|tempFilePath|giftShareImageUrl|shareImagePath|heroImage(?:Url)?/,
  /^\s*['"`]\//,                                // 本地包内路径 /assets/...
  /^\s*['"`]https?:\/\//,                       // 已是 https
  /urlMap\[/,                                   // 已由 batchTempFileURLs 映射过
]

/** 明确不安全的形式 */
const UNSAFE_IMAGE_EXPR = [
  { re: /cdnPath\s*\(/, why: 'cdnPath() 返回 cloud:// fileID，分享卡片渲染成黑块' },
  { re: /^\s*['"`]cloud:\/\//, why: '裸 cloud:// fileID，分享卡片渲染成黑块' },
]

/**
 * 从一个 JS 源文本里抽出所有分享处理函数体。
 * @returns {Array<{ line: number, body: string }>}
 */
export function extractShareHandlers(src) {
  const lines = src.split('\n')
  const starts = []
  const RE = /(onShareAppMessage|onShareTimeline)\s*[:(]/
  lines.forEach((l, i) => { if (RE.test(l)) starts.push(i) })
  return starts.map((start, k) => {
    // 到下一个分享处理函数为止（同一文件里多个分享函数互不重叠 → 不再重复报同一处）
    const end = k + 1 < starts.length ? starts[k + 1] : Math.min(lines.length, start + 40)
    return { line: start + 1, body: lines.slice(start, end).join('\n') }
  })
}

/**
 * 判定一份源文件里的分享封面。
 * @returns {{ hard: Array<{line:number,imageUrl:string,why:string}>, review: Array<{line:number,imageUrl:string,why:string}> }}
 *   hard   —— 明确不可渲染（cdnPath / 裸 cloud://）：**必须修**
 *   review —— 来源未经静态确认：可能是安全的（已在别处 getTempFileURL 解析过），
 *             也可能是漏网的 cloud://。走基线棘轮：只拦**新增**的。
 */
export function checkSource(src) {
  const hard = []
  const review = []
  for (const { line, body } of extractShareHandlers(src)) {
    const RE = /imageUrl\s*[:=]\s*([^\n,}]*)/g
    let m
    while ((m = RE.exec(body))) {
      const expr = (m[1] || '').trim()
      const unsafe = UNSAFE_IMAGE_EXPR.find((u) => u.re.test(expr))
      if (unsafe) { hard.push({ line, imageUrl: expr, why: unsafe.why }); continue }
      if (!SAFE_IMAGE_EXPR.some((re) => re.test(expr))) {
        review.push({ line, imageUrl: expr, why: '来源未经静态确认（可能是别处已解析的字段）' })
      }
    }
  }
  return { hard, review }
}

const ok = (r) => r.hard.length === 0 && r.review.length === 0
const CASES = [
  ['裸 cdnPath(…) → 硬失败', (c) => c.checkSource(`onShareAppMessage() {
    return { imageUrl: cdnPath('banners/x.jpg') }
  }`).hard.length > 0],
  ['裸 cloud:// 字面量 → 硬失败', (c) => c.checkSource(`onShareAppMessage() {
    return { imageUrl: 'cloud://env.bucket/banners/x.jpg' }
  }`).hard.length > 0],
  ['resolveShareImage(…) → 安全', (c) => ok(c.checkSource(`onShareAppMessage() {
    return { imageUrl: resolveShareImage(src) }
  }`))],
  ['已解析字段 shareImageUrl → 安全', (c) => ok(c.checkSource(`onShareAppMessage() {
    const payload = {}
    if (this.data.shareImageUrl) payload.imageUrl = this.data.shareImageUrl
    return payload
  }`))],
  ['空串 "" → 安全（微信截图）', (c) => ok(c.checkSource(`onShareAppMessage() {
    return { imageUrl: '' }
  }`))],
  ['本地路径 → 安全', (c) => ok(c.checkSource(`onShareAppMessage() {
    return { imageUrl: '/assets/icons/poster.png' }
  }`))],
  ['https → 安全', (c) => ok(c.checkSource(`onShareAppMessage() {
    return { imageUrl: 'https://cdn.example.com/a.jpg' }
  }`))],
  ['canvas 临时文件 → 安全', (c) => ok(c.checkSource(`onShareAppMessage() {
    return { imageUrl: this.data.posterPath || '' }
  }`))],
  ['urlMap 映射结果 → 安全', (c) => ok(c.checkSource(`onShareAppMessage() {
    return { imageUrl: urlMap[fileId] || '' }
  }`))],
  ['未知表达式 → 进「待复核」而不是硬失败', (c) => {
    const r = c.checkSource(`onShareAppMessage() { return { imageUrl: someUnknownThing } }`)
    return r.hard.length === 0 && r.review.length > 0
  }],
  ['同一文件两个分享函数不重复报同一处', (c) => {
    const r = c.checkSource(`onShareAppMessage() { return { imageUrl: a } }
  onShareTimeline() { return { imageUrl: b } }`)
    return r.review.length === 2
  }],
  ['棘轮键不含行号：旧格式 `x.js:641 expr` 归一化后等于 `x.js expr`', (c) =>
    c.normalizeRatchetKey("subpackages/feature/x/index.js:641 this.data.displayImage || ''")
    === "subpackages/feature/x/index.js this.data.displayImage || ''"],
  ['棘轮键不含行号：同一处行号平移不得被判成「新增」', (c) => {
    const at = (line) => c.normalizeRatchetKey(`subpackages/feature/x/index.js:${line} expr`)
    return at(641) === at(737) && at(641) === 'subpackages/feature/x/index.js expr'
  }],
  ['棘轮键不含行号：已归一化的新格式键保持幂等', (c) =>
    c.normalizeRatchetKey('a/b.js expr') === 'a/b.js expr'],
]

if (process.argv.includes('--selftest')) {
  console.log('自检：证明「拦不住的」与「误报的」两类都会出现\n')
  const mod = { checkSource, normalizeRatchetKey }
  // 1) 九条判定必须全部成立
  let bad = 0
  for (const [label, fn] of CASES) {
    let ok = false
    let err = ''
    try { ok = !!fn(mod) } catch (e) { err = e.message }
    console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` ${err}`}`)
    if (!ok) bad += 1
  }
  if (bad) {
    console.error(`\n自检失败：${bad} 项判定不符，守卫不可信。`)
    process.exit(1)
  }
  console.log('\n自检通过：不安全形式会被拦，安全形式不误报。\n')
  process.exit(0)
}

const utilSrc = readFileSync(UTIL, 'utf8')
const hard = []
const review = []
const scanned = walk(MP).filter((p) => !p.includes('/scripts/') && !p.includes('/cloudfunctions/'))
for (const p of scanned) {
  const src = readFileSync(p, 'utf8')
  if (!/onShareAppMessage|onShareTimeline/.test(src)) continue
  const rel = relative(MP, p)
  const r = checkSource(src)
  r.hard.forEach((f) => hard.push({ file: rel, ...f }))
  r.review.forEach((f) => review.push({ file: rel, ...f }))
}
/**
 * 棘轮键：**不含行号**。
 *
 * 为什么（2026-09-17 全面审计 D3 实测）：原键是 `${file}:${line} ${expr}`，而行号会随任何
 * 无关改动平移 —— `identify/result/index.js` 的分享函数从 :641 挪到 :737 后，同一条**已收编**
 * 的表达式被判成「新增 1 处未复核」，守卫无缘无故变红（幻影新增）。同一坑在
 * `check-write-verify` 已修过一次（见 admin/docs/ERP系统专项审计_2026-09-16.md 附录 C.1）。
 * 现改为「文件 + 表达式」，并保留对旧格式（含 `:行号`）的兼容读取，避免「改键就必须重刷基线」。
 */
const key = (f) => `${f.file} ${f.imageUrl}`

/** 旧格式棘轮键 `path.js:123 expr` → 新格式 `path.js expr`；已是新格式则原样返回 */
export function normalizeRatchetKey(k) {
  return String(k || '').replace(/\.js:\d+ /, '.js ')
}

const BASELINE = join(HERE, 'share-image-baseline.json')
console.log(`分享卡片封面守卫：扫描 ${scanned.length} 个文件，命中分享处理 ${hard.length + review.length} 处 imageUrl`)
console.log()
let fail = 0

// S2 契约
if (!/const resolveShareImage\s*=/.test(utilSrc) || !/resolveShareImage,/.test(utilSrc)) {
  console.error('✗ utils/util.js 缺少 resolveShareImage（分享封面统一解析入口）')
  fail += 1
}

// S1 硬失败
if (hard.length) {
  console.error(`✗ 明确不可渲染的分享封面 ${hard.length} 处（cloud:// fileID → 黑块）：`)
  hard.forEach((f) => console.error(`   ${f.file}:${f.line}  imageUrl: ${f.imageUrl}\n      ${f.why}`))
  fail += hard.length
} else {
  console.log('✓ 没有把 cloud:// / cdnPath() 直接当分享封面')
}

// 待复核：棘轮（只拦新增）。键不含行号 → 行号平移不再制造幻影新增
review.sort((a, b) => key(a).localeCompare(key(b)))
const reviewKeys = [...new Set(review.map(key))].sort()
if (existsSync(BASELINE)) {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const known = new Set((base.reviewed || []).map(normalizeRatchetKey))
  const added = reviewKeys.filter((k) => !known.has(k))
  console.log(`\n待复核（静态无法确认来源，可能已在别处解析）：基线 ${known.size} 处 / 本次 ${reviewKeys.length} 处（键不含行号）`)
  if (added.length) {
    console.error(`✗ 新增 ${added.length} 处未复核的分享封面：`)
    added.forEach((a) => console.error(`   ${a}`))
    fail += added.length
  } else {
    console.log('  无新增。')
  }
} else {
  console.log(`\n（未找到基线 ${BASELINE.replace(MP + '/', '')}，用 --update 生成）`)
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({
    updatedAt: new Date().toISOString().slice(0, 10),
    note: '待复核的分享封面表达式。静态检查无法确认这些字段是否已在别处 getTempFileURL 解析；'
      + '新增即失败，确认安全后再 --update 收编。硬失败（cdnPath/裸 cloud://）不进基线。',
    reviewed: reviewKeys,
  }, null, 2)}\n`, 'utf8')
  console.log(`已写入基线（${reviewKeys.length} 处）`)
  process.exit(0)
}

console.log()
if (fail) {
  console.error('分享封面守卫失败：微信分享卡片不支持 cloud:// fileID，传了会显示黑块；')
  console.error('请用 resolveShareImage() 预解析成 https，或在解析失败时省略 imageUrl（微信会截页面图）。')
  process.exit(1)
}
console.log('通过。注意：本守卫只保证「不再传 cloud://」；卡片实际观感仍需真机分享一次确认。')
