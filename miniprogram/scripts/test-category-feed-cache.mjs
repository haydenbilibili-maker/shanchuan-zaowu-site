/**
 * 馆藏 tab 加载提速守卫（2026-09-29，产品负责人点名：点「馆藏」约 5 秒）
 *
 * 钉住四件会静默退化的事：
 *   A. getEncyclopediaFeed 商品查询只取卡片字段（field 投影）—— 用内存假库**真跑云函数真源**：
 *      按投影裁剪后的出参必须与读整条记录**逐字一致**（漏一个字段 = 馆藏卡静默缺主题名/角标/售罄），
 *      且关联 ID / 档案计数 / 商品计数 / 商品取数必须并发（在途查询峰值 ≥ 3），出参键不变；
 *   B. utils/categoryFeedCache 首屏缓存：只存渲染字段（覆盖馆藏卡 wxml 读到的全部 item.* 字段）、
 *      单 key 体积上限远低于 wx storage 1MB 且超限不写、带版本号、档案开关不一致不复用；
 *   C. 馆藏页首屏先用缓存（onLoad 同步水合 → 后台 silent 刷新不清空不出骨架屏、失败保留旧内容），
 *      只有「全部 + 无筛选第一页」才写缓存，分类树与首屏请求并行、不重复拉；不新增原生弹窗；
 *   D. 首页空闲预取（延迟、单页模式不做）。
 *
 * 用法：node miniprogram/scripts/test-category-feed-cache.mjs [--selftest]
 * 自检注入全部作用于内存副本，不写工作区文件。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const MP = resolve(ROOT, 'miniprogram')
const FILES = {
  feed: 'cloudfunctions/getEncyclopediaFeed/index.js',
  helper: 'utils/categoryFeedCache.js',
  cache: 'utils/cache.js',
  page: 'pages/category/index.js',
  wxml: 'pages/category/index.wxml',
  home: 'pages/index/index.js'
}
const readSrc = () => Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, readFileSync(resolve(MP, f), 'utf8')]))
const nodeRequire = createRequire(import.meta.url)

function loadModule(src, filename, requireMap) {
  const mod = { exports: {} }
  const req = (id) => {
    if (requireMap && id in requireMap) return requireMap[id]
    return nodeRequire(resolve(dirname(filename), id))
  }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', src)(req, mod, mod.exports)
  return mod.exports
}

/* ── 内存假库：记录投影与在途并发，where 不求值（只验字段与并发，不验筛选语义） ── */
function makeFakeCloud(fixtures, stats) {
  const cmd = new Proxy({}, { get: (_, op) => (...args) => ({ $op: op, args }) })
  const delay = () => new Promise((r) => setTimeout(r, 5))
  const track = async (fn) => {
    if (stats.inflight === 0) stats.waves += 1
    stats.inflight += 1
    stats.peak = Math.max(stats.peak, stats.inflight)
    await delay()
    stats.inflight -= 1
    return fn()
  }
  const collection = (name) => {
    const q = { proj: null, skip: 0, limit: 100 }
    const api = {
      where: () => api,
      orderBy: () => api,
      field: (p) => { q.proj = p; return api },
      skip: (n) => { q.skip = n; return api },
      limit: (n) => { q.limit = n; return api },
      count: () => track(() => ({ total: (fixtures[name] || []).length })),
      get: () => track(() => {
        if (name === 'products') stats.productGets.push(q.proj)
        const rows = (fixtures[name] || []).slice(q.skip, q.skip + q.limit).map((doc) => {
          const src = JSON.parse(JSON.stringify(doc))
          if (!q.proj || !stats.applyProjection) return src
          const out = { _id: src._id }
          Object.keys(q.proj).forEach((k) => { if (q.proj[k] && src[k] !== undefined) out[k] = src[k] })
          return out
        })
        return { data: rows }
      })
    }
    return api
  }
  const db = { command: cmd, collection, RegExp: (o) => ({ $regex: o }) }
  return { DYNAMIC_CURRENT_ENV: 'test', init() {}, database: () => db, getTempFileURL: async ({ fileList }) => ({ fileList: fileList.map((f) => ({ fileID: f, tempFileURL: 'https://tmp/' + f.slice(-8) })) }) }
}

const FIXTURES = {
  cms_wikis: [{ _id: 'w1', title: '蓝闪蝶档案', relatedProductIds: ['p9'], category: '昆虫馆', status: 'published', coverImage: 'cloud://env.b/w1.jpg' }],
  products: Array.from({ length: 14 }, (_, i) => ({
    _id: 'p' + i,
    title: i % 2 ? '大蓝闪蝶标本' : '海蓝宝原石',
    themeName: i % 3 ? '蓝色的回声' : '',
    latinName: 'Morpho didius',
    price: 100 + i,
    images: i % 4 ? ['https://x.tcb.qcloud.la/p' + i + '.jpg?imageMogr2/thumbnail/560x>'] : ['cloud://env.b/p' + i + '.png'],
    category: '鳞翅目',
    channel: i % 2 ? 'import' : 'domestic',
    craftType: 'frame',
    craftProcess: 'spread',
    stock: i % 5 ? 3 : 0,
    hasSku: i === 7,
    skus: i === 7 ? [{ stock: 2 }, { stock: '1' }] : [],
    isUnique: i === 1,
    isOneOfAKind: i === 2,
    isTreasure: i === 3,
    protectionType: i === 4 ? 'cites' : undefined,
    sensitiveBlur: i === 5,
    contentWarning: i === 6,
    createTime: 1000 - i,
    description: '一段很长的描述'.repeat(40),
    detailImages: ['cloud://env.b/d1.jpg', 'cloud://env.b/d2.jpg'],
    tags: ['蓝色', '蝴蝶'],
    origin: '秘鲁',
    englishName: 'Blue Morpho'
  }))
}

async function runFeed(src, event, applyProjection) {
  const stats = { inflight: 0, peak: 0, waves: 0, productGets: [], applyProjection }
  const fn = loadModule(src.feed, resolve(MP, FILES.feed), { 'wx-server-sdk': makeFakeCloud(FIXTURES, stats) })
  const out = await fn.main({ ...event })
  return { out, stats }
}

function makeWx() {
  const store = new Map()
  return {
    store,
    getStorageSync: (k) => (store.has(k) ? JSON.parse(store.get(k)) : ''),
    setStorageSync: (k, v) => { store.set(k, JSON.stringify(v)) },
    removeStorageSync: (k) => { store.delete(k) },
    getStorageInfoSync: () => ({ keys: [...store.keys()] })
  }
}

function loadHelper(src) {
  const wx = makeWx()
  globalThis.wx = wx
  const cache = loadModule(src.cache, resolve(MP, FILES.cache))
  const helper = loadModule(src.helper, resolve(MP, FILES.helper), { './cache': cache })
  return { helper, wx, cache }
}

async function runChecks(src) {
  const failures = []
  let passed = 0
  const check = (name, cond, extra) => {
    if (cond) passed += 1
    else failures.push(`${name}${extra ? ' — ' + extra : ''}`)
  }
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  /* ── A. 云函数：投影不丢字段 + 并发 + 出参键不变 ── */
  try {
    for (const [label, ev] of [
      ['首屏（全部/无筛选）', { contentLimit: 0, productLimit: 12 }],
      ['带档案 + 翻页', { contentLimit: 3, productSkip: 2, productLimit: 12 }],
      ['关键词排序', { keyword: '蓝', contentLimit: 0, productLimit: 12 }],
      ['关键词 + 档案', { keyword: '蓝', contentLimit: 3, productLimit: 12 }]
    ]) {
      const full = await runFeed(src, ev, false)
      const proj = await runFeed(src, ev, true)
      check(`★ A1 ${label}：按投影裁剪后出参与读整条逐字一致（漏字段 = 卡片静默缺信息）`,
        JSON.stringify(full.out) === JSON.stringify(proj.out) && full.out.success === true,
        full.out.success ? '出参不一致' : `云函数失败 ${full.out.msg}`)
      // 带档案时 resolveCommerceHint 另有未投影的关联商品查询（本次未改），只在无档案时逐条要求投影
      if (!ev.contentLimit) check(`★ A2 ${label}：商品取数带 field 投影（不读整条记录）`,
        proj.stats.productGets.length > 0 && proj.stats.productGets.every((p) => p && typeof p === 'object' && !p.detailImages && !p.giftScenes))
      if (label.startsWith('首屏')) {
        check('★ A3 首屏查询并发：关联 ID/档案计数/商品计数/商品取数 最多 2 轮串行等待（原 4 轮）',
          proj.stats.waves <= 2 && proj.stats.peak >= 2, `串行轮次 ${proj.stats.waves} 峰值 ${proj.stats.peak}`)
        check('A4 出参键不变（契约）', Object.keys(proj.out).join(',') === 'success,contentItems,orphanProducts,contentTotal,orphanTotal,hasMoreContent,hasMoreProducts',
          Object.keys(proj.out).join(','))
        check('★ A5 首屏含主题名的卡片仍带 themeName', proj.out.orphanProducts.some((p) => p.themeName === '蓝色的回声'))
      }
    }
  } catch (e) {
    check('A 云函数真源可在内存假库上运行', false, e && e.message)
  }
  const feedSrc = strip(src.feed)
  const cardFields = /const PRODUCT_CARD_FIELDS = \[([\s\S]*?)\]/.exec(feedSrc)
  check("★ A6 PRODUCT_CARD_FIELDS 显式含 'themeName'（今日新增字段）", !!cardFields && /'themeName'/.test(cardFields[1]))

  /* ── B. 首屏缓存模块 ── */
  try {
    const { helper, wx } = loadHelper(src)
    const grid = /<view class="product-grid">([\s\S]*?)<view class="empty-(?:filter|tip)" wx:(?:el)?if="\{\{orphanProducts\.length === 0[^"]*\}\}">/.exec(src.wxml)
    const used = grid ? [...new Set([...grid[1].matchAll(/item\.(\w+)/g)].map((m) => m[1]))].filter((k) => k !== 'craftTags') : []
    const need = [...used, 'craftType', 'craftProcess']
    const missing = need.filter((k) => !helper.PRODUCT_KEYS.includes(k))
    check('★ B1 缓存字段覆盖馆藏卡 wxml 读到的全部 item.*（含 themeName）+ 装裱/工艺标签来源', !!grid && used.length >= 6 && missing.length === 0, `缺 ${missing.join(',')}`)
    check('★ B2 单 key 体积上限 ≤ 512KB（wx storage 单 key 1MB）', helper.MAX_BYTES > 0 && helper.MAX_BYTES <= 512 * 1024, `MAX_BYTES=${helper.MAX_BYTES}`)

    const res = await runFeed(src, { contentLimit: 0, productLimit: 12 }, true)
    const withExtra = { ...res.out, orphanProducts: res.out.orphanProducts.map((p) => ({ ...p, description: 'x'.repeat(50) })) }
    check('B3 正常首屏可写入', helper.writeFeed(false, withExtra) === true)
    const hit = helper.readFeed(false)
    check('★ B4 写后可读（首屏秒开），且只存白名单字段（description 等被剔除）',
      !!hit && hit.data.orphanProducts.length === 12 && hit.data.orphanProducts.every((p) => !('description' in p)) && hit.data.orphanProducts.some((p) => p.themeName))
    check('B5 档案开关不一致不复用', helper.readFeed(true) === null)
    const key = 'sc_cache_' + helper.FEED_KEY
    const raw = JSON.parse(wx.store.get(key))
    raw.data.v = (raw.data.v || 0) + 99
    wx.store.set(key, JSON.stringify(raw))
    const { helper: h2, wx: wx2 } = loadHelper(src)
    wx2.store.set(key, JSON.stringify(raw))
    check('★ B6 版本号不一致不复用（缓存结构升级后不读旧数据）', h2.readFeed(false) === null)

    const { helper: h3, wx: wx3 } = loadHelper(src)
    const huge = { success: true, orphanProducts: Array.from({ length: 4000 }, (_, i) => ({ _id: 'h' + i, title: '超长藏品名称'.repeat(10), themeName: '蓝色的回声' })) }
    const wrote = h3.writeFeed(false, huge)
    const bytes = [...wx3.store.values()].reduce((s, v) => s + Buffer.byteLength(v), 0)
    check('★ B7 超过体积上限不写（不会撞 1MB 或挤占他人配额）', wrote === false && bytes < 1024 * 1024, `wrote=${wrote} bytes=${bytes}`)

    const fp = helper.firstScreenParams(false)
    check('B8 首屏参数判定：自身为真，带关键词/翻页/馆别为假',
      helper.isFirstScreenRequest(fp) && helper.isFirstScreenRequest(helper.firstScreenParams(true))
      && !helper.isFirstScreenRequest({ ...fp, keyword: '蝶' }) && !helper.isFirstScreenRequest({ ...fp, productSkip: 12 })
      && !helper.isFirstScreenRequest({ ...fp, parentCategory: '昆虫馆' }) && !helper.isFirstScreenRequest({ ...fp, rootCategoryId: 'r1' }))
    const page = strip(src.page)
    const pl = /_productLimit:\s*(\d+)/.exec(page)
    const cl = /_contentLimit:\s*(\d+)/.exec(page)
    check('★ B9 缓存首屏条数与页面一致（否则缓存永远对不上）',
      pl && cl && Number(pl[1]) === fp.productLimit && Number(cl[1]) === helper.firstScreenParams(true).contentLimit)
    const tree = { categoryRoots: [{ _id: 'r1', name: '昆虫馆', sort: 1, secret: 'x' }], categorySubMap: { r1: [{ _id: 's1', name: '鳞翅目', alias: '蝴蝶', extra: 'y' }] } }
    check('B10 分类树可写可读、只存白名单字段',
      helper.writeTree(tree) && (() => { const t = helper.readTree(); return t && !t.data.categoryRoots[0].secret && t.data.categorySubMap.r1[0].alias === '蝴蝶' })())
  } catch (e) {
    check('B 缓存模块可在假 wx storage 上运行', false, e && e.stack)
  }

  /* ── C. 馆藏页 ── */
  const page = strip(src.page)
  const onLoad = /\n {2}onLoad\(\) \{([\s\S]*?)\n {2}\},/.exec(page)
  const ol = onLoad ? onLoad[1] : ''
  check('★ C1 onLoad：先同步水合缓存，再并行发出分类树与首屏 silent 刷新',
    /this\.hydrateFromCache\(\)/.test(ol) && /this\.loadFeed\(true, \{ silent: true \}\)/.test(ol)
    && ol.indexOf('this.hydrateFromCache()') < ol.lastIndexOf('this.loadCategories()'))
  const hyd = /\n {2}hydrateFromCache\(\) \{([\s\S]*?)\n {2}\},/.exec(page)
  check('C2 水合读分类树与首屏缓存', !!hyd && /feedCache\.readTree\(\)/.test(hyd[1]) && /feedCache\.readFeed\(/.test(hyd[1]) && /this\.applyFeedResult\(/.test(hyd[1]))
  const lf = /\n {2}async loadFeed\(reset = false, opts = \{\}\) \{([\s\S]*?)\n {2}\},/.exec(page)
  const lfb = lf ? lf[1] : ''
  check('★ C3 只有「全部 + 无筛选第一页」才写缓存', /if \(reset && feedCache\.isFirstScreenRequest\(requestData\)\) feedCache\.writeFeed\(/.test(lfb))
  check('★ C4 silent 刷新不清空列表、不出骨架屏', /if \(!silent\) \{\s*this\.setData\(\{\s*listLoading: true,/.test(lfb))
  check('★ C5 silent 刷新失败保留旧内容（不掀整页错误态）', /if \(silent\) \{[\s\S]{0,80}?return;\s*\}\s*const firstScreen/.test(lfb))
  const lc = /\n {2}async loadCategories\(\) \{([\s\S]*?)\n {2}\},/.exec(page)
  check('★ C6 分类树回来后首屏已发出则不重复拉', !!lc && /if \(!this\._feedStarted\) this\.loadFeed\(true\);/.test(lc[1]) && !/\n\s*this\.loadFeed\(true\);/.test(lc[1]))
  check('C7 重试会重置首屏标记（否则重试后不再拉馆藏）', /onRetryLoad\(\) \{[\s\S]*?this\._feedStarted = false;[\s\S]*?this\.loadCategories\(\);/.test(page))
  check('C8 馆藏页不使用原生 wx.showModal', !/wx\.showModal\(/.test(page))
  check('C9 分类树获取走缓存模块（成功即落缓存）', /fetchCategoryTree\(\) \{\s*return feedCache\.fetchTree\(db\);/.test(page))

  /* ── D. 首页空闲预取 ── */
  const home = strip(src.home)
  check('★ D1 首页 onLoad 延迟预取馆藏首屏、单页模式不做',
    /if \(!singlePage\) \{\s*this\._categoryPrefetchTimer = setTimeout\(\(\) => \{[\s\S]*?prefetchFirstScreen\(\)\.catch\(/.test(home))

  return { passed, failures }
}

const INJECTIONS = [
  { name: '投影漏掉 themeName', file: 'feed', from: "'title', 'themeName', 'latinName',", to: "'title', 'latinName'," },
  { name: '投影漏掉 images（封面静默空白）', file: 'feed', from: "'price', 'images', 'category',", to: "'price', 'category'," },
  { name: '首屏商品取数退回读整条记录', file: 'feed', from: '        .field(PRODUCT_CARD_PROJECTION)\n', to: '' },
  {
    name: '商品计数与取数退回串行',
    file: 'feed',
    from: `    const [contentItems, productCountRes, rankedProductRows] = await Promise.all([
      loadContentItems(),
      db.collection('products').where(productWhere).count(),
      loadProductRows()
    ])`,
    to: `    const contentItems = await loadContentItems()
    const productCountRes = await db.collection('products').where(productWhere).count()
    const rankedProductRows = await loadProductRows()`
  },
  { name: '缓存白名单丢 themeName', file: 'helper', from: "'title', 'themeName', 'latinName',", to: "'title', 'latinName'," },
  { name: '体积上限放到 2MB', file: 'helper', from: 'const MAX_BYTES = 256 * 1024;', to: 'const MAX_BYTES = 2048 * 1024;' },
  { name: '写缓存不查体积', file: 'helper', from: 'return len * 3 <= MAX_BYTES && setCache(key, entry, EXPIRY);', to: 'return setCache(key, entry, EXPIRY);' },
  { name: '读缓存不校验版本', file: 'helper', from: 'hit && hit.data && hit.data.v === VERSION ?', to: 'hit && hit.data ?' },
  { name: '缓存首屏条数与页面不一致', file: 'helper', from: 'productSkip: 0, productLimit: 12', to: 'productSkip: 0, productLimit: 20' },
  { name: 'onLoad 不再先读缓存（回到白屏等网络）', file: 'page', from: '    this.hydrateFromCache();\n', to: '' },
  { name: 'silent 刷新仍先清空列表', file: 'page', from: '      if (!silent) {\n        this.setData({', to: '      {\n        this.setData({' },
  { name: '分类树回来后无条件重拉首屏', file: 'page', from: '      if (!this._feedStarted) this.loadFeed(true);\n    } catch', to: '      this.loadFeed(true);\n    } catch' },
  { name: '筛选/翻页结果也写进首屏缓存', file: 'page', from: 'if (reset && feedCache.isFirstScreenRequest(requestData)) feedCache.writeFeed(', to: 'if (reset) feedCache.writeFeed(' },
  { name: '首页去掉空闲预取', file: 'home', from: "require('../../utils/categoryFeedCache').prefetchFirstScreen().catch(() => {});", to: '' }
]

async function main() {
  const src = readSrc()
  if (!process.argv.includes('--selftest')) {
    const { passed, failures } = await runChecks(src)
    if (failures.length) {
      console.log('✗ 馆藏加载提速检查失败：')
      failures.forEach((f) => console.log('  - ' + f))
      console.log(`✗ ${failures.length} 项失败 / ${passed} 项通过`)
      process.exitCode = 1
    } else {
      console.log(`✓ 馆藏加载提速：${passed} 项通过（云函数投影逐字等价 + 并发 / 首屏缓存字段·体积·版本 / 页面 SWR / 首页预取）`)
    }
    return
  }
  const base = await runChecks(src)
  if (base.failures.length) {
    console.log('✗ 自检前置：真源本身未通过，先修源码')
    base.failures.forEach((f) => console.log('  - ' + f))
    process.exitCode = 1
    return
  }
  let bad = 0
  for (const inj of INJECTIONS) {
    const hits = src[inj.file].split(inj.from).length - 1
    if (hits !== 1) {
      console.log(`✗ 锚点失效（命中 ${hits} 次）：${inj.name}`)
      bad += 1
      continue
    }
    const r = await runChecks({ ...src, [inj.file]: src[inj.file].replace(inj.from, inj.to) })
    if (r.failures.length) console.log(`  ✓ 已检出：${inj.name}`)
    else {
      console.log(`✗ 注入回归未被检出：${inj.name}`)
      bad += 1
    }
  }
  if (bad) {
    console.log(`✗ 自检失败：${bad} 项`)
    process.exitCode = 1
  } else {
    console.log(`✓ 自检通过：${INJECTIONS.length} 条注入全部被检出（内存副本，未写工作区）`)
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => process.exit())
