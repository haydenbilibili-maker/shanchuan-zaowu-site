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
      { _id: 'all', shortName: '全部' }, { _id: 'c1', shortName: '昆虫' }, { _id: 'c2', shortName: '植物' }, { _id: 'c3', shortName: '海洋' }
    ],
    currentId: 'all', currentSubId: '', subCategories: [], subRowLabel: '',
    filterActiveCount: 0, filterSummary: '', pageError: false, pageErrorMsg: '',
    scrollTop: 0, scrollIntoView: '', fallbackImg: '',
    showSpecimenArchive: true, showContentSection: true,
    contentItems: [{ _id: 'w1', coverImage: pics[0], typeLabel: '物种档案', title: '光明女神闪蝶', latinName: 'Morpho helena' }],
    contentTotal: 12,
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
  atelier: { wxml: 'pages/atelier/index.wxml', wxss: 'pages/atelier/index.wxss' }
}

const scenes = [
  { name: 'home', page: 'home', h: 3600, data: homeData() },
  { name: 'category-all', page: 'category', h: 1700, data: categoryData() },
  {
    name: 'category-filter-empty', page: 'category', h: 1100,
    data: categoryData({ currentId: 'c1', currentSubtitle: 'Kingdom Animalia', filterActiveCount: 2, filterSummary: '玻璃罩 · ¥100–200', orphanProducts: [], orphanTotal: 0, contentItems: [], contentTotal: 0, showContentSection: false })
  },
  { name: 'atelier', page: 'atelier', h: 1500, data: atelierData() }
]

/** 预览里没有组件实现：只包图的壳按透明容器展开，其余自定义组件仍整棵跳过 */
const unwrapGate = (s) => s.replace(/<sensitive-blur-gate\b[^>]*>/g, '<block>').replace(/<\/sensitive-blur-gate>/g, '</block>')

async function shoot(scene) {
  const missing = new Set()
  const page = PAGES[scene.page]
  const wxml = unwrapGate(read(join(MP, page.wxml)).replace(/<wxs[^>]*\/>/g, ''))
  const latin = { display: (s) => s || '' }
  const body = renderWxml(wxml, { latin, ...scene.data }, { lenient: true, onMissing: (k) => missing.add(k) })
  const css = rpx2px(loadWxss(join(MP, 'app.wxss')) + '\n' + loadWxss(join(MP, page.wxss)))
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; width: 750px; background: #1a1814; color: #fff; font-family: -apple-system, "PingFang SC", sans-serif; }
img { object-fit: cover; }
img:not([src]), img[src=""] { visibility: hidden; }
</style><style>${css.replace(/\bpage\s*\{/g, 'body {')}</style><style>
.main-scroll { height: auto !important; position: static !important; overflow: visible !important; }
.page-ency .sticky-header { position: relative !important; }
.floating, .floating-shadow, .slide-up-anim, .blink { animation: none !important; }
</style></head><body>${body}</body></html>`
  const htmlPath = join(tmpdir(), `a-flow-${scene.name}-${process.pid}.html`)
  writeFileSync(htmlPath, html)
  const out = join(outDir, `${scene.name}.png`)
  if (existsSync(out)) rmSync(out)
  const profile = mkdtempSync(join(tmpdir(), 'a-flow-preview-'))
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

for (const s of scenes) if (!only || only.split(',').includes(s.name)) await shoot(s)
