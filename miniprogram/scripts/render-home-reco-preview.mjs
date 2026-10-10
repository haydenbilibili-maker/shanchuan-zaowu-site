#!/usr/bin/env node
/**
 * 首页「为你推荐」版式离线预览 + 实测（开发工具，**不在 check:admin 里**：需要本机 Chrome）
 *
 * 为什么需要它：推荐区是纯视觉改版，"信息层级 / 比例 / 截断 / 三态"都是画出来才知道对不对
 * （AGENTS.md：静态分析 ≠ 事实）。结构**不手抄**：
 *   · --variant before：从 `git show HEAD:` 读首页 WXML 里 `<!-- 为你推荐 -->` 那一段 + HEAD 的 index.wxss；
 *   · --variant after ：读 `components/HomeReco/index.wxml|wxss`，并调用组件自己的 `logic.js` 推导渲染数据。
 * 两种都在下方接一段真 `ProductCard`（「最新入库」）作对照，判断与首页其它区块是否统一。
 *
 * 用法：
 *   node miniprogram/scripts/render-home-reco-preview.mjs --variant before --out /tmp/before.png
 *   node miniprogram/scripts/render-home-reco-preview.mjs --variant after --scene interest
 *   … --check            只跑版式不变量（after；非 0 = 违反）
 *   … --check --selftest 证明判据会红（注入只写 .tmp 副本，真源码全程只读）
 *
 * 场景（after）：interest（按常看标签）/ wall（祈福墙信号）/ cold（冷启动）/ sparse（缺诗意名·学名·卖点·分类 + 长名称）/ loading / error / empty
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP = join(ROOT, 'miniprogram')
const TMP_DIR = join(MP, 'scripts/.tmp')
mkdirSync(TMP_DIR, { recursive: true })

const REAL_COMP_WXML = join(MP, 'components/HomeReco/index.wxml')
const REAL_COMP_WXSS = join(MP, 'components/HomeReco/index.wxss')
const COMP_WXML = process.env.HOMERECO_PREVIEW_WXML || REAL_COMP_WXML
const COMP_WXSS = process.env.HOMERECO_PREVIEW_WXSS || REAL_COMP_WXSS
const LOGIC_JS = process.env.HOMERECO_PREVIEW_LOGIC || join(MP, 'components/HomeReco/logic.js')

const argv = process.argv.slice(2)
const has = (n) => argv.includes(n)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const VARIANT = argOf('--variant', 'after')
const SCENES = ['interest', 'wall', 'cold', 'sparse', 'loading', 'error', 'empty']
const SCENE = argOf('--scene', 'interest')
if (!SCENES.includes(SCENE)) {
  console.error(`✗ 未知场景 ${SCENE}（可用：${SCENES.join(' / ')}）`)
  process.exit(1)
}
const OUT = argOf('--out', join(TMP_DIR, `home-reco-${VARIANT}-${SCENE}.png`))
/** --ratio：封面换成该比例的样图（线上实测：3:2 横 58.5% / 2:3·3:4 竖 38.5% / 方 2.9%，2026-09-28） */
const RATIOS = {
  '9x16': ['green-banded-peacock-swallowtail-dome.jpg', 576, 1024],
  '2x3': ['green-banded-peacock-swallowtail-dome.jpg', 683, 1024],
  '3x4': ['green-banded-peacock-swallowtail-dome.jpg', 767, 1024],
  '1x1': ['green-banded-peacock-swallowtail-dome.jpg', 767, 767],
  '3x2': ['four-leaf-clover-laminated.jpg', 1024, 683],
  '4x3': ['four-leaf-clover-laminated.jpg', 1024, 767],
  '16x9': ['four-leaf-clover-laminated.jpg', 1024, 576]
}
const RATIO = argOf('--ratio', '')
if (RATIO && !RATIOS[RATIO]) {
  console.error(`✗ 未知比例 ${RATIO}（可用：${Object.keys(RATIOS).join(' / ')}）`)
  process.exit(1)
}
/** --page：画第几页（0 起）；--n：推荐池只留前 N 件（复现末页不满 / 总数 < 3 的降级） */
const PAGE = Math.max(0, Number(argOf('--page', '0')) | 0)
const POOL_N = Number(argOf('--n', '0')) | 0
const CHECK_ONLY = has('--check')

/* ── 自检：判据必须能被打红 ─────────────────────────────────────────── */
if (has('--selftest')) {
  const INJECTS = [
    { name: 'ratio-broken', scene: 'interest', css: '\n.hr-img-box { aspect-ratio: auto !important; height: 120rpx !important; }\n', expect: '比例' },
    { name: 'title-unequal', scene: 'interest', css: '\n.hr-card-title { height: auto !important; -webkit-line-clamp: unset !important; display: block !important; }\n', wxml: ['{{item.title}}</text>', '{{item.title}}{{item.title}}{{item.title}}</text>'], expect: '标题' },
    { name: 'grid-overflow', scene: 'interest', css: '\n.hr-card { min-width: 400rpx !important; max-width: none !important; flex: none !important; }\n', expect: '溢出' },
    { name: 'error-no-retry', scene: 'error', wxml: ['bindtap="onRetry"', 'data-x="1"'], expect: '重试' },
    { name: 'skeleton-jump', scene: 'loading', css: '\n.hr-sk-cover { height: 120rpx !important; }\n', expect: '骨架' },
    { name: 'swiper-clip', scene: 'interest', css: '\n.hr-swiper { height: 760rpx !important; }\n', expect: '裁掉' },
    { name: 'mark-on-image', scene: 'interest', wxml: ['<protected-badge product="{{item}}"', '<text class="hr-mark">常看 · 闪蝶</text><protected-badge product="{{item}}"'], expect: '图上' },
    { name: 'exhibit-small', scene: 'interest', css: '\n.hr-cover .hr-cv-media { width: 240rpx !important; height: 300rpx !important; }\n', expect: '占封面' },
    { name: 'label-overlay', scene: 'interest', css: '\n.hr-cover { position: relative !important; }\n.hr-label { position: absolute !important; left: 0; right: 0; bottom: 0; height: 200rpx; }\n', expect: '压住' },
    { name: 'page-underfilled', scene: 'interest', args: ['--page', '3'], css: '\n.hr-row { display: none !important; }\n', expect: '不满员' },
    { name: 'cover-jump', scene: 'interest', css: '\n.hr-cover--side { height: 700rpx !important; }\n', expect: '封面高' }
  ]
  const baseWxss = readFileSync(REAL_COMP_WXSS, 'utf8')
  const baseWxml = readFileSync(REAL_COMP_WXML, 'utf8')
  let ok = true
  for (const inj of INJECTS) {
    const c1 = join(TMP_DIR, `homereco-selftest-${inj.name}.wxss`)
    const c2 = join(TMP_DIR, `homereco-selftest-${inj.name}.wxml`)
    try {
      let wxml = baseWxml
      if (inj.wxml) {
        if (!baseWxml.includes(inj.wxml[0])) throw new Error(`锚点找不到：${inj.wxml[0]}`)
        wxml = baseWxml.split(inj.wxml[0]).join(inj.wxml[1])
      }
      writeFileSync(c1, baseWxss + (inj.css || ''))
      writeFileSync(c2, wxml)
      const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--variant', 'after', '--check', '--scene', inj.scene, ...(inj.args || [])], {
        encoding: 'utf8',
        env: { ...process.env, HOMERECO_PREVIEW_WXSS: c1, HOMERECO_PREVIEW_WXML: c2 }
      })
      const caught = run.status !== 0 && `${run.stderr}\n${run.stdout}`.includes(inj.expect)
      if (!caught) {
        ok = false
        console.error(`✗ 注入「${inj.name}」没被检出（期望红在「${inj.expect}」）\n${run.stdout}\n${run.stderr}`)
      } else console.log(`  ✓ 注入「${inj.name}」被检出：${inj.expect}`)
    } catch (e) {
      ok = false
      console.error(`✗ 注入「${inj.name}」无法施加：${e.message}`)
    } finally {
      for (const f of [c1, c2]) rmSync(f, { force: true })
    }
  }
  if (readFileSync(REAL_COMP_WXSS, 'utf8') !== baseWxss || readFileSync(REAL_COMP_WXML, 'utf8') !== baseWxml) {
    console.error('✗ 自检改动了真源码（只许写 .tmp 副本）')
    process.exit(1)
  }
  if (!ok) process.exit(1)
  console.log(`✓ selftest 通过：${INJECTS.length} 个注入全部被检出；真源码未被改动`)
  process.exit(0)
}

/* ── 1. 样式：app.wxss 令牌 + 首页 section 样式 + 推荐区样式 ──────────── */
const toCss = (src) => String(src)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(\d*\.?\d+)rpx/g, (_, n) => `${Number(n)}px`)
  .replace(/env\(safe-area-inset-bottom\)/g, '0px')
  .replace(/(^|[\s,}])page(\s*[{,])/g, '$1body$2')

const gitShow = (rel) => {
  const r = spawnSync('git', ['show', `HEAD:${rel}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git show HEAD:${rel} 失败：${r.stderr}`)
  return r.stdout
}
const appCss = toCss(readFileSync(join(MP, 'app.wxss'), 'utf8'))
const indexWxss = VARIANT === 'before'
  ? gitShow('miniprogram/pages/index/index.wxss')
  : readFileSync(join(MP, 'pages/index/index.wxss'), 'utf8')
const cardCss = toCss(readFileSync(join(MP, 'components/ProductCard/index.wxss'), 'utf8'))
const listCss = toCss(readFileSync(join(MP, 'components/ProductList/index.wxss'), 'utf8'))
const compCss = VARIANT === 'after' ? toCss(readFileSync(COMP_WXSS, 'utf8')) : ''

/* ── 2. 样例数据（本地真实商品图；字段形状 = getRecommendations 回包） ── */
const IMG = (f) => `file://${join(ROOT, 'public/images/price-list', f)}`
// 真机截图里的孔雀标本是手机竖拍（≈9:16），库里样例图全是 3:4 —— 现裁一张 9:16 来复现「竖长原图被裁」
const TALL = join(TMP_DIR, 'home-reco-tall-9x16.jpg')
if (!existsSync(TALL)) {
  spawnSync('sips', ['-c', '1024', '560', join(ROOT, 'public/images/price-list/green-banded-peacock-swallowtail-dome.jpg'), '--out', TALL], { stdio: 'ignore' })
}
function ratioImage(key) {
  const [src, w, h] = RATIOS[key]
  const out = join(TMP_DIR, `home-reco-ratio-${key}.jpg`)
  if (!existsSync(out)) spawnSync('sips', ['-c', String(h), String(w), join(ROOT, 'public/images/price-list', src), '--out', out], { stdio: 'ignore' })
  return out
}
/** 真机上比例来自 image bindload（并缓存）；预览直接读文件头，等价于「已缓存」 */
function ratioOf(fileUrl) {
  const r = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', fileUrl.replace(/^file:\/\//, '')], { encoding: 'utf8' })
  const w = Number((/pixelWidth: (\d+)/.exec(r.stdout) || [])[1])
  const h = Number((/pixelHeight: (\d+)/.exec(r.stdout) || [])[1])
  return w && h ? h / w : 0
}
// 样例 = 2026-09-27 真机截图同一组（孔雀标本 / 贝壳时钟长标题 / 场景兜底的祈运件）
const SAMPLE = [
  { _id: 'p1', title: '孔雀标本', themeName: '屏开锦程', themeNote: '孔雀开屏，寓意新居前程似锦', latinName: 'Pavo cristatus', price: 4500, images: [existsSync(TALL) ? `file://${TALL}` : IMG('green-banded-peacock-swallowtail-dome.jpg')], tags: ['玻璃罩装'], category: '鸟类', reason: '相近标签', isOneOfAKind: true },
  { _id: 'p2', title: '大蓝闪蝶贝壳时钟摆件', themeName: '壳中光阴', latinName: 'Morpho didius', price: 799, images: [IMG('blue-morpho-large-shell-clock.jpg')], tags: ['大蓝闪蝶'], category: '蝴蝶', reason: '相近标签' },
  { _id: 'p3', title: '蝎子螺', themeName: '螺旋日历', price: 88, images: [IMG('shell-photo-frame.jpg')], tags: ['客厅陈设'], category: '贝类', reason: '同品类推荐' },
  { _id: 'p4', title: '蒲公英玻璃罩', themeName: '一口气的愿', price: 99, images: [IMG('dandelion-glass-dome.jpg')], tags: ['植物'], category: '植物', reason: '同品类推荐' },
  { _id: 'p5', title: '绿丽花金龟玻璃罩摆件', latinName: 'Chlorocala africana', price: 128, hasSku: true, skus: [{ price: 128 }, { price: 168 }], images: [IMG('green-rose-chafer-dome.jpg')], tags: ['甲虫'], category: '甲虫', reason: '同品类推荐' },
  { _id: 'p6', title: '天堂凤蝶组合框', latinName: 'Papilio ulysses', price: 468, images: [IMG('paradise-eros-combo-frame.jpg')], tags: ['凤蝶'], category: '蝴蝶', reason: '为你推荐', createTime: Date.now() - 3 * 86400000 },
  { _id: 'p7', title: '绿鸟翼凤蝶典藏框', themeName: '翠羽', latinName: 'Ornithoptera priamus', price: 1280, images: [IMG('green-birdwing-collection.jpg')], tags: ['凤蝶'], category: '蝴蝶', reason: '同品类推荐', isOneOfAKind: true },
  { _id: 'p8', title: '小蓝闪蝶玻璃罩', latinName: 'Morpho aega', price: 168, images: [IMG('small-morpho-glass-dome.jpg')], tags: ['大蓝闪蝶'], category: '蝴蝶', reason: '相近标签' }
]
const BLESS = [
  { _id: 'b1', title: '大蓝闪蝶标本框', themeName: '青空之翼', latinName: 'Morpho didius', price: 499, images: [IMG('blue-morpho-wood-frame.jpg')], matchSource: 'scene' },
  { _id: 'b2', title: '血漪蛱蝶玻璃罩', themeName: '好事将近', latinName: 'Cethosia biblis', price: 198, images: [IMG('blood-ripple-butterfly-dome.jpg')], matchSource: 'tag' }
]
const FEED = [
  { _id: 'f1', title: '国产混合蝴蝶框', latinName: 'Lepidoptera', price: 268, httpImage: IMG('domestic-mixed-butterfly-frame-01.jpg') },
  { _id: 'f2', title: '植物组合框', latinName: '', price: 158, httpImage: IMG('plant-combo-frame-02.jpg') }
]

/* ── 3. 载入组件真逻辑（CJS → new Function；与 render-wall-feed 同思路） ── */
function loadCjs(absPath, cache = new Map()) {
  if (cache.has(absPath)) return cache.get(absPath)
  const mod = { exports: {} }
  cache.set(absPath, mod.exports)
  const dir = dirname(absPath)
  const req = (id) => {
    for (const c of [resolve(dir, id), `${resolve(dir, id)}.js`, resolve(dir, id, 'index.js')]) {
      if (existsSync(c) && statSync(c).isFile()) return loadCjs(c, cache)
    }
    throw new Error('require 解析失败：' + id)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', readFileSync(absPath, 'utf8'))(mod, mod.exports, req)
  cache.set(absPath, mod.exports)
  return mod.exports
}

function afterData() {
  const logic = loadCjs(LOGIC_JS)
  const signals = {
    interest: { interestTags: { 玻璃罩装: 9, 大蓝闪蝶: 6, 客厅陈设: 4 }, wall: { blessLabel: '求财' } },
    wall: { interestTags: null, wall: { blessLabel: '求财' } },
    cold: { interestTags: null, wall: null }
  }[SCENE] || { interestTags: null, wall: null }
  const base = { phase: 'ready', pageIndex: PAGE, errorMsg: '' }
  if (SCENE === 'loading') return logic.buildView({ ...base, phase: 'loading', pool: [], signals })
  if (SCENE === 'error') return logic.buildView({ ...base, phase: 'error', pool: [], signals, errorMsg: '网络开小差了' })
  if (SCENE === 'empty') return logic.buildView({ ...base, pool: [], signals })
  let reco = SCENE === 'cold' ? SAMPLE.map((r) => ({ ...r, reason: r.category ? '同品类推荐' : '为你推荐' })) : SAMPLE
  if (SCENE === 'sparse') reco = SAMPLE.map(({ themeName, themeNote, latinName, category, ...r }, i) => (i === 1 ? { ...r, title: '大蓝闪蝶贝壳时钟摆件（含实木底座与防尘玻璃罩）' } : r))
  if (RATIO) reco = reco.map((r, i) => (i === 0 ? { ...r, images: [`file://${ratioImage(RATIO)}`] } : r))
  let pool = logic.buildPool(reco, signals.wall ? BLESS : [], signals)
  if (POOL_N > 0) pool = pool.slice(0, POOL_N)
  const ratios = {}
  pool.forEach((it) => { if (it.rawImage) ratios[it.rawImage] = ratioOf(it.rawImage) })
  return logic.buildView({ ...base, pool: pool.map((it) => ({ ...it, image: it.rawImage })), signals, ratios })
}

/* ── 4. 生成 HTML ───────────────────────────────────────────────────── */
const unwrapGate = (s) => s
  // 解析器会丢掉 image 的 mode：先把它并进 class（hr-mode-<mode>），预览 CSS 再按类名复刻 aspectFill / aspectFit / widthFix
  .replace(/<image\b([^>]*?)\bclass="([^"]*)"([^>]*?)\bmode="([^"]*)"/g, '<image$1class="$2 hr-mode-$4"$3')
  .replace(/<wxs[^>]*\/>/g, '')
  .replace(/<sensitive-blur-gate[\s\S]*?>/g, '<view class="sb-wrap">')
  .replace(/<\/sensitive-blur-gate>/g, '</view>')

let recoHtml = ''
let viewMeta = { layout: 'full', canSwap: true, pageTotal: 1, page: { row: [] } }
if (VARIANT === 'before') {
  const src = gitShow('miniprogram/pages/index/index.wxml')
  const a = src.indexOf('<!-- 为你推荐 -->')
  const b = src.indexOf('<!-- 最新入库 -->')
  if (a < 0 || b < 0) throw new Error('HEAD 的首页 WXML 里找不到「为你推荐」区块锚点')
  const recs = SAMPLE.map((r) => ({ ...r, image: r.images[0], reason: r.reason || '为你推荐', sensitiveBlur: false }))
  recoHtml = renderWxml(unwrapGate(src.slice(a, b)), {
    showRecommendations: true, loadingRecommendations: false, recommendations: recs,
    latin: { display: (s) => String(s || '') }
  })
} else {
  const view = afterData()
  view.shownUpTo = view.pageIndex + 1
  view.swapping = false
  viewMeta = { layout: view.layout || 'full', canSwap: view.canSwap, pageTotal: view.pageTotal, page: ((view.pages || [])[view.pageIndex] || { row: [] }) }
  // 行内 style 里的 rpx（竖档图宽 / widthFix 上提）也按 750 设计宽 1:1 换 px
  const body = renderWxml(unwrapGate(readFileSync(COMP_WXML, 'utf8')), view).replace(/style="([^"]*)"/g, (s, v) => `style="${v.replace(/(-?\d*\.?\d+)rpx/g, '$1px')}"`)
  recoHtml = `<div class="section-box home-reco-slot">${body}</div>`
}

const cardWxml = unwrapGate(readFileSync(join(MP, 'components/ProductCard/index.wxml'), 'utf8'))
const feedHtml = FEED.map((info) => renderWxml(cardWxml, {
  info, soldOut: false, sensitiveEnabled: false, productId: info._id, imgBroken: false,
  isNewArrival: false, isOneOfAKind: false, latinName: info.latinName, craftTags: [],
  priceText: info.price, priceFrom: false, soldText: '', soldIsNew: false
}))
const contextHtml = `
<div class="section-box section-compact home-feed-section">
  <div class="section-header-row section-header-compact"><div class="title-group"><span class="t-cn">最新入库</span><span class="t-en">NEW ARRIVALS</span></div></div>
  <div class="grid-waterfall"><div class="col">${feedHtml[0]}</div><div class="col">${feedHtml[1]}</div></div>
</div>`
const orbHeader = `
<div class="section-box orbs-section">
  <div class="section-header-row section-header-compact"><div class="title-group"><span class="t-cn">博物藏品室</span><span class="t-en">SPECIMEN ARCHIVES</span></div></div>
  <div style="height:60px;border:1px dashed rgba(196,167,108,.25);border-radius:12px;color:#6B6560;font-size:20px;display:flex;align-items:center;justify-content:center">（灵动球区 · 省略）</div>
</div>`

// 等图片全部载完再量（展品框依赖 naturalWidth）；--dump-dom / --screenshot 都在 virtual-time-budget 之后取
const METRICS_JS = `
window.addEventListener('load', () => {
  const q = (s) => document.querySelector(s)
  const qa = (s) => [...document.querySelectorAll(s)]
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  const out = { exists: {} }
  ;['.hr-cover', '.hr-card', '.hr-sk-cover', '.hr-error', '.hr-retry', '.hr-empty', '.hr-why', '.hr-more', '.hr-dots'].forEach((s) => { out.exists[s] = !!q(s) })
  const mod = q('.home-reco-slot')
  if (mod) out.module = { ...box(mod), scrollW: mod.scrollWidth, clientW: mod.clientWidth }
  const page = q('.hr-swiper > div:nth-child(${PAGE + 1})')
  const vis = (s) => (page ? [...page.querySelectorAll(s)].filter((el) => el.getClientRects().length) : [])
  out.imgs = vis('.hr-img-box').map((el) => box(el))
  out.cards = vis('.hr-card').map((el) => ({ ...box(el) }))
  const cover = page && page.querySelector('.hr-cover')
  if (cover) {
    out.lead = box(cover)
    // 展品实际显示区：按 object-fit 算出图像内容框，再被外层 overflow:hidden 逐级裁切（虚化铺底 .hr-cover-bg 不算展品）
    out.leadTier = (cover.className.match(/hr-cover--(\\w+)/) || [])[1] || ''
    const img = [...cover.querySelectorAll('img')].find((el) => !el.classList.contains('hr-cover-bg'))
    const cr = cover.getBoundingClientRect()
    if (img && img.naturalWidth) {
      let r = img.getBoundingClientRect()
      let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom
      if (getComputedStyle(img).objectFit === 'contain') {
        const s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight)
        const w = img.naturalWidth * s, h = img.naturalHeight * s
        x0 = r.left + (r.width - w) / 2; y0 = r.top + (r.height - h) / 2; x1 = x0 + w; y1 = y0 + h
      }
      for (let el = img.parentElement; el && el !== cover.parentElement; el = el.parentElement) {
        if (getComputedStyle(el).overflow === 'visible') continue
        const c = el.getBoundingClientRect()
        x0 = Math.max(x0, c.left); y0 = Math.max(y0, c.top); x1 = Math.min(x1, c.right); y1 = Math.min(y1, c.bottom)
      }
      const area = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
      const lb = cover.querySelector('.hr-label')
      let overlap = 0
      if (lb && area) {
        const l = lb.getBoundingClientRect()
        overlap = Math.max(0, Math.min(x1, l.right) - Math.max(x0, l.left)) * Math.max(0, Math.min(y1, l.bottom) - Math.max(y0, l.top)) / area
      }
      out.exhibit = { share: area / (cr.width * cr.height), overlap, natural: img.naturalHeight / img.naturalWidth, shown: (y1 - y0) / Math.max(1, x1 - x0) }
      out.annot = { x: cr.right + window.scrollX, y: cr.top + window.scrollY, x0, y0, x1, y1 }
    }
  }
  const row = page && page.querySelector('.hr-row')
  out.row = row ? { ...box(row), scrollW: row.scrollWidth, clientW: row.clientWidth } : null
  out.titles = vis('.hr-card-title').map((el) => ({ h: el.clientHeight, lh: parseFloat(getComputedStyle(el).lineHeight) || 0, sh: el.scrollHeight }))
  out.marks = vis('.hr-mark').map((el) => ({ text: el.textContent.trim(), sw: el.scrollWidth, cw: el.clientWidth, onImage: !!el.closest('.hr-img-box, .hr-cv-media') }))
  const sw = q('.hr-swiper')
  if (sw && page) out.swiper = { h: sw.clientHeight, content: Math.ceil(page.scrollHeight) }
  if (mod) {
    const clone = mod.cloneNode(true)
    clone.querySelectorAll('.hr-why').forEach((el) => el.remove())
    out.restText = clone.textContent
  }
  if (q('.hr-sk-cover')) out.skLead = box(q('.hr-sk-cover'))
  if (q('.hr-sk-card')) out.skCard = box(q('.hr-sk-card'))
  out.body = Math.max(document.body.scrollHeight, (q('.main-scroll') || document.body).scrollHeight + 60)
  if (out.annot && ${!has('--no-annot')}) {
    // 截图标注（量测之后才插入，不影响任何读数）：展品显示框描边 + 占比读数
    const a = out.annot
    const frame = document.createElement('div')
    frame.style.cssText = 'position:absolute;pointer-events:none;border:2px dashed #FF3BD4;z-index:99;left:' + (a.x0 + scrollX) + 'px;top:' + (a.y0 + scrollY) + 'px;width:' + (a.x1 - a.x0) + 'px;height:' + (a.y1 - a.y0) + 'px'
    const tag = document.createElement('div')
    tag.textContent = '展品占封面 ' + (out.exhibit.share * 100).toFixed(0) + '% · 被展签压 ' + (out.exhibit.overlap * 100).toFixed(0) + '%'
    tag.style.cssText = 'position:absolute;z-index:100;right:' + (document.body.clientWidth - a.x + 8) + 'px;top:' + (a.y + 8) + 'px;background:#FF3BD4;color:#fff;font:600 22px/1.4 -apple-system;padding:2px 10px;border-radius:6px'
    document.body.appendChild(frame); document.body.appendChild(tag)
  }
  const pre = document.createElement('pre'); pre.id = 'hr-metrics'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre)
})`

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root {}
${appCss}
${toCss(indexWxss)}
${listCss}
${cardCss}
${compCss}
body { margin: 0; width: 750px; background: #1A1814; font-family: -apple-system, "PingFang SC", sans-serif; }
.main-scroll { height: auto !important; overflow: visible !important; }
#hr-metrics { display: none; }
/* sensitive-blur-gate 的 :host 在真机上 absolute 铺满父框；预览把它展开成 .sb-wrap，这里复刻那条宿主样式 */
.sb-wrap { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: hidden; }
/* swiper 预览：只画当前（第一）页；image 的 mode 被解析器丢掉，按类名复刻 aspectFill / aspectFit */
.hr-swiper { display: block; overflow: hidden; }
.hr-swiper > div:not(:nth-child(${PAGE + 1})) { display: none; }
img.hr-mode-aspectFill { object-fit: cover; }
img.hr-mode-aspectFit { object-fit: contain; }
img.hr-mode-widthFix { height: auto !important; }
</style></head><body><div class="container"><div class="main-scroll"><div style="height:24px"></div>
${orbHeader}
${recoHtml}
${contextHtml}
</div></div><script>${METRICS_JS}</script></body></html>`

const htmlPath = join(TMP_DIR, `home-reco-${VARIANT}-${SCENE}-${process.pid}.html`)
writeFileSync(htmlPath, html)

/* ── 5. Chrome（串行） ─────────────────────────────────────────────── */
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
function runChrome(args, timeoutMs = 30000) {
  return new Promise((done) => {
    const profile = mkdtempSync(join(tmpdir(), 'hr-chrome-'))
    const child = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
      `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=2500', ...args],
    { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* ignore */ } }, timeoutMs)
    child.on('close', () => { clearTimeout(timer); rmSync(profile, { recursive: true, force: true }); done(out) })
  })
}

const dom = await runChrome(['--window-size=750,1334', '--dump-dom', `file://${htmlPath}`])
const mm = /<pre id="hr-metrics">([\s\S]*?)<\/pre>/.exec(dom)
if (!mm) {
  console.error('✗ 没拿到量测结果（Chrome 可能被沙箱拦了）')
  process.exit(1)
}
const m = JSON.parse(mm[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))

/* ── 6. 判据（只对 after） ─────────────────────────────────────────── */
const problems = []
const COVER_H = VARIANT === 'after' ? loadCjs(LOGIC_JS).COVER_H || 480 : 480
const CARD_H = 578
if (VARIANT === 'after') {
  const content = ['interest', 'wall', 'cold', 'sparse'].includes(SCENE)
  if (m.module && m.module.scrollW > m.module.clientW + 1) problems.push(`推荐区横向溢出（${m.module.scrollW} > ${m.module.clientW}）`)
  if (m.row && m.row.scrollW > m.row.clientW + 1) problems.push(`两列横向溢出（${m.row.scrollW} > ${m.row.clientW}）`)
  if (content) {
    // 每页满员：≥3 件 = 封面 + 两列（末页循环补齐）；2 件 = 两列；1 件 = 只封面（swiper 同步收高）
    const want = { full: [true, 2], row: [false, 2], lead: [true, 0] }[viewMeta.layout] || [true, 2]
    if (!!m.lead !== want[0] || m.cards.length !== want[1]) {
      problems.push(`第 ${PAGE + 1} 页不满员：应为${want[0] ? ' 1 张展柜封面 +' : ''} ${want[1]} 件两列（量到 cover=${!!m.lead} cards=${m.cards.length}；布局 ${viewMeta.layout}）`)
    }
    const pg = viewMeta.page
    const ids = [pg.lead].concat(pg.row).filter(Boolean).map((c) => c._id)
    if (new Set(ids).size !== ids.length) problems.push(`第 ${PAGE + 1} 页内有重复商品：${ids.join(',')}`)
    if (!m.exists['.hr-why']) problems.push('内容态缺「为什么推荐给你」一句')
    if (viewMeta.canSwap && !m.exists['.hr-dots']) problems.push('多页时缺页码点（不知道还能左右滑）')
    m.imgs.forEach((b, i) => {
      const r = b.w ? b.h / b.w : 0
      if (Math.abs(r - 1) > 0.03) problems.push(`两列第 ${i + 1} 张图比例 ${r.toFixed(2)} ≠ 1:1（统一比例被打破）`)
    })
    const ws = m.cards.map((c) => c.w)
    if (ws.length && Math.max(...ws) - Math.min(...ws) > 2) problems.push(`两列不等宽：${ws.join('/')}`)
    const hs = m.titles.map((t) => t.h)
    if (hs.length && (Math.max(...hs) - Math.min(...hs) > 1 || m.titles.some((t) => t.lh && Math.round(t.h / t.lh) !== 2))) {
      problems.push(`两列标题不是「两行定高」：${hs.join('/')}（卡片会高低不齐 / 截得太狠）`)
    }
    m.marks.forEach((c) => {
      if (c.onImage) problems.push(`小字「${c.text}」压在图上（遮挡展品）`)
      else if (c.sw > c.cw + 1) problems.push(`小字「${c.text}」溢出`)
    })
    // 一件事只说一遍：推荐理由只在头部那句里出现
    ;['常看', '依据', '与你所看相近', '同品类推荐', '智能推荐'].forEach((w) => {
      if (m.restText && m.restText.includes(w)) problems.push(`头部之外又出现了推荐理由「${w}」（同一件事说了两遍）`)
    })
    if (!m.swiper) problems.push('缺 swiper（换页没有过渡 / 不能左右滑）')
    else if (m.swiper.content > m.swiper.h + 1) problems.push(`swiper 定高 ${m.swiper.h} < 一页内容 ${m.swiper.content}（底部被裁掉）`)
    else if (m.swiper.h - m.swiper.content > 16) problems.push(`swiper 定高 ${m.swiper.h} 比一页内容 ${m.swiper.content} 多出 ${m.swiper.h - m.swiper.content}（底部空一截）`)
    // 坪效：封面恒高、展品占封面面积 ≥ 50%、展签不压展品（比例自适应分档，见 logic.coverGeo）
    if (m.lead && Math.abs(m.lead.h - COVER_H) > 2) problems.push(`封面高 ${m.lead.h} ≠ ${COVER_H}（随图片比例变高变矮 → 页面跳动）`)
    if (!m.lead) { /* 两件降级：无封面 */ } else if (!m.exhibit) problems.push('封面没量到展品图（图没画出来）')
    else {
      if (m.exhibit.share < 0.5) problems.push(`展品占封面面积 ${(m.exhibit.share * 100).toFixed(1)}% < 50%（空间浪费）`)
      if (m.exhibit.overlap > 0.01) problems.push(`展签压住展品 ${(m.exhibit.overlap * 100).toFixed(1)}%（遮挡主体）`)
    }
  }
  if (SCENE === 'loading') {
    if (!m.skLead || !m.skCard) problems.push('加载态没有骨架')
    else {
      // 真卡几何（interest 场景实测）：封面 = COVER_H、两列卡 ≈ CARD_H；骨架与之差 > 16rpx 就会跳高
      if (Math.abs(m.skLead.h - COVER_H) > 16) problems.push(`骨架封面高 ${m.skLead.h}rpx 与真卡 ${COVER_H}rpx 相差过大（数据到达时跳高）`)
      if (Math.abs(m.skCard.h - CARD_H) > 16) problems.push(`骨架两列卡高 ${m.skCard.h}rpx 与真卡 ${CARD_H}rpx 相差过大（数据到达时跳高）`)
    }
  }
  if (SCENE === 'error' && (!m.exists['.hr-error'] || !m.exists['.hr-retry'])) problems.push('失败态没有可见的重试入口（会退化成静默空白）')
  // 渲染台不执行 bindtap，只能静态确认「看得见的重试」真的绑了点击
  if (SCENE === 'error' && !/class="hr-retry" bindtap="onRetry"/.test(readFileSync(COMP_WXML, 'utf8'))) problems.push('失败态的重试按钮没绑 onRetry（看得见、点不动）')
  if (SCENE === 'empty' && !m.exists['.hr-empty']) problems.push('空态没有兜底文案')
}

if (!CHECK_ONLY) {
  const png = join(TMP_DIR, `home-reco-shot-${process.pid}.png`)
  await runChrome([`--window-size=750,${Math.min(6000, (m.body || 1334) + 20)}`, `--screenshot=${png}`, `file://${htmlPath}`])
  if (existsSync(png)) {
    writeFileSync(OUT, readFileSync(png))
    rmSync(png, { force: true })
    console.log(`截图：${OUT}（${Math.round(statSync(OUT).size / 1024)}KB）`)
  } else console.error('✗ 截图未生成')
}
rmSync(htmlPath, { force: true })

const sw = m.swiper ? `${m.swiper.h}/${m.swiper.content}` : '-'
if (m.exhibit) console.log(`封面展品（${m.leadTier || '-'} 档）：占封面面积 ${(m.exhibit.share * 100).toFixed(1)}% · 被展签覆盖 ${(m.exhibit.overlap * 100).toFixed(1)}% · 原图 h/w ${m.exhibit.natural.toFixed(2)} → 显示 ${m.exhibit.shown.toFixed(2)}`)
console.log(`首页为你推荐预览（${VARIANT} / ${SCENE}）：封面高 ${m.lead ? m.lead.h : '-'} · 两列高 ${m.row ? m.row.h : '-'} · swiper 定高/内容 ${sw} · 卡 ${(m.cards || []).length} · 小字 ${(m.marks || []).map((c) => c.text).join('、') || '无'} · 页高 ${m.body}`)
if (problems.length) {
  console.error(`✗ 版式不变量违反 ${problems.length} 处：`)
  problems.forEach((p) => console.error('  - ' + p))
  process.exit(1)
}
if (VARIANT === 'after') console.log('✓ 版式不变量通过（溢出 / 封面+两列 / 封面恒高 · 展品占比 ≥ 50% · 展签不压展品 / 1:1 等宽 / 标题两行定高 / 图上无小字 / 理由只说一遍 / swiper 不裁不空 / 骨架不跳高 / 失败可重试）')
