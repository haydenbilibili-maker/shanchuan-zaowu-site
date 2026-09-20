#!/usr/bin/env node
/**
 * 「藏品库 → 分类管理 → 字段维护专区」版式探针（开发工具；不在 check:admin 里：需要本机 Chrome）
 *
 * 为什么需要它（2026-09-20，产品负责人真机截图逼出来的）：
 * 字段维护专区从超管 Tab 17 并入「分类管理」后，我按 CSS 推理认为布局没问题 ——
 * 真机截图证明**错了**：专区里那行「搜索」抄了竖排表单用的 `cfg-field-full`
 * （`width:100% + flex:none`），放进横排 `.cfg-row`（220rpx 标签 + gap + padding）后
 * 整行的 min-content 宽超出卡片 → 卡片被撑宽 → **整页横向溢出**（左侧文字被切、右侧多一条背景）。
 * 这一页此前**没有任何可量的判据**：静态检查只看"类名在不在"，看不见"宽度够不够"（本仓错题本 E8）。
 * 所以补这个探针：用真 WXSS + 真 WXML 渲染出专区的真实几何，量"有没有横向溢出"。
 *
 * 用法：
 *   node miniprogram/scripts/render-manager-fields.mjs           # 量 + 出图
 *   node miniprogram/scripts/render-manager-fields.mjs --check   # 只判不变量（非 0 = 违反）
 *   node miniprogram/scripts/render-manager-fields.mjs --check --selftest
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const APP_WXSS = resolve(ROOT, 'miniprogram/app.wxss')
const PANEL_WXSS = resolve(ROOT, 'miniprogram/subpackages/manager/manager/index.wxss')
const PANEL_WXML = resolve(ROOT, 'miniprogram/subpackages/manager/manager/workspace/_subviews.wxml')
const TMP_DIR = resolve(ROOT, 'miniprogram/scripts/.tmp')
mkdirSync(TMP_DIR, { recursive: true })

const argv = process.argv.slice(2)
const has = (n) => argv.includes(n)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const OUT = argOf('--out', join(TMP_DIR, 'manager-fields-zone.png'))
const CHECK_ONLY = has('--check')

/** 视口宽 750px ↔ 750rpx：1rpx = 1px，等比于任意真机宽度（与 render-wall-preview 同口径） */
const VIEW_W = 750

/* ── 自检：判据必须能被打红 ──────────────────────────────────────────────
 * 注入只写 `.tmp/` 副本（沿用 render-wall-preview 2026-09-20 的事故教训：
 * 写进真源码再 finally 还原，SIGKILL/超时下会**把注入留在要发版的样式表里**）。
 */
if (has('--selftest')) {
  const INJECTS = [
    {
      // 把越界那行改回 `cfg-field-full`（真机上就是这么错的）
      name: 'search-row-full-width',
      file: 'wxml',
      from: '<text class="cfg-label">搜索</text>\n            <input class="cfg-field"',
      to: '<text class="cfg-label">搜索</text>\n            <input class="cfg-field cfg-field-full"',
      expect: '横向溢出'
    }
  ]
  const baseWxss = readFileSync(PANEL_WXSS, 'utf8')
  const baseWxml = readFileSync(PANEL_WXML, 'utf8')
  let ok = true
  for (const inj of INJECTS) {
    const wxssCopy = join(TMP_DIR, `mgr-selftest-${inj.name}.wxss`)
    const wxmlCopy = join(TMP_DIR, `mgr-selftest-${inj.name}.wxml`)
    try {
      if (!baseWxml.includes(inj.from)) throw new Error(`注入锚点在 WXML 里找不到：${inj.name}`)
      writeFileSync(wxssCopy, baseWxss)
      writeFileSync(wxmlCopy, baseWxml.replace(inj.from, inj.to))
      const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--check'], {
        encoding: 'utf8',
        env: { ...process.env, MGR_PANEL_WXSS: wxssCopy, MGR_PANEL_WXML: wxmlCopy }
      })
      const caught = run.status !== 0 && `${run.stderr}\n${run.stdout}`.includes(inj.expect)
      if (!caught) { ok = false; console.error(`✗ selftest「${inj.name}」没被检出（期望红在「${inj.expect}」）`) }
      else console.log(`  ✓ 注入「${inj.name}」被检出：${inj.expect}`)
    } catch (e) {
      ok = false
      console.error(`✗ selftest「${inj.name}」无法施加：${e.message}`)
    } finally {
      try { rmSync(wxssCopy, { force: true }) } catch (e) { /* ignore */ }
      try { rmSync(wxmlCopy, { force: true }) } catch (e) { /* ignore */ }
    }
  }
  const untouched = readFileSync(PANEL_WXSS, 'utf8') === baseWxss && readFileSync(PANEL_WXML, 'utf8') === baseWxml
  if (!untouched) { console.error('✗ selftest 改动了真源码（注入只许写 .tmp 副本）'); process.exit(1) }
  if (!ok) process.exit(1)
  console.log(`✓ selftest 通过：${INJECTS.length} 处注入被检出；真源码未被改动`)
  process.exit(0)
}

const WXSS_SRC = process.env.MGR_PANEL_WXSS || PANEL_WXSS
const WXML_SRC = process.env.MGR_PANEL_WXML || PANEL_WXML

/* ── 样例数据：只填「藏品库 + 分类管理 + 字段维护专区」真正会读到的字段 ── */
const OPT_TYPES = [
  { value: 'frame', label: '相框' },
  { value: 'cloche', label: '方形玻璃罩' },
  { value: 'cloche_round', label: '圆形玻璃罩' },
  { value: 'cloche_cylinder', label: '圆柱形玻璃罩' },
  { value: 'diorama', label: '造景' },
  { value: 'magnet', label: '冰箱贴' },
  { value: 'accessory', label: '饰品' },
  { value: 'wing_art', label: '蝶翅画' },
  { value: 'other', label: '其它' }
]
const OPT_PROC = [
  { value: 'pressed', label: '压制（腊叶）标本' },
  { value: 'taxidermy', label: '剥制' },
  { value: 'pinned', label: '针插标本' },
  { value: 'dry_bone', label: '干制骨骼标本' },
  { value: 'immersion', label: '浸制' },
  { value: 'other', label: '其它' }
]
const data = {
  curTab: 1,
  productLibTab: 'category',
  artisanEmbed: false,
  canProductFields: true,
  // 分类管理
  categoryManageTree: [
    { _id: 'c1', name: '昆虫馆', enName: 'INSECTA', children: [
      { _id: 'c11', name: '蝴蝶', productCount: 128, latinName: 'LEPIDOPTERA' },
      { _id: 'c12', name: '甲虫', productCount: 64, latinName: 'COLEOPTERA' }
    ] },
    { _id: 'c2', name: '海洋馆', enName: 'MARINE', children: [
      { _id: 'c21', name: '贝类', productCount: 33, latinName: 'MOLLUSCA' }
    ] }
  ],
  catManageRootNames: ['昆虫馆', '海洋馆'],
  newCatLevel: 2,
  newCatParentIndex: 0,
  newCatName: '',
  newCatEn: '',
  // 字段维护专区
  pfLoading: false,
  pfLoaded: true,
  pfKeyword: '',
  pfFilter: 'all',
  pfCounts: { all: 209, missing: 204, type: 85, process: 203 },
  pfMatchedCount: 209,
  pfDirtyCount: 0,
  pfSaving: false,
  pfTypeLabels: OPT_TYPES.map((o) => o.label),
  pfProcessLabels: OPT_PROC.map((o) => o.label),
  // 选项维护（字典本身）：行数取真实规模（装裱 9 / 工艺 11），才能量出"最多的一行会不会撑破卡片"
  taxonomyCloudReady: true,
  taxonomyDirty: true,
  taxonomySaving: false,
  optGroups: [
    { key: 'craftTypes', title: '装裱方式', items: OPT_TYPES.map((o, i) => ({ value: o.value, label: o.label, used: i === 0 ? 128 : 0, canDelete: i !== 0 && o.value !== 'other' })) },
    { key: 'craftProcesses', title: '制作工艺', items: OPT_PROC.map((o, i) => ({ value: o.value, label: o.label, used: i === 4 ? 61 : 0, canDelete: i !== 4 && o.value !== 'other' })) }
  ],
  pfVisible: [
    { _id: 'p1', title: '大蓝闪蝶标本框', image: '', craftType: 'frame', craftProcess: '', craftTypeLabel: '相框', craftProcessLabel: '未标注', typeIndex: 1, processIndex: 0, dirty: false },
    { _id: 'p2', title: '古靴蛱蝶植物标本框', image: '', craftType: 'frame', craftProcess: '', craftTypeLabel: '相框', craftProcessLabel: '未标注', typeIndex: 1, processIndex: 0, dirty: true },
    { _id: 'p3', title: '大蓝闪蝶标本框·圆柱形玻璃罩', image: '', craftType: 'cloche_cylinder', craftProcess: 'other', craftTypeLabel: '圆柱形玻璃罩', craftProcessLabel: '其它', typeIndex: 4, processIndex: 6, dirty: false }
  ]
}

const toCssEarly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(\d*\.?\d+)rpx/g, (_, n) => `${Number(n)}px`)
  .replace(/env\(safe-area-inset-bottom\)/g, '0px')

const appCss = toCssEarly(readFileSync(APP_WXSS, 'utf8'))
const pageVarBlock = (() => {
  const m = /(^|\n)page\s*\{([\s\S]*?)\}/.exec(appCss)
  return m ? m[2] : ''
})()
const vars = [...toCssEarly(pageVarBlock).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
  .map((m) => `  ${m[1]}: ${m[2].trim()};`)
  .join('\n')
const panelCss = toCssEarly(readFileSync(WXSS_SRC, 'utf8').replace(/^page\s*\{[\s\S]*?\}/m, ''))
const globalBits = (appCss.match(/\.signal-light[^{]*\{[^}]*\}/g) || []).join('\n')

const wxmlSrc = readFileSync(WXML_SRC, 'utf8')
// ⚠️ 宽免模式：这块面板有几千行、引用上百个字段，为了量一条行的宽度去补齐全页样例不现实。
// 但缺字段必须**留痕**（宽免 ≠ 静默）：渲染完把缺的表达式打出来，人一眼能看出"是不是少画了东西"。
const missing = []
const markup = renderWxml(wxmlSrc, data, { lenient: true, onMissing: (expr) => missing.push(expr) })
if (missing.length) {
  const uniq = Array.from(new Set(missing))
  console.log(`⚠ 样例数据缺 ${uniq.length} 个字段（宽免渲染，可能少画内容 —— 量宽度够用，看内容不够）：`)
  console.log('  ' + uniq.slice(0, 12).join(' | ') + (uniq.length > 12 ? ' …' : ''))
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root { ${vars} }
html, body { margin: 0; padding: 0; }
body { background: var(--color-bg, #14120F); width: ${VIEW_W}px; }
page, .page-root { display: block; }
img { display: block; object-fit: cover; }
button { border: 0; background: none; padding: 0; font: inherit; color: inherit; }
input, textarea { box-sizing: border-box; }
${globalBits}
${panelCss}
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
  const out = []
  const W = window.innerWidth
  const zone = document.querySelector('.cat-field-zone')
  const inline = document.querySelector('.cat-manage-inline')
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) } }
  out.push({ label: '视口宽', w: W, overflow: 0, text: W + 'px' })
  out.push({ label: '页面文档宽', w: document.documentElement.scrollWidth, overflow: Math.max(0, document.documentElement.scrollWidth - W), text: 'scrollWidth ' + document.documentElement.scrollWidth })
  if (inline) out.push({ label: '分类管理卡', w: rect(inline).w, overflow: Math.max(0, rect(inline).r - W), text: 'left ' + rect(inline).l + ' / right ' + rect(inline).r })
  if (zone) out.push({ label: '字段维护专区', w: rect(zone).w, overflow: Math.max(0, rect(zone).r - W), text: 'right ' + rect(zone).r })
  // 逐个元素找越界者（只报"右边界超出视口"的，且排除自己就是滚动容器的）
  const bad = []
  document.querySelectorAll('.cat-manage-inline *').forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2) return
    if (r.right > W + 1) {
      const cs = getComputedStyle(el)
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return
      bad.push({ cls: String(el.className || el.tagName).slice(0, 46), right: Math.round(r.right), w: Math.round(r.width) })
    }
  })
  out.push({ label: '越界元素数', w: bad.length, overflow: 0, text: bad.slice(0, 6).map((b) => b.cls + '@' + b.right).join(' | ') })
  const pre = document.createElement('pre')
  pre.id = 'mgr-metrics'
  pre.textContent = JSON.stringify(out)
  document.body.appendChild(pre)
})
</script>`

const htmlPath = join(TMP_DIR, 'manager-fields-zone.html')
writeFileSync(htmlPath, html.replace('</body>', `${MEASURE_JS}</body>`))

function runChrome (args, timeoutMs = 30000) {
  return new Promise((resolvePromise) => {
    const profile = mkdtempSync(join(tmpdir(), 'sc-mgr-prev-'))
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

const dom = await runChrome([`--window-size=${VIEW_W},1400`, '--dump-dom', `file://${htmlPath}`])
const m = /<pre id="mgr-metrics">([\s\S]*?)<\/pre>/.exec(dom)
if (!m) { console.error('✗ 没拿到量测结果（Chrome 被拦？）'); process.exit(1) }
const metrics = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))

const problems = []
metrics.forEach((row) => {
  if (row.overflow > 1) problems.push(`${row.label}：横向溢出 ${row.overflow}px（${row.text}）`)
})
const badRow = metrics.find((x) => x.label === '越界元素数')
if (badRow && badRow.w > 0) problems.push(`有 ${badRow.w} 个元素右边界超出视口：${badRow.text}`)

if (!CHECK_ONLY) {
  const png = join(TMP_DIR, 'manager-fields-zone.png')
  try { rmSync(png, { force: true }) } catch (e) { /* ignore */ }
  const bodyH = 1400
  await runChrome([`--window-size=${VIEW_W},${bodyH}`, `--screenshot=${png}`, `file://${htmlPath}`])
  if (existsSync(png)) writeFileSync(OUT, readFileSync(png))
  console.log(`\n截图：${OUT}`)
}

console.log('藏品库 → 分类管理 → 字段维护专区（视口 750px ↔ 750rpx）')
metrics.forEach((r) => console.log(`  · ${String(r.label).padEnd(14)} ${String(r.w).padStart(5)}  ${r.text}`))
if (problems.length) {
  console.error(`\n✗ 版式不变量违反 ${problems.length} 处：`)
  problems.forEach((p) => console.error('  - ' + p))
  process.exit(1)
}
console.log('\n✓ 版式不变量通过（无横向溢出 / 无元素越界；字体度量仍需真机确认）')
