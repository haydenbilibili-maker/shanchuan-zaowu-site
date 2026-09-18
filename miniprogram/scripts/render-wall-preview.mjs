#!/usr/bin/env node
/**
 * 祈福墙「版式离线预览 + 实测」（开发工具，**不在 check:admin 里**：需要本机 Chrome）
 *
 * 为什么需要它：这一页的版式问题从来不是"样式规则写错了"，而是"画出来挤/断/溢出"——
 * 静态检查证明不了。本仓为此吃过多次亏（AGENTS.md：静态分析 ≠ 事实），而真机截图要等人给。
 * 本工具用**真源码的 WXSS**（app.wxss 的 token + 页面 wxss，rpx 按 1:1 当 px）渲染一份 HTML，
 * 用无头 Chrome 量出**真实 DOM 的几何与换行**，并截图给人看。
 *
 * rpx 的等比性质：1rpx = 屏宽/750 px，所以「视口 750px、1rpx=1px」与任何真机等比 ——
 * 宽度、换行、间距都能据此判断；但**字体度量、安全区、真机字体替换**无法等价，
 * 所以本工具的输出是"改版式前的第一道网"，**不能替代真机验收**。
 *
 * 用法：
 *   node miniprogram/scripts/render-wall-preview.mjs                 # 量 + 截图
 *   node miniprogram/scripts/render-wall-preview.mjs --check         # 只跑版式不变量（非 0 = 违反）
 *   node miniprogram/scripts/render-wall-preview.mjs --out /tmp/x.png
 *
 * 场景（--scene）：full（默认，首屏各块） / plays（只渲染玩法区，放大看细节）
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const APP_WXSS = resolve(ROOT, 'miniprogram/app.wxss')
const PAGE_WXSS = resolve(ROOT, 'miniprogram/subpackages/feature/wish-wall/index.wxss')

const argv = process.argv.slice(2)
const has = (n) => argv.includes(n)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SCENE = argOf('--scene', 'full')
const OUT = argOf('--out', join(ROOT, 'miniprogram/scripts/.tmp', `wall-preview-${SCENE}.png`))
const CHECK_ONLY = has('--check')

/* ── 1. 真源码的样式 ────────────────────────────────────────────────────── */
const toCssEarly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(\d*\.?\d+)rpx/g, (_, n) => `${Number(n)}px`)
  .replace(/env\(safe-area-inset-bottom\)/g, '0px')

// ⚠️ 必须**先去注释再做任何提取**：否则按 `.signal-light` 抠出来的片段会把注释开头带进来
// （`/* .signal-light 或 .lamp\n * Token…\n */`），CSS 从那里开始崩，后面的规则整条失效 ——
// 第一版就是这样让 `.ww-page` 的左右内边距失效、卡片量出来全是 750 宽（看着"通过"，其实是废的）。
const appCss = toCssEarly(readFileSync(APP_WXSS, 'utf8'))
const pageVarBlock = (() => {
  const m = /(^|\n)page\s*\{([\s\S]*?)\}/.exec(appCss)
  return m ? m[2] : ''
})()
// ⚠️ token 必须**先做 rpx→px** 再输出：第一版把 `--space-4: 32rpx` 原样写进 :root，
// CSS 不认识 rpx → var() 失效 → `.ww-page` 的左右内边距整条丢掉，量出来的卡片宽度全是 750（假通过）。
const vars = [...toCssEarly(pageVarBlock).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
  .map((m) => `  ${m[1]}: ${m[2].trim()};`)
  .join('\n')

// 页面 wxss 里除了 page{} 之外的规则（含 @keyframes）
const pageCss = toCssEarly(readFileSync(PAGE_WXSS, 'utf8').replace(/^page\s*\{[\s\S]*?\}/m, ''))
// signal-light 等全局小件：从**已去注释**的 app.wxss 里挑（这时正则不会落在注释里）
const globalBits = (appCss.match(/\.signal-light[^{]*\{[^}]*\}/g) || []).join('\n')
// 页面 wxss 里的 `page { … }` 也要保留（背景色等）；已由 appCss 提供背景，这里不重复

/* ── 2. 结构：按真实 WXML 的类名与文案镜像（@see index.wxml） ─────────────── */
const PLAYS = [
  { mark: '签', name: '今日一签', hint: '摇一支，看今天宜做什么' },
  { mark: '饼', name: '拆签饼', hint: '拆开今天的签饼' },
  { mark: '座', name: '星座签', hint: '按你的星座给一句' },
  { mark: '我', name: 'MBTI 贴士', hint: '顺着你的性子来一句' }
]

const head = `
<view class="ww-page">
  <view class="ww-hero">
    <view class="ww-hero-body">
      <view class="ww-hero-top"><text class="ww-over">WISH WALL · 马上有愿</text></view>
      <text class="ww-brand">山海造物</text>
      <text class="ww-title">祈福墙</text>
      <view class="ww-scope-row"><text class="ww-scope">孔雀标本</text><text class="ww-bless">偏「求成」</text></view>
      <text class="ww-hint">把想成真的心愿挂上墙。轻一点写，短一点说。</text>
    </view>
  </view>
  <view class="ww-wall is-echo">
    <view class="ww-wall-inner">
      <view class="ww-wall-rail rail-1"></view><view class="ww-wall-rail rail-2"></view>
      <view class="ww-wall-rail rail-3"></view><view class="ww-wall-rail rail-4"></view>
      <view class="ww-wall-rail rail-5"></view><view class="ww-wall-rail rail-6"></view>
      <view class="ww-danmaku ww-tone-0" style="top:8%; left:62%; animation:none"><text class="ww-dm-text">马上有人念</text></view>
      <view class="ww-danmaku ww-tone-1" style="top:23.2%; left:74%; animation:none"><text class="ww-dm-text">马上有好事</text></view>
      <view class="ww-danmaku ww-tone-2" style="top:38.4%; left:56%; animation:none"><text class="ww-dm-text">马上有归处</text></view>
      <view class="ww-danmaku ww-tone-3" style="top:53.6%; left:68%; animation:none"><text class="ww-dm-text">马上有花看</text></view>
      <view class="ww-danmaku ww-tone-4" style="top:68.8%; left:60%; animation:none"><text class="ww-dm-text">马上有信</text></view>
      <view class="ww-danmaku ww-tone-5" style="top:84%; left:72%; animation:none"><text class="ww-dm-text">马上有下一程</text></view>
    </view>
    <view class="ww-wall-foot">
      <view class="signal-light lamp-brass"></view>
      <text class="ww-wall-foot-text">26 条心愿正在墙上流动</text>
      <text class="ww-wall-foot-more">看全部 ›</text>
    </view>
    <view class="ww-echo">
      <view class="signal-light lamp-brass"></view>
      <text class="ww-echo-text">我敲了一下木鱼</text>
      <text class="ww-echo-sub">功德 19</text>
    </view>
  </view>
  <view class="ww-ritual-row">
    <view class="ww-lantern is-lit">
      <view class="ww-lantern-box"><view class="ww-lantern-core"></view></view>
      <view class="ww-lantern-copy">
        <text class="ww-lantern-title">今日灯已点</text>
        <view class="ww-lantern-meta">
          <text class="ww-lantern-tier">初见</text>
          <text class="ww-lantern-next">距秋分 5 天</text>
        </view>
      </view>
      <view class="ww-lantern-tail">
        <text class="ww-lantern-line">灯亮着，心愿就还没说完。</text>
        <text class="ww-lantern-note">今天来过，记下了。</text>
      </view>
    </view>
    <view class="ww-ritual-card">
      <view class="ww-muyu"></view>
      <view class="ww-muyu-copy">
        <text class="ww-muyu-title">安心木鱼</text>
        <text class="ww-muyu-line">敲一下，静一分</text>
        <text class="ww-muyu-count">功德 19</text>
      </view>
      <text class="ww-muyu-plus">+1</text>
    </view>
  </view>
  <view class="ww-foot-row">
    <text class="ww-foot-note">点一盏灯、敲一下木鱼，心愿挂上墙就会一直流动。</text>
    <view class="ww-sound is-on">音效 开</view>
  </view>`

const playsBlock = `
  <view class="ww-plays">
    <view class="ww-plays-head">
      <text class="ww-plays-title">今天的玩法</text>
      <text class="ww-plays-sub">抽一句，顺手写下来</text>
    </view>
    <view class="ww-play-grid">
      ${PLAYS.map((p, i) => `<view class="ww-play${i === 0 ? ' is-open' : ''}">
        <view class="ww-play-mark">${p.mark}</view>
        <view class="ww-play-copy"><text class="ww-play-name">${p.name}</text><text class="ww-play-hint">${p.hint}</text></view>
      </view>`).join('\n      ')}
    </view>
    <view class="ww-play-need">
      <text class="ww-play-need-text">这个玩法要用到你的「MBTI」，资料页填一下就好（完善奖励 +8）。</text>
      <view class="ww-play-need-cta">去填MBTI</view>
    </view>
  </view>
  <view class="ww-composer">
      <input class="ww-input" placeholder="例如：马上有闲，马上有缘" />
      <view class="ww-send">挂上墙</view>
    </view>`

const sheetBlock = `
    <div class="ww-sheet-mask"></div>
    <div class="ww-sheet">
      <div class="ww-sheet-grip"><div class="ww-sheet-grip-bar"></div></div>
      <div class="ww-sheet-head">
        <div class="ww-sheet-mark">签</div>
        <div class="ww-sheet-head-copy"><span class="ww-sheet-overline">今日一签</span><span class="ww-sheet-name">今日一签</span></div>
        <span class="ww-sheet-close">收起</span>
      </div>
      <div class="ww-sheet-body">
        <span class="ww-sheet-title">宜 开口</span>
        <span class="ww-sheet-sub">忌 憋着</span>
        <span class="ww-sheet-line" style="animation:none;opacity:1">想要什么就说出来，说出口才有回音。</span>
      </div>
      <div class="ww-sheet-cta-row"><div class="ww-sheet-cta">写成心愿</div></div>
      <div class="ww-sheet-product">
        <div class="ww-sheet-product-copy">
          <span class="ww-sheet-product-label">偏「求学」· 为你配一件</span>
          <span class="ww-sheet-product-title">潮汐书页</span>
          <span class="ww-sheet-product-meta">Haliotis iris · ¥78</span>
        </div>
        <span class="ww-sheet-product-go">看看这件 ›</span>
      </div>
      <span class="ww-sheet-note">今日这一句一天一支，明天会换新的。</span>
    </div>`

const writeBlock = `
  <view class="ww-write">
    <view class="ww-inspo">
      <text class="ww-inspo-label">灵感</text>
      <view class="ww-inspo-row">
        <view class="ww-inspo-chip">马上有闲</view>
        <view class="ww-inspo-chip">马上有余地</view>
        <view class="ww-inspo-chip">马上有底气</view>
        <view class="ww-inspo-chip">马上有缘</view>
      </view>
    </view>
  
    <view class="ww-write-foot">
      <text class="ww-quota">今日还可写 5 条</text>
      <text class="ww-count">0/30</text>
    </view>
  </view>
</view>`

const markup = SCENE === 'plays'
  ? `<view class="ww-page">${playsBlock}${sheetBlock}</view>`
  : `${head}${playsBlock}${writeBlock}`

/* ── 3. 组装 HTML（WXML 标签 → HTML 标签，否则 <view> 是未知元素会塌成一列） ── */
const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root {
${vars}
}
html, body { margin: 0; padding: 0; }
body { background: var(--color-bg, #14120F); }
page, .page-root { display: block; }
.ww-page { display: block; }
${globalBits}
${pageCss}
/* 预览专用：截图时不做动画（否则量到的是动画中间态） */
* { animation: none !important; }
</style></head>
<body>${markup.replace(/<view/g, '<div').replace(/<\/view>/g, '</div>').replace(/<text/g, '<span').replace(/<\/text>/g, '</span>')}</body></html>`

/* ── 4. 无头 Chrome：一次 --dump-dom 量几何，一次 --screenshot 出图 ────────
   为什么不用仓库里的 CDP 驱动（admin/scripts/lib/cdp.mjs）：本沙箱里 CDP 的 WebSocket
   能连上但 `Page.enable` 永远不回（同机下 `--screenshot` 却正常，见 render-vip-card-preview）。
   于是改用 Chrome 自带的两个无头开关：`--dump-dom` 把量好的数字**当文本**打回 stdout（可断言），
   `--screenshot` 出图给人看。零依赖、零 CDP。 */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean)
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromePath) {
  console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）—— 本工具只做预览，不参与 check:admin')
  process.exit(1)
}

/** 量几何的脚本：结果写进 <pre id="wall-metrics">，靠 --dump-dom 取回 */
const MEASURE_JS = `
<script>
const __SCENE__ = ${JSON.stringify(SCENE)};
window.addEventListener('load', () => {
  const out = []
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  const lineCount = (el) => { const r = document.createRange(); r.selectNodeContents(el); return Array.from(r.getClientRects()).filter((x) => x.height > 1).length }
  /** 子元素是否都在同一行（容器折行的判据 —— Range 在 flex 容器上会给出虚高的行数） */
  const kidsSameRow = (el) => {
    const kids = Array.from(el.children).filter((k) => k.getBoundingClientRect().height > 1)
    if (kids.length < 2) return true
    // 判据是"竖直区间有交集"，不是"y 相等"：徽章带内边距、纯文字不带，两者居中对齐时 y 本就不同
    const top = Math.max(...kids.map((k) => k.getBoundingClientRect().top))
    const bottom = Math.min(...kids.map((k) => k.getBoundingClientRect().bottom))
    return bottom - top > 1
  }
  const push = (label, sel, maxLines, mode, adv) => {
    const el = document.querySelector(sel)
    if (!el) { out.push({ label, missing: true, sel }); return }
    const cs = getComputedStyle(el)
    out.push(Object.assign({ label, sel }, rect(el), {
      lines: lineCount(el),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      // 裁切容器（overflow: hidden）不存在"视觉溢出"：弹幕故意排在屏外，靠裁切进屏
      clips: cs.overflowX === 'hidden',
      overflowX: cs.overflowX !== 'hidden' && el.scrollWidth > el.clientWidth + 1,
      maxLines: maxLines || 0,
      mode: mode || 'lines',
      advisory: !!adv,
      sameRow: kidsSameRow(el),
      padL: cs.paddingLeft,
      text: (el.textContent || '').trim().slice(0, 26)
    }))
  }
  const FULL = __SCENE__ === 'full'
  push('首屏总高', 'body')
  push('页面容器 .ww-page', '.ww-page')
  if (FULL) {
  push('横幅 hero', '.ww-hero')
  push('页头祈运 chip', '.ww-bless', 1)
  push('弹幕墙', '.ww-wall')
  push('墙页脚', '.ww-wall-foot')
  push('即时回声条', '.ww-echo')
  push('灯卡', '.ww-lantern')
  push('灯卡标题', '.ww-lantern-title', 1)
  push('灯卡徽章行', '.ww-lantern-meta', 1, 'same-row')
  push('灯卡灯语', '.ww-lantern-line', 1)
  push('木鱼卡', '.ww-ritual-card')
  }
  push('玩法区', '.ww-plays')
  push('瓦片1 今日一签', '.ww-play:nth-child(1) .ww-play-name', 1)
  push('瓦片2 拆签饼', '.ww-play:nth-child(2) .ww-play-name', 1)
  push('瓦片3 星座签', '.ww-play:nth-child(3) .ww-play-name', 1)
  push('瓦片4 MBTI', '.ww-play:nth-child(4) .ww-play-name', 1)
  push('瓦片4 副文案', '.ww-play:nth-child(4) .ww-play-hint')
  // 纸签弹层只在 plays 场景渲染（full 场景里它与吸底发送条都 fixed 在底部，同屏量测会互相压）
  if (__SCENE__ === 'plays') {
  push('纸签弹层', '.ww-sheet')
  push('弹层签文', '.ww-sheet-title', 1)
  push('弹层正文', '.ww-sheet-line', 2)

  push('CTA 写成心愿', '.ww-sheet-cta', 1)
  push('产品路径（唯一条）', '.ww-sheet-product')
  push('产品名', '.ww-sheet-product-title', 1)

  }
  push('补资料引导', '.ww-play-need')
  if (FULL) {
  push('发送条（吸底）', '.ww-composer')
  push('输入框', '.ww-input')
  push('挂上墙按钮', '.ww-send', 1)
  // ⚠️ 参考项：预览用的是系统字体（仓里没有 ShanhaiHand 字体文件，真机由环境提供），
  // 字宽与真机有偏差 —— 它折行不代表真机折行（真机截图确认过四个灵感 chip 在同一行）
  push('灵感行', '.ww-inspo-row', 0, 'same-row', true)
  }
  // 吸底条不变量：position fixed + 页面底部预留 ≥ 条高（否则最后一张愿签被盖住）
  const composerEl = document.querySelector('.ww-composer')
  const pageEl = document.querySelector('.ww-page')
  if (composerEl && pageEl) {
    const cs = getComputedStyle(composerEl)
    const pageCs = getComputedStyle(pageEl)
    out.push(Object.assign(rect(composerEl), {
      label: '吸底条自身',
      sel: '.ww-composer',
      fixed: cs.position === 'fixed',
      barH: Math.round(composerEl.getBoundingClientRect().height),
      reservedBottom: Math.round(parseFloat(pageCs.paddingBottom) || 0),
      lines: 0,
      maxLines: 0,
      mode: 'sticky-bar',
      // ⚠️ 这里是**注入到页面里的字符串**：不能再用反引号模板（会把外层模板字符串截断 —— 报错就是这个）
      text: '预留 ' + Math.round(parseFloat(getComputedStyle(pageEl).paddingBottom) || 0) + 'px'
    }))
  }
  const pre = document.createElement('pre')
  pre.id = 'wall-metrics'
  pre.textContent = JSON.stringify(out)
  document.body.appendChild(pre)
})
</script>`

const htmlPath = join(ROOT, 'miniprogram/scripts/.tmp', `wall-preview-${SCENE}.html`)
writeFileSync(htmlPath, html.replace('</body>', `${MEASURE_JS}</body>`))

function runChrome(args, timeoutMs = 30000) {
  return new Promise((resolvePromise) => {
    const profile = mkdtempSync(join(tmpdir(), 'sc-wall-preview-'))
    const child = spawn(chromePath, [
      '--headless=new', '--disable-gpu', '--no-sandbox',
      '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, '--hide-scrollbars',
      '--force-device-scale-factor=1', '--virtual-time-budget=2000',
      ...args
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* ignore */ } }, timeoutMs)
    child.on('close', () => {
      clearTimeout(timer)
      try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
      resolvePromise(out)
    })
  })
}

// ① 量：--dump-dom 把量好的 JSON 打回 stdout
const dom = await runChrome(['--window-size=750,1334', '--dump-dom', `file://${htmlPath}`])
const m = /<pre id="wall-metrics">([\s\S]*?)<\/pre>/.exec(dom)
if (!m) {
  console.error('✗ 没拿到量测结果（--dump-dom 里找不到 #wall-metrics）—— Chrome 可能被沙箱拦了')
  process.exit(1)
}
const metrics = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
const problems = []
const advisories = []
metrics.forEach((row) => {
  if (row.missing) problems.push(`${row.label}：选择器 ${row.sel} 没渲染出来`)
  else {
    if (row.overflowX) problems.push(`${row.label}：横向溢出（scrollW ${row.scrollW} > clientW ${row.clientW}）`)
    if (row.mode === 'sticky-bar') {
      if (!row.fixed) problems.push('发送条没有吸底（position 不是 fixed）')
      if (row.reservedBottom < row.barH) {
        problems.push(`页面底部预留 ${row.reservedBottom}px < 吸底条 ${row.barH}px（最后一张愿签会被盖住）`)
      }
    } else if (row.mode === 'same-row') {
      if (!row.sameRow) (row.advisory ? advisories : problems).push(`${row.label}：子元素折行了（本该同一行）${row.advisory ? '〔参考项：字体差异〕' : ''}`)
    } else if (row.maxLines && row.lines > row.maxLines) {
      problems.push(`${row.label}：折成 ${row.lines} 行（上限 ${row.maxLines}）`)
    }
    if (row.label === '页面容器 .ww-page' && row.padL === '0px') {
      problems.push('页面容器 .ww-page 没有左右内边距（token 没生效 —— 会连带所有卡片量成满宽）')
    }
  }
})

// ② 出图
if (!CHECK_ONLY) {
  const pngPath = join(ROOT, 'miniprogram/scripts/.tmp', `wall-preview-${SCENE}.png`)
  try { rmSync(pngPath, { force: true }) } catch { /* ignore */ }
  // 全页高度：按量到的 body 高度（+ 余量）设窗口，避免只截到首屏
  const bodyH = (metrics.find((x) => x.label === '首屏总高') || {}).h || 1334
  await runChrome([`--window-size=750,${Math.min(6000, bodyH + 40)}`, `--screenshot=${pngPath}`, `file://${htmlPath}`])
  if (existsSync(pngPath)) {
    writeFileSync(OUT, readFileSync(pngPath))
    console.log(`\n截图：${OUT}（${Math.round(statSync(OUT).size / 1024)}KB）`)
  } else {
    console.error('\n✗ 截图未生成')
  }
}

if (advisories.length) {
  console.log('\n⚠ 参考项（字体差异，需真机确认）：')
  advisories.forEach((a) => console.log('  - ' + a))
}
const show = (row) => row.missing
  ? `  ✗ ${String(row.label).padEnd(16)} 未渲染`
  : `  · ${String(row.label).padEnd(16)} ${String(row.w).padStart(4)}×${String(row.h).padStart(4)}  行 ${row.lines}  ${row.text}`
console.log(`祈福墙版式预览（场景 ${SCENE}；视口 750px ↔ 750rpx，等比于任意真机宽度）`)
metrics.forEach((row) => console.log(show(row)))

if (problems.length) {
  console.error(`\n✗ 版式不变量违反 ${problems.length} 处：`)
  problems.forEach((p) => console.error('  - ' + p))
  process.exit(1)
}
console.log('\n✓ 版式不变量通过（宽度 / 换行 / 溢出；字体度量与安全区仍需真机确认）')
