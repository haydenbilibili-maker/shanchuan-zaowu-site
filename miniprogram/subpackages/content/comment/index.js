// subpackages/feature/comment/index.js

const pad2 = (n) => (n < 10 ? '0' + n : '' + n)

function formatTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const REVIEW_VIEW = {
  pending: { statusText: '审核中', statusNote: '正在检测内容，稍后展示在藏品页。' },
  approved: { statusText: '已展示', statusNote: '这条评价已展示在藏品页。' },
  hidden: { statusText: '未展示', statusNote: '这条评价暂未展示在藏品页，如有疑问可联系专员。' }
}

/** 追评的审核状态文案（与原评价同口径；追评审核中不影响原评价的展示） */
const APPEND_VIEW = {
  pending: { statusText: '审核中', statusNote: '追评正在检测内容，通过后展示在原评价下方。' },
  approved: { statusText: '已展示', statusNote: '' },
  hidden: { statusText: '未展示', statusNote: '这条追评暂未展示，如有疑问可联系专员。' }
}
const DAY_MS = 86400000

function buildAppendView(append) {
  if (!append || !append.content) return null
  const status = append.status || 'pending'
  const copy = APPEND_VIEW[status] || APPEND_VIEW.pending
  const days = Number(append.daysAfter) || 0
  return {
    status,
    statusText: copy.statusText,
    statusNote: copy.statusNote,
    content: append.content,
    images: Array.isArray(append.images) ? append.images : [],
    daysText: days > 0 ? `${days} 天后` : '当天'
  }
}

/** 「追加评价」入口下的小字：还剩几天（≤30 天时才提醒，避免每条都催） */
function appendHintOf(deadline, nowMs) {
  const left = deadline ? Math.ceil((deadline - (nowMs || Date.now())) / DAY_MS) : 0
  if (left > 0 && left <= 30) return `用了一段时间？还可追评 ${left} 天`
  return '用了一段时间？说说它现在的样子'
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
    canVisit: status === 'approved' && !!selected.productId,
    append: buildAppendView(mine.append),
    canAppend: !!selected.canAppend && !mine.append,
    appendHint: appendHintOf(selected.appendDeadline)
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
    viewReview: null,
    /** 追加评价撰写态（2026-11-27）：复用正文 / 图片 / 发布条，不要求评分 */
    appendMode: false,
    toastShow: false,
    toastOverline: '',
    toastTitle: '',
    toastDesc: '',
    appendPhrases: ['用了一段时间依旧好看', '颜色没有变化', '养护很简单', '朋友来家里都会问', '越看越喜欢', '包装和做工都经得起时间'],
    /** 常用说法（2026-11-23）：点一下接到正文后面 */
    phrases: ['包装很用心', '比图片更好看', '做工细致', '适合送人', '摆在书房刚好', '颜色很正']
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
    const title = loadingGate ? '评价' : this.data.appendMode ? '追加评价' : viewReview ? '我的评价' : canReview ? '发表评价' : '评价'
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
      appendMode: false,
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
      appendMode: false,
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

  /** 能写正文 / 传图：发表评价或追加评价 */
  isEditing() {
    return !!(this.data.canReview || this.data.appendMode)
  },

  startAppend() {
    const view = this.data.viewReview
    if (!view || !view.canAppend || this.data.submitting) return
    wx.vibrateShort({ type: 'light' })
    this.setData({ appendMode: true, content: '', images: [] })
    this.syncTitle()
  },

  cancelAppend() {
    if (this.data.submitting) return
    const dirty = String(this.data.content || '').trim() || (this.data.images || []).length
    const leave = () => {
      this.setData({ appendMode: false, content: '', images: [] })
      this.syncTitle()
    }
    if (!dirty) return leave()
    // 在方法里 require：页面顶层（Page 之前）要保持纯函数，check:bflow-polish 会单独真跑那一段
    const { openAppModal } = require('../../../utils/appModal')
    openAppModal({
      title: '放弃这条追评？',
      content: '已写的内容不会保存。',
      confirmText: '放弃',
      cancelText: '继续写',
      success: (r) => { if (r.confirm) leave() }
    }, this)
  },

  /** 追评反馈：站内铭牌轻提示（AppToast），不再新增原生 toast */
  tip(title, desc, overline) {
    this.setData({ toastShow: true, toastOverline: overline || 'FOLLOW-UP', toastTitle: title || '', toastDesc: desc || '' })
  },

  onToastClose() {
    this.setData({ toastShow: false })
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

  /** 常用说法：接在已写内容后面（中间补一个逗号），不超过 500 字；已经写过这一句就不重复 */
  onPhrase(e) {
    if (!this.isEditing()) return
    const p = String(e.currentTarget.dataset.text || '')
    const cur = String(this.data.content || '')
    if (!p || cur.indexOf(p) >= 0) return
    const next = (cur.trim() ? `${cur.replace(/[，,。\s]+$/, '')}，${p}` : p).slice(0, 500)
    wx.vibrateShort({ type: 'light' })
    this.setData({ content: next })
  },

  chooseImage() {
    if (!this.isEditing()) return
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

  previewAppendImage(e) {
    const ap = this.data.viewReview && this.data.viewReview.append
    const urls = (ap && ap.images) || []
    const index = e.currentTarget.dataset.index
    if (urls.length) wx.previewImage({ current: urls[index], urls })
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
        const shown = res.result.status === 'approved'
        wx.showToast({
          title: shown ? '评价已展示' : '已提交，正在检测内容，稍后展示',
          icon: shown ? 'success' : 'none',
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
  },

  /** 追加评价：成功后留在本页，重新拉一次订单评价状态，卡片里直接出现这条追评 */
  async submitAppend() {
    if (this.data.submitting || !this.data.appendMode) return
    const content = (this.data.content || '').trim()
    if (content.length < 5) {
      // 发布条上方那行已写明还差什么（submitState.wxs appendHint），这里只震一下
      wx.vibrateShort({ type: 'medium' })
      return
    }

    wx.vibrateShort({ type: 'medium' })
    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中…', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'submitComment',
        data: {
          action: 'append',
          orderId: this.data.orderId,
          targetId: this.data.targetId,
          content,
          images: this.data.images
        }
      })
      wx.hideLoading()
      const r = (res && res.result) || {}
      if (r.success) {
        wx.vibrateShort({ type: 'heavy' })
        if (r.status === 'approved') this.tip('追评已展示', '会出现在藏品页你的评价下方')
        else this.tip('追评已提交', '内容检测通过后展示在藏品页')
        this.setData({ submitting: false, appendMode: false, content: '', images: [] })
        await this.prepareProductReview()
        this.syncTitle()
        return
      }
      this.tip(r.msg || '提交失败', '', 'NOT SENT')
      this.setData({ submitting: false })
      if (r.code === 'APPEND_DONE' || r.code === 'APPEND_EXPIRED' || r.code === 'APPEND_CLOSED') {
        await this.prepareProductReview()
        this.syncTitle()
      }
    } catch (e) {
      console.error('提交追评失败:', e)
      wx.hideLoading()
      this.tip('提交失败', '网络不太稳，稍后再试', 'NOT SENT')
      this.setData({ submitting: false })
    }
  }
})
