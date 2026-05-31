const cloud = require('wx-server-sdk')
const { SEED_VERSION, ARTICLES, EXHIBITIONS } = require('./communitySeed')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isMissingCollectionError(err) {
  const msg = [err && err.message, err && err.errMsg, String(err)]
    .filter(Boolean)
    .join(' ')
  return (
    /502005/.test(msg) ||
    /DATABASE_COLLECTION_NOT_EXIST/.test(msg) ||
    /ResourceNotFound/.test(msg) ||
    /Db or Table not exist/.test(msg) ||
    /collection not exist/i.test(msg)
  )
}

/** 集合不存在时返回空数组，避免 upsert 前查询失败 */
async function safeFindBySeedKey(collection, seedKey) {
  try {
    const res = await db.collection(collection).where({ _seedKey: seedKey }).limit(1).get()
    return res.data || []
  } catch (err) {
    if (isMissingCollectionError(err)) {
      console.warn(`集合 ${collection} 尚未创建，将直接写入首条数据`)
      return []
    }
    throw err
  }
}

async function safeGetBySource(collection) {
  try {
    const res = await db.collection(collection).where({ _seedSource: 'seedCommunityContent' }).get()
    return res.data || []
  } catch (err) {
    if (isMissingCollectionError(err)) return []
    throw err
  }
}

async function safeCountBySource(collection) {
  try {
    const res = await db.collection(collection).where({ _seedSource: 'seedCommunityContent' }).count()
    return res.total || 0
  } catch (err) {
    if (isMissingCollectionError(err)) return 0
    throw err
  }
}

async function upsertBySeedKey(collection, seedKey, doc) {
  const existing = await safeFindBySeedKey(collection, seedKey)
  const now = Date.now()
  const data = {
    ...doc,
    _seedKey: seedKey,
    _seedVersion: SEED_VERSION,
    _seedSource: 'seedCommunityContent',
    updateTime: now
  }

  if (existing.length) {
    const id = existing[0]._id
    await db.collection(collection).doc(id).update({ data })
    return { action: 'updated', id, seedKey }
  }

  data.createTime = doc.createTime || now
  data._createTime = db.serverDate()
  if (!data.stats && collection === 'articles') {
    data.stats = { views: 0, likes: 0, comments: 0 }
  }
  const addRes = await db.collection(collection).add({ data })
  return { action: 'created', id: addRes._id, seedKey }
}

async function seedAll() {
  const articleResults = []
  for (const item of ARTICLES) {
    const { _seedKey, ...rest } = item
    articleResults.push(await upsertBySeedKey('articles', _seedKey, rest))
  }

  const exhibitionResults = []
  for (const item of EXHIBITIONS) {
    const { _seedKey, ...rest } = item
    exhibitionResults.push(await upsertBySeedKey('cms_wikis', _seedKey, rest))
  }

  return {
    articles: articleResults.length,
    exhibitions: exhibitionResults.length,
    articleResults,
    exhibitionResults,
    seedVersion: SEED_VERSION
  }
}

async function clearSeed() {
  const [articlesData, exhibitionsData] = await Promise.all([
    safeGetBySource('articles'),
    safeGetBySource('cms_wikis')
  ])

  let removed = 0
  for (const doc of articlesData) {
    await db.collection('articles').doc(doc._id).remove()
    removed += 1
  }
  for (const doc of exhibitionsData) {
    await db.collection('cms_wikis').doc(doc._id).remove()
    removed += 1
  }

  return {
    removed,
    articles: articlesData.length,
    exhibitions: exhibitionsData.length
  }
}

async function status() {
  const [articlesInDb, exhibitionsInDb] = await Promise.all([
    safeCountBySource('articles'),
    safeCountBySource('cms_wikis')
  ])
  return {
    seedVersion: SEED_VERSION,
    expectedArticles: ARTICLES.length,
    expectedExhibitions: EXHIBITIONS.length,
    articlesInDb,
    exhibitionsInDb
  }
}

exports.main = async (event) => {
  const { action = 'seed' } = event || {}

  try {
    if (action === 'seed') {
      const stats = await seedAll()
      return {
        success: true,
        msg: `社区内容已导入：${stats.articles} 篇笔记、${stats.exhibitions} 个专题`,
        stats
      }
    }

    if (action === 'clear') {
      const stats = await clearSeed()
      return {
        success: true,
        msg: `已清除 ${stats.removed} 条种子内容`,
        stats
      }
    }

    if (action === 'status') {
      const stats = await status()
      return { success: true, stats }
    }

    return { success: false, msg: '未知 action，请使用 seed / clear / status' }
  } catch (e) {
    console.error('seedCommunityContent', e)
    const msg = (e && (e.message || e.errMsg)) || '操作失败'
    return { success: false, msg }
  }
}
