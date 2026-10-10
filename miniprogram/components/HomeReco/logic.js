/** 首页「为你推荐」纯逻辑（无 wx 依赖）。理由只写真知道的事、只在头部说一次；卡上只标事实。 */
const { isOneOfAKindProduct, isNewArrival } = require('../../utils/productStats')
const { sanitizeLatinName } = require('../../utils/latinDisplay')
const { isSensitiveBlurProduct } = require('../../utils/sensitiveBlur')

const PAGE_SIZE = 3
const FETCH_LIMIT = 12
const BLESS_LIMIT = 2
const WALL_RECENT_DAYS = 14
/** 须与 plays 分包 ritualPlayArchive.STORAGE_KEY 同值 */
const RITUAL_PLAY_STORAGE_KEY = 'shanhai_ritual_play_v1'
const SERVER_TAG_REASON = '相近标签'

/** 封面恒高、按 h/w 分 wide / side 档（文档 §7）；比例未知 tier=''，失败 -1 → wide */
const COVER_H = 640
const SIDE_MIN_W = 360
const SIDE_MAX_W = 420
const CARD_W = 334
const TOP_BIAS = 0.3

function coverGeo(ratio, hasImage) {
  if (!hasImage || ratio < 0) return { tier: 'wide', cm: 'aspectFill', mt: 0 }
  if (!(ratio > 0)) return { tier: '', cm: 'aspectFill', mt: 0 }
  if (ratio < 0.85) return { tier: 'wide', cm: 'aspectFill', mt: 0 }
  const bw = Math.min(SIDE_MAX_W, Math.max(SIDE_MIN_W, Math.round(COVER_H / ratio)))
  const over = bw * ratio - COVER_H
  return { tier: 'side', bw, cm: over > 0 ? 'widthFix' : 'aspectFill', mt: over > 0 ? -Math.round(over * TOP_BIAS) : 0 }
}

/** 两列 1:1：竖图 widthFix 偏上裁（保住标本上半），其余居中裁 */
function cardGeo(ratio) {
  return ratio > 1.05 ? { cm: 'widthFix', mt: -Math.round((ratio - 1) * CARD_W * TOP_BIAS) } : { cm: 'aspectFill', mt: 0 }
}

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
  const card = {
    _id: String(it._id || ''),
    title: String(it.title || it.name || '').trim(),
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
    if (out.length % PAGE_SIZE === 2 && bi < bless.length) out.push(bless[bi++])
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

function pageCount(pool) {
  return Math.max(1, Math.ceil((Array.isArray(pool) ? pool.length : 0) / PAGE_SIZE))
}

function buildView(st) {
  const s = st || {}
  const pool = Array.isArray(s.pool) ? s.pool : []
  const ratios = s.ratios || {}
  const n = pool.length
  const total = pageCount(pool)
  // ≥3 件末页从头补齐（起点 ≥3、只补 0/1，不会页内重复；dup 件沿用原 No./pos）；2 件 = 两列；1 件 = 只封面
  const layout = n >= PAGE_SIZE ? 'full' : (n === 2 ? 'row' : 'lead')
  const pages = []
  for (let p = 0; p * PAGE_SIZE < n; p += 1) {
    const idx = []
    for (let k = p * PAGE_SIZE; k < n && idx.length < PAGE_SIZE; k += 1) idx.push(k)
    for (let k = 0; layout === 'full' && idx.length < PAGE_SIZE; k += 1) idx.push(k)
    const cards = idx.map((k, i) => Object.assign({}, pool[k], {
      no: `No.${String(k + 1).padStart(2, '0')}`,
      pos: k,
      dup: k < p * PAGE_SIZE
    }, i || layout === 'row' ? cardGeo(ratios[pool[k].rawImage]) : coverGeo(ratios[pool[k].rawImage], !!pool[k].rawImage)))
    const why = headline(cards, s.signals)
    const lead = layout === 'row' ? null : cards[0]
    pages.push({ lead, row: lead ? cards.slice(1) : cards, whyText: why.text, whyMode: why.mode })
  }
  const pageIndex = Math.min(Math.max(0, s.pageIndex | 0), total - 1)
  const cur = pages[pageIndex]
  return {
    phase: cur ? 'ready' : (s.phase === 'ready' ? 'empty' : (s.phase || 'loading')),
    pages,
    layout,
    whyText: cur ? cur.whyText : '',
    whyMode: cur ? cur.whyMode : '',
    pageIndex,
    pageTotal: total,
    canSwap: pages.length > 1,
    refreshing: !!s.refreshing,
    errorMsg: String(s.errorMsg || '')
  }
}

module.exports = { FETCH_LIMIT, BLESS_LIMIT, RITUAL_PLAY_STORAGE_KEY, COVER_H, playedWallRecently, priceView, coverGeo, cardGeo, buildPool, buildView }
