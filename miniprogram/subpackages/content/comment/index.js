// subpackages/feature/comment/index.js

const pad2 = (n) => (n < 10 ? '0' + n : '' + n)

function formatTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const REVIEW_VIEW = {
  pending: { statusText: '审核中', statusNote: '审核通过后会展示在藏品页，其他藏友就能看到。' },
  approved: { statusText: '已展示', statusNote: '这条评价已展示在藏品页。' },
  hidden: { statusText: '未展示', statusNote: '这条评价暂未展示在藏品页，如有疑问可联系专员。' }
}

/**
 * 已评价藏品 → 「我的评价」查看态；未评价 / 无评价记录 → null（走撰写态或资格提示）。
 * 状态只认 submitComment.orderStatus 回来的 reviewStatus（即 comments.status），不在前端推断。
 * rejected 不会出现在这里：orderStatus 查询排除了 rejected，那件藏品回到「可评价」。
 */
function buildViewReview(selected) {
  if (!selected || selected.canReview) return null
  const status = selected.reviewStatus
  if (!status || status === 'none') return null
  const mine = selected.myReview || {}
  const copy = REVIEW_VIEW[status] || { statusText: '已提交', statusNote: '' }
  return {
    status,
    statusText: copy.statusText,
    statusNote: copy.statusNote,
    rating: Number(mine.rating || selected.rating) || 0,
    content: mine.content || '',
    images: Array.isArray(mine.images) ? mine.images : [],
    timeText: formatTime(mine.createdAt),
    merchantReply: mine.merchantReply || '',
    canVisit: status === 'approved' && !!selected.productId
  }
}

Page({
  data: {
    targetType: 'product',
    targetId: '',
    orderId: '',
    targetInfo: null,

    rating: 0,
    content: '',
    images: [],

    submitting: false,
    loadingGate: true,
    canReview: false,
    gateMsg: '',
    gateCode: '',
    productOptions: [],
    summaryLabel: '',
    alreadyRating: 0,
    viewReview: null
  },

  onLoad(options) {
    const { targetType, targetId, orderId, productId } = options || {}

    this.setData({
      targetType: targetType || 'product',
      targetId: targetId || productId || '',
      orderId: orderId || ''
    })

    this.bootstrap()
  },

  syncTitle() {
    const { loadingGate, canReview, viewReview } = this.data
    const title = loadingGate ? '评价' : viewReview ? '我的评价' : canReview ? '发表评价' : '评价'
    wx.setNavigationBarTitle({ title })
  },

  async bootstrap() {
    this.setData({ loadingGate: true })
    try {
      if (this.data.targetType === 'product') {
        await this.prepareProductReview()
      } else {
        this.setData({ canReview: true, loadingGate: false })
        await this.loadTargetInfo()
      }
    } catch (e) {
      console.error('评价页初始化失败', e)
      this.setData({
        loadingGate: false,
        canReview: false,
        viewReview: null,
        gateMsg: '暂时无法评价，请稍后从订单详情再试'
      })
    }
    this.syncTitle()
  },

  async prepareProductReview() {
    const { orderId, targetId } = this.data
    if (!orderId) {
      this.setData({
        loadingGate: false,
        canReview: false,
        viewReview: null,
        gateCode: 'NEED_ORDER',
        gateMsg: '确认签收后，可在订单详情写下对这件藏品的真实感受。'
      })
      return
    }

    const res = await wx.cloud.callFunction({
      name: 'submitComment',
      data: { action: 'orderStatus', orderId }
    })
    const result = (res && res.result) || {}
    if (!result.success) {
      this.setData({
        loadingGate: false,
        canReview: false,
        viewReview: null,
        gateMsg: result.msg || '无法确认评价资格'
      })
      return
    }

    const products = Array.isArray(result.products) ? result.products : []
    let selectedId = targetId
    if (!selectedId) {
      const pending = products.find((p) => p.canReview)
      selectedId = (pending && pending.productId) || (products[0] && products[0].productId) || ''
    }

    const selected = products.find((p) => p.productId === selectedId) || null
    const canReview = !!(selected && selected.canReview)
    const viewReview = buildViewReview(selected)

    this.setData({
      loadingGate: false,
      targetId: selectedId,
      productOptions: products,
      summaryLabel: result.summaryLabel || '',
      canReview,
      viewReview,
      gateCode: canReview ? '' : (selected && selected.reviewStatus === 'pending' ? 'PENDING' : selected ? 'ALREADY' : 'NONE'),
      gateMsg: canReview
        ? ''
        : selected
          ? selected.reviewStatus === 'pending'
            ? '评价审核中，通过后会展示在藏品页。'
            : '这件藏品已评价过，谢谢你的分享。'
          : result.voucherOrder
            ? '此订单无需评价。'
            : result.received
              ? '暂无可评价的藏品。'
              : '确认签收后再来评价。',
      alreadyRating: selected && selected.rating ? selected.rating : 0,
      targetInfo: selected
        ? {
            title: selected.title,
            images: selected.image ? [selected.image] : [],
            image: selected.image || '',
            latinName: selected.latinName || ''
          }
        : null
    })

    if ((canReview || viewReview) && selectedId && !selected.image) {
      this.loadTargetInfo()
    }
  },

  async loadTargetInfo() {
    if (!this.data.targetId) return
    try {
      let collectionName = 'products'
      if (this.data.targetType === 'activity') collectionName = 'activities'
      else if (this.data.targetType === 'course') collectionName = 'courses'

      const res = await wx.cloud.database().collection(collectionName).doc(this.data.targetId).get()
      if (res.data) {
        this.setData({ targetInfo: res.data })
      }
    } catch (e) {
      console.error('加载目标信息失败:', e)
    }
  },

  selectProduct(e) {
    const productId = e.currentTarget.dataset.id
    if (!productId || productId === this.data.targetId) return
    const selected = (this.data.productOptions || []).find((p) => p.productId === productId)
    if (!selected) return
    const canReview = !!selected.canReview
    const viewReview = buildViewReview(selected)
    this.setData({
      targetId: productId,
      canReview,
      viewReview,
      rating: 0,
      content: '',
      images: [],
      gateCode: canReview ? '' : (selected.reviewStatus === 'pending' ? 'PENDING' : 'ALREADY'),
      gateMsg: canReview
        ? ''
        : selected.reviewStatus === 'pending'
          ? '评价审核中，通过后会展示在藏品页。'
          : '这件藏品已评价过，谢谢你的分享。',
      alreadyRating: selected.rating || 0,
      targetInfo: {
        title: selected.title,
        images: selected.image ? [selected.image] : [],
        image: selected.image || '',
        latinName: selected.latinName || ''
      }
    })
    this.syncTitle()
    if ((canReview || viewReview) && !selected.image) this.loadTargetInfo()
  },

  selectRating(e) {
    if (!this.data.canReview) return
    const rating = e.currentTarget.dataset.rating
    wx.vibrateShort({ type: 'light' })
    this.setData({ rating })
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  chooseImage() {
    if (!this.data.canReview) return
    const remain = 3 - this.data.images.length
    if (remain <= 0) {
      wx.showToast({ title: '最多 3 张图片', icon: 'none' })
      return
    }

    wx.chooseImage({
      count: remain,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => this.uploadImages(res.tempFilePaths)
    })
  },

  async uploadImages(filePaths) {
    wx.showLoading({ title: '上传中…' })
    try {
      const uploadPromises = filePaths.map((filePath) => {
        const cloudPath = `comments/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`
        return wx.cloud.uploadFile({ cloudPath, filePath })
      })
      const results = await Promise.all(uploadPromises)
      const fileIds = results.map((res) => res.fileID)
      this.setData({ images: [...this.data.images, ...fileIds] })
      wx.hideLoading()
    } catch (e) {
      console.error('上传图片失败:', e)
      wx.hideLoading()
      wx.showToast({ title: '上传失败', icon: 'none' })
    }
  },

  deleteImage(e) {
    e.stopPropagation()
    const index = e.currentTarget.dataset.index
    wx.vibrateShort({ type: 'light' })
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },

  previewImage(e) {
    const index = e.currentTarget.dataset.index
    const images = this.data.images
    if (images && images.length > 0) {
      wx.previewImage({ current: images[index], urls: images })
    }
  },

  previewMyImage(e) {
    const urls = (this.data.viewReview && this.data.viewReview.images) || []
    const index = e.currentTarget.dataset.index
    if (urls.length) wx.previewImage({ current: urls[index], urls })
  },

  goProduct() {
    const view = this.data.viewReview
    const productId = this.data.targetId
    if (!view || !view.canVisit || !productId) return
    const url = `/subpackages/feature/detail/index?id=${encodeURIComponent(productId)}`
    wx.navigateTo({ url, fail: () => wx.redirectTo({ url }) })
  },

  goOrderDetail() {
    const orderId = this.data.orderId
    if (!orderId) {
      wx.navigateBack()
      return
    }
    wx.redirectTo({
      url: `/subpackages/business/order-detail/index?id=${orderId}`,
      fail: () => wx.navigateBack()
    })
  },

  async submitComment() {
    if (this.data.submitting || !this.data.canReview) return

    if (this.data.rating === 0) {
      wx.vibrateShort({ type: 'medium' })
      wx.showToast({ title: '请先点选评分', icon: 'none' })
      return
    }

    const content = (this.data.content || '').trim()
    if (!content) {
      wx.vibrateShort({ type: 'medium' })
      wx.showToast({ title: '写下一点真实感受吧', icon: 'none' })
      return
    }
    if (content.length < 5) {
      wx.vibrateShort({ type: 'medium' })
      wx.showToast({ title: '至少写 5 个字', icon: 'none' })
      return
    }

    wx.vibrateShort({ type: 'medium' })
    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中…', mask: true })

    try {
      const payload = {
        action: 'submit',
        targetType: this.data.targetType,
        targetId: this.data.targetId,
        rating: this.data.rating,
        content,
        images: this.data.images
      }
      if (this.data.targetType === 'product') {
        payload.orderId = this.data.orderId
      }

      const res = await wx.cloud.callFunction({
        name: 'submitComment',
        data: payload
      })

      wx.hideLoading()

      if (res.result && res.result.success) {
        wx.vibrateShort({ type: 'heavy' })
        wx.showToast({
          title: res.result.msg || '已提交',
          icon: 'success',
          duration: 2000
        })
        setTimeout(() => {
          if (this.data.orderId) this.goOrderDetail()
          else wx.navigateBack()
        }, 1600)
      } else {
        wx.showToast({
          title: (res.result && res.result.msg) || '提交失败',
          icon: 'none',
          duration: 2200
        })
        this.setData({ submitting: false })
        if (res.result && (res.result.code === 'ALREADY' || res.result.code === 'PENDING')) {
          this.prepareProductReview()
        }
      }
    } catch (e) {
      console.error('提交评价失败:', e)
      wx.hideLoading()
      wx.showToast({ title: '提交失败，请重试', icon: 'none' })
      this.setData({ submitting: false })
    }
  }
})
