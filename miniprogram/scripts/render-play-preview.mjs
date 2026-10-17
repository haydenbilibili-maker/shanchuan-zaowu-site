#!/usr/bin/env node
/**
 * 玩法页渲染台（四个玩法页**共用一个**）—— 2026-09-22 集成官新增。
 *
 * 为什么需要它（夜班交接 §6 自己登记的欠账）：
 *   四个玩法页（今日一签 / 拆签饼 / 星座签 / MBTI 贴士）**只有静态判据 + 行为单测**，
 *   **零真渲染几何** —— 也就是说"页面上到底画成什么样"从来没被量过。
 *   而玩法页正是"交互视觉排版"最该看的地方（入口形态 / 进行态 / 结果纸面 / 动作行）。
 *
 * 用法：
 *   node miniprogram/scripts/render-play-preview.mjs --page qian            # 出图（入口态）
 *   node miniprogram/scripts/render-play-preview.mjs --page qian --stage result --check
 *   node miniprogram/scripts/render-play-preview.mjs --page qian --selftest
 *
 * 页面：qian（签筒）。2026-10-17 旧祈福墙退场，拆签饼 / 星座签 / MBTI / 节气签 / 铜钱签五个玩法页已删，只剩今日一签。
 * 阶段：entry（未开始）/ pending（进行中）/ need（缺资料）/ result（结果纸面）/ archive（留档展开）
 *
 * 判据（每一条都配 --selftest 注入，证明它会红）：
 *   ① 无横向溢出；② 可点区 ≥88rpx；③ 关键文案行数上限；④ 结果态动作行同一行；
 *   ⑤ **本页自己的形态类必须在**（签筒/饼壳/星盘/双极轴 —— 这条同时锁住"各开一页、四种形态"）；
 *   ⑥ 主 CTA 首屏可见；⑦ 纸面宽度不超视口。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const MP = join(ROOT, 'miniprogram')
const TMP_DIR = join(MP, 'scripts/.tmp')
mkdirSync(TMP_DIR, { recursive: true })

const argv = process.argv.slice(2)
const has = (n) => argv.includes(n)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

const PAGES = {
  // form = 入口形态；paper = 结果纸面的**内容类**（各页各自的纸面语言，不是同一种）
  qian: { id: 'qian', label: '今日一签', form: '.rp-tube', paper: '.rp-paper-title' }
}
const STAGES = ['entry', 'pending', 'need', 'result', 'archive']
const PAGE_KEY = argOf('--page', 'qian')
const STAGE = argOf('--stage', 'entry')
if (!PAGES[PAGE_KEY]) {
  console.error(`✗ 未知玩法 ${PAGE_KEY}（可用：${Object.keys(PAGES).join(' / ')}）`)
  process.exit(2)
}
if (!STAGES.includes(STAGE)) {
  console.error(`✗ 未知阶段 ${STAGE}（可用：${STAGES.join(' / ')}）`)
  process.exit(2)
}
const PAGE = PAGES[PAGE_KEY]
const OUT = argOf('--out', join(TMP_DIR, `play-preview-${PAGE_KEY}-${STAGE}.png`))

/* ── 允许把源码指向 .tmp 副本（自检注入用；真源码全程只读） ───────────────── */
const pageDir = resolve(MP, `subpackages/plays/play-${PAGE_KEY}`)
const pageWxmlPath = process.env.PLAY_PREVIEW_WXML ? resolve(process.env.PLAY_PREVIEW_WXML) : join(pageDir, 'index.wxml')
const pageWxssPath = process.env.PLAY_PREVIEW_WXSS ? resolve(process.env.PLAY_PREVIEW_WXSS) : join(pageDir, 'index.wxss')
const sharedWxssPath = process.env.PLAY_PREVIEW_SHARED ? resolve(process.env.PLAY_PREVIEW_SHARED) : resolve(MP, 'subpackages/plays/play-shared/ritual-play.wxss')

/* ── 真源码的样式：先剥注释，再做 rpx→px（与另外两个渲染台同口径） ─────────── */
const toCss = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(\d*\.?\d+)rpx/g, (_, n) => `${Number(n)}px`)
  .replace(/env\(safe-area-inset-bottom\)/g, '0px')

const appCss = toCss(readFileSync(join(MP, 'app.wxss'), 'utf8'))
const pageVarBlock = (() => {
  const m = /(^|\n)page\s*\{([\s\S]*?)\}/.exec(appCss)
  return m ? m[2] : ''
})()
const vars = [...toCss(pageVarBlock).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
  .map((m) => `  ${m[1]}: ${m[2].trim()};`)
  .join('\n')
// 页面 wxss 第一行是 `@import "../play-shared/ritual-play.wxss"` —— 预览里就地展开（顺序：共享在前）
const pageWxssRaw = readFileSync(pageWxssPath, 'utf8')
const sharedWxss = toCss(readFileSync(sharedWxssPath, 'utf8'))
const pageOwnWxss = toCss(pageWxssRaw.replace(/@import\s+["'][^"']+["']\s*;?/g, ''))

/* ── 页面数据：从**真工厂**取（四页数据形状同源，不手抄） ─────────────────── */
function loadCjs (absPath, cache = new Map()) {
  if (cache.has(absPath)) return cache.get(absPath)
  const mod = { exports: {} }
  cache.set(absPath, mod.exports)
  const src = readFileSync(absPath, 'utf8')
  const req = (id) => {
    if (!id.startsWith('.')) throw new Error('preview 只解析相对 require：' + id)
    let p = resolve(dirname(absPath), id)
    if (!existsSync(p) && existsSync(p + '.js')) p += '.js'
    return loadCjs(p, cache)
  }
  new Function('module', 'exports', 'require', src)(mod, mod.exports, req)
  cache.set(absPath, mod.exports)
  return mod.exports
}

const factory = loadCjs(resolve(MP, 'subpackages/plays/utils/ritualPlayPage.js'))
const baseData = factory.createRitualPlayPage(PAGE.id).data

/** 结果纸面样本：各玩法各用**自己的纸面语言** */
const RESULT = {
  qian: { mark: '签', name: '今日一签', overline: '今日一签', title: '宜 开口', sub: '忌 憋着', lines: ['想要什么就说出来，说出口才有回音。'], note: '今天只做一件小事也算数。', wish: '马上有回应' }
}

function stagePatch (stage) {
  if (stage === 'entry') return { stage: 'idle' }
  if (stage === 'pending') return { stage: 'pending' }
  if (stage === 'need') {
    return { stage: 'need', need: { fieldLabel: '出生日期', gain: '才能按星座给一句' } }
  }
  const won = {
    stage: 'result',
    result: RESULT[PAGE.id],
    playedToday: true,
    reco: { label: '偏「求学」· 为你配一件', title: '潮汐书页', latinName: 'Haliotis iris', priceText: '¥78' }
  }
  if (stage === 'archive') {
    Object.assign(won, {
      archiveOpen: true,
      archive: [
        { at: 1, dayKey: '2026-09-21', label: '宜 开口' },
        { at: 2, dayKey: '2026-09-20', label: '宜 早睡' }
      ]
    })
  }
  return won
}

const data = Object.assign({}, baseData, stagePatch(STAGE))
// `<include src>` 按**真页面目录**解析（自检注入的副本可能不在页面目录里）；被 include 的片段自身的 wx:if 照常生效
const expandIncludes = (src, baseDir, depth = 0) => (depth > 3 ? src : src.replace(/<include\s+src="([^"]+)"\s*\/>/g, (_, spec) => {
  const p = resolve(baseDir, spec)
  return existsSync(p) ? expandIncludes(readFileSync(p, 'utf8'), dirname(p), depth + 1) : ''
}))
const wxmlSrc = expandIncludes(readFileSync(pageWxmlPath, 'utf8'), pageDir)

/* 可点区选择器**从 WXML 的 bindtap 元素自动派生**（2026-09-22）。
 * ⚠️ 原来是手工清单（5 个），于是 `.rp-variant`（星座/MBTI 的「换一个」选项，12/16 个格子）
 * **从未被量过** —— 盲区。手工清单必然会漏，漏了还不报错（正是本仓最怕的"判据不全 = 假绿"）。
 * 现在凡带 bindtap 的元素，取其 class 的首个 rp- 令牌作为选择器，逐个量可点区。 */
const TAP_SELECTORS = Array.from(new Set(
  Array.from(wxmlSrc.matchAll(/<[\w-]+([^>]*?)bindtap="[^"]*"([^>]*?)>/g))
    .map((m) => {
      // ⚠️ matchAll 的结果是类数组：用 m[1]/m[2]，没有 m.group()
      const cls = /class="([^"]+)"/.exec(m[1] + m[2])
      if (!cls) return ''
      const tok = String(cls[1]).split(/\s+/).find((t) => /^rp-[a-z-]+$/.test(t))
      return tok ? '.' + tok : ''
    })
    .filter(Boolean)
)).sort()
// 页面里的 `<app-toast .../>` 是自定义组件：预览没有实现，renderWxml 会整棵跳过（带 - 的标签）
const markup = renderWxml(wxmlSrc, data)

const FREEZE_CSS = `* { animation: none !important; transition: none !important; }
.rp-stick { opacity: 1 !important; transform: none !important; }
.rp-shell-slip { opacity: 1 !important; }`

const html = `<!doctype html><html><head><meta charset="utf-8">
<script>const __TAP_SELECTORS__ = ${JSON.stringify(TAP_SELECTORS)};</script>
<style>
:root {
${vars}
}
html, body { margin: 0; padding: 0; width: 750px; background: #14120F; }
${appCss.replace(/(^|\n)page\s*\{[\s\S]*?\}/, '')}
${sharedWxss}
${pageOwnWxss}
${FREEZE_CSS}
</style></head>
<body>${markup}</body></html>`

const htmlPath = join(TMP_DIR, `play-preview-${PAGE_KEY}-${STAGE}.html`)
const shotPath = join(TMP_DIR, `play-preview-shot-${PAGE_KEY}-${STAGE}.html`)
writeFileSync(htmlPath, html.replace('</body>', `${MEASURE_JS()}</body>`))
// 出图：进行态放行动画（虚拟时间推进到真实状态）；其它阶段把动画时长压成 0、直接落在终态 ——
// 结果态的图片请求会吃掉虚拟时间预算，入场淡入常被截在半途（整页发灰、纸面空白，2026-10-15 实见）
const SETTLE_CSS = '* { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }'
writeFileSync(shotPath, html.replace(FREEZE_CSS, STAGE === 'pending' ? '' : SETTLE_CSS))

/* 量几何的页内脚本：结果写进 <pre id="play-metrics">，靠 --dump-dom 取回。
   ⚠️ 这段是**注入到页面里的字符串**：注释里不许出现反引号（会截断外层模板，本仓栽过 8 次），一律用「」。 */
function MEASURE_JS () {
  return `
<script>
window.addEventListener('load', () => {
  const out = []
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  /* 视觉行数：Range 的矩形按 top 聚类（同一行内的盒子 top 几乎相同）。
     只数可见框内、且只保留最内层矩形 —— 两条都是踩过的坑（详见 render-wall-feed-preview 同名字段）。 */
  const lineCount = (el) => {
    const r = document.createRange(); r.selectNodeContents(el)
    const all = Array.from(r.getClientRects()).filter((x) => x.height > 1 && x.width > 0)
    const boxBottom = el.getBoundingClientRect().bottom
    const inner = all.filter((x) => !all.some((o) => o !== x &&
      o.left >= x.left - 1 && o.right <= x.right + 1 && o.top >= x.top - 1 && o.bottom <= x.bottom + 1))
    const rects = (inner.length ? inner : all).filter((x) => x.top < boxBottom - 1)
    if (!rects.length) return 0
    const cs = getComputedStyle(el)
    const lh = parseFloat(cs.lineHeight) || 0
    const fs = parseFloat(cs.fontSize) || 0
    const tol = lh > 1 ? lh / 2 : Math.max(8, fs * 0.75)
    const tops = []
    rects.map((x) => x.top).sort((a, b) => a - b).forEach((t) => {
      if (!tops.length || t - tops[tops.length - 1] > tol) tops.push(t)
    })
    return tops.length
  }
  const push = (label, sel, maxLines, mode) => {
    const el = document.querySelector(sel)
    if (!el) { out.push({ label, sel, missing: true, lines: 0, maxLines: maxLines || 0, mode: mode || 'lines' }); return }
    const cs = getComputedStyle(el)
    const kids = Array.from(el.children).filter((k) => k.getBoundingClientRect().height > 1)
    /* 「是否同一行」按**垂直重叠**判，不按 top 相等：
       同一行里不同字号的子元素 top 天然不同（居中排的更明显），按 top 比会必然误报。
       竖排列则相邻子元素**不重叠** ⇒ 正确判为不在同一行。 */
    const boxes = kids.map((k) => k.getBoundingClientRect())
    const overlapRow = boxes.length < 2 ? true : boxes.every((a) => boxes.every((b) => {
      const ov = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      return ov > 0.5 * Math.min(a.height, b.height)
    }))
    // 竖排列的不变量：相邻**不重叠**（重叠 = 真的画到一起了）
    const sorted = boxes.slice().sort((a, b) => a.top - b.top)
    const noOverlapCol = sorted.every((b, i) => i === 0 || b.top >= sorted[i - 1].bottom - 1)
    const tops = kids.map((k) => k.getBoundingClientRect().top)
    out.push(Object.assign({ label, sel }, rect(el), {
      lines: lineCount(el),
      maxLines: maxLines || 0,
      mode: mode || 'lines',
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      overflowX: cs.overflowX !== 'hidden' && el.scrollWidth > el.clientWidth + 1,
      // 装饰件（aria-hidden）允许刻意外挑（例：签筒的口沿比筒身宽 2rpx）——
      // 判据要区分"形状外挑"与"文字被切/整页横向滚动"
      ariaHidden: el.getAttribute('aria-hidden') === 'true',
      sameRow: overlapRow,
      noOverlapCol,
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24)
    }))
  }
  // 清单由 Node 侧从 WXML 的 bindtap 自动派生后注入（见上面的 TAP_SELECTORS）
  const TAPS = __TAP_SELECTORS__
  out.push({ label: '视口', sel: ':window', x: 0, y: 0, w: innerWidth, h: innerHeight, lines: 0, maxLines: 0, mode: 'lines' })
  push('页容器 .rp-page', '.rp-page')
  push('页头玩法名', '.rp-hero-name', 2)
  push('页头状态句', '.rp-hero-state', 1)
  push('主按钮 .rp-cta', '.rp-cta')
  push('玩法提示 .rp-hint', '.rp-hint', 2)
  push('进行态文案 .rp-spin-text', '.rp-spin-text', 1)
  push('缺资料块 .rp-need', '.rp-need')
  push('缺资料按钮 .rp-need-cta', '.rp-need-cta', 1)
  push('结果纸面 .rp-paper', '.rp-paper')
  push('纸面字标 .rp-paper-mark', '.rp-paper-mark', 1)
  push('纸面标题 .rp-paper-title', '.rp-paper-title', 2)
  push('纸面正文行', '.rp-line', 3)
  push('纸面小注 .rp-note', '.rp-note', 3)
  // .rp-acts 是 flex-direction: column（**竖排是设计**）—— 判"相邻不许重叠"，不判同行
  push('动作行 .rp-acts', '.rp-acts', 0, 'col')
  push('主动作 .rp-act', '.rp-act', 1)
  push('推荐行 .rp-reco', '.rp-reco', 0, 'same-row')
  push('留档开关', '.rp-archive-toggle', 1)
  push('留档行', '.rp-archive-row', 0, 'same-row')
  push('页脚 .rp-foot', '.rp-foot', 2)
  push('本页形态', '${PAGE.form}')
  push('本页纸面内容', '${PAGE.paper}')
  const taps = TAPS.map((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { sel, w: Math.round(r.width), h: Math.round(r.height) }
  }).filter(Boolean)
  out.push({ label: '可点区', sel: ':taps', mode: 'taps', lines: 0, maxLines: 0, x: 0, y: 0, w: 0, h: 0, taps })
  // 整页是否横向滚动 —— 这才是"溢出"的用户可见后果
  out.push({ label: '整页横向', sel: ':pageh', mode: 'pageh', lines: 0, maxLines: 0, x: 0, y: 0, w: document.body.scrollWidth, h: innerWidth,
    overflowX: document.body.scrollWidth > innerWidth + 1 })
  const pre = document.createElement('pre')
  pre.id = 'play-metrics'
  pre.textContent = JSON.stringify(out)
  document.body.appendChild(pre)
})
</script>`
}

/* ── 无头 Chrome：--dump-dom 量几何、--screenshot 出图 ───────────────────── */
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].find((p) => existsSync(p))
if (!CHROME) {
  console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）')
  process.exit(1)
}

function runChrome (args) {
  return new Promise((done) => {
    const profile = mkdtempSync(join(tmpdir(), 'sc-play-preview-'))
    const child = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--no-default-browser-check', `--user-data-dir=${profile}`, '--hide-scrollbars',
      '--force-device-scale-factor=1', '--virtual-time-budget=1500',
      ...args
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch (e) { /* ignore */ } }, 90000)
    child.on('close', () => {
      clearTimeout(timer)
      try { rmSync(profile, { recursive: true, force: true }) } catch (e) { /* ignore */ }
      done(out)
    })
  })
}

const dom = await runChrome(['--window-size=750,1334', '--dump-dom', `file://${htmlPath}`])
const m = /<pre id="play-metrics">([\s\S]*?)<\/pre>/.exec(dom)
if (!m) {
  console.error('✗ 没拿到量测结果（--dump-dom 里找不到 #play-metrics）—— Chrome 可能被沙箱拦了')
  process.exit(1)
}
const metrics = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
const byLabel = (l) => metrics.find((x) => x.label === l)

/* ── 判据 ──────────────────────────────────────────────────────────────── */
const problems = []
const isResult = STAGE === 'result' || STAGE === 'archive'
const vp = byLabel('视口') || { h: 1334 }

for (const row of metrics) {
  if (row.missing) {
    // 只有"该场景本来必在"的项缺失才算问题（三态互斥，见各 stage 的必须有清单）
    const must = MUST()
    if (must.includes(row.sel)) problems.push(`${STAGE} 场景必须有的元素没渲染出来：${row.sel}（判据失效 = 假通过）`)
    continue
  }
  // 溢出只在两种情况下算缺陷：① 元素里有文字（被切/错位）；② 整页横向滚动（单独一行判）。
  // 纯装饰形状的刻意外挑（签筒口沿比筒身宽 2rpx）不算 —— 判据要区分"形状外挑"与"内容被切"。
  const hasText = !!(row.text && String(row.text).trim())
  if (row.overflowX && (hasText || row.mode === 'pageh')) {
    problems.push(`${row.label}：横向溢出（scrollW ${row.scrollW} > clientW ${row.clientW}）`)
  }
  if (row.mode === 'same-row' && !row.sameRow) problems.push(`${row.label}：子元素折行了（本该同一行）`)
  if (row.mode === 'col' && row.noOverlapCol === false) problems.push(`${row.label}：竖排子元素**互相重叠**（真的画到一起了）`)
  if (row.mode === 'lines' && row.maxLines && row.lines > row.maxLines) {
    problems.push(`${row.label}：折成 ${row.lines} 行（上限 ${row.maxLines}）`)
  }
}

// ① 可点区 ≥88rpx（44pt 可用性下限）
for (const t of (byLabel('可点区') || {}).taps || []) {
  if (t.w < 88 || t.h < 88) problems.push(`可点区 ${t.sel}：${t.w}×${t.h}rpx < 88×88rpx（真机容易点不中）`)
}

// ② 本页形态必须在（锁住"四种形态各开一页"）—— 只在会画形态件的两态里要求
if (STAGE === 'entry' || STAGE === 'pending') {
  if (!(byLabel('本页形态') && !byLabel('本页形态').missing)) {
    problems.push(`本页缺自己的形态标记 ${PAGE.form} —— 四种入口形态被抹平了`)
  }
}

// ③ 主 CTA 首屏可见（入口/进行态/缺资料三种"要用户动作"的场景）
if (!isResult) {
  const cta = byLabel('主按钮 .rp-cta') || byLabel('缺资料按钮 .rp-need-cta')
  if (cta && !cta.missing && cta.y > vp.h) {
    problems.push(`主按钮不在首屏内（y=${cta.y} > 视口 ${vp.h}）—— 用户要先滚动才看得到`)
  }
}

// ④ 结果纸面不超视口宽
if (isResult) {
  const paper = byLabel('结果纸面 .rp-paper')
  if (paper && !paper.missing && paper.w > vp.w + 1) {
    problems.push(`结果纸面 ${paper.w}px 超视口 ${vp.w}px`)
  }
}

function MUST () {
  const common = ['.rp-page', '.rp-hero-name', '.rp-foot']
  if (STAGE === 'entry') return common.concat(['.rp-cta', '.rp-hint', PAGE.form])
  if (STAGE === 'pending') return common.concat(['.rp-spin-text', PAGE.form])
  // ⚠️ need 态与"入口/进行态"在 WXML 里是**互斥分支**：缺资料时只画 .rp-need，不画形态件
  if (STAGE === 'need') return common.concat(['.rp-need', '.rp-need-cta'])
  // 结果纸面：四页各有自己的纸面语言，必须按页要求（拆签饼就没有 .rp-paper-title）
  return common.concat(['.rp-paper', PAGE.paper, '.rp-acts', '.rp-act'])
}

/* ── 自检：注入 → 必须检出 → 还原（真源码只读，注入写 .tmp 副本） ─────────── */
if (has('--selftest')) {
  const INJECTS = [
    { name: 'tap-area-tiny', file: 'pageWxss', css: '\n.rp-cta, .rp-act, .rp-need-cta, .rp-archive-toggle { height: 32rpx !important; min-height: 0 !important; padding: 0 !important; }', stage: 'entry' },
    // 判据从"同行"改成"竖排不许重叠"之后，原来那条 display:block 的注入**不再违反**它
    //（两个按钮会正常堆叠）⇒ 注入与判据不同层，自检报"未被检出"。改成真的制造重叠。
    { name: 'acts-overlap', file: 'sharedWxss', css: '\n.rp-acts .rp-act + .rp-act { margin-top: -60rpx !important; }', stage: 'result' },
    { name: 'form-smoothed', file: 'pageWxml', from: PAGE.form.slice(1), to: PAGE.form.slice(1) + '-x', stage: 'entry' },
    { name: 'paper-overflow', file: 'pageWxss', css: '\n.rp-paper { width: 1200rpx !important; max-width: none !important; }', stage: 'result' },
    // 60rpx → 1 行、160rpx → 恰好 2 行（上限就是 2）：两次都没越过判据。
    // 300rpx（9 字 ≈ 2700px / 686px ≈ 4 行）才确实越线 —— 注入的强度必须真的超过阈值。
    { name: 'hint-wraps', file: 'pageWxss', css: '\n.rp-hint { font-size: 300rpx !important; }', stage: 'entry' },
    { name: 'paper-language-smoothed', file: 'pageWxml', from: PAGE.paper.slice(1), to: PAGE.paper.slice(1) + '-x', stage: 'result' }
  ]
  let bad = 0
  for (const inj of INJECTS) {
    const env = { ...process.env }
    if (inj.file === 'pageWxss') {
      const p = join(TMP_DIR, `play-selftest-${inj.name}.wxss`)
      writeFileSync(p, readFileSync(pageWxssPath, 'utf8') + inj.css)
      env.PLAY_PREVIEW_WXSS = p
    } else if (inj.file === 'sharedWxss') {
      const p = join(TMP_DIR, `play-selftest-${inj.name}-shared.wxss`)
      writeFileSync(p, readFileSync(sharedWxssPath, 'utf8') + inj.css)
      env.PLAY_PREVIEW_SHARED = p
    } else {
      const src = readFileSync(pageWxmlPath, 'utf8')
      if (src.indexOf(inj.from) === -1) throw new Error('注入锚点失效：' + inj.name)
      const p = join(TMP_DIR, `play-selftest-${inj.name}.wxml`)
      writeFileSync(p, src.replace(inj.from, inj.to))
      env.PLAY_PREVIEW_WXML = p
    }
    const run = spawn(process.execPath, [fileURLToPath(import.meta.url), '--page', PAGE_KEY, '--stage', inj.stage, '--check'], { env, encoding: 'utf8' })
    const code = await new Promise((r) => run.on('close', r))
    if (code !== 0) console.log(`  ✓ 注入 ${inj.name} 被检出`)
    else { bad += 1; console.error(`  ✗ 注入 ${inj.name} 未被检出（判据不会失败 = 守卫无效）`) }
  }
  const clean = spawn(process.execPath, [fileURLToPath(import.meta.url), '--page', PAGE_KEY, '--stage', STAGE, '--check'], { encoding: 'utf8' })
  const cleanCode = await new Promise((r) => clean.on('close', r))
  if (cleanCode !== 0) { bad += 1; console.error('  ✗ 未注入时本应通过，实际失败') }
  else console.log('  ✓ 未注入时通过（无假阳性）')
  if (bad) { console.error(`\n✗ selftest 失败 ${bad} 项`); process.exit(1) }
  console.log(`\n✓ selftest 通过：${INJECTS.length} 个注入全部被检出，且无假阳性`)
  process.exit(0)
}

/* ── 输出 ──────────────────────────────────────────────────────────────── */
if (has('--check')) {
  if (problems.length) {
    console.error(`✗ ${PAGE.label} · ${STAGE} 版式不变量违反 ${problems.length} 处：`)
    problems.forEach((p) => console.error('  - ' + p))
    process.exit(1)
  }
  console.log(`✓ ${PAGE.label} · ${STAGE} 版式不变量通过（溢出 / 可点区 ≥88rpx / 行数上限 / 动作行同行 / 本页形态 / 首屏 CTA / 纸面宽度）`)
  process.exit(0)
}

const bodyH = (metrics.find((r) => r.sel === '.rp-page') || {}).h || 1334
await runChrome([`--window-size=750,${Math.min(6000, bodyH + 40)}`, `--screenshot=${OUT}`, `file://${shotPath}`])
if (existsSync(OUT)) console.log(`✓ 出图：${OUT}`)
console.log(`✓ ${PAGE.label} · ${STAGE} 版式不变量通过`)
