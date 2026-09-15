// subpackages/feature/articles/detail/index.js
const app = getApp()
const db = wx.cloud.database()
const _ = db.command
const uiIcons = require('../../utils/uiIcons')
const { getWindowInfo } = require('../../../../utils/systemInfo')
const { cdnPath } = require('../../../../config/cloudEnv')

const FALLBACK_COVER = cdnPath('stores/store_shanhaizaowu.png')

function normalizeArticle(article) {
  const item = article || {}
  const images = Array.isArray(item.images) ? item.images.filter(Boolean) : []
  return {
    ...item,
    title: item.title || '山海笔记',
    author: item.author || '山海造物',
    coverImage: item.coverImage || images[0] || FALLBACK_COVER,
    images,
    tags: Array.isArray(item.tags) ? item.tags : [],
    stats: item.stats || { views: 0, likes: 0, comments: 0 }
  }
}

Page({
  data: {
    statusBarHeight: 20,
    categoryIcon: uiIcons.categoryIcon('knowledge'),
    iconView: uiIcons.view,
    iconLike: uiIcons.like,
    iconLikeActive: uiIcons.likeActive,
    iconCollect: uiIcons.collect,
    iconCollectActive: uiIcons.collectActive,
    iconShare: '/assets/icons/share.png',
    fallbackCover: FALLBACK_COVER,
    articleId: '',
    loadError: false,
    article: { stats: { views: 0, likes: 0, comments: 0 }, images: [], tags: [] },
    relatedArticles: [],
    isCollected: false,
    isLiked: false,
    showVideoControls: false,
    videoSpeed: 1.0,
    videoContext: null,
    savingCard: false,
    tagStyle: {
      p: 'margin-bottom: 20px; line-height: 1.8; color: #D5D1C8; text-align: justify;',
      h1: 'font-size: 22px; font-weight: bold; color: #C4A76C; margin: 30px 0 15px;',
      h2: 'font-size: 20px; font-weight: bold; color: #eee; margin: 25px 0 12px; border-left: 4px solid #C4A76C; padding-left: 12px;',
      h3: 'font-size: 18px; font-weight: bold; color: #ddd; margin: 20px 0 10px;',
      img: 'border-radius: 8px; margin: 20px 0; width: 100% !important; height: auto !important; max-width: 100%;',
      blockquote: 'background: rgba(255,255,255,0.04); border-left: 6px solid #C4A76C; padding: 16px; margin: 20px 0; color: #A09A90; font-family: Georgia, "Times New Roman"; font-style: italic;',
      strong: 'color: #fff; font-weight: bold;',
      ul: 'padding-left: 20px; margin: 15px 0;',
      ol: 'padding-left: 20px; margin: 15px 0;',
      li: 'margin: 8px 0; line-height: 1.8;'
    }
  },

  onLoad(options) {
    const win = getWindowInfo()
    this.setData({ statusBarHeight: win.statusBarHeight || 20 })

    if (options.id) {
      this.setData({ articleId: options.id })
      this.loadDetail(options.id)
      this.checkCollectionStatus(options.id)
      this.checkLikeStatus(options.id)
    } else {
      this.setData({ loadError: true })
    }
  },

  onReady() {
    this.videoContext = wx.createVideoContext('article-video', this)
  },

  // 加载文章详情
  async loadDetail(id) {
    wx.showLoading({ title: '加载中…' })
    this.setData({ loadError: false, articleId: id })
    
    try {
      const res = await wx.cloud.callFunction({
        name: 'getArticles',
        data: { action: 'get_detail', articleId: id }
      })

      if (res.result && res.result.success) {
        const article = normalizeArticle(res.result.data)
        const related = (res.result.relatedArticles || []).map((item) => normalizeArticle(item))
        this.setData({
          article,
          relatedArticles: related,
          categoryIcon: uiIcons.categoryIcon(article.category || 'knowledge'),
          loadError: false
        })
      } else {
        this.setData({ loadError: true })
        wx.showToast({ title: (res.result && res.result.msg) || '加载失败', icon: 'none' })
      }
    } catch (e) {
      console.error('加载文章失败:', e)
      this.setData({ loadError: true })
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  retryLoad() {
    const id = this.data.articleId
    if (!id) {
      this.goBack()
      return
    }
    this.loadDetail(id)
    this.checkCollectionStatus(id)
    this.checkLikeStatus(id)
  },

  // 检查收藏状态
  async checkCollectionStatus(articleId) {
    try {
      const user = app.globalData.userInfo
      if (!user) return

      const res = await db.collection('collections')
        .where({
          _openid: user._openid,
          targetType: 'article',
          targetId: articleId
        })
        .get()

      this.setData({ isCollected: !!(res.data && res.data.length) })
    } catch (e) {
      console.error('检查收藏状态失败:', e)
    }
  },

  // 检查点赞状态
  async checkLikeStatus(articleId) {
    try {
      const user = app.globalData.userInfo
      if (!user) return

      const res = await db.collection('likes')
        .where({
          _openid: user._openid,
          targetType: 'article',
          targetId: articleId
        })
        .get()

      this.setData({ isLiked: !!(res.data && res.data.length) })
    } catch (e) {
      console.error('检查点赞状态失败:', e)
    }
  },

  // 收藏/取消收藏（经 toggleCollection，避免直写）
  async toggleCollect() {
    try {
      const user = app.globalData.userInfo
      if (!user) {
        wx.showToast({ title: '请先登录', icon: 'none' })
        return
      }

      const articleId = this.data.article._id
      if (!articleId) {
        wx.showToast({ title: '内容不存在', icon: 'none' })
        return
      }

      const res = await wx.cloud.callFunction({
        name: 'toggleCollection',
        data: {
          engage: 'articleCollect',
          type: 'article',
          targetId: articleId,
          snapshot: {
            title: this.data.article.title,
            coverImage: this.data.article.coverImage
          }
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        throw new Error(result.msg || '操作失败')
      }
      const collected = result.collected === true || result.action === 'added'
      this.setData({ isCollected: collected })
      wx.showToast({
        title: collected ? '已收藏' : '已取消',
        icon: 'success'
      })
    } catch (e) {
      console.error('收藏操作失败:', e)
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  // 点赞/取消点赞（经云函数；articles.write:false 不可客户端改 stats）
  async toggleLike() {
    try {
      const user = app.globalData.userInfo
      if (!user) {
        wx.showToast({ title: '请先登录', icon: 'none' })
        return
      }

      const articleId = this.data.article._id
      if (!articleId) {
        wx.showToast({ title: '内容不存在', icon: 'none' })
        return
      }
      const currentLikes = (this.data.article.stats && this.data.article.stats.likes) || 0

      const res = await wx.cloud.callFunction({
        name: 'toggleCollection',
        data: {
          engage: 'articleLike',
          targetId: articleId
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        throw new Error(result.msg || '操作失败')
      }
      const liked = result.liked === true || result.action === 'added'
      this.setData({
        isLiked: liked,
        'article.stats.likes': liked
          ? currentLikes + 1
          : Math.max(0, currentLikes - 1)
      })
      wx.vibrateShort({ type: 'light' })
    } catch (e) {
      console.error('点赞操作失败:', e)
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  async saveShareCard() {
    if (this.data.savingCard) return
    const src = (this.data.article && this.data.article.coverImage) || FALLBACK_COVER
    if (!src) {
      wx.showToast({ title: '暂无可保存的封面', icon: 'none' })
      return
    }
    this.setData({ savingCard: true })
    wx.showLoading({ title: '生成分享卡', mask: true })
    try {
      let filePath = src
      if (src.indexOf('cloud://') === 0) {
        const tmp = await wx.cloud.getTempFileURL({ fileList: [src] })
        filePath = (tmp.fileList && tmp.fileList[0] && tmp.fileList[0].tempFileURL) || ''
      }
      if (!filePath) throw new Error('no url')
      const info = await wx.getImageInfo({ src: filePath })
      wx.hideLoading()
      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: info.path,
          success: resolve,
          fail: reject
        })
      })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      const msg = (e && e.errMsg) || ''
      if (msg.indexOf('auth') > -1 || msg.indexOf('authorize') > -1) {
        wx.showModal({ title: '需要相册权限', content: '请在设置中允许保存到相册，以便保存分享卡。', showCancel: false })
      } else {
        wx.showToast({ title: '分享卡保存失败', icon: 'none' })
      }
    } finally {
      this.setData({ savingCard: false })
    }
  },

  /** 转载内容：复制原文链接（小程序内不便直接外跳，复制后由用户自行打开） */
  copySourceUrl() {
    const url = (this.data.article && this.data.article.sourceUrl) || ''
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '原文链接已复制', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败，请长按选择', icon: 'none' })
    })
  },

  onCoverError() {
    if (this.data.article.coverImage !== FALLBACK_COVER) {
      this.setData({ 'article.coverImage': FALLBACK_COVER })
    }
  },

  onRelatedCoverError(e) {
    const idx = e.currentTarget.dataset.index
    if (idx == null) return
    this.setData({ [`relatedArticles[${idx}].coverImage`]: FALLBACK_COVER })
  },

  onShareAppMessage() {
    const id = this.data.article && this.data.article._id
    return {
      title: (this.data.article && this.data.article.title) || '山海造物',
      path: id ? `/subpackages/feature/articles/detail/index?id=${id}` : '/subpackages/feature/articles/index',
      imageUrl: this.data.article && this.data.article.coverImage
    }
  },

  // 跳转相关文章
  goToRelatedArticle(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '内容不存在', icon: 'none' })
      return
    }
    wx.redirectTo({
      url: `/subpackages/feature/articles/detail/index?id=${id}`,
      fail: () => wx.showToast({ title: '无法打开笔记', icon: 'none' })
    })
  },

  // 视频播放事件
  onVideoPlay() {
    this.setData({ showVideoControls: true })
    // 记录视频播放行为
    if (app.globalData.userInfo) {
      wx.cloud.callFunction({
        name: 'trackUserBehavior',
        data: {
          action: 'video_play',
          targetType: 'article',
          targetId: this.data.article._id
        }
      }).catch(() => {})
    }
  },

  onVideoPause() {
    // 暂停时不隐藏控制栏，方便操作
  },

  onVideoEnd() {
    // 播放结束，记录完整播放
    if (app.globalData.userInfo) {
      wx.cloud.callFunction({
        name: 'trackUserBehavior',
        data: {
          action: 'video_complete',
          targetType: 'article',
          targetId: this.data.article._id
        }
      }).catch(() => {})
    }
  },

  // 切换播放速度
  toggleVideoSpeed() {
    const speeds = [1.0, 1.25, 1.5, 2.0]
    const currentIndex = speeds.indexOf(this.data.videoSpeed)
    const nextIndex = (currentIndex + 1) % speeds.length
    const nextSpeed = speeds[nextIndex]
    
    this.setData({ videoSpeed: nextSpeed })
    if (this.videoContext) {
      this.videoContext.playbackRate(nextSpeed)
    }
    wx.showToast({
      title: `播放速度 ${nextSpeed}x`,
      icon: 'none',
      duration: 1000
    })
  },

  // 返回
  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({
        url: '/subpackages/feature/articles/index',
        fail: () => wx.switchTab({ url: '/pages/index/index' })
      })
    })
  }
})

