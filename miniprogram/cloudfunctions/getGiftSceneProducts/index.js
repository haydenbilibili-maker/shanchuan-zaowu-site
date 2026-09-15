/**
 * 礼赠场景选品
 *
 * 入参：
 *   scene     string   场景 key（必填，见 giftScenes.js）
 *   limit     number   每批数量，默认 8，最大 20
 *   offset    number   仅无 exclude 时的场景池分页（兼容旧客户端）
 *   excludeIds string[] 已展示过的商品 id（换一批时传入）
 *   category  string   可选，兜底时优先同品类
 *
 * 匹配规则：
 *   1. 仅 giftEligible !== false 且未下架
 *   2. 场景命中始终排在兜底之前
 *   3. 同组内：销量 → 更新时间 → 价格带
 *   4. 换一批：按 excludeIds 从剩余场景池取下一批；场景耗尽后再用兜底补齐
 */
const cloud = require('wx-server-sdk')
const {
  GIFT_SCENES,
  getSceneByKey,
  sanitizeGiftScenes
} = require('./giftScenes')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function uniqById(list) {
  const seen = {}
  const out = []
  ;(list || []).forEach((item) => {
    if (!item || !item._id) return
    const id = String(item._id)
    if (seen[id]) return
    seen[id] = 1
    out.push(item)
  })
  return out
}

function isGiftEligible(row) {
  return !(row && row.giftEligible === false)
}

function isOnShelf(row) {
  return !(row && row.isOffShelf === true)
}

function leanProduct(row, matchSource) {
  const scenes = sanitizeGiftScenes(row && row.giftScenes)
  return {
    _id: row._id,
    title: row.title || row.name || '',
    latinName: row.latinName || '',
    price: row.price,
    images: Array.isArray(row.images) ? row.images.slice(0, 3) : [],
    category: row.category || '',
    rootCategoryName: row.rootCategoryName || '',
    giftScenes: scenes,
    giftEligible: isGiftEligible(row),
    protectionType: row.protectionType || 'none',
    matchSource: matchSource || 'scene',
    sales: Number(row.sales) || 0
  }
}

/** 同组排序：热度(销量) → 较新上架 → 价格适中优先（中档略前） */
function sortGiftPool(rows) {
  const list = (rows || []).slice()
  const prices = list
    .map((p) => Number(p.price))
    .filter((n) => Number.isFinite(n) && n > 0)
  const mid =
    prices.length > 0
      ? prices.slice().sort((a, b) => a - b)[Math.floor(prices.length / 2)]
      : 0

  list.sort((a, b) => {
    const sa = Number(a.sales) || 0
    const sb = Number(b.sales) || 0
    if (sb !== sa) return sb - sa

    const ta = new Date(a.updatedAt || a.updateTime || a.createdAt || a.createTime || 0).getTime() || 0
    const tb = new Date(b.updatedAt || b.updateTime || b.createdAt || b.createTime || 0).getTime() || 0
    if (tb !== ta) return tb - ta

    const pa = Number(a.price)
    const pb = Number(b.price)
    if (Number.isFinite(pa) && Number.isFinite(pb) && mid > 0) {
      const da = Math.abs(pa - mid)
      const db = Math.abs(pb - mid)
      if (da !== db) return da - db
      return pa - pb
    }
    if (Number.isFinite(pa) && Number.isFinite(pb)) return pa - pb
    return String(a._id).localeCompare(String(b._id))
  })
  return list
}

async function querySafe(where, limit) {
  try {
    const res = await db.collection('products').where(where).limit(limit).get()
    return res.data || []
  } catch (e) {
    try {
      const loose = { ...where }
      delete loose.isOffShelf
      delete loose.giftEligible
      const res = await db.collection('products').where(loose).limit(limit).get()
      return (res.data || []).filter((p) => isOnShelf(p) && isGiftEligible(p))
    } catch (err) {
      console.warn('getGiftSceneProducts query', err)
      return []
    }
  }
}

async function queryByScene(scene, take) {
  const where = {
    giftScenes: scene,
    isOffShelf: _.neq(true),
    giftEligible: _.neq(false)
  }
  return querySafe(where, take)
}

async function queryByCategory(category, take, excludeSet) {
  if (!category) return []
  const where = {
    category: String(category).trim(),
    isOffShelf: _.neq(true),
    giftEligible: _.neq(false)
  }
  const rows = await querySafe(where, take)
  return rows.filter((p) => !excludeSet.has(String(p._id)))
}

async function queryHotGift(take, excludeSet) {
  let rows = []
  try {
    const res = await db
      .collection('products')
      .where({
        isOffShelf: _.neq(true),
        giftEligible: _.neq(false)
      })
      .orderBy('sales', 'desc')
      .limit(take)
      .get()
    rows = res.data || []
  } catch (e) {
    try {
      const res = await db
        .collection('products')
        .where({ isOffShelf: _.neq(true) })
        .limit(take)
        .get()
      rows = (res.data || []).filter(isGiftEligible)
    } catch (err) {
      const res = await db.collection('products').limit(take).get()
      rows = (res.data || []).filter((p) => isOnShelf(p) && isGiftEligible(p))
    }
  }
  return rows.filter((p) => !excludeSet.has(String(p._id)))
}

function shuffle(list) {
  const arr = list.slice()
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

exports.main = async (event) => {
  const sceneKey = String((event && event.scene) || '')
    .trim()
    .toLowerCase()
  const sceneMeta = getSceneByKey(sceneKey)
  if (!sceneMeta) {
    return {
      success: false,
      msg: '未知礼赠场景',
      scenes: GIFT_SCENES.map((s) => ({
        key: s.key,
        label: s.label,
        guide: s.guide
      }))
    }
  }

  const take = Math.min(20, Math.max(1, parseInt((event && event.limit) || '8', 10) || 8))
  const offset = Math.max(0, parseInt((event && event.offset) || '0', 10) || 0)
  const category = String((event && event.category) || '').trim()
  const excludeIds = Array.isArray(event && event.excludeIds)
    ? event.excludeIds.map((id) => String(id || '').trim()).filter(Boolean)
    : []
  const excludeSet = new Set(excludeIds)
  const useExcludeCursor = excludeIds.length > 0

  try {
    const poolTake = Math.min(120, Math.max(take * 6, offset + take * 3, 40))
    let sceneHits = await queryByScene(sceneKey, poolTake)
    sceneHits = uniqById(sceneHits).filter(
      (p) => isOnShelf(p) && isGiftEligible(p)
    )
    sceneHits = sortGiftPool(sceneHits)

    const sceneRemaining = sceneHits.filter((p) => !excludeSet.has(String(p._id)))
    // 有 exclude：从剩余场景池头取；无 exclude：按 offset 分页（首屏）
    let scenePage = useExcludeCursor
      ? sceneRemaining.slice(0, take)
      : sceneRemaining.slice(offset, offset + take)

    const matched = scenePage.map((p) => leanProduct(p, 'scene'))
    let usedFallback = false

    if (matched.length < take) {
      usedFallback = true
      const have = new Set(matched.map((p) => String(p._id)))
      excludeSet.forEach((id) => have.add(id))
      // 场景池已见过的也不再兜底重复
      sceneHits.forEach((p) => have.add(String(p._id)))

      const need = take - matched.length
      let fallback = []
      if (category) {
        fallback = await queryByCategory(category, need * 4, have)
      }
      if (fallback.length < need) {
        const hot = await queryHotGift(need * 5, have)
        fallback = uniqById(fallback.concat(hot))
      }
      // 兜底也先按热度/时间排，再轻度打散，避免总同一批顶上
      fallback = sortGiftPool(fallback)
      const head = fallback.slice(0, Math.min(need * 2, fallback.length))
      fallback = shuffle(head).slice(0, need)
      fallback.forEach((p) => {
        matched.push(leanProduct(p, 'fallback'))
      })
    }

    // 场景仍有未展示 → 可换一批继续场景优先；否则客户端应清空 seen 重开
    const afterExcludeRemaining = sceneRemaining.length - scenePage.length
    const hasMoreScene = afterExcludeRemaining > 0

    return {
      success: true,
      scene: {
        key: sceneMeta.key,
        label: sceneMeta.label,
        guide: sceneMeta.guide,
        noteHint: sceneMeta.noteHint
      },
      data: matched.slice(0, take),
      count: matched.length,
      sceneHitTotal: sceneHits.length,
      sceneInBatch: scenePage.length,
      usedFallback,
      hasMoreScene,
      offset: useExcludeCursor ? 0 : offset,
      limit: take
    }
  } catch (e) {
    console.error('getGiftSceneProducts', e)
    return {
      success: false,
      msg: e.message || '选品失败',
      data: []
    }
  }
}
