/**
 * 与 utils/categoryTree.js 保持同步（云函数部署不包含小程序 utils 目录）
 */
const {
  CANONICAL_ROOT_NAMES,
  LEGACY_ROOT_ALIASES,
  toCanonicalRootName,
  toRootDisplayName,
  formatCategoryDisplayName
} = require('../seedCategories/categorySeed')

const PAGE_SIZE = 100

function isActiveCategory(c) {
  if (!c) return false
  if (c.mergedInto) return false
  if (c.active === false) return false
  const s = c.status
  return s !== 'inactive' && s !== 'deleted'
}

function resolveCanonicalRootName(name) {
  if (!name) return ''
  return toCanonicalRootName(name) || LEGACY_ROOT_ALIASES[name] || name
}

function rootOrderKey(root) {
  return root.sort != null ? root.sort : (root.sortOrder != null ? root.sortOrder : 999)
}

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

function sortByOrder(a, b) {
  const sa = a.sort != null ? a.sort : (a.sortOrder != null ? a.sortOrder : 999)
  const sb = b.sort != null ? b.sort : (b.sortOrder != null ? b.sortOrder : 999)
  return sa - sb
}

function resolveSubParentId(sub) {
  if (!sub) return ''
  return String(sub.parentId || sub.rootCategoryId || sub.parent_id || '').trim()
}

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

async function fetchCategoriesByLevel(db, level) {
  const all = []
  const seen = new Set()
  let skip = 0
  let guard = 0
  while (guard < 50) {
    guard += 1
    const res = await db.collection('categories').where({ level }).skip(skip).limit(PAGE_SIZE).get()
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

function buildCategoryPickerTree(roots, subs, options = {}) {
  const canonicalOnly = options.canonicalOnly !== false
  const activeRoots = (roots || []).filter(isActiveCategory)
  const rootList = canonicalOnly ? filterCanonicalRoots(activeRoots) : activeRoots.sort(sortByOrder)
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

async function loadCategoryPickerTree(db, options = {}) {
  const [roots, subs] = await Promise.all([
    fetchCategoriesByLevel(db, 1),
    fetchCategoriesByLevel(db, 2)
  ])
  return buildCategoryPickerTree(roots, subs, options)
}

module.exports = {
  loadCategoryPickerTree,
  filterCanonicalRoots,
  CANONICAL_ROOT_NAMES,
  toRootDisplayName,
  formatCategoryDisplayName
}
