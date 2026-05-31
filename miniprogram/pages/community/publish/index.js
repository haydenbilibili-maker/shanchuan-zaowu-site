// pages/community/publish/index.js
const app = getApp()
const { getWindowInfo } = require('../../../utils/systemInfo')
const { trackBehavior } = require('../../../utils/trackBehavior')
const { buildPublishPayload, CATEGORY_VALUES, CATEGORY_NAMES } = require('../../../utils/communityPublish')
const { ensureOpenId } = require('../../../utils/orderScope')

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navPaddingRight: 96,
    scrollHeight: 600,
    footerHeight: 140,
    type: 'note',
    images: [],
    coverImage: '',
    videoUrl: '',
    title: '',
    content: '',
    tagsStr: '',
    activeTags: [],
    category: 'story',
    categories: CATEGORY_VALUES.map((value, i) => ({ value, name: CATEGORY_NAMES[i] })),
    topicPresets: ['标本', '昆虫', '矿物', '植物', '养护', '探店', '收藏'],
    canSubmit: false
  },

  onLoad(options) {
    const win = getWindowInfo()
    let menu = { top: 48, height: 32, left: 281 }
    try {
      menu = wx.getMenuButtonBoundingClientRect()
    } catch (e) {}

    const statusBarHeight = win.statusBarHeight || 20
    const navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height
    const navPaddingRight = Math.max(12, (win.windowWidth || 375) - menu.left + 8)
    const rpxRatio = (win.windowWidth || 375) / 750
    const safeBottom = win.safeArea
      ? Math.max(0, (win.windowHeight || 667) - win.safeArea.bottom)
      : 0
    const footerHeight = Math.ceil(128 * rpxRatio) + safeBottom
    const scrollHeight = (win.windowHeight || 667) - statusBarHeight - navBarHeight - footerHeight

    const type = options.type === 'video' ? 'video' : 'note'
    this.setData({
      statusBarHeight,
      navBarHeight,
      navPaddingRight,
      scrollHeight: Math.max(320, scrollHeight),
      footerHeight,
      type
    })
    trackBehavior('community_publish_enter', 'community', type)
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/community/index' }) })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value }, () => this._refreshSubmitState())
  },

  toggleTag(e) {
    const tag = e.currentTarget.dataset.tag
    let activeTags = [...this.data.activeTags]
    const idx = activeTags.indexOf(tag)
    if (idx >= 0) activeTags.splice(idx, 1)
    else activeTags.push(tag)
    const tagsStr = activeTags.concat(
      this.data.tagsStr.split(/[,，]/).map((s) => s.trim()).filter((s) => s && !activeTags.includes(s))
    ).join('，')
    this.setData({ activeTags, tagsStr }, () => this._refreshSubmitState())
  },

  selectCategory(e) {
    this.setData({ category: e.currentTarget.dataset.value })
  },

  chooseImages() {
    const remain = 9 - this.data.images.length
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath)
        this.setData({ images: this.data.images.concat(paths).slice(0, 9) }, () => this._refreshSubmitState())
      }
    })
  },

  removeImage(e) {
    const index = e.currentTarget.dataset.index
    const images = [...this.data.images]
    images.splice(index, 1)
    this.setData({ images }, () => this._refreshSubmitState())
  },

  chooseVideoCover() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (path) this.setData({ coverImage: path }, () => this._refreshSubmitState())
      }
    })
  },

  _refreshSubmitState() {
    const { type, images, title, content, videoUrl, coverImage } = this.data
    let canSubmit = false
    if (type === 'note') {
      canSubmit = images.length > 0 && (title.trim() || content.trim())
    } else {
      canSubmit = !!videoUrl.trim() && (title.trim() || content.trim())
    }
    this.setData({ canSubmit })
  },

  async _ensureLogin() {
    let openid = await ensureOpenId(app)
    if (!openid) {
      try {
        const res = await wx.cloud.callFunction({ name: 'login', data: {} })
        openid = (res.result && res.result.openid) || ''
        if (openid) app.globalData.openid = openid
      } catch (e) {
        console.warn('login cloud fn retry failed', e)
      }
    }

    if (!openid) {
      wx.showModal({
        title: '登录后发布',
        content: '未能获取账号信息，请稍后重试或重新进入小程序',
        confirmText: '去我的',
        success: (res) => {
          if (res.confirm) wx.switchTab({ url: '/pages/user/index' })
        }
      })
      return null
    }

    const cached = app.globalData.userInfo
    if (cached && (cached._openid === openid || !cached._openid)) {
      return { ...cached, _openid: openid }
    }

    try {
      const db = wx.cloud.database()
      const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
      if (res.data && res.data[0]) {
        app.globalData.userInfo = res.data[0]
        return res.data[0]
      }
    } catch (e) {
      console.warn('fetch user profile failed', e)
    }

    return {
      _openid: openid,
      nickName: '藏家',
      avatarUrl: ''
    }
  },

  async _uploadFile(localPath, user, suffix) {
    if (!localPath || localPath.startsWith('cloud://') || localPath.startsWith('http')) {
      return localPath
    }
    const up = await wx.cloud.uploadFile({
      cloudPath: `ugc/${Date.now()}_${user._openid.slice(-6)}_${suffix}.jpg`,
      filePath: localPath
    })
    return up.fileID
  },

  async submit() {
    if (!this.data.canSubmit) {
      wx.showToast({ title: '请完善内容', icon: 'none' })
      return
    }

    const user = await this._ensureLogin()
    if (!user) return

    const { type, images, coverImage, videoUrl, title, content, tagsStr, category } = this.data

    if (type === 'note' && !images.length) {
      wx.showToast({ title: '请至少添加一张图片', icon: 'none' })
      return
    }
    if (type === 'video' && !videoUrl.trim()) {
      wx.showToast({ title: '请填写视频链接', icon: 'none' })
      return
    }

    wx.showLoading({ title: '发布中…' })

    try {
      let uploadedImages = []
      let uploadedCover = ''

      if (type === 'note') {
        uploadedImages = await Promise.all(
          images.map((path, i) => this._uploadFile(path, user, `img${i}`))
        )
        uploadedCover = uploadedImages[0]
      } else {
        uploadedCover = coverImage
          ? await this._uploadFile(coverImage, user, 'vcover')
          : ''
      }

      const form = {
        type,
        title: title.trim() || content.trim().slice(0, 20),
        content,
        brief: content.trim().slice(0, 80),
        tagsStr,
        category,
        videoUrl
      }

      const data = buildPublishPayload(form, user, {
        coverImage: uploadedCover,
        images: uploadedImages
      })

      const db = wx.cloud.database()
      data._createTime = db.serverDate()
      await db.collection('articles').add({ data })

      trackBehavior('community_publish_success', 'community', type, { title: data.title })

      wx.hideLoading()
      wx.showToast({ title: '发布成功', icon: 'success' })
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/community/index?from=publish' })
      }, 800)
    } catch (e) {
      wx.hideLoading()
      console.error('publish failed', e)
      wx.showToast({ title: '发布失败', icon: 'none' })
    }
  }
})
