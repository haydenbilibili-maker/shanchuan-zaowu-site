// subpackages/feature/videos/index.js
const app = getApp()
const db = wx.cloud.database()
const _ = db.command
const { getWindowInfo } = require('../../../utils/systemInfo')
const { cdnPath } = require('../../../config/cloudEnv')

const FALLBACK_COVER = cdnPath('stores/store_shanhaizaowu.png')

const TYPE_LABELS = {
  all: '全部',
  craft: '制作过程',
  display: '标本展示',
  course: '课程录播',
  knowledge: '知识科普'
}

Page({
  data: {
    statusBarHeight: 20,
    videos: [],
    categories: [
      { name: '全部', value: 'all' },
      { name: '制作过程', value: 'craft' },
      { name: '标本展示', value: 'display' },
      { name: '课程录播', value: 'course' },
      { name: '知识科普', value: 'knowledge' }
    ],
    activeCategory: 'all',
    loading: false,
    loadError: false,
    fallbackCover: FALLBACK_COVER,
    page: 1,
    pageSize: 10,
    noMore: false
  },

  onLoad() {
    const win = getWindowInfo()
    this.setData({ statusBarHeight: win.statusBarHeight || 20 })
    this.loadVideos(true)
  },

  onReachBottom() {
    if (!this.data.loading && !this.data.noMore) {
      this.loadVideos(false)
    }
  },

  onPullDownRefresh() {
    this.loadVideos(true).then(() => {
      wx.stopPullDownRefresh()
    })
  },

  // 加载视频列表
  async loadVideos(refresh = false) {
    if (refresh) {
      this.setData({ page: 1, noMore: false, videos: [] })
    }

    if (this.data.loading) return
    this.setData({ loading: true })

    try {
      const { activeCategory, page, pageSize } = this.data
      
      // 构建查询条件
      let query = {
        videoUrl: _.exists(true),
        status: 'published'
      }
      
      // 根据分类筛选（这里可以根据视频的category或tags来判断）
      // 暂时通过tags或category来判断视频类型
      
      const res = await db.collection('articles')
        .where(query)
        .orderBy('_createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()

      const mapped = ((res && res.data) || []).map(item => {
        const videoType = this.getVideoType(item)
        const images = Array.isArray(item.images) ? item.images : []
        return {
          ...item,
          coverImage: item.coverImage || images[0] || FALLBACK_COVER,
          stats: item.stats || { views: 0, likes: 0 },
          videoType,
          typeLabel: TYPE_LABELS[videoType] || '标本展示',
          duration: item.duration || '00:00',
          playCount: item.playCount || (item.stats && item.stats.views) || 0
        }
      })
      const videos = activeCategory === 'all'
        ? mapped
        : mapped.filter((item) => item.videoType === activeCategory)

      this.setData({
        videos: refresh ? videos : this.data.videos.concat(videos),
        page: page + 1,
        noMore: mapped.length < pageSize,
        loading: false,
        loadError: false
      })
    } catch (e) {
      console.error('加载视频失败:', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ loading: false, loadError: true })
    }
  },

  // 判断视频类型
  getVideoType(item) {
    const tags = (Array.isArray(item.tags) ? item.tags : []).join(',').toLowerCase()
    const category = (item.category || '').toLowerCase()
    const title = (item.title || '').toLowerCase()
    
    if (tags.includes('制作') || tags.includes('工艺') || title.includes('制作')) {
      return 'craft'
    }
    if (tags.includes('展示') || tags.includes('标本') || title.includes('展示')) {
      return 'display'
    }
    if (tags.includes('课程') || tags.includes('教学') || title.includes('课程')) {
      return 'course'
    }
    if (category === 'knowledge' || tags.includes('知识') || tags.includes('科普')) {
      return 'knowledge'
    }
    return 'display' // 默认
  },

  // 切换分类
  switchCategory(e) {
    const category = e.currentTarget.dataset.category
    if (category === this.data.activeCategory) return
    
    this.setData({ activeCategory: category })
    this.loadVideos(true)
  },

  // 跳转视频详情（使用文章详情页）
  goToVideo(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '内容不存在', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/subpackages/feature/articles/detail/index?id=${id}`,
      fail: () => wx.showToast({ title: '无法打开视频', icon: 'none' })
    })
  },

  onCoverError(e) {
    const idx = e.currentTarget.dataset.index
    if (idx == null) return
    this.setData({ [`videos[${idx}].coverImage`]: FALLBACK_COVER })
  },

  retryLoad() {
    this.loadVideos(true)
  },

  onShareAppMessage() {
    return {
      title: '山海造物 · 影像内容',
      path: '/subpackages/feature/videos/index'
    }
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





