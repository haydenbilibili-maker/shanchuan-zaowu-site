// pages/comment/index.js
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    targetType: 'product',
    targetId: '',
    targetInfo: null,
    
    rating: 0,
    content: '',
    images: [],
    
    submitting: false
  },

  onLoad(options) {
    const { targetType, targetId } = options
    const { statusBarHeight } = wx.getSystemInfoSync()
    
    this.setData({
      statusBarHeight,
      targetType: targetType || 'product',
      targetId: targetId || ''
    })

    this.loadTargetInfo()
  },

  // 加载目标信息（商品/活动/课程）
  async loadTargetInfo() {
    if (!this.data.targetId) return

    try {
      let collectionName = 'products'
      if (this.data.targetType === 'activity') {
        collectionName = 'activities'
      } else if (this.data.targetType === 'course') {
        collectionName = 'courses'
      }

      const res = await wx.cloud.database().collection(collectionName)
        .doc(this.data.targetId)
        .get()

      if (res.data) {
        this.setData({
          targetInfo: res.data
        })
      }
    } catch (e) {
      console.error('加载目标信息失败:', e)
    }
  },

  // 选择星级
  selectRating(e) {
    const rating = e.currentTarget.dataset.rating
    wx.vibrateShort({ type: 'light' })
    this.setData({ rating })
  },

  // 输入评价内容
  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  // 选择图片
  chooseImage() {
    const remain = 3 - this.data.images.length
    if (remain <= 0) {
      wx.showToast({
        title: '最多只能上传3张图片',
        icon: 'none'
      })
      return
    }

    wx.chooseImage({
      count: remain,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFiles = res.tempFilePaths
        // 上传图片到云存储
        this.uploadImages(tempFiles)
      }
    })
  },

  // 上传图片
  async uploadImages(filePaths) {
    wx.showLoading({ title: '上传中...' })
    
    try {
      const uploadPromises = filePaths.map(filePath => {
        const cloudPath = `comments/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`
        return wx.cloud.uploadFile({
          cloudPath,
          filePath
        })
      })

      const results = await Promise.all(uploadPromises)
      const fileIds = results.map(res => res.fileID)
      
      this.setData({
        images: [...this.data.images, ...fileIds]
      })

      wx.hideLoading()
    } catch (e) {
      console.error('上传图片失败:', e)
      wx.hideLoading()
      wx.showToast({
        title: '上传失败',
        icon: 'none'
      })
    }
  },

  // 删除图片
  deleteImage(e) {
    e.stopPropagation()
    const index = e.currentTarget.dataset.index
    wx.vibrateShort({ type: 'light' })
    const images = this.data.images
    images.splice(index, 1)
    this.setData({ images })
  },
  
  // 预览图片
  previewImage(e) {
    const index = e.currentTarget.dataset.index
    const images = this.data.images
    if (images && images.length > 0) {
      wx.previewImage({
        current: images[index],
        urls: images
      })
    }
  },

  // 返回上一页
  goBack() {
    wx.navigateBack()
  },

  // 提交评价
  async submitComment() {
    if (this.data.submitting) return
    
    if (this.data.rating === 0) {
      wx.vibrateShort({ type: 'medium' })
      wx.showToast({
        title: '请选择评分',
        icon: 'none'
      })
      return
    }

    if (!this.data.content || this.data.content.trim().length === 0) {
      wx.vibrateShort({ type: 'medium' })
      wx.showToast({
        title: '请输入评价内容',
        icon: 'none'
      })
      return
    }

    if (this.data.content.trim().length < 5) {
      wx.vibrateShort({ type: 'medium' })
      wx.showToast({
        title: '评价内容至少5个字',
        icon: 'none'
      })
      return
    }

    wx.vibrateShort({ type: 'medium' })
    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中...', mask: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'submitComment',
        data: {
          targetType: this.data.targetType,
          targetId: this.data.targetId,
          rating: this.data.rating,
          content: this.data.content.trim(),
          images: this.data.images
        }
      })

      wx.hideLoading()

      if (res.result && res.result.success) {
        wx.vibrateShort({ type: 'heavy' })
        wx.showToast({
          title: res.result.msg || '评价提交成功',
          icon: 'success',
          duration: 2000
        })

        setTimeout(() => {
          wx.navigateBack()
        }, 2000)
      } else {
        wx.showToast({
          title: res.result.msg || '提交失败',
          icon: 'none',
          duration: 2000
        })
        this.setData({ submitting: false })
      }
    } catch (e) {
      console.error('提交评价失败:', e)
      wx.hideLoading()
      wx.showToast({
        title: '提交失败，请重试',
        icon: 'none',
        duration: 2000
      })
      this.setData({ submitting: false })
    }
  }
})

