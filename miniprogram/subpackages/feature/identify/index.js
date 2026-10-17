// AI 鉴定入口：拍照 / 相册 → 云函数 identifySpecimen（DashScope 真实识别）
const { compressToMaxSize, isAllowedImage } = require('../utils/identifyImage')
const { identifyFailureCopy } = require('../utils/identifyFailure')
const { trackBehavior } = require('../../../utils/trackBehavior')
const easterEggHost = require('../../../utils/easterEggHost')
const { openAppModal } = require('../../../utils/appModal')
const {
  fetchContentDisplayFlags,
  toastAiIdentifyClosed
} = require('../../../utils/contentDisplayFlags')

const CLOUD_PREFIX = 'identify'
const IDENTIFY_CF_TIMEOUT_MS = 60000

const CATEGORY_HINTS = [
  { id: '', label: '不限' },
  { id: '昆虫', label: '昆虫' },
  { id: '矿石', label: '矿石' },
  { id: '植物', label: '植物' },
  { id: '海洋', label: '海洋' },
  { id: '动物', label: '动物' },
  { id: '衍生品', label: '衍生品' }
]

/* 拍摄建议（2026-10-17 鉴定台重构：一条一格，2×2 发丝网格；文案口径不变）。
   需求 2：原为「可再拍一张细节图」——拍摄与相册均只支持**一张图**，改为单图内可执行的构图建议。 */
const PHOTO_TIPS = [
  { k: '正对', v: '正对藏品主体，避免倾斜过大' },
  { k: '柔光', v: '均匀柔光，减少玻璃罩与强反光' },
  { k: '占满', v: '看翅脉或纹理时，让主体占满画面再拍' },
  { k: '简洁', v: '背景简洁，主体占画面六成以上' }
]

/** 鉴定三步（与等待卡上的三步同名：入镜 → 归档 → 解读） */
const FLOW_STEPS = [
  { k: '入镜', v: '拍一张或选一张' },
  { k: '归档', v: '照片存入你的鉴定记录' },
  { k: '解读', v: '约 15–60 秒，给出物种与手记' }
]

Page({
  behaviors: [easterEggHost],
  data: {
    busy: false,
    loadingText: '',
    uploadProgress: 0,
    loadingStep: 0,
    recentList: [],
    categoryHints: CATEGORY_HINTS,
    categoryHint: '',
    entrySource: 'user_menu',
    photoTips: PHOTO_TIPS,
    flowSteps: FLOW_STEPS,
    entryBlocked: false
  },

  onLoad(options) {
    let from = (options && options.from) || 'user_menu'
    // 门店/物料小程序码走 scene（wxacode.getUnlimited），内容形如 from=store_qr
    try {
      const sceneText = options && options.scene ? decodeURIComponent(String(options.scene)) : ''
      const m = /(?:^|[&?])from=([^&]+)/.exec(sceneText)
      if (m && m[1]) from = decodeURIComponent(m[1])
    } catch (e) { /* ignore */ }
    this.setData({ entrySource: from })
    this.guardEntry(from)
  },

  async guardEntry(from) {
    const { flags } = await fetchContentDisplayFlags()
    if (!flags.showAiIdentify) {
      this.setData({ entryBlocked: true })
      toastAiIdentifyClosed()
      setTimeout(() => {
        wx.navigateBack({
          fail: () => wx.switchTab({ url: '/pages/category/index' })
        })
      }, 400)
      return
    }
    trackBehavior('identify_entry_click', 'identification', from, { source: from })
  },

  onShow() {
    if (this.data.entryBlocked) return
    this.loadRecent()
  },

  genLocalName() {
    return `${CLOUD_PREFIX}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  },

  async loadRecent() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'identifySpecimen',
        data: { action: 'list_recent', limit: 5 }
      })
      // 缩略图直接用记录里的 cloud:// fileID（<image> 原生支持）；读不到就退回占位格（onRecentThumbError）
      const list = ((res.result && res.result.data) || []).slice(0, 3).map((doc) => ({
        _id: doc._id,
        name: (doc.species_info && doc.species_info.species_name_zh) || '未知物种',
        latin: (doc.species_info && doc.species_info.species_name_latin) || '',
        thumb: /^cloud:\/\//.test(String(doc.image_url || '')) ? doc.image_url : '',
        timeText: this.formatTime(doc.created_at)
      }))
      this.setData({ recentList: list })
    } catch (e) {
      console.warn('loadRecent', e)
      this.setData({ recentList: [] })
    }
  },

  formatTime(ts) {
    if (!ts) return ''
    const diff = Date.now() - ts
    const min = Math.floor(diff / 60000)
    if (min < 1) return '刚刚'
    if (min < 60) return `${min} 分钟前`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr} 小时前`
    const d = new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()}`
  },

  onRecentThumbError(e) {
    const i = Number(e.currentTarget.dataset.index)
    if (Number.isInteger(i) && i >= 0) this.setData({ [`recentList[${i}].thumb`]: '' })
  },

  /** 取景框本身就是快门：点框 = 拍照（相册走框下的文字链） */
  onFrameTap() {
    if (this.data.busy) return
    this.onTakePhoto()
  },

  onCategoryHint(e) {
    const id = e.currentTarget.dataset.id
    if (id === this.data.categoryHint) return
    this.setData({ categoryHint: id || '' })
  },

  openRecent(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '记录不存在', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/subpackages/feature/identify/result/index?record_id=${id}`,
      fail: () => wx.showToast({ title: '无法打开鉴定结果', icon: 'none' })
    })
  },

  goAtlas() {
    wx.navigateTo({ url: '/subpackages/feature/collection/index' })
  },

  goLog() {
    wx.navigateTo({ url: '/subpackages/feature/collection/log/index' })
  },

  async pickImage(sourceType) {
    const choose = await new Promise((resolve, reject) => {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: sourceType.length ? sourceType : ['album', 'camera'],
        sizeType: ['compressed'],
        success: resolve,
        fail: reject
      })
    })
    const f = choose.tempFiles && choose.tempFiles[0]
    if (!f || !f.tempFilePath) {
      throw new Error('未选择图片')
    }
    return f.tempFilePath
  },

  async onTakePhoto() {
    try {
      const path = await this.pickImage(['camera'])
      await this.processAndIdentify(path)
    } catch (e) {
      if (e.errMsg && e.errMsg.includes('cancel')) return
      console.error(e)
      wx.showToast({ title: e.message || '操作失败', icon: 'none' })
    }
  },

  async onChooseAlbum() {
    try {
      const path = await this.pickImage(['album'])
      await this.processAndIdentify(path)
    } catch (e) {
      if (e.errMsg && e.errMsg.includes('cancel')) return
      console.error(e)
      wx.showToast({ title: e.message || '操作失败', icon: 'none' })
    }
  },

  async processAndIdentify(localPath) {
    if (!isAllowedImage(localPath)) {
      wx.showToast({ title: '仅支持 JPG / PNG / WEBP', icon: 'none' })
      return
    }

    trackBehavior('identify_start', 'identification', 'camera', {
      source: this.data.entrySource,
      category_hint: this.data.categoryHint || ''
    })

    this.setData({
      busy: true,
      loadingText: '藏品入镜…',
      uploadProgress: 0,
      loadingStep: 1
    })

    let compressed
    try {
      compressed = await compressToMaxSize(localPath, 2 * 1024 * 1024)
    } catch (err) {
      this.setData({ busy: false, uploadProgress: 0, loadingStep: 0 })
      wx.showToast({ title: err.message || '压缩失败', icon: 'none' })
      return
    }

    this.setData({ loadingText: '上传归档…', uploadProgress: 5, loadingStep: 2 })

    const cloudPath = this.genLocalName()
    let fileID
    try {
      const maybeTask = wx.cloud.uploadFile({
        cloudPath,
        filePath: compressed
      })
      if (maybeTask && typeof maybeTask.onProgressUpdate === 'function') {
        maybeTask.onProgressUpdate((res) => {
          const p = Math.min(95, 5 + Math.floor((res.progress || 0) * 0.9))
          this.setData({ uploadProgress: p })
        })
      }
      const up =
        maybeTask && typeof maybeTask.then === 'function'
          ? await maybeTask
          : await new Promise((resolve, reject) => {
              wx.cloud.uploadFile({
                cloudPath,
                filePath: compressed,
                success: resolve,
                fail: reject
              })
            })
      fileID = up.fileID
    } catch (err) {
      console.error(err)
      this.setData({ busy: false, uploadProgress: 0, loadingStep: 0 })
      wx.showToast({ title: '上传失败，请检查网络', icon: 'none' })
      return
    }

    this.setData({ loadingText: '博物解读中，约需 15–60 秒…', uploadProgress: 96, loadingStep: 3 })

    try {
      const res = await wx.cloud.callFunction({
        name: 'identifySpecimen',
        data: {
          image_file_id: fileID,
          category_hint: this.data.categoryHint || '',
          entry_source: this.data.entrySource || ''
        },
        config: { timeout: IDENTIFY_CF_TIMEOUT_MS }
      })
      const result = res.result
      if (!result || !result.success) {
        const failure = new Error((result && result.msg) || '识别失败')
        failure.errorType = (result && result.error_type) || ''
        throw failure
      }
      if (!result.data || !result.data.record_id) {
        throw new Error('识别结果不完整，请重试')
      }

      wx.setStorageSync('identify_last_local_preview', compressed)

      this.setData({ busy: false, uploadProgress: 100, loadingStep: 0 })
      trackBehavior('identify_success', 'identification', result.data.record_id, {
        from_cache: !!result.data.from_cache,
        species: (result.data.species_info && result.data.species_info.species_name_zh) || '',
        source: this.data.entrySource
      })
      // 需求 1：单独上报「同图复用」，用于度量重复拍摄/重复上传的拦截效果
      // （identify_start 仍是「尝试」口径，reused / start 即复用率）
      if (result.data.from_cache) {
        trackBehavior('identify_reused', 'identification', result.data.record_id, {
          species: (result.data.species_info && result.data.species_info.species_name_zh) || '',
          source: this.data.entrySource
        })
      }

      let url = `/subpackages/feature/identify/result/index?record_id=${result.data.record_id}`
      if (result.data.from_cache) {
        url += '&from_cache=1'
      }
      wx.navigateTo({
        url,
        fail: () => wx.redirectTo({
          url,
          fail: () => wx.showToast({ title: '无法打开识别结果', icon: 'none' })
        })
      })
      this.loadRecent()
    } catch (err) {
      console.error(err)
      this.setData({ busy: false, uploadProgress: 0, loadingStep: 0 })
      trackBehavior('identify_fail', 'identification', 'error', {
        message: (err && err.message) || '',
        source: this.data.entrySource
      })
      const copy = identifyFailureCopy(err)
      openAppModal({
        title: copy.title,
        content: copy.content,
        confirmText: '知道了',
        showCancel: false
      }, this)
    }
  }
})
