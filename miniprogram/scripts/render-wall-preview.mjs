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
 *   node miniprogram/scripts/render-wall-preview.mjs --check --selftest   # 证明判据真的会红（注入 → 必须检出 → 还原）
 *   node miniprogram/scripts/render-wall-preview.mjs --out /tmp/x.png
 *
 * 场景（--scene）：full（默认，首屏各块） / plays（只渲染玩法区，放大看细节）
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
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

/* ── 0. 版式判据的阈值（都是**量出来的**，不是拍的） ──────────────────────
 * 需求 7 §3 要求把"位置 / 大小"变成**可量、可打红**的判据，例：banner 不超 X% 屏高、
 * 玩法区一屏内可见 N 个。这两条此前缺失：元素各自"不溢出、不折行"，合起来却可能
 * 把玩法区整个顶出第一屏 —— 静态断言看不出来（错题本 E8）。
 *
 * 基线（2026-09-19 实量）：`--window-size=750,1334` 下 headless 的**实际可视高是 1191px**
 * （不是 1334 —— 本工具文档一直没写清这点，判据的分母因此不能写死），与 iPhone 8/SE2 的
 * 可用高（667pt − 20 状态栏 − 44 导航 ≈ 603pt ≈ 1206rpx）同量级；1rpx = 1px 等比，
 * 所以宽度 / 换行 / 占比对任意真机宽度成立：
 *   · 横幅 hero 254 / 1191 = **21.3%**
 *   · 玩法区首排瓦片 top = 1037、吸底条顶边 = 1080 → 首排**进得了首屏**（不用先滚屏）；
 *     但瓦片底边 1145 被吸底条盖住 **65px（约 60%）** —— 见下面 ⚠ 参考项，属产品取舍，
 *     不进判据（改版式要真机图，E8）。
 * 阈值都留了余量：只有"真的变胖 / 真的被顶下去"才红，镜像字体差异不会红。
 */
/** 页头 banner 占首屏高的上限（实测 21.3%） */
const HERO_MAX_SHARE = 0.24
/** 首屏内必须**看得到**（顶边在吸底条之上，不必先滚屏）的玩法瓦片数（当前首排 = 2） */
const FOLD_MIN_TILES = 2
/** 被吸底条盖住超过这个比例 → 进 ⚠ 参考项（不红：这是产品取舍，不是回归） */
const TILE_COVER_ADVISORY = 0.2

/* ── 0b. 自检：判据必须能被打红（AGENTS.md：每条守卫都要能证明自己会失败） ──
 * 做法与仓内其它守卫一致：**改真源码 → 必须检出 → 还原**（不是改镜像数据，否则证明不了
 * 判据读的是真源码）。注入都打在页面 WXSS 末尾，用 !important 覆盖：
 *   ① hero-tall        把 banner 撑到 420px   → 必须触发"占首屏超上限"
 *   ② plays-below-fold 把弹幕墙撑到 820px     → 必须触发"首屏内可见瓦片不足"
 * 判定要求**错误信息命中预期关键词**（不是"非 0 就算过"）：Chrome 崩溃也会非 0，
 * 那种"自检通过"是假的。
 */
if (has('--selftest')) {
  const INJECTS = [
    { name: 'hero-tall', css: '\n.ww-hero { height: 420px !important; }\n', expect: '横幅 hero 占首屏' },
    { name: 'plays-below-fold', css: '\n.ww-wall { height: 820px !important; }\n', expect: '首屏内看得到的瓦片' }
  ]
  const original = readFileSync(PAGE_WXSS, 'utf8')
  let ok = true
  for (const inj of INJECTS) {
    try {
      writeFileSync(PAGE_WXSS, original + inj.css)
      const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--check', '--scene', SCENE], { encoding: 'utf8' })
      const caught = run.status !== 0 && `${run.stderr}\n${run.stdout}`.includes(inj.expect)
      if (!caught) {
        ok = false
        console.error(`✗ selftest「${inj.name}」没被检出（期望红在「${inj.expect}」）—— 判据无效`)
      } else {
        console.log(`  ✓ 注入「${inj.name}」被检出：${inj.expect}`)
      }
    } finally {
      writeFileSync(PAGE_WXSS, original)
    }
  }
  const restored = readFileSync(PAGE_WXSS, 'utf8') === original
  if (!restored) {
    console.error('✗ selftest 还原失败：页面 WXSS 与注入前不一致，请立刻 git checkout 该文件')
    process.exit(1)
  }
  if (!ok) process.exit(1)
  console.log(`✓ selftest 通过：${INJECTS.length} 个版式注入全部被检出、已还原源文件`)
  process.exit(0)
}

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
  // 视口单独量：新增的两条判据（banner 占屏高、玩法区一屏内可见）都以它为分母/底边，
  // 写死 1334 会在换视口时静默算错 —— 判据的来源必须自己也是量出来的。
  out.push({ label: '视口', sel: ':window', x: 0, y: 0, w: innerWidth, h: innerHeight, lines: 0, text: innerWidth + '×' + innerHeight })
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
  // 瓦片容器（不是只量名字行）：判据问的是"首屏里看得到几枚瓦片"，只量一行名字会漏掉
  // "名字在屏内、瓦片底边被吸底条压住"这种半可见状态 —— 而它正是这一页的真实版式风险。
  // ⚠️ 这一段是**注入到页面里的字符串**：不能用反引号模板（会截断外层模板字符串），一律字符串拼接
  for (let i = 1; i <= 4; i += 1) push('瓦片' + i + '容器', '.ww-play:nth-child(' + i + ')')
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

/* ── ①b. 需求 7 §3 的两条"位置 / 大小"判据 ───────────────────────────────
 * 为什么必须单独判：前面那批判据管的是"每个元素自己有没有坏"（溢出 / 折行），
 * 而需求 7 的正题是**它们合起来把谁挤到哪去了** —— 元素全都没坏，玩法区照样能被顶出第一屏。
 * 判据写死成数字才可验收；数字全部来自本次实量（分母是量到的视口高，不是常量）。 */
{
  const byLabel = (l) => metrics.find((x) => x.label === l)
  const vp = byLabel('视口')
  if (!vp || !vp.h) {
    // 判据的输入没量到 = 判据失效。这里必须红（否则工具"看着通过"其实是假通过，本工具已栽过一次）。
    problems.push('没量到视口尺寸（banner 占屏比 / 一屏可见数两条判据无法成立 = 假通过）')
  } else {
    const hero = byLabel('横幅 hero')
    if (hero && !hero.missing) {
      const share = hero.h / vp.h
      if (share > HERO_MAX_SHARE) {
        problems.push(
          `横幅 hero 占首屏 ${(share * 100).toFixed(1)}% > 上限 ${(HERO_MAX_SHARE * 100).toFixed(0)}%（${hero.h}/${vp.h}px）—— banner 一胖，弹幕墙与玩法区就被顶出第一屏`
        )
      }
    }
    if (SCENE === 'full') {
      // 吸底条盖住的区域不算"看得到"：它常年压在页面底部，被它压住的瓦片用户先看到的是输入框。
      const composer = byLabel('吸底条自身')
      const coverH = composer && composer.fixed ? composer.barH : 0
      const foldBottom = vp.h - coverH
      const tiles = [1, 2, 3, 4].map((i) => byLabel(`瓦片${i}容器`)).filter((t) => t && !t.missing)
      const seen = tiles.filter((t) => t.y >= 0 && t.y < foldBottom)
      if (tiles.length === 4 && seen.length < FOLD_MIN_TILES) {
        problems.push(
          `玩法区首屏内看得到的瓦片 ${seen.length} 个 < ${FOLD_MIN_TILES} 个（首屏可用底边 ${foldBottom}px，四枚瓦片 top ${tiles.map((t) => t.y).join('/')}）—— 首屏看不到玩法 = 需求 7 的"位置大小"没做到`
        )
      }
      // ⚠ 参考项（不红）：半遮挡本身是产品取舍（吸底条是产品点过头的），但数字要留痕 ——
      // 真机上"要不要把玩法区再往上挪 / 吸底条要不要矮一点"由产品看图定。
      // 只报"首屏内确实露头、但被吸底条压掉一截"的瓦片；整枚在首屏之下的不在此列（那是上面那条判据的事）。
      tiles.forEach((t, i) => {
        if (t.y >= foldBottom) return
        const overlap = t.y + t.h > foldBottom ? Math.min(t.y + t.h, vp.h) - foldBottom : 0
        if (overlap / t.h > TILE_COVER_ADVISORY) {
          advisories.push(`瓦片${i + 1} 在首屏内露出但被吸底条压掉 ${overlap}px / ${t.h}px（${Math.round((overlap / t.h) * 100)}%）—— 滚一下即完整，是否上移由产品定`)
        }
      })
    }
  }
}

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
  console.log('\n⚠ 参考项（不红：字体度量差异 / 产品取舍，需真机或产品确认）：')
  advisories.forEach((a) => console.log('  - ' + a))
}
const show = (row) => row.missing
  ? `  ✗ ${String(row.label).padEnd(16)} 未渲染`
  : `  · ${String(row.label).padEnd(16)} y${String(row.y).padStart(4)} ${String(row.w).padStart(4)}×${String(row.h).padStart(4)}  行 ${row.lines}  ${row.text}`
console.log(`祈福墙版式预览（场景 ${SCENE}；视口 750px ↔ 750rpx，等比于任意真机宽度）`)
metrics.forEach((row) => console.log(show(row)))

if (problems.length) {
  console.error(`\n✗ 版式不变量违反 ${problems.length} 处：`)
  problems.forEach((p) => console.error('  - ' + p))
  process.exit(1)
}
console.log(`\n✓ 版式不变量通过（宽度 / 换行 / 溢出 / 吸底预留 / banner 占屏 ≤${(HERO_MAX_SHARE * 100).toFixed(0)}% / 首屏内看得见的瓦片 ≥${FOLD_MIN_TILES} 个；字体度量与安全区仍需真机确认）`)
