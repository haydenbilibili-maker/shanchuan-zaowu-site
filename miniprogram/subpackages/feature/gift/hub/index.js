// 礼赠主入口 · 场景选礼（与 compose 落笔/录音并行改动隔离）
const imageUrl = require('../../../../utils/imageUrl')
const {
  fetchContentDisplayFlags,
  toastGiftClosed
} = require('../../../../utils/contentDisplayFlags')
const { trackBehavior } = require('../../../../utils/trackBehavior')
const { GIFT_SCENES, getSceneByKey } = require('../../utils/giftScenes')
const { isProtectedProduct } = require('../../../../utils/protectionBadge')
const { decodeQueryText } = require('../decodeQueryText')

const PAGE_SIZE = 6

Page({
  data: {
    checking: true,
    allowed: false,
    paneReady: false,
    skelRows: [1, 2, 3, 4],
    forWhom: '',
    scenes: GIFT_SCENES.map((s) => ({ key: s.key, label: s.label })),
    activeScene: '',
    sceneGuide: '',
    products: [],
    loadingProducts: false,
    productsError: '',
    usedFallback: false,
    hasMoreScene: false,
    sceneInBatch: 0
  },

  onLoad(options) {
    this._from = (options && options.from) || 'direct'
    this._seenIds = []
    // 必须先 decode：否则仍带 %XX 时再 encodeURIComponent 会双重编码，compose 显示乱码
    this._toName = decodeQueryText(
      (options && (options.toName || options.recipientName)) || ''
    )
      .trim()
      .slice(0, 40)
    this._contactId = decodeQueryText((options && options.contactId) || '').trim()
    const preset = decodeQueryText((options && options.scene) || '').trim()
    // 详情页「适合的场景」深链：显式进入某场景（与礼笺预设 scene 区分）
    this._enterScene = decodeQueryText((options && options.enterScene) || '').trim()
    if (!this._toName || !this._contactId) {
      try {
        const pref = wx.getStorageSync('gift_compose_prefills') || null
        if (pref && typeof pref === 'object') {
          if (!this._toName && pref.toName) {
            this._toName = String(pref.toName).trim().slice(0, 40)
          }
          if (!this._contactId && pref.contactId) {
            this._contactId = String(pref.contactId).trim()
          }
        }
      } catch (e) { /* ignore */ }
    }
    if (this._toName) {
      this.setData({ forWhom: this._toName })
    }
    this.guardAndEnter(preset)
  },

  async guardAndEnter(presetScene) {
    try {
      const { flags } = await fetchContentDisplayFlags()
      if (!flags.showGift) {
        toastGiftClosed()
        this.setData({ checking: false, allowed: false })
        setTimeout(() => {
          wx.navigateBack({
            fail: () => wx.switchTab({ url: '/pages/atelier/index' })
          })
        }, 400)
        return
      }
      this.setData({ checking: false, allowed: true })
      setTimeout(() => this.setData({ paneReady: true }), 30)
      if (this._enterScene) this.selectScene(this._enterScene, true)
      trackBehavior('gift_hub_enter', 'from', this._from)
      if (presetScene && getSceneByKey(presetScene)) {
        this.selectScene(presetScene, true)
      }
    } catch (e) {
      toastGiftClosed()
      this.setData({ checking: false, allowed: false })
      setTimeout(() => {
        wx.navigateBack({
          fail: () => wx.switchTab({ url: '/pages/atelier/index' })
        })
      }, 400)
    }
  },

  onSceneTap(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '').trim()
    if (!key) return
    if (key === this.data.activeScene) {
      this._seenIds = []
      this.setData({
        activeScene: '',
        sceneGuide: '',
        products: [],
        usedFallback: false,
        hasMoreScene: false,
        sceneInBatch: 0
      })
      return
    }
    this.selectScene(key, true)
  },

  selectScene(key, reset) {
    const meta = getSceneByKey(key)
    if (!meta) return
    if (reset) this._seenIds = []
    this.setData({
      activeScene: meta.key,
      sceneGuide: meta.guide || '',
      products: reset ? [] : this.data.products
    })
    trackBehavior('gift_scene_select', 'scene', meta.key)
    this.loadSceneProducts(!!reset)
  },

  async loadSceneProducts(reset) {
    const scene = this.data.activeScene
    if (!scene) return
    if (reset) this._seenIds = []

    const excludeIds = (this._seenIds || []).slice()
    this.setData({ loadingProducts: true, productsError: '' })
    try {
      const call = await wx.cloud.callFunction({
        name: 'getGiftSceneProducts',
        data: {
          scene,
          limit: PAGE_SIZE,
          offset: 0,
          excludeIds
        }
      })
      const result = (call && call.result) || {}
      if (!result.success) {
        throw new Error(result.msg || '选品失败')
      }
      const rows = Array.isArray(result.data) ? result.data : []
      // 客户端再保证：场景在前、兜底在后（防旧云函数乱序）
      rows.sort((a, b) => {
        const ma = a.matchSource === 'fallback' ? 1 : 0
        const mb = b.matchSource === 'fallback' ? 1 : 0
        return ma - mb
      })

      // 2026-09-17 修复：此前把 cloud:// 转临时链，转换失败（或没命中）时**把值丢成空串** → 封面全空。
      // 实测这些商品的 images[0] 就是云文件 ID，而云文件 ID 可直接给 <image>（首页/馆藏都这么做），
      // 且不像临时链那样会过期；要缩略图时交给 thumbUrl()（不可用时它回落原值）。
      const products = rows.map((p) => {
        const raw = imageUrl.firstImageOf(p)
        const cover = raw ? imageUrl.thumbUrl(raw) : ''
        const price = Number(p.price)
        return {
          _id: p._id,
          title: p.title || '',
          themeName: p.themeName || '',
          themeNote: p.themeNote || '',
          latinName: p.latinName || '',
          cover,
          priceLabel: Number.isFinite(price) ? price.toFixed(2) : '—',
          matchSource: p.matchSource === 'fallback' ? 'fallback' : 'scene',
          isProtected: isProtectedProduct(p),
          // 需求 11：白名单映射需显式带上敏感形态判定
          sensitiveEnabled: require('../../../../utils/sensitiveBlurCard').sensitiveEnabledOf(p)
        }
      })

      products.forEach((p) => {
        if (p._id && this._seenIds.indexOf(p._id) < 0) this._seenIds.push(p._id)
      })

      this.setData({
        products,
        loadingProducts: false,
        productsError: '',
        usedFallback: !!result.usedFallback,
        hasMoreScene: !!result.hasMoreScene,
        sceneInBatch: Number(result.sceneInBatch) || products.filter((p) => p.matchSource === 'scene').length
      })
    } catch (e) {
      console.warn('gift scene products', e)
      this.setData({
        products: [],
        loadingProducts: false,
        usedFallback: false,
        hasMoreScene: false,
        sceneInBatch: 0,
        productsError: '柜中片刻未应，请换一批或稍后再试'
      })
    }
  },

  /** 封面加载失败：置破图标记，露出占位底（避免长期显示裂图） */
  onCoverError(e) {
    const index = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) return
    this.setData({ [`products[${index}].coverBroken`]: true })
  },

  onRefreshBatch() {
    if (!this.data.activeScene || this.data.loadingProducts) return
    // 场景池还有 → 带着已见 id 取下一批；耗尽则清空已见，重新从场景池轮转
    if (!this.data.hasMoreScene) {
      this._seenIds = []
      this.loadSceneProducts(true)
      return
    }
    this.loadSceneProducts(false)
  },

  onProductTap(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    if (!id) return
    const scene = this.data.activeScene
    // 选品前再写一遍明文 prefills，compose 可在 query 残片时兜底
    if (this._toName || this._contactId || scene) {
      try {
        wx.setStorageSync('gift_compose_prefills', {
          toName: this._toName || '',
          contactId: this._contactId || '',
          scene: scene || ''
        })
      } catch (err) { /* ignore */ }
    }
    const q = [
      `productId=${encodeURIComponent(id)}`,
      'from=gift_hub'
    ]
    if (scene) q.push(`scene=${encodeURIComponent(scene)}`)
    if (this._toName) q.push(`toName=${encodeURIComponent(this._toName)}`)
    if (this._contactId) q.push(`contactId=${encodeURIComponent(this._contactId)}`)
    trackBehavior('gift_scene_product_tap', 'product', id, { scene })
    wx.navigateTo({
      url: `/subpackages/feature/gift/compose/index?${q.join('&')}`
    })
  },

  goBrowse() {
    const q = ['from=gift_hub']
    // 馆藏 Tab 无法带参；把预填写入 storage 供 compose 读取（若日后馆藏跳转 compose）
    if (this._toName || this._contactId || this.data.activeScene) {
      try {
        wx.setStorageSync('gift_compose_prefills', {
          toName: this._toName || '',
          contactId: this._contactId || '',
          scene: this.data.activeScene || ''
        })
      } catch (e) { /* ignore */ }
    }
    wx.switchTab({
      url: '/pages/category/index',
      fail: () =>
        wx.navigateTo({
          url: '/subpackages/feature/search/index',
          fail: () => wx.showToast({ title: '无法打开馆藏', icon: 'none' })
        })
    })
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/atelier/index' })
    })
  }
})
