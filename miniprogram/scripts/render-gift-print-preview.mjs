#!/usr/bin/env node
/**
 * 礼笺印刷版**真渲染**探针（开发工具；不在 check:admin 里 —— 需要本机 Chrome）
 *
 * 为什么需要它：`check-gift-sticker-layout` 用的是 mock canvas（只记落墨坐标，不出图），
 * 所以它证明得了"版面自洽"，证明不了**"打出来长什么样"**。而这一页的历次问题
 * （正文被截断、字太小、留白太多、水印看不见、码扫不出来）全都是"要看到图才知道"的。
 * 真机打印一轮要等物料、等导出发版；本工具在本地把**同一份绘制代码**跑在真 canvas 上出图，
 * 先过一眼再发版。
 *
 * 四件事：
 *   ① 用真 `paintGiftPrintCard` 在真 canvas（886×886）上画出贴纸版（或 A6）；
 *   ② **真码素材**：把仓库里那两张 PNG 以 data URL 喂进画布 —— 不喂就是"两枚码一个都没画"，
 *      出图会假装很干净（这是本探针第一版的坑）；
 *   ③ **热敏模拟**（Floyd–Steinberg 抖动到 1bit）—— 热敏打印没有灰阶，
 *      小字/细线能不能活下来，只有抖动之后才看得出来；
 *   ④ 量三块：预印印章区（必须**零落墨**）、页脚左区（码 + 小字 + 兜底文案必须在），
 *      以及页脚左区在**热敏模拟**里还剩多少（只在小字档位上才判，码本身是实心块不敏感）。
 *
 * 用法：
 *   node miniprogram/scripts/render-gift-print-preview.mjs                 # 出图（真实 + 热敏 + 页脚放大）
 *   node miniprogram/scripts/render-gift-print-preview.mjs --spec a6
 *   node miniprogram/scripts/render-gift-print-preview.mjs --check         # 只量不出图
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { statSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const CARD = resolve(ROOT, 'miniprogram/utils/giftShareCard.js')
// 与 gift-ops/index.js 里传给导出器的是**同一对素材**（改路径必须一起改）
const QR_MINI = process.env.GIFT_PREVIEW_MINI
  ? resolve(process.env.GIFT_PREVIEW_MINI)
  : resolve(ROOT, 'miniprogram/subpackages/manager/assets/qrcode/miniprogram-code-print.png')
const QR_SERVICE = resolve(ROOT, 'miniprogram/assets/qrcode/wechat-assistant-qr-print.png')
const TMP_DIR = resolve(ROOT, 'miniprogram/scripts/.tmp')
mkdirSync(TMP_DIR, { recursive: true })

const argv = process.argv.slice(2)
const has = (n) => argv.includes(n)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SPEC = argOf('--spec', 'sticker')
const CHECK_ONLY = has('--check')
const OUT = argOf('--out', join(TMP_DIR, `gift-print-${SPEC}.png`))

/* ── 样例：用产品负责人真机那张（冶禹军 / 化羽为约 / 不多说场面话…）── */
const SAMPLE = {
  recipientName: '冶禹军',
  themeName: '化羽为约',
  themeNote: '以羽翼封存誓言，愿相守如蝶般轻盈长久。',
  cardBody: '不多说场面话。祝福你们白首偕老，早生贵子。柜里挑了一件踏实的标本给你——放在手边，像我们之间那些不用说',
  cardSignature: '冶禹军',
  dateText: '2026.09.20'
}

const cardSrc = readFileSync(CARD, 'utf8')
const dataUrl = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64')
for (const [name, p] of [['二维码素材', QR_MINI], ['客服码素材', QR_SERVICE]]) {
  if (!existsSync(p)) { console.error(`✗ 缺${name}：${p}`); process.exit(1) }
}
const QR = { mini: dataUrl(QR_MINI), service: dataUrl(QR_SERVICE) }

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #444; font: 14px/1.5 -apple-system, "PingFang SC", sans-serif; }
  .row { display: flex; gap: 20px; padding: 20px; align-items: flex-start; flex-wrap: wrap; }
  .box { background: #666; padding: 10px; }
  .cap { color: #eee; margin-bottom: 6px; }
  canvas { display: block; image-rendering: pixelated; }
  .full { width: 420px; height: 420px; }
</style></head>
<body>
<div class="row">
  <div class="box"><div class="cap">真实渲染（${SPEC}）</div><canvas id="real" class="full" width="886" height="886"></canvas></div>
  <div class="box"><div class="cap">热敏模拟（Floyd–Steinberg → 1bit）</div><canvas id="thermal" class="full" width="886" height="886"></canvas></div>
  <div class="box"><div class="cap">热敏 · 页脚带放大（码 + 小字 + 兜底文案）</div><canvas id="zoom" width="560" height="256" style="width:560px;height:256px"></canvas></div>
</div>
<script>
const module = { exports: {} }; const exports = module.exports;
const require = (p) => { throw new Error('browser-shim: require(' + p + ')') };
${cardSrc}
const CARD = module.exports
const spec = ${JSON.stringify(SPEC)}
const opts = ${JSON.stringify(Object.assign({ spec: SPEC }, SAMPLE))}

const real = document.getElementById('real')

// ── 热敏模拟：热敏头没有灰阶。RGB → 感知亮度 → Floyd–Steinberg 抖动 → 1bit。
function thermal (src, dst) {
  const w = src.width, h = src.height
  // ⚠️ 目标画布必须**跟源同尺寸**：A6 是 1240×1748，而 HTML 里 #thermal 预置的是 886×886，
  //    不同步的话 putImageData 只写得进左上角一块 → A6 的热敏图下半张全白（假"印不出来"）。
  dst.width = w
  dst.height = h
  const sctx = src.getContext('2d')
  const dctx = dst.getContext('2d')
  const img = sctx.getImageData(0, 0, w, h)
  const d = img.data
  // ⚠️ 先把**纸白归一**到 255：纸是米白（#F2EDE4，感知亮度 ≈236），不归一的话
  //    抖动器会把"纸"也当成 97% 灰 → 整张出图铺满麻点，看起来像"热敏什么都印不清"（假象）。
  const paperLum = 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2] || 255
  const gray = new Float32Array(w * h)
  for (let i = 0; i < w * h; i += 1) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    gray[i] = Math.max(0, Math.min(255, (lum * 255) / paperLum))
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x
      const old = gray[i]
      const nv = old < 128 ? 0 : 255
      const err = old - nv
      gray[i] = nv
      if (x + 1 < w) gray[i + 1] += err * 7 / 16
      if (y + 1 < h) {
        if (x > 0) gray[i + w - 1] += err * 3 / 16
        gray[i + w] += err * 5 / 16
        if (x + 1 < w) gray[i + w + 1] += err * 1 / 16
      }
    }
  }
  const out = dctx.createImageData(w, h)
  for (let i = 0; i < w * h; i += 1) {
    const v = gray[i]
    out.data[i * 4] = v; out.data[i * 4 + 1] = v; out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255
  }
  dctx.putImageData(out, 0, 0)
}

// 量一块区域的墨点数（与纸色差 > 24 算落墨；热敏图则按 < 128 算黑点）
// ⚠️ 区必须**先裁进画布**：越界时 getImageData 返回透明黑（0,0,0,0），会被算成"满区落墨"。
function clipZone (cv, z) {
  const x = Math.max(0, Math.min(cv.width - 1, z.x))
  const y = Math.max(0, Math.min(cv.height - 1, z.y))
  return { x, y, w: Math.max(1, Math.min(z.w, cv.width - x)), h: Math.max(1, Math.min(z.h, cv.height - y)) }
}
function isInk (d, i, paper, thermalMode) {
  if (thermalMode) return d[i] < 128
  const dr = Math.abs(d[i] - paper[0]) + Math.abs(d[i + 1] - paper[1]) + Math.abs(d[i + 2] - paper[2])
  return dr > 24
}
function inkIn (cv, rawZone, thermalMode) {
  const ctx = cv.getContext('2d')
  const paper = ctx.getImageData(4, 4, 1, 1).data
  const zone = clipZone(cv, rawZone)
  const d = ctx.getImageData(zone.x, zone.y, zone.w, zone.h).data
  let n = 0
  for (let i = 0; i < d.length; i += 4) if (isInk(d, i, paper, thermalMode)) n += 1
  return n
}
/**
 * 码的**印刷对比度**：取码框亮度的 **5 分位**当"码线颜色"，与纸白算对比度
 *   ratio = (paper + 5) / (lineLum + 5)
 *
 * 为什么需要它 —— 只看"有多少墨点"分不出好码和糊码：
 *   纯黑码：5 分位 = 0 → ratio ≈ 48；
 *   黄铜色码（#C4A76C）印在米白(#F2EDE4)上：5 分位 ≈ 139 → ratio ≈ **1.7**。
 *   热敏头**没有灰阶**，1.7:1 的中灰只能抖成 50% 散点 —— 亮模块也被点上黑点，
 *   码就成了噪声。这正是产品负责人说的"打印条件让二维码识别很难"的**机器可判形态**，
 *   也是把印刷码改成纯黑（generate-store-qr.js --mono）的判据。
 * （不用"极端像素占比"当判据：那个被纸底占满，黄铜码也能拿 0.87 的假高分。）
 */
function contrastOf (cv, rawZone) {
  const ctx = cv.getContext('2d')
  const paper = ctx.getImageData(4, 4, 1, 1).data
  const paperLum = 0.299 * paper[0] + 0.587 * paper[1] + 0.114 * paper[2]
  const zone = clipZone(cv, rawZone)
  const d = ctx.getImageData(zone.x, zone.y, zone.w, zone.h).data
  const lums = []
  for (let i = 0; i < d.length; i += 4) lums.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
  lums.sort((x, y) => x - y)
  const lineLum = lums[Math.floor(lums.length * 0.05)] || 0
  return { paperLum: Math.round(paperLum), lineLum: Math.round(lineLum), ratio: (paperLum + 5) / (lineLum + 5) }
}

function loadImg (src) {
  return new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = () => rej(new Error('image load failed'))
    im.src = src
  })
}

function finish (report) {
  const pre = document.createElement('pre')
  pre.id = 'gift-print-metrics'
  pre.textContent = JSON.stringify(report)
  document.body.appendChild(pre)
}

window.addEventListener('load', async () => {
  const report = { spec, ok: true, errors: [] }
  try {
  try {
    opts.qrcodeImage = await loadImg(${JSON.stringify(QR.mini)})
    opts.serviceQrImage = await loadImg(${JSON.stringify(QR.service)})
  } catch (e) {
    report.ok = false
    report.errors.push('码素材没加载进画布：' + e.message)
  }
  // 真 painter 跑在真 canvas 上（贴纸 → paintGiftStickerCard；A6 → 原 A6 分支）
  CARD.paintGiftPrintCard(real, opts)

  const thermalCv = document.getElementById('thermal')
  thermal(real, thermalCv)

  const W = real.width, H = real.height
  // ── 量测区：**按规格各算一套**（A6 与贴纸的版式本来就不同，
  //    第一版把贴纸的 60mm/24mm 直接套到 A6 上 → 量到的是别的地方，五条判据全假红）
  // ⚠️ MM 必须在这里定义：上一次重写量测区时把它一起删了，于是整块量测抛 ReferenceError，
  //    又被外层 catch 吞成"报告只有 spec/ok/errors" —— 出图照出，数字全 undefined。
  //    （本注释在模板字符串里，**不许写反引号** —— 错题本：模板串里的反引号会直接截断模板）
  const MM = 11.811
  const zones = {}
  if (spec === 'a6') {
    // A6 从设计稿画（S = PRINT_W / designW = 1），坐标与 painter 逐项同源
    const pad = Math.round(14 * MM)
    const margin = Math.round(10 * MM)
    const cardH = H - margin * 2
    const cardX = margin
    const cardW = W - margin * 2
    const footerTop = margin + cardH - Math.round(30 * MM)
    const qRight = cardX + cardW - Math.round(4 * MM)
    const qSize = Math.round(15 * MM)
    const qGap = Math.round(6 * MM)
    const qTop = footerTop + Math.round(2 * MM)
    // 码从右往左排：第一枚（小程序码）在最右
    zones.mini = { x: qRight - qSize, y: qTop, w: qSize, h: qSize }
    zones.svc = { x: qRight - qSize * 2 - qGap, y: qTop, w: qSize, h: qSize }
    // A6 没有预印印章 → 不量印章区（判据里也要跳过）
    zones.stamp = null
    const axisX = cardX + pad
    zones.foot = { x: axisX, y: footerTop, w: cardW - pad * 2, h: Math.round(30 * MM) }
    // 兜底文案基线 = footerTop + 2mm(码顶) + 15mm(码) + 6mm(码下小字) + 2.2mm(偏移) ≈ +25.2mm
    //   → 区从 +21mm 起、高 7mm，才把整行**圈进去**（第一版从 +26mm 起，量到的只有降部）
    zones.hint = { x: axisX, y: footerTop + Math.round(21 * MM), w: cardW - pad * 2, h: Math.round(7 * MM) }
    // 直接算，不用块内函数声明（sloppy 模式下的块级函数提升是坑，不值得赌）

  } else {
    // 贴纸：几何**逐项照抄 painter 的算式**（不是"差不多"：
    // 第一版自己另算了一遍 qrRight，偏了 18px，量到的是隔壁）
    const cardX = Math.round(1.5 * MM)
    const cardW = W - cardX * 2
    const stampLeft = cardX + cardW - Math.round(1.5 * MM) - Math.round(24 * MM)
    const axisX = cardX + Math.round(1.8 * MM)
    const qrRight = Math.min(stampLeft - Math.round(2 * MM), cardX + cardW - Math.round(1.8 * MM))
    const qSize = Math.round(13 * MM)
    const qGap = Math.round(5 * MM)
    const qTop = Math.round(60 * MM) - Math.round(3 * MM)
    const qZone = qrRight - axisX
    const qTotal = qSize * 2 + qGap
    const q0 = Math.max(axisX, axisX + Math.round((qZone - qTotal) / 2))
    zones.mini = { x: q0, y: qTop, w: qSize, h: qSize }
    zones.svc = { x: q0 + qSize + qGap, y: qTop, w: qSize, h: qSize }
    zones.stamp = clipZone(real, { x: Math.round(W - 1.5 * MM - 24 * MM), y: Math.round(60 * MM + 1.5 * MM), w: Math.round(24 * MM), h: Math.round(24 * MM) })
    zones.foot = clipZone(real, { x: axisX, y: Math.round(55 * MM), w: Math.round(45 * MM), h: Math.round(30 * MM) })
    zones.hint = clipZone(real, { x: axisX, y: Math.round(72.6 * MM), w: Math.round(45 * MM), h: Math.round(3.4 * MM) })
  }
  report.zones = zones
  report.stampInk = zones.stamp ? inkIn(real, zones.stamp, false) : null
  report.stampInkThermal = zones.stamp ? inkIn(thermalCv, zones.stamp, true) : null
  report.footInk = inkIn(real, zones.foot, false)
  report.footInkThermal = inkIn(thermalCv, zones.foot, true)
  report.hintInk = inkIn(real, zones.hint, false)
  report.hintInkThermal = inkIn(thermalCv, zones.hint, true)
  report.miniContrast = contrastOf(real, zones.mini)
  report.svcContrast = contrastOf(real, zones.svc)

  // 放大页脚带（热敏图）—— 给肉眼看的，判据不看它
  const zoom = document.getElementById('zoom')
  const zctx = zoom.getContext('2d')
  zctx.imageSmoothingEnabled = false
  if (spec === 'sticker') {
    // 裁「页脚带左半区」（码 + 小字 + 兜底文案），1:1 放大给肉眼判读
    zctx.drawImage(thermalCv, Math.round(1.2 * MM), Math.round(54 * MM), 560, 256, 0, 0, 560, 256)
  } else {
    // A6 的坐标不是 886 系 → 直接缩整张（放大面板是给肉眼的，判据不看它）
    zctx.drawImage(thermalCv, 0, 0, thermalCv.width, thermalCv.height, 0, 0, 560, 256)
  }

  } catch (e) {
    // ⚠️ 量测/绘制抛错也必须**把错误交出去**：第一版在外面裸跑，
    //    一抛错就只是"没拿到量测结果"，看不出是 painter 还是探针自己炸的。
    report.ok = false
    report.errors.push('探针执行失败：' + (e && (e.stack || e.message) || e))
  }
  finish(report)
})
</script>
</body></html>`

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean).find((p) => existsSync(p))
if (!CHROME) { console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）'); process.exit(1) }

const htmlPath = join(TMP_DIR, `gift-print-${SPEC}.html`)
writeFileSync(htmlPath, html)

function runChrome (args, timeoutMs = 60000) {
  return new Promise((resolvePromise) => {
    const profile = mkdtempSync(join(tmpdir(), 'sc-gift-print-'))
    const child = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1',
      '--virtual-time-budget=8000', ...args
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

const dom = await runChrome(['--window-size=1400,1100', '--dump-dom', `file://${htmlPath}`])
// ⚠️ 页面里**只有一个** id=gift-print-metrics 的 pre（第一版在模板里预置了一个空壳，
//    正则抓到空壳 → JSON.parse('') 报 "Unexpected end of JSON input"）。
const m = /<pre id="gift-print-metrics">([\s\S]*?)<\/pre>/.exec(dom)
if (!m || !m[1].trim()) {
  console.error('✗ 没拿到量测结果（Chrome 被拦 / 页面抛错 / 素材没加载？）')
  console.error(dom.slice(-1200))
  process.exit(1)
}
const report = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))

if (!CHECK_ONLY) {
  const png = join(TMP_DIR, `gift-print-${SPEC}-shot.png`)
  try { rmSync(png, { force: true }) } catch (e) { /* ignore */ }
  await runChrome(['--window-size=1400,1100', `--screenshot=${png}`, `file://${htmlPath}`])
  if (existsSync(png)) {
    writeFileSync(OUT, readFileSync(png))
    console.log(`\n出图：${OUT}（${Math.round(statSync(OUT).size / 1024)}KB）`)
  } else console.error('✗ 截图未生成')
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) + '%' : 'n/a')
if (!report.zones || report.miniContrast === undefined) {
  console.error('✗ 页面里的量测没跑完（报告缺键）—— 页面内的异常：')
  ;(report.errors || []).forEach((e) => console.error('  - ' + e))
  process.exit(1)
}
console.log(`礼笺印刷预览（spec=${SPEC}）`)
console.log(report.stampInk === null
  ? '  · 预印印章区：A6 无预印印章 → 不适用'
  : `  · 预印印章区 落墨：真实 ${report.stampInk} / 热敏 ${report.stampInkThermal}（必须都是 0）`)
console.log(`  · 页脚带（码+小字+兜底）落墨：真实 ${report.footInk} / 热敏 ${report.footInkThermal}（存活 ${pct(report.footInkThermal, report.footInk)}）`)
console.log(`  · 兜底文案那一行落墨：真实 ${report.hintInk} / 热敏 ${report.hintInkThermal}（存活 ${pct(report.hintInkThermal, report.hintInk)}）`)
const ct = (c) => `${c.ratio.toFixed(2)}:1（纸 ${c.paperLum} / 码线 ${c.lineLum}）`
console.log(`  · 小程序码印刷对比度：${ct(report.miniContrast)} —— 低于 4:1 就是"一坨中灰"，热敏只能抖成噪声`)
console.log(`  · 客服码印刷对比度：  ${ct(report.svcContrast)}`)

const problems = []
if (report.errors && report.errors.length) problems.push(...report.errors)
// ① 预印印章区必须零落墨（印章是**实物预印**的，再印就是叠字；A6 无印章，跳过）
if (report.stampInk > 0) problems.push(`预印印章区有 ${report.stampInk} 个墨点 —— 内容压到印章上了`)
// ② 两枚码必须在（码是深色实心块，落墨量本该很大）
{
  if (report.footInk < 20000) problems.push(`页脚带只有 ${report.footInk} 个墨点（下限 ${floor}）—— 两枚码没画上？（素材没加载 / drawImage 被跳）`)
}
// ③ 兜底文案必须真的印出来（它只有 1.78mm 高，最容易"写了但看不见"）
if (report.hintInk < 400) problems.push(`兜底文案那一行只有 ${report.hintInk} 个墨点 —— 文案没画上或淡到看不见`)
// ④ 码必须是**黑白分明**的（"一坨中灰"= 热敏只能抖成噪声 = 扫不出来）。
//    实测：黄铜色小程序码 1.68:1，纯黑 48:1，客服码 48:1 → 取 4:1 作分界，两边都很远。
const CONTRAST_FLOOR = 4
for (const [name, c] of [['小程序码', report.miniContrast], ['客服码', report.svcContrast]]) {
  if (c.ratio < CONTRAST_FLOOR) {
    problems.push(`${name}印刷对比度只有 ${c.ratio.toFixed(2)}:1（下限 ${CONTRAST_FLOOR}:1，码线亮度 ${c.lineLum}）—— 印出来是一坨中灰，热敏只能抖成噪声（印刷码必须用 --mono 生成纯黑码）`)
  }
}
if (report.hintInk >= 400 && report.hintInkThermal < report.hintInk * 0.25) {
  problems.push(`兜底文案热敏后只剩 ${report.hintInkThermal} / ${report.hintInk} 墨点 —— 抖动把 1.78mm 的小字糊掉了`)
}
if (problems.length) {
  console.error(`\n✗ 印刷预览判据 ${problems.length} 处：`)
  problems.forEach((p) => console.error('  - ' + p))
  process.exit(1)
}
console.log('\n✓ 印章区零落墨；两枚码在；兜底文案印得出来且热敏没把它抖没')
