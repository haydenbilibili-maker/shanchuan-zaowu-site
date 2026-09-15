// cloudfunctions/getWikiData/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 🟢 配置：CMS 集合名称
const CMS_COLLECTION = 'cms_wikis' // 专题展览数据集合

function getProductStock(p) {
  if (!p) return 0
  if (p.hasSku && p.skus && p.skus.length) {
    return p.skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0)
  }
  return parseInt(p.stock, 10) || 0
}

function skuKey(productId, skuId) {
  const pid = String(productId || '').trim()
  const sid = String(skuId || '').trim()
  if (!pid) return ''
  return sid ? `${pid}::${sid}` : pid
}

function relatedIdsFromSkus(relatedSkus) {
  const ids = []
  const seen = {}
  ;(Array.isArray(relatedSkus) ? relatedSkus : []).forEach((item) => {
    const id = String((item && item.productId) || '').trim()
    if (!id || seen[id]) return
    seen[id] = true
    ids.push(id)
  })
  return ids
}

function normalizeRelatedSkus(skus, productIds) {
  const list = []
  const seen = {}
  const push = (productId, skuId, skuLabel) => {
    const pid = String(productId || '').trim()
    if (!pid) return
    const sid = String(skuId || '').trim()
    const key = skuKey(pid, sid)
    if (!key || seen[key]) return
    seen[key] = true
    list.push({
      productId: pid,
      skuId: sid,
      skuLabel: String(skuLabel || '').trim()
    })
  }
  if (Array.isArray(skus) && skus.length) {
    skus.forEach((item) => {
      if (!item) return
      push(item.productId, item.skuId, item.skuLabel)
    })
  } else if (Array.isArray(productIds)) {
    productIds.forEach((id) => push(id, '', ''))
  }
  return list
}

function findProductSku(product, skuId) {
  if (!product || !skuId || !Array.isArray(product.skus)) return null
  return product.skus.find((s) => s && String(s.id) === String(skuId)) || null
}

function getRelatedLineStock(product, skuId) {
  const sku = findProductSku(product, skuId)
  if (sku) return parseInt(sku.stock, 10) || 0
  return getProductStock(product)
}

function formatExhibitionItem(item) {
  if (!item) return null
  let coverImage = item.coverImage || item.cover || item.image || item.mainImage || item.cover_image || item.coverImageUrl || item.thumbnail || item.poster || ''
  if (coverImage && !String(coverImage).startsWith('http') && !String(coverImage).startsWith('cloud')) {
    coverImage = ''
  }
  return {
    _id: item._id,
    title: item.title || item.name || item.cn_name || item.name_cn || '专题展览',
    coverImage,
    cover: coverImage,
    brief: item.brief || item.description || item.summary || item.intro || '点击查看详情',
    latinName: item.latinName || item.subtitle || '',
    createTime: item.createTime || item._createTime || item.create_time
  }
}

async function querySorted(collectionName, where, limit) {
  const col = db.collection(collectionName)
  const q = where ? col.where(where) : col
  try {
    return await q.orderBy('_createTime', 'desc').limit(limit).get()
  } catch (e1) {
    try {
      return await q.orderBy('createTime', 'desc').limit(limit).get()
    } catch (e2) {
      return await q.limit(limit).get()
    }
  }
}

async function fetchCmsExhibitions() {
  const res = await querySorted(CMS_COLLECTION, { type: 'exhibition', status: 'published' }, 20)
  return (res.data || []).map(formatExhibitionItem).filter(Boolean)
}

async function fetchLegacyExhibitions() {
  const res = await querySorted('curated_collections', null, 20)
  return (res.data || []).map(formatExhibitionItem).filter(Boolean)
}

async function fetchRelatedArticles(keys) {
  const list = (keys || []).map((k) => String(k || '').trim()).filter(Boolean)
  if (!list.length) return []
  try {
    const res = await db.collection('articles').where({ _seedKey: _.in(list) }).get()
    const map = {}
    ;(res.data || []).forEach((a) => {
      if (!a || (a.status && a.status !== 'published')) return
      map[a._seedKey] = {
        _id: a._id,
        title: a.title,
        brief: a.brief || '',
        coverImage: a.coverImage || a.cover || '',
        _seedKey: a._seedKey
      }
    })
    return list.map((k) => map[k]).filter(Boolean)
  } catch (e) {
    console.warn('relatedArticles query failed', e)
    return []
  }
}

async function fetchAlternativeProducts(category, excludeIds) {
  if (!category) return []
  const altRes = await db.collection('products')
    .where({
      category: db.RegExp({ regexp: category, options: 'i' }),
      isOffShelf: _.neq(true),
      _id: _.nin(excludeIds.length ? excludeIds : [''])
    })
    .limit(20)
    .get()
  return (altRes.data || []).filter((p) => getProductStock(p) > 0).slice(0, 4)
}

exports.main = async (event, context) => {
  const { action, categoryId, keyword, wikiId, page = 1, pageSize = 20 } = event

  // 1. 专题列表：优先 cms_wikis（type=exhibition, published），空/失败再降级 curated_collections
  if (action === 'get_exhibitions') {
    try {
      let data = []
      try {
        data = await fetchCmsExhibitions()
      } catch (cmsErr) {
        console.warn('cms_wikis get_exhibitions failed', cmsErr)
      }
      if (!data.length) {
        try {
          data = await fetchLegacyExhibitions()
        } catch (legacyErr) {
          console.warn('curated_collections fallback failed', legacyErr)
        }
      }
      return { success: true, data }
    } catch (e) {
      console.error('获取专题展览失败', e)
      return { success: false, data: [], msg: e.message }
    }
  }

  // 2. 获取分类 (支持一级和二级分类)
  if (action === 'get_categories') {
    const { level, parentId } = event;
    
    console.log('========== 获取分类 ==========');
    console.log('参数:', { level, parentId });
    
    // 如果指定了 parentId，获取该父分类下的二级分类（level2）
    if (parentId && parentId !== 'all') {
      console.log('========== 查询二级分类 ==========');
      console.log('📌 parentId:', parentId);
      console.log('📌 查询条件: { level: 2, parentId: "' + parentId + '", status: "active" }');
      
      try {
        // 方法1：先查询所有 level 2 的数据，然后在代码中过滤
        // 这样可以避免云数据库查询条件可能的问题
        console.log('🔍 方法1: 查询所有 level 2 分类，然后过滤 parentId');
        const allLevel2Res = await db.collection('categories')
          .where({ level: 2 })
          .get();
        
        console.log('📊 数据库中所有 level 2 分类数量:', allLevel2Res.data.length);
        if (allLevel2Res.data.length > 0) {
          console.log('📊 所有 level 2 分类的 parentId 列表:');
          allLevel2Res.data.forEach((item, idx) => {
            console.log(`  ${idx + 1}. ${item.name} - parentId: "${item.parentId}" (期望: "${parentId}")`);
          });
        }
        
        // 在代码中过滤 parentId 和 status
        let filteredData = (allLevel2Res.data || []).filter(item => {
          return item.parentId === parentId && item.status === 'active';
        });
        
        console.log('📦 方法1过滤后的数据数量:', filteredData.length);
        
        // 如果方法1没有结果，尝试方法2：使用 where 条件查询
        if (filteredData.length === 0) {
          console.log('🔍 方法1无结果，尝试方法2: 使用 where 条件查询');
          const queryCondition = { 
            level: 2,
            parentId: parentId,
            status: 'active'
          };
          console.log('🔍 执行查询，条件:', JSON.stringify(queryCondition, null, 2));
          
          const res = await db.collection('categories')
            .where(queryCondition)
            .orderBy('sortOrder', 'asc')
            .get();
          
          console.log('📦 方法2查询返回的原始数据数量:', res.data.length);
          filteredData = res.data || [];
        }
        
        // 按 sortOrder 排序
        filteredData.sort((a, b) => (a.sortOrder || 999) - (b.sortOrder || 999));
        
        console.log('📦 最终查询返回的原始数据数量:', filteredData.length);
        if (filteredData.length > 0) {
          console.log('📦 查询返回的原始数据:', JSON.stringify(filteredData, null, 2));
        }
        
        // 再次严格过滤，确保数据正确（双重验证）
        const finalFilteredData = filteredData.filter(item => {
          const isLevel2 = item.level === 2;
          const matchesParent = item.parentId === parentId;
          const isActive = item.status === 'active';
          
          if (!isLevel2) {
            console.warn(`⚠️ 过滤掉非 level 2 分类: ${item.name}, level: ${item.level}`);
            return false;
          }
          if (!matchesParent) {
            console.warn(`⚠️ 过滤掉 parentId 不匹配的分类: ${item.name}, parentId: "${item.parentId}", 期望: "${parentId}"`);
            return false;
          }
          if (!isActive) {
            console.warn(`⚠️ 过滤掉非激活状态分类: ${item.name}, status: ${item.status}`);
            return false;
          }
          
          return true;
        });
        
        filteredData = finalFilteredData;
        
        console.log('✅ 过滤后的二级分类数量:', filteredData.length);
        if (filteredData.length > 0) {
          console.log('✅ 二级分类列表:');
          filteredData.forEach((item, idx) => {
            console.log(`  ${idx + 1}. ${item.name} (${item.latinName || item.name}) - sortOrder: ${item.sortOrder}, parentId: "${item.parentId}"`);
          });
          console.log('✅ 二级分类示例数据:', JSON.stringify(filteredData[0], null, 2));
        } else {
          console.warn('⚠️ 未找到匹配的二级分类，parentId:', parentId);
          console.log('💡 提示：请确认数据库中是否存在 level: 2, parentId: "' + parentId + '", status: "active" 的分类数据');
        }
        return { success: true, data: filteredData };
      } catch (e) {
        console.error('❌ 查询二级分类失败:', e);
        console.error('❌ 错误堆栈:', e.stack);
        return { success: false, data: [], msg: e.message };
      }
    }
    
    // 如果只指定了 level，按 level 查询（不限制 parentId）
    if (level) {
      console.log('按 level 查询，level:', level);
      try {
        const res = await db.collection('categories')
          .where({ level: level })
          .orderBy('sortOrder', 'asc')
          .get();
        console.log('查询到分类数量:', res.data.length);
        return { success: true, data: res.data || [] };
      } catch (e) {
        console.error('按 level 查询失败:', e);
        return { success: false, data: [], msg: e.message };
      }
    }
    
    // 默认获取一级分类
    console.log('查询一级分类');
    try {
      const res = await db.collection('categories')
        .where({ level: 1 })
        .orderBy('sortOrder', 'asc')
        .get();
      console.log('查询到一级分类数量:', res.data.length);
      return { success: true, data: res.data || [] };
    } catch (e) {
      console.error('查询一级分类失败:', e);
      return { success: false, data: [], msg: e.message };
    }
  }

  // 3. 获取列表 (读取 CMS 集合)
  if (action === 'get_list') {
    let query = {}
    
    // 筛选：如果 CMS 里存的是关联类型，这里需要对应
    if (categoryId && categoryId !== 'all') {
      query.categoryId = categoryId 
    }
    
    if (keyword) {
      query = _.or([
        { title: db.RegExp({ regexp: keyword, options: 'i' }) }, // CMS title
        { latinName: db.RegExp({ regexp: keyword, options: 'i' }) }
      ])
    }

    const res = await db.collection(CMS_COLLECTION)
      .where(query)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .orderBy('_createTime', 'desc') // CMS 默认时间字段
      .get()
    
    // 字段映射：CMS字段 -> 前端通用字段
    const list = res.data.map(item => ({
      _id: item._id,
      title: item.title,          // 俗名
      latinName: item.latinName,  // 拉丁名
      coverImage: item.coverImage, // 封面
      brief: item.brief || '点击查看详情', // 简介
      category: 'Specimen'
    }))

    // 如果 CMS 没数据，为了演示，可以保留之前的 products 降级逻辑
    // ... (此处省略降级逻辑以保持代码纯净，建议真实填充数据)

    return { success: true, data: list, stats: { total: 100 } };
  }

  // 3. 获取详情 (读取 CMS 集合)
  if (action === 'get_detail') {
    try {
      const doc = await db.collection(CMS_COLLECTION).doc(wikiId).get();
      const data = doc.data;
      
      // 构造标准返回结构
      const wikiData = {
        _id: data._id,
        type: data.type || 'specimen',
        title: data.title,
        commonName: data.title,
        latinName: data.latinName || '',
        brief: data.brief || '',
        coverImage: data.coverImage,
        content: data.content,
        gallery: data.gallery || [data.coverImage],
        tags: data.tags || [],
        category: data.category || '',
        taxonomy: data.taxonomy || null,
        distribution: data.distribution || data.geoDistribution || '',
        habitat: data.habitat || '',
        morphology: data.morphology || data.features || '',
        habits: data.habits || data.ecology || '',
        iucn: data.iucn || (data.conservation && data.conservation.iucn) || '',
        protectionLevel: data.protectionLevel || data.china_level || (data.conservation && data.conservation.china) || '',
        cites: data.cites || (data.conservation && data.conservation.cites) || '',
        stats: { views: 0, likes: 0 }
      };

      let relatedProducts = []
      let alternativeProducts = []
      let usingAlternative = false
      const relatedSkus = normalizeRelatedSkus(data.relatedSkus, data.relatedProductIds)
      const relatedIds = relatedIdsFromSkus(relatedSkus)

      if (relatedIds.length > 0) {
        const pRes = await db.collection('products')
          .where({ _id: _.in(relatedIds), isOffShelf: _.neq(true) })
          .get()
        const productMap = {}
        ;(pRes.data || []).forEach((p) => { productMap[p._id] = p })

        relatedProducts = relatedSkus.map((rel) => {
          const p = productMap[rel.productId]
          if (!p) return null
          const sku = findProductSku(p, rel.skuId)
          const skuLabel = rel.skuLabel || (sku && (sku.specLabel || '')) || ''
          const price = sku ? (parseFloat(sku.price) || p.price) : p.price
          const image = (sku && sku.image) || (p.images && p.images[0]) || p.image || ''
          return {
            ...p,
            price,
            images: image ? [image].concat((p.images || []).filter((u) => u !== image)) : (p.images || []),
            relatedSkuId: rel.skuId || '',
            relatedSkuLabel: skuLabel,
            _relatedKey: skuKey(p._id, rel.skuId)
          }
        }).filter(Boolean)

        const inStock = relatedProducts.filter((p) => getRelatedLineStock(p, p.relatedSkuId) > 0)
        if (inStock.length) {
          relatedProducts = inStock
        } else if (relatedProducts.length) {
          alternativeProducts = await fetchAlternativeProducts(data.category, relatedIds)
          usingAlternative = alternativeProducts.length > 0
        }
      }

      if (!relatedProducts.length && !alternativeProducts.length && data.category) {
        alternativeProducts = await fetchAlternativeProducts(data.category, relatedIds)
        usingAlternative = alternativeProducts.length > 0
      }

      if (alternativeProducts.length) {
        alternativeProducts = alternativeProducts.map((p) => ({
          ...p,
          relatedSkuId: '',
          relatedSkuLabel: '',
          _relatedKey: skuKey(p._id, '')
        }))
      }

      const relatedArticles = await fetchRelatedArticles(data.relatedArticleSeedKeys)

      return {
        success: true,
        data: wikiData,
        relatedProducts,
        alternativeProducts,
        usingAlternative,
        relatedArticles
      };

    } catch (e) {
      // 降级：查 Products (兼容旧数据)
      return await fallbackToProduct(wikiId);
    }
  }
}

// 辅助：降级查询 Product 表
async function fallbackToProduct(id) {
    try {
        const pRes = await db.collection('products').doc(id).get();
        const p = pRes.data;
        return {
            success: true,
            data: {
                _id: p._id, type: 'specimen', commonName: p.title, latinName: p.latinName,
                coverImage: p.images[0], content: `<p>${p.description}</p>`, gallery: p.images
            },
            relatedProducts: []
        };
    } catch(e) { return { success: false, msg: 'Not Found' }; }
}