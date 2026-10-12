/** 首页「为你推荐」纯逻辑（无 wx 依赖）。理由只写真知道的事、只在头部说一次；卡上只标事实。 */
const { isOneOfAKindProduct, isNewArrival } = require('../../utils/productStats')
const { sanitizeLatinName } = require('../../utils/latinDisplay')
const { isSensitiveBlurProduct } = require('../../utils/sensitiveBlur')

/** 横滑展柜（2026-10-13 重做）：一批 6 件，「换一批」翻到下一批；祈运件仍每 3 件插 1 */
const BATCH = 6
const BLESS_EVERY = 3
const FETCH_LIMIT = 12
const BLESS_LIMIT = 2
const WALL_RECENT_DAYS = 14
/** 须与 plays 分包 ritualPlayArchive.STORAGE_KEY 同值 */
const RITUAL_PLAY_STORAGE_KEY = 'shanhai_ritual_play_v1'
const SERVER_TAG_REASON = '相近标签'

function normTag(t) {
  return String(t || '').trim().toLowerCase()
}

function topInterestTags(raw, limit) {
  const cap = Math.max(1, limit || 6)
  if (Array.isArray(raw)) return raw.map((t) => String(t || '').trim()).filter(Boolean).slice(0, cap)
  if (!raw || typeof raw !== 'object') return []
  return Object.keys(raw)
    .filter((k) => k && Number(raw[k]) > 0)
    .sort((a, b) => Number(raw[b]) - Number(raw[a]))
    .slice(0, cap)
}

function latestPlayAt(state) {
  const plays = state && state.plays
  if (!plays || typeof plays !== 'object') return 0
  let latest = 0
  Object.keys(plays).forEach((id) => {
    const list = Array.isArray(plays[id]) ? plays[id] : []
    list.forEach((e) => {
      const at = Number(e && e.at) || 0
      if (at > latest) latest = at
    })
  })
  return latest
}

function playedWallRecently(state, nowMs) {
  const at = latestPlayAt(state)
  if (!at) return false
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  return now - at <= WALL_RECENT_DAYS * 86400000
}

function priceView(item) {
  const it = item || {}
  const skus = it.hasSku && Array.isArray(it.skus) ? it.skus : []
  let price = Number(it.price)
  if (skus.length) {
    const ps = skus.map((s) => Number(s && s.price)).filter((p) => Number.isFinite(p) && p > 0)
    if (ps.length) price = Math.min.apply(null, ps)
  }
  if (!Number.isFinite(price) || price <= 0) return { priceText: '', priceFrom: false }
  return { priceText: `¥${price}`, priceFrom: skus.length > 1 }
}

function stockSoldOut(it) {
  if (it.soldOut === true) return true
  if (it.hasSku && Array.isArray(it.skus) && it.skus.length) {
    return it.skus.reduce((s, k) => s + (parseInt(k && k.stock, 10) || 0), 0) <= 0
  }
  if (it.stock == null || it.stock === '') return false
  const n = parseInt(it.stock, 10)
  return !Number.isNaN(n) && n <= 0
}

function hitTagOf(item, ctx) {
  const want = ((ctx && ctx.interestTags) || []).map(normTag)
  if (!want.length) return ''
  const hit = (Array.isArray(item.tags) ? item.tags : []).find((t) => want.includes(normTag(t)))
  return hit ? String(hit).trim() : ''
}

/** 只有 matchSource='tag' 才写「· 求财」：场景兜底的件不一定有该寓意 */
function markFor(item, ctx) {
  const c = ctx || {}
  if (item._fromBless && c.blessLabel) {
    return { text: item.matchSource === 'tag' ? `来自祈福墙 · ${c.blessLabel}` : '来自祈福墙', kind: 'wall' }
  }
  if (isOneOfAKindProduct(item)) return { text: '孤品', kind: 'fact' }
  if (isNewArrival(item)) return { text: '新藏', kind: 'fact' }
  return null
}

function toCard(raw, ctx, fromBless) {
  const it = Object.assign({}, raw || {}, { _fromBless: !!fromBless })
  const images = Array.isArray(it.images) ? it.images : []
  const theme = String(it.themeName || '').trim()
  const latin = sanitizeLatinName(it.latinName || it.latin || it.scientificName || '')
  const title = String(it.title || it.name || '').trim()
  const cat = String(it.category || '').trim()
  const card = {
    _id: String(it._id || ''),
    title,
    /** 卡上主名：诗意主题名优先，没有就用标题；副行 = 门类 · 标题（主名已是标题时只写门类） */
    name: theme || title,
    sub: [cat, theme ? title : ''].filter(Boolean).join(' · '),
    theme: theme ? `「${theme}」` : '',
    note: String(it.themeNote || '').trim(),
    latin,
    rawImage: String(images[0] || it.cover || it.httpImage || ''),
    price: Number.isFinite(Number(it.price)) ? Number(it.price) : null,
    soldOut: stockSoldOut(it),
    category: String(it.category || ''),
    cat: String(it.category || '').trim(),
    tags: Array.isArray(it.tags) ? it.tags.slice(0, 10) : [],
    protectionType: it.protectionType || 'none',
    sensitiveBlur: isSensitiveBlurProduct(it),
    fromBless: !!fromBless,
    blessTagged: !!fromBless && it.matchSource === 'tag',
    hitTag: hitTagOf(it, ctx),
    near: it.reason === SERVER_TAG_REASON,
    mark: markFor(it, ctx)
  }
  return Object.assign(card, priceView(it))
}

function buildPool(recoRows, blessRows, signals) {
  const s = signals || {}
  const ctx = {
    interestTags: topInterestTags(s.interestTags, 6),
    blessLabel: s.wall && s.wall.blessLabel ? String(s.wall.blessLabel) : ''
  }
  const seen = {}
  const main = []
  ;(Array.isArray(recoRows) ? recoRows : []).forEach((r) => {
    const card = toCard(r, ctx, false)
    if (!card._id || seen[card._id]) return
    seen[card._id] = 1
    main.push(card)
  })
  const bless = []
  if (ctx.blessLabel) {
    ;(Array.isArray(blessRows) ? blessRows : []).forEach((r) => {
      const card = toCard(r, ctx, true)
      if (!card._id || seen[card._id] || bless.length >= BLESS_LIMIT) return
      seen[card._id] = 1
      bless.push(card)
    })
  }
  const out = []
  let bi = 0
  main.forEach((card) => {
    if (out.length % BLESS_EVERY === 2 && bi < bless.length) out.push(bless[bi++])
    out.push(card)
  })
  while (bi < bless.length) out.push(bless[bi++])
  return out
}

function headline(pageCards, signals) {
  const cards = Array.isArray(pageCards) ? pageCards : []
  const hits = []
  cards.forEach((c) => {
    if (c.hitTag && !hits.includes(c.hitTag)) hits.push(c.hitTag)
  })
  if (hits.length) return { mode: 'interest', text: `按你常看的${hits.slice(0, 2).map((t) => `「${t}」`).join('')}挑的` }
  if (cards.some((c) => c.near)) return { mode: 'personal', text: '按你近来看过的藏品挑的' }
  const wall = signals && signals.wall
  if (wall && wall.blessLabel && cards.some((c) => c.fromBless)) {
    return {
      mode: 'wall',
      text: cards.some((c) => c.blessTagged) ? `你来过祈福墙 · 配了件「${wall.blessLabel}」寓意的` : '你来过祈福墙 · 配了件应景的'
    }
  }
  return { mode: 'cold', text: '还在认识你 · 先看馆里今天的精选' }
}

function batchCount(pool) {
  return Math.max(1, Math.ceil((Array.isArray(pool) ? pool.length : 0) / BATCH))
}

/** 一批 = 连续 6 件；件数 ≥ 6 时末批从头补齐（只补到 6，批内不重复，补位件 dup=true 不重复计曝光） */
function buildView(st) {
  const s = st || {}
  const pool = Array.isArray(s.pool) ? s.pool : []
  const n = pool.length
  const batches = []
  for (let b = 0; b * BATCH < n; b += 1) {
    const idx = []
    for (let k = b * BATCH; k < n && idx.length < BATCH; k += 1) idx.push(k)
    for (let k = 0; n >= BATCH && idx.length < BATCH; k += 1) idx.push(k)
    const cards = idx.map((k) => Object.assign({}, pool[k], { pos: k, dup: k < b * BATCH }))
    const why = headline(cards, s.signals)
    batches.push({ cards, whyText: why.text, whyMode: why.mode })
  }
  const total = batchCount(pool)
  const batchIndex = Math.min(Math.max(0, s.batchIndex | 0), total - 1)
  const cur = batches[batchIndex]
  return {
    phase: cur ? 'ready' : (s.phase === 'ready' ? 'empty' : (s.phase || 'loading')),
    batches,
    cards: cur ? cur.cards : [],
    whyText: cur ? cur.whyText : '',
    whyMode: cur ? cur.whyMode : '',
    batchIndex,
    batchTotal: total,
    canSwap: batches.length > 1,
    refreshing: !!s.refreshing,
    errorMsg: String(s.errorMsg || '')
  }
}

module.exports = { BATCH, FETCH_LIMIT, BLESS_LIMIT, RITUAL_PLAY_STORAGE_KEY, playedWallRecently, priceView, buildPool, buildView }
