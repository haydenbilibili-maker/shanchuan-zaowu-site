// pages/articles/detail/index.js
const app = getApp()
const db = wx.cloud.database()
const _ = db.command
const uiIcons = require('../../../utils/uiIcons')
const { getWindowInfo } = require('../../../utils/systemInfo')

Page({
  data: {
    statusBarHeight: 20,
    categoryIcon: uiIcons.categoryIcon('knowledge'),
    iconView: uiIcons.view,
    iconLike: uiIcons.like,
    iconLikeActive: uiIcons.likeActive,
    iconCollect: uiIcons.collect,
    iconCollectActive: uiIcons.collectActive,
    article: {},
    relatedArticles: [],
    isCollected: false,
    isLiked: false,
    showVideoControls: false,
    videoSpeed: 1.0,
    videoContext: null,
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
      this.loadDetail(options.id)
      this.checkCollectionStatus(options.id)
      this.checkLikeStatus(options.id)
    }
  },

  // 加载文章详情
  async loadDetail(id) {
    wx.showLoading({ title: '加载中...' })
    
    try {
      const res = await wx.cloud.callFunction({
        name: 'getArticles',
        data: { action: 'get_detail', articleId: id }
      })

      if (res.result.success) {
        const article = res.result.data
        this.setData({
          article,
          relatedArticles: res.result.relatedArticles || [],
          categoryIcon: uiIcons.categoryIcon(article.category || 'knowledge')
        })
      } else {
        wx.showToast({ title: res.result.msg || '加载失败', icon: 'none' })
      }
    } catch (e) {
      console.error('加载文章失败:', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
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

      this.setData({ isCollected: res.data.length > 0 })
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

      this.setData({ isLiked: res.data.length > 0 })
    } catch (e) {
      console.error('检查点赞状态失败:', e)
    }
  },

  // 收藏/取消收藏
  async toggleCollect() {
    try {
      const user = app.globalData.userInfo
      if (!user) {
        wx.showToast({ title: '请先登录', icon: 'none' })
        return
      }

      const articleId = this.data.article._id
      const isCollected = this.data.isCollected

      if (isCollected) {
        // 取消收藏
        await db.collection('collections')
          .where({
            _openid: user._openid,
            targetType: 'article',
            targetId: articleId
          })
          .remove()
      } else {
        // 添加收藏
        await db.collection('collections').add({
          data: {
            targetType: 'article',
            targetId: articleId,
            targetTitle: this.data.article.title,
            targetImage: this.data.article.coverImage,
            createTime: db.serverDate()
          }
        })
      }

      this.setData({ isCollected: !isCollected })
      wx.showToast({
        title: !isCollected ? '已收藏' : '已取消',
        icon: 'success'
      })
    } catch (e) {
      console.error('收藏操作失败:', e)
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  // 点赞/取消点赞
  async toggleLike() {
    try {
      const user = app.globalData.userInfo
      if (!user) {
        wx.showToast({ title: '请先登录', icon: 'none' })
        return
      }

      const articleId = this.data.article._id
      const isLiked = this.data.isLiked

      if (isLiked) {
        // 取消点赞
        await db.collection('likes')
          .where({
            _openid: user._openid,
            targetType: 'article',
            targetId: articleId
          })
          .remove()

        // 更新文章点赞数
        await db.collection('articles').doc(articleId).update({
          data: {
            'stats.likes': _.inc(-1)
          }
        })

        this.setData({
          isLiked: false,
          'article.stats.likes': Math.max(0, this.data.article.stats.likes - 1)
        })
      } else {
        // 添加点赞
        await db.collection('likes').add({
          data: {
            targetType: 'article',
            targetId: articleId,
            createTime: db.serverDate()
          }
        })

        // 更新文章点赞数
        await db.collection('articles').doc(articleId).update({
          data: {
            'stats.likes': _.inc(1)
          }
        })

        this.setData({
          isLiked: true,
          'article.stats.likes': this.data.article.stats.likes + 1
        })
      }

      wx.vibrateShort({ type: 'light' })
    } catch (e) {
      console.error('点赞操作失败:', e)
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  // 分享
  onShareAppMessage() {
    return {
      title: this.data.article.title,
      path: `/pages/articles/detail?id=${this.data.article._id}`,
      imageUrl: this.data.article.coverImage
    }
  },

  // 跳转相关文章
  goToRelatedArticle(e) {
    const id = e.currentTarget.dataset.id
    wx.redirectTo({
      url: `/pages/articles/detail?id=${id}`
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
    wx.navigateBack()
  }
})

