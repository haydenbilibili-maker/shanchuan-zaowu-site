// subpackages/feature/articles/index.js
const app = getApp()
const { getWindowInfo } = require('../../../utils/systemInfo')
const { cdnPath } = require('../../../config/cloudEnv')

const FALLBACK_COVER = cdnPath('stores/store_shanhaizaowu.png')

const CATEGORY_LABELS = {
  knowledge: '标本知识',
  art: '艺术鉴赏',
  craft: '制作工艺',
  story: '标本故事'
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
    showSearch: false,
    fallbackCover: FALLBACK_COVER
  },

  onLoad() {
    const win = getWindowInfo()
    this.setData({ statusBarHeight: win.statusBarHeight || 20 })
    this.loadCategories()
    this.loadArticles()
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.navigateTo({
        url: '/subpackages/feature/community/index',
        fail: () => wx.switchTab({ url: '/pages/index/index' })
      })
    })
  },

  _mapArticle(item) {
    const images = Array.isArray(item.images) ? item.images : []
    return {
      ...item,
      categoryLabel: CATEGORY_LABELS[item.category] || '标本知识',
      coverImage: item.coverImage || images[0] || FALLBACK_COVER,
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
      if (res.result && res.result.success) {
        this.setData({ categories: res.result.data || [] })
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

      if (res.result && res.result.success) {
        const newArticles = (res.result.data || []).map(item => this._mapArticle(item))
        const articles = this.data.page === 1 ? newArticles : [...this.data.articles, ...newArticles]
        const total = (res.result.pagination && res.result.pagination.total) || articles.length
        const hasMore = articles.length < total

        this.setData({
          articles,
          hasMore,
          loading: false
        })
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '加载失败', icon: 'none' })
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
    if (!id) {
      wx.showToast({ title: '内容不存在', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/subpackages/feature/articles/detail/index?id=${id}`,
      fail: () => wx.showToast({ title: '无法打开笔记', icon: 'none' })
    })
  },

  // 跳转到视频列表
  goToVideos() {
    wx.navigateTo({
      url: '/subpackages/content/videos/index',
      fail: () => wx.showToast({ title: '无法打开影像', icon: 'none' })
    })
  },

  onCoverError(e) {
    const idx = e.currentTarget.dataset.index
    if (idx == null) return
    this.setData({ [`articles[${idx}].coverImage`]: FALLBACK_COVER })
  },

  // 切换搜索框显示
  toggleSearch() {
    this.setData({ showSearch: !this.data.showSearch })
  },

  onShareAppMessage() {
    return {
      title: '山海造物 · 知识文章',
      path: '/subpackages/feature/articles/index'
    }
  }
})

