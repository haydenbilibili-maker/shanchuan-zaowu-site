/**
 * 商品流多样性打散（greedy + soft recency）
 *
 * 目标：降低「纯 createTime desc」带来的同品类/同主标签扎堆，同时保留一定新货靠前感。
 * 用法：
 *   1) diversifyByCategoryAndTag(timeSortedList) — 整表混排后再分页
 *   2) createFeedDiversifier() — 流式：候选入池 → take(n)，跨页复用 recent 窗口
 *
 * score = recency * wTime + catBonus + tagBonus
 *   - recency：候选窗内越靠前（越新）越高
 *   - cat/tag：不在最近 window 内满分；相邻重复记 0；窗内按距今远近衰减
 */

const DEFAULTS = {
  /** 最近已展示的品类/标签记忆长度 */
  windowSize: 4,
  /** 每次从池头看多少候选做选择（越大越散，新感越弱） */
  lookahead: 12,
  /** 时间权重（明显低于多样性合计） */
  wTime: 0.28,
  wCat: 0.45,
  wTag: 0.27,
  /** 窗内有异品类候选时，对「与上一条同品类」的额外惩罚（硬避开相邻扎堆） */
  adjacentCatPenalty: 8,
  /** 窗内有异主标签候选时，对「与上一条同主标签」的额外惩罚 */
  adjacentTagPenalty: 4
}

function normalizeOpts(options) {
  const o = options && typeof options === 'object' ? options : {}
  return {
    windowSize: Math.max(1, Number(o.windowSize) || DEFAULTS.windowSize),
    lookahead: Math.max(1, Number(o.lookahead) || DEFAULTS.lookahead),
    wTime: Number.isFinite(Number(o.wTime)) ? Number(o.wTime) : DEFAULTS.wTime,
    wCat: Number.isFinite(Number(o.wCat)) ? Number(o.wCat) : DEFAULTS.wCat,
    wTag: Number.isFinite(Number(o.wTag)) ? Number(o.wTag) : DEFAULTS.wTag,
    adjacentCatPenalty: Number.isFinite(Number(o.adjacentCatPenalty))
      ? Number(o.adjacentCatPenalty)
      : DEFAULTS.adjacentCatPenalty,
    adjacentTagPenalty: Number.isFinite(Number(o.adjacentTagPenalty))
      ? Number(o.adjacentTagPenalty)
      : DEFAULTS.adjacentTagPenalty
  }
}

function categoryKey(item) {
  if (!item || typeof item !== 'object') return '_none'
  const key = String(
    item.rootCategoryId ||
      item.rootCategoryName ||
      item.categoryId ||
      item.category ||
      ''
  ).trim()
  return key || '_none'
}

/** 主标签：tags[0]；无则空串（不进窗口，避免假碰撞） */
function primaryTagKey(item) {
  if (!item || typeof item !== 'object') return ''
  const tags = Array.isArray(item.tags) ? item.tags : []
  for (let i = 0; i < tags.length; i++) {
    const t = String(tags[i] || '').trim().toLowerCase()
    if (t) return t
  }
  return ''
}

function productIdKey(item) {
  if (!item || item._id == null || item._id === '') return ''
  return String(item._id)
}

function pushWindow(arr, value, size) {
  if (value == null || value === '') return
  arr.push(value)
  while (arr.length > size) arr.shift()
}

/**
 * 窗口内多样性加分：相邻同 key → 0；未出现 → 满分；窗内按距离衰减
 */
function windowBonus(recent, key, weight, windowSize) {
  if (!key || key === '_none') return weight * 0.25
  if (!recent.length) return weight
  const last = recent[recent.length - 1]
  if (last === key) return 0
  const idx = recent.lastIndexOf(key)
  if (idx < 0) return weight
  const dist = recent.length - 1 - idx // 1 = 隔一个
  return weight * Math.min(1, dist / windowSize)
}

function scoreCandidate(item, indexInLookahead, lookaheadLen, recentCats, recentTags, opts) {
  const recency = lookaheadLen <= 1 ? 1 : 1 - indexInLookahead / (lookaheadLen - 1)
  const cat = windowBonus(recentCats, categoryKey(item), opts.wCat, opts.windowSize)
  const tag = windowBonus(recentTags, primaryTagKey(item), opts.wTag, opts.windowSize)
  return recency * opts.wTime + cat + tag
}

function pickBestIndex(pool, recentCats, recentTags, opts, lookaheadOverride) {
  if (!pool.length) return -1
  const n = Math.min(
    Math.max(1, lookaheadOverride || opts.lookahead),
    pool.length
  )
  const lastCat = recentCats.length ? recentCats[recentCats.length - 1] : ''
  const lastTag = recentTags.length ? recentTags[recentTags.length - 1] : ''
  let hasAltCat = false
  let hasAltTag = false
  if (lastCat || lastTag) {
    for (let i = 0; i < n; i++) {
      if (lastCat && categoryKey(pool[i]) !== lastCat) hasAltCat = true
      const tag = primaryTagKey(pool[i])
      if (lastTag && tag && tag !== lastTag) hasAltTag = true
      if (hasAltCat && hasAltTag) break
    }
  }

  let bestI = 0
  let bestScore = -Infinity
  for (let i = 0; i < n; i++) {
    let score = scoreCandidate(pool[i], i, n, recentCats, recentTags, opts)
    // 有可选异类时，硬压相邻同品类/同主标签
    if (hasAltCat && lastCat && categoryKey(pool[i]) === lastCat) {
      score -= opts.adjacentCatPenalty
    }
    const tag = primaryTagKey(pool[i])
    if (hasAltTag && lastTag && tag && tag === lastTag) {
      score -= opts.adjacentTagPenalty
    }
    // 同分保留更靠前（更新）的候选
    if (score > bestScore) {
      bestScore = score
      bestI = i
    }
  }
  return bestI
}

/**
 * 对已按时间新→旧排好的列表做整表打散（再切片分页）
 */
function diversifyByCategoryAndTag(items, options) {
  const opts = normalizeOpts(options)
  const pool = (items || []).slice()
  const out = []
  const recentCats = []
  const recentTags = []
  while (pool.length) {
    const i = pickBestIndex(pool, recentCats, recentTags, opts)
    const [picked] = pool.splice(i, 1)
    out.push(picked)
    pushWindow(recentCats, categoryKey(picked), opts.windowSize)
    pushWindow(recentTags, primaryTagKey(picked), opts.windowSize)
  }
  return out
}

/**
 * 流式打散器：跨页复用 recent 窗口与候选池，避免翻页后重新成片同质
 */
function createFeedDiversifier(options) {
  const opts = normalizeOpts(options)
  let pool = []
  const recentCats = []
  const recentTags = []
  const seen = new Set()

  function pushCandidates(items) {
    ;(items || []).forEach((item) => {
      const id = productIdKey(item)
      if (id) {
        if (seen.has(id)) return
        seen.add(id)
      }
      pool.push(item)
    })
  }

  /**
   * @param {number} count
   * @param {{ drain?: boolean }} [takeOpts] drain=true 时对整池选择（库已耗尽收尾）
   */
  function take(count, takeOpts) {
    const need = Math.max(0, Number(count) || 0)
    const drain = !!(takeOpts && takeOpts.drain)
    const out = []
    while (out.length < need && pool.length) {
      const lookahead = drain ? pool.length : undefined
      const i = pickBestIndex(pool, recentCats, recentTags, opts, lookahead)
      if (i < 0) break
      const [picked] = pool.splice(i, 1)
      out.push(picked)
      pushWindow(recentCats, categoryKey(picked), opts.windowSize)
      pushWindow(recentTags, primaryTagKey(picked), opts.windowSize)
    }
    return out
  }

  return {
    pushCandidates,
    take,
    pendingCount() {
      return pool.length
    },
    reset() {
      pool = []
      recentCats.length = 0
      recentTags.length = 0
      seen.clear()
    }
  }
}

module.exports = {
  DEFAULTS,
  categoryKey,
  primaryTagKey,
  diversifyByCategoryAndTag,
  createFeedDiversifier
}
