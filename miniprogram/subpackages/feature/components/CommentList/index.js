// components/CommentList/index.js
Component({
  properties: {
    targetType: {
      type: String,
      value: 'product'
    },
    targetId: {
      type: String,
      value: ''
    },
    showStats: {
      type: Boolean,
      value: true
    }
  },

  data: {
    comments: [],
    stats: {
      total: 0,
      averageRating: 0,
      ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      withImages: 0
    },
    loading: false,
    sortBy: 'time', // time | hot | rating
    filter: 'all', // all | withImages | highRating
    hasMore: true,
    skip: 0
  },

  lifetimes: {
    attached() {
      if (this.data.targetId) {
        this.loadComments()
      }
    }
  },

  observers: {
    'targetId': function(targetId) {
      if (targetId) {
        this.setData({ comments: [], skip: 0, hasMore: true })
        this.loadComments()
      }
    }
  },

  methods: {
    // 加载评价列表
    async loadComments(reset = false) {
      if (this.data.loading) return

      this.setData({ loading: true })

      try {
        const skip = reset ? 0 : this.data.skip
        const res = await wx.cloud.callFunction({
          name: 'getComments',
          data: {
            targetType: this.data.targetType,
            targetId: this.data.targetId,
            sortBy: this.data.sortBy,
            filter: this.data.filter,
            limit: 10,
            skip
          }
        })

        if (res.result && res.result.success) {
          const chunk = Array.isArray(res.result.data) ? res.result.data : []
          const newComments = reset
            ? chunk
            : [...this.data.comments, ...chunk]

          this.setData({
            comments: newComments,
            stats: res.result.stats || this.data.stats,
            hasMore: !!res.result.hasMore,
            skip: skip + chunk.length,
            loading: false
          })
        } else {
          this.setData({ loading: false })
          if (!this.data.comments.length) {
            wx.showToast({ title: (res.result && res.result.msg) || '评价加载失败', icon: 'none' })
          }
        }
      } catch (e) {
        console.error('加载评价失败:', e)
        this.setData({ loading: false })
        wx.showToast({ title: '评价加载失败', icon: 'none' })
      }
    },

    // 切换排序
    onSortChange(e) {
      const sortBy = e.currentTarget.dataset.sort
      if (sortBy !== this.data.sortBy) {
        this.setData({ sortBy, skip: 0, hasMore: true })
        this.loadComments(true)
      }
    },

    // 切换筛选
    onFilterChange(e) {
      const filter = e.currentTarget.dataset.filter
      if (filter !== this.data.filter) {
        this.setData({ filter, skip: 0, hasMore: true })
        this.loadComments(true)
      }
    },

    // 点赞评价
    async onLikeComment(e) {
      const { id, liked } = e.currentTarget.dataset
      
      try {
        const res = await wx.cloud.callFunction({
          name: 'likeComment',
          data: {
            commentId: id,
            isLike: !liked
          }
        })

        if (res.result && res.result.success) {
          const nextLiked = typeof res.result.userLiked === 'boolean'
            ? res.result.userLiked
            : !liked
          const nextLikes = typeof res.result.likes === 'number'
            ? res.result.likes
            : (Array.isArray(res.result.likes) ? res.result.likes.length : 0)
          const comments = this.data.comments.map(comment => {
            if (comment._id === id) {
              return {
                ...comment,
                likes: nextLikes,
                userLiked: nextLiked
              }
            }
            return comment
          })
          this.setData({ comments })
          wx.vibrateShort({ type: 'light' })
        } else {
          wx.showToast({
            title: (res.result && res.result.msg) || '操作失败',
            icon: 'none'
          })
        }
      } catch (e) {
        console.error('点赞失败:', e)
        wx.showToast({
          title: '操作失败',
          icon: 'none'
        })
      }
    },

    // 预览图片
    previewImage(e) {
      const { index, urls } = e.currentTarget.dataset
      const list = Array.isArray(urls) ? urls.filter(Boolean) : []
      if (!list.length) {
        wx.showToast({ title: '图片暂不可预览', icon: 'none' })
        return
      }
      wx.previewImage({
        current: list[index] || list[0],
        urls: list
      })
    },

    loadMore() {
      if (!this.data.hasMore || this.data.loading) return
      this.loadComments(false)
    },

    // 跳转到评价页面
    goToCommentPage() {
      const { targetType, targetId } = this.data
      if (!targetId) {
        wx.showToast({ title: '无法发表评价', icon: 'none' })
        return
      }
      wx.navigateTo({
        url: `/subpackages/feature/comment/index?targetType=${targetType}&targetId=${targetId}`,
        fail: () => wx.showToast({ title: '无法打开评价页', icon: 'none' })
      })
    }
  }
})






