#!/usr/bin/env node
/**
 * C 端浏览与发现动线（A 流）离线预览：首页 / 馆藏 / 标本工坊（开发工具，**不在 check:admin 里**：需要本机 Chrome）
 *
 * 结构与样式**从真源码现读**（wxml-preview 渲染器，自定义组件整棵跳过；`sensitive-blur-gate` 只是包图的壳，按透明容器展开）；
 * `--rev <git 提交>` 改读该提交的同名文件，用来出「改前」图。无头 Chrome 以 750px 视口截图（rpx 1:1 当 px）。
 * 只能证明「结构 / 层级 / 文案对」，证明不了真机 rpx 精度与原生组件行为（错题本 E8 / E26）。
 *
 * 用法：
 *   node miniprogram/scripts/render-a-flow-preview.mjs --out-dir <目录> [--rev HEAD] [--only home,category-all]
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWxml } from './lib/wxml-preview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const MP = join(ROOT, 'miniprogram')

const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const outDir = resolve(argOf('--out-dir', join(tmpdir(), 'a-flow-preview')))
const rev = argOf('--rev', '')
const only = argOf('--only', '')
// --measure：不截图，在真实 Chrome 里量出所有「直接带字」元素的计算色与最近不透明祖先底的对比度（同 report:colors --verify 的算法）
const measure = argv.includes('--measure')
const MEASURE_JS = `(() => {
  const parse = (s) => (String(s).match(/[\\d.]+/g) || []).map(Number)
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const rows = []
  for (const el of document.body.querySelectorAll('*')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('')
    if (!own || !el.getClientRects().length) continue
    const cs = getComputedStyle(el)
    const layers = []
    for (let p = el; p; p = p.parentElement) {
      const c = parse(getComputedStyle(p).backgroundColor)
      const al = c.length > 3 ? c[3] : 1
      if (al > 0) layers.push([c[0], c[1], c[2], al])
      if (al >= 1) break
    }
    let b = [26, 24, 20]
    for (const [r, g, bl, al] of layers.reverse()) b = [r * al + b[0] * (1 - al), g * al + b[1] * (1 - al), bl * al + b[2] * (1 - al)]
    const fc = parse(cs.color), fa = fc.length > 3 ? fc[3] : 1
    const a = [0, 1, 2].map((i) => fc[i] * fa + b[i] * (1 - fa))
    const bg = 'rgb(' + b.map(Math.round).join(', ') + ')'
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    rows.push({ cls: String(el.className || el.tagName).slice(0, 60), text: own.slice(0, 16), color: cs.color, bg, ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, fs: cs.fontSize })
  }
  const pre = document.createElement('pre'); pre.id = '__m'; pre.textContent = JSON.stringify(rows); document.body.appendChild(pre)
})()`
mkdirSync(outDir, { recursive: true })

function read(abs) {
  if (!rev) return readFileSync(abs, 'utf8')
  const r = spawnSync('git', ['show', `${rev}:${relative(ROOT, abs)}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  if (r.status !== 0) throw new Error(`git show ${rev}:${relative(ROOT, abs)} 失败`)
  return r.stdout
}

const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean).find((p) => existsSync(p))
if (!chrome) {
  console.error('✗ 未找到 Chrome（可用 CHROME_PATH 指定）——预览工具，不参与守卫')
  process.exit(1)
}

const rpx2px = (t) => t.replace(/(-?\d*\.?\d+)rpx/g, '$1px')

function loadWxss(file, seen = new Set()) {
  if (seen.has(file)) return ''
  seen.add(file)
  return read(file).replace(/@import\s+['"]([^'"]+)['"];?/g, (_, rel) => {
    const p = rel.startsWith('/') ? join(MP, rel) : resolve(dirname(file), rel)
    return existsSync(p) ? loadWxss(p, seen) : ''
  })
}

const IMG = (name) => `file://${join(ROOT, 'public/images/price-list', name)}`
const pics = [
  'blue-morpho-dome-single.jpg', 'blood-ripple-butterfly-dome.jpg', 'blue-morpho-wood-frame.jpg',
  'dandelion-glass-dome.jpg', 'domestic-mixed-butterfly-frame-01.jpg', 'butterfly-plant-combo-frame-01.jpg'
].map(IMG)

const products = [
  { _id: 'p1', title: '光明女神闪蝶 · 玻璃罩', latinName: 'Morpho helena', price: 388, displayImage: pics[0], image: pics[0], themeName: '晨雾', craftTags: [{ key: 'dome', label: '玻璃罩' }] },
  { _id: 'p2', title: '红锯蛱蝶单只穹顶摆件（长标题测试截断是否两行内收住）', latinName: 'Cethosia biblis', price: 168, displayImage: pics[1], image: pics[1], craftTags: [{ key: 'dome', label: '穹顶' }, { key: 'hand', label: '手作' }] },
  { _id: 'p3', title: '大蓝闪蝶 · 原木框', latinName: 'Morpho didius', price: 520, displayImage: pics[2], image: pics[2], soldOut: true },
  { _id: 'p4', title: '蒲公英玻璃球', latinName: '', price: 98, displayImage: pics[3], image: pics[3], craftTags: [] }
]

function homeData(extra = {}) {
  return {
    isSinglePage: false, navTop: 44, isScrolled: false, pageError: false, pageErrorMsg: '',
    showBanners: true, showLive: false, liveSession: null, loadingBanners: false, heroAutoplay: false,
    currentBannerIndex: 0,
    banners: [
      { id: 'b1', image: pics[0], title: '秋分 · 闪蝶新到馆', subtitle: '', badge: '' },
      { id: 'b2', image: pics[2], title: '原木框系列', subtitle: '一框一景' }
    ],
    showMaShangYou: true, wishWallWishes: [],
    showCategories: true,
    categories: [
      { _id: 'c1', icon: '蝶', displayName: '昆虫', enName: 'INSECTA' },
      { _id: 'c2', icon: '叶', displayName: '植物', enName: 'PLANTAE' },
      { _id: 'c3', icon: '贝', displayName: '海洋', enName: 'MARINE' },
      { _id: 'c4', icon: '石', displayName: '矿物', enName: 'MINERAL' }
    ],
    currentOrbId: '', orbExpanded: false, orbLoading: false, orbProducts: [], orbLoadingMore: false,
    showRecommendations: true, showNewArrivals: true,
    atelierHeroImage: pics[4], workshopStoreName: '星宸标本工作室', showSpecimenCustom: true, showPetMemorial: true,
    showCollections: true, loadingCollections: false,
    collections: [
      { _id: 'e1', cover: pics[5], title: '山野之春', brief: '' },
      { _id: 'e2', cover: pics[3], title: '海的记忆', brief: '贝壳与珊瑚的十二种形状' }
    ],
    showFramers: true, loadingFramers: false,
    framers: [{ _id: 'f1', avatar: pics[1], name: '林一', title: '昆虫标本师' }, { _id: 'f2', avatar: pics[0], name: '周舟', title: '植物压花' }],
    showActivities: true,
    activities: [{ _id: 'a1', day: '03', month: 'OCT', status: 'open', cover: pics[2], title: '海洋标本制作体验课', location: '星宸标本工作室', price: 200 }],
    ...extra
  }
}

function categoryData(extra = {}) {
  return {
    statusBarHeight: 44, headerHeight: 250, listLoading: false, currentSubtitle: '全部品类', keyword: '',
    showAiIdentify: true, showSpecimenCustom: true,
    categories: [
      // 2026-10-19：按线上真实八个馆（含长名），看得出一行横滑与右侧渐隐
      { _id: 'all', shortName: '全部' }, { _id: 'c1', shortName: '蝴蝶昆虫馆' }, { _id: 'c2', shortName: '首饰馆' }, { _id: 'c3', shortName: '植物馆' },
      { _id: 'c4', shortName: '动物馆' }, { _id: 'c5', shortName: '海洋馆' }, { _id: 'c6', shortName: '矿石馆' }, { _id: 'c7', shortName: '衍生品' }
    ],
    currentId: 'all', currentSubId: '', subCategories: [], subRowLabel: '',
    filterActiveCount: 0, filterSummary: '', pageError: false, pageErrorMsg: '',
    scrollTop: 0, scrollIntoView: '', fallbackImg: '',
    showSpecimenArchive: true, showContentSection: true,
    contentItems: [{ _id: 'w1', coverImage: pics[0], typeLabel: '物种档案', title: '光明女神闪蝶', latinName: 'Morpho helena' }],
    contentTotal: 12, archiveIndex: 3, hallIntoView: '',
    orphanProducts: products, orphanTotal: 4,
    loadingMore: false, hasMoreContent: false, hasMoreProducts: false,
    filterPanelVisible: false, filterRootName: '', filterCategoryOptions: [], appliedFilters: {},
    ...extra
  }
}

/** 工坊四格文案从真 FEATURES 现读（key / overline / title / desc / highlight），不手抄 */
function atelierTiles() {
  const src = read(join(MP, 'pages/atelier/index.js'))
  const body = src.slice(src.indexOf('const FEATURES = ['), src.indexOf('\n]', src.indexOf('const FEATURES = [')))
  return body.split(/\n  \{/).slice(1).map((blk) => {
    const pick = (k) => (new RegExp(`${k}: '([^']*)'`).exec(blk) || [])[1] || ''
    return { key: pick('key'), overline: pick('overline'), title: pick('title'), desc: pick('desc'), highlight: /highlight: true/.test(blk) }
  })
}

function atelierData(extra = {}) {
  return {
    heroImage: pics[4],
    introText: '四条路径，都从一件真实的标本开始。',
    tiles: atelierTiles(),
    showPetMemorial: true, showSpecimenCustom: true, workshopStoreName: '星宸标本工作室',
    ...extra
  }
}

const PAGES = {
  home: { wxml: 'pages/index/index.wxml', wxss: 'pages/index/index.wxss' },
  category: { wxml: 'pages/category/index.wxml', wxss: 'pages/category/index.wxss' },
  atelier: { wxml: 'pages/atelier/index.wxml', wxss: 'pages/atelier/index.wxss' },
  identify: { wxml: 'subpackages/feature/identify/index.wxml', wxss: 'subpackages/feature/identify/index.wxss' },
  wiki: { wxml: 'subpackages/content/collection-detail/index.wxml', wxss: 'subpackages/content/collection-detail/index.wxss' },
  detail: { wxml: 'subpackages/feature/detail/index.wxml', wxss: 'subpackages/feature/detail/index.wxss' }
}

const scenes = [
  { name: 'home', page: 'home', h: 3600, data: homeData() },
  { name: 'category-all', page: 'category', h: 1700, data: categoryData() },
  {
    name: 'category-filter-empty', page: 'category', h: 1100,
    data: categoryData({ currentId: 'c1', currentSubtitle: 'Kingdom Animalia', filterActiveCount: 2, filterSummary: '玻璃罩 · ¥100–200', orphanProducts: [], orphanTotal: 0, contentItems: [], contentTotal: 0, showContentSection: false })
  },
  { name: 'atelier', page: 'atelier', h: 1500, data: atelierData() },
  { name: 'identify-loading', page: 'identify', h: 1334, data: { busy: true, loadingText: '正在归档这件标本…', loadingStep: 2, uploadProgress: 62, recentList: [] } },
  // 2026-10-17 鉴定台重构：空闲态（取景框 / 门类 / 三步 / 最近鉴定 / 建议）
  { name: 'identify-idle', page: 'identify', h: 2600, data: { busy: false, categoryHint: '昆虫',
    categoryHints: [{ id: '', label: '不限' }, { id: '昆虫', label: '昆虫' }, { id: '矿石', label: '矿石' }, { id: '植物', label: '植物' }, { id: '海洋', label: '海洋' }, { id: '动物', label: '动物' }, { id: '衍生品', label: '衍生品' }],
    flowSteps: [{ k: '入镜', v: '拍一张或选一张' }, { k: '归档', v: '照片存入你的鉴定记录' }, { k: '解读', v: '约 15–60 秒，给出物种与手记' }],
    photoTips: [{ k: '正对', v: '正对藏品主体，避免倾斜过大' }, { k: '柔光', v: '均匀柔光，减少玻璃罩与强反光' }, { k: '占满', v: '看翅脉或纹理时，让主体占满画面再拍' }, { k: '简洁', v: '背景简洁，主体占画面六成以上' }],
    recentList: [{ _id: 'r1', name: '大蓝闪蝶', latin: 'Morpho menelaus', thumb: '', timeText: '12 分钟前' }, { _id: 'r2', name: '紫水晶', latin: 'Amethyst', thumb: '', timeText: '10/14' }] } },
  {
    name: 'collection-detail', page: 'wiki', h: 1700,
    data: {
      isLoading: false, loadError: false, galleryImages: [pics[0], pics[1], pics[2]],
      wiki: { _id: 'w1', cn_name: '枯叶蛱蝶', latin_name: 'Kallima inachus', main_image: pics[0], tags: ['鳞翅目', '拟态'], stats: { views: 0, likes: 0 } },
      relatedProducts: [{ _id: 'p1', title: '枯叶蛱蝶 · 玻璃罩标本', price: 168, image: pics[1] }, { _id: 'p2', title: '蛱蝶三联框', price: 398, image: pics[2] }]
    }
  },
  {
    name: 'detail-sku', page: 'detail', h: 1334,
    data: {
      productId: 'p1', loadError: false, commerceReady: true, showSkuSheet: true, hasSku: true, displayPrice: '168', displayStock: 6, specSummary: '玻璃罩 · 小号',
      shippingHint: '满 199 包邮', buyCount: 1, skuConfirmText: '加入购物车', selectedSkuId: 's1', imgView: {},
      product: { _id: 'p1', images: [pics[1]], skus: [{ id: 's1', specLabel: '玻璃罩 · 小号', stock: 6 }, { id: 's2', specLabel: '玻璃罩 · 大号', stock: 0 }, { id: 's3', specLabel: '实木框', stock: 2 }] },
      selectedSku: { image: pics[1] }
    }
  }
]

/**
 * 规格画廊三种比例（横 3:2 / 竖 9:16 / 方 1:1）：只渲染详情页「多规格」片段（fragment），image 的 mode 按真机语义映射
 * （aspectFill→cover / aspectFit→contain / widthFix→高随宽）；页面 JS 定义了 SPEC_RATIO_MIN/MAX 时，
 * 注入脚本按同一公式模拟 bindload 定高（取图片原始宽高 × 容器宽，夹在区间内）。
 */
const SPEC = (name) => `file://${join(ROOT, '.tmp/a-flow/spec-imgs', name)}`
const specScene = (name, img) => ({
  name, page: 'detail', h: 1250, fragment: ['<!-- 多规格：', '<!-- 单规格'],
  data: {
    detailGalleryMode: 'sku', imgView: {}, imgThumbView: {},
    detailImageGroups: [{ id: 'g', label: '绿色系' }, { id: 'p', label: '紫色系' }], activeDetailGroupId: 'p', activeDetailGroupLabel: '紫色系',
    activeDetailImages: [img], activeDetailSlide: 0, selectedSkuSizeText: '',
    sharedDetailImages: [SPEC('landscape-3x2.jpg'), SPEC('portrait-9x16.jpg'), SPEC('square-1x1.jpg')]
  }
})
scenes.push(specScene('spec-landscape', SPEC('landscape-3x2.jpg')), specScene('spec-portrait', SPEC('portrait-9x16.jpg')), specScene('spec-square', SPEC('square-1x1.jpg')))

function specEmulation() {
  const js = read(join(MP, 'subpackages/feature/detail/index.js'))
  const lo = (/const SPEC_RATIO_MIN = ([\d.]+)/.exec(js) || [])[1]
  const hi = (/const SPEC_RATIO_MAX = ([\d.]+)/.exec(js) || [])[1]
  if (!lo || !hi) return ''
  return `<script>(() => {
    const sw = document.querySelector('.detail-spec-swiper'); const img = sw && sw.querySelector('img')
    if (!img) return
    const fit = () => { const r = img.naturalHeight / img.naturalWidth; const h = Math.round(sw.getBoundingClientRect().width * Math.min(${hi}, Math.max(${lo}, r)))
      sw.style.height = h + 'px'; sw.classList.remove('is-loading'); if (r > ${hi} || r < ${lo}) img.setAttribute('aria-mode', 'aspectFit') }
    img.complete && img.naturalWidth ? fit() : img.addEventListener('load', fit)
  })()</script>`
}

/** 预览里没有组件实现：只包图的壳按透明容器展开，其余自定义组件仍整棵跳过 */
const unwrapGate = (s) => s.replace(/<sensitive-blur-gate\b[^>]*>/g, '<block>').replace(/<\/sensitive-blur-gate>/g, '</block>')

async function shoot(scene) {
  const missing = new Set()
  // ⚠️ 2026-10-17：替换裸 page 选择器不能写 \bpage —— `.page {` 的 page 前也是词边界，会把页面根类 .page 改成 .body（页面内边距整个丢失）；与 render-core-flows-preview 同一修法
  const page = PAGES[scene.page]
  let wxml = unwrapGate(read(join(MP, page.wxml)).replace(/<wxs[^>]*\/>/g, '').replace(/<wxs\b[^>]*>[\s\S]*?<\/wxs>/g, ''))
  if (scene.fragment) {
    const [from, to] = scene.fragment
    wxml = `<view style="padding: 32rpx;"><view class="detail-content">${wxml.slice(wxml.indexOf(from), wxml.indexOf(to))}</view></view>`.replace(/\bmode="/g, 'aria-mode="')
  }
  const latin = { display: (s) => s || '' }
  const body = renderWxml(wxml, { latin, ...scene.data }, { lenient: true, onMissing: (k) => missing.add(k) })
  const css = rpx2px(loadWxss(join(MP, 'app.wxss')) + '\n' + loadWxss(join(MP, page.wxss)))
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; width: 750px; background: #1a1814; color: #fff; font-family: -apple-system, "PingFang SC", sans-serif; }
img { object-fit: cover; }
img:not([src]), img[src=""] { visibility: hidden; }
</style><style>${css.replace(/(^|[\s,}>+~(])page(?=\s*\{)/g, '$1body')}</style><style>
.main-scroll { height: auto !important; position: static !important; overflow: visible !important; }
.page-ency .sticky-header { position: relative !important; }
.floating, .floating-shadow, .slide-up-anim, .blink { animation: none !important; }
${scene.fragment ? `img[aria-mode="aspectFill"] { object-fit: cover; } img[aria-mode="aspectFit"] { object-fit: contain; } img[aria-mode="widthFix"] { height: auto !important; }
.detail-spec-swiper { position: relative; } .detail-spec-swiper > div:not(:first-child) { display: none; } .detail-spec-swiper > div { height: 100%; }` : ''}
</style></head><body>${body}${measure ? `<script>${MEASURE_JS}</script>` : ''}${scene.fragment ? specEmulation() : ''}</body></html>`
  const htmlPath = join(tmpdir(), `a-flow-${scene.name}-${process.pid}.html`)
  writeFileSync(htmlPath, html)
  const out = join(outDir, `${scene.name}.png`)
  if (existsSync(out)) rmSync(out)
  const profile = mkdtempSync(join(tmpdir(), 'a-flow-preview-'))
  if (measure) {
    const r = spawnSync(chrome, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
      `--user-data-dir=${profile}`, '--virtual-time-budget=3000', `--window-size=750,${scene.h}`, '--dump-dom', `file://${htmlPath}`
    ], { encoding: 'utf8', maxBuffer: 1 << 27, timeout: 120000 })
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
    try { rmSync(htmlPath, { force: true }) } catch { /* ignore */ }
    const m = /<pre id="__m">([\s\S]*?)<\/pre>/.exec(r.stdout || '')
    const rows = m ? JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')) : []
    writeFileSync(join(outDir, `${scene.name}.measure.json`), JSON.stringify(rows, null, 1))
    console.log(`✓ ${scene.name} 实测 ${rows.length} 个带字元素 → ${join(outDir, `${scene.name}.measure.json`)}`)
    return
  }
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=3000',
    `--window-size=750,${scene.h}`, `--screenshot=${out}`, `file://${htmlPath}`
  ], { stdio: 'ignore' })
  const deadline = Date.now() + 120000
  let lastSize = -1
  while (Date.now() < deadline) {
    const size = existsSync(out) ? statSync(out).size : 0
    if (size > 1000 && size === lastSize) break
    lastSize = size
    await new Promise((r) => setTimeout(r, 400))
  }
  try { child.kill('SIGKILL') } catch { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  try { rmSync(htmlPath, { force: true }) } catch { /* ignore */ }
  if (!existsSync(out)) throw new Error(`截图未生成：${scene.name}`)
  console.log(`✓ ${scene.name} → ${out}${missing.size ? `（缺字段按空渲染 ${missing.size} 个：${[...missing].slice(0, 6).join(' / ')}）` : ''}`)
}

/**
 * --devices：首页按真机尺寸逐机型出图 + 量布局（第 5 轮「页面恰好一屏」）
 * 视口 = 机型逻辑分辨率，rpx 按 宽/750 换算，env(safe-area-inset-*) 换成机型值，navTop 取胶囊 top（状态栏 + 4），
 * 叠上真 custom-tab-bar 与微信原生状态栏 / 胶囊示意；main-scroll 保持真实高度（不展开）。
 * 量：文档可滚高度 − 视口（>0 即整页还能被拖动）、滚动区底 vs 底栏顶、头部胶囊 vs 微信胶囊是否相交；
 * 截图为未滚动的首屏（headless --screenshot 按文档坐标截取，整页滚动后 fixed 元素会错位，故不滚）。
 */
const DEVICES = [
  { name: 'iphone-se', label: 'iPhone SE（无刘海）', w: 375, h: 667, top: 20, bottom: 0 },
  { name: 'iphone-8plus', label: 'iPhone 8 Plus（无刘海大屏）', w: 414, h: 736, top: 20, bottom: 0 },
  { name: 'iphone-13-14', label: 'iPhone 13 / 14（刘海）', w: 390, h: 844, top: 47, bottom: 34 },
  { name: 'iphone-pro-max', label: 'iPhone 14 Pro Max（灵动岛）', w: 430, h: 932, top: 59, bottom: 34 }
]
const DEVICE_JS = `(() => {
  const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null }
  const de = document.scrollingElement
  const out = { viewport: innerHeight, docHeight: de.scrollHeight, overflow: de.scrollHeight - innerHeight }
  const ms = r('.main-scroll'), tb = r('.tab-bar'), hc = r('.header-capsule'), wc = r('#__wxcap')
  out.scrollTop = ms && Math.round(ms.top); out.scrollBottom = ms && Math.round(ms.bottom); out.tabTop = tb && Math.round(tb.top)
  out.scrollTabGap = ms && tb ? Math.round(tb.top - ms.bottom) : null
  out.capsuleOverlap = hc && wc ? !(hc.right <= wc.left || hc.bottom <= wc.top || hc.top >= wc.bottom) : null
  const sc = document.querySelector('.main-scroll'); out.scrollable = sc ? sc.scrollHeight > sc.clientHeight : null
  const pre = document.createElement('pre'); pre.id = '__m'; pre.style.display = 'none'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre)
})()`

function tabBarHtml(px) {
  const js = read(join(MP, 'custom-tab-bar/index.js'))
  const lit = js.slice(js.indexOf('list: [') + 6, js.indexOf('\n    ]', js.indexOf('list: [')) + 6)
  const list = Function(`return ${lit}`)().map((it) => ({
    ...it, iconPath: `file://${join(MP, it.iconPath)}`, selectedIconPath: `file://${join(MP, it.selectedIconPath)}`
  }))
  const wxml = read(join(MP, 'custom-tab-bar/index.wxml'))
  const html = renderWxml(wxml, { list, selected: 0, hidden: false, color: '#8A857C', selectedColor: '#C4A76C', showCartBadge: false }, { lenient: true })
  return { html, css: px(loadWxss(join(MP, 'custom-tab-bar/index.wxss'))) }
}

async function shootDevices() {
  const page = PAGES.home
  const wxml = unwrapGate(read(join(MP, page.wxml)).replace(/<wxs[^>]*\/>/g, '').replace(/<wxs\b[^>]*>[\s\S]*?<\/wxs>/g, ''))
  const summary = []
  for (const d of DEVICES) {
    const k = d.w / 750
    const navTop = d.top + 4
    const px = (t) => t.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => `${+(n * k).toFixed(3)}px`)
      .replace(/(?:env|constant)\(safe-area-inset-bottom\)/g, `${d.bottom}px`).replace(/(?:env|constant)\(safe-area-inset-top\)/g, `${d.top}px`)
    const body = renderWxml(wxml, { latin: { display: (s) => s || '' }, ...homeData({ navTop }) }, { lenient: true })
    const tab = tabBarHtml(px)
    const css = px(loadWxss(join(MP, 'app.wxss')) + '\n' + loadWxss(join(MP, page.wxss)))
    const base = (script) => `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; width: ${d.w}px; background: #1a1814; color: #fff; font-family: -apple-system, "PingFang SC", sans-serif; }
img { object-fit: cover; } img:not([src]), img[src=""] { visibility: hidden; }
</style><style>${css.replace(/(^|[\s,}>+~(])page(?=\s*\{)/g, '$1body')}</style><style>${tab.css}</style><style>
.main-scroll { overflow-y: auto; } .main-scroll::-webkit-scrollbar { display: none; }
.floating, .floating-shadow, .slide-up-anim, .blink { animation: none !important; }
#__wxbar { position: fixed; top: 0; left: 0; right: 0; height: ${d.top}px; z-index: 10001; font: 600 14px -apple-system; display: flex; align-items: center; padding-left: 24px; }
#__wxcap { position: fixed; right: 7px; top: ${navTop}px; width: 87px; height: 32px; border-radius: 16px; border: 1px solid rgba(255,255,255,.25); background: rgba(0,0,0,.3); z-index: 10001; box-sizing: border-box; }
#__home { position: fixed; left: 50%; bottom: 8px; width: 134px; height: 5px; margin-left: -67px; border-radius: 3px; background: #fff; z-index: 10002; display: ${d.bottom ? 'block' : 'none'}; }
</style></head><body>${body}${tab.html}<div id="__wxbar">9:41</div><div id="__wxcap"></div><div id="__home"></div><script>${script}</script></body></html>`
    const htmlPath = join(tmpdir(), `a-flow-dev-${d.name}-${process.pid}.html`)
    writeFileSync(htmlPath, base(DEVICE_JS))
    const flags = ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=3000', `--window-size=${d.w},${d.h}`]
    const p1 = mkdtempSync(join(tmpdir(), 'a-flow-preview-'))
    const r = spawnSync(chrome, [...flags, `--user-data-dir=${p1}`, '--dump-dom', `file://${htmlPath}`], { encoding: 'utf8', maxBuffer: 1 << 27, timeout: 120000 })
    try { rmSync(p1, { recursive: true, force: true }) } catch { /* ignore */ }
    const m = /<pre id="__m"[^>]*>([\s\S]*?)<\/pre>/.exec(r.stdout || '')
    const res = m ? JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')) : { error: 'no measure' }
    summary.push({ device: d.label, size: `${d.w}×${d.h}`, safeTop: d.top, safeBottom: d.bottom, navTop, ...res })
    const out = join(outDir, `home-${d.name}.png`)
    if (existsSync(out)) rmSync(out)
    const p2 = mkdtempSync(join(tmpdir(), 'a-flow-preview-'))
    writeFileSync(htmlPath, base(''))
    const child = spawn(chrome, [...flags, `--user-data-dir=${p2}`, `--screenshot=${out}`, `file://${htmlPath}`], { stdio: 'ignore' })
    const deadline = Date.now() + 120000
    let last = -1
    while (Date.now() < deadline) {
      const size = existsSync(out) ? statSync(out).size : 0
      if (size > 1000 && size === last) break
      last = size
      await new Promise((ok) => setTimeout(ok, 400))
    }
    try { child.kill('SIGKILL') } catch { /* ignore */ }
    try { rmSync(p2, { recursive: true, force: true }) } catch { /* ignore */ }
    try { rmSync(htmlPath, { force: true }) } catch { /* ignore */ }
    console.log(`✓ ${d.label} 文档超出视口 ${res.overflow}px · 滚动区底→底栏顶 ${res.scrollTabGap}px · 胶囊相交 ${res.capsuleOverlap} → ${out}`)
  }
  writeFileSync(join(outDir, 'home-devices.json'), JSON.stringify(summary, null, 1))
}

if (argv.includes('--devices')) await shootDevices()
else for (const s of scenes) if (!only || only.split(',').includes(s.name)) await shoot(s)
