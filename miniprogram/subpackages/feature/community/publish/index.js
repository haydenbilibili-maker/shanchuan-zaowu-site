// subpackages/feature/community/publish/index.js
const app = getApp()
const { getWindowInfo } = require('../../../../utils/systemInfo')
const { trackBehavior } = require('../../../../utils/trackBehavior')
const { buildPublishPayload, CATEGORY_VALUES, CATEGORY_NAMES } = require('../../utils/communityPublish')
const { ensureOpenId } = require('../../../../utils/orderScope')
const { openAppModal } = require('../../../../utils/appModal')

Page({
  data: {
    /** 入展展签（发布成功后 1.8s 内）：标题 / 日期，「入展」印 + 审核去向 */
    exhibitTag: { show: false, title: '', date: '' },
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
    topicPresets: ['藏品', '昆虫', '矿物', '植物', '养护', '探店', '收藏'],
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
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/subpackages/feature/community/index' }) })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: (e.detail && e.detail.value) || '' }, () => this._refreshSubmitState())
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
    const { type, images, title, content, videoUrl } = this.data
    const t = String(title || '').trim()
    const c = String(content || '').trim()
    const v = String(videoUrl || '').trim()
    let canSubmit = false
    if (type === 'note') {
      canSubmit = images.length > 0 && !!(t || c)
    } else {
      canSubmit = !!v && !!(t || c)
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
      openAppModal({
        title: '登录后发布',
        content: '未能获取账号信息，请稍后重试或重新进入小程序',
        confirmText: '去我的',
        success: (res) => {
          if (res.confirm) wx.switchTab({ url: '/pages/user/index' })
        }
      }, this)
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
        app.globalData.userInfo = { ...res.data[0], _openid: openid }
        return { ...res.data[0], _openid: openid }
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
    const oid = (user && user._openid) || 'anon'
    const up = await wx.cloud.uploadFile({
      cloudPath: `ugc/${Date.now()}_${String(oid).slice(-6)}_${suffix}.jpg`,
      filePath: localPath
    })
    return up.fileID
  },

  noop() {},

  onUnload() {
    this._unloaded = true
    clearTimeout(this._exhibitTimer)
  },

  async submit() {
    // 在途守卫：逐张上传图片可能耗时数秒，避免重复点击产生重复笔记
    if (this.data.submitting) return
    if (this._submittingLock) return
    this._submittingLock = true
    this.setData({ submitting: true })
    const releaseSubmit = () => {
      this._submittingLock = false
      this.setData({ submitting: false })
    }

    if (!this.data.canSubmit) {
      wx.showToast({ title: '请完善内容', icon: 'none' })
      releaseSubmit()
      return
    }

    const user = await this._ensureLogin()
    if (!user) {
      releaseSubmit()
      return
    }

    const { type, images, coverImage, videoUrl, title, content, tagsStr, category } = this.data

    if (type === 'note' && !images.length) {
      wx.showToast({ title: '请至少添加一张图片', icon: 'none' })
      releaseSubmit()
      return
    }
    if (type === 'video' && !String(videoUrl || '').trim()) {
      wx.showToast({ title: '请填写视频链接', icon: 'none' })
      releaseSubmit()
      return
    }

    wx.showLoading({ title: '发布中…', mask: true })

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

      const titleText = String(title || '').trim()
      const contentText = String(content || '').trim()
      const form = {
        type,
        title: titleText || contentText.slice(0, 20),
        content: contentText,
        brief: contentText.slice(0, 80),
        tagsStr,
        category,
        videoUrl: String(videoUrl || '')
      }

      const data = buildPublishPayload(form, user, {
        coverImage: uploadedCover,
        images: uploadedImages
      })

      const postRes = await wx.cloud.callFunction({
        name: 'submitCommunityPost',
        data: { data }
      })
      const posted = postRes.result || {}
      if (!posted.success) {
        throw new Error(posted.msg || '发布失败')
      }

      trackBehavior('community_publish_success', 'community', type, { title: data.title })

      wx.hideLoading()
      // 入展印（2026-10-18 方向池 ★★）：原 toast「已提交审核」改为一张展签 + 「入展」朱印，写明审核去向；去向不变
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      this.setData({
        exhibitTag: {
          show: true,
          title: data.title || '我的笔记',
          date: `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`
        }
      })
      wx.vibrateShort({ type: 'light' })
      // 展签停 1.8s：期间若已返回离页，不再 redirect（否则会替换掉别的页面）（2026-10-19 核查）
      this._exhibitTimer = setTimeout(() => {
        if (this._unloaded) return
        wx.redirectTo({ url: '/subpackages/feature/community/index?from=publish' })
      }, 1800)
    } catch (e) {
      wx.hideLoading()
      console.error('publish failed', e)
      wx.showToast({ title: e.message || '发布失败', icon: 'none' })
      releaseSubmit()
    }
  }
})
