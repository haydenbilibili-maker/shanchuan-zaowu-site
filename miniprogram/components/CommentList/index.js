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
          const newComments = reset 
            ? res.result.data 
            : [...this.data.comments, ...res.result.data]

          this.setData({
            comments: newComments,
            stats: res.result.stats || this.data.stats,
            hasMore: res.result.hasMore || false,
            skip: skip + res.result.data.length,
            loading: false
          })
        } else {
          this.setData({ loading: false })
        }
      } catch (e) {
        console.error('加载评价失败:', e)
        this.setData({ loading: false })
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
          // 更新本地数据
          const comments = this.data.comments.map(comment => {
            if (comment._id === id) {
              return {
                ...comment,
                likes: res.result.likes,
                userLiked: !liked
              }
            }
            return comment
          })
          this.setData({ comments })
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
      wx.previewImage({
        current: urls[index],
        urls
      })
    },

    // 跳转到评价页面
    goToCommentPage() {
      wx.navigateTo({
        url: `/pages/comment/index?targetType=${this.data.targetType}&targetId=${this.data.targetId}`
      })
    }
  }
})






