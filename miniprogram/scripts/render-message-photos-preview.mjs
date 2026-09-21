#!/usr/bin/env node
/**
 * 「山海有信」信件「包装实拍」版式离线预览 + 实测（开发工具，**不在 check:admin 里**：需要本机 Chrome）
 *
 * 为什么需要：`check:package-photos` 已经证明「字段落库了、WXML 里有图片元素」，
 * 但它证明不了**画出来是什么样** —— 三列方格会不会溢出信纸、图会不会把落款压住，
 * 这些只有真渲染才看得见（AGENTS.md：静态分析 ≠ 事实；错题本 E8）。
 *
 * 做法与 `render-wall-preview.mjs` 同源：真源码的 WXSS（app.wxss 令牌 + 页面 wxss，
 * rpx 按 1:1 当 px，视口 750px）+ **真解析 detail/index.wxml**，无头 Chrome 出图 + 量几何。
 *
 * 用法：
 *   node miniprogram/scripts/render-message-photos-preview.mjs
 *   node miniprogram/scripts/render-message-photos-preview.mjs --out /tmp/letter.png
 *
 * 输出：`miniprogram/scripts/.tmp/message-photos-preview.png` + stdout 上的量测 JSON。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const require = createRequire(import.meta.url)
const TMP_DIR = resolve(HERE, '.tmp')
mkdirSync(TMP_DIR, { recursive: true })

const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const OUT_PNG = argOf('--out', join(TMP_DIR, 'message-photos-preview.png'))

/**
 * 带「同目录 require」的 CJS 加载器（只处理 `require('./x')`）。
 * `messageHelper.js` 会 `require('./imageUrl')`，纯 `new Function('module','exports')`
 * 会让那条 require 落到 ESM 规则上 → 加载失败。
 */
function loadCjs(rel) {
  const dir = rel.slice(0, rel.lastIndexOf('/'))
  const build = (r) => {
    const mod = { exports: {} }
    const req = (id) => {
      const m = /^\.\/([\w.-]+)$/.exec(String(id || ''))
      if (!m) throw new Error(`预览的 require 桩不认识: ${id}`)
      return build(`${dir}/${m[1]}.js`)
    }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', readFileSync(resolve(ROOT, r), 'utf8'))(mod, mod.exports, req)
    return mod.exports
  }
  return build(rel)
}

/* ── 1. 真源码 ─────────────────────────────────────────────────────────── */
const PAGE_WXML = readFileSync(resolve(ROOT, 'miniprogram/subpackages/extra/user/messages/detail/index.wxml'), 'utf8')
const PAGE_WXSS = readFileSync(resolve(ROOT, 'miniprogram/subpackages/extra/user/messages/detail/index.wxss'), 'utf8')
const APP_WXSS = readFileSync(resolve(ROOT, 'miniprogram/app.wxss'), 'utf8')
const helper = loadCjs('miniprogram/utils/messageHelper.js')

/**
 * rpx → px（视口 750px 时 1rpx = 1px，等比于任何真机）+ 去注释。
 * ⚠️ 顺序不能反：**先去注释再转换**（本仓踩过：正则落在注释里，抠出假规则）；
 * ⚠️ token 也必须先转：把 `--space-4: 32rpx` 原样写进 :root，CSS 不认 rpx → var() 失效
 * → 量出来的宽度全是 750（参考脚本第一版就是这样"假通过"的）。
 */
const toCss = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(\d*\.?\d+)rpx/g, (_, n) => `${Number(n)}px`)
  .replace(/env\(safe-area-inset-bottom\)/g, '0px')

const stripComments = toCss

/** 取 app.wxss 的 `page { … }` 令牌块（`:root` 在 HTML 里等价于页面的 page 选择器） */
function pageVarBlock(css) {
  const m = /(^|\n)\s*page\s*\{([\s\S]*?)\n\}/.exec(css)
  return m ? m[2] : ''
}
const appCss = stripComments(APP_WXSS)
const vars = [...pageVarBlock(appCss).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
  .map((m) => `  ${m[1]}: ${m[2].trim()};`)
  .join('\n')
const pageCss = stripComments(PAGE_WXSS).replace(/^page\s*\{[\s\S]*?\}/m, '')
const globalBits = (appCss.match(/(^|\n)\s*button[^{,]*\{[^}]*\}/g) || []).join('\n')

/* ── 2. 样例数据（结构必须与 index.js 的 data 对齐） ────────────────────── */
/**
 * 样例图片地址用**真实形状**的 cloud fileID，不用 data URI ——
 * 前端 `normalizePackagePhotos` 只收 `cloud://` / `https://`（会丢本机临时路径），
 * 喂 data URI 会被正确地丢掉，预览就变成「一张图都没有」的假象（本次实测踩到）。
 * 出图时这些地址当然加载不出来（环境不存在），但**盒子尺寸与排版是真实的**，
 * 想在截图里看到真图可以传 `--src <https 前缀>` 覆盖。
 */
const CLOUD = (n) => `cloud://cloud1-8gnkty5bfff9f0bf.636c-cloud1-8gnkty5bfff9f0bf-1387508856/ship-pack/preview-${n}.png`
const DOT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const PHOTOS = [1, 2, 3, 4, 5, 6].map((n) => (process.env.MSGPHOTO_HTTP ? DOT : CLOUD(n)))

const withPhotos = helper.enrichMessage({
  _id: 'm-preview',
  type: 'order_shipped',
  category: 'order',
  title: '标本已启程',
  content: '这件标本已启程。经 顺丰速运 运送。\n订单 ORD20260921001\n黑马标本·马上有（大号）\n运单号：SF1234567890\n到柜时请轻取轻放。\n\n开箱与售后\n到柜时请全程录制开箱影像——无开箱影像将难以受理售后。\n\n入柜保养\n入柜后请避直射阳光，注意防潮。',
  products: [
    { id: 'p1', title: '黑马标本·马上有', skuLabel: '大号', image: DOT, count: 1 }
  ],
  photos: PHOTOS,
  actionUrl: 'subpackages/business/order-detail/index?id=o1',
  read: true,
  createTime: new Date('2026-09-21T10:00:00Z')
})

/**
 * 页面级字段：由 index.js 的 data + loadOrderDetail 的 setData 共同产生。
 * `digestView` 是「每日摘要」那封信用的（type=daily_digest），本场景不涉及 ——
 * 但**必须显式给 null**：预览渲染器会求值 `wx:if` 为假的分支里的插值，
 * 缺字段会直接抛错（这是它的既有行为，不是本次改动引入的）。
 */
const pageData = (msg) => ({
  selectedMessage: msg,
  scrollStyle: '',
  entered: true,
  loadError: false,
  digestView: null
})

const SCENES = {
  /** 有包装图：本次新增的区块 */
  photos: pageData(withPhotos),
  /** 没图（= 存量消息）：新增区块**一个元素都不该出现** */
  none: pageData(helper.enrichMessage({ ...withPhotos, photos: [] }))
}
const SCENE = argOf('--scene', 'photos')
if (!SCENES[SCENE]) {
  console.error(`✗ 未知场景 ${SCENE}（可用：${Object.keys(SCENES).join(' / ')}）`)
  process.exit(2)
}

const markup = renderWxml(PAGE_WXML, SCENES[SCENE])

/* ── 3. 量测脚本：真 DOM 几何（含「有没有溢出信纸」） ──────────────────── */
const MEASURE_JS = `
<script>
(() => {
  const out = []
  const rect = (sel) => {
    const e = document.querySelector(sel)
    if (!e) return null
    const r = e.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const imgs = document.querySelectorAll('.photos-item')
  const grid = rect('.photos-grid')
  const card = rect('.letter-card')
  const sign = rect('.letter-sign')
  const photosBox = rect('.letter-photos')
  const rows = new Set()
  imgs.forEach((el) => rows.add(Math.round(el.getBoundingClientRect().top)))
  out.push({
    scene: ${JSON.stringify(SCENE)},
    photoCount: imgs.length,
    gridRows: rows.size,
    grid, card, sign, photosBox,
    // 溢出判据：照片方格必须在信纸卡片内（右边不越界、下边不越界）
    overflowRightPx: grid && card ? Math.max(0, (grid.x + grid.w) - (card.x + card.w)) : 0,
    // 落款必须仍在照片区块**下方**（不许被压住）
    signBelowPhotos: !!(sign && photosBox) && sign.y >= (photosBox.y + photosBox.h - 1),
    signOverlapPx: (sign && photosBox)
      ? Math.max(0, Math.min(sign.y + sign.h, photosBox.y + photosBox.h) - Math.max(sign.y, photosBox.y))
      : 0
  })
  const pre = document.createElement('pre')
  pre.id = 'msg-photos-metrics'
  pre.textContent = JSON.stringify(out)
  document.body.appendChild(pre)
})()
</script>`

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root {
${vars}
}
html, body { margin: 0; padding: 0; }
body { background: #14120F; }
page, .page-root { display: block; }
img { display: block; object-fit: cover; }
${globalBits}
${pageCss}
/* 预览专用：截图与量测都不做动画（否则量到动画中间态） */
* { animation: none !important; transition: none !important; }
</style></head>
<body>${markup}${MEASURE_JS}</body></html>`

const htmlPath = join(TMP_DIR, `message-photos-preview-${SCENE}.html`)
writeFileSync(htmlPath, html)

/* ── 4. 无头 Chrome（与 render-wall-preview 同法：--dump-dom 量 + --screenshot 出图） ── */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean)
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromePath) {
  console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）—— 本工具只做预览，不参与 check:admin')
  process.exit(1)
}

function runChrome(args, timeoutMs = 30000) {
  return new Promise((done) => {
    const profile = mkdtempSync(join(tmpdir(), 'sc-msg-photos-'))
    const child = spawn(chromePath, [
      '--headless=new', '--disable-gpu', '--no-sandbox',
      '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, '--hide-scrollbars',
      '--force-device-scale-factor=1', '--virtual-time-budget=2500',
      ...args
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* ignore */ } }, timeoutMs)
    child.on('close', () => {
      clearTimeout(timer)
      try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
      done(out)
    })
  })
}

const dom = await runChrome(['--window-size=750,1800', '--dump-dom', `file://${htmlPath}`])
const m = /<pre id="msg-photos-metrics">([\s\S]*?)<\/pre>/.exec(dom)
if (!m) {
  console.error('✗ 没拿到量测结果（--dump-dom 里找不到 #msg-photos-metrics）—— Chrome 可能被沙箱拦了')
  process.exit(1)
}
const metrics = JSON.parse(
  m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
)
console.log(JSON.stringify(metrics, null, 2))

await runChrome([`--window-size=750,1800`, `--screenshot=${OUT_PNG}`, `file://${htmlPath}`])
console.log(`\n出图：${OUT_PNG}`)
