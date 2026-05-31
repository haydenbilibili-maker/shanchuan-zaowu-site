const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const CMS_COLLECTION = 'cms_wikis'

function getProductStock(p) {
  if (p.hasSku && p.skus && p.skus.length) {
    return p.skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0)
  }
  return parseInt(p.stock, 10) || 0
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
    return _.and([
      ...conditions,
      _.or([
        { title: db.RegExp({ regexp: keyword, options: 'i' }) },
        { latinName: db.RegExp({ regexp: keyword, options: 'i' }) },
        { brief: db.RegExp({ regexp: keyword, options: 'i' }) }
      ])
    ])
  }

  return conditions.length === 1 ? conditions[0] : _.and(conditions)
}

function buildProductCond(parentCategory, subCategoryName) {
  const productCond = { isOffShelf: _.neq(true) }
  if (subCategoryName && subCategoryName !== '全部') {
    productCond.category = db.RegExp({ regexp: subCategoryName, options: 'i' })
  } else if (parentCategory) {
    productCond.category = db.RegExp({ regexp: parentCategory, options: 'i' })
  }
  return productCond
}

exports.main = async (event) => {
  const {
    categoryId = null,
    parentCategory = '',
    subCategoryName = '',
    keyword = '',
    contentSkip = 0,
    contentLimit = 8,
    productSkip = 0,
    productLimit = 6
  } = event

  try {
    const categoryFilter = { categoryId, parentCategory }
    const linkedIds = await collectLinkedProductIds(
      parentCategory || categoryId ? categoryFilter : null
    )

    const contentQuery = buildContentQuery({ categoryId, parentCategory, subCategoryName, keyword })
    const contentCountRes = await db.collection(CMS_COLLECTION).where(contentQuery).count()
    const contentTotal = contentCountRes.total || 0

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

    const rawContent = contentRes.data || []
    const contentItems = await Promise.all(rawContent.map(async (item) => {
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

    const productCond = buildProductCond(parentCategory, subCategoryName)
    const linkedArr = Array.from(linkedIds)
    let productWhere
    if (keyword) {
      productWhere = _.and([
        productCond,
        linkedArr.length ? { _id: _.nin(linkedArr) } : {},
        _.or([
          { title: db.RegExp({ regexp: keyword, options: 'i' }) },
          { latinName: db.RegExp({ regexp: keyword, options: 'i' }) }
        ])
      ])
    } else {
      productWhere = linkedArr.length
        ? _.and([productCond, { _id: _.nin(linkedArr) }])
        : productCond
    }

    const productCountRes = await db.collection('products').where(productWhere).count()
    const orphanTotal = productCountRes.total || 0

    const productRes = await db.collection('products')
      .where(productWhere)
      .orderBy('createTime', 'desc')
      .skip(productSkip)
      .limit(productLimit)
      .get()

    const orphanProducts = (productRes.data || []).map((p) => ({
      _id: p._id,
      cardType: 'product',
      title: p.title,
      latinName: p.latinName || '',
      price: p.price,
      displayImage: (p.images && p.images[0]) || '',
      category: p.category || '',
      stock: getProductStock(p)
    }))

    return {
      success: true,
      contentItems,
      orphanProducts,
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
