const cloud = require('wx-server-sdk')
const {
  DEFAULT_CATEGORY_TREE,
  CANONICAL_ROOT_NAMES,
  LEGACY_ROOT_ALIASES,
  LEGACY_CHILD_ALIASES,
  EXTRA_L2_LATIN_DEFAULTS,
  buildCategoryDoc,
  deriveLatinName
} = require('./categorySeed')
const communitySeed = require('./communitySeedRunner')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PAGE_SIZE = 100
const LINK_PREVIEW_LIMIT = 30
const LINK_BATCH_CAP = 200

async function fetchAll(queryBuilder) {
  const all = []
  let skip = 0
  while (true) {
    const res = await queryBuilder.skip(skip).limit(PAGE_SIZE).get()
    const batch = res.data || []
    all.push(...batch)
    if (batch.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }
  return all
}

async function fetchAllCategories() {
  return fetchAll(db.collection('categories'))
}

async function findRootByName(name) {
  const res = await db.collection('categories').where({ level: 1, name }).limit(1).get()
  return (res.data && res.data[0]) || null
}

async function findChild(parentId, name) {
  const res = await db.collection('categories')
    .where({ level: 2, parentId, name })
    .limit(1)
    .get()
  return (res.data && res.data[0]) || null
}

async function upsertCategory(doc, existing) {
  const data = { ...doc, updatedAt: db.serverDate() }
  if (existing && existing._id) {
    await db.collection('categories').doc(existing._id).update({ data })
    return existing._id
  }
  const addRes = await db.collection('categories').add({
    data: { ...data, createdAt: db.serverDate() }
  })
  return addRes._id
}

const CANONICAL_ROOT_SET = new Set(CANONICAL_ROOT_NAMES)

function isLevel1(c) {
  return Number(c.level) === 1
}

function legacyNamesForCanonical(canonicalName) {
  const names = new Set([canonicalName])
  Object.entries(LEGACY_ROOT_ALIASES).forEach(([legacy, target]) => {
    if (target === canonicalName) names.add(legacy)
  })
  return [...names]
}

function resolveTargetRootName(name) {
  if (!name) return ''
  if (CANONICAL_ROOT_SET.has(name)) return name
  if (LEGACY_ROOT_ALIASES[name]) return LEGACY_ROOT_ALIASES[name]
  if (/衍生|文创|周边|礼品|包装|书籍|工具|耗材|联名|陈饰/.test(name)) return '衍生品'
  return ''
}

async function getCanonicalRootIdMap() {
  const map = {}
  for (const name of CANONICAL_ROOT_NAMES) {
    const doc = await findRootByName(name)
    if (doc && doc._id) map[name] = doc._id
  }
  return map
}

/** 停用白名单外的一切一级分类，并将其二级迁移到目标馆 */
async function purgeNonCanonicalRoots(stats) {
  const all = await fetchAllCategories()
  const activeRoots = all.filter((c) => isLevel1(c) && isActiveCategory(c))
  const canonicalIds = await getCanonicalRootIdMap()

  for (const root of activeRoots) {
    const canonicalName = resolveTargetRootName(root.name)
    if (canonicalName && CANONICAL_ROOT_SET.has(root.name)) continue

    const targetId = canonicalName ? canonicalIds[canonicalName] : null

    if (targetId && root._id !== targetId) {
      await reparentChildren(root._id, targetId, stats)
      await migrateProductRootIds(root._id, targetId, canonicalName, stats)
    } else if (!targetId) {
      const children = await fetchAll(
        db.collection('categories').where({ level: 2, parentId: root._id })
      )
      for (const child of children) {
        if (!isActiveCategory(child)) continue
        await db.collection('categories').doc(child._id).update({
          data: {
            status: 'inactive',
            active: false,
            updatedAt: db.serverDate()
          }
        })
        stats.childrenMerged += 1
      }
    }

    if (root._id === targetId) continue

    await db.collection('categories').doc(root._id).update({
      data: {
        status: 'inactive',
        active: false,
        mergedInto: targetId || null,
        updatedAt: db.serverDate()
      }
    })
    stats.rootsPurged = (stats.rootsPurged || 0) + 1
  }

  // 合并同名精简馆重复记录（如两个「昆虫馆」）
  const refreshedRoots = (await fetchAllCategories()).filter(
    (c) => isLevel1(c) && isActiveCategory(c)
  )
  for (const name of CANONICAL_ROOT_NAMES) {
    const dupes = refreshedRoots.filter((r) => r.name === name)
    if (dupes.length <= 1) continue

    dupes.sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99))
    const survivor = dupes[0]
    canonicalIds[name] = survivor._id

    for (let i = 1; i < dupes.length; i++) {
      await reparentChildren(dupes[i]._id, survivor._id, stats)
      await db.collection('categories').doc(dupes[i]._id).update({
        data: {
          status: 'inactive',
          active: false,
          mergedInto: survivor._id,
          updatedAt: db.serverDate()
        }
      })
      stats.rootsMerged += 1
    }
  }
}

async function migrateProductRootIds(fromRootId, toRootId, canonicalName, stats) {
  let skip = 0
  while (true) {
    const res = await db.collection('products')
      .where({ rootCategoryId: fromRootId })
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()
    const batch = res.data || []
    if (!batch.length) break

    await Promise.all(batch.map((p) =>
      db.collection('products').doc(p._id).update({
        data: {
          rootCategoryId: toRootId,
          rootCategoryName: canonicalName || p.rootCategoryName,
          updatedAt: db.serverDate()
        }
      })
    ))
    stats.productsUpdated += batch.length
    if (batch.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }
}

async function loadCategoryById(id) {
  if (!id) return null
  try {
    const res = await db.collection('categories').doc(id).get()
    return res.data || null
  } catch (e) {
    return null
  }
}

function normalizeCatKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·・‧.]/g, '')
}

/** 二级名及其旧别名集合（含自身） */
function childNameAliases(canonicalOrRaw) {
  const raw = String(canonicalOrRaw || '').trim()
  if (!raw) return []
  const names = new Set([raw])
  const short = raw.split(/[·・]/)[0].trim()
  if (short) names.add(short)
  const legacyTarget = LEGACY_CHILD_ALIASES[raw] || LEGACY_CHILD_ALIASES[short]
  if (legacyTarget) {
    names.add(legacyTarget)
    const legacyShort = String(legacyTarget).split(/[·・]/)[0].trim()
    if (legacyShort) names.add(legacyShort)
  }
  Object.entries(LEGACY_CHILD_ALIASES).forEach(([legacy, target]) => {
    if (target === raw || legacy === raw || target === legacyTarget || legacy === short) {
      names.add(legacy)
      names.add(target)
      const tShort = String(target || '').split(/[·・]/)[0].trim()
      if (tShort) names.add(tShort)
    }
  })
  return [...names].filter(Boolean)
}

async function buildProductCategoryPatch(targetCat) {
  if (!targetCat || !targetCat._id) return null
  const patch = {
    categoryId: targetCat._id,
    category: targetCat.name || '',
    updatedAt: db.serverDate()
  }
  if (targetCat.categoryType) patch.categoryType = targetCat.categoryType
  if (targetCat.parentId) {
    patch.rootCategoryId = targetCat.parentId
    const root = await loadCategoryById(targetCat.parentId)
    if (root && root.name) patch.rootCategoryName = root.name
  }
  return patch
}

async function migrateProductCategoryIds(fromId, toId, targetMeta) {
  if (!fromId || !toId || fromId === toId) return 0
  let patchBase = targetMeta || null
  if (!patchBase) {
    const toCat = await loadCategoryById(toId)
    patchBase = await buildProductCategoryPatch(toCat)
  }
  if (!patchBase) {
    patchBase = { categoryId: toId, updatedAt: db.serverDate() }
  }

  let updated = 0
  let skip = 0
  while (true) {
    const res = await db.collection('products').where({ categoryId: fromId }).skip(skip).limit(PAGE_SIZE).get()
    const batch = res.data || []
    if (!batch.length) break
    await Promise.all(batch.map((p) =>
      db.collection('products').doc(p._id).update({ data: { ...patchBase } })
    ))
    updated += batch.length
    if (batch.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }
  return updated
}

/** 按 category 字符串（旧名/别名）把商品迁到目标二级 */
async function migrateProductsByCategoryNames(nameList, toId, targetPatch, stats) {
  const names = [...new Set((nameList || []).map((n) => String(n || '').trim()).filter(Boolean))]
  if (!names.length || !toId || !targetPatch) return 0
  let updated = 0
  for (const name of names) {
    let skip = 0
    while (true) {
      const res = await db.collection('products')
        .where({ category: name })
        .skip(skip)
        .limit(PAGE_SIZE)
        .get()
      const batch = res.data || []
      if (!batch.length) break
      const need = batch.filter((p) => p.categoryId !== toId)
      if (need.length) {
        await Promise.all(need.map((p) =>
          db.collection('products').doc(p._id).update({ data: { ...targetPatch } })
        ))
        updated += need.length
        if (stats) stats.productsUpdated = (stats.productsUpdated || 0) + need.length
      }
      if (batch.length < PAGE_SIZE) break
      skip += batch.length
    }
  }
  return updated
}

async function reparentChildren(fromParentId, toParentId, stats) {
  const children = await fetchAll(
    db.collection('categories').where({ level: 2, parentId: fromParentId })
  )

  for (const child of children) {
    if (child.status === 'inactive') continue
    const existing = await findChild(toParentId, child.name)
    if (existing && existing._id !== child._id) {
      const targetPatch = await buildProductCategoryPatch(existing)
      const n = await migrateProductCategoryIds(child._id, existing._id, targetPatch)
      stats.productsUpdated += n
      await migrateProductsByCategoryNames(
        childNameAliases(child.name),
        existing._id,
        targetPatch,
        stats
      )
      await db.collection('categories').doc(child._id).update({
        data: {
          status: 'inactive',
          active: false,
          mergedInto: existing._id,
          updatedAt: db.serverDate()
        }
      })
      stats.childrenMerged += 1
    } else {
      await db.collection('categories').doc(child._id).update({
        data: {
          parentId: toParentId,
          updatedAt: db.serverDate()
        }
      })
      stats.childrenReparented += 1
    }
  }
}

function isActiveCategory(c) {
  if (!c) return false
  if (c.mergedInto) return false
  if (c.active === false) return false
  const s = c.status
  return s !== 'inactive' && s !== 'deleted'
}

async function findDuplicateL2() {
  const all = await fetchAllCategories()
  const l2 = all.filter((c) => Number(c.level) === 2 && isActiveCategory(c))
  const roots = all.filter((c) => Number(c.level) === 1)
  const rootNameById = {}
  roots.forEach((r) => { rootNameById[r._id] = r.name })

  const groupsMap = new Map()

  const ensureGroup = (key, label) => {
    if (!groupsMap.has(key)) {
      groupsMap.set(key, { key, label, items: [] })
    }
    return groupsMap.get(key)
  }

  for (const cat of l2) {
    const aliases = childNameAliases(cat.name)
    const canonical = LEGACY_CHILD_ALIASES[cat.name] || cat.name
    const key = `name:${normalizeCatKey(canonical)}`
    const group = ensureGroup(key, canonical)
    if (!group.items.some((i) => i._id === cat._id)) {
      group.items.push({
        _id: cat._id,
        name: cat.name,
        parentId: cat.parentId || '',
        parentName: rootNameById[cat.parentId] || '',
        productCount: 0
      })
    }
    // 近义：别名命中同一 canonical 但名字不同也进同组
    aliases.forEach((alias) => {
      if (alias === cat.name) return
      const aliasCanonical = LEGACY_CHILD_ALIASES[alias] || alias
      if (normalizeCatKey(aliasCanonical) !== normalizeCatKey(canonical)) return
    })
  }

  // 跨库脏数据：同 normalize key 但不同文档
  const byNorm = new Map()
  for (const cat of l2) {
    const nk = normalizeCatKey(cat.name)
    if (!nk) continue
    if (!byNorm.has(nk)) byNorm.set(nk, [])
    byNorm.get(nk).push(cat)
  }
  for (const [nk, list] of byNorm.entries()) {
    if (list.length <= 1) continue
    const key = `norm:${nk}`
    const group = ensureGroup(key, list[0].name)
    list.forEach((cat) => {
      if (!group.items.some((i) => i._id === cat._id)) {
        group.items.push({
          _id: cat._id,
          name: cat.name,
          parentId: cat.parentId || '',
          parentName: rootNameById[cat.parentId] || '',
          productCount: 0
        })
      }
    })
  }

  const groups = [...groupsMap.values()].filter((g) => g.items.length > 1)

  // 统计商品数
  for (const g of groups) {
    for (const item of g.items) {
      try {
        const cnt = await db.collection('products').where({ categoryId: item._id }).count()
        item.productCount = cnt.total || 0
      } catch (e) {
        item.productCount = 0
      }
    }
    g.items.sort((a, b) => (b.productCount - a.productCount) || String(a.name).localeCompare(String(b.name)))
    g.suggestedKeepId = g.items[0]._id
    g.totalProducts = g.items.reduce((s, i) => s + (i.productCount || 0), 0)
  }

  groups.sort((a, b) => (b.totalProducts - a.totalProducts) || b.items.length - a.items.length)
  return { groups, totalGroups: groups.length }
}

async function mergeL2Categories(fromId, toId, options = {}) {
  if (!fromId || !toId) return { success: false, msg: '缺少 fromId / toId' }
  if (fromId === toId) return { success: false, msg: '不能合并到自身' }

  const fromCat = await loadCategoryById(fromId)
  const toCat = await loadCategoryById(toId)
  if (!fromCat || Number(fromCat.level) !== 2) return { success: false, msg: '被合并项不是有效二级分类' }
  if (!toCat || Number(toCat.level) !== 2) return { success: false, msg: '保留项不是有效二级分类' }

  const dryRun = !!options.dryRun
  const targetPatch = await buildProductCategoryPatch(toCat)
  const nameAliases = childNameAliases(fromCat.name).concat(childNameAliases(toCat.name))

  let byIdCount = 0
  try {
    const c = await db.collection('products').where({ categoryId: fromId }).count()
    byIdCount = c.total || 0
  } catch (e) {
    byIdCount = 0
  }

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      from: { _id: fromId, name: fromCat.name, parentId: fromCat.parentId },
      to: { _id: toId, name: toCat.name, parentId: toCat.parentId },
      preview: {
        productsByCategoryId: byIdCount,
        nameAliases: [...new Set(nameAliases)]
      },
      msg: `预览：将「${fromCat.name}」并入「${toCat.name}」，约 ${byIdCount} 件按 ID 迁移`
    }
  }

  const stats = { productsUpdated: 0, productsByName: 0 }
  const n = await migrateProductCategoryIds(fromId, toId, targetPatch)
  stats.productsUpdated += n
  const byName = await migrateProductsByCategoryNames(
    childNameAliases(fromCat.name),
    toId,
    targetPatch,
    stats
  )
  stats.productsByName = byName

  await db.collection('categories').doc(fromId).update({
    data: {
      status: 'inactive',
      active: false,
      mergedInto: toId,
      updatedAt: db.serverDate()
    }
  })

  return {
    success: true,
    from: { _id: fromId, name: fromCat.name },
    to: { _id: toId, name: toCat.name },
    stats,
    msg: `已将「${fromCat.name}」并入「${toCat.name}」，迁移商品 ${stats.productsUpdated + stats.productsByName} 件`
  }
}

function productMatchesAutoRules(product, targetCat, rootDoc, nameSet) {
  const category = String(product.category || '').trim()
  const title = String(product.title || '').trim()
  const tags = Array.isArray(product.tags)
    ? product.tags.map((t) => String(t || '').trim()).filter(Boolean)
    : String(product.tags || '')
      .split(/[,，、\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)

  const reasons = []
  if (product.categoryId === targetCat._id) {
    reasons.push('already_linked')
    return { match: false, reasons }
  }

  if (category && nameSet.has(category)) {
    reasons.push('category_name')
  }

  const shortTarget = String(targetCat.name || '').split(/[·・]/)[0].trim()
  const shortBits = [targetCat.name, shortTarget].filter(Boolean)
  for (const bit of shortBits) {
    if (bit.length >= 2 && title.includes(bit)) {
      reasons.push('title')
      break
    }
  }

  for (const tag of tags) {
    if (nameSet.has(tag) || shortBits.some((b) => b && tag.includes(b))) {
      reasons.push('tag')
      break
    }
  }

  const noCatId = !product.categoryId
  const rootOk = rootDoc && (
    product.rootCategoryId === rootDoc._id ||
    childNameAliases(rootDoc.name).includes(product.rootCategoryName) ||
    collectRootAliasLocal(rootDoc.name).includes(product.rootCategoryName)
  )
  if (noCatId && (!category || category === '未分类' || category === '其它' || category === '其他')) {
    if (rootOk || !product.rootCategoryId) {
      reasons.push('uncategorized')
    }
  }

  // auto 模式：名称/标签命中即可；未分类仅在同馆时
  const autoHit = reasons.includes('category_name') || reasons.includes('title') || reasons.includes('tag')
  const uncategorizedHit = reasons.includes('uncategorized') && rootOk
  return { match: autoHit || uncategorizedHit, reasons }
}

function collectRootAliasLocal(canonicalOrRaw) {
  const names = new Set()
  const s = String(canonicalOrRaw || '').trim()
  if (!s) return []
  names.add(s)
  if (s.endsWith('馆')) names.add(s.slice(0, -1))
  Object.entries(LEGACY_ROOT_ALIASES).forEach(([legacy, target]) => {
    if (target === s || legacy === s) {
      names.add(legacy)
      names.add(target)
      if (legacy.endsWith('馆')) names.add(legacy.slice(0, -1))
      if (target.endsWith('馆')) names.add(target.slice(0, -1))
    }
  })
  return [...names]
}

async function scanLinkCandidates(categoryId, mode = 'auto') {
  const targetCat = await loadCategoryById(categoryId)
  if (!targetCat || Number(targetCat.level) !== 2) {
    return { success: false, msg: '目标不是有效二级分类' }
  }
  const rootDoc = targetCat.parentId ? await loadCategoryById(targetCat.parentId) : null
  const nameSet = new Set(childNameAliases(targetCat.name))
  const useAll = mode === 'all'

  const candidates = []
  const alreadyLinked = []
  let skip = 0
  let scanned = 0

  // 优先扫：同名 category、同 root、无 categoryId
  while (scanned < 2000 && candidates.length < LINK_BATCH_CAP) {
    let batch = []
    try {
      const res = await db.collection('products')
        .orderBy('createTime', 'desc')
        .skip(skip)
        .limit(PAGE_SIZE)
        .get()
      batch = res.data || []
    } catch (e) {
      const res = await db.collection('products').skip(skip).limit(PAGE_SIZE).get()
      batch = res.data || []
    }
    if (!batch.length) break

    for (const p of batch) {
      scanned += 1
      if (p.categoryId === categoryId) {
        alreadyLinked.push(p._id)
        continue
      }
      const { match, reasons } = productMatchesAutoRules(p, targetCat, rootDoc, nameSet)
      const sameRoot = rootDoc && (
        p.rootCategoryId === rootDoc._id ||
        collectRootAliasLocal(rootDoc.name).includes(String(p.rootCategoryName || ''))
      )
      let accept = match
      if (useAll && !accept) {
        const weakName = reasons.includes('category_name') || reasons.includes('tag') || reasons.includes('title')
        const orphan = !p.categoryId
        accept = sameRoot && (weakName || orphan || reasons.includes('uncategorized'))
      }
      if (!accept) continue
      candidates.push({
        _id: p._id,
        title: p.title || '',
        category: p.category || '',
        categoryId: p.categoryId || '',
        rootCategoryName: p.rootCategoryName || '',
        reasons: reasons.length ? reasons : (sameRoot ? ['same_root'] : ['match']),
        prev: {
          categoryId: p.categoryId || '',
          category: p.category || '',
          rootCategoryId: p.rootCategoryId || '',
          rootCategoryName: p.rootCategoryName || '',
          categoryType: p.categoryType || ''
        }
      })
      if (candidates.length >= LINK_BATCH_CAP) break
    }

    if (batch.length < PAGE_SIZE) break
    skip += batch.length
  }

  return {
    success: true,
    category: {
      _id: targetCat._id,
      name: targetCat.name,
      parentId: targetCat.parentId || '',
      parentName: (rootDoc && rootDoc.name) || ''
    },
    mode: useAll ? 'all' : 'auto',
    scanned,
    alreadyLinkedCount: alreadyLinked.length,
    matchCount: candidates.length,
    preview: candidates.slice(0, LINK_PREVIEW_LIMIT).map((c) => ({
      _id: c._id,
      title: c.title,
      category: c.category,
      reasons: c.reasons
    })),
    candidates
  }
}

async function linkProductsToCategory(categoryId, mode, options = {}) {
  const dryRun = !!options.dryRun
  const onlyIds = Array.isArray(options.productIds)
    ? options.productIds.map((id) => String(id || '').trim()).filter(Boolean)
    : null

  const scan = await scanLinkCandidates(categoryId, mode || 'auto')
  if (!scan.success) return scan

  let toLink = scan.candidates
  if (onlyIds && onlyIds.length) {
    const idSet = new Set(onlyIds)
    toLink = toLink.filter((c) => idSet.has(c._id))
  }

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      category: scan.category,
      mode: scan.mode,
      matchCount: toLink.length,
      preview: toLink.slice(0, LINK_PREVIEW_LIMIT).map((c) => ({
        _id: c._id,
        title: c.title,
        category: c.category,
        reasons: c.reasons
      })),
      msg: `预览：将关联 ${toLink.length} 件藏品到「${scan.category.name}」`
    }
  }

  const targetCat = await loadCategoryById(categoryId)
  const patch = await buildProductCategoryPatch(targetCat)
  const linked = []
  for (let i = 0; i < toLink.length; i += 20) {
    const chunk = toLink.slice(i, i + 20)
    await Promise.all(chunk.map(async (c) => {
      await db.collection('products').doc(c._id).update({ data: { ...patch } })
      linked.push({ _id: c._id, title: c.title, prev: c.prev })
    }))
  }

  return {
    success: true,
    category: scan.category,
    mode: scan.mode,
    linkedCount: linked.length,
    linked,
    preview: linked.slice(0, LINK_PREVIEW_LIMIT).map((c) => ({
      _id: c._id,
      title: c.title
    })),
    msg: `已将 ${linked.length} 件藏品关联到「${scan.category.name}」`
  }
}

async function unlinkProductsFromCategory(categoryId, linkedSnapshots) {
  const snaps = Array.isArray(linkedSnapshots) ? linkedSnapshots : []
  if (!categoryId || !snaps.length) {
    return { success: false, msg: '缺少撤销数据' }
  }
  let restored = 0
  for (let i = 0; i < snaps.length; i += 20) {
    const chunk = snaps.slice(i, i + 20)
    await Promise.all(chunk.map(async (item) => {
      const id = item._id || item.id
      if (!id) return
      try {
        const doc = await db.collection('products').doc(id).get()
        const cur = doc.data
        if (!cur || cur.categoryId !== categoryId) return
        const prev = item.prev || {}
        await db.collection('products').doc(id).update({
          data: {
            categoryId: prev.categoryId || '',
            category: prev.category || '',
            rootCategoryId: prev.rootCategoryId || '',
            rootCategoryName: prev.rootCategoryName || '',
            categoryType: prev.categoryType || cur.categoryType || '',
            updatedAt: db.serverDate()
          }
        })
        restored += 1
      } catch (e) {
        // skip
      }
    }))
  }
  return {
    success: true,
    restored,
    msg: `已撤销 ${restored} 件藏品的分类关联`
  }
}

async function cleanupDuplicateRoots() {
  const stats = {
    rootsMerged: 0,
    rootsRenamed: 0,
    rootsPurged: 0,
    childrenReparented: 0,
    childrenMerged: 0,
    productsUpdated: 0
  }

  const all = await fetchAllCategories()
  const activeRoots = all.filter((c) => isLevel1(c) && isActiveCategory(c))

  for (const rootDef of DEFAULT_CATEGORY_TREE) {
    const aliases = legacyNamesForCanonical(rootDef.name)
    const matches = activeRoots.filter((r) => aliases.includes(r.name))
    if (!matches.length) continue

    matches.sort((a, b) => {
      if (a.name === rootDef.name && b.name !== rootDef.name) return -1
      if (b.name === rootDef.name && a.name !== rootDef.name) return 1
      return (a.sortOrder || 99) - (b.sortOrder || 99)
    })

    const survivor = matches[0]
    const duplicates = matches.slice(1)

    const rootPayload = buildCategoryDoc(rootDef, 1)
    if (survivor.name !== rootDef.name) {
      await db.collection('categories').doc(survivor._id).update({
        data: {
          ...rootPayload,
          updatedAt: db.serverDate()
        }
      })
      stats.rootsRenamed += 1
    } else {
      await upsertCategory(rootPayload, survivor)
    }

    for (const dup of duplicates) {
      await reparentChildren(dup._id, survivor._id, stats)
      await db.collection('categories').doc(dup._id).update({
        data: {
          status: 'inactive',
          active: false,
          mergedInto: survivor._id,
          updatedAt: db.serverDate()
        }
      })
      stats.rootsMerged += 1
    }
  }

  for (const [oldName, newName] of Object.entries(LEGACY_ROOT_ALIASES)) {
    if (oldName === newName) continue
    let skip = 0
    while (true) {
      const res = await db.collection('products')
        .where({ rootCategoryName: oldName })
        .skip(skip)
        .limit(PAGE_SIZE)
        .get()
      const batch = res.data || []
      if (!batch.length) break

      const canonicalRoot = await findRootByName(newName)
      await Promise.all(batch.map((p) => {
        const patch = {
          rootCategoryName: newName,
          updatedAt: db.serverDate()
        }
        if (canonicalRoot && canonicalRoot._id) {
          patch.rootCategoryId = canonicalRoot._id
        }
        return db.collection('products').doc(p._id).update({ data: patch })
      }))
      stats.productsUpdated += batch.length
      if (batch.length < PAGE_SIZE) break
      skip += PAGE_SIZE
    }
  }

  await purgeNonCanonicalRoots(stats)

  return stats
}

async function migrateLegacyChild(parentId, legacyName, newName, newDoc) {
  const legacy = await findChild(parentId, legacyName)
  if (!legacy) return null
  const targetName = newName || LEGACY_CHILD_ALIASES[legacyName] || legacyName
  if (legacy.name === targetName) {
    await upsertCategory(newDoc, legacy)
    return legacy._id
  }
  await db.collection('categories').doc(legacy._id).update({
    data: { ...newDoc, name: targetName, updatedAt: db.serverDate() }
  })
  // 同步商品上的 category 展示字符串（categoryId 不变）
  try {
    let skip = 0
    while (true) {
      const res = await db.collection('products')
        .where({ categoryId: legacy._id })
        .skip(skip)
        .limit(PAGE_SIZE)
        .get()
      const batch = res.data || []
      if (!batch.length) break
      await Promise.all(batch.map((p) =>
        db.collection('products').doc(p._id).update({
          data: { category: targetName, updatedAt: db.serverDate() }
        })
      ))
      if (batch.length < PAGE_SIZE) break
      skip += PAGE_SIZE
    }
  } catch (e) {
    console.warn('migrateLegacyChild product patch', legacyName, e.message || e)
  }
  return legacy._id
}

async function syncCategories() {
  let rootsUpserted = 0
  let childrenUpserted = 0
  let legacyMigrated = 0

  for (const root of DEFAULT_CATEGORY_TREE) {
    let rootDoc = await findRootByName(root.name)
    if (!rootDoc) {
      for (const [legacyName, canonicalName] of Object.entries(LEGACY_ROOT_ALIASES)) {
        if (canonicalName !== root.name) continue
        const legacy = await findRootByName(legacyName)
        if (legacy) {
          await db.collection('categories').doc(legacy._id).update({
            data: {
              name: root.name,
              enName: root.enName,
              categoryType: root.categoryType,
              taxonomy: root.taxonomy,
              sortOrder: root.sortOrder,
              status: 'active',
              updatedAt: db.serverDate()
            }
          })
          rootDoc = { ...legacy, name: root.name }
          legacyMigrated += 1
          break
        }
      }
    }

    const rootPayload = buildCategoryDoc(root, 1)
    const rootId = await upsertCategory(rootPayload, rootDoc)
    rootsUpserted += 1

    if (!root.children || !root.children.length) continue

    for (const child of root.children) {
      let existing = await findChild(rootId, child.name)
      if (!existing) {
        for (const [legacyName, newName] of Object.entries(LEGACY_CHILD_ALIASES)) {
          if (newName !== child.name) continue
          const migratedId = await migrateLegacyChild(
            rootId,
            legacyName,
            child.name,
            buildCategoryDoc(child, 2, rootId)
          )
          if (migratedId) {
            existing = { _id: migratedId, name: child.name }
            legacyMigrated += 1
            break
          }
        }
      }
      await upsertCategory(buildCategoryDoc(child, 2, rootId), existing)
      childrenUpserted += 1
    }
  }

  return { rootsUpserted, childrenUpserted, legacyMigrated }
}

/**
 * 构建二级分类种子查找表：canonical 名 / 旧别名 / enName → 补齐字段
 */
function buildL2SeedLookup() {
  const byKey = new Map()
  const put = (key, entry) => {
    const k = normalizeCatKey(key)
    if (!k || byKey.has(k)) return
    byKey.set(k, entry)
  }

  for (const root of DEFAULT_CATEGORY_TREE) {
    for (const child of root.children || []) {
      const latinName = deriveLatinName(child)
      const entry = {
        seedName: child.name,
        rootName: root.name,
        enName: child.enName || '',
        latinName,
        latin: latinName,
        taxonomy: child.taxonomy || null,
        categoryType: child.categoryType || root.categoryType || '',
        confidence: 'canonical'
      }
      put(child.name, entry)
      if (child.enName) put(child.enName, { ...entry, confidence: 'enName' })
      if (latinName) put(latinName, { ...entry, confidence: 'latin' })
    }
  }

  Object.entries(LEGACY_CHILD_ALIASES).forEach(([legacy, canonical]) => {
    const base = byKey.get(normalizeCatKey(canonical))
    if (!base) return
    put(legacy, { ...base, confidence: 'alias' })
  })

  Object.entries(EXTRA_L2_LATIN_DEFAULTS || {}).forEach(([name, def]) => {
    const latinName = String(def.latinName || '').trim()
    const enName = String(def.enName || '').trim()
    put(name, {
      seedName: name,
      rootName: '',
      enName,
      latinName,
      latin: latinName,
      taxonomy: null,
      categoryType: '',
      confidence: def.pendingReview ? 'default_pending_review' : 'default'
    })
  })

  return byKey
}

/**
 * 模糊：名称包含种子中文名片段（如「鳞翅目」），标 pending_review
 */
function fuzzyMatchL2Seed(name, lookup) {
  const raw = String(name || '').trim()
  if (!raw) return null
  let best = null
  for (const root of DEFAULT_CATEGORY_TREE) {
    for (const child of root.children || []) {
      const seedName = String(child.name || '')
      const head = seedName.split(/[·・]/)[0].trim()
      const hit =
        (head && head.length >= 2 && raw.includes(head)) ||
        (seedName.length >= 2 && (raw.includes(seedName) || seedName.includes(raw)))
      if (!hit) continue
      const latinName = deriveLatinName(child)
      const candidate = {
        seedName: child.name,
        rootName: root.name,
        enName: child.enName || '',
        latinName,
        latin: latinName,
        taxonomy: child.taxonomy || null,
        categoryType: child.categoryType || root.categoryType || '',
        confidence: 'fuzzy_pending_review'
      }
      if (!best || seedName.length > String(best.seedName || '').length) best = candidate
    }
  }
  return best
}

/**
 * 批量补齐二级分类 latinName / enName / latin / taxonomy
 * @param {{ dryRun?: boolean, force?: boolean, categoryIds?: string[] }} opts
 */
async function fillL2LatinNames(opts = {}) {
  const dryRun = !!opts.dryRun
  const force = !!opts.force
  const idFilter = Array.isArray(opts.categoryIds)
    ? new Set(opts.categoryIds.filter(Boolean).map(String))
    : null

  const lookup = buildL2SeedLookup()
  const all = await fetchAllCategories()
  const l2 = all.filter((c) => Number(c.level) === 2 && isActiveCategory(c))
  const rootsById = {}
  all.filter((c) => Number(c.level) === 1).forEach((r) => {
    rootsById[r._id] = r
  })

  const preview = []
  let updated = 0
  let skipped = 0
  let pendingReview = 0
  let unmatched = 0

  for (const cat of l2) {
    if (idFilter && !idFilter.has(String(cat._id))) continue

    let seed = lookup.get(normalizeCatKey(cat.name))
    if (!seed && cat.enName) seed = lookup.get(normalizeCatKey(cat.enName))
    if (!seed) seed = fuzzyMatchL2Seed(cat.name, lookup)

    if (!seed) {
      unmatched += 1
      preview.push({
        _id: cat._id,
        name: cat.name,
        parentName: rootsById[cat.parentId]?.name || cat.parentName || '',
        action: 'unmatched',
        note: '无 canonical / 别名匹配，请手工补拉丁名'
      })
      continue
    }

    const patch = {}
    const hasLatin = String(cat.latinName || cat.latin || '').trim()
    const hasEn = String(cat.enName || '').trim()
    if (force || !hasLatin) {
      if (seed.latinName) {
        patch.latinName = seed.latinName
        patch.latin = seed.latinName
      }
    } else if (!String(cat.latin || '').trim() && hasLatin) {
      patch.latin = hasLatin
    }
    if ((force || !hasEn) && seed.enName) patch.enName = seed.enName
    if ((force || !cat.taxonomy) && seed.taxonomy) patch.taxonomy = seed.taxonomy
    if (seed.confidence === 'fuzzy_pending_review' || seed.confidence === 'default_pending_review') {
      patch.latinStatus = 'pending_review'
      pendingReview += 1
    } else if (cat.latinStatus === 'pending_review' && (seed.confidence === 'canonical' || seed.confidence === 'default')) {
      patch.latinStatus = seed.confidence === 'canonical' ? 'canonical' : 'default'
    }

    if (!Object.keys(patch).length) {
      skipped += 1
      preview.push({
        _id: cat._id,
        name: cat.name,
        parentName: rootsById[cat.parentId]?.name || cat.parentName || '',
        action: 'skip',
        latinName: hasLatin,
        enName: hasEn,
        confidence: seed.confidence
      })
      continue
    }

    preview.push({
      _id: cat._id,
      name: cat.name,
      parentName: rootsById[cat.parentId]?.name || cat.parentName || '',
      action: dryRun ? 'would_update' : 'update',
      patch,
      seedName: seed.seedName,
      confidence: seed.confidence
    })

    if (!dryRun) {
      await db.collection('categories').doc(cat._id).update({
        data: { ...patch, updatedAt: db.serverDate() }
      })
      updated += 1
    } else {
      updated += 1
    }
  }

  return {
    success: true,
    dryRun,
    force,
    updated,
    skipped,
    pendingReview,
    unmatched,
    preview: preview.slice(0, 80),
    previewTotal: preview.length,
    msg: dryRun
      ? `预览：将补齐 ${updated} 项，跳过 ${skipped}，待审 ${pendingReview}，未匹配 ${unmatched}`
      : `已补齐 ${updated} 项，跳过 ${skipped}，待审 ${pendingReview}，未匹配 ${unmatched}`
  }
}

/**
 * 对齐 active / status / sortOrder，修复 Admin 开关与店长列表不同步的脏数据：
 * - mergedInto → 强制 inactive
 * - active:false 但 status 仍为 active → status:inactive
 * - status:active 且缺 active → active:true
 * - 有 sort 无 sortOrder（或反之）→ 互相补齐
 */
async function normalizeCategoryFlags(opts = {}) {
  const dryRun = !!opts.dryRun
  const all = await fetchAllCategories()
  const preview = []
  let updated = 0

  for (const cat of all) {
    const patch = {}
    const sortVal = cat.sortOrder != null ? cat.sortOrder : (cat.sort != null ? cat.sort : null)
    if (cat.sortOrder == null && cat.sort != null) patch.sortOrder = cat.sort
    if (cat.sort == null && cat.sortOrder != null) patch.sort = cat.sortOrder

    if (cat.mergedInto) {
      if (cat.status !== 'inactive') patch.status = 'inactive'
      if (cat.active !== false) patch.active = false
    } else if (cat.active === false && cat.status !== 'inactive' && cat.status !== 'deleted') {
      patch.status = 'inactive'
    } else if (cat.status === 'active' && cat.active == null) {
      patch.active = true
    } else if (cat.status === 'inactive' && cat.active !== false) {
      patch.active = false
    }

    if (!Object.keys(patch).length) continue
    preview.push({
      _id: cat._id,
      name: cat.name,
      level: cat.level,
      before: { active: cat.active, status: cat.status, sort: cat.sort, sortOrder: cat.sortOrder },
      patch
    })
    if (!dryRun) {
      await db.collection('categories').doc(cat._id).update({
        data: { ...patch, updatedAt: db.serverDate() }
      })
      updated += 1
    }
  }

  return {
    success: true,
    dryRun,
    updated: dryRun ? 0 : updated,
    wouldUpdate: preview.length,
    preview: preview.slice(0, 50),
    msg: dryRun
      ? `预览：将对齐 ${preview.length} 条分类状态/排序字段`
      : `已对齐 ${updated} 条分类状态/排序字段`
  }
}

/** 历史种子二级 id → 当前名称（用于商品 categoryId 漂移修复） */
const ORPHAN_CATEGORY_ID_NAMES = {
  cat_gastropoda: ['腹足纲 · 贝壳', '腹足纲', '贝壳'],
  cat_crustaceans: ['甲壳纲 · 蟹虾', '甲壳纲'],
  cat_cephalopoda: ['头足类', '头足纲 · 头足类', '头足纲'],
  cat_seeds: ['种子与果实', '种子标本'],
  cat_lepidoptera: ['鳞翅目 · 蝴蝶', '鳞翅目', '蝴蝶'],
  cat_coleoptera: ['鞘翅目 · 甲虫', '鞘翅目', '甲虫'],
  cat_bivalvia: ['双壳纲 · 双壳贝', '双壳纲'],
  cat_coral: ['珊瑚纲 · 珊瑚', '珊瑚'],
  cat_pressed: ['被子植物 · 押花', '干花标本'],
  cat_fish: ['辐鳍鱼纲 · 鱼类', '辐鳍鱼纲', '鱼类']
}

function buildActiveL2Lookup(allCats) {
  const byId = new Map()
  const byName = new Map()
  allCats.filter((c) => Number(c.level) === 2 && isActiveCategory(c)).forEach((c) => {
    byId.set(String(c._id), c)
    childNameAliases(c.name).forEach((alias) => {
      const key = normalizeCatKey(alias)
      if (key && !byName.has(key)) byName.set(key, c)
    })
  })
  return { byId, byName }
}

function resolveTargetL2ForProduct(product, lookup) {
  const curId = String(product.categoryId || '').trim()
  if (curId && lookup.byId.has(curId)) return null // 已正确

  if (curId && ORPHAN_CATEGORY_ID_NAMES[curId]) {
    for (const name of ORPHAN_CATEGORY_ID_NAMES[curId]) {
      const hit = lookup.byName.get(normalizeCatKey(name))
      if (hit) return hit
    }
  }

  const catName = String(product.category || '').trim()
  if (catName) {
    const hit = lookup.byName.get(normalizeCatKey(catName))
    if (hit && (!curId || !lookup.byId.has(curId))) return hit
  }
  return null
}

/**
 * 修复商品 categoryId 漂移 / 仅短名无 id / 指向已删除二级
 */
async function repairProductCategoryLinks(opts = {}) {
  const dryRun = !!opts.dryRun
  const allCats = await fetchAllCategories()
  const lookup = buildActiveL2Lookup(allCats)
  let scanned = 0
  let updated = 0
  let skipped = 0
  const preview = []
  let skip = 0

  while (scanned < 5000) {
    let batch = []
    try {
      const res = await db.collection('products').skip(skip).limit(PAGE_SIZE).get()
      batch = res.data || []
    } catch (e) {
      break
    }
    if (!batch.length) break

    for (const p of batch) {
      scanned += 1
      const target = resolveTargetL2ForProduct(p, lookup)
      if (!target) {
        skipped += 1
        continue
      }
      const patch = await buildProductCategoryPatch(target)
      preview.push({
        _id: p._id,
        title: p.title || '',
        from: { categoryId: p.categoryId || '', category: p.category || '' },
        to: { categoryId: target._id, category: target.name }
      })
      if (!dryRun) {
        await db.collection('products').doc(p._id).update({ data: patch })
        updated += 1
      }
    }

    if (batch.length < PAGE_SIZE) break
    skip += batch.length
  }

  return {
    success: true,
    dryRun,
    scanned,
    updated: dryRun ? 0 : updated,
    wouldUpdate: preview.length,
    skipped,
    preview: preview.slice(0, 40),
    msg: dryRun
      ? `预览：将修复 ${preview.length} 件商品分类关联（扫描 ${scanned}）`
      : `已修复 ${updated} 件商品分类关联（扫描 ${scanned}）`
  }
}

exports.main = async (event) => {
  const { action = 'sync' } = event || {}
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''

  // 全部写/清/同步动作均需店长级鉴权（含社区种子）；禁止匿名直调改库
  globalThis.__adminOpsKey = event && event.adminOpsKey
  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    adminOpsKey: event && event.adminOpsKey
  })
  if (!guard.ok) {
    return { success: false, code: guard.code, msg: guard.msg || '无权限' }
  }

  if (action === 'findDuplicateL2') {
    try {
      const data = await findDuplicateL2()
      return { success: true, ...data }
    } catch (e) {
      console.error('seedCategories findDuplicateL2', e)
      return { success: false, msg: e.message || '扫描失败' }
    }
  }

  if (action === 'mergeL2') {
    try {
      return await mergeL2Categories(event.fromId, event.toId, { dryRun: !!event.dryRun })
    } catch (e) {
      console.error('seedCategories mergeL2', e)
      return { success: false, msg: e.message || '合并失败' }
    }
  }

  if (action === 'previewLinkProducts') {
    try {
      const scan = await scanLinkCandidates(event.categoryId, event.mode || 'auto')
      if (!scan.success) return scan
      return {
        success: true,
        category: scan.category,
        mode: scan.mode,
        scanned: scan.scanned,
        alreadyLinkedCount: scan.alreadyLinkedCount,
        matchCount: scan.matchCount,
        preview: scan.preview,
        msg: `匹配 ${scan.matchCount} 件（已关联 ${scan.alreadyLinkedCount}）`
      }
    } catch (e) {
      console.error('seedCategories previewLinkProducts', e)
      return { success: false, msg: e.message || '预览失败' }
    }
  }

  if (action === 'linkProducts') {
    try {
      return await linkProductsToCategory(event.categoryId, event.mode || 'auto', {
        dryRun: !!event.dryRun,
        productIds: event.productIds
      })
    } catch (e) {
      console.error('seedCategories linkProducts', e)
      return { success: false, msg: e.message || '关联失败' }
    }
  }

  if (action === 'unlinkProducts') {
    try {
      return await unlinkProductsFromCategory(event.categoryId, event.linked || event.snapshots)
    } catch (e) {
      console.error('seedCategories unlinkProducts', e)
      return { success: false, msg: e.message || '撤销失败' }
    }
  }

  if (action === 'fillL2LatinNames') {
    try {
      return await fillL2LatinNames({
        dryRun: !!event.dryRun,
        force: !!event.force,
        categoryIds: event.categoryIds
      })
    } catch (e) {
      console.error('seedCategories fillL2LatinNames', e)
      return { success: false, msg: e.message || '补齐失败' }
    }
  }

  if (action === 'normalizeCategoryFlags') {
    try {
      return await normalizeCategoryFlags({ dryRun: !!event.dryRun })
    } catch (e) {
      console.error('seedCategories normalizeCategoryFlags', e)
      return { success: false, msg: e.message || '对齐失败' }
    }
  }

  if (action === 'repairProductCategoryLinks') {
    try {
      return await repairProductCategoryLinks({ dryRun: !!event.dryRun })
    } catch (e) {
      console.error('seedCategories repairProductCategoryLinks', e)
      return { success: false, msg: e.message || '修复失败' }
    }
  }

  if (action === 'cleanup') {
    try {
      const cleanupStats = await cleanupDuplicateRoots()
      const syncStats = await syncCategories()
      return {
        success: true,
        msg: 'categories 脏数据已合并为精简一级分类',
        stats: { ...cleanupStats, ...syncStats }
      }
    } catch (e) {
      console.error('seedCategories cleanup', e)
      return { success: false, msg: e.message || '清理失败' }
    }
  }

  if (action === 'sync' || action === 'rebuild') {
    try {
      const cleanupStats = await cleanupDuplicateRoots()
      const syncStats = await syncCategories()
      const flagStats = await normalizeCategoryFlags({ dryRun: false })
      return {
        success: true,
        msg: 'categories 集合已同步精简分类体系',
        stats: { ...cleanupStats, ...syncStats, flagNormalize: flagStats }
      }
    } catch (e) {
      console.error('seedCategories', e)
      return { success: false, msg: e.message || '同步失败' }
    }
  }

  if (action === 'communitySeed') {
    try {
      const stats = await communitySeed.seedAll()
      return {
        success: true,
        msg: `社区内容已导入：${stats.articles} 篇笔记、${stats.exhibitions} 个专题`,
        stats
      }
    } catch (e) {
      console.error('seedCategories communitySeed', e)
      return { success: false, msg: e.message || '社区种子导入失败' }
    }
  }

  if (action === 'communityClear') {
    try {
      const stats = await communitySeed.clearSeed()
      return {
        success: true,
        msg: `已清除 ${stats.removed} 条种子内容`,
        stats
      }
    } catch (e) {
      console.error('seedCategories communityClear', e)
      return { success: false, msg: e.message || '清除种子失败' }
    }
  }

  if (action === 'communityStatus') {
    try {
      const stats = await communitySeed.status()
      return { success: true, stats }
    } catch (e) {
      console.error('seedCategories communityStatus', e)
      return { success: false, msg: e.message || '查询失败' }
    }
  }

  return {
    success: false,
    msg: '未知 action，请使用 sync / cleanup / findDuplicateL2 / mergeL2 / previewLinkProducts / linkProducts / unlinkProducts / fillL2LatinNames / normalizeCategoryFlags / repairProductCategoryLinks / communitySeed / communityClear / communityStatus'
  }
}
