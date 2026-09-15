// subpackages/feature/community/index.js
const app = getApp()
const { trackBehavior } = require('../../../utils/trackBehavior')
const { splitWaterfall } = require('../utils/communityWaterfall')
const { mapArticleItem } = require('../utils/communityPublish')
const easterEggHost = require('../../../utils/easterEggHost')
const { getPageNavInsets } = require('../utils/pageNav')

Page({
  behaviors: [easterEggHost],
  data: {
    statusBarHeight: 20,
    navPaddingRight: 96,
    showBack: false,
    currentTab: 0,
    tabs: [
      { name: '发现', en: 'FEED', value: 'notes' },
      { name: '影像', en: 'FILMS', value: 'videos' },
      { name: '专题', en: 'EXHIBITION', value: 'exhibitions' }
    ],
    articles: [],
    leftCol: [],
    rightCol: [],
    loadingArticles: false,
    videos: [],
    videoLeftCol: [],
    videoRightCol: [],
    loadingVideos: false,
    exhibitions: [],
    loadingExhibitions: false
  },

  onLoad(options) {
    const nav = getPageNavInsets({ nativeNav: true })
    this.setData({
      statusBarHeight: nav.statusBarHeight || 20,
      navPaddingRight: nav.navPaddingRight,
      showBack: options.from === 'user' || options.from === 'search' || options.from === 'publish'
    })
    trackBehavior('community_view', 'community', app.globalData.openid || 'guest', { from: options.from || 'direct' })
    this.loadContent()
  },

  onShow() {
    // 超管在「工作台 → 内容 → 种子同步」灌库后（跨分包，不能 require 通知模块），
    // 会挂 app.globalData.communityNeedsRefresh；此前该信号无人设置，
    // 导致灌库后社区列表要手动下拉才更新。
    let globalNeed = false
    try {
      const app = getApp()
      if (app && app.globalData && app.globalData.communityNeedsRefresh) {
        app.globalData.communityNeedsRefresh = false
        globalNeed = true
      }
    } catch (e) { /* ignore */ }
    if (this._needRefresh || globalNeed) {
      this._needRefresh = false
      this.loadTabContent(this.data.currentTab, true)
    }
  },

  onPullDownRefresh() {
    this.loadTabContent(this.data.currentTab, true).then(() => wx.stopPullDownRefresh())
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  },

  switchTab(e) {
    const index = parseInt(e.currentTarget.dataset.index, 10)
    if (index === this.data.currentTab) return
    const tab = this.data.tabs[index]
    trackBehavior('community_tab_switch', 'community', tab.value, { tab: tab.value })
    this.setData({ currentTab: index })
    this.loadTabContent(index)
  },

  async loadContent() {
    return this.loadTabContent(this.data.currentTab)
  },

  async loadTabContent(tabIndex, force = false) {
    if (tabIndex === 0 && (force || !this.data.articles.length)) {
      await this.loadArticles()
    } else if (tabIndex === 1 && (force || !this.data.videos.length)) {
      await this.loadVideos()
    } else if (tabIndex === 2 && (force || !this.data.exhibitions.length)) {
      await this.loadExhibitions()
    }
  },

  _mapFeedItem(item) {
    const mapped = mapArticleItem(item)
    const name = String(mapped.author || '山海')
    mapped.authorInitial = name.slice(0, 1)
    return mapped
  },

  async loadArticles() {
    this.setData({ loadingArticles: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'getArticles',
        data: { action: 'get_list', page: 1, pageSize: 40, sortBy: 'createTime' }
      })

      if (res.result && res.result.success) {
        const notes = (res.result.data || [])
          .filter((item) => !item.videoUrl || !String(item.videoUrl).trim())
          .map((item) => this._mapFeedItem(item))
        const wf = splitWaterfall(notes)
        this.setData({
          articles: notes,
          leftCol: wf.leftCol,
          rightCol: wf.rightCol,
          loadingArticles: false
        })
      } else {
        this.setData({ loadingArticles: false })
        wx.showToast({ title: '笔记加载失败', icon: 'none' })
      }
    } catch (e) {
      console.error('加载笔记失败:', e)
      this.setData({ loadingArticles: false })
      wx.showToast({ title: '笔记加载失败', icon: 'none' })
    }
  },

  async loadVideos() {
    this.setData({ loadingVideos: true })
    try {
      const db = wx.cloud.database()
      const _ = db.command
      const res = await db.collection('articles')
        .where({ videoUrl: _.exists(true), status: 'published' })
        .orderBy('_createTime', 'desc')
        .limit(40)
        .get()

      const videos = (res.data || [])
        .filter((item) => item.videoUrl && String(item.videoUrl).trim())
        .map((item) => this._mapFeedItem(item))
      const wf = splitWaterfall(videos)
      this.setData({
        videos,
        videoLeftCol: wf.leftCol,
        videoRightCol: wf.rightCol,
        loadingVideos: false
      })
    } catch (e) {
      console.error('加载视频失败:', e)
      this.setData({ loadingVideos: false })
      wx.showToast({ title: '视频加载失败', icon: 'none' })
    }
  },

  async loadExhibitions() {
    this.setData({ loadingExhibitions: true })
    try {
      const db = wx.cloud.database()
      const res = await db.collection('cms_wikis')
        .where({ type: 'exhibition', status: 'published' })
        .orderBy('_createTime', 'desc')
        .limit(20)
        .get()
      this.setData({ exhibitions: res.data || [], loadingExhibitions: false })
    } catch (e) {
      console.error('加载专题失败:', e)
      this.setData({ loadingExhibitions: false })
      wx.showToast({ title: '专题加载失败', icon: 'none' })
    }
  },

  goToArticle(e) {
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

  goToExhibition(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '专题不存在', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/subpackages/feature/detail/wiki-detail/index?id=${id}`,
      fail: () => wx.showToast({ title: '无法打开专题', icon: 'none' })
    })
  },

  goToSearch() {
    wx.navigateTo({
      url: '/subpackages/feature/search/index',
      fail: () => wx.showToast({ title: '无法打开搜索', icon: 'none' })
    })
  },

  openPublishEntry() {
    wx.vibrateShort({ type: 'light' })
    trackBehavior('community_publish_entry_click', 'community', 'fab')
    wx.showActionSheet({
      itemList: ['发图文笔记', '发视频笔记'],
      success: (res) => {
        const type = res.tapIndex === 1 ? 'video' : 'note'
        trackBehavior('community_publish_type_pick', 'community', type)
        wx.navigateTo({
          url: `/subpackages/feature/community/publish/index?type=${type}`,
          fail: () => wx.showToast({ title: '无法打开发布页', icon: 'none' })
        })
      }
    })
  }
})
