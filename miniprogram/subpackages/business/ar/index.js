// subpackages/business/ar/index.js
const { getFrameStyle, getFrameOptions, DEFAULT_FRAME_ID } = require('../utils/customFrameStyles')

Page({
  data: {
    imgUrl: '',
    statusBarHeight: 20,
    isCustomMode: false,
    isStaticPreview: false,
    frameId: DEFAULT_FRAME_ID,
    frameName: '',
    frameStyle: getFrameStyle(DEFAULT_FRAME_ID),
    frameOptions: getFrameOptions(),
    specimenTitle: '',

    x: 0, y: 0, scale: 1.0,
    tempPhoto: '',
    shutterFlash: false,
    isAnalyzing: false,
    envData: { temp: '24.5°C', hum: '45%', light: '800LUX', iso: 'AUTO' }
  },

  startX: 0, startY: 0, lastX: 0, lastY: 0, ctx: null, timer: null,

  onLoad(options) {
    const { statusBarHeight, windowWidth, windowHeight } = wx.getSystemInfoSync()
    const initX = (windowWidth - 220) / 2
    const initY = (windowHeight - 260) / 2
    const isCustomMode = options.mode === 'custom'
    const isStaticPreview = options.preview === 'static'
    const frameId = options.frameId || DEFAULT_FRAME_ID
    const frameStyle = getFrameStyle(frameId)

    let imgUrl = options.img ? decodeURIComponent(options.img) : ''
    if (!imgUrl && options.productId) {
      this.loadProductImage(options.productId)
    }

    this.setData({
      imgUrl,
      statusBarHeight,
      x: initX,
      y: initY,
      isCustomMode,
      isStaticPreview,
      frameId,
      frameName: options.frameName ? decodeURIComponent(options.frameName) : frameStyle.label,
      frameStyle,
      specimenTitle: options.title ? decodeURIComponent(options.title) : ''
    })

    this.lastX = initX
    this.lastY = initY

    if (!isStaticPreview) {
      this.ctx = wx.createCameraContext()
      this.startDataStream()
    }
  },

  async loadProductImage(productId) {
    try {
      const db = wx.cloud.database()
      const res = await db.collection('products').doc(productId).get()
      const product = res.data
      if (!product) return
      const img = (product.images && product.images[0]) || ''
      this.setData({
        imgUrl: img,
        specimenTitle: product.title || this.data.specimenTitle
      })
    } catch (e) {
      console.error('loadProductImage', e)
    }
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer)
  },

  startDataStream() {
    this.timer = setInterval(() => {
      this.setData({
        'envData.light': `${Math.floor(700 + Math.random() * 200)}LUX`,
        'envData.iso': Math.random() > 0.5 ? 'ISO 200' : 'ISO 400'
      })
    }, 1500)
  },

  switchFrame(e) {
    const frameId = e.currentTarget.dataset.id
    const frameStyle = getFrameStyle(frameId)
    const opt = this.data.frameOptions.find((f) => f.id === frameId)
    this.setData({
      frameId,
      frameName: opt ? opt.name : frameStyle.label,
      frameStyle
    })
  },

  onTouchStart(e) {
    this.startX = e.touches[0].clientX
    this.startY = e.touches[0].clientY
  },

  onTouchMove(e) {
    const deltaX = e.touches[0].clientX - this.startX
    const deltaY = e.touches[0].clientY - this.startY
    this.setData({ x: this.lastX + deltaX, y: this.lastY + deltaY })
  },

  onTouchEnd() {
    this.lastX = this.data.x
    this.lastY = this.data.y
  },

  onScaleChange(e) {
    this.setData({ scale: e.detail.value })
  },

  takePhoto() {
    if (this.data.isStaticPreview) {
      wx.showToast({ title: '静态预览模式请截图保存', icon: 'none' })
      return
    }
    this.setData({ shutterFlash: true })
    setTimeout(() => { this.setData({ shutterFlash: false }) }, 150)
    wx.vibrateShort({ type: 'heavy' })
    this.setData({ isAnalyzing: true })

    this.ctx.takePhoto({
      quality: 'high',
      success: (res) => {
        setTimeout(() => {
          this.setData({ isAnalyzing: false, tempPhoto: res.tempImagePath })
        }, 1200)
      },
      fail: () => {
        this.setData({ isAnalyzing: false })
        wx.showToast({ title: '拍摄失败', icon: 'none' })
      }
    })
  },

  reTake() { this.setData({ tempPhoto: '' }) },

  savePhoto() {
    wx.saveImageToPhotosAlbum({
      filePath: this.data.tempPhoto,
      success: () => {
        wx.showToast({ title: '已保存', icon: 'success' })
        setTimeout(() => this.setData({ tempPhoto: '' }), 1500)
      },
      fail: () => wx.showToast({ title: '需要相册权限', icon: 'none' })
    })
  },

  goBack() { wx.navigateBack() },
  error(e) { console.log(e.detail) }
})
