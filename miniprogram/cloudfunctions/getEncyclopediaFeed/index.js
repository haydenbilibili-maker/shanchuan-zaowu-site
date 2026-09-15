const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const {
  normalizeChannel,
  normalizeCraftType,
  normalizeCraftProcess,
  enumMatchValues,
  collectRootAliases
} = require('./productTaxonomy')
const {
  buildKeywordCondition,
  rankByKeyword,
  WIKI_FIELDS,
  PRODUCT_FIELDS
} = require('./fuzzySearch')

const KEYWORD_RANK_FETCH_CAP = 200

const CMS_COLLECTION = 'cms_wikis'

function getProductStock(p) {
  if (p.hasSku && p.skus && p.skus.length) {
    return p.skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0)
  }
  if (p.stock == null || p.stock === '') return 0
  const n = parseInt(p.stock, 10)
  return Number.isNaN(n) ? 0 : n
}

function isProductSoldOut(p) {
  return getProductStock(p) <= 0
}

function formatTypeLabel(type) {
  if (type === 'exhibition') return '专题'
  if (type === 'story') return '故事'
  return '标本档案'
}

async function collectLinkedProductIds(categoryFilter) {
  const linked = new Set()
  try {
    let query = db.collection(CMS_COLLECTION).field({ relatedProductIds: true })
    if (categoryFilter && categoryFilter.categoryId) {
      query = query.where({ categoryId: categoryFilter.categoryId })
    } else if (categoryFilter && categoryFilter.parentCategory) {
      query = query.where({
        category: db.RegExp({ regexp: categoryFilter.parentCategory, options: 'i' })
      })
    }
    const res = await query.limit(500).get()
    ;(res.data || []).forEach((item) => {
      ;(item.relatedProductIds || []).forEach((id) => linked.add(id))
    })
  } catch (e) {
    console.warn('collectLinkedProductIds', e)
  }
  return linked
}

async function resolveCommerceHint(relatedIds, category, excludeIds) {
  if (!relatedIds || !relatedIds.length) {
    return { hasCommerce: false }
  }

  try {
    const res = await db.collection('products')
      .where({ _id: _.in(relatedIds), isOffShelf: _.neq(true) })
      .get()
    const products = res.data || []
    const inStock = products.filter((p) => getProductStock(p) > 0)
    if (inStock.length) {
      const p = inStock.sort((a, b) => (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0))[0]
      return {
        hasCommerce: true,
        productId: p._id,
        commerceLabel: `关联藏品 · ${p.title} · ¥${p.price}`,
        isAlternative: false
      }
    }

    if (category) {
      const altRes = await db.collection('products')
        .where({
          category: db.RegExp({ regexp: category, options: 'i' }),
          isOffShelf: _.neq(true),
          _id: _.nin([...relatedIds, ...excludeIds])
        })
        .limit(30)
        .get()
      const alt = (altRes.data || []).filter((p) => getProductStock(p) > 0)
      if (alt.length) {
        const p = alt.sort((a, b) => (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0))[0]
        return {
          hasCommerce: true,
          productId: p._id,
          commerceLabel: `同品类推荐 · ${p.title} · ¥${p.price}`,
          isAlternative: true
        }
      }
    }

    return { hasCommerce: false, commerceLabel: '关联藏品暂时售罄' }
  } catch (e) {
    return { hasCommerce: false }
  }
}

function buildContentQuery(event) {
  const { categoryId, parentCategory, subCategoryName, keyword } = event
  const conditions = [{ status: _.neq('draft') }]

  if (subCategoryName && subCategoryName !== '全部') {
    conditions.push({
      category: db.RegExp({ regexp: subCategoryName, options: 'i' })
    })
  } else if (categoryId && categoryId !== 'all') {
    conditions.push({ categoryId })
  } else if (parentCategory) {
    conditions.push({
      category: db.RegExp({ regexp: parentCategory, options: 'i' })
    })
  }

  if (keyword) {
    const kwCond = buildKeywordCondition(db, _, keyword, WIKI_FIELDS)
    if (!kwCond) return conditions.length === 1 ? conditions[0] : _.and(conditions)
    return _.and([...conditions, kwCond])
  }

  return conditions.length === 1 ? conditions[0] : _.and(conditions)
}

function parsePriceBound(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 商品筛选统一走 canonical ID + 名称别名兜底：
 * - 二级：subCategoryId / categoryId(当其为 L2) 优先，兼匹配 category 字符串
 * - 一级：rootCategoryId 优先，兼 rootCategoryName / 旧一级短名别名
 */
function buildProductCond(parentCategory, subCategoryName, filters = {}, ids = {}) {
  const conditions = [{ isOffShelf: _.neq(true) }]
  const rootCategoryId = ids.rootCategoryId || null
  const subCategoryId = ids.subCategoryId || null

  if (subCategoryId) {
    const name = subCategoryName && subCategoryName !== '全部' ? subCategoryName : ''
    const orConds = [{ categoryId: subCategoryId }]
    if (name) {
      orConds.push({ category: name })
      orConds.push({ category: db.RegExp({ regexp: escapeRegExp(name), options: 'i' }) })
    }
    conditions.push(_.or(orConds))
  } else if (subCategoryName && subCategoryName !== '全部') {
    conditions.push(_.or([
      { category: subCategoryName },
      { category: db.RegExp({ regexp: escapeRegExp(subCategoryName), options: 'i' }) }
    ]))
  } else if (rootCategoryId) {
    const aliases = parentCategory ? collectRootAliases(parentCategory) : []
    const orConds = [
      { rootCategoryId },
      ...(aliases.length
        ? [{ rootCategoryName: _.in(aliases) }, { category: _.in(aliases) }]
        : [])
    ]
    conditions.push(_.or(orConds))
  } else if (parentCategory) {
    // Admin 写入 category=二级名、rootCategoryName=一级馆；勿对「动物/海」等短词做 category 模糊匹配
    const aliases = collectRootAliases(parentCategory)
    if (aliases.length) {
      conditions.push(_.or([
        { rootCategoryName: _.in(aliases) },
        { category: _.in(aliases) }
      ]))
    } else {
      conditions.push({ category: db.RegExp({ regexp: escapeRegExp(parentCategory), options: 'i' }) })
    }
  }

  const channel = normalizeChannel(filters.channel)
  if (channel) {
    const vals = enumMatchValues('channel', channel)
    conditions.push(vals.length === 1 ? { channel: vals[0] } : { channel: _.in(vals) })
  }

  const craftType = normalizeCraftType(filters.craftType)
  if (craftType) {
    const vals = enumMatchValues('craftType', craftType)
    conditions.push(vals.length === 1 ? { craftType: vals[0] } : { craftType: _.in(vals) })
  }

  const craftProcess = normalizeCraftProcess(filters.craftProcess)
  if (craftProcess) {
    const vals = enumMatchValues('craftProcess', craftProcess)
    conditions.push(vals.length === 1 ? { craftProcess: vals[0] } : { craftProcess: _.in(vals) })
  }

  const priceMin = parsePriceBound(filters.priceMin)
  const priceMax = parsePriceBound(filters.priceMax)
  if (priceMin != null) conditions.push({ price: _.gte(priceMin) })
  if (priceMax != null) conditions.push({ price: _.lte(priceMax) })

  return conditions.length === 1 ? conditions[0] : _.and(conditions)
}

function collectCloudFileIds(items, field) {
  const ids = new Set()
  ;(items || []).forEach((item) => {
    const url = item[field]
    if (url && String(url).startsWith('cloud://')) ids.add(url)
  })
  return [...ids]
}

async function resolveCloudUrls(urlMap, fileList) {
  for (let i = 0; i < fileList.length; i += 50) {
    const chunk = fileList.slice(i, i + 50)
    try {
      const res = await cloud.getTempFileURL({ fileList: chunk })
      ;(res.fileList || []).forEach((item) => {
        if (item.fileID && item.tempFileURL) urlMap[item.fileID] = item.tempFileURL
      })
    } catch (e) {
      console.warn('getEncyclopediaFeed resolveCloudUrls', e.message)
    }
  }
}

function mapDisplayUrl(url, urlMap) {
  if (!url) return ''
  if (url.startsWith('cloud://') && urlMap[url]) return urlMap[url]
  return url
}

exports.main = async (event) => {
  const {
    categoryId = null,
    rootCategoryId = null,
    subCategoryId = null,
    parentCategory = '',
    subCategoryName = '',
    keyword = '',
    channel = '',
    craftType = '',
    craftProcess = '',
    priceMin = null,
    priceMax = null,
    contentSkip = 0,
    contentLimit = 8,
    productSkip = 0,
    productLimit = 6
  } = event

  const productFilters = { channel, craftType, craftProcess, priceMin, priceMax }
  // categoryId 历史语义：馆藏 Tab 传一级 _id；筛选二级时用 subCategoryId
  const resolvedRootId = rootCategoryId || (categoryId && !subCategoryId && !subCategoryName ? categoryId : null)
  const resolvedSubId = subCategoryId || null

  try {
    const categoryFilter = { categoryId: resolvedRootId || categoryId, parentCategory }
    const linkedIds = await collectLinkedProductIds(
      parentCategory || resolvedRootId || categoryId ? categoryFilter : null
    )

    // 多维筛只作用于可购商品；档案流保持原品类逻辑
    const contentQuery = buildContentQuery({
      categoryId: resolvedSubId || resolvedRootId || categoryId,
      parentCategory,
      subCategoryName,
      keyword
    })
    const contentCountRes = await db.collection(CMS_COLLECTION).where(contentQuery).count()
    const contentTotal = contentCountRes.total || 0

    let contentItems = []
    if (contentLimit > 0) {
      let rawContent = []
      if (keyword) {
        const fetchCap = Math.min(
          KEYWORD_RANK_FETCH_CAP,
          Math.max(contentTotal, contentSkip + contentLimit)
        )
        const contentRes = await db.collection(CMS_COLLECTION)
          .where(contentQuery)
          .limit(fetchCap)
          .get()
        rawContent = rankByKeyword(contentRes.data || [], keyword).slice(
          contentSkip,
          contentSkip + contentLimit
        )
      } else {
        let contentRes
        try {
          contentRes = await db.collection(CMS_COLLECTION)
            .where(contentQuery)
            .orderBy('_createTime', 'desc')
            .skip(contentSkip)
            .limit(contentLimit)
            .get()
        } catch (e) {
          contentRes = await db.collection(CMS_COLLECTION)
            .where(contentQuery)
            .skip(contentSkip)
            .limit(contentLimit)
            .get()
        }
        rawContent = contentRes.data || []
      }
      contentItems = await Promise.all(rawContent.map(async (item) => {
        const hint = await resolveCommerceHint(
          item.relatedProductIds || [],
          item.category || parentCategory,
          Array.from(linkedIds)
        )
        return {
          _id: item._id,
          cardType: 'content',
          title: item.title,
          latinName: item.latinName || '',
          brief: item.brief || '',
          coverImage: item.coverImage || item.cover || '',
          type: item.type || 'specimen',
          typeLabel: formatTypeLabel(item.type),
          relatedProductIds: item.relatedProductIds || [],
          ...hint
        }
      }))
    }

    const productCond = buildProductCond(parentCategory, subCategoryName, productFilters, {
      rootCategoryId: resolvedRootId,
      subCategoryId: resolvedSubId
    })
    const linkedArr = Array.from(linkedIds)
    let productWhere
    if (keyword) {
      const productKwCond = buildKeywordCondition(db, _, keyword, PRODUCT_FIELDS)
      productWhere = _.and([
        productCond,
        linkedArr.length ? { _id: _.nin(linkedArr) } : {},
        productKwCond || { title: db.RegExp({ regexp: keyword, options: 'i' }) }
      ])
    } else {
      productWhere = linkedArr.length
        ? _.and([productCond, { _id: _.nin(linkedArr) }])
        : productCond
    }

    const productCountRes = await db.collection('products').where(productWhere).count()
    const orphanTotal = productCountRes.total || 0

    let rankedProductRows = []
    if (productLimit > 0) {
      if (keyword) {
        const fetchCap = Math.min(
          KEYWORD_RANK_FETCH_CAP,
          Math.max(orphanTotal, productSkip + productLimit)
        )
        const productRes = await db.collection('products')
          .where(productWhere)
          .limit(fetchCap)
          .get()
        rankedProductRows = rankByKeyword(productRes.data || [], keyword).slice(
          productSkip,
          productSkip + productLimit
        )
      } else {
        const productRes = await db.collection('products')
          .where(productWhere)
          .orderBy('createTime', 'desc')
          .skip(productSkip)
          .limit(productLimit)
          .get()
        rankedProductRows = productRes.data || []
      }
    }

    const orphanProducts = rankedProductRows.map((p) => ({
      _id: p._id,
      cardType: 'product',
      title: p.title,
      latinName: p.latinName || '',
      price: p.price,
      displayImage: (p.images && p.images[0]) || '',
      category: p.category || '',
      channel: normalizeChannel(p.channel) || '',
      craftType: normalizeCraftType(p.craftType) || '',
      craftProcess: normalizeCraftProcess(p.craftProcess) || '',
      stock: getProductStock(p),
      soldOut: isProductSoldOut(p),
      // C 端卡片角标（与首页 ProductCard 同源）：
      // 孤品 = isUnique（Admin）/ isOneOfAKind（店长端）/ isTreasure（镇店之宝）
      // 合法带证 = protectionType 非 none
      isUnique: p.isUnique === true,
      isOneOfAKind: p.isOneOfAKind === true,
      isTreasure: p.isTreasure === true,
      protectionType: p.protectionType || 'none',
      sensitiveBlur: p.sensitiveBlur === true || p.contentWarning === true
    }))

    const urlMap = {}
    const allFileIds = [
      ...collectCloudFileIds(contentItems, 'coverImage'),
      ...collectCloudFileIds(orphanProducts, 'displayImage')
    ]
    if (allFileIds.length) {
      await resolveCloudUrls(urlMap, allFileIds)
    }
    const resolvedContent = contentItems.map((item) => ({
      ...item,
      coverImage: mapDisplayUrl(item.coverImage, urlMap)
    }))
    const resolvedProducts = orphanProducts.map((p) => ({
      ...p,
      displayImage: mapDisplayUrl(p.displayImage, urlMap)
    }))

    return {
      success: true,
      contentItems: resolvedContent,
      orphanProducts: resolvedProducts,
      contentTotal,
      orphanTotal,
      hasMoreContent: contentSkip + contentItems.length < contentTotal,
      hasMoreProducts: productSkip + orphanProducts.length < orphanTotal
    }
  } catch (err) {
    console.error('getEncyclopediaFeed', err)
    return {
      success: false,
      msg: err.message || '加载失败',
      contentItems: [],
      orphanProducts: [],
      contentTotal: 0,
      orphanTotal: 0,
      hasMoreContent: false,
      hasMoreProducts: false
    }
  }
}
