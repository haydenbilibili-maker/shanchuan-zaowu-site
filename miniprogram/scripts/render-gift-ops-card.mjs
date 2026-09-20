#!/usr/bin/env node
/**
 * 「礼赠履约」卡片**主操作行**版式探针（开发工具；不在 check:admin 里：需要本机 Chrome）
 *
 * 为什么需要它（2026-09-20 产品负责人真机截图逼出来的）：
 *   卡片里 4 个按钮（去发货 / 复制单号 / 导出礼笺图 / 导出贴纸图）被折成了**两行**。
 *   根因不是"宽度差一点"，而是两个导出按钮各挂了一行尺寸副标题（A6 尺寸 / 贴纸尺寸）
 *   → 4 个按钮的宽高都不一样，`.action-row` 的 `flex-wrap: wrap` 必然把第 4 个挤下去。
 *
 *   静态判据（`check-gift-export-flow` 里那几条）只能证明"样式表里写的是 nowrap + flex:1"，
 *   **证明不了"真画出来是一排"** —— 本仓错题本 E8：静态分析 ≠ 事实。
 *   所以补这个探针：真 WXSS + 真 WXML 渲染出卡片，量每个按钮的 `offsetTop` / 宽 / 右边界。
 *
 * 用法：
 *   node miniprogram/scripts/render-gift-ops-card.mjs            # 量 + 出图
 *   node miniprogram/scripts/render-gift-ops-card.mjs --check    # 只判不变量
 *   node miniprogram/scripts/render-gift-ops-card.mjs --selftest # 注入回归，证明判据会红
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const APP_WXSS = resolve(ROOT, 'miniprogram/app.wxss')
const PAGE_BASE = resolve(ROOT, 'miniprogram/subpackages/manager/gift-ops/index')
const TMP_DIR = resolve(ROOT, 'miniprogram/scripts/.tmp')
mkdirSync(TMP_DIR, { recursive: true })

const argv = process.argv.slice(2)
const has = (n) => argv.includes(n)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const OUT = argOf('--out', join(TMP_DIR, 'gift-ops-card.png'))
const CHECK_ONLY = has('--check')

/** 视口宽 750px ↔ 750rpx：1rpx = 1px（与 render-wall-preview / render-manager-fields 同口径） */
const VIEW_W = 750

/* ── 自检：判据必须能被打红。注入只写 `.tmp/` 副本（真源码一个字都不碰 —— 事故教训见 render-wall-preview） ── */
if (has('--selftest')) {
  const INJECTS = [
    {
      // 让按钮"缩不下去"（或宽度失控）：真机上就是又折行/又溢出 ——
      // ⚠️ 只把 `flex-wrap` 改成 wrap **抓不到**（按钮等宽且 min-width:0 时，4 个仍然排得下，
      //    版面确实还是一排）—— 所以注入必须打在"宽度"上，那不是假绿，是判据本来就该只认几何结果。
      name: 'action-btn-minwidth',
      from: '  flex: 1 1 0;\n  min-width: 0;\n',
      to: '  flex: 1 1 0;\n  min-width: 220px;\n',
      expect: '溢出'
    },
    {
      name: 'action-btn-not-equal',
      from: '  flex: 1 1 0;\n  min-width: 0;\n',
      to: '  flex: 0 1 auto;\n',
      // 这一条的失败形态是"按钮不等宽"（各自按 min-content 宽排），不一定是折行 —— 判据两条都认
      expect: '不等宽'
    }
  ]
  const base = readFileSync(PAGE_BASE + '.wxss', 'utf8')
  let ok = true
  for (const inj of INJECTS) {
    if (!base.includes(inj.from)) { console.error(`✗ 注入锚点不存在：${inj.name}`); ok = false; continue }
    const copy = join(TMP_DIR, `gift-ops-selftest-${inj.name}.wxss`)
    writeFileSync(copy, base.replace(inj.from, inj.to))
    const r = spawn(process.execPath, [fileURLToPath(import.meta.url), '--check'], {
      env: Object.assign({}, process.env, { GIFT_OPS_WXSS: copy }),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    r.stdout.on('data', (d) => { out += d.toString() })
    r.stderr.on('data', (d) => { out += d.toString() })
    // eslint-disable-next-line no-await-in-loop
    const code = await new Promise((res) => r.on('close', res))
    const detected = code !== 0 && out.includes(inj.expect)
    if (detected) console.log(`  ✓ 已检出：${inj.name}（${inj.expect}）`)
    else { console.error(`  ✗ 漏检：${inj.name}\n${out.split('\n').slice(-8).join('\n')}`); ok = false }
    try { rmSync(copy, { force: true }) } catch (e) { /* ignore */ }
    if (readFileSync(PAGE_BASE + '.wxss', 'utf8') !== base) { console.error('✗ 真源码被改动！'); process.exit(2) }
  }
  if (!ok) { console.error('\n✗ 自检失败：判据抓不到回归'); process.exit(1) }
  console.log('\n✓ 自检通过：注入全部被检出，真源码逐字未变')
  process.exit(0)
}

const WXSS_SRC = process.env.GIFT_OPS_WXSS || (PAGE_BASE + '.wxss')
const WXML_SRC = PAGE_BASE + '.wxml'
const PAGE_JSON = JSON.parse(readFileSync(PAGE_BASE + '.json', 'utf8'))

/* ── 样例：照产品负责人截图那两张卡（一张待填址、一张玻璃罩） ── */
const CARD = {
  orderId: 'ord1',
  orderNo: 'ORDMU5HRWP4829',
  productTitle: '天堂凤蝶爱神凤蝶组合',
  recipientName: '虞博阳&王琰',
  storeName: '',
  totalPrice: '549',
  paidText: '09-17 12:14',
  deliveryLabel: '待填址',
  deliveryTone: 'tone-warn',
  urgencyLabel: '剩 5 日',
  urgencyClass: '',
  expireText: '09-25',
  canShip: true,
  shipBlockReason: '',
  claimCode: '',
  address: null
}
const data = {
  ready: true,
  loading: false,
  loadError: '',
  hasMore: false,
  total: 2,
  keyword: '',
  note: '',
  bucket: 'awaiting_address',
  expandedId: '',
  exporting: false,
  buckets: [
    { key: 'awaiting_address', label: '待填址' }, { key: 'to_ship', label: '待发货' },
    { key: 'shipping', label: '配送中' }, { key: 'done', label: '已完成' }
  ],
  counts: { awaiting_address: 2, to_ship: 0, shipping: 0, done: 7 },
  list: [CARD],
  displayList: [CARD],
  recentPrints: [],
  printPreview: null,
  toast: null
}

const toCss = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(\d*\.?\d+)rpx/g, (_, n) => `${Number(n)}px`)
  .replace(/env\(safe-area-inset-bottom\)/g, '0px')

const appCss = toCss(readFileSync(APP_WXSS, 'utf8'))
const pageVarBlock = (() => {
  const m = /(^|\n)page\s*\{([\s\S]*?)\}/.exec(appCss)
  return m ? m[2] : ''
})()
const vars = [...pageVarBlock.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
  .map((m) => `  ${m[1]}: ${m[2].trim()};`)
  .join('\n')
const pageCss = toCss(readFileSync(WXSS_SRC, 'utf8').replace(/^page\s*\{[\s\S]*?\}/m, ''))

const missing = []
const markup = renderWxml(readFileSync(WXML_SRC, 'utf8'), data, { lenient: true, onMissing: (e) => missing.push(e) })
if (missing.length) {
  const uniq = Array.from(new Set(missing))
  console.log(`⚠ 样例数据缺 ${uniq.length} 个字段（宽免渲染）：${uniq.slice(0, 10).join(' | ')}${uniq.length > 10 ? ' …' : ''}`)
}
if (!/class="action-row"/.test(markup)) {
  console.error('✗ 渲染结果里没有 .action-row —— 样例数据没让卡片进入主操作行分支，量什么都无意义')
  process.exit(1)
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root { ${vars} }
html, body { margin: 0; padding: 0; }
body { background: var(--color-bg, #14120F); width: ${VIEW_W}px; }
page { display: block; }
button { border: 0; background: none; padding: 0; font: inherit; color: inherit; }
input { box-sizing: border-box; background: transparent; }
${pageCss}
* { animation: none !important; transition: none !important; }
</style></head>
<body>${markup}</body></html>`

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean).find((p) => existsSync(p))
if (!CHROME) { console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）'); process.exit(1) }

const MEASURE_JS = `
<script>
window.addEventListener('load', () => {
  const W = window.innerWidth
  const rows = Array.from(document.querySelectorAll('.action-row'))
  const out = []
  rows.forEach((row, ri) => {
    const rb = row.getBoundingClientRect()
    const btns = Array.from(row.querySelectorAll('.mini-btn')).map((b) => {
      const r = b.getBoundingClientRect()
      return { t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width), r: Math.round(r.right), txt: (b.textContent || '').trim().slice(0, 8) }
    })
    out.push({ row: ri, rowH: Math.round(rb.height), right: Math.round(rb.right), btns })
  })
  const hint = document.querySelector('.action-hint')
  const pre = document.createElement('pre')
  pre.id = 'gift-ops-metrics'
  pre.textContent = JSON.stringify({
    viewW: W,
    docW: document.documentElement.scrollWidth,
    rows: out,   // ⚠️ 必须是量好的 out，不是 DOM 的 rows（后者 JSON 化后是 [{}]，量什么都读不到）
    hint: hint ? { text: (hint.textContent || '').trim(), h: Math.round(hint.getBoundingClientRect().height), bottom: Math.round(hint.getBoundingClientRect().bottom) } : null
  })
  document.body.appendChild(pre)
})
</script>`

const htmlPath = join(TMP_DIR, 'gift-ops-card.html')
writeFileSync(htmlPath, html.replace('</body>', `${MEASURE_JS}</body>`))

function runChrome (args, timeoutMs = 30000) {
  return new Promise((resolvePromise) => {
    const profile = mkdtempSync(join(tmpdir(), 'sc-giftops-'))
    const child = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1',
      '--virtual-time-budget=2000', ...args
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch (e) { /* ignore */ } }, timeoutMs)
    child.on('close', () => {
      clearTimeout(timer)
      try { rmSync(profile, { recursive: true, force: true }) } catch (e) { /* ignore */ }
      resolvePromise(out)
    })
  })
}

const dom = await runChrome([`--window-size=${VIEW_W},1600`, '--dump-dom', `file://${htmlPath}`])
const m = /<pre id="gift-ops-metrics">([\s\S]*?)<\/pre>/.exec(dom)
if (!m) { console.error('✗ 没拿到量测结果（Chrome 被拦 / 页面抛错？）'); process.exit(1) }
const metrics = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))

const problems = []
console.log(`礼赠履约卡片主操作行（视口 ${metrics.viewW}px ↔ 750rpx）`)
if (metrics.rows.length === 0) problems.push('没渲染出 .action-row')
metrics.rows.forEach((row) => {
  const tops = row.btns.map((b) => b.t)
  const uniqTops = Array.from(new Set(tops))
  const widths = row.btns.map((b) => b.w)
  const minW = Math.min.apply(null, widths)
  const maxW = Math.max.apply(null, widths)
  console.log(`  · 第 ${row.row + 1} 行：${row.btns.length} 个按钮 [${row.btns.map((b) => b.txt + '#' + b.w).join(' | ')}]`)
  if (uniqTops.length !== 1) {
    problems.push(`第 ${row.row + 1} 行折成 ${uniqTops.length} 行（按钮 top = ${tops.join('/')}）`)
  }
  // 等宽：同一行里最宽与最窄差 > 2px 就是"没平分"（真机上是 12rpx 的 gap 摊不掉的表现）
  if (row.btns.length > 1 && maxW - minW > 2) {
    problems.push(`第 ${row.row + 1} 行按钮不等宽（${minW}~${maxW}px，差 ${maxW - minW}px）`)
  }
  if (row.right > metrics.viewW + 1) problems.push(`第 ${row.row + 1} 行右边界越出视口（${row.right} > ${metrics.viewW}）`)
})
if (metrics.docW > metrics.viewW + 1) problems.push(`页面横向溢出：scrollWidth ${metrics.docW} > ${metrics.viewW}`)
if (!metrics.hint) problems.push('没有 .action-hint（规格说明丢了，运营没法核对导出的是哪一版）')
// 提示必须**一行**：20rpx × 1.4 行高 ≈ 28px，折行就是 56px（真机上是"断在词中间"的观感）
else if (metrics.hint.h > 34) problems.push(`规格说明折成了多行（高 ${metrics.hint.h}px > 34px）：${metrics.hint.text}`)

if (!CHECK_ONLY) {
  const png = join(TMP_DIR, 'gift-ops-card.png')
  try { rmSync(png, { force: true }) } catch (e) { /* ignore */ }
  await runChrome([`--window-size=${VIEW_W},1600`, `--screenshot=${png}`, `file://${htmlPath}`])
  if (existsSync(png)) { writeFileSync(OUT, readFileSync(png)); console.log(`\n截图：${OUT}`) }
}

if (problems.length) {
  console.error(`\n✗ 版式不变量违反 ${problems.length} 处：`)
  problems.forEach((p) => console.error('  - ' + p))
  process.exit(1)
}
console.log('\n✓ 主操作行是一排、按钮等宽、不越界；规格说明在行下（真机字体度量仍需实机确认）')
