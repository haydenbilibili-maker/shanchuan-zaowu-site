const cloud = require('wx-server-sdk')
const {
  DEFAULT_CATEGORY_TREE,
  CANONICAL_ROOT_NAMES,
  LEGACY_ROOT_ALIASES,
  LEGACY_CHILD_ALIASES,
  buildCategoryDoc
} = require('./categorySeed')
const communitySeed = require('./communitySeedRunner')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PAGE_SIZE = 100

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
  const activeRoots = all.filter((c) => isLevel1(c) && c.status !== 'inactive')
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
        if (child.status === 'inactive') continue
        await db.collection('categories').doc(child._id).update({
          data: { status: 'inactive', updatedAt: db.serverDate() }
        })
        stats.childrenMerged += 1
      }
    }

    if (root._id === targetId) continue

    await db.collection('categories').doc(root._id).update({
      data: {
        status: 'inactive',
        mergedInto: targetId || null,
        updatedAt: db.serverDate()
      }
    })
    stats.rootsPurged = (stats.rootsPurged || 0) + 1
  }

  // 合并同名精简馆重复记录（如两个「昆虫馆」）
  const refreshedRoots = (await fetchAllCategories()).filter(
    (c) => isLevel1(c) && c.status !== 'inactive'
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

async function migrateProductCategoryIds(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return 0
  let updated = 0
  let skip = 0
  while (true) {
    const res = await db.collection('products').where({ categoryId: fromId }).skip(skip).limit(PAGE_SIZE).get()
    const batch = res.data || []
    if (!batch.length) break
    await Promise.all(batch.map((p) =>
      db.collection('products').doc(p._id).update({
        data: { categoryId: toId, updatedAt: db.serverDate() }
      })
    ))
    updated += batch.length
    if (batch.length < PAGE_SIZE) break
    skip += PAGE_SIZE
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
      const n = await migrateProductCategoryIds(child._id, existing._id)
      stats.productsUpdated += n
      await db.collection('categories').doc(child._id).update({
        data: {
          status: 'inactive',
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
  const activeRoots = all.filter((c) => isLevel1(c) && c.status !== 'inactive')

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

exports.main = async (event) => {
  const { action = 'sync' } = event || {}

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
      return {
        success: true,
        msg: 'categories 集合已同步精简分类体系',
        stats: { ...cleanupStats, ...syncStats }
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

  return { success: false, msg: '未知 action，请使用 sync / cleanup / communitySeed / communityClear / communityStatus' }
}
