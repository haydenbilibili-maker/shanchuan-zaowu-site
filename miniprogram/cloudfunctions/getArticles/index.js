const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { action, category, keyword, articleId, page = 1, pageSize = 20, sortBy = 'createTime' } = event

  try {
    // 🟢 1. 获取文章列表
    if (action === 'get_list') {
      let query = {
        status: 'published' // 只获取已发布文章
      }

      // 分类筛选
      if (category && category !== 'all') {
        query.category = category
      }

      // 关键词搜索
      if (keyword) {
        query = _.and([
          query,
          _.or([
            { title: db.RegExp({ regexp: keyword, options: 'i' }) },
            { brief: db.RegExp({ regexp: keyword, options: 'i' }) },
            { tags: db.RegExp({ regexp: keyword, options: 'i' }) }
          ])
        ])
      }

      // 排序
      let orderBy = sortBy || 'createTime'
      if (sortBy === 'views') orderBy = 'stats.views'
      if (sortBy === 'likes') orderBy = 'stats.likes'
      if (sortBy === 'createTime') orderBy = 'createTime'

      const res = await db.collection('articles')
        .where(query)
        .orderBy(orderBy, 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()

      // 格式化数据
      const list = res.data.map(item => ({
        _id: item._id,
        title: item.title,
        brief: item.brief || '',
        coverImage: item.coverImage || '',
        category: item.category || 'knowledge',
        author: item.author || '山海造物',
        tags: item.tags || [],
        videoUrl: item.videoUrl || '',
        isUGC: !!item.isUGC,
        stats: {
          views: item.stats?.views || 0,
          likes: item.stats?.likes || 0,
          comments: item.stats?.comments || 0
        },
        createTime: item.createTime || item._createTime || Date.now()
      }))

      // 获取总数
      const countRes = await db.collection('articles').where(query).count()

      return {
        success: true,
        data: list,
        pagination: {
          page,
          pageSize,
          total: countRes.total,
          totalPages: Math.ceil(countRes.total / pageSize)
        }
      }
    }

    // 🟢 2. 获取文章详情
    if (action === 'get_detail') {
      const doc = await db.collection('articles').doc(articleId).get()
      
      if (!doc.data) {
        return { success: false, msg: '文章不存在' }
      }

      const article = doc.data

      // 增加浏览量
      await db.collection('articles').doc(articleId).update({
        data: {
          'stats.views': _.inc(1),
          updateTime: Date.now()
        }
      })

      // 格式化数据
      const articleData = {
        _id: article._id,
        title: article.title,
        brief: article.brief || '',
        coverImage: article.coverImage || '',
        category: article.category || 'knowledge',
        author: article.author || '山海造物',
        tags: article.tags || [],
        content: article.content || '',
        videoUrl: article.videoUrl || '',
        images: article.images || (article.coverImage ? [article.coverImage] : []),
        isUGC: !!article.isUGC,
        stats: {
          views: (article.stats?.views || 0) + 1,
          likes: article.stats?.likes || 0,
          comments: article.stats?.comments || 0
        },
        createTime: article.createTime || article._createTime || Date.now(),
        updateTime: article.updateTime || article._updateTime || Date.now()
      }

      // 获取相关文章推荐（优化算法：标签匹配 + 分类匹配 + 热度排序）
      let relatedArticles = []
      
      // 策略1: 标签匹配（优先级最高）
      if (article.tags && article.tags.length > 0) {
        const tagRelatedRes = await db.collection('articles')
          .where({
            tags: _.in(article.tags),
            status: 'published',
            _id: _.neq(articleId)
          })
          .orderBy('stats.views', 'desc')
          .limit(2)
          .get()
        
        relatedArticles = tagRelatedRes.data.map(item => ({
          _id: item._id,
          title: item.title,
          brief: item.brief || '',
          coverImage: item.coverImage || '',
          stats: {
            views: item.stats?.views || 0,
            likes: item.stats?.likes || 0
          },
          reason: '相关标签'
        }))
      }
      
      // 策略2: 同分类推荐（如果标签匹配不足3篇，补充同分类文章）
      if (article.category && relatedArticles.length < 3) {
        const excludeIds = [articleId, ...relatedArticles.map(r => r._id)]
        const categoryRelatedRes = await db.collection('articles')
          .where({
            category: article.category,
            status: 'published',
            _id: _.nin(excludeIds) // 排除当前文章和已推荐的文章
          })
          .orderBy('stats.views', 'desc')
          .limit(3 - relatedArticles.length)
          .get()
        
        const categoryArticles = categoryRelatedRes.data.map(item => ({
          _id: item._id,
          title: item.title,
          brief: item.brief || '',
          coverImage: item.coverImage || '',
          stats: {
            views: item.stats?.views || 0,
            likes: item.stats?.likes || 0
          },
          reason: '同分类推荐'
        }))
        
        relatedArticles = relatedArticles.concat(categoryArticles)
      }
      
      // 策略3: 热门文章补充（如果还不够，用热门文章填充）
      if (relatedArticles.length < 3) {
        const excludeIds = [articleId, ...relatedArticles.map(r => r._id)]
        const hotRelatedRes = await db.collection('articles')
          .where({
            status: 'published',
            _id: _.nin(excludeIds)
          })
          .orderBy('stats.views', 'desc')
          .limit(3 - relatedArticles.length)
          .get()
        
        const hotArticles = hotRelatedRes.data.map(item => ({
          _id: item._id,
          title: item.title,
          brief: item.brief || '',
          coverImage: item.coverImage || '',
          stats: {
            views: item.stats?.views || 0,
            likes: item.stats?.likes || 0
          },
          reason: '热门推荐'
        }))
        
        relatedArticles = relatedArticles.concat(hotArticles)
      }

      return {
        success: true,
        data: articleData,
        relatedArticles
      }
    }

    // 🟢 3. 获取文章分类列表
    if (action === 'get_categories') {
      // 返回预定义的分类
      const categories = [
        { id: 'knowledge', name: '标本知识', icon: '📚' },
        { id: 'art', name: '艺术鉴赏', icon: '🎨' },
        { id: 'craft', name: '制作工艺', icon: '🔧' },
        { id: 'story', name: '藏品故事', icon: '📖' }
      ]
      return { success: true, data: categories }
    }

    return { success: false, msg: '无效的action参数' }

  } catch (e) {
    console.error('获取文章失败:', e)
    return {
      success: false,
      msg: e.message || '获取文章失败'
    }
  }
}

