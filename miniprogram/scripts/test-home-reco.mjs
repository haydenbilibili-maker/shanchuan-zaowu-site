#!/usr/bin/env node
/**
 * 首页「为你推荐」守卫（home 域；2026-09-27 全面升级配套）
 *
 * 钉住四类容易静默失效的事（口径见 miniprogram/docs/首页为你推荐_全面升级_2026-09-27.md）：
 *   ① 理由诚实：冷启动不许冒充个性化；卡上小字不许回落成「同品类推荐 / 智能推荐 / 为你推荐」这类空话；
 *      推荐理由只在头部说一次（卡上只标孤品 / 新藏 / 来自祈福墙这类事实）；头部只提**本页真的出现的**命中标签；
 *      祈运件只有显式打了祈运标签才写「· 求财」（场景兜底的不许）；祈福墙信号只认近 14 天、且与玩法留档同一个存储键；
 *   ② 展示正确：多规格最低价 +「起」、无价不写 ¥0；祈运件每 3 件插 1、与服务端推荐去重；
 *      横滑展柜（2026-10-13 重做）：一批 6 件、末批从头补齐且批内不重复、换一批 = 下一批；
 *   ③ 三态：失败原位可重试（不许退化成模块消失）、骨架、空态；首页不残留旧推荐 WXML/WXSS；
 *   ④ 契约不动：getRecommendations 只传 { limit }；getBlessProducts 只用既有入参；
 *      点击交给页面 goToDetail 时带上 category/tags（否则服务端兴趣标签学不到推荐带来的浏览）。
 *   ⑤ 视觉（2026-10-13 横滑展柜，docs/首页为你推荐_横滑展柜_2026-10-13.md）：中英标题分两行、按压态走全局
 *      tap-press / tap-press-soft + 80ms、卡片统一 3:4（不再按图片比例分档）、图底渐隐压在图上、主名 / 门类 / 价格三行、
 *      副行缺省不留占位、换一批有过渡与加载态、骨架与卡同尺寸、跳转与两个埋点调用逐字不变、末尾「逛全部藏品」。
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
const cardsOf = (view) => (view.batches || []).reduce((a, b) => a.concat(b.cards), [])
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
t('常看标签：头部只提本批真的命中的标签（不提没出现的）', () => {
  const signals = { interestTags: { 闪蝶: 9, 甲虫: 5, 矿石: 3 } }
  const pool = logic.buildPool([row('a', { tags: ['闪蝶'] }), row('b', { tags: ['植物'] }), row('c'), row('d'), row('e'), row('f'), row('g', { tags: ['甲虫'] })], [], signals)
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

const cssRule = (css, sel) => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => l.startsWith(sel + ' {')).pop()
  return body || ''
}
const pxOf = (rule, prop) => Number((new RegExp(`(?:^|[{;\\s])${prop}: (\\d+)rpx`).exec(rule) || [])[1])

/* ② 展示正确 */
t('价格：多规格取最低价 +「起」；无价 / 0 价不写 ¥0', () => {
  const a = logic.priceView({ price: 300, hasSku: true, skus: [{ price: 168 }, { price: 128 }] })
  const b = logic.priceView({ price: 0 })
  const c = logic.priceView({})
  return a.priceText === '¥128' && a.priceFrom === true && b.priceText === '' && c.priceText === ''
})
t('祈运件：每 3 件插 1（第 3、6 位）、与服务端推荐去重；无墙信号时不混入', () => {
  const reco = [row('a'), row('b'), row('c'), row('d'), row('e'), row('f')]
  const bless = [row('c'), row('x', { matchSource: 'tag' }), row('y')]
  const pool = logic.buildPool(reco, bless, { wall: { blessLabel: '求财' } })
  const ids = pool.map((c) => c._id)
  const noWall = logic.buildPool(reco, bless, {}).map((c) => c._id)
  const v = logic.buildView({ phase: 'ready', pool, signals: { wall: { blessLabel: '求财' } } })
  return ids[2] === 'x' && ids[5] === 'y' && ids.filter((i) => i === 'c').length === 1 &&
    !noWall.includes('x') && v.whyMode === 'wall' && v.cards[2]._id === 'x'
})
t('分批 n=1..14：一批 6 件；≥6 件末批从头补齐到 6、批内不重复；<6 件只一批全给；每件都有原位；头部那句跟当前批', () => {
  for (let n = 1; n <= 14; n += 1) {
    const pool = logic.buildPool(Array.from({ length: n }, (_, i) => row(String(i))), [], {})
    const v = logic.buildView({ phase: 'ready', pool })
    if (logic.BATCH !== 6 || v.batchTotal !== Math.ceil(n / 6) || v.batches.length !== v.batchTotal) return false
    const own = new Set()
    for (const b of v.batches) {
      const ids = b.cards.map((c) => c._id)
      if (new Set(ids).size !== ids.length) return false
      if (b.cards.length !== (n >= 6 ? 6 : n)) return false
      for (const c of b.cards) {
        if (pool[c.pos]._id !== c._id) return false
        if (!c.dup) own.add(c._id)
      }
    }
    if (own.size !== n) return false
  }
  const signals = { interestTags: { 甲虫: 9 } }
  const pool = logic.buildPool([1, 2, 3, 4, 5, 6, 7, 8].map((i) => row(String(i), i === 8 ? { tags: ['甲虫'] } : {})), [], signals)
  const v0 = logic.buildView({ phase: 'ready', pool, batchIndex: 0, signals })
  const v1 = logic.buildView({ phase: 'ready', pool, batchIndex: 1, signals })
  return v0.canSwap && v0.whyMode === 'cold' && v1.whyMode === 'interest' && v1.cards.map((c) => c._id).join() === '7,8,1,2,3,4'
})
t('卡上主名 / 副行：有诗意名时主名 = 诗意名、副行 = 门类 · 标题；没有时主名 = 标题、副行 = 门类；缺门类不留「 · 」', () => {
  const pool = logic.buildPool([row('a', { themeName: '屏开锦程', title: '孔雀标本', category: '鸟纲' }), row('b', { title: '蝶框', category: '昆虫' }), row('c', { title: '无类' })], [], {})
  const [a, b, c] = pool
  return a.name === '屏开锦程' && a.sub === '鸟纲 · 孔雀标本' && b.name === '蝶框' && b.sub === '昆虫' && c.name === '无类' && c.sub === ''
})
t('曝光：每批一次；ids 只列本次加载首次露出的件（补位件不重复计）', () => {
  const js = read('components/HomeReco/index.js')
  return /const key = `\$\{this\._seq\}:\$\{this\.data\.batchIndex\}`/.test(js) &&
    /cards\.filter\(\(c\) => c && !this\._exposed\[`\$\{this\._seq\}#\$\{c\._id\}`\]\)/.test(js)
})
t('视图字段：VIEW_KEYS 覆盖 WXML 用到的每个卡片字段（+ 保护徽标的 protectionType），且不带 tags/category 等只给埋点用的字段', () => {
  const js = read('components/HomeReco/index.js')
  const w = read('components/HomeReco/index.wxml')
  const m = /const VIEW_KEYS = \[([^\]]*)\]/.exec(js)
  if (!m || !/VIEW_KEYS\.forEach/.test(js)) return false
  const keys = m[1].split(',').map((s) => s.trim().replace(/'/g, ''))
  const used = new Set([...w.matchAll(/item\.([A-Za-z_]+)/g)].map((x) => x[1]).filter((k) => k !== 'image'))
  return [...used, 'protectionType'].every((k) => keys.includes(k)) &&
    !keys.some((k) => ['tags', 'category', 'hitTag', 'near', 'blessTagged', 'fromBless', '_fromBless', 'price'].includes(k))
})
t('热区 / 读屏：「换一批」热区 ≥ 88rpx、重试 88rpx；推荐卡与「逛全部藏品」aria-role=button，推荐卡带 aria-label', () => {
  const s = read('components/HomeReco/index.wxss')
  const w = read('components/HomeReco/index.wxml')
  const a = /\.hr-swap::after \{[^}]*top: -(\d+)rpx; bottom: -(\d+)rpx/.exec(s)
  return !!a && 56 + Number(a[1]) + Number(a[2]) >= 88 && /\.hr-swap \{ position: relative;/.test(s) && /\.hr-retry \{[^}]*min-height: 88rpx/.test(s) &&
    /aria-role="button" aria-label="\{\{item\.title\}\}"/.test(w) && /class="hr-more-card" bindtap="onMore"[^>]*aria-role="button"/.test(w)
})
t('提审红线：模块里没有销量 / 浏览量 / 人气数字，没有诱导分享 / 收藏 / 转发的文案或 open-type', () => {
  const w = read('components/HomeReco/index.wxml')
  const js = read('components/HomeReco/index.js')
  return !/已售(?!罄)|销量|浏览|人看过|人气|热度|soldText|viewCount|分享|收藏|转发|open-type/.test(w) && !/onShareAppMessage|showShareMenu/.test(js)
})
t('横滑展柜：scroll-view scroll-x、不再用 swiper / 页码点；换一批回到第一张（scroll-into-view=hr-c0）；末尾「逛全部藏品」', () => {
  const w = read('components/HomeReco/index.wxml')
  const js = read('components/HomeReco/index.js')
  return /<scroll-view class="hr-strip[^"]*" scroll-x[^>]*scroll-into-view="\{\{scrollTo\}\}"/.test(w) && /id="hr-c\{\{index\}\}"/.test(w) &&
    !/<swiper\b|hr-dots|hr-count/.test(w) && /scrollTo: 'hr-c0'/.test(js) && /<text class="hr-more-cn">逛全部藏品<\/text>/.test(w)
})
t('卡片统一 3:4（300×400 图 + 定高体）、图 aspectFill + lazy-load；不再按图片比例分档 / 缓存比例', () => {
  const w = read('components/HomeReco/index.wxml')
  const s = read('components/HomeReco/index.wxss')
  const js = read('components/HomeReco/index.js')
  const card = cssRule(s, '.hr-card, .hr-more-card'), img = cssRule(s, '.hr-img-box')
  return pxOf(card, 'width') === 300 && pxOf(img, 'height') === 400 && /<image class="hr-img"[^>]*mode="aspectFill" lazy-load/.test(w) &&
    !/coverGeo|cardGeo|RATIO_KEY|onImgLoad|tier/.test(js + w)
})
t('图底渐隐压在图上（.hr-fade z-index 1，角标 z-index 2，均高于敏感模糊门宿主），渐隐终点 = 卡体底色', () => {
  const w = read('components/HomeReco/index.wxml')
  const s = read('components/HomeReco/index.wxss')
  const fade = cssRule(s, '.hr-fade'), mark = cssRule(s, '.hr-mark')
  return /<\/sensitive-blur-gate>\s*<view class="hr-fade"><\/view>/.test(w) && /z-index: 1/.test(fade) && /rgba\(31,29,26,\.9\)/.test(fade) && /z-index: 2/.test(mark)
})

/* ⑤ 视觉 */
t('标题分行：英文小标 FOR YOU 与中文「为你推荐」是两个文字节点，且标题容器纵向排列', () => {
  const w = read('components/HomeReco/index.wxml')
  const s = read('components/HomeReco/index.wxss')
  const head = (/<view class="hr-title">([\s\S]*?)<\/view>/.exec(w) || [])[1] || ''
  const texts = [...head.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1])
  return texts.length === 2 && texts[0] === 'FOR YOU' && texts[1] === '为你推荐' && /flex-direction: column/.test(cssRule(s, '.hr-title'))
})
t('按压态：每个可点元素 hover-class = tap-press / tap-press-soft 且 hover-stay-time="80"；组件开 addGlobalClass、不自带按压类', () => {
  const w = read('components/HomeReco/index.wxml')
  const s = read('components/HomeReco/index.wxss')
  const js = read('components/HomeReco/index.js')
  const tags = [...w.matchAll(/<(?:view|text)\b[^>]*\bbindtap="[^"]+"[^>]*>/g)].map((m) => m[0])
  return tags.length >= 5 && tags.every((tg) => /hover-class="tap-press(?:-soft)?"/.test(tg) && /hover-stay-time="80"/.test(tg)) &&
    /options: \{ addGlobalClass: true \}/.test(js) && !/\.(?:hr-press|hr-tap|tap-press)\b/.test(s.replace(/\/\*[\s\S]*?\*\//g, ''))
})
t('缺字段降级：副行 / 角标 / 价格 / 售罄逐项 wx:if（不留占位）；副行定高（卡片等高）；缺字段的卡不出现 undefined / —', () => {
  const w = read('components/HomeReco/index.wxml')
  const s = read('components/HomeReco/index.wxss')
  const bare = logic.buildView({ phase: 'ready', pool: logic.buildPool([row('a'), row('b'), row('c')], [], {}) })
  return /<text class="hr-sub" wx:if="\{\{item\.sub\}\}">/.test(w) && /class="hr-mark[^"]*" wx:if="\{\{item\.mark\}\}"/.test(w) &&
    /<text class="hr-price" wx:if="\{\{item\.priceText\}\}">/.test(w) && pxOf(cssRule(s, '.hr-sub'), 'height') === 32 &&
    !JSON.stringify(bare.batches).includes('undefined') && !/—/.test(JSON.stringify(bare.batches))
})
t('跳转与埋点不变：推荐卡 bindtap=onCardTap + data-pos；home_reco_click / home_reco_expose 调用逐字；组件无 showModal', () => {
  const w = read('components/HomeReco/index.wxml')
  const js = read('components/HomeReco/index.js')
  return /bindtap="onCardTap" data-pos="\{\{item\.pos\}\}"/.test(w) && /const card = this\._pool\[pos\]/.test(js) &&
    /trackBehavior\('home_reco_click', 'product', card\._id, \{\s*pos,\s*mode: this\.data\.whyMode,\s*chip: \(card\.mark && card\.mark\.kind\) \|\| ''\s*\}\)/.test(js) &&
    /trackBehavior\('home_reco_expose', 'reco', this\.data\.whyMode \|\| 'cold', \{\s*page: this\.data\.batchIndex,\s*ids: ids\.join\(','\)\s*\}\)/.test(js) &&
    !/showModal/.test(js)
})
t('换一批：点击转一圈（is-turn）、取数中持续转（is-busy）且是翻到下一批；换批时卡片淡入', () => {
  const w = read('components/HomeReco/index.wxml')
  const s = read('components/HomeReco/index.wxss')
  const js = read('components/HomeReco/index.js')
  return /refreshing \? 'is-busy' : ''/.test(w) && /swapping \? 'is-turn' : ''/.test(w) && /class="hr-swap-ico"/.test(w) &&
    /\.hr-swap\.is-turn \.hr-swap-ico \{ animation:/.test(s) && /\.hr-swap\.is-busy \.hr-swap-ico \{ animation:[^}]*infinite/.test(s) &&
    /this\.setData\(\{ swapping: true \}\)[\s\S]{0,160}this\._goBatch\(\(this\.data\.batchIndex \+ 1\) % this\.data\.batchTotal\)/.test(js) &&
    /\.hr-strip\.is-turn \.hr-card \{ animation:/.test(s) && /clearTimeout\(this\._swapT\)\n\s*if \(this\._io\)/.test(js)
})
t('骨架与卡同尺寸：骨架用 ui-sk-card / ui-sk-line；骨架卡宽高 = 推荐卡宽高、骨架图高 = 卡图高', () => {
  const w = read('components/HomeReco/index.wxml')
  const s = read('components/HomeReco/index.wxss')
  const card = cssRule(s, '.hr-card, .hr-more-card'), sk = cssRule(s, '.hr-sk-card')
  return /class="ui-sk-card hr-sk-card"/.test(w) && /class="ui-sk-line hr-sk-why"/.test(w) &&
    pxOf(sk, 'height') === pxOf(card, 'height') && /flex: 0 0 300rpx/.test(sk) && pxOf(cssRule(s, '.hr-sk .hr-sk-img'), 'height') === pxOf(cssRule(s, '.hr-img-box'), 'height')
})
t('组件 wxss 不引图片（主包不长图）', () => !/url\(/.test(read('components/HomeReco/index.wxss')))

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
console.log('✓ 首页为你推荐：理由诚实 / 展示正确 / 三态齐全 / 契约不动 / 横滑展柜（分批·3:4·渐隐·按压·降级·过渡）')

/* ── 自检：每条注入都必须让对应断言红 ───────────────────────────────── */
function selftest() {
  const REAL = resolve(HERE, '..')
  const INJECTS = [
    { name: '冷启动冒充个性化', file: 'components/HomeReco/logic.js', from: "'还在认识你 · 先看馆里今天的精选'", to: "'按你的喜好挑的'", expect: '冷启动' },
    { name: '卡上小字回落成服务端空话', file: 'components/HomeReco/logic.js', from: "  if (isOneOfAKindProduct(item)) return { text: '孤品', kind: 'fact' }", to: "  if (item.reason) return { text: item.reason, kind: 'fact' }\n  if (isOneOfAKindProduct(item)) return { text: '孤品', kind: 'fact' }", expect: '空话' },
    { name: '头部不再依据本批命中', file: 'components/HomeReco/logic.js', from: 'if (c.hitTag && !hits.includes(c.hitTag)) hits.push(c.hitTag)', to: '', expect: '常看标签' },
    { name: '卡上又贴「常看 · X」（理由说两遍）', file: 'components/HomeReco/logic.js', from: 'function markFor(item, ctx) {\n  const c = ctx || {}\n', to: "function markFor(item, ctx) {\n  const c = ctx || {}\n  if (hitTagOf(item, c)) return { text: '常看 · ' + hitTagOf(item, c), kind: 'interest' }\n", expect: '只在头部说一次' },
    { name: '场景兜底的祈运件也写「求财」', file: 'components/HomeReco/logic.js', from: "item.matchSource === 'tag' ? `来自祈福墙 · ${c.blessLabel}` : '来自祈福墙'", to: '`来自祈福墙 · ${c.blessLabel}`', expect: '场景兜底' },
    { name: '末批不再从头补齐', file: 'components/HomeReco/logic.js', from: 'n >= BATCH && idx.length < BATCH', to: 'false', expect: '分批' },
    { name: '补齐从本批起点取（批内重复）', file: 'components/HomeReco/logic.js', from: 'for (let k = 0; n >= BATCH', to: 'for (let k = b * BATCH; n >= BATCH', expect: '分批' },
    { name: '副行在缺门类时留「 · 」', file: 'components/HomeReco/logic.js', from: "sub: [cat, theme ? title : ''].filter(Boolean).join(' · '),", to: "sub: cat + ' · ' + (theme ? title : ''),", expect: '主名' },
    { name: '补位件的曝光重复计数', file: 'components/HomeReco/index.js', from: 'cards.filter((c) => c && !this._exposed[`${this._seq}#${c._id}`])', to: 'cards.filter(Boolean)', expect: '曝光' },
    { name: '视图字段漏了价格（卡上价格空白）', file: 'components/HomeReco/index.js', from: "'priceText', ", to: '', expect: '视图字段' },
    { name: '视图字段又带上 tags（setData 变胖）', file: 'components/HomeReco/index.js', from: "const VIEW_KEYS = ['_id', ", to: "const VIEW_KEYS = ['_id', 'tags', ", expect: '视图字段' },
    { name: '换一批热区缩回 56rpx', file: 'components/HomeReco/index.wxss', from: 'top: -17rpx; bottom: -17rpx;', to: 'top: 0; bottom: 0;', expect: '热区' },
    { name: '卡上加了假销量', file: 'components/HomeReco/index.wxml', from: '<text class="hr-soldout" wx:if="{{item.soldOut}}">售罄</text>', to: '<text class="hr-soldout" wx:if="{{item.soldOut}}">售罄</text><text>已售 99+</text>', expect: '提审红线' },
    { name: '换一批不回到第一张', file: 'components/HomeReco/index.js', from: "scrollTo: 'hr-c0'", to: "scrollTo: ''", expect: '横滑展柜' },
    { name: '末尾「逛全部藏品」被删', file: 'components/HomeReco/index.wxml', from: '<text class="hr-more-cn">逛全部藏品</text>', to: '', expect: '横滑展柜' },
    { name: '图片改回 widthFix（卡片参差）', file: 'components/HomeReco/index.wxml', from: 'mode="aspectFill" lazy-load', to: 'mode="widthFix" lazy-load', expect: '3:4' },
    { name: '渐隐被压到模糊门下面', file: 'components/HomeReco/index.wxss', from: '.hr-fade { position: absolute; z-index: 1;', to: '.hr-fade { position: absolute; z-index: 0;', expect: '图底渐隐' },
    { name: '无价写成 ¥0', file: 'components/HomeReco/logic.js', from: "if (!Number.isFinite(price) || price <= 0) return { priceText: '', priceFrom: false }", to: "if (!Number.isFinite(price)) return { priceText: '', priceFrom: false }", expect: '价格' },
    { name: '祈福墙时间窗放宽', file: 'components/HomeReco/logic.js', from: 'const WALL_RECENT_DAYS = 14', to: 'const WALL_RECENT_DAYS = 365', expect: '近 14 天' },
    { name: '留档键漂移', file: 'components/HomeReco/logic.js', from: "const RITUAL_PLAY_STORAGE_KEY = 'shanhai_ritual_play_v1'", to: "const RITUAL_PLAY_STORAGE_KEY = 'shanhai_ritual_play_v2'", expect: '留档键' },
    { name: '祈运件不再去重', file: 'components/HomeReco/logic.js', from: 'if (!card._id || seen[card._id] || bless.length >= BLESS_LIMIT) return', to: 'if (!card._id || bless.length >= BLESS_LIMIT) return', expect: '祈运件' },
    { name: '失败态丢了重试', file: 'components/HomeReco/index.wxml', from: 'class="hr-retry" bindtap="onRetry"', to: 'class="hr-retry"', expect: '失败原位重试' },
    { name: '标题又并成一行', file: 'components/HomeReco/index.wxss', from: '.hr-title { display: flex; flex-direction: column; }', to: '.hr-title { display: flex; flex-direction: row; }', expect: '标题分行' },
    { name: '推荐卡丢了按压态', file: 'components/HomeReco/index.wxml', from: 'data-pos="{{item.pos}}" hover-class="tap-press-soft" hover-stay-time="80"', to: 'data-pos="{{item.pos}}"', expect: '按压态' },
    { name: '组件不再继承全局类（tap-press / ui-sk 失效）', file: 'components/HomeReco/index.js', from: 'options: { addGlobalClass: true },', to: 'options: {},', expect: '按压态' },
    { name: '副行不再按有无渲染', file: 'components/HomeReco/index.wxml', from: '<text class="hr-sub" wx:if="{{item.sub}}">', to: '<text class="hr-sub">', expect: '缺字段降级' },
    { name: '点击埋点事件名被改', file: 'components/HomeReco/index.js', from: "trackBehavior('home_reco_click',", to: "trackBehavior('home_reco_tap',", expect: '跳转与埋点不变' },
    { name: '推荐卡丢了 data-pos（点哪件都进错详情）', file: 'components/HomeReco/index.wxml', from: ' data-pos="{{item.pos}}"', to: '', expect: '跳转与埋点不变' },
    { name: '换一批没有转圈过渡', file: 'components/HomeReco/index.wxss', from: '.hr-swap.is-turn .hr-swap-ico { animation: hr-spin 0.48s ease-out; }', to: '', expect: '换一批' },
    { name: '骨架与卡不同高（数据到达跳高）', file: 'components/HomeReco/index.wxss', from: '.hr-sk-card { flex: 0 0 300rpx; height: 568rpx;', to: '.hr-sk-card { flex: 0 0 300rpx; height: 520rpx;', expect: '骨架' },
    { name: '组件引了图片', file: 'components/HomeReco/index.wxss', append: '\n.hr-card { background-image: url(/images/paper.png); }\n', expect: '不引图片' },
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
