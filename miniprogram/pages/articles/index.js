// pages/articles/index.js
const app = getApp()
const { getWindowInfo } = require('../../utils/systemInfo')

const CATEGORY_LABELS = {
  knowledge: '标本知识',
  art: '艺术鉴赏',
  craft: '制作工艺',
  story: '藏品故事'
}

Page({
  data: {
    statusBarHeight: 20,
    categories: [],
    currentCategory: 'all',
    keyword: '',
    articles: [],
    loading: true,
    hasMore: true,
    page: 1,
    pageSize: 10,
    sortBy: 'createTime', // createTime, views, likes
    showSearch: false
  },

  onLoad() {
    const win = getWindowInfo()
    this.setData({ statusBarHeight: win.statusBarHeight || 20 })
    this.loadCategories()
    this.loadArticles()
  },

  goBack() {
    wx.navigateBack()
  },

  _mapArticle(item) {
    return {
      ...item,
      categoryLabel: CATEGORY_LABELS[item.category] || '标本知识',
      stats: item.stats || { views: 0, likes: 0, comments: 0 }
    }
  },

  onPullDownRefresh() {
    this.setData({ page: 1, articles: [], hasMore: true })
    this.loadArticles().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadMore()
    }
  },

  // 加载分类
  async loadCategories() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getArticles',
        data: { action: 'get_categories' }
      })
      if (res.result.success) {
        this.setData({ categories: res.result.data })
      }
    } catch (e) {
      console.error('加载分类失败:', e)
    }
  },

  // 加载文章列表
  async loadArticles() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'getArticles',
        data: {
          action: 'get_list',
          category: this.data.currentCategory === 'all' ? '' : this.data.currentCategory,
          keyword: this.data.keyword,
          page: this.data.page,
          pageSize: this.data.pageSize,
          sortBy: this.data.sortBy
        }
      })

      if (res.result.success) {
        const newArticles = (res.result.data || []).map(item => this._mapArticle(item))
        const articles = this.data.page === 1 ? newArticles : [...this.data.articles, ...newArticles]
        const hasMore = articles.length < res.result.pagination.total

        this.setData({
          articles,
          hasMore,
          loading: false
        })
      } else {
        wx.showToast({ title: res.result.msg || '加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    } catch (e) {
      console.error('加载文章失败:', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  // 加载更多
  loadMore() {
    this.setData({ page: this.data.page + 1 })
    this.loadArticles()
  },

  // 切换分类
  switchCategory(e) {
    const category = e.currentTarget.dataset.category || 'all'
    this.setData({
      currentCategory: category,
      page: 1,
      articles: [],
      hasMore: true
    })
    this.loadArticles()
  },

  // 搜索
  onSearchInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    this.setData({ page: 1, articles: [], hasMore: true })
    this.loadArticles()
  },

  // 切换排序
  switchSort(e) {
    const sortBy = e.currentTarget.dataset.sort || 'createTime'
    this.setData({
      sortBy,
      page: 1,
      articles: [],
      hasMore: true
    })
    this.loadArticles()
  },

  // 跳转详情
  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/articles/detail/index?id=${id}`
    })
  },

  // 跳转到视频列表
  goToVideos() {
    wx.navigateTo({
      url: '/pages/videos/index'
    })
  },

  // 切换搜索框显示
  toggleSearch() {
    this.setData({ showSearch: !this.data.showSearch })
  }
})

