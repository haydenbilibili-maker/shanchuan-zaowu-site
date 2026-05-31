// cloudfunctions/getArchiveData/index.js
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  try {
    console.log('开始执行 getArchiveData，参数:', event)

    // 1. 简单的全量统计 (先不加任何过滤条件，排查是否能读到库)
    // 注意：如果 wikis 集合不存在，count 会报错，所以加 try-catch 包裹
    let wikiTotal = 0
    try {
      const wikiRes = await db.collection('wikis').count()
      wikiTotal = wikiRes.total
    } catch (e) {
      console.warn('wikis 集合可能不存在或查询失败', e)
    }

    let productTotal = 0
    try {
      // 暂时去掉 isOffShelf 过滤，先看总数
      const productRes = await db.collection('products').count()
      productTotal = productRes.total
    } catch (e) {
      console.error('products 集合查询失败', e)
    }

    console.log(`统计结果: Wikis=${wikiTotal}, Products=${productTotal}`)

    const totalArchives = wikiTotal + productTotal

    // 2. 获取列表数据
    const {
      keyword,
      category,
      page = 1,
      pageSize = 20
    } = event
    
    let query = {}

    // 分类筛选逻辑优化：支持模糊匹配或精确匹配
    // 如果你的数据库存的是 "动物"，而前端传的是 "动物"，直接匹配
    if (category && category !== '全部' && category !== 'ALL' && category !== 'all') {
       // 尝试同时匹配 category 字段 (字符串)
       query.category = db.RegExp({ regexp: category, options: 'i' })
    }

    // 搜索逻辑
    if (keyword) {
      query = _.and([
        query,
        _.or([
          { title: db.RegExp({ regexp: keyword, options: 'i' }) },
          { commonName: db.RegExp({ regexp: keyword, options: 'i' }) },
          { latinName: db.RegExp({ regexp: keyword, options: 'i' }) }
        ])
      ])
    }

    console.log('查询条件 query:', query)

    const listRes = await db.collection('products')
      .where(query)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .orderBy('createTime', 'desc') // 确保有 createTime 字段，否则可能乱序或报错
      .get()

    // 安全获取第一张图片的工具函数
    const getFirstImage = (images) => {
      return (images && Array.isArray(images) && images.length > 0) ? images[0] : ''
    }

    const list = listRes.data.map(item => ({
      _id: item._id,
      title: item.title || item.commonName || '未命名',
      latinName: item.latinName || '',
      category: item.category || '其他',
      image: getFirstImage(item.images),
      price: item.price || 0
    }))

    return {
      success: true,
      stats: {
        total: totalArchives,
        wikiCount: wikiTotal,
        productCount: productTotal
      },
      list: list
    }

  } catch (e) {
    console.error('云函数执行报错:', e)
    return {
      success: false,
      msg: e.message,
      stack: e.stack
    }
  }
}