#!/usr/bin/env node
/**
 * 首页「为你推荐」守卫（home 域；2026-09-27 全面升级配套）
 *
 * 钉住四类容易静默失效的事（口径见 miniprogram/docs/首页为你推荐_全面升级_2026-09-27.md）：
 *   ① 理由诚实：冷启动不许冒充个性化；卡上小字不许回落成「同品类推荐 / 智能推荐 / 为你推荐」这类空话；
 *      推荐理由只在头部说一次（卡上只标孤品 / 新藏 / 来自祈福墙这类事实）；头部只提**本页真的出现的**命中标签；
 *      祈运件只有显式打了祈运标签才写「· 求财」（场景兜底的不许）；祈福墙信号只认近 14 天、且与玩法留档同一个存储键；
 *   ② 展示正确：多规格最低价 +「起」、无价不写 ¥0；祈运件插在每页第 3 位、与服务端推荐去重；左右滑换页；
 *   ③ 三态：失败原位可重试（不许退化成模块消失）、骨架、空态；首页不残留旧推荐 WXML/WXSS；
 *   ④ 契约不动：getRecommendations 只传 { limit }；getBlessProducts 只用既有入参；
 *      点击交给页面 goToDetail 时带上 category/tags（否则服务端兴趣标签学不到推荐带来的浏览）。
 *
 * 用法：
 *   node miniprogram/scripts/test-home-reco.mjs
 *   node miniprogram/scripts/test-home-reco.mjs --selftest   （注入只写临时副本，真源码只读）
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const rootIdx = argv.indexOf('--root')
const MP = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : resolve(HERE, '..')

/** 自检副本需要的文件（相对 miniprogram/） */
const FILES = [
  'components/HomeReco/logic.js',
  'components/HomeReco/index.js',
  'components/HomeReco/index.wxml',
  'components/HomeReco/index.wxss',
  'components/HomeReco/index.json',
  'pages/index/index.wxml',
  'pages/index/index.wxss',
  'pages/index/index.json',
  'utils/productStats.js',
  'utils/latinDisplay.js',
  'utils/sensitiveBlur.js',
  'subpackages/plays/utils/ritualPlayArchive.js'
]

if (argv.includes('--selftest')) selftest()

const read = (rel) => readFileSync(join(MP, rel), 'utf8')
let passed = 0
const failures = []
function t(name, fn) {
  let ok = false
  let err = ''
  try { ok = fn() === true } catch (e) { err = e.message }
  if (ok) passed += 1
  else failures.push(err ? `${name}（${err}）` : name)
}

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

const logic = loadCjs(join(MP, 'components/HomeReco/logic.js'))
const EMPTY_WORDS = ['同品类推荐', '智能推荐', '为你推荐', '相近标签', '同好', '大家都在']
const row = (id, extra) => Object.assign({ _id: id, title: `藏品${id}`, price: 100, images: [`cloud://x/${id}.jpg`] }, extra || {})
const cardsOf = (view) => (view.pages || []).reduce((a, p) => a.concat([p.lead].concat(p.row).filter(Boolean)), [])
const markTexts = (view) => cardsOf(view).map((c) => (c.mark ? c.mark.text : ''))
const allTexts = (view) => [view.whyText].concat(markTexts(view))
const REASON_WORDS = ['常看', '相近', '依据', '推荐']

/* ① 理由诚实 */
t('冷启动：头部说「还在认识你」，不冒充个性化', () => {
  const pool = logic.buildPool([row('a', { reason: '同品类推荐', category: '蝴蝶' }), row('b', { reason: '为你推荐' })], [], {})
  const v = logic.buildView({ phase: 'ready', pool, signals: {} })
  return v.whyMode === 'cold' && /还在认识你/.test(v.whyText)
})
t('卡上小字不回落成空话（同品类推荐 / 智能推荐 / 为你推荐 / 相近标签…）', () => {
  const pool = logic.buildPool([
    row('a', { reason: '同品类推荐', category: '蝴蝶' }), row('b', { reason: '为你推荐' }),
    row('c', { reason: '相近标签' }), row('d', { reason: '同品类推荐', isOneOfAKind: true })
  ], [], {})
  const texts = allTexts(logic.buildView({ phase: 'ready', pool, signals: {} }))
  return texts.every((s) => !EMPTY_WORDS.some((w) => String(s).includes(w)))
})
t('服务端「相近标签」→ 头部「按你近来看过的藏品挑的」', () => {
  const pool = logic.buildPool([row('a', { reason: '相近标签' }), row('b')], [], {})
  const v = logic.buildView({ phase: 'ready', pool, signals: {} })
  return v.whyMode === 'personal' && /近来看过/.test(v.whyText)
})
t('常看标签：头部只提本页真的命中的标签（不提没出现的）', () => {
  const signals = { interestTags: { 闪蝶: 9, 甲虫: 5, 矿石: 3 } }
  const pool = logic.buildPool([row('a', { tags: ['闪蝶'] }), row('b', { tags: ['植物'] }), row('c'), row('d', { tags: ['甲虫'] })], [], signals)
  const v = logic.buildView({ phase: 'ready', pool, signals })
  return v.whyMode === 'interest' && v.whyText.includes('「闪蝶」') && !v.whyText.includes('甲虫')
})
t('推荐理由只在头部说一次：卡上小字不出现「常看 / 相近 / 依据 / 推荐」', () => {
  const signals = { interestTags: { 闪蝶: 9 }, wall: { blessLabel: '求财' } }
  const pool = logic.buildPool(
    [row('a', { tags: ['闪蝶'], reason: '相近标签' }), row('b', { tags: ['闪蝶'], isOneOfAKind: true }), row('c', { reason: '同品类推荐' })],
    [row('x', { matchSource: 'tag' })], signals)
  const v = logic.buildView({ phase: 'ready', pool, signals })
  return markTexts(v).every((s) => !REASON_WORDS.some((w) => s.includes(w))) && /常看/.test(v.whyText)
})
t('祈运件：显式打了祈运标签才写「来自祈福墙 · 求财」，场景兜底只写「来自祈福墙」', () => {
  const signals = { wall: { blessLabel: '求财' } }
  const pool = logic.buildPool([row('a'), row('b')], [row('t', { matchSource: 'tag' }), row('s', { matchSource: 'scene' })], signals)
  const byId = (id) => pool.find((c) => c._id === id)
  const sceneOnly = logic.buildView({ phase: 'ready', pool: logic.buildPool([row('a'), row('b')], [row('s', { matchSource: 'scene' })], signals), signals })
  return byId('t').mark.text === '来自祈福墙 · 求财' && byId('s').mark.text === '来自祈福墙' &&
    sceneOnly.whyMode === 'wall' && !sceneOnly.whyText.includes('求财')
})
t('祈福墙：近 14 天玩过才算（13 天 true / 15 天 false / 脏数据 false）', () => {
  const now = Date.UTC(2026, 8, 27)
  const st = (days) => ({ plays: { qian: [{ at: now - days * 86400000 }] } })
  return logic.playedWallRecently(st(13), now) === true && logic.playedWallRecently(st(15), now) === false &&
    logic.playedWallRecently(null, now) === false && logic.playedWallRecently({ plays: { qian: 'x' } }, now) === false
})
t('祈福墙留档键与 plays 分包 ritualPlayArchive.STORAGE_KEY 同值', () => {
  const m = /const STORAGE_KEY = '([^']+)'/.exec(read('subpackages/plays/utils/ritualPlayArchive.js'))
  return !!m && m[1] === logic.RITUAL_PLAY_STORAGE_KEY
})

/* ② 展示正确 */
t('价格：多规格取最低价 +「起」；无价 / 0 价不写 ¥0', () => {
  const a = logic.priceView({ price: 300, hasSku: true, skus: [{ price: 168 }, { price: 128 }] })
  const b = logic.priceView({ price: 0 })
  const c = logic.priceView({})
  return a.priceText === '¥128' && a.priceFrom === true && b.priceText === '' && c.priceText === ''
})
t('祈运件：插在每页第 3 位（两列右格）、与服务端推荐去重；无墙信号时不混入', () => {
  const reco = [row('a'), row('b'), row('c'), row('d'), row('e'), row('f')]
  const bless = [row('c'), row('x', { matchSource: 'tag' }), row('y')]
  const pool = logic.buildPool(reco, bless, { wall: { blessLabel: '求财' } })
  const ids = pool.map((c) => c._id)
  const noWall = logic.buildPool(reco, bless, {}).map((c) => c._id)
  const v = logic.buildView({ phase: 'ready', pool, signals: { wall: { blessLabel: '求财' } } })
  return ids[2] === 'x' && ids[5] === 'y' && ids.filter((i) => i === 'c').length === 1 &&
    !noWall.includes('x') && v.whyMode === 'wall' && v.pages[0].row[1]._id === 'x'
})
t('分页：一页 = 封面 1 + 两列 2；所有页一次给齐（swiper 左右滑），头部那句跟当前页', () => {
  const signals = { interestTags: { 甲虫: 9 } }
  const pool = logic.buildPool([1, 2, 3, 4, 5, 6, 7].map((i) => row(String(i), i === 5 ? { tags: ['甲虫'] } : {})), [], signals)
  const v0 = logic.buildView({ phase: 'ready', pool, pageIndex: 0, signals })
  const v1 = logic.buildView({ phase: 'ready', pool, pageIndex: 1, signals })
  return v0.pageTotal === 3 && v0.pages.length === 3 && v0.pages[0].row.length === 2 && v0.pages[2].lead._id === '7' &&
    v0.pages[2].row.map((c) => c._id).join() === '1,2' && v0.canSwap && v0.whyMode === 'cold' && v1.whyMode === 'interest'
})
t('切页 n=1..12：≥3 件每页满 3（末页从头循环补齐）、页内不重复、每件都有原位；2 件 = 两列无封面；1 件 = 只封面', () => {
  for (let n = 1; n <= 12; n += 1) {
    const pool = logic.buildPool(Array.from({ length: n }, (_, i) => row(String(i))), [], {})
    const v = logic.buildView({ phase: 'ready', pool })
    const want = n >= 3 ? 'full' : (n === 2 ? 'row' : 'lead')
    if (v.layout !== want || v.pageTotal !== Math.ceil(n / 3) || v.pages.length !== v.pageTotal) return false
    const own = new Set()
    for (const pg of v.pages) {
      const cards = [pg.lead].concat(pg.row).filter(Boolean)
      const ids = cards.map((c) => c._id)
      if (new Set(ids).size !== ids.length) return false
      if (want === 'full' && !(pg.lead && pg.row.length === 2)) return false
      if (want === 'row' && !(pg.lead === null && pg.row.length === 2)) return false
      if (want === 'lead' && !(pg.lead && pg.row.length === 0)) return false
      for (const c of cards) {
        if (c.no !== `No.${String(c.pos + 1).padStart(2, '0')}` || pool[c.pos]._id !== c._id) return false
        if (!c.dup) own.add(c._id)
      }
    }
    if (own.size !== n) return false
    if (v.pages.reduce((s, pg) => s + [pg.lead].concat(pg.row).filter((c) => c && c.dup).length, 0) !== v.pageTotal * 3 - n && n >= 3) return false
  }
  return true
})
t('降级版式：swiper 按 layout 收高、无封面时不画封面、无两列时不画空行；曝光 ids 只列本次加载首次露出的件', () => {
  const w = read('components/HomeReco/index.wxml')
  const s = read('components/HomeReco/index.wxss')
  const js = read('components/HomeReco/index.js')
  return /class="hr-swiper hr-swiper--\{\{layout\}\}"/.test(w) && /hr-cover[^"]*" wx:if="\{\{pg\.lead\}\}"/.test(w) &&
    /class="hr-row" wx:if="\{\{pg\.row\.length\}\}"/.test(w) && /\.hr-swiper--lead \{ height: 570rpx; \}/.test(s) &&
    /\.hr-swiper--row \{ height: 532rpx; \}/.test(s) && /filter\(\(c\) => c && !this\._exposed\[`\$\{this\._seq\}#\$\{c\._id\}`\]\)/.test(js)
})
t('视图字段：VIEW_KEYS 覆盖 WXML 用到的每个卡片字段（+ 保护徽标的 protectionType），且不带 tags/category 等只给埋点用的字段', () => {
  const js = read('components/HomeReco/index.js')
  const w = read('components/HomeReco/index.wxml')
  const m = /const VIEW_KEYS = \[([^\]]*)\]/.exec(js)
  if (!m || !/VIEW_KEYS\.forEach/.test(js)) return false
  const keys = m[1].split(',').map((s) => s.trim().replace(/'/g, ''))
  const used = new Set([...w.matchAll(/(?:pg\.lead|item)\.([A-Za-z_]+)/g)].map((x) => x[1]).filter((k) => k !== 'image'))
  return [...used, 'protectionType'].every((k) => keys.includes(k)) &&
    !keys.some((k) => ['tags', 'category', 'hitTag', 'near', 'blessTagged', 'fromBless', '_fromBless', 'price'].includes(k))
})
t('封面图：封面单独走高清档（HERO_W ≥ 900，imageUrl 只缩不放），小卡仍 midUrl', () => {
  const js = read('components/HomeReco/index.js')
  const w = Number((/const HERO_W = (\d+)/.exec(js) || [])[1])
  return w >= 900 && /if \(hero\) o\.image = thumbUrl\(c\.rawImage, HERO_W\)/.test(js) && /lead: p\.lead && slim\(p\.lead, 1\)/.test(js)
})
t('比例到达：只按路径改几何字段（不整页重发），GEO_KEYS 覆盖 coverGeo / cardGeo 产出的全部键', () => {
  const js = read('components/HomeReco/index.js')
  const m = /const GEO_KEYS = \[([^\]]*)\]/.exec(js)
  if (!m) return false
  const keys = m[1].split(',').map((s) => s.trim().replace(/'/g, ''))
  const produced = new Set([logic.coverGeo(1.78, true), logic.coverGeo(1.5, true), logic.coverGeo(0.67, true), logic.cardGeo(1.5)].flatMap((o) => Object.keys(o)))
  return [...produced].every((k) => keys.includes(k)) && /this\._ratioT = setTimeout\(\(\) => \{\s*this\._patchGeo\(\)/.test(js) &&
    /patch\[`pages\[\$\{p\}\]\.\$\{k\}\.\$\{g\}`\]/.test(js)
})
t('热区 / 读屏：「换一批」热区 ≥ 88rpx、重试 88rpx；封面与小卡 aria-role=button + aria-label；多页有「当前 / 总」页码', () => {
  const s = read('components/HomeReco/index.wxss')
  const w = read('components/HomeReco/index.wxml')
  const a = /\.hr-swap::after \{[^}]*top: -(\d+)rpx; bottom: -(\d+)rpx/.exec(s)
  return !!a && 56 + Number(a[1]) + Number(a[2]) >= 88 && /\.hr-swap \{ position: relative;/.test(s) && /\.hr-retry \{[^}]*min-height: 88rpx/.test(s) &&
    /aria-role="button" aria-label="\{\{pg\.lead\.title\}\}"/.test(w) && /aria-role="button"\s+aria-label="\{\{item\.title\}\}"/.test(w) &&
    /<view class="hr-dots" wx:if="\{\{canSwap\}\}">[\s\S]*?<text class="hr-count">\{\{pageIndex \+ 1\}\} \/ \{\{pageTotal\}\}<\/text>/.test(w)
})
t('提审红线：模块里没有销量 / 浏览量 / 人气数字，没有诱导分享 / 收藏 / 转发的文案或 open-type', () => {
  const w = read('components/HomeReco/index.wxml')
  const js = read('components/HomeReco/index.js')
  return !/已售(?!罄)|销量|浏览|人看过|人气|热度|soldText|viewCount|分享|收藏|转发|open-type/.test(w) && !/onShareAppMessage|showShareMenu/.test(js)
})
t('组件 WXML：swiper 左右滑（bindchange=onPageChange）+ 页码点', () => {
  const w = read('components/HomeReco/index.wxml')
  return /<swiper class="hr-swiper[^"]*" current="\{\{pageIndex\}\}"[^>]*bindchange="onPageChange"/.test(w) && /class="hr-dots"/.test(w)
})
t('封面分档：横图满宽 / 竖图贴左（2:3 宽 380 不裁；9:16 widthFix 偏上裁；方图 420）；比例未知 = 占位，图挂了 = 满宽', () => {
  const g = logic.coverGeo
  const p23 = g(1.5, true), p916 = g(1.78, true), sq = g(1, true), l32 = g(0.67, true)
  return p23.tier === 'side' && p23.bw === 380 && p23.cm === 'aspectFill' &&
    p916.tier === 'side' && p916.bw === 360 && p916.cm === 'widthFix' && p916.mt < 0 &&
    sq.tier === 'side' && sq.bw === 420 && l32.tier === 'wide' &&
    g(undefined, true).tier === '' && g(-1, true).tier === 'wide' && g(undefined, false).tier === 'wide'
})
t('小卡裁切：竖图 widthFix + 偏上（保头部），横图 / 未知 aspectFill；比例经 buildView 并进卡片', () => {
  const c = logic.cardGeo
  const pool = logic.buildPool([row('a', { images: ['A'] }), row('b', { images: ['B'] }), row('c', { images: ['C'] })], [], {})
  const v = logic.buildView({ phase: 'ready', pool, ratios: { A: 1.5, B: 1.5 } })
  return c(1.5).cm === 'widthFix' && c(1.5).mt < 0 && c(0.67).cm === 'aspectFill' && c(undefined).cm === 'aspectFill' &&
    v.pages[0].lead.tier === 'side' && v.pages[0].row[0].cm === 'widthFix' && v.pages[0].row[1].cm === 'aspectFill'
})
t('比例来源：封面 / 小卡图 bindload=onImgLoad 回写，组件缓存进 Storage；封面按档挂 class', () => {
  const w = read('components/HomeReco/index.wxml')
  const js = read('components/HomeReco/index.js')
  return (w.match(/bindload="onImgLoad"/g) || []).length >= 2 && /binderror="onImgError"/.test(w) &&
    /hr-cover--\{\{pg\.lead\.tier \|\| 'wide'\}\}/.test(w) && /onImgLoad\(e\)/.test(js) && /setStorageSync\(RATIO_KEY/.test(js) &&
    /ratios: this\._ratios/.test(js)
})

/* ③ 三态 */
t('三态：无内容失败 = error；成功但为空 = empty；加载中 = loading', () => (
  logic.buildView({ phase: 'error', pool: [] }).phase === 'error' &&
  logic.buildView({ phase: 'ready', pool: [] }).phase === 'empty' &&
  logic.buildView({ phase: 'loading', pool: [] }).phase === 'loading'
))
t('组件 WXML：骨架 / 失败原位重试 / 空态 / 内容四块齐全', () => {
  const w = read('components/HomeReco/index.wxml')
  return /wx:if="\{\{phase === 'loading'\}\}"/.test(w) && /class="hr-error" wx:elif="\{\{phase === 'error'\}\}"/.test(w) &&
    /class="hr-retry" bindtap="onRetry"/.test(w) && /wx:elif="\{\{phase === 'empty'\}\}"/.test(w) && /<block wx:else>/.test(w)
})
t('首页挂载 <home-reco>（wx:if=showRecommendations，点击走 goToDetail），且 json 已登记', () => {
  const w = read('pages/index/index.wxml')
  const j = JSON.parse(read('pages/index/index.json')).usingComponents || {}
  return /<view class="section-box" wx:if="\{\{showRecommendations\}\}">\s*<home-reco id="homeReco"[^>]*bind:itemtap="goToDetail"/.test(w) &&
    j['home-reco'] === '/components/HomeReco/index'
})
t('首页不残留旧推荐 WXML / 旧样式（.recommend-* / .rec-* / .sk-rec-*）', () => {
  const w = read('pages/index/index.wxml')
  const s = read('pages/index/index.wxss').replace(/\/\*[\s\S]*?\*\//g, '')
  return !/recommend-card|rec-image|skeleton-recommendations/.test(w) && !/\.(recommend-|rec-|sk-rec-)[\w-]*/.test(s)
})

/* ④ 契约不动 */
t('getRecommendations 入参只有 { limit }（不新增、不改名）', () => {
  const js = read('components/HomeReco/index.js')
  return /name: 'getRecommendations', data: \{ limit \}/.test(js)
})
t('getBlessProducts 只用既有入参（tag / excludeIds / limit / category / dayKey）', () => {
  const js = read('components/HomeReco/index.js')
  const m = /name: 'getBlessProducts',\s*data: \{([^}]*)\}/.exec(js)
  if (!m) return false
  const keys = m[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean)
  return keys.length > 0 && keys.every((k) => ['tag', 'excludeIds', 'limit', 'category', 'dayKey'].includes(k))
})
t('点击交给页面时带上 category / tags（product_view 才能喂兴趣标签）', () => {
  const js = read('components/HomeReco/index.js')
  const m = /triggerEvent\('itemtap', \{([\s\S]*?)\}\)/.exec(js)
  return !!m && /category: card\.category/.test(m[1]) && /tags: card\.tags/.test(m[1]) && /_id: card\._id/.test(m[1])
})

console.log(`test-home-reco：${passed} 通过 / ${failures.length} 失败`)
if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('✓ 首页为你推荐：理由诚实 / 展示正确 / 三态齐全 / 契约不动')

/* ── 自检：每条注入都必须让对应断言红 ───────────────────────────────── */
function selftest() {
  const REAL = resolve(HERE, '..')
  const INJECTS = [
    { name: '冷启动冒充个性化', file: 'components/HomeReco/logic.js', from: "'还在认识你 · 先看馆里今天的精选'", to: "'按你的喜好挑的'", expect: '冷启动' },
    { name: '卡上小字回落成服务端空话', file: 'components/HomeReco/logic.js', from: "  if (isOneOfAKindProduct(item)) return { text: '孤品', kind: 'fact' }", to: "  if (item.reason) return { text: item.reason, kind: 'fact' }\n  if (isOneOfAKindProduct(item)) return { text: '孤品', kind: 'fact' }", expect: '空话' },
    { name: '头部不再依据本页命中', file: 'components/HomeReco/logic.js', from: 'if (c.hitTag && !hits.includes(c.hitTag)) hits.push(c.hitTag)', to: '', expect: '常看标签' },
    { name: '卡上又贴「常看 · X」（理由说两遍）', file: 'components/HomeReco/logic.js', from: 'function markFor(item, ctx) {\n  const c = ctx || {}\n', to: "function markFor(item, ctx) {\n  const c = ctx || {}\n  if (hitTagOf(item, c)) return { text: '常看 · ' + hitTagOf(item, c), kind: 'interest' }\n", expect: '只在头部说一次' },
    { name: '场景兜底的祈运件也写「求财」', file: 'components/HomeReco/logic.js', from: "item.matchSource === 'tag' ? `来自祈福墙 · ${c.blessLabel}` : '来自祈福墙'", to: '`来自祈福墙 · ${c.blessLabel}`', expect: '场景兜底' },
    { name: '换页退回无过渡的整块替换', file: 'components/HomeReco/index.wxml', from: 'bindchange="onPageChange"', to: '', expect: '左右滑' },
    { name: '竖图也走满宽档（大片留白）', file: 'components/HomeReco/logic.js', from: "if (ratio < 0.85) return { tier: 'wide'", to: "if (ratio < 9) return { tier: 'wide'", expect: '封面分档' },
    { name: '竖图小卡回到居中裁（砍头）', file: 'components/HomeReco/logic.js', from: 'return ratio > 1.05 ?', to: 'return ratio > 9 ?', expect: '小卡裁切' },
    { name: '末页不再循环补齐（只剩封面、下方空白）', file: 'components/HomeReco/logic.js', from: "layout === 'full' && idx.length < PAGE_SIZE", to: 'false', expect: '切页' },
    { name: '补齐从本页起点取（页内重复）', file: 'components/HomeReco/logic.js', from: "for (let k = 0; layout === 'full'", to: "for (let k = p * PAGE_SIZE; layout === 'full'", expect: '切页' },
    { name: '2 件时仍用封面 + 单卡（半边空白）', file: 'components/HomeReco/logic.js', from: "(n === 2 ? 'row' : 'lead')", to: "'lead'", expect: '切页' },
    { name: '补位件的曝光重复计数', file: 'components/HomeReco/index.js', from: 'filter((c) => c && !this._exposed[`${this._seq}#${c._id}`])', to: 'filter(Boolean)', expect: '降级版式' },
    { name: '单封面页 swiper 不收高', file: 'components/HomeReco/index.wxss', from: '.hr-swiper--lead { height: 570rpx; }', to: '', expect: '降级版式' },
    { name: '视图字段漏了价格（卡上价格空白）', file: 'components/HomeReco/index.js', from: "'priceText', ", to: '', expect: '视图字段' },
    { name: '视图字段又带上 tags（setData 变胖）', file: 'components/HomeReco/index.js', from: "const VIEW_KEYS = ['_id', ", to: "const VIEW_KEYS = ['_id', 'tags', ", expect: '视图字段' },
    { name: '封面退回 480 档（满宽发糊）', file: 'components/HomeReco/index.js', from: 'if (hero) o.image = thumbUrl(c.rawImage, HERO_W)', to: '', expect: '封面图' },
    { name: '比例到达又整页重发', file: 'components/HomeReco/index.js', from: 'this._ratioT = setTimeout(() => {\n        this._patchGeo()', to: 'this._ratioT = setTimeout(() => {\n        this._render()', expect: '比例到达' },
    { name: 'GEO_KEYS 漏了 mt（widthFix 上提不生效）', file: 'components/HomeReco/index.js', from: "const GEO_KEYS = ['tier', 'bw', 'cm', 'mt']", to: "const GEO_KEYS = ['tier', 'bw', 'cm']", expect: '比例到达' },
    { name: '换一批热区缩回 56rpx', file: 'components/HomeReco/index.wxss', from: 'top: -17rpx; bottom: -17rpx;', to: 'top: 0; bottom: 0;', expect: '热区' },
    { name: '页码计数被删', file: 'components/HomeReco/index.wxml', from: '<text class="hr-count">{{pageIndex + 1}} / {{pageTotal}}</text>', to: '', expect: '热区' },
    { name: '卡上加了假销量', file: 'components/HomeReco/index.wxml', from: '<text class="hr-soldout" wx:if="{{item.soldOut}}">售罄</text>', to: '<text class="hr-soldout" wx:if="{{item.soldOut}}">售罄</text><text>已售 99+</text>', expect: '提审红线' },
    { name: '图片不再回报比例', file: 'components/HomeReco/index.wxml', from: 'bindload="onImgLoad"', to: '', expect: '比例来源' },
    { name: '无价写成 ¥0', file: 'components/HomeReco/logic.js', from: "if (!Number.isFinite(price) || price <= 0) return { priceText: '', priceFrom: false }", to: "if (!Number.isFinite(price)) return { priceText: '', priceFrom: false }", expect: '价格' },
    { name: '祈福墙时间窗放宽', file: 'components/HomeReco/logic.js', from: 'const WALL_RECENT_DAYS = 14', to: 'const WALL_RECENT_DAYS = 365', expect: '近 14 天' },
    { name: '留档键漂移', file: 'components/HomeReco/logic.js', from: "const RITUAL_PLAY_STORAGE_KEY = 'shanhai_ritual_play_v1'", to: "const RITUAL_PLAY_STORAGE_KEY = 'shanhai_ritual_play_v2'", expect: '留档键' },
    { name: '祈运件不再去重', file: 'components/HomeReco/logic.js', from: 'if (!card._id || seen[card._id] || bless.length >= BLESS_LIMIT) return', to: 'if (!card._id || bless.length >= BLESS_LIMIT) return', expect: '祈运件' },
    { name: '失败态丢了重试', file: 'components/HomeReco/index.wxml', from: 'class="hr-retry" bindtap="onRetry"', to: 'class="hr-retry"', expect: '失败原位重试' },
    { name: '首页残留旧样式', file: 'pages/index/index.wxss', append: '\n.rec-price { color: #C4A76C; }\n', expect: '旧样式' },
    { name: '点击丢了 tags', file: 'components/HomeReco/index.js', from: '        tags: card.tags,\n', to: '', expect: 'tags' },
    { name: '推荐云函数入参被改', file: 'components/HomeReco/index.js', from: "name: 'getRecommendations', data: { limit }", to: "name: 'getRecommendations', data: { limit, userId: 'x' }", expect: '入参只有' }
  ]
  let ok = true
  const snapshot = new Map(FILES.map((f) => [f, readFileSync(join(REAL, f), 'utf8')]))
  for (const inj of INJECTS) {
    const dir = mkdtempSync(join(tmpdir(), 'home-reco-selftest-'))
    try {
      for (const f of FILES) {
        mkdirSync(dirname(join(dir, f)), { recursive: true })
        cpSync(join(REAL, f), join(dir, f))
      }
      const target = join(dir, inj.file)
      let src = readFileSync(target, 'utf8')
      if (inj.append) src += inj.append
      else {
        if (!src.includes(inj.from)) throw new Error(`锚点失效：${inj.from.slice(0, 60)}`)
        src = src.split(inj.from).join(inj.to)
      }
      writeFileSync(target, src)
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', dir], { encoding: 'utf8' })
      const out = `${r.stdout}\n${r.stderr}`
      if (r.status !== 0 && out.includes(inj.expect)) console.log(`  ✓ 注入「${inj.name}」被检出`)
      else {
        ok = false
        console.error(`  ✗ 注入「${inj.name}」未被检出（期望命中「${inj.expect}」）\n${out}`)
      }
    } catch (e) {
      ok = false
      console.error(`  ✗ 注入「${inj.name}」无法施加：${e.message}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  for (const [f, s] of snapshot) {
    if (readFileSync(join(REAL, f), 'utf8') !== s) {
      console.error(`✗ 自检改动了真源码：${f}`)
      process.exit(1)
    }
  }
  if (!ok) process.exit(1)
  console.log(`✓ selftest 通过：${INJECTS.length} 个注入全部被检出；真源码未被改动`)
  process.exit(0)
}
