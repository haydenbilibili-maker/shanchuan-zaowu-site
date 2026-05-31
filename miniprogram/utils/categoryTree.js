/**
 * categories 集合 — 分页拉取 + 构建一二级树
 * 微信云数据库单次 get 默认最多 20 条，必须 skip/limit 分页。
 */

const {
  CANONICAL_ROOT_NAMES,
  LEGACY_ROOT_ALIASES
} = require('./categorySeed')

const PAGE_SIZE = 100

function isActiveCategory(c) {
  if (!c) return false
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
  return LEGACY_ROOT_ALIASES[name] || name
}

/** 仅保留白名单内 6 个一级馆，旧名映射到精简馆名 */
function filterCanonicalRoots(roots) {
  const byCanonical = new Map()

  ;(roots || []).forEach((root) => {
    const canonical = resolveCanonicalRootName(root.name)
    if (!CANONICAL_ROOT_NAMES.includes(canonical)) return

    const existing = byCanonical.get(canonical)
    if (!existing) {
      byCanonical.set(canonical, { ...root, name: canonical })
      return
    }
    // 优先保留名称已是精简馆名的记录
    if (root.name === canonical && existing.name !== canonical) {
      byCanonical.set(canonical, { ...root, name: canonical })
    }
  })

  return CANONICAL_ROOT_NAMES
    .map((name) => byCanonical.get(name))
    .filter(Boolean)
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
  return (a.sortOrder || a.sort || 999) - (b.sortOrder || b.sort || 999)
}

async function fetchCategoryPage(db, level, skip) {
  let query = db.collection('categories').where({ level })
  try {
    return await query.orderBy('sortOrder', 'asc').skip(skip).limit(PAGE_SIZE).get()
  } catch (e) {
    console.warn('fetchCategoryPage orderBy sortOrder failed, fallback', e)
    return await db.collection('categories').where({ level }).skip(skip).limit(PAGE_SIZE).get()
  }
}

/** 分页拉取指定 level 的全部分类 */
async function fetchCategoriesByLevel(db, level) {
  const all = []
  let skip = 0
  while (true) {
    const res = await fetchCategoryPage(db, level, skip)
    const batch = res.data || []
    all.push(...batch)
    if (batch.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }
  return all.filter(isActiveCategory).sort(sortByOrder)
}

/** 构建藏品编辑用的一二级树 */
function buildCategoryPickerTree(roots, subs) {
  const rootList = filterCanonicalRoots(roots)
  const allowedRootIds = new Set(rootList.map((r) => r._id))
  const subMap = {}

  subs.forEach((c) => {
    if (!c.parentId || !allowedRootIds.has(c.parentId)) return
    if (!subMap[c.parentId]) subMap[c.parentId] = []
    subMap[c.parentId].push(c)
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

/** 拉取 categories 集合并构建 Picker 树 */
async function loadCategoryPickerTree(db) {
  const [roots, subs] = await Promise.all([
    fetchCategoriesByLevel(db, 1),
    fetchCategoriesByLevel(db, 2)
  ])
  const tree = buildCategoryPickerTree(roots, subs)
  return { ...tree, allSubs: subs }
}

/** 分类管理页用的完整树（含 children） */
function buildCategoryManageTree(roots, subs) {
  const { categoryRoots, categorySubMap } = buildCategoryPickerTree(roots, subs)
  const categoryManageTree = categoryRoots
    .map((r) => ({ ...r, children: categorySubMap[r._id] || [] }))
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
  buildCategoryPickerTree,
  loadCategoryPickerTree,
  buildCategoryManageTree,
  CANONICAL_ROOT_NAMES
}
