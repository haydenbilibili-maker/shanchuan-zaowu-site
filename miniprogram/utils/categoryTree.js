/**
 * categories 集合 — 分页拉取 + 构建一二级树
 * 微信云数据库单次 get 默认最多 20 条，必须 skip/limit 分页。
 *
 * options.canonicalOnly
 *   true  — C 端馆藏：仅白名单一级馆（旧名映射）
 *   false — 店长「分类管理」/「录入藏品」与 Admin：展示库内全部有效一级/二级
 */

const {
  CANONICAL_ROOT_NAMES,
  LEGACY_ROOT_ALIASES,
  toCanonicalRootName,
  toRootDisplayName,
  formatCategoryDisplayName
} = require('./categorySeed')

const PAGE_SIZE = 20 // 微信客户端单次 get 上限通常为 20；勿用更大值判断“是否还有下一页”

function isActiveCategory(c) {
  if (!c) return false
  // 已合并项即使 status 未及时改写，也不应再展示
  if (c.mergedInto) return false
  // Admin 二级用 active 布尔；种子/店长同步用 status 字符串
  if (c.active === false) return false
  const s = c.status
  return s !== 'inactive' && s !== 'deleted'
}

function isLevel1(c) {
  return Number(c.level) === 1
}

function isLevel2(c) {
  return Number(c.level) === 2
}

function resolveCanonicalRootName(name) {
  if (!name) return ''
  return toCanonicalRootName(name) || LEGACY_ROOT_ALIASES[name] || name
}

function rootOrderKey(root) {
  return root.sort != null ? root.sort : (root.sortOrder != null ? root.sortOrder : 999)
}

/** 同一 canonical 下多条一级文档时，与 Admin 排序一致地择优 */
function shouldPreferCanonicalRoot(candidate, existing, canonical) {
  const candFallback = String(candidate._id || '').startsWith('fallback_')
  const existFallback = String(existing._id || '').startsWith('fallback_')
  if (existFallback && !candFallback) return true
  if (candFallback && !existFallback) return false
  const sa = rootOrderKey(candidate)
  const sb = rootOrderKey(existing)
  if (sa !== sb) return sa < sb
  const candName = String(candidate.name || '').trim()
  const existName = String(existing.name || '').trim()
  if (candName !== canonical && existName === canonical) return true
  if (existName !== canonical && candName === canonical) return false
  return false
}

/** 白名单一级馆；展示名与 sort 与 Admin 云库一致（不按种子固定顺序重排） */
function filterCanonicalRoots(roots) {
  const byCanonical = new Map()

  ;(roots || []).forEach((root) => {
    const canonical = resolveCanonicalRootName(root.name)
    if (!canonical || !CANONICAL_ROOT_NAMES.includes(canonical)) return

    const displayName = String(root.name || '').trim() || canonical
    const existing = byCanonical.get(canonical)
    if (!existing) {
      byCanonical.set(canonical, { ...root, name: displayName })
      return
    }
    if (shouldPreferCanonicalRoot(root, existing, canonical)) {
      const name = String(root.name || '').trim() || existing.name || canonical
      byCanonical.set(canonical, { ...root, name })
    }
  })

  return Array.from(byCanonical.values()).sort(sortByOrder)
}

function dedupeCategoriesByName(list) {
  const seen = new Set()
  return (list || []).filter((item) => {
    const name = String(item.name || '').trim()
    if (!name || seen.has(name)) return false
    seen.add(name)
    return true
  })
}

/** 与 Admin 一致：优先 sort，其次 sortOrder */
function sortByOrder(a, b) {
  const sa = a.sort != null ? a.sort : (a.sortOrder != null ? a.sortOrder : 999)
  const sb = b.sort != null ? b.sort : (b.sortOrder != null ? b.sortOrder : 999)
  return sa - sb
}

/** 二级 parentId 归一：Admin 可能写 rootCategoryId 或指向旧一级 _id */
function resolveSubParentId(sub) {
  if (!sub) return ''
  return String(sub.parentId || sub.rootCategoryId || sub.parent_id || '').trim()
}

/**
 * 多个一级馆文档（旧名/新名）映射到展示用 canonical 根 _id，
 * 避免 Admin 挂在旧 _id 下的二级在 C 端 subMap 里丢失。
 */
function buildRootIdResolver(allRoots, rootList, canonicalOnly) {
  const chosenByCanonical = new Map()
  ;(rootList || []).forEach((r) => {
    const canonical = resolveCanonicalRootName(r.name)
    if (!canonicalOnly || CANONICAL_ROOT_NAMES.includes(canonical)) {
      if (!chosenByCanonical.has(canonical)) chosenByCanonical.set(canonical, r._id)
    }
  })

  const rootById = new Map()
  ;(allRoots || []).forEach((r) => {
    if (r && r._id) rootById.set(r._id, r)
  })

  return (parentId) => {
    const id = String(parentId || '').trim()
    if (!id) return ''
    const root = rootById.get(id)
    if (!root) return id
    const canonical = resolveCanonicalRootName(root.name)
    if (canonicalOnly && !CANONICAL_ROOT_NAMES.includes(canonical)) return id
    return chosenByCanonical.get(canonical) || id
  }
}

async function fetchCategoryPage(db, level, skip) {
  // 禁止 orderBy：缺 sortOrder/sort 字段的文档会被云库静默排除，
  // Admin 新建二级常只写 sort，导致店长分类管理「开启却看不到」。
  return db.collection('categories').where({ level }).skip(skip).limit(PAGE_SIZE).get()
}

/**
 * 分页拉取指定 level 的全部分类（客户端排序，与 Admin CDN 拉取策略一致）
 * 注意：必须以「本批实际条数」推进 skip；若用固定 PAGE_SIZE 而客户端被截成 20，
 * 会在第一页就误判结束，动物馆/衍生品等后半段二级全部丢失。
 */
async function fetchCategoriesByLevel(db, level) {
  const all = []
  const seen = new Set()
  let skip = 0
  let guard = 0
  while (guard < 50) {
    guard += 1
    const res = await fetchCategoryPage(db, level, skip)
    const batch = res.data || []
    if (!batch.length) break
    batch.forEach((doc) => {
      if (!doc || !doc._id || seen.has(doc._id)) return
      seen.add(doc._id)
      all.push(doc)
    })
    skip += batch.length
    if (batch.length < PAGE_SIZE) break
  }
  return all.filter(isActiveCategory).sort(sortByOrder)
}

/**
 * 统计各 categoryId 下商品数（客户端分页，避免 orderBy 漏数）
 */
async function fetchProductCountsByCategoryId(db) {
  const counts = {}
  let skip = 0
  let guard = 0
  while (guard < 100) {
    guard += 1
    let batch = []
    try {
      const res = await db.collection('products').field({ categoryId: true }).skip(skip).limit(PAGE_SIZE).get()
      batch = res.data || []
    } catch (e) {
      const res = await db.collection('products').skip(skip).limit(PAGE_SIZE).get()
      batch = res.data || []
    }
    if (!batch.length) break
    batch.forEach((p) => {
      const id = p && p.categoryId
      if (!id) return
      counts[id] = (counts[id] || 0) + 1
    })
    skip += batch.length
    if (batch.length < PAGE_SIZE) break
  }
  return counts
}

/**
 * 构建藏品编辑用的一二级树
 * @param {object} [options]
 * @param {boolean} [options.canonicalOnly=true] 是否仅白名单 6 馆
 */
function buildCategoryPickerTree(roots, subs, options = {}) {
  const canonicalOnly = options.canonicalOnly !== false
  const activeRoots = (roots || []).filter(isActiveCategory)
  const rootList = canonicalOnly
    ? filterCanonicalRoots(activeRoots)
    : activeRoots.sort(sortByOrder)
  const allowedRootIds = new Set(rootList.map((r) => r._id))
  const resolveRootId = buildRootIdResolver(activeRoots, rootList, canonicalOnly)
  const subMap = {}

  ;(subs || []).forEach((c) => {
    if (!isActiveCategory(c)) return
    const parentId = resolveRootId(resolveSubParentId(c))
    if (!parentId || !allowedRootIds.has(parentId)) return
    if (!subMap[parentId]) subMap[parentId] = []
    subMap[parentId].push(c)
  })

  Object.keys(subMap).forEach((pid) => {
    subMap[pid] = dedupeCategoriesByName(subMap[pid]).sort(sortByOrder)
  })

  return {
    categoryRoots: rootList,
    categorySubMap: subMap,
    rootNames: rootList.map((c) => c.name)
  }
}

/**
 * 拉取 categories 集合并构建 Picker 树
 * @param {object} db
 * @param {object} [options] 传给 buildCategoryPickerTree（如 { canonicalOnly: false }）
 */
async function loadCategoryPickerTree(db, options = {}) {
  const [roots, subs] = await Promise.all([
    fetchCategoriesByLevel(db, 1),
    fetchCategoriesByLevel(db, 2)
  ])
  const tree = buildCategoryPickerTree(roots, subs, options)
  return { ...tree, allSubs: subs }
}

/** 云函数 / 无 db 实例时：传入已拉取的 roots、subs */
function buildCategoryPickerTreeFromDocs(roots, subs, options = {}) {
  const tree = buildCategoryPickerTree(roots, subs, options)
  return { ...tree, allSubs: subs }
}

/** 分类管理页用的完整树（含 children）；默认与 Admin 一致拉全量有效分类 */
function buildCategoryManageTree(roots, subs, options = {}) {
  const opts = { canonicalOnly: false, ...options }
  const counts = options.productCounts || null
  const { categoryRoots, categorySubMap } = buildCategoryPickerTree(roots, subs, opts)
  const categoryManageTree = categoryRoots
    .map((r) => ({
      ...r,
      children: (categorySubMap[r._id] || []).map((s) => ({
        ...s,
        productCount: counts ? (counts[s._id] || 0) : (s.productCount || 0)
      }))
    }))
  return {
    categoryManageTree,
    catManageRootNames: categoryRoots.map((r) => r.name),
    categories: [...categoryRoots, ...Object.values(categorySubMap).flat()],
    categoryRoots,
    categorySubMap
  }
}

module.exports = {
  isActiveCategory,
  isLevel1,
  isLevel2,
  resolveCanonicalRootName,
  filterCanonicalRoots,
  dedupeCategoriesByName,
  fetchCategoriesByLevel,
  fetchProductCountsByCategoryId,
  buildCategoryPickerTree,
  loadCategoryPickerTree,
  buildCategoryPickerTreeFromDocs,
  resolveSubParentId,
  buildCategoryManageTree,
  CANONICAL_ROOT_NAMES,
  toRootDisplayName,
  formatCategoryDisplayName,
  PAGE_SIZE
}
